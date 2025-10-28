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
builder.registerType(Logger).as<ILogger>()
builder.registerType(EventBus).as<EventBus>()
