import { describe, it, expect } from 'vitest'
import { observedNEAT, sportKcal, neatFor, dayBalance, deficitTotals, NEAT_MIN_DAYS } from './energy.js'
import { parseHealthCSV } from './health.js'

const D = n => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10)
const NOW = Date.UTC(2026, 0, 21)

describe('observedNEAT', () => {
  // Six rest days of ordinary walking, plus training days that must not pollute the baseline
  const S = {
    watchTrim: 0, tdee: { bmr: 1700, neat: 450, sport: 350 },
    workouts: [{ d: D(1), id: 'a' }, { d: D(3), id: 'b' }, { d: D(5), id: 'c' }],
    health: [
      { d: D(0), kcal: 380 }, { d: D(2), kcal: 420 }, { d: D(4), kcal: 400 },
      { d: D(6), kcal: 900 },                       // a Sunday hike, on a rest day
      { d: D(7), kcal: 410 }, { d: D(8), kcal: 390 },
      { d: D(1), kcal: 1050 }, { d: D(3), kcal: 980 }, { d: D(5), kcal: 1010 }
    ],
    nutrition: [], bodyweight: []
  }

  it('reads the baseline off rest days only', () => {
    const n = observedNEAT(S, 90, NOW)
    expect(n.days).toBe(6)
    expect(n.kcal).toBe(405)          // median of 380 390 400 410 420 900
  })

  it('uses the median, so one long Sunday does not become the baseline', () => {
    // the mean of those six is 483; the hike moves it by 78 kcal a day and the median by 0
    expect(observedNEAT(S, 90, NOW).kcal).toBeLessThan(430)
  })

  it('says nothing when there are too few rest days to speak from', () => {
    const thin = { ...S, health: S.health.slice(0, NEAT_MIN_DAYS - 1) }
    expect(observedNEAT(thin, 90, NOW)).toBe(null)
  })
})

describe('sportKcal — measured NEAT beats declared', () => {
  const rest = n => Array.from({ length: n }, (_, i) => ({ d: D(i * 2), kcal: 400 }))

  it('takes the rest-day baseline off a training day', () => {
    const S = {
      watchTrim: 0, tdee: { bmr: 1700, neat: 450, sport: 350 },
      workouts: [{ d: D(15), id: 'w' }], nutrition: [], bodyweight: [],
      health: [...rest(6), { d: D(15), kcal: 1000 }]
    }
    const sp = sportKcal(S, D(15), 0, S.tdee, NOW)
    expect(sp).toMatchObject({ kcal: 600, raw: 1000, neat: 400 })   // 400 measured, not 450 declared
    expect(sp.neatFrom).toEqual({ kind: 'rest', days: 6 })
  })

  it('falls back to the declared figure until the rest days are there', () => {
    const S = {
      watchTrim: 0, tdee: { bmr: 1700, neat: 450, sport: 350 },
      workouts: [{ d: D(15), id: 'w' }], nutrition: [], bodyweight: [],
      health: [...rest(2), { d: D(15), kcal: 1000 }]
    }
    const sp = sportKcal(S, D(15), 0, S.tdee, NOW)
    expect(sp).toMatchObject({ kcal: 550, neat: 450 })
    expect(sp.neatFrom).toEqual({ kind: 'declared' })
  })

  it('trims the baseline the same way it trims the reading', () => {
    // both are watch readings; trimming one and not the other would be a silent bias
    const S = {
      watchTrim: 0.28, tdee: { bmr: 1700, neat: 450, sport: 350 },
      workouts: [{ d: D(15), id: 'w' }], nutrition: [], bodyweight: [],
      health: [...rest(6), { d: D(15), kcal: 1000 }]
    }
    const sp = sportKcal(S, D(15), 0.28, S.tdee, NOW)
    expect(sp.kcal).toBe(Math.round(1000 * 0.72) - Math.round(400 * 0.72))
  })
})

describe('sportKcal — a session the app never logged', () => {
  it('reads training energy filed against the day, and takes no NEAT off it', () => {
    // Someone trained without the app. The figure is training and nothing else, exactly as
    // it would be if a session had been logged to carry it.
    const S = {
      watchTrim: 0, tdee: { bmr: 1700, neat: 450, sport: 350 }, workouts: [],
      nutrition: [], bodyweight: [],
      health: [{ d: D(15), sport: 612, sportMin: 47 }]
    }
    expect(sportKcal(S, D(15), 0, S.tdee, NOW)).toMatchObject({ kcal: 612, neat: 0, source: 'session' })
  })

  it('lets a logged session outrank it', () => {
    const S = {
      watchTrim: 0, tdee: { bmr: 1700, neat: 450, sport: 350 },
      workouts: [{ d: D(15), id: 'w', watch: { kcal: 700 } }], nutrition: [], bodyweight: [],
      health: [{ d: D(15), sport: 612 }]
    }
    expect(sportKcal(S, D(15), 0, S.tdee, NOW).kcal).toBe(700)
  })

  it('leaves the day’s NEAT alone when the steps were never logged', () => {
    // An absent figure is absent, not zero: a day nobody counted must not read as a day of
    // no movement, which is what the rest-day baseline is built from.
    const S = {
      watchTrim: 0, tdee: { bmr: 1700, neat: 450, sport: 350 }, workouts: [],
      nutrition: [], bodyweight: [],
      health: [{ d: D(15), sport: 612 }]      // no steps, no day total
    }
    expect(observedNEAT(S, 90, NOW)).toBe(null)          // nothing measured it
    expect(sportKcal(S, D(15), 0, S.tdee, NOW).kcal).toBe(612)
  })
})

describe('a NEAT column, day by day', () => {
  const base = () => ({
    watchTrim: 0, tdee: { bmr: 1700, neat: 450, sport: 350 },
    workouts: [], nutrition: [], bodyweight: [], health: []
  })

  it('prefers the day’s own figure to every baseline', () => {
    const S = { ...base(), workouts: [{ d: D(15), id: 'w' }], health: [{ d: D(15), kcal: 1000, neat: 700 }] }
    const sp = sportKcal(S, D(15), 0, S.tdee, NOW)
    expect(sp).toMatchObject({ kcal: 300, raw: 1000, neat: 700 })   // 700 the file's, not 450 declared
    expect(sp.neatFrom).toEqual({ kind: 'day', days: undefined })
  })

  it('outranks the rest-day median, which is a baseline and not a measurement of that day', () => {
    const rest = Array.from({ length: 6 }, (_, i) => ({ d: D(i * 2), kcal: 400 }))
    const S = { ...base(), workouts: [{ d: D(15), id: 'w' }], health: [...rest, { d: D(15), kcal: 1000, neat: 250 }] }
    expect(observedNEAT(S, 90, NOW).kcal).toBe(400)
    expect(sportKcal(S, D(15), 0, S.tdee, NOW)).toMatchObject({ kcal: 750, neat: 250, source: 'watch' })
  })

  it('does not trim a figure the person gave, only one the watch read', () => {
    // The day's own NEAT is a real amount; the rest-day median is a watch reading. Trimming
    // the first would take an overcount off a number that never had one.
    const own = { ...base(), watchTrim: 0.28, workouts: [{ d: D(15), id: 'w' }], health: [{ d: D(15), kcal: 1000, neat: 400 }] }
    expect(sportKcal(own, D(15), 0.28, own.tdee, NOW).kcal).toBe(Math.round(1000 * 0.72) - 400)
    const rest = Array.from({ length: 6 }, (_, i) => ({ d: D(i * 2), kcal: 400 }))
    const seen = { ...base(), watchTrim: 0.28, workouts: [{ d: D(15), id: 'w' }], health: [...rest, { d: D(15), kcal: 1000 }] }
    expect(sportKcal(seen, D(15), 0.28, seen.tdee, NOW).kcal).toBe(Math.round(1000 * 0.72) - Math.round(400 * 0.72))
  })

  it('holds the day to its own maintenance, NEAT included', () => {
    const S = { ...base(), nutrition: [{ d: D(15), kcal: 2000 }], health: [{ d: D(15), neat: 700 }] }
    const b = dayBalance(S, D(15), S.tdee, 0, NOW)
    expect(b.parts.neat).toBe(700)
    expect(b.tdee).toBe(1700 + 700 + 350)      // 450 declared replaced by the day's 700
    expect(b.neatFrom).toBe('day')
  })

  it('counts the day’s own NEAT in the deficit, rather than reading the column and ignoring it', () => {
    const day = neat => ({
      ...base(),
      workouts: [{ d: D(15), id: 'w', watch: { kcal: 350 } }],
      nutrition: [{ d: D(15), kcal: 2000 }],
      health: neat == null ? [] : [{ d: D(15), neat }]
    })
    // 1700 + neat + 350 maintenance, 350 trained against 350 planned, 2000 eaten
    expect(deficitTotals(day(700), base().tdee, 0, NOW).total).toBe(2750 - 2000)
    expect(deficitTotals(day(null), base().tdee, 0, NOW).total).toBe(2500 - 2000)
  })
})

describe('a NEAT cell nobody filled in', () => {
  // The property this whole feature is bought for: a gap in the column costs nothing. Read
  // as zero it would hand the day its whole active energy as training and invent a deficit
  // out of a walk to the shops.
  const S = () => ({
    watchTrim: 0, tdee: { bmr: 1700, neat: 450, sport: 350 },
    workouts: [{ d: D(15), id: 'w' }], nutrition: [{ d: D(15), kcal: 2000 }], bodyweight: [],
    health: [{ d: D(14), neat: 700 }, { d: D(15), kcal: 1000 }]
  })

  it('falls back to the declared figure instead of zero', () => {
    const sp = sportKcal(S(), D(15), 0, S().tdee, NOW)
    expect(sp.neat).toBe(450)
    expect(sp.neatFrom).toEqual({ kind: 'declared', days: undefined })
    expect(sp.kcal).toBe(550)          // not 1000, which is what a zero NEAT would give
  })

  it('leaves that day’s maintenance exactly as it was', () => {
    const b = dayBalance(S(), D(15), S().tdee, 0, NOW)
    expect(b.tdee).toBe(2500)
    expect(b.neatFrom).toBe('declared')
  })

  it('never writes a zero into the day from an empty cell', () => {
    const { payloads } = parseHealthCSV('Date,NEAT kcal\n2026-01-15,\n2026-01-16,700\n')
    expect(payloads.find(p => p.d === '2026-01-15')).toBeUndefined()
    expect(payloads.find(p => p.d === '2026-01-16')).toMatchObject({ neat: 700 })
  })

  it('reads the median off rest days when there is no column and no gap to fill', () => {
    const rest = Array.from({ length: 6 }, (_, i) => ({ d: D(i * 2), kcal: 400 }))
    const s = S(); s.health = [...rest, { d: D(15), kcal: 1000 }]
    expect(sportKcal(s, D(15), 0, s.tdee, NOW).neatFrom).toEqual({ kind: 'rest', days: 6 })
  })
})
