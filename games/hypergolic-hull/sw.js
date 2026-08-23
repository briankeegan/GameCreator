importScripts("../../shared/sw-core.js");

// Deliberately doesn't list the ~20 ship/enemy/weapon PNGs under icons/ —
// sw-core's fetch handler is network-first-then-cache (see shared/sw-core.js),
// so every art asset gets cached the first time it's actually fetched
// online, without bloating install time or needing this list kept in sync
// with every new icon. Only assets that must work on a first-ever OFFLINE
// launch (before anything's had a chance to be fetched once) belong here.
GCRegisterServiceWorker("hypergolic-hull-v18", [
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
