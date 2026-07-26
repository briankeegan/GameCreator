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
  const ALL_ACTIONS = ["sublight", "autocannon", "flakBurst", "arcBeam", "railgun"];
  // Purchase-only actions (see OUTPOST_OFFER_POOL/applyOutpostPurchase) —
  // never part of any level's own baked-in `actions` list, and excluded
  // from the default fallback below so they don't show up for free the
  // per Clubhouse feedback ("you should not start with it") — it's still
  // guaranteed claimable (free) at Sector 2's Outpost specifically (see
  // pickOutpostOfferIds), just no longer handed out automatically for
  // reaching the sector.
  const PURCHASABLE_ACTIONS = ["flakBurst", "arcBeam", "railgun"];
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
  // FOUR weapons, each the answer to exactly one situation — cheap-and-
  // reliable, crowds, standoff, or sniping — with a real price curve and
  // real footprints (Clubhouse: "they all seem super similar and similarly
  // priced... use some critical thinking"). Every one of them is ALSO the
  // item an enemy class carries, so scanning a contact teaches you what's
  // buyable instead of showing you enemy-only gear you can never own.
  const WEAPONS = {
    // The workhorse, and the ship's starting gun. 1 energy against a
    // +1/cycle reactor means it fires every single round forever — but it
    // only covers the three hexes off the nose. It does NOT reach — that
    // was tried, and a starting gun that hits at two makes every other
    // weapon redundant: measured, a pilot that just shot everything with
    // it won two runs in three and never needed the shop. REACH is the
    // thing you buy. Cheap, reliable, and strictly a contact weapon.
    // Interceptors carry this exact gun, which is why flanking one works.
    autocannon: { id: "autocannon", label: "Autocannon", range: 1, damage: 1, targets: "one", energyCost: 1, speed: 3, pattern: FORWARD_ARC_PATTERN, slots: 1 },
    // The crowd answer: the only weapon that hits EVERY adjacent contact
    // at once, so being surrounded stops being a death sentence. Pricey
    // per shot (3 against +1/cycle = a shot every third round) and a fat
    // 2x2 footprint. Cruisers brawl with it.
    flakBurst: { id: "flakBurst", label: "Flak Burst", range: 1, damage: 1, targets: "all", energyCost: 3, speed: 2, pattern: ALL_DIRECTIONS_PATTERN, spread: "ring", slots: 1 },
    // Standoff. Two hexes in every direction, so you hit things on their
    // approach instead of trading blows in contact — reach is what you're
    // buying, not stopping power. (Two damage was tried and it is simply
    // too much on a weapon this easy to bring to bear: the Cruisers that
    // carry it flattened the early crawl, median run depth 5.)
    arcBeam: { id: "arcBeam", label: "Arc Beam", range: 2, damage: 1, targets: "one", energyCost: 2, speed: 2, pattern: ALL_DIRECTIONS_PATTERN, spread: "ring", slots: 1 },
    // The sniper: down any of the six axes, the length of the board, two
    // damage — enough to one-shot the 2-hull classes. 4 energy against
    // +1/cycle is a visible four-round charge cycle, the exact rhythm the
    // Railgun Destroyer telegraphs at you. Huge 1x4 footprint.
    railgun: { id: "railgun", label: "Railgun", range: 20, damage: 2, targets: "one", energyCost: 4, speed: 1, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
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
    reactorCore: { id: "reactorCore", label: "Reactor Core", kind: "reactor", rechargeGain: 1, w: 2, h: 2 },
    sublightDrive: { id: "sublightDrive", label: "Sublight Drive", kind: "engine", moveRange: 1, w: 1, h: 3 },
    shieldGenerator: { id: "shieldGenerator", label: "Shield Generator", kind: "shield", capacity: 1, w: 2, h: 2 },
    // The Scan mode's hardware ("the scanner should itself be a small
    // item") — a tiny tile, but pull it and the ship flies blind.
    scanner: { id: "scanner", label: "Scanner Array", kind: "sensor", w: 1, h: 1 },
    // Small hardware the hostile classes are built around. Ordinary
    // EQUIPMENT entries, not enemy-only props — an enemy's hold renders
    // through exactly the same registry yours does, and these are what a
    // wreck would drop.
    microReactor: { id: "microReactor", label: "Micro Reactor", kind: "reactor", rechargeGain: 1, w: 1, h: 1 },
    chargeBank: { id: "chargeBank", label: "Charge Bank", kind: "reactor", rechargeGain: 1, w: 1, h: 2 },
    ablativePlating: { id: "ablativePlating", label: "Ablative Plating", kind: "shield", capacity: 1, w: 1, h: 2 },
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

  // The hold is the SOURCE OF TRUTH — actions, weapon arming, and shield
  // capacity all derive from what's physically installed. Cargo is inert.
  function syncHoldDerived(state) {
    const has = (id) => state.hold.items.some((it) => it.id === id);
    const actions = ["sublight"];
    for (const key of WEAPON_SYSTEM_KEYS) if (has(key)) actions.push(key);
    state.actions = actions;
    state.systems = { warpdrive: true };
    for (const key of WEAPON_SYSTEM_KEYS) state.systems[key] = has(key);
    state.maxShields = state.hold.items.filter((it) => EQUIPMENT[it.id].kind === "shield").length;
    state.shieldCharges = Math.min(state.shieldCharges, state.maxShields);
    state.scannerInstalled = state.hold.items.some((it) => EQUIPMENT[it.id].kind === "sensor");
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
    syncHoldDerived(state);
  }

  function stowToCargo(state, index) {
    assertPlaying(state);
    assertDocked(state);
    const it = state.hold.items[index];
    if (!it) throw new Error("Hold: no such installed item");
    state.hold.items.splice(index, 1);
    state.hold.cargo.push(it.id);
    syncHoldDerived(state);
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
    syncHoldDerived(state);
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
    interceptor: {
      hp: 1, weapon: WEAPONS.autocannon, movesTowardPlayer: true, salvage: 2, maxEnergy: 1, startEnergy: 1,
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
      hp: 2, weapon: WEAPONS.flakBurst, movesTowardPlayer: true, salvage: 4, maxEnergy: 3, startEnergy: 3,
      hold: {
        cols: 4, rows: 5, blocked: ["0,0", "3,0", "0,4", "3,4"],
        items: [
          { id: "flakBurst", x: 1, y: 0 },
          { id: "ablativePlating", x: 0, y: 1 },
          { id: "ablativePlating", x: 3, y: 1 },
          { id: "sublightDrive", x: 1, y: 2 },
          { id: "chargeBank", x: 2, y: 2 },
        ],
      },
    },
    sentry: {
      hp: 1, weapon: WEAPONS.arcBeam, movesTowardPlayer: false, salvage: 4, maxEnergy: 2, startEnergy: 2,
      hold: {
        cols: 3, rows: 4, blocked: ["0,0", "2,0"],
        items: [
          { id: "arcBeam", x: 0, y: 1 },
          { id: "microReactor", x: 2, y: 1 },
          { id: "microReactor", x: 2, y: 2 },
          { id: "stationAnchor", x: 1, y: 3 },
        ],
      },
    },
    railgun: {
      hp: 2, weapon: WEAPONS.railgun, movesTowardPlayer: false, salvage: 6, maxEnergy: 4, startEnergy: 0,
      hold: {
        cols: 3, rows: 5, blocked: ["0,0", "2,0", "0,4", "2,4"],
        items: [
          { id: "railgun", x: 1, y: 0 },
          { id: "chargeBank", x: 0, y: 1 },
          { id: "chargeBank", x: 2, y: 1 },
          { id: "stationAnchor", x: 1, y: 4 },
        ],
      },
    },
  };

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

  function weaponHexes(pos, facing, weapon, state) {
    // A RING weapon fills every hex within range, not just the six
    // straight axes out of the ship. Without this a "range 2" beam has a
    // blind spot everywhere off-axis — two thirds of the actual ring —
    // so a contact standing one hex off the line is simply unhittable,
    // which is exactly how the Arc Beam managed to be bought and then
    // never once fired in playtesting. Line weapons (the Railgun) stay
    // axial on purpose: firing down an axis IS the weapon.
    if (weapon.spread === "ring") {
      const hexes = [];
      for (let dq = -weapon.range; dq <= weapon.range; dq++) {
        for (let dr = -weapon.range; dr <= weapon.range; dr++) {
          const cand = { q: pos.q + dq, r: pos.r + dr };
          const dist = hexDistance(pos, cand);
          if (dist >= 1 && dist <= weapon.range) hexes.push(cand);
        }
      }
      return hexes;
    }
    // Line weapons stop at the first thing they hit. A slug does not pass
    // through an asteroid, and it does not pass through a hull — so a
    // Railgun Destroyer's six board-length axes are lines you can break
    // by putting rock (or somebody else's ship) between you and it,
    // rather than ambient damage sprayed across the whole board. This is
    // the line-of-sight pass the original Railgun note left for later;
    // playtesting made the case, with runs bleeding two Hull at a time
    // crossing lanes they had no way to see coming.
    const hexes = [];
    for (const offset of weapon.pattern) {
      const dir = (facing + offset + 6) % 6;
      let cur = pos;
      for (let step = 0; step < weapon.range; step++) {
        cur = neighbor(cur, dir);
        hexes.push(cur);
        if (state && blocksShot(state, cur)) break; // it hits this, and stops
      }
    }
    return hexes;
  }

  // What a slug runs into: solid terrain, or any hull that isn't the
  // shooter's own. (The target itself is included before the line stops —
  // the shot hits the first thing in the lane, which is the whole point.)
  function blocksShot(state, hex) {
    if (isBlockingHazard(hazardAt(state, hex))) return true;
    if (enemyAt(state, hex)) return true;
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
  const OUTPOST_OFFER_POOL = [
    { id: "repair", label: "Patch 1 Hull", cost: 5 },
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
    { id: "flakBurst", label: "Flak Burst (2x2 — hits every adjacent contact)", cost: 10 },
    { id: "arcBeam", label: "Arc Beam (2x2 — range 2, kill them on approach)", cost: 8 },
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
      if ((o.id === "flakBurst" || o.id === "arcBeam" || o.id === "railgun") && carried.has(o.id)) return false;
      if (o.id === "shield" && carried.has("shieldGenerator")) return false;
      if (o.id === "railgun") return levelId >= 8;
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
    const picked = ["repair", ...shuffled.slice(0, 2).map((o) => o.id)];
    // A three-Hull ship lives or dies on screens, so a yard will always
    // find you a generator if you're flying without one. Everything else
    // is what they happen to have; this one is the trade that keeps the
    // crawl survivable at all.
    if (!carried.has("shieldGenerator") && !picked.includes("shield")) picked[picked.length - 1] = "shield";
    // Sector 3 is the Sentry Line — the first sector with something that
    // outranges you and won't come to you. The weapon that answers it has
    // to be ON THE SHELF there, not left to the shuffle, or the lesson is
    // just "take two hits and hope".
    if (levelId === 3 && !picked.includes("arcBeam")) picked[picked.length - 1] = "arcBeam";
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
    const candidates = state.boardHexes.filter(
      (h) =>
        !reserved.some((r) => posEq(r, h)) &&
        !hazardAt(state, h) &&
        !state.enemies.some((e) => e.alive && hexDistance(h, e) < 2)
    );
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
      const def = ENEMY_TYPES[enemy.type];
      if (!def || def.movesTowardPlayer) continue;
      if (enemy.energy < def.weapon.energyCost) continue; // discharged: this is the gap you cross in
      for (const hex of weaponHexes(enemy, 0, def.weapon, state)) {
        if (onBoard(state, hex)) zone.add(hexKey(hex));
      }
    }
    return zone;
  }

  function createGameState(level, carryOver) {
    validateLevel(level);
    const maxHull = (carryOver && carryOver.maxHull) || START_HULL;
    // Built before the state literal so the Outpost's shelf can be stocked
    // against what's actually bolted into this ship.
    const hold = buildHold(level, carryOver);
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
      hull: Math.min((carryOver && carryOver.hull) || maxHull, maxHull),
      maxHull: maxHull,
      salvage: (carryOver && carryOver.salvage) || 0,
      // Shields are capacity (installed Shield Generators in the Hold) +
      // charges (raised by spending Energy — see applyRaiseShields).
      // Capacity is derived below; carried charges clamp against it.
      maxShields: 0,
      shieldCharges: (carryOver && carryOver.shieldCharges) || 0,
      maxEnergy: (carryOver && carryOver.maxEnergy) || START_ENERGY,
      energy: (carryOver && carryOver.maxEnergy) || START_ENERGY,
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
          hp: def.hp,
          maxHp: def.hp,
          // Enemies run their own reactors, same rules as the flagship —
          // a Railgun spawns EMPTY and visibly charges toward its first
          // shot (the telegraph), a cost-1 chaser spawns full and fires
          // every turn exactly like it did before energy existed.
          energy: def.startEnergy,
          maxEnergy: def.maxEnergy,
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
        // instantly trip the return trip — wormholeAvailable's turnCount
        // guard below is what actually prevents that surprise, not
        // distance, so literal-same-hex arrival is safe.
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

  // The weapon-system keys the renderer iterates for arming/reach checks —
  // derived from the Hold now (an installed weapon item sets its
  // systems[key] flag in syncHoldDerived), but the key list itself is
  // stable engine data.
  const WEAPON_SYSTEM_KEYS = ["autocannon", "flakBurst", "arcBeam", "railgun"];

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
    return Math.floor((state.levelId || 1) / 4);
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
      const enemyType = ENEMY_TYPES[enemy.type];
      if (!enemyType) continue;
      // A weapon its reactor can't afford this coming enemy phase is no
      // threat yet — a charging Railgun's board-spanning line only lights
      // up on the turn it can actually fire. (Regen happens AFTER the
      // enemy phase, so "can it fire next phase" is just current energy.)
      if (enemy.energy < enemyType.weapon.energyCost) continue;
      for (const hex of weaponHexes(enemy, enemyFacing(state, enemy), enemyType.weapon, state)) {
        if (!onBoard(state, hex)) continue;
        const k = hexKey(hex);
        threats.set(k, (threats.get(k) || 0) + 1);
      }
      // A chaser with 2+ AP can close one hex AND fire in the same enemy
      // phase — its true danger zone this round is one ring wider than
      // where it stands. Every current chaser carries an omnidirectional
      // weapon, so "one ring wider" is exactly distance <= range + 1.
      // (Moot at ENEMY_AP 1 — a 1-AP chaser moves OR fires, never both.)
      if (ENEMY_AP > 1 && enemyType.movesTowardPlayer) {
        const extendedRange = enemyType.weapon.range + 1;
        for (const hex of state.boardHexes) {
          const d = hexDistance(enemy, hex);
          if (d < 1 || d > extendedRange) continue;
          const k = hexKey(hex);
          if (d > enemyType.weapon.range) threats.set(k, (threats.get(k) || 0) + 1);
        }
      }
    }
    return threats;
  }

  // ---- enemy AI -------------------------------------------------------------

  function decideIntent(state, enemy) {
    const enemyType = ENEMY_TYPES[enemy.type];
    if (!enemyType) return { enemyId: enemy.id, type: "wait" };
    // Any enemy — chaser or emplacement — fires the instant the player is
    // standing somewhere its weapon reaches AND its reactor can pay for
    // the shot ("the enemies should be using their own systems"). A
    // charging Railgun holds fire; a cost-1 chaser always affords it.
    const inRange = weaponHexes(enemy, enemyFacing(state, enemy), enemyType.weapon, state).some((h) => posEq(h, state.playerPos));
    if (inRange && enemy.energy >= enemyType.weapon.energyCost) {
      return { enemyId: enemy.id, type: "attack" };
    }
    // Already in reach but the reactor can't pay yet: HOLD, don't shuffle
    // sideways — with 2 AP a round, a chaser that fired its first AP would
    // otherwise spend its second orbiting the flagship, which reads as
    // random. It stays put and lets the reactor climb.
    if (inRange) return { enemyId: enemy.id, type: "wait" };
    // Chasers close the gap; stationary emplacements (a Sentry) just hold and
    // keep their ring of threatened hexes up.
    if (enemyType.movesTowardPlayer) {
      const occupiedNow = new Set(
        state.enemies.filter((e) => e.alive && e.id !== enemy.id).map((e) => hexKey(e))
      );
      const candidates = [];
      for (let i = 0; i < 6; i++) {
        const to = neighbor(enemy, i);
        if (!onBoard(state, to)) continue;
        if (posEq(to, state.playerPos)) continue;
        if (occupiedNow.has(hexKey(to))) continue;
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
        .sort((a, b) => ENEMY_TYPES[b.enemy.type].weapon.speed - ENEMY_TYPES[a.enemy.type].weapon.speed);
      for (const { enemy } of attackers) {
        if (!enemy.alive) continue;
        const weapon = ENEMY_TYPES[enemy.type].weapon;
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
      for (const { enemy, intent } of intents) {
        if (intent.type !== "move" || !enemy.alive) continue;
        state.events.push({ type: "enemyMove", enemyId: enemy.id, from: { q: enemy.q, r: enemy.r }, to: intent.to });
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
    // Enemy reactors tick +1 per ROUND — that rhythm IS their telegraph (a
    // Railgun charges 3 rounds between shots). The flagship gets NO passive
    // regen: your Energy is a budget, refilled to full at each warp jump,
    // recovered mid-fight only via the RECHARGE action.
    for (const enemy of livingEnemies(state)) {
      enemy.energy = Math.min(enemy.maxEnergy, enemy.energy + 1);
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
    // Movement is EQUIPMENT: no installed drive, no flying — the
    // deliberately absurd freedom of the Hold ("you could remove your
    // engines altogether... it wouldn't make any sense because you
    // didn't go anywhere").
    if (!state.hold.items.some((it) => EQUIPMENT[it.id].kind === "engine")) {
      throw new Error("No drive fitted — we are not going anywhere");
    }
    state.events = [];
    if (!isAdjacent(state.playerPos, to)) throw new Error("Too far for one burn");
    if (!onBoard(state, to)) throw new Error("That heading runs off the chart");
    if (enemyAt(state, to)) throw new Error("Something is sitting on that grid");
    if (isBlockingHazard(hazardAt(state, to))) throw new Error("Rock in the way");
    const from = { q: state.playerPos.q, r: state.playerPos.r };
    state.events.push({ type: "playerMove", from, to: { q: to.q, r: to.r } });
    const dir = directionIndex(from, to);
    if (dir >= 0) state.facing = dir;
    state.playerPos = to;
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
  function wormholeAvailable(state) {
    return Boolean(state.wormholePos) && posEq(state.playerPos, state.wormholePos);
  }

  function outpostOffers(state) {
    if (!outpostAvailable(state)) return [];
    return OUTPOST_OFFER_POOL.filter((o) => state.outpostOfferIds.includes(o.id)).map((offer) => ({
      ...offer,
      affordable: state.salvage >= offer.cost,
      applicable: offer.id !== "repair" || state.hull < state.maxHull,
    }));
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
      state.maxHull += 1;
      state.hull += 1;
    } else if (offer.id === "shield") {
      autoPlaceInHold(state.hold, "shieldGenerator");
      syncHoldDerived(state);
      state.shieldCharges = Math.min(state.shieldCharges + 1, state.maxShields); // arrives raised if it fit installed
    } else if (offer.id === "reactor") {
      state.maxEnergy += 1;
      state.energy += 1; // an upgrade should feel immediate, same as Reinforce Hull
    } else if (offer.id === "hardpoint") {
      state.hold.rows += 1; // more internal space — the grid literally grows
    } else if (offer.id === "flakBurst" || offer.id === "arcBeam" || offer.id === "railgun") {
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
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicEngine;
  } else {
    root.HypergolicEngine = HypergolicEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
