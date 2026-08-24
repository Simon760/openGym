import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.js'

// The preview runs inside an iframe written with srcdoc, so its document URL is
// `about:srcdoc` — which is not a valid base for `new URL()`. HashRouter resolves
// every navigation against the document URL and throws on the first render because
// of it. MemoryRouter keeps its history in a plain array and never touches the
// document URL, which is all the preview needs: navigation works, and the only
// thing lost is an address bar nobody can see.
const memoryRouter = {
  name: 'preview-memory-router',
  transform(code, id) {
    if (!id.endsWith('src/App.jsx')) return null
    if (!code.includes('HashRouter')) {
      throw new Error('App.jsx no longer uses HashRouter — update vite.preview.config.js')
    }
    return code.replace(/\bHashRouter\b/g, 'MemoryRouter')
  }
}

// Build config for the offline single-file preview (scripts/build-preview.mjs).
//
// Everything has to land in one chunk: the output is folded into a single HTML file
// with no server behind it, so a lazily-imported chunk would have nowhere to be
// fetched from. That is only affordable because the preview build also stubs out
// src/instr/ (7 MB of exercise instructions) — the locale packs it does keep are
// under half a megabyte for all twelve languages.
export default mergeConfig(base, defineConfig({
  plugins: [memoryRouter],
  build: {
    rollupOptions: { output: { codeSplitting: false } },
    cssCodeSplit: false,
    modulePreload: false,
    // The preview is read by a person, not a profiler; readable stack traces in the
    // console are worth more here than the last few hundred kilobytes.
    sourcemap: false
  }
}))
