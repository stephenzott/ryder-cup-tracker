Ground rules for this restyle (apply to every step):

1. Design only. Do not change scoring logic (scoring.js), Firestore reads/writes, auth, firestore.rules, or rounds-config.js. Do not run `firebase deploy` and do not write any data to Firestore. I will deploy myself.
2. Several pages are built by JavaScript template strings (index.js, scoreboard.js, round.js). Keep every id, data- attribute and class name that other JS depends on, unless you update every place that uses it. Search the whole public/ folder before renaming or deleting anything.
3. Plain HTML/CSS/JS only: no frameworks, no build step, ES modules as today. Google Fonts via <link> is the only external resource allowed.
4. Phone first. Design for a 390px-wide screen, check 360px and 430px, no horizontal page scrolling, tap targets at least 44px.
5. Comment generously. I have a strong math background but little software-engineering experience. Explain what each CSS block and JS function does and why, in plain language.
6. Before changing anything, show me your plan as a short checklist. Ask me about any decision I haven't already made instead of picking silently.
7. Preview locally with `firebase emulators:start --only hosting` and check the result at phone width before reporting done.