/**
 * Notes on a stretch of days — "another gym from 2 to 15 October: different machines and
 * resistance, loads not comparable".
 *
 * A note like that belongs to the dates, not to any one session: a fortnight elsewhere is ten
 * sessions, and the same sentence typed on each would be ten chances to forget one. Stored
 * once, it is carried into everything that leaves the app — the digests to paste into a
 * conversation, the CSV export, what the assistant reads — so a drop in the loads is read for
 * what it was and not as a regression.
 *
 * { id, from, to, label, note? } — from/to are ISO days, both included; `label` is the short
 * name a session is tagged with, `note` the sentence that explains it.
 */

const byStart = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** The periods touching [from, to], in date order. */
export const periodsBetween = (S, from, to) =>
  ((S && S.periods) || []).filter(p => p && p.from <= to && p.to >= from).sort(byStart)

/** The periods a day falls in. */
export const periodsOn = (S, iso) => periodsBetween(S, iso, iso)

/** What a note says, in one line: its label, then what it explains. */
export const periodText = p => [p.label, p.note].map(x => String(x || '').trim()).filter(Boolean).join(' — ')

/** The labels a day's sessions carry, joined: "Autre salle". Empty for a day in no period. */
export const periodTag = (S, iso) => periodsOn(S, iso).map(p => String(p.label || '').trim()).filter(Boolean).join(' · ')

/**
 * Add a period or replace the one with the same id. A range typed back to front is put the
 * right way round rather than refused; one without dates or a label is not a note at all and
 * leaves the list as it was.
 */
export function putPeriod(list, p) {
  const rest = (list || []).filter(x => x && x.id !== p.id)
  if (!p || !p.id || !isDay(p.from) || !isDay(p.to) || !String(p.label || '').trim()) return [...rest].sort(byStart)
  const [from, to] = p.from <= p.to ? [p.from, p.to] : [p.to, p.from]
  const note = String(p.note || '').trim()
  return [...rest, { id: p.id, from, to, label: String(p.label).trim(), ...(note ? { note } : {}) }].sort(byStart)
}

export const removePeriod = (list, id) => (list || []).filter(x => x && x.id !== id)
