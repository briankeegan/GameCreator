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
  var fileMode = "play";    // play | copy | erase — the classic three-mode file select
  var copySource = null;    // slot being copied FROM, once one is picked
  var onConfirm = null;

  // ---------- screen plumbing ----------
  function show(name) {
    current = name;
    layer.hidden = false;
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    menuBtn.hidden = true;
    hideConfirm();
    if (name === "files") renderFiles();
    if (name === "pause") renderPauseMeta();
    if (name === "help") window.NewseySettings.refresh();
  }
  function hide() {
    current = null;
    layer.hidden = true;
    Object.keys(screens).forEach(function (k) { screens[k].hidden = true; });
    hideConfirm();
    menuBtn.hidden = !window.NewseyGame.isRunning();
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
  function roomName(id) { return (ROOMS[id] && ROOMS[id].label) || "Somewhere"; }

  function renderFiles() {
    filesTitle.textContent = fileMode === "play" ? "SELECT FILE"
      : fileMode === "copy" ? "COPY FILE" : "ERASE FILE";
    fileList.innerHTML = "";
    SAVES.list().forEach(function (slot) {
      var btn = document.createElement("button");
      btn.className = "file-slot" + (slot.data ? "" : " empty");
      if (copySource === slot.index) btn.classList.add("selected");
      var num = document.createElement("span");
      num.className = "file-num";
      num.textContent = slot.index;
      btn.appendChild(num);

      var body = document.createElement("span");
      body.className = "file-body";
      if (slot.data) {
        var wins = Object.keys(slot.data.duelsWon || {}).reduce(function (n, k) {
          return n + slot.data.duelsWon[k];
        }, 0);
        body.innerHTML =
          '<span class="file-where"></span>' +
          '<span class="file-stats"></span>';
        body.querySelector(".file-where").textContent =
          slot.data.introSeen ? roomName(slot.data.room) : "Just beginning…";
        body.querySelector(".file-stats").textContent =
          SAVES.formatPlaytime(slot.data.playSeconds) + " played · " + wins + " duel" + (wins === 1 ? "" : "s") + " won";
      } else {
        body.innerHTML = '<span class="file-where"></span>';
        body.querySelector(".file-where").textContent = "— EMPTY —";
      }
      btn.appendChild(body);
      btn.addEventListener("click", function () { pickFile(slot); });
      fileList.appendChild(btn);
    });
    fileNote.textContent =
      fileMode === "play" ? "Pick a file to play. An empty file starts a new game."
      : fileMode === "copy" ? (copySource ? "Now pick where to copy File " + copySource + "." : "Pick the file to copy.")
      : "Pick a file to erase. This can't be undone.";
    document.querySelectorAll("#menuFiles .mode-btn").forEach(function (b) {
      b.classList.toggle("on", b.dataset.mode === fileMode);
    });
  }

  function pickFile(slot) {
    if (fileMode === "erase") {
      if (!slot.data) { toast("That file is already empty."); return; }
      confirm("Erase File " + slot.index + "? Everything on it is gone for good.", "ERASE", function () {
        SAVES.erase(slot.index);
        toast("File " + slot.index + " erased.");
        renderFiles();
      });
      return;
    }
    if (fileMode === "copy") {
      if (copySource === null) {
        if (!slot.data) { toast("Nothing on that file to copy."); return; }
        copySource = slot.index;
        renderFiles();
        return;
      }
      if (slot.index === copySource) { copySource = null; renderFiles(); return; }
      var doCopy = function () {
        SAVES.copy(copySource, slot.index);
        toast("Copied to File " + slot.index + ".");
        copySource = null;
        fileMode = "play";
        renderFiles();
      };
      if (slot.data) confirm("File " + slot.index + " already has a game on it. Overwrite it?", "OVERWRITE", doCopy);
      else doCopy();
      return;
    }
    // play
    if (!slot.data) { startFile(slot.index, true); return; }
    startFile(slot.index, false);
  }

  document.querySelectorAll("#menuFiles .mode-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      fileMode = b.dataset.mode;
      copySource = null;
      renderFiles();
    });
  });
  document.getElementById("filesBack").addEventListener("click", function () {
    fileMode = "play"; copySource = null;
    showTitle();
  });

  function startFile(slot, fresh) {
    fileMode = "play"; copySource = null;
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
