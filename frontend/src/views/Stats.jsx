import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXIDX, exName } from '../lib/exercises.js'
import { lastBW, streakWeeks, setLabel, modeOf, effortOf } from '../lib/history.js'
import { fmtNum, fmtDate, fmtVol, todayISO, weekKey, fmtNum2 } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { bwSheet, goalSheet, calendarSheet, workoutDetailSheet, WorkoutRow, bwDeltaColor, nutriSheet, nutriGoalSheet, sleepSheet, tdeeSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'
import Icon from '../components/Icon.jsx'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import { loadOfWorkouts, rankOf, MUSCLE_NAME, MUSCLES } from '../lib/muscles.js'
import { recoveryNow, bandOf, BAND_NAME } from '../lib/recovery.js'
import { e1rmSeries, best1RM } from '../lib/onerm.js'
import {
  hasEffort, displayScale, scaleName, toScale, avgRir, effortSummary, effortWeeks,
  effortHistogram, isHardSet, HARD_RIR
} from '../lib/effort.js'
import { avgOver, seriesOf, MACROS, MACRO_NAME, MACRO_COLOR } from '../lib/nutrition.js'
import { bodyFatSeries, compositionTrend, sleepSeries, sleepAverage, sleepDebt, lastComposition, whenOf } from '../lib/body.js'
import { deficitTotals, deficitSeries, impliedTDEE, predictedVsActual, projectedWeight, cutRate, tdeeParts, KCAL_PER_KG_FAT, LOSS_CEILING_PCT } from '../lib/energy.js'
import { Button, Segmented, SelectRow } from '../components/ui.jsx'

// Which muscles the training in a window actually hit — and, the point of the card,
// which ones it keeps missing. Shading is relative within the window (lib/muscles.js).
function MuscleBalance({ S }) {
  const [win, setWin] = useState(7)
  const [hard, setHard] = useState(false)
  const [sel, setSel] = useState(null)
  const now = Date.now()
  const inWin = S.workouts.filter(w =>
    win === 0 ? true
      : win === 7 ? weekKey(w.d) === weekKey(todayISO())
        : whenOf(w) > now - win * 86400000)
  // Counting only the sets taken near failure turns the map from "where did the volume go"
  // into "where did the stimulus go" — a muscle can lead on sets and still never be trained
  // hard. Offered only when the window holds ratings at all, since with none the hard map
  // would just be empty and read as "you trained nothing".
  const rated = inWin.some(w => w.entries.some(e => e.sets.some(s => s.done && isHardSet(s))))
  const on = hard && rated
  const load = loadOfWorkouts(inWin, on ? isHardSet : null)
  const { worked, missed } = rankOf(load)
  const top = worked.slice(0, 4)
  const max = worked.length ? load[worked[0]] : 0
  const sets = m => Math.round((load[m] || 0) * 10) / 10

  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Muscle balance')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {on ? t('by hard sets') : t('by sets worked')}</span></h2>
      {rated && <Button size="sm" icon="flame" style={on ? { color: 'var(--yellow)' } : undefined}
        onClick={() => { setHard(h => !h); setSel(null) }}>{on ? t('Hard') : t('All')}</Button>}
    </div>
    <Segmented className="seg-range" value={win} onChange={v => { setWin(v); setSel(null) }}
      options={[{ value: 7, label: t('Week') }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') }]} />
    {inWin.length ? <>
      <BodyMap className="tappable" load={load} body={S.body} selected={sel}
        onMuscle={m => setSel(s => (s === m ? null : m))} />
      <BodyMapLegend />
      {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
        <span className="v">{sets(sel) ? t('{0} sets', sets(sel)) : on ? t('no hard sets') : t('not trained')}</span>
      </div>}
      {!sel && top.map(m => <div key={m} className="mrow">
        <span className="nm">{t(MUSCLE_NAME[m])}</span>
        <span className="bar"><i style={{ width: Math.round(load[m] / max * 100) + '%', background: on ? 'var(--yellow)' : undefined }} /></span>
        <span className="v">{t('{0} sets', sets(m))}</span>
      </div>)}
      {missed.length > 0 && <>
        <h4 className="sec" style={{ marginTop: 12 }}>{on ? t('No hard sets in this period') : t('Not trained in this period')}</h4>
        <div className="mchips">{missed.map(m => <span key={m} className="mchip miss">{t(MUSCLE_NAME[m])}</span>)}</div>
      </>}
      {!missed.length && worked.length > 0 &&
        <div className="muted small" style={{ marginTop: 10 }}>{on
          ? t('Every muscle group got at least one hard set in this period.')
          : t('Every muscle group got some work in this period.')}</div>}
    </> : <div className="muted small">{t('No workouts in this period yet.')}</div>}
  </div>
}

// How hard the training was — the half of the picture a volume chart cannot show. Everything
// is computed in RIR (lib/effort.js) and converted to whichever scale this profile reads.
// Every number carries how much of the training it speaks for: rating is optional and off by
// default, so a partly rated history is the normal case, and an average without its
// denominator would quietly speak for sets that were never rated.
function EffortCard({ S }) {
  const [win, setWin] = useState(90)
  const kind = displayScale(S)
  const hd = scaleName(kind)
  const sum = effortSummary(S, win)
  const weeks = effortWeeks(S, win)
  const hist = effortHistogram(S, win)
  const maxBin = Math.max(1, ...hist.map(b => b.n))
  // The week's set count rides along in the tooltip, because the pair is the reading:
  // volume up with effort up is fatigue piling up, volume up with effort flat is adaptation.
  const pts = weeks.map(w => ({ t: w.t, y: toScale(kind, w.rir), note: t('{0} sets', w.sets) }))
  // Bins run hardest-first in both scales: RIR 0 and RPE 10 are the same set.
  const binLabel = b => kind === 'rpe' ? (b.tail ? '≤ 6' : String(10 - b.rir)) : (b.tail ? b.rir + '+' : String(b.rir))

  return <div className="card">
    <h2>{t('Effort')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('how close to failure')}</span></h2>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
    {sum.rated === 0 ? <div className="muted small">{t('No rated sets in this period.')}</div> : <>
      <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div className="stat-v">{sum.avg == null ? '—' : fmtNum(toScale(kind, sum.avg)) + ' ' + hd}</div>
          <div className="small dim">{t('average effort')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-v" style={{ color: 'var(--yellow)' }}>{sum.hardPct == null ? '—' : Math.round(sum.hardPct * 100) + '%'}</div>
          <div className="small dim">{t('at {0} {1} or harder', hd, fmtNum(toScale(kind, HARD_RIR)))}</div>
        </div>
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>{t('{0} of {1} finished sets rated', sum.rated, sum.done)}</div>
      {effortOf(S) === 'none' && <div className="small" style={{ color: 'var(--yellow)', marginTop: 4 }}>
        {t('Effort per set is switched off — turn it on in Settings to keep rating.')}
      </div>}
      {pts.length > 1 && <>
        <h4 className="sec" style={{ marginTop: 12 }}>{t('Week by week')}</h4>
        <div className="chart"><LineChart points={pts} h={140} unit={hd} color="var(--yellow)" invert={kind === 'rir'} /></div>
      </>}
      <h4 className="sec" style={{ marginTop: 12 }}>{t('Where the sets land')}</h4>
      {hist.map(b => <div key={b.rir} className="mrow">
        <span className="nm">{hd} {binLabel(b)}</span>
        <span className="bar"><i style={{ width: Math.round(b.n / maxBin * 100) + '%', background: b.rir <= HARD_RIR ? 'var(--yellow)' : 'var(--label-3)' }} /></span>
        <span className="v">{b.n ? b.n + ' · ' + Math.round(b.pct * 100) + '%' : '—'}</span>
      </div>)}
      <div className="small dim" style={{ marginTop: 8 }}>
        {t('Most working sets belong close to failure without living there — half at the floor and half at the top average out to a healthy-looking middle.')}
      </div>
    </>}
  </div>
}

// What was eaten over a window. Every average carries the number of days behind it, for the
// same reason the effort card does: intake is logged by hand and a missed day is a gap, not a
// fast. An average that quietly divided by the length of the window would report a steady
// 2 400 kcal week as 1 700 because two days were never filled in — and read as a deficit that
// was never eaten.
function NutritionCard({ S }) {
  const [win, setWin] = useState(30)
  const avg = avgOver(S, win)
  const pts = seriesOf(S, win)
  const goal = S.nutriGoal

  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Nutrition')}</h2>
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" icon="target" style={goal ? { color: 'var(--yellow)' } : undefined} onClick={nutriGoalSheet}>
          {goal?.kcal ? fmtNum(goal.kcal) : t('Goal')}
        </Button>
        <Button size="sm" icon="plus" onClick={nutriSheet}>{t('Log')}</Button>
      </div>
    </div>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') }]} />
    {!avg.logged ? <div className="muted small">{t('Nothing logged in this period.')}</div> : <>
      <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div className="stat-v">{avg.kcal == null ? '—' : fmtNum(avg.kcal) + ' kcal'}</div>
          <div className="small dim">{t('average per logged day')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-v" style={{ color: 'var(--blue)' }}>{avg.kcalDays}</div>
          <div className="small dim">{t(avg.kcalDays === 1 ? '{0} day logged' : '{0} days logged', avg.kcalDays)}</div>
        </div>
      </div>
      <div className="row small" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {MACROS.map(m => avg[m] != null && <span key={m} className="row" style={{ gap: 5 }}>
          <i style={{ width: 8, height: 8, borderRadius: 2, background: MACRO_COLOR[m], display: 'inline-block' }} />
          <span className="muted">{t(MACRO_NAME[m])}</span>
          <b>{fmtNum(avg[m])} g</b>
          {/* Macros are optional on top of calories, so their coverage can differ from the
              kcal one — spelled out only when it actually does. */}
          {avg[m + 'Days'] !== avg.kcalDays && <span className="dim">({avg[m + 'Days']})</span>}
        </span>)}
      </div>
      {pts.length > 1 && <div className="chart" style={{ marginTop: 10 }}>
        <LineChart points={pts} h={150} unit="kcal" color="var(--orange)" goal={goal?.kcal || null} />
      </div>}
    </>}
  </div>
}

// What the cut has actually come to. Three numbers, and they add up on purpose: the deficit
// eating created, the deficit training created, and the two together — all over the same set
// of days, because a combined figure drawn from a wider day set than its parts is not a sum
// of anything. See lib/energy.js for the model and for why the day set is the logged one.
/* The bands a cut runs in, and the colour each one deserves. Green is not "good", it is
   "this is the rate that keeps the muscle" — which is why both ends of the scale are warm. */
const BAND_LABEL = {
  slow: 'Slower than a cut needs to be',
  gentle: 'Gentle — it will work, it will take a while',
  optimal: 'The rate that keeps the most muscle',
  high: 'Fast, and still defensible',
  steep: 'Steeper than the evidence supports',
  excessive: 'Too fast — this is muscle as well as fat'
}
const BAND_COLOR = {
  slow: 'var(--yellow)', gentle: 'var(--teal)', optimal: 'var(--acc)',
  high: 'var(--acc)', steep: 'var(--orange)', excessive: 'var(--red)'
}

function EnergyCard({ S }) {
  const [win, setWin] = useState(0)
  const tot = deficitTotals(S, S.tdee, win)
  const pts = deficitSeries(S, S.tdee, win)
  const cmp = predictedVsActual(S, S.tdee, win)
  const implied = impliedTDEE(S, win)
  const tdee = tdeeParts(S.tdee)
  const rate = cutRate(S, S.tdee, win)
  const proj = projectedWeight(S, S.tdee)

  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Energy')}</h2>
      <Button size="sm" icon="flame" style={tdee ? { color: 'var(--yellow)' } : undefined} onClick={tdeeSheet}>
        {tdee ? fmtNum(tdee.total) : t('Maintenance')}
      </Button>
    </div>

    {!tdee
      ? <div className="muted small" style={{ lineHeight: 1.45 }}>
        {t('Set your daily expenditure — BMR, NEAT, and the training it already budgets for — and every day here gets a balance.')}
      </div>
      : <>
        <Segmented className="seg-range" value={win} onChange={setWin}
          options={[{ value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1y' }, { value: 0, label: t('All') }]} />
        {!tot ? <div className="muted small">{t('Nothing logged in this period.')}</div> : <>
          <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="stat-v" style={{ color: tot.total >= 0 ? 'var(--acc)' : 'var(--orange)' }}>
                {fmtNum(Math.abs(tot.total))} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span>
              </div>
              <div className="small dim">{tot.total >= 0 ? t('total deficit') : t('total surplus')}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="stat-v">{fmtNum(Math.abs(tot.kg))} <span className="muted" style={{ fontSize: '1rem' }}>kg</span></div>
              <div className="small dim">{t('of fat, at {0} kcal', fmtNum(KCAL_PER_KG_FAT))}</div>
            </div>
          </div>

          {/* The split. Two bars rather than a pie: the question is which of the two is
              doing the work, and a length answers it at a glance. Drawn against the larger
              of the two rather than against the total, so a component that worked *against*
              the deficit still has a bar and still reads as a size. */}
          <div style={{ marginTop: 12 }}>
            {[['nutrition', t('Eating'), 'var(--orange)'], ['sportDelta', t('Sport vs plan'), 'var(--blue)'],
              ...(tot.bonus !== 0 ? [['bonus', t('Walking vs the usual'), 'var(--teal)']] : [])].map(([k, label, col]) => {
              const v = tot[k]
              const peak = Math.max(Math.abs(tot.nutrition), Math.abs(tot.sportDelta), Math.abs(tot.bonus)) || 1
              return <div key={k} style={{ marginBottom: 8 }}>
                <div className="row between small" style={{ marginBottom: 4 }}>
                  <span className="muted">{label}</span>
                  <b style={v < 0 ? { color: 'var(--orange)' } : undefined}>{fmtNum(v)} kcal</b>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: ((Math.abs(v) / peak) * 100) + '%', height: '100%', background: v < 0 ? 'var(--red)' : col }} />
                </div>
              </div>
            })}
          </div>
          {/* The training a maintenance figure budgets for lives inside the eating number,
              because that is what budgeting for it means. Spelled out, or the sport row
              reads as "training did nothing" on a cut built entirely on training. */}
          {tot.sportPlanned > 0 && <div className="dim small" style={{ lineHeight: 1.45 }}>
            {t('{0} kcal of training measured across {1} days, against {2} your maintenance counts for them.',
              fmtNum(tot.sportLogged), tot.plannedDays, fmtNum(tot.sportPlanned))}
          </div>}
          {/* Days that say nothing about training are left out of the training figure rather
              than counted as rest. Said out loud, because a total that quietly ignores half
              its window is worse than one that explains why. */}
          {tot.untracked > 0 && <div className="dim small" style={{ lineHeight: 1.45 }}>
            {t('{0} days recorded no training either way — neither a session nor a rest day — so they count for eating only.', tot.untracked)}
          </div>}
          {/* The third bar earns a sentence: it is the one term people do not expect, and a
              figure charged above the entered maintenance has to say where it came from. */}
          {tot.bonus !== 0 && <div className="dim small" style={{ lineHeight: 1.45 }}>
            {t('{0} days had a step count, and are charged what that count really cost — more on a long day, less on a quiet one. A day with no count is charged your figure exactly.', tot.bonusDays)}
          </div>}
          {/* Days where the import's own movement figure, not the usual baseline, is what came
              off a whole-day burn. Named, because a training figure derived from a different
              subtraction on some of its days has to say so to be checkable. */}
          {tot.neatDays > 0 && <div className="dim small" style={{ lineHeight: 1.45 }}>
            {t('{0} days had their own everyday-movement figure taken off the watch’s day total, rather than the usual baseline.', tot.neatDays)}
          </div>}
          {tot.nutrition < 0 && <div className="small" style={{ color: 'var(--orange)', lineHeight: 1.45 }}>
            {t('Eating sat above maintenance across this period — every gram lost came from training.')}
          </div>}

          <div className="small dim" style={{ marginTop: 2, lineHeight: 1.45 }}>
            {t('over {0} logged days of {1}, {2} to {3}', tot.days, tot.span, fmtDate(tot.from, true), fmtDate(tot.to, true))}
            {tot.unmeasured > 0 && ' · ' + t('{0} of them trained with nothing to measure the session, so their deficit is understated', tot.unmeasured)}
          </div>

          {pts.length > 1 && <div className="chart" style={{ marginTop: 10 }}>
            <LineChart points={pts} h={150} unit="kcal" color="var(--acc)" goal={0} />
          </div>}

          {/* How fast this is actually running. A deficit total says how much; only a rate
              against a body says whether that much is the right much. */}
          {rate && <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--sep)' }}>
            <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
              <div>
                <div className="stat-v" style={{ color: BAND_COLOR[rate.band] }}>
                  {fmtNum(Math.abs(rate.kgPerWeek))} <span className="muted" style={{ fontSize: '1rem' }}>kg / {t('week')}</span>
                </div>
                <div className="small dim" style={{ marginTop: 2 }}>{t(BAND_LABEL[rate.band])}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="stat-v" style={{ fontSize: '1.15rem' }}>{fmtNum(rate.perDay)}</div>
                <div className="small dim">{t('kcal a day')}</div>
              </div>
            </div>
            {rate.ceilingKg != null && <div className={'small' + (rate.overCeiling ? '' : ' dim')}
              style={{ marginTop: 6, lineHeight: 1.45, color: rate.overCeiling ? 'var(--orange)' : undefined }}>
              {rate.overCeiling
                ? t('Above {0} kg a week at {1} kg — past that the muscle a cut costs stops being paid back by the fat it takes off.', fmtNum2(rate.ceilingKg), fmtNum(rate.bodyKg))
                : t('Under the {0} kg a week that {1} kg can afford.', fmtNum2(rate.ceilingKg), fmtNum(rate.bodyKg))}
            </div>}
          </div>}

          {/* The one reading here that can tell you the maintenance figure is wrong. */}
          {cmp && <>
            <h4 className="sec">{t('Predicted against the scale')}</h4>
            <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
              <div><div className="stat-v" style={{ fontSize: 20 }}>{fmtNum(cmp.predicted)} kg</div>
                <div className="small dim">{t('predicted')}</div></div>
              <div><div className="stat-v" style={{ fontSize: 20 }}>{fmtNum(cmp.actual)} kg</div>
                <div className="small dim">{t('measured')}</div></div>
            </div>
            <div className="small" style={{ marginTop: 8, lineHeight: 1.45, color: Math.abs(cmp.gap) > 2 ? 'var(--orange)' : 'var(--label-2)' }}>
              {Math.abs(cmp.gap) <= 2
                ? t('Close enough — 7 700 kcal per kilo assumes an expenditure that does not fall as you get lighter, so a gap of a kilo or two is the model, not the log.')
                : cmp.gap > 0
                  ? t('The scale is {0} kg behind the deficit. Either the intake is under-reported or your maintenance is set too high.', fmtNum(cmp.gap))
                  : t('The scale is {0} kg ahead of the deficit. Either your maintenance is set too low or something is unlogged.', fmtNum(-cmp.gap))}
            </div>
          </>}

          {implied.tdee != null && tdee && implied.tdee !== tdee.total && <div className="small" style={{ marginTop: 10 }}>
            <span className="muted">{t('Your weight curve puts maintenance at')} </span>
            <b>{fmtNum(implied.tdee)} kcal</b>
            <Button size="sm" icon="bolt" style={{ marginLeft: 8 }} onClick={tdeeSheet}>{t('Adjust')}</Button>
          </div>}
        </>}
      </>}
  </div>
}

// How much sleep there was, and how short of the target it fell. The nights it speaks for
// travel with the average for the same reason the intake ones do: a night nobody logged is a
// gap, and dividing by the length of the window would report a solid week as insomnia.
function SleepCard({ S }) {
  const [win, setWin] = useState(30)
  const avg = sleepAverage(S, win)
  const debt = sleepDebt(S, win, S.sleepGoal)
  const pts = sleepSeries(S, win)

  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Sleep')}</h2>
      <Button size="sm" icon="plus" onClick={sleepSheet}>{t('Log')}</Button>
    </div>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') }]} />
    {!avg.nights ? <div className="muted small">{t('Nothing logged in this period.')}</div> : <>
      <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div className="stat-v">{fmtNum(avg.hours)} h</div>
          <div className="small dim">{t('average per logged night')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-v" style={{ color: 'var(--indigo)' }}>{avg.nights}</div>
          <div className="small dim">{t(avg.nights === 1 ? '{0} night logged' : '{0} nights logged', avg.nights)}</div>
        </div>
      </div>
      {debt && <div className="small" style={{ marginTop: 8, color: debt.hours > 0 ? 'var(--orange)' : 'var(--acc)' }}>
        {debt.hours > 0 ? t('{0} h short of target across those nights', fmtNum(debt.hours))
          : t('{0} h over target across those nights', fmtNum(-debt.hours))}
      </div>}
      {avg.quality != null && <div className="small dim" style={{ marginTop: 4 }}>
        {t('felt {0}/5 over {1} rated nights', fmtNum(avg.quality), avg.ratedNights)}
      </div>}
      {pts.length > 1 && <div className="chart" style={{ marginTop: 10 }}>
        <LineChart points={pts} h={150} unit="h" color="var(--indigo)" goal={S.sleepGoal || null} />
      </div>}
    </>}
  </div>
}

// Estimated recovery per muscle. An estimate, and the card says so — nothing here measures
// recovery. See lib/recovery.js for the model and the evidence each constant came from.
function RecoveryCard({ S }) {
  const [sel, setSel] = useState(null)
  const { muscles, basis } = recoveryNow(S)
  const worked = MUSCLES.filter(m => muscles[m])
  // Levels run 1 (ready) to 4 (just trained), so the muscle needing attention is the loud one.
  const levels = {}
  worked.forEach(m => {
    const b = bandOf(muscles[m].pct)
    levels[m] = b === 'ready' ? 1 : b === 'nearly' ? 2 : b === 'working' ? 3 : 4
  })
  const fmtLeft = h => h <= 0 ? t('ready') : h < 24 ? t('{0} h', h) : t('{0} d', Math.round(h / 24 * 10) / 10)
  const sorted = [...worked].sort((a, b) => muscles[a].pct - muscles[b].pct)
  const detail = sel && muscles[sel] ? { slug: sel, ...muscles[sel] } : null

  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Recovery')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('estimated')}</span></h2>
    </div>
    {!worked.length ? <div className="muted small">{t('Nothing trained recently — there is no fatigue to estimate.')}</div> : <>
      <BodyMap className="tappable" levels={levels} palette="recovery" body={S.body} selected={sel}
        onMuscle={m => setSel(x => (x === m ? null : m))} />
      <div className="hm-legend">
        {t('Just trained')} <div className="hm-c" style={{ background: 'var(--red)' }} />
        <div className="hm-c" style={{ background: 'var(--orange)' }} />
        <div className="hm-c" style={{ background: 'var(--yellow)' }} />
        <div className="hm-c" style={{ background: 'var(--acc)' }} /> {t('Ready')}
      </div>

      {detail ? <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[detail.slug])}</b></span>
        <span className="v">{detail.pct} % · {t('{0} sets', detail.sets)} · {fmtLeft(detail.hoursLeft)}</span>
      </div> : sorted.slice(0, 5).map(m => <div key={m} className="mrow">
        <span className="nm">{t(MUSCLE_NAME[m])}</span>
        <span className="bar"><i style={{ width: muscles[m].pct + '%', background: `var(--${bandOf(muscles[m].pct) === 'ready' ? 'acc' : bandOf(muscles[m].pct) === 'nearly' ? 'yellow' : bandOf(muscles[m].pct) === 'working' ? 'orange' : 'red'})` }} /></span>
        <span className="v">{muscles[m].pct} % · {fmtLeft(muscles[m].hoursLeft)}</span>
      </div>)}

      {/* What the number rests on. A recovery figure with no stated basis is the kind you
          believe for six weeks before realising it was invented. */}
      <div className="small dim" style={{ marginTop: 12, lineHeight: 1.5 }}>
        {t('An estimate from your logged sets, not a measurement.')}{' '}
        {basis.ratedSets < basis.totalSets && t('{0} of {1} sets were rated for effort; the rest were assumed to be normal working sets.', basis.ratedSets, basis.totalSets) + ' '}
        {basis.sleepFactor > 1.02 && t('Short sleep is slowing it by about {0} %.', Math.round((basis.sleepFactor - 1) * 100)) + ' '}
        {basis.energyFactor > 1.02 && t('Eating under target is slowing it by about {0} %.', Math.round((basis.energyFactor - 1) * 100)) + ' '}
        {!basis.known && t('No sleep or intake logged, so neither is being counted.')}
      </div>
    </>}
  </div>
}

// Stats = the analytics hub: all charts, progress and history live here.
export default function Stats() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [range, setRange] = useState(90)
  const [bodyMetric, setBodyMetric] = useState('w')
  const [exId, setExId] = useState(null)
  const [exMetric, setExMetric] = useState('top')
  const now = Date.now()
  const anyEffort = hasEffort(S)
  const kind = displayScale(S)
  const hd = scaleName(kind)

  const bwPts = S.bodyweight.filter(b => range === 0 || whenOf(b) > now - range * 86400000)
    .map(b => ({ t: whenOf(b), y: b.w, d: b.d }))
  const bfPts = bodyFatSeries(S, range, now)
  const leanPts = bfPts.map(p => {
    const b = S.bodyweight.find(x => x.d === p.d)
    return { t: p.t, d: p.d, y: Math.round((b.w - b.w * p.y / 100) * 10) / 10 }
  })
  const hasBf = !!lastComposition(S)
  const compTrend = compositionTrend(S, range, now)
  const bw30 = S.bodyweight.filter(b => whenOf(b) > now - 30 * 86400000)
  const bwDelta30 = bw30.length > 1 ? bw30[bw30.length - 1].w - bw30[0].w : null
  const monthW = S.workouts.filter(w => w.d.slice(0, 7) === todayISO().slice(0, 7)).length

  const exHist = [...new Set(S.workouts.flatMap(w => w.entries.map(e => e.id)))].filter(id => EXIDX[id]).sort((a, b) => exName(EXIDX[a]) < exName(EXIDX[b]) ? -1 : 1)
  const curEx = exId && exHist.includes(exId) ? exId : exHist[0] || null
  // How this exercise was logged most recently decides what the curve means: top weight,
  // longest hold or top speed. Sets logged in another mode lack the field and score 0, so a
  // switched exercise drops its old points instead of mixing seconds into a weight chart.
  const curMode = curEx ? (() => {
    for (let i = S.workouts.length - 1; i >= 0; i--) {
      const en = S.workouts[i].entries.find(e => e.id === curEx)
      if (en) return modeOf({ ...(en.target || {}), id: curEx })
    }
    return modeOf({ id: curEx })
  })() : 'reps'
  const curCardio = curMode === 'cardio'
  const curTimed = curMode === 'time'
  const metric = s => curCardio ? (s.speed || 0) : curTimed ? (s.sec || 0) : (s.w || 0)
  const exUnit = curCardio ? 'km/h' : curTimed ? 's' : S.unit
  let exPts = [], exList = [], exBest = 0
  if (curEx) {
    S.workouts.forEach(w => {
      const en = w.entries.find(e => e.id === curEx)
      if (en) { const mx = Math.max(0, ...en.sets.filter(s => s.done).map(metric), curCardio || curTimed ? 0 : (en.topW || 0)); if (mx > 0) { exPts.push({ t: whenOf(w), y: mx, d: w.d, sets: en.sets.filter(s => s.done), target: en.target }); if (mx > exBest) exBest = mx } }
    })
    exList = exPts.slice(-5).reverse()
  }
  // Estimated 1RM (issue #18) — only reps-mode training produces one, so cardio and timed
  // work simply have no points and the toggle stays hidden.
  const e1Pts = curEx ? e1rmSeries(S, curEx) : []
  const e1Best = curEx ? best1RM(S, curEx) : null
  const showE1 = e1Pts.length > 0
  // Effort on this exercise, per session. It rides on the top-set curve as well as having a
  // curve of its own, because the two only mean something together: the same weight moved
  // with more left in the tank is progress a weight-only chart draws as a flat line.
  const exRir = exPts.map(p => avgRir(p.sets))
  const showEff = exRir.filter(v => v != null).length >= 3
  const effPts = exPts.map((p, i) => (exRir[i] == null ? null : { t: p.t, y: toScale(kind, exRir[i]), d: p.d })).filter(Boolean)
  const onE1 = showE1 && exMetric === 'e1rm'
  const onEff = showEff && exMetric === 'effort'
  const topPts = exPts.map((p, i) => ({
    t: p.t, y: p.y, d: p.d,
    // 0 RIR (nothing left) is a full dot, 4+ a faint one; unrated sessions keep the plain line.
    m: exRir[i] == null ? null : 1 - Math.min(4, Math.max(0, exRir[i])) / 4,
    note: exRir[i] == null ? undefined : hd + ' ' + fmtNum(toScale(kind, exRir[i]))
  }))
  const exOpts = [{ value: 'top', label: t('Top set') }]
  if (showE1) exOpts.push({ value: 'e1rm', label: t('Est. 1RM') })
  if (showEff) exOpts.push({ value: 'effort', label: t('Effort') })

  return <>
    <div className="hdr"><div><h1>{t('Stats')}</h1><div className="sub">{t('Progress & history')}</div></div>
      <button className="iconbtn" onClick={() => nav('/history')} aria-label={t('History')}><Icon name="history" /></button></div>

    <div className="tiles">
      <div className="tile"><div className="l"><Icon name="dumbbell" />{t('Workouts')}</div><div className="v">{S.workouts.length}</div></div>
      <div className="tile"><div className="l"><Icon name="calendar" />{t('This month')}</div><div className="v">{monthW}</div></div>
      <div className="tile"><div className="l"><Icon name="flame" />{t('Week streak')}</div><div className="v">{streakWeeks(S)}</div></div>
      <div className="tile"><div className="l"><Icon name="scale" />{t('Weight 30d')}</div><div className="v" style={{ fontSize: 22, color: bwDelta30 === null ? 'inherit' : bwDeltaColor(bwDelta30, (lastBW(S) || {}).w || 0) }}>{bwDelta30 === null ? '—' : (bwDelta30 > 0 ? '+' : '') + fmtNum(bwDelta30) + ' ' + S.unit}</div></div>
    </div>

    <div className="card">
      <h2>{t('Activity — last 12 months')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('by time trained')}</span></h2>
      <Heatmap S={S} onDay={iso => { const ws = S.workouts.filter(w => w.d === iso); if (ws.length === 1) workoutDetailSheet(ws[0]); else if (ws.length) calendarSheet(iso) }} />
    </div>

    {S.workouts.length > 0 && <RecoveryCard S={S} />}
    {S.workouts.length > 0 && <MuscleBalance S={S} />}
    {anyEffort && <EffortCard S={S} />}
    <NutritionCard S={S} />
    <EnergyCard S={S} />
    <SleepCard S={S} />

    <div className="cols">
      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
            <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
          </div>
        </div>
        <Segmented className="seg-range" value={range} onChange={setRange}
          options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
        {/* Offered only once the scale has reported a percentage — a switch to an empty
            curve is a control that lies about what the app knows. */}
        {hasBf && <Segmented className="seg-range" value={bodyMetric} onChange={setBodyMetric} options={[
          { value: 'w', label: t('Weight') }, { value: 'bf', label: '% ' + t('fat') }, { value: 'lean', label: t('Lean') }
        ]} />}
        <div className="chart">
          {hasBf && bodyMetric !== 'w'
            ? <LineChart points={bodyMetric === 'bf' ? bfPts : leanPts} h={160}
                unit={bodyMetric === 'bf' ? '%' : S.unit} color="var(--teal)" />
            : <LineChart points={bwPts} h={160} unit={S.unit} goal={S.targetW} />}
        </div>
        {/* The reading a cut is actually judged on: two kilos gone means one thing if the
            lean mass held and another if it went with them. */}
        {compTrend && <div className="small dim" style={{ marginTop: 8, lineHeight: 1.5 }}>
          {t('Over these {0} readings: {1} {2} · {3} pts fat · {4} {5} lean',
            compTrend.readings,
            (compTrend.weight > 0 ? '+' : '') + fmtNum(compTrend.weight), S.unit,
            (compTrend.bf > 0 ? '+' : '') + fmtNum(compTrend.bf),
            (compTrend.lean > 0 ? '+' : '') + fmtNum(compTrend.lean), S.unit)}
        </div>}
      </div>

      <div className="card">
        <h2>{t('Exercise progress')}</h2>
        {exHist.length ? <>
          <div className="sect-b" style={{ marginBottom: 10 }}>
            <SelectRow title={t('Exercise')} sheetTitle={t('Exercise progress')} value={curEx} onChange={setExId}
              options={exHist.map(id => ({ value: id, label: exName(EXIDX[id]) }))} />
          </div>
          {exOpts.length > 1 && <Segmented className="seg-range" value={onEff ? 'effort' : onE1 ? 'e1rm' : 'top'} onChange={setExMetric} options={exOpts} />}
          <div className="chart">
            {onEff
              ? <LineChart points={effPts} h={150} unit={hd} color="var(--yellow)" invert={kind === 'rir'} />
              : <LineChart points={onE1 ? e1Pts.map(p => ({ t: p.t, y: p.y, d: p.d })) : topPts} h={150} unit={exUnit} color="var(--blue)" />}
          </div>
          <div style={{ marginTop: 8 }}>{exList.map((p, i) => <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
            <span className="muted">{fmtDate(p.d, true)}</span><span>{p.sets.map(s => setLabel(curEx, s, p.target)).join('  ')}</span></div>)}</div>
          <div className="small dim" style={{ marginTop: 8 }}>
            {onEff ? t('Average effort per workout') : onE1 ? t('Estimated 1RM per workout') : curCardio ? t('Top speed per workout') : curTimed ? t('Longest hold per workout') : t('Best set weight per workout')}
            {onEff ? '' : <> · {t('Best:')}{' '}<b className="accent">{fmtNum(onE1 ? e1Best.est : exBest)} {onE1 ? S.unit : exUnit}</b></>}
          </div>
          {onE1 && <div className="small dim" style={{ marginTop: 4 }}>
            {t('Best estimate from {0} on {1} — an estimate, not a tested max.', fmtNum(e1Best.w) + ' ' + S.unit + ' × ' + e1Best.r, fmtDate(e1Best.d, true))}
          </div>}
          {!onEff && !onE1 && showEff && <div className="small dim" style={{ marginTop: 4 }}>
            {t('A fuller dot means less left in the tank — the same weight at a lower {0} is progress the line alone does not show.', hd)}
          </div>}
        </> : <div className="muted small">{t('Finish your first workout to see progress curves here.')}</div>}
      </div>
    </div>

    {S.workouts.length > 0 && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Recent workouts')}</h4>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('All')} {S.workouts.length}</Button>
      </div>
      <div className="list">{[...S.workouts].reverse().slice(0, 6).map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
    </>}
  </>
}
