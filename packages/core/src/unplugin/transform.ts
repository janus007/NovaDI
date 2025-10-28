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
 * @param program TypeScript Program for type checking (optional)
 * @param options Transform options
 * @returns Transformed code or null if no transformation needed
 */
export function transformCode(
  code: string,
  id: string,
  program: ts.Program | null,
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
    // Use Program's sourceFile if available (enables cross-file type resolution)
    // Fallback to standalone sourceFile if not in Program
    let sourceFile = program?.getSourceFile(id)

    if (!sourceFile) {
      // File not in Program or no Program - create standalone sourceFile
      sourceFile = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true,
        id.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )
    }

    // Apply NovaDI transformer
    // Pass program for full type checking and autowiring support
    const result = ts.transform(sourceFile, [novadiTransformer(program)], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      ...options.compilerOptions
    })

    const transformedSourceFile = result.transformed[0]

    // Print back to TypeScript code
    const printer = ts.createPrinter()
    const transformedTsCode = printer.printFile(transformedSourceFile as ts.SourceFile)

    result.dispose()

    // Check if code changed
    if (code === transformedTsCode) {
      // No changes needed
      return null
    }

    if (options.debug) {
      console.log(`[NovaDI] ✓ Transformed ${id}`)
    }

    // Transpile to JavaScript for universal bundler compatibility
    // This ensures the transformer output works with all bundlers
    const jsResult = ts.transpileModule(transformedTsCode, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        esModuleInterop: true,
        skipLibCheck: true,
        ...options.compilerOptions
      },
      fileName: id
    })

    return jsResult.outputText || null
  } catch (error) {
    // Log error but don't fail the build - fail gracefully
    console.error(`[NovaDI] Transform error in ${id}:`, error)
    // Return null to use original code
    return null
  }
}
