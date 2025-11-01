(function () {
    'use strict';

    let tokenCounter = 0;
    /**
     * Creates a new unique token for dependency injection.
     *
     * @param description Optional description for debugging purposes
     * @returns A unique token that can be used as a Map key
     *
     * @example
     * ```ts
     * interface ILogger { log(msg: string): void }
     * const LoggerToken = Token<ILogger>('Logger')
     * ```
     */
    function Token$1(description) {
        const id = ++tokenCounter;
        const sym = Symbol(description ? `Token(${description})` : `Token#${id}`);
        const token = {
            symbol: sym,
            description,
            toString() {
                return description
                    ? `Token<${description}>`
                    : `Token<#${id}>`;
            }
        };
        return token;
    }

    /**
     * Error classes for NovaDI container
     */
    class ContainerError extends Error {
        constructor(message) {
            super(message);
            this.name = 'ContainerError';
        }
    }
    class BindingNotFoundError extends ContainerError {
        constructor(tokenDescription, path = []) {
            const pathStr = path.length > 0 ? `\n  Dependency path: ${path.join(' -> ')}` : '';
            super(`Token "${tokenDescription}" is not bound or registered in the container.${pathStr}`);
            this.name = 'BindingNotFoundError';
        }
    }
    class CircularDependencyError extends ContainerError {
        constructor(path) {
            super(`Circular dependency detected: ${path.join(' -> ')}`);
            this.name = 'CircularDependencyError';
        }
    }

    /**
     * AutoWire - Automatic dependency injection for NovaDI
     * Supports three strategies: paramName, map, and class
     */
    /**
     * Performance: Cache extracted parameter names to avoid repeated regex parsing
     * WeakMap allows garbage collection when constructor is no longer referenced
     */
    const paramNameCache = new WeakMap();
    /**
     * Extract parameter names from a constructor function
     * Uses regex to parse the toString() representation
     * Performance optimized: Results are cached per constructor
     */
    function extractParameterNames(constructor) {
        // Check cache first - avoids expensive regex parsing
        const cached = paramNameCache.get(constructor);
        if (cached) {
            return cached;
        }
        // Extract parameter names (expensive operation)
        const fnStr = constructor.toString();
        // Match constructor(...args) or class { constructor(...args) }
        const match = fnStr.match(/constructor\s*\(([^)]*)\)/) || fnStr.match(/^[^(]*\(([^)]*)\)/);
        if (!match || !match[1]) {
            return [];
        }
        const params = match[1]
            .split(',')
            .map(param => param.trim())
            .filter(param => param.length > 0)
            .map(param => {
            // Remove default values, type annotations, and extract just the name
            let name = param.split(/[:=]/)[0].trim();
            // Remove TypeScript modifiers (public, private, protected, readonly)
            // Can appear multiple times, e.g., "public readonly service"
            name = name.replace(/^((public|private|protected|readonly)\s+)+/, '');
            // Handle destructuring - skip for now
            if (name.includes('{') || name.includes('[')) {
                return null;
            }
            return name;
        })
            .filter((name) => name !== null);
        // Cache result for future calls
        paramNameCache.set(constructor, params);
        return params;
    }
    /**
     * Resolve dependencies using paramName strategy
     * Matches parameter names to interface registry tokens
     */
    function resolveByParamName(constructor, container, options) {
        const paramNames = extractParameterNames(constructor);
        const resolvedDeps = [];
        for (const paramName of paramNames) {
            let resolved = undefined;
            let foundMatch = false;
            // Try multiple naming conventions to match TypeScript interfaces
            const namesToTry = [
                paramName, // Direct: "logger"
                capitalize(paramName), // Capitalized: "Logger"
                'I' + capitalize(paramName) // Interface convention: "ILogger"
            ];
            for (const name of namesToTry) {
                try {
                    resolved = container.resolveInterface(name);
                    foundMatch = true;
                    break;
                }
                catch {
                    // Try next naming convention
                }
            }
            if (foundMatch) {
                resolvedDeps.push(resolved);
            }
            else if (options.strict) {
                throw new Error(`Cannot resolve parameter "${paramName}" on ${constructor.name}. ` +
                    `No interface registration found. Tried: ${namesToTry.join(', ')}. ` +
                    `Suggestions:\n` +
                    `  - Use .autoWire({ map: { ${paramName}: (c) => c.resolveInterface<I${capitalize(paramName)}>() } })\n` +
                    `  - Register the interface with .asInterface<I${capitalize(paramName)}>()\n` +
                    `  - Mark a default implementation with .asDefaultInterface<I${capitalize(paramName)}>()`);
            }
            else {
                // Non-strict mode: silently push undefined for unresolvable parameters
                // This is expected behavior: parameters that can't be resolved are typically
                // primitive types (string, number, etc.) that should use .withParameters()
                // instead of dependency injection
                resolvedDeps.push(undefined);
            }
        }
        return resolvedDeps;
    }
    /**
     * Resolve dependencies using map strategy
     * Uses explicit mapping from parameter names to resolvers
     */
    function resolveByMap(constructor, container, options) {
        if (!options.map) {
            throw new Error('AutoWire map strategy requires options.map to be defined');
        }
        const paramNames = extractParameterNames(constructor);
        const resolvedDeps = [];
        for (const paramName of paramNames) {
            const resolver = options.map[paramName];
            if (resolver === undefined) {
                if (options.strict) {
                    throw new Error(`Cannot resolve parameter "${paramName}" on ${constructor.name}. ` +
                        `Not found in autowire map. ` +
                        `Add it to the map: .autoWire({ map: { ${paramName}: ... } })`);
                }
                else {
                    // Silently push undefined for missing parameters
                    // This is expected: transformer filters out primitive types at compile-time,
                    // so missing params are typically primitives that don't need DI resolution
                    resolvedDeps.push(undefined);
                }
                continue;
            }
            // Resolver can be a function or a Token
            if (typeof resolver === 'function') {
                resolvedDeps.push(resolver(container));
            }
            else {
                // Assume it's a Token
                resolvedDeps.push(container.resolve(resolver));
            }
        }
        return resolvedDeps;
    }
    /**
     * Resolve dependencies using class strategy
     * Requires build-time codegen to work properly
     */
    function resolveByClass(_constructor, _container, _options) {
        throw new Error(`AutoWire strategy 'class' requires build-time code generation. ` +
            `The 'class' strategy uses TypeScript AST analysis to extract parameter types ` +
            `and generate an explicit autowire map at build time. ` +
            `\n\nOptions:\n` +
            `  1. Use 'paramName' strategy (default): .autoWire({ by: 'paramName' })\n` +
            `  2. Use 'map' strategy (minify-safe): .autoWire({ map: { param: resolver } })\n` +
            `  3. Set up NovaDI transformer/plugin for build-time 'class' support (coming soon)`);
    }
    /**
     * Main autowire function - dispatches to appropriate strategy
     */
    function autowire(constructor, container, options) {
        const opts = {
            by: 'paramName',
            strict: false,
            ...options
        };
        // Performance: Early exit for constructors with no parameters
        const paramNames = extractParameterNames(constructor);
        if (paramNames.length === 0) {
            return [];
        }
        // Map strategy has highest priority if map is provided
        if (opts.map && Object.keys(opts.map).length > 0) {
            return resolveByMap(constructor, container, opts);
        }
        // Dispatch to selected strategy
        switch (opts.by) {
            case 'paramName':
                return resolveByParamName(constructor, container, opts);
            case 'map':
                return resolveByMap(constructor, container, opts);
            case 'class':
                return resolveByClass();
            default:
                throw new Error(`Unknown autowire strategy: ${opts.by}`);
        }
    }
    /**
     * Helper: capitalize first letter
     */
    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Fluent builder API for NovaDI Container (Autofac-style)
     */
    /**
     * Fluent registration builder returned after each registration method
     */
    class RegistrationBuilder {
        constructor(pending, registrations) {
            this.registrations = registrations;
            this.configs = [];
            this.defaultLifetime = 'singleton';
            this.pending = pending;
        }
        /**
         * Bind this registration to a token
         * Accepts tokens of supertypes (contravariant) for interface-based DI
         */
        as(token) {
            const config = {
                token,
                type: this.pending.type,
                value: this.pending.value,
                factory: this.pending.factory,
                constructor: this.pending.constructor,
                lifetime: this.defaultLifetime
            };
            this.configs.push(config);
            this.registrations.push(config);
            return this;
        }
        /**
         * Register as an interface type (Autofac-style)
         * Uses interface registry for token management
         */
        asInterface(typeName) {
            // Defer token creation to build time when container is available
            const config = {
                token: null, // Will be set during build()
                type: this.pending.type,
                value: this.pending.value,
                factory: this.pending.factory,
                constructor: this.pending.constructor,
                lifetime: this.defaultLifetime,
                interfaceType: typeName
            };
            this.configs.push(config);
            this.registrations.push(config);
            return this;
        }
        /**
         * Register as default implementation for an interface
         * Combines asInterface() + asDefault()
         */
        asDefaultInterface(typeName) {
            this.asInterface("TInterface", typeName);
            return this.asDefault();
        }
        /**
         * Register as a keyed interface implementation
         * Combines asInterface() + keyed()
         */
        asKeyedInterface(key, typeName) {
            this.asInterface("TInterface", typeName);
            return this.keyed(key);
        }
        /**
         * Register as multiple implemented interfaces
         */
        asImplementedInterfaces(tokens) {
            if (tokens.length === 0) {
                return this;
            }
            // If there are existing configs (from previous as() calls), add these as additional interfaces
            if (this.configs.length > 0) {
                // Add all tokens as additional interfaces to existing configs
                for (const config of this.configs) {
                    config.lifetime = 'singleton'; // asImplementedInterfaces defaults to singleton
                    config.additionalTokens = config.additionalTokens || [];
                    config.additionalTokens.push(...tokens);
                }
                return this;
            }
            // No existing configs, create new one with first token
            const firstConfig = {
                token: tokens[0],
                type: this.pending.type,
                value: this.pending.value,
                factory: this.pending.factory,
                constructor: this.pending.constructor,
                lifetime: 'singleton'
            };
            this.configs.push(firstConfig);
            this.registrations.push(firstConfig);
            // Additional tokens reference the same registration
            for (let i = 1; i < tokens.length; i++) {
                firstConfig.additionalTokens = firstConfig.additionalTokens || [];
                firstConfig.additionalTokens.push(tokens[i]);
            }
            return this;
        }
        /**
         * Set singleton lifetime (one instance for entire container)
         */
        singleInstance() {
            for (const config of this.configs) {
                config.lifetime = 'singleton';
            }
            return this;
        }
        /**
         * Set per-request lifetime (one instance per resolve call tree)
         */
        instancePerRequest() {
            for (const config of this.configs) {
                config.lifetime = 'per-request';
            }
            return this;
        }
        /**
         * Set transient lifetime (new instance every time)
         * Alias for default behavior
         */
        instancePerDependency() {
            for (const config of this.configs) {
                config.lifetime = 'transient';
            }
            return this;
        }
        /**
         * Name this registration for named resolution
         */
        named(name) {
            for (const config of this.configs) {
                config.name = name;
            }
            return this;
        }
        /**
         * Key this registration for keyed resolution
         */
        keyed(key) {
            for (const config of this.configs) {
                config.key = key;
            }
            return this;
        }
        /**
         * Mark this as default registration
         * Default registrations don't override existing ones
         */
        asDefault() {
            for (const config of this.configs) {
                config.isDefault = true;
            }
            return this;
        }
        /**
         * Only register if token not already registered
         */
        ifNotRegistered() {
            for (const config of this.configs) {
                config.ifNotRegistered = true;
            }
            return this;
        }
        /**
         * Specify parameter values for constructor (primitives and constants)
         * Use this for non-DI parameters like strings, numbers, config values
         */
        withParameters(parameters) {
            for (const config of this.configs) {
                config.parameterValues = parameters;
            }
            return this;
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
        autoWire(options) {
            for (const config of this.configs) {
                config.autowireOptions = options || { by: 'paramName', strict: false };
            }
            return this;
        }
    }
    /**
     * Fluent builder for Container configuration
     */
    class Builder {
        constructor(baseContainer) {
            this.baseContainer = baseContainer;
            this.registrations = [];
        }
        /**
         * Register a class constructor
         */
        registerType(constructor) {
            const pending = {
                type: 'type',
                value: null,
                constructor
            };
            return new RegistrationBuilder(pending, this.registrations);
        }
        /**
         * Register a pre-created instance
         */
        registerInstance(instance) {
            const pending = {
                type: 'instance',
                value: instance,
                constructor: undefined
            };
            return new RegistrationBuilder(pending, this.registrations);
        }
        /**
         * Register a factory function
         */
        register(factory) {
            const pending = {
                type: 'factory',
                value: null,
                factory,
                constructor: undefined
            };
            return new RegistrationBuilder(pending, this.registrations);
        }
        /**
         * Register a module (function that adds multiple registrations)
         */
        module(moduleFunc) {
            moduleFunc(this);
            return this;
        }
        /**
         * Build the container with all registered bindings
         */
        build() {
            // Create new container inheriting from base
            const container = this.baseContainer.createChild();
            // Pre-process: resolve interface types to tokens
            for (const config of this.registrations) {
                if (config.interfaceType !== undefined && !config.token) {
                    config.token = container.interfaceToken(config.interfaceType);
                }
            }
            // Track what's been registered for ifNotRegistered checks
            const registeredTokens = new Set();
            const namedRegistrations = new Map();
            const keyedRegistrations = new Map();
            const multiRegistrations = new Map();
            // Pre-process: identify tokens that have non-default registrations (unnamed, unkeyed)
            const tokensWithNonDefaults = new Set();
            for (const config of this.registrations) {
                if (!config.isDefault && !config.name && config.key === undefined) {
                    tokensWithNonDefaults.add(config.token);
                }
            }
            for (const config of this.registrations) {
                // Skip default registrations if there's a non-default for the same token
                if (config.isDefault && !config.name && config.key === undefined && tokensWithNonDefaults.has(config.token)) {
                    continue;
                }
                // Handle ifNotRegistered
                if (config.ifNotRegistered && registeredTokens.has(config.token)) {
                    continue;
                }
                // Handle asDefault
                if (config.isDefault && registeredTokens.has(config.token)) {
                    continue;
                }
                // Determine which token to use for binding
                // Create a unique internal token for each registration to avoid conflicts
                let bindingToken;
                if (config.name) {
                    // Named registration gets unique token
                    bindingToken = Token$1(`__named_${config.name}`);
                    namedRegistrations.set(config.name, { ...config, token: bindingToken });
                }
                else if (config.key !== undefined) {
                    // Keyed registration gets unique token
                    const keyStr = typeof config.key === 'symbol' ? config.key.toString() : config.key;
                    bindingToken = Token$1(`__keyed_${keyStr}`);
                    keyedRegistrations.set(config.key, { ...config, token: bindingToken });
                }
                else {
                    // Multi-registration handling
                    if (multiRegistrations.has(config.token)) {
                        // Subsequent registration for this token
                        bindingToken = Token$1(`__multi_${config.token.toString()}_${multiRegistrations.get(config.token).length}`);
                    }
                    else {
                        // First registration for this token, use the original token
                        bindingToken = config.token;
                        multiRegistrations.set(config.token, []);
                    }
                    // Track this binding token for resolveAll
                    multiRegistrations.get(config.token).push(bindingToken);
                }
                // Apply registration to container using the binding token
                this.applyRegistration(container, { ...config, token: bindingToken });
                // Mark original token as registered
                registeredTokens.add(config.token);
                // Register additional interfaces
                if (config.additionalTokens) {
                    for (const additionalToken of config.additionalTokens) {
                        // Create a factory that resolves the binding token
                        container.bindFactory(additionalToken, (c) => c.resolve(bindingToken), { lifetime: config.lifetime });
                        registeredTokens.add(additionalToken);
                    }
                }
            }
            container.__namedRegistrations = namedRegistrations;
            container.__keyedRegistrations = keyedRegistrations;
            container.__multiRegistrations = multiRegistrations;
            return container;
        }
        applyRegistration(container, config) {
            const options = { lifetime: config.lifetime };
            switch (config.type) {
                case 'instance':
                    container.bindValue(config.token, config.value);
                    break;
                case 'factory':
                    container.bindFactory(config.token, config.factory, options);
                    break;
                case 'type':
                    // Performance optimization: Detect constructors with no dependencies
                    const constructorStr = config.constructor.toString();
                    const hasNoDependencies = !constructorStr.match(/constructor\s*\([^)]+\)/);
                    if (hasNoDependencies && !config.autowireOptions && !config.parameterValues) {
                        // Constructor has no dependencies - optimize for both singleton and transient
                        if (config.lifetime === 'singleton') {
                            // Singleton: Create instance directly (fastest path - no factory overhead)
                            const instance = new config.constructor();
                            container.bindValue(config.token, instance);
                        }
                        else if (config.lifetime === 'transient') {
                            // Transient Fast Path: Register in fast transient cache
                            // Skips ResolutionContext allocation for maximum performance
                            const ctor = config.constructor;
                            const fastFactory = () => new ctor();
                            container.fastTransientCache.set(config.token, fastFactory);
                            // Also register in normal bindings as fallback
                            container.bindFactory(config.token, fastFactory, options);
                        }
                        else {
                            // Per-request: Use simple factory without autowire overhead
                            // This avoids parameter extraction and reflection on every resolve
                            const factory = () => new config.constructor();
                            container.bindFactory(config.token, factory, options);
                        }
                    }
                    else if (config.autowireOptions) {
                        // Handle autowiring
                        const factory = (c) => {
                            const resolvedDeps = autowire(config.constructor, c, config.autowireOptions);
                            return new config.constructor(...resolvedDeps);
                        };
                        container.bindFactory(config.token, factory, options);
                    }
                    else if (config.parameterValues) {
                        // Handle withParameters - inject primitive values
                        const factory = () => {
                            const values = Object.values(config.parameterValues);
                            return new config.constructor(...values);
                        };
                        container.bindFactory(config.token, factory, options);
                    }
                    else {
                        // Use default autowiring strategy (paramName, non-strict)
                        const factory = (c) => {
                            const resolvedDeps = autowire(config.constructor, c, { by: 'paramName', strict: false });
                            return new config.constructor(...resolvedDeps);
                        };
                        container.bindFactory(config.token, factory, options);
                    }
                    break;
            }
        }
    }

    /**
     * Core dependency injection container for NovaDI
     */
    function isDisposable$1(obj) {
        return obj && typeof obj.dispose === 'function';
    }
    /**
     * Resolution context tracks the current dependency resolution path
     * for circular dependency detection and per-request scoping
     */
    let ResolutionContext$1 = class ResolutionContext {
        constructor() {
            this.resolvingStack = new Set();
            this.perRequestCache = new Map();
        }
        isResolving(token) {
            return this.resolvingStack.has(token);
        }
        enterResolve(token) {
            this.resolvingStack.add(token);
            // Performance: Don't build path unless we need it (only used in error messages)
            // This avoids expensive token.toString() calls on every resolve
        }
        exitResolve(token) {
            this.resolvingStack.delete(token);
            // Performance: Clear lazy path cache when exiting
            this.path = undefined;
        }
        getPath() {
            // Performance: Build path on-demand only when needed (typically for error messages)
            if (!this.path) {
                this.path = Array.from(this.resolvingStack).map(t => t.toString());
            }
            return [...this.path];
        }
        cachePerRequest(token, instance) {
            this.perRequestCache.set(token, instance);
        }
        getPerRequest(token) {
            return this.perRequestCache.get(token);
        }
        hasPerRequest(token) {
            return this.perRequestCache.has(token);
        }
        /**
         * Reset context for reuse in object pool
         * Performance: Reusing contexts avoids heap allocations
         */
        reset() {
            this.resolvingStack.clear();
            this.perRequestCache.clear();
            this.path = undefined;
        }
    };
    /**
     * Object pool for ResolutionContext instances
     * Performance: Reusing contexts reduces heap allocations and GC pressure
     */
    class ResolutionContextPool {
        constructor() {
            this.pool = [];
            this.maxSize = 10;
        }
        acquire() {
            const context = this.pool.pop();
            if (context) {
                // Reset existing context for reuse
                context.reset();
                return context;
            }
            // Create new if pool empty
            return new ResolutionContext$1();
        }
        release(context) {
            if (this.pool.length < this.maxSize) {
                this.pool.push(context);
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
    let Container$2 = class Container {
        constructor(parent) {
            this.bindings = new Map();
            this.singletonCache = new Map();
            this.singletonOrder = [];
            this.interfaceRegistry = new Map();
            this.interfaceTokenCache = new Map(); // Performance: Cache for resolveInterface() lookups
            this.fastTransientCache = new Map(); // Performance: Fast path for simple transients
            this.ultraFastSingletonCache = new Map(); // Performance: Ultra-fast singleton-only cache
            this.parent = parent;
        }
        /**
         * Bind a pre-created value to a token
         */
        bindValue(token, value) {
            this.bindings.set(token, {
                type: 'value',
                lifetime: 'singleton',
                value,
                constructor: undefined
            });
            this.invalidateBindingCache();
        }
        /**
         * Bind a factory function to a token
         */
        bindFactory(token, factory, options) {
            this.bindings.set(token, {
                type: 'factory',
                lifetime: options?.lifetime || 'transient',
                factory,
                dependencies: options?.dependencies,
                constructor: undefined
            });
            this.invalidateBindingCache();
        }
        /**
         * Bind a class constructor to a token
         */
        bindClass(token, constructor, options) {
            const binding = {
                type: 'class',
                lifetime: options?.lifetime || 'transient',
                constructor,
                dependencies: options?.dependencies
            };
            this.bindings.set(token, binding);
            this.invalidateBindingCache();
            // Performance: Pre-compile fast transient factory for zero-dependency classes
            if (binding.lifetime === 'transient' && (!binding.dependencies || binding.dependencies.length === 0)) {
                this.fastTransientCache.set(token, () => new constructor());
            }
        }
        /**
         * Resolve a dependency synchronously
         * Performance optimized with multiple fast paths
         */
        resolve(token) {
            // Performance: ULTRA-FAST path - Direct singleton lookup (zero overhead)
            const ultraFast = this.ultraFastSingletonCache.get(token);
            if (ultraFast !== undefined) {
                return ultraFast; // ⚡ Instant return, no checks needed
            }
            // Performance: Fast path 1 - Cached singletons (skip ResolutionContext allocation)
            if (this.singletonCache.has(token)) {
                const cached = this.singletonCache.get(token);
                // Promote to ultra-fast cache for next time
                this.ultraFastSingletonCache.set(token, cached);
                return cached;
            }
            // Performance: Fast path 2 - Simple transients (NO dependencies, NO circular checks needed)
            // This optimization skips ResolutionContext allocation for simple transients
            const fastFactory = this.fastTransientCache.get(token);
            if (fastFactory) {
                return fastFactory();
            }
            // If we're already resolving (called from within a factory), reuse the context
            if (this.currentContext) {
                return this.resolveWithContext(token, this.currentContext);
            }
            // Slow path: Complex resolution with full ResolutionContext
            // Performance: Use pooled context to avoid heap allocation
            const context = Container.contextPool.acquire();
            this.currentContext = context;
            try {
                return this.resolveWithContext(token, context);
            }
            finally {
                this.currentContext = undefined;
                Container.contextPool.release(context); // Return to pool for reuse
            }
        }
        /**
         * SPECIALIZED: Ultra-fast singleton resolve (no safety checks)
         * Use ONLY when you're 100% sure the token is a registered singleton
         * @internal For performance-critical paths only
         */
        resolveSingletonUnsafe(token) {
            // Direct return, no checks - maximum speed
            return this.ultraFastSingletonCache.get(token) ?? this.singletonCache.get(token);
        }
        /**
         * SPECIALIZED: Fast transient resolve for zero-dependency classes
         * Skips all context creation and circular dependency checks
         * @internal For performance-critical paths only
         */
        resolveTransientSimple(token) {
            const factory = this.fastTransientCache.get(token);
            if (factory) {
                return factory();
            }
            // Fallback to regular resolve if not in fast cache
            return this.resolve(token);
        }
        /**
         * SPECIALIZED: Batch resolve multiple dependencies at once
         * More efficient than multiple individual resolves
         */
        resolveBatch(tokens) {
            // Reuse single context for all resolutions
            const wasResolving = !!this.currentContext;
            const context = this.currentContext || Container.contextPool.acquire();
            if (!wasResolving) {
                this.currentContext = context;
            }
            try {
                const results = tokens.map(token => {
                    // Try ultra-fast cache first
                    const cached = this.ultraFastSingletonCache.get(token);
                    if (cached !== undefined)
                        return cached;
                    // Try singleton cache
                    const singleton = this.singletonCache.get(token);
                    if (singleton !== undefined) {
                        this.ultraFastSingletonCache.set(token, singleton);
                        return singleton;
                    }
                    // Try fast transient
                    const factory = this.fastTransientCache.get(token);
                    if (factory)
                        return factory();
                    // Full resolve with shared context
                    return this.resolveWithContext(token, context);
                });
                return results;
            }
            finally {
                if (!wasResolving) {
                    this.currentContext = undefined;
                    Container.contextPool.release(context);
                }
            }
        }
        /**
         * Resolve a dependency asynchronously (supports async factories)
         */
        async resolveAsync(token) {
            // If we're already resolving (called from within a factory), reuse the context
            if (this.currentContext) {
                return this.resolveAsyncWithContext(token, this.currentContext);
            }
            // New top-level resolve
            // Performance: Use pooled context to avoid heap allocation
            const context = Container.contextPool.acquire();
            this.currentContext = context;
            try {
                return await this.resolveAsyncWithContext(token, context);
            }
            finally {
                this.currentContext = undefined;
                Container.contextPool.release(context); // Return to pool for reuse
            }
        }
        /**
         * Create a child container that inherits bindings from this container
         */
        createChild() {
            return new Container(this);
        }
        /**
         * Dispose all singleton instances in reverse registration order
         */
        async dispose() {
            // Dispose in reverse order
            for (let i = this.singletonOrder.length - 1; i >= 0; i--) {
                const token = this.singletonOrder[i];
                const instance = this.singletonCache.get(token);
                if (instance && isDisposable$1(instance)) {
                    try {
                        await instance.dispose();
                    }
                    catch (error) {
                        // Continue disposing other instances even if one fails
                    }
                }
            }
            // Clear caches
            this.singletonCache.clear();
            this.singletonOrder.length = 0;
            // Note: We don't throw errors to allow all disposals to complete
            // In production, you might want to log these errors
        }
        /**
         * Create a fluent builder for registering dependencies
         */
        builder() {
            return new Builder(this);
        }
        /**
         * Resolve a named service
         */
        resolveNamed(name) {
            const namedRegistrations = this.__namedRegistrations;
            if (!namedRegistrations) {
                throw new Error(`Named service "${name}" not found. No named registrations exist.`);
            }
            const config = namedRegistrations.get(name);
            if (!config) {
                throw new Error(`Named service "${name}" not found`);
            }
            return this.resolve(config.token);
        }
        /**
         * Resolve a keyed service
         */
        resolveKeyed(key) {
            const keyedRegistrations = this.__keyedRegistrations;
            if (!keyedRegistrations) {
                throw new Error(`Keyed service not found. No keyed registrations exist.`);
            }
            const config = keyedRegistrations.get(key);
            if (!config) {
                const keyStr = typeof key === 'symbol' ? key.toString() : `"${key}"`;
                throw new Error(`Keyed service ${keyStr} not found`);
            }
            return this.resolve(config.token);
        }
        /**
         * Resolve all registrations for a token
         */
        resolveAll(token) {
            const multiRegistrations = this.__multiRegistrations;
            if (!multiRegistrations) {
                return [];
            }
            const tokens = multiRegistrations.get(token);
            if (!tokens || tokens.length === 0) {
                return [];
            }
            return tokens.map((t) => this.resolve(t));
        }
        /**
         * Get registry information for debugging/visualization
         * Returns array of binding information
         */
        getRegistry() {
            const registry = [];
            this.bindings.forEach((binding, token) => {
                registry.push({
                    token: token.description || token.symbol.toString(),
                    type: binding.type,
                    lifetime: binding.lifetime,
                    dependencies: binding.dependencies?.map(d => d.description || d.symbol.toString())
                });
            });
            return registry;
        }
        /**
         * Get or create a token for an interface type
         * Uses a type name hash as key for the interface registry
         */
        interfaceToken(typeName) {
            // Generate a unique key for this interface type
            // In production, this would be replaced by a TS transformer
            const key = typeName || `Interface_${Math.random().toString(36).substr(2, 9)}`;
            // Check if token already exists in this container
            if (this.interfaceRegistry.has(key)) {
                return this.interfaceRegistry.get(key);
            }
            // Check parent container (recursively through parent chain)
            if (this.parent) {
                // Recursively check through entire parent chain
                const parentToken = this.parent.interfaceToken(key);
                // If parent created a new token, don't create another one
                return parentToken;
            }
            // Create new token (only if no parent exists)
            const token = Token$1(key);
            this.interfaceRegistry.set(key, token);
            return token;
        }
        /**
         * Resolve a dependency by interface type without explicit token
         */
        resolveInterface(typeName) {
            // Performance: Cache token lookups to avoid repeated interfaceRegistry access
            const key = typeName || '';
            let token = this.interfaceTokenCache.get(key);
            if (!token) {
                token = this.interfaceToken(typeName);
                this.interfaceTokenCache.set(key, token);
            }
            return this.resolve(token);
        }
        /**
         * Resolve a keyed interface
         */
        resolveInterfaceKeyed(key, _typeName) {
            // For keyed interfaces, we use the existing resolveKeyed mechanism
            return this.resolveKeyed(key);
        }
        /**
         * Resolve all registrations for an interface type
         */
        resolveInterfaceAll(typeName) {
            const token = this.interfaceToken(typeName);
            return this.resolveAll(token);
        }
        /**
         * Internal: Resolve with context for circular dependency detection
         */
        resolveWithContext(token, context) {
            // Check circular dependency
            if (context.isResolving(token)) {
                throw new CircularDependencyError([...context.getPath(), token.toString()]);
            }
            const binding = this.getBinding(token);
            if (!binding) {
                throw new BindingNotFoundError(token.toString(), context.getPath());
            }
            // Check per-request cache
            if (binding.lifetime === 'per-request' && context.hasPerRequest(token)) {
                return context.getPerRequest(token);
            }
            // Check singleton cache (local container only)
            if (binding.lifetime === 'singleton' && this.singletonCache.has(token)) {
                return this.singletonCache.get(token);
            }
            // Mark as resolving
            context.enterResolve(token);
            try {
                let instance;
                switch (binding.type) {
                    case 'value':
                        instance = binding.value;
                        break;
                    case 'factory':
                        instance = binding.factory(this);
                        if (instance instanceof Promise) {
                            throw new Error(`Async factory detected for ${token.toString()}. Use resolveAsync() instead.`);
                        }
                        break;
                    case 'class':
                        const deps = binding.dependencies || [];
                        const resolvedDeps = deps.map(dep => this.resolveWithContext(dep, context));
                        instance = new binding.constructor(...resolvedDeps);
                        break;
                    case 'inline-class':
                        // Performance: Direct instantiation without function call overhead
                        instance = new binding.constructor();
                        break;
                    default:
                        throw new Error(`Unknown binding type: ${binding.type}`);
                }
                // Cache based on lifetime
                if (binding.lifetime === 'singleton') {
                    this.singletonCache.set(token, instance);
                    this.singletonOrder.push(token);
                    // Performance: Also add to ultra-fast cache
                    this.ultraFastSingletonCache.set(token, instance);
                }
                else if (binding.lifetime === 'per-request') {
                    context.cachePerRequest(token, instance);
                }
                return instance;
            }
            finally {
                context.exitResolve(token);
            }
        }
        /**
         * Internal: Async resolve with context
         */
        async resolveAsyncWithContext(token, context) {
            // Check circular dependency
            if (context.isResolving(token)) {
                throw new CircularDependencyError([...context.getPath(), token.toString()]);
            }
            const binding = this.getBinding(token);
            if (!binding) {
                throw new BindingNotFoundError(token.toString(), context.getPath());
            }
            // Check per-request cache
            if (binding.lifetime === 'per-request' && context.hasPerRequest(token)) {
                return context.getPerRequest(token);
            }
            // Check singleton cache (local container only)
            if (binding.lifetime === 'singleton' && this.singletonCache.has(token)) {
                return this.singletonCache.get(token);
            }
            // Mark as resolving
            context.enterResolve(token);
            try {
                let instance;
                switch (binding.type) {
                    case 'value':
                        instance = binding.value;
                        break;
                    case 'factory':
                        instance = await Promise.resolve(binding.factory(this));
                        break;
                    case 'class':
                        const deps = binding.dependencies || [];
                        const resolvedDeps = await Promise.all(deps.map(dep => this.resolveAsyncWithContext(dep, context)));
                        instance = new binding.constructor(...resolvedDeps);
                        break;
                    case 'inline-class':
                        // Performance: Direct instantiation without function call overhead
                        instance = new binding.constructor();
                        break;
                    default:
                        throw new Error(`Unknown binding type: ${binding.type}`);
                }
                // Cache based on lifetime
                if (binding.lifetime === 'singleton') {
                    this.singletonCache.set(token, instance);
                    this.singletonOrder.push(token);
                }
                else if (binding.lifetime === 'per-request') {
                    context.cachePerRequest(token, instance);
                }
                return instance;
            }
            finally {
                context.exitResolve(token);
            }
        }
        /**
         * Get binding from this container or parent chain
         * Performance optimized: Uses flat cache to avoid recursive parent lookups
         */
        getBinding(token) {
            // Build flat cache on first access
            if (!this.bindingCache) {
                this.buildBindingCache();
            }
            return this.bindingCache.get(token);
        }
        /**
         * Build flat cache of all bindings including parent chain
         * This converts O(n) parent chain traversal to O(1) lookup
         */
        buildBindingCache() {
            this.bindingCache = new Map();
            // Traverse parent chain and flatten all bindings
            let current = this;
            while (current) {
                current.bindings.forEach((binding, token) => {
                    // Child bindings override parent bindings (first wins)
                    if (!this.bindingCache.has(token)) {
                        this.bindingCache.set(token, binding);
                    }
                });
                current = current.parent;
            }
        }
        /**
         * Invalidate binding cache when new bindings are added
         * Called by bindValue, bindFactory, bindClass
         */
        invalidateBindingCache() {
            this.bindingCache = undefined;
            this.ultraFastSingletonCache.clear(); // Clear ultra-fast cache when bindings change
        }
    };
    Container$2.contextPool = new ResolutionContextPool(); // Performance: Pooled contexts reduce allocations

    class ConsoleLogger {
        constructor() {
            this.logs = [];
        }
        log(message, context) {
            const timestamp = new Date().toLocaleTimeString();
            const logMessage = context
                ? `[${timestamp}] [${context}] ${message}`
                : `[${timestamp}] ${message}`;
            console.log(logMessage);
            this.logs.push(logMessage);
        }
        info(message, context) {
            const timestamp = new Date().toLocaleTimeString();
            const logMessage = context
                ? `[${timestamp}] [INFO] [${context}] ${message}`
                : `[${timestamp}] [INFO] ${message}`;
            console.info(`%c${logMessage}`, 'color: #4CAF50');
            this.logs.push(logMessage);
        }
        warn(message, context) {
            const timestamp = new Date().toLocaleTimeString();
            const logMessage = context
                ? `[${timestamp}] [WARN] [${context}] ${message}`
                : `[${timestamp}] [WARN] ${message}`;
            console.warn(logMessage);
            this.logs.push(logMessage);
        }
        error(message, error) {
            const timestamp = new Date().toLocaleTimeString();
            const logMessage = error
                ? `[${timestamp}] [ERROR] ${message}: ${error.message}`
                : `[${timestamp}] [ERROR] ${message}`;
            console.error(logMessage);
            this.logs.push(logMessage);
        }
        getLogs() {
            return [...this.logs];
        }
    }
    class FileLogger {
        constructor() {
            this.logs = [];
        }
        log(message, context) {
            const timestamp = new Date().toISOString();
            const logMessage = context
                ? `${timestamp} [${context}] ${message}`
                : `${timestamp} ${message}`;
            this.logs.push(logMessage);
            console.log(`[FILE] ${logMessage}`);
        }
        info(message, context) {
            this.log(`[INFO] ${message}`, context);
        }
        warn(message, context) {
            this.log(`[WARN] ${message}`, context);
        }
        error(message, error) {
            const logMessage = error ? `[ERROR] ${message}: ${error.message}` : `[ERROR] ${message}`;
            this.log(logMessage);
        }
        getLogs() {
            return [...this.logs];
        }
    }

    class EventBus {
        constructor(logger) {
            this.logger = logger;
            this.subscribers = new Map();
        }
        publish(event, data) {
            this.logger.log(`Event published: ${event}`, 'EventBus');
            const handlers = this.subscribers.get(event) || [];
            handlers.forEach((handler) => {
                try {
                    handler(data);
                }
                catch (error) {
                    this.logger.error(`Error handling event ${event}`, error);
                }
            });
        }
        subscribe(event, handler) {
            if (!this.subscribers.has(event)) {
                this.subscribers.set(event, []);
            }
            this.subscribers.get(event).push(handler);
            this.logger.log(`New subscriber for event: ${event}`, 'EventBus');
        }
        getSubscriberCount(event) {
            return this.subscribers.get(event)?.length || 0;
        }
    }

    class TemperatureAutomationRule {
        constructor(id, name, sensor, device, threshold, logger, eventBus) {
            this.id = id;
            this.name = name;
            this.sensor = sensor;
            this.device = device;
            this.threshold = threshold;
            this.logger = logger;
            this.eventBus = eventBus;
            this.enabled = false;
        }
        evaluate() {
            if (!this.enabled)
                return;
            const currentTemp = this.sensor.getValue();
            if (currentTemp > this.threshold && !this.device.isOn) {
                this.logger.warn(`Temperature ${currentTemp}°C exceeds threshold ${this.threshold}°C`, `Rule:${this.id}`);
                this.device.turnOn();
                this.eventBus.publish('automation:triggered', {
                    rule: this.name,
                    reason: 'temperature_threshold'
                });
            }
            else if (currentTemp < this.threshold - 1 && this.device.isOn) {
                this.logger.info(`Temperature normalized to ${currentTemp}°C`, `Rule:${this.id}`);
                this.device.turnOff();
            }
        }
        enable() {
            this.enabled = true;
            this.logger.info(`Automation rule "${this.name}" enabled`, `Rule:${this.id}`);
        }
        disable() {
            this.enabled = false;
            this.logger.info(`Automation rule "${this.name}" disabled`, `Rule:${this.id}`);
        }
    }
    class MotionLightAutomationRule {
        constructor(id, name, motionSensor, light, logger, eventBus) {
            this.id = id;
            this.name = name;
            this.motionSensor = motionSensor;
            this.light = light;
            this.logger = logger;
            this.eventBus = eventBus;
            this.enabled = false;
        }
        evaluate() {
            if (!this.enabled)
                return;
            const motion = this.motionSensor.getValue();
            if (motion === 1 && !this.light.isOn) {
                this.logger.info('Motion detected, turning on light', `Rule:${this.id}`);
                this.light.turnOn();
                this.eventBus.publish('automation:triggered', {
                    rule: this.name,
                    reason: 'motion_detected'
                });
            }
        }
        enable() {
            this.enabled = true;
            this.logger.info(`Automation rule "${this.name}" enabled`, `Rule:${this.id}`);
        }
        disable() {
            this.enabled = false;
            this.logger.info(`Automation rule "${this.name}" disabled`, `Rule:${this.id}`);
        }
    }
    class AutomationService {
        constructor(logger, eventBus) {
            this.logger = logger;
            this.eventBus = eventBus;
            this.rules = [];
            this.eventBus.subscribe('automation:triggered', (data) => {
                this.logger.info(`Automation "${data.rule}" triggered: ${data.reason}`, 'AutomationService');
            });
        }
        addRule(rule) {
            this.rules.push(rule);
            this.logger.log(`Automation rule "${rule.name}" registered`, 'AutomationService');
        }
        start() {
            this.rules.forEach((rule) => rule.enable());
            this.logger.info('Automation service started', 'AutomationService');
            // Evaluate rules every 2 seconds
            this.intervalId = window.setInterval(() => {
                this.rules.forEach((rule) => rule.evaluate());
            }, 2000);
        }
        stop() {
            this.rules.forEach((rule) => rule.disable());
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = undefined;
            }
            this.logger.info('Automation service stopped', 'AutomationService');
        }
    }

    class TemperatureSensor {
        constructor(id, name, roomId, currentTemp = 22) {
            this.id = id;
            this.name = name;
            this.roomId = roomId;
            this.currentTemp = currentTemp;
        }
        getValue() {
            // Simulate temperature fluctuation
            this.currentTemp += (Math.random() - 0.5) * 0.5;
            return Math.round(this.currentTemp * 10) / 10;
        }
        getUnit() {
            return '°C';
        }
    }
    class MotionSensor {
        constructor(id, name, roomId) {
            this.id = id;
            this.name = name;
            this.roomId = roomId;
        }
        getValue() {
            // Random motion detection
            return Math.random() > 0.7 ? 1 : 0;
        }
        getUnit() {
            return 'detected';
        }
    }

    class SmartLight {
        constructor(id, name, roomId, logger) {
            this.id = id;
            this.name = name;
            this.roomId = roomId;
            this.logger = logger;
            this.isOn = false;
            this.brightness = 100;
        }
        turnOn() {
            this.isOn = true;
            this.logger.info(`${this.name} turned ON (${this.brightness}%)`, `Device:${this.id}`);
        }
        turnOff() {
            this.isOn = false;
            this.logger.info(`${this.name} turned OFF`, `Device:${this.id}`);
        }
        setBrightness(level) {
            this.brightness = Math.max(0, Math.min(100, level));
            this.logger.log(`${this.name} brightness set to ${this.brightness}%`, `Device:${this.id}`);
        }
        getStatus() {
            return `${this.isOn ? 'ON' : 'OFF'} (${this.brightness}%)`;
        }
    }
    class SmartThermostat {
        constructor(id, name, roomId, logger) {
            this.id = id;
            this.name = name;
            this.roomId = roomId;
            this.logger = logger;
            this.isOn = false;
            this.targetTemp = 22;
        }
        turnOn() {
            this.isOn = true;
            this.logger.info(`${this.name} turned ON, target: ${this.targetTemp}°C`, `Device:${this.id}`);
        }
        turnOff() {
            this.isOn = false;
            this.logger.info(`${this.name} turned OFF`, `Device:${this.id}`);
        }
        setTargetTemperature(temp) {
            this.targetTemp = temp;
            this.logger.log(`${this.name} target temperature set to ${temp}°C`, `Device:${this.id}`);
        }
        getStatus() {
            return `${this.isOn ? 'HEATING' : 'OFF'} (target: ${this.targetTemp}°C)`;
        }
    }

    // NovaDI Performance Benchmark
    // Test implementations for simpler tests
    let Logger$4 = class Logger {
        log(message, context) { }
        info(message, context) { }
        warn(message, context) { }
        error(message, error) { }
    };
    let Cache$4 = class Cache {
        constructor() {
            this.data = new Map();
        }
        get(key) { return this.data.get(key); }
        set(key, value) { this.data.set(key, value); }
    };
    class NovaDIBenchmark {
        constructor() {
            this.name = 'NovaDI';
            this.framework = 'NovaDI';
            this.results = {
                framework: 'NovaDI',
                resolutionSingleton: 0,
                resolutionTransient: 0,
                buildTime: 0,
                complexGraph: 0,
                bundleSize: 3.93, // Measured with bundle-size script (minified + gzipped)
                decoratorFree: true
            };
        }
        async setup() {
            // Setup runs before tests
        }
        async testResolutionSingleton() {
            // Build container with singleton services
            const container = new Container$2();
            const builder = container.builder();
            builder.registerType(Logger$4).asInterface("ILogger").singleInstance();
            builder.registerType(Cache$4).asInterface("ICache").singleInstance();
            const app = builder.build();
            // Measure 1000 cached singleton resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                app.resolveInterface("ILogger");
                app.resolveInterface("ICache");
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionSingleton = Math.round(timeMs * 100) / 100;
            return this.results.resolutionSingleton;
        }
        async testResolutionTransient() {
            // Build container with transient services
            const container = new Container$2();
            const builder = container.builder();
            builder.registerType(Logger$4).asInterface("ILogger").instancePerDependency();
            builder.registerType(Cache$4).asInterface("ICache").instancePerDependency();
            const app = builder.build();
            // Measure 1000 transient resolutions (new instance each time)
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                app.resolveInterface("ILogger");
                app.resolveInterface("ICache");
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionTransient = Math.round(timeMs * 100) / 100;
            return this.results.resolutionTransient;
        }
        async testBuildTime() {
            const start = performance.now();
            // Register 100 services
            const container = new Container$2();
            const builder = container.builder();
            for (let i = 0; i < 100; i++) {
                const token = Token$1();
                builder.registerType(Logger$4).as(token).singleInstance();
            }
            builder.build();
            const end = performance.now();
            const timeMs = end - start;
            this.results.buildTime = Math.round(timeMs * 100) / 100;
            return this.results.buildTime;
        }
        async testComplexGraph() {
            // Build Demo 5's complex smart home dependency graph
            const container = new Container$2();
            const builder = container.builder();
            // Core services (same as Demo 5)
            builder.registerType(ConsoleLogger).asInterface("ILogger").singleInstance();
            builder
                .registerType(EventBus)
                .asInterface("IEventBus").autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({ map: { logger: (c) => c.resolveInterface("ILogger") } })
                .singleInstance();
            builder
                .registerType(AutomationService)
                .asInterface("AutomationService").autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger"),
                    eventBus: c => c.resolveInterface("IEventBus")
                }
            }).autoWire({
                map: {
                    logger: (c) => c.resolveInterface("ILogger"),
                    eventBus: (c) => c.resolveInterface("IEventBus")
                }
            })
                .singleInstance();
            // Sensors (using keyed registration for multiple sensors of same interface)
            builder
                .registerInstance(new TemperatureSensor('auto-temp', 'Auto Temp', 'office', 22))
                .asInterface("ISensor")
                .keyed('TempSensor');
            builder
                .registerInstance(new MotionSensor('auto-motion', 'Auto Motion', 'office'))
                .asInterface("ISensor")
                .keyed('MotionSensor');
            // Devices (using keyed registration for multiple devices)
            builder
                .registerType(SmartThermostat)
                .asInterface("IDevice")
                .keyed('Thermostat').autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    id: () => 'auto-thermo',
                    name: () => 'Auto Thermostat',
                    roomId: () => 'office',
                    logger: (c) => c.resolveInterface("ILogger")
                }
            });
            builder
                .registerType(SmartLight)
                .asInterface("IDevice")
                .keyed('Light').autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    id: () => 'auto-light',
                    name: () => 'Auto Light',
                    roomId: () => 'office',
                    logger: (c) => c.resolveInterface("ILogger")
                }
            });
            const app = builder.build();
            // Measure 1000 complex resolutions (resolve the top-level service)
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                app.resolveInterface("AutomationService");
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.complexGraph = Math.round(timeMs * 100) / 100;
            return this.results.complexGraph;
        }
        /**
         * Test complex graph WITHOUT autowire overhead
         * Uses direct factory registration for Demo 5's setup
         */
        async testComplexGraphNoAutoWire() {
            // Build Demo 5's smart home dependency graph with manual factories (no autowire)
            const container = new Container$2();
            const builder = container.builder();
            // Core services with manual factory registration (no autowire)
            builder.registerType(ConsoleLogger).asInterface("ILogger").singleInstance();
            builder.register((c) => {
                const logger = c.resolveInterface("ILogger");
                return new EventBus(logger);
            }).asInterface("IEventBus").singleInstance();
            builder.register((c) => {
                const logger = c.resolveInterface("ILogger");
                const eventBus = c.resolveInterface("IEventBus");
                return new AutomationService(logger, eventBus);
            }).asInterface("AutomationService").singleInstance();
            // Sensors (instances)
            builder
                .registerInstance(new TemperatureSensor('auto-temp', 'Auto Temp', 'office', 22))
                .asInterface("ISensor")
                .keyed('TempSensor');
            builder
                .registerInstance(new MotionSensor('auto-motion', 'Auto Motion', 'office'))
                .asInterface("ISensor")
                .keyed('MotionSensor');
            // Devices with manual factory registration (no autowire)
            builder.register((c) => {
                const logger = c.resolveInterface("ILogger");
                return new SmartThermostat('auto-thermo', 'Auto Thermostat', 'office', logger);
            }).asInterface("IDevice").keyed('Thermostat');
            builder.register((c) => {
                const logger = c.resolveInterface("ILogger");
                return new SmartLight('auto-light', 'Auto Light', 'office', logger);
            }).asInterface("IDevice").keyed('Light');
            const app = builder.build();
            // Measure 1000 complex resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                app.resolveInterface("AutomationService");
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.complexGraphNoAutoWire = Math.round(timeMs * 100) / 100;
            return this.results.complexGraphNoAutoWire;
        }
        cleanup() {
            // Cleanup if needed
        }
        getResults() {
            return this.results;
        }
    }

    // src/registries/callableRegistry.ts
    var callableRegistry = new WeakMap();

    // src/registries/injectsRegistry.ts
    var injectsRegistry = new Map();

    // src/registries/tagsRegistry.ts
    var tagsRegistry = new Map();

    // src/container/bindings/Binding.ts
    var Type;
    (function(Type2) {
      Type2[Type2["Constant"] = 0] = "Constant";
      Type2[Type2["Instance"] = 1] = "Instance";
      Type2[Type2["Factory"] = 2] = "Factory";
    })(Type || (Type = {}));
    var Scope;
    (function(Scope2) {
      Scope2[Scope2["Container"] = 0] = "Container";
      Scope2[Scope2["Resolution"] = 1] = "Resolution";
      Scope2[Scope2["Singleton"] = 2] = "Singleton";
      Scope2[Scope2["Transient"] = 3] = "Transient";
    })(Scope || (Scope = {}));

    // src/container/bindings/ConstantBinding.ts
    var ConstantBinding = class {
      constructor(impl) {
        this.impl = impl;
        this.type = Type.Constant;
      }
    };

    // src/container/bindings/FactoryBinding.ts
    var FactoryBinding = class {
      constructor(impl) {
        this.impl = impl;
        this.type = Type.Factory;
      }
    };
    var isFactoryBinding = (binding) => binding.type === Type.Factory;

    // src/container/bindings/InstanceBinding.ts
    var InstanceBinding = class {
      constructor(impl) {
        this.impl = impl;
        this.type = Type.Instance;
      }
    };
    var InstanceContainerScopedBinding = class extends InstanceBinding {
      constructor() {
        super(...arguments);
        this.scope = Scope.Container;
        this.cache = new WeakMap();
      }
    };
    var InstanceResolutionScopedBinding = class extends InstanceBinding {
      constructor() {
        super(...arguments);
        this.scope = Scope.Resolution;
      }
    };
    var InstanceSingletonScopedBinding = class extends InstanceBinding {
      constructor(impl) {
        super(impl);
        this.impl = impl;
        this.scope = Scope.Singleton;
        if (process.env.NODE_ENV !== "production") {
          this.clone = () => {
            const binding = new InstanceSingletonScopedBinding(this.impl);
            binding.cache = this.cache;
            return binding;
          };
        }
      }
    };
    var InstanceTransientScopedBinding = class extends InstanceBinding {
      constructor() {
        super(...arguments);
        this.scope = Scope.Transient;
      }
    };
    var isInstanceBinding = (binding) => binding.type === Type.Instance;
    var isInstanceContainerScopedBinding = (binding) => binding.scope === Scope.Container;
    var isInstanceResolutionScopedBinding = (binding) => binding.scope === Scope.Resolution;
    var isInstanceSingletonScopedBinding = (binding) => binding.scope === Scope.Singleton;

    // src/pointers/tag.ts
    var tag = (description) => Symbol(description);

    // src/pointers/token.ts
    var token = (description) => {
      const s = Symbol(description);
      return {
        __t: null,
        __d: description,
        __s: s,
        __o: false,
        optional: {
          __t: null,
          __d: description,
          __s: s,
          __o: true
        }
      };
    };

    // src/container/BindingsVault.ts
    var _BindingsVault = class {
      constructor() {
        this.parent = null;
        this.map = new Map();
        if (process.env.NODE_ENV !== "production") {
          this.copy = () => this.from((prev) => {
            const next = new Map();
            prev.forEach((binding, key) => {
              var _a, _b;
              if (binding instanceof _BindingsVault) {
                next.set(key, binding.copy());
              } else {
                next.set(key, (_b = (_a = binding.clone) == null ? void 0 : _a.call(binding)) != null ? _b : binding);
              }
            });
            return next;
          });
        }
      }
      set(binding, token2, condition = _BindingsVault.notag) {
        const current = this.map.get(token2.__s);
        if (current)
          current.set(condition, binding);
        else
          this.map.set(token2.__s, new Map().set(condition, binding));
      }
      find(token2, conditions, target) {
        const bindings = this.map.get(token2.__s);
        if (bindings === void 0)
          return void 0;
        if (target) {
          const targetBinding = bindings.get(target);
          if (targetBinding)
            return targetBinding;
        }
        if (process.env.NODE_ENV !== "production" && conditions && conditions.reduce((acc, condition) => bindings.has(condition) ? acc + 1 : acc, 0) > 1) {
          const conditionsDisplayString = conditions.map((condition) => typeof condition === "function" ? condition.name : `tag(${condition.description})`).join(", ");
          console.warn(`Warning: When resolving a binding by '${token2.__d}' token with [${conditionsDisplayString}] conditions, more than one binding was found. In this case, Brandi resolves the binding by the first tag assigned by 'tagged(target, ...tags)' function or, if you explicitly passed conditions through 'Container.get(token, conditions)' method, by the first resolved condition. Try to avoid such implicit logic.`);
        }
        if (conditions) {
          for (let i = 0, len = conditions.length; i < len; i += 1) {
            const binding = bindings.get(conditions[i]);
            if (binding)
              return binding;
          }
        }
        return bindings.get(_BindingsVault.notag);
      }
      resolve(token2, cache, conditions, target) {
        const binding = this.find(token2, conditions, target);
        if (binding === void 0)
          return this.parent ? this.parent.resolve(token2, cache, conditions, target) : null;
        if (binding instanceof _BindingsVault) {
          cache.vaults.push(binding);
          return binding.resolve(token2, cache, conditions, target);
        }
        return binding;
      }
      get(token2, cache, conditions, target) {
        const ownBinding = this.resolve(token2, cache, conditions, target);
        if (ownBinding)
          return ownBinding;
        for (let i = 0, v = cache.vaults, len = v.length; i < len; i += 1) {
          const cacheBinding = v[i].resolve(token2, cache, conditions, target);
          if (cacheBinding)
            return cacheBinding;
        }
        return null;
      }
      from(callback) {
        const vault = new _BindingsVault();
        vault.parent = this.parent;
        this.map.forEach((bindings, key) => {
          vault.map.set(key, callback(bindings));
        });
        return vault;
      }
      clone() {
        return this.from((prev) => new Map(prev));
      }
    };
    var BindingsVault = _BindingsVault;
    BindingsVault.notag = tag("NO_TAG");

    // src/container/syntax/FromSyntax.ts
    var FromSyntax = class {
      constructor(vault, tokens, getVault, condition) {
        this.vault = vault;
        this.tokens = tokens;
        this.getVault = getVault;
        this.condition = condition;
      }
      from(dependencyModule) {
        const {tokens} = this;
        for (let i = 0, len = tokens.length; i < len; i += 1) {
          this.vault.set(this.getVault(dependencyModule), tokens[i], this.condition);
        }
      }
    };

    // src/container/syntax/ScopeSyntax.ts
    var ScopeSyntax = class {
      constructor(vault, impl, token2, condition) {
        this.vault = vault;
        this.impl = impl;
        this.token = token2;
        this.condition = condition;
        if (process.env.NODE_ENV !== "production") {
          this.warningTimeout = setTimeout(() => {
            console.warn(`Warning: did you forget to set a scope for '${this.token.__d}' token binding? Call 'inTransientScope()', 'inSingletonScope()', 'inContainerScope()' or 'inResolutionScope()'.`);
          });
        }
      }
      inContainerScope() {
        this.set(InstanceContainerScopedBinding);
      }
      inResolutionScope() {
        this.set(InstanceResolutionScopedBinding);
      }
      inSingletonScope() {
        this.set(InstanceSingletonScopedBinding);
      }
      inTransientScope() {
        this.set(InstanceTransientScopedBinding);
      }
      set(Ctor) {
        if (process.env.NODE_ENV !== "production")
          clearTimeout(this.warningTimeout);
        this.vault.set(new Ctor(this.impl), this.token, this.condition);
      }
    };

    // src/container/syntax/TypeSyntax.ts
    var TypeSyntax = class {
      constructor(vault, token2, condition) {
        this.vault = vault;
        this.token = token2;
        this.condition = condition;
      }
      toConstant(value) {
        this.vault.set(new ConstantBinding(value), this.token, this.condition);
      }
      toFactory(creator, initializer) {
        this.vault.set(new FactoryBinding({creator, initializer}), this.token, this.condition);
      }
      toInstance(creator) {
        return new ScopeSyntax(this.vault, creator, this.token, this.condition);
      }
    };

    // src/container/syntax/BindOrUseSyntax.ts
    var BindOrUseSyntax = class {
      constructor(vault, condition) {
        this.vault = vault;
        this.condition = condition;
      }
      static vault(target) {
        return target.vault;
      }
      bind(token2) {
        return new TypeSyntax(this.vault, token2, this.condition);
      }
      use(...tokens) {
        return new FromSyntax(this.vault, tokens, BindOrUseSyntax.vault, this.condition);
      }
    };

    // src/container/syntax/WhenSyntax.ts
    var WhenSyntax = class extends BindOrUseSyntax {
      when(condition) {
        return new BindOrUseSyntax(this.vault, condition);
      }
    };

    // src/container/DependencyModule.ts
    var DependencyModule = class extends WhenSyntax {
      constructor() {
        super(new BindingsVault());
      }
    };

    // src/container/ResolutionCache.ts
    var ResolutionCache = class {
      constructor(instances = new Map(), vaults = []) {
        this.instances = instances;
        this.vaults = vaults;
      }
      split() {
        return new ResolutionCache(this.instances, this.vaults.slice());
      }
    };

    // src/container/Container.ts
    var Container$1 = class Container extends DependencyModule {
      constructor() {
        super();
        this.snapshot = null;
        if (process.env.NODE_ENV !== "production") {
          this.capture = () => {
            this.snapshot = this.vault.copy();
          };
          this.restore = () => {
            if (this.snapshot) {
              this.vault = this.snapshot.copy();
            } else {
              console.error("Error: It looks like a trying to restore a non-captured container state. Did you forget to call 'capture()' method?");
            }
          };
        }
      }
      extend(container) {
        this.vault.parent = container === null ? null : container.vault;
        return this;
      }
      clone() {
        const container = new Container$1();
        container.vault = this.vault.clone();
        return container;
      }
      get(token2, conditions) {
        return this.resolveToken(token2, conditions);
      }
      resolveTokens(tokens, cache, conditions, target) {
        return tokens.map((token2) => this.resolveToken(token2, conditions, target, cache.split()));
      }
      resolveToken(token2, conditions, target, cache = new ResolutionCache()) {
        const binding = this.vault.get(token2, cache, conditions, target);
        if (binding)
          return this.resolveBinding(binding, cache);
        if (token2.__o)
          return void 0;
        throw new Error(`No matching bindings found for '${token2.__d}' token.`);
      }
      resolveBinding(binding, cache) {
        if (isInstanceBinding(binding)) {
          if (isInstanceSingletonScopedBinding(binding)) {
            return this.resolveCache(binding, cache, () => binding.cache, (instance) => {
              binding.cache = instance;
            });
          }
          if (isInstanceContainerScopedBinding(binding)) {
            return this.resolveCache(binding, cache, () => binding.cache.get(this.vault), (instance) => {
              binding.cache.set(this.vault, instance);
            });
          }
          if (isInstanceResolutionScopedBinding(binding)) {
            return this.resolveCache(binding, cache, () => cache.instances.get(binding), (instance) => {
              cache.instances.set(binding, instance);
            });
          }
          return this.createInstance(binding.impl, cache);
        }
        if (isFactoryBinding(binding)) {
          return (...args) => {
            const instance = this.createInstance(binding.impl.creator, cache);
            return instance instanceof Promise ? instance.then((i) => Container$1.resolveInitialization(i, args, binding.impl.initializer)) : Container$1.resolveInitialization(instance, args, binding.impl.initializer);
          };
        }
        return binding.impl;
      }
      resolveCache(binding, cache, getCache, setCache) {
        const instanceCache = getCache();
        if (instanceCache !== void 0)
          return instanceCache;
        const instance = this.createInstance(binding.impl, cache);
        setCache(instance);
        return instance;
      }
      createInstance(creator, cache) {
        const parameters = this.getParameters(creator, cache);
        const isCallable = callableRegistry.get(creator);
        if (isCallable !== void 0) {
          return isCallable ? creator(...parameters) : new creator(...parameters);
        }
        try {
          const instance = creator(...parameters);
          callableRegistry.set(creator, true);
          return instance;
        } catch (e) {
          const instance = new creator(...parameters);
          callableRegistry.set(creator, false);
          return instance;
        }
      }
      getParameters(target, cache) {
        const injects = injectsRegistry.get(target);
        if (injects)
          return this.resolveTokens(injects, cache, tagsRegistry.get(target), target);
        if (target.length === 0)
          return [];
        throw new Error(`Missing required 'injected' registration of '${target.name}'`);
      }
      static resolveInitialization(instance, args, initializer) {
        const initialization = initializer == null ? void 0 : initializer(instance, ...args);
        return initialization instanceof Promise ? initialization.then(() => instance) : instance;
      }
    };

    // src/registrators/injected.ts
    var injected = (target, ...tokens) => {
      injectsRegistry.set(target, tokens);
      return target;
    };

    // Brandi Performance Benchmark
    // https://github.com/vovaspace/brandi
    // Brandi tokens
    const TOKENS = {
        logger: token('ILogger'),
        cache: token('ICache'),
        eventBus: token('IEventBus'),
        automationService: token('AutomationService'),
        tempSensor: token('TempSensor'),
        motionSensor: token('MotionSensor'),
        thermostat: token('Thermostat'),
        light: token('Light'),
    };
    // Test implementations for simpler tests
    let Logger$3 = class Logger {
        log(message, context) { }
        info(message, context) { }
        warn(message, context) { }
        error(message, error) { }
    };
    let Cache$3 = class Cache {
        constructor() {
            this.data = new Map();
        }
        get(key) { return this.data.get(key); }
        set(key, value) { this.data.set(key, value); }
    };
    // Register dependencies with Brandi
    injected(EventBus, TOKENS.logger);
    injected(AutomationService, TOKENS.logger, TOKENS.eventBus);
    class BrandiBenchmark {
        constructor() {
            this.name = 'Brandi';
            this.framework = 'Brandi';
            this.results = {
                framework: 'Brandi',
                resolutionSingleton: 0,
                resolutionTransient: 0,
                buildTime: 0,
                complexGraph: 0,
                bundleSize: 2.19, // Measured with bundle-size script (minified + gzipped)
                decoratorFree: true
            };
        }
        async setup() {
            // Setup runs before tests
        }
        async testResolutionSingleton() {
            // Build container
            const container = new Container$1();
            container.bind(TOKENS.logger).toInstance(Logger$3).inSingletonScope();
            container.bind(TOKENS.cache).toInstance(Cache$3).inSingletonScope();
            // Measure 1000 cached singleton resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                container.get(TOKENS.logger);
                container.get(TOKENS.cache);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionSingleton = Math.round(timeMs * 100) / 100;
            return this.results.resolutionSingleton;
        }
        async testResolutionTransient() {
            // Build container with transient scope
            const container = new Container$1();
            container.bind(TOKENS.logger).toInstance(Logger$3).inTransientScope();
            container.bind(TOKENS.cache).toInstance(Cache$3).inTransientScope();
            // Measure 1000 transient resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                container.get(TOKENS.logger);
                container.get(TOKENS.cache);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionTransient = Math.round(timeMs * 100) / 100;
            return this.results.resolutionTransient;
        }
        async testBuildTime() {
            const start = performance.now();
            // Register 100 services
            const container = new Container$1();
            for (let i = 0; i < 100; i++) {
                const tok = token(`Logger${i}`);
                container.bind(tok).toInstance(Logger$3).inSingletonScope();
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.buildTime = Math.round(timeMs * 100) / 100;
            return this.results.buildTime;
        }
        async testComplexGraph() {
            // Build Demo 5's complex smart home dependency graph
            const container = new Container$1();
            // Core services (with injected() registered, Brandi will auto-inject dependencies)
            container.bind(TOKENS.logger).toInstance(ConsoleLogger).inSingletonScope();
            container.bind(TOKENS.eventBus).toInstance(EventBus).inSingletonScope();
            container.bind(TOKENS.automationService).toInstance(AutomationService).inSingletonScope();
            // Sensors (instances)
            container.bind(TOKENS.tempSensor).toConstant(new TemperatureSensor('auto-temp', 'Auto Temp', 'office', 22));
            container.bind(TOKENS.motionSensor).toConstant(new MotionSensor('auto-motion', 'Auto Motion', 'office'));
            // Need to get logger first to create device instances
            // Resolve logger to create the singleton before creating devices
            const logger = container.get(TOKENS.logger);
            // Devices (pre-created instances with logger)
            container.bind(TOKENS.thermostat).toConstant(new SmartThermostat('auto-thermo', 'Auto Thermostat', 'office', logger));
            container.bind(TOKENS.light).toConstant(new SmartLight('auto-light', 'Auto Light', 'office', logger));
            // Measure 1000 complex resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                container.get(TOKENS.automationService);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.complexGraph = Math.round(timeMs * 100) / 100;
            return this.results.complexGraph;
        }
        cleanup() {
            // Cleanup if needed
        }
        getResults() {
            return this.results;
        }
    }

    /******************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */
    /* global Reflect, Promise, SuppressedError, Symbol, Iterator */

    var extendStatics = function(d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };

    function __extends$2(d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    }

    function __decorate(decorators, target, key, desc) {
        var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
        if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
        else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
        return c > 3 && r && Object.defineProperty(target, key, r), r;
    }

    function __awaiter(thisArg, _arguments, P, generator) {
        function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
            function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
            function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    }

    function __generator(thisArg, body) {
        var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
        return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
        function verb(n) { return function (v) { return step([n, v]); }; }
        function step(op) {
            if (f) throw new TypeError("Generator is already executing.");
            while (g && (g = 0, op[0] && (_ = 0)), _) try {
                if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
                if (y = 0, t) op = [op[0] & 2, t.value];
                switch (op[0]) {
                    case 0: case 1: t = op; break;
                    case 4: _.label++; return { value: op[1], done: false };
                    case 5: _.label++; y = op[1]; op = [0]; continue;
                    case 7: op = _.ops.pop(); _.trys.pop(); continue;
                    default:
                        if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                        if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                        if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                        if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                        if (t[2]) _.ops.pop();
                        _.trys.pop(); continue;
                }
                op = body.call(thisArg, _);
            } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
            if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
        }
    }

    function __values(o) {
        var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
        if (m) return m.call(o);
        if (o && typeof o.length === "number") return {
            next: function () {
                if (o && i >= o.length) o = void 0;
                return { value: o && o[i++], done: !o };
            }
        };
        throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
    }

    function __read(o, n) {
        var m = typeof Symbol === "function" && o[Symbol.iterator];
        if (!m) return o;
        var i = m.call(o), r, ar = [], e;
        try {
            while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
        }
        catch (error) { e = { error: error }; }
        finally {
            try {
                if (r && !r.done && (m = i["return"])) m.call(i);
            }
            finally { if (e) throw e.error; }
        }
        return ar;
    }

    /** @deprecated */
    function __spread() {
        for (var ar = [], i = 0; i < arguments.length; i++)
            ar = ar.concat(__read(arguments[i]));
        return ar;
    }

    typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
        var e = new Error(message);
        return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
    };

    /*! *****************************************************************************
    Copyright (C) Microsoft. All rights reserved.
    Licensed under the Apache License, Version 2.0 (the "License"); you may not use
    this file except in compliance with the License. You may obtain a copy of the
    License at http://www.apache.org/licenses/LICENSE-2.0

    THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
    WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
    MERCHANTABLITY OR NON-INFRINGEMENT.

    See the Apache Version 2.0 License for specific language governing permissions
    and limitations under the License.
    ***************************************************************************** */
    var Reflect$1;
    (function (Reflect) {
        // Metadata Proposal
        // https://rbuckton.github.io/reflect-metadata/
        (function (factory) {
            var root = typeof globalThis === "object" ? globalThis :
                typeof global === "object" ? global :
                    typeof self === "object" ? self :
                        typeof this === "object" ? this :
                            sloppyModeThis();
            var exporter = makeExporter(Reflect);
            if (typeof root.Reflect !== "undefined") {
                exporter = makeExporter(root.Reflect, exporter);
            }
            factory(exporter, root);
            if (typeof root.Reflect === "undefined") {
                root.Reflect = Reflect;
            }
            function makeExporter(target, previous) {
                return function (key, value) {
                    Object.defineProperty(target, key, { configurable: true, writable: true, value: value });
                    if (previous)
                        previous(key, value);
                };
            }
            function functionThis() {
                try {
                    return Function("return this;")();
                }
                catch (_) { }
            }
            function indirectEvalThis() {
                try {
                    return (void 0, eval)("(function() { return this; })()");
                }
                catch (_) { }
            }
            function sloppyModeThis() {
                return functionThis() || indirectEvalThis();
            }
        })(function (exporter, root) {
            var hasOwn = Object.prototype.hasOwnProperty;
            // feature test for Symbol support
            var supportsSymbol = typeof Symbol === "function";
            var toPrimitiveSymbol = supportsSymbol && typeof Symbol.toPrimitive !== "undefined" ? Symbol.toPrimitive : "@@toPrimitive";
            var iteratorSymbol = supportsSymbol && typeof Symbol.iterator !== "undefined" ? Symbol.iterator : "@@iterator";
            var supportsCreate = typeof Object.create === "function"; // feature test for Object.create support
            var supportsProto = { __proto__: [] } instanceof Array; // feature test for __proto__ support
            var downLevel = !supportsCreate && !supportsProto;
            var HashMap = {
                // create an object in dictionary mode (a.k.a. "slow" mode in v8)
                create: supportsCreate
                    ? function () { return MakeDictionary(Object.create(null)); }
                    : supportsProto
                        ? function () { return MakeDictionary({ __proto__: null }); }
                        : function () { return MakeDictionary({}); },
                has: downLevel
                    ? function (map, key) { return hasOwn.call(map, key); }
                    : function (map, key) { return key in map; },
                get: downLevel
                    ? function (map, key) { return hasOwn.call(map, key) ? map[key] : undefined; }
                    : function (map, key) { return map[key]; },
            };
            // Load global or shim versions of Map, Set, and WeakMap
            var functionPrototype = Object.getPrototypeOf(Function);
            var _Map = typeof Map === "function" && typeof Map.prototype.entries === "function" ? Map : CreateMapPolyfill();
            var _Set = typeof Set === "function" && typeof Set.prototype.entries === "function" ? Set : CreateSetPolyfill();
            var _WeakMap = typeof WeakMap === "function" ? WeakMap : CreateWeakMapPolyfill();
            var registrySymbol = supportsSymbol ? Symbol.for("@reflect-metadata:registry") : undefined;
            var metadataRegistry = GetOrCreateMetadataRegistry();
            var metadataProvider = CreateMetadataProvider(metadataRegistry);
            /**
             * Applies a set of decorators to a property of a target object.
             * @param decorators An array of decorators.
             * @param target The target object.
             * @param propertyKey (Optional) The property key to decorate.
             * @param attributes (Optional) The property descriptor for the target key.
             * @remarks Decorators are applied in reverse order.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     Example = Reflect.decorate(decoratorsArray, Example);
             *
             *     // property (on constructor)
             *     Reflect.decorate(decoratorsArray, Example, "staticProperty");
             *
             *     // property (on prototype)
             *     Reflect.decorate(decoratorsArray, Example.prototype, "property");
             *
             *     // method (on constructor)
             *     Object.defineProperty(Example, "staticMethod",
             *         Reflect.decorate(decoratorsArray, Example, "staticMethod",
             *             Object.getOwnPropertyDescriptor(Example, "staticMethod")));
             *
             *     // method (on prototype)
             *     Object.defineProperty(Example.prototype, "method",
             *         Reflect.decorate(decoratorsArray, Example.prototype, "method",
             *             Object.getOwnPropertyDescriptor(Example.prototype, "method")));
             *
             */
            function decorate(decorators, target, propertyKey, attributes) {
                if (!IsUndefined(propertyKey)) {
                    if (!IsArray(decorators))
                        throw new TypeError();
                    if (!IsObject(target))
                        throw new TypeError();
                    if (!IsObject(attributes) && !IsUndefined(attributes) && !IsNull(attributes))
                        throw new TypeError();
                    if (IsNull(attributes))
                        attributes = undefined;
                    propertyKey = ToPropertyKey(propertyKey);
                    return DecorateProperty(decorators, target, propertyKey, attributes);
                }
                else {
                    if (!IsArray(decorators))
                        throw new TypeError();
                    if (!IsConstructor(target))
                        throw new TypeError();
                    return DecorateConstructor(decorators, target);
                }
            }
            exporter("decorate", decorate);
            // 4.1.2 Reflect.metadata(metadataKey, metadataValue)
            // https://rbuckton.github.io/reflect-metadata/#reflect.metadata
            /**
             * A default metadata decorator factory that can be used on a class, class member, or parameter.
             * @param metadataKey The key for the metadata entry.
             * @param metadataValue The value for the metadata entry.
             * @returns A decorator function.
             * @remarks
             * If `metadataKey` is already defined for the target and target key, the
             * metadataValue for that key will be overwritten.
             * @example
             *
             *     // constructor
             *     @Reflect.metadata(key, value)
             *     class Example {
             *     }
             *
             *     // property (on constructor, TypeScript only)
             *     class Example {
             *         @Reflect.metadata(key, value)
             *         static staticProperty;
             *     }
             *
             *     // property (on prototype, TypeScript only)
             *     class Example {
             *         @Reflect.metadata(key, value)
             *         property;
             *     }
             *
             *     // method (on constructor)
             *     class Example {
             *         @Reflect.metadata(key, value)
             *         static staticMethod() { }
             *     }
             *
             *     // method (on prototype)
             *     class Example {
             *         @Reflect.metadata(key, value)
             *         method() { }
             *     }
             *
             */
            function metadata(metadataKey, metadataValue) {
                function decorator(target, propertyKey) {
                    if (!IsObject(target))
                        throw new TypeError();
                    if (!IsUndefined(propertyKey) && !IsPropertyKey(propertyKey))
                        throw new TypeError();
                    OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
                }
                return decorator;
            }
            exporter("metadata", metadata);
            /**
             * Define a unique metadata entry on the target.
             * @param metadataKey A key used to store and retrieve metadata.
             * @param metadataValue A value that contains attached metadata.
             * @param target The target object on which to define metadata.
             * @param propertyKey (Optional) The property key for the target.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     Reflect.defineMetadata("custom:annotation", options, Example);
             *
             *     // property (on constructor)
             *     Reflect.defineMetadata("custom:annotation", options, Example, "staticProperty");
             *
             *     // property (on prototype)
             *     Reflect.defineMetadata("custom:annotation", options, Example.prototype, "property");
             *
             *     // method (on constructor)
             *     Reflect.defineMetadata("custom:annotation", options, Example, "staticMethod");
             *
             *     // method (on prototype)
             *     Reflect.defineMetadata("custom:annotation", options, Example.prototype, "method");
             *
             *     // decorator factory as metadata-producing annotation.
             *     function MyAnnotation(options): Decorator {
             *         return (target, key?) => Reflect.defineMetadata("custom:annotation", options, target, key);
             *     }
             *
             */
            function defineMetadata(metadataKey, metadataValue, target, propertyKey) {
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                return OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
            }
            exporter("defineMetadata", defineMetadata);
            /**
             * Gets a value indicating whether the target object or its prototype chain has the provided metadata key defined.
             * @param metadataKey A key used to store and retrieve metadata.
             * @param target The target object on which the metadata is defined.
             * @param propertyKey (Optional) The property key for the target.
             * @returns `true` if the metadata key was defined on the target object or its prototype chain; otherwise, `false`.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     result = Reflect.hasMetadata("custom:annotation", Example);
             *
             *     // property (on constructor)
             *     result = Reflect.hasMetadata("custom:annotation", Example, "staticProperty");
             *
             *     // property (on prototype)
             *     result = Reflect.hasMetadata("custom:annotation", Example.prototype, "property");
             *
             *     // method (on constructor)
             *     result = Reflect.hasMetadata("custom:annotation", Example, "staticMethod");
             *
             *     // method (on prototype)
             *     result = Reflect.hasMetadata("custom:annotation", Example.prototype, "method");
             *
             */
            function hasMetadata(metadataKey, target, propertyKey) {
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                return OrdinaryHasMetadata(metadataKey, target, propertyKey);
            }
            exporter("hasMetadata", hasMetadata);
            /**
             * Gets a value indicating whether the target object has the provided metadata key defined.
             * @param metadataKey A key used to store and retrieve metadata.
             * @param target The target object on which the metadata is defined.
             * @param propertyKey (Optional) The property key for the target.
             * @returns `true` if the metadata key was defined on the target object; otherwise, `false`.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     result = Reflect.hasOwnMetadata("custom:annotation", Example);
             *
             *     // property (on constructor)
             *     result = Reflect.hasOwnMetadata("custom:annotation", Example, "staticProperty");
             *
             *     // property (on prototype)
             *     result = Reflect.hasOwnMetadata("custom:annotation", Example.prototype, "property");
             *
             *     // method (on constructor)
             *     result = Reflect.hasOwnMetadata("custom:annotation", Example, "staticMethod");
             *
             *     // method (on prototype)
             *     result = Reflect.hasOwnMetadata("custom:annotation", Example.prototype, "method");
             *
             */
            function hasOwnMetadata(metadataKey, target, propertyKey) {
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                return OrdinaryHasOwnMetadata(metadataKey, target, propertyKey);
            }
            exporter("hasOwnMetadata", hasOwnMetadata);
            /**
             * Gets the metadata value for the provided metadata key on the target object or its prototype chain.
             * @param metadataKey A key used to store and retrieve metadata.
             * @param target The target object on which the metadata is defined.
             * @param propertyKey (Optional) The property key for the target.
             * @returns The metadata value for the metadata key if found; otherwise, `undefined`.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     result = Reflect.getMetadata("custom:annotation", Example);
             *
             *     // property (on constructor)
             *     result = Reflect.getMetadata("custom:annotation", Example, "staticProperty");
             *
             *     // property (on prototype)
             *     result = Reflect.getMetadata("custom:annotation", Example.prototype, "property");
             *
             *     // method (on constructor)
             *     result = Reflect.getMetadata("custom:annotation", Example, "staticMethod");
             *
             *     // method (on prototype)
             *     result = Reflect.getMetadata("custom:annotation", Example.prototype, "method");
             *
             */
            function getMetadata(metadataKey, target, propertyKey) {
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                return OrdinaryGetMetadata(metadataKey, target, propertyKey);
            }
            exporter("getMetadata", getMetadata);
            /**
             * Gets the metadata value for the provided metadata key on the target object.
             * @param metadataKey A key used to store and retrieve metadata.
             * @param target The target object on which the metadata is defined.
             * @param propertyKey (Optional) The property key for the target.
             * @returns The metadata value for the metadata key if found; otherwise, `undefined`.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     result = Reflect.getOwnMetadata("custom:annotation", Example);
             *
             *     // property (on constructor)
             *     result = Reflect.getOwnMetadata("custom:annotation", Example, "staticProperty");
             *
             *     // property (on prototype)
             *     result = Reflect.getOwnMetadata("custom:annotation", Example.prototype, "property");
             *
             *     // method (on constructor)
             *     result = Reflect.getOwnMetadata("custom:annotation", Example, "staticMethod");
             *
             *     // method (on prototype)
             *     result = Reflect.getOwnMetadata("custom:annotation", Example.prototype, "method");
             *
             */
            function getOwnMetadata(metadataKey, target, propertyKey) {
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                return OrdinaryGetOwnMetadata(metadataKey, target, propertyKey);
            }
            exporter("getOwnMetadata", getOwnMetadata);
            /**
             * Gets the metadata keys defined on the target object or its prototype chain.
             * @param target The target object on which the metadata is defined.
             * @param propertyKey (Optional) The property key for the target.
             * @returns An array of unique metadata keys.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     result = Reflect.getMetadataKeys(Example);
             *
             *     // property (on constructor)
             *     result = Reflect.getMetadataKeys(Example, "staticProperty");
             *
             *     // property (on prototype)
             *     result = Reflect.getMetadataKeys(Example.prototype, "property");
             *
             *     // method (on constructor)
             *     result = Reflect.getMetadataKeys(Example, "staticMethod");
             *
             *     // method (on prototype)
             *     result = Reflect.getMetadataKeys(Example.prototype, "method");
             *
             */
            function getMetadataKeys(target, propertyKey) {
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                return OrdinaryMetadataKeys(target, propertyKey);
            }
            exporter("getMetadataKeys", getMetadataKeys);
            /**
             * Gets the unique metadata keys defined on the target object.
             * @param target The target object on which the metadata is defined.
             * @param propertyKey (Optional) The property key for the target.
             * @returns An array of unique metadata keys.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     result = Reflect.getOwnMetadataKeys(Example);
             *
             *     // property (on constructor)
             *     result = Reflect.getOwnMetadataKeys(Example, "staticProperty");
             *
             *     // property (on prototype)
             *     result = Reflect.getOwnMetadataKeys(Example.prototype, "property");
             *
             *     // method (on constructor)
             *     result = Reflect.getOwnMetadataKeys(Example, "staticMethod");
             *
             *     // method (on prototype)
             *     result = Reflect.getOwnMetadataKeys(Example.prototype, "method");
             *
             */
            function getOwnMetadataKeys(target, propertyKey) {
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                return OrdinaryOwnMetadataKeys(target, propertyKey);
            }
            exporter("getOwnMetadataKeys", getOwnMetadataKeys);
            /**
             * Deletes the metadata entry from the target object with the provided key.
             * @param metadataKey A key used to store and retrieve metadata.
             * @param target The target object on which the metadata is defined.
             * @param propertyKey (Optional) The property key for the target.
             * @returns `true` if the metadata entry was found and deleted; otherwise, false.
             * @example
             *
             *     class Example {
             *         // property declarations are not part of ES6, though they are valid in TypeScript:
             *         // static staticProperty;
             *         // property;
             *
             *         constructor(p) { }
             *         static staticMethod(p) { }
             *         method(p) { }
             *     }
             *
             *     // constructor
             *     result = Reflect.deleteMetadata("custom:annotation", Example);
             *
             *     // property (on constructor)
             *     result = Reflect.deleteMetadata("custom:annotation", Example, "staticProperty");
             *
             *     // property (on prototype)
             *     result = Reflect.deleteMetadata("custom:annotation", Example.prototype, "property");
             *
             *     // method (on constructor)
             *     result = Reflect.deleteMetadata("custom:annotation", Example, "staticMethod");
             *
             *     // method (on prototype)
             *     result = Reflect.deleteMetadata("custom:annotation", Example.prototype, "method");
             *
             */
            function deleteMetadata(metadataKey, target, propertyKey) {
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                if (!IsObject(target))
                    throw new TypeError();
                if (!IsUndefined(propertyKey))
                    propertyKey = ToPropertyKey(propertyKey);
                var provider = GetMetadataProvider(target, propertyKey, /*Create*/ false);
                if (IsUndefined(provider))
                    return false;
                return provider.OrdinaryDeleteMetadata(metadataKey, target, propertyKey);
            }
            exporter("deleteMetadata", deleteMetadata);
            function DecorateConstructor(decorators, target) {
                for (var i = decorators.length - 1; i >= 0; --i) {
                    var decorator = decorators[i];
                    var decorated = decorator(target);
                    if (!IsUndefined(decorated) && !IsNull(decorated)) {
                        if (!IsConstructor(decorated))
                            throw new TypeError();
                        target = decorated;
                    }
                }
                return target;
            }
            function DecorateProperty(decorators, target, propertyKey, descriptor) {
                for (var i = decorators.length - 1; i >= 0; --i) {
                    var decorator = decorators[i];
                    var decorated = decorator(target, propertyKey, descriptor);
                    if (!IsUndefined(decorated) && !IsNull(decorated)) {
                        if (!IsObject(decorated))
                            throw new TypeError();
                        descriptor = decorated;
                    }
                }
                return descriptor;
            }
            // 3.1.1.1 OrdinaryHasMetadata(MetadataKey, O, P)
            // https://rbuckton.github.io/reflect-metadata/#ordinaryhasmetadata
            function OrdinaryHasMetadata(MetadataKey, O, P) {
                var hasOwn = OrdinaryHasOwnMetadata(MetadataKey, O, P);
                if (hasOwn)
                    return true;
                var parent = OrdinaryGetPrototypeOf(O);
                if (!IsNull(parent))
                    return OrdinaryHasMetadata(MetadataKey, parent, P);
                return false;
            }
            // 3.1.2.1 OrdinaryHasOwnMetadata(MetadataKey, O, P)
            // https://rbuckton.github.io/reflect-metadata/#ordinaryhasownmetadata
            function OrdinaryHasOwnMetadata(MetadataKey, O, P) {
                var provider = GetMetadataProvider(O, P, /*Create*/ false);
                if (IsUndefined(provider))
                    return false;
                return ToBoolean(provider.OrdinaryHasOwnMetadata(MetadataKey, O, P));
            }
            // 3.1.3.1 OrdinaryGetMetadata(MetadataKey, O, P)
            // https://rbuckton.github.io/reflect-metadata/#ordinarygetmetadata
            function OrdinaryGetMetadata(MetadataKey, O, P) {
                var hasOwn = OrdinaryHasOwnMetadata(MetadataKey, O, P);
                if (hasOwn)
                    return OrdinaryGetOwnMetadata(MetadataKey, O, P);
                var parent = OrdinaryGetPrototypeOf(O);
                if (!IsNull(parent))
                    return OrdinaryGetMetadata(MetadataKey, parent, P);
                return undefined;
            }
            // 3.1.4.1 OrdinaryGetOwnMetadata(MetadataKey, O, P)
            // https://rbuckton.github.io/reflect-metadata/#ordinarygetownmetadata
            function OrdinaryGetOwnMetadata(MetadataKey, O, P) {
                var provider = GetMetadataProvider(O, P, /*Create*/ false);
                if (IsUndefined(provider))
                    return;
                return provider.OrdinaryGetOwnMetadata(MetadataKey, O, P);
            }
            // 3.1.5.1 OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P)
            // https://rbuckton.github.io/reflect-metadata/#ordinarydefineownmetadata
            function OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P) {
                var provider = GetMetadataProvider(O, P, /*Create*/ true);
                provider.OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P);
            }
            // 3.1.6.1 OrdinaryMetadataKeys(O, P)
            // https://rbuckton.github.io/reflect-metadata/#ordinarymetadatakeys
            function OrdinaryMetadataKeys(O, P) {
                var ownKeys = OrdinaryOwnMetadataKeys(O, P);
                var parent = OrdinaryGetPrototypeOf(O);
                if (parent === null)
                    return ownKeys;
                var parentKeys = OrdinaryMetadataKeys(parent, P);
                if (parentKeys.length <= 0)
                    return ownKeys;
                if (ownKeys.length <= 0)
                    return parentKeys;
                var set = new _Set();
                var keys = [];
                for (var _i = 0, ownKeys_1 = ownKeys; _i < ownKeys_1.length; _i++) {
                    var key = ownKeys_1[_i];
                    var hasKey = set.has(key);
                    if (!hasKey) {
                        set.add(key);
                        keys.push(key);
                    }
                }
                for (var _a = 0, parentKeys_1 = parentKeys; _a < parentKeys_1.length; _a++) {
                    var key = parentKeys_1[_a];
                    var hasKey = set.has(key);
                    if (!hasKey) {
                        set.add(key);
                        keys.push(key);
                    }
                }
                return keys;
            }
            // 3.1.7.1 OrdinaryOwnMetadataKeys(O, P)
            // https://rbuckton.github.io/reflect-metadata/#ordinaryownmetadatakeys
            function OrdinaryOwnMetadataKeys(O, P) {
                var provider = GetMetadataProvider(O, P, /*create*/ false);
                if (!provider) {
                    return [];
                }
                return provider.OrdinaryOwnMetadataKeys(O, P);
            }
            // 6 ECMAScript Data Types and Values
            // https://tc39.github.io/ecma262/#sec-ecmascript-data-types-and-values
            function Type(x) {
                if (x === null)
                    return 1 /* Null */;
                switch (typeof x) {
                    case "undefined": return 0 /* Undefined */;
                    case "boolean": return 2 /* Boolean */;
                    case "string": return 3 /* String */;
                    case "symbol": return 4 /* Symbol */;
                    case "number": return 5 /* Number */;
                    case "object": return x === null ? 1 /* Null */ : 6 /* Object */;
                    default: return 6 /* Object */;
                }
            }
            // 6.1.1 The Undefined Type
            // https://tc39.github.io/ecma262/#sec-ecmascript-language-types-undefined-type
            function IsUndefined(x) {
                return x === undefined;
            }
            // 6.1.2 The Null Type
            // https://tc39.github.io/ecma262/#sec-ecmascript-language-types-null-type
            function IsNull(x) {
                return x === null;
            }
            // 6.1.5 The Symbol Type
            // https://tc39.github.io/ecma262/#sec-ecmascript-language-types-symbol-type
            function IsSymbol(x) {
                return typeof x === "symbol";
            }
            // 6.1.7 The Object Type
            // https://tc39.github.io/ecma262/#sec-object-type
            function IsObject(x) {
                return typeof x === "object" ? x !== null : typeof x === "function";
            }
            // 7.1 Type Conversion
            // https://tc39.github.io/ecma262/#sec-type-conversion
            // 7.1.1 ToPrimitive(input [, PreferredType])
            // https://tc39.github.io/ecma262/#sec-toprimitive
            function ToPrimitive(input, PreferredType) {
                switch (Type(input)) {
                    case 0 /* Undefined */: return input;
                    case 1 /* Null */: return input;
                    case 2 /* Boolean */: return input;
                    case 3 /* String */: return input;
                    case 4 /* Symbol */: return input;
                    case 5 /* Number */: return input;
                }
                var hint = "string" ;
                var exoticToPrim = GetMethod(input, toPrimitiveSymbol);
                if (exoticToPrim !== undefined) {
                    var result = exoticToPrim.call(input, hint);
                    if (IsObject(result))
                        throw new TypeError();
                    return result;
                }
                return OrdinaryToPrimitive(input);
            }
            // 7.1.1.1 OrdinaryToPrimitive(O, hint)
            // https://tc39.github.io/ecma262/#sec-ordinarytoprimitive
            function OrdinaryToPrimitive(O, hint) {
                var valueOf, result, toString_2; {
                    var toString_1 = O.toString;
                    if (IsCallable(toString_1)) {
                        var result = toString_1.call(O);
                        if (!IsObject(result))
                            return result;
                    }
                    var valueOf = O.valueOf;
                    if (IsCallable(valueOf)) {
                        var result = valueOf.call(O);
                        if (!IsObject(result))
                            return result;
                    }
                }
                throw new TypeError();
            }
            // 7.1.2 ToBoolean(argument)
            // https://tc39.github.io/ecma262/2016/#sec-toboolean
            function ToBoolean(argument) {
                return !!argument;
            }
            // 7.1.12 ToString(argument)
            // https://tc39.github.io/ecma262/#sec-tostring
            function ToString(argument) {
                return "" + argument;
            }
            // 7.1.14 ToPropertyKey(argument)
            // https://tc39.github.io/ecma262/#sec-topropertykey
            function ToPropertyKey(argument) {
                var key = ToPrimitive(argument);
                if (IsSymbol(key))
                    return key;
                return ToString(key);
            }
            // 7.2 Testing and Comparison Operations
            // https://tc39.github.io/ecma262/#sec-testing-and-comparison-operations
            // 7.2.2 IsArray(argument)
            // https://tc39.github.io/ecma262/#sec-isarray
            function IsArray(argument) {
                return Array.isArray
                    ? Array.isArray(argument)
                    : argument instanceof Object
                        ? argument instanceof Array
                        : Object.prototype.toString.call(argument) === "[object Array]";
            }
            // 7.2.3 IsCallable(argument)
            // https://tc39.github.io/ecma262/#sec-iscallable
            function IsCallable(argument) {
                // NOTE: This is an approximation as we cannot check for [[Call]] internal method.
                return typeof argument === "function";
            }
            // 7.2.4 IsConstructor(argument)
            // https://tc39.github.io/ecma262/#sec-isconstructor
            function IsConstructor(argument) {
                // NOTE: This is an approximation as we cannot check for [[Construct]] internal method.
                return typeof argument === "function";
            }
            // 7.2.7 IsPropertyKey(argument)
            // https://tc39.github.io/ecma262/#sec-ispropertykey
            function IsPropertyKey(argument) {
                switch (Type(argument)) {
                    case 3 /* String */: return true;
                    case 4 /* Symbol */: return true;
                    default: return false;
                }
            }
            function SameValueZero(x, y) {
                return x === y || x !== x && y !== y;
            }
            // 7.3 Operations on Objects
            // https://tc39.github.io/ecma262/#sec-operations-on-objects
            // 7.3.9 GetMethod(V, P)
            // https://tc39.github.io/ecma262/#sec-getmethod
            function GetMethod(V, P) {
                var func = V[P];
                if (func === undefined || func === null)
                    return undefined;
                if (!IsCallable(func))
                    throw new TypeError();
                return func;
            }
            // 7.4 Operations on Iterator Objects
            // https://tc39.github.io/ecma262/#sec-operations-on-iterator-objects
            function GetIterator(obj) {
                var method = GetMethod(obj, iteratorSymbol);
                if (!IsCallable(method))
                    throw new TypeError(); // from Call
                var iterator = method.call(obj);
                if (!IsObject(iterator))
                    throw new TypeError();
                return iterator;
            }
            // 7.4.4 IteratorValue(iterResult)
            // https://tc39.github.io/ecma262/2016/#sec-iteratorvalue
            function IteratorValue(iterResult) {
                return iterResult.value;
            }
            // 7.4.5 IteratorStep(iterator)
            // https://tc39.github.io/ecma262/#sec-iteratorstep
            function IteratorStep(iterator) {
                var result = iterator.next();
                return result.done ? false : result;
            }
            // 7.4.6 IteratorClose(iterator, completion)
            // https://tc39.github.io/ecma262/#sec-iteratorclose
            function IteratorClose(iterator) {
                var f = iterator["return"];
                if (f)
                    f.call(iterator);
            }
            // 9.1 Ordinary Object Internal Methods and Internal Slots
            // https://tc39.github.io/ecma262/#sec-ordinary-object-internal-methods-and-internal-slots
            // 9.1.1.1 OrdinaryGetPrototypeOf(O)
            // https://tc39.github.io/ecma262/#sec-ordinarygetprototypeof
            function OrdinaryGetPrototypeOf(O) {
                var proto = Object.getPrototypeOf(O);
                if (typeof O !== "function" || O === functionPrototype)
                    return proto;
                // TypeScript doesn't set __proto__ in ES5, as it's non-standard.
                // Try to determine the superclass constructor. Compatible implementations
                // must either set __proto__ on a subclass constructor to the superclass constructor,
                // or ensure each class has a valid `constructor` property on its prototype that
                // points back to the constructor.
                // If this is not the same as Function.[[Prototype]], then this is definately inherited.
                // This is the case when in ES6 or when using __proto__ in a compatible browser.
                if (proto !== functionPrototype)
                    return proto;
                // If the super prototype is Object.prototype, null, or undefined, then we cannot determine the heritage.
                var prototype = O.prototype;
                var prototypeProto = prototype && Object.getPrototypeOf(prototype);
                if (prototypeProto == null || prototypeProto === Object.prototype)
                    return proto;
                // If the constructor was not a function, then we cannot determine the heritage.
                var constructor = prototypeProto.constructor;
                if (typeof constructor !== "function")
                    return proto;
                // If we have some kind of self-reference, then we cannot determine the heritage.
                if (constructor === O)
                    return proto;
                // we have a pretty good guess at the heritage.
                return constructor;
            }
            // Global metadata registry
            // - Allows `import "reflect-metadata"` and `import "reflect-metadata/no-conflict"` to interoperate.
            // - Uses isolated metadata if `Reflect` is frozen before the registry can be installed.
            /**
             * Creates a registry used to allow multiple `reflect-metadata` providers.
             */
            function CreateMetadataRegistry() {
                var fallback;
                if (!IsUndefined(registrySymbol) &&
                    typeof root.Reflect !== "undefined" &&
                    !(registrySymbol in root.Reflect) &&
                    typeof root.Reflect.defineMetadata === "function") {
                    // interoperate with older version of `reflect-metadata` that did not support a registry.
                    fallback = CreateFallbackProvider(root.Reflect);
                }
                var first;
                var second;
                var rest;
                var targetProviderMap = new _WeakMap();
                var registry = {
                    registerProvider: registerProvider,
                    getProvider: getProvider,
                    setProvider: setProvider,
                };
                return registry;
                function registerProvider(provider) {
                    if (!Object.isExtensible(registry)) {
                        throw new Error("Cannot add provider to a frozen registry.");
                    }
                    switch (true) {
                        case fallback === provider: break;
                        case IsUndefined(first):
                            first = provider;
                            break;
                        case first === provider: break;
                        case IsUndefined(second):
                            second = provider;
                            break;
                        case second === provider: break;
                        default:
                            if (rest === undefined)
                                rest = new _Set();
                            rest.add(provider);
                            break;
                    }
                }
                function getProviderNoCache(O, P) {
                    if (!IsUndefined(first)) {
                        if (first.isProviderFor(O, P))
                            return first;
                        if (!IsUndefined(second)) {
                            if (second.isProviderFor(O, P))
                                return first;
                            if (!IsUndefined(rest)) {
                                var iterator = GetIterator(rest);
                                while (true) {
                                    var next = IteratorStep(iterator);
                                    if (!next) {
                                        return undefined;
                                    }
                                    var provider = IteratorValue(next);
                                    if (provider.isProviderFor(O, P)) {
                                        IteratorClose(iterator);
                                        return provider;
                                    }
                                }
                            }
                        }
                    }
                    if (!IsUndefined(fallback) && fallback.isProviderFor(O, P)) {
                        return fallback;
                    }
                    return undefined;
                }
                function getProvider(O, P) {
                    var providerMap = targetProviderMap.get(O);
                    var provider;
                    if (!IsUndefined(providerMap)) {
                        provider = providerMap.get(P);
                    }
                    if (!IsUndefined(provider)) {
                        return provider;
                    }
                    provider = getProviderNoCache(O, P);
                    if (!IsUndefined(provider)) {
                        if (IsUndefined(providerMap)) {
                            providerMap = new _Map();
                            targetProviderMap.set(O, providerMap);
                        }
                        providerMap.set(P, provider);
                    }
                    return provider;
                }
                function hasProvider(provider) {
                    if (IsUndefined(provider))
                        throw new TypeError();
                    return first === provider || second === provider || !IsUndefined(rest) && rest.has(provider);
                }
                function setProvider(O, P, provider) {
                    if (!hasProvider(provider)) {
                        throw new Error("Metadata provider not registered.");
                    }
                    var existingProvider = getProvider(O, P);
                    if (existingProvider !== provider) {
                        if (!IsUndefined(existingProvider)) {
                            return false;
                        }
                        var providerMap = targetProviderMap.get(O);
                        if (IsUndefined(providerMap)) {
                            providerMap = new _Map();
                            targetProviderMap.set(O, providerMap);
                        }
                        providerMap.set(P, provider);
                    }
                    return true;
                }
            }
            /**
             * Gets or creates the shared registry of metadata providers.
             */
            function GetOrCreateMetadataRegistry() {
                var metadataRegistry;
                if (!IsUndefined(registrySymbol) && IsObject(root.Reflect) && Object.isExtensible(root.Reflect)) {
                    metadataRegistry = root.Reflect[registrySymbol];
                }
                if (IsUndefined(metadataRegistry)) {
                    metadataRegistry = CreateMetadataRegistry();
                }
                if (!IsUndefined(registrySymbol) && IsObject(root.Reflect) && Object.isExtensible(root.Reflect)) {
                    Object.defineProperty(root.Reflect, registrySymbol, {
                        enumerable: false,
                        configurable: false,
                        writable: false,
                        value: metadataRegistry
                    });
                }
                return metadataRegistry;
            }
            function CreateMetadataProvider(registry) {
                // [[Metadata]] internal slot
                // https://rbuckton.github.io/reflect-metadata/#ordinary-object-internal-methods-and-internal-slots
                var metadata = new _WeakMap();
                var provider = {
                    isProviderFor: function (O, P) {
                        var targetMetadata = metadata.get(O);
                        if (IsUndefined(targetMetadata))
                            return false;
                        return targetMetadata.has(P);
                    },
                    OrdinaryDefineOwnMetadata: OrdinaryDefineOwnMetadata,
                    OrdinaryHasOwnMetadata: OrdinaryHasOwnMetadata,
                    OrdinaryGetOwnMetadata: OrdinaryGetOwnMetadata,
                    OrdinaryOwnMetadataKeys: OrdinaryOwnMetadataKeys,
                    OrdinaryDeleteMetadata: OrdinaryDeleteMetadata,
                };
                metadataRegistry.registerProvider(provider);
                return provider;
                function GetOrCreateMetadataMap(O, P, Create) {
                    var targetMetadata = metadata.get(O);
                    var createdTargetMetadata = false;
                    if (IsUndefined(targetMetadata)) {
                        if (!Create)
                            return undefined;
                        targetMetadata = new _Map();
                        metadata.set(O, targetMetadata);
                        createdTargetMetadata = true;
                    }
                    var metadataMap = targetMetadata.get(P);
                    if (IsUndefined(metadataMap)) {
                        if (!Create)
                            return undefined;
                        metadataMap = new _Map();
                        targetMetadata.set(P, metadataMap);
                        if (!registry.setProvider(O, P, provider)) {
                            targetMetadata.delete(P);
                            if (createdTargetMetadata) {
                                metadata.delete(O);
                            }
                            throw new Error("Wrong provider for target.");
                        }
                    }
                    return metadataMap;
                }
                // 3.1.2.1 OrdinaryHasOwnMetadata(MetadataKey, O, P)
                // https://rbuckton.github.io/reflect-metadata/#ordinaryhasownmetadata
                function OrdinaryHasOwnMetadata(MetadataKey, O, P) {
                    var metadataMap = GetOrCreateMetadataMap(O, P, /*Create*/ false);
                    if (IsUndefined(metadataMap))
                        return false;
                    return ToBoolean(metadataMap.has(MetadataKey));
                }
                // 3.1.4.1 OrdinaryGetOwnMetadata(MetadataKey, O, P)
                // https://rbuckton.github.io/reflect-metadata/#ordinarygetownmetadata
                function OrdinaryGetOwnMetadata(MetadataKey, O, P) {
                    var metadataMap = GetOrCreateMetadataMap(O, P, /*Create*/ false);
                    if (IsUndefined(metadataMap))
                        return undefined;
                    return metadataMap.get(MetadataKey);
                }
                // 3.1.5.1 OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P)
                // https://rbuckton.github.io/reflect-metadata/#ordinarydefineownmetadata
                function OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P) {
                    var metadataMap = GetOrCreateMetadataMap(O, P, /*Create*/ true);
                    metadataMap.set(MetadataKey, MetadataValue);
                }
                // 3.1.7.1 OrdinaryOwnMetadataKeys(O, P)
                // https://rbuckton.github.io/reflect-metadata/#ordinaryownmetadatakeys
                function OrdinaryOwnMetadataKeys(O, P) {
                    var keys = [];
                    var metadataMap = GetOrCreateMetadataMap(O, P, /*Create*/ false);
                    if (IsUndefined(metadataMap))
                        return keys;
                    var keysObj = metadataMap.keys();
                    var iterator = GetIterator(keysObj);
                    var k = 0;
                    while (true) {
                        var next = IteratorStep(iterator);
                        if (!next) {
                            keys.length = k;
                            return keys;
                        }
                        var nextValue = IteratorValue(next);
                        try {
                            keys[k] = nextValue;
                        }
                        catch (e) {
                            try {
                                IteratorClose(iterator);
                            }
                            finally {
                                throw e;
                            }
                        }
                        k++;
                    }
                }
                function OrdinaryDeleteMetadata(MetadataKey, O, P) {
                    var metadataMap = GetOrCreateMetadataMap(O, P, /*Create*/ false);
                    if (IsUndefined(metadataMap))
                        return false;
                    if (!metadataMap.delete(MetadataKey))
                        return false;
                    if (metadataMap.size === 0) {
                        var targetMetadata = metadata.get(O);
                        if (!IsUndefined(targetMetadata)) {
                            targetMetadata.delete(P);
                            if (targetMetadata.size === 0) {
                                metadata.delete(targetMetadata);
                            }
                        }
                    }
                    return true;
                }
            }
            function CreateFallbackProvider(reflect) {
                var defineMetadata = reflect.defineMetadata, hasOwnMetadata = reflect.hasOwnMetadata, getOwnMetadata = reflect.getOwnMetadata, getOwnMetadataKeys = reflect.getOwnMetadataKeys, deleteMetadata = reflect.deleteMetadata;
                var metadataOwner = new _WeakMap();
                var provider = {
                    isProviderFor: function (O, P) {
                        var metadataPropertySet = metadataOwner.get(O);
                        if (!IsUndefined(metadataPropertySet) && metadataPropertySet.has(P)) {
                            return true;
                        }
                        if (getOwnMetadataKeys(O, P).length) {
                            if (IsUndefined(metadataPropertySet)) {
                                metadataPropertySet = new _Set();
                                metadataOwner.set(O, metadataPropertySet);
                            }
                            metadataPropertySet.add(P);
                            return true;
                        }
                        return false;
                    },
                    OrdinaryDefineOwnMetadata: defineMetadata,
                    OrdinaryHasOwnMetadata: hasOwnMetadata,
                    OrdinaryGetOwnMetadata: getOwnMetadata,
                    OrdinaryOwnMetadataKeys: getOwnMetadataKeys,
                    OrdinaryDeleteMetadata: deleteMetadata,
                };
                return provider;
            }
            /**
             * Gets the metadata provider for an object. If the object has no metadata provider and this is for a create operation,
             * then this module's metadata provider is assigned to the object.
             */
            function GetMetadataProvider(O, P, Create) {
                var registeredProvider = metadataRegistry.getProvider(O, P);
                if (!IsUndefined(registeredProvider)) {
                    return registeredProvider;
                }
                if (Create) {
                    if (metadataRegistry.setProvider(O, P, metadataProvider)) {
                        return metadataProvider;
                    }
                    throw new Error("Illegal state.");
                }
                return undefined;
            }
            // naive Map shim
            function CreateMapPolyfill() {
                var cacheSentinel = {};
                var arraySentinel = [];
                var MapIterator = /** @class */ (function () {
                    function MapIterator(keys, values, selector) {
                        this._index = 0;
                        this._keys = keys;
                        this._values = values;
                        this._selector = selector;
                    }
                    MapIterator.prototype["@@iterator"] = function () { return this; };
                    MapIterator.prototype[iteratorSymbol] = function () { return this; };
                    MapIterator.prototype.next = function () {
                        var index = this._index;
                        if (index >= 0 && index < this._keys.length) {
                            var result = this._selector(this._keys[index], this._values[index]);
                            if (index + 1 >= this._keys.length) {
                                this._index = -1;
                                this._keys = arraySentinel;
                                this._values = arraySentinel;
                            }
                            else {
                                this._index++;
                            }
                            return { value: result, done: false };
                        }
                        return { value: undefined, done: true };
                    };
                    MapIterator.prototype.throw = function (error) {
                        if (this._index >= 0) {
                            this._index = -1;
                            this._keys = arraySentinel;
                            this._values = arraySentinel;
                        }
                        throw error;
                    };
                    MapIterator.prototype.return = function (value) {
                        if (this._index >= 0) {
                            this._index = -1;
                            this._keys = arraySentinel;
                            this._values = arraySentinel;
                        }
                        return { value: value, done: true };
                    };
                    return MapIterator;
                }());
                var Map = /** @class */ (function () {
                    function Map() {
                        this._keys = [];
                        this._values = [];
                        this._cacheKey = cacheSentinel;
                        this._cacheIndex = -2;
                    }
                    Object.defineProperty(Map.prototype, "size", {
                        get: function () { return this._keys.length; },
                        enumerable: true,
                        configurable: true
                    });
                    Map.prototype.has = function (key) { return this._find(key, /*insert*/ false) >= 0; };
                    Map.prototype.get = function (key) {
                        var index = this._find(key, /*insert*/ false);
                        return index >= 0 ? this._values[index] : undefined;
                    };
                    Map.prototype.set = function (key, value) {
                        var index = this._find(key, /*insert*/ true);
                        this._values[index] = value;
                        return this;
                    };
                    Map.prototype.delete = function (key) {
                        var index = this._find(key, /*insert*/ false);
                        if (index >= 0) {
                            var size = this._keys.length;
                            for (var i = index + 1; i < size; i++) {
                                this._keys[i - 1] = this._keys[i];
                                this._values[i - 1] = this._values[i];
                            }
                            this._keys.length--;
                            this._values.length--;
                            if (SameValueZero(key, this._cacheKey)) {
                                this._cacheKey = cacheSentinel;
                                this._cacheIndex = -2;
                            }
                            return true;
                        }
                        return false;
                    };
                    Map.prototype.clear = function () {
                        this._keys.length = 0;
                        this._values.length = 0;
                        this._cacheKey = cacheSentinel;
                        this._cacheIndex = -2;
                    };
                    Map.prototype.keys = function () { return new MapIterator(this._keys, this._values, getKey); };
                    Map.prototype.values = function () { return new MapIterator(this._keys, this._values, getValue); };
                    Map.prototype.entries = function () { return new MapIterator(this._keys, this._values, getEntry); };
                    Map.prototype["@@iterator"] = function () { return this.entries(); };
                    Map.prototype[iteratorSymbol] = function () { return this.entries(); };
                    Map.prototype._find = function (key, insert) {
                        if (!SameValueZero(this._cacheKey, key)) {
                            this._cacheIndex = -1;
                            for (var i = 0; i < this._keys.length; i++) {
                                if (SameValueZero(this._keys[i], key)) {
                                    this._cacheIndex = i;
                                    break;
                                }
                            }
                        }
                        if (this._cacheIndex < 0 && insert) {
                            this._cacheIndex = this._keys.length;
                            this._keys.push(key);
                            this._values.push(undefined);
                        }
                        return this._cacheIndex;
                    };
                    return Map;
                }());
                return Map;
                function getKey(key, _) {
                    return key;
                }
                function getValue(_, value) {
                    return value;
                }
                function getEntry(key, value) {
                    return [key, value];
                }
            }
            // naive Set shim
            function CreateSetPolyfill() {
                var Set = /** @class */ (function () {
                    function Set() {
                        this._map = new _Map();
                    }
                    Object.defineProperty(Set.prototype, "size", {
                        get: function () { return this._map.size; },
                        enumerable: true,
                        configurable: true
                    });
                    Set.prototype.has = function (value) { return this._map.has(value); };
                    Set.prototype.add = function (value) { return this._map.set(value, value), this; };
                    Set.prototype.delete = function (value) { return this._map.delete(value); };
                    Set.prototype.clear = function () { this._map.clear(); };
                    Set.prototype.keys = function () { return this._map.keys(); };
                    Set.prototype.values = function () { return this._map.keys(); };
                    Set.prototype.entries = function () { return this._map.entries(); };
                    Set.prototype["@@iterator"] = function () { return this.keys(); };
                    Set.prototype[iteratorSymbol] = function () { return this.keys(); };
                    return Set;
                }());
                return Set;
            }
            // naive WeakMap shim
            function CreateWeakMapPolyfill() {
                var UUID_SIZE = 16;
                var keys = HashMap.create();
                var rootKey = CreateUniqueKey();
                return /** @class */ (function () {
                    function WeakMap() {
                        this._key = CreateUniqueKey();
                    }
                    WeakMap.prototype.has = function (target) {
                        var table = GetOrCreateWeakMapTable(target, /*create*/ false);
                        return table !== undefined ? HashMap.has(table, this._key) : false;
                    };
                    WeakMap.prototype.get = function (target) {
                        var table = GetOrCreateWeakMapTable(target, /*create*/ false);
                        return table !== undefined ? HashMap.get(table, this._key) : undefined;
                    };
                    WeakMap.prototype.set = function (target, value) {
                        var table = GetOrCreateWeakMapTable(target, /*create*/ true);
                        table[this._key] = value;
                        return this;
                    };
                    WeakMap.prototype.delete = function (target) {
                        var table = GetOrCreateWeakMapTable(target, /*create*/ false);
                        return table !== undefined ? delete table[this._key] : false;
                    };
                    WeakMap.prototype.clear = function () {
                        // NOTE: not a real clear, just makes the previous data unreachable
                        this._key = CreateUniqueKey();
                    };
                    return WeakMap;
                }());
                function CreateUniqueKey() {
                    var key;
                    do
                        key = "@@WeakMap@@" + CreateUUID();
                    while (HashMap.has(keys, key));
                    keys[key] = true;
                    return key;
                }
                function GetOrCreateWeakMapTable(target, create) {
                    if (!hasOwn.call(target, rootKey)) {
                        if (!create)
                            return undefined;
                        Object.defineProperty(target, rootKey, { value: HashMap.create() });
                    }
                    return target[rootKey];
                }
                function FillRandomBytes(buffer, size) {
                    for (var i = 0; i < size; ++i)
                        buffer[i] = Math.random() * 0xff | 0;
                    return buffer;
                }
                function GenRandomBytes(size) {
                    if (typeof Uint8Array === "function") {
                        var array = new Uint8Array(size);
                        if (typeof crypto !== "undefined") {
                            crypto.getRandomValues(array);
                        }
                        else if (typeof msCrypto !== "undefined") {
                            msCrypto.getRandomValues(array);
                        }
                        else {
                            FillRandomBytes(array, size);
                        }
                        return array;
                    }
                    return FillRandomBytes(new Array(size), size);
                }
                function CreateUUID() {
                    var data = GenRandomBytes(UUID_SIZE);
                    // mark as random - RFC 4122 § 4.4
                    data[6] = data[6] & 0x4f | 0x40;
                    data[8] = data[8] & 0xbf | 0x80;
                    var result = "";
                    for (var offset = 0; offset < UUID_SIZE; ++offset) {
                        var byte = data[offset];
                        if (offset === 4 || offset === 6 || offset === 8)
                            result += "-";
                        if (byte < 16)
                            result += "0";
                        result += byte.toString(16).toLowerCase();
                    }
                    return result;
                }
            }
            // uses a heuristic used by v8 and chakra to force an object into dictionary mode.
            function MakeDictionary(obj) {
                obj.__ = undefined;
                delete obj.__;
                return obj;
            }
        });
    })(Reflect$1 || (Reflect$1 = {}));

    function e(e){return ("object"==typeof e&&null!==e||"function"==typeof e)&&"function"==typeof e.then}function t$1(e){switch(typeof e){case "string":case "symbol":return e.toString();case "function":return e.name;default:throw new Error(`Unexpected ${typeof e} service id type`)}}const n=Symbol.for("@inversifyjs/common/islazyServiceIdentifier");class r{[n];#e;constructor(e){this.#e=e,this[n]=true;}static is(e){return "object"==typeof e&&null!==e&&true===e[n]}unwrap(){return this.#e()}}

    function c$1(t,n,e){return Reflect.getOwnMetadata(n,t,e)}function a$1(t,n,e,u){Reflect.defineMetadata(n,e,t,u);}function i(t,n,e,u,f){const r=u(c$1(t,n,f)??e());Reflect.defineMetadata(n,r,t,f);}

    const a="@inversifyjs/container/bindingId";function c(){const i$1=c$1(Object,a)??0;return i$1===Number.MAX_SAFE_INTEGER?a$1(Object,a,Number.MIN_SAFE_INTEGER):i(Object,a,()=>i$1,e=>e+1),i$1}const d={Request:"Request",Singleton:"Singleton",Transient:"Transient"},u={ConstantValue:"ConstantValue",DynamicValue:"DynamicValue",Factory:"Factory",Instance:"Instance",Provider:"Provider",ResolvedValue:"ResolvedValue",ServiceRedirection:"ServiceRedirection"};function*l(...e){for(const t of e)yield*t;}class p{#e;#t;#n;constructor(e){this.#e=new Map,this.#t={};for(const t of Reflect.ownKeys(e))this.#t[t]=new Map;this.#n=e;}add(e,t){this.#i(e).push(t);for(const n of Reflect.ownKeys(t))this.#o(n,t[n]).push(e);}clone(){const e=this.#r(),t=this.#s(),n=Reflect.ownKeys(this.#n),i=this._buildNewInstance(this.#n);this.#a(this.#e,i.#e,e,t);for(const t of n)this.#c(this.#t[t],i.#t[t],e);return i}get(e,t){return this.#t[e].get(t)}getAllKeys(e){return this.#t[e].keys()}removeByRelation(e,t){const n=this.get(e,t);if(void 0===n)return;const i=new Set(n);for(const n of i){const i=this.#e.get(n);if(void 0===i)throw new Error("Expecting model relation, none found");for(const o of i)o[e]===t&&this.#d(n,o);this.#e.delete(n);}}_buildNewInstance(e){return new p(e)}_cloneModel(e){return e}_cloneRelation(e){return e}#r(){const e=new Map;for(const t of this.#e.keys()){const n=this._cloneModel(t);e.set(t,n);}return e}#s(){const e=new Map;for(const t of this.#e.values())for(const n of t){const t=this._cloneRelation(n);e.set(n,t);}return e}#i(e){let t=this.#e.get(e);return void 0===t&&(t=[],this.#e.set(e,t)),t}#o(e,t){let n=this.#t[e].get(t);return void 0===n&&(n=[],this.#t[e].set(t,n)),n}#u(e,t){const n=t.get(e);if(void 0===n)throw new Error("Expecting model to be cloned, none found");return n}#l(e,t){const n=t.get(e);if(void 0===n)throw new Error("Expecting relation to be cloned, none found");return n}#c(e,t,n){for(const[i,o]of e){const e=new Array;for(const t of o)e.push(this.#u(t,n));t.set(i,e);}}#a(e,t,n,i){for(const[o,r]of e){const e=new Array;for(const t of r)e.push(this.#l(t,i));t.set(this.#u(o,n),e);}}#d(e,t){for(const n of Reflect.ownKeys(t))this.#p(e,n,t[n]);}#p(e,t,n){const i=this.#t[t].get(n);if(void 0!==i){const o=i.indexOf(e);-1!==o&&i.splice(o,1),0===i.length&&this.#t[t].delete(n);}}}var f;!function(e){e.moduleId="moduleId",e.serviceId="serviceId";}(f||(f={}));class v{#f;#v;constructor(e,t){this.#f=t??new p({moduleId:{isOptional:true},serviceId:{isOptional:false}}),this.#v=e;}static build(e){return new v(e)}add(e,t){this.#f.add(e,t);}clone(){return new v(this.#v,this.#f.clone())}get(e){const t=[],n=this.#f.get(f.serviceId,e);void 0!==n&&t.push(n);const i=this.#v()?.get(e);if(void 0!==i&&t.push(i),0!==t.length)return l(...t)}removeAllByModuleId(e){this.#f.removeByRelation(f.moduleId,e);}removeAllByServiceId(e){this.#f.removeByRelation(f.serviceId,e);}}const h="@inversifyjs/core/classMetadataReflectKey";function g(){return {constructorArguments:[],lifecycle:{postConstructMethodNames:new Set,preDestroyMethodNames:new Set},properties:new Map,scope:void 0}}const m="@inversifyjs/core/pendingClassMetadataCountReflectKey";const y=Symbol.for("@inversifyjs/core/InversifyCoreError");class M extends Error{[y];kind;constructor(e,t,n){super(t,n),this[y]=true,this.kind=e;}static is(e){return "object"==typeof e&&null!==e&&true===e[y]}static isErrorOfKind(e,t){return M.is(e)&&e.kind===t}}var I$1,b,w,C$1,S;function N$1(t){const n=c$1(t,h)??g();if(!function(t){const n=c$1(t,m);return void 0!==n&&0!==n}(t))return function(e,t){const n=[];if(t.length<e.length)throw new M(I$1.missingInjectionDecorator,`Found unexpected missing metadata on type "${e.name}". "${e.name}" constructor requires at least ${e.length.toString()} arguments, found ${t.length.toString()} instead.\nAre you using @inject, @multiInject or @unmanaged decorators in every non optional constructor argument?\n\nIf you're using typescript and want to rely on auto injection, set "emitDecoratorMetadata" compiler option to true`);for(let e=0;e<t.length;++e) void 0===t[e]&&n.push(e);if(n.length>0)throw new M(I$1.missingInjectionDecorator,`Found unexpected missing metadata on type "${e.name}" at constructor indexes "${n.join('", "')}".\n\nAre you using @inject, @multiInject or @unmanaged decorators at those indexes?\n\nIf you're using typescript and want to rely on auto injection, set "emitDecoratorMetadata" compiler option to true`)}(t,n.constructorArguments),n;!function(e,t){const n=[];for(let i=0;i<t.constructorArguments.length;++i){const o=t.constructorArguments[i];void 0!==o&&o.kind!==b.unknown||n.push(`  - Missing or incomplete metadata for type "${e.name}" at constructor argument with index ${i.toString()}.\nEvery constructor parameter must be decorated either with @inject, @multiInject or @unmanaged decorator.`);}for(const[i,o]of t.properties)o.kind===b.unknown&&n.push(`  - Missing or incomplete metadata for type "${e.name}" at property "${i.toString()}".\nThis property must be decorated either with @inject or @multiInject decorator.`);if(0===n.length)throw new M(I$1.unknown,`Unexpected class metadata for type "${e.name}" with uncompletion traces.\nThis might be caused by one of the following reasons:\n\n1. A third party library is targeting inversify reflection metadata.\n2. A bug is causing the issue. Consider submiting an issue to fix it.`);throw new M(I$1.missingInjectionDecorator,`Invalid class metadata at type ${e.name}:\n\n${n.join("\n\n")}`)}(t,n);}function P$1(e,t){const n=N$1(t).scope??e.scope;return {cache:{isRight:false,value:void 0},id:c(),implementationType:t,isSatisfiedBy:()=>true,moduleId:void 0,onActivation:void 0,onDeactivation:void 0,scope:n,serviceIdentifier:t,type:u.Instance}}function A$1(e){return e.isRight?{isRight:true,value:e.value}:e}function R(e){switch(e.type){case u.ConstantValue:case u.DynamicValue:return function(e){return {cache:A$1(e.cache),id:e.id,isSatisfiedBy:e.isSatisfiedBy,moduleId:e.moduleId,onActivation:e.onActivation,onDeactivation:e.onDeactivation,scope:e.scope,serviceIdentifier:e.serviceIdentifier,type:e.type,value:e.value}}(e);case u.Factory:return function(e){return {cache:A$1(e.cache),factory:e.factory,id:e.id,isSatisfiedBy:e.isSatisfiedBy,moduleId:e.moduleId,onActivation:e.onActivation,onDeactivation:e.onDeactivation,scope:e.scope,serviceIdentifier:e.serviceIdentifier,type:e.type}}(e);case u.Instance:return function(e){return {cache:A$1(e.cache),id:e.id,implementationType:e.implementationType,isSatisfiedBy:e.isSatisfiedBy,moduleId:e.moduleId,onActivation:e.onActivation,onDeactivation:e.onDeactivation,scope:e.scope,serviceIdentifier:e.serviceIdentifier,type:e.type}}(e);case u.Provider:return function(e){return {cache:A$1(e.cache),id:e.id,isSatisfiedBy:e.isSatisfiedBy,moduleId:e.moduleId,onActivation:e.onActivation,onDeactivation:e.onDeactivation,provider:e.provider,scope:e.scope,serviceIdentifier:e.serviceIdentifier,type:e.type}}(e);case u.ResolvedValue:return function(e){return {cache:A$1(e.cache),factory:e.factory,id:e.id,isSatisfiedBy:e.isSatisfiedBy,metadata:e.metadata,moduleId:e.moduleId,onActivation:e.onActivation,onDeactivation:e.onDeactivation,scope:e.scope,serviceIdentifier:e.serviceIdentifier,type:e.type}}(e);case u.ServiceRedirection:return function(e){return {id:e.id,isSatisfiedBy:e.isSatisfiedBy,moduleId:e.moduleId,serviceIdentifier:e.serviceIdentifier,targetServiceIdentifier:e.targetServiceIdentifier,type:e.type}}(e)}}!function(e){e[e.injectionDecoratorConflict=0]="injectionDecoratorConflict",e[e.missingInjectionDecorator=1]="missingInjectionDecorator",e[e.planning=2]="planning",e[e.resolution=3]="resolution",e[e.unknown=4]="unknown";}(I$1||(I$1={})),function(e){e[e.unknown=32]="unknown";}(b||(b={})),function(e){e.id="id",e.moduleId="moduleId",e.serviceId="serviceId";}(w||(w={}));let x$1 = class x extends p{_buildNewInstance(e){return new x(e)}_cloneModel(e){return R(e)}};let T$1 = class T{#h;#g;#v;constructor(e,t,n){this.#g=n??new x$1({id:{isOptional:false},moduleId:{isOptional:true},serviceId:{isOptional:false}}),this.#v=e,this.#h=t;}static build(e,t){return new T(e,t)}clone(){return new T(this.#v,this.#h,this.#g.clone())}get(e){const t=this.getNonParentBindings(e)??this.#v()?.get(e);if(void 0!==t)return t;const n=this.#m(e);return void 0===n?n:[n]}*getChained(e){const t=this.getNonParentBindings(e);void 0!==t&&(yield*t);const n=this.#v();if(void 0===n){if(void 0===t){const t=this.#m(e);void 0!==t&&(yield t);}}else yield*n.getChained(e);}getBoundServices(){const e=new Set(this.#g.getAllKeys(w.serviceId)),t=this.#v();if(void 0!==t)for(const n of t.getBoundServices())e.add(n);return e}getById(e){return this.#g.get(w.id,e)??this.#v()?.getById(e)}getByModuleId(e){return this.#g.get(w.moduleId,e)??this.#v()?.getByModuleId(e)}getNonParentBindings(e){return this.#g.get(w.serviceId,e)}getNonParentBoundServices(){return this.#g.getAllKeys(w.serviceId)}removeById(e){this.#g.removeByRelation(w.id,e);}removeAllByModuleId(e){this.#g.removeByRelation(w.moduleId,e);}removeAllByServiceId(e){this.#g.removeByRelation(w.serviceId,e);}set(e){const t={[w.id]:e.id,[w.serviceId]:e.serviceIdentifier};void 0!==e.moduleId&&(t[w.moduleId]=e.moduleId),this.#g.add(e,t);}#m(e){if(void 0===this.#h||"function"!=typeof e)return;const t=P$1(this.#h,e);return this.set(t),t}};!function(e){e.moduleId="moduleId",e.serviceId="serviceId";}(C$1||(C$1={}));let j$1 = class j{#y;#v;constructor(e,t){this.#y=t??new p({moduleId:{isOptional:true},serviceId:{isOptional:false}}),this.#v=e;}static build(e){return new j(e)}add(e,t){this.#y.add(e,t);}clone(){return new j(this.#v,this.#y.clone())}get(e){const t=[],n=this.#y.get(C$1.serviceId,e);void 0!==n&&t.push(n);const i=this.#v()?.get(e);if(void 0!==i&&t.push(i),0!==t.length)return l(...t)}removeAllByModuleId(e){this.#y.removeByRelation(C$1.moduleId,e);}removeAllByServiceId(e){this.#y.removeByRelation(C$1.serviceId,e);}};!function(e){e[e.multipleInjection=0]="multipleInjection",e[e.singleInjection=1]="singleInjection",e[e.unmanaged=2]="unmanaged";}(S||(S={}));var E$1;!function(e){e[e.method=0]="method",e[e.parameter=1]="parameter",e[e.property=2]="property";}(E$1||(E$1={}));const K$1="@inversifyjs/core/classIsInjectableFlagReflectKey";const q$1=[Array,BigInt,Boolean,Function,Number,Object,String];function G$1(t){const i$1=c$1(t,"design:paramtypes");void 0!==i$1&&i(t,h,g,function(e){return t=>(e.forEach((e,n)=>{var i;void 0!==t.constructorArguments[n]||(i=e,q$1.includes(i))||(t.constructorArguments[n]=function(e){return {isFromTypescriptParamType:true,kind:S.singleInjection,name:void 0,optional:false,tags:new Map,value:e}}(e));}),t)}(i$1));}function W$1(i$1){return o=>{!function(n){if(void 0!==c$1(n,K$1))throw new M(I$1.injectionDecoratorConflict,`Cannot apply @injectable decorator multiple times at class "${n.name}"`);a$1(n,K$1,true);}(o),G$1(o);}}var fe;function ve(e){if(!(e instanceof Error))return  false;return e instanceof RangeError&&/stack space|call stack|too much recursion/i.test(e.message)||"InternalError"===e.name&&/too much recursion/.test(e.message)}function he(e,t){if(ve(t)){const n=function(e){const t=[...e];if(0===t.length)return "(No dependency trace)";return t.map(t$1).join(" -> ")}(function(e){const t=new Set;for(const n of e.servicesBranch){if(t.has(n))return [...t,n];t.add(n);}return [...t]}(e));throw new M(I$1.planning,`Circular dependency found: ${n}`,{cause:t})}throw t}!function(e){e[e.multipleInjection=0]="multipleInjection",e[e.singleInjection=1]="singleInjection";}(fe||(fe={}));const ge=Symbol.for("@inversifyjs/core/LazyPlanServiceNode");class me{[ge];_serviceIdentifier;_serviceNode;constructor(e,t){this[ge]=true,this._serviceNode=e,this._serviceIdentifier=t;}get bindings(){return this._getNode().bindings}get isContextFree(){return this._getNode().isContextFree}get serviceIdentifier(){return this._serviceIdentifier}set bindings(e){this._getNode().bindings=e;}set isContextFree(e){this._getNode().isContextFree=e;}static is(e){return "object"==typeof e&&null!==e&&true===e[ge]}invalidate(){this._serviceNode=void 0;}isExpanded(){return void 0!==this._serviceNode}_getNode(){return void 0===this._serviceNode&&(this._serviceNode=this._buildPlanServiceNode()),this._serviceNode}}class ye{#M;constructor(e){this.#M=e;}get name(){return this.#M.elem.name}get serviceIdentifier(){return this.#M.elem.serviceIdentifier}get tags(){return this.#M.elem.tags}getAncestor(){if(this.#M.elem.getAncestorsCalled=true,void 0!==this.#M.previous)return new ye(this.#M.previous)}}function Me(e,t,n){const i=n?.customServiceIdentifier??t.serviceIdentifier,o=(true===n?.chained?[...e.operations.getBindingsChained(i)]:[...e.operations.getBindings(i)??[]]).filter(e=>e.isSatisfiedBy(t));if(0===o.length&&void 0!==e.autobindOptions&&"function"==typeof i){const n=P$1(e.autobindOptions,i);e.operations.setBinding(n),n.isSatisfiedBy(t)&&o.push(n);}return o}class Ie{last;constructor(e){this.last=e;}concat(e){return new Ie({elem:e,previous:this.last})}[Symbol.iterator](){let e=this.last;return {next:()=>{if(void 0===e)return {done:true,value:void 0};const t=e.elem;return e=e.previous,{done:false,value:t}}}}}function be(e){const t=new Map;return void 0!==e.rootConstraints.tag&&t.set(e.rootConstraints.tag.key,e.rootConstraints.tag.value),new Ie({elem:{getAncestorsCalled:false,name:e.rootConstraints.name,serviceIdentifier:e.rootConstraints.serviceIdentifier,tags:t},previous:void 0})}function we(e){return void 0!==e.redirections}function Ce(e,t,n,i){const r=n.elem.serviceIdentifier,s=n.previous?.elem.serviceIdentifier;Array.isArray(e)?function(e,t,n,i,r,s){if(0!==e.length){const t=s[s.length-1]??n,a=`Ambiguous bindings found for service: "${t$1(t)}".${Ae(s)}\n\nRegistered bindings:\n\n${e.map(e=>function(e){switch(e.type){case u.Instance:return `[ type: "${e.type}", serviceIdentifier: "${t$1(e.serviceIdentifier)}", scope: "${e.scope}", implementationType: "${e.implementationType.name}" ]`;case u.ServiceRedirection:return `[ type: "${e.type}", serviceIdentifier: "${t$1(e.serviceIdentifier)}", redirection: "${t$1(e.targetServiceIdentifier)}" ]`;default:return `[ type: "${e.type}", serviceIdentifier: "${t$1(e.serviceIdentifier)}", scope: "${e.scope}" ]`}}(e.binding)).join("\n")}\n\nTrying to resolve bindings for "${Ne(n,i)}".${Pe(r)}`;throw new M(I$1.planning,a)}t||Se(n,i,r,s);}(e,t,r,s,n.elem,i):function(e,t,n,i,o,r){ void 0!==e||t||Se(n,i,o,r);}(e,t,r,s,n.elem,i);}function Se(e,t,n,i){const r=i[i.length-1]??e,s=`No bindings found for service: "${t$1(r)}".\n\nTrying to resolve bindings for "${Ne(e,t)}".${Ae(i)}${Pe(n)}`;throw new M(I$1.planning,s)}function Ne(e,t){return void 0===t?`${t$1(e)} (Root service)`:t$1(t)}function Pe(e){const t=0===e.tags.size?"":`\n- tags:\n  - ${[...e.tags.keys()].map(e=>e.toString()).join("\n  - ")}`;return `\n\nBinding constraints:\n- service identifier: ${t$1(e.serviceIdentifier)}\n- name: ${e.name?.toString()??"-"}${t}`}function Ae(e){return 0===e.length?"":`\n\n- service redirections:\n  - ${e.map(e=>t$1(e)).join("\n  - ")}`}function Re(e,t,n,i){if(1===e.redirections.length){const[o]=e.redirections;return void(we(o)&&Re(o,t,n,[...i,o.binding.targetServiceIdentifier]))}Ce(e.redirections,t,n,i);}function xe(e,t,n){if(Array.isArray(e.bindings)&&1===e.bindings.length){const[i]=e.bindings;return void(we(i)&&Re(i,t,n,[i.binding.targetServiceIdentifier]))}Ce(e.bindings,t,n,[]);}function Te(e){return r.is(e)?e.unwrap():e}function je(e){return (t,n,i)=>{const o=Te(i.value),r=n.concat({getAncestorsCalled:false,name:i.name,serviceIdentifier:o,tags:i.tags}),s=new ye(r.last),a=i.kind===S.multipleInjection&&i.chained,c=Me(t,s,{chained:a}),d=[],u={bindings:d,isContextFree:true,serviceIdentifier:o};if(d.push(...e(t,r,c,u,a)),u.isContextFree=!r.last.elem.getAncestorsCalled,i.kind===S.singleInjection){xe(u,i.optional,r.last);const[e]=d;u.bindings=e;}return u}}function Be(e){return (t,n,i)=>{const o=Te(i.value),r=n.concat({getAncestorsCalled:false,name:i.name,serviceIdentifier:o,tags:i.tags}),s=new ye(r.last),a=i.kind===fe.multipleInjection&&i.chained,c=Me(t,s,{chained:a}),d=[],u={bindings:d,isContextFree:true,serviceIdentifier:o};if(d.push(...e(t,r,c,u,a)),u.isContextFree=!r.last.elem.getAncestorsCalled,i.kind===fe.singleInjection){xe(u,i.optional,r.last);const[e]=d;u.bindings=e;}return u}}function Fe(e){const t=function(e){return (t,n,i)=>{const o={binding:n,classMetadata:t.operations.getClassMetadata(n.implementationType),constructorParams:[],propertyParams:new Map},r={autobindOptions:t.autobindOptions,node:o,operations:t.operations,servicesBranch:t.servicesBranch};return e(r,i)}}(e),n=function(e){return (t,n,i)=>{const o={binding:n,params:[]},r={autobindOptions:t.autobindOptions,node:o,operations:t.operations,servicesBranch:t.servicesBranch};return e(r,i)}}(e),i=(e,i,r,s,a)=>{const c=we(s)?s.binding.targetServiceIdentifier:s.serviceIdentifier;e.servicesBranch.push(c);const d=[];for(const s of r)switch(s.type){case u.Instance:d.push(t(e,s,i));break;case u.ResolvedValue:d.push(n(e,s,i));break;case u.ServiceRedirection:{const t=o(e,i,s,a);d.push(t);break}default:d.push({binding:s});}return e.servicesBranch.pop(),d},o=function(e){return (t,n,i,o)=>{const r={binding:i,redirections:[]},s=Me(t,new ye(n.last),{chained:o,customServiceIdentifier:i.targetServiceIdentifier});return r.redirections.push(...e(t,n,s,r,o)),r}}(i);return i}function ke(e,t,n,i){if(void 0!==e&&(me.is(n)&&!n.isExpanded()||n.isContextFree)){const i={tree:{root:n}};t.setPlan(e,i);}else t.setNonCachedServiceNode(n,i);}class $e extends me{#I;#b;#w;#C;constructor(e,t,n,i,o){super(o,Te(i.value)),this.#b=t,this.#I=e,this.#w=n,this.#C=i;}_buildPlanServiceNode(){return this.#b(this.#I,this.#w,this.#C)}}class De extends me{#I;#S;#w;#N;constructor(e,t,n,i,o){super(o,Te(i.value)),this.#I=e,this.#S=t,this.#w=n,this.#N=i;}_buildPlanServiceNode(){return this.#S(this.#I,this.#w,this.#N)}}function Ve(e,t,n,i){const o=function(e,t){const n=function(e,t){return (n,i,o)=>{if(o.kind===S.unmanaged)return;const s=function(e){let t;if(0===e.tags.size)t=void 0;else {if(1!==e.tags.size)return;{const[n,i]=e.tags.entries().next().value;t={key:n,value:i};}}const n=r.is(e.value)?e.value.unwrap():e.value;return e.kind===S.multipleInjection?{chained:e.chained,isMultiple:true,name:e.name,optional:e.optional,serviceIdentifier:n,tag:t}:{isMultiple:false,name:e.name,optional:e.optional,serviceIdentifier:n,tag:t}}(o);if(void 0!==s){const e=n.operations.getPlan(s);if(void 0!==e&&e.tree.root.isContextFree)return e.tree.root}const a=t(n,i,o),c=new $e(n,e,i,o,a);return ke(s,n.operations,c,{bindingConstraintsList:i,chainedBindings:o.kind===S.multipleInjection&&o.chained,optionalBindings:o.optional}),c}}(e,t);return (e,t,i)=>{const o=t.classMetadata;for(const[r,s]of o.constructorArguments.entries())t.constructorParams[r]=n(e,i,s);for(const[r,s]of o.properties){const o=n(e,i,s);void 0!==o&&t.propertyParams.set(r,o);}return e.node}}(e,n),s=function(e,t){const n=function(e,t){return (n,i,o)=>{const s=function(e){let t;if(0===e.tags.size)t=void 0;else {if(1!==e.tags.size)return;{const[n,i]=e.tags.entries().next().value;t={key:n,value:i};}}const n=r.is(e.value)?e.value.unwrap():e.value;return e.kind===fe.multipleInjection?{chained:e.chained,isMultiple:true,name:e.name,optional:e.optional,serviceIdentifier:n,tag:t}:{isMultiple:false,name:e.name,optional:e.optional,serviceIdentifier:n,tag:t}}(o);if(void 0!==s){const e=n.operations.getPlan(s);if(void 0!==e&&e.tree.root.isContextFree)return e.tree.root}const a=t(n,i,o),c=new De(n,e,i,o,a);return ke(s,n.operations,c,{bindingConstraintsList:i,chainedBindings:o.kind===fe.multipleInjection&&o.chained,optionalBindings:o.optional}),c}}(e,t);return (e,t,i)=>{const o=t.binding.metadata;for(const[r,s]of o.arguments.entries())t.params[r]=n(e,i,s);return e.node}}(t,i);return (e,t)=>e.node.binding.type===u.Instance?o(e,e.node,t):s(e,e.node,t)}class Oe extends me{#I;constructor(e,t){super(t,t.serviceIdentifier),this.#I=e;}_buildPlanServiceNode(){return Ue(this.#I)}}const Ee=je(Le),_e=Be(Le),ze=Fe(Ve(Ee,_e,Ee,_e));function Le(e,t,n,i,o){return ze(e,t,n,i,o)}const Ue=function(e){return t=>{const n=be(t),i=new ye(n.last),o=t.rootConstraints.isMultiple&&t.rootConstraints.chained,r=Me(t,i,{chained:o}),s=[],a={bindings:s,isContextFree:true,serviceIdentifier:t.rootConstraints.serviceIdentifier};if(s.push(...e(t,n,r,a,o)),a.isContextFree=!n.last.elem.getAncestorsCalled,!t.rootConstraints.isMultiple){xe(a,t.rootConstraints.isOptional??false,n.last);const[e]=s;a.bindings=e;}return a}}(ze);function Ke(e){try{const t=function(e){return e.rootConstraints.isMultiple?{chained:e.rootConstraints.chained,isMultiple:!0,name:e.rootConstraints.name,optional:e.rootConstraints.isOptional??!1,serviceIdentifier:e.rootConstraints.serviceIdentifier,tag:e.rootConstraints.tag}:{isMultiple:!1,name:e.rootConstraints.name,optional:e.rootConstraints.isOptional??!1,serviceIdentifier:e.rootConstraints.serviceIdentifier,tag:e.rootConstraints.tag}}(e),n=e.operations.getPlan(t);if(void 0!==n)return n;const i=Ue(e),o={tree:{root:new Oe(e,i)}};return e.operations.setPlan(t,o),o}catch(t){he(e,t);}}var qe;!function(e){e.bindingAdded="bindingAdded",e.bindingRemoved="bindingRemoved";}(qe||(qe={}));class Ge{#P;#A;#R;constructor(){this.#P=[],this.#A=8,this.#R=1024;}*[Symbol.iterator](){let e=0;for(const t of this.#P){const n=t.deref();void 0===n?++e:yield n;}this.#P.length>=this.#A&&this.#x(e)&&this.#T(e);}push(e){const t=new WeakRef(e);if(this.#P.push(t),this.#P.length>=this.#A&&this.#P.length%this.#R===0){let e=0;for(const t of this.#P) void 0===t.deref()&&++e;this.#x(e)&&this.#T(e);}}#T(e){const t=new Array(this.#P.length-e);let n=0;for(const e of this.#P)e.deref()&&(t[n++]=e);this.#P=t;}#x(e){return e>=.5*this.#P.length}}const We=Fe(Ve(Ee,_e,function(e,t,n){return Xe(e,t,n)},function(e,t,n){return He(e,t,n)})),Xe=function(e){const t=je(e);return (e,n,i)=>{try{return t(e,n,i)}catch(e){if(M.isErrorOfKind(e,I$1.planning))return;throw e}}}(We),He=function(e){const t=Be(e);return (e,n,i)=>{try{return t(e,n,i)}catch(e){if(M.isErrorOfKind(e,I$1.planning))return;throw e}}}(We);function Je(e,t,n,i,o){if(me.is(t)&&!t.isExpanded())return {isContextFreeBinding:true,shouldInvalidateServiceNode:false};const r=new ye(i.last);return !n.isSatisfiedBy(r)||i.last.elem.getAncestorsCalled?{isContextFreeBinding:!i.last.elem.getAncestorsCalled,shouldInvalidateServiceNode:false}:function(e,t,n,i,o){let r;try{[r]=We(e,i,[n],t,o);}catch(e){if(ve(e))return {isContextFreeBinding:false,shouldInvalidateServiceNode:true};throw e}return function(e,t){if(Array.isArray(e.bindings))e.bindings.push(t);else {if(void 0!==e.bindings){if(!me.is(e))throw new M(I$1.planning,"Unexpected non-lazy plan service node. This is likely a bug in the planning logic. Please, report this issue");return {isContextFreeBinding:true,shouldInvalidateServiceNode:true}}e.bindings=t;}return {isContextFreeBinding:true,shouldInvalidateServiceNode:false}}(t,r)}(e,t,n,i,o)}function Qe(e,t,n,i){if(me.is(e)&&!e.isExpanded())return {bindingNodeRemoved:void 0,isContextFreeBinding:true};const o=new ye(n.last);if(!t.isSatisfiedBy(o)||n.last.elem.getAncestorsCalled)return {bindingNodeRemoved:void 0,isContextFreeBinding:!n.last.elem.getAncestorsCalled};let r;if(Array.isArray(e.bindings))e.bindings=e.bindings.filter(e=>e.binding!==t||(r=e,false));else if(e.bindings?.binding===t)if(r=e.bindings,i)e.bindings=void 0;else {if(!me.is(e))throw new M(I$1.planning,"Unexpected non-lazy plan service node. This is likely a bug in the planning logic. Please, report this issue");e.invalidate();}return {bindingNodeRemoved:r,isContextFreeBinding:true}}class Ye{#j;#B;#F;#k;#$;#D;constructor(){this.#j=new Map,this.#B=this.#V(),this.#F=this.#V(),this.#k=this.#V(),this.#$=this.#V(),this.#D=new Ge;}clearCache(){for(const e of this.#O())e.clear();for(const e of this.#D)e.clearCache();}get(e){return void 0===e.name?void 0===e.tag?this.#E(this.#B,e).get(e.serviceIdentifier):this.#E(this.#$,e).get(e.serviceIdentifier)?.get(e.tag.key)?.get(e.tag.value):void 0===e.tag?this.#E(this.#F,e).get(e.serviceIdentifier)?.get(e.name):this.#E(this.#k,e).get(e.serviceIdentifier)?.get(e.name)?.get(e.tag.key)?.get(e.tag.value)}invalidateServiceBinding(e){this.#_(e),this.#z(e),this.#L(e),this.#U(e),this.#K(e);for(const t of this.#D)t.invalidateServiceBinding(e);}set(e,t){ void 0===e.name?void 0===e.tag?this.#E(this.#B,e).set(e.serviceIdentifier,t):this.#q(this.#q(this.#E(this.#$,e),e.serviceIdentifier),e.tag.key).set(e.tag.value,t):void 0===e.tag?this.#q(this.#E(this.#F,e),e.serviceIdentifier).set(e.name,t):this.#q(this.#q(this.#q(this.#E(this.#k,e),e.serviceIdentifier),e.name),e.tag.key).set(e.tag.value,t);}setNonCachedServiceNode(e,t){let n=this.#j.get(e.serviceIdentifier);void 0===n&&(n=new Map,this.#j.set(e.serviceIdentifier,n)),n.set(e,t);}subscribe(e){this.#D.push(e);}#V(){const e=new Array(8);for(let t=0;t<e.length;++t)e[t]=new Map;return e}#G(e,t,n,i){const o=!!(2&t);let r;if(o){r={chained:!!(0&t),isMultiple:o,serviceIdentifier:e.binding.serviceIdentifier};}else r={isMultiple:o,serviceIdentifier:e.binding.serviceIdentifier};return !!(1&t)&&(r.isOptional=true),void 0!==n&&(r.name=n),void 0!==i&&(r.tag=i),{autobindOptions:void 0,operations:e.operations,rootConstraints:r,servicesBranch:[]}}#q(e,t){let n=e.get(t);return void 0===n&&(n=new Map,e.set(t,n)),n}#E(e,t){return e[this.#W(t)]}#O(){return [this.#j,...this.#B,...this.#F,...this.#k,...this.#$]}#W(e){return e.isMultiple?(e.chained?4:0)|(e.optional?1:0)|2:e.optional?1:0}#z(e){for(const[t,n]of this.#F.entries()){const i=n.get(e.binding.serviceIdentifier);if(void 0!==i)for(const[n,o]of i.entries())this.#X(e,o,t,n,void 0);}}#L(e){for(const[t,n]of this.#k.entries()){const i=n.get(e.binding.serviceIdentifier);if(void 0!==i)for(const[n,o]of i.entries())for(const[i,r]of o.entries())for(const[o,s]of r.entries())this.#X(e,s,t,n,{key:i,value:o});}}#H(e){switch(e.binding.type){case u.ServiceRedirection:for(const t of e.redirections)this.#H(t);break;case u.Instance:for(const t of e.constructorParams) void 0!==t&&this.#J(t);for(const t of e.propertyParams.values())this.#J(t);break;case u.ResolvedValue:for(const t of e.params)this.#J(t);}}#J(e){const t=this.#j.get(e.serviceIdentifier);void 0!==t&&t.has(e)&&(t.delete(e),this.#Q(e));}#Q(e){if((!me.is(e)||e.isExpanded())&&void 0!==e.bindings)if(Array.isArray(e.bindings))for(const t of e.bindings)this.#H(t);else this.#H(e.bindings);}#K(e){const t=this.#j.get(e.binding.serviceIdentifier);if(void 0!==t)switch(e.kind){case qe.bindingAdded:for(const[n,i]of t){const t=Je({autobindOptions:void 0,operations:e.operations,servicesBranch:[]},n,e.binding,i.bindingConstraintsList,i.chainedBindings);t.isContextFreeBinding?t.shouldInvalidateServiceNode&&me.is(n)&&(this.#Q(n),n.invalidate()):this.clearCache();}break;case qe.bindingRemoved:for(const[n,i]of t){const t=Qe(n,e.binding,i.bindingConstraintsList,i.optionalBindings);t.isContextFreeBinding?void 0!==t.bindingNodeRemoved&&this.#H(t.bindingNodeRemoved):this.clearCache();}}}#_(e){for(const[t,n]of this.#B.entries()){const i=n.get(e.binding.serviceIdentifier);this.#X(e,i,t,void 0,void 0);}}#U(e){for(const[t,n]of this.#$.entries()){const i=n.get(e.binding.serviceIdentifier);if(void 0!==i)for(const[n,o]of i.entries())for(const[i,r]of o.entries())this.#X(e,r,t,void 0,{key:n,value:i});}}#X(e,t,n,i,o){if(void 0!==t&&me.is(t.tree.root)){const c=this.#G(e,n,i,o);switch(e.kind){case qe.bindingAdded:{const n=(r=c,s=t.tree.root,a=e.binding,me.is(s)&&!s.isExpanded()?{isContextFreeBinding:true,shouldInvalidateServiceNode:false}:Je(r,s,a,be(r),r.rootConstraints.isMultiple&&r.rootConstraints.chained));n.isContextFreeBinding?n.shouldInvalidateServiceNode&&(this.#Q(t.tree.root),t.tree.root.invalidate()):this.clearCache();}break;case qe.bindingRemoved:{const n=function(e,t,n){return me.is(t)&&!t.isExpanded()?{bindingNodeRemoved:void 0,isContextFreeBinding:true}:Qe(t,n,be(e),e.rootConstraints.isOptional??false)}(c,t.tree.root,e.binding);n.isContextFreeBinding?void 0!==n.bindingNodeRemoved&&this.#H(n.bindingNodeRemoved):this.clearCache();}}}var r,s,a;}}function Ze(e,t){if(ve(t)){const n=function(e){const t=[...e];if(0===t.length)return "(No dependency trace)";return t.map(t$1).join(" -> ")}(function(e){const t=e.planResult.tree.root,n=[];function i(e){const t=n.indexOf(e);if(-1!==t){return [...n.slice(t),e].map(e=>e.serviceIdentifier)}n.push(e);try{for(const t of function(e){const t=[],n=e.bindings;if(void 0===n)return t;const i=e=>{if(we(e))for(const t of e.redirections)i(t);else switch(e.binding.type){case u.Instance:{const n=e;for(const e of n.constructorParams)void 0!==e&&t.push(e);for(const e of n.propertyParams.values())t.push(e);break}case u.ResolvedValue:{const n=e;for(const e of n.params)t.push(e);break}}};if(Array.isArray(n))for(const e of n)i(e);else i(n);return t}(e)){const e=i(t);if(void 0!==e)return e}}finally{n.pop();}}return i(t)??[]}(e));throw new M(I$1.planning,`Circular dependency found: ${n}`,{cause:t})}throw t}function et(e$1,t){return e(t)?(e$1.cache={isRight:true,value:t},t.then(t=>tt(e$1,t))):tt(e$1,t)}function tt(e,t){return e.cache={isRight:true,value:t},t}function nt(e$1,t,n){const i=e$1.getActivations(t);return void 0===i?n:e(n)?it(e$1,n,i[Symbol.iterator]()):function(e$1,t,n){let i=t,o=n.next();for(;true!==o.done;){const t=o.value(e$1.context,i);if(e(t))return it(e$1,t,n);i=t,o=n.next();}return i}(e$1,n,i[Symbol.iterator]())}async function it(e,t,n){let i=await t,o=n.next();for(;true!==o.done;)i=await o.value(e.context,i),o=n.next();return i}function ot(e$1,t,n){let i=n;if(void 0!==t.onActivation){const n=t.onActivation;i=e(i)?i.then(t=>n(e$1.context,t)):n(e$1.context,i);}return nt(e$1,t.serviceIdentifier,i)}function rt(e){return (t,n)=>{if(n.cache.isRight)return n.cache.value;return et(n,ot(t,n,e(t,n)))}}const st=rt(function(e,t){return t.value});function at(e){return e}function ct(e,t){return (n,i)=>{const o=e(i);switch(o.scope){case d.Singleton:if(o.cache.isRight)return o.cache.value;return et(o,ot(n,o,t(n,i)));case d.Request:{if(n.requestScopeCache.has(o.id))return n.requestScopeCache.get(o.id);const e=ot(n,o,t(n,i));return n.requestScopeCache.set(o.id,e),e}case d.Transient:return ot(n,o,t(n,i))}}}const dt=(e=>ct(at,e))(function(e,t){return t.value(e.context)});const ut=rt(function(e,t){return t.factory(e.context)});function lt(e$1,t,n){const i=function(e$1,t,n){if(!(n in e$1))throw new M(I$1.resolution,`Expecting a "${n.toString()}" property when resolving "${t.implementationType.name}" class @postConstruct decorated method, none found.`);if("function"!=typeof e$1[n])throw new M(I$1.resolution,`Expecting a "${n.toString()}" method when resolving "${t.implementationType.name}" class @postConstruct decorated method, a non function property was found instead.`);{let i;try{i=e$1[n]();}catch(e){throw new M(I$1.resolution,`Unexpected error found when calling "${n.toString()}" @postConstruct decorated method on class "${t.implementationType.name}"`,{cause:e})}if(e(i))return async function(e,t,n){try{await n;}catch(n){throw new M(I$1.resolution,`Unexpected error found when calling "${t.toString()}" @postConstruct decorated method on class "${e.implementationType.name}"`,{cause:n})}}(t,n,i)}}(e$1,t,n);return e(i)?i.then(()=>e$1):e$1}function pt(e$1,t,n){if(0===n.size)return e$1;let i=e$1;for(const e$1 of n)i=e(i)?i.then(n=>lt(n,t,e$1)):lt(i,t,e$1);return i}function ft(e$1){return (t,n,i)=>{const o=new i.binding.implementationType(...t),r=e$1(n,o,i);return e(r)?r.then(()=>pt(o,i.binding,i.classMetadata.lifecycle.postConstructMethodNames)):pt(o,i.binding,i.classMetadata.lifecycle.postConstructMethodNames)}}const vt=rt(function(e,t){return t.provider(e.context)});function ht(e){return e.binding}function gt(e){return e.binding}const mt=function(e$1){return (t,n,i)=>{const o=[];for(const[r,a]of i.propertyParams){const c=i.classMetadata.properties.get(r);if(void 0===c)throw new M(I$1.resolution,`Expecting metadata at property "${r.toString()}", none found`);c.kind!==S.unmanaged&&void 0!==a.bindings&&(n[r]=e$1(t,a),e(n[r])&&o.push((async()=>{n[r]=await n[r];})()));}if(o.length>0)return Promise.all(o).then(()=>{})}}(Nt),yt=function(e){return function t(n,i){const o=[];for(const r of i.redirections)we(r)?o.push(...t(n,r)):o.push(e(n,r));return o}}(St),Mt=function(e$1,t,n){return (i,o)=>{const r=e$1(i,o);return e(r)?t(r,i,o):n(r,i,o)}}(function(e$1){return (t,n)=>{const i=[];for(const o of n.constructorParams) void 0===o?i.push(void 0):i.push(e$1(t,o));return i.some(e)?Promise.all(i):i}}(Nt),function(e){return async(t,n,i)=>{const o=await t;return e(o,n,i)}}(ft(mt)),ft(mt)),It=function(e$1){return (t,n)=>{const i=e$1(t,n);return e(i)?i.then(e=>n.binding.factory(...e)):n.binding.factory(...i)}}(function(e$1){return (t,n)=>{const i=[];for(const o of n.params)i.push(e$1(t,o));return i.some(e)?Promise.all(i):i}}(Nt)),bt=(e=>ct(ht,e))(Mt),wt=(e=>ct(gt,e))(It);function Ct(e){try{return Nt(e,e.planResult.tree.root)}catch(t){Ze(e,t);}}function St(e,t){switch(t.binding.type){case u.ConstantValue:return st(e,t.binding);case u.DynamicValue:return dt(e,t.binding);case u.Factory:return ut(e,t.binding);case u.Instance:return bt(e,t);case u.Provider:return vt(e,t.binding);case u.ResolvedValue:return wt(e,t)}}function Nt(e$1,t){if(void 0!==t.bindings)return Array.isArray(t.bindings)?function(e$1,t){const n=[];for(const i of t)we(i)?n.push(...yt(e$1,i)):n.push(St(e$1,i));if(n.some(e))return Promise.all(n);return n}(e$1,t.bindings):function(e,t){if(we(t)){const n=yt(e,t);if(1===n.length)return n[0];throw new M(I$1.resolution,"Unexpected multiple resolved values on single injection")}return St(e,t)}(e$1,t.bindings)}function Pt(e){return void 0!==e.scope}function At(e,t){if("function"==typeof e[t]){return e[t]()}}function Rt(e,t){const n=e.lifecycle.preDestroyMethodNames;if(0===n.size)return;let i;for(const e of n)i=void 0===i?At(t,e):i.then(()=>At(t,e));return i}function xt(e$1,t,n){const i=e$1.getDeactivations(t);if(void 0!==i)return e(n)?Tt(n,i[Symbol.iterator]()):function(e$1,t){let n=t.next();for(;true!==n.done;){const i=n.value(e$1);if(e(i))return Tt(e$1,t);n=t.next();}}(n,i[Symbol.iterator]())}async function Tt(e,t){const n=await e;let i=t.next();for(;true!==i.done;)await i.value(n),i=t.next();}function jt(e$1,t){const n=function(e$1,t){if(t.type===u.Instance){const n=e$1.getClassMetadata(t.implementationType),i=t.cache.value;return e(i)?i.then(e=>Rt(n,e)):Rt(n,i)}}(e$1,t);return void 0===n?Bt(e$1,t):n.then(()=>Bt(e$1,t))}function Bt(e$1,t){const n=t.cache;return e(n.value)?n.value.then(n=>Ft(e$1,t,n)):Ft(e$1,t,n.value)}function Ft(e,t,n){let i;if(void 0!==t.onDeactivation){i=(0, t.onDeactivation)(n);}return void 0===i?xt(e,t.serviceIdentifier,n):i.then(()=>xt(e,t.serviceIdentifier,n))}function kt(e,t){if(void 0===t)return;const n=function(e){const t=[];for(const n of e)Pt(n)&&n.scope===d.Singleton&&n.cache.isRight&&t.push(n);return t}(t),i=[];for(const t of n){const n=jt(e,t);void 0!==n&&i.push(n);}return i.length>0?Promise.all(i).then(()=>{}):void 0}function $t(e,t){const n=e.getBindingsFromModule(t);return kt(e,n)}function Dt(e,t){const n=e.getBindings(t);return kt(e,n)}

    const t=Symbol.for("@inversifyjs/plugin/isPlugin");

    const I=Symbol.for("@inversifyjs/container/bindingIdentifier");function A(e){return "object"==typeof e&&null!==e&&true===e[I]}class P{static always=e=>true}const C=Symbol.for("@inversifyjs/container/InversifyContainerError");class B extends Error{[C];kind;constructor(e,n,i){super(n,i),this[C]=true,this.kind=e;}static is(e){return "object"==typeof e&&null!==e&&true===e[C]}static isErrorOfKind(e,n){return B.is(e)&&e.kind===n}}var O;function x(e){return {[I]:true,id:e.id}}function k(e){return n=>{for(let i=n.getAncestor();void 0!==i;i=i.getAncestor())if(e(i))return  true;return  false}}function N(e){return n=>n.name===e}function F(e){return n=>n.serviceIdentifier===e}function U(e,n){return i=>i.tags.has(e)&&i.tags.get(e)===n}function D(e){return void 0===e.name&&0===e.tags.size}function j(e){const n=k(e);return e=>!n(e)}function T(e){return n=>{const i=n.getAncestor();return void 0===i||!e(i)}}function V(e){return n=>{const i=n.getAncestor();return void 0!==i&&e(i)}}!function(e){e[e.invalidOperation=0]="invalidOperation";}(O||(O={}));class E{#i;constructor(e){this.#i=e;}getIdentifier(){return x(this.#i)}inRequestScope(){return this.#i.scope=d.Request,new G(this.#i)}inSingletonScope(){return this.#i.scope=d.Singleton,new G(this.#i)}inTransientScope(){return this.#i.scope=d.Transient,new G(this.#i)}}class L{#t;#r;#a;#s;constructor(e,n,i,t){this.#t=e,this.#r=n,this.#a=i,this.#s=t;}to(e){const n=N$1(e),i={cache:{isRight:false,value:void 0},id:c(),implementationType:e,isSatisfiedBy:P.always,moduleId:this.#r,onActivation:void 0,onDeactivation:void 0,scope:n.scope??this.#a,serviceIdentifier:this.#s,type:u.Instance};return this.#t(i),new H(i)}toSelf(){if("function"!=typeof this.#s)throw new Error('"toSelf" function can only be applied when a newable function is used as service identifier');return this.to(this.#s)}toConstantValue(e){const n={cache:{isRight:false,value:void 0},id:c(),isSatisfiedBy:P.always,moduleId:this.#r,onActivation:void 0,onDeactivation:void 0,scope:d.Singleton,serviceIdentifier:this.#s,type:u.ConstantValue,value:e};return this.#t(n),new G(n)}toDynamicValue(e){const n={cache:{isRight:false,value:void 0},id:c(),isSatisfiedBy:P.always,moduleId:this.#r,onActivation:void 0,onDeactivation:void 0,scope:this.#a,serviceIdentifier:this.#s,type:u.DynamicValue,value:e};return this.#t(n),new H(n)}toResolvedValue(e,n){const i={cache:{isRight:false,value:void 0},factory:e,id:c(),isSatisfiedBy:P.always,metadata:this.#o(n),moduleId:this.#r,onActivation:void 0,onDeactivation:void 0,scope:this.#a,serviceIdentifier:this.#s,type:u.ResolvedValue};return this.#t(i),new H(i)}toFactory(e){const n={cache:{isRight:false,value:void 0},factory:e,id:c(),isSatisfiedBy:P.always,moduleId:this.#r,onActivation:void 0,onDeactivation:void 0,scope:d.Singleton,serviceIdentifier:this.#s,type:u.Factory};return this.#t(n),new G(n)}toProvider(e){const n={cache:{isRight:false,value:void 0},id:c(),isSatisfiedBy:P.always,moduleId:this.#r,onActivation:void 0,onDeactivation:void 0,provider:e,scope:d.Singleton,serviceIdentifier:this.#s,type:u.Provider};return this.#t(n),new G(n)}toService(e){const n={id:c(),isSatisfiedBy:P.always,moduleId:this.#r,serviceIdentifier:this.#s,targetServiceIdentifier:e,type:u.ServiceRedirection};this.#t(n);}#o(e){return {arguments:(e??[]).map(e=>function(e){return "object"==typeof e&&!r.is(e)}(e)?function(e){return  true===e.isMultiple}(e)?{chained:e.chained??false,kind:fe.multipleInjection,name:e.name,optional:e.optional??false,tags:new Map((e.tags??[]).map(e=>[e.key,e.value])),value:e.serviceIdentifier}:{kind:fe.singleInjection,name:e.name,optional:e.optional??false,tags:new Map((e.tags??[]).map(e=>[e.key,e.value])),value:e.serviceIdentifier}:{kind:fe.singleInjection,name:void 0,optional:false,tags:new Map,value:e})}}}class ${#i;constructor(e){this.#i=e;}getIdentifier(){return x(this.#i)}onActivation(e){return this.#i.onActivation=e,new q(this.#i)}onDeactivation(e){if(this.#i.onDeactivation=e,this.#i.scope!==d.Singleton)throw new B(O.invalidOperation,`Binding for service "${t$1(this.#i.serviceIdentifier)}" has a deactivation function, but its scope is not singleton. Deactivation functions can only be used with singleton bindings.`);return new q(this.#i)}}class q{#i;constructor(e){this.#i=e;}getIdentifier(){return x(this.#i)}when(e){return this.#i.isSatisfiedBy=e,new $(this.#i)}whenAnyAncestor(e){return this.when(k(e))}whenAnyAncestorIs(e){return this.when(k(F(e)))}whenAnyAncestorNamed(e){return this.when(function(e){return k(N(e))}(e))}whenAnyAncestorTagged(e,n){return this.when(function(e,n){return k(U(e,n))}(e,n))}whenDefault(){return this.when(D)}whenNamed(e){return this.when(N(e))}whenNoParent(e){return this.when(T(e))}whenNoParentIs(e){return this.when(T(F(e)))}whenNoParentNamed(e){return this.when(function(e){return T(N(e))}(e))}whenNoParentTagged(e,n){return this.when(function(e,n){return T(U(e,n))}(e,n))}whenParent(e){return this.when(V(e))}whenParentIs(e){return this.when(V(F(e)))}whenParentNamed(e){return this.when(function(e){return V(N(e))}(e))}whenParentTagged(e,n){return this.when(function(e,n){return V(U(e,n))}(e,n))}whenTagged(e,n){return this.when(U(e,n))}whenNoAncestor(e){return this.when(j(e))}whenNoAncestorIs(e){return this.when(j(F(e)))}whenNoAncestorNamed(e){return this.when(function(e){return j(N(e))}(e))}whenNoAncestorTagged(e,n){return this.when(function(e,n){return j(U(e,n))}(e,n))}}class G extends q{#c;constructor(e){super(e),this.#c=new $(e);}onActivation(e){return this.#c.onActivation(e)}onDeactivation(e){return this.#c.onDeactivation(e)}}class H extends G{#d;constructor(e){super(e),this.#d=new E(e);}inRequestScope(){return this.#d.inRequestScope()}inSingletonScope(){return this.#d.inSingletonScope()}inTransientScope(){return this.#d.inTransientScope()}}class _{#l;#a;#u;#h;constructor(e,n,i,t){this.#l=e,this.#a=n,this.#u=i,this.#h=t;}bind(e){return new L(e=>{this.#v(e);},void 0,this.#a,e)}isBound(e,n){const i=this.#h.bindingService.get(e);return this.#g(e,i,n)}isCurrentBound(e,n){const i=this.#h.bindingService.getNonParentBindings(e);return this.#g(e,i,n)}async rebind(e){return await this.unbind(e),this.bind(e)}rebindSync(e){return this.unbindSync(e),this.bind(e)}async unbind(e){await this.#f(e);}async unbindAll(){const e=[...this.#h.bindingService.getNonParentBoundServices()];await Promise.all(e.map(async e=>Dt(this.#l,e)));for(const n of e)this.#h.activationService.removeAllByServiceId(n),this.#h.bindingService.removeAllByServiceId(n),this.#h.deactivationService.removeAllByServiceId(n);this.#h.planResultCacheService.clearCache();}unbindSync(e){ void 0!==this.#f(e)&&this.#b(e);}#v(e){this.#h.bindingService.set(e),this.#u.invalidateService({binding:e,kind:qe.bindingAdded});}#b(e){let n;if(A(e)){const t=this.#h.bindingService.getById(e.id),r=(i=t,function(e){if(void 0===e)return;const n=e.next();return  true!==n.done?n.value:void 0}(i?.[Symbol.iterator]()))?.serviceIdentifier;n=void 0===r?"Unexpected asynchronous deactivation when unbinding binding identifier. Consider using Container.unbind() instead.":`Unexpected asynchronous deactivation when unbinding "${t$1(r)}" binding. Consider using Container.unbind() instead.`;}else n=`Unexpected asynchronous deactivation when unbinding "${t$1(e)}" service. Consider using Container.unbind() instead.`;var i;throw new B(O.invalidOperation,n)}#f(e){return A(e)?this.#p(e):this.#S(e)}#p(e){const n=this.#h.bindingService.getById(e.id),i=void 0===n?void 0:[...n],t=kt(this.#l,n);if(void 0!==t)return t.then(()=>{this.#M(i,e);});this.#M(i,e);}#M(e,n){if(this.#h.bindingService.removeById(n.id),void 0!==e)for(const n of e)this.#u.invalidateService({binding:n,kind:qe.bindingRemoved});}#S(e){const n=this.#h.bindingService.get(e),i=void 0===n?void 0:[...n],t=kt(this.#l,n);if(void 0!==t)return t.then(()=>{this.#R(e,i);});this.#R(e,i);}#R(e,n){if(this.#h.activationService.removeAllByServiceId(e),this.#h.bindingService.removeAllByServiceId(e),this.#h.deactivationService.removeAllByServiceId(e),void 0!==n)for(const e of n)this.#u.invalidateService({binding:e,kind:qe.bindingRemoved});}#g(e,n,i){if(void 0===n)return  false;const t={getAncestor:()=>{},name:i?.name,serviceIdentifier:e,tags:new Map};void 0!==i?.tag&&t.tags.set(i.tag.key,i.tag.value);for(const e of n)if(e.isSatisfiedBy(t))return  true;return  false}}class z{#y;#l;#a;#u;#h;constructor(e,n,i,t,r){this.#y=e,this.#l=n,this.#a=i,this.#u=t,this.#h=r;}async load(...e){await Promise.all(this.#n(...e));}loadSync(...e){const n=this.#n(...e);for(const e of n)if(void 0!==e)throw new B(O.invalidOperation,"Unexpected asynchronous module load. Consider using Container.load() instead.")}async unload(...e){await Promise.all(this.#m(...e)),this.#w(e);}unloadSync(...e){const n=this.#m(...e);for(const e of n)if(void 0!==e)throw new B(O.invalidOperation,"Unexpected asynchronous module unload. Consider using Container.unload() instead.");this.#w(e);}#I(e){return {bind:n=>new L(e=>{this.#v(e);},e,this.#a,n),isBound:this.#y.isBound.bind(this.#y),onActivation:(n,i)=>{this.#h.activationService.add(i,{moduleId:e,serviceId:n});},onDeactivation:(n,i)=>{this.#h.deactivationService.add(i,{moduleId:e,serviceId:n});},rebind:this.#y.rebind.bind(this.#y),rebindSync:this.#y.rebindSync.bind(this.#y),unbind:this.#y.unbind.bind(this.#y),unbindSync:this.#y.unbindSync.bind(this.#y)}}#w(e){for(const n of e)this.#h.activationService.removeAllByModuleId(n.id),this.#h.bindingService.removeAllByModuleId(n.id),this.#h.deactivationService.removeAllByModuleId(n.id);this.#h.planResultCacheService.clearCache();}#n(...e){return e.map(e=>e.load(this.#I(e.id)))}#v(e){this.#h.bindingService.set(e),this.#u.invalidateService({binding:e,kind:qe.bindingAdded});}#m(...e){return e.map(e=>$t(this.#l,e.id))}}class K{deactivationParams;constructor(e){this.deactivationParams=function(e){return {getBindings:e.bindingService.get.bind(e.bindingService),getBindingsFromModule:e.bindingService.getByModuleId.bind(e.bindingService),getClassMetadata:N$1,getDeactivations:e.deactivationService.get.bind(e.deactivationService)}}(e),e.onReset(()=>{!function(e,n){n.getBindings=e.bindingService.get.bind(e.bindingService),n.getBindingsFromModule=e.bindingService.getByModuleId.bind(e.bindingService),n.getDeactivations=e.deactivationService.get.bind(e.deactivationService);}(e,this.deactivationParams);});}}class X{planParamsOperations;#h;constructor(e){this.#h=e,this.planParamsOperations={getBindings:this.#h.bindingService.get.bind(this.#h.bindingService),getBindingsChained:this.#h.bindingService.getChained.bind(this.#h.bindingService),getClassMetadata:N$1,getPlan:this.#h.planResultCacheService.get.bind(this.#h.planResultCacheService),setBinding:this.#v.bind(this),setNonCachedServiceNode:this.#h.planResultCacheService.setNonCachedServiceNode.bind(this.#h.planResultCacheService),setPlan:this.#h.planResultCacheService.set.bind(this.#h.planResultCacheService)},this.#h.onReset(()=>{this.#A();});}#A(){this.planParamsOperations.getBindings=this.#h.bindingService.get.bind(this.#h.bindingService),this.planParamsOperations.getBindingsChained=this.#h.bindingService.getChained.bind(this.#h.bindingService),this.planParamsOperations.setBinding=this.#v.bind(this);}#v(e){this.#h.bindingService.set(e),this.#h.planResultCacheService.invalidateServiceBinding({binding:e,kind:qe.bindingAdded,operations:this.planParamsOperations});}}class J{#P;#h;constructor(e,n){this.#P=e,this.#h=n;}invalidateService(e){this.#h.planResultCacheService.invalidateServiceBinding({...e,operations:this.#P.planParamsOperations});}}class Q{#C;#B;#O;#h;constructor(e,n,i){this.#h=n,this.#O=i,this.#C=this.#x(e),this.#B=this.#k();}register(e,n){const i=new n(e,this.#B);if(true!==i[t])throw new B(O.invalidOperation,"Invalid plugin. The plugin must extend the Plugin class");i.load(this.#C);}#x(e){return {define:(n,i)=>{if(Object.prototype.hasOwnProperty.call(e,n))throw new B(O.invalidOperation,`Container already has a method named "${String(n)}"`);e[n]=i;},onPlan:this.#O.onPlan.bind(this.#O)}}#k(){const e=this.#h;return {get activationService(){return e.activationService},get bindingService(){return e.bindingService},get deactivationService(){return e.deactivationService},get planResultCacheService(){return e.planResultCacheService}}}}class W{activationService;bindingService;deactivationService;planResultCacheService;#N;constructor(e,n,i,t){this.activationService=e,this.bindingService=n,this.deactivationService=i,this.planResultCacheService=t,this.#N=[];}reset(e,n,i){this.activationService=e,this.bindingService=n,this.deactivationService=i,this.planResultCacheService.clearCache();for(const e of this.#N)e();}onReset(e){this.#N.push(e);}}class Y{#F;#a;#U;#D;#j;#P;#h;constructor(e,n,i,t){this.#P=e,this.#h=n,this.#D=this.#T(),this.#F=i,this.#a=t,this.#U=e=>this.#h.activationService.get(e),this.#j=[],this.#h.onReset(()=>{this.#A();});}get(e$1,n){const i=this.#V(false,e$1,n),t=this.#E(i);if(e(t))throw new B(O.invalidOperation,`Unexpected asynchronous service when resolving service "${t$1(e$1)}"`);return t}getAll(e$1,n){const i=this.#V(true,e$1,n),t=this.#E(i);if(e(t))throw new B(O.invalidOperation,`Unexpected asynchronous service when resolving service "${t$1(e$1)}"`);return t}async getAllAsync(e,n){const i=this.#V(true,e,n);return this.#E(i)}async getAsync(e,n){const i=this.#V(false,e,n);return this.#E(i)}onPlan(e){this.#j.push(e);}#A(){this.#D=this.#T();}#L(e,n,i){const t=i?.name,r=i?.optional??false,a=i?.tag;return e?{chained:i?.chained??false,isMultiple:e,name:t,optional:r,serviceIdentifier:n,tag:a}:{isMultiple:e,name:t,optional:r,serviceIdentifier:n,tag:a}}#$(e,n,i){const t={autobindOptions:i?.autobind??this.#F?{scope:this.#a}:void 0,operations:this.#P.planParamsOperations,rootConstraints:this.#q(e,n,i),servicesBranch:[]};return this.#G(t,i),t}#q(e,n,i){return n?{chained:i?.chained??false,isMultiple:n,serviceIdentifier:e}:{isMultiple:n,serviceIdentifier:e}}#V(e,n,i){const t=this.#L(e,n,i),r=this.#h.planResultCacheService.get(t);if(void 0!==r)return r;const a=Ke(this.#$(n,e,i));for(const e of this.#j)e(t,a);return a}#T(){return {get:this.get.bind(this),getAll:this.getAll.bind(this),getAllAsync:this.getAllAsync.bind(this),getAsync:this.getAsync.bind(this)}}#E(e){return Ct({context:this.#D,getActivations:this.#U,planResult:e,requestScopeCache:new Map})}#G(e,n){ void 0!==n&&(void 0!==n.name&&(e.rootConstraints.name=n.name),true===n.optional&&(e.rootConstraints.isOptional=true),void 0!==n.tag&&(e.rootConstraints.tag={key:n.tag.key,value:n.tag.value}),e.rootConstraints.isMultiple&&(e.rootConstraints.chained=n?.chained??false));}}class Z{#h;#H;constructor(e){this.#h=e,this.#H=[];}restore(){const e=this.#H.pop();if(void 0===e)throw new B(O.invalidOperation,"No snapshot available to restore");this.#h.reset(e.activationService,e.bindingService,e.deactivationService);}snapshot(){this.#H.push({activationService:this.#h.activationService.clone(),bindingService:this.#h.bindingService.clone(),deactivationService:this.#h.deactivationService.clone()});}}const ee=d.Transient;class ne{#y;#_;#z;#h;#O;#K;constructor(e){const n=e?.autobind??false,i=e?.defaultScope??ee;this.#h=this.#X(e,n,i);const t=new X(this.#h),r=new J(t,this.#h),a=new K(this.#h);this.#y=new _(a.deactivationParams,i,r,this.#h),this.#_=new z(this.#y,a.deactivationParams,i,r,this.#h),this.#O=new Y(t,this.#h,n,i),this.#z=new Q(this,this.#h,this.#O),this.#K=new Z(this.#h);}bind(e){return this.#y.bind(e)}get(e,n){return this.#O.get(e,n)}getAll(e,n){return this.#O.getAll(e,n)}async getAllAsync(e,n){return this.#O.getAllAsync(e,n)}async getAsync(e,n){return this.#O.getAsync(e,n)}isBound(e,n){return this.#y.isBound(e,n)}isCurrentBound(e,n){return this.#y.isCurrentBound(e,n)}async load(...e){return this.#_.load(...e)}loadSync(...e){this.#_.loadSync(...e);}onActivation(e,n){this.#h.activationService.add(n,{serviceId:e});}onDeactivation(e,n){this.#h.deactivationService.add(n,{serviceId:e});}register(e){this.#z.register(this,e);}restore(){this.#K.restore();}async rebind(e){return this.#y.rebind(e)}rebindSync(e){return this.#y.rebindSync(e)}snapshot(){this.#K.snapshot();}async unbind(e){await this.#y.unbind(e);}async unbindAll(){return this.#y.unbindAll()}unbindSync(e){this.#y.unbindSync(e);}async unload(...e){return this.#_.unload(...e)}unloadSync(...e){this.#_.unloadSync(...e);}#J(e,n){if(e)return {scope:n}}#X(e,n,i){const t=this.#J(n,i);if(void 0===e?.parent)return new W(v.build(()=>{}),T$1.build(()=>{},t),j$1.build(()=>{}),new Ye);const r=new Ye,a=e.parent;return a.#h.planResultCacheService.subscribe(r),new W(v.build(()=>a.#h.activationService),T$1.build(()=>a.#h.bindingService,t),j$1.build(()=>a.#h.deactivationService),r)}}

    // InversifyJS Performance Benchmark
    // https://github.com/inversify/InversifyJS
    // Symbols for dependency injection
    const TYPES = {
        Logger: Symbol.for('ILogger'),
        Cache: Symbol.for('ICache'),
        EventBus: Symbol.for('IEventBus'),
        AutomationService: Symbol.for('AutomationService'),
        TempSensor: Symbol.for('TempSensor'),
        MotionSensor: Symbol.for('MotionSensor'),
        Thermostat: Symbol.for('Thermostat'),
        Light: Symbol.for('Light'),
    };
    // Test implementations for simpler tests
    let Logger$2 = class Logger {
        log(message, context) { }
        info(message, context) { }
        warn(message, context) { }
        error(message, error) { }
    };
    Logger$2 = __decorate([
        W$1()
    ], Logger$2);
    let Cache$2 = class Cache {
        constructor() {
            this.data = new Map();
        }
        get(key) { return this.data.get(key); }
        set(key, value) { this.data.set(key, value); }
    };
    Cache$2 = __decorate([
        W$1()
    ], Cache$2);
    class InversifyBenchmark {
        constructor() {
            this.name = 'InversifyJS';
            this.framework = 'InversifyJS';
            this.results = {
                framework: 'InversifyJS',
                resolutionSingleton: 0,
                resolutionTransient: 0,
                buildTime: 0,
                complexGraph: 0,
                bundleSize: 16.78, // Measured with bundle-size script (minified + gzipped)
                decoratorFree: false
            };
        }
        async setup() {
            // Setup runs before tests
        }
        async testResolutionSingleton() {
            // Build container with singleton scope
            const container = new ne();
            container.bind(TYPES.Logger).to(Logger$2).inSingletonScope();
            container.bind(TYPES.Cache).to(Cache$2).inSingletonScope();
            // Measure 1000 cached singleton resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                container.get(TYPES.Logger);
                container.get(TYPES.Cache);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionSingleton = Math.round(timeMs * 100) / 100;
            return this.results.resolutionSingleton;
        }
        async testResolutionTransient() {
            // Build container with transient scope
            const container = new ne();
            container.bind(TYPES.Logger).to(Logger$2).inTransientScope();
            container.bind(TYPES.Cache).to(Cache$2).inTransientScope();
            // Measure 1000 transient resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                container.get(TYPES.Logger);
                container.get(TYPES.Cache);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionTransient = Math.round(timeMs * 100) / 100;
            return this.results.resolutionTransient;
        }
        async testBuildTime() {
            const start = performance.now();
            // Register 100 services
            const container = new ne();
            for (let i = 0; i < 100; i++) {
                const symbol = Symbol.for(`Logger${i}`);
                container.bind(symbol).to(Logger$2).inSingletonScope();
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.buildTime = Math.round(timeMs * 100) / 100;
            return this.results.buildTime;
        }
        async testComplexGraph() {
            // Build Demo 5's complex smart home dependency graph using factory bindings
            const container = new ne();
            // Core services
            container.bind(TYPES.Logger).toDynamicValue(() => new ConsoleLogger()).inSingletonScope();
            container.bind(TYPES.EventBus).toDynamicValue(() => {
                const logger = container.get(TYPES.Logger);
                return new EventBus(logger);
            }).inSingletonScope();
            container.bind(TYPES.AutomationService).toDynamicValue(() => {
                const logger = container.get(TYPES.Logger);
                const eventBus = container.get(TYPES.EventBus);
                return new AutomationService(logger, eventBus);
            }).inSingletonScope();
            // Sensors (instances)
            container.bind(TYPES.TempSensor).toConstantValue(new TemperatureSensor('auto-temp', 'Auto Temp', 'office', 22));
            container.bind(TYPES.MotionSensor).toConstantValue(new MotionSensor('auto-motion', 'Auto Motion', 'office'));
            // Devices
            container.bind(TYPES.Thermostat).toDynamicValue(() => {
                const logger = container.get(TYPES.Logger);
                return new SmartThermostat('auto-thermo', 'Auto Thermostat', 'office', logger);
            });
            container.bind(TYPES.Light).toDynamicValue(() => {
                const logger = container.get(TYPES.Logger);
                return new SmartLight('auto-light', 'Auto Light', 'office', logger);
            });
            // Measure 1000 complex resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                container.get(TYPES.AutomationService);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.complexGraph = Math.round(timeMs * 100) / 100;
            return this.results.complexGraph;
        }
        cleanup() {
            // Cleanup if needed
        }
        getResults() {
            return this.results;
        }
    }

    var Lifecycle;
    (function (Lifecycle) {
        Lifecycle[Lifecycle["Transient"] = 0] = "Transient";
        Lifecycle[Lifecycle["Singleton"] = 1] = "Singleton";
        Lifecycle[Lifecycle["ResolutionScoped"] = 2] = "ResolutionScoped";
        Lifecycle[Lifecycle["ContainerScoped"] = 3] = "ContainerScoped";
    })(Lifecycle || (Lifecycle = {}));
    var Lifecycle$1 = Lifecycle;

    var INJECTION_TOKEN_METADATA_KEY = "injectionTokens";
    function getParamInfo(target) {
        var params = Reflect.getMetadata("design:paramtypes", target) || [];
        var injectionTokens = Reflect.getOwnMetadata(INJECTION_TOKEN_METADATA_KEY, target) || {};
        Object.keys(injectionTokens).forEach(function (key) {
            params[+key] = injectionTokens[key];
        });
        return params;
    }

    function isClassProvider(provider) {
        return !!provider.useClass;
    }

    function isFactoryProvider(provider) {
        return !!provider.useFactory;
    }

    var DelayedConstructor = (function () {
        function DelayedConstructor(wrap) {
            this.wrap = wrap;
            this.reflectMethods = [
                "get",
                "getPrototypeOf",
                "setPrototypeOf",
                "getOwnPropertyDescriptor",
                "defineProperty",
                "has",
                "set",
                "deleteProperty",
                "apply",
                "construct",
                "ownKeys"
            ];
        }
        DelayedConstructor.prototype.createProxy = function (createObject) {
            var _this = this;
            var target = {};
            var init = false;
            var value;
            var delayedObject = function () {
                if (!init) {
                    value = createObject(_this.wrap());
                    init = true;
                }
                return value;
            };
            return new Proxy(target, this.createHandler(delayedObject));
        };
        DelayedConstructor.prototype.createHandler = function (delayedObject) {
            var handler = {};
            var install = function (name) {
                handler[name] = function () {
                    var args = [];
                    for (var _i = 0; _i < arguments.length; _i++) {
                        args[_i] = arguments[_i];
                    }
                    args[0] = delayedObject();
                    var method = Reflect[name];
                    return method.apply(void 0, __spread(args));
                };
            };
            this.reflectMethods.forEach(install);
            return handler;
        };
        return DelayedConstructor;
    }());

    function isNormalToken(token) {
        return typeof token === "string" || typeof token === "symbol";
    }
    function isTokenDescriptor(descriptor) {
        return (typeof descriptor === "object" &&
            "token" in descriptor &&
            "multiple" in descriptor);
    }
    function isTransformDescriptor(descriptor) {
        return (typeof descriptor === "object" &&
            "token" in descriptor &&
            "transform" in descriptor);
    }
    function isConstructorToken(token) {
        return typeof token === "function" || token instanceof DelayedConstructor;
    }

    function isTokenProvider(provider) {
        return !!provider.useToken;
    }

    function isValueProvider(provider) {
        return provider.useValue != undefined;
    }

    function isProvider(provider) {
        return (isClassProvider(provider) ||
            isValueProvider(provider) ||
            isTokenProvider(provider) ||
            isFactoryProvider(provider));
    }

    var RegistryBase = (function () {
        function RegistryBase() {
            this._registryMap = new Map();
        }
        RegistryBase.prototype.entries = function () {
            return this._registryMap.entries();
        };
        RegistryBase.prototype.getAll = function (key) {
            this.ensure(key);
            return this._registryMap.get(key);
        };
        RegistryBase.prototype.get = function (key) {
            this.ensure(key);
            var value = this._registryMap.get(key);
            return value[value.length - 1] || null;
        };
        RegistryBase.prototype.set = function (key, value) {
            this.ensure(key);
            this._registryMap.get(key).push(value);
        };
        RegistryBase.prototype.setAll = function (key, value) {
            this._registryMap.set(key, value);
        };
        RegistryBase.prototype.has = function (key) {
            this.ensure(key);
            return this._registryMap.get(key).length > 0;
        };
        RegistryBase.prototype.clear = function () {
            this._registryMap.clear();
        };
        RegistryBase.prototype.ensure = function (key) {
            if (!this._registryMap.has(key)) {
                this._registryMap.set(key, []);
            }
        };
        return RegistryBase;
    }());

    var Registry$1 = (function (_super) {
        __extends$2(Registry, _super);
        function Registry() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        return Registry;
    }(RegistryBase));

    var ResolutionContext = (function () {
        function ResolutionContext() {
            this.scopedResolutions = new Map();
        }
        return ResolutionContext;
    }());

    function formatDependency(params, idx) {
        if (params === null) {
            return "at position #" + idx;
        }
        var argName = params.split(",")[idx].trim();
        return "\"" + argName + "\" at position #" + idx;
    }
    function composeErrorMessage(msg, e, indent) {
        if (indent === void 0) { indent = "    "; }
        return __spread([msg], e.message.split("\n").map(function (l) { return indent + l; })).join("\n");
    }
    function formatErrorCtor(ctor, paramIdx, error) {
        var _a = __read(ctor.toString().match(/constructor\(([\w, ]+)\)/) || [], 2), _b = _a[1], params = _b === void 0 ? null : _b;
        var dep = formatDependency(params, paramIdx);
        return composeErrorMessage("Cannot inject the dependency " + dep + " of \"" + ctor.name + "\" constructor. Reason:", error);
    }

    function isDisposable(value) {
        if (typeof value.dispose !== "function")
            return false;
        var disposeFun = value.dispose;
        if (disposeFun.length > 0) {
            return false;
        }
        return true;
    }

    var PreResolutionInterceptors = (function (_super) {
        __extends$2(PreResolutionInterceptors, _super);
        function PreResolutionInterceptors() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        return PreResolutionInterceptors;
    }(RegistryBase));
    var PostResolutionInterceptors = (function (_super) {
        __extends$2(PostResolutionInterceptors, _super);
        function PostResolutionInterceptors() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        return PostResolutionInterceptors;
    }(RegistryBase));
    var Interceptors = (function () {
        function Interceptors() {
            this.preResolution = new PreResolutionInterceptors();
            this.postResolution = new PostResolutionInterceptors();
        }
        return Interceptors;
    }());

    var typeInfo = new Map();
    var InternalDependencyContainer = (function () {
        function InternalDependencyContainer(parent) {
            this.parent = parent;
            this._registry = new Registry$1();
            this.interceptors = new Interceptors();
            this.disposed = false;
            this.disposables = new Set();
        }
        InternalDependencyContainer.prototype.register = function (token, providerOrConstructor, options) {
            if (options === void 0) { options = { lifecycle: Lifecycle$1.Transient }; }
            this.ensureNotDisposed();
            var provider;
            if (!isProvider(providerOrConstructor)) {
                provider = { useClass: providerOrConstructor };
            }
            else {
                provider = providerOrConstructor;
            }
            if (isTokenProvider(provider)) {
                var path = [token];
                var tokenProvider = provider;
                while (tokenProvider != null) {
                    var currentToken = tokenProvider.useToken;
                    if (path.includes(currentToken)) {
                        throw new Error("Token registration cycle detected! " + __spread(path, [currentToken]).join(" -> "));
                    }
                    path.push(currentToken);
                    var registration = this._registry.get(currentToken);
                    if (registration && isTokenProvider(registration.provider)) {
                        tokenProvider = registration.provider;
                    }
                    else {
                        tokenProvider = null;
                    }
                }
            }
            if (options.lifecycle === Lifecycle$1.Singleton ||
                options.lifecycle == Lifecycle$1.ContainerScoped ||
                options.lifecycle == Lifecycle$1.ResolutionScoped) {
                if (isValueProvider(provider) || isFactoryProvider(provider)) {
                    throw new Error("Cannot use lifecycle \"" + Lifecycle$1[options.lifecycle] + "\" with ValueProviders or FactoryProviders");
                }
            }
            this._registry.set(token, { provider: provider, options: options });
            return this;
        };
        InternalDependencyContainer.prototype.registerType = function (from, to) {
            this.ensureNotDisposed();
            if (isNormalToken(to)) {
                return this.register(from, {
                    useToken: to
                });
            }
            return this.register(from, {
                useClass: to
            });
        };
        InternalDependencyContainer.prototype.registerInstance = function (token, instance) {
            this.ensureNotDisposed();
            return this.register(token, {
                useValue: instance
            });
        };
        InternalDependencyContainer.prototype.registerSingleton = function (from, to) {
            this.ensureNotDisposed();
            if (isNormalToken(from)) {
                if (isNormalToken(to)) {
                    return this.register(from, {
                        useToken: to
                    }, { lifecycle: Lifecycle$1.Singleton });
                }
                else if (to) {
                    return this.register(from, {
                        useClass: to
                    }, { lifecycle: Lifecycle$1.Singleton });
                }
                throw new Error('Cannot register a type name as a singleton without a "to" token');
            }
            var useClass = from;
            if (to && !isNormalToken(to)) {
                useClass = to;
            }
            return this.register(from, {
                useClass: useClass
            }, { lifecycle: Lifecycle$1.Singleton });
        };
        InternalDependencyContainer.prototype.resolve = function (token, context, isOptional) {
            if (context === void 0) { context = new ResolutionContext(); }
            if (isOptional === void 0) { isOptional = false; }
            this.ensureNotDisposed();
            var registration = this.getRegistration(token);
            if (!registration && isNormalToken(token)) {
                if (isOptional) {
                    return undefined;
                }
                throw new Error("Attempted to resolve unregistered dependency token: \"" + token.toString() + "\"");
            }
            this.executePreResolutionInterceptor(token, "Single");
            if (registration) {
                var result = this.resolveRegistration(registration, context);
                this.executePostResolutionInterceptor(token, result, "Single");
                return result;
            }
            if (isConstructorToken(token)) {
                var result = this.construct(token, context);
                this.executePostResolutionInterceptor(token, result, "Single");
                return result;
            }
            throw new Error("Attempted to construct an undefined constructor. Could mean a circular dependency problem. Try using `delay` function.");
        };
        InternalDependencyContainer.prototype.executePreResolutionInterceptor = function (token, resolutionType) {
            var e_1, _a;
            if (this.interceptors.preResolution.has(token)) {
                var remainingInterceptors = [];
                try {
                    for (var _b = __values(this.interceptors.preResolution.getAll(token)), _c = _b.next(); !_c.done; _c = _b.next()) {
                        var interceptor = _c.value;
                        if (interceptor.options.frequency != "Once") {
                            remainingInterceptors.push(interceptor);
                        }
                        interceptor.callback(token, resolutionType);
                    }
                }
                catch (e_1_1) { e_1 = { error: e_1_1 }; }
                finally {
                    try {
                        if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                    }
                    finally { if (e_1) throw e_1.error; }
                }
                this.interceptors.preResolution.setAll(token, remainingInterceptors);
            }
        };
        InternalDependencyContainer.prototype.executePostResolutionInterceptor = function (token, result, resolutionType) {
            var e_2, _a;
            if (this.interceptors.postResolution.has(token)) {
                var remainingInterceptors = [];
                try {
                    for (var _b = __values(this.interceptors.postResolution.getAll(token)), _c = _b.next(); !_c.done; _c = _b.next()) {
                        var interceptor = _c.value;
                        if (interceptor.options.frequency != "Once") {
                            remainingInterceptors.push(interceptor);
                        }
                        interceptor.callback(token, result, resolutionType);
                    }
                }
                catch (e_2_1) { e_2 = { error: e_2_1 }; }
                finally {
                    try {
                        if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                    }
                    finally { if (e_2) throw e_2.error; }
                }
                this.interceptors.postResolution.setAll(token, remainingInterceptors);
            }
        };
        InternalDependencyContainer.prototype.resolveRegistration = function (registration, context) {
            this.ensureNotDisposed();
            if (registration.options.lifecycle === Lifecycle$1.ResolutionScoped &&
                context.scopedResolutions.has(registration)) {
                return context.scopedResolutions.get(registration);
            }
            var isSingleton = registration.options.lifecycle === Lifecycle$1.Singleton;
            var isContainerScoped = registration.options.lifecycle === Lifecycle$1.ContainerScoped;
            var returnInstance = isSingleton || isContainerScoped;
            var resolved;
            if (isValueProvider(registration.provider)) {
                resolved = registration.provider.useValue;
            }
            else if (isTokenProvider(registration.provider)) {
                resolved = returnInstance
                    ? registration.instance ||
                        (registration.instance = this.resolve(registration.provider.useToken, context))
                    : this.resolve(registration.provider.useToken, context);
            }
            else if (isClassProvider(registration.provider)) {
                resolved = returnInstance
                    ? registration.instance ||
                        (registration.instance = this.construct(registration.provider.useClass, context))
                    : this.construct(registration.provider.useClass, context);
            }
            else if (isFactoryProvider(registration.provider)) {
                resolved = registration.provider.useFactory(this);
            }
            else {
                resolved = this.construct(registration.provider, context);
            }
            if (registration.options.lifecycle === Lifecycle$1.ResolutionScoped) {
                context.scopedResolutions.set(registration, resolved);
            }
            return resolved;
        };
        InternalDependencyContainer.prototype.resolveAll = function (token, context, isOptional) {
            var _this = this;
            if (context === void 0) { context = new ResolutionContext(); }
            if (isOptional === void 0) { isOptional = false; }
            this.ensureNotDisposed();
            var registrations = this.getAllRegistrations(token);
            if (!registrations && isNormalToken(token)) {
                if (isOptional) {
                    return [];
                }
                throw new Error("Attempted to resolve unregistered dependency token: \"" + token.toString() + "\"");
            }
            this.executePreResolutionInterceptor(token, "All");
            if (registrations) {
                var result_1 = registrations.map(function (item) {
                    return _this.resolveRegistration(item, context);
                });
                this.executePostResolutionInterceptor(token, result_1, "All");
                return result_1;
            }
            var result = [this.construct(token, context)];
            this.executePostResolutionInterceptor(token, result, "All");
            return result;
        };
        InternalDependencyContainer.prototype.isRegistered = function (token, recursive) {
            if (recursive === void 0) { recursive = false; }
            this.ensureNotDisposed();
            return (this._registry.has(token) ||
                (recursive &&
                    (this.parent || false) &&
                    this.parent.isRegistered(token, true)));
        };
        InternalDependencyContainer.prototype.reset = function () {
            this.ensureNotDisposed();
            this._registry.clear();
            this.interceptors.preResolution.clear();
            this.interceptors.postResolution.clear();
        };
        InternalDependencyContainer.prototype.clearInstances = function () {
            var e_3, _a;
            this.ensureNotDisposed();
            try {
                for (var _b = __values(this._registry.entries()), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var _d = __read(_c.value, 2), token = _d[0], registrations = _d[1];
                    this._registry.setAll(token, registrations
                        .filter(function (registration) { return !isValueProvider(registration.provider); })
                        .map(function (registration) {
                        registration.instance = undefined;
                        return registration;
                    }));
                }
            }
            catch (e_3_1) { e_3 = { error: e_3_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_3) throw e_3.error; }
            }
        };
        InternalDependencyContainer.prototype.createChildContainer = function () {
            var e_4, _a;
            this.ensureNotDisposed();
            var childContainer = new InternalDependencyContainer(this);
            try {
                for (var _b = __values(this._registry.entries()), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var _d = __read(_c.value, 2), token = _d[0], registrations = _d[1];
                    if (registrations.some(function (_a) {
                        var options = _a.options;
                        return options.lifecycle === Lifecycle$1.ContainerScoped;
                    })) {
                        childContainer._registry.setAll(token, registrations.map(function (registration) {
                            if (registration.options.lifecycle === Lifecycle$1.ContainerScoped) {
                                return {
                                    provider: registration.provider,
                                    options: registration.options
                                };
                            }
                            return registration;
                        }));
                    }
                }
            }
            catch (e_4_1) { e_4 = { error: e_4_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_4) throw e_4.error; }
            }
            return childContainer;
        };
        InternalDependencyContainer.prototype.beforeResolution = function (token, callback, options) {
            if (options === void 0) { options = { frequency: "Always" }; }
            this.interceptors.preResolution.set(token, {
                callback: callback,
                options: options
            });
        };
        InternalDependencyContainer.prototype.afterResolution = function (token, callback, options) {
            if (options === void 0) { options = { frequency: "Always" }; }
            this.interceptors.postResolution.set(token, {
                callback: callback,
                options: options
            });
        };
        InternalDependencyContainer.prototype.dispose = function () {
            return __awaiter(this, void 0, void 0, function () {
                var promises;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            this.disposed = true;
                            promises = [];
                            this.disposables.forEach(function (disposable) {
                                var maybePromise = disposable.dispose();
                                if (maybePromise) {
                                    promises.push(maybePromise);
                                }
                            });
                            return [4, Promise.all(promises)];
                        case 1:
                            _a.sent();
                            return [2];
                    }
                });
            });
        };
        InternalDependencyContainer.prototype.getRegistration = function (token) {
            if (this.isRegistered(token)) {
                return this._registry.get(token);
            }
            if (this.parent) {
                return this.parent.getRegistration(token);
            }
            return null;
        };
        InternalDependencyContainer.prototype.getAllRegistrations = function (token) {
            if (this.isRegistered(token)) {
                return this._registry.getAll(token);
            }
            if (this.parent) {
                return this.parent.getAllRegistrations(token);
            }
            return null;
        };
        InternalDependencyContainer.prototype.construct = function (ctor, context) {
            var _this = this;
            if (ctor instanceof DelayedConstructor) {
                return ctor.createProxy(function (target) {
                    return _this.resolve(target, context);
                });
            }
            var instance = (function () {
                var paramInfo = typeInfo.get(ctor);
                if (!paramInfo || paramInfo.length === 0) {
                    if (ctor.length === 0) {
                        return new ctor();
                    }
                    else {
                        throw new Error("TypeInfo not known for \"" + ctor.name + "\"");
                    }
                }
                var params = paramInfo.map(_this.resolveParams(context, ctor));
                return new (ctor.bind.apply(ctor, __spread([void 0], params)))();
            })();
            if (isDisposable(instance)) {
                this.disposables.add(instance);
            }
            return instance;
        };
        InternalDependencyContainer.prototype.resolveParams = function (context, ctor) {
            var _this = this;
            return function (param, idx) {
                var _a, _b, _c;
                try {
                    if (isTokenDescriptor(param)) {
                        if (isTransformDescriptor(param)) {
                            return param.multiple
                                ? (_a = _this.resolve(param.transform)).transform.apply(_a, __spread([_this.resolveAll(param.token, new ResolutionContext(), param.isOptional)], param.transformArgs)) : (_b = _this.resolve(param.transform)).transform.apply(_b, __spread([_this.resolve(param.token, context, param.isOptional)], param.transformArgs));
                        }
                        else {
                            return param.multiple
                                ? _this.resolveAll(param.token, new ResolutionContext(), param.isOptional)
                                : _this.resolve(param.token, context, param.isOptional);
                        }
                    }
                    else if (isTransformDescriptor(param)) {
                        return (_c = _this.resolve(param.transform, context)).transform.apply(_c, __spread([_this.resolve(param.token, context)], param.transformArgs));
                    }
                    return _this.resolve(param, context);
                }
                catch (e) {
                    throw new Error(formatErrorCtor(ctor, idx, e));
                }
            };
        };
        InternalDependencyContainer.prototype.ensureNotDisposed = function () {
            if (this.disposed) {
                throw new Error("This container has been disposed, you cannot interact with a disposed container");
            }
        };
        return InternalDependencyContainer;
    }());
    var instance = new InternalDependencyContainer();

    function injectable(options) {
        return function (target) {
            typeInfo.set(target, getParamInfo(target));
        };
    }

    function singleton() {
        return function (target) {
            injectable()(target);
            instance.registerSingleton(target);
        };
    }

    if (typeof Reflect === "undefined" || !Reflect.getMetadata) {
        throw new Error("tsyringe requires a reflect polyfill. Please add 'import \"reflect-metadata\"' to the top of your entry point.");
    }

    // TSyringe Performance Benchmark
    // https://github.com/microsoft/tsyringe
    // Test interfaces (using symbols as injection tokens)
    const ILoggerToken = Symbol.for('ILogger');
    const ICacheToken = Symbol.for('ICache');
    const IEventBusToken = Symbol.for('IEventBus');
    const AutomationServiceToken$1 = Symbol.for('AutomationService');
    const TempSensorToken$1 = Symbol.for('TempSensor');
    const MotionSensorToken$1 = Symbol.for('MotionSensor');
    const ThermostatToken$1 = Symbol.for('Thermostat');
    const LightToken$1 = Symbol.for('Light');
    // Test implementations for simpler tests
    let Logger$1 = class Logger {
        log(message, context) { }
        info(message, context) { }
        warn(message, context) { }
        error(message, error) { }
    };
    Logger$1 = __decorate([
        singleton()
    ], Logger$1);
    let Cache$1 = class Cache {
        constructor() {
            this.data = new Map();
        }
        get(key) { return this.data.get(key); }
        set(key, value) { this.data.set(key, value); }
    };
    Cache$1 = __decorate([
        singleton()
    ], Cache$1);
    class TSyringeBenchmark {
        constructor() {
            this.name = 'TSyringe';
            this.framework = 'TSyringe';
            this.results = {
                framework: 'TSyringe',
                resolutionSingleton: 0,
                resolutionTransient: 0,
                buildTime: 0,
                complexGraph: 0,
                bundleSize: 7.40, // Measured with bundle-size script (minified + gzipped)
                decoratorFree: false
            };
        }
        async setup() {
            // Clear container before tests
            instance.clearInstances();
        }
        async testResolutionSingleton() {
            // Clear and rebuild container with singleton scope
            instance.clearInstances();
            // TSyringe uses registerSingleton for singleton scope
            instance.registerSingleton(ILoggerToken, Logger$1);
            instance.registerSingleton(ICacheToken, Cache$1);
            // Measure 1000 cached singleton resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                instance.resolve(ILoggerToken);
                instance.resolve(ICacheToken);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionSingleton = Math.round(timeMs * 100) / 100;
            return this.results.resolutionSingleton;
        }
        async testResolutionTransient() {
            // Clear and rebuild container with transient scope
            instance.clearInstances();
            // TSyringe uses register for transient scope (default)
            instance.register(ILoggerToken, { useClass: Logger$1 });
            instance.register(ICacheToken, { useClass: Cache$1 });
            // Measure 1000 transient resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                instance.resolve(ILoggerToken);
                instance.resolve(ICacheToken);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionTransient = Math.round(timeMs * 100) / 100;
            return this.results.resolutionTransient;
        }
        async testBuildTime() {
            // Clear container
            instance.clearInstances();
            const start = performance.now();
            // Register 100 services
            for (let i = 0; i < 100; i++) {
                const token = Symbol.for(`Logger${i}`);
                instance.register(token, { useClass: Logger$1 });
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.buildTime = Math.round(timeMs * 100) / 100;
            return this.results.buildTime;
        }
        async testComplexGraph() {
            // Clear and rebuild container
            instance.clearInstances();
            // Register services using factories for Demo 5's smart home setup
            instance.register(ILoggerToken, { useClass: ConsoleLogger });
            instance.register(IEventBusToken, {
                useFactory: (c) => {
                    const logger = c.resolve(ILoggerToken);
                    return new EventBus(logger);
                }
            });
            instance.register(AutomationServiceToken$1, {
                useFactory: (c) => {
                    const logger = c.resolve(ILoggerToken);
                    const eventBus = c.resolve(IEventBusToken);
                    return new AutomationService(logger, eventBus);
                }
            });
            // Sensors (instances)
            instance.registerInstance(TempSensorToken$1, new TemperatureSensor('auto-temp', 'Auto Temp', 'office', 22));
            instance.registerInstance(MotionSensorToken$1, new MotionSensor('auto-motion', 'Auto Motion', 'office'));
            // Devices
            instance.register(ThermostatToken$1, {
                useFactory: (c) => {
                    const logger = c.resolve(ILoggerToken);
                    return new SmartThermostat('auto-thermo', 'Auto Thermostat', 'office', logger);
                }
            });
            instance.register(LightToken$1, {
                useFactory: (c) => {
                    const logger = c.resolve(ILoggerToken);
                    return new SmartLight('auto-light', 'Auto Light', 'office', logger);
                }
            });
            // Measure 1000 complex resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                instance.resolve(AutomationServiceToken$1);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.complexGraph = Math.round(timeMs * 100) / 100;
            return this.results.complexGraph;
        }
        cleanup() {
            instance.clearInstances();
        }
        getResults() {
            return this.results;
        }
    }

    /**
     * Used to create unique typed service identifier.
     * Useful when service has only interface, but don't have a class.
     */
    var Token = /** @class */ (function () {
        /**
         * @param name Token name, optional and only used for debugging purposes.
         */
        function Token(name) {
            this.name = name;
        }
        return Token;
    }());

    var __extends$1 = (undefined && undefined.__extends) || (function () {
        var extendStatics = function (d, b) {
            extendStatics = Object.setPrototypeOf ||
                ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
                function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
            return extendStatics(d, b);
        };
        return function (d, b) {
            extendStatics(d, b);
            function __() { this.constructor = d; }
            d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
    })();
    /**
     * Thrown when requested service was not found.
     */
    var ServiceNotFoundError = /** @class */ (function (_super) {
        __extends$1(ServiceNotFoundError, _super);
        function ServiceNotFoundError(identifier) {
            var _a, _b;
            var _this = _super.call(this) || this;
            _this.name = 'ServiceNotFoundError';
            /** Normalized identifier name used in the error message. */
            _this.normalizedIdentifier = '<UNKNOWN_IDENTIFIER>';
            if (typeof identifier === 'string') {
                _this.normalizedIdentifier = identifier;
            }
            else if (identifier instanceof Token) {
                _this.normalizedIdentifier = "Token<" + (identifier.name || 'UNSET_NAME') + ">";
            }
            else if (identifier && (identifier.name || ((_a = identifier.prototype) === null || _a === void 0 ? void 0 : _a.name))) {
                _this.normalizedIdentifier =
                    "MaybeConstructable<" + identifier.name + ">" ||
                        "MaybeConstructable<" + ((_b = identifier.prototype) === null || _b === void 0 ? void 0 : _b.name) + ">";
            }
            return _this;
        }
        Object.defineProperty(ServiceNotFoundError.prototype, "message", {
            get: function () {
                return ("Service with \"" + this.normalizedIdentifier + "\" identifier was not found in the container. " +
                    "Register it before usage via explicitly calling the \"Container.set\" function or using the \"@Service()\" decorator.");
            },
            enumerable: false,
            configurable: true
        });
        return ServiceNotFoundError;
    }(Error));

    var __extends = (undefined && undefined.__extends) || (function () {
        var extendStatics = function (d, b) {
            extendStatics = Object.setPrototypeOf ||
                ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
                function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
            return extendStatics(d, b);
        };
        return function (d, b) {
            extendStatics(d, b);
            function __() { this.constructor = d; }
            d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
    })();
    /**
     * Thrown when DI cannot inject value into property decorated by @Inject decorator.
     */
    var CannotInstantiateValueError = /** @class */ (function (_super) {
        __extends(CannotInstantiateValueError, _super);
        function CannotInstantiateValueError(identifier) {
            var _a, _b;
            var _this = _super.call(this) || this;
            _this.name = 'CannotInstantiateValueError';
            /** Normalized identifier name used in the error message. */
            _this.normalizedIdentifier = '<UNKNOWN_IDENTIFIER>';
            // TODO: Extract this to a helper function and share between this and NotFoundError.
            if (typeof identifier === 'string') {
                _this.normalizedIdentifier = identifier;
            }
            else if (identifier instanceof Token) {
                _this.normalizedIdentifier = "Token<" + (identifier.name || 'UNSET_NAME') + ">";
            }
            else if (identifier && (identifier.name || ((_a = identifier.prototype) === null || _a === void 0 ? void 0 : _a.name))) {
                _this.normalizedIdentifier =
                    "MaybeConstructable<" + identifier.name + ">" ||
                        "MaybeConstructable<" + ((_b = identifier.prototype) === null || _b === void 0 ? void 0 : _b.name) + ">";
            }
            return _this;
        }
        Object.defineProperty(CannotInstantiateValueError.prototype, "message", {
            get: function () {
                return ("Cannot instantiate the requested value for the \"" + this.normalizedIdentifier + "\" identifier. " +
                    "The related metadata doesn't contain a factory or a type to instantiate.");
            },
            enumerable: false,
            configurable: true
        });
        return CannotInstantiateValueError;
    }(Error));

    var EMPTY_VALUE = Symbol('EMPTY_VALUE');

    var __assign = (undefined && undefined.__assign) || function () {
        __assign = Object.assign || function(t) {
            for (var s, i = 1, n = arguments.length; i < n; i++) {
                s = arguments[i];
                for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                    t[p] = s[p];
            }
            return t;
        };
        return __assign.apply(this, arguments);
    };
    var __spreadArrays = (undefined && undefined.__spreadArrays) || function () {
        for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
        for (var r = Array(s), k = 0, i = 0; i < il; i++)
            for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
                r[k] = a[j];
        return r;
    };
    /**
     * TypeDI can have multiple containers.
     * One container is ContainerInstance.
     */
    var ContainerInstance = /** @class */ (function () {
        function ContainerInstance(id) {
            /** All registered services in the container. */
            this.services = [];
            this.id = id;
        }
        ContainerInstance.prototype.has = function (identifier) {
            return !!this.findService(identifier);
        };
        ContainerInstance.prototype.get = function (identifier) {
            var globalContainer = Container.of(undefined);
            var globalService = globalContainer.findService(identifier);
            var scopedService = this.findService(identifier);
            if (globalService && globalService.global === true)
                return this.getServiceValue(globalService);
            if (scopedService)
                return this.getServiceValue(scopedService);
            /** If it's the first time requested in the child container we load it from parent and set it. */
            if (globalService && this !== globalContainer) {
                var clonedService = __assign({}, globalService);
                clonedService.value = EMPTY_VALUE;
                /**
                 * We need to immediately set the empty value from the root container
                 * to prevent infinite lookup in cyclic dependencies.
                 */
                this.set(clonedService);
                var value = this.getServiceValue(clonedService);
                this.set(__assign(__assign({}, clonedService), { value: value }));
                return value;
            }
            if (globalService)
                return this.getServiceValue(globalService);
            throw new ServiceNotFoundError(identifier);
        };
        ContainerInstance.prototype.getMany = function (identifier) {
            var _this = this;
            return this.findAllServices(identifier).map(function (service) { return _this.getServiceValue(service); });
        };
        ContainerInstance.prototype.set = function (identifierOrServiceMetadata, value) {
            var _this = this;
            if (identifierOrServiceMetadata instanceof Array) {
                identifierOrServiceMetadata.forEach(function (data) { return _this.set(data); });
                return this;
            }
            if (typeof identifierOrServiceMetadata === 'string' || identifierOrServiceMetadata instanceof Token) {
                return this.set({
                    id: identifierOrServiceMetadata,
                    type: null,
                    value: value,
                    factory: undefined,
                    global: false,
                    multiple: false,
                    eager: false,
                    transient: false,
                });
            }
            if (typeof identifierOrServiceMetadata === 'function') {
                return this.set({
                    id: identifierOrServiceMetadata,
                    // TODO: remove explicit casting
                    type: identifierOrServiceMetadata,
                    value: value,
                    factory: undefined,
                    global: false,
                    multiple: false,
                    eager: false,
                    transient: false,
                });
            }
            var newService = __assign({ id: new Token('UNREACHABLE'), type: null, factory: undefined, value: EMPTY_VALUE, global: false, multiple: false, eager: false, transient: false }, identifierOrServiceMetadata);
            var service = this.findService(newService.id);
            if (service && service.multiple !== true) {
                Object.assign(service, newService);
            }
            else {
                this.services.push(newService);
            }
            if (newService.eager) {
                this.get(newService.id);
            }
            return this;
        };
        /**
         * Removes services with a given service identifiers.
         */
        ContainerInstance.prototype.remove = function (identifierOrIdentifierArray) {
            var _this = this;
            if (Array.isArray(identifierOrIdentifierArray)) {
                identifierOrIdentifierArray.forEach(function (id) { return _this.remove(id); });
            }
            else {
                this.services = this.services.filter(function (service) {
                    if (service.id === identifierOrIdentifierArray) {
                        _this.destroyServiceInstance(service);
                        return false;
                    }
                    return true;
                });
            }
            return this;
        };
        /**
         * Completely resets the container by removing all previously registered services from it.
         */
        ContainerInstance.prototype.reset = function (options) {
            var _this = this;
            if (options === void 0) { options = { strategy: 'resetValue' }; }
            switch (options.strategy) {
                case 'resetValue':
                    this.services.forEach(function (service) { return _this.destroyServiceInstance(service); });
                    break;
                case 'resetServices':
                    this.services.forEach(function (service) { return _this.destroyServiceInstance(service); });
                    this.services = [];
                    break;
                default:
                    throw new Error('Received invalid reset strategy.');
            }
            return this;
        };
        /**
         * Returns all services registered with the given identifier.
         */
        ContainerInstance.prototype.findAllServices = function (identifier) {
            return this.services.filter(function (service) { return service.id === identifier; });
        };
        /**
         * Finds registered service in the with a given service identifier.
         */
        ContainerInstance.prototype.findService = function (identifier) {
            return this.services.find(function (service) { return service.id === identifier; });
        };
        /**
         * Gets the value belonging to `serviceMetadata.id`.
         *
         * - if `serviceMetadata.value` is already set it is immediately returned
         * - otherwise the requested type is resolved to the value saved to `serviceMetadata.value` and returned
         */
        ContainerInstance.prototype.getServiceValue = function (serviceMetadata) {
            var _a;
            var value = EMPTY_VALUE;
            /**
             * If the service value has been set to anything prior to this call we return that value.
             * NOTE: This part builds on the assumption that transient dependencies has no value set ever.
             */
            if (serviceMetadata.value !== EMPTY_VALUE) {
                return serviceMetadata.value;
            }
            /** If both factory and type is missing, we cannot resolve the requested ID. */
            if (!serviceMetadata.factory && !serviceMetadata.type) {
                throw new CannotInstantiateValueError(serviceMetadata.id);
            }
            /**
             * If a factory is defined it takes priority over creating an instance via `new`.
             * The return value of the factory is not checked, we believe by design that the user knows what he/she is doing.
             */
            if (serviceMetadata.factory) {
                /**
                 * If we received the factory in the [Constructable<Factory>, "functionName"] format, we need to create the
                 * factory first and then call the specified function on it.
                 */
                if (serviceMetadata.factory instanceof Array) {
                    var factoryInstance = void 0;
                    try {
                        /** Try to get the factory from TypeDI first, if failed, fall back to simply initiating the class. */
                        factoryInstance = this.get(serviceMetadata.factory[0]);
                    }
                    catch (error) {
                        if (error instanceof ServiceNotFoundError) {
                            factoryInstance = new serviceMetadata.factory[0]();
                        }
                        else {
                            throw error;
                        }
                    }
                    value = factoryInstance[serviceMetadata.factory[1]](this, serviceMetadata.id);
                }
                else {
                    /** If only a simple function was provided we simply call it. */
                    value = serviceMetadata.factory(this, serviceMetadata.id);
                }
            }
            /**
             * If no factory was provided and only then, we create the instance from the type if it was set.
             */
            if (!serviceMetadata.factory && serviceMetadata.type) {
                var constructableTargetType = serviceMetadata.type;
                // setup constructor parameters for a newly initialized service
                var paramTypes = ((_a = Reflect) === null || _a === void 0 ? void 0 : _a.getMetadata('design:paramtypes', constructableTargetType)) || [];
                var params = this.initializeParams(constructableTargetType, paramTypes);
                // "extra feature" - always pass container instance as the last argument to the service function
                // this allows us to support javascript where we don't have decorators and emitted metadata about dependencies
                // need to be injected, and user can use provided container to get instances he needs
                params.push(this);
                value = new (constructableTargetType.bind.apply(constructableTargetType, __spreadArrays([void 0], params)))();
                // TODO: Calling this here, leads to infinite loop, because @Inject decorator registerds a handler
                // TODO: which calls Container.get, which will check if the requested type has a value set and if not
                // TODO: it will start the instantiation process over. So this is currently called outside of the if branch
                // TODO: after the current value has been assigned to the serviceMetadata.
                // this.applyPropertyHandlers(constructableTargetType, value as Constructable<unknown>);
            }
            /** If this is not a transient service, and we resolved something, then we set it as the value. */
            if (!serviceMetadata.transient && value !== EMPTY_VALUE) {
                serviceMetadata.value = value;
            }
            if (value === EMPTY_VALUE) {
                /** This branch should never execute, but better to be safe than sorry. */
                throw new CannotInstantiateValueError(serviceMetadata.id);
            }
            if (serviceMetadata.type) {
                this.applyPropertyHandlers(serviceMetadata.type, value);
            }
            return value;
        };
        /**
         * Initializes all parameter types for a given target service class.
         */
        ContainerInstance.prototype.initializeParams = function (target, paramTypes) {
            var _this = this;
            return paramTypes.map(function (paramType, index) {
                var paramHandler = Container.handlers.find(function (handler) {
                    /**
                     * @Inject()-ed values are stored as parameter handlers and they reference their target
                     * when created. So when a class is extended the @Inject()-ed values are not inherited
                     * because the handler still points to the old object only.
                     *
                     * As a quick fix a single level parent lookup is added via `Object.getPrototypeOf(target)`,
                     * however this should be updated to a more robust solution.
                     *
                     * TODO: Add proper inheritance handling: either copy the handlers when a class is registered what
                     * TODO: has it's parent already registered as dependency or make the lookup search up to the base Object.
                     */
                    return ((handler.object === target || handler.object === Object.getPrototypeOf(target)) && handler.index === index);
                });
                if (paramHandler)
                    return paramHandler.value(_this);
                if (paramType && paramType.name && !_this.isPrimitiveParamType(paramType.name)) {
                    return _this.get(paramType);
                }
                return undefined;
            });
        };
        /**
         * Checks if given parameter type is primitive type or not.
         */
        ContainerInstance.prototype.isPrimitiveParamType = function (paramTypeName) {
            return ['string', 'boolean', 'number', 'object'].includes(paramTypeName.toLowerCase());
        };
        /**
         * Applies all registered handlers on a given target class.
         */
        ContainerInstance.prototype.applyPropertyHandlers = function (target, instance) {
            var _this = this;
            Container.handlers.forEach(function (handler) {
                if (typeof handler.index === 'number')
                    return;
                if (handler.object.constructor !== target && !(target.prototype instanceof handler.object.constructor))
                    return;
                if (handler.propertyName) {
                    instance[handler.propertyName] = handler.value(_this);
                }
            });
        };
        /**
         * Checks if the given service metadata contains a destroyable service instance and destroys it in place. If the service
         * contains a callable function named `destroy` it is called but not awaited and the return value is ignored..
         *
         * @param serviceMetadata the service metadata containing the instance to destroy
         * @param force when true the service will be always destroyed even if it's cannot be re-created
         */
        ContainerInstance.prototype.destroyServiceInstance = function (serviceMetadata, force) {
            if (force === void 0) { force = false; }
            /** We reset value only if we can re-create it (aka type or factory exists). */
            var shouldResetValue = force || !!serviceMetadata.type || !!serviceMetadata.factory;
            if (shouldResetValue) {
                /** If we wound a function named destroy we call it without any params. */
                if (typeof (serviceMetadata === null || serviceMetadata === void 0 ? void 0 : serviceMetadata.value)['destroy'] === 'function') {
                    try {
                        serviceMetadata.value.destroy();
                    }
                    catch (error) {
                        /** We simply ignore the errors from the destroy function. */
                    }
                }
                serviceMetadata.value = EMPTY_VALUE;
            }
        };
        return ContainerInstance;
    }());

    /**
     * Service container.
     */
    var Container = /** @class */ (function () {
        function Container() {
        }
        /**
         * Gets a separate container instance for the given instance id.
         */
        Container.of = function (containerId) {
            if (containerId === void 0) { containerId = 'default'; }
            if (containerId === 'default')
                return this.globalInstance;
            var container = this.instances.find(function (instance) { return instance.id === containerId; });
            if (!container) {
                container = new ContainerInstance(containerId);
                this.instances.push(container);
                // TODO: Why we are not reseting here? Let's reset here. (I have added the commented code.)
                // container.reset();
            }
            return container;
        };
        Container.has = function (identifier) {
            return this.globalInstance.has(identifier);
        };
        Container.get = function (identifier) {
            return this.globalInstance.get(identifier);
        };
        Container.getMany = function (id) {
            return this.globalInstance.getMany(id);
        };
        Container.set = function (identifierOrServiceMetadata, value) {
            this.globalInstance.set(identifierOrServiceMetadata, value);
            return this;
        };
        /**
         * Removes services with a given service identifiers.
         */
        Container.remove = function (identifierOrIdentifierArray) {
            this.globalInstance.remove(identifierOrIdentifierArray);
            return this;
        };
        /**
         * Completely resets the container by removing all previously registered services and handlers from it.
         */
        Container.reset = function (containerId) {
            if (containerId === void 0) { containerId = 'default'; }
            if (containerId == 'default') {
                this.globalInstance.reset();
                this.instances.forEach(function (instance) { return instance.reset(); });
            }
            else {
                var instance = this.instances.find(function (instance) { return instance.id === containerId; });
                if (instance) {
                    instance.reset();
                    this.instances.splice(this.instances.indexOf(instance), 1);
                }
            }
            return this;
        };
        /**
         * Registers a new handler.
         */
        Container.registerHandler = function (handler) {
            this.handlers.push(handler);
            return this;
        };
        /**
         * Helper method that imports given services.
         */
        /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        Container.import = function (services) {
            return this;
        };
        /**
         * All registered handlers. The @Inject() decorator uses handlers internally to mark a property for injection.
         **/
        Container.handlers = [];
        /**  Global container instance. */
        Container.globalInstance = new ContainerInstance('default');
        /** Other containers created using Container.of method. */
        Container.instances = [];
        return Container;
    }());

    // TypeDI Performance Benchmark
    // https://github.com/typestack/typedi
    // Test tokens
    const LoggerToken = new Token('ILogger');
    const CacheToken = new Token('ICache');
    const EventBusToken = new Token('IEventBus');
    const AutomationServiceToken = new Token('AutomationService');
    const TempSensorToken = new Token('TempSensor');
    const MotionSensorToken = new Token('MotionSensor');
    const ThermostatToken = new Token('Thermostat');
    const LightToken = new Token('Light');
    // Test implementations (no global decorator to avoid caching between runs)
    class Logger {
        log(message, context) { }
        info(message, context) { }
        warn(message, context) { }
        error(message, error) { }
    }
    class Cache {
        constructor() {
            this.data = new Map();
        }
        get(key) { return this.data.get(key); }
        set(key, value) { this.data.set(key, value); }
    }
    class TypeDIBenchmark {
        constructor() {
            this.name = 'TypeDI';
            this.framework = 'TypeDI';
            this.results = {
                framework: 'TypeDI',
                resolutionSingleton: 0,
                resolutionTransient: 0,
                buildTime: 0,
                complexGraph: 0,
                bundleSize: 6.41, // Measured with bundle-size script (minified + gzipped)
                decoratorFree: false
            };
        }
        async setup() {
            // Reset container before tests
            Container.reset();
        }
        async testResolutionSingleton() {
            // Reset and rebuild container with singleton factories (not pre-instantiated)
            Container.reset();
            // Use factories so container creates instances on first resolution
            Container.set(LoggerToken, () => new Logger());
            Container.set(CacheToken, () => new Cache());
            // Measure 1000 cached singleton resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                Container.get(LoggerToken);
                Container.get(CacheToken);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionSingleton = Math.round(timeMs * 100) / 100;
            return this.results.resolutionSingleton;
        }
        async testResolutionTransient() {
            // Reset and rebuild container with transient factories
            Container.reset();
            Container.set(LoggerToken, () => new Logger());
            Container.set(CacheToken, () => new Cache());
            // Measure 1000 transient resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                Container.get(LoggerToken);
                Container.get(CacheToken);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.resolutionTransient = Math.round(timeMs * 100) / 100;
            return this.results.resolutionTransient;
        }
        async testBuildTime() {
            // Reset container
            Container.reset();
            const start = performance.now();
            // Register 100 services
            for (let i = 0; i < 100; i++) {
                const token = new Token(`Logger${i}`);
                Container.set(token, new Logger());
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.buildTime = Math.round(timeMs * 100) / 100;
            return this.results.buildTime;
        }
        async testComplexGraph() {
            // Reset and rebuild container
            Container.reset();
            // Register services using factories for Demo 5's smart home setup
            Container.set(LoggerToken, () => new ConsoleLogger());
            Container.set(EventBusToken, () => {
                const logger = Container.get(LoggerToken);
                return new EventBus(logger);
            });
            Container.set(AutomationServiceToken, () => {
                const logger = Container.get(LoggerToken);
                const eventBus = Container.get(EventBusToken);
                return new AutomationService(logger, eventBus);
            });
            // Sensors (instances)
            Container.set(TempSensorToken, new TemperatureSensor('auto-temp', 'Auto Temp', 'office', 22));
            Container.set(MotionSensorToken, new MotionSensor('auto-motion', 'Auto Motion', 'office'));
            // Devices
            Container.set(ThermostatToken, () => {
                const logger = Container.get(LoggerToken);
                return new SmartThermostat('auto-thermo', 'Auto Thermostat', 'office', logger);
            });
            Container.set(LightToken, () => {
                const logger = Container.get(LoggerToken);
                return new SmartLight('auto-light', 'Auto Light', 'office', logger);
            });
            // Measure 1000 complex resolutions
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                Container.get(AutomationServiceToken);
            }
            const end = performance.now();
            const timeMs = end - start;
            this.results.complexGraph = Math.round(timeMs * 100) / 100;
            return this.results.complexGraph;
        }
        cleanup() {
            Container.reset();
        }
        getResults() {
            return this.results;
        }
    }

    // Benchmark Runner - Orchestrates all framework benchmarks
    class BenchmarkRunner {
        constructor() {
            this.tests = [];
            this.results = [];
            this.runData = [];
            this.RUNS_PER_TEST = 100;
            this.tests = [
                new NovaDIBenchmark(),
                new BrandiBenchmark(),
                new InversifyBenchmark(),
                new TSyringeBenchmark(),
                new TypeDIBenchmark(),
            ];
        }
        async runAll() {
            console.log('%c🏁 Starting Performance Benchmarks...', 'font-weight: bold; font-size: 16px; color: #2196F3');
            console.log(`Testing ${this.tests.length} frameworks across 4 metrics (${this.RUNS_PER_TEST} runs each)`);
            console.log('');
            this.results = [];
            this.runData = [];
            for (const test of this.tests) {
                console.group(`%c⚡ ${test.framework}`, 'font-weight: bold; color: #FF9800');
                try {
                    await test.setup();
                    // Arrays to store all runs
                    const resolutionSingletonRuns = [];
                    const resolutionTransientRuns = [];
                    const buildTimeRuns = [];
                    const complexGraphRuns = [];
                    const complexGraphNoAutoWireRuns = [];
                    // Warmup
                    await test.testResolutionSingleton();
                    await test.testResolutionTransient();
                    await test.testBuildTime();
                    await test.testComplexGraph();
                    // Check if this test has the no-autowire variant (only NovaDI)
                    const hasNoAutoWire = test.framework === 'NovaDI' &&
                        typeof test.testComplexGraphNoAutoWire === 'function';
                    if (hasNoAutoWire) {
                        await test.testComplexGraphNoAutoWire();
                    }
                    // Run tests multiple times
                    console.log(`  Running ${this.RUNS_PER_TEST} iterations...`);
                    for (let i = 0; i < this.RUNS_PER_TEST; i++) {
                        const resolutionSingleton = await test.testResolutionSingleton();
                        const resolutionTransient = await test.testResolutionTransient();
                        const buildTime = await test.testBuildTime();
                        const complexGraph = await test.testComplexGraph();
                        resolutionSingletonRuns.push(resolutionSingleton);
                        resolutionTransientRuns.push(resolutionTransient);
                        buildTimeRuns.push(buildTime);
                        complexGraphRuns.push(complexGraph);
                        // Run no-autowire test if available
                        if (hasNoAutoWire) {
                            const complexGraphNoAutoWire = await test.testComplexGraphNoAutoWire();
                            complexGraphNoAutoWireRuns.push(complexGraphNoAutoWire);
                        }
                        if ((i + 1) % 10 === 0) {
                            console.log(`    Completed ${i + 1}/${this.RUNS_PER_TEST} runs`);
                        }
                    }
                    test.cleanup();
                    const result = test.getResults();
                    // Calculate averages
                    const avgSingleton = resolutionSingletonRuns.reduce((a, b) => a + b, 0) / this.RUNS_PER_TEST;
                    const avgTransient = resolutionTransientRuns.reduce((a, b) => a + b, 0) / this.RUNS_PER_TEST;
                    const avgBuild = buildTimeRuns.reduce((a, b) => a + b, 0) / this.RUNS_PER_TEST;
                    const avgComplex = complexGraphRuns.reduce((a, b) => a + b, 0) / this.RUNS_PER_TEST;
                    // Calculate average for no-autowire if available
                    let avgComplexNoAutoWire = 0;
                    if (hasNoAutoWire && complexGraphNoAutoWireRuns.length > 0) {
                        avgComplexNoAutoWire = complexGraphNoAutoWireRuns.reduce((a, b) => a + b, 0) / this.RUNS_PER_TEST;
                    }
                    // Store averaged results for table
                    const finalResult = {
                        ...result,
                        resolutionSingleton: Math.round(avgSingleton * 100) / 100,
                        resolutionTransient: Math.round(avgTransient * 100) / 100,
                        buildTime: Math.round(avgBuild * 100) / 100,
                        complexGraph: Math.round(avgComplex * 100) / 100
                    };
                    // Add no-autowire result if available
                    if (hasNoAutoWire) {
                        finalResult.complexGraphNoAutoWire = Math.round(avgComplexNoAutoWire * 100) / 100;
                    }
                    this.results.push(finalResult);
                    // Store raw run data for scatter chart
                    this.runData.push({
                        framework: test.framework,
                        resolutionSingletonRuns,
                        resolutionTransientRuns,
                        buildTimeRuns,
                        complexGraphRuns,
                        bundleSize: result.bundleSize,
                        decoratorFree: result.decoratorFree
                    });
                    console.log(`  ✅ Avg Singleton Resolution: ${avgSingleton.toFixed(2)}ms`);
                    console.log(`  ✅ Avg Transient Resolution: ${avgTransient.toFixed(2)}ms`);
                    console.log(`  ✅ Avg Build Time: ${avgBuild.toFixed(2)}ms`);
                    console.log(`  ✅ Avg Complex Graph (AutoWire): ${avgComplex.toFixed(2)}ms`);
                    if (hasNoAutoWire) {
                        console.log(`  ⚡ Avg Complex Graph (No AutoWire): ${avgComplexNoAutoWire.toFixed(2)}ms`);
                        const improvement = ((avgComplex - avgComplexNoAutoWire) / avgComplex * 100).toFixed(1);
                        console.log(`     → ${improvement}% faster without AutoWire`);
                    }
                    console.log(`  📦 Bundle Size: ${result.bundleSize}KB`);
                    console.log(`  🎨 Decorator-free: ${result.decoratorFree ? 'Yes ✅' : 'No ❌'}`);
                }
                catch (error) {
                    console.error(`  ❌ Error running ${test.framework} benchmark:`, error);
                }
                console.groupEnd();
            }
            console.log('');
            console.log('%c✅ All benchmarks completed!', 'font-weight: bold; color: #4CAF50');
            return this.results;
        }
        getWinners() {
            if (this.results.length === 0) {
                return {
                    resolutionSpeed: 'N/A',
                    buildTime: 'N/A',
                    complexGraph: 'N/A',
                    bundleSize: 'N/A',
                    overall: 'N/A'
                };
            }
            // Find winners for each metric (lower is better for all metrics)
            const singletonWinner = this.results.reduce((min, r) => r.resolutionSingleton < min.resolutionSingleton ? r : min);
            const transientWinner = this.results.reduce((min, r) => r.resolutionTransient < min.resolutionTransient ? r : min);
            const buildTimeWinner = this.results.reduce((min, r) => r.buildTime < min.buildTime ? r : min);
            const complexGraphWinner = this.results.reduce((min, r) => r.complexGraph < min.complexGraph ? r : min);
            const bundleSizeWinner = this.results.reduce((min, r) => r.bundleSize < min.bundleSize ? r : min);
            // Calculate overall winner (simple scoring: sum of ranks)
            const scores = this.results.map(result => {
                const sortedBySingleton = [...this.results].sort((a, b) => a.resolutionSingleton - b.resolutionSingleton);
                const sortedByTransient = [...this.results].sort((a, b) => a.resolutionTransient - b.resolutionTransient);
                const sortedByBuild = [...this.results].sort((a, b) => a.buildTime - b.buildTime);
                const sortedByGraph = [...this.results].sort((a, b) => a.complexGraph - b.complexGraph);
                const sortedBySize = [...this.results].sort((a, b) => a.bundleSize - b.bundleSize);
                const score = sortedBySingleton.indexOf(result) +
                    sortedByTransient.indexOf(result) +
                    sortedByBuild.indexOf(result) +
                    sortedByGraph.indexOf(result) +
                    sortedBySize.indexOf(result);
                return { framework: result.framework, score };
            });
            const overallWinner = scores.reduce((min, s) => s.score < min.score ? s : min);
            // For WinnerSummary, combine singleton and transient into resolutionSpeed
            return {
                resolutionSpeed: `${singletonWinner.framework} (singleton), ${transientWinner.framework} (transient)`,
                buildTime: buildTimeWinner.framework,
                complexGraph: complexGraphWinner.framework,
                bundleSize: bundleSizeWinner.framework,
                overall: overallWinner.framework
            };
        }
        getResults() {
            return this.results;
        }
        getRunData() {
            return this.runData;
        }
        async runNovadiNoAutowire() {
            console.log('Running NovaDI Complex Graph (No AutoWire) benchmark...');
            // Find NovaDI test
            const novadiTest = this.tests.find(t => t.framework === 'NovaDI');
            if (!novadiTest) {
                throw new Error('NovaDI benchmark not found');
            }
            // Check if it has the no-autowire method
            if (typeof novadiTest.testComplexGraphNoAutoWire !== 'function') {
                throw new Error('NovaDI testComplexGraphNoAutoWire method not found');
            }
            await novadiTest.setup();
            // Warmup
            await novadiTest.testComplexGraphNoAutoWire();
            // Run multiple times and collect results
            const runs = [];
            for (let i = 0; i < this.RUNS_PER_TEST; i++) {
                const result = await novadiTest.testComplexGraphNoAutoWire();
                runs.push(result);
            }
            novadiTest.cleanup();
            // Calculate average
            const average = runs.reduce((a, b) => a + b, 0) / runs.length;
            return average;
        }
    }

    /*!
     * @kurkle/color v0.3.4
     * https://github.com/kurkle/color#readme
     * (c) 2024 Jukka Kurkela
     * Released under the MIT License
     */
    function round(v) {
      return v + 0.5 | 0;
    }
    const lim = (v, l, h) => Math.max(Math.min(v, h), l);
    function p2b(v) {
      return lim(round(v * 2.55), 0, 255);
    }
    function n2b(v) {
      return lim(round(v * 255), 0, 255);
    }
    function b2n(v) {
      return lim(round(v / 2.55) / 100, 0, 1);
    }
    function n2p(v) {
      return lim(round(v * 100), 0, 100);
    }

    const map$1 = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, a: 10, b: 11, c: 12, d: 13, e: 14, f: 15};
    const hex = [...'0123456789ABCDEF'];
    const h1 = b => hex[b & 0xF];
    const h2 = b => hex[(b & 0xF0) >> 4] + hex[b & 0xF];
    const eq = b => ((b & 0xF0) >> 4) === (b & 0xF);
    const isShort = v => eq(v.r) && eq(v.g) && eq(v.b) && eq(v.a);
    function hexParse(str) {
      var len = str.length;
      var ret;
      if (str[0] === '#') {
        if (len === 4 || len === 5) {
          ret = {
            r: 255 & map$1[str[1]] * 17,
            g: 255 & map$1[str[2]] * 17,
            b: 255 & map$1[str[3]] * 17,
            a: len === 5 ? map$1[str[4]] * 17 : 255
          };
        } else if (len === 7 || len === 9) {
          ret = {
            r: map$1[str[1]] << 4 | map$1[str[2]],
            g: map$1[str[3]] << 4 | map$1[str[4]],
            b: map$1[str[5]] << 4 | map$1[str[6]],
            a: len === 9 ? (map$1[str[7]] << 4 | map$1[str[8]]) : 255
          };
        }
      }
      return ret;
    }
    const alpha = (a, f) => a < 255 ? f(a) : '';
    function hexString(v) {
      var f = isShort(v) ? h1 : h2;
      return v
        ? '#' + f(v.r) + f(v.g) + f(v.b) + alpha(v.a, f)
        : undefined;
    }

    const HUE_RE = /^(hsla?|hwb|hsv)\(\s*([-+.e\d]+)(?:deg)?[\s,]+([-+.e\d]+)%[\s,]+([-+.e\d]+)%(?:[\s,]+([-+.e\d]+)(%)?)?\s*\)$/;
    function hsl2rgbn(h, s, l) {
      const a = s * Math.min(l, 1 - l);
      const f = (n, k = (n + h / 30) % 12) => l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return [f(0), f(8), f(4)];
    }
    function hsv2rgbn(h, s, v) {
      const f = (n, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
      return [f(5), f(3), f(1)];
    }
    function hwb2rgbn(h, w, b) {
      const rgb = hsl2rgbn(h, 1, 0.5);
      let i;
      if (w + b > 1) {
        i = 1 / (w + b);
        w *= i;
        b *= i;
      }
      for (i = 0; i < 3; i++) {
        rgb[i] *= 1 - w - b;
        rgb[i] += w;
      }
      return rgb;
    }
    function hueValue(r, g, b, d, max) {
      if (r === max) {
        return ((g - b) / d) + (g < b ? 6 : 0);
      }
      if (g === max) {
        return (b - r) / d + 2;
      }
      return (r - g) / d + 4;
    }
    function rgb2hsl(v) {
      const range = 255;
      const r = v.r / range;
      const g = v.g / range;
      const b = v.b / range;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h, s, d;
      if (max !== min) {
        d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = hueValue(r, g, b, d, max);
        h = h * 60 + 0.5;
      }
      return [h | 0, s || 0, l];
    }
    function calln(f, a, b, c) {
      return (
        Array.isArray(a)
          ? f(a[0], a[1], a[2])
          : f(a, b, c)
      ).map(n2b);
    }
    function hsl2rgb(h, s, l) {
      return calln(hsl2rgbn, h, s, l);
    }
    function hwb2rgb(h, w, b) {
      return calln(hwb2rgbn, h, w, b);
    }
    function hsv2rgb(h, s, v) {
      return calln(hsv2rgbn, h, s, v);
    }
    function hue(h) {
      return (h % 360 + 360) % 360;
    }
    function hueParse(str) {
      const m = HUE_RE.exec(str);
      let a = 255;
      let v;
      if (!m) {
        return;
      }
      if (m[5] !== v) {
        a = m[6] ? p2b(+m[5]) : n2b(+m[5]);
      }
      const h = hue(+m[2]);
      const p1 = +m[3] / 100;
      const p2 = +m[4] / 100;
      if (m[1] === 'hwb') {
        v = hwb2rgb(h, p1, p2);
      } else if (m[1] === 'hsv') {
        v = hsv2rgb(h, p1, p2);
      } else {
        v = hsl2rgb(h, p1, p2);
      }
      return {
        r: v[0],
        g: v[1],
        b: v[2],
        a: a
      };
    }
    function rotate(v, deg) {
      var h = rgb2hsl(v);
      h[0] = hue(h[0] + deg);
      h = hsl2rgb(h);
      v.r = h[0];
      v.g = h[1];
      v.b = h[2];
    }
    function hslString(v) {
      if (!v) {
        return;
      }
      const a = rgb2hsl(v);
      const h = a[0];
      const s = n2p(a[1]);
      const l = n2p(a[2]);
      return v.a < 255
        ? `hsla(${h}, ${s}%, ${l}%, ${b2n(v.a)})`
        : `hsl(${h}, ${s}%, ${l}%)`;
    }

    const map$2 = {
    	x: 'dark',
    	Z: 'light',
    	Y: 're',
    	X: 'blu',
    	W: 'gr',
    	V: 'medium',
    	U: 'slate',
    	A: 'ee',
    	T: 'ol',
    	S: 'or',
    	B: 'ra',
    	C: 'lateg',
    	D: 'ights',
    	R: 'in',
    	Q: 'turquois',
    	E: 'hi',
    	P: 'ro',
    	O: 'al',
    	N: 'le',
    	M: 'de',
    	L: 'yello',
    	F: 'en',
    	K: 'ch',
    	G: 'arks',
    	H: 'ea',
    	I: 'ightg',
    	J: 'wh'
    };
    const names$1 = {
    	OiceXe: 'f0f8ff',
    	antiquewEte: 'faebd7',
    	aqua: 'ffff',
    	aquamarRe: '7fffd4',
    	azuY: 'f0ffff',
    	beige: 'f5f5dc',
    	bisque: 'ffe4c4',
    	black: '0',
    	blanKedOmond: 'ffebcd',
    	Xe: 'ff',
    	XeviTet: '8a2be2',
    	bPwn: 'a52a2a',
    	burlywood: 'deb887',
    	caMtXe: '5f9ea0',
    	KartYuse: '7fff00',
    	KocTate: 'd2691e',
    	cSO: 'ff7f50',
    	cSnflowerXe: '6495ed',
    	cSnsilk: 'fff8dc',
    	crimson: 'dc143c',
    	cyan: 'ffff',
    	xXe: '8b',
    	xcyan: '8b8b',
    	xgTMnPd: 'b8860b',
    	xWay: 'a9a9a9',
    	xgYF: '6400',
    	xgYy: 'a9a9a9',
    	xkhaki: 'bdb76b',
    	xmagFta: '8b008b',
    	xTivegYF: '556b2f',
    	xSange: 'ff8c00',
    	xScEd: '9932cc',
    	xYd: '8b0000',
    	xsOmon: 'e9967a',
    	xsHgYF: '8fbc8f',
    	xUXe: '483d8b',
    	xUWay: '2f4f4f',
    	xUgYy: '2f4f4f',
    	xQe: 'ced1',
    	xviTet: '9400d3',
    	dAppRk: 'ff1493',
    	dApskyXe: 'bfff',
    	dimWay: '696969',
    	dimgYy: '696969',
    	dodgerXe: '1e90ff',
    	fiYbrick: 'b22222',
    	flSOwEte: 'fffaf0',
    	foYstWAn: '228b22',
    	fuKsia: 'ff00ff',
    	gaRsbSo: 'dcdcdc',
    	ghostwEte: 'f8f8ff',
    	gTd: 'ffd700',
    	gTMnPd: 'daa520',
    	Way: '808080',
    	gYF: '8000',
    	gYFLw: 'adff2f',
    	gYy: '808080',
    	honeyMw: 'f0fff0',
    	hotpRk: 'ff69b4',
    	RdianYd: 'cd5c5c',
    	Rdigo: '4b0082',
    	ivSy: 'fffff0',
    	khaki: 'f0e68c',
    	lavFMr: 'e6e6fa',
    	lavFMrXsh: 'fff0f5',
    	lawngYF: '7cfc00',
    	NmoncEffon: 'fffacd',
    	ZXe: 'add8e6',
    	ZcSO: 'f08080',
    	Zcyan: 'e0ffff',
    	ZgTMnPdLw: 'fafad2',
    	ZWay: 'd3d3d3',
    	ZgYF: '90ee90',
    	ZgYy: 'd3d3d3',
    	ZpRk: 'ffb6c1',
    	ZsOmon: 'ffa07a',
    	ZsHgYF: '20b2aa',
    	ZskyXe: '87cefa',
    	ZUWay: '778899',
    	ZUgYy: '778899',
    	ZstAlXe: 'b0c4de',
    	ZLw: 'ffffe0',
    	lime: 'ff00',
    	limegYF: '32cd32',
    	lRF: 'faf0e6',
    	magFta: 'ff00ff',
    	maPon: '800000',
    	VaquamarRe: '66cdaa',
    	VXe: 'cd',
    	VScEd: 'ba55d3',
    	VpurpN: '9370db',
    	VsHgYF: '3cb371',
    	VUXe: '7b68ee',
    	VsprRggYF: 'fa9a',
    	VQe: '48d1cc',
    	VviTetYd: 'c71585',
    	midnightXe: '191970',
    	mRtcYam: 'f5fffa',
    	mistyPse: 'ffe4e1',
    	moccasR: 'ffe4b5',
    	navajowEte: 'ffdead',
    	navy: '80',
    	Tdlace: 'fdf5e6',
    	Tive: '808000',
    	TivedBb: '6b8e23',
    	Sange: 'ffa500',
    	SangeYd: 'ff4500',
    	ScEd: 'da70d6',
    	pOegTMnPd: 'eee8aa',
    	pOegYF: '98fb98',
    	pOeQe: 'afeeee',
    	pOeviTetYd: 'db7093',
    	papayawEp: 'ffefd5',
    	pHKpuff: 'ffdab9',
    	peru: 'cd853f',
    	pRk: 'ffc0cb',
    	plum: 'dda0dd',
    	powMrXe: 'b0e0e6',
    	purpN: '800080',
    	YbeccapurpN: '663399',
    	Yd: 'ff0000',
    	Psybrown: 'bc8f8f',
    	PyOXe: '4169e1',
    	saddNbPwn: '8b4513',
    	sOmon: 'fa8072',
    	sandybPwn: 'f4a460',
    	sHgYF: '2e8b57',
    	sHshell: 'fff5ee',
    	siFna: 'a0522d',
    	silver: 'c0c0c0',
    	skyXe: '87ceeb',
    	UXe: '6a5acd',
    	UWay: '708090',
    	UgYy: '708090',
    	snow: 'fffafa',
    	sprRggYF: 'ff7f',
    	stAlXe: '4682b4',
    	tan: 'd2b48c',
    	teO: '8080',
    	tEstN: 'd8bfd8',
    	tomato: 'ff6347',
    	Qe: '40e0d0',
    	viTet: 'ee82ee',
    	JHt: 'f5deb3',
    	wEte: 'ffffff',
    	wEtesmoke: 'f5f5f5',
    	Lw: 'ffff00',
    	LwgYF: '9acd32'
    };
    function unpack() {
      const unpacked = {};
      const keys = Object.keys(names$1);
      const tkeys = Object.keys(map$2);
      let i, j, k, ok, nk;
      for (i = 0; i < keys.length; i++) {
        ok = nk = keys[i];
        for (j = 0; j < tkeys.length; j++) {
          k = tkeys[j];
          nk = nk.replace(k, map$2[k]);
        }
        k = parseInt(names$1[ok], 16);
        unpacked[nk] = [k >> 16 & 0xFF, k >> 8 & 0xFF, k & 0xFF];
      }
      return unpacked;
    }

    let names;
    function nameParse(str) {
      if (!names) {
        names = unpack();
        names.transparent = [0, 0, 0, 0];
      }
      const a = names[str.toLowerCase()];
      return a && {
        r: a[0],
        g: a[1],
        b: a[2],
        a: a.length === 4 ? a[3] : 255
      };
    }

    const RGB_RE = /^rgba?\(\s*([-+.\d]+)(%)?[\s,]+([-+.e\d]+)(%)?[\s,]+([-+.e\d]+)(%)?(?:[\s,/]+([-+.e\d]+)(%)?)?\s*\)$/;
    function rgbParse(str) {
      const m = RGB_RE.exec(str);
      let a = 255;
      let r, g, b;
      if (!m) {
        return;
      }
      if (m[7] !== r) {
        const v = +m[7];
        a = m[8] ? p2b(v) : lim(v * 255, 0, 255);
      }
      r = +m[1];
      g = +m[3];
      b = +m[5];
      r = 255 & (m[2] ? p2b(r) : lim(r, 0, 255));
      g = 255 & (m[4] ? p2b(g) : lim(g, 0, 255));
      b = 255 & (m[6] ? p2b(b) : lim(b, 0, 255));
      return {
        r: r,
        g: g,
        b: b,
        a: a
      };
    }
    function rgbString(v) {
      return v && (
        v.a < 255
          ? `rgba(${v.r}, ${v.g}, ${v.b}, ${b2n(v.a)})`
          : `rgb(${v.r}, ${v.g}, ${v.b})`
      );
    }

    const to = v => v <= 0.0031308 ? v * 12.92 : Math.pow(v, 1.0 / 2.4) * 1.055 - 0.055;
    const from = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    function interpolate$1(rgb1, rgb2, t) {
      const r = from(b2n(rgb1.r));
      const g = from(b2n(rgb1.g));
      const b = from(b2n(rgb1.b));
      return {
        r: n2b(to(r + t * (from(b2n(rgb2.r)) - r))),
        g: n2b(to(g + t * (from(b2n(rgb2.g)) - g))),
        b: n2b(to(b + t * (from(b2n(rgb2.b)) - b))),
        a: rgb1.a + t * (rgb2.a - rgb1.a)
      };
    }

    function modHSL(v, i, ratio) {
      if (v) {
        let tmp = rgb2hsl(v);
        tmp[i] = Math.max(0, Math.min(tmp[i] + tmp[i] * ratio, i === 0 ? 360 : 1));
        tmp = hsl2rgb(tmp);
        v.r = tmp[0];
        v.g = tmp[1];
        v.b = tmp[2];
      }
    }
    function clone$1(v, proto) {
      return v ? Object.assign(proto || {}, v) : v;
    }
    function fromObject(input) {
      var v = {r: 0, g: 0, b: 0, a: 255};
      if (Array.isArray(input)) {
        if (input.length >= 3) {
          v = {r: input[0], g: input[1], b: input[2], a: 255};
          if (input.length > 3) {
            v.a = n2b(input[3]);
          }
        }
      } else {
        v = clone$1(input, {r: 0, g: 0, b: 0, a: 1});
        v.a = n2b(v.a);
      }
      return v;
    }
    function functionParse(str) {
      if (str.charAt(0) === 'r') {
        return rgbParse(str);
      }
      return hueParse(str);
    }
    class Color {
      constructor(input) {
        if (input instanceof Color) {
          return input;
        }
        const type = typeof input;
        let v;
        if (type === 'object') {
          v = fromObject(input);
        } else if (type === 'string') {
          v = hexParse(input) || nameParse(input) || functionParse(input);
        }
        this._rgb = v;
        this._valid = !!v;
      }
      get valid() {
        return this._valid;
      }
      get rgb() {
        var v = clone$1(this._rgb);
        if (v) {
          v.a = b2n(v.a);
        }
        return v;
      }
      set rgb(obj) {
        this._rgb = fromObject(obj);
      }
      rgbString() {
        return this._valid ? rgbString(this._rgb) : undefined;
      }
      hexString() {
        return this._valid ? hexString(this._rgb) : undefined;
      }
      hslString() {
        return this._valid ? hslString(this._rgb) : undefined;
      }
      mix(color, weight) {
        if (color) {
          const c1 = this.rgb;
          const c2 = color.rgb;
          let w2;
          const p = weight === w2 ? 0.5 : weight;
          const w = 2 * p - 1;
          const a = c1.a - c2.a;
          const w1 = ((w * a === -1 ? w : (w + a) / (1 + w * a)) + 1) / 2.0;
          w2 = 1 - w1;
          c1.r = 0xFF & w1 * c1.r + w2 * c2.r + 0.5;
          c1.g = 0xFF & w1 * c1.g + w2 * c2.g + 0.5;
          c1.b = 0xFF & w1 * c1.b + w2 * c2.b + 0.5;
          c1.a = p * c1.a + (1 - p) * c2.a;
          this.rgb = c1;
        }
        return this;
      }
      interpolate(color, t) {
        if (color) {
          this._rgb = interpolate$1(this._rgb, color._rgb, t);
        }
        return this;
      }
      clone() {
        return new Color(this.rgb);
      }
      alpha(a) {
        this._rgb.a = n2b(a);
        return this;
      }
      clearer(ratio) {
        const rgb = this._rgb;
        rgb.a *= 1 - ratio;
        return this;
      }
      greyscale() {
        const rgb = this._rgb;
        const val = round(rgb.r * 0.3 + rgb.g * 0.59 + rgb.b * 0.11);
        rgb.r = rgb.g = rgb.b = val;
        return this;
      }
      opaquer(ratio) {
        const rgb = this._rgb;
        rgb.a *= 1 + ratio;
        return this;
      }
      negate() {
        const v = this._rgb;
        v.r = 255 - v.r;
        v.g = 255 - v.g;
        v.b = 255 - v.b;
        return this;
      }
      lighten(ratio) {
        modHSL(this._rgb, 2, ratio);
        return this;
      }
      darken(ratio) {
        modHSL(this._rgb, 2, -ratio);
        return this;
      }
      saturate(ratio) {
        modHSL(this._rgb, 1, ratio);
        return this;
      }
      desaturate(ratio) {
        modHSL(this._rgb, 1, -ratio);
        return this;
      }
      rotate(deg) {
        rotate(this._rgb, deg);
        return this;
      }
    }

    /*!
     * Chart.js v4.5.1
     * https://www.chartjs.org
     * (c) 2025 Chart.js Contributors
     * Released under the MIT License
     */

    /**
     * @namespace Chart.helpers
     */ /**
     * An empty function that can be used, for example, for optional callback.
     */ function noop() {
    /* noop */ }
    /**
     * Returns a unique id, sequentially generated from a global variable.
     */ const uid = (()=>{
        let id = 0;
        return ()=>id++;
    })();
    /**
     * Returns true if `value` is neither null nor undefined, else returns false.
     * @param value - The value to test.
     * @since 2.7.0
     */ function isNullOrUndef(value) {
        return value === null || value === undefined;
    }
    /**
     * Returns true if `value` is an array (including typed arrays), else returns false.
     * @param value - The value to test.
     * @function
     */ function isArray(value) {
        if (Array.isArray && Array.isArray(value)) {
            return true;
        }
        const type = Object.prototype.toString.call(value);
        if (type.slice(0, 7) === '[object' && type.slice(-6) === 'Array]') {
            return true;
        }
        return false;
    }
    /**
     * Returns true if `value` is an object (excluding null), else returns false.
     * @param value - The value to test.
     * @since 2.7.0
     */ function isObject(value) {
        return value !== null && Object.prototype.toString.call(value) === '[object Object]';
    }
    /**
     * Returns true if `value` is a finite number, else returns false
     * @param value  - The value to test.
     */ function isNumberFinite(value) {
        return (typeof value === 'number' || value instanceof Number) && isFinite(+value);
    }
    /**
     * Returns `value` if finite, else returns `defaultValue`.
     * @param value - The value to return if defined.
     * @param defaultValue - The value to return if `value` is not finite.
     */ function finiteOrDefault(value, defaultValue) {
        return isNumberFinite(value) ? value : defaultValue;
    }
    /**
     * Returns `value` if defined, else returns `defaultValue`.
     * @param value - The value to return if defined.
     * @param defaultValue - The value to return if `value` is undefined.
     */ function valueOrDefault(value, defaultValue) {
        return typeof value === 'undefined' ? defaultValue : value;
    }
    const toPercentage = (value, dimension)=>typeof value === 'string' && value.endsWith('%') ? parseFloat(value) / 100 : +value / dimension;
    const toDimension = (value, dimension)=>typeof value === 'string' && value.endsWith('%') ? parseFloat(value) / 100 * dimension : +value;
    /**
     * Calls `fn` with the given `args` in the scope defined by `thisArg` and returns the
     * value returned by `fn`. If `fn` is not a function, this method returns undefined.
     * @param fn - The function to call.
     * @param args - The arguments with which `fn` should be called.
     * @param [thisArg] - The value of `this` provided for the call to `fn`.
     */ function callback(fn, args, thisArg) {
        if (fn && typeof fn.call === 'function') {
            return fn.apply(thisArg, args);
        }
    }
    function each(loopable, fn, thisArg, reverse) {
        let i, len, keys;
        if (isArray(loopable)) {
            len = loopable.length;
            {
                for(i = 0; i < len; i++){
                    fn.call(thisArg, loopable[i], i);
                }
            }
        } else if (isObject(loopable)) {
            keys = Object.keys(loopable);
            len = keys.length;
            for(i = 0; i < len; i++){
                fn.call(thisArg, loopable[keys[i]], keys[i]);
            }
        }
    }
    /**
     * Returns true if the `a0` and `a1` arrays have the same content, else returns false.
     * @param a0 - The array to compare
     * @param a1 - The array to compare
     * @private
     */ function _elementsEqual(a0, a1) {
        let i, ilen, v0, v1;
        if (!a0 || !a1 || a0.length !== a1.length) {
            return false;
        }
        for(i = 0, ilen = a0.length; i < ilen; ++i){
            v0 = a0[i];
            v1 = a1[i];
            if (v0.datasetIndex !== v1.datasetIndex || v0.index !== v1.index) {
                return false;
            }
        }
        return true;
    }
    /**
     * Returns a deep copy of `source` without keeping references on objects and arrays.
     * @param source - The value to clone.
     */ function clone(source) {
        if (isArray(source)) {
            return source.map(clone);
        }
        if (isObject(source)) {
            const target = Object.create(null);
            const keys = Object.keys(source);
            const klen = keys.length;
            let k = 0;
            for(; k < klen; ++k){
                target[keys[k]] = clone(source[keys[k]]);
            }
            return target;
        }
        return source;
    }
    function isValidKey(key) {
        return [
            '__proto__',
            'prototype',
            'constructor'
        ].indexOf(key) === -1;
    }
    /**
     * The default merger when Chart.helpers.merge is called without merger option.
     * Note(SB): also used by mergeConfig and mergeScaleConfig as fallback.
     * @private
     */ function _merger(key, target, source, options) {
        if (!isValidKey(key)) {
            return;
        }
        const tval = target[key];
        const sval = source[key];
        if (isObject(tval) && isObject(sval)) {
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            merge(tval, sval, options);
        } else {
            target[key] = clone(sval);
        }
    }
    function merge(target, source, options) {
        const sources = isArray(source) ? source : [
            source
        ];
        const ilen = sources.length;
        if (!isObject(target)) {
            return target;
        }
        options = options || {};
        const merger = options.merger || _merger;
        let current;
        for(let i = 0; i < ilen; ++i){
            current = sources[i];
            if (!isObject(current)) {
                continue;
            }
            const keys = Object.keys(current);
            for(let k = 0, klen = keys.length; k < klen; ++k){
                merger(keys[k], target, current, options);
            }
        }
        return target;
    }
    function mergeIf(target, source) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return merge(target, source, {
            merger: _mergerIf
        });
    }
    /**
     * Merges source[key] in target[key] only if target[key] is undefined.
     * @private
     */ function _mergerIf(key, target, source) {
        if (!isValidKey(key)) {
            return;
        }
        const tval = target[key];
        const sval = source[key];
        if (isObject(tval) && isObject(sval)) {
            mergeIf(tval, sval);
        } else if (!Object.prototype.hasOwnProperty.call(target, key)) {
            target[key] = clone(sval);
        }
    }
    // resolveObjectKey resolver cache
    const keyResolvers = {
        // Chart.helpers.core resolveObjectKey should resolve empty key to root object
        '': (v)=>v,
        // default resolvers
        x: (o)=>o.x,
        y: (o)=>o.y
    };
    /**
     * @private
     */ function _splitKey(key) {
        const parts = key.split('.');
        const keys = [];
        let tmp = '';
        for (const part of parts){
            tmp += part;
            if (tmp.endsWith('\\')) {
                tmp = tmp.slice(0, -1) + '.';
            } else {
                keys.push(tmp);
                tmp = '';
            }
        }
        return keys;
    }
    function _getKeyResolver(key) {
        const keys = _splitKey(key);
        return (obj)=>{
            for (const k of keys){
                if (k === '') {
                    break;
                }
                obj = obj && obj[k];
            }
            return obj;
        };
    }
    function resolveObjectKey(obj, key) {
        const resolver = keyResolvers[key] || (keyResolvers[key] = _getKeyResolver(key));
        return resolver(obj);
    }
    /**
     * @private
     */ function _capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    const defined = (value)=>typeof value !== 'undefined';
    const isFunction = (value)=>typeof value === 'function';
    // Adapted from https://stackoverflow.com/questions/31128855/comparing-ecma6-sets-for-equality#31129384
    const setsEqual = (a, b)=>{
        if (a.size !== b.size) {
            return false;
        }
        for (const item of a){
            if (!b.has(item)) {
                return false;
            }
        }
        return true;
    };
    /**
     * @param e - The event
     * @private
     */ function _isClickEvent(e) {
        return e.type === 'mouseup' || e.type === 'click' || e.type === 'contextmenu';
    }

    /**
     * @alias Chart.helpers.math
     * @namespace
     */ const PI = Math.PI;
    const TAU = 2 * PI;
    const PITAU = TAU + PI;
    const INFINITY = Number.POSITIVE_INFINITY;
    const RAD_PER_DEG = PI / 180;
    const HALF_PI = PI / 2;
    const QUARTER_PI = PI / 4;
    const TWO_THIRDS_PI = PI * 2 / 3;
    const log10 = Math.log10;
    const sign = Math.sign;
    function almostEquals(x, y, epsilon) {
        return Math.abs(x - y) < epsilon;
    }
    /**
     * Implementation of the nice number algorithm used in determining where axis labels will go
     */ function niceNum(range) {
        const roundedRange = Math.round(range);
        range = almostEquals(range, roundedRange, range / 1000) ? roundedRange : range;
        const niceRange = Math.pow(10, Math.floor(log10(range)));
        const fraction = range / niceRange;
        const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
        return niceFraction * niceRange;
    }
    /**
     * Returns an array of factors sorted from 1 to sqrt(value)
     * @private
     */ function _factorize(value) {
        const result = [];
        const sqrt = Math.sqrt(value);
        let i;
        for(i = 1; i < sqrt; i++){
            if (value % i === 0) {
                result.push(i);
                result.push(value / i);
            }
        }
        if (sqrt === (sqrt | 0)) {
            result.push(sqrt);
        }
        result.sort((a, b)=>a - b).pop();
        return result;
    }
    /**
     * Verifies that attempting to coerce n to string or number won't throw a TypeError.
     */ function isNonPrimitive(n) {
        return typeof n === 'symbol' || typeof n === 'object' && n !== null && !(Symbol.toPrimitive in n || 'toString' in n || 'valueOf' in n);
    }
    function isNumber(n) {
        return !isNonPrimitive(n) && !isNaN(parseFloat(n)) && isFinite(n);
    }
    function almostWhole(x, epsilon) {
        const rounded = Math.round(x);
        return rounded - epsilon <= x && rounded + epsilon >= x;
    }
    /**
     * @private
     */ function _setMinAndMaxByKey(array, target, property) {
        let i, ilen, value;
        for(i = 0, ilen = array.length; i < ilen; i++){
            value = array[i][property];
            if (!isNaN(value)) {
                target.min = Math.min(target.min, value);
                target.max = Math.max(target.max, value);
            }
        }
    }
    function toRadians(degrees) {
        return degrees * (PI / 180);
    }
    function toDegrees(radians) {
        return radians * (180 / PI);
    }
    /**
     * Returns the number of decimal places
     * i.e. the number of digits after the decimal point, of the value of this Number.
     * @param x - A number.
     * @returns The number of decimal places.
     * @private
     */ function _decimalPlaces(x) {
        if (!isNumberFinite(x)) {
            return;
        }
        let e = 1;
        let p = 0;
        while(Math.round(x * e) / e !== x){
            e *= 10;
            p++;
        }
        return p;
    }
    // Gets the angle from vertical upright to the point about a centre.
    function getAngleFromPoint(centrePoint, anglePoint) {
        const distanceFromXCenter = anglePoint.x - centrePoint.x;
        const distanceFromYCenter = anglePoint.y - centrePoint.y;
        const radialDistanceFromCenter = Math.sqrt(distanceFromXCenter * distanceFromXCenter + distanceFromYCenter * distanceFromYCenter);
        let angle = Math.atan2(distanceFromYCenter, distanceFromXCenter);
        if (angle < -0.5 * PI) {
            angle += TAU; // make sure the returned angle is in the range of (-PI/2, 3PI/2]
        }
        return {
            angle,
            distance: radialDistanceFromCenter
        };
    }
    function distanceBetweenPoints(pt1, pt2) {
        return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
    }
    /**
     * Shortest distance between angles, in either direction.
     * @private
     */ function _angleDiff(a, b) {
        return (a - b + PITAU) % TAU - PI;
    }
    /**
     * Normalize angle to be between 0 and 2*PI
     * @private
     */ function _normalizeAngle(a) {
        return (a % TAU + TAU) % TAU;
    }
    /**
     * @private
     */ function _angleBetween(angle, start, end, sameAngleIsFullCircle) {
        const a = _normalizeAngle(angle);
        const s = _normalizeAngle(start);
        const e = _normalizeAngle(end);
        const angleToStart = _normalizeAngle(s - a);
        const angleToEnd = _normalizeAngle(e - a);
        const startToAngle = _normalizeAngle(a - s);
        const endToAngle = _normalizeAngle(a - e);
        return a === s || a === e || sameAngleIsFullCircle && s === e || angleToStart > angleToEnd && startToAngle < endToAngle;
    }
    /**
     * Limit `value` between `min` and `max`
     * @param value
     * @param min
     * @param max
     * @private
     */ function _limitValue(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
    /**
     * @param {number} value
     * @private
     */ function _int16Range(value) {
        return _limitValue(value, -32768, 32767);
    }
    /**
     * @param value
     * @param start
     * @param end
     * @param [epsilon]
     * @private
     */ function _isBetween(value, start, end, epsilon = 1e-6) {
        return value >= Math.min(start, end) - epsilon && value <= Math.max(start, end) + epsilon;
    }

    function _lookup(table, value, cmp) {
        cmp = cmp || ((index)=>table[index] < value);
        let hi = table.length - 1;
        let lo = 0;
        let mid;
        while(hi - lo > 1){
            mid = lo + hi >> 1;
            if (cmp(mid)) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return {
            lo,
            hi
        };
    }
    /**
     * Binary search
     * @param table - the table search. must be sorted!
     * @param key - property name for the value in each entry
     * @param value - value to find
     * @param last - lookup last index
     * @private
     */ const _lookupByKey = (table, key, value, last)=>_lookup(table, value, last ? (index)=>{
            const ti = table[index][key];
            return ti < value || ti === value && table[index + 1][key] === value;
        } : (index)=>table[index][key] < value);
    /**
     * Reverse binary search
     * @param table - the table search. must be sorted!
     * @param key - property name for the value in each entry
     * @param value - value to find
     * @private
     */ const _rlookupByKey = (table, key, value)=>_lookup(table, value, (index)=>table[index][key] >= value);
    /**
     * Return subset of `values` between `min` and `max` inclusive.
     * Values are assumed to be in sorted order.
     * @param values - sorted array of values
     * @param min - min value
     * @param max - max value
     */ function _filterBetween(values, min, max) {
        let start = 0;
        let end = values.length;
        while(start < end && values[start] < min){
            start++;
        }
        while(end > start && values[end - 1] > max){
            end--;
        }
        return start > 0 || end < values.length ? values.slice(start, end) : values;
    }
    const arrayEvents = [
        'push',
        'pop',
        'shift',
        'splice',
        'unshift'
    ];
    function listenArrayEvents(array, listener) {
        if (array._chartjs) {
            array._chartjs.listeners.push(listener);
            return;
        }
        Object.defineProperty(array, '_chartjs', {
            configurable: true,
            enumerable: false,
            value: {
                listeners: [
                    listener
                ]
            }
        });
        arrayEvents.forEach((key)=>{
            const method = '_onData' + _capitalize(key);
            const base = array[key];
            Object.defineProperty(array, key, {
                configurable: true,
                enumerable: false,
                value (...args) {
                    const res = base.apply(this, args);
                    array._chartjs.listeners.forEach((object)=>{
                        if (typeof object[method] === 'function') {
                            object[method](...args);
                        }
                    });
                    return res;
                }
            });
        });
    }
    function unlistenArrayEvents(array, listener) {
        const stub = array._chartjs;
        if (!stub) {
            return;
        }
        const listeners = stub.listeners;
        const index = listeners.indexOf(listener);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
        if (listeners.length > 0) {
            return;
        }
        arrayEvents.forEach((key)=>{
            delete array[key];
        });
        delete array._chartjs;
    }
    /**
     * @param items
     */ function _arrayUnique(items) {
        const set = new Set(items);
        if (set.size === items.length) {
            return items;
        }
        return Array.from(set);
    }
    /**
    * Request animation polyfill
    */ const requestAnimFrame = function() {
        if (typeof window === 'undefined') {
            return function(callback) {
                return callback();
            };
        }
        return window.requestAnimationFrame;
    }();
    /**
     * Throttles calling `fn` once per animation frame
     * Latest arguments are used on the actual call
     */ function throttled(fn, thisArg) {
        let argsToUse = [];
        let ticking = false;
        return function(...args) {
            // Save the args for use later
            argsToUse = args;
            if (!ticking) {
                ticking = true;
                requestAnimFrame.call(window, ()=>{
                    ticking = false;
                    fn.apply(thisArg, argsToUse);
                });
            }
        };
    }
    /**
     * Debounces calling `fn` for `delay` ms
     */ function debounce(fn, delay) {
        let timeout;
        return function(...args) {
            if (delay) {
                clearTimeout(timeout);
                timeout = setTimeout(fn, delay, args);
            } else {
                fn.apply(this, args);
            }
            return delay;
        };
    }
    /**
     * Converts 'start' to 'left', 'end' to 'right' and others to 'center'
     * @private
     */ const _toLeftRightCenter = (align)=>align === 'start' ? 'left' : align === 'end' ? 'right' : 'center';
    /**
     * Returns `start`, `end` or `(start + end) / 2` depending on `align`. Defaults to `center`
     * @private
     */ const _alignStartEnd = (align, start, end)=>align === 'start' ? start : align === 'end' ? end : (start + end) / 2;
    /**
     * Returns `left`, `right` or `(left + right) / 2` depending on `align`. Defaults to `left`
     * @private
     */ const _textX = (align, left, right, rtl)=>{
        const check = rtl ? 'left' : 'right';
        return align === check ? right : align === 'center' ? (left + right) / 2 : left;
    };
    /**
     * Return start and count of visible points.
     * @private
     */ function _getStartAndCountOfVisiblePoints(meta, points, animationsDisabled) {
        const pointCount = points.length;
        let start = 0;
        let count = pointCount;
        if (meta._sorted) {
            const { iScale , vScale , _parsed  } = meta;
            const spanGaps = meta.dataset ? meta.dataset.options ? meta.dataset.options.spanGaps : null : null;
            const axis = iScale.axis;
            const { min , max , minDefined , maxDefined  } = iScale.getUserBounds();
            if (minDefined) {
                start = Math.min(// @ts-expect-error Need to type _parsed
                _lookupByKey(_parsed, axis, min).lo, // @ts-expect-error Need to fix types on _lookupByKey
                animationsDisabled ? pointCount : _lookupByKey(points, axis, iScale.getPixelForValue(min)).lo);
                if (spanGaps) {
                    const distanceToDefinedLo = _parsed.slice(0, start + 1).reverse().findIndex((point)=>!isNullOrUndef(point[vScale.axis]));
                    start -= Math.max(0, distanceToDefinedLo);
                }
                start = _limitValue(start, 0, pointCount - 1);
            }
            if (maxDefined) {
                let end = Math.max(// @ts-expect-error Need to type _parsed
                _lookupByKey(_parsed, iScale.axis, max, true).hi + 1, // @ts-expect-error Need to fix types on _lookupByKey
                animationsDisabled ? 0 : _lookupByKey(points, axis, iScale.getPixelForValue(max), true).hi + 1);
                if (spanGaps) {
                    const distanceToDefinedHi = _parsed.slice(end - 1).findIndex((point)=>!isNullOrUndef(point[vScale.axis]));
                    end += Math.max(0, distanceToDefinedHi);
                }
                count = _limitValue(end, start, pointCount) - start;
            } else {
                count = pointCount - start;
            }
        }
        return {
            start,
            count
        };
    }
    /**
     * Checks if the scale ranges have changed.
     * @param {object} meta - dataset meta.
     * @returns {boolean}
     * @private
     */ function _scaleRangesChanged(meta) {
        const { xScale , yScale , _scaleRanges  } = meta;
        const newRanges = {
            xmin: xScale.min,
            xmax: xScale.max,
            ymin: yScale.min,
            ymax: yScale.max
        };
        if (!_scaleRanges) {
            meta._scaleRanges = newRanges;
            return true;
        }
        const changed = _scaleRanges.xmin !== xScale.min || _scaleRanges.xmax !== xScale.max || _scaleRanges.ymin !== yScale.min || _scaleRanges.ymax !== yScale.max;
        Object.assign(_scaleRanges, newRanges);
        return changed;
    }

    const atEdge = (t)=>t === 0 || t === 1;
    const elasticIn = (t, s, p)=>-(Math.pow(2, 10 * (t -= 1)) * Math.sin((t - s) * TAU / p));
    const elasticOut = (t, s, p)=>Math.pow(2, -10 * t) * Math.sin((t - s) * TAU / p) + 1;
    /**
     * Easing functions adapted from Robert Penner's easing equations.
     * @namespace Chart.helpers.easing.effects
     * @see http://www.robertpenner.com/easing/
     */ const effects = {
        linear: (t)=>t,
        easeInQuad: (t)=>t * t,
        easeOutQuad: (t)=>-t * (t - 2),
        easeInOutQuad: (t)=>(t /= 0.5) < 1 ? 0.5 * t * t : -0.5 * (--t * (t - 2) - 1),
        easeInCubic: (t)=>t * t * t,
        easeOutCubic: (t)=>(t -= 1) * t * t + 1,
        easeInOutCubic: (t)=>(t /= 0.5) < 1 ? 0.5 * t * t * t : 0.5 * ((t -= 2) * t * t + 2),
        easeInQuart: (t)=>t * t * t * t,
        easeOutQuart: (t)=>-((t -= 1) * t * t * t - 1),
        easeInOutQuart: (t)=>(t /= 0.5) < 1 ? 0.5 * t * t * t * t : -0.5 * ((t -= 2) * t * t * t - 2),
        easeInQuint: (t)=>t * t * t * t * t,
        easeOutQuint: (t)=>(t -= 1) * t * t * t * t + 1,
        easeInOutQuint: (t)=>(t /= 0.5) < 1 ? 0.5 * t * t * t * t * t : 0.5 * ((t -= 2) * t * t * t * t + 2),
        easeInSine: (t)=>-Math.cos(t * HALF_PI) + 1,
        easeOutSine: (t)=>Math.sin(t * HALF_PI),
        easeInOutSine: (t)=>-0.5 * (Math.cos(PI * t) - 1),
        easeInExpo: (t)=>t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
        easeOutExpo: (t)=>t === 1 ? 1 : -Math.pow(2, -10 * t) + 1,
        easeInOutExpo: (t)=>atEdge(t) ? t : t < 0.5 ? 0.5 * Math.pow(2, 10 * (t * 2 - 1)) : 0.5 * (-Math.pow(2, -10 * (t * 2 - 1)) + 2),
        easeInCirc: (t)=>t >= 1 ? t : -(Math.sqrt(1 - t * t) - 1),
        easeOutCirc: (t)=>Math.sqrt(1 - (t -= 1) * t),
        easeInOutCirc: (t)=>(t /= 0.5) < 1 ? -0.5 * (Math.sqrt(1 - t * t) - 1) : 0.5 * (Math.sqrt(1 - (t -= 2) * t) + 1),
        easeInElastic: (t)=>atEdge(t) ? t : elasticIn(t, 0.075, 0.3),
        easeOutElastic: (t)=>atEdge(t) ? t : elasticOut(t, 0.075, 0.3),
        easeInOutElastic (t) {
            const s = 0.1125;
            const p = 0.45;
            return atEdge(t) ? t : t < 0.5 ? 0.5 * elasticIn(t * 2, s, p) : 0.5 + 0.5 * elasticOut(t * 2 - 1, s, p);
        },
        easeInBack (t) {
            const s = 1.70158;
            return t * t * ((s + 1) * t - s);
        },
        easeOutBack (t) {
            const s = 1.70158;
            return (t -= 1) * t * ((s + 1) * t + s) + 1;
        },
        easeInOutBack (t) {
            let s = 1.70158;
            if ((t /= 0.5) < 1) {
                return 0.5 * (t * t * (((s *= 1.525) + 1) * t - s));
            }
            return 0.5 * ((t -= 2) * t * (((s *= 1.525) + 1) * t + s) + 2);
        },
        easeInBounce: (t)=>1 - effects.easeOutBounce(1 - t),
        easeOutBounce (t) {
            const m = 7.5625;
            const d = 2.75;
            if (t < 1 / d) {
                return m * t * t;
            }
            if (t < 2 / d) {
                return m * (t -= 1.5 / d) * t + 0.75;
            }
            if (t < 2.5 / d) {
                return m * (t -= 2.25 / d) * t + 0.9375;
            }
            return m * (t -= 2.625 / d) * t + 0.984375;
        },
        easeInOutBounce: (t)=>t < 0.5 ? effects.easeInBounce(t * 2) * 0.5 : effects.easeOutBounce(t * 2 - 1) * 0.5 + 0.5
    };

    function isPatternOrGradient(value) {
        if (value && typeof value === 'object') {
            const type = value.toString();
            return type === '[object CanvasPattern]' || type === '[object CanvasGradient]';
        }
        return false;
    }
    function color(value) {
        return isPatternOrGradient(value) ? value : new Color(value);
    }
    function getHoverColor(value) {
        return isPatternOrGradient(value) ? value : new Color(value).saturate(0.5).darken(0.1).hexString();
    }

    const numbers = [
        'x',
        'y',
        'borderWidth',
        'radius',
        'tension'
    ];
    const colors = [
        'color',
        'borderColor',
        'backgroundColor'
    ];
    function applyAnimationsDefaults(defaults) {
        defaults.set('animation', {
            delay: undefined,
            duration: 1000,
            easing: 'easeOutQuart',
            fn: undefined,
            from: undefined,
            loop: undefined,
            to: undefined,
            type: undefined
        });
        defaults.describe('animation', {
            _fallback: false,
            _indexable: false,
            _scriptable: (name)=>name !== 'onProgress' && name !== 'onComplete' && name !== 'fn'
        });
        defaults.set('animations', {
            colors: {
                type: 'color',
                properties: colors
            },
            numbers: {
                type: 'number',
                properties: numbers
            }
        });
        defaults.describe('animations', {
            _fallback: 'animation'
        });
        defaults.set('transitions', {
            active: {
                animation: {
                    duration: 400
                }
            },
            resize: {
                animation: {
                    duration: 0
                }
            },
            show: {
                animations: {
                    colors: {
                        from: 'transparent'
                    },
                    visible: {
                        type: 'boolean',
                        duration: 0
                    }
                }
            },
            hide: {
                animations: {
                    colors: {
                        to: 'transparent'
                    },
                    visible: {
                        type: 'boolean',
                        easing: 'linear',
                        fn: (v)=>v | 0
                    }
                }
            }
        });
    }

    function applyLayoutsDefaults(defaults) {
        defaults.set('layout', {
            autoPadding: true,
            padding: {
                top: 0,
                right: 0,
                bottom: 0,
                left: 0
            }
        });
    }

    const intlCache = new Map();
    function getNumberFormat(locale, options) {
        options = options || {};
        const cacheKey = locale + JSON.stringify(options);
        let formatter = intlCache.get(cacheKey);
        if (!formatter) {
            formatter = new Intl.NumberFormat(locale, options);
            intlCache.set(cacheKey, formatter);
        }
        return formatter;
    }
    function formatNumber(num, locale, options) {
        return getNumberFormat(locale, options).format(num);
    }

    const formatters = {
     values (value) {
            return isArray(value) ?  value : '' + value;
        },
     numeric (tickValue, index, ticks) {
            if (tickValue === 0) {
                return '0';
            }
            const locale = this.chart.options.locale;
            let notation;
            let delta = tickValue;
            if (ticks.length > 1) {
                const maxTick = Math.max(Math.abs(ticks[0].value), Math.abs(ticks[ticks.length - 1].value));
                if (maxTick < 1e-4 || maxTick > 1e+15) {
                    notation = 'scientific';
                }
                delta = calculateDelta(tickValue, ticks);
            }
            const logDelta = log10(Math.abs(delta));
            const numDecimal = isNaN(logDelta) ? 1 : Math.max(Math.min(-1 * Math.floor(logDelta), 20), 0);
            const options = {
                notation,
                minimumFractionDigits: numDecimal,
                maximumFractionDigits: numDecimal
            };
            Object.assign(options, this.options.ticks.format);
            return formatNumber(tickValue, locale, options);
        },
     logarithmic (tickValue, index, ticks) {
            if (tickValue === 0) {
                return '0';
            }
            const remain = ticks[index].significand || tickValue / Math.pow(10, Math.floor(log10(tickValue)));
            if ([
                1,
                2,
                3,
                5,
                10,
                15
            ].includes(remain) || index > 0.8 * ticks.length) {
                return formatters.numeric.call(this, tickValue, index, ticks);
            }
            return '';
        }
    };
    function calculateDelta(tickValue, ticks) {
        let delta = ticks.length > 3 ? ticks[2].value - ticks[1].value : ticks[1].value - ticks[0].value;
        if (Math.abs(delta) >= 1 && tickValue !== Math.floor(tickValue)) {
            delta = tickValue - Math.floor(tickValue);
        }
        return delta;
    }
     var Ticks = {
        formatters
    };

    function applyScaleDefaults(defaults) {
        defaults.set('scale', {
            display: true,
            offset: false,
            reverse: false,
            beginAtZero: false,
     bounds: 'ticks',
            clip: true,
     grace: 0,
            grid: {
                display: true,
                lineWidth: 1,
                drawOnChartArea: true,
                drawTicks: true,
                tickLength: 8,
                tickWidth: (_ctx, options)=>options.lineWidth,
                tickColor: (_ctx, options)=>options.color,
                offset: false
            },
            border: {
                display: true,
                dash: [],
                dashOffset: 0.0,
                width: 1
            },
            title: {
                display: false,
                text: '',
                padding: {
                    top: 4,
                    bottom: 4
                }
            },
            ticks: {
                minRotation: 0,
                maxRotation: 50,
                mirror: false,
                textStrokeWidth: 0,
                textStrokeColor: '',
                padding: 3,
                display: true,
                autoSkip: true,
                autoSkipPadding: 3,
                labelOffset: 0,
                callback: Ticks.formatters.values,
                minor: {},
                major: {},
                align: 'center',
                crossAlign: 'near',
                showLabelBackdrop: false,
                backdropColor: 'rgba(255, 255, 255, 0.75)',
                backdropPadding: 2
            }
        });
        defaults.route('scale.ticks', 'color', '', 'color');
        defaults.route('scale.grid', 'color', '', 'borderColor');
        defaults.route('scale.border', 'color', '', 'borderColor');
        defaults.route('scale.title', 'color', '', 'color');
        defaults.describe('scale', {
            _fallback: false,
            _scriptable: (name)=>!name.startsWith('before') && !name.startsWith('after') && name !== 'callback' && name !== 'parser',
            _indexable: (name)=>name !== 'borderDash' && name !== 'tickBorderDash' && name !== 'dash'
        });
        defaults.describe('scales', {
            _fallback: 'scale'
        });
        defaults.describe('scale.ticks', {
            _scriptable: (name)=>name !== 'backdropPadding' && name !== 'callback',
            _indexable: (name)=>name !== 'backdropPadding'
        });
    }

    const overrides = Object.create(null);
    const descriptors = Object.create(null);
     function getScope$1(node, key) {
        if (!key) {
            return node;
        }
        const keys = key.split('.');
        for(let i = 0, n = keys.length; i < n; ++i){
            const k = keys[i];
            node = node[k] || (node[k] = Object.create(null));
        }
        return node;
    }
    function set(root, scope, values) {
        if (typeof scope === 'string') {
            return merge(getScope$1(root, scope), values);
        }
        return merge(getScope$1(root, ''), scope);
    }
     class Defaults {
        constructor(_descriptors, _appliers){
            this.animation = undefined;
            this.backgroundColor = 'rgba(0,0,0,0.1)';
            this.borderColor = 'rgba(0,0,0,0.1)';
            this.color = '#666';
            this.datasets = {};
            this.devicePixelRatio = (context)=>context.chart.platform.getDevicePixelRatio();
            this.elements = {};
            this.events = [
                'mousemove',
                'mouseout',
                'click',
                'touchstart',
                'touchmove'
            ];
            this.font = {
                family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
                size: 12,
                style: 'normal',
                lineHeight: 1.2,
                weight: null
            };
            this.hover = {};
            this.hoverBackgroundColor = (ctx, options)=>getHoverColor(options.backgroundColor);
            this.hoverBorderColor = (ctx, options)=>getHoverColor(options.borderColor);
            this.hoverColor = (ctx, options)=>getHoverColor(options.color);
            this.indexAxis = 'x';
            this.interaction = {
                mode: 'nearest',
                intersect: true,
                includeInvisible: false
            };
            this.maintainAspectRatio = true;
            this.onHover = null;
            this.onClick = null;
            this.parsing = true;
            this.plugins = {};
            this.responsive = true;
            this.scale = undefined;
            this.scales = {};
            this.showLine = true;
            this.drawActiveElementsOnTop = true;
            this.describe(_descriptors);
            this.apply(_appliers);
        }
     set(scope, values) {
            return set(this, scope, values);
        }
     get(scope) {
            return getScope$1(this, scope);
        }
     describe(scope, values) {
            return set(descriptors, scope, values);
        }
        override(scope, values) {
            return set(overrides, scope, values);
        }
     route(scope, name, targetScope, targetName) {
            const scopeObject = getScope$1(this, scope);
            const targetScopeObject = getScope$1(this, targetScope);
            const privateName = '_' + name;
            Object.defineProperties(scopeObject, {
                [privateName]: {
                    value: scopeObject[name],
                    writable: true
                },
                [name]: {
                    enumerable: true,
                    get () {
                        const local = this[privateName];
                        const target = targetScopeObject[targetName];
                        if (isObject(local)) {
                            return Object.assign({}, target, local);
                        }
                        return valueOrDefault(local, target);
                    },
                    set (value) {
                        this[privateName] = value;
                    }
                }
            });
        }
        apply(appliers) {
            appliers.forEach((apply)=>apply(this));
        }
    }
    var defaults = /* #__PURE__ */ new Defaults({
        _scriptable: (name)=>!name.startsWith('on'),
        _indexable: (name)=>name !== 'events',
        hover: {
            _fallback: 'interaction'
        },
        interaction: {
            _scriptable: false,
            _indexable: false
        }
    }, [
        applyAnimationsDefaults,
        applyLayoutsDefaults,
        applyScaleDefaults
    ]);

    /**
     * Converts the given font object into a CSS font string.
     * @param font - A font object.
     * @return The CSS font string. See https://developer.mozilla.org/en-US/docs/Web/CSS/font
     * @private
     */ function toFontString(font) {
        if (!font || isNullOrUndef(font.size) || isNullOrUndef(font.family)) {
            return null;
        }
        return (font.style ? font.style + ' ' : '') + (font.weight ? font.weight + ' ' : '') + font.size + 'px ' + font.family;
    }
    /**
     * @private
     */ function _measureText(ctx, data, gc, longest, string) {
        let textWidth = data[string];
        if (!textWidth) {
            textWidth = data[string] = ctx.measureText(string).width;
            gc.push(string);
        }
        if (textWidth > longest) {
            longest = textWidth;
        }
        return longest;
    }
    /**
     * @private
     */ // eslint-disable-next-line complexity
    function _longestText(ctx, font, arrayOfThings, cache) {
        cache = cache || {};
        let data = cache.data = cache.data || {};
        let gc = cache.garbageCollect = cache.garbageCollect || [];
        if (cache.font !== font) {
            data = cache.data = {};
            gc = cache.garbageCollect = [];
            cache.font = font;
        }
        ctx.save();
        ctx.font = font;
        let longest = 0;
        const ilen = arrayOfThings.length;
        let i, j, jlen, thing, nestedThing;
        for(i = 0; i < ilen; i++){
            thing = arrayOfThings[i];
            // Undefined strings and arrays should not be measured
            if (thing !== undefined && thing !== null && !isArray(thing)) {
                longest = _measureText(ctx, data, gc, longest, thing);
            } else if (isArray(thing)) {
                // if it is an array lets measure each element
                // to do maybe simplify this function a bit so we can do this more recursively?
                for(j = 0, jlen = thing.length; j < jlen; j++){
                    nestedThing = thing[j];
                    // Undefined strings and arrays should not be measured
                    if (nestedThing !== undefined && nestedThing !== null && !isArray(nestedThing)) {
                        longest = _measureText(ctx, data, gc, longest, nestedThing);
                    }
                }
            }
        }
        ctx.restore();
        const gcLen = gc.length / 2;
        if (gcLen > arrayOfThings.length) {
            for(i = 0; i < gcLen; i++){
                delete data[gc[i]];
            }
            gc.splice(0, gcLen);
        }
        return longest;
    }
    /**
     * Returns the aligned pixel value to avoid anti-aliasing blur
     * @param chart - The chart instance.
     * @param pixel - A pixel value.
     * @param width - The width of the element.
     * @returns The aligned pixel value.
     * @private
     */ function _alignPixel(chart, pixel, width) {
        const devicePixelRatio = chart.currentDevicePixelRatio;
        const halfWidth = width !== 0 ? Math.max(width / 2, 0.5) : 0;
        return Math.round((pixel - halfWidth) * devicePixelRatio) / devicePixelRatio + halfWidth;
    }
    /**
     * Clears the entire canvas.
     */ function clearCanvas(canvas, ctx) {
        if (!ctx && !canvas) {
            return;
        }
        ctx = ctx || canvas.getContext('2d');
        ctx.save();
        // canvas.width and canvas.height do not consider the canvas transform,
        // while clearRect does
        ctx.resetTransform();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }
    function drawPoint(ctx, options, x, y) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        drawPointLegend(ctx, options, x, y, null);
    }
    // eslint-disable-next-line complexity
    function drawPointLegend(ctx, options, x, y, w) {
        let type, xOffset, yOffset, size, cornerRadius, width, xOffsetW, yOffsetW;
        const style = options.pointStyle;
        const rotation = options.rotation;
        const radius = options.radius;
        let rad = (rotation || 0) * RAD_PER_DEG;
        if (style && typeof style === 'object') {
            type = style.toString();
            if (type === '[object HTMLImageElement]' || type === '[object HTMLCanvasElement]') {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(rad);
                ctx.drawImage(style, -style.width / 2, -style.height / 2, style.width, style.height);
                ctx.restore();
                return;
            }
        }
        if (isNaN(radius) || radius <= 0) {
            return;
        }
        ctx.beginPath();
        switch(style){
            // Default includes circle
            default:
                if (w) {
                    ctx.ellipse(x, y, w / 2, radius, 0, 0, TAU);
                } else {
                    ctx.arc(x, y, radius, 0, TAU);
                }
                ctx.closePath();
                break;
            case 'triangle':
                width = w ? w / 2 : radius;
                ctx.moveTo(x + Math.sin(rad) * width, y - Math.cos(rad) * radius);
                rad += TWO_THIRDS_PI;
                ctx.lineTo(x + Math.sin(rad) * width, y - Math.cos(rad) * radius);
                rad += TWO_THIRDS_PI;
                ctx.lineTo(x + Math.sin(rad) * width, y - Math.cos(rad) * radius);
                ctx.closePath();
                break;
            case 'rectRounded':
                // NOTE: the rounded rect implementation changed to use `arc` instead of
                // `quadraticCurveTo` since it generates better results when rect is
                // almost a circle. 0.516 (instead of 0.5) produces results with visually
                // closer proportion to the previous impl and it is inscribed in the
                // circle with `radius`. For more details, see the following PRs:
                // https://github.com/chartjs/Chart.js/issues/5597
                // https://github.com/chartjs/Chart.js/issues/5858
                cornerRadius = radius * 0.516;
                size = radius - cornerRadius;
                xOffset = Math.cos(rad + QUARTER_PI) * size;
                xOffsetW = Math.cos(rad + QUARTER_PI) * (w ? w / 2 - cornerRadius : size);
                yOffset = Math.sin(rad + QUARTER_PI) * size;
                yOffsetW = Math.sin(rad + QUARTER_PI) * (w ? w / 2 - cornerRadius : size);
                ctx.arc(x - xOffsetW, y - yOffset, cornerRadius, rad - PI, rad - HALF_PI);
                ctx.arc(x + yOffsetW, y - xOffset, cornerRadius, rad - HALF_PI, rad);
                ctx.arc(x + xOffsetW, y + yOffset, cornerRadius, rad, rad + HALF_PI);
                ctx.arc(x - yOffsetW, y + xOffset, cornerRadius, rad + HALF_PI, rad + PI);
                ctx.closePath();
                break;
            case 'rect':
                if (!rotation) {
                    size = Math.SQRT1_2 * radius;
                    width = w ? w / 2 : size;
                    ctx.rect(x - width, y - size, 2 * width, 2 * size);
                    break;
                }
                rad += QUARTER_PI;
            /* falls through */ case 'rectRot':
                xOffsetW = Math.cos(rad) * (w ? w / 2 : radius);
                xOffset = Math.cos(rad) * radius;
                yOffset = Math.sin(rad) * radius;
                yOffsetW = Math.sin(rad) * (w ? w / 2 : radius);
                ctx.moveTo(x - xOffsetW, y - yOffset);
                ctx.lineTo(x + yOffsetW, y - xOffset);
                ctx.lineTo(x + xOffsetW, y + yOffset);
                ctx.lineTo(x - yOffsetW, y + xOffset);
                ctx.closePath();
                break;
            case 'crossRot':
                rad += QUARTER_PI;
            /* falls through */ case 'cross':
                xOffsetW = Math.cos(rad) * (w ? w / 2 : radius);
                xOffset = Math.cos(rad) * radius;
                yOffset = Math.sin(rad) * radius;
                yOffsetW = Math.sin(rad) * (w ? w / 2 : radius);
                ctx.moveTo(x - xOffsetW, y - yOffset);
                ctx.lineTo(x + xOffsetW, y + yOffset);
                ctx.moveTo(x + yOffsetW, y - xOffset);
                ctx.lineTo(x - yOffsetW, y + xOffset);
                break;
            case 'star':
                xOffsetW = Math.cos(rad) * (w ? w / 2 : radius);
                xOffset = Math.cos(rad) * radius;
                yOffset = Math.sin(rad) * radius;
                yOffsetW = Math.sin(rad) * (w ? w / 2 : radius);
                ctx.moveTo(x - xOffsetW, y - yOffset);
                ctx.lineTo(x + xOffsetW, y + yOffset);
                ctx.moveTo(x + yOffsetW, y - xOffset);
                ctx.lineTo(x - yOffsetW, y + xOffset);
                rad += QUARTER_PI;
                xOffsetW = Math.cos(rad) * (w ? w / 2 : radius);
                xOffset = Math.cos(rad) * radius;
                yOffset = Math.sin(rad) * radius;
                yOffsetW = Math.sin(rad) * (w ? w / 2 : radius);
                ctx.moveTo(x - xOffsetW, y - yOffset);
                ctx.lineTo(x + xOffsetW, y + yOffset);
                ctx.moveTo(x + yOffsetW, y - xOffset);
                ctx.lineTo(x - yOffsetW, y + xOffset);
                break;
            case 'line':
                xOffset = w ? w / 2 : Math.cos(rad) * radius;
                yOffset = Math.sin(rad) * radius;
                ctx.moveTo(x - xOffset, y - yOffset);
                ctx.lineTo(x + xOffset, y + yOffset);
                break;
            case 'dash':
                ctx.moveTo(x, y);
                ctx.lineTo(x + Math.cos(rad) * (w ? w / 2 : radius), y + Math.sin(rad) * radius);
                break;
            case false:
                ctx.closePath();
                break;
        }
        ctx.fill();
        if (options.borderWidth > 0) {
            ctx.stroke();
        }
    }
    /**
     * Returns true if the point is inside the rectangle
     * @param point - The point to test
     * @param area - The rectangle
     * @param margin - allowed margin
     * @private
     */ function _isPointInArea(point, area, margin) {
        margin = margin || 0.5; // margin - default is to match rounded decimals
        return !area || point && point.x > area.left - margin && point.x < area.right + margin && point.y > area.top - margin && point.y < area.bottom + margin;
    }
    function clipArea(ctx, area) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
        ctx.clip();
    }
    function unclipArea(ctx) {
        ctx.restore();
    }
    /**
     * @private
     */ function _steppedLineTo(ctx, previous, target, flip, mode) {
        if (!previous) {
            return ctx.lineTo(target.x, target.y);
        }
        if (mode === 'middle') {
            const midpoint = (previous.x + target.x) / 2.0;
            ctx.lineTo(midpoint, previous.y);
            ctx.lineTo(midpoint, target.y);
        } else if (mode === 'after' !== !!flip) {
            ctx.lineTo(previous.x, target.y);
        } else {
            ctx.lineTo(target.x, previous.y);
        }
        ctx.lineTo(target.x, target.y);
    }
    /**
     * @private
     */ function _bezierCurveTo(ctx, previous, target, flip) {
        if (!previous) {
            return ctx.lineTo(target.x, target.y);
        }
        ctx.bezierCurveTo(flip ? previous.cp1x : previous.cp2x, flip ? previous.cp1y : previous.cp2y, flip ? target.cp2x : target.cp1x, flip ? target.cp2y : target.cp1y, target.x, target.y);
    }
    function setRenderOpts(ctx, opts) {
        if (opts.translation) {
            ctx.translate(opts.translation[0], opts.translation[1]);
        }
        if (!isNullOrUndef(opts.rotation)) {
            ctx.rotate(opts.rotation);
        }
        if (opts.color) {
            ctx.fillStyle = opts.color;
        }
        if (opts.textAlign) {
            ctx.textAlign = opts.textAlign;
        }
        if (opts.textBaseline) {
            ctx.textBaseline = opts.textBaseline;
        }
    }
    function decorateText(ctx, x, y, line, opts) {
        if (opts.strikethrough || opts.underline) {
            /**
         * Now that IE11 support has been dropped, we can use more
         * of the TextMetrics object. The actual bounding boxes
         * are unflagged in Chrome, Firefox, Edge, and Safari so they
         * can be safely used.
         * See https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics#Browser_compatibility
         */ const metrics = ctx.measureText(line);
            const left = x - metrics.actualBoundingBoxLeft;
            const right = x + metrics.actualBoundingBoxRight;
            const top = y - metrics.actualBoundingBoxAscent;
            const bottom = y + metrics.actualBoundingBoxDescent;
            const yDecoration = opts.strikethrough ? (top + bottom) / 2 : bottom;
            ctx.strokeStyle = ctx.fillStyle;
            ctx.beginPath();
            ctx.lineWidth = opts.decorationWidth || 2;
            ctx.moveTo(left, yDecoration);
            ctx.lineTo(right, yDecoration);
            ctx.stroke();
        }
    }
    function drawBackdrop(ctx, opts) {
        const oldColor = ctx.fillStyle;
        ctx.fillStyle = opts.color;
        ctx.fillRect(opts.left, opts.top, opts.width, opts.height);
        ctx.fillStyle = oldColor;
    }
    /**
     * Render text onto the canvas
     */ function renderText(ctx, text, x, y, font, opts = {}) {
        const lines = isArray(text) ? text : [
            text
        ];
        const stroke = opts.strokeWidth > 0 && opts.strokeColor !== '';
        let i, line;
        ctx.save();
        ctx.font = font.string;
        setRenderOpts(ctx, opts);
        for(i = 0; i < lines.length; ++i){
            line = lines[i];
            if (opts.backdrop) {
                drawBackdrop(ctx, opts.backdrop);
            }
            if (stroke) {
                if (opts.strokeColor) {
                    ctx.strokeStyle = opts.strokeColor;
                }
                if (!isNullOrUndef(opts.strokeWidth)) {
                    ctx.lineWidth = opts.strokeWidth;
                }
                ctx.strokeText(line, x, y, opts.maxWidth);
            }
            ctx.fillText(line, x, y, opts.maxWidth);
            decorateText(ctx, x, y, line, opts);
            y += Number(font.lineHeight);
        }
        ctx.restore();
    }
    /**
     * Add a path of a rectangle with rounded corners to the current sub-path
     * @param ctx - Context
     * @param rect - Bounding rect
     */ function addRoundedRectPath(ctx, rect) {
        const { x , y , w , h , radius  } = rect;
        // top left arc
        ctx.arc(x + radius.topLeft, y + radius.topLeft, radius.topLeft, 1.5 * PI, PI, true);
        // line from top left to bottom left
        ctx.lineTo(x, y + h - radius.bottomLeft);
        // bottom left arc
        ctx.arc(x + radius.bottomLeft, y + h - radius.bottomLeft, radius.bottomLeft, PI, HALF_PI, true);
        // line from bottom left to bottom right
        ctx.lineTo(x + w - radius.bottomRight, y + h);
        // bottom right arc
        ctx.arc(x + w - radius.bottomRight, y + h - radius.bottomRight, radius.bottomRight, HALF_PI, 0, true);
        // line from bottom right to top right
        ctx.lineTo(x + w, y + radius.topRight);
        // top right arc
        ctx.arc(x + w - radius.topRight, y + radius.topRight, radius.topRight, 0, -HALF_PI, true);
        // line from top right to top left
        ctx.lineTo(x + radius.topLeft, y);
    }

    const LINE_HEIGHT = /^(normal|(\d+(?:\.\d+)?)(px|em|%)?)$/;
    const FONT_STYLE = /^(normal|italic|initial|inherit|unset|(oblique( -?[0-9]?[0-9]deg)?))$/;
    /**
     * @alias Chart.helpers.options
     * @namespace
     */ /**
     * Converts the given line height `value` in pixels for a specific font `size`.
     * @param value - The lineHeight to parse (eg. 1.6, '14px', '75%', '1.6em').
     * @param size - The font size (in pixels) used to resolve relative `value`.
     * @returns The effective line height in pixels (size * 1.2 if value is invalid).
     * @see https://developer.mozilla.org/en-US/docs/Web/CSS/line-height
     * @since 2.7.0
     */ function toLineHeight(value, size) {
        const matches = ('' + value).match(LINE_HEIGHT);
        if (!matches || matches[1] === 'normal') {
            return size * 1.2;
        }
        value = +matches[2];
        switch(matches[3]){
            case 'px':
                return value;
            case '%':
                value /= 100;
                break;
        }
        return size * value;
    }
    const numberOrZero = (v)=>+v || 0;
    function _readValueToProps(value, props) {
        const ret = {};
        const objProps = isObject(props);
        const keys = objProps ? Object.keys(props) : props;
        const read = isObject(value) ? objProps ? (prop)=>valueOrDefault(value[prop], value[props[prop]]) : (prop)=>value[prop] : ()=>value;
        for (const prop of keys){
            ret[prop] = numberOrZero(read(prop));
        }
        return ret;
    }
    /**
     * Converts the given value into a TRBL object.
     * @param value - If a number, set the value to all TRBL component,
     *  else, if an object, use defined properties and sets undefined ones to 0.
     *  x / y are shorthands for same value for left/right and top/bottom.
     * @returns The padding values (top, right, bottom, left)
     * @since 3.0.0
     */ function toTRBL(value) {
        return _readValueToProps(value, {
            top: 'y',
            right: 'x',
            bottom: 'y',
            left: 'x'
        });
    }
    /**
     * Converts the given value into a TRBL corners object (similar with css border-radius).
     * @param value - If a number, set the value to all TRBL corner components,
     *  else, if an object, use defined properties and sets undefined ones to 0.
     * @returns The TRBL corner values (topLeft, topRight, bottomLeft, bottomRight)
     * @since 3.0.0
     */ function toTRBLCorners(value) {
        return _readValueToProps(value, [
            'topLeft',
            'topRight',
            'bottomLeft',
            'bottomRight'
        ]);
    }
    /**
     * Converts the given value into a padding object with pre-computed width/height.
     * @param value - If a number, set the value to all TRBL component,
     *  else, if an object, use defined properties and sets undefined ones to 0.
     *  x / y are shorthands for same value for left/right and top/bottom.
     * @returns The padding values (top, right, bottom, left, width, height)
     * @since 2.7.0
     */ function toPadding(value) {
        const obj = toTRBL(value);
        obj.width = obj.left + obj.right;
        obj.height = obj.top + obj.bottom;
        return obj;
    }
    /**
     * Parses font options and returns the font object.
     * @param options - A object that contains font options to be parsed.
     * @param fallback - A object that contains fallback font options.
     * @return The font object.
     * @private
     */ function toFont(options, fallback) {
        options = options || {};
        fallback = fallback || defaults.font;
        let size = valueOrDefault(options.size, fallback.size);
        if (typeof size === 'string') {
            size = parseInt(size, 10);
        }
        let style = valueOrDefault(options.style, fallback.style);
        if (style && !('' + style).match(FONT_STYLE)) {
            console.warn('Invalid font style specified: "' + style + '"');
            style = undefined;
        }
        const font = {
            family: valueOrDefault(options.family, fallback.family),
            lineHeight: toLineHeight(valueOrDefault(options.lineHeight, fallback.lineHeight), size),
            size,
            style,
            weight: valueOrDefault(options.weight, fallback.weight),
            string: ''
        };
        font.string = toFontString(font);
        return font;
    }
    /**
     * Evaluates the given `inputs` sequentially and returns the first defined value.
     * @param inputs - An array of values, falling back to the last value.
     * @param context - If defined and the current value is a function, the value
     * is called with `context` as first argument and the result becomes the new input.
     * @param index - If defined and the current value is an array, the value
     * at `index` become the new input.
     * @param info - object to return information about resolution in
     * @param info.cacheable - Will be set to `false` if option is not cacheable.
     * @since 2.7.0
     */ function resolve(inputs, context, index, info) {
        let i, ilen, value;
        for(i = 0, ilen = inputs.length; i < ilen; ++i){
            value = inputs[i];
            if (value === undefined) {
                continue;
            }
            if (value !== undefined) {
                return value;
            }
        }
    }
    /**
     * @param minmax
     * @param grace
     * @param beginAtZero
     * @private
     */ function _addGrace(minmax, grace, beginAtZero) {
        const { min , max  } = minmax;
        const change = toDimension(grace, (max - min) / 2);
        const keepZero = (value, add)=>beginAtZero && value === 0 ? 0 : value + add;
        return {
            min: keepZero(min, -Math.abs(change)),
            max: keepZero(max, change)
        };
    }
    function createContext(parentContext, context) {
        return Object.assign(Object.create(parentContext), context);
    }

    /**
     * Creates a Proxy for resolving raw values for options.
     * @param scopes - The option scopes to look for values, in resolution order
     * @param prefixes - The prefixes for values, in resolution order.
     * @param rootScopes - The root option scopes
     * @param fallback - Parent scopes fallback
     * @param getTarget - callback for getting the target for changed values
     * @returns Proxy
     * @private
     */ function _createResolver(scopes, prefixes = [
        ''
    ], rootScopes, fallback, getTarget = ()=>scopes[0]) {
        const finalRootScopes = rootScopes || scopes;
        if (typeof fallback === 'undefined') {
            fallback = _resolve('_fallback', scopes);
        }
        const cache = {
            [Symbol.toStringTag]: 'Object',
            _cacheable: true,
            _scopes: scopes,
            _rootScopes: finalRootScopes,
            _fallback: fallback,
            _getTarget: getTarget,
            override: (scope)=>_createResolver([
                    scope,
                    ...scopes
                ], prefixes, finalRootScopes, fallback)
        };
        return new Proxy(cache, {
            /**
         * A trap for the delete operator.
         */ deleteProperty (target, prop) {
                delete target[prop]; // remove from cache
                delete target._keys; // remove cached keys
                delete scopes[0][prop]; // remove from top level scope
                return true;
            },
            /**
         * A trap for getting property values.
         */ get (target, prop) {
                return _cached(target, prop, ()=>_resolveWithPrefixes(prop, prefixes, scopes, target));
            },
            /**
         * A trap for Object.getOwnPropertyDescriptor.
         * Also used by Object.hasOwnProperty.
         */ getOwnPropertyDescriptor (target, prop) {
                return Reflect.getOwnPropertyDescriptor(target._scopes[0], prop);
            },
            /**
         * A trap for Object.getPrototypeOf.
         */ getPrototypeOf () {
                return Reflect.getPrototypeOf(scopes[0]);
            },
            /**
         * A trap for the in operator.
         */ has (target, prop) {
                return getKeysFromAllScopes(target).includes(prop);
            },
            /**
         * A trap for Object.getOwnPropertyNames and Object.getOwnPropertySymbols.
         */ ownKeys (target) {
                return getKeysFromAllScopes(target);
            },
            /**
         * A trap for setting property values.
         */ set (target, prop, value) {
                const storage = target._storage || (target._storage = getTarget());
                target[prop] = storage[prop] = value; // set to top level scope + cache
                delete target._keys; // remove cached keys
                return true;
            }
        });
    }
    /**
     * Returns an Proxy for resolving option values with context.
     * @param proxy - The Proxy returned by `_createResolver`
     * @param context - Context object for scriptable/indexable options
     * @param subProxy - The proxy provided for scriptable options
     * @param descriptorDefaults - Defaults for descriptors
     * @private
     */ function _attachContext(proxy, context, subProxy, descriptorDefaults) {
        const cache = {
            _cacheable: false,
            _proxy: proxy,
            _context: context,
            _subProxy: subProxy,
            _stack: new Set(),
            _descriptors: _descriptors(proxy, descriptorDefaults),
            setContext: (ctx)=>_attachContext(proxy, ctx, subProxy, descriptorDefaults),
            override: (scope)=>_attachContext(proxy.override(scope), context, subProxy, descriptorDefaults)
        };
        return new Proxy(cache, {
            /**
         * A trap for the delete operator.
         */ deleteProperty (target, prop) {
                delete target[prop]; // remove from cache
                delete proxy[prop]; // remove from proxy
                return true;
            },
            /**
         * A trap for getting property values.
         */ get (target, prop, receiver) {
                return _cached(target, prop, ()=>_resolveWithContext(target, prop, receiver));
            },
            /**
         * A trap for Object.getOwnPropertyDescriptor.
         * Also used by Object.hasOwnProperty.
         */ getOwnPropertyDescriptor (target, prop) {
                return target._descriptors.allKeys ? Reflect.has(proxy, prop) ? {
                    enumerable: true,
                    configurable: true
                } : undefined : Reflect.getOwnPropertyDescriptor(proxy, prop);
            },
            /**
         * A trap for Object.getPrototypeOf.
         */ getPrototypeOf () {
                return Reflect.getPrototypeOf(proxy);
            },
            /**
         * A trap for the in operator.
         */ has (target, prop) {
                return Reflect.has(proxy, prop);
            },
            /**
         * A trap for Object.getOwnPropertyNames and Object.getOwnPropertySymbols.
         */ ownKeys () {
                return Reflect.ownKeys(proxy);
            },
            /**
         * A trap for setting property values.
         */ set (target, prop, value) {
                proxy[prop] = value; // set to proxy
                delete target[prop]; // remove from cache
                return true;
            }
        });
    }
    /**
     * @private
     */ function _descriptors(proxy, defaults = {
        scriptable: true,
        indexable: true
    }) {
        const { _scriptable =defaults.scriptable , _indexable =defaults.indexable , _allKeys =defaults.allKeys  } = proxy;
        return {
            allKeys: _allKeys,
            scriptable: _scriptable,
            indexable: _indexable,
            isScriptable: isFunction(_scriptable) ? _scriptable : ()=>_scriptable,
            isIndexable: isFunction(_indexable) ? _indexable : ()=>_indexable
        };
    }
    const readKey = (prefix, name)=>prefix ? prefix + _capitalize(name) : name;
    const needsSubResolver = (prop, value)=>isObject(value) && prop !== 'adapters' && (Object.getPrototypeOf(value) === null || value.constructor === Object);
    function _cached(target, prop, resolve) {
        if (Object.prototype.hasOwnProperty.call(target, prop) || prop === 'constructor') {
            return target[prop];
        }
        const value = resolve();
        // cache the resolved value
        target[prop] = value;
        return value;
    }
    function _resolveWithContext(target, prop, receiver) {
        const { _proxy , _context , _subProxy , _descriptors: descriptors  } = target;
        let value = _proxy[prop]; // resolve from proxy
        // resolve with context
        if (isFunction(value) && descriptors.isScriptable(prop)) {
            value = _resolveScriptable(prop, value, target, receiver);
        }
        if (isArray(value) && value.length) {
            value = _resolveArray(prop, value, target, descriptors.isIndexable);
        }
        if (needsSubResolver(prop, value)) {
            // if the resolved value is an object, create a sub resolver for it
            value = _attachContext(value, _context, _subProxy && _subProxy[prop], descriptors);
        }
        return value;
    }
    function _resolveScriptable(prop, getValue, target, receiver) {
        const { _proxy , _context , _subProxy , _stack  } = target;
        if (_stack.has(prop)) {
            throw new Error('Recursion detected: ' + Array.from(_stack).join('->') + '->' + prop);
        }
        _stack.add(prop);
        let value = getValue(_context, _subProxy || receiver);
        _stack.delete(prop);
        if (needsSubResolver(prop, value)) {
            // When scriptable option returns an object, create a resolver on that.
            value = createSubResolver(_proxy._scopes, _proxy, prop, value);
        }
        return value;
    }
    function _resolveArray(prop, value, target, isIndexable) {
        const { _proxy , _context , _subProxy , _descriptors: descriptors  } = target;
        if (typeof _context.index !== 'undefined' && isIndexable(prop)) {
            return value[_context.index % value.length];
        } else if (isObject(value[0])) {
            // Array of objects, return array or resolvers
            const arr = value;
            const scopes = _proxy._scopes.filter((s)=>s !== arr);
            value = [];
            for (const item of arr){
                const resolver = createSubResolver(scopes, _proxy, prop, item);
                value.push(_attachContext(resolver, _context, _subProxy && _subProxy[prop], descriptors));
            }
        }
        return value;
    }
    function resolveFallback(fallback, prop, value) {
        return isFunction(fallback) ? fallback(prop, value) : fallback;
    }
    const getScope = (key, parent)=>key === true ? parent : typeof key === 'string' ? resolveObjectKey(parent, key) : undefined;
    function addScopes(set, parentScopes, key, parentFallback, value) {
        for (const parent of parentScopes){
            const scope = getScope(key, parent);
            if (scope) {
                set.add(scope);
                const fallback = resolveFallback(scope._fallback, key, value);
                if (typeof fallback !== 'undefined' && fallback !== key && fallback !== parentFallback) {
                    // When we reach the descriptor that defines a new _fallback, return that.
                    // The fallback will resume to that new scope.
                    return fallback;
                }
            } else if (scope === false && typeof parentFallback !== 'undefined' && key !== parentFallback) {
                // Fallback to `false` results to `false`, when falling back to different key.
                // For example `interaction` from `hover` or `plugins.tooltip` and `animation` from `animations`
                return null;
            }
        }
        return false;
    }
    function createSubResolver(parentScopes, resolver, prop, value) {
        const rootScopes = resolver._rootScopes;
        const fallback = resolveFallback(resolver._fallback, prop, value);
        const allScopes = [
            ...parentScopes,
            ...rootScopes
        ];
        const set = new Set();
        set.add(value);
        let key = addScopesFromKey(set, allScopes, prop, fallback || prop, value);
        if (key === null) {
            return false;
        }
        if (typeof fallback !== 'undefined' && fallback !== prop) {
            key = addScopesFromKey(set, allScopes, fallback, key, value);
            if (key === null) {
                return false;
            }
        }
        return _createResolver(Array.from(set), [
            ''
        ], rootScopes, fallback, ()=>subGetTarget(resolver, prop, value));
    }
    function addScopesFromKey(set, allScopes, key, fallback, item) {
        while(key){
            key = addScopes(set, allScopes, key, fallback, item);
        }
        return key;
    }
    function subGetTarget(resolver, prop, value) {
        const parent = resolver._getTarget();
        if (!(prop in parent)) {
            parent[prop] = {};
        }
        const target = parent[prop];
        if (isArray(target) && isObject(value)) {
            // For array of objects, the object is used to store updated values
            return value;
        }
        return target || {};
    }
    function _resolveWithPrefixes(prop, prefixes, scopes, proxy) {
        let value;
        for (const prefix of prefixes){
            value = _resolve(readKey(prefix, prop), scopes);
            if (typeof value !== 'undefined') {
                return needsSubResolver(prop, value) ? createSubResolver(scopes, proxy, prop, value) : value;
            }
        }
    }
    function _resolve(key, scopes) {
        for (const scope of scopes){
            if (!scope) {
                continue;
            }
            const value = scope[key];
            if (typeof value !== 'undefined') {
                return value;
            }
        }
    }
    function getKeysFromAllScopes(target) {
        let keys = target._keys;
        if (!keys) {
            keys = target._keys = resolveKeysFromAllScopes(target._scopes);
        }
        return keys;
    }
    function resolveKeysFromAllScopes(scopes) {
        const set = new Set();
        for (const scope of scopes){
            for (const key of Object.keys(scope).filter((k)=>!k.startsWith('_'))){
                set.add(key);
            }
        }
        return Array.from(set);
    }
    function _parseObjectDataRadialScale(meta, data, start, count) {
        const { iScale  } = meta;
        const { key ='r'  } = this._parsing;
        const parsed = new Array(count);
        let i, ilen, index, item;
        for(i = 0, ilen = count; i < ilen; ++i){
            index = i + start;
            item = data[index];
            parsed[i] = {
                r: iScale.parse(resolveObjectKey(item, key), index)
            };
        }
        return parsed;
    }

    const EPSILON = Number.EPSILON || 1e-14;
    const getPoint = (points, i)=>i < points.length && !points[i].skip && points[i];
    const getValueAxis = (indexAxis)=>indexAxis === 'x' ? 'y' : 'x';
    function splineCurve(firstPoint, middlePoint, afterPoint, t) {
        // Props to Rob Spencer at scaled innovation for his post on splining between points
        // http://scaledinnovation.com/analytics/splines/aboutSplines.html
        // This function must also respect "skipped" points
        const previous = firstPoint.skip ? middlePoint : firstPoint;
        const current = middlePoint;
        const next = afterPoint.skip ? middlePoint : afterPoint;
        const d01 = distanceBetweenPoints(current, previous);
        const d12 = distanceBetweenPoints(next, current);
        let s01 = d01 / (d01 + d12);
        let s12 = d12 / (d01 + d12);
        // If all points are the same, s01 & s02 will be inf
        s01 = isNaN(s01) ? 0 : s01;
        s12 = isNaN(s12) ? 0 : s12;
        const fa = t * s01; // scaling factor for triangle Ta
        const fb = t * s12;
        return {
            previous: {
                x: current.x - fa * (next.x - previous.x),
                y: current.y - fa * (next.y - previous.y)
            },
            next: {
                x: current.x + fb * (next.x - previous.x),
                y: current.y + fb * (next.y - previous.y)
            }
        };
    }
    /**
     * Adjust tangents to ensure monotonic properties
     */ function monotoneAdjust(points, deltaK, mK) {
        const pointsLen = points.length;
        let alphaK, betaK, tauK, squaredMagnitude, pointCurrent;
        let pointAfter = getPoint(points, 0);
        for(let i = 0; i < pointsLen - 1; ++i){
            pointCurrent = pointAfter;
            pointAfter = getPoint(points, i + 1);
            if (!pointCurrent || !pointAfter) {
                continue;
            }
            if (almostEquals(deltaK[i], 0, EPSILON)) {
                mK[i] = mK[i + 1] = 0;
                continue;
            }
            alphaK = mK[i] / deltaK[i];
            betaK = mK[i + 1] / deltaK[i];
            squaredMagnitude = Math.pow(alphaK, 2) + Math.pow(betaK, 2);
            if (squaredMagnitude <= 9) {
                continue;
            }
            tauK = 3 / Math.sqrt(squaredMagnitude);
            mK[i] = alphaK * tauK * deltaK[i];
            mK[i + 1] = betaK * tauK * deltaK[i];
        }
    }
    function monotoneCompute(points, mK, indexAxis = 'x') {
        const valueAxis = getValueAxis(indexAxis);
        const pointsLen = points.length;
        let delta, pointBefore, pointCurrent;
        let pointAfter = getPoint(points, 0);
        for(let i = 0; i < pointsLen; ++i){
            pointBefore = pointCurrent;
            pointCurrent = pointAfter;
            pointAfter = getPoint(points, i + 1);
            if (!pointCurrent) {
                continue;
            }
            const iPixel = pointCurrent[indexAxis];
            const vPixel = pointCurrent[valueAxis];
            if (pointBefore) {
                delta = (iPixel - pointBefore[indexAxis]) / 3;
                pointCurrent[`cp1${indexAxis}`] = iPixel - delta;
                pointCurrent[`cp1${valueAxis}`] = vPixel - delta * mK[i];
            }
            if (pointAfter) {
                delta = (pointAfter[indexAxis] - iPixel) / 3;
                pointCurrent[`cp2${indexAxis}`] = iPixel + delta;
                pointCurrent[`cp2${valueAxis}`] = vPixel + delta * mK[i];
            }
        }
    }
    /**
     * This function calculates Bézier control points in a similar way than |splineCurve|,
     * but preserves monotonicity of the provided data and ensures no local extremums are added
     * between the dataset discrete points due to the interpolation.
     * See : https://en.wikipedia.org/wiki/Monotone_cubic_interpolation
     */ function splineCurveMonotone(points, indexAxis = 'x') {
        const valueAxis = getValueAxis(indexAxis);
        const pointsLen = points.length;
        const deltaK = Array(pointsLen).fill(0);
        const mK = Array(pointsLen);
        // Calculate slopes (deltaK) and initialize tangents (mK)
        let i, pointBefore, pointCurrent;
        let pointAfter = getPoint(points, 0);
        for(i = 0; i < pointsLen; ++i){
            pointBefore = pointCurrent;
            pointCurrent = pointAfter;
            pointAfter = getPoint(points, i + 1);
            if (!pointCurrent) {
                continue;
            }
            if (pointAfter) {
                const slopeDelta = pointAfter[indexAxis] - pointCurrent[indexAxis];
                // In the case of two points that appear at the same x pixel, slopeDeltaX is 0
                deltaK[i] = slopeDelta !== 0 ? (pointAfter[valueAxis] - pointCurrent[valueAxis]) / slopeDelta : 0;
            }
            mK[i] = !pointBefore ? deltaK[i] : !pointAfter ? deltaK[i - 1] : sign(deltaK[i - 1]) !== sign(deltaK[i]) ? 0 : (deltaK[i - 1] + deltaK[i]) / 2;
        }
        monotoneAdjust(points, deltaK, mK);
        monotoneCompute(points, mK, indexAxis);
    }
    function capControlPoint(pt, min, max) {
        return Math.max(Math.min(pt, max), min);
    }
    function capBezierPoints(points, area) {
        let i, ilen, point, inArea, inAreaPrev;
        let inAreaNext = _isPointInArea(points[0], area);
        for(i = 0, ilen = points.length; i < ilen; ++i){
            inAreaPrev = inArea;
            inArea = inAreaNext;
            inAreaNext = i < ilen - 1 && _isPointInArea(points[i + 1], area);
            if (!inArea) {
                continue;
            }
            point = points[i];
            if (inAreaPrev) {
                point.cp1x = capControlPoint(point.cp1x, area.left, area.right);
                point.cp1y = capControlPoint(point.cp1y, area.top, area.bottom);
            }
            if (inAreaNext) {
                point.cp2x = capControlPoint(point.cp2x, area.left, area.right);
                point.cp2y = capControlPoint(point.cp2y, area.top, area.bottom);
            }
        }
    }
    /**
     * @private
     */ function _updateBezierControlPoints(points, options, area, loop, indexAxis) {
        let i, ilen, point, controlPoints;
        // Only consider points that are drawn in case the spanGaps option is used
        if (options.spanGaps) {
            points = points.filter((pt)=>!pt.skip);
        }
        if (options.cubicInterpolationMode === 'monotone') {
            splineCurveMonotone(points, indexAxis);
        } else {
            let prev = loop ? points[points.length - 1] : points[0];
            for(i = 0, ilen = points.length; i < ilen; ++i){
                point = points[i];
                controlPoints = splineCurve(prev, point, points[Math.min(i + 1, ilen - (loop ? 0 : 1)) % ilen], options.tension);
                point.cp1x = controlPoints.previous.x;
                point.cp1y = controlPoints.previous.y;
                point.cp2x = controlPoints.next.x;
                point.cp2y = controlPoints.next.y;
                prev = point;
            }
        }
        if (options.capBezierPoints) {
            capBezierPoints(points, area);
        }
    }

    /**
     * @private
     */ function _isDomSupported() {
        return typeof window !== 'undefined' && typeof document !== 'undefined';
    }
    /**
     * @private
     */ function _getParentNode(domNode) {
        let parent = domNode.parentNode;
        if (parent && parent.toString() === '[object ShadowRoot]') {
            parent = parent.host;
        }
        return parent;
    }
    /**
     * convert max-width/max-height values that may be percentages into a number
     * @private
     */ function parseMaxStyle(styleValue, node, parentProperty) {
        let valueInPixels;
        if (typeof styleValue === 'string') {
            valueInPixels = parseInt(styleValue, 10);
            if (styleValue.indexOf('%') !== -1) {
                // percentage * size in dimension
                valueInPixels = valueInPixels / 100 * node.parentNode[parentProperty];
            }
        } else {
            valueInPixels = styleValue;
        }
        return valueInPixels;
    }
    const getComputedStyle = (element)=>element.ownerDocument.defaultView.getComputedStyle(element, null);
    function getStyle(el, property) {
        return getComputedStyle(el).getPropertyValue(property);
    }
    const positions = [
        'top',
        'right',
        'bottom',
        'left'
    ];
    function getPositionedStyle(styles, style, suffix) {
        const result = {};
        suffix = suffix ? '-' + suffix : '';
        for(let i = 0; i < 4; i++){
            const pos = positions[i];
            result[pos] = parseFloat(styles[style + '-' + pos + suffix]) || 0;
        }
        result.width = result.left + result.right;
        result.height = result.top + result.bottom;
        return result;
    }
    const useOffsetPos = (x, y, target)=>(x > 0 || y > 0) && (!target || !target.shadowRoot);
    /**
     * @param e
     * @param canvas
     * @returns Canvas position
     */ function getCanvasPosition(e, canvas) {
        const touches = e.touches;
        const source = touches && touches.length ? touches[0] : e;
        const { offsetX , offsetY  } = source;
        let box = false;
        let x, y;
        if (useOffsetPos(offsetX, offsetY, e.target)) {
            x = offsetX;
            y = offsetY;
        } else {
            const rect = canvas.getBoundingClientRect();
            x = source.clientX - rect.left;
            y = source.clientY - rect.top;
            box = true;
        }
        return {
            x,
            y,
            box
        };
    }
    /**
     * Gets an event's x, y coordinates, relative to the chart area
     * @param event
     * @param chart
     * @returns x and y coordinates of the event
     */ function getRelativePosition(event, chart) {
        if ('native' in event) {
            return event;
        }
        const { canvas , currentDevicePixelRatio  } = chart;
        const style = getComputedStyle(canvas);
        const borderBox = style.boxSizing === 'border-box';
        const paddings = getPositionedStyle(style, 'padding');
        const borders = getPositionedStyle(style, 'border', 'width');
        const { x , y , box  } = getCanvasPosition(event, canvas);
        const xOffset = paddings.left + (box && borders.left);
        const yOffset = paddings.top + (box && borders.top);
        let { width , height  } = chart;
        if (borderBox) {
            width -= paddings.width + borders.width;
            height -= paddings.height + borders.height;
        }
        return {
            x: Math.round((x - xOffset) / width * canvas.width / currentDevicePixelRatio),
            y: Math.round((y - yOffset) / height * canvas.height / currentDevicePixelRatio)
        };
    }
    function getContainerSize(canvas, width, height) {
        let maxWidth, maxHeight;
        if (width === undefined || height === undefined) {
            const container = canvas && _getParentNode(canvas);
            if (!container) {
                width = canvas.clientWidth;
                height = canvas.clientHeight;
            } else {
                const rect = container.getBoundingClientRect(); // this is the border box of the container
                const containerStyle = getComputedStyle(container);
                const containerBorder = getPositionedStyle(containerStyle, 'border', 'width');
                const containerPadding = getPositionedStyle(containerStyle, 'padding');
                width = rect.width - containerPadding.width - containerBorder.width;
                height = rect.height - containerPadding.height - containerBorder.height;
                maxWidth = parseMaxStyle(containerStyle.maxWidth, container, 'clientWidth');
                maxHeight = parseMaxStyle(containerStyle.maxHeight, container, 'clientHeight');
            }
        }
        return {
            width,
            height,
            maxWidth: maxWidth || INFINITY,
            maxHeight: maxHeight || INFINITY
        };
    }
    const round1 = (v)=>Math.round(v * 10) / 10;
    // eslint-disable-next-line complexity
    function getMaximumSize(canvas, bbWidth, bbHeight, aspectRatio) {
        const style = getComputedStyle(canvas);
        const margins = getPositionedStyle(style, 'margin');
        const maxWidth = parseMaxStyle(style.maxWidth, canvas, 'clientWidth') || INFINITY;
        const maxHeight = parseMaxStyle(style.maxHeight, canvas, 'clientHeight') || INFINITY;
        const containerSize = getContainerSize(canvas, bbWidth, bbHeight);
        let { width , height  } = containerSize;
        if (style.boxSizing === 'content-box') {
            const borders = getPositionedStyle(style, 'border', 'width');
            const paddings = getPositionedStyle(style, 'padding');
            width -= paddings.width + borders.width;
            height -= paddings.height + borders.height;
        }
        width = Math.max(0, width - margins.width);
        height = Math.max(0, aspectRatio ? width / aspectRatio : height - margins.height);
        width = round1(Math.min(width, maxWidth, containerSize.maxWidth));
        height = round1(Math.min(height, maxHeight, containerSize.maxHeight));
        if (width && !height) {
            // https://github.com/chartjs/Chart.js/issues/4659
            // If the canvas has width, but no height, default to aspectRatio of 2 (canvas default)
            height = round1(width / 2);
        }
        const maintainHeight = bbWidth !== undefined || bbHeight !== undefined;
        if (maintainHeight && aspectRatio && containerSize.height && height > containerSize.height) {
            height = containerSize.height;
            width = round1(Math.floor(height * aspectRatio));
        }
        return {
            width,
            height
        };
    }
    /**
     * @param chart
     * @param forceRatio
     * @param forceStyle
     * @returns True if the canvas context size or transformation has changed.
     */ function retinaScale(chart, forceRatio, forceStyle) {
        const pixelRatio = forceRatio || 1;
        const deviceHeight = round1(chart.height * pixelRatio);
        const deviceWidth = round1(chart.width * pixelRatio);
        chart.height = round1(chart.height);
        chart.width = round1(chart.width);
        const canvas = chart.canvas;
        // If no style has been set on the canvas, the render size is used as display size,
        // making the chart visually bigger, so let's enforce it to the "correct" values.
        // See https://github.com/chartjs/Chart.js/issues/3575
        if (canvas.style && (forceStyle || !canvas.style.height && !canvas.style.width)) {
            canvas.style.height = `${chart.height}px`;
            canvas.style.width = `${chart.width}px`;
        }
        if (chart.currentDevicePixelRatio !== pixelRatio || canvas.height !== deviceHeight || canvas.width !== deviceWidth) {
            chart.currentDevicePixelRatio = pixelRatio;
            canvas.height = deviceHeight;
            canvas.width = deviceWidth;
            chart.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            return true;
        }
        return false;
    }
    /**
     * Detects support for options object argument in addEventListener.
     * https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Safely_detecting_option_support
     * @private
     */ const supportsEventListenerOptions = function() {
        let passiveSupported = false;
        try {
            const options = {
                get passive () {
                    passiveSupported = true;
                    return false;
                }
            };
            if (_isDomSupported()) {
                window.addEventListener('test', null, options);
                window.removeEventListener('test', null, options);
            }
        } catch (e) {
        // continue regardless of error
        }
        return passiveSupported;
    }();
    /**
     * The "used" size is the final value of a dimension property after all calculations have
     * been performed. This method uses the computed style of `element` but returns undefined
     * if the computed style is not expressed in pixels. That can happen in some cases where
     * `element` has a size relative to its parent and this last one is not yet displayed,
     * for example because of `display: none` on a parent node.
     * @see https://developer.mozilla.org/en-US/docs/Web/CSS/used_value
     * @returns Size in pixels or undefined if unknown.
     */ function readUsedSize(element, property) {
        const value = getStyle(element, property);
        const matches = value && value.match(/^(\d+)(\.\d+)?px$/);
        return matches ? +matches[1] : undefined;
    }

    /**
     * @private
     */ function _pointInLine(p1, p2, t, mode) {
        return {
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y)
        };
    }
    /**
     * @private
     */ function _steppedInterpolation(p1, p2, t, mode) {
        return {
            x: p1.x + t * (p2.x - p1.x),
            y: mode === 'middle' ? t < 0.5 ? p1.y : p2.y : mode === 'after' ? t < 1 ? p1.y : p2.y : t > 0 ? p2.y : p1.y
        };
    }
    /**
     * @private
     */ function _bezierInterpolation(p1, p2, t, mode) {
        const cp1 = {
            x: p1.cp2x,
            y: p1.cp2y
        };
        const cp2 = {
            x: p2.cp1x,
            y: p2.cp1y
        };
        const a = _pointInLine(p1, cp1, t);
        const b = _pointInLine(cp1, cp2, t);
        const c = _pointInLine(cp2, p2, t);
        const d = _pointInLine(a, b, t);
        const e = _pointInLine(b, c, t);
        return _pointInLine(d, e, t);
    }

    const getRightToLeftAdapter = function(rectX, width) {
        return {
            x (x) {
                return rectX + rectX + width - x;
            },
            setWidth (w) {
                width = w;
            },
            textAlign (align) {
                if (align === 'center') {
                    return align;
                }
                return align === 'right' ? 'left' : 'right';
            },
            xPlus (x, value) {
                return x - value;
            },
            leftForLtr (x, itemWidth) {
                return x - itemWidth;
            }
        };
    };
    const getLeftToRightAdapter = function() {
        return {
            x (x) {
                return x;
            },
            setWidth (w) {},
            textAlign (align) {
                return align;
            },
            xPlus (x, value) {
                return x + value;
            },
            leftForLtr (x, _itemWidth) {
                return x;
            }
        };
    };
    function getRtlAdapter(rtl, rectX, width) {
        return rtl ? getRightToLeftAdapter(rectX, width) : getLeftToRightAdapter();
    }
    function overrideTextDirection(ctx, direction) {
        let style, original;
        if (direction === 'ltr' || direction === 'rtl') {
            style = ctx.canvas.style;
            original = [
                style.getPropertyValue('direction'),
                style.getPropertyPriority('direction')
            ];
            style.setProperty('direction', direction, 'important');
            ctx.prevTextDirection = original;
        }
    }
    function restoreTextDirection(ctx, original) {
        if (original !== undefined) {
            delete ctx.prevTextDirection;
            ctx.canvas.style.setProperty('direction', original[0], original[1]);
        }
    }

    function propertyFn(property) {
        if (property === 'angle') {
            return {
                between: _angleBetween,
                compare: _angleDiff,
                normalize: _normalizeAngle
            };
        }
        return {
            between: _isBetween,
            compare: (a, b)=>a - b,
            normalize: (x)=>x
        };
    }
    function normalizeSegment({ start , end , count , loop , style  }) {
        return {
            start: start % count,
            end: end % count,
            loop: loop && (end - start + 1) % count === 0,
            style
        };
    }
    function getSegment(segment, points, bounds) {
        const { property , start: startBound , end: endBound  } = bounds;
        const { between , normalize  } = propertyFn(property);
        const count = points.length;
        let { start , end , loop  } = segment;
        let i, ilen;
        if (loop) {
            start += count;
            end += count;
            for(i = 0, ilen = count; i < ilen; ++i){
                if (!between(normalize(points[start % count][property]), startBound, endBound)) {
                    break;
                }
                start--;
                end--;
            }
            start %= count;
            end %= count;
        }
        if (end < start) {
            end += count;
        }
        return {
            start,
            end,
            loop,
            style: segment.style
        };
    }
     function _boundSegment(segment, points, bounds) {
        if (!bounds) {
            return [
                segment
            ];
        }
        const { property , start: startBound , end: endBound  } = bounds;
        const count = points.length;
        const { compare , between , normalize  } = propertyFn(property);
        const { start , end , loop , style  } = getSegment(segment, points, bounds);
        const result = [];
        let inside = false;
        let subStart = null;
        let value, point, prevValue;
        const startIsBefore = ()=>between(startBound, prevValue, value) && compare(startBound, prevValue) !== 0;
        const endIsBefore = ()=>compare(endBound, value) === 0 || between(endBound, prevValue, value);
        const shouldStart = ()=>inside || startIsBefore();
        const shouldStop = ()=>!inside || endIsBefore();
        for(let i = start, prev = start; i <= end; ++i){
            point = points[i % count];
            if (point.skip) {
                continue;
            }
            value = normalize(point[property]);
            if (value === prevValue) {
                continue;
            }
            inside = between(value, startBound, endBound);
            if (subStart === null && shouldStart()) {
                subStart = compare(value, startBound) === 0 ? i : prev;
            }
            if (subStart !== null && shouldStop()) {
                result.push(normalizeSegment({
                    start: subStart,
                    end: i,
                    loop,
                    count,
                    style
                }));
                subStart = null;
            }
            prev = i;
            prevValue = value;
        }
        if (subStart !== null) {
            result.push(normalizeSegment({
                start: subStart,
                end,
                loop,
                count,
                style
            }));
        }
        return result;
    }
     function _boundSegments(line, bounds) {
        const result = [];
        const segments = line.segments;
        for(let i = 0; i < segments.length; i++){
            const sub = _boundSegment(segments[i], line.points, bounds);
            if (sub.length) {
                result.push(...sub);
            }
        }
        return result;
    }
     function findStartAndEnd(points, count, loop, spanGaps) {
        let start = 0;
        let end = count - 1;
        if (loop && !spanGaps) {
            while(start < count && !points[start].skip){
                start++;
            }
        }
        while(start < count && points[start].skip){
            start++;
        }
        start %= count;
        if (loop) {
            end += start;
        }
        while(end > start && points[end % count].skip){
            end--;
        }
        end %= count;
        return {
            start,
            end
        };
    }
     function solidSegments(points, start, max, loop) {
        const count = points.length;
        const result = [];
        let last = start;
        let prev = points[start];
        let end;
        for(end = start + 1; end <= max; ++end){
            const cur = points[end % count];
            if (cur.skip || cur.stop) {
                if (!prev.skip) {
                    loop = false;
                    result.push({
                        start: start % count,
                        end: (end - 1) % count,
                        loop
                    });
                    start = last = cur.stop ? end : null;
                }
            } else {
                last = end;
                if (prev.skip) {
                    start = end;
                }
            }
            prev = cur;
        }
        if (last !== null) {
            result.push({
                start: start % count,
                end: last % count,
                loop
            });
        }
        return result;
    }
     function _computeSegments(line, segmentOptions) {
        const points = line.points;
        const spanGaps = line.options.spanGaps;
        const count = points.length;
        if (!count) {
            return [];
        }
        const loop = !!line._loop;
        const { start , end  } = findStartAndEnd(points, count, loop, spanGaps);
        if (spanGaps === true) {
            return splitByStyles(line, [
                {
                    start,
                    end,
                    loop
                }
            ], points, segmentOptions);
        }
        const max = end < start ? end + count : end;
        const completeLoop = !!line._fullLoop && start === 0 && end === count - 1;
        return splitByStyles(line, solidSegments(points, start, max, completeLoop), points, segmentOptions);
    }
     function splitByStyles(line, segments, points, segmentOptions) {
        if (!segmentOptions || !segmentOptions.setContext || !points) {
            return segments;
        }
        return doSplitByStyles(line, segments, points, segmentOptions);
    }
     function doSplitByStyles(line, segments, points, segmentOptions) {
        const chartContext = line._chart.getContext();
        const baseStyle = readStyle(line.options);
        const { _datasetIndex: datasetIndex , options: { spanGaps  }  } = line;
        const count = points.length;
        const result = [];
        let prevStyle = baseStyle;
        let start = segments[0].start;
        let i = start;
        function addStyle(s, e, l, st) {
            const dir = spanGaps ? -1 : 1;
            if (s === e) {
                return;
            }
            s += count;
            while(points[s % count].skip){
                s -= dir;
            }
            while(points[e % count].skip){
                e += dir;
            }
            if (s % count !== e % count) {
                result.push({
                    start: s % count,
                    end: e % count,
                    loop: l,
                    style: st
                });
                prevStyle = st;
                start = e % count;
            }
        }
        for (const segment of segments){
            start = spanGaps ? start : segment.start;
            let prev = points[start % count];
            let style;
            for(i = start + 1; i <= segment.end; i++){
                const pt = points[i % count];
                style = readStyle(segmentOptions.setContext(createContext(chartContext, {
                    type: 'segment',
                    p0: prev,
                    p1: pt,
                    p0DataIndex: (i - 1) % count,
                    p1DataIndex: i % count,
                    datasetIndex
                })));
                if (styleChanged(style, prevStyle)) {
                    addStyle(start, i - 1, segment.loop, prevStyle);
                }
                prev = pt;
                prevStyle = style;
            }
            if (start < i - 1) {
                addStyle(start, i - 1, segment.loop, prevStyle);
            }
        }
        return result;
    }
    function readStyle(options) {
        return {
            backgroundColor: options.backgroundColor,
            borderCapStyle: options.borderCapStyle,
            borderDash: options.borderDash,
            borderDashOffset: options.borderDashOffset,
            borderJoinStyle: options.borderJoinStyle,
            borderWidth: options.borderWidth,
            borderColor: options.borderColor
        };
    }
    function styleChanged(style, prevStyle) {
        if (!prevStyle) {
            return false;
        }
        const cache = [];
        const replacer = function(key, value) {
            if (!isPatternOrGradient(value)) {
                return value;
            }
            if (!cache.includes(value)) {
                cache.push(value);
            }
            return cache.indexOf(value);
        };
        return JSON.stringify(style, replacer) !== JSON.stringify(prevStyle, replacer);
    }

    function getSizeForArea(scale, chartArea, field) {
        return scale.options.clip ? scale[field] : chartArea[field];
    }
    function getDatasetArea(meta, chartArea) {
        const { xScale , yScale  } = meta;
        if (xScale && yScale) {
            return {
                left: getSizeForArea(xScale, chartArea, 'left'),
                right: getSizeForArea(xScale, chartArea, 'right'),
                top: getSizeForArea(yScale, chartArea, 'top'),
                bottom: getSizeForArea(yScale, chartArea, 'bottom')
            };
        }
        return chartArea;
    }
    function getDatasetClipArea(chart, meta) {
        const clip = meta._clip;
        if (clip.disabled) {
            return false;
        }
        const area = getDatasetArea(meta, chart.chartArea);
        return {
            left: clip.left === false ? 0 : area.left - (clip.left === true ? 0 : clip.left),
            right: clip.right === false ? chart.width : area.right + (clip.right === true ? 0 : clip.right),
            top: clip.top === false ? 0 : area.top - (clip.top === true ? 0 : clip.top),
            bottom: clip.bottom === false ? chart.height : area.bottom + (clip.bottom === true ? 0 : clip.bottom)
        };
    }

    /*!
     * Chart.js v4.5.1
     * https://www.chartjs.org
     * (c) 2025 Chart.js Contributors
     * Released under the MIT License
     */

    class Animator {
        constructor(){
            this._request = null;
            this._charts = new Map();
            this._running = false;
            this._lastDate = undefined;
        }
     _notify(chart, anims, date, type) {
            const callbacks = anims.listeners[type];
            const numSteps = anims.duration;
            callbacks.forEach((fn)=>fn({
                    chart,
                    initial: anims.initial,
                    numSteps,
                    currentStep: Math.min(date - anims.start, numSteps)
                }));
        }
     _refresh() {
            if (this._request) {
                return;
            }
            this._running = true;
            this._request = requestAnimFrame.call(window, ()=>{
                this._update();
                this._request = null;
                if (this._running) {
                    this._refresh();
                }
            });
        }
     _update(date = Date.now()) {
            let remaining = 0;
            this._charts.forEach((anims, chart)=>{
                if (!anims.running || !anims.items.length) {
                    return;
                }
                const items = anims.items;
                let i = items.length - 1;
                let draw = false;
                let item;
                for(; i >= 0; --i){
                    item = items[i];
                    if (item._active) {
                        if (item._total > anims.duration) {
                            anims.duration = item._total;
                        }
                        item.tick(date);
                        draw = true;
                    } else {
                        items[i] = items[items.length - 1];
                        items.pop();
                    }
                }
                if (draw) {
                    chart.draw();
                    this._notify(chart, anims, date, 'progress');
                }
                if (!items.length) {
                    anims.running = false;
                    this._notify(chart, anims, date, 'complete');
                    anims.initial = false;
                }
                remaining += items.length;
            });
            this._lastDate = date;
            if (remaining === 0) {
                this._running = false;
            }
        }
     _getAnims(chart) {
            const charts = this._charts;
            let anims = charts.get(chart);
            if (!anims) {
                anims = {
                    running: false,
                    initial: true,
                    items: [],
                    listeners: {
                        complete: [],
                        progress: []
                    }
                };
                charts.set(chart, anims);
            }
            return anims;
        }
     listen(chart, event, cb) {
            this._getAnims(chart).listeners[event].push(cb);
        }
     add(chart, items) {
            if (!items || !items.length) {
                return;
            }
            this._getAnims(chart).items.push(...items);
        }
     has(chart) {
            return this._getAnims(chart).items.length > 0;
        }
     start(chart) {
            const anims = this._charts.get(chart);
            if (!anims) {
                return;
            }
            anims.running = true;
            anims.start = Date.now();
            anims.duration = anims.items.reduce((acc, cur)=>Math.max(acc, cur._duration), 0);
            this._refresh();
        }
        running(chart) {
            if (!this._running) {
                return false;
            }
            const anims = this._charts.get(chart);
            if (!anims || !anims.running || !anims.items.length) {
                return false;
            }
            return true;
        }
     stop(chart) {
            const anims = this._charts.get(chart);
            if (!anims || !anims.items.length) {
                return;
            }
            const items = anims.items;
            let i = items.length - 1;
            for(; i >= 0; --i){
                items[i].cancel();
            }
            anims.items = [];
            this._notify(chart, anims, Date.now(), 'complete');
        }
     remove(chart) {
            return this._charts.delete(chart);
        }
    }
    var animator = /* #__PURE__ */ new Animator();

    const transparent = 'transparent';
    const interpolators = {
        boolean (from, to, factor) {
            return factor > 0.5 ? to : from;
        },
     color (from, to, factor) {
            const c0 = color(from || transparent);
            const c1 = c0.valid && color(to || transparent);
            return c1 && c1.valid ? c1.mix(c0, factor).hexString() : to;
        },
        number (from, to, factor) {
            return from + (to - from) * factor;
        }
    };
    class Animation {
        constructor(cfg, target, prop, to){
            const currentValue = target[prop];
            to = resolve([
                cfg.to,
                to,
                currentValue,
                cfg.from
            ]);
            const from = resolve([
                cfg.from,
                currentValue,
                to
            ]);
            this._active = true;
            this._fn = cfg.fn || interpolators[cfg.type || typeof from];
            this._easing = effects[cfg.easing] || effects.linear;
            this._start = Math.floor(Date.now() + (cfg.delay || 0));
            this._duration = this._total = Math.floor(cfg.duration);
            this._loop = !!cfg.loop;
            this._target = target;
            this._prop = prop;
            this._from = from;
            this._to = to;
            this._promises = undefined;
        }
        active() {
            return this._active;
        }
        update(cfg, to, date) {
            if (this._active) {
                this._notify(false);
                const currentValue = this._target[this._prop];
                const elapsed = date - this._start;
                const remain = this._duration - elapsed;
                this._start = date;
                this._duration = Math.floor(Math.max(remain, cfg.duration));
                this._total += elapsed;
                this._loop = !!cfg.loop;
                this._to = resolve([
                    cfg.to,
                    to,
                    currentValue,
                    cfg.from
                ]);
                this._from = resolve([
                    cfg.from,
                    currentValue,
                    to
                ]);
            }
        }
        cancel() {
            if (this._active) {
                this.tick(Date.now());
                this._active = false;
                this._notify(false);
            }
        }
        tick(date) {
            const elapsed = date - this._start;
            const duration = this._duration;
            const prop = this._prop;
            const from = this._from;
            const loop = this._loop;
            const to = this._to;
            let factor;
            this._active = from !== to && (loop || elapsed < duration);
            if (!this._active) {
                this._target[prop] = to;
                this._notify(true);
                return;
            }
            if (elapsed < 0) {
                this._target[prop] = from;
                return;
            }
            factor = elapsed / duration % 2;
            factor = loop && factor > 1 ? 2 - factor : factor;
            factor = this._easing(Math.min(1, Math.max(0, factor)));
            this._target[prop] = this._fn(from, to, factor);
        }
        wait() {
            const promises = this._promises || (this._promises = []);
            return new Promise((res, rej)=>{
                promises.push({
                    res,
                    rej
                });
            });
        }
        _notify(resolved) {
            const method = resolved ? 'res' : 'rej';
            const promises = this._promises || [];
            for(let i = 0; i < promises.length; i++){
                promises[i][method]();
            }
        }
    }

    class Animations {
        constructor(chart, config){
            this._chart = chart;
            this._properties = new Map();
            this.configure(config);
        }
        configure(config) {
            if (!isObject(config)) {
                return;
            }
            const animationOptions = Object.keys(defaults.animation);
            const animatedProps = this._properties;
            Object.getOwnPropertyNames(config).forEach((key)=>{
                const cfg = config[key];
                if (!isObject(cfg)) {
                    return;
                }
                const resolved = {};
                for (const option of animationOptions){
                    resolved[option] = cfg[option];
                }
                (isArray(cfg.properties) && cfg.properties || [
                    key
                ]).forEach((prop)=>{
                    if (prop === key || !animatedProps.has(prop)) {
                        animatedProps.set(prop, resolved);
                    }
                });
            });
        }
     _animateOptions(target, values) {
            const newOptions = values.options;
            const options = resolveTargetOptions(target, newOptions);
            if (!options) {
                return [];
            }
            const animations = this._createAnimations(options, newOptions);
            if (newOptions.$shared) {
                awaitAll(target.options.$animations, newOptions).then(()=>{
                    target.options = newOptions;
                }, ()=>{
                });
            }
            return animations;
        }
     _createAnimations(target, values) {
            const animatedProps = this._properties;
            const animations = [];
            const running = target.$animations || (target.$animations = {});
            const props = Object.keys(values);
            const date = Date.now();
            let i;
            for(i = props.length - 1; i >= 0; --i){
                const prop = props[i];
                if (prop.charAt(0) === '$') {
                    continue;
                }
                if (prop === 'options') {
                    animations.push(...this._animateOptions(target, values));
                    continue;
                }
                const value = values[prop];
                let animation = running[prop];
                const cfg = animatedProps.get(prop);
                if (animation) {
                    if (cfg && animation.active()) {
                        animation.update(cfg, value, date);
                        continue;
                    } else {
                        animation.cancel();
                    }
                }
                if (!cfg || !cfg.duration) {
                    target[prop] = value;
                    continue;
                }
                running[prop] = animation = new Animation(cfg, target, prop, value);
                animations.push(animation);
            }
            return animations;
        }
     update(target, values) {
            if (this._properties.size === 0) {
                Object.assign(target, values);
                return;
            }
            const animations = this._createAnimations(target, values);
            if (animations.length) {
                animator.add(this._chart, animations);
                return true;
            }
        }
    }
    function awaitAll(animations, properties) {
        const running = [];
        const keys = Object.keys(properties);
        for(let i = 0; i < keys.length; i++){
            const anim = animations[keys[i]];
            if (anim && anim.active()) {
                running.push(anim.wait());
            }
        }
        return Promise.all(running);
    }
    function resolveTargetOptions(target, newOptions) {
        if (!newOptions) {
            return;
        }
        let options = target.options;
        if (!options) {
            target.options = newOptions;
            return;
        }
        if (options.$shared) {
            target.options = options = Object.assign({}, options, {
                $shared: false,
                $animations: {}
            });
        }
        return options;
    }

    function scaleClip(scale, allowedOverflow) {
        const opts = scale && scale.options || {};
        const reverse = opts.reverse;
        const min = opts.min === undefined ? allowedOverflow : 0;
        const max = opts.max === undefined ? allowedOverflow : 0;
        return {
            start: reverse ? max : min,
            end: reverse ? min : max
        };
    }
    function defaultClip(xScale, yScale, allowedOverflow) {
        if (allowedOverflow === false) {
            return false;
        }
        const x = scaleClip(xScale, allowedOverflow);
        const y = scaleClip(yScale, allowedOverflow);
        return {
            top: y.end,
            right: x.end,
            bottom: y.start,
            left: x.start
        };
    }
    function toClip(value) {
        let t, r, b, l;
        if (isObject(value)) {
            t = value.top;
            r = value.right;
            b = value.bottom;
            l = value.left;
        } else {
            t = r = b = l = value;
        }
        return {
            top: t,
            right: r,
            bottom: b,
            left: l,
            disabled: value === false
        };
    }
    function getSortedDatasetIndices(chart, filterVisible) {
        const keys = [];
        const metasets = chart._getSortedDatasetMetas(filterVisible);
        let i, ilen;
        for(i = 0, ilen = metasets.length; i < ilen; ++i){
            keys.push(metasets[i].index);
        }
        return keys;
    }
    function applyStack(stack, value, dsIndex, options = {}) {
        const keys = stack.keys;
        const singleMode = options.mode === 'single';
        let i, ilen, datasetIndex, otherValue;
        if (value === null) {
            return;
        }
        let found = false;
        for(i = 0, ilen = keys.length; i < ilen; ++i){
            datasetIndex = +keys[i];
            if (datasetIndex === dsIndex) {
                found = true;
                if (options.all) {
                    continue;
                }
                break;
            }
            otherValue = stack.values[datasetIndex];
            if (isNumberFinite(otherValue) && (singleMode || value === 0 || sign(value) === sign(otherValue))) {
                value += otherValue;
            }
        }
        if (!found && !options.all) {
            return 0;
        }
        return value;
    }
    function convertObjectDataToArray(data, meta) {
        const { iScale , vScale  } = meta;
        const iAxisKey = iScale.axis === 'x' ? 'x' : 'y';
        const vAxisKey = vScale.axis === 'x' ? 'x' : 'y';
        const keys = Object.keys(data);
        const adata = new Array(keys.length);
        let i, ilen, key;
        for(i = 0, ilen = keys.length; i < ilen; ++i){
            key = keys[i];
            adata[i] = {
                [iAxisKey]: key,
                [vAxisKey]: data[key]
            };
        }
        return adata;
    }
    function isStacked(scale, meta) {
        const stacked = scale && scale.options.stacked;
        return stacked || stacked === undefined && meta.stack !== undefined;
    }
    function getStackKey(indexScale, valueScale, meta) {
        return `${indexScale.id}.${valueScale.id}.${meta.stack || meta.type}`;
    }
    function getUserBounds(scale) {
        const { min , max , minDefined , maxDefined  } = scale.getUserBounds();
        return {
            min: minDefined ? min : Number.NEGATIVE_INFINITY,
            max: maxDefined ? max : Number.POSITIVE_INFINITY
        };
    }
    function getOrCreateStack(stacks, stackKey, indexValue) {
        const subStack = stacks[stackKey] || (stacks[stackKey] = {});
        return subStack[indexValue] || (subStack[indexValue] = {});
    }
    function getLastIndexInStack(stack, vScale, positive, type) {
        for (const meta of vScale.getMatchingVisibleMetas(type).reverse()){
            const value = stack[meta.index];
            if (positive && value > 0 || !positive && value < 0) {
                return meta.index;
            }
        }
        return null;
    }
    function updateStacks(controller, parsed) {
        const { chart , _cachedMeta: meta  } = controller;
        const stacks = chart._stacks || (chart._stacks = {});
        const { iScale , vScale , index: datasetIndex  } = meta;
        const iAxis = iScale.axis;
        const vAxis = vScale.axis;
        const key = getStackKey(iScale, vScale, meta);
        const ilen = parsed.length;
        let stack;
        for(let i = 0; i < ilen; ++i){
            const item = parsed[i];
            const { [iAxis]: index , [vAxis]: value  } = item;
            const itemStacks = item._stacks || (item._stacks = {});
            stack = itemStacks[vAxis] = getOrCreateStack(stacks, key, index);
            stack[datasetIndex] = value;
            stack._top = getLastIndexInStack(stack, vScale, true, meta.type);
            stack._bottom = getLastIndexInStack(stack, vScale, false, meta.type);
            const visualValues = stack._visualValues || (stack._visualValues = {});
            visualValues[datasetIndex] = value;
        }
    }
    function getFirstScaleId(chart, axis) {
        const scales = chart.scales;
        return Object.keys(scales).filter((key)=>scales[key].axis === axis).shift();
    }
    function createDatasetContext(parent, index) {
        return createContext(parent, {
            active: false,
            dataset: undefined,
            datasetIndex: index,
            index,
            mode: 'default',
            type: 'dataset'
        });
    }
    function createDataContext(parent, index, element) {
        return createContext(parent, {
            active: false,
            dataIndex: index,
            parsed: undefined,
            raw: undefined,
            element,
            index,
            mode: 'default',
            type: 'data'
        });
    }
    function clearStacks(meta, items) {
        const datasetIndex = meta.controller.index;
        const axis = meta.vScale && meta.vScale.axis;
        if (!axis) {
            return;
        }
        items = items || meta._parsed;
        for (const parsed of items){
            const stacks = parsed._stacks;
            if (!stacks || stacks[axis] === undefined || stacks[axis][datasetIndex] === undefined) {
                return;
            }
            delete stacks[axis][datasetIndex];
            if (stacks[axis]._visualValues !== undefined && stacks[axis]._visualValues[datasetIndex] !== undefined) {
                delete stacks[axis]._visualValues[datasetIndex];
            }
        }
    }
    const isDirectUpdateMode = (mode)=>mode === 'reset' || mode === 'none';
    const cloneIfNotShared = (cached, shared)=>shared ? cached : Object.assign({}, cached);
    const createStack = (canStack, meta, chart)=>canStack && !meta.hidden && meta._stacked && {
            keys: getSortedDatasetIndices(chart, true),
            values: null
        };
    class DatasetController {
     static defaults = {};
     static datasetElementType = null;
     static dataElementType = null;
     constructor(chart, datasetIndex){
            this.chart = chart;
            this._ctx = chart.ctx;
            this.index = datasetIndex;
            this._cachedDataOpts = {};
            this._cachedMeta = this.getMeta();
            this._type = this._cachedMeta.type;
            this.options = undefined;
             this._parsing = false;
            this._data = undefined;
            this._objectData = undefined;
            this._sharedOptions = undefined;
            this._drawStart = undefined;
            this._drawCount = undefined;
            this.enableOptionSharing = false;
            this.supportsDecimation = false;
            this.$context = undefined;
            this._syncList = [];
            this.datasetElementType = new.target.datasetElementType;
            this.dataElementType = new.target.dataElementType;
            this.initialize();
        }
        initialize() {
            const meta = this._cachedMeta;
            this.configure();
            this.linkScales();
            meta._stacked = isStacked(meta.vScale, meta);
            this.addElements();
            if (this.options.fill && !this.chart.isPluginEnabled('filler')) {
                console.warn("Tried to use the 'fill' option without the 'Filler' plugin enabled. Please import and register the 'Filler' plugin and make sure it is not disabled in the options");
            }
        }
        updateIndex(datasetIndex) {
            if (this.index !== datasetIndex) {
                clearStacks(this._cachedMeta);
            }
            this.index = datasetIndex;
        }
        linkScales() {
            const chart = this.chart;
            const meta = this._cachedMeta;
            const dataset = this.getDataset();
            const chooseId = (axis, x, y, r)=>axis === 'x' ? x : axis === 'r' ? r : y;
            const xid = meta.xAxisID = valueOrDefault(dataset.xAxisID, getFirstScaleId(chart, 'x'));
            const yid = meta.yAxisID = valueOrDefault(dataset.yAxisID, getFirstScaleId(chart, 'y'));
            const rid = meta.rAxisID = valueOrDefault(dataset.rAxisID, getFirstScaleId(chart, 'r'));
            const indexAxis = meta.indexAxis;
            const iid = meta.iAxisID = chooseId(indexAxis, xid, yid, rid);
            const vid = meta.vAxisID = chooseId(indexAxis, yid, xid, rid);
            meta.xScale = this.getScaleForId(xid);
            meta.yScale = this.getScaleForId(yid);
            meta.rScale = this.getScaleForId(rid);
            meta.iScale = this.getScaleForId(iid);
            meta.vScale = this.getScaleForId(vid);
        }
        getDataset() {
            return this.chart.data.datasets[this.index];
        }
        getMeta() {
            return this.chart.getDatasetMeta(this.index);
        }
     getScaleForId(scaleID) {
            return this.chart.scales[scaleID];
        }
     _getOtherScale(scale) {
            const meta = this._cachedMeta;
            return scale === meta.iScale ? meta.vScale : meta.iScale;
        }
        reset() {
            this._update('reset');
        }
     _destroy() {
            const meta = this._cachedMeta;
            if (this._data) {
                unlistenArrayEvents(this._data, this);
            }
            if (meta._stacked) {
                clearStacks(meta);
            }
        }
     _dataCheck() {
            const dataset = this.getDataset();
            const data = dataset.data || (dataset.data = []);
            const _data = this._data;
            if (isObject(data)) {
                const meta = this._cachedMeta;
                this._data = convertObjectDataToArray(data, meta);
            } else if (_data !== data) {
                if (_data) {
                    unlistenArrayEvents(_data, this);
                    const meta = this._cachedMeta;
                    clearStacks(meta);
                    meta._parsed = [];
                }
                if (data && Object.isExtensible(data)) {
                    listenArrayEvents(data, this);
                }
                this._syncList = [];
                this._data = data;
            }
        }
        addElements() {
            const meta = this._cachedMeta;
            this._dataCheck();
            if (this.datasetElementType) {
                meta.dataset = new this.datasetElementType();
            }
        }
        buildOrUpdateElements(resetNewElements) {
            const meta = this._cachedMeta;
            const dataset = this.getDataset();
            let stackChanged = false;
            this._dataCheck();
            const oldStacked = meta._stacked;
            meta._stacked = isStacked(meta.vScale, meta);
            if (meta.stack !== dataset.stack) {
                stackChanged = true;
                clearStacks(meta);
                meta.stack = dataset.stack;
            }
            this._resyncElements(resetNewElements);
            if (stackChanged || oldStacked !== meta._stacked) {
                updateStacks(this, meta._parsed);
                meta._stacked = isStacked(meta.vScale, meta);
            }
        }
     configure() {
            const config = this.chart.config;
            const scopeKeys = config.datasetScopeKeys(this._type);
            const scopes = config.getOptionScopes(this.getDataset(), scopeKeys, true);
            this.options = config.createResolver(scopes, this.getContext());
            this._parsing = this.options.parsing;
            this._cachedDataOpts = {};
        }
     parse(start, count) {
            const { _cachedMeta: meta , _data: data  } = this;
            const { iScale , _stacked  } = meta;
            const iAxis = iScale.axis;
            let sorted = start === 0 && count === data.length ? true : meta._sorted;
            let prev = start > 0 && meta._parsed[start - 1];
            let i, cur, parsed;
            if (this._parsing === false) {
                meta._parsed = data;
                meta._sorted = true;
                parsed = data;
            } else {
                if (isArray(data[start])) {
                    parsed = this.parseArrayData(meta, data, start, count);
                } else if (isObject(data[start])) {
                    parsed = this.parseObjectData(meta, data, start, count);
                } else {
                    parsed = this.parsePrimitiveData(meta, data, start, count);
                }
                const isNotInOrderComparedToPrev = ()=>cur[iAxis] === null || prev && cur[iAxis] < prev[iAxis];
                for(i = 0; i < count; ++i){
                    meta._parsed[i + start] = cur = parsed[i];
                    if (sorted) {
                        if (isNotInOrderComparedToPrev()) {
                            sorted = false;
                        }
                        prev = cur;
                    }
                }
                meta._sorted = sorted;
            }
            if (_stacked) {
                updateStacks(this, parsed);
            }
        }
     parsePrimitiveData(meta, data, start, count) {
            const { iScale , vScale  } = meta;
            const iAxis = iScale.axis;
            const vAxis = vScale.axis;
            const labels = iScale.getLabels();
            const singleScale = iScale === vScale;
            const parsed = new Array(count);
            let i, ilen, index;
            for(i = 0, ilen = count; i < ilen; ++i){
                index = i + start;
                parsed[i] = {
                    [iAxis]: singleScale || iScale.parse(labels[index], index),
                    [vAxis]: vScale.parse(data[index], index)
                };
            }
            return parsed;
        }
     parseArrayData(meta, data, start, count) {
            const { xScale , yScale  } = meta;
            const parsed = new Array(count);
            let i, ilen, index, item;
            for(i = 0, ilen = count; i < ilen; ++i){
                index = i + start;
                item = data[index];
                parsed[i] = {
                    x: xScale.parse(item[0], index),
                    y: yScale.parse(item[1], index)
                };
            }
            return parsed;
        }
     parseObjectData(meta, data, start, count) {
            const { xScale , yScale  } = meta;
            const { xAxisKey ='x' , yAxisKey ='y'  } = this._parsing;
            const parsed = new Array(count);
            let i, ilen, index, item;
            for(i = 0, ilen = count; i < ilen; ++i){
                index = i + start;
                item = data[index];
                parsed[i] = {
                    x: xScale.parse(resolveObjectKey(item, xAxisKey), index),
                    y: yScale.parse(resolveObjectKey(item, yAxisKey), index)
                };
            }
            return parsed;
        }
     getParsed(index) {
            return this._cachedMeta._parsed[index];
        }
     getDataElement(index) {
            return this._cachedMeta.data[index];
        }
     applyStack(scale, parsed, mode) {
            const chart = this.chart;
            const meta = this._cachedMeta;
            const value = parsed[scale.axis];
            const stack = {
                keys: getSortedDatasetIndices(chart, true),
                values: parsed._stacks[scale.axis]._visualValues
            };
            return applyStack(stack, value, meta.index, {
                mode
            });
        }
     updateRangeFromParsed(range, scale, parsed, stack) {
            const parsedValue = parsed[scale.axis];
            let value = parsedValue === null ? NaN : parsedValue;
            const values = stack && parsed._stacks[scale.axis];
            if (stack && values) {
                stack.values = values;
                value = applyStack(stack, parsedValue, this._cachedMeta.index);
            }
            range.min = Math.min(range.min, value);
            range.max = Math.max(range.max, value);
        }
     getMinMax(scale, canStack) {
            const meta = this._cachedMeta;
            const _parsed = meta._parsed;
            const sorted = meta._sorted && scale === meta.iScale;
            const ilen = _parsed.length;
            const otherScale = this._getOtherScale(scale);
            const stack = createStack(canStack, meta, this.chart);
            const range = {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY
            };
            const { min: otherMin , max: otherMax  } = getUserBounds(otherScale);
            let i, parsed;
            function _skip() {
                parsed = _parsed[i];
                const otherValue = parsed[otherScale.axis];
                return !isNumberFinite(parsed[scale.axis]) || otherMin > otherValue || otherMax < otherValue;
            }
            for(i = 0; i < ilen; ++i){
                if (_skip()) {
                    continue;
                }
                this.updateRangeFromParsed(range, scale, parsed, stack);
                if (sorted) {
                    break;
                }
            }
            if (sorted) {
                for(i = ilen - 1; i >= 0; --i){
                    if (_skip()) {
                        continue;
                    }
                    this.updateRangeFromParsed(range, scale, parsed, stack);
                    break;
                }
            }
            return range;
        }
        getAllParsedValues(scale) {
            const parsed = this._cachedMeta._parsed;
            const values = [];
            let i, ilen, value;
            for(i = 0, ilen = parsed.length; i < ilen; ++i){
                value = parsed[i][scale.axis];
                if (isNumberFinite(value)) {
                    values.push(value);
                }
            }
            return values;
        }
     getMaxOverflow() {
            return false;
        }
     getLabelAndValue(index) {
            const meta = this._cachedMeta;
            const iScale = meta.iScale;
            const vScale = meta.vScale;
            const parsed = this.getParsed(index);
            return {
                label: iScale ? '' + iScale.getLabelForValue(parsed[iScale.axis]) : '',
                value: vScale ? '' + vScale.getLabelForValue(parsed[vScale.axis]) : ''
            };
        }
     _update(mode) {
            const meta = this._cachedMeta;
            this.update(mode || 'default');
            meta._clip = toClip(valueOrDefault(this.options.clip, defaultClip(meta.xScale, meta.yScale, this.getMaxOverflow())));
        }
     update(mode) {}
        draw() {
            const ctx = this._ctx;
            const chart = this.chart;
            const meta = this._cachedMeta;
            const elements = meta.data || [];
            const area = chart.chartArea;
            const active = [];
            const start = this._drawStart || 0;
            const count = this._drawCount || elements.length - start;
            const drawActiveElementsOnTop = this.options.drawActiveElementsOnTop;
            let i;
            if (meta.dataset) {
                meta.dataset.draw(ctx, area, start, count);
            }
            for(i = start; i < start + count; ++i){
                const element = elements[i];
                if (element.hidden) {
                    continue;
                }
                if (element.active && drawActiveElementsOnTop) {
                    active.push(element);
                } else {
                    element.draw(ctx, area);
                }
            }
            for(i = 0; i < active.length; ++i){
                active[i].draw(ctx, area);
            }
        }
     getStyle(index, active) {
            const mode = active ? 'active' : 'default';
            return index === undefined && this._cachedMeta.dataset ? this.resolveDatasetElementOptions(mode) : this.resolveDataElementOptions(index || 0, mode);
        }
     getContext(index, active, mode) {
            const dataset = this.getDataset();
            let context;
            if (index >= 0 && index < this._cachedMeta.data.length) {
                const element = this._cachedMeta.data[index];
                context = element.$context || (element.$context = createDataContext(this.getContext(), index, element));
                context.parsed = this.getParsed(index);
                context.raw = dataset.data[index];
                context.index = context.dataIndex = index;
            } else {
                context = this.$context || (this.$context = createDatasetContext(this.chart.getContext(), this.index));
                context.dataset = dataset;
                context.index = context.datasetIndex = this.index;
            }
            context.active = !!active;
            context.mode = mode;
            return context;
        }
     resolveDatasetElementOptions(mode) {
            return this._resolveElementOptions(this.datasetElementType.id, mode);
        }
     resolveDataElementOptions(index, mode) {
            return this._resolveElementOptions(this.dataElementType.id, mode, index);
        }
     _resolveElementOptions(elementType, mode = 'default', index) {
            const active = mode === 'active';
            const cache = this._cachedDataOpts;
            const cacheKey = elementType + '-' + mode;
            const cached = cache[cacheKey];
            const sharing = this.enableOptionSharing && defined(index);
            if (cached) {
                return cloneIfNotShared(cached, sharing);
            }
            const config = this.chart.config;
            const scopeKeys = config.datasetElementScopeKeys(this._type, elementType);
            const prefixes = active ? [
                `${elementType}Hover`,
                'hover',
                elementType,
                ''
            ] : [
                elementType,
                ''
            ];
            const scopes = config.getOptionScopes(this.getDataset(), scopeKeys);
            const names = Object.keys(defaults.elements[elementType]);
            const context = ()=>this.getContext(index, active, mode);
            const values = config.resolveNamedOptions(scopes, names, context, prefixes);
            if (values.$shared) {
                values.$shared = sharing;
                cache[cacheKey] = Object.freeze(cloneIfNotShared(values, sharing));
            }
            return values;
        }
     _resolveAnimations(index, transition, active) {
            const chart = this.chart;
            const cache = this._cachedDataOpts;
            const cacheKey = `animation-${transition}`;
            const cached = cache[cacheKey];
            if (cached) {
                return cached;
            }
            let options;
            if (chart.options.animation !== false) {
                const config = this.chart.config;
                const scopeKeys = config.datasetAnimationScopeKeys(this._type, transition);
                const scopes = config.getOptionScopes(this.getDataset(), scopeKeys);
                options = config.createResolver(scopes, this.getContext(index, active, transition));
            }
            const animations = new Animations(chart, options && options.animations);
            if (options && options._cacheable) {
                cache[cacheKey] = Object.freeze(animations);
            }
            return animations;
        }
     getSharedOptions(options) {
            if (!options.$shared) {
                return;
            }
            return this._sharedOptions || (this._sharedOptions = Object.assign({}, options));
        }
     includeOptions(mode, sharedOptions) {
            return !sharedOptions || isDirectUpdateMode(mode) || this.chart._animationsDisabled;
        }
     _getSharedOptions(start, mode) {
            const firstOpts = this.resolveDataElementOptions(start, mode);
            const previouslySharedOptions = this._sharedOptions;
            const sharedOptions = this.getSharedOptions(firstOpts);
            const includeOptions = this.includeOptions(mode, sharedOptions) || sharedOptions !== previouslySharedOptions;
            this.updateSharedOptions(sharedOptions, mode, firstOpts);
            return {
                sharedOptions,
                includeOptions
            };
        }
     updateElement(element, index, properties, mode) {
            if (isDirectUpdateMode(mode)) {
                Object.assign(element, properties);
            } else {
                this._resolveAnimations(index, mode).update(element, properties);
            }
        }
     updateSharedOptions(sharedOptions, mode, newOptions) {
            if (sharedOptions && !isDirectUpdateMode(mode)) {
                this._resolveAnimations(undefined, mode).update(sharedOptions, newOptions);
            }
        }
     _setStyle(element, index, mode, active) {
            element.active = active;
            const options = this.getStyle(index, active);
            this._resolveAnimations(index, mode, active).update(element, {
                options: !active && this.getSharedOptions(options) || options
            });
        }
        removeHoverStyle(element, datasetIndex, index) {
            this._setStyle(element, index, 'active', false);
        }
        setHoverStyle(element, datasetIndex, index) {
            this._setStyle(element, index, 'active', true);
        }
     _removeDatasetHoverStyle() {
            const element = this._cachedMeta.dataset;
            if (element) {
                this._setStyle(element, undefined, 'active', false);
            }
        }
     _setDatasetHoverStyle() {
            const element = this._cachedMeta.dataset;
            if (element) {
                this._setStyle(element, undefined, 'active', true);
            }
        }
     _resyncElements(resetNewElements) {
            const data = this._data;
            const elements = this._cachedMeta.data;
            for (const [method, arg1, arg2] of this._syncList){
                this[method](arg1, arg2);
            }
            this._syncList = [];
            const numMeta = elements.length;
            const numData = data.length;
            const count = Math.min(numData, numMeta);
            if (count) {
                this.parse(0, count);
            }
            if (numData > numMeta) {
                this._insertElements(numMeta, numData - numMeta, resetNewElements);
            } else if (numData < numMeta) {
                this._removeElements(numData, numMeta - numData);
            }
        }
     _insertElements(start, count, resetNewElements = true) {
            const meta = this._cachedMeta;
            const data = meta.data;
            const end = start + count;
            let i;
            const move = (arr)=>{
                arr.length += count;
                for(i = arr.length - 1; i >= end; i--){
                    arr[i] = arr[i - count];
                }
            };
            move(data);
            for(i = start; i < end; ++i){
                data[i] = new this.dataElementType();
            }
            if (this._parsing) {
                move(meta._parsed);
            }
            this.parse(start, count);
            if (resetNewElements) {
                this.updateElements(data, start, count, 'reset');
            }
        }
        updateElements(element, start, count, mode) {}
     _removeElements(start, count) {
            const meta = this._cachedMeta;
            if (this._parsing) {
                const removed = meta._parsed.splice(start, count);
                if (meta._stacked) {
                    clearStacks(meta, removed);
                }
            }
            meta.data.splice(start, count);
        }
     _sync(args) {
            if (this._parsing) {
                this._syncList.push(args);
            } else {
                const [method, arg1, arg2] = args;
                this[method](arg1, arg2);
            }
            this.chart._dataChanges.push([
                this.index,
                ...args
            ]);
        }
        _onDataPush() {
            const count = arguments.length;
            this._sync([
                '_insertElements',
                this.getDataset().data.length - count,
                count
            ]);
        }
        _onDataPop() {
            this._sync([
                '_removeElements',
                this._cachedMeta.data.length - 1,
                1
            ]);
        }
        _onDataShift() {
            this._sync([
                '_removeElements',
                0,
                1
            ]);
        }
        _onDataSplice(start, count) {
            if (count) {
                this._sync([
                    '_removeElements',
                    start,
                    count
                ]);
            }
            const newCount = arguments.length - 2;
            if (newCount) {
                this._sync([
                    '_insertElements',
                    start,
                    newCount
                ]);
            }
        }
        _onDataUnshift() {
            this._sync([
                '_insertElements',
                0,
                arguments.length
            ]);
        }
    }

    function getAllScaleValues(scale, type) {
        if (!scale._cache.$bar) {
            const visibleMetas = scale.getMatchingVisibleMetas(type);
            let values = [];
            for(let i = 0, ilen = visibleMetas.length; i < ilen; i++){
                values = values.concat(visibleMetas[i].controller.getAllParsedValues(scale));
            }
            scale._cache.$bar = _arrayUnique(values.sort((a, b)=>a - b));
        }
        return scale._cache.$bar;
    }
     function computeMinSampleSize(meta) {
        const scale = meta.iScale;
        const values = getAllScaleValues(scale, meta.type);
        let min = scale._length;
        let i, ilen, curr, prev;
        const updateMinAndPrev = ()=>{
            if (curr === 32767 || curr === -32768) {
                return;
            }
            if (defined(prev)) {
                min = Math.min(min, Math.abs(curr - prev) || min);
            }
            prev = curr;
        };
        for(i = 0, ilen = values.length; i < ilen; ++i){
            curr = scale.getPixelForValue(values[i]);
            updateMinAndPrev();
        }
        prev = undefined;
        for(i = 0, ilen = scale.ticks.length; i < ilen; ++i){
            curr = scale.getPixelForTick(i);
            updateMinAndPrev();
        }
        return min;
    }
     function computeFitCategoryTraits(index, ruler, options, stackCount) {
        const thickness = options.barThickness;
        let size, ratio;
        if (isNullOrUndef(thickness)) {
            size = ruler.min * options.categoryPercentage;
            ratio = options.barPercentage;
        } else {
            size = thickness * stackCount;
            ratio = 1;
        }
        return {
            chunk: size / stackCount,
            ratio,
            start: ruler.pixels[index] - size / 2
        };
    }
     function computeFlexCategoryTraits(index, ruler, options, stackCount) {
        const pixels = ruler.pixels;
        const curr = pixels[index];
        let prev = index > 0 ? pixels[index - 1] : null;
        let next = index < pixels.length - 1 ? pixels[index + 1] : null;
        const percent = options.categoryPercentage;
        if (prev === null) {
            prev = curr - (next === null ? ruler.end - ruler.start : next - curr);
        }
        if (next === null) {
            next = curr + curr - prev;
        }
        const start = curr - (curr - Math.min(prev, next)) / 2 * percent;
        const size = Math.abs(next - prev) / 2 * percent;
        return {
            chunk: size / stackCount,
            ratio: options.barPercentage,
            start
        };
    }
    function parseFloatBar(entry, item, vScale, i) {
        const startValue = vScale.parse(entry[0], i);
        const endValue = vScale.parse(entry[1], i);
        const min = Math.min(startValue, endValue);
        const max = Math.max(startValue, endValue);
        let barStart = min;
        let barEnd = max;
        if (Math.abs(min) > Math.abs(max)) {
            barStart = max;
            barEnd = min;
        }
        item[vScale.axis] = barEnd;
        item._custom = {
            barStart,
            barEnd,
            start: startValue,
            end: endValue,
            min,
            max
        };
    }
    function parseValue(entry, item, vScale, i) {
        if (isArray(entry)) {
            parseFloatBar(entry, item, vScale, i);
        } else {
            item[vScale.axis] = vScale.parse(entry, i);
        }
        return item;
    }
    function parseArrayOrPrimitive(meta, data, start, count) {
        const iScale = meta.iScale;
        const vScale = meta.vScale;
        const labels = iScale.getLabels();
        const singleScale = iScale === vScale;
        const parsed = [];
        let i, ilen, item, entry;
        for(i = start, ilen = start + count; i < ilen; ++i){
            entry = data[i];
            item = {};
            item[iScale.axis] = singleScale || iScale.parse(labels[i], i);
            parsed.push(parseValue(entry, item, vScale, i));
        }
        return parsed;
    }
    function isFloatBar(custom) {
        return custom && custom.barStart !== undefined && custom.barEnd !== undefined;
    }
    function barSign(size, vScale, actualBase) {
        if (size !== 0) {
            return sign(size);
        }
        return (vScale.isHorizontal() ? 1 : -1) * (vScale.min >= actualBase ? 1 : -1);
    }
    function borderProps(properties) {
        let reverse, start, end, top, bottom;
        if (properties.horizontal) {
            reverse = properties.base > properties.x;
            start = 'left';
            end = 'right';
        } else {
            reverse = properties.base < properties.y;
            start = 'bottom';
            end = 'top';
        }
        if (reverse) {
            top = 'end';
            bottom = 'start';
        } else {
            top = 'start';
            bottom = 'end';
        }
        return {
            start,
            end,
            reverse,
            top,
            bottom
        };
    }
    function setBorderSkipped(properties, options, stack, index) {
        let edge = options.borderSkipped;
        const res = {};
        if (!edge) {
            properties.borderSkipped = res;
            return;
        }
        if (edge === true) {
            properties.borderSkipped = {
                top: true,
                right: true,
                bottom: true,
                left: true
            };
            return;
        }
        const { start , end , reverse , top , bottom  } = borderProps(properties);
        if (edge === 'middle' && stack) {
            properties.enableBorderRadius = true;
            if ((stack._top || 0) === index) {
                edge = top;
            } else if ((stack._bottom || 0) === index) {
                edge = bottom;
            } else {
                res[parseEdge(bottom, start, end, reverse)] = true;
                edge = top;
            }
        }
        res[parseEdge(edge, start, end, reverse)] = true;
        properties.borderSkipped = res;
    }
    function parseEdge(edge, a, b, reverse) {
        if (reverse) {
            edge = swap(edge, a, b);
            edge = startEnd(edge, b, a);
        } else {
            edge = startEnd(edge, a, b);
        }
        return edge;
    }
    function swap(orig, v1, v2) {
        return orig === v1 ? v2 : orig === v2 ? v1 : orig;
    }
    function startEnd(v, start, end) {
        return v === 'start' ? start : v === 'end' ? end : v;
    }
    function setInflateAmount(properties, { inflateAmount  }, ratio) {
        properties.inflateAmount = inflateAmount === 'auto' ? ratio === 1 ? 0.33 : 0 : inflateAmount;
    }
    class BarController extends DatasetController {
        static id = 'bar';
     static defaults = {
            datasetElementType: false,
            dataElementType: 'bar',
            categoryPercentage: 0.8,
            barPercentage: 0.9,
            grouped: true,
            animations: {
                numbers: {
                    type: 'number',
                    properties: [
                        'x',
                        'y',
                        'base',
                        'width',
                        'height'
                    ]
                }
            }
        };
     static overrides = {
            scales: {
                _index_: {
                    type: 'category',
                    offset: true,
                    grid: {
                        offset: true
                    }
                },
                _value_: {
                    type: 'linear',
                    beginAtZero: true
                }
            }
        };
     parsePrimitiveData(meta, data, start, count) {
            return parseArrayOrPrimitive(meta, data, start, count);
        }
     parseArrayData(meta, data, start, count) {
            return parseArrayOrPrimitive(meta, data, start, count);
        }
     parseObjectData(meta, data, start, count) {
            const { iScale , vScale  } = meta;
            const { xAxisKey ='x' , yAxisKey ='y'  } = this._parsing;
            const iAxisKey = iScale.axis === 'x' ? xAxisKey : yAxisKey;
            const vAxisKey = vScale.axis === 'x' ? xAxisKey : yAxisKey;
            const parsed = [];
            let i, ilen, item, obj;
            for(i = start, ilen = start + count; i < ilen; ++i){
                obj = data[i];
                item = {};
                item[iScale.axis] = iScale.parse(resolveObjectKey(obj, iAxisKey), i);
                parsed.push(parseValue(resolveObjectKey(obj, vAxisKey), item, vScale, i));
            }
            return parsed;
        }
     updateRangeFromParsed(range, scale, parsed, stack) {
            super.updateRangeFromParsed(range, scale, parsed, stack);
            const custom = parsed._custom;
            if (custom && scale === this._cachedMeta.vScale) {
                range.min = Math.min(range.min, custom.min);
                range.max = Math.max(range.max, custom.max);
            }
        }
     getMaxOverflow() {
            return 0;
        }
     getLabelAndValue(index) {
            const meta = this._cachedMeta;
            const { iScale , vScale  } = meta;
            const parsed = this.getParsed(index);
            const custom = parsed._custom;
            const value = isFloatBar(custom) ? '[' + custom.start + ', ' + custom.end + ']' : '' + vScale.getLabelForValue(parsed[vScale.axis]);
            return {
                label: '' + iScale.getLabelForValue(parsed[iScale.axis]),
                value
            };
        }
        initialize() {
            this.enableOptionSharing = true;
            super.initialize();
            const meta = this._cachedMeta;
            meta.stack = this.getDataset().stack;
        }
        update(mode) {
            const meta = this._cachedMeta;
            this.updateElements(meta.data, 0, meta.data.length, mode);
        }
        updateElements(bars, start, count, mode) {
            const reset = mode === 'reset';
            const { index , _cachedMeta: { vScale  }  } = this;
            const base = vScale.getBasePixel();
            const horizontal = vScale.isHorizontal();
            const ruler = this._getRuler();
            const { sharedOptions , includeOptions  } = this._getSharedOptions(start, mode);
            for(let i = start; i < start + count; i++){
                const parsed = this.getParsed(i);
                const vpixels = reset || isNullOrUndef(parsed[vScale.axis]) ? {
                    base,
                    head: base
                } : this._calculateBarValuePixels(i);
                const ipixels = this._calculateBarIndexPixels(i, ruler);
                const stack = (parsed._stacks || {})[vScale.axis];
                const properties = {
                    horizontal,
                    base: vpixels.base,
                    enableBorderRadius: !stack || isFloatBar(parsed._custom) || index === stack._top || index === stack._bottom,
                    x: horizontal ? vpixels.head : ipixels.center,
                    y: horizontal ? ipixels.center : vpixels.head,
                    height: horizontal ? ipixels.size : Math.abs(vpixels.size),
                    width: horizontal ? Math.abs(vpixels.size) : ipixels.size
                };
                if (includeOptions) {
                    properties.options = sharedOptions || this.resolveDataElementOptions(i, bars[i].active ? 'active' : mode);
                }
                const options = properties.options || bars[i].options;
                setBorderSkipped(properties, options, stack, index);
                setInflateAmount(properties, options, ruler.ratio);
                this.updateElement(bars[i], i, properties, mode);
            }
        }
     _getStacks(last, dataIndex) {
            const { iScale  } = this._cachedMeta;
            const metasets = iScale.getMatchingVisibleMetas(this._type).filter((meta)=>meta.controller.options.grouped);
            const stacked = iScale.options.stacked;
            const stacks = [];
            const currentParsed = this._cachedMeta.controller.getParsed(dataIndex);
            const iScaleValue = currentParsed && currentParsed[iScale.axis];
            const skipNull = (meta)=>{
                const parsed = meta._parsed.find((item)=>item[iScale.axis] === iScaleValue);
                const val = parsed && parsed[meta.vScale.axis];
                if (isNullOrUndef(val) || isNaN(val)) {
                    return true;
                }
            };
            for (const meta of metasets){
                if (dataIndex !== undefined && skipNull(meta)) {
                    continue;
                }
                if (stacked === false || stacks.indexOf(meta.stack) === -1 || stacked === undefined && meta.stack === undefined) {
                    stacks.push(meta.stack);
                }
                if (meta.index === last) {
                    break;
                }
            }
            if (!stacks.length) {
                stacks.push(undefined);
            }
            return stacks;
        }
     _getStackCount(index) {
            return this._getStacks(undefined, index).length;
        }
        _getAxisCount() {
            return this._getAxis().length;
        }
        getFirstScaleIdForIndexAxis() {
            const scales = this.chart.scales;
            const indexScaleId = this.chart.options.indexAxis;
            return Object.keys(scales).filter((key)=>scales[key].axis === indexScaleId).shift();
        }
        _getAxis() {
            const axis = {};
            const firstScaleAxisId = this.getFirstScaleIdForIndexAxis();
            for (const dataset of this.chart.data.datasets){
                axis[valueOrDefault(this.chart.options.indexAxis === 'x' ? dataset.xAxisID : dataset.yAxisID, firstScaleAxisId)] = true;
            }
            return Object.keys(axis);
        }
     _getStackIndex(datasetIndex, name, dataIndex) {
            const stacks = this._getStacks(datasetIndex, dataIndex);
            const index = name !== undefined ? stacks.indexOf(name) : -1;
            return index === -1 ? stacks.length - 1 : index;
        }
     _getRuler() {
            const opts = this.options;
            const meta = this._cachedMeta;
            const iScale = meta.iScale;
            const pixels = [];
            let i, ilen;
            for(i = 0, ilen = meta.data.length; i < ilen; ++i){
                pixels.push(iScale.getPixelForValue(this.getParsed(i)[iScale.axis], i));
            }
            const barThickness = opts.barThickness;
            const min = barThickness || computeMinSampleSize(meta);
            return {
                min,
                pixels,
                start: iScale._startPixel,
                end: iScale._endPixel,
                stackCount: this._getStackCount(),
                scale: iScale,
                grouped: opts.grouped,
                ratio: barThickness ? 1 : opts.categoryPercentage * opts.barPercentage
            };
        }
     _calculateBarValuePixels(index) {
            const { _cachedMeta: { vScale , _stacked , index: datasetIndex  } , options: { base: baseValue , minBarLength  }  } = this;
            const actualBase = baseValue || 0;
            const parsed = this.getParsed(index);
            const custom = parsed._custom;
            const floating = isFloatBar(custom);
            let value = parsed[vScale.axis];
            let start = 0;
            let length = _stacked ? this.applyStack(vScale, parsed, _stacked) : value;
            let head, size;
            if (length !== value) {
                start = length - value;
                length = value;
            }
            if (floating) {
                value = custom.barStart;
                length = custom.barEnd - custom.barStart;
                if (value !== 0 && sign(value) !== sign(custom.barEnd)) {
                    start = 0;
                }
                start += value;
            }
            const startValue = !isNullOrUndef(baseValue) && !floating ? baseValue : start;
            let base = vScale.getPixelForValue(startValue);
            if (this.chart.getDataVisibility(index)) {
                head = vScale.getPixelForValue(start + length);
            } else {
                head = base;
            }
            size = head - base;
            if (Math.abs(size) < minBarLength) {
                size = barSign(size, vScale, actualBase) * minBarLength;
                if (value === actualBase) {
                    base -= size / 2;
                }
                const startPixel = vScale.getPixelForDecimal(0);
                const endPixel = vScale.getPixelForDecimal(1);
                const min = Math.min(startPixel, endPixel);
                const max = Math.max(startPixel, endPixel);
                base = Math.max(Math.min(base, max), min);
                head = base + size;
                if (_stacked && !floating) {
                    parsed._stacks[vScale.axis]._visualValues[datasetIndex] = vScale.getValueForPixel(head) - vScale.getValueForPixel(base);
                }
            }
            if (base === vScale.getPixelForValue(actualBase)) {
                const halfGrid = sign(size) * vScale.getLineWidthForValue(actualBase) / 2;
                base += halfGrid;
                size -= halfGrid;
            }
            return {
                size,
                base,
                head,
                center: head + size / 2
            };
        }
     _calculateBarIndexPixels(index, ruler) {
            const scale = ruler.scale;
            const options = this.options;
            const skipNull = options.skipNull;
            const maxBarThickness = valueOrDefault(options.maxBarThickness, Infinity);
            let center, size;
            const axisCount = this._getAxisCount();
            if (ruler.grouped) {
                const stackCount = skipNull ? this._getStackCount(index) : ruler.stackCount;
                const range = options.barThickness === 'flex' ? computeFlexCategoryTraits(index, ruler, options, stackCount * axisCount) : computeFitCategoryTraits(index, ruler, options, stackCount * axisCount);
                const axisID = this.chart.options.indexAxis === 'x' ? this.getDataset().xAxisID : this.getDataset().yAxisID;
                const axisNumber = this._getAxis().indexOf(valueOrDefault(axisID, this.getFirstScaleIdForIndexAxis()));
                const stackIndex = this._getStackIndex(this.index, this._cachedMeta.stack, skipNull ? index : undefined) + axisNumber;
                center = range.start + range.chunk * stackIndex + range.chunk / 2;
                size = Math.min(maxBarThickness, range.chunk * range.ratio);
            } else {
                center = scale.getPixelForValue(this.getParsed(index)[scale.axis], index);
                size = Math.min(maxBarThickness, ruler.min * ruler.ratio);
            }
            return {
                base: center - size / 2,
                head: center + size / 2,
                center,
                size
            };
        }
        draw() {
            const meta = this._cachedMeta;
            const vScale = meta.vScale;
            const rects = meta.data;
            const ilen = rects.length;
            let i = 0;
            for(; i < ilen; ++i){
                if (this.getParsed(i)[vScale.axis] !== null && !rects[i].hidden) {
                    rects[i].draw(this._ctx);
                }
            }
        }
    }

    class BubbleController extends DatasetController {
        static id = 'bubble';
     static defaults = {
            datasetElementType: false,
            dataElementType: 'point',
            animations: {
                numbers: {
                    type: 'number',
                    properties: [
                        'x',
                        'y',
                        'borderWidth',
                        'radius'
                    ]
                }
            }
        };
     static overrides = {
            scales: {
                x: {
                    type: 'linear'
                },
                y: {
                    type: 'linear'
                }
            }
        };
        initialize() {
            this.enableOptionSharing = true;
            super.initialize();
        }
     parsePrimitiveData(meta, data, start, count) {
            const parsed = super.parsePrimitiveData(meta, data, start, count);
            for(let i = 0; i < parsed.length; i++){
                parsed[i]._custom = this.resolveDataElementOptions(i + start).radius;
            }
            return parsed;
        }
     parseArrayData(meta, data, start, count) {
            const parsed = super.parseArrayData(meta, data, start, count);
            for(let i = 0; i < parsed.length; i++){
                const item = data[start + i];
                parsed[i]._custom = valueOrDefault(item[2], this.resolveDataElementOptions(i + start).radius);
            }
            return parsed;
        }
     parseObjectData(meta, data, start, count) {
            const parsed = super.parseObjectData(meta, data, start, count);
            for(let i = 0; i < parsed.length; i++){
                const item = data[start + i];
                parsed[i]._custom = valueOrDefault(item && item.r && +item.r, this.resolveDataElementOptions(i + start).radius);
            }
            return parsed;
        }
     getMaxOverflow() {
            const data = this._cachedMeta.data;
            let max = 0;
            for(let i = data.length - 1; i >= 0; --i){
                max = Math.max(max, data[i].size(this.resolveDataElementOptions(i)) / 2);
            }
            return max > 0 && max;
        }
     getLabelAndValue(index) {
            const meta = this._cachedMeta;
            const labels = this.chart.data.labels || [];
            const { xScale , yScale  } = meta;
            const parsed = this.getParsed(index);
            const x = xScale.getLabelForValue(parsed.x);
            const y = yScale.getLabelForValue(parsed.y);
            const r = parsed._custom;
            return {
                label: labels[index] || '',
                value: '(' + x + ', ' + y + (r ? ', ' + r : '') + ')'
            };
        }
        update(mode) {
            const points = this._cachedMeta.data;
            this.updateElements(points, 0, points.length, mode);
        }
        updateElements(points, start, count, mode) {
            const reset = mode === 'reset';
            const { iScale , vScale  } = this._cachedMeta;
            const { sharedOptions , includeOptions  } = this._getSharedOptions(start, mode);
            const iAxis = iScale.axis;
            const vAxis = vScale.axis;
            for(let i = start; i < start + count; i++){
                const point = points[i];
                const parsed = !reset && this.getParsed(i);
                const properties = {};
                const iPixel = properties[iAxis] = reset ? iScale.getPixelForDecimal(0.5) : iScale.getPixelForValue(parsed[iAxis]);
                const vPixel = properties[vAxis] = reset ? vScale.getBasePixel() : vScale.getPixelForValue(parsed[vAxis]);
                properties.skip = isNaN(iPixel) || isNaN(vPixel);
                if (includeOptions) {
                    properties.options = sharedOptions || this.resolveDataElementOptions(i, point.active ? 'active' : mode);
                    if (reset) {
                        properties.options.radius = 0;
                    }
                }
                this.updateElement(point, i, properties, mode);
            }
        }
     resolveDataElementOptions(index, mode) {
            const parsed = this.getParsed(index);
            let values = super.resolveDataElementOptions(index, mode);
            if (values.$shared) {
                values = Object.assign({}, values, {
                    $shared: false
                });
            }
            const radius = values.radius;
            if (mode !== 'active') {
                values.radius = 0;
            }
            values.radius += valueOrDefault(parsed && parsed._custom, radius);
            return values;
        }
    }

    function getRatioAndOffset(rotation, circumference, cutout) {
        let ratioX = 1;
        let ratioY = 1;
        let offsetX = 0;
        let offsetY = 0;
        if (circumference < TAU) {
            const startAngle = rotation;
            const endAngle = startAngle + circumference;
            const startX = Math.cos(startAngle);
            const startY = Math.sin(startAngle);
            const endX = Math.cos(endAngle);
            const endY = Math.sin(endAngle);
            const calcMax = (angle, a, b)=>_angleBetween(angle, startAngle, endAngle, true) ? 1 : Math.max(a, a * cutout, b, b * cutout);
            const calcMin = (angle, a, b)=>_angleBetween(angle, startAngle, endAngle, true) ? -1 : Math.min(a, a * cutout, b, b * cutout);
            const maxX = calcMax(0, startX, endX);
            const maxY = calcMax(HALF_PI, startY, endY);
            const minX = calcMin(PI, startX, endX);
            const minY = calcMin(PI + HALF_PI, startY, endY);
            ratioX = (maxX - minX) / 2;
            ratioY = (maxY - minY) / 2;
            offsetX = -(maxX + minX) / 2;
            offsetY = -(maxY + minY) / 2;
        }
        return {
            ratioX,
            ratioY,
            offsetX,
            offsetY
        };
    }
    class DoughnutController extends DatasetController {
        static id = 'doughnut';
     static defaults = {
            datasetElementType: false,
            dataElementType: 'arc',
            animation: {
                animateRotate: true,
                animateScale: false
            },
            animations: {
                numbers: {
                    type: 'number',
                    properties: [
                        'circumference',
                        'endAngle',
                        'innerRadius',
                        'outerRadius',
                        'startAngle',
                        'x',
                        'y',
                        'offset',
                        'borderWidth',
                        'spacing'
                    ]
                }
            },
            cutout: '50%',
            rotation: 0,
            circumference: 360,
            radius: '100%',
            spacing: 0,
            indexAxis: 'r'
        };
        static descriptors = {
            _scriptable: (name)=>name !== 'spacing',
            _indexable: (name)=>name !== 'spacing' && !name.startsWith('borderDash') && !name.startsWith('hoverBorderDash')
        };
     static overrides = {
            aspectRatio: 1,
            plugins: {
                legend: {
                    labels: {
                        generateLabels (chart) {
                            const data = chart.data;
                            const { labels: { pointStyle , textAlign , color , useBorderRadius , borderRadius  }  } = chart.legend.options;
                            if (data.labels.length && data.datasets.length) {
                                return data.labels.map((label, i)=>{
                                    const meta = chart.getDatasetMeta(0);
                                    const style = meta.controller.getStyle(i);
                                    return {
                                        text: label,
                                        fillStyle: style.backgroundColor,
                                        fontColor: color,
                                        hidden: !chart.getDataVisibility(i),
                                        lineDash: style.borderDash,
                                        lineDashOffset: style.borderDashOffset,
                                        lineJoin: style.borderJoinStyle,
                                        lineWidth: style.borderWidth,
                                        strokeStyle: style.borderColor,
                                        textAlign: textAlign,
                                        pointStyle: pointStyle,
                                        borderRadius: useBorderRadius && (borderRadius || style.borderRadius),
                                        index: i
                                    };
                                });
                            }
                            return [];
                        }
                    },
                    onClick (e, legendItem, legend) {
                        legend.chart.toggleDataVisibility(legendItem.index);
                        legend.chart.update();
                    }
                }
            }
        };
        constructor(chart, datasetIndex){
            super(chart, datasetIndex);
            this.enableOptionSharing = true;
            this.innerRadius = undefined;
            this.outerRadius = undefined;
            this.offsetX = undefined;
            this.offsetY = undefined;
        }
        linkScales() {}
     parse(start, count) {
            const data = this.getDataset().data;
            const meta = this._cachedMeta;
            if (this._parsing === false) {
                meta._parsed = data;
            } else {
                let getter = (i)=>+data[i];
                if (isObject(data[start])) {
                    const { key ='value'  } = this._parsing;
                    getter = (i)=>+resolveObjectKey(data[i], key);
                }
                let i, ilen;
                for(i = start, ilen = start + count; i < ilen; ++i){
                    meta._parsed[i] = getter(i);
                }
            }
        }
     _getRotation() {
            return toRadians(this.options.rotation - 90);
        }
     _getCircumference() {
            return toRadians(this.options.circumference);
        }
     _getRotationExtents() {
            let min = TAU;
            let max = -TAU;
            for(let i = 0; i < this.chart.data.datasets.length; ++i){
                if (this.chart.isDatasetVisible(i) && this.chart.getDatasetMeta(i).type === this._type) {
                    const controller = this.chart.getDatasetMeta(i).controller;
                    const rotation = controller._getRotation();
                    const circumference = controller._getCircumference();
                    min = Math.min(min, rotation);
                    max = Math.max(max, rotation + circumference);
                }
            }
            return {
                rotation: min,
                circumference: max - min
            };
        }
     update(mode) {
            const chart = this.chart;
            const { chartArea  } = chart;
            const meta = this._cachedMeta;
            const arcs = meta.data;
            const spacing = this.getMaxBorderWidth() + this.getMaxOffset(arcs) + this.options.spacing;
            const maxSize = Math.max((Math.min(chartArea.width, chartArea.height) - spacing) / 2, 0);
            const cutout = Math.min(toPercentage(this.options.cutout, maxSize), 1);
            const chartWeight = this._getRingWeight(this.index);
            const { circumference , rotation  } = this._getRotationExtents();
            const { ratioX , ratioY , offsetX , offsetY  } = getRatioAndOffset(rotation, circumference, cutout);
            const maxWidth = (chartArea.width - spacing) / ratioX;
            const maxHeight = (chartArea.height - spacing) / ratioY;
            const maxRadius = Math.max(Math.min(maxWidth, maxHeight) / 2, 0);
            const outerRadius = toDimension(this.options.radius, maxRadius);
            const innerRadius = Math.max(outerRadius * cutout, 0);
            const radiusLength = (outerRadius - innerRadius) / this._getVisibleDatasetWeightTotal();
            this.offsetX = offsetX * outerRadius;
            this.offsetY = offsetY * outerRadius;
            meta.total = this.calculateTotal();
            this.outerRadius = outerRadius - radiusLength * this._getRingWeightOffset(this.index);
            this.innerRadius = Math.max(this.outerRadius - radiusLength * chartWeight, 0);
            this.updateElements(arcs, 0, arcs.length, mode);
        }
     _circumference(i, reset) {
            const opts = this.options;
            const meta = this._cachedMeta;
            const circumference = this._getCircumference();
            if (reset && opts.animation.animateRotate || !this.chart.getDataVisibility(i) || meta._parsed[i] === null || meta.data[i].hidden) {
                return 0;
            }
            return this.calculateCircumference(meta._parsed[i] * circumference / TAU);
        }
        updateElements(arcs, start, count, mode) {
            const reset = mode === 'reset';
            const chart = this.chart;
            const chartArea = chart.chartArea;
            const opts = chart.options;
            const animationOpts = opts.animation;
            const centerX = (chartArea.left + chartArea.right) / 2;
            const centerY = (chartArea.top + chartArea.bottom) / 2;
            const animateScale = reset && animationOpts.animateScale;
            const innerRadius = animateScale ? 0 : this.innerRadius;
            const outerRadius = animateScale ? 0 : this.outerRadius;
            const { sharedOptions , includeOptions  } = this._getSharedOptions(start, mode);
            let startAngle = this._getRotation();
            let i;
            for(i = 0; i < start; ++i){
                startAngle += this._circumference(i, reset);
            }
            for(i = start; i < start + count; ++i){
                const circumference = this._circumference(i, reset);
                const arc = arcs[i];
                const properties = {
                    x: centerX + this.offsetX,
                    y: centerY + this.offsetY,
                    startAngle,
                    endAngle: startAngle + circumference,
                    circumference,
                    outerRadius,
                    innerRadius
                };
                if (includeOptions) {
                    properties.options = sharedOptions || this.resolveDataElementOptions(i, arc.active ? 'active' : mode);
                }
                startAngle += circumference;
                this.updateElement(arc, i, properties, mode);
            }
        }
        calculateTotal() {
            const meta = this._cachedMeta;
            const metaData = meta.data;
            let total = 0;
            let i;
            for(i = 0; i < metaData.length; i++){
                const value = meta._parsed[i];
                if (value !== null && !isNaN(value) && this.chart.getDataVisibility(i) && !metaData[i].hidden) {
                    total += Math.abs(value);
                }
            }
            return total;
        }
        calculateCircumference(value) {
            const total = this._cachedMeta.total;
            if (total > 0 && !isNaN(value)) {
                return TAU * (Math.abs(value) / total);
            }
            return 0;
        }
        getLabelAndValue(index) {
            const meta = this._cachedMeta;
            const chart = this.chart;
            const labels = chart.data.labels || [];
            const value = formatNumber(meta._parsed[index], chart.options.locale);
            return {
                label: labels[index] || '',
                value
            };
        }
        getMaxBorderWidth(arcs) {
            let max = 0;
            const chart = this.chart;
            let i, ilen, meta, controller, options;
            if (!arcs) {
                for(i = 0, ilen = chart.data.datasets.length; i < ilen; ++i){
                    if (chart.isDatasetVisible(i)) {
                        meta = chart.getDatasetMeta(i);
                        arcs = meta.data;
                        controller = meta.controller;
                        break;
                    }
                }
            }
            if (!arcs) {
                return 0;
            }
            for(i = 0, ilen = arcs.length; i < ilen; ++i){
                options = controller.resolveDataElementOptions(i);
                if (options.borderAlign !== 'inner') {
                    max = Math.max(max, options.borderWidth || 0, options.hoverBorderWidth || 0);
                }
            }
            return max;
        }
        getMaxOffset(arcs) {
            let max = 0;
            for(let i = 0, ilen = arcs.length; i < ilen; ++i){
                const options = this.resolveDataElementOptions(i);
                max = Math.max(max, options.offset || 0, options.hoverOffset || 0);
            }
            return max;
        }
     _getRingWeightOffset(datasetIndex) {
            let ringWeightOffset = 0;
            for(let i = 0; i < datasetIndex; ++i){
                if (this.chart.isDatasetVisible(i)) {
                    ringWeightOffset += this._getRingWeight(i);
                }
            }
            return ringWeightOffset;
        }
     _getRingWeight(datasetIndex) {
            return Math.max(valueOrDefault(this.chart.data.datasets[datasetIndex].weight, 1), 0);
        }
     _getVisibleDatasetWeightTotal() {
            return this._getRingWeightOffset(this.chart.data.datasets.length) || 1;
        }
    }

    class LineController extends DatasetController {
        static id = 'line';
     static defaults = {
            datasetElementType: 'line',
            dataElementType: 'point',
            showLine: true,
            spanGaps: false
        };
     static overrides = {
            scales: {
                _index_: {
                    type: 'category'
                },
                _value_: {
                    type: 'linear'
                }
            }
        };
        initialize() {
            this.enableOptionSharing = true;
            this.supportsDecimation = true;
            super.initialize();
        }
        update(mode) {
            const meta = this._cachedMeta;
            const { dataset: line , data: points = [] , _dataset  } = meta;
            const animationsDisabled = this.chart._animationsDisabled;
            let { start , count  } = _getStartAndCountOfVisiblePoints(meta, points, animationsDisabled);
            this._drawStart = start;
            this._drawCount = count;
            if (_scaleRangesChanged(meta)) {
                start = 0;
                count = points.length;
            }
            line._chart = this.chart;
            line._datasetIndex = this.index;
            line._decimated = !!_dataset._decimated;
            line.points = points;
            const options = this.resolveDatasetElementOptions(mode);
            if (!this.options.showLine) {
                options.borderWidth = 0;
            }
            options.segment = this.options.segment;
            this.updateElement(line, undefined, {
                animated: !animationsDisabled,
                options
            }, mode);
            this.updateElements(points, start, count, mode);
        }
        updateElements(points, start, count, mode) {
            const reset = mode === 'reset';
            const { iScale , vScale , _stacked , _dataset  } = this._cachedMeta;
            const { sharedOptions , includeOptions  } = this._getSharedOptions(start, mode);
            const iAxis = iScale.axis;
            const vAxis = vScale.axis;
            const { spanGaps , segment  } = this.options;
            const maxGapLength = isNumber(spanGaps) ? spanGaps : Number.POSITIVE_INFINITY;
            const directUpdate = this.chart._animationsDisabled || reset || mode === 'none';
            const end = start + count;
            const pointsCount = points.length;
            let prevParsed = start > 0 && this.getParsed(start - 1);
            for(let i = 0; i < pointsCount; ++i){
                const point = points[i];
                const properties = directUpdate ? point : {};
                if (i < start || i >= end) {
                    properties.skip = true;
                    continue;
                }
                const parsed = this.getParsed(i);
                const nullData = isNullOrUndef(parsed[vAxis]);
                const iPixel = properties[iAxis] = iScale.getPixelForValue(parsed[iAxis], i);
                const vPixel = properties[vAxis] = reset || nullData ? vScale.getBasePixel() : vScale.getPixelForValue(_stacked ? this.applyStack(vScale, parsed, _stacked) : parsed[vAxis], i);
                properties.skip = isNaN(iPixel) || isNaN(vPixel) || nullData;
                properties.stop = i > 0 && Math.abs(parsed[iAxis] - prevParsed[iAxis]) > maxGapLength;
                if (segment) {
                    properties.parsed = parsed;
                    properties.raw = _dataset.data[i];
                }
                if (includeOptions) {
                    properties.options = sharedOptions || this.resolveDataElementOptions(i, point.active ? 'active' : mode);
                }
                if (!directUpdate) {
                    this.updateElement(point, i, properties, mode);
                }
                prevParsed = parsed;
            }
        }
     getMaxOverflow() {
            const meta = this._cachedMeta;
            const dataset = meta.dataset;
            const border = dataset.options && dataset.options.borderWidth || 0;
            const data = meta.data || [];
            if (!data.length) {
                return border;
            }
            const firstPoint = data[0].size(this.resolveDataElementOptions(0));
            const lastPoint = data[data.length - 1].size(this.resolveDataElementOptions(data.length - 1));
            return Math.max(border, firstPoint, lastPoint) / 2;
        }
        draw() {
            const meta = this._cachedMeta;
            meta.dataset.updateControlPoints(this.chart.chartArea, meta.iScale.axis);
            super.draw();
        }
    }

    class PolarAreaController extends DatasetController {
        static id = 'polarArea';
     static defaults = {
            dataElementType: 'arc',
            animation: {
                animateRotate: true,
                animateScale: true
            },
            animations: {
                numbers: {
                    type: 'number',
                    properties: [
                        'x',
                        'y',
                        'startAngle',
                        'endAngle',
                        'innerRadius',
                        'outerRadius'
                    ]
                }
            },
            indexAxis: 'r',
            startAngle: 0
        };
     static overrides = {
            aspectRatio: 1,
            plugins: {
                legend: {
                    labels: {
                        generateLabels (chart) {
                            const data = chart.data;
                            if (data.labels.length && data.datasets.length) {
                                const { labels: { pointStyle , color  }  } = chart.legend.options;
                                return data.labels.map((label, i)=>{
                                    const meta = chart.getDatasetMeta(0);
                                    const style = meta.controller.getStyle(i);
                                    return {
                                        text: label,
                                        fillStyle: style.backgroundColor,
                                        strokeStyle: style.borderColor,
                                        fontColor: color,
                                        lineWidth: style.borderWidth,
                                        pointStyle: pointStyle,
                                        hidden: !chart.getDataVisibility(i),
                                        index: i
                                    };
                                });
                            }
                            return [];
                        }
                    },
                    onClick (e, legendItem, legend) {
                        legend.chart.toggleDataVisibility(legendItem.index);
                        legend.chart.update();
                    }
                }
            },
            scales: {
                r: {
                    type: 'radialLinear',
                    angleLines: {
                        display: false
                    },
                    beginAtZero: true,
                    grid: {
                        circular: true
                    },
                    pointLabels: {
                        display: false
                    },
                    startAngle: 0
                }
            }
        };
        constructor(chart, datasetIndex){
            super(chart, datasetIndex);
            this.innerRadius = undefined;
            this.outerRadius = undefined;
        }
        getLabelAndValue(index) {
            const meta = this._cachedMeta;
            const chart = this.chart;
            const labels = chart.data.labels || [];
            const value = formatNumber(meta._parsed[index].r, chart.options.locale);
            return {
                label: labels[index] || '',
                value
            };
        }
        parseObjectData(meta, data, start, count) {
            return _parseObjectDataRadialScale.bind(this)(meta, data, start, count);
        }
        update(mode) {
            const arcs = this._cachedMeta.data;
            this._updateRadius();
            this.updateElements(arcs, 0, arcs.length, mode);
        }
     getMinMax() {
            const meta = this._cachedMeta;
            const range = {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY
            };
            meta.data.forEach((element, index)=>{
                const parsed = this.getParsed(index).r;
                if (!isNaN(parsed) && this.chart.getDataVisibility(index)) {
                    if (parsed < range.min) {
                        range.min = parsed;
                    }
                    if (parsed > range.max) {
                        range.max = parsed;
                    }
                }
            });
            return range;
        }
     _updateRadius() {
            const chart = this.chart;
            const chartArea = chart.chartArea;
            const opts = chart.options;
            const minSize = Math.min(chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
            const outerRadius = Math.max(minSize / 2, 0);
            const innerRadius = Math.max(opts.cutoutPercentage ? outerRadius / 100 * opts.cutoutPercentage : 1, 0);
            const radiusLength = (outerRadius - innerRadius) / chart.getVisibleDatasetCount();
            this.outerRadius = outerRadius - radiusLength * this.index;
            this.innerRadius = this.outerRadius - radiusLength;
        }
        updateElements(arcs, start, count, mode) {
            const reset = mode === 'reset';
            const chart = this.chart;
            const opts = chart.options;
            const animationOpts = opts.animation;
            const scale = this._cachedMeta.rScale;
            const centerX = scale.xCenter;
            const centerY = scale.yCenter;
            const datasetStartAngle = scale.getIndexAngle(0) - 0.5 * PI;
            let angle = datasetStartAngle;
            let i;
            const defaultAngle = 360 / this.countVisibleElements();
            for(i = 0; i < start; ++i){
                angle += this._computeAngle(i, mode, defaultAngle);
            }
            for(i = start; i < start + count; i++){
                const arc = arcs[i];
                let startAngle = angle;
                let endAngle = angle + this._computeAngle(i, mode, defaultAngle);
                let outerRadius = chart.getDataVisibility(i) ? scale.getDistanceFromCenterForValue(this.getParsed(i).r) : 0;
                angle = endAngle;
                if (reset) {
                    if (animationOpts.animateScale) {
                        outerRadius = 0;
                    }
                    if (animationOpts.animateRotate) {
                        startAngle = endAngle = datasetStartAngle;
                    }
                }
                const properties = {
                    x: centerX,
                    y: centerY,
                    innerRadius: 0,
                    outerRadius,
                    startAngle,
                    endAngle,
                    options: this.resolveDataElementOptions(i, arc.active ? 'active' : mode)
                };
                this.updateElement(arc, i, properties, mode);
            }
        }
        countVisibleElements() {
            const meta = this._cachedMeta;
            let count = 0;
            meta.data.forEach((element, index)=>{
                if (!isNaN(this.getParsed(index).r) && this.chart.getDataVisibility(index)) {
                    count++;
                }
            });
            return count;
        }
     _computeAngle(index, mode, defaultAngle) {
            return this.chart.getDataVisibility(index) ? toRadians(this.resolveDataElementOptions(index, mode).angle || defaultAngle) : 0;
        }
    }

    class PieController extends DoughnutController {
        static id = 'pie';
     static defaults = {
            cutout: 0,
            rotation: 0,
            circumference: 360,
            radius: '100%'
        };
    }

    class RadarController extends DatasetController {
        static id = 'radar';
     static defaults = {
            datasetElementType: 'line',
            dataElementType: 'point',
            indexAxis: 'r',
            showLine: true,
            elements: {
                line: {
                    fill: 'start'
                }
            }
        };
     static overrides = {
            aspectRatio: 1,
            scales: {
                r: {
                    type: 'radialLinear'
                }
            }
        };
     getLabelAndValue(index) {
            const vScale = this._cachedMeta.vScale;
            const parsed = this.getParsed(index);
            return {
                label: vScale.getLabels()[index],
                value: '' + vScale.getLabelForValue(parsed[vScale.axis])
            };
        }
        parseObjectData(meta, data, start, count) {
            return _parseObjectDataRadialScale.bind(this)(meta, data, start, count);
        }
        update(mode) {
            const meta = this._cachedMeta;
            const line = meta.dataset;
            const points = meta.data || [];
            const labels = meta.iScale.getLabels();
            line.points = points;
            if (mode !== 'resize') {
                const options = this.resolveDatasetElementOptions(mode);
                if (!this.options.showLine) {
                    options.borderWidth = 0;
                }
                const properties = {
                    _loop: true,
                    _fullLoop: labels.length === points.length,
                    options
                };
                this.updateElement(line, undefined, properties, mode);
            }
            this.updateElements(points, 0, points.length, mode);
        }
        updateElements(points, start, count, mode) {
            const scale = this._cachedMeta.rScale;
            const reset = mode === 'reset';
            for(let i = start; i < start + count; i++){
                const point = points[i];
                const options = this.resolveDataElementOptions(i, point.active ? 'active' : mode);
                const pointPosition = scale.getPointPositionForValue(i, this.getParsed(i).r);
                const x = reset ? scale.xCenter : pointPosition.x;
                const y = reset ? scale.yCenter : pointPosition.y;
                const properties = {
                    x,
                    y,
                    angle: pointPosition.angle,
                    skip: isNaN(x) || isNaN(y),
                    options
                };
                this.updateElement(point, i, properties, mode);
            }
        }
    }

    class ScatterController extends DatasetController {
        static id = 'scatter';
     static defaults = {
            datasetElementType: false,
            dataElementType: 'point',
            showLine: false,
            fill: false
        };
     static overrides = {
            interaction: {
                mode: 'point'
            },
            scales: {
                x: {
                    type: 'linear'
                },
                y: {
                    type: 'linear'
                }
            }
        };
     getLabelAndValue(index) {
            const meta = this._cachedMeta;
            const labels = this.chart.data.labels || [];
            const { xScale , yScale  } = meta;
            const parsed = this.getParsed(index);
            const x = xScale.getLabelForValue(parsed.x);
            const y = yScale.getLabelForValue(parsed.y);
            return {
                label: labels[index] || '',
                value: '(' + x + ', ' + y + ')'
            };
        }
        update(mode) {
            const meta = this._cachedMeta;
            const { data: points = []  } = meta;
            const animationsDisabled = this.chart._animationsDisabled;
            let { start , count  } = _getStartAndCountOfVisiblePoints(meta, points, animationsDisabled);
            this._drawStart = start;
            this._drawCount = count;
            if (_scaleRangesChanged(meta)) {
                start = 0;
                count = points.length;
            }
            if (this.options.showLine) {
                if (!this.datasetElementType) {
                    this.addElements();
                }
                const { dataset: line , _dataset  } = meta;
                line._chart = this.chart;
                line._datasetIndex = this.index;
                line._decimated = !!_dataset._decimated;
                line.points = points;
                const options = this.resolveDatasetElementOptions(mode);
                options.segment = this.options.segment;
                this.updateElement(line, undefined, {
                    animated: !animationsDisabled,
                    options
                }, mode);
            } else if (this.datasetElementType) {
                delete meta.dataset;
                this.datasetElementType = false;
            }
            this.updateElements(points, start, count, mode);
        }
        addElements() {
            const { showLine  } = this.options;
            if (!this.datasetElementType && showLine) {
                this.datasetElementType = this.chart.registry.getElement('line');
            }
            super.addElements();
        }
        updateElements(points, start, count, mode) {
            const reset = mode === 'reset';
            const { iScale , vScale , _stacked , _dataset  } = this._cachedMeta;
            const firstOpts = this.resolveDataElementOptions(start, mode);
            const sharedOptions = this.getSharedOptions(firstOpts);
            const includeOptions = this.includeOptions(mode, sharedOptions);
            const iAxis = iScale.axis;
            const vAxis = vScale.axis;
            const { spanGaps , segment  } = this.options;
            const maxGapLength = isNumber(spanGaps) ? spanGaps : Number.POSITIVE_INFINITY;
            const directUpdate = this.chart._animationsDisabled || reset || mode === 'none';
            let prevParsed = start > 0 && this.getParsed(start - 1);
            for(let i = start; i < start + count; ++i){
                const point = points[i];
                const parsed = this.getParsed(i);
                const properties = directUpdate ? point : {};
                const nullData = isNullOrUndef(parsed[vAxis]);
                const iPixel = properties[iAxis] = iScale.getPixelForValue(parsed[iAxis], i);
                const vPixel = properties[vAxis] = reset || nullData ? vScale.getBasePixel() : vScale.getPixelForValue(_stacked ? this.applyStack(vScale, parsed, _stacked) : parsed[vAxis], i);
                properties.skip = isNaN(iPixel) || isNaN(vPixel) || nullData;
                properties.stop = i > 0 && Math.abs(parsed[iAxis] - prevParsed[iAxis]) > maxGapLength;
                if (segment) {
                    properties.parsed = parsed;
                    properties.raw = _dataset.data[i];
                }
                if (includeOptions) {
                    properties.options = sharedOptions || this.resolveDataElementOptions(i, point.active ? 'active' : mode);
                }
                if (!directUpdate) {
                    this.updateElement(point, i, properties, mode);
                }
                prevParsed = parsed;
            }
            this.updateSharedOptions(sharedOptions, mode, firstOpts);
        }
     getMaxOverflow() {
            const meta = this._cachedMeta;
            const data = meta.data || [];
            if (!this.options.showLine) {
                let max = 0;
                for(let i = data.length - 1; i >= 0; --i){
                    max = Math.max(max, data[i].size(this.resolveDataElementOptions(i)) / 2);
                }
                return max > 0 && max;
            }
            const dataset = meta.dataset;
            const border = dataset.options && dataset.options.borderWidth || 0;
            if (!data.length) {
                return border;
            }
            const firstPoint = data[0].size(this.resolveDataElementOptions(0));
            const lastPoint = data[data.length - 1].size(this.resolveDataElementOptions(data.length - 1));
            return Math.max(border, firstPoint, lastPoint) / 2;
        }
    }

    var controllers = /*#__PURE__*/Object.freeze({
    __proto__: null,
    BarController: BarController,
    BubbleController: BubbleController,
    DoughnutController: DoughnutController,
    LineController: LineController,
    PieController: PieController,
    PolarAreaController: PolarAreaController,
    RadarController: RadarController,
    ScatterController: ScatterController
    });

    /**
     * @namespace Chart._adapters
     * @since 2.8.0
     * @private
     */ function abstract() {
        throw new Error('This method is not implemented: Check that a complete date adapter is provided.');
    }
    /**
     * Date adapter (current used by the time scale)
     * @namespace Chart._adapters._date
     * @memberof Chart._adapters
     * @private
     */ class DateAdapterBase {
        /**
       * Override default date adapter methods.
       * Accepts type parameter to define options type.
       * @example
       * Chart._adapters._date.override<{myAdapterOption: string}>({
       *   init() {
       *     console.log(this.options.myAdapterOption);
       *   }
       * })
       */ static override(members) {
            Object.assign(DateAdapterBase.prototype, members);
        }
        options;
        constructor(options){
            this.options = options || {};
        }
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        init() {}
        formats() {
            return abstract();
        }
        parse() {
            return abstract();
        }
        format() {
            return abstract();
        }
        add() {
            return abstract();
        }
        diff() {
            return abstract();
        }
        startOf() {
            return abstract();
        }
        endOf() {
            return abstract();
        }
    }
    var adapters = {
        _date: DateAdapterBase
    };

    function binarySearch(metaset, axis, value, intersect) {
        const { controller , data , _sorted  } = metaset;
        const iScale = controller._cachedMeta.iScale;
        const spanGaps = metaset.dataset ? metaset.dataset.options ? metaset.dataset.options.spanGaps : null : null;
        if (iScale && axis === iScale.axis && axis !== 'r' && _sorted && data.length) {
            const lookupMethod = iScale._reversePixels ? _rlookupByKey : _lookupByKey;
            if (!intersect) {
                const result = lookupMethod(data, axis, value);
                if (spanGaps) {
                    const { vScale  } = controller._cachedMeta;
                    const { _parsed  } = metaset;
                    const distanceToDefinedLo = _parsed.slice(0, result.lo + 1).reverse().findIndex((point)=>!isNullOrUndef(point[vScale.axis]));
                    result.lo -= Math.max(0, distanceToDefinedLo);
                    const distanceToDefinedHi = _parsed.slice(result.hi).findIndex((point)=>!isNullOrUndef(point[vScale.axis]));
                    result.hi += Math.max(0, distanceToDefinedHi);
                }
                return result;
            } else if (controller._sharedOptions) {
                const el = data[0];
                const range = typeof el.getRange === 'function' && el.getRange(axis);
                if (range) {
                    const start = lookupMethod(data, axis, value - range);
                    const end = lookupMethod(data, axis, value + range);
                    return {
                        lo: start.lo,
                        hi: end.hi
                    };
                }
            }
        }
        return {
            lo: 0,
            hi: data.length - 1
        };
    }
     function evaluateInteractionItems(chart, axis, position, handler, intersect) {
        const metasets = chart.getSortedVisibleDatasetMetas();
        const value = position[axis];
        for(let i = 0, ilen = metasets.length; i < ilen; ++i){
            const { index , data  } = metasets[i];
            const { lo , hi  } = binarySearch(metasets[i], axis, value, intersect);
            for(let j = lo; j <= hi; ++j){
                const element = data[j];
                if (!element.skip) {
                    handler(element, index, j);
                }
            }
        }
    }
     function getDistanceMetricForAxis(axis) {
        const useX = axis.indexOf('x') !== -1;
        const useY = axis.indexOf('y') !== -1;
        return function(pt1, pt2) {
            const deltaX = useX ? Math.abs(pt1.x - pt2.x) : 0;
            const deltaY = useY ? Math.abs(pt1.y - pt2.y) : 0;
            return Math.sqrt(Math.pow(deltaX, 2) + Math.pow(deltaY, 2));
        };
    }
     function getIntersectItems(chart, position, axis, useFinalPosition, includeInvisible) {
        const items = [];
        if (!includeInvisible && !chart.isPointInArea(position)) {
            return items;
        }
        const evaluationFunc = function(element, datasetIndex, index) {
            if (!includeInvisible && !_isPointInArea(element, chart.chartArea, 0)) {
                return;
            }
            if (element.inRange(position.x, position.y, useFinalPosition)) {
                items.push({
                    element,
                    datasetIndex,
                    index
                });
            }
        };
        evaluateInteractionItems(chart, axis, position, evaluationFunc, true);
        return items;
    }
     function getNearestRadialItems(chart, position, axis, useFinalPosition) {
        let items = [];
        function evaluationFunc(element, datasetIndex, index) {
            const { startAngle , endAngle  } = element.getProps([
                'startAngle',
                'endAngle'
            ], useFinalPosition);
            const { angle  } = getAngleFromPoint(element, {
                x: position.x,
                y: position.y
            });
            if (_angleBetween(angle, startAngle, endAngle)) {
                items.push({
                    element,
                    datasetIndex,
                    index
                });
            }
        }
        evaluateInteractionItems(chart, axis, position, evaluationFunc);
        return items;
    }
     function getNearestCartesianItems(chart, position, axis, intersect, useFinalPosition, includeInvisible) {
        let items = [];
        const distanceMetric = getDistanceMetricForAxis(axis);
        let minDistance = Number.POSITIVE_INFINITY;
        function evaluationFunc(element, datasetIndex, index) {
            const inRange = element.inRange(position.x, position.y, useFinalPosition);
            if (intersect && !inRange) {
                return;
            }
            const center = element.getCenterPoint(useFinalPosition);
            const pointInArea = !!includeInvisible || chart.isPointInArea(center);
            if (!pointInArea && !inRange) {
                return;
            }
            const distance = distanceMetric(position, center);
            if (distance < minDistance) {
                items = [
                    {
                        element,
                        datasetIndex,
                        index
                    }
                ];
                minDistance = distance;
            } else if (distance === minDistance) {
                items.push({
                    element,
                    datasetIndex,
                    index
                });
            }
        }
        evaluateInteractionItems(chart, axis, position, evaluationFunc);
        return items;
    }
     function getNearestItems(chart, position, axis, intersect, useFinalPosition, includeInvisible) {
        if (!includeInvisible && !chart.isPointInArea(position)) {
            return [];
        }
        return axis === 'r' && !intersect ? getNearestRadialItems(chart, position, axis, useFinalPosition) : getNearestCartesianItems(chart, position, axis, intersect, useFinalPosition, includeInvisible);
    }
     function getAxisItems(chart, position, axis, intersect, useFinalPosition) {
        const items = [];
        const rangeMethod = axis === 'x' ? 'inXRange' : 'inYRange';
        let intersectsItem = false;
        evaluateInteractionItems(chart, axis, position, (element, datasetIndex, index)=>{
            if (element[rangeMethod] && element[rangeMethod](position[axis], useFinalPosition)) {
                items.push({
                    element,
                    datasetIndex,
                    index
                });
                intersectsItem = intersectsItem || element.inRange(position.x, position.y, useFinalPosition);
            }
        });
        if (intersect && !intersectsItem) {
            return [];
        }
        return items;
    }
     var Interaction = {
        modes: {
     index (chart, e, options, useFinalPosition) {
                const position = getRelativePosition(e, chart);
                const axis = options.axis || 'x';
                const includeInvisible = options.includeInvisible || false;
                const items = options.intersect ? getIntersectItems(chart, position, axis, useFinalPosition, includeInvisible) : getNearestItems(chart, position, axis, false, useFinalPosition, includeInvisible);
                const elements = [];
                if (!items.length) {
                    return [];
                }
                chart.getSortedVisibleDatasetMetas().forEach((meta)=>{
                    const index = items[0].index;
                    const element = meta.data[index];
                    if (element && !element.skip) {
                        elements.push({
                            element,
                            datasetIndex: meta.index,
                            index
                        });
                    }
                });
                return elements;
            },
     dataset (chart, e, options, useFinalPosition) {
                const position = getRelativePosition(e, chart);
                const axis = options.axis || 'xy';
                const includeInvisible = options.includeInvisible || false;
                let items = options.intersect ? getIntersectItems(chart, position, axis, useFinalPosition, includeInvisible) : getNearestItems(chart, position, axis, false, useFinalPosition, includeInvisible);
                if (items.length > 0) {
                    const datasetIndex = items[0].datasetIndex;
                    const data = chart.getDatasetMeta(datasetIndex).data;
                    items = [];
                    for(let i = 0; i < data.length; ++i){
                        items.push({
                            element: data[i],
                            datasetIndex,
                            index: i
                        });
                    }
                }
                return items;
            },
     point (chart, e, options, useFinalPosition) {
                const position = getRelativePosition(e, chart);
                const axis = options.axis || 'xy';
                const includeInvisible = options.includeInvisible || false;
                return getIntersectItems(chart, position, axis, useFinalPosition, includeInvisible);
            },
     nearest (chart, e, options, useFinalPosition) {
                const position = getRelativePosition(e, chart);
                const axis = options.axis || 'xy';
                const includeInvisible = options.includeInvisible || false;
                return getNearestItems(chart, position, axis, options.intersect, useFinalPosition, includeInvisible);
            },
     x (chart, e, options, useFinalPosition) {
                const position = getRelativePosition(e, chart);
                return getAxisItems(chart, position, 'x', options.intersect, useFinalPosition);
            },
     y (chart, e, options, useFinalPosition) {
                const position = getRelativePosition(e, chart);
                return getAxisItems(chart, position, 'y', options.intersect, useFinalPosition);
            }
        }
    };

    const STATIC_POSITIONS = [
        'left',
        'top',
        'right',
        'bottom'
    ];
    function filterByPosition(array, position) {
        return array.filter((v)=>v.pos === position);
    }
    function filterDynamicPositionByAxis(array, axis) {
        return array.filter((v)=>STATIC_POSITIONS.indexOf(v.pos) === -1 && v.box.axis === axis);
    }
    function sortByWeight(array, reverse) {
        return array.sort((a, b)=>{
            const v0 = reverse ? b : a;
            const v1 = reverse ? a : b;
            return v0.weight === v1.weight ? v0.index - v1.index : v0.weight - v1.weight;
        });
    }
    function wrapBoxes(boxes) {
        const layoutBoxes = [];
        let i, ilen, box, pos, stack, stackWeight;
        for(i = 0, ilen = (boxes || []).length; i < ilen; ++i){
            box = boxes[i];
            ({ position: pos , options: { stack , stackWeight =1  }  } = box);
            layoutBoxes.push({
                index: i,
                box,
                pos,
                horizontal: box.isHorizontal(),
                weight: box.weight,
                stack: stack && pos + stack,
                stackWeight
            });
        }
        return layoutBoxes;
    }
    function buildStacks(layouts) {
        const stacks = {};
        for (const wrap of layouts){
            const { stack , pos , stackWeight  } = wrap;
            if (!stack || !STATIC_POSITIONS.includes(pos)) {
                continue;
            }
            const _stack = stacks[stack] || (stacks[stack] = {
                count: 0,
                placed: 0,
                weight: 0,
                size: 0
            });
            _stack.count++;
            _stack.weight += stackWeight;
        }
        return stacks;
    }
     function setLayoutDims(layouts, params) {
        const stacks = buildStacks(layouts);
        const { vBoxMaxWidth , hBoxMaxHeight  } = params;
        let i, ilen, layout;
        for(i = 0, ilen = layouts.length; i < ilen; ++i){
            layout = layouts[i];
            const { fullSize  } = layout.box;
            const stack = stacks[layout.stack];
            const factor = stack && layout.stackWeight / stack.weight;
            if (layout.horizontal) {
                layout.width = factor ? factor * vBoxMaxWidth : fullSize && params.availableWidth;
                layout.height = hBoxMaxHeight;
            } else {
                layout.width = vBoxMaxWidth;
                layout.height = factor ? factor * hBoxMaxHeight : fullSize && params.availableHeight;
            }
        }
        return stacks;
    }
    function buildLayoutBoxes(boxes) {
        const layoutBoxes = wrapBoxes(boxes);
        const fullSize = sortByWeight(layoutBoxes.filter((wrap)=>wrap.box.fullSize), true);
        const left = sortByWeight(filterByPosition(layoutBoxes, 'left'), true);
        const right = sortByWeight(filterByPosition(layoutBoxes, 'right'));
        const top = sortByWeight(filterByPosition(layoutBoxes, 'top'), true);
        const bottom = sortByWeight(filterByPosition(layoutBoxes, 'bottom'));
        const centerHorizontal = filterDynamicPositionByAxis(layoutBoxes, 'x');
        const centerVertical = filterDynamicPositionByAxis(layoutBoxes, 'y');
        return {
            fullSize,
            leftAndTop: left.concat(top),
            rightAndBottom: right.concat(centerVertical).concat(bottom).concat(centerHorizontal),
            chartArea: filterByPosition(layoutBoxes, 'chartArea'),
            vertical: left.concat(right).concat(centerVertical),
            horizontal: top.concat(bottom).concat(centerHorizontal)
        };
    }
    function getCombinedMax(maxPadding, chartArea, a, b) {
        return Math.max(maxPadding[a], chartArea[a]) + Math.max(maxPadding[b], chartArea[b]);
    }
    function updateMaxPadding(maxPadding, boxPadding) {
        maxPadding.top = Math.max(maxPadding.top, boxPadding.top);
        maxPadding.left = Math.max(maxPadding.left, boxPadding.left);
        maxPadding.bottom = Math.max(maxPadding.bottom, boxPadding.bottom);
        maxPadding.right = Math.max(maxPadding.right, boxPadding.right);
    }
    function updateDims(chartArea, params, layout, stacks) {
        const { pos , box  } = layout;
        const maxPadding = chartArea.maxPadding;
        if (!isObject(pos)) {
            if (layout.size) {
                chartArea[pos] -= layout.size;
            }
            const stack = stacks[layout.stack] || {
                size: 0,
                count: 1
            };
            stack.size = Math.max(stack.size, layout.horizontal ? box.height : box.width);
            layout.size = stack.size / stack.count;
            chartArea[pos] += layout.size;
        }
        if (box.getPadding) {
            updateMaxPadding(maxPadding, box.getPadding());
        }
        const newWidth = Math.max(0, params.outerWidth - getCombinedMax(maxPadding, chartArea, 'left', 'right'));
        const newHeight = Math.max(0, params.outerHeight - getCombinedMax(maxPadding, chartArea, 'top', 'bottom'));
        const widthChanged = newWidth !== chartArea.w;
        const heightChanged = newHeight !== chartArea.h;
        chartArea.w = newWidth;
        chartArea.h = newHeight;
        return layout.horizontal ? {
            same: widthChanged,
            other: heightChanged
        } : {
            same: heightChanged,
            other: widthChanged
        };
    }
    function handleMaxPadding(chartArea) {
        const maxPadding = chartArea.maxPadding;
        function updatePos(pos) {
            const change = Math.max(maxPadding[pos] - chartArea[pos], 0);
            chartArea[pos] += change;
            return change;
        }
        chartArea.y += updatePos('top');
        chartArea.x += updatePos('left');
        updatePos('right');
        updatePos('bottom');
    }
    function getMargins(horizontal, chartArea) {
        const maxPadding = chartArea.maxPadding;
        function marginForPositions(positions) {
            const margin = {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0
            };
            positions.forEach((pos)=>{
                margin[pos] = Math.max(chartArea[pos], maxPadding[pos]);
            });
            return margin;
        }
        return horizontal ? marginForPositions([
            'left',
            'right'
        ]) : marginForPositions([
            'top',
            'bottom'
        ]);
    }
    function fitBoxes(boxes, chartArea, params, stacks) {
        const refitBoxes = [];
        let i, ilen, layout, box, refit, changed;
        for(i = 0, ilen = boxes.length, refit = 0; i < ilen; ++i){
            layout = boxes[i];
            box = layout.box;
            box.update(layout.width || chartArea.w, layout.height || chartArea.h, getMargins(layout.horizontal, chartArea));
            const { same , other  } = updateDims(chartArea, params, layout, stacks);
            refit |= same && refitBoxes.length;
            changed = changed || other;
            if (!box.fullSize) {
                refitBoxes.push(layout);
            }
        }
        return refit && fitBoxes(refitBoxes, chartArea, params, stacks) || changed;
    }
    function setBoxDims(box, left, top, width, height) {
        box.top = top;
        box.left = left;
        box.right = left + width;
        box.bottom = top + height;
        box.width = width;
        box.height = height;
    }
    function placeBoxes(boxes, chartArea, params, stacks) {
        const userPadding = params.padding;
        let { x , y  } = chartArea;
        for (const layout of boxes){
            const box = layout.box;
            const stack = stacks[layout.stack] || {
                placed: 0,
                weight: 1
            };
            const weight = layout.stackWeight / stack.weight || 1;
            if (layout.horizontal) {
                const width = chartArea.w * weight;
                const height = stack.size || box.height;
                if (defined(stack.start)) {
                    y = stack.start;
                }
                if (box.fullSize) {
                    setBoxDims(box, userPadding.left, y, params.outerWidth - userPadding.right - userPadding.left, height);
                } else {
                    setBoxDims(box, chartArea.left + stack.placed, y, width, height);
                }
                stack.start = y;
                stack.placed += width;
                y = box.bottom;
            } else {
                const height = chartArea.h * weight;
                const width = stack.size || box.width;
                if (defined(stack.start)) {
                    x = stack.start;
                }
                if (box.fullSize) {
                    setBoxDims(box, x, userPadding.top, width, params.outerHeight - userPadding.bottom - userPadding.top);
                } else {
                    setBoxDims(box, x, chartArea.top + stack.placed, width, height);
                }
                stack.start = x;
                stack.placed += height;
                x = box.right;
            }
        }
        chartArea.x = x;
        chartArea.y = y;
    }
    var layouts = {
     addBox (chart, item) {
            if (!chart.boxes) {
                chart.boxes = [];
            }
            item.fullSize = item.fullSize || false;
            item.position = item.position || 'top';
            item.weight = item.weight || 0;
            item._layers = item._layers || function() {
                return [
                    {
                        z: 0,
                        draw (chartArea) {
                            item.draw(chartArea);
                        }
                    }
                ];
            };
            chart.boxes.push(item);
        },
     removeBox (chart, layoutItem) {
            const index = chart.boxes ? chart.boxes.indexOf(layoutItem) : -1;
            if (index !== -1) {
                chart.boxes.splice(index, 1);
            }
        },
     configure (chart, item, options) {
            item.fullSize = options.fullSize;
            item.position = options.position;
            item.weight = options.weight;
        },
     update (chart, width, height, minPadding) {
            if (!chart) {
                return;
            }
            const padding = toPadding(chart.options.layout.padding);
            const availableWidth = Math.max(width - padding.width, 0);
            const availableHeight = Math.max(height - padding.height, 0);
            const boxes = buildLayoutBoxes(chart.boxes);
            const verticalBoxes = boxes.vertical;
            const horizontalBoxes = boxes.horizontal;
            each(chart.boxes, (box)=>{
                if (typeof box.beforeLayout === 'function') {
                    box.beforeLayout();
                }
            });
            const visibleVerticalBoxCount = verticalBoxes.reduce((total, wrap)=>wrap.box.options && wrap.box.options.display === false ? total : total + 1, 0) || 1;
            const params = Object.freeze({
                outerWidth: width,
                outerHeight: height,
                padding,
                availableWidth,
                availableHeight,
                vBoxMaxWidth: availableWidth / 2 / visibleVerticalBoxCount,
                hBoxMaxHeight: availableHeight / 2
            });
            const maxPadding = Object.assign({}, padding);
            updateMaxPadding(maxPadding, toPadding(minPadding));
            const chartArea = Object.assign({
                maxPadding,
                w: availableWidth,
                h: availableHeight,
                x: padding.left,
                y: padding.top
            }, padding);
            const stacks = setLayoutDims(verticalBoxes.concat(horizontalBoxes), params);
            fitBoxes(boxes.fullSize, chartArea, params, stacks);
            fitBoxes(verticalBoxes, chartArea, params, stacks);
            if (fitBoxes(horizontalBoxes, chartArea, params, stacks)) {
                fitBoxes(verticalBoxes, chartArea, params, stacks);
            }
            handleMaxPadding(chartArea);
            placeBoxes(boxes.leftAndTop, chartArea, params, stacks);
            chartArea.x += chartArea.w;
            chartArea.y += chartArea.h;
            placeBoxes(boxes.rightAndBottom, chartArea, params, stacks);
            chart.chartArea = {
                left: chartArea.left,
                top: chartArea.top,
                right: chartArea.left + chartArea.w,
                bottom: chartArea.top + chartArea.h,
                height: chartArea.h,
                width: chartArea.w
            };
            each(boxes.chartArea, (layout)=>{
                const box = layout.box;
                Object.assign(box, chart.chartArea);
                box.update(chartArea.w, chartArea.h, {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0
                });
            });
        }
    };

    class BasePlatform {
     acquireContext(canvas, aspectRatio) {}
     releaseContext(context) {
            return false;
        }
     addEventListener(chart, type, listener) {}
     removeEventListener(chart, type, listener) {}
     getDevicePixelRatio() {
            return 1;
        }
     getMaximumSize(element, width, height, aspectRatio) {
            width = Math.max(0, width || element.width);
            height = height || element.height;
            return {
                width,
                height: Math.max(0, aspectRatio ? Math.floor(width / aspectRatio) : height)
            };
        }
     isAttached(canvas) {
            return true;
        }
     updateConfig(config) {
        }
    }

    class BasicPlatform extends BasePlatform {
        acquireContext(item) {
            return item && item.getContext && item.getContext('2d') || null;
        }
        updateConfig(config) {
            config.options.animation = false;
        }
    }

    const EXPANDO_KEY = '$chartjs';
     const EVENT_TYPES = {
        touchstart: 'mousedown',
        touchmove: 'mousemove',
        touchend: 'mouseup',
        pointerenter: 'mouseenter',
        pointerdown: 'mousedown',
        pointermove: 'mousemove',
        pointerup: 'mouseup',
        pointerleave: 'mouseout',
        pointerout: 'mouseout'
    };
    const isNullOrEmpty = (value)=>value === null || value === '';
     function initCanvas(canvas, aspectRatio) {
        const style = canvas.style;
        const renderHeight = canvas.getAttribute('height');
        const renderWidth = canvas.getAttribute('width');
        canvas[EXPANDO_KEY] = {
            initial: {
                height: renderHeight,
                width: renderWidth,
                style: {
                    display: style.display,
                    height: style.height,
                    width: style.width
                }
            }
        };
        style.display = style.display || 'block';
        style.boxSizing = style.boxSizing || 'border-box';
        if (isNullOrEmpty(renderWidth)) {
            const displayWidth = readUsedSize(canvas, 'width');
            if (displayWidth !== undefined) {
                canvas.width = displayWidth;
            }
        }
        if (isNullOrEmpty(renderHeight)) {
            if (canvas.style.height === '') {
                canvas.height = canvas.width / (aspectRatio || 2);
            } else {
                const displayHeight = readUsedSize(canvas, 'height');
                if (displayHeight !== undefined) {
                    canvas.height = displayHeight;
                }
            }
        }
        return canvas;
    }
    const eventListenerOptions = supportsEventListenerOptions ? {
        passive: true
    } : false;
    function addListener(node, type, listener) {
        if (node) {
            node.addEventListener(type, listener, eventListenerOptions);
        }
    }
    function removeListener(chart, type, listener) {
        if (chart && chart.canvas) {
            chart.canvas.removeEventListener(type, listener, eventListenerOptions);
        }
    }
    function fromNativeEvent(event, chart) {
        const type = EVENT_TYPES[event.type] || event.type;
        const { x , y  } = getRelativePosition(event, chart);
        return {
            type,
            chart,
            native: event,
            x: x !== undefined ? x : null,
            y: y !== undefined ? y : null
        };
    }
    function nodeListContains(nodeList, canvas) {
        for (const node of nodeList){
            if (node === canvas || node.contains(canvas)) {
                return true;
            }
        }
    }
    function createAttachObserver(chart, type, listener) {
        const canvas = chart.canvas;
        const observer = new MutationObserver((entries)=>{
            let trigger = false;
            for (const entry of entries){
                trigger = trigger || nodeListContains(entry.addedNodes, canvas);
                trigger = trigger && !nodeListContains(entry.removedNodes, canvas);
            }
            if (trigger) {
                listener();
            }
        });
        observer.observe(document, {
            childList: true,
            subtree: true
        });
        return observer;
    }
    function createDetachObserver(chart, type, listener) {
        const canvas = chart.canvas;
        const observer = new MutationObserver((entries)=>{
            let trigger = false;
            for (const entry of entries){
                trigger = trigger || nodeListContains(entry.removedNodes, canvas);
                trigger = trigger && !nodeListContains(entry.addedNodes, canvas);
            }
            if (trigger) {
                listener();
            }
        });
        observer.observe(document, {
            childList: true,
            subtree: true
        });
        return observer;
    }
    const drpListeningCharts = new Map();
    let oldDevicePixelRatio = 0;
    function onWindowResize() {
        const dpr = window.devicePixelRatio;
        if (dpr === oldDevicePixelRatio) {
            return;
        }
        oldDevicePixelRatio = dpr;
        drpListeningCharts.forEach((resize, chart)=>{
            if (chart.currentDevicePixelRatio !== dpr) {
                resize();
            }
        });
    }
    function listenDevicePixelRatioChanges(chart, resize) {
        if (!drpListeningCharts.size) {
            window.addEventListener('resize', onWindowResize);
        }
        drpListeningCharts.set(chart, resize);
    }
    function unlistenDevicePixelRatioChanges(chart) {
        drpListeningCharts.delete(chart);
        if (!drpListeningCharts.size) {
            window.removeEventListener('resize', onWindowResize);
        }
    }
    function createResizeObserver(chart, type, listener) {
        const canvas = chart.canvas;
        const container = canvas && _getParentNode(canvas);
        if (!container) {
            return;
        }
        const resize = throttled((width, height)=>{
            const w = container.clientWidth;
            listener(width, height);
            if (w < container.clientWidth) {
                listener();
            }
        }, window);
        const observer = new ResizeObserver((entries)=>{
            const entry = entries[0];
            const width = entry.contentRect.width;
            const height = entry.contentRect.height;
            if (width === 0 && height === 0) {
                return;
            }
            resize(width, height);
        });
        observer.observe(container);
        listenDevicePixelRatioChanges(chart, resize);
        return observer;
    }
    function releaseObserver(chart, type, observer) {
        if (observer) {
            observer.disconnect();
        }
        if (type === 'resize') {
            unlistenDevicePixelRatioChanges(chart);
        }
    }
    function createProxyAndListen(chart, type, listener) {
        const canvas = chart.canvas;
        const proxy = throttled((event)=>{
            if (chart.ctx !== null) {
                listener(fromNativeEvent(event, chart));
            }
        }, chart);
        addListener(canvas, type, proxy);
        return proxy;
    }
     class DomPlatform extends BasePlatform {
     acquireContext(canvas, aspectRatio) {
            const context = canvas && canvas.getContext && canvas.getContext('2d');
            if (context && context.canvas === canvas) {
                initCanvas(canvas, aspectRatio);
                return context;
            }
            return null;
        }
     releaseContext(context) {
            const canvas = context.canvas;
            if (!canvas[EXPANDO_KEY]) {
                return false;
            }
            const initial = canvas[EXPANDO_KEY].initial;
            [
                'height',
                'width'
            ].forEach((prop)=>{
                const value = initial[prop];
                if (isNullOrUndef(value)) {
                    canvas.removeAttribute(prop);
                } else {
                    canvas.setAttribute(prop, value);
                }
            });
            const style = initial.style || {};
            Object.keys(style).forEach((key)=>{
                canvas.style[key] = style[key];
            });
            canvas.width = canvas.width;
            delete canvas[EXPANDO_KEY];
            return true;
        }
     addEventListener(chart, type, listener) {
            this.removeEventListener(chart, type);
            const proxies = chart.$proxies || (chart.$proxies = {});
            const handlers = {
                attach: createAttachObserver,
                detach: createDetachObserver,
                resize: createResizeObserver
            };
            const handler = handlers[type] || createProxyAndListen;
            proxies[type] = handler(chart, type, listener);
        }
     removeEventListener(chart, type) {
            const proxies = chart.$proxies || (chart.$proxies = {});
            const proxy = proxies[type];
            if (!proxy) {
                return;
            }
            const handlers = {
                attach: releaseObserver,
                detach: releaseObserver,
                resize: releaseObserver
            };
            const handler = handlers[type] || removeListener;
            handler(chart, type, proxy);
            proxies[type] = undefined;
        }
        getDevicePixelRatio() {
            return window.devicePixelRatio;
        }
     getMaximumSize(canvas, width, height, aspectRatio) {
            return getMaximumSize(canvas, width, height, aspectRatio);
        }
     isAttached(canvas) {
            const container = canvas && _getParentNode(canvas);
            return !!(container && container.isConnected);
        }
    }

    function _detectPlatform(canvas) {
        if (!_isDomSupported() || typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
            return BasicPlatform;
        }
        return DomPlatform;
    }

    class Element {
        static defaults = {};
        static defaultRoutes = undefined;
        x;
        y;
        active = false;
        options;
        $animations;
        tooltipPosition(useFinalPosition) {
            const { x , y  } = this.getProps([
                'x',
                'y'
            ], useFinalPosition);
            return {
                x,
                y
            };
        }
        hasValue() {
            return isNumber(this.x) && isNumber(this.y);
        }
        getProps(props, final) {
            const anims = this.$animations;
            if (!final || !anims) {
                // let's not create an object, if not needed
                return this;
            }
            const ret = {};
            props.forEach((prop)=>{
                ret[prop] = anims[prop] && anims[prop].active() ? anims[prop]._to : this[prop];
            });
            return ret;
        }
    }

    function autoSkip(scale, ticks) {
        const tickOpts = scale.options.ticks;
        const determinedMaxTicks = determineMaxTicks(scale);
        const ticksLimit = Math.min(tickOpts.maxTicksLimit || determinedMaxTicks, determinedMaxTicks);
        const majorIndices = tickOpts.major.enabled ? getMajorIndices(ticks) : [];
        const numMajorIndices = majorIndices.length;
        const first = majorIndices[0];
        const last = majorIndices[numMajorIndices - 1];
        const newTicks = [];
        if (numMajorIndices > ticksLimit) {
            skipMajors(ticks, newTicks, majorIndices, numMajorIndices / ticksLimit);
            return newTicks;
        }
        const spacing = calculateSpacing(majorIndices, ticks, ticksLimit);
        if (numMajorIndices > 0) {
            let i, ilen;
            const avgMajorSpacing = numMajorIndices > 1 ? Math.round((last - first) / (numMajorIndices - 1)) : null;
            skip(ticks, newTicks, spacing, isNullOrUndef(avgMajorSpacing) ? 0 : first - avgMajorSpacing, first);
            for(i = 0, ilen = numMajorIndices - 1; i < ilen; i++){
                skip(ticks, newTicks, spacing, majorIndices[i], majorIndices[i + 1]);
            }
            skip(ticks, newTicks, spacing, last, isNullOrUndef(avgMajorSpacing) ? ticks.length : last + avgMajorSpacing);
            return newTicks;
        }
        skip(ticks, newTicks, spacing);
        return newTicks;
    }
    function determineMaxTicks(scale) {
        const offset = scale.options.offset;
        const tickLength = scale._tickSize();
        const maxScale = scale._length / tickLength + (offset ? 0 : 1);
        const maxChart = scale._maxLength / tickLength;
        return Math.floor(Math.min(maxScale, maxChart));
    }
     function calculateSpacing(majorIndices, ticks, ticksLimit) {
        const evenMajorSpacing = getEvenSpacing(majorIndices);
        const spacing = ticks.length / ticksLimit;
        if (!evenMajorSpacing) {
            return Math.max(spacing, 1);
        }
        const factors = _factorize(evenMajorSpacing);
        for(let i = 0, ilen = factors.length - 1; i < ilen; i++){
            const factor = factors[i];
            if (factor > spacing) {
                return factor;
            }
        }
        return Math.max(spacing, 1);
    }
     function getMajorIndices(ticks) {
        const result = [];
        let i, ilen;
        for(i = 0, ilen = ticks.length; i < ilen; i++){
            if (ticks[i].major) {
                result.push(i);
            }
        }
        return result;
    }
     function skipMajors(ticks, newTicks, majorIndices, spacing) {
        let count = 0;
        let next = majorIndices[0];
        let i;
        spacing = Math.ceil(spacing);
        for(i = 0; i < ticks.length; i++){
            if (i === next) {
                newTicks.push(ticks[i]);
                count++;
                next = majorIndices[count * spacing];
            }
        }
    }
     function skip(ticks, newTicks, spacing, majorStart, majorEnd) {
        const start = valueOrDefault(majorStart, 0);
        const end = Math.min(valueOrDefault(majorEnd, ticks.length), ticks.length);
        let count = 0;
        let length, i, next;
        spacing = Math.ceil(spacing);
        if (majorEnd) {
            length = majorEnd - majorStart;
            spacing = length / Math.floor(length / spacing);
        }
        next = start;
        while(next < 0){
            count++;
            next = Math.round(start + count * spacing);
        }
        for(i = Math.max(start, 0); i < end; i++){
            if (i === next) {
                newTicks.push(ticks[i]);
                count++;
                next = Math.round(start + count * spacing);
            }
        }
    }
     function getEvenSpacing(arr) {
        const len = arr.length;
        let i, diff;
        if (len < 2) {
            return false;
        }
        for(diff = arr[0], i = 1; i < len; ++i){
            if (arr[i] - arr[i - 1] !== diff) {
                return false;
            }
        }
        return diff;
    }

    const reverseAlign = (align)=>align === 'left' ? 'right' : align === 'right' ? 'left' : align;
    const offsetFromEdge = (scale, edge, offset)=>edge === 'top' || edge === 'left' ? scale[edge] + offset : scale[edge] - offset;
    const getTicksLimit = (ticksLength, maxTicksLimit)=>Math.min(maxTicksLimit || ticksLength, ticksLength);
     function sample(arr, numItems) {
        const result = [];
        const increment = arr.length / numItems;
        const len = arr.length;
        let i = 0;
        for(; i < len; i += increment){
            result.push(arr[Math.floor(i)]);
        }
        return result;
    }
     function getPixelForGridLine(scale, index, offsetGridLines) {
        const length = scale.ticks.length;
        const validIndex = Math.min(index, length - 1);
        const start = scale._startPixel;
        const end = scale._endPixel;
        const epsilon = 1e-6;
        let lineValue = scale.getPixelForTick(validIndex);
        let offset;
        if (offsetGridLines) {
            if (length === 1) {
                offset = Math.max(lineValue - start, end - lineValue);
            } else if (index === 0) {
                offset = (scale.getPixelForTick(1) - lineValue) / 2;
            } else {
                offset = (lineValue - scale.getPixelForTick(validIndex - 1)) / 2;
            }
            lineValue += validIndex < index ? offset : -offset;
            if (lineValue < start - epsilon || lineValue > end + epsilon) {
                return;
            }
        }
        return lineValue;
    }
     function garbageCollect(caches, length) {
        each(caches, (cache)=>{
            const gc = cache.gc;
            const gcLen = gc.length / 2;
            let i;
            if (gcLen > length) {
                for(i = 0; i < gcLen; ++i){
                    delete cache.data[gc[i]];
                }
                gc.splice(0, gcLen);
            }
        });
    }
     function getTickMarkLength(options) {
        return options.drawTicks ? options.tickLength : 0;
    }
     function getTitleHeight(options, fallback) {
        if (!options.display) {
            return 0;
        }
        const font = toFont(options.font, fallback);
        const padding = toPadding(options.padding);
        const lines = isArray(options.text) ? options.text.length : 1;
        return lines * font.lineHeight + padding.height;
    }
    function createScaleContext(parent, scale) {
        return createContext(parent, {
            scale,
            type: 'scale'
        });
    }
    function createTickContext(parent, index, tick) {
        return createContext(parent, {
            tick,
            index,
            type: 'tick'
        });
    }
    function titleAlign(align, position, reverse) {
         let ret = _toLeftRightCenter(align);
        if (reverse && position !== 'right' || !reverse && position === 'right') {
            ret = reverseAlign(ret);
        }
        return ret;
    }
    function titleArgs(scale, offset, position, align) {
        const { top , left , bottom , right , chart  } = scale;
        const { chartArea , scales  } = chart;
        let rotation = 0;
        let maxWidth, titleX, titleY;
        const height = bottom - top;
        const width = right - left;
        if (scale.isHorizontal()) {
            titleX = _alignStartEnd(align, left, right);
            if (isObject(position)) {
                const positionAxisID = Object.keys(position)[0];
                const value = position[positionAxisID];
                titleY = scales[positionAxisID].getPixelForValue(value) + height - offset;
            } else if (position === 'center') {
                titleY = (chartArea.bottom + chartArea.top) / 2 + height - offset;
            } else {
                titleY = offsetFromEdge(scale, position, offset);
            }
            maxWidth = right - left;
        } else {
            if (isObject(position)) {
                const positionAxisID = Object.keys(position)[0];
                const value = position[positionAxisID];
                titleX = scales[positionAxisID].getPixelForValue(value) - width + offset;
            } else if (position === 'center') {
                titleX = (chartArea.left + chartArea.right) / 2 - width + offset;
            } else {
                titleX = offsetFromEdge(scale, position, offset);
            }
            titleY = _alignStartEnd(align, bottom, top);
            rotation = position === 'left' ? -HALF_PI : HALF_PI;
        }
        return {
            titleX,
            titleY,
            maxWidth,
            rotation
        };
    }
    class Scale extends Element {
        constructor(cfg){
            super();
             this.id = cfg.id;
             this.type = cfg.type;
             this.options = undefined;
             this.ctx = cfg.ctx;
             this.chart = cfg.chart;
             this.top = undefined;
             this.bottom = undefined;
             this.left = undefined;
             this.right = undefined;
             this.width = undefined;
             this.height = undefined;
            this._margins = {
                left: 0,
                right: 0,
                top: 0,
                bottom: 0
            };
             this.maxWidth = undefined;
             this.maxHeight = undefined;
             this.paddingTop = undefined;
             this.paddingBottom = undefined;
             this.paddingLeft = undefined;
             this.paddingRight = undefined;
             this.axis = undefined;
             this.labelRotation = undefined;
            this.min = undefined;
            this.max = undefined;
            this._range = undefined;
             this.ticks = [];
             this._gridLineItems = null;
             this._labelItems = null;
             this._labelSizes = null;
            this._length = 0;
            this._maxLength = 0;
            this._longestTextCache = {};
             this._startPixel = undefined;
             this._endPixel = undefined;
            this._reversePixels = false;
            this._userMax = undefined;
            this._userMin = undefined;
            this._suggestedMax = undefined;
            this._suggestedMin = undefined;
            this._ticksLength = 0;
            this._borderValue = 0;
            this._cache = {};
            this._dataLimitsCached = false;
            this.$context = undefined;
        }
     init(options) {
            this.options = options.setContext(this.getContext());
            this.axis = options.axis;
            this._userMin = this.parse(options.min);
            this._userMax = this.parse(options.max);
            this._suggestedMin = this.parse(options.suggestedMin);
            this._suggestedMax = this.parse(options.suggestedMax);
        }
     parse(raw, index) {
            return raw;
        }
     getUserBounds() {
            let { _userMin , _userMax , _suggestedMin , _suggestedMax  } = this;
            _userMin = finiteOrDefault(_userMin, Number.POSITIVE_INFINITY);
            _userMax = finiteOrDefault(_userMax, Number.NEGATIVE_INFINITY);
            _suggestedMin = finiteOrDefault(_suggestedMin, Number.POSITIVE_INFINITY);
            _suggestedMax = finiteOrDefault(_suggestedMax, Number.NEGATIVE_INFINITY);
            return {
                min: finiteOrDefault(_userMin, _suggestedMin),
                max: finiteOrDefault(_userMax, _suggestedMax),
                minDefined: isNumberFinite(_userMin),
                maxDefined: isNumberFinite(_userMax)
            };
        }
     getMinMax(canStack) {
            let { min , max , minDefined , maxDefined  } = this.getUserBounds();
            let range;
            if (minDefined && maxDefined) {
                return {
                    min,
                    max
                };
            }
            const metas = this.getMatchingVisibleMetas();
            for(let i = 0, ilen = metas.length; i < ilen; ++i){
                range = metas[i].controller.getMinMax(this, canStack);
                if (!minDefined) {
                    min = Math.min(min, range.min);
                }
                if (!maxDefined) {
                    max = Math.max(max, range.max);
                }
            }
            min = maxDefined && min > max ? max : min;
            max = minDefined && min > max ? min : max;
            return {
                min: finiteOrDefault(min, finiteOrDefault(max, min)),
                max: finiteOrDefault(max, finiteOrDefault(min, max))
            };
        }
     getPadding() {
            return {
                left: this.paddingLeft || 0,
                top: this.paddingTop || 0,
                right: this.paddingRight || 0,
                bottom: this.paddingBottom || 0
            };
        }
     getTicks() {
            return this.ticks;
        }
     getLabels() {
            const data = this.chart.data;
            return this.options.labels || (this.isHorizontal() ? data.xLabels : data.yLabels) || data.labels || [];
        }
     getLabelItems(chartArea = this.chart.chartArea) {
            const items = this._labelItems || (this._labelItems = this._computeLabelItems(chartArea));
            return items;
        }
        beforeLayout() {
            this._cache = {};
            this._dataLimitsCached = false;
        }
        beforeUpdate() {
            callback(this.options.beforeUpdate, [
                this
            ]);
        }
     update(maxWidth, maxHeight, margins) {
            const { beginAtZero , grace , ticks: tickOpts  } = this.options;
            const sampleSize = tickOpts.sampleSize;
            this.beforeUpdate();
            this.maxWidth = maxWidth;
            this.maxHeight = maxHeight;
            this._margins = margins = Object.assign({
                left: 0,
                right: 0,
                top: 0,
                bottom: 0
            }, margins);
            this.ticks = null;
            this._labelSizes = null;
            this._gridLineItems = null;
            this._labelItems = null;
            this.beforeSetDimensions();
            this.setDimensions();
            this.afterSetDimensions();
            this._maxLength = this.isHorizontal() ? this.width + margins.left + margins.right : this.height + margins.top + margins.bottom;
            if (!this._dataLimitsCached) {
                this.beforeDataLimits();
                this.determineDataLimits();
                this.afterDataLimits();
                this._range = _addGrace(this, grace, beginAtZero);
                this._dataLimitsCached = true;
            }
            this.beforeBuildTicks();
            this.ticks = this.buildTicks() || [];
            this.afterBuildTicks();
            const samplingEnabled = sampleSize < this.ticks.length;
            this._convertTicksToLabels(samplingEnabled ? sample(this.ticks, sampleSize) : this.ticks);
            this.configure();
            this.beforeCalculateLabelRotation();
            this.calculateLabelRotation();
            this.afterCalculateLabelRotation();
            if (tickOpts.display && (tickOpts.autoSkip || tickOpts.source === 'auto')) {
                this.ticks = autoSkip(this, this.ticks);
                this._labelSizes = null;
                this.afterAutoSkip();
            }
            if (samplingEnabled) {
                this._convertTicksToLabels(this.ticks);
            }
            this.beforeFit();
            this.fit();
            this.afterFit();
            this.afterUpdate();
        }
     configure() {
            let reversePixels = this.options.reverse;
            let startPixel, endPixel;
            if (this.isHorizontal()) {
                startPixel = this.left;
                endPixel = this.right;
            } else {
                startPixel = this.top;
                endPixel = this.bottom;
                reversePixels = !reversePixels;
            }
            this._startPixel = startPixel;
            this._endPixel = endPixel;
            this._reversePixels = reversePixels;
            this._length = endPixel - startPixel;
            this._alignToPixels = this.options.alignToPixels;
        }
        afterUpdate() {
            callback(this.options.afterUpdate, [
                this
            ]);
        }
        beforeSetDimensions() {
            callback(this.options.beforeSetDimensions, [
                this
            ]);
        }
        setDimensions() {
            if (this.isHorizontal()) {
                this.width = this.maxWidth;
                this.left = 0;
                this.right = this.width;
            } else {
                this.height = this.maxHeight;
                this.top = 0;
                this.bottom = this.height;
            }
            this.paddingLeft = 0;
            this.paddingTop = 0;
            this.paddingRight = 0;
            this.paddingBottom = 0;
        }
        afterSetDimensions() {
            callback(this.options.afterSetDimensions, [
                this
            ]);
        }
        _callHooks(name) {
            this.chart.notifyPlugins(name, this.getContext());
            callback(this.options[name], [
                this
            ]);
        }
        beforeDataLimits() {
            this._callHooks('beforeDataLimits');
        }
        determineDataLimits() {}
        afterDataLimits() {
            this._callHooks('afterDataLimits');
        }
        beforeBuildTicks() {
            this._callHooks('beforeBuildTicks');
        }
     buildTicks() {
            return [];
        }
        afterBuildTicks() {
            this._callHooks('afterBuildTicks');
        }
        beforeTickToLabelConversion() {
            callback(this.options.beforeTickToLabelConversion, [
                this
            ]);
        }
     generateTickLabels(ticks) {
            const tickOpts = this.options.ticks;
            let i, ilen, tick;
            for(i = 0, ilen = ticks.length; i < ilen; i++){
                tick = ticks[i];
                tick.label = callback(tickOpts.callback, [
                    tick.value,
                    i,
                    ticks
                ], this);
            }
        }
        afterTickToLabelConversion() {
            callback(this.options.afterTickToLabelConversion, [
                this
            ]);
        }
        beforeCalculateLabelRotation() {
            callback(this.options.beforeCalculateLabelRotation, [
                this
            ]);
        }
        calculateLabelRotation() {
            const options = this.options;
            const tickOpts = options.ticks;
            const numTicks = getTicksLimit(this.ticks.length, options.ticks.maxTicksLimit);
            const minRotation = tickOpts.minRotation || 0;
            const maxRotation = tickOpts.maxRotation;
            let labelRotation = minRotation;
            let tickWidth, maxHeight, maxLabelDiagonal;
            if (!this._isVisible() || !tickOpts.display || minRotation >= maxRotation || numTicks <= 1 || !this.isHorizontal()) {
                this.labelRotation = minRotation;
                return;
            }
            const labelSizes = this._getLabelSizes();
            const maxLabelWidth = labelSizes.widest.width;
            const maxLabelHeight = labelSizes.highest.height;
            const maxWidth = _limitValue(this.chart.width - maxLabelWidth, 0, this.maxWidth);
            tickWidth = options.offset ? this.maxWidth / numTicks : maxWidth / (numTicks - 1);
            if (maxLabelWidth + 6 > tickWidth) {
                tickWidth = maxWidth / (numTicks - (options.offset ? 0.5 : 1));
                maxHeight = this.maxHeight - getTickMarkLength(options.grid) - tickOpts.padding - getTitleHeight(options.title, this.chart.options.font);
                maxLabelDiagonal = Math.sqrt(maxLabelWidth * maxLabelWidth + maxLabelHeight * maxLabelHeight);
                labelRotation = toDegrees(Math.min(Math.asin(_limitValue((labelSizes.highest.height + 6) / tickWidth, -1, 1)), Math.asin(_limitValue(maxHeight / maxLabelDiagonal, -1, 1)) - Math.asin(_limitValue(maxLabelHeight / maxLabelDiagonal, -1, 1))));
                labelRotation = Math.max(minRotation, Math.min(maxRotation, labelRotation));
            }
            this.labelRotation = labelRotation;
        }
        afterCalculateLabelRotation() {
            callback(this.options.afterCalculateLabelRotation, [
                this
            ]);
        }
        afterAutoSkip() {}
        beforeFit() {
            callback(this.options.beforeFit, [
                this
            ]);
        }
        fit() {
            const minSize = {
                width: 0,
                height: 0
            };
            const { chart , options: { ticks: tickOpts , title: titleOpts , grid: gridOpts  }  } = this;
            const display = this._isVisible();
            const isHorizontal = this.isHorizontal();
            if (display) {
                const titleHeight = getTitleHeight(titleOpts, chart.options.font);
                if (isHorizontal) {
                    minSize.width = this.maxWidth;
                    minSize.height = getTickMarkLength(gridOpts) + titleHeight;
                } else {
                    minSize.height = this.maxHeight;
                    minSize.width = getTickMarkLength(gridOpts) + titleHeight;
                }
                if (tickOpts.display && this.ticks.length) {
                    const { first , last , widest , highest  } = this._getLabelSizes();
                    const tickPadding = tickOpts.padding * 2;
                    const angleRadians = toRadians(this.labelRotation);
                    const cos = Math.cos(angleRadians);
                    const sin = Math.sin(angleRadians);
                    if (isHorizontal) {
                        const labelHeight = tickOpts.mirror ? 0 : sin * widest.width + cos * highest.height;
                        minSize.height = Math.min(this.maxHeight, minSize.height + labelHeight + tickPadding);
                    } else {
                        const labelWidth = tickOpts.mirror ? 0 : cos * widest.width + sin * highest.height;
                        minSize.width = Math.min(this.maxWidth, minSize.width + labelWidth + tickPadding);
                    }
                    this._calculatePadding(first, last, sin, cos);
                }
            }
            this._handleMargins();
            if (isHorizontal) {
                this.width = this._length = chart.width - this._margins.left - this._margins.right;
                this.height = minSize.height;
            } else {
                this.width = minSize.width;
                this.height = this._length = chart.height - this._margins.top - this._margins.bottom;
            }
        }
        _calculatePadding(first, last, sin, cos) {
            const { ticks: { align , padding  } , position  } = this.options;
            const isRotated = this.labelRotation !== 0;
            const labelsBelowTicks = position !== 'top' && this.axis === 'x';
            if (this.isHorizontal()) {
                const offsetLeft = this.getPixelForTick(0) - this.left;
                const offsetRight = this.right - this.getPixelForTick(this.ticks.length - 1);
                let paddingLeft = 0;
                let paddingRight = 0;
                if (isRotated) {
                    if (labelsBelowTicks) {
                        paddingLeft = cos * first.width;
                        paddingRight = sin * last.height;
                    } else {
                        paddingLeft = sin * first.height;
                        paddingRight = cos * last.width;
                    }
                } else if (align === 'start') {
                    paddingRight = last.width;
                } else if (align === 'end') {
                    paddingLeft = first.width;
                } else if (align !== 'inner') {
                    paddingLeft = first.width / 2;
                    paddingRight = last.width / 2;
                }
                this.paddingLeft = Math.max((paddingLeft - offsetLeft + padding) * this.width / (this.width - offsetLeft), 0);
                this.paddingRight = Math.max((paddingRight - offsetRight + padding) * this.width / (this.width - offsetRight), 0);
            } else {
                let paddingTop = last.height / 2;
                let paddingBottom = first.height / 2;
                if (align === 'start') {
                    paddingTop = 0;
                    paddingBottom = first.height;
                } else if (align === 'end') {
                    paddingTop = last.height;
                    paddingBottom = 0;
                }
                this.paddingTop = paddingTop + padding;
                this.paddingBottom = paddingBottom + padding;
            }
        }
     _handleMargins() {
            if (this._margins) {
                this._margins.left = Math.max(this.paddingLeft, this._margins.left);
                this._margins.top = Math.max(this.paddingTop, this._margins.top);
                this._margins.right = Math.max(this.paddingRight, this._margins.right);
                this._margins.bottom = Math.max(this.paddingBottom, this._margins.bottom);
            }
        }
        afterFit() {
            callback(this.options.afterFit, [
                this
            ]);
        }
     isHorizontal() {
            const { axis , position  } = this.options;
            return position === 'top' || position === 'bottom' || axis === 'x';
        }
     isFullSize() {
            return this.options.fullSize;
        }
     _convertTicksToLabels(ticks) {
            this.beforeTickToLabelConversion();
            this.generateTickLabels(ticks);
            let i, ilen;
            for(i = 0, ilen = ticks.length; i < ilen; i++){
                if (isNullOrUndef(ticks[i].label)) {
                    ticks.splice(i, 1);
                    ilen--;
                    i--;
                }
            }
            this.afterTickToLabelConversion();
        }
     _getLabelSizes() {
            let labelSizes = this._labelSizes;
            if (!labelSizes) {
                const sampleSize = this.options.ticks.sampleSize;
                let ticks = this.ticks;
                if (sampleSize < ticks.length) {
                    ticks = sample(ticks, sampleSize);
                }
                this._labelSizes = labelSizes = this._computeLabelSizes(ticks, ticks.length, this.options.ticks.maxTicksLimit);
            }
            return labelSizes;
        }
     _computeLabelSizes(ticks, length, maxTicksLimit) {
            const { ctx , _longestTextCache: caches  } = this;
            const widths = [];
            const heights = [];
            const increment = Math.floor(length / getTicksLimit(length, maxTicksLimit));
            let widestLabelSize = 0;
            let highestLabelSize = 0;
            let i, j, jlen, label, tickFont, fontString, cache, lineHeight, width, height, nestedLabel;
            for(i = 0; i < length; i += increment){
                label = ticks[i].label;
                tickFont = this._resolveTickFontOptions(i);
                ctx.font = fontString = tickFont.string;
                cache = caches[fontString] = caches[fontString] || {
                    data: {},
                    gc: []
                };
                lineHeight = tickFont.lineHeight;
                width = height = 0;
                if (!isNullOrUndef(label) && !isArray(label)) {
                    width = _measureText(ctx, cache.data, cache.gc, width, label);
                    height = lineHeight;
                } else if (isArray(label)) {
                    for(j = 0, jlen = label.length; j < jlen; ++j){
                        nestedLabel =  label[j];
                        if (!isNullOrUndef(nestedLabel) && !isArray(nestedLabel)) {
                            width = _measureText(ctx, cache.data, cache.gc, width, nestedLabel);
                            height += lineHeight;
                        }
                    }
                }
                widths.push(width);
                heights.push(height);
                widestLabelSize = Math.max(width, widestLabelSize);
                highestLabelSize = Math.max(height, highestLabelSize);
            }
            garbageCollect(caches, length);
            const widest = widths.indexOf(widestLabelSize);
            const highest = heights.indexOf(highestLabelSize);
            const valueAt = (idx)=>({
                    width: widths[idx] || 0,
                    height: heights[idx] || 0
                });
            return {
                first: valueAt(0),
                last: valueAt(length - 1),
                widest: valueAt(widest),
                highest: valueAt(highest),
                widths,
                heights
            };
        }
     getLabelForValue(value) {
            return value;
        }
     getPixelForValue(value, index) {
            return NaN;
        }
     getValueForPixel(pixel) {}
     getPixelForTick(index) {
            const ticks = this.ticks;
            if (index < 0 || index > ticks.length - 1) {
                return null;
            }
            return this.getPixelForValue(ticks[index].value);
        }
     getPixelForDecimal(decimal) {
            if (this._reversePixels) {
                decimal = 1 - decimal;
            }
            const pixel = this._startPixel + decimal * this._length;
            return _int16Range(this._alignToPixels ? _alignPixel(this.chart, pixel, 0) : pixel);
        }
     getDecimalForPixel(pixel) {
            const decimal = (pixel - this._startPixel) / this._length;
            return this._reversePixels ? 1 - decimal : decimal;
        }
     getBasePixel() {
            return this.getPixelForValue(this.getBaseValue());
        }
     getBaseValue() {
            const { min , max  } = this;
            return min < 0 && max < 0 ? max : min > 0 && max > 0 ? min : 0;
        }
     getContext(index) {
            const ticks = this.ticks || [];
            if (index >= 0 && index < ticks.length) {
                const tick = ticks[index];
                return tick.$context || (tick.$context = createTickContext(this.getContext(), index, tick));
            }
            return this.$context || (this.$context = createScaleContext(this.chart.getContext(), this));
        }
     _tickSize() {
            const optionTicks = this.options.ticks;
            const rot = toRadians(this.labelRotation);
            const cos = Math.abs(Math.cos(rot));
            const sin = Math.abs(Math.sin(rot));
            const labelSizes = this._getLabelSizes();
            const padding = optionTicks.autoSkipPadding || 0;
            const w = labelSizes ? labelSizes.widest.width + padding : 0;
            const h = labelSizes ? labelSizes.highest.height + padding : 0;
            return this.isHorizontal() ? h * cos > w * sin ? w / cos : h / sin : h * sin < w * cos ? h / cos : w / sin;
        }
     _isVisible() {
            const display = this.options.display;
            if (display !== 'auto') {
                return !!display;
            }
            return this.getMatchingVisibleMetas().length > 0;
        }
     _computeGridLineItems(chartArea) {
            const axis = this.axis;
            const chart = this.chart;
            const options = this.options;
            const { grid , position , border  } = options;
            const offset = grid.offset;
            const isHorizontal = this.isHorizontal();
            const ticks = this.ticks;
            const ticksLength = ticks.length + (offset ? 1 : 0);
            const tl = getTickMarkLength(grid);
            const items = [];
            const borderOpts = border.setContext(this.getContext());
            const axisWidth = borderOpts.display ? borderOpts.width : 0;
            const axisHalfWidth = axisWidth / 2;
            const alignBorderValue = function(pixel) {
                return _alignPixel(chart, pixel, axisWidth);
            };
            let borderValue, i, lineValue, alignedLineValue;
            let tx1, ty1, tx2, ty2, x1, y1, x2, y2;
            if (position === 'top') {
                borderValue = alignBorderValue(this.bottom);
                ty1 = this.bottom - tl;
                ty2 = borderValue - axisHalfWidth;
                y1 = alignBorderValue(chartArea.top) + axisHalfWidth;
                y2 = chartArea.bottom;
            } else if (position === 'bottom') {
                borderValue = alignBorderValue(this.top);
                y1 = chartArea.top;
                y2 = alignBorderValue(chartArea.bottom) - axisHalfWidth;
                ty1 = borderValue + axisHalfWidth;
                ty2 = this.top + tl;
            } else if (position === 'left') {
                borderValue = alignBorderValue(this.right);
                tx1 = this.right - tl;
                tx2 = borderValue - axisHalfWidth;
                x1 = alignBorderValue(chartArea.left) + axisHalfWidth;
                x2 = chartArea.right;
            } else if (position === 'right') {
                borderValue = alignBorderValue(this.left);
                x1 = chartArea.left;
                x2 = alignBorderValue(chartArea.right) - axisHalfWidth;
                tx1 = borderValue + axisHalfWidth;
                tx2 = this.left + tl;
            } else if (axis === 'x') {
                if (position === 'center') {
                    borderValue = alignBorderValue((chartArea.top + chartArea.bottom) / 2 + 0.5);
                } else if (isObject(position)) {
                    const positionAxisID = Object.keys(position)[0];
                    const value = position[positionAxisID];
                    borderValue = alignBorderValue(this.chart.scales[positionAxisID].getPixelForValue(value));
                }
                y1 = chartArea.top;
                y2 = chartArea.bottom;
                ty1 = borderValue + axisHalfWidth;
                ty2 = ty1 + tl;
            } else if (axis === 'y') {
                if (position === 'center') {
                    borderValue = alignBorderValue((chartArea.left + chartArea.right) / 2);
                } else if (isObject(position)) {
                    const positionAxisID = Object.keys(position)[0];
                    const value = position[positionAxisID];
                    borderValue = alignBorderValue(this.chart.scales[positionAxisID].getPixelForValue(value));
                }
                tx1 = borderValue - axisHalfWidth;
                tx2 = tx1 - tl;
                x1 = chartArea.left;
                x2 = chartArea.right;
            }
            const limit = valueOrDefault(options.ticks.maxTicksLimit, ticksLength);
            const step = Math.max(1, Math.ceil(ticksLength / limit));
            for(i = 0; i < ticksLength; i += step){
                const context = this.getContext(i);
                const optsAtIndex = grid.setContext(context);
                const optsAtIndexBorder = border.setContext(context);
                const lineWidth = optsAtIndex.lineWidth;
                const lineColor = optsAtIndex.color;
                const borderDash = optsAtIndexBorder.dash || [];
                const borderDashOffset = optsAtIndexBorder.dashOffset;
                const tickWidth = optsAtIndex.tickWidth;
                const tickColor = optsAtIndex.tickColor;
                const tickBorderDash = optsAtIndex.tickBorderDash || [];
                const tickBorderDashOffset = optsAtIndex.tickBorderDashOffset;
                lineValue = getPixelForGridLine(this, i, offset);
                if (lineValue === undefined) {
                    continue;
                }
                alignedLineValue = _alignPixel(chart, lineValue, lineWidth);
                if (isHorizontal) {
                    tx1 = tx2 = x1 = x2 = alignedLineValue;
                } else {
                    ty1 = ty2 = y1 = y2 = alignedLineValue;
                }
                items.push({
                    tx1,
                    ty1,
                    tx2,
                    ty2,
                    x1,
                    y1,
                    x2,
                    y2,
                    width: lineWidth,
                    color: lineColor,
                    borderDash,
                    borderDashOffset,
                    tickWidth,
                    tickColor,
                    tickBorderDash,
                    tickBorderDashOffset
                });
            }
            this._ticksLength = ticksLength;
            this._borderValue = borderValue;
            return items;
        }
     _computeLabelItems(chartArea) {
            const axis = this.axis;
            const options = this.options;
            const { position , ticks: optionTicks  } = options;
            const isHorizontal = this.isHorizontal();
            const ticks = this.ticks;
            const { align , crossAlign , padding , mirror  } = optionTicks;
            const tl = getTickMarkLength(options.grid);
            const tickAndPadding = tl + padding;
            const hTickAndPadding = mirror ? -padding : tickAndPadding;
            const rotation = -toRadians(this.labelRotation);
            const items = [];
            let i, ilen, tick, label, x, y, textAlign, pixel, font, lineHeight, lineCount, textOffset;
            let textBaseline = 'middle';
            if (position === 'top') {
                y = this.bottom - hTickAndPadding;
                textAlign = this._getXAxisLabelAlignment();
            } else if (position === 'bottom') {
                y = this.top + hTickAndPadding;
                textAlign = this._getXAxisLabelAlignment();
            } else if (position === 'left') {
                const ret = this._getYAxisLabelAlignment(tl);
                textAlign = ret.textAlign;
                x = ret.x;
            } else if (position === 'right') {
                const ret = this._getYAxisLabelAlignment(tl);
                textAlign = ret.textAlign;
                x = ret.x;
            } else if (axis === 'x') {
                if (position === 'center') {
                    y = (chartArea.top + chartArea.bottom) / 2 + tickAndPadding;
                } else if (isObject(position)) {
                    const positionAxisID = Object.keys(position)[0];
                    const value = position[positionAxisID];
                    y = this.chart.scales[positionAxisID].getPixelForValue(value) + tickAndPadding;
                }
                textAlign = this._getXAxisLabelAlignment();
            } else if (axis === 'y') {
                if (position === 'center') {
                    x = (chartArea.left + chartArea.right) / 2 - tickAndPadding;
                } else if (isObject(position)) {
                    const positionAxisID = Object.keys(position)[0];
                    const value = position[positionAxisID];
                    x = this.chart.scales[positionAxisID].getPixelForValue(value);
                }
                textAlign = this._getYAxisLabelAlignment(tl).textAlign;
            }
            if (axis === 'y') {
                if (align === 'start') {
                    textBaseline = 'top';
                } else if (align === 'end') {
                    textBaseline = 'bottom';
                }
            }
            const labelSizes = this._getLabelSizes();
            for(i = 0, ilen = ticks.length; i < ilen; ++i){
                tick = ticks[i];
                label = tick.label;
                const optsAtIndex = optionTicks.setContext(this.getContext(i));
                pixel = this.getPixelForTick(i) + optionTicks.labelOffset;
                font = this._resolveTickFontOptions(i);
                lineHeight = font.lineHeight;
                lineCount = isArray(label) ? label.length : 1;
                const halfCount = lineCount / 2;
                const color = optsAtIndex.color;
                const strokeColor = optsAtIndex.textStrokeColor;
                const strokeWidth = optsAtIndex.textStrokeWidth;
                let tickTextAlign = textAlign;
                if (isHorizontal) {
                    x = pixel;
                    if (textAlign === 'inner') {
                        if (i === ilen - 1) {
                            tickTextAlign = !this.options.reverse ? 'right' : 'left';
                        } else if (i === 0) {
                            tickTextAlign = !this.options.reverse ? 'left' : 'right';
                        } else {
                            tickTextAlign = 'center';
                        }
                    }
                    if (position === 'top') {
                        if (crossAlign === 'near' || rotation !== 0) {
                            textOffset = -lineCount * lineHeight + lineHeight / 2;
                        } else if (crossAlign === 'center') {
                            textOffset = -labelSizes.highest.height / 2 - halfCount * lineHeight + lineHeight;
                        } else {
                            textOffset = -labelSizes.highest.height + lineHeight / 2;
                        }
                    } else {
                        if (crossAlign === 'near' || rotation !== 0) {
                            textOffset = lineHeight / 2;
                        } else if (crossAlign === 'center') {
                            textOffset = labelSizes.highest.height / 2 - halfCount * lineHeight;
                        } else {
                            textOffset = labelSizes.highest.height - lineCount * lineHeight;
                        }
                    }
                    if (mirror) {
                        textOffset *= -1;
                    }
                    if (rotation !== 0 && !optsAtIndex.showLabelBackdrop) {
                        x += lineHeight / 2 * Math.sin(rotation);
                    }
                } else {
                    y = pixel;
                    textOffset = (1 - lineCount) * lineHeight / 2;
                }
                let backdrop;
                if (optsAtIndex.showLabelBackdrop) {
                    const labelPadding = toPadding(optsAtIndex.backdropPadding);
                    const height = labelSizes.heights[i];
                    const width = labelSizes.widths[i];
                    let top = textOffset - labelPadding.top;
                    let left = 0 - labelPadding.left;
                    switch(textBaseline){
                        case 'middle':
                            top -= height / 2;
                            break;
                        case 'bottom':
                            top -= height;
                            break;
                    }
                    switch(textAlign){
                        case 'center':
                            left -= width / 2;
                            break;
                        case 'right':
                            left -= width;
                            break;
                        case 'inner':
                            if (i === ilen - 1) {
                                left -= width;
                            } else if (i > 0) {
                                left -= width / 2;
                            }
                            break;
                    }
                    backdrop = {
                        left,
                        top,
                        width: width + labelPadding.width,
                        height: height + labelPadding.height,
                        color: optsAtIndex.backdropColor
                    };
                }
                items.push({
                    label,
                    font,
                    textOffset,
                    options: {
                        rotation,
                        color,
                        strokeColor,
                        strokeWidth,
                        textAlign: tickTextAlign,
                        textBaseline,
                        translation: [
                            x,
                            y
                        ],
                        backdrop
                    }
                });
            }
            return items;
        }
        _getXAxisLabelAlignment() {
            const { position , ticks  } = this.options;
            const rotation = -toRadians(this.labelRotation);
            if (rotation) {
                return position === 'top' ? 'left' : 'right';
            }
            let align = 'center';
            if (ticks.align === 'start') {
                align = 'left';
            } else if (ticks.align === 'end') {
                align = 'right';
            } else if (ticks.align === 'inner') {
                align = 'inner';
            }
            return align;
        }
        _getYAxisLabelAlignment(tl) {
            const { position , ticks: { crossAlign , mirror , padding  }  } = this.options;
            const labelSizes = this._getLabelSizes();
            const tickAndPadding = tl + padding;
            const widest = labelSizes.widest.width;
            let textAlign;
            let x;
            if (position === 'left') {
                if (mirror) {
                    x = this.right + padding;
                    if (crossAlign === 'near') {
                        textAlign = 'left';
                    } else if (crossAlign === 'center') {
                        textAlign = 'center';
                        x += widest / 2;
                    } else {
                        textAlign = 'right';
                        x += widest;
                    }
                } else {
                    x = this.right - tickAndPadding;
                    if (crossAlign === 'near') {
                        textAlign = 'right';
                    } else if (crossAlign === 'center') {
                        textAlign = 'center';
                        x -= widest / 2;
                    } else {
                        textAlign = 'left';
                        x = this.left;
                    }
                }
            } else if (position === 'right') {
                if (mirror) {
                    x = this.left + padding;
                    if (crossAlign === 'near') {
                        textAlign = 'right';
                    } else if (crossAlign === 'center') {
                        textAlign = 'center';
                        x -= widest / 2;
                    } else {
                        textAlign = 'left';
                        x -= widest;
                    }
                } else {
                    x = this.left + tickAndPadding;
                    if (crossAlign === 'near') {
                        textAlign = 'left';
                    } else if (crossAlign === 'center') {
                        textAlign = 'center';
                        x += widest / 2;
                    } else {
                        textAlign = 'right';
                        x = this.right;
                    }
                }
            } else {
                textAlign = 'right';
            }
            return {
                textAlign,
                x
            };
        }
     _computeLabelArea() {
            if (this.options.ticks.mirror) {
                return;
            }
            const chart = this.chart;
            const position = this.options.position;
            if (position === 'left' || position === 'right') {
                return {
                    top: 0,
                    left: this.left,
                    bottom: chart.height,
                    right: this.right
                };
            }
            if (position === 'top' || position === 'bottom') {
                return {
                    top: this.top,
                    left: 0,
                    bottom: this.bottom,
                    right: chart.width
                };
            }
        }
     drawBackground() {
            const { ctx , options: { backgroundColor  } , left , top , width , height  } = this;
            if (backgroundColor) {
                ctx.save();
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(left, top, width, height);
                ctx.restore();
            }
        }
        getLineWidthForValue(value) {
            const grid = this.options.grid;
            if (!this._isVisible() || !grid.display) {
                return 0;
            }
            const ticks = this.ticks;
            const index = ticks.findIndex((t)=>t.value === value);
            if (index >= 0) {
                const opts = grid.setContext(this.getContext(index));
                return opts.lineWidth;
            }
            return 0;
        }
     drawGrid(chartArea) {
            const grid = this.options.grid;
            const ctx = this.ctx;
            const items = this._gridLineItems || (this._gridLineItems = this._computeGridLineItems(chartArea));
            let i, ilen;
            const drawLine = (p1, p2, style)=>{
                if (!style.width || !style.color) {
                    return;
                }
                ctx.save();
                ctx.lineWidth = style.width;
                ctx.strokeStyle = style.color;
                ctx.setLineDash(style.borderDash || []);
                ctx.lineDashOffset = style.borderDashOffset;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
                ctx.restore();
            };
            if (grid.display) {
                for(i = 0, ilen = items.length; i < ilen; ++i){
                    const item = items[i];
                    if (grid.drawOnChartArea) {
                        drawLine({
                            x: item.x1,
                            y: item.y1
                        }, {
                            x: item.x2,
                            y: item.y2
                        }, item);
                    }
                    if (grid.drawTicks) {
                        drawLine({
                            x: item.tx1,
                            y: item.ty1
                        }, {
                            x: item.tx2,
                            y: item.ty2
                        }, {
                            color: item.tickColor,
                            width: item.tickWidth,
                            borderDash: item.tickBorderDash,
                            borderDashOffset: item.tickBorderDashOffset
                        });
                    }
                }
            }
        }
     drawBorder() {
            const { chart , ctx , options: { border , grid  }  } = this;
            const borderOpts = border.setContext(this.getContext());
            const axisWidth = border.display ? borderOpts.width : 0;
            if (!axisWidth) {
                return;
            }
            const lastLineWidth = grid.setContext(this.getContext(0)).lineWidth;
            const borderValue = this._borderValue;
            let x1, x2, y1, y2;
            if (this.isHorizontal()) {
                x1 = _alignPixel(chart, this.left, axisWidth) - axisWidth / 2;
                x2 = _alignPixel(chart, this.right, lastLineWidth) + lastLineWidth / 2;
                y1 = y2 = borderValue;
            } else {
                y1 = _alignPixel(chart, this.top, axisWidth) - axisWidth / 2;
                y2 = _alignPixel(chart, this.bottom, lastLineWidth) + lastLineWidth / 2;
                x1 = x2 = borderValue;
            }
            ctx.save();
            ctx.lineWidth = borderOpts.width;
            ctx.strokeStyle = borderOpts.color;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.restore();
        }
     drawLabels(chartArea) {
            const optionTicks = this.options.ticks;
            if (!optionTicks.display) {
                return;
            }
            const ctx = this.ctx;
            const area = this._computeLabelArea();
            if (area) {
                clipArea(ctx, area);
            }
            const items = this.getLabelItems(chartArea);
            for (const item of items){
                const renderTextOptions = item.options;
                const tickFont = item.font;
                const label = item.label;
                const y = item.textOffset;
                renderText(ctx, label, 0, y, tickFont, renderTextOptions);
            }
            if (area) {
                unclipArea(ctx);
            }
        }
     drawTitle() {
            const { ctx , options: { position , title , reverse  }  } = this;
            if (!title.display) {
                return;
            }
            const font = toFont(title.font);
            const padding = toPadding(title.padding);
            const align = title.align;
            let offset = font.lineHeight / 2;
            if (position === 'bottom' || position === 'center' || isObject(position)) {
                offset += padding.bottom;
                if (isArray(title.text)) {
                    offset += font.lineHeight * (title.text.length - 1);
                }
            } else {
                offset += padding.top;
            }
            const { titleX , titleY , maxWidth , rotation  } = titleArgs(this, offset, position, align);
            renderText(ctx, title.text, 0, 0, font, {
                color: title.color,
                maxWidth,
                rotation,
                textAlign: titleAlign(align, position, reverse),
                textBaseline: 'middle',
                translation: [
                    titleX,
                    titleY
                ]
            });
        }
        draw(chartArea) {
            if (!this._isVisible()) {
                return;
            }
            this.drawBackground();
            this.drawGrid(chartArea);
            this.drawBorder();
            this.drawTitle();
            this.drawLabels(chartArea);
        }
     _layers() {
            const opts = this.options;
            const tz = opts.ticks && opts.ticks.z || 0;
            const gz = valueOrDefault(opts.grid && opts.grid.z, -1);
            const bz = valueOrDefault(opts.border && opts.border.z, 0);
            if (!this._isVisible() || this.draw !== Scale.prototype.draw) {
                return [
                    {
                        z: tz,
                        draw: (chartArea)=>{
                            this.draw(chartArea);
                        }
                    }
                ];
            }
            return [
                {
                    z: gz,
                    draw: (chartArea)=>{
                        this.drawBackground();
                        this.drawGrid(chartArea);
                        this.drawTitle();
                    }
                },
                {
                    z: bz,
                    draw: ()=>{
                        this.drawBorder();
                    }
                },
                {
                    z: tz,
                    draw: (chartArea)=>{
                        this.drawLabels(chartArea);
                    }
                }
            ];
        }
     getMatchingVisibleMetas(type) {
            const metas = this.chart.getSortedVisibleDatasetMetas();
            const axisID = this.axis + 'AxisID';
            const result = [];
            let i, ilen;
            for(i = 0, ilen = metas.length; i < ilen; ++i){
                const meta = metas[i];
                if (meta[axisID] === this.id && (!type || meta.type === type)) {
                    result.push(meta);
                }
            }
            return result;
        }
     _resolveTickFontOptions(index) {
            const opts = this.options.ticks.setContext(this.getContext(index));
            return toFont(opts.font);
        }
     _maxDigits() {
            const fontSize = this._resolveTickFontOptions(0).lineHeight;
            return (this.isHorizontal() ? this.width : this.height) / fontSize;
        }
    }

    class TypedRegistry {
        constructor(type, scope, override){
            this.type = type;
            this.scope = scope;
            this.override = override;
            this.items = Object.create(null);
        }
        isForType(type) {
            return Object.prototype.isPrototypeOf.call(this.type.prototype, type.prototype);
        }
     register(item) {
            const proto = Object.getPrototypeOf(item);
            let parentScope;
            if (isIChartComponent(proto)) {
                parentScope = this.register(proto);
            }
            const items = this.items;
            const id = item.id;
            const scope = this.scope + '.' + id;
            if (!id) {
                throw new Error('class does not have id: ' + item);
            }
            if (id in items) {
                return scope;
            }
            items[id] = item;
            registerDefaults(item, scope, parentScope);
            if (this.override) {
                defaults.override(item.id, item.overrides);
            }
            return scope;
        }
     get(id) {
            return this.items[id];
        }
     unregister(item) {
            const items = this.items;
            const id = item.id;
            const scope = this.scope;
            if (id in items) {
                delete items[id];
            }
            if (scope && id in defaults[scope]) {
                delete defaults[scope][id];
                if (this.override) {
                    delete overrides[id];
                }
            }
        }
    }
    function registerDefaults(item, scope, parentScope) {
        const itemDefaults = merge(Object.create(null), [
            parentScope ? defaults.get(parentScope) : {},
            defaults.get(scope),
            item.defaults
        ]);
        defaults.set(scope, itemDefaults);
        if (item.defaultRoutes) {
            routeDefaults(scope, item.defaultRoutes);
        }
        if (item.descriptors) {
            defaults.describe(scope, item.descriptors);
        }
    }
    function routeDefaults(scope, routes) {
        Object.keys(routes).forEach((property)=>{
            const propertyParts = property.split('.');
            const sourceName = propertyParts.pop();
            const sourceScope = [
                scope
            ].concat(propertyParts).join('.');
            const parts = routes[property].split('.');
            const targetName = parts.pop();
            const targetScope = parts.join('.');
            defaults.route(sourceScope, sourceName, targetScope, targetName);
        });
    }
    function isIChartComponent(proto) {
        return 'id' in proto && 'defaults' in proto;
    }

    class Registry {
        constructor(){
            this.controllers = new TypedRegistry(DatasetController, 'datasets', true);
            this.elements = new TypedRegistry(Element, 'elements');
            this.plugins = new TypedRegistry(Object, 'plugins');
            this.scales = new TypedRegistry(Scale, 'scales');
            this._typedRegistries = [
                this.controllers,
                this.scales,
                this.elements
            ];
        }
     add(...args) {
            this._each('register', args);
        }
        remove(...args) {
            this._each('unregister', args);
        }
     addControllers(...args) {
            this._each('register', args, this.controllers);
        }
     addElements(...args) {
            this._each('register', args, this.elements);
        }
     addPlugins(...args) {
            this._each('register', args, this.plugins);
        }
     addScales(...args) {
            this._each('register', args, this.scales);
        }
     getController(id) {
            return this._get(id, this.controllers, 'controller');
        }
     getElement(id) {
            return this._get(id, this.elements, 'element');
        }
     getPlugin(id) {
            return this._get(id, this.plugins, 'plugin');
        }
     getScale(id) {
            return this._get(id, this.scales, 'scale');
        }
     removeControllers(...args) {
            this._each('unregister', args, this.controllers);
        }
     removeElements(...args) {
            this._each('unregister', args, this.elements);
        }
     removePlugins(...args) {
            this._each('unregister', args, this.plugins);
        }
     removeScales(...args) {
            this._each('unregister', args, this.scales);
        }
     _each(method, args, typedRegistry) {
            [
                ...args
            ].forEach((arg)=>{
                const reg = typedRegistry || this._getRegistryForType(arg);
                if (typedRegistry || reg.isForType(arg) || reg === this.plugins && arg.id) {
                    this._exec(method, reg, arg);
                } else {
                    each(arg, (item)=>{
                        const itemReg = typedRegistry || this._getRegistryForType(item);
                        this._exec(method, itemReg, item);
                    });
                }
            });
        }
     _exec(method, registry, component) {
            const camelMethod = _capitalize(method);
            callback(component['before' + camelMethod], [], component);
            registry[method](component);
            callback(component['after' + camelMethod], [], component);
        }
     _getRegistryForType(type) {
            for(let i = 0; i < this._typedRegistries.length; i++){
                const reg = this._typedRegistries[i];
                if (reg.isForType(type)) {
                    return reg;
                }
            }
            return this.plugins;
        }
     _get(id, typedRegistry, type) {
            const item = typedRegistry.get(id);
            if (item === undefined) {
                throw new Error('"' + id + '" is not a registered ' + type + '.');
            }
            return item;
        }
    }
    var registry = /* #__PURE__ */ new Registry();

    class PluginService {
        constructor(){
            this._init = undefined;
        }
     notify(chart, hook, args, filter) {
            if (hook === 'beforeInit') {
                this._init = this._createDescriptors(chart, true);
                this._notify(this._init, chart, 'install');
            }
            if (this._init === undefined) {
                return;
            }
            const descriptors = filter ? this._descriptors(chart).filter(filter) : this._descriptors(chart);
            const result = this._notify(descriptors, chart, hook, args);
            if (hook === 'afterDestroy') {
                this._notify(descriptors, chart, 'stop');
                this._notify(this._init, chart, 'uninstall');
                this._init = undefined;
            }
            return result;
        }
     _notify(descriptors, chart, hook, args) {
            args = args || {};
            for (const descriptor of descriptors){
                const plugin = descriptor.plugin;
                const method = plugin[hook];
                const params = [
                    chart,
                    args,
                    descriptor.options
                ];
                if (callback(method, params, plugin) === false && args.cancelable) {
                    return false;
                }
            }
            return true;
        }
        invalidate() {
            if (!isNullOrUndef(this._cache)) {
                this._oldCache = this._cache;
                this._cache = undefined;
            }
        }
     _descriptors(chart) {
            if (this._cache) {
                return this._cache;
            }
            const descriptors = this._cache = this._createDescriptors(chart);
            this._notifyStateChanges(chart);
            return descriptors;
        }
        _createDescriptors(chart, all) {
            const config = chart && chart.config;
            const options = valueOrDefault(config.options && config.options.plugins, {});
            const plugins = allPlugins(config);
            return options === false && !all ? [] : createDescriptors(chart, plugins, options, all);
        }
     _notifyStateChanges(chart) {
            const previousDescriptors = this._oldCache || [];
            const descriptors = this._cache;
            const diff = (a, b)=>a.filter((x)=>!b.some((y)=>x.plugin.id === y.plugin.id));
            this._notify(diff(previousDescriptors, descriptors), chart, 'stop');
            this._notify(diff(descriptors, previousDescriptors), chart, 'start');
        }
    }
     function allPlugins(config) {
        const localIds = {};
        const plugins = [];
        const keys = Object.keys(registry.plugins.items);
        for(let i = 0; i < keys.length; i++){
            plugins.push(registry.getPlugin(keys[i]));
        }
        const local = config.plugins || [];
        for(let i = 0; i < local.length; i++){
            const plugin = local[i];
            if (plugins.indexOf(plugin) === -1) {
                plugins.push(plugin);
                localIds[plugin.id] = true;
            }
        }
        return {
            plugins,
            localIds
        };
    }
    function getOpts(options, all) {
        if (!all && options === false) {
            return null;
        }
        if (options === true) {
            return {};
        }
        return options;
    }
    function createDescriptors(chart, { plugins , localIds  }, options, all) {
        const result = [];
        const context = chart.getContext();
        for (const plugin of plugins){
            const id = plugin.id;
            const opts = getOpts(options[id], all);
            if (opts === null) {
                continue;
            }
            result.push({
                plugin,
                options: pluginOpts(chart.config, {
                    plugin,
                    local: localIds[id]
                }, opts, context)
            });
        }
        return result;
    }
    function pluginOpts(config, { plugin , local  }, opts, context) {
        const keys = config.pluginScopeKeys(plugin);
        const scopes = config.getOptionScopes(opts, keys);
        if (local && plugin.defaults) {
            scopes.push(plugin.defaults);
        }
        return config.createResolver(scopes, context, [
            ''
        ], {
            scriptable: false,
            indexable: false,
            allKeys: true
        });
    }

    function getIndexAxis(type, options) {
        const datasetDefaults = defaults.datasets[type] || {};
        const datasetOptions = (options.datasets || {})[type] || {};
        return datasetOptions.indexAxis || options.indexAxis || datasetDefaults.indexAxis || 'x';
    }
    function getAxisFromDefaultScaleID(id, indexAxis) {
        let axis = id;
        if (id === '_index_') {
            axis = indexAxis;
        } else if (id === '_value_') {
            axis = indexAxis === 'x' ? 'y' : 'x';
        }
        return axis;
    }
    function getDefaultScaleIDFromAxis(axis, indexAxis) {
        return axis === indexAxis ? '_index_' : '_value_';
    }
    function idMatchesAxis(id) {
        if (id === 'x' || id === 'y' || id === 'r') {
            return id;
        }
    }
    function axisFromPosition(position) {
        if (position === 'top' || position === 'bottom') {
            return 'x';
        }
        if (position === 'left' || position === 'right') {
            return 'y';
        }
    }
    function determineAxis(id, ...scaleOptions) {
        if (idMatchesAxis(id)) {
            return id;
        }
        for (const opts of scaleOptions){
            const axis = opts.axis || axisFromPosition(opts.position) || id.length > 1 && idMatchesAxis(id[0].toLowerCase());
            if (axis) {
                return axis;
            }
        }
        throw new Error(`Cannot determine type of '${id}' axis. Please provide 'axis' or 'position' option.`);
    }
    function getAxisFromDataset(id, axis, dataset) {
        if (dataset[axis + 'AxisID'] === id) {
            return {
                axis
            };
        }
    }
    function retrieveAxisFromDatasets(id, config) {
        if (config.data && config.data.datasets) {
            const boundDs = config.data.datasets.filter((d)=>d.xAxisID === id || d.yAxisID === id);
            if (boundDs.length) {
                return getAxisFromDataset(id, 'x', boundDs[0]) || getAxisFromDataset(id, 'y', boundDs[0]);
            }
        }
        return {};
    }
    function mergeScaleConfig(config, options) {
        const chartDefaults = overrides[config.type] || {
            scales: {}
        };
        const configScales = options.scales || {};
        const chartIndexAxis = getIndexAxis(config.type, options);
        const scales = Object.create(null);
        Object.keys(configScales).forEach((id)=>{
            const scaleConf = configScales[id];
            if (!isObject(scaleConf)) {
                return console.error(`Invalid scale configuration for scale: ${id}`);
            }
            if (scaleConf._proxy) {
                return console.warn(`Ignoring resolver passed as options for scale: ${id}`);
            }
            const axis = determineAxis(id, scaleConf, retrieveAxisFromDatasets(id, config), defaults.scales[scaleConf.type]);
            const defaultId = getDefaultScaleIDFromAxis(axis, chartIndexAxis);
            const defaultScaleOptions = chartDefaults.scales || {};
            scales[id] = mergeIf(Object.create(null), [
                {
                    axis
                },
                scaleConf,
                defaultScaleOptions[axis],
                defaultScaleOptions[defaultId]
            ]);
        });
        config.data.datasets.forEach((dataset)=>{
            const type = dataset.type || config.type;
            const indexAxis = dataset.indexAxis || getIndexAxis(type, options);
            const datasetDefaults = overrides[type] || {};
            const defaultScaleOptions = datasetDefaults.scales || {};
            Object.keys(defaultScaleOptions).forEach((defaultID)=>{
                const axis = getAxisFromDefaultScaleID(defaultID, indexAxis);
                const id = dataset[axis + 'AxisID'] || axis;
                scales[id] = scales[id] || Object.create(null);
                mergeIf(scales[id], [
                    {
                        axis
                    },
                    configScales[id],
                    defaultScaleOptions[defaultID]
                ]);
            });
        });
        Object.keys(scales).forEach((key)=>{
            const scale = scales[key];
            mergeIf(scale, [
                defaults.scales[scale.type],
                defaults.scale
            ]);
        });
        return scales;
    }
    function initOptions(config) {
        const options = config.options || (config.options = {});
        options.plugins = valueOrDefault(options.plugins, {});
        options.scales = mergeScaleConfig(config, options);
    }
    function initData(data) {
        data = data || {};
        data.datasets = data.datasets || [];
        data.labels = data.labels || [];
        return data;
    }
    function initConfig(config) {
        config = config || {};
        config.data = initData(config.data);
        initOptions(config);
        return config;
    }
    const keyCache = new Map();
    const keysCached = new Set();
    function cachedKeys(cacheKey, generate) {
        let keys = keyCache.get(cacheKey);
        if (!keys) {
            keys = generate();
            keyCache.set(cacheKey, keys);
            keysCached.add(keys);
        }
        return keys;
    }
    const addIfFound = (set, obj, key)=>{
        const opts = resolveObjectKey(obj, key);
        if (opts !== undefined) {
            set.add(opts);
        }
    };
    class Config {
        constructor(config){
            this._config = initConfig(config);
            this._scopeCache = new Map();
            this._resolverCache = new Map();
        }
        get platform() {
            return this._config.platform;
        }
        get type() {
            return this._config.type;
        }
        set type(type) {
            this._config.type = type;
        }
        get data() {
            return this._config.data;
        }
        set data(data) {
            this._config.data = initData(data);
        }
        get options() {
            return this._config.options;
        }
        set options(options) {
            this._config.options = options;
        }
        get plugins() {
            return this._config.plugins;
        }
        update() {
            const config = this._config;
            this.clearCache();
            initOptions(config);
        }
        clearCache() {
            this._scopeCache.clear();
            this._resolverCache.clear();
        }
     datasetScopeKeys(datasetType) {
            return cachedKeys(datasetType, ()=>[
                    [
                        `datasets.${datasetType}`,
                        ''
                    ]
                ]);
        }
     datasetAnimationScopeKeys(datasetType, transition) {
            return cachedKeys(`${datasetType}.transition.${transition}`, ()=>[
                    [
                        `datasets.${datasetType}.transitions.${transition}`,
                        `transitions.${transition}`
                    ],
                    [
                        `datasets.${datasetType}`,
                        ''
                    ]
                ]);
        }
     datasetElementScopeKeys(datasetType, elementType) {
            return cachedKeys(`${datasetType}-${elementType}`, ()=>[
                    [
                        `datasets.${datasetType}.elements.${elementType}`,
                        `datasets.${datasetType}`,
                        `elements.${elementType}`,
                        ''
                    ]
                ]);
        }
     pluginScopeKeys(plugin) {
            const id = plugin.id;
            const type = this.type;
            return cachedKeys(`${type}-plugin-${id}`, ()=>[
                    [
                        `plugins.${id}`,
                        ...plugin.additionalOptionScopes || []
                    ]
                ]);
        }
     _cachedScopes(mainScope, resetCache) {
            const _scopeCache = this._scopeCache;
            let cache = _scopeCache.get(mainScope);
            if (!cache || resetCache) {
                cache = new Map();
                _scopeCache.set(mainScope, cache);
            }
            return cache;
        }
     getOptionScopes(mainScope, keyLists, resetCache) {
            const { options , type  } = this;
            const cache = this._cachedScopes(mainScope, resetCache);
            const cached = cache.get(keyLists);
            if (cached) {
                return cached;
            }
            const scopes = new Set();
            keyLists.forEach((keys)=>{
                if (mainScope) {
                    scopes.add(mainScope);
                    keys.forEach((key)=>addIfFound(scopes, mainScope, key));
                }
                keys.forEach((key)=>addIfFound(scopes, options, key));
                keys.forEach((key)=>addIfFound(scopes, overrides[type] || {}, key));
                keys.forEach((key)=>addIfFound(scopes, defaults, key));
                keys.forEach((key)=>addIfFound(scopes, descriptors, key));
            });
            const array = Array.from(scopes);
            if (array.length === 0) {
                array.push(Object.create(null));
            }
            if (keysCached.has(keyLists)) {
                cache.set(keyLists, array);
            }
            return array;
        }
     chartOptionScopes() {
            const { options , type  } = this;
            return [
                options,
                overrides[type] || {},
                defaults.datasets[type] || {},
                {
                    type
                },
                defaults,
                descriptors
            ];
        }
     resolveNamedOptions(scopes, names, context, prefixes = [
            ''
        ]) {
            const result = {
                $shared: true
            };
            const { resolver , subPrefixes  } = getResolver(this._resolverCache, scopes, prefixes);
            let options = resolver;
            if (needContext(resolver, names)) {
                result.$shared = false;
                context = isFunction(context) ? context() : context;
                const subResolver = this.createResolver(scopes, context, subPrefixes);
                options = _attachContext(resolver, context, subResolver);
            }
            for (const prop of names){
                result[prop] = options[prop];
            }
            return result;
        }
     createResolver(scopes, context, prefixes = [
            ''
        ], descriptorDefaults) {
            const { resolver  } = getResolver(this._resolverCache, scopes, prefixes);
            return isObject(context) ? _attachContext(resolver, context, undefined, descriptorDefaults) : resolver;
        }
    }
    function getResolver(resolverCache, scopes, prefixes) {
        let cache = resolverCache.get(scopes);
        if (!cache) {
            cache = new Map();
            resolverCache.set(scopes, cache);
        }
        const cacheKey = prefixes.join();
        let cached = cache.get(cacheKey);
        if (!cached) {
            const resolver = _createResolver(scopes, prefixes);
            cached = {
                resolver,
                subPrefixes: prefixes.filter((p)=>!p.toLowerCase().includes('hover'))
            };
            cache.set(cacheKey, cached);
        }
        return cached;
    }
    const hasFunction = (value)=>isObject(value) && Object.getOwnPropertyNames(value).some((key)=>isFunction(value[key]));
    function needContext(proxy, names) {
        const { isScriptable , isIndexable  } = _descriptors(proxy);
        for (const prop of names){
            const scriptable = isScriptable(prop);
            const indexable = isIndexable(prop);
            const value = (indexable || scriptable) && proxy[prop];
            if (scriptable && (isFunction(value) || hasFunction(value)) || indexable && isArray(value)) {
                return true;
            }
        }
        return false;
    }

    var version = "4.5.1";

    const KNOWN_POSITIONS = [
        'top',
        'bottom',
        'left',
        'right',
        'chartArea'
    ];
    function positionIsHorizontal(position, axis) {
        return position === 'top' || position === 'bottom' || KNOWN_POSITIONS.indexOf(position) === -1 && axis === 'x';
    }
    function compare2Level(l1, l2) {
        return function(a, b) {
            return a[l1] === b[l1] ? a[l2] - b[l2] : a[l1] - b[l1];
        };
    }
    function onAnimationsComplete(context) {
        const chart = context.chart;
        const animationOptions = chart.options.animation;
        chart.notifyPlugins('afterRender');
        callback(animationOptions && animationOptions.onComplete, [
            context
        ], chart);
    }
    function onAnimationProgress(context) {
        const chart = context.chart;
        const animationOptions = chart.options.animation;
        callback(animationOptions && animationOptions.onProgress, [
            context
        ], chart);
    }
     function getCanvas(item) {
        if (_isDomSupported() && typeof item === 'string') {
            item = document.getElementById(item);
        } else if (item && item.length) {
            item = item[0];
        }
        if (item && item.canvas) {
            item = item.canvas;
        }
        return item;
    }
    const instances = {};
    const getChart = (key)=>{
        const canvas = getCanvas(key);
        return Object.values(instances).filter((c)=>c.canvas === canvas).pop();
    };
    function moveNumericKeys(obj, start, move) {
        const keys = Object.keys(obj);
        for (const key of keys){
            const intKey = +key;
            if (intKey >= start) {
                const value = obj[key];
                delete obj[key];
                if (move > 0 || intKey > start) {
                    obj[intKey + move] = value;
                }
            }
        }
    }
     function determineLastEvent(e, lastEvent, inChartArea, isClick) {
        if (!inChartArea || e.type === 'mouseout') {
            return null;
        }
        if (isClick) {
            return lastEvent;
        }
        return e;
    }
    class Chart {
        static defaults = defaults;
        static instances = instances;
        static overrides = overrides;
        static registry = registry;
        static version = version;
        static getChart = getChart;
        static register(...items) {
            registry.add(...items);
            invalidatePlugins();
        }
        static unregister(...items) {
            registry.remove(...items);
            invalidatePlugins();
        }
        constructor(item, userConfig){
            const config = this.config = new Config(userConfig);
            const initialCanvas = getCanvas(item);
            const existingChart = getChart(initialCanvas);
            if (existingChart) {
                throw new Error('Canvas is already in use. Chart with ID \'' + existingChart.id + '\'' + ' must be destroyed before the canvas with ID \'' + existingChart.canvas.id + '\' can be reused.');
            }
            const options = config.createResolver(config.chartOptionScopes(), this.getContext());
            this.platform = new (config.platform || _detectPlatform(initialCanvas))();
            this.platform.updateConfig(config);
            const context = this.platform.acquireContext(initialCanvas, options.aspectRatio);
            const canvas = context && context.canvas;
            const height = canvas && canvas.height;
            const width = canvas && canvas.width;
            this.id = uid();
            this.ctx = context;
            this.canvas = canvas;
            this.width = width;
            this.height = height;
            this._options = options;
            this._aspectRatio = this.aspectRatio;
            this._layers = [];
            this._metasets = [];
            this._stacks = undefined;
            this.boxes = [];
            this.currentDevicePixelRatio = undefined;
            this.chartArea = undefined;
            this._active = [];
            this._lastEvent = undefined;
            this._listeners = {};
             this._responsiveListeners = undefined;
            this._sortedMetasets = [];
            this.scales = {};
            this._plugins = new PluginService();
            this.$proxies = {};
            this._hiddenIndices = {};
            this.attached = false;
            this._animationsDisabled = undefined;
            this.$context = undefined;
            this._doResize = debounce((mode)=>this.update(mode), options.resizeDelay || 0);
            this._dataChanges = [];
            instances[this.id] = this;
            if (!context || !canvas) {
                console.error("Failed to create chart: can't acquire context from the given item");
                return;
            }
            animator.listen(this, 'complete', onAnimationsComplete);
            animator.listen(this, 'progress', onAnimationProgress);
            this._initialize();
            if (this.attached) {
                this.update();
            }
        }
        get aspectRatio() {
            const { options: { aspectRatio , maintainAspectRatio  } , width , height , _aspectRatio  } = this;
            if (!isNullOrUndef(aspectRatio)) {
                return aspectRatio;
            }
            if (maintainAspectRatio && _aspectRatio) {
                return _aspectRatio;
            }
            return height ? width / height : null;
        }
        get data() {
            return this.config.data;
        }
        set data(data) {
            this.config.data = data;
        }
        get options() {
            return this._options;
        }
        set options(options) {
            this.config.options = options;
        }
        get registry() {
            return registry;
        }
     _initialize() {
            this.notifyPlugins('beforeInit');
            if (this.options.responsive) {
                this.resize();
            } else {
                retinaScale(this, this.options.devicePixelRatio);
            }
            this.bindEvents();
            this.notifyPlugins('afterInit');
            return this;
        }
        clear() {
            clearCanvas(this.canvas, this.ctx);
            return this;
        }
        stop() {
            animator.stop(this);
            return this;
        }
     resize(width, height) {
            if (!animator.running(this)) {
                this._resize(width, height);
            } else {
                this._resizeBeforeDraw = {
                    width,
                    height
                };
            }
        }
        _resize(width, height) {
            const options = this.options;
            const canvas = this.canvas;
            const aspectRatio = options.maintainAspectRatio && this.aspectRatio;
            const newSize = this.platform.getMaximumSize(canvas, width, height, aspectRatio);
            const newRatio = options.devicePixelRatio || this.platform.getDevicePixelRatio();
            const mode = this.width ? 'resize' : 'attach';
            this.width = newSize.width;
            this.height = newSize.height;
            this._aspectRatio = this.aspectRatio;
            if (!retinaScale(this, newRatio, true)) {
                return;
            }
            this.notifyPlugins('resize', {
                size: newSize
            });
            callback(options.onResize, [
                this,
                newSize
            ], this);
            if (this.attached) {
                if (this._doResize(mode)) {
                    this.render();
                }
            }
        }
        ensureScalesHaveIDs() {
            const options = this.options;
            const scalesOptions = options.scales || {};
            each(scalesOptions, (axisOptions, axisID)=>{
                axisOptions.id = axisID;
            });
        }
     buildOrUpdateScales() {
            const options = this.options;
            const scaleOpts = options.scales;
            const scales = this.scales;
            const updated = Object.keys(scales).reduce((obj, id)=>{
                obj[id] = false;
                return obj;
            }, {});
            let items = [];
            if (scaleOpts) {
                items = items.concat(Object.keys(scaleOpts).map((id)=>{
                    const scaleOptions = scaleOpts[id];
                    const axis = determineAxis(id, scaleOptions);
                    const isRadial = axis === 'r';
                    const isHorizontal = axis === 'x';
                    return {
                        options: scaleOptions,
                        dposition: isRadial ? 'chartArea' : isHorizontal ? 'bottom' : 'left',
                        dtype: isRadial ? 'radialLinear' : isHorizontal ? 'category' : 'linear'
                    };
                }));
            }
            each(items, (item)=>{
                const scaleOptions = item.options;
                const id = scaleOptions.id;
                const axis = determineAxis(id, scaleOptions);
                const scaleType = valueOrDefault(scaleOptions.type, item.dtype);
                if (scaleOptions.position === undefined || positionIsHorizontal(scaleOptions.position, axis) !== positionIsHorizontal(item.dposition)) {
                    scaleOptions.position = item.dposition;
                }
                updated[id] = true;
                let scale = null;
                if (id in scales && scales[id].type === scaleType) {
                    scale = scales[id];
                } else {
                    const scaleClass = registry.getScale(scaleType);
                    scale = new scaleClass({
                        id,
                        type: scaleType,
                        ctx: this.ctx,
                        chart: this
                    });
                    scales[scale.id] = scale;
                }
                scale.init(scaleOptions, options);
            });
            each(updated, (hasUpdated, id)=>{
                if (!hasUpdated) {
                    delete scales[id];
                }
            });
            each(scales, (scale)=>{
                layouts.configure(this, scale, scale.options);
                layouts.addBox(this, scale);
            });
        }
     _updateMetasets() {
            const metasets = this._metasets;
            const numData = this.data.datasets.length;
            const numMeta = metasets.length;
            metasets.sort((a, b)=>a.index - b.index);
            if (numMeta > numData) {
                for(let i = numData; i < numMeta; ++i){
                    this._destroyDatasetMeta(i);
                }
                metasets.splice(numData, numMeta - numData);
            }
            this._sortedMetasets = metasets.slice(0).sort(compare2Level('order', 'index'));
        }
     _removeUnreferencedMetasets() {
            const { _metasets: metasets , data: { datasets  }  } = this;
            if (metasets.length > datasets.length) {
                delete this._stacks;
            }
            metasets.forEach((meta, index)=>{
                if (datasets.filter((x)=>x === meta._dataset).length === 0) {
                    this._destroyDatasetMeta(index);
                }
            });
        }
        buildOrUpdateControllers() {
            const newControllers = [];
            const datasets = this.data.datasets;
            let i, ilen;
            this._removeUnreferencedMetasets();
            for(i = 0, ilen = datasets.length; i < ilen; i++){
                const dataset = datasets[i];
                let meta = this.getDatasetMeta(i);
                const type = dataset.type || this.config.type;
                if (meta.type && meta.type !== type) {
                    this._destroyDatasetMeta(i);
                    meta = this.getDatasetMeta(i);
                }
                meta.type = type;
                meta.indexAxis = dataset.indexAxis || getIndexAxis(type, this.options);
                meta.order = dataset.order || 0;
                meta.index = i;
                meta.label = '' + dataset.label;
                meta.visible = this.isDatasetVisible(i);
                if (meta.controller) {
                    meta.controller.updateIndex(i);
                    meta.controller.linkScales();
                } else {
                    const ControllerClass = registry.getController(type);
                    const { datasetElementType , dataElementType  } = defaults.datasets[type];
                    Object.assign(ControllerClass, {
                        dataElementType: registry.getElement(dataElementType),
                        datasetElementType: datasetElementType && registry.getElement(datasetElementType)
                    });
                    meta.controller = new ControllerClass(this, i);
                    newControllers.push(meta.controller);
                }
            }
            this._updateMetasets();
            return newControllers;
        }
     _resetElements() {
            each(this.data.datasets, (dataset, datasetIndex)=>{
                this.getDatasetMeta(datasetIndex).controller.reset();
            }, this);
        }
     reset() {
            this._resetElements();
            this.notifyPlugins('reset');
        }
        update(mode) {
            const config = this.config;
            config.update();
            const options = this._options = config.createResolver(config.chartOptionScopes(), this.getContext());
            const animsDisabled = this._animationsDisabled = !options.animation;
            this._updateScales();
            this._checkEventBindings();
            this._updateHiddenIndices();
            this._plugins.invalidate();
            if (this.notifyPlugins('beforeUpdate', {
                mode,
                cancelable: true
            }) === false) {
                return;
            }
            const newControllers = this.buildOrUpdateControllers();
            this.notifyPlugins('beforeElementsUpdate');
            let minPadding = 0;
            for(let i = 0, ilen = this.data.datasets.length; i < ilen; i++){
                const { controller  } = this.getDatasetMeta(i);
                const reset = !animsDisabled && newControllers.indexOf(controller) === -1;
                controller.buildOrUpdateElements(reset);
                minPadding = Math.max(+controller.getMaxOverflow(), minPadding);
            }
            minPadding = this._minPadding = options.layout.autoPadding ? minPadding : 0;
            this._updateLayout(minPadding);
            if (!animsDisabled) {
                each(newControllers, (controller)=>{
                    controller.reset();
                });
            }
            this._updateDatasets(mode);
            this.notifyPlugins('afterUpdate', {
                mode
            });
            this._layers.sort(compare2Level('z', '_idx'));
            const { _active , _lastEvent  } = this;
            if (_lastEvent) {
                this._eventHandler(_lastEvent, true);
            } else if (_active.length) {
                this._updateHoverStyles(_active, _active, true);
            }
            this.render();
        }
     _updateScales() {
            each(this.scales, (scale)=>{
                layouts.removeBox(this, scale);
            });
            this.ensureScalesHaveIDs();
            this.buildOrUpdateScales();
        }
     _checkEventBindings() {
            const options = this.options;
            const existingEvents = new Set(Object.keys(this._listeners));
            const newEvents = new Set(options.events);
            if (!setsEqual(existingEvents, newEvents) || !!this._responsiveListeners !== options.responsive) {
                this.unbindEvents();
                this.bindEvents();
            }
        }
     _updateHiddenIndices() {
            const { _hiddenIndices  } = this;
            const changes = this._getUniformDataChanges() || [];
            for (const { method , start , count  } of changes){
                const move = method === '_removeElements' ? -count : count;
                moveNumericKeys(_hiddenIndices, start, move);
            }
        }
     _getUniformDataChanges() {
            const _dataChanges = this._dataChanges;
            if (!_dataChanges || !_dataChanges.length) {
                return;
            }
            this._dataChanges = [];
            const datasetCount = this.data.datasets.length;
            const makeSet = (idx)=>new Set(_dataChanges.filter((c)=>c[0] === idx).map((c, i)=>i + ',' + c.splice(1).join(',')));
            const changeSet = makeSet(0);
            for(let i = 1; i < datasetCount; i++){
                if (!setsEqual(changeSet, makeSet(i))) {
                    return;
                }
            }
            return Array.from(changeSet).map((c)=>c.split(',')).map((a)=>({
                    method: a[1],
                    start: +a[2],
                    count: +a[3]
                }));
        }
     _updateLayout(minPadding) {
            if (this.notifyPlugins('beforeLayout', {
                cancelable: true
            }) === false) {
                return;
            }
            layouts.update(this, this.width, this.height, minPadding);
            const area = this.chartArea;
            const noArea = area.width <= 0 || area.height <= 0;
            this._layers = [];
            each(this.boxes, (box)=>{
                if (noArea && box.position === 'chartArea') {
                    return;
                }
                if (box.configure) {
                    box.configure();
                }
                this._layers.push(...box._layers());
            }, this);
            this._layers.forEach((item, index)=>{
                item._idx = index;
            });
            this.notifyPlugins('afterLayout');
        }
     _updateDatasets(mode) {
            if (this.notifyPlugins('beforeDatasetsUpdate', {
                mode,
                cancelable: true
            }) === false) {
                return;
            }
            for(let i = 0, ilen = this.data.datasets.length; i < ilen; ++i){
                this.getDatasetMeta(i).controller.configure();
            }
            for(let i = 0, ilen = this.data.datasets.length; i < ilen; ++i){
                this._updateDataset(i, isFunction(mode) ? mode({
                    datasetIndex: i
                }) : mode);
            }
            this.notifyPlugins('afterDatasetsUpdate', {
                mode
            });
        }
     _updateDataset(index, mode) {
            const meta = this.getDatasetMeta(index);
            const args = {
                meta,
                index,
                mode,
                cancelable: true
            };
            if (this.notifyPlugins('beforeDatasetUpdate', args) === false) {
                return;
            }
            meta.controller._update(mode);
            args.cancelable = false;
            this.notifyPlugins('afterDatasetUpdate', args);
        }
        render() {
            if (this.notifyPlugins('beforeRender', {
                cancelable: true
            }) === false) {
                return;
            }
            if (animator.has(this)) {
                if (this.attached && !animator.running(this)) {
                    animator.start(this);
                }
            } else {
                this.draw();
                onAnimationsComplete({
                    chart: this
                });
            }
        }
        draw() {
            let i;
            if (this._resizeBeforeDraw) {
                const { width , height  } = this._resizeBeforeDraw;
                this._resizeBeforeDraw = null;
                this._resize(width, height);
            }
            this.clear();
            if (this.width <= 0 || this.height <= 0) {
                return;
            }
            if (this.notifyPlugins('beforeDraw', {
                cancelable: true
            }) === false) {
                return;
            }
            const layers = this._layers;
            for(i = 0; i < layers.length && layers[i].z <= 0; ++i){
                layers[i].draw(this.chartArea);
            }
            this._drawDatasets();
            for(; i < layers.length; ++i){
                layers[i].draw(this.chartArea);
            }
            this.notifyPlugins('afterDraw');
        }
     _getSortedDatasetMetas(filterVisible) {
            const metasets = this._sortedMetasets;
            const result = [];
            let i, ilen;
            for(i = 0, ilen = metasets.length; i < ilen; ++i){
                const meta = metasets[i];
                if (!filterVisible || meta.visible) {
                    result.push(meta);
                }
            }
            return result;
        }
     getSortedVisibleDatasetMetas() {
            return this._getSortedDatasetMetas(true);
        }
     _drawDatasets() {
            if (this.notifyPlugins('beforeDatasetsDraw', {
                cancelable: true
            }) === false) {
                return;
            }
            const metasets = this.getSortedVisibleDatasetMetas();
            for(let i = metasets.length - 1; i >= 0; --i){
                this._drawDataset(metasets[i]);
            }
            this.notifyPlugins('afterDatasetsDraw');
        }
     _drawDataset(meta) {
            const ctx = this.ctx;
            const args = {
                meta,
                index: meta.index,
                cancelable: true
            };
            const clip = getDatasetClipArea(this, meta);
            if (this.notifyPlugins('beforeDatasetDraw', args) === false) {
                return;
            }
            if (clip) {
                clipArea(ctx, clip);
            }
            meta.controller.draw();
            if (clip) {
                unclipArea(ctx);
            }
            args.cancelable = false;
            this.notifyPlugins('afterDatasetDraw', args);
        }
     isPointInArea(point) {
            return _isPointInArea(point, this.chartArea, this._minPadding);
        }
        getElementsAtEventForMode(e, mode, options, useFinalPosition) {
            const method = Interaction.modes[mode];
            if (typeof method === 'function') {
                return method(this, e, options, useFinalPosition);
            }
            return [];
        }
        getDatasetMeta(datasetIndex) {
            const dataset = this.data.datasets[datasetIndex];
            const metasets = this._metasets;
            let meta = metasets.filter((x)=>x && x._dataset === dataset).pop();
            if (!meta) {
                meta = {
                    type: null,
                    data: [],
                    dataset: null,
                    controller: null,
                    hidden: null,
                    xAxisID: null,
                    yAxisID: null,
                    order: dataset && dataset.order || 0,
                    index: datasetIndex,
                    _dataset: dataset,
                    _parsed: [],
                    _sorted: false
                };
                metasets.push(meta);
            }
            return meta;
        }
        getContext() {
            return this.$context || (this.$context = createContext(null, {
                chart: this,
                type: 'chart'
            }));
        }
        getVisibleDatasetCount() {
            return this.getSortedVisibleDatasetMetas().length;
        }
        isDatasetVisible(datasetIndex) {
            const dataset = this.data.datasets[datasetIndex];
            if (!dataset) {
                return false;
            }
            const meta = this.getDatasetMeta(datasetIndex);
            return typeof meta.hidden === 'boolean' ? !meta.hidden : !dataset.hidden;
        }
        setDatasetVisibility(datasetIndex, visible) {
            const meta = this.getDatasetMeta(datasetIndex);
            meta.hidden = !visible;
        }
        toggleDataVisibility(index) {
            this._hiddenIndices[index] = !this._hiddenIndices[index];
        }
        getDataVisibility(index) {
            return !this._hiddenIndices[index];
        }
     _updateVisibility(datasetIndex, dataIndex, visible) {
            const mode = visible ? 'show' : 'hide';
            const meta = this.getDatasetMeta(datasetIndex);
            const anims = meta.controller._resolveAnimations(undefined, mode);
            if (defined(dataIndex)) {
                meta.data[dataIndex].hidden = !visible;
                this.update();
            } else {
                this.setDatasetVisibility(datasetIndex, visible);
                anims.update(meta, {
                    visible
                });
                this.update((ctx)=>ctx.datasetIndex === datasetIndex ? mode : undefined);
            }
        }
        hide(datasetIndex, dataIndex) {
            this._updateVisibility(datasetIndex, dataIndex, false);
        }
        show(datasetIndex, dataIndex) {
            this._updateVisibility(datasetIndex, dataIndex, true);
        }
     _destroyDatasetMeta(datasetIndex) {
            const meta = this._metasets[datasetIndex];
            if (meta && meta.controller) {
                meta.controller._destroy();
            }
            delete this._metasets[datasetIndex];
        }
        _stop() {
            let i, ilen;
            this.stop();
            animator.remove(this);
            for(i = 0, ilen = this.data.datasets.length; i < ilen; ++i){
                this._destroyDatasetMeta(i);
            }
        }
        destroy() {
            this.notifyPlugins('beforeDestroy');
            const { canvas , ctx  } = this;
            this._stop();
            this.config.clearCache();
            if (canvas) {
                this.unbindEvents();
                clearCanvas(canvas, ctx);
                this.platform.releaseContext(ctx);
                this.canvas = null;
                this.ctx = null;
            }
            delete instances[this.id];
            this.notifyPlugins('afterDestroy');
        }
        toBase64Image(...args) {
            return this.canvas.toDataURL(...args);
        }
     bindEvents() {
            this.bindUserEvents();
            if (this.options.responsive) {
                this.bindResponsiveEvents();
            } else {
                this.attached = true;
            }
        }
     bindUserEvents() {
            const listeners = this._listeners;
            const platform = this.platform;
            const _add = (type, listener)=>{
                platform.addEventListener(this, type, listener);
                listeners[type] = listener;
            };
            const listener = (e, x, y)=>{
                e.offsetX = x;
                e.offsetY = y;
                this._eventHandler(e);
            };
            each(this.options.events, (type)=>_add(type, listener));
        }
     bindResponsiveEvents() {
            if (!this._responsiveListeners) {
                this._responsiveListeners = {};
            }
            const listeners = this._responsiveListeners;
            const platform = this.platform;
            const _add = (type, listener)=>{
                platform.addEventListener(this, type, listener);
                listeners[type] = listener;
            };
            const _remove = (type, listener)=>{
                if (listeners[type]) {
                    platform.removeEventListener(this, type, listener);
                    delete listeners[type];
                }
            };
            const listener = (width, height)=>{
                if (this.canvas) {
                    this.resize(width, height);
                }
            };
            let detached;
            const attached = ()=>{
                _remove('attach', attached);
                this.attached = true;
                this.resize();
                _add('resize', listener);
                _add('detach', detached);
            };
            detached = ()=>{
                this.attached = false;
                _remove('resize', listener);
                this._stop();
                this._resize(0, 0);
                _add('attach', attached);
            };
            if (platform.isAttached(this.canvas)) {
                attached();
            } else {
                detached();
            }
        }
     unbindEvents() {
            each(this._listeners, (listener, type)=>{
                this.platform.removeEventListener(this, type, listener);
            });
            this._listeners = {};
            each(this._responsiveListeners, (listener, type)=>{
                this.platform.removeEventListener(this, type, listener);
            });
            this._responsiveListeners = undefined;
        }
        updateHoverStyle(items, mode, enabled) {
            const prefix = enabled ? 'set' : 'remove';
            let meta, item, i, ilen;
            if (mode === 'dataset') {
                meta = this.getDatasetMeta(items[0].datasetIndex);
                meta.controller['_' + prefix + 'DatasetHoverStyle']();
            }
            for(i = 0, ilen = items.length; i < ilen; ++i){
                item = items[i];
                const controller = item && this.getDatasetMeta(item.datasetIndex).controller;
                if (controller) {
                    controller[prefix + 'HoverStyle'](item.element, item.datasetIndex, item.index);
                }
            }
        }
     getActiveElements() {
            return this._active || [];
        }
     setActiveElements(activeElements) {
            const lastActive = this._active || [];
            const active = activeElements.map(({ datasetIndex , index  })=>{
                const meta = this.getDatasetMeta(datasetIndex);
                if (!meta) {
                    throw new Error('No dataset found at index ' + datasetIndex);
                }
                return {
                    datasetIndex,
                    element: meta.data[index],
                    index
                };
            });
            const changed = !_elementsEqual(active, lastActive);
            if (changed) {
                this._active = active;
                this._lastEvent = null;
                this._updateHoverStyles(active, lastActive);
            }
        }
     notifyPlugins(hook, args, filter) {
            return this._plugins.notify(this, hook, args, filter);
        }
     isPluginEnabled(pluginId) {
            return this._plugins._cache.filter((p)=>p.plugin.id === pluginId).length === 1;
        }
     _updateHoverStyles(active, lastActive, replay) {
            const hoverOptions = this.options.hover;
            const diff = (a, b)=>a.filter((x)=>!b.some((y)=>x.datasetIndex === y.datasetIndex && x.index === y.index));
            const deactivated = diff(lastActive, active);
            const activated = replay ? active : diff(active, lastActive);
            if (deactivated.length) {
                this.updateHoverStyle(deactivated, hoverOptions.mode, false);
            }
            if (activated.length && hoverOptions.mode) {
                this.updateHoverStyle(activated, hoverOptions.mode, true);
            }
        }
     _eventHandler(e, replay) {
            const args = {
                event: e,
                replay,
                cancelable: true,
                inChartArea: this.isPointInArea(e)
            };
            const eventFilter = (plugin)=>(plugin.options.events || this.options.events).includes(e.native.type);
            if (this.notifyPlugins('beforeEvent', args, eventFilter) === false) {
                return;
            }
            const changed = this._handleEvent(e, replay, args.inChartArea);
            args.cancelable = false;
            this.notifyPlugins('afterEvent', args, eventFilter);
            if (changed || args.changed) {
                this.render();
            }
            return this;
        }
     _handleEvent(e, replay, inChartArea) {
            const { _active: lastActive = [] , options  } = this;
            const useFinalPosition = replay;
            const active = this._getActiveElements(e, lastActive, inChartArea, useFinalPosition);
            const isClick = _isClickEvent(e);
            const lastEvent = determineLastEvent(e, this._lastEvent, inChartArea, isClick);
            if (inChartArea) {
                this._lastEvent = null;
                callback(options.onHover, [
                    e,
                    active,
                    this
                ], this);
                if (isClick) {
                    callback(options.onClick, [
                        e,
                        active,
                        this
                    ], this);
                }
            }
            const changed = !_elementsEqual(active, lastActive);
            if (changed || replay) {
                this._active = active;
                this._updateHoverStyles(active, lastActive, replay);
            }
            this._lastEvent = lastEvent;
            return changed;
        }
     _getActiveElements(e, lastActive, inChartArea, useFinalPosition) {
            if (e.type === 'mouseout') {
                return [];
            }
            if (!inChartArea) {
                return lastActive;
            }
            const hoverOptions = this.options.hover;
            return this.getElementsAtEventForMode(e, hoverOptions.mode, hoverOptions, useFinalPosition);
        }
    }
    function invalidatePlugins() {
        return each(Chart.instances, (chart)=>chart._plugins.invalidate());
    }

    function clipSelf(ctx, element, endAngle) {
        const { startAngle , x , y , outerRadius , innerRadius , options  } = element;
        const { borderWidth , borderJoinStyle  } = options;
        const outerAngleClip = Math.min(borderWidth / outerRadius, _normalizeAngle(startAngle - endAngle));
        ctx.beginPath();
        ctx.arc(x, y, outerRadius - borderWidth / 2, startAngle + outerAngleClip / 2, endAngle - outerAngleClip / 2);
        if (innerRadius > 0) {
            const innerAngleClip = Math.min(borderWidth / innerRadius, _normalizeAngle(startAngle - endAngle));
            ctx.arc(x, y, innerRadius + borderWidth / 2, endAngle - innerAngleClip / 2, startAngle + innerAngleClip / 2, true);
        } else {
            const clipWidth = Math.min(borderWidth / 2, outerRadius * _normalizeAngle(startAngle - endAngle));
            if (borderJoinStyle === 'round') {
                ctx.arc(x, y, clipWidth, endAngle - PI / 2, startAngle + PI / 2, true);
            } else if (borderJoinStyle === 'bevel') {
                const r = 2 * clipWidth * clipWidth;
                const endX = -r * Math.cos(endAngle + PI / 2) + x;
                const endY = -r * Math.sin(endAngle + PI / 2) + y;
                const startX = r * Math.cos(startAngle + PI / 2) + x;
                const startY = r * Math.sin(startAngle + PI / 2) + y;
                ctx.lineTo(endX, endY);
                ctx.lineTo(startX, startY);
            }
        }
        ctx.closePath();
        ctx.moveTo(0, 0);
        ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.clip('evenodd');
    }
    function clipArc(ctx, element, endAngle) {
        const { startAngle , pixelMargin , x , y , outerRadius , innerRadius  } = element;
        let angleMargin = pixelMargin / outerRadius;
        // Draw an inner border by clipping the arc and drawing a double-width border
        // Enlarge the clipping arc by 0.33 pixels to eliminate glitches between borders
        ctx.beginPath();
        ctx.arc(x, y, outerRadius, startAngle - angleMargin, endAngle + angleMargin);
        if (innerRadius > pixelMargin) {
            angleMargin = pixelMargin / innerRadius;
            ctx.arc(x, y, innerRadius, endAngle + angleMargin, startAngle - angleMargin, true);
        } else {
            ctx.arc(x, y, pixelMargin, endAngle + HALF_PI, startAngle - HALF_PI);
        }
        ctx.closePath();
        ctx.clip();
    }
    function toRadiusCorners(value) {
        return _readValueToProps(value, [
            'outerStart',
            'outerEnd',
            'innerStart',
            'innerEnd'
        ]);
    }
    /**
     * Parse border radius from the provided options
     */ function parseBorderRadius$1(arc, innerRadius, outerRadius, angleDelta) {
        const o = toRadiusCorners(arc.options.borderRadius);
        const halfThickness = (outerRadius - innerRadius) / 2;
        const innerLimit = Math.min(halfThickness, angleDelta * innerRadius / 2);
        // Outer limits are complicated. We want to compute the available angular distance at
        // a radius of outerRadius - borderRadius because for small angular distances, this term limits.
        // We compute at r = outerRadius - borderRadius because this circle defines the center of the border corners.
        //
        // If the borderRadius is large, that value can become negative.
        // This causes the outer borders to lose their radius entirely, which is rather unexpected. To solve that, if borderRadius > outerRadius
        // we know that the thickness term will dominate and compute the limits at that point
        const computeOuterLimit = (val)=>{
            const outerArcLimit = (outerRadius - Math.min(halfThickness, val)) * angleDelta / 2;
            return _limitValue(val, 0, Math.min(halfThickness, outerArcLimit));
        };
        return {
            outerStart: computeOuterLimit(o.outerStart),
            outerEnd: computeOuterLimit(o.outerEnd),
            innerStart: _limitValue(o.innerStart, 0, innerLimit),
            innerEnd: _limitValue(o.innerEnd, 0, innerLimit)
        };
    }
    /**
     * Convert (r, 𝜃) to (x, y)
     */ function rThetaToXY(r, theta, x, y) {
        return {
            x: x + r * Math.cos(theta),
            y: y + r * Math.sin(theta)
        };
    }
    /**
     * Path the arc, respecting border radius by separating into left and right halves.
     *
     *   Start      End
     *
     *    1--->a--->2    Outer
     *   /           \
     *   8           3
     *   |           |
     *   |           |
     *   7           4
     *   \           /
     *    6<---b<---5    Inner
     */ function pathArc(ctx, element, offset, spacing, end, circular) {
        const { x , y , startAngle: start , pixelMargin , innerRadius: innerR  } = element;
        const outerRadius = Math.max(element.outerRadius + spacing + offset - pixelMargin, 0);
        const innerRadius = innerR > 0 ? innerR + spacing + offset + pixelMargin : 0;
        let spacingOffset = 0;
        const alpha = end - start;
        if (spacing) {
            // When spacing is present, it is the same for all items
            // So we adjust the start and end angle of the arc such that
            // the distance is the same as it would be without the spacing
            const noSpacingInnerRadius = innerR > 0 ? innerR - spacing : 0;
            const noSpacingOuterRadius = outerRadius > 0 ? outerRadius - spacing : 0;
            const avNogSpacingRadius = (noSpacingInnerRadius + noSpacingOuterRadius) / 2;
            const adjustedAngle = avNogSpacingRadius !== 0 ? alpha * avNogSpacingRadius / (avNogSpacingRadius + spacing) : alpha;
            spacingOffset = (alpha - adjustedAngle) / 2;
        }
        const beta = Math.max(0.001, alpha * outerRadius - offset / PI) / outerRadius;
        const angleOffset = (alpha - beta) / 2;
        const startAngle = start + angleOffset + spacingOffset;
        const endAngle = end - angleOffset - spacingOffset;
        const { outerStart , outerEnd , innerStart , innerEnd  } = parseBorderRadius$1(element, innerRadius, outerRadius, endAngle - startAngle);
        const outerStartAdjustedRadius = outerRadius - outerStart;
        const outerEndAdjustedRadius = outerRadius - outerEnd;
        const outerStartAdjustedAngle = startAngle + outerStart / outerStartAdjustedRadius;
        const outerEndAdjustedAngle = endAngle - outerEnd / outerEndAdjustedRadius;
        const innerStartAdjustedRadius = innerRadius + innerStart;
        const innerEndAdjustedRadius = innerRadius + innerEnd;
        const innerStartAdjustedAngle = startAngle + innerStart / innerStartAdjustedRadius;
        const innerEndAdjustedAngle = endAngle - innerEnd / innerEndAdjustedRadius;
        ctx.beginPath();
        if (circular) {
            // The first arc segments from point 1 to point a to point 2
            const outerMidAdjustedAngle = (outerStartAdjustedAngle + outerEndAdjustedAngle) / 2;
            ctx.arc(x, y, outerRadius, outerStartAdjustedAngle, outerMidAdjustedAngle);
            ctx.arc(x, y, outerRadius, outerMidAdjustedAngle, outerEndAdjustedAngle);
            // The corner segment from point 2 to point 3
            if (outerEnd > 0) {
                const pCenter = rThetaToXY(outerEndAdjustedRadius, outerEndAdjustedAngle, x, y);
                ctx.arc(pCenter.x, pCenter.y, outerEnd, outerEndAdjustedAngle, endAngle + HALF_PI);
            }
            // The line from point 3 to point 4
            const p4 = rThetaToXY(innerEndAdjustedRadius, endAngle, x, y);
            ctx.lineTo(p4.x, p4.y);
            // The corner segment from point 4 to point 5
            if (innerEnd > 0) {
                const pCenter = rThetaToXY(innerEndAdjustedRadius, innerEndAdjustedAngle, x, y);
                ctx.arc(pCenter.x, pCenter.y, innerEnd, endAngle + HALF_PI, innerEndAdjustedAngle + Math.PI);
            }
            // The inner arc from point 5 to point b to point 6
            const innerMidAdjustedAngle = (endAngle - innerEnd / innerRadius + (startAngle + innerStart / innerRadius)) / 2;
            ctx.arc(x, y, innerRadius, endAngle - innerEnd / innerRadius, innerMidAdjustedAngle, true);
            ctx.arc(x, y, innerRadius, innerMidAdjustedAngle, startAngle + innerStart / innerRadius, true);
            // The corner segment from point 6 to point 7
            if (innerStart > 0) {
                const pCenter = rThetaToXY(innerStartAdjustedRadius, innerStartAdjustedAngle, x, y);
                ctx.arc(pCenter.x, pCenter.y, innerStart, innerStartAdjustedAngle + Math.PI, startAngle - HALF_PI);
            }
            // The line from point 7 to point 8
            const p8 = rThetaToXY(outerStartAdjustedRadius, startAngle, x, y);
            ctx.lineTo(p8.x, p8.y);
            // The corner segment from point 8 to point 1
            if (outerStart > 0) {
                const pCenter = rThetaToXY(outerStartAdjustedRadius, outerStartAdjustedAngle, x, y);
                ctx.arc(pCenter.x, pCenter.y, outerStart, startAngle - HALF_PI, outerStartAdjustedAngle);
            }
        } else {
            ctx.moveTo(x, y);
            const outerStartX = Math.cos(outerStartAdjustedAngle) * outerRadius + x;
            const outerStartY = Math.sin(outerStartAdjustedAngle) * outerRadius + y;
            ctx.lineTo(outerStartX, outerStartY);
            const outerEndX = Math.cos(outerEndAdjustedAngle) * outerRadius + x;
            const outerEndY = Math.sin(outerEndAdjustedAngle) * outerRadius + y;
            ctx.lineTo(outerEndX, outerEndY);
        }
        ctx.closePath();
    }
    function drawArc(ctx, element, offset, spacing, circular) {
        const { fullCircles , startAngle , circumference  } = element;
        let endAngle = element.endAngle;
        if (fullCircles) {
            pathArc(ctx, element, offset, spacing, endAngle, circular);
            for(let i = 0; i < fullCircles; ++i){
                ctx.fill();
            }
            if (!isNaN(circumference)) {
                endAngle = startAngle + (circumference % TAU || TAU);
            }
        }
        pathArc(ctx, element, offset, spacing, endAngle, circular);
        ctx.fill();
        return endAngle;
    }
    function drawBorder(ctx, element, offset, spacing, circular) {
        const { fullCircles , startAngle , circumference , options  } = element;
        const { borderWidth , borderJoinStyle , borderDash , borderDashOffset , borderRadius  } = options;
        const inner = options.borderAlign === 'inner';
        if (!borderWidth) {
            return;
        }
        ctx.setLineDash(borderDash || []);
        ctx.lineDashOffset = borderDashOffset;
        if (inner) {
            ctx.lineWidth = borderWidth * 2;
            ctx.lineJoin = borderJoinStyle || 'round';
        } else {
            ctx.lineWidth = borderWidth;
            ctx.lineJoin = borderJoinStyle || 'bevel';
        }
        let endAngle = element.endAngle;
        if (fullCircles) {
            pathArc(ctx, element, offset, spacing, endAngle, circular);
            for(let i = 0; i < fullCircles; ++i){
                ctx.stroke();
            }
            if (!isNaN(circumference)) {
                endAngle = startAngle + (circumference % TAU || TAU);
            }
        }
        if (inner) {
            clipArc(ctx, element, endAngle);
        }
        if (options.selfJoin && endAngle - startAngle >= PI && borderRadius === 0 && borderJoinStyle !== 'miter') {
            clipSelf(ctx, element, endAngle);
        }
        if (!fullCircles) {
            pathArc(ctx, element, offset, spacing, endAngle, circular);
            ctx.stroke();
        }
    }
    class ArcElement extends Element {
        static id = 'arc';
        static defaults = {
            borderAlign: 'center',
            borderColor: '#fff',
            borderDash: [],
            borderDashOffset: 0,
            borderJoinStyle: undefined,
            borderRadius: 0,
            borderWidth: 2,
            offset: 0,
            spacing: 0,
            angle: undefined,
            circular: true,
            selfJoin: false
        };
        static defaultRoutes = {
            backgroundColor: 'backgroundColor'
        };
        static descriptors = {
            _scriptable: true,
            _indexable: (name)=>name !== 'borderDash'
        };
        circumference;
        endAngle;
        fullCircles;
        innerRadius;
        outerRadius;
        pixelMargin;
        startAngle;
        constructor(cfg){
            super();
            this.options = undefined;
            this.circumference = undefined;
            this.startAngle = undefined;
            this.endAngle = undefined;
            this.innerRadius = undefined;
            this.outerRadius = undefined;
            this.pixelMargin = 0;
            this.fullCircles = 0;
            if (cfg) {
                Object.assign(this, cfg);
            }
        }
        inRange(chartX, chartY, useFinalPosition) {
            const point = this.getProps([
                'x',
                'y'
            ], useFinalPosition);
            const { angle , distance  } = getAngleFromPoint(point, {
                x: chartX,
                y: chartY
            });
            const { startAngle , endAngle , innerRadius , outerRadius , circumference  } = this.getProps([
                'startAngle',
                'endAngle',
                'innerRadius',
                'outerRadius',
                'circumference'
            ], useFinalPosition);
            const rAdjust = (this.options.spacing + this.options.borderWidth) / 2;
            const _circumference = valueOrDefault(circumference, endAngle - startAngle);
            const nonZeroBetween = _angleBetween(angle, startAngle, endAngle) && startAngle !== endAngle;
            const betweenAngles = _circumference >= TAU || nonZeroBetween;
            const withinRadius = _isBetween(distance, innerRadius + rAdjust, outerRadius + rAdjust);
            return betweenAngles && withinRadius;
        }
        getCenterPoint(useFinalPosition) {
            const { x , y , startAngle , endAngle , innerRadius , outerRadius  } = this.getProps([
                'x',
                'y',
                'startAngle',
                'endAngle',
                'innerRadius',
                'outerRadius'
            ], useFinalPosition);
            const { offset , spacing  } = this.options;
            const halfAngle = (startAngle + endAngle) / 2;
            const halfRadius = (innerRadius + outerRadius + spacing + offset) / 2;
            return {
                x: x + Math.cos(halfAngle) * halfRadius,
                y: y + Math.sin(halfAngle) * halfRadius
            };
        }
        tooltipPosition(useFinalPosition) {
            return this.getCenterPoint(useFinalPosition);
        }
        draw(ctx) {
            const { options , circumference  } = this;
            const offset = (options.offset || 0) / 4;
            const spacing = (options.spacing || 0) / 2;
            const circular = options.circular;
            this.pixelMargin = options.borderAlign === 'inner' ? 0.33 : 0;
            this.fullCircles = circumference > TAU ? Math.floor(circumference / TAU) : 0;
            if (circumference === 0 || this.innerRadius < 0 || this.outerRadius < 0) {
                return;
            }
            ctx.save();
            const halfAngle = (this.startAngle + this.endAngle) / 2;
            ctx.translate(Math.cos(halfAngle) * offset, Math.sin(halfAngle) * offset);
            const fix = 1 - Math.sin(Math.min(PI, circumference || 0));
            const radiusOffset = offset * fix;
            ctx.fillStyle = options.backgroundColor;
            ctx.strokeStyle = options.borderColor;
            drawArc(ctx, this, radiusOffset, spacing, circular);
            drawBorder(ctx, this, radiusOffset, spacing, circular);
            ctx.restore();
        }
    }

    function setStyle(ctx, options, style = options) {
        ctx.lineCap = valueOrDefault(style.borderCapStyle, options.borderCapStyle);
        ctx.setLineDash(valueOrDefault(style.borderDash, options.borderDash));
        ctx.lineDashOffset = valueOrDefault(style.borderDashOffset, options.borderDashOffset);
        ctx.lineJoin = valueOrDefault(style.borderJoinStyle, options.borderJoinStyle);
        ctx.lineWidth = valueOrDefault(style.borderWidth, options.borderWidth);
        ctx.strokeStyle = valueOrDefault(style.borderColor, options.borderColor);
    }
    function lineTo(ctx, previous, target) {
        ctx.lineTo(target.x, target.y);
    }
     function getLineMethod(options) {
        if (options.stepped) {
            return _steppedLineTo;
        }
        if (options.tension || options.cubicInterpolationMode === 'monotone') {
            return _bezierCurveTo;
        }
        return lineTo;
    }
    function pathVars(points, segment, params = {}) {
        const count = points.length;
        const { start: paramsStart = 0 , end: paramsEnd = count - 1  } = params;
        const { start: segmentStart , end: segmentEnd  } = segment;
        const start = Math.max(paramsStart, segmentStart);
        const end = Math.min(paramsEnd, segmentEnd);
        const outside = paramsStart < segmentStart && paramsEnd < segmentStart || paramsStart > segmentEnd && paramsEnd > segmentEnd;
        return {
            count,
            start,
            loop: segment.loop,
            ilen: end < start && !outside ? count + end - start : end - start
        };
    }
     function pathSegment(ctx, line, segment, params) {
        const { points , options  } = line;
        const { count , start , loop , ilen  } = pathVars(points, segment, params);
        const lineMethod = getLineMethod(options);
        let { move =true , reverse  } = params || {};
        let i, point, prev;
        for(i = 0; i <= ilen; ++i){
            point = points[(start + (reverse ? ilen - i : i)) % count];
            if (point.skip) {
                continue;
            } else if (move) {
                ctx.moveTo(point.x, point.y);
                move = false;
            } else {
                lineMethod(ctx, prev, point, reverse, options.stepped);
            }
            prev = point;
        }
        if (loop) {
            point = points[(start + (reverse ? ilen : 0)) % count];
            lineMethod(ctx, prev, point, reverse, options.stepped);
        }
        return !!loop;
    }
     function fastPathSegment(ctx, line, segment, params) {
        const points = line.points;
        const { count , start , ilen  } = pathVars(points, segment, params);
        const { move =true , reverse  } = params || {};
        let avgX = 0;
        let countX = 0;
        let i, point, prevX, minY, maxY, lastY;
        const pointIndex = (index)=>(start + (reverse ? ilen - index : index)) % count;
        const drawX = ()=>{
            if (minY !== maxY) {
                ctx.lineTo(avgX, maxY);
                ctx.lineTo(avgX, minY);
                ctx.lineTo(avgX, lastY);
            }
        };
        if (move) {
            point = points[pointIndex(0)];
            ctx.moveTo(point.x, point.y);
        }
        for(i = 0; i <= ilen; ++i){
            point = points[pointIndex(i)];
            if (point.skip) {
                continue;
            }
            const x = point.x;
            const y = point.y;
            const truncX = x | 0;
            if (truncX === prevX) {
                if (y < minY) {
                    minY = y;
                } else if (y > maxY) {
                    maxY = y;
                }
                avgX = (countX * avgX + x) / ++countX;
            } else {
                drawX();
                ctx.lineTo(x, y);
                prevX = truncX;
                countX = 0;
                minY = maxY = y;
            }
            lastY = y;
        }
        drawX();
    }
     function _getSegmentMethod(line) {
        const opts = line.options;
        const borderDash = opts.borderDash && opts.borderDash.length;
        const useFastPath = !line._decimated && !line._loop && !opts.tension && opts.cubicInterpolationMode !== 'monotone' && !opts.stepped && !borderDash;
        return useFastPath ? fastPathSegment : pathSegment;
    }
     function _getInterpolationMethod(options) {
        if (options.stepped) {
            return _steppedInterpolation;
        }
        if (options.tension || options.cubicInterpolationMode === 'monotone') {
            return _bezierInterpolation;
        }
        return _pointInLine;
    }
    function strokePathWithCache(ctx, line, start, count) {
        let path = line._path;
        if (!path) {
            path = line._path = new Path2D();
            if (line.path(path, start, count)) {
                path.closePath();
            }
        }
        setStyle(ctx, line.options);
        ctx.stroke(path);
    }
    function strokePathDirect(ctx, line, start, count) {
        const { segments , options  } = line;
        const segmentMethod = _getSegmentMethod(line);
        for (const segment of segments){
            setStyle(ctx, options, segment.style);
            ctx.beginPath();
            if (segmentMethod(ctx, line, segment, {
                start,
                end: start + count - 1
            })) {
                ctx.closePath();
            }
            ctx.stroke();
        }
    }
    const usePath2D = typeof Path2D === 'function';
    function draw(ctx, line, start, count) {
        if (usePath2D && !line.options.segment) {
            strokePathWithCache(ctx, line, start, count);
        } else {
            strokePathDirect(ctx, line, start, count);
        }
    }
    class LineElement extends Element {
        static id = 'line';
     static defaults = {
            borderCapStyle: 'butt',
            borderDash: [],
            borderDashOffset: 0,
            borderJoinStyle: 'miter',
            borderWidth: 3,
            capBezierPoints: true,
            cubicInterpolationMode: 'default',
            fill: false,
            spanGaps: false,
            stepped: false,
            tension: 0
        };
     static defaultRoutes = {
            backgroundColor: 'backgroundColor',
            borderColor: 'borderColor'
        };
        static descriptors = {
            _scriptable: true,
            _indexable: (name)=>name !== 'borderDash' && name !== 'fill'
        };
        constructor(cfg){
            super();
            this.animated = true;
            this.options = undefined;
            this._chart = undefined;
            this._loop = undefined;
            this._fullLoop = undefined;
            this._path = undefined;
            this._points = undefined;
            this._segments = undefined;
            this._decimated = false;
            this._pointsUpdated = false;
            this._datasetIndex = undefined;
            if (cfg) {
                Object.assign(this, cfg);
            }
        }
        updateControlPoints(chartArea, indexAxis) {
            const options = this.options;
            if ((options.tension || options.cubicInterpolationMode === 'monotone') && !options.stepped && !this._pointsUpdated) {
                const loop = options.spanGaps ? this._loop : this._fullLoop;
                _updateBezierControlPoints(this._points, options, chartArea, loop, indexAxis);
                this._pointsUpdated = true;
            }
        }
        set points(points) {
            this._points = points;
            delete this._segments;
            delete this._path;
            this._pointsUpdated = false;
        }
        get points() {
            return this._points;
        }
        get segments() {
            return this._segments || (this._segments = _computeSegments(this, this.options.segment));
        }
     first() {
            const segments = this.segments;
            const points = this.points;
            return segments.length && points[segments[0].start];
        }
     last() {
            const segments = this.segments;
            const points = this.points;
            const count = segments.length;
            return count && points[segments[count - 1].end];
        }
     interpolate(point, property) {
            const options = this.options;
            const value = point[property];
            const points = this.points;
            const segments = _boundSegments(this, {
                property,
                start: value,
                end: value
            });
            if (!segments.length) {
                return;
            }
            const result = [];
            const _interpolate = _getInterpolationMethod(options);
            let i, ilen;
            for(i = 0, ilen = segments.length; i < ilen; ++i){
                const { start , end  } = segments[i];
                const p1 = points[start];
                const p2 = points[end];
                if (p1 === p2) {
                    result.push(p1);
                    continue;
                }
                const t = Math.abs((value - p1[property]) / (p2[property] - p1[property]));
                const interpolated = _interpolate(p1, p2, t, options.stepped);
                interpolated[property] = point[property];
                result.push(interpolated);
            }
            return result.length === 1 ? result[0] : result;
        }
     pathSegment(ctx, segment, params) {
            const segmentMethod = _getSegmentMethod(this);
            return segmentMethod(ctx, this, segment, params);
        }
     path(ctx, start, count) {
            const segments = this.segments;
            const segmentMethod = _getSegmentMethod(this);
            let loop = this._loop;
            start = start || 0;
            count = count || this.points.length - start;
            for (const segment of segments){
                loop &= segmentMethod(ctx, this, segment, {
                    start,
                    end: start + count - 1
                });
            }
            return !!loop;
        }
     draw(ctx, chartArea, start, count) {
            const options = this.options || {};
            const points = this.points || [];
            if (points.length && options.borderWidth) {
                ctx.save();
                draw(ctx, this, start, count);
                ctx.restore();
            }
            if (this.animated) {
                this._pointsUpdated = false;
                this._path = undefined;
            }
        }
    }

    function inRange$1(el, pos, axis, useFinalPosition) {
        const options = el.options;
        const { [axis]: value  } = el.getProps([
            axis
        ], useFinalPosition);
        return Math.abs(pos - value) < options.radius + options.hitRadius;
    }
    class PointElement extends Element {
        static id = 'point';
        parsed;
        skip;
        stop;
        /**
       * @type {any}
       */ static defaults = {
            borderWidth: 1,
            hitRadius: 1,
            hoverBorderWidth: 1,
            hoverRadius: 4,
            pointStyle: 'circle',
            radius: 3,
            rotation: 0
        };
        /**
       * @type {any}
       */ static defaultRoutes = {
            backgroundColor: 'backgroundColor',
            borderColor: 'borderColor'
        };
        constructor(cfg){
            super();
            this.options = undefined;
            this.parsed = undefined;
            this.skip = undefined;
            this.stop = undefined;
            if (cfg) {
                Object.assign(this, cfg);
            }
        }
        inRange(mouseX, mouseY, useFinalPosition) {
            const options = this.options;
            const { x , y  } = this.getProps([
                'x',
                'y'
            ], useFinalPosition);
            return Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2) < Math.pow(options.hitRadius + options.radius, 2);
        }
        inXRange(mouseX, useFinalPosition) {
            return inRange$1(this, mouseX, 'x', useFinalPosition);
        }
        inYRange(mouseY, useFinalPosition) {
            return inRange$1(this, mouseY, 'y', useFinalPosition);
        }
        getCenterPoint(useFinalPosition) {
            const { x , y  } = this.getProps([
                'x',
                'y'
            ], useFinalPosition);
            return {
                x,
                y
            };
        }
        size(options) {
            options = options || this.options || {};
            let radius = options.radius || 0;
            radius = Math.max(radius, radius && options.hoverRadius || 0);
            const borderWidth = radius && options.borderWidth || 0;
            return (radius + borderWidth) * 2;
        }
        draw(ctx, area) {
            const options = this.options;
            if (this.skip || options.radius < 0.1 || !_isPointInArea(this, area, this.size(options) / 2)) {
                return;
            }
            ctx.strokeStyle = options.borderColor;
            ctx.lineWidth = options.borderWidth;
            ctx.fillStyle = options.backgroundColor;
            drawPoint(ctx, options, this.x, this.y);
        }
        getRange() {
            const options = this.options || {};
            // @ts-expect-error Fallbacks should never be hit in practice
            return options.radius + options.hitRadius;
        }
    }

    function getBarBounds(bar, useFinalPosition) {
        const { x , y , base , width , height  } =  bar.getProps([
            'x',
            'y',
            'base',
            'width',
            'height'
        ], useFinalPosition);
        let left, right, top, bottom, half;
        if (bar.horizontal) {
            half = height / 2;
            left = Math.min(x, base);
            right = Math.max(x, base);
            top = y - half;
            bottom = y + half;
        } else {
            half = width / 2;
            left = x - half;
            right = x + half;
            top = Math.min(y, base);
            bottom = Math.max(y, base);
        }
        return {
            left,
            top,
            right,
            bottom
        };
    }
    function skipOrLimit(skip, value, min, max) {
        return skip ? 0 : _limitValue(value, min, max);
    }
    function parseBorderWidth(bar, maxW, maxH) {
        const value = bar.options.borderWidth;
        const skip = bar.borderSkipped;
        const o = toTRBL(value);
        return {
            t: skipOrLimit(skip.top, o.top, 0, maxH),
            r: skipOrLimit(skip.right, o.right, 0, maxW),
            b: skipOrLimit(skip.bottom, o.bottom, 0, maxH),
            l: skipOrLimit(skip.left, o.left, 0, maxW)
        };
    }
    function parseBorderRadius(bar, maxW, maxH) {
        const { enableBorderRadius  } = bar.getProps([
            'enableBorderRadius'
        ]);
        const value = bar.options.borderRadius;
        const o = toTRBLCorners(value);
        const maxR = Math.min(maxW, maxH);
        const skip = bar.borderSkipped;
        const enableBorder = enableBorderRadius || isObject(value);
        return {
            topLeft: skipOrLimit(!enableBorder || skip.top || skip.left, o.topLeft, 0, maxR),
            topRight: skipOrLimit(!enableBorder || skip.top || skip.right, o.topRight, 0, maxR),
            bottomLeft: skipOrLimit(!enableBorder || skip.bottom || skip.left, o.bottomLeft, 0, maxR),
            bottomRight: skipOrLimit(!enableBorder || skip.bottom || skip.right, o.bottomRight, 0, maxR)
        };
    }
    function boundingRects(bar) {
        const bounds = getBarBounds(bar);
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        const border = parseBorderWidth(bar, width / 2, height / 2);
        const radius = parseBorderRadius(bar, width / 2, height / 2);
        return {
            outer: {
                x: bounds.left,
                y: bounds.top,
                w: width,
                h: height,
                radius
            },
            inner: {
                x: bounds.left + border.l,
                y: bounds.top + border.t,
                w: width - border.l - border.r,
                h: height - border.t - border.b,
                radius: {
                    topLeft: Math.max(0, radius.topLeft - Math.max(border.t, border.l)),
                    topRight: Math.max(0, radius.topRight - Math.max(border.t, border.r)),
                    bottomLeft: Math.max(0, radius.bottomLeft - Math.max(border.b, border.l)),
                    bottomRight: Math.max(0, radius.bottomRight - Math.max(border.b, border.r))
                }
            }
        };
    }
    function inRange(bar, x, y, useFinalPosition) {
        const skipX = x === null;
        const skipY = y === null;
        const skipBoth = skipX && skipY;
        const bounds = bar && !skipBoth && getBarBounds(bar, useFinalPosition);
        return bounds && (skipX || _isBetween(x, bounds.left, bounds.right)) && (skipY || _isBetween(y, bounds.top, bounds.bottom));
    }
    function hasRadius(radius) {
        return radius.topLeft || radius.topRight || radius.bottomLeft || radius.bottomRight;
    }
     function addNormalRectPath(ctx, rect) {
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
    }
    function inflateRect(rect, amount, refRect = {}) {
        const x = rect.x !== refRect.x ? -amount : 0;
        const y = rect.y !== refRect.y ? -amount : 0;
        const w = (rect.x + rect.w !== refRect.x + refRect.w ? amount : 0) - x;
        const h = (rect.y + rect.h !== refRect.y + refRect.h ? amount : 0) - y;
        return {
            x: rect.x + x,
            y: rect.y + y,
            w: rect.w + w,
            h: rect.h + h,
            radius: rect.radius
        };
    }
    class BarElement extends Element {
        static id = 'bar';
     static defaults = {
            borderSkipped: 'start',
            borderWidth: 0,
            borderRadius: 0,
            inflateAmount: 'auto',
            pointStyle: undefined
        };
     static defaultRoutes = {
            backgroundColor: 'backgroundColor',
            borderColor: 'borderColor'
        };
        constructor(cfg){
            super();
            this.options = undefined;
            this.horizontal = undefined;
            this.base = undefined;
            this.width = undefined;
            this.height = undefined;
            this.inflateAmount = undefined;
            if (cfg) {
                Object.assign(this, cfg);
            }
        }
        draw(ctx) {
            const { inflateAmount , options: { borderColor , backgroundColor  }  } = this;
            const { inner , outer  } = boundingRects(this);
            const addRectPath = hasRadius(outer.radius) ? addRoundedRectPath : addNormalRectPath;
            ctx.save();
            if (outer.w !== inner.w || outer.h !== inner.h) {
                ctx.beginPath();
                addRectPath(ctx, inflateRect(outer, inflateAmount, inner));
                ctx.clip();
                addRectPath(ctx, inflateRect(inner, -inflateAmount, outer));
                ctx.fillStyle = borderColor;
                ctx.fill('evenodd');
            }
            ctx.beginPath();
            addRectPath(ctx, inflateRect(inner, inflateAmount));
            ctx.fillStyle = backgroundColor;
            ctx.fill();
            ctx.restore();
        }
        inRange(mouseX, mouseY, useFinalPosition) {
            return inRange(this, mouseX, mouseY, useFinalPosition);
        }
        inXRange(mouseX, useFinalPosition) {
            return inRange(this, mouseX, null, useFinalPosition);
        }
        inYRange(mouseY, useFinalPosition) {
            return inRange(this, null, mouseY, useFinalPosition);
        }
        getCenterPoint(useFinalPosition) {
            const { x , y , base , horizontal  } =  this.getProps([
                'x',
                'y',
                'base',
                'horizontal'
            ], useFinalPosition);
            return {
                x: horizontal ? (x + base) / 2 : x,
                y: horizontal ? y : (y + base) / 2
            };
        }
        getRange(axis) {
            return axis === 'x' ? this.width / 2 : this.height / 2;
        }
    }

    var elements = /*#__PURE__*/Object.freeze({
    __proto__: null,
    ArcElement: ArcElement,
    BarElement: BarElement,
    LineElement: LineElement,
    PointElement: PointElement
    });

    const BORDER_COLORS = [
        'rgb(54, 162, 235)',
        'rgb(255, 99, 132)',
        'rgb(255, 159, 64)',
        'rgb(255, 205, 86)',
        'rgb(75, 192, 192)',
        'rgb(153, 102, 255)',
        'rgb(201, 203, 207)' // grey
    ];
    // Border colors with 50% transparency
    const BACKGROUND_COLORS = /* #__PURE__ */ BORDER_COLORS.map((color)=>color.replace('rgb(', 'rgba(').replace(')', ', 0.5)'));
    function getBorderColor(i) {
        return BORDER_COLORS[i % BORDER_COLORS.length];
    }
    function getBackgroundColor(i) {
        return BACKGROUND_COLORS[i % BACKGROUND_COLORS.length];
    }
    function colorizeDefaultDataset(dataset, i) {
        dataset.borderColor = getBorderColor(i);
        dataset.backgroundColor = getBackgroundColor(i);
        return ++i;
    }
    function colorizeDoughnutDataset(dataset, i) {
        dataset.backgroundColor = dataset.data.map(()=>getBorderColor(i++));
        return i;
    }
    function colorizePolarAreaDataset(dataset, i) {
        dataset.backgroundColor = dataset.data.map(()=>getBackgroundColor(i++));
        return i;
    }
    function getColorizer(chart) {
        let i = 0;
        return (dataset, datasetIndex)=>{
            const controller = chart.getDatasetMeta(datasetIndex).controller;
            if (controller instanceof DoughnutController) {
                i = colorizeDoughnutDataset(dataset, i);
            } else if (controller instanceof PolarAreaController) {
                i = colorizePolarAreaDataset(dataset, i);
            } else if (controller) {
                i = colorizeDefaultDataset(dataset, i);
            }
        };
    }
    function containsColorsDefinitions(descriptors) {
        let k;
        for(k in descriptors){
            if (descriptors[k].borderColor || descriptors[k].backgroundColor) {
                return true;
            }
        }
        return false;
    }
    function containsColorsDefinition(descriptor) {
        return descriptor && (descriptor.borderColor || descriptor.backgroundColor);
    }
    function containsDefaultColorsDefenitions() {
        return defaults.borderColor !== 'rgba(0,0,0,0.1)' || defaults.backgroundColor !== 'rgba(0,0,0,0.1)';
    }
    var plugin_colors = {
        id: 'colors',
        defaults: {
            enabled: true,
            forceOverride: false
        },
        beforeLayout (chart, _args, options) {
            if (!options.enabled) {
                return;
            }
            const { data: { datasets  } , options: chartOptions  } = chart.config;
            const { elements  } = chartOptions;
            const containsColorDefenition = containsColorsDefinitions(datasets) || containsColorsDefinition(chartOptions) || elements && containsColorsDefinitions(elements) || containsDefaultColorsDefenitions();
            if (!options.forceOverride && containsColorDefenition) {
                return;
            }
            const colorizer = getColorizer(chart);
            datasets.forEach(colorizer);
        }
    };

    function lttbDecimation(data, start, count, availableWidth, options) {
     const samples = options.samples || availableWidth;
        if (samples >= count) {
            return data.slice(start, start + count);
        }
        const decimated = [];
        const bucketWidth = (count - 2) / (samples - 2);
        let sampledIndex = 0;
        const endIndex = start + count - 1;
        let a = start;
        let i, maxAreaPoint, maxArea, area, nextA;
        decimated[sampledIndex++] = data[a];
        for(i = 0; i < samples - 2; i++){
            let avgX = 0;
            let avgY = 0;
            let j;
            const avgRangeStart = Math.floor((i + 1) * bucketWidth) + 1 + start;
            const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketWidth) + 1, count) + start;
            const avgRangeLength = avgRangeEnd - avgRangeStart;
            for(j = avgRangeStart; j < avgRangeEnd; j++){
                avgX += data[j].x;
                avgY += data[j].y;
            }
            avgX /= avgRangeLength;
            avgY /= avgRangeLength;
            const rangeOffs = Math.floor(i * bucketWidth) + 1 + start;
            const rangeTo = Math.min(Math.floor((i + 1) * bucketWidth) + 1, count) + start;
            const { x: pointAx , y: pointAy  } = data[a];
            maxArea = area = -1;
            for(j = rangeOffs; j < rangeTo; j++){
                area = 0.5 * Math.abs((pointAx - avgX) * (data[j].y - pointAy) - (pointAx - data[j].x) * (avgY - pointAy));
                if (area > maxArea) {
                    maxArea = area;
                    maxAreaPoint = data[j];
                    nextA = j;
                }
            }
            decimated[sampledIndex++] = maxAreaPoint;
            a = nextA;
        }
        decimated[sampledIndex++] = data[endIndex];
        return decimated;
    }
    function minMaxDecimation(data, start, count, availableWidth) {
        let avgX = 0;
        let countX = 0;
        let i, point, x, y, prevX, minIndex, maxIndex, startIndex, minY, maxY;
        const decimated = [];
        const endIndex = start + count - 1;
        const xMin = data[start].x;
        const xMax = data[endIndex].x;
        const dx = xMax - xMin;
        for(i = start; i < start + count; ++i){
            point = data[i];
            x = (point.x - xMin) / dx * availableWidth;
            y = point.y;
            const truncX = x | 0;
            if (truncX === prevX) {
                if (y < minY) {
                    minY = y;
                    minIndex = i;
                } else if (y > maxY) {
                    maxY = y;
                    maxIndex = i;
                }
                avgX = (countX * avgX + point.x) / ++countX;
            } else {
                const lastIndex = i - 1;
                if (!isNullOrUndef(minIndex) && !isNullOrUndef(maxIndex)) {
                    const intermediateIndex1 = Math.min(minIndex, maxIndex);
                    const intermediateIndex2 = Math.max(minIndex, maxIndex);
                    if (intermediateIndex1 !== startIndex && intermediateIndex1 !== lastIndex) {
                        decimated.push({
                            ...data[intermediateIndex1],
                            x: avgX
                        });
                    }
                    if (intermediateIndex2 !== startIndex && intermediateIndex2 !== lastIndex) {
                        decimated.push({
                            ...data[intermediateIndex2],
                            x: avgX
                        });
                    }
                }
                if (i > 0 && lastIndex !== startIndex) {
                    decimated.push(data[lastIndex]);
                }
                decimated.push(point);
                prevX = truncX;
                countX = 0;
                minY = maxY = y;
                minIndex = maxIndex = startIndex = i;
            }
        }
        return decimated;
    }
    function cleanDecimatedDataset(dataset) {
        if (dataset._decimated) {
            const data = dataset._data;
            delete dataset._decimated;
            delete dataset._data;
            Object.defineProperty(dataset, 'data', {
                configurable: true,
                enumerable: true,
                writable: true,
                value: data
            });
        }
    }
    function cleanDecimatedData(chart) {
        chart.data.datasets.forEach((dataset)=>{
            cleanDecimatedDataset(dataset);
        });
    }
    function getStartAndCountOfVisiblePointsSimplified(meta, points) {
        const pointCount = points.length;
        let start = 0;
        let count;
        const { iScale  } = meta;
        const { min , max , minDefined , maxDefined  } = iScale.getUserBounds();
        if (minDefined) {
            start = _limitValue(_lookupByKey(points, iScale.axis, min).lo, 0, pointCount - 1);
        }
        if (maxDefined) {
            count = _limitValue(_lookupByKey(points, iScale.axis, max).hi + 1, start, pointCount) - start;
        } else {
            count = pointCount - start;
        }
        return {
            start,
            count
        };
    }
    var plugin_decimation = {
        id: 'decimation',
        defaults: {
            algorithm: 'min-max',
            enabled: false
        },
        beforeElementsUpdate: (chart, args, options)=>{
            if (!options.enabled) {
                cleanDecimatedData(chart);
                return;
            }
            const availableWidth = chart.width;
            chart.data.datasets.forEach((dataset, datasetIndex)=>{
                const { _data , indexAxis  } = dataset;
                const meta = chart.getDatasetMeta(datasetIndex);
                const data = _data || dataset.data;
                if (resolve([
                    indexAxis,
                    chart.options.indexAxis
                ]) === 'y') {
                    return;
                }
                if (!meta.controller.supportsDecimation) {
                    return;
                }
                const xAxis = chart.scales[meta.xAxisID];
                if (xAxis.type !== 'linear' && xAxis.type !== 'time') {
                    return;
                }
                if (chart.options.parsing) {
                    return;
                }
                let { start , count  } = getStartAndCountOfVisiblePointsSimplified(meta, data);
                const threshold = options.threshold || 4 * availableWidth;
                if (count <= threshold) {
                    cleanDecimatedDataset(dataset);
                    return;
                }
                if (isNullOrUndef(_data)) {
                    dataset._data = data;
                    delete dataset.data;
                    Object.defineProperty(dataset, 'data', {
                        configurable: true,
                        enumerable: true,
                        get: function() {
                            return this._decimated;
                        },
                        set: function(d) {
                            this._data = d;
                        }
                    });
                }
                let decimated;
                switch(options.algorithm){
                    case 'lttb':
                        decimated = lttbDecimation(data, start, count, availableWidth, options);
                        break;
                    case 'min-max':
                        decimated = minMaxDecimation(data, start, count, availableWidth);
                        break;
                    default:
                        throw new Error(`Unsupported decimation algorithm '${options.algorithm}'`);
                }
                dataset._decimated = decimated;
            });
        },
        destroy (chart) {
            cleanDecimatedData(chart);
        }
    };

    function _segments(line, target, property) {
        const segments = line.segments;
        const points = line.points;
        const tpoints = target.points;
        const parts = [];
        for (const segment of segments){
            let { start , end  } = segment;
            end = _findSegmentEnd(start, end, points);
            const bounds = _getBounds(property, points[start], points[end], segment.loop);
            if (!target.segments) {
                parts.push({
                    source: segment,
                    target: bounds,
                    start: points[start],
                    end: points[end]
                });
                continue;
            }
            const targetSegments = _boundSegments(target, bounds);
            for (const tgt of targetSegments){
                const subBounds = _getBounds(property, tpoints[tgt.start], tpoints[tgt.end], tgt.loop);
                const fillSources = _boundSegment(segment, points, subBounds);
                for (const fillSource of fillSources){
                    parts.push({
                        source: fillSource,
                        target: tgt,
                        start: {
                            [property]: _getEdge(bounds, subBounds, 'start', Math.max)
                        },
                        end: {
                            [property]: _getEdge(bounds, subBounds, 'end', Math.min)
                        }
                    });
                }
            }
        }
        return parts;
    }
    function _getBounds(property, first, last, loop) {
        if (loop) {
            return;
        }
        let start = first[property];
        let end = last[property];
        if (property === 'angle') {
            start = _normalizeAngle(start);
            end = _normalizeAngle(end);
        }
        return {
            property,
            start,
            end
        };
    }
    function _pointsFromSegments(boundary, line) {
        const { x =null , y =null  } = boundary || {};
        const linePoints = line.points;
        const points = [];
        line.segments.forEach(({ start , end  })=>{
            end = _findSegmentEnd(start, end, linePoints);
            const first = linePoints[start];
            const last = linePoints[end];
            if (y !== null) {
                points.push({
                    x: first.x,
                    y
                });
                points.push({
                    x: last.x,
                    y
                });
            } else if (x !== null) {
                points.push({
                    x,
                    y: first.y
                });
                points.push({
                    x,
                    y: last.y
                });
            }
        });
        return points;
    }
    function _findSegmentEnd(start, end, points) {
        for(; end > start; end--){
            const point = points[end];
            if (!isNaN(point.x) && !isNaN(point.y)) {
                break;
            }
        }
        return end;
    }
    function _getEdge(a, b, prop, fn) {
        if (a && b) {
            return fn(a[prop], b[prop]);
        }
        return a ? a[prop] : b ? b[prop] : 0;
    }

    function _createBoundaryLine(boundary, line) {
        let points = [];
        let _loop = false;
        if (isArray(boundary)) {
            _loop = true;
            points = boundary;
        } else {
            points = _pointsFromSegments(boundary, line);
        }
        return points.length ? new LineElement({
            points,
            options: {
                tension: 0
            },
            _loop,
            _fullLoop: _loop
        }) : null;
    }
    function _shouldApplyFill(source) {
        return source && source.fill !== false;
    }

    function _resolveTarget(sources, index, propagate) {
        const source = sources[index];
        let fill = source.fill;
        const visited = [
            index
        ];
        let target;
        if (!propagate) {
            return fill;
        }
        while(fill !== false && visited.indexOf(fill) === -1){
            if (!isNumberFinite(fill)) {
                return fill;
            }
            target = sources[fill];
            if (!target) {
                return false;
            }
            if (target.visible) {
                return fill;
            }
            visited.push(fill);
            fill = target.fill;
        }
        return false;
    }
     function _decodeFill(line, index, count) {
         const fill = parseFillOption(line);
        if (isObject(fill)) {
            return isNaN(fill.value) ? false : fill;
        }
        let target = parseFloat(fill);
        if (isNumberFinite(target) && Math.floor(target) === target) {
            return decodeTargetIndex(fill[0], index, target, count);
        }
        return [
            'origin',
            'start',
            'end',
            'stack',
            'shape'
        ].indexOf(fill) >= 0 && fill;
    }
    function decodeTargetIndex(firstCh, index, target, count) {
        if (firstCh === '-' || firstCh === '+') {
            target = index + target;
        }
        if (target === index || target < 0 || target >= count) {
            return false;
        }
        return target;
    }
     function _getTargetPixel(fill, scale) {
        let pixel = null;
        if (fill === 'start') {
            pixel = scale.bottom;
        } else if (fill === 'end') {
            pixel = scale.top;
        } else if (isObject(fill)) {
            pixel = scale.getPixelForValue(fill.value);
        } else if (scale.getBasePixel) {
            pixel = scale.getBasePixel();
        }
        return pixel;
    }
     function _getTargetValue(fill, scale, startValue) {
        let value;
        if (fill === 'start') {
            value = startValue;
        } else if (fill === 'end') {
            value = scale.options.reverse ? scale.min : scale.max;
        } else if (isObject(fill)) {
            value = fill.value;
        } else {
            value = scale.getBaseValue();
        }
        return value;
    }
     function parseFillOption(line) {
        const options = line.options;
        const fillOption = options.fill;
        let fill = valueOrDefault(fillOption && fillOption.target, fillOption);
        if (fill === undefined) {
            fill = !!options.backgroundColor;
        }
        if (fill === false || fill === null) {
            return false;
        }
        if (fill === true) {
            return 'origin';
        }
        return fill;
    }

    function _buildStackLine(source) {
        const { scale , index , line  } = source;
        const points = [];
        const segments = line.segments;
        const sourcePoints = line.points;
        const linesBelow = getLinesBelow(scale, index);
        linesBelow.push(_createBoundaryLine({
            x: null,
            y: scale.bottom
        }, line));
        for(let i = 0; i < segments.length; i++){
            const segment = segments[i];
            for(let j = segment.start; j <= segment.end; j++){
                addPointsBelow(points, sourcePoints[j], linesBelow);
            }
        }
        return new LineElement({
            points,
            options: {}
        });
    }
     function getLinesBelow(scale, index) {
        const below = [];
        const metas = scale.getMatchingVisibleMetas('line');
        for(let i = 0; i < metas.length; i++){
            const meta = metas[i];
            if (meta.index === index) {
                break;
            }
            if (!meta.hidden) {
                below.unshift(meta.dataset);
            }
        }
        return below;
    }
     function addPointsBelow(points, sourcePoint, linesBelow) {
        const postponed = [];
        for(let j = 0; j < linesBelow.length; j++){
            const line = linesBelow[j];
            const { first , last , point  } = findPoint(line, sourcePoint, 'x');
            if (!point || first && last) {
                continue;
            }
            if (first) {
                postponed.unshift(point);
            } else {
                points.push(point);
                if (!last) {
                    break;
                }
            }
        }
        points.push(...postponed);
    }
     function findPoint(line, sourcePoint, property) {
        const point = line.interpolate(sourcePoint, property);
        if (!point) {
            return {};
        }
        const pointValue = point[property];
        const segments = line.segments;
        const linePoints = line.points;
        let first = false;
        let last = false;
        for(let i = 0; i < segments.length; i++){
            const segment = segments[i];
            const firstValue = linePoints[segment.start][property];
            const lastValue = linePoints[segment.end][property];
            if (_isBetween(pointValue, firstValue, lastValue)) {
                first = pointValue === firstValue;
                last = pointValue === lastValue;
                break;
            }
        }
        return {
            first,
            last,
            point
        };
    }

    class simpleArc {
        constructor(opts){
            this.x = opts.x;
            this.y = opts.y;
            this.radius = opts.radius;
        }
        pathSegment(ctx, bounds, opts) {
            const { x , y , radius  } = this;
            bounds = bounds || {
                start: 0,
                end: TAU
            };
            ctx.arc(x, y, radius, bounds.end, bounds.start, true);
            return !opts.bounds;
        }
        interpolate(point) {
            const { x , y , radius  } = this;
            const angle = point.angle;
            return {
                x: x + Math.cos(angle) * radius,
                y: y + Math.sin(angle) * radius,
                angle
            };
        }
    }

    function _getTarget(source) {
        const { chart , fill , line  } = source;
        if (isNumberFinite(fill)) {
            return getLineByIndex(chart, fill);
        }
        if (fill === 'stack') {
            return _buildStackLine(source);
        }
        if (fill === 'shape') {
            return true;
        }
        const boundary = computeBoundary(source);
        if (boundary instanceof simpleArc) {
            return boundary;
        }
        return _createBoundaryLine(boundary, line);
    }
     function getLineByIndex(chart, index) {
        const meta = chart.getDatasetMeta(index);
        const visible = meta && chart.isDatasetVisible(index);
        return visible ? meta.dataset : null;
    }
    function computeBoundary(source) {
        const scale = source.scale || {};
        if (scale.getPointPositionForValue) {
            return computeCircularBoundary(source);
        }
        return computeLinearBoundary(source);
    }
    function computeLinearBoundary(source) {
        const { scale ={} , fill  } = source;
        const pixel = _getTargetPixel(fill, scale);
        if (isNumberFinite(pixel)) {
            const horizontal = scale.isHorizontal();
            return {
                x: horizontal ? pixel : null,
                y: horizontal ? null : pixel
            };
        }
        return null;
    }
    function computeCircularBoundary(source) {
        const { scale , fill  } = source;
        const options = scale.options;
        const length = scale.getLabels().length;
        const start = options.reverse ? scale.max : scale.min;
        const value = _getTargetValue(fill, scale, start);
        const target = [];
        if (options.grid.circular) {
            const center = scale.getPointPositionForValue(0, start);
            return new simpleArc({
                x: center.x,
                y: center.y,
                radius: scale.getDistanceFromCenterForValue(value)
            });
        }
        for(let i = 0; i < length; ++i){
            target.push(scale.getPointPositionForValue(i, value));
        }
        return target;
    }

    function _drawfill(ctx, source, area) {
        const target = _getTarget(source);
        const { chart , index , line , scale , axis  } = source;
        const lineOpts = line.options;
        const fillOption = lineOpts.fill;
        const color = lineOpts.backgroundColor;
        const { above =color , below =color  } = fillOption || {};
        const meta = chart.getDatasetMeta(index);
        const clip = getDatasetClipArea(chart, meta);
        if (target && line.points.length) {
            clipArea(ctx, area);
            doFill(ctx, {
                line,
                target,
                above,
                below,
                area,
                scale,
                axis,
                clip
            });
            unclipArea(ctx);
        }
    }
    function doFill(ctx, cfg) {
        const { line , target , above , below , area , scale , clip  } = cfg;
        const property = line._loop ? 'angle' : cfg.axis;
        ctx.save();
        let fillColor = below;
        if (below !== above) {
            if (property === 'x') {
                clipVertical(ctx, target, area.top);
                fill(ctx, {
                    line,
                    target,
                    color: above,
                    scale,
                    property,
                    clip
                });
                ctx.restore();
                ctx.save();
                clipVertical(ctx, target, area.bottom);
            } else if (property === 'y') {
                clipHorizontal(ctx, target, area.left);
                fill(ctx, {
                    line,
                    target,
                    color: below,
                    scale,
                    property,
                    clip
                });
                ctx.restore();
                ctx.save();
                clipHorizontal(ctx, target, area.right);
                fillColor = above;
            }
        }
        fill(ctx, {
            line,
            target,
            color: fillColor,
            scale,
            property,
            clip
        });
        ctx.restore();
    }
    function clipVertical(ctx, target, clipY) {
        const { segments , points  } = target;
        let first = true;
        let lineLoop = false;
        ctx.beginPath();
        for (const segment of segments){
            const { start , end  } = segment;
            const firstPoint = points[start];
            const lastPoint = points[_findSegmentEnd(start, end, points)];
            if (first) {
                ctx.moveTo(firstPoint.x, firstPoint.y);
                first = false;
            } else {
                ctx.lineTo(firstPoint.x, clipY);
                ctx.lineTo(firstPoint.x, firstPoint.y);
            }
            lineLoop = !!target.pathSegment(ctx, segment, {
                move: lineLoop
            });
            if (lineLoop) {
                ctx.closePath();
            } else {
                ctx.lineTo(lastPoint.x, clipY);
            }
        }
        ctx.lineTo(target.first().x, clipY);
        ctx.closePath();
        ctx.clip();
    }
    function clipHorizontal(ctx, target, clipX) {
        const { segments , points  } = target;
        let first = true;
        let lineLoop = false;
        ctx.beginPath();
        for (const segment of segments){
            const { start , end  } = segment;
            const firstPoint = points[start];
            const lastPoint = points[_findSegmentEnd(start, end, points)];
            if (first) {
                ctx.moveTo(firstPoint.x, firstPoint.y);
                first = false;
            } else {
                ctx.lineTo(clipX, firstPoint.y);
                ctx.lineTo(firstPoint.x, firstPoint.y);
            }
            lineLoop = !!target.pathSegment(ctx, segment, {
                move: lineLoop
            });
            if (lineLoop) {
                ctx.closePath();
            } else {
                ctx.lineTo(clipX, lastPoint.y);
            }
        }
        ctx.lineTo(clipX, target.first().y);
        ctx.closePath();
        ctx.clip();
    }
    function fill(ctx, cfg) {
        const { line , target , property , color , scale , clip  } = cfg;
        const segments = _segments(line, target, property);
        for (const { source: src , target: tgt , start , end  } of segments){
            const { style: { backgroundColor =color  } = {}  } = src;
            const notShape = target !== true;
            ctx.save();
            ctx.fillStyle = backgroundColor;
            clipBounds(ctx, scale, clip, notShape && _getBounds(property, start, end));
            ctx.beginPath();
            const lineLoop = !!line.pathSegment(ctx, src);
            let loop;
            if (notShape) {
                if (lineLoop) {
                    ctx.closePath();
                } else {
                    interpolatedLineTo(ctx, target, end, property);
                }
                const targetLoop = !!target.pathSegment(ctx, tgt, {
                    move: lineLoop,
                    reverse: true
                });
                loop = lineLoop && targetLoop;
                if (!loop) {
                    interpolatedLineTo(ctx, target, start, property);
                }
            }
            ctx.closePath();
            ctx.fill(loop ? 'evenodd' : 'nonzero');
            ctx.restore();
        }
    }
    function clipBounds(ctx, scale, clip, bounds) {
        const chartArea = scale.chart.chartArea;
        const { property , start , end  } = bounds || {};
        if (property === 'x' || property === 'y') {
            let left, top, right, bottom;
            if (property === 'x') {
                left = start;
                top = chartArea.top;
                right = end;
                bottom = chartArea.bottom;
            } else {
                left = chartArea.left;
                top = start;
                right = chartArea.right;
                bottom = end;
            }
            ctx.beginPath();
            if (clip) {
                left = Math.max(left, clip.left);
                right = Math.min(right, clip.right);
                top = Math.max(top, clip.top);
                bottom = Math.min(bottom, clip.bottom);
            }
            ctx.rect(left, top, right - left, bottom - top);
            ctx.clip();
        }
    }
    function interpolatedLineTo(ctx, target, point, property) {
        const interpolatedPoint = target.interpolate(point, property);
        if (interpolatedPoint) {
            ctx.lineTo(interpolatedPoint.x, interpolatedPoint.y);
        }
    }

    var index = {
        id: 'filler',
        afterDatasetsUpdate (chart, _args, options) {
            const count = (chart.data.datasets || []).length;
            const sources = [];
            let meta, i, line, source;
            for(i = 0; i < count; ++i){
                meta = chart.getDatasetMeta(i);
                line = meta.dataset;
                source = null;
                if (line && line.options && line instanceof LineElement) {
                    source = {
                        visible: chart.isDatasetVisible(i),
                        index: i,
                        fill: _decodeFill(line, i, count),
                        chart,
                        axis: meta.controller.options.indexAxis,
                        scale: meta.vScale,
                        line
                    };
                }
                meta.$filler = source;
                sources.push(source);
            }
            for(i = 0; i < count; ++i){
                source = sources[i];
                if (!source || source.fill === false) {
                    continue;
                }
                source.fill = _resolveTarget(sources, i, options.propagate);
            }
        },
        beforeDraw (chart, _args, options) {
            const draw = options.drawTime === 'beforeDraw';
            const metasets = chart.getSortedVisibleDatasetMetas();
            const area = chart.chartArea;
            for(let i = metasets.length - 1; i >= 0; --i){
                const source = metasets[i].$filler;
                if (!source) {
                    continue;
                }
                source.line.updateControlPoints(area, source.axis);
                if (draw && source.fill) {
                    _drawfill(chart.ctx, source, area);
                }
            }
        },
        beforeDatasetsDraw (chart, _args, options) {
            if (options.drawTime !== 'beforeDatasetsDraw') {
                return;
            }
            const metasets = chart.getSortedVisibleDatasetMetas();
            for(let i = metasets.length - 1; i >= 0; --i){
                const source = metasets[i].$filler;
                if (_shouldApplyFill(source)) {
                    _drawfill(chart.ctx, source, chart.chartArea);
                }
            }
        },
        beforeDatasetDraw (chart, args, options) {
            const source = args.meta.$filler;
            if (!_shouldApplyFill(source) || options.drawTime !== 'beforeDatasetDraw') {
                return;
            }
            _drawfill(chart.ctx, source, chart.chartArea);
        },
        defaults: {
            propagate: true,
            drawTime: 'beforeDatasetDraw'
        }
    };

    const getBoxSize = (labelOpts, fontSize)=>{
        let { boxHeight =fontSize , boxWidth =fontSize  } = labelOpts;
        if (labelOpts.usePointStyle) {
            boxHeight = Math.min(boxHeight, fontSize);
            boxWidth = labelOpts.pointStyleWidth || Math.min(boxWidth, fontSize);
        }
        return {
            boxWidth,
            boxHeight,
            itemHeight: Math.max(fontSize, boxHeight)
        };
    };
    const itemsEqual = (a, b)=>a !== null && b !== null && a.datasetIndex === b.datasetIndex && a.index === b.index;
    class Legend extends Element {
     constructor(config){
            super();
            this._added = false;
            this.legendHitBoxes = [];
     this._hoveredItem = null;
            this.doughnutMode = false;
            this.chart = config.chart;
            this.options = config.options;
            this.ctx = config.ctx;
            this.legendItems = undefined;
            this.columnSizes = undefined;
            this.lineWidths = undefined;
            this.maxHeight = undefined;
            this.maxWidth = undefined;
            this.top = undefined;
            this.bottom = undefined;
            this.left = undefined;
            this.right = undefined;
            this.height = undefined;
            this.width = undefined;
            this._margins = undefined;
            this.position = undefined;
            this.weight = undefined;
            this.fullSize = undefined;
        }
        update(maxWidth, maxHeight, margins) {
            this.maxWidth = maxWidth;
            this.maxHeight = maxHeight;
            this._margins = margins;
            this.setDimensions();
            this.buildLabels();
            this.fit();
        }
        setDimensions() {
            if (this.isHorizontal()) {
                this.width = this.maxWidth;
                this.left = this._margins.left;
                this.right = this.width;
            } else {
                this.height = this.maxHeight;
                this.top = this._margins.top;
                this.bottom = this.height;
            }
        }
        buildLabels() {
            const labelOpts = this.options.labels || {};
            let legendItems = callback(labelOpts.generateLabels, [
                this.chart
            ], this) || [];
            if (labelOpts.filter) {
                legendItems = legendItems.filter((item)=>labelOpts.filter(item, this.chart.data));
            }
            if (labelOpts.sort) {
                legendItems = legendItems.sort((a, b)=>labelOpts.sort(a, b, this.chart.data));
            }
            if (this.options.reverse) {
                legendItems.reverse();
            }
            this.legendItems = legendItems;
        }
        fit() {
            const { options , ctx  } = this;
            if (!options.display) {
                this.width = this.height = 0;
                return;
            }
            const labelOpts = options.labels;
            const labelFont = toFont(labelOpts.font);
            const fontSize = labelFont.size;
            const titleHeight = this._computeTitleHeight();
            const { boxWidth , itemHeight  } = getBoxSize(labelOpts, fontSize);
            let width, height;
            ctx.font = labelFont.string;
            if (this.isHorizontal()) {
                width = this.maxWidth;
                height = this._fitRows(titleHeight, fontSize, boxWidth, itemHeight) + 10;
            } else {
                height = this.maxHeight;
                width = this._fitCols(titleHeight, labelFont, boxWidth, itemHeight) + 10;
            }
            this.width = Math.min(width, options.maxWidth || this.maxWidth);
            this.height = Math.min(height, options.maxHeight || this.maxHeight);
        }
     _fitRows(titleHeight, fontSize, boxWidth, itemHeight) {
            const { ctx , maxWidth , options: { labels: { padding  }  }  } = this;
            const hitboxes = this.legendHitBoxes = [];
            const lineWidths = this.lineWidths = [
                0
            ];
            const lineHeight = itemHeight + padding;
            let totalHeight = titleHeight;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            let row = -1;
            let top = -lineHeight;
            this.legendItems.forEach((legendItem, i)=>{
                const itemWidth = boxWidth + fontSize / 2 + ctx.measureText(legendItem.text).width;
                if (i === 0 || lineWidths[lineWidths.length - 1] + itemWidth + 2 * padding > maxWidth) {
                    totalHeight += lineHeight;
                    lineWidths[lineWidths.length - (i > 0 ? 0 : 1)] = 0;
                    top += lineHeight;
                    row++;
                }
                hitboxes[i] = {
                    left: 0,
                    top,
                    row,
                    width: itemWidth,
                    height: itemHeight
                };
                lineWidths[lineWidths.length - 1] += itemWidth + padding;
            });
            return totalHeight;
        }
        _fitCols(titleHeight, labelFont, boxWidth, _itemHeight) {
            const { ctx , maxHeight , options: { labels: { padding  }  }  } = this;
            const hitboxes = this.legendHitBoxes = [];
            const columnSizes = this.columnSizes = [];
            const heightLimit = maxHeight - titleHeight;
            let totalWidth = padding;
            let currentColWidth = 0;
            let currentColHeight = 0;
            let left = 0;
            let col = 0;
            this.legendItems.forEach((legendItem, i)=>{
                const { itemWidth , itemHeight  } = calculateItemSize(boxWidth, labelFont, ctx, legendItem, _itemHeight);
                if (i > 0 && currentColHeight + itemHeight + 2 * padding > heightLimit) {
                    totalWidth += currentColWidth + padding;
                    columnSizes.push({
                        width: currentColWidth,
                        height: currentColHeight
                    });
                    left += currentColWidth + padding;
                    col++;
                    currentColWidth = currentColHeight = 0;
                }
                hitboxes[i] = {
                    left,
                    top: currentColHeight,
                    col,
                    width: itemWidth,
                    height: itemHeight
                };
                currentColWidth = Math.max(currentColWidth, itemWidth);
                currentColHeight += itemHeight + padding;
            });
            totalWidth += currentColWidth;
            columnSizes.push({
                width: currentColWidth,
                height: currentColHeight
            });
            return totalWidth;
        }
        adjustHitBoxes() {
            if (!this.options.display) {
                return;
            }
            const titleHeight = this._computeTitleHeight();
            const { legendHitBoxes: hitboxes , options: { align , labels: { padding  } , rtl  }  } = this;
            const rtlHelper = getRtlAdapter(rtl, this.left, this.width);
            if (this.isHorizontal()) {
                let row = 0;
                let left = _alignStartEnd(align, this.left + padding, this.right - this.lineWidths[row]);
                for (const hitbox of hitboxes){
                    if (row !== hitbox.row) {
                        row = hitbox.row;
                        left = _alignStartEnd(align, this.left + padding, this.right - this.lineWidths[row]);
                    }
                    hitbox.top += this.top + titleHeight + padding;
                    hitbox.left = rtlHelper.leftForLtr(rtlHelper.x(left), hitbox.width);
                    left += hitbox.width + padding;
                }
            } else {
                let col = 0;
                let top = _alignStartEnd(align, this.top + titleHeight + padding, this.bottom - this.columnSizes[col].height);
                for (const hitbox of hitboxes){
                    if (hitbox.col !== col) {
                        col = hitbox.col;
                        top = _alignStartEnd(align, this.top + titleHeight + padding, this.bottom - this.columnSizes[col].height);
                    }
                    hitbox.top = top;
                    hitbox.left += this.left + padding;
                    hitbox.left = rtlHelper.leftForLtr(rtlHelper.x(hitbox.left), hitbox.width);
                    top += hitbox.height + padding;
                }
            }
        }
        isHorizontal() {
            return this.options.position === 'top' || this.options.position === 'bottom';
        }
        draw() {
            if (this.options.display) {
                const ctx = this.ctx;
                clipArea(ctx, this);
                this._draw();
                unclipArea(ctx);
            }
        }
     _draw() {
            const { options: opts , columnSizes , lineWidths , ctx  } = this;
            const { align , labels: labelOpts  } = opts;
            const defaultColor = defaults.color;
            const rtlHelper = getRtlAdapter(opts.rtl, this.left, this.width);
            const labelFont = toFont(labelOpts.font);
            const { padding  } = labelOpts;
            const fontSize = labelFont.size;
            const halfFontSize = fontSize / 2;
            let cursor;
            this.drawTitle();
            ctx.textAlign = rtlHelper.textAlign('left');
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 0.5;
            ctx.font = labelFont.string;
            const { boxWidth , boxHeight , itemHeight  } = getBoxSize(labelOpts, fontSize);
            const drawLegendBox = function(x, y, legendItem) {
                if (isNaN(boxWidth) || boxWidth <= 0 || isNaN(boxHeight) || boxHeight < 0) {
                    return;
                }
                ctx.save();
                const lineWidth = valueOrDefault(legendItem.lineWidth, 1);
                ctx.fillStyle = valueOrDefault(legendItem.fillStyle, defaultColor);
                ctx.lineCap = valueOrDefault(legendItem.lineCap, 'butt');
                ctx.lineDashOffset = valueOrDefault(legendItem.lineDashOffset, 0);
                ctx.lineJoin = valueOrDefault(legendItem.lineJoin, 'miter');
                ctx.lineWidth = lineWidth;
                ctx.strokeStyle = valueOrDefault(legendItem.strokeStyle, defaultColor);
                ctx.setLineDash(valueOrDefault(legendItem.lineDash, []));
                if (labelOpts.usePointStyle) {
                    const drawOptions = {
                        radius: boxHeight * Math.SQRT2 / 2,
                        pointStyle: legendItem.pointStyle,
                        rotation: legendItem.rotation,
                        borderWidth: lineWidth
                    };
                    const centerX = rtlHelper.xPlus(x, boxWidth / 2);
                    const centerY = y + halfFontSize;
                    drawPointLegend(ctx, drawOptions, centerX, centerY, labelOpts.pointStyleWidth && boxWidth);
                } else {
                    const yBoxTop = y + Math.max((fontSize - boxHeight) / 2, 0);
                    const xBoxLeft = rtlHelper.leftForLtr(x, boxWidth);
                    const borderRadius = toTRBLCorners(legendItem.borderRadius);
                    ctx.beginPath();
                    if (Object.values(borderRadius).some((v)=>v !== 0)) {
                        addRoundedRectPath(ctx, {
                            x: xBoxLeft,
                            y: yBoxTop,
                            w: boxWidth,
                            h: boxHeight,
                            radius: borderRadius
                        });
                    } else {
                        ctx.rect(xBoxLeft, yBoxTop, boxWidth, boxHeight);
                    }
                    ctx.fill();
                    if (lineWidth !== 0) {
                        ctx.stroke();
                    }
                }
                ctx.restore();
            };
            const fillText = function(x, y, legendItem) {
                renderText(ctx, legendItem.text, x, y + itemHeight / 2, labelFont, {
                    strikethrough: legendItem.hidden,
                    textAlign: rtlHelper.textAlign(legendItem.textAlign)
                });
            };
            const isHorizontal = this.isHorizontal();
            const titleHeight = this._computeTitleHeight();
            if (isHorizontal) {
                cursor = {
                    x: _alignStartEnd(align, this.left + padding, this.right - lineWidths[0]),
                    y: this.top + padding + titleHeight,
                    line: 0
                };
            } else {
                cursor = {
                    x: this.left + padding,
                    y: _alignStartEnd(align, this.top + titleHeight + padding, this.bottom - columnSizes[0].height),
                    line: 0
                };
            }
            overrideTextDirection(this.ctx, opts.textDirection);
            const lineHeight = itemHeight + padding;
            this.legendItems.forEach((legendItem, i)=>{
                ctx.strokeStyle = legendItem.fontColor;
                ctx.fillStyle = legendItem.fontColor;
                const textWidth = ctx.measureText(legendItem.text).width;
                const textAlign = rtlHelper.textAlign(legendItem.textAlign || (legendItem.textAlign = labelOpts.textAlign));
                const width = boxWidth + halfFontSize + textWidth;
                let x = cursor.x;
                let y = cursor.y;
                rtlHelper.setWidth(this.width);
                if (isHorizontal) {
                    if (i > 0 && x + width + padding > this.right) {
                        y = cursor.y += lineHeight;
                        cursor.line++;
                        x = cursor.x = _alignStartEnd(align, this.left + padding, this.right - lineWidths[cursor.line]);
                    }
                } else if (i > 0 && y + lineHeight > this.bottom) {
                    x = cursor.x = x + columnSizes[cursor.line].width + padding;
                    cursor.line++;
                    y = cursor.y = _alignStartEnd(align, this.top + titleHeight + padding, this.bottom - columnSizes[cursor.line].height);
                }
                const realX = rtlHelper.x(x);
                drawLegendBox(realX, y, legendItem);
                x = _textX(textAlign, x + boxWidth + halfFontSize, isHorizontal ? x + width : this.right, opts.rtl);
                fillText(rtlHelper.x(x), y, legendItem);
                if (isHorizontal) {
                    cursor.x += width + padding;
                } else if (typeof legendItem.text !== 'string') {
                    const fontLineHeight = labelFont.lineHeight;
                    cursor.y += calculateLegendItemHeight(legendItem, fontLineHeight) + padding;
                } else {
                    cursor.y += lineHeight;
                }
            });
            restoreTextDirection(this.ctx, opts.textDirection);
        }
     drawTitle() {
            const opts = this.options;
            const titleOpts = opts.title;
            const titleFont = toFont(titleOpts.font);
            const titlePadding = toPadding(titleOpts.padding);
            if (!titleOpts.display) {
                return;
            }
            const rtlHelper = getRtlAdapter(opts.rtl, this.left, this.width);
            const ctx = this.ctx;
            const position = titleOpts.position;
            const halfFontSize = titleFont.size / 2;
            const topPaddingPlusHalfFontSize = titlePadding.top + halfFontSize;
            let y;
            let left = this.left;
            let maxWidth = this.width;
            if (this.isHorizontal()) {
                maxWidth = Math.max(...this.lineWidths);
                y = this.top + topPaddingPlusHalfFontSize;
                left = _alignStartEnd(opts.align, left, this.right - maxWidth);
            } else {
                const maxHeight = this.columnSizes.reduce((acc, size)=>Math.max(acc, size.height), 0);
                y = topPaddingPlusHalfFontSize + _alignStartEnd(opts.align, this.top, this.bottom - maxHeight - opts.labels.padding - this._computeTitleHeight());
            }
            const x = _alignStartEnd(position, left, left + maxWidth);
            ctx.textAlign = rtlHelper.textAlign(_toLeftRightCenter(position));
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = titleOpts.color;
            ctx.fillStyle = titleOpts.color;
            ctx.font = titleFont.string;
            renderText(ctx, titleOpts.text, x, y, titleFont);
        }
     _computeTitleHeight() {
            const titleOpts = this.options.title;
            const titleFont = toFont(titleOpts.font);
            const titlePadding = toPadding(titleOpts.padding);
            return titleOpts.display ? titleFont.lineHeight + titlePadding.height : 0;
        }
     _getLegendItemAt(x, y) {
            let i, hitBox, lh;
            if (_isBetween(x, this.left, this.right) && _isBetween(y, this.top, this.bottom)) {
                lh = this.legendHitBoxes;
                for(i = 0; i < lh.length; ++i){
                    hitBox = lh[i];
                    if (_isBetween(x, hitBox.left, hitBox.left + hitBox.width) && _isBetween(y, hitBox.top, hitBox.top + hitBox.height)) {
                        return this.legendItems[i];
                    }
                }
            }
            return null;
        }
     handleEvent(e) {
            const opts = this.options;
            if (!isListened(e.type, opts)) {
                return;
            }
            const hoveredItem = this._getLegendItemAt(e.x, e.y);
            if (e.type === 'mousemove' || e.type === 'mouseout') {
                const previous = this._hoveredItem;
                const sameItem = itemsEqual(previous, hoveredItem);
                if (previous && !sameItem) {
                    callback(opts.onLeave, [
                        e,
                        previous,
                        this
                    ], this);
                }
                this._hoveredItem = hoveredItem;
                if (hoveredItem && !sameItem) {
                    callback(opts.onHover, [
                        e,
                        hoveredItem,
                        this
                    ], this);
                }
            } else if (hoveredItem) {
                callback(opts.onClick, [
                    e,
                    hoveredItem,
                    this
                ], this);
            }
        }
    }
    function calculateItemSize(boxWidth, labelFont, ctx, legendItem, _itemHeight) {
        const itemWidth = calculateItemWidth(legendItem, boxWidth, labelFont, ctx);
        const itemHeight = calculateItemHeight(_itemHeight, legendItem, labelFont.lineHeight);
        return {
            itemWidth,
            itemHeight
        };
    }
    function calculateItemWidth(legendItem, boxWidth, labelFont, ctx) {
        let legendItemText = legendItem.text;
        if (legendItemText && typeof legendItemText !== 'string') {
            legendItemText = legendItemText.reduce((a, b)=>a.length > b.length ? a : b);
        }
        return boxWidth + labelFont.size / 2 + ctx.measureText(legendItemText).width;
    }
    function calculateItemHeight(_itemHeight, legendItem, fontLineHeight) {
        let itemHeight = _itemHeight;
        if (typeof legendItem.text !== 'string') {
            itemHeight = calculateLegendItemHeight(legendItem, fontLineHeight);
        }
        return itemHeight;
    }
    function calculateLegendItemHeight(legendItem, fontLineHeight) {
        const labelHeight = legendItem.text ? legendItem.text.length : 0;
        return fontLineHeight * labelHeight;
    }
    function isListened(type, opts) {
        if ((type === 'mousemove' || type === 'mouseout') && (opts.onHover || opts.onLeave)) {
            return true;
        }
        if (opts.onClick && (type === 'click' || type === 'mouseup')) {
            return true;
        }
        return false;
    }
    var plugin_legend = {
        id: 'legend',
     _element: Legend,
        start (chart, _args, options) {
            const legend = chart.legend = new Legend({
                ctx: chart.ctx,
                options,
                chart
            });
            layouts.configure(chart, legend, options);
            layouts.addBox(chart, legend);
        },
        stop (chart) {
            layouts.removeBox(chart, chart.legend);
            delete chart.legend;
        },
        beforeUpdate (chart, _args, options) {
            const legend = chart.legend;
            layouts.configure(chart, legend, options);
            legend.options = options;
        },
        afterUpdate (chart) {
            const legend = chart.legend;
            legend.buildLabels();
            legend.adjustHitBoxes();
        },
        afterEvent (chart, args) {
            if (!args.replay) {
                chart.legend.handleEvent(args.event);
            }
        },
        defaults: {
            display: true,
            position: 'top',
            align: 'center',
            fullSize: true,
            reverse: false,
            weight: 1000,
            onClick (e, legendItem, legend) {
                const index = legendItem.datasetIndex;
                const ci = legend.chart;
                if (ci.isDatasetVisible(index)) {
                    ci.hide(index);
                    legendItem.hidden = true;
                } else {
                    ci.show(index);
                    legendItem.hidden = false;
                }
            },
            onHover: null,
            onLeave: null,
            labels: {
                color: (ctx)=>ctx.chart.options.color,
                boxWidth: 40,
                padding: 10,
                generateLabels (chart) {
                    const datasets = chart.data.datasets;
                    const { labels: { usePointStyle , pointStyle , textAlign , color , useBorderRadius , borderRadius  }  } = chart.legend.options;
                    return chart._getSortedDatasetMetas().map((meta)=>{
                        const style = meta.controller.getStyle(usePointStyle ? 0 : undefined);
                        const borderWidth = toPadding(style.borderWidth);
                        return {
                            text: datasets[meta.index].label,
                            fillStyle: style.backgroundColor,
                            fontColor: color,
                            hidden: !meta.visible,
                            lineCap: style.borderCapStyle,
                            lineDash: style.borderDash,
                            lineDashOffset: style.borderDashOffset,
                            lineJoin: style.borderJoinStyle,
                            lineWidth: (borderWidth.width + borderWidth.height) / 4,
                            strokeStyle: style.borderColor,
                            pointStyle: pointStyle || style.pointStyle,
                            rotation: style.rotation,
                            textAlign: textAlign || style.textAlign,
                            borderRadius: useBorderRadius && (borderRadius || style.borderRadius),
                            datasetIndex: meta.index
                        };
                    }, this);
                }
            },
            title: {
                color: (ctx)=>ctx.chart.options.color,
                display: false,
                position: 'center',
                text: ''
            }
        },
        descriptors: {
            _scriptable: (name)=>!name.startsWith('on'),
            labels: {
                _scriptable: (name)=>![
                        'generateLabels',
                        'filter',
                        'sort'
                    ].includes(name)
            }
        }
    };

    class Title extends Element {
     constructor(config){
            super();
            this.chart = config.chart;
            this.options = config.options;
            this.ctx = config.ctx;
            this._padding = undefined;
            this.top = undefined;
            this.bottom = undefined;
            this.left = undefined;
            this.right = undefined;
            this.width = undefined;
            this.height = undefined;
            this.position = undefined;
            this.weight = undefined;
            this.fullSize = undefined;
        }
        update(maxWidth, maxHeight) {
            const opts = this.options;
            this.left = 0;
            this.top = 0;
            if (!opts.display) {
                this.width = this.height = this.right = this.bottom = 0;
                return;
            }
            this.width = this.right = maxWidth;
            this.height = this.bottom = maxHeight;
            const lineCount = isArray(opts.text) ? opts.text.length : 1;
            this._padding = toPadding(opts.padding);
            const textSize = lineCount * toFont(opts.font).lineHeight + this._padding.height;
            if (this.isHorizontal()) {
                this.height = textSize;
            } else {
                this.width = textSize;
            }
        }
        isHorizontal() {
            const pos = this.options.position;
            return pos === 'top' || pos === 'bottom';
        }
        _drawArgs(offset) {
            const { top , left , bottom , right , options  } = this;
            const align = options.align;
            let rotation = 0;
            let maxWidth, titleX, titleY;
            if (this.isHorizontal()) {
                titleX = _alignStartEnd(align, left, right);
                titleY = top + offset;
                maxWidth = right - left;
            } else {
                if (options.position === 'left') {
                    titleX = left + offset;
                    titleY = _alignStartEnd(align, bottom, top);
                    rotation = PI * -0.5;
                } else {
                    titleX = right - offset;
                    titleY = _alignStartEnd(align, top, bottom);
                    rotation = PI * 0.5;
                }
                maxWidth = bottom - top;
            }
            return {
                titleX,
                titleY,
                maxWidth,
                rotation
            };
        }
        draw() {
            const ctx = this.ctx;
            const opts = this.options;
            if (!opts.display) {
                return;
            }
            const fontOpts = toFont(opts.font);
            const lineHeight = fontOpts.lineHeight;
            const offset = lineHeight / 2 + this._padding.top;
            const { titleX , titleY , maxWidth , rotation  } = this._drawArgs(offset);
            renderText(ctx, opts.text, 0, 0, fontOpts, {
                color: opts.color,
                maxWidth,
                rotation,
                textAlign: _toLeftRightCenter(opts.align),
                textBaseline: 'middle',
                translation: [
                    titleX,
                    titleY
                ]
            });
        }
    }
    function createTitle(chart, titleOpts) {
        const title = new Title({
            ctx: chart.ctx,
            options: titleOpts,
            chart
        });
        layouts.configure(chart, title, titleOpts);
        layouts.addBox(chart, title);
        chart.titleBlock = title;
    }
    var plugin_title = {
        id: 'title',
     _element: Title,
        start (chart, _args, options) {
            createTitle(chart, options);
        },
        stop (chart) {
            const titleBlock = chart.titleBlock;
            layouts.removeBox(chart, titleBlock);
            delete chart.titleBlock;
        },
        beforeUpdate (chart, _args, options) {
            const title = chart.titleBlock;
            layouts.configure(chart, title, options);
            title.options = options;
        },
        defaults: {
            align: 'center',
            display: false,
            font: {
                weight: 'bold'
            },
            fullSize: true,
            padding: 10,
            position: 'top',
            text: '',
            weight: 2000
        },
        defaultRoutes: {
            color: 'color'
        },
        descriptors: {
            _scriptable: true,
            _indexable: false
        }
    };

    const map = new WeakMap();
    var plugin_subtitle = {
        id: 'subtitle',
        start (chart, _args, options) {
            const title = new Title({
                ctx: chart.ctx,
                options,
                chart
            });
            layouts.configure(chart, title, options);
            layouts.addBox(chart, title);
            map.set(chart, title);
        },
        stop (chart) {
            layouts.removeBox(chart, map.get(chart));
            map.delete(chart);
        },
        beforeUpdate (chart, _args, options) {
            const title = map.get(chart);
            layouts.configure(chart, title, options);
            title.options = options;
        },
        defaults: {
            align: 'center',
            display: false,
            font: {
                weight: 'normal'
            },
            fullSize: true,
            padding: 0,
            position: 'top',
            text: '',
            weight: 1500
        },
        defaultRoutes: {
            color: 'color'
        },
        descriptors: {
            _scriptable: true,
            _indexable: false
        }
    };

    const positioners = {
     average (items) {
            if (!items.length) {
                return false;
            }
            let i, len;
            let xSet = new Set();
            let y = 0;
            let count = 0;
            for(i = 0, len = items.length; i < len; ++i){
                const el = items[i].element;
                if (el && el.hasValue()) {
                    const pos = el.tooltipPosition();
                    xSet.add(pos.x);
                    y += pos.y;
                    ++count;
                }
            }
            if (count === 0 || xSet.size === 0) {
                return false;
            }
            const xAverage = [
                ...xSet
            ].reduce((a, b)=>a + b) / xSet.size;
            return {
                x: xAverage,
                y: y / count
            };
        },
     nearest (items, eventPosition) {
            if (!items.length) {
                return false;
            }
            let x = eventPosition.x;
            let y = eventPosition.y;
            let minDistance = Number.POSITIVE_INFINITY;
            let i, len, nearestElement;
            for(i = 0, len = items.length; i < len; ++i){
                const el = items[i].element;
                if (el && el.hasValue()) {
                    const center = el.getCenterPoint();
                    const d = distanceBetweenPoints(eventPosition, center);
                    if (d < minDistance) {
                        minDistance = d;
                        nearestElement = el;
                    }
                }
            }
            if (nearestElement) {
                const tp = nearestElement.tooltipPosition();
                x = tp.x;
                y = tp.y;
            }
            return {
                x,
                y
            };
        }
    };
    function pushOrConcat(base, toPush) {
        if (toPush) {
            if (isArray(toPush)) {
                Array.prototype.push.apply(base, toPush);
            } else {
                base.push(toPush);
            }
        }
        return base;
    }
     function splitNewlines(str) {
        if ((typeof str === 'string' || str instanceof String) && str.indexOf('\n') > -1) {
            return str.split('\n');
        }
        return str;
    }
     function createTooltipItem(chart, item) {
        const { element , datasetIndex , index  } = item;
        const controller = chart.getDatasetMeta(datasetIndex).controller;
        const { label , value  } = controller.getLabelAndValue(index);
        return {
            chart,
            label,
            parsed: controller.getParsed(index),
            raw: chart.data.datasets[datasetIndex].data[index],
            formattedValue: value,
            dataset: controller.getDataset(),
            dataIndex: index,
            datasetIndex,
            element
        };
    }
     function getTooltipSize(tooltip, options) {
        const ctx = tooltip.chart.ctx;
        const { body , footer , title  } = tooltip;
        const { boxWidth , boxHeight  } = options;
        const bodyFont = toFont(options.bodyFont);
        const titleFont = toFont(options.titleFont);
        const footerFont = toFont(options.footerFont);
        const titleLineCount = title.length;
        const footerLineCount = footer.length;
        const bodyLineItemCount = body.length;
        const padding = toPadding(options.padding);
        let height = padding.height;
        let width = 0;
        let combinedBodyLength = body.reduce((count, bodyItem)=>count + bodyItem.before.length + bodyItem.lines.length + bodyItem.after.length, 0);
        combinedBodyLength += tooltip.beforeBody.length + tooltip.afterBody.length;
        if (titleLineCount) {
            height += titleLineCount * titleFont.lineHeight + (titleLineCount - 1) * options.titleSpacing + options.titleMarginBottom;
        }
        if (combinedBodyLength) {
            const bodyLineHeight = options.displayColors ? Math.max(boxHeight, bodyFont.lineHeight) : bodyFont.lineHeight;
            height += bodyLineItemCount * bodyLineHeight + (combinedBodyLength - bodyLineItemCount) * bodyFont.lineHeight + (combinedBodyLength - 1) * options.bodySpacing;
        }
        if (footerLineCount) {
            height += options.footerMarginTop + footerLineCount * footerFont.lineHeight + (footerLineCount - 1) * options.footerSpacing;
        }
        let widthPadding = 0;
        const maxLineWidth = function(line) {
            width = Math.max(width, ctx.measureText(line).width + widthPadding);
        };
        ctx.save();
        ctx.font = titleFont.string;
        each(tooltip.title, maxLineWidth);
        ctx.font = bodyFont.string;
        each(tooltip.beforeBody.concat(tooltip.afterBody), maxLineWidth);
        widthPadding = options.displayColors ? boxWidth + 2 + options.boxPadding : 0;
        each(body, (bodyItem)=>{
            each(bodyItem.before, maxLineWidth);
            each(bodyItem.lines, maxLineWidth);
            each(bodyItem.after, maxLineWidth);
        });
        widthPadding = 0;
        ctx.font = footerFont.string;
        each(tooltip.footer, maxLineWidth);
        ctx.restore();
        width += padding.width;
        return {
            width,
            height
        };
    }
    function determineYAlign(chart, size) {
        const { y , height  } = size;
        if (y < height / 2) {
            return 'top';
        } else if (y > chart.height - height / 2) {
            return 'bottom';
        }
        return 'center';
    }
    function doesNotFitWithAlign(xAlign, chart, options, size) {
        const { x , width  } = size;
        const caret = options.caretSize + options.caretPadding;
        if (xAlign === 'left' && x + width + caret > chart.width) {
            return true;
        }
        if (xAlign === 'right' && x - width - caret < 0) {
            return true;
        }
    }
    function determineXAlign(chart, options, size, yAlign) {
        const { x , width  } = size;
        const { width: chartWidth , chartArea: { left , right  }  } = chart;
        let xAlign = 'center';
        if (yAlign === 'center') {
            xAlign = x <= (left + right) / 2 ? 'left' : 'right';
        } else if (x <= width / 2) {
            xAlign = 'left';
        } else if (x >= chartWidth - width / 2) {
            xAlign = 'right';
        }
        if (doesNotFitWithAlign(xAlign, chart, options, size)) {
            xAlign = 'center';
        }
        return xAlign;
    }
     function determineAlignment(chart, options, size) {
        const yAlign = size.yAlign || options.yAlign || determineYAlign(chart, size);
        return {
            xAlign: size.xAlign || options.xAlign || determineXAlign(chart, options, size, yAlign),
            yAlign
        };
    }
    function alignX(size, xAlign) {
        let { x , width  } = size;
        if (xAlign === 'right') {
            x -= width;
        } else if (xAlign === 'center') {
            x -= width / 2;
        }
        return x;
    }
    function alignY(size, yAlign, paddingAndSize) {
        let { y , height  } = size;
        if (yAlign === 'top') {
            y += paddingAndSize;
        } else if (yAlign === 'bottom') {
            y -= height + paddingAndSize;
        } else {
            y -= height / 2;
        }
        return y;
    }
     function getBackgroundPoint(options, size, alignment, chart) {
        const { caretSize , caretPadding , cornerRadius  } = options;
        const { xAlign , yAlign  } = alignment;
        const paddingAndSize = caretSize + caretPadding;
        const { topLeft , topRight , bottomLeft , bottomRight  } = toTRBLCorners(cornerRadius);
        let x = alignX(size, xAlign);
        const y = alignY(size, yAlign, paddingAndSize);
        if (yAlign === 'center') {
            if (xAlign === 'left') {
                x += paddingAndSize;
            } else if (xAlign === 'right') {
                x -= paddingAndSize;
            }
        } else if (xAlign === 'left') {
            x -= Math.max(topLeft, bottomLeft) + caretSize;
        } else if (xAlign === 'right') {
            x += Math.max(topRight, bottomRight) + caretSize;
        }
        return {
            x: _limitValue(x, 0, chart.width - size.width),
            y: _limitValue(y, 0, chart.height - size.height)
        };
    }
    function getAlignedX(tooltip, align, options) {
        const padding = toPadding(options.padding);
        return align === 'center' ? tooltip.x + tooltip.width / 2 : align === 'right' ? tooltip.x + tooltip.width - padding.right : tooltip.x + padding.left;
    }
     function getBeforeAfterBodyLines(callback) {
        return pushOrConcat([], splitNewlines(callback));
    }
    function createTooltipContext(parent, tooltip, tooltipItems) {
        return createContext(parent, {
            tooltip,
            tooltipItems,
            type: 'tooltip'
        });
    }
    function overrideCallbacks(callbacks, context) {
        const override = context && context.dataset && context.dataset.tooltip && context.dataset.tooltip.callbacks;
        return override ? callbacks.override(override) : callbacks;
    }
    const defaultCallbacks = {
        beforeTitle: noop,
        title (tooltipItems) {
            if (tooltipItems.length > 0) {
                const item = tooltipItems[0];
                const labels = item.chart.data.labels;
                const labelCount = labels ? labels.length : 0;
                if (this && this.options && this.options.mode === 'dataset') {
                    return item.dataset.label || '';
                } else if (item.label) {
                    return item.label;
                } else if (labelCount > 0 && item.dataIndex < labelCount) {
                    return labels[item.dataIndex];
                }
            }
            return '';
        },
        afterTitle: noop,
        beforeBody: noop,
        beforeLabel: noop,
        label (tooltipItem) {
            if (this && this.options && this.options.mode === 'dataset') {
                return tooltipItem.label + ': ' + tooltipItem.formattedValue || tooltipItem.formattedValue;
            }
            let label = tooltipItem.dataset.label || '';
            if (label) {
                label += ': ';
            }
            const value = tooltipItem.formattedValue;
            if (!isNullOrUndef(value)) {
                label += value;
            }
            return label;
        },
        labelColor (tooltipItem) {
            const meta = tooltipItem.chart.getDatasetMeta(tooltipItem.datasetIndex);
            const options = meta.controller.getStyle(tooltipItem.dataIndex);
            return {
                borderColor: options.borderColor,
                backgroundColor: options.backgroundColor,
                borderWidth: options.borderWidth,
                borderDash: options.borderDash,
                borderDashOffset: options.borderDashOffset,
                borderRadius: 0
            };
        },
        labelTextColor () {
            return this.options.bodyColor;
        },
        labelPointStyle (tooltipItem) {
            const meta = tooltipItem.chart.getDatasetMeta(tooltipItem.datasetIndex);
            const options = meta.controller.getStyle(tooltipItem.dataIndex);
            return {
                pointStyle: options.pointStyle,
                rotation: options.rotation
            };
        },
        afterLabel: noop,
        afterBody: noop,
        beforeFooter: noop,
        footer: noop,
        afterFooter: noop
    };
     function invokeCallbackWithFallback(callbacks, name, ctx, arg) {
        const result = callbacks[name].call(ctx, arg);
        if (typeof result === 'undefined') {
            return defaultCallbacks[name].call(ctx, arg);
        }
        return result;
    }
    class Tooltip extends Element {
     static positioners = positioners;
        constructor(config){
            super();
            this.opacity = 0;
            this._active = [];
            this._eventPosition = undefined;
            this._size = undefined;
            this._cachedAnimations = undefined;
            this._tooltipItems = [];
            this.$animations = undefined;
            this.$context = undefined;
            this.chart = config.chart;
            this.options = config.options;
            this.dataPoints = undefined;
            this.title = undefined;
            this.beforeBody = undefined;
            this.body = undefined;
            this.afterBody = undefined;
            this.footer = undefined;
            this.xAlign = undefined;
            this.yAlign = undefined;
            this.x = undefined;
            this.y = undefined;
            this.height = undefined;
            this.width = undefined;
            this.caretX = undefined;
            this.caretY = undefined;
            this.labelColors = undefined;
            this.labelPointStyles = undefined;
            this.labelTextColors = undefined;
        }
        initialize(options) {
            this.options = options;
            this._cachedAnimations = undefined;
            this.$context = undefined;
        }
     _resolveAnimations() {
            const cached = this._cachedAnimations;
            if (cached) {
                return cached;
            }
            const chart = this.chart;
            const options = this.options.setContext(this.getContext());
            const opts = options.enabled && chart.options.animation && options.animations;
            const animations = new Animations(this.chart, opts);
            if (opts._cacheable) {
                this._cachedAnimations = Object.freeze(animations);
            }
            return animations;
        }
     getContext() {
            return this.$context || (this.$context = createTooltipContext(this.chart.getContext(), this, this._tooltipItems));
        }
        getTitle(context, options) {
            const { callbacks  } = options;
            const beforeTitle = invokeCallbackWithFallback(callbacks, 'beforeTitle', this, context);
            const title = invokeCallbackWithFallback(callbacks, 'title', this, context);
            const afterTitle = invokeCallbackWithFallback(callbacks, 'afterTitle', this, context);
            let lines = [];
            lines = pushOrConcat(lines, splitNewlines(beforeTitle));
            lines = pushOrConcat(lines, splitNewlines(title));
            lines = pushOrConcat(lines, splitNewlines(afterTitle));
            return lines;
        }
        getBeforeBody(tooltipItems, options) {
            return getBeforeAfterBodyLines(invokeCallbackWithFallback(options.callbacks, 'beforeBody', this, tooltipItems));
        }
        getBody(tooltipItems, options) {
            const { callbacks  } = options;
            const bodyItems = [];
            each(tooltipItems, (context)=>{
                const bodyItem = {
                    before: [],
                    lines: [],
                    after: []
                };
                const scoped = overrideCallbacks(callbacks, context);
                pushOrConcat(bodyItem.before, splitNewlines(invokeCallbackWithFallback(scoped, 'beforeLabel', this, context)));
                pushOrConcat(bodyItem.lines, invokeCallbackWithFallback(scoped, 'label', this, context));
                pushOrConcat(bodyItem.after, splitNewlines(invokeCallbackWithFallback(scoped, 'afterLabel', this, context)));
                bodyItems.push(bodyItem);
            });
            return bodyItems;
        }
        getAfterBody(tooltipItems, options) {
            return getBeforeAfterBodyLines(invokeCallbackWithFallback(options.callbacks, 'afterBody', this, tooltipItems));
        }
        getFooter(tooltipItems, options) {
            const { callbacks  } = options;
            const beforeFooter = invokeCallbackWithFallback(callbacks, 'beforeFooter', this, tooltipItems);
            const footer = invokeCallbackWithFallback(callbacks, 'footer', this, tooltipItems);
            const afterFooter = invokeCallbackWithFallback(callbacks, 'afterFooter', this, tooltipItems);
            let lines = [];
            lines = pushOrConcat(lines, splitNewlines(beforeFooter));
            lines = pushOrConcat(lines, splitNewlines(footer));
            lines = pushOrConcat(lines, splitNewlines(afterFooter));
            return lines;
        }
     _createItems(options) {
            const active = this._active;
            const data = this.chart.data;
            const labelColors = [];
            const labelPointStyles = [];
            const labelTextColors = [];
            let tooltipItems = [];
            let i, len;
            for(i = 0, len = active.length; i < len; ++i){
                tooltipItems.push(createTooltipItem(this.chart, active[i]));
            }
            if (options.filter) {
                tooltipItems = tooltipItems.filter((element, index, array)=>options.filter(element, index, array, data));
            }
            if (options.itemSort) {
                tooltipItems = tooltipItems.sort((a, b)=>options.itemSort(a, b, data));
            }
            each(tooltipItems, (context)=>{
                const scoped = overrideCallbacks(options.callbacks, context);
                labelColors.push(invokeCallbackWithFallback(scoped, 'labelColor', this, context));
                labelPointStyles.push(invokeCallbackWithFallback(scoped, 'labelPointStyle', this, context));
                labelTextColors.push(invokeCallbackWithFallback(scoped, 'labelTextColor', this, context));
            });
            this.labelColors = labelColors;
            this.labelPointStyles = labelPointStyles;
            this.labelTextColors = labelTextColors;
            this.dataPoints = tooltipItems;
            return tooltipItems;
        }
        update(changed, replay) {
            const options = this.options.setContext(this.getContext());
            const active = this._active;
            let properties;
            let tooltipItems = [];
            if (!active.length) {
                if (this.opacity !== 0) {
                    properties = {
                        opacity: 0
                    };
                }
            } else {
                const position = positioners[options.position].call(this, active, this._eventPosition);
                tooltipItems = this._createItems(options);
                this.title = this.getTitle(tooltipItems, options);
                this.beforeBody = this.getBeforeBody(tooltipItems, options);
                this.body = this.getBody(tooltipItems, options);
                this.afterBody = this.getAfterBody(tooltipItems, options);
                this.footer = this.getFooter(tooltipItems, options);
                const size = this._size = getTooltipSize(this, options);
                const positionAndSize = Object.assign({}, position, size);
                const alignment = determineAlignment(this.chart, options, positionAndSize);
                const backgroundPoint = getBackgroundPoint(options, positionAndSize, alignment, this.chart);
                this.xAlign = alignment.xAlign;
                this.yAlign = alignment.yAlign;
                properties = {
                    opacity: 1,
                    x: backgroundPoint.x,
                    y: backgroundPoint.y,
                    width: size.width,
                    height: size.height,
                    caretX: position.x,
                    caretY: position.y
                };
            }
            this._tooltipItems = tooltipItems;
            this.$context = undefined;
            if (properties) {
                this._resolveAnimations().update(this, properties);
            }
            if (changed && options.external) {
                options.external.call(this, {
                    chart: this.chart,
                    tooltip: this,
                    replay
                });
            }
        }
        drawCaret(tooltipPoint, ctx, size, options) {
            const caretPosition = this.getCaretPosition(tooltipPoint, size, options);
            ctx.lineTo(caretPosition.x1, caretPosition.y1);
            ctx.lineTo(caretPosition.x2, caretPosition.y2);
            ctx.lineTo(caretPosition.x3, caretPosition.y3);
        }
        getCaretPosition(tooltipPoint, size, options) {
            const { xAlign , yAlign  } = this;
            const { caretSize , cornerRadius  } = options;
            const { topLeft , topRight , bottomLeft , bottomRight  } = toTRBLCorners(cornerRadius);
            const { x: ptX , y: ptY  } = tooltipPoint;
            const { width , height  } = size;
            let x1, x2, x3, y1, y2, y3;
            if (yAlign === 'center') {
                y2 = ptY + height / 2;
                if (xAlign === 'left') {
                    x1 = ptX;
                    x2 = x1 - caretSize;
                    y1 = y2 + caretSize;
                    y3 = y2 - caretSize;
                } else {
                    x1 = ptX + width;
                    x2 = x1 + caretSize;
                    y1 = y2 - caretSize;
                    y3 = y2 + caretSize;
                }
                x3 = x1;
            } else {
                if (xAlign === 'left') {
                    x2 = ptX + Math.max(topLeft, bottomLeft) + caretSize;
                } else if (xAlign === 'right') {
                    x2 = ptX + width - Math.max(topRight, bottomRight) - caretSize;
                } else {
                    x2 = this.caretX;
                }
                if (yAlign === 'top') {
                    y1 = ptY;
                    y2 = y1 - caretSize;
                    x1 = x2 - caretSize;
                    x3 = x2 + caretSize;
                } else {
                    y1 = ptY + height;
                    y2 = y1 + caretSize;
                    x1 = x2 + caretSize;
                    x3 = x2 - caretSize;
                }
                y3 = y1;
            }
            return {
                x1,
                x2,
                x3,
                y1,
                y2,
                y3
            };
        }
        drawTitle(pt, ctx, options) {
            const title = this.title;
            const length = title.length;
            let titleFont, titleSpacing, i;
            if (length) {
                const rtlHelper = getRtlAdapter(options.rtl, this.x, this.width);
                pt.x = getAlignedX(this, options.titleAlign, options);
                ctx.textAlign = rtlHelper.textAlign(options.titleAlign);
                ctx.textBaseline = 'middle';
                titleFont = toFont(options.titleFont);
                titleSpacing = options.titleSpacing;
                ctx.fillStyle = options.titleColor;
                ctx.font = titleFont.string;
                for(i = 0; i < length; ++i){
                    ctx.fillText(title[i], rtlHelper.x(pt.x), pt.y + titleFont.lineHeight / 2);
                    pt.y += titleFont.lineHeight + titleSpacing;
                    if (i + 1 === length) {
                        pt.y += options.titleMarginBottom - titleSpacing;
                    }
                }
            }
        }
     _drawColorBox(ctx, pt, i, rtlHelper, options) {
            const labelColor = this.labelColors[i];
            const labelPointStyle = this.labelPointStyles[i];
            const { boxHeight , boxWidth  } = options;
            const bodyFont = toFont(options.bodyFont);
            const colorX = getAlignedX(this, 'left', options);
            const rtlColorX = rtlHelper.x(colorX);
            const yOffSet = boxHeight < bodyFont.lineHeight ? (bodyFont.lineHeight - boxHeight) / 2 : 0;
            const colorY = pt.y + yOffSet;
            if (options.usePointStyle) {
                const drawOptions = {
                    radius: Math.min(boxWidth, boxHeight) / 2,
                    pointStyle: labelPointStyle.pointStyle,
                    rotation: labelPointStyle.rotation,
                    borderWidth: 1
                };
                const centerX = rtlHelper.leftForLtr(rtlColorX, boxWidth) + boxWidth / 2;
                const centerY = colorY + boxHeight / 2;
                ctx.strokeStyle = options.multiKeyBackground;
                ctx.fillStyle = options.multiKeyBackground;
                drawPoint(ctx, drawOptions, centerX, centerY);
                ctx.strokeStyle = labelColor.borderColor;
                ctx.fillStyle = labelColor.backgroundColor;
                drawPoint(ctx, drawOptions, centerX, centerY);
            } else {
                ctx.lineWidth = isObject(labelColor.borderWidth) ? Math.max(...Object.values(labelColor.borderWidth)) : labelColor.borderWidth || 1;
                ctx.strokeStyle = labelColor.borderColor;
                ctx.setLineDash(labelColor.borderDash || []);
                ctx.lineDashOffset = labelColor.borderDashOffset || 0;
                const outerX = rtlHelper.leftForLtr(rtlColorX, boxWidth);
                const innerX = rtlHelper.leftForLtr(rtlHelper.xPlus(rtlColorX, 1), boxWidth - 2);
                const borderRadius = toTRBLCorners(labelColor.borderRadius);
                if (Object.values(borderRadius).some((v)=>v !== 0)) {
                    ctx.beginPath();
                    ctx.fillStyle = options.multiKeyBackground;
                    addRoundedRectPath(ctx, {
                        x: outerX,
                        y: colorY,
                        w: boxWidth,
                        h: boxHeight,
                        radius: borderRadius
                    });
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = labelColor.backgroundColor;
                    ctx.beginPath();
                    addRoundedRectPath(ctx, {
                        x: innerX,
                        y: colorY + 1,
                        w: boxWidth - 2,
                        h: boxHeight - 2,
                        radius: borderRadius
                    });
                    ctx.fill();
                } else {
                    ctx.fillStyle = options.multiKeyBackground;
                    ctx.fillRect(outerX, colorY, boxWidth, boxHeight);
                    ctx.strokeRect(outerX, colorY, boxWidth, boxHeight);
                    ctx.fillStyle = labelColor.backgroundColor;
                    ctx.fillRect(innerX, colorY + 1, boxWidth - 2, boxHeight - 2);
                }
            }
            ctx.fillStyle = this.labelTextColors[i];
        }
        drawBody(pt, ctx, options) {
            const { body  } = this;
            const { bodySpacing , bodyAlign , displayColors , boxHeight , boxWidth , boxPadding  } = options;
            const bodyFont = toFont(options.bodyFont);
            let bodyLineHeight = bodyFont.lineHeight;
            let xLinePadding = 0;
            const rtlHelper = getRtlAdapter(options.rtl, this.x, this.width);
            const fillLineOfText = function(line) {
                ctx.fillText(line, rtlHelper.x(pt.x + xLinePadding), pt.y + bodyLineHeight / 2);
                pt.y += bodyLineHeight + bodySpacing;
            };
            const bodyAlignForCalculation = rtlHelper.textAlign(bodyAlign);
            let bodyItem, textColor, lines, i, j, ilen, jlen;
            ctx.textAlign = bodyAlign;
            ctx.textBaseline = 'middle';
            ctx.font = bodyFont.string;
            pt.x = getAlignedX(this, bodyAlignForCalculation, options);
            ctx.fillStyle = options.bodyColor;
            each(this.beforeBody, fillLineOfText);
            xLinePadding = displayColors && bodyAlignForCalculation !== 'right' ? bodyAlign === 'center' ? boxWidth / 2 + boxPadding : boxWidth + 2 + boxPadding : 0;
            for(i = 0, ilen = body.length; i < ilen; ++i){
                bodyItem = body[i];
                textColor = this.labelTextColors[i];
                ctx.fillStyle = textColor;
                each(bodyItem.before, fillLineOfText);
                lines = bodyItem.lines;
                if (displayColors && lines.length) {
                    this._drawColorBox(ctx, pt, i, rtlHelper, options);
                    bodyLineHeight = Math.max(bodyFont.lineHeight, boxHeight);
                }
                for(j = 0, jlen = lines.length; j < jlen; ++j){
                    fillLineOfText(lines[j]);
                    bodyLineHeight = bodyFont.lineHeight;
                }
                each(bodyItem.after, fillLineOfText);
            }
            xLinePadding = 0;
            bodyLineHeight = bodyFont.lineHeight;
            each(this.afterBody, fillLineOfText);
            pt.y -= bodySpacing;
        }
        drawFooter(pt, ctx, options) {
            const footer = this.footer;
            const length = footer.length;
            let footerFont, i;
            if (length) {
                const rtlHelper = getRtlAdapter(options.rtl, this.x, this.width);
                pt.x = getAlignedX(this, options.footerAlign, options);
                pt.y += options.footerMarginTop;
                ctx.textAlign = rtlHelper.textAlign(options.footerAlign);
                ctx.textBaseline = 'middle';
                footerFont = toFont(options.footerFont);
                ctx.fillStyle = options.footerColor;
                ctx.font = footerFont.string;
                for(i = 0; i < length; ++i){
                    ctx.fillText(footer[i], rtlHelper.x(pt.x), pt.y + footerFont.lineHeight / 2);
                    pt.y += footerFont.lineHeight + options.footerSpacing;
                }
            }
        }
        drawBackground(pt, ctx, tooltipSize, options) {
            const { xAlign , yAlign  } = this;
            const { x , y  } = pt;
            const { width , height  } = tooltipSize;
            const { topLeft , topRight , bottomLeft , bottomRight  } = toTRBLCorners(options.cornerRadius);
            ctx.fillStyle = options.backgroundColor;
            ctx.strokeStyle = options.borderColor;
            ctx.lineWidth = options.borderWidth;
            ctx.beginPath();
            ctx.moveTo(x + topLeft, y);
            if (yAlign === 'top') {
                this.drawCaret(pt, ctx, tooltipSize, options);
            }
            ctx.lineTo(x + width - topRight, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + topRight);
            if (yAlign === 'center' && xAlign === 'right') {
                this.drawCaret(pt, ctx, tooltipSize, options);
            }
            ctx.lineTo(x + width, y + height - bottomRight);
            ctx.quadraticCurveTo(x + width, y + height, x + width - bottomRight, y + height);
            if (yAlign === 'bottom') {
                this.drawCaret(pt, ctx, tooltipSize, options);
            }
            ctx.lineTo(x + bottomLeft, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - bottomLeft);
            if (yAlign === 'center' && xAlign === 'left') {
                this.drawCaret(pt, ctx, tooltipSize, options);
            }
            ctx.lineTo(x, y + topLeft);
            ctx.quadraticCurveTo(x, y, x + topLeft, y);
            ctx.closePath();
            ctx.fill();
            if (options.borderWidth > 0) {
                ctx.stroke();
            }
        }
     _updateAnimationTarget(options) {
            const chart = this.chart;
            const anims = this.$animations;
            const animX = anims && anims.x;
            const animY = anims && anims.y;
            if (animX || animY) {
                const position = positioners[options.position].call(this, this._active, this._eventPosition);
                if (!position) {
                    return;
                }
                const size = this._size = getTooltipSize(this, options);
                const positionAndSize = Object.assign({}, position, this._size);
                const alignment = determineAlignment(chart, options, positionAndSize);
                const point = getBackgroundPoint(options, positionAndSize, alignment, chart);
                if (animX._to !== point.x || animY._to !== point.y) {
                    this.xAlign = alignment.xAlign;
                    this.yAlign = alignment.yAlign;
                    this.width = size.width;
                    this.height = size.height;
                    this.caretX = position.x;
                    this.caretY = position.y;
                    this._resolveAnimations().update(this, point);
                }
            }
        }
     _willRender() {
            return !!this.opacity;
        }
        draw(ctx) {
            const options = this.options.setContext(this.getContext());
            let opacity = this.opacity;
            if (!opacity) {
                return;
            }
            this._updateAnimationTarget(options);
            const tooltipSize = {
                width: this.width,
                height: this.height
            };
            const pt = {
                x: this.x,
                y: this.y
            };
            opacity = Math.abs(opacity) < 1e-3 ? 0 : opacity;
            const padding = toPadding(options.padding);
            const hasTooltipContent = this.title.length || this.beforeBody.length || this.body.length || this.afterBody.length || this.footer.length;
            if (options.enabled && hasTooltipContent) {
                ctx.save();
                ctx.globalAlpha = opacity;
                this.drawBackground(pt, ctx, tooltipSize, options);
                overrideTextDirection(ctx, options.textDirection);
                pt.y += padding.top;
                this.drawTitle(pt, ctx, options);
                this.drawBody(pt, ctx, options);
                this.drawFooter(pt, ctx, options);
                restoreTextDirection(ctx, options.textDirection);
                ctx.restore();
            }
        }
     getActiveElements() {
            return this._active || [];
        }
     setActiveElements(activeElements, eventPosition) {
            const lastActive = this._active;
            const active = activeElements.map(({ datasetIndex , index  })=>{
                const meta = this.chart.getDatasetMeta(datasetIndex);
                if (!meta) {
                    throw new Error('Cannot find a dataset at index ' + datasetIndex);
                }
                return {
                    datasetIndex,
                    element: meta.data[index],
                    index
                };
            });
            const changed = !_elementsEqual(lastActive, active);
            const positionChanged = this._positionChanged(active, eventPosition);
            if (changed || positionChanged) {
                this._active = active;
                this._eventPosition = eventPosition;
                this._ignoreReplayEvents = true;
                this.update(true);
            }
        }
     handleEvent(e, replay, inChartArea = true) {
            if (replay && this._ignoreReplayEvents) {
                return false;
            }
            this._ignoreReplayEvents = false;
            const options = this.options;
            const lastActive = this._active || [];
            const active = this._getActiveElements(e, lastActive, replay, inChartArea);
            const positionChanged = this._positionChanged(active, e);
            const changed = replay || !_elementsEqual(active, lastActive) || positionChanged;
            if (changed) {
                this._active = active;
                if (options.enabled || options.external) {
                    this._eventPosition = {
                        x: e.x,
                        y: e.y
                    };
                    this.update(true, replay);
                }
            }
            return changed;
        }
     _getActiveElements(e, lastActive, replay, inChartArea) {
            const options = this.options;
            if (e.type === 'mouseout') {
                return [];
            }
            if (!inChartArea) {
                return lastActive.filter((i)=>this.chart.data.datasets[i.datasetIndex] && this.chart.getDatasetMeta(i.datasetIndex).controller.getParsed(i.index) !== undefined);
            }
            const active = this.chart.getElementsAtEventForMode(e, options.mode, options, replay);
            if (options.reverse) {
                active.reverse();
            }
            return active;
        }
     _positionChanged(active, e) {
            const { caretX , caretY , options  } = this;
            const position = positioners[options.position].call(this, active, e);
            return position !== false && (caretX !== position.x || caretY !== position.y);
        }
    }
    var plugin_tooltip = {
        id: 'tooltip',
        _element: Tooltip,
        positioners,
        afterInit (chart, _args, options) {
            if (options) {
                chart.tooltip = new Tooltip({
                    chart,
                    options
                });
            }
        },
        beforeUpdate (chart, _args, options) {
            if (chart.tooltip) {
                chart.tooltip.initialize(options);
            }
        },
        reset (chart, _args, options) {
            if (chart.tooltip) {
                chart.tooltip.initialize(options);
            }
        },
        afterDraw (chart) {
            const tooltip = chart.tooltip;
            if (tooltip && tooltip._willRender()) {
                const args = {
                    tooltip
                };
                if (chart.notifyPlugins('beforeTooltipDraw', {
                    ...args,
                    cancelable: true
                }) === false) {
                    return;
                }
                tooltip.draw(chart.ctx);
                chart.notifyPlugins('afterTooltipDraw', args);
            }
        },
        afterEvent (chart, args) {
            if (chart.tooltip) {
                const useFinalPosition = args.replay;
                if (chart.tooltip.handleEvent(args.event, useFinalPosition, args.inChartArea)) {
                    args.changed = true;
                }
            }
        },
        defaults: {
            enabled: true,
            external: null,
            position: 'average',
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            titleFont: {
                weight: 'bold'
            },
            titleSpacing: 2,
            titleMarginBottom: 6,
            titleAlign: 'left',
            bodyColor: '#fff',
            bodySpacing: 2,
            bodyFont: {},
            bodyAlign: 'left',
            footerColor: '#fff',
            footerSpacing: 2,
            footerMarginTop: 6,
            footerFont: {
                weight: 'bold'
            },
            footerAlign: 'left',
            padding: 6,
            caretPadding: 2,
            caretSize: 5,
            cornerRadius: 6,
            boxHeight: (ctx, opts)=>opts.bodyFont.size,
            boxWidth: (ctx, opts)=>opts.bodyFont.size,
            multiKeyBackground: '#fff',
            displayColors: true,
            boxPadding: 0,
            borderColor: 'rgba(0,0,0,0)',
            borderWidth: 0,
            animation: {
                duration: 400,
                easing: 'easeOutQuart'
            },
            animations: {
                numbers: {
                    type: 'number',
                    properties: [
                        'x',
                        'y',
                        'width',
                        'height',
                        'caretX',
                        'caretY'
                    ]
                },
                opacity: {
                    easing: 'linear',
                    duration: 200
                }
            },
            callbacks: defaultCallbacks
        },
        defaultRoutes: {
            bodyFont: 'font',
            footerFont: 'font',
            titleFont: 'font'
        },
        descriptors: {
            _scriptable: (name)=>name !== 'filter' && name !== 'itemSort' && name !== 'external',
            _indexable: false,
            callbacks: {
                _scriptable: false,
                _indexable: false
            },
            animation: {
                _fallback: false
            },
            animations: {
                _fallback: 'animation'
            }
        },
        additionalOptionScopes: [
            'interaction'
        ]
    };

    var plugins = /*#__PURE__*/Object.freeze({
    __proto__: null,
    Colors: plugin_colors,
    Decimation: plugin_decimation,
    Filler: index,
    Legend: plugin_legend,
    SubTitle: plugin_subtitle,
    Title: plugin_title,
    Tooltip: plugin_tooltip
    });

    const addIfString = (labels, raw, index, addedLabels)=>{
        if (typeof raw === 'string') {
            index = labels.push(raw) - 1;
            addedLabels.unshift({
                index,
                label: raw
            });
        } else if (isNaN(raw)) {
            index = null;
        }
        return index;
    };
    function findOrAddLabel(labels, raw, index, addedLabels) {
        const first = labels.indexOf(raw);
        if (first === -1) {
            return addIfString(labels, raw, index, addedLabels);
        }
        const last = labels.lastIndexOf(raw);
        return first !== last ? index : first;
    }
    const validIndex = (index, max)=>index === null ? null : _limitValue(Math.round(index), 0, max);
    function _getLabelForValue(value) {
        const labels = this.getLabels();
        if (value >= 0 && value < labels.length) {
            return labels[value];
        }
        return value;
    }
    class CategoryScale extends Scale {
        static id = 'category';
     static defaults = {
            ticks: {
                callback: _getLabelForValue
            }
        };
        constructor(cfg){
            super(cfg);
             this._startValue = undefined;
            this._valueRange = 0;
            this._addedLabels = [];
        }
        init(scaleOptions) {
            const added = this._addedLabels;
            if (added.length) {
                const labels = this.getLabels();
                for (const { index , label  } of added){
                    if (labels[index] === label) {
                        labels.splice(index, 1);
                    }
                }
                this._addedLabels = [];
            }
            super.init(scaleOptions);
        }
        parse(raw, index) {
            if (isNullOrUndef(raw)) {
                return null;
            }
            const labels = this.getLabels();
            index = isFinite(index) && labels[index] === raw ? index : findOrAddLabel(labels, raw, valueOrDefault(index, raw), this._addedLabels);
            return validIndex(index, labels.length - 1);
        }
        determineDataLimits() {
            const { minDefined , maxDefined  } = this.getUserBounds();
            let { min , max  } = this.getMinMax(true);
            if (this.options.bounds === 'ticks') {
                if (!minDefined) {
                    min = 0;
                }
                if (!maxDefined) {
                    max = this.getLabels().length - 1;
                }
            }
            this.min = min;
            this.max = max;
        }
        buildTicks() {
            const min = this.min;
            const max = this.max;
            const offset = this.options.offset;
            const ticks = [];
            let labels = this.getLabels();
            labels = min === 0 && max === labels.length - 1 ? labels : labels.slice(min, max + 1);
            this._valueRange = Math.max(labels.length - (offset ? 0 : 1), 1);
            this._startValue = this.min - (offset ? 0.5 : 0);
            for(let value = min; value <= max; value++){
                ticks.push({
                    value
                });
            }
            return ticks;
        }
        getLabelForValue(value) {
            return _getLabelForValue.call(this, value);
        }
     configure() {
            super.configure();
            if (!this.isHorizontal()) {
                this._reversePixels = !this._reversePixels;
            }
        }
        getPixelForValue(value) {
            if (typeof value !== 'number') {
                value = this.parse(value);
            }
            return value === null ? NaN : this.getPixelForDecimal((value - this._startValue) / this._valueRange);
        }
        getPixelForTick(index) {
            const ticks = this.ticks;
            if (index < 0 || index > ticks.length - 1) {
                return null;
            }
            return this.getPixelForValue(ticks[index].value);
        }
        getValueForPixel(pixel) {
            return Math.round(this._startValue + this.getDecimalForPixel(pixel) * this._valueRange);
        }
        getBasePixel() {
            return this.bottom;
        }
    }

    function generateTicks$1(generationOptions, dataRange) {
        const ticks = [];
        const MIN_SPACING = 1e-14;
        const { bounds , step , min , max , precision , count , maxTicks , maxDigits , includeBounds  } = generationOptions;
        const unit = step || 1;
        const maxSpaces = maxTicks - 1;
        const { min: rmin , max: rmax  } = dataRange;
        const minDefined = !isNullOrUndef(min);
        const maxDefined = !isNullOrUndef(max);
        const countDefined = !isNullOrUndef(count);
        const minSpacing = (rmax - rmin) / (maxDigits + 1);
        let spacing = niceNum((rmax - rmin) / maxSpaces / unit) * unit;
        let factor, niceMin, niceMax, numSpaces;
        if (spacing < MIN_SPACING && !minDefined && !maxDefined) {
            return [
                {
                    value: rmin
                },
                {
                    value: rmax
                }
            ];
        }
        numSpaces = Math.ceil(rmax / spacing) - Math.floor(rmin / spacing);
        if (numSpaces > maxSpaces) {
            spacing = niceNum(numSpaces * spacing / maxSpaces / unit) * unit;
        }
        if (!isNullOrUndef(precision)) {
            factor = Math.pow(10, precision);
            spacing = Math.ceil(spacing * factor) / factor;
        }
        if (bounds === 'ticks') {
            niceMin = Math.floor(rmin / spacing) * spacing;
            niceMax = Math.ceil(rmax / spacing) * spacing;
        } else {
            niceMin = rmin;
            niceMax = rmax;
        }
        if (minDefined && maxDefined && step && almostWhole((max - min) / step, spacing / 1000)) {
            numSpaces = Math.round(Math.min((max - min) / spacing, maxTicks));
            spacing = (max - min) / numSpaces;
            niceMin = min;
            niceMax = max;
        } else if (countDefined) {
            niceMin = minDefined ? min : niceMin;
            niceMax = maxDefined ? max : niceMax;
            numSpaces = count - 1;
            spacing = (niceMax - niceMin) / numSpaces;
        } else {
            numSpaces = (niceMax - niceMin) / spacing;
            if (almostEquals(numSpaces, Math.round(numSpaces), spacing / 1000)) {
                numSpaces = Math.round(numSpaces);
            } else {
                numSpaces = Math.ceil(numSpaces);
            }
        }
        const decimalPlaces = Math.max(_decimalPlaces(spacing), _decimalPlaces(niceMin));
        factor = Math.pow(10, isNullOrUndef(precision) ? decimalPlaces : precision);
        niceMin = Math.round(niceMin * factor) / factor;
        niceMax = Math.round(niceMax * factor) / factor;
        let j = 0;
        if (minDefined) {
            if (includeBounds && niceMin !== min) {
                ticks.push({
                    value: min
                });
                if (niceMin < min) {
                    j++;
                }
                if (almostEquals(Math.round((niceMin + j * spacing) * factor) / factor, min, relativeLabelSize(min, minSpacing, generationOptions))) {
                    j++;
                }
            } else if (niceMin < min) {
                j++;
            }
        }
        for(; j < numSpaces; ++j){
            const tickValue = Math.round((niceMin + j * spacing) * factor) / factor;
            if (maxDefined && tickValue > max) {
                break;
            }
            ticks.push({
                value: tickValue
            });
        }
        if (maxDefined && includeBounds && niceMax !== max) {
            if (ticks.length && almostEquals(ticks[ticks.length - 1].value, max, relativeLabelSize(max, minSpacing, generationOptions))) {
                ticks[ticks.length - 1].value = max;
            } else {
                ticks.push({
                    value: max
                });
            }
        } else if (!maxDefined || niceMax === max) {
            ticks.push({
                value: niceMax
            });
        }
        return ticks;
    }
    function relativeLabelSize(value, minSpacing, { horizontal , minRotation  }) {
        const rad = toRadians(minRotation);
        const ratio = (horizontal ? Math.sin(rad) : Math.cos(rad)) || 0.001;
        const length = 0.75 * minSpacing * ('' + value).length;
        return Math.min(minSpacing / ratio, length);
    }
    class LinearScaleBase extends Scale {
        constructor(cfg){
            super(cfg);
             this.start = undefined;
             this.end = undefined;
             this._startValue = undefined;
             this._endValue = undefined;
            this._valueRange = 0;
        }
        parse(raw, index) {
            if (isNullOrUndef(raw)) {
                return null;
            }
            if ((typeof raw === 'number' || raw instanceof Number) && !isFinite(+raw)) {
                return null;
            }
            return +raw;
        }
        handleTickRangeOptions() {
            const { beginAtZero  } = this.options;
            const { minDefined , maxDefined  } = this.getUserBounds();
            let { min , max  } = this;
            const setMin = (v)=>min = minDefined ? min : v;
            const setMax = (v)=>max = maxDefined ? max : v;
            if (beginAtZero) {
                const minSign = sign(min);
                const maxSign = sign(max);
                if (minSign < 0 && maxSign < 0) {
                    setMax(0);
                } else if (minSign > 0 && maxSign > 0) {
                    setMin(0);
                }
            }
            if (min === max) {
                let offset = max === 0 ? 1 : Math.abs(max * 0.05);
                setMax(max + offset);
                if (!beginAtZero) {
                    setMin(min - offset);
                }
            }
            this.min = min;
            this.max = max;
        }
        getTickLimit() {
            const tickOpts = this.options.ticks;
            let { maxTicksLimit , stepSize  } = tickOpts;
            let maxTicks;
            if (stepSize) {
                maxTicks = Math.ceil(this.max / stepSize) - Math.floor(this.min / stepSize) + 1;
                if (maxTicks > 1000) {
                    console.warn(`scales.${this.id}.ticks.stepSize: ${stepSize} would result generating up to ${maxTicks} ticks. Limiting to 1000.`);
                    maxTicks = 1000;
                }
            } else {
                maxTicks = this.computeTickLimit();
                maxTicksLimit = maxTicksLimit || 11;
            }
            if (maxTicksLimit) {
                maxTicks = Math.min(maxTicksLimit, maxTicks);
            }
            return maxTicks;
        }
     computeTickLimit() {
            return Number.POSITIVE_INFINITY;
        }
        buildTicks() {
            const opts = this.options;
            const tickOpts = opts.ticks;
            let maxTicks = this.getTickLimit();
            maxTicks = Math.max(2, maxTicks);
            const numericGeneratorOptions = {
                maxTicks,
                bounds: opts.bounds,
                min: opts.min,
                max: opts.max,
                precision: tickOpts.precision,
                step: tickOpts.stepSize,
                count: tickOpts.count,
                maxDigits: this._maxDigits(),
                horizontal: this.isHorizontal(),
                minRotation: tickOpts.minRotation || 0,
                includeBounds: tickOpts.includeBounds !== false
            };
            const dataRange = this._range || this;
            const ticks = generateTicks$1(numericGeneratorOptions, dataRange);
            if (opts.bounds === 'ticks') {
                _setMinAndMaxByKey(ticks, this, 'value');
            }
            if (opts.reverse) {
                ticks.reverse();
                this.start = this.max;
                this.end = this.min;
            } else {
                this.start = this.min;
                this.end = this.max;
            }
            return ticks;
        }
     configure() {
            const ticks = this.ticks;
            let start = this.min;
            let end = this.max;
            super.configure();
            if (this.options.offset && ticks.length) {
                const offset = (end - start) / Math.max(ticks.length - 1, 1) / 2;
                start -= offset;
                end += offset;
            }
            this._startValue = start;
            this._endValue = end;
            this._valueRange = end - start;
        }
        getLabelForValue(value) {
            return formatNumber(value, this.chart.options.locale, this.options.ticks.format);
        }
    }

    class LinearScale extends LinearScaleBase {
        static id = 'linear';
     static defaults = {
            ticks: {
                callback: Ticks.formatters.numeric
            }
        };
        determineDataLimits() {
            const { min , max  } = this.getMinMax(true);
            this.min = isNumberFinite(min) ? min : 0;
            this.max = isNumberFinite(max) ? max : 1;
            this.handleTickRangeOptions();
        }
     computeTickLimit() {
            const horizontal = this.isHorizontal();
            const length = horizontal ? this.width : this.height;
            const minRotation = toRadians(this.options.ticks.minRotation);
            const ratio = (horizontal ? Math.sin(minRotation) : Math.cos(minRotation)) || 0.001;
            const tickFont = this._resolveTickFontOptions(0);
            return Math.ceil(length / Math.min(40, tickFont.lineHeight / ratio));
        }
        getPixelForValue(value) {
            return value === null ? NaN : this.getPixelForDecimal((value - this._startValue) / this._valueRange);
        }
        getValueForPixel(pixel) {
            return this._startValue + this.getDecimalForPixel(pixel) * this._valueRange;
        }
    }

    const log10Floor = (v)=>Math.floor(log10(v));
    const changeExponent = (v, m)=>Math.pow(10, log10Floor(v) + m);
    function isMajor(tickVal) {
        const remain = tickVal / Math.pow(10, log10Floor(tickVal));
        return remain === 1;
    }
    function steps(min, max, rangeExp) {
        const rangeStep = Math.pow(10, rangeExp);
        const start = Math.floor(min / rangeStep);
        const end = Math.ceil(max / rangeStep);
        return end - start;
    }
    function startExp(min, max) {
        const range = max - min;
        let rangeExp = log10Floor(range);
        while(steps(min, max, rangeExp) > 10){
            rangeExp++;
        }
        while(steps(min, max, rangeExp) < 10){
            rangeExp--;
        }
        return Math.min(rangeExp, log10Floor(min));
    }
     function generateTicks(generationOptions, { min , max  }) {
        min = finiteOrDefault(generationOptions.min, min);
        const ticks = [];
        const minExp = log10Floor(min);
        let exp = startExp(min, max);
        let precision = exp < 0 ? Math.pow(10, Math.abs(exp)) : 1;
        const stepSize = Math.pow(10, exp);
        const base = minExp > exp ? Math.pow(10, minExp) : 0;
        const start = Math.round((min - base) * precision) / precision;
        const offset = Math.floor((min - base) / stepSize / 10) * stepSize * 10;
        let significand = Math.floor((start - offset) / Math.pow(10, exp));
        let value = finiteOrDefault(generationOptions.min, Math.round((base + offset + significand * Math.pow(10, exp)) * precision) / precision);
        while(value < max){
            ticks.push({
                value,
                major: isMajor(value),
                significand
            });
            if (significand >= 10) {
                significand = significand < 15 ? 15 : 20;
            } else {
                significand++;
            }
            if (significand >= 20) {
                exp++;
                significand = 2;
                precision = exp >= 0 ? 1 : precision;
            }
            value = Math.round((base + offset + significand * Math.pow(10, exp)) * precision) / precision;
        }
        const lastTick = finiteOrDefault(generationOptions.max, value);
        ticks.push({
            value: lastTick,
            major: isMajor(lastTick),
            significand
        });
        return ticks;
    }
    class LogarithmicScale extends Scale {
        static id = 'logarithmic';
     static defaults = {
            ticks: {
                callback: Ticks.formatters.logarithmic,
                major: {
                    enabled: true
                }
            }
        };
        constructor(cfg){
            super(cfg);
             this.start = undefined;
             this.end = undefined;
             this._startValue = undefined;
            this._valueRange = 0;
        }
        parse(raw, index) {
            const value = LinearScaleBase.prototype.parse.apply(this, [
                raw,
                index
            ]);
            if (value === 0) {
                this._zero = true;
                return undefined;
            }
            return isNumberFinite(value) && value > 0 ? value : null;
        }
        determineDataLimits() {
            const { min , max  } = this.getMinMax(true);
            this.min = isNumberFinite(min) ? Math.max(0, min) : null;
            this.max = isNumberFinite(max) ? Math.max(0, max) : null;
            if (this.options.beginAtZero) {
                this._zero = true;
            }
            if (this._zero && this.min !== this._suggestedMin && !isNumberFinite(this._userMin)) {
                this.min = min === changeExponent(this.min, 0) ? changeExponent(this.min, -1) : changeExponent(this.min, 0);
            }
            this.handleTickRangeOptions();
        }
        handleTickRangeOptions() {
            const { minDefined , maxDefined  } = this.getUserBounds();
            let min = this.min;
            let max = this.max;
            const setMin = (v)=>min = minDefined ? min : v;
            const setMax = (v)=>max = maxDefined ? max : v;
            if (min === max) {
                if (min <= 0) {
                    setMin(1);
                    setMax(10);
                } else {
                    setMin(changeExponent(min, -1));
                    setMax(changeExponent(max, 1));
                }
            }
            if (min <= 0) {
                setMin(changeExponent(max, -1));
            }
            if (max <= 0) {
                setMax(changeExponent(min, 1));
            }
            this.min = min;
            this.max = max;
        }
        buildTicks() {
            const opts = this.options;
            const generationOptions = {
                min: this._userMin,
                max: this._userMax
            };
            const ticks = generateTicks(generationOptions, this);
            if (opts.bounds === 'ticks') {
                _setMinAndMaxByKey(ticks, this, 'value');
            }
            if (opts.reverse) {
                ticks.reverse();
                this.start = this.max;
                this.end = this.min;
            } else {
                this.start = this.min;
                this.end = this.max;
            }
            return ticks;
        }
     getLabelForValue(value) {
            return value === undefined ? '0' : formatNumber(value, this.chart.options.locale, this.options.ticks.format);
        }
     configure() {
            const start = this.min;
            super.configure();
            this._startValue = log10(start);
            this._valueRange = log10(this.max) - log10(start);
        }
        getPixelForValue(value) {
            if (value === undefined || value === 0) {
                value = this.min;
            }
            if (value === null || isNaN(value)) {
                return NaN;
            }
            return this.getPixelForDecimal(value === this.min ? 0 : (log10(value) - this._startValue) / this._valueRange);
        }
        getValueForPixel(pixel) {
            const decimal = this.getDecimalForPixel(pixel);
            return Math.pow(10, this._startValue + decimal * this._valueRange);
        }
    }

    function getTickBackdropHeight(opts) {
        const tickOpts = opts.ticks;
        if (tickOpts.display && opts.display) {
            const padding = toPadding(tickOpts.backdropPadding);
            return valueOrDefault(tickOpts.font && tickOpts.font.size, defaults.font.size) + padding.height;
        }
        return 0;
    }
    function measureLabelSize(ctx, font, label) {
        label = isArray(label) ? label : [
            label
        ];
        return {
            w: _longestText(ctx, font.string, label),
            h: label.length * font.lineHeight
        };
    }
    function determineLimits(angle, pos, size, min, max) {
        if (angle === min || angle === max) {
            return {
                start: pos - size / 2,
                end: pos + size / 2
            };
        } else if (angle < min || angle > max) {
            return {
                start: pos - size,
                end: pos
            };
        }
        return {
            start: pos,
            end: pos + size
        };
    }
     function fitWithPointLabels(scale) {
        const orig = {
            l: scale.left + scale._padding.left,
            r: scale.right - scale._padding.right,
            t: scale.top + scale._padding.top,
            b: scale.bottom - scale._padding.bottom
        };
        const limits = Object.assign({}, orig);
        const labelSizes = [];
        const padding = [];
        const valueCount = scale._pointLabels.length;
        const pointLabelOpts = scale.options.pointLabels;
        const additionalAngle = pointLabelOpts.centerPointLabels ? PI / valueCount : 0;
        for(let i = 0; i < valueCount; i++){
            const opts = pointLabelOpts.setContext(scale.getPointLabelContext(i));
            padding[i] = opts.padding;
            const pointPosition = scale.getPointPosition(i, scale.drawingArea + padding[i], additionalAngle);
            const plFont = toFont(opts.font);
            const textSize = measureLabelSize(scale.ctx, plFont, scale._pointLabels[i]);
            labelSizes[i] = textSize;
            const angleRadians = _normalizeAngle(scale.getIndexAngle(i) + additionalAngle);
            const angle = Math.round(toDegrees(angleRadians));
            const hLimits = determineLimits(angle, pointPosition.x, textSize.w, 0, 180);
            const vLimits = determineLimits(angle, pointPosition.y, textSize.h, 90, 270);
            updateLimits(limits, orig, angleRadians, hLimits, vLimits);
        }
        scale.setCenterPoint(orig.l - limits.l, limits.r - orig.r, orig.t - limits.t, limits.b - orig.b);
        scale._pointLabelItems = buildPointLabelItems(scale, labelSizes, padding);
    }
    function updateLimits(limits, orig, angle, hLimits, vLimits) {
        const sin = Math.abs(Math.sin(angle));
        const cos = Math.abs(Math.cos(angle));
        let x = 0;
        let y = 0;
        if (hLimits.start < orig.l) {
            x = (orig.l - hLimits.start) / sin;
            limits.l = Math.min(limits.l, orig.l - x);
        } else if (hLimits.end > orig.r) {
            x = (hLimits.end - orig.r) / sin;
            limits.r = Math.max(limits.r, orig.r + x);
        }
        if (vLimits.start < orig.t) {
            y = (orig.t - vLimits.start) / cos;
            limits.t = Math.min(limits.t, orig.t - y);
        } else if (vLimits.end > orig.b) {
            y = (vLimits.end - orig.b) / cos;
            limits.b = Math.max(limits.b, orig.b + y);
        }
    }
    function createPointLabelItem(scale, index, itemOpts) {
        const outerDistance = scale.drawingArea;
        const { extra , additionalAngle , padding , size  } = itemOpts;
        const pointLabelPosition = scale.getPointPosition(index, outerDistance + extra + padding, additionalAngle);
        const angle = Math.round(toDegrees(_normalizeAngle(pointLabelPosition.angle + HALF_PI)));
        const y = yForAngle(pointLabelPosition.y, size.h, angle);
        const textAlign = getTextAlignForAngle(angle);
        const left = leftForTextAlign(pointLabelPosition.x, size.w, textAlign);
        return {
            visible: true,
            x: pointLabelPosition.x,
            y,
            textAlign,
            left,
            top: y,
            right: left + size.w,
            bottom: y + size.h
        };
    }
    function isNotOverlapped(item, area) {
        if (!area) {
            return true;
        }
        const { left , top , right , bottom  } = item;
        const apexesInArea = _isPointInArea({
            x: left,
            y: top
        }, area) || _isPointInArea({
            x: left,
            y: bottom
        }, area) || _isPointInArea({
            x: right,
            y: top
        }, area) || _isPointInArea({
            x: right,
            y: bottom
        }, area);
        return !apexesInArea;
    }
    function buildPointLabelItems(scale, labelSizes, padding) {
        const items = [];
        const valueCount = scale._pointLabels.length;
        const opts = scale.options;
        const { centerPointLabels , display  } = opts.pointLabels;
        const itemOpts = {
            extra: getTickBackdropHeight(opts) / 2,
            additionalAngle: centerPointLabels ? PI / valueCount : 0
        };
        let area;
        for(let i = 0; i < valueCount; i++){
            itemOpts.padding = padding[i];
            itemOpts.size = labelSizes[i];
            const item = createPointLabelItem(scale, i, itemOpts);
            items.push(item);
            if (display === 'auto') {
                item.visible = isNotOverlapped(item, area);
                if (item.visible) {
                    area = item;
                }
            }
        }
        return items;
    }
    function getTextAlignForAngle(angle) {
        if (angle === 0 || angle === 180) {
            return 'center';
        } else if (angle < 180) {
            return 'left';
        }
        return 'right';
    }
    function leftForTextAlign(x, w, align) {
        if (align === 'right') {
            x -= w;
        } else if (align === 'center') {
            x -= w / 2;
        }
        return x;
    }
    function yForAngle(y, h, angle) {
        if (angle === 90 || angle === 270) {
            y -= h / 2;
        } else if (angle > 270 || angle < 90) {
            y -= h;
        }
        return y;
    }
    function drawPointLabelBox(ctx, opts, item) {
        const { left , top , right , bottom  } = item;
        const { backdropColor  } = opts;
        if (!isNullOrUndef(backdropColor)) {
            const borderRadius = toTRBLCorners(opts.borderRadius);
            const padding = toPadding(opts.backdropPadding);
            ctx.fillStyle = backdropColor;
            const backdropLeft = left - padding.left;
            const backdropTop = top - padding.top;
            const backdropWidth = right - left + padding.width;
            const backdropHeight = bottom - top + padding.height;
            if (Object.values(borderRadius).some((v)=>v !== 0)) {
                ctx.beginPath();
                addRoundedRectPath(ctx, {
                    x: backdropLeft,
                    y: backdropTop,
                    w: backdropWidth,
                    h: backdropHeight,
                    radius: borderRadius
                });
                ctx.fill();
            } else {
                ctx.fillRect(backdropLeft, backdropTop, backdropWidth, backdropHeight);
            }
        }
    }
    function drawPointLabels(scale, labelCount) {
        const { ctx , options: { pointLabels  }  } = scale;
        for(let i = labelCount - 1; i >= 0; i--){
            const item = scale._pointLabelItems[i];
            if (!item.visible) {
                continue;
            }
            const optsAtIndex = pointLabels.setContext(scale.getPointLabelContext(i));
            drawPointLabelBox(ctx, optsAtIndex, item);
            const plFont = toFont(optsAtIndex.font);
            const { x , y , textAlign  } = item;
            renderText(ctx, scale._pointLabels[i], x, y + plFont.lineHeight / 2, plFont, {
                color: optsAtIndex.color,
                textAlign: textAlign,
                textBaseline: 'middle'
            });
        }
    }
    function pathRadiusLine(scale, radius, circular, labelCount) {
        const { ctx  } = scale;
        if (circular) {
            ctx.arc(scale.xCenter, scale.yCenter, radius, 0, TAU);
        } else {
            let pointPosition = scale.getPointPosition(0, radius);
            ctx.moveTo(pointPosition.x, pointPosition.y);
            for(let i = 1; i < labelCount; i++){
                pointPosition = scale.getPointPosition(i, radius);
                ctx.lineTo(pointPosition.x, pointPosition.y);
            }
        }
    }
    function drawRadiusLine(scale, gridLineOpts, radius, labelCount, borderOpts) {
        const ctx = scale.ctx;
        const circular = gridLineOpts.circular;
        const { color , lineWidth  } = gridLineOpts;
        if (!circular && !labelCount || !color || !lineWidth || radius < 0) {
            return;
        }
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(borderOpts.dash || []);
        ctx.lineDashOffset = borderOpts.dashOffset;
        ctx.beginPath();
        pathRadiusLine(scale, radius, circular, labelCount);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }
    function createPointLabelContext(parent, index, label) {
        return createContext(parent, {
            label,
            index,
            type: 'pointLabel'
        });
    }
    class RadialLinearScale extends LinearScaleBase {
        static id = 'radialLinear';
     static defaults = {
            display: true,
            animate: true,
            position: 'chartArea',
            angleLines: {
                display: true,
                lineWidth: 1,
                borderDash: [],
                borderDashOffset: 0.0
            },
            grid: {
                circular: false
            },
            startAngle: 0,
            ticks: {
                showLabelBackdrop: true,
                callback: Ticks.formatters.numeric
            },
            pointLabels: {
                backdropColor: undefined,
                backdropPadding: 2,
                display: true,
                font: {
                    size: 10
                },
                callback (label) {
                    return label;
                },
                padding: 5,
                centerPointLabels: false
            }
        };
        static defaultRoutes = {
            'angleLines.color': 'borderColor',
            'pointLabels.color': 'color',
            'ticks.color': 'color'
        };
        static descriptors = {
            angleLines: {
                _fallback: 'grid'
            }
        };
        constructor(cfg){
            super(cfg);
             this.xCenter = undefined;
             this.yCenter = undefined;
             this.drawingArea = undefined;
             this._pointLabels = [];
            this._pointLabelItems = [];
        }
        setDimensions() {
            const padding = this._padding = toPadding(getTickBackdropHeight(this.options) / 2);
            const w = this.width = this.maxWidth - padding.width;
            const h = this.height = this.maxHeight - padding.height;
            this.xCenter = Math.floor(this.left + w / 2 + padding.left);
            this.yCenter = Math.floor(this.top + h / 2 + padding.top);
            this.drawingArea = Math.floor(Math.min(w, h) / 2);
        }
        determineDataLimits() {
            const { min , max  } = this.getMinMax(false);
            this.min = isNumberFinite(min) && !isNaN(min) ? min : 0;
            this.max = isNumberFinite(max) && !isNaN(max) ? max : 0;
            this.handleTickRangeOptions();
        }
     computeTickLimit() {
            return Math.ceil(this.drawingArea / getTickBackdropHeight(this.options));
        }
        generateTickLabels(ticks) {
            LinearScaleBase.prototype.generateTickLabels.call(this, ticks);
            this._pointLabels = this.getLabels().map((value, index)=>{
                const label = callback(this.options.pointLabels.callback, [
                    value,
                    index
                ], this);
                return label || label === 0 ? label : '';
            }).filter((v, i)=>this.chart.getDataVisibility(i));
        }
        fit() {
            const opts = this.options;
            if (opts.display && opts.pointLabels.display) {
                fitWithPointLabels(this);
            } else {
                this.setCenterPoint(0, 0, 0, 0);
            }
        }
        setCenterPoint(leftMovement, rightMovement, topMovement, bottomMovement) {
            this.xCenter += Math.floor((leftMovement - rightMovement) / 2);
            this.yCenter += Math.floor((topMovement - bottomMovement) / 2);
            this.drawingArea -= Math.min(this.drawingArea / 2, Math.max(leftMovement, rightMovement, topMovement, bottomMovement));
        }
        getIndexAngle(index) {
            const angleMultiplier = TAU / (this._pointLabels.length || 1);
            const startAngle = this.options.startAngle || 0;
            return _normalizeAngle(index * angleMultiplier + toRadians(startAngle));
        }
        getDistanceFromCenterForValue(value) {
            if (isNullOrUndef(value)) {
                return NaN;
            }
            const scalingFactor = this.drawingArea / (this.max - this.min);
            if (this.options.reverse) {
                return (this.max - value) * scalingFactor;
            }
            return (value - this.min) * scalingFactor;
        }
        getValueForDistanceFromCenter(distance) {
            if (isNullOrUndef(distance)) {
                return NaN;
            }
            const scaledDistance = distance / (this.drawingArea / (this.max - this.min));
            return this.options.reverse ? this.max - scaledDistance : this.min + scaledDistance;
        }
        getPointLabelContext(index) {
            const pointLabels = this._pointLabels || [];
            if (index >= 0 && index < pointLabels.length) {
                const pointLabel = pointLabels[index];
                return createPointLabelContext(this.getContext(), index, pointLabel);
            }
        }
        getPointPosition(index, distanceFromCenter, additionalAngle = 0) {
            const angle = this.getIndexAngle(index) - HALF_PI + additionalAngle;
            return {
                x: Math.cos(angle) * distanceFromCenter + this.xCenter,
                y: Math.sin(angle) * distanceFromCenter + this.yCenter,
                angle
            };
        }
        getPointPositionForValue(index, value) {
            return this.getPointPosition(index, this.getDistanceFromCenterForValue(value));
        }
        getBasePosition(index) {
            return this.getPointPositionForValue(index || 0, this.getBaseValue());
        }
        getPointLabelPosition(index) {
            const { left , top , right , bottom  } = this._pointLabelItems[index];
            return {
                left,
                top,
                right,
                bottom
            };
        }
     drawBackground() {
            const { backgroundColor , grid: { circular  }  } = this.options;
            if (backgroundColor) {
                const ctx = this.ctx;
                ctx.save();
                ctx.beginPath();
                pathRadiusLine(this, this.getDistanceFromCenterForValue(this._endValue), circular, this._pointLabels.length);
                ctx.closePath();
                ctx.fillStyle = backgroundColor;
                ctx.fill();
                ctx.restore();
            }
        }
     drawGrid() {
            const ctx = this.ctx;
            const opts = this.options;
            const { angleLines , grid , border  } = opts;
            const labelCount = this._pointLabels.length;
            let i, offset, position;
            if (opts.pointLabels.display) {
                drawPointLabels(this, labelCount);
            }
            if (grid.display) {
                this.ticks.forEach((tick, index)=>{
                    if (index !== 0 || index === 0 && this.min < 0) {
                        offset = this.getDistanceFromCenterForValue(tick.value);
                        const context = this.getContext(index);
                        const optsAtIndex = grid.setContext(context);
                        const optsAtIndexBorder = border.setContext(context);
                        drawRadiusLine(this, optsAtIndex, offset, labelCount, optsAtIndexBorder);
                    }
                });
            }
            if (angleLines.display) {
                ctx.save();
                for(i = labelCount - 1; i >= 0; i--){
                    const optsAtIndex = angleLines.setContext(this.getPointLabelContext(i));
                    const { color , lineWidth  } = optsAtIndex;
                    if (!lineWidth || !color) {
                        continue;
                    }
                    ctx.lineWidth = lineWidth;
                    ctx.strokeStyle = color;
                    ctx.setLineDash(optsAtIndex.borderDash);
                    ctx.lineDashOffset = optsAtIndex.borderDashOffset;
                    offset = this.getDistanceFromCenterForValue(opts.reverse ? this.min : this.max);
                    position = this.getPointPosition(i, offset);
                    ctx.beginPath();
                    ctx.moveTo(this.xCenter, this.yCenter);
                    ctx.lineTo(position.x, position.y);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }
     drawBorder() {}
     drawLabels() {
            const ctx = this.ctx;
            const opts = this.options;
            const tickOpts = opts.ticks;
            if (!tickOpts.display) {
                return;
            }
            const startAngle = this.getIndexAngle(0);
            let offset, width;
            ctx.save();
            ctx.translate(this.xCenter, this.yCenter);
            ctx.rotate(startAngle);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            this.ticks.forEach((tick, index)=>{
                if (index === 0 && this.min >= 0 && !opts.reverse) {
                    return;
                }
                const optsAtIndex = tickOpts.setContext(this.getContext(index));
                const tickFont = toFont(optsAtIndex.font);
                offset = this.getDistanceFromCenterForValue(this.ticks[index].value);
                if (optsAtIndex.showLabelBackdrop) {
                    ctx.font = tickFont.string;
                    width = ctx.measureText(tick.label).width;
                    ctx.fillStyle = optsAtIndex.backdropColor;
                    const padding = toPadding(optsAtIndex.backdropPadding);
                    ctx.fillRect(-width / 2 - padding.left, -offset - tickFont.size / 2 - padding.top, width + padding.width, tickFont.size + padding.height);
                }
                renderText(ctx, tick.label, 0, -offset, tickFont, {
                    color: optsAtIndex.color,
                    strokeColor: optsAtIndex.textStrokeColor,
                    strokeWidth: optsAtIndex.textStrokeWidth
                });
            });
            ctx.restore();
        }
     drawTitle() {}
    }

    const INTERVALS = {
        millisecond: {
            common: true,
            size: 1,
            steps: 1000
        },
        second: {
            common: true,
            size: 1000,
            steps: 60
        },
        minute: {
            common: true,
            size: 60000,
            steps: 60
        },
        hour: {
            common: true,
            size: 3600000,
            steps: 24
        },
        day: {
            common: true,
            size: 86400000,
            steps: 30
        },
        week: {
            common: false,
            size: 604800000,
            steps: 4
        },
        month: {
            common: true,
            size: 2.628e9,
            steps: 12
        },
        quarter: {
            common: false,
            size: 7.884e9,
            steps: 4
        },
        year: {
            common: true,
            size: 3.154e10
        }
    };
     const UNITS =  /* #__PURE__ */ Object.keys(INTERVALS);
     function sorter(a, b) {
        return a - b;
    }
     function parse(scale, input) {
        if (isNullOrUndef(input)) {
            return null;
        }
        const adapter = scale._adapter;
        const { parser , round , isoWeekday  } = scale._parseOpts;
        let value = input;
        if (typeof parser === 'function') {
            value = parser(value);
        }
        if (!isNumberFinite(value)) {
            value = typeof parser === 'string' ? adapter.parse(value, parser) : adapter.parse(value);
        }
        if (value === null) {
            return null;
        }
        if (round) {
            value = round === 'week' && (isNumber(isoWeekday) || isoWeekday === true) ? adapter.startOf(value, 'isoWeek', isoWeekday) : adapter.startOf(value, round);
        }
        return +value;
    }
     function determineUnitForAutoTicks(minUnit, min, max, capacity) {
        const ilen = UNITS.length;
        for(let i = UNITS.indexOf(minUnit); i < ilen - 1; ++i){
            const interval = INTERVALS[UNITS[i]];
            const factor = interval.steps ? interval.steps : Number.MAX_SAFE_INTEGER;
            if (interval.common && Math.ceil((max - min) / (factor * interval.size)) <= capacity) {
                return UNITS[i];
            }
        }
        return UNITS[ilen - 1];
    }
     function determineUnitForFormatting(scale, numTicks, minUnit, min, max) {
        for(let i = UNITS.length - 1; i >= UNITS.indexOf(minUnit); i--){
            const unit = UNITS[i];
            if (INTERVALS[unit].common && scale._adapter.diff(max, min, unit) >= numTicks - 1) {
                return unit;
            }
        }
        return UNITS[minUnit ? UNITS.indexOf(minUnit) : 0];
    }
     function determineMajorUnit(unit) {
        for(let i = UNITS.indexOf(unit) + 1, ilen = UNITS.length; i < ilen; ++i){
            if (INTERVALS[UNITS[i]].common) {
                return UNITS[i];
            }
        }
    }
     function addTick(ticks, time, timestamps) {
        if (!timestamps) {
            ticks[time] = true;
        } else if (timestamps.length) {
            const { lo , hi  } = _lookup(timestamps, time);
            const timestamp = timestamps[lo] >= time ? timestamps[lo] : timestamps[hi];
            ticks[timestamp] = true;
        }
    }
     function setMajorTicks(scale, ticks, map, majorUnit) {
        const adapter = scale._adapter;
        const first = +adapter.startOf(ticks[0].value, majorUnit);
        const last = ticks[ticks.length - 1].value;
        let major, index;
        for(major = first; major <= last; major = +adapter.add(major, 1, majorUnit)){
            index = map[major];
            if (index >= 0) {
                ticks[index].major = true;
            }
        }
        return ticks;
    }
     function ticksFromTimestamps(scale, values, majorUnit) {
        const ticks = [];
         const map = {};
        const ilen = values.length;
        let i, value;
        for(i = 0; i < ilen; ++i){
            value = values[i];
            map[value] = i;
            ticks.push({
                value,
                major: false
            });
        }
        return ilen === 0 || !majorUnit ? ticks : setMajorTicks(scale, ticks, map, majorUnit);
    }
    class TimeScale extends Scale {
        static id = 'time';
     static defaults = {
     bounds: 'data',
            adapters: {},
            time: {
                parser: false,
                unit: false,
                round: false,
                isoWeekday: false,
                minUnit: 'millisecond',
                displayFormats: {}
            },
            ticks: {
     source: 'auto',
                callback: false,
                major: {
                    enabled: false
                }
            }
        };
     constructor(props){
            super(props);
             this._cache = {
                data: [],
                labels: [],
                all: []
            };
             this._unit = 'day';
             this._majorUnit = undefined;
            this._offsets = {};
            this._normalized = false;
            this._parseOpts = undefined;
        }
        init(scaleOpts, opts = {}) {
            const time = scaleOpts.time || (scaleOpts.time = {});
             const adapter = this._adapter = new adapters._date(scaleOpts.adapters.date);
            adapter.init(opts);
            mergeIf(time.displayFormats, adapter.formats());
            this._parseOpts = {
                parser: time.parser,
                round: time.round,
                isoWeekday: time.isoWeekday
            };
            super.init(scaleOpts);
            this._normalized = opts.normalized;
        }
     parse(raw, index) {
            if (raw === undefined) {
                return null;
            }
            return parse(this, raw);
        }
        beforeLayout() {
            super.beforeLayout();
            this._cache = {
                data: [],
                labels: [],
                all: []
            };
        }
        determineDataLimits() {
            const options = this.options;
            const adapter = this._adapter;
            const unit = options.time.unit || 'day';
            let { min , max , minDefined , maxDefined  } = this.getUserBounds();
     function _applyBounds(bounds) {
                if (!minDefined && !isNaN(bounds.min)) {
                    min = Math.min(min, bounds.min);
                }
                if (!maxDefined && !isNaN(bounds.max)) {
                    max = Math.max(max, bounds.max);
                }
            }
            if (!minDefined || !maxDefined) {
                _applyBounds(this._getLabelBounds());
                if (options.bounds !== 'ticks' || options.ticks.source !== 'labels') {
                    _applyBounds(this.getMinMax(false));
                }
            }
            min = isNumberFinite(min) && !isNaN(min) ? min : +adapter.startOf(Date.now(), unit);
            max = isNumberFinite(max) && !isNaN(max) ? max : +adapter.endOf(Date.now(), unit) + 1;
            this.min = Math.min(min, max - 1);
            this.max = Math.max(min + 1, max);
        }
     _getLabelBounds() {
            const arr = this.getLabelTimestamps();
            let min = Number.POSITIVE_INFINITY;
            let max = Number.NEGATIVE_INFINITY;
            if (arr.length) {
                min = arr[0];
                max = arr[arr.length - 1];
            }
            return {
                min,
                max
            };
        }
     buildTicks() {
            const options = this.options;
            const timeOpts = options.time;
            const tickOpts = options.ticks;
            const timestamps = tickOpts.source === 'labels' ? this.getLabelTimestamps() : this._generate();
            if (options.bounds === 'ticks' && timestamps.length) {
                this.min = this._userMin || timestamps[0];
                this.max = this._userMax || timestamps[timestamps.length - 1];
            }
            const min = this.min;
            const max = this.max;
            const ticks = _filterBetween(timestamps, min, max);
            this._unit = timeOpts.unit || (tickOpts.autoSkip ? determineUnitForAutoTicks(timeOpts.minUnit, this.min, this.max, this._getLabelCapacity(min)) : determineUnitForFormatting(this, ticks.length, timeOpts.minUnit, this.min, this.max));
            this._majorUnit = !tickOpts.major.enabled || this._unit === 'year' ? undefined : determineMajorUnit(this._unit);
            this.initOffsets(timestamps);
            if (options.reverse) {
                ticks.reverse();
            }
            return ticksFromTimestamps(this, ticks, this._majorUnit);
        }
        afterAutoSkip() {
            if (this.options.offsetAfterAutoskip) {
                this.initOffsets(this.ticks.map((tick)=>+tick.value));
            }
        }
     initOffsets(timestamps = []) {
            let start = 0;
            let end = 0;
            let first, last;
            if (this.options.offset && timestamps.length) {
                first = this.getDecimalForValue(timestamps[0]);
                if (timestamps.length === 1) {
                    start = 1 - first;
                } else {
                    start = (this.getDecimalForValue(timestamps[1]) - first) / 2;
                }
                last = this.getDecimalForValue(timestamps[timestamps.length - 1]);
                if (timestamps.length === 1) {
                    end = last;
                } else {
                    end = (last - this.getDecimalForValue(timestamps[timestamps.length - 2])) / 2;
                }
            }
            const limit = timestamps.length < 3 ? 0.5 : 0.25;
            start = _limitValue(start, 0, limit);
            end = _limitValue(end, 0, limit);
            this._offsets = {
                start,
                end,
                factor: 1 / (start + 1 + end)
            };
        }
     _generate() {
            const adapter = this._adapter;
            const min = this.min;
            const max = this.max;
            const options = this.options;
            const timeOpts = options.time;
            const minor = timeOpts.unit || determineUnitForAutoTicks(timeOpts.minUnit, min, max, this._getLabelCapacity(min));
            const stepSize = valueOrDefault(options.ticks.stepSize, 1);
            const weekday = minor === 'week' ? timeOpts.isoWeekday : false;
            const hasWeekday = isNumber(weekday) || weekday === true;
            const ticks = {};
            let first = min;
            let time, count;
            if (hasWeekday) {
                first = +adapter.startOf(first, 'isoWeek', weekday);
            }
            first = +adapter.startOf(first, hasWeekday ? 'day' : minor);
            if (adapter.diff(max, min, minor) > 100000 * stepSize) {
                throw new Error(min + ' and ' + max + ' are too far apart with stepSize of ' + stepSize + ' ' + minor);
            }
            const timestamps = options.ticks.source === 'data' && this.getDataTimestamps();
            for(time = first, count = 0; time < max; time = +adapter.add(time, stepSize, minor), count++){
                addTick(ticks, time, timestamps);
            }
            if (time === max || options.bounds === 'ticks' || count === 1) {
                addTick(ticks, time, timestamps);
            }
            return Object.keys(ticks).sort(sorter).map((x)=>+x);
        }
     getLabelForValue(value) {
            const adapter = this._adapter;
            const timeOpts = this.options.time;
            if (timeOpts.tooltipFormat) {
                return adapter.format(value, timeOpts.tooltipFormat);
            }
            return adapter.format(value, timeOpts.displayFormats.datetime);
        }
     format(value, format) {
            const options = this.options;
            const formats = options.time.displayFormats;
            const unit = this._unit;
            const fmt = format || formats[unit];
            return this._adapter.format(value, fmt);
        }
     _tickFormatFunction(time, index, ticks, format) {
            const options = this.options;
            const formatter = options.ticks.callback;
            if (formatter) {
                return callback(formatter, [
                    time,
                    index,
                    ticks
                ], this);
            }
            const formats = options.time.displayFormats;
            const unit = this._unit;
            const majorUnit = this._majorUnit;
            const minorFormat = unit && formats[unit];
            const majorFormat = majorUnit && formats[majorUnit];
            const tick = ticks[index];
            const major = majorUnit && majorFormat && tick && tick.major;
            return this._adapter.format(time, format || (major ? majorFormat : minorFormat));
        }
     generateTickLabels(ticks) {
            let i, ilen, tick;
            for(i = 0, ilen = ticks.length; i < ilen; ++i){
                tick = ticks[i];
                tick.label = this._tickFormatFunction(tick.value, i, ticks);
            }
        }
     getDecimalForValue(value) {
            return value === null ? NaN : (value - this.min) / (this.max - this.min);
        }
     getPixelForValue(value) {
            const offsets = this._offsets;
            const pos = this.getDecimalForValue(value);
            return this.getPixelForDecimal((offsets.start + pos) * offsets.factor);
        }
     getValueForPixel(pixel) {
            const offsets = this._offsets;
            const pos = this.getDecimalForPixel(pixel) / offsets.factor - offsets.end;
            return this.min + pos * (this.max - this.min);
        }
     _getLabelSize(label) {
            const ticksOpts = this.options.ticks;
            const tickLabelWidth = this.ctx.measureText(label).width;
            const angle = toRadians(this.isHorizontal() ? ticksOpts.maxRotation : ticksOpts.minRotation);
            const cosRotation = Math.cos(angle);
            const sinRotation = Math.sin(angle);
            const tickFontSize = this._resolveTickFontOptions(0).size;
            return {
                w: tickLabelWidth * cosRotation + tickFontSize * sinRotation,
                h: tickLabelWidth * sinRotation + tickFontSize * cosRotation
            };
        }
     _getLabelCapacity(exampleTime) {
            const timeOpts = this.options.time;
            const displayFormats = timeOpts.displayFormats;
            const format = displayFormats[timeOpts.unit] || displayFormats.millisecond;
            const exampleLabel = this._tickFormatFunction(exampleTime, 0, ticksFromTimestamps(this, [
                exampleTime
            ], this._majorUnit), format);
            const size = this._getLabelSize(exampleLabel);
            const capacity = Math.floor(this.isHorizontal() ? this.width / size.w : this.height / size.h) - 1;
            return capacity > 0 ? capacity : 1;
        }
     getDataTimestamps() {
            let timestamps = this._cache.data || [];
            let i, ilen;
            if (timestamps.length) {
                return timestamps;
            }
            const metas = this.getMatchingVisibleMetas();
            if (this._normalized && metas.length) {
                return this._cache.data = metas[0].controller.getAllParsedValues(this);
            }
            for(i = 0, ilen = metas.length; i < ilen; ++i){
                timestamps = timestamps.concat(metas[i].controller.getAllParsedValues(this));
            }
            return this._cache.data = this.normalize(timestamps);
        }
     getLabelTimestamps() {
            const timestamps = this._cache.labels || [];
            let i, ilen;
            if (timestamps.length) {
                return timestamps;
            }
            const labels = this.getLabels();
            for(i = 0, ilen = labels.length; i < ilen; ++i){
                timestamps.push(parse(this, labels[i]));
            }
            return this._cache.labels = this._normalized ? timestamps : this.normalize(timestamps);
        }
     normalize(values) {
            return _arrayUnique(values.sort(sorter));
        }
    }

    function interpolate(table, val, reverse) {
        let lo = 0;
        let hi = table.length - 1;
        let prevSource, nextSource, prevTarget, nextTarget;
        if (reverse) {
            if (val >= table[lo].pos && val <= table[hi].pos) {
                ({ lo , hi  } = _lookupByKey(table, 'pos', val));
            }
            ({ pos: prevSource , time: prevTarget  } = table[lo]);
            ({ pos: nextSource , time: nextTarget  } = table[hi]);
        } else {
            if (val >= table[lo].time && val <= table[hi].time) {
                ({ lo , hi  } = _lookupByKey(table, 'time', val));
            }
            ({ time: prevSource , pos: prevTarget  } = table[lo]);
            ({ time: nextSource , pos: nextTarget  } = table[hi]);
        }
        const span = nextSource - prevSource;
        return span ? prevTarget + (nextTarget - prevTarget) * (val - prevSource) / span : prevTarget;
    }
    class TimeSeriesScale extends TimeScale {
        static id = 'timeseries';
     static defaults = TimeScale.defaults;
     constructor(props){
            super(props);
             this._table = [];
             this._minPos = undefined;
             this._tableRange = undefined;
        }
     initOffsets() {
            const timestamps = this._getTimestampsForTable();
            const table = this._table = this.buildLookupTable(timestamps);
            this._minPos = interpolate(table, this.min);
            this._tableRange = interpolate(table, this.max) - this._minPos;
            super.initOffsets(timestamps);
        }
     buildLookupTable(timestamps) {
            const { min , max  } = this;
            const items = [];
            const table = [];
            let i, ilen, prev, curr, next;
            for(i = 0, ilen = timestamps.length; i < ilen; ++i){
                curr = timestamps[i];
                if (curr >= min && curr <= max) {
                    items.push(curr);
                }
            }
            if (items.length < 2) {
                return [
                    {
                        time: min,
                        pos: 0
                    },
                    {
                        time: max,
                        pos: 1
                    }
                ];
            }
            for(i = 0, ilen = items.length; i < ilen; ++i){
                next = items[i + 1];
                prev = items[i - 1];
                curr = items[i];
                if (Math.round((next + prev) / 2) !== curr) {
                    table.push({
                        time: curr,
                        pos: i / (ilen - 1)
                    });
                }
            }
            return table;
        }
     _generate() {
            const min = this.min;
            const max = this.max;
            let timestamps = super.getDataTimestamps();
            if (!timestamps.includes(min) || !timestamps.length) {
                timestamps.splice(0, 0, min);
            }
            if (!timestamps.includes(max) || timestamps.length === 1) {
                timestamps.push(max);
            }
            return timestamps.sort((a, b)=>a - b);
        }
     _getTimestampsForTable() {
            let timestamps = this._cache.all || [];
            if (timestamps.length) {
                return timestamps;
            }
            const data = this.getDataTimestamps();
            const label = this.getLabelTimestamps();
            if (data.length && label.length) {
                timestamps = this.normalize(data.concat(label));
            } else {
                timestamps = data.length ? data : label;
            }
            timestamps = this._cache.all = timestamps;
            return timestamps;
        }
     getDecimalForValue(value) {
            return (interpolate(this._table, value) - this._minPos) / this._tableRange;
        }
     getValueForPixel(pixel) {
            const offsets = this._offsets;
            const decimal = this.getDecimalForPixel(pixel) / offsets.factor - offsets.end;
            return interpolate(this._table, decimal * this._tableRange + this._minPos, true);
        }
    }

    var scales = /*#__PURE__*/Object.freeze({
    __proto__: null,
    CategoryScale: CategoryScale,
    LinearScale: LinearScale,
    LogarithmicScale: LogarithmicScale,
    RadialLinearScale: RadialLinearScale,
    TimeScale: TimeScale,
    TimeSeriesScale: TimeSeriesScale
    });

    const registerables = [
        controllers,
        elements,
        plugins,
        scales
    ];

    // Benchmark Visualization - Charts and Tables
    // Register Chart.js components
    Chart.register(...registerables);
    function renderBenchmarkTable(results, winners) {
        const tableContainer = document.getElementById('benchmark-table');
        if (!tableContainer)
            return;
        const html = `
    <table class="benchmark-table">
      <thead>
        <tr>
          <th>Framework</th>
          <th>Decorator-Free</th>
          <th>Singleton (ms) ↓</th>
          <th>Transient (ms) ↓</th>
          <th>Build Time (ms) ↓</th>
          <th>Complex Graph (ms) ↓</th>
          <th>Bundle Size (KB) ↓</th>
        </tr>
      </thead>
      <tbody>
        ${results.map(r => {
        // Extract winner framework names from combined resolution string
        const singletonWinner = winners.resolutionSpeed.includes('(singleton)')
            ? winners.resolutionSpeed.split('(singleton)')[0].trim()
            : '';
        const transientWinner = winners.resolutionSpeed.includes('(transient)')
            ? winners.resolutionSpeed.split(',')[1]?.split('(transient)')[0]?.trim() || ''
            : '';
        return `
          <tr class="${r.framework === winners.overall ? 'overall-winner' : ''}">
            <td class="framework-name">
              <strong>${r.framework}</strong>
              ${r.framework === winners.overall ? ' 🏆' : ''}
            </td>
            <td class="decorator-status">
              ${r.decoratorFree ? '✅ Yes' : '❌ No'}
            </td>
            <td class="${r.framework === singletonWinner ? 'winner' : ''}">
              ${r.resolutionSingleton.toFixed(2)}
              ${r.framework === singletonWinner ? ' 🥇' : ''}
            </td>
            <td class="${r.framework === transientWinner ? 'winner' : ''}">
              ${r.resolutionTransient.toFixed(2)}
              ${r.framework === transientWinner ? ' 🥇' : ''}
            </td>
            <td class="${r.framework === winners.buildTime ? 'winner' : ''}">
              ${r.buildTime.toFixed(2)}
              ${r.framework === winners.buildTime ? ' 🥇' : ''}
            </td>
            <td class="${r.framework === winners.complexGraph ? 'winner' : ''}">
              ${r.complexGraph.toFixed(2)}
              ${r.framework === winners.complexGraph ? ' 🥇' : ''}
            </td>
            <td class="${r.framework === winners.bundleSize ? 'winner' : ''}">
              ${r.bundleSize.toFixed(1)}
              ${r.framework === winners.bundleSize ? ' 🥇' : ''}
            </td>
          </tr>
        `;
    }).join('')}
      </tbody>
    </table>

    <div class="winner-summary">
      <h4>🏆 Overall Winner: ${winners.overall}</h4>
      <p class="summary-text">
        ${winners.overall} achieved the best combined performance across all benchmarks.
      </p>
      <p class="summary-text" style="margin-top: 8px; font-size: 0.9em; color: #78909c;">
        <strong>Calculation:</strong> Each framework is ranked (1st, 2nd, 3rd...) in each of the 5 metrics
        (Singleton, Transient, Build Time, Complex Graph, Bundle Size). The ranks are summed, and the
        framework with the <strong>lowest total score wins</strong> (lower is better).
      </p>
    </div>
  `;
        tableContainer.innerHTML = html;
    }
    function renderBubbleChart(runData) {
        const canvas = document.getElementById('bubble-chart');
        if (!canvas)
            return;
        // Destroy existing chart if any
        const existingChart = Chart.getChart(canvas);
        if (existingChart) {
            existingChart.destroy();
        }
        const colors = [
            'rgba(33, 150, 243, 0.6)', // NovaDI (blue)
            'rgba(156, 39, 176, 0.6)', // Brandi (purple)
            'rgba(255, 152, 0, 0.6)', // InversifyJS (orange)
            'rgba(233, 30, 99, 0.6)', // TSyringe (pink)
            'rgba(76, 175, 80, 0.6)' // TypeDI (green)
        ];
        const borderColors = [
            '#2196F3', // NovaDI (blue)
            '#9C27B0', // Brandi (purple)
            '#FF9800', // InversifyJS (orange)
            '#E91E63', // TSyringe (pink)
            '#4CAF50' // TypeDI (green)
        ];
        // First pass: collect all ranges to find min/max for scaling
        const allRanges = [];
        runData.forEach(data => {
            const metrics = [
                data.resolutionSingletonRuns,
                data.resolutionTransientRuns,
                data.buildTimeRuns,
                data.complexGraphRuns
            ];
            metrics.forEach(runs => {
                const min = Math.min(...runs);
                const max = Math.max(...runs);
                allRanges.push(max - min);
            });
        });
        const minRange = Math.min(...allRanges);
        const maxRange = Math.max(...allRanges);
        const rangeSpread = maxRange - minRange;
        // Create bubble data for each framework
        const datasets = runData.map((data, index) => {
            // Calculate stats for each metric (excluding Build Time)
            const metrics = [
                { name: 'Singleton', runs: data.resolutionSingletonRuns, x: 0 },
                { name: 'Transient', runs: data.resolutionTransientRuns, x: 1 },
                { name: 'Complex', runs: data.complexGraphRuns, x: 2 }
            ];
            const bubbles = metrics.map(metric => {
                // No filtering - show all data
                const avg = metric.runs.reduce((a, b) => a + b, 0) / metric.runs.length;
                const min = Math.min(...metric.runs);
                const max = Math.max(...metric.runs);
                const range = max - min;
                // Use square root scaling for better visual differentiation
                const normalizedRange = rangeSpread > 0 ? (range - minRange) / rangeSpread : 0;
                const scaledRange = Math.sqrt(normalizedRange);
                const radius = 5 + (scaledRange * 30);
                return {
                    x: avg,
                    y: metric.x,
                    r: radius,
                    metric: metric.name,
                    min,
                    max,
                    range
                };
            });
            return {
                label: data.framework,
                data: bubbles,
                backgroundColor: colors[index],
                borderColor: borderColors[index],
                borderWidth: 2
            };
        });
        new Chart(canvas, {
            type: 'bubble',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Performance Variance Analysis (Bubble Size = Min-Max Range)',
                        font: { size: 18, weight: 'bold' }
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const point = context.raw;
                                return [
                                    `${context.dataset.label} - ${point.metric}`,
                                    `Average: ${point.x.toFixed(2)}ms`,
                                    `Min: ${point.min.toFixed(2)}ms`,
                                    `Max: ${point.max.toFixed(2)}ms`,
                                    `Range: ${point.range.toFixed(2)}ms`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'logarithmic',
                        min: 0.01,
                        title: {
                            display: true,
                            text: 'Average Time (ms) - Lower is Better (Log Scale)'
                        },
                        ticks: {
                            callback: function (value) {
                                if (typeof value === 'number') {
                                    return value.toFixed(2);
                                }
                                return String(value);
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        min: -0.5,
                        max: 2.5,
                        title: {
                            display: true,
                            text: 'Metric Type'
                        },
                        ticks: {
                            callback: function (value) {
                                const metrics = ['Singleton', 'Transient', 'Complex'];
                                const index = Math.round(Number(value));
                                return metrics[index] || '';
                            },
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }
    function renderBenchmarkCharts(results) {
        const frameworks = results.map(r => r.framework);
        const colors = [
            '#2196F3', // NovaDI (blue)
            '#9C27B0', // Brandi (purple)
            '#FF9800', // InversifyJS (orange)
            '#E91E63', // TSyringe (pink)
            '#4CAF50', // TypeDI (green)
            '#00BCD4' // Awilix (cyan)
        ];
        // Singleton Resolution Chart
        renderChart('resolution-chart', {
            labels: frameworks,
            title: 'Singleton Resolution Speed (1000 resolutions)',
            yAxisLabel: 'Time (ms) - Lower is Better',
            data: results.map(r => r.resolutionSingleton),
            colors
        });
        // Transient Resolution Chart
        renderChart('transient-chart', {
            labels: frameworks,
            title: 'Transient Resolution Speed (1000 resolutions)',
            yAxisLabel: 'Time (ms) - Lower is Better',
            data: results.map(r => r.resolutionTransient),
            colors
        });
        // Build Time Chart
        renderChart('buildtime-chart', {
            labels: frameworks,
            title: 'Build Time (100 registrations)',
            yAxisLabel: 'Time (ms) - Lower is Better',
            data: results.map(r => r.buildTime),
            colors
        });
        // Complex Graph Chart
        renderChart('complexgraph-chart', {
            labels: frameworks,
            title: 'Complex Dependency Graph',
            yAxisLabel: 'Time (ms) - Lower is Better',
            data: results.map(r => r.complexGraph),
            colors
        });
        // Bundle Size Chart
        renderChart('bundlesize-chart', {
            labels: frameworks,
            title: 'Bundle Size (minified + gzipped)',
            yAxisLabel: 'Size (KB) - Lower is Better',
            data: results.map(r => r.bundleSize),
            colors
        });
        // NovaDI Comparison Chart (AutoWire vs No AutoWire)
        const novadiResult = results.find(r => r.framework === 'NovaDI');
        if (novadiResult && novadiResult.complexGraphNoAutoWire) {
            renderNovadiComparisonChart(novadiResult);
        }
    }
    function renderNovadiComparisonChart(novadiResult) {
        const canvas = document.getElementById('novadi-comparison-chart');
        if (!canvas)
            return;
        // Destroy existing chart if any
        const existingChart = Chart.getChart(canvas);
        if (existingChart) {
            existingChart.destroy();
        }
        const withAutoWire = novadiResult.complexGraph;
        const withoutAutoWire = novadiResult.complexGraphNoAutoWire;
        const improvement = ((withAutoWire - withoutAutoWire) / withAutoWire * 100).toFixed(1);
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: ['With AutoWire', 'Without AutoWire'],
                datasets: [{
                        label: 'NovaDI Complex Graph Performance',
                        data: [withAutoWire, withoutAutoWire],
                        backgroundColor: ['#2196F3', '#00BCD4'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    title: {
                        display: true,
                        text: `NovaDI: AutoWire Impact (${improvement}% faster without)`,
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y;
                                if (typeof value === 'number') {
                                    return `${value.toFixed(2)} ms`;
                                }
                                return String(value);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Time (ms) - Lower is Better'
                        },
                        ticks: {
                            callback: function (value) {
                                if (typeof value === 'number') {
                                    return value.toFixed(1);
                                }
                                return String(value);
                            }
                        }
                    },
                    x: {
                        ticks: {
                            font: { weight: 'bold' }
                        }
                    }
                }
            }
        });
    }
    function renderChart(canvasId, config) {
        const canvas = document.getElementById(canvasId);
        if (!canvas)
            return;
        // Destroy existing chart if any
        const existingChart = Chart.getChart(canvas);
        if (existingChart) {
            existingChart.destroy();
        }
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: config.labels,
                datasets: [{
                        label: config.title,
                        data: config.data,
                        backgroundColor: config.colors.slice(0, config.labels.length),
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    title: {
                        display: true,
                        text: config.title,
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y;
                                if (typeof value === 'number') {
                                    return `${value.toFixed(2)} ${config.yAxisLabel.includes('KB') ? 'KB' : 'ms'}`;
                                }
                                return String(value);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: config.yAxisLabel
                        },
                        ticks: {
                            callback: function (value) {
                                if (typeof value === 'number') {
                                    return value.toFixed(1);
                                }
                                return String(value);
                            }
                        }
                    },
                    x: {
                        ticks: {
                            font: { weight: 'bold' }
                        }
                    }
                }
            }
        });
    }

    // NovaDI Smart Home Demo
    // Demonstrates all major DI features in a real-world scenario
    // Import NovaDI
    // ============================================================================
    // DEMO: NovaDI Features in a Smart Home System
    // ============================================================================
    class SmartHomeDemo {
        async run() {
            console.clear();
            console.log('%c🏠 NovaDI Smart Home Demo', 'font-size: 24px; font-weight: bold; color: #2196F3');
            console.log('%cDemonstrating Dependency Injection patterns in a real-world scenario', 'font-style: italic; color: #666');
            console.log('');
            await this.demo6_PerformanceBenchmarks();
            await this.demo7_NovadiNoAutowire();
            await this.demo0_SimplestCase();
            await this.demo1_BasicDI();
            await this.demo2_MultipleImplementations();
            await this.demo3_AutowiredDependencies();
            await this.demo4_ScopedContainers();
            await this.demo5_AutomationSystem();
            console.log('');
            console.log('%c✅ All demos completed successfully!', 'font-size: 16px; font-weight: bold; color: #4CAF50');
            console.log('%cCheck the UI for visual representation', 'color: #666');
        }
        // DEMO 0: Simplest Case - Just Registration and Resolution
        async demo0_SimplestCase() {
            console.group('%c🌟 DEMO 0: Simplest Case', 'font-weight: bold; color: #9C27B0');
            console.log('Features: Basic .asInterface<T>() and .resolveInterface<T>() - no autowiring!');
            // Create container
            this.container = new Container$2();
            const builder = this.container.builder();
            // Register services without any dependencies
            builder.registerType(ConsoleLogger).asInterface("ILogger").singleInstance();
            builder.registerType(EventBus).asInterface("IEventBus").singleInstance().autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            });
            const app = builder.build();
            // Display registry
            const code0 = `const builder = container.builder()

builder.registerType(ConsoleLogger).asInterface<ILogger>().singleInstance()
builder.registerType(EventBus).asInterface<IEventBus>().singleInstance()

const app = builder.build()

const logger = app.resolveInterface<ILogger>()
const eventBus = app.resolveInterface<IEventBus>()`;
            displayRegistry('demo0', app, 'Simple Registration', code0);
            // Resolve services
            const logger = app.resolveInterface("ILogger");
            const eventBus = app.resolveInterface("IEventBus");
            console.log('✅ Logger resolved:', logger.constructor.name);
            console.log('✅ EventBus resolved:', eventBus.constructor.name);
            console.log('✅ No Token<T>() needed - transformer does it all!');
            // Test the services
            logger.info('Simple registration works!', 'Demo0');
            eventBus.publish('demo:started', { demo: 0 });
            this.updateUI('demo0', 'completed');
            console.groupEnd();
            await this.delay(1000);
        }
        // DEMO 1: Basic DI - Interface Registration and Resolution
        async demo1_BasicDI() {
            console.group('%c📦 DEMO 1: Basic Dependency Injection', 'font-weight: bold; color: #FF9800');
            console.log('Features: Interface registration, Container binding, resolveInterface<T>()');
            // Create container and register dependencies
            this.container = new Container$2();
            const builder = this.container.builder();
            builder.registerType(ConsoleLogger).asInterface("ILogger").singleInstance();
            builder
                .registerType(EventBus)
                .asInterface("IEventBus").autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    logger: (c) => c.resolveInterface("ILogger")
                }
            })
                .singleInstance();
            const app = builder.build();
            // Display registry
            const code1 = `const builder = container.builder()

builder.registerType(ConsoleLogger).asInterface<ILogger>().singleInstance()
builder
  .registerType(EventBus)
  .asInterface<IEventBus>()
  .autoWire({ map: { logger: (c) => c.resolveInterface<ILogger>() } })
  .singleInstance()

const app = builder.build()`;
            displayRegistry('demo1', app, 'Container Registry', code1);
            // Resolve dependencies
            const logger = app.resolveInterface("ILogger");
            const eventBus = app.resolveInterface("IEventBus");
            console.log('✅ Logger resolved:', logger.constructor.name);
            console.log('✅ EventBus resolved:', eventBus.constructor.name);
            console.log('✅ EventBus has logger dependency injected');
            // Test the resolved services
            logger.info('Smart Home system initialized', 'Demo1');
            eventBus.publish('system:ready', { timestamp: Date.now() });
            this.updateUI('demo1', 'completed');
            console.groupEnd();
            await this.delay(1000);
        }
        // DEMO 2: Multiple Implementations - Keyed Services
        async demo2_MultipleImplementations() {
            console.group('%c🔀 DEMO 2: Multiple Implementations', 'font-weight: bold; color: #9C27B0');
            console.log('Features: Keyed services, resolveInterfaceKeyed<T>(), resolveInterfaceAll<T>()');
            const builder = new Container$2().builder();
            // Register multiple logger implementations
            builder.registerType(ConsoleLogger).asInterface("ILogger"); // Default
            builder.registerType(FileLogger).asInterface("ILogger").keyed('file');
            const app = builder.build();
            // Display registry
            const code2 = `const builder = new Container().builder()

// Register multiple logger implementations
builder.registerType(ConsoleLogger).asInterface<ILogger>() // Default
builder.registerType(FileLogger).asInterface<ILogger>().keyed('file')

const app = builder.build()`;
            displayRegistry('demo2', app, 'Multiple Logger Implementations', code2);
            // Resolve default and keyed loggers
            const defaultLogger = app.resolveInterface("ILogger");
            const fileLogger = app.resolveInterfaceKeyed('file');
            const allLoggers = app.resolveInterfaceAll("ILogger");
            console.log('✅ Default logger:', defaultLogger.constructor.name);
            console.log('✅ File logger (keyed):', fileLogger.constructor.name);
            console.log('✅ All loggers:', allLoggers.map(l => l.constructor.name).join(', '));
            console.log(`✅ Total registered loggers: ${allLoggers.length}`);
            defaultLogger.log('Logging to console', 'Demo2');
            fileLogger.log('Logging to file', 'Demo2');
            this.updateUI('demo2', 'completed');
            console.groupEnd();
            await this.delay(1000);
        }
        // DEMO 3: Autowired Dependencies
        async demo3_AutowiredDependencies() {
            console.group('%c🔧 DEMO 3: Autowired Dependencies', 'font-weight: bold; color: #00BCD4');
            console.log('Features: autoWire(), constructor injection, dependency graphs');
            const builder = new Container$2().builder();
            // Register with dependencies
            builder.registerType(ConsoleLogger).asInterface("ILogger").singleInstance();
            builder
                .registerInstance(new TemperatureSensor('temp-1', 'Bedroom Temp', 'bedroom', 21))
                .asInterface("ISensor");
            builder
                .registerType(SmartLight)
                .asInterface("IDevice").autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    id: () => 'light-1',
                    name: () => 'Bedroom Light',
                    roomId: () => 'bedroom',
                    logger: (c) => c.resolveInterface("ILogger")
                }
            });
            const app = builder.build();
            // Display registry
            const code3 = `const builder = new Container().builder()

// Register with dependencies
builder.registerType(ConsoleLogger).asInterface<ILogger>().singleInstance()

builder
  .registerInstance(new TemperatureSensor('temp-1', 'Bedroom Temp', 'bedroom', 21))
  .asInterface<ISensor>()

builder
  .registerType(SmartLight)
  .asInterface<IDevice>()
  .autoWire({
    map: {
      id: () => 'light-1',
      name: () => 'Bedroom Light',
      roomId: () => 'bedroom',
      logger: (c) => c.resolveInterface<ILogger>()
    }
  })

const app = builder.build()`;
            displayRegistry('demo3', app, 'Autowired Dependencies', code3);
            const sensor = app.resolveInterface("ISensor");
            const light = app.resolveInterface("IDevice");
            console.log('✅ Temperature sensor resolved:', sensor.name);
            console.log('✅ Smart light resolved with logger injected:', light.name);
            console.log(`✅ Current temperature: ${sensor.getValue()}${sensor.getUnit()}`);
            light.turnOn();
            const lightStatus = light.getStatus();
            console.log(`✅ Light status: ${lightStatus}`);
            this.updateUI('demo3', 'completed');
            console.groupEnd();
            await this.delay(1000);
        }
        // DEMO 4: Scoped Containers - Per-Room Isolation
        async demo4_ScopedContainers() {
            console.group('%c🏠 DEMO 4: Scoped Containers (Per-Room)', 'font-weight: bold; color: #4CAF50');
            console.log('Features: Child containers, scope isolation, shared singletons');
            // Create parent container with shared services
            const parentBuilder = new Container$2().builder();
            parentBuilder.registerType(ConsoleLogger).asInterface("ILogger").singleInstance();
            const parentContainer = parentBuilder.build();
            // Create room-specific child containers
            console.log('\n📍 Creating Living Room scope:');
            const livingRoomBuilder = parentContainer.createChild().builder();
            livingRoomBuilder.registerInstance(new TemperatureSensor('lr-temp', 'Living Room Temp', 'living-room', 23)).asInterface("ISensor");
            const livingRoomContainer = livingRoomBuilder.build();
            console.log('📍 Creating Bedroom scope:');
            const bedroomBuilder = parentContainer.createChild().builder();
            bedroomBuilder.registerInstance(new TemperatureSensor('br-temp', 'Bedroom Temp', 'bedroom', 19)).asInterface("ISensor");
            const bedroomContainer = bedroomBuilder.build();
            // Resolve from each scope
            const lrSensor = livingRoomContainer.resolveInterface("ISensor");
            const brSensor = bedroomContainer.resolveInterface("ISensor");
            const lrLogger = livingRoomContainer.resolveInterface("ILogger");
            const brLogger = bedroomContainer.resolveInterface("ILogger");
            console.log(`✅ Living Room temp: ${lrSensor.getValue()}°C (${lrSensor.name})`);
            console.log(`✅ Bedroom temp: ${brSensor.getValue()}°C (${brSensor.name})`);
            console.log('✅ Each room has isolated sensor instance');
            console.log('✅ Both rooms share the same logger singleton:', lrLogger === brLogger);
            // Display registries
            const code4 = `// Create parent container with shared services
const parentBuilder = new Container().builder()
parentBuilder.registerType(ConsoleLogger).asInterface<ILogger>().singleInstance()
const parentContainer = parentBuilder.build()

// Create room-specific child containers
const livingRoomBuilder = parentContainer.createChild().builder()
livingRoomBuilder.registerInstance(
  new TemperatureSensor('lr-temp', 'Living Room Temp', 'living-room', 23)
).asInterface<ISensor>()
const livingRoomContainer = livingRoomBuilder.build()

const bedroomBuilder = parentContainer.createChild().builder()
bedroomBuilder.registerInstance(
  new TemperatureSensor('br-temp', 'Bedroom Temp', 'bedroom', 19)
).asInterface<ISensor>()
const bedroomContainer = bedroomBuilder.build()`;
            displayRegistry('demo4', parentContainer, 'Parent Container (Shared Services)', code4);
            this.updateUI('demo4', 'completed');
            console.groupEnd();
            await this.delay(1000);
        }
        // DEMO 5: Complete Automation System
        async demo5_AutomationSystem() {
            console.group('%c🤖 DEMO 5: Complete Automation System', 'font-weight: bold; color: #F44336');
            console.log('Features: Complex dependency graphs, real-world application');
            const builder = new Container$2().builder();
            // Core services
            builder.registerType(ConsoleLogger).asInterface("ILogger").singleInstance();
            builder
                .registerType(EventBus)
                .asInterface("IEventBus").autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({ map: { logger: (c) => c.resolveInterface("ILogger") } })
                .singleInstance();
            builder
                .registerType(AutomationService)
                .asInterface("AutomationService").autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger"),
                    eventBus: c => c.resolveInterface("IEventBus")
                }
            }).autoWire({
                map: {
                    logger: (c) => c.resolveInterface("ILogger"),
                    eventBus: (c) => c.resolveInterface("IEventBus")
                }
            })
                .singleInstance();
            // Sensors (using keyed registration for multiple sensors of same interface)
            builder
                .registerInstance(new TemperatureSensor('auto-temp', 'Auto Temp', 'office', 22))
                .asInterface("ISensor")
                .keyed('TempSensor');
            builder
                .registerInstance(new MotionSensor('auto-motion', 'Auto Motion', 'office'))
                .asInterface("ISensor")
                .keyed('MotionSensor');
            // Devices (using keyed registration for multiple devices)
            builder
                .registerType(SmartThermostat)
                .asInterface("IDevice")
                .keyed('Thermostat').autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    id: () => 'auto-thermo',
                    name: () => 'Auto Thermostat',
                    roomId: () => 'office',
                    logger: (c) => c.resolveInterface("ILogger")
                }
            });
            builder
                .registerType(SmartLight)
                .asInterface("IDevice")
                .keyed('Light').autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    logger: c => c.resolveInterface("ILogger")
                }
            }).autoWire({
                map: {
                    id: () => 'auto-light',
                    name: () => 'Auto Light',
                    roomId: () => 'office',
                    logger: (c) => c.resolveInterface("ILogger")
                }
            });
            const app = builder.build();
            // Display registry
            const code5 = `// Core services
builder.registerType(ConsoleLogger).asInterface<ILogger>().singleInstance()
builder
  .registerType(EventBus)
  .asInterface<IEventBus>()
  .autoWire({ map: { logger: (c) => c.resolveInterface<ILogger>() } })
  .singleInstance()

builder
  .registerType(AutomationService)
  .asInterface<AutomationService>()
  .autoWire({
    map: {
      logger: (c) => c.resolveInterface<ILogger>(),
      eventBus: (c) => c.resolveInterface<IEventBus>()
    }
  })
  .singleInstance()

// Sensors (using keyed registration for multiple sensors)
builder
  .registerInstance(new TemperatureSensor('auto-temp', 'Auto Temp', 'office', 22))
  .asInterface<ISensor>()
  .keyed('TempSensor')

builder
  .registerInstance(new MotionSensor('auto-motion', 'Auto Motion', 'office'))
  .asInterface<ISensor>()
  .keyed('MotionSensor')

// Devices (using keyed registration for multiple devices)
builder
  .registerType(SmartThermostat)
  .asInterface<IDevice>()
  .keyed('Thermostat')
  .autoWire({
    map: {
      id: () => 'auto-thermo',
      name: () => 'Auto Thermostat',
      roomId: () => 'office',
      logger: (c) => c.resolveInterface<ILogger>()
    }
  })

builder
  .registerType(SmartLight)
  .asInterface<IDevice>()
  .keyed('Light')
  .autoWire({
    map: {
      id: () => 'auto-light',
      name: () => 'Auto Light',
      roomId: () => 'office',
      logger: (c) => c.resolveInterface<ILogger>()
    }
  })`;
            displayRegistry('demo5', app, 'Complete Automation System Registry', code5);
            // Resolve all components
            const logger = app.resolveInterface("ILogger");
            const eventBus = app.resolveInterface("IEventBus");
            const automationService = app.resolveInterface("AutomationService");
            const tempSensor = app.resolveInterfaceKeyed('TempSensor');
            const motionSensor = app.resolveInterfaceKeyed('MotionSensor');
            const thermostat = app.resolveInterfaceKeyed('Thermostat');
            const light = app.resolveInterfaceKeyed('Light');
            console.log('✅ All services resolved successfully');
            console.log('✅ Dependency graph:');
            console.log('   AutomationService → Logger + EventBus');
            console.log('   Devices (Thermostat, Light) → Logger');
            console.log('');
            // Create automation rules
            const tempRule = new TemperatureAutomationRule('temp-rule-1', 'Temperature Control', tempSensor, thermostat, 24, logger, eventBus);
            const motionRule = new MotionLightAutomationRule('motion-rule-1', 'Motion Light Control', motionSensor, light, logger, eventBus);
            automationService.addRule(tempRule);
            automationService.addRule(motionRule);
            console.log('✅ Automation rules registered');
            console.log('🚀 Starting automation service...');
            automationService.start();
            console.log('⏱️ Automation running for 5 seconds...');
            this.updateUI('demo5', 'running');
            await this.delay(5000);
            automationService.stop();
            console.log('🛑 Automation service stopped');
            this.updateUI('demo5', 'completed');
            console.groupEnd();
        }
        // DEMO 6: Performance Benchmarks
        async demo6_PerformanceBenchmarks() {
            console.group('%c⚡ Performance Benchmarks', 'font-weight: bold; color: #E91E63');
            console.log('Features: Head-to-head performance comparison with other DI frameworks');
            console.log('');
            this.updateUI('demo6', 'running');
            // Run benchmarks
            const runner = new BenchmarkRunner();
            const results = await runner.runAll();
            const winners = runner.getWinners();
            console.log('');
            console.log('%c🏆 Winners Summary:', 'font-weight: bold; font-size: 14px');
            console.log(`  Resolution Speed: ${winners.resolutionSpeed}`);
            console.log(`  Build Time: ${winners.buildTime}`);
            console.log(`  Complex Graph: ${winners.complexGraph}`);
            console.log(`  Bundle Size: ${winners.bundleSize}`);
            console.log(`  🥇 Overall Winner: ${winners.overall}`);
            // Render visualizations
            renderBenchmarkTable(results, winners);
            renderBubbleChart(runner.getRunData());
            renderBenchmarkCharts(results);
            // Show benchmark results and expand registry
            const benchmarkResults = document.getElementById('benchmark-results');
            const registryEl = document.getElementById('demo6-registry');
            const expandIcon = document.getElementById('demo6-expand');
            if (benchmarkResults) {
                benchmarkResults.style.display = 'block';
            }
            if (registryEl && expandIcon) {
                registryEl.classList.add('expanded');
                expandIcon.classList.add('expanded');
            }
            this.updateUI('demo6', 'completed');
            console.groupEnd();
            await this.delay(1000);
        }
        // NovaDI Complex Graph without AutoWire
        async demo7_NovadiNoAutowire() {
            console.group('%c🔬 NovaDI Complex Graph (No AutoWire)', 'font-weight: bold; color: #8B4513');
            console.log('Features: Direct factory registration without autowire overhead');
            console.log('');
            this.updateUI('demo7', 'running');
            // Run the specific benchmark
            const runner = new BenchmarkRunner();
            const result = await runner.runNovadiNoAutowire();
            console.log('');
            console.log('%c📊 NovaDI No AutoWire Results:', 'font-weight: bold; font-size: 14px');
            console.log(`  Complex Graph (No AutoWire): ${result.toFixed(2)}ms`);
            console.log(`  Compared to with AutoWire: Much faster!`);
            // Display results in the registry
            const registryEl = document.getElementById('demo7-registry');
            if (registryEl) {
                registryEl.innerHTML = `
        <div class="registry-section">
          <h4>🚀 Performance Results</h4>
          <table class="registry-table">
            <thead>
              <tr>
                <th>Test Type</th>
                <th>Time (ms)</th>
                <th>Operations</th>
                <th>Ops/ms</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span class="type-badge">Complex Graph (No AutoWire)</span></td>
                <td><strong>${result.toFixed(2)}ms</strong></td>
                <td>1000 resolutions</td>
                <td>${(1000 / result).toFixed(0)}</td>
              </tr>
            </tbody>
          </table>
          <div style="margin-top: 10px; font-size: 0.85rem; color: #78909c;">
            Direct factory registration eliminates autowire map function overhead
          </div>
        </div>
      `;
            }
            this.updateUI('demo7', 'completed');
            console.groupEnd();
            await this.delay(1000);
        }
        delay(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }
        updateUI(demo, status) {
            const element = document.getElementById(`${demo}-status`);
            if (element) {
                element.textContent = status;
                element.className = `status status-${status}`;
            }
        }
    }
    function getRegistryInfo(container) {
        // Use the new public API method
        return container.getRegistry();
    }
    function displayRegistry(demo, container, title, code) {
        const registryEl = document.getElementById(`${demo}-registry`);
        if (!registryEl)
            return;
        const entries = getRegistryInfo(container);
        if (entries.length === 0) {
            registryEl.innerHTML = '<div class="empty-registry">No registrations in this container</div>';
            return;
        }
        let html = '';
        // Add code section if provided
        if (code) {
            html += `
      <div class="code-section">
        <h4>💻 Registration Code</h4>
        <pre class="line-numbers"><code class="language-typescript">${escapeHtml(code)}</code></pre>
      </div>
    `;
        }
        html += `
    <div class="registry-section">
      <h4>📋 ${title}</h4>
      <table class="registry-table">
        <thead>
          <tr>
            <th style="width: 30%;">Service Token</th>
            <th style="width: 15%;">Type</th>
            <th style="width: 20%;">Lifetime</th>
            <th style="width: 35%;">Dependencies</th>
          </tr>
        </thead>
        <tbody>
  `;
        entries.forEach(entry => {
            const lifetimeClass = entry.lifetime === 'singleton' ? 'lifetime-singleton'
                : entry.lifetime === 'per-request' ? 'lifetime-per-request'
                    : 'lifetime-transient';
            const depsDisplay = entry.dependencies && entry.dependencies.length > 0
                ? `<small>${entry.dependencies.join(', ')}</small>`
                : '<span style="color: #78909c;">none</span>';
            html += `
      <tr>
        <td><span class="type-badge">${entry.token}</span></td>
        <td>${entry.type}</td>
        <td><span class="lifetime-badge ${lifetimeClass}">${entry.lifetime}</span></td>
        <td>${depsDisplay}</td>
      </tr>
    `;
        });
        html += `
        </tbody>
      </table>
      <div style="margin-top: 10px; font-size: 0.85rem; color: #78909c;">
        Total registrations: ${entries.length}
      </div>
    </div>
  `;
        registryEl.innerHTML = html;
        // Trigger Prism highlighting
        if (typeof Prism !== 'undefined') {
            Prism.highlightAllUnder(registryEl);
        }
    }
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    window.toggleRegistry = (demo) => {
        const registryEl = document.getElementById(`${demo}-registry`);
        const expandIcon = document.getElementById(`${demo}-expand`);
        if (registryEl && expandIcon) {
            registryEl.classList.toggle('expanded');
            expandIcon.classList.toggle('expanded');
        }
    };
    window.toggleTechDocs = () => {
        const contentEl = document.getElementById('tech-docs-content');
        const expandIcon = document.getElementById('tech-docs-expand');
        if (contentEl && expandIcon) {
            contentEl.classList.toggle('expanded');
            expandIcon.classList.toggle('expanded');
        }
    };
    // Run the demo when page loads
    document.addEventListener('DOMContentLoaded', () => {
        const demo = new SmartHomeDemo();
        const startButton = document.getElementById('start-demo');
        if (startButton) {
            startButton.addEventListener('click', () => {
                startButton.setAttribute('disabled', 'true');
                demo.run().then(() => {
                    startButton.removeAttribute('disabled');
                });
            });
        }
    });

})();
//# sourceMappingURL=main.js.map
