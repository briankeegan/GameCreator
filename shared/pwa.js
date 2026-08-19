// Shared PWA install experience: registers the game's own service worker
// and shows an install banner (iOS gets instructions since Safari can't
// trigger the install prompt from a page; Android gets a real Install
// button via beforeinstallprompt). Same behavior HayleysGame's pwa.js had,
// generalized to take the service-worker path per game.
//
//   <script src="../../shared/pwa.js" data-sw="sw.js"></script>
(function () {
  const script = document.currentScript;
  const swPath = script.dataset.sw || "sw.js";

  if ("serviceWorker" in navigator) {
    // Auto-update: when a newly-deployed service worker takes control, reload
    // once so fresh art/code shows immediately — no manual double-refresh or
    // force-close. Guarded to only fire when the page was ALREADY controlled
    // (i.e. this is an update, not the first-ever visit), and only once.
    if (navigator.serviceWorker.controller) {
      var reloadingForUpdate = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (reloadingForUpdate) return;
        reloadingForUpdate = true;
        window.location.reload();
      });
    }
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(swPath).then(function (reg) {
        // Proactively check for a new worker now and whenever the tab regains
        // focus, so a deploy lands promptly instead of waiting for a cold nav.
        reg.update().catch(function () {});
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") reg.update().catch(function () {});
        });
      }).catch(function () {});
    });
  }

  const banner = document.getElementById("installBanner");
  const bannerText = document.getElementById("installBannerText");
  const installBtn = document.getElementById("installBannerBtn");
  const closeBtn = document.getElementById("installBannerClose");
  if (!banner || !bannerText || !installBtn || !closeBtn) return;

  const isIphone = /iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const isInstalled =
    navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  let dismissed = false;
  try {
    dismissed = localStorage.getItem("gc_installBannerDismissed") === "1";
  } catch (err) {}

  function showBanner() {
    banner.classList.add("visible");
    const rect = banner.getBoundingClientRect();
    const space = Math.max(0, window.innerHeight - rect.top) + 8;
    document.documentElement.style.setProperty("--banner-space", space + "px");
    window.dispatchEvent(new Event("resize"));
  }

  function hideBanner() {
    banner.classList.remove("visible");
    document.documentElement.style.setProperty("--banner-space", "0px");
    window.dispatchEvent(new Event("resize"));
  }

  if (isIphone && !isInstalled && !dismissed) {
    showBanner();
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    if (!isAndroid || isInstalled || dismissed) return;
    deferredPrompt = event;
    bannerText.textContent = "Play offline, right from your home screen";
    installBtn.hidden = false;
    showBanner();
  });

  installBtn.addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      hideBanner();
    });
  });

  window.addEventListener("appinstalled", hideBanner);

  closeBtn.addEventListener("click", function () {
    hideBanner();
    try {
      localStorage.setItem("gc_installBannerDismissed", "1");
    } catch (err) {}
  });
})();
