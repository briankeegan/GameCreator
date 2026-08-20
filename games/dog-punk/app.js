// Dog Punk — Level 1: Scrapyard Alley
//
// A single-screen top-down action room in the spirit of Zelda: A Link to
// the Past's opening area — walk out, clear the room's enemies, the gate
// at the top opens, walk through it to clear the level.
//
// Art: hero_sheet.png and rat_sheet.png are generated 3x3 pixel-art sprite
// sheets (idle/walk/attack x down/side/up) that ship alongside this file
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
//
// 2026-08-18 art redo: hero_down/hero_down_walk2/hero_side/hero_side_walk2
// were regenerated against a LOCKED hex palette (see art-style.json's
// "mainCharacter" field) specifically so Beverly's fur/mohawk/jacket/pants
// colors can't drift frame-to-frame the way they did before (that drift —
// not the silhouette — was the real "art is awful" complaint: idle and
// walk frames flickering between slightly different fur shades). hero_up
// and all hero_atk_*/rat_* art are untouched from the prior pass — they
// already sit close enough to the same palette that they don't clash, but
// if that ever gets flagged, redo them against the same locked palette.
// Also added: idle breathing (breathePhase, see update()/render()) so
// standing still is no longer a fully frozen frame, and a cosmetic
// scrap-burst on rat death (state.deathFx) so kills don't just vanish
// instantly — see those for details.
//
// 2026-08-18 (later pass) — root-caused the recurring "art is awful" reports
// to a fine crosshatch/graph-paper TEXTURE baked inside individual color
// blocks on a few specific frames (found by cropping+zooming the PNGs, not
// just eyeballing thumbnails): rat_atk_side.png and rat_side_walk2.png were
// the worst (a grid visible across the whole sprite), hero_down_walk2.png/
// hero_up_walk2.png milder. Regenerated those four against a strengthened
// art-style.json ("no fine crosshatch/grain inside a color block" spelled
// out as its own explicit rule, plus a new locked `enemy` palette so the
// rats stop drifting too). hero_side.png/hero_atk_side.png still carry a
// faint version of this same texture but a same-slot regen attempt came out
// worse (added texture AND briefly drew a human face instead of a dog), so
// those two were left as-is rather than ship a downgrade — redo them next
// pass. Verified headlessly (Playwright): all 4 directions' walk cycles,
// all 4 attack directions, and a rat pounce, reading `state.player`/
// `state.enemies` directly plus cropped canvas screenshots — facing/
// mirroring for both Beverly and the rats is correct in every direction
// (this was NOT actually still broken; re-confirmed, not re-fixed).
//
// 2026-08-19 — found the actual root cause of the recurring "art looks
// wrong/different" reports for hero_up_walk2.png and rat_side_walk2.png
// specifically: the in-run art generator's automatic per-game styling only
// ever sent this file's `camera`/`style`/`palette`/`background`/`constraints`
// fields to the model, never the locked-hex-palette `mainCharacter`/`enemy`
// fields below — so unless a prior pass happened to retype the exact locked
// palette into that one generation's own prompt, the model was free to
// improvise fur/jacket/tail colors from scratch each time, which is exactly
// why hero_up_walk2 came out as a different-looking creature (no visible
// face, wrong palette, missing shield/dagger) than hero_up, and rat_side_
// walk2 came out olive-green instead of rat_side's brown. Regenerated both,
// this time with the full locked palette spelled out explicitly in the
// generation prompt itself (not just relying on art-style.json being read
// automatically) — both now visibly match their sibling frame's colors and
// silhouette. No code changes were needed for the sprites to be *used*: the
// walk-cycle swap logic below was already correct (loads all 8 PNGs, swaps
// on `animPhase`, falls back to canvas if any fail to load) — the sprites
// were being shown, they just alternated between two mismatched drawings.
// 2026-08-20 — the attack is now a real THREE-FRAME SLASH in every direction,
// off its own generated sheet (hero_attack_sheet.png, 3 cols x 3 rows: swing
// wind-up / mid-slash / follow-through x facing-down / facing-side / facing-up,
// side mirrored for left). Before this, "attacking" meant holding ONE drawn
// pose (the third column of hero_sheet.png) for the whole 220ms window while a
// procedural lunge and arc played over it — a single static pose can't show a
// blade travelling, so it read as a shove with a decal, not a swing. The three
// frames were generated as one row per direction so the character cannot drift
// between them, and the frame is picked from how far through the swing we are
// (see ATTACK_TIME / heroAttackSpriteFor). If the attack sheet is missing, the
// old single pose off hero_sheet.png is still used, and the canvas fallback
// still swings its own drawn blade — nothing hard-depends on the new file.
// 2026-08-20 (room art) — the level was four 64px tiles: mossy green ground,
// concrete, a wooden fence and a crate. It read as GRAPH PAPER, because every
// tile had been generated with this game's character rule ("thick black
// outline around the whole silhouette") and none of them tiled, so the floor
// was 200 outlined squares with visible seams, and a 1-in-5 sprinkle of a much
// paler concrete tile on top of that made a chessboard of it. Redone as seven
// 32px tiles off two generations (art-src/tiles_ground_raw.png,
// tiles_objects_raw.png), cut by .github/art/tileset.py, which makes the
// floor tiles wrap and snaps every pixel to the new `environmentPalette` in
// art-style.json. The level is now a scrapyard alley: cracked asphalt with
// scrap and concrete slabs, rusted corrugated fence, tyre-and-drum junk piles,
// oil puddles, and a real chained gate that swings open when the room clears.
// See drawTile/floorTileFor for the anti-repetition rules, and
// docs/TILED_LEVEL_STANDARD.md for the standard and how to regenerate.
const GAME_ID = "dog-punk";
const TILE = 32;
const COLS = 16;
const ROWS = 12;

// '2' wall/fence, '.' walkable grass, '3' junk-pile obstacle, 'G' gate
// (walkable once cleared, otherwise blocks), 'P' player spawn (walkable).
const MAP = [
  // Every row must be exactly COLS long. The top row used to be 15 characters
  // — one short — so the top-right corner had no wall character at all: not
  // solid (undefined isn't in SOLID), so you could stand inside the fence, and
  // drawn as floor, which is the pale square in that corner of the old level.
  "2222222GG2222222",
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
// Hero AND rat both ship a 3x3 sheet: columns idle/walk/attack, rows
// facing-down / facing-side (drawn facing right, mirrored for left) /
// facing-up. That covers all four facings with real drawn art for both,
// so nothing is ever drawn in profile while it walks up or down.
function loadSprite(src) {
  const img = new Image();
  const state = { img, ready: false };
  img.onload = () => { state.ready = true; };
  img.src = src;
  return state;
}

// HERO ART: one generated SPRITE SHEET (hero_sheet.png) — 3 columns
// (idle, walk, attack) x 3 rows (facing down, facing side, facing up),
// square cells, cut up at load into the nine frames below.
//
// WHY A SHEET AND NOT NINE PNGs: every hero frame used to be its own
// independently generated image, so fur colour, mohawk colour, body
// proportions and pixel scale drifted between frames — walking visibly
// changed the character's breed every other step, and regenerating one
// frame at a time could never converge because each new frame just drifted
// somewhere else. Frames cut from ONE image cannot drift: they were drawn
// together in a single generation, share one quantised palette, and are
// normalised to a common scale and foot baseline (see art-src/assemble.py,
// which also keys the generated background out to transparency).
const HERO_SHEET_COLS = 3;
const HERO_SHEET_ROWS = 3;
function sliceSheet(src, cols, rows) {
  // Same { img, ready } shape loadSprite returns, so drawAnimatedSprite
  // neither knows nor cares that these are canvases cut from one image.
  const frames = [];
  for (let i = 0; i < cols * rows; i++) frames.push({ img: null, ready: false });
  const sheet = new Image();
  sheet.onload = () => {
    const cw = Math.floor(sheet.width / cols);
    const ch = Math.floor(sheet.height / rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cv = document.createElement("canvas");
        cv.width = cw;
        cv.height = ch;
        const cx = cv.getContext("2d");
        // Keep the pixels chunky through the cut — the sheet IS pixel art.
        cx.imageSmoothingEnabled = false;
        cx.drawImage(sheet, c * cw, r * ch, cw, ch, 0, 0, cw, ch);
        const f = frames[r * cols + c];
        f.img = cv;
        f.ready = true;
      }
    }
  };
  // If the sheet ever fails to load, every frame stays ready:false and
  // drawAnimatedSprite falls back to the drawn-in-code hero, same as before.
  sheet.src = src;
  return frames;
}
const HERO = sliceSheet("hero_sheet.png", HERO_SHEET_COLS, HERO_SHEET_ROWS);

// RPG-Maker charset convention — see .github/art/CHARACTER_SHEETS.md. The
// three columns are [step, NEUTRAL, step]: column 1 is a real standing-still
// pose, not a stride.
//
// The old sheet's columns were [idle, walk, attack], and its "idle" column was
// itself a mid-stride drawing. Standing still therefore showed a walking pose
// — reported live as being stuck walking when facing left or right, and only
// visible left/right because the front and back rows happened to have been
// drawn legs-together. Attacks now come off their own sheet (HERO_ATK), which
// is what freed the third column to be a second step.
const COL_STEP_A = 0, COL_NEUTRAL = 1, COL_STEP_B = 2;
// middle -> step -> middle -> step. Cycling 0,1,2 straight through never
// returns to neutral between steps and reads as a shuffle.
const WALK_SEQUENCE = [COL_NEUTRAL, COL_STEP_A, COL_NEUTRAL, COL_STEP_B];
// One beat per quarter turn of the phase, so a full four-pose cycle takes the
// same 2*PI the old two-pose alternation did: same walking speed, twice the
// poses.
const WALK_BEAT = Math.PI / 2;
const HERO_ROW = { down: 0, side: 1, up: 2 };
function heroFrame(row, col) { return HERO[row * HERO_SHEET_COLS + col]; }
// Kept for the attack fallback path below, which still names them.
const heroAtkDown = heroFrame(HERO_ROW.down, COL_NEUTRAL);
const heroAtkSide = heroFrame(HERO_ROW.side, COL_NEUTRAL);
const heroAtkUp = heroFrame(HERO_ROW.up, COL_NEUTRAL);

// ATTACK ART: a second sheet, same 3x3 shape and same 256px cell as the hero
// sheet, but its three columns are three CONSECUTIVE MOMENTS of one weapon
// swing (wind-up, mid-slash, follow-through) rather than idle/walk/attack.
// Rows are the same three facings, and the side row is mirrored for left, so
// all four directions get the full slash. Generated one row per direction, so
// the three frames of a swing share a palette, proportions and pixel scale by
// construction — the whole reason the swing doesn't strobe between drawings.
const HERO_ATK = sliceSheet("hero_attack_sheet.png", 3, 3);
const ATTACK_FRAMES = 3;

// ROOM ART: one generated strip of seven 32px tiles, cut the same way as the
// sprite sheets. Falls back to the hand-drawn tiles below if the strip fails
// to load, so the level is never invisible.
//
// 32px, not 64: the canvas is 512x384 and a tile is drawn at TILE=32, so a
// 64px tile was being nearest-neighbour halved on its way to the screen and
// half its pixels never reached the player. One art pixel = one canvas pixel
// now, the same as the character sheets.
//
// The old four tiles read as GRAPH PAPER — a grid of squares, not a place —
// for two reasons, both fixed in the art rather than here. (1) Every tile
// carried the thick black outline art-style.json asks for, which is right for
// a character silhouette and fatal for a floor: 200 outlined squares are 200
// visible cell borders. (2) Nothing was seamless, so each tile ended where the
// next began. The floor tiles are now generated as borderless texture swatches
// and made to wrap by .github/art/build_tiles.py; see docs/TILED_LEVEL_STANDARD.md.
const TILE_COUNT = 7;
const TILES = sliceSheet("tiles.png", TILE_COUNT, 1);
const TILE_GROUND = 0, TILE_GROUND_ALT = 1, TILE_CONCRETE = 2, TILE_WALL = 3,
      TILE_JUNK = 4, TILE_GATE = 5, TILE_PUDDLE = 6;

// One tile drawn 200 times is a pattern; the eye finds it instantly. Two
// things break it up, both driven by a hash of the cell so the level looks
// the same every run (a random floor that reshuffles on reload is worse than
// a repetitive one):
//   * each floor tile is flipped horizontally and/or vertically,
//   * the material is chosen per cell — mostly plain asphalt, occasional
//     scrap-strewn asphalt, and clustered slabs of concrete (clustered, not
//     sprinkled: a 1-in-5 sprinkle of a pale tile is a chessboard, which is
//     exactly what the old floor looked like).
function cellHash(a, b) {
  let n = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function floorTileFor(c, r) {
  // >>1 makes the concrete decision per 2x2 block, so slabs come out as
  // patches of floor rather than lone squares.
  if (cellHash(c >> 1, r >> 1) > 0.86 || cellHash(c, r) > 0.97) return TILE_CONCRETE;
  return cellHash(c * 5 + 3, r * 9 + 1) > 0.86 ? TILE_GROUND_ALT : TILE_GROUND;
}
// Draw a tile into cell (c,r), optionally mirrored, optionally squeezed toward
// one side of the cell (which is how the gate swings open).
function blitTile(idx, c, r, flipX, flipY, squeeze, side) {
  const t = TILES[idx];
  if (!t || !t.ready) return;
  const x = c * TILE, y = r * TILE;
  const w = squeeze ? Math.max(3, Math.round(TILE * squeeze)) : TILE;
  const ox = squeeze ? (side === "right" ? TILE - w : 0) : 0;
  ctx.save();
  ctx.translate(x + ox + w / 2, y + TILE / 2);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(t.img, -w / 2, -TILE / 2, w, TILE);
  ctx.restore();
}

// Enemies come off their own sheet, cut exactly the same way and snapped to
// the SAME locked palette (art-style.json) — that is what keeps the rats
// looking like they belong in the same game as Beverly, instead of a
// finely-textured realistic rodent standing next to a flat cartoon dog.
//
// The rat sheet is now the SAME shape as the hero's: 3 columns (idle, walk,
// attack) x 3 rows (facing down, facing side-right, facing up). It used to be
// a single side-view row, so a rat walking straight up or straight down was
// drawn in right/left profile — it only ever looked correct while it happened
// to be moving sideways. All three rows were generated as one matched set of
// the same upright cartoon rat (art-src/rat_front_raw, rat_side_raw4,
// rat_back_raw) so the character cannot change shape when it turns.
const RAT = sliceSheet("rat_sheet.png", 3, 3);
const ratDown = RAT[0];
const ratDownWalk2 = RAT[1];
const ratAtkDown = RAT[2];
const ratSide = RAT[3];
const ratSideWalk2 = RAT[4];
const ratAtkSide = RAT[5];
const ratUp = RAT[6];
const ratUpWalk2 = RAT[7];
const ratAtkUp = RAT[8];

// facing (+ walk-cycle step) -> { sprite, mirror }
// The sheet's side row is drawn facing RIGHT, so "right" is the unmirrored
// case and "left" is the one that needs the flip. (The old per-frame PNGs
// faced LEFT and this was the other way round — if the character ever
// moonwalks again, this is the first thing to check, along with whether a
// newly generated sheet's side row faces the same way this one does.)
// The rats' PNGs still face LEFT, hence the opposite test in ratSpriteFor.
function heroSpriteFor(facing, col) {
  if (facing === "up") return { s: heroFrame(HERO_ROW.up, col), mirror: false };
  if (facing === "left") return { s: heroFrame(HERO_ROW.side, col), mirror: true };
  if (facing === "right") return { s: heroFrame(HERO_ROW.side, col), mirror: false };
  return { s: heroFrame(HERO_ROW.down, col), mirror: false };
}
// The rat sheet is still the older [idle, walk, attack] shape, so the hero's
// walk column collapses to "standing or stepping" here. When the rats are next
// regenerated they get the same [step, neutral, step] layout and this goes.
function ratSpriteFor(facing, col) {
  const step = col !== COL_NEUTRAL;
  if (facing === "up") return { s: step ? ratUpWalk2 : ratUp, mirror: false };
  if (facing === "left") return { s: step ? ratSideWalk2 : ratSide, mirror: true };
  if (facing === "right") return { s: step ? ratSideWalk2 : ratSide, mirror: false };
  return { s: step ? ratDownWalk2 : ratDown, mirror: false };
}
// Attack-pose lookups. The hero's takes a swing-frame index (0 wind-up,
// 1 mid-slash, 2 follow-through) instead of the walk-cycle `step`, so the
// blade actually travels through the swing in every direction; render()
// derives that index from how far through the attack window we are.
// Per-frame fallback: any frame the attack sheet didn't provide drops back to
// the single attack pose on hero_sheet.png, so a missing/failed sheet degrades
// to the old behaviour rather than to no hero at all.
function heroAttackSpriteFor(facing, frame) {
  const row = facing === "up" ? 2 : (facing === "left" || facing === "right") ? 1 : 0;
  const mirror = facing === "left";
  const i = Math.max(0, Math.min(ATTACK_FRAMES - 1, frame | 0));
  const f = HERO_ATK[row * ATTACK_FRAMES + i];
  if (f && f.ready) return { s: f, mirror };
  const legacy = row === 2 ? heroAtkUp : row === 1 ? heroAtkSide : heroAtkDown;
  return { s: legacy, mirror };
}
function ratAttackSpriteFor(facing) {
  if (facing === "up") return { s: ratAtkUp, mirror: false };
  if (facing === "left") return { s: ratAtkSide, mirror: true };
  if (facing === "right") return { s: ratAtkSide, mirror: false };
  return { s: ratAtkDown, mirror: false };
}

// ---- DOM ----
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
// Pixel art: never let the browser interpolate, or the chunky pixels blur.
ctx.imageSmoothingEnabled = false;

// Every sheet uses a 256px cell around a 4px art-pixel grid, so drawing all
// sheet-based characters at ONE cell size is what makes an art pixel the same
// size on screen for every one of them. Relative size lives in the art
// (Beverly fills 168px of her cell, a rat 104px), never in this number.
const SPRITE_CELL = 64;
// How long one swing lasts (ms). Long enough that each of the three slash
// frames gets a visible ~90ms on screen — at the old 220ms the wind-up and
// follow-through flickered past too fast to read as a swing.
const ATTACK_TIME = 270;
// How long an enemy stays lit up after taking a hit (seconds). Doubles as
// that enemy's brief i-frame window, so one swing can't multi-hit.
const HIT_FLASH_TIME = 0.3;
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
      breathePhase: 0,
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
    // Purely-visual scrap-burst particles left behind when a rat dies — see
    // update()'s attack-hit section (spawn) and render() (draw+fade). Never
    // read by collision/gate/win logic, so it can't affect gameplay timing.
    deathFx: [],
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
  // idle breathing: a slow, always-running clock independent of the walk
  // cycle, so Beverly is never a completely frozen static image while just
  // standing still — a subtle chest-rise/fall, used in render() only when
  // she's neither walking nor mid-attack (those already have their own
  // motion) so it never fights the walk-bob or the attack lunge/stretch.
  p.breathePhase += dt * 2.4;

  // attack
  if (attackQueued) {
    attackQueued = false;
    if (now >= p.attackCooldownUntil) {
      p.attackStartAt = now;
      p.attackUntil = now + ATTACK_TIME;
      p.attackCooldownUntil = now + ATTACK_TIME + 160;
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
        en.hitFlash = HIT_FLASH_TIME;
        // cosmetic impact spark at the point of contact (same particle
        // system as the death burst, just red/short) — the flash says
        // "that one landed", the spark says where.
        state.deathFx.push({
          x: (en.x + hx) / 2, y: (en.y + hy) / 2, t: 0, dur: 0.22, spark: true,
        });
        const kdx = en.x - p.x, kdy = en.y - p.y;
        const klen = Math.hypot(kdx, kdy) || 1;
        en.kbx = (kdx / klen) * 90;
        en.kby = (kdy / klen) * 90;
        if (en.hp <= 0) {
          en.alive = false;
          // purely-cosmetic scrap burst at the spot it died — see render()
          // for the fade/expand animation; doesn't touch gate/enemyCount
          // logic (that still keys off `alive`, unchanged from before).
          state.deathFx.push({ x: en.x, y: en.y, t: 0, dur: 0.4 });
        }
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
          // Cardinal patrol steps, not a free diagonal angle: reads much
          // more like a Zelda-style patrolling enemy. All four directions are
          // now equally likely — the old left/right bias only existed because
          // the rats had no up/down art, and now they do (rat_sheet.png has a
          // front row and a back row), so a rat walking up faces up and one
          // walking down faces down.
          const dir = ["left", "right", "up", "down"][Math.floor(Math.random() * 4)];
          en.wanderDx = dir === "left" ? -0.5 : dir === "right" ? 0.5 : 0;
          en.wanderDy = dir === "up" ? -0.5 : dir === "down" ? 0.5 : 0;
        }
        en.moving = true;
        moveEntity(en, en.wanderDx * en.speed * dt, en.wanderDy * en.speed * dt, gateOpen);
        en.facing = Math.abs(en.wanderDx) > Math.abs(en.wanderDy) ? (en.wanderDx > 0 ? "right" : "left") : (en.wanderDy > 0 ? "down" : "up");
      }
    }

    if (en.moving) en.animPhase += dt * 10;
    else en.animPhase *= 0.9;
  }

  // advance/prune the cosmetic death-burst particles (see attack-hit section
  // above for where they're spawned).
  if (state.deathFx.length) {
    for (const fx of state.deathFx) fx.t += dt;
    state.deathFx = state.deathFx.filter((fx) => fx.t < fx.dur);
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

  const flipX = cellHash(c * 3 + 1, r * 5 + 2) > 0.5;
  const flipY = cellHash(c * 7 + 5, r * 11 + 3) > 0.5;

  // Generated tiles when they're loaded; the drawn-in-code version below is
  // the fallback.
  if (TILES[TILE_GROUND].ready) {
    blitTile(floorTileFor(c, r), c, r, flipX, flipY);
    if (ch === "2") {
      // Corrugated fence panel. Only the horizontal flip is used: flipping
      // ribs top to bottom does nothing, but it would fight the tile's own
      // light direction.
      blitTile(TILE_WALL, c, r, flipX, false);
    } else if (ch === "3") {
      blitTile(TILE_JUNK, c, r, flipX, false);
    } else if (ch === "G") {
      // The gate is drawn art now, not a red/green tint over the floor. Shut,
      // it's a chained scrap-pipe panel filling the doorway; cleared, the two
      // leaves swing back against their posts and the way out is open floor
      // you can see through — the state reads as the gate having MOVED, which
      // a colour swatch never did.
      const side = MAP[r][c - 1] === "G" ? "right" : "left";
      blitTile(TILE_GATE, c, r, side === "right", false, gateOpen ? 0.22 : 1, side);
    } else if (cellHash(c * 13 + 2, r * 17 + 9) > 0.92) {
      // Oil puddles and weed tufts, sparsely, on open floor only: the litter
      // that makes a repeating surface look like a place rather than a texture.
      blitTile(TILE_PUDDLE, c, r, flipX, flipY);
    }
    return;
  }

  // ---- fallback (tiles.png missing/failed): same junkyard, drawn in code ----
  if (ch === "2") {
    ctx.fillStyle = "#6b3418";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#3d3f47";
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 + i * 8, y, 3, TILE);
    return;
  }
  // asphalt base for everything else (drawn first, obstacles layered after)
  ctx.fillStyle = (c + r) % 2 === 0 ? "#2f3038" : "#2a2b33";
  ctx.fillRect(x, y, TILE, TILE);
  if (ch === "G") {
    if (!gateOpen) {
      ctx.fillStyle = "#6b3418";
      for (let i = 0; i < 5; i++) ctx.fillRect(x + 2 + i * 6, y + 2, 3, TILE - 4);
      ctx.fillStyle = "#8c95a0";
      ctx.fillRect(x, y + 13, TILE, 3);
    } else {
      ctx.fillStyle = "#6b3418";
      ctx.fillRect(MAP[r][c - 1] === "G" ? x + TILE - 5 : x, y + 2, 5, TILE - 4);
    }
    return;
  }
  if (ch === "3") {
    ctx.fillStyle = "#22232a";
    ctx.fillRect(x + 3, y + 9, TILE - 6, TILE - 12);
    ctx.fillStyle = "#9a4d1c";
    ctx.fillRect(x + 16, y + 12, 12, TILE - 16);
    ctx.fillStyle = "#14121a";
    ctx.strokeRect(x + 3, y + 9, TILE - 6, TILE - 12);
  } else if (cellHash(c * 13 + 2, r * 17 + 9) > 0.92) {
    ctx.fillStyle = "#14121a";
    ctx.fillRect(x + 8, y + 12, 14, 8);
    ctx.fillStyle = "#5c7238";
    ctx.fillRect(x + 5, y + 10, 2, 4);
    ctx.fillRect(x + 24, y + 20, 2, 4);
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
  // same damage tell as the sheet path: white on the frame of impact, then
  // hot red for the rest of the flash window.
  ctx.fillStyle = hitFlash > HIT_FLASH_TIME * 0.85 ? "#ffffff"
    : hitFlash > 0 ? "#e02a2a" : "#8a7a5c";
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
  } else if (facing !== "up") {
    // eyes — omitted when the rat is walking away from the camera, so even
    // the fallback art turns around instead of staring backwards at you.
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(-6, -4, 2, 2);
    ctx.fillRect(4, -4, 2, 2);
  }
  ctx.restore();
}

// HIT FLASH: recolours a whole sprite frame to one flat colour, keeping its
// silhouette, by compositing a filled rect through the frame's own alpha.
// Done on a scratch canvas with `source-in` rather than by reading pixels,
// because the sheets can be canvas-tainting and getImageData would throw.
const tintScratch = document.createElement("canvas");
const tintCtx = tintScratch.getContext("2d");
function tintedFrame(img, color) {
  const w = img.width, h = img.height;
  if (tintScratch.width !== w || tintScratch.height !== h) {
    tintScratch.width = w;
    tintScratch.height = h;
  }
  tintCtx.globalCompositeOperation = "source-over";
  tintCtx.clearRect(0, 0, w, h);
  tintCtx.imageSmoothingEnabled = false;
  tintCtx.drawImage(img, 0, 0);
  tintCtx.globalCompositeOperation = "source-in";
  tintCtx.fillStyle = color;
  tintCtx.fillRect(0, 0, w, h);
  tintCtx.globalCompositeOperation = "source-over";
  return tintScratch;
}

// Draws a directional sprite with a real 2-frame pixel walk cycle (swaps to
// the opposite-leg drawn frame on alternating steps while moving) plus a
// bob/squash and an optional extra offset (used for the attack lunge).
// `spriteFor(facing, step)` returns `{ s: {img, ready}, mirror }`.
function drawAnimatedSprite(spriteFor, facing, x, y, size, anim, fallback) {
  // ~2 steps per phase cycle; phase advances with distance moved (see
  // update()), so cadence scales with actual movement speed.
  // Standing still is ALWAYS the neutral column, so a character never freezes
  // mid-stride the moment it stops.
  const walkCol = anim.moving
    ? WALK_SEQUENCE[Math.floor(anim.phase / WALK_BEAT) % WALK_SEQUENCE.length]
    : COL_NEUTRAL;
  const { s, mirror } = spriteFor(facing, walkCol);
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
    // damage flash: a white pop on the frame of impact that decays into a
    // hot red wash over the sprite's own silhouette, so a hit reads as a
    // hit even when the knockback is short or the enemy is against a wall.
    const flash = anim.flash || 0;
    if (flash > 0) {
      ctx.globalAlpha = Math.min(1, flash * 1.15);
      ctx.drawImage(tintedFrame(s.img, flash > 0.85 ? "#ffffff" : "#e02a2a"),
        -size / 2, -size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  } else {
    // The drawn-in-code fallback only has two poses, so the four-beat walk
    // column collapses back to "stepping or not" for it.
    fallback(x + dx, y + dy, facing, scaleX, scaleY, walkCol !== COL_NEUTRAL);
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
    // getting hit: flat white on impact decaying to red (see
    // drawAnimatedSprite), plus a recoil squash, so damage is unmistakable.
    const flash = Math.max(0, en.hitFlash) / HIT_FLASH_TIME;
    if (flash > 0) {
      scaleX *= 1 + flash * 0.16;
      scaleY *= 1 - flash * 0.12;
    }
    drawAnimatedSprite(lunging ? ratAttackSpriteFor : ratSpriteFor, en.facing, en.x, en.y - 6, SPRITE_CELL,
      { moving: en.moving && !lunging, phase: en.animPhase, scaleX, scaleY, flash },
      (x, y, facing, sx, sy, step) => drawRatFallback(x, y, facing, en.hitFlash, sx, sy, step, lunging));
  }

  // scrap-burst death animation: small squares kick outward from where a
  // rat died and fade/shrink over ~0.4s, instead of the rat just silently
  // vanishing the instant its hp hits zero.
  for (const fx of state.deathFx) {
    const t = fx.t / fx.dur; // 0..1
    const alpha = 1 - t;
    const spread = fx.spark ? 3 + t * 14 : 4 + t * 22;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    // `spark: true` = a non-fatal hit: a tight red/white puff at the point of
    // impact. Otherwise it's the death burst: scrap flying off in all
    // directions as the rat comes apart.
    const bits = fx.spark ? [
      [-1, -0.6, "#ffffff"], [1, -0.6, "#e02a2a"], [-0.6, 1, "#e02a2a"],
      [0.9, 1, "#ffffff"], [0, -1.2, "#e02a2a"],
    ] : [
      [-1, -1, "#8a7a5c"], [1, -1, "#5c4c34"], [-1, 1, "#5c4c34"],
      [1, 1, "#8a7a5c"], [0, -1.3, "#c0392b"], [0, 1.3, "#8a7a5c"],
    ];
    for (const [bx, by, color] of bits) {
      ctx.fillStyle = color;
      const size = (fx.spark ? 3 : 4) * (1 - t * 0.6);
      ctx.fillRect(fx.x + bx * spread - size / 2, fx.y - 6 + by * spread - size / 2, size, size);
    }
    ctx.restore();
  }

  const p = state.player;
  const blinking = now < p.invulnUntil && Math.floor(now / 100) % 2 === 0;
  const attacking = now < p.attackUntil;
  const attackT = attacking ? 1 - (p.attackUntil - now) / ATTACK_TIME : 0; // 0..1 through the swing
  // which of the three drawn slash frames that progress lands on
  const attackFrame = Math.min(ATTACK_FRAMES - 1, Math.floor(Math.max(0, attackT) * ATTACK_FRAMES));
  let offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1;
  if (attacking) {
    const [fx, fy] = FACING_VEC[p.facing];
    const lunge = Math.sin(Math.min(1, attackT) * Math.PI) * 6; // out and back
    offsetX = fx * lunge;
    offsetY = fy * lunge;
    const stretch = Math.sin(Math.min(1, attackT) * Math.PI) * 0.14;
    scaleX = 1 + stretch * Math.abs(fx) + stretch * 0.4 * Math.abs(fy);
    scaleY = 1 + stretch * Math.abs(fy) + stretch * 0.4 * Math.abs(fx);
  } else if (!p.moving) {
    // idle breathing (see update() for the clock) — a tiny, slow chest
    // rise/fall so standing still is never a completely frozen frame.
    const breathe = Math.sin(p.breathePhase) * 0.025;
    scaleY = 1 + breathe;
    scaleX = 1 - breathe * 0.5;
  }
  if (!blinking) {
    // during the attack window, play the three drawn slash frames for this
    // facing (wind-up -> mid-slash -> follow-through) instead of holding one
    // pose while the sprite lunges — a still pose plus a stretch read as a
    // body-check; a travelling blade reads as a swing.
    const swingSpriteFor = (facing) => heroAttackSpriteFor(facing, attackFrame);
    drawAnimatedSprite(attacking ? swingSpriteFor : heroSpriteFor, p.facing, p.x, p.y - 10, SPRITE_CELL,
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
let lastHudHp = null;
function renderHud() {
  const p = state.player;
  heartsEl.innerHTML = Array.from({ length: p.maxHp }, (_, i) => heartSVG(i < p.hp)).join("");
  // shake the heart row for one animation cycle whenever hp just dropped, so
  // losing health is a visible moment, not a silent icon swap.
  if (lastHudHp !== null && p.hp < lastHudHp) {
    heartsEl.classList.remove("hit");
    void heartsEl.offsetWidth; // restart the CSS animation if already mid-shake
    heartsEl.classList.add("hit");
  }
  lastHudHp = p.hp;
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
  lastHudHp = null;
  heartsEl.classList.remove("hit");
}

winRetryBtn.addEventListener("click", resetLevel);
loseRetryBtn.addEventListener("click", resetLevel);

requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });
