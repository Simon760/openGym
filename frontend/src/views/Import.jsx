import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { payloadFromQuery, EMPTY_LINK } from '../lib/import-link.js'
import { healthImportSheet } from '../sheets.jsx'
import { useUI } from '../store/useUI.js'

/**
 * The route a Shortcut opens. The reading of the link is in lib/import-link.js — this is only
 * the handover: take what the URL carries, hand it to the same review sheet the paste path
 * uses, and put the app back on the home screen behind it.
 */
export default function Import() {
  const nav = useNavigate()
  useEffect(() => {
    const hash = window.location.hash || ''
    const at = hash.indexOf('?')
    const query = at < 0 ? '' : hash.slice(at + 1)
    const payload = query ? payloadFromQuery(query) : null
    // A link that carried a query and no data is the one mistake this route invites: the
    // Open URL action is typed by hand, and "?sport=&min=" with the variables never dropped
    // in looks exactly like a link that worked. Say so rather than opening a blank paste box.
    const arrived = payload || (query ? EMPTY_LINK : null)
    // A link opens the app from wherever it was left, which may well be on a sheet. Stacking
    // this one behind that one is how a watch's figures go unnoticed.
    useUI.getState().closeAll()
    // Home first, so closing the sheet lands somewhere real rather than back on this route,
    // which would re-open it forever.
    nav('/home', { replace: true })
    healthImportSheet(arrived)
  }, [])
  return null
}
