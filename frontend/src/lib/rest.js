/**
 * The rest between sets, as data — what the bar shows at a given moment, and whether a rest
 * saved before the app went away can come back.
 *
 * A rest does not end by disappearing. On an iPhone a web app has no vibration, and the
 * silent switch — on, in most gyms — takes the beep, so with the phone lying on a bench the
 * bar is the only signal there is. It used to vanish at the very second it had something to
 * say. Now it turns into "go" and counts the time since, until the next set is ticked, it is
 * tapped away, or OVER_MAX has passed and it is plainly not a rest any more.
 */

/** Seconds a finished rest stays on screen, counting up. */
export const OVER_MAX = 600

/** Where the running rest is kept, so a reload does not lose it. */
export const REST_KEY = 'gym_rest'

/**
 * Where a rest stands at `now`: seconds left while it runs, then seconds since it ended.
 * `expired` once it has been over for longer than anyone is still resting.
 */
export function restAt(tm, now = Date.now()) {
  if (!tm || !(tm.endsAt > 0)) return { left: 0, over: null, expired: true }
  const ms = tm.endsAt - now
  if (ms > 0) return { left: Math.ceil(ms / 1000), over: null, expired: false }
  const over = Math.max(0, Math.floor((now - tm.endsAt) / 1000))
  return { left: 0, over, expired: over > OVER_MAX }
}

/**
 * A saved rest, if it can come back: it belongs to the session still open, and it ended less
 * than OVER_MAX ago. iOS reloads a web app it has kept in the background long enough — a phone
 * locked on a bench through a long rest is exactly that — and the countdown used to be the one
 * thing of the session that did not survive it.
 */
export function restorable(saved, active, now = Date.now()) {
  if (!saved || !active || !(saved.endsAt > 0)) return null
  if (saved.w && saved.w !== active.id) return null
  const at = restAt(saved, now)
  if (at.expired) return null
  return { endsAt: saved.endsAt, total: saved.total > 0 ? saved.total : Math.max(1, at.left), w: saved.w || active.id, left: at.left, over: at.over }
}
