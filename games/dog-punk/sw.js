importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("dog-punk-v1", [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "../../shared/nav.js",
  "../../shared/nav.css",
  "../../shared/pwa.js",
  "../../shared/storage.js",
  "./icons/icon.svg",
  "./hero.png",
  "./enemy-rat.png",
]);
