// The energy balance of a day, and what it adds up to over a cut.
//
// The formula is the one a person actually runs a cut on:
//
//     deficit = (TDEE + sport) − intake
//
// TDEE here is expenditure *without training* — what the body spends existing and getting
// through an ordinary day. Training is added on top, from what the watch measured, because
// the cost of a session is the part that swings hardest day to day and the part a plan
// changes on purpose.
//
// That split has one trap and it is worth naming, because it is the reason cuts stall for
// no visible reason: a TDEE taken from a formula with an activity multiplier (Mifflin-St
// Jeor × 1.55 and friends) *already contains* the training. Adding sport on top of that
// counts it twice, and every day's deficit then reads 300–600 kcal larger than it is. So
// the field asks for the sedentary figure — and impliedTDEE() below hands back the number
// your own weight curve says is true, which beats every formula ever published.
//
// Nothing here is stored. Totals are derived on read from the intake log, the watch figures
// and the weigh-ins, so correcting a Tuesday corrects every total that used it.

import { entryFor } from './nutrition.js'
import { healthFor } from './health.js'
import { isoOf, todayISO } from './format.js'

const num = v => (Number.isFinite(+v) && +v > 0 ? +v : null)
const inWindow = (iso, days, now) =>
  !days || new Date(iso + 'T12:00:00').getTime() > now - days * 86400000
const dayNum = iso => new Date(iso + 'T12:00:00').getTime() / 86400000

/**
 * The last day a total is allowed to include. A day still being lived is not a data point:
 * at four in the afternoon the intake log holds lunch and nothing else, and counting it
 * would report a 1 500 kcal deficit that dinner is about to erase. Every total on this page
 * therefore stops at yesterday unless a caller names the day it is closing.
 */
const lastFinished = now => isoOf(new Date(now - 86400000))

// Below the first a body would be dying; above the second it is a Tour de France stage.
// Refused rather than stored — a mistyped TDEE poisons every total on this page at once.
export const TDEE_MIN = 800
export const TDEE_MAX = 6000

/**
 * Energy in a kilogram of body fat. Wishnofsky's figure — 3 500 kcal per pound — and the
 * one every "500 a day is a pound a week" rule of thumb comes from.
 *
 * It is an approximation and it errs one way: it assumes expenditure holds still while you
 * get lighter, which it does not, so over months it predicts more loss than the scale
 * delivers. That gap is not noise to be hidden — it is the signal impliedTDEE() reads.
 */
export const KCAL_PER_KG_FAT = 7700

export const validTDEE = v => {
  const n = num(v)
  return n != null && n >= TDEE_MIN && n <= TDEE_MAX ? Math.round(n) : null
}

/**
 * What training cost on a given day, and where the figure came from — the source travels
 * with the number because they are not equally trustworthy.
 *
 * A watch's all-day active energy is preferred over the session's own figure: it is the
 * whole of what was moved, which is exactly what "TDEE at rest, plus everything else"
 * needs, and using the session alone would drop the walk home. A day with a logged session
 * but no energy figure anywhere reports 'missing' rather than quietly passing 0 — that day's
 * deficit is understated and the totals say so.
 */
export function sportKcal(S, iso) {
  const hd = healthFor(S, iso)
  const day = num(hd && hd.kcal)
  if (day != null) return { kcal: Math.round(day), source: 'watch' }
  const w = (S.workouts || []).find(x => x.d === iso && num(x.watch && x.watch.kcal) != null)
  if (w) return { kcal: Math.round(w.watch.kcal), source: 'session' }
  const trained = (S.workouts || []).some(x => x.d === iso)
  return { kcal: 0, source: trained ? 'missing' : 'rest' }
}

/**
 * One day's balance, or null when there is no TDEE to compute it against.
 *
 * `deficit` is null on a day with no intake logged — not zero. A day nobody logged is a day
 * nobody knows about, and calling it a break-even day would quietly credit the cut with a
 * deficit of exactly TDEE, which is the largest lie the arithmetic can tell.
 */
export function dayBalance(S, iso, tdee = S.tdee) {
  const rest = validTDEE(tdee)
  if (rest == null) return null
  const e = entryFor(S, iso)
  const intake = num(e && e.kcal)
  const sp = sportKcal(S, iso)
  const out = rest + sp.kcal
  return {
    d: iso,
    tdee: rest,
    sport: sp.kcal,
    sportSource: sp.source,
    out,
    intake: intake == null ? null : Math.round(intake),
    deficit: intake == null ? null : Math.round(out - intake)
  }
}

/**
 * The deficit since the beginning, split the three ways it is worth splitting:
 *
 *   nutrition  Σ (TDEE − intake)   what eating alone created
 *   sport      Σ sport             what training alone created
 *   total      nutrition + sport   the two together
 *
 * All three run over the same day set — the days that logged an intake — because that is
 * the only set on which the combined figure means anything, and three numbers that do not
 * add up are worse than two that do. Days with a session but no energy figure are counted
 * with a sport of 0 and reported separately: their deficit is real but understated.
 *
 * `span` is how many calendar days the run covers, so `days / span` is the coverage. A
 * total drawn from 30 logged days out of 90 is not a total of the cut, and the card that
 * prints it has to be able to say so.
 *
 * `through` names the last day to count, for a caller closing a day out — the evening digest
 * passes the day it is reporting. Everything else stops at yesterday; see lastFinished.
 */
export function deficitTotals(S, tdee = S.tdee, days = 0, now = Date.now(), through = null) {
  const rest = validTDEE(tdee)
  if (rest == null) return null
  const end = through || lastFinished(now)
  const list = (S.nutrition || []).filter(e => num(e.kcal) != null && e.d <= end && inWindow(e.d, days, now))
  if (!list.length) return null

  let nutrition = 0, sport = 0, unmeasured = 0
  list.forEach(e => {
    const b = dayBalance(S, e.d, rest)
    nutrition += rest - b.intake
    sport += b.sport
    if (b.sportSource === 'missing') unmeasured++
  })
  const total = nutrition + sport
  const from = list[0].d, to = list[list.length - 1].d
  return {
    from, to,
    days: list.length,
    span: Math.round(dayNum(to) - dayNum(from)) + 1,
    nutrition: Math.round(nutrition),
    sport: Math.round(sport),
    total: Math.round(total),
    perDay: Math.round(total / list.length),
    kg: Math.round((total / KCAL_PER_KG_FAT) * 100) / 100,
    unmeasured
  }
}

/* ------------------------------------------------------ what the scale says instead -- */

// A shorter run than this is water, not fat: a single salty dinner moves the scale further
// than a week of a 500 kcal deficit does.
export const IMPLIED_MIN_SPAN = 21
export const IMPLIED_MIN_WEIGHINS = 4
export const IMPLIED_MIN_DAYS = 14
// Below this share of the days logged, the mean intake is drawn from a chosen subset rather
// than from the period — and the days people skip are not the average ones.
export const IMPLIED_MIN_COVERAGE = 0.6

// Least squares through the weigh-ins: every reading gets a say, which is the point. Two
// endpoints would let one salty Sunday set the whole slope.
function slopePerDay(points) {
  const n = points.length
  const mx = points.reduce((a, p) => a + p.x, 0) / n
  const my = points.reduce((a, p) => a + p.y, 0) / n
  let top = 0, bot = 0
  points.forEach(p => { top += (p.x - mx) * (p.y - my); bot += (p.x - mx) ** 2 })
  return bot ? top / bot : null
}

/**
 * The TDEE your own history implies, which is worth more than any formula: the weight curve
 * and the intake log between them already know what maintenance is.
 *
 *   expenditure = mean intake + (weight lost × 7 700) / days
 *   TDEE at rest = expenditure − mean sport
 *
 * Returns null, with a reason, whenever the inputs cannot carry the claim — too short a
 * run, too few weigh-ins, too few logged days, or a log that covers too little of the
 * period. Every one of those failures produces a confident-looking number if you let it,
 * and a wrong maintenance figure is worse than none: it is the input to everything else.
 */
export function impliedTDEE(S, days = 0, now = Date.now()) {
  const weighIns = (S.bodyweight || [])
    .filter(b => num(b.w) != null && inWindow(b.d, days, now))
    .map(b => ({ x: dayNum(b.d), y: num(b.w), d: b.d }))
  if (weighIns.length < IMPLIED_MIN_WEIGHINS) return { tdee: null, why: 'weighIns', weighIns: weighIns.length }

  const from = weighIns[0].d, to = weighIns[weighIns.length - 1].d
  const span = Math.round(weighIns[weighIns.length - 1].x - weighIns[0].x)
  if (span < IMPLIED_MIN_SPAN) return { tdee: null, why: 'span', span }

  // Intake only counts inside the span the weigh-ins actually cover: a month of logging
  // either side of it says nothing about the weight change being explained.
  // Today is left out for the same reason it is left out of the totals: a day in progress
  // would drag the mean intake down and hand back a maintenance figure that is too low.
  const end = to < lastFinished(now) ? to : lastFinished(now)
  const logged = (S.nutrition || []).filter(e => num(e.kcal) != null && e.d >= from && e.d <= end)
  if (logged.length < IMPLIED_MIN_DAYS) return { tdee: null, why: 'days', days: logged.length }
  const coverage = logged.length / (span + 1)
  if (coverage < IMPLIED_MIN_COVERAGE) return { tdee: null, why: 'coverage', coverage, days: logged.length, span }

  const slope = slopePerDay(weighIns)
  if (slope == null) return { tdee: null, why: 'span', span }

  const meanIntake = logged.reduce((a, e) => a + num(e.kcal), 0) / logged.length
  const meanSport = logged.reduce((a, e) => a + sportKcal(S, e.d).kcal, 0) / logged.length
  // A negative slope is weight lost, which is expenditure the intake did not cover.
  const expenditure = meanIntake - slope * KCAL_PER_KG_FAT
  const tdee = validTDEE(Math.round(expenditure - meanSport))

  return {
    tdee, why: tdee == null ? 'range' : null,
    from, to, span, coverage: Math.round(coverage * 100) / 100,
    days: logged.length, weighIns: weighIns.length,
    expenditure: Math.round(expenditure),
    meanIntake: Math.round(meanIntake),
    meanSport: Math.round(meanSport),
    kgPerWeek: Math.round(slope * 7 * 100) / 100
  }
}

/**
 * What the deficit predicted, against what the scale actually did — the one reading on this
 * page that can tell you the TDEE is wrong, and by how much.
 *
 * The two never match exactly and are not supposed to: 7 700 kcal per kilo assumes an
 * expenditure that does not fall as you get lighter. A gap of a kilo over three months is
 * the model behaving; a gap of four is a maintenance figure that needs correcting.
 */
export function predictedVsActual(S, tdee = S.tdee, days = 0, now = Date.now()) {
  const tot = deficitTotals(S, tdee, days, now)
  if (!tot) return null
  const weighIns = (S.bodyweight || [])
    .filter(b => num(b.w) != null && b.d >= tot.from && b.d <= tot.to)
  if (weighIns.length < 2) return null
  const actual = Math.round((weighIns[weighIns.length - 1].w - weighIns[0].w) * 100) / 100
  const predicted = Math.round(-tot.kg * 100) / 100
  return {
    predicted, actual,
    gap: Math.round((actual - predicted) * 100) / 100,
    from: weighIns[0].d, to: weighIns[weighIns.length - 1].d,
    weighIns: weighIns.length
  }
}

/** Chart points for the daily deficit, oldest first. Only finished days that can be computed. */
export const deficitSeries = (S, tdee = S.tdee, days = 0, now = Date.now(), through = null) =>
  (S.nutrition || [])
    .filter(e => num(e.kcal) != null && e.d <= (through || lastFinished(now)) && inWindow(e.d, days, now))
    .map(e => ({ b: dayBalance(S, e.d, tdee), d: e.d }))
    .filter(x => x.b && x.b.deficit != null)
    .map(x => ({ t: new Date(x.d + 'T12:00:00').getTime(), y: x.b.deficit, d: x.d }))

/** Today's balance, the reading that changes what you eat tonight — a day in progress, and
 *  the one place on this page that is meant to be. */
export const todayBalance = (S, tdee = S.tdee) => dayBalance(S, todayISO(), tdee)
