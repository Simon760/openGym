// WebAudio beeps + haptics (ported from the vanilla app). `enabled` gates sound.
//
// iOS keeps an AudioContext suspended unless a tap wakes it, and suspends it again whenever the
// app goes to the background or the screen locks. A beep a timer plays — the end of a rest —
// cannot wake it; only a tap can, so wakeAudio() runs on the taps of a session and the rest's
// last beep plays on a context the last tick woke. The silent switch still silences it: that
// is iOS's rule for this kind of sound, and the one way around it would stop the music playing
// in the gym, so the end of a rest is made visible instead (see lib/rest.js).
let audioCtx = null
const ctx = () => (audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)())

export function wakeAudio() {
  try {
    const c = ctx()
    if (c.state !== 'running') c.resume().catch(() => {})
  } catch (e) { /* */ }
}

export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try {
    const c = ctx()
    if (c.state !== 'running') c.resume().catch(() => {})
    const o = c.createOscillator(), g = c.createGain()
    o.connect(g); g.connect(c.destination)
    o.frequency.value = freq || 880; o.type = 'sine'
    const t0 = c.currentTime + (when || 0)
    g.gain.setValueAtTime(0.001, t0)
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.18))
    o.start(t0); o.stop(t0 + (dur || 0.18) + 0.05)
  } catch (e) { /* */ }
}
export function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ } }
