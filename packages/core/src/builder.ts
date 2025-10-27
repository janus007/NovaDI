/**
 * Fluent builder API for NovaDI Container (Autofac-style)
 */

import { Token } from './token.js'
import type { Container, Factory, Lifetime } from './container.js'
import { autowire } from './autowire.js'

/**
 * Represents a pending registration that hasn't been bound to a token yet
 */
interface PendingRegistration {
  type: 'type' | 'instance' | 'factory'
  value: any
  factory?: Factory<any>
  constructor?: new (...args: any[]) => any
}

/**
 * Configuration for a completed registration
 */
interface RegistrationConfig {
  token: Token<any>
  type: 'type' | 'instance' | 'factory'
  value?: any
  factory?: Factory<any>
  constructor?: new (...args: any[]) => any
  lifetime: Lifetime
  name?: string
  key?: string | symbol
  isDefault?: boolean
  ifNotRegistered?: boolean
  additionalTokens?: Token<any>[]
  dependencies?: Token<any>[] | Record<string, Token<any> | any>
  parameterValues?: Record<string, any>
  interfaceType?: string
  autowireOptions?: AutoWireOptions
}

/**
 * Position-based type information for autowiring
 * Used by transformer to enable minification-safe autowiring
 * Stores both parameter name (for refactoring support) and position (for minification support)
 */
export interface PositionTypeMapping {
  parameterName: string
  index: number
  typeName: string
}

/**
 * AutoWire configuration options
 */
export interface AutoWireOptions {
  by?: 'paramName' | 'map' | 'class' | 'positionType'
  strict?: boolean

  /**
   * Manual map object with parameter names as keys
   * Note: mapResolvers provides better performance (O(1) array access)
   */
  map?: Record<string, ((c: Container) => any) | Token<any>>

  /**
   * Position-based metadata with parameter names (used for smart matching)
   * Note: mapResolvers provides better performance (O(1) array access)
   */
  positions?: PositionTypeMapping[]

  /**
   * Array of resolvers in parameter position order (transformer-generated)
   * Provides O(1) array access performance - minification-safe and refactoring-friendly
   * undefined entries indicate primitive types or parameters without DI
   */
  mapResolvers?: Array<((c: Container) => any) | Token<any> | undefined>
}

/**
 * Fluent registration builder returned after each registration method
 */
export class RegistrationBuilder<T> {
  private pending: PendingRegistration
  private configs: RegistrationConfig[] = []
  private defaultLifetime: Lifetime = 'transient'

  constructor(
    pending: PendingRegistration,
    private registrations: RegistrationConfig[]
  ) {
    this.pending = pending
  }

  /**
   * Bind this registration to a token
   * Accepts tokens of supertypes (contravariant) for interface-based DI
   */
  as<U = T>(token: Token<U>): this {
    const config: RegistrationConfig = {
      token,
      type: this.pending.type,
      value: this.pending.value,
      factory: this.pending.factory,
      constructor: this.pending.constructor,
      lifetime: this.defaultLifetime
    }

    this.configs.push(config)
    this.registrations.push(config)
    return this
  }

  /**
   * Register as an interface type (Autofac-style)
   * Uses interface registry for token management
   */
  asInterface<_TInterface = any>(typeName?: string): this {
    // Defer token creation to build time when container is available
    const config: RegistrationConfig = {
      token: null as any, // Will be set during build()
      type: this.pending.type,
      value: this.pending.value,
      factory: this.pending.factory,
      constructor: this.pending.constructor,
      lifetime: this.defaultLifetime,
      interfaceType: typeName
    }

    this.configs.push(config)
    this.registrations.push(config)
    return this
  }

  /**
   * Register as default implementation for an interface
   * Combines asInterface() + asDefault()
   */
  asDefaultInterface<TInterface>(typeName?: string): this {
    this.asInterface<TInterface>(typeName)
    return this.asDefault()
  }

  /**
   * Register as a keyed interface implementation
   * Combines asInterface() + keyed()
   */
  asKeyedInterface<TInterface>(key: string | symbol, typeName?: string): this {
    this.asInterface<TInterface>(typeName)
    return this.keyed(key)
  }

  /**
   * Register as multiple implemented interfaces
   */
  asImplementedInterfaces(tokens: Token<any>[]): this {
    if (tokens.length === 0) {
      return this
    }

    // If there are existing configs (from previous as() calls), add these as additional interfaces
    if (this.configs.length > 0) {
      // Add all tokens as additional interfaces to existing configs
      for (const config of this.configs) {
        config.lifetime = 'singleton' // asImplementedInterfaces defaults to singleton
        config.additionalTokens = config.additionalTokens || []
        config.additionalTokens.push(...tokens)
      }
      return this
    }

    // No existing configs, create new one with first token
    const firstConfig: RegistrationConfig = {
      token: tokens[0],
      type: this.pending.type,
      value: this.pending.value,
      factory: this.pending.factory,
      constructor: this.pending.constructor,
      lifetime: 'singleton'
    }

    this.configs.push(firstConfig)
    this.registrations.push(firstConfig)

    // Additional tokens reference the same registration
    for (let i = 1; i < tokens.length; i++) {
      firstConfig.additionalTokens = firstConfig.additionalTokens || []
      firstConfig.additionalTokens.push(tokens[i])
    }

    return this
  }

  /**
   * Set singleton lifetime (one instance for entire container)
   */
  singleInstance(): this {
    for (const config of this.configs) {
      config.lifetime = 'singleton'
    }
    return this
  }

  /**
   * Set per-request lifetime (one instance per resolve call tree)
   */
  instancePerRequest(): this {
    for (const config of this.configs) {
      config.lifetime = 'per-request'
    }
    return this
  }

  /**
   * Set transient lifetime (new instance every time)
   * Alias for default behavior
   */
  instancePerDependency(): this {
    for (const config of this.configs) {
      config.lifetime = 'transient'
    }
    return this
  }

  /**
   * Name this registration for named resolution
   */
  named(name: string): this {
    for (const config of this.configs) {
      config.name = name
    }
    return this
  }

  /**
   * Key this registration for keyed resolution
   */
  keyed(key: string | symbol): this {
    for (const config of this.configs) {
      config.key = key
    }
    return this
  }

  /**
   * Mark this as default registration
   * Default registrations don't override existing ones
   */
  asDefault(): this {
    for (const config of this.configs) {
      config.isDefault = true
    }
    return this
  }

  /**
   * Only register if token not already registered
   */
  ifNotRegistered(): this {
    for (const config of this.configs) {
      config.ifNotRegistered = true
    }
    return this
  }

  /**
   * Specify parameter values for constructor (primitives and constants)
   * Use this for non-DI parameters like strings, numbers, config values
   */
  withParameters(parameters: Record<string, any>): this {
    for (const config of this.configs) {
      config.parameterValues = parameters
    }
    return this
  }

  /**
   * Enable automatic dependency injection (autowiring)
   * Supports three strategies: paramName (default), map, and class
   *
   * @example
   * ```ts
   * // Strategy 1: paramName (default, requires non-minified code in dev)
   * builder.registerType(EventBus).asInterface<IEventBus>().autoWire()
   *
   * // Strategy 2: map (minify-safe, explicit)
   * builder.registerType(EventBus).asInterface<IEventBus>().autoWire({
   *   map: {
   *     logger: (c) => c.resolveInterface<ILogger>()
   *   }
   * })
   *
   * // Strategy 3: class (requires build-time codegen)
   * builder.registerType(EventBus).asInterface<IEventBus>().autoWire({ by: 'class' })
   * ```
   */
  autoWire(options?: AutoWireOptions): this {
    for (const config of this.configs) {
      config.autowireOptions = options || { by: 'paramName', strict: false }
    }
    return this
  }
}

/**
 * Module function type - allows organizing registrations
 */
export type Module = (builder: Builder) => void

/**
 * Fluent builder for Container configuration
 */
export class Builder {
  private registrations: RegistrationConfig[] = []

  constructor(private readonly baseContainer: Container) {}

  /**
   * Register a class constructor
   */
  registerType<T>(constructor: new (...args: any[]) => T): RegistrationBuilder<T> {
    const pending: PendingRegistration = {
      type: 'type',
      value: null,
      constructor
    }

    return new RegistrationBuilder(pending, this.registrations)
  }

  /**
   * Register a pre-created instance
   */
  registerInstance<T>(instance: T): RegistrationBuilder<T> {
    const pending: PendingRegistration = {
      type: 'instance',
      value: instance,
      constructor: undefined
    }

    return new RegistrationBuilder(pending, this.registrations)
  }

  /**
   * Register a factory function
   */
  register<T>(factory: Factory<T>): RegistrationBuilder<T> {
    const pending: PendingRegistration = {
      type: 'factory',
      value: null,
      factory,
      constructor: undefined
    }

    return new RegistrationBuilder(pending, this.registrations)
  }

  /**
   * Register a module (function that adds multiple registrations)
   */
  module(moduleFunc: Module): this {
    moduleFunc(this)
    return this
  }

  /**
   * Build the container with all registered bindings
   */
  build(): Container {
    // Create new container inheriting from base
    const container = this.baseContainer.createChild()

    // Pre-process: resolve interface types to tokens
    for (const config of this.registrations) {
      if (config.interfaceType !== undefined && !config.token) {
        config.token = container.interfaceToken(config.interfaceType)
      }
    }

    // Track what's been registered for ifNotRegistered checks
    const registeredTokens = new Set<Token<any>>()
    const namedRegistrations = new Map<string, any>()
    const keyedRegistrations = new Map<string | symbol, any>()
    const multiRegistrations = new Map<Token<any>, Token<any>[]>()

    // Pre-process: identify tokens that have non-default registrations (unnamed, unkeyed)
    const tokensWithNonDefaults = new Set<Token<any>>()
    for (const config of this.registrations) {
      if (!config.isDefault && !config.name && config.key === undefined) {
        tokensWithNonDefaults.add(config.token)
      }
    }

    for (const config of this.registrations) {
      // Skip default registrations if there's a non-default for the same token
      if (config.isDefault && !config.name && config.key === undefined && tokensWithNonDefaults.has(config.token)) {
        continue
      }

      // Handle ifNotRegistered
      if (config.ifNotRegistered && registeredTokens.has(config.token)) {
        continue
      }

      // Handle asDefault
      if (config.isDefault && registeredTokens.has(config.token)) {
        continue
      }

      // Determine which token to use for binding
      // Create a unique internal token for each registration to avoid conflicts
      let bindingToken: Token<any>

      if (config.name) {
        // Named registration gets unique token
        bindingToken = Token(`__named_${config.name}`)
        namedRegistrations.set(config.name, { ...config, token: bindingToken })
      } else if (config.key !== undefined) {
        // Keyed registration gets unique token
        const keyStr = typeof config.key === 'symbol' ? config.key.toString() : config.key
        bindingToken = Token(`__keyed_${keyStr}`)
        keyedRegistrations.set(config.key, { ...config, token: bindingToken })
      } else {
        // Multi-registration handling
        if (multiRegistrations.has(config.token)) {
          // Subsequent registration for this token
          bindingToken = Token(`__multi_${config.token.toString()}_${multiRegistrations.get(config.token)!.length}`)
        } else {
          // First registration for this token, use the original token
          bindingToken = config.token
          multiRegistrations.set(config.token, [])
        }
        // Track this binding token for resolveAll
        multiRegistrations.get(config.token)!.push(bindingToken)
      }

      // Apply registration to container using the binding token
      this.applyRegistration(container, { ...config, token: bindingToken })

      // Mark original token as registered
      registeredTokens.add(config.token)

      // Register additional interfaces
      if (config.additionalTokens) {
        for (const additionalToken of config.additionalTokens) {
          // Create a factory that resolves the binding token
          container.bindFactory(
            additionalToken,
            (c) => c.resolve(bindingToken),
            { lifetime: config.lifetime }
          )
          registeredTokens.add(additionalToken)
        }
      }
    }

    // Attach metadata for named/keyed resolution
    ;(container as any).__namedRegistrations = namedRegistrations
    ;(container as any).__keyedRegistrations = keyedRegistrations
    ;(container as any).__multiRegistrations = multiRegistrations

    return container
  }

  private applyRegistration(container: Container, config: RegistrationConfig): void {
    const options = { lifetime: config.lifetime }

    switch (config.type) {
      case 'instance':
        container.bindValue(config.token, config.value)
        break

      case 'factory':
        container.bindFactory(config.token, config.factory!, options)
        break

      case 'type':
        // Performance optimization: Detect constructors with no dependencies
        const constructorStr = config.constructor!.toString()
        const hasNoDependencies = !constructorStr.match(/constructor\s*\([^)]+\)/)

        if (hasNoDependencies && !config.autowireOptions && !config.parameterValues) {
          // Constructor has no dependencies - optimize for both singleton and transient
          if (config.lifetime === 'singleton') {
            // Singleton: Create instance directly (fastest path - no factory overhead)
            const instance = new config.constructor!()
            container.bindValue(config.token, instance)
          } else if (config.lifetime === 'transient') {
            // Transient Fast Path: Register in fast transient cache
            // Skips ResolutionContext allocation for maximum performance
            const ctor = config.constructor!
            const fastFactory = () => new ctor()
            ;(container as any).fastTransientCache.set(config.token, fastFactory)

            // Also register in normal bindings as fallback
            container.bindFactory(config.token, fastFactory, options)
          } else {
            // Per-request: Use simple factory without autowire overhead
            // This avoids parameter extraction and reflection on every resolve
            const factory: Factory<any> = () => new config.constructor!()
            container.bindFactory(config.token, factory, options)
          }
        } else if (config.autowireOptions) {
          // Handle autowiring
          const factory: Factory<any> = (c) => {
            const resolvedDeps = autowire(config.constructor!, c, config.autowireOptions)
            return new config.constructor!(...resolvedDeps)
          }
          container.bindFactory(config.token, factory, options)
        } else if (config.parameterValues) {
          // Handle withParameters - inject primitive values
          const factory: Factory<any> = () => {
            const values = Object.values(config.parameterValues!)
            return new config.constructor!(...values)
          }
          container.bindFactory(config.token, factory, options)
        } else {
          // Use default autowiring strategy (paramName, non-strict)
          const factory: Factory<any> = (c) => {
            const resolvedDeps = autowire(config.constructor!, c, { by: 'paramName', strict: false })
            return new config.constructor!(...resolvedDeps)
          }
          container.bindFactory(config.token, factory, options)
        }
        break
    }
  }
}
