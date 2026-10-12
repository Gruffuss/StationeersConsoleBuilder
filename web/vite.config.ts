import { defineConfig } from 'vitest/config'  // vite's own defineConfig has no type for `test`
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { GAME_MCP_DEV_PATH, gameMcpProxy } from './src/runtime/devProxy.js'
export default defineConfig({
  plugins: [react()],
  // The path the site is served under: VB_BASE at build time (a GitHub project site serves it under /<repository>/).
  base: process.env.VB_BASE || '/',
  publicDir: 'public',
  worker: { format: 'es' },
  server: { fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../templates/', import.meta.url))] },
    // Send to chip under `npm run dev`: same-origin requests to the game's MCP endpoint (src/runtime/devProxy.ts).
    proxy: { [GAME_MCP_DEV_PATH]: gameMcpProxy() } },
  // The preview server would take server.proxy by default; a built page calls the game directly, so it proxies nothing.
  preview: { proxy: {} },
  // es2022: main.ts and the worker use top-level await. The eager editor and templates exceed the 900 kB warning budget.
  // Keep that budget visible as the bundle grows.
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node' },
})
