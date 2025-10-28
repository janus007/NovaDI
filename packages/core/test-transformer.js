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
builder.registerType(Logger).as("ILogger");
builder.registerType(EventBus).as("EventBus");
