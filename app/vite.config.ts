import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config'

// Resolve the virtual registration module's import through pnpm's isolated plugin dependencies.
const pwaRequire = createRequire(createRequire(import.meta.url).resolve('vite-plugin-pwa/package.json'))
const workboxWindowModule = pwaRequire('workbox-window/package.json').module as string

export default defineConfig({
  plugins: [react(), VitePWA(pwaOptions)],
  resolve: {
    alias: [{
      find: /^workbox-window$/,
      replacement: pwaRequire.resolve(`workbox-window/${workboxWindowModule}`),
    }],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', '*.test.ts'],
  },
})
