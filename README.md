# Ryder Cup Tracker

Live score tracker for the 2027 golf trip (Whistling Straits & Blackwolf
Run), served at **https://the-cup-tracker.web.app**. It's a small Firebase
app:

- **Website** (`public/`): plain HTML/CSS/JavaScript, no build step.
  Firebase's code loads straight from Google's CDN (gstatic).
- **Firestore** (database `ryder-cup-tracker`, not "(default)"): the shared
  live data (roster, pairings, hole scores), so standings update for
  everyone in real time.
- **Anonymous sign-in**: every browser is silently signed in. Score entry
  is unlocked by picking your name on "Who are you?"; Admin tools need the
  admin code. `firestore.rules` enforces both on the server.
- **Cloud Functions** (`functions/`, Node 24): score alerts
  (`notifyOnMatchUpdate`), the Alerts page's test button
  (`sendTestNotification`) and the Admin page's score-change log
  (`logScoreEdit`).
- **Offline:** a service worker (`public/firebase-messaging-sw.js`, which
  also handles push) stores the app on the phone. Firestore keeps unsent
  scores on the phone until there's signal.

---

## Docs in this folder

| File | What it's for |
|---|---|
| `NOTIFICATIONS_DEPLOY.md` | First-time setup of score alerts: Blaze plan, budget alert, kill switch, deploy steps, the IAM fix, next year |
| `NOTIFICATIONS_REVIEW.md` | How alerts work: audit, costs, rehearsal, rollout, kill switch |
| `NOTIFICATIONS_TEST.md` | Real-device checklist for alerts |
| `ALERTS_GROUP_MESSAGE.md` | Group-chat text: how to set up alerts |
| `OFFLINE_REVIEW.md` | How offline play works: audit, real-phone test (throwaway Round 4 Match 8, and how to clean it up), the morning routine text |
| `DAY_OF_PAIN_POINTS.md` | Usability ideas not built yet, plus extra group-message lines |
| `CLAUDE.md` | Ground rules for working on this project with Claude Code |
| `CLAUDE_CODE_PROMPTS_OFFLINE.md` | The prompts used for the offline / score-log / polish project |

`archive/` (git-ignored, local only) holds the old site files kept for
reference.

---

## One-time setup on a new computer

1. **Node.js 24** (for the functions and their tests) and the **Firebase
   CLI**: `npm install -g firebase-tools`, then `firebase login`.
2. **Java** (the Firestore emulator needs it). On a Mac with Homebrew:
   `brew install openjdk@21`, and before running emulators in a new
   terminal:
   `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`
3. **Functions' packages:** `npm --prefix functions install`
4. The project and hosting target are already configured (`.firebaserc`:
   project `golf-tracker-data`, hosting target `ryder` →
   `the-cup-tracker`).

---

## Running it locally (never touches the live project)

```
firebase emulators:start --only hosting,firestore,auth
```

Then open **http://127.0.0.1:5002**. On `127.0.0.1` / `localhost`, every
page connects to the local emulators (see `public/js/firebase-init.js`),
so nothing you do reaches the live database. The emulator database starts
empty: add players, the admin code (`secrets/config` → `adminCode`) and
pairings through the emulator UI (http://127.0.0.1:4000) or the Admin page.

- **With the Cloud Functions too:** add `functions` to `--only`, after
  `npm --prefix functions run sync`. Under the emulator, alerts only go to
  a pretend sender that writes to the log; no real push is ever sent.
- **Demo with made-up data:** http://127.0.0.1:5002/demo.html (never
  deployed).
- **Offline testing tips** are in `OFFLINE_REVIEW.md` §1. For example,
  freezing the Firestore emulator process simulates weak signal.

---

## Tests (run from the project folder)

| Command | What it checks |
|---|---|
| `npm --prefix functions test` | Alert and score-log logic (no emulator needed) |
| `npm --prefix functions run test:rules` | `firestore.rules`, in a throwaway emulator (needs Java) |
| `npm --prefix functions run rehearse` | A full match scored end to end through the real alert function, in the emulators |
| `npm --prefix functions run check-offline` | The service worker's list of files to store offline matches `public/` |

---

## Deploying (you run these; nothing deploys automatically)

Deploy only from the branch you mean to ship, and in this order when more
than one part changed:

1. **Rules:** `firebase deploy --only firestore:rules`
2. **Functions:** `firebase deploy --only functions`. Watch Functions →
   Logs for the first run. If the test button says "internal", see the IAM
   fix in `NOTIFICATIONS_DEPLOY.md` §5.
3. **Website:** `firebase deploy --only hosting:ryder`. Always use the
   `:ryder` target, because the same project also hosts another site.

**Before deploying the website:**
- If you **added, renamed or deleted** a file in `public/`, run
  `npm --prefix functions run check-offline`, fix `PRECACHE_FILES` in
  `public/firebase-messaging-sw.js` if it reports anything, and bump
  `CACHE_VERSION` there by 1.
- If you changed `style.css` or `nav.js`, bump their `?v=` numbers in
  every page, so phones don't keep an old copy.
- Changing other existing files needs nothing extra. Phones pick up new
  versions on their next online visit.

**After deploying:**
- Test notification on one iPhone (Home Screen app) and one Android
  (Alerts → **Send me a test notification**).
- More → "✓ Ready for offline".

**Emergency stop for alerts:** Firestore → `notificationConfig/global` →
`enabled: false` (details in `NOTIFICATIONS_REVIEW.md` §5).

---

## Next year

Year-specific details live only in config files:
- `public/js/match-ui.js` (`CURRENT_YEAR`)
- `rounds-config.js`, `courses-config.js`, `schedule-config.js` and
  `hole-tips-config.js` (all in `public/js/`)
- `public/scorecards/` (new PDFs)
- `history-data.js` (freeze the finished year)

After changing `CURRENT_YEAR`, **redeploy the functions** too: the year is
part of each alert's once-only id. More in `NOTIFICATIONS_DEPLOY.md`,
"Next year".

---

## Untested platforms

Still unverified for push alerts and offline play. Tick them off as people
confirm.

| Platform | Push alerts | Offline play |
|---|---|---|
| iPhone, Home Screen app (iOS 16.4+) | ✅ test push received | ☐ not yet tried on a real phone |
| Android **Chrome** | ☐ only Firefox confirmed so far | ☐ |
| Android **Samsung Internet** | ☐ | ☐ |
| Android **Firefox** | ✅ test push received | ☐ |
| **Brave** (Android) | ☐ may need a "Google services for push" style setting (unconfirmed) | ☐ |
| iPhone **older than iOS 16.4** | ☐ not supported for push (Apple limitation); check the Alerts page explains this | ☐ scores and offline should still work, but unconfirmed |
| A **real score alert** (not just the test push) | ☐ first real hole of the trip, or `OFFLINE_REVIEW.md` §2 | — |
| **Correction alert** and the Admin **score-change log "who"** | ☐ `OFFLINE_REVIEW.md` §2 steps 16a–16b | — |

How to test: push in `NOTIFICATIONS_TEST.md`; offline in `OFFLINE_REVIEW.md`
§2.
