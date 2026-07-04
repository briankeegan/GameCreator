importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("trace-v2", [
  "./",
  "./index.html",
  "./style.css",
  "./engine.js",
  "./app.js",
  "./manifest.webmanifest",
  "../../shared/nav.js",
  "../../shared/nav.css",
  "../../shared/pwa.js",
  "../../shared/storage.js",
  "./icons/icon.svg",
  "./icons/cat.png",
  "./icons/player.png",
  "./icons/pin-avocado.png",
  "./icons/pin-star.png",
  "./icons/pin-paw.png",
]);
