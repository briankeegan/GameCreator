// levels.js — the ONLY place level content lives. The engine (engine.js)
// plays any level shaped like a LevelDef; adding Level 2, 3, etc. means
// appending to this array, never touching engine logic.
//
//   LevelDef = {
//     id: number,
//     name: string,
//     board: {type: "rect", cols, rows}   // Hoplite-style tall board, rows
//                                         // authored top (r=0) to bottom;
//                                         // hex (col,row) sits at axial
//                                         // q = col - floor(row/2), r = row
//       | omitted, with radius: number    // classic hexagon around (0,0)
//     playerStart: {q, r},
//     exit: {q, r},                       // Warp Gate, on the board's edge
//     outpost: {q, r} | null,             // Sector Outpost, on the edge
//     enemies: [{type, q, r}],
//     hazards: [{type, q, r}],            // e.g. {type: "blackhole", q, r}
//     exitRule: "all-enemies-dead",
//     actions: ["sublight", ...],         // unlocked actions; omit for all.
//                                         // Hoplite-tutorial style: sectors
//                                         // introduce one new action each.
//     intro: string,                      // log line shown on sector start
//   }
(function (root) {
  "use strict";

  const LEVELS = [
    // Sector 1 — Moving. No enemies: learn to fly, bottom to top.
    {
      id: 1,
      name: "Sublight Impulse",
      board: { type: "rect", cols: 6, rows: 11 },
      playerStart: { q: -3, r: 10 },
      exit: { q: 2, r: 0 },
      outpost: null,
      enemies: [],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight"],
      intro: "Sublight Impulse online. Tap an outlined hex to fly.",
    },
    // Sector 2 — Impulse Cannon. One Interceptor between you and the gate.
    {
      id: 2,
      name: "Shockwave",
      board: { type: "rect", cols: 6, rows: 11 },
      playerStart: { q: -3, r: 10 },
      exit: { q: 2, r: 0 },
      outpost: null,
      enemies: [{ type: "interceptor", q: 0, r: 5 }],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming"],
      intro: "Shockwave online. It auto-fires on any 👾 within 1 hex — in every direction — after you move.",
    },
    // Sector 3 — Tractor Beam. Two Interceptors; push one off the edge.
    {
      id: 3,
      name: "Tractor Beam",
      board: { type: "rect", cols: 7, rows: 14 },
      playerStart: { q: -4, r: 13 },
      exit: { q: 3, r: 0 },
      outpost: { q: 0, r: 0 },
      enemies: [
        { type: "cruiser", q: -1, r: 6 },
        { type: "interceptor", q: 0, r: 8 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming", "tractor"],
      intro: "Tractor Beam online. Shove an adjacent 👾 — off the edge destroys it. The Cruiser takes TWO hits, so shove it instead.",
    },
    // Sector 4 — Fighter Squadron. Three Interceptors, full action kit.
    {
      id: 4,
      name: "Fighter Squadron",
      board: { type: "rect", cols: 8, rows: 15 },
      playerStart: { q: -4, r: 14 },
      exit: { q: 3, r: 0 },
      outpost: { q: 7, r: 0 },
      enemies: [
        { type: "cruiser", q: 0, r: 3 },
        { type: "sentry", q: 2, r: 8 },
        { type: "interceptor", q: -3, r: 11 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming", "tractor", "fighter"],
      intro: "Fighter Squadron online. Strike any 👾 at range, then retrieve your 🛩️. The Sentry doesn't move — but its beam covers 2 hexes all around. Route around it or take it out.",
    },
    // Sector 5 — Full Fleet. The biggest, tallest board, everything unlocked.
    {
      id: 5,
      name: "Full Fleet",
      board: { type: "rect", cols: 8, rows: 17 },
      playerStart: { q: -5, r: 16 },
      exit: { q: 3, r: 0 },
      outpost: { q: -4, r: 8 },
      enemies: [
        { type: "cruiser", q: 1, r: 3 },
        { type: "sentry", q: 2, r: 6 },
        { type: "interceptor", q: -2, r: 11 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      intro: "Full fleet command — Interceptors, Cruisers, and a Sentry, all at once. Clear the sector however you like.",
    },
  ];

  // ---- procedural depth: sectors beyond the hand-authored campaign --------
  //
  // LEVELS above is the tutorial campaign (one new action per sector).
  // Once it's cleared, the run keeps going forever via generateLevel(depth)
  // — same LevelDef shape as a hand-authored entry, so the engine/renderer/
  // save system never need to know the difference. Depth scales board size
  // and enemy count/mix; only enemy PLACEMENT is randomized — every
  // enemy's actual combat rules stay exactly as deterministic as ever once
  // the board is dealt (pillar #1 is about combat, not level layout).
  //
  // Deliberately duplicates the rect-board hex enumeration from engine.js's
  // buildBoardHexes rather than importing it — levels.js stays a
  // dependency-free data module (see the file header), and it's a handful
  // of lines.

  function hexDist(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  }

  // Small deterministic PRNG (mulberry32) seeded off depth — the SAME depth
  // always deals the SAME board (reproducible runs), while different depths
  // still feel distinct from each other.
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateLevel(depth) {
    const cols = Math.min(6 + Math.floor(depth / 3), 9);
    const rows = Math.min(11 + depth, 21);
    const rng = seededRandom(depth * 2654435761);

    const startRow = rows - 1;
    const playerStart = { q: Math.floor(cols / 2) - Math.floor(startRow / 2), r: startRow };
    const topRow = 0;
    const exit = { q: cols - 1, r: topRow }; // rightmost hex of the top row
    const outpost = { q: 0, r: topRow }; // leftmost hex of the top row

    const hexes = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        hexes.push({ q: col - Math.floor(row / 2), r: row });
      }
    }
    const reserved = [playerStart, exit, outpost];
    const candidates = hexes.filter(
      (h) => hexDist(h, playerStart) >= 3 && !reserved.some((r2) => r2.q === h.q && r2.r === h.r)
    );
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    const enemyCount = Math.min(3 + Math.floor(depth / 2), 9);
    const typePool =
      depth < 8
        ? ["interceptor", "interceptor", "cruiser", "sentry"]
        : ["interceptor", "cruiser", "cruiser", "sentry", "sentry"];
    const enemies = [];
    for (const hex of candidates) {
      if (enemies.length >= enemyCount) break;
      if (enemies.some((e) => hexDist(e, hex) < 2)) continue; // keep fresh spawns from stacking
      enemies.push({ type: typePool[Math.floor(rng() * typePool.length)], q: hex.q, r: hex.r });
    }

    return {
      id: depth,
      name: `Deep Space — Depth ${depth}`,
      board: { type: "rect", cols, rows },
      playerStart,
      exit,
      outpost,
      enemies,
      hazards: [],
      exitRule: "all-enemies-dead",
      intro: `Uncharted sector, depth ${depth}. No map, no mercy — salvage what you can.`,
    };
  }

  const HypergolicLevels = { LEVELS, generateLevel };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicLevels;
  } else {
    root.HypergolicLevels = HypergolicLevels;
  }
})(typeof window !== "undefined" ? window : globalThis);
