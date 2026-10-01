import { describe, it, expect } from 'vitest'
import { SPORTS, sportOf, sportLoad, srpeOf, sportTau, SRPE_PER_SET } from './sports.js'
import { sportRecovery, recoveryNow, RECOVERED_AT } from './recovery.js'
import { musclesOf, MUSCLES } from './muscles.js'
import { EXIDX, inCategory, categoryOf } from './exercises.js'
import { activityWorkout, setLabel, durMs } from './history.js'

const FOOT = 'x004', PADEL = 'x003', SWIM = 'x005', TENNIS = 'x006', RUN = 'x007', BIKE = 'x008'
const H = 3600000
const T0 = Date.UTC(2026, 9, 1, 20, 0, 0)

describe('sport profiles', () => {
  it('exist in the catalogue, filed under Sports, drawn on muscles the map can shade', () => {
    for (const id in SPORTS) {
      const ex = EXIDX[id]
      expect(ex, id).toBeTruthy()
      expect(ex.bp).toBe('cardio')
      expect(ex.once).toBe(true)
      expect(categoryOf(ex).key).toBe('sports')
      expect(inCategory(ex, 'cardio')).toBe(false)
      const w = Object.values(SPORTS[id].muscles)
      expect(Math.max(...w), id).toBeLessThanOrEqual(1)
      expect(Math.max(...w), id).toBeGreaterThanOrEqual(0.7)
      for (const slug in SPORTS[id].muscles) expect(MUSCLES, id + ' ' + slug).toContain(slug)
      expect(SPORTS[id].tau[0]).toBeLessThan(SPORTS[id].tau[1])
    }
  })

  it('give the muscle map the sport’s own profile rather than the dataset’s flat one', () => {
    expect(musclesOf(EXIDX[FOOT])).toEqual(SPORTS[FOOT].muscles)
    expect(musclesOf(EXIDX[FOOT]).hamstring).toBe(1)
    expect(musclesOf(EXIDX[SWIM])['upper-back']).toBe(1)
  })

  it('reads the effort of a set as its session rating, else an app RPE, else the typical one', () => {
    expect(srpeOf({ srpe: 6 }, SPORTS[PADEL])).toBe(6)
    expect(srpeOf({ rpe: 8 }, SPORTS[PADEL])).toBe(8)
    expect(srpeOf({}, SPORTS[FOOT])).toBe(7)
  })

  it('counts minutes × session RPE, spread over the muscles', () => {
    const p = sportLoad(FOOT, [{ min: 90, srpe: 7, done: true }])
    expect(p.au).toBe(630)
    expect(p.load.hamstring).toBeCloseTo(630 / SRPE_PER_SET)
    expect(sportLoad(FOOT, [{ min: 90, srpe: 7, done: false }])).toBe(null)
    expect(sportLoad('0001', [{ min: 90, done: true }])).toBe(null)
  })

  it('decays faster after an easy session than a hard one', () => {
    expect(sportTau(SPORTS[FOOT], 3)).toBe(14)
    expect(sportTau(SPORTS[FOOT], 8)).toBe(26)
    expect(sportTau(SPORTS[FOOT], 10)).toBe(26)
  })
})

// Where the studies put recovery, and where the model lands.
describe('recovery, against the time courses measured', () => {
  it('a competitive football match: the legs about three days (Silva 2018, Nédélec 2012)', () => {
    const r = sportRecovery(FOOT, 90, 7)
    expect(r.slug).toBe('hamstring')
    expect(r.hours).toBeGreaterThanOrEqual(60)
    expect(r.hours).toBeLessThanOrEqual(76)
  })

  it('an easy kickabout: much less', () => {
    expect(sportRecovery(FOOT, 60, 4).hours).toBeLessThan(48)
  })

  it('a padel match: a day and a bit — moderate, no measurable neuromuscular fatigue after', () => {
    const r = sportRecovery(PADEL, 90, 5)
    expect(r.hours).toBeGreaterThanOrEqual(20)
    expect(r.hours).toBeLessThanOrEqual(40)
  })

  it('a swim: under a day — concentric, unloaded, the least muscle damage of any sport', () => {
    const r = sportRecovery(SWIM, 60, 5)
    expect(r.slug).toBe('upper-back')
    expect(r.hours).toBeLessThan(24)
  })

  it('ranks the sports by how much eccentric work they do, at equal minutes and effort', () => {
    const h = id => sportRecovery(id, 60, 6).hours
    expect(h(FOOT)).toBeGreaterThan(h(PADEL))
    expect(h(RUN)).toBeGreaterThan(h(BIKE))
    expect(h(TENNIS)).toBeGreaterThanOrEqual(h(PADEL))
    expect(h(PADEL)).toBeGreaterThan(h(SWIM))
  })

  it('shows on the recovery map, and is gone by the time the model says', () => {
    const w = activityWorkout({ wid: 'a1', id: FOOT, name: 'Football', d: '2026-10-01', min: 90, srpe: 7, now: T0 })
    const S = { workouts: [w], sleep: [], nutrition: [], health: [] }
    const just = recoveryNow(S, T0 + 1 * H).muscles
    expect(just.hamstring.pct).toBeLessThan(30)
    expect(just.quadriceps).toBeTruthy()
    const later = recoveryNow(S, T0 + 80 * H).muscles
    expect(!later.hamstring || later.hamstring.pct >= 100 * (1 - RECOVERED_AT)).toBe(true)
  })
})

describe('an activity written straight onto a day', () => {
  it('is a finished session with one block, its minutes and its rating', () => {
    const w = activityWorkout({ wid: 'a1', id: PADEL, name: 'Padel', d: '2026-10-01', min: 90, srpe: 5, kcal: 640, bw: 80, now: T0 })
    expect(w).toMatchObject({ id: 'a1', d: '2026-10-01', name: 'Padel', routineId: null, bw: 80, activity: true, vol: 0 })
    expect(w.entries).toHaveLength(1)
    expect(w.entries[0].sets).toEqual([{ min: 90, srpe: 5, done: true }])
    expect(w.watch).toEqual({ kcal: 640, minutes: 90 })
    expect(durMs(w)).toBe(90 * 60000)
    expect(setLabel(PADEL, w.entries[0].sets[0], w.entries[0].target)).toContain('90 min')
  })

  it('played today, ends now; another day, ends at the 18:00 every unclocked session does', () => {
    const today = activityWorkout({ wid: 'a', id: SWIM, name: 'Natation', d: '2026-10-01', min: 45, now: T0 })
    expect(today.end).toBe(T0)
    expect(today.start).toBe(T0 - 45 * 60000)
    const before = activityWorkout({ wid: 'b', id: SWIM, name: 'Natation', d: '2026-09-29', min: 45, now: T0 })
    expect(before.start).toBe(new Date('2026-09-29T18:00:00').getTime())
  })

  it('keeps a distance only where one was given, and no energy it was not given', () => {
    const w = activityWorkout({ wid: 'r', id: RUN, name: 'Course', d: '2026-09-30', min: 40, srpe: 4, km: 7.5, now: T0 })
    expect(w.entries[0].sets[0].km).toBe(7.5)
    expect(w.watch).toEqual({ minutes: 40 })
  })
})
