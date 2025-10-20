/**
 * Core dependency injection container for NovaDI
 */

import { Token } from './token'
import { BindingNotFoundError, CircularDependencyError } from './errors'
import { Builder } from './builder'

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
  private interfaceTokenCache: Map<string, Token<any>> = new Map() // Performance: Cache for resolveInterface() lookups
  private readonly fastTransientCache: Map<Token<any>, () => any> = new Map() // Performance: Fast path for simple transients
  private static contextPool = new ResolutionContextPool() // Performance: Pooled contexts reduce allocations

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
    this.bindings.set(token, {
      type: 'class',
      lifetime: options?.lifetime || 'transient',
      constructor,
      dependencies: options?.dependencies
    })
    this.invalidateBindingCache()
  }

  /**
   * Resolve a dependency synchronously
   */
  resolve<T>(token: Token<T>): T {
    // Performance: Fast path 1 - Cached singletons (skip ResolutionContext allocation)
    if (this.singletonCache.has(token)) {
      return this.singletonCache.get(token)
    }

    // Performance: Fast path 2 - Simple transients (NO dependencies, NO circular checks needed)
    // This optimization skips ResolutionContext allocation for simple transients
    const fastFactory = this.fastTransientCache.get(token)
    if (fastFactory) {
      return fastFactory() as T
    }

    // If we're already resolving (called from within a factory), reuse the context
    if (this.currentContext) {
      return this.resolveWithContext(token, this.currentContext)
    }

    // Slow path: Complex resolution with full ResolutionContext
    // Performance: Use pooled context to avoid heap allocation
    const context = Container.contextPool.acquire()
    this.currentContext = context
    try {
      return this.resolveWithContext(token, context)
    } finally {
      this.currentContext = undefined
      Container.contextPool.release(context) // Return to pool for reuse
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
    type: 'value' | 'factory' | 'class'
    lifetime: Lifetime
    dependencies?: string[]
  }> {
    const registry: Array<{
      token: string
      type: 'value' | 'factory' | 'class'
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
  resolveInterface<T>(typeName?: string): T {
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
  resolveInterfaceKeyed<T>(key: string | symbol, _typeName?: string): T {
    // For keyed interfaces, we use the existing resolveKeyed mechanism
    return this.resolveKeyed<T>(key)
  }

  /**
   * Resolve all registrations for an interface type
   */
  resolveInterfaceAll<T>(typeName?: string): T[] {
    const token = this.interfaceToken<T>(typeName)
    return this.resolveAll(token)
  }

  /**
   * Internal: Resolve with context for circular dependency detection
   */
  private resolveWithContext<T>(token: Token<T>, context: ResolutionContext): T {
    // Check circular dependency
    if (context.isResolving(token)) {
      throw new CircularDependencyError([...context.getPath(), token.toString()])
    }

    const binding = this.getBinding(token)
    if (!binding) {
      throw new BindingNotFoundError(token.toString(), context.getPath())
    }

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
      let instance: T

      switch (binding.type) {
        case 'value':
          instance = binding.value!
          break

        case 'factory':
          instance = binding.factory!(this) as T
          if (instance instanceof Promise) {
            throw new Error(
              `Async factory detected for ${token.toString()}. Use resolveAsync() instead.`
            )
          }
          break

        case 'class':
          const deps = binding.dependencies || []
          const resolvedDeps = deps.map(dep => this.resolveWithContext(dep, context))
          instance = new binding.constructor!(...resolvedDeps)
          break

        case 'inline-class':
          // Performance: Direct instantiation without function call overhead
          instance = new binding.constructor!()
          break

        default:
          throw new Error(`Unknown binding type: ${(binding as any).type}`)
      }

      // Cache based on lifetime
      if (binding.lifetime === 'singleton') {
        this.singletonCache.set(token, instance)
        this.singletonOrder.push(token)
      } else if (binding.lifetime === 'per-request') {
        context.cachePerRequest(token, instance)
      }

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
    // Check circular dependency
    if (context.isResolving(token)) {
      throw new CircularDependencyError([...context.getPath(), token.toString()])
    }

    const binding = this.getBinding(token)
    if (!binding) {
      throw new BindingNotFoundError(token.toString(), context.getPath())
    }

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
      let instance: T

      switch (binding.type) {
        case 'value':
          instance = binding.value!
          break

        case 'factory':
          instance = await Promise.resolve(binding.factory!(this))
          break

        case 'class':
          const deps = binding.dependencies || []
          const resolvedDeps = await Promise.all(
            deps.map(dep => this.resolveAsyncWithContext(dep, context))
          )
          instance = new binding.constructor!(...resolvedDeps)
          break

        case 'inline-class':
          // Performance: Direct instantiation without function call overhead
          instance = new binding.constructor!()
          break

        default:
          throw new Error(`Unknown binding type: ${(binding as any).type}`)
      }

      // Cache based on lifetime
      if (binding.lifetime === 'singleton') {
        this.singletonCache.set(token, instance)
        this.singletonOrder.push(token)
      } else if (binding.lifetime === 'per-request') {
        context.cachePerRequest(token, instance)
      }

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
  }
}
