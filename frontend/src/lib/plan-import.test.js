import { describe, it, expect } from 'vitest'
import { parseProgram, extractJSON, dayIndex, programFromCSV, guessBodyPart } from './plan-import.js'
import { parsePlan, buildPlanBundle } from './plan-share.js'
import { EXIDX } from './exercises.js'
import { musclesOf } from './muscles.js'

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
    expect(report.matched).toEqual([{ from: 'Bench Press', to: 'barbell bench press', id: '0025', how: 'alias', known: false }])
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
    expect(report.created).toEqual([{ name: 'Coach special press', id: bundle.customEx[0].id, bp: 'chest', muscles: { chest: 1 }, candidates: [] }])
  })

  it('reads minutes alone as cardio — a zone-2 ride names no pace', () => {
    // demanding a speed or a distance before believing it turned an hour on the bike into
    // a set of ten reps
    const e = parseProgram(one({ name: 'Stationary Bike', minutes: 60 })).bundle.routines[0].ex[0]
    expect(e).toMatchObject({ mode: 'cardio', min: 60 })
    expect('reps' in e).toBe(false)
  })

  it('stores a loaded rep range the way double progression reads it — top as reps, bottom as repsMin', () => {
    // Stored as reps 6 / repsMin 6 / repsMax 10, as it once was, the policy took 6 as the top
    // and the 10 was never asked for: the range collapsed into a fixed six. The first session
    // still starts at the bottom — nextPrescription sees to that.
    expect(parseProgram(one({ name: 'Cable Curl', repsMin: 6, repsMax: 10 })).bundle.routines[0].ex[0])
      .toMatchObject({ reps: 10, repsMin: 6, prog: 'double' })
    // a rule the programme names is kept, and a plain exercise still gets the default
    expect(parseProgram(one({ name: 'Cable Curl', repsMin: 6, repsMax: 10, progression: 'linear' })).bundle.routines[0].ex[0].prog).toBe('linear')
    expect(parseProgram(one({ name: 'Cable Curl' })).bundle.routines[0].ex[0].reps).toBe(10)
  })

  it('keeps a bodyweight range as the ceiling that turns "+1 rep" into "add a set"', () => {
    expect(parseProgram(one({ name: 'Push-up', repsMin: 10, repsMax: 20 })).bundle.routines[0].ex[0])
      .toMatchObject({ reps: 10, repsMax: 20 })
  })

  it('carries the muscles a program names, so a compound is not read as one muscle', () => {
    // "chest" alone would fatigue the chest and leave the triceps and shoulders reading as
    // fresh — which is exactly the reading a bench press must not produce
    const { bundle, report } = parseProgram(one({
      name: 'Coach special press', bodyPart: 'chest',
      target: 'pectorals', secondary: ['triceps', 'shoulders']
    }))
    expect(bundle.customEx[0]).toMatchObject({ tg: 'pectorals', sm: ['triceps', 'shoulders'] })
    // the same arithmetic the catalogue's own exercises get: target full, support at 0.4
    expect(report.created[0].muscles).toEqual({ chest: 1, triceps: 0.4, deltoids: 0.4 })
  })

  it('says which named muscle the body map cannot draw rather than dropping it quietly', () => {
    const { bundle, report } = parseProgram(one({
      name: 'Zzz carry', bodyPart: 'legs', target: 'quads', secondary: ['glutes', 'posterior chain']
    }))
    expect(bundle.customEx[0].sm).toEqual(['glutes'])
    expect(report.warnings.join(' ')).toContain('posterior chain')
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
    expect(cfgOf(one({ name: 'Bench Press', repsMin: 8, repsMax: 12 }))).toMatchObject({ reps: 12, repsMin: 8 })
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

// The plan file picker tries parsePlan and falls back to parseProgram, because both kinds of
// JSON reach it and to the person holding them both are "the file with my routines in it".
// The fallback is only sound while these two stay complementary — an export that parseProgram
// could also swallow would be rebuilt by name, losing the ids it already had.
describe('a plan file and a written program are different files', () => {
  const coach = prog([{ name: 'Bloc 4 — Push', exercises: ['Bench Press', 'Overhead Press'] }])

  it('refuses a coach program as a plan export, and reads it as a program', () => {
    expect(() => parsePlan(coach)).toThrow()
    expect(parseProgram(coach).bundle.routineCount).toBe(1)
  })

  it('reads a plan export as a plan, and never sends it through the name matcher', () => {
    const { bundle } = parseProgram(coach)
    // round-trip it the way the app does: import the program, then export the result
    const state = { routines: bundle.routines, customEx: bundle.customEx || [], week: {} }
    const exported = buildPlanBundle(state, 'Bloc 4')
    const back = parsePlan(exported)
    expect(back.routineCount).toBe(1)
    expect(back.exerciseCount).toBe(2)
    // ids survive, which is the whole reason the marker is tried first
    expect(back.routines[0].ex.map(e => e.id)).toEqual(bundle.routines[0].ex.map(e => e.id))
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

describe('parseProgram — French names and what you already train', () => {
  it('reads a programme written in French against the catalogue’s French names', () => {
    const { bundle, report } = parseProgram(prog([{ name: 'Push', exercises: [
      { name: 'Développé couché', sets: 4, reps: 8 },
      { name: 'Développé incliné haltères', sets: 3, reps: 10 },
      { name: 'Élévations latérales', sets: 3, reps: 15 }
    ] }]))
    expect(bundle.routines[0].ex.map(e => e.id)).toEqual(['0025', '0314', '0334'])
    expect(report.created).toEqual([])
  })

  it('settles an ambiguous name on the exercise this profile already trains', () => {
    // fourteen pulldowns say "tirage vertical"; the one with months of history is the one meant
    const used = new Map([['0198', 9]])
    const { bundle, report } = parseProgram(one({ name: 'Tirage vertical', sets: 3, reps: 10 }), { used })
    expect(bundle.routines[0].ex[0].id).toBe('0198')
    expect(report.matched[0]).toMatchObject({ how: 'used', known: true })
  })

  it('keeps the closest few catalogue entries for a name it cannot settle', () => {
    const { report } = parseProgram(one({ name: 'Hip thrust', sets: 3, reps: 10 }))
    expect(report.created).toHaveLength(1)
    expect(report.created[0].candidates.length).toBeGreaterThan(0)
  })

  it('files an unrecognised name by what its own words say, not in the legs by default', () => {
    // (A face pull used to be the example; the catalogue has one now, under its English name.)
    const { bundle } = parseProgram(one({ name: 'Rotation externe épaule à la bande', sets: 3, reps: 15 }))
    expect(bundle.customEx[0]).toMatchObject({ bp: 'shoulders', tg: 'delts' })
  })
})

describe('guessBodyPart', () => {
  it('reads French and English, specific before general', () => {
    expect(guessBodyPart('Hip thrust')).toEqual({ bp: 'upper legs', tg: 'glutes' })
    expect(guessBodyPart('Leg curl assis')).toEqual({ bp: 'upper legs', tg: 'hamstrings' })
    expect(guessBodyPart('Fentes bulgares')).toMatchObject({ bp: 'upper legs' })
    expect(guessBodyPart('Curl incliné')).toEqual({ bp: 'upper arms', tg: 'biceps' })
    expect(guessBodyPart('Extension triceps nuque')).toEqual({ bp: 'upper arms', tg: 'triceps' })
    expect(guessBodyPart('Développé militaire')).toEqual({ bp: 'shoulders', tg: 'delts' })
    expect(guessBodyPart('Rowing T-bar')).toMatchObject({ bp: 'back' })
    expect(guessBodyPart('Crunch poulie')).toEqual({ bp: 'waist', tg: 'abs' })
    expect(guessBodyPart('Mystère')).toBe(null)
  })
})

describe('programFromCSV', () => {
  const FR = [
    'Séance;Exercice;Séries;Reps;Poids (kg);Repos',
    'Push;Développé couché;4;8-10;80;2 min',
    ';Développé incliné haltères;3;10-12;30;90s',
    ';Élévations latérales;3;15;;60s',
    'Pull;Tirage vertical;4;10;65;',
    ';Rowing barre;3;8;70;',
    'Legs A;Squat;5;5;100;',
    ';Presse à cuisses;3;12-15;;',
    'Legs B;Soulevé de terre roumain;4;8;90;',
    ';Leg curl;3;12;;',
  ].join('\n')

  it('reads a French Excel export: semicolons, merged session cells, ranges', () => {
    const p = programFromCSV(FR)
    expect(p.routines.map(r => r.name)).toEqual(['Push', 'Pull', 'Legs A', 'Legs B'])
    expect(p.routines[0].exercises[0]).toMatchObject({ name: 'Développé couché', sets: 4, repsMin: 8, repsMax: 10, weight: 80 })
    expect(p.routines[0].exercises[2]).toMatchObject({ name: 'Élévations latérales', sets: 3, reps: 15 })
    expect(p.routines[3].exercises).toHaveLength(2)
  })

  it('goes all the way through parseProgram to a bundle', () => {
    const { bundle, report } = parseProgram(FR)
    expect(bundle.routineCount).toBe(4)
    expect(bundle.exerciseCount).toBe(9)
    expect(bundle.routines[0].ex[0]).toMatchObject({ id: '0025', sets: 4, reps: 10, repsMin: 8, prog: 'double', weight: 80 })
    expect(report.created).toEqual([])
  })

  it('reads sets×reps in one cell, holds, per-side work and bodyweight', () => {
    const p = programFromCSV([
      'Session,Exercise,Prescription,Load',
      'Upper,Bench press,4x6-8,85',
      'Upper,Plank,3x45s,',
      'Upper,Lunge,3 x 10 par jambe,PDC',
      'Upper,Dips,3x12,+10',
    ].join('\n'))
    const ex = p.routines[0].exercises
    expect(ex[0]).toMatchObject({ sets: 4, repsMin: 6, repsMax: 8, weight: 85 })
    expect(ex[1]).toMatchObject({ sets: 3, seconds: 45 })
    expect(ex[2]).toMatchObject({ sets: 3, reps: 10, perSide: true, bodyweight: true })
    expect(ex[3]).toMatchObject({ sets: 3, reps: 12, weight: 10, bodyweight: true })
  })

  it('takes a one-cell row as the title of the session below it', () => {
    const p = programFromCSV([
      'Exercice,Séries,Reps',
      'PUSH,,',
      'Développé couché,4,8',
      'PULL,,',
      'Tractions,4,6',
    ].join('\n'))
    expect(p.routines.map(r => r.name)).toEqual(['PUSH', 'PULL'])
  })

  it('reads a weekday column into the week, and a "Jour" column of weekdays as one', () => {
    const p = programFromCSV([
      'Jour,Séance,Exercice,Séries,Reps',
      'Lundi,Push,Développé couché,4,8',
      'Mercredi,Pull,Tractions,4,6',
    ].join('\n'))
    expect(p.week).toEqual({ 1: 'Push', 3: 'Pull' })
    const q = programFromCSV(['Jour,Exercice,Séries', 'Lundi,Squat,5', 'Jeudi,Squat,5'].join('\n'))
    expect(q.week).toEqual({ 1: 'Lundi', 4: 'Jeudi' })
  })

  it('pairs A1/A2 as a superset and leaves a lone letter alone', () => {
    const p = programFromCSV([
      'Ordre,Séance,Exercice,Séries,Reps',
      'A,Push,Développé couché,4,8',
      'B1,Push,Élévations latérales,3,15',
      'B2,Push,Extension triceps poulie,3,12',
    ].join('\n'))
    const ex = p.routines[0].exercises
    expect(ex[0].superset).toBeUndefined()
    expect(ex[1].superset).toBe('B')
    expect(ex[2].superset).toBe('B')
  })

  it('reads a Markdown table out of a conversation', () => {
    const p = programFromCSV([
      'Voici ton programme :',
      '| Séance | Exercice | Séries | Reps |',
      '|---|---|---|---|',
      '| Push | Développé couché | 4 | 8 |',
      '| Push | Dips | 3 | 10 |',
    ].join('\n'))
    expect(p.routines[0].exercises.map(e => e.name)).toEqual(['Développé couché', 'Dips'])
  })

  it('is null for a table without an exercise column', () => {
    expect(programFromCSV('Date,Poids\n2026-10-01,78')).toBe(null)
  })
})

// A coach's programme as it comes: rests per exercise, "/jbe", holds given as ranges, notes,
// and a joint routine at the end of every session.
describe('a coach’s programme, mobility routine included', () => {
  const CSV = [
    'Séance;Jour;Ordre;Exercice;Catégorie;Séries;Reps;Poids;Repos;Muscle ciblé;Progression;Consignes',
    'Legs A;Mardi;1;Leg curl;;4;8–12;;2–3 min;Ischios;;"RIR 1–2\nExcentrique freiné 3 s."',
    'Legs A;Mardi;2;RDL en B-stance;;3;8–10/jbe;;2 min;Ischios, Fessiers;;Jamais à l’échec.',
    'Legs A;Mardi;3;Kickback poulie;;3;12–15/jbe;;1–1,5 min;Fessiers;;Sangle à la cheville.',
    'Legs A;Mardi;4;Isométrie mollet lourde;;2;20–30 s;;2 min;Mollets;;',
    'Legs A;Mardi;;Genou au mur;Mobilité;2;10 par côté;PDC;0 s;;aucune;"Phase 1 : 2 × 10 par côté\nPhase 2 : 2 × 12"',
    'Legs A;Mardi;;Planche Copenhague;Mobilité;2;15 s par côté;PDC;;Adducteurs;aucune;Levier court.',
    'Push;Lundi;;Genou au mur;Mobilité;2;10 par côté;PDC;0 s;;aucune;"Phase 1 : 2 × 10 par côté\nPhase 2 : 2 × 12"',
  ].join('\n')
  const { bundle, report } = parseProgram(CSV)
  const legs = bundle.routines.find(r => r.name === 'Legs A').ex

  it('takes the rest the programme gives each exercise, at the low end of a range', () => {
    expect(legs.map(e => e.rest)).toEqual([120, 120, 60, 120, 0, undefined])
  })

  it('reads "/jbe" as per side and counts it the way the app does, as a total', () => {
    expect(legs[1]).toMatchObject({ side: true, repsMin: 16, reps: 20 })
    expect(legs[2]).toMatchObject({ side: true, repsMin: 24, reps: 30 })
  })

  it('reads a hold given as a range from its low end', () => {
    expect(legs[3]).toMatchObject({ mode: 'time', sec: 20 })
  })

  it('keeps the coach’s notes on the routine', () => {
    expect(legs[0].note).toBe('RIR 1–2\nExcentrique freiné 3 s.')
  })

  it('will not take a glute kickback for the catalogue’s triceps one', () => {
    expect(legs[2].id).not.toBe('0860')
    const made = report.created.find(c => c.name === 'Kickback poulie')
    expect(made.candidates[0]).toBe('0860')
  })

  it('files mobility as your own exercises, in Mobilité, with their instructions, once each', () => {
    const mob = bundle.customEx.filter(c => c.bp === 'mobility')
    expect(mob.map(c => c.n).sort()).toEqual(['Genou au mur', 'Planche Copenhague'])
    expect(mob.find(c => c.n === 'Genou au mur').desc).toBe('Phase 1 : 2 × 10 par côté\nPhase 2 : 2 × 12')
    expect(mob.find(c => c.n === 'Planche Copenhague').tg).toBe('adducteurs')
    // reported apart, as nothing to check
    expect(report.created.filter(c => c.mobility).map(c => c.name).sort()).toEqual(['Genou au mur', 'Planche Copenhague'])
    expect(report.created.find(c => c.name === 'Kickback poulie').mobility).toBeUndefined()
    // used in two sessions, created once
    const knee = mob.find(c => c.n === 'Genou au mur').id
    expect(bundle.routines.every(r => r.ex.some(e => e.id === knee))).toBe(true)
  })

  it('sets mobility up the way it is done: per side, bodyweight, no automatic progression', () => {
    expect(legs[4]).toMatchObject({ side: true, reps: 20, bodyweight: true, prog: 'off', rest: 0 })
    expect(legs[4].note).toBeUndefined()
    expect(legs[5]).toMatchObject({ mode: 'time', sec: 15, prog: 'off' })
  })
})

describe('reading names a programme writes', () => {
  const idOf = name => parseProgram(one({ name, sets: 3, reps: 10 })).bundle.routines[0].ex[0].id
  it('hears "unilatéral" as one arm, and allongé as allongée', () => {
    expect(idOf('Élévations latérales poulie (unilatéral)')).toBe('0192')
    expect(idOf('Extension triceps poulie unilatérale')).toBe('1723')
    expect(idOf('Extension triceps allongé haltères')).toBe('0351')
  })
  it('does not settle on another movement or other equipment for a near name', () => {
    // The catalogue's spider curls are reverse-grip ones: offered, not taken.
    const { bundle, report } = parseProgram(one({ name: 'Spider curl haltères', sets: 3, reps: 10 }))
    expect(bundle.customEx.map(c => c.id)).toContain(bundle.routines[0].ex[0].id)
    expect(report.created[0].candidates.length).toBeGreaterThan(0)
    expect(idOf('Développé incliné machine')).toBe('1299')
  })
  it('knows the cable work the catalogue only names in English', () => {
    expect(idOf('Pull-through à la poulie')).toBe('0196')
    expect(idOf('Face pull poulie haute')).toBe('0203')
    expect(idOf('Oiseau poulie croisée')).toBe('0225')
    expect(idOf('Pull-over poulie haute')).toBe('0238')
  })
  it('finds the exercise you already log under a name with a qualifier yours lacks', () => {
    const name = 'Écarté bas poulie vers le haut'
    expect(idOf(name)).not.toBe('0179')
    const { bundle } = parseProgram(one({ name, sets: 3, reps: 12 }), { used: new Map([['0179', 5]]) })
    expect(bundle.routines[0].ex[0].id).toBe('0179')
  })
  it('offers the gym’s own name for a lift found inside a longer one, without taking it', () => {
    const { bundle, report } = parseProgram(one({ name: 'Tirage horizontal unilatéral à la poulie', sets: 3, reps: 12 }))
    expect(bundle.routines[0].ex[0].id).not.toBe('0861')
    expect(report.created[0].candidates.slice(0, 3)).toContain('0861')
  })
  it('offers nothing else that works another muscle than the programme says', () => {
    const { report } = parseProgram(['Exercice;Séries;Reps;Muscle ciblé', 'Kickback poulie;3;12;Fessiers'].join('\n'))
    const [vetoed, ...others] = report.created[0].candidates
    expect(vetoed).toBe('0860')
    expect(others.every(c => musclesOf(EXIDX[c]).gluteal > 0)).toBe(true)
  })
  it('offers what the name before a coach’s qualifier means, without taking it', () => {
    const used = new Map([['0739', 12]])
    const press = parseProgram(one({ name: 'Presse à cuisses, pieds bas', sets: 4, reps: 10 }), { used })
    expect(press.bundle.routines[0].ex[0].id).not.toBe('0739')
    expect(press.report.created[0].candidates[0]).toBe('0739')
  })
})
