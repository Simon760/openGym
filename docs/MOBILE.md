# Building the mobile app (iOS / Android)

openGym ships in two flavors from the same codebase:

| | **Self-hosted** (this repo's default) | **Mobile app** (`VITE_MOBILE=1`) |
|---|---|---|
| Runs | in any browser, against your own server | natively on iPhone / Android (Capacitor shell) |
| Accounts | passkey sign-in, one profile per person | none — the phone *is* the account |
| Data | synced to your server, readable on desktop | stays on the device (file in the app's private storage) |
| Reminders | Web Push from your server | native local notifications, no server involved |
| Exercise media | served by your server (`img/`, `gif/`) | loaded from the jsDelivr CDN |

The mobile flavor never talks to a backend: no sign-in screen, no sync, no telemetry.
State is mirrored from `localStorage` into `opengym-state.json` in the app's private data
directory on every change (iOS is allowed to evict WebView storage under pressure — the
file mirror is the durable copy and is restored on launch). Backups go out through the
OS share sheet instead of a browser download.

## Prerequisites

- Node 20+
- **Android:** Android Studio (bundles the SDK). Java 21 for Gradle.
- **iOS:** a Mac with Xcode 15+ and CocoaPods (`brew install cocoapods`). A free Apple ID
  is enough to run the app on your own iPhone (see below); paid membership is only needed
  for App Store distribution, which openGym doesn't do.

## Build & run

```sh
cd frontend
npm install
npm run build:mobile        # VITE_MOBILE build + `cap sync` into android/ and ios/

npx cap open android        # opens Android Studio → run on emulator or device
npx cap open ios            # opens Xcode (Mac only) → set your signing team, then run
```

`npm run build:mobile` bakes the CDN media base into the bundle and copies the web build
into both native projects — re-run it after every web-code change before building natively.

> **Heads-up:** after `build:mobile`, `frontend/dist` contains the *mobile* bundle.
> Run a plain `npm run build` again before deploying `dist` to a server.

## App icons & splash screens

`frontend/resources/icon.svg` is the 1024×1024 source (the app's dumbbell glyph on the
app background). Generate all platform assets from it on a machine with the tooling:

```sh
cd frontend
npx @capacitor/assets generate --iconBackgroundColor '#0c0e12' --splashBackgroundColor '#0c0e12'
```

(If the generator won't take the SVG directly, export it to `resources/icon.png` at
1024×1024 first — any image tool can do it.)

## Distribution — deliberately no app stores

openGym's mobile app is not on the Play Store or App Store, and that's a choice: no store
accounts, no store rules, no yearly fees between you and an open-source app.

### Android — sideload the APK

The official signed APK is at **[opengym.duarte-santos.ch](https://opengym.duarte-santos.ch)**.
Android asks you to allow installs from the browser the first time — that's standard for any
app outside the Play Store.

To build and sign your own:

```sh
cd frontend && npm run build:mobile
cd android && ./gradlew assembleRelease            # → app/build/outputs/apk/release/app-release-unsigned.apk

# one-time: create a keystore. KEEP IT — updates must be signed with the same key,
# or Android refuses to install the new version over the old one.
keytool -genkeypair -keystore my.keystore -alias opengym -keyalg RSA -validity 10950

# align + sign (zipalign/apksigner ship with the Android SDK build-tools)
zipalign -f -p 4 app-release-unsigned.apk aligned.apk
apksigner sign --ks my.keystore --ks-key-alias opengym --out openGym.apk aligned.apk
```

### iPhone — what's actually possible

Apple does not allow installing apps outside the App Store, so there is no `.ipa` download
that would simply install. Your free options:

- **Self-host + PWA** (recommended): open your instance in Safari → Share → *Add to Home
  Screen*. Full-screen app, no expiry, plus sync and passkeys.
- **Xcode free signing:** open `ios/` in Xcode with a free Apple ID as the team and run it
  onto your own iPhone. Apple expires the signature after 7 days; re-run from Xcode to renew.
- **AltStore:** automates that 7-day re-signing over Wi-Fi via a Mac companion app.

### Release notes for maintainers

- Bump `versionName`/`versionCode` in `android/app/build.gradle` per release; keep them in
  step with `frontend/package.json`. `versionCode` must strictly increase or updates won't
  install over an existing APK.
- **License:** openGym is AGPL-3.0, which by itself sits badly with app-store terms of
  service. `NOTICE.md` carries an app-store exception (an additional permission under
  AGPL §7) granted by the copyright holder — relevant only if store distribution ever happens.
- The app requests notification permission only when the workout-day reminder is switched
  on, and (on Android) declares `SCHEDULE_EXACT_ALARM` so the reminder fires to the minute
  where the user allows it.

## Getting Apple Watch data in, without building an iOS app

HealthKit needs a native iOS build, which needs a Mac and Xcode — and a paid Apple Developer
membership ($99/yr) for anything beyond a provisioning profile that expires every 7 days.
There is a free path that gets you more: an **Apple Shortcut**.

Shortcuts reads Health natively (steps, active energy, sleep, workouts, heart rate) and can
be triggered *by the watch finishing a session*. No Mac, no developer account, no App Store.

**The shortcut.** Settings → Import health data → *Copy the recipe* gives you the exact
actions. In outline:

1. `Find Health Samples` · Steps · Today · Calculate Sum
2. `Find Health Samples` · Active Energy · Today · Calculate Sum
3. `Find Health Samples` · Sleep Analysis · **yesterday 18:00 → now** · Calculate Sum
4. `Find Workouts` · Sort by End Date · Latest 1
5. A `Text` action assembling them into JSON
6. `Copy to Clipboard` — or `Get Contents of URL` (POST) once your instance is online

> Never query sleep on "Today". A night starts yesterday and ends today, so the obvious
> filter cuts it in half. openGym files a night under the day you woke up, for the same
> reason — the two agree without anything having to be negotiated.

**Two ways to fire it, one shortcut:**

- **Automation → Workout → Ends.** Your watch finishes the session, your iPhone runs the
  shortcut. Nothing to remember.
- **Home Screen icon, Back Tap, or the Shortcuts app on the watch**, to force it whenever
  you want — a missed sync, or a session you trained without starting one on the watch.

**What lands where.** Steps, active energy and resting heart rate become the day's activity
figures; sleep goes to the sleep log; a weight (and body fat, if your scale reports it)
becomes a weigh-in. The workout's duration, energy and heart rate are **added to the session
you already logged in openGym that day** — never as a second session. Two records of one
training session have to stay one session, or every count in the app doubles. If nothing was
logged that day, the import says the session details had nowhere to go and keeps the rest.

Every field is optional. A shortcut that only ever sends steps is a complete shortcut.

## Whoop, Fitbit, Garmin, Oura, Polar — the CSV they already owe you

The same sheet takes a **CSV export** from any tracker: *Import health data → Open a file*.

None of these vendors is reachable live without money or an approval queue. Every one of
them gates its API behind OAuth 2.0 and a registered developer application with a redirect
URI — which needs a deployed instance and a per-vendor review. Oura has stopped issuing
personal access tokens outright. Google Fit is being retired in favour of Health Connect,
which is Android-native and not a web API at all. A file you already have the right to
export works today, everywhere, for nothing.

Where the export lives:

| Tracker | Export |
| --- | --- |
| Whoop | app.whoop.com → Settings → Data Export → the sleep and physiological cycles CSVs |
| Fitbit | fitbit.com → Settings → Data Export (or Google Takeout → Fitbit) |
| Garmin | garmin.com → Account → Export Your Data |
| Oura | cloud.ouraring.com → Trends → download CSV |
| Polar | flow.polar.com → Settings → Account → Export |
| Withings, Samsung, Amazfit… | all offer a CSV or a Takeout archive with one inside |

**How the columns are read.** There is no per-vendor parser to go stale. The header is
matched loosely — `Sleep onset`, `Bedtime start`, `Sleep start` all mean the same thing —
against the handful of things openGym can store: the two sleep times, time awake, sleep
duration, steps, energy burned, resting heart rate, weight, body fat. A duration is read as
minutes or hours according to what the header says, and where it says nothing, by size:
nobody sleeps four hundred hours.

**The mapping is shown before anything is written.** A header matched to the wrong field is
the failure mode of an import like this, and it is invisible once the rows are in. So the
sheet lists what it matched, what it ignored, and how many days it found, and waits.

Rows land exactly as a Shortcut payload does — one day at a time, session figures onto the
session already logged, never as a second one. Re-importing a file that overlaps one you
already imported replaces those days rather than stacking them.

## Bringing a history in

The same sheet takes a history file: *Import health data → Copy the file format*, hand that
to whatever holds your history — a spreadsheet, a notes app, a conversation — and open the
CSV it gives back.

CSV, not JSON, and for one reason: an empty cell stays empty. A day nobody weighed themselves
on has to arrive as *nothing*, not as a zero, or the weight curve grows a hole at the axis and
every average that reads it is wrong. JSON invites the same mistake with `0` and `null`, and
a long hand-written one usually arrives with a trailing comma in it.

```
Date,Weight,Body fat,Intake kcal,Protein,Carbs,Fat,Sport kcal,Steps,Bedtime,Wake time
2026-05-04,82.4,22.4,2180,150,210,68,340,7420,23:10,06:55
2026-05-05,,,2050,148,,,,6100,,
```

Every column is optional except the date — `Date,Weight` alone is a complete file. Headers do
not have to match exactly: French names work, so do the usual tracker exports, and the mapping
is shown before anything is written.

Rows land day by day, replacing what openGym holds for that date rather than adding to it, so
re-importing a corrected file is a correction and not a duplicate. Intake merges: a file
carrying only calories will not wipe macros already logged for that day.

## Maintenance, and the deficit

Set it in *Stats → Energy*, or from the day's balance on the home screen. It is entered as
its parts, because that is how it is arrived at — and because a single number hides which
part was wrong when the total turns out to be:

| | |
| --- | --- |
| **BMR** | what the body spends doing nothing at all |
| **NEAT** | walking, standing, fidgeting — everything that is not a session |
| **Other** | digestion, the cold, anything else you count separately |
| **Sport already included** | the training this total already budgets for |

That last row is what changes the arithmetic. The total is what a day costs **with the
planned session in it**, so a day trained as planned sits exactly at maintenance and only
the difference moves the balance:

```
deficit = (total + (sport done − sport planned)) − intake
```

Train as planned and the sport term is zero. Skip the session and it goes negative — which
is correct, and is the reading nothing else gives you: the day cost less than the budget
assumed, so the deficit is smaller than the food alone suggests.

### The watch reads high

Consumer wrist devices are good at heart rate and poor at energy: validation work puts their
heart-rate error in the low single digits of a percent and their energy error in the twenties
to forties, and almost always high. So **28 % of the watch's active-energy figure is thrown
away by default**, adjustable in the same sheet, and set to zero if you want the raw number.

It is a deliberately blunt instrument. The point is not to be exact — it is to stop a cut
being planned around four hundred calories that were never burned. What the watch said is
kept beside what was counted everywhere the figure appears, so the discount is always
checkable rather than something the app did quietly.

### Reading it back off your own history

You do not have to guess maintenance for long. Once there are four weigh-ins across three
weeks and intake logged on at least 60 % of the days, the app reads it off your own curve:

```
expenditure = mean intake + (weight lost × 7 700) / days
maintenance = expenditure − mean sport done + sport planned
```

The last step is what makes it comparable to what you typed: the curve knows what the days
actually cost, including whatever training happened, while your figure is what a day costs
with the *planned* session in it. So the training that really happened comes out and the
planned amount goes back in.

That figure is measured on you, so it beats every formula. The sheet shows it beside your own
and offers to take it.

### The totals

The Energy card totals the whole thing over the days that logged an intake, with the day
count travelling beside the numbers: **eating against the budget**, **sport against the
budget**, and the two together. The training a plan already budgets for lives inside the
eating number — that is what budgeting for it means — so how much training there actually
was, and how much the figure assumed, are printed underneath rather than left implied.

A day nobody logged has no balance rather than a balance of zero, and today is left out until
it is over: at four in the afternoon the log holds lunch, and counting it would book a deficit
dinner is about to erase.

Finally the card puts the predicted loss next to what the scale actually did. The two never
match exactly — 7 700 kcal per kilo assumes an expenditure that does not fall as you get
lighter — so a kilo or two of gap is the model. Four is a maintenance figure that needs
correcting, and the card says which way.

## The evening digest

*Home → the share button* produces "Today" as plain text, to paste into whatever coaches you:

```
openGym — Today — Tue 25 Aug

Activity
  Push Day · 53 min · 430 kcal · HR 128 avg
Active energy 780 kcal from the watch → 562 counted, 28 % taken off
Intake 1,940 kcal · Carbs 180 g · Protein 155 g · Fat 62 g · target 2,200 (-260)
Sleep 7.2 h (the night before) · felt 4/5
Balance 2,500 maintenance +362 sport vs plan − 1,940 eaten = +922 kcal (deficit)
```

Today, and deliberately nothing else. No trend, no running total, no weigh-in: a conversation
that receives one of these every evening accumulates the history itself, and a digest that
re-sends the same past every night is asking its reader to reconcile two versions of it. The
trends live in Stats, which is where they are actually looked at.

The one thing here that is not a raw fact is the balance, and it is spelled out rather than
handed over as a total so the reader can see which of the three numbers moved.

No set-by-set detail either. That is a different question asked by a different conversation,
and the **Training** tab of the same sheet is where it lives, with what was prescribed against
what was done and what the app will prescribe next.

Text, not JSON. Both a person and a model read it, and the person reads it first — they are
about to paste it somewhere, and a wall of braces is not something you check before you do
that.

## Sleep is two clock times, not a number of hours

The sleep sheet asks when you went to bed, when you got up, and how many minutes you were
awake in between. It derives the hours; it never stores them. "Went to bed at 23:30, got up
at 07:00, was up about twenty minutes" is what a person actually remembers at breakfast —
7.17 hours is not, and asking for it invites a rounded guess.

Nights logged before this, and nights a watch or a duration-only CSV supplies, keep their
bare hours figure and are read exactly the same way everywhere in the app.
