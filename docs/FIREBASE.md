# The account and the sync — Firebase

BodyEvolve's default web build keeps everything in the browser. This one keeps it in an
account: sign in on a second device and your training, your intake and your weight are there.

It uses two Firebase products, both on the **free Spark plan, with no card on file**:

- **Authentication** — email + password, and Google as a one-tap alternative.
- **Realtime Database** — one JSON subtree per account, in `europe-west1`.

That is the whole backend. Everything the app computes still runs on your phone; Firebase
only holds the account and the copy of the data that is not on it.

## What it does not do

**Passkeys are gone.** Firebase Authentication has no WebAuthn provider — its sign-in methods
are passwords, links, phone numbers and federated identity. Keeping passkeys would mean
running a server that implements WebAuthn and mints custom Firebase tokens, which is the
machine this was meant to remove.

**No push notifications, and no MCP connector.** Both need Cloud Functions, and Cloud
Functions are not deployable on the free plan — Firebase requires the pay-as-you-go **Blaze**
plan for them. Blaze includes a large free allowance (two million invocations a month), so the
bill would realistically be zero, but it needs a card on file. Until then the evening digest is
copied by hand, which is what it was designed for.

## Setting the project up

Once, in the [Firebase console](https://console.firebase.google.com):

**1. Sign-in methods.** *Build → Authentication → Sign-in method*:
- enable **Email/Password** (leave "Email link" off)
- enable **Google** (pick a support email — yours)

**2. The database.** *Build → Realtime Database* → create one in **`europe-west1`**, starting
in **locked mode**. Then open the **Rules** tab, paste the contents of
[`firebase/database.rules.json`](../firebase/database.rules.json), and **Publish**:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        "state": {
          ".validate": "newData.hasChildren(['_ts'])",
          "_ts": { ".validate": "newData.isNumber()" }
        }
      }
    }
  }
}
```

Read it as one sentence: **nothing is readable or writable except your own subtree, and only
while you are signed in as its owner.** The default deny at the top matters — Realtime Database
rules cascade, so anything not explicitly allowed underneath is refused. This is what actually
protects the data; it is enforced by Google's servers no matter what a client claims to be.

**3. Authorised domains.** *Authentication → Settings → Authorized domains* → add your Vercel
domain. Sign-in refuses to run on an address that is not in that list.

## Deploying

`vercel.json` already builds the Firebase variant (`npm run build:firebase`). Push and Vercel
redeploys; nothing else to configure.

The project's identifiers live in `frontend/src/lib/firebase.js`. **They are not secrets** —
they are visible in the JavaScript of every Firebase app ever shipped, and Google's guidance is
to embed them. What is a secret is the **service-account private key** (*Project settings →
Service accounts → Generate new private key*): it bypasses every rule above, and it must never
go into this repository or any other.

To point a fork at a different project, set `VITE_FB_API_KEY`, `VITE_FB_AUTH_DOMAIN`,
`VITE_FB_DB_URL`, `VITE_FB_PROJECT_ID`, `VITE_FB_STORAGE_BUCKET`, `VITE_FB_SENDER_ID` and
`VITE_FB_APP_ID` at build time.

## How sync behaves

One subtree per account: `users/<uid>/state`, holding the same object the app has always kept
in `localStorage`.

- **Signing in on a device that already has data** moves that data into the account, if the
  account has nothing newer. The rule is the one the app already used with its own server:
  whichever side carries the later `_ts` wins, unless this device has unsent changes.
- **Writes are debounced** and flushed when the tab is hidden, so backgrounding the app after a
  set does not lose it.
- **Offline**, writes fail quietly, a dirty flag is set, and the next successful write clears
  it. Nothing is lost and nothing overwrites a newer copy on the way back.
- **Signing out** pushes first, then clears the device.

"Sign out everywhere" is not offered: revoking refresh tokens takes admin credentials, which
means a server. A row that promised it and did less would be worse than its absence.

## The other builds, unchanged

| | |
| --- | --- |
| `npm run build` | the Node API in `api/` — passkeys, self-hosted, `docker compose up` |
| `npm run build:firebase` | this one, for Vercel |
| `npm run build:solo` | no backend at all, everything in the browser |
| `npm run build:mobile` | the Capacitor shells |
