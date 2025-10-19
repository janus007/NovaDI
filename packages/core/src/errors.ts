/**
 * Error classes for NovaDI container
 */

export class ContainerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContainerError'
  }
}

export class BindingNotFoundError extends ContainerError {
  constructor(tokenDescription: string, path: string[] = []) {
    const pathStr = path.length > 0 ? `\n  Dependency path: ${path.join(' -> ')}` : ''
    super(`Token "${tokenDescription}" is not bound or registered in the container.${pathStr}`)
    this.name = 'BindingNotFoundError'
  }
}

export class CircularDependencyError extends ContainerError {
  constructor(path: string[]) {
    super(`Circular dependency detected: ${path.join(' -> ')}`)
    this.name = 'CircularDependencyError'
  }
}
