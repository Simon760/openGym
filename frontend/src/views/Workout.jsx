import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr, exName, isMobility, termLabel, exCountOf } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, defaultConfig, warmEntry, swapEntry, setBodyweight, durMs, setsDone, setsDoneActive, supersetUnits, unitOf, nextSetAfter, carryForward, setLabel, modeOf, isBw, readoutOf, isOnce, cardioEffort, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort } from '../lib/history.js'
import { fmtNum, fmtDate, fmtDur, durPart, fmtVol, todayISO, uid, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import Media from '../components/Media.jsx'
import { startFlow, logPastSheet, exercisePicker, exConfigSheet, exerciseDetailSheet, finishWorkout, workoutCompleteSheet, confirmSheet, workoutDetailSheet, activitySheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
import { nextPrescription, applyPrescription } from '../lib/progression.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { routinesFor, programmeOf, blockAt } from '../lib/blocks.js'

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  // The programme in force today first; the routines of the others are a tap further, under
  // their programme's name — after a new programme, the old Push is not today's Push.
  const offer = routinesFor(S, todayISO())
  const others = offer.mine.filter(r => r !== todayR)
  const elsewhere = offer.others.filter(r => r !== todayR)
  const [more, setMore] = useState(false)
  const doneToday = (S.workouts || []).filter(w => w.d === todayISO())
  // Summed over the day, and each figure absent rather than zero when nothing carried it —
  // a session typed up without a duration has none, and "0 min" would claim it did.
  const recap = doneToday.reduce((a, w) => ({
    ms: a.ms + durMs(w),
    kcal: a.kcal + ((w.watch && w.watch.kcal) || 0),
    vol: a.vol + (w.vol || 0)
  }), { ms: 0, kcal: 0, vol: 0 })
  // One session's own figures, on the same rule as the tiles above: absent rather than zero.
  const sessionLine = w => {
    const bits = [
      ...durPart(durMs(w)),
      ...(w.watch && w.watch.kcal ? [fmtNum(w.watch.kcal) + ' kcal'] : []),
      ...(w.vol > 0 ? [fmtVol(w.vol, S.unit)] : [])
    ]
    // The set count only when nothing was measured: it is what keeps the line from being
    // empty, not a fourth figure crowding out three that say more.
    return bits.length ? bits.join(' · ') : t(setsDone(w) === 1 ? '{0} set' : '{0} sets', setsDone(w))
  }
  // Named for the day it belongs to, so a week of second sessions does not become a list of
  // "New routine" with nothing to tell them apart. Renamed like any other in the editor.
  const newSession = () => {
    const at = blockAt(S, todayISO())
    const r = { id: uid(), name: t('Session {0}', doneToday.length + 1), emoji: DEFAULT_GLYPH, ex: [], ...(at ? { block: at.block.id } : {}) }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    {/* Once the day is logged, offering to start it again is noise: what you came for is
        what it came to. The recap takes the card, and the only thing left to decide sits
        under it. Before that, the card is the two ways of doing it. */}
    {doneToday.length > 0 ? <>
      <div className="card" style={{ borderColor: 'var(--acc)', ...(doneToday.length === 1 ? { cursor: 'pointer' } : null) }}
        {...(doneToday.length === 1 ? { onClick: () => workoutDetailSheet(doneToday[0]) } : null)}>
        <div className="row between" style={{ marginBottom: 12 }}>
          {/* A count is not a name and does not need name-sized type — at 30px "2 séances
              aujourd'hui" took two lines and shoved the badge around. */}
          <div><div className="big" style={doneToday.length > 1 ? { fontSize: 22 } : null}>
            {doneToday.length === 1 ? doneToday[0].name : t('{0} sessions today', doneToday.length)}</div>
            <div className="muted small">{doneToday.length === 1 ? t('Done today') : t('Day total')}</div></div>
          <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22, background: 'var(--acc)' }}><Icon name="checkCircle" /></span>
        </div>
        <div className="tiles three" style={{ textAlign: 'left', marginBottom: 0 }}>
          <div className="tile"><div className="l">{t('Duration')}</div>
            <div className="v" style={{ fontSize: '1.1rem' }}>{recap.ms ? fmtDur(recap.ms) : '—'}</div></div>
          <div className="tile"><div className="l">{t('Energy')}</div>
            <div className="v" style={{ fontSize: '1.1rem' }}>{recap.kcal ? fmtNum(recap.kcal) + ' kcal' : '—'}</div></div>
          {/* Dashed like the other two when it is zero: a day of cardio moved no load, and
              "0 kg" beside two real figures reads as a measurement that came out empty. */}
          <div className="tile"><div className="l">{t('Volume')}</div>
            <div className="v" style={{ fontSize: '1.1rem' }}>{recap.vol > 0 ? fmtVol(recap.vol, S.unit) : '—'}</div></div>
        </div>
        {/* Every session on its own line once there is more than one. Their names joined into
            a title with a single total underneath, a second session that carried no figures of
            its own could not be told from one that was never logged at all — which is exactly
            what it looked like. */}
        {doneToday.length > 1 && <div className="list" style={{ marginTop: 12, marginBottom: 0 }}>
          {doneToday.map(w => <div key={w.id} className="item" onClick={() => workoutDetailSheet(w)}>
            <span className="lrow-i" style={{ width: 30, height: 30, borderRadius: 8, fontSize: 16 }}>
              <Icon name={glyphOf((S.routines.find(r => r.id === w.routineId) || {}).emoji)} /></span>
            <div className="grow"><div className="tt">{w.name}</div><div className="ss">{sessionLine(w)}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>)}
        </div>}
      </div>
      {/* A match or a swim on top of the day's lifting is an activity, not a second routine:
          this used to be the only button here, and it built an empty routine to put padel in. */}
      <Button icon="figureRun" onClick={() => activitySheet()}>{t('Add an activity (padel, football…)')}</Button>
      <div style={{ height: 8 }} />
      <Button icon="plus" onClick={newSession}>{t('Add a weights session')}</Button>
      <div style={{ height: 6 }} />
    </> : todayR && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="accent">{t("Today's plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayR.name}</div><div className="muted small">{exCountOf(todayR.ex)}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayR.emoji)} /></span>
      </div>
      {/* Said out loud, because the alternative is a screen that looks identical whether the
          day is untouched or its session was logged an hour ago — and Start, which always
          builds a new session and checks nothing, then reads as "it restarted my workout".
          The state was the answer all along; it was just never on screen. */}
      <div className="small" style={{ color: 'var(--yellow)', margin: '-4px 2px 12px', lineHeight: 1.45 }}>
        <Icon name="info" style={{ fontSize: 13, marginRight: 5, verticalAlign: '-2px' }} />
        {t('Nothing logged today yet — Start builds a new session. Use “Already did it” for one you have done.')}
      </div>
      {/* Every way of starting a session is also a way of writing one up, because a session
          you did without the app in your hand is still that session — the planned one, out of
          the programme, not a freestyle stand-in for it. */}
      <Button variant="primary" icon="play" onClick={() => startFlow(todayR.id)}>{t('Start {0}', todayR.name)}</Button>
      <div style={{ height: 8 }} />
      <Button icon="history" onClick={() => logPastSheet(todayR.id)}>{t('Already did it — write it up')}</Button>
    </div>}
    {(others.length > 0 || elsewhere.length > 0) && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{[...others, ...(more ? elsewhere : [])].map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div>
          <div className="ss">{[elsewhere.includes(r) ? (programmeOf(S, r) || {}).name : null, exCountOf(r.ex)].filter(Boolean).join(' · ')}</div></div>
        <button className="iconbtn" aria-label={t('Already did it — write it up')}
          onClick={e => { e.stopPropagation(); logPastSheet(r.id) }}><Icon name="history" /></button>
        <span className="tag acc">{t('Start')}</span></div>)}
        {elsewhere.length > 0 && !more && <div className="item" onClick={() => setMore(true)}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="calendar" /></span>
          <div className="grow"><div className="tt">{t('Other programmes')}</div>
            <div className="ss">{t(elsewhere.length === 1 ? '{0} routine' : '{0} routines', elsewhere.length)}</div></div>
          <Icon name="chevronDown" className="chev" />
        </div>}
      </div></>}
    <div style={{ height: 14 }} />
    {!doneToday.length && <><Button icon="figureRun" onClick={() => activitySheet()}>{t('Add an activity (padel, football…)')}</Button>
      <div style={{ height: 8 }} /></>}
    <Button icon="shuffle" onClick={() => startFlow(null)}>{t('Freestyle workout (pick as you go)')}</Button>
    <div style={{ height: 8 }} />
    {/* And the one that answers none of the above: a day other than today, or a session that
        was not in the programme at all. */}
    <Button variant="ghost" icon="history" onClick={() => logPastSheet()}>{t('Log another day’s session')}</Button>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
/**
 * What the programme says about an exercise — the setup, the effort target, the cue — or the
 * instructions an exercise of your own carries. Two lines until tapped: the first lines are the
 * ones wanted mid-set, and a mobility drill's three phases are there when you need them.
 */
function CoachNote({ text }) {
  const [open, setOpen] = useState(false)
  return <div className={'coachnote' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
    <Icon name="clipboard" /><span>{text}</span>
  </div>
}

function ExerciseBlock({ entryIdx, compact, onToggle, onField, onAddSet, onRemoveSet, onStartTimed, onWarm, onDrop, onDropField, onSwap, onBodyweight }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  // The same number the "confirm your working weight" sheet calls your best, so the two
  // never disagree inside one session: heaviest logged set, or the working weight you kept.
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), (S.exWeights[entry.id] || {}).w || 0)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  // Effort — RIR or RPE, whichever the profile logs. Opt-in for lifting, where the weight on
  // the bar already says most of it; on cardio it is the default, because there it is the only
  // measure of intensity left (see cardioEffort). `opt` because an unlogged effort is not the
  // same as 0 — RIR 0 says the set went to failure.
  const kind = cardio ? cardioEffort(S) : effortOf(S)
  const eff = EFFORT[kind]
  const effCol = eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null
  const readout = cardio ? readoutOf(cfg) : 'none'
  // A game is one block of minutes, not a count of them (see isOnceEx).
  const once = isOnce(cfg)
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : (bw && !added) ? repCol : loadCol
  // Duration and effort always; then whichever one thing the machine displays, if it displays
  // anything at all (see readoutOf). A game of padel has neither a speed nor a distance, and
  // an empty column asking for one is how a made-up figure gets into the log.
  const col2 = cardio ? (readout === 'speed' ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') } : effCol)
    : timed ? ((bw && !added) ? null : loadCol)
      : (bw && !added) ? null : repCol
  const col3 = cardio ? (readout === 'speed' ? effCol
    : readout === 'dist' ? { f: 'km', step: 0.5, dec: true, opt: true, hd: t('Distance (km)') } : null)
    // Nobody rates a mobility drill's reps in reserve: the column would only sit there empty.
    : mode === 'reps' && eff && !isMobility(ex) ? effCol : null
  // Does a set here carry a weight at all? True for an ordinary lift, and for bodyweight work
  // once there is something on the belt; false for a plain pull-up, where col1 is the reps and
  // there is no second column. Only such a set can carry a second load.
  const loaded = !cardio && !timed && !!col2
  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s, i, col, dir) => {
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label="Decrease" onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      {/* a typed effort is capped — there is no RPE 12, and 12 reps in reserve is a warm-up */}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} /></span>
      <button aria-label="Increase" onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
    </div>
  )
  // A second load on the same set — a drop, or the next rung of a pyramid. Same controls,
  // indented under their set, because they belong to it rather than standing beside it.
  const dcell = (d, i, k, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label="Decrease" onClick={() => onDropField(i, k, col.f, Math.max(0, Math.round((((d[col.f] || 0) - col.step)) * 100) / 100))}><Icon name="minus" /></button>
      <span className="val"><NumberField decimal={col.dec} value={d[col.f] ?? ''} onChange={v => onDropField(i, k, col.f, v)} /></span>
      <button aria-label="Increase" onClick={() => onDropField(i, k, col.f, Math.max(0, Math.round((((d[col.f] || 0) + col.step)) * 100) / 100))}><Icon name="plus" /></button>
    </div>
  )
  return <>
    <Media ex={ex} key={entry.id} compact={compact} minimizable />
    <div className="row between" style={{ marginBottom: 6 }}>
      <div className="exn" style={{ fontSize: compact ? 17 : 20, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2 }}>{exName(ex)}</div>
      <div className="row" style={{ gap: 2, flex: 'none' }}>
        {/* Next to the name, because that is the thing being changed, and because the moment
            you need it you are standing in front of an occupied machine. */}
        <button className="iconbtn" aria-label={t('Swap this exercise')} onClick={onSwap}><Icon name="shuffle" /></button>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      </div>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {entry.warm && <span className="tag" style={{ color: 'var(--yellow)' }}><Icon name="stretch" />{t('Warm-up')}</span>}
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* You log the total; this is the split, so the set in front of you is unambiguous
          without the rep count having to mean two different things (issue #31). */}
      {!cardio && !timed && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="shuffle" />{t('{0} per side', fmtNum(sideReps(entry.sets.find(s => !s.done)?.r ?? entry.sets[0]?.r)))}</span>}
      {/* French terms take a capital on the first word only — "Machine à levier", not "Machine À Levier". */}
      {(ex.tg || ex.bp) && <span className="tag nocap">{termLabel(ex.tg || ex.bp)}</span>}
      {/* The equipment tag doubles as the switch, because "which equipment" is exactly the
          question being answered: no plates today, just me. Tapping it drops the weight
          column and the load on every set still owed. Not offered on cardio, which has no
          load column to drop. */}
      {!cardio ? <button className={'tag nocap' + (bw ? ' acc' : '')} style={{ cursor: 'pointer' }}
        aria-pressed={bw} onClick={onBodyweight}>
        <Icon name={bw ? 'check' : 'dumbbell'} />{bw ? t('Bodyweight') : termLabel(ex.eq || 'Bodyweight')}
      </button> : ex.eq && <span className="tag nocap">{termLabel(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>
    {/* The programme's words for this exercise, or your own exercise's instructions. */}
    {(cfg.note || (ex.custom && ex.desc)) && <CoachNote text={cfg.note || ex.desc} />}
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
      <div className={'sethead' + (col3 ? ' eff3' : '')}><span className="n-sp" /><span className="w-sp">{col1.hd}</span>{col2 && <span className="r-sp">{col2.hd}</span>}{col3 && <span className="eff-sp">{col3.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp" /></div>
      {/* One set can render several rows: itself, then any extra loads carried on it. */}
      {entry.sets.map((s, i) => [<div key={i} data-set={entryIdx + ':' + i} className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '')}
        style={s.warm ? { opacity: .62 } : undefined}>
        {/* The set number doubles as the warm-up toggle. A warm-up is logged like any other
            set and counted in none of the figures — not volume, not a record, and above all
            not as "last time" for the progression engine, which would walk the programme
            backwards off a bar-only set faster than any bug could. */}
        {/* A one-off has no number to give: "1" out of one says nothing, and the warm-up
            toggle under it would offer to make the match itself a warm-up. The cell stays so
            the columns line up with every other row in the app. */}
        {once ? <span className="n" style={{ background: 'none' }} aria-hidden="true" />
          : <button className="n" style={{ background: 'none', border: 0, padding: 0, font: 'inherit',
            color: s.warm ? 'var(--yellow)' : 'inherit', cursor: 'pointer' }}
            aria-label={s.warm ? t('Warm-up — tap for a working set') : t('Tap to mark as a warm-up')}
            onClick={() => onWarm(i)}>{s.warm ? t('W') : i + 1}</button>}
        {cell(s, i, col1, 'w')}
        {col2 && cell(s, i, col2, 'r')}
        {col3 && cell(s, i, col3, 'eff')}
        {/* A timed set is started, not typed: the timer counts the hold down and checks the
            set off itself. The checkbox stays for anyone who timed it on their own watch. */}
        {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
          onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
        <Check checked={s.done} onChange={() => onToggle(i)} />
      </div>,
      // The extra loads of this set, then the button that adds one. Weight and reps only: a
      // second load is never cardio and never timed, and — the reason for `loaded` — a set
      // with no load at all cannot carry a second one. A pull-up was being offered "another
      // load on this set" under a row that has one stepper and no weight in sight.
      ...(loaded ? (s.drops || []).map((d, k) => <div key={i + '-' + k}
        className={'setrow drop' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
        <div className="n" aria-hidden="true">↳</div>
        {dcell(d, i, k, col1, 'w')}
        {col2 && dcell(d, i, k, col2, 'r')}
        {col3 && <span className="eff-sp" />}
        <button className="setgo" aria-label={t('Remove this load')} onClick={() => onDrop(i, k, null)}><Icon name="minus" /></button>
      </div>) : []),
      // Deliberately quiet: this belongs to a minority of sets, and one accent-coloured
      // call to action under every row would shout louder than the sets themselves.
      ...(loaded ? [<div key={i + '-add'} style={{ padding: '0 0 6px 34px' }}>
        <button onClick={() => onDrop(i, null, { w: 0, r: s.r || 0 })}
          style={{ background: 'none', border: 0, padding: '3px 0', font: 'inherit', fontSize: 12,
            color: 'var(--label-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="plus" style={{ fontSize: 13 }} />{t('Another load on this set')}
        </button>
      </div>] : [])
      ])}
      {!once && <>
        <div style={{ height: 8 }} />
        <div className="row">
          <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('Remove set')}</Button>
          <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
        </div>
      </>}
    </div>
  </>
}

/* ---------- keeping the next set within reach ----------
   A session is run one-handed, twenty-odd ticks of the same thumb. The set to do next has to
   come to the thumb rather than the thumb go looking for it — under the rest bar, or under
   the tab bar, is out of reach however visible the rest of the screen is. */
const motion = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
// The line nothing reachable sits below: the top of the rest bar when one is up, of the tab
// bar when not.
function thumbFloor() {
  const cover = document.getElementById('timer') || document.getElementById('tabbar')
  return (cover ? cover.getBoundingClientRect().top : window.innerHeight) - 14
}
const setRow = at => (at ? document.querySelector(`[data-set="${at[0]}:${at[1]}"]`) : null)
// After a tick: the next set, if it is out of sight, brought to sit just above the bar — the
// lowest place on the screen a thumb reaches, from below as from above (in a superset the next
// set is back up in the first exercise). A row already in sight stays put: the screen jumping
// under a finger is its own kind of mis-tap.
function bringToThumb(el) {
  if (!el) return
  const r = el.getBoundingClientRect(), floor = thumbFloor(), ceiling = 64
  if (r.bottom > floor || r.top < ceiling) window.scrollBy({ top: r.bottom - floor, behavior: motion() })
}
// An exercise just come up, or the screen just opened on one: from the top, so its name is the
// first thing read — but never so far up that its first set to do is left under the bar.
function showFromTop(el, instant) {
  const top = el ? Math.max(0, el.getBoundingClientRect().bottom + window.scrollY - thumbFloor()) : 0
  window.scrollTo({ top, behavior: instant ? 'auto' : motion() })
}
// Rendered after the rest bar has come up and the page has grown room for it.
const afterLayout = fn => setTimeout(fn, 160)

/* ---------- every exercise in the session, to jump to one ---------- */
function UnitList({ close }) {
  const A = useStore(s => s.S.active)
  const update = useStore(s => s.update)
  if (!A) return null
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  // The lifting and the mobility as two parts, each numbered on its own — the way the counter
  // at the top of the session reads them.
  const runs = unitRuns(A.entries, units)
  const mixed = runs.some(r => r.mob) && runs.some(r => !r.mob)
  return <>
    <h3>{t('Exercises')}</h3>
    {runs.map((run, j) => <div key={j}>
      {/* The sheet's title already says Exercises: a heading for the lifting only after
          mobility came first. */}
      {mixed && (run.mob || j > 0) && <h4 className="sec">{run.mob ? termLabel('mobility') : t('Exercises')}</h4>}
      <div className="list" style={{ marginBottom: 0 }}>
        {run.units.map(({ u, n }) => {
          const sets = u.flatMap(i => A.entries[i].sets)
          const done = sets.filter(x => x.done).length
          const finished = sets.length > 0 && done === sets.length
          return <div key={u[0]} className="item" onClick={() => { update(s => { s.active.cur = u[0] }); close() }}>
            <span className="lrow-i" style={{ width: 30, height: 30, borderRadius: 8, fontSize: 15,
              background: finished ? 'var(--acc)' : 'var(--surface-3)', color: finished ? 'var(--on-acc)' : 'var(--label)' }}>
              {finished ? <Icon name="check" /> : n}</span>
            <div className="grow">
              <div className="tt exn">{u.map(i => exName(exOr(A.entries[i].id))).join(' + ')}</div>
              <div className="ss">{t('{0} sets', done + '/' + sets.length)}</div>
            </div>
            {u.includes(cur) ? <span className="tag acc nocap">{t('Now')}</span> : <Icon name="chevronRight" className="chev" />}
          </div>
        })}
      </div>
    </div>)}
  </>
}

/**
 * A session's units in runs of one kind — lifting, then mobility, in the order they are done —
 * each unit numbered within its kind. A superset is mobility only when all of it is.
 */
function unitRuns(entries, units) {
  const runs = []
  const seen = { true: 0, false: 0 }
  units.forEach(u => {
    const mob = u.length > 0 && u.every(i => isMobility(entries[i].id))
    const last = runs[runs.length - 1]
    const item = { u, n: ++seen[mob] }
    if (last && last.mob === mob) last.units.push(item)
    else runs.push({ mob, units: [item] })
  })
  return runs
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI()
  const A = S.active
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)
  // The mobility counted apart from the lifting, as in every list of the session: "Exercice
  // 3 / 6" then "Mobilité 2 / 9", the sets of each on their own.
  const mobTotal = A.entries.reduce((n, e) => n + (isMobility(e.id) ? e.sets.length : 0), 0)
  const mobDone = A.entries.reduce((n, e) => n + (isMobility(e.id) ? e.sets.filter(x => x.done).length : 0), 0)
  const runs = unitRuns(A.entries, units)
  const run = runs.find(r => r.units.some(x => x.u === unit))
  const place = run ? run.units.find(x => x.u === unit).n : 0
  const ofKind = run ? runs.filter(r => r.mob === run.mob).reduce((n, r) => n + r.units.length, 0) : 0

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // A new weight or rep count on a set still to do carries down to the sets after it that
  // still matched — see carryForward for what it leaves alone.
  const setField = (idx, i, field, v) => mutEntry(idx, e => { carryForward(e.sets, i, field, v) })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), ...(l && l.km ? { km: l.km } : {}), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  })
  const removeSet = idx => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.pop() })
  const setWarm = (idx, i) => mutEntry(idx, e => { e.sets[i].warm = !e.sets[i].warm })
  // k === null adds; add === null removes. One handler, because a drop list is small enough
  // that two would only be two things to keep in step.
  const setDrop = (idx, i, k, add) => mutEntry(idx, e => {
    const s = e.sets[i]
    if (add) { s.drops = [...(s.drops || []), add]; return }
    s.drops = (s.drops || []).filter((_, j) => j !== k)
    if (!s.drops.length) delete s.drops
  })
  const setDropField = (idx, i, k, f, v) => mutEntry(idx, e => { e.sets[i].drops[k][f] = v })
  // The machine is taken. Pick another and carry on where you were — see swapEntry for what
  // happens to sets you had already logged on the one you are leaving.
  const swapEx = idx => exercisePicker((ex, done) => {
    done()
    update(s => {
      const r = swapEntry(s, s.active.entries, idx, ex.id)
      s.active.entries = r.entries
      s.active.cur = r.cur
    })
    useUI.getState().toast(t('Swapped for {0}', exName(ex)))
  })
  const toggleBw = idx => update(s => {
    const e = s.active.entries[idx]
    const on = !isBw({ ...(e.target || {}), id: e.id })
    const r = setBodyweight(s.active.entries, idx, on)
    s.active.entries = r.entries
    s.active.cur = r.cur
    useUI.getState().toast(on ? t('Bodyweight — no load asked for') : t('Load asked for again'))
  })

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, exOr(e.id).n, elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i) => {
    const m = modeAt(idx)
    let ticked = false, exJustDone = false, workoutDone = false, next = null
    update(s => {
      const e = s.active.entries[idx]
      e.sets[i].done = !e.sets[i].done
      if (!e.sets[i].done) return
      ticked = true
      beep(S.sound, 1040, 0.12); vibrate(30)
      const isLastExInUnit = idx === unit[unit.length - 1]
      const unitDone = unit.every(k => s.active.entries[k].sets.every(x => x.done))
      // The rest the programme gives the exercise that closes this unit, else the app-wide one.
      // Zero is a rest of its own: "enchaîne" — no timer at all.
      const own = (s.active.entries[unit[unit.length - 1]].target || {}).rest
      const restSec = own != null ? own : S.restSec
      const rest = () => { if (restSec > 0) startRest(restSec); else stopRest() }
      exJustDone = e.sets.every(x => x.done)
      // What comes up next is the next exercise that still has a set to do — the one after
      // this, or, once the end is reached, one skipped on the way. None left is the session.
      const open = u => u.some(k => s.active.entries[k].sets.some(x => !x.done))
      const ahead = unitDone ? [...units.slice(unitIdx + 1), ...units.slice(0, unitIdx)].find(open) : null
      if (unitDone && !ahead) { workoutDone = true; stopRest(); return }   // the whole session
      if (unitDone) {
        // The longest rest of a session is the one between two exercises, and it used to be
        // the one left untimed — the bar stopped and a "weight you used" prompt came up in its
        // place, asking for a figure already on every row. Now the rest runs, and the next
        // exercise comes up under it. The heaviest set still becomes next time's weight when
        // the session is finished (doFinishWorkout).
        next = ahead
        s.active.cur = next[0]
        // No rest timer on a session being typed up: the rest happened hours ago.
        if (!A.log) rest(); else stopRest()
      } else if (isLastExInUnit && !A.log) rest()
    }, true)
    // A rest that was over and still on screen goes with the set that ended it — unless that
    // set started a new one, which has already taken its place.
    if (ticked) { const tm = useUI.getState().timer; if (tm && tm.over != null) stopRest() }
    if (workoutDone) workoutCompleteSheet()
    else if (next) useUI.getState().toast(t('Next: {0}', next.map(k => exName(exOr(A.entries[k].id))).join(' + ')))
    else if (exJustDone && m === 'cardio') useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))
    // Same exercise, next set: brought to the thumb. A new exercise scrolls itself — below.
    if (ticked && !next && !workoutDone) afterLayout(() => {
      const A2 = useStore.getState().S.active
      if (A2) bringToThumb(setRow(nextSetAfter(A2.entries, unitOf(supersetUnits(A2.entries), idx), idx, i)))
    })
  }

  // An exercise coming up — Next, Prev, a jump from the list, or the last set of the one before
  // ticked. It slides in from the side it came from, so the screen visibly changes even when two
  // exercises look alike, and the page goes back to its top. Opening the screen does the same
  // without the slide: a session starts, or is resumed, with its next set already in reach —
  // under the exercise animation it used to sit beneath the tab bar.
  const shown = useRef(unitIdx)
  const dir = useRef(1)
  if (shown.current !== unitIdx) { dir.current = unitIdx > shown.current ? 1 : -1; shown.current = unitIdx }
  const opened = useRef(false)
  useEffect(() => {
    const first = !opened.current
    opened.current = true
    const tm = afterLayout(() => {
      const A2 = useStore.getState().S.active
      if (!A2 || !A2.entries.length) return
      const u = unitOf(supersetUnits(A2.entries), Math.min(A2.cur, A2.entries.length - 1))
      showFromTop(setRow(nextSetAfter(A2.entries, u, u[0], -1)), first)
    })
    return () => clearTimeout(tm)
  }, [unitIdx])

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  const allOnce = A.entries.length > 0 && A.entries.every(e => isOnce({ ...(e.target || {}), id: e.id }))
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); nav('/home') } })}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div>
        {/* A session typed up afterwards has no clock to show and nothing to time: showing one
            would count from the moment you sat down to enter it, which is not a duration of
            anything. The date takes its place, since it is the thing that is not today. */}
        {/* A session made only of one-off activities has no sets to count: "0/1 séries" for
            a game of padel is the sentence that made it read as sets in the first place. The
            finish line below still carries the progress, in exercises. */}
        <div className="sub">{A.log ? fmtDate(A.d, true) : <Elapsed start={A.start} />}
          {!allOnce && total > mobTotal && <> · {t('{0} sets', (done - mobDone) + '/' + (total - mobTotal))}</>}
          {mobTotal > 0 && <> · {t('mobility {0}', mobDone + '/' + mobTotal)}</>}</div></div>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

    {A.entries.length ? <>
      {/* Where you are in the session, and the way to anywhere else in it. */}
      <button className="exnav muted small" onClick={() => useUI.getState().openSheet(close => <UnitList close={close} />)}>
        {run && run.mob ? t('Mobility {0} / {1}', place, ofKind)
          : isSuperset ? t('Superset {0} / {1}', place, ofKind) : t('Exercise {0} / {1}', place, ofKind)}
        <Icon name="chevronDown" />
      </button>
      <div key={'u' + unitIdx + ':' + unit.map(k => A.entries[k].id).join('+')} className="exin" style={{ '--exin-dx': dir.current * 14 + 'px' }}>
      {isSuperset ? (
        <div className="ss-card">
          <div className="ss-hd"><Icon name="link" />{t('Superset · do these back-to-back, rest after both')}</div>
          {unit.map((idx, k) => <div key={idx} className="ss-ex">
            {k > 0 && <div className="ss-amp">+</div>}
            <ExerciseBlock entryIdx={idx} compact
              onToggle={i => toggle(idx, i)} onField={(i, f, v) => setField(idx, i, f, v)} onAddSet={() => addSet(idx)} onRemoveSet={() => removeSet(idx)} onStartTimed={i => startTimed(idx, i)} onWarm={i => setWarm(idx, i)} onDrop={(i, k, add) => setDrop(idx, i, k, add)} onDropField={(i, k, f, v) => setDropField(idx, i, k, f, v)} onSwap={() => swapEx(idx)} onBodyweight={() => toggleBw(idx)} />
          </div>)}
        </div>
      ) : (
        <ExerciseBlock entryIdx={cur} onToggle={i => toggle(cur, i)} onField={(i, f, v) => setField(cur, i, f, v)} onAddSet={() => addSet(cur)} onRemoveSet={() => removeSet(cur)} onStartTimed={i => startTimed(cur, i)} onWarm={i => setWarm(cur, i)} onDrop={(i, k, add) => setDrop(cur, i, k, add)} onDropField={(i, k, f, v) => setDropField(cur, i, k, f, v)} onSwap={() => swapEx(cur)} onBodyweight={() => toggleBw(cur)} />
      )}
      </div>
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    <div style={{ height: 12 }} />
    <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => update(s => { s.active.cur = units[unitIdx - 1][0] })}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => update(s => { s.active.cur = units[unitIdx + 1][0] })}>{t('Next')}</Button>
    </div>
    <div style={{ height: 10 }} />
    <Button onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => {
      const full = { ...cfg, id: ex.id }
      const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
      s.active.entries.push({ id: ex.id, target: { ...cfg }, plan, sets: applyPrescription(buildSets(s, full), plan) })
      s.active.cur = s.active.entries.length - 1
    }), null, S.routines.find(r => r.id === A.routineId), { cta: t('Add to the session') }))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 8 }} />
    {/* The same picker, filed in front of the lifting rather than after it, with every set
        flagged. A live session that opened with ten minutes on the bike gets it typed where
        it belongs; a session started without one can still say so afterwards. */}
    {!A.entries.some(e => e.warm) && <Button variant="ghost" className="dim" size="sm" icon="stretch"
      onClick={() => exercisePicker((ex, done) => { done(); update(s => {
        s.active.entries.unshift(warmEntry(s, { ...defaultConfig(ex.id), id: ex.id }))
        s.active.cur = 0
      }) })}>{t('Add a warm-up')}</Button>}
    {/* The choice between training and writing training up used to be made once, at the door,
        and never again — so pressing Start on a session you had already done left you with a
        clock counting your typing and no way back, since the screen that offers the other
        door is the one an active session replaces. */}
    {/* The way out of a session you started by mistake. An active workout replaces the
        screen that offers the others — the tab even renames itself Resume — so pressing Start
        on the wrong one left the app looping back into it with no visible way to choose
        again, short of discarding it and knowing that was the trick.
        Always offered, never only while the session is empty: the moment a set is ticked is
        exactly when someone is most sure they picked the wrong session, and a hidden exit is
        the thing that made this cost three exchanges. What is at stake is said out loud
        instead, and only when there is something at stake. */}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" size="sm" icon="shuffle" onClick={() => {
      const leave = () => { update(s => { s.active = null }); stopRest(); nav('/workout') }
      if (!done) return leave()
      confirmSheet({
        title: t('Choose a different workout'),
        message: t(done === 1 ? '{0} set logged in this session will be lost.' : '{0} sets logged in this session will be lost.', done),
        confirmText: t('Leave it'), danger: true, onConfirm: leave
      })
    }}>{t('Choose a different workout')}</Button>
    {!A.log && <><div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" size="sm" icon="history" onClick={() => update(s => {
        s.active.log = true
        stopRest()
        useUI.getState().toast(t('Clock off — you’ll be asked for the duration at the end'))
      })}>{t('This was done earlier — drop the clock')}</Button></>}
    <div style={{ height: 10 }} />
    {(() => {
      const finished = e => e.sets.length > 0 && e.sets.every(s => s.done)
      const exDone = A.entries.filter(finished).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      const mob = A.entries.filter(e => isMobility(e.id)), lift = A.entries.filter(e => !isMobility(e.id))
      return <button className={allDone ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {allDone ? t('Finish workout')
          : mob.length && lift.length ? t('Finish workout early · {0} exercises · mobility {1}',
            lift.filter(finished).length + '/' + lift.length, mob.filter(finished).length + '/' + mob.length)
            : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
