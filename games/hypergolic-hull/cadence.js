// cadence.js — what rhythm does each enemy class ACTUALLY fire at?
//
//   node games/hypergolic-hull/cadence.js
//
// WHY THIS EXISTS. A class's firing rhythm is DERIVED, never declared: it
// falls out of the crates in its hold (weapon energyCost against reactor
// capacity and recharge rate) plus the rule that a reactor only ticks on a
// round its ship held fire. Nothing in the data says "fires every third
// round" — so the only place that number was ever written down was English
// prose in a comment, typed by hand, and every one of them had drifted:
//
//   picket   — comment said one-in-three on a Siege Lance and one reactor;
//              it carries a Beam Lance and three, and fires every OTHER
//              round. (There is no siegeLance in WEAPONS at all.)
//   impaler  — comment said every fourth round, "those three rounds are the
//              whole counterplay"; two reactors, so every THIRD.
//   railgun  — enemyPhase said "a 4-energy slug IS the four-round
//              telegraph"; the slug costs 5 and it fires one round in six.
//
// All three were written when reactors ticked for free every round, and
// none was revisited when v0.720 made recharging cost the turn. A derived
// number asserted in prose is a number nobody can check, so it rots
// silently — this prints the real thing instead, in two seconds.
//
// TWO RIGS, AND THAT IS THE WHOLE DESIGN. The first version of this probe
// used one: a flagship standing still at distance 3. It reported FOUR
// classes as never firing, and three of those were the probe being wrong,
// which is the failure mode that gets a checker switched off in a week —
//   sentry   is an emplacement whose Arc Beam only reaches EXACTLY 2, and
//            it has no drive, so a distant player it cannot approach is a
//            board it can never shoot on;
//   sapper   mines the hex it stands on (range 0) — the damage happens
//            when somebody WALKS INTO the charge, which a stationary
//            flagship never does;
//   salvager carries a damage-0 Tractor Beam and no gun at all, on
//            purpose, so "landed nothing" is the correct answer for it.
// So: unarmed hulls are classified from their hold and never counted as
// silent, and every armed one is tried BOTH standing off and walking in.
// A class is only reported silent if it has a damaging weapon and lands
// nothing in either rig — which leaves TWO, outrider and sapper, and they
// are broken for one shared reason: enemyWeaponsBearing asks "is the
// flagship standing inside this weapon's footprint?", which is the wrong
// question for a gun that does not point at a ship.
//   outrider — rear arc, and enemyFacing() always points the nose at the
//              flagship, so the flagship is never behind it;
//   sapper   — scuttlingCharge is range 0 (it mines the hex it stands on),
//              and the flagship can never stand on an enemy's hex.
// Both come out with an empty `bearing` list on every board, forever, and
// fall through to chasing you with a gun they will never fire. Verified
// adjacent at full energy: bearing = []. See ENEMY_TYPES.outrider.
//
// It is a PROBE, not a gate: it reports, it asserts nothing. Declaring an
// expected rhythm per class and failing the build when the crates stop
// producing it is the real fix and is not built yet.
"use strict";

const Engine = require("./engine.js");

const ROUNDS = 14;

function buildLevel(cls, separation) {
  return {
    id: 99,
    name: "cadence probe",
    board: { type: "rect", cols: 5, rows: 9 },
    playerStart: { q: 2, r: 3 },
    exit: { q: 0, r: 0 },
    outpost: null,
    enemies: [{ type: cls, q: 2, r: 3 + separation }],
    hazards: [],
    exitRule: "all-enemies-dead",
    actions: ["sublight"],
  };
}

// One class alone against a flagship that cannot die. `approach` decides
// the rig: false = stand off and let it come (a clean read of a chaser's
// rhythm), true = walk straight at it (the only way an emplacement or a
// hex-mining hull ever gets to act).
function run(cls, separation, approach) {
  let state;
  try {
    state = Engine.createGameState(buildLevel(cls, separation));
  } catch (err) {
    return null; // geometry this class/board can't express; other rigs cover it
  }

  const marks = [];
  for (let i = 0; i < ROUNDS && state.status === "playing"; i++) {
    // Immortal on purpose: we are measuring the shooter's rhythm, not how
    // long a 3-hull flagship survives it.
    state.hull = 999;
    state.maxHull = 999;
    const before = state.hull;

    let acted = false;
    if (approach) {
      const enemy = Engine.livingEnemies(state)[0];
      if (enemy) {
        const here = Engine.hexDistance(state.playerPos, enemy);
        const step = Engine.legalSublightTargets(state)
          .map((t) => ({ t, d: Engine.hexDistance(t, enemy) }))
          .filter((c) => c.d < here)
          .sort((a, b) => a.d - b.d)[0];
        if (step) {
          try {
            Engine.applySublight(state, step.t);
            acted = true;
          } catch (_) {
            /* fall through to holding */
          }
        }
      }
    }
    if (!acted) Engine.applyEndTurn(state);

    marks.push(state.hull < before ? "X" : ".");
  }
  return marks.join("");
}

// The gap between consecutive shots, when it is one stable number.
function describe(marks) {
  const hits = [];
  for (let i = 0; i < marks.length; i++) if (marks[i] === "X") hits.push(i);
  if (hits.length === 0) return { shots: 0, label: "—" };
  if (hits.length === 1) return { shots: 1, label: "1 shot" };
  const gaps = hits.slice(1).map((h, i) => h - hits[i]);
  if (gaps.every((g) => g === gaps[0])) return { shots: hits.length, label: `every ${gaps[0]}` };
  return { shots: hits.length, label: `${hits.length} shots` };
}

// Best result across the separations a class might need — an Arc Beam that
// only reaches exactly 2 needs a different start than a Railgun.
function best(cls, approach) {
  let top = { shots: 0, label: "—", marks: ".".repeat(ROUNDS) };
  for (let sep = 2; sep <= 5; sep++) {
    const marks = run(cls, sep, approach);
    if (!marks) continue;
    const d = describe(marks);
    if (d.shots > top.shots) top = { ...d, marks };
  }
  return top;
}

const rows = [];
const silent = [];

for (const cls of Object.keys(Engine.ENEMY_TYPES)) {
  const ship = Engine.enemyShip({ type: cls, hull: 1 });
  const guns = ship.weapons || [];
  const armed = guns.some((w) => w.damage > 0);

  const standoff = best(cls, false);
  const walkIn = best(cls, true);
  const winner = walkIn.shots > standoff.shots ? walkIn : standoff;
  const rig = !armed ? "" : walkIn.shots > standoff.shots ? "walk-in" : "stand-off";

  let verdict;
  if (!armed) verdict = "UNARMED (by design)";
  else if (winner.shots === 0) {
    verdict = "NEVER FIRES";
    silent.push(cls);
  } else verdict = winner.label;

  rows.push({ cls, ship, marks: armed ? winner.marks : "".padEnd(ROUNDS, "."), verdict, rig });
}

console.log(`=== firing rhythm, ${ROUNDS} rounds, one class at a time ===\n`);
console.log(
  ["class".padEnd(15), "cap".padEnd(4), "regen".padEnd(6), "rhythm".padEnd(16), "fires".padEnd(22), "rig"].join("")
);
for (const r of rows) {
  console.log(
    [
      r.cls.padEnd(15),
      String(r.ship.maxEnergy).padEnd(4),
      String(r.ship.rechargeGain).padEnd(6),
      r.marks.padEnd(16),
      r.verdict.padEnd(22),
      r.rig,
    ].join("")
  );
}

if (silent.length) {
  console.log(
    `\nSILENT — armed, and landed nothing in either rig: ${silent.join(", ")}.` +
      `\nA class that never fires is a salvage pinata, not a threat.`
  );
} else {
  console.log("\nevery armed class landed at least one shot.");
}
