# Self-hosting BodyTransformation

BodyTransformation is two small containers (a web server and an API) plus a folder of your data.
This guide takes you from "just cloned it" to "using it from my phone over the internet".

## 0. The simplest deploy of all: one phone, no server

If it is only ever going to be **you, on your phone**, you do not need the backend. Every
calculation in this app runs on the client — the plan, the progression engine, the recovery
model, the energy balance, the digests. The server only ever existed to hold a profile and
move it between devices.

So there is a build for that: `npm run build:solo` produces static files that go straight in
at boot, keep everything in the browser's `localStorage`, and never call an API. There is no
sign-in screen, because there is nothing to sign in to.

### Vercel

`vercel.json` at the repo root already says what to build:

1. **vercel.com → Add New → Project**, import this repository.
2. Framework preset **Other**. Leave the build settings alone — `vercel.json` supplies them
   (`npm run build:solo`, output `frontend/dist`).
3. If your work is on a branch rather than the default one, set **Settings → Git →
   Production Branch** to that branch, or merge it first. Otherwise the first deploy builds
   the default branch and you get an app without your changes in it.
4. Deploy. Open the URL in Safari on your phone → **Share → Add to Home Screen**.

Netlify, Cloudflare Pages and GitHub Pages take the same build: `npm run build:solo`, publish
`frontend/dist`.

### What you get, and what you give up

| | |
| --- | --- |
| ✅ | Everything the app computes — plan, sessions, progression, recovery, intake, energy, digests |
| ✅ | Installable full-screen PWA, works offline; exercise animations are cached the first time you see them |
| ⚠️ | Data lives in **that browser** only. `Settings → Export a backup` regularly — it is one file. |
| ❌ | Passkey sign-in and sync across devices (needs the server) |
| ❌ | Push notifications (needs a server to hold the subscription) |
| ❌ | The MCP connector (needs the server; the digest you copy does the same job by hand) |

The exercise animations are served from jsDelivr rather than bundled — 1324 of them is more
than a static host wants to carry. They need a connection the first time; after that the
service worker has them.

**Vercel cannot host the backend**, and this is worth being clear about rather than finding
out later: its functions have an ephemeral, read-only filesystem, and this API keeps its data
in JSON files on disk. Deploy the API there and every write disappears on the next cold
start. If you want passkeys and sync, use the Docker path below on a machine with a disk.

## 1. Run it locally (5 minutes)

Requirements: [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

```bash
git clone https://github.com/DuarteSantos8/gym-app opengym
cd opengym
cp .env.example .env
docker compose pull   # prebuilt images from ghcr.io (amd64 + arm64) — or skip and build from source
docker compose up -d
```

- First start downloads the exercise images/GIFs (~140 MB) once into `app/img` and `app/gif`.
- Open **http://localhost:8080** and create a profile with a passkey.
- Rather build from source than pull prebuilt images? Skip `docker compose pull` and run
  `docker compose up -d --build` instead — no Node needed locally either way.

Check it's healthy:

```bash
docker compose ps
curl http://localhost:8080/api/health      # {"ok":true,...}
```

Logs: `docker compose logs -f`. Stop: `docker compose down`.

## 2. Understand the passkey requirement (important)

BodyTransformation signs you in with **passkeys** (WebAuthn). Browsers enforce two rules:

1. Passkeys are bound to an exact **hostname** (`RP_ID`).
2. They only work over **HTTPS** — with one exception: `http://localhost`.

So `http://localhost:8080` works on the machine running Docker, but **another device (your
phone) cannot use `http://<your-LAN-ip>:8080`** — that's neither localhost nor HTTPS, so the
passkey prompt won't appear. To use BodyTransformation from your phone you need a real HTTPS hostname.

(You can still open it over LAN in **guest mode**, which stores data only in that browser.)

## 3. Expose it over HTTPS on your own domain

Put BodyTransformation behind something that terminates TLS for a hostname you control, then point it at
the `web` container. Pick whichever you already run:

### Option A — Cloudflare Tunnel (no open ports)

1. Create a tunnel and route `gym.example.com` → `http://<docker-host>:8080`.
2. Cloudflare gives you HTTPS automatically.

### Option B — Caddy (automatic Let's Encrypt)

```caddy
gym.example.com {
    reverse_proxy localhost:8080
}
```

### Option C — Traefik / nginx / Nginx Proxy Manager

Route `gym.example.com` (HTTPS) → `web:80` (or `<docker-host>:8080`). Any reverse proxy works —
BodyTransformation only needs the browser to reach it over `https://gym.example.com`.

Then set your domain in `.env` and restart:

```bash
# .env
RP_ID=gym.example.com
ORIGIN=https://gym.example.com
WEB_PORT=8080
RP_NAME=BodyTransformation
```

```bash
docker compose up -d
```

Visit `https://gym.example.com`, create your profile, and add it to your home screen
(iOS: Share → Add to Home Screen · Android: ⋮ → Add to Home screen).

> Changing `RP_ID` later invalidates existing passkeys (they were bound to the old hostname).
> Pick your domain before people register.

## 4. Multiple users

Anyone who can reach the URL can create their own profile — each gets isolated data. That's the
default: open signup, no admin.

If you'd rather control who gets in, two optional settings in `.env` turn that around:

```bash
ADMIN_UIDS=youruserid      # comma-separated; these users get the admin dashboard
INVITE_ONLY=1              # new profiles need an invite code
```

Register your own passkey profile first, then find your id in `./data/db.json` under `users[].id`
and put it in `ADMIN_UIDS`. You'll get an **Admin dashboard** link in Settings: who's training
right now, each user's workout history and body weight, the ability to disable an account (signed
out and locked out everywhere until you re-enable it), and — with `INVITE_ONLY=1` — generating and
revoking invite codes. Existing accounts keep working when you switch invite-only on. Admin access
is gated by your passkey and enforced server-side, so it needs no separate login.

Prefer to keep the whole thing off the open internet? A VPN or an auth proxy (Authelia, Cloudflare
Access…) in front still works, and composes with the above.

## 5. Backups

Everything is in `./data`:

```bash
tar czf opengym-backup-$(date +%F).tar.gz data/
```

That archive contains all profiles, passkeys and workout history. Restore by unpacking it back
into the project folder. (Individual users can also export their own data as JSON from Settings.)

## 6. Notifications

BodyTransformation can push two kinds of alert to your phone/desktop, even when the app isn't open:
rest-timer-over, and a reminder on days you have a workout planned but haven't logged one yet.
Turn it on per-profile in **Settings → Notifications** (requires a signed-in passkey profile and
HTTPS — see section 3).

No setup needed server-side, and nothing to configure per timezone: VAPID keys are generated on
first run and saved to `./data/vapid.json`, and each user's browser reports its own timezone
automatically when they turn the reminder on — it fires at their local time, and follows them if
they travel, regardless of what timezone the server itself runs in.

**Keep screen awake** (Settings → *During a workout*) has the same transport requirement: the
Wake Lock API is only available over HTTPS or on `http://localhost`, so on a plain-LAN-IP
instance the switch shows as unsupported. Nothing to configure server-side either way, and iOS
refuses the lock while the phone is in Low Power Mode.

## 7. Updating

Running prebuilt images:

```bash
git pull                    # picks up compose/config changes
docker compose pull
docker compose up -d
```

Building from source instead:

```bash
git pull
docker compose up -d --build
```

The app shell is versioned (`?v=N`) so clients pick up changes on next load. Your `./data` and the
downloaded media are untouched.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No passkey prompt on my phone | You're on `http://` or an IP, not HTTPS. Set up a domain (section 3). |
| "verification failed" on login | `RP_ID`/`ORIGIN` don't match the URL in the address bar. Make them exact, restart. |
| Media didn't download | `docker compose logs media`. Re-run `docker compose up -d`, or run `./scripts/fetch-media.sh`. |
| Port 8080 already used | Set `WEB_PORT=9090` in `.env` (and update `ORIGIN` for local testing). |
| No "Notifications" option in Settings | Requires a signed-in profile and HTTPS (or `localhost`) — guest mode and plain HTTP over LAN can't subscribe. |
| Day reminder fires at the wrong time | Toggle it off and on in Settings so it re-detects your browser's timezone (also happens automatically on every app load — see section 6). |
| Want to reset a stuck login | Delete the cookie in your browser; sessions are just signed cookies. |
| `docker compose pull` fails with "denied" / "unauthorized" | The prebuilt images aren't published yet, or need to be, or the GHCR package is still private — build from source instead (`docker compose up -d --build`). |

## Connect a Claude conversation (MCP)

BodyTransformation can expose your log to a Claude conversation as a **custom connector**, so a
conversation that coaches you reads your real training and intake instead of what you
remember to paste — and can send programs back.

**1. Turn it on.** Generate a token, put it in `.env`, restart:

```bash
openssl rand -hex 32        # copy the output
```

```bash
# .env
MCP_TOKEN=<the value you just generated>
```

**2. Add the connector.** In claude.ai → Settings → Connectors → *Add custom connector*:

```
https://gym.example.com/api/mcp/<MCP_TOKEN>
```

Leave the OAuth fields empty. Your instance has to be reachable over HTTPS from the
internet — the same requirement passkeys already impose, so if login works from your
phone this does too.

**3. Use it.** Ask the conversation for your last two weeks, or to log what you ate.

### What the connector can do

| Tool | |
| --- | --- |
| `get_training_log` | Workouts, body weight, intake, daily activity and sleep over a window. Every exercise carries what the session prescribed beside what was actually done. It also returns `tdee`, so a day's balance is `(tdee + activity.kcal) − intake.kcal`. |
| `get_plan` | The weekly plan, and every exercise's sets, reps, weight and progression rule. |
| `log_intake` | Record a day's calories and macros. |
| `log_weight` | Record a weigh-in. |
| `log_history` | Write a run of past days in one call — the retroactive import. Each day replaces what BodyTransformation holds for that date, so re-sending a day is a correction rather than a duplicate. An omitted field is left alone; a zero would be read as a measurement. |
| `propose_program` | Send a program. It is **not** applied here: it waits in the app, where exercise names are matched against the library and the whole resolution is shown before anything is written. |

### The URL is the credential

A custom connector is configured with a URL and nothing else, so the token rides in the
path. That makes the URL a secret:

- Anyone holding it can read your entire log and write to it. Don't paste it anywhere
  you wouldn't paste a password.
- BodyTransformation's nginx doesn't log this path, but check any proxy or CDN in front of it
  doesn't either.
- To rotate: change `MCP_TOKEN` and re-add the connector.

OAuth avoids all of this and is the right answer for anything shared with other people.
This is the simplest thing that isn't "no auth at all", for your own instance.

### One caveat about writes

The app takes the server's copy when its timestamp is newer, so a connector write shows
up the next time the app syncs. If the app is holding unsynced local changes it keeps its
own copy and pushes over the write. In practice: don't log the same day from the
conversation and from the app at the same moment.
