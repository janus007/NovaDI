/**
 * Vite plugin to apply NovaDI transformer during test compilation
 *
 * This plugin creates a full TypeScript Program with TypeChecker support
 * to enable default autowiring (ParamName → Map conversion) in test environment.
 */
import type { Plugin } from 'vite'
import * as ts from 'typescript'
import * as path from 'path'
import novadiTransformer from './dist/transformer/index.js'

// Cache TypeScript Program for performance
let cachedProgram: ts.Program | null = null

export function novadiTransformerPlugin(): Plugin {
  return {
    name: 'novadi-transformer',
    enforce: 'pre', // Run before other plugins

    // Create TypeScript Program once when build starts
    buildStart() {
      try {
        // Find and read tsconfig.json
        const configPath = ts.findConfigFile(
          process.cwd(),
          ts.sys.fileExists,
          'tsconfig.json'
        )

        if (!configPath) {
          console.warn('[NovaDI] tsconfig.json not found, transformer will run without TypeChecker')
          return
        }

        // Read and parse tsconfig
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
        if (configFile.error) {
          console.error('[NovaDI] Error reading tsconfig:', configFile.error)
          return
        }

        const parsedConfig = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(configPath)
        )

        // Create TypeScript Program with full type information
        cachedProgram = ts.createProgram({
          rootNames: parsedConfig.fileNames,
          options: {
            ...parsedConfig.options,
            noEmit: true, // We only need type checking, not output
          }
        })

        console.log('[NovaDI] TypeScript Program created with TypeChecker support')
      } catch (err) {
        console.error('[NovaDI] Failed to create TypeScript Program:', err)
      }
    },

    transform(code, id) {
      // Only transform TypeScript files, skip node_modules
      if (!id.endsWith('.ts') || id.includes('node_modules')) {
        return null
      }

      try {
        // Create a source file to check if there are any as/resolveInterface calls
        const sourceFile = ts.createSourceFile(
          id,
          code,
          ts.ScriptTarget.ES2020,
          true
        )

        let hasInterfaceCalls = false
        function findInterfaceCalls(node: ts.Node) {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            (node.expression.name.text === 'as' ||
              node.expression.name.text === 'resolveInterface' ||
              node.expression.name.text === 'resolveInterfaceKeyed' ||
              node.expression.name.text === 'resolveInterfaceAll' ||
              node.expression.name.text === 'bindInterface' ||
              node.expression.name.text === 'registerType')
          ) {
            hasInterfaceCalls = true
          }
          ts.forEachChild(node, findInterfaceCalls)
        }
        findInterfaceCalls(sourceFile)

        // Only transform if we found interface calls
        if (!hasInterfaceCalls) {
          return null
        }

        // Create a per-file Program with full type information
        // This is necessary because ts.transpileModule doesn't preserve type context
        const compilerHost = ts.createCompilerHost({
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
        })

        // Override readFile to inject the current file's code
        const originalReadFile = compilerHost.readFile
        compilerHost.readFile = (fileName) => {
          if (fileName === id) {
            return code
          }
          return originalReadFile.call(compilerHost, fileName)
        }

        // Create mini-program for this specific file
        const program = ts.createProgram({
          rootNames: [id],
          options: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
            noEmit: true,
          },
          host: compilerHost
        })

        // Get the source file from program
        const programSourceFile = program.getSourceFile(id)
        if (!programSourceFile) {
          // Fallback to transpileModule without Program
          const result = ts.transpileModule(code, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2020,
              module: ts.ModuleKind.ESNext,
            },
            fileName: id,
            transformers: {
              before: [novadiTransformer(cachedProgram)],
            },
          })
          return {
            code: result.outputText,
            map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
          }
        }

        // Apply transformer with full Program context
        const transformationResult = ts.transform(programSourceFile, [novadiTransformer(program)], {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
        })

        const transformedSourceFile = transformationResult.transformed[0]

        // Print transformed AST back to TypeScript code
        const printer = ts.createPrinter()
        const transformedTSCode = printer.printFile(transformedSourceFile as ts.SourceFile)

        transformationResult.dispose()

        // Now transpile the transformed TypeScript to JavaScript
        const result = ts.transpileModule(transformedTSCode, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
          },
        })

        return {
          code: result.outputText,
          map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
        }
      } catch (err) {
        console.error(`[NovaDI] Failed to transform ${id}:`, err)
        return null
      }
    },
  }
}
