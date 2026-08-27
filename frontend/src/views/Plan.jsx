import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet, blocksSheet } from '../sheets.jsx'
import { weekFor, weekOfBlock, activeBlock, blockById, upcoming, daysUntil, weekIndexAt } from '../lib/blocks.js'
import { todayISO, fmtDate } from '../lib/format.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  const running = activeBlock(S)
  const editingId = useUI(s => s.planBlock)
  const editBlock = useUI(s => s.editBlock)
  // The block on screen: the one being set up, if any, otherwise the one being followed.
  // Editing something you are not running is the normal way to write next month's plan, so
  // it gets a banner rather than being treated as an odd state.
  const editing = editingId ? blockById(S, editingId) : null
  const at = editing ? { block: editing, from: running && running.block.id === editing.id ? running.from : null } : running
  const away = !!(editing && (!running || running.block.id !== editing.id))
  const soon = upcoming(S)
  // A block being set up may already have a start date on it. Saying "nothing changes until
  // you switch" to someone who just scheduled the switch is the app forgetting what it was
  // told thirty seconds ago.
  const booked = away ? soon.find(e => e.blockId === editing.id) : null
  // Which of an alternating block's weeks is on screen. It opens on the one running, and can
  // be moved to set up the other before it comes round — which is the only way to build an
  // A/B block, since only one of its weeks is ever the live one.
  const [tab, setTab] = useState(null)
  const nWeeks = at ? Math.max(1, at.block.weeks.length) : 1
  const shown = tab != null && tab < nWeeks ? tab : null
  const week = weekOfBlock(S, shown, at ? at.block.id : null)
  // Which of an alternating block's weeks is the one running now — named rather than
  // implied, because "A or B this week?" is the question the whole feature exists to answer.
  const idx = at && at.from ? weekIndexAt(at.block, at.from, todayISO()) : 0
  const letters = 'ABCD'
  // When the week being edited is not the live one, say when it next comes round rather than
  // leaving someone to work it out from a cycle length and a start date.
  const nextTurn = (() => {
    if (!at || !at.from || nWeeks < 2 || shown == null || shown === idx) return null
    for (let d = 1; d <= nWeeks * 7 + 7; d++) {
      const iso = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
      if (weekIndexAt(at.block, at.from, iso) === shown) return iso
    }
    return null
  })()

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    <div className="cols"><div>
      {/* The block, above the week it produces: the week below is a view of this, and editing
          a day edits this block rather than some free-floating schedule. */}
      <div className="list" style={{ marginBottom: 4 }}>
        <div className="item" onClick={blocksSheet}>
          <span className="lrow-i" style={{ background: at ? 'var(--acc)' : 'var(--surface-3)' }}><Icon name="calendar" /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tt">{at ? at.block.name : t('Simple week')}
              {away && <span className={'tag' + (booked ? ' acc' : '')} style={{ marginLeft: 6 }}>
                {booked ? t('scheduled') : t('not running')}</span>}</div>
            <div className="ss">
              {away ? (booked
                ? t('Starts in {0} days · {1}', daysUntil(booked.from), fmtDate(booked.from, true))
                : t('Setting it up — nothing changes until you switch to it'))
                : at && at.block.weeks.length > 1
                  ? t('week {0} of {1} · alternating', letters[idx], at.block.weeks.length)
                  : at ? t('since {0}', fmtDate(at.from, true)) : t('No block — one week, always the same')}
            </div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      </div>
      {away && <div style={{ margin: '0 0 10px' }}>
        <Button size="sm" variant="ghost" icon="reset" onClick={() => editBlock(null)}>
          {running ? t('Back to {0}', running.block.name) : t('Back to the week you are following')}
        </Button>
      </div>}
      {!away && soon.length > 0 && <div className="small" style={{ color: 'var(--yellow)', margin: '0 2px 10px', lineHeight: 1.45 }}>
        {t('{0} takes over in {1} days. Everything up to then keeps this schedule.', soon[0].block.name, daysUntil(soon[0].from))}
      </div>}

      <h4 className="sec">{t('Week schedule')}</h4>
      {nWeeks > 1 && <>
        <Segmented className="seg-range" value={shown == null ? idx : shown} onChange={setTab}
          options={at.block.weeks.map((_, i) => ({ value: i, label: t('Week {0}', letters[i]) }))} />
        <div className="dim small" style={{ margin: '6px 2px 10px', lineHeight: 1.45 }}>
          {away ? t('Neither week is running yet.')
            : (shown == null ? idx : shown) === idx ? t('This is the week running now.')
              : nextTurn ? t('Not this week — it comes round {0}.', fmtDate(nextTurn, true)) : ''}
        </div>
      </>}
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === week[d])
          return <div key={d} className="item" onClick={() => dayAssignSheet(d, nWeeks > 1 ? (shown == null ? idx : shown) : null, at ? at.block.id : null)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </div></div>
  </>
}
