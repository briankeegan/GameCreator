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
supposed to buy aggression bought a shorter game instead.

## Resolves, not shapes

Every "what would this build toward" question here is asked of the engine —
clone the board, swap, `resolve()`, read what came out. The `reach` family
is exactly that, size by size: can the board this move LEAVES fire a
4-combo, a 5-combo, ... a 2-chain, ... an 8-chain. At depth 2 the search has
already resolved those boards, so the answers are read off its own children
rather than swept a second time.

The shape features stay cut. We never tell the bot what a chain looks like;
we ask the engine what a swap would do.

## Step 1 — the pool refuses the worthless clear

`PuyoCpu` carries one field that survives a decision, `mode`. It is a
filter on the candidate pool, and the evaluator always picks from what is
left.

- **BUILD** — a candidate is dropped before scoring unless its resolve does
  one of three things: clears nothing, breaks garbage, or meets the bar
  (`T` links or `S` wide). Hold clears nothing, so hold always survives.
- **FIRE** — the same pool. It records that something reached the bar; it
  does not change which moves are on the list. Narrowing to the moves that
  fire took hold off the list, so a bot with a two-chain available could not
  decline it and grow the material — it sold the smallest chain that
  existed, every time one existed.
- **FORCED** — overrides both. Two triggers and only two: the bot is about
  to die, or the plan broke. Narrows to the moves that survive and lets the
  weights pick among them; with no survivor the unfiltered pool stands.

WHEN TO FIRE IS NOT IN HERE. It is carried by the weights, one per payout
size — `reach4combo`..`reach10combo` and `reach2chain`..`reach8chain`. A bot
that has learned a 5-chain is worth waiting for declines the 2-chain by
scoring the hold higher.

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
on it, a rise buried it, what the board could reach collapsed. It is a real state and
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
a fast combo against one that is nearly out of room. It is NOT written here
as a rule.

What the bot needs is to see it, and it does: one weight per payout size for
what this move leaves reachable, and `pressure` and `overkill` for what the
send is worth against the board it is aimed at. Training finds the
crossover.

### Which weapon, and when, are weights

`T` and `S` are a floor on what counts as paying — never a bar on which
payout to take, and never a trigger that makes the bot act. A floor cannot
say "against this opponent, right now, a fast six-wide beats a five-chain",
so nothing asks it to.

That question is answered by three things, all of them in the genome:

1. One weight per payout size for what this move LEAVES reachable —
   `reach4combo`..`reach10combo`, `reach2chain`..`reach8chain`. Chain
   against combo, size by size, never bucketed.
2. `pressure` and `overkill`: this move's send over the opponent's
   remaining room, and the send past what finishes them.
3. Hold is always a candidate, so declining is a move the weights can
   choose and not a state the filter has to enter.

Making `T` and `S` themselves genome entries was in this plan and is
dropped: the reach weights already carry what it was for, and a threshold
that also gates the pool is a second place for the same decision to live.

### Not yet: the ceiling on a useful attack

Past the garbage it takes to finish them, a bigger attack is worse than
wasted. Garbage on a board is MATERIAL: a clear next to it converts it to
panels, which can cascade. Over-sending hands the opponent a bigger
counter-chain.

That is a cap on the FIRE threshold once headroom is visible — not new
machinery. Deliberately deferred; noted here so it is not re-derived.

### Thresholds

`T` is 2 links, `S` 4 wide. `comboGarbage()` sends nothing below 4 and
`SCORE_CHAIN_TA` pays a 2-chain 50 while sending a full-width slab, so the
bar is the floor of what pays anything and a 3 is the thing BUILD is there
to refuse. Both arms read the same
resolve: `chainLength` and `comboSizes` come back from the same call.
Nothing is hard-coded about what the board looks like.

The combo arm is not an afterthought. A wide combo is an attack that lands
NOW where a chain has to be built first, and the shipped bot makes 20.6
combos a minute of which only 1.5 are 4-wide or better. Nineteen in twenty
send nothing. Filtering for chains alone would leave that untouched.

`switches.js` carries `T` and the mode toggle, so a run is reproducible and
a bench can turn it off. The filter wants the same resolves the scorer
runs, so resolve once per candidate and cache, never twice: read off the
search it costs 16.2 ms a decision against an 85 ms budget, swept
separately 166 ms.

**Gate:** `4+ links/min` above 0.0 with the shipped weights unchanged, and
`4+ wide/min` above 1.5. If both sit still the modes never fired and
nothing below is worth building.

**RESULT.** Shipped weights unchanged, depth 2 beam 0 rise on, 72 games
across endless/comboStorm/factory, FORCED closed:

                    modes off   rise-blind   rise-aware
  payless    /min      18.0         4.4          4.2
  4+ wide    /min       2.2         7.1          7.7
  garbage    /min      36.2        60.3         63.8
  points     /min     328.3       523.9        575.1
  minutes survived     29.3        29.0         32.7
  4+ links   /min       0.1         0.2          0.3
  chains at 4 / 5      2 / 2       6 / 1        7 / 3

The combo arm clears: payless clears down 77%, wide combos 3.5x, garbage
sent up 76%. Separately measured, the bot chose ZERO bare threes on purpose
in 4,316 decisions against 455 with modes off — every three left is one the
board made.

THE CHAIN ARM DID NOT. 0.1 to 0.3 is four deep chains becoming ten over 72
games, which is not a count to defend. The reason is structural and is step
3: a 4-link chain was available to fire ONCE in 4,316 decisions, so the bot
was never declining to fire one. BUILD accumulates the material — 2-link
opportunities up 10x, 3-link up 22x — and then stalls, because the filter is
purely negative and nothing ranks the survivors by how much closer they get
to a chain.

The rise-aware arm is a small increment on top, better on all seven measures
and worse on none, and it does NOT do the job it was built for: the choice
is available on 42% of decisions and unavoidable on 0%, yet the threes
arrive anyway. It DEFERS the pattern rather than dismantling it. Dismantling
is a positive goal, so it hits the same wall as chain building.

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
what they leave reachable rather than by score, and measure them at the
leaf. A beam over a filtered pool is affordable where a beam over the whole
pool is not.

Not started until steps 1 and 2 have moved `4+ links/min`. A deeper search
of a memoryless scorer only searches harder for the same early fire.

## Step 4 — a weight set per mode

ama carries four (build, fast, all-clear, freestyle). Ours would be BUILD,
FIRE, FORCED. Each is its own genome and the islands train them together,
which multiplies the genome and the fingerprint.

NOT RUNNING. `PuyoCpu` takes `dangerWeights` and `_weightsNow()` will use it
in FORCED, but no trainer supplies one, so every run scores with a single
set and the field is inert. The genome is 29 weights, not 58.

Last. Per-mode weights on modes that do not fire is three ways to be wrong
instead of one, and FORCED is 13 decisions in 480.

## What this drops

Every remaining attempt to make one weighted sum hold a plan. The
`pc-s2xx` island chains are stopped; their snapshots carry 11 features and
are the control. `paylessClear` is out of the registry — the pool refuses
the payless clear outright, so a weight for it has nothing to price. The
count still reaches the report, taken from the engine's own match events.

Modes change behaviour without changing `KEYS`, so the fingerprint will not
notice. Relaunch islands fresh rather than resuming across the change.
