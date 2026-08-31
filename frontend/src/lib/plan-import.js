// Import a training program written in plain exercise *names*.
//
// The plan-share format (plan-share.js) travels between two BodyEvolve instances, so it can
// speak in catalogue ids — "0025". Anything written outside the app cannot: a program that
// came out of a conversation, a coach's notes, another app's export. So this takes the same
// plan shape but keyed on names, resolves each one against the 1324-exercise catalogue with
// the matcher the CSV importers already use, and hands back a bundle mergePlan consumes
// unchanged.
//
// Nothing is ever dropped. A name the catalogue does not recognise becomes one of your own
// exercises, exactly as an unrecognised name in a FitNotes export does — it keeps its place
// in the routine, and you can point it at the right exercise afterwards. Silently losing a
// lift out of a program is worse than carrying one that needs a correction, because the
// missing one is the one you never notice.
//
// The report says which happened to every exercise, so the review screen can show the whole
// resolution before a single routine is written.

import { EXIDX, BODYPARTS, isBodyweightEq, fillEx } from './exercises.js'
import { matchExercise, CATEGORY_BP } from './import-csv.js'
import { muscleSlug, musclesOf, MUSCLE_NAME } from './muscles.js'
import { modeOf } from './history.js'
import { POLICIES } from './progression.js'
import { uid } from './format.js'
import { t } from './i18n.js'

export const PROGRAM_FMT = 1

// S.week is keyed by JS getDay(): 0 = Sunday. Programs are written by people and by models,
// in whichever language the conversation was held in, so the day is accepted as a number, an
// English name, a French one, or any unambiguous prefix of those.
const DAY_KEYS = [
  ['sunday', 'sun', 'dimanche', 'dim'],
  ['monday', 'mon', 'lundi', 'lun'],
  ['tuesday', 'tue', 'tues', 'mardi', 'mar'],
  ['wednesday', 'wed', 'mercredi', 'mer'],
  ['thursday', 'thu', 'thur', 'thurs', 'jeudi', 'jeu'],
  ['friday', 'fri', 'vendredi', 'ven'],
  ['saturday', 'sat', 'samedi', 'sam']
]
const DAY_INDEX = new Map()
DAY_KEYS.forEach((names, i) => names.forEach(n => DAY_INDEX.set(n, i)))

/** A weekday as 0..6, or null if it is not one. */
export function dayIndex(key) {
  if (key == null) return null
  const s = String(key).trim().toLowerCase()
  if (/^[0-6]$/.test(s)) return +s
  const hit = DAY_INDEX.get(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  return hit == null ? null : hit
}

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) && n >= 0 ? n : null }
const pick = (o, ...keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return null }

/**
 * A JSON object out of text that may not be only JSON. A program written by a model arrives
 * inside a reply — fenced as ```json, or with a sentence before and after it — and asking
 * someone to trim that by hand before pasting is the step where this stops being used.
 * Braces are matched rather than regexed so a nested object cannot end the scan early.
 */
export function extractJSON(text) {
  const s = String(text || '')
  const start = s.indexOf('{')
  if (start === -1) throw new Error(t('no program found in that text'))
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1))
  }
  throw new Error(t('that program is cut off — the closing brace is missing'))
}

// Which body part an invented exercise is filed under. The program can say so in the words
// the exporters use ("chest", "quads"), or in the dataset's own ("upper legs"); anything
// else lands in the catch-all rather than failing the import over a label.
function bodyPartOf(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (BODYPARTS.includes(s)) return s
  return CATEGORY_BP[s] || 'upper legs'
}

/**
 * One planned exercise. The mode is read from which fields are present rather than declared:
 * a program that says "45 seconds" means a hold whether or not it also says "time", and
 * demanding the word would turn a correct program into a rejected one.
 */
function readExercise(raw, report) {
  const name = String(pick(raw, 'name', 'n', 'nom', 'exercise', 'exercice') || '').trim()
  if (!name) return null

  const sec = num(pick(raw, 'seconds', 'sec', 'secondes', 'hold', 'duration'))
  const min = num(pick(raw, 'minutes', 'min'))
  const speed = num(pick(raw, 'speed', 'vitesse', 'kmh'))
  const reps = num(pick(raw, 'reps', 'rep', 'repetitions', 'répétitions'))
  const weight = num(pick(raw, 'weight', 'kg', 'load', 'poids', 'charge'))
  const sets = num(pick(raw, 'sets', 'series', 'séries')) || 3

  // Resolve the name. A hit keeps the catalogue's animation, muscles and equipment; a miss
  // becomes a custom exercise carried in the same bundle.
  let id = matchExercise(name)
  let created = null
  if (id && !EXIDX[id]) id = null
  if (id) {
    report.matched.push({ from: name, to: EXIDX[id].n, id })
  } else {
    // Complete, not just named: a record missing tg or eq used to blow up every search
    // that touched it, from the first letter typed.
    created = fillEx({ id: uid(), n: name, bp: bodyPartOf(pick(raw, 'bodyPart', 'bp', 'muscle', 'group', 'groupe')) })
    // A body part alone spreads a flat, invented share over the muscles in it, which for a
    // compound is wrong in the direction that matters: "chest" fatigues the chest and
    // nothing else, so an imported bench press leaves the triceps and shoulders reading as
    // fresh. A program that names the muscles gets them stored the way the catalogue stores
    // its own — target plus supporting — and from there every map and the recovery estimate
    // treat the exercise exactly like a catalogue one.
    const tg = pick(raw, 'target', 'primary', 'primaryMuscle', 'cible')
    const sm = pick(raw, 'secondary', 'secondaryMuscles', 'support', 'secondaires')
    if (tg && muscleSlug(tg)) created.tg = String(tg).toLowerCase().trim()
    const list = (Array.isArray(sm) ? sm : String(sm || '').split(',')).map(x => String(x).trim()).filter(Boolean)
    const keep = list.filter(m => muscleSlug(m))
    if (keep.length) created.sm = keep.map(m => m.toLowerCase())
    // Named but undrawable is worth saying: it looks like it was taken and it was not.
    const dropped = [tg && !muscleSlug(tg) ? tg : null, ...list.filter(m => !muscleSlug(m))].filter(Boolean)
    if (dropped.length) {
      report.warnings.push(t('“{0}”: {1} is not a muscle the body map draws, so it was left out.', name, dropped.join(', ')))
    }
    if (raw.description || raw.desc) created.desc = String(raw.description || raw.desc)
    id = created.id
    report.created.push({ name, bp: created.bp, muscles: musclesOf(created) })
  }

  const cfg = { id, sets: Math.max(1, Math.round(sets)) }
  const kmOnly = num(pick(raw, 'km', 'distance', 'kilometers', 'kilometres'))

  // A rep range drives double progression; carried only when both ends are there, since one
  // alone is not a range and would leave the policy reading a bound it cannot use.
  const lo = num(pick(raw, 'repsMin', 'reps_min', 'minReps'))
  const hi = num(pick(raw, 'repsMax', 'reps_max', 'maxReps'))
  const range = lo != null && hi != null && hi >= lo

  // Minutes are enough to mean cardio. A zone-2 ride is "sixty minutes", full stop — no pace,
  // no distance, and demanding one of those before believing it is cardio turned an hour on
  // the bike into a set of ten reps.
  if (min != null || speed != null || kmOnly != null) {
    cfg.mode = 'cardio'; cfg.min = min || 20; cfg.speed = speed != null ? speed : 0
    if (kmOnly) cfg.km = kmOnly
  } else if (sec != null) {
    cfg.mode = 'time'; cfg.sec = sec
    if (weight) cfg.weight = weight
  } else {
    cfg.mode = 'reps'
    // Start a range at its bottom, not at the app's default of ten. Double progression works
    // up through the range and only then adds weight, so a 6–10 that starts at 10 is already
    // at the top and asks for more load in session one.
    cfg.reps = reps != null ? Math.round(reps) : range ? Math.round(lo) : 10
    if (weight) cfg.weight = weight
  }

  if (range) { cfg.repsMin = Math.round(lo); cfg.repsMax = Math.round(hi) }

  const prog = String(pick(raw, 'progression', 'prog') || '').trim().toLowerCase()
  if (prog) {
    if (POLICIES.includes(prog)) cfg.prog = prog
    else report.warnings.push(t('“{0}” is not a progression rule BodyEvolve knows — left on the routine’s default.', prog))
  }
  const inc = num(pick(raw, 'increment', 'inc'))
  if (inc) cfg.inc = inc

  if (pick(raw, 'perSide', 'per_side', 'side', 'parCote', 'unilateral') && cfg.mode === 'reps') cfg.side = true
  // Only written when it disagrees with the catalogue, matching what plan-share exports:
  // agreeing is what the other end already assumes.
  const bw = pick(raw, 'bodyweight', 'bodyWeight', 'poidsDuCorps')
  if (bw != null && !!bw !== isBodyweightEq(cfg.id)) cfg.bodyweight = !!bw
  else if (created && modeOf(cfg) !== 'cardio' && bw) cfg.bodyweight = true

  // Supersets travel as a shared group label; the ids only have to agree within a routine.
  const sg = pick(raw, 'superset', 'sg', 'group')
  if (sg != null && sg !== '') cfg.sg = String(sg)

  return { cfg, created }
}

/**
 * Parse a program into a bundle mergePlan can take, plus a report of how every name resolved.
 * Accepts an object, a JSON string, or a reply with JSON somewhere inside it.
 *
 * Throws only when there is nothing usable at all — a program with one unreadable routine
 * still imports the rest, because a partial plan you can fix beats an error you cannot.
 */
export function parseProgram(raw) {
  const data = typeof raw === 'string' ? extractJSON(raw) : raw
  if (!data || typeof data !== 'object') throw new Error(t('no program found in that text'))

  const rawRoutines = data.routines || data.days || data.sessions
  if (!Array.isArray(rawRoutines) || !rawRoutines.length) {
    throw new Error(t('that program has no routines in it'))
  }

  const report = { matched: [], created: [], warnings: [] }
  const customEx = []
  const byName = new Map()          // routine name (lowercased) -> generated id, for the week

  const routines = rawRoutines.map((r, i) => {
    const name = String(pick(r || {}, 'name', 'nom', 'title', 'routine') || '').trim() || t('Routine {0}', i + 1)
    const list = (r && (r.exercises || r.ex || r.exercices)) || []
    const ex = []
    ;(Array.isArray(list) ? list : []).forEach(item => {
      const read = readExercise(typeof item === 'string' ? { name: item } : (item || {}), report)
      if (!read) return
      if (read.created) customEx.push(read.created)
      ex.push(read.cfg)
    })
    const id = uid()
    byName.set(name.toLowerCase(), id)
    const out = { id, name, ex }
    const prog = String(pick(r || {}, 'progression', 'prog') || '').trim().toLowerCase()
    if (prog && POLICIES.includes(prog)) out.prog = prog
    return out
  }).filter(r => r.ex.length)

  if (!routines.length) throw new Error(t('that program has no exercises in it'))

  // The week can name its routines, or a routine can name its own day — programs are written
  // both ways, and a schedule dropped for being written the other way is a schedule the user
  // has to rebuild by hand.
  const week = {}
  const assign = (dayKey, routineName) => {
    const d = dayIndex(dayKey)
    if (d == null) { report.warnings.push(t('“{0}” is not a weekday — that day was skipped.', dayKey)); return }
    const key = String(routineName || '').trim().toLowerCase()
    if (!key || /^(rest|repos|off)$/.test(key)) return
    const rid = byName.get(key)
    if (rid) week[d] = rid
    else report.warnings.push(t('The week points at “{0}”, which is not one of the routines.', routineName))
  }
  Object.entries(data.week || data.schedule || data.semaine || {}).forEach(([k, v]) => assign(k, v))
  rawRoutines.forEach(r => {
    const d = pick(r || {}, 'day', 'weekday', 'jour')
    if (d != null) assign(d, pick(r || {}, 'name', 'nom', 'title', 'routine'))
  })

  const bundle = {
    name: String(data.name || data.program || data.nom || '').trim(),
    routines,
    week,
    customEx,
    dropped: 0,
    routineCount: routines.length,
    exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0),
    scheduledDays: Object.keys(week).length
  }
  return { bundle, report }
}

/**
 * The format, as text a person can hand to whatever is writing their program. Kept next to
 * the parser so the two cannot drift: this is the contract, and the parser above is its only
 * implementation.
 */
export const PROGRAM_SPEC = `{
  "name": "Hypertrophy block — weeks 1-4",
  "week": { "monday": "Push", "wednesday": "Pull", "friday": "Legs" },
  "routines": [
    {
      "name": "Push",
      "progression": "linear",
      "exercises": [
        { "name": "Barbell Bench Press", "sets": 4, "reps": 8, "weight": 75 },
        { "name": "Incline Dumbbell Press", "sets": 3, "reps": 10, "weight": 24 },
        { "name": "Lateral Raise", "sets": 3, "repsMin": 12, "repsMax": 15, "progression": "double" },
        { "name": "Plank", "sets": 3, "seconds": 45 }
      ]
    }
  ]
}

Write exercise names **in English**. They are matched against BodyEvolve's 1324-exercise
catalogue — "Bench Press", "Leg Press (Machine)" — and a match brings the animation, the
muscles worked and the whole progression history with it. A French name matches nothing:
it is kept as a custom exercise rather than dropped, but it arrives with no muscles and no
history. When you do invent one, say which body part it works:

  { "name": "Sled Push", "bodyPart": "legs", "sets": 4, "seconds": 30 }

chest · back · shoulders · arms · biceps · triceps · forearms · legs · quads · hamstrings ·
glutes · calves · abs · core · cardio · neck.

For anything compound, name the muscles too — a body part alone spreads one flat share over
the muscles inside it, so an invented bench press would fatigue the chest and leave the
triceps and shoulders reading as fresh:

  { "name": "Sled Push", "target": "quads",
    "secondary": ["glutes", "calves", "core"], "sets": 4, "seconds": 30 }

The target counts full, each supporting muscle counts 0.4 — the same arithmetic the
catalogue's own exercises use. Accepted names: chest · lats · upper back · lower back ·
traps · shoulders · biceps · triceps · forearms · abs · obliques · glutes · quads ·
hamstrings · adductors · hip flexors · calves · shins.

Per exercise: sets, reps, weight (kg) · seconds for a hold · minutes + speed for cardio ·
repsMin/repsMax for a rep range · progression: off | linear | greyskull | double | time ·
increment · perSide: true · superset: "A" to pair exercises.`
