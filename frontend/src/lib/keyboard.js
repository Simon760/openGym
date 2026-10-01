/**
 * The on-screen keyboard, as far as a web page can see it.
 *
 * iOS does not make the page smaller for its keyboard: it draws the keyboard over the bottom of
 * the screen, and anything pinned to the bottom of the page — every sheet in this app — stays
 * where it was, underneath. A search sheet showed its field above the keyboard and the few
 * matches left under it, which is to say nowhere.
 *
 * Only the visual viewport knows. It shrinks to what is still visible, and moves down inside
 * the page when iOS pans to the field being typed in, so the gap between the bottom of what is
 * visible and the bottom of the page is what the keyboard covers. A small gap is not a keyboard
 * but a toolbar settling or a rounding: 60px is under any keyboard and over those. Zoomed in,
 * the visible part is wherever the pinch left it, and nothing should chase it.
 */
const KB_MIN = 60

export function keyboardInset(win, vv) {
  if (!vv || !(vv.height > 0) || vv.scale > 1.01) return 0
  const kb = win.innerHeight - vv.height - (vv.offsetTop || 0)
  return kb > KB_MIN ? Math.round(kb) : 0
}

/**
 * A field the sheet has just been shrunk away from comes back into it. Only one that is
 * actually cut off: a field pinned to the top of its sheet is always "near the top", and
 * scrolling for it would throw the list it filters back to its start on every keystroke.
 */
function keepFocusInView(doc) {
  const a = doc.activeElement
  const box = a && a.closest ? a.closest('.sheet') : null
  if (!box || a === box) return
  const r = a.getBoundingClientRect(), b = box.getBoundingClientRect()
  if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 12
  else if (r.top < b.top) box.scrollTop -= b.top - r.top + 12
}

/**
 * Publish the keyboard to CSS while sheets are open: --kb, the height it covers at the bottom,
 * and --vvh, the height left above it, so a sheet can sit on the keyboard instead of under it
 * (see .sheet in index.css). Nothing is set while there is no keyboard, which leaves every
 * sheet exactly as it was. Returns the function that stops watching.
 */
export function watchKeyboard(win = window, doc = document) {
  const vv = win.visualViewport
  if (!vv) return () => {}
  const st = doc.documentElement.style
  let last = ''
  const clear = () => { st.removeProperty('--kb'); st.removeProperty('--vvh'); st.removeProperty('--sheet-sab') }
  const fit = () => {
    const kb = keyboardInset(win, vv)
    const key = kb ? kb + ':' + Math.round(vv.height) : ''
    if (key === last) return
    last = key
    if (kb) {
      st.setProperty('--kb', kb + 'px')
      st.setProperty('--vvh', Math.round(vv.height) + 'px')
      // The home-indicator margin is for the bottom of the screen; on top of a keyboard it is
      // only a gap, and that space is the scarcest there is.
      st.setProperty('--sheet-sab', '0px')
    } else clear()
    keepFocusInView(doc)
  }
  fit()
  vv.addEventListener('resize', fit)
  vv.addEventListener('scroll', fit)
  return () => {
    vv.removeEventListener('resize', fit)
    vv.removeEventListener('scroll', fit)
    clear()
  }
}
