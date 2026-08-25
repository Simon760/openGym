import { describe, it, expect } from 'vitest'
import { dailyDigest, trainingDigest, MAX_SESSIONS } from './digest.js'
import { isoOf } from './format.js'

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const iso = n => isoOf(daysAgo(n))

// A finished session on the bench press: four sets of the given reps at the given weight,
// against a 4x8 target — the shape the progression engine reads back.
const session = (n, { reps = [8, 8, 8, 8], w = 75, name = 'Push Day', prs = [] } = {}) => {
  const d = daysAgo(n)
  return {
    id: 'w' + n, d: iso(n), start: +d, end: +d + 45 * 60000, name, prs,
    entries: [{
      id: '0025',
      target: { id: '0025', sets: 4, reps: 8, weight: w, mode: 'reps' },
      sets: reps.map(r => ({ w, r, done: true }))
    }]
  }
}

const base = (over = {}) => ({
  unit: 'kg', workouts: [], bodyweight: [], nutrition: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, customEx: [], ...over
})

describe('dailyDigest', () => {
  it('leads with the weight, its move and the distance left to the goal', () => {
    const S = base({
      targetW: 77,
      bodyweight: [{ d: iso(3), w: 79.4 }, { d: iso(0), w: 78.4 }]
    })
    const out = dailyDigest(S, iso(0))
    expect(out).toContain('78.4 kg')
    expect(out).toContain('-1')      // moved down a kilo since the previous weigh-in
    expect(out).toContain('77')      // the goal
  })

  it('reports intake with its macros and the gap to target', () => {
    const S = base({
      nutriGoal: { kcal: 2200 },
      nutrition: [{ d: iso(0), kcal: 2244, p: 159, c: 175, f: 79 }]
    })
    const out = dailyDigest(S, iso(0))
    expect(out).toContain('2,244 kcal')
    expect(out).toContain('159')
    expect(out).toContain('+44')     // over target, stated as such
  })

  it('says nothing was logged rather than reporting a zero', () => {
    // an unlogged day is a gap; printing "0 kcal" would coach a fast that never happened
    const out = dailyDigest(base(), iso(0))
    expect(out).not.toContain('0 kcal')
  })

  it('separates a rest day from a session that was planned and missed', () => {
    const r = { id: 'r1', name: 'Push Day', ex: [] }
    const wd = daysAgo(0).getDay()
    const planned = dailyDigest(base({ routines: [r], week: { [wd]: 'r1' } }), iso(0))
    expect(planned).toContain('Push Day')
    const rest = dailyDigest(base(), iso(0))
    expect(rest).not.toContain('Push Day')
  })

  it('prints the session it did log, with its sets', () => {
    const out = dailyDigest(base({ workouts: [session(0)] }), iso(0))
    expect(out).toContain('Push Day')
    expect(out).toContain('75')
  })

  it('carries the denominator with the weekly intake average', () => {
    // three logged days inside the week — the mean must not read as a seven-day figure
    const S = base({ nutrition: [1, 2, 3].map(n => ({ d: iso(n), kcal: 2100 })) })
    expect(dailyDigest(S, iso(0))).toMatch(/3/)
  })
})

describe('dailyDigest — the energy balance', () => {
  it('spells the balance out rather than handing over a total', () => {
    // the conversation reading this has to see which of the three numbers moved
    const S = base({
      tdee: 2100,
      nutrition: [{ d: iso(0), kcal: 1900 }],
      health: [{ d: iso(0), kcal: 620 }]
    })
    const out = dailyDigest(S, iso(0))
    expect(out).toContain('2,100 + 620')
    expect(out).toContain('1,900')
    expect(out).toContain('+820')
  })

  it('says nothing about a balance it cannot compute', () => {
    const noTdee = dailyDigest(base({ nutrition: [{ d: iso(0), kcal: 1900 }] }), iso(0))
    expect(noTdee).not.toContain('Balance')
    // and an unlogged day is not a break-even day
    expect(dailyDigest(base({ tdee: 2100 }), iso(0))).not.toContain('Balance')
  })

  it('carries the running total, so the conversation does not have to keep it', () => {
    const S = base({
      tdee: 2000,
      nutrition: [{ d: iso(9), kcal: 1500 }, { d: iso(5), kcal: 1500 }, { d: iso(0), kcal: 1500 }],
      health: [{ d: iso(5), kcal: 400 }]
    })
    const out = dailyDigest(S, iso(0))
    expect(out).toContain('1,900 kcal')      // 3 x 500 eating + 400 training
    expect(out).toContain('3 logged days of 10')
  })
})

describe('trainingDigest', () => {
  const R = { id: 'r1', name: 'Push Day', ex: [{ id: '0025', sets: 4, reps: 8, weight: 75, prog: 'linear', mode: 'reps' }] }
  const S = (...workouts) => base({ routines: [R], week: { 1: 'r1' }, workouts })

  it('marks a session that hit its target and one that did not', () => {
    const hit = trainingDigest(S(session(2)), 7)
    expect(hit).toContain('✓')
    const miss = trainingDigest(S(session(2, { reps: [8, 8, 6, 5] })), 7)
    expect(miss).toContain('✗')
  })

  it('prints what each set actually was, next to what was asked', () => {
    const out = trainingDigest(S(session(2, { reps: [8, 8, 7, 8] })), 7)
    expect(out).toContain('4×8')     // the target
    expect(out).toContain('7')       // the set that came up short
  })

  it('states the next target and the rule that chose it', () => {
    // every rep hit under linear progression, so the load goes up and the digest says why
    const out = trainingDigest(S(session(2)), 7)
    expect(out).toMatch(/77\.5|77,5/)
    expect(out.toLowerCase()).toContain('every rep')
  })

  it('lists an exercise in the plan that has never been trained', () => {
    // it is in the program, so the coach adjusting the program has to see it
    expect(trainingDigest(S(), 7)).toContain('barbell bench press')
  })

  it('names a PR when the session set one', () => {
    expect(trainingDigest(S(session(1, { prs: ['0025'] })), 7)).toContain('PR')
  })

  it('keeps only sessions inside the window', () => {
    const out = trainingDigest(S(session(2), session(40, { name: 'Old Day' })), 7)
    expect(out).not.toContain('Old Day')
  })

  it('says how many sessions it left out rather than truncating silently', () => {
    const many = Array.from({ length: MAX_SESSIONS + 3 }, (_, i) => session(i + 1))
    const out = trainingDigest(S(...many), 90)
    expect(out).toMatch(/3/)
    expect(out.split('Push Day').length - 1).toBeLessThanOrEqual(MAX_SESSIONS + 1)
  })

  it('reads a profile with no training at all without throwing', () => {
    expect(() => trainingDigest(base(), 7)).not.toThrow()
  })
})
