// The energy balance of a day, and what it adds up to over a cut.
//
// Maintenance is entered as its parts, because that is how it is actually arrived at and
// because a single number hides which part is wrong when the total turns out to be:
//
//     BMR + NEAT + other + planned sport = daily expenditure
//
// The planned-sport part is the one that changes the arithmetic. It says the maintenance
// figure *already budgets for training* — so a day of training as planned is a day at
// maintenance, and only the difference between what was planned and what was actually done
// moves the balance:
//
//     deficit = (total + (sport done − sport planned)) − intake
//
// Train as planned and the sport term is zero. Skip a session and it goes negative, which
// is correct and is the reading nothing else in the app gives you: the day cost less than
// the budget assumed, so the deficit is smaller than the food alone suggests.
//
// A profile that stored a single number carries the old meaning — expenditure without
// training — which is exactly a breakdown with nothing budgeted for sport, so it keeps
// working untouched.
//
// Nothing here is stored. Totals are derived on read from the intake log, the watch figures
// and the weigh-ins, so correcting a Tuesday corrects every total that used it.

import { entryFor } from './nutrition.js'
import { healthFor } from './health.js'
import { isoOf, todayISO } from './format.js'

const num = v => (Number.isFinite(+v) && +v > 0 ? +v : null)
const num0 = v => (Number.isFinite(+v) && +v > 0 ? +v : 0)
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
// Refused rather than stored — a mistyped total poisons every reading on the page at once.
export const TDEE_MIN = 800
export const TDEE_MAX = 6000
export const TDEE_PARTS = ['bmr', 'neat', 'other', 'sport']

/**
 * Energy in a kilogram of body fat. Wishnofsky's figure — 3 500 kcal per pound — and the
 * one every "500 a day is a pound a week" rule of thumb comes from.
 *
 * It is an approximation and it errs one way: it assumes expenditure holds still while you
 * get lighter, which it does not, so over months it predicts more loss than the scale
 * delivers. That gap is not noise to be hidden — it is the signal impliedTDEE() reads.
 */
export const KCAL_PER_KG_FAT = 7700

/**
 * How much of a watch's active-energy figure to throw away.
 *
 * Consumer wrist devices are good at heart rate and poor at energy: validation work puts
 * their heart-rate error in the low single digits of a percent and their energy error in the
 * twenties to forties, almost always high. Thirty percent is the middle of that range and a
 * deliberately blunt instrument — the point is not to be exact, it is to stop a cut being
 * planned around four hundred calories that were never burned.
 *
 * It applies to what the watch reported and to nothing else. Set it to zero to trust the
 * watch as it comes.
 */
export const WATCH_TRIM = 0.3
export const TRIM_MAX = 0.6

export const validTrim = v =>
  (Number.isFinite(+v) && +v >= 0 && +v <= TRIM_MAX ? Math.round(+v * 100) / 100 : WATCH_TRIM)

/** The trim this profile is using — an explicit zero is a choice, not a missing value. */
export const trimOf = S => validTrim(S && S.watchTrim != null ? S.watchTrim : WATCH_TRIM)

export const validTDEE = v => {
  const n = num(v)
  return n != null && n >= TDEE_MIN && n <= TDEE_MAX ? Math.round(n) : null
}

/**
 * Maintenance broken into its parts, with the total, or null when there is nothing usable.
 * A bare number is read as a profile written before the breakdown existed: it meant
 * expenditure without training, which is a breakdown with nothing budgeted for sport.
 */
export function tdeeParts(v) {
  if (v == null) return null
  if (typeof v === 'number' || typeof v === 'string') {
    const n = validTDEE(v)
    return n == null ? null : { bmr: 0, neat: 0, other: n, sport: 0, total: n }
  }
  if (typeof v !== 'object') return null
  const p = {}
  TDEE_PARTS.forEach(k => { p[k] = Math.round(num0(v[k])) })
  const total = validTDEE(TDEE_PARTS.reduce((a, k) => a + p[k], 0))
  return total == null ? null : { ...p, total }
}

/**
 * What training actually cost on a given day, and where the figure came from — the source
 * travels with the number because they are not equally trustworthy, and `raw` travels with
 * it because a trimmed figure that cannot be traced back to what the watch said is a number
 * nobody can check.
 *
 * A watch's all-day active energy is preferred over the session's own figure: it is the
 * whole of what was moved, and using the session alone would drop the walk home. A day with
 * a logged session but no energy figure anywhere reports 'missing' rather than quietly
 * passing 0 — that day's balance is understated and the totals say so.
 */
export function sportKcal(S, iso, trim = WATCH_TRIM) {
  const t = validTrim(trim)
  const cut = (raw, source) => ({ kcal: Math.round(raw * (1 - t)), raw: Math.round(raw), trim: t, source })
  const hd = healthFor(S, iso)
  const day = num(hd && hd.kcal)
  if (day != null) return cut(day, 'watch')
  const w = (S.workouts || []).find(x => x.d === iso && num(x.watch && x.watch.kcal) != null)
  if (w) return cut(w.watch.kcal, 'session')
  const trained = (S.workouts || []).some(x => x.d === iso)
  return { kcal: 0, raw: 0, trim: t, source: trained ? 'missing' : 'rest' }
}

/**
 * One day's balance, or null when there is no maintenance figure to compute it against.
 *
 * `delta` is the whole point: the maintenance total already contains the sport it budgets
 * for, so only the difference between that budget and what was actually done is added. On a
 * day trained as planned it is zero and the balance is food against maintenance, which is
 * what a plan is for.
 *
 * `deficit` is null on a day with no intake logged — not zero. A day nobody logged is a day
 * nobody knows about, and calling it break-even would quietly credit the cut with a deficit
 * of an entire maintenance, which is the largest lie the arithmetic can tell.
 */
export function dayBalance(S, iso, tdee = S.tdee, trim) {
  const p = tdeeParts(tdee)
  if (!p) return null
  const e = entryFor(S, iso)
  const intake = num(e && e.kcal)
  const sp = sportKcal(S, iso, trim != null ? trim : trimOf(S))
  const delta = sp.kcal - p.sport
  const out = p.total + delta
  return {
    d: iso,
    tdee: p.total,
    parts: p,
    planned: p.sport,
    sport: sp.kcal,
    sportRaw: sp.raw,
    trim: sp.trim,
    sportSource: sp.source,
    delta,
    out,
    intake: intake == null ? null : Math.round(intake),
    deficit: intake == null ? null : Math.round(out - intake)
  }
}

/**
 * The deficit since the beginning, split the two ways this model can honestly split it:
 *
 *   nutrition   Σ (maintenance − intake)        eating against the budget
 *   sportDelta  Σ (sport done − sport planned)  training against the budget
 *   total       nutrition + sportDelta
 *
 * The training a plan already budgets for lives inside `nutrition`, because that is what
 * budgeting for it means — so `sportLogged` and `sportPlanned` ride along to say how much
 * training there actually was and how much the figure assumed. Without them a card could
 * report a sport contribution of zero on a cut built entirely on training.
 *
 * All of it runs over the same day set — the days that logged an intake — because that is
 * the only set on which the combined figure means anything, and numbers that do not add up
 * are worse than fewer numbers that do. Days with a session but no energy figure are counted
 * with a sport of 0 and reported separately.
 *
 * `through` names the last day to count, for a caller closing a day out — the evening digest
 * passes the day it is reporting. Everything else stops at yesterday; see lastFinished.
 */
export function deficitTotals(S, tdee = S.tdee, days = 0, now = Date.now(), through = null) {
  const p = tdeeParts(tdee)
  if (!p) return null
  const end = through || lastFinished(now)
  const list = (S.nutrition || []).filter(e => num(e.kcal) != null && e.d <= end && inWindow(e.d, days, now))
  if (!list.length) return null

  let nutrition = 0, sportDelta = 0, sportLogged = 0, unmeasured = 0
  list.forEach(e => {
    const b = dayBalance(S, e.d, tdee)
    nutrition += p.total - b.intake
    sportDelta += b.delta
    sportLogged += b.sport
    if (b.sportSource === 'missing') unmeasured++
  })
  const total = nutrition + sportDelta
  const from = list[0].d, to = list[list.length - 1].d
  return {
    from, to,
    days: list.length,
    span: Math.round(dayNum(to) - dayNum(from)) + 1,
    nutrition: Math.round(nutrition),
    sportDelta: Math.round(sportDelta),
    sportLogged: Math.round(sportLogged),
    sportPlanned: Math.round(p.sport * list.length),
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
 * The maintenance your own history implies, which is worth more than any formula: the weight
 * curve and the intake log between them already know what maintenance is.
 *
 *   expenditure = mean intake + (weight lost × 7 700) / days
 *   maintenance = expenditure − mean sport done + sport planned
 *
 * That last step is what makes it comparable to the number you typed. The curve knows what
 * the days actually cost, including whatever training happened; the figure you typed is what
 * a day costs with the *planned* amount of training in it. So the average training that
 * really happened comes out and the planned amount goes back in.
 *
 * Returns null, with a reason, whenever the inputs cannot carry the claim — too short a run,
 * too few weigh-ins, too few logged days, or a log covering too little of the period. Every
 * one of those failures produces a confident-looking number if you let it, and a wrong
 * maintenance figure is worse than none: it is the input to everything else.
 */
export function impliedTDEE(S, days = 0, now = Date.now()) {
  const p = tdeeParts(S.tdee) || { sport: 0 }
  const weighIns = (S.bodyweight || [])
    .filter(b => num(b.w) != null && inWindow(b.d, days, now))
    .map(b => ({ x: dayNum(b.d), y: num(b.w), d: b.d }))
  if (weighIns.length < IMPLIED_MIN_WEIGHINS) return { tdee: null, why: 'weighIns', weighIns: weighIns.length }

  const from = weighIns[0].d, to = weighIns[weighIns.length - 1].d
  const span = Math.round(weighIns[weighIns.length - 1].x - weighIns[0].x)
  if (span < IMPLIED_MIN_SPAN) return { tdee: null, why: 'span', span }

  // Intake only counts inside the span the weigh-ins cover, and today is left out for the
  // same reason it is left out of the totals: a day in progress would drag the mean down.
  const end = to < lastFinished(now) ? to : lastFinished(now)
  const logged = (S.nutrition || []).filter(e => num(e.kcal) != null && e.d >= from && e.d <= end)
  if (logged.length < IMPLIED_MIN_DAYS) return { tdee: null, why: 'days', days: logged.length }
  const coverage = logged.length / (span + 1)
  if (coverage < IMPLIED_MIN_COVERAGE) return { tdee: null, why: 'coverage', coverage, days: logged.length, span }

  const slope = slopePerDay(weighIns)
  if (slope == null) return { tdee: null, why: 'span', span }

  const meanIntake = logged.reduce((a, e) => a + num(e.kcal), 0) / logged.length
  const meanSport = logged.reduce((a, e) => a + sportKcal(S, e.d, trimOf(S)).kcal, 0) / logged.length
  // A negative slope is weight lost, which is expenditure the intake did not cover.
  const expenditure = meanIntake - slope * KCAL_PER_KG_FAT
  const tdee = validTDEE(Math.round(expenditure - meanSport + p.sport))

  return {
    tdee, why: tdee == null ? 'range' : null,
    from, to, span, coverage: Math.round(coverage * 100) / 100,
    days: logged.length, weighIns: weighIns.length,
    expenditure: Math.round(expenditure),
    meanIntake: Math.round(meanIntake),
    meanSport: Math.round(meanSport),
    planned: p.sport,
    kgPerWeek: Math.round(slope * 7 * 100) / 100
  }
}

/**
 * What the deficit predicted, against what the scale actually did — the one reading on this
 * page that can tell you the maintenance figure is wrong, and by how much.
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

/** Today's balance — a day in progress, and the one place on this page that is meant to be. */
export const todayBalance = (S, tdee = S.tdee) => dayBalance(S, todayISO(), tdee)
