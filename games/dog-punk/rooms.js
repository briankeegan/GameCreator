// Dog Punk's LEVEL DATA — the tile maps, the gate/spawn cells, each room's win
// condition and its zone tint. Deliberately its own file with no DOM in it, so
// it can be read by a tool WITHOUT running the game: see
// docs/DOOR_STANDARD.md §8. `.github/scripts/check_room_exits.mjs` evaluates
// this file to check every room's gate and spawn on each push, and it could
// not do that while the maps lived in app.js beside `document.getElementById`.
//
// Behaviour — what a gate DOES, when it opens, how a puzzle is solved — stays
// in app.js. This file is the level, not the rules.
//
// Wrapped in an IIFE, the same as Newsey's story.js: these are plain <script>
// tags sharing one global scope, so a top-level `const ROOMS` here collides
// with app.js's and the page dies on "Identifier 'ROOMS' has already been
// declared". Nothing escapes except window.DOGPUNK_ROOMS.
(function () {
  "use strict";

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

  // The tints are exported as well as the maps because app.js compares them by
  // IDENTITY (`room.tint === TINT_RAIL` picks a zone's tileset) — a second copy
  // of the same object literal would silently never match.
  window.DOGPUNK_ROOMS = {
    TILE: TILE, COLS: COLS, ROWS: ROWS, SOLID: SOLID, ROOMS: ROOMS,
    TINT_RAIL: TINT_RAIL, TINT_RUST: TINT_RUST,
  };
})();
