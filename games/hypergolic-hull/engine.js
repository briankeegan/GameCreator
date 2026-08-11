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
  const ALL_ACTIONS = ["sublight", "autocannon", "flakBurst", "arcBeam", "mortar", "flankTubes", "railgun"];
  // Purchase-only actions (see OUTPOST_OFFER_POOL/applyOutpostPurchase) —
  // never part of any level's own baked-in `actions` list, and excluded
  // from the default fallback below so they don't show up for free the
  // per Clubhouse feedback ("you should not start with it") — it's still
  // guaranteed claimable (free) at Sector 2's Outpost specifically (see
  // pickOutpostOfferIds), just no longer handed out automatically for
  // reaching the sector.
  const PURCHASABLE_ACTIONS = ["flakBurst", "arcBeam", "mortar", "flankTubes", "railgun"];
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
    if (level.outpost) {
      mustBeOn("outpost", level.outpost);
      if (!isBorder(level.outpost)) {
        throw new Error(`Level ${level.id}: outpost is not on the board's edge`);
      }
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
      ...(level.outpost ? [{ label: "outpost", pos: level.outpost }] : []),
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
  // Three. Deliberately unforgiving: hull damage is permanent, repairs
  // only exist at a dock, and a single mistake is most of the ship. Five
  // and seven were both tried and both read as too soft — the crawl is
  // supposed to be survived, not absorbed. What makes three playable
  // rather than arbitrary is that the gate is always open: you are never
  // required to trade hits, and a contact you route around costs nothing.
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
    arc: (pos, facing, weapon, state, opts) => {
      const hexes = [];
      for (const offset of weapon.pattern) {
        const dir = (facing + offset + 6) % 6;
        let cur = pos;
        for (let step = 0; step < weapon.range; step++) {
          cur = neighbor(cur, dir);
          hexes.push(cur);
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
    autocannon: { id: "autocannon", label: "Autocannon", shape: "arc", range: 1, damage: 1, targets: "one", energyCost: 1, speed: 3, pattern: FORWARD_ARC_PATTERN, slots: 1 },
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
    // The sniper: down any of the six axes, the length of the board, two
    // damage. Stopped by the first rock or hull in the lane, which is
    // both its weakness and how you survive one.
    railgun: { id: "railgun", label: "Railgun", shape: "lane", range: 20, damage: 2, targets: "one", energyCost: 4, speed: 1, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
  };

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
    railgun: { id: "railgun", label: "Railgun", kind: "weapon", weaponKey: "railgun", w: 1, h: 4 },
    mortar: { id: "mortar", label: "Mortar", kind: "weapon", weaponKey: "mortar", w: 2, h: 2 },
    flankTubes: { id: "flankTubes", label: "Flank Tubes", kind: "weapon", weaponKey: "flankTubes", w: 1, h: 3 },
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
  const WEAPON_SYSTEM_KEYS = ["autocannon", "flakBurst", "arcBeam", "mortar", "flankTubes", "railgun"];

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
      hull: 1, salvage: 2,
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
      hull: 1, salvage: 4,
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "flakBurst", x: 1, y: 0 },
          { id: "ablativePlating", x: 0, y: 1 },
          { id: "microReactor", x: 3, y: 1 },
          { id: "sublightDrive", x: 1, y: 2 },
          { id: "chargeBank", x: 2, y: 2 },
        ],
      },
    },
    sentry: {
      hull: 1, salvage: 4,
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
    // The emplacement that makes cover worthless. Its shell lands at
    // exactly three hexes and doesn't care what's in between, so parking
    // behind a rock is no answer — you close inside three, back off past
    // it, or kill it. There is no hiding from this one.
    mortar: {
      hull: 1, salvage: 5,
      hold: {
        cols: 3, rows: 4, blocked: ["0,0", "2,0"],
        items: [
          { id: "mortar", x: 0, y: 1 },
          { id: "microReactor", x: 1, y: 0 },
          { id: "chargeBank", x: 2, y: 1 },
          { id: "stationAnchor", x: 1, y: 3 },
        ],
      },
    },
    // A chaser that threatens the gaps instead of the lanes: the six
    // off-axis hexes at two, for two damage. Line yourself up on an axis
    // with it, or get inside it — standing diagonally off at two is the
    // one place it wants you.
    lancer: {
      hull: 1, salvage: 5,
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "flankTubes", x: 1, y: 0 },
          { id: "ablativePlating", x: 0, y: 1 },
          { id: "microReactor", x: 3, y: 1 },
          { id: "sublightDrive", x: 2, y: 1 },
          { id: "chargeBank", x: 3, y: 2 },
        ],
      },
    },
    // Two big banks and one small generator: five on the bus, one a
    // round to fill it, a slug that costs four. The telegraph isn't a
    // scripted timer — it's the hardware.
    railgun: {
      hull: 2, salvage: 6, startsEmpty: true,
      hold: {
        cols: 3, rows: 5, blocked: ["0,0", "2,0", "0,4", "2,4"],
        items: [
          { id: "railgun", x: 1, y: 0 },
          { id: "chargeBank", x: 0, y: 1 },
          { id: "chargeBank", x: 2, y: 1 },
          { id: "microReactor", x: 0, y: 3 },
          { id: "stationAnchor", x: 1, y: 4 },
        ],
      },
    },
    // ---- the second wave -------------------------------------------------
    // Five more classes, and not one of them needed a new rule: every
    // difference below is a different arrangement of the same crates you
    // can buy yourself. What makes a class is what it bolted on.

    // Cheapest airframe in the sky: a gun, a drive, and a scanner where
    // the armour should be. It dies to anything. It arrives in numbers,
    // which is the entire idea — the Interceptor asks "can you kill it",
    // a Scout screen asks "can you kill FOUR of them before they all
    // reach you", and the answer depends on whether your second gun
    // covers ground or covers a direction.
    scout: {
      hull: 1, salvage: 2,
      hold: {
        cols: 3, rows: 5, blocked: ["0,0", "2,0", "0,4", "2,4"],
        items: [
          { id: "sublightDrive", x: 1, y: 0 },
          { id: "microReactor", x: 0, y: 1 },
          { id: "scanner", x: 2, y: 1 },
          { id: "autocannon", x: 0, y: 3 },
        ],
      },
    },
    // The first hostile to carry a screen. One Hull under it, so the
    // Autocannon that kills an Interceptor outright only pops the bubble
    // here — everything takes exactly one more shot than you expect, and
    // a volley you were counting on to clear contact doesn't.
    escort: {
      hull: 1, salvage: 5,
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "shieldGenerator", x: 1, y: 0 },
          { id: "sublightDrive", x: 0, y: 1 },
          { id: "microReactor", x: 3, y: 1 },
          { id: "autocannon", x: 1, y: 2 },
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
      hull: 1, salvage: 8,
      hold: {
        cols: 4, rows: 6, blocked: ["0,0", "3,0", "0,5", "3,5"],
        items: [
          { id: "flakBurst", x: 1, y: 0 },
          { id: "sublightDrive", x: 0, y: 1 },
          { id: "ablativePlating", x: 3, y: 1 },
          { id: "autocannon", x: 1, y: 2 },
          { id: "microReactor", x: 1, y: 3 },
          { id: "chargeBank", x: 2, y: 3 },
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
      hull: 1, salvage: 14,
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
      hull: 2, salvage: 30, startsEmpty: true,
      hold: {
        cols: 5, rows: 6, blocked: ["0,0", "4,0", "0,5", "4,5"],
        items: [
          { id: "railgun", x: 1, y: 0 },
          { id: "flakBurst", x: 2, y: 0 },
          { id: "ablativePlating", x: 0, y: 1 },
          { id: "ablativePlating", x: 4, y: 1 },
          { id: "chargeBank", x: 3, y: 2 },
          { id: "chargeBank", x: 0, y: 3 },
          { id: "microReactor", x: 4, y: 3 },
          { id: "stationAnchor", x: 1, y: 4 },
        ],
      },
    },
  };

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
  function enemyWeaponsBearing(state, enemy, target) {
    const ship = enemyShip(enemy);
    if (!ship) return [];
    const facing = enemyFacing(state, enemy);
    const at = target || state.playerPos;
    return ship.weapons.filter((w) => weaponHexes(enemy, facing, w, state).some((h) => posEq(h, at)));
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
    flakBurst: "flakBurst",
    arcBeam: "arcBeam",
    mortar: "mortar",
    flankTubes: "flankTubes",
    railgun: "railgun",
  };

  const OUTPOST_OFFER_POOL = [
    { id: "repair", label: "Patch 1 Hull", cost: 10 },
    { id: "reinforce", label: "Reinforce Hull (+1 Max)", cost: 10 },
    // Shields aren't consumable purchases anymore — you buy the GENERATOR
    // (permanent +1 capacity, arrives raised), then re-raising a spent
    // charge costs Energy and a turn (applyRaiseShields), not salvage.
    { id: "shield", label: "Shield Generator (2x2 — raise-able charge)", cost: 8 },
    // The two "configurable limits" as purchases: your reactor cap (how
    // much Energy you can bank against expensive weapons) and your weapon
    // slots (how many systems can run at once) are both ship stats you
    // grow at Outposts, not constants.
    { id: "reactor", label: "Reactor Upgrade (+1 Max Energy)", cost: 8 },
    { id: "hardpoint", label: "Hold Expansion (+1 row of internal space)", cost: 12 },
    // The three weapons beyond your starting Autocannon, priced on a real
    // curve — each one answers a situation the others can't, and each is
    // the item a hostile class already carries (buy the gun that's been
    // shooting at you).
    { id: "flakBurst", label: "Flak Burst (2x2 — everything touching us, at once)", cost: 10 },
    { id: "arcBeam", label: "Arc Beam (2x2 — the ring at two. Nothing closer.)", cost: 8 },
    { id: "mortar", label: "Mortar (2x2 — lands at three, straight over the rocks)", cost: 14 },
    { id: "flankTubes", label: "Flank Tubes (1x3 — the gaps at two, 2 dmg)", cost: 16 },
    { id: "railgun", label: "Railgun (1x4 — any axis, board-length, 2 dmg)", cost: 24 },
  ];

  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Repair is always on offer (the reliable baseline), but how many EXTRA
  // offers sit alongside it varies (0, 1, or all of them) — a guaranteed
  // fixed shop every visit read as "too easy and not very interesting"
  // (Clubhouse feedback). Deterministic per level id, same as before.
  function pickOutpostOfferIds(levelId, aboard) {
    // A frontier station is a scrapyard with a welding rig, not a
    // showroom. Repair plus TWO things — that's the whole shelf
    // (Clubhouse: "too many options too soon... this is a gritty scifi,
    // why sell so much at every station?"). Nine offers in one list read
    // as a catalogue, and with early-run salvage most of it was greyed
    // out anyway: a wall of things you can't have instead of a decision.
    //
    // What a station can even stock depends on how deep it is. The first
    // few sell survival — patches, plating, a shield rig. Weapons are a
    // find, and the heavy hardware only turns up out where the wrecks
    // that carried it are.
    // A station won't try to sell you a second Flak Burst while the first
    // is still bolted in. With only two slots on the shelf, stocking
    // something you already fly is the same as stocking nothing — so the
    // shelf trades against what the ship is actually missing.
    const carried = new Set(aboard || []);
    const stock = OUTPOST_OFFER_POOL.filter((o) => {
      if (o.id === "repair") return false; // always on the shelf, added below
      if (WEAPON_SYSTEM_KEYS.includes(o.id) && carried.has(o.id)) return false;
      if (o.id === "shield" && carried.has("shieldGenerator")) return false;
      // Shapes arrive one at a time so each one gets to be a lesson: the
      // crowd answer, then standoff, then the gun that beats cover, then
      // the one that covers what a lane can't, then the sniper.
      if (o.id === "railgun") return levelId >= 8;
      if (o.id === "flankTubes") return levelId >= 8;
      if (o.id === "mortar") return levelId >= 6;
      if (o.id === "arcBeam" || o.id === "hardpoint") return levelId >= 3;
      if (o.id === "flakBurst") return levelId >= 2;
      return true; // reinforce / shield / reactor: basic dock trade at any depth
    });
    const rng = seededRandom(levelId * 7919 + 13);
    const shuffled = stock.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    // THREE slots, not two. With six weapons in the world a two-slot
    // shelf simply cannot show you the gun you need often enough: adding
    // the Mortar and the Flank Tubes to the pool measured out as the Arc
    // Beam never appearing at all across sixty runs, and every run
    // reaching the Bulwark with the Autocannon it started with, spending
    // its whole salvage on hull patches. A dock has to be a real chance
    // to change what the ship is.
    const picked = ["repair", ...shuffled.slice(0, 3).map((o) => o.id)];
    // A three-Hull ship lives or dies on screens, so a yard will always
    // find you a generator if you're flying without one. Everything else
    // is what they happen to have; this one is the trade that keeps the
    // crawl survivable at all.
    // Both guarantees APPEND and drop the last unforced entry, rather than
    // writing into the same slot — at sector 3 they used to overwrite each
    // other, so a ship with no screen could be promised one and handed an
    // Arc Beam instead.
    const force = (id) => {
      if (picked.includes(id)) return;
      const drop = picked.findIndex((p, i) => i > 0 && !FORCED.has(p));
      if (drop >= 0) picked.splice(drop, 1);
      picked.push(id);
      FORCED.add(id);
    };
    const FORCED = new Set();
    if (!carried.has("shieldGenerator")) force("shield");
    // Sector 3 is the Sentry Line — the first sector with something that
    // outranges you and won't come to you. The weapon that answers it has
    // to be ON THE SHELF there, not left to the shuffle, or the lesson is
    // just "take two hits and hope".
    if (levelId === 3 && !carried.has("arcBeam")) force("arcBeam");
    return picked;
  }

  // The Bulwark's own station is the one shop in the crawl that isn't a
  // gamble: it is parked directly before the fight the whole run has been
  // heading toward, and arriving with salvage you can't spend is a bad
  // way to lose. Patches, a screen, and the heavy gun — always.
  function bossOutpostOfferIds() {
    return ["repair", "shield", "railgun"];
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
    const reserved = [...state.exits, state.outpostPos].filter(Boolean);
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
    const state = {
      levelId: level.id,
      levelName: level.name || `Sector ${level.id}`,
      radius: level.radius || null,
      boardHexes: buildBoardHexes(level),
      actions: ["sublight"], // derived from the Hold below (syncHoldDerived)
      playerPos: { q: level.playerStart.q, r: level.playerStart.r },
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
      shieldCharges: (carryOver && carryOver.shieldCharges) || 0,
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
      outpostPos: level.outpost ? { q: level.outpost.q, r: level.outpost.r } : null,
      outpostOfferIds: level.outpost
        ? level.isBoss
          ? bossOutpostOfferIds()
          : pickOutpostOfferIds(level.id, [...hold.items.map((it) => it.id), ...hold.cargo])
        : [],
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
    return state;
  }

  // A fresh sector's hold: carried whole from the previous one (the ship
  // travels), or built from the level's starting kit — every ship begins
  // with a Reactor Core and a Sublight Drive, plus whatever weapons the
  // level's actions list (or a carryOver.extraActions fixture) grants.
  function buildHold(level, carryOver) {
    if (carryOver && carryOver.hold) return JSON.parse(JSON.stringify(carryOver.hold));
    const hold = { cols: HOLD_COLS, rows: HOLD_ROWS, blocked: HOLD_BLOCKED.slice(), items: [], cargo: [] };
    const acts = new Set([...(level.actions || DEFAULT_ACTIONS), ...((carryOver && carryOver.extraActions) || [])]);
    const kit = ["sublightDrive", "reactorCore", "scanner"]; // drive first: it runs down the spine, keeping the midsection whole
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

  function livingEnemiesAdjacentTo(state, pos) {
    return livingEnemies(state).filter((e) => isAdjacent(e, pos));
  }

  // Shortest walkable path from `from` to `to` (inclusive), avoiding enemies
  // and hazards. BFS with the fixed direction order, so routes are
  // deterministic. Returns null when the target is blocked or unreachable.
  // Drives the tap-twice "fly there" route preview in the UI.
  function findPath(state, from, to) {
    const blocked = (pos) => enemyAt(state, pos) || hazardAt(state, pos);
    if (!onBoard(state, to) || blocked(to)) return null;
    if (posEq(from, to)) return [{ q: from.q, r: from.r }];
    const prev = new Map([[hexKey(from), null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (let i = 0; i < 6; i++) {
        const n = neighbor(cur, i);
        if (!onBoard(state, n) || prev.has(hexKey(n)) || blocked(n)) continue;
        prev.set(hexKey(n), cur);
        if (posEq(n, to)) {
          const path = [n];
          let p = cur;
          while (p) {
            path.unshift(p);
            p = prev.get(hexKey(p));
          }
          return path;
        }
        queue.push(n);
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
  // Deeper wrecks are worth more. Without this the shop is priced against
  // sector-2 income forever while the sectors themselves keep getting
  // harder — the run becomes a treadmill you can only lose, which is
  // exactly what full-run playtesting showed: deaths piling up at depth
  // 9-13 with nothing new ever fitted. A bounty that climbs with depth is
  // also what makes "fight it or route around it" stay a real question
  // instead of always being "route around it".
  function depthBounty(state) {
    return Math.floor((state.levelId || 1) / 4) + (state.salvageBonus || 0);
  }

  function awardSalvage(state, enemyType) {
    const base = (ENEMY_TYPES[enemyType] || {}).salvage || 0;
    const amount = base > 0 ? base + depthBounty(state) : 0;
    if (amount <= 0) return;
    state.salvage += amount;
    state.events.push({ type: "salvage", amount });
    pushLog(state, `Salvage recovered — +${amount}.`);
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
      const live = ship.weapons.filter((w) => enemy.energy >= w.energyCost);
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
    return threats;
  }

  // ---- enemy AI -------------------------------------------------------------

  function decideIntent(state, enemy) {
    const ship = enemyShip(enemy);
    if (!ship) return { enemyId: enemy.id, type: "wait" };
    // Any contact fires the instant the flagship is standing somewhere one
    // of ITS FITTED GUNS reaches and its reactor can pay for the shot —
    // the same two questions the flagship's own fire controls ask. A
    // charging Railgun holds fire; a cost-1 chaser always affords it.
    // With several guns aboard it takes the cheapest that bears, which is
    // exactly what applyFire does for you when you don't name one.
    const bearing = enemyWeaponsBearing(state, enemy);
    const affordable = bearing.filter((w) => enemy.energy >= w.energyCost);
    if (affordable.length) {
      const pick = affordable.slice().sort((a, b) => a.energyCost - b.energyCost || b.damage - a.damage)[0];
      return { enemyId: enemy.id, type: "attack", weaponKey: pick.id };
    }
    // Already in reach but the reactor can't pay yet: HOLD, don't shuffle
    // sideways — a chaser that spent the turn orbiting the flagship reads
    // as random. It stays put and lets the reactor climb.
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
      candidates.sort((a, b) => a.dist - b.dist || a.dir - b.dir);
      if (candidates.length === 0) return { enemyId: enemy.id, type: "wait" };
      return { enemyId: enemy.id, type: "move", to: candidates[0].to };
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
    for (let apStep = 0; apStep < ENEMY_AP; apStep++) {
      const intents = livingEnemies(state).map((enemy) => ({ enemy, intent: decideIntent(state, enemy) }));
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
        totalDamage += weapon.damage;
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
    if (totalDamage > 0 && state.shieldCharges > 0) {
      state.shieldCharges -= 1;
      state.events.push({ type: "shieldAbsorb", q: state.playerPos.q, r: state.playerPos.r });
      pushLog(
        state,
        state.shieldCharges > 0
          ? `Shields absorbed ${totalDamage} damage — ${state.shieldCharges} charge${state.shieldCharges === 1 ? "" : "s"} left.`
          : `Shields absorbed ${totalDamage} damage — shields DOWN.`
      );
    } else if (totalDamage > 0) {
      state.hull = Math.max(0, state.hull - totalDamage);
      state.events.push({ type: "damage", amount: totalDamage, q: state.playerPos.q, r: state.playerPos.r });
      pushLog(state, totalDamage > 1 ? `We are hit — hull down ${totalDamage}.` : "We are hit — hull down 1.");
    }
    state.turnCount += 1; // a ROUND has passed
    // Enemy reactors tick once per ROUND, by exactly the rate their own
    // generators produce — a Railgun's single Micro Reactor against a
    // 4-energy slug IS the four-round telegraph; nothing scripts it. The
    // flagship gets no passive tick: with only one action a round, an
    // enemy that had to spend its turn cycling would simply stop being a
    // threat, so this is the one place the two sides differ, and it's a
    // consequence of the AP budget, not of enemies having private rules.
    for (const enemy of livingEnemies(state)) {
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
      // No choice made: fire the only gun that bears, or the cheapest one
      // that does — a single-weapon ship never needs to be asked.
      firing = bearing.slice().sort((a, b) => a.weapon.energyCost - b.weapon.energyCost)[0];
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
    return OUTPOST_OFFER_POOL.filter((o) => state.outpostOfferIds.includes(o.id)).map((offer) => ({
      ...offer,
      affordable: state.salvage >= offer.cost,
      applicable: offer.id !== "repair" || state.hull < state.maxHull,
      // Whether the crate would physically go in — the UI greys out what
      // there is no room for rather than letting you find out by paying.
      fits: OFFER_ITEM[offer.id] ? holdHasRoomFor(state.hold, OFFER_ITEM[offer.id]) : true,
    }));
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
    if (state.salvage < offer.cost) throw new Error(`Not enough salvage for ${offer.label}`);
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
    } else if (offer.id === "hardpoint") {
      state.hold.rows += 1; // more internal space — the grid literally grows
    } else if (WEAPON_SYSTEM_KEYS.includes(offer.id)) {
      noteStowed(state, offer.id, offer.label);
      autoPlaceInHold(state.hold, offer.id);
      syncHoldDerived(state);
    }
    state.salvage -= offer.cost;
    pushLog(
      state,
      offer.cost > 0 ? `Traded ${offer.cost} salvage for ${offer.label}.` : `Took delivery of ${offer.label}.`
    );
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
    legalSublightTargets,
    livingEnemies,
    enemyAt,
    hazardAt,
    WEAPONS,
    ENEMY_TYPES,
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
