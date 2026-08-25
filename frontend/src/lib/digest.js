// A digest: everything the log knows about a period, as plain text you can hand to
// something that coaches you.
//
// There is no way to write into a conversation from here, and no API that would let one —
// so the shape that works is text you copy or share into whichever conversation wants it.
// Two of them, because two conversations want different things: one following a cut or a
// bulk wants weight and intake with the session as context, one writing programs wants what
// was prescribed against what was actually done.
//
// Text, not JSON. Both a person and a model read it, and the person reads it first — they
// are about to paste it somewhere, and a wall of braces is not something you check before
// you do that.
//
// Everything is derived from the log at the moment it is built. Nothing is stored, so a
// digest can never be stale, and correcting a set corrects every digest made afterwards.

import { EXIDX } from './exercises.js'
import { setLabel, modeOf, effectiveRoutineId, workoutVolume } from './history.js'
import { readSession, nextPrescription, policyFor } from './progression.js'
import { effortSummary, displayScale, scaleName, toScale } from './effort.js'
import { entryFor, MACROS, MACRO_NAME } from './nutrition.js'
import { sleepFor, sleepHours } from './body.js'
import { healthFor } from './health.js'
import { dayBalance, sportKcal, trimOf } from './energy.js'
import { fmtNum, fmtDate, todayISO, isoOf } from './format.js'
import { t } from './i18n.js'
import { APP_NAME } from './brand.js'

// A period listing more sessions than this is summarised rather than printed in full: the
// digest has to survive being pasted into a message box, and the tail of a long history is
// the part a coach reads least. What was dropped is always stated — a silent cap reads as
// "that is everything".
export const MAX_SESSIONS = 12

const exName = id => (EXIDX[id] && EXIDX[id].n) || id
const sign = n => (n > 0 ? '+' : '') + fmtNum(n)
const inWindow = (iso, days, now) =>
  !days || new Date(iso + 'T12:00:00').getTime() > now - days * 86400000

/** Body weight on a day, or the most recent before it. */
function bwAt(S, iso) {
  const list = (S.bodyweight || []).filter(b => b.d <= iso)
  return list.length ? list[list.length - 1] : null
}

/** How the weight moved across a window: [oldest, newest] or null when there is no pair. */
function bwTrend(S, days, now) {
  const list = (S.bodyweight || []).filter(b => inWindow(b.d, days, now))
  return list.length > 1 ? [list[0], list[list.length - 1]] : null
}

/** One exercise's sets as the app writes them, so the digest and the screen never disagree. */
const setsLine = e => (e.sets || []).filter(s => s.done).map(s => setLabel(e.id, s, e.target)).join(', ')

/**
 * A session, one line per exercise, with what it was asked to do beside what it did. The
 * hit/miss mark is readSession's, not a fresh judgement — the digest must say exactly what
 * the progression engine will act on, or the coach reading it is working from a different
 * session than the app is.
 */
function sessionBlock(w, { targets = true } = {}) {
  const mins = w.end && w.start ? Math.round((w.end - w.start) / 60000) : null
  const head = [fmtDate(w.d, true), w.name, mins ? mins + ' min' : null].filter(Boolean).join(' · ')
  const lines = [head]
  ;(w.entries || []).forEach(e => {
    const done = setsLine(e)
    if (!done) return
    const parts = ['  ' + exName(e.id), done]
    if (targets && e.target) {
      const r = readSession(e, e.target)
      const mode = modeOf({ ...e.target, id: e.id })
      const goal = mode === 'time' ? `${e.target.sets}×${e.target.sec}s`
        : mode === 'cardio' ? `${e.target.min || 0} min`
          : `${e.target.sets}×${e.target.reps}`
      parts.push(t('target {0}', goal) + ' ' + (r.ok ? '✓' : '✗'))
    }
    lines.push(parts.join('  '))
  })
  if (w.prs && w.prs.length) lines.push('  ' + t('PR:') + ' ' + w.prs.map(exName).join(', '))
  // The watch's reading of the same session. Kept on its own line and labelled, because it
  // measured something different from the sets above and merging them would blur which
  // number came from where.
  if (w.watch) {
    const b = []
    if (w.watch.kcal) b.push(fmtNum(w.watch.kcal) + ' kcal')
    if (w.watch.hrAvg) b.push(t('HR {0} avg', w.watch.hrAvg) + (w.watch.hrMax ? ' / ' + w.watch.hrMax + ' max' : ''))
    if (w.watch.km) b.push(fmtNum(w.watch.km) + ' km')
    if (b.length) lines.push('  ' + t('watch:') + ' ' + b.join(' · '))
  }
  return lines.join('\n')
}

// Carbs first, then protein, then fat — how a day's eating is read back, and not the order
// the app stores them in.
const DIGEST_MACROS = ['c', 'p', 'f']
const hasAnyMacro = e => MACROS.some(m => e[m])

/**
 * The evening check-in — "Today", and only today.
 *
 * The order is the order a coach reads them in: what was done, what was eaten, how the night
 * before went, and then the one thing the app works out that no message could — the day's
 * balance, spelled out rather than handed over as a total, so the reader can see which of
 * the three numbers moved.
 *
 * Deliberately nothing else. No trend, no running total, no weigh-in: a conversation that
 * receives one of these every evening accumulates the history itself, and a digest that
 * re-sends it every night is asking the reader to reconcile two versions of the same past.
 * The app keeps the trends — Stats has them, and they are not what this message is for.
 *
 * No set-by-set detail either. That is a different question asked by a different
 * conversation, and trainingDigest below is where it lives.
 */
export function dailyDigest(S, iso = todayISO(), now = Date.now()) {
  const out = [APP_NAME + ' — ' + t('Today') + ' — ' + fmtDate(iso, true)]
  out.push('')

  // What was done. One line per activity, because a day can hold more than one.
  const acts = (S.workouts || []).filter(w => w.d === iso)
  if (!acts.length) {
    out.push(t('Activity') + ' ' + t('nothing logged'))
  } else {
    out.push(t('Activity'))
    acts.forEach(w => {
      const b = [w.name]
      const mins = (w.watch && w.watch.minutes) || (w.end && w.start ? Math.round((w.end - w.start) / 60000) : null)
      if (mins) b.push(mins + ' min')
      if (w.watch && w.watch.kcal) b.push(fmtNum(w.watch.kcal) + ' kcal')
      if (w.watch && w.watch.km) b.push(fmtNum(w.watch.km) + ' km')
      if (w.watch && w.watch.hrAvg) b.push(t('HR {0} avg', w.watch.hrAvg))
      out.push('  ' + b.join(' · '))
    })
  }

  // The energy that actually enters the arithmetic, with what the watch said beside it: a
  // trimmed figure nobody can trace back to the reading is a number nobody can check.
  const sp = sportKcal(S, iso, trimOf(S))
  if (sp.raw) {
    // Both corrections are named, and for the same reason: the watch's overcount, and the
    // NEAT the maintenance figure already contains. A reader who cannot get from the
    // reading to the counted number has to take it on faith.
    const why = [
      sp.trim ? t('{0} % taken off', Math.round(sp.trim * 100)) : null,
      sp.neat ? t('{0} NEAT already in maintenance', fmtNum(sp.neat)) : null
    ].filter(Boolean)
    out.push(t('Active energy') + ' ' + fmtNum(sp.raw) + ' kcal ' + t('from the watch')
      + (why.length ? ' → ' + fmtNum(sp.kcal) + ' ' + t('counted') + ' (' + why.join(', ') + ')' : ''))
  } else if (sp.source === 'missing') {
    out.push(t('Active energy') + ' ' + t('not measured'))
  }

  const e = entryFor(S, iso)
  if (e && (e.kcal || hasAnyMacro(e))) {
    const bits = [fmtNum(e.kcal || 0) + ' kcal']
    // Carbs, protein, fat — the order a food log is read back in.
    DIGEST_MACROS.forEach(m => { if (e[m]) bits.push(t(MACRO_NAME[m]) + ' ' + fmtNum(e[m]) + ' g') })
    const goal = S.nutriGoal && S.nutriGoal.kcal
    if (goal) bits.push(t('target {0}', fmtNum(goal)) + ' (' + sign((e.kcal || 0) - goal) + ')')
    out.push(t('Intake') + ' ' + bits.join(' · '))
  } else {
    out.push(t('Intake') + ' ' + t('nothing logged'))
  }

  const sl = sleepFor(S, iso)
  const slH = sleepHours(sl)
  out.push(t('Sleep') + ' ' + (slH == null ? t('nothing logged')
    : fmtNum(slH) + ' h ' + t('(the night before)') + (sl.q ? ' · ' + t('felt {0}/5', sl.q) : '')))

  // Spelled out rather than handed over as a total: the reader has to be able to see which
  // of the three numbers moved. The middle term is the day against the plan, not the day's
  // training — maintenance already budgets for the planned session.
  const bal = dayBalance(S, iso)
  if (bal && bal.deficit != null) {
    out.push(t('Balance') + ' ' + fmtNum(bal.tdee) + ' ' + t('maintenance')
      + ' ' + sign(bal.delta) + ' ' + t('sport vs plan')
      + ' − ' + fmtNum(bal.intake) + ' ' + t('eaten')
      + ' = ' + sign(bal.deficit) + ' kcal'
      + ' (' + (bal.deficit >= 0 ? t('deficit') : t('surplus')) + ')')
  }

  return out.join('\n')
}

/**
 * The programming digest: what was prescribed against what was done, and what the app will
 * prescribe next with the rule that decided it. The next targets are the part worth the
 * space — they say where the plan is actually heading, which is what a program gets adjusted
 * against.
 */
export function trainingDigest(S, days = 7, now = Date.now()) {
  const out = [APP_NAME + ' — ' + t('training, last {0} days', days)]

  const sessions = (S.workouts || []).filter(w => inWindow(w.d, days, now))
  const shown = sessions.slice(-MAX_SESSIONS)
  const hidden = sessions.length - shown.length

  const bw = bwAt(S, todayISO())
  const tr = bwTrend(S, days, now)
  const head = []
  if (bw) head.push(t('Weight') + ' ' + fmtNum(bw.w) + ' ' + S.unit + (tr ? ' (' + sign(tr[1].w - tr[0].w) + ')' : ''))
  head.push(t('Sessions') + ' ' + sessions.length)
  out.push(head.join(' · '))

  const eff = effortSummary(S, days)
  if (eff.rated > 0 && eff.avg != null) {
    const kind = displayScale(S)
    out.push(t('Effort') + ' ' + scaleName(kind) + ' ' + fmtNum(toScale(kind, eff.avg)) +
      ' ' + t('over {0} of {1} sets', eff.rated, eff.done))
  }

  if (shown.length) {
    out.push('')
    shown.forEach(w => { out.push(sessionBlock(w)); out.push('') })
    if (hidden > 0) out.push(t('({0} earlier sessions in this period are not listed)', hidden), '')
  }

  // What opens next time, per exercise of the weekly plan, with the reason. Reading the plan
  // rather than the history means an exercise that has never been trained still appears —
  // it is in the program, so the coach adjusting the program needs to see it.
  const lines = []
  const seen = new Set()
  ;[0, 1, 2, 3, 4, 5, 6].forEach(d => {
    const rid = S.week && S.week[d]
    const r = rid && (S.routines || []).find(x => x.id === rid)
    if (!r) return
    ;(r.ex || []).forEach(cfg => {
      if (seen.has(cfg.id)) return
      seen.add(cfg.id)
      const p = nextPrescription(S, cfg, r)
      if (!p || p.kind === 'off') return
      const mode = modeOf(cfg)
      const target = mode === 'time' ? (p.sec != null ? p.sec + 's' : '')
        : [p.weight != null ? fmtNum(p.weight) + ' ' + S.unit : null, p.reps != null ? '× ' + p.reps : null]
          .filter(Boolean).join(' ')
      const why = Array.isArray(p.why) ? t(...p.why) : ''
      lines.push('  ' + exName(cfg.id) + '  ' + target + (why ? '  — ' + why : ''))
    })
  })
  if (lines.length) {
    out.push(t('Next targets'))
    out.push(...lines)
  }
  return out.join('\n')
}

export const DIGESTS = ['daily', 'training']
export const buildDigest = (S, kind, days, now) =>
  kind === 'training' ? trainingDigest(S, days, now) : dailyDigest(S, todayISO(), now)
