import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'
import { Token } from '../src/token'

describe('Interface Registry - Multiple Interfaces', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should register type as multiple interfaces', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    interface IDisposable {
      dispose(): void
    }

    class ConsoleLogger implements ILogger, IDisposable {
      log(message: string) {
        console.log(message)
      }
      dispose() {
        // cleanup
      }
    }

    const loggerToken = Token<ILogger>('ILogger')
    const disposableToken = Token<IDisposable>('IDisposable')

    // Act
    const builder = container.builder()
    builder
      .registerType(ConsoleLogger)
      .asImplementedInterfaces([loggerToken, disposableToken])

    const builtContainer = builder.build()

    // Assert
    const logger = builtContainer.resolve(loggerToken)
    const disposable = builtContainer.resolve(disposableToken)
    expect(logger).toBeInstanceOf(ConsoleLogger)
    expect(disposable).toBeInstanceOf(ConsoleLogger)
    // Should be same instance (singleton by default for asImplementedInterfaces)
    expect(logger).toBe(disposable)
  })

  it('should register instance as multiple interfaces', () => {
    // Arrange
    interface IConfig {
      getValue(): string
    }
    interface ISettings {
      getSetting(): string
    }

    const config = {
      getValue: () => 'test-value',
      getSetting: () => 'test-value'
    }

    const configToken = Token<IConfig>('IConfig')
    const settingsToken = Token<ISettings>('ISettings')

    // Act
    const builder = container.builder()
    builder
      .registerInstance(config)
      .asImplementedInterfaces([configToken, settingsToken])

    const builtContainer = builder.build()

    // Assert
    expect(builtContainer.resolve(configToken)).toBe(config)
    expect(builtContainer.resolve(settingsToken)).toBe(config)
  })

  it('should support both as() and asImplementedInterfaces() in same chain', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    interface IDisposable {
      dispose(): void
    }

    class ConsoleLogger implements ILogger, IDisposable {
      log(message: string) {
        console.log(message)
      }
      dispose() {
        // cleanup
      }
    }

    const selfToken = Token<ConsoleLogger>('ConsoleLogger')
    const loggerToken = Token<ILogger>('ILogger')
    const disposableToken = Token<IDisposable>('IDisposable')

    // Act
    const builder = container.builder()
    builder
      .registerType(ConsoleLogger)
      .as(selfToken)
      .asImplementedInterfaces([loggerToken, disposableToken])

    const builtContainer = builder.build()

    // Assert
    const self = builtContainer.resolve(selfToken)
    const logger = builtContainer.resolve(loggerToken)
    const disposable = builtContainer.resolve(disposableToken)

    expect(self).toBeInstanceOf(ConsoleLogger)
    expect(logger).toBe(self)
    expect(disposable).toBe(self)
  })
})

describe('Interface Registry - Named Services', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should support named registrations', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>('ILogger')

    class FileLogger implements ILogger {
      log(message: string) {
        // log to file
      }
    }
    class ConsoleLogger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }

    // Act
    const builder = container.builder()
    builder
      .registerType(FileLogger)
      .as(loggerToken)
      .named('file')

    builder
      .registerType(ConsoleLogger)
      .as(loggerToken)
      .named('console')

    const builtContainer = builder.build()

    // Assert
    const fileLogger = builtContainer.resolveNamed<ILogger>('file')
    const consoleLogger = builtContainer.resolveNamed<ILogger>('console')

    expect(fileLogger).toBeInstanceOf(FileLogger)
    expect(consoleLogger).toBeInstanceOf(ConsoleLogger)
  })

  it('should allow named and unnamed registrations for same token', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>('ILogger')

    class DefaultLogger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }
    class SpecialLogger implements ILogger {
      log(message: string) {
        console.log('[SPECIAL]', message)
      }
    }

    // Act
    const builder = container.builder()
    builder.registerType(DefaultLogger).as(loggerToken)
    builder.registerType(SpecialLogger).as(loggerToken).named('special')

    const builtContainer = builder.build()

    // Assert
    const defaultLogger = builtContainer.resolve(loggerToken)
    const specialLogger = builtContainer.resolveNamed<ILogger>('special')

    expect(defaultLogger).toBeInstanceOf(DefaultLogger)
    expect(specialLogger).toBeInstanceOf(SpecialLogger)
  })

  it('should throw error when resolving non-existent named service', () => {
    // Arrange
    const builder = container.builder()
    const builtContainer = builder.build()

    // Act & Assert
    expect(() => {
      builtContainer.resolveNamed<any>('non-existent')
    }).toThrow()
  })
})

describe('Interface Registry - Keyed Services', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should support keyed registrations', () => {
    // Arrange
    interface IRepository<T> {
      findById(id: number): T | null
    }

    class UserRepository implements IRepository<any> {
      findById(id: number) {
        return { id, type: 'user' }
      }
    }
    class ProductRepository implements IRepository<any> {
      findById(id: number) {
        return { id, type: 'product' }
      }
    }

    const repositoryToken = Token<IRepository<any>>('IRepository')

    // Act
    const builder = container.builder()
    builder
      .registerType(UserRepository)
      .as(repositoryToken)
      .keyed('user')

    builder
      .registerType(ProductRepository)
      .as(repositoryToken)
      .keyed('product')

    const builtContainer = builder.build()

    // Assert
    const userRepo = builtContainer.resolveKeyed<IRepository<any>>('user')
    const productRepo = builtContainer.resolveKeyed<IRepository<any>>('product')

    expect(userRepo).toBeInstanceOf(UserRepository)
    expect(productRepo).toBeInstanceOf(ProductRepository)
  })

  it('should inject keyed dependencies via factory', () => {
    // Arrange
    interface IRepository<T> {
      findById(id: number): T | null
    }
    interface IService {
      getUser(id: number): any
    }

    class UserRepository implements IRepository<any> {
      findById(id: number) {
        return { id, type: 'user' }
      }
    }
    class UserService implements IService {
      constructor(private repo: IRepository<any>) {}
      getUser(id: number) {
        return this.repo.findById(id)
      }
    }

    const repositoryToken = Token<IRepository<any>>('IRepository')
    const serviceToken = Token<IService>('IService')

    // Act
    const builder = container.builder()
    builder
      .registerType(UserRepository)
      .as(repositoryToken)
      .keyed('user')

    builder
      .register((c) => {
        const repo = c.resolveKeyed<IRepository<any>>('user')
        return new UserService(repo)
      })
      .as(serviceToken)

    const builtContainer = builder.build()
    const service = builtContainer.resolve(serviceToken)

    // Assert
    expect(service).toBeInstanceOf(UserService)
    expect(service.getUser(1)).toEqual({ id: 1, type: 'user' })
  })

  it('should support symbol keys for keyed services', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>('ILogger')
    const fileKey = Symbol('file')
    const consoleKey = Symbol('console')

    class FileLogger implements ILogger {
      log(message: string) {
        // log to file
      }
    }
    class ConsoleLogger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }

    // Act
    const builder = container.builder()
    builder
      .registerType(FileLogger)
      .as(loggerToken)
      .keyed(fileKey)

    builder
      .registerType(ConsoleLogger)
      .as(loggerToken)
      .keyed(consoleKey)

    const builtContainer = builder.build()

    // Assert
    const fileLogger = builtContainer.resolveKeyed<ILogger>(fileKey)
    const consoleLogger = builtContainer.resolveKeyed<ILogger>(consoleKey)

    expect(fileLogger).toBeInstanceOf(FileLogger)
    expect(consoleLogger).toBeInstanceOf(ConsoleLogger)
  })
})

describe('Interface Registry - Default Implementations', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should mark registration as default', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>('ILogger')

    class ConsoleLogger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }

    // Act
    const builder = container.builder()
    builder
      .registerType(ConsoleLogger)
      .as(loggerToken)
      .asDefault()

    const builtContainer = builder.build()

    // Assert
    const logger = builtContainer.resolve(loggerToken)
    expect(logger).toBeInstanceOf(ConsoleLogger)
  })

  it('should allow default registration to be overridden', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>('ILogger')

    class ConsoleLogger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }
    class FileLogger implements ILogger {
      log(message: string) {
        // log to file
      }
    }

    // Act
    const builder = container.builder()
    builder
      .registerType(ConsoleLogger)
      .as(loggerToken)
      .asDefault()

    builder
      .registerType(FileLogger)
      .as(loggerToken) // Non-default registration overrides

    const builtContainer = builder.build()

    // Assert
    const logger = builtContainer.resolve(loggerToken)
    expect(logger).toBeInstanceOf(FileLogger)
  })

  it('should not override existing registration if marked as default', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>('ILogger')

    class ConsoleLogger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }
    class FileLogger implements ILogger {
      log(message: string) {
        // log to file
      }
    }

    // Act
    const builder = container.builder()
    builder
      .registerType(ConsoleLogger)
      .as(loggerToken)

    builder
      .registerType(FileLogger)
      .as(loggerToken)
      .asDefault() // Should not override because ConsoleLogger already registered

    const builtContainer = builder.build()

    // Assert
    const logger = builtContainer.resolve(loggerToken)
    expect(logger).toBeInstanceOf(ConsoleLogger)
  })
})

describe('Interface Registry - Conditional Registration', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should conditionally register if not already registered', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>('ILogger')

    class ConsoleLogger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }
    class FileLogger implements ILogger {
      log(message: string) {
        // log to file
      }
    }

    // Act
    const builder = container.builder()
    builder
      .registerType(ConsoleLogger)
      .as(loggerToken)

    builder
      .registerType(FileLogger)
      .as(loggerToken)
      .ifNotRegistered()

    const builtContainer = builder.build()

    // Assert
    const logger = builtContainer.resolve(loggerToken)
    expect(logger).toBeInstanceOf(ConsoleLogger)
  })

  it('should register if token not already registered', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>('ILogger')

    class FileLogger implements ILogger {
      log(message: string) {
        // log to file
      }
    }

    // Act
    const builder = container.builder()
    builder
      .registerType(FileLogger)
      .as(loggerToken)
      .ifNotRegistered()

    const builtContainer = builder.build()

    // Assert
    const logger = builtContainer.resolve(loggerToken)
    expect(logger).toBeInstanceOf(FileLogger)
  })
})

describe('Interface Registry - Resolve All', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should resolve all registrations for a token', () => {
    // Arrange
    interface IPlugin {
      execute(): string
    }
    const pluginToken = Token<IPlugin>('IPlugin')

    class Plugin1 implements IPlugin {
      execute() {
        return 'plugin1'
      }
    }
    class Plugin2 implements IPlugin {
      execute() {
        return 'plugin2'
      }
    }
    class Plugin3 implements IPlugin {
      execute() {
        return 'plugin3'
      }
    }

    // Act
    const builder = container.builder()
    builder.registerType(Plugin1).as(pluginToken)
    builder.registerType(Plugin2).as(pluginToken)
    builder.registerType(Plugin3).as(pluginToken)

    const builtContainer = builder.build()
    const plugins = builtContainer.resolveAll(pluginToken)

    // Assert
    expect(plugins).toHaveLength(3)
    expect(plugins[0]).toBeInstanceOf(Plugin1)
    expect(plugins[1]).toBeInstanceOf(Plugin2)
    expect(plugins[2]).toBeInstanceOf(Plugin3)
  })

  it('should return empty array if no registrations exist', () => {
    // Arrange
    interface IPlugin {
      execute(): string
    }
    const pluginToken = Token<IPlugin>('IPlugin')

    // Act
    const builder = container.builder()
    const builtContainer = builder.build()
    const plugins = builtContainer.resolveAll(pluginToken)

    // Assert
    expect(plugins).toEqual([])
  })

  it('should resolve all with mixed lifetimes', () => {
    // Arrange
    interface ILogger {
      id: number
    }
    const loggerToken = Token<ILogger>('ILogger')
    let count = 0

    // Act
    const builder = container.builder()
    builder
      .register(() => ({ id: ++count }))
      .as(loggerToken)
      .singleInstance()

    builder
      .register(() => ({ id: ++count }))
      .as(loggerToken)

    const builtContainer = builder.build()
    const loggers1 = builtContainer.resolveAll(loggerToken)
    const loggers2 = builtContainer.resolveAll(loggerToken)

    // Assert
    expect(loggers1).toHaveLength(2)
    expect(loggers2).toHaveLength(2)
    // First is singleton, should be same instance
    expect(loggers1[0]).toBe(loggers2[0])
    expect(loggers1[0].id).toBe(1)
    // Second is transient, should be different instances
    expect(loggers1[1]).not.toBe(loggers2[1])
  })
})
