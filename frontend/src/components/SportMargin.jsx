import { useStore } from '../store/useStore.js'
import { sportMargin } from '../lib/energy.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

/**
 * What the day's training leaves to eat beyond what maintenance already counts on — "+270
 * kcal" — with the sum behind it, so the room for a bigger meal is read off the screen rather
 * than worked out from a watch figure, a discount and a budget. Shown under every place a
 * session's energy is typed, and on the day's intake card. See sportMargin in lib/energy.js.
 *
 * <SportMargin iso={d} />               the day as saved
 * <SportMargin iso={d} extra={kcal} />  with a session still being typed in
 *
 * `onSetMaintenance` turns a missing maintenance figure into a way to enter one, where a
 * session's energy has just been given and the margin is the obvious next question.
 */
export default function SportMargin({ iso, extra = 0, onSetMaintenance, style }) {
  const S = useStore(s => s.S)
  const m = sportMargin(S, iso, extra)
  if (!m) {
    const measured = extra > 0 || (S.workouts || []).some(w => w.d === iso && w.watch && w.watch.kcal > 0)
    if (!S.tdee && onSetMaintenance && measured) {
      return <button className="btn plain xs" style={{ padding: 0, color: 'var(--acc)', textAlign: 'left', ...style }} onClick={onSetMaintenance}>
        {t('Set your maintenance to see what this session leaves to eat')}
      </button>
    }
    return null
  }
  const color = m.margin > 0 ? 'var(--acc)' : m.margin === 0 ? 'var(--label-2)' : 'var(--orange)'
  const counted = m.counted - (m.free || 0)
  const parts = [
    m.raw > 0 ? (m.trim > 0
      ? t('{0} kcal measured → {1} counted ({2} % off)', fmtNum(m.raw), fmtNum(counted), Math.round(m.trim * 100))
      : t('{0} kcal of training', fmtNum(m.raw))) : null,
    m.free > 0 ? t('{0} kcal logged by hand', fmtNum(m.free)) : null,
  ].filter(Boolean)
  return <div style={style}>
    <div className="row" style={{ gap: 6, color, fontWeight: 600, alignItems: 'baseline' }}>
      <Icon name="bolt" style={{ fontSize: 14, flex: 'none', alignSelf: 'center' }} />
      <span>{m.margin > 0 ? t('+{0} kcal to eat today, thanks to training', fmtNum(m.margin))
        : m.margin === 0 ? t('Training exactly as your maintenance plans')
          : t('{0} kcal less training than your maintenance plans', fmtNum(-m.margin))}</span>
    </div>
    <div className="dim small" style={{ marginTop: 2, lineHeight: 1.4 }}>
      {parts.join(' + ') + ' − ' + t('{0} already in your maintenance', fmtNum(m.planned))}
    </div>
  </div>
}
