// Health data from a watch, handed over by an Apple Shortcut.
//
// The watch measures what BodyEvolve cannot: how long the session really lasted, what it cost,
// what the heart did, how far you actually ran, how much you slept and walked. BodyEvolve
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
import { parseCSV, parseWhen, unfence, DELIMS } from './import-csv.js'
import { putSleep, validSleep, validBodyFat, validTime, SLEEP_MAX } from './body.js'
import { putEntry, entryFor } from './nutrition.js'
import { todayISO, fmtDate } from './format.js'
import { t } from './i18n.js'

export const HEALTH_FMT = 1

/** Where this copy of the app lives, without the route it happens to be showing. */
export const appURL = () => (typeof location === 'undefined' ? '' : location.origin + location.pathname)

/**
 * The link a Shortcut's "Open URL" action holds, with the values left empty for the watch's
 * variables to be dropped after each "=". Handed over by a button rather than printed in a
 * paragraph, because retyping this on a phone is where the setup dies — and "/i" rather than
 * "/import" so that retyping it is survivable when the clipboard misbehaves.
 */
export const shortcutLink = (kind = 'session', base = appURL()) =>
  base + '#/i?' + (kind === 'day' ? 'steps=&kcal=&sleep=' : 'sport=&min=')

const MACRO_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' }

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
  // Training energy on its own, for a day whose session was never logged here. Distinct from
  // active_kcal, which is the whole day and carries NEAT with it.
  const sport = num(pick(data, 'sport_kcal', 'sportKcal', 'training_kcal', 'workout_kcal'))
  if (sport) out.sport = Math.round(sport)
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

  const intake = num(pick(data, 'intake_kcal', 'intakeKcal', 'calories_eaten', 'kcal_in', 'intake'))
  if (intake) out.intake = Math.round(intake)
  for (const [k, ...names] of [['protein', 'protein', 'p'], ['carbs', 'carbs', 'carbohydrates', 'c'], ['fat', 'fat', 'fats', 'f']]) {
    const g = num(pick(data, ...names))
    if (g) out[k] = Math.round(g * 10) / 10
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
  const wrote = ['steps', 'kcal', 'sport', 'rhr', 'exerciseMin', 'sleepHours', 'bed', 'weight', 'bodyFat',
    'intake', 'protein', 'carbs', 'fat', 'workout']
  if (!wrote.some(k => out[k] != null)) throw new Error(t('that payload has no health data in it'))
  return out
}

/** Insert or replace a day's daily figures, returning a new sorted list. */
export function putHealth(list, entry) {
  const rest = (list || []).filter(e => e.d !== entry.d)
  const kept = { d: entry.d, t: entry.t || Date.now() }
  for (const k of ['steps', 'kcal', 'rhr', 'exerciseMin', 'sport', 'sportMin']) if (entry[k] != null) kept[k] = entry[k]
  if (Object.keys(kept).length <= 2) return rest.sort(byDate)
  return [...rest, kept].sort(byDate)
}

export const healthFor = (S, iso) => (S.health || []).find(e => e.d === iso) || null

/**
 * Write a parsed payload into a draft state (call inside store.update) and report what
 * landed where. The session figures annotate the workout already logged that day rather
 * than creating one: the sets are BodyEvolve's record and the watch has no idea what they
 * were, so a second entry would double every count that reads the log.
 */
export function applyHealth(S, p) {
  const report = { date: p.d, wrote: [], skipped: [] }

  // Merged into the day rather than replacing it, for the reason intake already is: a
  // Shortcut that only ever sends steps must not wipe the energy typed in by hand that
  // morning, and a hand-typed session must not wipe the steps a Shortcut sent at ten. Each
  // source knows only its own fields, and putHealth keeps exactly the ones it is handed.
  // Training energy from a file. Onto the session logged that day when there is one, so it
  // reads like anything else the watch measured; otherwise against the day, exactly where a
  // hand-typed session with nothing to attach to already goes.
  if (p.sport != null) {
    const w = (S.workouts || []).find(x => x.d === p.d)
    if (w) w.watch = { ...(w.watch || {}), kcal: p.sport }
    else S.health = putHealth(S.health, { ...(healthFor(S, p.d) || {}), d: p.d, sport: p.sport })
    report.wrote.push(t('{0} kcal of training', p.sport))
  }

  if (p.steps != null || p.kcal != null || p.rhr != null || p.exerciseMin != null) {
    S.health = putHealth(S.health, { ...(healthFor(S, p.d) || {}), ...p, d: p.d })
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

  // Intake merges into the day rather than replacing it: a history file that carries only
  // the calories must not wipe macros already logged that day, and vice versa.
  if (p.intake != null || p.protein != null || p.carbs != null || p.fat != null) {
    const ex = entryFor(S, p.d) || {}
    S.nutrition = putEntry(S.nutrition, {
      d: p.d,
      kcal: p.intake != null ? p.intake : ex.kcal,
      p: p.protein != null ? p.protein : ex.p,
      c: p.carbs != null ? p.carbs : ex.c,
      f: p.fat != null ? p.fat : ex.f
    })
    if (p.intake != null) report.wrote.push(t('{0} kcal eaten', p.intake))
    const g = ['protein', 'carbs', 'fat'].filter(k => p[k] != null)
    if (g.length) report.wrote.push(t('{0} logged', g.map(k => t(MACRO_LABEL[k])).join(', ')))
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
      // No session logged that day, and this used to be the end of it — the figures were
      // reported as skipped and dropped. But a watch measuring a session is evidence that
      // the session happened, whether or not it was logged here: someone who trained
      // without the app, or has not logged it yet, still burned what the watch says. The
      // energy is filed against the day instead. It is training energy either way, so
      // nothing takes NEAT off it. What is NOT done is inventing a workout to hang it on:
      // an empty session in the log would count as trained in every streak and every
      // volume figure that reads it.
      const kcal = p.workout.kcal, min = p.workout.minutes
      if (kcal != null || min != null) {
        S.health = putHealth(S.health, { ...(healthFor(S, p.d) || {}), d: p.d, sport: kcal, sportMin: min })
        report.wrote.push(kcal != null
          ? t('{0} kcal of training on a day with no session logged', kcal)
          : t('{0} min of training on a day with no session logged', min))
      } else {
        report.skipped.push(t('the session details — nothing was logged in BodyEvolve that day'))
      }
    }
  }
  return report
}


/* --------------------------------------------------- tracker CSV exports -- */

/* Whoop, Fitbit, Garmin, Oura and the rest all offer a CSV export, and all of them name
 * their columns differently. Rather than four brittle per-vendor parsers, the header is
 * matched loosely against the handful of things BodyEvolve can actually store, and the mapping
 * it settled on is shown before a single day is written.
 *
 * This is deliberately not a live sync. Every one of those vendors gates its API behind
 * OAuth 2.0 and a registered developer application with a redirect URI, which needs a
 * deployed instance and a per-vendor approval; Oura has stopped issuing personal tokens
 * outright, and Google Fit is being retired in favour of Health Connect, which is Android
 * native. A file you already have rights to export works today, everywhere, for free.
 */

// Accents stripped, because the file may well have been written in French; "%" kept as a
// word, because "Fat %" and "Fat (g)" are different columns and everything else about them
// normalises to the same three letters.
const norm = h => String(h || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\(.*?\)/g, ' ').replace(/[_\-]+/g, ' ').replace(/%/g, ' pct ')
  .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

// Longest, most specific names first: "sleep duration" must not be eaten by "duration".
export const CSV_COLUMNS = [
  ['date', ['date', 'day', 'jour', 'cycle start time', 'calendar date', 'timestamp', 'start']],
  ['bed', ['bedtime start', 'sleep start', 'sleep onset', 'bedtime', 'went to bed', 'start time', 'coucher', 'heure de coucher']],
  ['wake', ['bedtime end', 'sleep end', 'wake onset', 'wake time', 'woke up', 'end time', 'reveil', 'heure de reveil']],
  ['awakeMin', ['awake time', 'awake duration', 'minutes awake', 'wake duration', 'time awake', 'reveils', 'reveils nocturnes']],
  ['sleepDur', ['asleep duration', 'sleep duration', 'minutes asleep', 'hours of sleep',
    'sleep hours', 'time asleep', 'total sleep', 'sleep total', 'sommeil', 'duree de sommeil']],
  // Intake before expenditure: "calories" alone means burned in every tracker export, so
  // the eaten column has to claim its own header before the burned list gets that far.
  ['intake', ['calories eaten', 'kcal in', 'calories in', 'energy intake', 'intake kcal',
    'food calories', 'kcal eaten', 'energy in', 'intake', 'eaten', 'apports', 'kcal apports',
    'calories ingerees', 'apport calorique']],
  ['protein', ['protein g', 'protein grams', 'protein', 'proteins', 'proteines']],
  ['carbs', ['carbs g', 'carb grams', 'carbs', 'carb', 'carbohydrate', 'carbohydrates', 'glucides']],
  ['steps', ['steps', 'step count', 'total steps', 'pas', 'nombre de pas']],
  // Two different figures that a spreadsheet calls by nearly the same name, and telling them
  // apart is the difference between an honest deficit and one inflated every day. What a
  // *session* cost is training and nothing else. What the *day* burned actively is training
  // plus all the walking, which a maintenance figure already budgets as NEAT — so the day
  // total gets that NEAT taken back off it and the session figure does not. Merging the two
  // columns, as this used to, silently applies the wrong one of those rules to half a
  // history. Session first: "sport kcal" must claim its header before the day's list runs.
  ['sport', ['sport kcal', 'training kcal', 'workout calories', 'workout kcal',
    'exercise calories', 'session kcal', 'kcal sport', 'depense sport', 'sport',
    'entrainement', 'kcal entrainement', 'seance kcal']],
  ['kcal', ['active calories', 'calories burned', 'activity calories', 'active energy',
    'energy burned', 'total burned', 'calories brulees', 'energie active', 'depense active',
    'calories', 'depense']],
  ['rhr', ['resting heart rate', 'resting hr', 'lowest resting heart rate', 'rhr', 'fc repos', 'fc au repos']],
  ['weight', ['weight kg', 'weight', 'body weight', 'poids', 'poids kg']],
  // Body fat before the fat macro: "Body fat" ends in " fat" and the macro list would
  // otherwise swallow it. "Fat %" survives as 'fat pct', which is why norm keeps the sign.
  ['bodyFat', ['body fat pct', 'body fat', 'fat pct', 'fat percentage', 'bodyfat',
    'masse grasse', 'taux de masse grasse', 'mg pct']],
  ['fat', ['fat g', 'fat grams', 'fat', 'fats', 'lipids', 'lipides']],
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

// How far down a paste the header is worth looking for. A person writes a sentence or two
// of introduction, not forty.
const HEADER_SCAN = 40

/**
 * Find the table inside whatever was pasted.
 *
 * A history that came out of a conversation almost never arrives as a bare CSV. It comes
 * wrapped in a ```csv fence, or as a Markdown table of pipes, or under a line of
 * introduction, or — straight out of a French Excel — separated by semicolons, because there
 * the comma is the decimal point. A comma-only reader that starts at line one fails all four
 * the same way: the header never gets split into columns, so there is no date column, so the
 * message blames the file for the one thing that was never wrong with it.
 *
 * So the separator is discovered rather than assumed, and the header is searched for rather
 * than taken from the top. A candidate row only counts as the header once a row below it
 * actually reads as a date under it: prose can look like a header by accident — "Voici le
 * poids, date par date" maps a weight column and a date column — and a table cannot fake
 * having dates in its date column. Where several separators produce a header, the one that
 * recognises the most columns wins.
 */
export function healthRows(text) {
  const body = unfence(text)
  let best = null
  for (const delim of DELIMS) {
    const rows = parseCSV(body, delim)
    for (let i = 0; i < rows.length && i < HEADER_SCAN; i++) {
      if (rows[i].length < 2) continue
      const map = mapHealthHeader(rows[i])
      if (map.date === undefined) continue
      // A Markdown table puts its |---|---| rule between the header and the first row, so
      // look a little further down than the next line before giving up on this candidate.
      if (!rows.slice(i + 1, i + 12).some(r => parseWhen(cell(r, map.date)))) continue
      const score = Object.keys(map).length
      if (!best || score > best.score) best = { rows: rows.slice(i), delim, score }
      break
    }
  }
  // Nothing read as a table. Hand back the plain comma reading so the caller reports what is
  // missing from the file the person thinks they pasted, not from some speculative re-split.
  return best || { rows: parseCSV(body), delim: ',' }
}

/**
 * Read a tracker export into one payload per day, plus the mapping it used. Nothing is
 * written here — the caller shows the mapping and the day count first, because a header
 * matched wrongly is the failure mode and it is invisible once the rows are in.
 */
export function parseHealthCSV(text) {
  const { rows, delim } = healthRows(text)
  if (rows.length < 2) throw new Error(t('that file has no rows in it'))
  const map = mapHealthHeader(rows[0])
  if (map.date === undefined) throw new Error(t('no date column found — the first line has to name the columns, like Date,Weight'))

  // A row wider than the header means a comma inside a value split it, and in a French file
  // that comma is almost always a decimal point: "2025-03-12,84,2" is three fields, and read
  // in order it files 84 kg instead of 84.2. Nothing about that looks wrong afterwards — the
  // weight is plausible, the curve is just quietly off — so it is caught here rather than
  // trusted. Values containing a real comma survive when they are quoted, which is what the
  // quoted-field branch of the CSV reader is for.
  const wide = delim === ',' ? rows.findIndex((r, i) => i > 0 && r.length > rows[0].length) : -1
  if (wide > 0) {
    throw new Error(t('line {0} has more values than there are columns — a decimal comma splits a row in two. Write 84.2, not 84,2.', wide + 1))
  }

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
    const sport = numCell(row, map.sport); if (sport) p.sport = Math.round(sport)
    const rhr = numCell(row, map.rhr); if (rhr) p.rhr = Math.round(rhr)
    const kg = numCell(row, map.weight); if (kg) p.weight = Math.round(kg * 10) / 10
    const bf = validBodyFat(numCell(row, map.bodyFat)); if (bf != null) p.bodyFat = bf

    // What was eaten. An empty cell is a day nobody logged, not a day of fasting, so it
    // stays absent — a zero here would drag every average and every deficit total with it.
    const intake = numCell(row, map.intake); if (intake) p.intake = Math.round(intake)
    for (const [k, i] of [['protein', map.protein], ['carbs', map.carbs], ['fat', map.fat]]) {
      const g = numCell(row, i); if (g) p[k] = Math.round(g * 10) / 10
    }

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
 * The file to ask a conversation for, when the history lives in one. CSV rather than JSON:
 * a conversation writes it without breaking it, you can read it before importing it, and an
 * empty cell stays empty — which is the whole point, because a day nobody logged must not
 * arrive as a zero.
 *
 * Translated as one block rather than a dozen keys: it is read as a whole and copied as a
 * whole, and a paragraph translated in isolation from the one above it drifts. A function
 * and not a constant, because the dictionary is not loaded yet when this module is.
 */
export const historySpec = () => t(`A retroactive history — one row per day, as far back as it goes.

Ask for exactly this:

  Write my whole history as CSV, one row per day, oldest first.
  First line exactly:

  Date,Intake kcal,Protein,Carbs,Fat,Sport kcal,Weight,Body fat,Steps,Bedtime,Wake time

  Rules:
  · Date as YYYY-MM-DD (2025-03-12)
  · Leave a cell EMPTY when the figure was never recorded that day — never write 0.
    A day with calories but no macros leaves Protein, Carbs and Fat empty. A day with no
    training leaves Sport kcal empty. Both are ordinary and both import fine.
  · Intake and Sport in kcal, macros in grams, weight in kg (78.4), body fat in %
  · Bedtime and Wake time as HH:MM
  · Drop any column you have no data for at all

Then paste the answer straight in here, or save it as a .csv and open the file.

Only the date is required — Date,Intake kcal alone is a complete file. Column names do not
have to match: French names and the usual tracker exports are understood too, and the mapping
is shown before a single day is written.

Two burns, and they are not the same number. Sport kcal is what a session cost, and nothing
is taken off it. Active energy is what the whole day burned actively — training plus every
step walked — and the walking is already inside your maintenance figure as NEAT, so that
column gets it taken back off. Put a session figure under Sport kcal; only use Active energy
for a whole-day reading off a watch.

Paste it however it came out. A fenced code block, a Markdown table of pipes, a sentence above
it, semicolons instead of commas — all four read the same. The one thing that breaks is a
decimal comma in a comma-separated file: write 84.2, not 84,2.`)

/**
 * The Shortcut, written out as the actions to drop in. Kept beside the parser so the two
 * cannot drift: this is what the app expects, and the parser above is its only reader.
 */
/**
 * The Shortcut, written out as the actions to drop in. Kept beside the parser so the two
 * cannot drift: this is what the app expects, and the parser above is its only reader.
 *
 * The instance's own address is substituted in, because a recipe telling someone to type
 * "your instance URL" is a recipe telling them to go and find it.
 */
export const shortcutRecipe = (base = appURL()) => t(`Two shortcuts, not one. The first fires by itself when a workout ends; the second runs once
a day for steps and sleep. Everything is optional — build only the one you want.

The whole handover is a link: no copying, no pasting, no JSON. One action, with your watch's
values dropped where the numbers are.

════ 1 · WHEN A WORKOUT ENDS (automatic) ════

Shortcuts → Automation → + → Workout → Ends → Run Immediately.
Then, in the shortcut:

  1  Find Workouts
       Sort by End Date · Order Latest First · Limit 1 workout
  2  Open URL
       {URL}#/import?sport=&min=
       Put the cursor right after "sport=" and tap the Variable key above the keyboard →
       Workouts → Active Energy. Same after "min=" → Duration.

That is the whole shortcut. It opens the app, the app shows what arrived, one tap files it
onto the session you logged that day.

════ 2 · ONCE A DAY (steps, sleep, resting heart rate) ════

Shortcuts → Automation → + → Time of Day → 22:00 → Run Immediately.

  1  Find Health Samples · Steps · Today · Calculate Sum
  2  Find Health Samples · Active Energy · Today · Calculate Sum
  3  Find Health Samples · Sleep Analysis · yesterday 18:00 → now · Calculate Sum
       (never "Today": a night starts yesterday and ends today)
  4  Open URL
       {URL}#/import?steps=&kcal=&sleep=
       and drop the results of 1, 2 and 3 after their own "=".

════ WHAT A LINK CAN CARRY ════

  the session   sport=  kcal · min=  minutes · km=  distance
  the day       kcal=  active energy · steps= · rhr=  resting heart rate
  the night     bed=23:14&wake=07:02 · or sleep=7.25 in hours
  food          intake=  kcal · p=  protein · c=  carbs · f=  fat, in grams
  the scale     weight=79.5 · bf=22
  the day it belongs to   date=2026-08-25 — without it, today

Nothing is ever written without showing you first. The session figures annotate the workout
you logged that day rather than becoming a second one, and the watch's energy figure has the
usual overcount taken off it before it counts against anything.

Test it now: paste the link into Safari with numbers in it and see what the app does with it.`).replaceAll('{URL}', base)

