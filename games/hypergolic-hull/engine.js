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
  // phone. Rect boards are authored in offset rows: row r spans
  // q = -floor(r/2) .. cols-1-floor(r/2), r = 0..rows-1 (top to bottom).

  function buildBoardHexes(level) {
    const hexes = [];
    if (level.board && level.board.type === "rect") {
      for (let row = 0; row < level.board.rows; row++) {
        for (let col = 0; col < level.board.cols; col++) {
          hexes.push({ q: col - Math.floor(row / 2), r: row });
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

  const ALL_ACTIONS = ["sublight", "ramming", "tractor", "fighter"];

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

  const START_HULL = 3;

  function createGameState(level) {
    validateLevel(level);
    const state = {
      levelId: level.id,
      levelName: level.name || `Sector ${level.id}`,
      radius: level.radius || null,
      boardHexes: buildBoardHexes(level),
      actions: (level.actions || ALL_ACTIONS).slice(),
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
      events: [], // animation cues from the last action, e.g. {type:"kill",q,r}
    };
    if (level.intro) pushLog(state, level.intro);
    checkExitUnlock(state); // an enemy-free tutorial board starts with the gate online
    return state;
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
        if (!onBoard(state, hex)) continue;
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
        if (!onBoard(state, to)) continue;
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
        state.events.push({ type: "attack", enemyId: enemy.id, q: enemy.q, r: enemy.r });
      } else if (intent.type === "move") {
        state.events.push({ type: "enemyMove", enemyId: enemy.id, from: { q: enemy.q, r: enemy.r }, to: intent.to });
        enemy.q = intent.to.q;
        enemy.r = intent.to.r;
      }
    }
    if (totalDamage > 0) {
      state.hull = Math.max(0, state.hull - totalDamage);
      state.events.push({ type: "damage", amount: totalDamage, q: state.playerPos.q, r: state.playerPos.r });
      pushLog(state, `Took ${totalDamage} damage.`);
    }
    state.turnCount += 1;
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

  function applySublight(state, to) {
    assertPlaying(state);
    state.events = [];
    if (!isAdjacent(state.playerPos, to)) throw new Error("Sublight Impulse: destination is not adjacent");
    if (!onBoard(state, to)) throw new Error("Sublight Impulse: destination is off the map");
    if (enemyAt(state, to)) throw new Error("Sublight Impulse: destination is occupied");
    state.playerPos = to;
    handleFighterRetrieval(state);
    checkPlayerHazard(state);
    if (state.status !== "playing") return;
    endPlayerAction(state);
  }

  function applyRamming(state, to) {
    assertPlaying(state);
    assertUnlocked(state, "ramming", "Ramming Speed");
    state.events = [];
    if (state.rammingDisabled) throw new Error("Ramming Speed: fighters are deployed — retrieve them first");
    if (!isAdjacent(state.playerPos, to)) throw new Error("Ramming Speed: destination is not adjacent");
    if (!onBoard(state, to)) throw new Error("Ramming Speed: destination is off the map");
    if (enemyAt(state, to)) throw new Error("Ramming Speed: destination is occupied");
    const victims = livingEnemiesAdjacentTo(state, to);
    if (victims.length === 0) throw new Error("Ramming Speed: destination is not adjacent to an enemy");
    state.playerPos = to;
    for (const victim of victims) {
      victim.alive = false;
      state.events.push({ type: "kill", q: victim.q, r: victim.r, victim: victim.type });
      pushLog(state, `Rammed ${victim.type}.`);
    }
    handleFighterRetrieval(state);
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
    } else {
      const blocker = enemyAt(state, dest);
      const hazard = hazardAt(state, dest);
      if (blocker) {
        enemy.alive = false;
        blocker.alive = false;
        state.events.push({ type: "kill", q: dest.q, r: dest.r, victim: enemy.type });
        state.events.push({ type: "kill", q: blocker.q, r: blocker.r, victim: blocker.type });
        pushLog(state, `Tractor-pushed ${enemy.type} into ${blocker.type} — both destroyed.`);
      } else if (hazard) {
        enemy.alive = false;
        state.events.push({ type: "kill", q: dest.q, r: dest.r, victim: enemy.type });
        pushLog(state, `Tractor-pushed ${enemy.type} into a hazard.`);
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
    endPlayerAction(state);
  }

  // ---- legal-target queries (used by the renderer to highlight hexes) -----

  function legalSublightTargets(state) {
    return neighbors(state.playerPos).filter(
      (to) => onBoard(state, to) && !enemyAt(state, to)
    );
  }

  function legalRammingTargets(state) {
    if (!state.actions.includes("ramming") || state.rammingDisabled) return [];
    return neighbors(state.playerPos).filter(
      (to) => onBoard(state, to) && !enemyAt(state, to) && livingEnemiesAdjacentTo(state, to).length > 0
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
