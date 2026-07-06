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

  const ALL_ACTIONS = ["sublight", "ramming", "tractor", "fighter", "blink"];

  // ---- level validation ---------------------------------------------------

  function validateLevel(level) {
    const hexes = buildBoardHexes(level);
    const keys = new Set(hexes.map(hexKey));
    const isBorder = (pos) => neighbors(pos).some((n) => !keys.has(hexKey(n)));
    const mustBeOn = (label, pos) => {
      if (!keys.has(hexKey(pos))) throw new Error(`Level ${level.id}: ${label} at ${hexKey(pos)} is off the board`);
    };

    mustBeOn("playerStart", level.playerStart);
    mustBeOn("exit", level.exit);
    if (!isBorder(level.exit)) {
      throw new Error(`Level ${level.id}: exit is not on the board's edge`);
    }
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
      { label: "exit", pos: level.exit },
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
  // on its own, 1 per turn, and pays for active abilities like Random
  // Blink. ("Energy refills between jumps. Health does not" — long-
  // standing Clubhouse design intent, unbuilt until now.)
  const START_ENERGY = 3;

  // ---- weapon systems ---------------------------------------------------
  //
  // The same stat block (range/damage/targets/speed/energyCost/pattern)
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
  // "ahead"). `slots` is how many system-loadout slots the weapon occupies
  // when equipped — not enforced anywhere yet (there's only one player
  // weapon so far, nothing to compete for a slot), just modeled so a future
  // capacity limit (and things like shields sharing the same slot pool)
  // don't need a data-model change to add.
  const ALL_DIRECTIONS_PATTERN = [0, 1, 2, 3, 4, 5];
  const WEAPONS = {
    // The free auto-weapon now fires in ALL six directions (an encircling
    // blast), not just the forward three — so it defends you from every side
    // after a move, no aiming required. Renamed to the Shockwave to match.
    ram: { id: "ram", label: "Shockwave", range: 1, damage: 1, targets: "all", speed: 2, energyCost: 0, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    interceptorCannon: { id: "interceptorCannon", label: "Interceptor Cannon", range: 1, damage: 1, targets: "all", speed: 1, energyCost: 0, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
    // A Sentry Turret's beam reaches TWO hexes in every direction — it never
    // moves, but it zones off a wide ring you have to route around or kill.
    sentryBeam: { id: "sentryBeam", label: "Sentry Beam", range: 2, damage: 1, targets: "all", speed: 1, energyCost: 0, pattern: ALL_DIRECTIONS_PATTERN, slots: 1 },
  };

  // Each enemy type is its own small data block: how tough it is (hp), what
  // it hits back with (a WEAPONS entry), and how it moves. Adding a new
  // enemy is adding an entry here, not new bespoke combat code.
  //   interceptor — the basic chaser: 1 Hull, strikes adjacent, closes in.
  //   cruiser     — a heavy: 2 Hull (takes two hits), otherwise chases like
  //                 an interceptor. Distinct threat because it survives a ram.
  //   sentry      — a stationary gun platform: 2 Hull, never moves, but its
  //                 beam covers a 2-hex ring, controlling space instead of
  //                 chasing. Approach it wrong and it fires; kill it or go
  //                 around.
  // `salvage` is how much scrap a kill drops, regardless of which action
  // lands it (weapon, Tractor Beam, or Fighter Squadron) — spendable at a
  // Sector Outpost. Tougher hulls drop more.
  const ENEMY_TYPES = {
    interceptor: { hp: 1, weapon: WEAPONS.interceptorCannon, movesTowardPlayer: true, salvage: 1 },
    cruiser: { hp: 2, weapon: WEAPONS.interceptorCannon, movesTowardPlayer: true, salvage: 2 },
    sentry: { hp: 2, weapon: WEAPONS.sentryBeam, movesTowardPlayer: false, salvage: 2 },
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
  const OUTPOST_OFFER_POOL = [
    { id: "repair", label: "Repair 1 Hull", cost: 2 },
    { id: "reinforce", label: "Reinforce Hull (+1 Max)", cost: 5 },
    { id: "shield", label: "Emergency Shield (absorb the next hit)", cost: 4 },
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

  function pickOutpostOfferIds(levelId) {
    const extras = OUTPOST_OFFER_POOL.filter((o) => o.id !== "repair");
    const rng = seededRandom(levelId * 7919 + 13);
    const pick = extras[Math.floor(rng() * extras.length)];
    return ["repair", pick.id];
  }

  function createGameState(level, carryOver) {
    validateLevel(level);
    const maxHull = (carryOver && carryOver.maxHull) || START_HULL;
    const state = {
      levelId: level.id,
      levelName: level.name || `Sector ${level.id}`,
      radius: level.radius || null,
      boardHexes: buildBoardHexes(level),
      actions: (level.actions || ALL_ACTIONS).slice(),
      playerPos: { q: level.playerStart.q, r: level.playerStart.r },
      hull: maxHull,
      maxHull: maxHull,
      salvage: (carryOver && carryOver.salvage) || 0,
      shieldCharges: (carryOver && carryOver.shieldCharges) || 0,
      maxEnergy: (carryOver && carryOver.maxEnergy) || START_ENERGY,
      energy: (carryOver && carryOver.maxEnergy) || START_ENERGY,
      exitPos: { q: level.exit.q, r: level.exit.r },
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
        };
      }),
      fighterHex: null,
      rammingDisabled: false,
      // Pre-turn system toggles: Warpdrive governs whether you can move at
      // all this turn (off means Hold Position is your only option); Ram
      // governs whether the Impulse Cannon auto-fires. Both default on.
      systems: { warpdrive: true, ram: true },
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
    };
    if (level.intro) pushLog(state, level.intro);
    checkExitUnlock(state); // an enemy-free tutorial board starts with the gate online
    return state;
  }

  function setSystem(state, key, enabled) {
    if (!(key in state.systems)) throw new Error(`Unknown system: ${key}`);
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
    // standing somewhere its weapon reaches.
    const inRange = weaponHexes(enemy, 0, enemyType.weapon).some((h) => posEq(h, state.playerPos));
    if (inRange) {
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
        totalDamage += ENEMY_TYPES[enemy.type].weapon.damage;
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
    state.energy = Math.min(state.maxEnergy, state.energy + 1);
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
    if (posEq(state.playerPos, state.exitPos) && state.exitUnlocked) {
      state.status = "won";
      pushLog(state, "Level complete.");
    }
  }

  function handleFighterRetrieval(state) {
    if (state.fighterHex && posEq(state.playerPos, state.fighterHex)) {
      state.fighterHex = null;
      state.rammingDisabled = false;
      pushLog(state, "Fighter squadron retrieved.");
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

  // Fires every currently-enabled, unlocked weapon against any living enemy
  // in its range, in front of the enemy phase — same timing Ramming Speed
  // always resolved on (instant, before enemies get to react). Called after
  // any move (or Hold Position), never armed/aimed separately. What it can
  // actually hit is purely a function of the weapon's own pattern and the
  // flagship's current facing (weaponHexes) — a forward-only cannon (today's
  // Impulse Cannon) only ever threatens the hex directly ahead, so sidestepping
  // past an enemy without ending up with it dead ahead just doesn't line up
  // a shot, no separate "did you approach it" check needed. Facing carries
  // over from the last move for Hold Position, so holding still only fires
  // on whatever's ahead of wherever you were already facing.
  function applyWeaponAutoAttacks(state) {
    if (state.rammingDisabled) return; // fighters deployed — weapon offline until retrieved
    if (!state.actions.includes("ramming") || !state.systems.ram) return;
    const weapon = WEAPONS.ram;
    const hexKeys = new Set(weaponHexes(state.playerPos, state.facing, weapon).map(hexKey));
    const targets = livingEnemies(state).filter((e) => hexKeys.has(hexKey(e)));
    for (const victim of targets) {
      victim.hp -= weapon.damage;
      if (victim.hp <= 0) {
        victim.alive = false;
        state.events.push({ type: "kill", q: victim.q, r: victim.r, victim: victim.type, source: "weapon" });
        pushLog(state, `${weapon.label} destroyed ${victim.type}.`);
        awardSalvage(state, victim.type);
      } else {
        state.events.push({ type: "hit", q: victim.q, r: victim.r, source: "weapon" });
        pushLog(state, `${weapon.label} hit ${victim.type} (${victim.hp}/${victim.maxHp} HP left).`);
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
    const from = { q: state.playerPos.q, r: state.playerPos.r };
    state.events.push({ type: "playerMove", from, to: { q: to.q, r: to.r } });
    const dir = directionIndex(from, to);
    if (dir >= 0) state.facing = dir;
    state.playerPos = to;
    handleFighterRetrieval(state);
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
    state.events = [];
    const enemy = state.enemies.find((e) => e.id === targetEnemyId && e.alive);
    if (!enemy) throw new Error("Tractor Beam: no such enemy");
    if (!isAdjacent(state.playerPos, enemy)) throw new Error("Tractor Beam: enemy is not adjacent");
    const dir = directionIndex(state.playerPos, enemy);
    const dest = neighbor(enemy, dir);
    if (!onBoard(state, dest)) {
      enemy.alive = false;
      state.events.push({ type: "kill", q: dest.q, r: dest.r, victim: enemy.type });
      pushLog(state, `Tractor-pushed ${enemy.type} off the map edge.`);
      awardSalvage(state, enemy.type);
    } else {
      const blocker = enemyAt(state, dest);
      const hazard = hazardAt(state, dest);
      if (blocker) {
        enemy.alive = false;
        blocker.alive = false;
        state.events.push({ type: "kill", q: dest.q, r: dest.r, victim: enemy.type });
        state.events.push({ type: "kill", q: blocker.q, r: blocker.r, victim: blocker.type });
        pushLog(state, `Tractor-pushed ${enemy.type} into ${blocker.type} — both destroyed.`);
        awardSalvage(state, enemy.type);
        awardSalvage(state, blocker.type);
      } else if (hazard) {
        enemy.alive = false;
        state.events.push({ type: "kill", q: dest.q, r: dest.r, victim: enemy.type });
        pushLog(state, `Tractor-pushed ${enemy.type} into a hazard.`);
        awardSalvage(state, enemy.type);
      } else {
        state.events.push({ type: "enemyMove", enemyId: enemy.id, from: { q: enemy.q, r: enemy.r }, to: dest });
        enemy.q = dest.q;
        enemy.r = dest.r;
        pushLog(state, `Tractor-pushed ${enemy.type}.`);
      }
    }
    endPlayerAction(state);
  }

  function applyFighter(state, targetEnemyId) {
    assertPlaying(state);
    assertUnlocked(state, "fighter", "Fighter Squadron");
    state.events = [];
    if (state.fighterHex) throw new Error("Fighter Squadron: already deployed — retrieve them first");
    const enemy = state.enemies.find((e) => e.id === targetEnemyId && e.alive);
    if (!enemy) throw new Error("Fighter Squadron: no such enemy");
    enemy.alive = false;
    state.fighterHex = { q: enemy.q, r: enemy.r };
    state.rammingDisabled = true;
    state.events.push({ type: "kill", q: enemy.q, r: enemy.r, victim: enemy.type });
    pushLog(state, `Fighter squadron destroyed ${enemy.type}.`);
    awardSalvage(state, enemy.type);
    endPlayerAction(state);
  }

  // Random Blink: costs Energy, teleports to a random open, non-hazard
  // hex on the board — deliberately unpredictable ("you don't even know
  // where you're gonna show up"), a one-off, explicit exception to "zero
  // randomness in combat." Not a precision tool like Sublight/Tractor —
  // an emergency escape you can't fully control.
  const BLINK_ENERGY_COST = 2;

  function applyBlink(state) {
    assertPlaying(state);
    assertUnlocked(state, "blink", "Random Blink");
    if (state.energy < BLINK_ENERGY_COST) throw new Error("Random Blink: not enough Energy");
    const candidates = state.boardHexes.filter(
      (h) => !enemyAt(state, h) && !hazardAt(state, h) && !posEq(h, state.playerPos)
    );
    if (candidates.length === 0) throw new Error("Random Blink: nowhere to land");
    state.events = [];
    const dest = candidates[Math.floor(Math.random() * candidates.length)];
    const from = { q: state.playerPos.q, r: state.playerPos.r };
    state.energy -= BLINK_ENERGY_COST;
    state.playerPos = { q: dest.q, r: dest.r };
    state.events.push({ type: "blink", from, to: { q: dest.q, r: dest.r } });
    pushLog(state, "Random Blink — flagship teleported to an unpredictable hex.");
    handleFighterRetrieval(state);
    checkPlayerHazard(state);
    if (state.status !== "playing") return;
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
    }
    state.salvage -= offer.cost;
    pushLog(state, `Outpost: bought ${offer.label} (-${offer.cost} salvage).`);
  }

  // ---- legal-target queries (used by the renderer to highlight hexes) -----

  function legalSublightTargets(state) {
    return neighbors(state.playerPos).filter(
      (to) => onBoard(state, to) && !enemyAt(state, to)
    );
  }

  function legalTractorTargets(state) {
    if (!state.actions.includes("tractor")) return [];
    return livingEnemiesAdjacentTo(state, state.playerPos);
  }

  function legalFighterTargets(state) {
    if (!state.actions.includes("fighter") || state.fighterHex) return [];
    return livingEnemies(state);
  }

  // ---- exports --------------------------------------------------------------

  const HypergolicEngine = {
    DIRECTIONS,
    ALL_ACTIONS,
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
    applyFighter,
    applyBlink,
    BLINK_ENERGY_COST,
    outpostAvailable,
    outpostOffers,
    applyOutpostPurchase,
    legalSublightTargets,
    legalTractorTargets,
    legalFighterTargets,
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
