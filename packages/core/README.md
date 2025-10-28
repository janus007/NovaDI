# NovaDI Core

> **Annotation-free, blazing-fast dependency injection for TypeScript**

NovaDI is a modern dependency injection container that keeps your business logic clean from framework code. No decorators, no annotations, no runtime reflection - just pure TypeScript and compile-time type safety.

[![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)](https://github.com/janus007/NovaDI)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Bundle Size](https://img.shields.io/badge/bundle-4KB-success.svg)](dist/)

---

## Why NovaDI?

Most TypeScript DI frameworks force you to pollute your code with decorators:

```typescript
// ❌ Other frameworks - tight coupling everywhere
@Injectable()
class UserService {
  constructor(
    @Inject('ILogger') private logger: ILogger,
    @Inject('IDatabase') private db: IDatabase
  ) {}
}
```

NovaDI keeps your code clean:

```typescript
// ✅ NovaDI - clean, testable code
class UserService {
  constructor(
    private logger: ILogger,
    private database: IDatabase
  ) {}
}

// DI configuration lives in ONE place (Composition Root)
const container = new Container()
const builder = container.builder()

builder.registerType(ConsoleLogger).as<ILogger>().singleInstance()
builder.registerType(PostgresDatabase).as<IDatabase>().singleInstance()
builder.registerType(UserService).as<UserService>()

const app = builder.build()
const userService = app.resolveType<UserService>()
```

**Your business logic stays framework-agnostic. Your tests stay simple. Your architecture stays clean.**

---

## Features

- **Zero Annotations** - No decorators in your business code
- **Transformer-Powered AutoWire** - Automatically wires ALL dependencies via compile-time type analysis
- **It Just Works** - No manual configuration needed
- **Blazing Fast** - Multi-tier caching, object pooling, zero-overhead singletons (0.04ms for complex graphs 🥇)
- **Tiny Bundle** - Only 3.93 KB gzipped (second smallest, 79% larger than Brandi but with full autowire)
- **Type-Safe** - Full TypeScript type inference and compile-time checking
- **Composition Root** - All DI configuration in one place
- **Multiple Lifetimes** - Singleton, Transient (default), Per-Request scoping
- **TypeScript Transformer** - Compile-time type name injection

---

## Quick Start

### Installation

```bash
npm install @novadi/core
# or
yarn add @novadi/core
# or
pnpm add @novadi/core
```

### Setup - Choose Your Integration Method

NovaDI uses a **TypeScript transformer** to automatically inject type names at compile-time. This enables clean, annotation-free code while maintaining full type safety.

> **Why a transformer?** TypeScript erases all type information at runtime. The transformer captures type names during compilation, enabling powerful features like dependency graph generation, compile-time validation, circular dependency detection, and automated wiring - all with zero runtime overhead.

#### Option 1: Modern Bundlers (Recommended ⭐)

Use **unplugin** for universal bundler support. This is the easiest and most reliable approach.

**Vite:**
```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { NovadiUnplugin } from '@novadi/core/unplugin'

export default defineConfig({
  plugins: [NovadiUnplugin.vite()]
})
```

**webpack:**
```javascript
// webpack.config.js
const { NovadiUnplugin } = require('@novadi/core/unplugin')

module.exports = {
  plugins: [NovadiUnplugin.webpack()]
}
```

**Rollup:**
```javascript
// rollup.config.js
import { NovadiUnplugin } from '@novadi/core/unplugin'

export default {
  plugins: [NovadiUnplugin.rollup()]
}
```

**esbuild:**
```javascript
// esbuild.config.js
const { NovadiUnplugin } = require('@novadi/core/unplugin')

require('esbuild').build({
  plugins: [NovadiUnplugin.esbuild()]
})
```

#### Option 2: TypeScript Compiler (tsc)

For direct `tsc` compilation, use `ts-patch`:

```bash
npm install -D ts-patch
npx ts-patch install
```

Add to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "@novadi/core/transformer" }
    ]
  }
}
```

**That's it!** The transformer handles everything automatically:
- `.as<ILogger>()` → transformer injects `"ILogger"`
- `.as<UserService>()` → transformer injects `"UserService"`
- `.autoWire()` → transformer generates `mapResolvers` array

No manual type names needed!

### Basic Usage - It Just Works!

```typescript
import { Container } from '@novadi/core'

// 1. Define your services (clean code, no decorators!)
interface ILogger {
  log(message: string): void
}

class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(`[LOG] ${message}`)
  }
}

class UserService {
  constructor(private logger: ILogger) {}

  createUser(name: string) {
    this.logger.log(`Creating user: ${name}`)
  }
}

// 2. Configure container (Composition Root)
const container = new Container()
const builder = container.builder()

// Register implementations
builder.registerType(ConsoleLogger).as<ILogger>().singleInstance()

// Transformer automatically wires ALL dependencies!
builder.registerType(UserService).as<UserService>()

const app = builder.build()

// 3. Resolve and use
const userService = app.resolveType<UserService>()
userService.createUser('Alice') // [LOG] Creating user: Alice
```

**That's it!** No manual configuration. No mapping. The transformer does it all automatically.

The `logger` parameter automatically resolves to the registered `ILogger` interface by naming convention. This is THE way to use NovaDI.

---

## AutoWire - Convention Over Configuration

**Autowiring by convention** is THE way you wire dependencies. No manual configuration, no boilerplate - it just works.

### The Standard Way - Type Injection by Convention

```typescript
class UserService {
  constructor(
    private logger: ILogger,      // Automatically resolves ILogger by convention
    private database: IDatabase   // Automatically resolves IDatabase by convention
  ) {}
}

// This is all you need - transformer does the rest!
builder.registerType(UserService).as<UserService>()
```

**How it works:**
- Transformer analyzes constructor parameter **TYPES** at compile-time
- Generates `mapResolvers` array automatically
- Injects `.autoWire({ mapResolvers: [...] })` into the call
- **Zero runtime overhead - all type info captured at build time!**

**This is how you should wire ALL your services.** Transformer-powered autowiring - always.

### Explicit Mapping (For Primitives & Config)

**Why you need explicit mapping:** Transformeren kan kun autowire **typed dependencies** (interfaces/classes). For primitives, strings, og configuration values skal du bruge explicit mapping.

**Common use case - API Client:**

```typescript
interface IHttpClient {
  get<T>(endpoint: string): Promise<T>
  post<T>(endpoint: string, data: any): Promise<T>
}

class ApiClient implements IHttpClient {
  constructor(
    private baseUrl: string,      // ⚠️ Primitive - transformer can't autowire this
    private apiKey: string,        // ⚠️ Primitive - transformer can't autowire this
    private logger: ILogger        // ✅ Typed dependency - transformer handles this
  ) {}

  async get<T>(endpoint: string): Promise<T> {
    this.logger.log(`GET ${this.baseUrl}${endpoint}`)
    // HTTP logic...
  }
}

// Explicit mapping for primitives + transformer for typed dependencies
builder.registerType(ApiClient).as<IHttpClient>().autoWire({
  map: {
    baseUrl: () => import.meta.env.VITE_API_BASE_URL,  // Environment variable
    apiKey: () => import.meta.env.VITE_API_KEY,        // Secret from env
    logger: (c) => c.resolveType<ILogger>()            // Typed dependency
  }
})
```

**Benefits:**
- ✅ Environment variables injected cleanly
- ✅ Configuration centralized in composition root
- ✅ Easy to swap between dev/staging/prod configs
- ✅ No hardcoded values in business logic

**For regular service dependencies (no primitives), just register the type - transformer handles everything!**

---

## Lifetimes

**Important:** Default lifetime is `transient` (new instance every time).

### Singleton - One instance for the container lifetime
```typescript
builder.registerType(Database).as<IDatabase>().singleInstance()
```

Use for: Loggers, database connections, configuration, caches

### Transient - New instance every resolution (DEFAULT)
```typescript
builder.registerType(RequestHandler).as<IRequestHandler>()
// No .singleInstance() = transient by default
```

Use for: Request handlers, commands, stateful operations

### Per-Request - One instance per resolution tree
```typescript
builder.registerType(UnitOfWork).as<IUnitOfWork>().instancePerRequest()
```

Use for: Database transactions, request-scoped state

---

## Real-World Example

```typescript
import { Container } from '@novadi/core'

// Services (clean code, no framework imports!)
interface ILogger {
  info(message: string): void
  error(message: string, error?: Error): void
}

class ConsoleLogger implements ILogger {
  info(message: string) { console.log(`[INFO] ${message}`) }
  error(message: string, error?: Error) { console.error(`[ERROR] ${message}`, error) }
}

interface IDatabase {
  query<T>(sql: string): Promise<T[]>
}

class PostgresDatabase implements IDatabase {
  constructor(private logger: ILogger) {}

  async query<T>(sql: string): Promise<T[]> {
    this.logger.info(`Executing query: ${sql}`)
    // Implementation...
    return []
  }
}

class UserService {
  constructor(
    private database: IDatabase,
    private logger: ILogger
  ) {}

  async getUser(id: number) {
    this.logger.info(`Fetching user ${id}`)
    return this.database.query(`SELECT * FROM users WHERE id = ${id}`)
  }
}

// Composition Root
const container = new Container()
const builder = container.builder()

builder.registerType(ConsoleLogger).as<ILogger>().singleInstance()
builder.registerType(PostgresDatabase).as<IDatabase>().singleInstance()
builder.registerType(UserService).as<UserService>()

const app = builder.build()

// Use it
const userService = app.resolveType<UserService>()
await userService.getUser(123)
```

**Notice:**
- All service files are pure TypeScript - no decorators, no framework imports
- Transformer handles ALL dependency wiring automatically
- No manual mapping needed - it just works
- Configuration lives in ONE place
- Testing is trivial: `new UserService(mockDB, mockLogger)`

---

## Why No Decorators?

Many DI frameworks (NestJS, InversifyJS, TypeDI, TSyringe) rely heavily on decorators. While convenient, this approach violates fundamental software design principles:

### 1. Violation of Separation of Concerns

Your business logic should not know about the DI framework:

```typescript
// ❌ BAD: Business logic tightly coupled to framework
import { Injectable, Inject } from 'some-di-framework'

@Injectable()
class OrderService {
  constructor(
    @Inject('PaymentGateway') private payment: IPaymentGateway,
    @Inject('EmailService') private email: IEmailService,
    @Inject('Logger') private logger: ILogger
  ) {}

  processOrder(order: Order) {
    // Business logic here...
  }
}
```

**Problems:**
- Cannot use `OrderService` without the DI framework
- Tests must mock the framework's injection mechanism
- Framework is now a core dependency, not infrastructure
- Changing DI frameworks requires modifying all service files

```typescript
// ✅ GOOD: Clean business logic
class OrderService {
  constructor(
    private payment: IPaymentGateway,
    private email: IEmailService,
    private logger: ILogger
  ) {}

  processOrder(order: Order) {
    // Same business logic, zero framework coupling
  }
}

// DI configuration lives separately (Composition Root)
const container = new Container()
const builder = container.builder()

// Transformer-powered autowiring - analyzes constructor types at compile-time
builder.registerType(OrderService).as<OrderService>()
```

**Benefits:**
- `OrderService` can be instantiated without any framework
- Unit tests are trivial: `new OrderService(mockPayment, mockEmail, mockLogger)`
- Framework is swappable without touching business code
- Code is portable across projects

### 2. Testing Becomes Harder

```typescript
// ❌ With decorators - need framework in tests
import { Test } from '@nestjs/testing'

describe('OrderService', () => {
  it('processes order', async () => {
    // Must set up entire DI framework for a simple test
    const module = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: 'PaymentGateway', useValue: mockPayment },
        { provide: 'EmailService', useValue: mockEmail },
        { provide: 'Logger', useValue: mockLogger }
      ]
    }).compile()

    const service = module.get<OrderService>(OrderService)
    // Finally can test...
  })
})

// ✅ Without decorators - pure unit tests
describe('OrderService', () => {
  it('processes order', () => {
    const service = new OrderService(mockPayment, mockEmail, mockLogger)
    // Test immediately, no framework needed
  })
})
```

### 3. Breaks the Dependency Inversion Principle

The Dependency Inversion Principle states: "High-level modules should not depend on low-level modules. Both should depend on abstractions."

When you add `@Injectable()` to a class, you're making it depend on the DI framework (a low-level module).

```typescript
// ❌ Depends on DI framework (violation)
import { Injectable } from 'framework' // <- Infrastructure dependency

@Injectable() // <- Framework coupling
class BusinessService { /* ... */ }

// ✅ Depends on nothing (correct)
class BusinessService { /* ... */ }
```

### 4. Composition Root Pattern

NovaDI follows the **Composition Root** pattern - all DI configuration happens in ONE place at the application's entry point:

```typescript
// main.ts - The ONLY place that knows about DI
import { Container } from '@novadi/core'

// All wiring happens here
const container = new Container()
const builder = container.builder()

// Infrastructure layer - singletons
builder.registerType(ConsoleLogger).as<ILogger>().singleInstance()
builder.registerType(PostgresDatabase).as<IDatabase>().singleInstance()
builder.registerType(StripePayment).as<IPaymentGateway>().singleInstance()
builder.registerType(SendGridEmail).as<IEmailService>().singleInstance()

// Service layer - autowired by transformer
builder.registerType(OrderService).as<OrderService>()
builder.registerType(UserService).as<UserService>()

// Application layer
builder.registerType(Application).as<Application>()

const app = builder.build()

// Start application
const application = app.resolveType<Application>()
application.start()
```

**Everything else is clean business code with zero DI knowledge.**

### Comparison: Decorator Hell vs Clean Code

**NestJS/InversifyJS Style (Decorators Everywhere):**

```typescript
// user.service.ts
import { Injectable, Inject } from '@nestjs/common'

@Injectable()
export class UserService {
  constructor(
    @Inject('ILogger') private logger: ILogger,
    @Inject('IDatabase') private db: IDatabase
  ) {}
}

// order.service.ts
import { Injectable, Inject } from '@nestjs/common'

@Injectable()
export class OrderService {
  constructor(
    @Inject('IPayment') private payment: IPayment,
    @Inject(UserService) private users: UserService
  ) {}
}

// Every file imports framework code!
// Every class is coupled to the DI container!
// Cannot test without framework!
```

**NovaDI Style (Clean Separation):**

```typescript
// user.service.ts
export class UserService {
  constructor(
    private logger: ILogger,
    private database: IDatabase
  ) {}
}

// order.service.ts
export class OrderService {
  constructor(
    private payment: IPayment,
    private users: UserService
  ) {}
}

// main.ts (Composition Root)
const container = new Container()
const builder = container.builder()
builder.registerType(UserService).as<UserService>()
builder.registerType(OrderService).as<OrderService>()
const app = builder.build()

// Business code knows nothing about DI!
// Tests are trivial: new UserService(mockLogger, mockDb)
// Framework can be swapped without touching services!
```

---

## Advanced Usage

### Factories

```typescript
builder
  .register((c) => {
    const config = c.resolveType<IConfig>()
    const logger = c.resolveType<ILogger>()
    return new ComplexService(config, logger, new Date())
  })
  .as<IComplexService>()
  .singleInstance()
```

### Instances

```typescript
const config = { apiKey: 'secret', timeout: 5000 }
builder.registerInstance(config).as<IConfig>()
```

### Scoped Containers

```typescript
// Create child scope per request
app.use((req, res, next) => {
  const requestScope = app.createChild()
  req.container = requestScope
  next()
})

// Resolve per-request services
const handler = req.container.resolveType<IRequestHandler>()
```

### Keyed Services

```typescript
// Register multiple implementations of same interface
interface IStorageProvider {
  get(key: string): any
  set(key: string, value: any): void
}

class LocalStorageProvider implements IStorageProvider { /* ... */ }
class SessionStorageProvider implements IStorageProvider { /* ... */ }

// Register with keys
builder.registerType(LocalStorageProvider).as<IStorageProvider>().keyed('local')
builder.registerType(SessionStorageProvider).as<IStorageProvider>().keyed('session')

// Resolve specific implementation by key
const localStorage = app.resolveKeyed<IStorageProvider>('local')
const sessionStorage = app.resolveKeyed<IStorageProvider>('session')
```

---

## Technical Deep Dive

*For the curious developers who want to know how it works under the hood.*

### Performance Architecture

NovaDI uses a **three-tier resolution strategy** for maximum speed:

#### Tier 1: Ultra-Fast Path (Singletons)
```typescript
private readonly ultraFastSingletonCache: Map<Token<any>, any> = new Map()

resolve<T>(token: Token<T>): T {
  // Zero overhead - direct Map lookup
  const ultraFast = this.ultraFastSingletonCache.get(token)
  if (ultraFast !== undefined) {
    return ultraFast // ⚡ Instant return, no checks
  }
  // ...
}
```
**Performance:** O(1) - Hash map lookup, ~1-2 CPU cycles
**Use case:** Singleton services (most common in real apps)

#### Tier 2: Fast Path (Zero-dependency Transients)
```typescript
private readonly fastTransientCache: Map<Token<any>, Factory<any>> = new Map()

// Skip ResolutionContext entirely for simple cases
const fastTransient = this.fastTransientCache.get(token)
if (fastTransient) {
  return fastTransient(this) // No context overhead
}
```
**Performance:** O(1) - Direct factory call, no context allocation
**Use case:** Transient services with no dependencies

#### Tier 3: Standard Path (Complex Dependencies)
```typescript
// Full resolution with circular dependency detection
const context = this.currentContext || Container.contextPool.acquire()
context.enterResolve(token)
try {
  return this.resolveWithContext(token, context)
} finally {
  context.exitResolve(token)
}
```
**Performance:** O(n) where n = dependency chain depth
**Use case:** Per-request scoped or complex dependency graphs

### Object Pooling

To reduce garbage collection pressure, NovaDI pools `ResolutionContext` objects:

```typescript
class ResolutionContextPool {
  private pool: ResolutionContext[] = []
  private readonly maxSize = 10

  acquire(): ResolutionContext {
    return this.pool.pop() ?? new ResolutionContext()
  }

  release(context: ResolutionContext): void {
    if (this.pool.length < this.maxSize) {
      context.reset() // Clear state
      this.pool.push(context)
    }
  }
}
```

**Benefit:** Reduces heap allocations by ~90% for typical usage patterns

### Lazy Path Building

Dependency resolution paths are only built when errors occur:

```typescript
class ResolutionContext {
  private path?: string[] // Lazy initialization

  getPath(): string[] {
    if (!this.path) {
      // Only build when needed (error reporting)
      this.path = Array.from(this.resolvingStack).map(t => t.toString())
    }
    return this.path
  }
}
```

**Benefit:** Avoids expensive `toString()` calls during successful resolutions

### Memory Footprint

```
Container instance: ~4 KB
+ Bindings: ~100 bytes per service
+ Singleton cache: ~50 bytes per singleton
+ Context pool: ~2 KB (10 pooled contexts)
```

For a typical app with 50 services:
- Container: 4 KB
- 50 bindings: 5 KB
- 30 singletons cached: 1.5 KB
- **Total: ~10.5 KB runtime memory**

### Benchmark Results

*Run on Node.js 20, M1 MacBook Pro*

| Operation | Time | Ops/sec |
|-----------|------|---------|
| Resolve singleton (ultra-fast) | ~10 ns | 100M |
| Resolve transient (fast) | ~50 ns | 20M |
| Resolve with dependencies | ~200 ns | 5M |
| Container build (50 services) | ~2 ms | - |

**Comparison:**
- **NovaDI singleton:** ~10 ns
- **InversifyJS singleton:** ~500 ns (50x slower)
- **TSyringe singleton:** ~300 ns (30x slower)

---

## Code Metrics

| Metric | Value |
|--------|-------|
| **Total Lines of Code** | 2,079 lines |
| **Bundle Size (compiled)** | ~59 KB |
| **Public API Surface** | 22 exports |
| **Avg. Cyclomatic Complexity** | ~3.4 (low, maintainable) |
| **Runtime Dependencies** | 0 (only TypeScript) |

**File Breakdown:**
- `container.ts` - 706 lines (resolution engine)
- `builder.ts` - 498 lines (fluent API)
- `transformer/index.ts` - 544 lines (compile-time magic)
- `autowire.ts` - 229 lines (autowiring strategies)
- `token.ts` - 61 lines (type-safe tokens)
- `errors.ts` - 25 lines (error types)

---

## Comparison with Other Frameworks

| Feature | NovaDI | InversifyJS | TSyringe | TypeDI | Brandi | Awilix |
|---------|---------|-------------|----------|--------|--------|--------|
| **No Decorators** | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **AutoWire** | ✅ Automatic | ❌ Manual | ❌ Manual | ❌ Manual | ❌ Manual | ✅ Automatic |
| **Type Safety** | ✅ Full | ⚠️ Partial | ⚠️ Partial | ⚠️ Partial | ✅ Full | ✅ Full |
| **Transformer** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Performance** | ⚡ ~10ns | 🐢 ~500ns | 🐢 ~300ns | 🐢 ~400ns | ⚡ ~10ns | ⚡ ~50ns |
| **Bundle Size (gzipped)** | 🥈 3.93 KB | 16.78 KB | 7.40 KB | 6.41 KB | 🥇 2.19 KB | ~4 KB |
| **Composition Root** | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |

### Bundle Size Benchmark

```
 🥇 Brandi        2.19 KB  (minified:  6.31 KB)
 🥈 NovaDI        3.93 KB  (minified: 13.99 KB)  +79%
 🥉 TypeDI        6.41 KB  (minified: 21.96 KB)  +192%
    TSyringe      7.40 KB  (minified: 25.35 KB)  +238%
    Inversify    16.78 KB  (minified: 65.75 KB)  +665%
```

**NovaDI: 3.93 KB (gzipped)** - Second smallest DI framework, only 79% larger than Brandi while offering **full transformer-powered autowiring** that Brandi lacks.

### Performance Benchmark

| Framework | Decorator-Free | Singleton | Transient | Build Time | Complex Graph | Bundle Size |
|-----------|----------------|-----------|-----------|------------|---------------|-------------|
| **NovaDI 🏆** | ✅ Yes | 0.03 ms | 0.08 ms | 0.10 ms | **0.04 ms** 🥇 | 3.9 KB |
| **Brandi** | ✅ Yes | 0.11 ms | 0.20 ms | 0.11 ms | 0.08 ms | **2.2 KB** 🥇 |
| **TypeDI** | ❌ No | **0.02 ms** 🥇 | **0.03 ms** 🥇 | 0.69 ms | 0.16 ms | 6.4 KB |
| **TSyringe** | ❌ No | 0.17 ms | 0.27 ms | **0.05 ms** 🥇 | 9.74 ms | 7.4 KB |
| **InversifyJS** | ❌ No | 0.13 ms | 0.31 ms | 0.22 ms | 0.19 ms | 16.8 KB |

**NovaDI wins on complex dependency graphs** - The only metric that truly matters for real-world applications with deep dependency trees.

---

## AI-Assisted Onboarding Prompt

**Copy this prompt when asking an AI assistant to help you use NovaDI:**

```
I want to use the @novadi/core dependency injection library in my TypeScript project.

Key Principles:
- Package: @novadi/core
- NO decorators/annotations in business code
- Convention over configuration
- Uses .as<T>() and .resolveType<T>()
- TypeScript transformer handles type names automatically

Core API:
1. Import: import { Container } from '@novadi/core'

2. Build container:
   const container = new Container()
   const builder = container.builder()

3. Register services:
   builder.registerType(ConsoleLogger).as<ILogger>().singleInstance()

4. Register services with dependencies:
   builder.registerType(UserService).as<UserService>()
   // Transformer analyzes constructor types and auto-generates .autoWire() with mapResolvers array

5. Build and resolve:
   const app = builder.build()
   const service = app.resolveType<UserService>()

Lifetimes:
- .singleInstance() - singleton
- .instancePerDependency() - transient (DEFAULT)
- .instancePerRequest() - per resolution tree

AutoWire (Transformer-Powered):
- Transformer automatically injects .autoWire() with mapResolvers from constructor types
- Just register the type: builder.registerType(UserService).as<UserService>()
- Use explicit map only for primitives/config values (transformer doesn't handle primitives)

Transformer Setup (tsconfig.json):
{
  "compilerOptions": {
    "plugins": [
      { "transform": "@novadi/core/transformer" }
    ]
  }
}

Then: npm install -D ts-patch && npx ts-patch install

Simple Hello World example:
```typescript
import { Container } from '@novadi/core'

interface IGreeter {
  greet(name: string): string
}

class ConsoleGreeter implements IGreeter {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

class Application {
  constructor(private greeter: IGreeter) {}

  run() {
    console.log(this.greeter.greet('World'))
  }
}

// Composition Root
const container = new Container()
const builder = container.builder()

builder.registerType(ConsoleGreeter).as<IGreeter>().singleInstance()
builder.registerType(Application).as<Application>().autoWire() // Convention!

const app = builder.build()
const application = app.resolveType<Application>()
application.run() // Outputs: Hello, World!
```

Please help me set up NovaDI following these patterns.
```

**For AI to reference:** Full README at https://github.com/janus007/NovaDI

---

## Documentation

- [Getting Started Guide](../../docs/getting-started.md)
- [Transformer Setup](../../docs/transformer-setup.md)
- [Best Practices](../../docs/best-practices.md)
- [Roadmap & Ideas](../../docs/roadmap.md)

---

## License

MIT © Janus Knudsen

---

## Acknowledgments

Inspired by:
- **Autofac** (.NET) - Composition Root pattern, fluent API
- **Awilix** (Node.js) - Clean, annotation-free API
- **Mark Seemann's** work on Dependency Injection patterns

Built for developers who believe in:
- Clean Architecture
- Separation of Concerns
- Testable Code
- SOLID Principles
- Convention over configuration

---

**Keep your code clean. Keep your architecture pure. Use NovaDI.**
