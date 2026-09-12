# Chip batches — chain shapes the bot can be TOLD

`PUYO_REFERENCE.md`'s Tier 2 is search **and** named chain templates: "it does
not discover chain shapes, it is told them". `chain_reach.js` measured why
search alone cannot close the gap — 54 of the game's 84 chain puzzles need
four or more swaps before a chain exists at all, and ~30 legal swaps a ply
puts depth 4 at ~810,000 boards per decision against an 85ms budget. So the
shapes have to come from somewhere else.

They come from the owner's own Panel Attack fork: `bot/chipCache.lua` on
`briankeegan/panel-game@claude/bot-verification-handoff-w7b53s`, 6,270 baked
templates, with the grammar that generates them written up in
`bot/CHAIN_GRAMMAR.md`.

## Taken in batches, smallest first, and re-verified here

The cache says "engine-verified" — by Panel Attack's Lua engine. Ours is a
separate implementation, so the claim is re-earned against `LogicalBoard`
before a chip is allowed in, by `verify_chips.js`. Nothing goes in this
directory until that passes on it.

## Every chip clears TWO gates, and the second one is the game

`verify_chips.js` checks a chip against `LogicalBoard` — the bot's SIMULATION
of the board, the thing it clones a few hundred times per decision. That is
the right first gate, because it is what the search actually reasons with.

It is not the game. `verify_chips_engine.js` stages the same chip onto a live
`PanelEngine.Stack`, asks the engine's own `canSwap`, performs it with the
engine's own `doSwap`, runs frames until the board is still, and reads the
chain depth and clear count off the match events the engine emits for itself
— hover frames, pop timers and all.

**They do not agree.** Measured on the 517 single-swap cascade chips:

| | |
|---|---|
| pass simulation AND engine | 376 |
| fail both | 107 |
| **pass the ENGINE, fail the simulation** | **34** |
| pass the simulation, fail the engine | 0 |

Nothing passes the simulation and fails the game, which is the reassuring
direction. But 34 shapes are real in the game and wrong in the board the bot
plans with — a defect in `LogicalBoard`, not in the chips, and one that
touches every decision the bot makes rather than just these. Chased
separately; recorded here because it was found here.

Either verifier with no argument covers EVERY file in this directory, so a
new batch is gated the moment it lands rather than when someone remembers to
widen a filename.

| batch | file | chips | status |
|---|---|---|---|
| 1 | `batch1-chain.json` | 6 | the pure cascades — all reproduce exactly |
| 2 | `batch2-combo-single.json` | 60 | one simultaneous clear of 3-7 — all reproduce exactly |
| 3 | `batch3-combo-double.json` | 95 | two clears at once (3_3 … 7_7) — all reproduce exactly |
| 4 | `batch4-cascade4.json` | 35 | a combo feeding a 4-deep cascade |
| 5 | `batch5-cascade5.json` | 88 | a combo feeding a 5-deep cascade |
| 6 | `batch6-cascade3-double.json` | 38 | two clears at once feeding a 3-cascade, minus the two biggest families |
| 7 | `batch7-twoswap-combo3.json` | 13 | the first TWO-SWAP chips: `COMBO_3_SWAP_2_MOVE_1` |

## Two-swap chips, and what the move count is for

5,588 of the 6,270 take two swaps: a setup that clears nothing, then a fire.
Batch 7 is the first of them.

They are verified the way the fork's own `getComboSetups.lua` verifies them —
swap, settle, swap, settle, cursor teleported — so **the walk between the two
swaps is not part of the chip's definition**. `cursorMoves` (and the `MOVE_n`
in the kind, which agrees with it on all 5,588 — checked) is the Manhattan
distance between the two swap cells, and it is what the chip COSTS to play.
`travel.js` is what turns that into frames for the planner. `verify_chips_engine.js`
fails any chip whose recorded move count disagrees with its own geometry,
because such a chip would be priced wrong every time it was considered.

### The rise, which is why two-swap chips needed a harness change

`riseLock = true` and `speed = 0` do NOT hold the stack still. The engine
re-decides `riseLock` every frame, so a settle running a fixed 900 frames let
the board CLIMB A ROW between the two swaps: the second swap addressed the
cells the first swap's panels used to be in, and thirteen good chips read as
clearing nothing. The fix is to stop when the board is still — no active
panels, no chaining panels — which is also exactly what the fork waits on.

Single-swap chips finish before any of that matters, which is why six batches
went by without noticing.

Batches 4-6 are the `COMBO_*_CASCADE_*` group, taken by cascade depth and
then by family rather than in one lump of 376 — small enough that when
something breaks, the break has one explanation. Only chips clearing BOTH
verifiers are in them: 376 of the group's 517 do, and the rest stay out.

## The two "chain" counts, which are not the same number

Batches 2 and 3 failed 155 of 155 on their first pass while every clear count
matched exactly — the shape of a harness bug, not a library one, and worth
recording because the word is overloaded. Panel Attack's `meta.chain` is the
CHAIN COUNTER: `0` means "this clears, but nothing cascades", `2` means a
2-chain. `LogicalBoard.resolve()` reports the number of match-and-settle
ROUNDS, so that same plain combo is `1`. They agree from 2 upward and differ
only at the bottom, which is exactly why the CHAIN batch passed first time
and hid the problem.

Batch 1 is the pure cascades — `CHAIN_2`..`CHAIN_6` (the STEP atom stacked
into a staircase, folding back up-left past chain-4 because the board is only
6 wide) and `CHAIN_TOWER` (the CONVERT atom, a column feeding a row). They
were taken first because they are the shapes we actually want and because
they are self-supporting: every cell rests on another cell of the template,
so staging one cannot be got wrong.

## Format

Each chip is `{ kind, swaps, tmpl, chain, total, garbage, nSwaps, nMoves }`.
`tmpl` is `[dr, dc, class]` relative to the swap: `dr + 1` is one row UP,
class is an integer colour SLOT (not a colour — a chip cares which cells
share a colour, not which colour), `"."` means the cell must be empty, `"@"`
a solid that is not one of the solving colours.

## What is deliberately NOT here yet

**The `COMBO_*_CASCADE_*` group (517 single-swap chips) is next**, and it is
the hard one: 255 verify and 262 do not, in two distinct shapes.

- ~115 fire NOTHING here (`0 rounds / 0 cleared`). These have don't-care cells
  propped up with garbage by this harness, which can block the very fall the
  cascade needs. Almost certainly staging.
- ~62 clear exactly the panels claimed but in ONE ROUND FEWER
  (`claims chain 3, ours gives 2 rounds / 11 cleared` — same 11). That is not
  staging, it is engine semantics: the real engine has hover frames, so a
  clear that lands a beat later counts as its own link there, while our
  instantaneous gravity merges it into one round. A chip like that would pay
  less here than it claims, which is exactly what re-verification is for.

After that, the 5,588 two-swap chips, which need a swap-settle-swap harness.
One group at a time, and only what verifies gets ported.
