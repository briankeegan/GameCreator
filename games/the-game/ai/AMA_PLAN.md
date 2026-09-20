# Mimicking ama

citrus610's `ama` is the only public Puyo bot built for the fight rather
than for a solitaire score, and it is the one that works. What it has that
this bot does not, in the order it costs us, each translated to Panel
Attack.

Every step is measured by `chaincombo.bench.js`, on the two numbers that
only move when an attack pays: `4+ links/min`, which is **0.0** for every
bot we have — shipped, score-trained and island-trained alike — and
`4+ wide/min`, which is **1.5** for the shipped bot against 20.6 combos a
minute total.

## The one difference underneath all four

ama decides what it is TRYING to do and then plays toward it across many
moves. `PuyoCpu._decide` re-derives the world every decision: list every
legal swap, score the board each one leaves, play the highest, keep
nothing. It is a memoryless argmax on board tidiness.

A plan cannot be stored in a coefficient. That is why every weight that was
supposed to buy aggression bought a shorter game instead, and why
`paylessClear` changed nothing.

## Resolves, not shapes

Every "what would this build toward" question here is asked of the engine —
clone the board, swap, `resolve()`, read what came out. `chainPotential`
(`eval/features.js:225`, via `swapOutcomes`) already does exactly that: the
deepest cascade any one legal swap could set off from the board a move
leaves.

The shape features stay cut. We never tell the bot what a chain looks like;
we ask the engine what a swap would do.

## Step 1 — two modes and a fire threshold

No new features, no training, a number the same day.

ama builds below its trigger and fires above it. `PuyoCpu` gains one field
that survives a decision, `mode`:

- **BUILD** — a candidate is dropped from the pool before scoring unless
  its resolve does one of three things: fires a chain of `T` links, makes a
  combo `S` wide, or breaks garbage. Everything left is scored as now.
- **FIRE** — play the swap with the biggest resolve. Entered when the board
  reaches `T` on `chainPotential` or `S` on `comboPotential`, left when the
  cascade is spent.
- **FORCED** — overrides BUILD. Two triggers, and only two: the bot is
  about to die, or the plan broke. Scores the unfiltered pool, which is
  today's bot.

### What FORCED is, and what it is not

FORCED is not a pressure valve. A height threshold is the obvious version
and it is wrong both ways: set low the bot lives in FORCED, which is today's
bot with machinery around it; set high it dies at row 11 holding a five-chain
it never had time to fire. Nothing else gets to open it — not "nothing
survived the filter", which is a reason to hold or keep building, and not a
deep stack on its own.

**About to die** is a deadline, not a height. Runway is rows to the ceiling
over the rise rate, minus the garbage already queued — frames, not rows.
Execution is how long the payoff being saved takes to cash in: the walk
(`travelCost`) plus the cascade (the resolve knows it). FORCED when runway
drops below execution. Out of time, not high.

**The plan broke** means what BUILD was saving for is gone — garbage landed
on it, a rise buried it, `chainPotential` collapsed. It is a real state and
it has to be handled, but it is a DEFECT, not a branch: a broken plan is
work already spent that paid nothing. Count it per game and drive it down.
A build that keeps breaking is a build that was never safe to start.

Which is the real job of step 2. The opponent model is not there so the bot
can flee; it is there so BUILD picks a plan that survives what is already in
the air. Garbage queued against this board is known before it lands, and a
chain that completes before it lands, or sits where it will not be buried,
is the one to build.

### Chains and combos are different weapons

The engine makes the difference, not a convention. `pushGarbage` sends a
chain as ONE piece, full width, height growing a row per link, held until
the cascade ends (`finalized: false`). It sends a combo as SEVERAL pieces,
each one row tall, widths from `COMBO_GARBAGE` — a 6 sends `[5]`, an 8
sends `[3, 4]`, a 12 sends `[6, 6]` — and each leaves immediately.

So they differ in shape (a slab keeps the far surface flat, narrow pieces
make it jagged), in timing (combo pieces land while the chain is still
being built), and in how they are dug out (one object versus several that
break independently).

Which one to fire depends on the opponent: a slab against a healthy board,
a fast combo against one that is nearly out of room. That is opponent-state
crossed with attack-type — an interaction, so it belongs in the mode
selector and not in a weight, and it is NOT written here as a rule.

What the bot needs is to see it. FIRE already has both arms; step 2 adds
the opponent's HEADROOM — rows to their ceiling, plus what is already in
the air at them — as an input to which arm FIRE picks. Training finds the
crossover. It cannot today because the bot sees nothing about the other
board.

### The thresholds end up weighted, not fixed

`fireLinks` and `fireWide` are a FLOOR today: never cash in below four
links or four wide. A floor cannot say "against this opponent, right now, a
fast six-wide beats a five-chain", and in a fight that is the decision that
matters.

The seam for it is the one design choice in step 1: a mode narrows the pool
and the EVALUATOR still picks. So "which weapon" is a weights question, and
three additive changes get there.

1. `fireLinks` and `fireWide` become genome entries rather than constants.
   They are already options carried in `switches.js` beside the weights so
   that this costs nothing when it happens.
2. Features that describe the CHOICE. The bot cannot weigh chain against
   combo because nothing tells it which is on offer; the resolve reports
   depth and width separately and neither is fed in.
3. The opponent's headroom, so the choice has something to be conditional
   on. That is step 2.

WHAT CANNOT BECOME A WEIGHT is the mode itself. "Build now, fire later" is a
statement about time, and a weighted sum prices only the move in front of
it — which is why step 1 is a filter. Everything INSIDE a mode can be
weighted, and that is where the fight lives.

### Not yet: the ceiling on a useful attack

Past the garbage it takes to finish them, a bigger attack is worse than
wasted. Garbage on a board is MATERIAL: a clear next to it converts it to
panels, which can cascade. Over-sending hands the opponent a bigger
counter-chain.

That is a cap on the FIRE threshold once headroom is visible — not new
machinery. Deliberately deferred; noted here so it is not re-derived.

### Thresholds

`T` starts at 4 links, `S` at 4 wide — `comboGarbage()` sends nothing below
4, so a 3 is the thing BUILD is there to refuse. Both arms read the same
resolve: `chainLength` and `comboSizes` come back from the same call.
Nothing is hard-coded about what the board looks like.

The combo arm is not an afterthought. A wide combo is an attack that lands
NOW where a chain has to be built first, and the shipped bot makes 20.6
combos a minute of which only 1.5 are 4-wide or better. Nineteen in twenty
send nothing. Filtering for chains alone would leave that untouched.

`switches.js` carries `T` and the mode toggle, so a run is reproducible and
a bench can turn it off. `chainPotential` costs 14.9 ms per decision
against an 85 ms budget (measured); the filter wants the same resolves the
scorer runs, so resolve once per candidate and cache, never twice.

**Gate:** `4+ links/min` above 0.0 with the shipped weights unchanged, and
`4+ wide/min` above 1.5. If both sit still the modes never fired and
nothing below is worth building.

**The diagnostic that says why.** The bot reports the share of decisions
spent in each mode and the count of broken plans per game. Those are what
separate "the filter is wrong" from "the escape hatch is too wide", which
the two bench numbers cannot tell apart. FORCED at 85% of decisions and a
flat bench is a hatch problem. Broken plans climbing is step 2's problem,
not the filter's.

## Step 2 — the opponent

ama's `gaze` tracks the opponent's attack, its chain and the frame it
lands, and picks a posture from it.

`incomingGarbage` is implemented at `eval/features.js:478` and deliberately
absent from the registry: every candidate in one decision faces the same
incoming, so as a weighted term it contributes the same number to all of
them and cancels out of the ranking — measured, it varied in 0 of 179
decisions. The registry note says using it needs an interaction a weighted
sum cannot express.

A mode switch IS that interaction. Under modes `incomingGarbage` is not a
term, it is the mode input:

- garbage in the air → BUILD prefers a plan that completes before it lands
  or sits where it will not be buried. This is the one that matters: it is
  how broken plans get driven down.
- garbage that cannot be outrun → the runway shrinks, so the about-to-die
  deadline arrives on its own. No separate rule.
- opponent mid-chain → fire now or bank, decided from our own resolve
- opponent's stack already high → keep building, the pressure is on them

The duel holds both boards (`eval/duels.js`, `eval/duel_worker.js`) and the
bot is handed `board.incoming` today (`eval/puyocpu.js:316`) and reads
nothing else about the other side. This is wiring, not engine work.

**Gate:** broken plans per game, down. Then garbage sent per minute while
under attack, and win rate against a peer that dumps garbage — the thing
that beats these bots by hand.

## Step 3 — depth

Depth 2 is what caps chain building; ama runs beam 250 at depth 16.

We do not need 16. In Panel Attack the board is already on screen — there
is no piece queue to plan against — so the depth we need is in the BUILD
direction only: expand only the candidates BUILD kept, rank the beam by
`chainPotential` and `comboPotential` rather than by score, and measure
them at the leaf. A beam over a filtered pool is affordable where a beam over the whole
pool is not.

Not started until steps 1 and 2 have moved `4+ links/min`. A deeper search
of a memoryless scorer only searches harder for the same early fire.

## Step 4 — a weight set per mode

ama carries four (build, fast, all-clear, freestyle). Ours would be BUILD,
FIRE, FORCED. Each is its own genome and the islands train them together,
which multiplies the genome and the fingerprint.

Last. Per-mode weights on modes that do not fire is three ways to be wrong
instead of one.

## What this drops

Every remaining attempt to make one weighted sum hold a plan. The
`pc-s2xx` island chains are stopped. `paylessClear` stays in the registry
as opt-in and off: it is out of `registry.keys`, so it is out of the island
fingerprint and costs nothing sitting there.

Modes change behaviour without changing `KEYS`, so the fingerprint will not
notice. Relaunch islands fresh rather than resuming across the change.
