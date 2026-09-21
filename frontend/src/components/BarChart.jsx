import { useLayoutEffect, useRef, useState } from 'react'
import { fmtNum, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const W = 340   // viewBox width; the svg stretches to its container, height comes from `h`

/**
 * A week of stacked bars — the shape LineChart doesn't cover: a handful of discrete days
 * rather than a continuous curve, and a day can be several things stacked into one column
 * (protein, carbs and fat all counting toward the same calorie total).
 *
 * bars: [{ iso, label, segments: [{ v, color }] }] — a day with an empty `segments` array is
 * a day nobody logged, and is drawn as an empty outline rather than a zero-height bar: a day
 * that ate nothing and a day nobody weighed in for are different facts, same as everywhere
 * else this app reads a number.
 * opts: { h, unit, goal, onBarClick }
 */
export default function BarChart({ bars, h = 150, unit = '', goal = null, todayISO = null }) {
  const wrapRef = useRef(null)
  const tipRef = useRef(null)
  const [sel, setSel] = useState(null)   // index into bars, or null

  // Same reasoning as LineChart's own tooltip: measured after layout rather than guessed at
  // a fixed offset, so it neither hangs off the chart's clipped edge nor sits under the
  // finger that just tapped it.
  useLayoutEffect(() => {
    const tip = tipRef.current, wrap = wrapRef.current
    if (sel == null || !tip || !wrap) return
    const cw = wrap.clientWidth
    const tw = tip.offsetWidth
    const M = 4
    const cx = (bars[sel]._cx / W) * cw
    tip.style.left = Math.max(M, Math.min(cw - tw - M, cx - tw / 2)) + 'px'
  })

  if (!bars || !bars.length) return <div className="empty small">{t('No data yet')}</div>
  const H = h
  const P = { l: 30, r: 8, t: 14, b: 20 }
  const innerH = H - P.t - P.b
  const totals = bars.map(b => b.segments.reduce((n, s) => n + s.v, 0))
  const ymax = Math.max(...totals, goal || 0, 1) * 1.14
  const Y = v => P.t + innerH - (v / ymax) * innerH
  const n = bars.length
  const cell = (W - P.l - P.r) / n
  const barW = cell * 0.56
  const rx = Math.min(5, barW / 2)

  const gridlines = []
  {
    const raw = ymax / 3
    const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)))
    let step = 10 * pow
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) { step = m * pow; break }
    for (let v = 0; v <= ymax; v += step) {
      const y = Y(v)
      gridlines.push(<g key={'y' + v}>
        <line x1={P.l} y1={y} x2={W - P.r} y2={y} stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 4" />
        <text x={P.l - 5} y={y + 3.5} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtNum(v)}</text>
      </g>)
    }
  }

  bars.forEach((b, i) => { b._cx = P.l + cell * (i + 0.5) })

  return (
    <div className="chart-i" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ aspectRatio: `${W}/${H}` }}>
        {gridlines}
        {goal != null && isFinite(goal) && goal > 0 && <>
          <line x1={P.l} y1={Y(goal)} x2={W - P.r} y2={Y(goal)} stroke="var(--yellow)" strokeWidth="1.6" strokeDasharray="7 4" />
          <text x={W - P.r - 2} y={Y(goal) - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="var(--yellow)">{fmtNum(goal)}</text>
        </>}
        {bars.map((b, i) => {
          const cx = b._cx, x = cx - barW / 2
          const isToday = todayISO && b.iso === todayISO
          if (!b.segments.length) {
            // Nothing logged: a faint empty column at the baseline, not a bar that claims a
            // day of eating nothing.
            return <rect key={b.iso} x={x} y={Y(0) - 3} width={barW} height={3} rx={rx}
              fill="none" stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 2"
              onClick={() => setSel(sel === i ? null : i)} style={{ cursor: 'pointer' }} />
          }
          let running = 0
          const clipId = 'bc' + i + '_' + H
          return <g key={b.iso} onClick={() => setSel(sel === i ? null : i)} style={{ cursor: 'pointer' }}>
            <clipPath id={clipId}><rect x={x} y={Y(totals[i])} width={barW} height={Y(0) - Y(totals[i])} rx={rx} /></clipPath>
            <g clipPath={`url(#${clipId})`}>
              {b.segments.map((s, j) => {
                const y0 = Y(running), y1 = Y(running + s.v)
                running += s.v
                return <rect key={j} x={x} y={y1} width={barW} height={Math.max(0, y0 - y1)} fill={s.color} />
              })}
            </g>
            {isToday && <rect x={x - 1.5} y={Y(totals[i]) - 1.5} width={barW + 3} height={Y(0) - Y(totals[i]) + 3}
              rx={rx + 1.5} fill="none" stroke="var(--acc)" strokeWidth="1.4" />}
          </g>
        })}
        {bars.map((b, i) => <text key={'l' + b.iso} x={b._cx} y={H - 6} textAnchor="middle" fontSize="9.5"
          fontWeight={todayISO && b.iso === todayISO ? '700' : '400'}
          fill={todayISO && b.iso === todayISO ? 'var(--acc)' : 'var(--label-2)'}>{b.label}</text>)}
        {sel != null && <line x1={bars[sel]._cx} y1={P.t} x2={bars[sel]._cx} y2={H - P.b}
          stroke="var(--label-3)" strokeWidth="1" strokeDasharray="3 3" />}
      </svg>
      {sel != null && <div className="ctip" ref={tipRef}>
        {fmtDate(bars[sel].iso, true)}{totals[sel] > 0
          ? ' · ' + fmtNum(totals[sel]) + (unit ? ' ' + unit : '')
          : ' · ' + t('nothing logged')}
      </div>}
    </div>
  )
}
