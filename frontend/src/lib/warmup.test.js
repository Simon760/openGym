import { describe, it, expect } from 'vitest'
import { isWorking, isWarm, workoutVolume, setsDone, setsDoneActive, lastEntryFor, bestWeightFor } from './history.js'
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
