import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/unplugin/index.ts'],
  outDir: 'dist/unplugin',
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['typescript', 'unplugin'],
  treeshake: true,
  splitting: false,
})
