import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { api } from '../lib/api.js'
import { useStore } from './useStore.js'
import { forgetDismiss, runDismiss, runAllDismiss } from '../lib/dismiss.js'
import { restAt, restorable, REST_KEY } from '../lib/rest.js'

// Fire-and-forget: lets the server push a "rest over" alert if this tab gets suspended
// before the local timer completes. No-ops for guests / offline.
const pushRestTimer = sec => { if (useStore.getState().user) api('/api/push/rest-timer', { method: 'POST', body: JSON.stringify({ seconds: sec }) }).catch(() => {}) }
const cancelPushRestTimer = () => { if (useStore.getState().user) api('/api/push/rest-timer/cancel', { method: 'POST', body: '{}' }).catch(() => {}) }

// The running rest, kept across a reload — see lib/rest.js.
const saveRest = tm => {
  try {
    if (tm) localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: tm.endsAt, total: tm.total, w: tm.w || null }))
    else localStorage.removeItem(REST_KEY)
  } catch (e) { /* private mode, or no storage: the rest just does not survive a reload */ }
}
const restEndSignal = () => {
  const snd = useStore.getState().S.sound
  beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
  vibrate([200, 100, 200])
}

let toastTm = null
let timerInt = null
let timerTick = null
let workInt = null
let workTick = null
let workDone = null

export const useUI = create((set, get) => ({
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', locked, tall }
  toastMsg: '',
  // Which block the Plan screen is editing. Null means the one running, which is the answer
  // almost always. Kept here rather than in the saved state because it is a place you are
  // looking, not a fact about your training — it should not sync to another device or come
  // back tomorrow.
  planBlock: null,
  timer: null,         // rest between sets — { left, total, endsAt, w, over } (over: seconds since it ended)
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label }

  // `tall` keeps a sheet at its full height whatever it holds: a search whose results shrink as
  // you type would otherwise shrink the sheet with them and pull its field down under your thumb.
  openSheet(render, { kind = 'sheet', locked = false, tall = false } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked, tall }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  closeSheet(id) {
    forgetDismiss(id)
    set(s => ({ sheets: s.sheets.filter(x => x.id !== id) }))
  },
  // Waved away rather than closed with one of its buttons — see lib/dismiss.js. The sheet's own
  // handler runs first and keeps what was typed; one that refused the input stays open.
  // Returns whether it stayed.
  dismissSheet(id) {
    const stay = runDismiss(id)
    if (!stay) get().closeSheet(id)
    return stay
  },
  // Everything goes — a link opened the app over whatever was left open. Nobody cancelled
  // anything, so each sheet keeps what was typed into it on the way out.
  closeAll() {
    runAllDismiss()
    set({ sheets: [] })
  },
  editBlock(id) { set({ planBlock: id || null }) },

  toast(msg) {
    set({ toastMsg: msg })
    clearTimeout(toastTm)
    toastTm = setTimeout(() => set({ toastMsg: '' }), 2200)
  },

  startRest(sec) {
    get().stopRest()
    const A = useStore.getState().S.active
    get().runRest({ left: sec, total: sec, endsAt: Date.now() + sec * 1000, w: A ? A.id : null, over: null })
    pushRestTimer(sec)
  },
  // The countdown, then what follows it: at zero the bar stays, turned into "go" and counting
  // the seconds since — see lib/rest.js for why it no longer simply goes away. `quiet` is a
  // rest that ended while the app was closed: shown as over, not announced as ending now.
  runRest(tm, { quiet = false } = {}) {
    saveRest(tm)
    set({ timer: tm })
    timerTick = () => {
      const cur = get().timer
      if (!cur) return
      const at = restAt(cur)
      if (at.expired) { get().stopRest(); return }
      if (at.over == null) {
        if (at.left === cur.left) return
        if (at.left <= 3) beep(useStore.getState().S.sound, 660, 0.1)
        set({ timer: { ...cur, left: at.left } })
        return
      }
      if (cur.over == null && !quiet) restEndSignal()
      if (at.over === cur.over) return
      set({ timer: { ...cur, left: 0, over: at.over } })
    }
    timerInt = setInterval(timerTick, 1000)
    document.addEventListener('visibilitychange', timerTick)
    timerTick()
  },
  // A rest saved before iOS reloaded the app comes back where it is: still running, or over
  // and counting since. Only for the session it was started in.
  resumeRest() {
    if (get().timer) return
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(REST_KEY) || 'null') } catch (e) { /* */ }
    const tm = restorable(saved, useStore.getState().S.active)
    if (!tm) { if (saved) saveRest(null); return }
    get().runRest(tm, { quiet: tm.over != null })
  },
  addRest(sec) {
    const tm = get().timer
    if (!tm || tm.over != null) return
    const left = tm.left + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().stopRest(); return }
    const next = { ...tm, left, total: tm.total + sec, endsAt: tm.endsAt + sec * 1000 }
    saveRest(next)
    set({ timer: next })
    pushRestTimer(left)
  },
  stopRest() {
    if (timerInt) clearInterval(timerInt); timerInt = null
    if (timerTick) document.removeEventListener('visibilitychange', timerTick); timerTick = null
    // A rest already over has had its push; there is nothing left on the server to cancel.
    const tm = get().timer
    if (tm && tm.over == null) cancelPushRestTimer()
    saveRest(null)
    set({ timer: null })
  },

  /* ---- work timer (issue #16) ----
     Times the set itself, not the recovery after it. Kept separate from the rest timer on
     purpose: the two mean opposite things, they must never run together, and a work set is
     something you are watching — so it gets no server push (that endpoint says "rest over",
     and a plank does not need a notification you are staring at anyway).
     `onDone(elapsedSec)` is called both when the countdown reaches zero and on an early
     finish; the elapsed time is what actually gets logged, so stopping at 0:38 of a 0:45
     hold records 0:38 rather than crediting the full target. */
  startWork(sec, label, onDone) {
    get().stopWork()
    get().stopRest()
    const total = Math.max(1, Math.round(sec) || 1)
    const endsAt = Date.now() + total * 1000
    workDone = onDone
    set({ work: { left: total, total, endsAt, label } })
    workTick = () => {
      const wk = get().work
      if (!wk) return
      const left = Math.max(0, Math.round((wk.endsAt - Date.now()) / 1000))
      if (left === wk.left) return
      const snd = useStore.getState().S.sound
      if (left <= 0) {
        beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
        vibrate([200, 100, 200])
        const done = workDone
        get().stopWork()
        if (done) done(wk.total)
        return
      }
      if (left <= 3) beep(snd, 660, 0.1)
      set({ work: { ...wk, left } })
    }
    workInt = setInterval(workTick, 1000)
    document.addEventListener('visibilitychange', workTick)
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    const elapsed = Math.max(1, wk.total - wk.left)
    const done = workDone
    vibrate(30)
    get().stopWork()
    if (done) done(elapsed)
  },
  // Abandon without logging anything.
  stopWork() {
    if (workInt) clearInterval(workInt); workInt = null
    if (workTick) document.removeEventListener('visibilitychange', workTick); workTick = null
    workDone = null
    set({ work: null })
  }
}))
