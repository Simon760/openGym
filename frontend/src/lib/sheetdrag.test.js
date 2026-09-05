import { describe, it, expect } from 'vitest'
import { onControl, dragBy, DRAG_SLOP } from './sheetdrag.js'

// A stand-in for the one DOM call this makes, so the rule can be tested without a browser.
const el = sel => ({ closest: q => (q.split(', ').some(x => sel.includes(x)) ? {} : null) })

describe('when a touch on a sheet is a drag', () => {
  it('is not one until the finger has clearly travelled', () => {
    // Reported as "le clavier s'ouvre pas": the sheet called preventDefault on every pixel of
    // drift, and that call cancels the click behind it — so a tap on the calorie field
    // focused nothing and opened no keyboard.
    expect(dragBy(0, false)).toBe(null)
    expect(dragBy(3, false)).toBe(null)          // a tap
    expect(dragBy(13, false)).toBe(null)         // a thumb reaching up the screen
    expect(dragBy(DRAG_SLOP, false)).toBe(0)     // exactly at the line, and moving nothing yet
    expect(dragBy(40, false)).toBe(40 - DRAG_SLOP)
  })

  it('keeps dragging once it has started, even back through the slop', () => {
    // otherwise the sheet would let go the moment you dragged back up a little
    expect(dragBy(40, true)).toBe(40 - DRAG_SLOP)
    expect(dragBy(5, true)).toBe(0)
    expect(dragBy(-100, true)).toBe(0)
  })

  it('never starts on a control, whose gesture belongs to it', () => {
    expect(onControl(el('input'))).toBe(true)          // the calorie field
    expect(onControl(el('textarea'))).toBe(true)
    expect(onControl(el('select'))).toBe(true)
    expect(onControl(el('button'))).toBe(true)         // the steppers, the switch, Save
    expect(onControl(el('[data-nodrag]'))).toBe(true)  // the opt-out that already existed
    expect(onControl(el('h3'))).toBe(false)            // the sheet still drags from a heading
    expect(onControl(null)).toBe(false)
    expect(onControl({})).toBe(false)                  // no closest, e.g. a text node
  })
})
