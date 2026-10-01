import { describe, it, expect } from 'vitest'
import { restAt, restorable, OVER_MAX } from './rest.js'

const T0 = Date.UTC(2026, 9, 1, 18, 0, 0)
const rest = (sec, extra = {}) => ({ endsAt: T0 + sec * 1000, total: sec, w: 'w1', ...extra })

describe('restAt', () => {
  it('counts down while the rest runs', () => {
    expect(restAt(rest(90), T0)).toEqual({ left: 90, over: null, expired: false })
    expect(restAt(rest(90), T0 + 89500)).toEqual({ left: 1, over: null, expired: false })
  })

  // It used to vanish at zero, the one moment it had something to say.
  it('turns into the time since, once it is over, instead of going away', () => {
    expect(restAt(rest(90), T0 + 90000)).toEqual({ left: 0, over: 0, expired: false })
    expect(restAt(rest(90), T0 + 102400)).toEqual({ left: 0, over: 12, expired: false })
  })

  it('gives up once it has been over for longer than anyone still rests', () => {
    expect(restAt(rest(0), T0 + OVER_MAX * 1000).expired).toBe(false)
    expect(restAt(rest(0), T0 + (OVER_MAX + 1) * 1000).expired).toBe(true)
    expect(restAt(null, T0).expired).toBe(true)
  })
})

describe('restorable — the rest after iOS reloaded the app', () => {
  const active = { id: 'w1' }

  it('comes back still running, with what is left of it', () => {
    expect(restorable(rest(90), active, T0 + 30000)).toMatchObject({ left: 60, over: null, total: 90, w: 'w1' })
  })

  it('comes back over, counting since, when it ended while the app was closed', () => {
    expect(restorable(rest(90), active, T0 + 150000)).toMatchObject({ left: 0, over: 60 })
  })

  it('does not come back into another session, or none, or long after', () => {
    expect(restorable(rest(90), { id: 'w2' }, T0)).toBe(null)
    expect(restorable(rest(90), null, T0)).toBe(null)
    expect(restorable(rest(90), active, T0 + (90 + OVER_MAX + 5) * 1000)).toBe(null)
    expect(restorable({ total: 90 }, active, T0)).toBe(null)
    expect(restorable(null, active, T0)).toBe(null)
  })

  it('takes a saved rest with no session on it as this one', () => {
    expect(restorable(rest(90, { w: null }), active, T0)).toMatchObject({ w: 'w1', left: 90 })
  })
})
