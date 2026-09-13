# Hypergolic Hull — Design & Build Plan (Handoff Prompt)

You are building **Hypergolic Hull**, a turn-based hex-grid tactics roguelike
(Hoplite-style, rethemed as a space fleet commander). This document is the
complete spec for the core concepts and the first level. Build exactly this;
where this doc is silent, favor the simplest thing that keeps every rule
deterministic.

**Where it lives:** `games/hypergolic-hull/` in this repo. Plain JS + canvas in
`app.js`, no frameworks, no build step. Save progress with
`GCStorage.get/set("hypergolic-hull", key, value)`. Do not modify `shared/`.

---

## 1. Design Pillars (non-negotiable)

1. **Zero randomness in combat.** Every enemy behavior is a published, fixed
   rule. The player dies from misreading the board, never from dice.
2. **One choice per turn.** Exactly one action each turn; depth comes from
   which one, not from action-point bookkeeping.
3. **The board is the UI.** Because everything is deterministic, every hex an
   enemy threatens next turn must be visibly marked. If the player takes
   damage they couldn't have predicted from the screen, that's a bug.
4. **Levels are data, not code.** The engine plays *any* level definition.
   Level 1 is just the first entry in a list. This is what "scalable" means
   here — see §5.

## 2. Player: The Flagship

Starts each run with **3 Hull Points**. 0 = run over (permadeath, back to
title). Each turn, choose exactly one:

| Action | Rule |
|---|---|
| **Sublight Impulse** | Move 1 hex in any of the 6 directions. |
| **Ramming Speed** | Move 1 hex so you end adjacent to an enemy ship: that ship is instantly vaporized. (Kill resolves before enemies act.) |
| **Hyperjump** | Leap over multiple hexes in a straight line, spending warp energy. (Post-MVP: stub the button, ship without it in Level 1.) |
| **Tractor Beam** | Push one adjacent enemy 1 hex directly away. Pushed into another unit, a hazard, or off the map edge → it is destroyed; the collided-with unit takes 1 damage. |
| **Fighter Squadron** | Kill any enemy on the board at range. Your fighters stay on the target's hex; **Ramming Speed is disabled** until you move onto that hex to retrieve them. |

## 3. Enemies (all deterministic)

| Enemy | Rule |
|---|---|
| **Interceptor** | Moves 1 hex per turn toward the player (shortest hex distance; break ties clockwise from direction 0). If the player is adjacent at the start of the enemy phase, it attacks for 1 Hull instead of moving. |
| **Railgun Destroyer** | Fires a straight-line slug down any of the 6 hex axes, unlimited range, **blocked by any other unit**. Telegraphs the line one turn before firing. |
| **Minelayer** | Drops a plasma mine on the player's current hex; the mine detonates at the end of the *next* enemy phase, damaging everything in a 1-hex radius (enemies included). |
| **Carrier** | Fires a straight-line tracking beam: on hit, either deals 1 Hull damage or teleports the player to a marked hex (telegraph which, one turn ahead). |

**Stacked threats stack damage:** ending your turn inside two overlapping
attack zones costs 2 Hull. No cap.

**MVP note:** Level 1 uses Interceptors only. Implement the other three
behind the same enemy interface (`decide(state) → intent`,
`execute(intent)`), but they can land in later milestones.

## 4. Hazards & Outposts

- **Supernova / Black Hole hexes:** entering one is instant destruction
  (later upgrades may grant immunity — design the check as a query, not a
  hardcode). None appear in Level 1.
- **Sector Outpost:** one per level, usable **once per level**. Offers a
  choice: a free basic boost (e.g. repair 1 Hull) **or** a powerful permanent
  module bought by sacrificing 1 *max* Hull. For MVP, offer exactly two
  options: "Repair 1 Hull (free)" and one placeholder module.

## 5. The Scalable Level System (the core deliverable)

The engine must consume a plain-data `LevelDef` and play it. Nothing about
Level 1 may be hardcoded into engine logic.

```js
// levels.js — the ONLY place level content lives
const LEVELS = [
  {
    id: 1,
    radius: 2,                       // hexes: all (q,r) with hexDistance from origin ≤ radius
    playerStart: { q: 0, r: 0 },
    exit:    { q: 2, r: 0 },         // Warp Gate, always on the outer ring
    outpost: { q: -2, r: 0 },
    enemies: [
      { type: "interceptor", q: -1, r: -1 },
      { type: "interceptor", q: 1,  r: 1  },
    ],
    hazards: [],                     // e.g. { type: "blackhole", q, r }
    exitRule: "all-enemies-dead",    // gate unlocks when rule satisfied
  },
  // Level 2, 3… are new entries here — no engine changes.
];
```

**Validation (run on load, throw loudly in dev):**
- Exit and outpost sit on the outer ring (`hexDistance(origin, pos) === radius`).
- No enemy within 2 hexes of `playerStart`.
- No two entities share a hex.

**Growth path (build in this order, all emitting the same `LevelDef` shape):**
1. **Now:** hand-authored `LEVELS` array (Level 1 per this doc; 2–3 later).
2. **Later:** a `generateLevel(depth)` function producing `LevelDef`s from a
   difficulty table — radius 2 → up to 5–7, enemy count/mix and hazard
   density scaling with depth, same spawn-safety rules. Because the
   generator emits the same schema the authored levels use, the engine,
   renderer, and save system never change.

**Note — reconciling the source sketch:** the original notes said "19 tiles"
but placed the outpost/gate at (±3, 0). 19 hexes is a radius-2 board, whose
edge is ±2. This spec resolves it as **radius 2 with outpost (-2,0) and gate
(2,0)** — same shape and intent, coordinates made consistent.

## 6. Level 1 Spec (concrete instance of §5)

19-hex board (radius 2), no hazards, Interceptors only.

- **Flagship** at (0,0), 3 Hull.
- **Sector Outpost** at (-2,0).
- **Warp Gate** at (2,0), locked/offline until both Interceptors are destroyed,
  then it visibly flashes online; moving onto it completes the level.
- **Interceptor 1** at (-1,-1); **Interceptor 2** at (1,1).

**Golden-path scenario — implement this as an automated test** (drive the
engine headlessly with this action sequence and assert every intermediate
state):

1. Player moves Sublight to (1,0). Enemy phase: both Interceptors step 1 hex
   toward the player; neither is adjacent yet → no damage.
2. Player uses Ramming Speed toward Interceptor 2, ending adjacent → it is
   vaporized before the enemy phase. Enemy phase: Interceptor 1 steps in and
   ends **adjacent** to the player.
3. Assert both branches:
   - *Mistake branch:* player moves directly away (or acts elsewhere) →
     Interceptor 1's deterministic strike lands, Hull 3 → 2.
   - *Correct branch:* player uses Tractor Beam (push Interceptor 1 off the
     map edge → destroyed) or Fighter Squadron → no damage taken.
4. With all enemies dead, assert the gate unlocks; player walks to (2,0);
   assert level-complete.

## 7. Technical Foundation

- **Coordinates:** axial `(q, r)`, pointy-top. Store the board as a
  `Map<"q,r", tile>`. Standard math:
  - Neighbors: the 6 fixed direction offsets.
  - Distance: `(abs(q1-q2) + abs(q1+r1-q2-r2) + abs(r1-r2)) / 2`.
- **Turn loop (strict order, no exceptions):**
  1. Wait for a valid player input.
  2. Resolve the player action fully (including instant kills).
  3. Enemy AI decides intents (line-of-sight, ranges) against the *new* state.
  4. Enemy phase executes: moves, attacks, telegraphs placed.
  5. Resolution: apply damage, check death, check exit.
- **State:** one plain serializable `gameState` object (board, entities,
  hull, level id, turn count). Persist run-in-progress and best-depth via
  `GCStorage`. Deterministic rules + serializable state = trivially testable.
- **Rendering:** canvas, pointy-top hexes at a 4:3 pixel ratio (e.g. 32×28)
  so pixel shapes stay crisp; every unit gets a dark outline against floor
  tiles. **Threat overlay is mandatory from milestone 1**: tint every hex an
  enemy will damage next turn.
- **Input:** tap/click a highlighted legal hex to act (this is a
  mobile-installable PWA — no keyboard assumptions). Action buttons
  (Tractor Beam, Fighter Squadron) select a mode, then tap the target.

## 8. Milestones & Acceptance

1. **M1 — Playable core:** hex engine + renderer, Sublight + Ramming Speed,
   Interceptor AI, threat overlay, Level 1 loaded from `LevelDef`,
   win/lose states. *Accepts when the §6 golden-path test passes.*
2. **M2 — Full action kit:** Tractor Beam (with edge/collision kills),
   Fighter Squadron (with retrieval rule), Outpost interaction.
3. **M3 — Content breadth:** Railgun Destroyer, Minelayer, Carrier, hazards,
   hand-authored Levels 2–3, run flow between levels.
4. **M4 — Generation:** `generateLevel(depth)` per §5, endless depth,
   best-depth tracking.

**Out of scope for this pass:** sound, meta-progression between runs,
Hyperjump energy economy, animations beyond basic state feedback.
