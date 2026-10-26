# Gambit: solvency

A board never dies when it stays **solvent**: for every row of garbage due, the board can make a break before that row costs it the
game. Every decision so far looks a few hundred frames ahead and asks whether a line lives, breaks or is ready. Nothing counts the
rows due against the breaks the board can still make. So the bot drifts insolvent while every decision looks right, and dies
500 to 1,000 frames later.

This plan adds that count to every line. It does so as a scenario: if Gambit plays this line, here is what follows, break by break
and row by row, played on the engine.

## 1. The scenario every line leaves (outcome.c, judge.c)

The judge already plays each line's plan on the engine: the line, then each break in reach, then the survival search. The plan
now also records its **ledger**, a timeline of two columns:

- **Rows due:** every row of every block shown on its way, at the frame it lands (the window plan's `landAts`), plus the rows of
  garbage already on the board.
- **Rows paid:** every break the plan makes, at the frame it pops. Each break pays one row.

From the ledger, three facts:

| Fact | What it is |
|---|---|
| **Shortfall** | the most rows owed and not yet paid at any frame, less the rows of room over the stack: how far the board is behind |
| **Insolvent at** | the first frame the shortfall is above zero (never, when it stays at or below zero) |
| **Supply** | the breaks the plan makes before the last row shown lands |

A line whose plan pays every row as it comes is **solvent**. One that falls behind is **short by k rows, from frame f**.

Only garbage the game shows is counted (the goal's rule: nothing is assumed about garbage not yet shown). The colours a break turns
garbage into are unseen until the client draws them, so the ledger is only as long as the plan: the breaks it can find on the boards
it can see.

## 2. The order reads solvency (rank.c compareJudged)

1. **Survival**, as now. A line lost a break's time later always wins: never choose death.
2. **Solvency:**
   - a solvent line before one that is short;
   - of two that are short, fewer rows short, then insolvent later.
3. **Category**, as now. It mostly describes the line now; solvency has done the deciding.
4. **The board's own chain**, then **the mode's list**, as now.
5. **Value for moves**, with one more gain: the change in **supply**, the plan's breaks against the hold's, at a break's time
   each. Panels kept, contact with the garbage and room over the stack matter because they become future breaks. Counting the
   breaks counts them in the right unit, with no measure of their own.

## 3. The log tells the scenario

Every candidate prints its ledger beside its category, `sol=paid/due:short@frame`. For example, `sol=4/6:2@1140` means the plan
pays 4 of 6 rows and is 2 short from frame 1140. A decision then reads as a choice between futures: this line pays every row, that
one buys 60 frames and falls 2 rows short.

## 4. The loss reader finds where solvency was lost (gambit_summary.js)

A loss is read back from the end to the **last decision where the line played was solvent**. That decision, and the one after
it, are where the game was lost, often long before the last break. It is named by what happened there:

- **order:** a solvent line was offered, and an insolvent one was played;
- **search:** no solvent line was offered, though the board before it was solvent;
- **window:** solvent lines were offered but cut by the window;
- **demand:** a block shown made every line insolvent at once. That is too much garbage for this board, and it says how many rows
  over.

## 5. The searches aim at solvency

- **The board to come** already searches the board each shown block lands on for its break. Those breaks are the supply, and the
  readiness check reads them.
- **The survival search** keeps, of lines lost alike, the one whose board leaves the most supply: its margin's panels under the
  garbage and its contact become one measure, the breaks the board can make.
- **The break search's beam,** within a survival band, ranks first the lines whose boards leave the most supply by the shape math,
  then by nearness.

## Checks

- **Solvency logged:** every candidate carries a ledger (C check, and "Every line categorised" extended).
- **Insolvent long before the end:** the summary counts the frames from the first insolvent decision to the loss, per game. When
  that number falls, the bot is seeing its losses sooner.

## Cost

The plan is already played for every line that does not live. The ledger is a count over its breaks and the rows due, with no new
search. The added cost is the readiness check's time: the plan must run long enough to reach the rows due. That share is
recorded, and reach (the search cut by the clock) is watched.

## Order of work

1. The ledger in the judge, and `sol=` in the log.
2. Solvency in the order, and supply in value.
3. The loss reader on the first insolvent decision.
4. The searches toward supply.
