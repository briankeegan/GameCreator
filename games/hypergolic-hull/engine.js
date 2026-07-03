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

  // ---- level validation ---------------------------------------------------

  function validateLevel(level) {
    const origin = { q: 0, r: 0 };
    if (hexDistance(origin, level.exit) !== level.radius) {
      throw new Error(`Level ${level.id}: exit is not on the outer ring`);
    }
    if (level.outpost && hexDistance(origin, level.outpost) !== level.radius) {
      throw new Error(`Level ${level.id}: outpost is not on the outer ring`);
    }
    for (const enemy of level.enemies) {
      if (hexDistance(level.playerStart, enemy) < 2) {
        throw new Error(`Level ${level.id}: enemy at ${hexKey(enemy)} is within 2 hexes of playerStart`);
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

  const START_HULL = 3;

  function createGameState(level) {
    validateLevel(level);
    return {
      levelId: level.id,
      radius: level.radius,
      playerPos: { q: level.playerStart.q, r: level.playerStart.r },
      hull: START_HULL,
      maxHull: START_HULL,
      exitPos: { q: level.exit.q, r: level.exit.r },
      outpostPos: level.outpost ? { q: level.outpost.q, r: level.outpost.r } : null,
      exitRule: level.exitRule,
      exitUnlocked: false,
      hazards: (level.hazards || []).map((h) => ({ type: h.type, q: h.q, r: h.r })),
      enemies: level.enemies.map((e, i) => ({
        id: `e${i}`,
        type: e.type,
        q: e.q,
        r: e.r,
        alive: true,
      })),
      fighterHex: null,
      rammingDisabled: false,
      turnCount: 0,
      status: "playing", // "playing" | "won" | "lost"
      log: [],
    };
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

  function pushLog(state, message) {
    state.log.push(message);
    if (state.log.length > 20) state.log.shift();
  }

  // ---- threat overlay: pillar #3, "the board is the UI" -------------------
  //
  // For M1 (Interceptors only) an interceptor attacks instead of moving iff
  // it is already adjacent to the player when the enemy phase begins. So any
  // hex adjacent to a living interceptor is a hex that will take damage if
  // the player ends their turn there.
  function computeThreatHexes(state) {
    const threats = new Map(); // hexKey -> damage count
    for (const enemy of livingEnemies(state)) {
      if (enemy.type !== "interceptor") continue;
      for (const hex of neighbors(enemy)) {
        if (!inBounds(hex, state.radius)) continue;
        const k = hexKey(hex);
        threats.set(k, (threats.get(k) || 0) + 1);
      }
    }
    return threats;
  }

  // ---- enemy AI -------------------------------------------------------------

  function decideIntent(state, enemy) {
    if (enemy.type === "interceptor") {
      if (isAdjacent(enemy, state.playerPos)) {
        return { enemyId: enemy.id, type: "attack" };
      }
      const occupiedNow = new Set(
        state.enemies.filter((e) => e.alive && e.id !== enemy.id).map((e) => hexKey(e))
      );
      const candidates = [];
      for (let i = 0; i < 6; i++) {
        const to = neighbor(enemy, i);
        if (!inBounds(to, state.radius)) continue;
        if (posEq(to, state.playerPos)) continue;
        if (occupiedNow.has(hexKey(to))) continue;
        candidates.push({ to, dist: hexDistance(to, state.playerPos), dir: i });
      }
      candidates.sort((a, b) => a.dist - b.dist || a.dir - b.dir);
      if (candidates.length === 0) return { enemyId: enemy.id, type: "wait" };
      return { enemyId: enemy.id, type: "move", to: candidates[0].to };
    }
    // Other enemy types (Railgun Destroyer, Minelayer, Carrier) implement the
    // same decide(state)/execute(intent) interface but land in a later pass.
    return { enemyId: enemy.id, type: "wait" };
  }

  function checkExitUnlock(state) {
    if (state.exitRule === "all-enemies-dead") {
      const wasUnlocked = state.exitUnlocked;
      state.exitUnlocked = livingEnemies(state).length === 0;
      if (state.exitUnlocked && !wasUnlocked) {
        pushLog(state, "Warp Gate online.");
      }
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
        totalDamage += 1;
      } else if (intent.type === "move") {
        enemy.q = intent.to.q;
        enemy.r = intent.to.r;
      }
    }
    if (totalDamage > 0) {
      state.hull = Math.max(0, state.hull - totalDamage);
      pushLog(state, `Took ${totalDamage} damage.`);
    }
    state.turnCount += 1;
    if (state.hull <= 0) {
      state.status = "lost";
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

  // ---- player actions -----------------------------------------------------

  function applySublight(state, to) {
    assertPlaying(state);
    if (!isAdjacent(state.playerPos, to)) throw new Error("Sublight Impulse: destination is not adjacent");
    if (!inBounds(to, state.radius)) throw new Error("Sublight Impulse: destination is off the map");
    if (enemyAt(state, to)) throw new Error("Sublight Impulse: destination is occupied");
    state.playerPos = to;
    handleFighterRetrieval(state);
    checkPlayerHazard(state);
    if (state.status !== "playing") return;
    endPlayerAction(state);
  }

  function applyRamming(state, to) {
    assertPlaying(state);
    if (state.rammingDisabled) throw new Error("Ramming Speed: fighters are deployed — retrieve them first");
    if (!isAdjacent(state.playerPos, to)) throw new Error("Ramming Speed: destination is not adjacent");
    if (!inBounds(to, state.radius)) throw new Error("Ramming Speed: destination is off the map");
    if (enemyAt(state, to)) throw new Error("Ramming Speed: destination is occupied");
    const victims = livingEnemiesAdjacentTo(state, to);
    if (victims.length === 0) throw new Error("Ramming Speed: destination is not adjacent to an enemy");
    state.playerPos = to;
    for (const victim of victims) {
      victim.alive = false;
      pushLog(state, `Rammed ${victim.type}.`);
    }
    handleFighterRetrieval(state);
    checkPlayerHazard(state);
    if (state.status !== "playing") return;
    endPlayerAction(state);
  }

  function applyTractor(state, targetEnemyId) {
    assertPlaying(state);
    const enemy = state.enemies.find((e) => e.id === targetEnemyId && e.alive);
    if (!enemy) throw new Error("Tractor Beam: no such enemy");
    if (!isAdjacent(state.playerPos, enemy)) throw new Error("Tractor Beam: enemy is not adjacent");
    const dir = directionIndex(state.playerPos, enemy);
    const dest = neighbor(enemy, dir);
    if (!inBounds(dest, state.radius)) {
      enemy.alive = false;
      pushLog(state, `Tractor-pushed ${enemy.type} off the map edge.`);
    } else {
      const blocker = enemyAt(state, dest);
      const hazard = hazardAt(state, dest);
      if (blocker) {
        enemy.alive = false;
        blocker.alive = false;
        pushLog(state, `Tractor-pushed ${enemy.type} into ${blocker.type} — both destroyed.`);
      } else if (hazard) {
        enemy.alive = false;
        pushLog(state, `Tractor-pushed ${enemy.type} into a hazard.`);
      } else {
        enemy.q = dest.q;
        enemy.r = dest.r;
        pushLog(state, `Tractor-pushed ${enemy.type}.`);
      }
    }
    endPlayerAction(state);
  }

  function applyFighter(state, targetEnemyId) {
    assertPlaying(state);
    if (state.fighterHex) throw new Error("Fighter Squadron: already deployed — retrieve them first");
    const enemy = state.enemies.find((e) => e.id === targetEnemyId && e.alive);
    if (!enemy) throw new Error("Fighter Squadron: no such enemy");
    enemy.alive = false;
    state.fighterHex = { q: enemy.q, r: enemy.r };
    state.rammingDisabled = true;
    pushLog(state, `Fighter squadron destroyed ${enemy.type}.`);
    endPlayerAction(state);
  }

  // ---- legal-target queries (used by the renderer to highlight hexes) -----

  function legalSublightTargets(state) {
    return neighbors(state.playerPos).filter(
      (to) => inBounds(to, state.radius) && !enemyAt(state, to)
    );
  }

  function legalRammingTargets(state) {
    if (state.rammingDisabled) return [];
    return neighbors(state.playerPos).filter(
      (to) => inBounds(to, state.radius) && !enemyAt(state, to) && livingEnemiesAdjacentTo(state, to).length > 0
    );
  }

  function legalTractorTargets(state) {
    return livingEnemiesAdjacentTo(state, state.playerPos);
  }

  function legalFighterTargets(state) {
    if (state.fighterHex) return [];
    return livingEnemies(state);
  }

  // ---- exports --------------------------------------------------------------

  const HypergolicEngine = {
    DIRECTIONS,
    hexKey,
    posEq,
    hexDistance,
    neighbor,
    neighbors,
    isAdjacent,
    inBounds,
    directionIndex,
    validateLevel,
    createGameState,
    computeThreatHexes,
    applySublight,
    applyRamming,
    applyTractor,
    applyFighter,
    legalSublightTargets,
    legalRammingTargets,
    legalTractorTargets,
    legalFighterTargets,
    livingEnemies,
    enemyAt,
    hazardAt,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HypergolicEngine;
  } else {
    root.HypergolicEngine = HypergolicEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
