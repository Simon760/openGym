import { describe, it, expect } from 'vitest'
import { parseHealthCSV, applyHealthDays } from './health.js'

import { deficitTotals } from './energy.js'

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
