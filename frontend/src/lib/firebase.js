// Firebase: the account, and the copy of your data that is not on this phone.
//
// What it replaces: the Node API this app was born with — passkeys, a JSON file on a disk you
// own, and a machine to run it on. Firebase gives the same two things (an account, a durable
// store) without the machine, and its free tier is far past what one person or a handful of
// friends will ever use.
//
// What it cost to get there: **passkeys are gone**. Firebase Authentication has no WebAuthn
// provider — its sign-in methods are passwords, links, phone numbers and federated identity —
// so a passkey login would need a server implementing WebAuthn and minting custom tokens,
// which is the machine we just removed. Google sign-in is one tap and works on every device;
// email and password is there so the app can be handed to someone without a Google account.
//
// Everything is loaded on demand. The SDK is ~200 kB and a build with no Firebase in it (the
// solo build, the mobile shells, the demo) must not carry a byte of it, so nothing here is
// imported at module scope — `load()` pulls it in the first time an account is actually used.

const ENV = import.meta.env

/**
 * The project's identifiers. Not secrets: they are visible in the JavaScript of every Firebase
 * app ever shipped, and Google's own guidance is to embed them. What actually protects the
 * data is the database rules — a user may read and write their own subtree and nothing else,
 * which the server enforces regardless of what a client claims to be.
 *
 * The real secret is the service-account private key from the Firebase console. It never
 * appears in this repository and must never be pasted into one: it bypasses every rule.
 *
 * Overridable through the environment so a fork can point at its own project without a patch.
 */
export const FIREBASE_CONFIG = {
  apiKey: ENV.VITE_FB_API_KEY || 'AIzaSyAlKvxttTSf1uLD2zKr0KSm0GpDwvLVP_E',
  authDomain: ENV.VITE_FB_AUTH_DOMAIN || 'bodyevolve-13158.firebaseapp.com',
  databaseURL: ENV.VITE_FB_DB_URL || 'https://bodyevolve-13158-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: ENV.VITE_FB_PROJECT_ID || 'bodyevolve-13158',
  storageBucket: ENV.VITE_FB_STORAGE_BUCKET || 'bodyevolve-13158.firebasestorage.app',
  messagingSenderId: ENV.VITE_FB_SENDER_ID || '1008859865262',
  appId: ENV.VITE_FB_APP_ID || '1:1008859865262:web:d0a62b7886c9b0400d8d3f'
}

/** Whether this build talks to Firebase at all. */
export const FIREBASE = ENV.VITE_FIREBASE === '1'

let mods = null
/** Load the SDK once, and hand back the pieces this app uses. */
async function load() {
  if (mods) return mods
  const [{ initializeApp, getApps }, auth, db] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/database')
  ])
  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG)
  mods = { app, auth, db, authRef: auth.getAuth(app), dbRef: db.getDatabase(app) }
  return mods
}

/* --------------------------------------------------------------------- account -- */

/** What the app needs to know about whoever is signed in. */
const shape = u => u && ({
  uid: u.uid,
  name: u.displayName || (u.email || '').split('@')[0] || 'you',
  email: u.email || null,
  verified: !!u.emailVerified,
  provider: (u.providerData && u.providerData[0] && u.providerData[0].providerId) || 'password'
})

/**
 * Call `cb` with the current account, then on every change — including the first restore from
 * persisted storage, which is why boot waits for it rather than reading a synchronous value
 * that is null for the first few hundred milliseconds of every cold start.
 */
export async function onAccount(cb) {
  const m = await load()
  return m.auth.onAuthStateChanged(m.authRef, u => cb(shape(u)))
}

export async function signInWithGoogle() {
  const m = await load()
  const provider = new m.auth.GoogleAuthProvider()
  // Popup rather than redirect, and deliberately. The redirect flow hands control to
  // firebaseapp.com and back, which needs third-party storage this app's origin does not
  // have — Safari's tracking prevention drops it and the sign-in silently returns nobody.
  // A popup is a first-party context for that domain and posts its result back. When the
  // browser blocks the popup outright, the email-and-password path is right there.
  const res = await m.auth.signInWithPopup(m.authRef, provider)
  return shape(res.user)
}

export async function signUpWithPassword(email, password, name) {
  const m = await load()
  const res = await m.auth.createUserWithEmailAndPassword(m.authRef, email.trim(), password)
  if (name && name.trim()) await m.auth.updateProfile(res.user, { displayName: name.trim() })
  return shape(m.authRef.currentUser)
}

export async function signInWithPassword(email, password) {
  const m = await load()
  const res = await m.auth.signInWithEmailAndPassword(m.authRef, email.trim(), password)
  return shape(res.user)
}

export async function sendReset(email) {
  const m = await load()
  await m.auth.sendPasswordResetEmail(m.authRef, email.trim())
}

export async function signOutAccount() {
  const m = await load()
  await m.auth.signOut(m.authRef)
}

export async function currentAccount() {
  const m = await load()
  return shape(m.authRef.currentUser)
}

/* ------------------------------------------------------------------------ data -- */

const path = uid => 'users/' + uid + '/state'

/**
 * How the state is stored. Version 1 was the state itself, as a tree of Firebase nodes, and
 * that turned out to be lossy in a way nothing warns you about: **Realtime Database cannot
 * hold an empty container**. Writing `ex: []` does not write an empty array, it deletes the
 * key — the same as writing null — so a routine with no exercises came back with no `ex`, and
 * the first `r.ex.length` took the Plan tab down behind the error boundary. Arrays are also
 * stored as objects keyed "0","1","2" and only rebuilt as arrays when those keys run
 * contiguously from zero, so a list with a hole comes back as an object and `.map` is gone.
 *
 * Both are documented behaviour, and neither can be prevented on the write side. Version 2
 * therefore stores one opaque JSON string, which no store can reshape. `_ts` stays a real
 * number beside it so boot can compare stamps without downloading the state.
 */
export const STATE_FMT = 2

/**
 * Read this account's state, or null when the account has never written one — which is what a
 * fresh sign-up looks like, and is different from an empty state.
 *
 * A version-1 tree is still read: every account that predates this carries one, and it is
 * exactly the shape hydrate() exists to repair.
 */
export async function cloudPull(uid) {
  const m = await load()
  const snap = await m.db.get(m.db.ref(m.dbRef, path(uid)))
  if (!snap.exists()) return null
  const val = snap.val()
  if (val && typeof val.json === 'string') {
    try { return JSON.parse(val.json) } catch { return null }
  }
  return val
}

/**
 * Write this account's state. Firebase refuses `undefined` anywhere in the tree, and a React
 * state object collects them the moment a field is cleared, so the whole thing goes through
 * JSON first — which drops them, exactly as the local storage path already does. Here that
 * serialisation is also what gets stored: see STATE_FMT.
 */
export async function cloudPush(uid, state) {
  const m = await load()
  const plain = JSON.parse(JSON.stringify(state))
  // The version-1 tree is written alongside the string, and deliberately. A device still
  // running a cached build reads this node the old way; handed only `{v, _ts, json}` it
  // would find no routines, no workouts and nothing else it knows, decide the account is
  // empty, and push that emptiness back over a good copy. Duplicating the state costs a few
  // hundred kilobytes against a 16 MB write limit, and buys the guarantee that no bundle
  // still in someone's cache can delete an account's history. Drop it once none can.
  await m.db.set(m.db.ref(m.dbRef, path(uid)), {
    ...plain,
    v: STATE_FMT,
    _ts: +state._ts || Date.now(),
    json: JSON.stringify(plain)
  })
}

/**
 * The timestamp on the stored copy, without downloading it. Boot uses this to decide which
 * side is newer before pulling a state it may be about to overwrite anyway.
 */
export async function cloudStamp(uid) {
  const m = await load()
  const snap = await m.db.get(m.db.ref(m.dbRef, path(uid) + '/_ts'))
  return snap.exists() ? +snap.val() || 0 : null
}

/* ---------------------------------------------------------------------- errors -- */

// Firebase's messages are written for a developer reading a console — "auth/invalid-credential",
// "Firebase: Error (auth/too-many-requests)". These are the handful a person actually meets.
const MESSAGES = {
  'auth/invalid-email': 'That email address does not look right.',
  'auth/missing-password': 'Enter a password.',
  'auth/weak-password': 'Too short — six characters at least.',
  'auth/email-already-in-use': 'There is already an account with that email. Sign in instead.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'No account with that email.',
  'auth/too-many-requests': 'Too many tries. Wait a minute and start again.',
  'auth/network-request-failed': 'No connection. Your data is still here — it will sync when you are back.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site, or use an email and password.',
  'auth/operation-not-allowed': 'That sign-in method is not switched on for this project.',
  'auth/unauthorized-domain': 'This address is not in the project’s authorised domains.',
  PERMISSION_DENIED: 'The database refused that write — check the rules are published.'
}

export const authMessage = e => {
  const code = (e && (e.code || e.message)) || ''
  for (const k of Object.keys(MESSAGES)) if (String(code).includes(k)) return MESSAGES[k]
  return (e && e.message) || 'Something went wrong.'
}
