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
    // If she's still lying down, save the spot she'd stand up onto — loading
    // straight back into the mattress would put her inside its obstacle.
    save.pos = (player.inBed && currentRoom && currentRoom.wakeSpot)
      ? { x: currentRoom.wakeSpot.x, y: currentRoom.wakeSpot.y }
      : { x: player.x, y: player.y };
    save.lines = npcLineCounters;
    SAVES.write(activeSlot, save);
    sinceFlush = 0;
  }

  // ---------- story flags ----------
  // One-off switches the world reads — "has Chuck been let in yet". They live
  // in the save file, so a door you opened stays open across a reload.
  function flags() { return (save && save.flags) || {}; }
  // The NPCs actually present in a room right now. `needs: "x"` means the NPC
  // only exists once flag x is set; `unless: "x"` means it stops existing once
  // it is. Everything that looks at a room's people goes through here —
  // interaction, collision, wandering, drawing — so an NPC can never be
  // invisible but still solid, or visible but not there.
  function roomNpcs(room) {
    if (!room) return [];
    var f = flags();
    return room.npcs.filter(function (npc) {
      if (npc.needs && !f[npc.needs]) return false;
      if (npc.unless && f[npc.unless]) return false;
      return true;
    });
  }

  // ---------- fade to / from black ----------
  // A plain black sheet over the whole stage, used at the seams: the intro
  // hands over to the world behind it, and the dream's last line ("the world
  // faded to black") gets to actually mean it.
  var fadeEl = document.getElementById("fade");
  var FADE_MS = 700;
  function fadeToBlack(done) {
    fadeEl.classList.add("on");
    setTimeout(done, FADE_MS);
  }
  function fadeFromBlack(done) {
    // Wait one frame with the room already drawn underneath before the sheet
    // starts lifting, or the first thing revealed is a blank canvas.
    requestAnimationFrame(function () {
      fadeEl.classList.remove("on");
      if (done) setTimeout(done, FADE_MS);
    });
  }
  function clearFade() { fadeEl.classList.remove("on"); }

  // ---------- art loading (graceful fallback) ----------
  var artCache = {};
  function loadArt(id) {
    if (!id) return null;
    if (artCache[id]) return artCache[id];
    var img = new Image();
    // ok stays false while the load is still in flight AND if it genuinely
    // fails — failed distinguishes the two, since a caller falling back to
    // placeholder art on "still loading" (as opposed to "will never load")
    // is a visible flicker to something wrong, not a graceful degrade. See
    // drawPlayer's lastGoodPlayerFrame for why that distinction matters.
    var entry = { img: img, ok: false, failed: false };
    img.onload = function () { entry.ok = true; };
    img.onerror = function () { entry.failed = true; };
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
  var cutsceneFadeOnEnd = false;

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
  // A cutscene that ends on a fade holds the screen black across the
  // hand-off, so whoever gets the callback can set the next room up unseen
  // and lift the fade themselves.
  function endCutscene() {
    if (cutsceneFadeOnEnd) {
      cutsceneFadeOnEnd = false;
      fadeToBlack(finishCutscene);
      return;
    }
    finishCutscene();
  }
  function finishCutscene() {
    cutsceneEl.classList.add("hidden");
    applyControlsSetting();
    sizeStage();
    var cb = cutsceneDoneCallback;
    cutsceneDoneCallback = null;
    if (cb) cb();
  }
  // list: which cutscene array to play. onDone: called once it finishes
  // (decides which room to land in — the two cutscenes go to different
  // rooms, so this isn't hardcoded here).
  function startCutscene(list, onDone, fadeOnEnd) {
    activeCutscene = list;
    cutsceneDoneCallback = onDone;
    cutsceneFadeOnEnd = !!fadeOnEnd;
    cIndex = 0; lastBg = "";
    portraitImg.hidden = true;
    portraitFallback.hidden = true;
    cutsceneEl.classList.remove("hidden");
    applyControlsSetting();
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
  var player = { x: 60, y: 150, w: 14, h: 18, speed: 70, facing: "down", inBed: false, bedSlide: null };
  var walkPhase = 0, isWalking = false; // drives real walk-frame cycling (see drawPlayer)
  var lastGoodPlayerFrame = null; // last successfully-loaded frame drawPlayer showed — see drawPlayer
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
    player.inBed = false;
    player.bedSlide = null;
    bedPush = 0;
    var spot = at && at.x !== undefined ? at : currentRoom.playerStart;
    // The mask may not have loaded yet on the very first room; re-place her
    // once it has, so a spawn point that lands off the floor still resolves.
    placeOnFloor(currentRoom, spot.x, spot.y);
    var room = currentRoom, tries = 0;
    var settle = setInterval(function () {
      if (currentRoom !== room || ++tries > 40) return clearInterval(settle);
      if (!walkMask(room).ready) return;
      clearInterval(settle);
      // Asleep in bed is the one time she is legitimately not on the floor —
      // re-placing her then dumped her on the floorboards beside the bed as a
      // head with no body, which is how this was spotted.
      if (player.inBed) return;
      if (!canStand(room, player.x, player.y)) placeOnFloor(room, player.x, player.y);
    }, 50);
    if (save) { save.room = roomId; persist(); } // walking through a door autosaves
  }

  // ---- the black rune door ----
  // The plot's way around Infinity, and the only door that asks you a
  // question. The FIRST push doesn't: "She wasn't sure how to open the door,
  // but decided to push where she guessed a handle could be... The room was
  // not the library" — so the first time it just dumps you in the Garden.
  // Kyran is the one who tells you about the chaos rune, and after that the
  // carvings resolve into words you can pick from.
  var runeEl = document.getElementById("runeDoor");
  var runeTitleEl = document.getElementById("runeTitle");
  var runeListEl = document.getElementById("runeList");
  var runeOpen = false;

  function runeDoorKnown() { return !!(save && save.flags && save.flags.runeDoorLearned); }

  function openRuneDoor() {
    if (!runeDoorKnown()) {
      // The accidental first trip. Sent somewhere she didn't choose, which is
      // the whole reason she ever meets Kyran.
      enterRoom("garden");
      showNarration([
        "The door is black marble, carved over with runes, and heavier than it looks.",
        "You push where a handle ought to be. It gives, creaking.",
        "This is not the library."
      ]);
      return;
    }
    runeOpen = true;
    runeTitleEl.textContent = "You put your palm on the chaos symbol. The carvings fade, and words come up in white paint.";
    runeListEl.innerHTML = "";
    STORY.RUNE_DOOR.forEach(function (dest) {
      var b = document.createElement("button");
      b.textContent = dest.label + (dest.locked ? "" : "");
      if (dest.locked) {
        b.className = "locked";
        b.onclick = function () { runeTitleEl.textContent = dest.locked; };
      } else {
        b.onclick = function () {
          closeRuneDoor();
          enterRoom(dest.to, dest.arriveAt);
        };
      }
      runeListEl.appendChild(b);
    });
    runeEl.hidden = false;
  }

  function closeRuneDoor() {
    runeOpen = false;
    runeEl.hidden = true;
  }
  document.getElementById("runeBack").onclick = function () {
    closeRuneDoor();
    // Step back off the threshold, or the next frame opens it again.
    player.y -= 14;
    exitsArmed = false;
  };

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
    roomNpcs(currentRoom).forEach(function (npc) {
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

  // Lines with nobody saying them — the knocking that wakes you, a door
  // being opened. Same box as a conversation, minus the face and nameplate.
  function showNarration(lines) {
    talking = { npc: { id: "_narration", narration: true, art: null, lines: lines,
                       counterKey: "_narration" }, lineIndex: 0 };
    renderTalk();
  }

  function renderTalk() {
    var npc = talking.npc;
    if (npc.narration) {
      talkSpeaker.textContent = "";
      talkLine.textContent = npc.lines[talking.lineIndex];
      talkPortrait.hidden = true;
      talkPortraitFallback.hidden = true;
      talkBox.hidden = false;
      return;
    }
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
        startCutscene(STORY[wasTalking.npc.cutscene], function () {
          // You arrive in Infinity the same way you arrived in the game: in
          // bed, coming up out of the black. Waking on your feet in the middle
          // of a strange room read as a teleport, not as waking up.
          enterRoom("bedroom");
          putToBed();
          persist();
          fadeFromBlack();
        }, true);
      }
      if (wasTalking.npc.gotoRoom) enterRoom(wasTalking.npc.gotoRoom);
      // Opening the front door flips a story flag: the door itself stops
      // existing and Chuck starts existing, both via roomNpcs() above.
      if (wasTalking.npc.setsFlag && save) {
        save.flags[wasTalking.npc.setsFlag] = true;
        persist();
      }
      // …and he speaks up straight away, rather than making you walk over and
      // press talk at the man you just let in out of the rain.
      if (wasTalking.npc.thenTalk) {
        var next = null;
        roomNpcs(currentRoom).forEach(function (n) { if (n.id === wasTalking.npc.thenTalk) next = n; });
        if (next && next.entryFrom) {
          // He's appearing for the first time this flag flip — spawn him at
          // the door and walk him to his real spot instead of having him
          // simply materialize already standing in the room. Reported live
          // ("he just appears in the room") right after his walk cycle
          // landed, which is what makes this worth doing now — no walk
          // frames, no visible walk-in either way.
          var home = { x: next.x, y: next.y };
          next.x = next.entryFrom.x; next.y = next.entryFrom.y;
          next._wander = { homeX: home.x, homeY: home.y, tx: home.x, ty: home.y, pause: 0, scriptedEntry: true };
          pendingEntranceTalk = next;
        } else if (next) {
          talking = { npc: next, lineIndex: npcLineCounters[next.id] || 0 }; renderTalk();
        }
      }
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
    window.NewseyDuel.start({
      playerName: CHARACTERS.nella.name,
      playerLevel: config.playerLevel || 2,
      // A duel can be a set: `firstTo: 5` on the NPC's duel block makes it
      // best-of, the way Kat's is in the plot ("First to five wins").
      firstTo: config.firstTo || 1,
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
  // ---- collision: she can only walk on the floor ----
  // What counts as floor isn't guessed at runtime. It's baked from each
  // room's own background art into art/walk-<room>.png by
  // .github/art/build_walkmask.py (white = floor): the room's silhouette
  // below its wall line, minus whatever stands on the floor. Diagonal walls,
  // angled corners and furniture drawn in perspective are therefore exactly
  // what the picture shows, which no hand-written shape can promise. All this
  // code does is ask whether the pixel under someone's feet is floor.
  var walkMasks = {};
  function walkMask(room) {
    var id = room.bg;
    if (walkMasks[id]) return walkMasks[id];
    var entry = { ready: false, data: null };
    walkMasks[id] = entry;
    var img = new Image();
    img.onload = function () {
      var off = document.createElement("canvas");
      off.width = VW; off.height = VH;
      var octx = off.getContext("2d");
      octx.drawImage(img, 0, 0, VW, VH);
      entry.data = octx.getImageData(0, 0, VW, VH).data;
      entry.ready = true;
    };
    img.src = "art/walk-" + id + ".png";
    return entry;
  }

  // Standard even-odd ray cast, used by the fallbacks below.
  function pointInPoly(poly, x, y) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // While a mask is still loading — or if one is missing for a room — fall
  // back to the room's traced floorPoly, and then to a plain rectangle, so
  // nobody is ever frozen in place by a slow network.
  var FALLBACK_FLOOR = { x: 22, y: 102, w: VW - 44, h: 84 };

  function isFloor(room, feetX, feetY) {
    var mask = walkMask(room);
    if (!mask.ready) {
      if (room.floorPoly) return pointInPoly(room.floorPoly, feetX, feetY);
      return feetX >= FALLBACK_FLOOR.x && feetX <= FALLBACK_FLOOR.x + FALLBACK_FLOOR.w &&
             feetY >= FALLBACK_FLOOR.y && feetY <= FALLBACK_FLOOR.y + FALLBACK_FLOOR.h;
    }
    var x = Math.round(feetX), y = Math.round(feetY);
    if (x < 0 || y < 0 || x >= VW || y >= VH) return false;
    return mask.data[(y * VW + x) * 4] > 127;
  }

  // A doorway plus a margin — kept clear of wandering NPCs.
  // ---- props ----
  // Scenery that stands UP off the floor — a tree, a fountain — drawn as its
  // own sprite rather than painted into the background, so it can sort against
  // the player by foot position: walk above its base and you pass behind it,
  // walk into the base and you stop. Painted into the background it could only
  // ever be a flat picture you either walked over or were fenced away from.
  // A prop is { art, x, y, h, base: { rx, ry } } — x/y is where it MEETS THE
  // GROUND, h is how tall it draws, and base is the ellipse at its foot that
  // nothing can walk into.
  function blockedByProp(room, feetX, feetY) {
    var props = room.props;
    if (!props) return false;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (!p.base) continue;
      var dx = (feetX - p.x) / p.base.rx, dy = (feetY - p.y) / p.base.ry;
      if (dx * dx + dy * dy < 1) return true;
    }
    return false;
  }

  var DOOR_CLEARANCE = 10;
  function inDoorway(room, feetX, feetY) {
    var exits = room.exits || [];
    for (var i = 0; i < exits.length; i++) {
      var e = exits[i];
      if (feetX > e.x - DOOR_CLEARANCE && feetX < e.x + e.w + DOOR_CLEARANCE &&
          feetY > e.y - DOOR_CLEARANCE && feetY < e.y + e.h + DOOR_CLEARANCE) return true;
    }
    return false;
  }

  // Can she stand with her feet here?
  function canStand(room, x, y) {
    return isFloor(room, x + player.w / 2, y + player.h) &&
           !blockedByProp(room, x + player.w / 2, y + player.h);
  }

  // Nearest floor to a point, searched outward in rings. Used whenever
  // someone is placed in a room: a spawn point that misses the floor by a few
  // pixels would otherwise leave them wedged, since every direction out of it
  // is also not-floor.
  function nearestFloor(room, feetX, feetY) {
    // Also refuses a spot someone else is standing on: arriving on top of an
    // NPC leaves you wedged against them until you shove them aside.
    function free(x, y) {
      return isFloor(room, x, y) && !npcAt(room, x - player.w / 2, y - player.h);
    }
    if (free(feetX, feetY)) return { x: feetX, y: feetY };
    for (var r = 2; r <= 90; r += 2) {
      for (var a = 0; a < 32; a++) {
        var ang = (a / 32) * Math.PI * 2;
        var x = feetX + Math.cos(ang) * r, y = feetY + Math.sin(ang) * r;
        if (free(x, y)) return { x: x, y: y };
      }
    }
    return { x: feetX, y: feetY };
  }

  // Place her by her FEET, on floor.
  function placeOnFloor(room, x, y) {
    var spot = nearestFloor(room, x + player.w / 2, y + player.h);
    player.x = spot.x - player.w / 2;
    player.y = spot.y - player.h;
  }

  // NPCs are people, not floor markings — walking straight through one looked
  // wrong and was reported live. Treated as a small circle at their feet.
  var NPC_COLLIDE_RADIUS = 8;
  // Returns the blocking NPC (not just true/false) so a sustained shove can
  // be attributed to a specific person and made to step aside — see the push
  // handling in update().
  function npcAt(room, x, y) {
    var cx = x + player.w / 2, cy = y + player.h;
    var present = roomNpcs(room);
    for (var i = 0; i < present.length; i++) {
      var npc = present[i];
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
    // Anything drawn as a fixed marker (a door, a portal, the mirror) or
    // furniture with no wander opt-out set is scenery, not a person — its x/y
    // is either a hitbox tied to a fixed spot in the room art, or a prop that
    // was never meant to move. Reported live as "the console floating around
    // the room": the tv object has a sprite but no marker, so it fell through
    // this check with nothing to catch it.
    if (npc.marker || npc._noWander) return;
    var w = ensureWanderState(npc);
    if (w.pause > 0) { w.pause -= dt; w.walking = false; return; }
    var dx = w.tx - npc.x, dy = w.ty - npc.y, d = Math.hypot(dx, dy);
    if (d < 1.5) { pickWanderTarget(w); w.pause = 1 + Math.random() * 2.5; w.walking = false; return; }
    var step = Math.min(d, WANDER_SPEED * dt);
    var nx = npc.x + (dx / d) * step, ny = npc.y + (dy / d) * step;
    // Nobody wanders off the floor either — same mask, same question — and
    // nobody parks in a doorway: someone standing in the door blocks the way
    // through until you shove them aside, which reads as a broken door.
    if (!isFloor(room, nx, ny) || blockedByProp(room, nx, ny) || inDoorway(room, nx, ny)) { pickWanderTarget(w); w.walking = false; return; }
    // A scripted entrance (see entryFrom/pendingEntranceTalk) skips the
    // player-proximity block below: you're always standing right at the
    // door to have opened it, so the very first step of "come inside" would
    // otherwise read as walking toward the player and get blocked forever —
    // confirmed live, Chuck never took a single step in from the door.
    // Someone being let in isn't "walking into" you the way a wandering
    // NPC's random drift would be.
    if (w.scriptedEntry) { npc.x = nx; npc.y = ny; w.walking = true; w.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"); w.walkPhase = (w.walkPhase || 0) + dt * 9; return; }
    var pd = Math.hypot(nx - (player.x + player.w / 2), ny - (player.y + player.h));
    var curPd = Math.hypot(npc.x - (player.x + player.w / 2), npc.y - (player.y + player.h));
    // Block a step that would walk INTO the player, but never one that's
    // increasing the distance — otherwise a step-aside (registerPush, whose
    // whole target is "away from the player") could never actually clear the
    // same radius it's trying to escape.
    if (pd < NPC_COLLIDE_RADIUS + 4 && pd < curPd) { w.walking = false; return; }
    // Same facing+phase bookkeeping drawPlayer keeps for the player, so an
    // NPC with real walk frames (see NPC_FACING_FRAMES) animates the same
    // way instead of gliding — a static sprite sliding across the floor was
    // the very thing this whole walk-cycle effort exists to get rid of.
    npc.x = nx; npc.y = ny;
    w.walking = true;
    w.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    w.walkPhase = (w.walkPhase || 0) + dt * 9;
  }
  // Walking into someone and holding it blocks forever otherwise — a real
  // wall is fine to just stop at, a person shouldn't be. After ~2s of
  // sustained shove they step out of the way (away from the player, along
  // the current floor), then resume their normal wander from there.
  var PUSH_THRESHOLD = 2, PUSH_STEP = 22;
  var pushedNpc = null, pushTimer = 0;
  // An NPC walking in through a door (see thenTalk/entryFrom above) whose
  // dialogue is held until they've actually arrived — checked each frame in
  // update(), not opened the instant the flag flips.
  var pendingEntranceTalk = null;
  function registerPush(room, npc, dt) {
    if (npc !== pushedNpc) { pushedNpc = npc; pushTimer = 0; }
    pushTimer += dt;
    if (pushTimer < PUSH_THRESHOLD) return;
    var w = ensureWanderState(npc);
    var dx = npc.x - (player.x + player.w / 2), dy = npc.y - (player.y + player.h);
    var d = Math.hypot(dx, dy) || 1;
    // Step aside away from the player, but only as far as there is still
    // floor: back off toward where they stand until the spot is legal, so a
    // shove against a wall can't push someone out into the black — and never
    // into a doorway.
    var tx = npc.x, ty = npc.y;
    for (var step = PUSH_STEP; step >= 4; step -= 4) {
      var cx = npc.x + (dx / d) * step, cy = npc.y + (dy / d) * step;
      if (isFloor(room, cx, cy) && !inDoorway(room, cx, cy)) { tx = cx; ty = cy; break; }
    }
    w.tx = tx; w.ty = ty;
    w.homeX = w.tx; w.homeY = w.ty; // step-aside becomes their new "home" — they don't snap back into the player
    w.pause = 0;
    pushedNpc = null; pushTimer = 0;
  }
  // A gamepad's "talk" button is edge-triggered here: held down it would
  // otherwise re-trigger the conversation every frame.
  var padInteractWasDown = false;

  // ---- bed ----
  // Two rooms have a bed you sleep in (your old room upstairs, and the one
  // Infinity gives you). Both declare the same three numbers in story.js:
  // bedSpot (where she lies), bedClipY (the blanket line she's drawn behind)
  // and wakeSpot (the floor she stands up onto). bedZone is the footprint you
  // have to lean on to get back in.
  var bedPush = 0;             // seconds spent walking into the bed
  var BED_PUSH_TIME = 0.8;     // …before she climbs into it
  // She climbs in while you're still holding the direction that put her
  // there, and the first press while in bed means "get up" — so without this
  // she bounced straight back out. Cleared the moment you let go.
  var bedLock = false;

  function putToBed() {
    var bed = currentRoom && currentRoom.bedSpot;
    if (!bed) return;
    player.x = bed.x; player.y = bed.y;
    player.facing = "down";
    player.inBed = true;
    player.bedSlide = null;
    bedPush = 0;
    bedLock = false;
  }

  // into: true climbs in, false gets up. Either way it's a movement over a
  // few frames, not a teleport — with the blanket line sliding down off her
  // (or back up over her) so she comes out from under the covers.
  function startBedSlide(into) {
    var room = currentRoom;
    if (!room) return;
    var to = into ? room.bedSpot : (room.wakeSpot || room.playerStart);
    if (!to) return;
    var clip = room.bedClipY !== undefined ? room.bedClipY : VH;
    player.bedSlide = {
      t: 0, dur: 0.6, into: !!into,
      fromX: player.x, fromY: player.y,
      toX: to.x, toY: to.y,
      clipFrom: into ? VH : clip,
      clipTo: into ? clip : VH
    };
    player.facing = into ? "up" : "down";
    player.inBed = false;
    bedPush = 0;
  }

  // Standing against the bed's footprint and still pressing toward it. dx/dy
  // arrive normalised, so the dot product against the direction of the bed's
  // middle is just "how squarely is she leaning on it".
  function pushingIntoBed(room, dx, dy) {
    var z = room.bedZone;
    if (!z || !room.bedSpot) return false;
    var fx = player.x + player.w / 2, fy = player.y + player.h;
    if (fx < z.x - 14 || fx > z.x + z.w + 14) return false;
    if (fy < z.y - 16 || fy > z.y + z.h + 18) return false;
    var tx = (z.x + z.w / 2) - fx, ty = (z.y + z.h / 2) - fy;
    var len = Math.sqrt(tx * tx + ty * ty);
    if (len < 0.001) return true;
    return (dx * tx + dy * ty) / len > 0.4;
  }

  function update(dt) {
    if (runeOpen) return;
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
    // Sliding into or out of bed: hold input until the slide finishes.
    if (player.bedSlide) {
      var g = player.bedSlide;
      g.t += dt;
      var k = Math.min(1, g.t / g.dur);
      // Ease in AND out: she pushes the covers back, swings out, and settles
      // on her feet. A pure ease-out put her beside the bed in two frames,
      // which is the teleport this replaced.
      var ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      player.x = g.fromX + (g.toX - g.fromX) * ease;
      player.y = g.fromY + (g.toY - g.fromY) * ease;
      isWalking = true;
      walkPhase += dt * 9;
      if (k >= 1) {
        player.bedSlide = null;
        isWalking = false;
        if (g.into) {
          player.inBed = true; bedPush = 0; bedLock = true;
          // The bed IS the save point now — there is no invisible token to
          // walk up to and talk at any more, you just get into it.
          persist();
          window.NewseyMenu.toast("Game saved.");
        }
      }
      return;
    }

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
    // Lying in bed: the first press is "get up", not a step. She stands on
    // the floor beside the bed and control is normal from the next frame —
    // walking straight off a mattress that is also an obstacle wouldn't work
    // anyway, since the bed blocks every direction out of it.
    if (player.inBed) {
      if (!dx && !dy) bedLock = false;
      else if (!bedLock) startBedSlide(false);
      return;
    }
    if (dx || dy) {
      var len = Math.sqrt(dx * dx + dy * dy);
      dx /= len; dy /= len;
      player.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      // Try each axis independently so she can slide along a wall instead of
      // stopping dead the moment either axis meets one.
      var tryX = player.x + dx * player.speed * dt;
      var okX = canStand(currentRoom, tryX, player.y);
      var blockerX = okX ? npcAt(currentRoom, tryX, player.y) : null;
      if (blockerX) registerPush(currentRoom, blockerX, dt);
      else if (okX) player.x = tryX;
      var tryY = player.y + dy * player.speed * dt;
      var okY = canStand(currentRoom, player.x, tryY);
      var blockerY = okY ? npcAt(currentRoom, player.x, tryY) : null;
      if (blockerY) registerPush(currentRoom, blockerY, dt);
      else if (okY) player.y = tryY;
      isWalking = true;
      walkPhase += dt * 9; // frame-cycle speed (~3 pose changes/sec); unrelated to player.speed so it stays readable
      // Walking into the bed and staying there puts her back in it. No prompt
      // and no marker over the bed: leaning on it is the gesture, the same way
      // the first press out of it is "get up". The hold is what keeps it from
      // firing on every accidental brush past the footboard.
      if (pushingIntoBed(currentRoom, dx, dy)) {
        bedPush += dt;
        if (bedPush >= BED_PUSH_TIME) { startBedSlide(true); return; }
      } else bedPush = 0;
    } else {
      isWalking = false;
      bedPush = 0;
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
        if (exitsArmed) {
          if (ex.rune) openRuneDoor();
          else enterRoom(ex.to, ex.arriveAt);
        }
      }
    });
    if (!onExit) exitsArmed = true;
    roomNpcs(currentRoom).forEach(function (npc) { updateNpcWander(currentRoom, npc, dt); });
    if (pendingEntranceTalk) {
      var pw = pendingEntranceTalk._wander;
      if (Math.hypot(pendingEntranceTalk.x - pw.homeX, pendingEntranceTalk.y - pw.homeY) < 2) {
        var arrived = pendingEntranceTalk;
        pendingEntranceTalk = null;
        pw.scriptedEntry = false; // back to normal wander rules once he's actually in the room
        talking = { npc: arrived, lineIndex: npcLineCounters[arrived.id] || 0 };
        renderTalk();
      }
    }
  }

  // ---- rendering ----
  function drawRoomBg() {
    var entry = loadArt("bg-" + currentRoom.bg);
    if (entry && entry.ok) {
      ctx.drawImage(entry.img, 0, 0, VW, VH);
      return;
    }
    // Fallback: flat tinted room with a floor/wall split, deterministic per room.
    var hues = { lounge: 20, library: 265, house: 35, bedroom: 300, arena: 45, home_bedroom: 215 };
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
      // Light pools on the floor of a doorway — it lies flat, so it is drawn
      // flat: a wide, shallow ellipse, brighter as you get close. No marker,
      // no label; a door looks like a door.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.42);
      var glow = ctx.createRadialGradient(0, 0, 1, 0, 0, ex.w * 0.8);
      glow.addColorStop(0, near ? "rgba(255,224,150,0.34)" : "rgba(255,209,102,0.13)");
      glow.addColorStop(1, "rgba(255,209,102,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, ex.w * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // The drawn doorway goes ON TOP of its own glow — painted under it, the
      // light washed straight through the opening and it read as a lit box.
      if (ex.drawn === "threshold") drawThreshold(ex);

    });
  }

  // The same shallow ellipse drawExits() lays on a threshold, centred on an
  // interactable's own spot. Deliberately identical in shape and colour: one
  // visual language for "you can go through this".
  function drawFloorGlow(npc) {
    var r = 15;
    var px = player.x + player.w / 2, py = player.y + player.h;
    var near = Math.hypot(px - npc.x, py - npc.y) < 30;
    ctx.save();
    ctx.translate(npc.x, npc.y);
    ctx.scale(1, 0.42);
    var glow = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
    glow.addColorStop(0, near ? "rgba(255,224,150,0.34)" : "rgba(255,209,102,0.13)");
    glow.addColorStop(1, "rgba(255,209,102,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // PLOT.md / the verbatim plot: the lounge's duel portals are "doorways that
  // appeared to open into a swirling, purple void". The room art doesn't draw
  // one and a generated PNG can't swirl, so it's drawn here — as a DOORWAY,
  // stone jambs and an arched head, with the void standing inside it. Drawn as
  // a disc first, it read as a ball sitting on the floor rather than something
  // you walk through. It winds up as you approach.
  function drawPortal(npc) {
    var t = portalPhase;
    var px = player.x + player.w / 2, py = player.y + player.h;
    var near = Math.max(0, Math.min(1, (46 - Math.hypot(px - npc.x, py - npc.y)) / 26));
    var w = 13, h = 34;            // the opening: half-width, full height
    var frame = 3;                 // thickness of the stone surround

    drawFloorGlow(npc);

    // The arch, twice: once as stone, once as the hole in it.
    function arch(hw, hh) {
      ctx.beginPath();
      ctx.moveTo(-hw, 0);
      ctx.lineTo(-hw, -(hh - hw));
      ctx.arc(0, -(hh - hw), hw, Math.PI, 0);
      ctx.lineTo(hw, 0);
      ctx.closePath();
    }
    ctx.save();
    ctx.translate(npc.x, npc.y);

    ctx.fillStyle = "#2a2036";
    arch(w + frame, h + frame); ctx.fill();
    ctx.fillStyle = "#3a2f4c";
    arch(w + frame - 1.2, h + frame - 1.2); ctx.fill();

    ctx.save();
    arch(w, h); ctx.clip();

    // the void, filling the opening
    var cy = -h * 0.55, rad = h * 0.55;
    ctx.save();
    ctx.translate(0, cy);
    ctx.scale(w / rad, 1);
    var back = ctx.createRadialGradient(0, 0, 1, 0, 0, rad);
    back.addColorStop(0, "#06000e");
    back.addColorStop(0.5, "rgba(58,12,110," + (0.9 + near * 0.1) + ")");
    back.addColorStop(1, "rgba(120,40,200,0.55)");
    ctx.fillStyle = back;
    ctx.beginPath(); ctx.arc(0, 0, rad * 1.6, 0, Math.PI * 2); ctx.fill();

    // arms winding in toward the middle
    ctx.globalCompositeOperation = "lighter";
    for (var a = 0; a < 5; a++) {
      ctx.beginPath();
      for (var k = 0; k <= 16; k++) {
        var f = k / 16;
        var r = rad * (0.1 + f * 1.0);
        var ang = a * (Math.PI * 2 / 5) + t * (1.0 + near * 0.9) + f * 2.8;
        var x = Math.cos(ang) * r, y = Math.sin(ang) * r;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = a % 2 ? "rgba(214,124,255," + (0.30 + near * 0.35) + ")"
                              : "rgba(140,70,240," + (0.26 + near * 0.30) + ")";
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }
    // motes pulled in along the arms
    for (var m = 0; m < 7; m++) {
      var mf = ((t * 0.42 + m / 7) % 1);
      var mr = rad * (1.05 - mf);
      var ma = m * 1.7 + t * 1.5 + mf * 5;
      ctx.fillStyle = "rgba(240,205,255," + (0.7 * (1 - Math.abs(mf - 0.5) * 2) + 0.1) + ")";
      ctx.beginPath(); ctx.arc(Math.cos(ma) * mr, Math.sin(ma) * mr, 0.9, 0, Math.PI * 2); ctx.fill();
    }
    // the eye at the centre
    var eye = ctx.createRadialGradient(0, 0, 0, 0, 0, rad * 0.34);
    eye.addColorStop(0, "rgba(255,240,255," + (0.55 + near * 0.4) + ")");
    eye.addColorStop(1, "rgba(200,120,255,0)");
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.arc(0, 0, rad * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    // hot rim around the opening, breathing
    ctx.strokeStyle = "rgba(226,160,255," + (0.55 + near * 0.35) + ")";
    ctx.lineWidth = 1.3 + Math.sin(t * 2) * 0.25;
    arch(w - 0.5, h - 0.5); ctx.stroke();
    ctx.restore();
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
  // A prop draws from its own foot point upward, at its natural aspect, so a
  // tree is as tall as its art says rather than squeezed into a cell.
  function drawProp(prop) {
    var entry = loadArt(prop.art);
    if (!entry || !entry.ok || !entry.img.naturalHeight) return;
    var img = entry.img;
    var h = prop.h || 40;
    var w = h * (img.naturalWidth / img.naturalHeight);
    // A pool of shadow where it meets the ground, the same way every character
    // gets one — without it a tree reads as pasted onto the grass.
    if (prop.base) {
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.beginPath();
      ctx.ellipse(prop.x, prop.y, prop.base.rx, prop.base.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.drawImage(img, prop.x - w / 2, prop.y - h, w, h);
  }

  function drawNpc(npc) {
    var c = CHARACTERS[npc.id] || { name: npc.id, color: "#8a5cf6" };
    // Some interactables are scenery already painted into the room art — a
    // bed, a door, a portal — not people. Drawing them as the round bust
    // token every character gets produced a floating disc with the first
    // letter of their name stamped on it ("T", for The Front Door) sitting in
    // the middle of the floor. They get a small glowing marker over the thing
    // itself instead, and a word telling you what it does when you're close.
    // No floating marker, and no label either — the door looks like a door
    // and the mirror looks like a mirror. Walking up and pressing the talk
    // button is how you use anything, everywhere. What a marker gets instead
    // is the same flat pool of light on the floor a doorway gets: lying down
    // in the scene rather than standing up in it. The one thing the room art
    // never draws is the lounge's portal, so that one is drawn outright.
    if (npc.marker) {
      if (npc.look === "portal") drawPortal(npc); else drawFloorGlow(npc);
      return;
    }
    // Real walk frames, if this character has a sheet (NPC_FACING_FRAMES),
    // take priority over the single static sprite — same idea as the player:
    // a body standing still still looks like it's gliding across the floor
    // if the art never changes while wander moves it around.
    var walkSet = NPC_FACING_FRAMES[npc.id];
    var walkEntry = null, walkMirror = false;
    if (walkSet) {
      var w2 = npc._wander;
      var facing = (w2 && w2.facing) || "down";
      var frames = walkSet[facing] || walkSet.down;
      var frameIdx = (w2 && w2.walking) ? WALK_SEQUENCE[Math.floor(w2.walkPhase || 0) % WALK_SEQUENCE.length] : 1;
      var candidate = loadArt(frames[frameIdx]);
      if (candidate && candidate.ok) { walkEntry = candidate; walkMirror = facing === "right"; }
    }
    var spriteEntry = npc.sprite ? loadArt(npc.sprite) : null;
    var hasSprite = !walkEntry && spriteEntry && spriteEntry.ok && spriteEntry.img.naturalHeight;

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath(); ctx.ellipse(npc.x, npc.y, 11, 3.4, 0, 0, Math.PI * 2); ctx.fill();

    if (walkEntry) {
      var wimg = walkEntry.img;
      var wsize = spriteDrawSize(wimg, 30), ww = wsize.w, wh = wsize.h;
      ctx.save();
      if (walkMirror) {
        ctx.translate(npc.x, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(wimg, -ww / 2, npc.y - wh, ww, wh);
      } else {
        ctx.drawImage(wimg, npc.x - ww / 2, npc.y - wh, ww, wh);
      }
      ctx.restore();
    } else if (hasSprite) {
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
  // Standard RPG-Maker charset convention, shared by drawPlayer and drawNpc:
  // frame 1 (the MIDDLE of the 3) is the neutral standing pose, used both at
  // rest and as the walk cycle's resting beat — frames 0/2 are the two
  // mirrored step poses. Cycling 0,1,2 on repeat never actually returns to
  // neutral mid-walk and, worse, uses frame 0 — a mid-step pose — for idle,
  // so a character freezes mid-stride the instant it stops moving.
  var WALK_SEQUENCE = [1, 0, 1, 2];
  // Same <id>_<dir>_<frame> naming slice_walksheet.py writes, one entry per
  // NPC that has a real walk sheet — id absent from this table just means
  // "no walk art yet", and drawNpc falls back to its static sprite/bust the
  // same as it always has, so adding a character here is the only wiring a
  // freshly-generated sheet needs.
  function npcDirFrames(id) {
    return {
      down: [id + "_down_0", id + "_down_1", id + "_down_2"],
      up: [id + "_up_0", id + "_up_1", id + "_up_2"],
      left: [id + "_left_0", id + "_left_1", id + "_left_2"],
      right: [id + "_left_0", id + "_left_1", id + "_left_2"]
    };
  }
  var NPC_FACING_FRAMES = {};
  ["chuck", "devil", "kat", "may", "timothy", "michael", "john"].forEach(function (id) {
    NPC_FACING_FRAMES[id] = npcDirFrames(id);
  });
  // Best-effort preload, same reasoning as the player's — loadArt() on an id
  // with no file behind it yet just never resolves ok, which drawNpc already
  // treats as "no walk art, use the fallback", so this is safe to run before
  // any of these sheets exist.
  Object.keys(NPC_FACING_FRAMES).forEach(function (id) {
    var set = NPC_FACING_FRAMES[id];
    Object.keys(set).forEach(function (dir) { set[dir].forEach(loadArt); });
  });
  // loadArt() kicks off an async Image load and returns ok:false until it
  // fires — fine for most art, but drawPlayer() doesn't wait: the FIRST time
  // any given directional frame is needed (e.g. the very first step in a new
  // direction, worst-case right after a hard refresh with a cold cache) it
  // reads as "missing" for a frame or two and falls back to the single
  // forward-facing portrait, mirrored — a visible flip to a totally different
  // pose before the real frame lands. Reported live as "it flips left and
  // right when I walk left". Kicking every frame's load off up front, before
  // she ever takes a step, means by the time a direction is actually pressed
  // the image is already loaded (or loading) and drawPlayer never needs the
  // fallback.
  [FACING_FRAMES, FACING_FRAMES_HUMAN].forEach(function (set) {
    Object.keys(set).forEach(function (dir) { set[dir].forEach(loadArt); });
  });
  function drawPlayer() {
    var human = currentRoom && currentRoom.playerForm === "human";
    var frameSet = human ? FACING_FRAMES_HUMAN : FACING_FRAMES;
    var frames = frameSet[player.facing] || frameSet.down;
    var frameIdx = isWalking ? WALK_SEQUENCE[Math.floor(walkPhase) % WALK_SEQUENCE.length] : 1;
    var wantId = frames[frameIdx];
    var entry = loadArt(wantId);
    var pending = entry && !entry.ok && !entry.failed;
    // Fallback while a directional frame is genuinely missing (not just
    // still loading — see loadArt): the form's single static portrait,
    // forward-facing, needs the same left-mirror the directional frames
    // get, tracked separately since wantId no longer says "nella_top" once
    // a fallback swaps the actual entry.
    var usedFallback = entry && entry.failed;
    if (usedFallback) {
      entry = loadArt(human ? "nella_human_top" : "nella_top");
    } else if (pending && lastGoodPlayerFrame) {
      // Still loading (e.g. the very first time this direction is needed,
      // right after a hard refresh) — hold whatever was drawn last instead
      // of flashing the fallback portrait for a frame. That flash-to-a-
      // different-pose, mirrored on top of it, was reported live as "it
      // flips left and right when I walk left": a real timing race, not an
      // art bug, since it only ever lasted until the real frame finished
      // loading a moment later.
      entry = lastGoodPlayerFrame.entry;
      usedFallback = lastGoodPlayerFrame.usedFallback;
    } else if (!pending) {
      lastGoodPlayerFrame = { entry: entry, usedFallback: usedFallback };
    }
    // Same ground shadow every NPC gets — the player was the one figure in
    // the scene standing on nothing, a mismatch reported live as "floating".
    // Not while she's in bed: she isn't on the floor, she's on a mattress.
    if (!player.inBed && !player.bedSlide) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.ellipse(player.x + player.w / 2, player.y + player.h, 11, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (entry && entry.ok) {
      var img = entry.img;
      var size = spriteDrawSize(img, 30), w = size.w, h = size.h;
      var cx = player.x + player.w / 2, feetY = player.y + player.h;
      var mirror = player.facing === "right" || (player.facing === "left" && usedFallback);
      ctx.save();
      // In bed: clip her off at the room's blanket line so the covers read as
      // covering her. A standing sprite parked on a mattress otherwise looks
      // like someone standing on the bed, which is the opposite of asleep.
      if (player.inBed && currentRoom && currentRoom.bedClipY !== undefined) {
        ctx.beginPath();
        ctx.rect(0, 0, VW, currentRoom.bedClipY);
        ctx.clip();
      } else if (player.bedSlide) {
        // The blanket line drops away as she comes out from under it (and
        // closes back over her going the other way), so she emerges from the
        // covers rather than appearing whole beside the bed.
        var g2 = player.bedSlide;
        var slide = Math.min(1, (g2.t / g2.dur) / 0.75);
        ctx.beginPath();
        ctx.rect(0, 0, VW, g2.clipFrom + (g2.clipTo - g2.clipFrom) * slide);
        ctx.clip();
      }
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
    var entities = roomNpcs(currentRoom).map(function (n) { return { y: n.y, draw: function () { drawNpc(n); } }; });
    (currentRoom.props || []).forEach(function (p) {
      entities.push({ y: p.y, draw: function () { drawProp(p); } });
    });
    entities.push({ y: player.y + player.h, draw: drawPlayer });
    entities.sort(function (a, b) { return a.y - b.y; });
    entities.forEach(function (e) { e.draw(); });
  }

  // Whether the ☰ shows is derived from state, every frame, rather than
  // toggled at each place a duel or a cutscene starts and stops. It used to be
  // toggled, and every new way for one of those to end was another way to
  // leave the button hidden with no menu reachable — which is exactly what
  // removing the forfeit button would have done, since NewseyDuel.stop()
  // never ran the duel's onEnd.
  var menuBtnEl = document.getElementById("menuBtn");
  function syncMenuButton() {
    var show = running && !window.NewseyDuel.isActive() &&
               cutsceneEl.classList.contains("hidden") &&
               !(window.NewseyMenu && window.NewseyMenu.current());
    if (menuBtnEl.hidden === show) menuBtnEl.hidden = !show;
  }

  var portalPhase = 0;   // free-running, so the portal keeps turning while paused

  function loop(t) {
    if (lastTime === null) lastTime = t;
    var dt = Math.min(0.05, (t - lastTime) / 1000);
    lastTime = t;
    portalPhase += dt;
    update(dt);
    render();
    syncMenuButton();
    requestAnimationFrame(loop);
  }

  // ---------- shell API ----------
  // menu.js owns the title screen, the file select and the pause menu; it
  // drives the world through these. Nothing below auto-starts — the game only
  // begins once a file has actually been chosen.
  function clearTransientState() {
    if (window.NewseyDuel.isActive()) window.NewseyDuel.stop();
    clearFade();
    player.inBed = false;
    player.bedSlide = null;
    bedPush = 0;
    closeRuneDoor();
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
    clearFade();
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
      // The intro fades to black on its last slide and hands over behind it:
      // you come up out of the black already in your own bed, upstairs, with
      // someone knocking at the front door.
      startCutscene(STORY.INTRO_CUTSCENE, function () {
        save.introSeen = true;
        enterRoom("home_bedroom");
        putToBed();
        persist();
        fadeFromBlack(function () { showNarration(STORY.WAKE_LINES); });
      }, true);
      currentRoom = ROOMS[save.room || "home_bedroom"];
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
    // Whether the ☰ button should be shown at all. Nothing outside this file
    // sets it any more — syncMenuButton() derives it every frame — but the
    // menu still asks, to decide whether Escape can open a pause menu.
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
    isWalking: function () { return isWalking; },
    walkPhase: function () { return walkPhase; },
    running: function () { return running; },
    slot: function () { return activeSlot; },
    save: function () { return save; },
    room: function () { return currentRoom && currentRoom.label; },
    npcIds: function () { return roomNpcs(currentRoom).map(function (n) { return n.id; }); },
    npcs: function () { return roomNpcs(currentRoom).map(function (n) { return { id: n.id, x: n.x, y: n.y }; }); },
    talking: function () { return talking ? { npcId: talking.npc.id, lineIndex: talking.lineIndex } : null; },
    enterRoom: enterRoom,
    putToBed: putToBed,
    startDuel: startDuel,
    duel: function () { return window.NewseyDuel.debug(); }
  };
})();
