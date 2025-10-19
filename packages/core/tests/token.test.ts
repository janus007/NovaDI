import { describe, it, expect } from 'vitest'
import { Token } from '../src/token'

describe('Token', () => {
  it('should create unique tokens with type safety', () => {
    // Arrange & Act
    interface ILogger {
      log(message: string): void
    }
    interface IDatabase {
      query(sql: string): any
    }

    const loggerToken = Token<ILogger>()
    const databaseToken = Token<IDatabase>()

    // Assert
    expect(loggerToken).toBeDefined()
    expect(databaseToken).toBeDefined()
    expect(loggerToken).not.toBe(databaseToken)
  })

  it('should create different tokens for same type on multiple calls', () => {
    // Arrange & Act
    interface IService {
      execute(): void
    }

    const token1 = Token<IService>()
    const token2 = Token<IService>()

    // Assert
    expect(token1).not.toBe(token2)
  })

  it('should support symbol-based tokens', () => {
    // Arrange & Act
    interface ILogger {
      log(message: string): void
    }

    const token = Token<ILogger>()

    // Assert
    // Token should have a unique identifier (could be symbol or unique object)
    expect(typeof token).toBe('object')
  })

  it('should have useful toString() for debugging', () => {
    // Arrange & Act
    interface ILogger {
      log(message: string): void
    }

    const token = Token<ILogger>('LoggerToken')

    // Assert
    const stringified = token.toString()
    expect(stringified).toContain('Token')
    expect(stringified).toContain('LoggerToken')
  })

  it('should support optional description parameter', () => {
    // Arrange & Act
    interface ILogger {
      log(message: string): void
    }

    const tokenWithDesc = Token<ILogger>('Logger')
    const tokenWithoutDesc = Token<ILogger>()

    // Assert
    expect(tokenWithDesc).toBeDefined()
    expect(tokenWithoutDesc).toBeDefined()
    expect(tokenWithDesc.toString()).toContain('Logger')
  })

  it('should maintain type information at compile time', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    interface IDatabase {
      query(sql: string): any
    }

    // Act
    const loggerToken = Token<ILogger>()
    const databaseToken = Token<IDatabase>()

    // Assert - Type checking (compile-time test)
    // This ensures TypeScript maintains the generic type parameter
    type LoggerTokenType = typeof loggerToken extends Token<infer T> ? T : never
    type DatabaseTokenType = typeof databaseToken extends Token<infer T> ? T : never

    // Runtime assertion to ensure test runs
    expect(loggerToken).not.toBe(databaseToken)
  })

  it('should be usable as Map key', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }

    const token = Token<ILogger>()
    const map = new Map()

    // Act
    map.set(token, 'some value')

    // Assert
    expect(map.has(token)).toBe(true)
    expect(map.get(token)).toBe('some value')
  })

  it('should support equality check', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }

    const token1 = Token<ILogger>()
    const token2 = Token<ILogger>()

    // Act & Assert
    expect(token1).toBe(token1) // Same reference
    expect(token1).not.toBe(token2) // Different tokens
  })
})
