import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
      '@lib': new URL('./lib', import.meta.url).pathname,
    },
  },
})
