# Morning Dashboard for Boox Go 7 — Implementation Plan

**For:** Claude Sonnet 5 (executor)
**Author of plan:** Claude Fable 5.1, from a working session with Geb
**Owner:** Geb Sierra

Read this whole document before writing any code. The architecture decisions in Section 2 are settled; do not relitigate them. Where this plan says "decide," you decide and note it in your summary. Where it says "ask," stop and ask Geb.

---

## 0. Inputs Geb must attach to your session

Four files. If any is missing, ask for it before doing anything.

1. **`BOOX_DASHBOARD_PLAN.md`** — this document.
2. **`principles.json`** — the canonical source for Vision, Mission, header quotes, all ten principle sections (Daily Drivers, Inbox, Family, Friendships, Pride, Hard Work, Vision, Focus, Phrases to Use in Conversation, Eight Paradoxes of Leadership), wedding vows, and the footer line. 232 principle items plus mission text. Each section carries a `weight` used by the rotation (Section 3.2). **This supersedes any principles or mission text found in the HTML file. Render from this JSON. Do not edit the wording.**
3. **`mcheyne.json`** — the full-year M'Cheyne reading plan. Keys are `"M-D"` (no zero padding, e.g. `"8-11"`), values are arrays of four passage strings. 365 entries, verified against source and corrected (Dec 8 col 4 fixed from a source typo to `Lk 22`). **Use this file; do not re-derive the plan from anything else.**
4. **`kindle-morning.html`** — the prior working version. Use it **only** for: the AM routine (six phases with sub-text and times), the local habit checklist wording, the 10/3/1-year goals, the devotions-by-weekday logic, the RRULE `isDueToday` logic, the per-day `localStorage` key pattern, and the date formatting. **Ignore its `PRINCIPLES` array and its "All principles" HTML block** — those are an older, incomplete subset now replaced by `principles.json`.

---

## 1. Goal

A personal morning dashboard that runs as an installed Android app on a Boox Go 7 (Android 12, 7-inch e-ink, 1264×1680, Google Play available). Geb opens it each morning, reads, and checks things off. Checking a TickTick habit in the app must check it in TickTick for real.

It replaces a prior Kindle version that worked as a local HTML file but could not reach the internet due to an obsolete TLS stack. That constraint is gone. Design for a modern Android WebView.

**Explicitly out of scope:** Anki integration (removed entirely), any browser-app dependency (the user does not want to open a browser), any server component.

---

## 2. Architecture (settled — do not change)

### 2.1 WebView-wrapper APK, not a native rewrite

One Kotlin `Activity` hosting a `WebView` that loads a bundled `index.html`. Rationale: the entire UI already exists as working HTML/JS; a native Compose rebuild would be many times the code for zero user-visible gain. The APK is a thin shell.

- `minSdk 26`, `targetSdk 34`, Kotlin, single module.
- Serve assets through `androidx.webkit.WebViewAssetLoader` at `https://appassets.androidplatform.net/assets/`. **Do not load via `file://`.** The asset loader gives the page a proper secure origin, so `localStorage` works reliably and there are no null-origin quirks.
- WebView settings: `javaScriptEnabled = true`, `domStorageEnabled = true`. Disable zoom controls. No `allowFileAccess` needed.

### 2.2 Token security model (this is the whole point — get it right)

The TickTick personal API token **never appears in the repository and never enters the JavaScript layer.**

- Token is entered once by the user, on-device, into a settings screen.
- Stored in `EncryptedSharedPreferences` (`androidx.security:security-crypto`).
- All TickTick HTTP calls are made **from Kotlin**, using the stored token. JS never holds or sees it.
- JS talks to Kotlin through a `@JavascriptInterface` bridge (Section 4). JS says "check in habit X"; Kotlin attaches the token and makes the call.
- Consequence: the GitHub repo is safe to be public. Anyone who reads the source finds no credential. Extracting the APK finds no credential either.
- If the device is lost, Geb revokes the token in TickTick (Settings → Account → API Token) and issues a new one. Independent of his password.

The settings UI may be an HTML section inside the WebView (an `<input type="password">` that calls `Android.saveToken(t)` once and clears itself) or a small native dialog. **Decide.** Either is fine; HTML-in-WebView is less code. The token must never be echoed back to the page after saving. Provide "Token saved ✓ / No token" status only.

### 2.3 Build pipeline: GitHub Actions, no Android Studio

Geb does not have Android Studio and should not need it. GitHub's `ubuntu-latest` runners ship with the Android SDK.

- Workflow triggers on push to `main`. Steps: checkout → `actions/setup-java` (Temurin 17) → `./gradlew assembleRelease` → `actions/upload-artifact` with the APK.
- **Signing gotcha you must handle:** a debug-signed APK gets a fresh keystore on every CI runner, so each new build has a different signature and Android refuses to install it over the previous one. Fix: generate a release keystore **once**, base64 it, store as GitHub Secrets (`KEYSTORE_B64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`), decode it in CI, and sign the release build with it. Then updates install cleanly over the old version. Include the exact `keytool` command in the README so Geb can generate the keystore himself locally (Java is the only thing he needs installed; note the Windows path).
- Install: download the APK artifact to the Boox, tap it, allow "Install unknown apps" for the file manager when prompted.

Include a short README with: how to generate the keystore, how to add the four secrets, how to download and install the APK, how to enter the token in the app.

---

## 3. Page content and layout (port from `kindle-morning.html`)

Order, top to bottom:

1. **Date line.** Full weekday, month, day, year.
2. **Vision** (`principles.json → vision`) and **Mission** (`principles.json → mission`, all seven headings with their text lines). Verbatim.
3. **Reading.** Today's four M'Cheyne passages from `mcheyne.json`, each as a checkbox row. No "Family/Secret" labels. Lookup key is `${month+1}-${day}`. Handle Feb 29 by showing the Feb 28 readings with a small note (the plan has no leap day). Include a link/button to `https://www.thegospelcoalition.org/readthebible/` for the audio and devotional.
4. **AM routine.** Six checkbox phases with sub-text and times, verbatim. Above it, the computed **Devotions today** line (Mon/Wed: memorization and prayer list; Sat: reading plan and add music; else: reading plan). Port the existing logic.
5. **Habits.** See Section 5 — this is the live TickTick section.
6. **Other checks (local only).** Greek flashcards, Readwise daily review, Word and prayer 5:15–6:00, Workout. These are not TickTick habits; they persist per-day in `localStorage` only. Label the section so it is obvious these do not sync. (Optional note in README: Geb can make any of these real TickTick habits if he wants them synced.)
7. **Today's three.** Three rotating statements chosen by the weighted algorithm in Section 3.2. **Do not port the old `start % 35, step 11` algorithm** — it is replaced.
8. **Divider.**
9. **All principles.** Rendered entirely from `principles.json`, in this order: the three `header_quotes` as a short epigraph, then every section in `sections` in array order (Daily Drivers, Inbox, Family, Friendships, Pride, Hard Work, Vision, Focus, Phrases to Use in Conversation, Eight Paradoxes of Leadership), each under its own `h3` with every item as a list entry. Then **Wedding vows** as its own heading with each paragraph. Nothing omitted, nothing reworded. This section is long by design; it is reference material below the divider.
10. **Goals.** This year (Dec 2026), Three years (Dec 2028), Ten years (Dec 2035). Verbatim from the HTML file.
11. **Footer line** (`principles.json → footer`).
12. **Settings** (token entry / status) — at the very bottom, or behind a small gear icon. Decide.

### 3.2 "Today's three" — weighted rotation (replaces the old algorithm)

Geb wants his Daily Drivers and his Mission/Vision to appear far more often than the quotes and scratch material, while still eventually surfacing everything. Implement exactly this; it has been simulated and produces the intended distribution.

**Pool construction:**
- `core` = the `vision` string, plus every `text` line from every `mission` entry (prefix each with its heading and a colon, e.g. `"To be a good dad: I cherish my family…"`), plus every item in the `Daily Drivers` section. Approximately 30 items.
- `rest` = every item from every other section. Approximately 213 items. Do **not** include wedding vows or header quotes in the rotation.
- Every `core` item has weight 3. Every `rest` item has weight 1.

**Daily selection** (deterministic, seeded by the date so the same day always shows the same three):
1. `seed = YYYYMMDD` as an integer. Use **mulberry32** as the PRNG (small, deterministic, trivially portable). Reference implementation:
   ```js
   function rng(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; var t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
   ```
2. **Slot 1:** pick uniformly at random from `core` only. This guarantees every morning opens with one of Geb's own convictions.
3. **Slots 2 and 3:** from the remaining pool (`core` minus the slot-1 pick, plus all of `rest`), pick by weight, without replacement. Weighted pick: sum the weights, draw `r() * total`, walk the list subtracting weights until you pass zero.
4. Render the three in slot order.

**Expected behavior (verified by a 365-day simulation):** zero in-day repeats; every day contains at least one core statement; core statements fill about half of all slots for the year; each Daily Driver and Mission line appears roughly 18–19 times a year; each other item appears roughly 2–3 times a year; about 226 of the 243 eligible items surface within a year. Include this simulation as a unit test.

Replace the literal `[today's date]` in the one Inbox item that contains it with the formatted current date at render time.

You may now use modern JavaScript (ES2020+). The source file is ES5 because of the old Kindle; that constraint is gone, but rewriting working logic for style points is not worth the risk. Port, don't refactor, unless a change is needed for the bridge.

### 3.1 Local checkbox persistence

Every non-TickTick checkbox persists in `localStorage` under a key that includes today's `YYYYMMDD`, so ticks reset naturally each morning. Port the existing pattern.

---

## 4. The JavaScript ↔ Kotlin bridge

Expose a Kotlin object to JS as `Android` via `webView.addJavascriptInterface(...)`.

Because `@JavascriptInterface` methods run on a WebView background thread, network calls inside them are permitted, but the cleaner pattern is asynchronous: JS passes a `callbackId`, Kotlin does the work in a coroutine, then delivers the result with `webView.evaluateJavascript("window.__cb(callbackId, jsonString)")` on the main thread. Implement the async pattern. Wrap it in a small JS Promise helper so page code reads naturally.

Bridge surface (all JSON strings in/out):

| Method | Purpose |
|---|---|
| `saveToken(token)` | Store in EncryptedSharedPreferences. Return nothing. |
| `hasToken()` | `true/false`. Synchronous is fine. |
| `clearToken()` | Remove it. |
| `fetchHabits(cbId)` | `GET https://api.ticktick.com/open/v1/habit` → callback with the array. |
| `fetchCheckins(habitIdsCsv, from, to, cbId)` | `GET /open/v1/habit/checkins?habitIds=…&from=YYYYMMDD&to=YYYYMMDD` → callback. |
| `checkin(habitId, stamp, value, goal, status, cbId)` | `POST /open/v1/habit/{habitId}/checkin` with JSON body `{stamp, value, goal, status}` → callback with response or error. |

Every request sends `Authorization: Bearer <token>` and, for POST, `Content-Type: application/json`. Use `HttpURLConnection` (zero extra deps) or OkHttp — decide. Return HTTP errors to JS as `{ error: true, status, body }` so the page can show a useful message rather than silently failing.

### 4.1 API facts (verified against TickTick's official docs and a live probe)

- Base URL: `https://api.ticktick.com`
- Auth: personal API token as `Bearer`. Created at TickTick web app → avatar → Settings → Account → API Token. No OAuth needed for personal use.
- `GET /open/v1/habit` returns `[{ id, name, repeatRule, status, goal, type, exDates, archivedTime, … }]`
- `GET /open/v1/habit/checkins?habitIds=a,b&from=20260818&to=20260818` returns `[{ habitId, year, checkins: [{ stamp, value, goal, status }] }]`
- `POST /open/v1/habit/{habitId}/checkin` body `{ "stamp": 20260818, "value": 1, "goal": 1, "status": 2 }`
- Check-in `status`: `2` = completed, `0` = unmarked, `1` = not completed. Toggling off = POST with `status: 0, value: 0`.
- CORS is open, but that is irrelevant here because Kotlin makes the calls, not the WebView.

---

## 5. Habits section behavior

1. On page load, if `hasToken()` is false: show "Connect TickTick" prompt pointing to Settings, and render nothing else in this section.
2. If a token exists: call `fetchHabits`. Filter out habits where `archivedTime` is non-null. Filter to habits due today using the RRULE logic already in the source file (`isDueToday`: honor `BYDAY`, honor `exDates`, default to due if no rule).
3. In parallel, call `fetchCheckins` for those habit IDs with `from = to = todayStamp`.
4. Render one checkbox row per habit, checked if today's check-in has `status === 2`.
5. On tap: optimistically flip the UI, call `checkin` with `status 2` (or `0` to undo), `value = goal` when completing (or `0` when undoing), `goal = habit.goal || 1`. On error, revert the UI and show a one-line message.
6. Cache the last successful habits JSON and check-ins JSON in `SharedPreferences` (plain, not encrypted — it's not sensitive). If the network fails on load, render from cache with a visible "Offline — showing last known" label, and disable taps.

Known habit IDs at time of writing, for reference and for a sanity test (fetch live; do not hardcode these as the UI source):
- `68c58ba2ebcf3900000002fa` Write out a ToDo List (Tue–Sat)
- `68c58c0cebcf390000000309` 12 Minutes of Silence With God (daily)
- `68c58dc5ebcf390000000367` AM, PM, Office Routines (Mon–Sat, goal 3, type Real)
- `69ccf1274bfc2cd711ad8c0a` Creatine and vitamins with lunch (daily)

---

## 6. E-ink considerations

- No CSS animations or transitions. No smooth scrolling. `scroll-behavior: auto`.
- High contrast: pure black text on white. No grays lighter than `#444` for anything that must be read.
- Large tap targets: checkbox rows at least 48dp tall.
- `-webkit-tap-highlight-color: transparent`.
- Avoid re-rendering large DOM regions on every tap. Update the single row that changed.
- Font: a system serif for body (Georgia falls back fine), sans for headings. Base 18–20px at the device's density.
- Lock orientation to portrait in the manifest.
- Keep the screen on while the activity is in the foreground (`FLAG_KEEP_SCREEN_ON`) — e-ink users read slowly.

---

## 7. Project layout

```
boox-morning/
  .github/workflows/build.yml
  app/
    build.gradle.kts
    src/main/
      AndroidManifest.xml
      java/.../MainActivity.kt        (WebView + asset loader)
      java/.../Bridge.kt              (JavascriptInterface, HTTP, token store)
      assets/
        index.html
        app.js
        style.css
        mcheyne.json
        principles.json
  build.gradle.kts
  settings.gradle.kts
  gradle/  (wrapper)
  README.md
```

Split the HTML into `index.html` + `app.js` + `style.css`. Copy `mcheyne.json` and `principles.json` into `assets/` unchanged and load both with `fetch()` from the asset origin rather than inlining them into JS. Content changes later should be a JSON edit, not a code change.

---

## 8. Phase 2 (optional — only after Phase 1 is installed and working)

Do not start these until Geb confirms Phase 1 runs on the device.

- **Readwise daily review.** Same token pattern. Token from `https://readwise.io/access_token`, sent as `Authorization: Token <token>`. `GET https://readwise.io/api/v2/review/` returns `{ review_url, highlights: [{ text, title, author }] }`. Add a bridge method and a section rendering the quotes with a "mark done" local checkbox and a link to `review_url`.
- **Calendar.** If Geb signs into Google on the Boox, his calendar syncs to the device. A native app can then read it with `READ_CALENDAR` permission via `CalendarContract` — no OAuth, no API key. Add a bridge method `fetchTodayEvents(cbId)` and a section at the bottom of the page. Runtime permission prompt required.

---

## 9. Acceptance criteria (Phase 1)

Sonnet: verify each of these yourself where possible (run the JS logic in Node against `mcheyne.json` and known dates; build the APK in CI). Mark the rest for Geb to confirm on-device.

- [ ] APK builds green in GitHub Actions and the artifact downloads.
- [ ] Installing a second build over the first succeeds (signature stable).
- [ ] App opens full-screen portrait; no browser chrome; no address bar.
- [ ] Date line is correct. Devotions line is correct for Mon/Wed/Sat/other.
- [ ] Reading shows exactly four passages for today. Spot-check Jan 1 (`Gen 1, Matt 1, Ezra 1, Acts 1`), Aug 11 (`1 Sam 1, Rom 1, Jer 39, Ps 13-14`), Dec 8 (`2 Chr 8, 3 Jn 1, Hab 3, Lk 22`), Dec 31 (`2 Chr 36, Rev 22, Mal 4, Jn 21`).
- [ ] Today's three: three distinct items; changes next day; same date always gives the same three; slot 1 is always from Daily Drivers or Mission/Vision. Run the 365-day simulation from Section 3.2 as a test and assert: zero in-day repeats, 365/365 days contain a core item, core share between 45% and 55%.
- [ ] All principles section renders every item from every section of `principles.json` — assert the rendered `<li>` count equals the total item count in the JSON (232) plus the vow paragraphs (10). Spot-check that the Kilby quotes, the Cromwell quote, the wedding vows, and the Eight Paradoxes are all present.
- [ ] Mission, all principles, and goals match their sources word for word. `principles.json` is the source for the first two; the HTML file for goals.
- [ ] With no token: Habits shows "Connect TickTick." With a token: habits due today appear with real names from the API.
- [ ] Tapping a habit checks it in TickTick (verify in the TickTick app). Tapping again un-checks it.
- [ ] Airplane mode: page still loads, reading and principles still work, habits show cached with "Offline" label.
- [ ] Local checkboxes persist across app restarts within a day and reset the next day.
- [ ] `grep -r` the repo for the token: nothing. Token appears nowhere in source or assets.
- [ ] No Anki references anywhere.

---

## 10. Things to ask Geb about (do not guess)

- Whether he wants Settings visible at the bottom of the page or behind a gear icon.
- Whether he wants the "Other checks (local only)" items converted into real TickTick habits so they sync (that is a TickTick-side change he makes himself; then they appear automatically in Habits and you remove them from the local section).

Everything else in this document is decided. Build it.
