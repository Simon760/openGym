import { Component } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { APP_NAME, BUILD } from '../lib/brand.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

/**
 * Last line of defence: one bad render used to blank the whole app, with no way back —
 * a workout referencing an exercise the build doesn't know would white-screen and, since
 * the running workout is persisted, do it again on every reload.
 *
 * Sits inside #app so the tab bar stays usable; the shell keys this subtree on the route,
 * so switching tabs re-mounts it and clears the error by itself.
 *
 * It also says what broke and on which build, and copies that as a report: "it crashed" is
 * not something anyone can fix, and from a phone neither the message nor the build can be
 * seen any other way.
 */
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null, armed: false } }
  static getDerivedStateFromError(err) { return { err: err || new Error('unknown') } }
  componentDidCatch(err, info) {
    console.error(APP_NAME + ' render error:', err)
    this.where = info && info.componentStack
  }
  componentWillUnmount() { clearTimeout(this.disarm) }

  report() {
    const e = this.state.err
    return [
      `${APP_NAME} v${BUILD.v} · ${BUILD.sha} · ${BUILD.at}`,
      location.hash || '#/',
      String((e && (e.stack || e.message)) || e),
      (this.where || '').trim().split('\n').slice(0, 8).join('\n'),
      navigator.userAgent
    ].filter(Boolean).join('\n\n')
  }

  render() {
    const { err, armed } = this.state
    if (!err) return this.props.children
    const active = useStore.getState().S.active
    const toast = m => useUI.getState().toast(m)
    // On screen, a line that says what broke; the report carries the whole of it. A production
    // React error is a paragraph pointing at a URL, and only its number means anything.
    const raw = String(err.message || err)
    const react = raw.match(/^Minified React error #(\d+)/)
    const said = react ? 'React #' + react[1] : raw.length > 120 ? raw.slice(0, 119) + '…' : raw
    const copy = async () => {
      try { await navigator.clipboard.writeText(this.report()); toast(t('Report copied')) }
      catch { toast(t('Could not copy the report')) }
    }
    // Discarding throws away every set of the session running, and it used to sit 8 px under
    // Reload and act on the first tap — after a crash mid-workout, a slightly-off thumb was all
    // it took. Now it stands apart and asks for a second tap.
    const discard = () => {
      if (!armed) {
        this.setState({ armed: true })
        clearTimeout(this.disarm)
        this.disarm = setTimeout(() => this.setState({ armed: false }), 4000)
        return
      }
      useStore.getState().update(s => { s.active = null })
      location.reload()
    }
    return (
      <div className="narrow">
        <div className="empty" style={{ marginTop: '10vh' }}>
          <div className="ico"><Icon name="info" /></div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('Something went wrong')}</div>
          {t('This screen could not be drawn. Your data is safe on this device.')}
        </div>
        <div className="small dim" style={{ textAlign: 'center', margin: '-6px 0 16px', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          <code>{said}</code><br />
          v{BUILD.v} · {BUILD.sha}
        </div>
        <Button variant="primary" icon="reset" onClick={() => location.reload()}>{t('Reload BodyEvolve')}</Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" icon="clipboard" onClick={copy}>{t('Copy the report')}</Button>
        {active && <>
          <div style={{ height: 32 }} />
          <Button variant="danger" icon="trash" onClick={discard}>
            {armed ? t('Tap again to discard it') : t('Discard the running workout')}
          </Button>
        </>}
      </div>
    )
  }
}
