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

type BindingType = 'value' | 'factory' | 'class'

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
  private readonly path: string[] = []

  isResolving(token: Token<any>): boolean {
    return this.resolvingStack.has(token)
  }

  enterResolve(token: Token<any>): void {
    this.resolvingStack.add(token)
    this.path.push(token.toString())
  }

  exitResolve(token: Token<any>): void {
    this.resolvingStack.delete(token)
    this.path.pop()
  }

  getPath(): string[] {
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
  private readonly interfaceRegistry: Map<string, Token<any>> = new Map()

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
  }

  /**
   * Resolve a dependency synchronously
   */
  resolve<T>(token: Token<T>): T {
    // If we're already resolving (called from within a factory), reuse the context
    if (this.currentContext) {
      return this.resolveWithContext(token, this.currentContext)
    }

    // New top-level resolve
    const context = new ResolutionContext()
    this.currentContext = context
    try {
      return this.resolveWithContext(token, context)
    } finally {
      this.currentContext = undefined
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
    const context = new ResolutionContext()
    this.currentContext = context
    try {
      return await this.resolveAsyncWithContext(token, context)
    } finally {
      this.currentContext = undefined
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

    // Check parent container
    if (this.parent) {
      const parentToken = (this.parent as any).interfaceRegistry?.get(key)
      if (parentToken) {
        return parentToken
      }
    }

    // Create new token
    const token = Token<T>(key)
    this.interfaceRegistry.set(key, token)
    return token
  }

  /**
   * Resolve a dependency by interface type without explicit token
   */
  resolveInterface<T>(typeName?: string): T {
    const token = this.interfaceToken<T>(typeName)
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
   */
  private getBinding<T>(token: Token<T>): Binding<T> | undefined {
    const binding = this.bindings.get(token)
    if (binding) {
      return binding
    }

    // Check parent container
    if (this.parent) {
      return this.parent.getBinding(token)
    }

    return undefined
  }
}
