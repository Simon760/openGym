import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, workoutDetailSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor, nutriSheet, nutriGoalSheet, digestSheet, openPendingProgram, discardPendingProgram, sleepSheet, tdeeSheet, watchSheet, projectionSheet } from '../sheets.jsx'
import { entryFor, kcalFromMacros, macroSplit, remainingOf, MACROS, MACRO_NAME, MACRO_COLOR } from '../lib/nutrition.js'
import { composition, sleepFor, lastSleep, sleepHours, whenOf, sinceStart, bwAsOf } from '../lib/body.js'
import { dayBalance, projectedWeight } from '../lib/energy.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { APP_NAME } from '../lib/brand.js'

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)
  // Which day the whole page is showing. The cards are the same cards — a day in the past is
  // not a different screen, it is this screen with that day's figures in it, and the same
  // buttons for filling in what is missing.
  const [sel, setSel] = useState(todayISO())
  const iso = sel
  const isToday = sel === todayISO()

  const today = new Date()
  const selDate = new Date(sel + 'T12:00:00')
  const routine = effectiveRoutine(S, iso)
  const todayOvr = S.dayPlan[iso] !== undefined
  const dayW = (S.workouts || []).find(x => x.d === iso)
  // The weight as that day could have known it: its own reading, or the last one before it.
  const bw = bwAsOf(S, iso)
  const bwIdx = bw ? S.bodyweight.findIndex(b => b.d === bw.d) : -1
  const prevBW = bwIdx > 0 ? S.bodyweight[bwIdx - 1] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '') + (iso === sel ? ' sel' : '')} onClick={() => setSel(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: whenOf(b), y: b.w, d: b.d }))

  const comp = composition(bw)
  const journey = sinceStart(S)
  const proj = projectedWeight(S)
  const daySleep = sleepFor(S, iso)
  const lastNight = daySleep || (isToday ? lastSleep(S) : null)
  const todayNutri = entryFor(S, iso)
  const nutriLeft = remainingOf(todayNutri, S.nutriGoal)
  // Null unless there is both a maintenance figure and calories logged today — a balance
  // is a subtraction, and half of one is not worth a line on the card.
  const bal = todayNutri ? dayBalance(S, iso) : null
  const balance = bal && bal.deficit != null ? bal : null
  const macroSplitToday = macroSplit(todayNutri)

  // What the watch gave that day, as one line. Absent figures stay absent rather than
  // reading as zero — a day nobody measured is not a day of no movement.
  const watchLine = (() => {
    const w = (S.workouts || []).find(x => x.d === iso && x.watch)
    const h = (S.health || []).find(x => x.d === iso)
    const bits = []
    // The session's figures, wherever they ended up: on the workout when one was logged,
    // on the day itself when the training happened without one.
    const kcal = (w && w.watch.kcal) ?? (h && h.sport)
    const min = (w && w.watch.minutes) ?? (h && h.sportMin)
    if (kcal) bits.push(fmtNum(kcal) + ' kcal')
    if (min) bits.push(fmtNum(min) + ' min')
    if (h && h.kcal) bits.push(t('{0} kcal active', fmtNum(h.kcal)))
    if (h && h.steps) bits.push(fmtNum(h.steps) + ' ' + t('steps'))
    return bits.length ? bits.join(' · ') : null
  })()

  // today's session shown right under the week strip
    // Today: start what is planned. Any other day: it is history, so the row leads to what was
  // done, or to changing what was planned for a day still ahead.
  const onToday = () => {
    if (dayW) return workoutDetailSheet(dayW)
    if (!isToday) return dayOverrideSheet(iso)
    if (S.active) return nav('/workout')
    if (routine) return startFlow(routine.id)
    dayOverrideSheet(iso)
  }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : APP_NAME}</h1><div className="sub">{selDate.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
        {!isToday && <button className="tag acc" style={{ marginLeft: 8, border: 0 }} onClick={() => setSel(todayISO())}>{t('Today')}</button>}</div></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="iconbtn" onClick={digestSheet} aria-label={t('Send to your coach')}><Icon name="clipboard" /></button>
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
      </div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      <div className="today-row" onClick={onToday}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: dayW ? 'var(--acc)' : isToday && S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={dayW ? 'checkCircle' : isToday && S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{isToday ? t('Today') : fmtDate(iso, true)}</div>
            <div className="ttl">{dayW ? dayW.name
              : isToday && S.active ? t('{0} — in progress', S.active.name)
              : routine ? routine.name : t('Rest day')}{todayOvr && routine ? ' · ' + t('rescheduled') : ''}</div>
          </div>
        </div>
        {dayW ? <Icon name="chevronRight" className="chev" />
          : isToday && S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : isToday && routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>

      {/* What the watch measured today. It sits here, under the day it belongs to, because
          it is a daily gesture — buried at the bottom of an import screen in Settings it was
          a feature nobody would reach twice. */}
      <div className="today-row wrap" onClick={() => watchSheet(iso)}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: watchLine ? 'var(--red)' : 'var(--surface-3)' }}><Icon name="flame" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('My watch')}</div>
            <div className="ttl">{watchLine || t('Not logged')}</div>
          </div>
        </div>
        {watchLine ? <Icon name="chevronRight" className="chev" /> : <span className="tag acc">{t('Log')}</span>}
      </div>
    </div>

    {/* A program sent over MCP is waiting. Above everything else because it is the one
        thing on this screen the user did not put there themselves. */}
    {S.pendingProgram && (
      <div className="card" style={{ borderColor: 'var(--acc)' }}>
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i" style={{ background: 'var(--acc)' }}><Icon name="sparkles" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('A program is waiting')}</div>
            <div className="ttl">{S.pendingProgram.program?.name || t('Untitled program')}</div>
          </div>
        </div>
        <Button variant="primary" icon="download" onClick={openPendingProgram}>{t('Review it')}</Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" className="dim" onClick={discardPendingProgram}>{t('Discard')}</Button>
      </div>
    )}

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet({ iso })}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {/* only when it actually moved — an unchanged weight used to read as "− 0" */}
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {/* What the weight is made of, when the scale said so. Lean mass is the number a
            cut is judged on — the weight curve alone cannot tell muscle from fat. */}
        {comp && (
          <div className="small row" style={{ color: 'var(--label-2)', marginTop: 4, gap: 5 }}>
            <Icon name="figureStrength" style={{ fontSize: 13 }} />
            <span>{fmtNum(comp.bf)} % · {t('{0} fat · {1} lean', fmtNum(comp.fat) + ' ' + S.unit, fmtNum(comp.lean) + ' ' + S.unit)}</span>
          </div>
        )}
        {/* The whole journey, which is the number nobody sees day to day: six kilos across
            five months reads as nothing at all when it arrives 0.2 at a time. */}
        {journey && (
          <div className="small row" style={{ color: bwDeltaColor(journey.kg, bw.w), marginTop: 4, gap: 5 }}>
            <Icon name={journey.kg > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 13 }} />
            <span>{t('{0} since {1}', (journey.kg > 0 ? '+' : '−') + fmtNum(Math.abs(journey.kg)) + ' ' + S.unit, fmtDate(journey.from.d, true))}</span>
          </div>
        )}
        {/* Where the deficit says you are now, counted forward from the last real weigh-in
            and never from an older one — 7 700 kcal a kilo errs one way, so every day it runs
            unanchored adds error in the same direction. Shown only once it has days to speak
            from, and captioned as a tendency, because the scale answers to glycogen water and
            salt long before it answers to fat. */}
        {proj && proj.days >= 2 && Math.abs(proj.change) >= 0.05 && (
          <div className="small row" style={{ color: 'var(--label-2)', marginTop: 4, gap: 5, cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); projectionSheet() }}>
            <Icon name="bolt" style={{ fontSize: 13 }} />
            <span>
              {t('≈ {0} today, on the {1} days logged since', fmtNum(proj.kg) + ' ' + S.unit, proj.days)}
              {proj.gaps > 0 && ' · ' + t('{0} days unlogged, so it reads high', proj.gaps)}
            </span>
            <Icon name="chevronRight" style={{ fontSize: 11, opacity: .5 }} />
          </div>
        )}
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
      </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}

      {/* Sleep lives on this card rather than its own: it is the other thing your body did
          overnight, and a card holding a single number would push everything else down. */}
      <div className="today-row" style={{ marginTop: 12 }} onClick={() => sleepSheet(iso)}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: daySleep ? 'var(--indigo)' : 'var(--surface-3)' }}><Icon name="moon" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Last night')}</div>
            <div className="ttl">{lastNight
              ? fmtNum(sleepHours(lastNight)) + ' h' + (lastNight.q ? ' · ' + lastNight.q + '/5' : '') + (daySleep ? '' : ' · ' + fmtDate(lastNight.d, true))
              : t('Not logged')}</div>
          </div>
        </div>
        {daySleep ? <Icon name="chevronRight" className="chev" /> : <span className="tag acc">{t('Log')}</span>}
      </div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Nutrition')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.nutriGoal ? { color: 'var(--yellow)' } : undefined} onClick={nutriGoalSheet}>
            {S.nutriGoal?.kcal ? fmtNum(S.nutriGoal.kcal) : t('Goal')}
          </Button>
          <Button size="sm" icon="plus" onClick={() => nutriSheet(iso)}>{t('Log')}</Button>
        </div>
      </div>
      {todayNutri ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(todayNutri.kcal || kcalFromMacros(todayNutri))} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
          {/* The actionable half of the card: what is left decides tonight's meal, so it
              sits next to the total rather than under the chart. Over target is orange
              and stated as such — never a negative number the reader has to decode. */}
          {nutriLeft && <span className="small" style={{ marginLeft: 'auto', fontWeight: 500, color: nutriLeft.kcal < 0 ? 'var(--orange)' : 'var(--acc)' }}>
            {nutriLeft.kcal < 0 ? t('{0} over', fmtNum(-nutriLeft.kcal)) : t('{0} left', fmtNum(nutriLeft.kcal))}
          </span>}
        </div>
        {macroSplitToday && <>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-3)', marginTop: 10 }}>
            {MACROS.map(m => <div key={m} style={{ flex: macroSplitToday[m], background: MACRO_COLOR[m] }} />)}
          </div>
          <div className="row small" style={{ gap: 12, marginTop: 7, flexWrap: 'wrap' }}>
            {MACROS.map(m => <span key={m} className="row" style={{ gap: 5 }}>
              <i style={{ width: 8, height: 8, borderRadius: 2, background: MACRO_COLOR[m], display: 'inline-block' }} />
              <span className="muted">{t(MACRO_NAME[m])}</span>
              <b>{fmtNum(todayNutri[m] || 0)} g</b>
            </span>)}
          </div>
        </>}
      </> : <div className="muted small">{t('Nothing logged today — add your calories to keep the picture complete.')}</div>}

      {/* The day's balance: (maintenance + training) − intake. It sits under the intake
          rather than in its own card because it is the same question — what today came to —
          and splitting it in two would make you scroll to answer half of it. */}
      {balance ? <div className="row between" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--sep)', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{balance.deficit >= 0 ? t('Deficit today') : t('Surplus today')}</div>
          <div className="dim small" style={{ marginTop: 2 }}>
            {t('{0} maintenance {1} sport vs plan − {2} eaten',
              fmtNum(balance.tdee),
              (balance.delta > 0 ? '+' : '') + fmtNum(balance.delta),
              fmtNum(balance.intake))}
            {/* Spelled out rather than folded into the maintenance figure: a day charged more
                than the number in the settings has to say why, or the arithmetic stops
                adding up on screen. */}
            {balance.bonus !== 0 && ' · ' + (balance.bonusFrom === 'steps'
              ? t('{0} for {1} steps', (balance.bonus > 0 ? '+' : '−') + fmtNum(Math.abs(balance.bonus)), fmtNum(balance.steps))
              : t('{0} of everyday movement vs the usual', (balance.bonus > 0 ? '+' : '−') + fmtNum(Math.abs(balance.bonus))))}
          </div>
        </div>
        <div className="stat-v" style={{ color: balance.deficit >= 0 ? 'var(--acc)' : 'var(--orange)', flexShrink: 0 }}>
          {fmtNum(Math.abs(balance.deficit))} <span className="muted" style={{ fontSize: '.9rem' }}>kcal</span>
        </div>
      </div> : S.tdee || !todayNutri ? null : <div style={{ marginTop: 10 }}>
        <Button size="sm" icon="flame" onClick={tdeeSheet}>{t('Set your maintenance')}</Button>
      </div>}
    </div>

    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => calendarSheet()}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}>
            <Icon name="flame" style={{ color: 'var(--orange)' }} />
            {streakWeeks(S) === 1 ? t('{0} week streak (one)', 1) : t('{0} week streak', streakWeeks(S))}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>
  </div>
}
