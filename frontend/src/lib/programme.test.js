import { describe, it, expect } from 'vitest'
import { importProgramme } from './plan-share.js'
import { parseProgram, applyPicks } from './plan-import.js'
import { weekFor, routineGroups, routinesFor, nextMonday, blockAt } from './blocks.js'
import { todayISO, isoOf } from './format.js'

const today = todayISO()
const shift = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const monday = nextMonday(today)

// The profile in the request: four sessions on the plain weekly schedule, trained for weeks,
// one day already moved on purpose — and a new programme on the way with the same four names.
function profile() {
  const r = (id, name, exId) => ({ id, name, emoji: 'dumbbell', ex: [{ id: exId, sets: 4, reps: 8 }] })
  const w = (d, rid, name) => ({ id: 'w' + d, d, routineId: rid, name, entries: [], vol: 0 })
  return {
    routines: [r('p1', 'Push', '0025'), r('p2', 'Pull', '2330'), r('p3', 'Legs A', '0043'), r('p4', 'Legs B', '0085')],
    week: { 1: 'p1', 3: 'p2', 5: 'p3', 6: 'p4' },
    dayPlan: { [shift(monday, 2)]: 'p3', [shift(today, -3)]: 'p1' },
    workouts: [w(shift(today, -40), 'p1', 'Push'), w(shift(today, -38), 'p2', 'Pull'), w(shift(today, -2), 'p3', 'Legs A')],
    blocks: [], blockLog: [], customEx: [], exWeights: {}
  }
}
const CSV = [
  'Séance;Exercice;Séries;Reps',
  'Push;Développé incliné haltères;4;8-10', 'Pull;Rowing barre;4;8', 'Legs A;Presse à cuisses;4;12', 'Legs B;Leg curl;3;12'
].join('\n')

describe('importProgramme — a new programme with the same session names', () => {
  it('runs the new programme from its date, with the week read by name off the one it replaces', () => {
    const S = profile()
    const { bundle } = parseProgram(CSV)
    const res = importProgramme(S, bundle, { name: 'Programme Octobre', from: monday })
    const byName = n => res.added.find(r => r.name === n).id
    expect(weekFor(S, monday)).toEqual({ 1: byName('Push'), 3: byName('Pull'), 5: byName('Legs A'), 6: byName('Legs B') })
    expect(res.weekFromNames).toBe(true)
    expect(res.unplaced).toEqual([])
    expect(blockAt(S, monday).block.name).toBe('Programme Octobre')
  })

  it('leaves every day before the switch exactly as it was', () => {
    const S = profile()
    importProgramme(S, parseProgram(CSV).bundle, { from: monday })
    expect(weekFor(S, shift(monday, -1))).toMatchObject({ 1: 'p1', 3: 'p2', 5: 'p3', 6: 'p4' })
    expect(weekFor(S, shift(today, -30))).toMatchObject({ 1: 'p1', 3: 'p2', 5: 'p3', 6: 'p4' })
    // the plain schedule itself is never rewritten — it is what the past is read from
    expect(S.week).toEqual({ 1: 'p1', 3: 'p2', 5: 'p3', 6: 'p4' })
  })

  it('keeps the old programme whole, as a programme of its own dated from its first session', () => {
    const S = profile()
    const res = importProgramme(S, parseProgram(CSV).bundle, { from: monday })
    expect(res.prev.weeks[0]).toEqual({ 1: 'p1', 3: 'p2', 5: 'p3', 6: 'p4' })
    expect(S.blockLog[0]).toEqual({ from: shift(today, -40), blockId: res.prev.id })
    expect(S.routines.filter(r => r.block === res.prev.id).map(r => r.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(res.added.every(r => r.block === res.block.id)).toBe(true)
  })

  it('moves a day already moved from the switch onward onto the new session of that name — and none before it', () => {
    const S = profile()
    const res = importProgramme(S, parseProgram(CSV).bundle, { from: monday })
    expect(S.dayPlan[shift(monday, 2)]).toBe(res.added.find(r => r.name === 'Legs A').id)
    expect(S.dayPlan[shift(today, -3)]).toBe('p1')
    expect(res.moved).toBe(1)
  })

  it('takes the week a programme names over the one it replaces', () => {
    const S = profile()
    const csv = 'Jour;Séance;Exercice;Séries;Reps\nMardi;Push;Dips;3;10\nJeudi;Pull;Tractions;3;8'
    const res = importProgramme(S, parseProgram(csv).bundle, { from: monday })
    expect(weekFor(S, monday)).toEqual({ 2: res.added[0].id, 4: res.added[1].id })
    expect(res.weekFromNames).toBe(false)
  })

  it('says which of the old days found no session of the same name', () => {
    const S = profile()
    const res = importProgramme(S, parseProgram('Séance;Exercice\nPush;Dips\nPull;Tractions').bundle, { from: monday })
    expect(res.unplaced).toEqual(['Legs A', 'Legs B'])
  })

  it('files a programme for later without switching anything', () => {
    const S = profile()
    const res = importProgramme(S, parseProgram(CSV).bundle, { name: 'Plus tard', from: null })
    expect(res.prev).toBe(null)
    expect(S.blockLog).toEqual([])
    expect(weekFor(S, monday)).toEqual({ 1: 'p1', 3: 'p2', 5: 'p3', 6: 'p4' })
    expect(S.blocks.map(b => b.name)).toEqual(['Plus tard'])
  })

  it('on a profile already running a programme, replaces that one from the date and makes no second copy', () => {
    const S = profile()
    S.blocks = [{ id: 'b0', name: 'Bloc été', emoji: 'dumbbell', weeks: [{ 1: 'p1', 3: 'p2' }] }]
    S.blockLog = [{ from: shift(today, -60), blockId: 'b0' }]
    const res = importProgramme(S, parseProgram(CSV).bundle, { from: monday })
    expect(res.prev.id).toBe('b0')
    expect(S.blocks).toHaveLength(2)
    expect(weekFor(S, monday)).toEqual({ 1: res.added[0].id, 3: res.added[1].id })
    expect(S.blockLog.map(e => e.blockId)).toEqual(['b0', res.block.id])
  })
})

describe('routines by programme', () => {
  it('a profile with no programme sees every routine in one group, as before', () => {
    const S = profile()
    expect(routineGroups(S)).toEqual([{ block: null, status: 'running', routines: S.routines }])
    expect(routinesFor(S).others).toEqual([])
  })

  it('files the old and the new programme apart, the one in force first', () => {
    const S = profile()
    const res = importProgramme(S, parseProgram(CSV).bundle, { name: 'Programme Octobre', from: monday })
    const before = routineGroups(S, today)
    expect(before[0]).toMatchObject({ status: 'running' })
    expect(before[0].block.id).toBe(res.prev.id)
    expect(before[0].routines.map(r => r.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(before[1]).toMatchObject({ status: 'upcoming', from: monday })
    expect(before[1].routines.map(r => r.name)).toEqual(['Push', 'Pull', 'Legs A', 'Legs B'])
    const after = routineGroups(S, monday)
    expect(after[0].block.id).toBe(res.block.id)
    expect(after[1]).toMatchObject({ status: 'other' })
  })

  it('offers the routines of the programme in force on the day asked about', () => {
    const S = profile()
    const res = importProgramme(S, parseProgram(CSV).bundle, { from: monday })
    const newIds = res.added.map(r => r.id)
    expect(routinesFor(S, monday).mine.map(r => r.id)).toEqual(newIds)
    expect(routinesFor(S, monday).others.map(r => r.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
    // writing up last week's session offers last week's programme
    expect(routinesFor(S, shift(today, -7)).mine.map(r => r.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('keeps a routine that belongs to no programme on offer everywhere', () => {
    const S = profile()
    S.routines.push({ id: 'abs', name: 'Abdos', ex: [] })
    importProgramme(S, parseProgram(CSV).bundle, { from: monday })
    expect(routinesFor(S, monday).mine.some(r => r.id === 'abs')).toBe(true)
    expect(routineGroups(S, monday).pop()).toMatchObject({ status: 'loose' })
  })
})

describe('applyPicks', () => {
  it('points a stand-in at the exercise chosen for it and drops the stand-in', () => {
    const { bundle, report } = parseProgram('Séance;Exercice\nPush;Hip thrust\nPush;Dips')
    const stand = report.created[0].id
    const out = applyPicks(bundle, { [stand]: '1409' })
    expect(out.routines[0].ex[0].id).toBe('1409')
    expect(out.customEx).toEqual([])
    expect(applyPicks(bundle, {})).toBe(bundle)
  })
})

describe('nextMonday', () => {
  it('is the Monday after a day, or the day itself when asked and it is one', () => {
    expect(nextMonday('2026-10-01')).toBe('2026-10-05')
    expect(nextMonday('2026-10-05')).toBe('2026-10-12')
    expect(nextMonday('2026-10-05', true)).toBe('2026-10-05')
    expect(nextMonday('2026-10-04')).toBe('2026-10-05')
  })
})

describe('programmeOf / routinesForBlock', () => {
  it('names the programme a routine belongs to, and offers a programme’s own routines first', async () => {
    const { programmeOf, routinesForBlock } = await import('./blocks.js')
    const S = profile()
    const res = importProgramme(S, parseProgram(CSV).bundle, { name: 'Octobre', from: monday })
    expect(programmeOf(S, S.routines.find(r => r.id === 'p1')).id).toBe(res.prev.id)
    expect(programmeOf(S, res.added[0]).name).toBe('Octobre')
    const pick = routinesForBlock(S, res.block.id)
    expect(pick.mine.map(r => r.id)).toEqual(res.added.map(r => r.id))
    expect(pick.others.map(r => r.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
})
