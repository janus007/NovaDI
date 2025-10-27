/**
 * AutoWire - Automatic dependency injection for NovaDI
 * Supports three strategies: paramName, map, and class
 */

import type { Container } from './container.js'
import type { Token } from './token.js'
import type { AutoWireOptions } from './builder.js'

/**
 * Performance: Cache extracted parameter names to avoid repeated regex parsing
 * WeakMap allows garbage collection when constructor is no longer referenced
 */
const paramNameCache = new WeakMap<Function, string[]>()

/**
 * Extract parameter names from a constructor function
 * Uses regex to parse the toString() representation
 * Performance optimized: Results are cached per constructor
 */
export function extractParameterNames(constructor: new (...args: any[]) => any): string[] {
  // Check cache first - avoids expensive regex parsing
  const cached = paramNameCache.get(constructor)
  if (cached) {
    return cached
  }

  // Extract parameter names (expensive operation)
  const fnStr = constructor.toString()

  // Match constructor(...args) or class { constructor(...args) }
  const match = fnStr.match(/constructor\s*\(([^)]*)\)/) || fnStr.match(/^[^(]*\(([^)]*)\)/)

  if (!match || !match[1]) {
    return []
  }

  const params = match[1]
    .split(',')
    .map(param => param.trim())
    .filter(param => param.length > 0)
    .map(param => {
      // Remove default values, type annotations, and extract just the name
      let name = param.split(/[:=]/)[0].trim()

      // Remove TypeScript modifiers (public, private, protected, readonly)
      // Can appear multiple times, e.g., "public readonly service"
      name = name.replace(/^((public|private|protected|readonly)\s+)+/, '')

      // Handle destructuring - skip for now
      if (name.includes('{') || name.includes('[')) {
        return null
      }
      return name
    })
    .filter((name): name is string => name !== null)

  // Cache result for future calls
  paramNameCache.set(constructor, params)
  return params
}

/**
 * Resolve dependencies using paramName strategy
 * Matches parameter names to interface registry tokens
 */
export function resolveByParamName(
  constructor: new (...args: any[]) => any,
  container: Container,
  options: AutoWireOptions
): any[] {
  const paramNames = extractParameterNames(constructor)
  const resolvedDeps: any[] = []

  for (const paramName of paramNames) {
    let resolved: any = undefined
    let foundMatch = false

    // Try multiple naming conventions to match TypeScript interfaces
    const namesToTry = [
      paramName,                           // Direct: "logger"
      capitalize(paramName),               // Capitalized: "Logger"
      'I' + capitalize(paramName)          // Interface convention: "ILogger"
    ]

    for (const name of namesToTry) {
      try {
        resolved = container.resolveInterface(name)
        foundMatch = true
        break
      } catch {
        // Try next naming convention
      }
    }

    if (foundMatch) {
      resolvedDeps.push(resolved)
    } else if (options.strict) {
      throw new Error(
        `Cannot resolve parameter "${paramName}" on ${constructor.name}. ` +
        `No interface registration found. Tried: ${namesToTry.join(', ')}. ` +
        `Suggestions:\n` +
        `  - Use .autoWire({ map: { ${paramName}: (c) => c.resolveInterface<I${capitalize(paramName)}>() } })\n` +
        `  - Register the interface with .asInterface<I${capitalize(paramName)}>()\n` +
        `  - Mark a default implementation with .asDefaultInterface<I${capitalize(paramName)}>()`
      )
    } else {
      // Non-strict mode: silently push undefined for unresolvable parameters
      // This is expected behavior: parameters that can't be resolved are typically
      // primitive types (string, number, etc.) that should use .withParameters()
      // instead of dependency injection
      resolvedDeps.push(undefined)
    }
  }

  return resolvedDeps
}

/**
 * Resolve dependencies using map strategy
 * Uses explicit mapping from parameter names to resolvers
 */
export function resolveByMap(
  constructor: new (...args: any[]) => any,
  container: Container,
  options: AutoWireOptions
): any[] {
  if (!options.map) {
    throw new Error('AutoWire map strategy requires options.map to be defined')
  }

  const paramNames = extractParameterNames(constructor)
  const resolvedDeps: any[] = []

  for (const paramName of paramNames) {
    const resolver = options.map[paramName]

    if (resolver === undefined) {
      if (options.strict) {
        throw new Error(
          `Cannot resolve parameter "${paramName}" on ${constructor.name}. ` +
          `Not found in autowire map. ` +
          `Add it to the map: .autoWire({ map: { ${paramName}: ... } })`
        )
      } else {
        // Silently push undefined for missing parameters
        // This is expected: transformer filters out primitive types at compile-time,
        // so missing params are typically primitives that don't need DI resolution
        resolvedDeps.push(undefined)
      }
      continue
    }

    // Resolver can be a function or a Token
    if (typeof resolver === 'function') {
      resolvedDeps.push(resolver(container))
    } else {
      // Assume it's a Token
      resolvedDeps.push(container.resolve(resolver as Token<any>))
    }
  }

  return resolvedDeps
}

/**
 * Resolve dependencies using class strategy
 * Requires build-time codegen to work properly
 */
export function resolveByClass(
  _constructor: new (...args: any[]) => any,
  _container: Container,
  _options: AutoWireOptions
): any[] {
  throw new Error(
    `AutoWire strategy 'class' requires build-time code generation. ` +
    `The 'class' strategy uses TypeScript AST analysis to extract parameter types ` +
    `and generate an explicit autowire map at build time. ` +
    `\n\nOptions:\n` +
    `  1. Use 'paramName' strategy (default): .autoWire({ by: 'paramName' })\n` +
    `  2. Use 'map' strategy (minify-safe): .autoWire({ map: { param: resolver } })\n` +
    `  3. Set up NovaDI transformer/plugin for build-time 'class' support (coming soon)`
  )
}

/**
 * Resolve dependencies using mapResolvers array strategy
 * OPTIMAL PERFORMANCE: O(1) array access per parameter
 * Minification-safe: Uses position-based array
 * Refactoring-friendly: Transformer regenerates array on recompile
 *
 * Requires build-time transformer to generate mapResolvers array
 */
export function resolveByMapResolvers(
  _constructor: new (...args: any[]) => any,
  container: Container,
  options: AutoWireOptions
): any[] {
  if (!options.mapResolvers || options.mapResolvers.length === 0) {
    return []
  }

  const resolvedDeps: any[] = []

  // Simple O(1) array access - ultra fast!
  for (let i = 0; i < options.mapResolvers.length; i++) {
    const resolver = options.mapResolvers[i]

    if (resolver === undefined) {
      // undefined indicates primitive type or parameter without DI
      resolvedDeps.push(undefined)
    } else if (typeof resolver === 'function') {
      // Resolver function: (c) => c.resolveInterface(...)
      resolvedDeps.push(resolver(container))
    } else {
      // Token-based resolution
      resolvedDeps.push(container.resolve(resolver as Token<any>))
    }
  }

  return resolvedDeps
}

/**
 * Resolve dependencies using positionType strategy
 * Minification-safe + Refactoring-friendly
 *
 * Smart matching strategy:
 * 1. Primary: Match on parameter name (supports refactoring/reordering)
 * 2. Fallback: Match on position (supports minification)
 *
 * Note: mapResolvers provides better performance (O(1) array access)
 * Requires build-time transformer to generate position metadata
 */
export function resolveByPositionType(
  constructor: new (...args: any[]) => any,
  container: Container,
  options: AutoWireOptions
): any[] {
  if (!options.positions || options.positions.length === 0) {
    return []
  }

  // Extract actual parameter names from runtime constructor
  // (will be minified names if code is minified)
  const actualParamNames = extractParameterNames(constructor)
  const resolvedDeps: any[] = []

  // For each parameter position in the constructor
  for (let i = 0; i < actualParamNames.length; i++) {
    const actualParamName = actualParamNames[i]

    // Strategy 1: Try to match by parameter name first (refactoring support)
    // This allows developers to reorder parameters without breaking autowiring
    let metadata = options.positions.find(p => p.parameterName === actualParamName)

    // Strategy 2: Fallback to position matching (minification support)
    // If parameter names don't match (due to minification), use position
    if (!metadata) {
      metadata = options.positions.find(p => p.index === i)
    }

    // If we found metadata, resolve the dependency
    if (metadata) {
      try {
        const resolved = container.resolveInterface(metadata.typeName)
        resolvedDeps.push(resolved)
      } catch (error) {
        if (options.strict) {
          throw new Error(
            `Cannot resolve dependency at position ${i} (parameter "${actualParamName}") with type "${metadata.typeName}". ` +
            `No interface registration found. ` +
            `Make sure the type is registered with .asInterface<${metadata.typeName}>()`
          )
        } else {
          // Non-strict mode: push undefined for unresolvable parameters
          resolvedDeps.push(undefined)
        }
      }
    } else {
      // No metadata found for this parameter position
      // This is expected for primitive types or parameters without DI
      resolvedDeps.push(undefined)
    }
  }

  return resolvedDeps
}

/**
 * Main autowire function - dispatches to appropriate strategy
 */
export function autowire(
  constructor: new (...args: any[]) => any,
  container: Container,
  options?: AutoWireOptions
): any[] {
  const opts: AutoWireOptions = {
    by: 'paramName',
    strict: false,
    ...options
  }

  // HIGHEST PRIORITY: mapResolvers array (transformer-generated, optimal performance)
  // O(1) array access per parameter - minification-safe and refactoring-friendly
  if (opts.mapResolvers && opts.mapResolvers.length > 0) {
    return resolveByMapResolvers(constructor, container, opts)
  }

  // FALLBACK: positions with smart matching
  if (opts.positions && opts.positions.length > 0) {
    return resolveByPositionType(constructor, container, opts)
  }

  // Performance: Early exit for constructors with no parameters
  const paramNames = extractParameterNames(constructor)
  if (paramNames.length === 0) {
    return []
  }

  // Manual map strategy
  if (opts.map && Object.keys(opts.map).length > 0) {
    return resolveByMap(constructor, container, opts)
  }

  // Dispatch to selected strategy
  switch (opts.by) {
    case 'paramName':
      return resolveByParamName(constructor, container, opts)
    case 'map':
      return resolveByMap(constructor, container, opts)
    case 'class':
      return resolveByClass(constructor, container, opts)
    case 'positionType':
      return resolveByPositionType(constructor, container, opts)
    default:
      throw new Error(`Unknown autowire strategy: ${opts.by}`)
  }
}

/**
 * Helper: capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
