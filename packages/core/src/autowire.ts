/**
 * AutoWire - Automatic dependency injection for NovaDI
 * Supports three strategies: paramName, map, and class
 */

import type { Container } from './container'
import type { Token } from './token'
import type { AutoWireOptions } from './builder'

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

  // Performance: Early exit for constructors with no parameters
  const paramNames = extractParameterNames(constructor)
  if (paramNames.length === 0) {
    return []
  }

  // Map strategy has highest priority if map is provided
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
