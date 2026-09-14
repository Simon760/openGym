import { describe, it, expect } from 'vitest'
import { currentProgrammeStart, earliestLoggedDay, sportExportRows, sportExportCSV, sportExportSummary } from './sport-export.js'
import { EXDB, EXIDX, exName } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id

const D1 = '2026-08-01', D2 = '2026-08-05', D3 = '2026-08-10'

const base = (over = {}) => ({
  routines: [{ id: 'push', name: 'Push', ex: [] }, { id: 'pull', name: 'Pull', ex: [] }],
  week: {}, dayPlan: {}, workouts: [], blocks: [], blockLog: [], health: [], ...over
})

const liftedSet = (w, r, extra = {}) => ({ w, r, done: true, ...extra })

const workout = (over = {}) => ({
  id: 'w1', d: D2, name: 'Push', routineId: 'push', vol: 0,
  start: new Date(D2 + 'T09:00:00').getTime(), end: new Date(D2 + 'T09:50:00').getTime(),
  entries: [], ...over
})

describe('earliestLoggedDay', () => {
  it('is null with nothing logged', () => {
    expect(earliestLoggedDay(base())).toBe(null)
  })
  it('finds the earliest date across every session, not just the last one pushed', () => {
    const S = base({ workouts: [workout({ d: D3 }), workout({ d: D1 }), workout({ d: D2 })] })
    expect(earliestLoggedDay(S)).toBe(D1)
  })
})

describe('currentProgrammeStart', () => {
  it('is null on a fresh profile — nothing to date yet', () => {
    expect(currentProgrammeStart(base())).toBe(null)
  })

  it('is null when the week is set up but never trained', () => {
    const S = base({ week: { 1: 'push' } })
    expect(currentProgrammeStart(S)).toBe(null)
  })

  it('without a block, reads the start back out of history — the earliest session on one of the week’s own routines', () => {
    const S = base({
      week: { 1: 'push', 3: 'pull' },
      workouts: [workout({ d: D3, routineId: 'push' }), workout({ d: D1, routineId: 'pull' }),
        workout({ d: D2, routineId: 'push' })]
    })
    expect(currentProgrammeStart(S)).toBe(D1)
  })

  it('ignores a session logged for a routine the current week does not run', () => {
    const S = base({
      week: { 1: 'push' },
      workouts: [workout({ d: D1, routineId: 'legs' }), workout({ d: D2, routineId: 'push' })]
    })
    expect(currentProgrammeStart(S)).toBe(D2)
  })

  it('with an active block, uses its own dated switch rather than history — even one that reaches back further', () => {
    const S = base({
      week: { 1: 'push' },
      blocks: [{ id: 'b1', name: 'PPL', weeks: [{ 1: 'push' }] }],
      blockLog: [{ from: D2, blockId: 'b1' }],
      workouts: [workout({ d: D1, routineId: 'push' })]
    })
    expect(currentProgrammeStart(S)).toBe(D2)
  })
})

describe('sportExportRows — one block per session', () => {
  it('opens a session with one header line carrying its own figures', () => {
    const S = base({ workouts: [workout({ watch: { kcal: 430 }, vol: 1800, bw: 79,
      entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows[0]).toEqual([D2, 'Push', 50, 430, 1800, 79])
  })

  it('shapes exercise and set lines exactly — header, exercise, then one line per set', () => {
    const S = base({ workouts: [workout({ entries: [
      { id: LIFT, target: {}, sets: [liftedSet(60, 10), liftedSet(62.5, 8)] }
    ] })] })
    const rows = sportExportRows(S, D2, D2)
    // header, exercise, set 1, set 2 — four lines for one exercise of two sets
    expect(rows).toHaveLength(4)
    expect(rows[1]).toEqual(['', exName(EXIDX[LIFT])])
    expect(rows[2]).toEqual(['', '', 'Set 1', '60×10'])
    expect(rows[3][2]).toBe('Set 2')
    expect(rows[3][3]).toContain('62.5')  // number formatting follows lang, forced to 'en' under vitest — see i18n.js TESTING
  })

  it('keeps a drop set’s whole chain on its one line', () => {
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [
      { w: 60, r: 10, done: true, drops: [{ w: 45, r: 8 }] }
    ] }] })] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows[2][3]).toBe('60×10→45×8')
  })

  it('drops warm-up sets and unchecked sets, keeps done working sets', () => {
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [
      { w: 20, r: 10, done: true, warm: true },
      { w: 60, r: 10, done: false },
      liftedSet(60, 10)
    ] }] })] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows.filter(r => typeof r[2] === 'string' && r[2].startsWith('Set'))).toHaveLength(1)
  })

  it('reads a cardio set’s detail the same way the app already labels it', () => {
    const S = base({ workouts: [workout({ entries: [{ id: CARDIO, target: { mode: 'cardio' },
      sets: [{ min: 20, done: true }] }] })] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows[2][3]).toContain('20 min')
  })

  it('separates two sessions with one blank line', () => {
    const S = base({ workouts: [
      workout({ id: 'a', d: D1, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] }),
      workout({ id: 'b', d: D2, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })
    ] })
    const rows = sportExportRows(S, D1, D2)
    const blankIdx = rows.findIndex(r => r.length === 0)
    expect(blankIdx).toBeGreaterThan(0)
    expect(rows[blankIdx + 1][0]).toBe(D2)
  })

  it('does not open a blank line before the very first session', () => {
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })] })
    expect(sportExportRows(S, D2, D2)[0].length).toBeGreaterThan(0)
  })

  it('keeps a live session’s own clock even with nothing ticked off — it still ran that long', () => {
    // workout() gives every fixture a 50-minute start/end by default.
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [{ w: 60, r: 10, done: false }] }] })] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([D2, 'Push', 50, '', '', ''])
  })

  it('drops a session with no clock, no watch figures and nothing done — truly empty', () => {
    const S = base({ workouts: [workout({ start: undefined, end: undefined,
      entries: [{ id: LIFT, target: {}, sets: [{ w: 60, r: 10, done: false }] }] })] })
    expect(sportExportRows(S, D2, D2)).toHaveLength(0)
  })

  it('surfaces a day the watch measured training on with nothing logged here for it', () => {
    const S = base({ health: [{ d: D2, sport: 300, sportMin: 40 }] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows).toEqual([[D2, 'training, no session logged', 40, 300]])
  })

  it('does not duplicate that figure when a session already carries it', () => {
    const S = base({
      workouts: [workout({ watch: { kcal: 300 }, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })],
      health: [{ d: D2, sport: 300 }]
    })
    expect(sportExportRows(S, D2, D2).filter(r => r.length && r[0] === D2)).toHaveLength(1)
  })

  it('interleaves a stray day chronologically rather than dumping it at the end', () => {
    const S = base({
      workouts: [workout({ d: D3, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })],
      health: [{ d: D1, sport: 200 }]
    })
    const rows = sportExportRows(S, D1, D3)
    expect(rows[0][0]).toBe(D1)
  })

  it('respects the date range on both ends', () => {
    const S = base({ workouts: [
      workout({ id: 'a', d: D1, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] }),
      workout({ id: 'b', d: D3, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })
    ] })
    expect(sportExportRows(S, D2, D3).some(r => r[0] === D1)).toBe(false)
    expect(sportExportRows(S, D1, D1).some(r => r[0] === D3)).toBe(false)
  })
})

describe('sportExportCSV', () => {
  it('starts with the session header and quotes a cell that needs it', () => {
    const S = base({ workouts: [workout({ name: 'Push, heavy', entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })] })
    const { csv } = sportExportCSV(S, D2, D2)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Date,Séance,Durée (min),Énergie (kcal),Volume (kg),Poids du jour (kg)')
    expect(lines[1]).toContain('"Push, heavy"')
  })

  it('an exercise and set line read as indented — leading cells empty', () => {
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })] })
    const lines = sportExportCSV(S, D2, D2).csv.split('\r\n')
    expect(lines[2]).toMatch(/^,[^,]/)       // exercise: one leading comma
    expect(lines[3]).toMatch(/^,,Set 1,/)  // set: two leading commas
  })

  it('counts sessions, not raw lines', () => {
    const S = base({ workouts: [
      workout({ id: 'a', d: D1, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10), liftedSet(60, 9)] }] }),
      workout({ id: 'b', d: D2, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })
    ] })
    expect(sportExportCSV(S, D1, D2).count).toBe(2)
  })

  it('is empty but well-formed when the range holds nothing', () => {
    const { csv, count } = sportExportCSV(base(), D1, D3)
    expect(csv.split('\r\n')).toHaveLength(1)
    expect(count).toBe(0)
  })
})

describe('sportExportSummary', () => {
  it('counts sessions and working sets in range', () => {
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [
      liftedSet(60, 10), liftedSet(60, 9), { w: 20, r: 10, done: true, warm: true }
    ] }] })] })
    expect(sportExportSummary(S, D2, D2)).toMatchObject({ sessions: 1, sets: 2 })
  })
  it('is zero outside the range', () => {
    const S = base({ workouts: [workout({ d: D1, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })] })
    expect(sportExportSummary(S, D2, D3)).toMatchObject({ sessions: 0, sets: 0 })
  })
})
