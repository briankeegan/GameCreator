# Gambit: the infra plan

The goal is never to die. A board never dies while it stays **solvent**: each row of garbage due is met by a break before the board
is lost. Each decision plays out, on the engine, what follows each line, and picks the line whose future stays standing.

## Where it stands

The decision runs: read, search, judge every line and its plan, categorise, ledger, rank, press, carry. Every predicted board
matches the game, and the order is one order. The best run is 1266, at 17/24.

## Fixes from run 1267 (9/24)

Solvency went into the order wrongly in two ways, and both are fixed:

1. **The ledger's model of death.** It counted a row that lands with no room as lost at once. The real board dies only once it is
   topped out, its stop is spent and the stack rises. So factory and large_garbage read insolvent all game, and the key compared
   noise. **Fix:** death is the plan's own loss frame, played on the engine. A line is solvent when its plan still stands a break's
   time after the last row shown has landed. Otherwise it is short by the rows due by then, less those its plan paid by then.
2. **The waste key ahead of the category.** A line that broke garbage, with a three somewhere beside it, lost to lines that break
   nothing. **Fix:** the waste key comes after the category. Within a category, a wasted three still loses.

## The order (rank.c compareJudged)

1. **Survival:** the line that lives; else the later loss, unless lost alike (the same band of a break's time). Never choose
   death.
2. **Solvency:** solvent before short; of two short, fewer rows unpaid, then lost later.
3. **Category:** lives, plan, breaks, ready, buys, dies. Then **no wasted three**: within a category, a line that wastes one ranks
   after one that does not. A line that wastes one and is still first is the board's save, and the frame loop reads that verdict.
4. **The board's own chain**, then **the mode's list.**
5. **Value for moves**, gains less costs in frames:
   - **Gains:**
     - time bought over the hold;
     - a break's time for each row converted, each block thrown, and each plan break over the hold's;
     - the actions taken off the next break's walk.
   - **Costs:**
     - the window's frames for each action;
     - a break's time for each row of panels spent beyond what the line converts.

## The ledger (rank.c ledgerOf)

- **Rows due:** every row of every block shown, at its landing.
- **Rows paid:** the line's own breaks, then each break of its plan, a break's time after it is pressed.
- **Death:** the plan's loss frame.
- **Logged** for every candidate as `sol=paid/due:short@frame`.

## Next (plans/gambit-next.md, for review)

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
