/**
 * Test to verify that the transformer generates position-based autowiring metadata
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'

describe('Transformer - Position-Based AutoWire Generation', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should automatically generate position metadata for registerType without explicit autoWire', () => {
    // This test verifies that the transformer adds .autoWire({ positions: [...] })
    // automatically when it sees .registerType(X).asInterface<Y>()

    interface ILogger {
      log(msg: string): void
    }

    interface IDatabase {
      query(): any[]
    }

    class Logger implements ILogger {
      log(msg: string) {
        console.log(msg)
      }
    }

    class Database implements IDatabase {
      query() {
        return []
      }
    }

    class UserService {
      constructor(
        public logger: ILogger,
        public database: IDatabase
      ) {}
    }

    // Register types - NO explicit .autoWire() call
    // Transformer should automatically inject position metadata
    const builder = container.builder()
    builder.registerType(Logger).asInterface<ILogger>()
    builder.registerType(Database).asInterface<IDatabase>()
    builder.registerType(UserService).asInterface<UserService>()

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<UserService>()

    // If transformer worked correctly, dependencies should be resolved
    // via automatically generated position metadata
    expect(service).toBeInstanceOf(UserService)
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.database).toBeInstanceOf(Database)
  })

  it('should work with nested dependencies using transformer', () => {
    interface ILogger {
      log(msg: string): void
    }

    interface IConfig {
      get(key: string): string
    }

    class Logger implements ILogger {
      constructor(public config: IConfig) {}
      log(msg: string) {
        console.log(msg)
      }
    }

    class Config implements IConfig {
      get(key: string): string {
        return 'value'
      }
    }

    class Service {
      constructor(
        public logger: ILogger,
        public config: IConfig
      ) {}
    }

    const builder = container.builder()
    builder.registerType(Config).asInterface<IConfig>()
    builder.registerType(Logger).asInterface<ILogger>() // Has dependency on IConfig
    builder.registerType(Service).asInterface<Service>() // Has dependencies on both

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<Service>()

    expect(service).toBeInstanceOf(Service)
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.config).toBeInstanceOf(Config)
    expect((service.logger as Logger).config).toBeInstanceOf(Config)
  })
})
