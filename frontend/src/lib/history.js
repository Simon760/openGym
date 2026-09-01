// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { todayISO, isoOf, weekKey, fmtNum } from './format.js'
import { isCardio, isBodyweightEq } from './exercises.js'
import { t } from './i18n.js'
import { weekFor } from './blocks.js'

// How an exercise is logged (issue #16). This used to be derived from the body part alone,
// which meant a plank or a farmer's carry could only be timed by filing it under cardio.
// A routine entry can now say so explicitly:
//   reps   — weight × reps      sets look like { w, r }
//   time   — a work duration    sets look like { sec, w }   (w = 0 for bodyweight)
//   cardio — duration + speed   sets look like { min, speed }
// An entry without `mode` behaves exactly as before, so every existing plan, workout and
// plan file is read unchanged and nothing needs migrating.
export function modeOf(cfg) {
  const m = cfg && cfg.mode
  if (m === 'reps' || m === 'time' || m === 'cardio') return m
  return isCardio(cfg && cfg.id) ? 'cardio' : 'reps'
}
export const isTimed = cfg => modeOf(cfg) === 'time'

// Two flags that ride on top of a mode rather than making new ones (issues #31/#32), because
// "bodyweight" and "per side" are true of a rep set and of a timed hold alike:
//   bodyweight — the exercise carries no load of its own, so `w` means *added* weight and is
//                asked for only once you say there is some. Seeded from the equipment field.
//                Spelled out rather than `bw`, which a workout already uses for the weigh-in
//                it was logged at — two different things one letter apart is a bug waiting.
//   side       — the exercise is unilateral. You still log what you did: 16, the total across
//                both sides. The split is derived for planning ("8 per side"), never entered
//                — a number that sometimes means one side and sometimes both is the thing
//                that made this ambiguous in the first place, and one rep count that always
//                means the same thing beats two that need a legend.
// Both are absent on every plan, workout and backup written before they existed, and absent
// reads as false, so nothing needs migrating.
export const isBw = cfg => (cfg && cfg.bodyweight != null ? !!cfg.bodyweight : isBodyweightEq(cfg && cfg.id))
export const isPerSide = cfg => !!(cfg && cfg.side)
// What one side did, for display only. Half of an odd total is shown as it falls (8.5) rather
// than rounded away: it means the sides were not even, which is worth seeing.
export const sideReps = reps => (reps || 0) / 2
// Unilateral work moves in pairs, so its rep target steps by two — 16, 18, 20 — and a total
// that stayed odd would put a rep on one side and not the other.
export const repStep = cfg => (isPerSide(cfg) ? 2 : 1)

// mm:ss for a work duration — seconds alone read badly past a minute ("90 s" vs "1:30").
export function fmtSec(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}

// How hard a set felt, if the profile logs it at all. Two scales for the same thing, kept in
// their own fields: RIR counts the reps still in the tank, RPE reads the same effort off a
// 10-point scale from the top (RPE 8 ≈ RIR 2). A set logged on one scale is never silently
// rewritten as the other — switching the setting changes what new sets ask for, nothing else.
// `min`..`max` is the range the stepper walks. RIR bottoms out at 0 (a set taken to failure);
// RPE bottoms out at 6, since the scale is only meaningful for working sets and anything
// lighter is a warm-up nobody rates.
export const EFFORT = {
  rir: { f: 'rir', hd: 'RIR', step: 0.5, min: 0, max: 10 },
  rpe: { f: 'rpe', hd: 'RPE', step: 0.5, min: 6, max: 10 }
}
// One tap of an effort stepper. Empty is not 0 — an unlogged effort must not become "went to
// failure" from one stray tap — so − on an empty cell leaves it empty, and + starts at the
// bottom of the scale and walks up from there in even steps. Stepping back off the bottom
// clears the cell again, so a mistap is undoable. null means "nothing logged"; the caller
// stores that by dropping the key rather than writing a null.
export function stepEffort(kind, cur, dir) {
  const e = EFFORT[kind]
  if (!e) return cur ?? null
  if (cur == null) return dir < 0 ? null : e.min
  const n = Math.round((cur + dir * e.step) * 100) / 100
  if (dir < 0 && n < e.min) return null
  // only the ceiling is enforced on the way up: a value typed below the floor (nothing stops
  // someone entering RPE 3) still steps in even increments instead of snapping to the floor.
  return dir > 0 ? Math.min(e.max, n) : Math.max(e.min, n)
}
// A typed effort is capped but not floored — clamping up while someone types "10" would turn
// the first keystroke into the floor and fight the input.
export const capEffort = (kind, v) =>
  (v == null || !EFFORT[kind] ? v : Math.min(EFFORT[kind].max, v))
// Which scale a profile logs. `showRir` is the boolean this replaced and is only consulted
// when the profile has no answer of its own — an explicit 'none' has to win over it, or a
// backup or another device that still carries the old flag would switch the column back on.
export const effortOf = S => {
  const e = S && S.effort
  return e === 'none' || EFFORT[e] ? e : (S && S.showRir ? 'rir' : 'none')
}
// The "(RIR 2)" / "(RPE 8)" tail on a set summary, empty when nothing was logged.
const effortTail = s => {
  const k = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null
  return k ? ` (${EFFORT[k].hd} ${fmtNum(s[k])})` : ''
}

// One-line summary of a logged set. `cfg` carries the mode when the caller has it (a routine
// entry or a workout entry); passing an id alone keeps the old body-part behaviour.
export function setLabel(id, s, cfg) {
  const c = cfg || { id }
  const mode = modeOf(c)
  // Distance only when it was logged: a treadmill set often has none, and " · 0 km"
  // would claim a run that did not move.
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h` + (s.km > 0 ? ` · ${fmtNum(s.km)} km` : '')
  if (mode === 'time') return fmtSec(s.sec) + (s.w > 0 ? ` · ${fmtNum(s.w)}` : '')
  // Bodyweight reads as what you did — "12", or "+10 × 12" once there is a belt involved —
  // rather than "0×12", which says a set was performed with no weight and means nothing.
  // A per-side set needs no mark here: the number logged is the total, the same as every
  // other set in the app.
  // A set can carry more than one load — a drop, or a pyramid rung — and every piece is
  // shown. Printing only the first would under-report the set everywhere the label is read:
  // history, the digest, the last-time line above the sets you are about to do. The arrow is
  // the joiner rather than a plus because it also says which way the set ran, and because a
  // bodyweight piece already starts with a plus for the belt.
  const bw = isBw({ ...c, id: c.id ?? id })
  const piece = x => (bw ? (x.w > 0 ? `+${fmtNum(x.w)} × ${x.r}` : `${x.r}`) : `${fmtNum(x.w)}×${x.r}`)
  return segsOf(s).map(piece).join('\u2192') + effortTail(s)
}
// Default config for a freshly added exercise.
export function defaultConfig(id, mode) {
  const m = mode || modeOf({ id })
  if (m === 'cardio') return { sets: 1, min: 20, speed: 8 }
  // Written only when it is true, so a barbell config is byte-for-byte what it was before
  // the flag existed and a plan file gains nothing it does not need.
  const bw = isBodyweightEq(id) ? { bodyweight: true } : {}
  if (m === 'time') return { sets: 3, sec: 45, weight: 0, mode: 'time', ...bw }
  return { sets: 3, reps: 10, weight: 0, mode: 'reps', ...bw }
}
// One-line summary of a planned exercise ("3 × 10 · 60 kg"), shared by the routine editor
// and the plan export so a mode is described the same way everywhere.
export function exLine(cfg, unit) {
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  // Added weight reads as added: "+10 kg" on a dip belt, "60 kg" on a barbell.
  const load = cfg.weight ? ' · ' + (isBw(cfg) ? '+' : '') + fmtNum(cfg.weight) + ' ' + unit : ''
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h` + (cfg.km > 0 ? ` · ${fmtNum(cfg.km)} km` : '')
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}${load}`
  // This is the line with room for it, so the split is spelled out: "3 × 16 · 8/side".
  const split = isPerSide(cfg) ? ' · ' + t('{0}/side', fmtNum(sideReps(cfg.reps))) : ''
  return `${n} × ${cfg.reps}${load}${split}`
}

// Drop superset ids that no longer have an adjacent partner (after unlink/reorder/remove).
export function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg
  })
}

/**
 * A set logged as a warm-up: done, and deliberately not counted.
 *
 * Warm-ups are real work that must not enter any figure the app reasons from. Two plates for
 * five is not a record, it is not volume worth reporting, and it is certainly not the set the
 * progression engine should read to decide next week's weight — a bar-only warm-up counted as
 * "last time" would walk a lifter's programme backwards, week after week, faster than any
 * bug. So one predicate, and everything that counts anything uses it.
 */
export const isWorking = s => !!(s && s.done && !s.warm)

/**
 * A set can carry more than one load.
 *
 * "Ten at 10, then ten at 5 without putting it down" is one set, not two, and logging it as
 * two says something false about both: the rest between them, the number of sets performed,
 * and — for a descending set — a working set at 5 kg that never happened. So the extra loads
 * ride on the set as `drops`, and everything that reads a weight goes through here.
 *
 * The direction is deliberately not named. A drop set descends and a pyramid ascends, and
 * the arithmetic is identical either way: the volume is the sum of the pieces, and the load
 * that counts as a record is the heaviest of them, wherever it sits in the sequence.
 */
// Extra loads as a list, whatever they arrived as. A state read back from the cloud brings
// arrays home as objects keyed "0","1" — hydrate repairs that, but this is read on every set
// of every workout and is not the place to find out that one slipped through.
const dropsOf = s => (s && Array.isArray(s.drops) ? s.drops : [])
export const segsOf = s => [
  { w: (s && s.w) || 0, r: (s && s.r) || 0 },
  ...(dropsOf(s).map(d => ({ w: (d && d.w) || 0, r: (d && d.r) || 0 })))
]
export const setVol = s => segsOf(s).reduce((v, x) => v + x.w * x.r, 0)
export const setTop = s => segsOf(s).reduce((m, x) => (x.w > m ? x.w : m), 0)
// The reps done at that heaviest load — the number that belongs with setTop. A descending
// set tops out where it started and an ascending one where it ended, so pairing the top load
// with the first piece's reps would tell the progression engine you did ten at a weight you
// only did five at. Ties keep the earlier piece, which is where a drop set's work is.
export const setTopReps = s => segsOf(s).reduce((b, x) => (x.w > b.w ? x : b), { w: -1, r: 0 }).r
export const setReps = s => segsOf(s).reduce((n, x) => n + x.r, 0)
export const hasDrops = s => dropsOf(s).length > 0
export const isWarm = s => !!(s && s.warm)

/**
 * A warm-up, as an ordinary entry whose every set is flagged.
 *
 * Nothing downstream counts a flagged set — not the volume, not a record, not the "last time"
 * the progression engine reads — so what you warmed up with is on the record without
 * pretending to be training. That is the whole mechanism; there is no second kind of entry
 * and no second code path, which is why a warm-up cannot drift out of step with the rest.
 * The flag rides on the entry too, so a screen can say so without re-deriving it.
 */
export const warmEntry = (S, cfg) => ({
  id: cfg.id, target: { ...cfg }, warm: true,
  sets: buildSets(S, cfg).map(s => ({ ...s, warm: true }))
})


/**
 * One workout's record of one exercise, however many entries it took.
 *
 * A session can hold the same movement twice, and since a warm-up became an entry of its own
 * that is the common case: warm up on the bench, then bench. Every reader here used to take
 * the *first* matching entry, which is the warm-up — an entry with no working sets in it — and
 * so reported the exercise as untrained. That silently dropped the session out of the "last
 * time" line, the 1RM series, the strength chart and, worst, the progression engine, which
 * would have gone on prescribing the same weight for as long as the warm-up was logged first.
 *
 * Read as one entry: the sets of all of them, and the target of whichever actually trained.
 */
export function exEntryOf(w, exId) {
  const es = ((w && w.entries) || []).filter(e => e && e.id === exId)
  if (es.length < 2) return es[0] || null
  const work = es.find(e => (e.sets || []).some(isWorking)) || es[0]
  return { ...work, sets: es.flatMap(e => e.sets || []) }
}

export function lastEntryFor(S, exId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const en = exEntryOf(S.workouts[i], exId)
    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    if (en && en.sets.some(isWorking)) return { d: S.workouts[i].d, sets: en.sets.filter(isWorking), target: en.target || null }
  }
  return null
}
export function bestWeightFor(S, exId) {
  let best = 0
  S.workouts.forEach(w => w.entries.forEach(e => {
    if (e.id === exId) {
      // The heaviest piece of the set, which for a descending set is where it started and
      // for an ascending one is where it ended. Either way it is the load that was lifted.
      e.sets.forEach(s => { if (isWorking(s) && setTop(s) > best) best = setTop(s) })
      if (e.topW && e.topW > best) best = e.topW
    }
  }))
  return best
}
export function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan[iso]
  if (ov === 'rest') return null
  if (ov && S.routines.some(r => r.id === ov)) return ov
  const wd = new Date(iso + 'T12:00:00').getDay()
  // The schedule in force on *that* day, not the one in force now. A day in March answers to
  // whatever block was running in March, which is what stops a switch today from rewriting
  // what last month was supposed to have been.
  return weekFor(S, iso)[wd] || null
}
/**
 * The seven days of the week a date falls in, Monday first — the span a swap is offered
 * across, because "I'll do legs on Thursday instead" is a thing said about this week.
 */
export function weekDays(iso) {
  const d = new Date(iso + 'T12:00:00')
  const back = (d.getDay() + 6) % 7          // getDay: 0 = Sunday, and a week starts Monday
  const monday = new Date(d.getTime() - back * 86400000)
  return Array.from({ length: 7 }, (_, i) => isoOf(new Date(monday.getTime() + i * 86400000)))
}

/**
 * Trade two days' sessions, without touching the programme either of them came from.
 *
 * Written as two per-day exceptions rather than as an edit to the week, because that is what
 * it is: this Thursday does legs, every other Thursday still does whatever the block says.
 * Editing the block instead would move every Thursday there has ever been.
 *
 * A day whose session moves away becomes a rest day rather than falling back to the plan —
 * otherwise swapping Monday's push onto Thursday would leave Monday still saying push, and
 * you would have swapped nothing.
 */
export function swapDays(S, a, b) {
  if (!a || !b || a === b) return false
  const ra = effectiveRoutineId(S, a)
  const rb = effectiveRoutineId(S, b)
  if (!ra && !rb) return false
  S.dayPlan[a] = rb || 'rest'
  S.dayPlan[b] = ra || 'rest'
  return true
}

export function effectiveRoutine(S, iso) {
  const id = effectiveRoutineId(S, iso)
  return id ? S.routines.find(r => r.id === id) || null : null
}
export function buildSets(S, cfg) {
  const last = lastEntryFor(S, cfg.id)
  const n = Math.max(1, cfg.sets || 1)
  const mode = modeOf(cfg)
  const sets = []
  // Last time's set at the same position, falling back to its final set when the plan grew.
  const prevAt = i => (last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null)

  if (mode === 'cardio') {
    for (let i = 0; i < n; i++) {
      const prev = prevAt(i)
      sets.push({ min: prev ? prev.min : (cfg.min || 20), speed: prev ? prev.speed : (cfg.speed || 8), done: false })
    }
    return sets
  }
  if (mode === 'time') {
    for (let i = 0; i < n; i++) {
      // Only carry a previous value over when it came from a timed set — switching an
      // exercise from reps to time must not seed the duration from a rep count.
      const prev = prevAt(i)
      const carried = prev && prev.sec > 0 ? prev : null
      sets.push({ sec: carried ? carried.sec : (cfg.sec || 45), w: carried ? (carried.w || 0) : (cfg.weight || 0), done: false })
    }
    return sets
  }
  const conf = S.exWeights[cfg.id]
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i)
    const usable = prev && prev.r > 0 ? prev : null
    const w = conf && conf.w > 0 ? conf.w : (usable ? usable.w : cfg.weight)
    sets.push({ w, r: usable ? usable.r : cfg.reps, done: false })
  }
  return sets
}
export function workoutVolume(w) {
  let v = 0
  // No special case for unilateral work: a per-side set logs its total, so both sides are
  // already in the rep count that arrives here.
  ;((w && w.entries) || []).forEach(e => ((e && e.sets) || []).forEach(s => { if (isWorking(s)) v += setVol(s) }))
  return v
}
export function setsDone(w) {
  let n = 0
  ;((w && w.entries) || []).forEach(e => ((e && e.sets) || []).forEach(s => { if (isWorking(s)) n++ }))
  return n
}
/* Counted for the progress bar during a session, where a warm-up you ticked is a thing you
   did and should not read as still to do. */
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export const lastBW = S => (S.bodyweight.length ? S.bodyweight[S.bodyweight.length - 1] : null)

// Group consecutive items sharing a superset id (sg) into "units" of indices.
// items may be routine exercises ({sg}) or active-workout entries ({sg}).
export function supersetUnits(items) {
  const units = []
  items.forEach((e, i) => {
    const prev = items[i - 1]
    if (i > 0 && e.sg && prev && prev.sg && e.sg === prev.sg) units[units.length - 1].push(i)
    else units.push([i])
  })
  return units
}
export function unitOf(units, idx) { return units.find(u => u.includes(idx)) || [idx] }

export function streakWeeks(S) {
  if (!S.workouts.length) return 0
  const weeks = new Set(S.workouts.map(w => weekKey(w.d)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur))
    if (weeks.has(wk)) streak++
    else if (i > 0) break
    cur.setDate(cur.getDate() - 7)
  }
  return streak
}
