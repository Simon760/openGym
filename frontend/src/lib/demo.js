// Demo build (VITE_DEMO=1) — what runs on the GitHub Pages deployment.
//
// Pages can only serve static files, so there is no API: passkey sign-in, per-profile sync
// and the admin dashboard all need the Node backend and are simply not part of a demo build.
// The app therefore stays in guest mode (everything in localStorage) and boots with a seeded
// example history (demoSeed.js), so the charts, heatmap, streaks and "last time you lifted…"
// pre-fills have something to show instead of an empty shell.
//
// Only these three constants are shared with normal builds: Vite replaces VITE_DEMO at build
// time, so the demo-only UI folds away and the seed generator — imported dynamically — never
// lands in a self-hosted bundle.
export const DEMO = import.meta.env.VITE_DEMO === '1'

// Solo build (VITE_SOLO=1) — the same "no backend" situation as the demo, but with your own
// data instead of a seeded example one. This is what a static host (Vercel, Netlify, Pages)
// serves for one person on one phone: everything lives in this browser's localStorage, so
// there is nothing to sign in to, nothing to sync, and no push server to register with. The
// sign-in screen is skipped entirely rather than offered and then failing.
//
// It is not a lesser build. Every calculation in the app runs on the client; the backend only
// ever existed to hold a profile and move it between devices.
export const SOLO = import.meta.env.VITE_SOLO === '1'
export const DEMO_SEEDED = 'gym_demo_seeded_v1'
export const REPO = 'https://github.com/DuarteSantos8/openGym'
