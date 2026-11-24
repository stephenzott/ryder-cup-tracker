// Checks the service worker's list of files to pre-download for offline
// use (PRECACHE_FILES in public/firebase-messaging-sw.js) against the
// files that actually exist in public/. Offline project, stage 2.
//
// WHY: the site has no build step, so that list is written by hand. If
// a new page or script is added to public/ but not to the list, phones
// won't have it offline; if a file is deleted but stays in the list,
// phones keep trying (and failing) to download it. This script spots
// both. It only READS files; it never changes anything.
//
// Run from the project folder with:
//   npm --prefix functions run check-offline
//
// If it reports differences: edit PRECACHE_FILES in the service worker,
// bump CACHE_VERSION there by 1, and run this again.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "..", "public");
const workerFile = join(publicDir, "firebase-messaging-sw.js");

// Files in public/ that are deliberately NOT pre-downloaded:
//   - the service worker itself (the browser manages it),
//   - the demo page (not deployed; see "ignore" in firebase.json),
//   - the icon source drawings (.svg; the site uses the .png exports),
//   - macOS's hidden .DS_Store files.
function ignored(path) {
  return (
    path === "/firebase-messaging-sw.js" ||
    path === "/demo.html" ||
    path.startsWith("/demo/") ||
    (path.startsWith("/icons/") && path.endsWith(".svg")) ||
    path.split("/").some((part) => part.startsWith("."))
  );
}

// Every file under public/, as "/path/from/site/root".
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listFiles(full);
    return ["/" + relative(publicDir, full).split(sep).join("/")];
  });
}

// Pull the quoted paths out of the block between the two marker
// comments in the service worker.
const worker = readFileSync(workerFile, "utf8");
const block = worker.split("// PRECACHE-LIST-START")[1]?.split("// PRECACHE-LIST-END")[0];
if (!block) {
  console.error("Couldn't find the PRECACHE-LIST-START / -END markers in firebase-messaging-sw.js.");
  process.exit(1);
}
const listed = new Set([...block.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]));
listed.delete("/");   // "/" is the Home page's address, stored as /index.html

const onDisk = new Set(listFiles(publicDir).filter((path) => !ignored(path)));

const notListed = [...onDisk].filter((path) => !listed.has(path)).sort();
const notOnDisk = [...listed].filter((path) => !onDisk.has(path)).sort();

if (notListed.length === 0 && notOnDisk.length === 0) {
  console.log(`OK: all ${onDisk.size} files in public/ are in the offline list, and nothing extra.`);
  process.exit(0);
}
if (notListed.length) {
  console.log("In public/ but NOT in the offline list (add them):");
  for (const path of notListed) console.log(`  ${path}`);
}
if (notOnDisk.length) {
  console.log("In the offline list but NOT in public/ (remove them):");
  for (const path of notOnDisk) console.log(`  ${path}`);
}
console.log("Then bump CACHE_VERSION in public/firebase-messaging-sw.js by 1.");
process.exit(1);
