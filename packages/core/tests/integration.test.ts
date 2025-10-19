import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'
import { Token } from '../src/token'
import type { Module } from '../src/builder'

describe('Integration - Real Application Architecture', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should build multi-layer application with dependencies', () => {
    // Arrange - Domain Models
    interface User {
      id: number
      name: string
      email: string
    }

    interface IDatabase {
      query(sql: string): any[]
      execute(sql: string): void
    }

    interface ILogger {
      log(message: string): void
      error(message: string, error?: Error): void
    }

    interface IUserRepository {
      findById(id: number): User | null
      save(user: User): void
    }

    interface IUserService {
      getUser(id: number): User | null
      createUser(name: string, email: string): User
    }

    interface IUserController {
      handleGetUser(id: number): { status: number; data?: User; error?: string }
    }

    // Arrange - Infrastructure
    class InMemoryDatabase implements IDatabase {
      private data: Map<string, any[]> = new Map()

      query(sql: string): any[] {
        return this.data.get(sql) || []
      }

      execute(sql: string): void {
        // Simplified execution
      }
    }

    class ConsoleLogger implements ILogger {
      private logs: string[] = []

      log(message: string): void {
        this.logs.push(`[LOG] ${message}`)
      }

      error(message: string, error?: Error): void {
        this.logs.push(`[ERROR] ${message}`)
      }

      getLogs(): string[] {
        return this.logs
      }
    }

    // Arrange - Repository Layer
    class UserRepository implements IUserRepository {
      private users: Map<number, User> = new Map()

      constructor(
        private db: IDatabase,
        private logger: ILogger
      ) {}

      findById(id: number): User | null {
        this.logger.log(`Finding user ${id}`)
        return this.users.get(id) || null
      }

      save(user: User): void {
        this.logger.log(`Saving user ${user.id}`)
        this.users.set(user.id, user)
      }
    }

    // Arrange - Service Layer
    class UserService implements IUserService {
      private nextId = 1

      constructor(
        private repository: IUserRepository,
        private logger: ILogger
      ) {}

      getUser(id: number): User | null {
        this.logger.log(`Getting user ${id}`)
        return this.repository.findById(id)
      }

      createUser(name: string, email: string): User {
        const user: User = {
          id: this.nextId++,
          name,
          email
        }
        this.logger.log(`Creating user: ${name}`)
        this.repository.save(user)
        return user
      }
    }

    // Arrange - Controller Layer
    class UserController implements IUserController {
      constructor(
        private service: IUserService,
        private logger: ILogger
      ) {}

      handleGetUser(id: number): { status: number; data?: User; error?: string } {
        try {
          const user = this.service.getUser(id)
          if (!user) {
            return { status: 404, error: 'User not found' }
          }
          return { status: 200, data: user }
        } catch (error) {
          this.logger.error('Error getting user', error as Error)
          return { status: 500, error: 'Internal server error' }
        }
      }
    }

    // Arrange - Tokens
    const dbToken = Token<IDatabase>('IDatabase')
    const loggerToken = Token<ILogger>('ILogger')
    const repoToken = Token<IUserRepository>('IUserRepository')
    const serviceToken = Token<IUserService>('IUserService')
    const controllerToken = Token<IUserController>('IUserController')

    // Act - Build Container
    const builder = container.builder()

    // Infrastructure (singletons)
    builder.registerType(InMemoryDatabase).as(dbToken).singleInstance()
    builder.registerType(ConsoleLogger).as(loggerToken).singleInstance()

    // Repository (singleton, autowired)
    builder
      .registerType(UserRepository)
      .as(repoToken)
      .autoWire({
        map: {
          db: dbToken,
          logger: loggerToken
        }
      })
      .singleInstance()

    // Service (singleton, autowired)
    builder
      .registerType(UserService)
      .as(serviceToken)
      .autoWire({
        map: {
          repository: repoToken,
          logger: loggerToken
        }
      })
      .singleInstance()

    // Controller (transient per request)
    builder
      .registerType(UserController)
      .as(controllerToken)
      .autoWire({
        map: {
          service2: serviceToken,  // Note: TypeScript compiles 'private service' to parameter 'service2'
          logger: loggerToken
        }
      })
      .instancePerDependency()

    const app = builder.build()

    // Act - Simulate Application Flow
    const controller = app.resolve(controllerToken)
    const service = app.resolve(serviceToken)

    // Create user through service
    const newUser = service.createUser('Alice', 'alice@example.com')

    // Get user through controller
    const response = controller.handleGetUser(newUser.id)

    // Assert - Verify Full Stack Works
    expect(response.status).toBe(200)
    expect(response.data).toBeDefined()
    expect(response.data?.name).toBe('Alice')
    expect(response.data?.email).toBe('alice@example.com')

    // Assert - Verify Singleton Behavior
    const logger1 = app.resolve(loggerToken) as ConsoleLogger
    const logger2 = app.resolve(loggerToken) as ConsoleLogger
    expect(logger1).toBe(logger2) // Same singleton instance

    // Assert - Verify Logs Were Created
    const logs = logger1.getLogs()
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.some(log => log.includes('Creating user: Alice'))).toBe(true)
  })
})

describe('Integration - Multiple Implementations', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should handle multiple logger implementations with keyed resolution', () => {
    // Arrange
    interface ILogger {
      log(message: string): void
      getType(): string
    }

    class ConsoleLogger implements ILogger {
      log(message: string): void {
        console.log(message)
      }
      getType(): string {
        return 'console'
      }
    }

    class FileLogger implements ILogger {
      log(message: string): void {
        // Simulate file writing
      }
      getType(): string {
        return 'file'
      }
    }

    class DatabaseLogger implements ILogger {
      log(message: string): void {
        // Simulate database writing
      }
      getType(): string {
        return 'database'
      }
    }

    class NotificationService {
      constructor(public logger: ILogger) {}

      notify(message: string): void {
        this.logger.log(`Notification: ${message}`)
      }
    }

    const loggerToken = Token<ILogger>('ILogger')
    const serviceToken = Token<NotificationService>('NotificationService')

    // Act - Register Multiple Implementations
    const builder = container.builder()

    // Console logger is default
    builder.registerType(ConsoleLogger).as(loggerToken)

    // File logger with key
    builder.registerType(FileLogger).as(loggerToken).keyed('file')

    // Database logger with key
    builder.registerType(DatabaseLogger).as(loggerToken).keyed('db')

    // Service uses default logger
    builder
      .registerType(NotificationService)
      .as(serviceToken)
      .autoWire({
        map: {
          logger: loggerToken
        }
      })

    const app = builder.build()

    // Assert - Resolve Default
    const defaultLogger = app.resolve(loggerToken)
    expect(defaultLogger.getType()).toBe('console')

    // Assert - Resolve Keyed
    const fileLogger = app.resolveKeyed<ILogger>('file')
    expect(fileLogger.getType()).toBe('file')

    const dbLogger = app.resolveKeyed<ILogger>('db')
    expect(dbLogger.getType()).toBe('database')

    // Assert - ResolveAll Gets Only Non-Keyed Registrations
    // Note: Keyed registrations are intentionally separate from resolveAll
    const allLoggers = app.resolveAll(loggerToken)
    expect(allLoggers.length).toBe(1) // Only the default (non-keyed) logger
    expect(allLoggers[0].getType()).toBe('console')

    // Assert - Service Uses Default Logger
    const service = app.resolve(serviceToken)
    expect(service.logger.getType()).toBe('console')
  })

  it('should support plugin pattern with resolveAll', () => {
    // Arrange
    interface IPlugin {
      name: string
      execute(): string
    }

    class ValidationPlugin implements IPlugin {
      name = 'validation'
      execute(): string {
        return 'validated'
      }
    }

    class AuthPlugin implements IPlugin {
      name = 'auth'
      execute(): string {
        return 'authenticated'
      }
    }

    class LoggingPlugin implements IPlugin {
      name = 'logging'
      execute(): string {
        return 'logged'
      }
    }

    class PluginManager {
      constructor(public plugins: IPlugin[]) {}

      executeAll(): string[] {
        return this.plugins.map(p => p.execute())
      }
    }

    const pluginToken = Token<IPlugin>('IPlugin')
    const managerToken = Token<PluginManager>('PluginManager')

    // Act
    const builder = container.builder()

    // Register multiple plugins
    builder.registerType(ValidationPlugin).as(pluginToken)
    builder.registerType(AuthPlugin).as(pluginToken)
    builder.registerType(LoggingPlugin).as(pluginToken)

    // Register manager with all plugins
    builder
      .register<PluginManager>((c) => {
        const plugins = c.resolveAll(pluginToken)
        return new PluginManager(plugins)
      })
      .as(managerToken)

    const app = builder.build()
    const manager = app.resolve(managerToken)

    // Assert
    expect(manager.plugins.length).toBe(3)
    const results = manager.executeAll()
    expect(results).toEqual(['validated', 'authenticated', 'logged'])
  })
})

describe('Integration - Scoped Container (Per-Request)', () => {
  let rootContainer: Container

  beforeEach(() => {
    rootContainer = new Container()
  })

  it('should create isolated scope per request', () => {
    // Arrange
    interface IRequestContext {
      id: string
      userId: number
    }

    class RequestContext implements IRequestContext {
      constructor(
        public id: string,
        public userId: number
      ) {}
    }

    class RequestScopedService {
      constructor(public context: IRequestContext) {}

      getRequestInfo(): string {
        return `Request ${this.context.id} for user ${this.context.userId}`
      }
    }

    const contextToken = Token<IRequestContext>('IRequestContext')
    const requestServiceToken = Token<RequestScopedService>('RequestScopedService')

    // Act - Build Root Container
    const app = rootContainer

    // Act - Simulate Request 1 (create child container with request-scoped context)
    const request1 = app.createChild()
    request1.bindValue(contextToken, new RequestContext('req-1', 101))
    request1.bindFactory(
      requestServiceToken,
      (c) => {
        const ctx = c.resolve(contextToken)
        return new RequestScopedService(ctx)
      },
      { lifetime: 'singleton' } // Singleton within this request scope
    )

    // Act - Simulate Request 2 (create child container with different context)
    const request2 = app.createChild()
    request2.bindValue(contextToken, new RequestContext('req-2', 102))
    request2.bindFactory(
      requestServiceToken,
      (c) => {
        const ctx = c.resolve(contextToken)
        return new RequestScopedService(ctx)
      },
      { lifetime: 'singleton' } // Singleton within this request scope
    )

    // Assert - Each Request Has Isolated Context
    const req1Service = request1.resolve(requestServiceToken)
    const req2Service = request2.resolve(requestServiceToken)

    expect(req1Service.getRequestInfo()).toBe('Request req-1 for user 101')
    expect(req2Service.getRequestInfo()).toBe('Request req-2 for user 102')

    // Assert - Services are singletons within their request scope
    const req1Service2 = request1.resolve(requestServiceToken)
    const req2Service2 = request2.resolve(requestServiceToken)

    expect(req1Service).toBe(req1Service2) // Same instance within request 1
    expect(req2Service).toBe(req2Service2) // Same instance within request 2
    expect(req1Service).not.toBe(req2Service) // Different instances across requests
  })

  it('should dispose request-scoped resources', async () => {
    // Arrange
    interface IDisposable {
      dispose(): Promise<void>
      isDisposed(): boolean
    }

    class RequestResource implements IDisposable {
      private disposed = false

      async dispose(): Promise<void> {
        this.disposed = true
      }

      isDisposed(): boolean {
        return this.disposed
      }
    }

    const resourceToken = Token<RequestResource>('RequestResource')

    // Act - Build Request Container
    const requestBuilder = rootContainer.builder()
    requestBuilder.registerType(RequestResource).as(resourceToken).singleInstance()

    const requestContainer = requestBuilder.build()
    const resource = requestContainer.resolve(resourceToken)

    // Assert - Not Disposed Initially
    expect(resource.isDisposed()).toBe(false)

    // Act - Dispose Container
    await requestContainer.dispose()

    // Assert - Disposed After Container Disposal
    expect(resource.isDisposed()).toBe(true)
  })
})

describe('Integration - Module Pattern', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should organize registrations using modules', () => {
    // Arrange - Domain
    interface IDatabase {
      connect(): void
    }

    interface IUserRepository {
      findAll(): any[]
    }

    interface IProductRepository {
      findAll(): any[]
    }

    interface IUserService {
      getUsers(): any[]
    }

    interface IProductService {
      getProducts(): any[]
    }

    class Database implements IDatabase {
      connect(): void {}
    }

    class UserRepository implements IUserRepository {
      constructor(public db: IDatabase) {}
      findAll(): any[] {
        return []
      }
    }

    class ProductRepository implements IProductRepository {
      constructor(public db: IDatabase) {}
      findAll(): any[] {
        return []
      }
    }

    class UserService implements IUserService {
      constructor(public repo: IUserRepository) {}
      getUsers(): any[] {
        return this.repo.findAll()
      }
    }

    class ProductService implements IProductService {
      constructor(public repo: IProductRepository) {}
      getProducts(): any[] {
        return this.repo.findAll()
      }
    }

    // Arrange - Tokens
    const dbToken = Token<IDatabase>('IDatabase')
    const userRepoToken = Token<IUserRepository>('IUserRepository')
    const productRepoToken = Token<IProductRepository>('IProductRepository')
    const userServiceToken = Token<IUserService>('IUserService')
    const productServiceToken = Token<IProductService>('IProductService')

    // Arrange - Modules
    const DatabaseModule: Module = (builder) => {
      builder.registerType(Database).as(dbToken).singleInstance()
    }

    const RepositoryModule: Module = (builder) => {
      builder
        .registerType(UserRepository)
        .as(userRepoToken)
        .autoWire({
          map: {
            db: dbToken
          }
        })
        .singleInstance()

      builder
        .registerType(ProductRepository)
        .as(productRepoToken)
        .autoWire({
          map: {
            db: dbToken
          }
        })
        .singleInstance()
    }

    const ServiceModule: Module = (builder) => {
      builder
        .registerType(UserService)
        .as(userServiceToken)
        .autoWire({
          map: {
            repo: userRepoToken
          }
        })

      builder
        .registerType(ProductService)
        .as(productServiceToken)
        .autoWire({
          map: {
            repo: productRepoToken
          }
        })
    }

    // Act - Build Container with Modules
    const builder = container.builder()
    builder.module(DatabaseModule)
    builder.module(RepositoryModule)
    builder.module(ServiceModule)

    const app = builder.build()

    // Assert - All Services Resolve Correctly
    const userService = app.resolve(userServiceToken)
    const productService = app.resolve(productServiceToken)

    expect(userService).toBeInstanceOf(UserService)
    expect(productService).toBeInstanceOf(ProductService)

    // Assert - Shared Database Singleton
    expect(userService.repo.db).toBe(productService.repo.db)
  })
})

describe('Integration - Complex Dependency Graph', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should resolve complex nested dependencies', () => {
    // Arrange - Multi-level dependency tree
    class Level4 {
      name = 'Level4'
    }

    class Level3A {
      constructor(public dep: Level4) {}
      name = 'Level3A'
    }

    class Level3B {
      constructor(public dep: Level4) {}
      name = 'Level3B'
    }

    class Level2A {
      constructor(
        public dep1: Level3A,
        public dep2: Level3B
      ) {}
      name = 'Level2A'
    }

    class Level2B {
      constructor(public dep: Level3A) {}
      name = 'Level2B'
    }

    class Level1 {
      constructor(
        public a: Level2A,
        public b: Level2B
      ) {}
      name = 'Level1'
    }

    // Arrange - Tokens
    const l4Token = Token<Level4>('Level4')
    const l3aToken = Token<Level3A>('Level3A')
    const l3bToken = Token<Level3B>('Level3B')
    const l2aToken = Token<Level2A>('Level2A')
    const l2bToken = Token<Level2B>('Level2B')
    const l1Token = Token<Level1>('Level1')

    // Act - Register with Dependencies
    const builder = container.builder()

    builder.registerType(Level4).as(l4Token).singleInstance()

    builder.registerType(Level3A).as(l3aToken).autoWire({
      map: {
        dep: l4Token
      }
    })

    builder.registerType(Level3B).as(l3bToken).autoWire({
      map: {
        dep: l4Token
      }
    })

    builder.registerType(Level2A).as(l2aToken).autoWire({
      map: {
        dep1: l3aToken,
        dep2: l3bToken
      }
    })

    builder.registerType(Level2B).as(l2bToken).autoWire({
      map: {
        dep: l3aToken
      }
    })

    builder.registerType(Level1).as(l1Token).autoWire({
      map: {
        a: l2aToken,
        b: l2bToken
      }
    })

    const app = builder.build()

    // Act - Resolve Root
    const root = app.resolve(l1Token)

    // Assert - Full Graph Resolved
    expect(root.name).toBe('Level1')
    expect(root.a.name).toBe('Level2A')
    expect(root.b.name).toBe('Level2B')
    expect(root.a.dep1.name).toBe('Level3A')
    expect(root.a.dep2.name).toBe('Level3B')
    expect(root.b.dep.name).toBe('Level3A')

    // Assert - Singleton Shared (Diamond Dependency)
    expect(root.a.dep1.dep).toBe(root.a.dep2.dep) // Both Level3s share Level4 singleton
    expect(root.a.dep1.dep).toBe(root.b.dep.dep) // All paths lead to same Level4
  })
})
