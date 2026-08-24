// Health data from a watch, handed over by an Apple Shortcut.
//
// The watch measures what openGym cannot: how long the session really lasted, what it cost,
// what the heart did, how far you actually ran, how much you slept and walked. openGym
// measures what the watch cannot: which exercise, which set, how many reps, how close to
// failure. Neither is the whole picture and neither should try to become the other.
//
// So a payload never creates a session. It *annotates* the one already logged that day —
// two records of one training session must stay one session, or every count in the app
// doubles. A payload arriving on a day with no logged session keeps its daily figures
// (steps, energy, sleep) and reports that the session part had nothing to attach to.
//
// Everything is optional. A Shortcut that only ever sends steps is a complete Shortcut, and
// a field that is absent must never be written as a zero: an unmeasured day and a day spent
// motionless are different facts, and only one of them is worth acting on.

import { extractJSON } from './plan-import.js'
import { putSleep, validSleep, validBodyFat } from './body.js'
import { todayISO } from './format.js'
import { t } from './i18n.js'

export const HEALTH_FMT = 1

const num = v => (Number.isFinite(+v) && +v > 0 ? +v : null)
const pick = (o, ...keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return null }
const isoDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null)

/**
 * Read a payload out of whatever the Shortcut produced — a bare JSON object, or text with
 * one inside it. Field names are accepted in the several shapes a Shortcut ends up
 * producing, because the person assembling it in the Shortcuts editor is dragging blocks
 * around, not writing to a spec.
 */
export function parseHealth(raw) {
  let data
  try { data = typeof raw === 'string' ? extractJSON(raw) : raw }
  catch { throw new Error(t('no health data found in that text')) }
  if (!data || typeof data !== 'object') throw new Error(t('no health data found in that text'))

  const out = { d: isoDate(pick(data, 'date', 'day', 'd')) || todayISO() }

  const steps = num(pick(data, 'steps', 'step_count', 'stepCount'))
  if (steps) out.steps = Math.round(steps)
  const kcal = num(pick(data, 'active_kcal', 'activeEnergy', 'active_energy', 'activeKcal', 'energy'))
  if (kcal) out.kcal = Math.round(kcal)
  const rhr = num(pick(data, 'resting_hr', 'restingHR', 'resting_heart_rate', 'rhr'))
  if (rhr) out.rhr = Math.round(rhr)
  const exercise = num(pick(data, 'exercise_minutes', 'exerciseMinutes', 'move_minutes'))
  if (exercise) out.exerciseMin = Math.round(exercise)

  const sleep = num(pick(data, 'sleep_hours', 'sleepHours', 'sleep'))
  if (sleep != null && validSleep(sleep) != null) out.sleepHours = validSleep(sleep)

  const kg = num(pick(data, 'weight_kg', 'weightKg', 'weight'))
  if (kg) out.weight = Math.round(kg * 10) / 10
  const bf = validBodyFat(pick(data, 'body_fat', 'bodyFat', 'bf'))
  if (bf != null) out.bodyFat = bf

  const w = data.workout || data.session
  if (w && typeof w === 'object') {
    const wo = {}
    const mins = num(pick(w, 'minutes', 'duration', 'min'))
    if (mins) wo.minutes = Math.round(mins)
    const wk = num(pick(w, 'kcal', 'energy', 'calories', 'active_kcal'))
    if (wk) wo.kcal = Math.round(wk)
    const avg = num(pick(w, 'hr_avg', 'hrAvg', 'avg_hr', 'heart_rate'))
    if (avg) wo.hrAvg = Math.round(avg)
    const max = num(pick(w, 'hr_max', 'hrMax', 'max_hr'))
    if (max) wo.hrMax = Math.round(max)
    const km = num(pick(w, 'distance_km', 'distanceKm', 'km', 'distance'))
    if (km) wo.km = Math.round(km * 100) / 100
    const type = pick(w, 'type', 'activity', 'name')
    if (type) wo.type = String(type).slice(0, 60)
    if (Object.keys(wo).length) out.workout = wo
  }

  // A payload carrying only a date says nothing; letting it through would report a
  // successful import that wrote nothing.
  const wrote = ['steps', 'kcal', 'rhr', 'exerciseMin', 'sleepHours', 'weight', 'bodyFat', 'workout']
  if (!wrote.some(k => out[k] != null)) throw new Error(t('that payload has no health data in it'))
  return out
}

/** Insert or replace a day's daily figures, returning a new sorted list. */
export function putHealth(list, entry) {
  const rest = (list || []).filter(e => e.d !== entry.d)
  const kept = { d: entry.d, t: entry.t || Date.now() }
  for (const k of ['steps', 'kcal', 'rhr', 'exerciseMin']) if (entry[k] != null) kept[k] = entry[k]
  if (Object.keys(kept).length <= 2) return rest.sort(byDate)
  return [...rest, kept].sort(byDate)
}

export const healthFor = (S, iso) => (S.health || []).find(e => e.d === iso) || null

/**
 * Write a parsed payload into a draft state (call inside store.update) and report what
 * landed where. The session figures annotate the workout already logged that day rather
 * than creating one: the sets are openGym's record and the watch has no idea what they
 * were, so a second entry would double every count that reads the log.
 */
export function applyHealth(S, p) {
  const report = { date: p.d, wrote: [], skipped: [] }

  if (p.steps != null || p.kcal != null || p.rhr != null || p.exerciseMin != null) {
    S.health = putHealth(S.health, p)
    if (p.steps != null) report.wrote.push(t('{0} steps', p.steps))
    if (p.kcal != null) report.wrote.push(t('{0} kcal burned', p.kcal))
    if (p.rhr != null) report.wrote.push(t('resting heart rate {0}', p.rhr))
  }

  if (p.sleepHours != null) {
    S.sleep = putSleep(S.sleep, { d: p.d, h: p.sleepHours })
    report.wrote.push(t('{0} h of sleep', p.sleepHours))
  }

  if (p.weight != null || p.bodyFat != null) {
    S.bodyweight = S.bodyweight || []
    const ex = S.bodyweight.find(b => b.d === p.d)
    // A percentage with no weight to sit on is dropped rather than invented: composition
    // is a pair, and half of it charts nothing.
    if (p.weight != null) {
      const target = ex || { d: p.d }
      target.w = p.weight
      target.t = Date.now()
      if (p.bodyFat != null) target.bf = p.bodyFat
      if (!ex) S.bodyweight.push(target)
      S.bodyweight.sort(byDate)
      report.wrote.push(t('weight {0}', p.weight))
      if (p.bodyFat != null) report.wrote.push(t('body fat {0} %', p.bodyFat))
    } else if (ex) {
      ex.bf = p.bodyFat
      report.wrote.push(t('body fat {0} %', p.bodyFat))
    } else {
      report.skipped.push(t('a body-fat reading with no weigh-in that day to attach it to'))
    }
  }

  if (p.workout) {
    const w = (S.workouts || []).find(x => x.d === p.d)
    if (w) {
      w.watch = { ...(w.watch || {}), ...p.workout }
      report.wrote.push(t('session details onto {0}', w.name))
    } else {
      report.skipped.push(t('the session details — nothing was logged in openGym that day'))
    }
  }
  return report
}

const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)

/**
 * The Shortcut, written out as the actions to drop in. Kept beside the parser so the two
 * cannot drift: this is what the app expects, and the parser above is its only reader.
 */
export const SHORTCUT_RECIPE = `Shortcuts → new shortcut, then:

1  Find Health Samples · Steps · Today · Calculate Sum
2  Find Health Samples · Active Energy · Today · Calculate Sum
3  Find Health Samples · Sleep Analysis · yesterday 18:00 → now · Calculate Sum
     (never "Today": a night starts yesterday and ends today)
4  Find Workouts · Sort by End Date · Latest 1   → duration, active energy, distance
5  Text, with the numbers from above dropped in:

{ "opengym_health": 1,
  "date": "<today, formatted yyyy-MM-dd>",
  "steps": <1>, "active_kcal": <2>, "sleep_hours": <3>,
  "workout": { "minutes": <4 duration>, "kcal": <4 energy>, "distance_km": <4 distance> } }

6  Copy to Clipboard      → paste it into openGym
   …or Get Contents of URL, POST, to your instance once it is online.

Run it two ways, both from the same shortcut:
· Automation → Workout → Ends → it fires the moment you finish on the watch
· Add to Home Screen, Back Tap, or the Shortcuts app on the watch, to force it any time

Every field is optional — send only what you care about.`
