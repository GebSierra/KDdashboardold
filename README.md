# Boox Morning

A morning dashboard for the Boox Go 7. One WebView Activity loads a bundled HTML page:
vision and mission, today's Bible reading (M'Cheyne plan), the AM routine, live TickTick
habits, a weighted rotation of your principles, and the full reference material below a
divider. See `BOOX_DASHBOARD_PLAN.md` for the full design.

## What you need to do

Four things, once: generate a keystore, add four GitHub secrets, push to `main`, install
the APK. After that, every push to `main` builds a new APK automatically.

### 1. Generate a release keystore

You need a Java installation for this — nothing else. From a terminal (macOS/Linux) or
PowerShell (Windows):

```
keytool -genkeypair -v -keystore release-keystore.jks -alias booxmorning \
  -keyalg RSA -keysize 2048 -validity 10000
```

On Windows, if `keytool` isn't on your PATH, it lives inside your Java install, typically:

```
"C:\Program Files\Java\jdk-17\bin\keytool.exe" -genkeypair -v -keystore release-keystore.jks -alias booxmorning -keyalg RSA -keysize 2048 -validity 10000
```

It will ask for a keystore password, your name/org (answers don't matter), and a key
password (you can reuse the keystore password). **Save `release-keystore.jks` somewhere
safe outside the repo** — if you lose it, you can't publish an update that installs over
the old one; you'd have to uninstall and reinstall fresh.

Then base64-encode it, so it can travel as a GitHub secret:

```
# macOS
base64 -i release-keystore.jks | pbcopy
# Linux
base64 -w0 release-keystore.jks
# Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release-keystore.jks")) | Set-Clipboard
```

### 2. Add four GitHub secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add all four:

| Secret | Value |
|---|---|
| `KEYSTORE_B64` | the base64 text from step 1 |
| `KEYSTORE_PASSWORD` | the keystore password you chose |
| `KEY_ALIAS` | `booxmorning` (or whatever alias you used) |
| `KEY_PASSWORD` | the key password you chose |

### 3. Push to `main`

The workflow in `.github/workflows/build.yml` runs on every push to `main` (or you can
trigger it manually from the Actions tab — "Run workflow"). It checks the reading-plan
and rotation logic with `node scripts/test-core.js`, then builds a signed release APK and
attaches it to the run as a downloadable artifact ("boox-morning-release").

### 4. Install on the Boox

Open the finished workflow run in the Actions tab, download the `boox-morning-release`
artifact, unzip it (GitHub always zips artifacts), and copy `app-release.apk` to the
Boox — email it to yourself, use a cloud drive, or a USB cable. Tap the APK on the device.
The first time, Android will ask to allow your file manager to "install unknown apps" —
allow it. Later updates install over the existing app without asking again, because every
build is signed with the same keystore.

### 5. Enter your TickTick token

Open the app, tap the gear icon (top right), and paste in your TickTick personal API
token. Get one from ticktick.com → your avatar → Settings → Account → API Token. The
token is stored encrypted on the device and is never shown again after you save it — the
gear panel just tells you "Token saved" or "No token saved." If you ever lose the device,
revoke the token from TickTick's website and issue a new one; nothing else needs to
change.

## What's local-only vs. synced

The Habits section talks to TickTick live — checking a habit there checks it in TickTick
for real. The four boxes under "Other checks" (Greek flashcards, Readwise daily review,
Word and prayer, Workout) are local only: they reset each morning on-device but never
touch TickTick. If you'd rather have any of them sync too, make them real TickTick habits
yourself (in the TickTick app) and they'll start showing up in the Habits section
automatically — at that point, delete the matching row from the "Other checks" list in
`app/src/main/assets/index.html` so it doesn't appear twice.

## Running the logic checks yourself

No Android tooling needed for this part — just Node:

```
node scripts/test-core.js
```

It checks the reading-plan lookups (including the Dec 8 typo fix and the Feb 29
fallback), the Mon/Wed/Sat devotions logic, and runs the full 365-day "today's three"
simulation described in the plan (zero in-day repeats, every day includes a core
statement, core statements fill roughly half of all slots, and about 226 of 243 eligible
items surface across the year).

## Decisions made while building this

A few things the plan left to the builder:

- **Settings placement:** behind the gear icon (top right), per your answer.
- **TickTick's `isDueToday` RRULE logic:** the plan pointed at logic "already in the
  source file," but the version of `kindle-morning.html` I was given predates the live
  TickTick integration and doesn't contain it. I wrote a straightforward `BYDAY` +
  `exDates` parser (see `isDueToday` in `core.js`) that covers the habit examples in the
  plan (daily, and Tue–Sat). It doesn't handle an `INTERVAL` other than 1 — if you add a
  habit like "every other week," it'll show up more often than it should until that's
  extended.
- **Offline habit cache:** the plan describes caching the last-known habits/check-ins in
  Android `SharedPreferences`. I cached them in the WebView's `localStorage` instead — it
  persists the same way across app restarts, and it kept the bridge to exactly the six
  methods in the plan's table rather than adding cache-retrieval methods that weren't
  specified. Functionally it behaves the same: lose the network, and the last successful
  fetch renders with an "Offline" label.

## Not built (Phase 2, per the plan)

Readwise daily review and Calendar integration are described in the plan as Phase 2, to
start only after Phase 1 is confirmed working on-device. Neither is implemented here.

## Project layout

```
boox-morning/
  .github/workflows/build.yml     CI: logic checks + signed release build
  app/
    build.gradle.kts
    src/main/
      AndroidManifest.xml
      java/com/geb/booxmorning/
        MainActivity.kt           WebView + asset loader + keep-screen-on
        Bridge.kt                 JS interface, token storage, TickTick HTTP calls
      res/                        theme, adaptive launcher icon
      assets/
        index.html
        app.js                    DOM wiring, habits section, settings
        core.js                   pure logic: reading plan, rotation, RRULE (Node-testable)
        style.css
        mcheyne.json
        principles.json
  scripts/test-core.js            node scripts/test-core.js — logic checks, no Android needed
  build.gradle.kts
  settings.gradle.kts
  gradle/ (wrapper)
```
