// A daily supplement, ticked where you are already standing.
//
// Creatine is the one supplement with enough evidence behind it to be worth taking every day,
// and taking it every day is the entire difficulty: it works by saturation, so a dose missed
// on Tuesday is not made up by a double one on Wednesday — it just lowers the average. The
// failure mode is never "I decided not to", it is "I forgot, and I forgot that I forgot".
//
// So the prompt lives on the intake sheet rather than in a notification. Logging the day's
// calories is a thing that already happens every evening; anything hung off it is asked at a
// moment that already exists, which is the only kind of reminder that survives a fortnight.
//
//   supp      { '2026-08-27': 1 }   the days it was taken
//   suppOn    whether to ask at all
//   suppName  what to call it, for someone whose daily thing is not creatine
//
// A day that is absent means "not answered", not "no" — the same rule as everywhere else
// here. It is why the streak counts back from the last answered day rather than from today:
// at four in the afternoon an unanswered today is not a broken streak.

import { isoOf, todayISO } from './format.js'
import { t } from './i18n.js'

const DAY = 86400000

export const suppOn = S => (S && S.suppOn) !== false
export const suppName = S => ((S && S.suppName) || '').trim() || t('Creatine')

/** Whether it was taken on a day: true, false, or null for a day nobody answered. */
export function tookOn(S, iso) {
  const v = S && S.supp && S.supp[iso]
  return v === undefined || v === null ? null : !!v
}

/** Record an answer, or clear it. Call inside store.update. */
export function setTook(S, iso, v) {
  S.supp = { ...(S.supp || {}) }
  if (v == null) delete S.supp[iso]
  else S.supp[iso] = v ? 1 : 0
  return S.supp
}

/**
 * Days in a row, counting back from the last day that was answered.
 *
 * Starting at today would break the streak every morning and mend it every evening, which
 * makes the number useless exactly when it is being looked at. An unanswered today is simply
 * not yet part of the count.
 */
export function suppStreak(S, now = Date.now()) {
  if (!S || !S.supp) return 0
  let d = new Date(now)
  if (tookOn(S, isoOf(d)) == null) d = new Date(now - DAY)   // today not answered yet
  let n = 0
  for (;;) {
    const iso = isoOf(d)
    if (tookOn(S, iso) !== true) break
    n++
    d = new Date(d.getTime() - DAY)
  }
  return n
}

/** How often it was actually taken over a window — the figure a streak cannot tell you. */
export function suppRate(S, days = 30, now = Date.now()) {
  if (!S || !S.supp) return null
  let taken = 0, answered = 0
  for (let i = 1; i <= days; i++) {
    const v = tookOn(S, isoOf(new Date(now - i * DAY)))
    if (v == null) continue
    answered++
    if (v) taken++
  }
  return answered ? { taken, answered, days, pct: Math.round((taken / answered) * 100) } : null
}

/** Has today been answered? What the prompt asks itself before asking you. */
export const answeredToday = (S, now = Date.now()) => tookOn(S, isoOf(new Date(now))) != null
export const TODAY = todayISO
