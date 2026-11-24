Ground rules for the notifications project (apply to every step):

1. Never run `firebase deploy` (hosting, functions, rules, indexes), never write to the live Firestore, and never send a real push notification. Test only with the Firebase emulators, using the named database `ryder-cup-tracker` (not "(default)"). I deploy myself; at the end of each stage give me an exact numbered checklist of what to run.
2. Allowed to add: an Alerts page, a nav entry, a web manifest, a service worker, a new Firestore collection `pushSubscriptions` with rules for ONLY that collection, a `functions/` folder, and the firebase.json/.firebaserc additions needed for them. One tiny edit to auth.js is allowed: adding the word `export` to `ensureSignedIn`. Do NOT change existing rules (unlocks, players, rounds, matches), the behavior or exports of scoring.js, the sign-in flows in auth.js, rounds-config.js, or the look or class names of existing pages.
3. The website stays plain HTML/CSS/JS with no build step, loading Firebase modules from gstatic as it does today. Only the functions/ folder uses Node and npm.
4. Reuse, don't rewrite: all score logic comes from scoring.js, team helpers from match-ui.js (teamKey, teamName, teamPillHtml, avatarHtml, formatPoints), styling from the existing tokens and classes in style.css.
5. Cost safety: a function must never write to a document it listens to; it must tolerate being called twice for the same event; set a low maxInstances; delete dead notification tokens; no loops or uncapped retries.
6. Both platforms must work. iPhone/iPad: iOS/iPadOS 16.4+ Home Screen web apps only (permission must be requested from a direct tap; Safari is the recommended browser). Android: Chrome primarily, plus Samsung Internet and Firefox, from a normal tab or installed. On both, every push the service worker receives must show a visible notification immediately, including when the app is open, because iOS can revoke permission otherwise.
7. Phone first, comment generously (I have a strong math background, little software-engineering experience), show your plan checklist before changing anything, and ask me about any decision I haven't already made instead of picking silently.

## Restyle rules (finished, do NOT apply to current work)

Ground rules for this restyle (apply to every step):

1. Design only. Do not change scoring logic (scoring.js), Firestore reads/writes, auth, firestore.rules, or rounds-config.js. Do not run `firebase deploy` and do not write any data to Firestore. I will deploy myself.
2. Several pages are built by JavaScript template strings (index.js, scoreboard.js, round.js). Keep every id, data- attribute and class name that other JS depends on, unless you update every place that uses it. Search the whole public/ folder before renaming or deleting anything.
3. Plain HTML/CSS/JS only: no frameworks, no build step, ES modules as today. Google Fonts via <link> is the only external resource allowed.
4. Phone first. Design for a 390px-wide screen, check 360px and 430px, no horizontal page scrolling, tap targets at least 44px.
5. Comment generously. I have a strong math background but little software-engineering experience. Explain what each CSS block and JS function does and why, in plain language.
6. Before changing anything, show me your plan as a short checklist. Ask me about any decision I haven't already made instead of picking silently.
7. Preview locally with `firebase emulators:start --only hosting` and check the result at phone width before reporting done.
