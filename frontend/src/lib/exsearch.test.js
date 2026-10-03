import { describe, it, expect } from 'vitest'
import { exMatches, exCloseMatches, exName, fillEx, exSearchText, allExercises } from './exercises.js'
import { hydrate } from './hydrate.js'

// The record an imported plan used to produce: a name, a body part, and nothing else.
const imported = { id: 'imp1', n: 'Rowing barre', bp: 'back' }
const full = { id: 'x', n: 'Bench press', bp: 'chest', tg: 'pectorals', eq: 'barbell', desc: 'flat' }

describe('a search must not crash on a half-built record', () => {
  // It did, in two screens, from the first letter typed: `ex.tg.includes(q)` on a record with
  // no tg. Everything below the search went blank — the whole app, from one imported exercise.
  it('survives an exercise with no tg, eq or desc', () => {
    expect(() => exMatches(imported, 'd')).not.toThrow()
    expect(() => exMatches(imported, 'rowing')).not.toThrow()
    expect(exMatches(imported, 'rowing')).toBe(true)
    expect(exMatches(imported, 'zzz')).toBe(false)
  })

  it('survives a record with no name at all', () => {
    expect(() => exSearchText({ id: 'z' })).not.toThrow()
    expect(() => exMatches({ id: 'z' }, 'a')).not.toThrow()
    expect(() => exMatches(null, 'a')).not.toThrow()
    expect(() => exMatches(undefined, 'a')).not.toThrow()
  })

  it('survives a field that is not a string', () => {
    for (const bad of [{ ...full, tg: 3 }, { ...full, eq: null }, { ...full, desc: {} }, { ...full, n: 7 }]) {
      expect(() => exMatches(bad, 'e'), JSON.stringify(bad)).not.toThrow()
    }
  })

  it('still matches on each of the fields it always did', () => {
    expect(exMatches(full, 'bench')).toBe(true)      // name
    expect(exMatches(full, 'pectoral')).toBe(true)   // target muscle
    expect(exMatches(full, 'barbell')).toBe(true)    // equipment
    expect(exMatches(full, 'flat')).toBe(true)       // description
    expect(exMatches(full, 'squat')).toBe(false)
  })

  it('matches everything on an empty search', () => {
    expect(exMatches(imported, '')).toBe(true)
    expect(exMatches(null, '')).toBe(true)
  })

  it('runs over the whole catalogue without throwing', () => {
    const st = { customEx: [imported] }
    for (const q of ['d', 'a', 'e', 'press', 'é']) {
      expect(() => allExercises(st).filter(e => exMatches(e, q)), q).not.toThrow()
    }
    // The catalogue has its own barbell row under that French name, so the imported one is
    // simply one of the matches rather than the only one.
    const hits = allExercises(st).filter(e => exMatches(e, 'rowing barre'))
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits.some(e => e.id === 'imp1')).toBe(true)
  })
})

describe('fillEx', () => {
  it('completes what an importer left out, keeping what it set', () => {
    const e = fillEx(imported)
    expect(e).toMatchObject({ id: 'imp1', n: 'Rowing barre', bp: 'back', tg: '', eq: 'custom', desc: '' })
  })

  it('never overwrites a field that was already there', () => {
    expect(fillEx(full)).toEqual({ ...full, custom: true })
  })
})

describe('records already sitting in the database', () => {
  it('are repaired on the way in, since fixing the writers does nothing for them', () => {
    const back = hydrate({ customEx: [imported, { id: 'ok', n: 'Curl', bp: 'arms', tg: 'biceps', eq: 'dumbbell' }] })
    expect(back.customEx[0]).toMatchObject({ tg: '', eq: 'custom' })
    expect(back.customEx[1].eq).toBe('dumbbell')
    expect(() => back.customEx.filter(e => exMatches(e, 'c'))).not.toThrow()
  })

  it('drops a record with no id rather than carrying a hole', () => {
    expect(hydrate({ customEx: [{ n: 'orphan' }, imported] }).customEx).toHaveLength(1)
  })
})

describe('exMatches — accents and word order', () => {
  it('finds "développé" typed without its accents, and the words in any order', async () => {
    const { EXIDX, exMatches } = await import('./exercises.js')
    const bench = EXIDX['0025']   // développé couché barre
    expect(exMatches(bench, 'developpe')).toBe(true)
    expect(exMatches(bench, 'couche developpe')).toBe(true)
    expect(exMatches(bench, 'DÉVELOPPÉ COUCHÉ')).toBe(true)
    expect(exMatches(bench, 'developpe incline')).toBe(false)
  })
})

// A programme's full name for a lift, searched from the import review, found nothing at all.
describe('a search nothing matches in full', () => {
  const list = allExercises({ customEx: [] })
  const q = 'Abduction de hanche à la poulie'
  it('offers the exercises sharing the most of it, the rare words first', () => {
    expect(list.filter(e => exMatches(e, q))).toEqual([])
    const close = exCloseMatches(list, q)
    expect(close.length).toBeGreaterThan(1)
    // "abduction" outweighs "poulie": the hip abductions before the cable work
    expect(exMatches(close[0], 'abduction hanche'), exName(close[0])).toBe(true)
  })
  it('wants two words at least, so one word in common is not a match', () => {
    expect(exCloseMatches(list, 'Nordic curl')).toEqual([])
    expect(exCloseMatches(list, 'curl')).toEqual([])
  })
})
