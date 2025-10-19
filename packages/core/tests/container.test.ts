import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'
import { Token } from '../src/token'

describe('Container - Value Binding', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should resolve pre-bound value', () => {
    // Arrange
    interface IConfig {
      apiKey: string
    }
    const configToken = Token<IConfig>()
    const config = { apiKey: 'test-key-123' }

    // Act
    container.bindValue(configToken, config)
    const resolved = container.resolve(configToken)

    // Assert
    expect(resolved).toBe(config)
    expect(resolved.apiKey).toBe('test-key-123')
  })

  it('should throw error when resolving unbound token', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>()

    // Act & Assert
    expect(() => container.resolve(loggerToken)).toThrow()
    expect(() => container.resolve(loggerToken)).toThrow(/not bound/i)
  })

  it('should return same instance for multiple resolves of value binding', () => {
    // Arrange
    interface IConfig {
      value: number
    }
    const token = Token<IConfig>()
    const config = { value: 42 }

    // Act
    container.bindValue(token, config)
    const resolved1 = container.resolve(token)
    const resolved2 = container.resolve(token)

    // Assert
    expect(resolved1).toBe(resolved2)
    expect(resolved1).toBe(config)
  })
})

describe('Container - Factory Binding', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should call factory function on resolve', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const loggerToken = Token<ILogger>()
    let factoryCalled = false

    const factory = () => {
      factoryCalled = true
      return {
        log: (message: string) => console.log(message)
      }
    }

    // Act
    container.bindFactory(loggerToken, factory)
    const resolved = container.resolve(loggerToken)

    // Assert
    expect(factoryCalled).toBe(true)
    expect(resolved).toBeDefined()
    expect(typeof resolved.log).toBe('function')
  })

  it('should pass container to factory for nested resolution', () => {
    // Arrange
    interface IDatabase {
      query(): string
    }
    interface ILogger {
      log(message: string): void
      database: IDatabase
    }

    const dbToken = Token<IDatabase>()
    const loggerToken = Token<ILogger>()

    const database = { query: () => 'result' }

    // Act
    container.bindValue(dbToken, database)
    container.bindFactory(loggerToken, (c) => ({
      log: (msg) => console.log(msg),
      database: c.resolve(dbToken)
    }))

    const logger = container.resolve(loggerToken)

    // Assert
    expect(logger.database).toBe(database)
    expect(logger.database.query()).toBe('result')
  })

  it('should handle async factories with resolveAsync()', async () => {
    // Arrange
    interface IAsyncService {
      getData(): Promise<string>
    }
    const token = Token<IAsyncService>()

    const asyncFactory = async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return {
        getData: async () => 'async-data'
      }
    }

    // Act
    container.bindFactory(token, asyncFactory)
    const resolved = await container.resolveAsync(token)

    // Assert
    expect(resolved).toBeDefined()
    expect(await resolved.getData()).toBe('async-data')
  })

  it('should call factory every time for transient scope', () => {
    // Arrange
    interface IService {
      id: number
    }
    const token = Token<IService>()
    let callCount = 0

    const factory = () => {
      callCount++
      return { id: callCount }
    }

    // Act
    container.bindFactory(token, factory, { lifetime: 'transient' })
    const instance1 = container.resolve(token)
    const instance2 = container.resolve(token)

    // Assert
    expect(callCount).toBe(2)
    expect(instance1.id).toBe(1)
    expect(instance2.id).toBe(2)
    expect(instance1).not.toBe(instance2)
  })
})

describe('Container - Class Binding', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should instantiate class with constructor injection', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }

    class ConsoleLogger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }

    const token = Token<ILogger>()

    // Act
    container.bindClass(token, ConsoleLogger)
    const instance = container.resolve(token)

    // Assert
    expect(instance).toBeInstanceOf(ConsoleLogger)
    expect(typeof instance.log).toBe('function')
  })

  it('should resolve constructor dependencies recursively', () => {
    // Arrange
    interface IDatabase {
      query(): string
    }
    interface ILogger {
      log(message: string): void
    }
    interface IUserService {
      getUser(): string
    }

    class Database implements IDatabase {
      query() { return 'data' }
    }

    class Logger implements ILogger {
      constructor(public database: IDatabase) {}
      log(message: string) { console.log(message) }
    }

    class UserService implements IUserService {
      constructor(public logger: ILogger, public database: IDatabase) {}
      getUser() { return 'user' }
    }

    const dbToken = Token<IDatabase>()
    const loggerToken = Token<ILogger>()
    const userServiceToken = Token<IUserService>()

    // Act
    container.bindClass(dbToken, Database)
    container.bindClass(loggerToken, Logger, {
      dependencies: [dbToken]
    })
    container.bindClass(userServiceToken, UserService, {
      dependencies: [loggerToken, dbToken]
    })

    const userService = container.resolve(userServiceToken)

    // Assert
    expect(userService).toBeInstanceOf(UserService)
    expect(userService.logger).toBeInstanceOf(Logger)
    expect(userService.database).toBeInstanceOf(Database)
    expect(userService.logger.database).toBeInstanceOf(Database)
  })
})

describe('Container - Scopes', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should return same instance for singleton scope', () => {
    // Arrange
    interface IService {
      id: number
    }
    const token = Token<IService>()
    let instanceCount = 0

    const factory = () => {
      instanceCount++
      return { id: instanceCount }
    }

    // Act
    container.bindFactory(token, factory, { lifetime: 'singleton' })
    const instance1 = container.resolve(token)
    const instance2 = container.resolve(token)
    const instance3 = container.resolve(token)

    // Assert
    expect(instanceCount).toBe(1) // Factory called only once
    expect(instance1).toBe(instance2)
    expect(instance2).toBe(instance3)
    expect(instance1.id).toBe(1)
  })

  it('should return new instance for transient scope', () => {
    // Arrange
    interface IService {
      id: number
    }
    const token = Token<IService>()
    let instanceCount = 0

    const factory = () => {
      instanceCount++
      return { id: instanceCount }
    }

    // Act
    container.bindFactory(token, factory, { lifetime: 'transient' })
    const instance1 = container.resolve(token)
    const instance2 = container.resolve(token)
    const instance3 = container.resolve(token)

    // Assert
    expect(instanceCount).toBe(3) // Factory called three times
    expect(instance1).not.toBe(instance2)
    expect(instance2).not.toBe(instance3)
    expect(instance1.id).toBe(1)
    expect(instance2.id).toBe(2)
    expect(instance3.id).toBe(3)
  })

  it('should reuse instance within same resolve tree (per-request)', () => {
    // Arrange
    interface ILogger {
      id: number
    }
    interface IServiceA {
      logger: ILogger
    }
    interface IServiceB {
      logger: ILogger
    }
    interface IApp {
      serviceA: IServiceA
      serviceB: IServiceB
    }

    const loggerToken = Token<ILogger>()
    const serviceAToken = Token<IServiceA>()
    const serviceBToken = Token<IServiceB>()
    const appToken = Token<IApp>()

    let loggerInstanceCount = 0

    // Act
    container.bindFactory(loggerToken, () => {
      loggerInstanceCount++
      return { id: loggerInstanceCount }
    }, { lifetime: 'per-request' })

    container.bindFactory(serviceAToken, (c) => ({
      logger: c.resolve(loggerToken)
    }))

    container.bindFactory(serviceBToken, (c) => ({
      logger: c.resolve(loggerToken)
    }))

    container.bindFactory(appToken, (c) => ({
      serviceA: c.resolve(serviceAToken),
      serviceB: c.resolve(serviceBToken)
    }))

    const app1 = container.resolve(appToken)
    const app2 = container.resolve(appToken)

    // Assert
    // Within same resolve tree (app1), logger should be reused
    expect(app1.serviceA.logger).toBe(app1.serviceB.logger)
    expect(app1.serviceA.logger.id).toBe(1)

    // Different resolve tree (app2) should get new logger instance
    expect(app2.serviceA.logger).toBe(app2.serviceB.logger)
    expect(app2.serviceA.logger.id).toBe(2)
    expect(app1.serviceA.logger).not.toBe(app2.serviceA.logger)

    expect(loggerInstanceCount).toBe(2)
  })
})

describe('Container - Error Handling', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should detect circular dependencies', () => {
    // Arrange
    interface IServiceA {
      name: string
    }
    interface IServiceB {
      name: string
    }

    const tokenA = Token<IServiceA>('ServiceA')
    const tokenB = Token<IServiceB>('ServiceB')

    // ServiceA depends on ServiceB
    container.bindFactory(tokenA, (c) => ({
      name: 'A',
      serviceB: c.resolve(tokenB)
    }))

    // ServiceB depends on ServiceA (circular!)
    container.bindFactory(tokenB, (c) => ({
      name: 'B',
      serviceA: c.resolve(tokenA)
    }))

    // Act & Assert
    expect(() => container.resolve(tokenA)).toThrow()
    expect(() => container.resolve(tokenA)).toThrow(/circular/i)
  })

  it('should throw clear error for missing binding', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    const token = Token<ILogger>('Logger')

    // Act & Assert
    expect(() => container.resolve(token)).toThrow()
    expect(() => container.resolve(token)).toThrow(/Logger/)
    expect(() => container.resolve(token)).toThrow(/not bound|not registered/i)
  })

  it('should provide dependency path in error messages', () => {
    // Arrange
    interface IDatabase {
      query(): string
    }
    interface ILogger {
      log(message: string): void
    }
    interface IUserService {
      getUser(): string
    }

    const dbToken = Token<IDatabase>('Database')
    const loggerToken = Token<ILogger>('Logger')
    const userServiceToken = Token<IUserService>('UserService')

    // Logger depends on Database (not bound)
    container.bindFactory(loggerToken, (c) => ({
      log: (msg) => console.log(msg),
      database: c.resolve(dbToken) // Database not bound!
    }))

    // UserService depends on Logger
    container.bindFactory(userServiceToken, (c) => ({
      getUser: () => 'user',
      logger: c.resolve(loggerToken)
    }))

    // Act & Assert
    expect(() => container.resolve(userServiceToken)).toThrow()

    // Error should show dependency path: UserService -> Logger -> Database
    const error = () => container.resolve(userServiceToken)
    expect(error).toThrow(/UserService/i)
    expect(error).toThrow(/Logger/i)
    expect(error).toThrow(/Database/i)
  })
})

describe('Container - Child Containers', () => {
  let parentContainer: Container

  beforeEach(() => {
    parentContainer = new Container()
  })

  it('should inherit parent bindings', () => {
    // Arrange
    interface IConfig {
      value: string
    }
    const token = Token<IConfig>()
    const config = { value: 'parent-config' }

    parentContainer.bindValue(token, config)

    // Act
    const childContainer = parentContainer.createChild()
    const resolved = childContainer.resolve(token)

    // Assert
    expect(resolved).toBe(config)
    expect(resolved.value).toBe('parent-config')
  })

  it('should allow child to override parent binding', () => {
    // Arrange
    interface IConfig {
      value: string
    }
    const token = Token<IConfig>()
    const parentConfig = { value: 'parent' }
    const childConfig = { value: 'child' }

    parentContainer.bindValue(token, parentConfig)

    // Act
    const childContainer = parentContainer.createChild()
    childContainer.bindValue(token, childConfig)

    const parentResolved = parentContainer.resolve(token)
    const childResolved = childContainer.resolve(token)

    // Assert
    expect(parentResolved.value).toBe('parent')
    expect(childResolved.value).toBe('child')
  })

  it('should maintain separate singleton cache', () => {
    // Arrange
    interface IService {
      id: number
    }
    const token = Token<IService>()
    let instanceCount = 0

    const factory = () => {
      instanceCount++
      return { id: instanceCount }
    }

    parentContainer.bindFactory(token, factory, { lifetime: 'singleton' })

    // Act
    const childContainer = parentContainer.createChild()

    const parentInstance1 = parentContainer.resolve(token)
    const parentInstance2 = parentContainer.resolve(token)

    const childInstance1 = childContainer.resolve(token)
    const childInstance2 = childContainer.resolve(token)

    // Assert
    // Parent should have one singleton
    expect(parentInstance1).toBe(parentInstance2)
    expect(parentInstance1.id).toBe(1)

    // Child should have separate singleton
    expect(childInstance1).toBe(childInstance2)
    expect(childInstance1.id).toBe(2)

    // Parent and child singletons should be different
    expect(parentInstance1).not.toBe(childInstance1)
    expect(instanceCount).toBe(2)
  })
})

describe('Container - Disposal', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should call dispose() on singletons that have dispose method', async () => {
    // Arrange
    interface IService {
      dispose(): void | Promise<void>
    }
    const token = Token<IService>()
    let disposed = false

    const service = {
      dispose: () => {
        disposed = true
      }
    }

    // Act
    container.bindValue(token, service)
    container.resolve(token) // Ensure it's in singleton cache
    await container.dispose()

    // Assert
    expect(disposed).toBe(true)
  })

  it('should dispose in reverse registration order', async () => {
    // Arrange
    interface IService {
      name: string
      dispose(): void
    }

    const token1 = Token<IService>('Service1')
    const token2 = Token<IService>('Service2')
    const token3 = Token<IService>('Service3')

    const disposeOrder: string[] = []

    const service1 = {
      name: 'Service1',
      dispose: () => disposeOrder.push('Service1')
    }

    const service2 = {
      name: 'Service2',
      dispose: () => disposeOrder.push('Service2')
    }

    const service3 = {
      name: 'Service3',
      dispose: () => disposeOrder.push('Service3')
    }

    // Act
    container.bindValue(token1, service1)
    container.bindValue(token2, service2)
    container.bindValue(token3, service3)

    container.resolve(token1)
    container.resolve(token2)
    container.resolve(token3)

    await container.dispose()

    // Assert
    expect(disposeOrder).toEqual(['Service3', 'Service2', 'Service1'])
  })

  it('should handle errors during disposal', async () => {
    // Arrange
    interface IService {
      name: string
      dispose(): void
    }

    const token1 = Token<IService>('Service1')
    const token2 = Token<IService>('Service2')

    const disposed: string[] = []

    const service1 = {
      name: 'Service1',
      dispose: () => {
        disposed.push('Service1')
        throw new Error('Disposal error')
      }
    }

    const service2 = {
      name: 'Service2',
      dispose: () => disposed.push('Service2')
    }

    // Act
    container.bindValue(token1, service1)
    container.bindValue(token2, service2)

    container.resolve(token1)
    container.resolve(token2)

    // Assert
    // Should not throw, but should continue disposing other services
    await expect(container.dispose()).resolves.not.toThrow()

    // Both should have been attempted
    expect(disposed).toContain('Service1')
    expect(disposed).toContain('Service2')
  })

  it('should handle async dispose methods', async () => {
    // Arrange
    interface IAsyncService {
      dispose(): Promise<void>
    }
    const token = Token<IAsyncService>()
    let disposed = false

    const service = {
      dispose: async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        disposed = true
      }
    }

    // Act
    container.bindValue(token, service)
    container.resolve(token)
    await container.dispose()

    // Assert
    expect(disposed).toBe(true)
  })
})
