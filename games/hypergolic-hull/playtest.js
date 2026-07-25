// playtest.js — plays WHOLE RUNS, sector 1 to the Bulwark at depth 20, with
// a reasonable pilot AI, and reports what actually happened.
//
// engine.test.js proves the rules are right on pinned fixtures;
// browser.test.js proves the UI drives them. Neither answers "is this a
// game" — whether the economy, the weapon roster, enemy pressure, hull
// attrition and the shop hang together over twenty sectors. This does:
// run it across many seeded runs and read the survival curve, what got
// bought, what did the killing, and where runs actually end.
//
//   node games/hypergolic-hull/playtest.js [runs]
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");
const Levels = require("./levels.js");

const BOSS_DEPTH = Levels.BOSS_DEPTH;

// ---- the pilot ----------------------------------------------------------
// Plays the way a competent human would, using only what the UI exposes:
// one action a round, fire when something's in an armed weapon's reach
// (turning the nose onto it first, exactly as tapping a hostile does),
// raise shields when they're down and danger is close, recharge when the
// reactor is too low to shoot, otherwise step toward the objective while
// avoiding hexes that end the round inside a threat.

function armedWeapons(state) {
  return Engine.WEAPON_SYSTEM_KEYS.filter((k) => state.actions.includes(k) && state.systems[k]).map(
    (k) => Engine.WEAPONS[k]
  );
}

// The best target for this round: for each living enemy, is there a facing
// that puts it inside an armed weapon we can afford? Prefer the cheapest
// weapon that reaches, and the weakest enemy it kills outright.
function bestShot(state) {
  const weapons = armedWeapons(state).filter((w) => w.energyCost <= state.energy);
  const living = Engine.livingEnemies(state);
  let best = null;
  for (const enemy of living) {
    for (const weapon of weapons) {
      for (let facing = 0; facing < 6; facing++) {
        const reach = Engine.weaponHexes(state.playerPos, facing, weapon);
        if (!reach.some((h) => Engine.posEq(h, enemy))) continue;
        // A "hits all in reach" weapon is worth exactly as much as the
        // number of contacts standing in that reach — the whole reason to
        // carry a Flak Burst instead of another single-target gun.
        const victims =
          weapon.targets === "all" ? living.filter((e) => reach.some((h) => Engine.posEq(h, e))) : [enemy];
        const kills = victims.filter((e) => e.hp <= weapon.damage).length;
        const score = kills * 100 + (victims.length - 1) * 45 - weapon.energyCost - Engine.hexDistance(state.playerPos, enemy);
        if (!best || score > best.score) best = { enemy, weapon, facing, score };
      }
    }
  }
  return best;
}

// Real routing, not greedy stepping. The design's promise is that you can
// go AROUND a threat instead of through it ("fight for salvage or route
// around and fly straight to the gate") — a pilot that only ever compares
// its six neighbours can't do that, and will happily walk the length of a
// Sentry's ring because every single step looked locally fine. This is a
// uniform-cost search over the whole board where a threatened hex simply
// costs a lot more than a clear one, so detours win whenever a detour
// exists and the direct line still wins when it doesn't.
const THREAT_COST = 9;

function routeStep(state, goal) {
  const startKey = Engine.hexKey(state.playerPos);
  const goalKey = Engine.hexKey(goal);
  const threats = Engine.computeThreatHexes(state);
  const blocked = new Set();
  for (const e of Engine.livingEnemies(state)) blocked.add(Engine.hexKey(e));
  for (const h of state.hazards || []) blocked.add(Engine.hexKey(h)); // asteroid fields are impassable

  const dist = new Map([[startKey, 0]]);
  const firstStep = new Map();
  let frontier = [state.playerPos];
  let found = null;
  for (let depth = 0; depth < 400 && frontier.length && !found; depth++) {
    frontier.sort((a, b) => dist.get(Engine.hexKey(a)) - dist.get(Engine.hexKey(b)));
    const cur = frontier.shift();
    const curKey = Engine.hexKey(cur);
    if (curKey === goalKey) {
      found = cur;
      break;
    }
    for (const nb of Engine.neighbors(cur)) {
      const key = Engine.hexKey(nb);
      if (!Engine.onBoard(state, nb) || blocked.has(key)) continue;
      const step = 1 + (threats.has(key) ? THREAT_COST : 0);
      const next = dist.get(curKey) + step;
      if (dist.has(key) && dist.get(key) <= next) continue;
      dist.set(key, next);
      firstStep.set(key, curKey === startKey ? nb : firstStep.get(curKey));
      frontier.push(nb);
      if (key === goalKey) found = nb;
    }
  }
  const step = found ? firstStep.get(Engine.hexKey(found)) : null;
  if (step && Engine.legalSublightTargets(state).some((h) => Engine.posEq(h, step))) return step;
  // No route at all (walled in by hazards, or the goal is occupied):
  // fall back to the best legal neighbour.
  const legal = Engine.legalSublightTargets(state);
  if (!legal.length) return null;
  return legal.reduce((best, cand) =>
    !best || Engine.hexDistance(cand, goal) < Engine.hexDistance(best, goal) ? cand : best
  , null);
}

// Shopping policy. A dock is the only place capability comes from, and
// salvage spent on a trinket is salvage not spent on the gun that answers
// the thing killing you — so the pilot banks rather than dribbles.
function shop(state, report) {
  const buy = (id) => {
    Engine.applyOutpostPurchase(state, id);
    report.purchases[id] = (report.purchases[id] || 0) + 1;
  };
  const has = (id) => Engine.outpostOffers(state).some((o) => o.id === id && o.affordable);

  // 1. A hull you can fight with, before anything else.
  while (state.hull < Math.ceil(state.maxHull * 0.6) && has("repair")) buy("repair");

  // 2. A second gun. Until there is one, everything else waits — this is
  //    the single biggest determinant of how deep a run gets.
  const secondGun = () => armedWeapons(state).length >= 2;
  if (!secondGun()) {
    // Which second gun the pilot reaches for. Both paths get played, so a
    // weapon that only looks good on paper shows up here as a worse
    // survival curve rather than a nice-sounding line in a design doc.
    const preference =
      process.env.GUN_PREF === "arc"
        ? ["arcBeam", "flakBurst", "railgun"]
        : process.env.GUN_PREF === "railgun"
          ? ["railgun", "arcBeam", "flakBurst"]
          : ["flakBurst", "arcBeam", "railgun"];
    // Bank for the gun you actually want rather than grabbing whatever is
    // cheapest on the shelf — otherwise every run ends up flying the same
    // ship and the roster never gets tested.
    const onOffer = Engine.outpostOffers(state).map((o) => o.id);
    const target = preference.find((id) => onOffer.includes(id));
    if (target && has(target)) buy(target);
  }

  // 3. Only once the ship can actually fight: top the hull off, then
  //    durability and capacity, then a third gun.
  if (secondGun()) {
    while (state.hull < state.maxHull && has("repair")) buy("repair");
    for (const id of ["shield", "hardpoint", "flakBurst", "arcBeam", "railgun", "reinforce", "reactor"]) {
      if (has(id)) buy(id);
    }
    // Don't die rich. Anything still on the shelf beats salvage in the
    // hold, and grid space is what lets a late run keep growing at all.
    let spending = true;
    while (spending && state.salvage >= 10) {
      spending = false;
      for (const id of ["hardpoint", "reinforce", "reactor", "railgun", "arcBeam", "flakBurst", "shield"]) {
        if (has(id)) {
          buy(id);
          spending = true;
          break;
        }
      }
    }
  }

  // A weapon that landed in cargo is dead weight — fit anything that fits
  // now (this is the tap-a-cargo-chip path in the real Hold UI).
  for (let i = state.hold.cargo.length - 1; i >= 0; i--) {
    const id = state.hold.cargo[i];
    let placed = false;
    for (let y = 0; y < state.hold.rows && !placed; y++) {
      for (let x = 0; x < state.hold.cols && !placed; x++) {
        if (Engine.holdCanPlace(state.hold, id, x, y)) {
          Engine.installFromCargo(state, i, x, y);
          report.fitted[id] = (report.fitted[id] || 0) + 1;
          placed = true;
        }
      }
    }
  }
}

// Seeded per run so different runs take different routes through the
// maze — the chart genuinely forks, and a run that always turns the same
// way is only ever testing one column of the game.
function makeRng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Play one sector to a conclusion: cleared (through the gate), dead, or
// stalled (the pilot ran out of ideas — itself a finding worth reporting).
//
// The Warp Gate is always online, so the real decision every round is
// "is this fight worth it?" A run that kills everything in every sector
// bleeds out by depth 5; a run that skips everything never affords a
// weapon. The pilot below fights what comes to it, leaves what doesn't,
// and shops with whatever that earns — which is how the game is meant to
// be played, and therefore what a playtest has to measure.
function playSector(state, report) {
  const MAX_ROUNDS = 220;
  let visitedOutpost = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (state.status !== "playing") return state.status;

    if (Engine.outpostAvailable(state)) {
      shop(state, report);
      visitedOutpost = true;
    }

    const enemies = Engine.livingEnemies(state);
    const healthy = state.hull > state.maxHull / 2;
    const threats = Engine.computeThreatHexes(state);
    const threatened = threats.has(Engine.hexKey(state.playerPos));

    // Shoot whatever is already in reach — anything close enough to hit is
    // close enough to hit you back.
    const shot = bestShot(state);
    if (process.env.VERBOSE === "2") {
      console.log(
        `    r${round} pos ${state.playerPos.q},${state.playerPos.r} hull ${state.hull} e ${state.energy}` +
          ` | ${enemies.map((e) => `${e.type}@${Engine.hexDistance(state.playerPos, e)}`).join(" ")}` +
          ` | ${shot ? "FIRE " + shot.weapon.id : "-"}`
      );
    }
    if (shot) {
      Engine.setFacing(state, shot.facing);
      Engine.applyFire(state, shot.enemy.id);
      report.kills[shot.weapon.id] = report.kills[shot.weapon.id] || { shots: 0, kills: 0 };
      report.kills[shot.weapon.id].shots++;
      if (!shot.enemy.alive) report.kills[shot.weapon.id].kills++;
      continue;
    }

    // Shields back up on any quiet round — waiting until something is
    // already lined up on you means the generator absorbs exactly one hit
    // per run and then rides along as dead weight. (Raising costs a turn
    // and 2 Energy, so it wants a round where nothing is shootable.)
    const canAffordRaise = state.energy >= 2 + Math.min(...armedWeapons(state).map((w) => w.energyCost));
    if (state.maxShields > 0 && state.shieldCharges < state.maxShields && (canAffordRaise || threatened) && state.energy >= 2) {
      Engine.applyRaiseShields(state);
      report.shieldsRaised++;
      continue;
    }

    // Chasers are coming whether we like it or not: hold one hex outside
    // their reach and let them close, so the kill lands in OUR phase.
    // Emplacements are the opposite — they never move, so there is no
    // "wait" that helps, only a decision to engage or route around.
    const chasers = enemies.filter((e) => Engine.ENEMY_TYPES[e.type].movesTowardPlayer);
    const nearestChaser = chasers.reduce((best, e) =>
      !best || Engine.hexDistance(state.playerPos, e) < Engine.hexDistance(state.playerPos, best) ? e : best
    , null);
    if (nearestChaser && !threatened && healthy && Engine.hexDistance(state.playerPos, nearestChaser) <= 3) {
      if (state.energy < state.maxEnergy) {
        Engine.applyRecharge(state);
        report.recharges++;
      } else {
        Engine.applyEndTurn(state);
      }
      continue;
    }

    // Too poor to shoot anything at all, with something inbound? Cycle.
    const cheapest = Math.min(...armedWeapons(state).map((w) => w.energyCost));
    if (nearestChaser && Number.isFinite(cheapest) && state.energy < cheapest && state.energy < state.maxEnergy) {
      Engine.applyRecharge(state);
      report.recharges++;
      continue;
    }

    // Where to go. Dock if there's anything worth buying and we haven't;
    // otherwise the gate. Nothing here is worth grinding for — the gate is
    // always open and hull damage is permanent.
    const wantsShop = state.outpostPos && !visitedOutpost && (state.salvage >= 3 || state.hull < state.maxHull);
    const goal = wantsShop ? state.outpostPos : state.exitPos;
    if (!wantsShop && Engine.posEq(state.playerPos, state.exitPos)) return "cleared";
    const step = routeStep(state, goal);
    if (!step) {
      Engine.applyEndTurn(state);
      continue;
    }
    Engine.applySublight(state, step);
    if (state.status === "won") return "cleared";
  }
  return "stalled";
}

function playRun(seed, report) {
  const LEVELS = Levels.LEVELS;
  const rng = makeRng(seed + 1);
  let carryOver = null;
  let depth = 1;
  let variantId = null;
  for (; depth <= BOSS_DEPTH; depth++) {
    const level = depth <= LEVELS.length ? LEVELS[depth - 1] : Levels.generateLevel(depth, variantId);
    let state;
    try {
      state = Engine.createGameState(level, carryOver ? { ...carryOver, hasPrevious: true } : undefined);
    } catch (err) {
      report.errors.push(`depth ${depth}: level failed to build — ${err.message}`);
      return { depth, outcome: "error" };
    }
    const hullIn = state.hull;
    const salvageIn = state.salvage;
    let outcome;
    try {
      outcome = playSector(state, report);
    } catch (err) {
      report.errors.push(`depth ${depth}: ${err.message}`);
      return { depth, outcome: "error" };
    }
    report.depthReached[depth] = (report.depthReached[depth] || 0) + 1;
    if (process.env.VERBOSE) {
      console.log(
        `  d${String(depth).padStart(2)} ${String(outcome).padEnd(8)} hull ${hullIn}->${state.hull}/${state.maxHull}` +
          ` salvage ${salvageIn}->${state.salvage} guns [${armedWeapons(state).map((w) => w.id).join(",")}]` +
          ` enemies ${(level.enemies || []).length} dock ${level.outpost ? "y" : "n"}`
      );
    }
    if (outcome === "lost") return { depth, outcome: "died", hull: 0 };
    if (outcome === "stalled") return { depth, outcome: "stalled" };
    if (state.isVictory) {
      report.hullAtDepth[depth] = report.hullAtDepth[depth] || [];
      report.hullAtDepth[depth].push(state.hull);
      return { depth, outcome: "won", hull: state.hull, salvage: state.salvage };
    }
    report.hullAtDepth[depth] = report.hullAtDepth[depth] || [];
    report.hullAtDepth[depth].push(state.hull);
    // Pick a gate. Which one you take is the map's whole decision, so a
    // playtest that always takes the first is testing a corridor, not a
    // maze.
    const gates = state.exits && state.exits.length ? state.exits : [];
    const gate = gates.length ? gates[Math.floor(rng() * gates.length)] : null;
    variantId = gate && gate.variantId ? gate.variantId : null;
    report.gates[variantId || "only"] = (report.gates[variantId || "only"] || 0) + 1;
    carryOver = {
      salvage: state.salvage,
      hull: state.hull,
      maxHull: state.maxHull,
      shieldCharges: state.shieldCharges,
      maxEnergy: state.maxEnergy,
      maxAp: state.maxAp,
      hold: state.hold,
    };
  }
  return { depth: depth - 1, outcome: "survived" };
}

// ---- report -------------------------------------------------------------

function main() {
  const runs = Number(process.argv[2] || 40);
  const report = {
    purchases: {},
    fitted: {},
    kills: {},
    depthReached: {},
    hullAtDepth: {},
    recharges: 0,
    shieldsRaised: 0,
    gates: {},
    errors: [],
  };
  const outcomes = {};
  const deathDepths = [];
  for (let seed = 0; seed < runs; seed++) {
    const result = playRun(seed, report);
    outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
    if (result.outcome === "died" || result.outcome === "stalled") deathDepths.push(result.depth);
  }

  const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-");
  console.log(`\n=== ${runs} full runs, sector 1 → the Bulwark (depth ${BOSS_DEPTH}) ===`);
  console.log("outcomes:", outcomes);
  console.log("median end depth:", deathDepths.length ? deathDepths.sort((a, b) => a - b)[Math.floor(deathDepths.length / 2)] : "-");
  console.log("\nsurvival curve (runs that reached each depth):");
  for (let d = 1; d <= BOSS_DEPTH; d++) {
    const reached = report.depthReached[d] || 0;
    if (!reached) continue;
    const bar = "#".repeat(Math.round((reached / runs) * 40));
    console.log(`  ${String(d).padStart(2)} ${String(reached).padStart(3)} ${bar} hull avg ${avg(report.hullAtDepth[d] || [])}`);
  }
  console.log("\nweapon usage (shots → kills):");
  for (const [id, s] of Object.entries(report.kills)) console.log(`  ${id.padEnd(12)} ${s.shots} shots, ${s.kills} kills`);
  console.log("\npurchases:", report.purchases);
  console.log("fitted from cargo:", report.fitted);
  console.log(`recharges: ${report.recharges}, shields raised: ${report.shieldsRaised}`);
console.log("gates taken:", report.gates);
  if (report.errors.length) {
    console.log("\nERRORS:");
    const counted = {};
    for (const e of report.errors) counted[e.replace(/depth \d+/, "depth N")] = (counted[e.replace(/depth \d+/, "depth N")] || 0) + 1;
    for (const [msg, n] of Object.entries(counted)) console.log(`  ${n}x ${msg}`);
  } else {
    console.log("\nno engine errors across any run.");
  }
  assert.strictEqual(report.errors.length, 0, "a full run must never throw");
}

main();
