/**
 * Performance comparison: mapResolvers vs positions vs map strategies
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'

describe('AutoWire Performance Comparison', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should benchmark mapResolvers array (O(1) array access)', () => {
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
      query() { return [] }
    }
    class Cache implements ICache {
      get(key: string) { return null }
    }

    class Service {
      constructor(
        public logger: ILogger,
        public database: IDatabase,
        public cache: ICache
      ) {}
    }

    const builder = container.builder()
    builder.registerType(Logger).as<ILogger>('ILogger')
    builder.registerType(Database).as<IDatabase>('IDatabase')
    builder.registerType(Cache).as<ICache>('ICache')
    builder
      .registerType(Service)
      .as<Service>('Service')
      .autoWire({
        mapResolvers: [
          (c) => c.resolveType<ILogger>('ILogger'),
          (c) => c.resolveType<IDatabase>('IDatabase'),
          (c) => c.resolveType<ICache>('ICache')
        ]
      })

    const builtContainer = builder.build()

    const iterations = 10000
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      builtContainer.resolveType<Service>('Service')
    }
    const elapsed = performance.now() - start

    console.log(`mapResolvers (array): ${iterations} resolutions in ${elapsed.toFixed(2)}ms (${(elapsed / iterations * 1000).toFixed(3)}μs per resolve)`)

    expect(elapsed).toBeLessThan(100) // Should be very fast
  })

  it('should benchmark map object (O(1) hash lookup)', () => {
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
      query() { return [] }
    }
    class Cache implements ICache {
      get(key: string) { return null }
    }

    class Service {
      constructor(
        public logger: ILogger,
        public database: IDatabase,
        public cache: ICache
      ) {}
    }

    const builder = container.builder()
    builder.registerType(Logger).as<ILogger>('ILogger')
    builder.registerType(Database).as<IDatabase>('IDatabase')
    builder.registerType(Cache).as<ICache>('ICache')
    builder
      .registerType(Service)
      .as<Service>('Service')
      .autoWire({
        map: {
          logger: (c) => c.resolveType<ILogger>('ILogger'),
          database: (c) => c.resolveType<IDatabase>('IDatabase'),
          cache: (c) => c.resolveType<ICache>('ICache')
        }
      })

    const builtContainer = builder.build()

    const iterations = 10000
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      builtContainer.resolveType<Service>('Service')
    }
    const elapsed = performance.now() - start

    console.log(`map (object lookup): ${iterations} resolutions in ${elapsed.toFixed(2)}ms (${(elapsed / iterations * 1000).toFixed(3)}μs per resolve)`)

    expect(elapsed).toBeLessThan(150)
  })

  it('should demonstrate performance with larger dependency graphs', () => {
    // Create 10 different interfaces
    const interfaces: any[] = []
    const classes: any[] = []

    for (let i = 0; i < 10; i++) {
      const iface = { name: `IService${i}` }
      interfaces.push(iface)

      class DynamicService {
        doWork() { return i }
      }
      classes.push(DynamicService)
    }

    // Register all services
    const builder = container.builder()
    for (let i = 0; i < 10; i++) {
      builder.registerType(classes[i]).as<any>(`IService${i}`)
    }

    // Service with 10 dependencies - test mapResolvers
    class LargeService {
      constructor(
        public s0: any,
        public s1: any,
        public s2: any,
        public s3: any,
        public s4: any,
        public s5: any,
        public s6: any,
        public s7: any,
        public s8: any,
        public s9: any
      ) {}
    }

    const mapResolvers = []
    for (let i = 0; i < 10; i++) {
      mapResolvers.push((c: Container) => c.resolveType<any>(`IService${i}`))
    }

    builder
      .registerType(LargeService)
      .as<LargeService>('LargeService')
      .autoWire({ mapResolvers })

    const builtContainer = builder.build()

    const iterations = 5000
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      const service = builtContainer.resolveType<LargeService>('LargeService')
      expect(service.s0).toBeDefined()
    }
    const elapsed = performance.now() - start

    console.log(`Large graph (10 deps): ${iterations} resolutions in ${elapsed.toFixed(2)}ms (${(elapsed / iterations * 1000).toFixed(3)}μs per resolve)`)

    expect(elapsed).toBeLessThan(300)
  })
})
