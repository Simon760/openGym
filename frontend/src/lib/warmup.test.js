import { describe, it, expect } from 'vitest'
import { isWorking, isWarm, workoutVolume, setsDone, setsDoneActive, lastEntryFor, bestWeightFor,
  segsOf, setVol, setTop, setTopReps, setReps, hasDrops, setLabel } from './history.js'
import { loadOfWorkouts } from './muscles.js'
import { EXDB } from './exercises.js'

const id = EXDB[0].id
const W = sets => ({ id: 'w1', d: '2026-01-10', name: 'Push', entries: [{ id, target: { id, sets: 3, reps: 8 }, sets }] })

// A warm-up: bar only, five reps, ticked off. Then the working sets.
const sets = [
  { w: 20, r: 5, done: true, warm: true },
  { w: 60, r: 8, done: true },
  { w: 60, r: 8, done: true },
  { w: 60, r: 6, done: false }
]

describe('a warm-up is done, and counted in nothing', () => {
  it('tells the three states apart', () => {
    expect(isWorking(sets[0])).toBe(false)   // done, but a warm-up
    expect(isWarm(sets[0])).toBe(true)
    expect(isWorking(sets[1])).toBe(true)
    expect(isWorking(sets[3])).toBe(false)   // not done
    expect(isWorking(null)).toBe(false)
  })

  it('stays out of the volume', () => {
    expect(workoutVolume(W(sets))).toBe(60 * 8 * 2)          // and not + 20 x 5
  })

  it('stays out of the set count', () => {
    expect(setsDone(W(sets))).toBe(2)
    // …but counts during the session, where a set you ticked must not read as still to do
    expect(setsDoneActive({ entries: W(sets).entries })).toBe(3)
  })

  it('stays out of the muscle load', () => {
    const withWarm = loadOfWorkouts([W(sets)])
    const without = loadOfWorkouts([W(sets.filter(s => !s.warm))])
    expect(withWarm).toEqual(without)
  })
})

describe('the failure a warm-up would otherwise cause', () => {
  // The one that matters. A bar-only warm-up read as "last time" walks the programme
  // backwards every week, silently, faster than any crash.
  const S = { workouts: [W(sets)] }

  it('is never what the progression engine reads as last time', () => {
    const last = lastEntryFor(S, id)
    expect(last.sets).toHaveLength(2)
    expect(last.sets.every(s => s.w === 60)).toBe(true)
    expect(last.sets.some(s => s.warm)).toBe(false)
  })

  it('is never a record', () => {
    // A heavy single done as a warm-up is still not a PR: it was not the working set.
    const heavy = { workouts: [W([{ w: 140, r: 1, done: true, warm: true }, { w: 60, r: 8, done: true }])] }
    expect(bestWeightFor(heavy, id)).toBe(60)
  })
})

describe('a session typed up afterwards', () => {
  it('carries its own day and no duration', () => {
    // start/end are absent rather than filled with how long the typing took: a wrong number
    // is worse than a missing one, and the summary reads `end - start`.
    const logged = { id: 'w2', d: '2026-01-05', name: 'Pull', entries: [{ id, sets: [{ w: 50, r: 10, done: true }] }] }
    expect(logged.start).toBeUndefined()
    expect(logged.end).toBeUndefined()
    expect(workoutVolume(logged)).toBe(500)
    expect(setsDone(logged)).toBe(1)
  })
})

describe('a set carrying more than one load', () => {
  // "Ten at 10, then ten at 5 without putting it down" is one set, not two. Logged as two it
  // says something false about the rest between them, the number of sets, and — descending —
  // a working set at 5 kg that never happened.
  const drop = { w: 100, r: 10, done: true, drops: [{ w: 60, r: 10 }] }
  const pyramid = { w: 60, r: 10, done: true, drops: [{ w: 80, r: 8 }, { w: 100, r: 5 }] }

  it('reads the pieces in order', () => {
    expect(segsOf(drop)).toEqual([{ w: 100, r: 10 }, { w: 60, r: 10 }])
    expect(segsOf({ w: 50, r: 8 })).toEqual([{ w: 50, r: 8 }])
    expect(segsOf(null)).toEqual([{ w: 0, r: 0 }])
    expect(hasDrops(drop)).toBe(true)
    expect(hasDrops({ w: 50, r: 8 })).toBe(false)
  })

  it('adds every piece to the volume', () => {
    expect(setVol(drop)).toBe(100 * 10 + 60 * 10)
    expect(setVol(pyramid)).toBe(60 * 10 + 80 * 8 + 100 * 5)
    expect(setReps(drop)).toBe(20)
  })

  it('counts as one set, not as two', () => {
    expect(setsDone(W([drop]))).toBe(1)
    expect(workoutVolume(W([drop]))).toBe(1600)
  })

  it('takes the heaviest piece as the record, whichever end it sits at', () => {
    expect(setTop(drop)).toBe(100)        // descending: the first
    expect(setTop(pyramid)).toBe(100)     // ascending: the last
    expect(bestWeightFor({ workouts: [W([pyramid])] }, id)).toBe(100)
    expect(bestWeightFor({ workouts: [W([drop])] }, id)).toBe(100)
  })

  it('never makes a record of a warm-up, however it is built', () => {
    const warmPyramid = { ...pyramid, warm: true }
    expect(bestWeightFor({ workouts: [W([warmPyramid, { w: 50, r: 8, done: true }])] }, id)).toBe(50)
    expect(workoutVolume(W([warmPyramid, { w: 50, r: 8, done: true }]))).toBe(400)
  })

  it('pairs the top load with the reps actually done at it', () => {
    expect(setTopReps(drop)).toBe(10)      // 100×10 came first
    expect(setTopReps(pyramid)).toBe(5)    // the 100 was a five, not the opening ten
    expect(setTopReps({ w: 50, r: 8 })).toBe(8)
  })

  it('shows every piece in the label rather than only the first', () => {
    const bar = { bodyweight: false }
    expect(setLabel(id, drop, bar)).toBe('100\u00d710\u219260\u00d710')
    expect(setLabel(id, pyramid, bar)).toBe('60\u00d710\u219280\u00d78\u2192100\u00d75')
    expect(setLabel(id, { w: 60, r: 10 }, bar)).toBe('60\u00d710')
    // the effort is the set's, so it is printed once at the end and not per piece
    expect(setLabel(id, { ...drop, rir: 1 }, bar)).toBe('100\u00d710\u219260\u00d710 (RIR 1)')
    // a belt dropped mid-set: the plus belongs to each load, so it cannot also be the joiner
    expect(setLabel(id, { w: 10, r: 8, drops: [{ w: 0, r: 5 }] }, { bodyweight: true })).toBe('+10 \u00d7 8\u21925')
  })
})
