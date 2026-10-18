# Gambit: the price of a panel

**Every line is charged for the panels it spends, in frames of life, at a price the board's own games measured.** Survival stays
first: the price only changes how much time a line is worth, never whether it lives.

## Why

The losses that remain are mostly boards that ran out of panels. The judge sees only the frames a line buys, so a clear that buys a
few frames and spends a few panels wins on the clock, again and again, until there is nothing left to break the next slab with.
The saving band (`decide.c` read: `savingPanels`) orders breaks while panels are short; it never reaches the clears, setups and
survival lines that do most of the spending.

## The price, measured

1. **Log the panels.** Every `GAMBITD` line carries `pan=` (`panelsOn`: the panels on the board, garbage not counted) beside
   `mat=`. No decision changes.
2. **A tool reads it** (`eval/material_price.js DIR...`): over the fetched games of several runs, for each pop (a break's pop to the
   next), the panels at its start and whether the board was lost before the next one. From that, per panel count `p`:
   - `S(p)`: the share of pops begun on `p` panels the board lives through;
   - `T`: the frames a pop-to-pop cycle lasts (median of the runs);
   - `L(p) = T / (1 - S(p))`: the frames of life a board on `p` panels has left;
   - **`price(p) = L(p) - L(p - 1)`**: the frames one panel is worth on a board of `p`.
   Counts pooled into bins wide enough to hold a few hundred pops each; the bins and their counts written beside the table.
3. **The table is data, not code**: `gambit/material.tsv`, one row a bin (panels from, panels to, frames, pops counted). The loader
   hands it to the decision; `build.sh` checks it is there.

## The price, charged

4. **The outcome says what a line spends** (`outcome.c`): the panels on the board it settles to (`panelsLeft`, already there) against
   the board left alone's; the spent panels priced along the table, from what the line leaves up to what holding leaves -- each
   panel at the price of the board it is taken from (`o.spentFrames`; a line that leaves more panels than holding is credited the
   same way).
5. **The rank reads a line's worth as the frames it buys less what it spends:**
   - of two that do not live: the later loss, net of the spend;
   - of two that live: within their tier, the less spent first, before the tier's own keys.
   A line that lives always comes before one that does not -- the price never crosses that.
6. **One rule for material**: the saving band and its panels-first key go; the material floor (`breakBuildable`) and the next break's
   check (`nextBuild`) stay, because they are exact -- the price weighs what is left, they say whether a break is left at all.

## The rules it keeps

- Every number from the board's own games, with the counts beside it; re-measured when the bot changes enough to move it.
- Survival first: the price changes the worth of time, never what lives.
- The list orders what the board can afford: a combo the board can pay for is still played.

## Done when

- The table is built from at least three runs' games, monotone (a panel is worth more the fewer there are), with its counts.
- A run shows the losses where material ran out (`breakNear`: no break to build on the boards before the loss) are fewer than
  before it, and no mode below its last run by more than the noise.
