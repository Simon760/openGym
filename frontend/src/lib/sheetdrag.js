// When a touch on a bottom sheet is a drag, and when it is a tap the sheet must not touch.
//
// The sheet drags down to dismiss, which means intercepting touchmove and calling
// preventDefault(). That call also cancels the click behind the gesture — so getting this
// wrong does not merely make the sheet feel odd, it makes controls stop responding. A tap on
// the calorie field opened no keyboard at all, because the sheet had eaten the tap.

/**
 * How far a finger must travel before it counts as a drag.
 *
 * A finger never lands still: a tap drifts a few pixels, and a thumb reaching up the screen
 * for a small target drifts tens. Everything below this is a tap.
 */
export const DRAG_SLOP = 14

/**
 * Does this gesture belong to a control rather than to the sheet?
 *
 * A slider being dragged, a field being tapped for its caret, a button being pressed — all of
 * them own the gesture that starts on them, and the sheet keeps out entirely. It is still
 * dragged from everywhere else: the handle, the headings, the padding between rows.
 */
export const onControl = el =>
  !!(el && el.closest && el.closest('input, textarea, select, button, [data-nodrag]'))

/**
 * How far to move the sheet, given how far the finger has moved and whether the drag has
 * already begun. null means "not a drag" — the caller must not preventDefault, or it takes
 * the tap with it.
 *
 * The slop is subtracted rather than ignored, or the sheet would jump under the finger by
 * exactly that much at the moment the drag started.
 */
export const dragBy = (moved, started) =>
  (started || moved >= DRAG_SLOP ? Math.max(0, moved - DRAG_SLOP) : null)
