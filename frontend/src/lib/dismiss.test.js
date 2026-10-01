import { describe, it, expect, vi } from 'vitest'
import { registerDismiss, forgetDismiss, runDismiss, runAllDismiss } from './dismiss.js'

describe('dismissing a sheet', () => {
  it('closes a sheet that registered nothing — a confirm dialog, a picker', () => {
    expect(runDismiss('nothing-here')).toBe(false)
  })

  it('runs what the sheet registered, and lets it go once that has saved', () => {
    const save = vi.fn(() => undefined)
    registerDismiss('a', save)
    expect(runDismiss('a')).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
    forgetDismiss('a')
  })

  it('keeps the sheet when its save refused the input — it said why, and the figure is still there to fix', () => {
    registerDismiss('b', () => false)
    expect(runDismiss('b')).toBe(true)
    forgetDismiss('b')
  })

  it('lets the sheet go when its save throws, rather than trapping it on screen', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerDismiss('c', () => { throw new Error('boom') })
    expect(runDismiss('c')).toBe(false)
    err.mockRestore()
    forgetDismiss('c')
  })

  it('forgets a sheet once it is gone, however it went', () => {
    const save = vi.fn()
    registerDismiss('d', save)
    forgetDismiss('d')
    runDismiss('d')
    expect(save).not.toHaveBeenCalled()
  })

  it('a stale unregister does not take away a newer registration for the same sheet', () => {
    const first = vi.fn(), second = vi.fn()
    const undo = registerDismiss('e', first)
    registerDismiss('e', second)
    undo()
    runDismiss('e')
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    forgetDismiss('e')
  })

  it('closing everything gives every open sheet its save, refusals included, and only once', () => {
    const a = vi.fn(), b = vi.fn(() => false)
    registerDismiss('f', a); registerDismiss('g', b)
    runAllDismiss()
    runAllDismiss()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(runDismiss('f')).toBe(false)
  })
})
