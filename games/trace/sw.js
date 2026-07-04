importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("trace-v4", [
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
  "./icons/pin-avocado.png",
  "./icons/pin-star.png",
  "./icons/pin-paw.png",
  "./icons/pin-fish.png",
  "./icons/pin-yarn.png",
]);
