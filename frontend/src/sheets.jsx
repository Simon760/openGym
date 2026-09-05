import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB, EXIDX, BODYPARTS, isCardio, isBodyweightEq, allExercises, equipmentOf, exName, exNameEn, exSearchText, exMatches } from './lib/exercises.js'
import { fmtDate, fmtNum, fmtNum2, fmtKg, fmtVol, fmtDur, durPart, todayISO, isoOf, uid, exCount, DAYN, MONTHS_LONG, ACCENTS } from './lib/format.js'
import { lastEntryFor, bestWeightFor, buildSets, effectiveRoutineId, effectiveRoutine, weekDays, swapDays, workoutVolume, setsDone, setsDoneActive, lastBW, supersetUnits, unitOf, setLabel, defaultConfig, warmEntry, cleanupSg, modeOf, effortOf, isBw, isPerSide, sideReps, isWorking, setTop } from './lib/history.js'
import { beep, vibrate } from './lib/sound.js'
import { t, instrFor, getLang, INSTR_LANGS } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { starterRoutines } from './lib/starter.js'
import Media, { Thumb } from './components/Media.jsx'
import Stepper from './components/Stepper.jsx'
import Icon from './components/Icon.jsx'
import { Button, Slider, Switch, Segmented, SelectRow, Row, TextArea, NumberField } from './components/ui.jsx'
import { glyphOf, GLYPH_GROUPS, DEFAULT_GLYPH } from './lib/glyphs.js'
import BodyMap from './components/BodyMap.jsx'
import { loadOfWorkouts, musclesOf, MUSCLE_NAME } from './lib/muscles.js'
import MuscleShare from './components/MuscleShare.jsx'
import { parseImport, mergeImport } from './lib/import-csv.js'
import { buildPlanBundle, parsePlan, mergePlan, printPlan } from './lib/plan-share.js'
import { parseProgram, PROGRAM_SPEC } from './lib/plan-import.js'
import { dailyDigest, trainingDigest } from './lib/digest.js'
import { estimate1RM, best1RM, is1RMRecord, REP_CAP } from './lib/onerm.js'
import { nextPrescription, applyPrescription, policyFor, defaultIncrement, POLICIES_FOR, POLICY_NAME, POLICY_DESC, MAX_BW_SETS } from './lib/progression.js'
import { MOBILE, shareExport, shareText, canShareText } from './lib/mobile.js'
import { entryFor, hasMacros, kcalFromMacros, derivedMismatch, remainingOf, putEntry, isRefeed, goalFor, MACROS, MACRO_NAME } from './lib/nutrition.js'
import { validBodyFat, composition, sleepFor, putSleep, validSleep, sleepHours, hoursBetween, validTime, BF_MIN, BF_MAX, SLEEP_MIN, SLEEP_MAX } from './lib/body.js'
import { parseHealth, applyHealth, parseHealthCSV, applyHealthDays, shortcutRecipe, shortcutLink, historySpec } from './lib/health.js'
import { suppOn, suppName, tookOn, setTook, suppStreak, suppRate } from './lib/supp.js'
import { weekFor, weekOfBlock, setWeekDay, duplicateBlock, emptyBlock, blocksOf, activeBlock, blockFromCurrent, startBlock, cancelSwitch, upcoming, daysUntil, removeBlock, sessionsIn, weekIndexAt, MAX_WEEKS, WEEKDAYS } from './lib/blocks.js'
import { impliedTDEE, tdeeParts, trimOf, stepBaseOf, restStrictOf, countsToday, projectedWeight, recordCalibration, calibration, dayBalance, KCAL_PER_KG_FAT, BIG_EFFORT, TDEE_PARTS, TDEE_MIN, TDEE_MAX, TRIM_MAX, IMPLIED_MIN_SPAN, IMPLIED_MIN_DAYS, IMPLIED_MIN_WEIGHINS } from './lib/energy.js'
import { APP_NAME, FILE_PREFIX } from './lib/brand.js'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const snd = () => S().sound

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{cancelText || t('Cancel')}</Button>
  </div>
}
// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts) {
  ui().openSheet(close => <ConfirmDialog {...opts} close={close} />, { kind: 'center' })
}

/* ============================ starter plan ============================ */
export function loadStarterPlan() {
  const [push, pull, legs] = starterRoutines()
  update(st => {
    st.routines.push(push, pull, legs)
    st.week[1] = push.id; st.week[3] = pull.id; st.week[5] = legs.id
  })
  toast(t('Starter plan loaded — Mon Push · Wed Pull · Fri Legs'))
}

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons cover exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = unit => (unit === 'lb' ? 660 : 300)
function WeightInput({ value, setValue, unit }) {
  const W_HI = wHi(unit)
  // Hundredths, not tenths. A scale reading 79.45 was rounded to 79.5 on the way in, and
  // fifty grams is most of a fortnight's projected loss — the one number here that has to
  // survive intact, since every projection is measured from it.
  const clamp = x => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 100) / 100))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = v => setValue(clamp(v))
  // The readout is the field: the buttons walk it in tenths, tapping it types the exact
  // figure. Without that there was no way to enter a hundredth at all.
  const [raw, setRaw] = useState(null)
  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label="minus 0.1"><Icon name="minus" /></button>
      <div className="bw-read">
        <input inputMode="decimal" value={raw ?? fmtKg(value)}
          onFocus={e => { setRaw(String(value)); e.target.select() }}
          onChange={e => { const x = e.target.value.replace(',', '.'); setRaw(e.target.value); const n = parseFloat(x); if (isFinite(n)) setValue(clamp(n)) }}
          onBlur={() => setRaw(null)}
          style={{ font: 'inherit', color: 'inherit', background: 'none', border: 0, width: '3.4em',
            textAlign: 'center', padding: 0, outline: 'none' }} />
        <span className="u"> {unit}</span>
      </div>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label="plus 0.1"><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
/* Every one of these writes a day, and the day used to be today by convention rather than by
 * decision — the home screen only ever showed today, so nothing else could ask. Now that it
 * can be pointed at any day, the day is a parameter with today as its default: a missed
 * Tuesday is filled in from the same sheet, in the same place, rather than not at all. */
function BwSheet({ onDone, close, iso = todayISO() }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const [v, setV] = useState(bw ? bw.w : 70)
  // Body fat rides on the weigh-in because that is how a scale reports it — one reading,
  // one entry. Optional: leaving it at zero writes a weigh-in exactly as before.
  const [bf, setBf] = useState(() => {
    const todays = st.bodyweight.find(b => b.d === iso)
    return validBodyFat(todays && todays.bf) ?? validBodyFat(bw && bw.bf) ?? 0
  })
  const comp = composition({ w: v, bf })
  const save = () => {
    const n = Math.round((v || 0) * 100) / 100
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    const pct = validBodyFat(bf)
    update(s => {
      // Written before the weigh-in lands, because inserting it destroys the thing being
      // compared: this reading becomes the new anchor and the projection it disagreed with
      // stops existing. The pair is what any future recalibration has to work from.
      recordCalibration(s, iso, n)
      const ex = s.bodyweight.find(b => b.d === iso)
      const target = ex || { d: iso }
      target.w = n
      target.t = Date.now()
      // Cleared rather than left behind: a percentage from a previous weigh-in silently
      // riding on today's would make the lean-mass curve move without a measurement.
      if (pct != null) target.bf = pct; else delete target.bf
      if (!ex) s.bodyweight.push(target)
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    if (onDone) onDone(n); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight].reverse().slice(0, 3)
  const delEntry = d => update(s => { s.bodyweight = s.bodyweight.filter(b => b.d !== d) })
  return <>
    <h3>{t('Log body weight')}</h3>
    <div className="muted small">{fmtDate(iso, true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 10 }} />
    <Stepper label={t('Body fat (%)')} unit="%" value={bf} step={0.1} onChange={setBf} />
    {/* Lean mass is what a cut is actually judged on — losing weight is easy, losing weight
        that is all fat is the exercise — so it is shown the moment there is a percentage
        to derive it from, rather than waiting for a chart. */}
    {comp && <div className="small dim" style={{ marginTop: 6 }}>
      {t('{0} fat · {1} lean', fmtNum(comp.fat) + ' ' + unit, fmtNum(comp.lean) + ' ' + unit)}
    </div>}
    {bf > 0 && !comp && <div className="small" style={{ color: 'var(--yellow)', marginTop: 6 }}>
      {t('A body-fat reading sits between {0} and {1} %.', BF_MIN, BF_MAX)}
    </div>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {recent.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <div key={b.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(b.d, true)}</span>
          <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
            <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => delEntry(b.d)} aria-label="delete"><Icon name="trash" /></button></span>
        </div>)}
      </div>
    </>}
  </>
}
export function bwSheet(opts = {}) {
  return ui().openSheet(close => <BwSheet {...opts} close={close} />)
}

/* ============================ import from another app ============================ */
// Shows what a parsed export would actually do before anything is written. An import is
// the one action where "just try it" is expensive — it's someone's entire training
// history — so the numbers, the unit conversion and the exercises we couldn't recognise
// are all on screen before the confirm button.
function ImportSummary({ parsed, close }) {
  const st = useStore(s => s.S)
  const isBW = parsed.kind === 'bodyweight'
  const have = isBW
    ? parsed.bodyweight.filter(b => st.bodyweight.some(x => x.d === b.d)).length
    : parsed.workouts.filter(w => st.workouts.some(x => x.d === w.d)).length
  const fresh = (isBW ? parsed.bodyweight.length : parsed.workouts.length) - have

  const doImport = () => {
    let res
    update(s => { res = mergeImport(s, parsed) })
    close()
    toast(isBW
      ? t('{0} weigh-ins imported', res.added)
      : t('{0} workouts imported', res.added))
  }

  return <>
    <h3>{parsed.source ? t('Import from {0}', parsed.source) : t('Import history')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {parsed.from === parsed.to ? fmtDate(parsed.from, true) : fmtDate(parsed.from, true) + ' – ' + fmtDate(parsed.to, true)}
    </div>

    <div className="tiles" style={{ textAlign: 'left' }}>
      {isBW ? <>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      </> : <>
        <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.workouts.length}</div></div>
        <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.sets}</div></div>
        <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.matched}</div></div>
        <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.created}</div></div>
      </>}
    </div>

    {parsed.mixedUnits ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file mixes kg and lb — each set is converted to {0}.', st.unit)}
    </div> : parsed.converted ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file is in {0} and your profile is in {1} — weights will be converted.', parsed.fileUnit, st.unit)}
    </div> : null}
    {!isBW && !parsed.fileUnit && !parsed.mixedUnits && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('The file does not say which unit it uses — numbers are imported as they are.')}
    </div>}
    {have > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('{0} days already have data here and will be left alone.', have)}
    </div>}
    {/* The file rated its sets. Say so: the column is off by default, so the ratings would
        otherwise arrive invisibly and look like they had been dropped. */}
    {!isBW && (parsed.rirSets + parsed.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t(effortOf(st) === 'none'
        ? '{0} sets bring an {1} with them — switch on Effort per set in Settings to see it.'
        : '{0} sets bring an {1} with them.',
      parsed.rirSets || parsed.rpeSets, parsed.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {!isBW && parsed.unmatchedNames.length > 0 && <>
      <h4 className="sec">{t('Not in the library — added as your own exercises')}</h4>
      <div className="mchips" style={{ marginBottom: 12 }}>
        {parsed.unmatchedNames.slice(0, 12).map(n => <span key={n} className="mchip capitalize">{n}</span>)}
        {parsed.unmatchedNames.length > 12 && <span className="mchip">+{parsed.unmatchedNames.length - 12}</span>}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!fresh}>
      {fresh ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Read a CSV/XML export, then show what it would do. */
export function importFromApp(file, onDone) {
  const rd = new FileReader()
  rd.onload = () => {
    let parsed
    try { parsed = parseImport(String(rd.result), { unit: S().unit }) }
    catch (e) { toast(t('Could not read that file')); return }
    if (parsed.error === 'empty') { toast(t('That file is empty')); return }
    if (parsed.error) { toast(t("That file's columns aren't recognised — see the docs for supported apps.")); return }
    if (parsed.kind === 'bodyweight' ? !parsed.bodyweight.length : !parsed.workouts.length) {
      toast(t('Nothing to import from that file')); return
    }
    ui().openSheet(close => <ImportSummary parsed={parsed} close={close} />)
    onDone && onDone()
  }
  rd.onerror = () => toast(t('Could not read that file'))
  rd.readAsText(file)
}

/* ============================ target weight ============================ */
export function bwDeltaColor(delta, currentW) {
  if (!delta) return 'var(--label-2)'
  if (!S().targetW) return 'var(--label)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const n = Math.round((v || 0) * 100) / 100
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { update(s => { s.targetW = null }); close(); toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)

/* ============================ daily intake ============================ */
// Calories and macros for one day. Four numbers, one screen, no meal breakdown — see
// lib/nutrition.js for why the day is the unit.
function NutriSheet({ close, iso = todayISO() }) {
  const st = S()
  const [v, setV] = useState(() => {
    const e = entryFor(st, iso)
    return { kcal: e?.kcal || 0, p: e?.p || 0, c: e?.c || 0, f: e?.f || 0 }
  })
  const set = (k, n) => setV(o => ({ ...o, [k]: n || 0 }))
  const [refeed, setRefeed] = useState(() => isRefeed(entryFor(st, iso)))
  // The day's own expenditure, which is what "at maintenance" means for this particular day —
  // it already contains the training and the walking. Read live so the target follows the
  // session you logged an hour ago rather than a flat figure from the settings.
  const dayOut = (dayBalance(st, iso, st.tdee) || {}).out || 0
  // Asked here because logging the day's calories already happens every evening, and a
  // reminder hung off a moment that already exists is the only kind that survives a fortnight.
  const [took, setTookState] = useState(() => tookOn(st, iso))
  const asking = suppOn(st)
  const streak = suppStreak(st)
  const rate = suppRate(st, 30)
  const derived = kcalFromMacros(v)
  const mismatch = derivedMismatch(v)
  const dayGoal = goalFor(st.nutriGoal, { refeed }, dayOut)
  const left = remainingOf(v, dayGoal)
  const save = () => {
    update(s => {
      s.nutrition = putEntry(s.nutrition, { d: iso, ...v, refeed })
      // Saved even when nothing else on this sheet was: a day whose only event was the
      // tablet is still a day the streak should count.
      if (asking && took != null) setTook(s, iso, took)
    })
    close()
    toast(v.kcal || derived ? t('Intake saved') : t('Intake cleared'))
  }
  const recent = [...(st.nutrition || [])].reverse().slice(0, 3)
  const delEntry = d => update(s => { s.nutrition = (s.nutrition || []).filter(e => e.d !== d) })

  return <>
    <h3>{t('Log intake')}</h3>
    <div className="muted small">{t('Today') + ', ' + fmtDate(iso, true)}</div>
    <div style={{ height: 12 }} />
    <Stepper label={t('Calories')} unit="kcal" value={v.kcal} step={50} decimal={false} onChange={n => set('kcal', n)} />
    {MACROS.map(m => <Stepper key={m} label={t(MACRO_NAME[m])} unit="g" value={v[m]} step={5} decimal={false} onChange={n => set(m, n)} />)}

    {/* Macros logged but no calorie figure: the macros already say what it is, so offer it
        rather than making someone do the 4/4/9 arithmetic on their phone. */}
    {!v.kcal && derived > 0 && <>
      <div style={{ height: 8 }} />
      <Button size="sm" icon="bolt" onClick={() => set('kcal', Math.round(derived))}>
        {t('Use {0} kcal from macros', Math.round(derived))}
      </Button>
    </>}
    {/* Both logged and they disagree by more than a rounding: said once, never applied.
        Alcohol and fibre are real calories no field here captures, so both numbers can
        be right — but a fat entry typed as 600 instead of 60 shows up here first. */}
    {mismatch != null && <div className="small dim" style={{ marginTop: 8 }}>
      {t('Your macros add up to {0} kcal.', mismatch)}
    </div>}
    {left && left.kcal != null && <div className="small" style={{ marginTop: 8, color: left.kcal < 0 ? 'var(--orange)' : 'var(--label-2)' }}>
      {left.kcal < 0 ? t('{0} kcal over target', fmtNum(-left.kcal)) : t('{0} kcal left today', fmtNum(left.kcal))}
      {refeed && <span className="dim"> · {t('against maintenance')}</span>}
    </div>}

    {/* Some days are eaten at maintenance on purpose. This moves the day's target up to what
        the day actually spent, so the app stops reporting a deliberate refeed as an overshoot.
        It touches nothing else: the deficit is still expenditure minus intake, and the day
        still counts in the projection exactly as it did. */}
    <div style={{ height: 10 }} />
    {/* A div, not a button: the switch inside is the control, and a button inside a button is
        invalid markup the browser is free to take apart — which is exactly what it did. */}
    <div className="today-row wrap" style={{ cursor: 'default' }}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: refeed ? 'var(--yellow)' : 'var(--surface-3)' }}>
          <Icon name={refeed ? 'checkCircle' : 'bolt'} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Maintenance day')}</div>
          <div className="ttl" style={{ fontSize: 15 }}>
            {refeed
              ? (dayOut ? t('target {0} kcal — the day’s own spend', fmtNum(dayOut)) : t('no target today'))
              : t('recharge · counted the same, judged against maintenance')}
          </div>
        </div>
      </div>
      <Switch checked={refeed} onChange={v => setRefeed(v)} />
    </div>

    {/* One question, and a streak so the answer is worth giving. Creatine works by
        saturation: a dose missed on Tuesday is not made up on Wednesday, it just lowers the
        average — so what matters is the run, not any single day. */}
    {asking && <>
      <div style={{ height: 14 }} />
      <div className="today-row" style={{ cursor: 'default' }}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: took ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={took ? 'checkCircle' : 'flame'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Did you take your {0}?', suppName(st))}</div>
            <div className="ttl" style={{ fontSize: 15 }}>
              {streak > 0 ? t('{0} days running', streak) : t('Not answered')}
            </div>
          </div>
        </div>
        <Segmented style={{ flex: 'none' }} value={took === null ? '' : took ? 'y' : 'n'}
          onChange={x => setTookState(x === 'y')}
          options={[{ value: 'y', label: t('Yes') }, { value: 'n', label: t('No') }]} />
      </div>
      {rate && rate.answered >= 7 && <div className="dim small" style={{ margin: '6px 2px 0', lineHeight: 1.45 }}>
        {t('{0} of the last {1} days answered — {2} %.', rate.taken, rate.answered, rate.pct)}
      </div>}
    </>}

    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>

    {recent.length > 0 && <>
      <h4 className="sec">{t('Recent days')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(e => <div key={e.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(e.d, true)}</span>
          <span className="row" style={{ gap: 12 }}>
            <b>{e.kcal ? fmtNum(e.kcal) + ' kcal' : fmtNum(kcalFromMacros(e)) + ' kcal'}</b>
            {hasMacros(e) && <span className="small dim">{MACROS.map(m => (e[m] || 0) + 'g').join(' · ')}</span>}
            <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => delEntry(e.d)} aria-label="delete"><Icon name="trash" /></button>
          </span>
        </div>)}
      </div>
    </>}
  </>
}
export const nutriSheet = iso => ui().openSheet(close => <NutriSheet close={close} {...(iso ? { iso } : {})} />)

function NutriGoalSheet({ close }) {
  const st = S()
  const [v, setV] = useState(() => ({
    kcal: st.nutriGoal?.kcal || 0, p: st.nutriGoal?.p || 0, c: st.nutriGoal?.c || 0, f: st.nutriGoal?.f || 0
  }))
  const set = (k, n) => setV(o => ({ ...o, [k]: n || 0 }))
  const derived = kcalFromMacros(v)
  return <>
    <h3>{t('Daily targets')}</h3>
    <div className="muted small">{t('Only the targets you set are counted down — calories alone is a complete setup.')}</div>
    <div style={{ height: 12 }} />
    <Stepper label={t('Calories')} unit="kcal" value={v.kcal} step={50} decimal={false} onChange={n => set('kcal', n)} />
    {MACROS.map(m => <Stepper key={m} label={t(MACRO_NAME[m])} unit="g" value={v[m]} step={5} decimal={false} onChange={n => set(m, n)} />)}
    {!v.kcal && derived > 0 && <>
      <div style={{ height: 8 }} />
      <Button size="sm" icon="bolt" onClick={() => set('kcal', Math.round(derived))}>
        {t('Use {0} kcal from macros', Math.round(derived))}
      </Button>
    </>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const goal = {}
      for (const k of ['kcal', ...MACROS]) if (v[k] > 0) goal[k] = v[k]
      if (!Object.keys(goal).length) { toast(t('Set at least one target')); return }
      update(s => { s.nutriGoal = goal }); close(); toast(t('Targets set'))
    }}>{t('Save targets')}</Button>
    {st.nutriGoal && <><div style={{ height: 8 }} />
      <Button variant="danger" onClick={() => { update(s => { s.nutriGoal = null }); close(); toast(t('Targets removed')) }}>{t('Remove targets')}</Button></>}
  </>
}
export const nutriGoalSheet = () => ui().openSheet(close => <NutriGoalSheet close={close} />)

/* ============================ maintenance (TDEE) ============================ */
// The one figure in the app nothing can measure for you — and the one every deficit reading
// hangs off. See lib/energy.js for why it asks for the sedentary number and adds training
// on top, and for how the implied figure below is derived.
function TdeeSheet({ close }) {
  const st = S()
  const [v, setV] = useState(() => {
    const p = tdeeParts(st.tdee)
    const base = stepBaseOf(st)
    return p ? { bmr: p.bmr, neat: p.neat, other: p.other, sport: p.sport, stepBase: base }
      : { bmr: 0, neat: 0, other: 0, sport: 0, stepBase: base }
  })
  const [trim, setTrim] = useState(() => Math.round(trimOf(st) * 100))
  const [strict, setStrict] = useState(() => restStrictOf(st))
  const set = (k, n) => setV(o => ({ ...o, [k]: Math.round(n || 0) }))
  const total = TDEE_PARTS.reduce((a, k) => a + (v[k] || 0), 0)
  const parts = tdeeParts(v)
  const implied = impliedTDEE(st)
  const gap = parts && implied.tdee ? parts.total - implied.tdee : null

  const why = {
    weighIns: t('It needs at least {0} weigh-ins.', IMPLIED_MIN_WEIGHINS),
    span: t('It needs a run of at least {0} days — anything shorter is water, not fat.', IMPLIED_MIN_SPAN),
    days: t('It needs at least {0} days of logged intake.', IMPLIED_MIN_DAYS),
    coverage: t('Your intake is logged on {0} of {1} days — too few to stand for the period.', implied.days, implied.span + 1),
    range: t('The figures do not come to anything a body could spend — check the log.')
  }[implied.why]

  const FIELDS = [
    ['bmr', t('BMR'), t('What the body spends doing nothing at all.')],
    ['neat', t('NEAT'), t('Walking, standing, fidgeting — everything that is not a session.')
      + ' ' + t('What an ordinary day costs. A day whose steps you never logged is charged exactly this.')],
    ['other', t('Other'), t('Digestion, the cold, anything else you count separately.')],
    ['sport', t('Sport already included'), t('Training the total above already contains, smoothed over the week. A session you measured is counted against it: more than this adds to the day, less takes off. Leave it at 0 if your figure is what you burn on a day you do not train.')]
  ]

  return <>
    <h3>{t('Maintenance')}</h3>
    <div className="muted small" style={{ lineHeight: 1.45 }}>
      {t('Entered as its parts, because that is how it is arrived at — and because a single number hides which part was wrong when the total turns out to be.')}
    </div>
    <div style={{ height: 12 }} />
    {FIELDS.map(([k, label, hint]) => <div key={k} style={{ marginBottom: 4 }}>
      <Stepper label={label} unit="kcal" value={v[k]} step={25} decimal={false} onChange={n => set(k, n)} />
      <div className="dim small" style={{ margin: '2px 2px 8px', lineHeight: 1.4 }}>{hint}</div>
      {/* NEAT in the unit a phone actually measures it in. Walking above this line is the one
          thing allowed to move a day off the entered figure, and it can only move it up:
          a day that barely walked still costs the whole total. */}
      {k === 'neat' && v.neat > 0 && <div style={{ marginBottom: 12 }}>
        <Stepper label={t('which is about')} unit={t('steps')} value={v.stepBase} step={500} decimal={false}
          onChange={n => setV(o => ({ ...o, stepBase: Math.max(1000, Math.min(40000, Math.round(n || 0))) }))} />
        <div className="dim small" style={{ margin: '2px 2px 0', lineHeight: 1.4 }}>
          {t('About {0} kcal per 1 000 steps. A day above this line costs more, a day below it costs less — and a day whose steps you never logged costs exactly the figure above.',
            Math.round((v.neat / Math.max(1000, v.stepBase)) * 1000))}
        </div>
        {/* 0.03 kcal a step is the net cost — what walking adds over lying still. The gross
            figures published for step counters run 0.04 to 0.05 and already contain the
            resting metabolism this profile counts separately as BMR. Entering one of those
            here counts an hour of doing nothing twice. */}
        {v.neat / Math.max(1000, v.stepBase) > 0.04 && <div className="small" style={{ margin: '6px 2px 0', lineHeight: 1.4, color: 'var(--yellow)' }}>
          {t('That works out at {0} kcal a step. Net of resting metabolism a step costs nearer 0.03 — the higher figures printed on step counters already contain the BMR you counted above.',
            (v.neat / Math.max(1000, v.stepBase)).toFixed(3))}
        </div>}
      </div>}
    </div>)}

    <div className="row between" style={{ padding: '8px 2px 0', borderTop: '1px solid var(--sep)' }}>
      <span className="muted">{t('Total')}</span>
      <b className="stat-v" style={{ fontSize: 20, color: parts ? 'var(--acc)' : 'var(--orange)' }}>{fmtNum(total)} kcal</b>
    </div>
    {/* What the parts actually come to on the two kinds of day. Spelled out as figures and
        not as a sentence, because "sport already included" reads to most people as "this is
        what I burn when I train" — and the consequence, that a rest day is charged less, is
        invisible until months of totals come out wrong. */}
    {v.sport > 0 && <>
      <div className="row between small" style={{ padding: '6px 2px 0' }}>
        <span className="dim">{t('A rest day')}</span>
        <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtNum(strict ? total - v.sport : total)} kcal</b>
      </div>
      <div className="row between small" style={{ padding: '3px 2px 0' }}>
        <span className="dim">{t('A day trained as planned')}</span>
        <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtNum(total)} kcal</b>
      </div>
      <div className="row between small" style={{ padding: '3px 2px 0' }}>
        <span className="dim">{t('A day nothing measured')}</span>
        <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtNum(total)} kcal</b>
      </div>
      <div style={{ height: 10 }} />
      <Button icon="reset" onClick={() => setV(o => ({ ...o, other: (o.other || 0) + o.sport, sport: 0 }))}>
        {t('My figure contains no training at all')}
      </Button>
      <div className="dim small" style={{ margin: '6px 2px 0', lineHeight: 1.45 }}>
        {t('Moves the {0} kcal into Other. The total does not change, but every training kcal you record is then added whole, instead of being counted against the {0} the figure assumed.', fmtNum(v.sport))}
      </div>
      {/* The same question the other way round, for a profile that wants to keep the smoothed
          sport in the figure. Off by default: it and the watch discount are two corrections of
          opposite sign, and turning on only one of them is how a model drifts. */}
      <div style={{ height: 12 }} />
      <div className="row between" style={{ gap: 12, padding: '2px 2px' }}>
        <span style={{ minWidth: 0 }}>{t('Charge a rest day the {0} kcal less', fmtNum(v.sport))}</span>
        <Switch checked={strict} onChange={setStrict} />
      </div>
      <div className="dim small" style={{ margin: '6px 2px 0', lineHeight: 1.45 }}>
        {t('Strictly correct, and off by default. It and the watch discount below are two errors of opposite sign; turn this on once your weigh-ins say the predictions run heavy, not before.')}
      </div>
    </>}

    <h4 className="sec">{t('Trust in the watch')}</h4>
    <Stepper label={t('Discount its active energy by')} unit="%" value={trim} step={1} decimal={false}
      onChange={n => setTrim(Math.max(0, Math.min(Math.round(TRIM_MAX * 100), Math.round(n || 0))))} />
    <div className="dim small" style={{ margin: '6px 2px 0', lineHeight: 1.45 }}>
      {t('Wrist devices are good at heart rate and poor at energy — they read it 20 to 40 % high, almost always high. Applied to every training figure, including the ones you type in and import, because those are read off a watch too. Zero trusts it as it comes.')}
    </div>

    {(() => {
      const cal = calibration(st)
      if (!cal.pairs.length) return null
      return <>
        <h4 className="sec">{t('Predicted against measured')}</h4>
        <div className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {cal.pairs.slice(-6).map(c => <div key={c.d} className="row between" style={{ padding: '4px 2px', borderBottom: '1px solid var(--sep-op)' }}>
            <span className="dim">{fmtDate(c.d, true)}</span>
            <span className="row" style={{ gap: 10 }}>
              <span className="dim">{fmtNum(c.predicted)} → {fmtNum(c.actual)}</span>
              <b style={{ color: Math.abs(c.error) < 0.4 ? 'var(--acc)' : 'var(--orange)', minWidth: 46, textAlign: 'right' }}>
                {(c.error > 0 ? '+' : '−') + fmtNum(Math.abs(c.error))} kg
              </b>
            </span>
          </div>)}
        </div>
        <div className="dim small" style={{ margin: '8px 2px 0', lineHeight: 1.45 }}>
          {cal.why === 'few'
            ? t('{0} more weigh-ins and this can say which constant to move. A positive error means the scale is behind the prediction — less came off than the model said.', cal.need)
            : cal.blame === 'trim'
              ? t('The error grows with training volume ({0} kcal a day against {1}), which points at the watch discount rather than the figure itself. Raise the {2} % below.', fmtNum(cal.hiVol), fmtNum(cal.loVol), Math.round(trimOf(st) * 100))
              : t('The error sits at {0} kg whatever the training volume, which points at the maintenance total rather than the watch. Adjust the parts above, not the discount below.', fmtNum(cal.bias))}
        </div>
      </>
    })()}

    <h4 className="sec">{t('What a projected weight is not')}</h4>
    <div className="dim small" style={{ lineHeight: 1.5 }}>
      {t('A projection is a tendency, not a measurement. The scale answers to glycogen water (a kilo or two, with the carbs), to salt (a gram of it holds about 100 ml), to whatever is still in transit, and to the swelling after a hard session — all of which move it further in a day than a week of deficit does. Only a weigh-in in constant conditions settles anything: on waking, before eating, after the bathroom, same scale.')}
    </div>

    {implied.tdee ? <>
      <h4 className="sec">{t('What your own history says')}</h4>
      <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div className="stat-v">{fmtNum(implied.tdee)} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
          <div className="small dim" style={{ marginTop: 2 }}>
            {t('{0} days logged of {1}, {2} weigh-ins, {3} kg a week', implied.days, implied.span + 1, implied.weighIns, fmtNum(implied.kgPerWeek))}
          </div>
        </div>
        {total !== implied.tdee &&
          <Button size="sm" icon="bolt" onClick={() => set('other', Math.max(0, (v.other || 0) + implied.tdee - total))}>{t('Use it')}</Button>}
      </div>
      {gap != null && Math.abs(gap) >= 150 && <div className="small" style={{ marginTop: 8, color: 'var(--orange)', lineHeight: 1.4 }}>
        {gap > 0
          ? t('You have entered {0} kcal more than your weight curve accounts for — every deficit here reads that much too large.', fmtNum(gap))
          : t('You have entered {0} kcal less than your weight curve accounts for — every deficit here reads that much too small.', fmtNum(-gap))}
      </div>}
      <div className="dim small" style={{ marginTop: 8, lineHeight: 1.45 }}>
        {t('Read off your weigh-ins and your intake log, with the training that actually happened taken out and your planned {0} kcal put back — so it lines up with the total above. It beats any formula, because it is measured on you.', fmtNum(implied.planned))}
      </div>
    </> : <>
      <h4 className="sec">{t('What your own history says')}</h4>
      <div className="dim small" style={{ lineHeight: 1.45 }}>
        {t('Not enough logged yet to read maintenance off your own curve.')} {why || ''}
      </div>
    </>}

    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      if (!parts) { toast(t('A maintenance figure sits between {0} and {1} kcal.', TDEE_MIN, TDEE_MAX)); return }
      update(s => {
        s.tdee = { bmr: parts.bmr, neat: parts.neat, other: parts.other, sport: parts.sport, stepBase: v.stepBase }
        s.watchTrim = Math.round(trim) / 100
        s.restStrict = strict
      })
      close(); toast(t('Maintenance set'))
    }}>{t('Save')}</Button>
    {st.tdee && <><div style={{ height: 8 }} />
      <Button variant="danger" onClick={() => { update(s => { s.tdee = null }); close(); toast(t('Maintenance cleared')) }}>{t('Delete')}</Button></>}
  </>
}
export const tdeeSheet = () => ui().openSheet(close => <TdeeSheet close={close} />)

/* ============================ the projection, day by day ============================ */
/**
 * Every day the projected weight is built from, with the arithmetic that produced it.
 *
 * A projection that disagrees with another calculation is worthless until you can see which
 * day the two disagree on. Four terms decide each day and any one of them can be applied
 * differently — the watch discount, the training a maintenance figure already contains, the
 * step baseline, whether an unmeasured day is charged anything at all — so all four are
 * printed, per day, with the running total beside them.
 */
function ProjectionSheet({ close }) {
  const st = S()
  const p = tdeeParts(st.tdee)
  const proj = projectedWeight(st)
  if (!proj || !p) return <>
    <h3>{t('Projected weight')}</h3>
    <div className="muted small">{t('It needs a weigh-in, and days logged after it.')}</div>
  </>
  // Weighed in, and nothing logged since — not even the weigh-in day itself, which does now
  // count the moment it has an intake. Nothing to project over, and saying so is the answer.
  if (!proj.days) return <>
    <h3>{t('Projected weight')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('You weighed in on {0} at {1}. Log what you eat and it starts counting from that same day — a morning weigh-in knows nothing about the day it was taken.',
        fmtDate(proj.from, true), fmtKg(proj.fromKg) + ' ' + st.unit)}
    </div>
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>

  const rows = (st.nutrition || [])
    // Exactly the projection's own range, closed at both ends. The weigh-in day is the first
    // row, not the row before the first: you weigh in the morning, so that day's food and
    // training are the first thing the reading does not already contain.
    .filter(e => e.kcal != null && e.d >= proj.from && e.d <= proj.to)
    .sort((a, b) => (a.d < b.d ? -1 : 1))
    .map(e => dayBalance(st, e.d, st.tdee))
    .filter(b => b && b.deficit != null)
  let run = 0

  const SRC = { session: t('measured'), watch: t('day total'), free: t('by hand'),
    missing: t('no figure'), rest: t('rest'), unknown: t('no record') }

  return <>
    <h3>{t('Projected weight')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {countsToday(st)
        ? t('{0} on {1}, and every day logged from that one on — a morning weigh-in knows nothing about the day it was taken, so that day is the first one counted. Each line is the day’s own arithmetic; no day is carried over into the next.',
          fmtKg(proj.fromKg) + ' ' + st.unit, fmtDate(proj.from, true))
        : t('{0} on {1}, and every finished day logged from that one on — today is still being lived and is counted below, not in. Each line is the day’s own arithmetic; no day is carried over into the next.',
          fmtKg(proj.fromKg) + ' ' + st.unit, fmtDate(proj.from, true))}
    </div>

    <div style={{ overflowX: 'auto', margin: '0 -2px' }}>
      <table className="small" style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        <thead>
          <tr style={{ color: 'var(--label-2)' }}>
            {[t('Day'), t('Base'), t('Sport'), t('Steps'), t('Spent'), t('Eaten'), t('Deficit'), t('Total')].map((h, i) =>
              <th key={i} style={{ textAlign: i ? 'right' : 'left', padding: '0 7px 6px 0', fontWeight: 600 }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(b => {
            run += b.deficit
            const cell = { textAlign: 'right', padding: '5px 7px 5px 0', borderTop: '1px solid var(--sep-op)' }
            return <tr key={b.d}>
              <td style={{ ...cell, textAlign: 'left' }}>{fmtDate(b.d, true)}</td>
              <td style={cell}>{fmtNum(b.tdee)}</td>
              <td style={{ ...cell, color: b.delta ? (b.delta > 0 ? 'var(--acc)' : 'var(--orange)') : 'var(--label-2)' }}>
                {b.delta ? (b.delta > 0 ? '+' : '−') + fmtNum(Math.abs(b.delta)) : '·'}
                <span className="dim" style={{ fontSize: '.8em' }}> {SRC[b.sportSource] || ''}
                  {b.free > 0 ? ' +' + fmtNum(b.free) + ' ' + t('by hand') : ''}</span>
              </td>
              <td style={{ ...cell, color: b.bonus ? (b.bonus > 0 ? 'var(--acc)' : 'var(--orange)') : 'var(--label-2)' }}>
                {b.bonus ? (b.bonus > 0 ? '+' : '−') + fmtNum(Math.abs(b.bonus)) : '·'}
                {b.steps != null && <span className="dim" style={{ fontSize: '.8em' }}> {fmtNum(b.steps)}</span>}
              </td>
              <td style={cell}>
                <b>{fmtNum(b.out)}</b>
                {b.big && <span title={t('Unusually large — the arithmetic is the same, but it is worth checking')}
                  style={{ color: 'var(--yellow)', marginLeft: 4 }}>!</span>}
              </td>
              <td style={cell}>{fmtNum(b.intake)}</td>
              <td style={{ ...cell, color: b.deficit >= 0 ? 'var(--acc)' : 'var(--orange)' }}>{(b.deficit > 0 ? '+' : '') + fmtNum(b.deficit)}</td>
              <td style={{ ...cell, color: 'var(--label-2)' }}>{fmtNum(run)}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>

    <h4 className="sec">{t('Which gives')}</h4>
    <div className="small" style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.9 }}>
      <div className="row between"><span className="dim">{t(proj.days === 1 ? 'Deficit over one day' : 'Deficit over {0} days', proj.days)}</span><b>{fmtNum(proj.deficit)} kcal</b></div>
      {/* Two decimals here and nowhere else. One decimal turned 0.96 kg into "1", and a
          middle line that does not visibly lead to the line under it is worse than no middle
          line: it makes a correct answer look wrong, which is the same as being wrong. */}
      <div className="row between"><span className="dim">{t('÷ {0} kcal a kilo', fmtNum(KCAL_PER_KG_FAT))}</span><b>{fmtNum2(proj.deficit / KCAL_PER_KG_FAT)} {st.unit}</b></div>
      <div className="row between" style={{ borderTop: '1px solid var(--sep)', paddingTop: 4, marginTop: 4 }}>
        <span className="dim">{fmtNum2(proj.fromKg)} − {t('that')}</span><b style={{ color: 'var(--acc)' }}>{fmtNum2(proj.kg)} {st.unit}</b>
      </div>
    </div>
    {/* Today, beside the figure rather than inside it. Excluded because an unfinished day
        understates what was eaten and so overstates the deficit — but invisible exclusion is
        how two calculations disagree by a day and nobody can see why. */}
    {(() => {
      const b = dayBalance(st, todayISO(), st.tdee)
      if (!b || b.deficit == null || proj.to >= todayISO()) return null
      const withToday = proj.fromKg - (proj.deficit + b.deficit) / KCAL_PER_KG_FAT
      return <div className="small dim" style={{ marginTop: 10, lineHeight: 1.6, fontVariantNumeric: 'tabular-nums' }}>
        <div className="row between">
          <span>{t('Today so far, not counted')}</span>
          <span>{(b.deficit > 0 ? '+' : '') + fmtNum(b.deficit)} kcal</span>
        </div>
        <div className="row between">
          <span>{t('which would make it')}</span>
          <span>{fmtNum2(withToday)} {st.unit}</span>
        </div>
        {!countsToday(st) && <Button size="sm" variant="ghost" style={{ marginTop: 6 }}
          onClick={() => { update(s => { s.countToday = true }); toast(t('Today counts from now on')) }}>
          {t('Count today too')}
        </Button>}
      </div>
    })()}

    {rows.some(b => b.big) && <div className="small" style={{ color: 'var(--yellow)', marginTop: 10, lineHeight: 1.45 }}>
      {t('The days marked ! spent over {0} kcal on effort. The same formula runs on them as on every other day — the mark is there so an unusual figure gets a second look before it moves a month of totals.', fmtNum(BIG_EFFORT))}
    </div>}
    {proj.gaps > 0 && <div className="small" style={{ color: 'var(--yellow)', marginTop: 10, lineHeight: 1.45 }}>
      {t('{0} days in that stretch logged no food at all. They count for nothing, so this figure is higher than the truth.', proj.gaps)}
    </div>}

    <h4 className="sec">{t('If another calculation disagrees')}</h4>
    <div className="dim small" style={{ lineHeight: 1.5 }}>
      {t('Four rules decide each day, and a different answer means one of them was applied differently. Sport is counted against the {0} kcal your figure already contains, not added whole. A watch reading is discounted {1} % first. Steps move the day both ways from your {2}-step line. And a day nothing measured is charged your figure exactly — never less.',
        fmtNum(p.sport), Math.round(trimOf(st) * 100), fmtNum(stepBaseOf(st)))}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export const projectionSheet = () => ui().openSheet(close => <ProjectionSheet close={close} />)

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
function OneRM({ ex }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id)
  const [w, setW] = useState(best ? best.w : (st.exWeights[ex.id] || {}).w || 20)
  const [r, setR] = useState(best ? best.r : 5)
  const est = estimate1RM(w, r)
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 8 }}>
      {t('From your log:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '—' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a weight and 1–{0} reps — beyond that an estimate is guesswork.', REP_CAP)
      : t('Epley formula — a calculation from one set, not a tested max.')}</div>
  </>
}

function ExerciseDetail({ ex, close }) {
  const st = useStore(s => s.S)
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id)
  return <>
    <h3 className="exn">{exName(ex)}</h3>
    {exNameEn(ex) && <div className="small dim" style={{ marginTop: -6, marginBottom: 8 }}>{exNameEn(ex)}</div>}
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      {/* Body part and equipment only. The target and the supporting muscles used to be
          tags here too, which said "chest, chest, triceps, shoulders" — the body part and
          the target are usually the same word — and said nothing about proportion. The
          share bars below say all of it, with numbers. */}
      <span className="tag acc">{t(ex.bp)}</span>
      <span className="tag"><Icon name="dumbbell" />{t(ex.eq)}</span>
    </div>
    {/* What one set of this is, muscle by muscle — the number the tags above cannot
        give: a target and two supports say which muscles, not in what proportion. */}
    <MuscleShare load={musclesOf(ex)} />
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent">{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target)).join(', ')}` : ''}</div>}
    <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>{t('Add to my plan')}</Button>
    {ex.custom && <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => deleteCustomEx(ex, close)}>{t('Delete')}</Button>
    </div>}
    {!isCardio(ex) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}{!INSTR_LANGS.includes(getLang()) && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4><ol className="steps-list">{instrFor(ex).map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </>
}
export const exerciseDetailSheet = ex => ui().openSheet(close => <ExerciseDetail ex={ex} close={close} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast(t('“{0}” added to {1}', exName(ex), r ? r.name : t('routine')))
      if (isNew && r) nav('/plan/r/' + r.id)
    }, null, isNew ? null : st.routines.find(x => x.id === rid))
  }
  return <>
    <h3 className="exn">{t('Add “{0}”', exName(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine — sets, reps & weight come next.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => pick(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some(e => e.id === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" onClick={() => pick('_new')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = ex => ui().openSheet(close => <AddToRoutine ex={ex} close={close} />)

/* ============================ custom exercises (issue #11) ============================ */
// Name + body part is all it takes — the exercise then behaves like any built-in one
// (planning, logging, PRs, stats), just without an animation.
function CustomExForm({ existing, prefill, onDone, close }) {
  const [n, setN] = useState(existing ? existing.n : (prefill || ''))
  const [bp, setBp] = useState(existing ? existing.bp : '')
  const [desc, setDesc] = useState(existing ? (existing.desc || '') : '')
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    const dup = allExercises(S()).find(e => e.n.toLowerCase() === name.toLowerCase() && e.id !== (existing || {}).id)
    if (dup) { toast(t('“{0}” already exists', dup.n)); return }
    const d = desc.trim().slice(0, 1000)
    let id = existing && existing.id
    if (existing) update(s => { const c = (s.customEx || []).find(x => x.id === id); if (c) { c.n = name; c.bp = bp; c.desc = d } })
    else {
      id = 'c' + uid()
      update(s => { (s.customEx = s.customEx || []).push({ id, n: name, bp, desc: d, tg: '', eq: 'custom', custom: true }) })
    }
    close()
    toast(existing ? t('Saved') : t('“{0}” created', name))
    onDone && onDone(EXIDX[id])
  }
  return <>
    <h3>{existing ? t('Edit custom exercise') : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name it and pick a body part — it behaves like any other exercise, just without an animation.')}</div>
    <input className="input" placeholder={t('Exercise name')} value={n} onChange={e => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    {bp === 'cardio' && <div className="small dim row" style={{ marginBottom: 10, gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <textarea className="input" rows={4} maxLength={1000} placeholder={t('Description (optional) — setup, cues, anything you want to remember')}
      value={desc} onChange={e => setDesc(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
export const customExSheet = (existing, onDone, prefill) => ui().openSheet(close => <CustomExForm existing={existing} prefill={prefill} onDone={onDone} close={close} />)

export function deleteCustomEx(ex, afterDelete) {
  if (S().active?.entries.some(e => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', exName(ex)),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        s.customEx = (s.customEx || []).filter(x => x.id !== ex.id)
        s.routines.forEach(r => { r.ex = r.ex.filter(e => e.id !== ex.id); cleanupSg(r.ex) })
        // stamp the name into history entries so past workouts stay readable
        s.workouts.forEach(w => w.entries.forEach(e => { if (e.id === ex.id) e.n = ex.n }))
        delete s.exWeights[ex.id]
      })
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st) {
  const u = {}
  st.routines.forEach(r => r.ex.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  st.workouts.forEach(w => w.entries.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}
function ExercisePicker({ onPick, close }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')          // '' = all, '★' = chosen, else a body part
  const [eq, setEq] = useState('')          // '' = any equipment
  const [shown, setShown] = useState(50)
  const ql = q.toLowerCase().trim()
  const all = allExercises(st)
  let base = all.filter(e => (bp === '★' ? usage[e.id] : (!bp || e.bp === bp)) && exMatches(e, ql))
  if (bp === '★') base = [...base].sort((a, b) => (usage[b.id] - usage[a.id]) || (a.n < b.n ? -1 : 1))
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base
  const chosenCount = Object.keys(usage).length
  return <>
    <h3>{t('Add exercise')}</h3>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} exercises…', all.length)} value={q} onChange={e => { setQ(e.target.value); setShown(50) }} /></div>
    <div className="chips" style={{ margin: eqOpts.length > 1 ? '10px 0 6px' : '10px 0' }}>
      {chosenCount > 0 && <button className={'chip' + (bp === '★' ? ' on' : '')} onClick={() => { setBp('★'); setEq(''); setShown(50) }}><Icon name="starFill" style={{ fontSize: 12, display: 'inline-block', marginRight: 4, verticalAlign: '-1px' }} />{t('Chosen')} ({chosenCount})</button>}
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(50) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setEq(''); setShown(50) }}>{t(b)}</button>)}
    </div>
    {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 10 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(50) }}>{t('Any equipment')}</button>
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(50) }}>{t(x)}</button>)}
    </div>}
    <div className="list">
      {bp !== '★' && <div className="item" onClick={() => customExSheet(null, ex => onPick(ex), q.trim())}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, no animation')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {/* `close` goes with it: most callers open a config sheet on top and dismiss this one
          themselves, but a caller that is done the moment you tap a row needs a way to say so. */}
      {f.slice(0, shown).map(e => <div key={e.id} className="item" onClick={() => onPick(e, close)}>
        <Thumb ex={e} /><div className="grow"><div className="tt exn">{exName(e)}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}{exNameEn(e) && <span className="nocap dim"> · {exNameEn(e)}</span>}</div></div>
        {usage[e.id] && <span className="tag acc"><Icon name="starFill" /></span>}<Icon name="plus" className="chev" />
      </div>)}
      {f.length === 0 && bp === '★' && <div className="empty">{t('Nothing chosen yet — add exercises and they’ll show up here.')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 50)}>{t('Show more')}</Button></>}
  </>
}
export const exercisePicker = onPick => ui().openSheet(close => <ExercisePicker onPick={onPick} close={close} />)

/* ============================ exercise config ============================ */
// Progression settings for one exercise (issue #17). Shown inside the config sheet because
// "how does this lift go up" belongs next to sets and reps, not in a separate screen. Left
// on "follow the routine" it inherits, so most people never touch it.
function ProgressionFields({ ex, mode, c, setC, routine, unit }) {
  const options = POLICIES_FOR[mode] || ['off']
  if (options.length < 2) return null
  const inherited = policyFor({ id: ex.id }, routine, mode)
  const active = policyFor({ ...c, id: ex.id }, routine, mode)
  const inc = c.inc > 0 ? c.inc : (mode === 'time' ? 5 : defaultIncrement(ex.id, unit))
  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow title={t('Rule')} sheetTitle={t('Progression')} value={c.prog || ''} onChange={v => setC(x => ({ ...x, prog: v || undefined }))}
        options={[{ value: '', label: t('Follow the routine ({0})', t(POLICY_NAME[inherited])) },
          ...options.map(p => ({ value: p, label: t(POLICY_NAME[p]) }))]} />
    </div>
    <div className="small dim" style={{ marginBottom: active === 'off' ? 18 : 10 }}>{t(POLICY_DESC[active])}</div>
    {active !== 'off' && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={mode === 'time' ? t('Step (seconds)') : t('Step ({0})', unit)} value={inc}
        step={mode === 'time' ? 5 : 1.25} decimal={mode !== 'time'} onChange={v => setC(x => ({ ...x, inc: v }))} />
      {active === 'double' && <Stepper label={t('Reps from')} value={c.repsMin || Math.max(1, (c.reps || 10) - 2)}
        step={1} decimal={false} onChange={v => setC(x => ({ ...x, repsMin: v }))} />}
    </div>}
  </>
}

function ExConfig({ ex, existing, onSave, onDelete, close, routine }) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id)
  const [c, setC] = useState(existing || defaultConfig(ex.id))
  // Cardio keeps its own duration+speed form; the reps/time choice (issue #16) is offered for
  // everything else, which is where the gap was — planks, hangs, wall sits, loaded carries.
  const mode = cardio ? 'cardio' : modeOf({ ...c, id: ex.id })
  // Both default from the dataset and are then whatever the config says — see isBw.
  const bw = !cardio && isBw({ ...c, id: ex.id })
  const perSide = isPerSide(c)
  // Keep whatever the other mode already had (sets, weight) and fill only what is missing.
  const setMode = m => setC(x => ({ ...defaultConfig(ex.id, m), ...x, mode: m }))
  const save = () => {
    close()
    const sets = Math.max(1, Math.round(c.sets) || (cardio ? 1 : 3))
    // Only carry progression settings that differ from the inherited default, so a plan file
    // stays readable and "follow the routine" keeps meaning exactly that.
    const prog = {}
    if (c.prog) prog.prog = c.prog
    if (c.inc > 0) prog.inc = c.inc
    // Written only when it differs from what the dataset already says, so a barbell config
    // stays exactly the shape it was before these flags existed.
    // `bodyweight` is true of a hold as much as of a set of reps; `side` is not — it counts
    // reps, and a timed hold has none. Switching an exercise to Time therefore drops it
    // rather than carrying a flag nothing downstream can read.
    const flags = {}
    if (bw !== isBodyweightEq(ex.id)) flags.bodyweight = bw
    if (cardio) onSave({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8) })
    else if (mode === 'time') onSave({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), ...flags, ...prog })
    else {
      // A unilateral target is stored even: the split has to divide, and a typed 15 would
      // otherwise plan seven reps on one side and eight on the other, every session.
      const typed = Math.max(1, Math.round(c.reps) || 10)
      const reps = perSide ? Math.ceil(typed / 2) * 2 : typed
      const out = { sets, mode: 'reps', reps, weight: Math.max(0, c.weight || 0), ...flags, ...(perSide ? { side: true } : {}), ...prog }
      if (policyFor({ ...c, id: ex.id }, routine, 'reps') === 'double') out.repsMin = Math.min(reps, Math.max(1, Math.round(c.repsMin) || Math.max(1, reps - 2)))
      // A ceiling below the working reps would tell you to add a set on day one.
      if (bw && !(out.weight > 0) && c.repsMax > 0) out.repsMax = Math.max(reps, Math.round(c.repsMax))
      onSave(out)
    }
  }
  return <>
    <h3 className="exn">{exName(ex)}</h3>
    {exNameEn(ex) && <div className="small dim" style={{ marginTop: -6, marginBottom: 8 }}>{exNameEn(ex)}</div>}
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      <span className="tag">{t(ex.tg || ex.bp)}</span><span className="tag">{t(ex.eq)}</span>
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {!cardio && <div style={{ marginBottom: 14 }}>
      <Segmented className="seg-range" value={mode} onChange={setMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: mode === 'time' ? 8 : 18 }}>
      {cardio ? <>
        <Stepper label={t('Intervals')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Minutes')} value={c.min} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />
        <Stepper label={t('Speed (km/h)')} value={c.speed} step={0.5} onChange={v => setC(x => ({ ...x, speed: v }))} />
      </> : mode === 'time' ? <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Seconds')} value={c.sec} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />
        <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
      </> : <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Reps')} value={c.reps} step={perSide ? 2 : 1} decimal={false} onChange={v => setC(x => ({ ...x, reps: v }))} />
        {/* On bodyweight work the weight stepper is the click #32 is about, so it is not here
            until there is a belt to describe — see the added-weight row below. */}
        {!bw && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />}
      </>}
    </div>
    {mode === 'time' && !bw && <div className="small dim" style={{ marginBottom: 18 }}>
      {t('A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.')}
    </div>}
    {/* ---------- bodyweight + per side (issues #31/#32/#33) ---------- */}
    {!cardio && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Bodyweight')}
        subtitle={bw ? t('No weight to enter — just log the reps.') : t('Ask for a weight on every set.')}>
        <Switch checked={bw} onChange={v => setC(x => ({ ...x, bodyweight: v, weight: v ? 0 : x.weight }))} />
      </Row>
      {mode === 'reps' && <Row icon="shuffle" iconTint="var(--blue)" title={t('Reps per side')}
        subtitle={perSide ? t('You still log the total: {0} is {1} per side.', c.reps || 0, fmtNum(sideReps(c.reps))) : t('For lunges, single-arm rows and the like.')}>
        {/* Turning it on rounds the target up to an even number, since half of an odd
            total is a rep one side does not get. */}
        <Switch checked={perSide} onChange={v => setC(x => ({ ...x, side: v || undefined, reps: v ? Math.ceil((x.reps || 0) / 2) * 2 : x.reps }))} />
      </Row>}
    </div>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
    {bw && <>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Added ({0})', st.unit)} value={c.weight || 0} step={2.5}
          onChange={v => setC(x => ({ ...x, weight: v }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {t('For dips or pull-ups with a belt. Progression then follows the weight.')}
      </div>
    </>}
    {/* The rep ceiling only means something when there is no load to add instead. */}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Top of the range')} value={c.repsMax || 0} step={1} decimal={false}
        onChange={v => setC(x => ({ ...x, repsMax: v }))} />
    </div>}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {c.repsMax > 0
        ? t('Reps climb to {0}, then a set is added and the reps start over. At {1} sets it asks you to add weight instead.', c.repsMax, MAX_BW_SETS)
        : t('Reps climb by one whenever every set was clean. Set a ceiling to add sets instead of reps forever.')}
    </div>}
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Add to routine')}</Button>
    {ex.custom && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete, routine) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} onSave={onSave} onDelete={onDelete} routine={routine} close={close} />)

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
export const glyphPicker = (current, onPick) => {
  const cur = glyphOf(current)
  return ui().openSheet(close => <>
    <h3>{t('Pick an icon')}</h3>
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => { close(); onPick(n) }} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>)
}

/* ============================ share / print / import a plan ============================ */
export const planToolsSheet = () => ui().openSheet(close => <PlanTools close={close} />)

function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const hasRoutines = (st.routines || []).some(r => r.ex && r.ex.length)

  const exportFile = async () => {
    const bundle = buildPlanBundle(st, user?.name ? t('{0}’s plan', user.name) : '')
    const json = JSON.stringify(bundle, null, 2)
    const name = FILE_PREFIX + '-plan-' + todayISO() + '.json'
    if (MOBILE) { try { await shareExport(json, name) } catch (e) { /* dismissed */ } close(); return }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    close(); toast(t('Plan file saved — send it to a friend'))
  }
  // Two kinds of JSON come through this button, because to the person holding them both are
  // "the file with my routines in it": an BodyEvolve export, which carries its own marker, and
  // a program a coach or a conversation wrote, which speaks in exercise names. Refusing the
  // second one — "this isn't an BodyEvolve plan file" — sends someone looking for a different
  // button for the same gesture, and that is where an import gets abandoned. The marker is
  // tried first: an export must not go through the name matcher, which would rebuild by name
  // what it already has by id.
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      const text = String(rd.result || '')
      try { const bundle = parsePlan(text); close(); return planImportSheet(bundle) } catch { /* not an export */ }
      try { const { bundle, report } = parseProgram(text); close(); planImportSheet(bundle, report) }
      // The program reader's complaint is the useful one: it says what the file is missing,
      // where the plan reader can only say the file is not the one file it knows.
      catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Send your routines to a friend, or put your week on paper.')}</div>
    <Button variant="primary" icon="upload" onClick={exportFile} disabled={!hasRoutines}>{t('Export plan file')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A small file a friend imports into their own BodyEvolve — routines only, none of your workouts or weigh-ins.')}</div>
    {!MOBILE && <>
      <div style={{ height: 12 }} />
      <Button variant="tinted" icon="download" onClick={() => { close(); printPlan(st, user?.name || '') }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
      <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean one-page-per-plan printout — no exercise ever splits across a page.')}</div>
    </>}
    {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first — an empty plan has nothing to share.')}</div>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
    <div style={{ height: 10 }} />
    <Button variant="ghost" icon="sparkles" onClick={() => { close(); programImportSheet() }}>{t('Paste a program')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A program written somewhere else, in ordinary exercise names.')}</div>
  </>
}

export const planImportSheet = (bundle, report, onApplied) => ui().openSheet(close => <PlanImport bundle={bundle} report={report} onApplied={onApplied} close={close} />)

function PlanImport({ bundle, report, onApplied, close }) {
  const [schedule, setSchedule] = useState(false)
  const apply = () => {
    update(s => { mergePlan(s, bundle, { schedule }); if (onApplied) onApplied(s) })
    close()
    toast(t('Added {0} routines to your plan', bundle.routineCount))
    nav('/plan')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t(bundle.routineCount === 1 ? '{0} routine' : '{0} routines', bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
      {bundle.scheduledDays > 0
        ? ' · ' + t(bundle.scheduledDays === 1 ? 'scheduled on {0} day' : 'scheduled on {0} days', bundle.scheduledDays)
        : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines — nothing you already have is changed.')}</div>
    {/* How every name resolved, before anything is written. A program from outside the app
        speaks in names, and which exercise each one became is the thing worth checking —
        an unrecognised lift is kept as your own rather than dropped, so the count that
        matters is how many need pointing at the right exercise afterwards. */}
    {report && <div className="small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      <div className="muted">{t('{0} exercises matched your library', report.matched.length)}</div>
      {report.created.length > 0 && <div style={{ color: 'var(--yellow)', marginTop: 4 }}>
        {t(report.created.length === 1
          ? '{0} name wasn’t recognised and is kept as your own exercise:'
          : '{0} names weren’t recognised and are kept as your own exercises:', report.created.length)}
        {/* With the body part it filed each one under. That guess is not cosmetic — it is
            what the muscle map colours and what the recovery model counts — and an
            unrecognised name defaults to the catch-all, so it is worth seeing before it
            silently paints the wrong half of the body. */}
        {/* With the muscles each one will actually fatigue. That is not cosmetic — it is
            what the muscle map colours and what the recovery model counts — and a name the
            catalogue does not know gets them from its body part alone, so it is worth
            seeing before it silently paints the wrong half of the body. */}
        <div style={{ marginTop: 4 }}>{report.created.map((c, i) => <div key={i} className="dim">
          {c.name} — {Object.keys(c.muscles || {}).length
            ? Object.keys(c.muscles).map(m => t(MUSCLE_NAME[m])).join(', ')
            : t(c.bp)}
        </div>)}</div>
      </div>}
      {report.warnings.map((w, i) => <div key={i} className="dim" style={{ marginTop: 4 }}>{w}</div>)}
    </div>}
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ day override / assign ============================ */
/* ============================ health data from a watch ============================ */
// What an Apple Shortcut collected from Health. The watch measures what BodyEvolve cannot —
// how long the session really lasted, what it cost, the heart, the steps, the sleep — and
// BodyEvolve measures what the watch cannot. See lib/health.js for why a payload annotates the
// logged session rather than creating one.
// The field names, as a person reads them: the mapping a header search settled on is the
// failure mode of a CSV import, and it is invisible once the rows are in.
const healthFieldLabel = () => ({
  bed: t('Bedtime'), wake: t('Wake time'), awakeMin: t('Awake during the night'),
  sleepDur: t('Sleep duration'), steps: t('Steps'), kcal: t('Active energy (whole day)'),
  sport: t('Training energy'), neat: t('Everyday movement'), free: t('Effort you logged yourself'),
  rhr: t('Resting heart rate'), weight: t('Weight'), bodyFat: t('Body fat'),
  intake: t('Calories eaten'), protein: t('Protein'), carbs: t('Carbs'), fat: t('Fat')
})

/* One labelled number, and the fields the watch form asks for.
 *
 * Both live out here on purpose. A component declared inside a render body is a different
 * component on every render, so React unmounts what it drew and mounts it again — and an
 * <input> that is remounted between keystrokes loses focus, which on a phone means the
 * keyboard drops after every digit. The list is out here for the same reason a constant is:
 * it does not change, so nothing downstream should think it did. */
const WATCH_FIELDS = [
  { k: 'sport', label: 'Session energy', unit: 'kcal' },
  { k: 'min', label: 'Session length', unit: 'min' },
  { k: 'steps', label: 'Steps', unit: '' },
  // Effort no watch called a session, estimated by you. The one field here that is not a
  // reading, so the one field the watch discount must never touch.
  { k: 'free', label: 'Effort you logged yourself', unit: 'kcal' }
]

function NumRow({ label, unit, value, onChange, decimal = false }) {
  return (
    <div className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', gap: 12 }}>
      <span style={{ fontSize: 15 }}>{label}</span>
      <span className="row" style={{ gap: 6, flex: 'none' }}>
        <NumberField className="numf" value={value} nullable decimal={decimal}
          onChange={onChange} placeholder="—" />
        <span className="dim small" style={{ width: 28 }}>{unit}</span>
      </span>
    </div>
  )
}

/**
 * The watch's figures, typed in.
 *
 * The Shortcut is the good path and it stays. But it is built inside Apple's editor, where a
 * missing action or a variable that will not drop in leaves someone with no way to record the
 * one number they came to record — and "wait until the automation works" is not an answer to
 * "what did today cost me". Four fields, no clipboard, no permissions, no automation.
 *
 * Blank means absent, not zero: a day with no steps entered is a day nobody counted, and a
 * zero would drag every average that reads it.
 */
function ManualEntry({ onDone, close, iso = todayISO() }) {
  const [v, setV] = useState({})
  const [note, setNote] = useState('')
  const set = (k, n) => setV(x => ({ ...x, [k]: n }))
  const any = WATCH_FIELDS.some(f => v[f.k] > 0)

  const save = () => {
    const p = { d: iso }
    if (v.sport > 0 || v.min > 0) {
      p.workout = {}
      if (v.sport > 0) p.workout.kcal = Math.round(v.sport)
      if (v.min > 0) p.workout.minutes = Math.round(v.min)
    }
    // Absent, never zero. A field left empty is a figure nobody measured, and a zero here
    // would be read as a day of no movement — which is what the NEAT baseline is built from.
    if (v.steps > 0) p.steps = Math.round(v.steps)
    if (v.free > 0) { p.free = Math.round(v.free); if (note.trim()) p.freeNote = note.trim() }
    let report
    update(s => { report = applyHealth(s, p) })
    onDone(report)
  }

  return <>
    {close && <h3>{t('My watch')}</h3>}
    {iso !== todayISO() && <div className="muted small" style={{ margin: '0 2px 6px' }}>{fmtDate(iso, true)}</div>}
    <div className="dim small" style={{ margin: '0 2px 6px', lineHeight: 1.45 }}>
      {t('Read them off your watch and type them in. Leave a field empty when you have nothing for it.')}
    </div>
    {WATCH_FIELDS.map(f => <div key={f.k}>
      <NumRow label={t(f.label)} unit={f.unit} decimal={f.decimal}
        value={v[f.k] ?? null} onChange={n => set(f.k, n)} />
      {f.k === 'free' && <>
        <div className="dim small" style={{ margin: '6px 2px 0', lineHeight: 1.45 }}>
          {t('Stairs, a hike, a long walk — real work your watch never called a session. Put what you think it actually cost: this figure is taken as it is, with none of the watch discount applied to it.')}
        </div>
        {v.free > 0 && <input className="numf" style={{ width: '100%', marginTop: 8, textAlign: 'left', padding: '9px 11px' }}
          value={note} maxLength={80} placeholder={t('what it was — 492 stairs, 2 h walking…')}
          onChange={e => setNote(e.target.value)} />}
      </>}
    </div>)}
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="check" disabled={!any} onClick={save}>
      {iso === todayISO() ? t('Save for today') : t('Save for {0}', fmtDate(iso, true))}
    </Button>
    {close && <><div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button></>}
  </>
}

/**
 * Typing the day's figures in is the daily gesture, so it opens from the home screen rather
 * than from the bottom of an import screen in Settings. Two taps and a number.
 */
export const watchSheet = iso => ui().openSheet(close => <WatchLog close={close} {...(iso ? { iso } : {})} />)

function WatchLog({ close, iso }) {
  const [done, setDone] = useState(null)
  if (!done) return <ManualEntry close={close} {...(iso ? { iso } : {})} onDone={setDone} />
  return <>
    <h3>{done.wrote.length ? t('Saved') : t('Nothing was saved')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{fmtDate(done.date, true)}</div>
    {done.wrote.map((w, i) => <div key={i} className="row small" style={{ gap: 7, padding: '3px 0' }}>
      <Icon name="check" style={{ color: 'var(--acc)', fontSize: 14, flexShrink: 0 }} />{w}
    </div>)}
    {done.skipped.map((w, i) => <div key={i} className="small" style={{ color: 'var(--yellow)', padding: '3px 0', lineHeight: 1.4 }}>{w}</div>)}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

function HealthImport({ close, arrived }) {
  const st = useStore(x => x.S)
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)
  const [recipe, setRecipe] = useState(false)
  const [link, setLink] = useState(null)
  const [raw, setRaw] = useState(null)
  const [spec, setSpec] = useState(false)
  const [review, setReview] = useState(null)
  const [pending, setPending] = useState(null)
  const [done, setDone] = useState(null)
  const fileRef = useRef(null)

  // A payload that arrived through a link rather than a paste — the Shortcut opened the app
  // instead of asking someone to copy something into it. It is shown and confirmed rather
  // than written on sight: a URL is whatever opened it, and this one writes to the log.
  useEffect(() => {
    if (!arrived) return
    if (arrived.empty) {
      setErr(t('That link carried no figures. Either the variables were never dropped in after each “=”, or the action above found nothing to give them — check that Shortcuts has access to Health, and that the workout you are looking for is in it.'))
      setRaw(arrived.query)
      return
    }
    try {
      if (typeof arrived === 'object') setPending(parseHealth(arrived))
      else if (arrived.includes('{')) setPending(parseHealth(arrived))
      else setReview(parseHealthCSV(arrived))
    } catch (e) { setErr(e.message) }
  }, [arrived])

  // A Shortcut hands over JSON; a tracker hands over a CSV. No CSV contains a brace, so the
  // two never have to be told apart by the person pasting.
  const run = () => {
    if (text.includes('{')) {
      let payload
      try { payload = parseHealth(text) } catch (e) { setErr(e.message); return }
      let report
      update(s => { report = applyHealth(s, payload) })
      // The outcome stays on screen rather than going out as a toast: what was skipped is
      // the part worth reading, and a toast is gone before it has been.
      setDone(report)
      return
    }
    try { setReview(parseHealthCSV(text)) } catch (e) { setErr(e.message) }
  }
  const confirmPending = () => {
    let report
    update(s => { report = applyHealth(s, pending) })
    setDone(report)
  }
  const confirmCSV = () => {
    let report
    update(s => { report = applyHealthDays(s, review.payloads) })
    const p = review.payloads
    setDone({ ...report, range: fmtDate(p[0].d, true) + ' → ' + fmtDate(p[p.length - 1].d, true) })
  }
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => { setErr(null); setText(String(rd.result || '').slice(0, 2_000_000)) }
    rd.readAsText(f)
  }
  // The two links a Shortcut's Open URL action holds. Copied from inside the app, on the
  // phone that will paste them, which is the one clipboard hop that always works.
  const copyLink = async kind => {
    const url = shortcutLink(kind)
    try { await navigator.clipboard.writeText(url); toast(t('Link copied — paste it into Open URL')) }
    catch (e) { setLink(url) }
  }
  const clearHealth = () => confirmSheet({
    title: t('Clear the imported days?'),
    message: t('Removes every day of steps, active energy, resting heart rate and imported training energy. Weigh-ins, intake, sleep and logged sessions stay. Import the file again afterwards.'),
    confirmText: t('Clear'), danger: true,
    onConfirm: () => { update(s => { s.health = [] }); toast(t('Imported days cleared')) }
  })
  const copyRecipe = async () => {
    try { await navigator.clipboard.writeText(shortcutRecipe()); toast(t('Recipe copied')) }
    catch (e) { setRecipe(true) }
  }
  const copySpec = async () => {
    try { await navigator.clipboard.writeText(historySpec()); toast(t('Format copied')) }
    catch (e) { setSpec(true) }
  }

  if (done) return <>
    <h3>{done.wrote.length ? t('Imported') : t('Nothing was imported')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{done.date ? fmtDate(done.date, true) : done.range}</div>
    {done.wrote.map((w, i) => <div key={i} className="row small" style={{ gap: 7, padding: '3px 0' }}>
      <Icon name="check" style={{ color: 'var(--acc)', fontSize: 14, flexShrink: 0 }} />{w}
    </div>)}
    {done.skipped.length > 0 && <>
      <h4 className="sec">{t('Left out')}</h4>
      {done.skipped.map((w, i) => <div key={i} className="small" style={{ color: 'var(--yellow)', padding: '3px 0', lineHeight: 1.4 }}>{w}</div>)}
    </>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>

  if (pending) {
    const label = healthFieldLabel()
    const lines = [
      pending.steps != null && [label.steps, pending.steps],
      pending.kcal != null && [label.kcal, pending.kcal + ' kcal'],
      pending.exerciseMin != null && [t('Exercise minutes'), pending.exerciseMin + ' min'],
      pending.neat != null && [label.neat, pending.neat + ' kcal'],
      pending.free != null && [label.free, pending.free + ' kcal'],
      pending.rhr != null && [label.rhr, pending.rhr],
      pending.bed && pending.wake && [t('Sleep'), pending.bed + ' → ' + pending.wake],
      pending.sleepHours != null && [t('Sleep'), fmtNum(pending.sleepHours) + ' h'],
      pending.intake != null && [label.intake, pending.intake + ' kcal'],
      pending.protein != null && [label.protein, pending.protein + ' g'],
      pending.carbs != null && [label.carbs, pending.carbs + ' g'],
      pending.fat != null && [label.fat, pending.fat + ' g'],
      pending.weight != null && [label.weight, fmtNum(pending.weight)],
      pending.bodyFat != null && [label.bodyFat, fmtNum(pending.bodyFat) + ' %'],
      pending.workout && [t('Session'), [
        pending.workout.minutes != null && pending.workout.minutes + ' min',
        pending.workout.kcal != null && pending.workout.kcal + ' kcal',
        pending.workout.km != null && fmtNum(pending.workout.km) + ' km'
      ].filter(Boolean).join(' · ')]
    ].filter(Boolean)
    return <>
      <h3>{t('Your watch sent this')}</h3>
      <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
        {t('{0}. Nothing is written until you confirm.', fmtDate(pending.d, true))}
      </div>
      {lines.map(([k, v], i) => <div key={i} className="row between small" style={{ padding: '5px 2px', borderBottom: '1px solid var(--sep)' }}>
        <span className="dim">{k}</span><b>{v}</b>
      </div>)}
      <div style={{ height: 14 }} />
      <Button variant="primary" icon="download" onClick={confirmPending}>{t('Import')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
    </>
  }

  if (review) {
    const label = healthFieldLabel()
    const days = review.payloads
    return <>
      <h3>{t('Check the columns')}</h3>
      <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
        {days.length === 1
          ? t('One day, {0}. Nothing is written until you confirm.', fmtDate(days[0].d, true))
          : t('{0} days, {1} to {2}. Nothing is written until you confirm.', days.length, fmtDate(days[0].d, true), fmtDate(days[days.length - 1].d, true))}
      </div>
      {review.matched.map((m, i) => <div key={i} className="row small" style={{ gap: 7, padding: '3px 0' }}>
        <Icon name="check" style={{ color: 'var(--acc)', fontSize: 14, flexShrink: 0 }} />
        <span className="dim">{m.column}</span>
        <Icon name="chevronRight" style={{ fontSize: 12, opacity: 0.5 }} />
        <span>{label[m.field] || m.field}</span>
      </div>)}
      {!review.matched.length && <div className="small" style={{ color: 'var(--yellow)', lineHeight: 1.4 }}>
        {t('No column was recognised beyond the date.')}
      </div>}
      {review.ignored.length > 0 && <>
        <h4 className="sec">{t('Ignored')}</h4>
        <div className="dim small" style={{ lineHeight: 1.45 }}>{review.ignored.join(' · ')}</div>
      </>}
      <div style={{ height: 14 }} />
      <Button variant="primary" icon="download" disabled={!review.matched.length} onClick={confirmCSV}>{days.length === 1 ? t('Import one day') : t('Import {0} days', days.length)}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => setReview(null)}>{t('Back')}</Button>
    </>
  }

  return <>
    <h3>{t('Import health data')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Type today’s figures in, or hand them over from a Shortcut. Session details are added to the workout you logged that day — never as a second one.')}
    </div>
    <Button variant="tinted" icon="flame" onClick={() => { close(); watchSheet() }}>{t('Type today’s figures in')}</Button>
    <h4 className="sec">{t('From a Shortcut, or a tracker export')}</h4>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.45 }}>
      {t('Paste what your Shortcut produced, or open the CSV your tracker exported.')}
    </div>
    <TextArea rows={7} value={text} placeholder={'{ "steps": 9420, "sleep_hours": 7.25 }'}
      onChange={e => { setText(e.target.value); setErr(null) }} />
    {err && <div className="small" style={{ color: 'var(--red)', margin: '8px 2px 0', lineHeight: 1.4 }}>{err}</div>}
    {/* The link exactly as it arrived. Every explanation for an empty one is a guess until
        you can read it: "?sport=&min=" is a variable that never got dropped in. */}
    {raw && <>
      <div className="dim small" style={{ margin: '10px 2px 4px' }}>{t('What the link actually carried')}</div>
      <TextArea rows={2} readOnly value={'?' + raw} style={{ fontVariantNumeric: 'tabular-nums' }} />
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="download" disabled={!text.trim()} onClick={run}>{t('Import')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Open a file')}</Button>
    <input ref={fileRef} type="file" accept=".csv,.json,.txt,text/csv,application/json,text/plain" onChange={pickFile} hidden />
    {/* Re-importing merges, which is right when two sources each know part of a day and
        wrong when the first pass filed a column under the wrong name: the bad values stay,
        and a figure read as the day's active energy goes on feeding the NEAT baseline. So
        there is a way to start the health data over without touching anything else. */}
    {(st.health || []).length > 0 && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" icon="trash" onClick={clearHealth}>
        {t('Clear the {0} imported days', (st.health || []).length)}
      </Button>
      <div className="dim small" style={{ margin: '6px 2px 0', lineHeight: 1.45 }}>
        {t('Steps, active energy, resting heart rate and any training energy filed against a day. Your weigh-ins, intake, sleep and logged sessions are untouched.')}
      </div>
    </>}
    <h4 className="sec">{t('Your history, from wherever it is written down')}</h4>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.45 }}>
      {t('Weigh-ins, intake, training energy — as far back as it goes, one row per day. Ask for it as CSV: an empty cell stays empty, which is the whole point, because a day nobody logged must not arrive as a zero.')}
    </div>
    <Button variant="ghost" icon="clipboard" onClick={copySpec}>{t('Copy the file format')}</Button>
    {spec && <TextArea rows={14} readOnly value={historySpec()} style={{ marginTop: 10 }} />}
    <h4 className="sec">{t('Whoop, Fitbit, Garmin, Oura, Polar…')}</h4>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.45 }}>
      {t('Export your data from the tracker’s own app or website and open the CSV here. BodyEvolve reads the columns it recognises — sleep, steps, energy, resting heart rate, weight — and shows you the mapping before writing anything.')}
    </div>
    <h4 className="sec">{t('Building the Shortcut')}</h4>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.45 }}>
      {t('Set the automation up once and your watch fills this in by itself — no copying, no pasting.')}
    </div>
    <Button variant="ghost" icon="link" onClick={() => copyLink('session')}>{t('Copy the end-of-workout link')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="link" onClick={() => copyLink('day')}>{t('Copy the nightly link')}</Button>
    {link && <TextArea rows={2} readOnly value={link} style={{ marginTop: 10 }} />}
    <div className="dim small" style={{ margin: '8px 2px 0', lineHeight: 1.45 }}>
      {t('Paste it into the shortcut’s Open URL action, then drop your watch’s variables right after each “=”. If the field will not take a paste, it already holds a variable — delete that first.')}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="ghost" icon="clipboard" onClick={copyRecipe}>{t('Copy the recipe')}</Button>
    {recipe && <TextArea rows={12} readOnly value={shortcutRecipe()} style={{ marginTop: 10 }} />}
  </>
}
export const healthImportSheet = arrived => ui().openSheet(close => <HealthImport close={close} arrived={arrived} />)

/* ============================ sleep ============================ */
// Filed under the day you woke up, not the day you went to bed: that is the day it affects,
// and the day the weigh-in and the intake are already filed under. See lib/body.js.
function SleepSheet({ close, iso = todayISO() }) {
  const st = S()
  const existing = sleepFor(st, iso)
  // The two times you actually know, not a duration you would have to compute. "Went to bed
  // at 23:30, got up at 07:00, was up twice" is what a person remembers; 7.25 hours is not.
  const [bed, setBed] = useState(existing?.bed || '23:00')
  const [wake, setWake] = useState(existing?.wake || '07:00')
  const [awake, setAwake] = useState(existing?.awake || 0)
  const [q, setQ] = useState(existing?.q || 0)
  const goal = st.sleepGoal
  const span = hoursBetween(bed, wake)
  const slept = sleepHours({ bed, wake, awake })
  const short = goal && slept != null ? Math.round((goal - slept) * 10) / 10 : null

  const save = () => {
    if (!validTime(bed) || !validTime(wake)) { toast(t('Enter both times as HH:MM')); return }
    update(s => { s.sleep = putSleep(s.sleep, { d: iso, bed, wake, awake, q }) })
    close()
    toast(slept != null ? t('Sleep saved') : t('Sleep cleared'))
  }
  const clear = () => {
    update(s => { s.sleep = (s.sleep || []).filter(e => e.d !== iso) })
    close(); toast(t('Sleep cleared'))
  }

  return <>
    <h3>{t('Last night')}</h3>
    <div className="muted small">{t('Logged against {0}, the day it carries you through.', fmtDate(iso, true))}</div>
    <div style={{ height: 12 }} />
    {/* Side by side, because the pair is what you read: 23:00 → 07:00. */}
    <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
      <div className="stp-w" style={{ flex: 1 }}><span className="stp-l">{t('Went to bed')}</span>
        <input className="field tm" type="time" value={bed} onChange={e => setBed(e.target.value)} /></div>
      <div className="stp-w" style={{ flex: 1 }}><span className="stp-l">{t('Got up')}</span>
        <input className="field tm" type="time" value={wake} onChange={e => setWake(e.target.value)} /></div>
    </div>
    <Stepper label={t('Awake during the night (min)')} unit="min" value={awake} step={5} decimal={false} onChange={n => setAwake(n || 0)} />
    <Stepper label={t('How it felt (1–5)')} value={q} step={1} decimal={false} onChange={n => setQ(Math.min(5, n || 0))} />

    {/* The derived figure, shown so the two times can be checked against it before saving. */}
    {span != null && <div className="small" style={{ marginTop: 10 }}>
      {slept != null
        ? <b>{t('{0} h slept', fmtNum(slept))}</b>
        : <span style={{ color: 'var(--yellow)' }}>{t('A night sits between {0} and {1} hours.', SLEEP_MIN, SLEEP_MAX)}</span>}
      {awake > 0 && slept != null && <span className="dim"> · {t('{0} h in bed', fmtNum(span))}</span>}
    </div>}
    {short != null && slept != null && <div className="small" style={{ marginTop: 6, color: short > 0 ? 'var(--orange)' : 'var(--acc)' }}>
      {short === 0 ? t('Right on your target')
        : short > 0 ? t('{0} h short of your target', fmtNum(short))
          : t('{0} h over your target', fmtNum(Math.abs(short)))}
    </div>}

    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {existing && <><div style={{ height: 8 }} />
      <Button variant="danger" onClick={clear}>{t('Delete')}</Button></>}
    <h4 className="sec">{t('Target')}</h4>
    <Stepper label={t('Hours per night')} unit="h" value={goal || 0} step={0.25}
      onChange={n => update(s => { s.sleepGoal = validSleep(n) })} />
  </>
}
export const sleepSheet = iso => ui().openSheet(close => <SleepSheet close={close} {...(iso ? { iso } : {})} />)

/* ============================ digest ============================ */
// Everything the log knows about a period, as text to hand to something that coaches you.
// Two shapes because two conversations want different things — see lib/digest.js.
//
// The text is on screen before any button is pressed. It is about to be pasted into a
// conversation, which makes it worth reading first, and a copy button that hands over
// something unseen is one you stop trusting.
function Digest({ close }) {
  const st = useStore(s => s.S)
  const [kind, setKind] = useState('daily')
  const [days, setDays] = useState(7)
  const text = kind === 'training' ? trainingDigest(st, days) : dailyDigest(st)

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast(t('Copied — paste it into your conversation')) }
    catch (e) { toast(t('Couldn’t copy — select the text and copy it by hand')) }
  }
  const share = async () => {
    try { await shareText(text, APP_NAME) } catch (e) { /* share sheet dismissed */ }
  }

  return <>
    <h3>{t('Send to your coach')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('A plain-text summary built from your log, to paste into whichever conversation follows you.')}
    </div>
    <Segmented value={kind} onChange={setKind} options={[
      { value: 'daily', label: t('Today') },
      { value: 'training', label: t('Training') }
    ]} />
    {kind === 'training' && <Segmented className="seg-range" value={days} onChange={setDays}
      options={[{ value: 7, label: '7d' }, { value: 14, label: '14d' }, { value: 30, label: '30d' }]} />}
    <TextArea readOnly rows={12} value={text} style={{ marginTop: 10, fontVariantNumeric: 'tabular-nums' }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="clipboard" onClick={copy}>{t('Copy')}</Button>
    {canShareText() && <><div style={{ height: 8 }} />
      <Button variant="tinted" icon="link" onClick={share}>{t('Share…')}</Button>
      <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>
        {t('Straight into the app holding your conversation — no copy-paste.')}
      </div></>}
  </>
}
export const digestSheet = () => ui().openSheet(close => <Digest close={close} />)

/* ============================ import a written program ============================ */
// A program that came from outside BodyEvolve — a conversation, a coach, another app — speaks
// in exercise names rather than catalogue ids. Pasting is the whole interface: the text can
// arrive fenced in ``` or wrapped in a sentence, because that is how a reply arrives, and
// asking someone to trim it first is the step where this stops being used.
function ProgramImport({ close }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)
  const [spec, setSpec] = useState(false)
  const fileRef = useRef(null)

  // A program that arrived as a file rather than a reply — a coach sends a .json, and asking
  // someone to open it in a text editor first to copy what is inside is not an interface.
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => { setErr(null); setText(String(rd.result || '').slice(0, 1_000_000)) }
    rd.readAsText(f)
  }

  const run = () => {
    try {
      const { bundle, report } = parseProgram(text)
      close()
      planImportSheet(bundle, report)
    } catch (e) { setErr(e.message) }
  }
  const copySpec = async () => {
    try { await navigator.clipboard.writeText(PROGRAM_SPEC); toast(t('Format copied — paste it into your conversation')) }
    catch (e) { setSpec(true) }   // clipboard blocked: show it to select by hand instead
  }

  return <>
    <h3>{t('Paste a program')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Paste the whole reply — BodyEvolve finds the program inside it and matches every exercise name against your library.')}
    </div>
    <TextArea rows={8} value={text} placeholder={'{ "routines": [ … ] }'}
      onChange={e => { setText(e.target.value); setErr(null) }} />
    {err && <div className="small" style={{ color: 'var(--red)', margin: '8px 2px 0', lineHeight: 1.4 }}>{err}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="download" disabled={!text.trim()} onClick={run}>{t('Read the program')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Open a file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json,.txt,text/plain" onChange={pickFile} hidden />
    <h4 className="sec">{t('Writing the program')}</h4>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.45 }}>
      {t('Hand this format to whatever writes your programs, and its answers will import straight in.')}
    </div>
    <Button variant="ghost" icon="clipboard" onClick={copySpec}>{t('Copy the format')}</Button>
    {spec && <TextArea rows={10} readOnly value={PROGRAM_SPEC} style={{ marginTop: 10 }} />}
  </>
}
export const programImportSheet = () => ui().openSheet(close => <ProgramImport close={close} />)

/* A program that arrived over MCP (api/mcp.js propose_program). It is parked in the state
   unresolved: matching names against the library needs the catalogue and the matcher, both
   of which live here, and a program rewriting someone's training deserves a look before it
   lands. Clearing it on import is what stops the same proposal reappearing forever. */
export function openPendingProgram() {
  const pending = S().pendingProgram
  if (!pending) return
  try {
    const { bundle, report } = parseProgram(pending.program)
    planImportSheet(bundle, report, s => { delete s.pendingProgram })
  } catch (e) {
    confirmSheet({
      title: t('This program couldn’t be read'),
      message: e.message,
      confirmText: t('Discard'), danger: true,
      onConfirm: () => update(s => { delete s.pendingProgram })
    })
  }
}
export const discardPendingProgram = () => confirmSheet({
  title: t('Discard this program?'),
  message: t('It was sent to your instance and will not come back unless it is sent again.'),
  confirmText: t('Discard'), danger: true,
  onConfirm: () => update(s => { delete s.pendingProgram })
})


function DayOverride({ iso, close }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyR = st.routines.find(r => r.id === weekFor(st, iso)[wd])
  const hasOvr = st.dayPlan[iso] !== undefined
  const effId = effectiveRoutineId(st, iso)
  const set = v => {
    update(s => { if (!v) delete s.dayPlan[iso]; else s.dayPlan[iso] = v })
    close()
    toast(v === '' ? t('Back to weekly plan') : v === 'rest' ? t('{0} set to rest', fmtDate(iso)) : t('{0} planned for {1}', (st.routines.find(r => r.id === v) || {}).name, fmtDate(iso)))
  }
  // The other days of this week, with what each is set to. A day already trained is left out:
  // its session is a fact, and moving what was planned for it would say nothing true.
  // Today onward only. A swap moves both sessions, and moving one onto a day that has already
  // gone puts it somewhere it can never be done — the missed-session case is the list above,
  // where you simply pick that routine for today.
  const trained = new Set((st.workouts || []).map(w => w.d))
  const swappable = weekDays(iso)
    .filter(d => d !== iso && d >= todayISO() && !trained.has(d))
    .map(d => ({ iso: d, r: effectiveRoutine(st, d) }))
    .filter(o => o.r || effectiveRoutine(st, iso))
  const doSwap = other => {
    let ok
    update(s => { ok = swapDays(s, iso, other) })
    close()
    if (ok) toast(t('{0} and {1} swapped', fmtDate(iso), fmtDate(other)))
  }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{hasOvr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {effId === r.id && <Icon name="check" className="accent" />}</div>)}
      <div className="item" onClick={() => set('rest')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{effId === null && <Icon name="check" className="accent" />}</div>
      {hasOvr && <div className="item" onClick={() => set('')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>

    {/* Trading two days, which is the commoner move and was impossible: picking a routine
        for today left today's own session still sitting on the day it came from. A swap is
        two exceptions written at once, so both ends of it move. */}
    {swappable.length > 0 && <>
      <h4 className="sec">{t('Or trade it with another day')}</h4>
      <div className="list">
        {swappable.map(o => <div key={o.iso} className="item" onClick={() => doSwap(o.iso)}>
          <span className="lrow-i" style={{ background: o.r ? undefined : 'var(--surface-3)' }}>
            <Icon name={o.r ? glyphOf(o.r.emoji) : 'moon'} /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tt">{fmtDate(o.iso, true)}</div>
            <div className="ss">{o.r ? o.r.name : t('Rest')}</div>
          </div>
          <Icon name="shuffle" className="chev" />
        </div>)}
      </div>
      <div className="dim small" style={{ margin: '8px 2px 0', lineHeight: 1.45 }}>
        {t('Only these two days move. Every other week keeps the programme it has.')}
      </div>
    </>}
  </>
}
export const dayOverrideSheet = iso => ui().openSheet(close => <DayOverride iso={iso} close={close} />)

/* ============================ training blocks ============================ */
/**
 * The blocks, and the one tap that switches between them.
 *
 * Switching is dated rather than immediate-only, because "I change on the 15th" is something
 * you know now and should be able to stop thinking about — and because a dated switch is what
 * makes the calendar's past stay put. Nothing here rewrites a day that has already happened.
 */
function BlocksSheet({ close }) {
  const st = useStore(s => s.S)
  const blocks = blocksOf(st)
  const at = activeBlock(st)
  const soon = upcoming(st)
  // mode: 'save' snapshots the running week and starts it · 'copy' clones one · 'empty'
  // starts from nothing · 'rename' just renames. All four end in a name, so they share a step.
  const [naming, setNaming] = useState(null)     // null | {mode, id?, name}
  const [when, setWhen] = useState(null)         // null | blockId awaiting a date

  const nextName = () => t('Block {0}', blocks.length + 1)
  const commitName = () => {
    const name = (naming.name || '').trim()
    if (!name) { toast(t('Give it a name')); return }
    let made = null
    update(s => {
      if (naming.mode === 'rename') { const b = blocksOf(s).find(x => x.id === naming.id); if (b) b.name = name.slice(0, 40) }
      else if (naming.mode === 'copy') made = duplicateBlock(s, naming.id, name)
      else if (naming.mode === 'empty') made = emptyBlock(s, name)
      else { made = blockFromCurrent(s, name); s.blocks = [...blocksOf(s), made]; startBlock(s, made.id) }
    })
    setNaming(null)
    if (naming.mode === 'rename') { toast(t('Renamed')); return }
    if (naming.mode === 'save') { toast(t('Block saved and running')); return }
    // A block built to be edited opens straight into the editor, because that is the next
    // thing you were going to do and it is two taps away otherwise.
    if (made) { ui().editBlock(made.id); close(); toast(t('Set up its week, then switch when you are ready')) }
  }
  const edit = id => { ui().editBlock(id); close() }

  const switchTo = (id, inDays) => {
    const from = isoOf(new Date(Date.now() + inDays * 86400000))
    update(s => { startBlock(s, id, from) })
    setWhen(null)
    toast(inDays ? t('Starts {0}', fmtDate(from, true)) : t('Running now'))
  }

  const addWeek = id => update(s => {
    const b = blocksOf(s).find(x => x.id === id)
    if (b && b.weeks.length < MAX_WEEKS) b.weeks.push({ ...b.weeks[b.weeks.length - 1] })
  })
  const dropWeek = id => update(s => {
    const b = blocksOf(s).find(x => x.id === id)
    if (b && b.weeks.length > 1) b.weeks.pop()
  })
  const del = id => confirmSheet({
    title: t('Delete this block?'),
    message: t('The routines inside it stay. Only the schedule and its switches go.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => { if (!removeBlock(s, id)) toast(t('That one is running — switch to another first')) })
  })

  if (naming) return <>
    <h3>{{ rename: t('Rename'), copy: t('Duplicate'), empty: t('New block'),
      save: t('Save this schedule as a block') }[naming.mode]}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {{ rename: '',
        copy: t('A copy you can change freely. The one you are following now is not touched.'),
        empty: t('Seven rest days to start from. Set the week up, then switch to it when you want it.'),
        save: t('Takes the week you have set up right now, exactly as it is, and starts running it under a name you can come back to.')
      }[naming.mode]}
    </div>
    <input className="numf" style={{ width: '100%', textAlign: 'left', padding: '11px 12px' }} autoFocus
      maxLength={40} value={naming.name} onChange={e => setNaming(n => ({ ...n, name: e.target.value }))} />
    <div style={{ height: 14 }} />
    <Button variant="primary" icon="check" onClick={commitName}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => setNaming(null)}>{t('Cancel')}</Button>
  </>

  if (when) {
    const b = blocksOf(st).find(x => x.id === when)
    return <>
      <h3>{t('When does {0} start?', b ? b.name : '')}</h3>
      <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
        {t('Everything before that date keeps the block it already had. Nothing that has happened moves.')}
      </div>
      {[[0, t('Today')], [1, t('Tomorrow')], [7, t('In a week')], [14, t('In two weeks')], [28, t('In four weeks')]]
        .map(([n, label]) => <div key={n} className="item" onClick={() => switchTo(when, n)}>
          <div className="grow"><div className="tt">{label}</div>
            {n > 0 && <div className="ss">{fmtDate(isoOf(new Date(Date.now() + n * 86400000)), true)}</div>}</div>
          <Icon name="chevronRight" className="chev" />
        </div>)}
      <div style={{ height: 12 }} />
      <Button variant="ghost" className="dim" onClick={() => setWhen(null)}>{t('Back')}</Button>
    </>
  }

  return <>
    <h3>{t('Blocks')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('A whole schedule under a name. Switch and every day from the switch onward follows the new one — every day before it stays exactly as it was.')}
    </div>

    {soon.length > 0 && <div className="card" style={{ padding: 12, marginBottom: 12, borderLeft: '3px solid var(--yellow)' }}>
      {soon.map(e => <div key={e.from} className="row between" style={{ gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="tt" style={{ fontSize: 15 }}>{e.block.name}</div>
          <div className="ss">{t('starts in {0} days · {1}', daysUntil(e.from), fmtDate(e.from, true))}</div>
        </div>
        <Button size="sm" variant="ghost" className="dim" onClick={() => update(s => cancelSwitch(s, e.from))}>{t('Cancel')}</Button>
      </div>)}
    </div>}

    {blocks.length ? <div className="list">
      {blocks.map(b => {
        const running = at && at.block.id === b.id
        return <div key={b.id} className="item" style={{ alignItems: 'flex-start' }}>
          <span className="lrow-i" style={{ background: running ? 'var(--acc)' : 'var(--surface-3)' }}><Icon name="calendar" /></span>
          <div className="grow" style={{ minWidth: 0 }} onClick={() => setNaming({ mode: 'rename', id: b.id, name: b.name })}>
            <div className="tt">{b.name}{running && <span className="tag acc" style={{ marginLeft: 6 }}>{t('running')}</span>}</div>
            <div className="ss">
              {b.weeks.length > 1 ? t('{0} weeks, alternating · {1} sessions', b.weeks.length, sessionsIn(b)) : t('{0} sessions a week', sessionsIn(b))}
              {running && at.from ? ' · ' + t('since {0}', fmtDate(at.from, true)) : ''}
            </div>
            {/* Icon-sized on purpose: this row lives inside a list item beside a Switch
                button, which leaves it under two hundred pixels. Three worded buttons wrapped
                onto three lines and made a two-line card four lines tall. */}
            <div style={{ display: 'flex', gap: 4, marginTop: 8, alignItems: 'center' }}>
              <Button size="xs" variant="tinted" onClick={e => { e.stopPropagation(); edit(b.id) }}>{t('Edit')}</Button>
              <Button size="xs" variant="ghost" className="dim" icon="shuffle"
                onClick={e => { e.stopPropagation(); setNaming({ mode: 'copy', id: b.id, name: b.name + ' 2' }) }}
                aria-label={t('Duplicate')} />
              <Button size="xs" variant="ghost" className="dim" disabled={b.weeks.length < 2}
                onClick={e => { e.stopPropagation(); dropWeek(b.id) }} aria-label={t('One week fewer')}>−</Button>
              <span className="dim small" style={{ minWidth: 62, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                {t('{0} wk', b.weeks.length)}
              </span>
              <Button size="xs" variant="ghost" className="dim" disabled={b.weeks.length >= MAX_WEEKS}
                onClick={e => { e.stopPropagation(); addWeek(b.id) }} aria-label={t('One week more')}>+</Button>
              {!running && <Button size="xs" variant="ghost" className="dim" icon="trash" style={{ marginLeft: 'auto' }}
                onClick={e => { e.stopPropagation(); del(b.id) }} aria-label={t('Delete')} />}
            </div>
          </div>
          {!running && <Button size="sm" variant="tinted" onClick={() => setWhen(b.id)}>{t('Switch')}</Button>}
        </div>
      })}
    </div> : <div className="empty"><div className="ico"><Icon name="calendar" /></div>{t('No blocks yet.')}</div>}

    <div style={{ height: 14 }} />
    {!at && <Button icon="plus" onClick={() => setNaming({ mode: 'save', name: nextName() })}>{t('Save this week as a block')}</Button>}
    {!at && <div style={{ height: 8 }} />}
    <Button variant={at ? undefined : 'ghost'} icon="plus" onClick={() => setNaming({ mode: 'empty', name: nextName() })}>
      {t('New block, from scratch')}
    </Button>
    <div className="dim small" style={{ margin: '8px 2px 0', lineHeight: 1.45 }}>
      {t('A block with two weeks alternates them, counting from the day you switched to it — so a block started on a Thursday changes over every seventh day from that Thursday.')}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export const blocksSheet = () => ui().openSheet(close => <BlocksSheet close={close} />)

function DayAssign({ day, weekIdx = null, blockId = null, close }) {
  const st = useStore(s => s.S)
  const cur = weekOfBlock(st, weekIdx, blockId)
  const set = v => { update(s => { setWeekDay(s, day, v, { weekIdx, blockId }) }); close() }
  return <>
    <h3>{t(DAYN[day])}</h3>
    <div className="list">
      <div className="item" onClick={() => set('')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest day')}</div></div>{!cur[day] && <Icon name="check" className="accent" />}</div>
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {cur[day] === r.id && <Icon name="check" className="accent" />}</div>)}
    </div>
  </>
}
export const dayAssignSheet = (day, weekIdx = null, blockId = null) => ui().openSheet(close => <DayAssign day={day} weekIdx={weekIdx} blockId={blockId} close={close} />)

/* ============================ workout detail ============================ */
function WorkoutDetail({ w, close }) {
  const st = useStore(s => s.S)
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {w.entries.map((e, i) => {
      const ex = EXIDX[e.id]
      return <div key={i} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        {ex && <Thumb ex={ex} />}
        <div className="grow"><div className="tt exn" style={{ fontWeight: 600 }}>{ex ? exName(ex) : (e.n || e.id)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e.target)).join('  ·  ') || t('no sets')}</div></div>
      </div>
    })}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
function Calendar({ start, close }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start) : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay = {}
  st.workouts.forEach(w => (byDay[w.d] = byDay[w.d] || []).push(w))
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter(w => w.d.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso], effId = effectiveRoutineId(st, iso), ovr = st.dayPlan[iso] !== undefined
    const dotCls = ws ? 'done' : ovr && effId ? 'ovr' : effId ? 'plan' : ''
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => {
      if (!ws) { close(); dayOverrideSheet(iso); return }
      if (ws.length === 1) { close(); workoutDetailSheet(ws[0]); return }
      close(); ui().openSheet(c2 => <><h3>{fmtDate(iso, true)}</h3><div className="list">{ws.map(w => <WorkoutRow key={w.id} w={w} onClick={() => { c2(); workoutDetailSheet(w) }} />)}</div></>)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label="Next month"><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${t(monthWs.length === 1 ? '{0} workout' : '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--label-3)' }} />{t('Planned')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Rescheduled')}</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{t('Tap a trained day for details · tap any other day to plan a session')}</div>
  </>
}
export const calendarSheet = start => ui().openSheet(close => <Calendar start={start} close={close} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const glyph = glyphOf((st.routines.find(r => r.id === w.routineId) || {}).emoji)
  return <div className="item" onClick={onClick}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{w.name}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), t('{0} sets', setsDone(w)), fmtVol(w.vol, st.unit)].join(' · ')}</div></div>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* ============================ workout lifecycle ============================ */
/**
 * Starting a workout starts the workout.
 *
 * A weigh-in used to stand in the way of every session, on the reasoning that a curve fed
 * before each one stays honest. It does not survive contact with actually training: the
 * gesture is "start", and anything between the tap and the first set is a thing to get past.
 * Weighing in is still one tap from the home screen, where it belongs — next to the curve it
 * feeds, on the day's own terms rather than the workout's.
 */
export function startFlow(routineId) {
  beginWorkout(routineId)
}

/**
 * Start a session, live or typed up afterwards.
 *
 * `opts.log` means the training already happened: no clock, no rest timer, and the day is
 * whatever day it was rather than today. Everything else — the set rows, the prescriptions,
 * the supersets, the finish summary — is the same screen, because a second entry UI would be
 * a second place for every future fix to be forgotten.
 *
 * `opts.warm` is a config for the movement the session opened with. It goes in front of the
 * routine, because that is the order it happened in and the order you will type it in.
 */
export function beginWorkout(routineId, bw, { log = false, d = todayISO(), warm = null } = {}) {
  const st = S()
  const r = routineId ? st.routines.find(x => x.id === routineId) : null
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards. `plan` is
  // kept on the entry purely so the workout can explain the number it chose.
  const entries = (r ? r.ex : []).map(cfg => {
    const plan = nextPrescription(st, cfg, r)
    return { id: cfg.id, sg: cfg.sg, target: { ...cfg }, plan, sets: applyPrescription(buildSets(st, cfg), plan) }
  })
  // No prescription on a warm-up: the progression engine reads working sets, and telling you
  // to add 2.5 kg to the bar you warmed up on is the advice it exists to avoid.
  if (warm && warm.id) entries.unshift(warmEntry(st, warm))
  update(s => {
    // The weight the session is remembered against: the last one recorded, since nothing is
    // asked for at the door any more. The summary shows it and nothing computes from it.
    const last = lastBW(st)
    s.active = { id: uid(), d: log ? d : todayISO(), start: Date.now(), routineId,
      name: r ? r.name : t('Freestyle'), bw: bw ?? (last ? last.w : null), cur: 0, entries,
      ...(log ? { log: true } : {}) }
  })
  useUI.getState().stopRest()
  nav('/workout')
}
function TopWeight({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const A = st.active
  // The workout can end underneath this sheet: finishing from the last exercise clears
  // `active`, and this re-renders before the sheet is torn down. Everything below is
  // read defensively and the sheet dismisses itself — reading A.entries straight took
  // the whole app down with it. Hooks still run unconditionally, so the bail-out has
  // to sit after every one of them.
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry && EXIDX[entry.id]
  const maxSet = entry ? Math.max(0, ...entry.sets.filter(s => s.done).map(setTop)) : 0
  const prevBest = entry ? Math.max((st.exWeights[entry.id] || {}).w || 0, bestWeightFor(st, entry.id)) : 0
  const [v, setV] = useState(entry ? (Math.max(maxSet, prevBest) || entry.target.weight || 0) : 0)
  useEffect(() => { if (!entry) close() }, [!entry])

  const units = supersetUnits(A ? A.entries : [])
  const unit = entry ? unitOf(units, entryIdx) : []
  const unitDone = !!entry && unit.every(i => A.entries[i].sets.every(s => s.done))
  const unitIdx = units.findIndex(u => u === unit)
  const isLastUnit = unitIdx === units.length - 1
  if (!entry || !ex) return null

  const commit = advance => {
    const n = Math.round((v || 0) * 10) / 10
    if (!isFinite(n) || n < 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      s.active.entries[entryIdx].topW = n
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = { w: Math.max(n, cur ? cur.w : 0), d: todayISO() }
    })
    close()
    if (advance && unitDone) {
      if (isLastUnit) workoutCompleteSheet()               // whole workout done → finish/continue prompt
      else update(s => { s.active.cur = units[unitIdx + 1][0] })
    } else toast(t('Tracked — next time starts at {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))
  }
  return <>
    <h3 className="exn row" style={{ gap: 8 }}><Icon name="checkCircle" style={{ color: 'var(--acc)' }} />{t('{0} done', exName(ex))}</h3>
    <div className="muted small">{t('Confirm the weight you worked with — your highest becomes the default next time.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {st.unit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
      <Button variant="primary" trailingIcon={isLastUnit ? null : 'chevronRight'} onClick={() => commit(true)}>{isLastUnit ? t('Save') : t('Save & next exercise')}</Button>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => commit(false)}>{t('Just close')}</Button>
    </> : <Button variant="primary" onClick={() => commit(false)}>{t('Save weight')}</Button>}
  </>
}
export const topWeightSheet = entryIdx => ui().openSheet(close => <TopWeight entryIdx={entryIdx} close={close} />)

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Every exercise done — great work. Finish up, or keep going and add another exercise.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); useUI.getState().toast(t('Keep going — tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

/* ============================ a session typed up afterwards ============================ */
/**
 * Which routine, and which day. Then the ordinary workout screen, minus the clock.
 *
 * The day comes first because it is the thing that makes this different from starting a
 * workout, and offering "today" among the choices matters: a session finished an hour ago and
 * never opened in the app is the commonest case of all.
 */
function LogPastSheet({ close }) {
  const st = useStore(s => s.S)
  const [d, setD] = useState(todayISO())
  const [warm, setWarm] = useState(null)
  const days = Array.from({ length: 8 }, (_, i) => isoOf(new Date(Date.now() - i * 86400000)))
  const taken = new Set((st.workouts || []).map(w => w.d))
  const planned = effectiveRoutine(st, d)
  const others = (st.routines || []).filter(r => !planned || r.id !== planned.id)

  const go = id => { close(); beginWorkout(id, undefined, { log: true, d, warm }) }

  return <>
    <h3>{t('Log a session you already did')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Same screen as a live session, without the clock or the rest timer — you type what you did and finish.')}
    </div>
    <h4 className="sec">{t('Which day')}</h4>
    <div className="chips">
      {days.map(x => <button key={x} className={'chip nocap' + (x === d ? ' on' : '')} onClick={() => setD(x)}>
        {x === todayISO() ? t('Today') : fmtDate(x, true)}{taken.has(x) ? ' ·' : ''}
      </button>)}
    </div>
    {taken.has(d) && <div className="small" style={{ color: 'var(--yellow)', margin: '8px 2px 0', lineHeight: 1.45 }}>
      {t('You already logged a session that day. This adds a second one.')}
    </div>}
    {/* Before the routine, because that is the order the session happened in: you warm up,
        then you lift. Picked here rather than hunted for once the lifting screen is already
        in front of you. */}
    <h4 className="sec">{t('Warm-up')}</h4>
    <div className="list">
      {warm ? <div className="item" onClick={() => setWarm(null)}>
        <span className="lrow-i" style={{ background: 'var(--yellow)' }}><Icon name="stretch" /></span>
        <div className="grow"><div className="tt">{exName(EXIDX[warm.id]) || warm.id}</div>
          <div className="ss">{t('{0} sets · tap to remove', warm.sets || 1)}</div></div>
        <Icon name="xmark" className="chev" />
      </div> : <div className="item" onClick={() =>
        exercisePicker((ex, done) => { setWarm({ ...defaultConfig(ex.id), id: ex.id }); done() })}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="stretch" /></span>
        <div className="grow"><div className="tt">{t('Add a warm-up')}</div>
          <div className="ss">{t('optional · logged first, counted in nothing')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>}
    </div>
    <h4 className="sec">{t('Which routine')}</h4>
    <div className="list">
      {planned && <div className="item" onClick={() => go(planned.id)}>
        <span className="lrow-i" style={{ background: 'var(--acc)' }}><Icon name={glyphOf(planned.emoji)} /></span>
        <div className="grow"><div className="tt">{planned.name}</div><div className="ss">{t('planned that day')} · {exCount(planned.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>}
      {others.map(r => <div key={r.id} className="item" onClick={() => go(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
      <div className="item" onClick={() => go(null)}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="shuffle" /></span>
        <div className="grow"><div className="tt">{t('Freestyle')}</div><div className="ss">{t('pick the exercises as you go')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const logPastSheet = () => ui().openSheet(close => <LogPastSheet close={close} />)

function FinishSummary({ w, prs, e1prs = [], close }) {
  const st = useStore(s => s.S)
  // The watch is in your hand and the number is on its screen. Asked ten hours later it is a
  // number nobody remembers, and the deficit for the day goes without it — which is the one
  // figure a training session actually moves.
  const [kcal, setKcal] = useState(() => (w.watch && w.watch.kcal) || 0)
  const [saved, setSaved] = useState(false)
  const warm = (w.entries || []).reduce((n, e) => n + (e.sets || []).filter(x => x.warm && x.done).length, 0)
  const saveKcal = () => {
    update(s => {
      const t = (s.workouts || []).find(x => x.id === w.id)
      if (t) t.watch = { ...(t.watch || {}), kcal: Math.round(kcal) }
    })
    setSaved(true); toast(t('{0} kcal saved on this session', fmtNum(Math.round(kcal))))
  }
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    <div className="tiles" style={{ textAlign: 'left' }}>
      {/* A session typed up afterwards has no duration, and `end - start` on two absent
          fields printed "NaN min". Its day is the useful thing there instead. */}
      <div className="tile"><div className="l">{w.end && w.start ? t('Duration') : t('Day')}</div>
        <div className="v" style={{ fontSize: '1.1rem' }}>{w.end && w.start ? fmtDur(w.end - w.start) : fmtDate(w.d, true)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{setsDone(w)}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '—'}</div></div>
    </div>
    {(prs.length > 0 || e1prs.length > 0) && <div style={{ textAlign: 'left', marginBottom: 12 }}>
      {prs.map(id => <div key={id} className="small accent exn row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} {exName(EXIDX[id]) || id}</div>)}
      {e1prs.map(p => <div key={p.id} className="small accent exn row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} {exName(EXIDX[p.id]) || p.id} · {fmtNum(p.est)} {st.unit}</div>)}
    </div>}
    {/* Only when there were any, and named rather than silently dropped: a set you ticked
        and then do not see in the count reads as a set the app lost. */}
    {warm > 0 && <div className="small dim" style={{ textAlign: 'left', marginBottom: 10 }}>
      {t(warm === 1 ? '{0} warm-up set, counted in none of the above.' : '{0} warm-up sets, counted in none of the above.', warm)}
    </div>}

    <h4 className="sec" style={{ textAlign: 'left' }}>{t('What did your watch say?')}</h4>
    <div style={{ textAlign: 'left' }}>
      <Stepper label={t('Session energy')} unit="kcal" value={kcal} step={10} decimal={false}
        onChange={n => { setKcal(n || 0); setSaved(false) }} />
      <div className="dim small" style={{ margin: '6px 2px 10px', lineHeight: 1.45 }}>
        {t('Read it off the watch now — asked tomorrow it is a number nobody remembers, and the day’s deficit goes without it. The usual discount is applied when it is counted.')}
      </div>
      {kcal > 0 && !saved && <Button size="sm" icon="check" onClick={saveKcal}>{t('Save it on this session')}</Button>}
      {saved && <div className="small accent row" style={{ gap: 5 }}><Icon name="checkCircle" style={{ fontSize: 13 }} />{t('Saved')}</div>}
    </div>

    <h4 className="sec" style={{ textAlign: 'left' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w])} body={st.body} />
      <MuscleShare load={loadOfWorkouts([w])} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); nav('/home') }}>{t('Nice!')}</Button>
  </div>
}
export function finishWorkout() {
  const A = S().active
  if (!A) return
  const done = setsDoneActive(A)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: doFinishWorkout }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: t(total - done === 1 ? '{0} set still unchecked. Finish the workout now?' : '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: doFinishWorkout }); return }
  doFinishWorkout()
}
function doFinishWorkout() {
  const st = S()
  const A = st.active
  if (!A) return
  const prs = []
  const e1prs = []
  A.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(isWorking).map(setTop))
    if (mx > 0 && mx > bestWeightFor(st, e.id)) prs.push(e.id)
    // A heavier estimate without a heavier top set is its own kind of progress —
    // same weight for more reps. Reported separately so it can't be read as a load PR.
    const rec = is1RMRecord(st, e.id, e)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  const w = {
    // A session typed up afterwards has no duration anybody measured. Left absent rather than
    // filled with how long the typing took — a wrong number is worse than a missing one.
    id: A.id, d: A.d, ...(A.log ? {} : { start: A.start, end: Date.now() }), routineId: A.routineId, name: A.name, bw: A.bw,
    // `target` (what the session prescribed) is kept alongside the sets: without it a
    // finished workout cannot say whether it hit its reps, and a timed session reads back
    // as "0 reps". It is what the progression engine works from.
    entries: A.entries.map(e => ({ id: e.id, sets: e.sets, topW: e.topW || null, target: e.target || null })).filter(e => e.sets.some(s => s.done)),
    prs
  }
  w.vol = workoutVolume(w)
  update(s => {
    w.entries.forEach(e => {
      const mx = Math.max(0, ...e.sets.filter(x => x.done).map(x => x.w || 0), e.topW || 0)
      if (mx > 0) { const cur = s.exWeights[e.id]; if (!cur || mx > cur.w) s.exWeights[e.id] = { w: mx, d: w.d } }
    })
    s.workouts.push(w)
    s.active = null
  })
  useUI.getState().stopRest()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  ui().openSheet(close => <FinishSummary w={w} prs={prs} e1prs={e1prs} close={close} />, { kind: 'center', locked: true })
}
