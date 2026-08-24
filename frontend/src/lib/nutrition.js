// Daily energy and macro intake — kcal plus protein, carbs and fat.
//
// One entry per day, keyed on the date exactly like a weigh-in: logging twice on the same
// day replaces the first number rather than adding to it. Deliberately not per-meal — the
// figure that drives a cut or a bulk is the daily total, and asking for four entries a day
// is how a food log stops being filled in by the second week.
//
// Nothing here is stored alongside the entries. Totals, averages and what is left of a
// target are all derived on read, so fixing a number you mistyped on Tuesday immediately
// fixes every reading that used it — the same rule the progression engine follows.

export const MACROS = ['p', 'c', 'f']

// Atwater factors: protein and carbohydrate yield 4 kcal per gram, fat 9. These are the
// numbers every food label is computed from, which is what makes the cross-check below
// meaningful rather than approximate.
export const KCAL_PER_G = { p: 4, c: 4, f: 9 }

export const MACRO_NAME = { p: 'Protein', c: 'Carbs', f: 'Fat' }
export const MACRO_COLOR = { p: 'var(--blue)', c: 'var(--orange)', f: 'var(--yellow)' }

// How far the macro-derived calories may sit from the logged ones before it is worth
// saying so. Rounded label values and unlogged alcohol both drift a few percent; a tenth
// is past what either explains and usually means a digit went astray.
export const MISMATCH_TOL = 0.1

const num = v => (Number.isFinite(+v) && +v > 0 ? +v : 0)

/** The entry for one day, or null. */
export const entryFor = (S, iso) => (S.nutrition || []).find(e => e.d === iso) || null

/** The most recent entry, or null. Entries are kept sorted by date. */
export const lastEntry = S => {
  const list = S.nutrition || []
  return list.length ? list[list.length - 1] : null
}

/** Does this entry carry any macro at all? kcal alone is a perfectly valid log. */
export const hasMacros = e => !!e && MACROS.some(m => num(e[m]) > 0)

/** Calories the logged macros account for. 0 when none are logged. */
export const kcalFromMacros = e =>
  MACROS.reduce((sum, m) => sum + num(e && e[m]) * KCAL_PER_G[m], 0)

/**
 * The macro-derived calorie count, but only when it materially disagrees with the number
 * that was actually logged — otherwise null. Surfaced as a hint, never auto-corrected:
 * both figures can legitimately be right (alcohol and fibre are real calories no macro
 * field here captures), so the app says what it noticed and leaves the number alone.
 */
export function derivedMismatch(e, tol = MISMATCH_TOL) {
  const logged = num(e && e.kcal)
  if (!logged || !hasMacros(e)) return null
  const derived = kcalFromMacros(e)
  return Math.abs(derived - logged) / logged > tol ? Math.round(derived) : null
}

/**
 * Each macro's share of the calories the macros account for, as fractions summing to 1.
 * Computed against the macro total rather than the logged kcal so the bar always fills:
 * a split drawn against a larger logged figure would leave an unexplained gap and read
 * as a fourth, nameless macro.
 */
export function macroSplit(e) {
  const total = kcalFromMacros(e)
  if (!total) return null
  const out = {}
  MACROS.forEach(m => { out[m] = (num(e[m]) * KCAL_PER_G[m]) / total })
  return out
}

/**
 * What is left of the day's targets. Negative means over — returned as-is rather than
 * clamped, because "300 over" is the number that changes what you eat tonight and
 * clamping it to zero would hide exactly the day worth seeing.
 * Fields the goal does not set are absent, so a kcal-only goal stays a kcal-only reading.
 */
export function remainingOf(entry, goal) {
  if (!goal) return null
  const out = {}
  for (const k of ['kcal', ...MACROS]) {
    if (num(goal[k])) out[k] = Math.round((num(goal[k]) - num(entry && entry[k])) * 10) / 10
  }
  return Object.keys(out).length ? out : null
}

// A window in days counted back from now, matching lib/effort.js. 0 = everything.
const inWindow = (iso, days, now) =>
  !days || new Date(iso + 'T12:00:00').getTime() > now - days * 86400000

/**
 * Daily averages over a window — and, the part that keeps them honest, how many days
 * actually carry an entry. Unlogged days are not zeros: dividing by the length of the
 * window would report a 2 400 kcal week as 1 000 because four days were never filled in.
 * So the average speaks only for the days it has, and says how many those are.
 */
export function avgOver(S, days, now = Date.now()) {
  const list = (S.nutrition || []).filter(e => inWindow(e.d, days, now))
  const sums = { kcal: 0, p: 0, c: 0, f: 0 }
  const counts = { kcal: 0, p: 0, c: 0, f: 0 }
  list.forEach(e => {
    for (const k of ['kcal', ...MACROS]) {
      const v = num(e[k])
      if (v) { sums[k] += v; counts[k]++ }
    }
  })
  const out = { logged: list.length, window: days }
  // Each field averages over the days that logged *it*: macros are optional on top of
  // kcal, so a week with two macro days must not report those two spread across seven.
  for (const k of ['kcal', ...MACROS]) {
    out[k] = counts[k] ? Math.round(sums[k] / counts[k]) : null
    out[k + 'Days'] = counts[k]
  }
  return out
}

/** Chart points for the kcal curve over a window, oldest first. */
export const seriesOf = (S, days, now = Date.now()) =>
  (S.nutrition || [])
    .filter(e => num(e.kcal) && inWindow(e.d, days, now))
    .map(e => ({ t: new Date(e.d + 'T12:00:00').getTime(), y: num(e.kcal), d: e.d }))

/**
 * Insert or replace a day's entry and return a new, date-sorted list. Kept here rather
 * than written inline where it is used, because the logging sheet is not the only writer:
 * anything importing a day of intake has to land on exactly one entry per day too.
 * An entry with no numbers at all removes the day — that is how you undo a mistake.
 */
export function putEntry(list, entry) {
  const rest = (list || []).filter(e => e.d !== entry.d)
  const kept = {}
  for (const k of ['kcal', ...MACROS]) { if (num(entry[k])) kept[k] = num(entry[k]) }
  if (!Object.keys(kept).length) return rest.sort(byDate)
  return [...rest, { d: entry.d, ...kept, t: entry.t || Date.now() }].sort(byDate)
}

const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)
