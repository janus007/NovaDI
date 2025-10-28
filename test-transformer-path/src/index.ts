import { Container } from '@novadi/core'

interface ILogger {
  log(message: string): void
}

class ConsoleLogger implements ILogger {
  log(message: string): void {
    console.log(message)
  }
}

// Test transformer - should inject "ILogger" automatically
const container = new Container()
const builder = container.builder()

builder.registerType(ConsoleLogger).asInterface<ILogger>().singleInstance()

const app = builder.build()
const logger = app.resolveType<ILogger>()

logger.log('Transformer test successful!')
