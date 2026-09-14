import { describe, it, expect } from 'vitest'
import { currentProgrammeStart, earliestLoggedDay, sportExportRows, sportExportCSV, sportExportSummary } from './sport-export.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const BW = EXDB.find(e => e.eq === 'body weight' && e.bp !== 'cardio').id
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

describe('sportExportRows', () => {
  it('keeps only what falls inside the range, inclusive of both ends', () => {
    const S = base({ workouts: [
      workout({ id: 'a', d: D1, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] }),
      workout({ id: 'b', d: D2, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] }),
      workout({ id: 'c', d: D3, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })
    ] })
    expect(sportExportRows(S, D1, D2).map(r => r[0])).toEqual([D1, D2])
    expect(sportExportRows(S, D2, D2).map(r => r[0])).toEqual([D2])
  })

  it('drops warm-up sets and unchecked sets, keeps done working sets', () => {
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [
      { w: 20, r: 10, done: true, warm: true },
      { w: 60, r: 10, done: false },
      liftedSet(60, 10)
    ] }] })] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows).toHaveLength(1)
    expect(rows[0][5]).toBe(60)
  })

  it('reads reps and weight off a straight lifting set', () => {
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [liftedSet(82.5, 8)] }] })] })
    const [row] = sportExportRows(S, D2, D2)
    expect(row[4]).toBe(8)      // Répétitions
    expect(row[5]).toBe(82.5)   // Poids (kg)
    expect(row[6]).toBe('82.5×8')
  })

  it('leaves weight blank on a bodyweight set carrying nothing added, rather than writing 0', () => {
    const S = base({ workouts: [workout({ entries: [{ id: BW, target: {}, sets: [liftedSet(0, 15)] }] })] })
    const [row] = sportExportRows(S, D2, D2)
    expect(row[4]).toBe(15)
    expect(row[5]).toBe('')
  })

  it('still shows the added weight on a bodyweight set that carries one', () => {
    const S = base({ workouts: [workout({ entries: [{ id: BW, target: { bodyweight: true }, sets: [liftedSet(10, 8)] }] })] })
    const [row] = sportExportRows(S, D2, D2)
    expect(row[5]).toBe(10)
  })

  it('leaves reps and weight blank on a cardio set — the real figures live in Détail', () => {
    const S = base({ workouts: [workout({ entries: [{ id: CARDIO, target: { mode: 'cardio' },
      sets: [{ min: 20, done: true }] }] })] })
    const [row] = sportExportRows(S, D2, D2)
    expect(row[4]).toBe('')
    expect(row[5]).toBe('')
    expect(row[6]).toContain('20 min')
  })

  it('takes a drop set’s heaviest load for Reps/Poids, and keeps the whole chain in Détail', () => {
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [
      { w: 60, r: 10, done: true, drops: [{ w: 45, r: 8 }] }
    ] }] })] })
    const [row] = sportExportRows(S, D2, D2)
    expect(row[4]).toBe(10)
    expect(row[5]).toBe(60)
    expect(row[6]).toBe('60×10→45×8')
  })

  it('repeats the session’s own figures on every one of its rows', () => {
    const S = base({ workouts: [workout({
      watch: { kcal: 430 }, bw: 79.2, vol: 1800,
      entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10), liftedSet(60, 9)] }]
    }) ] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows).toHaveLength(2)
    rows.forEach(r => { expect(r[8]).toBe(430); expect(r[9]).toBe(1800); expect(r[10]).toBe(79.2) })
  })

  it('keeps a session that has watch figures but nothing ticked off, as one row', () => {
    const S = base({ workouts: [workout({ watch: { kcal: 300 },
      entries: [{ id: LIFT, target: {}, sets: [{ w: 60, r: 10, done: false }] }] })] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows).toHaveLength(1)
    expect(rows[0][8]).toBe(300)
    expect(rows[0][2]).toBe('') // no exercise actually performed
  })

  it('keeps a live session’s own clock even with nothing ticked off — it still ran that long', () => {
    // workout() gives every fixture a 50-minute start/end by default: a session that really
    // ran is real information regardless of whether a set got checked off inside it.
    const S = base({ workouts: [workout({ entries: [{ id: LIFT, target: {}, sets: [{ w: 60, r: 10, done: false }] }] })] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows).toHaveLength(1)
    expect(rows[0][7]).toBe(50)
    expect(rows[0][8]).toBe('')
  })

  it('drops a session with no clock, no watch figures and nothing done — truly empty', () => {
    const S = base({ workouts: [workout({ start: undefined, end: undefined,
      entries: [{ id: LIFT, target: {}, sets: [{ w: 60, r: 10, done: false }] }] })] })
    expect(sportExportRows(S, D2, D2)).toHaveLength(0)
  })

  it('surfaces a day the watch measured training on with nothing logged here for it', () => {
    const S = base({ health: [{ d: D2, sport: 300, sportMin: 40 }] })
    const rows = sportExportRows(S, D2, D2)
    expect(rows).toHaveLength(1)
    expect(rows[0][7]).toBe(40)
    expect(rows[0][8]).toBe(300)
  })

  it('does not duplicate that figure when a session already carries it', () => {
    const S = base({
      workouts: [workout({ watch: { kcal: 300 }, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })],
      health: [{ d: D2, sport: 300 }]
    })
    expect(sportExportRows(S, D2, D2)).toHaveLength(1)
  })

  it('sorts chronologically', () => {
    const S = base({ workouts: [
      workout({ id: 'a', d: D3, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] }),
      workout({ id: 'b', d: D1, entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })
    ] })
    expect(sportExportRows(S, D1, D3).map(r => r[0])).toEqual([D1, D3])
  })
})

describe('sportExportCSV', () => {
  it('starts with the header and quotes a cell that needs it', () => {
    const S = base({ workouts: [workout({ name: 'Push, heavy', entries: [{ id: LIFT, target: {}, sets: [liftedSet(60, 10)] }] })] })
    const { csv, count } = sportExportCSV(S, D2, D2)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Date,Séance,Exercice,Série,Répétitions,Poids (kg),Détail,Durée séance (min),Énergie séance (kcal),Volume séance (kg),Poids du jour (kg)')
    expect(lines[1]).toContain('"Push, heavy"')
    expect(count).toBe(1)
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
