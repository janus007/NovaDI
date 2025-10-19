/**
 * NovaDI TypeScript Transformer
 *
 * Automatically injects type names into:
 * - .asInterface<T>() → .asInterface<T>("TypeName")
 * - .resolveInterface<T>() → .resolveInterface<T>("TypeName")
 * - .bindInterface<T>(value) → .bindInterface<T>(value, "TypeName")
 * - .registerType(X) → .registerType(X).autoWire({ map: {...} }) (default autowiring)
 *
 * Usage in tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "plugins": [
 *       { "transform": "@novadi/core/transformer" }
 *     ]
 *   }
 * }
 *
 * Compile with: ttsc (ttypescript) or ts-patch
 */

import * as ts from 'typescript'

export default function novadiTransformer(program: ts.Program | null): ts.TransformerFactory<ts.SourceFile> {
  // If no program is provided (e.g., in Vite/Vitest environment), return basic transformer
  const checker = program?.getTypeChecker()

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      const visitor = (node: ts.Node): ts.Node => {
        // Transform .asInterface<T>(), .resolveInterface<T>(), and .bindInterface<T>() calls
        if (ts.isCallExpression(node)) {
          const transformed = transformAsInterface(node, context)
          if (transformed !== node) {
            return transformed
          }

          const transformedResolve = transformResolveInterface(node, context)
          if (transformedResolve !== node) {
            return transformedResolve
          }

          const transformedBind = transformBindInterface(node, context)
          if (transformedBind !== node) {
            return transformedBind
          }

          // NEW: Transform default autowiring (only if checker is available)
          if (checker) {
            const transformedAutowire = transformDefaultAutowiring(node, context, checker)
            if (transformedAutowire !== node) {
              return transformedAutowire
            }
          }
        }

        return ts.visitEachChild(node, visitor, context)
      }

      return ts.visitNode(sourceFile, visitor) as ts.SourceFile
    }
  }
}

/**
 * Transform .asInterface<T>() to .asInterface<T>("TypeName")
 */
function transformAsInterface(
  node: ts.CallExpression,
  context: ts.TransformationContext
): ts.Node {
  // Check if this is a .asInterface() call
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return node
  }

  const propAccess = node.expression
  if (propAccess.name.text !== 'asInterface') {
    return node
  }

  // Check if it has type arguments and no string argument yet
  if (!node.typeArguments || node.typeArguments.length === 0) {
    return node
  }

  // If already has a string argument, don't transform
  if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
    return node
  }

  // Extract type name from type argument
  const typeArg = node.typeArguments[0]
  const typeName = getTypeNameFromTypeNode(typeArg)

  if (!typeName) {
    return node
  }

  // Create new call with type name as first argument
  return context.factory.updateCallExpression(
    node,
    node.expression,
    node.typeArguments,
    [context.factory.createStringLiteral(typeName), ...node.arguments]
  )
}

/**
 * Transform .bindInterface<T>() to .bindInterface<T>(value, "TypeName")
 */
function transformBindInterface(
  node: ts.CallExpression,
  context: ts.TransformationContext
): ts.Node {
  // Check if this is a .bindInterface() call
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return node
  }

  const propAccess = node.expression
  if (propAccess.name.text !== 'bindInterface') {
    return node
  }

  // Check if it has type arguments
  if (!node.typeArguments || node.typeArguments.length === 0) {
    return node
  }

  // If already has 2 arguments (value + typeName), don't transform
  if (node.arguments.length >= 2) {
    return node
  }

  // Extract type name from type argument
  const typeArg = node.typeArguments[0]
  const typeName = getTypeNameFromTypeNode(typeArg)

  if (!typeName) {
    return node
  }

  // Create new call with type name as second argument
  return context.factory.updateCallExpression(
    node,
    node.expression,
    node.typeArguments,
    [...node.arguments, context.factory.createStringLiteral(typeName)]
  )
}

/**
 * Transform .resolveInterface<T>() to .resolveInterface<T>("TypeName")
 */
function transformResolveInterface(
  node: ts.CallExpression,
  context: ts.TransformationContext
): ts.Node {
  // Check if this is a .resolveInterface() call
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return node
  }

  const propAccess = node.expression
  if (propAccess.name.text !== 'resolveInterface' &&
      propAccess.name.text !== 'resolveInterfaceKeyed' &&
      propAccess.name.text !== 'resolveInterfaceAll') {
    return node
  }

  // Check if it has type arguments
  if (!node.typeArguments || node.typeArguments.length === 0) {
    return node
  }

  // For resolveInterfaceKeyed, skip if already has 1+ arguments (the key)
  if (propAccess.name.text === 'resolveInterfaceKeyed' && node.arguments.length > 0) {
    return node
  }

  // If already has a string argument, don't transform
  if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
    return node
  }

  // Extract type name from type argument
  const typeArg = node.typeArguments[0]
  const typeName = getTypeNameFromTypeNode(typeArg)

  if (!typeName) {
    return node
  }

  // Create new call with type name as first argument
  return context.factory.updateCallExpression(
    node,
    node.expression,
    node.typeArguments,
    [context.factory.createStringLiteral(typeName), ...node.arguments]
  )
}

/**
 * Extract type name from TypeNode
 */
function getTypeNameFromTypeNode(typeNode: ts.TypeNode): string | null {
  // Handle type reference (e.g., ILogger, UserService)
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName
    if (ts.isIdentifier(typeName)) {
      return typeName.text
    }
    // Handle qualified names (e.g., Namespace.Type)
    if (ts.isQualifiedName(typeName)) {
      return getQualifiedName(typeName)
    }
  }

  // Handle type literals, unions, intersections, etc.
  // For now, return null for complex types
  return null
}

/**
 * Get fully qualified name from QualifiedName node
 */
function getQualifiedName(node: ts.QualifiedName): string {
  const parts: string[] = []

  function walk(n: ts.EntityName): void {
    if (ts.isIdentifier(n)) {
      parts.unshift(n.text)
    } else if (ts.isQualifiedName(n)) {
      parts.unshift(n.right.text)
      walk(n.left)
    }
  }

  walk(node)
  return parts.join('.')
}

/**
 * Transform default autowiring:
 * .registerType(X).asInterface<Y>() → .registerType(X).asInterface<Y>().autoWire({ map: {...} })
 *
 * This makes paramName autowiring minification-safe by converting to explicit map strategy.
 */
function transformDefaultAutowiring(
  node: ts.CallExpression,
  context: ts.TransformationContext,
  checker: ts.TypeChecker
): ts.Node {
  // Check if this is a method chain ending with .asInterface() or similar
  const chain = getMethodChain(node)

  // Find .registerType() call in the chain
  const registerTypeIndex = chain.findIndex(call =>
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'registerType'
  )

  if (registerTypeIndex === -1) {
    return node // Not a registerType chain
  }

  // Check if already has .autoWire() in chain
  const hasAutoWire = chain.some(call =>
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'autoWire'
  )

  if (hasAutoWire) {
    return node // Already has explicit autowiring
  }

  // Get the constructor from .registerType(Constructor) call
  const registerTypeCall = chain[registerTypeIndex]
  if (registerTypeCall.arguments.length === 0) {
    return node // No constructor argument
  }

  const constructorArg = registerTypeCall.arguments[0]

  // Get constructor type from type checker
  const constructorType = checker.getTypeAtLocation(constructorArg)
  const constructorParams = getConstructorParameters(constructorType, checker)

  if (constructorParams.length === 0) {
    return node // No parameters to autowire
  }

  // Filter out primitive types and generate map entries
  const mapEntries: Array<{ paramName: string; interfaceName: string }> = []

  for (const param of constructorParams) {
    const interfaceName = getInterfaceNameFromType(param.type)
    if (interfaceName) {
      mapEntries.push({
        paramName: param.name,
        interfaceName: interfaceName
      })
    }
  }

  if (mapEntries.length === 0) {
    return node // No interface dependencies to autowire
  }

  // Generate .autoWire({ map: {...} }) call
  const autoWireCall = createAutoWireMapCall(mapEntries, context)

  // Insert autoWire call into the method chain
  return insertAutoWireIntoChain(node, autoWireCall, context)
}

/**
 * Get all method calls in a chain (e.g., builder.registerType(X).asInterface<Y>().singleInstance())
 */
function getMethodChain(node: ts.CallExpression): ts.CallExpression[] {
  const chain: ts.CallExpression[] = []
  let current: ts.Node = node

  while (ts.isCallExpression(current)) {
    chain.unshift(current)
    if (ts.isPropertyAccessExpression(current.expression)) {
      current = current.expression.expression
    } else {
      break
    }
  }

  return chain
}

/**
 * Get constructor parameters with their types
 */
function getConstructorParameters(
  type: ts.Type,
  checker: ts.TypeChecker
): Array<{ name: string; type: ts.Type }> {
  const params: Array<{ name: string; type: ts.Type }> = []

  // Get construct signatures from the type
  const constructSignatures = type.getConstructSignatures()

  if (constructSignatures.length === 0) {
    return params
  }

  // Use the first construct signature
  const signature = constructSignatures[0]
  const parameters = signature.getParameters()

  for (const param of parameters) {
    const paramType = checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration!)
    params.push({
      name: param.getName(),
      type: paramType
    })
  }

  return params
}

/**
 * Extract interface name from a type (e.g., ILogger, IDatabase)
 * Returns null for primitive types or types we can't handle
 */
function getInterfaceNameFromType(type: ts.Type): string | null {
  // Skip primitive types
  if (type.flags & ts.TypeFlags.String ||
      type.flags & ts.TypeFlags.Number ||
      type.flags & ts.TypeFlags.Boolean ||
      type.flags & ts.TypeFlags.Undefined ||
      type.flags & ts.TypeFlags.Null ||
      type.flags & ts.TypeFlags.Any ||
      type.flags & ts.TypeFlags.Unknown ||
      type.flags & ts.TypeFlags.Void) {
    return null
  }

  // Get the symbol for this type
  const symbol = type.getSymbol() || type.aliasSymbol

  if (!symbol) {
    return null
  }

  // Return the symbol name (e.g., "ILogger", "IDatabase")
  return symbol.getName()
}

/**
 * Create AST for .autoWire({ map: { param: (c) => c.resolveInterface<T>("T") } })
 */
function createAutoWireMapCall(
  entries: Array<{ paramName: string; interfaceName: string }>,
  context: ts.TransformationContext
): ts.CallExpression {
  const factory = context.factory

  // Create map object: { logger: (c) => c.resolveInterface<ILogger>("ILogger"), ... }
  const mapProperties = entries.map(entry => {
    // Create: (c) => c.resolveInterface<InterfaceName>("InterfaceName")
    const arrowFunction = factory.createArrowFunction(
      undefined, // modifiers
      undefined, // type parameters
      [factory.createParameterDeclaration(
        undefined, // modifiers
        undefined, // dotDotDotToken
        'c', // name
        undefined, // questionToken
        undefined, // type
        undefined  // initializer
      )],
      undefined, // type
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      // c.resolveInterface<InterfaceName>("InterfaceName")
      factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier('c'),
          'resolveInterface'
        ),
        [factory.createTypeReferenceNode(entry.interfaceName)],
        [factory.createStringLiteral(entry.interfaceName)]
      )
    )

    return factory.createPropertyAssignment(
      entry.paramName,
      arrowFunction
    )
  })

  // Create: { map: { ... } }
  const configObject = factory.createObjectLiteralExpression([
    factory.createPropertyAssignment(
      'map',
      factory.createObjectLiteralExpression(mapProperties, true)
    )
  ], true)

  // Create: .autoWire({ map: {...} })
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier('_placeholder_'), // Will be replaced
      'autoWire'
    ),
    undefined,
    [configObject]
  )
}

/**
 * Insert .autoWire() call into method chain after .asInterface()
 */
function insertAutoWireIntoChain(
  originalNode: ts.CallExpression,
  autoWireCall: ts.CallExpression,
  context: ts.TransformationContext
): ts.Node {
  const factory = context.factory

  // IMPORTANT: We need to transform the originalNode first to ensure
  // all .asInterface<T>() calls have their type names injected
  const transformedOriginal = ensureTypeNamesInjected(originalNode, context)

  // Update the autoWire call to have the correct expression
  // Instead of _placeholder_, use the transformed original node
  const updatedAutoWire = factory.updateCallExpression(
    autoWireCall,
    factory.createPropertyAccessExpression(
      transformedOriginal,
      'autoWire'
    ),
    autoWireCall.typeArguments,
    autoWireCall.arguments
  )

  return updatedAutoWire
}

/**
 * Recursively transform a node to ensure all .asInterface<T>() calls
 * have their type names injected as string arguments
 */
function ensureTypeNamesInjected(
  node: ts.CallExpression,
  context: ts.TransformationContext
): ts.CallExpression {
  // First, recursively transform the expression (the left side of the call)
  let transformedExpression: ts.Expression = node.expression

  if (ts.isPropertyAccessExpression(node.expression)) {
    const propAccess = node.expression

    // If the expression is itself a call expression, transform it recursively
    if (ts.isCallExpression(propAccess.expression)) {
      const innerTransformed = ensureTypeNamesInjected(propAccess.expression, context)
      transformedExpression = context.factory.updatePropertyAccessExpression(
        propAccess,
        innerTransformed,
        propAccess.name
      )
    }
  }

  // Now check if THIS node is an .asInterface() call that needs transformation
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'asInterface' &&
    node.typeArguments &&
    node.typeArguments.length > 0 &&
    !(node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]))
  ) {
    // Extract type name and inject it
    const typeArg = node.typeArguments[0]
    const typeName = getTypeNameFromTypeNode(typeArg)

    if (typeName) {
      return context.factory.updateCallExpression(
        node,
        transformedExpression,
        node.typeArguments,
        [context.factory.createStringLiteral(typeName), ...node.arguments]
      )
    }
  }

  // Return node with potentially transformed expression
  if (transformedExpression !== node.expression) {
    return context.factory.updateCallExpression(
      node,
      transformedExpression,
      node.typeArguments,
      node.arguments
    )
  }

  return node
}
