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
  // opens on the Autocannon lesson.
  const LEVELS = [
    // Sector 1 — Autocannon. One Interceptor between you and the gate.
    {
      id: 1,
      name: "Outer Reach",
      board: { type: "rect", cols: 9, rows: 11 },
      playerStart: { q: 4, r: 8 },
      exit: { q: 8, r: -4 },
      outpost: null,
      enemies: [{ type: "interceptor", q: 4, r: 3 }],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "autocannon"],
      intro: "One contact between us and the gate. Let it come to us.",
    },
    // Sector 2 — the first Cruiser: a hostile that survives a hit and keeps
    // coming, plus the first Outpost. Learning that a dock is where
    // capability comes from is the lesson here.
    {
      id: 2,
      name: "Salvage Field",
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
      actions: ["sublight", "autocannon"],
      intro: "Cruiser on approach — it takes two. Station ahead is still trading.",
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
      // The Sentry lesson: ONE emplacement and one escort. Its beam covers
      // a two-hex ring in every direction, which is a wall on a board this
      // width — learning to read that zone is the whole sector, and a
      // third hostile just turns the lesson into an unwinnable brawl.
      enemies: [
        { type: "sentry", q: 6, r: 1 },
        { type: "interceptor", q: 4, r: 0 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "autocannon"],
      intro: "Gun platform holding station. It will not come to us, and it does not have to.",
    },
    // Sector 4 — Full Fleet. Everything unlocked, no guaranteed Outpost —
    // Clubhouse feedback: "you shouldn't always have a place to heal."
    // Sectors 2-3 keep theirs (that's where the Outpost mechanic itself
    // gets taught); by the toughest campaign fight, that safety net is
    // gone, same as most generated sectors past it.
    {
      id: 4,
      name: "The Gauntlet",
      board: { type: "rect", cols: 9, rows: 11 },
      playerStart: { q: 4, r: 8 },
      exit: { q: 8, r: -4 },
      // The last hand-authored sector before the crawl goes procedural —
      // so this is the outfitters. Running it dry meant arriving at depth
      // 5 with a hold full of salvage, a starting gun, and no shelf to
      // spend on since sector 3.
      outpost: { q: 0, r: 0 },
      enemies: [
        { type: "cruiser", q: 3, r: 5 },
        { type: "sentry", q: 6, r: 2 },
        { type: "interceptor", q: 4, r: 0 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      intro: "Three contacts on the board. The gate is open the whole way — we do not have to kill any of them.",
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
    // The third direction ("should have multiple directions — that's how
    // it's a maze"): drift sectors run hazard-heavy — normal resistance,
    // but the map itself fights you. Not every sector deals this gate
    // (see generateLevel), so the chart genuinely forks 2 or 3 ways.
    { id: "drift", enemyDelta: 0, hazardDelta: 2, outpostChanceDelta: 0 },
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
  // Twelve, not twenty. A sector is fifteen to twenty-five rounds of
  // real play, so a twenty-deep run is several hundred taps — and full-run
  // playtesting never once got there: the survival curve ran out around
  // depth 13-15 no matter how well the ship was flown or fitted. Twelve
  // gives the run an actual shape — four authored sectors to learn on,
  // seven of escalating crawl, then the Bulwark — and it stays a real
  // achievement rather than a theoretical one. The crawl still continues
  // past it, purely procedural, for anyone chasing depth.
  const BOSS_DEPTH = 12;

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
      theme: { variant: "boss", band: Math.floor(depth / 5) },
      intro: "The Bulwark. Last station is right there — take what we can carry.",
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
    const exits = [
      { q: cols - 1, r: -Math.floor((cols - 1) / 2), variantId: "aggressive" }, // top-right
      { q: startCol, r: -Math.floor(startCol / 2), variantId: "quiet" }, // straight up
    ];
    // Some sectors (deterministically, ~half) deal a THIRD gate toward the
    // top-left — the drift route. (Top of column 2, not the true corner:
    // the (0,0) corner is the Outpost's fixed berth.) 2- and 3-way forks
    // mixing is what makes the chart read as a maze instead of a ladder.
    if (rng() < 0.55) exits.push({ q: 2, r: -1, variantId: "drift" });
    const exit = exits[0]; // primary/first gate — every non-branching call site reads this
    // Not every sector gets an Outpost — a guaranteed safe restock every
    // single time made the crawl "too easy and not very interesting"
    // (Clubhouse feedback). ~60% of generated sectors have one, shifted by
    // the incoming variant's bias.
    const outpostChance = Math.min(0.9, Math.max(0.1, 0.6 + (variant ? variant.outpostChanceDelta : 0)));
    // ...but there is ALWAYS a dock within three jumps. Hull damage is
    // permanent, so a dry stretch of four or five sectors isn't difficulty,
    // it's just a run bleeding out with nothing it can do about it.
    // A dock at least every OTHER sector. Hull damage is permanent and the
    // only repair is a dock, so a three-sector dry stretch isn't tension —
    // it's a run that already ended and hasn't been told yet. Playtesting
    // ran into exactly that: dying at depth 5 with 13 salvage in the hold
    // and no shelf to spend it on since depth 3.
    const hasOutpost = depth % 2 === 0 || rng() < outpostChance;
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

    // The hand-authored campaign runs 1, 2, then 3 hostiles; the crawl has
    // to continue that line rather than jumping to five the moment it goes
    // procedural. One more contact every three sectors, topping out at 8.
    // One action fires ONE gun now, so a round is one point of damage
    // (or one Flak Burst across a crowd) — not a volley off every mount.
    // Enemy counts were tuned against volleys, and left as they were the
    // crawl became unwinnable: forty full runs, zero finishes. Slower
    // ramp, lower ceiling.
    const enemyCount = Math.max(1, Math.min(2 + Math.floor(depth / 4) + (variant ? variant.enemyDelta : 0), 5));
    // The Railgun Destroyer (long-range, board-spanning shot along its
    // axes) joins the roster at the same depth tier Cruiser/Sentry weight
    // increases — a genuinely new threat shape (line-up-from-across-the-
    // map instead of adjacent/short-ring), not just another stat bump.
    // Threat SHAPES arrive one at a time, not all at once: chasers first,
    // then the emplacement that zones a chunk of the board off, then the
    // one that shoots the length of it. A Sentry's beam covers a true
    // two-hex ring (18 hexes) — dropping two of those into a depth-4
    // board alongside cruisers doesn't read as difficulty, it reads as a
    // wall you have to walk through and lose hull to.
    const typePool =
      depth < 5
        ? ["interceptor", "interceptor", "cruiser"]
        : depth < 8
          ? ["interceptor", "interceptor", "cruiser", "cruiser", "sentry"]
          : ["interceptor", "cruiser", "cruiser", "sentry", "sentry", "railgun"];
    // At most TWO emplacements on a board. A Sentry or a Railgun Destroyer
    // doesn't chase you — it denies ground — and three of them on a 9x11
    // field is a wall with no way around it, which is exactly what full-run
    // playtesting kept dying to (fourteen of thirty deaths on boards of
    // three Sentries and a Railgun). Two is a gauntlet you can route
    // through; three is a corridor with a gun at the end of it.
    const EMPLACEMENTS = new Set(["sentry", "railgun"]);
    const MOBILE = ["interceptor", "cruiser"];
    const enemies = [];
    let emplaced = 0;
    for (const hex of candidates) {
      if (enemies.length >= enemyCount) break;
      if (hazardKeys.has(`${hex.q},${hex.r}`)) continue;
      if (enemies.some((e) => hexDist(e, hex) < 2)) continue; // keep fresh spawns from stacking
      let type = typePool[Math.floor(rng() * typePool.length)];
      if (EMPLACEMENTS.has(type)) {
        if (emplaced >= 2) type = MOBILE[Math.floor(rng() * MOBILE.length)];
        else emplaced++;
      }
      enemies.push({ type, q: hex.q, r: hex.r });
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
      // Visual identity ("when you're jumping into a color, it should
      // kinda match that theme"): the gate you came through sets the
      // sector's mood — warm/hostile for an aggressive gate, cool/calm
      // for a quiet one — and the depth band shifts the palette family so
      // deeper regions of space look like different places.
      theme: { variant: variant ? variant.id : "neutral", band: Math.floor(depth / 5) },
      intro: `Depth ${depth}. Nothing friendly out this far.`,
    };
  }

  const HypergolicLevels = { LEVELS, generateLevel, BOSS_DEPTH };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicLevels;
  } else {
    root.HypergolicLevels = HypergolicLevels;
  }
})(typeof window !== "undefined" ? window : globalThis);
