# Claude Code prompts: offline play, score-change log, day-of polish

Paste these into Claude Code one at a time, in order. Finish, review and
deploy each stage before starting the next. Suggested git branch: `offline`.

Every stage ends with Claude Code handing you a numbered deploy checklist.
Nothing here asks it to deploy.

---

## Prompt 0: New ground rules (run first)

```
We're starting a new project on this app: making it work with little or no
cell signal on the course, then an admin-only score-change log, then some
day-of usability polish. Please update CLAUDE.md:

1. Move the current "Ground rules for the notifications project" section
   under a heading "## Notifications rules (finished, do NOT apply to
   current work)", just as the restyle rules were archived. Leave the
   restyle section as it is.
2. Add this new section at the top, word for word:

## Ground rules for the offline + score-log project (apply to every step)

1. Never run `firebase deploy` (hosting, functions, rules, indexes), never
   write to the live Firestore, and never send a real push notification.
   Test only with the Firebase emulators, using the named database
   `ryder-cup-tracker`. I deploy myself; at the end of each stage give me an
   exact numbered checklist of what to run.
2. Never lose a score. Assume phones spend long stretches with NO signal,
   and that the first visit of each day is probably on hotel wifi. Saving a
   hole must never wait on the network before letting the player move on.
   Nothing may delete or overwrite existing score data unless I asked for it.
3. Allowed to change: firebase-init.js (cache settings), the save flow in
   round.js, nav.js (registering the service worker on every page),
   firebase-messaging-sw.js (adding offline caching ALONGSIDE the push code),
   admin.html/admin.js (new sections), and new files of your own (for
   example js/connection.js). Allowed to add a new Firestore collection
   with rules for ONLY that collection.
   Do NOT change: scoring.js, rounds-config.js, the existing rules for
   unlocks/players/rounds/matches, the sign-in flows in auth.js, or the look
   or class names of existing elements, unless you first explain exactly
   what and why, and I say yes.
4. Push notifications must keep working exactly as they do now. Any edit to
   the service worker must leave the push and notificationclick behavior
   identical, and every push must still show a visible notification
   immediately.
5. The website stays plain HTML/CSS/JS with no build step, loading Firebase
   modules from gstatic. Only functions/ uses Node and npm.
6. Reuse, don't rewrite: score logic from scoring.js, team helpers from
   match-ui.js, styling from the existing tokens and classes in style.css.
7. Cost safety for any Cloud Function: never write to a document it
   listens to, tolerate being called twice for the same event, low
   maxInstances, no loops or uncapped retries.
8. Both platforms: iPhone (iOS 16.4+ Home Screen app, and Safari) and
   Android (Chrome first, then Samsung Internet and Firefox).
9. Phone first, comment generously (strong math background, little
   software-engineering experience), show your plan checklist before
   changing anything, and ask me about any decision I haven't already made
   instead of picking silently.

Don't change any other files in this step. Show me the new CLAUDE.md when
you're done.
```

---

## Prompt 1: Offline scores (data layer + save flow)

```
Stage 1 of the offline project. Goal: a player can enter scores for a whole
nine with no signal, and they reach everyone else automatically once the
phone finds signal again, even if the app was closed in between.

What I know so far (please confirm by reading the code):
- firebase-init.js uses getFirestore(), so unsent writes live only in
  memory and are lost if the page reloads or the phone kills it.
- In round.js the "save-hole" handler does `await updateDoc(...)`. With no
  signal that promise doesn't resolve until the server confirms, so I think
  the screen gets stuck: the draft isn't cleared and it doesn't advance to
  the next hole.
- Scores are written per hole with field paths (holes.N.a / holes.N.b),
  so two phones editing different holes of one match don't clobber each
  other.

Please:
1. Read firebase-init.js, auth.js, round.js, index.js, scoreboard.js and
   any other page that reads Firestore. Explain in plain language what
   happens today, page by page, when the phone has no signal.
2. Propose a plan to:
   a. Switch to Firestore's persistent offline cache (initializeFirestore
      with persistentLocalCache, and whichever tab manager you recommend),
      so unsent scores survive a reload or the app being closed.
   b. Change the save flow so that tapping Save counts as saved on the
      phone right away (no waiting on the server), while still catching and
      showing a real error (for example a rules rejection once it syncs).
   c. Show each hole's sync state on the round page: something like
      "Saved on phone, will send when you have signal" vs "Sent". Use
      Firestore's hasPendingWrites / fromCache snapshot metadata rather than
      guessing.
   d. Show a small, calm banner on every page when we're offline or
      showing cached data, for example "No signal: showing scores as of
      10:42". Other groups' scores can't update while we're offline, so
      people need to know what they're looking at is old.
   e. Check that sign-in still works offline. Anonymous auth should
      restore from the phone, but what happens if ensureSignedIn() runs
      with no saved user and no signal? It must not break the page.
3. Questions to ask me before building (give me your recommendation for
   each):
   - Where the sync badge goes on the match card and what it says.
   - Whether the offline banner shows on every page or only Home,
     Scoreboard and the round pages.
   - What happens if two people enter different scores for the SAME hole
     while both are offline (last one to sync wins today). Is a warning
     worth adding, or leave it?
   - Anything else you find that I haven't decided.
4. After I approve, build it, then test with the emulators using Chrome
   DevTools' Offline switch, at phone width:
   enter 3 holes offline, reload the page while still offline, confirm the
   3 holes are still there and marked pending, go back online, confirm they
   sync and the badges flip to sent. Also test that the admin page still
   saves pairings.
5. End with the numbered deploy checklist (hosting only, I think) and a
   short list of anything not yet verified on a real phone.
```

---

## Prompt 2: App opens with no signal (offline app shell)

```
Stage 2 of the offline project. Goal: once someone has opened the app
once on wifi, it still opens and shows the last known scores with no
signal at all, on iPhone Home Screen and Android.

Background:
- public/firebase-messaging-sw.js is currently only a push-notification
  service worker. It has no fetch handler, so nothing is cached.
- It is only registered from alerts.js, so anyone who never opened the
  Alerts page has no service worker at all.
- There can only be one service worker per scope, so caching has to be
  added to this same file without disturbing the push code (ground rule 4).
- The pages load Firebase modules from www.gstatic.com and fonts from
  Google Fonts, which are other websites, so they need caching too or the
  app will break offline.
- firebase.json sends no-cache headers for html/css/js, so updates reach
  people quickly today. I want to keep that when online.

Please:
1. Explain in plain language how a service worker cache works and the
   main caching strategies (cache-first, network-first,
   stale-while-revalidate), with a recommendation for each kind of file:
   our pages, our JS/CSS, the gstatic Firebase modules, Google Fonts,
   icons, and the scorecard PDFs.
2. Propose a plan to:
   a. Register the service worker on every page (nav.js loads everywhere,
      so it's probably the place), without changing how the Alerts page
      asks for notification permission.
   b. Pre-cache the whole app on first visit (every page and script it
      needs), so a player who only ever opened Home still has the round
      pages offline.
   c. Handle updates safely: how a new deploy reaches phones, and how we
      avoid a phone stuck on old code. Explain the cache version number and
      whether I need to bump it by hand on each deploy (no build step).
   d. Add a small "Ready for offline ✓" indicator, maybe on the Alerts
      or More menu, so each guy can check it at the hotel before teeing
      off.
3. Questions to ask me before building (with your recommendation):
   - The caching strategy for each file type.
   - Whether the scorecard PDFs are pre-cached (bigger download) or
     only cached once opened.
   - Where the "Ready for offline" indicator lives and what it says.
   - iOS specifics I should know about, such as Safari vs Home Screen
     storage and storage being cleared after long non-use.
4. After I approve, build it. Test in the emulators at phone width with
   DevTools Offline: open Home online, go offline, open each round page,
   the scoreboard and the roster, then reload. Confirm the push code is
   untouched by comparing the push and notificationclick handlers to the
   current version. Re-run the existing notification tests in functions/.
5. End with the numbered deploy checklist, including anything I must do
   on each future deploy (like bumping a cache version).
```

---

## Prompt 3: Offline rehearsal and review doc

```
Stage 3 of the offline project: review and rehearsal, no new features.
Write OFFLINE_REVIEW.md, modelled on NOTIFICATIONS_REVIEW.md:

1. An audit of stages 1 and 2 against each CLAUDE.md ground rule, with
   the file and line that shows each is met.
2. A real-phone test script I can run myself after deploying, on one
   iPhone (Home Screen app) and one Android (Chrome), in this order:
   open on wifi and check "Ready for offline"; airplane mode; open the app
   cold; enter several holes; force-quit the app; reopen still in airplane
   mode; confirm the holes are there and pending; turn signal back on;
   confirm they sync and a second phone sees them; confirm the push
   alerts for those holes arrive (and say what to expect when several
   holes sync at once).
   Since we can't write to live data during testing, explain how to run
   this against a throwaway test match I set up in the Admin page, and
   how to clean it up afterwards.
3. A one-paragraph "morning of each round" routine for the group (open
   the app on hotel wifi, check the indicator), written so I can paste it
   into ALERTS_GROUP_MESSAGE.md or a group text. Ask me before editing
   ALERTS_GROUP_MESSAGE.md.
4. A "Left undone or uncertain" list.

No code changes in this stage unless the audit finds a bug, and in that
case show me the bug and the fix first.
```

---

## Prompt 4: Score-change log (admin only)

```
Next project stage: an admin-only log of every score change, so on-course
disputes are easy to settle. It should show who changed which hole of
which match, from what to what, and when. It only needs to be visible on
the Admin page, behind the admin code. Regular players never see it.

Constraints to keep in mind:
- Stage 1 means scores are often entered offline and sync later, so a
  "when" recorded on the server is the sync time, not when the player
  tapped Save. I'd like to see both if practical.
- Today a score-level visitor may only change the `holes` field of a
  match (firestore.rules). Ground rule 3 says don't change the matches
  rules without my OK.
- "Who" today is honor-system: the name the browser picked on the "Who
  are you?" screen (unlocks/{uid}.playerId), plus the browser's anonymous
  uid.

Please:
1. Lay out the realistic ways to build this, with pros and cons in plain
   language. At least:
   a. The phone writes a log entry to a new collection (for example
      scoreEdits) in the same batch as the score.
   b. A Cloud Function (alongside notifyOnMatchUpdate, or inside it)
      compares before/after and writes the log entry server-side.
   c. A mix: the client stamps who/when, the function records
      before/after.
   For each one: can a player fake or skip it, does it work offline, does
   it need a matches-rule change, and what does it cost.
2. Give me your recommendation, then ask me to choose.
3. Also ask me whether corrections should send a push alert (for example
   "Correction: Match 2, hole 7 is now USA 4, EU 5"). Today a corrected
   hole sends no alert, so an earlier alert can be wrong. If yes, how
   should it work with the existing alert levels and on/off settings?
4. Design the Admin page view: newest first, filter by round and match,
   with a clear marker on any hole that was changed after it was first
   entered. Show me a plan before building.
5. After I approve: build it, add firestore.rules for ONLY the new
   collection (admin can read; nobody can edit or delete entries), add
   emulator tests like the existing ones in functions/test/, rehearse in
   the emulators, and end with the numbered deploy checklist.
```

---

## Prompt 5: Day-of usability polish

```
Next stage: small usability improvements for the trip itself. Design and
behavior only; no changes to scoring.js, rounds-config.js or the rules.
For each item, show me a before/after description and ask me before
building:

1. Home page scoreboard: right now "Matches complete: 0 of 20" sits next
   to "30½ to win", which mixes matches and points. Propose clearer
   wording, for example points still in play and what each team needs to
   win outright (30½) or to reach a 30–30 tie. Use the existing totals from
   rounds-config.js / scoring.js; don't add new scoring logic.
2. "Your match" first: once a browser has picked a name, should the app
   open the current round with your match on screen? Propose how "current
   round" is decided (day and time from schedule-config.js? first round
   with unfinished matches?) and ask me.
3. Score entry tap count: count the taps it takes today to enter one hole
   for each format (scramble/greensomes single box, best ball per
   player, singles). Suggest ways to cut that down without making
   mistakes easier, and ask me which to do.
4. Anything else you notice while doing this that would bother 16 guys
   on a walking-only 36-hole Friday. List them; don't build them.

Check at 360, 390 and 430px wide in the hosting emulator. End with the
numbered deploy checklist.
```

---

## Prompt 6: Housekeeping

```
Housekeeping only; don't change the app's behavior.

1. List every file and folder in the project root that isn't part of the
   live app or its docs (for example GolfScoreboard.zip,
   golf-trip-tracker.zip, golf-trip-site/, "AZ Rider cup website.html",
   firestore-debug.log, .DS_Store files). For each, say what it seems to
   be and recommend keep, move to an archive/ folder, add to .gitignore, or
   delete. Ask me before doing anything with them.
2. Update README.md with real setup, emulator and deploy instructions
   (it still says "will be added here"), pulling from
   NOTIFICATIONS_DEPLOY.md and the offline docs rather than repeating them.
3. Add a short "Untested platforms" checklist to the README for the
   things still unverified for push and offline: Android Chrome itself,
   Samsung Internet, Brave, and iPhones older than iOS 16.4.
```
