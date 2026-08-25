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
import { parseCSV, parseWhen } from './import-csv.js'
import { putSleep, validSleep, validBodyFat, validTime, SLEEP_MAX } from './body.js'
import { todayISO, fmtDate } from './format.js'
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

  const bed = validTime(pick(data, 'bed', 'bedtime', 'sleep_start', 'went_to_bed'))
  const wake = validTime(pick(data, 'wake', 'wake_time', 'sleep_end', 'got_up'))
  if (bed && wake) {
    out.bed = bed; out.wake = wake
    const awake = num(pick(data, 'awake', 'awake_minutes', 'minutes_awake'))
    if (awake) out.awake = Math.round(awake)
  } else {
    const sleep = num(pick(data, 'sleep_hours', 'sleepHours', 'sleep'))
    if (sleep != null && validSleep(sleep) != null) out.sleepHours = validSleep(sleep)
  }

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
  const wrote = ['steps', 'kcal', 'rhr', 'exerciseMin', 'sleepHours', 'bed', 'weight', 'bodyFat', 'workout']
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

  if (p.bed && p.wake) {
    S.sleep = putSleep(S.sleep, { d: p.d, bed: p.bed, wake: p.wake, awake: p.awake })
    report.wrote.push(t('slept {0} to {1}', p.bed, p.wake))
  } else if (p.sleepHours != null) {
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


/* --------------------------------------------------- tracker CSV exports -- */

/* Whoop, Fitbit, Garmin, Oura and the rest all offer a CSV export, and all of them name
 * their columns differently. Rather than four brittle per-vendor parsers, the header is
 * matched loosely against the handful of things openGym can actually store, and the mapping
 * it settled on is shown before a single day is written.
 *
 * This is deliberately not a live sync. Every one of those vendors gates its API behind
 * OAuth 2.0 and a registered developer application with a redirect URI, which needs a
 * deployed instance and a per-vendor approval; Oura has stopped issuing personal tokens
 * outright, and Google Fit is being retired in favour of Health Connect, which is Android
 * native. A file you already have rights to export works today, everywhere, for free.
 */

const norm = h => String(h || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

// Longest, most specific names first: "sleep duration" must not be eaten by "duration".
export const CSV_COLUMNS = [
  ['date', ['date', 'day', 'cycle start time', 'calendar date', 'timestamp', 'start']],
  ['bed', ['bedtime start', 'sleep start', 'sleep onset', 'bedtime', 'went to bed', 'start time']],
  ['wake', ['bedtime end', 'sleep end', 'wake onset', 'wake time', 'woke up', 'end time']],
  ['awakeMin', ['awake time', 'awake duration', 'minutes awake', 'wake duration', 'time awake']],
  ['sleepDur', ['asleep duration', 'sleep duration', 'minutes asleep', 'hours of sleep',
    'sleep hours', 'time asleep', 'total sleep', 'sleep total']],
  ['steps', ['steps', 'step count', 'total steps']],
  ['kcal', ['active calories', 'calories burned', 'activity calories', 'active energy', 'energy burned', 'calories']],
  ['rhr', ['resting heart rate', 'resting hr', 'lowest resting heart rate', 'rhr']],
  ['weight', ['weight kg', 'weight', 'body weight']],
  ['bodyFat', ['body fat', 'fat percentage', 'body fat percentage', 'fat']],
]

export function mapHealthHeader(header) {
  const map = {}
  const used = new Set()
  // Columns claim fields, not the other way round, so the most specific name that matches a
  // given header wins and a header is never counted twice.
  for (const [field, names] of CSV_COLUMNS) {
    header.forEach((h, i) => {
      if (map[field] !== undefined || used.has(i)) return
      const n = norm(h)
      if (names.some(name => n === name || n.startsWith(name + ' ') || n.endsWith(' ' + name))) {
        map[field] = i; used.add(i)
      }
    })
  }
  return map
}

const cell = (row, i) => (i === undefined ? '' : String(row[i] ?? '').trim())
const numCell = (row, i) => { const n = parseFloat(cell(row, i).replace(',', '.')); return isFinite(n) && n > 0 ? n : null }
// Hours or minutes. The header usually says; where it does not, nobody sleeps 400 hours.
const durUnit = (header, v) =>
  (/\bmin/i.test(header || '') ? 'min' : /\bh(ou)?rs?\b/i.test(header || '') ? 'h' : v > SLEEP_MAX ? 'min' : 'h')

// "23:14", "2026-08-24T23:14:00Z", "11:14 PM" — a clock time out of whatever the export wrote.
function timeCell(row, i) {
  const raw = cell(row, i)
  if (!raw) return null
  const direct = validTime(raw)
  if (direct) return direct
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i.exec(raw)
  if (!m) return null
  let h = +m[1]
  if (m[3]) { const pm = /pm/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12 }
  return validTime(String(h).padStart(2, '0') + ':' + m[2])
}

/**
 * Read a tracker export into one payload per day, plus the mapping it used. Nothing is
 * written here — the caller shows the mapping and the day count first, because a header
 * matched wrongly is the failure mode and it is invisible once the rows are in.
 */
export function parseHealthCSV(text) {
  const rows = parseCSV(text)
  if (rows.length < 2) throw new Error(t('that file has no rows in it'))
  const map = mapHealthHeader(rows[0])
  if (map.date === undefined) throw new Error(t('no date column found — openGym cannot file rows without one'))

  const days = new Map()
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const when = parseWhen(cell(row, map.date))
    if (!when) continue
    const p = days.get(when.d) || { d: when.d }

    const bed = timeCell(row, map.bed), wake = timeCell(row, map.wake)
    if (bed && wake) {
      p.bed = bed; p.wake = wake
      const awake = numCell(row, map.awakeMin)
      if (awake) p.awake = Math.round(awake)
    } else {
      // A duration instead of the two times. Whether it counts hours or minutes is in the
      // header, not the value, and read as the wrong one a 432 becomes eighteen days.
      const dur = numCell(row, map.sleepDur)
      if (dur != null) {
        const h = durUnit(rows[0][map.sleepDur], dur) === 'min' ? dur / 60 : dur
        if (validSleep(h) != null) p.sleepHours = validSleep(h)
      }
    }

    const steps = numCell(row, map.steps); if (steps) p.steps = Math.round(steps)
    const kcal = numCell(row, map.kcal); if (kcal) p.kcal = Math.round(kcal)
    const rhr = numCell(row, map.rhr); if (rhr) p.rhr = Math.round(rhr)
    const kg = numCell(row, map.weight); if (kg) p.weight = Math.round(kg * 10) / 10
    const bf = validBodyFat(numCell(row, map.bodyFat)); if (bf != null) p.bodyFat = bf

    if (Object.keys(p).length > 1) days.set(when.d, p)
  }

  if (!days.size) throw new Error(t('no readable rows in that file'))
  return {
    payloads: [...days.values()].sort((a, b) => (a.d < b.d ? -1 : 1)),
    matched: Object.keys(map).filter(k => k !== 'date').map(k => ({ field: k, column: rows[0][map[k]] })),
    ignored: rows[0].filter((h, i) => h && !Object.values(map).includes(i))
  }
}

/** Write a run of days, reporting one line per day rather than one per field. */
export function applyHealthDays(S, payloads) {
  const report = { wrote: [], skipped: [] }
  payloads.forEach(p => {
    const r = applyHealth(S, p)
    if (r.wrote.length) report.wrote.push(fmtDate(p.d, true) + ' — ' + r.wrote.join(', '))
    r.skipped.forEach(x => { if (!report.skipped.includes(x)) report.skipped.push(x) })
  })
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
