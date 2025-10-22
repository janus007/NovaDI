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
import { transformCode } from './transform.js'
import { resolveOptions, type NovadiPluginOptions } from './options.js'

export type { NovadiPluginOptions } from './options.js'

/**
 * NovaDI unplugin factory
 * Supports all major bundlers: Vite, webpack, Rollup, esbuild, Rspack, Rolldown, Farm
 */
export const NovadiUnplugin = createUnplugin<NovadiPluginOptions | undefined>((options = {}) => {
  const resolvedOptions = resolveOptions(options)

  return {
    name: 'novadi',

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
      const result = transformCode(code, id, {
        debug: resolvedOptions.debug,
        compilerOptions: resolvedOptions.compilerOptions
      })

      // Return undefined to skip transformation (unplugin convention)
      if (result === null) {
        return undefined
      }

      return {
        code: result,
        map: null // TODO: Add source map support in future
      }
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
