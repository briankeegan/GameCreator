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

  // Every sector is the SAME board size, 9×11 — Clubhouse feedback
  // confirmed this size directly ("the first level size honestly seems
  // to be perfect") after two earlier attempts at capping growth still
  // read as "too dense... pretty tiny." Difficulty now comes entirely
  // from more/tougher enemies, hazards, and unlocked actions — never a
  // bigger map. The old Sector 1 (a no-op "learn to move, no enemies"
  // board) is gone too — "Level one is pointless" — so the campaign
  // opens on the Shockwave lesson.
  const LEVELS = [
    // Sector 1 — Shockwave. One Interceptor between you and the gate.
    {
      id: 1,
      name: "Shockwave",
      board: { type: "rect", cols: 9, rows: 11 },
      playerStart: { q: 4, r: 8 },
      exit: { q: 8, r: -4 },
      outpost: null,
      enemies: [{ type: "interceptor", q: 4, r: 3 }],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming"],
      intro: "Shockwave online. It auto-fires on any enemy within 1 hex — in every direction — after you move.",
    },
    // Sector 2 — Tractor Beam. Two enemies; push one off the edge. Unlike
    // every other campaign action, Tractor Beam isn't handed out for free
    // (Clubhouse: "you should not start with it") — it's a free claim at
    // this sector's Outpost specifically (see engine.js's
    // pickOutpostOfferIds), the one guaranteed place to get it.
    {
      id: 2,
      name: "Tractor Beam",
      board: { type: "rect", cols: 9, rows: 11 },
      playerStart: { q: 4, r: 8 },
      exit: { q: 8, r: -4 },
      outpost: { q: 0, r: 0 },
      enemies: [
        { type: "cruiser", q: 4, r: 3 },
        { type: "interceptor", q: 6, r: 0 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming"],
      intro: "Dock at the Outpost to claim the Tractor Beam — free. Shove an adjacent enemy: off the edge destroys it. The Cruiser takes TWO hits, so shove it instead.",
    },
    // Sector 3 — Sentry Line. Three enemies; the lesson is the Sentry
    // (stationary, 2-hex beam ring) and shopping for your first upgrades.
    // (This slot used to teach Fighter Squadron, which was cut — Clubhouse:
    // "remove Random Blink and Fighter Squadron.")
    {
      id: 3,
      name: "Sentry Line",
      board: { type: "rect", cols: 9, rows: 11 },
      playerStart: { q: 4, r: 8 },
      exit: { q: 8, r: -4 },
      outpost: { q: 0, r: 0 },
      enemies: [
        { type: "cruiser", q: 2, r: 5 },
        { type: "sentry", q: 6, r: 1 },
        { type: "interceptor", q: 4, r: 0 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "ramming"],
      intro: "The Sentry doesn't move — but its beam covers 2 hexes all around. Route around it or take it out. Spend salvage at the Outpost while you can.",
    },
    // Sector 4 — Full Fleet. Everything unlocked, no guaranteed Outpost —
    // Clubhouse feedback: "you shouldn't always have a place to heal."
    // Sectors 2-3 keep theirs (that's where the Outpost mechanic itself
    // gets taught); by the toughest campaign fight, that safety net is
    // gone, same as most generated sectors past it.
    {
      id: 4,
      name: "Full Fleet",
      board: { type: "rect", cols: 9, rows: 11 },
      playerStart: { q: 4, r: 8 },
      exit: { q: 8, r: -4 },
      outpost: null,
      enemies: [
        { type: "cruiser", q: 3, r: 5 },
        { type: "sentry", q: 6, r: 2 },
        { type: "interceptor", q: 4, r: 0 },
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

  // Every procedural sector offers 2 Warp Gates, not 1 — Clubhouse feedback:
  // "different sort of paths you could take and options based on the
  // different portals." Each variant consistently biases what its gate
  // leads to (enemy count, hazard count, Outpost odds) the same way every
  // time — a real, deterministic difference, not flavor — but nothing in
  // the game ever states what a variant means ("maybe color coordinated,
  // but maybe not tell people"); app.js picks a distinct visual tint per
  // id (see BRANCH_TINTS there) and that's the only signal given.
  const BRANCH_VARIANTS = [
    { id: "aggressive", enemyDelta: 2, hazardDelta: 1, outpostChanceDelta: -0.25 },
    { id: "quiet", enemyDelta: -1, hazardDelta: 0, outpostChanceDelta: 0.25 },
  ];

  // "How do you win, or is it just runs?" (Clubhouse) — depth 20 is a
  // single, fixed boss milestone, not another procedural roll and not a
  // repeating pattern. Ignores `variantId`/branching entirely (a singular
  // narrative beat both of the previous sector's gates converge on, not a
  // choice) — a real, tougher, named encounter with its own guaranteed
  // Outpost right before it (shop before the fight, genre-standard);
  // clearing it is a genuine "Run Complete" (see engine.js's
  // `isBoss`/`isVictory`, app.js's victory overlay), distinct from the
  // permadeath loss screen. The crawl still continues past it afterward,
  // purely procedural from depth 21 on, for players chasing a higher
  // depth — this is the one milestone, not the first of many.
  const BOSS_DEPTH = 20;

  function bossLevel(depth) {
    const rows = 11;
    const cols = 9;
    const startCol = Math.floor(cols / 2);
    return {
      id: depth,
      name: "The Bulwark",
      isBoss: true,
      board: { type: "rect", cols, rows },
      playerStart: { q: startCol, r: rows - 1 - Math.floor(startCol / 2) },
      exit: { q: cols - 1, r: -Math.floor((cols - 1) / 2) },
      outpost: { q: 0, r: 0 },
      enemies: [
        { type: "cruiser", q: 2, r: 6 },
        { type: "cruiser", q: 6, r: 6 },
        { type: "sentry", q: 2, r: 2 },
        { type: "sentry", q: 6, r: 2 },
        { type: "interceptor", q: startCol, r: 3 },
      ],
      hazards: [
        { type: "asteroid", q: 1, r: 4 },
        { type: "asteroid", q: 7, r: 0 },
      ],
      exitRule: "all-enemies-dead",
      intro:
        "The Bulwark. A hardened defense line — two Cruisers, two Sentries, and an Interceptor between you and the gate. Stock up at the Outpost first.",
    };
  }

  function generateLevel(depth, variantId) {
    if (depth === BOSS_DEPTH) return bossLevel(depth);
    // Fixed at the exact same size as every hand-authored sector — 9×11,
    // confirmed directly by the Clubhouse as the right size ("the first
    // level size honestly seems to be perfect") after two earlier, still
    // insufficient attempts at capping growth. Board size never grows with
    // depth anymore; enemy count/mix and hazards (see below) carry
    // difficulty instead of an ever-bigger or ever-denser map.
    const rows = 11;
    const cols = 9;
    // `variantId` is which gate got you INTO this sector (see app.js's
    // advanceSector) — it biases what this sector itself contains. Folded
    // into the seed too, so "aggressive" and "quiet" arrivals at the same
    // depth deal genuinely different boards, not just different enemy
    // counts off the same layout.
    const variant = BRANCH_VARIANTS.find((v) => v.id === variantId) || null;
    const variantSeedOffset = variant ? (BRANCH_VARIANTS.indexOf(variant) + 1) * 104729 : 0;
    const rng = seededRandom(depth * 2654435761 + variantSeedOffset);

    // Flat-top rect board (see engine.js's buildBoardHexes): column c spans
    // r = -floor(c/2) .. rows-1-floor(c/2). Player starts at the bottom of
    // the middle column. This sector's own two OUTGOING gates sit at the
    // top of the rightmost column (the original single-exit spot) and the
    // top of the middle column (straight up from playerStart) — same
    // layout intent as the hand-authored campaign's single exit, just two
    // of them now.
    const startCol = Math.floor(cols / 2);
    const playerStart = { q: startCol, r: rows - 1 - Math.floor(startCol / 2) };
    const exits = BRANCH_VARIANTS.map((v, i) => ({
      q: i === 0 ? cols - 1 : startCol,
      r: i === 0 ? -Math.floor((cols - 1) / 2) : -Math.floor(startCol / 2),
      variantId: v.id,
    }));
    const exit = exits[0]; // primary/first gate — every non-branching call site reads this
    // Not every sector gets an Outpost — a guaranteed safe restock every
    // single time made the crawl "too easy and not very interesting"
    // (Clubhouse feedback). ~60% of generated sectors have one, shifted by
    // the incoming variant's bias.
    const outpostChance = Math.min(0.9, Math.max(0.1, 0.6 + (variant ? variant.outpostChanceDelta : 0)));
    const hasOutpost = rng() < outpostChance;
    const outpost = hasOutpost ? { q: 0, r: 0 } : null;

    const hexes = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        hexes.push({ q: col, r: row - Math.floor(col / 2) });
      }
    }
    const reserved = [playerStart, ...exits, ...(outpost ? [outpost] : [])];
    const candidates = hexes.filter(
      (h) => hexDist(h, playerStart) >= 3 && !reserved.some((r2) => r2.q === h.q && r2.r === h.r)
    );
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    // Asteroid fields — genuinely impassable terrain (see engine.js's
    // isBlockingHazard), not just more enemies — so "not every square is
    // always the same" (Clubhouse feedback). Kept away from both exits and
    // the Outpost so a run can never get its goal fully walled off.
    const hazardCount = Math.max(0, Math.min(1 + Math.floor(depth / 4) + (variant ? variant.hazardDelta : 0), 4));
    const hazards = [];
    for (const hex of candidates) {
      if (hazards.length >= hazardCount) break;
      if (exits.some((ex) => hexDist(hex, ex) < 2) || (outpost && hexDist(hex, outpost) < 2)) continue;
      if (hazards.some((h) => hexDist(h, hex) < 2)) continue;
      hazards.push({ type: "asteroid", q: hex.q, r: hex.r });
    }
    const hazardKeys = new Set(hazards.map((h) => `${h.q},${h.r}`));

    const enemyCount = Math.max(1, Math.min(3 + Math.floor(depth / 2) + (variant ? variant.enemyDelta : 0), 9));
    // The Railgun Destroyer (long-range, board-spanning shot along its
    // axes) joins the roster at the same depth tier Cruiser/Sentry weight
    // increases — a genuinely new threat shape (line-up-from-across-the-
    // map instead of adjacent/short-ring), not just another stat bump.
    const typePool =
      depth < 8
        ? ["interceptor", "interceptor", "cruiser", "sentry"]
        : ["interceptor", "cruiser", "cruiser", "sentry", "sentry", "railgun"];
    const enemies = [];
    for (const hex of candidates) {
      if (enemies.length >= enemyCount) break;
      if (hazardKeys.has(`${hex.q},${hex.r}`)) continue;
      if (enemies.some((e) => hexDist(e, hex) < 2)) continue; // keep fresh spawns from stacking
      enemies.push({ type: typePool[Math.floor(rng() * typePool.length)], q: hex.q, r: hex.r });
    }

    return {
      id: depth,
      name: `Deep Space — Depth ${depth}`,
      board: { type: "rect", cols, rows },
      playerStart,
      exit,
      exits,
      outpost,
      enemies,
      hazards,
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
