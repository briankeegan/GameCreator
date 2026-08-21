importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("dog-punk-v36", [
  "./",
  "./index.html",
  "./style.css",
  "./rooms.js",
  "./app.js",
  "./manifest.webmanifest",
  "../../shared/nav.js",
  "../../shared/nav.css",
  "../../shared/pwa.js",
  "../../shared/storage.js",
  "../../shared/controls.js",
  "../../shared/save-slots.js",
  "./icons/icon.svg",
  "./hero_sheet.png",
  "./hero_attack_sheet.png",
  "./rat_sheet.png",
  "./drone_sheet.png",
  "./brute_sheet.png",
  "./tiles.png",
]);
