import { describe, it, expect } from 'vitest'
import { periodsBetween, periodsOn, periodText, periodTag, putPeriod, removePeriod } from './periods.js'
import { dailyDigest, trainingDigest } from './digest.js'
import { sportExportRows, sportExportCSV } from './sport-export.js'
import { isoOf } from './format.js'

// A fortnight at another gym: different machines, so the loads dropped and meant nothing.
const GYM = { id: 'p1', from: '2026-10-02', to: '2026-10-15', label: 'Autre salle', note: 'Machines et résistances différentes : charges non comparables' }

describe('a note on a stretch of days', () => {
  it('covers its first and last day and nothing either side', () => {
    const S = { periods: [GYM] }
    expect(periodsOn(S, '2026-10-01')).toEqual([])
    expect(periodsOn(S, '2026-10-02')).toEqual([GYM])
    expect(periodsOn(S, '2026-10-15')).toEqual([GYM])
    expect(periodsOn(S, '2026-10-16')).toEqual([])
    expect(periodsBetween(S, '2026-09-20', '2026-10-03')).toEqual([GYM])
    expect(periodsBetween(S, '2026-10-16', '2026-10-30')).toEqual([])
  })

  it('reads as its label, then what it explains', () => {
    expect(periodText(GYM)).toBe('Autre salle — Machines et résistances différentes : charges non comparables')
    expect(periodText({ label: 'Blessure' })).toBe('Blessure')
    expect(periodTag({ periods: [GYM] }, '2026-10-05')).toBe('Autre salle')
    expect(periodTag({ periods: [GYM] }, '2026-10-20')).toBe('')
  })

  it('is stored the right way round, trimmed, and replaced by its id', () => {
    const one = putPeriod([], { id: 'a', from: '2026-10-15', to: '2026-10-02', label: '  Autre salle ', note: ' ' })
    expect(one).toEqual([{ id: 'a', from: '2026-10-02', to: '2026-10-15', label: 'Autre salle' }])
    const two = putPeriod(one, { id: 'a', from: '2026-10-02', to: '2026-10-16', label: 'Autre salle', note: 'Charges non comparables' })
    expect(two).toHaveLength(1)
    expect(two[0].to).toBe('2026-10-16')
    expect(removePeriod(two, 'a')).toEqual([])
  })

  it('is not stored without dates or a label', () => {
    expect(putPeriod([GYM], { id: 'b', from: '2026-10-02', to: '', label: 'X' })).toEqual([GYM])
    expect(putPeriod([GYM], { id: 'b', from: '2026-10-02', to: '2026-10-03', label: ' ' })).toEqual([GYM])
  })
})

// The digests and the export are what leave the app — the reason has to leave with them.
describe('carried into what leaves the app', () => {
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d }
  const iso = n => isoOf(daysAgo(n))
  const session = (n, w) => ({
    id: 'w' + n, d: iso(n), start: +daysAgo(n), end: +daysAgo(n) + 45 * 60000, name: 'Push', vol: w * 32,
    entries: [{ id: '0025', target: { id: '0025', sets: 4, reps: 8, weight: w, mode: 'reps' }, sets: [8, 8, 8, 8].map(r => ({ w, r, done: true })) }]
  })
  const S = {
    unit: 'kg', bodyweight: [], nutrition: [], routines: [], week: {}, dayPlan: {}, exWeights: {}, customEx: [], watchTrim: 0, health: [],
    workouts: [session(12, 80), session(5, 65), session(1, 80)],
    periods: [{ id: 'p', from: iso(8), to: iso(3), label: 'Autre salle', note: 'charges non comparables' }],
  }

  it('the training digest states the period and tags the sessions inside it', () => {
    const out = trainingDigest(S, 14)
    expect(out).toContain('Context')
    expect(out).toContain('Autre salle — charges non comparables')
    const lines = out.split('\n')
    const tagged = lines.filter(l => l.includes('[Autre salle]'))
    expect(tagged).toHaveLength(1)
    // the session at the usual gym either side is not tagged
    expect(lines.filter(l => / · Push/.test(l) && !l.includes('[')).length).toBe(2)
  })

  it('the training digest leaves out a period outside its window', () => {
    expect(trainingDigest(S, 2)).not.toContain('Autre salle')
  })

  it('the daily digest opens with the note on a day inside it', () => {
    expect(dailyDigest(S, iso(5)).split('\n')[1]).toBe('Context Autre salle — charges non comparables')
    expect(dailyDigest(S, iso(1))).not.toContain('Autre salle')
  })

  it('the CSV export carries it on each session inside it, and only there', () => {
    const rows = sportExportRows(S, iso(20), iso(0)).filter(r => r[0])
    expect(rows.map(r => r[6] || '')).toEqual(['', 'Autre salle — charges non comparables', ''])
    expect(sportExportCSV(S, iso(20), iso(0)).csv.split('\r\n')[0]).toContain('Contexte')
  })
})
