import { describe, it, expect } from 'vitest'
import { keyboardInset, watchKeyboard } from './keyboard.js'

// An iPhone 13 in a standalone web app: 844 tall, a keyboard with its bar of about 336.
const win = (vv, innerHeight = 844) => ({ innerHeight, visualViewport: vv })
const viewport = (height, offsetTop = 0, scale = 1) => Object.assign(new EventTarget(), { height, offsetTop, scale })

function fakeDoc() {
  const props = {}
  return {
    props,
    activeElement: null,
    documentElement: { style: { setProperty: (k, v) => { props[k] = v }, removeProperty: k => { delete props[k] } } },
  }
}

describe('keyboardInset', () => {
  it('is what the keyboard covers below the visible part of the page', () => {
    expect(keyboardInset(win(), viewport(508))).toBe(336)
  })

  // iOS pans down to the field being typed in; what is below the visible part is then less.
  it('allows for iOS having panned the page to the field', () => {
    expect(keyboardInset(win(), viewport(508, 200))).toBe(136)
    expect(keyboardInset(win(), viewport(508, 336))).toBe(0)
  })

  it('is nothing without a keyboard, or for a toolbar settling', () => {
    expect(keyboardInset(win(), viewport(844))).toBe(0)
    expect(keyboardInset(win(), viewport(800))).toBe(0)
    expect(keyboardInset(win(), null)).toBe(0)
    expect(keyboardInset(win(), viewport(0))).toBe(0)
  })

  it('leaves a pinch-zoomed page alone', () => {
    expect(keyboardInset(win(), viewport(400, 0, 2))).toBe(0)
  })
})

describe('watchKeyboard', () => {
  it('publishes the keyboard while it is up, and nothing once it is gone', () => {
    const vv = viewport(844)
    const doc = fakeDoc()
    const stop = watchKeyboard(win(vv), doc)
    expect(doc.props).toEqual({})

    vv.height = 508
    vv.dispatchEvent(new Event('resize'))
    expect(doc.props).toEqual({ '--kb': '336px', '--vvh': '508px', '--sheet-sab': '0px' })

    vv.offsetTop = 200
    vv.dispatchEvent(new Event('scroll'))
    expect(doc.props['--kb']).toBe('136px')

    vv.height = 844; vv.offsetTop = 0
    vv.dispatchEvent(new Event('resize'))
    expect(doc.props).toEqual({})

    vv.height = 508
    vv.dispatchEvent(new Event('resize'))
    stop()
    expect(doc.props).toEqual({})
    // Stopped means stopped: a keyboard after the last sheet closed moves nothing.
    vv.height = 400
    vv.dispatchEvent(new Event('resize'))
    expect(doc.props).toEqual({})
  })

  it('does nothing where there is no visual viewport', () => {
    const doc = fakeDoc()
    const stop = watchKeyboard({ innerHeight: 844 }, doc)
    expect(doc.props).toEqual({})
    expect(() => stop()).not.toThrow()
  })
})
