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
      board: { type: "rect", cols: 5, rows: 7 },
      playerStart: { q: -1, r: 6 },
      exit: { q: 2, r: 0 },
      outpost: null,
      enemies: [],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight"],
      intro: "Sublight Impulse online. Tap a green hex to fly.",
    },
    // Sector 2 — Ramming Speed. One Interceptor between you and the gate.
    {
      id: 2,
      name: "Ramming Speed",
      board: { type: "rect", cols: 5, rows: 7 },
      playerStart: { q: -1, r: 6 },
      exit: { q: 2, r: 0 },
      outpost: null,
      enemies: [{ type: "interceptor", q: 1, r: 3 }],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming"],
      intro: "Ramming Speed online. End a move beside a 👾 to vaporize it.",
    },
    // Sector 3 — Tractor Beam. Two Interceptors; push one off the edge.
    {
      id: 3,
      name: "Tractor Beam",
      board: { type: "rect", cols: 6, rows: 9 },
      playerStart: { q: -2, r: 8 },
      exit: { q: 3, r: 0 },
      outpost: { q: 0, r: 0 },
      enemies: [
        { type: "interceptor", q: 0, r: 4 },
        { type: "interceptor", q: 2, r: 5 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming", "tractor"],
      intro: "Tractor Beam online. Shove an adjacent 👾 — off the edge destroys it.",
    },
    // Sector 4 — Fighter Squadron. Three Interceptors, full action kit.
    {
      id: 4,
      name: "Fighter Squadron",
      board: { type: "rect", cols: 7, rows: 10 },
      playerStart: { q: -1, r: 9 },
      exit: { q: 3, r: 0 },
      outpost: { q: 6, r: 0 },
      enemies: [
        { type: "interceptor", q: 0, r: 2 },
        { type: "interceptor", q: 3, r: 5 },
        { type: "interceptor", q: -1, r: 7 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming", "tractor", "fighter"],
      intro: "Fighter Squadron online. Strike any 👾 at range, then retrieve your 🛩️.",
    },
    // Sector 5 — Full Fleet. The biggest, tallest board, everything unlocked.
    {
      id: 5,
      name: "Full Fleet",
      board: { type: "rect", cols: 7, rows: 11 },
      playerStart: { q: -2, r: 10 },
      exit: { q: 3, r: 0 },
      outpost: { q: -2, r: 5 },
      enemies: [
        { type: "interceptor", q: 1, r: 2 },
        { type: "interceptor", q: 3, r: 4 },
        { type: "interceptor", q: 0, r: 7 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      intro: "Full fleet command. Clear the sector however you like.",
    },
  ];

  const HypergolicLevels = { LEVELS };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicLevels;
  } else {
    root.HypergolicLevels = HypergolicLevels;
  }
})(typeof window !== "undefined" ? window : globalThis);
