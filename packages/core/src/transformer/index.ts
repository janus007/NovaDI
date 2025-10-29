/**
 * NovaDI TypeScript Transformer
 *
 * Automatically injects type names into:
 * - .as<T>() → .as<T>("TypeName")
 * - .resolveType<T>() → .resolveType<T>("TypeName")
 * - .bindInterface<T>(value) → .bindInterface<T>(value, "TypeName")
 * - .registerType(X) → .registerType(X).autoWire({ mapResolvers: [...] }) (default autowiring)
 *
 * Array-based autowiring (minification-safe, O(1) performance):
 * The transformer generates a resolver array in parameter position order:
 * Example: constructor(eventBus: IEventBus, apiKey: string, logger: ILogger)
 * Transforms to: .autoWire({ mapResolvers: [
 *   (c) => c.resolveType("IEventBus"),  // Position 0
 *   undefined,                                // Position 1 (primitive)
 *   (c) => c.resolveType("ILogger")      // Position 2
 * ]})
 *
 * Benefits:
 * - Minification-safe: Array position is immutable
 * - Refactoring-friendly: Transformer regenerates on recompile
 * - Optimal performance: O(1) array access per parameter
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
        // Transform .as<T>(), .resolveType<T>(), and .bindInterface<T>() calls
        if (ts.isCallExpression(node)) {
          // IMPORTANT: Transform default autowiring FIRST (before type name injection)
          // This allows transformDefaultAutowiring to see the original type arguments
          if (checker) {
            const transformedAutowire = transformDefaultAutowiring(node, context, checker)
            if (transformedAutowire !== node) {
              return transformedAutowire
            }
          }

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
        }

        return ts.visitEachChild(node, visitor, context)
      }

      return ts.visitNode(sourceFile, visitor) as ts.SourceFile
    }
  }
}

/**
 * Transform .as<T>() to .as<T>("TypeName")
 */
function transformAsInterface(
  node: ts.CallExpression,
  context: ts.TransformationContext
): ts.Node {
  // Check if this is a .as() call
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return node
  }

  const propAccess = node.expression
  if (propAccess.name.text !== 'as') {
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
 * Transform .resolveType<T>() to .resolveType<T>("TypeName")
 */
function transformResolveInterface(
  node: ts.CallExpression,
  context: ts.TransformationContext
): ts.Node {
  // Check if this is a .resolveType() call
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return node
  }

  const propAccess = node.expression
  if (propAccess.name.text !== 'resolveType' &&
      propAccess.name.text !== 'resolveTypeKeyed' &&
      propAccess.name.text !== 'resolveTypeAll') {
    return node
  }

  // Check if it has type arguments
  if (!node.typeArguments || node.typeArguments.length === 0) {
    return node
  }

  // For resolveTypeKeyed, skip if already has 1+ arguments (the key)
  if (propAccess.name.text === 'resolveTypeKeyed' && node.arguments.length > 0) {
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
 * Check if call chain should be transformed for autowiring
 * @internal
 */
function shouldTransformForAutowiring(
  node: ts.CallExpression,
  chain: ts.CallExpression[]
): { shouldTransform: boolean; registerTypeIndex: number } {
  // Only transform if this is an .as() or .asDefaultInterface() call
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return { shouldTransform: false, registerTypeIndex: -1 }
  }

  const methodName = node.expression.name.text
  if (methodName !== 'as' && methodName !== 'asDefaultInterface') {
    return { shouldTransform: false, registerTypeIndex: -1 }
  }

  // Find .registerType() call in the chain
  const registerTypeIndex = chain.findIndex(call =>
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'registerType'
  )

  return {
    shouldTransform: registerTypeIndex !== -1,
    registerTypeIndex
  }
}

/**
 * Check if chain already has explicit mapResolvers
 * @internal
 */
function hasExplicitMapResolvers(chain: ts.CallExpression[]): boolean {
  const existingAutoWireCall = chain.find(call =>
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'autoWire'
  )

  if (existingAutoWireCall && existingAutoWireCall.arguments.length > 0) {
    const arg = existingAutoWireCall.arguments[0]
    if (ts.isObjectLiteralExpression(arg)) {
      return arg.properties.some(prop =>
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === 'mapResolvers'
      )
    }
  }

  return false
}

/**
 * Extract parameters using best available method (TypeChecker or AST)
 * @internal
 */
function extractParameters(
  node: ts.CallExpression,
  registerTypeCall: ts.CallExpression,
  checker: ts.TypeChecker
): Array<{ index: number; typeName: string | null }> {
  const constructorArg = registerTypeCall.arguments[0]

  // Tier 1: TypeChecker (fast and accurate)
  const constructorType = checker.getTypeAtLocation(constructorArg)
  let constructorParams = getConstructorParameters(constructorType, checker)

  // Tier 2: AST fallback
  let astFallbackParams: Array<{ name: string; typeName: string | null }> | null = null
  if (constructorParams.length === 0) {
    const classDecl = findClassDeclarationInChain(node, checker)
    if (classDecl) {
      astFallbackParams = extractConstructorParametersFromAST(classDecl)
    }
  }

  // Build resolver entries
  const resolverEntries: Array<{ index: number; typeName: string | null }> = []

  if (astFallbackParams) {
    // Use AST parameters
    for (let i = 0; i < astFallbackParams.length; i++) {
      resolverEntries.push({
        index: i,
        typeName: astFallbackParams[i].typeName
      })
    }
  } else {
    // Use TypeChecker parameters
    for (let i = 0; i < constructorParams.length; i++) {
      const param = constructorParams[i]
      const interfaceName = getInterfaceNameFromType(param.type)
      resolverEntries.push({
        index: i,
        typeName: interfaceName
      })
    }
  }

  // Tier 2.5: AST fallback for Any/Unknown types
  if (resolverEntries.length > 0 && resolverEntries.every(entry => entry.typeName === null)) {
    const classDecl = findClassDeclarationInChain(node, checker)
    if (classDecl) {
      const astParams = extractConstructorParametersFromAST(classDecl)
      if (astParams.length > 0 && astParams.some(p => p.typeName !== null)) {
        resolverEntries.length = 0
        for (let i = 0; i < astParams.length; i++) {
          resolverEntries.push({
            index: i,
            typeName: astParams[i].typeName
          })
        }
      }
    }
  }

  return resolverEntries
}

/**
 * Transform default autowiring:
 * .registerType(X).as<Y>() → .registerType(X).as<Y>().autoWire({ mapResolvers: [...] })
 *
 * Generates array of resolvers in parameter position order for optimal O(1) performance.
 * Minification-safe and refactoring-friendly.
 */
function transformDefaultAutowiring(
  node: ts.CallExpression,
  context: ts.TransformationContext,
  checker: ts.TypeChecker
): ts.Node {
  // Check if this is a method chain that should be transformed
  const chain = getMethodChain(node)
  const { shouldTransform, registerTypeIndex } = shouldTransformForAutowiring(node, chain)

  if (!shouldTransform) {
    return node
  }

  // Check if already has explicit mapResolvers
  if (hasExplicitMapResolvers(chain)) {
    return node
  }

  // Get constructor argument
  const registerTypeCall = chain[registerTypeIndex]
  if (registerTypeCall.arguments.length === 0) {
    return node
  }

  // Extract parameters using best available method
  const resolverEntries = extractParameters(node, registerTypeCall, checker)

  // If no parameters or all primitives, skip
  if (resolverEntries.length === 0 || resolverEntries.every(entry => entry.typeName === null)) {
    return node
  }

  // Generate .autoWire({ mapResolvers: [...] }) call
  const autoWireCall = createAutoWireMapResolversCall(resolverEntries, context)

  // Insert autoWire call into the method chain
  return insertAutoWireIntoChain(node, autoWireCall, context)
}

/**
 * Get all method calls in a chain (e.g., builder.registerType(X).as<Y>().singleInstance())
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
 * Extract constructor parameters directly from AST (fallback when TypeChecker unavailable)
 * Works with esbuild and standalone source files outside TypeScript Program
 */
function extractConstructorParametersFromAST(
  classNode: ts.ClassDeclaration
): Array<{ name: string; typeName: string | null }> {
  const params: Array<{ name: string; typeName: string | null }> = []

  // Find constructor declaration
  const constructor = classNode.members.find(
    member => ts.isConstructorDeclaration(member)
  ) as ts.ConstructorDeclaration | undefined

  if (!constructor) {
    return params
  }

  // Extract each parameter with its type annotation
  for (const param of constructor.parameters) {
    if (!param.type) continue

    let paramName: string | null = null
    if (ts.isIdentifier(param.name)) {
      paramName = param.name.text
    }

    const typeName = getTypeNameFromTypeNode(param.type)

    if (paramName && typeName) {
      params.push({ name: paramName, typeName })
    }
  }

  return params
}

/**
 * Find the class declaration node from registration call chain
 * Used for AST fallback when TypeChecker doesn't have type information
 */
function findClassDeclarationInChain(
  node: ts.CallExpression,
  checker: ts.TypeChecker
): ts.ClassDeclaration | null {
  const chain = getMethodChain(node)
  const registerTypeCall = chain.find(call =>
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'registerType'
  )

  if (!registerTypeCall || registerTypeCall.arguments.length === 0) {
    return null
  }

  const classArg = registerTypeCall.arguments[0]

  // Try to get the symbol and find its declaration
  const symbol = checker.getSymbolAtLocation(classArg)
  if (!symbol || !symbol.valueDeclaration) {
    return null
  }

  if (ts.isClassDeclaration(symbol.valueDeclaration)) {
    return symbol.valueDeclaration
  }

  return null
}

/**
 * Create AST for .autoWire({ mapResolvers: [(c) => c.resolveType("IEventBus"), undefined, ...] })
 * Array-based autowiring with optimal O(1) performance
 * Minification-safe and refactoring-friendly (transformer regenerates on recompile)
 */
function createAutoWireMapResolversCall(
  entries: Array<{ index: number; typeName: string | null }>,
  context: ts.TransformationContext
): ts.CallExpression {
  const factory = context.factory

  // Create array of resolvers: [(c) => c.resolveType("TypeName"), undefined, ...]
  const resolverExpressions = entries.map(entry => {
    if (entry.typeName === null) {
      // Primitive type → undefined
      return factory.createIdentifier('undefined')
    } else {
      // Interface type → (c) => c.resolveType("TypeName")
      return factory.createArrowFunction(
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
        // c.resolveType("TypeName")
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier('c'),
            'resolveType'
          ),
          undefined,
          [factory.createStringLiteral(entry.typeName)]
        )
      )
    }
  })

  // Create: { mapResolvers: [...] }
  const configObject = factory.createObjectLiteralExpression([
    factory.createPropertyAssignment(
      'mapResolvers',
      factory.createArrayLiteralExpression(resolverExpressions, true)
    )
  ], true)

  // Create: .autoWire({ mapResolvers: [...] })
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
 * Insert .autoWire() call into method chain after .as()
 */
function insertAutoWireIntoChain(
  originalNode: ts.CallExpression,
  autoWireCall: ts.CallExpression,
  context: ts.TransformationContext
): ts.Node {
  const factory = context.factory

  // IMPORTANT: We need to transform the originalNode first to ensure
  // all .as<T>() calls have their type names injected
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
 * Recursively transform a node to ensure all .as<T>() calls
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

  // Now check if THIS node is an .as() call that needs transformation
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'as' &&
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
