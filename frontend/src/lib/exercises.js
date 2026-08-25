import { EXDB } from './exercises-data.js'
import { t, ONLY_LANG } from './i18n.js'
import EX_FR from '../names/fr.js'

export { EXDB }
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
const NAMES = ONLY_LANG === 'fr' ? EX_FR : null

export const exName = ex => (ex && (ex.custom ? ex.n : (NAMES && NAMES[ex.id]) || ex.n)) || ''

/**
 * What to match a search against: both names, so the French name is findable by the English
 * one it came from. Someone who learned "bench press" should not have to know that this build
 * files it under "développé couché".
 */
export const exSearchText = ex => {
  const fr = NAMES && NAMES[ex.id]
  return (fr ? fr + ' ' + ex.n : ex.n).toLowerCase()
}

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
