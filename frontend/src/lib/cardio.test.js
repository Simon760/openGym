import { describe, it, expect } from 'vitest'
import { isPaced, isOnce, cardioEffort, setLabel, buildSets, defaultConfig } from './history.js'
import { loadOfWorkouts, loadOfRoutine, loadOfActive, setWorth, CARDIO_MIN_PER_SET } from './muscles.js'
import { EXIDX } from './exercises.js'
import { sessionLoad } from './recovery.js'

const BIKE = 'x002'            // assault bike — a machine with no speed to read
const RUN = '0685'             // a run — one of the four that does have one
const emptyS = { exWeights: {}, workouts: [] }

// "Y'a pas de vitesse de notée. Donc faut retirer, mais comment mesurer l'effort pour
// estimer l'impact musculaire ?" — the removal, and the two things that replace it.
describe('a cardio machine with no speed on it', () => {
  it('is asked for no speed unless the exercise says it shows one', () => {
    expect(isPaced({ id: BIKE })).toBe(false)
    expect(isPaced({ id: RUN })).toBe(false)          // off until you say so, for both
    expect(isPaced({ id: RUN, paced: true })).toBe(true)
    expect(defaultConfig(BIKE)).toEqual({ sets: 1, min: 20 })
  })

  it('stores no speed field at all, rather than a made-up one', () => {
    // 8 km/h on an assault bike is not a small error, it is a meaningless number that then
    // gets printed back as though something had measured it.
    expect(buildSets(emptyS, { id: BIKE, sets: 1, min: 20 })).toEqual([{ min: 20, done: false }])
    expect(setLabel(BIKE, { min: 20, speed: 8 })).toBe('20 min')
  })

  it('rates the effort instead, on the scale that means something on a bike', () => {
    expect(cardioEffort({})).toBe('rpe')                  // reps in reserve says nothing here
    expect(cardioEffort({ effort: 'rir' })).toBe('rir')   // a profile's own choice stands
    expect(cardioEffort({ effort: 'none' })).toBe('none') // and so does an explicit no
    expect(setLabel(BIKE, { min: 20, rpe: 9 })).toBe('20 min (RPE 9)')
  })

  it('feeds that rating straight into the recovery model', () => {
    // recovery already scales every set by how close to failure it was; cardio sets simply
    // had no rating to scale by until now
    const w = r => ({ entries: [{ id: BIKE, sets: [{ min: 20, done: true, ...(r ? { rpe: r } : {}) }] }] })
    const hard = sessionLoad(w(9)).intensity
    const easy = sessionLoad(w(5)).intensity
    expect(hard).toBeGreaterThan(easy)
  })
})

// "Mais log pas en série. C'est un jeu donc c'est one time."
describe('an activity that happens once rather than in sets', () => {
  const PADEL = 'x003'

  it('is one block however many sets the config asks for', () => {
    expect(isOnce({ id: PADEL })).toBe(true)
    expect(buildSets(emptyS, { id: PADEL, sets: 4, min: 60 })).toEqual([{ min: 60, done: false }])
    expect(buildSets(emptyS, { id: PADEL, min: 60 })).toHaveLength(1)
  })

  it('leaves the bike its intervals, which are real', () => {
    // five threes with a rest between them is five sets and reads as five
    expect(isOnce({ id: BIKE })).toBe(false)
    expect(buildSets(emptyS, { id: BIKE, sets: 5, min: 3 })).toHaveLength(5)
  })

  it('can be overridden per config, like every other flag here', () => {
    expect(isOnce({ id: PADEL, once: false })).toBe(false)
    expect(isOnce({ id: BIKE, once: true })).toBe(true)
    expect(buildSets(emptyS, { id: BIKE, once: true, sets: 5, min: 3 })).toHaveLength(1)
  })

  it('still weighs its minutes on the map, one block or not', () => {
    const load = loadOfWorkouts([{ entries: [{ id: PADEL, sets: [{ min: 60, done: true }] }] }])
    expect(load.quadriceps).toBeCloseTo(0.4 * 60 / CARDIO_MIN_PER_SET, 5)
  })
})

describe('what twenty minutes on the bike is worth on the body map', () => {
  const w = min => ({ entries: [{ id: BIKE, sets: [{ min, done: true }] }] })

  it('counts its minutes, not its sets', () => {
    // It used to count as one set flat, so twenty minutes on the bike weighed exactly what
    // thirty seconds of jump rope weighed — the map said "one set of legs" for both.
    expect(setWorth(BIKE, { min: 20 })).toBe(20 / CARDIO_MIN_PER_SET)
    expect(setWorth(BIKE, { min: 0.5 })).toBeLessThan(0.2)
    const long = loadOfWorkouts([w(20)])
    const short = loadOfWorkouts([w(2)])
    expect(long.quadriceps).toBeCloseTo(short.quadriceps * 10, 5)
  })

  it('leaves a lifting set worth exactly one, as it always was', () => {
    const bench = '0289'
    expect(setWorth(bench, { w: 60, r: 10 })).toBe(1)
    const one = loadOfWorkouts([{ entries: [{ id: bench, sets: [{ w: 60, r: 10, done: true }] }] }])
    const three = loadOfWorkouts([{ entries: [{ id: bench, sets: [
      { w: 60, r: 10, done: true }, { w: 60, r: 10, done: true }, { w: 60, r: 10, done: true }] }] }])
    expect(three.chest).toBeCloseTo(one.chest * 3, 5)
  })

  it('plans and previews on the same scale it scores on', () => {
    const planned = loadOfRoutine({ ex: [{ id: BIKE, sets: 1, min: 20 }] })
    expect(planned.quadriceps).toBeCloseTo(loadOfWorkouts([w(20)]).quadriceps, 5)
    const live = loadOfActive({ entries: [{ id: BIKE, sets: [{ min: 20, done: true }] }] })
    expect(live.quadriceps).toBeCloseTo(planned.quadriceps, 5)
  })

  it('ignores a set that was never ticked off', () => {
    expect(loadOfWorkouts([{ entries: [{ id: BIKE, sets: [{ min: 40 }] }] }])).toEqual({})
  })
})
