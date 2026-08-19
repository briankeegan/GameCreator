importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("dog-punk-v8", [
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
  "./hero_sheet.png",
  "./rat_sheet.png",
  "./tiles.png",
]);
