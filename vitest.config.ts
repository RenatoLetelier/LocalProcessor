import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@server': resolve('src/server') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
