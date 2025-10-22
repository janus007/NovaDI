/**
 * Transform logic for NovaDI unplugin
 * Wraps the existing TypeScript transformer
 */

import * as ts from 'typescript'
import novadiTransformer from '../transformer/index.js'

export interface TransformOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Custom TypeScript compiler options */
  compilerOptions?: ts.CompilerOptions
}

/**
 * Transform TypeScript code using NovaDI transformer
 * @param code Source code to transform
 * @param id File path/identifier
 * @param options Transform options
 * @returns Transformed code or null if no transformation needed
 */
export function transformCode(
  code: string,
  id: string,
  options: TransformOptions = {}
): string | null {
  // Skip non-TypeScript files
  if (!id.endsWith('.ts') && !id.endsWith('.tsx')) {
    return null
  }

  // Skip declaration files
  if (id.endsWith('.d.ts')) {
    return null
  }

  // Skip node_modules unless explicitly allowed (@novadi/core itself)
  if (id.includes('node_modules') && !id.includes('@novadi/core')) {
    return null
  }

  if (options.debug) {
    console.log(`[NovaDI] Transforming: ${id}`)
  }

  try {
    // Create source file
    const sourceFile = ts.createSourceFile(
      id,
      code,
      ts.ScriptTarget.Latest,
      true,
      id.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )

    // Apply NovaDI transformer
    // Pass null as program since we're doing basic transformation without type checking
    const result = ts.transform(sourceFile, [novadiTransformer(null)])

    const transformedSourceFile = result.transformed[0]

    // Print back to code
    const printer = ts.createPrinter()
    const transformedCode = printer.printFile(transformedSourceFile as ts.SourceFile)

    result.dispose()

    // Only return if code changed (optimization)
    if (options.debug && code !== transformedCode) {
      console.log(`[NovaDI] ✓ Transformed ${id}`)
    }

    // If code is identical, return null to signal no transformation needed
    return code === transformedCode ? null : transformedCode
  } catch (error) {
    // Log error but don't fail the build - fail gracefully
    console.error(`[NovaDI] Transform error in ${id}:`, error)
    // Return null to use original code
    return null
  }
}
