importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("trebor-v3", [
  "./",
  "./index.html",
  "./style.css",
  "./content.js",
  "./engine.js",
  "./app.js",
  "./manifest.webmanifest",
  "../../shared/nav.js",
  "../../shared/nav.css",
  "../../shared/pwa.js",
  "../../shared/storage.js",
  "./icons/icon.svg",
]);
