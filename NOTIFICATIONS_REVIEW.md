# Score alerts: review, costs, rehearsal and rollout

Written 2026-11-24 at the end of the notifications project (stages 1, 1b,
2 and 3, branch `notifications`).

---

## 1. Audit against CLAUDE.md rules 1, 2 and 5

### Rule 1: no deploys, no live writes, no real pushes (by me)
- I never ran `firebase deploy`. Every deploy, the Blaze upgrade and the
  one IAM change (`gcloud … add-iam-policy-binding`) were run by you.
- Every test ran against the emulators: rules tests under project
  `demo-ryder-rules`, the rehearsal under `demo-ryder-rehearsal` (the
  `demo-` prefix makes Firebase refuse to reach any real service), and
  page tests on `127.0.0.1`, where alerts.js switches Firestore, Auth and
  Functions to the emulators.
- Commands I ran against the live project were read-only: listing database
  details, reading function logs, reading IAM and org policies, listing the
  Eventarc trigger, and plain GET requests to the live site's files.
- Under the emulators the functions can only use the mock sender, so real
  FCM is unreachable from local testing.

### Rule 2: only the allowed additions; protected files untouched
Checked with `git diff main`:
- `scoring.js`, `rounds-config.js`, `match-ui.js`, `firebase-init.js`:
  **unchanged**. The function uses copies of the first two, made by
  `npm run sync`, and reads the year out of `match-ui.js` without changing it.
- `auth.js`: exactly one word added (`export` on `ensureSignedIn`).
- `firestore.rules`: **additions only** (0 lines removed), and only the
  `pushSubscriptions` block. The three server-only collections have no
  rules at all, so browsers are denied by default (tested).
- Existing pages: the only changed lines are the Home Screen `<head>` tags
  and the `?v=` version numbers on `style.css` and `nav.js`.
- `style.css`: 0 lines removed; every new rule is scoped to Alerts-page
  classes (`al-…`).
- `nav.js`: one menu entry added (Alerts).
- Added, as allowed: Alerts page, manifest, icons, service worker,
  `functions/`, and the firebase.json functions and emulator entries.
  `js/platform.js` came from your stage 1b request.

### Rule 5: cost safety
**Every Firestore write the functions can make** (there are exactly three
write calls in `functions/index.js`):

| Function | Collection / document | Write | When |
|---|---|---|---|
| notifyOnMatchUpdate | `notificationLog/{year}_{round}_{match}_{key}` | `create()` (fails if it exists) | once per new event, at most 2 per run (hole + segment, or hole + final) |
| notifyOnMatchUpdate | `pushSubscriptions/{uid}` | `update({enabled:false, token:""})`, in a transaction that first checks the token is still the dead one | only when FCM says that phone's token is dead |
| sendTestNotification | `testPushLimits/{uid}` | `set({lastSentAt})`, in a transaction | each allowed test tap (at most once a minute per browser) |
| sendTestNotification | `pushSubscriptions/{uid}` | same dead-token `update` as above | only if the test finds the caller's token dead |

Nothing writes to `matches`, `players`, `rounds` or `notificationConfig`.

**Why there's no loop:** `notifyOnMatchUpdate` fires only on
updates to `rounds/{roundId}/matches/{matchId}` in `ryder-cup-tracker`.
It writes only to `notificationLog`, `pushSubscriptions` and (through the
other function) `testPushLimits`, and no trigger listens to those. So
nothing the function does can wake it up again. `sendTestNotification`
isn't a trigger; it only runs when someone taps the button.

**Other rule 5 items:**
- **Safe to run twice:** each event is claimed in `notificationLog` with
  `create()` before sending, so a second run finds the claim and sends
  nothing (shown in the stage 2 emulator test: "already handled").
- **Instances and limits:** `maxInstances: 5`, 256MiB, 30s timeout.
  Automatic retries are off (the Firestore-trigger default).
- **Dead tokens:** switched off, as in the table.
- **Bounded loops:** every loop is over something small and fixed: holes
  1–18, the subscriber list, batches of 500.

---

## 2. Worst-case usage for the whole trip

**Assumptions:** 16 people with alerts on, 20 matches, 360 holes, every
hole saved 3 times (partial entries, typos, corrections), plus about 50
admin edits (pairings, strokes) and about 50 test-button taps.

**What one run costs:**
- **Saves with nothing to announce** (half-entered holes, corrections),
  roughly 2 of every 3: **0 reads, 0 writes**. The before/after match data
  arrives with the trigger, and the function stops after `detectEvents`.
- **Saves that decide a hole:** 1 read (kill switch), 1–2 writes (log),
  16 reads (subscriptions), up to about 20 reads (players' teams and
  names). That's **about 37 reads and 2 writes**.
- **Test tap:** about 3 reads and 1 write.

| | Realistic | Worst case (every save treated as an event) |
|---|---|---|
| Function runs (trigger) | ~1,130 | ~1,130 |
| Function runs (test button) | ~50 | ~50 |
| Firestore reads by the functions | ~16,000 | ~42,000 |
| Firestore writes by the functions | ~470 | ~2,300 |
| Pushes sent (FCM, free) | depends on settings | 16 × 360 ≈ 5,800 if everyone picks Every hole + All |

**For scale,** the website's own live scoreboards: each phone with a
scoreboard or round page open re-reads a match each time it's saved, so
16 phones × ~1,130 saves ≈ 18,000 reads, plus page loads.

**What it costs:**
- **Firestore:** the free daily allowance (50,000 reads, 20,000 writes)
  belongs to only one database per project, the first one created. Your
  "(default)" database (May 2026) predates `ryder-cup-tracker` (November
  2026). So on Blaze, **every** read and write of the Ryder Cup database is
  billed from the first one. At roughly 6 cents per 100,000 reads and
  18 cents per 100,000 writes, **the whole trip is well under $1**. (I
  couldn't read Google's nam5 price table, so treat those rates as
  approximate.)
- **Functions:** free up to 2 million invocations, 400,000 GB-seconds and
  200,000 CPU-seconds a month. The trip uses about 1,200 invocations and a
  few hundred GB-seconds.
- **FCM:** free.
- **Other:** Cloud Build and Artifact Registry charge a few cents only when
  you deploy (old images are deleted after a day, since step 7).

**Numbers to watch:**
- **Firebase console → Firestore → Usage** (pick the ryder-cup-tracker
  database): reads, writes and deletes per day. Normal on a playing day is
  tens of thousands of reads and a few hundred writes. **More than ~150,000
  reads or ~5,000 writes in a day** means something's wrong.
- **Firebase console → Functions → Dashboard:** invocations and errors per
  function. `notifyOnMatchUpdate` should run about as often as scores are
  saved: hundreds a day, **not thousands per hour**. A steady stream with
  nobody scoring means a loop. Errors should stay near 0.
- **Firebase console → Functions → Logs:** one line per run, e.g.
  `round2/match2 events=front,hole9 recipients=9 sent 9: ios 5, android 3, unknown 1; failed 0 (dead 0)`.
  Rising `failed` without `dead` points to an FCM problem.
- **Google Cloud console → Billing → Reports** (project golf-tracker-data,
  grouped by service): Cloud Firestore, Cloud Run functions, Cloud Build,
  Artifact Registry. Each should be cents.
- **Your $5 budget alert:** emails you at 50%, 90% and 100%.

---

## 3. Rehearsal (emulators, `npm run rehearse` in `functions/`)

A singles match (round 4, match 1: USA's Sam Smith vs EU's Ben Brown, Ben
getting a stroke on 5), saved hole by hole through the Firestore emulator,
so the real trigger fired each time. The five subscribers:

| # | Setting | Team | Phone |
|---|---|---|---|
| 1 | Every hole / All scores | USA | iOS |
| 2 | Segment results / My team | EU | Android |
| 3 | Match finals / Opposing | USA | iOS |
| 4 | Every hole / My team, **no team** (so treated as All) | – | older doc, no platform |
| 5 | Every hole / All, **switched off** | USA | iOS |

Result: front 9 USA 1 UP; back 9 EU 3 UP; overall EU 2 UP; **EU wins 2–1**.

| Phone | Pushes | What |
|---|---|---|
| 1 | 18 | holes 1–8, "Match 1 front 9: USA wins", holes 10–17, "Match 1 final: USA 1 – EU 2" |
| 2 | 1 | the final (EU won; USA's front 9 isn't "my team") |
| 3 | 1 | the final (EU is the opposing team) |
| 4 | 18 | same as phone 1 (no team means All) |
| 5 | 0 | switched off |

These worked as intended:
- Hole 5 went to EU on Ben's stroke.
- The half-entered hole 8 sent nothing.
- The correction sent nothing. *(Changed in the offline project,
  Prompt 4: it now sends "Correction: EU wins hole 8"; see below.)*
- Halved holes reached only the "All" subscribers.
- The final carried all three results ("Front USA · Back EU · Overall EU 2 UP").

**Things that may surprise you:**
1. **A typo is announced, and its correction isn't.** Hole 8 was first
   saved with Ben's score mistyped. Everyone at "Every hole" got **"USA
   wins hole 8"**. The fix (EU actually won it) was silent, by design
   (corrections send nothing). The next push carried the right standing,
   but "USA wins hole 8" stayed on lock screens until the hole 10 alert
   replaced it (hole 9's alert was the front-9 one, which has its own tag).
   **Update (offline project, Prompt 4):** corrections that change a
   result are now announced. Re-running the rehearsal, the fix sends
   **"Correction: EU wins hole 8"** with the same tag, so it replaces the
   wrong alert on lock screens. A stroke fix that keeps the same winner
   is still silent.
2. **Hole 9 and hole 18 weren't announced as holes.** When a hole also
   finishes a nine or the match, people get only the bigger alert.
3. **"Every hole" is a lot.** 18 pushes per match. On singles day (8
   matches) that's up to ~144 alerts per person. Each match's hole alerts
   replace each other on the lock screen, but each one still buzzes. The
   ⓘ text warns about this.
4. **A "My team" subscriber can go quiet for a long time.** Subscriber 2
   (EU) heard nothing all front 9 because USA won it, then only the final.
5. **No team means everything, including halves.** Subscriber 4 chose
   "My team", but with no team assigned they got All scores, as the page
   tells them.

---

## 4. Rollout order

1. **Two phones first (done):** your iPhone (Home Screen) and a friend's
   Android (Firefox) both received the test push.
2. **Optional dress rehearsal on desktop Chrome:** run `npm run rehearse`
   any time; nothing leaves your computer.
3. **Everyone, at least a week before the trip:** paste
   `ALERTS_GROUP_MESSAGE.md` into the group chat. Ask everyone to tap
   **Send me a test notification** and reply "got it".
4. **Chase the stragglers.** Firestore → ryder-cup-tracker →
   `pushSubscriptions`: count documents with `enabled: true` (and check
   `platform`). For anyone stuck, ask them to open
   `https://the-cup-tracker.web.app/alerts.html?debug` → **Check my setup**
   → **Copy diagnostics** and send it to you.
5. **The day before the trip:**
   - `notificationConfig/global` → `enabled: true`.
   - `notificationLog` has no documents starting with this year (`2027_…`);
     delete any.
   - Team assignments are final (alerts read teams at send time).
6. **First round:** keep Functions → Logs open for the first few holes and
   check the one-line summaries look right.

**Don't** test score alerts by scoring a real match on the live site: each
alert is sent once per trip year (see `NOTIFICATIONS_DEPLOY.md`, step 8).

## 5. The kill switch

Firebase console → Firestore → **ryder-cup-tracker** →
`notificationConfig` → `global` → `enabled`.
- `true`: alerts and the test button work.
- Anything else (`false`, missing field, missing document): **nothing is
  sent**. The trigger checks it on every run before sending, so it takes
  effect from the very next score saved. The test button says "Alerts are
  paused by the organizer."
- **Nothing is queued while paused.** Scores saved during a pause are never
  announced later; switching back on only affects future saves.
- Only the console can change it. Browsers can't read or write it (tested).
- **Nuclear option:** `firebase functions:delete notifyOnMatchUpdate`
  removes the trigger entirely (redeploy to bring it back). You shouldn't
  need it.

---

## 6. All changes, file by file (branch `notifications` vs `main`)

**Website (`public/`)**
- `alerts.html` (new): the Alerts page:
  - install / in-app / unsupported / too-old / blocked notices;
  - Who are you?, master switch and test button;
  - Android Install and Android tips cards;
  - What to send / Whose scores with ⓘ explanations;
  - the `?debug` Check my setup card.
- `js/alerts.js` (new): everything that page does:
  - permission request, service worker, FCM token and saves to
    `pushSubscriptions/{uid}` (8 keys);
  - token refresh and upgrades of older documents;
  - the test-button call;
  - emulators when opened locally.
- `js/platform.js` (new): iPhone/Android, installed, browser family, Brave
  and in-app detection.
- `firebase-messaging-sw.js` (new): the service worker. It shows a
  notification for every push (data-only messages), and tapping one focuses
  or opens the right page. It loads the compat Firebase SDK for
  housekeeping only.
- `manifest.webmanifest` (new): name "Ryder Cup Trip", short name "Cup
  Tracker", standalone, navy, `id "/"`, portrait, icons.
- `icons/` (new): crossed-flags icon (192, 512, maskable 512, 180 Apple),
  Android status-bar badge, and the SVG sources.
- `css/style.css`: new section 12 (Alerts page only); no existing rule
  changed.
- `js/nav.js`: Alerts added to the More menu.
- `js/auth.js`: `export` on `ensureSignedIn`.
- All 11 deployed pages: Home Screen `<head>` tags; `style.css?v=15`,
  `nav.js?v=4`. `demo.html`: version number only.

**Server (`functions/`, new)**
- `events.js`: pure alert logic (events, who gets what, message text).
- `index.js`: `notifyOnMatchUpdate` trigger and `sendTestNotification`
  callable (kill switch, dedupe, FCM sending, dead tokens, mock sender
  under the emulators).
- `scripts/sync.js`: copies `scoring.js`, `rounds-config.js` and the trip
  year in before deploys and tests.
- `test/events.test.js`: 32 logic tests (`npm test`).
- `test/rules.test.js`: 55 rules tests (`npm run test:rules`).
- `test/rehearsal.mjs`: the full-match rehearsal (`npm run rehearse`).
- `package.json`, `package-lock.json`: Node 24, firebase-functions 7.4,
  firebase-admin 14.5; `firebase` 11.3.1 for tests.

**Project files**
- `firestore.rules`: `pushSubscriptions` block (owner-only, exact 8-key
  shape).
- `firebase.json`: functions block (sync before deploy), emulator ports
  (hosting 5002, firestore 8080, auth 9099, functions 5001).
- `.gitignore`: the synced copies and the rehearsal's scratch file.
- `CLAUDE.md`: notifications rules (restyle rules kept at the bottom);
  rule 6 updated in stage 2.
- `NOTIFICATIONS_DEPLOY.md`, `NOTIFICATIONS_TEST.md`,
  `NOTIFICATIONS_REVIEW.md` (this file), `ALERTS_GROUP_MESSAGE.md`.

**Outside git (live project, done by you):** Blaze plan, budget alert,
`notificationConfig/global`, deployed rules, hosting and functions, the
artifact cleanup policy, and the public-invoker permission on
`sendtestnotification`.

---

## 7. Left undone or uncertain

**Not yet seen working**
- **A real score alert hasn't been seen on a phone.** Only the test push
  has (iPhone, and Android Firefox). The trigger is deployed, and its logic
  is covered by tests and the emulator rehearsal. The first real hole of
  the trip is the true test, so watch the logs then.
- **Tapping a score alert to open the right scoreboard tab** is covered by
  unit tests (url `/scoreboard.html#roundN`) and the service worker's
  click code, but not seen on a phone. `NOTIFICATIONS_TEST.md` explains
  how to check it on a desktop.
- **Untested platforms:** Android Chrome itself (only Firefox so far),
  Samsung Internet, Brave, and an iPhone older than iOS 16.4.
- **Android install button:** the real Install button (Chrome's install
  prompt) was only simulated.

**Unverified wording or behaviour**
- **Brave:** the setting's name ("Use Google services for push messaging")
  couldn't be confirmed from Brave's docs; the hint says "a setting like".
- **Dead-token detection:**
  - verified against the Admin SDK: "not registered" errors;
  - a guess: treating an "invalid argument" as a dead token only when the
    error text mentions the registration token;
  - not exercised against real FCM: the cleanup itself (only in the
    emulator).
- **Firestore prices:** nam5 rates are approximate (Google's price table
  couldn't be read). The conclusion (under $1) holds with a wide margin.

**Known issues**
- ~~**Not fixable without new code:** corrections aren't announced, so a
  mistyped hole's alert can be wrong (rehearsal surprise 1).~~ Fixed in
  the offline project, Prompt 4: a correction that changes a hole, nine
  or match result now sends a "Correction: …" alert.
- **Permission fix not in the deploy itself:** `invoker: "public"` is now
  in the code, but on this project the first deploy didn't apply it. If
  the function is ever deleted and recreated, the `gcloud` fix in
  `NOTIFICATIONS_DEPLOY.md` may be needed again.
- **Shared plan:** the Blaze upgrade also applies to your other app on the
  same project. Its "(default)" database keeps the free daily allowance.
