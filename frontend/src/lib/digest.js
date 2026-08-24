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
import { entryFor, avgOver, MACROS, MACRO_NAME } from './nutrition.js'
import { fmtNum, fmtDate, todayISO, isoOf } from './format.js'
import { t } from './i18n.js'

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
  return lines.join('\n')
}

/** Intake for a day, or null when nothing was logged. */
function intakeLine(S, iso) {
  const e = entryFor(S, iso)
  if (!e) return null
  const bits = [fmtNum(e.kcal || 0) + ' kcal']
  MACROS.forEach(m => { if (e[m]) bits.push(t(MACRO_NAME[m]) + ' ' + fmtNum(e[m]) + ' g') })
  const goal = S.nutriGoal && S.nutriGoal.kcal
  if (goal) bits.push(t('target {0}', fmtNum(goal)) + ' (' + sign((e.kcal || 0) - goal) + ')')
  return bits.join(' · ')
}

/**
 * The evening check-in: where the weight is, what was eaten, whether there was a session,
 * and a week of context so a single day is never read as a trend.
 */
export function dailyDigest(S, iso = todayISO(), now = Date.now()) {
  const out = ['openGym — ' + fmtDate(iso, true)]

  const bw = bwAt(S, iso)
  if (bw) {
    const prev = (S.bodyweight || []).filter(b => b.d < bw.d).pop()
    const bits = [fmtNum(bw.w) + ' ' + S.unit + (prev ? ' (' + sign(bw.w - prev.w) + ')' : '')]
    if (S.targetW) bits.push(t('target {0}', fmtNum(S.targetW) + ' ' + S.unit) + ' (' + sign(S.targetW - bw.w) + ')')
    out.push(t('Weight') + ' ' + bits.join(' · '))
  }

  const intake = intakeLine(S, iso)
  out.push(t('Intake') + ' ' + (intake || t('nothing logged')))

  const w = (S.workouts || []).find(x => x.d === iso)
  if (w) {
    out.push('')
    out.push(sessionBlock(w))
    out.push('  ' + fmtNum(workoutVolume(w)) + ' ' + S.unit)
  } else {
    // A rest day and a missed session are different facts, and the difference is the one a
    // coach acts on — so the plan is consulted rather than reporting a bare "no session".
    const planned = effectiveRoutineId(S, iso)
    const r = planned && (S.routines || []).find(x => x.id === planned)
    out.push(t('Session') + ' ' + (r ? t('{0} planned, not logged', r.name) : t('rest day')))
  }

  out.push('')
  out.push(t('Last 7 days'))
  const avg = avgOver(S, 7, now)
  out.push('  ' + t('Intake') + ' ' + (avg.kcal == null
    ? t('nothing logged')
    // The denominator travels with the average everywhere it appears — an intake log has
    // gaps, and a mean over 3 days read as a week is the wrong number to coach from.
    : fmtNum(avg.kcal) + ' kcal/' + t('day') + ' ' + t('over {0} logged days', avg.kcalDays)))
  const tr = bwTrend(S, 7, now)
  if (tr) out.push('  ' + t('Weight') + ' ' + sign(tr[1].w - tr[0].w) + ' ' + S.unit)
  const wk = (S.workouts || []).filter(x => inWindow(x.d, 7, now))
  out.push('  ' + t('Sessions') + ' ' + wk.length)
  return out.join('\n')
}

/**
 * The programming digest: what was prescribed against what was done, and what the app will
 * prescribe next with the rule that decided it. The next targets are the part worth the
 * space — they say where the plan is actually heading, which is what a program gets adjusted
 * against.
 */
export function trainingDigest(S, days = 7, now = Date.now()) {
  const out = ['openGym — ' + t('training, last {0} days', days)]

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
