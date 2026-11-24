# Day-of pain points (not built)

Things noticed during Prompt 5 (day-of usability polish, commit `1c9da7a`)
that could bother 16 players on a walking-only, 36-hole Friday. **None of
these are built.** They're here so you can decide later. Items 3 and 9 need
no code, just a line in the group message.

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
