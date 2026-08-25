import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor, nutriSheet, nutriGoalSheet, digestSheet, openPendingProgram, discardPendingProgram, sleepSheet, tdeeSheet } from '../sheets.jsx'
import { entryFor, kcalFromMacros, macroSplit, remainingOf, MACROS, MACRO_NAME, MACRO_COLOR } from '../lib/nutrition.js'
import { composition, todaySleep, lastSleep, sleepHours } from '../lib/body.js'
import { dayBalance } from '../lib/energy.js'
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

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  const comp = composition(bw)
  const sleptToday = todaySleep(S)
  const lastNight = sleptToday || lastSleep(S)
  const todayNutri = entryFor(S, todayISO())
  const nutriLeft = remainingOf(todayNutri, S.nutriGoal)
  // Null unless there is both a maintenance figure and calories logged today — a balance
  // is a subtraction, and half of one is not worth a line on the card.
  const bal = todayNutri ? dayBalance(S, todayISO()) : null
  const balance = bal && bal.deficit != null ? bal : null
  const macroSplitToday = macroSplit(todayNutri)

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else dayOverrideSheet(todayISO()) }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : APP_NAME}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
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
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name) : routine ? routine.name : t('Rest day')}{todayOvr && routine ? ' · ' + t('rescheduled') : ''}</div>
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
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
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
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
      <div className="today-row" style={{ marginTop: 12 }} onClick={sleepSheet}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: sleptToday ? 'var(--indigo)' : 'var(--surface-3)' }}><Icon name="moon" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Last night')}</div>
            <div className="ttl">{lastNight
              ? fmtNum(sleepHours(lastNight)) + ' h' + (lastNight.q ? ' · ' + lastNight.q + '/5' : '') + (sleptToday ? '' : ' · ' + fmtDate(lastNight.d, true))
              : t('Not logged')}</div>
          </div>
        </div>
        {sleptToday ? <Icon name="chevronRight" className="chev" /> : <span className="tag acc">{t('Log')}</span>}
      </div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Nutrition')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.nutriGoal ? { color: 'var(--yellow)' } : undefined} onClick={nutriGoalSheet}>
            {S.nutriGoal?.kcal ? fmtNum(S.nutriGoal.kcal) : t('Goal')}
          </Button>
          <Button size="sm" icon="plus" onClick={nutriSheet}>{t('Log')}</Button>
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
            {t('{0} week streak', streakWeeks(S))}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>
  </div>
}
