// Which muscles an exercise trains, and how hard — the data behind every muscle map.
//
// The exercise dataset names muscles in free text and is not consistent about it:
// "shoulders", "deltoids" and "delts" are the same thing, so are "quads" and
// "quadriceps", "lats" and "latissimus dorsi", "core" and "abdominals". Nineteen
// primary and forty secondary spellings collapse onto the eighteen muscles the body
// map can actually draw, via ALIAS below. Anything genuinely undrawable (hands,
// ankles, "cardiovascular system") maps to null and is dropped rather than guessed at.

import { EXIDX } from './exercises.js'

// The muscles a map can shade, in head-to-toe order — also the order of any list
// built from them, so "what am I neglecting" reads top-down like a body.
export const MUSCLES = [
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus',
  'biceps', 'triceps', 'forearm',
  'abs', 'obliques', 'lower-back',
  'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis',
]

// Drawn as the silhouette, never shaded: they carry no training load.
export const INERT = ['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles']

// English display names; these strings are the i18n keys (see lib/i18n.js).
export const MUSCLE_NAME = {
  trapezius: 'Traps', deltoids: 'Shoulders', chest: 'Chest', 'upper-back': 'Upper back',
  serratus: 'Serratus', biceps: 'Biceps', triceps: 'Triceps', forearm: 'Forearms',
  abs: 'Abs', obliques: 'Obliques', 'lower-back': 'Lower back', gluteal: 'Glutes',
  quadriceps: 'Quads', hamstring: 'Hamstrings', adductors: 'Adductors',
  'hip-flexors': 'Hip flexors', calves: 'Calves', tibialis: 'Shins',
}

// Every spelling that occurs in the dataset's `tg` and `sm` fields. null = not drawable.
const ALIAS = {
  // primaries
  abs: 'abs', pectorals: 'chest', biceps: 'biceps', glutes: 'gluteal', delts: 'deltoids',
  triceps: 'triceps', 'upper back': 'upper-back', lats: 'upper-back', calves: 'calves',
  quads: 'quadriceps', forearms: 'forearm', hamstrings: 'hamstring', spine: 'lower-back',
  traps: 'trapezius', adductors: 'adductors', 'serratus anterior': 'serratus',
  abductors: 'gluteal', 'levator scapulae': 'trapezius', 'cardiovascular system': null,
  // secondaries
  shoulders: 'deltoids', deltoids: 'deltoids', 'rear deltoids': 'deltoids',
  'rotator cuff': 'deltoids', quadriceps: 'quadriceps', core: 'abs', abdominals: 'abs',
  'lower abs': 'abs', chest: 'chest', 'upper chest': 'chest', 'hip flexors': 'hip-flexors',
  obliques: 'obliques', 'lower back': 'lower-back', rhomboids: 'upper-back',
  trapezius: 'trapezius', back: 'upper-back', 'latissimus dorsi': 'upper-back',
  brachialis: 'biceps', soleus: 'calves', shins: 'tibialis', wrists: 'forearm',
  'wrist flexors': 'forearm', 'wrist extensors': 'forearm', 'grip muscles': 'forearm',
  groin: 'adductors', 'inner thighs': 'adductors',
  ankles: null, feet: null, hands: null, 'ankle stabilizers': null,
  sternocleidomastoid: null,

  // What a coach writes, which is not what a dataset writes. A program arriving from
  // outside says "front delts" and "erector spinae", not "delts" and "spine", and a
  // secondary muscle that does not resolve is not a small loss: it is the shoulder work
  // of every bench press missing from the recovery map for good.
  'front delts': 'deltoids', 'front deltoids': 'deltoids', 'anterior delts': 'deltoids',
  'anterior deltoid': 'deltoids', 'rear delts': 'deltoids', 'rear deltoid': 'deltoids',
  'posterior delts': 'deltoids', 'posterior deltoid': 'deltoids', 'side delts': 'deltoids',
  'lateral delts': 'deltoids', 'lateral deltoid': 'deltoids', 'medial delts': 'deltoids',
  'infraspinatus': 'deltoids',
  pecs: 'chest', 'lower chest': 'chest', 'pectoralis major': 'chest',
  'erector spinae': 'lower-back', erectors: 'lower-back',
  'gluteus maximus': 'gluteal', 'gluteus medius': 'gluteal', 'glute max': 'gluteal',
  'glute medius': 'gluteal', 'hip abductors': 'gluteal',
  'hip adductors': 'adductors', 'quadriceps femoris': 'quadriceps', hamstring: 'hamstring',
  bicep: 'biceps', tricep: 'triceps', trap: 'trapezius', 'upper traps': 'trapezius',
  'mid traps': 'trapezius', 'lower traps': 'trapezius', 'teres major': 'upper-back',
  'rectus abdominis': 'abs', 'transverse abdominis': 'abs', 'tibialis anterior': 'tibialis',
  gastrocnemius: 'calves', brachioradialis: 'forearm', serratus: 'serratus',

  // French, because a program written for a French speaker is written in French. Accents
  // and hyphens are stripped before the lookup, so these are the bare forms.
  pectoraux: 'chest', poitrine: 'chest', epaules: 'deltoids', deltoides: 'deltoids',
  'deltoide anterieur': 'deltoids', 'deltoide posterieur': 'deltoids',
  'deltoide lateral': 'deltoids', 'coiffe des rotateurs': 'deltoids',
  dorsaux: 'upper-back', 'grand dorsal': 'upper-back', 'grands dorsaux': 'upper-back',
  dos: 'upper-back', 'haut du dos': 'upper-back', rhomboides: 'upper-back',
  trapezes: 'trapezius', lombaires: 'lower-back', 'bas du dos': 'lower-back',
  'erecteurs du rachis': 'lower-back',
  abdos: 'abs', abdominaux: 'abs', gainage: 'abs', 'sangle abdominale': 'abs',
  fessiers: 'gluteal', 'grand fessier': 'gluteal', 'moyen fessier': 'gluteal',
  ischios: 'hamstring', 'ischio jambiers': 'hamstring',
  adducteurs: 'adductors', abducteurs: 'gluteal',
  mollets: 'calves', jumeaux: 'calves', soleaire: 'calves',
  'tibial anterieur': 'tibialis', tibiaux: 'tibialis',
  'flechisseurs de hanche': 'hip-flexors', psoas: 'hip-flexors',
  'avant bras': 'forearm', 'dentele anterieur': 'serratus',
  cardio: null, 'corps entier': null, 'full body': null,
}

/**
 * A written name reduced to an ALIAS key: lower case, accents stripped, hyphens and
 * underscores flattened to spaces. Nobody typing a program distinguishes "ischio-jambiers"
 * from "ischio jambiers", and a muscle dropped over a hyphen never lights up again.
 */
const key = name => String(name || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

// Custom exercises carry only a body part, so they fall back to it. Weights inside a
// group sum to 1 — "upper legs" spreads over three muscles rather than counting triple.
const BY_BODYPART = {
  chest: { chest: 1 },
  back: { 'upper-back': 0.75, 'lower-back': 0.25 },
  shoulders: { deltoids: 1 },
  'upper arms': { biceps: 0.5, triceps: 0.5 },
  'lower arms': { forearm: 1 },
  waist: { abs: 0.7, obliques: 0.3 },
  'upper legs': { quadriceps: 0.4, hamstring: 0.35, gluteal: 0.25 },
  'lower legs': { calves: 0.8, tibialis: 0.2 },
  neck: { trapezius: 1 },
  cardio: {},
}

const SECONDARY = 0.4   // a supporting muscle counts this much against a primary

/**
 * The drawable muscle a spelling refers to, or null. Exported so an importer can tell a
 * name this map can shade from one it will silently drop — a program that says "lats" is
 * understood, one that says "posterior chain" is not, and the difference has to surface at
 * import time rather than as a muscle that never lights up.
 */
export const muscleSlug = name => ALIAS[key(name)] || null

/** Muscles one exercise trains: { slug: 0…1 }. */
export function musclesOf(ex) {
  if (!ex) return {}
  const out = {}
  const add = (name, w) => {
    const slug = ALIAS[key(name)]
    if (slug) out[slug] = Math.max(out[slug] || 0, w)
  }
  add(ex.tg, 1)
  ;(ex.sm || []).forEach(m => add(m, SECONDARY))
  // Nothing recognised (custom exercises, or a target we don't draw) — use the body part.
  if (!Object.keys(out).length) Object.assign(out, BY_BODYPART[ex.bp] || {})
  return out
}

/**
 * Training load per muscle, in "effective sets".
 * `items` is [{ id, sets }] — sets being a count, so a 4×8 bench press weighs four
 * times a single set. Volume in kg is deliberately not used: 100 kg of leg press
 * against 12 kg of lateral raise says nothing about which muscle worked harder.
 */
export function loadOf(items) {
  const load = {}
  items.forEach(({ id, sets }) => {
    if (!sets) return
    const m = musclesOf(EXIDX[id])
    for (const slug in m) load[slug] = (load[slug] || 0) + m[slug] * sets
  })
  return load
}

/**
 * Load for finished workouts (only sets actually ticked off count). `pick` narrows that
 * further — the map can then answer "where did the *hard* sets go", which is a different
 * question from where the sets went: a muscle can lead on volume and still never be trained
 * near failure.
 */
export const loadOfWorkouts = (workouts, pick) =>
  loadOf((workouts || []).flatMap(w =>
    (w.entries || []).map(e => ({ id: e.id, sets: (e.sets || []).filter(s => s.done && (!pick || pick(s))).length }))))

/** Load a routine *would* produce, from its planned set counts. */
export const loadOfRoutine = routine =>
  loadOf((routine?.ex || []).map(c => ({ id: c.id, sets: c.sets || 1 })))

/** Load for a workout still in progress — the sets ticked so far. */
export const loadOfActive = active =>
  loadOf((active?.entries || []).map(e => ({ id: e.id, sets: (e.sets || []).filter(s => s.done).length })))

/**
 * Shade buckets 0–4 per muscle, relative to the hardest-worked muscle in the same
 * window. Relative rather than absolute on purpose: the map answers "is my training
 * balanced", which only means anything as a comparison within one period.
 */
export function levelsOf(load) {
  const max = Math.max(0, ...MUSCLES.map(m => load[m] || 0))
  const lv = {}
  MUSCLES.forEach(m => {
    const v = load[m] || 0
    lv[m] = !v ? 0 : max <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(v / max * 4)))
  })
  return lv
}

/**
 * A load — or one exercise's own weights — as whole percentages that add to 100.
 *
 * Rounded by largest remainder rather than independently: three muscles at 55.6 / 22.2 / 22.2
 * round to 56 / 22 / 22 and sum to 100, where rounding each on its own gives 56 / 22 / 22 in
 * one case and 55 / 22 / 22 in another, and a reader who adds them up finds 99. The share is
 * what is worth showing over the raw figure: "chest 56 %" says what a set of bench press
 * *is*, where "chest 1.0" needs the scale explained before it means anything.
 *
 * Muscles under one percent are dropped rather than shown as 0 %, and their share goes back
 * into the rounding, so the total still reads 100.
 */
export function sharesOf(load, min = 1) {
  const raw = MUSCLES.map(m => ({ slug: m, v: load[m] || 0 })).filter(x => x.v > 0)
  const total = raw.reduce((n, x) => n + x.v, 0)
  if (!total) return []

  const scaled = raw.map(x => ({ slug: x.slug, exact: x.v / total * 100 }))
    .filter(x => x.exact >= min)
    .sort((a, b) => b.exact - a.exact)
  if (!scaled.length) return []

  // Renormalise over what survived the floor, then hand the leftover percent to whoever
  // lost the most to rounding — the largest-remainder method.
  const kept = scaled.reduce((n, x) => n + x.exact, 0)
  const parts = scaled.map(x => {
    const exact = x.exact / kept * 100
    return { slug: x.slug, pct: Math.floor(exact), rem: exact - Math.floor(exact) }
  })
  let left = 100 - parts.reduce((n, x) => n + x.pct, 0)
  parts.slice().sort((a, b) => b.rem - a.rem).forEach(p => { if (left-- > 0) p.pct++ })
  return parts.map(({ slug, pct }) => ({ slug, pct }))
}

/** The same, for a single exercise: what one set of it is, muscle by muscle. */
export const sharesOfExercise = ex => sharesOf(musclesOf(ex))

/** Muscles sorted hardest-worked first; untrained ones last, in body order. */
export function rankOf(load) {
  const worked = MUSCLES.filter(m => (load[m] || 0) > 0).sort((a, b) => load[b] - load[a])
  const missed = MUSCLES.filter(m => !(load[m] > 0))
  return { worked, missed }
}
