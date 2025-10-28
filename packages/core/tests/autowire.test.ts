import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'

describe('Autowire - Map Strategy', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should autowire dependencies using explicit map', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    interface IDatabase {
      query(sql: string): any
    }

    class Logger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }

    class Database implements IDatabase {
      query(sql: string) {
        return []
      }
    }

    class UserService {
      constructor(
        public logger: ILogger,
        public database: IDatabase
      ) {}
    }

    // Act
    const builder = container.builder()
    builder.registerType(Logger).as<ILogger>('ILogger').singleInstance()
    builder.registerType(Database).as<IDatabase>('IDatabase').singleInstance()
    builder
      .registerType(UserService)
      .as<UserService>('UserService')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<ILogger>('ILogger'),
          database: (c) => c.resolveType<IDatabase>('IDatabase')
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<UserService>('UserService')

    // Assert
    expect(service).toBeInstanceOf(UserService)
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.database).toBeInstanceOf(Database)
  })

  it('should autowire dependencies using map strategy with interface resolution', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }

    class Logger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }

    class UserService {
      constructor(public logger: ILogger) {}
    }

    // Act
    const builder = container.builder()
    builder.registerType(Logger).as<ILogger>('ILogger')
    builder
      .registerType(UserService)
      .as<UserService>('UserService')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<ILogger>('ILogger')
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<UserService>('UserService')

    // Assert
    expect(service).toBeInstanceOf(UserService)
    expect(service.logger).toBeInstanceOf(Logger)
  })

  it('should handle nested dependency resolution', () => {
    // Arrange
    class Database {
      query() {
        return []
      }
    }

    class Logger {
      constructor(public db: Database) {}
      log(msg: string) {}
    }

    class UserService {
      constructor(
        public logger: Logger,
        public db: Database
      ) {}
    }

    // Act
    const builder = container.builder()
    builder.registerType(Database).as<Database>('Database').singleInstance()
    builder
      .registerType(Logger)
      .as<Logger>('Logger')
      .autoWire({
        map: {
          db: (c) => c.resolveType<Database>('Database')
        }
      })
      .singleInstance()
    builder
      .registerType(UserService)
      .as<UserService>('UserService')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<Logger>('Logger'),
          db: (c) => c.resolveType<Database>('Database')
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<UserService>('UserService')

    // Assert
    expect(service).toBeInstanceOf(UserService)
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.db).toBeInstanceOf(Database)
    expect(service.logger.db).toBe(service.db) // Same singleton instance
  })
})

describe('Autowire - Parameter Overrides', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should override single parameter with withParameter()', () => {
    // Arrange
    class ConfigService {
      constructor(
        public apiKey: string,
        public timeout: number
      ) {}
    }

    // Act
    const builder = container.builder()
    builder
      .registerType(ConfigService)
      .as<ConfigService>('ConfigService')
      .withParameters({
        apiKey: 'test-api-key',
        timeout: 5000
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<ConfigService>('ConfigService')

    // Assert
    expect(service.apiKey).toBe('test-api-key')
    expect(service.timeout).toBe(5000)
  })

  it('should mix autowired dependencies and parameter overrides', () => {
    // Arrange
    interface ILogger {
      log(msg: string): void
    }

    class Logger implements ILogger {
      log(msg: string) {}
    }

    class ApiService {
      constructor(
        public logger: ILogger,
        public apiKey: string,
        public baseUrl: string
      ) {}
    }

    // Act
    const builder = container.builder()
    builder.registerType(Logger).as<ILogger>('ILogger')
    builder
      .registerType(ApiService)
      .as<ApiService>('ApiService')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<ILogger>('ILogger'),
          apiKey: () => 'abc123',
          baseUrl: () => 'https://api.example.com'
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<ApiService>('ApiService')

    // Assert
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.apiKey).toBe('abc123')
    expect(service.baseUrl).toBe('https://api.example.com')
  })

  it('should support map strategy with mixed DI and primitive values', () => {
    // Arrange
    class Logger {
      log(msg: string) {}
    }

    class ApiService {
      constructor(
        public logger: Logger,
        public apiKey: string
      ) {}
    }

    // Act
    const builder = container.builder()
    builder.registerType(Logger).as<Logger>('Logger')
    builder
      .registerType(ApiService)
      .as<ApiService>('ApiService')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<Logger>('Logger'),
          apiKey: () => 'my-api-key'
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<ApiService>('ApiService')

    // Assert
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.apiKey).toBe('my-api-key')
  })
})

describe('Autowire - Factory Autowiring', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should autowire factory dependencies', () => {
    // Arrange
    interface ILogger {
      log(msg: string): void
    }

    class Logger implements ILogger {
      log(msg: string) {}
    }

    class UserService {
      constructor(public logger: ILogger) {}
    }

    // Act
    const builder = container.builder()
    builder.registerType(Logger).as<ILogger>("ILogger")
    builder
      .register<UserService>((c) => {
        const logger = c.resolveType<ILogger>("ILogger")
        return new UserService(logger)
      })
      .as<UserService>("UserService")

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<UserService>("UserService")

    // Assert
    expect(service).toBeInstanceOf(UserService)
    expect(service.logger).toBeInstanceOf(Logger)
  })

  it('should combine factory and withDependencies for clarity', () => {
    // Arrange
    class Database {
      query() {}
    }

    class Logger {
      constructor(public db: Database) {}
    }

    // Act
    const builder = container.builder()
    builder.registerType(Database).as<Database>("Database").singleInstance()

    // Using factory for custom instantiation
    builder
      .register<Logger>((c) => {
        const db = c.resolveType<Database>("Database")
        return new Logger(db)
      })
      .as<Logger>("Logger")

    const builtContainer = builder.build()
    const logger = builtContainer.resolveType<Logger>("Logger")

    // Assert
    expect(logger).toBeInstanceOf(Logger)
    expect(logger.db).toBeInstanceOf(Database)
  })
})


describe('Autowire - Error Handling', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should throw clear error when dependency cannot be resolved', () => {
    // Arrange
    class Logger {}
    class UserService {
      constructor(public logger: Logger) {}
    }

    // Act
    const builder = container.builder()
    // Note: Logger is NOT registered
    builder
      .registerType(UserService)
      .as<UserService>('UserService')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<Logger>('Logger')
        }
      })

    const builtContainer = builder.build()

    // Assert
    expect(() => {
      builtContainer.resolveType<UserService>('UserService')
    }).toThrow(/Logger/)
  })

  it('should provide helpful error when dependency cannot be resolved', () => {
    // Arrange
    interface ILogger {
      log(): void
    }

    class UserService {
      constructor(
        public logger: ILogger,
        public database: any
      ) {}
    }

    // Act
    const builder = container.builder()
    builder.registerInstance({ log: () => {} }).as<ILogger>('ILogger')
    builder
      .registerType(UserService)
      .as<UserService>('UserService')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<ILogger>('ILogger')
          // Logger is in the map but database is not - will pass undefined in non-strict mode
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<UserService>('UserService')

    // Assert - in non-strict mode, missing parameters get undefined
    expect(service.logger).toBeDefined()
    expect(service.database).toBeUndefined()
  })

  it('should handle missing parameters in map gracefully', () => {
    // Arrange
    interface ILogger {
      log(): void
    }

    class UserService {
      constructor(
        public logger: ILogger,
        public database: any
      ) {}
    }

    // Act
    const builder = container.builder()
    builder.registerInstance({ log: () => {} }).as<ILogger>('ILogger')
    builder
      .registerType(UserService)
      .as<UserService>('UserService')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<ILogger>('ILogger')
          // Missing 'database' - will pass undefined in non-strict mode
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<UserService>('UserService')

    // Assert
    expect(service.logger).toBeDefined() // Resolved from interface
    expect(service.database).toBeUndefined() // Not in map, undefined passed
  })
})

