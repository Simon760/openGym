import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXDB, allExercises, equipmentOf, exName, exNameEn, exMatches, inCategory, termLabel } from '../lib/exercises.js'
import { bestWeightFor, usageOf } from '../lib/history.js'
import { CategoryChips, EquipmentChips } from '../components/ExerciseFilters.jsx'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function Library() {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [shown, setShown] = useState(40)
  const ql = q.trim()
  const searching = !!ql
  // Your own first, as in the picker: what you have trained or planned, the most used first.
  const usage = usageOf(S)
  const used = e => usage.get(e.id) || 0
  const base = allExercises(S).filter(e => inCategory(e, bp) && exMatches(e, ql)).sort((a, b) => used(b) - used(a))
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base
  const rows = f.slice(0, shown)
  const mine = rows.filter(used), rest = rows.filter(e => !used(e))
  const create = <div className="item" onClick={() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim())}>
    <div className="thumb thumb-x"><Icon name="sparkles" /></div>
    <div className="grow"><div className="tt">{searching ? t('Create “{0}”', q.trim()) : t('Create your own exercise')}</div><div className="ss">{t('name + body part, no animation')}</div></div><Icon name="plus" className="chev" />
  </div>
  const row = e => {
    const best = bestWeightFor(S, e.id)
    return <div key={e.id} className="item" onClick={() => exerciseDetailSheet(e)}>
      <Thumb ex={e} />
      <div className="grow"><div className="tt exn">{exName(e)}</div><div className="ss">{termLabel(e.tg || e.bp)} · {termLabel(e.eq)}{exNameEn(e) && <span className="dim"> · {exNameEn(e)}</span>}</div></div>
      {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
      <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e) }}>{t('Plan')}</Button>
    </div>
  }

  return <>
    <div className="hdr"><div><h1>{t('Exercises')}</h1><div className="sub">{t('{0} exercises with animations', EXDB.length)}</div></div></div>
    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} /></div>
    <CategoryChips value={bp} onChange={v => { setBp(v); setEq(''); setShown(40) }} searching={searching}
      style={{ marginBottom: eqOpts.length > 1 && !searching ? 8 : 12 }} />
    <EquipmentChips options={eqOpts} value={eqOn} onChange={x => { setEq(x); setShown(40) }} searching={searching} style={{ marginBottom: 12 }} />
    {!searching && <div className="list" style={{ marginBottom: 8 }}>{create}</div>}
    {mine.length > 0 && <><h4 className="sec">{t('Your exercises')}</h4><div className="list">{mine.map(row)}</div></>}
    {rest.length > 0 && <>{mine.length > 0 && <h4 className="sec">{t('All the others')}</h4>}<div className="list">{rest.map(row)}</div></>}
    {f.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
    {f.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
    {/* What you typed, as an exercise of your own, after the matches it did not find. */}
    {searching && <div className="list" style={{ marginTop: 8 }}>{create}</div>}
  </>
}
