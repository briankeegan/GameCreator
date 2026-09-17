# Hypergolic Hull — Next-Phase Design Ideas (research-grounded)

Internal working doc. Not user-facing. Reflects the codebase as of this session:
`engine.js` (deterministic combat, weapon-pattern/facing model, `ENEMY_TYPES`,
`OUTPOST_OFFER_POOL`), `levels.js` (5-sector hand-authored tutorial +
`generateLevel(depth)` procedural crawl), `app.js` (canvas renderer, threat
overlay, mode-based targeting for Tractor/Fighter).

> **STATUS, 2026-09-14 — READ THIS BEFORE BELIEVING ANYTHING BELOW.**
> Most of this document was written against a much earlier build and calls
> shipped features "unbuilt". Audited against the code; where the two
> disagree, THE CODE IS RIGHT. Corrected inline below, and in summary:
>
> | this doc says | actually |
> |---|---|
> | Energy "doesn't exist anywhere yet" | core resource — gauge, per-shot cost, both sides of the board |
> | 3 Outpost offers | 24 |
> | "the existing three enemies" | 17 classes |
> | hazards "never used by any level" | asteroid fields on procedural boards (`hazardDelta`) |
> | 2 branch variants | 4 (`only`, `quiet`, `drift`, `aggressive`) |
> | Lance Cannon unbuilt (priority #2) | shipped as Prow Cannon |
>
> **Fixed 2026-09-14** (measured — `node cadence.js`): two of the 17 classes
> could not fire at all, ever. The **Outrider**'s rear arc could never bear
> because `enemyFacing()` derived every heading as "nose at the flagship";
> `facingFrom` now lets a hull fly the heading that brings its armament to
> bear, choosing between nose-on and reversed only, so arcs keep their blind
> sides. The **Sapper** needed four fixes, because `placesSelf` had been
> built for the player and never for the enemy side — the bearing test, the
> phase's re-check before executing, `blastSafe`'s centre, and the drop
> itself. Every armed class lands shots now; win rate moved 26→27 of 60,
> i.e. not at all.
>
> **Owed from v0.720**, still outstanding: that change made enemy reactors
> recharge only on a round the ship held fire, and closed with "some classes
> may need a bigger battery to stay a threat — that's a tuning pass, not
> blocking this." The tuning pass was never done. Every firing-rhythm number
> written in prose predates it, which is why the Picket, Impaler and Railgun
> comments were all wrong until this audit corrected them.
>
> ### Cadence is DERIVED, so never type it from memory
> A class's firing rhythm falls out of its hold — weapon `energyCost`
> against reactor capacity and recharge, plus the hold-to-charge rule. It is
> written down nowhere. `node cadence.js` prints the real thing for every
> class in two seconds; run it before quoting a number. That probe is a
> reporter, not a gate: declaring an expected rhythm per class and failing
> the build when the crates stop producing it is the missing third piece
> (RULE → TOOL → GATE), and is not built.

> **BUILT 2026-09-17 — first slice.** Four Marks, four pirate hulls, and the
> two rules they needed. Measured with `playtest.js 60`:
>
> - Marks, new weapons, the spawn refactor and the split rule, with the new
>   hulls held OUT of the generator: **26 wins in 60** against a 27 baseline.
>   The infrastructure costs nothing.
> - The four hulls across the middle tiers: **11 in 60.** Removing any ONE
>   of them recovered almost nothing (9–15), so no single class was at
>   fault — four new threats at once is simply a large step.
> - The same four confined to the deepest tier: **22 in 60.** Taken. A whole
>   faction at the deep end costing five points is a price, not a defect.
>
> Not yet built: the armoury/manifest, notoriety, and the five hack weapons.
> Until the manifest exists the shelf is still one growing pool, which is
> the trap this plan opens by naming — so no further weapons should reach
> `OUTPOST_OFFER_POOL` before it does.

## VARIETY PLAN — enemies and weapons (2026-09-17)

A menu to choose from, not a queue to work through. It covers what should
exist, how a player gets it, and — the part that decides whether any of it
is an improvement — what shape the content has to have for unlocking it to
be a reward rather than a dilution.

### The reference is Into the Breach and Monster Train, NOT Slay the Spire

Slay the Spire is the obvious model and it is the wrong one, because its
unlock system is the part of it players complain about. Unlocks there drop
new cards into the draft pool, so every unlock makes the pool wider and the
deck you actually want less likely to assemble: "instead of it being a
reward it ends up just being a crutch that lowers odds and cripples
strategies", and speedrunners deliberately keep their accounts under-unlocked
because a smaller pool is a better pool. Rewarding a player with a worse
draw is a trap worth naming before writing a single new weapon.

Two games solve it structurally rather than living with it:

- **Into the Breach** — you unlock SQUADS: fixed, hand-designed sets of three
  mechs. A squad is a whole coherent way to play, you take exactly one per
  run, and unlocking the tenth squad does not make the first one draw worse.
  Pool width per run is constant no matter how much you own.
- **Monster Train** — you pick a primary and an allied clan, and draft from
  those two pools only. Unlocks add cards to a specific clan's pool, so the
  content grows while the width of any single run stays put.

Both replace "one big pool that grows" with "commit to a subset, draft
inside it". That is the rule this plan is built on.

**It matters here specifically, because the shelf is already a weighted draw
from an eligible pool** (`pickOutpostOfferIds`: rarity weights, level gating,
no-repeat-from-last-shelf, carried-item filtering). It is a good system and
it is exactly the system StS's unlocks ruin. Adding fifteen weapons to
`OUTPOST_OFFER_POOL` would make every individual shelf worse while the
changelog said "more variety".

**And the embryo of the ITB answer is already here.** `STARTING_LOADOUTS` —
three kits bought with Requisition, each a different shape of the same
budget rather than a power bump — is a squad system with three squads in it.
Grow that, rather than widening the shelf.

### The unlock model: YOU pick, and the pool never gets wider

The owner's call, and it is also the fix for the Slay the Spire problem
above: **unlocking is curation, not accumulation.**

- **Requisition buys weapons into your ARMOURY** — the permanent list of
  everything you own. Earned as now: depth reached, plus a boss clear.
- **Before a run you fit a MANIFEST: a fixed number of weapon slots (start
  with 6) drawn from the armoury.** The Outpost shelf then only ever offers
  what is on your manifest, plus the always-available basics.
- So the armoury grows forever and **the shelf stays exactly as narrow as it
  is today**. Unlocking your twentieth weapon cannot make the Beam Lance
  harder to find, because you decided whether the Beam Lance was in this
  run at all. This is Monster Train's two-clan draft with the player holding
  the pen, and it turns "what did I unlock" into "what am I building".
- It also makes a bad weapon interesting rather than pollution: you took it
  on purpose, so the run is about making it work.
- Manifest slots themselves are the other thing Requisition can buy — going
  from 6 to 7 is a real, expensive choice about breadth versus focus.

### The other trigger: unspent salvage brings company

The owner's idea, and the rare unlock trigger that is diegetic rather than
bolted on. **Salvage you are CARRYING is notoriety.** Cross a threshold and
pirate-faction hostiles begin appearing in generated sectors; spend at a
dock and it drops.

Hoarding for the expensive gun is currently free — you either can afford
something or you cannot, and waiting costs nothing. This makes waiting cost
something specific, and makes an Outpost a place you go to get SAFER as well
as stronger. It is also the cleanest possible answer to "how do new enemies
start appearing": they appear because of something the player did, visibly,
and can undo.

### New weapons — one idea, not eight gadgets

All eighteen shipped weapons do the same thing: remove hull from a ship at
some geometry. Even the two that deal no damage only shove. So the first
draft of this section was eight unrelated gadgets, and it read like it.

**The thesis: a hostile is a MACHINE WITH PARTS, and you can act on the
parts.** This is not a bolt-on — it is the game's own architecture. Every
enemy carries a real hold of real crates (`ENEMY_TYPES[x].hold`), read by
the same `deriveShip` the flagship uses. Their guns, reactors, drives and
plating are objects already. Nothing has ever been able to touch one.

**A. The hold is a target**

1. **Spike** — hack an adjacent hostile and fire ITS gun, this round, at a
   target you choose. Spends ITS energy, not yours. A Railgun Destroyer
   that has spent five rounds filling its bus is the best weapon on the
   board, and for one round it is yours.
2. **Boarding Grapple** — takes one crate out of its hold and into your
   CARGO. Three constraints, all of them added because the first draft was
   plainly overpowered:
   - **Contact only**, not range two. You have to be next to the thing.
   - **Its bus must be EMPTY.** You cannot board a healthy ship — you drain
     it first, which is what Siphon and Bus Overload are for. That turns the
     rest of this family into its SETUP instead of making them redundant,
     which is what the first version did: stripping a reactor did Bus
     Overload's job, permanently, and paid you for it.
   - **Cargo, not the hold.** The crate is inert until you dock, so there is
     no mid-fight power spike — the payoff lands after the sector, next to
     every other refit decision.

   And the hostile **survives**. It keeps flying and keeps whatever else it
   has, so boarding is not a better way of killing something; it is a
   different thing to want, which is what the always-open Warp Gate has
   always been asking for. It is also the diegetic answer to where weapons
   come from: you take them off the people who were using them.

3. **Drive Cutter** — kills the engine. The chaser becomes scenery. It
   removes a threat without removing a ship, which is the same move the
   always-open Warp Gate already rewards.
4. **Bus Overload** — dumps the reactor rather than disabling one gun, so
   a Carrier's whole armament goes quiet at once and a one-gun hull
   barely notices. The counter scales with how dangerous the target is.
5. **Siphon** — drains their charge into your reactor. The economy
   weapon: makes closing with something worth doing, and makes an
   expensive gun affordable mid-fight rather than only at a dock.

**B. The two from the first draft that earned their place**

6. **Spinal Driver** — free to hold, gains damage every round you do not
   fire it. You become the thing that telegraphs, and hostiles route
   around you the way you route around a charging Railgun.
7. **Wake Mines** — armed charges left on the hex you just vacated. The
   only weapon aimed by walking, so a retreat becomes a threat.

**C. Marks: the same gun at a different price (owner's idea)**

The cheapest content in the game and the thing that makes a manifest slot
a real budget decision. Same shape, same rules, no new art — only the
trade moves:

| Variant | Same as | The trade |
|---|---|---|
| Autocannon Mk II | contact ring | 2 damage for 3 energy and a 2×2 footprint |
| Beam Lance (Short) | lane | reach cut to 2–3, cost cut to 1 |
| Railgun (Light) | lane, board-spanning | 1 damage instead of 2, fires twice as often |
| Flak Burst (Heavy) | contact ring, all targets | 2 damage to everything touching, 5 energy |

A shelf can then offer the gun you already own at a different price, which
is a genuine decision rather than a duplicate.

**Cut from the first draft**, recorded so they are not re-proposed: Chain
Battery and Breaching Charge (both plain damage wearing a hat), Marker
Beam (dry), Grapnel (Grapple & Strip does it and more), Ion Lance
(absorbed into Drive Cutter and Bus Overload), Shard Cannon (fine, but
outside the thesis).

### New enemies — six questions nothing asks

1. **Siege Cruiser** — marks a hex on its turn, hits it at the start of the
   next enemy phase, whatever is standing there. The Into the Breach
   signature this game still lacks. Needs a next-turn overlay distinct from
   `computeThreatHexes`.
2. **Tender** — repairs or re-screens an adjacent hostile each round. The
   first board where kill ORDER matters.
3. **Scavenger** — flies to wrecks and eats the salvage before you reach it.
   Costs you money rather than hull, and is the natural face of the pirate
   faction the notoriety rule summons.
4. **Harrier** — only acts on rounds you moved. Punishes running and rewards
   standing to fight, which is the exact inverse of everything else.
5. **Splitter** — dies into two smaller hulls. Makes "should I kill this at
   all" a real question, which the always-open Warp Gate already supports.
6. **A second faction anchor** — the pirates want the wrecks, so their
   presence turns salvage from free loot into contested loot.

### Open questions, before any of this gets built

- How many manifest slots is right to start at? 6 is a guess. Too few and
  a run is one idea; too many and the manifest stops being a decision.
- Does the armoury start empty, or does everything currently on the shelf
  start unlocked so nobody loses access to a gun they already have? (It
  should be the latter — a feature that takes weapons AWAY on the day it
  ships is not a reward.)
- What is the notoriety threshold, and does it scale with depth? A flat
  number means the rule stops mattering once income grows.
- Do enemies draw from the manifest too? They are built from the same
  crates, so "the pirates are carrying the guns you chose" is available and
  might be either brilliant or miserable.
- Are the eight weapons above the right eight? They were chosen to fill
  gaps in the existing shape table, not because a player asked for them.

## What the research says, and how it maps onto what already exists

- **Into the Breach** is the closest sibling and validates two pillars this
  game already has, independently: combat resolution has zero hidden
  randomness (only enemy *placement* is randomized, never how a hit
  resolves), and — less obviously — **killing is optional**; ITB's real win
  condition is "protect the buildings," not "kill the Vek," which the
  designers chose deliberately as a reaction to disaster movies where
  "the whole city gets demolished but no one cares because the good guys
  won." Hypergolic Hull's "Warp Gate always open, combat only for salvage"
  is the same idea, arrived at independently — worth leaning into further
  rather than walking back. ([GDC postmortem](https://www.gdcvault.com/play/1025772/-Into-the-Breach-Design), [Into the Breach wiki](https://intothebreach.fandom.com/wiki/Missions))
- **Enemy telegraphing** in tactics games works by showing intent one step
  ahead of consequence — a charge-up, a marked tile, a wind-up animation —
  so the player is solving a *known* board, not reacting to a surprise.
  ITB's signature move is enemies that mark a tile *this* turn and hit it
  *next* turn regardless of who's standing there. Hypergolic Hull's current
  threat overlay (`computeThreatHexes`) only shows *this-turn* danger; it
  has no multi-turn telegraph yet. ([Enemy Attacks and Telegraphing](https://www.gamedeveloper.com/design/enemy-attacks-and-telegraphing), [Cardboard Mountain](https://cardboardmountain.com/game-design-sign-posts-and-telegraphing-strategy/))
- **Slay the Spire / FTL**: the map itself is a decision layer separate from
  combat. StS's branching path (multiple routes reconverging) means "map
  pathing is arguably responsible for half of your wins" — routing around
  danger, toward a shop or rest site, is as much the game as the fights are.
  FTL's beacon-jump structure pairs this with short, non-combat *event*
  choices (2-4 outcomes, learned over repeat plays) between fights. Neither
  mechanic exists in Hypergolic Hull yet — right now depth is a single
  linear chain of generated sectors. ([Slay the Spire 2 map guide](https://sts2.untapped.gg/en/guides/how-to-make-the-best-map-choices-in-slay-the-spire-2), [FTL Random Events](https://ftl.fandom.com/wiki/Random_Events))
- **Hades**: procedural run content (room order, boons) sits *around* a
  fixed combat skeleton; the choice-of-3 boon offer is themed per-god, and
  the pick itself is never randomized — you always see and choose among
  known options. **Dicey Dungeons** makes the same point more starkly: it's
  "input randomness," where you see the dice before committing them to
  equipment, so luck is a puzzle constraint, not a hidden outcome. Both
  reinforce the same rule Hypergolic Hull already follows for its Outpost
  (seeded-per-level offers, shown plainly, purchase always succeeds
  deterministically): **randomize what's offered, never what happens when
  you commit.** ([Hades boons](https://www.kokutech.com/blog/gamedev/design-patterns/power-fantasy/hades), [Dicey Dungeons](https://jefklakscodex.com/games/switch/dicey-dungeons/))
- **Risk of Rain 2**'s item stacking shows build variety doesn't require
  new randomness — it requires items/systems that combine differently
  depending on what you already have. Relevant to weapon design below:
  new player systems should interact with existing ones (facing, salvage,
  hazards), not sit in isolation. ([RoR2 item stacking](https://riskofrain2.wiki.gg/wiki/Item_Stacking))

## New weapons/systems

- **Lance Cannon** (forward-only, high damage): `pattern: [0]`, range 2-3,
  damage 2, same `WEAPONS` shape already used by Shockwave/Sentry Beam. It's
  a *trade*, not a strict upgrade over Shockwave's omnidirectional safety —
  you must manage `facing` (already tracked, already player-adjustable via
  `setFacing`) to line up a kill, reintroducing an aiming puzzle Shockwave
  removed. Costs nothing new architecturally: one `WEAPONS` entry, one
  `ALL_ACTIONS` id, one unlock sector.
- **Mine Layer**: deploys a stationary hazard (reuses the existing
  `hazards` array/`hazardAt` machinery) on an adjacent empty hex; detonates
  deterministically the instant any enemy (or the player) enters it — pure
  area denial, no RNG, and reuses infrastructure that already exists for a
  different purpose (blackhole hazards).
- **EMP Pulse**: a non-damage system that disables one adjacent enemy's
  weapon for its next turn (it can still move, per its `movesTowardPlayer`
  rule, but `decideIntent` skips the `attack` branch). This is a genuinely
  new tactical axis — crowd control instead of damage/kill — and composes
  with existing enemies (an EMP'd Sentry becomes safely walkable for one
  turn) rather than replacing them, in the RoR2 stacking sense above.

## Loadout economy: slots + Energy (Clubhouse brainstorm) — BUILT

**Both resources shipped.** Slots became the Hold: a shaped-tile grid where
a piece of equipment's FOOTPRINT is its cost, not an abstract number.
Energy became a real bus — a gauge, a per-shot cost, and a Reactor Core you
spend a whole turn cycling — and it governs BOTH sides of the board, so an
enemy's firing rhythm is its reactor against its gun (see `cadence.js`).
Kept below for the reasoning; read it as history, not as a plan.

- **Slots**: every equipped system (weapon, Shield, Jump, whatever) costs
  slots to carry. Total slot capacity starts small and is raised by
  Outpost/event upgrades — so equipping more things is itself a purchased
  upgrade, not free, and a full loadout forces "what do I drop to fit the
  new thing" decisions. This is the natural enforcement point for the
  `slots` field that's been sitting inert in `WEAPONS` since the start.
- **Energy**: a per-turn(?) resource that active abilities (Shield, Jump)
  spend to trigger, distinct from Hull and separate from salvage (a
  currency vs. a resource that regenerates). ~~This doesn't exist anywhere
  yet.~~ BUILT, and the answers to the open questions are: refills to full
  at every warp jump, never trickles, and comes back mid-sector ONLY by
  spending a turn on the Reactor Core (+1). Since v0.720 enemies play by
  the same rule, which is what gives each class its telegraph.

New item ideas that spend these resources:

- **Shield**: costs Energy to activate (not just a purchased one-shot
  charge like the current Emergency Shield outpost offer — that stays as
  the "buy a charge, banked for later" version; this is an *equipped
  system* you toggle, same pattern as Warpdrive/Shockwave today), absorbs
  1 hit.
- **Random Blink**: costs Energy, teleports to a *random* reachable hex —
  deliberately unpredictable ("you don't even know where you're gonna show
  up"), a genuine exception to "zero randomness in combat" the Clubhouse
  explicitly wants: a high-risk emergency escape, not a precision tool.
  Complements the controlled, straight-line **Hyperjump** logged above —
  same resource pool, opposite risk profile (aimed-but-costly vs.
  free-ish-but-unpredictable).
- **Knockback weapon**: pattern-based like Shockwave/Lance Cannon, but on
  hit it pushes the target back instead of (or in addition to) damaging
  it — deliberately a double-edged tool: knocking a threat out of adjacency
  saves you a hit, but can also shove a low-HP target out of the very
  range you needed to finish it, or push it into a worse position for
  *you*. "Make that bad or good" depending on how it's used, per the
  Clubhouse note — not a strict upgrade over existing weapons, a different
  shape of tool.

**Refits only at dock (Clubhouse, 2026-07-25 — agreed direction, park for
a dedicated discussion before building):** swapping equipment in and out
(the Systems screen's arm/disarm toggles, and any future install/uninstall)
should require being docked at an Outpost/base — "it doesn't really make
sense for you to be able to change mid route." Today the toggles are free
mid-flight; when the equipment roster grows past a handful of items, gate
the refit UI on `outpostAvailable(state)`. Related, from the same
conversation and now BUILT: the console's action buttons are the equipped
items themselves (weapon name / All Weapons, Reactor Core, Shield
Generator, Engines), fully derived from the loadout — including the
deliberately absurd freedom that everything, even engines, is notionally a
slot. Different engines (longer moves) and better reactors (bigger
per-cycle recharge than the standard core's +1) are the intended first
proofs of that dynamism.

**The Hold (Clubhouse 2026-07-25 — Phase 1 BUILT):** the Systems screen
is a ship-silhouette grid of shaped equipment tiles (drag-and-drop while
docked, view-only mid-flight; cargo strip = aboard-but-inert; capabilities
derive entirely from what's installed — no drive, no moving). Phased plan:
Phase 1 (built) = starter roster only (Shockwave 2×1, Lance 1×3, Repulsor
2×1, Tractor 1×2, Reactor Core 2×2, Sublight Drive 1×3, Shield Generator
2×2), enemies carry `fitted` loadouts shown on Scan. Phase 2 = first new
items — Flak Array 2×2 (hits all in reach), Capacitor Bank 1×2 (+2 max
Energy), Ablative Plating 1×2 (+1 max Hull), Ion Drive 2×3 (2-hex moves);
roster brainstorm also logged: Torpedo Rack (hex-aimed, ammo), Rail Lance
1×4, Fusion Core 2×3 (+2/cycle), Jump Coil, Salvage Scoop 1×1, Repair Bay
2×2. Phase 3 = Outpost shelves as drag-source (buying = dragging aboard)
+ enemy equipment drops from the same pool.

**Two unifying principles from this conversation:**
- **Enemies should draw from the same pool the player does.** Instead of a
  separate "enemy design space," a Shielded Interceptor, a Knockback
  Sentry, or an enemy that Blinks are just the same items/weapons above
  equipped on the other side — which then makes an item-*theft* mechanic
  meaningful (a Tractor-Beam-style "steal the equipped item" action lifts
  something an enemy was using and puts it in your own loadout instead of
  destroying it outright).
- **Power should cost proportionally, and synergies should be
  discoverable, not designed-in explicitly.** The strongest items need the
  highest salvage/Energy/slot cost — no strictly-free upgrades — and
  individual items should be simple enough in isolation that their
  *combinations* are what create depth (Risk of Rain 2's item-stacking
  model, already cited above), rather than trying to hand-author every
  interesting combo directly.

## New enemy types / factions

- **Siege Cruiser** (the ITB-style telegraph enemy): on its turn it *marks*
  a hex within range instead of attacking immediately; the mark resolves as
  a hit at the *start* of the following enemy phase, hitting whatever's
  there then — not the hex it was standing over when it decided. This
  requires a genuinely new overlay layer (a "next-turn" threat prediction,
  distinct from `computeThreatHexes`'s current-turn view) but is the single
  most distinctive mechanic ITB is known for and this game doesn't have yet.
- **Drone Carrier**: a stationary emplacement (like Sentry) that spawns a
  cheap 1-hp drone every N turns on a deterministic schedule — creates
  escalating pressure and an explicit "kill the source" incentive without
  adding randomness to spawn *timing*.
- **A second faction, framed narratively** (see below): the existing
  enemies — ~~three (Interceptor, Cruiser, Sentry)~~ **seventeen** now,
  each with its own sprite — already read as one cold,
  mechanical faction via their shared color/silhouette language in
  `app.js` (`ENEMY_SPRITES`, with the procedural shapes as fallback). The
  Salvager is the closest thing to the counterpoint this bullet wants and
  is already unarmed on purpose. A second
  faction — say, salvager-pirates who *want* the wreck salvage you're
  collecting — reframes "kill for salvage" as **contested** salvage rather
  than free loot, and gives Outposts/events a "good guys" counterpart to
  the hostile Wardens.

## Meaningful choices beyond combat

- **Branching sector map — BUILT.** Every procedurally-generated sector now
  offers 2 Warp Gates (`levels.js`'s `BRANCH_VARIANTS`, `engine.js`'s
  `exits`/`usedExitVariant`), each consistently biasing enemy count/hazard
  count/Outpost odds for whatever it leads to. Deliberate departure from
  the visible-text-tags version originally sketched here: Clubhouse
  feedback asked for "color coordinated, but maybe not tell people," so
  the difference is real but never labeled in the legend or anywhere else
  in the UI — discovered by flying them, not read off a tooltip. ~~Still
  open: only 2 variants exist (aggressive/quiet)~~ — FOUR now (`only`,
  `quiet`, `drift`, `aggressive`); an FTL-style no-combat event node is
  still the natural next entry in the same
  `BRANCH_VARIANTS` array. Branching is scoped to procedural depth only —
  the hand-authored campaign stays linear on purpose (see below).
- **Event nodes**: FTL-style non-combat encounters with 2-4 known,
  deterministic outcomes (no hidden dice — pick a branch, get its stated
  result), e.g. "A derelict escort offers to merge crews: +1 Max Hull, but
  Shockwave is offline for this sector." Costs no turns, like the Outpost.
- ~~**Expand `OUTPOST_OFFER_POOL`**: currently 3 offers (repair/reinforce/
  shield)~~ — LARGELY BUILT: **24** offers now, seeded per-level and
  staggered by sector. What is still missing from this idea is the
  *shape* the rest of the bullet describes: every offer is a straight
  buy, so there is still no push/pull trade-off offer (e.g. "+1 Max Hull,
  but -1 salvage per future kill this run") and no pick-one-of-two
  weapon-upgrade offer. That, not the count, is what would make a dock a
  build decision rather than a top-up.
- ~~**Hazard terrain (lava-style blocked tiles)**: ... has never actually
  been used by any level — every board today is open floor.~~ — BUILT for
  procedural boards: asteroid fields are placed via `hazardDelta` on each
  `BRANCH_VARIANTS` entry, `drift` sectors run hazard-heavy on purpose, and
  `isBlockingHazard` gives them two flavours (an asteroid blocks shots and
  movement; a black hole kills on entry). Still true and still worth doing:
  the five HAND-AUTHORED sectors are all `hazards: []`, so the tutorial
  never teaches terrain at all — a player meets their first asteroid in the
  procedural crawl with nothing having introduced it.
- **Hyperjump**: in the *original* design doc as a stubbed, disabled action
  ("leap over multiple hexes in a straight line, spending warp energy"),
  deferred for MVP and never revisited. A real "jump a blocked lane"
  tool — leap in a straight line over intervening hexes (enemies,
  hazards, whatever's in the way) to a landing hex beyond them, at an
  Energy/cooldown cost. Distinct from Warpdrive (adjacent-only) and
  Tractor Beam (moves the *enemy*, not you) — this is the player's own
  "skip past" tool, and reuses the existing `facing`/direction-index
  machinery for aiming the jump.
- **Randomized modifiers, not just strict upgrades** (Clubhouse feedback:
  "fun mechanics you could randomly get that would change the game, both
  improve or make things worse") — Hades' Chaos boons and Risk of Rain 2's
  mixed-blessing items both use *real trade-offs*, not just numbers going
  up, to keep runs from converging on one "best" build. Concretely: an
  Outpost or event offer that's net-positive in one stat and net-negative
  in another (e.g. "Overcharged Core: Shockwave damage +1, but Max Hull
  -1" or "Salvage Magnet: +50% salvage from kills, but the Warp Gate
  takes 1 extra turn to warp through"). Still fits the "randomize the
  menu, never the outcome" rule — the trade-off's terms are fixed and
  shown before you commit, only *which* trade-offs are on offer varies.

## Where randomness belongs vs. must stay deterministic

- **Never randomize**: damage values, hit resolution, enemy AI decisions
  (`decideIntent` must stay a pure function of state), or anything that
  happens *after* the player commits an action. This is non-negotiable per
  the game's own pillar and per every cited example (ITB, Dicey Dungeons'
  "input randomness," Hades' fixed-choice boons).
- **Fine to randomize (all already precedented by the existing seeded-RNG
  pattern in `generateLevel`/`pickOutpostOfferIds`)**: sector layout and
  enemy mix/count (already done), which branch-map options are offered,
  which event node appears, which second Outpost offer is on the table
  (already done), enemy *placement* (already done). The rule of thumb from
  the research: **randomize the menu, never the outcome of an order.**

## Narrative/theming

The sci-fi reskin currently only shows up in art (`SECTOR_BG`, ship
sprites) and flavor lines (`intro`). Both `drawEnemyFighter`/`drawCruiser`/
`drawSentry` already visually unify Interceptor/Cruiser/Sentry as one cold
automated faction — that's a foundation, not a coincidence, and it's worth
naming on purpose (e.g. "the Wardens," an automated system-defense grid you
salvage from). A second, opposing faction (salvager-pirates, or a
"friendly convoy" that shows up in event nodes offering trades) gives the
crawl an actual "good guys vs. bad guys" axis instead of undifferentiated
hostiles, and gives Outpost/event flavor text somewhere to point.

## Prioritization: highest impact, least implementation risk

This list is STALE — its top two items shipped. Left in place because the
reasoning is still useful, struck through so nobody works them again.

0. ~~**Fix the two classes that cannot fire** (Outrider, Sapper)~~ — DONE, see the STATUS block. Was not on
   the original list because it was written before either existed. It
   outranks everything below it: two of seventeen hostiles are currently
   free salvage. See the STATUS block at the top for the shared cause.
1. ~~**Expand Outpost offers**~~ — the POOL shipped (24 offers); the
   trade-off and pick-one-of-two *shapes* it describes did not, and those
   were the actual point. Re-scoped above.
2. ~~**Lance Cannon** (forward-only weapon)~~ — SHIPPED as the **Prow
   Cannon** (6 salvage, 1⚡, `FORWARD_ARC_PATTERN`), the cheapest gun in
   the game and the only one where facing matters.
3. ~~**Branching sector map**~~ — BUILT (see above).
4. **Narrative naming pass** (name the existing enemy faction, add a
   couple of intro/flavor lines) — near-zero risk, pure text/data, and
   makes every other proposal land better.
5. **Siege Cruiser** (telegraphed delayed-hit enemy) — medium risk (needs
   a new "next-turn" overlay distinct from `computeThreatHexes`) but is
   the most distinctive Into-the-Breach-style mechanic still missing, and
   most directly extends the "zero randomness, board is the UI" pillar.
