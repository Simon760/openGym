// Daily body readings that are not training: what the scale says beyond the weight, and how
// you slept.
//
// Body fat rides on the weigh-in rather than living in its own list, because that is how it
// is measured — a scale that reports a percentage reports it in the same breath as the
// weight, and two lists would let them drift a day apart for no reason. It is optional on
// every entry: a weigh-in without it is complete, not half-filled.
//
// Sleep is its own list, because it is not measured with the scale and most nights will have
// one without the other.
//
// Fat mass and lean mass are derived, never stored — correcting a percentage corrects both,
// and there is no third number to fall out of step.

import { todayISO } from './format.js'

const num = v => (Number.isFinite(+v) && +v > 0 ? +v : null)
const inWindow = (iso, days, now) =>
  !days || new Date(iso + 'T12:00:00').getTime() > now - days * 86400000

/* ------------------------------------------------------------ composition -- */

// Beyond this a reading is a misplaced decimal or a scale talking to someone else's foot,
// not a body. Refused rather than stored, because a 4 % point on the chart flattens every
// real change around it.
export const BF_MIN = 3
export const BF_MAX = 60

export const validBodyFat = v => {
  const n = num(v)
  return n != null && n >= BF_MIN && n <= BF_MAX ? n : null
}

/** The most recent weigh-in carrying a body-fat reading, or null. */
export function lastComposition(S) {
  const list = (S.bodyweight || []).filter(b => validBodyFat(b.bf) != null)
  return list.length ? list[list.length - 1] : null
}

/**
 * Fat and lean mass for one weigh-in, or null when it has no percentage. Lean mass is the
 * number a cut is actually judged on: losing weight is easy, losing weight that is all fat
 * is the whole exercise, and a weight curve alone cannot tell the two apart.
 */
export function composition(entry) {
  const bf = validBodyFat(entry && entry.bf)
  const w = num(entry && entry.w)
  if (bf == null || w == null) return null
  const fat = Math.round(w * bf) / 100
  return { weight: w, bf, fat, lean: Math.round((w - fat) * 10) / 10 }
}

/**
 * How the composition moved across a window: the oldest and newest readings that carry a
 * percentage, and the change in each of the three numbers. Null when there is no pair —
 * one reading is a measurement, not a trend.
 */
export function compositionTrend(S, days, now = Date.now()) {
  const list = (S.bodyweight || [])
    .filter(b => validBodyFat(b.bf) != null && inWindow(b.d, days, now))
    .map(composition)
  if (list.length < 2) return null
  const [from, to] = [list[0], list[list.length - 1]]
  return {
    from, to, readings: list.length,
    weight: Math.round((to.weight - from.weight) * 10) / 10,
    bf: Math.round((to.bf - from.bf) * 10) / 10,
    fat: Math.round((to.fat - from.fat) * 10) / 10,
    lean: Math.round((to.lean - from.lean) * 10) / 10
  }
}

/** Chart points for the body-fat curve. */
export const bodyFatSeries = (S, days, now = Date.now()) =>
  (S.bodyweight || [])
    .filter(b => validBodyFat(b.bf) != null && inWindow(b.d, days, now))
    .map(b => ({ t: b.t || new Date(b.d + 'T12:00:00').getTime(), y: validBodyFat(b.bf), d: b.d }))

/* ------------------------------------------------------------------ sleep -- */

// A night outside this is a typo — 26 hours is not a night, and a quarter of an hour is not
// sleep worth charting against a target.
export const SLEEP_MIN = 0.5
export const SLEEP_MAX = 16

export const validSleep = v => {
  const n = num(v)
  return n != null && n >= SLEEP_MIN && n <= SLEEP_MAX ? Math.round(n * 100) / 100 : null
}

/**
 * A night's sleep is filed under the day you woke up, not the day you went to bed. That is
 * the day it affects — the session you are about to train, the appetite you are about to
 * fight — and it is also the only reading that lines up with the weigh-in and the intake
 * already stored under that date.
 */
export const sleepFor = (S, iso) => (S.sleep || []).find(e => e.d === iso) || null
export const lastSleep = S => {
  const list = S.sleep || []
  return list.length ? list[list.length - 1] : null
}

/** Insert or replace a night, returning a new sorted list. Clearing the hours drops it. */
export function putSleep(list, entry) {
  const rest = (list || []).filter(e => e.d !== entry.d)
  const h = validSleep(entry.h)
  if (h == null) return rest.sort(byDate)
  const out = { d: entry.d, h, t: entry.t || Date.now() }
  const q = num(entry.q)
  if (q != null && q >= 1 && q <= 5) out.q = Math.round(q)
  return [...rest, out].sort(byDate)
}

/**
 * Average hours over a window, with the nights it speaks for. Same rule the intake averages
 * follow: a night nobody logged is a gap, not a night of no sleep, and dividing by the
 * length of the window would report a solid week as insomnia.
 */
export function sleepAverage(S, days, now = Date.now()) {
  const list = (S.sleep || []).filter(e => inWindow(e.d, days, now) && validSleep(e.h) != null)
  if (!list.length) return { nights: 0, hours: null, quality: null }
  const hours = list.reduce((a, e) => a + e.h, 0) / list.length
  const rated = list.filter(e => e.q != null)
  return {
    nights: list.length,
    hours: Math.round(hours * 10) / 10,
    quality: rated.length ? Math.round((rated.reduce((a, e) => a + e.q, 0) / rated.length) * 10) / 10 : null,
    ratedNights: rated.length
  }
}

/**
 * Hours short of the target across the window, over the logged nights only. Positive means
 * a shortfall; a surplus is returned as a negative rather than clamped, because sleeping
 * more than the target is information too.
 */
export function sleepDebt(S, days, goal, now = Date.now()) {
  const g = num(goal)
  if (g == null) return null
  const list = (S.sleep || []).filter(e => inWindow(e.d, days, now) && validSleep(e.h) != null)
  if (!list.length) return null
  return { nights: list.length, hours: Math.round(list.reduce((a, e) => a + (g - e.h), 0) * 10) / 10 }
}

/** Chart points for the sleep curve. */
export const sleepSeries = (S, days, now = Date.now()) =>
  (S.sleep || [])
    .filter(e => inWindow(e.d, days, now) && validSleep(e.h) != null)
    .map(e => ({ t: new Date(e.d + 'T12:00:00').getTime(), y: e.h, d: e.d }))

export const todaySleep = S => sleepFor(S, todayISO())

const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)
