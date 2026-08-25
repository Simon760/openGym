// Put a state back into the shape the app renders, whatever a round trip did to it.
//
// This exists because of one property of Firebase Realtime Database: **it cannot store an
// empty container**. `set(ref, { ex: [] })` does not write an empty array — it deletes the
// key, exactly as writing null would. A routine with no exercises comes back with no `ex`
// at all, and the first `r.ex.length` throws. The screen behind the error boundary is the
// Plan tab, then the workout picker, then anything else that trusted its own schema.
//
// A second property compounds it: an array is stored as an object keyed "0", "1", "2", and
// only converted back to an array when those keys are contiguous from zero. Anything else
// comes back as an object, and `.map` is not a function.
//
// Neither is a bug in Firebase — both are documented — and neither can be avoided on the
// write side. So the wire format is now an opaque JSON string (see lib/firebase.js), which
// no store can reshape, and this repairs what the old format already left in an account.
// It also guards the two other doors a state comes through: a backup file someone edited by
// hand, and a localStorage copy written by a build that has since changed its schema.

/** An array, whatever it arrived as. RTDB hands back {0:…,1:…} for anything non-contiguous. */
const list = v => {
  if (Array.isArray(v)) return v.filter(x => x != null)
  if (v && typeof v === 'object') {
    // Numeric keys, in numeric order — "10" must not sort before "9".
    const keys = Object.keys(v).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b)
    if (keys.length) return keys.map(k => v[k]).filter(x => x != null)
  }
  return []
}

/** A plain object, whatever it arrived as — `week` round-trips as an array when its keys allow. */
const dict = v => {
  if (Array.isArray(v)) {
    const out = {}
    v.forEach((x, i) => { if (x != null) out[i] = x })
    return out
  }
  return v && typeof v === 'object' ? v : {}
}

/** One logged or running workout: entries, and the sets inside them. */
const workout = w => (!w || typeof w !== 'object' ? null : {
  ...w,
  entries: list(w.entries).map(e => (e && typeof e === 'object' ? { ...e, sets: list(e.sets) } : null)).filter(Boolean)
})

/**
 * Repair a state read from anywhere that is not this app's own memory.
 *
 * Only shapes are touched — a missing list becomes empty, an object that should be a list
 * becomes one. Nothing is invented and nothing is dropped for being unfamiliar, because a
 * field this build does not know is a field a newer build wrote, and discarding it here
 * would delete it on the next push.
 */
export function hydrate(state) {
  const S = state && typeof state === 'object' ? { ...state } : {}

  // The cloud node's own bookkeeping, if a state was ever adopted straight from it — an older
  // build reading the version-2 node keeps these as if they were fields, and re-pushing them
  // would nest one snapshot inside the next. They are not part of a state.
  delete S.v
  delete S.json

  for (const k of ['bodyweight', 'routines', 'workouts', 'customEx', 'nutrition', 'sleep', 'health']) S[k] = list(S[k])
  for (const k of ['week', 'dayPlan', 'exWeights']) S[k] = dict(S[k])

  S.routines = S.routines
    .filter(r => r && typeof r === 'object')
    .map(r => ({ ...r, ex: list(r.ex).filter(e => e && typeof e === 'object') }))
  S.workouts = S.workouts.map(workout).filter(Boolean)
  S.active = S.active ? workout(S.active) : null

  // A day pointing at a routine that is no longer there renders as a rest day either way,
  // but leaving it means the pointer comes back the moment a new routine reuses that id.
  const ids = new Set(S.routines.map(r => r.id))
  for (const d of Object.keys(S.week)) if (!ids.has(S.week[d])) delete S.week[d]

  return S
}
