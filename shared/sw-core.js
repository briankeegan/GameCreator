// Shared offline-caching logic. Each game's own sw.js (service worker scope
// is per-directory, so every game needs its own file) calls into this:
//
//   importScripts("../../shared/sw-core.js");
//   GCRegisterServiceWorker("my-game-v1", [ "./", "./index.html", ... ]);
//
// Network-first so updates arrive when online; falls back to cache offline.
function GCRegisterServiceWorker(cacheName, assets) {
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(cacheName).then((cache) => cache.addAll(assets)).then(() => self.skipWaiting())
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== cacheName).map((k) => caches.delete(k))))
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
  });
}
