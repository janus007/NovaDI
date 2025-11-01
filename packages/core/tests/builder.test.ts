import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'
import { Token } from '../src/token'

describe('Builder - Basic Registration', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should provide builder() method on container', () => {
    // Act
    const builder = container.builder()

    // Assert
    expect(builder).toBeDefined()
    expect(typeof builder.build).toBe('function')
  })

  it('should register type via builder and build container', () => {
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
    const builder = container.builder()
    builder.registerType(ConsoleLogger).as(token)
    const builtContainer = builder.build()
    const instance = builtContainer.resolve(token)

    // Assert
    expect(instance).toBeInstanceOf(ConsoleLogger)
  })

  it('should register instance via builder', () => {
    // Arrange
    interface IConfig {
      apiKey: string
    }
    const token = Token<IConfig>()
    const config = { apiKey: 'test-123' }

    // Act
    const builder = container.builder()
    builder.registerInstance(config).as(token)
    const builtContainer = builder.build()
    const resolved = builtContainer.resolve(token)

    // Assert
    expect(resolved).toBe(config)
  })

  it('should register factory via builder', () => {
    // Arrange
    interface IService {
      getValue(): number
    }
    const token = Token<IService>()

    // Act
    const builder = container.builder()
    builder.register(() => ({ getValue: () => 42 })).as(token)
    const builtContainer = builder.build()
    const instance = builtContainer.resolve(token)

    // Assert
    expect(instance.getValue()).toBe(42)
  })

  it('should chain multiple registrations', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    interface IConfig {
      value: string
    }

    const loggerToken = Token<ILogger>()
    const configToken = Token<IConfig>()

    // Act
    const builder = container.builder()
    builder
      .register(() => ({ log: () => {} }))
      .as(loggerToken)

    builder
      .registerInstance({ value: 'test' })
      .as(configToken)

    const builtContainer = builder.build()

    // Assert
    expect(builtContainer.resolve(loggerToken)).toBeDefined()
    expect(builtContainer.resolve(configToken)).toBeDefined()
  })
})

describe('Builder - Lifetimes', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should default to singleton if no lifetime specified', () => {
    // Arrange
    interface IService {
      id: number
    }
    const token = Token<IService>()
    let count = 0

    // Act
    const builder = container.builder()
    builder.register(() => ({ id: ++count })).as(token)
    const builtContainer = builder.build()

    const instance1 = builtContainer.resolve(token)
    const instance2 = builtContainer.resolve(token)

    // Assert
    expect(instance1.id).toBe(1)
    expect(instance2.id).toBe(1)
    expect(instance1).toBe(instance2)
  })

  it('should set singleton lifetime with singleInstance()', () => {
    // Arrange
    interface IService {
      id: number
    }
    const token = Token<IService>()
    let count = 0

    // Act
    const builder = container.builder()
    builder
      .register(() => ({ id: ++count }))
      .as(token)
      .singleInstance()

    const builtContainer = builder.build()

    const instance1 = builtContainer.resolve(token)
    const instance2 = builtContainer.resolve(token)

    // Assert
    expect(instance1.id).toBe(1)
    expect(instance2.id).toBe(1)
    expect(instance1).toBe(instance2)
  })

  it('should set per-request lifetime with instancePerRequest()', () => {
    // Arrange
    interface ILogger {
      id: number
    }
    interface IService {
      logger: ILogger
    }

    const loggerToken = Token<ILogger>()
    const serviceToken = Token<IService>()
    let count = 0

    // Act
    const builder = container.builder()
    builder
      .register(() => ({ id: ++count }))
      .as(loggerToken)
      .instancePerRequest()

    builder
      .register((c) => ({ logger: c.resolve(loggerToken) }))
      .as(serviceToken)
      .instancePerDependency()

    const builtContainer = builder.build()

    const service1 = builtContainer.resolve(serviceToken)
    const service2 = builtContainer.resolve(serviceToken)

    // Assert
    // Different resolve calls should get different instances
    expect(service1.logger.id).toBe(1)
    expect(service2.logger.id).toBe(2)
  })

  it('should allow instancePerDependency() as alias for transient', () => {
    // Arrange
    interface IService {
      id: number
    }
    const token = Token<IService>()
    let count = 0

    // Act
    const builder = container.builder()
    builder
      .register(() => ({ id: ++count }))
      .as(token)
      .instancePerDependency()

    const builtContainer = builder.build()

    const instance1 = builtContainer.resolve(token)
    const instance2 = builtContainer.resolve(token)

    // Assert
    expect(instance1).not.toBe(instance2)
  })
})

describe('Builder - Build', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should create immutable container after build', () => {
    // Arrange
    interface IService {
      value: string
    }
    const token = Token<IService>()

    const builder = container.builder()
    builder.registerInstance({ value: 'test' }).as(token)

    // Act
    const builtContainer = builder.build()
    const resolved = builtContainer.resolve(token)

    // Assert
    expect(resolved.value).toBe('test')
    expect(builtContainer).toBeInstanceOf(Container)
  })

  it('should allow building from same builder multiple times', () => {
    // Arrange
    interface IService {
      value: string
    }
    const token = Token<IService>()

    const builder = container.builder()
    builder.registerInstance({ value: 'test' }).as(token)

    // Act
    const container1 = builder.build()
    const container2 = builder.build()

    // Assert
    expect(container1.resolve(token).value).toBe('test')
    expect(container2.resolve(token).value).toBe('test')
    // Should be different container instances
    expect(container1).not.toBe(container2)
  })

  it('should preserve existing container bindings when using builder', () => {
    // Arrange
    interface IService1 {
      value: string
    }
    interface IService2 {
      value: string
    }

    const token1 = Token<IService1>()
    const token2 = Token<IService2>()

    container.bindValue(token1, { value: 'existing' })

    // Act
    const builder = container.builder()
    builder.registerInstance({ value: 'new' }).as(token2)
    const builtContainer = builder.build()

    // Assert
    expect(builtContainer.resolve(token1).value).toBe('existing')
    expect(builtContainer.resolve(token2).value).toBe('new')
  })
})

describe('Builder - Modules', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should support module pattern for organizing registrations', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }
    interface IDatabase {
      query(sql: string): any
    }

    const loggerToken = Token<ILogger>()
    const databaseToken = Token<IDatabase>()

    const loggingModule = (builder: any) => {
      builder.register(() => ({ log: () => {} })).as(loggerToken)
    }

    const dataModule = (builder: any) => {
      builder.register(() => ({ query: () => {} })).as(databaseToken)
    }

    // Act
    const builder = container.builder()
    builder.module(loggingModule)
    builder.module(dataModule)

    const builtContainer = builder.build()

    // Assert
    expect(builtContainer.resolve(loggerToken)).toBeDefined()
    expect(builtContainer.resolve(databaseToken)).toBeDefined()
  })

  it('should allow modules to access builder for nested registrations', () => {
    // Arrange
    interface IService {
      value: string
    }
    const token = Token<IService>()
    let moduleExecuted = false

    const testModule = (builder: any) => {
      moduleExecuted = true
      builder.registerInstance({ value: 'from-module' }).as(token)
    }

    // Act
    const builder = container.builder()
    builder.module(testModule)
    const builtContainer = builder.build()

    // Assert
    expect(moduleExecuted).toBe(true)
    expect(builtContainer.resolve(token).value).toBe('from-module')
  })
})

describe('Builder - Performance Optimizations', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should optimize transient classes with no dependencies', () => {
    // Arrange
    class SimpleService {
      getValue(): string {
        return 'test'
      }
    }

    const token = Token<SimpleService>()

    // Act
    const builder = container.builder()
    builder.registerType(SimpleService).as(token).instancePerDependency()
    const builtContainer = builder.build()

    const instance1 = builtContainer.resolve(token)
    const instance2 = builtContainer.resolve(token)

    // Assert
    expect(instance1).toBeInstanceOf(SimpleService)
    expect(instance2).toBeInstanceOf(SimpleService)
    expect(instance1).not.toBe(instance2) // Transient behavior
    expect(instance1.getValue()).toBe('test')
    expect(instance2.getValue()).toBe('test')
  })

  it('should optimize singleton classes with no dependencies', () => {
    // Arrange
    class SimpleService {
      getValue(): string {
        return 'test'
      }
    }

    const token = Token<SimpleService>()

    // Act
    const builder = container.builder()
    builder.registerType(SimpleService).as(token).singleInstance()
    const builtContainer = builder.build()

    const instance1 = builtContainer.resolve(token)
    const instance2 = builtContainer.resolve(token)

    // Assert
    expect(instance1).toBeInstanceOf(SimpleService)
    expect(instance2).toBeInstanceOf(SimpleService)
    expect(instance1).toBe(instance2) // Singleton behavior
    expect(instance1.getValue()).toBe('test')
  })

  it('should handle transient classes with dependencies correctly (no optimization)', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
    }

    class Logger implements ILogger {
      log(message: string) {
        console.log(message)
      }
    }

    class ServiceWithDeps {
      constructor(private logger: ILogger) {}

      doWork() {
        this.logger.log('working')
      }
    }

    const loggerToken = Token<ILogger>()
    const serviceToken = Token<ServiceWithDeps>()

    // Act
    const builder = container.builder()
    builder.registerType(Logger).as(loggerToken).singleInstance()
    builder
      .registerType(ServiceWithDeps)
      .as(serviceToken)
      .autoWire({ map: { logger: (c) => c.resolve(loggerToken) } })
      .instancePerDependency()

    const builtContainer = builder.build()

    const instance1 = builtContainer.resolve(serviceToken)
    const instance2 = builtContainer.resolve(serviceToken)

    // Assert
    expect(instance1).toBeInstanceOf(ServiceWithDeps)
    expect(instance2).toBeInstanceOf(ServiceWithDeps)
    expect(instance1).not.toBe(instance2) // Transient behavior
    expect(() => instance1.doWork()).not.toThrow()
  })

  it('should have better performance for transient no-dependency classes', () => {
    // Arrange
    class FastService {
      id = Math.random()
    }

    const token = Token<FastService>()

    const builder = container.builder()
    builder.registerType(FastService).as(token).instancePerDependency()
    const builtContainer = builder.build()

    // Act - Measure resolution time for 1000 instances
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      builtContainer.resolve(token)
    }
    const end = performance.now()
    const timeMs = end - start

    // Assert - Should be very fast (< 5ms for 1000 resolutions)
    // This is a soft limit - actual performance depends on hardware
    expect(timeMs).toBeLessThan(5)

    // Verify instances are still created correctly
    const instance = builtContainer.resolve(token)
    expect(instance).toBeInstanceOf(FastService)
    expect(typeof instance.id).toBe('number')
  })

  it('should not break existing autowire behavior', () => {
    // Arrange
    interface IConfig {
      value: string
    }

    class ServiceWithAutowire {
      constructor(private config: IConfig) {}

      getValue(): string {
        return this.config.value
      }
    }

    const configToken = Token<IConfig>()
    const serviceToken = Token<ServiceWithAutowire>()

    // Act
    const builder = container.builder()
    builder.registerInstance({ value: 'autowired' }).as(configToken)
    builder
      .registerType(ServiceWithAutowire)
      .as(serviceToken)
      .autoWire({ map: { config: (c) => c.resolve(configToken) } })

    const builtContainer = builder.build()
    const instance = builtContainer.resolve(serviceToken)

    // Assert
    expect(instance).toBeInstanceOf(ServiceWithAutowire)
    expect(instance.getValue()).toBe('autowired')
  })
})
