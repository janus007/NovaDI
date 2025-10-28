/**
 * Test file for esbuild with NovaDI unplugin
 */
import { Container } from '../src/container'

interface ILogger {
  log(msg: string): void
}

interface IDatabase {
  query(): any[]
}

class Logger implements ILogger {
  log(msg: string) {
    console.log('Logger:', msg)
  }
}

class Database implements IDatabase {
  query() {
    console.log('Database: query')
    return []
  }
}

// This should be auto-wired by transformer
class UserService {
  constructor(
    public logger: ILogger,
    public database: IDatabase
  ) {}

  doWork() {
    this.logger.log('UserService working...')
    this.database.query()
  }
}

// Setup container
const container = new Container()
const builder = container.builder()

builder.registerType(Logger).asInterface<ILogger>()
builder.registerType(Database).asInterface<IDatabase>()
builder.registerType(UserService).asInterface<UserService>()  // Should auto-generate .autoWire()

const builtContainer = builder.build()
const service = builtContainer.resolveType<UserService>()

console.log('Service created:', service)
console.log('Logger injected:', service.logger)
console.log('Database injected:', service.database)

service.doWork()
