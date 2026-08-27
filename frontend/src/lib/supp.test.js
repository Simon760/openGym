import { describe, it, expect } from 'vitest'
import { suppOn, suppName, tookOn, setTook, suppStreak, suppRate, answeredToday } from './supp.js'
import { hydrate } from './hydrate.js'

const D = n => new Date(Date.UTC(2026, 0, 20 - n)).toISOString().slice(0, 10)
const NOW = Date.UTC(2026, 0, 20, 19)          // the 20th, evening
const S = supp => ({ supp: supp || {}, nutrition: [], routines: [], workouts: [], bodyweight: [], week: {}, dayPlan: {} })

describe('whether to ask at all', () => {
  it('asks unless told not to', () => {
    expect(suppOn(S())).toBe(true)
    expect(suppOn({ ...S(), suppOn: false })).toBe(false)
    expect(suppOn({ ...S(), suppOn: true })).toBe(true)
  })
  it('has a name, and takes yours over it', () => {
    expect(suppName(S())).toBeTruthy()
    expect(suppName({ ...S(), suppName: '  Oméga 3 ' })).toBe('Oméga 3')
    expect(suppName({ ...S(), suppName: '   ' })).toBe(suppName(S()))   // blank is not a name
  })
})

describe('a day nobody answered is not a no', () => {
  it('reads absent as null, not false', () => {
    const s = S({ [D(1)]: 1, [D(2)]: 0 })
    expect(tookOn(s, D(1))).toBe(true)
    expect(tookOn(s, D(2))).toBe(false)
    expect(tookOn(s, D(3))).toBe(null)
  })

  it('records, changes and clears an answer', () => {
    const s = S()
    setTook(s, D(0), true)
    expect(tookOn(s, D(0))).toBe(true)
    setTook(s, D(0), false)
    expect(tookOn(s, D(0))).toBe(false)
    setTook(s, D(0), null)
    expect(tookOn(s, D(0))).toBe(null)
    expect(Object.keys(s.supp)).toHaveLength(0)
  })
})

describe('the streak', () => {
  it('counts consecutive days back from the last answered one', () => {
    const s = S({ [D(0)]: 1, [D(1)]: 1, [D(2)]: 1, [D(3)]: 0, [D(4)]: 1 })
    expect(suppStreak(s, NOW)).toBe(3)
  })

  it('does not break just because today has not been answered yet', () => {
    // At four in the afternoon an unanswered today is not a missed day, and a streak that
    // collapses every morning and mends every evening is useless when it is looked at.
    const s = S({ [D(1)]: 1, [D(2)]: 1, [D(3)]: 1 })
    expect(answeredToday(s, NOW)).toBe(false)
    expect(suppStreak(s, NOW)).toBe(3)
  })

  it('breaks on an explicit no, today included', () => {
    const s = S({ [D(0)]: 0, [D(1)]: 1, [D(2)]: 1 })
    expect(suppStreak(s, NOW)).toBe(0)
  })

  it('is zero with nothing recorded', () => {
    expect(suppStreak(S(), NOW)).toBe(0)
    expect(suppStreak({}, NOW)).toBe(0)
  })
})

describe('the rate, which is the thing a streak cannot tell you', () => {
  it('counts only the days that were answered', () => {
    // Ten answered days out of thirty, eight of them yes: 80 %, not 27 %.
    const supp = {}
    for (let i = 1; i <= 10; i++) supp[D(i)] = i <= 8 ? 1 : 0
    const r = suppRate(S(supp), 30, NOW)
    expect(r).toMatchObject({ taken: 8, answered: 10, pct: 80 })
  })

  it('says nothing rather than zero when nothing was answered', () => {
    expect(suppRate(S(), 30, NOW)).toBe(null)
  })
})

describe('the round trip through the database', () => {
  it('comes back as a dictionary, not as whatever the wire made of it', () => {
    const s = S({ [D(1)]: 1, [D(2)]: 0 })
    const back = hydrate(JSON.parse(JSON.stringify(s)))
    expect(tookOn(back, D(1))).toBe(true)
    expect(tookOn(back, D(2))).toBe(false)
    expect(suppStreak(back, NOW)).toBe(1)
  })
})
