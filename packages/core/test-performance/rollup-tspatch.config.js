import { novadiTransformerPlugin } from './rollup-plugin-novadi.js'

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/bundle-tspatch.js',
    format: 'esm',
    sourcemap: true
  },
  plugins: [
    novadiTransformerPlugin()
  ]
}
