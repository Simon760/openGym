import { describe, it, expect } from 'vitest'
import { toFrench } from '../../../scripts/build-exercise-fr.mjs'

// The generator is the thing under test, not its output: the output is regenerated whenever
// the tables change, and what has to hold is the shape of what comes out of them.
describe('toFrench — the catalogue in French', () => {
  it('puts the movement first and the equipment last, the way a gym says it', () => {
    for (const [en, fr] of [
      ['barbell bench press', 'développé couché barre'],
      ['dumbbell incline bench press', 'développé incliné haltères'],
      ['cable seated row', 'rowing poulie assis'],
      ['dumbbell seated hammer curl', 'curl marteau haltères assis'],
      ['barbell romanian deadlift', 'soulevé de terre roumain barre'],
      ['dumbbell lateral raise', 'élévation latérale haltères'],
      ['kettlebell goblet squat', 'goblet squat kettlebell']
    ]) expect(toFrench(en)).toBe(fr)
  })

  it('does not stack an angle on top of a flat bench', () => {
    // "développé couché incliné" is a contradiction: couché *is* the flat one.
    expect(toFrench('barbell incline bench press')).toBe('développé incliné barre')
    expect(toFrench('barbell decline bench press')).toBe('développé décliné barre')
    expect(toFrench('barbell bench press')).toBe('développé couché barre')
  })

  it('agrees its adjectives with the movement it just named', () => {
    expect(toFrench('band single leg reverse calf raise')).toContain('inversée')   // extension, f
    expect(toFrench('barbell decline bench press')).toContain('décliné')           // développé, m
    expect(toFrench('incline push-up')).toContain('inclinées')                     // pompes, fp
  })

  it('does not say the equipment twice', () => {
    expect(toFrench('barbell high bar squat')).toBe('squat barre haute')
    expect(toFrench('cable pushdown')).toBe('extension triceps poulie')
  })

  it('reads the props and notes the dataset hangs off a name', () => {
    expect(toFrench('back extension on exercise ball')).toBe('extension lombaires sur swiss ball')
    expect(toFrench('dumbbell one arm shoulder press v. 2')).toBe('développé épaules à un bras haltères variante 2')
    expect(toFrench('cable overhead triceps extension (rope attachment)')).toContain('corde')
  })

  it('does not care how the dataset hyphenated it', () => {
    expect(toFrench('barbell close-grip bench press')).toBe(toFrench('barbell close grip bench press'))
    expect(toFrench('push up')).toBe(toFrench('push-up'))
  })

  it('says nothing rather than something half English', () => {
    // The gate: one unknown word and the English name stands. A name with a hole in it
    // reads worse than English and, unlike English, cannot be trusted.
    expect(toFrench('arm slingers hanging bent knee legs')).toBe(null)
    expect(toFrench('barbell pullover to press')).toBe(null)
    expect(toFrench('')).toBe(null)
  })
})
