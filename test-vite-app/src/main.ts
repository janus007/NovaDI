import { Container } from '@novadi/core'

// Define interfaces and implementations
interface IGreeter {
  greet(name: string): string
}

class ConsoleGreeter implements IGreeter {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

interface ILogger {
  log(message: string): void
}

class ConsoleLogger implements ILogger {
  log(message: string): void {
    console.log(`[LOG] ${message}`)
  }
}

class Application {
  constructor(
    private greeter: IGreeter,
    private logger: ILogger
  ) {}

  run(): void {
    const greeting = this.greeter.greet('Vite + NovaDI')
    this.logger.log(greeting)

    // Display on page
    const app = document.getElementById('app')
    if (app) {
      app.innerHTML = `
        <p>✅ NovaDI unplugin working with Vite!</p>
        <p><strong>Message:</strong> ${greeting}</p>
        <p><em>Check console for debug output</em></p>
      `
      app.style.cssText = 'font-family: sans-serif; padding: 20px; background: #f0f0f0; border-radius: 8px;'
    }
  }
}

// Build container - transformer should auto-inject type names!
const container = new Container()
const builder = container.builder()

// Register with .as<T>() - NO manual type names!
// Transformer should convert to .as<T>("TypeName")
builder.registerType(ConsoleLogger).as<ILogger>().singleInstance()
builder.registerType(ConsoleGreeter).as<IGreeter>().singleInstance()

builder
  .registerType(Application)
  .as<Application>()
  .autoWire({
    map: {
      greeter: (c) => c.resolveType<IGreeter>(),
      logger: (c) => c.resolveType<ILogger>()
    }
  })

const app = builder.build()

// Resolve and run
try {
  const application = app.resolveType<Application>()
  application.run()
  console.log('✅ SUCCESS: NovaDI unplugin working perfectly with Vite!')
} catch (error) {
  console.error('❌ ERROR:', error)
  const appDiv = document.getElementById('app')
  if (appDiv) {
    appDiv.innerHTML = `<p style="color: red;">❌ Error: ${error}</p>`
  }
}
