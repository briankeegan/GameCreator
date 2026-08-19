importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("the-game-v8", [
  "./",
  "./index.html",
  "./style.css",
  "./story.js",
  "./app.js",
  "./manifest.webmanifest",
  "../../shared/nav.js",
  "../../shared/nav.css",
  "../../shared/pwa.js",
  "../../shared/storage.js",
  "./icons/icon.svg",
]);
