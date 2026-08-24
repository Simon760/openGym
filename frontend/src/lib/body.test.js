import { describe, it, expect } from 'vitest'
import {
  validBodyFat, lastComposition, composition, compositionTrend, bodyFatSeries,
  validSleep, sleepFor, lastSleep, putSleep, sleepAverage, sleepDebt, sleepSeries,
  BF_MIN, BF_MAX, SLEEP_MIN, SLEEP_MAX
} from './body.js'
import { isoOf } from './format.js'

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const iso = n => isoOf(daysAgo(n))
const S = (bodyweight = [], sleep = []) => ({ bodyweight, sleep })

describe('validBodyFat', () => {
  it('accepts a plausible reading', () => {
    expect(validBodyFat(18.4)).toBe(18.4)
    expect(validBodyFat(BF_MIN)).toBe(BF_MIN)
    expect(validBodyFat(BF_MAX)).toBe(BF_MAX)
  })

  it('refuses what a body cannot be, rather than charting it', () => {
    // a misplaced decimal, or the scale reading someone else's foot — one such point
    // flattens every real change around it
    expect(validBodyFat(184)).toBe(null)
    expect(validBodyFat(0.18)).toBe(null)
    expect(validBodyFat(0)).toBe(null)
    expect(validBodyFat(null)).toBe(null)
    expect(validBodyFat('x')).toBe(null)
  })
})

describe('composition', () => {
  it('splits a weigh-in into fat and lean mass', () => {
    const c = composition({ w: 80, bf: 20 })
    expect(c).toEqual({ weight: 80, bf: 20, fat: 16, lean: 64 })
  })

  it('has nothing to split without a percentage', () => {
    expect(composition({ w: 80 })).toBe(null)
    expect(composition({ bf: 20 })).toBe(null)
    expect(composition(null)).toBe(null)
  })
})

describe('compositionTrend', () => {
  it('separates weight lost from fat lost — the point of tracking it at all', () => {
    // 2 kg down, all of it fat: lean mass held
    const tr = compositionTrend(S([
      { d: iso(28), w: 82, bf: 22 },
      { d: iso(0), w: 80, bf: 19.9 }
    ]), 30)
    expect(tr.weight).toBe(-2)
    expect(tr.fat).toBeCloseTo(-2.1, 1)
    expect(tr.lean).toBeCloseTo(0.1, 1)
    expect(tr.readings).toBe(2)
  })

  it('shows lean mass going with the weight when the cut is too hard', () => {
    const tr = compositionTrend(S([
      { d: iso(28), w: 82, bf: 22 },
      { d: iso(0), w: 78, bf: 21.5 }
    ]), 30)
    expect(tr.lean).toBeLessThan(0)
  })

  it('needs a pair — one reading is a measurement, not a trend', () => {
    expect(compositionTrend(S([{ d: iso(0), w: 80, bf: 20 }]), 30)).toBe(null)
    expect(compositionTrend(S(), 30)).toBe(null)
  })

  it('ignores weigh-ins with no percentage and those outside the window', () => {
    const st = S([
      { d: iso(90), w: 90, bf: 28 },
      { d: iso(20), w: 82, bf: 22 },
      { d: iso(10), w: 81 },
      { d: iso(0), w: 80, bf: 20 }
    ])
    expect(compositionTrend(st, 30).readings).toBe(2)
    expect(bodyFatSeries(st, 30).map(p => p.y)).toEqual([22, 20])
  })
})

describe('lastComposition', () => {
  it('finds the latest weigh-in that carried a percentage', () => {
    const st = S([{ d: iso(5), w: 81, bf: 21 }, { d: iso(0), w: 80 }])
    expect(lastComposition(st).d).toBe(iso(5))
    expect(lastComposition(S([{ d: iso(0), w: 80 }]))).toBe(null)
  })
})

describe('validSleep', () => {
  it('accepts a night and refuses what is not one', () => {
    expect(validSleep(7.5)).toBe(7.5)
    expect(validSleep(SLEEP_MIN)).toBe(SLEEP_MIN)
    expect(validSleep(SLEEP_MAX)).toBe(SLEEP_MAX)
    expect(validSleep(26)).toBe(null)
    expect(validSleep(0.1)).toBe(null)
    expect(validSleep(0)).toBe(null)
  })
})

describe('putSleep', () => {
  it('adds a night and keeps the list sorted', () => {
    const l = putSleep(putSleep([], { d: '2026-08-20', h: 7 }), { d: '2026-08-18', h: 8 })
    expect(l.map(e => e.d)).toEqual(['2026-08-18', '2026-08-20'])
  })

  it('replaces the night rather than adding a second entry for it', () => {
    const l = putSleep([{ d: '2026-08-20', h: 7 }], { d: '2026-08-20', h: 8.5 })
    expect(l).toHaveLength(1)
    expect(l[0].h).toBe(8.5)
  })

  it('keeps a quality rating only when it is on the scale', () => {
    expect(putSleep([], { d: '2026-08-20', h: 7, q: 4 })[0].q).toBe(4)
    expect('q' in putSleep([], { d: '2026-08-20', h: 7, q: 9 })[0]).toBe(false)
    expect('q' in putSleep([], { d: '2026-08-20', h: 7 })[0]).toBe(false)
  })

  it('removes the night when the hours are cleared', () => {
    expect(putSleep([{ d: '2026-08-20', h: 7 }], { d: '2026-08-20', h: 0 })).toEqual([])
  })
})

describe('sleepAverage', () => {
  it('averages over the nights that were logged, not the length of the window', () => {
    // three nights inside a week: the four nobody logged are gaps, not insomnia
    const st = S([], [{ d: iso(1), h: 7 }, { d: iso(2), h: 8 }, { d: iso(3), h: 6 }])
    const a = sleepAverage(st, 7)
    expect(a.hours).toBe(7)
    expect(a.nights).toBe(3)
  })

  it('averages quality over the nights that carried a rating', () => {
    const st = S([], [{ d: iso(1), h: 7, q: 4 }, { d: iso(2), h: 8 }, { d: iso(3), h: 6, q: 2 }])
    const a = sleepAverage(st, 7)
    expect(a.quality).toBe(3)
    expect(a.ratedNights).toBe(2)
    expect(a.nights).toBe(3)
  })

  it('reports nothing rather than a number it cannot back', () => {
    expect(sleepAverage(S(), 7)).toEqual({ nights: 0, hours: null, quality: null })
  })
})

describe('sleepDebt', () => {
  it('totals the shortfall over the logged nights', () => {
    const st = S([], [{ d: iso(1), h: 6 }, { d: iso(2), h: 7 }])
    expect(sleepDebt(st, 7, 8)).toEqual({ nights: 2, hours: 3 })
  })

  it('reports a surplus as a negative rather than hiding it at zero', () => {
    expect(sleepDebt(S([], [{ d: iso(1), h: 9 }]), 7, 8).hours).toBe(-1)
  })

  it('has nothing to say without a target or without nights', () => {
    expect(sleepDebt(S([], [{ d: iso(1), h: 7 }]), 7, null)).toBe(null)
    expect(sleepDebt(S(), 7, 8)).toBe(null)
  })
})

describe('sleepFor / lastSleep / sleepSeries', () => {
  it('reads a night, the latest one, and the curve', () => {
    const st = S([], [{ d: iso(3), h: 6.5 }, { d: iso(1), h: 7.5 }])
    expect(sleepFor(st, iso(3)).h).toBe(6.5)
    expect(sleepFor(st, iso(9))).toBe(null)
    expect(lastSleep(st).h).toBe(7.5)
    expect(sleepSeries(st, 7).map(p => p.y)).toEqual([6.5, 7.5])
  })

  it('reads a profile that has never logged a night', () => {
    expect(sleepFor({}, iso(0))).toBe(null)
    expect(lastSleep({})).toBe(null)
    expect(sleepSeries({}, 7)).toEqual([])
  })
})
