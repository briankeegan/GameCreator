// Puzzle Attack / Newsey — game engine.
// Two modes: CUTSCENE (tap-through intro) then WALK-AROUND (classic top-down
// room; move with arrows/touch d-pad, walk up to an NPC, press interact to
// talk). Duels are a "coming soon" placeholder for now (the real Panel Attack
// board lands later). Everything has a canvas-drawn fallback so the game is
// fully playable with zero generated art.
(function () {
  var gameId = "the-game";
  var STORY = window.NEWSEY_STORY;
  var CHARACTERS = STORY.CHARACTERS;
  var CUTSCENE = STORY.CUTSCENE;
  var ROOMS = STORY.ROOMS;

  // ---------- persistence ----------
  var save = window.GCStorage.get(gameId, "save", { introSeen: false, room: "bedroom" });
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
  function bgUrl(id) { return id ? "url('art/bg-" + id + ".png'), " : ""; }

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

  function renderCutsceneLine() {
    var s = CUTSCENE[cIndex];
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
    if (s.who) {
      var c = CHARACTERS[s.who] || { name: s.who, color: "#fff" };
      speakerEl.textContent = c.name;
      speakerEl.style.color = c.color;
    } else {
      speakerEl.textContent = "";
    }
    lineEl.textContent = s.text;
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
  function currentSpeakerId() { return (CUTSCENE[cIndex] && CUTSCENE[cIndex].who) || ""; }

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
    if (cIndex >= CUTSCENE.length) { endCutscene(); return; }
    renderCutsceneLine();
  }
  function endCutscene() {
    save.introSeen = true;
    persist();
    cutsceneEl.classList.add("hidden");
    if (isTouch) document.getElementById("touchControls").hidden = false;
    enterRoom(save.room || "bedroom");
  }
  function startCutscene() {
    cIndex = 0; lastBg = ""; lastArt = undefined;
    portraitImg.hidden = true;
    portraitFallback.hidden = true;
    cutsceneEl.classList.remove("hidden");
    if (isTouch) document.getElementById("touchControls").hidden = true;
    renderCutsceneLine();
  }
  cutsceneEl.addEventListener("click", advanceCutscene);
  cutsceneEl.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") advanceCutscene(); });
  document.getElementById("restartBtn").addEventListener("click", startCutscene);

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
  var duelPlaceholder = document.getElementById("duelPlaceholder");

  var currentRoom = null;
  var player = { x: 60, y: 150, w: 14, h: 18, speed: 70, facing: "down" };
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
  if (isTouch) document.getElementById("touchControls").hidden = false;
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
    talking.lineIndex++;
    if (talking.lineIndex >= npc.lines.length) {
      npcLineCounters[npc.id] = npc.lines.length - 1; // stay on last line for future visits
      talkBox.hidden = true;
      var wasTalking = talking;
      talking = null;
      if (wasTalking.npc.duel) openDuelPlaceholder();
      return;
    }
    npcLineCounters[npc.id] = talking.lineIndex;
    renderTalk();
  }

  function openDuelPlaceholder() { duelPlaceholder.hidden = false; }
  document.getElementById("duelContinue").addEventListener("click", function () {
    duelPlaceholder.hidden = true;
  });

  // ---- movement + collision ----
  function update(dt) {
    if (talking || !duelPlaceholder.hidden) return;
    var dx = 0, dy = 0;
    if (keys["ArrowLeft"] || keys["a"] || touchDir === "left") dx -= 1;
    if (keys["ArrowRight"] || keys["d"] || touchDir === "right") dx += 1;
    if (keys["ArrowUp"] || keys["w"] || touchDir === "up") dy -= 1;
    if (keys["ArrowDown"] || keys["s"] || touchDir === "down") dy += 1;
    if (dx || dy) {
      var len = Math.sqrt(dx * dx + dy * dy);
      dx /= len; dy /= len;
      player.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      player.x += dx * player.speed * dt;
      player.y += dy * player.speed * dt;
      player.x = Math.max(4, Math.min(VW - player.w - 4, player.x));
      player.y = Math.max(30, Math.min(VH - player.h - 8, player.y));
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
    var hues = { lounge: 20, library: 265 };
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

  function drawNpc(npc) {
    var entry = loadArt(npc.art);
    var c = CHARACTERS[npc.id] || { name: npc.id, color: "#8a5cf6" };
    if (entry && entry.ok) {
      ctx.drawImage(entry.img, npc.x - 12, npc.y - 24, 24, 32);
    } else {
      ctx.fillStyle = c.color;
      ctx.fillRect(npc.x - 8, npc.y - 22, 16, 22);
      ctx.beginPath(); ctx.arc(npc.x, npc.y - 26, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "7px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(c.name, npc.x, npc.y - 30);
    // proximity glow
    var d = Math.hypot(npc.x - (player.x + player.w / 2), npc.y - (player.y + player.h / 2));
    if (d < 26) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.arc(npc.x, npc.y - 12, 16, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawPlayer() {
    var entry = loadArt("nella_walk_" + player.facing);
    if (entry && entry.ok) {
      ctx.drawImage(entry.img, player.x - 3, player.y - 14, player.w + 6, player.h + 14);
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
    enterRoom(save.room || "bedroom");
  } else {
    startCutscene();
    currentRoom = ROOMS[save.room || "bedroom"];
    player.x = currentRoom.playerStart.x; player.y = currentRoom.playerStart.y;
  }
  requestAnimationFrame(loop);

  // Read-only debug hook for automated testing (headless smoke tests can't
  // reach into this closure otherwise). No effect on gameplay.
  window.__newseyDebug = { player: player, room: function () { return currentRoom && currentRoom.label; } };
})();
