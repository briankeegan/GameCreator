# Gambit: the infra plan

The goal is never to die. A board never dies while it stays **solvent**: each row of garbage due is met by a break before the board
is lost. Each decision plays out, on the engine, what follows each line, and picks the line whose future stays standing.

## Where it stands

The decision runs: read, search, judge every line and its plan, categorise, the save, rank, press, carry; every line's ledger is
logged. Every predicted board matches the game, and the order is one order. The best run is 1266, at 17/24.

## The order (rank.c compareJudged)

1. **Survival:** the line that lives; else the later loss, unless lost alike (the same band of a break's time). A loss not known,
   the hold's, is alike with nothing. Never choose death.
2. **Category:** lives, plan, breaks, ready, buys, dies.
3. **The board's own chain**, then 4. **the mode's list.** A three that breaks nothing is in the order only where the save found the
   board needs it (decide.c): played to its end and searched on, it lives, or outlasts the best line without it by a break's time.
   Every other line that wastes one is taken out before the order.
5. **Value for moves**, gains less costs in frames:
   - **Gains:** time bought over the hold; a break's time for each row converted and each block thrown; the actions taken off the
     next break's walk.
   - **Costs:** the window's frames for each action; a break's time for each row of panels spent beyond what the line converts.

## The ledger (rank.c ledgerOf), read, not ranked

- **Rows due:** every row of every block shown, at its landing.
- **Rows paid:** the line's own breaks, then each break of its plan, a break's time after it is pressed.
- **Death:** the plan's loss frame.
- **Logged** for every candidate as `sol=paid/due:short@frame`, and read by the loss reader. It goes back into the order one key at a
  time, a run of 24 each, once the order without it plays 1266's games again.

## The window plan (core/nodes.h windowCover)

Each row due keeps its own break's walk in the window: the walk measured on the board its block lands on (walkDue). A due with no
block shown keeps the question's board's walk, the last measured this game when it has no garbage.

## The survival search (search/outlive.c)

Of the lines it grows: the band of its loss, then margin, then the loss net of what it spends, then actions.

## Next (plans/gambit-next.md)

- **Each plan's break timed at every landing:** under attack, material comes only from breaking, and a break after more has
  landed can convert more.
- **The margin for garbage not yet shown:** the owner's to set.

## Then: numbers from the engine, one at a time

`LAND_RESERVE` is the last walk measured this game, and `NEAR_ACTS` gives way to the measured walk. `LOW_ROWS` is the owner's rule,
and stays. Each of the rest becomes what it stands for, measured, one per run of 24 games:

- the press guard's and the judge's frames (`GUARD_DIE`, `TAP_DIES`, `HORIZON`/`REST`);
- the search sizes, which become memory bounds, with each search running until its share of the clock ends;
- the fixed time slices, which become shares of the time left.

## The owner's to set

- Value counts a row converted, a block thrown and a plan break each as one break's time.
- The margin, in rows.

## Checks

The truth held, the game the same twice, the answers (survival first), one order, every line categorised and ledgered.
