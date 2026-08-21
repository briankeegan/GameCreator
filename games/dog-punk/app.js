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
// 2026-08-20 (room art, second pass) — that first tile set was still wrong and
// was rejected on sight. The floor came back as fist-sized cobbles with ochre
// patches: correct as a picture of asphalt, a loud chequered mess at 32px with
// a dog standing on it. The "rusted corrugated fence" came back as planks and
// was used for interior blocks as well as the boundary, so it lay flat in the
// middle of the yard. Regenerated both sheets against a tightened prompt
// (quiet floor, tile-sized detail, walls drawn FACE-ON) and re-cut: the floor
// is now dark asphalt in three close values, concrete is dimmed until slabs
// stop chequering, the fence stands up and only ever runs round the edge, and
// interior obstacles are two OBJECT tiles — a tyre-and-drum pile and a scrap
// crate. The oil puddle is gone; see TILE_COUNT below.
// 2026-08-21 (Chapter 1) — this used to be one room ("Level 1: Scrapyard
// Alley", clear it, done). It's now three rooms end to end — Scrapyard
// Alley (unchanged) -> Junk Bridge (push a crate onto a switch) -> Back
// Gate (find and stand on three switches) — behind a short dialogue
// cutscene, ending with "Beverly Reaches Town" instead of "Alley Cleared".
// See the ROOMS comment below for the room list/shape and how they line up
// gate-to-spawn, isGateOpen() for what "cleared" means per room type, and
// freshState/transitionToRoom/resetRoom for how state moves between rooms
// (hp and the chapter clock carry across a room transition; dying only
// resets the room you died in, not the whole chapter). No new art: the
// crate reuses the existing scrap-crate tile at a live position instead of
// a fixed cell, and the switch plates are drawn procedurally from
// `environmentPalette` — see drawCrate/drawSwitchPlate — because both are
// gameplay affordances, not level scenery.
// 2026-08-21 (second pass — feedback: "all the rooms look the same, same
// shape, you only go up; the enemies have the same attack patterns; the
// puzzles are repeated and annoying") — three independent fixes, all data/
// logic, no new art:
//   1. Rooms now vary which WALL their forward gate is cut into (top/left/
//      right), not always the top, so the chapter is an actual snaking
//      street with real turns instead of one corridor walked straight up
//      14 times. See the ROOMS comment above the room list and
//      gateOrientation() for how a side-wall door is drawn.
//   2. Every enemy kind now runs its OWN attack (`attackKind` on
//      ENEMY_KINDS) instead of all three sharing one coil-then-dash state
//      machine with different numbers: the rat still pounces, the drone
//      fires a projectile and kites instead of ever biting, the brute
//      charges further and then has a real vulnerable recovery window.
//      See the ENEMY_KINDS comment and the enemy loop in update().
//   3. Puzzle rooms cut from 9 of 15 down to 6, spread across four
//      distinct mechanics (push / any-order switches / NEW ordered
//      "sequence" / plain fights) instead of 6 of the 9 being the same
//      find-3-plates room with a different floor pattern. See the comment
//      above the ROOMS list.
const GAME_ID = "dog-punk";
const TILE = 32;
const COLS = 16;
const ROWS = 12;

// '2' boundary fence, '.' walkable asphalt, '3' tyre-and-drum pile and '4'
// scrap-crate obstacle, 'G' gate (walkable once cleared, otherwise blocks),
// 'P' player spawn (walkable), 'X' a PUSHABLE crate's starting tile (turned
// into a dynamic object at room load, see buildRoomState — the '.' under it
// is what the tile grid actually holds once the room is running), 'S' a
// puzzle switch/pressure plate (walkable floor, drawn with a marker on top;
// see drawSwitchPlate).
//
// INTERIOR OBSTACLES ARE NOT THE BOUNDARY WALL. They used to be: blocks of
// '2' sat in the middle of the yard, so the corrugated-fence TEXTURE was
// drawn flat on the floor and read as planks someone had dropped, not as
// something you cannot walk through. Obstacles are objects with a visible
// base ('3' and '4'); '2' now only ever runs round the edge of the level.
// See docs/TILED_LEVEL_STANDARD.md, defect 5 — it is a level-map bug rather
// than an art bug, which is why no checker catches it.
//
// CHAPTER 1 is fifteen of these rooms end to end (ROOMS below), not one. Every
// room is the same COLSxROWS grid with its FORWARD gate ('G') on the same
// top-centre two cells and its forward-entry spawn ('P') on the same
// bottom-centre cell as every other room, on purpose — that's what "the
// levels fit together" means here: you walk out the top of one and into the
// bottom of the next and the street hasn't jumped sideways under you.
// 2026-08-21 (backtracking) — every room but the first ALSO has a BACK gate
// ('H') on the bottom-centre two cells, always walkable (see isSolidFor/
// drawTile — 'H' never checks isGateOpen, it's permanently the way you
// already came from) and a back-entry spawn ('B') just under its own
// forward gate, for arriving from the room after it. Walking out an 'H'
// steps back into the PREVIOUS room via transitionToRoom(idx-1,
// "backward") — see the gate-check in update(). That room is rebuilt fresh
// (buildRoomState again), same as a classic Zelda screen re-populating its
// enemies when you leave and return: retreating is always safe, it just
// isn't a permanent shortcut past a fight you haven't actually won yet.
// Rooms are grouped into three ZONES of five, each its own colour wash
// (see `tint` on ROOMS and render()) so the chapter doesn't read as one
// grey yard on a loop: Scrapyard (untinted) -> Rail Yard (cool teal,
// introduces the Scrap Drone) -> Rust Quarter (warm rust, introduces the
// Junk Brute) -> Town. Each zone cycles clear/switches/push rooms with a
// DIFFERENT obstacle layout every time (e.g. Junk Bridge vs Junk Courtyard
// are both "solve a puzzle then fight" rooms but neither reuses the
// other's map), so five rooms in the same zone still each look and play
// distinctly rather than being one room repeated five times.
const ALLEY_MAP = [
  // Every row must be exactly COLS long. The top row used to be 15 characters
  // — one short — so the top-right corner had no wall character at all: not
  // solid (undefined isn't in SOLID), so you could stand inside the fence, and
  // drawn as floor, which is the pale square in that corner of the old level.
  "2222222GG2222222",
  "2..............2",
  "2..34.......43.2",
  "2..............2",
  "2....43....34..2",
  "2..............2",
  "2..4......3....2",
  "2..............2",
  "2....3443......2",
  "2..............2",
  "2......P.......2",
  "2222222222222222",
];
// Scrap Catwalk: a second "clear the yard" room between the Alley and the
// Bridge, so the zone isn't just one clear-room before its puzzle — same
// obstacle vocabulary (tyre piles '3', crates '4'), different arrangement,
// more enemies than the Alley.
// 2026-08-21 (second pass) — every room used to be the exact same COLSxROWS
// rectangle with its forward gate on the top wall and its spawn on the
// bottom wall, so the chapter read as one corridor walked straight up 14
// times. Rooms now vary which WALL the forward gate sits on (top/left/
// right — see the `exitWall` note on each map below), so roughly half the
// transitions are an actual turn, not another flight north: catwalk exits
// EAST into bridge, bridge (entering from its own WEST wall) exits NORTH
// into courtyard, courtyard exits WEST into gate, and so on down the
// chapter (see the ROOMS list below for the exact per-room entry/exit
// pattern — the two are independent per room, so a hallway can turn a
// corner). A door on a side wall is a 2-cell vertical 'G'/'H' pair instead
// of horizontal (see drawTile's orientation check and blitTile's `axis`
// param) — the game already treated 'G'/'H' as plain characters found
// anywhere on the grid, so this needed no change to collision or the gate-
// open check, only to where the letters are written and how the door art
// is oriented when drawn. Verified with a standalone BFS/structural check
// (every room: exactly 16-wide rows, boundary solid except at a declared
// gate, G/H always a real adjacent pair, P and every G/H mutually
// reachable, no enemy spawn sitting on a solid tile) before this shipped —
// see the check script referenced in this pass's chat reply.
const CATWALK_MAP = [
  "2222222222222222",
  "2..............2",
  "2.4..4....4..4.2",
  "2..............2",
  "2....3....3....2",
  "2.............BG",
  "2....3....3....G",
  "2..............2",
  "2.4..4....4..4.2",
  "2..............2",
  "2......P.......2",
  "2222222HH2222222",
];
const BRIDGE_MAP = [
  "2222222GG2222222",
  "2......B.......2",
  "2...4......4...2",
  "2..............2",
  "2......S.......2",
  "HP.............2",
  "H......X...3...2",
  "2..............2",
  "2..3.......4...2",
  "2..............2",
  "2..............2",
  "2222222222222222",
];
// Junk Courtyard: a straight fight (no switch hunt — see the ROOMS comment
// on puzzle variety) between the Bridge's push puzzle and the Back Gate's
// switch hunt, so those two puzzle rooms aren't back to back.
const COURTYARD_MAP = [
  "2222222222222222",
  "2..............2",
  "2....3....3....2",
  "2..............2",
  "2.4............2",
  "GB.............2",
  "G..............2",
  "2..............2",
  "2....3....3....2",
  "2..............2",
  "2......P.......2",
  "2222222HH2222222",
];
const GATEROOM_MAP = [
  "2222222GG2222222",
  "2......B.......2",
  "2..S........S..2",
  "2..............2",
  "2......4.......2",
  "2.............PH",
  "2...3......3...H",
  "2..............2",
  "2.......S......2",
  "2..............2",
  "2..............2",
  "2222222222222222",
];
// ---- Rail Yard zone (rooms 6-10): introduces the Scrap Drone. ----
const RAIL_ENTRANCE_MAP = [
  "2222222GG2222222",
  "2......B.......2",
  "2..3........3..2",
  "2..............2",
  "2....4....4....2",
  "2..............2",
  "2.3..........3.2",
  "2..............2",
  "2....4....4....2",
  "2..............2",
  "2......P.......2",
  "2222222HH2222222",
];
// Signal Tower: a second clear room in the Rail Yard, mixed drone/rat.
const SIGNAL_TOWER_MAP = [
  "2222222222222222",
  "2..............2",
  "2..3........3..2",
  "2..............2",
  "2.......4......2",
  "2.............BG",
  "2..3........3..G",
  "2..............2",
  "2.......4......2",
  "2..............2",
  "2......P.......2",
  "2222222HH2222222",
];
const RAIL_OVERPASS_MAP = [
  "2222222GG2222222",
  "2......B.......2",
  "2.4............2",
  "2..............2",
  "2..3........3..2",
  "HP.............2",
  "H..............2",
  "2....4.........2",
  "2..............2",
  "2............4.2",
  "2..............2",
  "2222222222222222",
];
// Rail Switchyard: a straight fight (no switch hunt — see COURTYARD_MAP)
// between the Overpass push puzzle and the Drone Nest's sequence puzzle.
const SWITCHYARD_MAP = [
  "2222222222222222",
  "2..............2",
  "2..............2",
  "2..............2",
  "2....44....44..2",
  "GB.............2",
  "G..............2",
  "2....44....44..2",
  "2..............2",
  "2..............2",
  "2......P.......2",
  "2222222HH2222222",
];
const DRONE_NEST_MAP = [
  "2222222GG2222222",
  "2......B.......2",
  "2.S............2",
  "2..............2",
  "2....33....44..2",
  "2.............PH",
  "2..............H",
  "2....44....33..2",
  "2..............2",
  "2..........S...2",
  "2..S...........2",
  "2222222222222222",
];
// ---- Rust Quarter zone (rooms 11-15): introduces the Junk Brute. ----
const RUST_GATE_MAP = [
  "2222222GG2222222",
  "2......B.......2",
  "2..............2",
  "2...44....44...2",
  "2..............2",
  "2..............2",
  "2..............2",
  "2...44....44...2",
  "2..............2",
  "2..............2",
  "2......P.......2",
  "2222222HH2222222",
];
// Slag Pit: a second clear room, first place the Brute shares a room with
// the Foundry's push puzzle instead of standing alone in an open yard.
const SLAG_PIT_MAP = [
  "2222222222222222",
  "2..............2",
  "2..............2",
  "2..44....44....2",
  "2..............2",
  "2......33.....BG",
  "2..............G",
  "2..44....44....2",
  "2..............2",
  "2..............2",
  "2......P.......2",
  "2222222HH2222222",
];
const FOUNDRY_MAP = [
  "2222222GG2222222",
  "2......B.......2",
  "2..4........4..2",
  "2..............2",
  "2......S.......2",
  "HP.............2",
  "H..3........3..2",
  "2.....X........2",
  "2..............2",
  "2..4........4..2",
  "2..............2",
  "2222222222222222",
];
// Smelter: a sequence puzzle (see ROOMS comment) with its own switch
// layout and order, not a repeat of Drone Nest's.
const SMELTER_MAP = [
  "2222222222222222",
  "2..............2",
  "2....4....4....2",
  "2S.............2",
  "2..............2",
  "GB.............2",
  "G........4.....2",
  "2..............2",
  "2.............S2",
  "2......S.......2",
  "2......P.......2",
  "2222222HH2222222",
];
const TOWN_GATE_MAP = [
  "2222222GG2222222",
  "2......B.......2",
  "2.S..3....3..S.2",
  "2..............2",
  "2..............2",
  "2......44.....PH",
  "2..............H",
  "2..............2",
  "2.3..........3.2",
  "2.......S......2",
  "2..............2",
  "2222222222222222",
];

const SOLID = new Set(["2", "3", "4"]);

// Zone colour washes — see the `zoneTint` block in render(). Chosen from
// hues adjacent to (not inside) the locked environmentPalette family, so a
// zone reads as "the same junkyard, different light" rather than a UI
// filter slapped over it.
const TINT_RAIL = { color: "#274a57", alpha: 0.3 };
const TINT_RUST = { color: "#5a2e12", alpha: 0.24 };

// 2026-08-21 (second pass) — 6 of the 9 zones' "not just a fight" rooms used
// to be the exact same mechanic (`type: "switches"`, find 3 plates in any
// order) with only the floor pattern changed, which is why solving it a
// third and fourth time read as "the puzzles are repeated" rather than as
// three different puzzles. Puzzle rooms are now spread across FOUR distinct
// mechanics and cut from 9 of 15 rooms to 6, so most of the chapter is
// straight combat with a puzzle as a change of pace, not the default:
//   - "push"     Bridge, Foundry (2 rooms) — shove the crate onto the plate.
//   - "switches" Back Gate, Town Gate (2 rooms) — find 3 plates, any order;
//                kept ONLY for these two zone-ending gates so the "you must
//                search the room" beat still exists, just not six times.
//   - "sequence" Drone Nest, Smelter (2 rooms) — NEW: the same 3-plate idea,
//                but numbered and order-enforced (see drawSwitchPlate/
//                isGateOpen/puzzleStatus) — a real step up in what the
//                puzzle is asking, not a reskin of "switches".
//   - "clear"    the other 9 rooms — Junk Courtyard and Rail Switchyard
//                used to be "switches" rooms and are now straight fights.
const ROOMS = [
  {
    id: "alley",
    name: "Scrapyard Alley",
    map: ALLEY_MAP,
    type: "clear",
    enemySpawns: [{ c: 4, r: 1, type: "rat" }, { c: 12, r: 3, type: "rat" }, { c: 10, r: 8, type: "rat" }],
  },
  {
    id: "catwalk",
    name: "Scrap Catwalk",
    map: CATWALK_MAP,
    type: "clear",
    enemySpawns: [
      { c: 5, r: 3, type: "rat" },
      { c: 10, r: 3, type: "rat" },
      { c: 7, r: 7, type: "rat" },
      { c: 3, r: 9, type: "rat" },
    ],
  },
  {
    id: "bridge",
    name: "Junk Bridge",
    map: BRIDGE_MAP,
    type: "push", // gate opens once a crate rests on a switch tile AND enemies are cleared
    enemySpawns: [{ c: 3, r: 2, type: "rat" }, { c: 12, r: 8, type: "rat" }],
  },
  {
    id: "courtyard",
    name: "Junk Courtyard",
    map: COURTYARD_MAP,
    // A straight fight, not a fourth switch hunt — see the puzzle-variety
    // note above the ROOMS list. Four rats (one more than Alley/Catwalk)
    // so cutting the puzzle doesn't make the room feel thin.
    type: "clear",
    enemySpawns: [
      { c: 7, r: 2, type: "rat" }, { c: 4, r: 6, type: "rat" },
      { c: 13, r: 4, type: "rat" }, { c: 3, r: 9, type: "rat" },
    ],
  },
  {
    id: "gate",
    name: "Back Gate",
    map: GATEROOM_MAP,
    type: "switches", // gate opens once every switch tile has been stepped on AND enemies are cleared
    enemySpawns: [{ c: 7, r: 2, type: "rat" }, { c: 3, r: 6, type: "rat" }, { c: 12, r: 6, type: "rat" }],
  },
  {
    id: "railEntrance",
    name: "Rail Yard Entrance",
    map: RAIL_ENTRANCE_MAP,
    type: "clear",
    tint: TINT_RAIL,
    enemySpawns: [{ c: 4, r: 3, type: "drone" }, { c: 11, r: 3, type: "drone" }, { c: 7, r: 6, type: "rat" }],
  },
  {
    id: "signalTower",
    name: "Signal Tower",
    map: SIGNAL_TOWER_MAP,
    type: "clear",
    tint: TINT_RAIL,
    enemySpawns: [{ c: 3, r: 3, type: "drone" }, { c: 12, r: 3, type: "drone" }, { c: 7, r: 9, type: "rat" }],
  },
  {
    id: "railOverpass",
    name: "Rail Overpass",
    map: RAIL_OVERPASS_MAP,
    // Was a second push room; Bridge already teaches the push mechanic and
    // Foundry repeats it later in the Rust Quarter, so this is a straight
    // fight instead — one more drone than before to keep it from feeling
    // thin now that the crate/switch is gone.
    type: "clear",
    tint: TINT_RAIL,
    enemySpawns: [
      { c: 12, r: 2, type: "drone" }, { c: 3, r: 8, type: "rat" }, { c: 9, r: 9, type: "drone" },
    ],
  },
  {
    id: "switchyard",
    name: "Rail Switchyard",
    map: SWITCHYARD_MAP,
    // A straight fight, not a third find-any-order switch room — see the
    // puzzle-variety note above the ROOMS list.
    type: "clear",
    tint: TINT_RAIL,
    enemySpawns: [{ c: 4, r: 3, type: "drone" }, { c: 11, r: 3, type: "drone" }, { c: 7, r: 8, type: "drone" }],
  },
  {
    id: "droneNest",
    name: "Drone Nest",
    map: DRONE_NEST_MAP,
    // Sequence, not find-any-order: the three plates must be hit in the
    // order they're numbered (see drawSwitchPlate/isGateOpen and the
    // ROOMS comment above) — a real puzzle instead of "walk over 3 things
    // in whatever order", and not a repeat of Back Gate's mechanic.
    type: "sequence",
    tint: TINT_RAIL,
    enemySpawns: [{ c: 5, r: 3, type: "drone" }, { c: 10, r: 3, type: "drone" }, { c: 7, r: 6, type: "drone" }],
  },
  {
    id: "rustGate",
    name: "Rust Quarter Gate",
    map: RUST_GATE_MAP,
    type: "clear",
    tint: TINT_RUST,
    enemySpawns: [{ c: 7, r: 5, type: "brute" }, { c: 3, r: 2, type: "rat" }, { c: 12, r: 9, type: "rat" }],
  },
  {
    id: "slagPit",
    name: "Slag Pit",
    map: SLAG_PIT_MAP,
    type: "clear",
    tint: TINT_RUST,
    enemySpawns: [{ c: 7, r: 4, type: "brute" }, { c: 3, r: 2, type: "rat" }, { c: 12, r: 8, type: "rat" }],
  },
  {
    id: "foundry",
    name: "Scrap Foundry",
    map: FOUNDRY_MAP,
    type: "push",
    tint: TINT_RUST,
    enemySpawns: [{ c: 7, r: 5, type: "brute" }, { c: 3, r: 8, type: "rat" }],
  },
  {
    id: "smelter",
    name: "Smelter",
    map: SMELTER_MAP,
    // Sequence, same as Drone Nest, but its own switch layout/order — the
    // Rust Quarter's version of the ordered puzzle, not a repeat of it.
    type: "sequence",
    tint: TINT_RUST,
    enemySpawns: [{ c: 7, r: 6, type: "brute" }, { c: 3, r: 4, type: "drone" }, { c: 12, r: 4, type: "drone" }],
  },
  {
    id: "townGate",
    name: "Town Gate",
    map: TOWN_GATE_MAP,
    type: "switches",
    tint: TINT_RUST,
    enemySpawns: [
      { c: 7, r: 4, type: "brute" },
      { c: 4, r: 6, type: "drone" },
      { c: 11, r: 6, type: "drone" },
      { c: 7, r: 7, type: "rat" },
    ],
  },
];
// Precompute each room's switch-tile coordinates once, from its own map —
// never recomputed per-frame, and never drifts from the map because it's
// read off the same source of truth the tile grid uses.
for (const room of ROOMS) {
  room.switchTiles = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (room.map[r][c] === "S") room.switchTiles.push({ c, r });
    }
  }
}
// The live tile grid for whatever room is current — a mutable copy of that
// room's map with any 'X' (crate start) swapped for plain floor, because
// once the room is running the crate is a dynamic object (state.crates),
// not a static tile; leaving the 'X' in the grid would make that cell
// permanently solid even after the crate has been pushed off it.
let MAP = ROOMS[0].map;

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
      TILE_JUNK = 4, TILE_CRATE = 5, TILE_GATE = 6;
// There is no puddle tile any more. There was, and it was a near-black slick:
// scattered over a dark floor it read as HOLES punched through the level
// (docs/TILED_LEVEL_STANDARD.md, defect 4), and brightening it only turned the
// holes grey. Floor litter is the scrap-strewn asphalt variant below instead —
// it is the same material as the floor, so it can never punch through it.

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
// `axis` ("x", the default, or "y") is which way `squeeze` shrinks the tile
// — added for side-wall gates (see drawTile): a gate on the left/right
// boundary is a VERTICAL pair of cells, so "open" has to shrink each cell's
// HEIGHT toward its own outer edge (top cell up, bottom cell down) the same
// way a top/bottom gate's cells shrink WIDTH toward their own outer edge.
// `side` means "left"/"right" under axis "x" and "top"/"bottom" under axis
// "y" — which of the pair this cell is, so it shrinks away from its
// partner rather than both cells shrinking toward the same corner.
function blitTile(idx, c, r, flipX, flipY, squeeze, side, axis) {
  const t = TILES[idx];
  if (!t || !t.ready) return;
  const x = c * TILE, y = r * TILE;
  ctx.save();
  if (axis === "y") {
    const h = squeeze ? Math.max(3, Math.round(TILE * squeeze)) : TILE;
    const oy = squeeze ? (side === "bottom" ? TILE - h : 0) : 0;
    ctx.translate(x + TILE / 2, y + oy + h / 2);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(t.img, -TILE / 2, -h / 2, TILE, h);
  } else {
    const w = squeeze ? Math.max(3, Math.round(TILE * squeeze)) : TILE;
    const ox = squeeze ? (side === "right" ? TILE - w : 0) : 0;
    ctx.translate(x + ox + w / 2, y + TILE / 2);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(t.img, -w / 2, -TILE / 2, w, TILE);
  }
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

// Drone and Brute: two more enemy kinds, introduced past the original three
// rooms (see ROOMS below) — same 3x3 sheet shape as the rat, generated and
// cut the same way against the same locked palette (art-style.json's
// `characters.drone`/`characters.brute`), so a mixed room never reads as two
// different games. The Drone is a fast, fragile floating scrap-can (dies in
// one hit, sees you from further off); the Brute is a slow, tanky
// scrap-armored dog (takes four hits, hits harder on the way in). Both use
// the exact same [idle,walk,attack] x [down,side,up] layout as RAT above.
const DRONE = sliceSheet("drone_sheet.png", 3, 3);
const droneDown = DRONE[0];
const droneDownWalk2 = DRONE[1];
const droneAtkDown = DRONE[2];
const droneSide = DRONE[3];
const droneSideWalk2 = DRONE[4];
const droneAtkSide = DRONE[5];
const droneUp = DRONE[6];
const droneUpWalk2 = DRONE[7];
const droneAtkUp = DRONE[8];

const BRUTE = sliceSheet("brute_sheet.png", 3, 3);
const bruteDown = BRUTE[0];
const bruteDownWalk2 = BRUTE[1];
const bruteAtkDown = BRUTE[2];
const bruteSide = BRUTE[3];
const bruteSideWalk2 = BRUTE[4];
const bruteAtkSide = BRUTE[5];
const bruteUp = BRUTE[6];
const bruteUpWalk2 = BRUTE[7];
const bruteAtkUp = BRUTE[8];

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
function droneSpriteFor(facing, col) {
  const step = col !== COL_NEUTRAL;
  if (facing === "up") return { s: step ? droneUpWalk2 : droneUp, mirror: false };
  if (facing === "left") return { s: step ? droneSideWalk2 : droneSide, mirror: true };
  if (facing === "right") return { s: step ? droneSideWalk2 : droneSide, mirror: false };
  return { s: step ? droneDownWalk2 : droneDown, mirror: false };
}
function droneAttackSpriteFor(facing) {
  if (facing === "up") return { s: droneAtkUp, mirror: false };
  if (facing === "left") return { s: droneAtkSide, mirror: true };
  if (facing === "right") return { s: droneAtkSide, mirror: false };
  return { s: droneAtkDown, mirror: false };
}
function bruteSpriteFor(facing, col) {
  const step = col !== COL_NEUTRAL;
  if (facing === "up") return { s: step ? bruteUpWalk2 : bruteUp, mirror: false };
  if (facing === "left") return { s: step ? bruteSideWalk2 : bruteSide, mirror: true };
  if (facing === "right") return { s: step ? bruteSideWalk2 : bruteSide, mirror: false };
  return { s: step ? bruteDownWalk2 : bruteDown, mirror: false };
}
function bruteAttackSpriteFor(facing) {
  if (facing === "up") return { s: bruteAtkUp, mirror: false };
  if (facing === "left") return { s: bruteAtkSide, mirror: true };
  if (facing === "right") return { s: bruteAtkSide, mirror: false };
  return { s: bruteAtkDown, mirror: false };
}

// Per-enemy-kind stats and art lookups, keyed by the `type` used in a room's
// `enemySpawns` (see ROOMS below; unset/unknown types fall back to "rat" in
// buildRoomState). Behaviour code (update()'s enemy loop, render()'s enemy
// draw loop) reads speed/hp/range/sprite lookups off the ENEMY instance
// (copied from here at spawn time in buildRoomState) rather than off this
// table directly, so it stays oblivious to how many kinds exist.
// `attackKind` is what actually made the three enemies play differently
// feel identical before this pass: all three ran the exact same coil-then-
// dash-into-contact state machine and only their numbers (speed/hp/range)
// changed, which reads as "the same attack" with a different stat block,
// not a different enemy. Each kind now drives its own branch in update()'s
// enemy loop (search `en.attackKind`) instead of sharing one:
//   "pounce" (rat)  — unchanged: short coil, short dash, contact damage.
//   "ranged" (drone) — never closes to bite. Coils, then FIRES a projectile
//     (state.projectiles) at the player's position and holds — the only one
//     of the three that can hurt Beverly without being adjacent to her —
//     and backs away if she gets inside `retreatRange` instead of standing
//     there to be hit, so it plays like a hovering skirmisher, not a rat
//     with wings.
//   "charge" (brute) — a much longer telegraph, then a fast dash that
//     travels FAR (further than a rat's pounce) and, whether or not it
//     connects, ends in a `recover` window where it's stationary and can't
//     act — overcommitting is the risk that makes it different from just a
//     slower rat, and the recover window is the player's real punish.
const ENEMY_KINDS = {
  rat: {
    id: "rat", w: 22, h: 20, speed: 55, hp: 2,
    detectRange: 100, attackRange: 34, lungeMult: 3.4,
    attackKind: "pounce", windupTime: 0.28, lungeTime: 0.16,
    spriteFor: ratSpriteFor, attackSpriteFor: ratAttackSpriteFor, fallback: drawRatFallback,
  },
  // Fast and fragile: sees you from further off, but one hit from Beverly's
  // dagger ends it — a "kill it before it pins you down" threat rather than
  // a slugging match. Never bites; see `attackKind: "ranged"` above.
  drone: {
    id: "drone", w: 20, h: 20, speed: 85, hp: 1,
    detectRange: 150, attackRange: 130, retreatRange: 70, lungeMult: 0,
    attackKind: "ranged", windupTime: 0.4, fireTime: 0.18, projectileSpeed: 210, cooldownMs: 1100,
    spriteFor: droneSpriteFor, attackSpriteFor: droneAttackSpriteFor, fallback: drawDroneFallback,
  },
  // Slow and tanky: takes four hits and hits like a truck, but its detection
  // range is short and it's easy to outrun — a "don't get cornered" threat.
  // See `attackKind: "charge"` above for what makes its attack a different
  // RISK, not just a slower version of the rat's.
  brute: {
    id: "brute", w: 30, h: 26, speed: 40, hp: 4,
    detectRange: 90, attackRange: 46, lungeMult: 4.6,
    attackKind: "charge", windupTime: 0.5, lungeTime: 0.4, recoverTime: 0.6,
    spriteFor: bruteSpriteFor, attackSpriteFor: bruteAttackSpriteFor, fallback: drawBruteFallback,
  },
};

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
const hudTitleEl = document.getElementById("hudTitle");
const winOverlay = document.getElementById("winOverlay");
const winTimeEl = document.getElementById("winTime");
const loseOverlay = document.getElementById("loseOverlay");
const winRetryBtn = document.getElementById("winRetryBtn");
const loseRetryBtn = document.getElementById("loseRetryBtn");
const dpad = document.getElementById("dpad");
const attackBtn = document.getElementById("attackBtn");
const roomToastEl = document.getElementById("roomToast");
const introOverlay = document.getElementById("introOverlay");
const introTextEl = document.getElementById("introText");
const introBtn = document.getElementById("introBtn");
const introPortrait = document.getElementById("introPortrait");
const introPortraitCtx = introPortrait ? introPortrait.getContext("2d") : null;

// ---- chapter intro cutscene ----
// A few lines of scene-setting before the first room's gameplay starts,
// shown over the (already-loaded, already-rendering) alley itself rather
// than a separate blank screen — update() is gated on introActive below so
// nothing moves or takes input while it's up, but render()/renderHud() keep
// running so the room isn't a black box behind the text.
const INTRO_LINES = [
  "Scrapyard Alley, after dark. Beverly's run these lanes since she could walk.",
  "Lately the junk rats have been swarming closer to the fence line than they ever used to — like something's pushed them out of the deep scrap.",
  "Past the alley, past the rail yard, past the rust quarter: Town. Streetlights, real food, somewhere that isn't scrap metal.",
  "She checks the mohawk in a cracked side-mirror and grips the dagger. Let's ride.",
];
let introActive = true;
let introStep = 0;
function drawIntroPortrait() {
  if (!introPortraitCtx) return;
  const f = heroFrame(HERO_ROW.down, COL_NEUTRAL);
  introPortraitCtx.imageSmoothingEnabled = false;
  introPortraitCtx.clearRect(0, 0, introPortrait.width, introPortrait.height);
  if (f && f.ready) introPortraitCtx.drawImage(f.img, 0, 0, introPortrait.width, introPortrait.height);
}
function renderIntro() {
  introTextEl.textContent = INTRO_LINES[introStep];
  introBtn.textContent = introStep < INTRO_LINES.length - 1 ? "Next" : "Head Out";
  drawIntroPortrait();
}
function advanceIntro() {
  if (!introActive) return;
  if (introStep < INTRO_LINES.length - 1) {
    introStep += 1;
    renderIntro();
    return;
  }
  introActive = false;
  introOverlay.hidden = true;
  attackQueued = false; // discard any attack-button tap that landed on the cutscene
  // The chapter clock starts when play actually begins, not while reading.
  state.startTime = performance.now();
}
introBtn.addEventListener("click", advanceIntro);
introOverlay.addEventListener("click", (e) => { if (e.target === introOverlay) advanceIntro(); });
renderIntro();

function showRoomToast(text) {
  if (!roomToastEl) return;
  roomToastEl.textContent = text;
  roomToastEl.classList.add("show");
  clearTimeout(showRoomToast._t);
  showRoomToast._t = setTimeout(() => roomToastEl.classList.remove("show"), 1600);
}

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
  if (introActive) {
    if (e.code === "Space" || e.code === "Enter") { advanceIntro(); e.preventDefault(); }
    return;
  }
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
// Everything that's PER-ROOM (the tile grid, its spawn point, its enemies,
// its crates) is built by this one function so a fresh chapter start, a
// room-to-room transition and a post-death respawn can never disagree about
// what "room idx, freshly entered" looks like — see freshState/
// transitionToRoom/resetRoom, all three just call this and splice the
// result into whichever fields they own.
function buildRoomState(idx) {
  const room = ROOMS[idx];
  MAP = room.map.map((row) => row.replace(/X/g, "."));
  let spawn = { x: 7 * TILE + TILE / 2, y: 10 * TILE + TILE / 2 };
  // 'B' is the BACK-gate arrival point — where you land after retreating in
  // through this room's 'H' tile from the room after it — set just under
  // this room's own forward gate. Rooms with no predecessor (room 0) never
  // use it. Falls back to `spawn` so a room without a 'B' marker can't hand
  // back an undefined coordinate.
  let backSpawn = null;
  const crates = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = room.map[r][c];
      if (ch === "P") spawn = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
      if (ch === "B") backSpawn = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
      if (ch === "X") crates.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, w: 26, h: 26, isCrate: true });
    }
  }
  if (!backSpawn) backSpawn = spawn;
  const enemies = room.enemySpawns.map((s) => {
    const kind = ENEMY_KINDS[s.type] || ENEMY_KINDS.rat;
    return {
      x: s.c * TILE + TILE / 2, y: s.r * TILE + TILE / 2,
      type: kind.id,
      w: kind.w, h: kind.h, speed: kind.speed,
      detectRange: kind.detectRange, attackRange: kind.attackRange, lungeMult: kind.lungeMult,
      // `attackKind` and its timings drive the per-kind branch in update()'s
      // enemy loop — see the ENEMY_KINDS comment for what each kind means.
      attackKind: kind.attackKind, windupTime: kind.windupTime,
      lungeTime: kind.lungeTime, fireTime: kind.fireTime, recoverTime: kind.recoverTime,
      retreatRange: kind.retreatRange || 0, projectileSpeed: kind.projectileSpeed,
      cooldownMs: kind.cooldownMs || 900,
      hp: kind.hp, alive: true, facing: "down",
      wanderT: Math.random() * 2, wanderDx: 0, wanderDy: 0,
      hitFlash: 0,
      animPhase: 0, moving: false,
      // attack state machine: idle (seek/wander) -> windup (telegraph, holds
      // still) -> then EITHER lunge (pounce/charge: fast dash, contact
      // damage) or fire (ranged: stays put, launches a projectile) -> for
      // "charge" only, a recover window that can't move or act -> back to
      // idle with a cooldown. See ENEMY_KINDS for which kind uses which.
      atkState: "idle", atkTimer: 0, atkDuration: 0,
      attackCooldownUntil: 0, lungeDx: 0, lungeDy: 0, hasHitThisLunge: false,
    };
  });
  return { spawn, backSpawn, crates, enemies };
}

function freshState() {
  const built = buildRoomState(0);
  return {
    roomIndex: 0,
    player: {
      x: built.spawn.x, y: built.spawn.y, w: 22, h: 22,
      speed: 130, facing: "down",
      hp: 3, maxHp: 3,
      invulnUntil: 0,
      attackUntil: 0, attackCooldownUntil: 0, attackStartAt: 0,
      kbx: 0, kby: 0,
      animPhase: 0, moving: false,
      breathePhase: 0,
    },
    enemies: built.enemies,
    crates: built.crates,
    // Back Gate puzzle: which switch tiles (encoded as row*COLS+col) have
    // been stepped on this room. Reset every room load — see isGateOpen.
    switchesHit: new Set(),
    startTime: performance.now(),
    elapsed: 0,
    won: false,
    lost: false,
    // Purely-visual scrap-burst particles left behind when a rat dies — see
    // update()'s attack-hit section (spawn) and render() (draw+fade). Never
    // read by collision/gate/win logic, so it can't affect gameplay timing.
    deathFx: [],
    // Scrap Drone bolts — see the "ranged" branch of the enemy attack loop
    // in update() (spawn) and render() (draw/advance). Reset every room
    // load exactly like deathFx: a projectile mid-flight when you leave a
    // room has no business surviving into the next one.
    projectiles: [],
  };
}

// Called when the player walks through an open forward gate ('G', entry
// "forward") OR a back gate ('H', entry "backward") — see the ROOMS comment
// and the gate-check in update(). Keeps hp and the chapter clock running
// (state.startTime untouched) — only the room-local fields are replaced —
// so the chapter is one continuous run across every room, not one
// best-time per room. "backward" arrivals land at the room's `backSpawn`
// (just under its own forward gate) instead of its usual `spawn`.
function transitionToRoom(idx, entry) {
  const built = buildRoomState(idx);
  const at = entry === "backward" ? built.backSpawn : built.spawn;
  state.roomIndex = idx;
  state.player.x = at.x;
  state.player.y = at.y;
  state.player.kbx = 0; state.player.kby = 0;
  state.player.attackUntil = 0; state.player.attackCooldownUntil = 0;
  state.enemies = built.enemies;
  state.crates = built.crates;
  state.switchesHit = new Set();
  state.deathFx = [];
  state.projectiles = [];
  showRoomToast(ROOMS[idx].name);
}

// Called on death: respawns in the CURRENT room with full hp, rather than
// sending the player back to room 1 — losing a fight in the Back Gate room
// shouldn't cost the two rooms before it.
function resetRoom() {
  const built = buildRoomState(state.roomIndex);
  state.player.x = built.spawn.x;
  state.player.y = built.spawn.y;
  state.player.hp = state.player.maxHp;
  state.player.kbx = 0; state.player.kby = 0;
  state.player.invulnUntil = 0;
  state.player.attackUntil = 0; state.player.attackCooldownUntil = 0;
  state.enemies = built.enemies;
  state.crates = built.crates;
  state.switchesHit = new Set();
  state.deathFx = [];
  state.projectiles = [];
  state.lost = false;
  loseOverlay.hidden = true;
  lastHudHp = null;
}

let state = freshState();

// ---- collision ----
function tileAt(px, py) {
  const c = Math.floor(px / TILE);
  const r = Math.floor(py / TILE);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return "2";
  return MAP[r][c];
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (ah + bh) / 2;
}

// The Junk Bridge puzzle's crate (state.crates) is a dynamic obstacle, not a
// tile, so it can't be tested by tileAt — this is the crate equivalent of
// checking SOLID, called from isSolidFor exactly the way the tile check is.
function crateBlocking(entity, px, py) {
  for (const cr of state.crates) {
    if (entity.isCrate && cr === entity) continue; // a crate never blocks itself
    if (rectsOverlap(px, py, entity.w, entity.h, cr.x, cr.y, cr.w, cr.h)) return cr;
  }
  return null;
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
    if (t === "H") continue; // back gate: always open, see ROOMS comment
    if (SOLID.has(t)) return true;
  }
  if (crateBlocking(entity, px, py)) return true;
  return false;
}

// `pusher` (only ever true for the player's own voluntary movement — see
// update()) lets a crate in the way be shoved one puzzle-push at a time: the
// crate is moved first with pusher=false (so IT can be blocked by a wall or
// another crate but can never in turn push one), and only if that clears the
// way does the pusher itself move into the tile. Knockback and enemies never
// push crates, so a rat can't shove the puzzle solved by accident.
function moveEntity(entity, dx, dy, gateOpen, pusher) {
  if (dx !== 0) {
    const nx = entity.x + dx;
    if (pusher) {
      const cr = crateBlocking(entity, nx, entity.y);
      if (cr) moveEntity(cr, dx, 0, gateOpen, false);
    }
    if (!isSolidFor(entity, nx, entity.y, gateOpen)) entity.x = nx;
  }
  if (dy !== 0) {
    const ny = entity.y + dy;
    if (pusher) {
      const cr = crateBlocking(entity, entity.x, ny);
      if (cr) moveEntity(cr, 0, dy, gateOpen, false);
    }
    if (!isSolidFor(entity, entity.x, ny, gateOpen)) entity.y = ny;
  }
}

// ---- update ----
function update(dt, now) {
  if (state.won || state.lost || introActive) return;
  const p = state.player;
  const gateOpen = isGateOpen();

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
    // pusher=true: this is the player's own footwork, the only movement in
    // the game allowed to shove the Junk Bridge crate.
    moveEntity(p, dx * p.speed * dt, dy * p.speed * dt, gateOpen, true);
  }

  // Switch puzzle: stepping onto a switch tile activates it permanently for
  // the rest of the room (a memory/exploration puzzle — find them all —
  // rather than a timing one). Harmless to check in every room; only
  // "switches"/"sequence" rooms ever have an 'S' tile to find.
  //
  // "sequence" rooms (Drone Nest, Smelter) additionally enforce ORDER: a
  // plate only activates if it's the next one in `room.switchTiles` (the
  // order they're numbered in, drawn by drawSwitchPlate) — stepping on plate
  // 3 before plate 2 does nothing yet, rather than counting it early or
  // punishing the wrong guess by resetting progress. `state.switchesHit`
  // doubles as the "how many done" count for both room types precisely
  // because entries are only ever added in valid order for "sequence" too.
  {
    const pc = Math.floor(p.x / TILE), pr = Math.floor(p.y / TILE);
    if (MAP[pr] && MAP[pr][pc] === "S") {
      const room = ROOMS[state.roomIndex];
      const key = pr * COLS + pc;
      if (room.type === "sequence") {
        const next = room.switchTiles[state.switchesHit.size];
        if (next && next.r === pr && next.c === pc) state.switchesHit.add(key);
      } else {
        state.switchesHit.add(key);
      }
    }
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

  // enemies — detect/attack range and lunge speed are now per-enemy (see
  // ENEMY_KINDS/buildRoomState) instead of one shared constant, so a Drone
  // spots you from further off than a Rat and a Brute lunges slower.
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
        const len = Math.hypot(dxp, dyp) || 1;
        en.lungeDx = dxp / len;
        en.lungeDy = dyp / len;
        if (en.attackKind === "ranged") {
          // Fires here, at the end of the telegraph, aimed at the player's
          // CURRENT position — a straight-line shot, not a homing one, so
          // sidestepping after the coil is a real dodge. "fire" itself is
          // just the drone holding its pose for one beat; the projectile is
          // its own object from here on (see the update below).
          en.atkState = "fire";
          en.atkTimer = en.atkDuration = en.fireTime;
          state.projectiles.push({
            x: en.x, y: en.y, dx: en.lungeDx, dy: en.lungeDy,
            speed: en.projectileSpeed, life: 1.6, w: 8, h: 8,
          });
        } else {
          en.atkState = "lunge";
          en.atkTimer = en.atkDuration = en.lungeTime;
          en.hasHitThisLunge = false;
        }
      }
    } else if (en.atkState === "fire") {
      // Recoil beat after loosing the shot — no movement, no damage here
      // (the projectile itself is what can hurt the player); just holds the
      // attack pose until its own cooldown lets it act again.
      en.atkTimer -= dt;
      if (en.atkTimer <= 0) { en.atkState = "idle"; en.attackCooldownUntil = now + en.cooldownMs; }
    } else if (en.atkState === "lunge") {
      // the actual attack: a fast committed dash — this is the only window
      // that can damage the player, so a hit always has a visible "wind up
      // then pounce/charge" tell before it, not just silent contact.
      en.atkTimer -= dt;
      en.moving = true;
      moveEntity(en, en.lungeDx * en.speed * en.lungeMult * dt, en.lungeDy * en.speed * en.lungeMult * dt, gateOpen);
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
        // Only the Brute's "charge" overcommits into a recovery window —
        // the rat's pounce is a quick, low-risk jab and goes straight back
        // to idle, same as always.
        if (en.attackKind === "charge") {
          en.atkState = "recover";
          en.atkTimer = en.atkDuration = en.recoverTime;
        } else {
          en.atkState = "idle";
          en.attackCooldownUntil = now + en.cooldownMs;
        }
      }
    } else if (en.atkState === "recover") {
      // Dazed after a charge, whether or not it connected — planted in
      // place, can't move or act. This is the actual punish window the
      // Brute's longer telegraph is trading against; skipping it would
      // leave "charge" just a faster pounce with extra steps.
      en.atkTimer -= dt;
      if (en.atkTimer <= 0) { en.atkState = "idle"; en.attackCooldownUntil = now + en.cooldownMs; }
    } else {
      const distToPlayer = Math.hypot(p.x - en.x, p.y - en.y);
      if (en.attackKind === "ranged" && distToPlayer < en.retreatRange) {
        // Too close for a hovering shooter — back off instead of standing
        // there to get bitten, so getting in its face is a real answer to
        // it, not just free damage on top of dodging the bolt. Checked
        // regardless of cooldown (unlike the windup trigger below) so it
        // doesn't rush back in for the 1.1s between shots.
        en.moving = true;
        const ex = (en.x - p.x) / (distToPlayer || 1);
        const ey = (en.y - p.y) / (distToPlayer || 1);
        moveEntity(en, ex * en.speed * dt, ey * en.speed * dt, gateOpen);
        en.facing = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? "right" : "left") : (ey > 0 ? "down" : "up");
      } else if (distToPlayer < en.attackRange && now >= en.attackCooldownUntil) {
        en.atkState = "windup";
        en.atkTimer = en.atkDuration = en.windupTime;
      } else if (distToPlayer < en.detectRange) {
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

  // Scrap Drone bolts — spawned in the "ranged" branch above. A straight
  // line at fixed speed; dies on a wall, on the player (dealing the same
  // one point of damage/knockback a lunge does, same invuln window so it
  // can't stack with a rat's bite in the same instant), or on its own
  // timeout so a shot fired into an empty corner doesn't outlive the room.
  if (state.projectiles.length) {
    for (const pr of state.projectiles) {
      pr.x += pr.dx * pr.speed * dt;
      pr.y += pr.dy * pr.speed * dt;
      pr.life -= dt;
      if (SOLID.has(tileAt(pr.x, pr.y))) { pr.life = 0; continue; }
      if (now >= p.invulnUntil && rectsOverlap(p.x, p.y, p.w, p.h, pr.x, pr.y, pr.w, pr.h)) {
        pr.life = 0;
        p.hp -= 1;
        p.invulnUntil = now + 900;
        const klen = Math.hypot(pr.dx, pr.dy) || 1;
        p.kbx = (pr.dx / klen) * 130;
        p.kby = (pr.dy / klen) * 130;
        if (p.hp <= 0) {
          state.lost = true;
          loseOverlay.hidden = false;
        }
      }
    }
    state.projectiles = state.projectiles.filter((pr) => pr.life > 0);
  }

  // advance/prune the cosmetic death-burst particles (see attack-hit section
  // above for where they're spawned).
  if (state.deathFx.length) {
    for (const fx of state.deathFx) fx.t += dt;
    state.deathFx = state.deathFx.filter((fx) => fx.t < fx.dur);
  }

  // gate check: standing on the gate tile once its room's condition is met.
  // Every room but the last just loads the next one (with a brief non-
  // blocking toast, not a stopping overlay) — that continuity is the point,
  // see the ROOMS comment. Only the LAST room's gate ends the chapter.
  const standingTile = tileAt(p.x, p.y);
  if (gateOpen && standingTile === "G") {
    if (state.roomIndex < ROOMS.length - 1) {
      transitionToRoom(state.roomIndex + 1, "forward");
    } else {
      state.won = true;
      state.elapsed = (now - state.startTime) / 1000;
      const best = GCStorage.get(GAME_ID, "chapter1BestSecondsV2", null);
      if (best === null || state.elapsed < best) GCStorage.set(GAME_ID, "chapter1BestSecondsV2", state.elapsed);
      winTimeEl.textContent = `Chapter 1 cleared in ${state.elapsed.toFixed(1)}s` +
        (best !== null ? ` (best: ${Math.min(best, state.elapsed).toFixed(1)}s)` : "");
      winOverlay.hidden = false;
    }
  }
  // back gate: 'H', always walkable, always open (see isSolidFor/drawTile) —
  // steps you back into the PREVIOUS room, arriving near ITS forward gate
  // rather than at its usual bottom spawn. Room 0 has no back gate (nothing
  // before it). Retreating re-rolls that room fresh (buildRoomState again),
  // same as a Zelda screen resetting its enemies when you leave and return —
  // it is not a permanent "cleared" flag, on purpose: simpler, and it means
  // fleeing a fight you're losing doesn't hand you a shortcut past it.
  if (standingTile === "H" && state.roomIndex > 0) {
    transitionToRoom(state.roomIndex - 1, "backward");
  }
}

// Whether the CURRENT room's gate should be open: every room needs its
// enemies cleared, and the puzzle rooms need their extra condition on top —
// see the ROOMS comment for what each room `type` means. Centralised here
// (update() and render() both used to recompute the plain "enemies cleared"
// version separately, which is exactly the kind of duplicated rule that
// drifts the moment only one copy gets the puzzle condition added) so both
// callers always agree.
function isGateOpen() {
  if (!state.enemies.every((e) => !e.alive)) return false;
  const room = ROOMS[state.roomIndex];
  if (room.type === "push") return state.crates.some((cr) => crateOnSwitch(room, cr));
  if (room.type === "switches" || room.type === "sequence") {
    // Same completion test for both — "sequence" only differs in HOW a
    // plate is allowed to join switchesHit (see the switch-detection code
    // in update()), not in what "done" means.
    return room.switchTiles.length > 0 && state.switchesHit.size >= room.switchTiles.length;
  }
  return true;
}

function crateOnSwitch(room, cr) {
  const c = Math.floor(cr.x / TILE), r = Math.floor(cr.y / TILE);
  return room.switchTiles.some((s) => s.c === c && s.r === r);
}

// ---- drawing ----
// A gate/back-gate is always a 2-cell pair, but which way the pair runs
// depends on which wall it's cut into: a top/bottom-wall gate is a
// horizontal pair (see CATWALK_MAP's "GG" in its own top/bottom rows), a
// left/right-wall gate is a VERTICAL pair (see BRIDGE_MAP's "H"/"H" stacked
// in column 0) — added when rooms started putting doors on side walls (see
// the ROOMS comment) instead of only ever the top. `axis` says which way
// blitTile's `squeeze` should shrink the tile when the gate is open; `side`
// says which half of the pair THIS cell is, so it shrinks away from its
// partner instead of both cells shrinking toward the same corner.
function gateOrientation(c, r) {
  const isGate = (ch) => ch === "G" || ch === "H";
  if (c > 0 && isGate(MAP[r][c - 1])) return { axis: "x", side: "right" };
  if (c < COLS - 1 && isGate(MAP[r][c + 1])) return { axis: "x", side: "left" };
  if (r > 0 && isGate(MAP[r - 1][c])) return { axis: "y", side: "bottom" };
  return { axis: "y", side: "top" };
}

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
    } else if (ch === "4") {
      blitTile(TILE_CRATE, c, r, flipX, false);
    } else if (ch === "G" || ch === "H") {
      // The gate is drawn art now, not a red/green tint over the floor. Shut,
      // it's a chained scrap-pipe panel filling the doorway; cleared, the two
      // leaves swing back against their posts and the way out is open floor
      // you can see through — the state reads as the gate having MOVED, which
      // a colour swatch never did. 'H' is the room's BACK gate (see ROOMS
      // comment) — the way you already came from, so it's drawn permanently
      // open ('open' forced true) instead of reading isGateOpen().
      const open = ch === "H" ? true : gateOpen;
      const { axis, side } = gateOrientation(c, r);
      const flip = side === "right" || side === "bottom";
      blitTile(TILE_GATE, c, r, axis === "x" && flip, axis === "y" && flip, open ? 0.22 : 1, side, axis);
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
  if (ch === "G" || ch === "H") {
    const open = ch === "H" ? true : gateOpen;
    if (!open) {
      ctx.fillStyle = "#6b3418";
      for (let i = 0; i < 5; i++) ctx.fillRect(x + 2 + i * 6, y + 2, 3, TILE - 4);
      ctx.fillStyle = "#8c95a0";
      ctx.fillRect(x, y + 13, TILE, 3);
    } else {
      const { axis, side } = gateOrientation(c, r);
      ctx.fillStyle = "#6b3418";
      if (axis === "x") {
        ctx.fillRect(side === "right" ? x + TILE - 5 : x, y + 2, 5, TILE - 4);
      } else {
        ctx.fillRect(x + 2, side === "bottom" ? y + TILE - 5 : y, TILE - 4, 5);
      }
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
  } else if (ch === "4") {
    // scrap crate: same silhouette family as the drawn tile, so the fallback
    // level still has two kinds of obstacle rather than one repeated shape.
    ctx.fillStyle = "#5a5d66";
    ctx.fillRect(x + 4, y + 7, TILE - 8, TILE - 11);
    ctx.fillStyle = "#3d3f47";
    ctx.fillRect(x + 4, y + TILE - 8, TILE - 8, 4);
    ctx.fillStyle = "#9aa0a2";
    ctx.fillRect(x + 7, y + 10, TILE - 14, 3);
    ctx.fillStyle = "#14121a";
    ctx.strokeRect(x + 4, y + 7, TILE - 8, TILE - 11);
  } else if (cellHash(c * 13 + 2, r * 17 + 9) > 0.92) {
    // Scrap litter, matching the shipped tiles: chips of metal ON the asphalt,
    // never a dark blob (which reads as a hole in the floor).
    ctx.fillStyle = "#5a5d66";
    ctx.fillRect(x + 9, y + 14, 4, 2);
    ctx.fillRect(x + 20, y + 21, 3, 2);
    ctx.fillStyle = "#7b8184";
    ctx.fillRect(x + 14, y + 9, 2, 2);
  }
}

// Puzzle switch/pressure plate, drawn procedurally rather than as a
// generated tile: it's a gameplay marker sitting ON the floor (like the
// slash arc or the HUD hearts elsewhere in this file), not a piece of level
// scenery, so it doesn't belong in tiles.png or its `environmentPalette`
// generation pass — but it's still built FROM that palette so it reads as
// part of the same junkyard rather than a UI element floating over it.
// `label` (a 1-based order number) and `isNext` are only ever passed for
// "sequence" rooms (see the render() call site) — a "switches" room's
// plates stay unlabelled since any order is fine. `isNext` gets a warm
// pulse so the room is always telling you which plate to find next instead
// of leaving order-enforcement as an invisible rule you find by trial and
// error, which is exactly the kind of thing that reads as "annoying".
function drawSwitchPlate(c, r, active, label, isNext) {
  const x = c * TILE, y = r * TILE;
  const pulse = isNext ? 0.65 + Math.sin(performance.now() / 220) * 0.2 : 1;
  ctx.fillStyle = active ? "#5c7238" : isNext ? "#8a6a2e" : "#5a5d66";
  ctx.globalAlpha = pulse;
  ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = active ? "#3a4a2a" : isNext ? "#e8b03a" : "#2f3038";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
  ctx.fillStyle = active ? "#c3c6c2" : "#7b8184";
  ctx.fillRect(x + 11, y + 11, TILE - 22, TILE - 22);
  if (label) {
    ctx.fillStyle = "#14121a";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(label), x + TILE / 2, y + TILE / 2 + 1);
  }
}

// The Junk Bridge puzzle's pushable crate: same silhouette as the static
// scrap-crate tile ('4') so it visually reads as "a crate" the instant it
// appears, just drawn at its own live pixel position instead of a fixed
// cell — it moves, the wall-mounted one never does.
function drawCrate(cr) {
  const x = cr.x - TILE / 2, y = cr.y - TILE / 2;
  if (TILES[TILE_CRATE] && TILES[TILE_CRATE].ready) {
    ctx.drawImage(TILES[TILE_CRATE].img, x, y, TILE, TILE);
    return;
  }
  ctx.fillStyle = "#5a5d66";
  ctx.fillRect(x + 4, y + 7, TILE - 8, TILE - 11);
  ctx.fillStyle = "#3d3f47";
  ctx.fillRect(x + 4, y + TILE - 8, TILE - 8, 4);
  ctx.fillStyle = "#9aa0a2";
  ctx.fillRect(x + 7, y + 10, TILE - 14, 3);
  ctx.fillStyle = "#14121a";
  ctx.strokeRect(x + 4, y + 7, TILE - 8, TILE - 11);
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

// Drone canvas fallback: a floating tin-can body (no legs, per art-style.json
// — it never touches the ground even in the drawn-in-code version) with one
// glowing lens that flares white/red on hit, same damage-tell convention as
// every other fallback here.
function drawDroneFallback(x, y, facing, hitFlash, squashX, squashY, step, attacking) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale((facing === "left" ? -1 : 1) * squashX, squashY);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, 11, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5a5d66";
  ctx.beginPath();
  ctx.ellipse(0, -1, 10, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // bent antennae, tilted opposite ways for a slight "hover jitter" read.
  ctx.strokeStyle = "#3d434f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-4, -8); ctx.lineTo(-7 + (step ? 1 : 0), -15);
  ctx.moveTo(4, -8); ctx.lineTo(7 - (step ? 1 : 0), -15);
  ctx.stroke();
  ctx.fillStyle = attacking ? "#ffffff" : hitFlash > HIT_FLASH_TIME * 0.85 ? "#ffffff"
    : hitFlash > 0 ? "#e02a2a" : "#e8306f";
  ctx.beginPath();
  ctx.ellipse(2, -1, 5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Brute canvas fallback: bigger and lower than the rat, welded scrap plate
// across the back, jutting tusks — same silhouette language as
// drawRatFallback (ground shadow, hit-flash body, legs swap on `step`) just
// scaled up and darker, so a missing sheet still reads as "the big one".
function drawBruteFallback(x, y, facing, hitFlash, squashX, squashY, step, attacking) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale((facing === "left" ? -1 : 1) * squashX, squashY);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 15, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2e2418";
  ctx.fillRect(step ? -12 : -6, 9, 6, 7);
  ctx.fillRect(step ? 6 : 12, 9, 6, 7);
  ctx.fillStyle = hitFlash > HIT_FLASH_TIME * 0.85 ? "#ffffff"
    : hitFlash > 0 ? "#e02a2a" : "#4e2e15";
  ctx.beginPath();
  ctx.ellipse(0, 2, 17, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  // welded scrap plate across the back.
  ctx.fillStyle = "#5a5d66";
  ctx.fillRect(-11, -8, 22, 9);
  ctx.fillStyle = "#8c95a0";
  ctx.fillRect(-9, -6, 6, 3);
  ctx.fillRect(2, -6, 6, 3);
  if (attacking) {
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(-13, -4, 9, 8);
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(-13, -4, 3, 3);
    ctx.fillRect(-13, 1, 3, 3);
  } else if (facing !== "up") {
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(-9, -2, 2, 2);
    ctx.fillRect(6, -2, 2, 2);
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
  const gateOpen = isGateOpen();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) drawTile(c, r, MAP[r][c], gateOpen);
  }

  // Per-zone colour wash: the same tile art recoloured per zone (a
  // `multiply` fill over the whole board), same trick as a Zelda dungeon
  // reusing its overworld tileset in a different light — cheap, and it's
  // the difference between "nine rooms of identical grey asphalt" and
  // being able to tell which third of the chapter you're in at a glance.
  // See ROOMS below for which zone gets which tint; the original three
  // rooms are left untinted (home turf, unchanged from before this pass).
  const zoneTint = ROOMS[state.roomIndex].tint;
  if (zoneTint) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = zoneTint.alpha;
    ctx.fillStyle = zoneTint.color;
    ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
    ctx.restore();
  }

  // Puzzle markers, drawn on top of the floor and under everything that
  // stands on it (crates, characters) — see drawSwitchPlate. Each switch
  // lights up independently once stepped on ("switches"/"sequence" rooms);
  // the Junk Bridge room has exactly one, lit while a crate currently rests
  // on it (not permanently, so pushing the crate back off it re-locks the
  // gate). "sequence" rooms additionally get a 1-based number per plate and
  // a pulse on whichever one is next, off `room.switchTiles`' own order —
  // the same order update()'s switch-detection code enforces, so the plate
  // that glows is always the one that's actually next, never out of sync.
  const room = ROOMS[state.roomIndex];
  const isSequence = room.type === "sequence";
  room.switchTiles.forEach((s, i) => {
    const active = room.type === "push"
      ? state.crates.some((cr) => Math.floor(cr.x / TILE) === s.c && Math.floor(cr.y / TILE) === s.r)
      : state.switchesHit.has(s.r * COLS + s.c);
    drawSwitchPlate(s.c, s.r, active, isSequence ? i + 1 : null, isSequence && !active && i === state.switchesHit.size);
  });
  for (const cr of state.crates) drawCrate(cr);

  for (const en of state.enemies) {
    if (!en.alive) continue;
    let scaleX = 1, scaleY = 1;
    const lunging = en.atkState === "lunge";
    const firing = en.atkState === "fire";
    // "recover" (Brute only, after a charge) deliberately falls through to
    // the plain idle pose/scale below — dazed and still is the point, see
    // the ENEMY_KINDS/update() comments on `attackKind: "charge"`.
    if (en.atkState === "windup") {
      // coil up before attacking — a longer, deeper coil for a Brute's
      // charge than a Rat's pounce, since `atkDuration` is already its own
      // per-kind `windupTime` (see ENEMY_KINDS), so this needs no branch.
      const t = 1 - en.atkTimer / (en.atkDuration || 1);
      scaleX = 1 + t * 0.18;
      scaleY = 1 - t * 0.22;
    } else if (lunging) {
      // stretched out mid-pounce/charge, direction-of-travel dependent.
      const horiz = Math.abs(en.lungeDx) >= Math.abs(en.lungeDy);
      scaleX = horiz ? 1.3 : 0.9;
      scaleY = horiz ? 0.85 : 1.3;
    } else if (firing) {
      // small recoil kick opposite the shot, direction-of-travel dependent
      // — sells the shot without a physical lunge, since a Drone never
      // actually closes the distance for "ranged".
      const horiz = Math.abs(en.lungeDx) >= Math.abs(en.lungeDy);
      scaleX = horiz ? 0.88 : 1.06;
      scaleY = horiz ? 1.06 : 0.88;
    }
    // the pounce/charge/shot swaps to a real drawn attack pose instead of
    // just stretching the idle art, so it reads as an actual attack
    // animation rather than a squashed walk frame. Getting hit: flat white
    // on impact decaying to red (see drawAnimatedSprite), plus a recoil
    // squash, so damage is unmistakable.
    const flash = Math.max(0, en.hitFlash) / HIT_FLASH_TIME;
    if (flash > 0) {
      scaleX *= 1 + flash * 0.16;
      scaleY *= 1 - flash * 0.12;
    }
    const kind = ENEMY_KINDS[en.type] || ENEMY_KINDS.rat;
    const attackPose = lunging || firing;
    drawAnimatedSprite(attackPose ? kind.attackSpriteFor : kind.spriteFor, en.facing, en.x, en.y - 6, SPRITE_CELL,
      { moving: en.moving && !attackPose, phase: en.animPhase, scaleX, scaleY, flash },
      (x, y, facing, sx, sy, step) => kind.fallback(x, y, facing, en.hitFlash, sx, sy, step, attackPose));
  }

  // Scrap Drone bolts — a small glowing core (the drone's own lens colour,
  // so a shot reads as "part of the same thing that fired it") with a short
  // motion-blur tail drawn back along its own direction of travel, so a
  // fast-moving 8px square doesn't just read as a blinking dot.
  for (const pr of state.projectiles) {
    ctx.save();
    ctx.strokeStyle = "#e8306f";
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pr.x, pr.y);
    ctx.lineTo(pr.x - pr.dx * 14, pr.y - pr.dy * 14);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, 4, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
  enemyCountEl.textContent = left > 0 ? `${left} left` : (isGateOpen() ? "Gate open!" : puzzleStatus());
  const room = ROOMS[state.roomIndex];
  hudTitleEl.textContent = `Chapter 1 · ${room.name} (${state.roomIndex + 1}/${ROOMS.length})`;
}

// What to tell the player still stands between them and the open gate, once
// the enemies are down — the puzzle rooms don't open just because the last
// rat did, and without this the gate looking locked with "Gate open!" still
// showing 0 enemies left read as broken rather than as a puzzle.
function puzzleStatus() {
  const room = ROOMS[state.roomIndex];
  if (room.type === "push") return "Push the crate onto the switch";
  if (room.type === "switches") return `Switches ${state.switchesHit.size}/${room.switchTiles.length}`;
  if (room.type === "sequence") return `Hit switch ${Math.min(state.switchesHit.size + 1, room.switchTiles.length)} of ${room.switchTiles.length}`;
  return "Gate open!";
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

// "Play Again" on the chapter-complete overlay: starts the whole chapter
// over from room 1. Skips the cutscene (introActive stays false) — they've
// just read it once already this session.
function resetChapter() {
  state = freshState();
  introActive = false;
  winOverlay.hidden = true;
  loseOverlay.hidden = true;
  keys.clear();
  touchDirs.clear();
  lastHudHp = null;
  heartsEl.classList.remove("hit");
}

winRetryBtn.addEventListener("click", resetChapter);
// "Try Again" on death: retries only the room Beverly died in (resetRoom,
// defined alongside freshState/transitionToRoom above), not the whole
// chapter — dying in the Back Gate room shouldn't cost the alley and the
// bridge again.
loseRetryBtn.addEventListener("click", () => {
  keys.clear();
  touchDirs.clear();
  heartsEl.classList.remove("hit");
  resetRoom();
});

requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });
