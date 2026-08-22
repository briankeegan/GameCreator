// The game shell: title screen, file select, pause menu, confirmations.
//
// This is everything a cartridge-era game had wrapped around its actual
// gameplay — you boot to a title, pick one of three files, and can always get
// back out to erase it and start again. app.js owns the world; this owns
// getting into and out of it (window.NewseyGame is the seam between them).
window.NewseyMenu = (function () {
  var SAVES = window.NewseySaves;
  var ROOMS = window.NEWSEY_STORY.ROOMS;

  var layer = document.getElementById("menuLayer");
  var screens = {
    title: document.getElementById("menuTitle"),
    files: document.getElementById("menuFiles"),
    pause: document.getElementById("menuPause"),
    help: document.getElementById("menuHelp")
  };
  var fileList = document.getElementById("fileList");
  var fileNote = document.getElementById("fileNote");
  var filesTitle = document.getElementById("filesTitle");
  var continueBtn = document.getElementById("titleContinue");
  var pauseMeta = document.getElementById("pauseMeta");
  var menuBtn = document.getElementById("menuBtn");
  var confirmBox = document.getElementById("menuConfirm");
  var confirmText = document.getElementById("confirmText");
  var confirmYes = document.getElementById("confirmYes");
  var confirmNo = document.getElementById("confirmNo");
  var toastEl = document.getElementById("menuToast");

  var current = null;       // which screen is showing, or null when playing
  var onConfirm = null;

  // ---------- screen plumbing ----------
  function show(name) {
    current = name;
    layer.hidden = false;
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    hideConfirm();
    if (name === "files") FILES.render();
    if (name === "pause") renderPauseMeta();
    if (name === "help") window.NewseySettings.refresh();
  }
  function hide() {
    current = null;
    layer.hidden = true;
    Object.keys(screens).forEach(function (k) { screens[k].hidden = true; });
    hideConfirm();
  }

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      toastTimer = setTimeout(function () { toastEl.hidden = true; }, 300);
    }, 1400);
  }

  // Every destructive action goes through the same yes/no card — erasing a
  // file, overwriting one, and walking away from unsaved progress.
  function confirm(text, yesLabel, fn) {
    confirmText.textContent = text;
    confirmYes.textContent = yesLabel;
    onConfirm = fn;
    confirmBox.hidden = false;
  }
  function hideConfirm() { confirmBox.hidden = true; onConfirm = null; }
  confirmYes.addEventListener("click", function () {
    var fn = onConfirm;
    hideConfirm();
    if (fn) fn();
  });
  confirmNo.addEventListener("click", hideConfirm);

  // ---------- title ----------
  function showTitle() {
    window.NewseyGame.quitToTitle();
    var last = SAVES.lastSlot();
    continueBtn.hidden = !last;
    if (last) {
      var d = SAVES.read(last);
      continueBtn.textContent = "CONTINUE — File " + last + " · " + SAVES.formatPlaytime(d.playSeconds);
    }
    show("title");
  }
  document.getElementById("titleStart").addEventListener("click", function () { show("files"); });
  continueBtn.addEventListener("click", function () {
    var last = SAVES.lastSlot();
    if (last) startFile(last, false); else show("files");
  });

  // ---------- file select ----------
  // The mode state machine and the copy/erase interaction now live in
  // shared/file-select.js — none of that logic ever touched what a Newsey
  // save actually looks like. What stays here is Newsey's own: what a slot
  // shows (room name, playtime, duels won) and its own themed confirm().
  function roomName(id) { return (ROOMS[id] && ROOMS[id].label) || "Somewhere"; }

  var MODE_TITLES = { play: "SELECT FILE", copy: "COPY FILE", erase: "ERASE FILE" };

  var FILES = window.GCFileSelect.create("the-game", {
    saves: SAVES,
    listEl: fileList,
    noteEl: fileNote,
    modeButtons: document.querySelectorAll("#menuFiles .mode-btn"),
    renderSlotBody: function (slot) {
      var body = document.createElement("span");
      if (slot.data) {
        var wins = Object.keys(slot.data.duelsWon || {}).reduce(function (n, k) {
          return n + slot.data.duelsWon[k];
        }, 0);
        body.innerHTML = '<span class="file-where"></span><span class="file-stats"></span>';
        body.querySelector(".file-where").textContent =
          slot.data.introSeen ? roomName(slot.data.room) : "Just beginning…";
        body.querySelector(".file-stats").textContent =
          SAVES.formatPlaytime(slot.data.playSeconds) + " played · " + wins + " duel" + (wins === 1 ? "" : "s") + " won";
      } else {
        body.innerHTML = '<span class="file-where"></span>';
        body.querySelector(".file-where").textContent = "— EMPTY —";
      }
      return body;
    },
    onPlay: function (index, isNew) { startFile(index, isNew); },
    confirm: function (text, yesLabel, fn) { confirm(text, yesLabel, fn); },
    onMessage: toast,
    // filesTitle isn't file-select's concern (it's not even inside its list
    // container) — kept here, driven off FILES.mode() on every re-render,
    // including the ones triggered internally by erase/copy/mode-switch.
    onRender: function () { filesTitle.textContent = MODE_TITLES[FILES.mode()]; },
  });

  document.getElementById("filesBack").addEventListener("click", function () {
    FILES.setMode("play");
    showTitle();
  });

  function startFile(slot, fresh) {
    FILES.setMode("play");
    window.NewseyGame.beginFile(slot, fresh);
    hide();
  }

  // ---------- pause ----------
  function renderPauseMeta() {
    var s = window.NewseyGame.state();
    var slot = window.NewseyGame.activeSlot();
    if (!s) { pauseMeta.textContent = ""; return; }
    var wins = Object.keys(s.duelsWon || {}).reduce(function (n, k) { return n + s.duelsWon[k]; }, 0);
    pauseMeta.textContent = "File " + slot + " · " + SAVES.formatPlaytime(s.playSeconds)
      + " played · " + wins + " duel" + (wins === 1 ? "" : "s") + " won";
    document.getElementById("pauseSave").disabled = !window.NewseyGame.canSave();
  }

  function openPause() {
    if (!window.NewseyGame.isRunning()) return;
    if (window.NewseyDuel.isActive()) return; // forfeit, don't pause, mid-duel
    window.NewseyGame.setPaused(true);
    show("pause");
  }
  function closePause() {
    window.NewseyGame.setPaused(false);
    hide();
  }
  // The controls screen, reachable from the pause menu AND from inside a duel
  // (its ⚙). During a duel the world is already frozen, so only the walking
  // game needs pausing here.
  function showControls() {
    if (!window.NewseyDuel.isActive()) window.NewseyGame.setPaused(true);
    show("help");
  }

  // Leaving the controls screen goes back where you came from: the pause menu
  // normally, straight back to the board if a duel is waiting underneath.
  function leaveControls() {
    window.NewseySettings.cancelCapture();
    if (window.NewseyDuel.isActive()) hide();
    else show("pause");
  }

  function togglePause() {
    if (current === "pause") closePause();
    else if (current === null) openPause();
    else if (current === "help") leaveControls();
  }

  menuBtn.addEventListener("click", openPause);
  // The duel's own ⚙ — same screen, reached from the board (see showControls).
  var duelGear = document.getElementById("duelSettings");
  if (duelGear) duelGear.addEventListener("click", showControls);
  document.getElementById("pauseResume").addEventListener("click", closePause);
  document.getElementById("pauseSave").addEventListener("click", function () {
    window.NewseyGame.save();
    toast("Game saved.");
    renderPauseMeta();
  });
  document.getElementById("pauseHelp").addEventListener("click", function () { show("help"); });
  document.getElementById("helpBack").addEventListener("click", leaveControls);
  document.getElementById("pauseQuit").addEventListener("click", function () {
    // Quitting saves first, so "quit" is never a way to lose progress —
    // erasing a file is the only thing that throws a game away.
    window.NewseyGame.save();
    showTitle();
  });

  // ---------- keys ----------
  // On the title screen any key is START, the way it always was. Elsewhere
  // Escape backs out one level.
  document.addEventListener("keydown", function (e) {
    if (current === "title") {
      if (e.key === "Escape") return;
      show("files");
      e.preventDefault();
      return;
    }
    if (e.key !== "Escape") return;
    if (!confirmBox.hidden) { hideConfirm(); e.preventDefault(); return; }
    if (current === "files") { showTitle(); e.preventDefault(); }
    else if (current === "help") { leaveControls(); e.preventDefault(); }
    else if (current === "pause") { closePause(); e.preventDefault(); }
  });

  // ---------- boot ----------
  showTitle();

  return { togglePause: togglePause, toast: toast, showTitle: showTitle,
           showControls: showControls,
           startFile: startFile, current: function () { return current; } };
})();
