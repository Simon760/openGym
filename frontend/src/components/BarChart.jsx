import { useLayoutEffect, useRef, useState } from 'react'
import { fmtNum, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const W = 340   // viewBox width; the svg stretches to its container, height comes from `h`
const P = { l: 30, r: 8, t: 14, b: 20 }

/**
 * A week of stacked bars — the shape LineChart doesn't cover: a handful of discrete days
 * rather than a continuous curve, and a day can be several things stacked into one column
 * (protein, carbs and fat all counting toward the same calorie total).
 *
 * bars: [{ iso, label, segments: [{ v, color }], total?, tip? }] — a day with an empty
 * `segments` array is a day nobody logged, and is drawn as an empty outline rather than a
 * zero-height bar: a day that ate nothing and a day nobody weighed in for are different facts,
 * same as everywhere else this app reads a number. `total` is the height when the caller
 * knows it better than the sum of the segments does; `tip` replaces the tooltip's own line.
 */
export default function BarChart({ bars, h = 150, unit = '', goal = null, todayISO = null }) {
  const wrapRef = useRef(null)
  const tipRef = useRef(null)
  const [sel, setSel] = useState(null)   // index into bars, or null

  const n = bars ? bars.length : 0
  const cell = (W - P.l - P.r) / (n || 1)
  const cxOf = i => P.l + cell * (i + 0.5)

  // Same reasoning as LineChart's own tooltip: measured after layout rather than guessed at
  // a fixed offset, so it neither hangs off the chart's clipped edge nor sits under the
  // finger that just tapped it.
  useLayoutEffect(() => {
    const tip = tipRef.current, wrap = wrapRef.current
    if (sel == null || !tip || !wrap) return
    const cw = wrap.clientWidth
    const tw = tip.offsetWidth
    const M = 4
    const cx = (cxOf(sel) / W) * cw
    tip.style.left = Math.max(M, Math.min(cw - tw - M, cx - tw / 2)) + 'px'
  })

  if (!n) return <div className="empty small">{t('No data yet')}</div>
  const H = h
  const innerH = H - P.t - P.b
  const totals = bars.map(b => b.total ?? b.segments.reduce((s, x) => s + x.v, 0))
  const ymax = Math.max(...totals, goal || 0, 1) * 1.14
  const Y = v => P.t + innerH - (v / ymax) * innerH
  const barW = cell * 0.56
  const rx = Math.min(5, barW / 2)
  const pick = i => setSel(sel === i ? null : i)

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

  return (
    <div className="chart-i" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ aspectRatio: `${W}/${H}` }}>
        {gridlines}
        {goal != null && isFinite(goal) && goal > 0 && <>
          <line x1={P.l} y1={Y(goal)} x2={W - P.r} y2={Y(goal)} stroke="var(--yellow)" strokeWidth="1.6" strokeDasharray="7 4" />
          <text x={W - P.r - 2} y={Y(goal) - 5} textAnchor="end" fontSize="9.5" fontWeight="700" fill="var(--yellow)">{fmtNum(goal)}</text>
        </>}
        {bars.map((b, i) => {
          const x = cxOf(i) - barW / 2
          const isToday = todayISO && b.iso === todayISO
          if (!b.segments.length) {
            // Nothing logged: a faint empty column at the baseline, not a bar that claims a
            // day of eating nothing.
            return <rect key={b.iso} x={x} y={Y(0) - 3} width={barW} height={3} rx={rx}
              fill="none" stroke="var(--sep-op)" strokeWidth="1" strokeDasharray="2 2" />
          }
          let running = 0
          const clipId = 'bc' + i + '_' + H
          return <g key={b.iso}>
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
        {bars.map((b, i) => <text key={'l' + b.iso} x={cxOf(i)} y={H - 6} textAnchor="middle" fontSize="9.5"
          fontWeight={todayISO && b.iso === todayISO ? '700' : '400'}
          fill={todayISO && b.iso === todayISO ? 'var(--acc)' : 'var(--label-2)'}>{b.label}</text>)}
        {sel != null && <line x1={cxOf(sel)} y1={P.t} x2={cxOf(sel)} y2={H - P.b}
          stroke="var(--label-3)" strokeWidth="1" strokeDasharray="3 3" />}
        {/* What a finger actually hits: the whole column, label included, and the same for a
            day with nothing in it. A short bar — or a day nobody logged, which is exactly the
            one worth asking about — would otherwise be a target a few pixels tall. */}
        {bars.map((b, i) => <rect key={'hit' + b.iso} x={P.l + cell * i} y={0} width={cell} height={H}
          fill="transparent" onClick={() => pick(i)} style={{ cursor: 'pointer' }} />)}
      </svg>
      {sel != null && <div className="ctip" ref={tipRef}>
        {bars[sel].tip || <>
          {fmtDate(bars[sel].iso, true)}{totals[sel] > 0
            ? ' · ' + fmtNum(totals[sel]) + (unit ? ' ' + unit : '')
            : ' · ' + t('nothing logged')}
        </>}
      </div>}
    </div>
  )
}
