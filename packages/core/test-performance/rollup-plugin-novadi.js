/**
 * Rollup plugin to apply NovaDI transformer (ts-patch equivalent approach)
 * This is the "traditional" way using transformer directly
 */
import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import novadiTransformer from '../dist/transformer/index.js'

let cachedProgram = null
let programCreateTime = 0
let totalTransformTime = 0
let filesTransformed = 0

export function novadiTransformerPlugin() {
  return {
    name: 'novadi-transformer',

    buildStart() {
      const startTime = performance.now()

      // Find tsconfig.json
      const configPath = path.join(process.cwd(), 'tsconfig.json')

      if (!fs.existsSync(configPath)) {
        console.warn('[NovaDI-TS] tsconfig.json not found')
        return
      }

      // Read and parse tsconfig
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
      if (configFile.error) {
        console.error('[NovaDI-TS] Error reading tsconfig:', configFile.error)
        return
      }

      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      )

      // Create TypeScript Program
      cachedProgram = ts.createProgram({
        rootNames: parsedConfig.fileNames,
        options: parsedConfig.options
      })

      programCreateTime = performance.now() - startTime
      console.log(`[NovaDI-TS] TypeScript Program created in ${programCreateTime.toFixed(2)}ms`)
    },

    resolveId(id, importer) {
      if (!importer || path.isAbsolute(id)) {
        return null
      }

      // Resolve .js imports to .ts files
      if (id.endsWith('.js')) {
        const tsId = id.replace(/\.js$/, '.ts')
        const resolvedPath = path.resolve(path.dirname(importer), tsId)

        if (fs.existsSync(resolvedPath)) {
          return resolvedPath
        }
      }

      return null
    },

    transform(code, id) {
      // Only transform TypeScript files
      if (!id.endsWith('.ts') || id.endsWith('.d.ts')) {
        return null
      }

      // Skip node_modules
      if (id.includes('node_modules') && !id.includes('@novadi/core')) {
        return null
      }

      const startTime = performance.now()

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
        const result = ts.transform(sourceFile, [novadiTransformer(cachedProgram)], {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext
        })

        const transformedSourceFile = result.transformed[0]

        // Print back to TypeScript code
        const printer = ts.createPrinter()
        const transformedTsCode = printer.printFile(transformedSourceFile)

        result.dispose()

        // Transpile to JavaScript
        const jsResult = ts.transpileModule(transformedTsCode, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
            esModuleInterop: true,
            skipLibCheck: true
          },
          fileName: id
        })

        const transformTime = performance.now() - startTime
        totalTransformTime += transformTime
        filesTransformed++

        console.log(`[NovaDI-TS] Transformed ${path.basename(id)} in ${transformTime.toFixed(2)}ms`)

        return {
          code: jsResult.outputText,
          map: null
        }
      } catch (error) {
        console.error(`[NovaDI-TS] Transform error in ${id}:`, error)
        return null
      }
    },

    buildEnd() {
      console.log(`[NovaDI-TS] Performance Summary:`)
      console.log(`  - Program creation: ${programCreateTime.toFixed(2)}ms`)
      console.log(`  - Files transformed: ${filesTransformed}`)
      console.log(`  - Total transform time: ${totalTransformTime.toFixed(2)}ms`)
      console.log(`  - Average per file: ${(totalTransformTime / filesTransformed).toFixed(2)}ms`)
      console.log(`  - Total: ${(programCreateTime + totalTransformTime).toFixed(2)}ms`)

      // Cleanup
      cachedProgram = null
      programCreateTime = 0
      totalTransformTime = 0
      filesTransformed = 0
    }
  }
}
