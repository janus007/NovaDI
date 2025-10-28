/**
 * NovaDI unplugin for all bundlers
 * Enables automatic type name injection across Vite, webpack, Rollup, esbuild, and more
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { NovadiUnplugin } from '@novadi/core/unplugin'
 *
 * export default {
 *   plugins: [NovadiUnplugin.vite()]
 * }
 * ```
 *
 * @example
 * ```typescript
 * // webpack.config.js
 * const { NovadiUnplugin } = require('@novadi/core/unplugin')
 *
 * module.exports = {
 *   plugins: [NovadiUnplugin.webpack()]
 * }
 * ```
 */

import { createUnplugin } from 'unplugin'
import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import { transformCode } from './transform.js'
import { resolveOptions, type NovadiPluginOptions } from './options.js'

export type { NovadiPluginOptions } from './options.js'

/**
 * NovaDI unplugin factory
 * Supports all major bundlers: Vite, webpack, Rollup, esbuild, Rspack, Rolldown, Farm
 */
export const NovadiUnplugin = createUnplugin<NovadiPluginOptions | undefined>((options = {}) => {
  const resolvedOptions = resolveOptions(options)

  // Cached TypeScript Program for type checking (only if enableAutowiring is true)
  let cachedProgram: ts.Program | null = null
  let programCreateTime = 0
  let totalTransformTime = 0
  let filesTransformed = 0

  /**
   * Find tsconfig.json starting from current directory
   */
  function findTsConfig(): string | null {
    let currentDir = process.cwd()
    while (currentDir !== path.parse(currentDir).root) {
      const tsconfigPath = path.join(currentDir, 'tsconfig.json')
      if (fs.existsSync(tsconfigPath)) {
        return tsconfigPath
      }
      currentDir = path.dirname(currentDir)
    }
    return null
  }

  return {
    name: 'novadi',

    // Build start hook - create TypeScript Program once
    buildStart() {
      if (!resolvedOptions.enableAutowiring) {
        if (resolvedOptions.debug) {
          console.log('[NovaDI] Autowiring disabled, skipping TypeScript Program creation')
        }
        return
      }

      const startTime = performance.now()

      // Find tsconfig.json
      const tsconfigPath = findTsConfig()
      if (!tsconfigPath) {
        console.warn('[NovaDI] tsconfig.json not found, autowiring will not work')
        return
      }

      if (resolvedOptions.debug) {
        console.log(`[NovaDI] Found tsconfig.json at ${tsconfigPath}`)
      }

      // Read and parse tsconfig
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
      if (configFile.error) {
        console.error('[NovaDI] Error reading tsconfig.json:', configFile.error)
        return
      }

      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath)
      )

      // Create TypeScript Program
      cachedProgram = ts.createProgram({
        rootNames: parsedConfig.fileNames,
        options: parsedConfig.options
      })

      programCreateTime = performance.now() - startTime

      if (resolvedOptions.performanceLogging) {
        console.log(`[NovaDI] TypeScript Program created in ${programCreateTime.toFixed(2)}ms`)
      }
    },

    // Resolve .js imports to .ts files (ESM compatibility)
    resolveId(id, importer) {
      // Skip if no importer or if it's an absolute path
      if (!importer || path.isAbsolute(id)) {
        return null
      }

      // If importing .js, try to resolve to .ts
      if (id.endsWith('.js')) {
        const tsId = id.replace(/\.js$/, '.ts')
        const resolvedPath = path.resolve(path.dirname(importer), tsId)

        if (fs.existsSync(resolvedPath)) {
          return resolvedPath
        }
      }

      return null
    },

    // For Vite, webpack, Rollup - determines which files to transform
    transformInclude(id) {
      // Check exclude patterns first (more efficient)
      for (const pattern of resolvedOptions.exclude) {
        if (typeof pattern === 'string') {
          if (id.includes(pattern)) return false
        } else if (pattern.test(id)) {
          return false
        }
      }

      // Check include patterns
      for (const pattern of resolvedOptions.include) {
        if (typeof pattern === 'string') {
          if (id.includes(pattern)) return true
        } else if (pattern.test(id)) {
          return true
        }
      }

      return false
    },

    // Main transformation hook
    transform(code, id) {
      const startTime = performance.now()

      const result = transformCode(code, id, cachedProgram, {
        debug: resolvedOptions.debug,
        compilerOptions: resolvedOptions.compilerOptions
      })

      // Return undefined to skip transformation (unplugin convention)
      if (result === null) {
        return undefined
      }

      const transformTime = performance.now() - startTime
      totalTransformTime += transformTime
      filesTransformed++

      if (resolvedOptions.performanceLogging && resolvedOptions.debug) {
        console.log(`[NovaDI] Transformed ${path.basename(id)} in ${transformTime.toFixed(2)}ms`)
      }

      return {
        code: result,
        map: null // TODO: Add source map support in future
      }
    },

    // Build end hook - cleanup and log stats
    buildEnd() {
      if (resolvedOptions.performanceLogging && filesTransformed > 0) {
        console.log(`[NovaDI] Performance Summary:`)
        console.log(`  - Program creation: ${programCreateTime.toFixed(2)}ms`)
        console.log(`  - Files transformed: ${filesTransformed}`)
        console.log(`  - Total transform time: ${totalTransformTime.toFixed(2)}ms`)
        console.log(`  - Average per file: ${(totalTransformTime / filesTransformed).toFixed(2)}ms`)
        console.log(`  - Total: ${(programCreateTime + totalTransformTime).toFixed(2)}ms`)
      }

      // Cleanup
      cachedProgram = null
      programCreateTime = 0
      totalTransformTime = 0
      filesTransformed = 0
    },

    // Vite-specific hooks
    vite: {
      enforce: 'pre', // Run before Vite's default transforms

      configResolved(_config) {
        if (resolvedOptions.debug) {
          console.log('[NovaDI] Vite config resolved, plugin active')
        }
      }
    },

    // webpack-specific hooks
    webpack(_compiler) {
      if (resolvedOptions.debug) {
        console.log('[NovaDI] webpack plugin active')
      }
    },

    // esbuild-specific hooks
    esbuild: {
      setup(_build) {
        if (resolvedOptions.debug) {
          console.log('[NovaDI] esbuild plugin active')
        }
      }
    }
  }
})

// Export as default for convenience
export default NovadiUnplugin
