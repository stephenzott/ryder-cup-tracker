# Day-of pain points

Things noticed during Prompt 5 (day-of usability polish, commit `1c9da7a`)
that could bother 16 players on a walking-only, 36-hole Friday.

**Status (2026-11-25, branch `pain-points`):**
- **Built:** items 1, 2 and 7 (see "What was built" at the bottom).
- **Covered in person:** items 3, 4, 8 and 9 go in your talk the day before
  the tournament.
- **Skipped (your decision):** item 5. If you're offline, you're offline.
- **Moved to `CLAUDE_CODE_PROMPTS_2028.md`:** item 6, under Prompt 1 (the
  inventory) and Prompt 4 #5 (worked out from settings), along with the
  typed-in "4 rounds" in the same sentence.

| # | Pain point | Why it matters | Possible fix | Effort |
|---|---|---|---|---|
| 1 | **Long round pages.** Every match card shows in full; yours is first, but Saturday's 8-match page is a long scroll. | Finding another group's match, or scrolling past it, takes effort with one hand on a cart. | Collapse other matches into one-line rows (tap to expand). | Medium |
| 2 | **No undo / no blanking a wrong save.** A score saved on the wrong hole can be overwritten but not cleared by a player, since empty boxes are no longer written (stage 1 choice). | A wrong-hole save leaves a score on a hole that wasn't played yet, until someone re-enters it. | An admin-only "clear this hole" button, logged in the score-change log. | Small–medium |
| 3 | **Two people scoring one match.** Both sides can enter any hole, so two phones may enter the same hole. | The amber "changed on another phone" warnings catch it, but it's avoidable noise. | **Group rule:** one scorer per match (e.g. the USA player or team). No code. | None |
| 4 | **Picking your name is per browser and needs signal.** The Home Screen app and Safari each need it done separately. | Someone who adds the Home Screen icon on the course can't unlock without signal. | Already in the morning routine (`OFFLINE_REVIEW.md` §3). Repeat it in the group message. | None |
| 5 | **Kohler "Yardage guide" / "How to play" links leave the app.** On iPhone Home Screen apps they open a browser sheet, and they don't work offline. | A small surprise on the course, especially with no signal. | Label them "(needs signal)", or hide them while offline. | Small |
| 6 | **"16 players" is typed into the Home intro sentence.** It isn't counted from the roster. | Wrong if the field size changes next year. | Count players from the roster (or a config value). | Small |
| 7 | **The best-ball card is tall** (about 1,050 px with the quick picks). | More scrolling between holes in round 3 than in other rounds. | A tighter best-ball layout (e.g. quick picks only for the box being edited). | Medium |
| 8 | **Screen auto-lock between shots.** Nothing is lost (it reopens on the same page and works out the current hole again), but frequent unlocking adds taps. | Minor friction all day. | Suggest players set auto-lock to 5 minutes for the round. No code. | None |
| 9 | **Alert bursts after a dead zone.** Several holes syncing at once buzz several times in a row (one alert per hole; each replaces the last on the lock screen). | People may think something's broken. | **One line in the group message** explaining it. No code. | None |

## Suggested group-message lines (for items 3, 8 and 9)

Plain text, ready to paste:

> One person per match enters the scores (say the USA side), so two phones don't fight over the same hole. If your screen keeps locking, set Auto-Lock to 5 minutes for the round. And if you get a burst of score alerts all at once, that's just a phone that was out of signal catching up.

## What was built (branch `pain-points`, not yet deployed)

- **Item 1, collapsed matches:** on round pages every match starts as a
  one-line row (match, names, status), except your own, which starts
  open.
  - Tap a row to open it, and ▴ to close it. A match you open stays open
    until you leave the page.
  - A closed row shows ⚠ or ⏳ if that match has a warning or scores
    waiting to send.
  - Unpaired slots are one slim line too.
- **Item 2, admin "Clear hole":** admin-unlocked browsers see "Clear hole N
  (admin)" under Save when the hole on screen has a score.
  - It takes two taps: the first turns it red, "Tap again to clear hole 7
    (USA 5 – EU 4)"; a second tap within 5 seconds clears it.
  - The score log records it as cleared, with who and when. No alert is
    sent.
  - Any other phone that had entered that hole shows "Hole 7 was cleared
    by the organizer…".
- **Item 7, best ball:** one quick-pick row for the active (outlined)
  player instead of four 2×2 grids.
  - Picking a number moves on to the next player; tap a name or box to
    jump.
  - The card is 922 px instead of 1,056.
