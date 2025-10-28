import { NovadiUnplugin } from '../dist/unplugin/index.js'

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'esm',
    sourcemap: true
  },
  plugins: [
    NovadiUnplugin.rollup({
      enableAutowiring: true,
      performanceLogging: true,
      debug: true
    })
    // No separate TypeScript plugin needed - unplugin handles TS→JS compilation
  ]
}
