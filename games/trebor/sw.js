importScripts("../../shared/sw-core.js");

GCRegisterServiceWorker("trebor-v11", [
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
  "./icons/dog-riddle.png",
  "./icons/dog-koozie.png",
  "./icons/dog-bevy.png",
  "./icons/enemy-alley-cat.png",
  "./icons/enemy-tabby-guard.png",
  "./icons/enemy-big-tom.png",
  "./icons/enemy-feral-kitten.png",
  "./icons/enemy-rooftop-sniper.png",
]);
