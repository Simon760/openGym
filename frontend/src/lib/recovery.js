// Estimated muscle recovery.
//
// READ THIS FIRST: this is a model, not a measurement. Nothing BodyEvolve holds measures
// recovery. It knows which muscles a session worked, how many sets each got, how close to
// failure those sets were, how you slept and what you ate — and turns that into an estimate
// with a published rationale. It is useful for deciding what to train tomorrow. It is not a
// reading off your body, and the UI says so rather than implying a precision it cannot have.
//
// SHAPE — the fatigue term of a Banister-style fitness-fatigue model: every session deposits
// fatigue on the muscles it worked, and that fatigue decays exponentially.
//
//     recovery(t) = 1 − Σ F₀ᵢ · e^(−Δtᵢ / τᵢ)      capped into 0…1
//
// F₀ is how much fatigue one session left on one muscle; τ is how fast it fades.
//
// WHAT THE EVIDENCE SETS
//
// τ, the decay constant. Recovery of neuromuscular performance takes 24–48 h after sets
// stopped short of failure and up to 72 h after sets taken to it; muscle protein synthesis
// runs ~24 h in trained lifters. Treating "recovered" as 3τ puts τ at roughly 14 h for
// comfortable work and 24 h for work taken to failure, so τ is interpolated between the two
// on how hard the session's sets actually were.
//
// Proximity to failure, the strongest single modifier. At 24 h post-session, lifting velocity
// was still down 3 % after sets to failure and after 1-RIR sets, but had returned to +2 %
// after 3-RIR sets — so the weighting is steep between RIR 3 and RIR 1 and flattens after.
//
// Volume, with saturation. More sets mean more damage, but not proportionally: the tenth set
// of a session does not add what the first did. Hence 1 − e^(−sets/K) rather than a line.
//
// Sleep. A night of total deprivation cuts muscle protein synthesis ~18 % and raises cortisol
// ~21 %; chronic 5–6 h nights land near −20 %. So short sleep stretches τ, up to about a
// third longer.
//
// Energy. Eating at ~80 % of requirements drops resting muscle protein synthesis ~16 %, and
// a severe five-day restriction ~30 %. A deficit stretches τ on the same scale.
//
// WHAT THE EVIDENCE EXPLICITLY DOES NOT SET — and this is why there is no table of per-muscle
// constants below: muscle size does not meaningfully change recovery rate. Biceps and quads
// recover at similar rates, and frequency studies find biceps, triceps and quads respond
// alike. Fibre type and ease of activation matter somewhat, but not enough to justify
// eighteen invented numbers. The model is the same for every muscle, which is both simpler
// and more honest than pretending otherwise.

import { EXIDX } from './exercises.js'
import { musclesOf } from './muscles.js'
import { rirOf } from './effort.js'
import { entryFor } from './nutrition.js'
import { sleepFor, sleepHours } from './body.js'
import { isoOf } from './format.js'

/** Below this residual fatigue a muscle is called recovered. */
export const RECOVERED_AT = 0.05
/** Sessions older than this contribute nothing worth computing. */
export const WINDOW_DAYS = 10

// Fatigue weight of one set by how many reps were left in reserve. The cliff sits between
// RIR 3 and RIR 1 because that is where the 24-hour velocity data puts it.
export const RIR_WEIGHT = [1, 0.85, 0.7, 0.55, 0.4]
// An unrated set is assumed to be a normal working set — around RIR 2. Rating is optional and
// off by default, so this is the common case, and the UI says when it was used.
export const UNRATED_WEIGHT = 0.7

// Effective sets at which one muscle is ~63 % of the way to maximum session fatigue.
const SATURATION = 6
const TAU_EASY = 14      // hours, sets kept well short of failure
const TAU_FAILURE = 24   // hours, sets taken to failure
const SLEEP_TARGET = 8
const SLEEP_PENALTY = 0.6
const ENERGY_PENALTY = 0.8
const MAX_MULTIPLIER = 1.6   // sleep and energy together can slow recovery by at most this

const clamp01 = v => Math.max(0, Math.min(1, v))
const weightOfSet = s => {
  const r = rirOf(s)
  if (r == null) return UNRATED_WEIGHT
  return RIR_WEIGHT[Math.min(RIR_WEIGHT.length - 1, Math.max(0, Math.round(r)))]
}

/**
 * How much each muscle was worked in one session, in "effective sets": every finished set
 * counted once for the muscle it targets and at the dataset's secondary weight for the ones
 * assisting, then scaled by how close to failure it was.
 *
 * Also returns the session's mean set weight, which is what τ is interpolated on — a session
 * of comfortable sets recovers faster than the same volume taken to failure.
 */
export function sessionLoad(w) {
  const load = {}
  let sum = 0, n = 0
  ;(w.entries || []).forEach(e => {
    const done = (e.sets || []).filter(s => s.done)
    if (!done.length) return
    const m = musclesOf(EXIDX[e.id])
    done.forEach(s => {
      const weight = weightOfSet(s)
      sum += weight; n++
      for (const slug in m) load[slug] = (load[slug] || 0) + m[slug] * weight
    })
  })
  return { load, intensity: n ? sum / n : 0, sets: n }
}

/** Fatigue one session left on a muscle, 0…1. Saturating: the tenth set adds less than the first. */
export const fatigueFrom = effectiveSets => 1 - Math.exp(-Math.max(0, effectiveSets) / SATURATION)

/**
 * How long that fatigue takes to fade, in hours. Interpolated on how hard the session was,
 * then stretched by short sleep and by eating under target — both of which slow the repair
 * this is a proxy for.
 */
export function tauFor(intensity, { sleepFactor = 1, energyFactor = 1 } = {}) {
  const base = TAU_EASY + (TAU_FAILURE - TAU_EASY) * clamp01((intensity - 0.4) / 0.6)
  return base * Math.min(MAX_MULTIPLIER, sleepFactor * energyFactor)
}

/**
 * How much slower recovery runs given the nights slept and the days eaten since a session.
 * Both look at the days the fatigue has actually been decaying through, not at today alone —
 * one bad night three days ago is not what is holding a muscle back now.
 *
 * A day with nothing logged is not counted as a bad day. It is counted as no evidence, and
 * `known` says how much of the window had any, so the UI can decline to imply more certainty
 * than the log supports.
 */
export function conditionsSince(S, fromMs, now = Date.now()) {
  const days = []
  for (let t = fromMs; t <= now + 86400000; t += 86400000) days.push(isoOf(new Date(t)))
  const uniq = [...new Set(days)]

  const target = S.sleepGoal || SLEEP_TARGET
  const nights = uniq.map(d => sleepFor(S, d)).filter(e => e && sleepHours(e) != null)
  const sleepFactor = nights.length
    ? 1 + SLEEP_PENALTY * clamp01((target - nights.reduce((a, e) => a + sleepHours(e), 0) / nights.length) / target)
    : 1

  // Today is left out of the energy average: the day is not over, so a log that is honestly
  // half-filled reads as a deficit that has not happened. Counting it made a profile eating
  // 5 % under target report as 28 % under, every single day, purely because it was afternoon.
  // Sleep has no such problem — last night is finished — so it keeps today.
  const goal = S.nutriGoal && S.nutriGoal.kcal
  const todayIso = isoOf(new Date(now))
  const eaten = goal ? uniq.filter(d => d < todayIso).map(d => entryFor(S, d)).filter(e => e && e.kcal) : []
  const energyFactor = eaten.length
    ? 1 + ENERGY_PENALTY * clamp01((goal - eaten.reduce((a, e) => a + e.kcal, 0) / eaten.length) / goal)
    : 1

  return {
    sleepFactor, energyFactor,
    nights: nights.length, daysEaten: eaten.length, days: uniq.length,
    known: !!(nights.length || eaten.length)
  }
}

const startOf = w => w.start || new Date(w.d + 'T18:00:00').getTime()

/**
 * Recovery per muscle right now: the share of full each one is at, the hours until it is
 * back, and what the estimate rests on. Muscles no recent session touched are simply absent —
 * reporting them at 100 % would be true but says nothing, and would fill the map with muscles
 * that are only "recovered" because they were never trained.
 */
export function recoveryNow(S, now = Date.now()) {
  const recent = (S.workouts || []).filter(w => startOf(w) > now - WINDOW_DAYS * 86400000)
  const muscles = {}
  let rated = 0, total = 0
  let sleepFactor = 1, energyFactor = 1, known = false

  recent.forEach(w => {
    const { load, intensity, sets } = sessionLoad(w)
    if (!sets) return
    const cond = conditionsSince(S, startOf(w), now)
    // The most recent session's conditions are the ones reported, since it dominates what is
    // still decaying.
    sleepFactor = cond.sleepFactor; energyFactor = cond.energyFactor; known = known || cond.known
    const tau = tauFor(intensity, cond)
    const hours = (now - startOf(w)) / 3600000
    ;(w.entries || []).forEach(e => (e.sets || []).forEach(s => { if (s.done) { total++; if (rirOf(s) != null) rated++ } }))

    for (const slug in load) {
      const residual = fatigueFrom(load[slug]) * Math.exp(-hours / tau)
      if (residual < 0.005) continue
      const m = muscles[slug] || (muscles[slug] = { fatigue: 0, tau, sets: 0 })
      m.fatigue += residual
      m.sets += load[slug]
      m.tau = Math.max(m.tau, tau)   // the slowest contributor sets how long the muscle waits
    }
  })

  const out = {}
  for (const slug in muscles) {
    const m = muscles[slug]
    const fatigue = clamp01(m.fatigue)
    out[slug] = {
      pct: Math.round((1 - fatigue) * 100),
      fatigue,
      sets: Math.round(m.sets * 10) / 10,
      // Solved rather than looked up, because several sessions can still be decaying on one
      // muscle and their sum is not a single exponential.
      hoursLeft: fatigue <= RECOVERED_AT ? 0 : Math.max(0, Math.round(m.tau * Math.log(fatigue / RECOVERED_AT)))
    }
  }
  return {
    muscles: out,
    // Everything the estimate leaned on, so the screen can say what it assumed rather than
    // presenting a number as though it were read off the body.
    basis: {
      sessions: recent.length,
      ratedSets: rated, totalSets: total,
      sleepFactor: Math.round(sleepFactor * 100) / 100,
      energyFactor: Math.round(energyFactor * 100) / 100,
      known
    }
  }
}

/** Coarse bands, because a model like this cannot honestly resolve single percent. */
export const bandOf = pct => (pct >= 95 ? 'ready' : pct >= 75 ? 'nearly' : pct >= 45 ? 'working' : 'fresh-off')

export const BAND_COLOR = {
  ready: 'var(--acc)', nearly: 'var(--teal)', working: 'var(--yellow)', 'fresh-off': 'var(--red)'
}
export const BAND_NAME = {
  ready: 'Ready', nearly: 'Nearly there', working: 'Still recovering', 'fresh-off': 'Just trained'
}
