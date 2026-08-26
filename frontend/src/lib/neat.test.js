import { describe, it, expect } from 'vitest'
import { observedNEAT, sportKcal, neatFor, dayNEAT, neatBonus, dayBalance, deficitTotals, NEAT_MIN_DAYS, STEP_MAX } from './energy.js'
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

  it('never moves the entered maintenance figure itself', () => {
    // Whatever a day did, the figure in the settings stays the figure in the settings. What
    // the day did shows up beside it as its own term, where it can be read and checked.
    for (const neat of [700, 300, null]) {
      const S = { ...base(), nutrition: [{ d: D(15), kcal: 2000 }],
        health: neat == null ? [] : [{ d: D(15), neat }] }
      const b = dayBalance(S, D(15), S.tdee, 0, NOW)
      expect(b.tdee, String(neat)).toBe(2500)
      expect(b.parts.neat, String(neat)).toBe(450)
    }
  })

  it('runs in both directions once a day says what it did', () => {
    const day = neat => dayBalance(
      { ...base(), nutrition: [{ d: D(15), kcal: 2000 }], health: [{ d: D(15), neat }] },
      D(15), base().tdee, 0, NOW)
    expect(day(700).bonus).toBe(250)          // 700 − 450
    expect(day(700).out).toBe(2500 + 250)     // nothing measured the training, so no delta
    expect(day(450).bonus).toBe(0)
    expect(day(200).bonus).toBe(-250)         // a quieter day really did cost less
    expect(day(200).out).toBe(2500 - 250)
  })

  it('says nothing at all about a day nobody measured', () => {
    // The one asymmetry, and the important one: an absent pedometer is not a sedentary day.
    const S = { ...base(), nutrition: [{ d: D(15), kcal: 2000 }], health: [] }
    const b = dayBalance(S, D(15), S.tdee, 0, NOW)
    expect(b.bonus).toBe(0)
    expect(b.out).toBe(2500)
  })

  it('reports only the days where the column actually decided something', () => {
    const S = {
      ...base(),
      workouts: [{ d: D(14), id: 'a' }, { d: D(15), id: 'b' }],
      nutrition: [{ d: D(14), kcal: 2000 }, { d: D(15), kcal: 2000 }],
      health: [{ d: D(14), neat: 700 }, { d: D(15), kcal: 1000, neat: 700 }]
    }
    // Both days carry a NEAT figure; only the one with a day total had it taken off anything.
    expect(deficitTotals(S, S.tdee, 0, NOW).neatDays).toBe(1)
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
    expect(b.neat).toBe(450)
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

/**
 * Steps as the unit NEAT is actually measured in.
 *
 * The entered figure pays for a certain number of steps. Walk more and the day really did
 * cost more; walk less and it did not cost less, because a maintenance that sags whenever
 * the phone was in the other pocket is a maintenance nobody can plan against. So the term
 * only ever adds.
 */
describe('walking above what the figure already pays for', () => {
  const S = (steps, over = {}) => ({
    watchTrim: 0, tdee: { bmr: 1700, neat: 450, other: 0, sport: 350, stepBase: 8500 },
    workouts: [], nutrition: [{ d: D(15), kcal: 2000 }], bodyweight: [],
    health: steps == null ? [] : [{ d: D(15), steps }], ...over
  })
  const bal = (steps, over) => dayBalance(S(steps, over), D(15), S(steps, over).tdee, 0, NOW)

  it('reads the day’s NEAT off the step count, in proportion', () => {
    expect(dayNEAT(S(8500), D(15), S().tdee)).toMatchObject({ kcal: 450, from: 'steps', steps: 8500, base: 8500 })
    expect(dayNEAT(S(17000), D(15), S().tdee).kcal).toBe(900)
  })

  it('adds above the baseline, subtracts below it, and says nothing without a count', () => {
    expect(bal(12000).bonus).toBe(Math.round((12000 - 8500) / 8500 * 450))   // +185
    expect(bal(12000).tdee).toBe(2500)                                       // untouched
    expect(bal(12000).out).toBe(2500 + 185)   // nothing measured the training, so no delta
    expect(bal(8500).bonus).toBe(0)
    expect(bal(3000).bonus).toBe(Math.round((3000 - 8500) / 8500 * 450))     // −291
    expect(bal(null).bonus).toBe(0)                                          // not measured
  })

  it('matches the reference table for this profile', () => {
    // 1723 BMR + 270 NEAT + 80 TEF + 230 smoothed sport = 2 303, and 270 kcal buys 9 000
    // steps — which is 0.03 kcal a step, the net figure rather than the gross one.
    const P = { bmr: 1723, neat: 270, other: 80, sport: 230, stepBase: 9000 }
    const at = steps => dayBalance(
      { watchTrim: 0, tdee: P, workouts: [], bodyweight: [], nutrition: [{ d: D(15), kcal: 2000 }],
        health: steps == null ? [] : [{ d: D(15), steps }] }, D(15), P, 0, NOW)
    expect(at(null).bonus).toBe(0)
    expect(at(3000).bonus).toBe(-180)
    expect(at(6000).bonus).toBe(-90)
    expect(at(9000).bonus).toBe(0)
    expect(at(10000).bonus).toBe(30)
    expect(at(12000).bonus).toBe(90)
    expect(at(15000).bonus).toBe(180)
    expect(at(20000).bonus).toBe(330)
    expect(at(30000).bonus).toBe(630)
  })

  it('honours a step baseline of your own', () => {
    const S2 = S(12000); S2.tdee = { ...S2.tdee, stepBase: 12000 }
    expect(dayBalance(S2, D(15), S2.tdee, 0, NOW).bonus).toBe(0)
    const S3 = S(12000); S3.tdee = { ...S3.tdee, stepBase: 6000 }
    expect(dayBalance(S3, D(15), S3.tdee, 0, NOW).bonus).toBe(450)   // 6 000 extra = one whole NEAT
  })

  it('refuses a step count nobody walked', () => {
    // A pedometer that reported 900 000 is broken, and charging it would wreck a month.
    expect(bal(900000).bonus).toBe(bal(STEP_MAX).bonus)
  })

  it('a NEAT column in kcal outranks the step count', () => {
    const S2 = S(20000); S2.health = [{ d: D(15), steps: 20000, neat: 600 }]
    expect(dayNEAT(S2, D(15), S2.tdee)).toMatchObject({ kcal: 600, from: 'day' })
    expect(dayBalance(S2, D(15), S2.tdee, 0, NOW).bonus).toBe(150)
  })

  it('does not double-count against a whole-day watch reading', () => {
    // The watch's 1 400 already contains the walking. Training comes out as 1 400 − that
    // day's NEAT; the bonus puts the surplus back. The two must cancel to BMR + other + 1 400.
    const S2 = S(17000)
    S2.workouts = [{ d: D(15), id: 'w' }]
    S2.health = [{ d: D(15), steps: 17000, kcal: 1400 }]
    const b = dayBalance(S2, D(15), S2.tdee, 0, NOW)
    expect(b.sport).toBe(1400 - 900)          // day NEAT from 17 000 steps = 900
    expect(b.bonus).toBe(900 - 450)
    expect(b.out).toBe(1700 + 0 + 1400)       // BMR + other + what the watch read
  })

  it('keeps the totals adding up with a third term in them', () => {
    const tot = deficitTotals(S(12000), S().tdee, 0, NOW)
    expect(tot.nutrition + tot.sportDelta + tot.bonus).toBe(tot.total)
    expect(tot.bonusDays).toBe(1)
  })
})

describe('the whole model, on the profile it was specified for', () => {
  // 1723 BMR + 270 NEAT + 80 TEF + 230 smoothed sport = 2 303, 9 000 steps, watch at 0.72.
  const P = { bmr: 1723, neat: 270, other: 80, sport: 230, stepBase: 9000 }
  const S = over => ({ watchTrim: 0.28, tdee: P, workouts: [], bodyweight: [], health: [],
    nutrition: [{ d: D(15), kcal: 1851 }], ...over })

  it('works the reference day through end to end', () => {
    // 24/08: 1 851 eaten, steps not logged, a push session the watch read at 420.
    const st = S({ workouts: [{ d: D(15), id: 'w', name: 'Push', watch: { kcal: 420 } }] })
    const b = dayBalance(st, D(15), P, 0.28, NOW)
    expect(b.bonus).toBe(0)               // steps not logged: nothing assumed either way
    expect(b.sport).toBe(302)             // 420 x 0.72
    expect(b.delta).toBe(72)              // against the 230 the figure already contains
    expect(b.out).toBe(2375)              // the spec says 2 372, off by the 2 303/2 300 rounding
    expect(b.deficit).toBe(2375 - 1851)
  })

  it('charges a rest day the entered figure, and a strict profile the figure less its sport', () => {
    const rest = S({ workouts: [{ d: D(11), id: 'a' }, { d: D(13), id: 'b' }] })
    expect(dayBalance(rest, D(15), P, 0.28, NOW)).toMatchObject({ sportSource: 'rest', delta: 0, out: 2303 })
    expect(dayBalance({ ...rest, restStrict: true }, D(15), P, 0.28, NOW))
      .toMatchObject({ delta: -230, out: 2073 })
  })

  it('reads a small session as the loss it is', () => {
    // 250 on the watch is 180 real, against 230 already budgeted: the day cost 50 less.
    const st = S({ workouts: [{ d: D(15), id: 'w', watch: { kcal: 250 } }] })
    expect(dayBalance(st, D(15), P, 0.28, NOW)).toMatchObject({ sport: 180, delta: -50, out: 2253 })
  })

  it('stacks the two terms on a long day with a long session', () => {
    // The Agung hike: 2 270 on the watch, 15 000 steps.
    const st = S({
      workouts: [{ d: D(15), id: 'w', watch: { kcal: 2270 } }],
      health: [{ d: D(15), steps: 15000 }]
    })
    const b = dayBalance(st, D(15), P, 0.28, NOW)
    expect(b.sport).toBe(1634)            // 2 270 x 0.72
    expect(b.delta).toBe(1404)
    expect(b.bonus).toBe(180)             // 6 000 steps over the 9 000 assumed
    expect(b.out).toBe(2303 + 1404 + 180)
  })
})
