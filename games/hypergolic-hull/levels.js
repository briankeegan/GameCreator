// levels.js — the ONLY place level content lives. The engine (engine.js)
// plays any level shaped like a LevelDef; adding Level 2, 3, etc. means
// appending to this array, never touching engine logic.
//
//   LevelDef = {
//     id: number,
//     radius: number,               // hexes: all (q,r) with hexDistance(origin, ·) <= radius
//     playerStart: {q, r},
//     exit: {q, r},                 // Warp Gate, always on the outer ring
//     outpost: {q, r} | null,       // Sector Outpost, always on the outer ring
//     enemies: [{type, q, r}],
//     hazards: [{type, q, r}],      // e.g. {type: "blackhole", q, r}
//     exitRule: "all-enemies-dead",
//   }
(function (root) {
  "use strict";

  const LEVELS = [
    // Sector 1 — the tutorial board: you start on the left edge, one lone
    // Interceptor waits on the far right (max distance apart), gate past it.
    {
      id: 1,
      radius: 2,
      playerStart: { q: -2, r: 1 },
      exit: { q: 2, r: 0 },
      outpost: { q: -2, r: 0 },
      enemies: [{ type: "interceptor", q: 2, r: -1 }],
      hazards: [],
      exitRule: "all-enemies-dead",
    },
    // Sector 2 — the design doc's §6 board, with the player start moved from
    // the center to the left edge so enemies always begin across the board.
    {
      id: 2,
      radius: 2,
      playerStart: { q: -2, r: 1 },
      exit: { q: 2, r: 0 },
      outpost: { q: -2, r: 0 },
      enemies: [
        { type: "interceptor", q: -1, r: -1 },
        { type: "interceptor", q: 1, r: 1 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
    },
  ];

  const HypergolicLevels = { LEVELS };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicLevels;
  } else {
    root.HypergolicLevels = HypergolicLevels;
  }
})(typeof window !== "undefined" ? window : globalThis);
