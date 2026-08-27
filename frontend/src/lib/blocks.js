// Training blocks: a whole schedule saved under a name, switched in one tap, and dated.
//
// A weekly schedule is one week wide, which is not how training is actually organised. A
// block runs for six weeks and then a different one starts; an upper/lower split alternates
// A and B; a deload week replaces the hard one and then gives it back. All of that is
// impossible to say with a single Monday-to-Sunday map, and the workaround — rewriting the
// week by hand every time — has a cost nobody notices until months later: it rewrites the
// past too. Last April's Tuesday starts claiming it was whatever Tuesday is now.
//
// So a block is a named list of weeks, and switching to one is an event with a date on it:
//
//   blocks   [{ id, name, emoji, weeks: [{0..6: routineId}, …] }]
//   blockLog [{ from: '2026-08-26', blockId }]   sorted, oldest first
//
// Reading the plan for a day means finding the entry in force on that day, then counting
// whole weeks from its start to pick which of the block's weeks applies. Nothing is stored
// per day, so a switch dated today changes every future day at once and no past day at all —
// which is the property the whole design exists for.
//
// An empty blockLog means the profile has never used a block, and everything falls through
// to S.week exactly as before. That fallback is load-bearing: it is what lets this ship
// without migrating anybody.

import { isoOf, todayISO, uid } from './format.js'

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]
/* Two weeks is the alternation people actually run; beyond four it is a calendar, not a
   block, and a per-day override says it better. */
export const MAX_WEEKS = 4

const dayNum = iso => Math.floor(new Date(iso + 'T12:00:00').getTime() / 86400000)
const cleanWeek = w => {
  const out = {}
  if (w && typeof w === 'object') for (const d of WEEKDAYS) if (w[d]) out[d] = w[d]
  return out
}

export const blocksOf = S => ((S && S.blocks) || []).filter(b => b && b.id)
export const blockById = (S, id) => blocksOf(S).find(b => b.id === id) || null

/** The switch in force on a day: the latest entry dated on or before it, or null. */
export function entryAt(S, iso = todayISO()) {
  const log = ((S && S.blockLog) || [])
    .filter(e => e && e.from && e.blockId)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  let found = null
  for (const e of log) { if (e.from <= iso) found = e; else break }
  return found && blockById(S, found.blockId) ? found : null
}

/** The block in force on a day, with the entry that put it there. */
export function blockAt(S, iso = todayISO()) {
  const e = entryAt(S, iso)
  return e ? { block: blockById(S, e.blockId), from: e.from } : null
}

/** The block running today — what the Plan screen is editing. */
export const activeBlock = S => blockAt(S, todayISO())

/**
 * Which of a block's weeks a day falls in.
 *
 * Counted in whole weeks from the switch date, so the cycle is anchored to the day the block
 * started rather than to the calendar's week numbers. A block begun on a Thursday alternates
 * every seventh day from that Thursday, which is what someone who started it on a Thursday
 * means by "every other week".
 */
export function weekIndexAt(block, from, iso) {
  const n = (block && block.weeks && block.weeks.length) || 1
  if (n <= 1) return 0
  const d = Math.floor((dayNum(iso) - dayNum(from)) / 7)
  return ((d % n) + n) % n
}

/**
 * The weekday→routine map in force on a day. The one function every reader should call:
 * S.week is the fallback for a profile that has never made a block, not the answer.
 */
export function weekFor(S, iso = todayISO()) {
  const at = blockAt(S, iso)
  if (!at || !at.block) return (S && S.week) || {}
  const weeks = at.block.weeks && at.block.weeks.length ? at.block.weeks : [{}]
  return weeks[weekIndexAt(at.block, at.from, iso)] || {}
}

/**
 * Where a weekday assignment should be written: into the running block, or into S.week.
 *
 * `weekIdx` names which of an alternating block's weeks to write, for the editor that lets
 * you set up week B while week A is the one running. Left out, it writes the week actually
 * in force — which is what tapping a day on the schedule means.
 */
export function setWeekDay(S, wd, routineId, { iso = todayISO(), weekIdx = null, blockId = null } = {}) {
  const at = blockAt(S, iso)
  // A named block wins over whatever is running: setting up next month's programme must not
  // require switching onto it first, which would rewrite this week to do it.
  const target = blockId ? blockById(S, blockId) : (at && at.block)
  if (target) {
    if (!Array.isArray(target.weeks) || !target.weeks.length) target.weeks = [{}]
    const live = at && at.block && at.block.id === target.id ? weekIndexAt(target, at.from, iso) : 0
    const i = weekIdx == null ? live : Math.max(0, Math.min(target.weeks.length - 1, weekIdx))
    const w = target.weeks[i] || (target.weeks[i] = {})
    if (routineId) w[wd] = routineId; else delete w[wd]
    return
  }
  if (routineId) S.week[wd] = routineId; else delete S.week[wd]
}

/** The week a block editor is showing — any block, any of its weeks, running or not. */
export function weekOfBlock(S, weekIdx = null, blockId = null, iso = todayISO()) {
  const at = blockAt(S, iso)
  const target = blockId ? blockById(S, blockId) : (at && at.block)
  if (!target) return (S && S.week) || {}
  const weeks = target.weeks && target.weeks.length ? target.weeks : [{}]
  const live = at && at.block && at.block.id === target.id ? weekIndexAt(target, at.from, iso) : 0
  const i = weekIdx == null ? live : Math.max(0, Math.min(weeks.length - 1, weekIdx))
  return weeks[i] || {}
}

/** A copy of a block under a new name, so a second programme can be built without wrecking
 *  the one being followed. The obvious way to write next month's plan, and the one the first
 *  version of this had no answer for. */
export function duplicateBlock(S, id, name) {
  const src = blockById(S, id)
  if (!src) return null
  const copy = { id: uid(), name: String(name || '').slice(0, 40) || (src.name + ' 2'),
    emoji: src.emoji || 'dumbbell', weeks: src.weeks.map(w => ({ ...w })) }
  S.blocks = [...blocksOf(S), copy]
  return copy
}

/** An empty block, for a programme that shares nothing with the current one. */
export function emptyBlock(S, name) {
  const b = { id: uid(), name: String(name || '').slice(0, 40) || 'Block', emoji: 'dumbbell', weeks: [{}] }
  S.blocks = [...blocksOf(S), b]
  return b
}

/** A block built from whatever schedule is in force today — the one-tap way to get started. */
export function blockFromCurrent(S, name) {
  return { id: uid(), name: String(name || '').slice(0, 40) || 'Block', emoji: 'dumbbell',
    weeks: [cleanWeek(weekFor(S, todayISO()))] }
}

/**
 * Put a block in force from a date. Call inside store.update.
 *
 * `from` defaults to today and is clamped to today at the earliest: a switch that reached
 * back would rewrite what last month was supposed to be, and the calendar's whole claim is
 * that it does not. A future date is allowed and is the point — "I change on the 15th" is a
 * thing you know now and want to stop thinking about.
 *
 * Switching to the block already in force from the same date replaces that entry rather than
 * stacking a second one, so tapping twice cannot litter the timeline.
 */
export function startBlock(S, blockId, from = todayISO()) {
  if (!blockById(S, blockId)) return null
  const today = todayISO()
  const start = from < today ? today : from
  const log = ((S.blockLog || []).filter(e => e && e.from && e.blockId && e.from !== start))
  log.push({ from: start, blockId })
  log.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  S.blockLog = log
  return { from: start, blockId }
}

/** Undo a switch that has not happened yet. A past one is history and stays. */
export function cancelSwitch(S, from) {
  const today = todayISO()
  S.blockLog = (S.blockLog || []).filter(e => !(e.from === from && e.from > today))
}

/** Switches still to come, soonest first — what the Plan screen warns about. */
export function upcoming(S, now = Date.now()) {
  const today = isoOf(new Date(now))
  return ((S && S.blockLog) || [])
    .filter(e => e && e.from > today && blockById(S, e.blockId))
    .sort((a, b) => (a.from < b.from ? -1 : 1))
    .map(e => ({ ...e, block: blockById(S, e.blockId) }))
}

/** Days from now until a switch lands — for "in 12 days". */
export const daysUntil = (iso, now = Date.now()) => dayNum(iso) - dayNum(isoOf(new Date(now)))

/** Drop a block, and every switch that pointed at it. A running block cannot be removed. */
export function removeBlock(S, id) {
  const at = activeBlock(S)
  if (at && at.block && at.block.id === id) return false
  S.blocks = blocksOf(S).filter(b => b.id !== id)
  S.blockLog = (S.blockLog || []).filter(e => e.blockId !== id)
  return true
}

/** How many sessions a block's weeks hold, for a one-line summary. */
export const sessionsIn = block =>
  ((block && block.weeks) || []).reduce((a, w) => a + Object.keys(cleanWeek(w)).length, 0)
