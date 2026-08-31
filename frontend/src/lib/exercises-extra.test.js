import { describe, it, expect } from 'vitest'
import { EX_EXTRA } from './exercises-extra.js'
import { EXDB, EXIDX, exName, exNameEn, exMatches, exSearchText, BODYPARTS } from './exercises.js'
import { EXDB as UPSTREAM } from './exercises-data.js'
import { musclesOf } from './muscles.js'
import { instrFor } from './i18n.js'

// An added exercise is only useful if it behaves like the other 1324 everywhere — the
// filter chips, the search, the body map, the instruction sheet. Each of these pins one
// of the ways an out-of-vocabulary field would let it fall through quietly.
describe('the exercises this app adds to the catalogue', () => {
  const ids = new Set(UPSTREAM.map(e => e.id))

  it('cannot collide with an upstream id or with a user’s own', () => {
    EX_EXTRA.forEach(e => {
      expect(ids.has(e.id)).toBe(false)
      expect(e.id.startsWith('x')).toBe(true)   // upstream is digits, a custom is 'c' + uid
    })
    expect(new Set(EXDB.map(e => e.id)).size).toBe(EXDB.length)
  })

  it('is in the list, the index and the body-part filter', () => {
    EX_EXTRA.forEach(e => {
      expect(EXIDX[e.id]).toBeTruthy()
      expect(EXDB).toContain(e)
      expect(BODYPARTS).toContain(e.bp)
    })
    expect(EXDB.length).toBe(UPSTREAM.length + EX_EXTRA.length)
  })

  it('uses the dataset’s vocabulary, or it drops off the filters and the body map', () => {
    const vocab = k => new Set(UPSTREAM.map(e => e[k]))
    EX_EXTRA.forEach(e => {
      expect(vocab('bp').has(e.bp)).toBe(true)
      expect(vocab('eq').has(e.eq)).toBe(true)
      expect(vocab('tg').has(e.tg)).toBe(true)
      // a target or secondary muscle outside muscles.js's aliases draws nothing
      expect(Object.keys(musclesOf(e)).length).toBeGreaterThan(0)
    })
  })

  it('shows its French name and is found by either language', () => {
    const sq = EXIDX.x001
    expect(exName(sq)).toBe('squeeze press haltères')
    expect(exSearchText(sq)).toContain('squeeze press haltères')
    expect(exMatches(sq, 'squeeze')).toBe(true)          // what he will actually type
    expect(exMatches(sq, 'dumbbell squeeze press')).toBe(true)
    expect(exMatches(sq, 'haltères')).toBe(true)
    expect(exMatches(sq, 'pectorals')).toBe(true)        // the target field
    expect(exMatches(sq, 'rowing')).toBe(false)
  })

  it('carries its own steps, since the generated pack has no entry for it', () => {
    EX_EXTRA.forEach(e => {
      expect(instrFor(e).length).toBeGreaterThanOrEqual(3)
      instrFor(e).forEach(s => expect(typeof s).toBe('string'))
    })
  })

  it('renders without media rather than pointing at a file that is not there', () => {
    EX_EXTRA.forEach(e => { expect(e.img).toBeUndefined(); expect(e.gif).toBeUndefined() })
  })
})

// Names are shown in French, but the English name is what the rest of the gym world uses.
// A search in either language has to find the exercise, and the English name stays on screen
// so the one you found is confirmably the one you meant.
describe('an exercise whose name was translated', () => {
  const bench = EXIDX['0289']          // dumbbell bench press → développé couché haltères
  const ext = EXIDX['0351']            // dumbbell lying triceps extension

  it('is found by its English name as well as its French one', () => {
    expect(exName(bench)).toBe('développé couché haltères')
    expect(exMatches(bench, 'dumbbell bench press')).toBe(true)
    expect(exMatches(bench, 'bench')).toBe(true)
    expect(exMatches(bench, 'développé couché')).toBe(true)
    expect(exMatches(ext, 'lying triceps extension')).toBe(true)
  })

  it('keeps its English name on screen next to the French one', () => {
    expect(exNameEn(bench)).toBe('dumbbell bench press')
    expect(exNameEn(ext)).toBe('dumbbell lying triceps extension')
    expect(exNameEn(EXIDX.x001)).toBe('dumbbell squeeze press')
  })

  it('shows nothing where there is no second name to show', () => {
    // never translated — the displayed name already IS the English one, and printing it
    // twice under itself would read as a bug
    const untranslated = EXDB.find(e => exName(e) === e.n)
    expect(exNameEn(untranslated)).toBe('')
    // a custom exercise has exactly one name: whatever its owner typed
    expect(exNameEn({ id: 'c1', n: 'Ma machine', custom: true })).toBe('')
    expect(exNameEn(null)).toBe('')
    expect(exNameEn({ id: 'x', n: 7 })).toBe('')
  })
})

// The one he asked for second was already in the catalogue; this says so out loud, so a
// future dataset refresh that dropped it would fail here rather than in his hands.
describe('dumbbell lying triceps extension', () => {
  it('is already upstream, with its French name and its animation', () => {
    const ex = EXIDX['0351']
    expect(ex.n).toBe('dumbbell lying triceps extension')
    expect(exName(ex)).toBe('extension triceps haltères allongée')
    expect(ex.tg).toBe('triceps')
    expect(ex.eq).toBe('dumbbell')
    expect(ex.gif).toBeTruthy()
    expect(exMatches(ex, 'extension triceps')).toBe(true)
  })
})
