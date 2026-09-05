import { describe, it, expect } from 'vitest'
import { isRefeed, goalFor, remainingOf, putEntry } from './nutrition.js'
import { dayBalance, projectedWeight, KCAL_PER_KG_FAT } from './energy.js'
import { dailyDigest } from './digest.js'
import { fmtNum } from './format.js'

const TD = { bmr: 1723, neat: 270, other: 80, sport: 230, stepBase: 9000 }
const GOAL = { kcal: 1900, p: 160 }
const day = n => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10)

// "Ça change rien dans le calcul du déficit bien évidemment, c'est juste informatif."
// That is the contract, so it gets tested before anything cosmetic.
describe('a day eaten at maintenance on purpose', () => {
  const S = refeed => ({
    tdee: TD, watchTrim: 0, nutriGoal: GOAL, workouts: [], health: [], sleep: [],
    bodyweight: [{ d: day(0), w: 79 }],
    nutrition: [{ d: day(0), kcal: 2400, ...(refeed ? { refeed: true } : {}) }]
  })
  const NOW = Date.UTC(2026, 0, 1, 20)

  it('changes nothing about the deficit, the balance or the projection', () => {
    const plain = dayBalance(S(false), day(0), TD, undefined, NOW)
    const marked = dayBalance(S(true), day(0), TD, undefined, NOW)
    expect(marked).toEqual(plain)
    expect(marked.deficit).toBe(plain.deficit)
    expect(projectedWeight(S(true), TD, NOW)).toEqual(projectedWeight(S(false), TD, NOW))
    // and it is still a surplus day if that is what it was — the flag hides nothing real
    expect(marked.deficit).toBeLessThan(0)
  })

  it('moves the day’s calorie target up to what the day actually spent', () => {
    const e = { d: day(0), kcal: 2400, refeed: true }
    const out = dayBalance(S(true), day(0), TD, undefined, NOW).out
    const g = goalFor(GOAL, e, out)
    expect(g.kcal).toBe(Math.round(out))           // 2 303 here: bmr + neat + other, no session
    expect(g.p).toBe(160)                          // macro targets are untouched
    // 2 400 is 500 over a 1 900 cut target and 97 over what the day actually spent. Both are
    // true; only the second is the one to act on when the day was for eating at maintenance.
    expect(remainingOf(e, GOAL).kcal).toBe(-500)
    expect(remainingOf(e, g).kcal).toBe(Math.round(out) - 2400)
    expect(Math.abs(remainingOf(e, g).kcal)).toBeLessThan(150)
  })

  it('reads as square when the day was actually eaten at maintenance', () => {
    const out = dayBalance(S(true), day(0), TD, undefined, NOW).out
    const e = { d: day(0), kcal: Math.round(out), refeed: true }
    expect(remainingOf(e, goalFor(GOAL, e, out)).kcal).toBe(0)
  })

  it('leaves an ordinary day exactly as it was', () => {
    const e = { d: day(0), kcal: 2400 }
    expect(isRefeed(e)).toBe(false)
    expect(goalFor(GOAL, e, 2500)).toBe(GOAL)
    expect(remainingOf(e, goalFor(GOAL, e, 2500)).kcal).toBe(-500)
  })

  it('drops the calorie target rather than leave one nobody is held to', () => {
    // no maintenance figure to raise it to — reporting "over" would be the one thing the
    // flag exists to stop
    const g = goalFor(GOAL, { refeed: true }, 0)
    expect(g.kcal).toBeUndefined()
    expect(g.p).toBe(160)
    expect(goalFor(null, { refeed: true }, 2500)).toEqual({ kcal: 2500 })
    expect(goalFor(null, { refeed: true }, 0)).toBe(null)
  })

  it('survives being written and read back', () => {
    const list = putEntry([], { d: day(0), kcal: 2400, refeed: true })
    expect(list[0].refeed).toBe(true)
    expect(putEntry([], { d: day(0), kcal: 2400 })[0].refeed).toBeUndefined()
    // and a flag alone never conjures a day into existence
    expect(putEntry([], { d: day(0), refeed: true })).toEqual([])
  })
})

describe('what the coach is handed', () => {
  const NOW2 = Date.UTC(2026, 0, 1, 20)
  const st = refeed => ({
    tdee: TD, watchTrim: 0, nutriGoal: GOAL, lang: 'en',
    routines: [], week: {}, workouts: [], health: [], sleep: [], bodyweight: [{ d: day(0), w: 79 }],
    nutrition: [{ d: day(0), kcal: 2400, ...(refeed ? { refeed: true } : {}) }]
  })

  it('says so in parentheses, and judges the day against maintenance', () => {
    const intake = S => dailyDigest(S, day(0), NOW2).split('\n').find(l => /Intake/.test(l))
    const spend = dayBalance(st(true), day(0), TD, undefined, NOW2).out
    const line = intake(st(true))
    expect(line).toContain('(maintenance day)')
    expect(line).toContain(fmtNum(spend))                 // judged against the day's own spend
    expect(line).not.toContain(fmtNum(GOAL.kcal))         // not against the cut target
    const plain = intake(st(false))
    expect(plain).toContain(fmtNum(GOAL.kcal))
    expect(plain).not.toContain('maintenance day')
  })

  it('reports the same balance either way', () => {
    const bal = d => d.split('\n').find(l => /Balance/.test(l))
    expect(bal(dailyDigest(st(true), day(0), NOW2))).toBe(bal(dailyDigest(st(false), day(0), NOW2)))
  })
})
