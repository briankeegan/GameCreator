importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("the-game-v18", [
  "./",
  "./index.html",
  "./style.css",
  "./story.js",
  "./panel-engine.js",
  "./panel-cpu.js",
  "./duel.js",
  "./saves.js",
  "./app.js",
  "./menu.js",
  "./manifest.webmanifest",
  "../../shared/nav.js",
  "../../shared/nav.css",
  "../../shared/pwa.js",
  "../../shared/storage.js",
  "./icons/icon.svg",
]);
