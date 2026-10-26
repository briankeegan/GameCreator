importScripts("../../shared/sw-core.js");

// Deliberately doesn't list the ~20 ship/enemy/weapon PNGs under icons/ —
// sw-core's fetch handler is network-first-then-cache (see shared/sw-core.js),
// so every art asset gets cached the first time it's actually fetched
// online, without bloating install time or needing this list kept in sync
// with every new icon. Only assets that must work on a first-ever OFFLINE
// launch (before anything's had a chance to be fetched once) belong here.
// THE VERSION IS ONE NUMBER DOING BOTH JOBS: it is what the header shows
// the player, and it is what makes `install` refetch the precache list. They
// were two different things and so they drifted — the badge said v1 from the
// day the game shipped while this said v78, and neither moved again. The
// fetch handler is network-first but falls back to cache on ANY failed fetch,
// which on a phone is a dropped packet rather than an offline device, so one
// hiccup pinned a single file at whatever was cached and the page ran a mix
// of two builds with nothing able to see it.
//
// Bump it on every deploy of this game, and move index.html's data-version
// with it. gate_sw_version fails a push that does either without the other.
GCRegisterServiceWorker("hypergolic-hull-v83", [
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
