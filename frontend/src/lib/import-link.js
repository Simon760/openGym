/**
 * What a watch measured, arriving as a link rather than a paste.
 *
 * Copy → switch apps → find the import screen → paste is four steps every day, and an
 * automation nobody completes is not an automation. A Shortcut can open a URL, so this route
 * is the whole handover.
 *
 * The query is plain named values and not JSON, and that is the point. Building a JSON string
 * in the Shortcuts editor means a Text action full of braces and quotes, then a URL-encode
 * action, then dropping variables between the quotes without breaking them — the step where
 * someone gives up. Named values need none of that: one Open URL action, and the watch's
 * variables dropped where the numbers go.
 *
 *   #/import?sport=612&min=47          a session: its energy, its length, its distance (km)
 *   #/import?kcal=740&steps=9420&rhr=52   the day: active energy, steps, resting heart rate
 *   #/import?bed=23:14&wake=07:02      the night, as two clock times — or sleep=7.25
 *   #/import?intake=1940&p=150&c=180&f=60      what was eaten
 *   #/import?weight=79.5&bf=22         the scale
 *   #/import?d=<json>  ·  #/import?b=<base64 json>   the same, for a Shortcut already
 *                                                    producing the JSON this app pastes
 *
 * `date` sets the day; without it the payload is today's. Everything is optional — a link
 * carrying only steps is a complete link.
 */

// query name -> the field name parseHealth reads. Session figures nest under `workout`,
// because that is where they annotate the session already logged rather than becoming one.
const DAY = {
  date: 'date', steps: 'steps', kcal: 'active_kcal', rhr: 'resting_hr',
  sleep: 'sleep_hours', bed: 'bed', wake: 'wake', awake: 'awake',
  intake: 'intake_kcal', p: 'protein', c: 'carbs', f: 'fat',
  weight: 'weight_kg', bf: 'body_fat', exmin: 'exercise_minutes'
}
const SESSION = { sport: 'kcal', min: 'minutes', km: 'distance_km', hr: 'hr_avg', type: 'type' }

/** A link that had a query but nothing in it — see views/Import.jsx. */
export const EMPTY_LINK = { empty: true }

const b64 = v => new TextDecoder().decode(Uint8Array.from(atob(v), c => c.charCodeAt(0)))

/** The query off the hash, read by hand: a "+" a Shortcut wrote is a plus sign, not a space. */
export function payloadFromQuery(query) {
  const out = {}
  const workout = {}
  for (const part of String(query || '').split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = (eq < 0 ? part : part.slice(0, eq)).trim()
    let val = eq < 0 ? '' : part.slice(eq + 1)
    if (!val) continue
    try { val = decodeURIComponent(val) } catch { /* already plain */ }
    val = val.trim()
    if (key === 'd') { try { return JSON.parse(val) } catch { return null } }
    if (key === 'b') { try { return JSON.parse(b64(val)) } catch { return null } }
    if (DAY[key]) out[DAY[key]] = val
    else if (SESSION[key]) workout[SESSION[key]] = val
  }
  if (Object.keys(workout).length) out.workout = workout
  return Object.keys(out).length ? out : null
}
