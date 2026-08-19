importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("dog-punk-v4", [
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
  "./hero_down.png",
  "./hero_up.png",
  "./hero_side.png",
  "./hero_down_walk2.png",
  "./hero_up_walk2.png",
  "./hero_side_walk2.png",
  "./rat_side.png",
  "./rat_side_walk2.png",
]);
