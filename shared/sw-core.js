// Shared offline-caching logic. Each game's own sw.js (service worker scope
// is per-directory, so every game needs its own file) calls into this:
//
//   importScripts("../../shared/sw-core.js");
//   GCRegisterServiceWorker("my-game-v1", [ "./", "./index.html", ... ]);
//
// Network-first so updates arrive when online; falls back to cache offline.
//
// { isolate: true } makes the game's pages cross-origin isolated, which is
// what lets them use SharedArrayBuffer (worker threads that share memory).
// Pages cannot send the headers from GitHub Pages, so the worker adds them to
// every same-origin response; a cross-origin one must then be CORS (fetch) or
// carry its own Cross-Origin-Resource-Policy, or the browser refuses it. The
// page's pwa.js tag carries data-isolate so the first visit, which the worker
// does not control yet, reloads once under it.
function GCRegisterServiceWorker(cacheName, assets, opts) {
  const isolate = !!(opts && opts.isolate);
  function withHeaders(response) {
    if (!isolate || !response || response.type === "opaque" || response.status === 0) return response;
    if (new URL(response.url || self.location.href).origin !== self.location.origin) return response;
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
  }
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
          return withHeaders(response);
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }).then(withHeaders))
    );
  });
}
