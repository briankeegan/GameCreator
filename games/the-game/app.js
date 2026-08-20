// Puzzle Attack / Newsey — game engine.
// Two modes: CUTSCENE (tap-through intro) then WALK-AROUND (classic top-down
// room; move with arrows/touch d-pad, walk up to an NPC, press interact to
// talk). Talking to a duellist opens the DUEL: a full Panel Attack match on a
// real board (duel.js + panel-engine.js, ported from the Lua reference).
// Everything has a canvas-drawn fallback so the game is fully playable with
// zero generated art.
(function () {
  var gameId = "the-game";

  // ---------- stage sizing (mobile) ----------
  // CSS alone couldn't do "grow to fill available height without ever
  // losing the canvas's 640:400 proportions": combining aspect-ratio with
  // flex-grow in a column, Chromium resolved width to the full cross-axis
  // FIRST and only then grew height, ignoring the ratio entirely (visible
  // stretching, confirmed via computed styles showing aspect-ratio set
  // correctly but width/height not respecting it). Computing the box in
  // JS is the reliable way to get this right.
  var sizeStage = (function initStageSizing() {
    var stageEl = document.getElementById("stage");
    var gameArea = document.getElementById("gameArea");
    function run() {
      if (window.innerWidth > 480) {
        stageEl.classList.remove("js-sized");
        stageEl.style.removeProperty("--stage-w");
        stageEl.style.removeProperty("--stage-h");
        return;
      }
      var siblings = Array.prototype.filter.call(gameArea.children, function (el) { return el !== stageEl; });
      var usedHeight = siblings.reduce(function (sum, el) {
        var cs = getComputedStyle(el);
        // Out-of-flow siblings (the menu layer, the toast) overlay the area
        // rather than taking space in the column — counting their height
        // would shrink the stage to nothing whenever a menu is open.
        if (cs.display === "none" || cs.position === "absolute" || cs.position === "fixed") return sum;
        return sum + el.getBoundingClientRect().height;
      }, 0);
      var gaStyles = getComputedStyle(gameArea);
      var gap = parseFloat(gaStyles.rowGap || gaStyles.gap || "0") * siblings.length;
      var paddingV = parseFloat(gaStyles.paddingTop) + parseFloat(gaStyles.paddingBottom);
      var paddingH = parseFloat(gaStyles.paddingLeft) + parseFloat(gaStyles.paddingRight);
      var availH = Math.max(0, gameArea.clientHeight - usedHeight - gap - paddingV);
      var availW = Math.max(0, gameArea.clientWidth - paddingH);
      var ratio = 640 / 400;
      var w = availW, h = w / ratio;
      if (h > availH) { h = availH; w = h * ratio; }
      stageEl.style.setProperty("--stage-w", w + "px");
      stageEl.style.setProperty("--stage-h", h + "px");
      stageEl.classList.add("js-sized");
    }
    window.addEventListener("resize", run);
    window.addEventListener("orientationchange", run);
    run();
    return run; // exposed so code that toggles a sibling's visibility (the
                // cutscene hiding touch-controls, etc) can ask for a resize
  })();

  var STORY = window.NEWSEY_STORY;
  var CHARACTERS = STORY.CHARACTERS;
  var ROOMS = STORY.ROOMS;

  // ---------- persistence ----------
  // The game no longer owns a single anonymous save. A file (1..3) is chosen
  // on the file-select screen and loaded by menu.js via beginFile() below;
  // until that happens `save` is null and the world isn't running at all.
  // Everything the world remembers lives in that one object, so a save is a
  // single write and a load is a single read.
  var SAVES = window.NewseySaves;
  var save = null;        // the active file's data
  var activeSlot = null;  // 1..3, or null while we're sitting on a menu
  var sinceFlush = 0;     // seconds played since the last write (see update)
  function persist() {
    if (activeSlot == null || !save) return;
    save.pos = { x: player.x, y: player.y };
    save.lines = npcLineCounters;
    SAVES.write(activeSlot, save);
    sinceFlush = 0;
  }

  // ---------- art loading (graceful fallback) ----------
  var artCache = {};
  function loadArt(id) {
    if (!id) return null;
    if (artCache[id]) return artCache[id];
    var img = new Image();
    var entry = { img: img, ok: false };
    img.onload = function () { entry.ok = true; };
    img.onerror = function () { entry.ok = false; };
    img.src = "art/" + id + ".png";
    artCache[id] = entry;
    return entry;
  }
  function loadBg(id) {
    if (!id) return null;
    var bgId = "bg-" + id;
    if (artCache[bgId]) return artCache[bgId];
    var img = new Image();
    var entry = { img: img, ok: false };
    img.onload = function () { entry.ok = true; };
    img.onerror = function () { entry.ok = false; };
    img.src = "art/" + bgId + ".png";
    artCache[bgId] = entry;
    return entry;
  }
  function bgUrl(id) { return id ? "url('art/bg-" + id + ".png'), " : ""; }

  // Every character sprite is its own independent AI generation, so their
  // natural width:height ratios vary a lot even when all are tightly
  // trimmed with no padding (confirmed: 1.18 up to 2.15 across the current
  // set) — rendering each at a fixed height with its own raw ratio made
  // some characters look unnaturally thin/elongated standing next to
  // others, reported live as sprites "getting stretched". Clamp the
  // rendered width to a plausible human-silhouette range at a given
  // height so no single sprite reads as squished or stretched relative to
  // its neighbors, regardless of how tightly its own source was cropped.
  function spriteDrawSize(img, targetH) {
    var w = targetH * (img.naturalWidth / img.naturalHeight);
    // Previous bounds (0.5–0.95 * height) were too close to the actual
    // outlier ratios to do anything — Kat's natural width only clamped
    // from 14px to 15px at height 30, an invisible change, and she still
    // read as "stretched thin". Tightened to a narrower, more assertive
    // band so an outlier ratio visibly corrects instead of barely moving.
    var minW = targetH * 0.68, maxW = targetH * 0.85;
    w = Math.max(minW, Math.min(maxW, w));
    return { w: w, h: targetH };
  }

  // Warm the cache for every art/bg id the game can possibly need, right at
  // boot, so nobody ever sees the fallback flash while a portrait or NPC
  // sprite that's about to be shown is still on the wire — the network
  // request already happened seconds earlier while they were reading the
  // previous line.
  (function preloadAllArt() {
    [STORY.INTRO_CUTSCENE, STORY.DREAM_CUTSCENE].forEach(function (list) {
      list.forEach(function (s) {
        if (s.art) loadArt(s.art);
        if (s.bg) loadBg(s.bg);
      });
    });
    Object.keys(ROOMS).forEach(function (id) {
      var room = ROOMS[id];
      loadBg(room.bg);
      room.npcs.forEach(function (npc) {
        if (npc.art) loadArt(npc.art);
        if (npc.sprite) loadArt(npc.sprite);
      });
    });
    loadArt("nella_top");
  })();

  // =========================================================================
  // CUTSCENE MODE
  // =========================================================================
  var cutsceneEl = document.getElementById("cutscene");
  var bgEl = document.getElementById("bg");
  var portraitImg = document.getElementById("portrait");
  var portraitFallback = document.getElementById("portraitFallback");
  var speakerEl = document.getElementById("speaker");
  var lineEl = document.getElementById("line");
  var cIndex = 0;
  var lastBg = "";
  var activeCutscene = STORY.INTRO_CUTSCENE;
  var cutsceneDoneCallback = null;

  function renderCutsceneLine() {
    var s = activeCutscene[cIndex];
    if (s.bg !== undefined && s.bg !== lastBg) {
      lastBg = s.bg;
      bgEl.style.backgroundImage = s.bg
        ? bgUrl(s.bg) + fallbackGradient(s.bg)
        : "";
    }
    // A portrait belongs to its own line and nothing else. This used to only
    // change when a slide named `art`, so a face stayed on screen across every
    // following slide that didn't — the child Nella narrated "age ten" a year
    // later with the same nine-year-old portrait, and her mid-scream face sat
    // there through four calm lines of the dream. A slide that wants a face
    // names one; every other slide shows none.
    setPortrait(s.art);
    if (s.who && !s.narration) {
      var c = CHARACTERS[s.who] || { name: s.who, color: "#fff" };
      speakerEl.textContent = c.name;
      speakerEl.style.color = c.color;
    } else {
      speakerEl.textContent = "";
    }
    lineEl.textContent = s.text;
    lineEl.classList.toggle("narration", !!s.narration);
  }

  function setPortrait(id) {
    if (!id) { portraitImg.hidden = true; portraitFallback.hidden = true; return; }
    var entry = loadArt(id);
    var c = CHARACTERS[currentSpeakerId()] || { name: "?", color: "#4a2f7a" };
    portraitFallback.textContent = c.name.charAt(0);
    portraitFallback.style.background = c.color;
    function trySwap() {
      if (entry.ok) { portraitImg.src = entry.img.src; portraitImg.hidden = false; portraitFallback.hidden = true; }
      else { portraitImg.hidden = true; portraitFallback.hidden = false; }
    }
    if (entry.img.complete) trySwap(); else { entry.img.onload = trySwap; entry.img.onerror = trySwap; }
  }
  function currentSpeakerId() { return (activeCutscene[cIndex] && activeCutscene[cIndex].who) || ""; }

  function fallbackGradient(id) {
    // A deterministic tinted gradient per background id, so every scene reads
    // as visually distinct even with zero art.
    var hues = { code: 260, childhood: 200, mall: 15, news: 210, rain: 220, porch: 30,
      kitchen: 40, cartridge: 340, crt: 160, crt_red: 355, latin: 280, chaos: 355,
      bedroom: 300, mirror: 320, lounge: 20, arena: 45, library: 265 };
    var h = hues[id] !== undefined ? hues[id] : 250;
    return "linear-gradient(160deg, hsl(" + h + ",55%,20%), hsl(" + h + ",45%,8%) 75%)";
  }

  function advanceCutscene() {
    cIndex++;
    if (cIndex >= activeCutscene.length) { endCutscene(); return; }
    renderCutsceneLine();
  }
  function endCutscene() {
    cutsceneEl.classList.add("hidden");
    applyControlsSetting();
    document.getElementById("menuBtn").hidden = !running;
    sizeStage();
    var cb = cutsceneDoneCallback;
    cutsceneDoneCallback = null;
    if (cb) cb();
  }
  // list: which cutscene array to play. onDone: called once it finishes
  // (decides which room to land in — the two cutscenes go to different
  // rooms, so this isn't hardcoded here).
  function startCutscene(list, onDone) {
    activeCutscene = list;
    cutsceneDoneCallback = onDone;
    cIndex = 0; lastBg = "";
    portraitImg.hidden = true;
    portraitFallback.hidden = true;
    cutsceneEl.classList.remove("hidden");
    applyControlsSetting();
    // A cutscene is never pausable (own tap-to-advance, no world to pause
    // into) — the ☰ button showing here was a real bug: menu.js's hide()
    // sets it visible purely from `running`, which flips true the instant
    // beginFile() starts, before the intro has even begun playing.
    document.getElementById("menuBtn").hidden = true;
    sizeStage();
    renderCutsceneLine();
  }
  cutsceneEl.addEventListener("click", advanceCutscene);
  cutsceneEl.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") advanceCutscene(); });

  // =========================================================================
  // WALK-AROUND MODE
  // =========================================================================
  var canvas = document.getElementById("scene");
  var ctx = canvas.getContext("2d");
  var VW = 320, VH = 200; // virtual room size; canvas is 2x (640x400)
  ctx.scale(2, 2);
  ctx.imageSmoothingEnabled = false;

  var roomLabelEl = document.getElementById("roomLabel");
  var talkBox = document.getElementById("talkBox");
  var talkPortrait = document.getElementById("talkPortrait");
  var talkPortraitFallback = document.getElementById("talkPortraitFallback");
  var talkSpeaker = document.getElementById("talkSpeaker");
  var talkLine = document.getElementById("talkLine");

  var currentRoom = null;
  var exitsArmed = true; // false until the player steps clear of every doorway
  var player = { x: 60, y: 150, w: 14, h: 18, speed: 70, facing: "down" };
  var walkPhase = 0, isWalking = false; // drives real walk-frame cycling (see drawPlayer)
  var keys = {};
  var talking = null; // { npc, lineIndex }
  var running = false; // true only while a file is loaded and being played
  var paused = false;  // true while the pause menu is up
  var lastTime = null;
  var npcLineCounters = {}; // remembers which line to show next per NPC (repeat visits)

  // at: optional { x, y } to arrive at — a door hands over the spot in front
  // of the matching door on the other side, so you step out where you should
  // instead of teleporting to the middle of the room.
  function enterRoom(roomId, at) {
    currentRoom = ROOMS[roomId];
    exitsArmed = false;
    player.x = (at && at.x !== undefined) ? at.x : currentRoom.playerStart.x;
    player.y = (at && at.y !== undefined) ? at.y : currentRoom.playerStart.y;
    if (save) { save.room = roomId; persist(); } // walking through a door autosaves
  }

  // ---- input ----
  // Which key does what is the player's choice (settings.js) — nothing here
  // hardcodes a binding any more.
  var SETTINGS = window.NewseySettings;
  window.addEventListener("keydown", function (e) {
    if (SETTINGS.isCapturing()) return; // a rebind is waiting for this key
    // Escape / Enter is START on a console pad: it opens the pause menu, and
    // the menu itself handles closing again. Never while a duel is running —
    // that screen has its own forfeit button and its own key handling.
    if ((e.key === "Escape" || e.key === "p" || e.key === "P") && running &&
        cutsceneEl.classList.contains("hidden") && !window.NewseyDuel.isActive()) {
      window.NewseyMenu.togglePause();
      e.preventDefault();
      return;
    }
    keys[e.key] = true;
    var pressed = {}; pressed[e.key] = true;
    if (SETTINGS.isDown("interact", pressed)) {
      // The talk key both STARTS a conversation and advances one. It used to
      // only advance, so walking up to someone and pressing it did nothing at
      // all — tapping them was the only way in, which read as the key binding
      // being broken.
      if (talking) {
        advanceTalk();
        e.preventDefault();
      } else if (running && !window.NewseyDuel.isActive() && cutsceneEl.classList.contains("hidden")) {
        tryInteract();
        e.preventDefault();
      }
    }
  });
  window.addEventListener("keyup", function (e) { keys[e.key] = false; });

  var touchControlsEl = document.getElementById("touchControls");
  // The on-screen pad follows the setting, not the device: someone on a laptop
  // can turn it on, someone on a tablet with a keyboard can turn it off.
  function applyControlsSetting() {
    touchControlsEl.classList.toggle("pad-right", SETTINGS.padSide() === "right");
    // Only while a file is actually being played: the title and file-select
    // screens are their own thing and have no use for a walking d-pad.
    var wanted = running && SETTINGS.showOnScreenControls() && !cutsceneVisible();
    if (touchControlsEl.hidden === !wanted) return;
    touchControlsEl.hidden = !wanted;
    sizeStage();
  }
  function cutsceneVisible() { return !cutsceneEl.classList.contains("hidden"); }
  SETTINGS.onChange(applyControlsSetting);
  applyControlsSetting();


  var touchDir = null;
  document.querySelectorAll("#dpad button").forEach(function (btn) {
    var dir = btn.dataset.dir;
    var set = function (e) { touchDir = dir; e.preventDefault(); };
    var clear = function () { if (touchDir === dir) touchDir = null; };
    btn.addEventListener("touchstart", set, { passive: false });
    btn.addEventListener("touchend", clear);
    btn.addEventListener("mousedown", set);
    btn.addEventListener("mouseup", clear);
    btn.addEventListener("mouseleave", clear);
  });
  // The world's action button does whatever "Button 1" is mapped to; if that
  // is a duel action (swap/raise) it still talks here, since talking is the
  // only thing to do in a room.
  document.getElementById("interactBtn").addEventListener("click", function () {
    if (talking) advanceTalk(); else tryInteract();
  });
  canvas.addEventListener("click", function (e) {
    if (talking) { advanceTalk(); return; }
    tryInteract();
  });
  talkBox.addEventListener("click", advanceTalk);

  function nearestNpc() {
    if (!currentRoom) return null;
    var best = null, bestD = 26;
    currentRoom.npcs.forEach(function (npc) {
      var dx = (npc.x) - (player.x + player.w / 2);
      var dy = (npc.y) - (player.y + player.h / 2);
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = npc; }
    });
    return best;
  }

  function tryInteract() {
    var npc = nearestNpc();
    if (!npc) return;
    var idx = npcLineCounters[npc.id] || 0;
    talking = { npc: npc, lineIndex: idx };
    renderTalk();
  }

  function renderTalk() {
    var npc = talking.npc;
    var c = CHARACTERS[npc.id] || { name: npc.id, color: "#4a2f7a" };
    talkSpeaker.textContent = c.name;
    talkSpeaker.style.color = c.color;
    talkLine.textContent = npc.lines[talking.lineIndex];
    talkPortraitFallback.textContent = c.name.charAt(0);
    talkPortraitFallback.style.background = c.color;
    var entry = loadArt(npc.art);
    function trySwap() {
      if (entry && entry.ok) { talkPortrait.src = entry.img.src; talkPortrait.hidden = false; talkPortraitFallback.hidden = true; }
      else { talkPortrait.hidden = true; talkPortraitFallback.hidden = false; }
    }
    if (entry) { if (entry.img.complete) trySwap(); else { entry.img.onload = trySwap; entry.img.onerror = trySwap; } }
    talkBox.hidden = false;
  }

  function advanceTalk() {
    var npc = talking.npc;
    // counterKey lets a temporary conversation (the post-duel lines) share the
    // speaker's portrait and nameplate without clobbering that NPC's own
    // position in their normal dialogue.
    var key = npc.counterKey || npc.id;
    talking.lineIndex++;
    if (talking.lineIndex >= npc.lines.length) {
      npcLineCounters[key] = npc.lines.length - 1; // stay on last line for future visits
      talkBox.hidden = true;
      var wasTalking = talking;
      talking = null;
      if (wasTalking.npc.duel) startDuel(wasTalking.npc);
      if (wasTalking.npc.cutscene) {
        startCutscene(STORY[wasTalking.npc.cutscene], function () { enterRoom("bedroom"); });
      }
      if (wasTalking.npc.gotoRoom) enterRoom(wasTalking.npc.gotoRoom);
      // A bed is a save point: finishing its "lines" is the save.
      if (wasTalking.npc.savePoint) { persist(); window.NewseyMenu.toast("Game saved."); }
      return;
    }
    npcLineCounters[key] = talking.lineIndex;
    renderTalk();
  }

  // ---- duels ----
  // The NPC's `duel` block in story.js says who you are facing, how hard they
  // play and whether their board runs the normal pink or the cursed red. Wins
  // are remembered per opponent so the world can read differently on a rematch.
  function startDuel(npc) {
    var config = (typeof npc.duel === "object" && npc.duel) || {};
    var character = CHARACTERS[npc.id] || {};
    // The duel screen owns the stage while it's up — it has its own forfeit
    // button, and pausing wouldn't stop its clock anyway, so the ☰ goes away.
    document.getElementById("menuBtn").hidden = true;
    window.NewseyDuel.start({
      playerName: CHARACTERS.nella.name,
      playerLevel: config.playerLevel || 2,
      opponent: {
        id: npc.id,
        name: config.name || character.name || npc.id,
        level: config.level || 3,
        difficulty: config.difficulty || "steady",
        theme: config.theme || "pink",
        winLine: config.winLine,
        loseLine: config.loseLine
      },
      onEnd: function (outcome) {
        document.getElementById("menuBtn").hidden = !running;
        if (outcome.result === "win") {
          save.duelsWon[npc.id] = (save.duelsWon[npc.id] || 0) + 1;
        }
        persist();
        var lines = outcome.result === "win" ? config.afterWin : config.afterLoss;
        if (outcome.result !== "quit" && lines && lines.length) {
          talking = {
            npc: { id: npc.id, art: npc.art, lines: lines, counterKey: npc.id + ":after" },
            lineIndex: 0
          };
          renderTalk();
        }
      }
    });
  }

  // ---- movement + collision ----
  // Every room has a walkable "floor" rect (falls back to a generic one if
  // a room doesn't define its own) plus an optional list of "obstacles" —
  // furniture/counters the player can't walk into. Without this the player
  // could walk anywhere on the whole canvas, including through walls and
  // furniture drawn near the back of the room.
  var DEFAULT_FLOOR = { x: 16, y: 95, w: VW - 32, h: VH - 95 - 10 };
  function clampToFloor(room, x, y) {
    var f = room.floor || DEFAULT_FLOOR;
    return {
      x: Math.max(f.x, Math.min(f.x + f.w - player.w, x)),
      y: Math.max(f.y, Math.min(f.y + f.h - player.h, y))
    };
  }
  function blockedByObstacle(room, x, y) {
    var obstacles = room.obstacles || [];
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (x + player.w > o.x && x < o.x + o.w && y + player.h > o.y && y < o.y + o.h) return true;
    }
    return false;
  }
  // NPCs are people (or furniture, for the save point), not floor markings —
  // walking straight through one looked wrong and was reported live. Treated
  // as a small circle at their feet; savePoint is skipped since a bed is
  // already covered by the room's own obstacles list.
  var NPC_COLLIDE_RADIUS = 8;
  // Returns the blocking NPC (not just true/false) so a sustained shove can
  // be attributed to a specific person and made to step aside — see the push
  // handling in update().
  function npcAt(room, x, y) {
    var cx = x + player.w / 2, cy = y + player.h;
    for (var i = 0; i < room.npcs.length; i++) {
      var npc = room.npcs[i];
      if (npc.savePoint) continue;
      if (Math.hypot(cx - npc.x, cy - npc.y) < NPC_COLLIDE_RADIUS) return npc;
    }
    return null;
  }
  // ---- NPC wandering ----
  // Small, slow drift around each NPC's spawn point so a room doesn't read as
  // a row of statues. Deliberately gentle (short radius, slow speed) — these
  // are people standing around talking, not patrolling guards, and they must
  // stay reachable for dialogue. State lives on the npc object itself so it
  // persists as long as the room does; (re)initialized the first time a room's
  // NPCs are seen.
  var WANDER_RADIUS = 18, WANDER_SPEED = 12;
  function ensureWanderState(npc) {
    if (npc._wander) return npc._wander;
    var w = { homeX: npc.x, homeY: npc.y, tx: npc.x, ty: npc.y, pause: Math.random() * 2 };
    npc._wander = w;
    return w;
  }
  function pickWanderTarget(w) {
    var a = Math.random() * Math.PI * 2, r = Math.random() * WANDER_RADIUS;
    w.tx = w.homeX + Math.cos(a) * r;
    w.ty = w.homeY + Math.sin(a) * r * 0.5; // flatter spread — rooms read wider than tall
  }
  function updateNpcWander(room, npc, dt) {
    if (npc.savePoint || npc._noWander) return;
    var w = ensureWanderState(npc);
    if (w.pause > 0) { w.pause -= dt; return; }
    var dx = w.tx - npc.x, dy = w.ty - npc.y, d = Math.hypot(dx, dy);
    if (d < 1.5) { pickWanderTarget(w); w.pause = 1 + Math.random() * 2.5; return; }
    var step = Math.min(d, WANDER_SPEED * dt);
    var nx = npc.x + (dx / d) * step, ny = npc.y + (dy / d) * step;
    // Never wander into an obstacle, off the floor, into another NPC, or
    // into the player — reuse the same checks movement uses.
    var f = clampToFloor(room, nx - player.w / 2, ny - player.h);
    nx = f.x + player.w / 2; ny = f.y + player.h;
    if (blockedByObstacle(room, nx - player.w / 2, ny - player.h)) { pickWanderTarget(w); return; }
    var pd = Math.hypot(nx - (player.x + player.w / 2), ny - (player.y + player.h));
    var curPd = Math.hypot(npc.x - (player.x + player.w / 2), npc.y - (player.y + player.h));
    // Block a step that would walk INTO the player, but never one that's
    // increasing the distance — otherwise a step-aside (registerPush, whose
    // whole target is "away from the player") could never actually clear the
    // same radius it's trying to escape.
    if (pd < NPC_COLLIDE_RADIUS + 4 && pd < curPd) return;
    npc.x = nx; npc.y = ny;
  }
  // Walking into someone and holding it blocks forever otherwise — a real
  // wall is fine to just stop at, a person shouldn't be. After ~2s of
  // sustained shove they step out of the way (away from the player, along
  // the current floor), then resume their normal wander from there.
  var PUSH_THRESHOLD = 2, PUSH_STEP = 22;
  var pushedNpc = null, pushTimer = 0;
  function registerPush(room, npc, dt) {
    if (npc !== pushedNpc) { pushedNpc = npc; pushTimer = 0; }
    pushTimer += dt;
    if (pushTimer < PUSH_THRESHOLD) return;
    var w = ensureWanderState(npc);
    var dx = npc.x - (player.x + player.w / 2), dy = npc.y - (player.y + player.h);
    var d = Math.hypot(dx, dy) || 1;
    var f = clampToFloor(room, npc.x + (dx / d) * PUSH_STEP - player.w / 2, npc.y + (dy / d) * PUSH_STEP - player.h);
    w.tx = f.x + player.w / 2; w.ty = f.y + player.h;
    w.homeX = w.tx; w.homeY = w.ty; // step-aside becomes their new "home" — they don't snap back into the player
    w.pause = 0;
    pushedNpc = null; pushTimer = 0;
  }
  // A gamepad's "talk" button is edge-triggered here: held down it would
  // otherwise re-trigger the conversation every frame.
  var padInteractWasDown = false;

  function update(dt) {
    if (!running || paused) return;
    // Playtime is wall-clock time with the game actually in front of you —
    // menus and pauses don't count, same as the clock on a cartridge file
    // select. Flushed to storage every 20s so quitting the tab mid-session
    // doesn't lose the whole session's worth of clock.
    if (save) {
      save.playSeconds += dt;
      sinceFlush += dt;
      if (sinceFlush > 20) persist();
    }
    // The gamepad's talk button is edge-triggered: held down it would
    // otherwise re-trigger every frame. It advances dialogue too, so a pad
    // alone can carry a whole conversation.
    var pad = SETTINGS.gamepad();
    if (pad) {
      if (pad.interact && !padInteractWasDown) {
        if (talking) advanceTalk();
        else if (!window.NewseyDuel.isActive()) tryInteract();
      }
      padInteractWasDown = pad.interact;
    }
    if (talking || window.NewseyDuel.isActive()) return;
    var dx = 0, dy = 0;
    if (SETTINGS.isDown("left", keys) || touchDir === "left" || (pad && pad.left)) dx -= 1;
    if (SETTINGS.isDown("right", keys) || touchDir === "right" || (pad && pad.right)) dx += 1;
    if (SETTINGS.isDown("up", keys) || touchDir === "up" || (pad && pad.up)) dy -= 1;
    if (SETTINGS.isDown("down", keys) || touchDir === "down" || (pad && pad.down)) dy += 1;
    if (dx || dy) {
      var len = Math.sqrt(dx * dx + dy * dy);
      dx /= len; dy /= len;
      player.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      // Try each axis independently so the player can slide along a wall
      // or obstacle instead of fully stopping the moment either axis hits
      // something.
      var tryX = clampToFloor(currentRoom, player.x + dx * player.speed * dt, player.y);
      var blockerX = npcAt(currentRoom, tryX.x, player.y);
      if (blockerX && !blockedByObstacle(currentRoom, tryX.x, player.y)) registerPush(currentRoom, blockerX, dt);
      if (!blockerX && !blockedByObstacle(currentRoom, tryX.x, player.y)) player.x = tryX.x;
      var tryY = clampToFloor(currentRoom, player.x, player.y + dy * player.speed * dt);
      var blockerY = npcAt(currentRoom, player.x, tryY.y);
      if (blockerY && !blockedByObstacle(currentRoom, player.x, tryY.y)) registerPush(currentRoom, blockerY, dt);
      if (!blockerY && !blockedByObstacle(currentRoom, player.x, tryY.y)) player.y = tryY.y;
      isWalking = true;
      walkPhase += dt * 9; // frame-cycle speed (~3 pose changes/sec); unrelated to player.speed so it stays readable
    } else {
      isWalking = false;
      pushedNpc = null; pushTimer = 0;
    }
    // exits
    // Doors stay disarmed until you step off them, so arriving in a doorway
    // can't immediately throw you back through it.
    var onExit = false;
    currentRoom.exits.forEach(function (ex) {
      if (player.x + player.w > ex.x && player.x < ex.x + ex.w &&
          player.y + player.h > ex.y && player.y < ex.y + ex.h) {
        onExit = true;
        if (exitsArmed) enterRoom(ex.to, ex.arriveAt);
      }
    });
    if (!onExit) exitsArmed = true;
    currentRoom.npcs.forEach(function (npc) { updateNpcWander(currentRoom, npc, dt); });
  }

  // ---- rendering ----
  function drawRoomBg() {
    var entry = loadArt("bg-" + currentRoom.bg);
    if (entry && entry.ok) {
      ctx.drawImage(entry.img, 0, 0, VW, VH);
      return;
    }
    // Fallback: flat tinted room with a floor/wall split, deterministic per room.
    var hues = { lounge: 20, library: 265, house: 35, bedroom: 300, arena: 45 };
    var h = hues[currentRoom.bg] !== undefined ? hues[currentRoom.bg] : 250;
    ctx.fillStyle = "hsl(" + h + ",30%,14%)";
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = "hsl(" + h + ",25%,20%)";
    ctx.fillRect(0, 26, VW, VH - 26);
    ctx.strokeStyle = "hsla(" + h + ",40%,40%,0.4)";
    ctx.lineWidth = 1;
    for (var gx = 0; gx < VW; gx += 20) { ctx.beginPath(); ctx.moveTo(gx, 26); ctx.lineTo(gx, VH); ctx.stroke(); }
  }

  // Every exit box is placed on the door that the room's art actually draws
  // (measured per room in story.js), so there is nothing to highlight except
  // the doorway itself: a warm pool of light on its threshold, and the name of
  // where it goes once you are close enough to use it. The old version painted
  // a yellow slab wherever the box happened to be, which is what made doors
  // look like they were in the wrong place.
  // An exit marked drawn: "threshold" has no door in the art — it is the way
  // you came in, at the bottom edge of the room — so we draw the frame too.
  function drawExits() {
    currentRoom.exits.forEach(function (ex) {
      // No label: the doorway is the sign. A pool of warm light on its
      // threshold, brighter as you approach, is all the hint it needs.
      var cx = ex.x + ex.w / 2;
      var cy = ex.y + ex.h - 2;
      var near = playerNearExit(ex);
      var glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, ex.w * 0.75);
      glow.addColorStop(0, near ? "rgba(255,224,150,0.42)" : "rgba(255,209,102,0.18)");
      glow.addColorStop(1, "rgba(255,209,102,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(ex.x - ex.w / 2, ex.y - ex.h, ex.w * 2, ex.h * 3);

      // The drawn doorway goes ON TOP of its own glow — painted under it, the
      // light washed straight through the opening and it read as a lit box.
      if (ex.drawn === "threshold") drawThreshold(ex);
    });
  }

  function playerNearExit(ex) {
    var px = player.x + player.w / 2, py = player.y + player.h / 2;
    var dx = Math.max(ex.x - px, 0, px - (ex.x + ex.w));
    var dy = Math.max(ex.y - py, 0, py - (ex.y + ex.h));
    return Math.sqrt(dx * dx + dy * dy) < 26;
  }

  // A doorway painted onto the bottom edge of the room, for rooms whose art
  // only drew one door. It reads as an opening in the near wall — a dark
  // stairwell mouth with a frame around it and a step down into it — so the
  // way back is something you can see rather than an invisible line.
  function drawThreshold(ex) {
    var x = ex.x, y = ex.y, w = ex.w, h = ex.h;
    var post = Math.max(4, Math.round(w * 0.12));
    var inner = { x: x + post, w: w - post * 2 };
    ctx.save();

    // the opening: darker as it goes down, and slightly narrower at the back
    var mouth = ctx.createLinearGradient(0, y - 2, 0, y + h + 6);
    mouth.addColorStop(0, "rgba(8,4,14,0.75)");
    mouth.addColorStop(1, "rgba(4,2,8,0.97)");
    ctx.fillStyle = mouth;
    ctx.beginPath();
    ctx.moveTo(inner.x + 3, y);
    ctx.lineTo(inner.x + inner.w - 3, y);
    ctx.lineTo(inner.x + inner.w, VH);
    ctx.lineTo(inner.x, VH);
    ctx.closePath();
    ctx.fill();

    // a step catching the room's light, so the mouth reads as going DOWN
    ctx.fillStyle = "rgba(255,220,170,0.14)";
    ctx.fillRect(inner.x + 2, y, inner.w - 4, 2);

    // frame: two posts and a lintel, in the same wood as the room's trim
    ctx.fillStyle = "#5a3a24";
    ctx.fillRect(x, y - 4, post, VH - y + 4);
    ctx.fillRect(x + w - post, y - 4, post, VH - y + 4);
    ctx.fillRect(x, y - 4, w, 4);
    ctx.fillStyle = "#7a5233";
    ctx.fillRect(x, y - 4, w, 1);
    ctx.fillRect(x, y - 4, 1, VH - y + 4);
    ctx.fillRect(x + w - 1, y - 4, 1, VH - y + 4);
    ctx.restore();
  }

  // Prefer a real standing sprite (npc.sprite — a full-body, transparent-
  // background image, feet-down) so the character actually looks like a
  // body standing on the floor. Falls back to a round bust token (from
  // npc.art, the same portrait used in the talk box) when no sprite art
  // exists yet, and to a plain colored circle with an initial when neither
  // exists — always anchored to a ground shadow so nothing reads as a
  // photo floating mid-air.
  function drawNpc(npc) {
    var c = CHARACTERS[npc.id] || { name: npc.id, color: "#8a5cf6" };
    // A save point is a piece of furniture already painted into the room's
    // background art, not a person — so it gets a small glowing marker
    // hovering over it instead of the round bust token used for characters.
    if (npc.savePoint) { drawSavePoint(npc); return; }
    var spriteEntry = npc.sprite ? loadArt(npc.sprite) : null;
    var hasSprite = spriteEntry && spriteEntry.ok && spriteEntry.img.naturalHeight;

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath(); ctx.ellipse(npc.x, npc.y, 11, 3.4, 0, 0, Math.PI * 2); ctx.fill();

    if (hasSprite) {
      var img = spriteEntry.img;
      var size = spriteDrawSize(img, 30), w = size.w, h = size.h;
      ctx.drawImage(img, npc.x - w / 2, npc.y - h, w, h);
    } else {
      var entry = loadArt(npc.art);
      var r = 11;
      ctx.save();
      ctx.beginPath(); ctx.arc(npc.x, npc.y - r, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      if (entry && entry.ok) {
        ctx.drawImage(entry.img, npc.x - r, npc.y - r * 2, r * 2, r * 2);
      } else {
        ctx.fillStyle = c.color;
        ctx.fillRect(npc.x - r, npc.y - r * 2, r * 2, r * 2);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(c.name.charAt(0), npc.x, npc.y - r + 3);
      }
      ctx.restore();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(npc.x, npc.y - r, r, 0, Math.PI * 2); ctx.stroke();
    }

  }

  // A slow pulsing diamond over a save point, in the same gold as the exit
  // labels so it reads as "interactive scenery" at a glance.
  function drawSavePoint(npc) {
    var pulse = 0.65 + 0.35 * Math.sin(Date.now() / 380);
    var y = npc.y - 10 - Math.sin(Date.now() / 700) * 1.5;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.moveTo(npc.x, y - 5); ctx.lineTo(npc.x + 4, y); ctx.lineTo(npc.x, y + 5); ctx.lineTo(npc.x - 4, y);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = pulse * 0.35;
    ctx.beginPath(); ctx.arc(npc.x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    var d = Math.hypot(npc.x - (player.x + player.w / 2), npc.y - (player.y + player.h / 2));
    if (d < 26) {
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 7px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SAVE", npc.x, y + 16);
    }
  }

  // Real per-direction, real per-frame art: down/left/up each have 3
  // actual generated frames (extracted from a walk-cycle sheet — see
  // nella_walksheet.png), cycled while moving — not a single static image
  // with a code-side bob. Right reuses "left" mirrored, since a 2D side
  // profile facing right is the same art flipped. Falls back to the
  // single forward-facing "nella_top" sprite (mirrored for left) if the
  // directional frames aren't available, then to the plain colored blob.
  var FACING_FRAMES = {
    down: ["nella_down_0", "nella_down_1", "nella_down_2"],
    up: ["nella_up_0", "nella_up_1", "nella_up_2"],
    left: ["nella_left_0", "nella_left_1", "nella_left_2"],
    right: ["nella_left_0", "nella_left_1", "nella_left_2"]
  };
  // Before the Infinity transformation (ROOMS.house) Nella is her ordinary
  // human self — a separate walk-cycle sheet, same 3-frame-per-direction
  // shape as the demon avatar above (right mirrors left, same as it does).
  var FACING_FRAMES_HUMAN = {
    down: ["nella_human_down_0", "nella_human_down_1", "nella_human_down_2"],
    up: ["nella_human_up_0", "nella_human_up_1", "nella_human_up_2"],
    left: ["nella_human_left_0", "nella_human_left_1", "nella_human_left_2"],
    right: ["nella_human_left_0", "nella_human_left_1", "nella_human_left_2"]
  };
  function drawPlayer() {
    var human = currentRoom && currentRoom.playerForm === "human";
    var frameSet = human ? FACING_FRAMES_HUMAN : FACING_FRAMES;
    var frames = frameSet[player.facing] || frameSet.down;
    // 3 real frames cycled by walkPhase while moving; frame 0 (idle pose)
    // while standing still, so she doesn't look like she's still walking
    // in place after stopping.
    var frameIdx = isWalking ? Math.floor(walkPhase) % 3 : 0;
    var wantId = frames[frameIdx];
    var entry = loadArt(wantId);
    // Fallback while a directional frame is missing: the form's single
    // static portrait, forward-facing — needs the same left-mirror the
    // directional frames get, tracked separately since wantId no longer
    // says "nella_top" once a fallback swaps the actual entry.
    var usedFallback = !(entry && entry.ok);
    if (usedFallback) entry = loadArt(human ? "nella_human_top" : "nella_top");
    // Same ground shadow every NPC gets — the player was the one figure in
    // the scene standing on nothing, a mismatch reported live as "floating".
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(player.x + player.w / 2, player.y + player.h, 11, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (entry && entry.ok) {
      var img = entry.img;
      var size = spriteDrawSize(img, 30), w = size.w, h = size.h;
      var cx = player.x + player.w / 2, feetY = player.y + player.h;
      var mirror = player.facing === "right" || (player.facing === "left" && usedFallback);
      ctx.save();
      if (mirror) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, feetY - h, w, h);
      } else {
        ctx.drawImage(img, cx - w / 2, feetY - h, w, h);
      }
      ctx.restore();
      return;
    }
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(player.x, player.y, player.w, player.h);
    ctx.beginPath(); ctx.arc(player.x + player.w / 2, player.y - 4, 6, 0, Math.PI * 2); ctx.fill();
    // facing indicator
    ctx.fillStyle = "#ffd166";
    var fx = player.x + player.w / 2, fy = player.y - 4;
    if (player.facing === "down") ctx.fillRect(fx - 1, fy + 3, 2, 3);
    if (player.facing === "up") ctx.fillRect(fx - 1, fy - 7, 2, 3);
    if (player.facing === "left") ctx.fillRect(fx - 8, fy - 1, 3, 2);
    if (player.facing === "right") ctx.fillRect(fx + 5, fy - 1, 3, 2);
  }

  function render() {
    ctx.clearRect(0, 0, VW, VH);
    if (!currentRoom || !running) return;
    drawRoomBg();
    drawExits();
    // sort by y so things lower on screen draw on top (cheap depth)
    var entities = currentRoom.npcs.map(function (n) { return { y: n.y, draw: function () { drawNpc(n); } }; });
    entities.push({ y: player.y + player.h, draw: drawPlayer });
    entities.sort(function (a, b) { return a.y - b.y; });
    entities.forEach(function (e) { e.draw(); });
  }

  function loop(t) {
    if (lastTime === null) lastTime = t;
    var dt = Math.min(0.05, (t - lastTime) / 1000);
    lastTime = t;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- shell API ----------
  // menu.js owns the title screen, the file select and the pause menu; it
  // drives the world through these. Nothing below auto-starts — the game only
  // begins once a file has actually been chosen.
  function clearTransientState() {
    if (window.NewseyDuel.isActive()) window.NewseyDuel.stop();
    talkBox.hidden = true;
    talking = null;
    keys = {};
    touchDir = null;
    cutsceneDoneCallback = null;
  }

  // slot: 1..3. fresh: true for NEW GAME (play the intro), false for CONTINUE.
  function beginFile(slot, fresh) {
    activeSlot = slot;
    save = fresh ? SAVES.blank() : (SAVES.read(slot) || SAVES.blank());
    npcLineCounters = save.lines || {};
    clearTransientState();
    running = true;
    paused = false;
    sinceFlush = 0;
    if (save.introSeen) {
      cutsceneEl.classList.add("hidden");
      applyControlsSetting();
      // enterRoom autosaves, which rewrites save.pos with the room's start
      // position — so read the saved spot out first, then put her back on it.
      var savedPos = save.pos;
      enterRoom(save.room || "house");
      if (savedPos) { player.x = savedPos.x; player.y = savedPos.y; }
    } else {
      startCutscene(STORY.INTRO_CUTSCENE, function () {
        save.introSeen = true;
        enterRoom("house");
      });
      currentRoom = ROOMS[save.room || "house"];
      player.x = currentRoom.playerStart.x; player.y = currentRoom.playerStart.y;
    }
    persist();
    sizeStage();
  }

  function quitToTitle() {
    if (running) persist();
    running = false;
    paused = false;
    activeSlot = null;
    save = null;
    npcLineCounters = {};
    clearTransientState();
    cutsceneEl.classList.add("hidden");
    document.getElementById("touchControls").hidden = true;
    roomLabelEl.textContent = "";
    currentRoom = null;
    sizeStage();
  }

  window.NewseyGame = {
    beginFile: beginFile,
    quitToTitle: quitToTitle,
    save: persist,
    isRunning: function () { return running; },
    setPaused: function (v) {
      paused = !!v;
      if (paused) { keys = {}; touchDir = null; } // don't come back mid-stride
    },
    activeSlot: function () { return activeSlot; },
    state: function () { return save; },
    // Whether the pause menu should offer "Save" — during a cutscene there is
    // no room/position worth writing yet.
    canSave: function () { return running && cutsceneEl.classList.contains("hidden"); },
    // Whether the ☰ button should be shown at all. Not just `running`: menu.js's
    // hide() (called right after beginFile() starts a fresh file's intro
    // cutscene) was clobbering the menuBtn.hidden=true that startCutscene()
    // had just set, because it only ever checked isRunning().
    canPause: function () { return running && cutsceneEl.classList.contains("hidden"); }
  };

  // The tab closing / going to the background is the one moment the player
  // can't tell us they're leaving, so flush the clock and position then.
  window.addEventListener("pagehide", function () { if (running) persist(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && running) persist();
  });

  requestAnimationFrame(loop);

  // Read-only debug hook for automated testing (headless smoke tests can't
  // reach into this closure otherwise). No effect on gameplay.
  window.__newseyDebug = {
    player: player,
    running: function () { return running; },
    slot: function () { return activeSlot; },
    save: function () { return save; },
    room: function () { return currentRoom && currentRoom.label; },
    enterRoom: enterRoom,
    startDuel: startDuel,
    duel: function () { return window.NewseyDuel.debug(); }
  };
})();
