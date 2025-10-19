/**
 * Unique identifier for dependency injection bindings.
 * Provides type safety without decorators or reflect-metadata.
 */
export interface Token<T> {
  /** Phantom type property for TypeScript type inference - never exists at runtime */
  readonly __type?: T
  /** Unique symbol identifying this token */
  readonly symbol: symbol
  /** Optional human-readable description for debugging */
  readonly description?: string
  /** Returns a string representation of the token */
  toString(): string
}

let tokenCounter = 0

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
export function Token<T>(description?: string): Token<T> {
  const id = ++tokenCounter
  const sym = Symbol(description ? `Token(${description})` : `Token#${id}`)

  const token: Token<T> = {
    symbol: sym,
    description,
    toString() {
      return description
        ? `Token<${description}>`
        : `Token<#${id}>`
    }
  }

  return token
}

/**
 * Creates a new unique token without a string literal.
 * Preferred for Autofac-style DI to avoid string literals.
 *
 * @returns A unique token that can be used as a Map key
 *
 * @example
 * ```ts
 * interface ILogger { log(msg: string): void }
 * const LoggerToken = token<ILogger>()
 * ```
 */
export function token<T>(): Token<T> {
  return Token<T>()
}
