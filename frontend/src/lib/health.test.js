import { describe, it, expect } from 'vitest'
import { parseHealth, applyHealth, putHealth, healthFor } from './health.js'
import { todayISO } from './format.js'

const base = (over = {}) => ({
  unit: 'kg', workouts: [], bodyweight: [], sleep: [], health: [], nutrition: [], ...over
})
const D = '2026-08-24'

describe('parseHealth', () => {
  it('reads a payload the Shortcut produced', () => {
    const p = parseHealth({
      opengym_health: 1, date: D, steps: 9420, active_kcal: 620, sleep_hours: 7.25,
      workout: { minutes: 52, kcal: 430, hr_avg: 128, hr_max: 165, distance_km: 0 }
    })
    expect(p).toMatchObject({ d: D, steps: 9420, kcal: 620, sleepHours: 7.25 })
    expect(p.workout).toMatchObject({ minutes: 52, kcal: 430, hrAvg: 128, hrMax: 165 })
    // a zero distance is not a distance — a strength session covers no ground
    expect('km' in p.workout).toBe(false)
  })

  it('finds the payload inside text, the way a clipboard hands it over', () => {
    expect(parseHealth('Health export:\n{"steps": 8000}\ndone').steps).toBe(8000)
  })

  it('accepts the field names a Shortcut ends up producing', () => {
    expect(parseHealth({ stepCount: 5000, activeEnergy: 300, sleepHours: 8 }))
      .toMatchObject({ steps: 5000, kcal: 300, sleepHours: 8 })
  })

  it('falls back to today when the payload gives no date', () => {
    expect(parseHealth({ steps: 100 }).d).toBe(todayISO())
    expect(parseHealth({ date: 'not a date', steps: 100 }).d).toBe(todayISO())
  })

  it('drops a field it cannot believe rather than charting it', () => {
    // 26 hours is not a night; 0 steps is an unmeasured day, not a motionless one
    const p = parseHealth({ steps: 0, sleep_hours: 26, body_fat: 300, resting_hr: 54 })
    expect('steps' in p).toBe(false)
    expect('sleepHours' in p).toBe(false)
    expect('bodyFat' in p).toBe(false)
    expect(p.rhr).toBe(54)
  })

  it('refuses a payload that would import nothing', () => {
    expect(() => parseHealth({ date: D })).toThrow()
    expect(() => parseHealth({})).toThrow()
    expect(() => parseHealth('no json here')).toThrow()
  })
})

describe('applyHealth', () => {
  it('annotates the session already logged that day instead of adding one', () => {
    // two records of one training session must stay one session, or every count doubles
    const S = base({ workouts: [{ id: 'w1', d: D, name: 'Push Day', entries: [] }] })
    const r = applyHealth(S, parseHealth({ date: D, workout: { minutes: 52, kcal: 430 } }))
    expect(S.workouts).toHaveLength(1)
    expect(S.workouts[0].watch).toEqual({ minutes: 52, kcal: 430 })
    expect(r.wrote.join(' ')).toContain('Push Day')
  })

  it('says so when there is no session to attach the watch figures to', () => {
    const S = base()
    const r = applyHealth(S, parseHealth({ date: D, workout: { minutes: 52 } }))
    expect(S.workouts).toHaveLength(0)
    expect(r.skipped).toHaveLength(1)
  })

  it('keeps the daily figures even when the session part has nowhere to go', () => {
    const S = base()
    applyHealth(S, parseHealth({ date: D, steps: 9000, workout: { minutes: 52 } }))
    expect(healthFor(S, D).steps).toBe(9000)
  })

  it('merges with watch figures already there rather than replacing them', () => {
    const S = base({ workouts: [{ id: 'w1', d: D, name: 'Push', entries: [], watch: { minutes: 52 } }] })
    applyHealth(S, parseHealth({ date: D, workout: { kcal: 430 } }))
    expect(S.workouts[0].watch).toEqual({ minutes: 52, kcal: 430 })
  })

  it('writes sleep through the same door the sleep sheet uses', () => {
    const S = base()
    applyHealth(S, parseHealth({ date: D, sleep_hours: 7.5 }))
    expect(S.sleep).toEqual([{ d: D, h: 7.5, t: expect.any(Number) }])
  })

  it('replaces a day rather than stacking entries for it', () => {
    const S = base()
    applyHealth(S, parseHealth({ date: D, steps: 5000 }))
    applyHealth(S, parseHealth({ date: D, steps: 9000 }))
    expect(S.health).toHaveLength(1)
    expect(S.health[0].steps).toBe(9000)
  })

  it('writes a weigh-in, and the percentage onto it', () => {
    const S = base()
    applyHealth(S, parseHealth({ date: D, weight_kg: 78.4, body_fat: 18.6 }))
    expect(S.bodyweight[0]).toMatchObject({ d: D, w: 78.4, bf: 18.6 })
  })

  it('adds a percentage to a weigh-in that day already had', () => {
    const S = base({ bodyweight: [{ d: D, w: 78.4 }] })
    applyHealth(S, parseHealth({ date: D, body_fat: 18.6 }))
    expect(S.bodyweight).toHaveLength(1)
    expect(S.bodyweight[0].bf).toBe(18.6)
  })

  it('drops a lone percentage with no weigh-in to sit on', () => {
    // composition is a pair; half of it charts nothing and inventing a weight is worse
    const S = base()
    const r = applyHealth(S, parseHealth({ date: D, body_fat: 18.6 }))
    expect(S.bodyweight).toHaveLength(0)
    expect(r.skipped).toHaveLength(1)
  })
})

describe('putHealth', () => {
  it('keeps the list sorted and drops an entry with no figures', () => {
    const l = putHealth(putHealth([], { d: '2026-08-20', steps: 1 }), { d: '2026-08-18', steps: 2 })
    expect(l.map(e => e.d)).toEqual(['2026-08-18', '2026-08-20'])
    expect(putHealth([{ d: D, steps: 1 }], { d: D })).toEqual([])
  })
})
