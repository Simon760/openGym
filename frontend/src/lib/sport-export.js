// A CSV of the training itself, read the way a session actually reads: the date and what it
// cost once, an exercise's name once, then its sets underneath, one line each. Not the JSON
// backup Settings already offers — that is a whole profile meant to come back into this app;
// this is meant to leave it and be read by a coach or opened in a spreadsheet, so it is
// grouped and in the language the app already speaks, not a flat table repeating the same
// session figures on every row.
//
// The grouping means rows are not all the same width — a session line carries its own
// figures, an exercise line just a name one column in, a set line just its number and its
// detail two columns in — and a spreadsheet reads that as indentation for free. A blank line
// separates one session's block from the next, the way paragraphs would in a text a person
// wrote by hand.

import { EXIDX, exName } from './exercises.js'
import { setLabel, durMs, isWorking } from './history.js'
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

// Describes the outer, session-level shape — what every block in the file opens with. The
// exercise and set lines underneath are sub-rows of it, not columns of their own.
const HEADER = ['Date', 'Séance', 'Durée (min)', 'Énergie (kcal)', 'Volume (kg)', 'Poids du jour (kg)']

// RFC 4182-ish: only quote a cell that needs it, so an ordinary CSV stays easy to eyeball.
const cell = v => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const round1 = n => (n == null ? null : Math.round(n * 10) / 10)

/** One session, as its own block: the header line, then every exercise with its sets under
 *  it. `[]` when there is truly nothing to say — no set was ticked off and no watch figure
 *  was ever attached, which is what a session started and abandoned looks like. */
function workoutBlock(w) {
  const mins = round1(durMs(w) / 60000) || ''
  const kcal = (w.watch && w.watch.kcal) || ''
  const vol = w.vol > 0 ? w.vol : ''
  const bw = w.bw || ''
  const body = []
  ;(w.entries || []).forEach(e => {
    const sets = (e.sets || []).filter(isWorking)
    if (!sets.length) return
    body.push(['', exName(EXIDX[e.id]) || e.n || e.id])
    sets.forEach((s, i) => body.push(['', '', t('Set {0}', i + 1), setLabel(e.id, s, e.target)]))
  })
  if (!body.length && !mins && !kcal) return []
  return [[w.d, w.name, mins, kcal, vol, bw], ...body]
}

/** A day the watch measured training on with nothing logged here for it to attach to — see
 *  lib/health.js: a watch measuring a session is evidence it happened either way. */
const strayBlock = h => [[h.d, t('training, no session logged'), h.sportMin || '', h.sport || '']]

/**
 * Every session between two days inclusive, each as its own block, in the order they were
 * trained — interleaved with a day whose training energy was logged without a session to
 * carry it, so the file reads as one chronological account rather than sessions first and
 * loose figures dumped after.
 */
export function sportExportRows(S, fromISO, toISO) {
  const inRange = d => d >= fromISO && d <= toISO
  const workouts = (S.workouts || []).filter(w => inRange(w.d))
  const strayDays = (S.health || []).filter(h => inRange(h.d) &&
    (h.sport != null || h.sportMin != null) && !workouts.some(w => w.d === h.d))

  const units = [
    ...workouts.map(w => ({ d: w.d, at: w.start || 0, block: () => workoutBlock(w) })),
    ...strayDays.map(h => ({ d: h.d, at: 0, block: () => strayBlock(h) }))
  ].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.at - b.at))

  const rows = []
  units.forEach(u => {
    const block = u.block()
    if (!block.length) return
    if (rows.length) rows.push([])
    rows.push(...block)
  })
  return rows
}

export function sportExportCSV(S, fromISO, toISO) {
  const rows = sportExportRows(S, fromISO, toISO)
  const lines = [HEADER, ...rows].map(r => r.map(cell).join(','))
  // Sessions, not lines — a blank separator and two sub-rows per exercise are not "a row of
  // training" to whoever reads the confirmation toast afterwards.
  const count = rows.filter(r => r.length >= 2 && r[0]).length
  return { csv: lines.join('\r\n'), count }
}

/** A short line for the sheet to show before exporting: what this range actually holds. */
export function sportExportSummary(S, fromISO, toISO) {
  const ws = (S.workouts || []).filter(w => w.d >= fromISO && w.d <= toISO)
  const sets = ws.reduce((n, w) => n + (w.entries || []).reduce((m, e) =>
    m + (e.sets || []).filter(isWorking).length, 0), 0)
  return { sessions: ws.length, sets, from: fmtDate(fromISO, true), to: fmtDate(toISO, true) }
}
