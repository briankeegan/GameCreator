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
//
// 2026-09-07 (room-shape pass) — every one of the 15 maps below used to be
// the exact same COLSxROWS RECTANGLE, boundary '2' running an unbroken line
// round all four edges, with only the INTERIOR obstacles rearranged from
// room to room. That's what "the rooms all look the same" was actually
// about: an obstacle course redecorated inside an identical box reads as
// one room, however the tyre piles are arranged inside it, because the box
// itself never changes — and a real building doesn't hand you fifteen
// identically-proportioned rectangular boxes in a row; corners get bitten
// off by other structures, hallways narrow into chokepoints, yards get an
// L cut out of them by whatever's next door. Every map now has extra '2'
// cells carved OUT of a corner or a wall as well as the ones piled INTO the
// middle — a chamfered corner, a bitten-off bay, a pinched waist — so the
// FOOTPRINT differs room to room, not just what's standing on it. Each
// shape is still deliberately its own: no two rooms share the same
// carve (Bridge and Foundry, the zone's two push rooms, are even mirrored
// diagonals of each other on purpose, so the one pair that had to stay
// mechanically conservative still doesn't read as identical). Verified with
// a BFS over each room's own grid (SOLID cells blocking, everything else
// open) confirming spawn/back-spawn can still reach every gate, switch,
// crate and enemy spawn the room has — a carved corner that quietly walls
// off a switch would be a worse bug than the sameness this fixes — and
// `check_room_exits.mjs` (the same gate that runs in CI) still passes.
//
// Each room also carries a `blurb`: one line of environmental narration
// shown under its name in the room-toast on entry (see showRoomToast in
// app.js). This is the "sense of a story as you go" half of the same
// complaint — the chapter already renames itself zone to zone (Scrapyard ->
// Rail Yard -> Rust Quarter -> Town) but never SAID anything about where
// you were or where you were headed, so three zone tints in a row still
// read as unexplained lighting changes. The blurbs are short, ordered, and
// aimed at Town the whole way: a padlocked yard, a service line, a signal
// tower with a dead light, a cooling smelter, streetlights at the last
// gate — read start to finish they're a one-sentence-per-room walk out of
// the junkyard, not fifteen unrelated captions.
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
  // "push" puzzle's target plate (walkable floor, drawn with a marker on top;
  // see drawSwitchPlate — lit only while a crate rests on it), 'K' a "vault"
  // puzzle's key start point (walkable floor; turned into state.keyPickup at
  // room load exactly like a "guard" room's enemy-dropped key, see
  // buildRoomState and update()'s pickup check — collect it, then reach the
  // gate, same as guard).
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
    "222..........222",
    "22.34.......4322",
    "2..............2",
    "2....43....34..2",
    "2..............2",
    "2..4......3....2",
    "2..............2",
    "2....3443......2",
    "222..........222",
    "22.....P......22",
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
    "222..........222",
    "224..4....4..422",
    "2..............2",
    "2....3....3....2",
    "2222..........BG",
    "2222.3....3....G",
    "2..............2",
    "2.4..4....4..4.2",
    "2..............2",
    "2......P.......2",
    "2222222HH2222222",
  ];
  // 2026-08-22 (puzzle pass) — Bridge USED TO be one crate, two rows below
  // its one switch: push up twice and done, no thought required, which is
  // why solving it read as "the same trivial nudge" rather than a puzzle at
  // all. Now TWO crates must BOTH be resting on TWO switches at once (see
  // isGateOpen's `every`, not `some`) and they don't take the same push:
  // the row-6 crate still goes north onto its switch like before, but the
  // row-8 crate must be pushed WEST three tiles onto its own switch — two
  // genuinely different pushes in the same room, not one puzzle doubled.
  const BRIDGE_MAP = [
    "2222222GG2222222",
    "222....B.......2",
    "22..4......4...2",
    "2..............2",
    "2......S.......2",
    "HP.............2",
    "H......X...3...2",
    "2..............2",
    "2..3..S..X.....2",
    "2............222",
    "2.............22",
    "2222222222222222",
  ];
  // Junk Courtyard: a straight fight (no switch hunt — see the ROOMS comment
  // on puzzle variety) between the Bridge's push puzzle and the Back Gate's
  // switch hunt, so those two puzzle rooms aren't back to back.
  const COURTYARD_MAP = [
    "2222222222222222",
    "2............222",
    "2....3....3..222",
    "2.............22",
    "2.4............2",
    "GB.............2",
    "G..............2",
    "222............2",
    "222..3....3....2",
    "22.............2",
    "2......P.......2",
    "2222222HH2222222",
  ];
  // 2026-09-07 (puzzle overhaul) — was "switches" (find 3 loose plates, any
  // order); now "push", Back Gate's own vertical pair rather than a copy of
  // Bridge/Foundry's: one crate straight north 2 tiles, the other straight
  // south 3 — opposite directions on the SAME axis, so the room still reads
  // differently from Bridge (north+west) and Foundry (L-push+west).
  const GATEROOM_MAP = [
    "2222222GG2222222",
    "222....B.....222",
    "22.3........4.22",
    "2..............2",
    "2....S.........2",
    "2.............PH",
    "2....X.....X...H",
    "2..............2",
    "2..............2",
    "2..........S...2",
    "2..............2",
    "2222222222222222",
  ];
  // ---- Rail Yard zone (rooms 6-10): introduces the Scrap Drone. ----
  const RAIL_ENTRANCE_MAP = [
    "2222222GG2222222",
    "2......B.....222",
    "2..3........3.22",
    "2..............2",
    "2....4....4....2",
    "2..............2",
    "2.3..........3.2",
    "2..............2",
    "2....4....4....2",
    "222............2",
    "22.....P.......2",
    "2222222HH2222222",
  ];
  // Signal Tower: a second clear room in the Rail Yard, mixed drone/rat.
  const SIGNAL_TOWER_MAP = [
    "2222222222222222",
    "222............2",
    "22.3........3..2",
    "2..............2",
    "2.......4......2",
    "2...........22BG",
    "2..3........32.G",
    "2..............2",
    "2.......4......2",
    "222............2",
    "22.....P.......2",
    "2222222HH2222222",
  ];
  const RAIL_OVERPASS_MAP = [
    "2222222GG2222222",
    "2......B.....222",
    "2.4...........22",
    "2..............2",
    "2..3........3..2",
    "HP.............2",
    "H..............2",
    "2....4.........2",
    "2............222",
    "2............422",
    "2.............22",
    "2222222222222222",
  ];
  // Rail Switchyard: a "guard" room (see the puzzle-variety note above the
  // ROOMS list) between the Overpass push puzzle and the Drone Nest's own
  // push puzzle — one drone here carries the key, not a plate anywhere.
  const SWITCHYARD_MAP = [
    "2222222222222222",
    "222....22....222",
    "22............22",
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
  // 2026-09-07 (puzzle overhaul) — was "sequence" (3 numbered plates, hit in
  // order); now "push", but its own pair forces a real order through
  // GEOMETRY instead of a painted number: a solid wall runs down column 8
  // with exactly one gap (row 6), and crate A starts sitting IN that gap —
  // a real, verified fact about the room, not a suggestion (flood-filled
  // from the spawn with both crates treated as fixed obstacles: the whole
  // left half, crate B included, comes back UNREACHABLE until crate A is
  // pushed clear). Push crate A west through the gap onto its plate first,
  // which incidentally opens the only way into the left half, THEN cross
  // over and push crate B south onto its own. "Do this before that" as
  // level geometry, not a UI telling you the order.
  const DRONE_NEST_MAP = [
    "2222222GG2222222",
    "2......B2.....22",
    "22......2......2",
    "2..X....2......2",
    "2.......2..33..2",
    "2.......2.....PH",
    "2...S...X......H",
    "2.......2..44..2",
    "2..S....2......2",
    "2.......2......2",
    "2.......2......2",
    "2222222222222222",
  ];
  // ---- Rust Quarter zone (rooms 11-15): introduces the Junk Brute. ----
  const RUST_GATE_MAP = [
    "2222222GG2222222",
    "222....B.....222",
    "22............22",
    "2...44....44...2",
    "2..............2",
    "22.............2",
    "22.............2",
    "2...44....44...2",
    "2..............2",
    "222..........222",
    "22.....P......22",
    "2222222HH2222222",
  ];
  // Slag Pit: a second clear room, first place the Brute shares a room with
  // the Foundry's push puzzle instead of standing alone in an open yard.
  const SLAG_PIT_MAP = [
    "2222222222222222",
    "22.............2",
    "22.............2",
    "2..44....44..222",
    "2..............2",
    "2......33.....BG",
    "2..............G",
    "2..44....44....2",
    "2............222",
    "22.............2",
    "22.....P.......2",
    "2222222HH2222222",
  ];
  // Foundry's original crate/switch pair (row7 col5 -> row4 col7) was
  // already an L-shaped push (right, then up) rather than a straight line,
  // so it stays as-is; a second, independent crate/switch pair is added on
  // row9 needing a straight push WEST instead, so Foundry asks for an
  // L-push AND a straight push in the same room rather than repeating
  // Bridge's own pair of pushes.
  const FOUNDRY_MAP = [
    "2222222GG2222222",
    "2......B.....222",
    "2..4........4.22",
    "2..............2",
    "2......S.......2",
    "HP.............2",
    "H..3........3..2",
    "2.....X........2",
    "2..............2",
    "22.4.S..X...4..2",
    "22.............2",
    "2222222222222222",
  ];
  // 2026-09-07 (puzzle overhaul) — was "sequence" (3 numbered plates);
  // now "vault" (NEW mechanic, see the ROOMS comment): a key sits at the
  // dead end of a short 1-wide alcove (cols 10-12, row 4, walled top and
  // bottom, closed at col 13) reachable only through its col-9 mouth. The
  // crate barricading that mouth sits in the OPEN room, not the alcove, so
  // it can be shoved clear north, south or west — the puzzle is "get the
  // obstacle out of your path", not "put it on a target", the opposite
  // verb from every "push" room despite using the same crate object.
  const SMELTER_MAP = [
    "2222222222222222",
    "2.............22",
    "2...4....4....22",
    "2.........222..2",
    "2........X..K2.2",
    "GB........222..2",
    "G........4.....2",
    "2..............2",
    "23.............2",
    "2..............2",
    "2......P.......2",
    "2222222HH2222222",
  ];
  // 2026-09-07 (puzzle overhaul) — was "switches" (find 3 loose plates);
  // now "vault" (see the ROOMS comment), same idea as Smelter's but built
  // VERTICAL where Smelter's was horizontal so the chapter's two vault
  // rooms don't share a silhouette any more than Bridge and Foundry's two
  // push rooms do: a 3-tall dead-end shaft (col 9, rows 5-7, walled either
  // side) with the key at its top, mouth at the bottom guarded by a crate
  // sitting in the open floor below rather than in the shaft itself.
  const TOWN_GATE_MAP = [
    "2222222GG2222222",
    "2......B.......2",
    "2...3......3...2",
    "222..........222",
    "2........2.....2",
    "2.......2K2...PH",
    "2.......2.2....H",
    "2.......2.2....2",
    "2.3......X..3..2",
    "222..........222",
    "22............22",
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
  // three different puzzles.
  //
  // 2026-08-22 (puzzle pass) — even after that split into four mechanics,
  // "push" was still trivial (one crate, two tiles, one direction) and
  // "switches"/"sequence" were both still fundamentally "walk onto the
  // marked floor tile" underneath, which is why the complaint came back:
  // more VARIANTS of the same verb still reads as repeated. This pass (a)
  // makes both "push" rooms genuinely harder — TWO crates on TWO switches
  // AT ONCE (isGateOpen uses `every`, not `some`), each needing a different
  // push direction, not the same nudge twice — and (b) adds a FIFTH
  // mechanic, "guard", that isn't plate-stepping at all: a specific marked
  // enemy carries a key, and the gate needs that enemy dead and its key
  // physically picked up, same as clearing the room but with one intent
  // ("find and take out THAT one") instead of none. Five mechanics across
  // 8 of 15 rooms now, no two adjacent puzzle rooms sharing one:
  //   - "push"     Bridge, Foundry (2 rooms) — TWO crates onto TWO plates.
  //   - "switches" Back Gate, Town Gate (2 rooms) — find 3 plates, any order;
  //                kept ONLY for these two zone-ending gates so the "you must
  //                search the room" beat still exists, just not six times.
  //   - "sequence" Drone Nest, Smelter (2 rooms) — the same 3-plate idea,
  //                but numbered and order-enforced (see drawSwitchPlate/
  //                isGateOpen/puzzleStatus) — a real step up in what the
  //                puzzle is asking, not a reskin of "switches".
  //   - "guard"    Scrap Catwalk, Rail Switchyard (2 rooms) — NEW: kill the
  //                marked enemy, collect the key it drops, THEN the room's
  //                a normal "clear" gate (see isGateOpen/render/update's
  //                key-drop section in app.js). No plate anywhere in it.
  //   - "clear"    the other 7 rooms — straight fights, still the default
  //                so a puzzle is a change of pace, not wall-to-wall.
  //
  // 2026-09-07 (puzzle overhaul — feedback: "all of the puzzles are pretty
  // much just dumb... but I don't mind the one where you move a block...
  // the one where you count 1-2-3 is just dumb") — "switches" and
  // "sequence" are DELETED, not retextured a third time: stripped of the
  // floor-pattern dressing, both were always "walk onto N marked tiles" —
  // find-any-order or memorise-a-number is a difference of degree, not of
  // kind, so no amount of reskinning was ever going to stop the numbered
  // one reading as "counting to three". Per the request, went and looked at
  // how top-down action-adventures actually build puzzle rooms: it's
  // almost always Sokoban-style block-pushing (this is what ALTTP's own
  // puzzle rooms are) — which happens to be the one mechanic already here
  // that WASN'T the complaint. So rather than invent a sixth step-on-a-tile
  // variant, every room that lost "switches"/"sequence" became one of:
  //   - "push"  Bridge, Foundry (unchanged) PLUS Back Gate and Drone Nest
  //             (converted): two crates, two different push directions,
  //             same rule as before (isGateOpen's `every`, both crates on
  //             both plates at once). Drone Nest's pair goes further — its
  //             two crate/switch pairs sit on OPPOSITE sides of a wall with
  //             exactly one gap, and the FIRST crate starts sitting IN that
  //             gap, physically blocking the second crate's half of the
  //             room until it's pushed clear (verified with a standalone
  //             flood-fill: the second crate's side is provably
  //             UNREACHABLE before the first crate moves — see this file's
  //             own dev notes). That's the "do this before that" beat the
  //             numbered plates were reaching for, done as a real spatial
  //             fact about the room instead of a number painted on the
  //             floor.
  //   - "vault" Smelter, Town Gate (NEW, replacing "switches"): a key sits
  //             ('K' tile) at the dead end of a short walled-in alcove; a
  //             crate barricades the only mouth into it, sitting in the
  //             OPEN room rather than the alcove itself so it can be shoved
  //             clear in any of several directions, not placed on a target
  //             — the opposite verb from "push" (get an obstacle OUT of
  //             your way, instead of ONTO a spot) despite reusing the same
  //             crate object and the same "guard" key-pickup plumbing
  //             (isGateOpen/update() treat "guard" and "vault" identically
  //             once a key exists — they only differ in how the key gets
  //             there). Town Gate's is the vertical version of Smelter's
  //             horizontal one, so the chapter's two vault rooms don't
  //             share a silhouette any more than its two push rooms do.
  //   - "guard"/"clear" unchanged.
  // Five mechanics is now four ("switches"/"sequence" collapsed to nothing,
  // "vault" added), still across 8 of 15 rooms, still no two adjacent
  // puzzle rooms sharing one: push (Bridge, Foundry, Back Gate, Drone
  // Nest), vault (Smelter, Town Gate), guard (Catwalk, Switchyard).
  const ROOMS = [
    {
      id: "alley",
      name: "Scrapyard Alley",
      blurb: "Chain-link rattles behind you — the yard opens up ahead.",
      map: ALLEY_MAP,
      type: "clear",
      enemySpawns: [{ c: 4, r: 1, type: "rat" }, { c: 12, r: 3, type: "rat" }, { c: 10, r: 8, type: "rat" }],
    },
    {
      id: "catwalk",
      name: "Scrap Catwalk",
      blurb: "A sagging plank walkway, the only dry path through the scrap.",
      map: CATWALK_MAP,
      // "guard" (NEW, see the puzzle-variety note above the ROOMS list):
      // one marked rat (a pulsing gold ring, see render()) carries the key
      // — kill it, walk over the key it drops, gate opens once you're
      // holding it AND every rat is down. Not a plate to find, a specific
      // target to pick out of a fight.
      type: "guard",
      enemySpawns: [
        { c: 5, r: 3, type: "rat", carriesKey: true },
        { c: 10, r: 3, type: "rat" },
        { c: 7, r: 7, type: "rat" },
        { c: 3, r: 9, type: "rat" },
      ],
    },
    {
      id: "bridge",
      name: "Junk Bridge",
      blurb: "Runoff drips through the grating underfoot.",
      map: BRIDGE_MAP,
      type: "push", // gate opens once BOTH crates rest on their own switch AND enemies are cleared
      enemySpawns: [{ c: 3, r: 2, type: "rat" }, { c: 12, r: 8, type: "rat" }],
    },
    {
      id: "courtyard",
      name: "Junk Courtyard",
      blurb: "Stacked axles and oil drums — someone used to work here.",
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
      blurb: "The back gate hums with a rail line somewhere beyond it.",
      map: GATEROOM_MAP,
      // Was "switches" (find 3 loose plates); now its own "push" pair —
      // one crate straight north 2 tiles, the other straight south 3 —
      // see the 2026-09-07 comment above GATEROOM_MAP.
      type: "push", // gate opens once every switch tile has its own crate on it AND enemies are cleared
      enemySpawns: [{ c: 7, r: 2, type: "rat" }, { c: 3, r: 6, type: "rat" }, { c: 12, r: 6, type: "rat" }],
    },
    {
      id: "railEntrance",
      name: "Rail Yard Entrance",
      blurb: "Gravel crunches underfoot — the rail yard swallows the scrapyard's noise.",
      map: RAIL_ENTRANCE_MAP,
      type: "clear",
      tint: TINT_RAIL,
      enemySpawns: [{ c: 4, r: 3, type: "drone" }, { c: 11, r: 3, type: "drone" }, { c: 7, r: 6, type: "rat" }],
    },
    {
      id: "signalTower",
      name: "Signal Tower",
      blurb: "A dead signal light creaks on its post overhead.",
      map: SIGNAL_TOWER_MAP,
      type: "clear",
      tint: TINT_RAIL,
      enemySpawns: [{ c: 3, r: 3, type: "drone" }, { c: 12, r: 3, type: "drone" }, { c: 7, r: 9, type: "rat" }],
    },
    {
      id: "railOverpass",
      name: "Rail Overpass",
      blurb: "Track ties stacked like teeth along the overpass.",
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
      blurb: "Rust-frozen switches point nowhere in particular anymore.",
      map: SWITCHYARD_MAP,
      // "guard" again (see Catwalk), Rail Yard's own copy of the mechanic —
      // a controller drone is the one holding the key this time, not a rat,
      // so the target actually fits the room it's in.
      type: "guard",
      tint: TINT_RAIL,
      enemySpawns: [
        { c: 4, r: 3, type: "drone", carriesKey: true },
        { c: 11, r: 3, type: "drone" },
        { c: 7, r: 8, type: "drone" },
      ],
    },
    {
      id: "droneNest",
      name: "Drone Nest",
      blurb: "Wires nest here — whatever built this is still listening.",
      map: DRONE_NEST_MAP,
      // Was "sequence" (3 numbered plates); now "push", but with a real
      // forced order — one crate starts wedged in the room's only wall
      // gap and has to be cleared before the other half (and its own
      // crate) is even reachable. See the 2026-09-07 comment above
      // DRONE_NEST_MAP for how that's verified, not just asserted.
      type: "push",
      tint: TINT_RAIL,
      enemySpawns: [{ c: 5, r: 3, type: "drone" }, { c: 10, r: 3, type: "drone" }, { c: 7, r: 6, type: "drone" }],
    },
    {
      id: "rustGate",
      name: "Rust Quarter Gate",
      blurb: "The air turns hot and orange past this gate.",
      map: RUST_GATE_MAP,
      type: "clear",
      tint: TINT_RUST,
      enemySpawns: [{ c: 7, r: 5, type: "brute" }, { c: 3, r: 2, type: "rat" }, { c: 12, r: 9, type: "rat" }],
    },
    {
      id: "slagPit",
      name: "Slag Pit",
      blurb: "Slag glass crunches underfoot like frost that never melted.",
      map: SLAG_PIT_MAP,
      type: "clear",
      tint: TINT_RUST,
      enemySpawns: [{ c: 7, r: 4, type: "brute" }, { c: 3, r: 2, type: "rat" }, { c: 12, r: 8, type: "rat" }],
    },
    {
      id: "foundry",
      name: "Scrap Foundry",
      blurb: "Cold furnaces now, but the smell of ash still lingers.",
      map: FOUNDRY_MAP,
      type: "push",
      tint: TINT_RUST,
      enemySpawns: [{ c: 7, r: 5, type: "brute" }, { c: 3, r: 8, type: "rat" }],
    },
    {
      id: "smelter",
      name: "Smelter",
      blurb: "The smelter's shell still ticks as it cools.",
      map: SMELTER_MAP,
      // Was "sequence"; now "vault" (NEW mechanic, see the ROOMS comment) —
      // a key behind a crate barricade instead of a third numbered plate.
      type: "vault",
      tint: TINT_RUST,
      enemySpawns: [{ c: 7, r: 6, type: "brute" }, { c: 3, r: 4, type: "drone" }, { c: 12, r: 4, type: "drone" }],
    },
    {
      id: "townGate",
      name: "Town Gate",
      blurb: "Past the gate, streetlights — Town, finally, in view.",
      map: TOWN_GATE_MAP,
      // Was "switches"; now "vault", the chapter's other one (Smelter's is
      // horizontal, this one's vertical — see the 2026-09-07 comment above
      // TOWN_GATE_MAP) — the finale gate's puzzle is a crate-clearing job
      // fought over with the room's four enemies, not a plate hunt.
      type: "vault",
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
