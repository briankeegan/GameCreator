// Dog Punk — Level 1: Scrapyard Alley
//
// A single-screen top-down action room in the spirit of Zelda: A Link to
// the Past's opening area — walk out, clear the room's enemies, the gate
// at the top opens, walk through it to clear the level.
//
// Art: hero.png / enemy-rat.png are generated pixel-art sprites that ship
// alongside this file (same-origin — never fetched cross-origin, and never
// sampled with getImageData/toDataURL, only ever drawImage'd). If either
// fails to load for any reason the game still renders and plays using the
// hand-drawn canvas fallbacks below, per-frame — nothing blocks on load.
const GAME_ID = "dog-punk";
const TILE = 32;
const COLS = 16;
const ROWS = 12;

// '2' wall/fence, '.' walkable grass, '3' junk-pile obstacle, 'G' gate
// (walkable once cleared, otherwise blocks), 'P' player spawn (walkable).
const MAP = [
  "2222222GG222222",
  "2..............2",
  "2..333.....333.2",
  "2..............2",
  "2....22....22..2",
  "2..............2",
  "2..3......3....2",
  "2..............2",
  "2....2222......2",
  "2..............2",
  "2......P.......2",
  "2222222222222222",
];

const SOLID = new Set(["2", "3"]);

const ENEMY_SPAWNS = [
  { c: 4, r: 1 },
  { c: 12, r: 3 },
  { c: 10, r: 8 },
];

// ---- sprites (same-origin PNGs shipped with this game) ----
const heroImg = new Image();
let heroReady = false;
heroImg.onload = () => { heroReady = true; };
heroImg.src = "hero.png";

const ratImg = new Image();
let ratReady = false;
ratImg.onload = () => { ratReady = true; };
ratImg.src = "enemy-rat.png";

// ---- DOM ----
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const heartsEl = document.getElementById("hearts");
const enemyCountEl = document.getElementById("enemyCount");
const winOverlay = document.getElementById("winOverlay");
const winTimeEl = document.getElementById("winTime");
const loseOverlay = document.getElementById("loseOverlay");
const winRetryBtn = document.getElementById("winRetryBtn");
const loseRetryBtn = document.getElementById("loseRetryBtn");
const dpad = document.getElementById("dpad");
const attackBtn = document.getElementById("attackBtn");

// ---- input ----
const keys = new Set();
const KEY_DIRS = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};
let touchDirs = new Set();
let attackQueued = false;

window.addEventListener("keydown", (e) => {
  if (KEY_DIRS[e.code]) { keys.add(KEY_DIRS[e.code]); e.preventDefault(); }
  if (e.code === "Space" || e.code === "KeyZ" || e.code === "KeyJ") {
    attackQueued = true;
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (KEY_DIRS[e.code]) keys.delete(KEY_DIRS[e.code]);
});

function bindHold(el, onDown, onUp) {
  if (!el) return;
  const down = (e) => { e.preventDefault(); onDown(); };
  const up = (e) => { e.preventDefault(); onUp(); };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerleave", up);
}

if (dpad) {
  dpad.querySelectorAll("[data-dir]").forEach((btn) => {
    const dir = btn.dataset.dir;
    bindHold(btn, () => touchDirs.add(dir), () => touchDirs.delete(dir));
  });
}
bindHold(attackBtn, () => { attackQueued = true; }, () => {});

// ---- game state ----
function freshState() {
  let spawn = { x: 7 * TILE + TILE / 2, y: 10 * TILE + TILE / 2 };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === "P") spawn = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
    }
  }
  return {
    player: {
      x: spawn.x, y: spawn.y, w: 22, h: 22,
      speed: 130, facing: "down",
      hp: 3, maxHp: 3,
      invulnUntil: 0,
      attackUntil: 0, attackCooldownUntil: 0,
      kbx: 0, kby: 0,
    },
    enemies: ENEMY_SPAWNS.map((s) => ({
      x: s.c * TILE + TILE / 2, y: s.r * TILE + TILE / 2,
      w: 22, h: 20, speed: 55,
      hp: 2, alive: true, facing: "down",
      wanderT: Math.random() * 2, wanderDx: 0, wanderDy: 0,
      hitFlash: 0,
    })),
    startTime: performance.now(),
    elapsed: 0,
    won: false,
    lost: false,
  };
}

let state = freshState();

// ---- collision ----
function tileAt(px, py) {
  const c = Math.floor(px / TILE);
  const r = Math.floor(py / TILE);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return "2";
  return MAP[r][c];
}

function isSolidFor(entity, px, py, gateOpen) {
  const half = entity.w / 2;
  const top = py - entity.h / 2;
  const bottom = py + entity.h / 2 - 1;
  const left = px - half;
  const right = px + half - 1;
  const corners = [[left, top], [right, top], [left, bottom], [right, bottom]];
  for (const [cx, cy] of corners) {
    const t = tileAt(cx, cy);
    if (t === "G") { if (!gateOpen) return true; continue; }
    if (SOLID.has(t)) return true;
  }
  return false;
}

function moveEntity(entity, dx, dy, gateOpen) {
  if (dx !== 0) {
    const nx = entity.x + dx;
    if (!isSolidFor(entity, nx, entity.y, gateOpen)) entity.x = nx;
  }
  if (dy !== 0) {
    const ny = entity.y + dy;
    if (!isSolidFor(entity, entity.x, ny, gateOpen)) entity.y = ny;
  }
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (ah + bh) / 2;
}

// ---- update ----
function update(dt, now) {
  if (state.won || state.lost) return;
  const p = state.player;
  const gateOpen = state.enemies.every((e) => !e.alive);

  // movement input
  let dx = 0, dy = 0;
  const active = new Set([...keys, ...touchDirs]);
  if (active.has("up")) dy -= 1;
  if (active.has("down")) dy += 1;
  if (active.has("left")) dx -= 1;
  if (active.has("right")) dx += 1;
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    dx = (dx / len);
    dy = (dy / len);
    if (Math.abs(dx) > Math.abs(dy)) p.facing = dx > 0 ? "right" : "left";
    else if (dy !== 0) p.facing = dy > 0 ? "down" : "up";
  }

  // knockback overrides voluntary movement, decaying over time
  if (Math.abs(p.kbx) > 1 || Math.abs(p.kby) > 1) {
    moveEntity(p, p.kbx * dt, p.kby * dt, gateOpen);
    p.kbx *= 0.86;
    p.kby *= 0.86;
  } else {
    moveEntity(p, dx * p.speed * dt, dy * p.speed * dt, gateOpen);
  }

  // attack
  if (attackQueued) {
    attackQueued = false;
    if (now >= p.attackCooldownUntil) {
      p.attackUntil = now + 220;
      p.attackCooldownUntil = now + 380;
    }
  }
  const attacking = now < p.attackUntil;
  if (attacking) {
    const reach = 20;
    let hx = p.x, hy = p.y;
    if (p.facing === "up") hy -= reach;
    if (p.facing === "down") hy += reach;
    if (p.facing === "left") hx -= reach;
    if (p.facing === "right") hx += reach;
    for (const en of state.enemies) {
      if (!en.alive || en.hitFlash > 0) continue;
      if (rectsOverlap(hx, hy, 26, 26, en.x, en.y, en.w, en.h)) {
        en.hp -= 1;
        en.hitFlash = 0.25;
        const kdx = en.x - p.x, kdy = en.y - p.y;
        const klen = Math.hypot(kdx, kdy) || 1;
        en.kbx = (kdx / klen) * 90;
        en.kby = (kdy / klen) * 90;
        if (en.hp <= 0) en.alive = false;
      }
    }
  }

  // enemies
  for (const en of state.enemies) {
    if (!en.alive) continue;
    if (en.hitFlash > 0) en.hitFlash -= dt;

    if (en.kbx || en.kby) {
      moveEntity(en, en.kbx * dt, en.kby * dt, gateOpen);
      en.kbx *= 0.85; en.kby *= 0.85;
      if (Math.abs(en.kbx) < 1) en.kbx = 0;
      if (Math.abs(en.kby) < 1) en.kby = 0;
    } else {
      const distToPlayer = Math.hypot(p.x - en.x, p.y - en.y);
      if (distToPlayer < 100) {
        const ex = (p.x - en.x) / (distToPlayer || 1);
        const ey = (p.y - en.y) / (distToPlayer || 1);
        moveEntity(en, ex * en.speed * dt, ey * en.speed * dt, gateOpen);
        en.facing = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? "right" : "left") : (ey > 0 ? "down" : "up");
      } else {
        en.wanderT -= dt;
        if (en.wanderT <= 0) {
          en.wanderT = 1 + Math.random() * 1.5;
          const ang = Math.random() * Math.PI * 2;
          en.wanderDx = Math.cos(ang) * 0.5;
          en.wanderDy = Math.sin(ang) * 0.5;
        }
        moveEntity(en, en.wanderDx * en.speed * dt, en.wanderDy * en.speed * dt, gateOpen);
      }

      // contact damage
      if (now >= p.invulnUntil && rectsOverlap(p.x, p.y, p.w, p.h, en.x, en.y, en.w, en.h)) {
        p.hp -= 1;
        p.invulnUntil = now + 900;
        const kdx = p.x - en.x, kdy = p.y - en.y;
        const klen = Math.hypot(kdx, kdy) || 1;
        p.kbx = (kdx / klen) * 160;
        p.kby = (kdy / klen) * 160;
        if (p.hp <= 0) {
          state.lost = true;
          loseOverlay.hidden = false;
        }
      }
    }
  }

  // win check: standing on the gate tile once every enemy is down
  if (gateOpen) {
    const t = tileAt(p.x, p.y);
    if (t === "G") {
      state.won = true;
      state.elapsed = (now - state.startTime) / 1000;
      const best = GCStorage.get(GAME_ID, "level1BestSeconds", null);
      if (best === null || state.elapsed < best) GCStorage.set(GAME_ID, "level1BestSeconds", state.elapsed);
      winTimeEl.textContent = `Cleared in ${state.elapsed.toFixed(1)}s` +
        (best !== null ? ` (best: ${Math.min(best, state.elapsed).toFixed(1)}s)` : "");
      winOverlay.hidden = false;
    }
  }
}

// ---- drawing ----
function drawTile(c, r, ch, gateOpen) {
  const x = c * TILE, y = r * TILE;
  if (ch === "2") {
    ctx.fillStyle = "#5c4a34";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#3d3122";
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 4 + i * 9, y + 4, 5, TILE - 8);
    return;
  }
  if (ch === "G") {
    ctx.fillStyle = gateOpen ? "#2f5d34" : "#6b2f2f";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = "#1c1c1c";
    ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
    return;
  }
  // grass base for everything else (drawn first, obstacles layered after)
  ctx.fillStyle = (c + r) % 2 === 0 ? "#3a4a2c" : "#354427";
  ctx.fillRect(x, y, TILE, TILE);
  if (ch === "3") {
    ctx.fillStyle = "#7a6a52";
    ctx.fillRect(x + 4, y + 8, TILE - 8, TILE - 12);
    ctx.fillStyle = "#5a4d3a";
    ctx.fillRect(x + 4, y + 8, TILE - 8, 4);
    ctx.fillStyle = "#2a2418";
    ctx.strokeRect(x + 4, y + 8, TILE - 8, TILE - 12);
  } else {
    // sprinkle a few blades of grass texture
    if ((c * 7 + r * 13) % 5 === 0) {
      ctx.fillStyle = "#4a5c38";
      ctx.fillRect(x + 6, y + 20, 2, 8);
      ctx.fillRect(x + 20, y + 14, 2, 8);
    }
  }
}

function drawHeroFallback(x, y, facing, hurt) {
  ctx.save();
  ctx.translate(x, y);
  if (facing === "left") ctx.scale(-1, 1);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 14, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hurt ? "#e78888" : "#1b1b1b"; // jacket
  ctx.fillRect(-10, -4, 20, 16);
  ctx.fillStyle = "#c98a4b"; // fur head
  ctx.fillRect(-8, -18, 16, 16);
  ctx.fillStyle = "#ff3fa0"; // mohawk
  ctx.fillRect(-2, -26, 4, 10);
  ctx.fillStyle = "#000";
  ctx.fillRect(2, -12, 3, 3); // eye
  ctx.restore();
}

function drawRatFallback(x, y, facing, hitFlash) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hitFlash > 0 ? "#ffffff" : "#8a7a5c";
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5c4c34";
  ctx.fillRect(-4, -12, 4, 4);
  ctx.fillRect(2, -12, 4, 4);
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(-6, -4, 2, 2);
  ctx.fillRect(4, -4, 2, 2);
  ctx.restore();
}

function drawSprite(img, ready, x, y, facing, size, fallback) {
  if (ready) {
    ctx.save();
    ctx.translate(x, y);
    if (facing === "left") ctx.scale(-1, 1);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    fallback();
  }
}

function render(now) {
  const gateOpen = state.enemies.every((e) => !e.alive);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) drawTile(c, r, MAP[r][c], gateOpen);
  }

  for (const en of state.enemies) {
    if (!en.alive) continue;
    drawSprite(ratImg, ratReady, en.x, en.y - 6, en.facing, 34,
      () => drawRatFallback(en.x, en.y - 6, en.facing, en.hitFlash));
  }

  const p = state.player;
  const blinking = now < p.invulnUntil && Math.floor(now / 100) % 2 === 0;
  if (!blinking) {
    drawSprite(heroImg, heroReady, p.x, p.y - 10, p.facing, 44,
      () => drawHeroFallback(p.x, p.y - 10, p.facing, now < p.invulnUntil));
  }

  if (now < p.attackUntil) {
    ctx.save();
    ctx.strokeStyle = "#f7e26b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    const reach = 24;
    let hx = p.x, hy = p.y - 6;
    if (p.facing === "up") hy -= reach;
    if (p.facing === "down") hy += reach;
    if (p.facing === "left") hx -= reach;
    if (p.facing === "right") hx += reach;
    ctx.arc(hx, hy, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---- HUD ----
function heartSVG(full) {
  const fill = full ? "#e0405a" : "#3a2a2a";
  return `<svg viewBox="0 0 16 16" class="heart"><path fill="${fill}" d="M8 14 1 7.5A4 4 0 0 1 7 2l1 1 1-1a4 4 0 0 1 6 5.5z"/></svg>`;
}
function renderHud() {
  const p = state.player;
  heartsEl.innerHTML = Array.from({ length: p.maxHp }, (_, i) => heartSVG(i < p.hp)).join("");
  const left = state.enemies.filter((e) => e.alive).length;
  enemyCountEl.textContent = left > 0 ? `${left} left` : "Gate open!";
}

// ---- loop ----
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  update(dt, now);
  render(now);
  renderHud();
  requestAnimationFrame(loop);
}

function resetLevel() {
  state = freshState();
  winOverlay.hidden = true;
  loseOverlay.hidden = true;
  keys.clear();
  touchDirs.clear();
}

winRetryBtn.addEventListener("click", resetLevel);
loseRetryBtn.addEventListener("click", resetLevel);

requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });
