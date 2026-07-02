// Injects the shared top bar (All Games / title / chat) into a game page.
// Configure via data attributes on the script tag itself, e.g.:
//
//   <script src="../../shared/nav.js"
//           data-game-id="my-game"
//           data-game-name="My Game"
//           data-version="v1"
//           data-root="../../"></script>
(function () {
  const script = document.currentScript;
  const gameId = script.dataset.gameId || "";
  const gameName = script.dataset.gameName || "";
  const version = script.dataset.version || "";
  const root = script.dataset.root || "../../";

  function mount() {
    const bar = document.createElement("div");
    bar.className = "gc-nav";

    const home = document.createElement("a");
    home.className = "gc-nav-home";
    home.href = `${root}index.html`;
    home.textContent = "‹ All Games";
    bar.appendChild(home);

    const title = document.createElement("span");
    title.className = "gc-nav-title";
    title.textContent = gameName;
    if (version) {
      const v = document.createElement("span");
      v.className = "gc-nav-version";
      v.textContent = ` ${version}`;
      title.appendChild(v);
    }
    bar.appendChild(title);

    const clubhouse = document.createElement("a");
    clubhouse.className = "gc-nav-clubhouse";
    // clubhouse.html always lives one directory below root (shared/), so the
    // path back to this game is always "../games/<id>/", regardless of how
    // deep `root` needed to reach back to get here from the game page.
    clubhouse.href =
      `${root}shared/clubhouse.html?game=${encodeURIComponent(gameId)}` +
      `&name=${encodeURIComponent(gameName)}` +
      `&back=${encodeURIComponent("../games/" + gameId + "/index.html")}`;
    clubhouse.textContent = "💬 Chat";
    bar.appendChild(clubhouse);

    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
