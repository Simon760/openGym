import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, api, BIO } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { FIREBASE, signInWithGoogle, signInWithPassword, signUpWithPassword, sendReset, authMessage } from '../lib/firebase.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { APP_NAME } from '../lib/brand.js'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState } = useStore()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', BIO)}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

/**
 * The account screen for a Firebase build: an email and a password, because the app has to be
 * handable to someone who does not have — or does not want to use — a Google account, and a
 * Google button for the one tap when they do.
 *
 * One form for both signing in and signing up, switched by a link rather than split across two
 * screens. Nobody arriving here is unsure which of the two they want, and the fields are the
 * same either way; two screens would only add a wrong guess to recover from.
 */
function AccountForm() {
  const { setUser, pullState } = useStore()
  const [mode, setMode] = useState('in')          // 'in' | 'up'
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const toast = m => useUI.getState().toast(m)

  // Signing in and signing up land in the same place: the store's own merge decides whether
  // this device's data moves into a fresh account or the account's data comes down.
  const land = async u => { setUser(u); await pullState(); toast(t('Welcome, {0}', u.name)) }

  const submit = async e => {
    e.preventDefault()
    if (busy) return
    setErr(null); setBusy(true)
    try {
      const u = mode === 'up'
        ? await signUpWithPassword(email, pw, name)
        : await signInWithPassword(email, pw)
      await land(u)
    } catch (ex) { setErr(t(authMessage(ex))) }
    setBusy(false)
  }

  const google = async () => {
    setErr(null); setBusy(true)
    try { await land(await signInWithGoogle()) }
    catch (ex) { if (!String(ex.code || '').includes('popup-closed')) setErr(t(authMessage(ex))) }
    setBusy(false)
  }

  const reset = async () => {
    if (!email.trim()) { setErr(t('Enter your email first, then ask for a new password.')); return }
    setErr(null)
    try { await sendReset(email); toast(t('Check your inbox — a reset link is on its way.')) }
    catch (ex) { setErr(t(authMessage(ex))) }
  }

  return <form onSubmit={submit} style={{ textAlign: 'left' }}>
    {mode === 'up' && <>
      <input className="input" placeholder={t('Your name')} maxLength={40} autoComplete="name"
        value={name} onChange={e => setName(e.target.value)} />
      <div style={{ height: 10 }} />
    </>}
    <input className="input" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
      placeholder={t('Email')} autoComplete="email" value={email}
      onChange={e => { setEmail(e.target.value); setErr(null) }} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" placeholder={t('Password')}
      autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw}
      onChange={e => { setPw(e.target.value); setErr(null) }} />
    {err && <div className="small" style={{ color: 'var(--red)', margin: '8px 2px 0', lineHeight: 1.4 }}>{err}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" type="submit" disabled={busy || !email.trim() || !pw}>
      {mode === 'up' ? t('Create my account') : t('Sign in')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" type="button" icon="person" disabled={busy} onClick={google}>
      {t('Continue with Google')}
    </Button>
    {/* Two links when signing in, one when signing up — so the row centres rather than
        leaving a lone link pinned to the left of an empty line. */}
    <div className="row small" style={{ marginTop: 14, justifyContent: mode === 'in' ? 'space-between' : 'center' }}>
      <button type="button" className="btn plain xs" style={{ padding: 0 }}
        onClick={() => { setMode(m => (m === 'in' ? 'up' : 'in')); setErr(null) }}>
        {mode === 'in' ? t('Create an account') : t('I already have an account')}
      </button>
      {mode === 'in' && <button type="button" className="btn plain xs dim" style={{ padding: 0 }} onClick={reset}>
        {t('Forgotten password')}
      </button>}
    </div>
  </form>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
  }
  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>{APP_NAME}</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the BodyEvolve server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  // Firebase build: an account in the cloud, so the data survives this browser and follows
  // you to the next device.
  if (FIREBASE) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 22 }}>{t('Your training, your intake, your weight — on every device you sign in on.')}</div>
      <AccountForm />
      <div style={{ height: 18 }} />
      <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
      <div className="dim small" style={{ marginTop: 14, lineHeight: 1.5 }}>
        {t('Without an account everything stays in this browser — and only this one.')}
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      {webauthnOK() ? <>
        <Button variant="primary" icon="person" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
        <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Create new profile')}</Button>
        <div style={{ height: 10 }} />
      </> : <div className="card small muted" style={{ textAlign: 'left' }}>{t("This browser doesn't support passkeys — you can still use BodyEvolve locally on this device.")}</div>}
      <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', BIO)}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
