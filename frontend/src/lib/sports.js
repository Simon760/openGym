/**
 * Sports other than lifting — which muscles they load, and how long those take to come back.
 *
 * READ THIS FIRST, as for recovery.js: a model, not a measurement. What the studies below
 * measured is the time course of recovery after a match or a race — sprint, jump, strength,
 * creatine kinase, soreness — and where in the body the work and the injuries go. No study
 * publishes a per-muscle load table for padel, so the weights here are read off that evidence
 * (EMG, propulsion analyses, injury sites), and the recovery constants are set so the model
 * lands where the time courses do. The sources are named next to each number.
 *
 * HOW A SESSION IS COUNTED — the session-RPE method (Foster 2001): internal load is the
 * session's rating on the CR-10 scale times its minutes. It tracks heart-rate load well in
 * football (Impellizzeri 2004; r ≈ 0.6–0.8 against TRIMP across studies) and is the standard
 * for team and racket sports. That load is turned into the "effective sets" recovery.js already
 * works in, spread over the sport's muscles by their weights.
 *
 * Calibration: a 90-minute match at session RPE 7 — 630 units, a typical competitive football
 * match — counts as ten hard sets on the most-loaded muscle, a heavy leg day. With the football
 * decay below, that puts the hamstrings back at ~95 % about 66–72 h later, which is where the
 * match studies put full recovery (Silva 2018: sprint still down at 48 h; CK and soreness still
 * up at 72 h. Nédélec 2012: CK peaks 24–48 h, soreness and sprint back by ~72 h).
 *
 * HOW FAST IT FADES — the decay τ, in hours, interpolated on how hard the session was (CR-10
 * 3 → the low end, 8 and above → the high end), then stretched by short sleep and eating under
 * target exactly as lifting is. What sets the range is how much eccentric work the sport does,
 * because eccentric contractions are what damage muscle: football (decelerations, sprints,
 * kicks) and running (a braking landing on every stride) at the top; padel and tennis in the
 * middle; swimming and cycling, concentric and unloaded, at the bottom — they raise CK the
 * least of any sport measured (Brancaccio 2007; cycling vs basketball/volleyball, 2022).
 */

/** Session-RPE units (minutes × CR-10) worth one effective set — see the calibration above. */
export const SRPE_PER_SET = 63

/**
 * One profile per sport, keyed by catalogue id (exercises-extra.js).
 *   muscles — weight 0…1 per muscle of the body map: how much of the session's load lands on
 *             it. 1 where one group takes the brunt (a footballer's hamstrings); lower all round
 *             where the work is spread, as in the racket sports, so the same minutes and effort
 *             leave less on any one muscle
 *   tau     — [easy, hard] decay in hours
 *   rpe     — the session RPE assumed when none was given: the typical rating in the studies
 *   icon    — the glyph it is drawn with (components/Icon.jsx)
 */
export const SPORTS = {
  // FOOTBALL. Ninety-two percent of muscle injuries in professional football are in four
  // groups: hamstrings 37 %, adductors 23 %, quadriceps 19 %, calves 13 % (Ekstrand 2011, UEFA
  // injury study) — the muscles that take the sprints, the kicks and the cuts. The hip flexors
  // swing the kicking leg; the trunk turns into each strike.
  x004: {
    icon: 'ball',
    muscles: { hamstring: 1, quadriceps: 0.9, adductors: 0.7, gluteal: 0.6, calves: 0.6, 'hip-flexors': 0.5, obliques: 0.2, abs: 0.2 },
    tau: [14, 26],
    rpe: 7,
  },
  // PADEL. Moderate on the whole: 70–80 % of maximum heart rate, session RPE about 5 out of 10,
  // nearly all of it aerobic (Mellado-Arbelo & Baiget 2022, systematic review), and no drop in
  // jump height or grip strength after an amateur match (Sensors 2025). The load is local: the
  // elbow is the most injured site, then knee, shoulder and lower back, tendon first, muscle
  // second (padel injury reviews, 2023–2025) — so the forearm, the shoulder and the turning trunk
  // carry weight here, over legs that lunge, split-step and push off in short bursts. The racket
  // arm's muscles follow tennis EMG: pectoralis major and subscapularis on the forehand and
  // overheads, middle deltoid and infraspinatus on the backhand (Ryu 1988).
  x003: {
    icon: 'racket',
    muscles: {
      forearm: 0.7, quadriceps: 0.7, deltoids: 0.6, obliques: 0.6, gluteal: 0.6, calves: 0.6,
      adductors: 0.4, hamstring: 0.4, abs: 0.4, 'lower-back': 0.4, chest: 0.3, 'upper-back': 0.3, serratus: 0.2,
    },
    tau: [10, 16],
    rpe: 5,
  },
  // TENNIS. Padel's movements on a bigger court with a serve: more running, more overhead work.
  // Serve and forehand drive the pectoralis major, subscapularis and serratus anterior; the
  // backhand the middle deltoid and infraspinatus; the serve's pull-through the latissimus
  // (Ryu 1988). Four-hour matches on consecutive days leave CK and soreness rising day on day
  // (Gescheit 2015) — the long end of the range.
  x006: {
    icon: 'racket',
    muscles: {
      quadriceps: 0.8, deltoids: 0.7, calves: 0.7, gluteal: 0.6, obliques: 0.6, forearm: 0.6,
      chest: 0.5, 'upper-back': 0.5, adductors: 0.5, hamstring: 0.5, serratus: 0.4, abs: 0.4,
      'lower-back': 0.4, triceps: 0.3,
    },
    tau: [10, 18],
    rpe: 5,
  },
  // SWIMMING, front crawl as the reference stroke. The latissimus dorsi and pectoralis major
  // carry the propulsive phase in every stroke and the triceps finishes the push (Martens 2015,
  // systematic review of EMG in the four strokes); the deltoids bring the arm back over and the
  // rotator cuff is what overuse finds. The kick gives 10–13 % of the propulsion (Deschodt 1999;
  // Morouço 2015), hence light legs. Concentric and unloaded: little muscle damage, small CK
  // rises (Brancaccio 2007) — the shortest decay here.
  x005: {
    icon: 'swim',
    muscles: {
      'upper-back': 1, chest: 0.9, deltoids: 0.7, triceps: 0.7, serratus: 0.4, trapezius: 0.3,
      abs: 0.3, obliques: 0.3, quadriceps: 0.3, 'hip-flexors': 0.3, biceps: 0.2, gluteal: 0.2,
      hamstring: 0.2, calves: 0.2,
    },
    tau: [6, 10],
    rpe: 5,
  },
  // RUNNING. Soleus and gastrocnemius are the largest contributors to support and propulsion,
  // the quadriceps to braking, with gluteus maximus and the hamstrings behind (Hamner 2010;
  // Hamner & Delp 2013, simulations over speeds). Every landing is eccentric: CK peaks about a
  // day after a half marathon and soreness the night after; races take 48–72 h and more.
  x007: {
    icon: 'figureRun',
    muscles: { calves: 1, quadriceps: 0.9, gluteal: 0.6, hamstring: 0.6, 'hip-flexors': 0.4, tibialis: 0.3, abs: 0.2 },
    tau: [10, 20],
    rpe: 5,
  },
  // CYCLING. The vasti and gluteus maximus produce the power, gastrocnemius is near maximal in
  // sprints, the hamstrings and rectus femoris pull through the top (pedalling EMG reviews).
  // Concentric only: of the sports compared, cyclists show the smallest rise in muscle damage
  // markers across training and competition (eccentric vs concentric sports, 2022).
  x008: {
    icon: 'bike',
    muscles: { quadriceps: 1, gluteal: 0.7, calves: 0.5, hamstring: 0.4, 'hip-flexors': 0.3, tibialis: 0.2 },
    tau: [6, 10],
    rpe: 5,
  },
}

/** The profile of a sport, or null for anything that is not one. */
export const sportOf = id => (id && SPORTS[id]) || null

const clamp01 = v => Math.max(0, Math.min(1, v))

/**
 * How hard a logged sport set was, on the CR-10 scale: its own session rating, else an RPE
 * logged on the workout screen read the same way, else the sport's typical value — a duration
 * with no rating still happened, and the typical rating is what the studies found.
 */
export const srpeOf = (s, sp) => (s && s.srpe > 0 ? s.srpe : s && s.rpe > 0 ? s.rpe : (sp && sp.rpe) || 5)

/** τ in hours for a session of this sport at this rating — before sleep and food. */
export const sportTau = (sp, srpe) => sp.tau[0] + (sp.tau[1] - sp.tau[0]) * clamp01((srpe - 3) / 5)

/**
 * What one sport entry of a workout left on each muscle: { load: {slug: effective sets}, tau,
 * au }, or null when it is not a sport or nothing was done. `au` is the session-RPE load.
 */
export function sportLoad(id, sets) {
  const sp = sportOf(id)
  if (!sp) return null
  let au = 0, min = 0
  ;(sets || []).forEach(s => {
    if (!s || !s.done || !(s.min > 0)) return
    au += s.min * srpeOf(s, sp)
    min += s.min
  })
  if (!au) return null
  const load = {}
  for (const slug in sp.muscles) load[slug] = sp.muscles[slug] * au / SRPE_PER_SET
  return { load, tau: sportTau(sp, au / min), au: Math.round(au) }
}

/**
 * The CR-10 scale as five answers to "how was it?" — the anchors Foster's scale uses, in words,
 * because a number out of ten for a padel match is a question nobody answers the same way twice.
 */
export const EFFORT_LEVELS = [
  { v: 2, label: 'easy effort' },
  { v: 3, label: 'moderate effort' },
  { v: 5, label: 'hard effort' },
  { v: 7, label: 'very hard effort' },
  { v: 9, label: 'all-out effort' },
]
