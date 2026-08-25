import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { payloadFromQuery } from '../lib/import-link.js'
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
    const payload = at < 0 ? null : payloadFromQuery(hash.slice(at + 1))
    // A link opens the app from wherever it was left, which may well be on a sheet. Stacking
    // this one behind that one is how a watch's figures go unnoticed.
    useUI.getState().closeAll()
    // Home first, so closing the sheet lands somewhere real rather than back on this route,
    // which would re-open it forever.
    nav('/home', { replace: true })
    healthImportSheet(payload)
  }, [])
  return null
}
