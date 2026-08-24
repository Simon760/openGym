import { describe, it, expect } from 'vitest'
import { parseProgram, extractJSON, dayIndex } from './plan-import.js'
import { EXIDX } from './exercises.js'

const prog = (routines, extra = {}) => ({ routines, ...extra })
const one = ex => prog([{ name: 'Push', exercises: [ex] }])
// The single exercise of a one-routine program, as it lands in the bundle.
const cfgOf = p => parseProgram(p).bundle.routines[0].ex[0]

describe('dayIndex', () => {
  it('reads a weekday however the program spells it', () => {
    expect(dayIndex('monday')).toBe(1)
    expect(dayIndex('Mon')).toBe(1)
    expect(dayIndex('lundi')).toBe(1)
    expect(dayIndex('1')).toBe(1)
    expect(dayIndex(1)).toBe(1)
    expect(dayIndex('sunday')).toBe(0)
    expect(dayIndex('samedi')).toBe(6)
  })

  it('reads an accented day written without its accents', () => {
    // a program typed on a keyboard that did not cooperate
    expect(dayIndex('Mercredi')).toBe(3)
    expect(dayIndex('MERCREDI')).toBe(3)
  })

  it('rejects what is not a day', () => {
    expect(dayIndex('someday')).toBe(null)
    expect(dayIndex('7')).toBe(null)
    expect(dayIndex(null)).toBe(null)
  })
})

describe('extractJSON', () => {
  it('finds the program inside a reply that surrounds it', () => {
    const reply = 'Voici ton programme :\n\n```json\n{"routines":[{"name":"A"}]}\n```\n\nDis-moi si ça te va.'
    expect(extractJSON(reply)).toEqual({ routines: [{ name: 'A' }] })
  })

  it('does not stop at a nested closing brace', () => {
    expect(extractJSON('x {"a":{"b":1},"c":2} y')).toEqual({ a: { b: 1 }, c: 2 })
  })

  it('is not fooled by a brace inside a string', () => {
    expect(extractJSON('{"n":"a } b","c":1}')).toEqual({ n: 'a } b', c: 1 })
  })

  it('says so when there is nothing to read', () => {
    expect(() => extractJSON('no json here')).toThrow()
    expect(() => extractJSON('{"routines": [')).toThrow()
  })
})

describe('parseProgram — resolving names', () => {
  it('resolves a name to the catalogue exercise it means', () => {
    const { bundle, report } = parseProgram(one({ name: 'Bench Press', sets: 4, reps: 8, weight: 75 }))
    expect(bundle.routines[0].ex[0].id).toBe('0025')
    expect(EXIDX['0025'].n).toBe('barbell bench press')
    expect(report.matched).toEqual([{ from: 'Bench Press', to: 'barbell bench press', id: '0025' }])
    expect(report.created).toEqual([])
    expect(bundle.customEx).toEqual([])
  })

  it('resolves a name written with its equipment in brackets', () => {
    expect(cfgOf(one({ name: 'Squat (Barbell)' })).id).toBe('0043')
  })

  it('keeps an unrecognised name as a custom exercise instead of dropping it', () => {
    const { bundle, report } = parseProgram(one({ name: 'Coach special press', bodyPart: 'chest' }))
    expect(bundle.customEx).toHaveLength(1)
    expect(bundle.customEx[0]).toMatchObject({ n: 'Coach special press', bp: 'chest' })
    // the routine still points at it, in place
    expect(bundle.routines[0].ex[0].id).toBe(bundle.customEx[0].id)
    expect(report.created).toEqual([{ name: 'Coach special press', bp: 'chest' }])
  })

  it('files an invented exercise under a body part it understands', () => {
    // "quads" is exporter vocabulary, "upper legs" is the dataset's
    expect(parseProgram(one({ name: 'Zzz lift', bodyPart: 'quads' })).bundle.customEx[0].bp).toBe('upper legs')
    expect(parseProgram(one({ name: 'Zzz lift', bodyPart: 'upper legs' })).bundle.customEx[0].bp).toBe('upper legs')
    expect(parseProgram(one({ name: 'Zzz lift', bodyPart: 'nonsense' })).bundle.customEx[0].bp).toBeTruthy()
  })

  it('accepts an exercise given as a bare string', () => {
    const { bundle } = parseProgram(prog([{ name: 'Push', exercises: ['Bench Press'] }]))
    expect(bundle.routines[0].ex[0]).toMatchObject({ id: '0025', sets: 3, reps: 10 })
  })
})

describe('parseProgram — how an exercise is logged', () => {
  it('reads a hold from its seconds, without being told it is timed', () => {
    expect(cfgOf(one({ name: 'Plank', sets: 3, seconds: 45 }))).toMatchObject({ mode: 'time', sec: 45, sets: 3 })
  })

  it('reads cardio from minutes and speed', () => {
    expect(cfgOf(one({ name: 'Treadmill running', minutes: 25, speed: 10 })))
      .toMatchObject({ mode: 'cardio', min: 25, speed: 10 })
  })

  it('defaults to reps, and to a sane scheme when the program omits one', () => {
    expect(cfgOf(one({ name: 'Bench Press' }))).toMatchObject({ mode: 'reps', sets: 3, reps: 10 })
  })

  it('carries a rep range only when both ends are there', () => {
    expect(cfgOf(one({ name: 'Bench Press', repsMin: 8, repsMax: 12 }))).toMatchObject({ repsMin: 8, repsMax: 12 })
    const half = cfgOf(one({ name: 'Bench Press', repsMin: 8 }))
    expect('repsMin' in half).toBe(false)
  })

  it('keeps a progression rule it knows and reports one it does not', () => {
    expect(cfgOf(one({ name: 'Bench Press', progression: 'greyskull' })).prog).toBe('greyskull')
    const { bundle, report } = parseProgram(one({ name: 'Bench Press', progression: 'wave loading' }))
    expect('prog' in bundle.routines[0].ex[0]).toBe(false)
    expect(report.warnings).toHaveLength(1)
  })

  it('marks unilateral work and supersets', () => {
    expect(cfgOf(one({ name: 'Bench Press', perSide: true })).side).toBe(true)
    expect(cfgOf(one({ name: 'Bench Press', superset: 'A' })).sg).toBe('A')
    // a hold has no reps to split, so per-side does not apply to it
    expect('side' in cfgOf(one({ name: 'Plank', seconds: 45, perSide: true }))).toBe(false)
  })

  it('accepts the French field names a French conversation writes', () => {
    expect(cfgOf(prog([{ nom: 'Poussée', exercices: [{ nom: 'Bench Press', séries: 4, poids: 80 }] }])))
      .toMatchObject({ id: '0025', sets: 4, weight: 80 })
  })
})

describe('parseProgram — the week', () => {
  it('schedules routines named by the week block', () => {
    const { bundle } = parseProgram(prog(
      [{ name: 'Push', exercises: ['Bench Press'] }, { name: 'Legs', exercises: ['Squat'] }],
      { week: { monday: 'Push', friday: 'Legs' } }
    ))
    expect(bundle.week[1]).toBe(bundle.routines[0].id)
    expect(bundle.week[5]).toBe(bundle.routines[1].id)
    expect(bundle.scheduledDays).toBe(2)
  })

  it('schedules a routine that names its own day instead', () => {
    const { bundle } = parseProgram(prog([{ name: 'Push', day: 'mardi', exercises: ['Bench Press'] }]))
    expect(bundle.week[2]).toBe(bundle.routines[0].id)
  })

  it('leaves rest days out rather than pointing them at nothing', () => {
    const { bundle, report } = parseProgram(prog(
      [{ name: 'Push', exercises: ['Bench Press'] }],
      { week: { monday: 'Push', tuesday: 'Rest', wednesday: 'repos' } }
    ))
    expect(Object.keys(bundle.week)).toEqual(['1'])
    expect(report.warnings).toEqual([])
  })

  it('reports a week pointing at a routine that is not in the program', () => {
    const { bundle, report } = parseProgram(prog(
      [{ name: 'Push', exercises: ['Bench Press'] }],
      { week: { monday: 'Pull' } }
    ))
    expect(bundle.week).toEqual({})
    expect(report.warnings).toHaveLength(1)
  })
})

describe('parseProgram — what it refuses', () => {
  it('refuses a program with no routines', () => {
    expect(() => parseProgram({ name: 'Empty' })).toThrow()
    expect(() => parseProgram({ routines: [] })).toThrow()
  })

  it('refuses a program whose routines are all empty', () => {
    expect(() => parseProgram(prog([{ name: 'Push', exercises: [] }]))).toThrow()
  })

  it('keeps the routines it can read when one is unusable', () => {
    const { bundle } = parseProgram(prog([
      { name: 'Push', exercises: ['Bench Press'] },
      { name: 'Broken', exercises: [{}] }
    ]))
    expect(bundle.routineCount).toBe(1)
    expect(bundle.routines[0].name).toBe('Push')
  })

  it('names a routine that did not name itself', () => {
    expect(parseProgram(prog([{ exercises: ['Bench Press'] }])).bundle.routines[0].name).toBeTruthy()
  })
})

describe('parseProgram — the bundle it hands to mergePlan', () => {
  it('counts what it produced and gives every routine its own id', () => {
    const { bundle } = parseProgram(prog([
      { name: 'Push', exercises: ['Bench Press', 'Overhead Press'] },
      { name: 'Legs', exercises: ['Squat'] }
    ]))
    expect(bundle.routineCount).toBe(2)
    expect(bundle.exerciseCount).toBe(3)
    expect(bundle.dropped).toBe(0)
    expect(new Set(bundle.routines.map(r => r.id)).size).toBe(2)
  })

  it('parses the same program from a chat reply as from an object', () => {
    const obj = prog([{ name: 'Push', exercises: ['Bench Press'] }], { name: 'Bloc 1' })
    const fromText = parseProgram('Voici :\n```json\n' + JSON.stringify(obj) + '\n```\nBon courage !')
    expect(fromText.bundle.name).toBe('Bloc 1')
    expect(fromText.bundle.exerciseCount).toBe(1)
  })
})
