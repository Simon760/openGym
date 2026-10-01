// What a sheet does when it is waved away — a tap on the page dimmed behind it, a swipe down —
// rather than closed with one of its own buttons.
//
// Registered from inside the sheet (useOnDismiss in components/Modals.jsx), because only the
// sheet holds what was typed into it; run by the UI store when the sheet is dismissed. Plain
// functions in a map rather than store state: a function is nothing to render from, and
// keeping it here keeps the rules testable without a page.

const handlers = new Map()

/** Say what dismissing sheet `id` means. Returns the function that takes it back. */
export function registerDismiss(id, fn) {
  handlers.set(id, fn)
  return () => { if (handlers.get(id) === fn) handlers.delete(id) }
}

/** The sheet is gone, however it went: what it registered no longer applies. */
export const forgetDismiss = id => { handlers.delete(id) }

/**
 * Run sheet `id`'s handler. True when the handler refused — answered false, having said why
 * — and the sheet should stay. A handler that throws lets the sheet go: a broken save must
 * not trap a sheet on screen with no way to close it.
 */
export function runDismiss(id) {
  const fn = handlers.get(id)
  if (!fn) return false
  try { return fn() === false } catch (e) { console.error(e); return false }
}

/** Every open sheet at once. Nothing stays when everything is being closed, so a refusal is
 *  not asked for — each one just gets its chance to keep what was typed into it. */
export function runAllDismiss() {
  const fns = [...handlers.values()]
  handlers.clear()
  fns.forEach(fn => { try { fn() } catch (e) { console.error(e) } })
}
