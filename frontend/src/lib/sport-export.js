// A CSV of the training itself — one row per set, for a coach, a spreadsheet, or a second
// pair of eyes. Not the JSON backup Settings already offers: that is a whole profile meant
// to come back into this app; this is meant to leave it and be read by something else, so it
// is flat, dated, and in the language the app already speaks.
//
// Long format on purpose — one row per set, a session's own figures (duration, energy, body
// weight, volume) repeated on every one of its rows rather than sitting on a header row of
// their own — because that is what a spreadsheet actually pivots and filters on.

import { EXIDX, exName } from './exercises.js'
import { setLabel, durMs, modeOf, isWorking, setTop, setTopReps, isBw } from './history.js'
import { activeBlock } from './blocks.js'
import { fmtDate } from './format.js'
import { t } from './i18n.js'

/**
 * Where the currently-running weekly programme began.
 *
 * A dated block answers this exactly — switching to one is an event with a date on it, see
 * lib/blocks.js. A profile still on the plain weekly plan has no date on it at all, so the
 * start is read back out of what was actually logged instead: the earliest session already
 * carrying one of the routine ids the week runs today. Null when there is nothing to date
 * yet — a week just set up and never trained.
 */
export function currentProgrammeStart(S) {
  const at = activeBlock(S)
  if (at) return at.from
  const ids = new Set(Object.values((S && S.week) || {}))
  if (!ids.size) return null
  return (S.workouts || [])
    .filter(w => ids.has(w.routineId))
    .reduce((min, w) => (min == null || w.d < min ? w.d : min), null)
}

/** The earliest day this profile has anything logged for — the sensible default for "from". */
export function earliestLoggedDay(S) {
  return (S.workouts || []).reduce((min, w) => (min == null || w.d < min ? w.d : min), null)
}

const HEADER = ['Date', 'Séance', 'Exercice', 'Série', 'Répétitions', 'Poids (kg)', 'Détail',
  'Durée séance (min)', 'Énergie séance (kcal)', 'Volume séance (kg)', 'Poids du jour (kg)']

// RFC 4182-ish: only quote a cell that needs it, so an ordinary CSV stays easy to eyeball.
const cell = v => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const round1 = n => (n == null ? null : Math.round(n * 10) / 10)

/**
 * One row per completed set (warm-ups excluded — see isWorking) for every session between
 * two days inclusive, plus one row for a day whose training energy was logged without a
 * session at all to attach it to — see lib/health.js: a watch measuring a session is
 * evidence it happened, whether or not it was logged here, and an export that only walked
 * S.workouts would drop it silently.
 *
 * Reps and weight are filled only where they mean something — a lift or a bodyweight set —
 * and left empty rather than zero everywhere else (a cardio set's own minutes, speed and
 * distance are already in Détail, via the exact formatting the rest of the app reads sets
 * with). A drop set is still one row: the loaded columns take its heaviest load, same as
 * every other place in the app that has to reduce a multi-load set to one number.
 */
export function sportExportRows(S, fromISO, toISO) {
  const inRange = d => d >= fromISO && d <= toISO
  const rows = []

  const workouts = (S.workouts || []).filter(w => inRange(w.d))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)))

  workouts.forEach(w => {
    const mins = round1(durMs(w) / 60000) || ''
    const kcal = (w.watch && w.watch.kcal) || ''
    const vol = w.vol > 0 ? w.vol : ''
    const bw = w.bw || ''
    let any = false
    ;(w.entries || []).forEach(e => {
      const cfg = { ...(e.target || {}), id: e.id }
      const mode = modeOf(cfg)
      const name = exName(EXIDX[e.id]) || e.n || e.id
      ;(e.sets || []).forEach((s, i) => {
        if (!isWorking(s)) return
        any = true
        const loaded = mode === 'reps'
        const reps = loaded ? setTopReps(s) : ''
        // A pure bodyweight set with nothing added reads as an empty cell, not a "0 kg" that
        // claims a plate was on it — the same rule the app's own set labels already follow.
        const weight = loaded && !(isBw(cfg) && setTop(s) === 0) ? setTop(s) : ''
        rows.push([w.d, w.name, name, i + 1, reps, weight, setLabel(e.id, s, e.target),
          mins, kcal, vol, bw])
      })
    })
    // A session logged with nothing ticked off still happened and still cost what it cost —
    // keep its own energy and duration on the record rather than dropping the row entirely.
    if (!any && (kcal || mins)) rows.push([w.d, w.name, '', '', '', '', '', mins, kcal, vol, bw])
  })

  // Days the watch measured training on but nothing here was logged to carry it.
  ;(S.health || []).forEach(h => {
    if (!inRange(h.d) || (h.sport == null && h.sportMin == null)) return
    if (workouts.some(w => w.d === h.d)) return
    rows.push([h.d, t('training, no session logged'), '', '', '', '', '',
      h.sportMin || '', h.sport || '', '', ''])
  })

  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return rows
}

export function sportExportCSV(S, fromISO, toISO) {
  const rows = sportExportRows(S, fromISO, toISO)
  const lines = [HEADER, ...rows].map(r => r.map(cell).join(','))
  return { csv: lines.join('\r\n'), count: rows.length }
}

/** A short line for the sheet to show before exporting: what this range actually holds. */
export function sportExportSummary(S, fromISO, toISO) {
  const ws = (S.workouts || []).filter(w => w.d >= fromISO && w.d <= toISO)
  const sets = ws.reduce((n, w) => n + (w.entries || []).reduce((m, e) =>
    m + (e.sets || []).filter(isWorking).length, 0), 0)
  return { sessions: ws.length, sets, from: fmtDate(fromISO, true), to: fmtDate(toISO, true) }
}
