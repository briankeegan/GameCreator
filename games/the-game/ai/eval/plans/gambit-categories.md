# Gambit: one judgement, one order

The decision becomes four steps: **search, judge, rank, press**. The judge puts every line in one category and carries the facts
behind it. Every reader uses those same facts: the order, the searches, the carry, the log and the loss reader. None of them works
the facts out again for itself.

## 1. The judge categorises (judge.c, outcome.c)

Every line is played on the engine and then given its plan: the line, then each break in reach after it for as long as each one
puts the loss off. Where no break is found, the plan goes on with the survival search's best line from the board the line leaves.
The judge then gives the line one category, best first:

| Category | What decides it |
|---|---|
| **Lives** | the board lives left alone after the line |
| **Lives by its plan** | the line and its plan's breaks keep the board alive |
| **Breaks now** | the line breaks garbage, and its plan keeps a save |
| **Ready** | the plan's next break is in reach, and the window pays for it before the board is lost |
| **Buys time** | no break in reach, but the line outlives the hold |
| **Dies** | no save, and lost no later than holding |

The facts carried with it:

- the loss frame, its own and its plan's;
- the breaks its plan makes;
- the actions it spends;
- the window left;
- the panels under the garbage, and the rows over the stack;
- whether it keeps the board's own chain and meets the mode's list;
- **wastes a three**: it makes a three that breaks nothing and is no chain link;
- **spends the floor**: it goes under the mode's keep floor on material.

## 2. The order reads the category (rank.c)

1. **Loss band.** Survival comes first: a line lost a break's time later always wins. Bands are counted from one reference, so
   the order is one order. `test/main.c` "the answers" stays: no line is played that is lost a break's time sooner than one
   offered.
2. **Category**, best first.
3. Within a category:
   - a line that wastes a three ranks below one that does not, so a three the board needs wins only by survival;
   - then the mode's list;
   - then the board's own chain;
   - then the line in progress;
   - then thrown, fewer actions, the later loss, tier, and the nearer first swap.
4. **Spends the floor:** last of all.

This replaces rule 1's clauses (reserve, hold, landing, ledger, margin, net) and the step after judging that handled the save
and the floor. `contLostOf` is asked only through the plan, so the save can no longer disagree with the order.

## 3. The searches aim at what the order wants

- **The survival search** ranks by the order's keys: band, margin, then the loss net of its actions. Done.
- **The break search** ranks the top of its beam by the judge's category and loss. It keeps its nearness score only as the cheap
  key below them. The judge is asked only of the nodes that reach the top, in the search's own share.
- **A line that wastes a three** has a variant without the wasted swap. A proposer offers it, and it is judged like any other.
- **The break search keeps its frontier** when it finds a break. Its depth carries to the next decision instead of starting over.

## 4. Plans are held to (decide.c carry)

A line played for its plan carries the plan's next break as the line in progress, timed where the plan pressed it. The next
decision ranks it like any line: it is kept while it still ranks first, and dropped once something new outranks it. Done for the
first break; to do for the breaks after it.

## 5. The window is paced

The window plan holds a break's walk for every row due and the save each line leaves. To add: the pace, meaning the actions a
minute the breaks due ask for. A line that spends faster than that pace, with no break of its own, is a line that buys time out
of the window. It is categorised so (Buys time), never Ready.

## 6. Numbers from the engine

Each of these is replaced by a measured value, or removed:

| Constant | Replacement |
|---|---|
| `LAND_RESERVE` (20) | the measured break walk |
| `NEAR_ACTS` (2) | the cursor's actions along the line |
| `LINEUP_DEPTH` (8), `LINEUP_BEAM` (12), `LINEUP_BUDGET` (400) | bounded by the pop's frames and the clock |
| `SAVE_MS` (10) | the readiness share |
| `PERCHMAX` (4) | every perched block |
| `OUT_POOL` (16) | the pool the clock fills |
| the survival search's depth and width (6, 30) | the clock |

A number that stays is recorded beside the measurement it came from.

## 7. The log says why

- **Every candidate:** `category:loss:planLoss:breaks:actions`.
- **The decision:** the line played, the best of each category passed over, and the key that decided.
- **The loss reader** (`gambit_summary.js`): reads the categories from the last break to the end. It names the stage that failed:
  - **search:** no line better than Dies was offered;
  - **order:** a better category was passed over;
  - **window:** a Ready line went unpressed for want of actions;
  - **press:** a line was refused or cut at the press.

## Checks

- **Every candidate has a category:** C check in `test/main.c`.
- **One order:** the run's "beaten head to head" count is 0. `gambit_summary.js` reports it, and `gambit-24.yml` fails on any.
- **The answers** (survival first) and **the truth held** (0 divergences) stay as they are.

## Order of work

1. Categories in the judge, and the log printing them.
2. The order on band, then category; rule 1's clauses and the compare step removed.
3. The loss reader on categories.
4. The break search ranking by category, keeping its frontier when a break is found; the three-free variant as a proposer.
5. The plan carry for every break of the plan.
6. The window's pace.
7. The constants, one at a time, each with its measurement.
