/**
 * AutoWire - Automatic dependency injection for NovaDI
 * Supports two strategies: mapResolvers (transformer-generated) and map (manual override)
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
 *
 * Note: Only used by resolveByMap() for manual map strategy
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
      // Resolver function: (c) => c.resolveType(...)
      resolvedDeps.push(resolver(container))
    } else {
      // Token-based resolution
      resolvedDeps.push(container.resolve(resolver as Token<any>))
    }
  }

  return resolvedDeps
}


/**
 * Main autowire function - dispatches to appropriate strategy
 * Priority: mapResolvers (transformer-generated) > map (manual override)
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

  // FALLBACK: Manual map strategy for explicit overrides
  if (opts.map && Object.keys(opts.map).length > 0) {
    return resolveByMap(constructor, container, opts)
  }

  // No autowiring configured, return empty array
  return []
}
