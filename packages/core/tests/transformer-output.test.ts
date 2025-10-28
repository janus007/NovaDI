/**
 * Test to verify that the transformer generates mapResolvers autowiring
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'

describe('Transformer - MapResolvers AutoWire Generation', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should automatically generate mapResolvers for registerType without explicit autoWire', () => {
    // This test verifies that the transformer adds .autoWire({ mapResolvers: [...] })
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
    // Transformer should automatically inject mapResolvers
    const builder = container.builder()
    builder.registerType(Logger).asInterface<ILogger>('ILogger')
    builder.registerType(Database).asInterface<IDatabase>('IDatabase')
    builder.registerType(UserService).asInterface<UserService>('UserService')

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<UserService>('UserService')

    // If transformer worked correctly, dependencies should be resolved
    // via automatically generated mapResolvers
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
    builder.registerType(Config).asInterface<IConfig>('IConfig')
    builder.registerType(Logger).asInterface<ILogger>('ILogger') // Has dependency on IConfig
    builder.registerType(Service).asInterface<Service>('Service') // Has dependencies on both

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<Service>('Service')

    expect(service).toBeInstanceOf(Service)
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.config).toBeInstanceOf(Config)
    expect((service.logger as Logger).config).toBeInstanceOf(Config)
  })
})
