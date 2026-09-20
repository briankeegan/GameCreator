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
      // Sized to its roster, like every procedural sector. This was 9x11 —
      // the biggest board in the game — holding ONE contact, which is a
      // lot of empty hexes to cross before the tutorial fight happens.
      board: { type: "rect", cols: 7, rows: 8 },
      playerStart: { q: 3, r: 6 },
      exit: { q: 6, r: -3 },
      outpost: null,
      enemies: [{ type: "interceptor", q: 3, r: 2 }],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "autocannon"],
      intro: "One contact between us and the gate. Let it come to us.",
    },
    // Sector 2 — the Picket. The first thing in the run that can hurt you
    // from further away than you can hurt it, and it arrives at sector
    // TWO on purpose: the shallow end used to be one Interceptor asked
    // four different ways, so nothing new happened until the crawl. What
    // makes it fair this early is that it cannot fire inside two hexes and
    // only fires every OTHER round — the Autocannon you start with is a
    // complete answer to it, provided you work out that stepping off its
    // axis or closing on it are the same solution. Plus the first Outpost:
    // learning that a dock is where capability comes from.
    //
    // (It used to say "it CANNOT move". It has carried a sublightDrive
    // since the Scout was folded into it — see ENEMY_TYPES.picket.)
    {
      id: 2,
      name: "Picket Line",
      // Small, because the lesson is the LINE and nothing else. The archer
      // reaches five hexes and fires every other round, so on a big
      // board with something else pinning you it simply shoots you to
      // death while you walk — measured, a pilot that didn't know to break
      // the lane never reached the dock. One contact, short distances, and
      // the whole sector is "get off its axis, or get under it".
      board: { type: "rect", cols: 7, rows: 8 },
      playerStart: { q: 3, r: 6 },
      exit: { q: 6, r: -3 },
      // A pool of valid berths, not one fixed hex — see
      // computeOutpostCandidates above and engine.js's pickOutpostPos.
      outpost: true,
      // The Picket sits ON the middle column, i.e. squarely on the lane
      // between where you start and where the gate is, so the lesson is
      // unavoidable: fly straight at it and you eat two shots on the way
      // in. The Interceptor is off to one side to make sure you can't
      // just stand still and out-wait the lance.
      enemies: [{ type: "picket", q: 3, r: 2 }],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "autocannon"],
      intro: "Long gun on the approach — it reaches five hexes down every axis, and nothing at one. Get off its line. Station ahead is still trading.",
    },
    // Sector 3 — Sentry Line. The second kind of ground denial (a ring at
    // two rather than a lane at three) and, next to it, the Salvager: a
    // hostile carrying no gun at all and eight salvage. That pairing is
    // the sector — the safe target is the expensive one, and every round
    // spent cracking it is a round the Sentry gets for free.
    {
      id: 3,
      name: "Sentry Line",
      board: { type: "rect", cols: 7, rows: 9 },
      playerStart: { q: 3, r: 7 },
      exit: { q: 6, r: -3 },
      outpost: true,
      enemies: [
        { type: "sentry", q: 5, r: 1 },
        { type: "salvager", q: 2, r: 4 },
        { type: "interceptor", q: 3, r: 3 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      actions: ["sublight", "autocannon"],
      intro: "Gun platform holding station — it will not come to us, and it does not have to. The tug is unarmed and worth more than both of them.",
    },
    // Sector 4 — Full Fleet. Everything unlocked, and the last hand-authored
    // sector before the crawl goes procedural — so this is the outfitters
    // (running it dry meant arriving at depth 5 with a hold full of salvage
    // and no shelf to spend it on since sector 3).
    //
    // Three shapes at once, one of each thing the campaign has taught, plus
    // the Escort — the first screen, i.e. "everything takes one more shot
    // than you think" — which is a difficulty note rather than a new
    // question about ground, and so belongs last.
    {
      id: 4,
      name: "The Gauntlet",
      board: { type: "rect", cols: 7, rows: 10 },
      playerStart: { q: 3, r: 8 },
      exit: { q: 6, r: -3 },
      outpost: true,
      enemies: [
        { type: "picket", q: 3, r: 3 },
        { type: "escort", q: 5, r: 1 },
        { type: "cruiser", q: 2, r: 5 },
      ],
      hazards: [],
      exitRule: "all-enemies-dead",
      intro: "Three contacts, three different problems. The gate is open the whole way — we do not have to kill any of them.",
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

  // The six hexes touching this one. Same axial directions engine.js uses;
  // kept here so the generator can answer "can you actually walk there"
  // without loading the engine.
  const HEX_DIRS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
  function ringOf(hex) {
    return HEX_DIRS.map((d) => ({ q: hex.q + d.q, r: hex.r + d.r }));
  }

  // Hand-authored campaign sectors (2-4) declare `outpost: true` instead of
  // one fixed hex, plus this candidate pool — which berth a given run
  // actually gets is rolled per run in engine.js's pickOutpostPos, not
  // baked into the level data. Every hand-authored sector used to dock at
  // the exact same (0,0) corner on every single playthrough — "why is the
  // outpost always in the same place?" Same rules as a procedural sector's
  // berths below: on the board's edge, a real trip from where you spawn,
  // and never close enough to a gate to dock in passing.
  function computeOutpostCandidates(level) {
    const cols = level.board.cols;
    const rows = level.board.rows;
    const isBorder = (h) => {
      const col = h.q;
      const row = h.r + Math.floor(col / 2);
      return col === 0 || col === cols - 1 || row === 0 || row === rows - 1;
    };
    const gates = level.exits && level.exits.length ? level.exits : [level.exit];
    const blocked = new Set(
      [level.playerStart, ...gates, ...level.enemies, ...(level.hazards || [])].map((h) => `${h.q},${h.r}`)
    );
    const candidates = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const h = { q: col, r: row - Math.floor(col / 2) };
        if (!isBorder(h) || blocked.has(`${h.q},${h.r}`)) continue;
        if (hexDist(h, level.playerStart) < 4) continue;
        if (gates.some((g) => hexDist(h, g) < 3)) continue;
        candidates.push(h);
      }
    }
    return candidates;
  }
  for (const level of LEVELS) {
    if (level.outpost === true) level.outpostCandidates = computeOutpostCandidates(level);
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
      // The Bulwark itself, at last — the thing the sector is named after
      // was until now a board of ordinary hostiles wearing its name. Five
      // Hull of plating, bolted down (no drive), carrying BOTH ends of the
      // roster: a Railgun down every axis and a Flak Burst covering
      // contact. Between them they rule out standing on its lanes and rule
      // out hugging it, so the fight is about finding the ground that's
      // left — off-axis, at two or three — and holding it while its escort
      // tries to push you back onto a lane.
      enemies: [
        { type: "bulwark", q: startCol, r: 2 },
        { type: "escort", q: 2, r: 5 },
        { type: "interceptor", q: 6, r: 4 },
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

  // Which classes a given depth is allowed to deal. Exported so anything
  // that documents the roster (the Threat Library page) reads the real
  // ladder rather than a transcription of it.
  function typePoolFor(depth) {
    // The ladder. Read it as "which QUESTIONS is this stretch of the run
    // allowed to ask", not as a difficulty curve — every class here is
    // one-shot, so a pool is a set of shapes, not a set of stat blocks.
    //
    // The campaign (sectors 1-4, hand-authored above) now teaches four of
    // them: contact, the anchored lane at three, the ring at two, and the
    // screen. It used to teach one — an Interceptor, four times, wearing
    // different names — which meant nothing genuinely new happened until
    // depth 8 and the shallow end was just long.
    //
    // The rule the ladder still obeys: a shape lands a sector or two AFTER
    // the gun that answers it reaches a shelf. What changed is the
    // recognition that ANCHORED reach is answerable with the starting kit
    // and MOBILE reach is not — the Scout measured at 4 wins in 40 in
    // sectors 1-4 and 22-to-7 head to head on identical seeds, and it was
    // never the range that did that, it was the range plus a drive.
    // So the Picket carries the long gun early, and the Scout — the same
    // gun that can also reposition — still waits for the shelf.
    // SECTOR ONE AND SECTOR TWO ARE NOT THE SAME SECTOR. They dealt from
    // one pool that was three-quarters Interceptor, so the opening of
    // every run was the same fight twice and the first genuinely new thing
    // a player saw was at depth 3.
    //
    // Nothing here can punish reach, because the ship is carrying a
    // contact-range Autocannon and nothing else: a two-hex gun at depth 1
    // is not a puzzle, it is a stalemate. But "no reach" does not have to
    // mean "another chaser" — the shallow end can still ask different
    // questions, as long as the answer is something a contact gun can give.
    if (depth < 2) {
      // The Salvager cannot hurt you at all: no gun, one hull, and worth
      // more than anything else on the board. Meeting one in the first
      // sector is where "not every contact is a fight you have to take"
      // gets taught, and it is safe to teach it with, because the worst it
      // can do is drag you a hex.
      return ["interceptor", "interceptor", "cruiser", "salvager"];
    }
    if (depth < 3) {
      // And the second sector is about GROUND rather than about ships. A
      // Sapper mines the hex it stands on — contact range, no reach to
      // answer, and a fuse you can simply walk out of. It is the first
      // time the board itself is the threat.
      return ["interceptor", "cruiser", "cruiser", "salvager", "sapper"];
    }
    return depth < 5
        ? // The cruiser's weight comes up, and the first anchored long gun
          // arrives — by now a shelf has had two chances to sell reach or
          // an Afterburner to close with.
          ["interceptor", "interceptor", "cruiser", "picket", "salvager"]
        : depth < 8
          ? // The campaign's shapes about GROUND, dealt in any combination
            // rather than one per sector, plus the Salvager's decision.
            // The Escort is deliberately not here: a screen isn't a new
            // question, it's a doubled answer, and at one gun fired per
            // round a stretch full of them is the same fight taking twice
            // as long while everything else on the board shoots for free.
            // Measured with it in this pool, the run fell off a cliff at
            // depth 7 (39 runs alive at 6, 23 at 7) and the death boards
            // were almost all cruiser+escort.
            // The Corsair lands here: a wedge two deep that hits
            // everything in it, on a hull that closes. It is the same
            // question the Cruiser asks (contact, in numbers) moved one hex
            // further out, which is exactly the sort of small re-ask this
            // stretch is for.
            ["interceptor", "interceptor", "cruiser", "cruiser", "corsair", "picket", "sentry", "salvager"]
          : depth < 11
            ? // The shelf has had three or four passes by now: the Scout
              // (reach that fires every round) and the Mortar (reach that
              // ignores cover) both land here, the Carrier makes backing
              // off to a flank stop working, and the Demolitionist asks
              // the only question in the game that isn't about a line or a
              // ring — though by here you have met it (Sector 4 and the
              // shallow crawl both deal it), so what depth 8 adds is a
              // bomb landing while three other things are also asking you
              // to be somewhere.
              // Two more here. The Outrider is the first hull that shoots
              // while WITHDRAWING — everything up to now either stood and
              // traded or backed off and stopped shooting, so "close on it
              // and it stops hurting you" quietly worked on the whole
              // roster. The Sapper mines the ground it is leaving, which
              // makes chasing anything across this stretch a real decision.
              ["interceptor", "cruiser", "corsair", "picket", "cutter", "escort", "carrier", "demolitionist", "outrider", "sapper", "sentry", "bombard", "salvager"]
            : // Everything, including the two that shoot the length of the
              // board. The Interceptor stays in the pool — it was dropped
              // here at some point and that only made the deep end MORE
              // uniform, which is the exact problem this ladder exists to
              // avoid.
              // Everything, plus the Impaler — the one gun in the game
              // that goes THROUGH a hull. Deep boards are where hostiles
              // stack up in lines and where hiding behind one of them was
              // the free answer to the other two.
              ["interceptor", "cruiser", "corsair", "picket", "cutter", "escort", "carrier", "demolitionist", "outrider", "sapper", "impaler", "sentry", "bombard", "lancer", "railgun", "salvager",
                // The pirates. A whole faction is a large step, so it lands
                // where a ship has a developed hold to answer it with — and
                // measured, four new classes spread across the middle tiers
                // cost 15 points of win rate between them, none of them
                // individually.
                "splitter", "harrier", "outrunner", "corsairLead"];
  }

  // Tunables read from the environment when there IS one. `process` does
  // not exist in a browser, and an unguarded read of it throws a
  // ReferenceError in the middle of a round — which is how a "measurement
  // only, default unchanged" line broke the live game.
  function envNumber(name, fallback) {
    try {
      if (typeof process === "undefined" || !process.env) return fallback;
      const raw = process.env[name];
      return raw === undefined || raw === "" ? fallback : Number(raw);
    } catch (err) {
      return fallback;
    }
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
    // Pressure comes from NUMBERS and ground now, not from hull. Every
    // armed class is one-shot (only the Bulwark takes a second), which took
    // good play from 28% to 72% on its own — so the ramp climbs faster and
    // tops out higher to pay that back. This is the honest lever: another
    // contact is another gun, another firing arc and another thing that can
    // jam its own wingman, where another hit point was only ever a longer
    // turn count.
    const roster = Math.max(
      1,
      Math.min(1 + Math.floor(depth / 3) + (variant ? variant.enemyDelta : 0) + locale.enemyDelta, ceiling, 5)
    );
    // Two candidate sizes per roster so sectors of the same weight still
    // don't all look alike; the seeded roll picks one.
    // Never wider than tall: the game is a portrait cockpit, and a board
    // that runs wide shrinks every hex to fit the screen's width while
    // leaving vertical room unused. Growth goes downrange, not sideways.
    // Two rows deeper than the boards were. A phone is a tall window and
    // the grid was filling about half its height and four fifths of its
    // width — the fit is min(width, height), so on a board wider than it
    // is tall the width binds and the rest of the screen is wasted. Growth
    // goes downrange, not sideways: the column counts are unchanged.
    // NARROW AND DEEP. A phone is a tall window, and the board is fitted
    // by whichever of width or height binds first — so a board wider than
    // it is tall wastes the screen twice over: the width decides the hex
    // size, and then half the height goes empty. These are all taller than
    // they are wide, which is also what "growth goes downrange, not
    // sideways" was always supposed to mean.
    const SIZE_FOR_ROSTER = {
      1: [{ cols: 5, rows: 7 }, { cols: 5, rows: 7 }],
      2: [{ cols: 5, rows: 7 }, { cols: 5, rows: 8 }],
      3: [{ cols: 5, rows: 8 }, { cols: 7, rows: 8 }],
      4: [{ cols: 7, rows: 8 }, { cols: 7, rows: 9 }],
      5: [{ cols: 7, rows: 9 }, { cols: 7, rows: 10 }],
      6: [{ cols: 7, rows: 10 }, { cols: 7, rows: 10 }],
      7: [{ cols: 7, rows: 10 }, { cols: 7, rows: 10 }],
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
    // Column DERIVED, not typed: one left of the centre gate, and never
    // column 0 (the Outpost's fixed berth). Hard-coded to 2, it landed on
    // top of the centre gate the moment a board was five columns wide,
    // and the level failed to build at all.
    const driftCol = Math.max(1, startCol - 1);
    if (rng() < 0.8) exits.push({ q: driftCol, r: -Math.floor(driftCol / 2), variantId: "drift" });
    const exit = exits[0]; // primary/first gate — every non-branching call site reads this
    // Not every sector gets an Outpost — a guaranteed safe restock every
    // Not every sector trades. Somebody has to actually be out here, and
    // that's a property of WHERE you are: scrappers work the Breakers,
    // nobody is selling anything in the Deep. A dry stretch is a real
    // thing that happens to a run, and a reason to take the other gate.
    // MEASURED: at a 0.6 base, two in five generated sectors had no dock at
    // all, and a sector with nowhere to spend banks 100% of what it earns —
    // Sector 11 did exactly that, immediately before the Bulwark, and it
    // was one of the three biggest leaks in the economy (+12.6 salvage a
    // run, against a total surplus of 52). FTL guarantees ONE TO THREE
    // stores per sector by sector type and never leaves a run dry on a coin
    // flip; a dry stretch there is a property of where you are, which is
    // what the variant and locale deltas below already express. So the base
    // rises and the deltas keep doing the work: an aggressive sector is
    // still likelier to be dry than a quiet one, it just is not a 40%
    // chance everywhere.
    const outpostChance = Math.min(
      0.9,
      Math.max(0.05, 0.75 + (variant ? variant.outpostChanceDelta : 0) + locale.outpostDelta)
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
    // GROUND, and how much of it. Boards ran at about 2% rock and nothing
    // else, which is an open field: a gun that holds its range has six
    // free hexes to slide between and never has to let you close. Measured
    // over 540 chases, taking rock to ~8% costs the closing ship half a
    // hull point less per engagement, and a scrambler field does the other
    // half of the job — a hostile sitting in one cannot shoot out of it, so
    // the hexes it likes to shoot from stop working.
    //
    // Spread, not clumped. Clustering the same count into walls measured
    // WORSE than scattering it, because what pins a sidestepping ship is
    // how many of its own six neighbours are blocked, and a wall blocks a
    // line while leaving the rest of the board open.
    // NINE PER CENT ROCK, AND NO CLOUD. Boards ran at about 2%, which is an
    // open field: a gun that holds its range has six free hexes to slide
    // between and never has to let you close.
    //
    // Nine is a share of the board and nothing else — an earlier version
    // added a depth bump on top, which made "9%" mean up to 20% by the
    // deep sectors and cost six wins in sixty. At a true 9% the four hulls
    // score 22/20/22/22 against 22/19/19/20 on bare boards: four times the
    // cover, free.
    //
    // Scrambler fields stay at zero. A ship inside one cannot fire, which
    // reads like an answer to a hostile that holds its distance and
    // measures like one over a single chase — and costs eight wins in
    // sixty over whole runs, because denying firing positions punishes
    // whichever side has to shoot to finish, and that is the flagship.
    // The rule stays in the engine; the dial is here when it is worth
    // revisiting as rare, placed ground rather than scatter.
    // ---- the sector's weather ------------------------------------------
    //
    // At most ONE of a condition or an objective, because two at once
    // stops reading as "this place is different" and starts reading as
    // noise. Both arrive on a drip rather than all at depth 3: the same
    // reasoning as the weapon unlocks, which hand out one thing a sector
    // so that each one gets noticed.
    //
    // Nothing lands before depth 3. The opening sectors are where the base
    // game is learned, and a rule that takes a system away is only
    // interesting once you know what the system does.
    // Debris Field waits for a board big enough to hold one. Every gate on a
    // Debris Field gets a two-hex lane cleared to it (see the terrain pass
    // below), and on a five-by-seven board with three gates and a berth
    // that lane IS the board — the "field" came out with exactly as much
    // rock on it as a plain sector.
    const CONDITION_DEPTH = { pickedClean: 3, nebula: 5, ionStorm: 5, debrisField: 6 };
    const OBJECTIVE_DEPTH = { holdFast: 4, collapse: 6 };
    const SECTOR_OBJECTIVE_IDS = OBJECTIVE_DEPTH;
    const weatherRng = seededRandom(depth * 2749 + variantSeedOffset + 17);
    let condition = null;
    let objective = null;
    // MEASUREMENT HOOKS, default off. GC_WEATHER=<id> puts the same
    // condition or objective on every sector from depth 3 and GC_WEATHER=
    // none clears them all, which is the only way to price one of these
    // on its own — the natural spread puts about seven weathered sectors
    // in a run and a whole-run win rate cannot tell which one cost what.
    const forced = typeof process !== "undefined" && process.env ? process.env.GC_WEATHER : "";
    if (forced === "none") {
      // nothing this sector, whatever the roll would have said
    } else if (forced && depth >= 3) {
      if (Object.prototype.hasOwnProperty.call(SECTOR_OBJECTIVE_IDS, forced)) objective = forced;
      else condition = forced;
    } else if (depth >= 3) {
      const roll = weatherRng();
      // WHICH one is a rotation, not a second coin flip. A sector's weather
      // is fixed for a given depth and gate (so is its board), which means
      // the whole game holds about twenty weathered sectors — and an
      // independent roll over five conditions left Dead Zone appearing in
      // exactly none of them. Nobody could ever meet it. Rotating through
      // the open list by the sector's own slot guarantees every entry is
      // reachable as soon as enough sectors are weathered, while WHETHER a
      // sector is weathered stays a roll.
      // The mix has to be COPRIME with the pool size or the rotation is not
      // one. Multiplying the depth by the number of gates meant depth
      // contributed exactly nothing once four conditions were open
      // (depth * 4 % 4 is 0), so which condition a sector carried was
      // decided purely by which gate you came through — Picked Clean
      // appeared eight times across the game and Debris Field none.
      const SLOTS = ["", "aggressive", "quiet", "drift"];
      const slot = depth * 7 + Math.max(0, SLOTS.indexOf(variantId || "")) * 3;
      const pick = (table) => {
        const open = Object.keys(table)
          .filter((id) => depth >= table[id])
          .sort();
        return open.length ? open[slot % open.length] : null;
      };
      // 33% a condition, 22% an objective, 45% an ordinary sector. An
      // ordinary sector has to stay the common case or the special ones
      // stop being special.
      if (roll < 0.33) condition = pick(CONDITION_DEPTH);
      else if (roll < 0.55) objective = pick(OBJECTIVE_DEPTH);
    }

    // Two of the conditions are nothing but the generator's own terrain
    // knobs turned up. That is deliberate: terrain applies to both sides
    // without anybody writing a rule for it, so a Debris Field cannot
    // become the game quietly cheating the way a combat modifier can.
    const ROCK_SHARE = envNumber("GC_ROCK", condition === "debrisField" ? 0.2 : 0.09);
    const CLOUD_SHARE = envNumber("GC_CLOUD", condition === "nebula" ? 0.09 : 0);
    // The cap exists so an ordinary sector never turns into a maze; a
    // Debris Field is allowed to be one.
    const rockCap = condition === "debrisField" ? 26 : 14;
    const rockSpacing = condition === "debrisField" ? 1 : 2;
    const rockCount = Math.max(0, Math.min(Math.round(area * ROCK_SHARE), rockCap));
    const cloudCount = Math.max(0, Math.round(area * CLOUD_SHARE));
    const hazards = [];
    for (const hex of candidates) {
      if (hazards.length >= rockCount) break;
      if (exits.some((ex) => hexDist(hex, ex) < 2) || (outpost && hexDist(hex, outpost) < 2)) continue;
      // ROCK IS NORMALLY SPACED OUT, and a Debris Field is normally what
      // happens when it isn't. The spacing rule keeps an ordinary sector
      // from turning into a maze, but it also meant raising the density
      // for a Debris Field placed no extra rock at all — the board simply
      // ran out of hexes two apart from each other, and a "field" came out
      // with FEWER boulders on it than a plain sector. Letting them touch
      // is the whole point: touching rock is cover and a chokepoint, which
      // is what makes something that holds you at range two catchable.
      if (hazards.some((h) => hexDist(h, hex) < rockSpacing)) continue;
      hazards.push({ type: "asteroid", q: hex.q, r: hex.r });
    }
    // Cloud goes down after the rock and may sit beside itself — a field of
    // ionised dust is a field, not a scatter of boulders. It never blocks
    // anything, so it is allowed nearer the furniture than rock is.
    // PATCHES, not a sprinkle. A field of ionised dust is a place on the
    // board you can duck into, which is how the games that use this kind of
    // ground use it; scattering the same number of hexes evenly is just a
    // tax on everyone's firing positions. GC_CLOUD_PATCH sets how many
    // hexes one patch is.
    const PATCH = Math.max(1, Math.round(envNumber("GC_CLOUD_PATCH", 4)));
    let clouds = 0;
    for (const hex of candidates) {
      if (clouds >= cloudCount) break;
      if (hazards.some((h) => h.q === hex.q && h.r === hex.r)) continue;
      if (exits.some((ex) => hexDist(hex, ex) < 2) || (outpost && hexDist(hex, outpost) < 2)) continue;
      // Grow one patch from here, so the cloud is somewhere rather than
      // everywhere.
      const seedHex = hex;
      for (let dq = -1; dq <= 1 && clouds < cloudCount; dq++) {
        for (let dr = -1; dr <= 1 && clouds < cloudCount; dr++) {
          if (Math.abs(dq + dr) > 1) continue; // stay on the hex ring
          const at = { q: seedHex.q + dq, r: seedHex.r + dr };
          if (!candidates.some((c) => c.q === at.q && c.r === at.r)) continue;
          if (hazards.some((h) => h.q === at.q && h.r === at.r)) continue;
          if (exits.some((ex) => hexDist(at, ex) < 2) || (outpost && hexDist(at, outpost) < 2)) continue;
          hazards.push({ type: "scrambler", q: at.q, r: at.r });
          clouds++;
          if (clouds % PATCH === 0) break;
        }
        if (clouds % PATCH === 0) break;
      }
    }
    // ---- THE GATE HAS TO BE REACHABLE ----------------------------------
    //
    // Nothing checked this until a Debris Field was built. At the old
    // density, with rock forbidden from sitting next to rock, a wall could
    // not form and the question never came up; let the boulders touch and
    // twenty-six runs in sixty stalled outright on a sector whose gate was
    // simply behind a wall. The player's version of that is a board they
    // cannot finish, so this is a guarantee and not a tuning knob.
    //
    // Carve rather than re-roll: take the straight path the board would
    // have if there were no rock at all, and clear whatever rock is
    // standing on it. One pass per thing that has to be reachable, and it
    // always terminates.
    {
      const key = (h) => `${h.q},${h.r}`;
      const onBoard = new Set(hexes.map(key));
      const blocked = () => new Set(hazards.filter((h) => h.type === "asteroid").map(key));
      // Every hex the flagship can get to, walking around rock.
      const reachable = (from) => {
        const walls = blocked();
        const seen = new Set([key(from)]);
        const queue = [from];
        while (queue.length) {
          const at = queue.shift();
          for (const to of ringOf(at)) {
            const k = key(to);
            if (seen.has(k) || !onBoard.has(k) || walls.has(k)) continue;
            seen.add(k);
            queue.push(to);
          }
        }
        return seen;
      };
      // The shortest route ignoring rock entirely — what we are willing to
      // dig out to reach `goal`.
      const straightPath = (from, goal) => {
        const seen = new Map([[key(from), null]]);
        const queue = [from];
        while (queue.length) {
          const at = queue.shift();
          if (at.q === goal.q && at.r === goal.r) break;
          for (const to of ringOf(at)) {
            const k = key(to);
            if (seen.has(k) || !onBoard.has(k)) continue;
            seen.set(k, at);
            queue.push(to);
          }
        }
        const path = [];
        let at = goal;
        while (at && seen.has(key(at))) {
          path.push(at);
          at = seen.get(key(at));
        }
        return path;
      };
      // TWO HEXES WIDE, not one. A single-file corridor is connected and
      // still unplayable: one hostile standing in it seals the board, and
      // the ship bounces off the plug until the round limit. Measured, a
      // forced Debris Field stalled 20 runs in 60 that way even with
      // connectivity guaranteed. Clearing the lane's neighbours as well
      // means rock can be cover without ever being a cork.
      const dropRockAt = (k) => {
        for (let i = hazards.length - 1; i >= 0; i--) {
          if (hazards[i].type === "asteroid" && key(hazards[i]) === k) hazards.splice(i, 1);
        }
      };
      const clearLane = (goal) => {
        for (const hex of straightPath(playerStart, goal)) dropRockAt(key(hex));
      };
      // UNCORK, rather than widen. Clearing a two-hex lane to every gate
      // was the first attempt and it removed the field: with three gates
      // and a berth to reach, the lanes ARE the board, and a Debris Field
      // came out holding less rock than a plain sector. What actually
      // causes the deadlock is a lane hex with only one way out of it, so
      // that is the only thing fixed — every hex on the route keeps at
      // least two free neighbours, and the rest of the rock stays where it
      // fell.
      const uncorkLane = (goal) => {
        for (const hex of straightPath(playerStart, goal)) {
          const walls = blocked();
          const sides = ringOf(hex).filter((h) => onBoard.has(key(h)));
          let free = sides.filter((h) => !walls.has(key(h)));
          for (const side of sides) {
            if (free.length >= 2) break;
            if (!walls.has(key(side))) continue;
            dropRockAt(key(side));
            free = free.concat([side]);
          }
        }
      };
      const mustReach = [...exits, ...(outpost ? [outpost] : [])];
      // PASS ONE, every board: nothing may be walled off. Narrow, because
      // digging a wide lane on every board unconditionally is not a free
      // safety net — it strips an ordinary sector of nearly all its rock,
      // and that rock is cover the player was using. Measured: sixty runs
      // went from 23 wins to 9.
      for (const goal of mustReach) {
        if (reachable(playerStart).has(key(goal))) continue;
        clearLane(goal);
      }
      // PASS TWO, a Debris Field only. This is the condition that lets rock
      // sit next to rock, and single-file is where that bites: a corridor
      // one hex wide is CONNECTED and still unplayable, because one
      // hostile standing in it corks the board. Measured at 20 stalls in
      // 60 with connectivity already guaranteed. Rock can be cover; it
      // must never be a cork.
      if (condition === "debrisField") for (const goal of mustReach) uncorkLane(goal);
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
    // The second wave slots into that same discipline — each new class is
    // a new QUESTION, introduced once there's an answer to it on a shelf:
    //   scout    — depth 1. Same question as an Interceptor, asked by more
    //              of them at once. It's the cheapest thing in the sky and
    //              it belongs in the shallow end.
    //   salvager — depth 5. Carries no gun at all; it's a decision about
    //              time, not about damage, so it can't make a board
    //              harder to survive, only more tempting to linger on.
    //   escort   — depth 5, alongside it: the first hostile screen, i.e.
    //              "everything takes one more shot than you think". Lands
    //              at the tier where a second gun is realistically fitted.
    //   carrier  — depth 8. Three Hull that walks at you and detonates a
    //              full ring in contact. Wants an answer at range, which
    //              is exactly what the depth-8 shelf is selling.
    const typePool = typePoolFor(depth);
    // At most TWO emplacements on a board. A Sentry or a Railgun Destroyer
    // doesn't chase you — it denies ground — and three of them on a 9x11
    // field is a wall with no way around it, which is exactly what full-run
    // playtesting kept dying to (fourteen of thirty deaths on boards of
    // three Sentries and a Railgun). Two is a gauntlet you can route
    // through; three is a corridor with a gun at the end of it.
    // Ground-denial units, capped at two per board. The Scout belongs here
    // now even though it flies: it owns three hexes of every axis and
    // gives ground rather than trading, which denies space exactly the way
    // a fixed gun does. Measured while it was uncapped, the wall was a
    // board of one archer and one Sentry — the beam owning the lanes and
    // the ring owning everything at two, between them leaving nowhere to
    // stand. Ten of forty runs ended on that pair.
    // Only the Sentry. The Bombard, the Railgun Destroyer and the Picket
    // all fly now — their hulls always said so — so the thing this cap is
    // guarding against, a board of guns you cannot make move, is one class.
    const EMPLACEMENTS = new Set(["sentry"]);
    // A hard cap of ONE long gun per board, and it is the most load-bearing
    // number in this file. The archer and the Cutter reach five hexes and
    // fire every round or every other round; two of them on one board is
    // two damage a round arriving from off-screen while you are still
    // walking, and no amount of good play answers that with three hull.
    // Hoplite deals its ranged demons the same way — sparingly, and never
    // as the bulk of a floor.
    const LONG_GUNS = new Set(["picket", "cutter", "railgun", "outrunner"]);
    // ...but never MOST of the board. Two was a flat cap regardless of how
    // many hostiles the sector deals, so a two- or three-strong roster
    // could come out half or two thirds bolted to the deck — and a board
    // where most of what you can see never comes after you doesn't read as
    // ground to route through, it reads as a board of things that are
    // broken. ("Why are some of the ships just not moving?") Measured at
    // the flat cap: 38% of every hostile in the game had no engine, and 8
    // boards in 25 were at least half static. Fewer than half, always, so
    // the thing hunting you always outnumbers the thing sitting there.
    // One on anything up to four hostiles, two on a five. Never a majority.
    const staticCap = enemyCount <= 4 ? 1 : 2;
    // The same argument as EMPLACEMENTS, applied to durability instead of
    // to zoning. An Escort takes one more shot than it looks like it
    // should and a Carrier takes two; a board of nothing but those is not
    // harder, it's just longer, and at one gun fired per round "longer"
    // means every chaser on the map gets extra free turns while you grind.
    // Two per board keeps them a complication rather than the whole sum.
    const HEAVIES = new Set(["escort", "carrier", "corsairLead"]);
    const MOBILE = ["interceptor", "cruiser", "escort", "lancer", "demolitionist"];
    const enemies = [];
    const LIGHT = ["interceptor", "cruiser"];
    const SPLITS = new Set(["splitter"]);
    let emplaced = 0;
    let heavies = 0;
    let longGuns = 0;
    let splitters = 0;
    for (const hex of candidates) {
      if (enemies.length >= enemyCount) break;
      if (hazardKeys.has(`${hex.q},${hex.r}`)) continue;
      if (enemies.some((e) => hexDist(e, hex) < 2)) continue; // keep fresh spawns from stacking
      let type = typePool[Math.floor(rng() * typePool.length)];
      if (EMPLACEMENTS.has(type)) {
        if (emplaced >= staticCap) type = MOBILE[Math.floor(rng() * MOBILE.length)];
        else emplaced++;
      }
      if (LONG_GUNS.has(type)) {
        if (longGuns >= 1) type = MOBILE[Math.floor(rng() * MOBILE.length)];
        else longGuns++;
      }
      if (HEAVIES.has(type)) {
        if (heavies >= 2) type = LIGHT[Math.floor(rng() * LIGHT.length)];
        else heavies++;
      }
      // ONE hull that dies into others, at most. The board is sized to its
      // roster, so a class that leaves two chasers behind is spending
      // density the board was never measured for — two of them turns a
      // sized board into an unsized one after the fact.
      if (SPLITS.has(type)) {
        if (splitters >= 1) type = LIGHT[Math.floor(rng() * LIGHT.length)];
        else splitters++;
      }
      enemies.push({ type, q: hex.q, r: hex.r });
    }

    // The nulls above were budget placeholders for what a Splitter becomes.
    // Rare discovery candidates — see engine.js's pickDiscovery. This file
    // only lists WHERE one COULD go; whether one actually appears, and
    // which spot wins, is rolled per RUN in engine.js, deliberately not
    // here. This generator's own rng is seeded purely off (depth,
    // variantId) — right for the board itself (same depth deals the same
    // board), but rolling a Discovery's presence here too would make it
    // permanently fixed for a given depth, the exact bug just fixed for
    // the campaign Outpost.
    const occupiedKeys = new Set([
      ...hazards.map((h) => `${h.q},${h.r}`),
      ...enemies.map((e) => `${e.q},${e.r}`),
      ...(outpost ? [`${outpost.q},${outpost.r}`] : []),
    ]);
    const discoveryCandidates = candidates.filter(
      (h) => !occupiedKeys.has(`${h.q},${h.r}`) && exits.every((ex) => hexDist(h, ex) >= 2)
    );

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
      discoveryCandidates,
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
      // The sector's own weather. The engine reads these by id off its own
      // registry (SECTOR_CONDITIONS / SECTOR_OBJECTIVES) — this file names
      // one and never says what it does, so the rule lives in exactly one
      // place.
      condition,
      objective,
      intro: `${sectorName(locale, depth, variantId)} — ${locale.name.toLowerCase()}. ${locale.blurb}`,
    };
  }

  const HypergolicLevels = { LEVELS, generateLevel, typePoolFor, BOSS_DEPTH, localeAhead, LOCALES };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicLevels;
  } else {
    root.HypergolicLevels = HypergolicLevels;
  }
})(typeof window !== "undefined" ? window : globalThis);
