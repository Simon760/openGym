import { MUSCLE_NAME, sharesOf } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'

/**
 * What a set — or a whole session — actually trains, as percentages that add to 100.
 *
 * The body map answers "is this balanced" at a glance and says nothing about how much. A
 * bench press and a lateral raise both light up the shoulders; only a number says one of
 * them is 22 % shoulders and the other 100 %. The bar carries the proportion visually and
 * the figure carries it exactly, because a 3 % sliver is invisible but still worth reading.
 *
 * <MuscleShare load={loadOfRoutine(r)} />   — a session, weighted by planned sets
 * <MuscleShare load={musclesOf(ex)} />      — one exercise, on its own terms
 */
export default function MuscleShare({ load, max = 6, className = '' }) {
  const parts = sharesOf(load)
  if (!parts.length) return null
  const shown = parts.slice(0, max)
  const rest = parts.slice(max).reduce((n, p) => n + p.pct, 0)
  return (
    <div className={'mshare ' + className}>
      {shown.map(p => (
        <div key={p.slug} className="mshare-r">
          <span className="mshare-n">{t(MUSCLE_NAME[p.slug])}</span>
          <span className="mshare-b"><i style={{ width: p.pct + '%' }} /></span>
          <span className="mshare-v">{p.pct} %</span>
        </div>
      ))}
      {rest > 0 && <div className="mshare-r dim">
        <span className="mshare-n">{t('the rest')}</span>
        <span className="mshare-b"><i style={{ width: rest + '%', opacity: 0.45 }} /></span>
        <span className="mshare-v">{rest} %</span>
      </div>}
    </div>
  )
}
