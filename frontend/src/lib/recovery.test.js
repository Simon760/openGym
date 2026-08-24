import { describe, it, expect } from 'vitest'
import {
  sessionLoad, fatigueFrom, tauFor, conditionsSince, recoveryNow, bandOf,
  RIR_WEIGHT, UNRATED_WEIGHT, RECOVERED_AT
} from './recovery.js'
import { isoOf } from './format.js'

const hoursAgo = h => Date.now() - h * 3600000
const iso = h => isoOf(new Date(hoursAgo(h)))

// A bench session: `sets` sets at the given RIR. Bench targets the chest, so that is the
// muscle the assertions follow.
const bench = (h, { n = 4, rir = 2, id = '0025' } = {}) => ({
  id: 'w' + h, d: iso(h), start: hoursAgo(h), name: 'Push',
  entries: [{ id, target: { sets: n, reps: 8 }, sets: Array.from({ length: n }, () => ({ w: 75, r: 8, done: true, ...(rir == null ? {} : { rir }) })) }]
})
const S = (workouts = [], over = {}) => ({ workouts, sleep: [], nutrition: [], ...over })

describe('sessionLoad', () => {
  it('counts a set once for the muscle it targets, scaled by how close to failure it was', () => {
    const failure = sessionLoad(bench(1, { n: 4, rir: 0 }))
    const easy = sessionLoad(bench(1, { n: 4, rir: 4 }))
    expect(failure.load.chest).toBeGreaterThan(easy.load.chest)
    expect(failure.intensity).toBe(RIR_WEIGHT[0])
    expect(easy.intensity).toBe(RIR_WEIGHT[4])
    expect(failure.sets).toBe(4)
  })

  it('treats an unrated set as a normal working set', () => {
    expect(sessionLoad(bench(1, { rir: null })).intensity).toBe(UNRATED_WEIGHT)
  })

  it('counts assisting muscles too, at less than the target', () => {
    const { load } = sessionLoad(bench(1))
    expect(load.chest).toBeGreaterThan(0)
    expect(load.triceps ?? 0).toBeLessThan(load.chest)
  })

  it('ignores sets that were never checked off', () => {
    const w = bench(1)
    w.entries[0].sets.forEach(s => { s.done = false })
    expect(sessionLoad(w).sets).toBe(0)
  })
})

describe('fatigueFrom', () => {
  it('saturates — the tenth set does not add what the first did', () => {
    const first = fatigueFrom(1) - fatigueFrom(0)
    const tenth = fatigueFrom(10) - fatigueFrom(9)
    expect(tenth).toBeLessThan(first / 3)
    expect(fatigueFrom(30)).toBeLessThan(1)
    expect(fatigueFrom(0)).toBe(0)
  })
})

describe('tauFor', () => {
  it('puts full recovery near the times the literature reports', () => {
    // "recovered" at 3 tau: comfortable sets back inside ~48 h, sets to failure nearer 72 h
    expect(tauFor(RIR_WEIGHT[4]) * 3).toBeLessThan(48)
    expect(tauFor(RIR_WEIGHT[0]) * 3).toBeGreaterThan(60)
    expect(tauFor(RIR_WEIGHT[0]) * 3).toBeLessThanOrEqual(75)
  })

  it('stretches when sleep is short or food is scarce, and never runs away', () => {
    const base = tauFor(0.7)
    expect(tauFor(0.7, { sleepFactor: 1.2 })).toBeGreaterThan(base)
    expect(tauFor(0.7, { energyFactor: 1.16 })).toBeGreaterThan(base)
    // both at once are capped rather than multiplied without limit
    expect(tauFor(0.7, { sleepFactor: 2, energyFactor: 2 })).toBeCloseTo(base * 1.6, 5)
  })
})

describe('conditionsSince', () => {
  // Pinned rather than relative to the clock: which calendar day "30 hours ago" lands on
  // depends on the time of day the suite happens to run, and today is treated differently
  // from yesterday here.
  const NOW = new Date('2026-08-24T20:00:00').getTime()
  const day = n => isoOf(new Date(NOW - n * 86400000))
  const since = (st, n) => conditionsSince(st, NOW - n * 86400000, NOW)

  it('reads a short night as slower recovery, on the scale the evidence gives', () => {
    // ~20 % less muscle protein synthesis on 5 h nights -> around a fifth slower
    const st = S([], { sleep: [{ d: day(1), h: 5 }, { d: day(0), h: 5 }] })
    const c = since(st, 2)
    expect(c.sleepFactor).toBeGreaterThan(1.15)
    expect(c.sleepFactor).toBeLessThan(1.3)
  })

  it('reads eating at target as no penalty at all', () => {
    const st = S([], { nutriGoal: { kcal: 2500 }, nutrition: [{ d: day(1), kcal: 2500 }] })
    expect(since(st, 2).energyFactor).toBe(1)
  })

  it('reads a 20 % deficit as roughly a sixth slower', () => {
    const st = S([], { nutriGoal: { kcal: 2500 }, nutrition: [{ d: day(1), kcal: 2000 }] })
    expect(since(st, 2).energyFactor).toBeCloseTo(1.16, 2)
  })

  it('leaves today out of the energy average, because the day is not over', () => {
    // a half-filled log for today is not a deficit; counting it reported a profile eating 4 %
    // under target as 28 % under, every afternoon
    const st = S([], {
      nutriGoal: { kcal: 2500 },
      nutrition: [{ d: day(1), kcal: 2400 }, { d: day(0), kcal: 900 }]
    })
    expect(since(st, 2).energyFactor).toBeCloseTo(1 + 0.8 * (100 / 2500), 2)
  })

  it('keeps today for sleep, because last night is finished', () => {
    const st = S([], { sleep: [{ d: day(0), h: 5 }] })
    expect(since(st, 2).sleepFactor).toBeGreaterThan(1.1)
  })

  it('treats an unlogged day as no evidence, not as a bad day', () => {
    const c = since(S(), 2)
    expect(c.sleepFactor).toBe(1)
    expect(c.energyFactor).toBe(1)
    expect(c.known).toBe(false)
  })
})

describe('recoveryNow', () => {
  it('reads a muscle as freshly trained right after the session', () => {
    const r = recoveryNow(S([bench(1, { n: 5, rir: 0 })]))
    expect(r.muscles.chest.pct).toBeLessThan(50)
    expect(r.muscles.chest.hoursLeft).toBeGreaterThan(24)
  })

  it('reads it as recovered once enough time has passed', () => {
    const r = recoveryNow(S([bench(96, { n: 4, rir: 2 })]))
    // four days after a normal session there should be nothing left worth drawing
    expect(r.muscles.chest === undefined || r.muscles.chest.pct >= 95).toBe(true)
  })

  it('recovers a session taken to failure more slowly than a comfortable one', () => {
    const hard = recoveryNow(S([bench(36, { n: 4, rir: 0 })])).muscles.chest
    const easy = recoveryNow(S([bench(36, { n: 4, rir: 4 })])).muscles.chest
    expect(hard.pct).toBeLessThan(easy.pct)
  })

  it('recovers more slowly after more sets', () => {
    const many = recoveryNow(S([bench(24, { n: 10, rir: 2 })])).muscles.chest
    const few = recoveryNow(S([bench(24, { n: 2, rir: 2 })])).muscles.chest
    expect(many.pct).toBeLessThan(few.pct)
  })

  it('stacks two sessions rather than letting the newer one hide the older', () => {
    const one = recoveryNow(S([bench(24, { n: 4 })])).muscles.chest
    const two = recoveryNow(S([bench(48, { n: 4 }), bench(24, { n: 4 })])).muscles.chest
    expect(two.pct).toBeLessThan(one.pct)
  })

  it('slows recovery when the days since were short on sleep and food', () => {
    const w = bench(24, { n: 5, rir: 1 })
    const rested = recoveryNow(S([w], {
      sleep: [{ d: iso(24), h: 8 }, { d: iso(2), h: 8 }],
      nutriGoal: { kcal: 2500 }, nutrition: [{ d: iso(30), kcal: 2500 }]
    })).muscles.chest
    const wrecked = recoveryNow(S([w], {
      sleep: [{ d: iso(24), h: 5 }, { d: iso(2), h: 5 }],
      nutriGoal: { kcal: 2500 }, nutrition: [{ d: iso(30), kcal: 1700 }]
    })).muscles.chest
    expect(wrecked.pct).toBeLessThan(rested.pct)
    expect(wrecked.hoursLeft).toBeGreaterThan(rested.hoursLeft)
  })

  it('leaves out muscles nothing trained, rather than parading them at 100 %', () => {
    const r = recoveryNow(S([bench(6)]))
    expect(r.muscles.quadriceps).toBeUndefined()
    expect(r.muscles.chest).toBeDefined()
  })

  it('reports what the estimate leaned on', () => {
    const r = recoveryNow(S([bench(6, { n: 4, rir: 2 })], { sleep: [{ d: iso(6), h: 7 }] }))
    expect(r.basis.sessions).toBe(1)
    expect(r.basis.ratedSets).toBe(4)
    expect(r.basis.totalSets).toBe(4)
    expect(r.basis.known).toBe(true)
  })

  it('says nothing rather than guessing when there is no training at all', () => {
    const r = recoveryNow(S())
    expect(r.muscles).toEqual({})
    expect(r.basis.sessions).toBe(0)
  })

  it('ignores sessions older than the window', () => {
    expect(recoveryNow(S([bench(24 * 30)])).basis.sessions).toBe(0)
  })
})

describe('bandOf', () => {
  it('bands rather than pretending to single-percent precision', () => {
    expect(bandOf(100)).toBe('ready')
    expect(bandOf(95)).toBe('ready')
    expect(bandOf(80)).toBe('nearly')
    expect(bandOf(50)).toBe('working')
    expect(bandOf(20)).toBe('fresh-off')
  })
})

describe('the constants match what was researched', () => {
  it('weights proximity to failure with the cliff between RIR 3 and RIR 1', () => {
    expect(RIR_WEIGHT[0] - RIR_WEIGHT[1]).toBeCloseTo(0.15, 2)
    expect(RIR_WEIGHT[1] - RIR_WEIGHT[3]).toBeCloseTo(0.3, 2)
    expect(RIR_WEIGHT[3] - RIR_WEIGHT[4]).toBeCloseTo(0.15, 2)
  })

  it('calls a muscle recovered at 95 %', () => {
    expect(RECOVERED_AT).toBe(0.05)
  })
})
