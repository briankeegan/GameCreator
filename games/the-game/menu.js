// The game shell: title screen, file select, pause menu, confirmations.
//
// This is everything a cartridge-era game had wrapped around its actual
// gameplay — you boot to a title, pick one of three files, and can always get
// back out to erase it and start again. app.js owns the world; this owns
// getting into and out of it (window.NewseyGame is the seam between them).
window.NewseyMenu = (function () {
  var SAVES = window.NewseySaves;
  var ROOMS = window.NEWSEY_STORY.ROOMS;
  var CHARACTERS = window.NEWSEY_STORY.CHARACTERS;

  var layer = document.getElementById("menuLayer");
  var screens = {
    title: document.getElementById("menuTitle"),
    files: document.getElementById("menuFiles"),
    pause: document.getElementById("menuPause"),
    help: document.getElementById("menuHelp"),
    status: document.getElementById("menuStatus"),
    difficulty: document.getElementById("menuDifficulty")
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
  var difficultyTitle = document.getElementById("difficultyTitle");
  var difficultyList = document.getElementById("difficultyList");
  var difficultyNote = document.getElementById("difficultyNote");
  var difficultyBack = document.getElementById("difficultyBack");

  var current = null;       // which screen is showing, or null when playing
  var onConfirm = null;
  // The difficulty screen serves two different moments: choosing a NEW
  // file's tier (nowhere to go back to but file select, no current tier to
  // highlight) versus adjusting an in-progress file's (highlight the
  // active one, land back on pause). One slot of state says which.
  var difficultyMode = "adjust"; // "new" | "adjust"
  var pendingNewSlot = null;

  // ---------- screen plumbing ----------
  function show(name) {
    current = name;
    layer.hidden = false;
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    hideConfirm();
    if (name === "files") FILES.render();
    if (name === "pause") renderPauseMeta();
    if (name === "help") window.NewseySettings.refresh();
    if (name === "status") renderStatus();
    if (name === "difficulty") renderDifficulty();
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
    onPlay: function (index, isNew) {
      if (isNew) { pendingNewSlot = index; difficultyMode = "new"; show("difficulty"); }
      else startFile(index, false);
    },
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

  function startFile(slot, fresh, difficultyId) {
    FILES.setMode("play");
    window.NewseyGame.beginFile(slot, fresh, difficultyId);
    hide();
  }

  // ---------- difficulty ----------
  function renderDifficulty() {
    var isNew = difficultyMode === "new";
    difficultyTitle.textContent = isNew ? "CHOOSE DIFFICULTY" : "DIFFICULTY";
    difficultyNote.textContent = isNew
      ? "Both you and every opponent play at this level in every duel. You can change it later from the pause menu."
      : "Both you and every opponent play at this level in every duel.";
    var active = isNew ? null : window.NewseyGame.difficulty();
    difficultyList.innerHTML = "";
    window.NewseyDifficulty.TIERS.forEach(function (tier) {
      var btn = document.createElement("button");
      btn.textContent = tier.label;
      if (tier.id === active) btn.classList.add("active");
      btn.addEventListener("click", function () { pickDifficulty(tier.id); });
      difficultyList.appendChild(btn);
    });
  }

  function pickDifficulty(id) {
    if (difficultyMode === "new") {
      var slot = pendingNewSlot;
      pendingNewSlot = null;
      startFile(slot, true, id);
    } else {
      window.NewseyGame.setDifficulty(id);
      toast(window.NewseyDifficulty.labelFor(id) + " difficulty set.");
      show("pause");
    }
  }

  document.getElementById("pauseDifficulty").addEventListener("click", function () {
    difficultyMode = "adjust";
    show("difficulty");
  });
  difficultyBack.addEventListener("click", function () {
    if (difficultyMode === "new") { pendingNewSlot = null; show("files"); }
    else show("pause");
  });

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

  // ---------- status (the bedroom mirror) ----------
  // The plot's own words: "the giant mirror is your screen." Read-only —
  // rank, playstyle gem, duel record. Save/load/options stay in PAUSE.
  //
  // Rank is DERIVED from total wins, not a saved field: adding one would be
  // save-schema churn for a number the win count already determines, and
  // it can never drift out of sync with the record it's read off.
  var RANKS = [
    { min: 10, name: "Diamond", color: "#bfe9ff" },
    { min: 6,  name: "Gold",    color: "#ffd166" },
    { min: 3,  name: "Silver",  color: "#d9d9e3" },
    { min: 0,  name: "Copper",  color: "#c9793f" }
  ];
  function rankFor(wins) {
    for (var i = 0; i < RANKS.length; i++) if (wins >= RANKS[i].min) return RANKS[i];
    return RANKS[RANKS.length - 1];
  }
  var statusMeta = document.getElementById("statusMeta");
  var statusRows = document.getElementById("statusRows");
  function statusRow(label, value) {
    var row = document.createElement("div");
    row.className = "status-row";
    var l = document.createElement("span"); l.className = "status-label"; l.textContent = label;
    var v = document.createElement("span"); v.className = "status-value"; v.textContent = value;
    row.appendChild(l); row.appendChild(v);
    return row;
  }
  function renderStatus() {
    var s = window.NewseyGame.state();
    statusRows.innerHTML = "";
    if (!s) { statusMeta.textContent = ""; return; }
    var wins = s.duelsWon || {};
    var total = Object.keys(wins).reduce(function (n, k) { return n + wins[k]; }, 0);
    var rank = rankFor(total);
    statusMeta.textContent = "Copper, aquamarine — the bracelet you woke up wearing.";
    statusRows.appendChild(statusRow("Rank", rank.name));
    statusRows.appendChild(statusRow("Playstyle gem", "Aquamarine"));
    statusRows.appendChild(statusRow("Duels won", String(total)));
    var opponents = Object.keys(wins).filter(function (id) { return wins[id] > 0; });
    if (!opponents.length) {
      var empty = document.createElement("div");
      empty.className = "status-row status-empty";
      empty.textContent = "No duels won yet.";
      statusRows.appendChild(empty);
    } else {
      opponents.sort(function (a, b) { return wins[b] - wins[a]; }).forEach(function (id) {
        var name = (CHARACTERS[id] && CHARACTERS[id].name) || id;
        statusRows.appendChild(statusRow("vs. " + name, String(wins[id])));
      });
    }
  }
  function openStatus() {
    if (!window.NewseyGame.isRunning()) return;
    if (window.NewseyDuel.isActive()) return;
    window.NewseyGame.setPaused(true);
    show("status");
  }
  function closeStatus() {
    window.NewseyGame.setPaused(false);
    hide();
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
  document.getElementById("statusBack").addEventListener("click", closeStatus);

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
    else if (current === "status") { closeStatus(); e.preventDefault(); }
    else if (current === "difficulty") { difficultyBack.click(); e.preventDefault(); }
  });

  // ---------- boot ----------
  showTitle();

  return { togglePause: togglePause, toast: toast, showTitle: showTitle,
           showControls: showControls, showStatus: openStatus,
           startFile: startFile, current: function () { return current; } };
})();
