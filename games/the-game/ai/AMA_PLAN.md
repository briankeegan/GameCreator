# Mimicking ama

citrus610's `ama` is the only public Puyo bot built for the fight rather
than for a solitaire score, and it is the one that works. What it has that
this bot does not, in the order it costs us, each translated to Panel
Attack.

Every step is measured by `4+ links/min` from `chaincombo.bench.js`. That
number is **0.0** for every bot we have — shipped, score-trained and
island-trained alike.

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

- **BUILD** — a candidate whose resolve fires a chain shorter than `T`
  links and breaks no garbage is dropped from the pool before scoring.
  Everything left is scored exactly as now.
- **FIRE** — play the swap with the deepest resolve. Entered when the
  board's `chainPotential` reaches `T`, left when the cascade is spent.
- **FORCED** — overrides BUILD: no build candidate survives the filter,
  `maxHeight` past a line, or garbage about to land. Scores the unfiltered
  pool, which is today's bot.

`T` starts at 4. Nothing is hard-coded about what the board looks like —
the resolve decides.

`switches.js` carries `T` and the mode toggle, so a run is reproducible and
a bench can turn it off. `chainPotential` costs 14.9 ms per decision
against an 85 ms budget (measured); the filter wants the same resolves the
scorer runs, so resolve once per candidate and cache, never twice.

**Gate:** `4+ links/min` above 0.0 with the shipped weights unchanged. If
it is still 0.0 the modes never fired and nothing below is worth building.

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

- garbage landing within N frames → FORCED, whatever the chain potential
- opponent mid-chain → fire now or bank, decided from our own resolve
- opponent's stack already high → keep building, the pressure is on them

The duel holds both boards (`eval/duels.js`, `eval/duel_worker.js`) and the
bot is handed `board.incoming` today (`eval/puyocpu.js:316`) and reads
nothing else about the other side. This is wiring, not engine work.

**Gate:** garbage sent per minute while under attack, and win rate against
a peer that dumps garbage — the thing that beats these bots by hand.

## Step 3 — depth

Depth 2 is what caps chain building; ama runs beam 250 at depth 16.

We do not need 16. In Panel Attack the board is already on screen — there
is no piece queue to plan against — so the depth we need is in the BUILD
direction only: expand only the candidates BUILD kept, rank the beam by
`chainPotential` rather than by score, and measure `chainPotential` at the
leaf. A beam over a filtered pool is affordable where a beam over the whole
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
