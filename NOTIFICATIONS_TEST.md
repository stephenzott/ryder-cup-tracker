# Score alerts: real-device test checklist

Site: **https://the-cup-tracker.web.app/alerts.html**

Words in **bold** are exactly what the page or phone shows. Use the test
button for everything: it sends only to the phone that taps it, and never
scores a match. **Don't score a real match to test alerts** (each alert is
sent only once per trip year).

To see a phone's saved settings: Firebase console → Firestore →
**ryder-cup-tracker** → `pushSubscriptions` → the newest document (it has
`playerId`, `level`, `scope`, `platform`, `installed`, `enabled`).

---

## The standard checks (do these on every device below)

| # | Check | Pass when |
|---|---|---|
| 1 | **Install flow** (where it applies; see each device) | App icon "Cup Tracker" (crossed flags) on the Home Screen; opens full screen with no browser bars |
| 2 | **Permission prompt** | Nothing asks for permission when the page loads. Pick your name, tap **Notify me about scores** → the phone's own "Allow notifications?" prompt appears → tap **Allow** |
| 3 | **Switch on** | Switch turns navy, hint says **On for this phone.**, status shows **Saved**, and **Send me a test notification** appears |
| 4 | **Test, phone locked, app fully closed** | Tap the test button (**Sent. Check your lock screen.**), then swipe the app away completely and lock the phone. Within ~10 s: **Test notification** / **Score alerts are working on this phone.** with the flags icon |
| 5 | **Test, app open** | Wait a minute (the button is locked for 60 s), tap it again and stay on the page. A notification still appears (banner at the top). It must never be silent while the app is open |
| 6 | **Tap the notification** | Opens Cup Tracker on the **Alerts** page (the test points there; score alerts point at the Scoreboard, see "Checking the Scoreboard tab" below) |
| 7 | **Change Level and Scope** | Pick **Every hole** and **My team's scores**, wait for **Saved**, close the app completely, reopen → More → Alerts: both still selected. Firestore shows `level: "hole"`, `scope: "mine"`. Put them back to what you want |
| 8 | **Switch off → silence** | Turn the switch off → **Saved**; the test button disappears. Firestore shows `enabled: false`, `token: ""`. Nothing can reach this phone now |
| 9 | **Deny permission → recovery steps** | Block notifications for the app/site (see each device), reopen Alerts → the switch is off and greyed, and the recovery box appears (wording below). Follow its steps to allow again, reopen, switch on, test again |

---

## Devices

### A. iPhone, Safari, added to the Home Screen (the main one)
Needs iOS 16.4 or newer (Settings → General → About → iOS Version).
1. **Install:**
   - Open the link in **Safari**. The page shows **Add this site to your
     Home Screen first** and the settings are greyed.
   - Share button → **Add to Home Screen** → **Add**.
   - Close Safari and open **Cup Tracker** from the icon → More → Alerts.
     The settings are now usable.
2. Do checks 2–8.
3. **Check 9 (deny):** iPhone **Settings → Notifications → Cup Tracker** →
   turn off **Allow Notifications**. Reopen Alerts → **Notifications are
   turned off for this app** with three steps. Turn it back on there,
   reopen, switch on, test.
4. **Extra:** open the link in **Chrome** on the iPhone (not installed).
   You should see the same Home Screen steps plus **You're using Chrome.
   These steps are easiest in Safari…**

### B. iPhone, link opened inside another app
Send yourself the link in **Instagram, Facebook, Messenger, LinkedIn,
Snapchat or the Google app** and tap it there.
- [ ] The page shows **Open this page in Safari first** and hides the
      settings.
- [ ] **Copy link** says **Copied**, and the link pasted into Safari works.
      (If an app blocks copying: **Press and hold the link above to copy
      it.**)
- Note: iMessage, Mail and WhatsApp usually open real Safari, so they won't
  show this message. That's fine.

### C. iPhone older than iOS 16.4 (only if someone has one)
- [ ] In Safari: the Home Screen steps appear (Safari can't tell it's too old yet).
- [ ] After adding it and opening from the icon: **This iPhone's software is
      too old for alerts** with a link to the **Scoreboard**. Settings
      greyed. That's the expected end state; updating iOS fixes it.

### D. Android, Chrome, normal tab (not installed)
1. Open the link in **Chrome**. The settings are usable straight away.
   There's an **Install the app (recommended)** card below the switch and
   an **Android tips** card.
2. Do checks 2–8. For check 4, swipe Chrome away completely and lock the
   phone.
3. **Check 9 (deny):** tap the icon left of the address → **Permissions**
   (or **Site settings**) → **Notifications** → **Block**. Reload Alerts →
   **Notifications are blocked for this site** with the Android steps.
   Allow again, reload, switch on, test.

### E. Android, Chrome, installed
1. **Install:**
   - On the Alerts page: the **Install Cup Tracker** button (it appears
     once Chrome offers installing, often after ~30 s on the site and a
     tap), or the steps on the card (**⋮** → **Install app** or **Add to
     Home screen**).
   - Open **Cup Tracker** from its icon → More → Alerts. The Install card
     is gone; Android tips remain.
2. If this phone already did D, alerts may already be on (same Chrome
   storage). Tap the test button anyway.
3. Do checks 2–8. In Firestore, `installed` should now be `true`. It updates
   the next time the Alerts page opens in the installed app.
4. **Check 9 (deny):** press and hold the **Cup Tracker** icon → **App
   info** → **Notifications** → off. Reopen Alerts → recovery steps.
   Turn back on, test.

### F. Android, Samsung Internet or Firefox (if anyone uses them)
- Same as D (and E for installing). The Install card shows browser-specific
  steps:
  - Samsung Internet: **≡** → **Add page to** → **Home screen**.
  - Firefox: **⋮** → **Install** or **Add to Home screen**.
- Firefox on Android already passed the test push (2026-11-24).

---

## Checking the Scoreboard tab (score alerts' tap target)

Score alerts open `/scoreboard.html#roundN`. To see this without scoring a
match, use a desktop Chrome that has alerts switched on for the site:
1. Open https://the-cup-tracker.web.app/alerts.html, pick a name, switch
   on, Allow.
2. Press **F12** (or right-click → Inspect) → **Application** tab →
   **Service workers**.
3. In the **Push** box paste
   `{"data":{"title":"USA wins hole 7","body":"Match 2 · test","tag":"t","url":"/scoreboard.html#round2"}}`
   and click **Push**.
4. A notification appears. Click it, and the Scoreboard opens on the
   **Round 2** tab.

This is a fake push made inside your own browser, so nothing is sent
anywhere. On phones, check this with the first real alert of the trip.

---

## Troubleshooting

**The test says "Sent" but nothing appears**
- **Focus / Do Not Disturb:**
  - iPhone: swipe down Control Center → Focus. If one is on, allow Cup
    Tracker in that Focus (Settings → Focus → [name] → Apps → add Cup
    Tracker), or turn Focus off.
  - Android: Settings → Notifications → **Do Not Disturb** → allow Cup
    Tracker / the browser, or turn it off.
- **iPhone notification style:** Settings → Notifications → Cup Tracker →
  check Lock Screen, Notification Center and Banners are ticked.
- **Android notification channel:** long-press the notification (or Chrome
  → App info → Notifications). Make sure the site's channel isn't
  silenced.

**Alerts arrive late (Android)**
- Settings → Apps → **Chrome** (or **Cup Tracker** if installed) →
  **Battery** → **Unrestricted**.
- Samsung phones also have Settings → Battery → **Background usage
  limits**: make sure Chrome / Cup Tracker isn't on the "Sleeping apps" or
  "Deep sleeping apps" list.

**Brave browser**
- Brave's Settings → **Privacy and security** has a setting like **"Use
  Google services for push messaging"**. It must be on for web push to
  arrive. (The exact name couldn't be confirmed from Brave's docs, so look
  for something close to it.) The Alerts page shows this hint only in
  Brave.

**"Token not registered" / alerts stopped after reinstalling or clearing data**
- Removing the Home Screen app, reinstalling it, or clearing Safari/Chrome
  website data gives the phone a **new browser id**. The old subscription
  is dead (the server switches it off automatically the next time it tries
  to send).
- Fix: open Alerts again, pick your name, switch on, Allow, test. Old
  settings don't carry over; it's a fresh start.
- If the test says **This phone's alert registration has expired. Turn
  alerts off and on again.**, do exactly that.

**Permission was revoked or blocked**
- The Alerts page shows the recovery steps for that phone. After allowing
  notifications again, the switch is **off**. Turn it back on (that gets a
  new token).
- iPhone: if Cup Tracker doesn't appear under Settings → Notifications at
  all, the app was never allowed. Open it from the Home Screen icon,
  switch on, and tap **Allow**.

**Other messages on the test button**
- **Alerts are paused by the organizer.** The kill switch is off
  (`notificationConfig/global` → `enabled`).
- **Turn alerts on first.** The switch is off, or the save didn't finish.
  Toggle it.
- **Please wait a minute between test notifications.** Expected; wait 60 s.
- **internal**: the function's public-access permission is missing. See
  `NOTIFICATIONS_DEPLOY.md`, step 5.

**Still stuck?** Have them open
`https://the-cup-tracker.web.app/alerts.html?debug` → **Check my setup** →
**Copy diagnostics**, and send you the text. It shows platform, browser,
installed, permission, service worker and saved settings, plus only the
last 6 characters of the token.
