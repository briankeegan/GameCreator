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

| batch | file | chips | status |
|---|---|---|---|
| 1 | `batch1-chain.json` | 6 | all 6 reproduce their claimed chain depth and clear count exactly |

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

The other 6,264. 5,588 of them take two swaps, which needs a swap-settle-swap
harness; and the `COMBO_*_CASCADE_*` families have don't-care cells whose
support changes what falls, so staging them is its own problem — 262 of 678
single-swap chips failed to reproduce, and that is likelier to be the staging
than the library. One batch at a time.
