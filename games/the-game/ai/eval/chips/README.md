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

`verify_chips.js` with no argument verifies EVERY file in this directory, so
a new batch is covered the moment it lands rather than when someone remembers
to widen a filename in the gate.

| batch | file | chips | status |
|---|---|---|---|
| 1 | `batch1-chain.json` | 6 | the pure cascades — all reproduce exactly |
| 2 | `batch2-combo-single.json` | 60 | one simultaneous clear of 3-7 — all reproduce exactly |
| 3 | `batch3-combo-double.json` | 95 | two clears at once (3_3 … 7_7) — all reproduce exactly |

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
