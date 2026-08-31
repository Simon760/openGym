import { EXDB as UPSTREAM } from './exercises-data.js'
import { EX_EXTRA } from './exercises-extra.js'
import { t, ONLY_LANG } from './i18n.js'
import EX_FR from '../names/fr.js'

// The catalogue is the vendored dataset plus the movements this app adds to it (see
// exercises-extra.js). One list from here on: every lookup, filter, search and body-map
// read downstream goes through EXDB or EXIDX and needs no idea which half a record came
// from. Extras lead so a movement added because it was missing is the easier one to find.
export const EXDB = [...EX_EXTRA, ...UPSTREAM]
export const EXIDX = {}
EXDB.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(EXDB.map(e => e.bp))].sort()

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

/**
 * The catalogue's names, in the build's language.
 *
 * Upstream translates the instruction steps into ten languages and the names into none, so
 * these are generated — see scripts/build-exercise-fr.mjs, which composes them from a table
 * of movement heads, modifiers and equipment rather than word by word, because French does
 * not order them the way English does. It only emits a name when every word of the English
 * was accounted for: about six in ten of the catalogue today, and the rest keep their English
 * name rather than arriving half translated.
 *
 * A custom exercise is whatever its owner typed and is never touched.
 */
// The generated table cannot name an exercise it never saw, so each extra carries its own.
const NAMES = ONLY_LANG === 'fr' ? { ...EX_FR, ...Object.fromEntries(EX_EXTRA.filter(e => e.fr).map(e => [e.id, e.fr])) } : null

export const exName = ex => (ex && (ex.custom ? ex.n : (NAMES && NAMES[ex.id]) || ex.n)) || ''

/**
 * The catalogue's own English name, when the displayed one is a translation of it.
 *
 * Empty for a custom exercise (its owner typed the only name it has) and for anything the
 * generator left in English (the displayed name *is* this one). Kept on screen because the
 * English name is what the rest of the gym world uses: a search in either language finds the
 * exercise — see exSearchText — and this is how you confirm the one you found is the one you
 * meant, when six French names differ by one word.
 */
export const exNameEn = ex => {
  if (!ex || ex.custom || typeof ex.n !== 'string') return ''
  return exName(ex) === ex.n ? '' : ex.n
}

/**
 * What to match a search against: both names, so the French name is findable by the English
 * one it came from. Someone who learned "bench press" should not have to know that this build
 * files it under "développé couché".
 */
export const exSearchText = ex => {
  const fr = NAMES && NAMES[ex && ex.id]
  const n = ex && typeof ex.n === 'string' ? ex.n : String((ex && ex.n) ?? '')
  return (fr ? fr + ' ' + n : n).toLowerCase()
}

/**
 * Does an exercise match a search? One place, and defensive about every field it reads.
 *
 * This used to be written inline, twice, as a chain of `.includes` straight off the record —
 * and a record is not guaranteed to have those fields. An exercise created by importing a
 * shared plan carried a name and a body part and nothing else, so `ex.tg.includes(q)` threw
 * the moment a search became non-empty, which is to say on the first letter typed. The whole
 * app went blank, from one imported exercise, in two different screens.
 *
 * A search is the last place that should be brittle: it runs over records from the catalogue,
 * from imports, from other people's shared plans and from a text box. Everything is coerced.
 */
export const exMatches = (ex, ql) => {
  if (!ql) return true
  if (!ex) return false
  const has = v => typeof v === 'string' && v.toLowerCase().includes(ql)
  return exSearchText(ex).includes(ql) || has(ex.tg) || has(ex.eq) || has(ex.desc)
}

/**
 * What a complete exercise record looks like, for anything that builds one.
 *
 * Every caller is making a user-side exercise — created by hand, or by an import that found
 * no catalogue match — so `custom` is asserted rather than defaulted. Only the fields a
 * search reads are filled in, and only when they are missing.
 */
export const fillEx = ex => ({ tg: '', eq: 'custom', desc: '', ...ex, custom: true })

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
// Full searchable catalogue — customs first so your own exercises are easy to find.
export const allExercises = st => [...(st.customEx || []), ...EXDB]

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment.
// A build can also carry its media inside the bundle rather than fetching it: if
// __OG_MEDIA__ is defined it maps a media filename to an inline data: URI, and
// anything missing from it still falls through to the base above. That is what
// makes a single-file offline build possible (scripts/build-preview.mjs); in a
// normal build the global is undefined and this costs one lookup that misses.
const IMG_BASE = import.meta.env.VITE_IMG_BASE || 'img/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || 'gif/'
const embedded = file => globalThis.__OG_MEDIA__?.[file]
export const imgSrc = ex => embedded(ex.img) || IMG_BASE + ex.img
export const gifSrc = ex => embedded(ex.gif) || GIF_BASE + ex.gif

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
export const isBodyweightEq = idOrEx =>
  (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq === 'body weight'

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }
