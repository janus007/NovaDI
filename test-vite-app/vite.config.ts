import { defineConfig } from 'vite'
import { NovadiUnplugin } from '@novadi/core/unplugin'

export default defineConfig({
  plugins: [
    NovadiUnplugin.vite({
      debug: true // Enable debug logging to see transformations
    })
  ]
})
