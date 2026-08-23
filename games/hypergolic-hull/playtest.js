// playtest.js — plays WHOLE RUNS, sector 1 to the Bulwark, with
// a reasonable pilot AI, and reports what actually happened.
//
// engine.test.js proves the rules are right on pinned fixtures;
// browser.test.js proves the UI drives them. Neither answers "is this a
// game" — whether the economy, the weapon roster, enemy pressure, hull
// attrition and the shop hang together across a whole crawl. This does:
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
// one action a round, one gun per action, fire when something's in a
// fitted weapon's reach (turning the nose onto it first, exactly as
// tapping a hostile does),
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
// The nearest step toward somewhere one of our guns bears on something.
// Prefers a destination outside the enemy threat map, and prefers the
// gun with the longest reach — a shot you can take from outside what can
// answer it is the whole reason reach costs what it costs.
function firingSpot(state, threats, maxTrip) {
  const weapons = armedWeapons(state);
  if (!weapons.length) return null;
  const enemies = Engine.livingEnemies(state);
  if (!enemies.length) return null;
  const steps = Engine.legalSublightTargets(state);
  if (!steps.length) return null;
  // Where could we shoot from at all? Score every hex on the board once.
  let best = null;
  for (const hex of state.boardHexes) {
    if (Engine.hazardAt && Engine.hazardAt(state, hex)) continue;
    if (Engine.enemyAt(state, hex)) continue;
    let bears = null;
    for (const w of weapons) {
      for (let facing = 0; facing < 6; facing++) {
        const reach = Engine.weaponHexes(hex, facing, w, state);
        if (!enemies.some((e) => reach.some((h) => Engine.posEq(h, e)))) continue;
        if (!bears || w.range > bears.range) bears = w;
      }
    }
    if (!bears) continue;
    const hot = threats.has(Engine.hexKey(hex)) ? 1 : 0;
    const trip = Engine.hexDistance(state.playerPos, hex);
    if (maxTrip != null && trip > maxTrip) continue;
    // Outside the threat map first, then furthest-reaching gun, then
    // closest to get to.
    const score = hot * 1000 - bears.range * 10 + trip;
    if (!best || score < best.score) best = { hex, score, trip };
  }
  if (!best || best.trip === 0) return null;
  return steps.reduce(
    (b, h) => (!b || Engine.hexDistance(h, best.hex) < Engine.hexDistance(b, best.hex) ? h : b),
    null
  );
}

function bestShot(state) {
  const weapons = armedWeapons(state).filter((w) => w.energyCost <= state.energy);
  const living = Engine.livingEnemies(state);
  let best = null;
  for (const enemy of living) {
    for (const weapon of weapons) {
      for (let facing = 0; facing < 6; facing++) {
        const reach = Engine.weaponHexes(state.playerPos, facing, weapon, state);
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
// HOW WELL THE SHIP IS FLOWN. The point of the harness is no longer "what
// is the win rate" — it's whether SKILL is the deciding variable. A run
// should come apart because of decisions (bought the wrong thing, took
// the wrong fight, walked the wrong lane), not because of the deal. So
// the same game gets played by three different pilots and the spread
// between them is the answer:
//
//   careful  — routes wide of every kill zone, lets chasers come to it,
//              keeps a screen up, banks salvage for reach.
//   greedy   — kills everything it can reach, buys whatever is cheapest
//              the moment it can afford anything.
//   reckless — beelines the gate, never shops, never waits.
//
// If careful wins and the other two don't, the game rewards knowing how
// to play it. If nobody wins, it's unfair. If everybody wins, it's flat.
const PILOT = process.env.PILOT || "careful";
const CARE = { careful: 6, greedy: 4, reckless: 0 }[PILOT]; // detours cost rounds, and rounds let chasers close — caution has a price too
const THREAT_COST = CARE; // a detour beats a hit — hull is the scarcest thing in the game

function routeStep(state, goal) {
  const startKey = Engine.hexKey(state.playerPos);
  const goalKey = Engine.hexKey(goal);
  const threats = Engine.computeThreatHexes(state);
  const blocked = new Set();
  for (const e of Engine.livingEnemies(state)) blocked.add(Engine.hexKey(e));
  for (const h of state.hazards || []) blocked.add(Engine.hexKey(h)); // asteroid fields are impassable
  // A fixed gun's zone is only dangerous while the gun is CHARGED, and
  // every emplacement in the game costs more to fire than it makes in a
  // round — so each zone blinks, and staticKillZones only reports the
  // ones that are live right now. A pilot who reads the charge counters
  // routes around what's hot and walks through what's spent; one who
  // doesn't pays a hull for the shortcut. That timing is the puzzle.
  const emplaced = PILOT === "careful" ? Engine.staticKillZones(state) : new Set();

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
      const step = 1 + (threats.has(key) ? THREAT_COST : 0) + (emplaced.has(key) ? 60 : 0);
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

// What the careful pilot wants, in order — DERIVED from the shelf rather
// than typed out. The hardcoded list was five items long and had not been
// touched since the roster was four guns: it could not so much as consider
// a Beam Lance, an Arc Projector, a Missile Pod, Flank Tubes, a Mortar, a
// Siege Maul, a Prow Cannon or a Demolition Charge — eight of the eleven
// weapons in the game. Measured, that alone was the gap: greedy bought 87
// guns across 40 runs and careful bought 40, so careful arrived at the
// deep end under-gunned no matter how well it flew.
//
// Guns first, longest reach first (a turn fires ONE gun, so range beats
// another mount covering ground you already cover), then the upgrades.
function wantList(state) {
  const guns = Engine.OUTPOST_OFFER_POOL.filter((o) => Engine.WEAPON_SYSTEM_KEYS.includes(o.id))
    .slice()
    .sort((a, b) => {
      const wa = Engine.WEAPONS[a.id];
      const wb = Engine.WEAPONS[b.id];
      // A launcher's "range" flatters it and a board-length lane is not
      // four times a five-hex one, so reach is capped for ranking.
      // Cheapest first, reach as the tie-break. Reach-first was tried and
      // measured WORSE (careful 20 wins -> 15 of 60, stalls 6 -> 11): the
      // expensive guns eat the salvage the ship needs for patches, and a
      // long gun you bought instead of a hull point does not help you when
      // something is already touching you.
      const reach = (w) => Math.min(w.range, 5) - (w.places || w.launches ? 2 : 0);
      return a.cost - b.cost || reach(wb) - reach(wa);
    })
    .map((o) => o.id);
  // Energy hardware is bought only when the ship is actually short of
  // energy — never as "the next affordable thing". Reaching for it by
  // price put 128 Charge Banks across 150 runs into holds that needed
  // guns, and the careful pilot's win rate fell 58/150 -> 35/150. A
  // battery holds charge, it does not make any: it is worth having only
  // once there is something on the bus to spend it on. Short means the
  // bus cannot cover the dearest gun aboard twice over — enough to fire
  // it, take a turn, and fire it again.
  const dearestShot = Math.max(1, ...armedWeapons(state).map((w) => w.energyCost || 1));
  const energyShort = (state.maxEnergy || 0) < dearestShot * 2;
  const power = energyShort ? ["reactor", "chargeBank"] : [];
  return [...guns, "shield", "screenArray", "hardpoint", "reinforce", ...power];
}

// Shopping policy. A dock is the only place capability comes from, and
// salvage spent on a trinket is salvage not spent on the gun that answers
// the thing killing you — so the pilot banks rather than dribbles.
// Income by SOURCE, per sector (ECON=1). The engine CLEARS state.events at
// the top of every action, so the tape can only be read immediately after
// the call that wrote it — sampling it at the end of a sector reads the
// last action and nothing else, which is how a first attempt at this
// measured 116 salvage of income against a 205 bank and believed it.
// So wrap every engine entry point once and read the tape it just wrote —
// and mark each event object as counted, because the read-only queries
// (outpostOffers, computeThreatHexes, livingEnemies) do NOT clear the tape,
// so the same award is visible to dozens of later calls. Counting it every
// time it was VISIBLE rather than once, when it HAPPENED, reported 3,300
// salvage of income in a sector that pays about thirteen.
let ECON_LEDGER = null;
const ECON_SEEN = new WeakSet();
function econInstrument(report) {
  ECON_LEDGER = report.econ.income;
  for (const key of Object.keys(Engine)) {
    const fn = Engine[key];
    if (typeof fn !== "function" || key === "createGameState") continue;
    Engine[key] = function (...args) {
      const out = fn.apply(this, args);
      const st = args[0];
      if (st && Array.isArray(st.events) && st.events.length) {
        st.events = st.events.filter((ev) => {
          if (ECON_SEEN.has(ev)) return true;
          ECON_SEEN.add(ev);
          ev.__econNew = true;
          return true;
        });
        const d = st.levelId || 0;
        const b = (ECON_LEDGER[d] = ECON_LEDGER[d] || { kills: 0, clean: 0, discovery: 0, wrecks: 0, spent: 0, n: 0 });
        for (const ev of st.events) {
          if (!ev.__econNew) continue;
          ev.__econNew = false;
          if (ev.type === "salvage") {
            b[ev.clean ? "clean" : "kills"] += ev.amount || 0;
            if (!ev.clean) b.wrecks += 1;
          }
          else if (ev.type === "discovery" && ev.kind === "salvage") b.discovery += ev.amount || 0;
        }
      }
      return out;
    };
  }
}
function econMark(state, report, depth) {
  const b = (report.econ.income[depth] = report.econ.income[depth] || { kills: 0, clean: 0, discovery: 0, wrecks: 0, spent: 0, n: 0 });
  b.n++;
}

function shop(state, report, firstLook) {
  if (PILOT === "reckless") return; // never docks, never spends
  // ECON=1 — the salvage ledger. "Too easy to buy things" is a claim about
  // the RATIO between the bank and the shelf, and neither number was ever
  // written down: income was tuned by watching win rates, which cannot
  // tell "the shop is generous" apart from "the guns are good". So on
  // every dock, record what the pilot walked in holding and what fraction
  // of the shelf that covered. Read, don't infer.
  if (process.env.ECON && firstLook) {
    const offers = Engine.outpostOffers(state);
    // How much of this shelf was on the LAST one? A shop that restocks what
    // you just declined is not a shop, it is the same shop again.
    const now = offers.map((o) => o.id).filter((id) => id !== "repair");
    const prev = report.econ.lastShelf || [];
    const same = now.filter((id) => prev.includes(id));
    report.econ.repeats.push({ depth: state.levelId, n: now.length, same: same.length });
    for (const id of same) report.econ.repeatBy[id] = (report.econ.repeatBy[id] || 0) + 1;
    report.econ.lastShelf = now;
    const afford = offers.filter((o) => o.affordable).length;
    report.econ.docks.push({
      depth: state.levelId,
      bank: state.salvage,
      shelf: offers.length,
      afford,
      dearest: offers.reduce((m, o) => Math.max(m, o.cost), 0),
      // What the WHOLE shelf costs. "Can I afford this one thing" is not
      // the question a shop asks — "can I have all of it" is, and a bank
      // that covers the lot means the visit had no decision in it.
      sweep: offers.reduce((m, o) => m + o.cost, 0),
      // "Too easy to buy things" is not about the whole shelf — it is about
      // whether the DEAREST thing on it is ever out of reach. If it never
      // is, the shop has no choice in it, whatever the totals say.
      topAfford: state.salvage >= offers.reduce((m, o) => Math.max(m, o.cost), 0),
      all: afford === offers.length,
    });
  }
  const buy = (id) => {
    const before = state.salvage;
    Engine.applyOutpostPurchase(state, id);
    if (process.env.ECON) {
      const b = (report.econ.income[state.levelId] = report.econ.income[state.levelId] || { kills: 0, clean: 0, discovery: 0, wrecks: 0, spent: 0, n: 0 });
      b.spent += before - state.salvage;
    }
    report.purchases[id] = (report.purchases[id] || 0) + 1;
  };
  // Buyable means affordable, applicable AND — for a weapon — that there is
  // somewhere to PUT it. The shelf sells things that don't fit (they ride
  // in cargo until a Hold Expansion), and the shop screen says so plainly
  // to a human. The pilots didn't read it: measured, the careful pilot
  // bought a Railgun in 15 runs out of 40 and fired it exactly ZERO times,
  // because a 1x4 spine does not fit a stock hold at ALL and just sat in
  // cargo for the rest of the run. Twenty salvage — the dearest thing in
  // the game — for nothing.
  //
  // A pilot that buys a gun it cannot install isn't a careless pilot, it's
  // a broken instrument: it made the most expensive weapon in the game
  // measure as worthless.
  const offer = (id) => Engine.outpostOffers(state).find((o) => o.id === id);
  const has = (id) => {
    const o = offer(id);
    if (!o || !o.affordable || !o.applicable) return false;
    return o.fits !== false || Engine.WEAPON_SYSTEM_KEYS.indexOf(id) < 0;
  };
  // ...unless we buy the room first. If the thing we want needs space and
  // a Hold Expansion is on this shelf, take the expansion.
  // Buys the Hold Expansion when that's what's blocking a gun. Returns
  // "bought" if it spent anything, so the caller can restart its loop —
  // a purchase changes the shelf AND the salvage, and the greedy pilot's
  // loop was iterating a snapshot taken before both, which threw
  // "not enough salvage" and "not on offer here" out of the engine.
  const roomFor = (id) => {
    const o = offer(id);
    if (!o || o.fits !== false) return "ok";
    const expansion = offer("hardpoint");
    if (!expansion || !expansion.affordable || !expansion.applicable) return "no";
    buy("hardpoint");
    return "bought";
  };

  // 1. A hull you can fight with, before anything else — and at the last
  //    station before the Bulwark, every point of it. There is nothing
  //    after this to save for.
  const lastStop = state.isBoss;
  const floor = lastStop ? state.maxHull : Math.ceil(state.maxHull * 0.6);
  while (state.hull < floor && has("repair")) buy("repair");

  // A greedy pilot buys the first thing it can afford, every time — which
  // is exactly how a run ends up at depth 9 with a full hull, a reactor
  // upgrade, and nothing that can answer what's shooting at it.
  if (PILOT === "greedy") {
    let spent = true;
    while (spent) {
      spent = false;
      for (const o of Engine.outpostOffers(state)) {
        if (!o.affordable || !o.applicable) continue;
        // Same rule as above: don't spend on a gun with nowhere to go.
        if (o.fits === false && Engine.WEAPON_SYSTEM_KEYS.includes(o.id)) {
          const room = roomFor(o.id);
          if (room === "bought") { spent = true; break; } // shelf moved — look again
          if (room === "no") continue;
        }
        buy(o.id);
        spent = true;
        break;
      }
    }
    fitFromCargo(state, report);
    return;
  }

  // 2. A second gun. Until there is one, everything else waits — this is
  //    the single biggest determinant of how deep a run gets.
  const secondGun = () => armedWeapons(state).length >= 2;
  if (!secondGun()) {
    // Which second gun the pilot reaches for. Both paths get played, so a
    // weapon that only looks good on paper shows up here as a worse
    // survival curve rather than a nice-sounding line in a design doc.
    // The roster is six SHAPES now, and the pilot's second gun should be
    // the one that covers what the Autocannon can't — this list was still
    // the old four and could not so much as consider a Mortar.
    const preference =
      process.env.GUN_PREF === "arc"
        ? ["arcBeam", ...wantList(state)]
        : process.env.GUN_PREF === "railgun"
          ? ["railgun", ...wantList(state)]
          : wantList(state);
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
    // Reach before breadth now that a turn fires one gun: the Arc Beam
    // hits things a hex before they reach contact, where another mount is
    // only ever more coverage of ground you already cover.
    // Reach first, and everything else after. Buying the crowd answer
    // early was tried and it's a trap: the Flak Burst costs salvage the
    // ship needs for reach and three charge a shot out of six, and runs
    // that led with it finished a third as often.
    for (const id of wantList(state)) {
      if (has(id)) buy(id);
    }
    // Don't die rich. Anything still on the shelf beats salvage in the
    // hold, and grid space is what lets a late run keep growing at all.
    let spending = true;
    while (spending && state.salvage >= 10) {
      spending = false;
      for (const id of wantList(state)) {
        if (has(id)) {
          buy(id);
          spending = true;
          break;
        }
      }
    }
  }

  fitFromCargo(state, report);
}

// A weapon that landed in cargo is dead weight — fit anything that fits
// now (this is the tap-a-cargo-chip path in the real Hold UI).
function fitFromCargo(state, report) {
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
  let repositions = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (state.status !== "playing") return state.status;

    if (Engine.outpostAvailable(state)) {
      // shop() is reached on EVERY round the ship is standing on the berth,
      // not just the first — so the ECON ledger has to be told which call
      // is the actual visit. Without that it recorded the same shelf several
      // times over and compared it with itself, which reported a shelf-repeat
      // rate that was mostly the harness looking twice.
      shop(state, report, !visitedOutpost);
      visitedOutpost = true;
    }

    const enemies = Engine.livingEnemies(state);
    const healthy = state.hull > state.maxHull / 2;
    const threats = Engine.computeThreatHexes(state);
    const threatened = threats.has(Engine.hexKey(state.playerPos));

    // Shoot whatever is already in reach — anything close enough to hit is
    // close enough to hit you back. A careful pilot doesn't open fire on
    // something it could simply walk away from: shooting costs the round
    // AND leaves you standing where you are, which is the single most
    // common way a good position turns into a bad one.
    // Skill is NOT caution. A pilot that skips fights arrives at depth 8
    // with a clean hull, no salvage and a starting gun — measured, it beat
    // exactly nothing. Skill is taking the fights you WIN: a shot that
    // kills outright, or a trade you can afford, and leaving the rest.
    const raw = bestShot(state);
    const worthIt =
      !raw ||
      PILOT !== "careful" ||
      raw.enemy.hp <= raw.weapon.damage || // it dies this round: always take it
      threatened || // already in its zone — trading beats standing there
      state.hull > 1; // can afford the reply; at one Hull, don't start anything
    const shot = PILOT === "reckless" ? null : worthIt ? raw : null;
    if (process.env.VERBOSE === "2") {
      console.log(
        `    r${round} pos ${state.playerPos.q},${state.playerPos.r} hull ${state.hull} e ${state.energy}` +
          ` | ${enemies.map((e) => `${e.type}@${Engine.hexDistance(state.playerPos, e)}`).join(" ")}` +
          ` | ${shot ? "FIRE " + shot.weapon.id : "-"}`
      );
    }
    if (shot) {
      Engine.setFacing(state, shot.facing);
      Engine.applyFire(state, shot.enemy.id, shot.weapon.id); // one action, one named gun
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
    // (A reckless pilot never waits — that's the whole difference.)
    // Emplacements are the opposite — they never move, so there is no
    // "wait" that helps, only a decision to engage or route around.
    const chasers = enemies.filter((e) => {
      const ship = Engine.enemyShip(e);
      return ship && ship.hasDrive;
    });
    const nearestChaser = chasers.reduce((best, e) =>
      !best || Engine.hexDistance(state.playerPos, e) < Engine.hexDistance(state.playerPos, best) ? e : best
    , null);
    // Don't take a fight standing inside a fixed gun's ring. Chasers come
    // to you wherever you are, so pick the ground: step clear first, THEN
    // let them arrive. This is most of what separates a run that ends at
    // depth 9 from one that finishes.
    // Never take a fight standing where a charged emplacement can reach.
    // Chasers come to you wherever you are, so pick the ground first.
    // Standing inside a charged emplacement's footprint is a choice, and
    // it's the wrong one whether or not anything is chasing you. This used
    // to only fire when a chaser was on the board, which meant a pair of
    // Mortars — emplacements, so no chaser anywhere — got to shell the
    // pilot indefinitely while it walked to the gate. Their shell lands at
    // exactly three, so the way out is often FORWARD, into two: the zone
    // set already knows that, since it lists the hexes a gun really
    // covers rather than everything within its range.
    const zones = Engine.staticKillZones(state);
    if (PILOT === "careful" && zones.has(Engine.hexKey(state.playerPos))) {
      const clear = Engine.legalSublightTargets(state).filter((h) => !zones.has(Engine.hexKey(h)));
      if (clear.length) {
        Engine.applySublight(
          state,
          clear.reduce((best, cand) =>
            !best || Engine.hexDistance(cand, state.exitPos) < Engine.hexDistance(best, state.exitPos) ? cand : best
          , null)
        );
        continue;
      }
    }
    // TAKE THE FIRING POSITION. A pilot that only ever closes or backs off
    // can never use a gun with reach: measured, the careful pilot bought a
    // Railgun in 15 runs out of 40 and fired it exactly ZERO times, because
    // it kept retreating to somewhere nothing bore and then shot whatever
    // walked into its Autocannon. Buying reach and never standing where it
    // works isn't cautious play, it's passive play, and grading the design
    // against it was measuring the harness.
    //
    // So: if nothing bears right now, step to the nearest hex where the
    // best gun aboard WOULD bear on something — preferring hexes that are
    // not themselves under threat. That is what skill with a long gun
    // actually looks like, and it's the only way the shelf's expensive
    // half gets tested at all.
    // Bounded hard, because the first version wasn't and it ate the run:
    // seeking a firing hex every round meant the ship never went to the
    // gate or the dock at all — forty runs, zero finishes, both pilots.
    // It only applies when there is a LONG gun to justify positioning for
    // (a contact weapon's firing hex is just "next to it", which the chase
    // below already handles), and only when that hex is a step or two
    // away. Otherwise the goal wins.
    // ...and capped per sector. Seeking a firing hex has no progress
    // guarantee — the enemies move every round, so the "best" hex moves
    // with them and the ship can chase it until the round limit. Measured,
    // careful's stalls went 6 -> 11 out of 60 when this was uncapped.
    const longGun = armedWeapons(state).some((w) => w.range >= 3);
    if (PILOT !== "reckless" && !shot && longGun && repositions < 6 && Engine.livingEnemies(state).length) {
      const spot = firingSpot(state, threats, 2);
      if (spot) {
        repositions++;
        Engine.applySublight(state, spot);
        continue;
      }
    }
    if (PILOT !== "reckless" && nearestChaser && !threatened && healthy && Engine.hexDistance(state.playerPos, nearestChaser) <= 3) {
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
    const discovery = state.events.find((e) => e.type === "discovery");
    if (discovery) report.discoveries[discovery.kind] = (report.discoveries[discovery.kind] || 0) + 1;
    if (state.status === "won") return "cleared";
  }
  return "stalled";
}

function playRun(seed, report) {
  const LEVELS = Levels.LEVELS;
  const rng = makeRng(seed + 1);
  // START_GUN=<weaponKey> fits that gun from Sector 1, alongside the
  // Autocannon. It's how a weapon's worth gets MEASURED rather than
  // argued about: same pilot, same seeds, one thing different. A bespoke
  // bench was tried first and got written wrong twice — this reuses the
  // pilot that already plays the actual game.
  let carryOver = process.env.START_GUN ? { extraActions: [process.env.START_GUN] } : null;
  if (process.env.ECON) report.econ.lastShelf = null; // a new run has no last shelf
  let depth = 1;
  let variantId = null;
  for (; depth <= BOSS_DEPTH; depth++) {
    const level = depth <= LEVELS.length ? LEVELS[depth - 1] : Levels.generateLevel(depth, variantId);
    let state;
    try {
      // Feeds the playtest's own per-run seed through as the ship's luck
      // seed too, so simulated runs exercise the same run-to-run Outpost
      // variance a real player gets, instead of every run rolling the
      // hand-authored sectors' shop/berth identically.
      state = Engine.createGameState(level, {
        ...(carryOver || {}),
        runSeed: seed,
        hasPrevious: Boolean(carryOver && carryOver.hold),
      });
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
    if (process.env.ECON) report.econ.arrive.push({ depth, bank: salvageIn, out: state.salvage });
    if (process.env.ECON) econMark(state, report, depth);
    if (process.env.VERBOSE) {
      console.log(
        `  d${String(depth).padStart(2)} ${String(outcome).padEnd(8)} hull ${hullIn}->${state.hull}/${state.maxHull}` +
          ` salvage ${salvageIn}->${state.salvage} guns [${armedWeapons(state).map((w) => w.id).join(",")}]` +
          ` enemies ${(level.enemies || []).length} dock ${level.outpost ? "y" : "n"}`
      );
    }
    if (outcome === "lost") {
      // What actually ended it — the last few readout lines are the
      // ship's own account of the final rounds.
      for (const line of state.log.slice(-4)) {
        const key = line.replace(/\d+/g, "N");
        report.deathLines[key] = (report.deathLines[key] || 0) + 1;
      }
      const killers = Engine.livingEnemies(state).map((e) => e.type).sort().join("+") || "none";
      report.deathBoards[killers] = (report.deathBoards[killers] || 0) + 1;
      return { depth, outcome: "died", hull: 0 };
    }
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
      // Carried so the rare-item bad-luck guarantee actually accumulates
      // across a simulated run instead of resetting every sector.
      raresSkipped: state.raresSkipped,
      outpostStockIds: state.outpostStockIds,
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
    deathLines: {},
    deathBoards: {},
    discoveries: {},
    econ: { docks: [], arrive: [], income: {}, repeats: [], repeatBy: {}, lastShelf: null },
    errors: [],
  };
  if (process.env.ECON) econInstrument(report);
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
  console.log("discoveries found:", report.discoveries);
  if (process.env.ECON) {
    const byDepth = (rows, key) => {
      const m = {};
      for (const r of rows) (m[r.depth] = m[r.depth] || []).push(r[key]);
      return m;
    };
    console.log("\nsalvage ledger — bank on ARRIVAL at each sector:");
    const arr = byDepth(report.econ.arrive, "bank");
    for (const d of Object.keys(arr).sort((a, b) => a - b)) {
      console.log(`  sector ${String(d).padStart(2)}  n=${String(arr[d].length).padStart(3)}  avg bank ${avg(arr[d])}`);
    }
    console.log("\nsalvage ledger — income per sector, by source:");
    for (const d of Object.keys(report.econ.income).sort((a, b) => a - b)) {
      const b2 = report.econ.income[d];
      const per = (x) => (x / b2.n).toFixed(1);
      console.log(
        `  sector ${String(d).padStart(2)}  kills ${per(b2.kills).padStart(5)}  clean ${per(b2.clean).padStart(5)}` +
          `  discovery ${per(b2.discovery).padStart(5)}  total ${per(b2.kills + b2.clean + b2.discovery).padStart(5)}` +
          `   | wrecks ${per(b2.wrecks).padStart(4)}  per wreck ${(b2.kills / Math.max(1, b2.wrecks)).toFixed(1)}` +
          `   SPENT ${per(b2.spent).padStart(5)}  banked ${(100 - (b2.spent / Math.max(1, b2.kills + b2.clean + b2.discovery)) * 100).toFixed(0)}%`
      );
    }
    {
      const rs = report.econ.repeats;
      const tot = rs.reduce((a, r) => a + r.n, 0);
      const rep = rs.reduce((a, r) => a + r.same, 0);
      const anyRepeat = rs.filter((r) => r.same > 0).length;
      console.log(
        `\nshelf repeats: ${rep}/${tot} slots (${((rep / tot) * 100).toFixed(0)}%) were on the previous shelf too;` +
          ` ${((anyRepeat / rs.length) * 100).toFixed(0)}% of docks repeated at least one item`
      );
      console.log("  what repeats:", Object.entries(report.econ.repeatBy).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join("  "));
    }
    console.log("\nsalvage ledger — at the SHOP:");
    const docks = {};
    for (const r of report.econ.docks) (docks[r.depth] = docks[r.depth] || []).push(r);
    for (const d of Object.keys(docks).sort((a, b) => a - b)) {
      const rows = docks[d];
      const canBuyAll = rows.filter((r) => r.all).length;
      console.log(
        `  sector ${String(d).padStart(2)}  n=${String(rows.length).padStart(3)}` +
          `  avg bank ${avg(rows.map((r) => r.bank))}` +
          `  avg affordable ${avg(rows.map((r) => r.afford))}/${avg(rows.map((r) => r.shelf))}` +
          `  dearest ${avg(rows.map((r) => r.dearest))}  affordable ${((rows.filter((r) => r.topAfford).length / rows.length) * 100).toFixed(0)}%` +
          `  bank/shelf ${avg(rows.map((r) => r.bank / Math.max(1, r.sweep)))}x` +
          `  whole shelf affordable ${((canBuyAll / rows.length) * 100).toFixed(0)}%`
      );
    }
  }
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log("\nwhat the board looked like at death:");
  for (const [board, n] of top(report.deathBoards, 6)) console.log(`  ${n}x ${board}`);
  console.log("\nlast words:");
  for (const [line, n] of top(report.deathLines, 8)) console.log(`  ${n}x ${line}`);
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
