import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED, SOLO } from '../lib/demo.js'
import { FIREBASE, onAccount, cloudPull, cloudPush, signOutAccount } from '../lib/firebase.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'
import { hydrate } from '../lib/hydrate.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'fr',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null,
  // Daily intake, one entry per day: { d, kcal, p, c, f, t } — see lib/nutrition.js.
  // nutriGoal holds the daily targets, or null while none are set; a target the goal
  // leaves out simply isn't counted down, so kcal-only is a complete setup rather than
  // a half-finished one. Both absent on every profile written before they existed, and
  // absent reads as "never logged", so nothing needs migrating.
  nutrition: [], nutriGoal: null,
  // tdee: maintenance as its parts — { bmr, neat, other, sport } — entered by hand, the one
  // figure in the app nothing can measure for you. `sport` is the training the figure already
  // budgets for, so only the difference between it and what was actually done moves a day's
  // balance. A profile written before the breakdown holds a bare number, which meant
  // expenditure without training and is read as a breakdown budgeting none. null until it is
  // set, and every balance stays absent rather than guessing.
  // watchTrim: the share of a watch's active-energy figure to throw away — wrist devices read
  // energy 20–40 % high. null means the default; an explicit 0 means the user chose to trust
  // the watch as it comes. See lib/energy.js.
  tdee: null, watchTrim: null,
  // Nights slept, filed under the day you woke up: { d, h, q?, t } — see lib/body.js.
  // Body fat rides on the weigh-in itself (an optional `bf` on a bodyweight entry) rather
  // than living here, because that is how a scale reports it. Both absent on every profile
  // written before they existed, and absent reads as never logged.
  sleep: [], sleepGoal: null,
  // Daily figures a watch measured and BodyEvolve cannot: { d, steps, kcal, rhr, exerciseMin }.
  // A watch's reading of a *session* is not here — it annotates the workout already logged
  // that day (w.watch), because two records of one session must stay one session.
  health: []
}
const clone = o => JSON.parse(JSON.stringify(o))

/**
 * Every state entering the app from outside its own memory goes through here: DEF supplies
 * the fields a profile has never written, hydrate() repairs the shapes a round trip broke.
 * Both are needed — DEF only fills the top level, and what Realtime Database drops is
 * nested (a routine's `ex`, a workout's `entries`). See lib/hydrate.js.
 */
const adopt = state => hydrate(Object.assign(clone(DEF), state))

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return adopt(JSON.parse(raw))
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    async pushState() {
      const u = get().user
      if (!u) return
      clearTimeout(pushTm)
      try {
        if (FIREBASE) await cloudPush(u.uid, get().S)
        else await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) })
        localStorage.removeItem('gym_dirty')
      } catch (e) { localStorage.setItem('gym_dirty', '1') }
    },
    async pullState() {
      try {
        const u = get().user
        // Same shape from either back end: whatever this profile last stored, or nothing.
        const state = FIREBASE ? (u ? await cloudPull(u.uid) : null) : (await api('/api/data')).state
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        if (state && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) {
          const active = S.active
          const next = adopt(state)
          if (active) next.active = active
          persist(next, false)
        } else if (hasData(S)) { await get().pushState() }
      } catch (e) { /* offline — keep local */ }
    },

    async signOut() {
      try {
        await get().pushState()
        if (FIREBASE) await signOutAccount()
        else await api('/api/logout', { method: 'POST', body: '{}' })
      } catch (e) { /* */ }
      clearLocalSession()
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Firebase build: the account is restored asynchronously from persisted storage, so
      // boot waits for the first callback rather than reading a value that is null for the
      // first few hundred milliseconds of every cold start and flashing the sign-in screen.
      // The same subscription then carries every later change — signing in, signing out, a
      // token expiring — through one path.
      if (FIREBASE) {
        let first = true
        const done = () => { if (first) { first = false; set({ ready: true }) } }
        // Firebase restores the account from local storage, so this normally fires in
        // milliseconds and without a network. "Normally" is not a guarantee worth hanging a
        // splash screen on, though: if it has not spoken in six seconds, go in anyway. The
        // signed-in state arrives later if it arrives, and nobody is left staring at a logo.
        setTimeout(done, 6000)
        onAccount(async acct => {
          if (acct) {
            get().setUser(acct)
            await get().pullState()
          } else {
            get().setUser(null)
          }
          done()
        }).catch(done)   // SDK unreachable: fall through to the sign-in screen
        return
      }
      // Solo build: no backend, and the data is the user's own — straight in, no API call to
      // wait on and no sign-in screen to offer something that cannot work.
      if (SOLO) {
        get().setGuest(true)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }
