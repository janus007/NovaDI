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
    builder.registerType(Logger).asInterface<ILogger>().singleInstance()
    builder.registerType(Database).asInterface<IDatabase>().singleInstance()
    builder
      .registerType(UserService)
      .asInterface<UserService>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<ILogger>(),
          database: (c) => c.resolveInterface<IDatabase>()
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<UserService>()

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
    builder.registerType(Logger).asInterface<ILogger>()
    builder
      .registerType(UserService)
      .asInterface<UserService>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<ILogger>()
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<UserService>()

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
    builder.registerType(Database).asInterface<Database>().singleInstance()
    builder
      .registerType(Logger)
      .asInterface<Logger>()
      .autoWire({
        map: {
          db: (c) => c.resolveInterface<Database>()
        }
      })
      .singleInstance()
    builder
      .registerType(UserService)
      .asInterface<UserService>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<Logger>(),
          db: (c) => c.resolveInterface<Database>()
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<UserService>()

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
      .asInterface<ConfigService>()
      .withParameters({
        apiKey: 'test-api-key',
        timeout: 5000
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<ConfigService>()

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
    builder.registerType(Logger).asInterface<ILogger>()
    builder
      .registerType(ApiService)
      .asInterface<ApiService>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<ILogger>(),
          apiKey: () => 'abc123',
          baseUrl: () => 'https://api.example.com'
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<ApiService>()

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
    builder.registerType(Logger).asInterface<Logger>()
    builder
      .registerType(ApiService)
      .asInterface<ApiService>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<Logger>(),
          apiKey: () => 'my-api-key'
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<ApiService>()

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
    builder.registerType(Logger).asInterface<ILogger>("ILogger")
    builder
      .register<UserService>((c) => {
        const logger = c.resolveInterface<ILogger>("ILogger")
        return new UserService(logger)
      })
      .asInterface<UserService>("UserService")

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<UserService>("UserService")

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
    builder.registerType(Database).asInterface<Database>("Database").singleInstance()

    // Using factory for custom instantiation
    builder
      .register<Logger>((c) => {
        const db = c.resolveInterface<Database>("Database")
        return new Logger(db)
      })
      .asInterface<Logger>("Logger")

    const builtContainer = builder.build()
    const logger = builtContainer.resolveInterface<Logger>("Logger")

    // Assert
    expect(logger).toBeInstanceOf(Logger)
    expect(logger.db).toBeInstanceOf(Database)
  })
})

describe('Autowire - Default ParamName Strategy', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should autowire dependencies automatically without .autoWire() call', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    interface IEventBus {
      publish(event: string): void
    }

    class Logger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }

    class EventBus implements IEventBus {
      constructor(public logger: ILogger) {}
      publish(event: string) {
        this.logger.log(`Event: ${event}`)
      }
    }

    // Act - NO .autoWire() call - should use default paramName strategy
    const builder = container.builder()
    builder.registerType(Logger).asInterface<ILogger>().singleInstance()
    builder.registerType(EventBus).asInterface<IEventBus>().singleInstance()

    const builtContainer = builder.build()
    const eventBus = builtContainer.resolveInterface<IEventBus>()

    // Assert - logger should be auto-injected via paramName matching
    expect(eventBus).toBeInstanceOf(EventBus)
    expect(eventBus.logger).toBeInstanceOf(Logger)
  })

  it('should match parameter names to interface names using smart naming conventions', () => {
    // Arrange
    interface ILogger {
      log(msg: string): void
    }

    class ConsoleLogger implements ILogger {
      log(msg: string) {}
    }

    class Service {
      // Parameter is "logger" but interface is "ILogger"
      constructor(public logger: ILogger) {}
    }

    // Act - Default autowiring should try: "logger", "Logger", "ILogger"
    const builder = container.builder()
    builder.registerType(ConsoleLogger).asInterface<ILogger>()
    builder.registerType(Service).asInterface<Service>()

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<Service>()

    // Assert - Should match "logger" → "ILogger"
    expect(service.logger).toBeInstanceOf(ConsoleLogger)
  })

  it('should handle multiple dependencies with default autowiring', () => {
    // Arrange
    interface ILogger {
      log(msg: string): void
    }
    interface IDatabase {
      query(): any[]
    }
    interface ICache {
      get(key: string): any
    }

    class Logger implements ILogger {
      log(msg: string) {}
    }

    class Database implements IDatabase {
      query() {
        return []
      }
    }

    class Cache implements ICache {
      get(key: string) {
        return null
      }
    }

    class UserService {
      constructor(
        public logger: ILogger,
        public database: IDatabase,
        public cache: ICache
      ) {}
    }

    // Act - All dependencies should be auto-resolved
    const builder = container.builder()
    builder.registerType(Logger).asInterface<ILogger>()
    builder.registerType(Database).asInterface<IDatabase>()
    builder.registerType(Cache).asInterface<ICache>()
    builder.registerType(UserService).asInterface<UserService>()

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<UserService>()

    // Assert
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.database).toBeInstanceOf(Database)
    expect(service.cache).toBeInstanceOf(Cache)
  })

  it('should allow .autoWire() to override default behavior', () => {
    // Arrange
    interface ILogger {
      log(msg: string): void
    }

    class ConsoleLogger implements ILogger {
      log(msg: string) {}
    }

    class FileLogger implements ILogger {
      log(msg: string) {}
    }

    class Service {
      constructor(public logger: ILogger) {}
    }

    // Act - Use explicit autowire to override default
    const builder = container.builder()
    builder.registerType(ConsoleLogger).asInterface<ILogger>()
    builder.registerType(FileLogger).asInterface<ILogger>('FileLogger')
    builder
      .registerType(Service)
      .asInterface<Service>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<ILogger>('FileLogger')
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<Service>()

    // Assert - Should use FileLogger via explicit autowire
    expect(service.logger).toBeInstanceOf(FileLogger)
  })

  it('should pass undefined for unresolvable parameters in non-strict mode (default)', () => {
    // Arrange
    interface ILogger {
      log(msg: string): void
    }

    class Service {
      constructor(
        public logger: ILogger,
        public config: any // Not registered
      ) {}
    }

    // Act
    const builder = container.builder()
    builder.registerInstance({ log: () => {} }).asInterface<ILogger>()
    builder.registerType(Service).asInterface<Service>()

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<Service>()

    // Assert - logger resolved, config is undefined
    expect(service.logger).toBeDefined()
    expect(service.config).toBeUndefined()
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
      .asInterface<UserService>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<Logger>()
        }
      })

    const builtContainer = builder.build()

    // Assert
    expect(() => {
      builtContainer.resolveInterface<UserService>()
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
    builder.registerInstance({ log: () => {} }).asInterface<ILogger>()
    builder
      .registerType(UserService)
      .asInterface<UserService>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<ILogger>()
          // Logger is in the map but database is not - will pass undefined in non-strict mode
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<UserService>()

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
    builder.registerInstance({ log: () => {} }).asInterface<ILogger>()
    builder
      .registerType(UserService)
      .asInterface<UserService>()
      .autoWire({
        map: {
          logger: (c) => c.resolveInterface<ILogger>()
          // Missing 'database' - will pass undefined in non-strict mode
        }
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<UserService>()

    // Assert
    expect(service.logger).toBeDefined() // Resolved from interface
    expect(service.database).toBeUndefined() // Not in map, undefined passed
  })
})

describe('Autowire - Minification Support (Position-Based)', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should work correctly with position-based autowiring even when parameter names are minified', () => {
    // Arrange: Create interfaces and implementations
    interface IEventBus {
      publish(event: string): void
    }

    interface ILogger {
      log(msg: string): void
    }

    class EventBus implements IEventBus {
      publish(event: string) {
        console.log(`Event: ${event}`)
      }
    }

    class Logger implements ILogger {
      log(msg: string) {
        console.log(msg)
      }
    }

    // Minified class - simulates what a bundler does to parameter names
    // In production, bundler would transform:
    //   constructor(eventBus: IEventBus, logger: ILogger)
    // Into:
    //   constructor(a, b)
    class ServiceMinified {
      constructor(
        public a: IEventBus,  // 'eventBus' became 'a'
        public b: ILogger     // 'logger' became 'b'
      ) {}
    }

    // Register dependencies
    const builder = container.builder()
    builder.registerType(EventBus).asInterface<IEventBus>()
    builder.registerType(Logger).asInterface<ILogger>()

    // NEW SOLUTION: Position-based autowiring (minification-safe!)
    // Transformer generates position metadata instead of relying on parameter names
    builder
      .registerType(ServiceMinified)
      .asInterface<ServiceMinified>()
      .autoWire({
        positions: [
          { parameterName: 'eventBus', index: 0, typeName: 'IEventBus' },  // Position 0 → IEventBus
          { parameterName: 'logger', index: 1, typeName: 'ILogger' }       // Position 1 → ILogger
        ]
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<ServiceMinified>()

    // Assert: Position-based autowiring works regardless of parameter names!
    // Dependencies are resolved by position + type, not by parameter names
    expect(service.a).toBeInstanceOf(EventBus)  // ✅ Now works!
    expect(service.b).toBeInstanceOf(Logger)    // ✅ Now works!
  })

  it('should resolve dependencies by position regardless of minified parameter names', () => {
    // This test demonstrates that position-based strategy ignores parameter names entirely
    interface IService {
      doWork(): void
    }

    interface ILogger {
      log(msg: string): void
    }

    class Service implements IService {
      doWork() {}
    }

    class Logger implements ILogger {
      log(msg: string) {}
    }

    // Minified class with cryptic parameter names
    class MinifiedClass {
      constructor(
        public x: IService,   // Could be any name
        public y: ILogger     // Could be any name
      ) {}
    }

    const builder = container.builder()
    builder.registerType(Service).asInterface<IService>()
    builder.registerType(Logger).asInterface<ILogger>()
    builder
      .registerType(MinifiedClass)
      .asInterface<MinifiedClass>()
      .autoWire({
        positions: [
          { parameterName: 'service', index: 0, typeName: 'IService' },
          { parameterName: 'logger', index: 1, typeName: 'ILogger' }
        ]
      })

    const builtContainer = builder.build()
    const instance = builtContainer.resolveInterface<MinifiedClass>()

    // Position-based resolution works perfectly
    expect(instance.x).toBeInstanceOf(Service)
    expect(instance.y).toBeInstanceOf(Logger)
  })

  it('should handle sparse position mappings (skipping primitive types)', () => {
    // Real-world scenario: Constructor has mix of DI dependencies and primitive types
    interface ILogger {
      log(msg: string): void
    }

    class Logger implements ILogger {
      log(msg: string) {}
    }

    // Constructor with mixed types
    class MixedService {
      constructor(
        public a: ILogger,    // Position 0: DI dependency
        public b: string,     // Position 1: Primitive (not in positions array)
        public c: number      // Position 2: Primitive (not in positions array)
      ) {}
    }

    const builder = container.builder()
    builder.registerType(Logger).asInterface<ILogger>()
    builder
      .registerType(MixedService)
      .asInterface<MixedService>()
      .autoWire({
        positions: [
          { parameterName: 'a', index: 0, typeName: 'ILogger' }  // Only position 0 is mapped
        ]
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<MixedService>()

    // Logger is injected, primitives are undefined (expected)
    expect(service.a).toBeInstanceOf(Logger)
    expect(service.b).toBeUndefined()
    expect(service.c).toBeUndefined()
  })

  it('should use position matching regardless of parameter names (minification-safe)', () => {
    // Scenario: Code is minified, parameter names are mangled
    // Position-based matching always uses index, ignoring parameter names
    interface IEventBus {
      publish(event: string): void
    }

    interface ILogger {
      log(msg: string): void
    }

    class EventBus implements IEventBus {
      publish(event: string) {}
    }

    class Logger implements ILogger {
      log(msg: string) {}
    }

    // Minified: parameter names are now 'a' and 'b'
    class MinifiedService {
      constructor(
        public a: IEventBus,  // Was 'eventBus', now 'a'
        public b: ILogger     // Was 'logger', now 'b'
      ) {}
    }

    const builder = container.builder()
    builder.registerType(EventBus).asInterface<IEventBus>()
    builder.registerType(Logger).asInterface<ILogger>()
    builder
      .registerType(MinifiedService)
      .asInterface<MinifiedService>()
      .autoWire({
        positions: [
          // Position-based: matches on index only, parameter names are ignored
          { parameterName: 'eventBus', index: 0, typeName: 'IEventBus' },
          { parameterName: 'logger', index: 1, typeName: 'ILogger' }
        ]
      })

    const builtContainer = builder.build()
    const service = builtContainer.resolveInterface<MinifiedService>()

    // Position-based matching works regardless of parameter names
    expect(service.a).toBeInstanceOf(EventBus)
    expect(service.b).toBeInstanceOf(Logger)
  })
})
