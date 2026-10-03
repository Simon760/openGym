import { describe, it, expect } from 'vitest'
import { EXDB, CATEGORIES, inCategory, categoryOf, termLabel } from './exercises.js'

const custom = (n, extra = {}) => ({ id: 'c' + n, n, bp: 'upper arms', eq: 'custom', custom: true, ...extra })

describe('exercise categories', () => {
  it('files every exercise of the catalogue under exactly one category', () => {
    for (const e of EXDB) {
      const n = CATEGORIES.filter(c => c.has(e)).length
      expect(n, e.id + ' ' + e.n + ' (' + e.bp + ')').toBe(1)
    }
  })

  // One "bras" list of 292 put the curl you wanted behind a hundred extensions.
  it('splits the arms into biceps and triceps by the muscle each one works', () => {
    const arms = EXDB.filter(e => e.bp === 'upper arms')
    expect(arms.length).toBeGreaterThan(200)
    for (const e of arms) expect(categoryOf(e).key, e.n).toBe(e.tg === 'triceps' ? 'triceps' : 'biceps')
    const bi = EXDB.filter(e => inCategory(e, 'biceps')).length
    const tri = EXDB.filter(e => inCategory(e, 'triceps')).length
    expect(bi + tri).toBe(arms.length)
    expect(bi).toBeGreaterThan(100)
    expect(tri).toBeGreaterThan(100)
  })

  it('keeps the forearms on their own', () => {
    const fore = EXDB.filter(e => inCategory(e, 'lower arms'))
    expect(fore.length).toBeGreaterThan(20)
    expect(fore.every(e => e.bp === 'lower arms')).toBe(true)
  })

  it('reads an arm exercise of your own off its name when it has no target muscle', () => {
    for (const n of ['Extension triceps poulie', 'Barre au front', 'Extension nuque haltère', 'Dips banc', 'Push-down corde', 'Kickback', 'Développé prise serrée', 'Skull crusher'])
      expect(categoryOf(custom(n)).key, n).toBe('triceps')
    for (const n of ['Curl marteau', 'Curl pupitre', 'Biceps machine', 'Bras'])
      expect(categoryOf(custom(n)).key, n).toBe('biceps')
  })

  it('trusts a target muscle when the exercise has one', () => {
    expect(categoryOf(custom('Curl inversé', { tg: 'triceps' })).key).toBe('triceps')
    expect(categoryOf(custom('Extension', { tg: 'biceps' })).key).toBe('biceps')
  })

  it('lists them in the order a gym is walked, with what a new exercise is stored as', () => {
    expect(CATEGORIES.map(c => c.key)).toEqual(['chest', 'back', 'shoulders', 'biceps', 'triceps', 'lower arms', 'upper legs', 'lower legs', 'waist', 'mobility', 'sports', 'cardio', 'neck'])
    expect(CATEGORIES.find(c => c.key === 'triceps')).toMatchObject({ bp: 'upper arms', tg: 'triceps' })
    expect(CATEGORIES.find(c => c.key === 'biceps')).toMatchObject({ bp: 'upper arms', tg: 'biceps' })
  })

  it('treats no category as all of them, and an unknown one as none', () => {
    expect(inCategory(EXDB[0], '')).toBe(true)
    expect(inCategory(EXDB[0], 'nope')).toBe(false)
    expect(inCategory(null, 'chest')).toBe(false)
    expect(categoryOf(null)).toBe(null)
    expect(categoryOf({ id: 'x', n: 'x', bp: 'elsewhere' })).toBe(null)
  })

  // "Avant-Bras", "Machine À Levier": every word capitalised is right for English terms only.
  it('labels a term with a capital on its first word only', () => {
    expect(termLabel('lower arms')).toBe('Lower arms')
    expect(termLabel('leverage machine')).toBe('Leverage machine')
    expect(termLabel('')).toBe('')
    expect(termLabel(undefined)).toBe('')
  })
})
