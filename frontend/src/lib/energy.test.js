import { describe, it, expect } from 'vitest'
import {
  validTDEE, sportKcal, dayBalance, deficitTotals, impliedTDEE, predictedVsActual,
  deficitSeries, KCAL_PER_KG_FAT, TDEE_MIN, TDEE_MAX
} from './energy.js'

const S = (over = {}) => ({ nutrition: [], health: [], workouts: [], bodyweight: [], ...over })

// A fixed calendar, so nothing here depends on the day the suite runs.
const day = n => {
  const d = new Date(Date.UTC(2026, 0, 1 + n))
  return d.toISOString().slice(0, 10)
}

describe('validTDEE', () => {
  it('accepts a plausible maintenance figure', () => {
    expect(validTDEE(2400)).toBe(2400)
    expect(validTDEE(TDEE_MIN)).toBe(TDEE_MIN)
    expect(validTDEE(TDEE_MAX)).toBe(TDEE_MAX)
  })

  it('refuses what would poison every total on the page', () => {
    // 240 is a typo for 2 400, and it would report a 1 700 kcal surplus every single day
    expect(validTDEE(240)).toBe(null)
    expect(validTDEE(24000)).toBe(null)
    expect(validTDEE(0)).toBe(null)
    expect(validTDEE(null)).toBe(null)
    expect(validTDEE('x')).toBe(null)
  })
})

describe('sportKcal', () => {
  it('prefers the watch’s whole day over the session alone', () => {
    // the session is not the day: the walk home is training energy too, and the formula
    // adds sport to a TDEE that deliberately excludes all of it
    const st = S({
      health: [{ d: day(0), kcal: 780 }],
      workouts: [{ d: day(0), id: 'w', watch: { kcal: 430 } }]
    })
    expect(sportKcal(st, day(0))).toEqual({ kcal: 780, source: 'watch' })
  })

  it('falls back to the session when the day was never measured', () => {
    const st = S({ workouts: [{ d: day(0), id: 'w', watch: { kcal: 430 } }] })
    expect(sportKcal(st, day(0))).toEqual({ kcal: 430, source: 'session' })
  })

  it('separates a rest day from a session nobody measured', () => {
    // both come to zero, and only one of them is true
    expect(sportKcal(S(), day(0))).toEqual({ kcal: 0, source: 'rest' })
    expect(sportKcal(S({ workouts: [{ d: day(0), id: 'w' }] }), day(0)))
      .toEqual({ kcal: 0, source: 'missing' })
  })
})

describe('dayBalance', () => {
  it('computes (TDEE + sport) − intake', () => {
    const st = S({ nutrition: [{ d: day(0), kcal: 1900 }], health: [{ d: day(0), kcal: 620 }] })
    expect(dayBalance(st, day(0), 2100)).toMatchObject({
      tdee: 2100, sport: 620, out: 2720, intake: 1900, deficit: 820
    })
  })

  it('reports a surplus as a negative rather than hiding it at zero', () => {
    const st = S({ nutrition: [{ d: day(0), kcal: 3000 }] })
    expect(dayBalance(st, day(0), 2100).deficit).toBe(-900)
  })

  it('has no deficit for a day nobody logged — not a deficit of zero', () => {
    // calling an unlogged day break-even would credit the cut with a full TDEE of deficit
    const b = dayBalance(S(), day(0), 2100)
    expect(b.intake).toBe(null)
    expect(b.deficit).toBe(null)
  })

  it('has nothing to say without a maintenance figure', () => {
    expect(dayBalance(S({ nutrition: [{ d: day(0), kcal: 1900 }] }), day(0), null)).toBe(null)
  })
})

describe('deficitTotals', () => {
  const st = S({
    nutrition: [
      { d: day(0), kcal: 1500 },
      { d: day(1), kcal: 1800 },
      // day(2) never logged
      { d: day(3), kcal: 2200 }
    ],
    health: [{ d: day(1), kcal: 600 }],
    workouts: [{ d: day(3), id: 'w' }]     // trained, but nothing measured it
  })

  it('splits the deficit into what eating made and what training made', () => {
    const t = deficitTotals(st, 2000)
    expect(t.nutrition).toBe(500)          // +500 +200 −200
    expect(t.sport).toBe(600)
    expect(t.total).toBe(1100)
    // the two parts have to add up to the whole, or the third number means nothing
    expect(t.nutrition + t.sport).toBe(t.total)
  })

  it('carries the days it speaks for, and the days it had to skip', () => {
    const t = deficitTotals(st, 2000)
    expect(t.days).toBe(3)
    expect(t.span).toBe(4)                 // day(2) is in the run, just not in the log
    expect(t.from).toBe(day(0))
    expect(t.to).toBe(day(3))
    expect(t.unmeasured).toBe(1)           // the session with no energy figure
  })

  it('converts to fat mass at the usual rate', () => {
    expect(deficitTotals(st, 2000).kg).toBe(Math.round((1100 / KCAL_PER_KG_FAT) * 100) / 100)
  })

  it('has nothing to total without a TDEE or without a log', () => {
    expect(deficitTotals(st, null)).toBe(null)
    expect(deficitTotals(S(), 2000)).toBe(null)
  })
})

describe('the day still being lived', () => {
  const iso = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

  it('keeps today out of the totals, because lunch is not a day', () => {
    // at four in the afternoon the log holds one meal, and counting it would book a
    // 1 500 kcal deficit that dinner is about to erase
    const st = S({ nutrition: [{ d: iso(1), kcal: 1900 }, { d: iso(0), kcal: 600 }] })
    const t = deficitTotals(st, 2100)
    expect(t.days).toBe(1)
    expect(t.to).toBe(iso(1))
    expect(t.total).toBe(200)
    expect(deficitSeries(st, 2100)).toHaveLength(1)
  })

  it('counts it for the digest that is closing that day out', () => {
    const st = S({ nutrition: [{ d: iso(1), kcal: 1900 }, { d: iso(0), kcal: 1600 }] })
    expect(deficitTotals(st, 2100, 0, Date.now(), iso(0)).days).toBe(2)
  })

  it('still reports today on its own, which is the one place it belongs', () => {
    const st = S({ nutrition: [{ d: iso(0), kcal: 600 }] })
    expect(dayBalance(st, iso(0), 2100).deficit).toBe(1500)
  })
})

describe('impliedTDEE', () => {
  // Eight weeks at a flat 2 000 kcal, 4 kg gone: the arithmetic has one answer.
  const clean = (over = {}) => {
    const bodyweight = []
    for (let i = 0; i <= 56; i += 7) bodyweight.push({ d: day(i), w: 80 - (4 * i) / 56 })
    const nutrition = []
    for (let i = 0; i <= 56; i++) nutrition.push({ d: day(i), kcal: 2000 })
    return S({ bodyweight, nutrition, ...over })
  }

  it('reads maintenance off the weight curve and the intake log', () => {
    const r = impliedTDEE(clean())
    // 4 kg over 56 days is 550 kcal a day the food did not cover
    expect(r.tdee).toBe(2550)
    expect(r.kgPerWeek).toBe(-0.5)
    expect(r.coverage).toBe(1)
    expect(r.weighIns).toBe(9)
  })

  it('takes the training back out, so the figure stays comparable to what you typed', () => {
    // the field asks for expenditure without training; the curve knows the total
    const withSport = clean({ health: Array.from({ length: 57 }, (_, i) => ({ d: day(i), kcal: 300 })) })
    expect(impliedTDEE(withSport).tdee).toBe(2250)
    expect(impliedTDEE(withSport).expenditure).toBe(2550)
  })

  it('refuses a run too short to be fat rather than water', () => {
    const short = S({
      bodyweight: [0, 3, 6, 9].map(i => ({ d: day(i), w: 80 - i * 0.1 })),
      nutrition: Array.from({ length: 10 }, (_, i) => ({ d: day(i), kcal: 2000 }))
    })
    expect(impliedTDEE(short)).toMatchObject({ tdee: null, why: 'span' })
  })

  it('refuses a curve drawn from too few weigh-ins', () => {
    expect(impliedTDEE(clean({ bodyweight: [{ d: day(0), w: 80 }, { d: day(56), w: 76 }] })))
      .toMatchObject({ tdee: null, why: 'weighIns' })
  })

  it('refuses a log too sparse to be the period’s average', () => {
    // people log the days that went well; a third of a cut is not a sample of it
    const sparse = clean({ nutrition: Array.from({ length: 15 }, (_, i) => ({ d: day(i * 2), kcal: 2000 })) })
    expect(impliedTDEE(sparse)).toMatchObject({ tdee: null, why: 'coverage' })
  })

  it('refuses to report a figure outside what a body can spend', () => {
    // 100 kcal a day and only 4 kg gone in eight weeks is a log nobody kept, not a body
    const absurd = clean({ nutrition: Array.from({ length: 57 }, (_, i) => ({ d: day(i), kcal: 100 })) })
    expect(impliedTDEE(absurd)).toMatchObject({ tdee: null, why: 'range' })
  })
})

describe('predictedVsActual', () => {
  it('puts the deficit’s prediction next to what the scale did', () => {
    const st = S({
      nutrition: Array.from({ length: 30 }, (_, i) => ({ d: day(i), kcal: 1500 })),
      bodyweight: [{ d: day(0), w: 80 }, { d: day(29), w: 78 }]
    })
    // 30 days at 500 under 2 000 is 15 000 kcal, just under 2 kg predicted
    const r = predictedVsActual(st, 2000)
    expect(r.predicted).toBeCloseTo(-1.95, 1)
    expect(r.actual).toBe(-2)
    expect(r.gap).toBeCloseTo(-0.05, 1)
  })

  it('needs a pair of weigh-ins inside the run it is judging', () => {
    const st = S({ nutrition: [{ d: day(0), kcal: 1500 }], bodyweight: [{ d: day(0), w: 80 }] })
    expect(predictedVsActual(st, 2000)).toBe(null)
  })
})

describe('deficitSeries', () => {
  it('plots only the days it can compute, and skips the rest', () => {
    const st = S({ nutrition: [{ d: day(0), kcal: 1500 }, { d: day(2), kcal: 1700 }] })
    expect(deficitSeries(st, 2000).map(p => p.y)).toEqual([500, 300])
    expect(deficitSeries(st, null)).toEqual([])
  })
})
