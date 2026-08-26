import { describe, it, expect } from 'vitest'
import {
  validTDEE, tdeeParts, sportKcal, dayBalance, deficitTotals, impliedTDEE, predictedVsActual,
  deficitSeries, trimOf, KCAL_PER_KG_FAT, TDEE_MIN, TDEE_MAX, WATCH_TRIM
} from './energy.js'

const S = (over = {}) => ({ nutrition: [], health: [], workouts: [], bodyweight: [], watchTrim: 0, ...over })

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

describe('tdeeParts', () => {
  it('adds the parts up and keeps them', () => {
    expect(tdeeParts({ bmr: 1700, neat: 600, other: 0, sport: 300 }))
      .toEqual({ bmr: 1700, neat: 600, other: 0, sport: 300, total: 2600 })
  })

  it('reads a profile written before the breakdown existed', () => {
    // a bare number meant expenditure without training, which is a breakdown budgeting none
    expect(tdeeParts(2400)).toEqual({ bmr: 0, neat: 0, other: 2400, sport: 0, total: 2400 })
  })

  it('refuses a total no body could spend, however it was arrived at', () => {
    expect(tdeeParts({ bmr: 400, neat: 100 })).toBe(null)
    expect(tdeeParts({ bmr: 9000, sport: 2000 })).toBe(null)
    expect(tdeeParts(null)).toBe(null)
  })
})

describe('sportKcal', () => {
  it('takes the session’s own figure over the whole day’s', () => {
    // Apple's active energy is NEAT plus training, and maintenance already budgets NEAT.
    // The session's figure is training and nothing else, so it needs no correcting.
    const st = S({
      health: [{ d: day(0), kcal: 780 }],
      workouts: [{ d: day(0), id: 'w', watch: { kcal: 430 } }]
    })
    expect(sportKcal(st, day(0), 0)).toMatchObject({ kcal: 430, raw: 430, source: 'session' })
  })

  it('takes the budgeted NEAT back off a day total', () => {
    // Handed over whole, the walk home counts twice: once inside maintenance, once as
    // training. A deficit inflated by a few hundred kcal a day is the error to avoid.
    const st = S({ health: [{ d: day(0), kcal: 780 }] })
    expect(sportKcal(st, day(0), 0, { bmr: 1600, neat: 400, sport: 200 }))
      .toMatchObject({ kcal: 380, raw: 780, neat: 400, source: 'watch' })
  })

  it('never turns a quiet day into negative training', () => {
    const st = S({ health: [{ d: day(0), kcal: 250 }] })
    expect(sportKcal(st, day(0), 0, { bmr: 1600, neat: 400 })).toMatchObject({ kcal: 0, raw: 250 })
  })

  it('subtracts nothing from a maintenance figure entered as one number', () => {
    // A lump sum declares no NEAT, so there is nothing known to be double-counted.
    const st = S({ health: [{ d: day(0), kcal: 780 }] })
    expect(sportKcal(st, day(0), 0, 2100)).toMatchObject({ kcal: 780, neat: 0 })
  })

  it('uses the session when the day was never measured', () => {
    const st = S({ workouts: [{ d: day(0), id: 'w', watch: { kcal: 430 } }] })
    expect(sportKcal(st, day(0), 0)).toMatchObject({ kcal: 430, source: 'session' })
  })

  it('tells a rest day, an unmeasured session and a hole apart', () => {
    // All three come to zero and only one of them means "no training happened". The budget
    // is charged against a rest day and never against a hole: subtracting a day's training
    // budget from a day nobody recorded is how an imported history becomes a deficit nobody
    // earned. Evidence of a rest day is the app being used to log training around then.
    const tracked = { workouts: [{ d: day(3), id: 'a' }, { d: day(6), id: 'b' }] }

    expect(sportKcal(S(tracked), day(4), 0)).toMatchObject({ kcal: 0, source: 'rest' })
    expect(sportKcal(S({ workouts: [{ d: day(0), id: 'w' }] }), day(0), 0))
      .toMatchObject({ kcal: 0, source: 'missing' })
    expect(sportKcal(S(), day(0), 0)).toMatchObject({ kcal: 0, source: 'unknown' })
    // far enough from anything recorded that the silence says nothing
    expect(sportKcal(S(tracked), day(60), 0)).toMatchObject({ source: 'unknown' })
  })

  it('reads a day the watch spoke for as tracked, with no workout logged', () => {
    // an imported history that carries training energy is evidence just as a logged session is
    const st = S({ health: [{ d: day(3), sport: 400 }] })
    expect(sportKcal(st, day(4), 0)).toMatchObject({ source: 'rest' })
  })

  it('throws away the share of a watch reading nobody should trust', () => {
    // wrist devices read energy 20–40 % high; the raw figure stays so the cut is checkable
    const st = S({ health: [{ d: day(0), kcal: 700 }] })
    expect(sportKcal(st, day(0), 0.3)).toMatchObject({ kcal: 490, raw: 700, trim: 0.3 })
    expect(sportKcal(st, day(0))).toMatchObject({ kcal: Math.round(700 * (1 - WATCH_TRIM)) })
  })

  it('defaults the trim on rather than off, and takes an explicit zero as a choice', () => {
    expect(trimOf({})).toBe(WATCH_TRIM)
    expect(trimOf({ watchTrim: 0 })).toBe(0)
    expect(trimOf({ watchTrim: 0.15 })).toBe(0.15)
    expect(trimOf({ watchTrim: 5 })).toBe(WATCH_TRIM)      // out of range is not a choice
  })
})

describe('dayBalance', () => {
  it('adds only the difference from the training the figure already budgets for', () => {
    // 1 020 of active energy, 400 of which the figure already counts as NEAT → 620 trained
    const st = S({ nutrition: [{ d: day(0), kcal: 1900 }], health: [{ d: day(0), kcal: 1020 }] })
    const tdee = { bmr: 1700, neat: 400, sport: 400 }   // 2 500 total, 400 of it training
    expect(dayBalance(st, day(0), tdee)).toMatchObject({
      tdee: 2500, planned: 400, sport: 620, delta: 220, out: 2720, intake: 1900, deficit: 820
    })
  })

  it('leaves a day nobody measured on its entered figure', () => {
    // Strictly the budget assumed 400 kcal of training that did not happen. But nothing here
    // measured that day either way, and charging the budget back is a guess dressed as
    // arithmetic — so by default the day is charged what was entered, no more, no less.
    const st = S({ nutrition: [{ d: day(0), kcal: 1900 }] })
    expect(dayBalance(st, day(0), { bmr: 1700, neat: 400, sport: 400 }))
      .toMatchObject({ delta: 0, measured: false, out: 2500, deficit: 600 })
  })

  it('gives the training budget back on a rest day when told to be strict about it', () => {
    // For a profile whose maintenance figure genuinely describes a day that trained. Off by
    // default because it and the watch discount are two errors of opposite sign.
    const st = S({
      restStrict: true,
      nutrition: [{ d: day(0), kcal: 1900 }],
      workouts: [{ d: day(-2), id: 'a' }, { d: day(-4), id: 'b' }]   // the app was in use
    })
    expect(dayBalance(st, day(0), { bmr: 1700, neat: 400, sport: 400 }))
      .toMatchObject({ delta: -400, sportSource: 'rest', out: 2100, deficit: 200 })
  })

  it('is a plain food-against-maintenance day when training went to plan', () => {
    // 800 active: 400 the budgeted NEAT, 400 the budgeted training. Nothing to add.
    const st = S({ nutrition: [{ d: day(0), kcal: 2000 }], health: [{ d: day(0), kcal: 800 }] })
    expect(dayBalance(st, day(0), { bmr: 1700, neat: 400, sport: 400 }))
      .toMatchObject({ delta: 0, out: 2500, deficit: 500 })
  })

  it('still reads a profile that stored a single number', () => {
    const st = S({ nutrition: [{ d: day(0), kcal: 1900 }], health: [{ d: day(0), kcal: 620 }] })
    expect(dayBalance(st, day(0), 2100)).toMatchObject({
      tdee: 2100, planned: 0, sport: 620, delta: 620, out: 2720, deficit: 820
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
    health: [{ d: day(1), kcal: 600 }],   // read net of NEAT once a figure declares one
    workouts: [{ d: day(3), id: 'w' }]     // trained, but nothing measured it
  })

  it('splits the deficit into eating against the budget and training against it', () => {
    const t = deficitTotals(st, 2000)
    expect(t.nutrition).toBe(500)          // +500 +200 −200
    expect(t.sportDelta).toBe(600)         // nothing budgeted for sport, so all of it counts
    expect(t.total).toBe(1100)
    // the two parts have to add up to the whole, or neither number means anything
    expect(t.nutrition + t.sportDelta).toBe(t.total)
  })

  it('carries the training that happened beside the training the figure assumed', () => {
    // with sport budgeted in, the deficit it creates lives inside `nutrition` — a card that
    // only had `sportDelta` would report zero training on a cut built entirely on training
    // 600 active on day(1), 200 of it the NEAT the figure already budgets → 400 trained.
    // Only that day was measured, so only that day is held to the 200 the figure assumes.
    const t = deficitTotals(st, { bmr: 1600, neat: 200, sport: 200 })
    expect(t.sportLogged).toBe(400)
    expect(t.plannedDays).toBe(1)
    expect(t.sportPlanned).toBe(200)
    expect(t.sportDelta).toBe(200)         // 400 done against the 200 assumed of that day
    expect(t.nutrition + t.sportDelta + t.bonus).toBe(t.total)
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

describe('deficitTotals — days that say nothing about training', () => {
  // Four months of imported intake with almost no training data, against a maintenance
  // figure that budgets 230 kcal a day of it. This is the shape that produced a headline
  // deficit of 2 671 kcal beside a scale that had moved 6.7 kg.
  const days120 = Array.from({ length: 120 }, (_, i) => day(-i))
  const st = S({
    tdee: { bmr: 1620, neat: 453, other: 0, sport: 230 },
    nutrition: days120.map(d => ({ d, kcal: 1900 })),
    health: []
  })

  it('does not charge a training budget to a day nobody recorded', () => {
    const t = deficitTotals(st, st.tdee, 0, Date.UTC(2026, 5, 1))
    expect(t.untracked).toBe(t.days)          // nothing was tracked at all
    expect(t.sportDelta).toBe(0)              // so training contributes nothing either way
    expect(t.sportPlanned).toBe(0)            // and nothing was assumed of those days
    expect(t.total).toBe(t.nutrition)
  })

  it('leaves a real rest day alone too, unless the profile asks for strictness', () => {
    const withWorkouts = extra => S({
      ...st, ...extra,
      workouts: days120.filter((_, i) => i % 3 === 0).map((d, i) => ({ d, id: 'w' + i }))
    })
    const loose = deficitTotals(withWorkouts({}), st.tdee, 0, Date.UTC(2026, 5, 1))
    expect(loose.untracked).toBe(0)           // the app was in use throughout
    expect(loose.sportDelta).toBe(0)          // but nothing measured a single session
    expect(loose.sportPlanned).toBe(0)        // so nothing was held to the budget

    const strict = deficitTotals(withWorkouts({ restStrict: true }), st.tdee, 0, Date.UTC(2026, 5, 1))
    expect(strict.sportDelta).toBeLessThan(0)
    expect(strict.total).toBeLessThan(loose.total)
  })
})

describe('the totals do not trust the order they were handed', () => {
  // An import, or a database round trip, can hand back a nutrition list newest-first. The
  // period was read straight off the ends of it, so a reversed list reported a negative span
  // and a date range running backwards — with nothing else wrong to give it away.
  it('reads the same period whichever way round the log arrives', () => {
    const nights = Array.from({ length: 10 }, (_, i) => ({ d: day(-i), kcal: 1900 }))
    const asc = S({ nutrition: [...nights].reverse() })
    const desc = S({ nutrition: nights })
    const a = deficitTotals(asc, 2300, 0, Date.UTC(2026, 5, 1))
    const b = deficitTotals(desc, 2300, 0, Date.UTC(2026, 5, 1))
    expect(b.span).toBeGreaterThan(0)
    expect(b.from < b.to).toBe(true)
    expect(b).toEqual(a)
  })
})
