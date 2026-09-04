import { describe, it, expect } from 'vitest'
import { swapEntry, setBodyweight, warmEntry, isWorking, isBw, workoutVolume, setsDone, exEntryOf } from './history.js'
import { EXDB } from './exercises.js'

const BAR = EXDB.find(e => e.eq === 'barbell' && e.bp === 'chest').id
const OTHER = EXDB.find(e => e.eq === 'dumbbell' && e.bp === 'chest').id
const BODY = EXDB.find(e => e.eq === 'body weight' && e.bp === 'chest').id
const S = { unit: 'kg', exWeights: {}, workouts: [] }
const entry = (id, sets) => ({ id, target: { id, sets: sets.length, reps: 10, weight: 60 }, sets })

// "Si j'ai pas la machine ou que je veux faire autre chose" — the swap happens mid-session,
// so the question that decides everything is what becomes of sets already logged.
describe('trading one exercise for another mid-session', () => {
  it('replaces it outright when nothing has been logged yet', () => {
    const es = [entry(BAR, [{ w: 60, r: 10 }, { w: 60, r: 10 }, { w: 60, r: 10 }]), entry(OTHER, [{ w: 20, r: 12 }])]
    const r = swapEntry(S, es, 0, BODY)
    expect(r.entries).toHaveLength(2)          // no leftover stub
    expect(r.entries[0].id).toBe(BODY)
    expect(r.entries[0].sets).toHaveLength(3)  // the sets it still owes
    expect(r.cur).toBe(0)                      // you are standing at the same slot
    expect(r.entries[1].id).toBe(OTHER)        // the rest of the session is untouched
  })

  it('never rewrites the sets the old movement actually did', () => {
    // two of four done, then the machine goes. Those two were a bench press and stay one.
    const es = [entry(BAR, [
      { w: 60, r: 10, done: true }, { w: 60, r: 10, done: true }, { w: 60, r: 10 }, { w: 60, r: 10 }])]
    const r = swapEntry(S, es, 0, OTHER)
    expect(r.entries).toHaveLength(2)
    expect(r.entries[0].id).toBe(BAR)
    expect(r.entries[0].sets).toHaveLength(2)          // only what it finished
    expect(r.entries[0].sets.every(isWorking)).toBe(true)
    expect(r.entries[1].id).toBe(OTHER)
    expect(r.entries[1].sets).toHaveLength(2)          // the two still owed
    expect(r.cur).toBe(1)                              // and that is where you now are
    // the volume of the abandoned half survives intact
    expect(workoutVolume({ entries: r.entries })).toBe(1200)
    expect(setsDone({ entries: r.entries })).toBe(2)
  })

  it('always leaves at least one set to do', () => {
    const es = [entry(BAR, [{ w: 60, r: 10, done: true }])]
    expect(swapEntry(S, es, 0, OTHER).entries[1].sets.length).toBeGreaterThanOrEqual(1)
  })

  it('swaps a warm-up for a warm-up, flag and all', () => {
    const es = [warmEntry(S, { id: BAR, sets: 2, reps: 12, weight: 20 })]
    const r = swapEntry(S, es, 0, BODY)
    expect(r.entries[0].warm).toBe(true)
    expect(r.entries[0].sets.every(s => s.warm)).toBe(true)
    expect(r.entries[0].sets.some(isWorking)).toBe(false)
  })

  it('does nothing when there is nothing to swap', () => {
    const es = [entry(BAR, [{ w: 60, r: 10 }])]
    expect(swapEntry(S, es, 9, OTHER).entries).toBe(es)
    expect(swapEntry(S, es, 0, null).entries).toBe(es)
    expect(swapEntry(S, null, 0, OTHER).entries).toEqual([])
  })
})

// "rajoute l'option poids du corps direct pendant l'exo"
describe('calling it bodyweight in the middle of the exercise', () => {
  it('just drops the load when nothing has been logged with one', () => {
    const es = [entry(BAR, [{ w: 60, r: 10 }, { w: 60, r: 10 }, { w: 60, r: 10 }])]
    const r = setBodyweight(es, 0, true)
    expect(r.entries).toHaveLength(1)                  // no split, nothing to protect
    expect(isBw({ ...r.entries[0].target, id: r.entries[0].id })).toBe(true)
    expect(r.entries[0].sets.map(s => s.w)).toEqual([0, 0, 0])
    expect(r.cur).toBe(0)
  })

  it('splits rather than rewrite two sets that were done with a belt on', () => {
    // +10 kg for two, then the belt comes off. One entry cannot show a weight column for
    // half its rows, and pretending the first two were bodyweight would be a lie.
    const es = [entry(BAR, [
      { w: 10, r: 8, done: true }, { w: 10, r: 8, done: true }, { w: 10, r: 8 }, { w: 10, r: 8 }])]
    const r = setBodyweight(es, 0, true)
    expect(r.entries).toHaveLength(2)
    expect(isBw({ ...r.entries[0].target, id: r.entries[0].id })).toBe(false)
    expect(r.entries[0].sets).toEqual([{ w: 10, r: 8, done: true }, { w: 10, r: 8, done: true }])
    expect(isBw({ ...r.entries[1].target, id: r.entries[1].id })).toBe(true)
    expect(r.entries[1].sets).toHaveLength(2)
    expect(r.entries[1].sets.every(s => s.w === 0 && !s.done)).toBe(true)
    expect(r.entries[1].sets.every(s => s.r === 8)).toBe(true)   // the reps you were doing
    expect(r.cur).toBe(1)
    // and the two halves read back as one exercise, with the belt work still counted
    expect(exEntryOf({ entries: r.entries }, BAR).sets).toHaveLength(4)
    expect(workoutVolume({ entries: r.entries })).toBe(160)
  })

  it('turns back off without inventing a weight to put back', () => {
    const es = [entry(BAR, [{ w: 60, r: 10 }, { w: 60, r: 10 }])]
    const off = setBodyweight(setBodyweight(es, 0, true).entries, 0, false)
    expect(isBw({ ...off.entries[0].target, id: off.entries[0].id })).toBe(false)
    expect(off.entries[0].sets.map(s => s.w)).toEqual([0, 0])   // you type what you are lifting
  })

  it('leaves every other exercise alone', () => {
    const es = [entry(BAR, [{ w: 60, r: 10 }]), entry(OTHER, [{ w: 20, r: 12 }])]
    const r = setBodyweight(es, 0, true)
    expect(r.entries[1]).toBe(es[1])
    expect(r.entries[1].sets[0].w).toBe(20)
  })
})
