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
  const ALL_ACTIONS = ["sublight", "ramming", "tractor", "lance", "repulsor"];
  // Purchase-only actions (see OUTPOST_OFFER_POOL/applyOutpostPurchase) —
  // never part of any level's own baked-in `actions` list, and excluded
  // from the default fallback below so they don't show up for free the
  // moment a level omits `actions`. Tractor Beam moved into this bucket
  // per Clubhouse feedback ("you should not start with it") — it's still
  // guaranteed claimable (free) at Sector 2's Outpost specifically (see
  // pickOutpostOfferIds), just no longer handed out automatically for
  // reaching the sector.
  const PURCHASABLE_ACTIONS = ["lance", "repulsor", "tractor"];
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
  // How many weapon-slot points of systems the flagship starts with —
  // grown via the Hardpoint Expansion Outpost offer.
  const START_WEAPON_SLOTS = 2;

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
  // toggled on — enforced against state.weaponSlots (see setSystem).
  // A former `speed` stat was displayed here for a while but read by zero
  // combat code — deleted rather than shipped as fake depth.
  const ALL_DIRECTIONS_PATTERN = [0, 1, 2, 3, 4, 5];
  const WEAPONS = {
    // The free auto-weapon now fires in ALL six directions (an encircling
    // blast), not just the forward three — so it defends you from every side
    // after a move, no aiming required. Renamed to the Shockwave to match.
    // Costs 2 against +1/turn regen — every firing turn nets -1, so even
    // the free starting weapon visibly draws down the reactor and combat
    // has a fuel gauge.
    ram: { id: "ram", label: "Shockwave", range: 1, damage: 1, targets: "all", energyCost: 2, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    interceptorCannon: { id: "interceptorCannon", label: "Interceptor Cannon", range: 1, damage: 1, targets: "all", energyCost: 1, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // A Sentry Turret's beam reaches TWO hexes in every direction — it never
    // moves, but it zones off a wide ring you have to route around or kill.
    sentryBeam: { id: "sentryBeam", label: "Sentry Beam", range: 2, damage: 1, targets: "all", energyCost: 1, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // A trade, not a strict upgrade over the Shockwave's omnidirectional
    // safety: hits harder and at range, but only dead ahead — you have to
    // manage `facing` to line it up (toggle Warpdrive off, tap an adjacent
    // hex to aim, Hold Position to fire — infrastructure already built for
    // exactly this). Purchased at an Outpost (see OUTPOST_OFFER_POOL), not
    // unlocked for free by reaching a sector. Costs 3 — the hardest
    // hitter is also the thirstiest.
    lance: { id: "lance", label: "Lance Cannon", range: 3, damage: 2, targets: "all", energyCost: 3, pattern: [0], slots: 1 },
    // Double-edged on purpose (Clubhouse: "make that bad or good depending
    // [how it's used]"): weaker than the Shockwave hit-for-hit, but every
    // surviving target gets shoved a hex directly away from the flagship
    // (see pushEnemyInDirection) — can save you a follow-up hit by knocking
    // a threat out of adjacency, or shove a low-HP target out of the very
    // range you needed to finish it off. Also purchased at an Outpost.
    repulsor: { id: "repulsor", label: "Repulsor", range: 1, damage: 1, targets: "all", energyCost: 2, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // Not an auto-fire weapon (see AUTO_FIRE_WEAPONS below) — Tractor Beam
    // is player-armed-and-aimed (applyTractor), adjacent range in any of
    // the 6 directions. Modeled here anyway so its stats badge (app.js)
    // reads off real data instead of a hand-copied duplicate, same as
    // every other weapon. `damage: 0` because it destroys via collision
    // physics (pushEnemyInDirection: off the edge, into another unit, or
    // into a hazard), not a direct hit. `slots: 0`: an armed-and-aimed
    // action you spend a turn on, not a system left running — it charges
    // energy per use but never occupies a weapon slot.
    tractor: { id: "tractor", label: "Tractor Beam", range: 1, damage: 0, targets: "push", energyCost: 2, pattern: ALL_DIRECTIONS_PATTERN, slots: 0 },
    // The original design doc's Railgun Destroyer ("fires a straight-line
    // slug down any of the 6 hex axes, unlimited range... telegraphs the
    // line one turn before firing"). The telegraph is now real and comes
    // straight from the energy system: cost 3 against a +1/turn regen
    // means it visibly charges for 3 turns between shots (see the Railgun
    // entry in ENEMY_TYPES), instead of firing board-spanning shots every
    // single turn. Still no line-of-sight blocking by intervening units —
    // left for a later pass if it needs more texture.
    railgunBeam: { id: "railgunBeam", label: "Railgun", range: 20, damage: 1, targets: "all", energyCost: 3, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
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
  const ENEMY_TYPES = {
    interceptor: { hp: 1, weapon: WEAPONS.interceptorCannon, movesTowardPlayer: true, salvage: 1, maxEnergy: 1, startEnergy: 1 },
    cruiser: { hp: 2, weapon: WEAPONS.interceptorCannon, movesTowardPlayer: true, salvage: 2, maxEnergy: 1, startEnergy: 1 },
    sentry: { hp: 2, weapon: WEAPONS.sentryBeam, movesTowardPlayer: false, salvage: 2, maxEnergy: 1, startEnergy: 1 },
    railgun: { hp: 2, weapon: WEAPONS.railgunBeam, movesTowardPlayer: false, salvage: 3, maxEnergy: 3, startEnergy: 0 },
  };

  // Every hex a weapon's pattern actually reaches, fired from `pos` facing
  // hex-direction `facing` (0-5) — each pattern offset traces a straight
  // line out to `range` hexes in that (facing + offset) direction. `facing`
  // is irrelevant for an omnidirectional pattern (it already covers every
  // direction regardless of which one is "ahead"), so callers that don't
  // track a facing (enemies, today) can pass anything, e.g. 0.
  function weaponHexes(pos, facing, weapon) {
    const hexes = [];
    for (const offset of weapon.pattern) {
      const dir = (facing + offset + 6) % 6;
      let cur = pos;
      for (let step = 0; step < weapon.range; step++) {
        cur = neighbor(cur, dir);
        hexes.push(cur);
      }
    }
    return hexes;
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
  const OUTPOST_OFFER_POOL = [
    { id: "repair", label: "Repair 1 Hull", cost: 3 },
    { id: "reinforce", label: "Reinforce Hull (+1 Max)", cost: 15 },
    { id: "shield", label: "Emergency Shield (absorb the next hit)", cost: 10 },
    // The two "configurable limits" as purchases: your reactor cap (how
    // much Energy you can bank against expensive weapons) and your weapon
    // slots (how many systems can run at once) are both ship stats you
    // grow at Outposts, not constants.
    { id: "reactor", label: "Reactor Upgrade (+1 Max Energy)", cost: 12 },
    { id: "hardpoint", label: "Hardpoint Expansion (+1 weapon slot)", cost: 20 },
    { id: "lanceCannon", label: "Lance Cannon (forward-only, 2 dmg, range 3)", cost: 25 },
    { id: "repulsorWeapon", label: "Repulsor (all sides, 1 dmg + knockback)", cost: 20 },
    // Free — this is a claim, not a purchase. Never part of the general
    // per-level random pool (see pickOutpostOfferIds); it only ever
    // appears at Sector 2's Outpost, guaranteed, since that's the
    // campaign's one intended entry point for it.
    { id: "tractorBeam", label: "Tractor Beam (adjacent, push to destroy)", cost: 0 },
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
  function pickOutpostOfferIds(levelId) {
    const extras = OUTPOST_OFFER_POOL.filter((o) => o.id !== "repair" && o.id !== "tractorBeam");
    const rng = seededRandom(levelId * 7919 + 13);
    const shuffled = extras.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    const extraCount = Math.floor(rng() * (extras.length + 1)); // 0..extras.length
    const picked = ["repair", ...shuffled.slice(0, extraCount).map((o) => o.id)];
    // Sector 2's Outpost is the one guaranteed place to claim the Tractor
    // Beam — not left to the same per-level randomization as every other
    // offer (Clubhouse: "you should not start with it").
    if (levelId === 2) picked.push("tractorBeam");
    return picked;
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

  function createGameState(level, carryOver) {
    validateLevel(level);
    const maxHull = (carryOver && carryOver.maxHull) || START_HULL;
    const state = {
      levelId: level.id,
      levelName: level.name || `Sector ${level.id}`,
      radius: level.radius || null,
      boardHexes: buildBoardHexes(level),
      // `carryOver.extraActions` is how a purchase like the Lance Cannon
      // (never part of any level's own baked-in `actions` list — see
      // DEFAULT_ACTIONS) survives into the next sector; app.js's
      // advanceSector is what actually carries it forward.
      actions: Array.from(new Set([...(level.actions || DEFAULT_ACTIONS), ...((carryOver && carryOver.extraActions) || [])])),
      playerPos: { q: level.playerStart.q, r: level.playerStart.r },
      hull: maxHull,
      maxHull: maxHull,
      salvage: (carryOver && carryOver.salvage) || 0,
      shieldCharges: (carryOver && carryOver.shieldCharges) || 0,
      maxEnergy: (carryOver && carryOver.maxEnergy) || START_ENERGY,
      energy: (carryOver && carryOver.maxEnergy) || START_ENERGY,
      exitPos: { q: exitList(level)[0].q, r: exitList(level)[0].r }, // primary/first gate — kept for single-exit callers
      exits: exitList(level).map((ex) => ({ q: ex.q, r: ex.r, variantId: ex.variantId || null })),
      usedExitVariant: null, // set on win — see endPlayerAction — which gate you actually flew through
      // "How do you win, or is it just runs?" — a boss sector (see
      // levels.js's bossLevel) clearing is a real "Run Complete" milestone,
      // not a routine sector clear. isVictory flips true the instant it's
      // won (see endPlayerAction) — app.js checks it to show a distinct
      // overlay instead of silently auto-continuing like every other clear.
      isBoss: Boolean(level.isBoss),
      isVictory: false,
      outpostPos: level.outpost ? { q: level.outpost.q, r: level.outpost.r } : null,
      outpostOfferIds: level.outpost ? pickOutpostOfferIds(level.id) : [],
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
      // How many weapon-slot points of systems can run at once (each
      // WEAPONS entry's `slots` counts against it while toggled on) —
      // ship data, grown via the Hardpoint Expansion Outpost offer, not a
      // hardcoded constant.
      weaponSlots: (carryOver && carryOver.weaponSlots) || START_WEAPON_SLOTS,
      // Pre-turn system toggles: Warpdrive governs whether you can move at
      // all this turn (off means Hold Position is your only option); the
      // rest gate their matching AUTO_FIRE_WEAPONS entry, inert until
      // purchased but present from the start so a later purchase has
      // something to flip. All default on.
      systems: { warpdrive: true, ram: true, lance: true, repulsor: true },
      // Direction index (0-5) the flagship is currently facing — gameplay-
      // relevant now, not just cosmetic, since a directional weapon's
      // pattern is relative to it. Updated on every Sublight move; starts
      // facing direction 2 ({q:0,r:-1}), i.e. "up" toward the Warp Gate on
      // every board's bottom-to-top layout.
      facing: 2,
      turnCount: 0,
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
        // would otherwise let the very next action (e.g. Hold Position)
        // instantly trip the return trip — wormholeAvailable's turnCount
        // guard below is what actually prevents that surprise, not
        // distance, so literal-same-hex arrival is safe.
        state.wormholePos = portalPos;
        state.playerPos = { q: portalPos.q, r: portalPos.r };
      }
    }
    if (level.intro) pushLog(state, level.intro);
    checkExitUnlock(state); // an enemy-free tutorial board starts with the gate online
    // Every weapon system defaults to systems[key] === true (including
    // Lance/Repulsor before they're even owned — see the comment on the
    // `systems` field above). Once a flagship actually owns 3+ of them
    // (Lance and Repulsor both purchased, carried into a new sector via
    // carryOver.extraActions), that default would silently put every one
    // of them "active" at once, over the slot cap, without ever going
    // through setSystem. Clamp it down here too, not just in setSystem.
    clampWeaponSystems(state);
    return state;
  }

  // "There should be rules about what you can equip" (Clubhouse) — the
  // toggle-fired weapon systems compete for state.weaponSlots: each one's
  // WEAPONS[key].slots counts against the ship's total while it's on.
  // Doesn't touch Tractor Beam (an armed-and-aimed one-off action, slots
  // 0) or Warpdrive (movement, not a weapon).
  const WEAPON_SYSTEM_KEYS = ["ram", "lance", "repulsor"];

  // Slot points currently in use by owned, toggled-on weapon systems.
  // `except` (optional) leaves one key out — setSystem uses it to ask
  // "what's everyone ELSE using?" before approving a toggle-on.
  function usedWeaponSlots(state, except) {
    return WEAPON_SYSTEM_KEYS.filter(
      (k) => k !== except && state.systems[k] && (k === "ram" || state.actions.includes(k))
    ).reduce((sum, k) => sum + WEAPONS[k].slots, 0);
  }

  // Disables active-but-owned weapon systems beyond the ship's slot
  // capacity, keeping earlier WEAPON_SYSTEM_KEYS entries (Shockwave wins
  // ties over Lance/Repulsor, arbitrary but deterministic). Used wherever
  // ownership or the default-on systems block can put more slots "active"
  // than the ship has, without ever going through setSystem's own check.
  function clampWeaponSystems(state) {
    const owned = WEAPON_SYSTEM_KEYS.filter((k) => k === "ram" || state.actions.includes(k));
    let slotsLeft = state.weaponSlots;
    for (const k of owned) {
      if (!state.systems[k]) continue;
      if (WEAPONS[k].slots <= slotsLeft) slotsLeft -= WEAPONS[k].slots;
      else state.systems[k] = false;
    }
  }

  function setSystem(state, key, enabled) {
    if (!(key in state.systems)) throw new Error(`Unknown system: ${key}`);
    if (enabled && WEAPON_SYSTEM_KEYS.includes(key)) {
      // Unowned weapons still default to systems[key] === true (see
      // createGameState) since they simply don't fire until purchased/
      // claimed — usedWeaponSlots only counts ones actually unlocked
      // (ram is always available; the rest need state.actions).
      if (usedWeaponSlots(state, key) + WEAPONS[key].slots > state.weaponSlots) {
        throw new Error(
          `Weapon slots full (${usedWeaponSlots(state, key)}/${state.weaponSlots}) — toggle another weapon off first`
        );
      }
    }
    state.systems[key] = Boolean(enabled);
  }

  // Re-aims the flagship without moving or ending the turn — free to call as
  // many times as you like (no events, no enemy phase). This is what lets
  // you dial in a forward-only weapon's direction while Warpdrive is
  // offline: rotate to face where you want, then commit with Hold Position.
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
  function awardSalvage(state, enemyType) {
    const amount = (ENEMY_TYPES[enemyType] || {}).salvage || 0;
    if (amount <= 0) return;
    state.salvage += amount;
    state.events.push({ type: "salvage", amount });
    pushLog(state, `+${amount} salvage.`);
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
      for (const hex of weaponHexes(enemy, 0, enemyType.weapon)) {
        if (!onBoard(state, hex)) continue;
        const k = hexKey(hex);
        threats.set(k, (threats.get(k) || 0) + 1);
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
    const inRange = weaponHexes(enemy, 0, enemyType.weapon).some((h) => posEq(h, state.playerPos));
    if (inRange && enemy.energy >= enemyType.weapon.energyCost) {
      return { enemyId: enemy.id, type: "attack" };
    }
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
      pushLog(state, "Warp Gate online.");
    }
  }

  function checkPlayerHazard(state) {
    if (hazardAt(state, state.playerPos)) {
      state.hull = 0;
      state.status = "lost";
      pushLog(state, "Flagship destroyed.");
    }
  }

  function enemyPhase(state) {
    const intents = livingEnemies(state).map((enemy) => decideIntent(state, enemy));
    let totalDamage = 0;
    for (const intent of intents) {
      const enemy = state.enemies.find((e) => e.id === intent.enemyId);
      if (!enemy || !enemy.alive) continue;
      if (intent.type === "attack") {
        const weapon = ENEMY_TYPES[enemy.type].weapon;
        enemy.energy -= weapon.energyCost; // same rule as the flagship: every shot is paid for
        totalDamage += weapon.damage;
        state.events.push({ type: "attack", enemyId: enemy.id, q: enemy.q, r: enemy.r });
      } else if (intent.type === "move") {
        state.events.push({ type: "enemyMove", enemyId: enemy.id, from: { q: enemy.q, r: enemy.r }, to: intent.to });
        enemy.q = intent.to.q;
        enemy.r = intent.to.r;
      }
    }
    if (totalDamage > 0 && state.shieldCharges > 0) {
      state.shieldCharges -= 1;
      state.events.push({ type: "shieldAbsorb", q: state.playerPos.q, r: state.playerPos.r });
      pushLog(state, `Emergency Shield absorbed ${totalDamage} damage.`);
    } else if (totalDamage > 0) {
      state.hull = Math.max(0, state.hull - totalDamage);
      state.events.push({ type: "damage", amount: totalDamage, q: state.playerPos.q, r: state.playerPos.r });
      pushLog(state, `Took ${totalDamage} damage.`);
    }
    state.turnCount += 1;
    // Reactors tick together: the flagship and every living enemy regen
    // +1 Energy at the end of the enemy phase. This is what turns a heavy
    // weapon's cost into a visible rhythm — a Railgun that just fired (or
    // just spawned empty) charges back up 1 per turn toward its next shot.
    state.energy = Math.min(state.maxEnergy, state.energy + 1);
    for (const enemy of livingEnemies(state)) {
      enemy.energy = Math.min(enemy.maxEnergy, enemy.energy + 1);
    }
    if (state.hull <= 0) {
      state.status = "lost";
      state.events.push({ type: "playerDeath", q: state.playerPos.q, r: state.playerPos.r });
      pushLog(state, "Flagship destroyed.");
    }
  }

  // ---- turn resolution --------------------------------------------------
  //
  // Strict order (§7 of the design doc): player action resolves fully
  // (including instant kills) BEFORE enemy AI decides against the new
  // state; enemies then move/attack; only then is damage/death/exit
  // resolved. All player actions funnel through here after mutating state.
  function endPlayerAction(state) {
    checkExitUnlock(state);
    if (state.status !== "playing") return;
    enemyPhase(state);
    if (state.status !== "playing") return;
    checkExitUnlock(state);
    const usedExit = state.exits.find((e) => posEq(state.playerPos, e));
    if (usedExit && state.exitUnlocked) {
      state.status = "won";
      state.usedExitVariant = usedExit.variantId;
      if (state.isBoss) {
        state.isVictory = true;
        pushLog(state, "The Bulwark falls. Run Complete.");
      } else {
        pushLog(state, "Level complete.");
      }
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
  // relocates. Shared by Tractor Beam (direction derived from the
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

  // Every player weapon that fires automatically (as opposed to Tractor
  // Beam, which the player arms and aims at a target
  // directly) — each pairs an `actions` id (permanently unlocked, whether
  // by campaign progression or an Outpost purchase) with a `state.systems`
  // toggle key (pre-turn on/off) and its WEAPONS stat block. Adding a new
  // auto-fire weapon is adding one entry here, not new bespoke firing code.
  // `onHit` is optional — the Repulsor uses it to shove a surviving target
  // away (see pushEnemyInDirection); most weapons just damage.
  const AUTO_FIRE_WEAPONS = [
    { action: "ramming", systemKey: "ram", weapon: WEAPONS.ram },
    { action: "lance", systemKey: "lance", weapon: WEAPONS.lance },
    {
      action: "repulsor",
      systemKey: "repulsor",
      weapon: WEAPONS.repulsor,
      onHit: (state, victim) => pushEnemyInDirection(state, victim, directionIndex(state.playerPos, victim), "Repulsor"),
    },
  ];

  // Fires every currently-enabled, unlocked weapon against any living enemy
  // in its range, in front of the enemy phase — same timing Ramming Speed
  // always resolved on (instant, before enemies get to react). Called after
  // any move (or Hold Position), never armed/aimed separately. What it can
  // actually hit is purely a function of the weapon's own pattern and the
  // flagship's current facing (weaponHexes) — a forward-only cannon (the
  // Lance Cannon) only ever threatens the hex directly ahead, so sidestepping
  // past an enemy without ending up with it dead ahead just doesn't line up
  // a shot, no separate "did you approach it" check needed. Facing carries
  // over from the last move for Hold Position, so holding still only fires
  // on whatever's ahead of wherever you were already facing.
  function applyWeaponAutoAttacks(state) {
    for (const { action, systemKey, weapon, onHit } of AUTO_FIRE_WEAPONS) {
      if (!state.actions.includes(action) || !state.systems[systemKey]) continue;
      const hexKeys = new Set(weaponHexes(state.playerPos, state.facing, weapon).map(hexKey));
      // Snapshot targets before firing — an onHit push can move a later
      // target's hex out from under a hexKeys check made after the fact,
      // and definitely shouldn't let one weapon's push feed another
      // target into (or out of) this same volley's hit list.
      const targets = livingEnemies(state).filter((e) => hexKeys.has(hexKey(e)));
      if (targets.length === 0) continue; // nothing in range — no shot, no energy spent
      // Every shot is paid for. A weapon that would have fired but can't
      // afford its cost holds fire — logged so the silence is explained,
      // but only when it actually had a target (no spam on empty turns).
      // Weapons fire in AUTO_FIRE_WEAPONS order, so with a low reactor the
      // Shockwave gets first claim on what's left.
      if (state.energy < weapon.energyCost) {
        pushLog(state, `${weapon.label} holds fire — not enough Energy (${state.energy}/${weapon.energyCost}).`);
        continue;
      }
      state.energy -= weapon.energyCost;
      state.events.push({ type: "energySpend", amount: weapon.energyCost, weapon: weapon.label });
      for (const victim of targets) {
        if (!victim.alive) continue; // an earlier target's push/collision in this same volley already took it out
        victim.hp -= weapon.damage;
        if (victim.hp <= 0) {
          victim.alive = false;
          state.events.push({ type: "kill", q: victim.q, r: victim.r, victim: victim.type, source: "weapon" });
          pushLog(state, `${weapon.label} destroyed ${victim.type}.`);
          awardSalvage(state, victim.type);
        } else {
          state.events.push({ type: "hit", q: victim.q, r: victim.r, source: "weapon" });
          pushLog(state, `${weapon.label} hit ${victim.type} (${victim.hp}/${victim.maxHp} HP left).`);
          if (onHit) onHit(state, victim);
        }
      }
    }
  }

  function applySublight(state, to) {
    assertPlaying(state);
    if (!state.systems.warpdrive) throw new Error("Warpdrive: offline — toggle it on, or use Hold Position instead");
    state.events = [];
    if (!isAdjacent(state.playerPos, to)) throw new Error("Sublight Impulse: destination is not adjacent");
    if (!onBoard(state, to)) throw new Error("Sublight Impulse: destination is off the map");
    if (enemyAt(state, to)) throw new Error("Sublight Impulse: destination is occupied");
    if (isBlockingHazard(hazardAt(state, to))) throw new Error("Sublight Impulse: blocked by an asteroid field");
    const from = { q: state.playerPos.q, r: state.playerPos.r };
    state.events.push({ type: "playerMove", from, to: { q: to.q, r: to.r } });
    const dir = directionIndex(from, to);
    if (dir >= 0) state.facing = dir;
    state.playerPos = to;
    applyWeaponAutoAttacks(state);
    checkPlayerHazard(state);
    if (state.status !== "playing") return;
    endPlayerAction(state);
  }

  // Ends the turn in place — the only way to act while Warpdrive is toggled
  // off, and otherwise just a way to let an armed weapon fire without moving.
  function applyHoldPosition(state) {
    assertPlaying(state);
    state.events = [];
    applyWeaponAutoAttacks(state);
    checkPlayerHazard(state);
    if (state.status !== "playing") return;
    endPlayerAction(state);
  }

  function applyTractor(state, targetEnemyId) {
    assertPlaying(state);
    assertUnlocked(state, "tractor", "Tractor Beam");
    // An armed-and-aimed action, but it still draws from the same reactor
    // as everything else ("make everything work within the system").
    if (state.energy < WEAPONS.tractor.energyCost) {
      throw new Error(`Tractor Beam: not enough Energy (${state.energy}/${WEAPONS.tractor.energyCost})`);
    }
    state.events = [];
    const enemy = state.enemies.find((e) => e.id === targetEnemyId && e.alive);
    if (!enemy) throw new Error("Tractor Beam: no such enemy");
    if (!isAdjacent(state.playerPos, enemy)) throw new Error("Tractor Beam: enemy is not adjacent");
    state.energy -= WEAPONS.tractor.energyCost;
    state.events.push({ type: "energySpend", amount: WEAPONS.tractor.energyCost, weapon: WEAPONS.tractor.label });
    pushEnemyInDirection(state, enemy, directionIndex(state.playerPos, enemy), "Tractor");
    endPlayerAction(state);
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
    if (state.salvage < offer.cost) throw new Error(`Outpost: not enough salvage for ${offer.label}`);
    state.events = [];
    if (offer.id === "repair") {
      if (state.hull >= state.maxHull) throw new Error("Outpost: Hull is already full");
      state.hull += 1;
    } else if (offer.id === "reinforce") {
      state.maxHull += 1;
      state.hull += 1;
    } else if (offer.id === "shield") {
      state.shieldCharges += 1;
    } else if (offer.id === "reactor") {
      state.maxEnergy += 1;
      state.energy += 1; // an upgrade should feel immediate, same as Reinforce Hull
    } else if (offer.id === "hardpoint") {
      state.weaponSlots += 1;
    } else if (offer.id === "lanceCannon") {
      if (!state.actions.includes("lance")) state.actions.push("lance");
      clampWeaponSystems(state); // owning a 3rd weapon system can't put all 3 "active" at once
    } else if (offer.id === "repulsorWeapon") {
      if (!state.actions.includes("repulsor")) state.actions.push("repulsor");
      clampWeaponSystems(state);
    } else if (offer.id === "tractorBeam") {
      if (!state.actions.includes("tractor")) state.actions.push("tractor");
    }
    state.salvage -= offer.cost;
    pushLog(
      state,
      offer.cost > 0 ? `Outpost: bought ${offer.label} (-${offer.cost} salvage).` : `Outpost: claimed ${offer.label}.`
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

  function legalTractorTargets(state) {
    if (!state.actions.includes("tractor")) return [];
    return livingEnemiesAdjacentTo(state, state.playerPos);
  }

  // ---- exports --------------------------------------------------------------

  const HypergolicEngine = {
    DIRECTIONS,
    ALL_ACTIONS,
    PURCHASABLE_ACTIONS,
    WEAPON_SYSTEM_KEYS,
    usedWeaponSlots,
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
    validateLevel,
    createGameState,
    setSystem,
    setFacing,
    computeThreatHexes,
    applySublight,
    applyHoldPosition,
    applyTractor,
    outpostAvailable,
    outpostOffers,
    applyOutpostPurchase,
    wormholeAvailable,
    legalSublightTargets,
    legalTractorTargets,
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
