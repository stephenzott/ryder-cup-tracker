# Deploying score alerts (notifications stages 1b + 2)

Run these yourself, in this order, from the project folder
(`Ryder Cup Tracker/`). Nothing here has been run for you.

**Before you start:** be on the `notifications` branch (or have it merged)
so the files below are the new ones. If `functions/node_modules` is missing
(for example on a fresh clone), run `npm install` inside `functions/` first.

---

## 1. Upgrade the project to the Blaze (pay-as-you-go) plan

Firebase console → project **golf-tracker-data** → bottom-left **Spark** /
**Upgrade** → choose **Blaze** and link a billing account.

Cloud Functions require Blaze. **This project is shared with your other app**
(the one using the "(default)" database), so Blaze covers that app too. Its
free allowances are the same as Spark's; you're only billed beyond them.

## 2. Create a budget alert (about $5)

Google Cloud console → **Billing** → **Budgets & alerts** → **Create budget**:
- Scope: project **golf-tracker-data**
- Amount: **$5** (specified amount)
- Alert thresholds: the defaults (50%, 90%, 100%) are fine

A budget only **emails** you. It doesn't stop spending. The real off switch
is step 9.

## 3. Turn alerts on (the kill switch)

Firebase console → **Firestore Database** → choose the **ryder-cup-tracker**
database (top of the page, not "(default)") → **Start collection**:
- Collection ID: `notificationConfig`
- Document ID: `global`
- Field: `enabled`, type **boolean**, value **true**

Without this document the function sends nothing, by design.

## 4. Deploy the Firestore rules

```
firebase deploy --only firestore:rules
```

Then in the console (ryder-cup-tracker database → **Rules**), check that the
`pushSubscriptions` block mentions `platform` and `installed`.

> From this moment until step 6 finishes, the live Alerts page's saves are
> rejected (the new rules need the 8-field shape the new page sends). Do
> steps 5 and 6 straight away. Nobody loses settings; a save just fails
> until the new page is live.

## 5. Deploy the functions

```
firebase deploy --only functions
```

This first runs the sync step (copies `public/js/scoring.js` and
`rounds-config.js` into `functions/`), then uploads two functions to
**us-central1**: `notifyOnMatchUpdate` and `sendTestNotification`.

The first functions deploy enables several Google Cloud APIs (Cloud
Functions, Cloud Build, Artifact Registry, Eventarc, Cloud Run…) and may ask
you to confirm. **If it fails with a permissions error about the Firestore
trigger (Eventarc), wait a few minutes and run the same command again.**
That's normal on a project's first trigger.

**If the test button (step 8) says just "internal"**, the function's "anyone
may call" permission didn't get set during the deploy (this happened on the
first deploy here; the function's logs say "The request was not
authenticated"). Add it once, with Google's `gcloud` tool:

```
gcloud run services add-iam-policy-binding sendtestnotification --region=us-central1 --project=golf-tracker-data --member=allUsers --role=roles/run.invoker
```

That's the normal setting for a Firebase callable function: the code itself
checks the caller's sign-in and only sends to their own phone.

**If you have to wait before retrying, do step 6 (hosting) first** and come
back to this step. The two are independent, and the live Alerts page can't
save settings until step 6 is done (see the note under step 4).

## 6. Deploy the website

```
firebase deploy --only hosting:ryder
```

This ships the stage 1b Alerts page (install card, Android tips, `?debug`
card, the 8-field saves), the stage 2 test button, the Android status-bar
badge and the updated manifest.

## 7. Auto-delete old function container images

Each functions deploy stores a container image, which costs a little
storage. Keep only recent ones:

```
firebase functions:artifacts:setpolicy --location us-central1
```

The default deletes images older than 1 day (add `--days 7` to keep a week).

## 8. Smoke test on one iPhone and one Android phone

On each phone:
1. iPhone: open Cup Tracker **from the Home Screen icon**. Android: open the
   site in Chrome (installed or not).
2. More → **Alerts** → pick your name → turn on **Notify me about scores**.
3. Tap **Send me a test notification**. You should see "Sent. Check your
   lock screen." and get a notification titled **Test notification**.
   Tapping it should open the Alerts page.
4. Optional: in the console, open **Functions → Logs** and look for the
   line `test push sent to … · ios` (or `android`).

**Check the wording.** The notification must say **"Test notification" /
"Score alerts are working on this phone."** If it instead says **"Cup
Tracker" / "New score update"**, a notification still arrived, but the
service worker didn't find the text where it expected it in the message.
Tell me: that means the real message shape differs from what the code
assumes (Firebase's docs don't show it; I matched the Firebase SDK's own
code). Alerts would still arrive, just with that generic text, until it's
fixed.

**Don't test score alerts by scoring a real match on the live site.** Each
alert is sent once per trip year: a test "USA wins hole 7" in round 2
match 2 means the real one won't be sent during the trip. If that happens
anyway, delete those entries before the trip: Firestore → ryder-cup-tracker
→ `notificationLog` → delete the documents starting with this year (e.g.
`2027_round2_match2_…`), or the whole collection.

If something's off, open `https://the-cup-tracker.web.app/alerts.html?debug`
on that phone, tap **Check my setup → Copy diagnostics** and send it to me.

## 9. Stop all alerts instantly

Firebase console → Firestore → **ryder-cup-tracker** → `notificationConfig` →
`global` → set `enabled` to **false**.

From the next match update on, nothing is sent, and the test button says
"Alerts are paused by the organizer." Set it back to **true** to resume.
Changes made while paused are never sent later.

---

## Next year

The function stamps its "already sent" records with `CURRENT_YEAR` from
`public/js/match-ui.js`. Changing that one number for the new trip (part of
the normal new-year setup) makes alerts start fresh. Redeploy functions
afterwards (`firebase deploy --only functions`) so the function picks up
the new year. Old `notificationLog` entries can be deleted any time.

## Testing locally (never touches the live project)

From `functions/`:
- `npm test`: the alert logic tests (plain Node, no emulator).
- `npm run test:rules`: the Firestore rules tests (needs Java on PATH:
  `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`).

To run everything in the emulators, run `npm run sync` in `functions/`
once first (the copied files aren't in git, so a fresh clone doesn't have
them), then from the project folder:
`firebase emulators:start --only hosting,firestore,auth,functions`.
Under the emulators the function never contacts real FCM: it only logs
`[mock push] …` lines.
