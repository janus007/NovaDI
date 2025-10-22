// NovaDI Core - Main exports

export { Token, token } from './token.js'
export type { Token as TokenType } from './token.js'

export { Container } from './container.js'
export type { Lifetime, BindingOptions, Factory } from './container.js'

export { Builder, RegistrationBuilder } from './builder.js'
export type { Module, AutoWireOptions } from './builder.js'

export { autowire } from './autowire.js'

export {
  ContainerError,
  BindingNotFoundError,
  CircularDependencyError
} from './errors.js'
