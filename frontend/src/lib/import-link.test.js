import { describe, it, expect } from 'vitest'
import { payloadFromQuery } from '../lib/import-link.js'
import { parseHealth } from './health.js'

// The link is the whole handover. Every one of these is a URL a Shortcut can build with one
// Open URL action and no escaping — which is the reason the query is named values, not JSON.
describe('payloadFromQuery — what a Shortcut can hand over in a link', () => {
  it('reads a finished session', () => {
    const p = parseHealth(payloadFromQuery('sport=612&min=47'))
    expect(p.workout).toMatchObject({ kcal: 612, minutes: 47 })
  })

  it('reads a day', () => {
    const p = parseHealth(payloadFromQuery('steps=9420&kcal=740&rhr=52'))
    expect(p).toMatchObject({ steps: 9420, kcal: 740, rhr: 52 })
  })

  it('reads a night as two clock times, or as hours', () => {
    expect(parseHealth(payloadFromQuery('bed=23:14&wake=07:02'))).toMatchObject({ bed: '23:14', wake: '07:02' })
    expect(parseHealth(payloadFromQuery('sleep=7.25'))).toMatchObject({ sleepHours: 7.25 })
  })

  it('reads what was eaten and what the scale said', () => {
    expect(parseHealth(payloadFromQuery('intake=1940&p=150&c=180&f=60')))
      .toMatchObject({ intake: 1940, protein: 150, carbs: 180, fat: 60 })
    expect(parseHealth(payloadFromQuery('weight=79.5&bf=22'))).toMatchObject({ weight: 79.5, bodyFat: 22 })
  })

  it('files it under the day it names, or today', () => {
    expect(parseHealth(payloadFromQuery('steps=9420&date=2026-08-11')).d).toBe('2026-08-11')
    expect(parseHealth(payloadFromQuery('steps=9420')).d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('still takes the JSON a Shortcut already builds, raw or base64', () => {
    const json = '{"steps":9420,"active_kcal":740}'
    expect(payloadFromQuery('d=' + encodeURIComponent(json))).toEqual({ steps: 9420, active_kcal: 740 })
    expect(payloadFromQuery('b=' + btoa(json))).toEqual({ steps: 9420, active_kcal: 740 })
  })

  it('does not turn a plus sign into a space', () => {
    // A Shortcut writes what the watch gave it; URLSearchParams would read "7+" as "7 ".
    expect(payloadFromQuery('type=HIIT+cardio').workout.type).toBe('HIIT+cardio')
  })

  it('ignores a query with nothing in it for us', () => {
    for (const q of ['', 'utm_source=x', '&&', 'sport=']) expect(payloadFromQuery(q)).toBe(null)
  })

  it('survives a link someone mangled', () => {
    expect(payloadFromQuery('d=not json')).toBe(null)
    expect(payloadFromQuery('b=!!!!')).toBe(null)
    expect(() => payloadFromQuery('steps=%E0%A4%A')).not.toThrow()
  })

  // A Health variable is display text, not a number. This is what actually lands in the URL
  // when someone drops "Active Energy" and "Duration" into it, and it used to read as empty.
  it('takes a value with its unit still attached', () => {
    const p = parseHealth(payloadFromQuery('sport=612 kcal&min=47 min'))
    expect(p.workout).toMatchObject({ kcal: 612, minutes: 47 })
  })

  it('reads a duration however the watch formatted it', () => {
    for (const [v, min] of [['0:47:00', 47], ['47 min', 47], ['1:12:30', 72.5], ['2h 38m', 158], ['47', 47]])
      expect(parseHealth(payloadFromQuery('min=' + v)).workout.minutes).toBe(Math.round(min))
  })

  it('reads a French decimal comma', () => {
    expect(parseHealth(payloadFromQuery('weight=79,5 kg')).weight).toBe(79.5)
    expect(parseHealth(payloadFromQuery('sleep=7,25 h')).sleepHours).toBe(7.25)
  })

  it('leaves a clock time and a date alone', () => {
    // "23:14" is not a duration; stripped to digits it would become one.
    expect(parseHealth(payloadFromQuery('bed=23:14&wake=07:02'))).toMatchObject({ bed: '23:14', wake: '07:02' })
    expect(parseHealth(payloadFromQuery('steps=9420&date=2026-08-11')).d).toBe('2026-08-11')
  })

  it('still calls a link with only empty variables empty', () => {
    // The variables were never dropped in, or the action they came from found nothing.
    expect(payloadFromQuery('sport=&min=')).toBe(null)
    expect(payloadFromQuery('sport=%20&min=')).toBe(null)
  })
})
