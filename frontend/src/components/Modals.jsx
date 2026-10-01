import { createContext, useContext, useEffect, useRef } from 'react'
import { useUI } from '../store/useUI.js'
import { registerDismiss } from '../lib/dismiss.js'
import { onControl, dragBy } from '../lib/sheetdrag.js'

// Which sheet a component is drawn in, so it can say what dismissing that sheet means.
const SheetId = createContext(null)

/** Run `fn` when the sheet this is drawn in is waved away. Answer false to keep it open. */
export function useOnDismiss(fn) {
  const id = useContext(SheetId)
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => (id == null ? undefined : registerDismiss(id, () => latest.current())), [id])
}

/**
 * Waving a sheet away keeps what was typed into it, exactly as its own Save would — same
 * write, same toast, so it is never a silent guess. Tapping the dimmed page above a sheet is
 * how a phone's number pad gets put away (it has no OK key), and that tap used to throw the
 * figure away without a word.
 *
 * `form` is everything the sheet's inputs hold. While it is still what the sheet opened with,
 * dismissing only closes it: a weigh-in prefilled from yesterday is not a weigh-in today until
 * something is touched. A save that refuses its input says why and answers false, and the
 * sheet stays where it is.
 */
export function useSaveOnDismiss(form, save) {
  const opened = useRef(undefined)
  const now = JSON.stringify(form)
  if (opened.current === undefined) opened.current = now
  useOnDismiss(() => (now === opened.current ? undefined : save()))
}

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet }) {
  const { closeSheet, dismissSheet } = useUI()
  const ref = useRef(null)
  const drag = useRef({ startY: null, delta: 0, on: false })

  const onTouchStart = e => {
    const el = ref.current
    if (onControl(e.target)) {
      drag.current = { startY: null, delta: 0, on: false }
      return
    }
    drag.current = { startY: el.scrollTop <= 0 ? e.touches[0].clientY : null, delta: 0, on: false }
  }
  const onTouchMove = e => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    const by = dragBy(e.touches[0].clientY - d.startY, d.on)
    if (by === null) return          // a tap: preventDefault here would cancel it
    d.on = true
    d.delta = by
    if (d.delta > 0 && el.scrollTop <= 0) {
      e.preventDefault()
      el.style.transition = 'none'
      el.style.transform = `translateY(${d.delta}px)`
    } else d.delta = 0
  }
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    el.style.transition = 'transform .2s'
    if (d.delta > 90 && !sheet.locked) { el.style.transform = 'translateY(110%)'; setTimeout(dismiss, 180) }
    else el.style.transform = ''
    d.startY = null
    d.on = false
  }

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  const close = () => closeSheet(sheet.id)
  // A sheet that refused what was typed in it stays, so one swiped off screen comes back.
  function dismiss() {
    if (dismissSheet(sheet.id) && ref.current) ref.current.style.transform = ''
  }
  const body = <SheetId.Provider value={sheet.id}>{sheet.render(close)}</SheetId.Provider>
  if (sheet.kind === 'center') {
    return (
      <div>
        <div className="mback" onClick={() => { if (!sheet.locked) dismiss() }} />
        <div className="center">{body}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="mback" onClick={() => { if (!sheet.locked) dismiss() }} />
      <div className="sheet" ref={ref} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grab" />
        {body}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)

  // lock the page behind any open sheet (iOS-safe)
  useEffect(() => {
    if (!sheets.length) return
    const y = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      b.position = b.top = b.left = b.right = b.width = ''
      window.scrollTo(0, y)
    }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map(s => <Sheet key={s.id} sheet={s} />)}
    </div>
  )
}
