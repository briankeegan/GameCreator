importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("hypergolic-hull-v5", [
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
