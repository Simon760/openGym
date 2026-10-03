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
import { resolveExercise, CATEGORY_BP, parseCSV, unfence, DELIMS, fold } from './import-csv.js'
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

// What an unrecognised name most likely works, read off its own words — French or English,
// plurals tolerated. Specific before general: "leg curl" is legs before "curl" is arms, a
// "développé militaire" is shoulders before a "développé" is chest. `tg` names the muscle
// when the words pin it down, so a hip thrust lights up the glutes rather than spreading a
// flat share over the whole leg.
const BP_GUESS = [
  [/\b(velo|bike|tapis|treadmill|rameur|rower|elliptique|cardio|course|running|run|marche|skierg|assault)\b/, 'cardio', null],
  [/\b(hip thrusts?|fessiers?|glutes?|pont fessier|abducteurs?|abduction)\b/, 'upper legs', 'glutes'],
  [/\b(leg curls?|ischios?|ischio jambiers?|hamstrings?|nordic|souleve de terre roumain|rdl|good mornings?)\b/, 'upper legs', 'hamstrings'],
  [/\b(leg press|leg extensions?|presses?|squats?|fentes?|lunges?|quadri\w*|quads?|hack|step ups?|adducteurs?|souleve de terre|deadlifts?|sdt)\b/, 'upper legs', null],
  [/\b(mollets?|calf|calves)\b/, 'lower legs', 'calves'],
  [/\b(triceps?|barre au front|skull\w*|pushdowns?|kickbacks?)\b/, 'upper arms', 'triceps'],
  [/\b(biceps?|curls?)\b/, 'upper arms', 'biceps'],
  [/\b(avant bras|forearms?|poignets?|wrists?)\b/, 'lower arms', 'forearms'],
  [/\b(face pulls?|oiseau|rear delts?|elevations? laterales?|lateral raises?|militaire|overhead|shoulders?|epaules?|arnold|deltoides?|delts?|rowing menton|upright rows?|shrugs?|haussements?)\b/, 'shoulders', 'delts'],
  [/\b(couche|incline|decline|bench|pecs?|pectoraux|ecartes?|flys?|flyes|chest|pompes?|push ups?|dips?|butterfly|pec deck)\b/, 'chest', 'pectorals'],
  [/\b(tirages?|rows?|rowing|pulldowns?|tractions?|pull ups?|chin ups?|dorsaux|lats?|dos|back|lombaires?|pullovers?|pull over)\b/, 'back', null],
  [/\b(crunch\w*|abdos?|abdominaux|abs|gainage|planche|planks?|obliques?|releve de jambes?|leg raises?|russian twists?|core|sit ups?)\b/, 'waist', 'abs'],
]
export function guessBodyPart(name) {
  const s = fold(name).replace(/[’'()[\]]/g, ' ').replace(/[^a-z0-9]+/g, ' ')
  for (const [re, bp, tg] of BP_GUESS) if (re.test(s)) return { bp, tg }
  return null
}

// Which body part an invented exercise is filed under. The program can say so in the words
// the exporters use ("chest", "quads"), or in the dataset's own ("upper legs"); without that,
// the name's own words are read, and only a name that says nothing at all lands in the
// catch-all rather than failing the import over a label.
function bodyPartOf(raw, name) {
  const s = String(raw || '').trim().toLowerCase()
  if (BODYPARTS.includes(s)) return s
  if (CATEGORY_BP[s]) return CATEGORY_BP[s]
  const g = guessBodyPart(raw) || guessBodyPart(name)
  return g ? g.bp : 'upper legs'
}

// A row's kind, when the programme says it is joint or mobility work rather than lifting.
const MOBILITY_KIND = /^(mobilit|mobility|etirement|stretch|souplesse|echauffement|warm ?up|prehab|prevention|articulaire|joint)/
export const isMobilityKind = v => !!v && MOBILITY_KIND.test(fold(String(v)).trim())

// The progression rules in the words a French programme uses for them.
const PROG_WORDS = {
  aucune: 'off', aucun: 'off', non: 'off', none: 'off', fixe: 'off', manuelle: 'off', manuel: 'off',
  lineaire: 'linear', 'double progression': 'double', temps: 'time', duree: 'time',
}

// "Ischios, fessiers" — a target cell naming more than one muscle: the first is the target,
// the rest support it, as in the catalogue.
const splitMuscles = v => (Array.isArray(v) ? v : String(v || '').split(/[,;/+·&]|\s+et\s+/))
  .map(x => String(x).trim()).filter(Boolean)

/**
 * A rest as a coach writes it — "2–3 min", "1,5 min", "90 s", "0 s", "1:30" — in seconds. A
 * range starts at its low end: the timer can always be given fifteen seconds more, and a rest
 * that runs long by default is a session that does. A bare number is minutes up to ten
 * ("2") and seconds above ("90").
 */
export function readRest(v) {
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.min(600, Math.round(v)) : null
  const s = String(v || '').toLowerCase().replace(/,/g, '.').trim()
  if (!s) return null
  const mmss = s.match(/(\d+):(\d{2})/)
  if (mmss) return Math.min(600, +mmss[1] * 60 + +mmss[2])
  const m = s.match(/\d+(?:\.\d+)?/)
  if (!m) return null
  const n = +m[0]
  const sec = /min|mn|'/.test(s) ? n * 60 : /\d\s*(s|sec|secondes?|seconds?)\b|"/.test(s) ? n : n <= 10 ? n * 60 : n
  return Math.min(600, Math.round(sec))
}

/**
 * One planned exercise. The mode is read from which fields are present rather than declared:
 * a program that says "45 seconds" means a hold whether or not it also says "time", and
 * demanding the word would turn a correct program into a rejected one.
 */
function readExercise(raw, report, used, made = new Map()) {
  const name = String(pick(raw, 'name', 'n', 'nom', 'exercise', 'exercice') || '').trim()
  if (!name) return null
  // Joint and mobility work, by the programme's own say-so: it becomes an exercise of yours in
  // the Mobilité category carrying the programme's instructions, instead of being matched to a
  // catalogue movement that would file it under abs and leave the instructions behind.
  const mobility = isMobilityKind(pick(raw, 'kind', 'category', 'categorie', 'type'))
  const notes = String(pick(raw, 'notes', 'note', 'instructions', 'consignes', 'description', 'desc') || '').trim()

  const sec = num(pick(raw, 'seconds', 'sec', 'secondes', 'hold', 'duration'))
  const min = num(pick(raw, 'minutes', 'min'))
  const speed = num(pick(raw, 'speed', 'vitesse', 'kmh'))
  const reps = num(pick(raw, 'reps', 'rep', 'repetitions', 'répétitions'))
  const weight = num(pick(raw, 'weight', 'kg', 'load', 'poids', 'charge'))
  const sets = num(pick(raw, 'sets', 'series', 'séries')) || 3

  // Resolve the name. A hit keeps the catalogue's animation, muscles and equipment; a miss
  // becomes a custom exercise carried in the same bundle — with the few catalogue entries it
  // could have meant, so the review can offer them instead of guessing between them.
  const res = mobility ? {} : resolveExercise(name, used)
  let id = res.id && EXIDX[res.id] ? res.id : null
  // A programme that says which muscle a row works can veto a match that works another. Its
  // "Kickback poulie" with a strap on the ankle is a glute kickback; the catalogue's is for the
  // triceps, and filing one under the other puts the fatigue and the whole history on the wrong
  // muscle. The vetoed entry stays first among the candidates, in case it was right after all.
  let vetoed = null
  const said = splitMuscles(pick(raw, 'target', 'primary', 'primaryMuscle', 'cible')).map(muscleSlug).filter(Boolean)
  const worksSaid = c => { const works = musclesOf(EXIDX[c]); return !said.length || !Object.keys(works).length || said.some(m => works[m] > 0) }
  if (id && !worksSaid(id)) { vetoed = id; id = null }
  let created = null
  // The same invented exercise on several rows — a joint routine closing every session — is
  // one exercise, created once.
  const madeKey = fold(name) + '|' + (mobility ? 'mobility' : '')
  if (id) {
    report.matched.push({ from: name, to: EXIDX[id].n, id, how: res.how, known: !!(used && used.get(id) > 0) })
  } else if (made.has(madeKey)) {
    const prev = made.get(madeKey)
    if (notes && !prev.desc) prev.desc = notes
    id = prev.id
  } else {
    // Complete, not just named: a record missing tg or eq used to blow up every search
    // that touched it, from the first letter typed.
    const said = pick(raw, 'bodyPart', 'bp', 'muscle', 'group', 'groupe')
    created = fillEx({ id: uid(), n: name, bp: mobility ? 'mobility' : bodyPartOf(said, name) })
    if (!said && !mobility) { const g = guessBodyPart(name); if (g && g.tg) created.tg = g.tg }
    // A body part alone spreads a flat, invented share over the muscles in it, which for a
    // compound is wrong in the direction that matters: "chest" fatigues the chest and
    // nothing else, so an imported bench press leaves the triceps and shoulders reading as
    // fresh. A program that names the muscles gets them stored the way the catalogue stores
    // its own — target plus supporting — and from there every map and the recovery estimate
    // treat the exercise exactly like a catalogue one. A target cell naming several muscles
    // ("Ischios, fessiers") gives the first as the target and the rest as support.
    const named = splitMuscles(pick(raw, 'target', 'primary', 'primaryMuscle', 'cible'))
    const tg = named[0] || null
    const list = [...named.slice(1), ...splitMuscles(pick(raw, 'secondary', 'secondaryMuscles', 'support', 'secondaires'))]
    if (tg && muscleSlug(tg)) created.tg = String(tg).toLowerCase().trim()
    const keep = list.filter(m => muscleSlug(m))
    if (keep.length && !mobility) created.sm = keep.map(m => m.toLowerCase())
    // Named but undrawable is worth saying: it looks like it was taken and it was not. Not for
    // mobility, whose "target" is as often a joint or a quality (ankle, balance) as a muscle.
    const dropped = [tg && !muscleSlug(tg) ? tg : null, ...list.filter(m => !muscleSlug(m))].filter(Boolean)
    if (dropped.length && !mobility) {
      report.warnings.push(t('“{0}”: {1} is not a muscle the body map draws, so it was left out.', name, dropped.join(', ')))
    }
    if (notes) created.desc = notes
    id = created.id
    made.set(madeKey, created)
    report.created.push({ name, id: created.id, bp: created.bp, muscles: musclesOf(created),
      // Candidates that work another muscle than the programme says are no help in choosing.
      candidates: [...(vetoed ? [vetoed] : []), ...(res.candidates || []).filter(c => c !== vetoed && EXIDX[c] && worksSaid(c))].filter(c => EXIDX[c]),
      ...(mobility ? { mobility: true } : {}) })
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
    cfg.reps = reps != null ? Math.round(reps) : range ? Math.round(lo) : 10
    if (weight) cfg.weight = weight
  }

  // A rep range means two different things, and the app stores each its own way. Loaded, it
  // is double progression: `reps` is the top the sets work up to and `repsMin` the bottom
  // they go back to once the weight goes up — the first session starts at the bottom (see
  // nextPrescription). Stored the other way round, as it used to be, an 8–12 collapsed to a
  // fixed 8 and the top of the range was never asked for. On bodyweight work the range is
  // the ceiling that turns "+1 rep" into "add a set" (#33), read from `repsMax`.
  if (range && cfg.mode === 'reps') {
    const bwOnly = pick(raw, 'bodyweight', 'bodyWeight', 'poidsDuCorps') === true ||
      (!weight && isBodyweightEq(cfg.id) && pick(raw, 'bodyweight', 'bodyWeight', 'poidsDuCorps') == null)
    if (bwOnly) { cfg.reps = Math.round(lo); cfg.repsMax = Math.round(hi) }
    else { cfg.reps = Math.round(hi); cfg.repsMin = Math.round(lo); cfg.rangeFrom = true }
  } else if (range) { cfg.repsMin = Math.round(lo); cfg.repsMax = Math.round(hi) }

  // "8–10 par jambe", "10/jbe": the number is each side's. The app counts a unilateral set by
  // its total — you log 16, it shows "8 per side" — so it is doubled here. Taken as written,
  // "10 par jambe" arrived as 10 in all and the session asked for five a side.
  if (raw.repsPerSide && cfg.mode === 'reps') {
    for (const k of ['reps', 'repsMin', 'repsMax']) if (cfg[k] > 0) cfg[k] *= 2
  }

  const progRaw = fold(String(pick(raw, 'progression', 'prog') || '')).trim()
  const prog = PROG_WORDS[progRaw] || progRaw
  if (prog) {
    if (POLICIES.includes(prog)) cfg.prog = prog
    else report.warnings.push(t('“{0}” is not a progression rule BodyEvolve knows — left on the routine’s default.', prog))
  }
  // A loaded range with no rule named is double progression: it is the only rule that reads
  // both ends of a range, and "8–12" written down means "work up to 12, then add weight".
  if (cfg.rangeFrom) { if (!cfg.prog) cfg.prog = 'double'; delete cfg.rangeFrom }
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

  // The rest after this exercise's sets, when the programme gives one — the rest timer starts
  // on it instead of the app-wide default. Zero is a value: "enchaîne", the first half of a
  // superset or a routine done without pauses.
  const rest = readRest(pick(raw, 'rest', 'repos', 'restSec'))
  if (rest != null) cfg.rest = rest
  // The coach's words for this exercise in this programme — setup, effort target, cues — shown
  // during the session. A mobility exercise carries its instructions itself (its desc above).
  if (notes && !mobility) cfg.note = notes
  // Mobility work progresses by phase, on criteria the programme sets, not by the engine.
  if (mobility && !cfg.prog) cfg.prog = 'off'

  return { cfg, created }
}

/**
 * The bundle as the review left it: every name a person pointed at a catalogue exercise points
 * there now, and the custom exercise that stood in for it is dropped once nothing uses it.
 * `picks` maps a stand-in's id to the catalogue id chosen for it; a stand-in left unpicked is
 * kept as the person's own exercise, as the import always did.
 */
export function applyPicks(bundle, picks) {
  const swap = Object.fromEntries(Object.entries(picks || {}).filter(([, id]) => id && EXIDX[id]))
  if (!Object.keys(swap).length) return bundle
  const routines = bundle.routines.map(r => ({ ...r, ex: r.ex.map(e => (swap[e.id] ? { ...e, id: swap[e.id] } : e)) }))
  const still = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  return { ...bundle, routines, customEx: bundle.customEx.filter(c => still.has(c.id)) }
}

/* ------------------------------------------------------------- CSV ---- */
// A programme as a spreadsheet: one row per exercise, under whatever headers the person who
// wrote it chose — a coach's Excel in French, a sheet exported by another app, a table out of
// a conversation. It is read into the very object the JSON path takes, so everything after
// this point — name matching, the review, the merge — is one code path for both.

// Header names, folded (accents off, lower case, punctuation as spaces). A header matches a
// name exactly or starts with it followed by a word ("Poids (kg)", "Reps cibles"). Order
// matters: the specific before the general, and every field is taken by its first column.
const PROG_COLS = [
  ['weekday', ['jour de la semaine', 'jour semaine', 'weekday', 'day of week', 'day of the week', 'jour', 'day']],
  ['routine', ['seance', 'session', 'routine', 'workout', 'entrainement', 'training', 'split', 'journee', 'nom de la seance', 'nom seance']],
  ['exercise', ['exercice', 'exercise', 'exo', 'mouvement', 'movement', 'nom de l exercice', 'nom exercice', 'exercise name', 'nom', 'name']],
  ['setsReps', ['series x reps', 'series x repetitions', 'sets x reps', 'series reps', 'sets reps', 'schema', 'scheme', 'format', 'prescription']],
  ['sets', ['series', 'sets', 'set', 'serie', 'nb series', 'nombre de series']],
  ['reps', ['repetitions', 'reps', 'rep', 'repetition', 'nb reps', 'nombre de reps', 'objectif', 'fourchette']],
  ['weight', ['poids', 'charge', 'kg', 'weight', 'load']],
  ['seconds', ['secondes', 'seconds', 'sec', 'hold', 'maintien']],
  ['minutes', ['minutes', 'min', 'duree', 'duration', 'temps']],
  ['superset', ['superset', 'super set', 'bi set', 'biset', 'groupe', 'circuit']],
  ['order', ['ordre', 'order', 'numero', 'no', 'n', 'index', 'position']],
  // What kind of work a row is: "Mobilité" files it with the joint and mobility work.
  ['kind', ['categorie', 'category', 'type', 'famille']],
  // The muscle a row works, in its own column — ahead of the body part, which also answers to
  // "muscle".
  ['target', ['muscle cible', 'muscles cibles', 'muscle principal', 'cible', 'target', 'primary muscle']],
  ['bodyPart', ['groupe musculaire', 'muscle', 'muscles', 'body part', 'partie du corps', 'zone']],
  ['perSide', ['par cote', 'unilateral', 'unilaterale', 'per side', 'cote']],
  ['progression', ['progression']],
  ['rest', ['repos', 'rest', 'recup', 'recuperation']],
  // The coach's words for the row: setup, cues, the phases of a mobility drill.
  ['notes', ['consignes', 'instructions', 'indications', 'notes', 'note', 'description', 'details', 'conseils', 'commentaires', 'commentaire', 'remarques']],
]
const headKey = h => fold(h).replace(/[^a-z0-9]+/g, ' ').trim()
function mapProgHeader(row) {
  const map = {}
  row.forEach((h, i) => {
    const raw = String(h || '').trim()
    const n = raw === '#' || /^n°$/i.test(raw) ? 'order' : headKey(raw)
    if (!n) return
    for (const [field, names] of PROG_COLS) {
      if (map[field] !== undefined) continue
      if (n === field || names.some(x => n === x || n.startsWith(x + ' '))) { map[field] = i; return }
    }
  })
  return map
}

// "4x8-10", "3 × 12", "4 séries de 8", "3x30s" — the sets and what each set is, in one cell.
const SETS_X = /^(\d+)\s*(?:x|×|\*|séries? de|series? de|sets? of)\s*(.+)$/i
const RANGE = /^(\d+)\s*(?:-|–|—|à|a|to)\s*(\d+)$/i
const SIDE = /(par|chaque|each|per|\/)\s*(jambe|jbe|jb|bras|cote|côté|side|leg|arm)/i
// What one set is: reps, a range, a hold, minutes — and whether it is per side.
function readSet(cell) {
  let s = String(cell || '').trim().toLowerCase().replace(',', '.')
  if (!s) return {}
  const out = {}
  if (SIDE.test(s)) { out.perSide = true; s = s.replace(SIDE, '').trim() }
  if (/^(amrap|max|echec|échec|failure)\b/.test(s)) { out.amrap = true; return out }
  // A hold given as a range — "20–30 s" — starts at its low end and is worked up from there.
  const span = s.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|—|à|a|to)\s*\d+(?:\.\d+)?\s*(s|sec|secs|secondes?|seconds?|"|min|mins|minutes?|')$/)
  if (span) {
    if (/^(min|mins|minutes?|')$/.test(span[2])) out.minutes = +span[1]; else out.seconds = +span[1]
    return out
  }
  const time = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|secondes?|seconds?|"|'|min|mins|minutes?)$/)
  if (time) {
    const v = +time[1]
    if (/^(min|mins|minutes?|')$/.test(time[2])) out.minutes = v; else out.seconds = v
    return out
  }
  const mmss = s.match(/^(\d+):(\d{2})$/)
  if (mmss) { out.seconds = +mmss[1] * 60 + +mmss[2]; return out }
  const r = s.replace(/\s*(reps?|répétitions?|repetitions?|rép)\b\.?/g, '').trim()
  const range = r.match(RANGE)
  if (range) { out.repsMin = +range[1]; out.repsMax = +range[2]; return out }
  const n = r.match(/^(\d+)$/)
  if (n) out.reps = +n[1]
  return out
}
// A load as a coach writes it: "60", "60 kg", "62,5", "PDC" for bodyweight, "+10" on a belt.
function readLoad(cell) {
  const s = String(cell || '').trim().toLowerCase()
  if (!s) return {}
  if (/^(pdc|poids du corps|bodyweight|bw|body weight)$/.test(s)) return { bodyweight: true }
  const m = s.replace(',', '.').match(/^(\+)?\s*(\d+(?:\.\d+)?)/)
  if (!m) return {}
  return m[1] ? { weight: +m[2], bodyweight: true } : { weight: +m[2] }
}

/**
 * Read a programme spreadsheet into the object parseProgram takes — or null when the text is
 * not a table with an exercise column in it, so the caller can say what it expected.
 *
 * A row whose session cell is blank belongs to the session above it: a spreadsheet with the
 * session merged across its exercises exports exactly that. A row with only its first cell
 * filled is a section title naming the session below it, the other way programmes are laid
 * out. Rows sharing a letter in an order column — A1, A2 — are a superset.
 */
export function programFromCSV(text) {
  const body = unfence(text)
  let best = null
  for (const delim of DELIMS) {
    const rows = parseCSV(body, delim).map(r => r.map(c => String(c || '').trim()))
      // a Markdown table's outer pipes and its |---| rule
      .map(r => (delim === '|' ? r.filter((c, i) => !((i === 0 || i === r.length - 1) && c === '')) : r))
      .filter(r => !r.every(c => !c || /^:?-{2,}:?$/.test(c)))
    for (let i = 0; i < rows.length && i < 8; i++) {
      if (rows[i].length < 2) continue
      const map = mapProgHeader(rows[i])
      if (map.exercise === undefined) continue
      const score = Object.keys(map).length
      if (!best || score > best.score) best = { rows: rows.slice(i), map, score }
      break
    }
  }
  if (!best || best.rows.length < 2) return null
  const { rows, map } = best
  const cell = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim())

  // "Jour" is a weekday column when its values are weekdays — and the session's own name when
  // they are not ("Jour 1", "Push"), unless another column already names the session.
  if (map.weekday !== undefined) {
    const vals = rows.slice(1).map(r => cell(r, 'weekday')).filter(Boolean)
    const days = vals.filter(v => dayIndex(v) != null).length
    if (vals.length && days < vals.length * 0.8) {
      if (map.routine === undefined) map.routine = map.weekday
      delete map.weekday
    }
  }
  // Title rows only exist in a table that also has rows of several cells: a file that is a
  // bare list of exercise names, one per line, is that and nothing else.
  const width = r => r.filter(Boolean).length
  const titled = map.routine === undefined && rows.slice(1).some(r => width(r) === 1) && rows.slice(1).some(r => width(r) > 1)

  const routines = []
  const byName = new Map()
  const week = {}
  let current = null
  const sessionNamed = name => {
    const key = fold(name)
    if (!byName.has(key)) { const r = { name, exercises: [], order: [] }; byName.set(key, r); routines.push(r) }
    return byName.get(key)
  }
  for (const r of rows.slice(1)) {
    const exName = cell(r, 'exercise')
    const filled = r.filter(Boolean)
    // A title row: one cell and nothing measured on it — the session the rows below belong to,
    // whichever column it was typed in.
    if (titled && filled.length === 1) { current = sessionNamed(filled[0]); continue }
    if (!exName) continue
    const named = cell(r, 'routine')
    const day = cell(r, 'weekday')
    if (named) current = sessionNamed(named)
    // No session column and no title rows: each weekday is a session of its own, named by it.
    else if (map.routine === undefined && !titled && day) current = sessionNamed(day)
    if (!current) current = sessionNamed(t('Routine {0}', 1))
    if (day && dayIndex(day) != null) week[dayIndex(day)] = current.name

    const ex = { name: exName }
    const combined = cell(r, 'setsReps') || ''
    const setsCell = cell(r, 'sets'), repsCell = cell(r, 'reps')
    // A sets×reps cell, wherever it is written — its own column, or in the sets or reps one.
    for (const c of [combined, setsCell, repsCell]) {
      const m = String(c).match(SETS_X)
      if (m) { ex.sets = +m[1]; Object.assign(ex, readSet(m[2])); break }
    }
    if (ex.sets == null && setsCell) { const n = String(setsCell).match(/\d+/); if (n) ex.sets = +n[0] }
    if (ex.reps == null && ex.repsMin == null && ex.seconds == null && ex.minutes == null && repsCell && !SETS_X.test(repsCell)) {
      Object.assign(ex, readSet(repsCell))
    }
    if (ex.seconds == null && cell(r, 'seconds')) { const n = parseFloat(cell(r, 'seconds').replace(',', '.')); if (n > 0) ex.seconds = n }
    if (ex.minutes == null && cell(r, 'minutes')) { const v = readSet(cell(r, 'minutes')); if (v.minutes || v.seconds) Object.assign(ex, v); else { const n = parseFloat(cell(r, 'minutes').replace(',', '.')); if (n > 0) ex.minutes = n } }
    Object.assign(ex, readLoad(cell(r, 'weight')))
    if (ex.repsMin != null) { ex.repsMin = Math.min(ex.repsMin, ex.repsMax); ex.repsMax = Math.max(ex.repsMin, ex.repsMax) }
    if (cell(r, 'perSide') && !/^(non|no|0|false)$/i.test(cell(r, 'perSide'))) ex.perSide = true
    if (cell(r, 'bodyPart')) ex.bodyPart = cell(r, 'bodyPart')
    if (cell(r, 'target')) ex.target = cell(r, 'target')
    if (cell(r, 'kind')) ex.kind = cell(r, 'kind')
    if (cell(r, 'rest')) ex.rest = cell(r, 'rest')
    if (cell(r, 'notes')) ex.notes = cell(r, 'notes')
    // A side named in the reps cell or in its own column means the number is each side's.
    if (ex.perSide) ex.repsPerSide = true
    if (cell(r, 'progression')) ex.progression = cell(r, 'progression')
    if (cell(r, 'superset')) ex.superset = cell(r, 'superset')
    if (ex.amrap) delete ex.amrap
    current.exercises.push(ex)
    current.order.push(cell(r, 'order'))
  }
  // A1 / A2 — the same letter, back to back — is a superset; a lone A1 is just the first lift.
  routines.forEach(rt => {
    const letters = rt.order.map(o => { const m = String(o || '').match(/^([a-z])\s*\d+$/i); return m ? m[1].toUpperCase() : null })
    letters.forEach((L, i) => {
      if (!L || rt.exercises[i].superset) return
      if (letters.filter(x => x === L).length > 1) rt.exercises[i].superset = L
    })
    delete rt.order
  })
  const kept = routines.filter(rt => rt.exercises.length)
  return kept.length ? { routines: kept, week } : null
}

// What a pasted or opened programme is: JSON (the format the app hands out), or a table.
function readProgramText(text) {
  const s = String(text || '')
  let jsonErr = null
  if (s.includes('{')) { try { return extractJSON(s) } catch (e) { jsonErr = e } }
  const csv = programFromCSV(s)
  if (csv) return csv
  throw jsonErr || new Error(t('no program found in that text — a table needs an exercise column'))
}

/**
 * Parse a program into a bundle mergePlan can take, plus a report of how every name resolved.
 * Accepts an object, a JSON string, or a reply with JSON somewhere inside it.
 *
 * Throws only when there is nothing usable at all — a program with one unreadable routine
 * still imports the rest, because a partial plan you can fix beats an error you cannot.
 */
export function parseProgram(raw, { used = null, name = '' } = {}) {
  const data = typeof raw === 'string' ? readProgramText(raw) : raw
  if (!data || typeof data !== 'object') throw new Error(t('no program found in that text'))

  const rawRoutines = data.routines || data.days || data.sessions
  if (!Array.isArray(rawRoutines) || !rawRoutines.length) {
    throw new Error(t('that program has no routines in it'))
  }

  const report = { matched: [], created: [], warnings: [] }
  const customEx = []
  const made = new Map()            // invented exercises by name, so one is created once
  const byName = new Map()          // routine name (lowercased) -> generated id, for the week

  const routines = rawRoutines.map((r, i) => {
    const name = String(pick(r || {}, 'name', 'nom', 'title', 'routine') || '').trim() || t('Routine {0}', i + 1)
    const list = (r && (r.exercises || r.ex || r.exercices)) || []
    const ex = []
    ;(Array.isArray(list) ? list : []).forEach(item => {
      const read = readExercise(typeof item === 'string' ? { name: item } : (item || {}), report, used, made)
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
    name: String(data.name || data.program || data.nom || name || '').trim(),
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

/**
 * The spreadsheet version of the contract, for a coach who writes programmes in Excel and for
 * a conversation asked for "a table". A function, like historySpec, because it is translated as
 * one block and the dictionary is not loaded when this module is.
 */
export const programCsvSpec = () => t(`One row per exercise, under exactly this header — commas or semicolons:

Session;Day;Exercise;Sets;Reps;Weight (kg)
Push;Monday;Barbell bench press;4;8-10;80
Push;Monday;Incline dumbbell press;3;10-12;30
Push;Monday;Dumbbell lateral raise;3;12-15;
Pull;Wednesday;Cable pulldown;4;10;65
Legs A;Friday;Barbell squat;5;5;100

Rules:
· Session: the session's name, the same on each of its rows (Push, Pull, Legs A…).
· Day: optional. Left empty, each session keeps the day the session of the same name has now.
· Exercise: its usual name, in French or in English. The closer to the app's own names, the fewer to check when importing.
· Reps: a number (10), a range (8-12), a hold (45s), or "10 per leg".
· Weight: optional, in kg. PDC for bodyweight.
· Two exercises done back to back: add an Order column with A1 and A2.`)
