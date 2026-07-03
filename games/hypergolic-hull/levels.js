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
    {
      id: 1,
      radius: 2,
      playerStart: { q: 0, r: 0 },
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
