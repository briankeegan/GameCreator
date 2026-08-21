// Dog Punk's LEVEL DATA — the tile maps, the gate/spawn cells and each room's
// win condition. Deliberately its own file with no DOM in it, so it can be
// read by a tool without running the game: see docs/DOOR_STANDARD.md §8.
// `.github/scripts/check_room_exits.mjs` evaluates this file to check the
// gate/spawn pairing on every push, and it could not do that while the maps
// lived in app.js beside `document.getElementById`.
//
// Behaviour (what a gate DOES, when it opens) stays in app.js — this file is
// the level, not the rules.

// Wrapped in an IIFE, the same as story.js: these are plain <script> tags
// sharing one global scope, so a top-level `const ROOMS` here collides with
// app.js's and the page dies with "Identifier 'ROOMS' has already been
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
  // CHAPTER 1 is three of these rooms end to end (ROOMS below), not one. Every
  // room is the same COLSxROWS grid with its gate on the same top-centre two
  // cells and its spawn ('P') on the same bottom-centre cell as every other
  // room, on purpose — that's what "the levels fit together" means here: you
  // walk out the top of one and into the bottom of the next and the street
  // hasn't jumped sideways under you. Room 1 (unchanged from before) is a pure
  // fight; room 2 is a block-pushing puzzle (push the crate onto the switch);
  // room 3 is an exploration puzzle (find and stand on all three switches).
  // Clearing room 3's gate ends the chapter instead of loading a room 4.
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
  const BRIDGE_MAP = [
    "2222222GG2222222",
    "2..............2",
    "2...4......4...2",
    "2..............2",
    "2......S.......2",
    "2..............2",
    "2....X.....3...2",
    "2..............2",
    "2..3.......4...2",
    "2..............2",
    "2......P.......2",
    "2222222222222222",
  ];
  const GATEROOM_MAP = [
    "2222222GG2222222",
    "2..............2",
    "2..S........S..2",
    "2..............2",
    "2......4.......2",
    "2..............2",
    "2...3......3...2",
    "2..............2",
    "2.......S......2",
    "2..............2",
    "2......P.......2",
    "2222222222222222",
  ];

  const SOLID = new Set(["2", "3", "4"]);

  const ROOMS = [
    {
      id: "alley",
      name: "Scrapyard Alley",
      map: ALLEY_MAP,
      type: "clear",
      enemySpawns: [{ c: 4, r: 1 }, { c: 12, r: 3 }, { c: 10, r: 8 }],
    },
    {
      id: "bridge",
      name: "Junk Bridge",
      map: BRIDGE_MAP,
      type: "push", // gate opens once a crate rests on a switch tile AND enemies are cleared
      enemySpawns: [{ c: 3, r: 2 }, { c: 12, r: 8 }],
    },
    {
      id: "gate",
      name: "Back Gate",
      map: GATEROOM_MAP,
      type: "switches", // gate opens once every switch tile has been stepped on AND enemies are cleared
      enemySpawns: [{ c: 7, r: 2 }, { c: 3, r: 6 }, { c: 12, r: 6 }],
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

  // Published as plain data (see the header): app.js destructures this, and so
  // does the door checker.
  window.DOGPUNK_ROOMS = { TILE: TILE, COLS: COLS, ROWS: ROWS, SOLID: SOLID, ROOMS: ROOMS };

})();
