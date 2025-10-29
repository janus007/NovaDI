/**
 * Core dependency injection container for NovaDI
 */

import { Token } from './token.js'
import { BindingNotFoundError, CircularDependencyError } from './errors.js'
import { Builder } from './builder.js'

export type Lifetime = 'singleton' | 'transient' | 'per-request'

export interface BindingOptions {
  lifetime?: Lifetime
  dependencies?: Token<any>[]
}

export type Factory<T> = (container: Container) => T | Promise<T>

type BindingType = 'value' | 'factory' | 'class' | 'inline-class'

interface Binding<T = any> {
  type: BindingType
  lifetime: Lifetime
  value?: T
  factory?: Factory<T>
  constructor?: new (...args: any[]) => T
  dependencies?: Token<any>[]
}

interface Disposable {
  dispose(): void | Promise<void>
}

function isDisposable(obj: any): obj is Disposable {
  return obj && typeof obj.dispose === 'function'
}

/**
 * Resolution context tracks the current dependency resolution path
 * for circular dependency detection and per-request scoping
 */
class ResolutionContext {
  private readonly resolvingStack: Set<Token<any>> = new Set()
  private readonly perRequestCache: Map<Token<any>, any> = new Map()
  private path?: string[] // Performance: Lazy initialization - only build when needed for error messages

  isResolving(token: Token<any>): boolean {
    return this.resolvingStack.has(token)
  }

  enterResolve(token: Token<any>): void {
    this.resolvingStack.add(token)
    // Performance: Don't build path unless we need it (only used in error messages)
    // This avoids expensive token.toString() calls on every resolve
  }

  exitResolve(token: Token<any>): void {
    this.resolvingStack.delete(token)
    // Performance: Clear lazy path cache when exiting
    this.path = undefined
  }

  getPath(): string[] {
    // Performance: Build path on-demand only when needed (typically for error messages)
    if (!this.path) {
      this.path = Array.from(this.resolvingStack).map(t => t.toString())
    }
    return [...this.path]
  }

  cachePerRequest(token: Token<any>, instance: any): void {
    this.perRequestCache.set(token, instance)
  }

  getPerRequest(token: Token<any>): any | undefined {
    return this.perRequestCache.get(token)
  }

  hasPerRequest(token: Token<any>): boolean {
    return this.perRequestCache.has(token)
  }

  /**
   * Reset context for reuse in object pool
   * Performance: Reusing contexts avoids heap allocations
   */
  reset(): void {
    this.resolvingStack.clear()
    this.perRequestCache.clear()
    this.path = undefined
  }
}

/**
 * Object pool for ResolutionContext instances
 * Performance: Reusing contexts reduces heap allocations and GC pressure
 */
class ResolutionContextPool {
  private pool: ResolutionContext[] = []
  private readonly maxSize = 10

  acquire(): ResolutionContext {
    const context = this.pool.pop()
    if (context) {
      // Reset existing context for reuse
      context.reset()
      return context
    }
    // Create new if pool empty
    return new ResolutionContext()
  }

  release(context: ResolutionContext): void {
    if (this.pool.length < this.maxSize) {
      this.pool.push(context)
    }
    // Otherwise let it be GC'd
  }
}

/**
 * Dependency Injection Container
 *
 * Manages registration and resolution of dependencies with support for:
 * - Multiple binding types (value, factory, class)
 * - Lifetime management (singleton, transient, per-request)
 * - Child containers with inheritance
 * - Circular dependency detection
 * - Automatic disposal
 */
export class Container {
  private readonly bindings: Map<Token<any>, Binding> = new Map()
  private readonly singletonCache: Map<Token<any>, any> = new Map()
  private readonly singletonOrder: Token<any>[] = []
  private readonly parent?: Container
  private currentContext?: ResolutionContext
  protected readonly interfaceRegistry: Map<string, Token<any>> = new Map()
  private bindingCache?: Map<Token<any>, Binding> // Performance: Flat cache of all bindings including parent chain
  private interfaceTokenCache: Map<string, Token<any>> = new Map() // Performance: Cache for resolveType() lookups
  private readonly fastTransientCache: Map<Token<any>, () => any> = new Map() // Performance: Fast path for simple transients
  private static contextPool = new ResolutionContextPool() // Performance: Pooled contexts reduce allocations
  private readonly ultraFastSingletonCache: Map<Token<any>, any> = new Map() // Performance: Ultra-fast singleton-only cache

  constructor(parent?: Container) {
    this.parent = parent
  }

  /**
   * Bind a pre-created value to a token
   */
  bindValue<T>(token: Token<T>, value: T): void {
    this.bindings.set(token, {
      type: 'value',
      lifetime: 'singleton',
      value,
      constructor: undefined
    })
    this.invalidateBindingCache()
  }

  /**
   * Bind a factory function to a token
   */
  bindFactory<T>(token: Token<T>, factory: Factory<T>, options?: BindingOptions): void {
    this.bindings.set(token, {
      type: 'factory',
      lifetime: options?.lifetime || 'transient',
      factory,
      dependencies: options?.dependencies,
      constructor: undefined
    })
    this.invalidateBindingCache()
  }

  /**
   * Bind a class constructor to a token
   */
  bindClass<T>(
    token: Token<T>,
    constructor: new (...args: any[]) => T,
    options?: BindingOptions
  ): void {
    const binding: Binding = {
      type: 'class',
      lifetime: options?.lifetime || 'transient',
      constructor,
      dependencies: options?.dependencies
    }
    this.bindings.set(token, binding)
    this.invalidateBindingCache()
    
    // Performance: Pre-compile fast transient factory for zero-dependency classes
    if (binding.lifetime === 'transient' && (!binding.dependencies || binding.dependencies.length === 0)) {
      this.fastTransientCache.set(token, () => new constructor())
    }
  }

  /**
   * Resolve a dependency synchronously
   * Performance optimized with multiple fast paths
   */
  resolve<T>(token: Token<T>): T {
    // Try all cache levels first (ultra-fast, singleton, fast transient)
    const cached = this.tryGetFromCaches(token)
    if (cached !== undefined) {
      return cached
    }

    // If we're already resolving (called from within a factory), reuse the context
    if (this.currentContext) {
      return this.resolveWithContext(token, this.currentContext)
    }

    // Complex resolution with pooled context
    const context = Container.contextPool.acquire()
    this.currentContext = context
    try {
      return this.resolveWithContext(token, context)
    } finally {
      this.currentContext = undefined
      Container.contextPool.release(context)
    }
  }

  /**
   * SPECIALIZED: Ultra-fast singleton resolve (no safety checks)
   * Use ONLY when you're 100% sure the token is a registered singleton
   * @internal For performance-critical paths only
   */
  resolveSingletonUnsafe<T>(token: Token<T>): T {
    // Direct return, no checks - maximum speed
    return this.ultraFastSingletonCache.get(token) ?? this.singletonCache.get(token)!
  }

  /**
   * SPECIALIZED: Fast transient resolve for zero-dependency classes
   * Skips all context creation and circular dependency checks
   * @internal For performance-critical paths only
   */
  resolveTransientSimple<T>(token: Token<T>): T {
    const factory = this.fastTransientCache.get(token)
    if (factory) {
      return factory() as T
    }
    // Fallback to regular resolve if not in fast cache
    return this.resolve(token)
  }

  /**
   * SPECIALIZED: Batch resolve multiple dependencies at once
   * More efficient than multiple individual resolves
   */
  resolveBatch<T extends readonly Token<any>[]>(
    tokens: T
  ): { [K in keyof T]: T[K] extends Token<infer U> ? U : never } {
    // Reuse single context for all resolutions
    const wasResolving = !!this.currentContext
    const context = this.currentContext || Container.contextPool.acquire()

    if (!wasResolving) {
      this.currentContext = context
    }

    try {
      const results = tokens.map(token => {
        // Try all cache levels first
        const cached = this.tryGetFromCaches(token)
        if (cached !== undefined) return cached

        // Full resolve with shared context
        return this.resolveWithContext(token, context)
      })

      return results as any
    } finally {
      if (!wasResolving) {
        this.currentContext = undefined
        Container.contextPool.release(context)
      }
    }
  }

  /**
   * Resolve a dependency asynchronously (supports async factories)
   */
  async resolveAsync<T>(token: Token<T>): Promise<T> {
    // If we're already resolving (called from within a factory), reuse the context
    if (this.currentContext) {
      return this.resolveAsyncWithContext(token, this.currentContext)
    }

    // New top-level resolve
    // Performance: Use pooled context to avoid heap allocation
    const context = Container.contextPool.acquire()
    this.currentContext = context
    try {
      return await this.resolveAsyncWithContext(token, context)
    } finally {
      this.currentContext = undefined
      Container.contextPool.release(context) // Return to pool for reuse
    }
  }

  /**
   * Try to get instance from all cache levels
   * Returns undefined if not cached
   * @internal
   */
  private tryGetFromCaches<T>(token: Token<T>): T | undefined {
    // Level 1: Ultra-fast singleton cache (zero overhead)
    const ultraFast = this.ultraFastSingletonCache.get(token)
    if (ultraFast !== undefined) {
      return ultraFast
    }

    // Level 2: Regular singleton cache
    if (this.singletonCache.has(token)) {
      const cached = this.singletonCache.get(token)
      // Promote to ultra-fast cache for next time
      this.ultraFastSingletonCache.set(token, cached)
      return cached
    }

    // Level 3: Fast transient cache (no dependencies)
    const fastFactory = this.fastTransientCache.get(token)
    if (fastFactory) {
      return fastFactory() as T
    }

    return undefined
  }

  /**
   * Cache instance based on lifetime strategy
   * @internal
   */
  private cacheInstance<T>(
    token: Token<T>,
    instance: T,
    lifetime: Lifetime,
    context?: ResolutionContext
  ): void {
    if (lifetime === 'singleton') {
      this.singletonCache.set(token, instance)
      this.singletonOrder.push(token)
      // Also add to ultra-fast cache
      this.ultraFastSingletonCache.set(token, instance)
    } else if (lifetime === 'per-request' && context) {
      context.cachePerRequest(token, instance)
    }
  }

  /**
   * Validate and get binding with circular dependency check
   * Returns binding or throws error
   * @internal
   */
  private validateAndGetBinding<T>(
    token: Token<T>,
    context: ResolutionContext
  ): Binding<T> {
    // Check circular dependency
    if (context.isResolving(token)) {
      throw new CircularDependencyError([...context.getPath(), token.toString()])
    }

    const binding = this.getBinding(token)
    if (!binding) {
      throw new BindingNotFoundError(token.toString(), context.getPath())
    }

    return binding
  }

  /**
   * Instantiate from binding synchronously
   * @internal
   */
  private instantiateBindingSync<T>(
    binding: Binding<T>,
    token: Token<T>,
    context: ResolutionContext
  ): T {
    switch (binding.type) {
      case 'value':
        return binding.value!

      case 'factory':
        const result = binding.factory!(this) as T
        if (result instanceof Promise) {
          throw new Error(
            `Async factory detected for ${token.toString()}. Use resolveAsync() instead.`
          )
        }
        return result

      case 'class':
        const deps = binding.dependencies || []
        const resolvedDeps = deps.map(dep => this.resolveWithContext(dep, context))
        return new binding.constructor!(...resolvedDeps)

      case 'inline-class':
        return new binding.constructor!()

      default:
        throw new Error(`Unknown binding type: ${(binding as any).type}`)
    }
  }

  /**
   * Instantiate from binding asynchronously
   * @internal
   */
  private async instantiateBindingAsync<T>(
    binding: Binding<T>,
    context: ResolutionContext
  ): Promise<T> {
    switch (binding.type) {
      case 'value':
        return binding.value!

      case 'factory':
        return await Promise.resolve(binding.factory!(this))

      case 'class':
        const deps = binding.dependencies || []
        const resolvedDeps = await Promise.all(
          deps.map(dep => this.resolveAsyncWithContext(dep, context))
        )
        return new binding.constructor!(...resolvedDeps)

      case 'inline-class':
        return new binding.constructor!()

      default:
        throw new Error(`Unknown binding type: ${(binding as any).type}`)
    }
  }

  /**
   * Create a child container that inherits bindings from this container
   */
  createChild(): Container {
    return new Container(this)
  }

  /**
   * Dispose all singleton instances in reverse registration order
   */
  async dispose(): Promise<void> {
    const errors: Error[] = []

    // Dispose in reverse order
    for (let i = this.singletonOrder.length - 1; i >= 0; i--) {
      const token = this.singletonOrder[i]
      const instance = this.singletonCache.get(token)

      if (instance && isDisposable(instance)) {
        try {
          await instance.dispose()
        } catch (error) {
          errors.push(error as Error)
          // Continue disposing other instances even if one fails
        }
      }
    }

    // Clear caches
    this.singletonCache.clear()
    this.singletonOrder.length = 0

    // Note: We don't throw errors to allow all disposals to complete
    // In production, you might want to log these errors
  }

  /**
   * Create a fluent builder for registering dependencies
   */
  builder(): Builder {
    return new Builder(this)
  }

  /**
   * Resolve a named service
   */
  resolveNamed<T>(name: string): T {
    const namedRegistrations = (this as any).__namedRegistrations
    if (!namedRegistrations) {
      throw new Error(`Named service "${name}" not found. No named registrations exist.`)
    }

    const config = namedRegistrations.get(name)
    if (!config) {
      throw new Error(`Named service "${name}" not found`)
    }

    return this.resolve(config.token)
  }

  /**
   * Resolve a keyed service
   */
  resolveKeyed<T>(key: string | symbol): T {
    const keyedRegistrations = (this as any).__keyedRegistrations
    if (!keyedRegistrations) {
      throw new Error(`Keyed service not found. No keyed registrations exist.`)
    }

    const config = keyedRegistrations.get(key)
    if (!config) {
      const keyStr = typeof key === 'symbol' ? key.toString() : `"${key}"`
      throw new Error(`Keyed service ${keyStr} not found`)
    }

    return this.resolve(config.token)
  }

  /**
   * Resolve all registrations for a token
   */
  resolveAll<T>(token: Token<T>): T[] {
    const multiRegistrations = (this as any).__multiRegistrations
    if (!multiRegistrations) {
      return []
    }

    const tokens = multiRegistrations.get(token)
    if (!tokens || tokens.length === 0) {
      return []
    }

    return tokens.map((t: Token<T>) => this.resolve(t))
  }

  /**
   * Get registry information for debugging/visualization
   * Returns array of binding information
   */
  getRegistry(): Array<{
    token: string
    type: 'value' | 'factory' | 'class' | 'inline-class'
    lifetime: Lifetime
    dependencies?: string[]
  }> {
    const registry: Array<{
      token: string
      type: 'value' | 'factory' | 'class' | 'inline-class'
      lifetime: Lifetime
      dependencies?: string[]
    }> = []

    this.bindings.forEach((binding, token) => {
      registry.push({
        token: token.description || token.symbol.toString(),
        type: binding.type,
        lifetime: binding.lifetime,
        dependencies: binding.dependencies?.map(
          d => d.description || d.symbol.toString()
        )
      })
    })

    return registry
  }

  /**
   * Get or create a token for an interface type
   * Uses a type name hash as key for the interface registry
   */
  interfaceToken<T>(typeName?: string): Token<T> {
    // Generate a unique key for this interface type
    // In production, this would be replaced by a TS transformer
    const key = typeName || `Interface_${Math.random().toString(36).substr(2, 9)}`

    // Check if token already exists in this container
    if (this.interfaceRegistry.has(key)) {
      return this.interfaceRegistry.get(key)!
    }

    // Check parent container (recursively through parent chain)
    if (this.parent) {
      // Recursively check through entire parent chain
      const parentToken = this.parent.interfaceToken<T>(key)
      // If parent created a new token, don't create another one
      return parentToken
    }

    // Create new token (only if no parent exists)
    const token = Token<T>(key)
    this.interfaceRegistry.set(key, token)
    return token
  }

  /**
   * Resolve a dependency by interface type without explicit token
   */
  resolveType<T>(typeName?: string): T {
    // Performance: Cache token lookups to avoid repeated interfaceRegistry access
    const key = typeName || ''
    let token = this.interfaceTokenCache.get(key)

    if (!token) {
      token = this.interfaceToken<T>(typeName)
      this.interfaceTokenCache.set(key, token)
    }

    return this.resolve(token)
  }

  /**
   * Resolve a keyed interface
   */
  resolveTypeKeyed<T>(key: string | symbol, _typeName?: string): T {
    // For keyed interfaces, we use the existing resolveKeyed mechanism
    return this.resolveKeyed<T>(key)
  }

  /**
   * Resolve all registrations for an interface type
   */
  resolveTypeAll<T>(typeName?: string): T[] {
    const token = this.interfaceToken<T>(typeName)
    return this.resolveAll(token)
  }

  /**
   * Internal: Resolve with context for circular dependency detection
   */
  private resolveWithContext<T>(token: Token<T>, context: ResolutionContext): T {
    // Validate and get binding (with circular dependency check)
    const binding = this.validateAndGetBinding(token, context)

    // Check per-request cache
    if (binding.lifetime === 'per-request' && context.hasPerRequest(token)) {
      return context.getPerRequest(token)
    }

    // Check singleton cache (local container only)
    if (binding.lifetime === 'singleton' && this.singletonCache.has(token)) {
      return this.singletonCache.get(token)
    }

    // Mark as resolving
    context.enterResolve(token)

    try {
      // Instantiate from binding
      const instance = this.instantiateBindingSync(binding, token, context)

      // Cache based on lifetime
      this.cacheInstance(token, instance, binding.lifetime, context)

      return instance
    } finally {
      context.exitResolve(token)
    }
  }

  /**
   * Internal: Async resolve with context
   */
  private async resolveAsyncWithContext<T>(
    token: Token<T>,
    context: ResolutionContext
  ): Promise<T> {
    // Validate and get binding (with circular dependency check)
    const binding = this.validateAndGetBinding(token, context)

    // Check per-request cache
    if (binding.lifetime === 'per-request' && context.hasPerRequest(token)) {
      return context.getPerRequest(token)
    }

    // Check singleton cache (local container only)
    if (binding.lifetime === 'singleton' && this.singletonCache.has(token)) {
      return this.singletonCache.get(token)
    }

    // Mark as resolving
    context.enterResolve(token)

    try {
      // Instantiate from binding asynchronously
      const instance = await this.instantiateBindingAsync(binding, context)

      // Cache based on lifetime
      this.cacheInstance(token, instance, binding.lifetime, context)

      return instance
    } finally {
      context.exitResolve(token)
    }
  }

  /**
   * Get binding from this container or parent chain
   * Performance optimized: Uses flat cache to avoid recursive parent lookups
   */
  private getBinding<T>(token: Token<T>): Binding<T> | undefined {
    // Build flat cache on first access
    if (!this.bindingCache) {
      this.buildBindingCache()
    }

    return this.bindingCache!.get(token)
  }

  /**
   * Build flat cache of all bindings including parent chain
   * This converts O(n) parent chain traversal to O(1) lookup
   */
  private buildBindingCache(): void {
    this.bindingCache = new Map()

    // Traverse parent chain and flatten all bindings
    let current: Container | undefined = this
    while (current) {
      current.bindings.forEach((binding, token) => {
        // Child bindings override parent bindings (first wins)
        if (!this.bindingCache!.has(token)) {
          this.bindingCache!.set(token, binding)
        }
      })
      current = current.parent
    }
  }

  /**
   * Invalidate binding cache when new bindings are added
   * Called by bindValue, bindFactory, bindClass
   */
  private invalidateBindingCache(): void {
    this.bindingCache = undefined
    this.ultraFastSingletonCache.clear() // Clear ultra-fast cache when bindings change
  }
}
