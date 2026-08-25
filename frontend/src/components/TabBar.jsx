import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

/* Out here, not inside the render. A component declared in a render body is a different
 * component every time, so React throws away what it drew and builds it again — harmless
 * for a button, but the same shape cost a form its keyboard on every keystroke. */
function Tab({ on, nav, icon, to, label }) {
  return (
    <button className={on ? 'on' : ''} onClick={() => nav(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )
}

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'settings' && k === 'home')

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length) { onStart(r.id); return }
    }
    nav('/workout')
  }
  return (
    <nav id="tabbar">
      <Tab on={on('home')} nav={nav} icon="house" to="/home" label={t('Home')} />
      <Tab on={on('plan')} nav={nav} icon="calendar" to="/plan" label={t('Plan')} />
      <button className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab on={on('stats')} nav={nav} icon="chart" to="/stats" label={t('Stats')} />
      <Tab on={on('library')} nav={nav} icon="list" to="/library" label={t('Exercises')} />
    </nav>
  )
}
