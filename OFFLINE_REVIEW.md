# Offline play: review, real-phone test and morning routine

Written 2026-11-24 at the end of offline stages 1 and 2 (branch `offline`,
commits `02b698c` and `182a606`). Modelled on `NOTIFICATIONS_REVIEW.md`.

Line numbers refer to the files as committed in `182a606`.

---

## 1. Audit against the CLAUDE.md ground rules

### Rule 1: no deploys, no live writes, no real pushes (by me)
- I never ran `firebase deploy`. Every test ran against the local emulators
  on `127.0.0.1`.
- Since stage 1, **every** page connects to the emulators when opened from
  this computer (`public/js/firebase-init.js:81`). Before that, only the
  Alerts page did, and a round page opened locally would have written to the
  live database. Found and fixed in stage 1.
- The functions emulator (used once, in stage 3, to see what several synced
  holes send) always uses its mock sender, which only writes to a local log
  file (`functions/index.js:67` and `:112`). No real push can leave it.
- **Caveat:** the emulators ran under the real project id
  (`golf-tracker-data`) rather than a `demo-` id, because the web pages must
  use the same id as the emulator. Firestore, Auth and Functions all ran
  locally, and nothing points at the live services. A `demo-` id would make
  Firebase refuse outright, which is stronger.
- The only outside requests were plain downloads of public files: Firebase's
  JavaScript from gstatic (to check function names and fallback behaviour)
  and Google Fonts, both loaded by the pages anyway.

### Rule 2: never lose a score; saving never waits on the network
- Firestore's offline copy and its queue of unsent writes now live on the
  phone (IndexedDB), not in page memory, so they survive a reload or the app
  being closed (`firebase-init.js:61`). If a browser can't offer IndexedDB,
  Firebase falls back to memory-only and carries on. I confirmed this in the
  11.3.1 source.
- Save hands the write to Firestore without waiting
  (`public/js/round.js:654`, `:664`). The page moves to the next hole at
  once.
- A save the server refuses while the page is open is caught and shown
  (`round.js:668`, `:675`). One refused after a reload is caught by
  comparing the server with this phone's notes (`round.js:736`,
  `public/js/my-entries.js:108`).
- A blank box never erases another phone's number: empty sides aren't
  written (`round.js:646`). You chose this; the trade-off is that emptying
  a box no longer clears a score.
- Nothing in stages 1 or 2 deletes or overwrites score data on its own.
  The service worker never touches the database: it only handles plain
  downloads (`public/firebase-messaging-sw.js:464`) and leaves database and
  sign-in traffic alone (`:482`).

### Rule 3: only the allowed files changed
Checked with `git diff main..offline`:
- **Unchanged:** `scoring.js`, `rounds-config.js`, `match-ui.js`,
  `firestore.rules`, `functions/index.js`, `functions/events.js`.
- `firebase-init.js`: the cache setting (allowed), plus the emulator hookup
  moved in from `alerts.js` (you approved).
- `round.js`: the save flow (allowed), the sync line, warnings and the
  listener's `includeMetadataChanges` (`round.js:725`).
- `nav.js`: service worker registration (`nav.js:257`), loads the banner
  and readiness files (`:243`, `:270`), and adds the More-menu status line.
- `firebase-messaging-sw.js`: offline caching added as a separate section
  (`:155` onward).
- `auth.js`: only the approved retry fix in `ensureSignedIn`
  (`auth.js:68`). The sign-in flows are otherwise untouched.
- `alerts.js`: the duplicate Firestore and Auth emulator lines removed
  (approved). The Functions emulator line stays (`alerts.js:100`).
- New files: `js/connection.js`, `js/my-entries.js`, `js/offline-ready.js`,
  `functions/scripts/check-offline.js` (plus one script line in
  `functions/package.json`).
- Existing pages: the only changed lines are the `?v=` numbers on
  `style.css` and `nav.js`.
- `style.css`: **0 lines removed**. The new rules are in section 13
  (`css/style.css:3633`) and the More-menu line after it, all new class
  names.
- No new Firestore collection was needed, so no rule changes.

### Rule 4: push notifications unchanged
- `git diff main..offline -- public/firebase-messaging-sw.js` shows
  **0 removed or changed lines**: only additions. The `push` handler
  (`:85`), its `showNotification` call (`:102`) and the
  `notificationclick` handler (`:112`) are byte-for-byte as before.
- The offline section sits between the push code and the Firebase import
  (`:535`) and uses different events (install, activate, fetch, message).
- A failed download never fails the install (`:390`–`:391`), so caching
  can never cost a phone its push service worker.
- All 32 notification tests pass (`npm test` in `functions/`).
- **Not yet proven on a phone:** a real push through the new worker. That's
  step 5 of the stage 2 deploy checklist, and step 9 below.

### Rule 5: plain HTML/CSS/JS, no build step
- No bundler and no npm for the site. Firebase still loads from gstatic
  11.3.1.
- The service worker's file list is written by hand
  (`firebase-messaging-sw.js:218`). The checker,
  `npm --prefix functions run check-offline`, compares it with `public/`.

### Rule 6: reuse, don't rewrite
- Score logic still comes from `scoring.js` (`round.js:40`), and the trip
  year from `match-ui.js` (`my-entries.js:28`).
- The new styling uses the existing tokens (`--muted`, `--ok`, spacing,
  radii) plus two new amber tokens, `--warn` and `--warn-tint`, which you
  approved.

### Rule 7: Cloud Function cost safety
- No function was changed in this project, so the notifications audit
  (`NOTIFICATIONS_REVIEW.md` §1, rule 5) still holds.
- New *client* database reads, which you approved:
  - the "No signal" check: one document per page open, plus one every
    30 s while the app is on screen (`connection.js:177`);
  - the warm-up: about 36 documents per phone per hour of use
    (`offline-ready.js:57`).
  - Rough worst case: 16 phones × 10 h a day × (120 + 36) reads, about
    25,000 reads a day, around $0.02 a day.

### Rule 8: both platforms
- Built only from features iPhone (iOS 16.4+) and Android browsers support:
  IndexedDB, service workers, the Cache API and MessageChannel. Tested in
  desktop Chrome only.
- **Not tested on a real iPhone or Android.** Section 2 is that test.

### Rule 9: phone first, comments, plan first, ask
- I checked 360, 390 and 430 px with no sideways scrolling, and the warning's
  OK button is 44 px. Widths were checked in a resizable frame, because the
  Chrome window wouldn't shrink below 500 px.
- Each new file starts with a plain-language explanation, and standard
  practices are labelled as such.
- Every stage began with a plan and questions. These decisions were yours:
  the banner's position and wording, the badges, the warning and its OK
  button, the auth fix, skipping empty sides, the 30-second check, the
  3-second limit, the PDFs, the More-menu line, the 12-hour window, the
  warm-up and the checker.

---

## 2. Real-phone test (after deploying stages 1 and 2)

One iPhone (Home Screen app) and one Android (Chrome), in that order. This
uses a **throwaway match in Round 4, Match 8**, which gets wiped
afterwards.

### Before you start: three checks
1. **Only you (and the Android owner) have alerts on.** Firebase console →
   Firestore → database **ryder-cup-tracker** → `pushSubscriptions`. Count
   the documents with `enabled: true`. If anyone else is on, they'll get the
   test alerts. Wait, or warn them.
2. **Alerts are switched on overall:** `notificationConfig` → `global` →
   `enabled: true`.
3. **On both phones, Alerts → What to send → Every hole** for the test, so
   you see each hole's alert. Note your usual setting so you can put it back.

### Set up the throwaway match
4. On your iPhone, open **Admin** → **R4 Singles** → **Match 8**. Pick
   **yourself** on one side.
   - On the other side, pick the Android owner if they're on the other team.
   - Otherwise, pick anyone. The Android phone will then enter its scores
     using the admin code instead (step 14).
   - Tap **Save pairing**.

### iPhone (Home Screen app)
5. **On wifi**, open Cup Tracker from its Home Screen icon. Open
   **Round 4** and make sure you're picked as yourself (top of the page).
   Tap **More**. Expect **"✓ Ready for offline · scores from [time]"**. If it
   says "Not ready", leave the app open for a minute and check again.
6. Turn on **airplane mode** (and make sure wifi is off too).
7. **Force-quit** the app: swipe up from the bottom, then swipe the app away.
   Open it again from the icon. **Expect:** it opens, with the grey
   **"No signal · last connected …"** strip above the tab bar.
8. Go to **Round 4 → Match 8** and enter **holes 1–4**: tap − / + and
   **Save** each time. **Expect:** each Save moves to the next hole at once,
   and the card says **"⏳ Holes 1, 2, 3, 4 saved on this phone · will send
   when you have signal"**.
9. **Force-quit** again and reopen, still in airplane mode. **Expect:**
   holes 1–4 are still in the hole grid and the match status, and still
   marked as waiting.
10. Turn **airplane mode off**. **Expect:**
    - within a few seconds, the line changes to **"✓ Sent"**, then
      disappears, and the strip goes away;
    - **alerts arrive in a quick burst, one per hole.** Each hole save
      syncs as its own save, so 4 holes means 4 alerts within seconds, in
      hole order. They share a tag, so **each replaces the one before**:
      several buzzes, but only "… hole 4" stays on the lock screen. (In the
      emulator, 8 synced holes sent 8 alerts like this.)
    - (Not in this test, but on the course: if a burst finishes a nine,
      that save sends **"Match 8 front 9: …"** instead of the hole alert.) It has its own tag, so it
      stays as a separate notification.
11. **Second phone sees them:** on the Android, open Round 4. Match 8 shows
    holes 1–4 and the same status.

### Android (Chrome)
12. **On wifi**, open the site in Chrome (or the installed app). Open
    **Round 4**.
    - If the Android owner is in Match 8, make sure their own name is
      picked.
    - If not, unlock with the admin code **now**, while on wifi, because
      unlocking needs signal: Admin page → enter code. You'll switch back
      in step 21.
    - Tap **More** and expect **"✓ Ready for offline"**.
13. Turn on **airplane mode**, then close Chrome completely: Recents button,
    swipe Chrome away. Reopen it on the site. **Expect:** it opens, with the
    strip.
14. Go to **Round 4 → Match 8** and enter **holes 5–8**. Same
    expectations as step 8.
15. Close Chrome completely and reopen, still offline. Holes 5–8 should
    still be there and waiting.
16. Airplane mode off. Same expectations as step 10: "✓ Sent", 4 alerts on
    phones with alerts on, and the iPhone shows holes 5–8.

### Optional: weak signal
17. Somewhere with one bar (or in a lift or basement), save a hole. After
    about 8 s the card should say "saved on this phone", and the strip
    should appear a few seconds later.

### Clean up (do all of it)
18. Firebase console → Firestore → **ryder-cup-tracker** → `rounds` →
    `round4` → `matches` → **match8** → ⋮ → **Delete document**. This
    removes the test scores and pairing. When you later save the real
    Match 8 pairing in Admin, the match is recreated empty.
19. `notificationLog` → delete **every** document whose name starts with
    **`2027_round4_match8_`**: normally 8, `hole1` to `hole8` (plus `front`
    if you scored hole 9 too).
    - **Don't skip this.** Each alert is sent once per trip year, so
      leftover entries would silence those alerts for the real Match 8 on
      singles day.
20. On both phones, set **Alerts → What to send** back to your usual choice.
21. If the Android used the admin code: on any round page, tap **Use a
    different code** / **Not you? Switch**, and pick the owner's own name.
22. **Expect a few leftover notes later.** When you save the real Round 4
    pairings and open Round 4 on the two test phones, Match 8 will show
    amber notes like **"Hole 3 has no score on the server, but this phone
    entered …"** for the test holes.
    - That's the score-loss safety net noticing the test scores vanished,
      which is exactly what it's for.
    - Tap **OK** on each (up to 4 per phone). It doesn't happen to anyone
      else.

---

## 3. Morning routine (for the group)

Plain text, ready to paste into the group chat. (Kept out of
`ALERTS_GROUP_MESSAGE.md`, as you chose.)

---

⛳ Before we tee off each morning, on the hotel wifi: open Cup Tracker the way you'll use it on the course (the Home Screen icon if you added it — it doesn't share storage with Safari). Tap More and check it says "✓ Ready for offline". If it says Not ready, leave the app open on wifi for a minute and check again. If you'll be entering scores, open your round and pick your name now, because that one step needs signal. On the course, save scores as normal even with no bars: they're kept on your phone and send by themselves the next time you have signal with the app open. A grey "No signal" strip means other groups' scores may be out of date.

---

## 4. Left undone or uncertain

**Not yet seen working on a real phone**
- Everything in section 2. In particular:
  - the iPhone Home Screen app reopening after a force-quit with holes
    still waiting;
  - Android Chrome, Samsung Internet and Firefox;
  - a real weak signal, rather than my simulated one.
- **A real push through the new service worker** (stage 2 deploy step 5).
- **The keyboard staying open while typing.** The round page now redraws
  slightly more often, each time sync status changes.
- **Two phones entering different scores for the same hole while both
  offline.** The warning was tested by simulating the second phone, not
  with two real phones (you need a full roster for that).
- **Scorecard PDFs offline on iPhone.** Stored and served in the emulator,
  but Safari's PDF viewer wasn't tested.

**Known limits, by design**
- **The first open must be online.** The app can only be stored on a phone
  after one visit with signal.
- **Waiting scores send when the app is open with signal**, never while
  it's closed. Websites can't send in the background on iPhone.
- **Picking your name needs signal**, so do it at the hotel.
- **Kohler's "Yardage guide" and "How to play" links don't work offline.**
  They're another website.
- **"As of" times are approximate.** The banner's "last connected" time is
  when this phone last reached the server. A round page not opened since
  could show older scores, although the hourly warm-up keeps all rounds
  fairly fresh.
- **A save refused after the app was closed** is described as "changed on
  another phone", because the refusal itself can't be seen after a reload.
- **Warnings are only noticed when that round's page is opened.**
- **Slow wifi can trigger stored copies.** One 3-second timeout puts the
  next 30 seconds on stored copies, even if the wifi was only slow.
- **Several queued holes arrive as a burst of alerts** (section 2, step 10).
  That's expected, not a bug.
- **Firebase doesn't guarantee alert order.** Alerts for a burst arrived in
  hole order in the emulator, but the real service may occasionally deliver
  two out of order. Each alert's text is still correct for its own hole.

**On every future deploy**
- Changing existing files needs nothing extra. Keep bumping `?v=` as usual.
- **Adding, renaming or deleting a file in `public/`:**
  1. Run `npm --prefix functions run check-offline`.
  2. Fix `PRECACHE_FILES` in `firebase-messaging-sw.js`.
  3. Bump `CACHE_VERSION` by 1.
