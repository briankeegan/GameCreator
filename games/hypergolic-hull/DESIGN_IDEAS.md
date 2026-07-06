# Hypergolic Hull — Next-Phase Design Ideas (research-grounded)

Internal working doc. Not user-facing. Reflects the codebase as of this session:
`engine.js` (deterministic combat, weapon-pattern/facing model, `ENEMY_TYPES`,
`OUTPOST_OFFER_POOL`), `levels.js` (5-sector hand-authored tutorial +
`generateLevel(depth)` procedural crawl), `app.js` (canvas renderer, threat
overlay, mode-based targeting for Tractor/Fighter).

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

## Loadout economy: slots + Energy (Clubhouse brainstorm, unbuilt)

This is a bigger system than the items below — worth designing properly
before building, not a quick add. Two currency-like resources, both already
half-modeled in the data (`WEAPONS[x].slots` and `.energyCost` have existed
on every weapon entry since the first version, never enforced):

- **Slots**: every equipped system (weapon, Shield, Jump, whatever) costs
  slots to carry. Total slot capacity starts small and is raised by
  Outpost/event upgrades — so equipping more things is itself a purchased
  upgrade, not free, and a full loadout forces "what do I drop to fit the
  new thing" decisions. This is the natural enforcement point for the
  `slots` field that's been sitting inert in `WEAPONS` since the start.
- **Energy**: a per-turn(?) resource that active abilities (Shield, Jump)
  spend to trigger, distinct from Hull and separate from salvage (a
  currency vs. a resource that regenerates). Needs its own design pass —
  regen rate, cap, whether it's per-turn or per-sector — this doesn't
  exist anywhere yet (the original design doc explicitly scoped
  "Hyperjump energy economy" out of MVP and it was never revisited).

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
- **A second faction, framed narratively** (see below): the existing three
  enemies (Interceptor, Cruiser, Sentry) already read as one cold,
  mechanical faction via their shared color/silhouette language in
  `app.js` (`drawEnemyFighter`/`drawCruiser`/`drawSentry`). A second
  faction — say, salvager-pirates who *want* the wreck salvage you're
  collecting — reframes "kill for salvage" as **contested** salvage rather
  than free loot, and gives Outposts/events a "good guys" counterpart to
  the hostile Wardens.

## Meaningful choices beyond combat

- **Branching sector map**: instead of one `generateLevel(depth)` per
  depth, generate 2-3 candidate next-sectors with visible tags before the
  player commits (e.g. "Debris Field — more salvage, more hostiles" vs
  "Quiet Lane — fewer enemies, no Outpost" vs "Distress Signal — event
  node, no combat"). This is the StS/FTL structural pattern and the
  highest-leverage single addition — it turns "keep flying forever" into a
  run with actual navigation decisions.
- **Event nodes**: FTL-style non-combat encounters with 2-4 known,
  deterministic outcomes (no hidden dice — pick a branch, get its stated
  result), e.g. "A derelict escort offers to merge crews: +1 Max Hull, but
  Shockwave is offline for this sector." Costs no turns, like the Outpost.
- **Expand `OUTPOST_OFFER_POOL`**: currently 3 offers (repair/reinforce/
  shield), already seeded per-level — the cheapest possible extension.
  Add a weapon-upgrade offer (choose one of two permanent weapon buffs,
  StS-card-style) and a push/pull trade-off offer (e.g. "+1 Max Hull, but
  -1 salvage per future kill this run") to make Outpost visits a real
  build decision, not just a top-up.
- **Hazard terrain (lava-style blocked tiles)**: the design doc's original
  `hazards` concept (instant destruction on entry, `hazardAt`/`checkPlayerHazard`
  already implemented in `engine.js`) has never actually been used by any
  level — every board today is open floor. This is a real, already-built
  system sitting unused. Adding hazard tiles to generated/hand-authored
  levels (visually distinct — the Hoplite reference screenshots used lava)
  gives boards actual terrain variety and forces real routing decisions
  (the Tractor Beam pushing an enemy into one becomes a genuine tactic, not
  just theoretical). Low risk: no engine changes, only level data +
  rendering a hazard tile distinctly (reuse the outpost/gate custom-art
  treatment, not an emoji).
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

1. **Expand Outpost offers** (weapon-upgrade choice + a trade-off offer) —
   trivially low risk, the extension point already exists
   (`OUTPOST_OFFER_POOL` + one `switch` arm in `applyOutpostPurchase`).
2. **Lance Cannon** (forward-only weapon) — low risk, pure data addition
   using the existing `WEAPONS`/`pattern`/`facing` system; reuses
   `setFacing` already built for exactly this purpose.
3. **Branching sector map** (2-3 tagged next-sector choices) — moderate
   risk (new inter-sector UI screen) but the single highest-impact change
   for run variety; doesn't touch the combat engine at all.
4. **Narrative naming pass** (name the existing enemy faction, add a
   couple of intro/flavor lines) — near-zero risk, pure text/data, and
   makes every other proposal land better.
5. **Siege Cruiser** (telegraphed delayed-hit enemy) — medium risk (needs
   a new "next-turn" overlay distinct from `computeThreatHexes`) but is
   the most distinctive Into-the-Breach-style mechanic still missing, and
   most directly extends the "zero randomness, board is the UI" pillar.
