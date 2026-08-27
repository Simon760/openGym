import { describe, it, expect } from 'vitest'
import { weekFor, weekOfBlock, setWeekDay, duplicateBlock, emptyBlock, blockAt, activeBlock, blockFromCurrent, startBlock, cancelSwitch,
  upcoming, daysUntil, removeBlock, sessionsIn, weekIndexAt, entryAt } from './blocks.js'
import { effectiveRoutineId } from './history.js'
import { hydrate } from './hydrate.js'
import { todayISO } from './format.js'

const iso = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const S = over => ({
  routines: [{ id: 'push', name: 'Push', ex: [] }, { id: 'pull', name: 'Pull', ex: [] },
    { id: 'legs', name: 'Legs', ex: [] }, { id: 'upper', name: 'Upper', ex: [] }],
  week: { 1: 'push', 3: 'pull', 5: 'legs' }, dayPlan: {}, workouts: [],
  blocks: [], blockLog: [], ...over
})

describe('a profile that has never made a block', () => {
  it('reads exactly as it always did', () => {
    const st = S()
    expect(weekFor(st, iso(0))).toEqual({ 1: 'push', 3: 'pull', 5: 'legs' })
    expect(activeBlock(st)).toBe(null)
  })

  it('writes exactly where it always did', () => {
    const st = S()
    setWeekDay(st, 2, 'upper')
    expect(st.week[2]).toBe('upper')
    setWeekDay(st, 2, '')
    expect(st.week[2]).toBeUndefined()
  })
})

describe('saving the current schedule as a block', () => {
  it('takes the week as it stands and starts running it', () => {
    const st = S()
    const b = blockFromCurrent(st, 'Hypertrophie')
    st.blocks = [b]
    startBlock(st, b.id)
    expect(b.weeks).toEqual([{ 1: 'push', 3: 'pull', 5: 'legs' }])
    expect(activeBlock(st).block.name).toBe('Hypertrophie')
    expect(weekFor(st, iso(0))).toEqual({ 1: 'push', 3: 'pull', 5: 'legs' })
  })

  it('sends a day assignment into the running block, not into the loose week', () => {
    const st = S()
    const b = blockFromCurrent(st, 'A'); st.blocks = [b]; startBlock(st, b.id)
    setWeekDay(st, 2, 'upper')
    expect(b.weeks[0][2]).toBe('upper')
    expect(st.week[2]).toBeUndefined()      // the fallback is left alone
    expect(weekFor(st, iso(0))[2]).toBe('upper')
  })
})

describe('the past stays put', () => {
  // The whole point. A switch dated today must not reach backwards and claim that last
  // month's Tuesday was whatever Tuesday is now.
  const st = () => {
    const s = S()
    const a = { id: 'a', name: 'Bloc A', weeks: [{ 1: 'push', 3: 'pull', 5: 'legs' }] }
    const b = { id: 'b', name: 'Bloc B', weeks: [{ 2: 'upper', 4: 'upper', 6: 'legs' }] }
    s.blocks = [a, b]
    s.blockLog = [{ from: iso(-60), blockId: 'a' }]
    return s
  }

  it('answers for a past day with the block that was running then', () => {
    const s = st()
    startBlock(s, 'b')                          // switch, today
    expect(weekFor(s, iso(-30))).toEqual({ 1: 'push', 3: 'pull', 5: 'legs' })
    expect(weekFor(s, iso(0))).toEqual({ 2: 'upper', 4: 'upper', 6: 'legs' })
    expect(weekFor(s, iso(30))).toEqual({ 2: 'upper', 4: 'upper', 6: 'legs' })
  })

  it('refuses to backdate a switch into history', () => {
    const s = st()
    const e = startBlock(s, 'b', iso(-10))
    expect(e.from).toBe(todayISO())             // clamped forward
    expect(weekFor(s, iso(-5))).toEqual({ 1: 'push', 3: 'pull', 5: 'legs' })
  })

  it('carries that through to what a given day was supposed to be', () => {
    const s = st()
    startBlock(s, 'b')
    // A Monday sixty days back, under block A, is a push day; a Tuesday is a rest day.
    const monday = [...Array(70).keys()].map(n => iso(-n)).find(d => new Date(d + 'T12:00:00').getDay() === 1 && d < todayISO())
    const tuesday = [...Array(70).keys()].map(n => iso(-n)).find(d => new Date(d + 'T12:00:00').getDay() === 2 && d < todayISO())
    expect(effectiveRoutineId(s, monday)).toBe('push')
    expect(effectiveRoutineId(s, tuesday)).toBe(null)
    // The same weekdays in the future belong to block B, and swap over.
    const nextMon = [...Array(14).keys()].map(n => iso(n + 1)).find(d => new Date(d + 'T12:00:00').getDay() === 1)
    const nextTue = [...Array(14).keys()].map(n => iso(n + 1)).find(d => new Date(d + 'T12:00:00').getDay() === 2)
    expect(effectiveRoutineId(s, nextMon)).toBe(null)
    expect(effectiveRoutineId(s, nextTue)).toBe('upper')
  })

  it('leaves a per-day override on top of all of it', () => {
    const s = st()
    startBlock(s, 'b')
    s.dayPlan[iso(3)] = 'legs'
    expect(effectiveRoutineId(s, iso(3))).toBe('legs')
    s.dayPlan[iso(4)] = 'rest'
    expect(effectiveRoutineId(s, iso(4))).toBe(null)
  })
})

describe('a block that alternates', () => {
  const s = () => {
    const st = S()
    st.blocks = [{ id: 'ab', name: 'A/B', weeks: [{ 1: 'push', 4: 'pull' }, { 2: 'upper', 5: 'legs' }] }]
    st.blockLog = [{ from: iso(0), blockId: 'ab' }]
    return st
  }

  it('counts whole weeks from the day it was switched on', () => {
    const st = s()
    const b = st.blocks[0]
    expect(weekIndexAt(b, iso(0), iso(0))).toBe(0)
    expect(weekIndexAt(b, iso(0), iso(6))).toBe(0)     // still the first week
    expect(weekIndexAt(b, iso(0), iso(7))).toBe(1)     // over to the second
    expect(weekIndexAt(b, iso(0), iso(13))).toBe(1)
    expect(weekIndexAt(b, iso(0), iso(14))).toBe(0)    // and back round
  })

  it('hands out the right week’s schedule on each side of the change-over', () => {
    const st = s()
    expect(weekFor(st, iso(3))).toEqual({ 1: 'push', 4: 'pull' })
    expect(weekFor(st, iso(10))).toEqual({ 2: 'upper', 5: 'legs' })
  })

  it('never asks for a week that is not there', () => {
    const st = s()
    for (let d = 0; d < 60; d++) expect(weekFor(st, iso(d)), String(d)).toBeTruthy()
  })
})

describe('a switch dated ahead', () => {
  it('changes nothing until it lands', () => {
    const st = S({
      blocks: [{ id: 'a', name: 'A', weeks: [{ 1: 'push' }] }, { id: 'b', name: 'B', weeks: [{ 1: 'legs' }] }],
      blockLog: [{ from: iso(-30), blockId: 'a' }]
    })
    startBlock(st, 'b', iso(12))
    expect(weekFor(st, iso(0))).toEqual({ 1: 'push' })
    expect(weekFor(st, iso(11))).toEqual({ 1: 'push' })
    expect(weekFor(st, iso(12))).toEqual({ 1: 'legs' })
    expect(upcoming(st)).toHaveLength(1)
    expect(daysUntil(iso(12))).toBe(12)
  })

  it('can be called off while it is still ahead', () => {
    const st = S({
      blocks: [{ id: 'a', name: 'A', weeks: [{ 1: 'push' }] }, { id: 'b', name: 'B', weeks: [{ 1: 'legs' }] }],
      blockLog: [{ from: iso(-30), blockId: 'a' }]
    })
    startBlock(st, 'b', iso(12))
    cancelSwitch(st, iso(12))
    expect(upcoming(st)).toHaveLength(0)
    expect(weekFor(st, iso(20))).toEqual({ 1: 'push' })
  })

  it('does not stack a second entry on the same date', () => {
    const st = S({ blocks: [{ id: 'a', name: 'A', weeks: [{}] }, { id: 'b', name: 'B', weeks: [{}] }] })
    startBlock(st, 'a', iso(5))
    startBlock(st, 'b', iso(5))
    expect(st.blockLog.filter(e => e.from === iso(5))).toHaveLength(1)
    expect(entryAt(st, iso(5)).blockId).toBe('b')
  })
})

describe('housekeeping', () => {
  it('will not delete the block that is running', () => {
    const st = S({ blocks: [{ id: 'a', name: 'A', weeks: [{ 1: 'push' }] }], blockLog: [{ from: iso(0), blockId: 'a' }] })
    expect(removeBlock(st, 'a')).toBe(false)
    expect(st.blocks).toHaveLength(1)
  })

  it('takes a block’s switches with it when it goes', () => {
    const st = S({
      blocks: [{ id: 'a', name: 'A', weeks: [{ 1: 'push' }] }, { id: 'b', name: 'B', weeks: [{ 1: 'legs' }] }],
      blockLog: [{ from: iso(-5), blockId: 'a' }, { from: iso(6), blockId: 'b' }]
    })
    expect(removeBlock(st, 'b')).toBe(true)
    expect(st.blockLog).toHaveLength(1)
    expect(upcoming(st)).toHaveLength(0)
  })

  it('counts the sessions a block holds', () => {
    expect(sessionsIn({ weeks: [{ 1: 'a', 3: 'b' }, { 2: 'c' }] })).toBe(3)
  })

  it('survives the round trip through the database', () => {
    // RTDB turns the weeks list into an object keyed "0","1" and drops any empty week.
    const st = S({
      blocks: [{ id: 'ab', name: 'A/B', weeks: [{ 1: 'push' }, { 2: 'upper' }] }],
      blockLog: [{ from: iso(-3), blockId: 'ab' }]
    })
    const wire = JSON.parse(JSON.stringify(st))
    wire.blocks = { 0: { ...wire.blocks[0], weeks: { 0: { 1: 'push' }, 1: { 2: 'upper' } } } }
    wire.blockLog = { 0: wire.blockLog[0] }
    const back = hydrate(wire)
    expect(Array.isArray(back.blocks)).toBe(true)
    expect(Array.isArray(back.blocks[0].weeks)).toBe(true)
    expect(weekFor(back, iso(0))).toEqual(weekFor(st, iso(0)))
  })

  it('drops a block pointing at a routine that no longer exists', () => {
    const st = S({ blocks: [{ id: 'a', name: 'A', weeks: [{ 1: 'push', 2: 'ghost' }] }], blockLog: [{ from: iso(-3), blockId: 'a' }] })
    const back = hydrate(JSON.parse(JSON.stringify(st)))
    expect(back.blocks[0].weeks[0]).toEqual({ 1: 'push' })
  })
})

describe('setting up the week that is not running yet', () => {
  const st = () => S({
    blocks: [{ id: 'ab', name: 'A/B', weeks: [{ 1: 'push' }, { 2: 'upper' }] }],
    blockLog: [{ from: iso(0), blockId: 'ab' }]
  })

  it('shows whichever week the editor asks for', () => {
    const s = st()
    expect(weekOfBlock(s, null)).toEqual({ 1: 'push' })     // the one running
    expect(weekOfBlock(s, 0)).toEqual({ 1: 'push' })
    expect(weekOfBlock(s, 1)).toEqual({ 2: 'upper' })       // the one still to come
  })

  it('writes into the week the editor is showing, not the one running', () => {
    const s = st()
    setWeekDay(s, 4, 'legs', { weekIdx: 1 })
    expect(s.blocks[0].weeks[1]).toEqual({ 2: 'upper', 4: 'legs' })
    expect(s.blocks[0].weeks[0]).toEqual({ 1: 'push' })     // untouched
    expect(weekFor(s, iso(0))).toEqual({ 1: 'push' })       // and so is what today reads
    expect(weekFor(s, iso(7))).toEqual({ 2: 'upper', 4: 'legs' })
  })

  it('cannot be pointed at a week that does not exist', () => {
    const s = st()
    setWeekDay(s, 4, 'legs', { weekIdx: 9 })
    expect(s.blocks[0].weeks).toHaveLength(2)
    expect(s.blocks[0].weeks[1][4]).toBe('legs')            // clamped to the last one
  })
})

describe('building a second block without wrecking the first', () => {
  // The gap the first version left: with a block running, the only way to a second one was to
  // edit the running week and snapshot it — which destroys the programme being followed.
  const st = () => S({
    blocks: [{ id: 'a', name: 'Hypertrophie', weeks: [{ 1: 'push', 3: 'pull', 5: 'legs' }] }],
    blockLog: [{ from: iso(-30), blockId: 'a' }]
  })

  it('copies one under a new name, leaving the original alone', () => {
    const s = st()
    const copy = duplicateBlock(s, 'a', 'Force')
    expect(copy.name).toBe('Force')
    expect(copy.weeks).toEqual([{ 1: 'push', 3: 'pull', 5: 'legs' }])
    expect(copy.id).not.toBe('a')
    setWeekDay(s, 1, 'upper', { blockId: copy.id })
    expect(copy.weeks[0][1]).toBe('upper')
    expect(s.blocks[0].weeks[0][1]).toBe('push')      // the original is untouched
  })

  it('starts an empty one when nothing should carry over', () => {
    const s = st()
    const b = emptyBlock(s, 'Deload')
    expect(b.weeks).toEqual([{}])
    expect(s.blocks).toHaveLength(2)
  })

  it('edits a block that is not running, and changes nothing until it is', () => {
    const s = st()
    const copy = duplicateBlock(s, 'a', 'Force')
    setWeekDay(s, 2, 'upper', { blockId: copy.id })
    // Today still reads the block being followed, whatever the editor is pointed at.
    expect(weekFor(s, iso(0))).toEqual({ 1: 'push', 3: 'pull', 5: 'legs' })
    expect(weekFor(s, iso(20))).toEqual({ 1: 'push', 3: 'pull', 5: 'legs' })
    startBlock(s, copy.id, iso(7))
    expect(weekFor(s, iso(6))).toEqual({ 1: 'push', 3: 'pull', 5: 'legs' })
    expect(weekFor(s, iso(7))).toEqual({ 1: 'push', 2: 'upper', 3: 'pull', 5: 'legs' })
  })

  it('shows a non-running block’s week to the editor', () => {
    const s = st()
    const copy = duplicateBlock(s, 'a', 'Force')
    copy.weeks = [{ 2: 'upper' }, { 4: 'legs' }]
    expect(weekOfBlock(s, null, copy.id)).toEqual({ 2: 'upper' })   // the first, none being live
    expect(weekOfBlock(s, 1, copy.id)).toEqual({ 4: 'legs' })
    expect(weekOfBlock(s, null, null)).toEqual({ 1: 'push', 3: 'pull', 5: 'legs' })
  })
})
