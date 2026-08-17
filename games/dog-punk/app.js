// Dog Punk — Level 1: Scrapyard Alley
//
// A single-screen top-down action room in the spirit of Zelda: A Link to
// the Past's opening area — walk out, clear the room's enemies, the gate
// at the top opens, walk through it to clear the level.
//
// Art: hero_down/hero_up/hero_side.png (+ _walk2 variants) and rat_side.png
// (+ _walk2) are generated pixel-art sprites that ship alongside this file
// (same-origin — never fetched cross-origin, and never sampled with
// getImageData/toDataURL, only ever drawImage'd). Each direction has TWO
// real drawn frames — a standing/base pose and an opposite-leg mid-stride
// pose — and the game flips between them while moving for an actual pixel
// walk-cycle animation (not just squash/bob on one static image). _side
// art is mirrored per-frame for the opposite horizontal direction, so 3
// hero base + 3 hero walk2 + 1 rat base + 1 rat walk2 = 8 images cover all
// 4 facing directions for both. If any image fails to load for any reason
// the game still renders and plays using the hand-drawn canvas fallbacks
// below (which get their own procedural leg-swap animation), per-frame —
// nothing blocks on load.
//
// Attacks additionally swap to a DEDICATED drawn attack-pose frame for the
// whole attack/lunge window — hero_atk_down/up/side.png (blade swept fully
// out mid-slash) and rat_atk_side.png (jaws open, claws out mid-pounce) —
// instead of just reusing the idle/walk pose with a procedural lunge+
// stretch. The lunge/stretch/slash-arc motion still layers on top of that
// pose for follow-through; the pose itself is what makes it read as an
// actual weapon swing / bite rather than a body-check. Canvas fallbacks
// (drawHeroFallback/drawRatFallback) draw their own matching weapon-swing
// / bared-teeth version so this still works with the PNGs missing.
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
// Hero: 3 real frames (down/up/side) cover all 4 facing directions —
// "side" is mirrored horizontally for left vs right. Rat: 1 real frame
// (side), mirrored the same way; rats don't get distinct up/down art but
// still turn to face their movement/attack direction and animate.
function loadSprite(src) {
  const img = new Image();
  const state = { img, ready: false };
  img.onload = () => { state.ready = true; };
  img.src = src;
  return state;
}
const heroDown = loadSprite("hero_down.png");
const heroUp = loadSprite("hero_up.png");
const heroSide = loadSprite("hero_side.png");
const ratSide = loadSprite("rat_side.png");
// Second walk-cycle frame per direction: same pose/outfit, opposite leg
// forward — alternated with the base frame above while actually moving.
const heroDownWalk2 = loadSprite("hero_down_walk2.png");
const heroUpWalk2 = loadSprite("hero_up_walk2.png");
const heroSideWalk2 = loadSprite("hero_side_walk2.png");
const ratSideWalk2 = loadSprite("rat_side_walk2.png");
// Dedicated attack-pose frames — a real drawn mid-swing/mid-pounce pose per
// facing, not just the idle/walk frame stretched — swapped in for the
// entire attack window so the weapon/claws visibly slash instead of the
// character just lunging while holding the same standing pose.
const heroAtkDown = loadSprite("hero_atk_down.png");
const heroAtkUp = loadSprite("hero_atk_up.png");
const heroAtkSide = loadSprite("hero_atk_side.png");
const ratAtkSide = loadSprite("rat_atk_side.png");

// facing (+ walk-cycle step) -> { sprite, mirror }
// hero_side.png / rat_side.png are both drawn facing LEFT natively, so
// "left" is the unmirrored case and "right" is the one that needs the flip
// — get this backwards and the sprite visibly walks/lunges the wrong way
// whenever it should be facing right (moonwalking bug, fixed 2026-08-17).
// NOTE: this mirror logic was actually correct — the real bug (found in a
// later pass, same day) was that hero_side_walk2.png itself had been drawn
// facing RIGHT while hero_side.png faced LEFT, so every other walk-cycle
// frame flipped backwards regardless of the code. Regenerated hero_side_
// walk2.png facing LEFT to match — always keep every "_side"/"_side_walk2"/
// "_atk_side" art asset facing the same native direction, or this class of
// bug recurs.
function heroSpriteFor(facing, step) {
  if (facing === "up") return { s: step ? heroUpWalk2 : heroUp, mirror: false };
  if (facing === "left") return { s: step ? heroSideWalk2 : heroSide, mirror: false };
  if (facing === "right") return { s: step ? heroSideWalk2 : heroSide, mirror: true };
  return { s: step ? heroDownWalk2 : heroDown, mirror: false };
}
function ratSpriteFor(facing, step) {
  return { s: step ? ratSideWalk2 : ratSide, mirror: facing === "right" };
}
// Attack-pose lookups (ignore the walk-cycle `step` arg — same signature as
// the walk lookups above so drawAnimatedSprite can call either one).
function heroAttackSpriteFor(facing) {
  if (facing === "up") return { s: heroAtkUp, mirror: false };
  if (facing === "left") return { s: heroAtkSide, mirror: false };
  if (facing === "right") return { s: heroAtkSide, mirror: true };
  return { s: heroAtkDown, mirror: false };
}
function ratAttackSpriteFor(facing) {
  return { s: ratAtkSide, mirror: facing === "right" };
}

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
      attackUntil: 0, attackCooldownUntil: 0, attackStartAt: 0,
      kbx: 0, kby: 0,
      animPhase: 0, moving: false,
    },
    enemies: ENEMY_SPAWNS.map((s) => ({
      x: s.c * TILE + TILE / 2, y: s.r * TILE + TILE / 2,
      w: 22, h: 20, speed: 55,
      hp: 2, alive: true, facing: "down",
      wanderT: Math.random() * 2, wanderDx: 0, wanderDy: 0,
      hitFlash: 0,
      animPhase: 0, moving: false,
      // attack state machine: idle (seek/wander) -> windup (telegraph,
      // holds still) -> lunge (fast dash, deals contact damage once) -> back
      // to idle with a cooldown. Only the lunge can hurt the player.
      atkState: "idle", atkTimer: 0, atkDuration: 0,
      attackCooldownUntil: 0, lungeDx: 0, lungeDy: 0, hasHitThisLunge: false,
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

  // walk-cycle animation: advance a phase clock while actually moving under
  // the player's own steam (not knockback, not mid-attack), ease back to a
  // resting pose otherwise. Driving this off distance covered (not just
  // wall-clock time) keeps the step cadence matched to actual speed.
  p.moving = (dx !== 0 || dy !== 0) && now >= p.attackUntil;
  if (p.moving) p.animPhase += dt * 9;
  else p.animPhase *= 0.9;

  // attack
  if (attackQueued) {
    attackQueued = false;
    if (now >= p.attackCooldownUntil) {
      p.attackStartAt = now;
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
  const ATTACK_RANGE = 34;
  const DETECT_RANGE = 100;
  for (const en of state.enemies) {
    if (!en.alive) continue;
    if (en.hitFlash > 0) en.hitFlash -= dt;
    en.moving = false;

    if (en.kbx || en.kby) {
      moveEntity(en, en.kbx * dt, en.kby * dt, gateOpen);
      en.kbx *= 0.85; en.kby *= 0.85;
      if (Math.abs(en.kbx) < 1) en.kbx = 0;
      if (Math.abs(en.kby) < 1) en.kby = 0;
    } else if (en.atkState === "windup") {
      // telegraph: hold still, face the player, coil up (visual only).
      en.atkTimer -= dt;
      const dxp = p.x - en.x, dyp = p.y - en.y;
      en.facing = Math.abs(dxp) > Math.abs(dyp) ? (dxp > 0 ? "right" : "left") : (dyp > 0 ? "down" : "up");
      if (en.atkTimer <= 0) {
        en.atkState = "lunge";
        en.atkTimer = en.atkDuration = 0.16;
        const len = Math.hypot(dxp, dyp) || 1;
        en.lungeDx = dxp / len;
        en.lungeDy = dyp / len;
        en.hasHitThisLunge = false;
      }
    } else if (en.atkState === "lunge") {
      // the actual attack: a fast committed dash — this is the only window
      // that can damage the player, so a hit always has a visible "wind up
      // then pounce" tell before it, not just silent contact.
      en.atkTimer -= dt;
      en.moving = true;
      moveEntity(en, en.lungeDx * en.speed * 3.4 * dt, en.lungeDy * en.speed * 3.4 * dt, gateOpen);
      if (!en.hasHitThisLunge && now >= p.invulnUntil &&
          rectsOverlap(p.x, p.y, p.w, p.h, en.x, en.y, en.w, en.h)) {
        en.hasHitThisLunge = true;
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
      if (en.atkTimer <= 0) {
        en.atkState = "idle";
        en.attackCooldownUntil = now + 900;
      }
    } else {
      const distToPlayer = Math.hypot(p.x - en.x, p.y - en.y);
      if (distToPlayer < ATTACK_RANGE && now >= en.attackCooldownUntil) {
        en.atkState = "windup";
        en.atkTimer = en.atkDuration = 0.28;
      } else if (distToPlayer < DETECT_RANGE) {
        en.moving = true;
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
        en.moving = true;
        moveEntity(en, en.wanderDx * en.speed * dt, en.wanderDy * en.speed * dt, gateOpen);
        en.facing = Math.abs(en.wanderDx) > Math.abs(en.wanderDy) ? (en.wanderDx > 0 ? "right" : "left") : (en.wanderDy > 0 ? "down" : "up");
      }
    }

    if (en.moving) en.animPhase += dt * 10;
    else en.animPhase *= 0.9;
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

// Facing -> unit vector, used for lunge offsets and slash-arc placement.
const FACING_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const FACING_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

function drawHeroFallback(x, y, facing, hurt, squashX, squashY, step, attacking, attackT) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale((facing === "left" ? -1 : 1) * squashX, squashY);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 14, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs: swap which one is forward/lifted per walk-cycle step, so the
  // canvas fallback has a real leg-swap animation too, not just squash.
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(step ? -8 : 2, 10, 6, 6);
  ctx.fillRect(step ? 2 : -8, 8, 6, 8);
  ctx.fillStyle = hurt ? "#e78888" : "#1b1b1b"; // jacket
  ctx.fillRect(-10, -4, 20, 16);
  ctx.fillStyle = "#c98a4b"; // fur head
  ctx.fillRect(-8, -18, 16, 16);
  // a hint of directionality even in the fallback: back of the head (up)
  // shows no face, front (down/side) shows an eye.
  if (facing !== "up") {
    ctx.fillStyle = "#ff3fa0"; // mohawk
    ctx.fillRect(-2, -26, 4, 10);
    ctx.fillStyle = "#000";
    ctx.fillRect(2, -12, 3, 3); // eye
  } else {
    ctx.fillStyle = "#ff3fa0";
    ctx.fillRect(-2, -27, 4, 11);
  }
  // weapon: a knife, swept through a real swing arc while attacking so the
  // canvas fallback slashes too (not just the sprite-image path) — held
  // low and still the rest of the time.
  const swingAngle = attacking ? -1.3 + Math.min(1, attackT) * 2.0 : -0.25;
  ctx.save();
  ctx.translate(9, -1);
  ctx.rotate(swingAngle);
  ctx.fillStyle = "#5a4632"; // handle
  ctx.fillRect(-3, -2, 5, 4);
  ctx.fillStyle = "#d7dde0"; // blade
  ctx.fillRect(2, -2, 15, 4);
  ctx.restore();
  ctx.restore();
}

function drawRatFallback(x, y, facing, hitFlash, squashX, squashY, step, attacking) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale((facing === "left" ? -1 : 1) * squashX, squashY);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs: swap forward pair per walk-cycle step.
  ctx.fillStyle = "#4a3d28";
  ctx.fillRect(step ? -8 : -4, 6, 4, 5);
  ctx.fillRect(step ? 4 : 8, 6, 4, 5);
  ctx.fillStyle = hitFlash > 0 ? "#ffffff" : "#8a7a5c";
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5c4c34";
  ctx.fillRect(-4, -12, 4, 4);
  ctx.fillRect(2, -12, 4, 4);
  if (attacking) {
    // pounce: jaws wide open baring teeth + a claw stab out front, instead
    // of the calm resting eyes, so the canvas fallback also shows a real
    // attack tell, not just a stretched idle body.
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(-9, -3, 7, 6);
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(-9, -3, 2, 2);
    ctx.fillRect(-9, 1, 2, 2);
    ctx.fillStyle = "#5c4c34";
    ctx.fillRect(-14, -2, 6, 3); // extended claw
  } else {
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(-6, -4, 2, 2);
    ctx.fillRect(4, -4, 2, 2);
  }
  ctx.restore();
}

// Draws a directional sprite with a real 2-frame pixel walk cycle (swaps to
// the opposite-leg drawn frame on alternating steps while moving) plus a
// bob/squash and an optional extra offset (used for the attack lunge).
// `spriteFor(facing, step)` returns `{ s: {img, ready}, mirror }`.
function drawAnimatedSprite(spriteFor, facing, x, y, size, anim, fallback) {
  // ~2 steps per phase cycle; phase advances with distance moved (see
  // update()), so cadence scales with actual movement speed.
  const step = anim.moving && Math.sin(anim.phase) > 0;
  const { s, mirror } = spriteFor(facing, step);
  const stepSquash = anim.moving ? Math.abs(Math.sin(anim.phase * 2)) * 0.05 : 0;
  const bobY = anim.moving ? -Math.abs(Math.sin(anim.phase)) * 3 : 0;
  const scaleX = (anim.scaleX ?? 1) + stepSquash;
  const scaleY = (anim.scaleY ?? 1) - stepSquash;
  const dx = (anim.offsetX || 0);
  const dy = (anim.offsetY || 0) + bobY;
  if (s.ready) {
    ctx.save();
    ctx.translate(x + dx, y + dy);
    ctx.scale((mirror ? -1 : 1) * scaleX, scaleY);
    ctx.drawImage(s.img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    fallback(x + dx, y + dy, facing, scaleX, scaleY, step);
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
    let scaleX = 1, scaleY = 1;
    const lunging = en.atkState === "lunge";
    if (en.atkState === "windup") {
      // coil up before pouncing.
      const t = 1 - en.atkTimer / (en.atkDuration || 1);
      scaleX = 1 + t * 0.18;
      scaleY = 1 - t * 0.22;
    } else if (lunging) {
      // stretched out mid-pounce, direction-of-travel dependent.
      const horiz = Math.abs(en.lungeDx) >= Math.abs(en.lungeDy);
      scaleX = horiz ? 1.3 : 0.9;
      scaleY = horiz ? 0.85 : 1.3;
    }
    // the pounce swaps to a real drawn attack pose (jaws open, claws out)
    // instead of just stretching the idle art, so the lunge reads as an
    // actual attack animation rather than a squashed walk frame.
    drawAnimatedSprite(lunging ? ratAttackSpriteFor : ratSpriteFor, en.facing, en.x, en.y - 6, 34,
      { moving: en.moving && !lunging, phase: en.animPhase, scaleX, scaleY },
      (x, y, facing, sx, sy, step) => drawRatFallback(x, y, facing, en.hitFlash, sx, sy, step, lunging));
  }

  const p = state.player;
  const blinking = now < p.invulnUntil && Math.floor(now / 100) % 2 === 0;
  const attacking = now < p.attackUntil;
  const attackT = attacking ? 1 - (p.attackUntil - now) / 220 : 0; // 0..1 through the swing
  let offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1;
  if (attacking) {
    const [fx, fy] = FACING_VEC[p.facing];
    const lunge = Math.sin(Math.min(1, attackT) * Math.PI) * 6; // out and back
    offsetX = fx * lunge;
    offsetY = fy * lunge;
    const stretch = Math.sin(Math.min(1, attackT) * Math.PI) * 0.14;
    scaleX = 1 + stretch * Math.abs(fx) + stretch * 0.4 * Math.abs(fy);
    scaleY = 1 + stretch * Math.abs(fy) + stretch * 0.4 * Math.abs(fx);
  }
  if (!blinking) {
    // during the attack window, swap to a real drawn mid-swing pose (blade
    // swept out through the slash) instead of just lunging/stretching the
    // idle-standing art — that stretch alone read as a body-check, not a
    // weapon swing.
    drawAnimatedSprite(attacking ? heroAttackSpriteFor : heroSpriteFor, p.facing, p.x, p.y - 10, 44,
      { moving: p.moving, phase: p.animPhase, offsetX, offsetY, scaleX, scaleY },
      (x, y, facing, sx, sy, step) => drawHeroFallback(x, y, facing, now < p.invulnUntil, sx, sy, step, attacking, attackT));
  }

  // attack: a quick slash arc sweeping across the facing direction, not
  // just a static ring — sells the swing as an action, not a hitbox debug
  // circle.
  if (attacking) {
    const baseAngle = FACING_ANGLE[p.facing];
    const sweep = 2.0; // radians of total swing
    const startA = baseAngle - sweep / 2;
    const progressA = startA + sweep * Math.min(1, attackT);
    const reach = 26;
    const hx = p.x + Math.cos(baseAngle) * reach * 0.3;
    const hy = p.y - 6 + Math.sin(baseAngle) * reach * 0.3;
    ctx.save();
    ctx.strokeStyle = "#f4f0e6";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(hx, hy, reach, startA, progressA);
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
