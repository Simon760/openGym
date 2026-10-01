import { t } from '../lib/i18n.js'
import { CATEGORIES, termLabel } from '../lib/exercises.js'
import Icon from './Icon.jsx'

const xs = { fontSize: 12, display: 'inline-block', marginLeft: 5, verticalAlign: '-1px' }

/**
 * The category chips the library and the exercise picker share.
 *
 * While a search is being typed they fold away. A search that has narrowed to a few matches
 * has to show them right under the field: two rows of chips pushed those few rows down, and
 * on a phone "down" is under the keyboard. What stays is any filter still on, so it is never
 * applied unseen, with a tap to drop it.
 *
 * `extra` are chips of the caller's own, placed first — the picker's "Choisis" — given as
 * { key, label } so the folded state can name them too.
 */
export function CategoryChips({ value, onChange, searching, extra = [], style }) {
  const label = k => (extra.find(x => x.key === k) || {}).label || termLabel(k)
  if (searching) {
    if (!value) return null
    return <div className="chips" style={style}>
      <button className="chip nocap on" onClick={() => onChange('')}>{label(value)}<Icon name="xmark" style={xs} /></button>
    </div>
  }
  return <div className="chips" style={style}>
    {extra.map(x => <button key={x.key} className={'chip nocap' + (value === x.key ? ' on' : '')} onClick={() => onChange(x.key)}>{x.chip || x.label}</button>)}
    <button className={'chip nocap' + (!value ? ' on' : '')} onClick={() => onChange('')}>{t('All')}</button>
    {CATEGORIES.map(c => <button key={c.key} className={'chip nocap' + (value === c.key ? ' on' : '')} onClick={() => onChange(c.key)}>{termLabel(c.key)}</button>)}
  </div>
}

/** The equipment chips under them — folded the same way while searching. */
export function EquipmentChips({ options, value, onChange, searching, style }) {
  if (searching) {
    if (!value) return null
    return <div className="chips" style={style}>
      <button className="chip nocap on" onClick={() => onChange('')}>{termLabel(value)}<Icon name="xmark" style={xs} /></button>
    </div>
  }
  if (options.length < 2) return null
  return <div className="chips" style={style}>
    <button className={'chip nocap' + (!value ? ' on' : '')} onClick={() => onChange('')}>{t('Any equipment')}</button>
    {options.map(x => <button key={x} className={'chip nocap' + (value === x ? ' on' : '')} onClick={() => onChange(x)}>{termLabel(x)}</button>)}
  </div>
}
