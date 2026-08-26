import { describe, it, expect } from 'vitest'
import { parseHealthCSV, applyHealthDays } from './health.js'

import { deficitTotals, deficitSeries, dayBalance, sportKcal, tdeeParts, KCAL_PER_KG_FAT } from './energy.js'
import { hydrate } from './hydrate.js'
import { isoOf } from './format.js'

// 120 days, built the way a real log is ragged: some days full, some kcal-only, some with no
// training at all, some missed entirely.
const rows = ['Date,Apports kcal,Protéines,Glucides,Lipides,Sport kcal']
const start = Date.UTC(2026, 3, 1)
let full = 0, kcalOnly = 0, noSport = 0, missed = 0
for (let i = 0; i < 120; i++) {
  const d = new Date(start + i * 864e5).toISOString().slice(0, 10)
  if (i % 11 === 0) { missed++; continue }                       // nothing logged at all
  const kcal = 1800 + (i % 7) * 40
  const macros = i % 3 === 0 ? ',,,' : `,${150 + i % 9},${170 + i % 12},${55 + i % 6}`
  if (i % 3 === 0) kcalOnly++; else full++
  const sport = i % 4 === 0 ? '' : String(380 + (i % 5) * 30)     // rest days leave it empty
  if (i % 4 === 0) noSport++
  rows.push(`${d},${kcal}${macros},${sport}`)
}
const csv = rows.join('\n')

describe('a real history is ragged', () => {
  it('imports four months of it without inventing a single figure', () => {
    const { payloads, matched, ignored } = parseHealthCSV(csv)

    const S = { unit: 'kg', workouts: [], bodyweight: [], sleep: [], health: [], nutrition: [],
    tdee: { bmr: 1700, neat: 450, other: 0, sport: 350 }, watchTrim: 0.28 }
    const report = applyHealthDays(S, payloads)

    // every logged day landed
    expect(S.nutrition).toHaveLength(full + kcalOnly)
    // a kcal-only day has calories and no macros — not zeroed macros
    const kOnly = S.nutrition.find(n => n.p == null)
    expect(kOnly.kcal).toBeGreaterThan(0)
    expect(kOnly.p).toBeUndefined()
    // a full day has all four
    const fullDay = S.nutrition.find(n => n.p != null)
    expect(fullDay).toMatchObject({ kcal: expect.any(Number), p: expect.any(Number), c: expect.any(Number), f: expect.any(Number) })
    // training landed as training, and a rest day has no entry at all rather than a zero
    expect(S.health.length).toBe(full + kcalOnly - noSport)
    expect(S.health.every(h => h.sport > 0)).toBe(true)

    const tot = deficitTotals(S, S.tdee, 0, Date.UTC(2026, 8, 1))
    expect(tot.days).toBe(full + kcalOnly)
  })
})

/**
 * The identities the whole page rests on. Every one of these can break without a single
 * test failing anywhere else: a total that no longer equals the sum of its days, a chart
 * drawn from a different arithmetic than the figure above it, a re-import that doubles a
 * month. They are cheap to check and they are the ones that would quietly cost months.
 */
describe('the totals hold together', () => {
  const TDEE = { bmr: 1700, neat: 450, other: 150, sport: 0 }
  const NOW = Date.UTC(2026, 8, 1)
  const fresh = () => ({ unit: 'kg', workouts: [], bodyweight: [], sleep: [], health: [], nutrition: [],
    tdee: TDEE, watchTrim: 0.28 })
  const loaded = () => { const S = fresh(); applyHealthDays(S, parseHealthCSV(csv).payloads); return S }

  it('adds up: the total is the sum of the days it says it counted', () => {
    const S = loaded()
    const tot = deficitTotals(S, TDEE, 0, NOW)
    const days = S.nutrition.filter(e => e.kcal != null && e.d <= isoOf(new Date(NOW - 864e5)))
    const sum = days.reduce((a, e) => a + dayBalance(S, e.d, TDEE, 0.28, NOW).deficit, 0)
    expect(tot.days).toBe(days.length)
    expect(Math.abs(sum - tot.total)).toBeLessThanOrEqual(days.length)   // rounding, one kcal a day at most
    expect(tot.nutrition + tot.sportDelta + tot.bonus).toBe(tot.total)
    expect(tot.kg).toBeCloseTo(tot.total / KCAL_PER_KG_FAT, 2)
    expect(tot.perDay).toBe(Math.round(tot.total / tot.days))
  })

  it('draws the chart from the same arithmetic as the figure above it', () => {
    const S = loaded()
    const tot = deficitTotals(S, TDEE, 0, NOW)
    const pts = deficitSeries(S, TDEE, 0, NOW)
    expect(pts.length).toBe(tot.days)
    expect(Math.abs(pts.reduce((a, p) => a + p.y, 0) - tot.total)).toBeLessThanOrEqual(tot.days)
  })

  it('holds every day to its own identity: maintenance + (done − planned) − eaten', () => {
    const S = loaded()
    const p = tdeeParts(TDEE)
    S.nutrition.filter(e => e.kcal != null).forEach(e => {
      const b = dayBalance(S, e.d, TDEE, 0.28, NOW)
      const sp = sportKcal(S, e.d, 0.28, TDEE, NOW)
      expect(b.deficit, e.d).toBe(Math.round(b.tdee + (sp.kcal - p.sport) + b.bonus - b.intake))
    })
  })

  it('does not double a month when the same file is imported twice', () => {
    const S = loaded()
    const before = deficitTotals(S, TDEE, 0, NOW)
    applyHealthDays(S, parseHealthCSV(csv).payloads)
    expect(deficitTotals(S, TDEE, 0, NOW).total).toBe(before.total)
    expect(S.nutrition.length).toBe(before.days + S.nutrition.filter(e => e.d > isoOf(new Date(NOW - 864e5))).length)
  })

  it('reads the same total whichever order the rows arrive in', () => {
    const S = fresh(), T = fresh()
    const { payloads } = parseHealthCSV(csv)
    applyHealthDays(S, payloads)
    applyHealthDays(T, [...payloads].reverse())
    expect(deficitTotals(T, TDEE, 0, NOW).total).toBe(deficitTotals(S, TDEE, 0, NOW).total)
  })

  it('survives the round trip through the database', () => {
    // RTDB cannot hold an empty container and turns arrays into numbered objects; hydrate
    // puts the shapes back. A total that changes across that trip is a total nobody can rely on.
    const S = loaded()
    const before = deficitTotals(S, TDEE, 0, NOW)
    const after = deficitTotals(hydrate(JSON.parse(JSON.stringify(S))), TDEE, 0, NOW)
    expect(after.total).toBe(before.total)
    expect(after.days).toBe(before.days)
  })
})
