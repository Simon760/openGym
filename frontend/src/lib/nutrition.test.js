import { describe, it, expect } from 'vitest'
import {
  entryFor, lastEntry, hasMacros, kcalFromMacros, derivedMismatch, macroSplit,
  remainingOf, avgOver, seriesOf, putEntry, KCAL_PER_G, MISMATCH_TOL
} from './nutrition.js'
import { isoOf } from './format.js'

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const iso = n => isoOf(daysAgo(n))
// A day of intake. Anything omitted is simply not logged — which is the case the
// averages below have to keep separate from a logged zero.
const day = (n, e) => ({ d: iso(n), ...e })
const S = (...nutrition) => ({ nutrition })

describe('kcalFromMacros', () => {
  it('applies the Atwater factors', () => {
    expect(kcalFromMacros({ p: 150, c: 200, f: 60 })).toBe(150 * 4 + 200 * 4 + 60 * 9)
    expect(KCAL_PER_G).toEqual({ p: 4, c: 4, f: 9 })
  })

  it('counts what is there and ignores what is not', () => {
    expect(kcalFromMacros({ p: 100 })).toBe(400)
    expect(kcalFromMacros({})).toBe(0)
    expect(kcalFromMacros(null)).toBe(0)
    expect(kcalFromMacros({ p: -20, c: 'x', f: null })).toBe(0)
  })
})

describe('hasMacros', () => {
  it('separates a kcal-only log from one carrying macros', () => {
    expect(hasMacros({ kcal: 2000 })).toBe(false)
    expect(hasMacros({ kcal: 2000, p: 150 })).toBe(true)
    expect(hasMacros({ p: 0, c: 0, f: 0 })).toBe(false)
    expect(hasMacros(null)).toBe(false)
  })
})

describe('derivedMismatch', () => {
  it('says nothing when the macros back up the logged calories', () => {
    // 150p + 200c + 60f = 1940 kcal, logged as 2000 — under 10 %, so nothing to report
    expect(derivedMismatch({ kcal: 2000, p: 150, c: 200, f: 60 })).toBe(null)
  })

  it('reports the derived figure when the two disagree materially', () => {
    // a fat entry typed as 600 instead of 60 — the kind of slip this exists to catch
    expect(derivedMismatch({ kcal: 2000, p: 150, c: 200, f: 600 })).toBe(6800)
  })

  it('has nothing to compare when either side is missing', () => {
    expect(derivedMismatch({ kcal: 2000 })).toBe(null)
    expect(derivedMismatch({ p: 150, c: 200, f: 60 })).toBe(null)
    expect(derivedMismatch(null)).toBe(null)
  })

  it('draws the line just past the tolerance, not at it', () => {
    // 275 g protein is 1100 kcal — exactly 10 % above the 1000 logged. At the tolerance
    // is still agreement; a rounded label can land here honestly.
    expect(MISMATCH_TOL).toBe(0.1)
    expect(derivedMismatch({ kcal: 1000, p: 275 })).toBe(null)
    expect(derivedMismatch({ kcal: 1000, p: 276 })).toBe(1104)
  })
})

describe('macroSplit', () => {
  it('splits the macro calories into fractions that sum to one', () => {
    const s = macroSplit({ p: 100, c: 100, f: 100 })   // 400 / 400 / 900 = 1700
    expect(s.p).toBeCloseTo(400 / 1700)
    expect(s.c).toBeCloseTo(400 / 1700)
    expect(s.f).toBeCloseTo(900 / 1700)
    expect(s.p + s.c + s.f).toBeCloseTo(1)
  })

  it('splits against the macros, not the logged calories, so the bar always fills', () => {
    // 2 500 kcal logged but only 1 700 accounted for — the split still sums to 1 rather
    // than leaving 800 kcal of unexplained gap on screen
    const s = macroSplit({ kcal: 2500, p: 100, c: 100, f: 100 })
    expect(s.p + s.c + s.f).toBeCloseTo(1)
  })

  it('has no split without macros', () => {
    expect(macroSplit({ kcal: 2000 })).toBe(null)
    expect(macroSplit(null)).toBe(null)
  })
})

describe('remainingOf', () => {
  it('counts down each target the goal actually sets', () => {
    const r = remainingOf({ kcal: 1800, p: 120 }, { kcal: 2200, p: 160 })
    expect(r).toEqual({ kcal: 400, p: 40 })
  })

  it('reports going over as a negative rather than hiding it at zero', () => {
    expect(remainingOf({ kcal: 2500 }, { kcal: 2200 }).kcal).toBe(-300)
  })

  it('leaves out what the goal does not set', () => {
    expect(remainingOf({ kcal: 1800, p: 120 }, { kcal: 2200 })).toEqual({ kcal: 400 })
  })

  it('reads a day with nothing logged as the whole target still to go', () => {
    expect(remainingOf(null, { kcal: 2200 })).toEqual({ kcal: 2200 })
  })

  it('has nothing to say without a goal', () => {
    expect(remainingOf({ kcal: 1800 }, null)).toBe(null)
    expect(remainingOf({ kcal: 1800 }, {})).toBe(null)
  })
})

describe('avgOver', () => {
  it('averages over the days that logged, not over the length of the window', () => {
    // three days logged inside a seven-day window: the other four were never filled in
    // and must not drag the average down as though they were fasts
    const a = avgOver(S(day(1, { kcal: 2000 }), day(2, { kcal: 2200 }), day(3, { kcal: 1800 })), 7)
    expect(a.kcal).toBe(2000)
    expect(a.logged).toBe(3)
    expect(a.kcalDays).toBe(3)
  })

  it('averages each macro over the days that carried it', () => {
    // macros are optional on top of kcal — two protein days must not be spread over four
    const a = avgOver(S(
      day(1, { kcal: 2000, p: 150 }),
      day(2, { kcal: 2000, p: 170 }),
      day(3, { kcal: 2000 }),
      day(4, { kcal: 2000 })
    ), 7)
    expect(a.kcal).toBe(2000)
    expect(a.kcalDays).toBe(4)
    expect(a.p).toBe(160)
    expect(a.pDays).toBe(2)
  })

  it('drops days outside the window', () => {
    const a = avgOver(S(day(2, { kcal: 2000 }), day(40, { kcal: 3000 })), 7)
    expect(a.kcal).toBe(2000)
    expect(a.logged).toBe(1)
  })

  it('takes everything when the window is 0', () => {
    expect(avgOver(S(day(2, { kcal: 2000 }), day(400, { kcal: 3000 })), 0).logged).toBe(2)
  })

  it('reports null rather than a number it cannot back', () => {
    const a = avgOver(S(), 7)
    expect(a.kcal).toBe(null)
    expect(a.p).toBe(null)
    expect(a.logged).toBe(0)
  })
})

describe('seriesOf', () => {
  it('keeps only days with calories, oldest first', () => {
    const pts = seriesOf(S(day(3, { kcal: 1800 }), day(2, { p: 150 }), day(1, { kcal: 2000 })), 7)
    expect(pts.map(p => p.y)).toEqual([1800, 2000])
    expect(pts[0].t).toBeLessThan(pts[1].t)
  })
})

describe('putEntry', () => {
  it('adds a day and keeps the list sorted', () => {
    const list = putEntry(putEntry([], { d: '2026-08-20', kcal: 2000 }), { d: '2026-08-18', kcal: 1900 })
    expect(list.map(e => e.d)).toEqual(['2026-08-18', '2026-08-20'])
  })

  it('replaces the day rather than adding a second entry for it', () => {
    const list = putEntry([{ d: '2026-08-20', kcal: 2000 }], { d: '2026-08-20', kcal: 2400 })
    expect(list).toHaveLength(1)
    expect(list[0].kcal).toBe(2400)
  })

  it('keeps only the fields that carry a number', () => {
    const [e] = putEntry([], { d: '2026-08-20', kcal: 2000, p: 150, c: 0, f: null })
    expect(e).toMatchObject({ d: '2026-08-20', kcal: 2000, p: 150 })
    expect('c' in e).toBe(false)
    expect('f' in e).toBe(false)
  })

  it('removes the day when everything is cleared, so a mistake can be undone', () => {
    expect(putEntry([{ d: '2026-08-20', kcal: 2000 }], { d: '2026-08-20', kcal: 0 })).toEqual([])
  })
})

describe('entryFor / lastEntry', () => {
  it('finds a day and the latest one', () => {
    const st = S(day(3, { kcal: 1800 }), day(1, { kcal: 2000 }))
    expect(entryFor(st, iso(3)).kcal).toBe(1800)
    expect(entryFor(st, iso(9))).toBe(null)
    expect(lastEntry(st).kcal).toBe(2000)
  })

  it('reads a profile that has never logged intake', () => {
    expect(entryFor({}, iso(0))).toBe(null)
    expect(lastEntry({})).toBe(null)
  })
})
