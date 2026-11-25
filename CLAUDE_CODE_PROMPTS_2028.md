# Claude Code prompts: reusing the tracker in 2028

**When:** after the 2027 trip is over. Don't run any of these during the trip.

**Decisions already made (Stephen, Nov 2026):**
- **Rollover:** a script freezes 2027 into a `HISTORY_2027` file, the same way
  2026 is stored, saves a raw backup, then clears the live data for 2028. The
  database structure stays as it is (not split by year).
- **Setup is a hybrid:** courses, tees, schedule and notes stay in the config
  files, edited with a runbook and a checker script. Things that change from
  year to year are edited on the Admin page.
- **Alerts and "Who are you?" picks** are cleared for everyone as part of the
  rollover reset (Prompt 3), after a backup. The roster mostly carries over,
  so returning players keep their records.
- **Must change without code edits:** group size (not always 16, 8 a side),
  team names and colors (not always Team USA red and Team EU blue), and the
  players themselves (people join, skip a year, come back).

Paste these into Claude Code one at a time, in order. Suggested git branch:
`rollover`. Each stage ends with a numbered checklist of what you need to run.

---

## Prompt 0: Ground rules for the rollover project

```
The 2027 trip is over. We're starting a new project: making this app reusable
for 2028 and later years. Please update CLAUDE.md: archive whatever
project rules are current under a "(finished, do NOT apply to current work)"
heading, just as the earlier ones were archived, and add this new section at
the top, word for word:

## Ground rules for the rollover project (apply to every step)

1. Never run `firebase deploy`, never write to the live Firestore, never send
   a real push. Test only with the emulators on the named database
   `ryder-cup-tracker`. Any script that touches live data is run by ME,
   never by you. A script that writes or deletes live data must have a
   dry-run mode that is the default, and must refuse to run until a backup
   file for the same data exists. At the end of each stage give me an exact
   numbered checklist of what to run.
2. 2027 must be preserved exactly. Nothing is deleted from live data until
   (a) the raw backup exists and (b) the frozen HISTORY_2027 numbers have been
   checked against the live app's stats page and I've approved them.
3. Past years stay correct. The 2026 history and all-time stats must show
   the same numbers before and after every change. Players are matched across
   years by full name (personSlug), as today.
4. Keep the year in ONE place. Anything that says "2027" should come from a
   single setting (plus the generated copy in functions/ that already exists
   for this).
5. Don't change scoring.js's scoring rules. Generalizing it for different
   match counts or team names is fine, but a Nassau match must score the same
   as today. Show me any change to scoring.js before making it.
6. Push notifications and offline mode must keep working exactly as now.
7. Plain HTML/CSS/JS, no build step, Firebase from gstatic. Only functions/
   and scripts/ use Node.
8. Phone first, comment generously (strong math background, little
   software-engineering experience), show your plan checklist before
   changing anything, and ask me about any decision I haven't already made
   instead of picking silently.
```

---

## Prompt 1: Inventory everything tied to one year

```
Stage 1, read-only, no code changes: find everything in the project that
assumes a particular year, team, group size or trip. Search public/,
functions/, firestore.rules, the manifest, the service worker and the docs.

Things I already know about (confirm these, then find the rest):
- CURRENT_YEAR = 2027 in public/js/match-ui.js, copied into
  functions/trip-year.js by scripts/sync.js
- "2027 Ryder Cup Trip" hard-coded in index.html's <title> and header
- history-data.js holds the frozen 2026 trip; its comments describe adding
  HISTORY_2027 by hand
- rounds-config.js, courses-config.js and schedule-config.js hold the trip
  setup
- the alerts function builds event IDs like "2027_round2_match2_hole7"
- team names, colors and "USA"/"EU" keys in match-ui.js, style.css and the
  alerts text
- the match counts (4 / 4 / 4 / 8) and the "30½ to win" number: are
  they calculated, or typed in?

Give me a table: file, line, what it assumes, and which bucket it falls
into:
  A. set once per year in a config file (runbook)
  B. should move to the Admin page (team names/colors, group size and
     match counts, roster)
  C. should be calculated instead of typed in
  D. leave alone
Then list the decisions you need from me, with your recommendation for each.
```

---

## Prompt 2: Freeze 2027 into history (read-only script)

```
Stage 2: a script, scripts/freeze-year.mjs, that turns this year's live data
into a frozen history entry, in the same shape as HISTORY_2026 in
history-data.js.

Requirements:
1. READ-ONLY against Firestore. It writes nothing to the database.
2. It saves a raw backup of everything first: players, every round's
   matches, scoreEdits, and any config docs. It saves them as dated JSON
   files in a backups/ folder (add backups/ to .gitignore).
   pushSubscriptions holds per-phone tokens, not trip data, so ask me
   whether it gets backed up.
3. It computes each player's numbers (rounds played, total strokes,
   points, birdies, best round, W-L-H record counting front/back/overall
   separately) using the SAME definitions as player-stats.js. Import that
   code or factor it out so both use one copy; don't write a second version
   of the maths.
4. It writes public/js/history/HISTORY_2027.js (or wherever you recommend;
   ask me) and adds it to PAST_TRIPS. The label is something like "2027 —
   Wisconsin (Whistling Straits & Blackwolf Run)", taken from
   schedule-config.js.
5. It prints a comparison table: each player's frozen numbers next to what
   the live Stats page shows, and flags any difference.
6. Explain how I run it against live data (which credentials, read-only),
   and how you test it against the emulators. Seed the emulator with
   realistic fake data: reuse public/demo/ if you can, and include players
   with 2026 history so all-time merging gets tested.

Show me the plan first. Ask me how to handle edge cases you find (for
example a player who played only some rounds, a match never finished, or
handicap strokes).
```

---

## Prompt 3: Reset for the new year (guarded script)

```
Stage 3: scripts/new-year-reset.mjs, which clears last year's live data so
the next trip starts empty.

Requirements:
1. Dry run by default: it prints exactly what it WOULD delete or change,
   with counts.
2. It refuses to run for real unless (a) a backup from freeze-year.mjs
   exists for the same year and (b) HISTORY_<year>.js exists and is listed in
   PAST_TRIPS. It also needs an explicit --confirm flag that includes the
   year.
3. It deletes all matches and scoreEdits. It keeps the players
   collection, because most of the roster carries over year to year: a
   returning player must keep the same player record (same ID, same name
   spelling), so his history, player card and all-time stats line up
   without any re-entry. It only resets each player's team. Ask me what
   should happen to: Unconfirmed/Confirmed status, players who aren't
   coming back (delete, or mark inactive so they can come back later
   without losing anything?), and the admin code in /secrets.
4. Decided: it clears everyone's alerts and "Who are you?" picks so the
   new year starts fresh:
   - pushSubscriptions: back up (tokens included, in backups/, which is
     git-ignored), then delete every document. No more alerts go to any
     phone until each guy opens Alerts and signs up again. Phones keep
     their notification permission and the installed app, so signing up
     again should be one tap; confirm that's true on iPhone and Android and
     tell me if it isn't.
   - unlocks: back up, then delete every document, so no phone is still
     signed in as a player (or as admin) for score entry. Everyone
     picks their name again from the roster, which will mostly be the same
     people. I'll need to re-enter the admin code on my phone.
   - Same safeguards as the rest of this script: shown in the dry run with
     counts, and only done with --confirm.
   - Check that the Alerts page and the "Who are you?" picker handle a
     phone whose document has disappeared: no errors, just the normal
     first-time screen.
5. It bumps the year setting (or tells me exactly where to change it).
6. Test it on the emulators right after a freeze-year.mjs test run, then
   confirm the app shows an empty 2028 with 2026 and 2027 under Stats, and
   the all-time numbers match the totals from before the reset. Also test
   that a returning player can pick his name, re-subscribe to alerts and
   receive a test push.
```

---

## Prompt 4: Admin page — team names, colors and group size

```
Stage 4: move the things that change from year to year onto the Admin page,
as decided: team names and colors, group size / match counts, and the
roster (the roster is already on Admin; check it covers adding, removing and
bringing back a returning player by name).

Before building, explain and ask me about:
1. Where these settings live. My guess is one Firestore doc, e.g.
   config/trip, that anyone can read and only admin can write, with rules
   for ONLY that doc.
2. Team names and colors: how the existing red/blue CSS (style.css
   tokens, team pills, header cards, the push notification text and icons)
   would read colors from settings instead of being fixed. Offer a small
   set of good-looking color presets rather than a free color picker, and
   check that text stays readable on both. Keep "usa"/"europe" (or
   whatever) as internal team keys if renaming them would break past
   history; show me the trade-off.
3. Group size: what happens with an odd number of players or uneven teams
   (someone sits out a round? a 3-man side?). Today every round has a fixed
   match count. Lay out options; I'll choose.
4. Whether the match counts come from the roster size automatically or
   are set on Admin per round.
5. Make sure the points total and the number needed to win ("30½") are
   calculated from the match counts, not typed in.

After I approve, build it, test on the emulators at 360/390/430px, run the
existing tests, and give me the deploy checklist (rules + hosting, and
functions if the alerts text changed).
```

---

## Prompt 5: New-year setup runbook + config checker

```
Stage 5: make setting up a new year's courses and schedule quick and safe.

1. Write scripts/check-config.mjs, which loads rounds-config.js,
   courses-config.js and schedule-config.js and checks, at minimum:
   every round has a course; each course has 18 holes; stroke indexes are
   exactly 1–18 with no repeats; pars are 3–5 and the total is sensible;
   the tee named for each round exists in that course's tee chart (yardage,
   rating, slope); every scorecard PDF named exists in public/scorecards/;
   the formats are ones scoring.js knows how to score. Print plain-English
   errors ("Round 3, hole 7: stroke index 4 is used twice").
2. Write NEW_YEAR_SETUP.md: a numbered runbook from "trip is over" to
   "ready for next year": freeze → check numbers → reset → edit configs →
   run checker → Admin settings → roster → deploy → each guy re-checks
   Alerts and "Ready for offline". Include a ready-to-paste Claude Code
   prompt for the "edit configs" step, where I give it the new courses,
   tees, dates and formats and it fills in the three files and runs the
   checker.
3. Ask me whether old scorecard PDFs and old course data get removed
   from public/ or moved to an archive folder.
```

---

## Prompt 6: Full dress rehearsal

```
Stage 6, no new features. On the emulators, rehearse a full rollover from
start to finish, following NEW_YEAR_SETUP.md exactly as written:
seed a fake complete 2027 → freeze → compare → reset → set up a made-up
2028 with different team names/colors, 14 players, and a different course →
enter a few holes → check Home, Scoreboard, a round page, Stats (2026, 2027,
2028, all-time), a player card, and that a test push still fires.

Fix the runbook wherever reality didn't match it, and list everything you
changed. Write ROLLOVER_REVIEW.md with: what was tested, anything still
untested on real phones or live data, and a "Left undone or uncertain"
list.
```
