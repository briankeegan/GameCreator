importScripts("../../shared/sw-core.js");

// Deliberately doesn't list the ~20 ship/enemy/weapon PNGs under icons/ —
// sw-core's fetch handler is network-first-then-cache (see shared/sw-core.js),
// so every art asset gets cached the first time it's actually fetched
// online, without bloating install time or needing this list kept in sync
// with every new icon. Only assets that must work on a first-ever OFFLINE
// launch (before anything's had a chance to be fetched once) belong here.
// BUMP THIS ON EVERY DEPLOY OF THIS GAME. The fetch handler is
// network-first and falls back to cache on ANY failed fetch — which on a
// phone is a dropped packet, not an offline device — so a single hiccup
// pins one file at whatever was cached and the page then runs a mix of two
// builds. The version is what makes `install` refetch the precache list, and
// it sat at v78 across every change this game has ever had: a player could be
// reading a levels.js from weeks ago while app.js was current, and nothing in
// the game or the deploy check could see it. gate_sw_version fails a push
// that changes shipped files without changing it.
GCRegisterServiceWorker("hypergolic-hull-v79", [
  "./",
  "./index.html",
  "./style.css",
  "./levels.js",
  "./engine.js",
  "./app.js",
  "./manifest.webmanifest",
  "../../shared/nav.js",
  "../../shared/nav.css",
  "../../shared/pwa.js",
  "../../shared/storage.js",
  "./icons/icon.svg",
]);
