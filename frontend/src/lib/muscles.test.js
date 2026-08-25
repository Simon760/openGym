import { describe, it, expect } from 'vitest'
import { muscleSlug, musclesOf, sharesOf, sharesOfExercise, MUSCLES } from './muscles.js'

describe('muscleSlug', () => {
  it('still reads every spelling the dataset itself uses', () => {
    // These are the ALIAS keys the exercise library depends on. A change to the table that
    // breaks one of them silently empties the recovery map for a whole class of exercise.
    for (const [name, want] of [
      ['lats', 'upper-back'], ['delts', 'deltoids'], ['quads', 'quadriceps'],
      ['spine', 'lower-back'], ['pectorals', 'chest'], ['glutes', 'gluteal'],
      ['hamstrings', 'hamstring'], ['traps', 'trapezius'], ['abs', 'abs']
    ]) expect(muscleSlug(name)).toBe(want)
  })

  it('reads what a coach writes, not what a dataset writes', () => {
    for (const name of ['front delts', 'rear delts', 'side delts', 'anterior deltoid', 'posterior deltoid'])
      expect(muscleSlug(name)).toBe('deltoids')
    expect(muscleSlug('erector spinae')).toBe('lower-back')
    expect(muscleSlug('pecs')).toBe('chest')
    expect(muscleSlug('gluteus maximus')).toBe('gluteal')
    expect(muscleSlug('quadriceps femoris')).toBe('quadriceps')
  })

  it('reads French, accents and hyphens included', () => {
    for (const [name, want] of [
      ['Pectoraux', 'chest'], ['Épaules', 'deltoids'], ['Deltoïde postérieur', 'deltoids'],
      ['Dorsaux', 'upper-back'], ['Trapèzes', 'trapezius'], ['Lombaires', 'lower-back'],
      ['Abdos', 'abs'], ['Fessiers', 'gluteal'], ['Ischio-jambiers', 'hamstring'],
      ['ischio jambiers', 'hamstring'], ['Mollets', 'calves'], ['Adducteurs', 'adductors'],
      ['Avant-bras', 'forearm'], ['Coiffe des rotateurs', 'deltoids'], ['psoas', 'hip-flexors']
    ]) expect(muscleSlug(name)).toBe(want)
  })

  it('says no rather than guessing at a name the map cannot draw', () => {
    // Dropped *and reported* at import: a program that says this gets a warning, not a
    // muscle picked by resemblance.
    for (const name of ['posterior chain', 'cardio', 'full body', 'mind', ''])
      expect(muscleSlug(name)).toBe(null)
  })

  it('only ever returns a muscle the body map can shade', () => {
    for (const name of ['front delts', 'Ischio-jambiers', 'erector spinae', 'psoas', 'lats'])
      expect(MUSCLES).toContain(muscleSlug(name))
  })
})

describe('musclesOf', () => {
  it('weighs a compound lift by its target, then its support', () => {
    // The two exercises an imported French program actually produced.
    expect(musclesOf({ tg: 'chest', sm: ['triceps', 'front delts'], bp: 'chest' }))
      .toEqual({ chest: 1, triceps: 0.4, deltoids: 0.4 })
    expect(musclesOf({ tg: 'lats', sm: ['biceps', 'rear delts'], bp: 'back' }))
      .toEqual({ 'upper-back': 1, biceps: 0.4, deltoids: 0.4 })
  })

  it('keeps the target ahead of a support naming the same muscle', () => {
    expect(musclesOf({ tg: 'delts', sm: ['front delts'] })).toEqual({ deltoids: 1 })
  })

  it('falls back to the body part when nothing resolved', () => {
    expect(musclesOf({ tg: 'posterior chain', bp: 'upper legs' }))
      .toEqual({ quadriceps: 0.4, hamstring: 0.35, gluteal: 0.25 })
  })
})

describe('sharesOf — how much of a set goes where', () => {
  const sum = parts => parts.reduce((n, p) => n + p.pct, 0)

  it('turns a compound lift into percentages that add to 100', () => {
    expect(sharesOfExercise({ tg: 'chest', sm: ['triceps', 'front delts'], bp: 'chest' }))
      .toEqual([{ slug: 'chest', pct: 56 }, { slug: 'deltoids', pct: 22 }, { slug: 'triceps', pct: 22 }])
  })

  it('always adds to exactly 100, whatever the rounding', () => {
    // Independent rounding gives 99 or 101 here; largest remainder does not. A reader who
    // adds the column up has to get 100 or the number is not a percentage.
    for (const load of [
      { chest: 1, triceps: 0.4, deltoids: 0.4 },
      { quadriceps: 1, gluteal: 0.4, hamstring: 0.4, 'lower-back': 0.4 },
      { biceps: 1, forearm: 0.4 },
      { chest: 12, triceps: 4.8, deltoids: 3.2, 'upper-back': 8, biceps: 3.2 },
      { abs: 7 }
    ]) expect(sum(sharesOf(load))).toBe(100)
  })

  it('orders by how hard the muscle worked', () => {
    const p = sharesOf({ 'upper-back': 8, chest: 12, biceps: 3.2 })
    expect(p.map(x => x.slug)).toEqual(['chest', 'upper-back', 'biceps'])
    expect(p[0].pct).toBeGreaterThan(p[1].pct)
  })

  it('drops a sliver rather than printing 0 %, and still reaches 100', () => {
    const p = sharesOf({ chest: 100, forearm: 0.3 })
    expect(p.map(x => x.slug)).toEqual(['chest'])
    expect(sum(p)).toBe(100)
  })

  it('has nothing to say about nothing', () => {
    expect(sharesOf({})).toEqual([])
    expect(sharesOf({ chest: 0 })).toEqual([])
    expect(sharesOfExercise(null)).toEqual([])
  })

  it('reads a session, not just an exercise', () => {
    // four sets of bench, three of curls: the shares weigh the sets, not the exercises
    const load = { chest: 4, triceps: 1.6, deltoids: 1.6, biceps: 3, forearm: 1.2 }
    const p = sharesOf(load)
    expect(p[0].slug).toBe('chest')
    expect(sum(p)).toBe(100)
  })
})
