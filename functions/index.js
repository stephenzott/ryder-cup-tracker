// Cloud Functions for score alerts.
//
//   notifyOnMatchUpdate   runs when a match document changes and pushes
//                         alerts to subscribed phones
//   sendTestNotification  the Alerts page's "Send me a test notification"
//
// The decisions (which events happened, who gets which) live in
// events.js, which has no Firebase code and is unit-tested on its own.
// This file is the plumbing around it: reading Firestore, sending via
// Firebase Cloud Messaging (FCM), and the safety checks.
//
// SAFETY RULES this file follows (see CLAUDE.md rule 5):
//   - It NEVER writes to matches, players or rounds. Its only writes are
//     notificationLog (dedupe), testPushLimits (rate limit) and, for a
//     dead token, that one pushSubscriptions document's enabled/token.
//     So it can't trigger itself: it only listens to matches.
//   - Running twice for the same change sends nothing the second time
//     (notificationLog, below).
//   - maxInstances 5, no automatic retries, no loops over unbounded data.
//   - A kill switch (notificationConfig/global.enabled) stops everything.
//   - Under the emulators, a mock sender is ALWAYS used: real FCM is
//     unreachable from local testing.

import { setGlobalOptions, logger } from "firebase-functions/v2";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

import { detectEvents, pickEvent, teamFromValue, buildMessage, logId, TEST_MESSAGE } from "./events.js";
import { ROUNDS } from "./rounds-config.js";
// The trip year (from public/js/match-ui.js's CURRENT_YEAR, via sync).
import { CURRENT_YEAR } from "./trip-year.js";

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------

// The app's NAMED database. Without this the Admin SDK would read the
// "(default)" database, which belongs to your other app.
const DATABASE_ID = "ryder-cup-tracker";

// The database lives in "nam5" (US multi-region); Firebase's locations
// table pairs nam5 with us-central1 for functions.
const REGION = "us-central1";

// FCM accepts at most 500 messages per sendEach call.
const BATCH_SIZE = 500;

// How long FCM keeps trying to deliver to a phone that's offline
// (seconds), and the delivery urgency, as web-push headers.
const WEBPUSH_HEADERS = { TTL: "3600", Urgency: "high" };

// The test button may be used once per this many milliseconds.
const TEST_COOLDOWN_MS = 60 * 1000;

// Applies to every function in this file.
setGlobalOptions({ region: REGION, maxInstances: 5, memory: "256MiB", timeoutSeconds: 30 });

initializeApp();
const db = getFirestore(DATABASE_ID);

// True when running inside `firebase emulators:start` (the emulator sets
// this environment variable). Used to force the mock sender.
const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";

// ==================================================================
// SENDING
// ==================================================================

// Real sender: FCM's sendEach, one message per phone, in batches of 500.
// Returns one result per message: { success: true } or
// { success: false, error }.
async function fcmSend(messages) {
  const results = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const response = await getMessaging().sendEach(batch);
    results.push(...response.responses);
  }
  return results;
}

// Mock sender for the emulators: logs who WOULD be notified (by uid and
// title, never the token) and reports success. Real FCM is never called.
// For testing the dead-token cleanup locally, a token starting with
// "dead-" is answered the way FCM answers an uninstalled phone.
async function mockSend(messages, labels) {
  return messages.map((m, i) => {
    if (m.token.startsWith("dead-")) {
      logger.info(`[mock push] to ${labels[i]}: pretending the token is dead`);
      return { success: false, error: { code: "messaging/registration-token-not-registered" } };
    }
    logger.info(`[mock push] to ${labels[i]}: "${m.data.title}" | ${m.data.body.replace(/\n/g, " / ")} | tag=${m.data.tag} url=${m.data.url}`);
    return { success: true };
  });
}

// The one sender everything goes through. `labels` is a parallel list
// of non-secret descriptions (uid · platform) for the mock's log.
function sendMessages(messages, labels) {
  return IS_EMULATOR ? mockSend(messages, labels) : fcmSend(messages);
}

// A data-only web push: no "notification" key, so the service worker's
// own push handler is the only thing that displays it. FCM requires
// every data value to be a string.
function webPushMessage(token, data) {
  return {
    token,
    data: { title: String(data.title), body: String(data.body), tag: String(data.tag), url: String(data.url) },
    webpush: { headers: WEBPUSH_HEADERS },
  };
}

// Is this send error a sign the TOKEN is dead (phone uninstalled, alerts
// cleared, token expired)? Only token-specific errors count: a plain
// "invalid-argument" can also mean our MESSAGE was malformed, which must
// not switch off everyone's alerts, so it counts only if FCM's message
// says the registration token itself is the problem.
function isDeadTokenError(error) {
  const code = error?.code || "";
  if (code === "messaging/registration-token-not-registered") return true;
  if (code === "messaging/invalid-registration-token") return true;
  if (code === "messaging/invalid-argument" && /registration token/i.test(error?.message || "")) return true;
  return false;
}

// Switch off one subscription whose token is dead: enabled=false,
// token="". This is the ONLY write to pushSubscriptions. It's done in a
// transaction that first checks the token is still the dead one, so a
// phone that re-enabled alerts with a fresh token in the meantime isn't
// switched off by mistake.
async function disableDeadToken(uid, deadToken) {
  const ref = db.collection("pushSubscriptions").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get("token") === deadToken) {
      tx.update(ref, { enabled: false, token: "" });
    }
  });
}

// Is the kill switch on? Only notificationConfig/global with
// enabled === true allows sending; missing doc or anything else = off.
async function alertsAllowed() {
  const snap = await db.collection("notificationConfig").doc("global").get();
  return snap.exists && snap.get("enabled") === true;
}

// ==================================================================
// THE MATCH TRIGGER
// ==================================================================

// Try to claim one event in notificationLog. create() fails if the
// document already exists, which is exactly the "already handled" test:
// if this function runs twice for the same change, the second run finds
// the log entry and skips. It's claimed BEFORE sending, on purpose: if
// something fails after this, an alert is missed rather than sent twice.
async function claimEvent(roundId, matchId, event) {
  try {
    await db.collection("notificationLog").doc(logId(CURRENT_YEAR, roundId, matchId, event)).create({
      year: CURRENT_YEAR,
      roundId,
      matchId,
      key: event.key,
      level: event.level,
      gainTeam: event.gainTeam,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    // gRPC code 6 = ALREADY_EXISTS.
    if (error?.code === 6 || /already exists/i.test(error?.message || "")) return false;
    throw error;
  }
}

// The whole job for one match update, written as a plain function of
// its inputs so it can also be tested without the trigger machinery:
//   before, after      the match document's data before/after the change
//   roundId, matchId   from the document path
// Returns a summary object (also used for the log line).
export async function handleMatchUpdate({ before, after, roundId, matchId }) {
  const summary = { roundId, matchId, events: [], recipients: 0, sent: 0, failed: 0, dead: 0, byPlatform: {} };

  // Only real rounds (a stray document elsewhere is ignored).
  if (!ROUNDS.some((r) => r.id === roundId)) return { ...summary, skipped: "unknown round" };

  // 1. What happened? Most saves (a single stroke typed in, half a
  //    best-ball pair, a correction) produce no events: stop here with
  //    no further reads.
  const events = detectEvents(before, after);
  if (events.length === 0) return { ...summary, skipped: "no events" };

  // 2. Kill switch, read once per run.
  if (!(await alertsAllowed())) return { ...summary, events: events.map((e) => e.key), skipped: "kill switch off" };

  // 3. Dedupe: keep only events this run successfully claimed.
  const fresh = [];
  for (const event of events) {
    if (await claimEvent(roundId, matchId, event)) fresh.push(event);
  }
  summary.events = fresh.map((e) => e.key);
  if (fresh.length === 0) return { ...summary, skipped: "already handled" };

  // 4. Everyone with alerts on and a token.
  const subsSnap = await db.collection("pushSubscriptions").where("enabled", "==", true).get();
  const subs = subsSnap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((s) => typeof s.token === "string" && s.token.length > 0);
  if (subs.length === 0) return { ...summary, skipped: "no subscribers" };

  // 5. Player records: subscribers' teams (looked up NOW, so admin team
  //    changes apply immediately) and the match players' names.
  const playerIds = new Set([...subs.map((s) => s.playerId), ...(after.sideA || []), ...(after.sideB || [])].filter(Boolean));
  const playerSnaps = playerIds.size ? await db.getAll(...[...playerIds].map((id) => db.collection("players").doc(id))) : [];
  const players = Object.fromEntries(playerSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
  const namesById = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, p.name]));

  // 6. One message per subscriber: their highest-priority eligible event.
  const messages = [];
  const targets = []; // parallel to messages: { uid, token, platform }
  for (const sub of subs) {
    const team = teamFromValue(players[sub.playerId]?.team);
    const event = pickEvent(fresh, sub, team);
    if (!event) continue;
    messages.push(webPushMessage(sub.token, buildMessage(event, { roundId, matchId, after, namesById })));
    targets.push({ uid: sub.uid, token: sub.token, platform: sub.platform || "unknown" });
  }
  summary.recipients = messages.length;
  if (messages.length === 0) return summary;

  // 7. Send, then count results and clean up dead tokens.
  const results = await sendMessages(messages, targets.map((t) => `${t.uid} · ${t.platform}`));
  for (let i = 0; i < results.length; i++) {
    const { platform, uid, token } = targets[i];
    if (results[i].success) {
      summary.sent++;
      summary.byPlatform[platform] = (summary.byPlatform[platform] || 0) + 1;
    } else {
      summary.failed++;
      if (isDeadTokenError(results[i].error)) {
        summary.dead++;
        await disableDeadToken(uid, token);
      } else {
        logger.warn(`Send failed (${results[i].error?.code || "unknown"}) for ${uid}`);
      }
    }
  }
  return summary;
}

// One concise line per run, never including tokens. Example:
//   round2/match2 events=front,hole9 recipients=9 sent 9: ios 5, android 3, unknown 1; failed 0 (dead 0)
function summaryLine(s) {
  const platforms = Object.entries(s.byPlatform).map(([p, n]) => `${p} ${n}`).join(", ");
  const base = `${s.roundId}/${s.matchId} events=${s.events.join(",") || "none"}`;
  if (s.skipped) return `${base} skipped: ${s.skipped}`;
  return `${base} recipients=${s.recipients} sent ${s.sent}${platforms ? `: ${platforms}` : ""}; failed ${s.failed} (dead ${s.dead})`;
}

// The trigger itself. onDocumentUpdated fires only for UPDATES (not
// creations or deletions), which is what we want: a new, empty match
// has nothing to announce.
export const notifyOnMatchUpdate = onDocumentUpdated(
  { document: "rounds/{roundId}/matches/{matchId}", database: DATABASE_ID },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { roundId, matchId } = event.params;
    const summary = await handleMatchUpdate({ before, after, roundId, matchId });
    logger.info(summaryLine(summary));
  }
);

// ==================================================================
// THE TEST BUTTON
// ==================================================================

// Called from the Alerts page. Sends one test push to the CALLER's own
// subscription only (their uid comes from their sign-in, so nobody can
// push to anyone else). Errors are HttpsError, whose message the page
// shows as-is.
export const sendTestNotification = onCall(async (request) => {
  // 1. Signed in? (Every visitor is signed in anonymously by the site.)
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please reload the page and try again.");

  // 2. Kill switch applies here too.
  if (!(await alertsAllowed())) throw new HttpsError("failed-precondition", "Alerts are paused by the organizer.");

  // 3. Their subscription must be on, with a token.
  const subSnap = await db.collection("pushSubscriptions").doc(uid).get();
  const sub = subSnap.exists ? subSnap.data() : null;
  if (!sub?.enabled || !sub?.token) throw new HttpsError("failed-precondition", "Turn alerts on first.");

  // 4. Rate limit: once a minute, recorded in testPushLimits/{uid}. A
  //    transaction makes "check the time, then record the new time" one
  //    step, so two quick taps can't both slip through.
  const limitRef = db.collection("testPushLimits").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(limitRef);
    const last = snap.exists ? snap.get("lastSentAt") : null;
    if (last && Date.now() - last.toMillis() < TEST_COOLDOWN_MS) {
      throw new HttpsError("resource-exhausted", "Please wait a minute between test notifications.");
    }
    tx.set(limitRef, { lastSentAt: Timestamp.now() });
  });

  // 5. Send it.
  const platform = sub.platform || "unknown";
  const [result] = await sendMessages([webPushMessage(sub.token, TEST_MESSAGE)], [`${uid} · ${platform}`]);
  if (!result.success) {
    if (isDeadTokenError(result.error)) {
      await disableDeadToken(uid, sub.token);
      throw new HttpsError("failed-precondition", "This phone's alert registration has expired. Turn alerts off and on again.");
    }
    logger.warn(`Test send failed (${result.error?.code || "unknown"}) for ${uid}`);
    throw new HttpsError("internal", "Couldn't send the test notification. Try again in a minute.");
  }
  logger.info(`test push sent to ${uid} · ${platform}`);
  return { ok: true };
});
