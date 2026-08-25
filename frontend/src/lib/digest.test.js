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
  // trim off by default here: these tests are about the digest, not about how much of a
  // watch reading survives. One test below is about exactly that.
  exWeights: {}, customEx: [], watchTrim: 0, ...over
})

describe('dailyDigest', () => {
  it('is today and nothing else — no weigh-in, no trend, no running total', () => {
    // a conversation receiving one of these every evening accumulates the history itself;
    // re-sending it nightly asks the reader to reconcile two versions of the same past
    const S = base({
      targetW: 77, tdee: 2100,
      bodyweight: [{ d: iso(3), w: 79.4 }, { d: iso(0), w: 78.4 }],
      nutrition: [{ d: iso(3), kcal: 1800 }, { d: iso(0), kcal: 1900 }]
    })
    const out = dailyDigest(S, iso(0))
    expect(out).not.toContain('78.4')
    expect(out).not.toContain('Last 7 days')
    expect(out).not.toContain('Since')
    // what it does carry: the day
    expect(out).toContain('1,900 kcal')
    expect(out).toContain('Balance')
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

  it('reports what was done, not what a plan expected', () => {
    // a plan is not a fact about the day, and this digest carries facts. What a missed
    // session cost shows up where it belongs: in the balance, as a negative delta.
    const r = { id: 'r1', name: 'Push Day', ex: [] }
    const wd = daysAgo(0).getDay()
    expect(dailyDigest(base({ routines: [r], week: { [wd]: 'r1' } }), iso(0))).not.toContain('Push Day')
  })

  it('names each activity with its duration and what the watch said it cost', () => {
    const w = { ...session(0), watch: { minutes: 53, kcal: 430, hrAvg: 128 } }
    const out = dailyDigest(base({ workouts: [w] }), iso(0))
    expect(out).toContain('Push Day')
    expect(out).toContain('53 min')
    expect(out).toContain('430 kcal')
  })

  it('lists both of them when a day held two', () => {
    const a = { ...session(0), id: 'a', name: 'Push Day' }
    const b = { ...session(0), id: 'b', name: 'Run', watch: { minutes: 34, km: 6.2 } }
    const out = dailyDigest(base({ workouts: [a, b] }), iso(0))
    expect(out).toContain('Push Day')
    expect(out).toContain('Run')
    expect(out).toContain('6.2 km')
  })

  it('leaves the set-by-set detail to the digest that is asked for it', () => {
    // the coach reading this one wants the shape of the day, not the load on the bar
    const out = dailyDigest(base({ workouts: [session(0)] }), iso(0))
    expect(out).not.toContain('4x8')
    expect(out).not.toContain('75 kg')
  })

  it('reads the macros back carbs first, the way a food log is read', () => {
    const S = base({ nutrition: [{ d: iso(0), kcal: 1940, p: 155, c: 180, f: 62 }] })
    const line = dailyDigest(S, iso(0)).split('\n').find(l => l.startsWith('Intake'))
    expect(line.indexOf('Carbs')).toBeLessThan(line.indexOf('Protein'))
    expect(line.indexOf('Protein')).toBeLessThan(line.indexOf('Fat'))
  })

  it('says the night it is reporting is the one before', () => {
    const S = base({ sleep: [{ d: iso(0), bed: '23:00', wake: '07:00' }] })
    expect(dailyDigest(S, iso(0))).toContain('8 h')
  })

  it('says nothing about days other than the one it is reporting', () => {
    const S = base({ nutrition: [1, 2, 3].map(n => ({ d: iso(n), kcal: 2100 })) })
    expect(dailyDigest(S, iso(0))).toContain('Intake nothing logged')
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
    expect(out).toContain('2,100 maintenance +620')
    expect(out).toContain('1,900')
    expect(out).toContain('+820')
  })

  it('adds only what the day differed from the training the figure budgets for', () => {
    const S = base({
      tdee: { bmr: 1700, neat: 400, sport: 400 },
      nutrition: [{ d: iso(0), kcal: 1900 }],
      health: [{ d: iso(0), kcal: 620 }]
    })
    expect(dailyDigest(S, iso(0))).toContain('2,500 maintenance +220')
  })

  it('shows what the watch said beside what was counted', () => {
    // a trimmed figure nobody can trace back to the reading is a number nobody can check
    const S = base({ watchTrim: 0.3, tdee: 2100, health: [{ d: iso(0), kcal: 700 }] })
    const out = dailyDigest(S, iso(0))
    expect(out).toContain('700 kcal')
    expect(out).toContain('490')
    expect(out).toContain('30')
  })

  it('says nothing about a balance it cannot compute', () => {
    const noTdee = dailyDigest(base({ nutrition: [{ d: iso(0), kcal: 1900 }] }), iso(0))
    expect(noTdee).not.toContain('Balance')
    // and an unlogged day is not a break-even day
    expect(dailyDigest(base({ tdee: 2100 }), iso(0))).not.toContain('Balance')
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
