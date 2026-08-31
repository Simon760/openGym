import { describe, it, expect } from 'vitest'
import { hydrate } from './hydrate.js'
import { setVol } from './history.js'

// What Realtime Database actually hands back. Every one of these was a crash behind the
// error boundary, not a cosmetic loss: the app trusts its own schema and calls .length.
describe('hydrate — a state that came back from Firebase', () => {
  it('restores a routine whose empty exercise list was deleted', () => {
    const S = hydrate({ routines: [{ id: 'r1', name: 'Push' }] })   // ex: [] never stored
    expect(S.routines[0].ex).toEqual([])
    expect(() => S.routines.map(r => r.ex.length)).not.toThrow()
  })

  it('restores every top-level list that was empty when it was written', () => {
    const S = hydrate({ unit: 'kg' })
    for (const k of ['bodyweight', 'routines', 'workouts', 'customEx', 'nutrition', 'sleep', 'health'])
      expect(S[k]).toEqual([])
    for (const k of ['week', 'dayPlan', 'exWeights']) expect(S[k]).toEqual({})
  })

  it('rebuilds a list that came back as an object of numeric keys', () => {
    // RTDB only rebuilds an array when the keys run contiguously from zero.
    const S = hydrate({ bodyweight: { 0: { d: '2025-03-12', w: 92 }, 2: { d: '2025-04-02', w: 90 } } })
    expect(Array.isArray(S.bodyweight)).toBe(true)
    expect(S.bodyweight.map(b => b.w)).toEqual([92, 90])
  })

  it('orders numeric keys as numbers, not as strings', () => {
    const wide = {}
    for (let i = 0; i < 12; i++) wide[i] = { d: '2025-01-' + String(i + 1).padStart(2, '0'), w: 80 + i }
    expect(hydrate({ bodyweight: wide }).bodyweight.map(b => b.w))
      .toEqual([80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91])
  })

  it('restores the entries and sets inside a workout', () => {
    const S = hydrate({ workouts: [{ d: '2025-08-11', name: 'Push' }, { d: '2025-08-12', entries: [{ id: '0314' }] }] })
    expect(S.workouts[0].entries).toEqual([])
    expect(S.workouts[1].entries[0].sets).toEqual([])
  })

  it('restores the extra loads carried on a set', () => {
    // Three levels of array in one path — workouts, entries, sets — and the loads on a set
    // are a fourth. The cloud brings every one of them home keyed "0","1".
    const S = hydrate({ workouts: { 0: { d: '2025-08-11', entries: { 0: {
      id: '0314', sets: { 0: { w: 100, r: 10, done: true, drops: { 0: { w: 60, r: 10 } } } } } } } } })
    expect(S.workouts[0].entries[0].sets[0].drops).toEqual([{ w: 60, r: 10 }])
    expect(setVol(S.workouts[0].entries[0].sets[0])).toBe(1600)
    // a set that never carried one keeps not carrying one, rather than gaining an empty list
    expect(hydrate({ workouts: [{ d: '2025-08-11', entries: [{ id: '0314', sets: [{ w: 50, r: 8 }] }] }] })
      .workouts[0].entries[0].sets[0]).toEqual({ w: 50, r: 8 })
  })

  it('does the same for a workout that was still running', () => {
    expect(hydrate({ active: { id: 'w1', name: 'Push' } }).active.entries).toEqual([])
    expect(hydrate({ active: null }).active).toBe(null)
  })

  it('turns a week that round-tripped as an array back into a lookup', () => {
    const S = hydrate({ routines: [{ id: 'a', ex: [] }, { id: 'b', ex: [] }], week: ['a', 'b'] })
    expect(S.week).toEqual({ 0: 'a', 1: 'b' })
    expect(S.routines.find(r => r.id === S.week[1])).toBeTruthy()
  })

  it('drops a scheduled day pointing at a routine that no longer exists', () => {
    const S = hydrate({ routines: [{ id: 'a', ex: [] }], week: { 1: 'a', 4: 'gone' } })
    expect(S.week).toEqual({ 1: 'a' })
  })

  it('drops the cloud node’s own bookkeeping, which is not part of a state', () => {
    const S = hydrate({ v: 2, json: '{"routines":[]}', unit: 'lb' })
    expect(S.v).toBeUndefined()
    expect(S.json).toBeUndefined()
    expect(S.unit).toBe('lb')
  })

  it('keeps a field it does not recognise', () => {
    // A newer build wrote it. Dropping it here would delete it on the next push.
    expect(hydrate({ somethingNew: 42 }).somethingNew).toBe(42)
  })

  it('survives nonsense instead of taking the screen down with it', () => {
    for (const bad of [null, undefined, 'a string', 7, []]) expect(hydrate(bad).routines).toEqual([])
    expect(hydrate({ routines: ['not an object', null, { id: 'a' }] }).routines).toHaveLength(1)
    expect(hydrate({ routines: [{ id: 'a', ex: [null, 'x', { id: '1' }] }] }).routines[0].ex).toHaveLength(1)
  })
})
