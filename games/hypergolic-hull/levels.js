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
  // ---- WHERE YOU ARE ------------------------------------------------------
  // Sectors are places, not numbered rooms. Each one belongs to a LOCALE:
  // its own colour of space, its own furniture (a planet's limb, a dust
  // shoal, a wreck field), its own hex scale — and its own reasons to go
  // there or avoid it. The point is recognition. Come back through a
  // wormhole three jumps later and the board should say "the shoals" before
  // you've read a word of text.
  //
  // Every locale pulls its weight mechanically as well as visually, so
  // picking a gate is a real choice and not just a colour preference:
  //   hazardDelta    — asteroid fields. Cover from a Railgun's lanes, and
  //                    walls that break up a chase.
  //   enemyDelta     — how crowded it is.
  //   outpostDelta   — whether anybody trades out here.
  //   salvageDelta   — what a wreck is worth in this part of space.
  //   zoom           — hex scale. Some places are tight and close; none is
  //                    ever pulled further out than the standard board.
  const LOCALES = [
    {
      id: "shoals",
      name: "Dust Shoals",
      blurb: "Thick with dust. Good cover, poor visibility.",
      hazardDelta: 2,
      enemyDelta: -1,
      outpostDelta: -0.1,
      salvageDelta: 0,
      zoom: 1,
      hue: 34,
      sat: 40,
      feature: "dust",
    },
    {
      id: "shallows",
      name: "Planetary Shallows",
      blurb: "A world's limb fills half the sky. Traffic, and things that prey on it.",
      hazardDelta: 0,
      enemyDelta: 1,
      outpostDelta: 0.15,
      salvageDelta: 1,
      zoom: 1.12,
      hue: 205,
      sat: 45,
      feature: "planet",
    },
    {
      id: "void",
      name: "The Deep",
      blurb: "Nothing out here. Nothing to hide behind either.",
      hazardDelta: -2,
      enemyDelta: 0,
      outpostDelta: -0.25,
      salvageDelta: 1,
      zoom: 1,
      hue: 240,
      sat: 30,
      feature: "void",
    },
    {
      id: "belt",
      name: "The Breakers",
      blurb: "A shipping lane that didn't make it. Scrappers work this stretch.",
      hazardDelta: 1,
      enemyDelta: 0,
      outpostDelta: 0.3,
      salvageDelta: 2,
      zoom: 1.08,
      hue: 18,
      sat: 50,
      feature: "wrecks",
    },
    {
      id: "storm",
      name: "Ion Front",
      blurb: "The whole sky is charged. Everything out here is running hot.",
      hazardDelta: 0,
      enemyDelta: 1,
      outpostDelta: -0.15,
      salvageDelta: 1,
      zoom: 1,
      hue: 285,
      sat: 55,
      feature: "storm",
    },
    // "More backgrounds... planets with rings... more crazy ideas." Each
    // one is a real place with its own hazard/enemy/salvage economics, not
    // just new wallpaper — a reason to take that gate, or not.
    {
      id: "rings",
      name: "The Ringworks",
      blurb: "A giant with a ring system, and the ice is worth money.",
      hazardDelta: 1,
      enemyDelta: 0,
      outpostDelta: 0.2,
      salvageDelta: 2,
      zoom: 1.1,
      hue: 52,
      sat: 48,
      feature: "rings",
    },
    {
      id: "nursery",
      name: "The Kiln",
      blurb: "Stars being made. Everything here is too bright and too hot.",
      hazardDelta: 1,
      enemyDelta: 1,
      outpostDelta: -0.2,
      salvageDelta: 2,
      zoom: 1,
      hue: 330,
      sat: 55,
      feature: "nursery",
    },
    {
      id: "binary",
      name: "The Twins",
      blurb: "Two suns, no shade. You can be seen from anywhere.",
      hazardDelta: -1,
      enemyDelta: 1,
      outpostDelta: 0.1,
      salvageDelta: 1,
      zoom: 1,
      hue: 190,
      sat: 42,
      feature: "binary",
    },
    {
      id: "maw",
      name: "The Maw",
      blurb: "Something out here eats light. Nobody comes back rich and unhurt.",
      hazardDelta: 0,
      enemyDelta: -1,
      outpostDelta: -0.3,
      salvageDelta: 4,
      zoom: 1.18,
      hue: 268,
      sat: 60,
      feature: "maw",
    },
    {
      id: "graveyard",
      name: "The Cold Yard",
      blurb: "Hulls older than the war, still holding formation.",
      hazardDelta: 2,
      enemyDelta: -1,
      outpostDelta: 0,
      salvageDelta: 3,
      zoom: 1.15,
      hue: 160,
      sat: 35,
      feature: "hulks",
    },
  ];

  // Every sector gets its own NAME, not just its locale's label — a chart
  // full of "The Cold Yard" four times over reads as a category list, and
  // the whole point of these places is that you remember individual ones.
  // Names are seeded per sector, so a place you charted keeps its name for
  // the whole run (and re-deals identically on the same seed).
  const NAME_PARTS = {
    shoals: {
      first: ["Kesler", "Ashfall", "Meridian", "Tallow", "Sable", "Coriolis"],
      last: ["Shoals", "Drift", "Banks", "Reach", "Shallows", "Veil"],
    },
    shallows: {
      first: ["Halcyon", "Ostara", "Verrin", "Kepler", "Aldis", "Nyx"],
      last: ["Approach", "Anchorage", "Roads", "Narrows", "Basin", "Crossing"],
    },
    void: {
      first: ["Null", "Hollow", "Perdition", "Long", "Cold", "Empty"],
      last: ["Gap", "Silence", "Span", "Dark", "Interval", "March"],
    },
    belt: {
      first: ["Tessaly", "Redline", "Kollis", "Marrow", "Ironway", "Vashti"],
      last: ["Breakers", "Wreckline", "Scrapway", "Cut", "Run", "Spoil"],
    },
    storm: {
      first: ["Corona", "Static", "Feral", "Ember", "Pale", "Wrath"],
      last: ["Front", "Squall", "Surge", "Curtain", "Flare", "Boundary"],
    },
    rings: {
      first: ["Bellaquin", "Saturnine", "Halo", "Ferris", "Cassini", "Bright"],
      last: ["Ringworks", "Arc", "Shepherd", "Divide", "Sweep", "Annulus"],
    },
    nursery: {
      first: ["Furnace", "Kiln", "Firstlight", "Ember", "Cradle", "Vestal"],
      last: ["Pillars", "Nursery", "Forge", "Bloom", "Ignition", "Rise"],
    },
    binary: {
      first: ["Castor", "Gemini", "Twinfall", "Duo", "Second", "Pale"],
      last: ["Twins", "Pair", "Noon", "Glare", "Meridian", "Shadowless"],
    },
    maw: {
      first: ["Anselm", "Hungry", "Ashen", "Kolm", "Last", "Blind"],
      last: ["Maw", "Throat", "Descent", "Well", "Fall", "Horizon"],
    },
    graveyard: {
      first: ["Cassivar", "Dumas", "Old", "Silent", "Winter", "Hollis"],
      last: ["Yard", "Line", "Fleet", "Standing", "Anchorage", "Mausoleum"],
    },
  };

  function sectorName(locale, depth, variantId) {
    const parts = NAME_PARTS[locale.id];
    if (!parts) return locale.name;
    const rng = seededRandom(depth * 7919 + (variantId || "x").charCodeAt(0) * 613 + locale.id.length * 97);
    const first = parts.first[Math.floor(rng() * parts.first.length)];
    const last = parts.last[Math.floor(rng() * parts.last.length)];
    return `${first} ${last}`;
  }

  // Which locale a sector is depends on the depth AND the gate you came
  // through, so the same depth reached two ways is two different places —
  // and so a gate can honestly advertise where it goes (see localeAhead).
  function localeFor(depth, variantId) {
    const rng = seededRandom(depth * 6151 + (variantId ? variantId.length * 977 : 0) + (variantId || "x").charCodeAt(0) * 31);
    return LOCALES[Math.floor(rng() * LOCALES.length)];
  }

  // What lies through a given gate of a given sector — the Map and the
  // gate itself read this, so "why would I go left" has an answer before
  // you commit to it.
  function localeAhead(depth, variantId) {
    return depth + 1 === BOSS_DEPTH ? { id: "bulwark", name: "The Bulwark", blurb: "It's waiting." } : localeFor(depth + 1, variantId);
  }

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
      // Two gun platforms holding the line, one heavy, one runner. Five
      // was the old shape and it simply cannot be traded with by a
      // three-Hull ship however well it's flown — the fight has to be
      // winnable by a run that arrives in good order, or the last sector
      // is just a wall with a name.
      enemies: [
        { type: "cruiser", q: 3, r: 6 },
        { type: "sentry", q: 2, r: 2 },
        { type: "sentry", q: 6, r: 2 },
        { type: "interceptor", q: startCol, r: 4 },
      ],
      hazards: [
        { type: "asteroid", q: 1, r: 4 },
        { type: "asteroid", q: 7, r: 0 },
      ],
      exitRule: "all-enemies-dead",
      // The most recognisable place in the run, and the only one you meet
      // once: iron and old blood, tight in, wrecks of everything that tried
      // this before you.
      locale: {
        id: "bulwark",
        name: "The Bulwark",
        blurb: "Iron and old blood. Everything that tried this before us is still here.",
        hue: 6,
        sat: 40,
        feature: "hulks",
        zoom: 1.1,
      },
      salvageBonus: 2,
      theme: { variant: "boss", band: Math.floor(depth / 5), locale: "bulwark" },
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
    // `variantId` is which gate got you INTO this sector (see app.js's
    // advanceSector) — it biases what this sector itself contains. Folded
    // into the seed too, so "aggressive" and "quiet" arrivals at the same
    // depth deal genuinely different boards, not just different enemy
    // counts off the same layout.
    const variant = BRANCH_VARIANTS.find((v) => v.id === variantId) || null;
    // WHERE this sector is — drives its look, its furniture, and how much
    // of everything it has (see LOCALES).
    const locale = localeFor(depth, variantId);
    const variantSeedOffset = variant ? (BRANCH_VARIANTS.indexOf(variant) + 1) * 104729 : 0;
    const rng = seededRandom(depth * 2654435761 + variantSeedOffset);

    // ---- how big is this sector? -------------------------------------
    //
    // The board is sized to the ROSTER, not rolled independently of it.
    // Two things were being decided separately — how many hostiles, and
    // how much room — and then reconciled by scaling the count to the
    // area, which is backwards: it meant a quiet sector could still deal
    // a big empty board to walk across, and a crowded one could land on
    // something airless. Deciding the fight first and then giving it a
    // room to happen in gets both asks at once — "smaller boards,
    // particularly when there are less enemies... and generally smaller
    // boards in the beginning" — because early sectors have the smallest
    // rosters, so they get the smallest boards for free.
    //
    // 9x11 is still the ceiling and nothing exceeds it. 7 rows is the
    // floor: any shorter and a gate is on the doorstep.
    // A gate's variant and a locale can each swing the roster by a couple
    // of hulls, which at depth 1 — where the base is two — means the
    // aggressive fork was dealing FIVE. A fork should be a heavier version
    // of the sector you'd have got, not a different game. So the deltas
    // are applied under a ceiling that opens up with depth: taking the
    // hard road early gets you the hardest sector available at that depth,
    // and that is all.
    const ceiling = 2 + Math.floor(depth / 2);
    const roster = Math.max(
      1,
      Math.min(1 + Math.floor(depth / 3) + (variant ? variant.enemyDelta : 0) + locale.enemyDelta, ceiling, 5)
    );
    // Two candidate sizes per roster so sectors of the same weight still
    // don't all look alike; the seeded roll picks one.
    const SIZE_FOR_ROSTER = {
      1: [{ cols: 7, rows: 7 }, { cols: 7, rows: 8 }],
      2: [{ cols: 7, rows: 8 }, { cols: 7, rows: 9 }],
      3: [{ cols: 7, rows: 9 }, { cols: 9, rows: 8 }],
      4: [{ cols: 9, rows: 9 }, { cols: 9, rows: 10 }],
      5: [{ cols: 9, rows: 10 }, { cols: 9, rows: 11 }],
      6: [{ cols: 9, rows: 11 }, { cols: 9, rows: 11 }],
    };
    const sizes = SIZE_FOR_ROSTER[roster];
    const shape = sizes[Math.floor(rng() * sizes.length)];
    const cols = shape.cols;
    const rows = shape.rows;

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
    // A fork is the whole point of a chart. Two ways out is the floor,
    // three is the common case — a sector with one exit is a corridor.
    if (rng() < 0.8) exits.push({ q: 2, r: -1, variantId: "drift" });
    const exit = exits[0]; // primary/first gate — every non-branching call site reads this
    // Not every sector gets an Outpost — a guaranteed safe restock every
    // Not every sector trades. Somebody has to actually be out here, and
    // that's a property of WHERE you are: scrappers work the Breakers,
    // nobody is selling anything in the Deep. A dry stretch is a real
    // thing that happens to a run, and a reason to take the other gate.
    const outpostChance = Math.min(
      0.85,
      Math.max(0.05, 0.6 + (variant ? variant.outpostChanceDelta : 0) + locale.outpostDelta)
    );
    const hasOutpost = rng() < outpostChance;

    const hexes = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        hexes.push({ q: col, r: row - Math.floor(col / 2) });
      }
    }
    // The dock goes somewhere DIFFERENT every sector. It used to be nailed
    // to hex (0,0) — the same corner of every board in the game — which
    // made "is there a shop here" the only question a station ever asked,
    // and made the route to it identical forever. Now it's seeded like
    // everything else: never on your doorstep, never parked on a gate, and
    // never so close to a gate that docking is free on the way past.
    // Deciding to go and get it is the point.
    // Stations sit at a sector's edge (the engine validates it), so a berth
    // is any border hex far enough from where you come in and from every
    // gate that docking is a real detour rather than something you do on
    // the way past.
    const isBorder = (h) => {
      const col = h.q;
      const row = h.r + Math.floor(col / 2);
      return col === 0 || col === cols - 1 || row === 0 || row === rows - 1;
    };
    const berths = hexes.filter(
      (h) =>
        isBorder(h) &&
        hexDist(h, playerStart) >= 4 &&
        exits.every((ex) => hexDist(h, ex) >= 3)
    );
    const outpost = hasOutpost && berths.length ? berths[Math.floor(rng() * berths.length)] : null;
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
    // Counts are DENSITIES, not absolutes. Boards vary in size now, and
    // dropping a 9x11 board's worth of hostiles onto a 7x7 one doubles the
    // pressure per hex — measured, it halved a careful pilot's finish rate
    // and wiped out the gap between careful and greedy entirely, because
    // there was no longer any ground to pick. The crowding has to stay
    // constant so board size changes the SHAPE of a sector, not its
    // difficulty.
    const area = cols * rows;
    // Not a straight area ratio: a small board is harder to survive at the
    // same count (less ground to give away), so halving the area shouldn't
    // halve the roster. Half-way between "same count everywhere" and "same
    // hostiles per hex" lands the crawl back where it was tuned — measured
    // at careful ~1 run in 3, greedy and reckless well below it.
    const density = area / 99; // 9x11, the old fixed board, is 1.0
    const scale = (n) => Math.max(1, Math.round(n * density));
    const hazardCount = Math.max(
      0,
      Math.min(scale(1 + Math.floor(depth / 4) + (variant ? variant.hazardDelta : 0) + locale.hazardDelta), 6)
    );
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
    const enemyCount = roster; // the board was built for exactly this many
    // The Railgun Destroyer (long-range, board-spanning shot along its
    // axes) joins the roster at the same depth tier Cruiser/Sentry weight
    // increases — a genuinely new threat shape (line-up-from-across-the-
    // map instead of adjacent/short-ring), not just another stat bump.
    // Threat SHAPES arrive one at a time, not all at once: chasers first,
    // then the emplacement that zones a chunk of the board off, and only
    // in the last stretch the one that shoots the length of it. A Railgun
    // Destroyer takes two thirds of a fresh hull in one slug from off
    // screen; meeting that at depth 8 with a starting kit isn't a puzzle,
    // it's a coin toss. A Sentry's beam covers a true
    // two-hex ring (18 hexes) — dropping two of those into a depth-4
    // board alongside cruisers doesn't read as difficulty, it reads as a
    // wall you have to walk through and lose hull to.
    // Threat SHAPES arrive one at a time, each one a new question about
    // where you are allowed to stand: adjacent, then the ring at two,
    // then the shell at three that goes over cover, then the gaps a lane
    // can't reach, and last the lane itself.
    // A shape is only a puzzle if you own something that can answer it.
    // Mortars were arriving at depth 5, where the ship is still carrying
    // nothing but a contact-range Autocannon: a shell that lands at three
    // and ignores cover is then not a puzzle, it's a tax, and it showed —
    // every run spent its entire salvage on hull patches and reached the
    // Bulwark with the gun it started with. Each new shape now lands a
    // sector or two AFTER the gun that answers it appears on a shelf.
    const typePool =
      depth < 5
        ? ["interceptor", "interceptor", "cruiser"]
        : depth < 8
          ? ["interceptor", "interceptor", "cruiser", "cruiser", "sentry"]
          : depth < 11
            ? ["interceptor", "cruiser", "cruiser", "sentry", "sentry", "mortar"]
            : ["interceptor", "cruiser", "sentry", "mortar", "lancer", "railgun"];
    // At most TWO emplacements on a board. A Sentry or a Railgun Destroyer
    // doesn't chase you — it denies ground — and three of them on a 9x11
    // field is a wall with no way around it, which is exactly what full-run
    // playtesting kept dying to (fourteen of thirty deaths on boards of
    // three Sentries and a Railgun). Two is a gauntlet you can route
    // through; three is a corridor with a gun at the end of it.
    const EMPLACEMENTS = new Set(["sentry", "railgun", "mortar"]);
    const MOBILE = ["interceptor", "cruiser", "lancer"];
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
      name: sectorName(locale, depth, variantId),
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
      // Where this is, not just how deep — the renderer paints the whole
      // backdrop off this and the Map labels the star with it.
      locale: {
        id: locale.id,
        name: locale.name,
        blurb: locale.blurb,
        hue: locale.hue,
        sat: locale.sat,
        feature: locale.feature,
        zoom: locale.zoom,
      },
      salvageBonus: locale.salvageDelta,
      theme: { variant: variant ? variant.id : "neutral", band: Math.floor(depth / 5), locale: locale.id },
      intro: `${sectorName(locale, depth, variantId)} — ${locale.name.toLowerCase()}. ${locale.blurb}`,
    };
  }

  const HypergolicLevels = { LEVELS, generateLevel, BOSS_DEPTH, localeAhead, LOCALES };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicLevels;
  } else {
    root.HypergolicLevels = HypergolicLevels;
  }
})(typeof window !== "undefined" ? window : globalThis);
