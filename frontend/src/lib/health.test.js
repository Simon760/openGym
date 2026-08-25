import { describe, it, expect } from 'vitest'
import { parseHealth, applyHealth, putHealth, healthFor, parseHealthCSV, applyHealthDays } from './health.js'
import { entryFor } from './nutrition.js'
import { sleepHours } from './body.js'
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

describe('parseHealthCSV — a tracker export', () => {
  it('reads a Whoop-shaped sleep export', () => {
    const csv = [
      'Cycle start time,Sleep onset,Wake onset,Asleep duration (min),Awake duration (min),Resting heart rate (bpm)',
      '2026-08-22,2026-08-21 23:14:00,2026-08-22 07:02:00,432,26,52',
      '2026-08-23,2026-08-22 23:40:00,2026-08-23 06:55:00,401,18,54'
    ].join('\n')
    const { payloads, matched } = parseHealthCSV(csv)
    expect(payloads).toHaveLength(2)
    expect(payloads[0]).toMatchObject({ d: '2026-08-22', bed: '23:14', wake: '07:02', awake: 26, rhr: 52 })
    expect(matched.map(m => m.field)).toContain('bed')
  })

  it('reads a Fitbit-shaped daily export', () => {
    const csv = [
      'Date,Steps,Calories Burned,Minutes Asleep,Weight',
      '2026-08-22,9420,2480,438,78.4',
      '2026-08-23,7110,2310,455,78.1'
    ].join('\n')
    const { payloads } = parseHealthCSV(csv)
    expect(payloads[0]).toMatchObject({ d: '2026-08-22', steps: 9420, kcal: 2480, weight: 78.4 })
    // 438 minutes, not 438 hours — most exports write minutes and reading them as hours
    // would file a day and a half of sleep
    expect(payloads[0].sleepHours).toBeCloseTo(7.3, 1)
  })

  it('reads a 12-hour clock', () => {
    const csv = 'Date,Bedtime,Wake time\n2026-08-22,11:14 PM,7:02 AM'
    expect(parseHealthCSV(csv).payloads[0]).toMatchObject({ bed: '23:14', wake: '07:02' })
  })

  it('prefers the two times over a duration when the file has both', () => {
    const csv = 'Date,Sleep start,Sleep end,Sleep duration\n2026-08-22,23:00,07:00,999'
    const p = parseHealthCSV(csv).payloads[0]
    expect(p.bed).toBe('23:00')
    expect('sleepHours' in p).toBe(false)
  })

  it('reports what it matched and what it ignored, so a wrong mapping is visible', () => {
    const csv = 'Date,Steps,Skin temperature,HRV\n2026-08-22,9000,33.1,64'
    const { matched, ignored } = parseHealthCSV(csv)
    expect(matched).toEqual([{ field: 'steps', column: 'Steps' }])
    expect(ignored).toEqual(['Skin temperature', 'HRV'])
  })

  it('catches a decimal comma rather than filing the wrong weight', () => {
    // "84,2" is two fields, and read in order it stores 84 kg. Nothing looks wrong
    // afterwards — the weight is plausible, the curve is just quietly off.
    expect(() => parseHealthCSV('Date,Poids\n2025-03-12,84,2')).toThrow(/decimal comma/)
    // a quoted value with a real comma in it is not that, and still gets through
    expect(parseHealthCSV('Date,Poids,Note\n2025-03-12,84.2,"matin, à jeun"').payloads[0].weight).toBe(84.2)
    // nor is a row that simply stops short of the last column
    expect(parseHealthCSV('Date,Poids,Masse grasse\n2025-03-12,84.2').payloads[0].weight).toBe(84.2)
  })

  it('refuses a file it cannot file rows from', () => {
    expect(() => parseHealthCSV('Steps,Calories\n9000,300')).toThrow()
    expect(() => parseHealthCSV('Date,Steps')).toThrow()
    expect(() => parseHealthCSV('Date,Steps\nnot a date,x')).toThrow()
  })

  it('drops a row that carries nothing but a date', () => {
    const csv = 'Date,Steps\n2026-08-22,9000\n2026-08-23,'
    expect(parseHealthCSV(csv).payloads).toHaveLength(1)
  })
})

describe('applyHealthDays', () => {
  it('writes a run of days and reports one line each', () => {
    const S = base()
    const { payloads } = parseHealthCSV(
      'Date,Steps,Sleep start,Sleep end\n2026-08-22,9000,23:00,07:00\n2026-08-23,8000,23:30,06:30')
    const r = applyHealthDays(S, payloads)
    expect(r.wrote).toHaveLength(2)
    expect(S.health).toHaveLength(2)
    expect(S.sleep).toHaveLength(2)
    expect(sleepHours(S.sleep[0])).toBe(8)
    expect(sleepHours(S.sleep[1])).toBe(7)
  })

  it('does not repeat the same reason once per day', () => {
    const S = base()
    const { payloads } = parseHealthCSV('Date,Body fat\n2026-08-22,18.6\n2026-08-23,18.4')
    expect(applyHealthDays(S, payloads).skipped).toHaveLength(1)
  })
})

describe('parseHealthCSV — a retroactive history', () => {
  it('reads the file format the app hands you to ask for', () => {
    const csv = [
      'Date,Weight,Body fat,Intake kcal,Protein,Carbs,Fat,Sport kcal,Steps',
      '2026-08-22,78.4,18.6,1940,155,180,62,480,9420',
      '2026-08-23,78.1,,2210,140,,,,7110'
    ].join('\n')
    const { payloads, ignored } = parseHealthCSV(csv)
    expect(ignored).toEqual([])
    expect(payloads[0]).toMatchObject({
      d: '2026-08-22', weight: 78.4, bodyFat: 18.6,
      intake: 1940, protein: 155, carbs: 180, fat: 62, kcal: 480, steps: 9420
    })
    // an empty cell is a day nobody recorded, not a day of none
    expect('bodyFat' in payloads[1]).toBe(false)
    expect('protein' in payloads[1]).toBe(true)
    expect('carbs' in payloads[1]).toBe(false)
  })

  it('tells the fat you ate from the fat you are made of', () => {
    // "Fat" and "Body fat" both end in the same three letters, and reading 62 g of dietary
    // fat as 62 % body fat would be the most confident wrong number the app could draw
    const { payloads } = parseHealthCSV('Date,Body fat,Fat\n2026-08-22,18.6,62')
    expect(payloads[0]).toMatchObject({ bodyFat: 18.6, fat: 62 })
    const pct = parseHealthCSV('Date,Fat %\n2026-08-22,18.6').payloads[0]
    expect(pct).toMatchObject({ bodyFat: 18.6 })
    expect('fat' in pct).toBe(false)
  })

  it('reads a file written in French, because the conversation that wrote it was', () => {
    const csv = 'Date,Poids,Masse grasse,Apports,Protéines,Glucides,Lipides,Pas\n2026-08-22,78.4,18.6,1940,155,180,62,9420'
    expect(parseHealthCSV(csv).payloads[0]).toMatchObject({
      weight: 78.4, bodyFat: 18.6, intake: 1940, protein: 155, carbs: 180, fat: 62, steps: 9420
    })
  })

  it('keeps eating apart from burning when a file carries both', () => {
    const { payloads } = parseHealthCSV('Date,Intake kcal,Calories burned\n2026-08-22,1940,480')
    expect(payloads[0]).toMatchObject({ intake: 1940, kcal: 480 })
  })
})

describe('applyHealthDays — an imported history', () => {
  it('writes the intake through the same door the nutrition sheet uses', () => {
    const S = base()
    const { payloads } = parseHealthCSV(
      'Date,Weight,Intake kcal,Protein\n2026-08-22,78.4,1940,155\n2026-08-23,78.1,2210,140')
    const r = applyHealthDays(S, payloads)
    expect(r.wrote).toHaveLength(2)
    expect(entryFor(S, '2026-08-22')).toMatchObject({ kcal: 1940, p: 155 })
    expect(S.bodyweight).toHaveLength(2)
  })

  it('merges into a day already logged rather than wiping what it does not carry', () => {
    // a history file with only the calories must not delete the macros already there
    const S = base({ nutrition: [{ d: D, kcal: 1800, p: 150, c: 170, f: 60 }] })
    applyHealthDays(S, parseHealthCSV(`Date,Intake kcal\n${D},1940`).payloads)
    expect(entryFor(S, D)).toMatchObject({ kcal: 1940, p: 150, c: 170, f: 60 })
  })
})
