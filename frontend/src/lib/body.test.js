import { describe, it, expect } from 'vitest'
import {
  validBodyFat, lastComposition, composition, compositionTrend, bodyFatSeries,
  validSleep, sleepFor, lastSleep, putSleep, sleepAverage, sleepDebt, sleepSeries,
  hoursBetween, sleepHours, validTime,
  BF_MIN, BF_MAX, SLEEP_MIN, SLEEP_MAX, whenOf, dayTime, sinceStart } from './body.js'
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

describe('hoursBetween', () => {
  it('crosses midnight the way a night does', () => {
    expect(hoursBetween('23:30', '07:00')).toBe(7.5)
    expect(hoursBetween('00:30', '07:00')).toBe(6.5)
    expect(hoursBetween('22:00', '06:15')).toBe(8.25)
  })

  it('reads a same-hour pair as a full day rather than nothing', () => {
    // nobody logs a night of zero length; they mistyped, and a silent 0 hides that
    expect(hoursBetween('23:00', '23:00')).toBe(24)
  })

  it('refuses what is not a clock time', () => {
    expect(hoursBetween('25:00', '07:00')).toBe(null)
    expect(hoursBetween('23:00', '')).toBe(null)
    expect(validTime('7:00')).toBe('7:00')
    expect(validTime('24:00')).toBe(null)
  })
})

describe('sleepHours', () => {
  it('takes the time awake out of the time in bed', () => {
    expect(sleepHours({ bed: '23:00', wake: '07:00' })).toBe(8)
    expect(sleepHours({ bed: '23:00', wake: '07:00', awake: 45 })).toBe(7.25)
  })

  it('cannot be talked below zero by an absurd waking', () => {
    expect(sleepHours({ bed: '23:00', wake: '07:00', awake: 10000 })).toBe(null)
  })

  it('still reads an entry written before the times existed', () => {
    // and a bare figure is what a watch import supplies
    expect(sleepHours({ h: 7.25 })).toBe(7.25)
    expect(sleepHours(null)).toBe(null)
  })
})

describe('putSleep with times', () => {
  it('stores the times and derives the hours from them', () => {
    const [e] = putSleep([], { d: '2026-08-20', bed: '23:30', wake: '07:00', awake: 30 })
    expect(e).toMatchObject({ d: '2026-08-20', bed: '23:30', wake: '07:00', awake: 30 })
    expect('h' in e).toBe(false)
    expect(sleepHours(e)).toBe(7)
  })

  it('drops a waking of zero rather than storing it', () => {
    expect('awake' in putSleep([], { d: '2026-08-20', bed: '23:00', wake: '07:00', awake: 0 })[0]).toBe(false)
  })

  it('refuses half a pair — one time is not a night', () => {
    expect(putSleep([], { d: '2026-08-20', bed: '23:00' })).toEqual([])
  })

  it('still accepts a bare figure, so a watch import lands unchanged', () => {
    expect(putSleep([], { d: '2026-08-20', h: 7.5 })[0]).toMatchObject({ h: 7.5 })
  })

  it('feeds the averages through the derived hours', () => {
    const st = { sleep: putSleep([], { d: isoOf(daysAgo(1)), bed: '23:00', wake: '06:00', awake: 30 }) }
    expect(sleepAverage(st, 7).hours).toBe(6.5)
  })
})

// The bug this fixes: an imported history stamps every row with the moment of the import,
// so a year of weigh-ins all landed on today — the curve collapsed to a vertical line and
// all three date labels on the axis read the same day.
describe('whenOf — where an entry sits on a time axis', () => {
  it('is the day the entry records, not the moment it was written', () => {
    const imported = { d: '2025-04-10', w: 86.2, t: Date.parse('2026-08-25T09:14:00Z') }
    expect(whenOf(imported)).toBe(dayTime('2025-04-10'))
    expect(new Date(whenOf(imported)).getMonth()).toBe(3)          // April, not August
  })

  it('separates two entries a whole import apart', () => {
    const t = Date.now()
    const a = { d: '2025-04-10', w: 86.2, t }, b = { d: '2025-08-11', w: 79.5, t }
    expect(whenOf(b) - whenOf(a)).toBeGreaterThan(120 * 86400000)
  })

  it('lands at noon, so a timezone cannot push a point into the day before', () => {
    expect(new Date(dayTime('2025-04-10')).getDate()).toBe(10)
    expect(new Date(dayTime('2025-04-10')).getHours()).toBe(12)
  })

  it('falls back to the written time when there is no day at all', () => {
    expect(whenOf({ t: 1234 })).toBe(1234)
    expect(whenOf(null)).toBe(0)
  })
})

describe('sinceStart — the whole journey', () => {
  const S = over => ({ bodyweight: [], ...over })

  it('measures the latest weigh-in against the very first', () => {
    // Not the delta beside the number, which compares one weigh-in to the one before it.
    // Six kilos across five months reads as nothing when it arrives 0.2 at a time.
    const j = sinceStart(S({ bodyweight: [
      { d: '2026-03-16', w: 86.2 }, { d: '2026-05-02', w: 82 }, { d: '2026-08-24', w: 79.5 }
    ] }))
    expect(j.kg).toBe(-6.7)
    expect(j.from.d).toBe('2026-03-16')
    expect(j.to.d).toBe('2026-08-24')
    expect(j.readings).toBe(3)
    expect(j.days).toBe(161)
  })

  it('reports a gain as a gain', () => {
    expect(sinceStart(S({ bodyweight: [{ d: '2026-01-01', w: 70 }, { d: '2026-06-01', w: 76.4 }] })).kg).toBe(6.4)
  })

  it('says nothing from a single reading — that is a measurement, not a journey', () => {
    expect(sinceStart(S({ bodyweight: [{ d: '2026-01-01', w: 80 }] }))).toBe(null)
    expect(sinceStart(S())).toBe(null)
    expect(sinceStart({})).toBe(null)
  })

  it('ignores an entry with no weight on it', () => {
    // a body-fat reading can ride alone on a day; it is not a weigh-in
    const j = sinceStart(S({ bodyweight: [
      { d: '2026-01-01', w: 80 }, { d: '2026-02-01', bf: 22 }, { d: '2026-03-01', w: 77 }
    ] }))
    expect(j.kg).toBe(-3)
    expect(j.readings).toBe(2)
  })
})
