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
        return cs.display === "none" ? sum : sum + el.getBoundingClientRect().height;
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
  var save = window.GCStorage.get(gameId, "save", { introSeen: false, room: "house", duelsWon: {} });
  if (!save.duelsWon) save.duelsWon = {}; // saves made before duels existed
  function persist() { window.GCStorage.set(gameId, "save", save); }

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
  var lastArt = undefined;
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
    if (s.art !== undefined) {
      lastArt = s.art;
      setPortrait(s.art);
    }
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
    if (isTouch) document.getElementById("touchControls").hidden = false;
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
    cIndex = 0; lastBg = ""; lastArt = undefined;
    portraitImg.hidden = true;
    portraitFallback.hidden = true;
    cutsceneEl.classList.remove("hidden");
    if (isTouch) document.getElementById("touchControls").hidden = true;
    sizeStage();
    renderCutsceneLine();
  }
  cutsceneEl.addEventListener("click", advanceCutscene);
  cutsceneEl.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") advanceCutscene(); });
  document.getElementById("restartBtn").addEventListener("click", function () {
    startCutscene(STORY.INTRO_CUTSCENE, function () { enterRoom("house"); });
  });

  // =========================================================================
  // WALK-AROUND MODE
  // =========================================================================
  var canvas = document.getElementById("scene");
  var ctx = canvas.getContext("2d");
  var VW = 320, VH = 200; // virtual room size; canvas is 2x (640x400)
  ctx.scale(2, 2);
  ctx.imageSmoothingEnabled = false;

  var roomLabelEl = document.getElementById("roomLabel");
  var interactHint = document.getElementById("interactHint");
  var talkBox = document.getElementById("talkBox");
  var talkPortrait = document.getElementById("talkPortrait");
  var talkPortraitFallback = document.getElementById("talkPortraitFallback");
  var talkSpeaker = document.getElementById("talkSpeaker");
  var talkLine = document.getElementById("talkLine");

  var currentRoom = null;
  var player = { x: 60, y: 150, w: 14, h: 18, speed: 70, facing: "down" };
  var walkPhase = 0, isWalking = false; // drives the procedural walk-bob (see drawPlayer)
  var keys = {};
  var talking = null; // { npc, lineIndex }
  var lastTime = null;
  var npcLineCounters = {}; // remembers which line to show next per NPC (repeat visits)

  function enterRoom(roomId) {
    currentRoom = ROOMS[roomId];
    save.room = roomId;
    persist();
    roomLabelEl.textContent = currentRoom.label;
    player.x = currentRoom.playerStart.x;
    player.y = currentRoom.playerStart.y;
  }

  // ---- input ----
  window.addEventListener("keydown", function (e) {
    keys[e.key] = true;
    if (talking && (e.key === "z" || e.key === "Z" || e.key === " " || e.key === "Enter")) {
      advanceTalk();
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", function (e) { keys[e.key] = false; });

  var isTouch = matchMedia("(hover: none) and (pointer: coarse)").matches;
  if (isTouch) { document.getElementById("touchControls").hidden = false; sizeStage(); }
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
          persist();
        }
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
  function update(dt) {
    if (talking || window.NewseyDuel.isActive()) return;
    var dx = 0, dy = 0;
    if (keys["ArrowLeft"] || keys["a"] || touchDir === "left") dx -= 1;
    if (keys["ArrowRight"] || keys["d"] || touchDir === "right") dx += 1;
    if (keys["ArrowUp"] || keys["w"] || touchDir === "up") dy -= 1;
    if (keys["ArrowDown"] || keys["s"] || touchDir === "down") dy += 1;
    if (dx || dy) {
      var len = Math.sqrt(dx * dx + dy * dy);
      dx /= len; dy /= len;
      player.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      // Try each axis independently so the player can slide along a wall
      // or obstacle instead of fully stopping the moment either axis hits
      // something.
      var tryX = clampToFloor(currentRoom, player.x + dx * player.speed * dt, player.y);
      if (!blockedByObstacle(currentRoom, tryX.x, player.y)) player.x = tryX.x;
      var tryY = clampToFloor(currentRoom, player.x, player.y + dy * player.speed * dt);
      if (!blockedByObstacle(currentRoom, player.x, tryY.y)) player.y = tryY.y;
      isWalking = true;
      walkPhase += dt * 9; // bob speed; unrelated to player.speed so it stays readable
    } else {
      isWalking = false;
    }
    // exits
    currentRoom.exits.forEach(function (ex) {
      if (player.x + player.w > ex.x && player.x < ex.x + ex.w &&
          player.y + player.h > ex.y && player.y < ex.y + ex.h) {
        enterRoom(ex.to);
      }
    });
    interactHint.hidden = !nearestNpc();
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

  function drawExits() {
    currentRoom.exits.forEach(function (ex) {
      ctx.fillStyle = "rgba(255,209,102,0.25)";
      ctx.fillRect(ex.x, ex.y, ex.w, ex.h);
      ctx.fillStyle = "#ffd166";
      ctx.font = "8px sans-serif";
      ctx.textAlign = ex.x < VW / 2 ? "left" : "right";
      ctx.fillText(ex.label, ex.x < VW / 2 ? ex.x + ex.w + 4 : ex.x - 4, ex.y + ex.h / 2 + 3);
    });
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
    var spriteEntry = npc.sprite ? loadArt(npc.sprite) : null;
    var hasSprite = spriteEntry && spriteEntry.ok && spriteEntry.img.naturalHeight;

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath(); ctx.ellipse(npc.x, npc.y + 3, 11, 3.4, 0, 0, Math.PI * 2); ctx.fill();

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

    // proximity glow, hugging the ground shadow so it reads as a floor ring
    var d = Math.hypot(npc.x - (player.x + player.w / 2), npc.y - (player.y + player.h / 2));
    if (d < 26) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.ellipse(npc.x, npc.y + 3, 15, 4.6, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Only one standing sprite exists ("nella_top", small top-down full
  // body, facing forward) — not a 4-direction walk-cycle set. Mirror it
  // horizontally for "left" so at least left/right read correctly;
  // up/down reuse the same forward-facing art rather than showing her
  // back (no art for that exists, and forward-facing-always is far less
  // broken-looking than stretching/guessing a rear view).
  // Real per-direction art: down/up/left are distinct sprites (extracted
  // from a generated walk-cycle sheet — see nella_walksheet.png), right
  // reuses "left" mirrored since a 2D side profile facing right is just
  // that same art flipped. Falls back to the single forward-facing
  // "nella_top" sprite (mirrored for left) if the directional art isn't
  // available, then to the plain colored blob.
  var FACING_ART = { down: "nella_down", up: "nella_up", left: "nella_left", right: "nella_left" };
  function drawPlayer() {
    var wantId = FACING_ART[player.facing] || "nella_down";
    var entry = loadArt(wantId);
    if (!(entry && entry.ok)) entry = loadArt("nella_top"); // fallback while directional art is missing
    if (entry && entry.ok) {
      var img = entry.img;
      var size = spriteDrawSize(img, 30), w = size.w, h = size.h;
      var cx = player.x + player.w / 2, feetY = player.y + player.h;
      var mirror = player.facing === "right" || (player.facing === "left" && wantId === "nella_top");
      // No real walk-cycle animation frames exist — a small vertical bob
      // while moving is a cheap, code-only stand-in that still reads as
      // "walking" instead of a sprite sliding perfectly still across the
      // floor. abs() so it bobs up-down-up-down rather than up-then-snap.
      var bob = isWalking ? Math.abs(Math.sin(walkPhase)) * 2 : 0;
      ctx.save();
      if (mirror) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, feetY - h - bob, w, h);
      } else {
        ctx.drawImage(img, cx - w / 2, feetY - h - bob, w, h);
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
    if (!currentRoom) return;
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

  // ---------- boot ----------
  if (save.introSeen) {
    cutsceneEl.classList.add("hidden");
    enterRoom(save.room || "house");
  } else {
    startCutscene(STORY.INTRO_CUTSCENE, function () {
      save.introSeen = true;
      persist();
      enterRoom("house");
    });
    currentRoom = ROOMS[save.room || "house"];
    player.x = currentRoom.playerStart.x; player.y = currentRoom.playerStart.y;
  }
  requestAnimationFrame(loop);

  // Read-only debug hook for automated testing (headless smoke tests can't
  // reach into this closure otherwise). No effect on gameplay.
  window.__newseyDebug = {
    player: player,
    room: function () { return currentRoom && currentRoom.label; },
    startDuel: startDuel,
    duel: function () { return window.NewseyDuel.debug(); }
  };
})();
