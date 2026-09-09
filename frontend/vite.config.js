import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Which build this is, stamped in at build time and shown at the bottom of Settings.
 *
 * Without it neither side of a bug report can tell a fix that is wrong from a fix that has
 * simply not been deployed yet, and both look identical from a phone: "nothing changed".
 * Vercel hands the commit over in the environment; a local build asks git; anything else
 * says so rather than inventing a number.
 */
const sha = (process.env.VERCEL_GIT_COMMIT_SHA || (() => {
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' }
})()).slice(0, 7) || 'dev'
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version
const BUILD = { v: version, sha, at: new Date().toISOString().slice(0, 16).replace('T', ' ') }

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: { chunkSizeWarningLimit: 1500 }
})
