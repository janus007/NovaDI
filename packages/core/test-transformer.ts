import { Container } from './src/container'

interface ILogger {
  log(msg: string): void
}

class Logger implements ILogger {
  log(msg: string) {}
}

class EventBus {
  constructor(public logger: ILogger) {}
}

const container = new Container()
const builder = container.builder()
builder.registerType(Logger).asInterface<ILogger>()
builder.registerType(EventBus).asInterface<EventBus>()
