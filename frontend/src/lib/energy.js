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
 * twenties to forties, almost always high. Twenty-eight percent sits inside that range and
 * is a deliberately blunt instrument — the point is not to be exact, it is to stop a cut
 * being planned around four hundred calories that were never burned.
 *
 * It applies to what the watch reported and to nothing else. Set it to zero to trust the
 * watch as it comes.
 */
export const WATCH_TRIM = 0.28
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

/* How a person's own NEAT is read off their rest days. Fewer than this and the median is
   one unusual Sunday; the window is long enough to carry a habit and short enough to follow
   a change in one. */
export const NEAT_MIN_DAYS = 4
export const NEAT_WINDOW = 90

const median = xs => {
  const a = [...xs].sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/**
 * The NEAT this person's watch actually reads, measured rather than declared.
 *
 * The entered maintenance figure carries a NEAT, but it is one number typed once: it cannot
 * know that Tuesday was a desk day and Saturday was eleven kilometres of walking. Subtracting
 * it flat understates training on quiet days and lets walking through as training on busy
 * ones.
 *
 * A rest day answers the question directly. On a day with no session logged, the watch's
 * whole active-energy figure *is* NEAT — there is nothing else in it. The median of those
 * days is this person's own baseline, in the watch's own units, and it moves when their life
 * does. Median and not mean, because one Sunday hike would drag a mean for a month.
 *
 * Null when there are not enough rest days to speak from, and the declared figure stands.
 */
export function observedNEAT(S, days = NEAT_WINDOW, now = Date.now()) {
  const trained = new Set((S.workouts || []).map(w => w.d))
  const rest = (S.health || [])
    .filter(h => num(h.kcal) != null && !trained.has(h.d) && inWindow(h.d, days, now))
    .map(h => num(h.kcal))
  if (rest.length < NEAT_MIN_DAYS) return null
  return { kcal: Math.round(median(rest)), days: rest.length }
}

/**
 * The everyday movement to take off a whole-day burn, and where that figure came from.
 *
 * This has exactly one job: a watch's active energy is training plus all the walking, and
 * the walking has to come out before what is left can be called training. It never touches
 * the maintenance figure — that number is entered once and is charged flat, so a rest day
 * costs the same whatever the import happened to know about that day's steps.
 *
 * Three sources, most specific first, and the order is the whole point:
 *
 *   day       the file said so for that day — a NEAT column, one row per day
 *   rest      the median of this person's own rest days, in the watch's own units
 *   declared  the NEAT part of the maintenance figure they entered once
 *
 * The fallback never runs out, which is the property being bought here. A NEAT column with
 * gaps in it is the normal case — nobody has a step-count history for every day they ever
 * lived — and an empty cell has to mean "as usual", never "did not move". Read as zero it
 * would hand a day the whole of its active energy as training and invent a deficit out of a
 * walk to the shops; so a blank cell simply does not reach here, and the day falls through
 * to the baseline it would have had if the column had never existed.
 *
 * The units differ by source and that matters downstream. 'day' and 'declared' are real
 * amounts — a person's own figure, in kcal actually spent. 'rest' is a watch reading, and
 * carries the watch's overcount with it, so it is the only one that gets trimmed before it
 * is set against another watch reading.
 */
export function neatFor(S, iso, tdee = S && S.tdee, now = Date.now()) {
  const own = dayNEAT(S, iso, tdee)
  if (own) return own
  const seen = observedNEAT(S, NEAT_WINDOW, now)
  if (seen) return { kcal: seen.kcal, from: 'rest', days: seen.days }
  return { kcal: Math.round((tdeeParts(tdee) || {}).neat || 0), from: 'declared' }
}

/* How many steps the entered NEAT already pays for, and the ceiling above which a step
   count is a broken sensor rather than a long walk. Fifty thousand steps is about forty
   kilometres; a figure above it has never been walked, it has been miscounted, and charging
   it would wreck a month of totals in one row. */
export const STEP_BASE = 9000
export const STEP_MAX = 50000
export const stepBaseOf = S => {
  const n = num(S && S.tdee && S.tdee.stepBase)
  return n != null && n >= 1000 && n <= 40000 ? Math.round(n) : STEP_BASE
}

/**
 * What this particular day's everyday movement cost, when the day says so itself — in kcal,
 * whatever unit it was recorded in.
 *
 * Two ways a day can say it. A NEAT column gives the kcal outright. A step count gives it by
 * proportion: the entered NEAT pays for a certain number of steps, so twice those steps is
 * twice that NEAT. Nothing here falls back to a baseline — this answers "what did *this* day
 * do", and a day that says nothing gets null rather than an average.
 */
export function dayNEAT(S, iso, tdee = S && S.tdee) {
  const h = healthFor(S, iso) || {}
  const own = num(h.neat)
  if (own != null) return { kcal: Math.round(own), from: 'day' }
  const steps = num(h.steps)
  const p = tdeeParts(tdee)
  if (steps == null || !p || !p.neat) return null
  const base = stepBaseOf(S)
  return {
    kcal: Math.round((Math.min(steps, STEP_MAX) / base) * p.neat),
    from: 'steps', steps: Math.round(steps), base
  }
}

/**
 * What a day's own movement adds to, or takes off, its own expenditure.
 *
 * The maintenance figure is a weekly average, not a daily fact: it assumes a certain number
 * of steps a day. A day that beat that assumption really did cost more; a day that fell
 * short really did cost less. Both directions, because the arithmetic is the same arithmetic
 * and only counting the flattering half would bias every total upward.
 *
 * The one thing that is never guessed is a day nobody measured. No step count and no NEAT
 * figure means no adjustment at all: not a penalty, not a credit — the day is charged the
 * entered total. An absent pedometer is not a sedentary day, and a maintenance that sags
 * whenever the phone stayed on the desk is a maintenance nobody can plan against.
 *
 * This composes exactly with the subtraction sportKcal makes from a whole-day watch reading,
 * which is worth spelling out because it looks like double counting and is not. Where a day
 * total A is read off a watch, training comes out as A − NEAT-of-that-day, and the day is
 * charged (BMR + NEAT-entered + other) + training + (NEAT-of-that-day − NEAT-entered) — the
 * two NEAT terms cancel and what is left is BMR + other + A. Exactly right, once.
 */
export function neatBonus(S, iso, tdee = S && S.tdee) {
  const p = tdeeParts(tdee)
  const d = p && dayNEAT(S, iso, tdee)
  if (!d) return { kcal: 0, from: null, dayKcal: null }
  return { kcal: d.kcal - p.neat, from: d.from, dayKcal: d.kcal, steps: d.steps, base: d.base }
}

/* Whether a day with no session on it gives back the training the maintenance figure budgets
   for. Strictly it should: a figure that contains 230 kcal of smoothed training describes a
   day that trained. In practice that correction and the watch discount are two errors of
   opposite sign, and cancelling them against each other has held closer to the scale than
   applying either alone — so the honest default is off, and this switch is here to be turned
   on once there are enough weigh-ins to say which way the model actually errs. */
export const restStrictOf = S => !!(S && S.restStrict)

/* Above this much real effort in one day, the figure is worth a second look before it moves
   a month of totals. It changes no arithmetic — one formula runs on every day, exceptional
   or not — it only says out loud that this one was exceptional. */
export const BIG_EFFORT = 1500

/**
 * What training actually cost on a given day, and where the figure came from — the source
 * travels with the number because they are not equally trustworthy, and `raw` travels with
 * it because a trimmed figure that cannot be traced back to what the watch said is a number
 * nobody can check.
 *
 * The session's own figure is preferred, and this used to be the other way round. A watch's
 * all-day active energy looked like the better number — the whole of what was moved, walk
 * home included — but that is precisely what makes it the wrong one here. Maintenance is
 * entered as parts, and one of those parts is NEAT: the walking, standing and fidgeting of
 * an ordinary day. Apple's active energy is NEAT plus training. Handed over whole it counts
 * the walk home twice — once inside the maintenance figure, once again as training — and a
 * deficit inflated by a few hundred kcal a day is the one error this app exists to avoid.
 *
 * So when only the day's total is known, the NEAT the maintenance figure already budgets
 * comes back off it, and what is left is the training. Never below zero: a day that moved
 * less than its own NEAT budget did no training, it did not do negative training.
 *
 * A day with a logged session but no energy figure anywhere reports 'missing' rather than
 * quietly passing 0 — that day's balance is understated and the totals say so.
 *
 * Effort logged by hand rides on top of all of that, untrimmed. Five hundred stairs, a
 * two-hour walk round a town, a hike nobody started a workout for — real work that no watch
 * recorded as a session, and a figure a person estimated is already a real amount: the
 * discount exists for a wrist sensor's optimism and there is no sensor here to be optimistic.
 * It is added after the cut, never inside it.
 */
export function sportKcal(S, iso, trim = WATCH_TRIM, tdee = S && S.tdee, now = Date.now()) {
  const t = validTrim(trim)
  // Hand-logged effort, in real kcal. Read once here so every branch below can add it.
  const free = Math.round(num0((healthFor(S, iso) || {}).free))
  const cut = (raw, source, neat = 0, neatFrom = null) => ({
    kcal: Math.max(0, Math.round(raw * (1 - t)) - Math.round(neat)) + free,
    raw: Math.round(raw), trim: t, source, neat: Math.round(neat), neatFrom, free
  })

  // The session's figure is already only the session: nothing is budgeted twice inside it.
  const w = (S.workouts || []).find(x => x.d === iso && num(x.watch && x.watch.kcal) != null)
  if (w) return cut(w.watch.kcal, 'session')

  const hd = healthFor(S, iso)
  // The same figure, filed against the day because no session was logged to carry it. Still
  // training and nothing else, so still nothing to take off it.
  const loose = num(hd && hd.sport)
  if (loose != null) return cut(loose, 'session')

  const day = num(hd && hd.kcal)
  if (day != null) {
    // What to take back off, and in whose units. A rest-day median is a watch reading set
    // against a watch reading, so it is trimmed exactly as the day total is; a figure the
    // person gave — for that day, or once in their maintenance — is already a real amount
    // and trimming it would take the overcount off a number that never had one.
    const n = neatFor(S, iso, tdee, now)
    const off = n.from === 'rest' ? Math.round(n.kcal * (1 - t)) : n.kcal
    return cut(day, 'watch', off, { kind: n.from, days: n.days })
  }

  // Nothing measured the training that day. Whether that means "rested" or "nobody recorded
  // it" is the difference between a rest day and a hole, and the arithmetic must not guess:
  // a rest day legitimately costs a day's training budget less, and subtracting that from a
  // hole is how a year of imported intake turns into a deficit nobody earned.
  //
  // The evidence is whether this app was being used to log training around then. Where it
  // was, a day with no session on it really is a rest day. Where it was not — an imported
  // history, a month before the app existed — the absence of a workout is the absence of a
  // record, and the day says nothing about training either way.
  //
  // Hand-logged effort alone is still evidence, and a day carrying it is not a rest day. It
  // reports its own source so the day reads as measured — by a person rather than a watch.
  if (free > 0) return { kcal: free, raw: 0, trim: t, source: 'free', neat: 0, neatFrom: null, free }
  if ((S.workouts || []).some(x => x.d === iso)) {
    return { kcal: 0, raw: 0, trim: t, source: 'missing', neat: 0, neatFrom: null, free: 0 }
  }
  return { kcal: 0, raw: 0, trim: t, source: trackedAround(S, iso) ? 'rest' : 'unknown', neat: 0, neatFrom: null, free: 0 }
}

/* How far either side of a day to look for evidence that training was being recorded at all.
   Wide enough to carry a deload week, narrow enough that a gap of a month reads as one. */
export const TRACKED_WINDOW = 10

/** Was training being recorded anywhere near this day? */
function trackedAround(S, iso) {
  const d = dayNum(iso)
  const near = x => Math.abs(dayNum(x) - d) <= TRACKED_WINDOW
  if ((S.workouts || []).some(w => near(w.d))) return true
  return (S.health || []).some(h => near(h.d) && (num(h.sport) != null || num(h.kcal) != null))
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
export function dayBalance(S, iso, tdee = S.tdee, trim, now = Date.now()) {
  const p = tdeeParts(tdee)
  if (!p) return null
  const e = entryFor(S, iso)
  const intake = num(e && e.kcal)
  const sp = sportKcal(S, iso, trim != null ? trim : trimOf(S), tdee, now)
  // Only a session somebody actually measured moves the training term. A rest day, a session
  // logged with no figure on it, a day from before any of this was recorded — none of those
  // is evidence about what training cost, and charging them the budget back would be a guess
  // dressed as arithmetic. Strict mode makes a rest day give the budget back, for a profile
  // whose maintenance figure genuinely describes a training day.
  const measured = sp.source === 'session' || sp.source === 'watch' || sp.source === 'free'
  const delta = measured ? sp.kcal - p.sport
    : (sp.source === 'rest' && restStrictOf(S) ? -p.sport : 0)
  const bonus = neatBonus(S, iso, tdee)
  const out = p.total + delta + bonus.kcal
  return {
    d: iso,
    tdee: p.total,
    parts: p,
    // What the day's own movement added on top, and what said so — a step count, a NEAT
    // column, or nothing at all, which is most days.
    bonus: bonus.kcal,
    bonusFrom: bonus.from,
    steps: bonus.steps == null ? null : bonus.steps,
    // The everyday movement actually taken off this day's burn, and where that figure came
    // from — 'day' only when the import carried one for this date. Null on a day with
    // nothing to take it off, which is most days.
    neat: sp.neat,
    neatFrom: sp.neatFrom ? sp.neatFrom.kind : null,
    planned: p.sport,
    sport: sp.kcal,
    sportRaw: sp.raw,
    trim: sp.trim,
    sportSource: sp.source,
    delta,
    measured,
    // Effort logged by hand, and whether the day's total effort is large enough to be worth
    // checking before it is trusted. The arithmetic is the same either way.
    free: sp.free || 0,
    big: sp.kcal >= BIG_EFFORT,
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
  // Sorted here rather than trusted: `from`, `to` and `span` are read off the ends of this
  // list, and a state that arrived newest-first — an import, a database round trip — would
  // otherwise report a negative span and a reversed date range with no other symptom.
  const list = (S.nutrition || []).filter(e => num(e.kcal) != null && e.d <= end && inWindow(e.d, days, now))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  if (!list.length) return null

  let nutrition = 0, sportDelta = 0, sportLogged = 0, unmeasured = 0, untracked = 0, plannedDays = 0, neatDays = 0
  let bonus = 0, bonusDays = 0
  list.forEach(e => {
    const b = dayBalance(S, e.d, tdee)
    nutrition += b.tdee - b.intake
    // Movement measured against what the maintenance figure already assumes. Its own term,
    // because it belongs to neither of the other two: it is not eating, and it is not
    // training. It runs in both directions, so it is summed and not counted.
    bonus += b.bonus
    if (b.bonus !== 0) bonusDays++
    // Days where the import's own movement figure is what came off a whole-day burn. Not
    // every day carrying a NEAT figure — only the ones where it changed an answer.
    if (b.neatFrom === 'day' || b.neatFrom === 'steps') neatDays++
    sportLogged += b.sport
    // Whatever the day's own arithmetic charged, so the total and the chart cannot disagree.
    sportDelta += b.delta
    if (b.measured) plannedDays++
    else if (b.sportSource === 'missing') unmeasured++
    else if (b.sportSource === 'unknown') untracked++
  })
  const total = nutrition + sportDelta + bonus
  const from = list[0].d, to = list[list.length - 1].d
  return {
    from, to,
    days: list.length,
    span: Math.round(dayNum(to) - dayNum(from)) + 1,
    nutrition: Math.round(nutrition),
    sportDelta: Math.round(sportDelta),
    bonus: Math.round(bonus),
    bonusDays,
    sportLogged: Math.round(sportLogged),
    // Against the days a session was actually measured, not every day in the window: "5 352
    // measured against 30 590 assumed" is only a fair comparison when the 30 590 was assumed
    // over days that had something to say.
    sportPlanned: Math.round(p.sport * plannedDays),
    plannedDays,
    untracked,
    // How many days had their own movement figure taken off a whole-day burn, rather than
    // the usual baseline. Reported because a training figure derived from a different
    // subtraction on some of its days is a figure nobody can check.
    neatDays,
    total: Math.round(total),
    perDay: Math.round(total / list.length),
    kg: Math.round((total / KCAL_PER_KG_FAT) * 100) / 100,
    unmeasured
  }
}

/* ------------------------------------------------------- what the scale should say -- */

/**
 * The weight the deficit says you are at now, counted forward from the last time you actually
 * stood on the scale.
 *
 * Forward from the *last* weigh-in, and never chained across several: 7 700 kcal per kilo is
 * an approximation that errs one way, so every day it runs adds a little more error in the
 * same direction. Anchored to a fresh measurement it is a useful week-long tendency; run for
 * three months off one old reading it is fiction with a decimal point.
 *
 * `gaps` is how many days in that stretch logged no intake. Those days contribute nothing,
 * so a projection with gaps in it understates the deficit and reads high — which is worth
 * knowing before trusting the figure to a hundred grams.
 */
export function projectedWeight(S, tdee = S && S.tdee, now = Date.now()) {
  const weighIns = (S.bodyweight || []).filter(b => num(b.w) != null).sort((a, b) => (a.d < b.d ? -1 : 1))
  const last = weighIns[weighIns.length - 1]
  if (!last || !tdeeParts(tdee)) return null
  const end = lastFinished(now)
  if (last.d >= end) return { from: last.d, to: last.d, fromKg: num(last.w), kg: num(last.w), days: 0, span: 0, deficit: 0, gaps: 0 }
  const days = (S.nutrition || []).filter(e => num(e.kcal) != null && e.d > last.d && e.d <= end)
  let deficit = 0
  days.forEach(e => { const b = dayBalance(S, e.d, tdee, undefined, now); if (b && b.deficit != null) deficit += b.deficit })
  const span = Math.round(dayNum(end) - dayNum(last.d))
  const kg = num(last.w) - deficit / KCAL_PER_KG_FAT
  return {
    // `to` travels with it so a caller listing the days can stop where this stopped. A list
    // that runs one day further than the figure it explains is a list that contradicts it.
    from: last.d, to: end, fromKg: num(last.w),
    days: days.length, span, gaps: Math.max(0, span - days.length),
    deficit: Math.round(deficit),
    kg: Math.round(kg * 100) / 100,
    change: Math.round((kg - num(last.w)) * 100) / 100
  }
}

/* How fast a cut is actually running, in the bands that decide whether it is working.
   Contiguous by construction: a rate falls in exactly one of them. */
export const CUT_BANDS = [
  { max: 300, key: 'slow' },
  { max: 400, key: 'gentle' },
  { max: 500, key: 'optimal' },
  { max: 600, key: 'high' },
  { max: 700, key: 'steep' },
  { max: Infinity, key: 'excessive' }
]

/* Garthe 2011: above about 0.7 % of bodyweight a week, the lean mass a lifter gains is
   cancelled out. A share and not a number, because 0.55 kg a week is a different proposition
   at 60 kg than at 95. */
export const LOSS_CEILING_PCT = 0.007

/**
 * The rate this cut is running at, against the rate this body can afford. Null until there is
 * both a deficit to read and a weight to scale the ceiling to — a ceiling in kilograms that
 * does not know whose kilograms is worse than no ceiling.
 */
export function cutRate(S, tdee = S && S.tdee, days = 0, now = Date.now()) {
  const tot = deficitTotals(S, tdee, days, now)
  if (!tot) return null
  const bw = ((S.bodyweight || []).filter(b => num(b.w) != null).sort((a, b) => (a.d < b.d ? -1 : 1)).pop() || {}).w
  const kgPerWeek = Math.round((tot.perDay * 7 / KCAL_PER_KG_FAT) * 100) / 100
  const band = CUT_BANDS.find(b => tot.perDay < b.max) || CUT_BANDS[CUT_BANDS.length - 1]
  const ceilingKg = num(bw) == null ? null : Math.round(num(bw) * LOSS_CEILING_PCT * 100) / 100
  return {
    perDay: tot.perDay, kgPerWeek, band: band.key,
    bodyKg: num(bw), ceilingKg,
    ceilingPerDay: ceilingKg == null ? null : Math.round(ceilingKg * KCAL_PER_KG_FAT / 7),
    overCeiling: ceilingKg != null && kgPerWeek > ceilingKg
  }
}

/**
 * Record what the model predicted, at the moment the scale contradicts it.
 *
 * The watch discount is the least certain constant in the whole model — individual
 * overcounts run from fifteen to forty percent — and the only thing that can settle it is a
 * run of weigh-ins against a run of predictions. That comparison is impossible after the
 * fact: once a weigh-in lands it becomes the new anchor, and the projection it disagreed with
 * is gone. So the pair is written down here, on the way in, while both halves still exist.
 *
 * `sportPerDay` rides along because it is what decides which constant is wrong. An error
 * that grows with training volume is the watch discount; an error that sits flat whatever
 * the volume is the smoothed sport figure.
 *
 * Called inside store.update, before the weigh-in is inserted. A no-op when there is nothing
 * to compare — the first weigh-in of all, or a run with no intake logged in it.
 */
export function recordCalibration(S, iso, kg, now = Date.now()) {
  const p = projectedWeight(S, S && S.tdee, now)
  if (!p || !p.days || p.from >= iso) return null
  const days = (S.nutrition || []).filter(e => num(e.kcal) != null && e.d > p.from && e.d <= p.to)
  const sport = days.reduce((a, e) => a + sportKcal(S, e.d, trimOf(S), S.tdee, now).kcal, 0)
  const pair = {
    d: iso,
    from: p.from,
    days: p.days,
    gaps: p.gaps,
    predicted: p.kg,
    actual: Math.round(kg * 100) / 100,
    // Positive means the scale is behind the prediction: less was lost than the model said.
    error: Math.round((kg - p.kg) * 100) / 100,
    sportPerDay: Math.round(sport / p.days),
    trim: trimOf(S),
    planned: (tdeeParts(S && S.tdee) || {}).sport || 0
  }
  S.calib = [...(S.calib || []).filter(c => c.d !== iso), pair].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-40)
  return pair
}

/**
 * What the recorded pairs say about which constant to move.
 *
 * Split at the median training volume rather than fitted: with five or six pairs a regression
 * line is mostly noise wearing a coefficient. Two groups and the difference between their
 * mean errors answers the only question being asked — does the error track training, or not.
 */
export const CALIB_MIN_PAIRS = 4
export function calibration(S) {
  const pairs = (S && S.calib) || []
  if (pairs.length < CALIB_MIN_PAIRS) return { pairs, why: 'few', need: CALIB_MIN_PAIRS - pairs.length }
  const mean = xs => xs.reduce((a, x) => a + x, 0) / xs.length
  const vols = [...pairs].map(c => c.sportPerDay).sort((a, b) => a - b)
  const mid = vols[vols.length >> 1]
  const hi = pairs.filter(c => c.sportPerDay >= mid)
  const lo = pairs.filter(c => c.sportPerDay < mid)
  const bias = Math.round(mean(pairs.map(c => c.error)) * 100) / 100
  if (!hi.length || !lo.length) return { pairs, bias, why: 'flat' }
  const spread = Math.round((mean(hi.map(c => c.error)) - mean(lo.map(c => c.error))) * 100) / 100
  return {
    pairs, bias, spread,
    // An error that grows with volume is the watch's optimism; one that does not is the
    // smoothed sport figure, or the maintenance total itself.
    blame: Math.abs(spread) >= Math.abs(bias) / 2 && Math.abs(spread) >= 0.15 ? 'trim' : 'sport',
    hiVol: Math.round(mean(hi.map(c => c.sportPerDay))),
    loVol: Math.round(mean(lo.map(c => c.sportPerDay)))
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
  // Training only — sportKcal takes the entered NEAT off a whole-day reading, so what comes
  // out of `expenditure` here is BMR + NEAT + the rest, and adding the budgeted training
  // back gives a figure directly comparable to the one that was entered. Reading the entered
  // NEAT to judge the entered total is circular only in appearance: both sides are being
  // held to the same accounting, which is the whole point of the comparison.
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
