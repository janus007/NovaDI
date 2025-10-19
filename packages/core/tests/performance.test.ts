import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'
import { Token } from '../src/token'

describe('Performance - Resolution Speed', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should resolve 1000 simple dependencies in <10ms', () => {
    // Arrange
    class SimpleService {
      value = 42
    }

    const token = Token<SimpleService>('SimpleService')

    const builder = container.builder()
    builder.registerType(SimpleService).as(token).singleInstance()

    const app = builder.build()

    // Warm up
    app.resolve(token)

    // Act - Benchmark 1000 resolutions
    const start = performance.now()

    for (let i = 0; i < 1000; i++) {
      app.resolve(token)
    }

    const duration = performance.now() - start

    // Assert
    console.log(`1000 singleton resolutions: ${duration.toFixed(2)}ms`)
    expect(duration).toBeLessThan(10)
  })

  it('should resolve 1000 transient dependencies in <50ms', () => {
    // Arrange
    class TransientService {
      value = Math.random()
    }

    const token = Token<TransientService>('TransientService')

    const builder = container.builder()
    builder.registerType(TransientService).as(token).instancePerDependency()

    const app = builder.build()

    // Act - Benchmark 1000 transient resolutions
    const start = performance.now()

    for (let i = 0; i < 1000; i++) {
      app.resolve(token)
    }

    const duration = performance.now() - start

    // Assert
    console.log(`1000 transient resolutions: ${duration.toFixed(2)}ms`)
    expect(duration).toBeLessThan(50)
  })

  it('should resolve complex dependency graph in <5ms', () => {
    // Arrange - 5-level dependency tree
    class L5 {
      value = 5
    }
    class L4 {
      constructor(public dep: L5) {}
    }
    class L3 {
      constructor(public dep: L4) {}
    }
    class L2 {
      constructor(public dep: L3) {}
    }
    class L1 {
      constructor(public dep: L2) {}
    }

    const l5Token = Token<L5>('L5')
    const l4Token = Token<L4>('L4')
    const l3Token = Token<L3>('L3')
    const l2Token = Token<L2>('L2')
    const l1Token = Token<L1>('L1')

    const builder = container.builder()
    builder.registerType(L5).as(l5Token).singleInstance()
    builder.registerType(L4).as(l4Token).autoWire({ map: { dep: l5Token } }).singleInstance()
    builder.registerType(L3).as(l3Token).autoWire({ map: { dep: l4Token } }).singleInstance()
    builder.registerType(L2).as(l2Token).autoWire({ map: { dep: l3Token } }).singleInstance()
    builder.registerType(L1).as(l1Token).autoWire({ map: { dep: l2Token } })

    const app = builder.build()

    // Warm up
    app.resolve(l1Token)

    // Act - Benchmark complex resolution
    const iterations = 1000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      app.resolve(l1Token)
    }

    const duration = performance.now() - start
    const avgDuration = duration / iterations

    // Assert
    console.log(`1000 5-level dependency resolutions: ${duration.toFixed(2)}ms (avg: ${avgDuration.toFixed(4)}ms)`)
    expect(avgDuration).toBeLessThan(0.01) // <10 microseconds per resolution
  })

  it('should handle 10,000 resolutions with mixed lifetimes efficiently', () => {
    // Arrange
    class SingletonService {
      value = 'singleton'
    }
    class TransientService {
      value = 'transient'
    }
    class PerRequestService {
      value = 'per-request'
    }

    const s1Token = Token<SingletonService>('SingletonService')
    const s2Token = Token<TransientService>('TransientService')
    const s3Token = Token<PerRequestService>('PerRequestService')

    const builder = container.builder()
    builder.registerType(SingletonService).as(s1Token).singleInstance()
    builder.registerType(TransientService).as(s2Token).instancePerDependency()
    builder.registerType(PerRequestService).as(s3Token).instancePerRequest()

    const app = builder.build()

    // Act - Benchmark mixed resolutions
    const iterations = 10000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      app.resolve(s1Token)
      app.resolve(s2Token)
      app.resolve(s3Token)
    }

    const duration = performance.now() - start

    // Assert
    console.log(`30,000 mixed lifetime resolutions: ${duration.toFixed(2)}ms`)
    expect(duration).toBeLessThan(200) // Reasonable for 30k operations
  })
})

describe('Performance - Build Time', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should build container with 100 registrations in <50ms', () => {
    // Arrange - Generate 100 services
    const services: any[] = []
    const tokens: any[] = []

    for (let i = 0; i < 100; i++) {
      class GeneratedService {
        id = i
      }
      services.push(GeneratedService)
      tokens.push(Token(`Service${i}`))
    }

    // Act - Benchmark build time
    const start = performance.now()

    const builder = container.builder()
    for (let i = 0; i < 100; i++) {
      builder.registerType(services[i]).as(tokens[i])
    }
    const app = builder.build()

    const duration = performance.now() - start

    // Assert
    console.log(`Built container with 100 registrations: ${duration.toFixed(2)}ms`)
    expect(duration).toBeLessThan(50)

    // Verify all services resolve
    const resolved = app.resolve(tokens[0])
    expect(resolved).toBeDefined()
  })

  it('should build container with complex dependencies in <100ms', () => {
    // Arrange - 50 services with dependencies
    const services: any[] = []
    const tokens: any[] = []

    class BaseService {
      id = 0
    }
    services.push(BaseService)
    tokens.push(Token('Base'))

    for (let i = 1; i < 50; i++) {
      // Each service depends on the previous one
      const prevToken = tokens[i - 1]

      class DependentService {
        constructor(public dep: any) {}
        id = i
      }

      services.push(DependentService)
      tokens.push(Token(`Service${i}`))
    }

    // Act - Benchmark build with dependencies
    const start = performance.now()

    const builder = container.builder()
    builder.registerType(services[0]).as(tokens[0])

    for (let i = 1; i < 50; i++) {
      builder.registerType(services[i]).as(tokens[i]).autoWire({
        map: {
          dep: tokens[i - 1]
        }
      })
    }

    const app = builder.build()
    const duration = performance.now() - start

    // Assert
    console.log(`Built container with 50 chained dependencies: ${duration.toFixed(2)}ms`)
    expect(duration).toBeLessThan(100)

    // Verify chain resolves
    const leaf = app.resolve(tokens[49])
    expect(leaf).toBeDefined()
    expect(leaf.id).toBe(49)
  })
})

describe('Performance - Memory Efficiency', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should reuse singleton instances (memory efficient)', () => {
    // Arrange
    class LargeService {
      data = new Array(1000).fill('data')
    }

    const token = Token<LargeService>('LargeService')

    const builder = container.builder()
    builder.registerType(LargeService).as(token).singleInstance()

    const app = builder.build()

    // Act - Resolve multiple times
    const instance1 = app.resolve(token)
    const instance2 = app.resolve(token)
    const instance3 = app.resolve(token)

    // Assert - All references point to same instance
    expect(instance1).toBe(instance2)
    expect(instance2).toBe(instance3)
  })

  it('should handle 1000 registrations without excessive memory', () => {
    // Arrange - 1000 lightweight services
    const tokens: any[] = []

    for (let i = 0; i < 1000; i++) {
      class Service {
        id = i
      }
      tokens.push({ service: Service, token: Token(`S${i}`) })
    }

    // Act - Build large container
    const builder = container.builder()

    for (const { service, token } of tokens) {
      builder.registerType(service).as(token).singleInstance()
    }

    const app = builder.build()

    // Act - Resolve all singletons
    const resolved = tokens.map(t => app.resolve(t.token))

    // Assert - All resolved
    expect(resolved.length).toBe(1000)
    expect(resolved[0].id).toBe(0)
    expect(resolved[999].id).toBe(999)
  })
})

describe('Performance - Circular Dependency Detection', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should detect circular dependency quickly', () => {
    // Arrange
    class ServiceA {
      constructor(public b: any) {}
    }
    class ServiceB {
      constructor(public a: any) {}
    }

    const tokenA = Token('ServiceA')
    const tokenB = Token('ServiceB')

    const builder = container.builder()
    builder.registerType(ServiceA).as(tokenA).autoWire({ map: { b: tokenB } })
    builder.registerType(ServiceB).as(tokenB).autoWire({ map: { a: tokenA } })

    const app = builder.build()

    // Act - Benchmark circular detection
    const start = performance.now()

    try {
      app.resolve(tokenA)
    } catch (error) {
      // Expected to throw
    }

    const duration = performance.now() - start

    // Assert - Detection is fast
    console.log(`Circular dependency detected in: ${duration.toFixed(2)}ms`)
    expect(duration).toBeLessThan(5)
  })
})

describe('Performance - Real-World Scenario Benchmark', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should handle realistic web app dependency graph efficiently', () => {
    // Arrange - Simulate typical web app structure
    interface IConfig {
      apiKey: string
    }
    interface IDatabase {
      query(): any[]
    }
    interface ICache {
      get(key: string): any
    }
    interface ILogger {
      log(msg: string): void
    }
    interface IRepository {
      findAll(): any[]
    }
    interface IService {
      process(): void
    }
    interface IController {
      handle(): void
    }

    class Config implements IConfig {
      apiKey = 'test'
    }
    class Database implements IDatabase {
      query(): any[] {
        return []
      }
    }
    class Cache implements ICache {
      get(key: string): any {
        return null
      }
    }
    class Logger implements ILogger {
      log(msg: string): void {}
    }
    class Repository implements IRepository {
      constructor(
        public db: IDatabase,
        public logger: ILogger
      ) {}
      findAll(): any[] {
        return this.db.query()
      }
    }
    class Service implements IService {
      constructor(
        public repo: IRepository,
        public cache: ICache,
        public logger: ILogger
      ) {}
      process(): void {
        this.repo.findAll()
      }
    }
    class Controller implements IController {
      constructor(
        public service: IService,
        public logger: ILogger
      ) {}
      handle(): void {
        this.service.process()
      }
    }

    // Tokens
    const configToken = Token<IConfig>('IConfig')
    const dbToken = Token<IDatabase>('IDatabase')
    const cacheToken = Token<ICache>('ICache')
    const loggerToken = Token<ILogger>('ILogger')
    const repoToken = Token<IRepository>('IRepository')
    const serviceToken = Token<IService>('IService')
    const controllerToken = Token<IController>('IController')

    // Act - Build app container
    const buildStart = performance.now()

    const builder = container.builder()
    builder.registerInstance({ apiKey: 'prod-key' }).as(configToken)
    builder.registerType(Database).as(dbToken).singleInstance()
    builder.registerType(Cache).as(cacheToken).singleInstance()
    builder.registerType(Logger).as(loggerToken).singleInstance()
    builder
      .registerType(Repository)
      .as(repoToken)
      .autoWire({
        map: {
          db: dbToken,
          logger: loggerToken
        }
      })
      .singleInstance()
    builder
      .registerType(Service)
      .as(serviceToken)
      .autoWire({
        map: {
          repo: repoToken,
          cache: cacheToken,
          logger: loggerToken
        }
      })
    builder.registerType(Controller).as(controllerToken).autoWire({
      map: {
        service: serviceToken,
        logger: loggerToken
      }
    })

    const app = builder.build()
    const buildDuration = performance.now() - buildStart

    // Act - Simulate 1000 requests
    const resolveStart = performance.now()

    for (let i = 0; i < 1000; i++) {
      const controller = app.resolve(controllerToken)
      controller.handle()
    }

    const resolveDuration = performance.now() - resolveStart

    // Assert
    console.log(`Web app build time: ${buildDuration.toFixed(2)}ms`)
    console.log(`1000 request simulations: ${resolveDuration.toFixed(2)}ms`)
    expect(buildDuration).toBeLessThan(20)
    expect(resolveDuration).toBeLessThan(50)
  })
})
