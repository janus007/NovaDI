import { defineConfig } from 'vitest/config'
import { novadiTransformerPlugin } from './vite-plugin-novadi-transformer'

export default defineConfig({
  plugins: [novadiTransformerPlugin()],
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95
      }
    }
  }
})
