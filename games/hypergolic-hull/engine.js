          // One reactor, so the Lance fires every other round — and the
          // round in between is spent MOVING, not standing still, which is
          // the difference the AI makes rather than the hold. It ran on
          // two for a while, purely so a bearing Scout could always afford
          // its shot and could never fire-then-give-ground; decideIntent
          // forbids that directly now (a gun that bears may only close),
          // so the second generator was buying nothing but damage.
// engine.js — deterministic hex-tactics engine for Hypergolic Hull.
//
// Pure game logic, no DOM/canvas. Runs identically in the browser (attached
// to window.HypergolicEngine) and under plain Node (module.exports), so the
// same code that plays the game also drives the headless golden-path test
// in engine.test.js. Nothing about a specific level is hardcoded here — see
// levels.js.
(function (root) {
  "use strict";

  // ---- hex math (axial coordinates, pointy-top) --------------------------

  // Direction index 0..5, clockwise, matching redblobgames' axial layout.
  // Interceptor movement ties break by scanning this array in order.
  const DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];

  function hexKey(pos) {
    return `${pos.q},${pos.r}`;
  }

  function posEq(a, b) {
    return a.q === b.q && a.r === b.r;
  }

  function hexDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  }

  function neighbor(pos, dirIndex) {
    const d = DIRECTIONS[dirIndex];
    return { q: pos.q + d.q, r: pos.r + d.r };
  }

  function neighbors(pos) {
    return DIRECTIONS.map((d) => ({ q: pos.q + d.q, r: pos.r + d.r }));
  }

  function isAdjacent(a, b) {
    return hexDistance(a, b) === 1;
  }

  function inBounds(pos, radius) {
    return hexDistance({ q: 0, r: 0 }, pos) <= radius;
  }

  // Direction index that walks from `from` to an adjacent `to`, or -1.
  function directionIndex(from, to) {
    for (let i = 0; i < 6; i++) {
      if (posEq(neighbor(from, i), to)) return i;
    }
    return -1;
  }

  // ---- board shapes ---------------------------------------------------------
  //
  // Two shapes: the classic hexagon (`radius`) and Hoplite-style rectangles
  // (`board: {type: "rect", cols, rows}`) that run taller than wide on a
  // phone. Rect boards are flat-top hexes laid out in offset COLUMNS (not
  // offset rows): column q spans r = -floor(q/2) .. rows-1-floor(q/2),
  // q = 0..cols-1 (left to right). This — combined with the renderer using
  // flat-top pixel math (see hexToPixel in app.js) — is what makes
  // direction {q:0,r:-1} a true single-step "straight up" and {q:0,r:1}
  // "straight down": under a flat-top layout, two of the six neighbor
  // directions are purely vertical (Clubhouse feedback: "the board needs to
  // be turned so you can go straight up" — pointy-top hexes genuinely can't
  // do this in one step, only flat-top can).
  function buildBoardHexes(level) {
    const hexes = [];
    if (level.board && level.board.type === "rect") {
      for (let col = 0; col < level.board.cols; col++) {
        for (let row = 0; row < level.board.rows; row++) {
          hexes.push({ q: col, r: row - Math.floor(col / 2) });
        }
      }
    } else {
      for (let q = -level.radius; q <= level.radius; q++) {
        for (let r = -level.radius; r <= level.radius; r++) {
          if (hexDistance({ q: 0, r: 0 }, { q, r }) <= level.radius) hexes.push({ q, r });
        }
      }
    }
    return hexes;
  }

  function onBoard(state, pos) {
    return state.boardHexes.some((h) => posEq(h, pos));
  }

  // Fighter Squadron and Random Blink were cut entirely (Clubhouse:
  // "remove Random Blink and Fighter Squadron... make everything work
  // within the system") — Blink was the game's only random combat
  // mechanic and Fighter Squadron was a free instant-kill living outside
  // the weapon/energy model. Everything left runs on the same
  // stats + energy + slots chassis.
  const ALL_ACTIONS = ["sublight", "autocannon", "flakBurst", "arcBeam", "mortar", "flankTubes", "railgun", "missilePod", "beamLance", "arcProjector", "demolitionCharge", "prowCannon", "siegeMaul"];
  // Purchase-only actions (see OUTPOST_OFFER_POOL/applyOutpostPurchase) —
  // never part of any level's own baked-in `actions` list, and excluded
  // from the default fallback below so they don't show up for free the
  // per Clubhouse feedback ("you should not start with it") — it's still
  // guaranteed claimable (free) at Sector 2's Outpost specifically (see
  // pickOutpostOfferIds), just no longer handed out automatically for
  // reaching the sector.
  const PURCHASABLE_ACTIONS = ["flakBurst", "arcBeam", "mortar", "flankTubes", "railgun", "missilePod", "beamLance", "arcProjector", "demolitionCharge", "prowCannon", "siegeMaul"];
  // Sectors that don't specify `actions` explicitly (Sector 4 "Full Fleet"
  // and every procedurally-generated sector) default to every action that
  // unlocks just by playing.
  const DEFAULT_ACTIONS = ALL_ACTIONS.filter((a) => !PURCHASABLE_ACTIONS.includes(a));

  // ---- level validation ---------------------------------------------------

  // A level normally has one Warp Gate (`exit`); a branching sector (see
  // levels.js's generateLevel) instead lists 2+ in `exits`, each tagged
  // with a `variantId` — "different sort of paths you could take... based
  // on the different portals" (Clubhouse feedback). Every other code path
  // (validation, state, win-check) treats `exit` as just `exits[0]`.
  function exitList(level) {
    return level.exits && level.exits.length ? level.exits : [level.exit];
  }

  function validateLevel(level) {
    const hexes = buildBoardHexes(level);
    const keys = new Set(hexes.map(hexKey));
    const isBorder = (pos) => neighbors(pos).some((n) => !keys.has(hexKey(n)));
    const mustBeOn = (label, pos) => {
      if (!keys.has(hexKey(pos))) throw new Error(`Level ${level.id}: ${label} at ${hexKey(pos)} is off the board`);
    };

    mustBeOn("playerStart", level.playerStart);
    const exits = exitList(level);
    exits.forEach((ex, i) => {
      const label = exits.length > 1 ? `exit${i}` : "exit";
      mustBeOn(label, ex);
      if (!isBorder(ex)) throw new Error(`Level ${level.id}: ${label} is not on the board's edge`);
    });
    if (level.outpost === true) {
      // Hand-authored sector: a pool of valid berths, not one fixed hex —
      // see pickOutpostPos. Every candidate has to be a real, on-edge spot,
      // since any one of them can be the one a given run actually gets.
      const candidates = level.outpostCandidates || [];
      if (!candidates.length) {
        throw new Error(`Level ${level.id}: outpost is true but outpostCandidates is empty`);
      }
      candidates.forEach((c, i) => {
        mustBeOn(`outpostCandidates[${i}]`, c);
        if (!isBorder(c)) {
          throw new Error(`Level ${level.id}: outpostCandidates[${i}] is not on the board's edge`);
        }
      });
    } else if (level.outpost) {
      mustBeOn("outpost", level.outpost);
      if (!isBorder(level.outpost)) {
        throw new Error(`Level ${level.id}: outpost is not on the board's edge`);
      }
    }
    // Discovery candidates (see pickDiscovery) — unlike the Outpost, not
    // restricted to the border; anywhere clear of spawn/gates/other
    // entities is fair game, same ground procedural hazards are picked
    // from. Optional: a level with none just never rolls one.
    for (const [i, c] of (level.discoveryCandidates || []).entries()) {
      mustBeOn(`discoveryCandidates[${i}]`, c);
    }
    for (const enemy of level.enemies) {
      mustBeOn("enemy", enemy);
      if (hexDistance(level.playerStart, enemy) < 2) {
        throw new Error(`Level ${level.id}: enemy at ${hexKey(enemy)} is within 2 hexes of playerStart`);
      }
    }
    for (const hazard of level.hazards || []) mustBeOn("hazard", hazard);
    if (level.actions) {
      for (const a of level.actions) {
        if (!ALL_ACTIONS.includes(a)) throw new Error(`Level ${level.id}: unknown action "${a}"`);
      }
      if (!level.actions.includes("sublight")) {
        throw new Error(`Level ${level.id}: sublight can never be locked`);
      }
    }
    const seen = new Map();
    const entities = [
      { label: "playerStart", pos: level.playerStart },
      ...exits.map((ex, i) => ({ label: exits.length > 1 ? `exit${i}` : "exit", pos: ex })),
      // A boolean outpost is a pool of candidate berths, not a placed
      // entity — pickOutpostPos resolves it to one hex per run, and each
      // candidate was already checked for a clear approach when it was
      // built (see levels.js's outpost candidate helper), so there's
      // nothing here for the shared-hex check to compare against.
      ...(level.outpost && level.outpost !== true ? [{ label: "outpost", pos: level.outpost }] : []),
      ...level.enemies.map((e, i) => ({ label: `enemy${i}`, pos: e })),
      ...(level.hazards || []).map((h, i) => ({ label: `hazard${i}`, pos: h })),
    ];
    for (const entity of entities) {
      const k = hexKey(entity.pos);
      if (seen.has(k)) {
        throw new Error(`Level ${level.id}: ${entity.label} shares a hex with ${seen.get(k)}`);
      }
      seen.set(k, entity.label);
    }
  }

  // ---- game state -----------------------------------------------------------

  // Three Hull to start: a run can now soak a couple of hits, which is what
  // turns this from a pure-skill puzzle into a luck-and-skill crawl — room to
  // trade Hull for tempo, recover from a bad roll, and let salvage/repairs
  // matter. (Was 1: one-hit permadeath.)
  // THREE. It went to five for a while and came back, and the round trip
  // is the useful part: five was compensating for something else being
  // wrong. When every class went to full strength the run collapsed —
  // sixty runs, three finishes — and more hull did paper over it, but at
  // five the early sectors stopped costing anything and at six the first
  // SEVEN did.
  //
  // The actual cause was BOARD SIZE. Nothing with an engine ever wastes a
  // turn now, so every round spent crossing a sector is a round under
  // fire, and our sectors were big enough that routing around a threat
  // cost more hull than fighting it. Hoplite's floors are small and that
  // is precisely why avoidance works there. Taking a row off the
  // procedural boards (levels.js, SIZE_FOR_ROSTER) fixed it at the cause,
  // and three hull works again — measured, it is now the CAREFUL pilot
  // that finishes most (30 runs in 60 against greedy's 23, with no
  // stalls), which is the first time in this game's history that flying
  // well has beaten flying hard.
  //
  // What makes three playable rather than arbitrary is unchanged: the gate
  // is always open, you are never required to trade hits, and a contact
  // you route around costs nothing — and now, since the boards are small
  // enough to actually route across, that is a real option rather than a
  // slogan.
  const START_HULL = 3;

  // Energy is a second resource, distinct from Hull (permanent damage,
  // repaired only at an Outpost) and salvage (a currency): it regenerates
  // on its own, 1 per turn, and pays for every weapon shot — the
  // flagship's AND every enemy's ("Energy refills between jumps. Health
  // does not" — long-standing Clubhouse design intent, now the real
  // constraint on how many weapon systems you can afford to keep firing).
  // The reactor is deliberately bigger than any single shot while every
  // shot costs MORE than the +1/turn regen: a firing turn always nets
  // negative, so the gauge visibly drains in combat and climbs back out
  // of it. (An earlier tuning had the Shockwave cost exactly the regen —
  // the bar refilled the same turn it drained and never visibly moved,
  // which read as "energy isn't hooked up" in playtesting.)
  const START_ENERGY = 6;
  // The Reactor Core's per-cycle gain — the ONLY way Energy comes back
  // mid-sector. No passive trickle: energy refills to full at every warp
  // jump ("Energy refills between jumps"), and recovering under fire
  // costs a whole turn on purpose. The STANDARD starting reactor cycles
  // just +1 ("it should just recharge one, not two") — a better reactor
  // is a future equipment swap, and this number goes with the item.
  const RECHARGE_ENERGY_GAIN = 1;
  // The Hold: the ship's internals are a GRID of cells, and every piece
  // of equipment is a SHAPED tile — its footprint IS its cost ("a grid
  // drag and drop for different sized/shaped items"). Starts 5x4; grown
  // via the Hold Expansion Outpost offer.
  const HOLD_COLS = 5;
  const HOLD_ROWS = 6;
  // Cells OUTSIDE the flagship's hull — the usable cells form the ship's
  // silhouette: a single-cell nose, widening shoulders, a full midsection,
  // and a narrower engine deck at the stern. A Hold Expansion adds an
  // (unmasked) full row of engineering deck below.
  const HOLD_BLOCKED = ["0,0", "1,0", "3,0", "4,0", "0,1", "4,1", "0,5", "4,5"];
  // Action Points per round, both sides of the board. Dialed back to 1
  // ("maybe you could just do one thing, and that is a turn") — one
  // action IS the round, for the flagship and every enemy alike. The AP
  // plumbing (spendAp/applyEndTurn/maxAp carryOver) deliberately stays
  // intact so a 2-AP round (or a +1 AP upgrade) can come back as pure
  // data, "in case we decide to put it back."
  const START_AP = 1;
  const ENEMY_AP = 1;

  // ---- weapon systems ---------------------------------------------------
  //
  // The same stat block (range/damage/targets/energyCost/pattern/slots)
  // drives both the flagship's systems and every enemy type's attack — one
  // combat model for both sides, not a player-only mechanic plus
  // separately-hardcoded enemy AI math. That matters because this is meant
  // to grow into a roguelike: new enemies (and new player weapons) should
  // just be new entries in these tables, not new bespoke code paths.
  // `targets: "all"` hits every enemy the pattern finds in range at once,
  // rather than capping at one.
  //
  // `pattern` is a list of direction offsets (0-5, clockwise) relative to
  // the shooter's facing — `[0]` means "dead ahead only" (a forward-firing
  // cannon), `[0,1,2,3,4,5]` means every direction at once (omnidirectional,
  // facing irrelevant since it covers all six regardless of which one is
  // "ahead").
  //
  // `energyCost` is REAL for both sides ("make everything work within the
  // system"): a weapon that would fire but can't afford its cost holds
  // fire that turn. The flagship regens +1 Energy per turn (see
  // enemyPhase); enemies regen the same way off their own pools (see
  // ENEMY_TYPES), which is what gives a heavy weapon like the Railgun its
  // visible multi-turn charge-up rhythm instead of firing every turn.
  //
  // `slots` is how many weapon-slot points the system occupies while
  // installed in the Hold — its grid footprint is the real cost now.
  //
  // `speed` is INITIATIVE, and it's real: when a turn resolves, every
  // attack on the board — the flagship's and the enemies' — fires in
  // descending speed order within each side's own phase (see enemyPhase
  // and applyFire).
  // 3 = fast (point defense: pre-empts a standard attacker), 2 = standard,
  // 1 = heavy (hits hard, but the target shoots first). A dead or
  // pushed-away attacker never gets its slower shot off — that's the
  // whole point.
  const ALL_DIRECTIONS_PATTERN = [0, 1, 2, 3, 4, 5];
  // The three hexes in front of the nose. A weapon on this pattern has to
  // be POINTED at what it shoots — you can only answer one side of a
  // pincer, and whatever's behind you gets a free round. That's the hole
  // the omnidirectional hardware is sold against.
  const FORWARD_ARC_PATTERN = [5, 0, 1];

  // Is there a clear line from `from` to `to`? Walks the hexes strictly
  // between the two and asks whether anything solid is standing in them.
  // Used by the shell and gap weapons; lane weapons stop at the first
  // blocker as they step, and lobbed weapons don't ask at all.
  //
  // Hex lines are done in cube space and rounded; when a line passes
  // exactly between two hexes we accept EITHER being clear, so a shot
  // threading a one-hex gap is allowed rather than blocked by a rounding
  // coin-flip.
  // "If I stood there, would this reach me?" — the flagship's own hull is
  // not cover for the ground behind it when answering that.
  const HYPOTHETICAL = { ignorePlayer: true };

  function hasLineOfSight(state, from, to, opts) {
    const dist = hexDistance(from, to);
    if (dist < 2) return true;
    const ax = from.q;
    const az = from.r;
    const ay = -ax - az;
    const bx = to.q;
    const bz = to.r;
    const by = -bx - bz;
    for (let step = 1; step < dist; step++) {
      const t = step / dist;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = az + (bz - az) * t;
      // Round to the two nearest candidate hexes (nudge either way).
      const candidates = [-1e-6, 1e-6].map((eps) => cubeRound(x + eps, y - 2 * eps, z + eps));
      const clear = candidates.some((c) => !blocksShot(state, c, opts));
      if (!clear) return false;
    }
    return true;
  }

  function cubeRound(x, y, z) {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
  }

  // ---- weapons are SHAPES, not ranges ------------------------------------
  //
  // Every gun used to be "everything within N hexes", which meant the only
  // question a weapon ever asked was how big N was, and a bigger N was
  // strictly better. Nothing about where you stood mattered beyond a
  // distance count. ("Right now you just have range, and I don't just want
  // range. I want patterns of where they hit... think chess.")
  //
  // So each weapon now covers a FOOTPRINT, and the footprints have holes
  // in them. Three of them are shells at an exact distance — 1, 2 and 3 —
  // which means every gun in that family is blind to something:
  //
  //   Flak Burst   ring at exactly 1     ......    the crowd answer, and
  //                                                useless at any reach
  //   Arc Beam     ring at exactly 2     .o...     out-reaches a chaser,
  //                                                helpless once it closes
  //   Mortar       ring at exactly 3     ..o..     lobs OVER cover, and
  //                                                cannot defend itself
  //   Railgun      one axis, any distance, stops at the first rock or hull
  //   Flank Tubes  the six OFF-axis hexes at 2 — exactly the gaps a
  //                Railgun's lanes can never cover
  //   Autocannon   three hexes off the nose: point it at something
  //
  // A contact sitting two hexes away is a completely different problem
  // from the same contact one hex away, and the answer is which gun you
  // fitted, not how much energy you saved. Cover matters in both
  // directions now: rock breaks a Railgun lane and does nothing at all
  // against a Mortar.
  const SHAPES = {
    // Pattern offsets stepped out to `range`, stopped by anything solid.
    // Pattern offsets stepped out to `range`, stopped by anything solid.
    // A minRange leaves the near end of each lane alone — the beam still
    // travels through those hexes (and is still stopped by whatever is
    // standing in them), it just cannot be aimed at something that close.
    // That hole is what makes a long gun a long gun: Hoplite's archer
    // cannot shoot an adjacent tile, which is the entire reason closing on
    // one is a real answer to it.
    arc: (pos, facing, weapon, state, opts) => {
      const hexes = [];
      const min = weapon.minRange || 1;
      for (const offset of weapon.pattern) {
        const dir = (facing + offset + 6) % 6;
        let cur = pos;
        for (let step = 0; step < weapon.range; step++) {
          cur = neighbor(cur, dir);
          if (step + 1 >= min) hexes.push(cur);
          if (state && blocksShot(state, cur, opts)) break;
        }
      }
      return hexes;
    },
    // Every hex at a distance between minRange and range — a shell, with
    // a hole in the middle whenever minRange > 1. Cover counts: a shell
    // still has to get there. Only a weapon that declares ignoresCover
    // (the Mortar, which lobs) is handed a null state and so sees through
    // everything. Without this, four of the six weapons shot straight
    // through asteroid fields and the whole "put rock between you and it"
    // idea was fiction.
    ring: (pos, facing, weapon, state, opts) => {
      const hexes = [];
      const max = weapon.range;
      const min = weapon.minRange || 1;
      for (let dq = -max; dq <= max; dq++) {
        for (let dr = -max; dr <= max; dr++) {
          const cand = { q: pos.q + dq, r: pos.r + dr };
          const dist = hexDistance(pos, cand);
          if (dist < min || dist > max) continue;
          if (state && !hasLineOfSight(state, pos, cand, opts)) continue;
          hexes.push(cand);
        }
      }
      return hexes;
    },
    // Straight down all six axes until something solid stops it.
    lane: (pos, facing, weapon, state, opts) => SHAPES.arc(pos, facing, { ...weapon, pattern: ALL_DIRECTIONS_PATTERN }, state, opts),
    // The six hexes at distance 2 that are NOT on an axis: the gaps
    // between the lanes. Precisely the ground a Railgun cannot touch.
    offAxis: (pos, facing, weapon, state, opts) => {
      const axial = new Set();
      for (let d = 0; d < 6; d++) {
        const two = neighbor(neighbor(pos, d), d);
        axial.add(hexKey(two));
      }
      const hexes = [];
      for (let dq = -2; dq <= 2; dq++) {
        for (let dr = -2; dr <= 2; dr++) {
          const cand = { q: pos.q + dq, r: pos.r + dr };
          if (hexDistance(pos, cand) !== 2) continue;
          if (axial.has(hexKey(cand))) continue;
          if (state && !hasLineOfSight(state, pos, cand, opts)) continue;
          hexes.push(cand);
        }
      }
      return hexes;
    },
  };

  // SIX weapons, each the answer to exactly one situation, and each with
  // somewhere it cannot reach. Every one of them is ALSO carried by a
  // hostile class — scanning a contact teaches you what's buyable, and
  // what its blind spot is.
  const WEAPONS = {
    // The starter: three hexes off the nose, in contact. Cheapest gun in
    // the game by a mile, and the price of that is you have to be pointing
    // at the thing and standing next to it. Deepening it to a two-hex
    // wedge was tried here and measured: cheap reach makes every purchase
    // optional, a pilot that just shot everything finished two runs in
    // three, and the whole shop stopped mattering. Reach is the thing you
    // BUY. (Its footprint does sit inside the Flak Burst's ring — that's
    // allowed, because the Burst costs three times as much a shot and the
    // roster rule is that covering more ground has to be paid for.)
    // ---- HOW A GUN IS PRICED ------------------------------------------
    //
    // One rule, and everything below is on it: REACH COSTS RATE. The more
    // ground a gun threatens, the less often it may fire and the more it
    // costs to buy. A stock reactor makes one charge a round, so a weapon's
    // energy cost IS its rate of fire — 1 is every round, 4 is every fourth.
    //
    //   6 hexes   1-2 charge     contact, and the off-axis gaps
    //   12 hexes  2 charge       the ring at two
    //   18 hexes  3 charge       the shell at three
    //   24+ hexes 3-4 charge     a lane down every axis
    //   the board 4 charge       the Railgun, and it costs the most salvage
    //
    // WHAT THE SALVAGE PRICES ARE BASED ON, since it isn't the coverage
    // table. Each gun was flown from Sector 1 by the same pilot over the
    // same forty seeds, one gun at a time, and the honest result is that
    // they are worth about the SAME: no second gun at all leaves the
    // median run ending at depth 4, and almost every one of them takes it
    // to depth 8. The differences between guns sit inside the noise at
    // that sample size.
    //
    // So the salvage spread is deliberately narrow — 6 to 20, not 6 to 30.
    // A five-fold price range was a claim about relative value that
    // nothing measured supports. The differentiation that IS real lives in
    // the energy cost, which is a rate of fire you can feel every round.
    //
    // The three lane guns are a strict ladder, and have to be: a Railgun's
    // line swallows an Arc Projector's, which swallows a Beam Lance's, so
    // each one up costs another charge — 3, 4, 5 — or the one below it is
    // simply obsolete. Same reason the Railgun is the dearest thing on any
    // shelf.
    //
    // The Beam Lance broke this badly: 24 hexes for ONE charge, fired every
    // round, at twelve salvage — comfortably the best thing in the game and
    // nothing else was close. It was cheap because the Picket needs to fire
    // every round (Hoplite's archer has no cooldown), which is a fact about
    // that hull, not about the gun. A class is fast because of the
    // generators it bolted on; the archer carries three of them now.
    autocannon: { id: "autocannon", label: "Autocannon", shape: "ring", range: 1, minRange: 1, damage: 1, targets: "one", energyCost: 1, speed: 3, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // The cheapest reach in the game, and the only gun where which way you
    // are pointing matters at all. A wedge two hexes deep off the nose:
    // three lanes, six hexes, one charge, fires every round. Everything
    // else is omnidirectional, so this is the one purchase that makes
    // facing a decision — turn to bring it to bear, or buy something that
    // doesn't care.
    prowCannon: { id: "prowCannon", label: "Prow Cannon", shape: "arc", range: 2, damage: 1, targets: "one", energyCost: 1, speed: 3, pattern: FORWARD_ARC_PATTERN, slots: 1 },
    // The screen-popper. An Escort's shield eats one hit whole however big
    // it is, so a one-damage gun spends two rounds getting through where
    // this spends one. Contact only, and it costs a Flak Burst's charge to
    // hit a single target — you buy it for what it does to armour, not for
    // coverage.
    siegeMaul: { id: "siegeMaul", label: "Siege Maul", shape: "ring", range: 1, minRange: 1, damage: 2, targets: "one", energyCost: 3, speed: 1, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // The crowd answer: every adjacent contact at once, so being
    // surrounded stops being a death sentence. Reaches nothing further.
    flakBurst: { id: "flakBurst", label: "Flak Burst", shape: "ring", range: 1, minRange: 1, damage: 1, targets: "all", energyCost: 3, speed: 2, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // Standoff — and ONLY standoff. It hits the shell at exactly two
    // hexes and has a hole in the middle: let a chaser close to contact
    // and this gun is a passenger. Buying reach means giving something up
    // now, instead of being a strict upgrade on the Flak Burst.
    arcBeam: { id: "arcBeam", label: "Arc Beam", shape: "ring", range: 2, minRange: 2, damage: 1, targets: "one", energyCost: 2, speed: 2, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // Indirect fire: the shell at exactly three hexes, LOBBED, so rock in
    // between is no protection at all. The one gun that answers something
    // sitting behind an asteroid field — and the one gun a rock can't
    // save YOU from either.
    mortar: { id: "mortar", label: "Mortar", shape: "ring", range: 3, minRange: 3, damage: 1, targets: "one", energyCost: 3, speed: 1, ignoresCover: true, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // The six gaps between the axes, two hexes out, two damage. The exact
    // complement of a Railgun: what one covers, the other can't.
    flankTubes: { id: "flankTubes", label: "Flank Tubes", shape: "offAxis", range: 2, damage: 2, targets: "one", energyCost: 3, speed: 2, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // The only weapon that doesn't resolve the turn it fires. It puts a
    // MISSILE on the board — an object with a position, chasing whoever it
    // was launched at, one hex a round. You can outrun it, put a rock
    // between you and it, or walk it into somebody else: it detonates on
    // the first ship it reaches and it does not care whose side that ship
    // is on. Long reach and heavy damage, paid for in the round of warning
    // it gives you. (Hoplite's bomber is the ancestor — telegraphed area
    // denial that kills its own.)
    missilePod: { id: "missilePod", label: "Missile Pod", shape: "ring", range: 4, minRange: 2, damage: 1, targets: "one", energyCost: 4, speed: 1, pattern: ALL_DIRECTIONS_PATTERN, slots: 1, launches: true },
    // The sniper: down any of the six axes, the length of the board, two
    // damage. Stopped by the first rock or hull in the lane, which is
    // both its weakness and how you survive one.
    // The long gun that MOVES. Everything with reach in this game was
    // bolted to the floor — the design note used to read "reach belongs to
    // the things that can't chase you" — which left every mobile class
    // wanting the same hex and playing the same way. This is Hoplite's
    // archer: it shoots five hexes down any axis, it CANNOT shoot anything
    // adjacent, and it walks to keep that gap open. Closing on it is the
    // answer, and closing costs you the rounds it spends shooting.
    beamLance: { id: "beamLance", label: "Beam Lance", shape: "lane", range: 5, minRange: 2, damage: 1, targets: "one", energyCost: 3, speed: 2, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // The Cutter's gun. Same six axes as the Beam Lance and one hex longer
    // at the near end — it can fire at CONTACT, so there is no inside-its-
    // guard to reach, which is the whole difference between the two. What
    // switches it off instead is its own side: see INHIBITIONS.beamClear.
    arcProjector: { id: "arcProjector", label: "Arc Projector", shape: "lane", range: 5, minRange: 1, damage: 1, targets: "one", energyCost: 4, speed: 2, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    railgun: { id: "railgun", label: "Railgun", shape: "lane", range: 20, damage: 2, targets: "one", energyCost: 5, speed: 1, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // Hoplite's Demolitionist, and the one question nothing else in this
    // game asks. Every other gun says "do not be standing HERE when I
    // fire"; this one says "this GROUND is going away." It doesn't damage
    // anything the round it's used — it puts a charge on a hex with a
    // burning fuse and a blast that covers that hex and all six around it,
    // and then you have two rounds to not be in any of them.
    //
    // Which makes it the only weapon in the game whose answer is time
    // rather than geometry, and the only one that reliably threatens a
    // crowd — including its own side, which is exactly why the class that
    // carries it refuses to throw one near a friend (see INHIBITIONS).
        // Minimum TWO. At one, the blast — which covers a full ring around
    // where it lands — reaches back over the hex you threw it from, so
    // you blow yourself up. The hostiles never did this because
    // INHIBITIONS.blastSafe counts the thrower; the player had no such
    // protection and it showed. Measured with the real pilot: every other
    // gun took the median run from depth 4 to depth 8, and this one took
    // it to depth 2 — the only weapon in the game that made you worse.
    // Thrown to between two and three hexes. The blast
    // covers a full ring around where it lands, so from two out the
    // thrower is standing one hex clear of its own bomb and no further:
    // it has to come in close and then live with what it did. Reaching
    // three as well would have made it a strictly better Mortar (same
    // charge, same damage, more ground), which the roster rule forbids.
    demolitionCharge: { id: "demolitionCharge", label: "Demolition Charge", shape: "ring", range: 3, minRange: 2, damage: 1, targets: "one", energyCost: 3, speed: 1, pattern: ALL_DIRECTIONS_PATTERN, slots: 1, places: true, blast: 1 },
  };
  // Static data, read everywhere, written nowhere — frozen so an
  // accidental mutation (a helper that "just tweaks" a weapon object for
  // display, say) throws instead of silently changing that weapon for
  // every ship in the game for the rest of the session.
  deepFreeze(WEAPONS);

  // Each enemy type is its own small data block: how tough it is (hp), what
  // it hits back with (a WEAPONS entry), how it moves, and its reactor
  // (maxEnergy/startEnergy) — enemies run on the same energy model as the
  // flagship ("the enemies should be using their own systems"): a shot
  // costs the weapon's energyCost, +1 regen per enemy phase, and a weapon
  // it can't afford holds fire. Adding a new enemy is adding an entry
  // here, not new bespoke combat code.
  //   interceptor — the basic chaser: 1 Hull, strikes adjacent, closes in.
  //                 Cost-1 cannon against +1/turn regen = fires every turn,
  //                 exactly as before energy existed.
  //   cruiser     — a heavy: 2 Hull (takes two hits), otherwise chases like
  //                 an interceptor. Distinct threat because it survives a ram.
  //   sentry      — a stationary gun platform: 2 Hull, never moves, but its
  //                 beam covers a 2-hex ring, controlling space instead of
  //                 chasing. Approach it wrong and it fires; kill it or go
  //                 around.
  //   railgun     — a stationary heavy: 2 Hull, never moves, but its shot
  //                 reaches the length of the board along any of the 6
  //                 axes. Its cost-3 beam against a 3-cap reactor STARTING
  //                 EMPTY is the design doc's telegraph, expressed through
  //                 the energy system: it visibly charges for 3 turns
  //                 (Scan shows the count), fires once, and starts over.
  //                 Procedural depth only (depth >= 8, see levels.js).
  // `salvage` is how much scrap a kill drops, regardless of which action
  // lands it — spendable at a Sector Outpost. Tougher hulls drop more.
  // Every ownable piece of hardware, with its Hold footprint (w x h cells).
  // Phase 1 is deliberately just the starter roster ("less items to start
  // so we can test this out") — new items are one entry here each.
  const EQUIPMENT = {
    // Item id === action id === systems key === WEAPONS key, deliberately:
    // one weapon is one physical thing, and every layer names it the same.
    autocannon: { id: "autocannon", label: "Autocannon", kind: "weapon", weaponKey: "autocannon", w: 2, h: 1 },
    flakBurst: { id: "flakBurst", label: "Flak Burst", kind: "weapon", weaponKey: "flakBurst", w: 2, h: 2 },
    arcBeam: { id: "arcBeam", label: "Arc Beam", kind: "weapon", weaponKey: "arcBeam", w: 2, h: 2 },
    beamLance: { id: "beamLance", label: "Beam Lance", kind: "weapon", weaponKey: "beamLance", w: 1, h: 3 },
    railgun: { id: "railgun", label: "Railgun", kind: "weapon", weaponKey: "railgun", w: 1, h: 4 },
    mortar: { id: "mortar", label: "Mortar", kind: "weapon", weaponKey: "mortar", w: 2, h: 2 },
    flankTubes: { id: "flankTubes", label: "Flank Tubes", kind: "weapon", weaponKey: "flankTubes", w: 1, h: 3 },
    missilePod: { id: "missilePod", label: "Missile Pod", kind: "weapon", weaponKey: "missilePod", w: 2, h: 2 },
    arcProjector: { id: "arcProjector", label: "Arc Projector", kind: "weapon", weaponKey: "arcProjector", w: 1, h: 3 },
    prowCannon: { id: "prowCannon", label: "Prow Cannon", kind: "weapon", weaponKey: "prowCannon", w: 1, h: 2 },
    siegeMaul: { id: "siegeMaul", label: "Siege Maul", kind: "weapon", weaponKey: "siegeMaul", w: 2, h: 2 },
    demolitionCharge: { id: "demolitionCharge", label: "Demolition Charge", kind: "weapon", weaponKey: "demolitionCharge", w: 2, h: 2 },
    reactorCore: { id: "reactorCore", label: "Reactor Core", kind: "reactor", rechargeGain: 1, energyCapacity: 6, w: 2, h: 2 },
    sublightDrive: { id: "sublightDrive", label: "Sublight Drive", kind: "engine", moveRange: 1, w: 1, h: 3 },
    shieldGenerator: { id: "shieldGenerator", label: "Shield Generator", kind: "shield", capacity: 1, w: 2, h: 2 },
    // The Scan mode's hardware ("the scanner should itself be a small
    // item") — a tiny tile, but pull it and the ship flies blind.
    scanner: { id: "scanner", label: "Scanner Array", kind: "sensor", w: 1, h: 1 },
    // Small hardware the hostile classes are built around. Ordinary
    // EQUIPMENT entries, not enemy-only props — an enemy's hold renders
    // through exactly the same registry yours does, and these are what a
    // wreck would drop.
    microReactor: { id: "microReactor", label: "Micro Reactor", kind: "reactor", rechargeGain: 1, energyCapacity: 1, w: 1, h: 1 },
    // A battery, not a generator: it holds charge, it doesn't make any.
    // A ship built entirely of Charge Banks has a big bus and no way to
    // refill it — which is exactly why the Railgun emplacement is slow.
    chargeBank: { id: "chargeBank", label: "Charge Bank", kind: "battery", energyCapacity: 2, w: 1, h: 2 },
    // Bolted-on hull, not a screen: it raises how much damage the ship can
    // eat before it comes apart. Same item, same effect, whoever fits it.
    ablativePlating: { id: "ablativePlating", label: "Ablative Plating", kind: "armor", hullBonus: 1, w: 1, h: 2 },
    stationAnchor: { id: "stationAnchor", label: "Station Anchor", kind: "utility", w: 1, h: 1 },
  };
  deepFreeze(EQUIPMENT); // same reasoning as WEAPONS above

  // Can `id`'s tile sit at (x, y) — inside the grid, overlapping nothing?
  // `ignoreIndex` excludes the tile's own current placement while moving it.
  function holdCanPlace(hold, id, x, y, ignoreIndex) {
    const eq = EQUIPMENT[id];
    if (!eq) return false;
    if (x < 0 || y < 0 || x + eq.w > hold.cols || y + eq.h > hold.rows) return false;
    // Blocked cells are OUTSIDE the hull — the grid is the shape of the
    // ship, not a plain rectangle ("it should be the shape of the ship").
    const blocked = hold.blocked || [];
    for (let cy = y; cy < y + eq.h; cy++) {
      for (let cx = x; cx < x + eq.w; cx++) {
        if (blocked.includes(`${cx},${cy}`)) return false;
      }
    }
    return hold.items.every((it, i) => {
      if (i === ignoreIndex) return true;
      const other = EQUIPMENT[it.id];
      return x + eq.w <= it.x || it.x + other.w <= x || y + eq.h <= it.y || it.y + other.h <= y;
    });
  }

  // First-fit placement; falls back to cargo when the grid is full.
  function autoPlaceInHold(hold, id) {
    for (let y = 0; y < hold.rows; y++) {
      for (let x = 0; x < hold.cols; x++) {
        if (holdCanPlace(hold, id, x, y)) {
          hold.items.push({ id, x, y });
          return true;
        }
      }
    }
    hold.cargo.push(id);
    return false;
  }

  // The weapon-system keys the renderer iterates for arming/reach checks —
  // derived from the Hold now (an installed weapon item sets its
  // systems[key] flag in deriveShip), but the key list itself is stable
  // engine data.
  // Derived, never typed. Hand-listing it went stale twice — a weapon
  // missing from here is one the arming loop skips, so you can own a gun
  // and be unable to fire it, with nothing anywhere reporting a problem.
  const WEAPON_SYSTEM_KEYS = Object.keys(WEAPONS);

  // ---- what a hold makes a ship able to do -------------------------------
  //
  // THE one place capability comes from, for the flagship and for every
  // hostile alike. There is no second set of rules for enemies: a contact
  // that flies has a drive bolted in, a contact that shoots has that gun
  // in its hold, its reactor is the reactors it carries. Pull the drive
  // out of an Interceptor's hold and it sits still, for the same reason
  // you would. ("The enemy should be working exactly the same way that
  // the user is. They have the exact same mechanics in every sense of the
  // word... They can't move without the item that lets them move. They
  // can't attack without the item that lets them attack.")
  function deriveShip(hold) {
    const items = (hold && hold.items) || [];
    const eq = (it) => EQUIPMENT[it.id] || {};
    const has = (id) => items.some((it) => it.id === id);
    const weaponKeys = WEAPON_SYSTEM_KEYS.filter(has);
    const systems = { warpdrive: true };
    for (const key of WEAPON_SYSTEM_KEYS) systems[key] = has(key);
    const sum = (field) => items.reduce((total, it) => total + (eq(it)[field] || 0), 0);
    return {
      weaponKeys,
      weapons: weaponKeys.map((key) => WEAPONS[key]),
      actions: ["sublight", ...weaponKeys],
      systems,
      hasDrive: items.some((it) => eq(it).kind === "engine"),
      maxShields: items.filter((it) => eq(it).kind === "shield").length,
      scannerInstalled: items.some((it) => eq(it).kind === "sensor"),
      // Batteries hold charge; only generators make it. A hull full of
      // Charge Banks is a big bus that fills very slowly.
      maxEnergy: sum("energyCapacity"),
      rechargeGain: sum("rechargeGain"),
      hullBonus: sum("hullBonus"),
    };
  }

  // The hold is the SOURCE OF TRUTH — actions, weapon arming, reactor
  // capacity, hull and shield capacity all derive from what's physically
  // installed. Cargo is inert.
  function syncHoldDerived(state, opts) {
    const ship = deriveShip(state.hold);
    state.actions = ship.actions;
    state.systems = ship.systems;
    // Rearranging the Hold is free and reversible. Stowing a crate and
    // putting it straight back used to cost a point of max hull and a
    // shield charge permanently, because the clamp on the way down was
    // never matched by anything on the way back up. Credit is given back
    // ONLY during a refit — capacity appearing for the first time (a fresh
    // ship, a purchase) still arrives empty and has to be raised.
    const refit = Boolean(opts && opts.refit);
    const shieldsBefore = state.maxShields || 0;
    state.maxShields = ship.maxShields;
    if (refit && ship.maxShields > shieldsBefore) state.shieldCharges += ship.maxShields - shieldsBefore;
    state.shieldCharges = Math.max(0, Math.min(state.shieldCharges, state.maxShields));
    state.scannerInstalled = ship.scannerInstalled;
    state.maxEnergy = ship.maxEnergy;
    state.energy = Math.min(state.energy, state.maxEnergy);
    const hullBefore = state.maxHull || START_HULL + ship.hullBonus;
    state.maxHull = START_HULL + ship.hullBonus;
    if (refit && state.maxHull > hullBefore) state.hull += state.maxHull - hullBefore;
    state.hull = Math.max(0, Math.min(state.hull, state.maxHull));
  }

  function assertDocked(state) {
    if (!outpostAvailable(state)) {
      throw new Error("Refits need a dock — no rewiring the ship under way");
    }
  }

  // Rearranging the Hold ("move stuff around") — dock-gated, free (no
  // turn spent): move an installed tile, stow it to cargo, or install
  // from cargo into a free spot.
  function moveHoldItem(state, index, x, y) {
    assertPlaying(state);
    assertDocked(state);
    const it = state.hold.items[index];
    if (!it) throw new Error("Hold: no such installed item");
    if (!holdCanPlace(state.hold, it.id, x, y, index)) throw new Error("Hold: that spot doesn't fit this item");
    it.x = x;
    it.y = y;
    syncHoldDerived(state, { refit: true });
  }

  function stowToCargo(state, index) {
    assertPlaying(state);
    assertDocked(state);
    const it = state.hold.items[index];
    if (!it) throw new Error("Hold: no such installed item");
    state.hold.items.splice(index, 1);
    state.hold.cargo.push(it.id);
    syncHoldDerived(state, { refit: true });
    pushLog(state, `${EQUIPMENT[it.id].label} powered down and stowed.`);
  }

  function installFromCargo(state, cargoIndex, x, y) {
    assertPlaying(state);
    assertDocked(state);
    const id = state.hold.cargo[cargoIndex];
    if (!id) throw new Error("Hold: no such cargo item");
    if (!holdCanPlace(state.hold, id, x, y)) throw new Error("Hold: that spot doesn't fit this item");
    state.hold.cargo.splice(cargoIndex, 1);
    state.hold.items.push({ id, x, y });
    syncHoldDerived(state, { refit: true });
    pushLog(state, `${EQUIPMENT[id].label} installed and powered up.`);
  }

  const ENEMY_TYPES = {
    // Every enemy is a HOLD, exactly like yours: `hold` lists real
    // EQUIPMENT ids at real coordinates, so a scanned contact's Systems
    // screen renders through the same code your own does, and the weapon
    // it shoots you with is an item you can buy and fit yourself. There is
    // no enemy-only gear.
    //   interceptor — the basic chaser: 1 Hull, one Autocannon, closes in.
    //                 1 energy against +1/cycle regen = fires every round.
    //   cruiser     — the brawler: 2 Hull, Flak Burst, closes to contact.
    //                 Reach belongs to the things that can't chase you:
    //                 a mobile hostile that also outranged you was tested
    //                 and it flattened the crawl by depth 5.
    //   sentry      — a fixed gun platform: ONE Hull, no drive, an Arc
    //                 Beam zoning two hexes in every direction. Glass —
    //                 it denies ground and dies to a single shot, so the
    //                 question is "can you reach it", not "can you
    //                 out-trade it". At 2 Hull, two of them walled a 9x11
    //                 board completely.
    //   railgun     — the sniper emplacement: 2 Hull, no drive, Railgun
    //                 down any axis for 2 damage on a four-round charge.
    // `hull` is the bare airframe (the flagship's equivalent is
    // START_HULL); Ablative Plating adds to it. Everything else — what it
    // shoots, whether it can chase you at all, how big its bus is and how
    // fast it fills — is READ OFF THE HOLD by deriveShip, exactly as
    // yours is. Nothing here restates it.
    interceptor: {
      hull: 1, salvage: 1,
      hold: {
        cols: 3, rows: 4, blocked: ["0,3", "2,3"],
        items: [
          { id: "autocannon", x: 0, y: 0 },
          { id: "microReactor", x: 2, y: 0 },
          { id: "sublightDrive", x: 1, y: 1 },
        ],
      },
    },
    cruiser: {
      hull: 1, salvage: 2,
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "flakBurst", x: 1, y: 0 },
          { id: "microReactor", x: 3, y: 1 },
          { id: "sublightDrive", x: 1, y: 2 },
          { id: "chargeBank", x: 2, y: 2 },
        ],
      },
    },
    sentry: {
      hull: 1, salvage: 2,
      hold: {
        cols: 3, rows: 4, blocked: ["0,0", "2,0"],
        items: [
          { id: "arcBeam", x: 0, y: 1 },
          { id: "microReactor", x: 1, y: 0 },
          { id: "chargeBank", x: 2, y: 1 },
          { id: "stationAnchor", x: 1, y: 3 },
        ],
      },
    },
    // The archer that walks. It was bolted to the deck at first, because a
    // MOBILE long gun measured at 4 wins in 40 when it turned up in the
    // shallow end and the only counter to reach is to walk it down — it
    // kept walking away from the walk. But a gun platform that never moves
    // reads as broken however correct it is ("the picket just straight up
    // doesn't move"), and reading right beats measuring right.
    //
    // So it has an engine, and it pays for the engine in TIME. It carries
    // the Siege Lance, not the Beam Lance: same three hexes down an axis,
    // same nothing at contact, but three charge instead of two, so on one
    // generator it fires one round in three and spends the other two
    // moving. That is exactly "shoot if you're in range, otherwise move"
    // from the outside, and it is Hoplite's Demolitionist cadence — the
    // reach is real, and you get two free rounds to do something about it.
    picket: {
      hull: 1, salvage: 2,
      hold: {
        cols: 3, rows: 5, blocked: ["0,0", "2,0", "0,4", "2,4"],
        items: [
          // THREE generators. Hoplite's archer has no cooldown, and the
          // honest way to give a class that is to bolt in the reactors to
          // pay for it — not to make the gun itself cheap for everyone.
          { id: "beamLance", x: 1, y: 0 },
          { id: "sublightDrive", x: 0, y: 1 },
          { id: "microReactor", x: 2, y: 1 },
          { id: "microReactor", x: 2, y: 2 },
          { id: "microReactor", x: 2, y: 3 },
        ],
      },
    },
    // Hoplite's Demolitionist, and the only class in the game that
    // threatens GROUND rather than a ship. It does no damage the round it
    // acts: it drops a charge on the hex you are standing on, with two
    // rounds on the fuse and a blast that takes that hex and all six
    // around it. You have those two rounds and they are enough — being
    // caught is always a decision.
    //
    // Its inhibition is the interesting half (see INHIBITIONS.blastSafe):
    // it will not throw one that would catch its own side. Standing beside
    // another hostile switches it off completely, so a crowd — the thing
    // every other instinct in this game says to break up — is cover from
    // the one enemy you cannot out-position.
    demolitionist: {
      hull: 1, salvage: 3, inhibition: "blastSafe",
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "demolitionCharge", x: 1, y: 0 },
          { id: "sublightDrive", x: 0, y: 1 },
          { id: "microReactor", x: 3, y: 1 },
          { id: "chargeBank", x: 1, y: 2 },
          { id: "chargeBank", x: 3, y: 2 },
        ],
      },
    },
    // The Bombard — and it FLIES, which it always should have: four lit
    // thrusters and swept wings, and it was called a platform anyway. Its
    // shell lands at exactly three and doesn't care what's in between, so
    // parking behind a rock is no answer. Get inside three and it has
    // nothing; that hole is the whole answer to it.
    bombard: {
      hull: 1, salvage: 2,
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "mortar", x: 1, y: 0 },
          { id: "sublightDrive", x: 0, y: 1 },
          { id: "microReactor", x: 3, y: 1 },
          { id: "chargeBank", x: 3, y: 2 },
        ],
      },
    },
    // A chaser that threatens the gaps instead of the lanes: the six
    // off-axis hexes at two, for two damage. Line yourself up on an axis
    // with it, or get inside it — standing diagonally off at two is the
    // one place it wants you.
    lancer: {
      hull: 1, salvage: 2,
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "flankTubes", x: 1, y: 0 },
          { id: "microReactor", x: 3, y: 1 },
          { id: "sublightDrive", x: 2, y: 1 },
          { id: "chargeBank", x: 3, y: 2 },
        ],
      },
    },
    // Two big banks and one small generator: five on the bus, one a
    // round to fill it, a slug that costs four. The telegraph isn't a
    // scripted timer — it's the hardware.
    // Engine bells, fins, and the word "destroyer" in its name — it was
    // bolted to the deck for no reason the hull ever supported. It flies.
    // What keeps it fair is the hardware: two big banks and one small
    // generator, so its first slug is telegraphed by a bus you can watch
    // filling, and it cannot both reposition and fire in the same round.
    railgun: {
      hull: 1, salvage: 2, startsEmpty: true,
      hold: {
        cols: 4, rows: 6, blocked: ["0,0", "3,0", "0,5", "3,5"],
        items: [
          { id: "railgun", x: 1, y: 0 },
          { id: "sublightDrive", x: 2, y: 1 },
          { id: "chargeBank", x: 0, y: 1 },
          { id: "chargeBank", x: 0, y: 3 },
          { id: "microReactor", x: 3, y: 1 },
        ],
      },
    },
    // ---- the second wave -------------------------------------------------
    // Five more classes, and not one of them needed a new rule: every
    // difference below is a different arrangement of the same crates you
    // can buy yourself. What makes a class is what it bolted on.

    // The Cutter. Same six axes as the Picket's Beam Lance and one hex
    // longer at the near end: it can fire at CONTACT, so unlike an archer
    // there is no inside-its-guard to reach. What turns it off is its own
    // side — it will not fire while any hostile stands anywhere in that
    // beam, so you do not out-position it, you position the things around
    // it and its own wingmen become your cover.
    cutter: {
      hull: 1, salvage: 2, inhibition: "beamClear",
      hold: {
        cols: 3, rows: 5, blocked: ["0,0", "2,0", "0,4", "2,4"],
        items: [
          { id: "arcProjector", x: 1, y: 0 },
          { id: "sublightDrive", x: 0, y: 1 },
          { id: "microReactor", x: 2, y: 1 },
          { id: "microReactor", x: 2, y: 2 },
          { id: "chargeBank", x: 1, y: 3 },
        ],
      },
    },
    // The first hostile to carry a screen. One Hull under it, so the
    // Autocannon that kills an Interceptor outright only pops the bubble
    // here — everything takes exactly one more shot than you expect, and
    // a volley you were counting on to clear contact doesn't.
    escort: {
      hull: 1, salvage: 2,
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "shieldGenerator", x: 1, y: 0 },
          { id: "sublightDrive", x: 0, y: 1 },
          { id: "microReactor", x: 3, y: 1 },
          // A Prow Cannon, not an Autocannon: it has a blind side. With an
          // omnidirectional gun this class was just an Interceptor wearing
          // a screen — the same question, asked slower. Now the screen says
          // "two hits" and the wedge says "or go round the back", and those
          // are different answers.
          { id: "prowCannon", x: 1, y: 2 },
        ],
      },
    },
    // Four bays and a nose gun: the only mobile hostile carrying TWO
    // weapons, and that — not a bigger hull — is what makes it dangerous.
    // The Autocannon answers you at contact in front, the Flak Burst
    // answers the whole ring, so backing off one hex to a flank stops
    // working the way it does against everything else. Two Hull, because
    // three of them plus an Escort's screen turned every deep board into
    // arithmetic (measured: it took the win rate from 48% to zero).
    carrier: {
      hull: 1, salvage: 3,
      hold: {
        cols: 5, rows: 6, blocked: ["0,0", "4,0", "0,5", "4,5"],
        items: [
          // Siege Maul at contact instead of a Flak Burst. It is alone
          // with you when you close on it, so hitting everything touching
          // it was worth nothing; hitting for TWO makes the approach a
          // real decision rather than a chip of hull.
          { id: "siegeMaul", x: 1, y: 0 },
          { id: "missilePod", x: 3, y: 1 },
          { id: "sublightDrive", x: 0, y: 1 },
          { id: "microReactor", x: 3, y: 0 },
          { id: "chargeBank", x: 1, y: 2 },
          { id: "chargeBank", x: 2, y: 2 },
        ],
      },
    },
    // Not a warship. Grapples, a tractor lens and two crates of plating —
    // it is out here for the wrecks, and it has no gun of any kind, so
    // check its Systems screen and you'll find nothing that can hurt you.
    // It still closes, because that's what a hold with a drive and no
    // weapon does. The decision it poses is pure economics: it is worth
    // more than anything else on the board and every turn you spend
    // cracking it is a turn the things that CAN shoot get for free.
    salvager: {
      hull: 1, salvage: 6,
      hold: {
        cols: 3, rows: 5, blocked: ["0,0", "2,0", "0,4", "2,4"],
        items: [
          { id: "sublightDrive", x: 1, y: 0 },
          { id: "ablativePlating", x: 0, y: 1 },
          { id: "ablativePlating", x: 2, y: 1 },
          { id: "microReactor", x: 0, y: 3 },
        ],
      },
    },
    // The Bulwark: a fortress, not a ship. Two crates of plating on a
    // two-Hull frame, no drive at all, and BOTH ends of the roster's
    // range bolted to it — a Railgun down every axis for 2, and a Flak
    // Burst covering every hex in contact. Those two guns leave exactly
    // one place to stand: off its axes, at two or three out. Finding that
    // ground is the fight. It spawns with an empty bus and fills it in
    // front of you, same telegraph as its little brother.
    //
    // Four Hull, not five. At five, with one gun fired per round against
    // two guns firing back, thirteen runs in forty reached it and not one
    // of them finished — a last sector nobody beats is a wall with a name
    // on it, which is the exact note this level already carried.
    bulwark: {
      hull: 1, salvage: 13, startsEmpty: true,
      hold: {
        cols: 5, rows: 6, blocked: ["0,0", "4,0", "0,5", "4,5"],
        items: [
          { id: "railgun", x: 1, y: 0 },
          { id: "flakBurst", x: 2, y: 0 },
          { id: "ablativePlating", x: 4, y: 1 },
          { id: "chargeBank", x: 3, y: 2 },
          { id: "chargeBank", x: 0, y: 3 },
          { id: "microReactor", x: 4, y: 3 },
          { id: "stationAnchor", x: 1, y: 4 },
        ],
      },
    },
  };

  // Recursively locks an object graph against mutation. Every ENEMY_TYPES
  // entry's hold/ship below is meant to be read, never written — one
  // shared object per class, handed to every instance of it for the
  // program's whole lifetime (see enemyShip). Nothing currently mutates
  // one in place, but nothing stopped it either: a future "sort items for
  // display" helper or a debug panel touching `.hold.items` directly would
  // silently corrupt every Interceptor/Cruiser/etc. for the rest of the
  // session with no error at the call site. Freezing turns that into a
  // TypeError right where it happens instead.
  function deepFreeze(obj) {
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) deepFreeze(value);
    }
    return Object.freeze(obj);
  }

  // Derived once per class at load — the holds above are static, so this
  // is the same object every caller sees, and no code anywhere is allowed
  // to hand-author what a class "has".
  for (const [name, def] of Object.entries(ENEMY_TYPES)) {
    // A hostile hold has to obey the same packing rules the player's does.
    // One of them didn't — a 1x2 crate straddling a blocked cell, drawn
    // hanging outside the hull on the Scan screen.
    const packed = { ...def.hold, items: [] };
    for (const it of def.hold.items) {
      if (!holdCanPlace(packed, it.id, it.x, it.y)) {
        throw new Error(`${name}'s hold: ${it.id} does not fit at ${it.x},${it.y}`);
      }
      packed.items.push(it);
    }
    def.ship = deriveShip(def.hold);
    def.maxHull = def.hull + def.ship.hullBonus;
    // Freeze the hold/ship only — not `def` itself and not ENEMY_TYPES as
    // a whole, since engine.test.js deliberately registers a temporary
    // extra class (`__testHulk`) as a fixture and needs to keep being able
    // to do that.
    deepFreeze(def.hold);
    deepFreeze(def.ship);
  }

  // What a given contact can do right now — its class's derived profile.
  // Enemies don't cache a copy on the instance: same hold, same answer.
  function enemyShip(enemy) {
    const def = ENEMY_TYPES[enemy.type];
    return def ? def.ship : null;
  }

  // Every weapon a contact could fire from where it stands, ignoring
  // whether it can currently pay for it. Same geometry function the
  // flagship's own reach preview uses.
  // Nothing out here shoots through its own side. Hoplite's whole roster is
  // built this way — its bomber won't drop a bomb next to another demon,
  // its wizard won't fire at all with a demon inside five — and it is what
  // turns a crowd of enemies from "more hit points" into terrain you can
  // work against. Standing so that a hostile's own wingman is in its way
  // is a real move now, and it costs the shot rather than the ally.
  //
  // Blocking already handled the LINE (see blocksShot); this handles the
  // SPREAD, which is the half that matters for a Flak Burst or a Mortar
  // shell — those cover hexes rather than trace them, so nothing was ever
  // in the way of them.
  // Only weapons that SPREAD hold fire for their own side, which is
  // exactly Hoplite's split: its footman attacks regardless, its archer is
  // merely blocked by whatever stands in the line, and only the bomber
  // refuses to drop one beside another demon. Applying it to every gun was
  // tried and it inverted the game — with every class one-shot, a crowd
  // jammed itself so thoroughly that MORE enemies made a board safer
  // (good play went to 37 wins in 40). A precise gun shoots past its
  // friends; a burst cannot.
  function spreads(weapon) {
    return weapon.targets === "all" || weapon.ignoresCover;
  }

  // ---- inhibitions -------------------------------------------------------
  //
  // Hoplite's real lesson, and the half of it this game was missing. Every
  // demon there has a hole AND a rule its own side can trigger: the archer
  // is blocked by allies, the demolitionist won't bomb a tile next to
  // another demon, the wizard won't attack AT ALL while another demon is
  // near it. Crowds make Hoplite's enemies weaker, which is what turns
  // positioning from "where is it safe to stand" into "where can I make
  // them jam each other".
  //
  // We had exactly one of these, buried in the weapons: a spread gun holds
  // fire rather than catching a friend. That covers the Flak Burst and the
  // Mortar and nothing else. These are per-CLASS, declared on the class,
  // and read by decideIntent before it will let one shoot.
  const INHIBITIONS = {
    // The Demolitionist: it will not drop a charge whose blast would take
    // one of its own with it. Stand next to another hostile and the bomb
    // never comes — which is a real, usable answer, and the reason a crowd
    // is worth walking into instead of away from.
    // ...including itself: the charge can now be lobbed as close as one hex
    // away, so "would this catch a friend" has to count the thrower or it
    // will happily stand inside its own blast.
    blastSafe: (state, enemy, weapon) => {
      if (!weapon.places) return false;
      const blast = chargeBlastHexes(state, { q: state.playerPos.q, r: state.playerPos.r, blast: weapon.blast || 1 });
      return livingEnemies(state).some((other) => blast.some((h) => posEq(h, other)));
    },
    // The Cutter's: it will not fire while any hostile is standing anywhere
    // in the beam it is about to fire. Not a proximity rule — a POSITION
    // rule. You do not out-range it or get under it; you put its own side
    // in front of it, and its wingmen become your cover.
    beamClear: (state, enemy, weapon) => {
      const covered = weaponHexes(enemy, enemyFacing(state, enemy), weapon, state);
      return livingEnemies(state).some((other) => other !== enemy && covered.some((h) => posEq(h, other)));
    },
  };

  // Does this class refuse the shot it could otherwise take?
  function inhibited(state, enemy, weapon) {
    const def = ENEMY_TYPES[enemy.type];
    const rule = def && def.inhibition && INHIBITIONS[def.inhibition];
    return rule ? rule(state, enemy, weapon) : false;
  }

  function wouldCatchAlly(state, enemy, weapon, facing) {
    if (!spreads(weapon)) return false;
    const covered = weaponHexes(enemy, facing, weapon, state);
    return livingEnemies(state).some((other) => other !== enemy && covered.some((h) => posEq(h, other)));
  }

  function enemyWeaponsBearing(state, enemy, target) {
    const ship = enemyShip(enemy);
    if (!ship) return [];
    const facing = enemyFacing(state, enemy);
    const at = target || state.playerPos;
    return ship.weapons.filter(
      (w) => weaponHexes(enemy, facing, w, state).some((h) => posEq(h, at)) && !wouldCatchAlly(state, enemy, w, facing)
    );
  }

  // Every hex a weapon's pattern actually reaches, fired from `pos` facing
  // hex-direction `facing` (0-5) — each pattern offset traces a straight
  // line out to `range` hexes in that (facing + offset) direction. `facing`
  // is irrelevant for an omnidirectional pattern (it already covers every
  // direction regardless of which one is "ahead"), so callers that don't
  // track a facing (enemies, today) can pass anything, e.g. 0.
  // Which way a hostile ship is pointing. The chasers turn to face the
  // flagship (the board draws them doing exactly that); the fixed
  // emplacements never pivot, and their hardware is omnidirectional
  // anyway, so their facing is immaterial.
  // Which way a hostile's nose points FROM a given hex — the same "toward
  // the flagship" rule the board draws, but askable about a hex it is only
  // considering moving to. Needed because a weapon's footprint is relative
  // to facing, so "would my gun bear if I stood there" cannot be answered
  // without it.
  function facingFrom(state, from) {
    const dir = directionIndex(from, state.playerPos);
    if (dir >= 0) return dir;
    let best = 0;
    let bestDist = Infinity;
    for (let d = 0; d < 6; d++) {
      const dist = hexDistance(neighbor(from, d), state.playerPos);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  // Every hex this hostile could stand on and actually hit you from. This
  // is what "move toward the flagship" should always have meant: the AI
  // used to sort candidate hexes by distance alone, so a class whose gun
  // fires at range 2 walked cheerfully to range 1 and disarmed itself.
  // Measured before this existed: a Lancer closed to distance 1 and then
  // sat beside the flagship for the rest of the sector without ever firing
  // a shot, because its Flank Tubes only bear off-axis at two.
  //
  // In Hoplite the archer cannot shoot adjacent, so it moves to where it
  // CAN shoot and gives ground when you close. Same idea: aim at the
  // firing solution, not at the player.
  function firingPositions(state, enemy) {
    const ship = enemyShip(enemy);
    if (!ship || !ship.weapons.length) return [];
    const spots = [];
    for (const hex of state.boardHexes) {
      if (!canFlyInto(state, hex, enemy)) continue;
      if (hazardAt(state, hex)) continue;
      const facing = facingFrom(state, hex);
      const bears = ship.weapons.some(
        (w) =>
          weaponHexes(hex, facing, w, state).some((h) => posEq(h, state.playerPos)) &&
          !wouldCatchAlly(state, { ...enemy, q: hex.q, r: hex.r }, w, facing)
      );
      if (bears) spots.push(hex);
    }
    return spots;
  }

  function enemyFacing(state, enemy) {
    const dir = directionIndex(enemy, state.playerPos);
    if (dir >= 0) return dir;
    // Not adjacent: point at whichever of the six directions closes the
    // gap most — the same "nose toward the flagship" the board draws.
    let best = 0;
    let bestDist = Infinity;
    for (let d = 0; d < 6; d++) {
      const step = neighbor(enemy, d);
      const dist = hexDistance(step, state.playerPos);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  function weaponHexes(pos, facing, weapon, state, opts) {
    const shape = SHAPES[weapon.shape] || SHAPES.arc;
    // A lobbed shell doesn't care what's between you and it — cover is
    // simply not part of the question for a Mortar, which is the whole
    // reason to own one and the whole reason to fear one.
    return shape(pos, facing, weapon, weapon.ignoresCover ? null : state, opts);
  }

  // What a slug runs into: solid terrain, or any hull that isn't the
  // shooter's own. (The target itself is included before the line stops —
  // the shot hits the first thing in the lane, which is the whole point.)
  function blocksShot(state, hex, opts) {
    if (isBlockingHazard(hazardAt(state, hex))) return true;
    if (enemyAt(state, hex)) return true;
    // A threat map answers "would I be hit if I STOOD there" — so the
    // flagship's current hull must not count as cover for the hex behind
    // it. It used to, which reported the hexes directly behind you as safe
    // from a Railgun lane and then took two hull off you for standing in
    // one. Only the hypothetical callers pass this; real resolution keeps
    // the player solid.
    if (opts && opts.ignorePlayer) return false;
    return posEq(state.playerPos, hex);
  }

  // Spent at a Sector Outpost, standing on its hex — see applyOutpostPurchase.
  // Repairing costs less than permanently raising the cap, and neither
  // consumes a turn (shopping happens between turns, not during the enemy
  // phase loop): a run through the crawl trades kills for scrap for safety.
  //
  // Every outpost always offers Repair (the reliable baseline), plus one
  // more offer picked deterministically-per-level from the pool below —
  // Clubhouse feedback: an outpost shop that's identical every single visit
  // undercuts the "luck and skill" crawler this is meant to be. Same level
  // id always deals the same second offer (reproducible), but different
  // levels/depths vary which one you get.
  // Costs are steep on purpose — Clubhouse feedback: "reward saving up...
  // weapons should be way more expensive... you have to save up for them."
  // A single kill nets 1-2 salvage, so a permanent upgrade means banking
  // several sectors' worth of kills, not a casual spend.
  // Weapons beyond the base kit are bought, not handed out for reaching a
  // sector (Clubhouse feedback: "what about different options and
  // different weapons... you have to pay for them"). Priced above every
  // other offer — a whole new permanent weapon, not just a stat bump.
  // Patching is deliberately NOT the cheapest thing on the shelf. At two
  // salvage a hull point it was the most efficient purchase in the game
  // by a distance, and a pilot that simply bought patches every visit and
  // shot everything it met beat every other way of playing — which makes
  // the shop a formality rather than a decision. Five is still the thing
  // you buy when you're hurt; it is no longer the thing you buy instead of
  // thinking.
  // Which physical crate each shelf offer actually installs.
  const OFFER_ITEM = {
    reinforce: "ablativePlating",
    shield: "shieldGenerator",
    reactor: "microReactor",
    screenArray: "shieldGenerator",
    chargeBank: "chargeBank",
    flakBurst: "flakBurst",
    arcBeam: "arcBeam",
    mortar: "mortar",
    flankTubes: "flankTubes",
    railgun: "railgun",
    missilePod: "missilePod",
    beamLance: "beamLance",
    arcProjector: "arcProjector",
    prowCannon: "prowCannon",
    siegeMaul: "siegeMaul",
    demolitionCharge: "demolitionCharge",
  };

  // `rarity` drives two things (see pickOutpostOfferIds): how LIKELY an
  // item is to be the one the shelf rolls, and — via RARITY_WEIGHT — how
  // hard the bad-luck guarantee has to work to find you one. Repair has no
  // rarity: it's not part of the roll at all, always on the shelf.
  // Tiers follow the game's own unlock ladder — reinforce/shield/reactor
  // are available from Sector 2 on, so they're common; flakBurst/arcBeam/
  // hardpoint unlock a little deeper, so uncommon; mortar/flankTubes/
  // railgun are the late, expensive, run-defining shapes, so rare.
  const OUTPOST_OFFER_POOL = [
    // Six. It has walked down from ten as the rest of the economy moved —
    // income was rebalanced for a shelf topping out at twenty, and then
    // ranged classes stopped walking into their own dead zones, which made
    // them meaningfully deadlier. Measured at that point: eight gave 19/20
    // wins in 60, six gives 23/26, five gives 25/28. Six sits in the band
    // the comparable games do (FTL on Hard is around 60% for a skilled
    // human; these pilots are heuristics and should land under that).
    { id: "repair", label: "Patch 1 Hull", cost: 6 },
    { id: "reinforce", label: "Reinforce Hull (+1 Max)", cost: 10, rarity: "common" },
    // Shields aren't consumable purchases anymore — you buy the GENERATOR
    // (permanent +1 capacity, arrives raised), then re-raising a spent
    // charge costs Energy and a turn (applyRaiseShields), not salvage.
    { id: "shield", label: "Shield Generator (2x2 — raise-able charge)", cost: 14, rarity: "common" },
    // The two "configurable limits" as purchases: your reactor cap (how
    // much Energy you can bank against expensive weapons) and your weapon
    // slots (how many systems can run at once) are both ship stats you
    // grow at Outposts, not constants.
    { id: "reactor", label: "Reactor Upgrade (+1 Max Energy)", cost: 8, rarity: "common" },
    // ---- the two ends of the range ---------------------------------------
    //
    // MEASURED: Slay the Spire's shelf spans 45 to 300 gold — a common card
    // to a top relic, a 6.7x spread — against roughly 110 gold of income an
    // act, so the dearest thing in a shop is TWO TO FOUR ACTS of income.
    // This shelf spanned 6 to 20, a 3.3x spread, against about 17 salvage a
    // sector: the dearest thing in the game was 1.2 sectors of income. That
    // is why every deep dock read as affordable however hard the income
    // side was tuned — there was nothing to save FOR.
    //
    // THE TOP RUNG HAS TO BE SOMETHING STACKING CHEAP ONES CANNOT REACH.
    // Plating, reactors and hold rows all repeat, so a premium version of
    // any of them is just a worse bulk rate. A Reactor Core was tried here
    // first and was a trap for a reason worth writing down: the standard
    // loadout ALREADY FLIES ONE (see STARTING_LOADOUTS), so it sold the
    // ship capacity it had, and the careful pilot's win rate fell 58/150
    // -> 49/150 buying 37 of them.
    //
    // A second screen is the one thing that was capped at one forever
    // ("shield is really good" — Clubhouse, which is why the first went to
    // 14), and a second charge is the biggest survivability step in the
    // game. Two or three sectors of saving. Gated below on already flying
    // the first: without one aboard this is a Shield Generator at double
    // the price.
    { id: "screenArray", label: "Screen Array (2x2 — a SECOND shield charge)", cost: 30, rarity: "rare" },
    // The bottom: something a broke ship can still walk out with. FTL keeps
    // a poor store visit useful by selling fuel and missiles well under
    // system prices; everything here was 6 or more, so the Sector 2 dock
    // was decorative — measured at a 3-salvage bank against a 6-salvage
    // floor, spending ZERO, in every configuration ever tried. That
    // unspendable money is exactly what makes Sector 3 easy.
    { id: "chargeBank", label: "Charge Bank (1x2 — +2 Max Energy, holds it, makes none)", cost: 4, rarity: "common" },
    { id: "hardpoint", label: "Hold Expansion (+1 row of internal space)", cost: 12, rarity: "uncommon" },
    // The three weapons beyond your starting Autocannon, priced on a real
    // curve — each one answers a situation the others can't, and each is
    // the item a hostile class already carries (buy the gun that's been
    // shooting at you).
    // The bottom of the shelf: the one thing an early run can actually
    // afford outright, and the only gun that asks which way you're facing.
    { id: "prowCannon", label: "Prow Cannon (1x2 — a wedge two deep off the nose)", cost: 6, rarity: "common" },
    { id: "siegeMaul", label: "Siege Maul (2x2 — contact only, 2 dmg — it goes through screens)", cost: 12, rarity: "uncommon" },
    { id: "flakBurst", label: "Flak Burst (2x2 — everything touching us, at once)", cost: 10, rarity: "uncommon" },
    { id: "arcBeam", label: "Arc Beam (2x2 — the ring at two. Nothing closer.)", cost: 9, rarity: "uncommon" },
    { id: "beamLance", label: "Beam Lance (1x3 — two to five down any axis, nothing adjacent)", cost: 14, rarity: "rare" },
    { id: "mortar", label: "Mortar (2x2 — lands at three, straight over the rocks)", cost: 13, rarity: "rare" },
    { id: "flankTubes", label: "Flank Tubes (1x3 — the gaps at two, 2 dmg)", cost: 15, rarity: "rare" },
    { id: "railgun", label: "Railgun (1x4 — any axis, board-length, 2 dmg)", cost: 20, rarity: "rare" },
    { id: "missilePod", label: "Missile Pod (2x2 — it flies itself, 2 dmg)", cost: 16, rarity: "rare" },
    // Cheap because it's slow: same reach as the Beam Lance, one round in
    // three. The gun you buy when what you need is to out-range something,
    // not to out-shoot it.
    { id: "arcProjector", label: "Arc Projector (1x3 — one to five down any axis, contact included)", cost: 18, rarity: "rare" },
    // Priced with the Mortar, and for the same reason: it's the answer to
    // ground rather than to a ship. It threatens seven hexes at once and
    // it does not care what's standing on them, including you.
    // The cheapest rare, and priced there on measurement rather than on
    // how impressive its footprint looks. Flown from Sector 1 by the same
    // pilot as every other gun it managed 80 shots for 7 kills and took
    // the median run DOWN to depth 2 — the only weapon that makes a ship
    // worse. A two-round fuse cannot catch a one-hull ship that moves
    // every round; it is a weapon for ground you can force something
    // through, and against the roster in this game that situation is rare.
    // It stays on the shelf because it is genuinely good in a hostile's
    // hands and nothing here is enemy-only, but it is not sold as an
    // upgrade.
    { id: "demolitionCharge", label: "Demolition Charge (2x2 — lobbed two or three, a two-round fuse, seven hexes)", cost: 10, rarity: "rare" },
  ];

  // Roughly Slay the Spire's shop odds (~54/37/9 common/uncommon/rare) and
  // Risk of Rain 2's item-tier weighting (commons dominate the pool,
  // legendaries are the exception) — commons should show up constantly,
  // rares should feel like an event when they do.
  // Retuned when the weapon count went from three to nine. There are only
  // three commons (reinforce / shield / reactor) but at weight 10 they were
  // soaking up two thirds of every roll, so a shelf was three stat bumps
  // and the guns — six of which are rare — almost never appeared: measured
  // across forty runs, two Beam Lances and one Arc Projector were bought in
  // total. A dock has to be a real chance to change the ship, not a vending
  // machine for hull points.
  const RARITY_WEIGHT = { common: 6, uncommon: 4, rare: 2 };

  // Weighted sample of `count` items from `items`, no repeats, heavier
  // items more likely each draw — the standard "shrinking roulette wheel":
  // roll a point along the total weight, walk the list until it lands,
  // remove that item, repeat against what's left.
  function weightedPickWithoutReplacement(items, weightOf, count, rng) {
    const pool = items.slice();
    const picked = [];
    while (pool.length && picked.length < count) {
      const total = pool.reduce((sum, it) => sum + weightOf(it), 0);
      let roll = rng() * total;
      let i = 0;
      for (; i < pool.length - 1; i++) {
        roll -= weightOf(pool[i]);
        if (roll < 0) break;
      }
      picked.push(pool.splice(i, 1)[0]);
    }
    return picked;
  }

  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Mixes the whole-run seed (see state.runSeed) into a per-question salt,
  // so "which offers does Sector 2 deal" and "which berth does its Outpost
  // use" roll off different numbers even though they're both asked about
  // the same level id. A runSeed of 0 (the default when nothing supplies
  // one — e.g. a caller that builds state directly) collapses this back to
  // plain seededRandom(salt), so every existing deterministic-per-level-id
  // caller/test is unaffected.
  function runSeeded(runSeed, salt) {
    return seededRandom((Math.imul((runSeed || 0) >>> 0, 2654435761) + salt) >>> 0);
  }

  // Repair is always on offer (the reliable baseline), but how many EXTRA
  // offers sit alongside it varies (0, 1, or all of them) — a guaranteed
  // fixed shop every visit read as "too easy and not very interesting"
  // (Clubhouse feedback).
  // Used to be deterministic per level id alone — replaying Sector 2 (or
  // any hand-authored sector) dealt the exact same stock every single run,
  // which is the "selling the same thing every time" complaint: reproducible
  // isn't the same as lucky. Now it's per level id AND per run (see
  // state.runSeed) — the same sector still can't reroll mid-visit (you're
  // not punished for backing out of the menu), but a fresh run deals it
  // fresh.
  // How many salvage-eligible cost swings apply, either way — wide enough
  // to feel like a real roll ("a cheap Railgun!"), narrow enough that a
  // rolled price never breaks the hand-tuned cost curve ("weapons should
  // be way more expensive... you have to save up for them" — a Railgun
  // at 24±15% is still 20-28, still a save-up purchase either way).
  const PRICE_VARIANCE = 0.15;

  // How many consecutive Outpost visits are allowed to roll zero rare-tier
  // items (Mortar/Flank Tubes/Railgun) before the next one is guaranteed
  // one — see state.raresSkipped. Same shape as Slay the Spire's rare-card
  // "pity" offset: pure bad luck can make a run miss the shapes it needs
  // to answer what it's fighting, which isn't lucky, it's unsolvable.
  const RARE_PITY_VISITS = 3;

  // What's even eligible to be offered, at an Outpost OR a Discovery — how
  // deep the sector is, and what's already bolted in. Factored out so a
  // Discovery's free item roll (see resolveDiscoveryReward) draws from
  // exactly the same "what could this ship plausibly find here" pool as
  // the shop does, rather than a second hand-maintained copy of the same
  // depth-gating rules.
  //
  // A frontier station is a scrapyard with a welding rig, not a showroom
  // (Clubhouse: "too many options too soon... this is a gritty scifi, why
  // sell so much at every station?"). What a station can even stock
  // depends on how deep it is. The first few sell survival — patches,
  // plating, a shield rig. Weapons are a find, and the heavy hardware only
  // turns up out where the wrecks that carried it are.
  // A station won't try to sell you a second Flak Burst while the first
  // is still bolted in — stocking something you already fly is the same
  // as stocking nothing.
  function eligibleOfferStock(levelId, aboard) {
    const carried = new Set(aboard || []);
    return OUTPOST_OFFER_POOL.filter((o) => {
      if (o.id === "repair") return false; // always on the shelf, added by the caller
      if (WEAPON_SYSTEM_KEYS.includes(o.id) && carried.has(o.id)) return false;
      if (o.id === "shield" && carried.has("shieldGenerator")) return false;
      // Shapes arrive one at a time so each one gets to be a lesson: the
      // crowd answer, then standoff, then the gun that beats cover, then
      // the one that covers what a lane can't, then the sniper.
      // The rule this list encodes: a gun goes on a shelf a sector or two
      // after the thing it answers turns up, so buying it is a response to
      // something you've met rather than a lottery ticket. Four weapons
      // were added without a line here and fell through to "any depth",
      // which is how a Missile Pod could sit on the Sector 2 shelf years
      // before anything launches at you.
      //
      // Depth is the ENEMY's arrival, plus a sector to have met it:
      //   flakBurst  2  — crowds start in the campaign.
      //   arcBeam    3  — the Sentry Line, the first thing that outranges
      //                   you and won't come to you.
      //   beamLance  3  — the Picket reaches five hexes from Sector 2, and
      //                   reach is the only honest answer to reach.
      //   mortar     6  — cover starts mattering.
      //   railgun    8  — the Railgun Destroyer's own gun.
      //   flankTubes 8  — the Lancer's.
      //   missilePod 8  — the Carrier's.
      //   arcProjector / demolitionCharge 8 — the Cutter's and the
      //                   Demolitionist's, and both land at depth 8.
      // Five items used to land at 8 together, and nothing at all became
      // eligible between 4 and 8 — so the dearest thing on a shelf could
      // not rise for four sectors while the bank tripled, and Sector 7 was
      // the worst dock in the game at 100% affordable. Staggered: the
      // Lancer and the Carrier are already in the water by 6 and 7, so
      // their guns are on schedule under the rule this list encodes (a gun
      // goes on a shelf a sector or two after the thing it answers turns
      // up). The Railgun stays at 8 as the top of the weapon range.
      if (o.id === "railgun") return levelId >= 8;
      if (o.id === "flankTubes") return levelId >= 6;   // the Lancer's
      if (o.id === "missilePod") return levelId >= 7;   // the Carrier's
      if (o.id === "arcProjector" || o.id === "demolitionCharge") return levelId >= 8;
      if (o.id === "mortar") return levelId >= 6;
      if (o.id === "beamLance") return levelId >= 4;   // the Picket's own gun, met in Sector 2
      if (o.id === "siegeMaul") return levelId >= 4;   // the Escort's screen, met in Sector 4
      if (o.id === "arcBeam" || o.id === "hardpoint") return levelId >= 3;
      if (o.id === "flakBurst") return levelId >= 2;
      if (o.id === "prowCannon") return true;          // the cheap one, available from the off
      // Only ever the SECOND screen, and only out where the boards are big
      // enough to need it — see the pool entry.
      if (o.id === "screenArray") return levelId >= 6 && carried.has("shieldGenerator");
      if (o.id === "chargeBank") return true;          // the floor of the range, at any depth
      return true; // reinforce / shield / reactor: basic dock trade at any depth
    });
  }

  function pickOutpostOfferIds(levelId, aboard, runSeed, raresSkipped, lastOfferIds) {
    // Nine offers in one list read as a catalogue, and with early-run
    // salvage most of it was greyed out anyway: a wall of things you can't
    // have instead of a decision. Repair plus THREE things is the whole
    // shelf — see eligibleOfferStock above for what can even be on it.
    const carried = new Set(aboard || []);
    const allStock = eligibleOfferStock(levelId, aboard);
    const rng = runSeeded(runSeed, levelId * 7919 + 13);
    // ---- A DOCK DOES NOT RESTOCK WHAT THE LAST DOCK HAD --------------------
    //
    // MEASURED, 150 careful runs: 48% of shelf slots were on the previous
    // shelf too, and 81% of docks repeated at least one item. Half the shop
    // was the same shop again — which is the difference between a frontier
    // station and a vending machine, and it makes a dock stop being worth
    // the detour ("we don't want a bunch of repeats" — Clubhouse).
    //
    // Nothing here is a per-item cooldown or a memory of the whole run: it
    // is only the LAST shelf, carried through carryOver the same way
    // raresSkipped is. That is enough, because a repeat only reads as one
    // when you saw it a moment ago — the same gun turning up again four
    // sectors later is a second chance, not a rerun.
    //
    // It remembers what was ROLLED, not what is left: buying something
    // takes it off outpostOfferIds, and a shelf that forgot the thing you
    // just bought would cheerfully stock it again at the very next dock.
    //
    // Fresh stock is PREFERRED, not required. An all-or-nothing threshold
    // was tried first (use the filtered pool only if four items survive,
    // else the unfiltered one) and it dealt whole repeat shelves whenever
    // the pool was thin, which is exactly when repeats are most likely:
    // 25% of slots still came back repeated. Each slot now takes a fresh
    // item if one is left and dips into the rest only when nothing fresh
    // remains, so a shelf carries the fewest repeats it possibly can
    // rather than three or none.
    const last = new Set(lastOfferIds || []);
    const fresh = allStock.filter((o) => !last.has(o.id));
    const stock = allStock;
    const drawFrom = (pool, n) => {
      const taken = [];
      const fresher = pool.filter((o) => !last.has(o.id));
      taken.push(...weightedPickWithoutReplacement(fresher, (o) => RARITY_WEIGHT[o.rarity] || 1, n, rng));
      if (taken.length < n) {
        const rest = pool.filter((o) => !taken.includes(o));
        taken.push(...weightedPickWithoutReplacement(rest, (o) => RARITY_WEIGHT[o.rarity] || 1, n - taken.length, rng));
      }
      return taken;
    };
    // THREE slots, not two, weighted by rarity rather than a flat
    // shuffle-and-slice — commons show up often, rares are the exciting
    // exception (see RARITY_WEIGHT). Flat odds still needed the slot count
    // bumped from two to three in the first place: with six weapons in the
    // world a two-slot shelf simply cannot show you the gun you need often
    // enough — measured out as the Arc Beam never appearing at all across
    // sixty runs, and every run reaching the Bulwark with the Autocannon
    // it started with. A dock has to be a real chance to change the ship.
    // ---- the shelf has to have a TOP END -----------------------------------
    //
    // MEASURED, 150 careful runs. B is the bank at the dock, D the dearest
    // thing on that shelf:
    //
    //   sector    2     3     4     5     6     7     8     9    10    12
    //   B       4.4  22.4  25.0  15.7  22.8  40.4  57.3  61.5  67.5  82.3
    //   D      13.5  13.4  13.4  12.9  12.9  13.1  14.4  14.4  14.2  20.0
    //
    // D is FLAT at about thirteen and a half from Sector 2 to Sector 10
    // while the bank goes 4 -> 82, and the dearest item on offer was
    // affordable on 92-100% of visits from Sector 3 on. That is the
    // complaint verbatim: "by level three you can buy anything you want."
    //
    // The arsenal is not the problem — it HAS a top end (Flank Tubes 15,
    // Missile Pod 16, Arc Projector 18, Railgun 20). Those four never
    // reached a shelf, because all of them are `rare` (weight 2 against a
    // common's 6) and they were competing with the cheap stock for all
    // three slots. Rolling three times from one weighted bag deals three
    // cheap things nearly every time, so the shop had no ceiling at all.
    //
    // So the third slot is a REACH: drawn from the dearest third of what
    // is eligible here, rarity still deciding which item inside that band.
    // The other two are rolled exactly as before, which is what keeps
    // commons common — two thirds of the shelf is still pure rarity.
    //
    // A shop is only a decision while something on it is out of reach.
    // This is Into the Breach's shape — the catalogue always exceeds the
    // budget — and it costs nothing: not one price was changed.
    const rolled = drawFrom(stock, 2);
    // The reach band is measured over FRESH stock where there is any, so a
    // thin fresh pool cannot quietly drag the dear slot back down to the
    // cheap end — the band is about price, and it should be the top of
    // whatever this dock can actually offer you that is new.
    const reachPool = fresh.filter((o) => !rolled.includes(o)).length
      ? fresh.filter((o) => !rolled.includes(o))
      : stock.filter((o) => !rolled.includes(o));
    const byPrice = reachPool.slice().sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1));
    const reach = byPrice.slice(Math.floor((byPrice.length * 3) / 4));
    // The band is the top QUARTER, not the top third: at a third it reaches
    // down far enough that the dearest entry only averaged 16.7 salvage
    // against the 14.2 it exists to beat. Drawn FLAT inside the band, not rarity-weighted. Rarity weighting
    // here fights the slot's whole purpose: an uncommon weighs 4 against a
    // rare's 2, so the dear slot skewed to the cheap end of its own band
    // and the dearest entry only averaged 16.3 salvage against the 14.2 it
    // was meant to beat. Rarity's job is done by the two slots above; this
    // one exists to be expensive, and the band has already decided which
    // items qualify.
    if (reach.length) rolled.push(reach[Math.floor(rng() * reach.length)]);
    const ids = ["repair", ...rolled.filter(Boolean).map((o) => o.id)];
    // Both guarantees below APPEND and drop the last unforced entry,
    // rather than writing into the same slot — at sector 3 they used to
    // overwrite each other, so a ship with no screen could be promised one
    // and handed an Arc Beam instead.
    const FORCED = new Set();
    const force = (id) => {
      if (ids.includes(id)) return;
      const drop = ids.findIndex((p, i) => i > 0 && !FORCED.has(p));
      if (drop >= 0) ids.splice(drop, 1);
      ids.push(id);
      FORCED.add(id);
    };
    // A three-Hull ship lives or dies on screens, so a yard will always
    // find you a generator if you're flying without one. Everything else
    // is what they happen to have; this one is the trade that keeps the
    // crawl survivable at all.
    // ...but not at two docks running. MEASURED: this promise alone put a
    // Shield Generator on 269 of 300 Sector 6 shelves for a screenless ship
    // — a slot permanently spent on one item, at every station, for as long
    // as the ship declined it. A guarantee that fires every single time is
    // not a safety net, it is a fixture. Every other dock still means you
    // are never more than one station from a screen.
    if (!carried.has("shieldGenerator") && !last.has("shield")) force("shield");
    // ...and the same promise about guns. Flying on nothing but the
    // starting Autocannon means every fight is at contact, which against a
    // roster that reaches three and five hexes is not a strategy, it's a
    // countdown. If a yard has any second gun in stock it will find you
    // one — after that you're on the roll like everyone else.
    const armed = WEAPON_SYSTEM_KEYS.filter((k) => k !== "autocannon" && carried.has(k));
    if (!armed.length) {
      // Fresh guns first, same rule as the roll: promising a second gun is
      // no comfort if it is the same gun the last station had.
      const allGuns = stock.filter((o) => WEAPON_SYSTEM_KEYS.includes(o.id) && !ids.includes(o.id));
      const guns = allGuns.filter((o) => !last.has(o.id)).length ? allGuns.filter((o) => !last.has(o.id)) : allGuns;
      if (guns.length) force(guns[Math.floor(rng() * guns.length)].id);
    }
    // Sector 3 is the Sentry Line — the first sector with something that
    // outranges you and won't come to you. The weapon that answers it has
    // to be ON THE SHELF there, not left to the roll, or the lesson is
    // just "take two hits and hope".
    if (levelId === 3 && !carried.has("arcBeam")) force("arcBeam");

    // Bad-luck protection: three straight visits with nothing rare on the
    // shelf forces the fourth to deal one, same mechanism as the
    // guarantees above. Doesn't fire (and doesn't count against the
    // streak) at depths where nothing rare is eligible yet — that's the
    // unlock schedule doing its job, not a dry spell.
    const hasRareEligible = stock.some((o) => o.rarity === "rare");
    const gotRare = ids.some((id) => (OUTPOST_OFFER_POOL.find((o) => o.id === id) || {}).rarity === "rare");
    let nextRaresSkipped = raresSkipped || 0;
    if (gotRare) {
      nextRaresSkipped = 0;
    } else if (hasRareEligible) {
      if (nextRaresSkipped >= RARE_PITY_VISITS) {
        const allRare = stock.filter((o) => o.rarity === "rare" && !ids.includes(o.id));
        const rareChoices = allRare.filter((o) => !last.has(o.id)).length ? allRare.filter((o) => !last.has(o.id)) : allRare;
        if (rareChoices.length) {
          force(rareChoices[Math.floor(rng() * rareChoices.length)].id);
          nextRaresSkipped = 0;
        }
      } else {
        nextRaresSkipped += 1;
      }
    }

    // Prices wobble too — a fresh roll per offer, off the same run-seeded
    // stream as the stock itself, so the exact same Railgun offer can cost
    // more or less than last time you saw it. Repair sits out: it's "the
    // reliable baseline," not part of the gamble.
    const prices = {};
    for (const id of ids) {
      if (id === "repair") continue;
      const offer = OUTPOST_OFFER_POOL.find((o) => o.id === id);
      const mult = 1 - PRICE_VARIANCE + rng() * (2 * PRICE_VARIANCE);
      prices[id] = Math.max(1, Math.round(offer.cost * mult));
    }

    return { ids, prices, raresSkipped: nextRaresSkipped };
  }

  // The Bulwark's own station is the one shop in the crawl that isn't a
  // gamble: it is parked directly before the fight the whole run has been
  // heading toward, and arriving with salvage you can't spend is a bad
  // way to lose. Patches, a screen, and the heavy gun — always.
  function bossOutpostOfferIds() {
    return ["repair", "shield", "railgun"];
  }

  // Which hex the Sector Outpost actually sits on. Procedural sectors have
  // resolved this to a real position (or null) already, in levels.js's
  // generateLevel — pass it straight through. Hand-authored campaign
  // sectors (2-4) used to hardcode a single hex, always the same one on
  // every run of that sector — the "ports always in the same place"
  // complaint. They now declare `outpost: true` plus a pool of valid
  // berths in `outpostCandidates` (see levels.js), and which one gets used
  // is rolled per RUN here — same sector, different dock, different run.
  function pickOutpostPos(level, runSeed) {
    if (!level.outpost) return null;
    if (level.outpost !== true) return { q: level.outpost.q, r: level.outpost.r };
    const candidates = level.outpostCandidates || [];
    if (!candidates.length) return null;
    const rng = runSeeded(runSeed, level.id * 104729 + 31);
    return candidates[Math.floor(rng() * candidates.length)];
  }

  // A rare, optional-detour hex — a derelict wreck, a silent outpost, an
  // uncharted body — that pays out the instant the flagship flies onto it,
  // no menu, never a downside (see resolveDiscoveryReward). Only procedural
  // sectors get one, deliberately NOT via generateLevel's own local rng:
  // that one is seeded purely off (depth, variantId) — same depth always
  // deals the same board — which is exactly right for enemies/hazards but
  // would make a Discovery's presence and position fixed forever for a
  // given depth if it rolled there too. So generateLevel only emits the
  // CANDIDATE hexes (levels.js); whether one actually appears, and which
  // candidate wins, is rolled here against the per-RUN seed, same split as
  // pickOutpostPos above.
  const DISCOVERY_CHANCE = 0.08;
  // Purely cosmetic — three names for the one mechanic below, each with
  // its own generated icon (games/hypergolic-hull/icons/discovery-<id>.png,
  // app.js picks by id). Rolled the same way as which hex it lands on, so
  // "what did I find" varies same as "where."
  const DISCOVERY_FLAVORS = [
    { id: "derelict", label: "Derelict Hulk" },
    { id: "outpost", label: "Silent Outpost" },
    { id: "wreckage", label: "Uncharted Wreckage" },
  ];
  // Returns { pos: {q,r}, flavor, label } or null — never fires (and
  // never rolls a flavor) when there's nowhere valid to put one.
  function pickDiscovery(level, runSeed) {
    const candidates = level.discoveryCandidates || [];
    if (!candidates.length) return null;
    const rng = runSeeded(runSeed, level.id * 200003 + 71);
    if (rng() >= DISCOVERY_CHANCE) return null;
    const pos = candidates[Math.floor(rng() * candidates.length)];
    const flavor = DISCOVERY_FLAVORS[Math.floor(rng() * DISCOVERY_FLAVORS.length)];
    return { pos: { q: pos.q, r: pos.r }, flavor: flavor.id, label: flavor.label };
  }

  // Placed only when carryOver says a previous sector exists to return to
  // (see createGameState below) — an in-world object, not a UI button
  // (Clubhouse feedback: "it should be, like... a wormhole sort of thing").
  // Position is seeded per level id, same pattern as pickOutpostOfferIds,
  // so it's reproducible but never fixed at one spot — "the wormholes
  // shouldn't always just end up in the exact same place." The flagship
  // spawns standing directly on it (see createGameState), not somewhere
  // unrelated — "when you come out the other side of the wormhole, you
  // start as if you're on top of that wormhole, not next to it."
  function pickPortalPos(state, levelId) {
    const rng = seededRandom(levelId * 15485863 + 29);
    const reserved = [...state.exits, state.outpostPos, state.discoveryPos].filter(Boolean);
    const clear = (h) =>
      !reserved.some((r) => posEq(r, h)) &&
      !hazardAt(state, h) &&
      !state.enemies.some((e) => e.alive && hexDistance(h, e) < 2);
    // ...and never within spitting distance of a gate. Coming back through
    // a wormhole and finding the way out three hexes away isn't a sector,
    // it's a corridor — you should have to cross the place again, by
    // whatever route it offers this time.
    const gates = state.exits.length ? state.exits : [state.exitPos];
    const roomy = state.boardHexes.filter(
      (h) => clear(h) && gates.every((g) => hexDistance(h, g) >= 5)
    );
    const candidates = roomy.length ? roomy : state.boardHexes.filter(clear);
    if (!candidates.length) return null;
    return candidates[Math.floor(rng() * candidates.length)];
  }

  // ---- can this board be crossed? ----------------------------------------
  // Worth writing down, because it was got wrong once: a fixed gun's kill
  // zone is NOT a wall. Every emplacement in the game costs more to fire
  // than its reactor makes in a round — a Sentry's beam is 2 against +1,
  // a Railgun's slug 4 — so every zone blinks. Crossing one is a question
  // of WHEN, not whether, and the answer is on the contact's own scan
  // card: CHARGING 2/4 means two more rounds of free passage.
  //
  // An earlier version of this file treated those zones as permanent and
  // "guaranteed" a lane around them. On a 9x11 board a single Railgun's
  // six lanes radiate into wedges you can't get between, so that rule
  // decided every board with a Destroyer on it was unsolvable and quietly
  // replaced the Destroyer with a cruiser. The lanes ARE the design; the
  // timing is the puzzle.
  function staticKillZones(state) {
    const zone = new Set();
    for (const enemy of livingEnemies(state)) {
      const ship = enemyShip(enemy);
      // An emplacement is simply a hull with no drive in it — that's the
      // whole definition, same as the flagship with its engines pulled.
      if (!ship || ship.hasDrive) continue;
      for (const weapon of ship.weapons) {
        if (enemy.energy < weapon.energyCost) continue; // discharged: this is the gap you cross in
        for (const hex of weaponHexes(enemy, 0, weapon, state, HYPOTHETICAL)) {
          if (onBoard(state, hex)) zone.add(hexKey(hex));
        }
      }
    }
    return zone;
  }

  function createGameState(level, carryOver) {
    validateLevel(level);
    // Built before the state literal so the Outpost's shelf can be stocked
    // against what's actually bolted into this ship — and so the ship's
    // hull and bus can be read off the hardware rather than carried as
    // free-floating numbers. Plating IS the extra hull; reactors ARE the
    // bus. Same as any hostile out there (see ENEMY_TYPES).
    const hold = buildHold(level, carryOver);
    const derived = deriveShip(hold);
    const maxHull = START_HULL + derived.hullBonus;
    // Rolled fresh (via Math.random(), outside the engine — see app.js's
    // freshRunSeed) the moment an actual new run starts, then carried
    // through carryOver from sector to sector for the rest of that run.
    // Everything that used to be "reproducible" purely off level id — which
    // outpost berth, which shop stock — now also depends on this, so two
    // playthroughs of the same sector are no longer guaranteed identical.
    // Defaults to 0 (not random) when nothing supplies one, so a caller
    // that builds state directly — every existing engine test — still gets
    // the exact old deterministic-per-level-id behavior.
    const runSeed = (carryOver && Number.isFinite(carryOver.runSeed)) ? carryOver.runSeed >>> 0 : 0;
    // How many consecutive Outpost visits this run has gone without a
    // rare-tier item on the shelf (see RARE_PITY_VISITS) — carried through
    // carryOver exactly like runSeed, so the bad-luck guarantee tracks
    // across the whole run rather than resetting every sector.
    const priorRaresSkipped = (carryOver && Number.isFinite(carryOver.raresSkipped)) ? carryOver.raresSkipped : 0;
    // What the previous dock had on it — see the anti-repeat note in
    // pickOutpostOfferIds. Carried exactly like raresSkipped, and empty on
    // the first sector of a run, which is correct: there is no last shelf.
    const priorOfferIds = (carryOver && Array.isArray(carryOver.outpostStockIds)) ? carryOver.outpostStockIds : [];
    let outpostOfferIds = [];
    let outpostOfferPrices = {};
    let raresSkipped = priorRaresSkipped;
    if (level.outpost) {
      if (level.isBoss) {
        outpostOfferIds = bossOutpostOfferIds(); // fixed offers at fixed prices — see bossOutpostOfferIds
      } else {
        const rolled = pickOutpostOfferIds(
          level.id,
          [...hold.items.map((it) => it.id), ...hold.cargo],
          runSeed,
          priorRaresSkipped,
          priorOfferIds
        );
        outpostOfferIds = rolled.ids;
        outpostOfferPrices = rolled.prices;
        raresSkipped = rolled.raresSkipped;
      }
    }
    // Rare, optional-detour hex — see pickDiscovery. Never on a level with
    // no candidates (the four hand-authored campaign sectors never get
    // any — see levels.js), and even then only ~8% of the time.
    const discovery = pickDiscovery(level, runSeed);
    const state = {
      levelId: level.id,
      levelName: level.name || `Sector ${level.id}`,
      radius: level.radius || null,
      boardHexes: buildBoardHexes(level),
      actions: ["sublight"], // derived from the Hold below (syncHoldDerived)
      playerPos: { q: level.playerStart.q, r: level.playerStart.r },
      // Which hull art the flagship shows — set once, at the top of the
      // run, from whichever loadout was actually picked (buildHold reads
      // this same carryOver field to build the kit). Carried through
      // carryOver every sector after, same as runSeed — so buying a Shield
      // Generator mid-run as a Standard start doesn't suddenly make the
      // ship LOOK like Escort Start. What you picked at the outset is what
      // you fly, cosmetically, for the whole run.
      startingLoadout: (carryOver && carryOver.startingLoadout) || "standard",
      // Hull damage is PERMANENT across jumps — warping doesn't patch a
      // breached deck ("why is hull repaired between every jump? doesn't
      // make any sense"). Only an Outpost repair puts pips back. A fresh
      // run (no carryOver) starts at full.
      // `|| maxHull` used to turn a carried hull of 0 into a full one, and
      // let a negative value through untouched.
      hull: Math.max(0, Math.min(
        carryOver && Number.isFinite(carryOver.hull) ? carryOver.hull : maxHull,
        maxHull
      )),
      maxHull: maxHull,
      salvage: Math.max(0, (carryOver && Number.isFinite(carryOver.salvage) ? carryOver.salvage : 0)),
      // Shields are capacity (installed Shield Generators in the Hold) +
      // charges (raised by spending Energy — see applyRaiseShields).
      // Capacity is derived below; carried charges clamp against it.
      maxShields: 0,
      // A Shield Generator "arrives raised" whether bought at an Outpost
      // (see applyOutpostPurchase) or started with (see
      // STARTING_LOADOUTS' Escort Start) — a fresh ship's shields default
      // to full capacity, not an empty one it has to spend a turn on.
      shieldCharges: (carryOver && Number.isFinite(carryOver.shieldCharges)) ? carryOver.shieldCharges : derived.maxShields,
      // Energy refills to full at every warp jump; how full "full" is
      // depends entirely on the reactors and banks in the hold.
      maxEnergy: derived.maxEnergy,
      energy: derived.maxEnergy,
      exitPos: { q: exitList(level)[0].q, r: exitList(level)[0].r }, // primary/first gate — kept for single-exit callers
      exits: exitList(level).map((ex) => ({ q: ex.q, r: ex.r, variantId: ex.variantId || null })),
      usedExitVariant: null, // set on win — see spendAp — which gate you actually flew through
      // "How do you win, or is it just runs?" — a boss sector (see
      // levels.js's bossLevel) clearing is a real "Run Complete" milestone,
      // not a routine sector clear. isVictory flips true the instant it's
      // won (see spendAp) — app.js checks it to show a distinct
      // overlay instead of silently auto-continuing like every other clear.
      isBoss: Boolean(level.isBoss),
      isVictory: false,
      // Visual identity — {variant, band} from levels.js's generateLevel;
      // the renderer keys its backdrop palette off this so where you are
      // LOOKS like how you got there (gate tint) and how deep you are.
      theme: level.theme || null,
      // WHERE this is — name, colour, furniture, zoom. The renderer paints
      // the whole sky from it and the chart labels the star with it, so a
      // sector you've been to before is recognisable on sight.
      locale: level.locale || null,
      // Some stretches of space are worth more per wreck than others.
      salvageBonus: level.salvageBonus || 0,
      // Ordnance in flight. Persisted with the rest of the sector, so a
      // missile you left behind is still coming for you when you come back.
      missiles: [],
      runSeed: runSeed,
      raresSkipped: raresSkipped,
      // The shelf AS ROLLED, never edited by purchases — the anti-repeat
      // memory for the next dock. A dry sector passes the previous one
      // straight through rather than clearing it: three sectors with no
      // station is not a reason to restock what you last saw.
      outpostStockIds: outpostOfferIds.length ? outpostOfferIds.slice() : priorOfferIds,
      outpostPos: pickOutpostPos(level, runSeed),
      outpostOfferIds: outpostOfferIds,
      // Per-visit rolled price for each id in outpostOfferIds (see
      // pickOutpostOfferIds) — outpostOffers()/applyOutpostPurchase() read
      // this instead of OUTPOST_OFFER_POOL's flat cost. Empty for the boss
      // shop (bossOutpostOfferIds) and for a sector with no Outpost.
      outpostOfferPrices: outpostOfferPrices,
      discoveryPos: discovery ? discovery.pos : null,
      discoveryFlavor: discovery ? discovery.flavor : null,
      discoveryLabel: discovery ? discovery.label : null,
      exitRule: level.exitRule,
      exitUnlocked: false,
      hazards: (level.hazards || []).map((h) => ({ type: h.type, q: h.q, r: h.r })),
      enemies: level.enemies.map((e, i) => {
        const def = ENEMY_TYPES[e.type];
        if (!def) throw new Error(`Unknown enemy type: ${e.type}`);
        return {
          id: `e${i}`,
          type: e.type,
          q: e.q,
          r: e.r,
          alive: true,
          // Airframe plus whatever plating is bolted to it — derived, not
          // declared, exactly like the flagship's maxHull.
          hp: def.maxHull,
          maxHp: def.maxHull,
          // Its reactor is the reactors in its hold. A Railgun spawns
          // EMPTY and visibly charges toward its first shot (the
          // telegraph); a cost-1 chaser spawns full and fires every turn.
          energy: def.startsEmpty ? 0 : def.ship.maxEnergy,
          maxEnergy: def.ship.maxEnergy,
          // A Shield Generator in a hostile hold does what one in yours
          // does: absorbs a hit, then it's spent. Same item, same rule,
          // same both ways round — an Escort is simply the first class
          // that bothered to bolt one on.
          shieldCharges: def.ship.maxShields,
          maxShields: def.ship.maxShields,
        };
      }),
      // The Hold: the ship's equipment grid — either carried whole from
      // the previous sector (a run's ship IS its hold) or built fresh
      // from the level's starting kit. `systems` is derived from it.
      hold,
      systems: { warpdrive: true },
      // Direction index (0-5) the flagship is currently facing — gameplay-
      // relevant now, not just cosmetic, since a directional weapon's
      // pattern is relative to it. Updated on every Sublight move; starts
      // facing direction 2 ({q:0,r:-1}), i.e. "up" toward the Warp Gate on
      // every board's bottom-to-top layout.
      facing: 2,
      // Action Points: the round's budget, for BOTH sides ("enemies should
      // also have AP — that's kinda the point"). Every player action costs
      // 1 AP; when they're spent (or passed via applyEndTurn) the enemy
      // phase runs and each enemy spends ENEMY_AP of its own. Free-form:
      // two moves, two volleys, move+fire — energy is the real limiter.
      maxAp: (carryOver && carryOver.maxAp) || START_AP,
      ap: (carryOver && carryOver.maxAp) || START_AP,
      turnCount: 0, // counts ROUNDS (full player phase + enemy phase), not single actions
      // What the ship arrived with, so leaving unmarked can be paid for
      // (awardCleanRun). Snapshotted here rather than derived from maxHull:
      // you can arrive already damaged, and flying a sector clean from two
      // hull is the same achievement as flying it clean from five.
      hullAtSectorStart: null,
      status: "playing", // "playing" | "won" | "lost"
      log: [],
      events: [], // animation cues from the last action, e.g. {type:"kill",q,r}
      wormholePos: null,
    };
    if (carryOver && carryOver.hasPrevious) {
      const portalPos = pickPortalPos(state, level.id);
      if (portalPos) {
        // "When you come out the other side of the wormhole, you start as
        // if you're on top of that wormhole, not next to it" — Clubhouse
        // feedback overriding an earlier, more cautious version of this
        // that spawned adjacent instead. Standing on it from turn zero
        // would otherwise let the very next action (e.g. RECHARGE)
        // instantly trip the return trip. Nothing in THIS file prevents
        // that — wormholeAvailable is a bare posEq query, and the comment
        // here used to claim it had a turnCount guard, which it never did.
        // The renderer owns it: app.js remembers the hex you arrived on
        // and holds the trigger until the flagship has actually left it.
        state.wormholePos = portalPos;
        state.playerPos = { q: portalPos.q, r: portalPos.r };
      }
    }
    // Gate status first, intro LAST — the UI's readout strip shows only the
    // newest log line, and the first thing a fresh sector should say is its
    // intro, not the always-true "Warp Gate online."
    checkExitUnlock(state);
    if (level.intro) pushLog(state, level.intro);
    // Everything the ship can DO derives from what's in the Hold.
    syncHoldDerived(state);
    // Last, after every hull adjustment above has settled: the mark to beat
    // for the clean-run bonus.
    state.hullAtSectorStart = state.hull;
    return state;
  }

  // Alternate starting KITS for a brand-new run — unlocked between runs
  // with Requisition (see app.js), not bought in-run, so the tuned salvage
  // economy never touches them. Each is a different SHAPE of the same
  // starting budget, not a straight power bump: Salvager originally traded
  // NOTHING for its extra Hull, which made it a strict upgrade over
  // Standard the moment it was unlocked — the other two options became
  // pointless to ever pick again. Both alternatives now pay the same price
  // (a Micro Reactor instead of a full Reactor Core — less energy bank
  // until a real one's bought) for two different things, so there's a
  // real question to answer, not a race to whichever unlocks first.
  const STARTING_LOADOUTS = {
    standard: {
      label: "Standard",
      cost: 0,
      blurb: "The baseline. Full reactor, no shield.",
      kit: ["sublightDrive", "reactorCore", "scanner"],
    },
    escort: {
      label: "Escort Start",
      cost: 10,
      blurb: "Shield raised from turn one — one hit absorbed free. Costs reactor capacity to fit it.",
      kit: ["sublightDrive", "microReactor", "scanner", "shieldGenerator"],
    },
    salvager: {
      label: "Salvager Start",
      cost: 20,
      blurb: "An extra plate of armor. Same reactor cost as Escort Start.",
      kit: ["sublightDrive", "microReactor", "scanner", "ablativePlating"],
    },
  };

  // A loadout's stats without building a whole game state — just the kit
  // run through the same deriveShip every ship reads its stats off. Lets
  // app.js's death-overlay picker show what a loadout actually gives you
  // before you commit to it, the same way an Outpost offer can be
  // inspected before it's bought.
  function previewLoadout(loadoutId) {
    const loadout = STARTING_LOADOUTS[loadoutId] || STARTING_LOADOUTS.standard;
    const hold = { cols: HOLD_COLS, rows: HOLD_ROWS, blocked: HOLD_BLOCKED.slice(), items: [], cargo: [] };
    for (const id of loadout.kit) autoPlaceInHold(hold, id);
    const ship = deriveShip(hold);
    return {
      id: loadoutId,
      label: loadout.label,
      cost: loadout.cost,
      blurb: loadout.blurb,
      kit: loadout.kit.slice(),
      maxHull: START_HULL + ship.hullBonus,
      maxEnergy: ship.maxEnergy,
      maxShields: ship.maxShields,
    };
  }

  // A fresh sector's hold: carried whole from the previous one (the ship
  // travels), or built from a starting kit — every ship begins with a
  // Sublight Drive and a reactor, plus whatever weapons the level's
  // actions list (or a carryOver.extraActions fixture) grants.
  function buildHold(level, carryOver) {
    if (carryOver && carryOver.hold) return JSON.parse(JSON.stringify(carryOver.hold));
    const hold = { cols: HOLD_COLS, rows: HOLD_ROWS, blocked: HOLD_BLOCKED.slice(), items: [], cargo: [] };
    const acts = new Set([...(level.actions || DEFAULT_ACTIONS), ...((carryOver && carryOver.extraActions) || [])]);
    const loadoutId = (carryOver && carryOver.startingLoadout) || "standard";
    const loadout = STARTING_LOADOUTS[loadoutId] || STARTING_LOADOUTS.standard;
    const kit = loadout.kit.slice(); // drive first: it runs down the spine, keeping the midsection whole
    for (const key of WEAPON_SYSTEM_KEYS) if (acts.has(key)) kit.push(key);
    for (const id of kit) autoPlaceInHold(hold, id);
    return hold;
  }

  // Re-aims the flagship without moving or ending the turn — free to call as
  // many times as you like (no events, no enemy phase). This is what lets
  // you dial in a forward-only weapon's direction while Warpdrive is
  // offline: rotate to face where you want, then commit with FIRE.
  function setFacing(state, dir) {
    if (dir < 0 || dir > 5) throw new Error(`Invalid facing: ${dir}`);
    state.facing = dir;
  }

  function livingEnemies(state) {
    return state.enemies.filter((e) => e.alive);
  }

  function enemyAt(state, pos) {
    return state.enemies.find((e) => e.alive && posEq(e, pos)) || null;
  }

  function hazardAt(state, pos) {
    return state.hazards.find((h) => posEq(h, pos)) || null;
  }

  // Two flavors of hazard, deliberately different: an "asteroid" field is
  // genuinely impassable terrain — a wall, not a trap, excluded from legal
  // moves entirely — while a "blackhole" stays the original design doc's
  // instant-destruction trap: a legal (if suicidal) destination. Clubhouse
  // feedback: "places you can't hit... not every square is always the
  // same... asteroid fields" — real obstacles, not just more damage.
  function isBlockingHazard(hazard) {
    return Boolean(hazard) && hazard.type === "asteroid";
  }

  // Can a ship — ANY ship — end a burn on this hex? One rule, one place:
  // on the chart, nothing else parked there, and no rock in the way. It
  // was previously written out twice, and the enemy copy forgot about
  // rocks, so hostiles flew straight through asteroid fields the
  // flagship had to go around. Cover has to be cover for everyone.
  // `mover` (optional) is the ship doing the moving, so it doesn't count
  // itself as an obstacle.
  function canFlyInto(state, hex, mover) {
    if (!onBoard(state, hex)) return false;
    if (isBlockingHazard(hazardAt(state, hex))) return false;
    if (!(mover && mover === "player") && posEq(hex, state.playerPos)) return false;
    const blocker = enemyAt(state, hex);
    if (blocker && blocker !== mover) return false;
    return true;
  }

  // ---- coming back to a sector you left ---------------------------------
  //
  // A charted sector used to be restored exactly as you left it: every
  // contact frozen mid-step on the hex it occupied, forever. Fly out and
  // back and the board was a diorama.
  //
  // The fix is the rule the game already has. `hasDrive` is what makes a
  // Sentry an emplacement, and it is equally what decides who could have
  // gone anywhere while you were away:
  //
  //   emplacements — no engine, so they are EXACTLY where you left them.
  //                  That isn't laziness, it's the same rule, and it means
  //                  the static kill-zone geometry you scouted is still
  //                  true when you come back. Recon keeps its value.
  //   everything else — has been flying. It drifts.
  //
  // Damage persists on both sides (nobody is patching hull out here) while
  // reactors refill on both sides, which is not a favour to the enemy: the
  // flagship already arrives in every sector at full Energy however
  // drained it was when it left. Same rule, both directions. It also
  // closes the trick of fleeing a Railgun mid-charge to freeze it.
  // How far a contact can have wandered: 0 to 2 hexes, rolled per ship.
  // Deliberately small. Far enough that the board isn't the diorama it was,
  // near enough that what you scouted is still broadly true — a big drift
  // reads as a re-rolled sector and throws away everything you learned.
  // Some ships won't have moved at all, which is what a quiet patrol looks
  // like.
  const DRIFT_MAX = 2;

  // Wandering, not teleporting. A uniform re-roll reads as a different
  // sector and throws away everything you learned; a few legal steps reads
  // as "they moved". Steps scale with how long you were gone, capped.
  function driftEnemy(state, enemy, rng) {
    const steps = Math.floor(rng() * (DRIFT_MAX + 1)); // 0, 1 or 2, this ship's own roll
    for (let i = 0; i < steps; i++) {
      const options = neighbors(enemy).filter(
        (to) => canFlyInto(state, to, enemy) && !hazardAt(state, to)
      );
      if (!options.length) return;
      const pick = options[Math.floor(rng() * options.length)];
      enemy.q = pick.q;
      enemy.r = pick.r;
    }
  }

  // Nothing may be sitting on top of you the instant you materialise —
  // the same guarantee validateLevel makes about a fresh sector's spawn.
  // Anything that drifted too close is walked back out.
  function clearArrival(state, rng) {
    for (const enemy of livingEnemies(state)) {
      for (let tries = 0; tries < 8 && hexDistance(enemy, state.playerPos) < 2; tries++) {
        const away = neighbors(enemy).filter(
          (to) =>
            canFlyInto(state, to, enemy) &&
            !hazardAt(state, to) &&
            hexDistance(to, state.playerPos) > hexDistance(enemy, state.playerPos)
        );
        if (!away.length) break;
        const pick = away[Math.floor(rng() * away.length)];
        enemy.q = pick.q;
        enemy.r = pick.r;
      }
    }
  }

  // Who is close enough to come after you through a gate: something that
  // can fly (an emplacement bolted to a rock does not follow anyone) and
  // that actually had you in its sights, not merely something alive
  // somewhere on the board.
  function enemiesThatCanFollow(state) {
    return livingEnemies(state).filter((enemy) => {
      const ship = enemyShip(enemy);
      if (!ship || !ship.hasDrive) return false;
      if (isAdjacent(enemy, state.playerPos)) return true;
      return ship.weapons.some((weapon) =>
        weaponHexes(enemy, enemyFacing(state, enemy), weapon, state, HYPOTHETICAL).some((h) =>
          posEq(h, state.playerPos)
        )
      );
    });
  }

  // Drop a contact that followed you through onto the new board — never
  // closer than the no-adjacent-spawn rule allows, so you always get an
  // action before it is on you.
  function placeArrival(state, enemy, rng) {
    const spots = state.boardHexes.filter(
      (h) =>
        hexDistance(h, state.playerPos) >= 2 &&
        hexDistance(h, state.playerPos) <= 4 &&
        canFlyInto(state, h, null) &&
        !hazardAt(state, h) &&
        !(state.exits || []).some((ex) => posEq(ex, h)) &&
        !(state.outpostPos && posEq(state.outpostPos, h))
    );
    if (!spots.length) return false;
    const pick = spots[Math.floor(rng() * spots.length)];
    enemy.q = pick.q;
    enemy.r = pick.r;
    enemy.id = `f${state.enemies.length}`;
    state.enemies.push(enemy);
    pushLog(state, `${enemy.type.toUpperCase()} came through behind us.`);
    return true;
  }

  // Placement only, for a sector being generated fresh: a follower still
  // has to be put on the board, but nothing already there should drift and
  // no reactor should be topped up — a Railgun and the Bulwark spawn with
  // an EMPTY bus on purpose (the charge-up telegraph), and refilling them
  // on arrival would quietly delete it.
  function placeArrivals(state, arrivals, nonce) {
    if (!arrivals || !arrivals.length) return state;
    const rng = runSeeded(state.runSeed, state.levelId * 3313 + (nonce || 0) * 131);
    for (const arrival of arrivals) placeArrival(state, arrival, rng);
    return state;
  }

  // Called with a restored chart snapshot. opts.arrivals are contacts that
  // followed the flagship here (already removed from the sector they came
  // from). Drift is a flat 0-2 per ship rather than something scaled by
  // how long you were away: a patrol is a patrol, and tying it to the turn
  // counter only ever produced a frozen board on a quick out-and-back.
  function reenterSector(state, opts) {
    opts = opts || {};
    const rng = runSeeded(state.runSeed, state.levelId * 7717 + (opts.nonce || 0) * 131);
    for (const enemy of livingEnemies(state)) {
      enemy.energy = enemy.maxEnergy; // reactors run whether or not you are watching
      const ship = enemyShip(enemy);
      if (ship && ship.hasDrive) driftEnemy(state, enemy, rng);
    }
    clearArrival(state, rng);
    for (const arrival of opts.arrivals || []) placeArrival(state, arrival, rng);
    return state;
  }

  function livingEnemiesAdjacentTo(state, pos) {
    return livingEnemies(state).filter((e) => isAdjacent(e, pos));
  }

  // Shortest walkable path from `from` to `to` (inclusive), avoiding enemies
  // and hazards. BFS with the fixed direction order, so routes are
  // deterministic. Returns null when the target is blocked or unreachable.
  // Drives the tap-twice "fly there" route preview in the UI.
  // What a hex costs to fly through. A plain step is 1; a hex inside a
  // CHARGED emplacement's firing zone costs a great deal more.
  //
  // Only emplacements count, deliberately. A course is re-plotted every
  // step (enemies move between rounds), so weighting the search by things
  // that MOVE makes the ship dither: it steps aside to dodge a chaser, the
  // chaser follows, the new cheapest route runs back the way it came, and
  // the burn oscillates on the spot. Caught by the route test doing
  // exactly that — two rounds passed, two Hull lost, net displacement
  // zero. You cannot out-route something that follows you, and pretending
  // otherwise costs you the turns you needed to shoot it.
  //
  // An emplacement is the opposite: no drive, so its zone is a fixed
  // feature of the board, and going around one genuinely works. That is
  // also the thing a player means by "an area where you get shot".
  //
  // A cost, not a wall: if the only way through is hot, the route still
  // goes. A course that refuses to exist is worse than a dangerous one.
  const KILL_ZONE_STEP_COST = 60;

  // opts.avoidThreats — weight the search by danger instead of counting
  // hexes. Off by default: findPath's plain shortest-hop behaviour is what
  // the engine's own rules (and its tests) expect.
  function findPath(state, from, to, opts) {
    const blocked = (pos) => enemyAt(state, pos) || hazardAt(state, pos);
    if (!onBoard(state, to) || blocked(to)) return null;
    if (posEq(from, to)) return [{ q: from.q, r: from.r }];

    const avoid = Boolean(opts && opts.avoidThreats);
    const killZones = avoid ? staticKillZones(state) : null;
    const goalKey = hexKey(to);
    const stepCost = (key) => {
      if (!avoid || key === goalKey) return 1; // you tapped it; going there is the point
      return 1 + (killZones.has(key) ? KILL_ZONE_STEP_COST : 0);
    };

    // Uniform-cost search. With every step costing 1 this is exactly the
    // breadth-first walk it replaced, so the default path is unchanged.
    const startKey = hexKey(from);
    const prev = new Map([[startKey, null]]);
    const dist = new Map([[startKey, 0]]);
    const queue = [{ pos: from, key: startKey, cost: 0 }];
    while (queue.length) {
      let bestAt = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[bestAt].cost) bestAt = i;
      const cur = queue.splice(bestAt, 1)[0];
      if (cur.cost > (dist.get(cur.key) ?? Infinity)) continue;
      if (cur.key === goalKey) {
        const path = [];
        for (let k = cur.key, p = cur.pos; k !== null; ) {
          path.unshift({ q: p.q, r: p.r });
          const parent = prev.get(k);
          if (!parent) break;
          p = parent;
          k = hexKey(parent);
        }
        return path;
      }
      for (let i = 0; i < 6; i++) {
        const n = neighbor(cur.pos, i);
        const key = hexKey(n);
        if (!onBoard(state, n) || blocked(n)) continue;
        const next = cur.cost + stepCost(key);
        if (next >= (dist.get(key) ?? Infinity)) continue;
        dist.set(key, next);
        prev.set(key, { q: cur.pos.q, r: cur.pos.r });
        queue.push({ pos: { q: n.q, r: n.r }, key, cost: next });
      }
    }
    return null;
  }

  function pushLog(state, message) {
    state.log.push(message);
    if (state.log.length > 20) state.log.shift();
  }

  // Every kill drops scrap, no matter which action lands it — see
  // ENEMY_TYPES[type].salvage.
  //
  // ---- income does not climb with depth ---------------------------------
  //
  // MEASURED, 150 careful runs, with the ECON=1 ledger in playtest.js. B is
  // the bank at a dock, D the dearest thing on that shelf:
  //
  //   sector    2     3     4     5     6     7     8     9    10    12
  //   B       4.4  22.4  25.0  15.7  22.8  40.4  57.3  61.5  67.5  82.3
  //   D      13.5  13.4  13.4  12.9  12.9  13.1  14.4  14.4  14.2  20.0
  //
  // The dearest item on offer was affordable on 92-100% of visits from
  // Sector 3 on — the complaint verbatim, "by level three you can buy
  // anything you want". A run earned 217 salvage and spent about 80,
  // against a complete fit-out (three guns, a screen, two upgrades, six
  // patches) costing about 109. Income was twice what a ship can absorb.
  //
  // A wreck used to pay `base + floor(depth/2)`, and BOTH halves climbed:
  //
  //   depth      1     3     5     6     8    10    12
  //   base     1.0   4.2   2.0   8.6   5.3   5.3   6.8
  //   bounty     0     1     2     3     4     5     6
  //
  // Base value already rises on its own, because the classes that arrive
  // deeper are worth more (a Salvager is 8, the Bulwark 16). The depth
  // bounty was doubling a scaling that already existed, and doubling the
  // clean-run bonus on top of it.
  //
  // So there is no depth term at all any more: A WRECK IS WORTH WHAT IT IS
  // WORTH. That is Slay the Spire's shape — an Act 3 fight pays about what
  // an Act 1 fight pays, so a fixed price list stays a real decision for
  // the whole run — and it was chosen over the alternative, marking the
  // shelf up with depth (Risk of Rain 2's answer, and the same shape as
  // FTL's escalating reactor bars), because charging more for the same
  // gun deeper in is a worse lie than paying less for the same wreck.
  //
  // What survives is a level's own salvageBonus — a rich locale, see
  // levels.js. That one is about WHERE you are, not how far in you are,
  // so it applies at every depth.
  function localeBonus(state) {
    return state.salvageBonus || 0;
  }

  // ---- flying it clean ----------------------------------------------------
  //
  // Every point of income in this game came from KILLING something, which
  // meant good positioning paid nothing at all: a pilot that read the board
  // and walked out untouched arrived at the next dock as poor as one that
  // had been shot the whole way, and poorer than one that had stood and
  // traded. Caution was economically punished, so the only route to a
  // stronger ship was more fighting — which is the opposite of what this
  // game says it is about, given the gate is always open.
  //
  // So leaving a sector without taking a single point of hull pays, on the
  // same depth curve a wreck does. It is the one reward in the game for
  // where you STOOD rather than what you shot, and it cannot be farmed:
  // there is exactly one per sector and taking one hit anywhere in it is
  // enough to lose it.
  const CLEAN_RUN_BONUS = 2;
  function awardCleanRun(state) {
    if (state.hull < (state.hullAtSectorStart != null ? state.hullAtSectorStart : state.hull)) return;
    // Sized against the thing it competes with. A four-strong board pays
    // roughly twenty salvage to clear, so a bonus of five was a
    // consolation prize: the arithmetic still said "kill everything",
    // which is what it was supposed to stop saying.
    //
    // It used to be 4 + 2x the depth bounty, which made it 16 at the
    // deepest sector — the single largest piece of RISK-FREE income in a
    // game whose problem was a bank nobody could spend. Flat now, on the
    // same principle as the wrecks: this is a reward for where you STOOD,
    // and where you stood is no more impressive at Sector 12 than at
    // Sector 3.
    //
    // Two is a third of a patch. It sounds small and it is not what makes
    // caution pay — preserving HULL is. Measured over 150 runs a side with
    // the whole system in place, the careful pilot wins 62 and the greedy
    // one 48, the same gap flying clean was built to create; the whole
    // arsenal at once (a flat 4) put careful at 96/150, which is not a
    // game with a shop in it.
    const amount = CLEAN_RUN_BONUS + 2 * localeBonus(state);
    state.salvage += amount;
    state.events.push({ type: "salvage", amount, clean: true });
    pushLog(state, `Not a scratch on her — ${amount} salvage bonus.`);
  }

  // Wreck values came down about a fifth across the board when the shelf
  // learned to spend properly: more docks (see levels.js) and a range with
  // a real top and bottom meant the careful pilot was converting salvage
  // into ship far more efficiently, and its win rate went to 75/150 — well
  // over the 35-45% band this difficulty is tuned to (FTL on Hard is around
  // 60% for a skilled human; these pilots are heuristics and should land
  // under that). Measured at the new values: careful 65/150, greedy 43/150.
  // The cut went on the WRECKS rather than the clean-run bonus, which is
  // already down to 2, and rather than on prices, because charging more for
  // the same gun is the thing this economy has twice decided not to do.
  function awardSalvage(state, enemyType) {
    const base = (ENEMY_TYPES[enemyType] || {}).salvage || 0;
    const amount = base > 0 ? base + localeBonus(state) : 0;
    if (amount <= 0) return;
    state.salvage += amount;
    state.events.push({ type: "salvage", amount });
    pushLog(state, `Salvage recovered — +${amount}.`);
  }

  // A Discovery is found ONCE, on arrival, and always pays out something —
  // never a downside, never a menu. Rolled at resolution time (not when
  // the hex was placed), off the same run seed, so it's still a genuine
  // roll even though a save/reload wouldn't be able to change it.
  //
  // ~65% a salvage windfall — bigger than one kill's worth, a real "found
  // something" moment, via the same amount the shop is priced against
  // (localeBonus). ~35% a free item, but capped at common/uncommon — a
  // free Railgun for zero salvage would gut the "weapons should be way
  // more expensive, you have to save up" curve the shop was tuned around,
  // and would bypass the shop's own rare-item scarcity accounting
  // (raresSkipped) entirely. Drawn from exactly the same eligible pool
  // eligibleOfferStock already computes for the shop, so a Discovery only
  // ever hands you something this ship could plausibly have found here.
  const DISCOVERY_SALVAGE_CHANCE = 0.65;
  function resolveDiscoveryReward(state) {
    const aboard = [...state.hold.items.map((it) => it.id), ...state.hold.cargo];
    const rng = runSeeded(state.runSeed, state.levelId * 200003 + 137);
    const commonOrUncommon = eligibleOfferStock(state.levelId, aboard).filter(
      (o) => o.rarity === "common" || o.rarity === "uncommon"
    );
    if (rng() < DISCOVERY_SALVAGE_CHANCE || !commonOrUncommon.length) {
      const amount = localeBonus(state) * 2 + 6;
      state.salvage += amount;
      state.events.push({ type: "discovery", kind: "salvage", amount });
      return `+${amount} salvage`;
    }
    const [won] = weightedPickWithoutReplacement(commonOrUncommon, (o) => RARITY_WEIGHT[o.rarity] || 1, 1, rng);
    const itemId = OFFER_ITEM[won.id] || won.id;
    noteStowed(state, itemId, won.label);
    autoPlaceInHold(state.hold, itemId);
    syncHoldDerived(state);
    state.events.push({ type: "discovery", kind: "item", itemId, label: won.label });
    return won.label;
  }

  // Called from applySublight right alongside checkPlayerHazard — the
  // flagship just moved, so this is where "did it land on something"
  // belongs. Consumed on the spot: discoveryPos clears, so flying back
  // over the same hex later in this sector does nothing (it's already
  // been picked clean).
  function checkDiscovery(state) {
    if (!state.discoveryPos || !posEq(state.playerPos, state.discoveryPos)) return;
    const label = state.discoveryLabel || "Wreckage";
    const won = resolveDiscoveryReward(state);
    pushLog(state, `${label} — salvaged ${won}.`);
    state.discoveryPos = null;
    state.discoveryFlavor = null;
    state.discoveryLabel = null;
  }

  // ---- threat overlay: pillar #3, "the board is the UI" -------------------
  //
  // An enemy attacks instead of moving iff the player is standing somewhere
  // its weapon's pattern actually reaches when the enemy phase begins. So
  // any such hex is one that will take damage if the player ends their turn
  // there — generic over any weapon range/pattern, not just the
  // range-1-omnidirectional case a plain neighbors() list would cover. The
  // facing passed in doesn't matter for today's only enemy weapon (it's
  // omnidirectional), but keeps this correct once a directional enemy
  // weapon needs a real tracked facing too.
  function computeThreatHexes(state) {
    const threats = new Map(); // hexKey -> damage count
    for (const enemy of livingEnemies(state)) {
      const ship = enemyShip(enemy);
      if (!ship) continue;
      // A weapon its reactor can't afford this coming enemy phase is no
      // threat yet — a charging Railgun's board-spanning line only lights
      // up on the turn it can actually fire. (Regen happens AFTER the
      // enemy phase, so "can it fire next phase" is just current energy.)
      // Same two gates the enemy itself applies when it decides to shoot:
      // it must be able to afford the shot, and it must not catch its own
      // side with it. A danger overlay that ignored the second would mark
      // hexes as lethal that the hostile will visibly decline to fire on.
      const facing = enemyFacing(state, enemy);
      const live = ship.weapons.filter(
        (w) =>
          enemy.energy >= w.energyCost &&
          !wouldCatchAlly(state, enemy, w, facing) &&
          // A gun its CLASS refuses to use is not a danger zone either —
          // a Railgun with a friend beside it isn't going to shoot, and
          // painting its lanes red would be a lie the player then plays
          // around for nothing. Same reasoning as wouldCatchAlly.
          !inhibited(state, enemy, w) &&
          // A charge does no damage the round it's thrown; where it LANDS
          // isn't dangerous, what it becomes is. Live charges are added
          // below, off the board rather than off the thrower.
          !w.places
      );
      if (!live.length) continue;
      const covered = new Set();
      for (const weapon of live) {
        for (const hex of weaponHexes(enemy, enemyFacing(state, enemy), weapon, state, HYPOTHETICAL)) {
          if (!onBoard(state, hex)) continue;
          covered.add(hexKey(hex));
        }
      }
      for (const k of covered) threats.set(k, (threats.get(k) || 0) + 1);
      // A chaser with 2+ AP can close one hex AND fire in the same enemy
      // phase — its true danger zone this round is one ring wider than
      // where it stands. Every current chaser carries an omnidirectional
      // weapon, so "one ring wider" is exactly distance <= range + 1.
      // (Moot at ENEMY_AP 1 — a 1-AP chaser moves OR fires, never both.)
      if (ENEMY_AP > 1 && ship.hasDrive) {
        const reach = Math.max(...live.map((w) => w.range));
        for (const hex of state.boardHexes) {
          const d = hexDistance(enemy, hex);
          if (d <= reach || d > reach + 1) continue;
          threats.set(hexKey(hex), (threats.get(hexKey(hex)) || 0) + 1);
        }
      }
    }
    // Ordnance already on the board. A burning charge is the most literal
    // danger zone in the game — seven hexes with a number on them — and it
    // has to be in here or nothing that reads this map (the overlay, the
    // auto-router, the pilots in playtest.js) can see a bomb at all.
    for (const charge of liveCharges(state)) {
      if (charge.spent) continue;
      for (const hex of chargeBlastHexes(state, charge)) {
        threats.set(hexKey(hex), (threats.get(hexKey(hex)) || 0) + 1);
      }
    }
    return threats;
  }

  // ---- enemy AI -------------------------------------------------------------

  // ---- missiles ----------------------------------------------------------
  // Ordnance in flight: a real thing standing on a real hex, not a delayed
  // number. It moves one hex a round toward whatever it was launched at,
  // and detonates on the first ship it reaches — including the side that
  // fired it, which is the whole reason it is interesting. Between the
  // launch and the hit there is a round in which the board is a different
  // puzzle: run, break line behind a rock, or steer it into a wingman.
  // Long enough to cross the launcher's own reach, short enough that it
  // eventually gives up rather than herding you for the rest of the
  // sector. A missile flies at exactly your speed, so it can never run you
  // down while you keep moving — what it actually costs you is the round
  // you wanted to spend SHOOTING. That is the whole tension: outrun it and
  // do nothing, or stand, fight, and wear it.
  const MISSILE_FUSE = 7;

  // How many rounds a hostile will manoeuvre for a better angle before it
  // gives up and simply closes.
  const PATIENCE = 2;

  function liveMissiles(state) {
    return state.missiles || (state.missiles = []);
  }

  function launchMissile(state, from, weapon, ownerId) {
    const list = liveMissiles(state);
    const missile = {
      id: `m${state.missileSeq = (state.missileSeq || 0) + 1}`,
      q: from.q,
      r: from.r,
      damage: weapon.damage,
      fuse: MISSILE_FUSE,
      ownerId: ownerId || null,
    };
    list.push(missile);
    state.events.push({ type: "missileLaunch", q: missile.q, r: missile.r, id: missile.id });
    return missile;
  }

  // ---- demolition charges ------------------------------------------------
  //
  // The other kind of ordnance, and the opposite question. A missile is a
  // thing that comes to FIND you, so the answer is to keep moving. A
  // charge is a thing that lands on GROUND, so the answer is to not be on
  // it — and since its blast covers the hex it landed on and all six
  // around it, "not on it" can mean crossing half the board you were
  // planning to fight from.
  //
  // Two rounds of fuse: it lands, one round ticks with it visible and
  // counting, and it goes off at the end of the next. That's enough time
  // to walk out of a seven-hex blast from anywhere inside it, so being
  // caught is a decision you made, never something that happened to you.
  const CHARGE_FUSE = 2;

  function liveCharges(state) {
    return state.charges || (state.charges = []);
  }

  // Every hex a charge takes with it when it goes: its own, plus a ring
  // out to `blast`. Rocks don't shield you — the whole point of the thing
  // is that it removes the ground rather than shooting across it.
  function chargeBlastHexes(state, charge) {
    const hexes = [{ q: charge.q, r: charge.r }];
    let frontier = [{ q: charge.q, r: charge.r }];
    for (let ring = 0; ring < (charge.blast || 1); ring++) {
      const next = [];
      for (const hex of frontier) {
        for (let d = 0; d < 6; d++) {
          const to = neighbor(hex, d);
          if (!onBoard(state, to)) continue;
          if (hexes.some((h) => posEq(h, to))) continue;
          hexes.push(to);
          next.push(to);
        }
      }
      frontier = next;
    }
    return hexes;
  }

  function placeCharge(state, hex, weapon, ownerId) {
    const charge = {
      id: `c${(state.chargeSeq = (state.chargeSeq || 0) + 1)}`,
      q: hex.q,
      r: hex.r,
      damage: weapon.damage,
      blast: weapon.blast || 1,
      // CHARGE_FUSE + 1, because the round it lands in is a round the
      // player never gets: a charge is thrown during the enemy phase and
      // the fuse ticks at the end of that same phase. Set to the flat 2
      // it left you exactly ONE move to clear a blast that reaches one hex
      // in every direction — which is impossible, since one step from the
      // centre is still inside it. Being caught has to be a decision, and
      // that means the number of moves has to exceed the radius.
      fuse: CHARGE_FUSE + 1,
      ownerId: ownerId || null,
    };
    liveCharges(state).push(charge);
    state.events.push({ type: "chargePlaced", q: charge.q, r: charge.r, id: charge.id });
    return charge;
  }

  // It goes off on everything standing in it, both sides, no exceptions —
  // the hostile that threw it included, if it hasn't cleared the area.
  function detonateCharge(state, charge, onPlayerDamage) {
    const hexes = chargeBlastHexes(state, charge);
    state.events.push({ type: "chargeBlast", q: charge.q, r: charge.r, id: charge.id, hexes });
    pushLog(state, "Charge detonates.");
    for (const hex of hexes) {
      const hit = shipAt(state, hex);
      if (!hit) continue;
      if (hit.kind === "player") {
        if (onPlayerDamage) onPlayerDamage(charge.damage);
        continue;
      }
      const victim = hit.enemy;
      if (victim.shieldCharges > 0) {
        victim.shieldCharges -= 1;
        state.events.push({ type: "enemyShieldAbsorb", q: victim.q, r: victim.r, enemyId: victim.id });
        pushLog(state, `${victim.type.toUpperCase()} rode the blast out on its screen.`);
        continue;
      }
      victim.hp -= charge.damage;
      if (victim.hp <= 0) {
        victim.alive = false;
        state.events.push({ type: "kill", q: victim.q, r: victim.r, victim: victim.type, source: "charge" });
        pushLog(state, `${victim.type.toUpperCase()} caught in the blast.`);
        awardSalvage(state, victim.type);
      } else {
        state.events.push({ type: "hit", q: victim.q, r: victim.r, source: "charge" });
      }
    }
    charge.spent = true;
  }

  // Ticked once a round alongside the missiles, and for the same reason:
  // after everybody has moved, so the hex you stepped to is the hex being
  // judged and walking clear genuinely works.
  function advanceCharges(state, onPlayerDamage) {
    const list = liveCharges(state);
    if (!list.length) return;
    for (const charge of list) {
      if (charge.spent) continue;
      charge.fuse -= 1;
      state.events.push({ type: "chargeTick", q: charge.q, r: charge.r, id: charge.id, fuse: charge.fuse });
      if (charge.fuse <= 0) detonateCharge(state, charge, onPlayerDamage);
    }
    state.charges = list.filter((c) => !c.spent);
  }

  // Every hex currently under a live charge — the renderer paints these and
  // the threat overlay counts them, because a fuse you can't see is just an
  // ambush.
  function chargedHexes(state) {
    const keys = new Set();
    for (const charge of liveCharges(state)) {
      if (charge.spent) continue;
      for (const hex of chargeBlastHexes(state, charge)) keys.add(hexKey(hex));
    }
    return keys;
  }

  // What a missile is standing on, if anything. Hostiles and the flagship
  // are both fair game — a missile has no idea who launched it.
  function shipAt(state, hex) {
    const foe = enemyAt(state, hex);
    if (foe) return { kind: "enemy", enemy: foe };
    if (posEq(state.playerPos, hex)) return { kind: "player" };
    return null;
  }

  function detonateMissile(state, missile, onPlayerDamage) {
    state.events.push({ type: "missileHit", q: missile.q, r: missile.r, id: missile.id });
    const hit = shipAt(state, missile);
    if (hit && hit.kind === "player") {
      if (onPlayerDamage) onPlayerDamage(missile.damage);
    } else if (hit && hit.kind === "enemy") {
      const victim = hit.enemy;
      if (victim.shieldCharges > 0) {
        victim.shieldCharges -= 1;
        state.events.push({ type: "enemyShieldAbsorb", q: victim.q, r: victim.r, enemyId: victim.id });
        pushLog(state, `${victim.type.toUpperCase()} took a missile on its screen.`);
      } else {
        victim.hp -= missile.damage;
        if (victim.hp <= 0) {
          victim.alive = false;
          state.events.push({ type: "kill", q: victim.q, r: victim.r, victim: victim.type, source: "missile" });
          pushLog(state, `${victim.type.toUpperCase()} took its own side's missile.`);
          awardSalvage(state, victim.type);
        } else {
          state.events.push({ type: "hit", q: victim.q, r: victim.r, source: "missile" });
        }
      }
    }
    missile.spent = true;
  }

  // Called once per round, after everyone has acted. Each missile steps a
  // hex toward the flagship and detonates the moment it is standing on a
  // ship — so stepping AWAY buys you exactly one more round, and stepping
  // so that a hostile is between you and it buys you the whole missile.
  function advanceMissiles(state, onPlayerDamage) {
    const list = liveMissiles(state);
    if (!list.length) return;
    for (const missile of list) {
      if (missile.spent) continue;
      missile.fuse -= 1;
      if (missile.fuse <= 0) {
        state.events.push({ type: "missileFizzle", q: missile.q, r: missile.r, id: missile.id });
        missile.spent = true;
        continue;
      }
      // A missile chases whoever it was launched AT: a hostile's chases
      // the flagship, yours chases the nearest hostile. Either way it
      // detonates on the first ship it happens to reach, which is how one
      // ends up killing the side that fired it.
      const chasing = missile.ownerId
        ? state.playerPos
        : livingEnemies(state).reduce(
            (best, e) => (!best || hexDistance(missile, e) < hexDistance(missile, best) ? e : best),
            null
          );
      if (!chasing) {
        state.events.push({ type: "missileFizzle", q: missile.q, r: missile.r, id: missile.id });
        missile.spent = true;
        continue;
      }
      let best = null;
      for (let d = 0; d < 6; d++) {
        const to = neighbor(missile, d);
        if (!onBoard(state, to)) continue;
        if (isBlockingHazard(hazardAt(state, to))) continue; // rock stops it dead
        const dist = hexDistance(to, chasing);
        if (!best || dist < best.dist) best = { to, dist };
      }
      if (!best) {
        state.events.push({ type: "missileFizzle", q: missile.q, r: missile.r, id: missile.id });
        missile.spent = true;
        continue;
      }
      missile.q = best.to.q;
      missile.r = best.to.r;
      state.events.push({ type: "missileMove", q: missile.q, r: missile.r, id: missile.id });
      if (shipAt(state, missile)) detonateMissile(state, missile, onPlayerDamage);
    }
    state.missiles = list.filter((m) => !m.spent);
  }

  function decideIntent(state, enemy) {
    const ship = enemyShip(enemy);
    if (!ship) return { enemyId: enemy.id, type: "wait" };
    // Any contact fires the instant the flagship is standing somewhere one
    // of ITS FITTED GUNS reaches and its reactor can pay for the shot —
    // the same two questions the flagship's own fire controls ask. A
    // charging Railgun holds fire; a cost-1 chaser always affords it.
    // With several guns aboard it takes the cheapest that bears, which is
    // exactly what applyFire does for you when you don't name one.
    const bearing = enemyWeaponsBearing(state, enemy).filter((w) => !inhibited(state, enemy, w));
    const affordable = bearing.filter((w) => enemy.energy >= w.energyCost);
    if (affordable.length) {
      const pick = affordable.slice().sort((a, b) => a.energyCost - b.energyCost || b.damage - a.damage)[0];
      return { enemyId: enemy.id, type: "attack", weaponKey: pick.id };
    }
    // In reach, but the reactor can't pay for the shot yet — hold and let
    // the bus climb, drive or no drive. This USED to be drive-gated only
    // (an emplacement has no other option; anything that could fly always
    // chased instead, because the old Scout stood motionless 39% of its
    // turns and the Carrier 54%, reading as a broken gun rather than a
    // reloading one). That fix cost nothing back then: reactors ticked for
    // free every round regardless of what an enemy did with its action, so
    // making a driven hostile shuffle toward a better angle instead of
    // sitting still was a pure readability win — it recharged at the same
    // rate either way. It is not free anymore (see waitedThisPhase in
    // enemyPhase — "1 to 1, nothing for free," same rule the flagship's
    // own Reactor Core plays by), so a driven hostile that keeps moving
    // instead of holding a shot it ALREADY has never recharges at all: its
    // one gun goes permanently quiet after its first shell, which is worse
    // than the old motionless-look bug ever was. Holding here only fires
    // when the gun already bears from right where it's standing — moving
    // could only trade a solved shot for an unsolved one — so this is not
    // the general "no shot yet, stand around" case that caused the
    // measured stalling; a hostile still without a solution at all falls
    // straight through to the chase below exactly as before.
    if (bearing.length) return { enemyId: enemy.id, type: "wait" };
    // No drive fitted, no flying — the same rule that grounds the
    // flagship with its engines pulled (see applySublight). That, and
    // nothing else, is what makes a Sentry an emplacement.
    if (ship.hasDrive) {
      const candidates = [];
      for (let i = 0; i < 6; i++) {
        const to = neighbor(enemy, i);
        if (!canFlyInto(state, to, enemy)) continue;
        // Legal, but nobody flies into a black hole on purpose — the
        // flagship may (it's your funeral); an AI throwing itself down
        // one would be a free kill, not terrain.
        if (hazardAt(state, to)) continue;
        candidates.push({ to, dist: hexDistance(to, state.playerPos), dir: i });
      }
      if (candidates.length === 0) return { enemyId: enemy.id, type: "wait" };
      // Head for somewhere its gun actually bears. A hostile that only
      // ever minimised distance walked past its own firing solution — and
      // for anything that shoots at range, straight through it — which is
      // why every chaser played identically no matter what it carried.
      //
      // Falling back to closing the gap matters: with no reachable firing
      // position (a Flak Burst jammed by its own wingman, a lane blocked
      // by a rock) an AI that only knew how to seek a solution would just
      // stand still, which reads as broken rather than as tactical.
      // Patience runs out. A class that only ever moved toward its ideal
      // firing angle can be un-catchable: ordnance and a kiter both travel
      // at exactly the flagship's speed, so a hostile that always backs
      // off to keep its range is never caught and the sector never ends.
      // Measured: 12 of 40 runs stalled outright. After a few fruitless
      // rounds it stops holding out for the good shot and just closes,
      // which ends the standoff and reads as a hostile losing its nerve.
      // A hostile may slide sideways to find its angle, but it may never
      // back AWAY from the flagship. Letting it retreat produced a gun
      // that fired and gave ground in alternation — and since it moves at
      // exactly your speed, you close a net hex every two rounds while
      // being shot the whole way, which is not a fight you can win by
      // playing well. Hoplite's archer has the same range problem and
      // solves it the same way: its demons only ever move to REDUCE the
      // distance to the player. Closing on a long gun is the counter, so
      // closing has to be possible.
      const standoff = hexDistance(enemy, state.playerPos);
      // Where it can put its gun on you, and how far it's allowed to go to
      // get there. Two cases, and the difference between them is the whole
      // anti-kiting rule:
      //
      //   JAMMED (no shot from here at all — you're inside its minimum
      //   range, or off its axis). It may go ANYWHERE that bears,
      //   backwards included. Without that a minimum-range gun walks into
      //   its own dead zone and can never get out, because leaving is
      //   retreating: measured, the Scout fired on 8% of its turns and
      //   spent the rest orbiting you harmlessly.
      //
      //   BEARING BUT BROKE (its gun covers you, the reactor is short).
      //   It may only CLOSE, and among the ways to close it prefers one
      //   that keeps you covered. Letting this case drift backwards would
      //   be fire, give ground, fire, give ground — the pattern that made
      //   sectors unwinnable before — and any gun costing more than its
      //   reactor makes in a round would do it two turns in three.
      const solutionKeys = new Set(firingPositions(state, enemy).map(hexKey));
      const closers = candidates.filter((c) => c.dist <= standoff);
      const bearsFrom = (list) => list.filter((c) => solutionKeys.has(hexKey(c.to)));
      const allowed = bearing.length ? closers : candidates;
      // NEVER STEP INSIDE YOUR OWN DEAD ZONE. A hex closer than the gun's
      // minimum range is one it definitionally cannot fire from, so it is
      // never a better destination than one it can — and yet the Picket
      // moved into a Beam Lance's hole on 236 of its 1368 moves, with a
      // hex outside it available on 233 of them. That is the "just moving
      // as close as possible" you can see from the board: not a long gun
      // choosing to brawl, a long gun walking somewhere it does nothing.
      //
      // Deliberately narrow. It does NOT let anything hold its range —
      // preferring the far edge of the band, or even the middle, was tried
      // and both are catastrophic (greedy 23 wins in 60 -> 1 and -> 0),
      // because reach that keeps its distance cannot be answered by a ship
      // that walks one hex a round. Long guns still close. They just stop
      // closing past the point where they work.
      // Which is the no-retreat rule colliding with must-move: standing at
      // two with both lateral hexes blocked, the only step that isn't a
      // retreat IS the step into the hole, so it took it. 129 times in a
      // 25-seed sample.
      const deadZone = Math.min(...ship.weapons.map((w) => w.minRange || 1));
      const outside = (list) => list.filter((c) => c.dist >= deadZone);
      // In order: close, but not into the hole; then anywhere that isn't
      // the hole even if it isn't closer — that is not kiting, it is
      // refusing to walk somewhere the gun cannot work; then, only if the
      // hole is genuinely all there is, take it.
      const pool = bearsFrom(allowed).length
        ? bearsFrom(allowed)
        : outside(closers).length
          ? outside(closers)
          : outside(candidates).length
            ? outside(candidates)
            : closers.length
              ? closers
              : candidates;
      const solutions = firingPositions(state, enemy);
      if (solutions.length) {
        const nearestSolution = (h) =>
          solutions.reduce((best, s) => Math.min(best, hexDistance(h, s)), Infinity);
        pool.sort((a, b) => nearestSolution(a.to) - nearestSolution(b.to) || a.dist - b.dist || a.dir - b.dir);
        // There used to be a hold here: if no step got it any closer to a
        // shooting spot than it already was, it stayed put rather than
        // shuffling sideways. That is the same "do nothing" turn as the
        // recharge hold above, and it reads the same way. It moves.
      } else {
        pool.sort((a, b) => a.dist - b.dist || a.dir - b.dir);
      }
      return { enemyId: enemy.id, type: "move", to: pool[0].to };
    }
    return { enemyId: enemy.id, type: "wait" };
  }

  // The Warp Gate is always online — clearing enemies is never required to
  // leave a sector. Combat is opportunistic now: fight for salvage (see
  // ENEMY_TYPES[type].salvage) or route around a threat and fly straight to
  // the gate, entirely the player's call. (`exitRule` is kept on LevelDef
  // for now in case a future level wants a different unlock condition, but
  // nothing currently reads it to gate anything.)
  function checkExitUnlock(state) {
    if (!state.exitUnlocked) {
      state.exitUnlocked = true;
      pushLog(state, "Gate reads online.");
    }
  }

  function checkPlayerHazard(state) {
    if (hazardAt(state, state.playerPos)) {
      state.hull = 0;
      state.status = "lost";
      pushLog(state, "Hull breached. All hands.");
    }
  }

  // Fires one player weapon at whatever it can reach RIGHT NOW — called in
  // speed order inside applyFire's volley, so targets are computed at
  // fire time (a faster weapon's kill or push in this same volley genuinely
  // removes them from a slower weapon's list).
  function firePlayerWeapon(state, weapon, onHit, preferredTargetId) {
    const hexKeys = new Set(weaponHexes(state.playerPos, state.facing, weapon, state).map(hexKey));
    let targets = livingEnemies(state).filter((e) => hexKeys.has(hexKey(e)));
    if (targets.length === 0) return; // nothing in range — no shot, no energy spent
    // A single-target weapon (targets: "one") puts its whole shot into ONE
    // contact: the target-locked one if it's in this weapon's reach,
    // otherwise the first thing it can hit. Multi-hit weapons strike
    // everything in reach, as ever.
    if (weapon.targets === "one") {
      const preferred = preferredTargetId ? targets.find((t) => t.id === preferredTargetId) : null;
      targets = [preferred || targets[0]];
    }
    // Every shot is paid for. A weapon that would have fired but can't
    // afford its cost holds fire — logged so the silence is explained.
    if (state.energy < weapon.energyCost) {
      pushLog(state, `${weapon.label} holding — charge at ${state.energy} of ${weapon.energyCost}.`);
      return;
    }
    state.energy -= weapon.energyCost;
    state.events.push({ type: "energySpend", amount: weapon.energyCost, weapon: weapon.label });
    // Same crate, same behaviour, both directions: your missile is an
    // object on the board too, and it will happily detonate on the first
    // thing it reaches.
    if (weapon.launches) {
      launchMissile(state, state.playerPos, weapon, null);
      pushLog(state, `${weapon.label} away — it flies itself from here.`);
      return;
    }
    // A charge lands ON the target's hex, not on the target: it does no
    // damage now, and in two rounds it takes that hex and the six around
    // it. Whatever has walked into those by then is what it kills, which
    // may very well include you.
    if (weapon.places) {
      placeCharge(state, targets[0], weapon, null);
      pushLog(state, `${weapon.label} set — two rounds on the fuse. Clear the area.`);
      return;
    }
    // Every weapon announces its own shot — the renderer gives each a
    // signature effect (ring/beam/bolt) so WHAT fired is readable at a
    // glance, not just that something did.
    state.events.push({
      type: "playerFire",
      weapon: weapon.id,
      from: { q: state.playerPos.q, r: state.playerPos.r },
      targets: targets.map((v) => ({ q: v.q, r: v.r })),
    });
    for (const victim of targets) {
      if (!victim.alive) continue; // an earlier target's push/collision in this same volley already took it out
      // A raised hostile screen eats the whole shot, exactly as yours eats
      // a whole enemy phase — one charge, one hit, however big the hit.
      if (victim.shieldCharges > 0) {
        victim.shieldCharges -= 1;
        state.events.push({ type: "enemyShieldAbsorb", q: victim.q, r: victim.r, enemyId: victim.id });
        pushLog(state, `${weapon.label}: ${victim.type.toUpperCase()} screen holds — shield down.`);
        continue;
      }
      victim.hp -= weapon.damage;
      if (victim.hp <= 0) {
        victim.alive = false;
        state.events.push({ type: "kill", q: victim.q, r: victim.r, victim: victim.type, source: "weapon" });
        pushLog(state, `${weapon.label}: ${victim.type.toUpperCase()} destroyed.`);
        awardSalvage(state, victim.type);
      } else {
        state.events.push({ type: "hit", q: victim.q, r: victim.r, source: "weapon" });
        pushLog(state, `${weapon.label}: ${victim.type.toUpperCase()} hit — hull ${victim.hp} of ${victim.maxHp}.`);
        if (onHit) onHit(state, victim);
      }
    }
  }

  // The ENEMY PHASE: every living enemy spends ENEMY_AP action points,
  // symmetric with the flagship's own budget. Each AP step re-reads intent
  // (so a chaser that closed on its first point fires with its second),
  // attackers shoot in weapon-speed order (the `speed` stat orders the
  // barrage), movers step after the shooting. Damage accumulates across
  // the WHOLE phase and one shield charge absorbs all of it — a raised
  // shield eats the round's entire barrage before the hull is touched.
  function enemyPhase(state) {
    let totalDamage = 0;
    const firedThisPhase = new Set();
    // Who actually landed a hit this round, and what their bus read right
    // after paying for the shot — surfaced in the hit-report log below.
    // Energy IS spent and regenerated on the same rule the flagship's own
    // is (line below), but the single-line log never said so, and a fast
    // reactor (an Interceptor's is back at max before the player's next
    // turn even starts) meant a scanned contact's gauge never visibly
    // showed the dip either — reads as "enemies don't actually use energy"
    // even though they do. Reported live: "I'm not seeing their energy
    // deplete."
    const hitters = [];
    // Who spent their one action THIS ROUND holding fire with nothing
    // better to do — the only ones who recharge (see below). Same rule as
    // the flagship, which only gets its bus back by spending its own
    // single action on Reactor Core instead of moving or firing — reactors
    // used to tick for free on every living enemy regardless of what it
    // did that round, which was the one place the two sides didn't
    // actually share a rule. Reported live: "it needs to be 1 to 1.
    // nothing for free." decideIntent's "wait" branch now covers both an
    // emplacement with no other option AND a driven hostile that already
    // has a solved shot it can't yet afford (see the comment there) —
    // without that second case a driven gun would never recharge at all
    // once broke, since it always prefers moving over idling. May still
    // need a bigger battery here and there to stay a threat with this rule
    // in place; that's a follow-up tuning pass, not a blocker to shipping
    // the rule itself.
    const waitedThisPhase = new Set();
    for (let apStep = 0; apStep < ENEMY_AP; apStep++) {
      const intents = livingEnemies(state).map((enemy) => ({ enemy, intent: decideIntent(state, enemy) }));
      for (const { enemy, intent } of intents) {
        if (intent.type === "wait") waitedThisPhase.add(enemy.id);
      }
      const attackers = intents
        .filter(({ intent }) => intent.type === "attack")
        .sort((a, b) => (WEAPONS[b.intent.weaponKey].speed || 0) - (WEAPONS[a.intent.weaponKey].speed || 0));
      for (const { enemy, intent } of attackers) {
        if (!enemy.alive) continue;
        const weapon = WEAPONS[intent.weaponKey];
        if (!weapon) continue;
        if (!weaponHexes(enemy, enemyFacing(state, enemy), weapon, state).some((h) => posEq(h, state.playerPos))) continue;
        if (enemy.energy < weapon.energyCost) continue;
        enemy.energy -= weapon.energyCost; // same rule as the flagship: every shot is paid for
        // A launcher doesn't hurt anyone this round — it puts something on
        // the board that will, next round, unless you deal with it.
        firedThisPhase.add(enemy.id);
        if (weapon.launches) {
          launchMissile(state, enemy, weapon, enemy.id);
          pushLog(state, `${enemy.type.toUpperCase()} launched — one round to move.`);
          continue;
        }
        if (weapon.places) {
          placeCharge(state, state.playerPos, weapon, enemy.id);
          pushLog(state, `${enemy.type.toUpperCase()} dropped a charge — two rounds, seven hexes.`);
          continue;
        }
        totalDamage += weapon.damage;
        hitters.push({ type: enemy.type, energy: enemy.energy, maxEnergy: enemy.maxEnergy });
        state.events.push({
          type: "attack",
          enemyId: enemy.id,
          q: enemy.q,
          r: enemy.r,
          weapon: weapon.id,
          target: { q: state.playerPos.q, r: state.playerPos.r },
        });
      }
      // Every intent was decided against the board as it stood BEFORE
      // anyone moved, so two contacts can pick the same hex. Applying both
      // stacked them: one apparent contact dealing two damage a round, a
      // single-target shot leaving a hidden survivor, and enemyAt() only
      // ever seeing the first of them. Claim ground as it is taken.
      const claimed = new Set(livingEnemies(state).map((e) => hexKey(e)));
      for (const { enemy, intent } of intents) {
        if (intent.type !== "move" || !enemy.alive) continue;
        const from = { q: enemy.q, r: enemy.r };
        const dest = hexKey(intent.to);
        // Re-check at APPLY time, not decide time: the board has moved on.
        if (claimed.has(dest) || !canFlyInto(state, intent.to, enemy)) continue;
        claimed.delete(hexKey(from));
        claimed.add(dest);
        state.events.push({ type: "enemyMove", enemyId: enemy.id, from, to: intent.to });
        enemy.q = intent.to.q;
        enemy.r = intent.to.r;
      }
    }
    // Anyone who found a shot this round is fresh out of patience-spending;
    // anyone who didn't is one round closer to just charging in.
    for (const enemy of livingEnemies(state)) {
      enemy.idleRounds = firedThisPhase.has(enemy.id) ? 0 : (enemy.idleRounds || 0) + 1;
    }
    // Ordnance already in the air flies LAST, after everyone has taken
    // their step — so the hex you moved to is the hex it is judging, and
    // moving away really does buy you the round. Anything it detonates on
    // is fair game, whichever side launched it.
    advanceMissiles(state, (dmg) => {
      totalDamage += dmg;
    });
    advanceCharges(state, (dmg) => {
      totalDamage += dmg;
    });
    // The one-line-at-a-time log (see pushLog) means this is the ONLY
    // message a round with a hit in it actually shows — so it's also the
    // one place that can report a shooter actually paid energy for the
    // shot, not a separate line that would just get overwritten by this one.
    const lastHitter = hitters[hitters.length - 1];
    const energyNote = lastHitter ? ` ${lastHitter.type.toUpperCase()} energy ${lastHitter.energy}/${lastHitter.maxEnergy}.` : "";
    if (totalDamage > 0 && state.shieldCharges > 0) {
      state.shieldCharges -= 1;
      state.events.push({ type: "shieldAbsorb", q: state.playerPos.q, r: state.playerPos.r });
      pushLog(
        state,
        (state.shieldCharges > 0
          ? `Shields absorbed ${totalDamage} damage — ${state.shieldCharges} charge${state.shieldCharges === 1 ? "" : "s"} left.`
          : `Shields absorbed ${totalDamage} damage — shields DOWN.`) + energyNote
      );
    } else if (totalDamage > 0) {
      state.hull = Math.max(0, state.hull - totalDamage);
      state.events.push({ type: "damage", amount: totalDamage, q: state.playerPos.q, r: state.playerPos.r });
      pushLog(state, (totalDamage > 1 ? `We are hit — hull down ${totalDamage}.` : "We are hit — hull down 1.") + energyNote);
    }
    state.turnCount += 1; // a ROUND has passed
    // Enemy reactors tick by exactly the rate their own generators produce
    // — a Railgun's single Micro Reactor against a 4-energy slug IS the
    // four-round telegraph; nothing scripts it — but ONLY for whoever
    // spent this round's one action waiting (see waitedThisPhase above).
    // Same rule the flagship plays by: recharging costs the turn you'd
    // otherwise have spent moving or firing, for both sides now, not just
    // one of them.
    for (const enemy of livingEnemies(state)) {
      if (!waitedThisPhase.has(enemy.id)) continue;
      const ship = enemyShip(enemy);
      if (!ship) continue;
      enemy.energy = Math.min(enemy.maxEnergy, enemy.energy + ship.rechargeGain);
    }
    if (state.hull <= 0) {
      state.status = "lost";
      state.events.push({ type: "playerDeath", q: state.playerPos.q, r: state.playerPos.r });
      pushLog(state, "Hull breached. All hands.");
    }
  }

  // ---- round resolution --------------------------------------------------
  //
  // Every player action funnels through here after mutating state: it costs
  // 1 AP, resolves immediately (a volley lands the moment you confirm it —
  // no queued surprises at the engine level), and the moment the round's
  // AP is spent the enemy phase runs and the budget refills. Flying onto
  // the Warp Gate wins mid-round — you're through the gate before anyone
  // gets to answer.
  function spendAp(state) {
    checkExitUnlock(state);
    if (state.status !== "playing") return;
    state.ap -= 1;
    const usedExit = state.exits.find((e) => posEq(state.playerPos, e));
    if (usedExit && state.exitUnlocked) {
      awardCleanRun(state);
      state.status = "won";
      state.usedExitVariant = usedExit.variantId;
      if (state.isBoss) {
        state.isVictory = true;
        pushLog(state, "The Bulwark is dead in the water.");
      } else {
        pushLog(state, "Jump complete.");
      }
      return;
    }
    if (state.ap <= 0) {
      enemyPhase(state);
      if (state.status !== "playing") return;
      state.ap = state.maxAp;
    }
  }

  function assertPlaying(state) {
    if (state.status !== "playing") {
      throw new Error(`Cannot act: run is over (${state.status})`);
    }
  }

  function assertUnlocked(state, action, label) {
    if (!state.actions.includes(action)) {
      throw new Error(`${label}: not unlocked in this sector yet`);
    }
  }

  // ---- player actions -----------------------------------------------------

  // Shoves `enemy` one hex in direction `dir` — off the edge, into another
  // unit, or into a hazard all destroy it (colliding with another unit
  // destroys both, same as ramming into an enemy); otherwise it just
  // relocates. Used by anything that shoves a contact (direction derived
  // flagship's position, an armed/aimed action) and the Repulsor weapon
  // (same direction-away-from-the-flagship rule, but auto-fired).
  function pushEnemyInDirection(state, enemy, dir, sourceLabel) {
    const dest = neighbor(enemy, dir);
    if (!onBoard(state, dest)) {
      enemy.alive = false;
      state.events.push({ type: "kill", q: dest.q, r: dest.r, victim: enemy.type });
      pushLog(state, `${sourceLabel}-pushed ${enemy.type} off the map edge.`);
      awardSalvage(state, enemy.type);
      return;
    }
    const blocker = enemyAt(state, dest);
    const hazard = hazardAt(state, dest);
    if (blocker) {
      enemy.alive = false;
      blocker.alive = false;
      state.events.push({ type: "kill", q: dest.q, r: dest.r, victim: enemy.type });
      state.events.push({ type: "kill", q: blocker.q, r: blocker.r, victim: blocker.type });
      pushLog(state, `${sourceLabel}-pushed ${enemy.type} into ${blocker.type} — both destroyed.`);
      awardSalvage(state, enemy.type);
      awardSalvage(state, blocker.type);
    } else if (hazard) {
      enemy.alive = false;
      state.events.push({ type: "kill", q: dest.q, r: dest.r, victim: enemy.type });
      pushLog(state, `${sourceLabel}-pushed ${enemy.type} into a hazard.`);
      awardSalvage(state, enemy.type);
    } else {
      state.events.push({ type: "enemyMove", enemyId: enemy.id, from: { q: enemy.q, r: enemy.r }, to: dest });
      enemy.q = dest.q;
      enemy.r = dest.r;
      pushLog(state, `${sourceLabel}-pushed ${enemy.type}.`);
    }
  }

  // Every player weapon that fires automatically as part of a volley
  // Beam, which the player arms and aims at a target
  // directly) — each pairs an `actions` id (permanently unlocked, whether
  // by campaign progression or an Outpost purchase) with a `state.systems`
  // toggle key (pre-turn on/off) and its WEAPONS stat block. Adding a new
  // auto-fire weapon is adding one entry here, not new bespoke firing code.
  // `onHit` is optional — the Repulsor uses it to shove a surviving target
  // away (see pushEnemyInDirection); most weapons just damage.
  const AUTO_FIRE_WEAPONS = WEAPON_SYSTEM_KEYS.map((key) => ({ action: key, systemKey: key, weapon: WEAPONS[key] }));

  function applySublight(state, to) {
    assertPlaying(state);
    // NOTE: validation comes BEFORE state.events is cleared. Clearing
    // first meant a refused tap silently binned the cues from the last
    // action that DID happen, because the UI catches and carries on.
    // Movement is EQUIPMENT: no installed drive, no flying — the
    // deliberately absurd freedom of the Hold ("you could remove your
    // engines altogether... it wouldn't make any sense because you
    // didn't go anywhere").
    if (!state.hold.items.some((it) => EQUIPMENT[it.id].kind === "engine")) {
      throw new Error("No drive fitted — we are not going anywhere");
    }
    if (!isAdjacent(state.playerPos, to)) throw new Error("Too far for one burn");
    if (!onBoard(state, to)) throw new Error("That heading runs off the chart");
    if (enemyAt(state, to)) throw new Error("Something is sitting on that grid");
    if (isBlockingHazard(hazardAt(state, to))) throw new Error("Rock in the way");
    state.events = [];
    const from = { q: state.playerPos.q, r: state.playerPos.r };
    state.events.push({ type: "playerMove", from, to: { q: to.q, r: to.r } });
    const dir = directionIndex(from, to);
    if (dir >= 0) state.facing = dir;
    state.playerPos = { q: to.q, r: to.r }; // copy: never alias a board hex or an exit into live state
    checkPlayerHazard(state);
    if (state.status !== "playing") return;
    checkDiscovery(state);
    // Moving costs 1 AP and nothing fires — shooting is its own AP spend
    // (applyFire).
    spendAp(state);
  }

  // FIRE: 1 AP for a full volley — every armed weapon shoots, in
  // weapon-speed order, and it lands IMMEDIATELY (enemies answer in their
  // own phase, not mid-volley). `targetEnemyId` (from the UI's target
  // lock) steers every single-target weapon's shot. Refuses to waste the
  // AP if nothing is in reach of any armed weapon.
  // FIRE: 1 AP. `weaponKey` names WHICH gun pulls the trigger — every
  // fitted weapon is its own button on the console, because "fire
  // everything" is not a decision ("was supposed to show each option...
  // if there is only one option auto use on click, otherwise you have to
  // choose"). Omit it and the ship fires the only thing it can, which is
  // what a one-gun ship should do without asking.
  function armedWeaponsFor(state) {
    return AUTO_FIRE_WEAPONS.filter(
      ({ action, systemKey }) => state.actions.includes(action) && state.systems[systemKey]
    );
  }

  // The guns that actually bear on something right now.
  function weaponsWithTargets(state) {
    return armedWeaponsFor(state).filter(({ weapon }) => {
      const hexKeys = new Set(weaponHexes(state.playerPos, state.facing, weapon, state).map(hexKey));
      return livingEnemies(state).some((e) => hexKeys.has(hexKey(e)));
    });
  }

  // Several guns bearing on the same contact isn't automatically a
  // decision worth asking about — only when picking one over another
  // actually trades something off. One weapon is a no-brainer over the
  // rest when it costs no MORE energy and deals no LESS damage than every
  // other option that bears, with at least one of those strict — cheaper-
  // or-equal AND stronger-or-equal always beats cheaper-but-weaker or
  // costlier-but-not-harder, so there's nothing to weigh. A launcher or a
  // charge is never auto-picked over anything (its hit lands later, on a
  // footprint the target might not even be standing in by then), and
  // neither is an AoE weapon (`targets: "all"`) — hitting everyone nearby
  // versus hammering just the locked contact is a real tactical choice,
  // not a number a straight damage comparison can settle. Returns the
  // dominant weapon's id, or null when the player actually has to pick.
  function dominantWeapon(weaponKeys) {
    if (weaponKeys.length <= 1) return weaponKeys[0] || null;
    const defs = weaponKeys.map((k) => WEAPONS[k]);
    if (defs.some((w) => w.launches || w.places || w.targets !== "one")) return null;
    for (const w of defs) {
      const noWorse = defs.every((o) => o === w || (w.energyCost <= o.energyCost && w.damage >= o.damage));
      const strictlyBetter = defs.some((o) => o !== w && (w.energyCost < o.energyCost || w.damage > o.damage));
      if (noWorse && strictlyBetter) return w.id;
    }
    return null;
  }

  function applyFire(state, targetEnemyId, weaponKey) {
    assertPlaying(state);
    const bearing = weaponsWithTargets(state);
    if (!bearing.length) throw new Error("Nothing in arc");
    let firing;
    if (weaponKey) {
      firing = bearing.find(({ systemKey }) => systemKey === weaponKey);
      if (!firing) {
        const fitted = armedWeaponsFor(state).find(({ systemKey }) => systemKey === weaponKey);
        throw new Error(fitted ? `${fitted.weapon.label}: nothing in arc` : "That weapon isn't fitted");
      }
    } else {
      // No choice made: fire the only gun that bears, or the one that
      // dominates the rest (see dominantWeapon) — a ship never needs to be
      // asked when one option is simply better. Only a genuine trade-off
      // falls back to the cheapest, since that's the least it could cost
      // to answer with a shot when nothing named which one to fire.
      const autoKey = dominantWeapon(bearing.map(({ systemKey }) => systemKey));
      firing = autoKey
        ? bearing.find(({ systemKey }) => systemKey === autoKey)
        : bearing.slice().sort((a, b) => a.weapon.energyCost - b.weapon.energyCost)[0];
    }
    if (state.energy < firing.weapon.energyCost) {
      throw new Error(`${firing.weapon.label}: charge at ${state.energy} of ${firing.weapon.energyCost}`);
    }
    state.events = [];
    firePlayerWeapon(state, firing.weapon, firing.onHit, targetEnemyId);
    spendAp(state);
  }

  // END TURN: pass whatever AP is left and let the enemy phase run — the
  // deliberate "hold position and let them come to you" beat, and the
  // plan-confirm UI's way of committing a round that doesn't use every
  // point.
  function applyEndTurn(state) {
    assertPlaying(state);
    state.events = [];
    if (state.ap === state.maxAp) pushLog(state, "Holding station.");
    state.ap = 1; // collapse the remainder into one pass — spendAp runs the enemy phase
    spendAp(state);
  }

  // RECHARGE: the turn's action is refueling — the only mid-sector way to
  // regain Energy. Costs the whole turn while enemies keep coming.
  function applyRecharge(state) {
    assertPlaying(state);
    const reactors = state.hold.items.filter((it) => EQUIPMENT[it.id].kind === "reactor");
    if (!reactors.length) throw new Error("No reactor installed — nothing to cycle");
    if (state.energy >= state.maxEnergy) throw new Error("Reactor Core: bus is already full");
    state.events = [];
    const perCycle = reactors.reduce((sum, it) => sum + (EQUIPMENT[it.id].rechargeGain || 0), 0);
    const gained = Math.min(perCycle, state.maxEnergy - state.energy);
    state.energy += gained;
    state.events.push({ type: "energyGain", amount: gained });
    pushLog(state, `Reactor cycled — ${gained} back on the bus.`);
    spendAp(state);
  }

  // Raising a spent shield charge is a real action with a real energy
  // price ("shields... will cost energy to recharge") — it competes with
  // FIRE and RECHARGE for the turn, same one-action economy as everything
  // else. Requires an installed Shield Generator (maxShields > 0).
  const SHIELD_RAISE_COST = 2;
  function applyRaiseShields(state) {
    assertPlaying(state);
    if (state.maxShields <= 0) throw new Error("No shield generator fitted — the yards sell them");
    if (state.shieldCharges >= state.maxShields) throw new Error("Shields are already up");
    if (state.energy < SHIELD_RAISE_COST)
      throw new Error(`Not enough charge to raise shields — needs ${SHIELD_RAISE_COST}`);
    state.events = [];
    state.energy -= SHIELD_RAISE_COST;
    state.events.push({ type: "energySpend", amount: SHIELD_RAISE_COST, weapon: "Shields" });
    state.shieldCharges += 1;
    pushLog(state, `Shields up — ${state.shieldCharges} of ${state.maxShields}.`);
    spendAp(state);
  }


  // ---- Sector Outpost: shop stop, no turn spent -------------------------
  //
  // Standing on the outpost hex is enough to shop — buying doesn't move the
  // enemy phase forward, so there's no risk in browsing. Each offer can be
  // bought as many times as you can afford it (Repair is only useful while
  // hurt; Reinforce Hull has no cap).

  function outpostAvailable(state) {
    return Boolean(state.outpostPos) && posEq(state.playerPos, state.outpostPos);
  }

  // Flying onto the wormhole (when one exists — see pickPortalPos) is the
  // signal to return to the previous sector; the renderer/app drives the
  // actual transition, this just reports whether the flagship is on it.
  // The flagship spawns standing directly on it on arrival (see
  // createGameState) — suppressing the very first action's trigger so
  // arriving doesn't instantly bounce you back out is a UI-timing concern
  // (app.js's handleAction owns it), not something this pure query needs
  // to know about.
  // Position only. Suppressing the trigger on arrival is app.js's job
  // (see markArrival/stillOnArrivalHex) — this stays a pure query.
  function wormholeAvailable(state) {
    return Boolean(state.wormholePos) && posEq(state.playerPos, state.wormholePos);
  }

  function outpostOffers(state) {
    if (!outpostAvailable(state)) return [];
    // Reads off state.outpostOfferIds' own order (repair, then the shuffled
    // extras) rather than re-filtering OUTPOST_OFFER_POOL — filtering the
    // pool put every shelf back into the SAME fixed catalogue order
    // (reinforce before shield before reactor before hardpoint before...)
    // no matter how the stock itself had been shuffled, so the shelf read
    // as "same order every time" even on runs that genuinely rolled
    // different stock.
    return state.outpostOfferIds
      .map((id) => OUTPOST_OFFER_POOL.find((o) => o.id === id))
      .filter(Boolean)
      .map((offer) => {
        // The price actually rolled for THIS visit (see
        // pickOutpostOfferIds) — falls back to the pool's flat cost for
        // the boss shop (no roll — see bossOutpostOfferIds) and for any
        // caller that sets state.outpostOfferIds by hand without also
        // rolling prices (every existing test fixture).
        const cost = (state.outpostOfferPrices && state.outpostOfferPrices[offer.id]) ?? offer.cost;
        return {
          ...offer,
          cost,
          affordable: state.salvage >= cost,
          applicable: offer.id !== "repair" || state.hull < state.maxHull,
          // Whether the crate would physically go in — the UI greys out what
          // there is no room for rather than letting you find out by paying.
          fits: OFFER_ITEM[offer.id] ? holdHasRoomFor(state.hold, OFFER_ITEM[offer.id]) : true,
          // WHICH crate this offer actually delivers, when it delivers one
          // at all. The shop can then describe a purchase with the very
          // same readout the Hold uses for a fitted item — footprint
          // diagram and all — instead of keeping a second, driftable
          // description of the same equipment.
          itemId: OFFER_ITEM[offer.id] || null,
        };
      });
  }

  // Hardware you have no room for still SELLS — it rides in cargo until a
  // Hold Expansion (or a rearrange) makes room, which is the only way a
  // 1x4 Railgun is ever obtainable at all: the shelf is randomized, so
  // refusing the sale outright can lock a gun out of a whole run. What was
  // actually wrong was that it happened silently. It's announced now, in
  // the log here and on the shop button itself (see outpostOffers().fits).
  function noteStowed(state, itemId, label) {
    if (holdHasRoomFor(state.hold, itemId)) return;
    pushLog(state, `${label || EQUIPMENT[itemId].label} stowed in cargo — no room in the Hold yet.`);
  }

  function holdHasRoomFor(hold, itemId) {
    for (let y = 0; y < hold.rows; y++) {
      for (let x = 0; x < hold.cols; x++) if (holdCanPlace(hold, itemId, x, y)) return true;
    }
    return false;
  }

  function applyOutpostPurchase(state, offerId) {
    assertPlaying(state);
    if (!outpostAvailable(state)) throw new Error("Outpost: not docked at an outpost");
    if (!state.outpostOfferIds.includes(offerId)) throw new Error(`Outpost: "${offerId}" is not on offer here`);
    const offer = OUTPOST_OFFER_POOL.find((o) => o.id === offerId);
    if (!offer) throw new Error(`Outpost: unknown offer "${offerId}"`);
    // The price rolled for THIS visit (see pickOutpostOfferIds), not the
    // pool's flat cost — same fallback as outpostOffers() above.
    const cost = (state.outpostOfferPrices && state.outpostOfferPrices[offerId]) ?? offer.cost;
    if (state.salvage < cost) throw new Error(`Not enough salvage for ${offer.label}`);
    state.events = [];
    if (offer.id === "repair") {
      if (state.hull >= state.maxHull) throw new Error("Nothing to patch — hull is sound");
      state.hull += 1;
    } else if (offer.id === "reinforce") {
      noteStowed(state, "ablativePlating", offer.label);
      // Plating is a crate of hardware that gets welded in, not a number
      // going up — the same Ablative Plating a Cruiser carries. If the
      // hold is full it goes to cargo and does nothing until you find
      // room for it, which is the honest outcome.
      autoPlaceInHold(state.hold, "ablativePlating");
      syncHoldDerived(state);
      state.hull = Math.min(state.hull + 1, state.maxHull);
    } else if (offer.id === "shield") {
      noteStowed(state, "shieldGenerator", offer.label);
      autoPlaceInHold(state.hold, "shieldGenerator");
      syncHoldDerived(state);
      state.shieldCharges = Math.min(state.shieldCharges + 1, state.maxShields); // arrives raised if it fit installed
    } else if (offer.id === "reactor") {
      noteStowed(state, "microReactor", offer.label);
      // A Micro Reactor: one more on the bus AND one more per cycle, the
      // same tile the chasers run on.
      autoPlaceInHold(state.hold, "microReactor");
      syncHoldDerived(state);
      state.energy = Math.min(state.energy + 1, state.maxEnergy); // an upgrade should feel immediate
    } else if (offer.id === "screenArray" || offer.id === "chargeBank") {
      // Plain fitted hardware: stow it, place it, let deriveShip do the
      // rest. Shield capacity and energy capacity are both summed off the
      // hold (see deriveShip), so there is no stat to write here —
      // installing the thing IS the upgrade, and a piece that will not fit
      // rides in cargo doing nothing, same as any other.
      const fittedId = OFFER_ITEM[offer.id];
      noteStowed(state, fittedId, offer.label);
      autoPlaceInHold(state.hold, fittedId);
      syncHoldDerived(state);
      state.energy = Math.min(state.energy, state.maxEnergy);
      // A screen that fitted arrives raised, same as the first one.
      if (offer.id === "screenArray") state.shieldCharges = Math.min(state.shieldCharges + 1, state.maxShields);
    } else if (offer.id === "hardpoint") {
      state.hold.rows += 1; // more internal space — the grid literally grows
    } else if (WEAPON_SYSTEM_KEYS.includes(offer.id)) {
      noteStowed(state, offer.id, offer.label);
      autoPlaceInHold(state.hold, offer.id);
      syncHoldDerived(state);
    }
    state.salvage -= cost;
    pushLog(state, cost > 0 ? `Traded ${cost} salvage for ${offer.label}.` : `Took delivery of ${offer.label}.`);
    // Every offer except Repair is a one-time purchase per outpost — buying
    // it removes it from what's on offer here, so a visit is a real choice
    // instead of "buy everything repeatedly as long as you can afford it."
    if (offer.id !== "repair") {
      state.outpostOfferIds = state.outpostOfferIds.filter((id) => id !== offer.id);
    }
  }

  // ---- legal-target queries (used by the renderer to highlight hexes) -----

  function legalSublightTargets(state) {
    // Same gate applySublight enforces — otherwise the board offers moves
    // the engine will refuse.
    if (!state.hold || !state.hold.items.some((it) => (EQUIPMENT[it.id] || {}).kind === "engine")) return [];
    return neighbors(state.playerPos).filter(
      (to) => onBoard(state, to) && !enemyAt(state, to) && !isBlockingHazard(hazardAt(state, to))
    );
  }


  // ---- exports --------------------------------------------------------------

  const HypergolicEngine = {
    DIRECTIONS,
    ALL_ACTIONS,
    PURCHASABLE_ACTIONS,
    WEAPON_SYSTEM_KEYS,
    EQUIPMENT,
    holdCanPlace,
    syncHoldDerived,
    moveHoldItem,
    stowToCargo,
    installFromCargo,
    hexKey,
    posEq,
    hexDistance,
    neighbor,
    neighbors,
    isAdjacent,
    inBounds,
    onBoard,
    buildBoardHexes,
    findPath,
    chargeBlastHexes,
    chargedHexes,
    directionIndex,
    enemyFacing,
    validateLevel,
    createGameState,
    setFacing,
    computeThreatHexes,
    staticKillZones,
    applySublight,
    applyFire,
    armedWeaponsFor,
    weaponsWithTargets,
    dominantWeapon,
    applyRecharge,
    RECHARGE_ENERGY_GAIN,
    applyRaiseShields,
    SHIELD_RAISE_COST,
    applyEndTurn,
    START_AP,
    START_HULL,
    OUTPOST_OFFER_POOL,
    ENEMY_AP,
    outpostAvailable,
    outpostOffers,
    applyOutpostPurchase,
    wormholeAvailable,
    reenterSector,
    placeArrivals,
    enemiesThatCanFollow,
    legalSublightTargets,
    livingEnemies,
    enemyAt,
    hazardAt,
    WEAPONS,
    ENEMY_TYPES,
    STARTING_LOADOUTS,
    previewLoadout,
    weaponHexes,
    deriveShip,
    enemyShip,
    enemyWeaponsBearing,
    canFlyInto,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicEngine;
  } else {
    root.HypergolicEngine = HypergolicEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
