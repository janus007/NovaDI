import { Container } from './src/container';
class Logger {
    log(msg) { }
}
class EventBus {
    constructor(logger) {
        this.logger = logger;
    }
}
const container = new Container();
const builder = container.builder();
builder.registerType(Logger).asInterface("ILogger");
builder.registerType(EventBus).asInterface("EventBus");
