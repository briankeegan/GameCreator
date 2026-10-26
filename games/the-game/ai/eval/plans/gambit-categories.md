# Gambit: the infra plan

The goal is never to die. A board never dies when it stays **solvent**: for every row of garbage due, it can make a break before
that row costs it the game. Each decision asks of every line, "if Gambit plays this, what follows?", and plays the answer out on
the engine. The order picks the line whose future stays solvent longest.

## Where it stands

The decision runs: read, search, judge every line and its plan, categorise, rank, press, carry. Every predicted board matches the
game (0 divergences), and the order is one order (0 "beaten head to head"). Lines are judged by their plans, and every plan ends
the same way. Runs score 13 to 15 of 24.

**What fails now.** The losses no longer come from the order or the window. In the 900 frames before the last break, most
decisions offer nothing better than "buys time", and the bot dies 500 to 1,000 frames later. Nothing counts the rows due against the
breaks the board can still make, so it drifts insolvent while every decision looks right.

## 1. The scenario: every line's ledger (judge.c, outcome.c)

The judge already plays each line's plan on the engine: the line, then each break in reach for as long as each puts the loss off,
then the survival search from where the breaks stop. The plan now also keeps its **ledger**, a timeline of:

- **Rows due:** every row of every block shown on its way, at the frame it lands, plus the rows already on the board;
- **Rows paid:** every break the plan makes, at the frame it pops. One break pays one row.

From it, three facts:

| Fact | What it is |
|---|---|
| **Shortfall** | the most rows owed and not yet paid at any frame, less the rows of room over the stack |
| **Insolvent at** | the first frame the shortfall is above zero (never, when it stays at or below zero) |
| **Supply** | the breaks the plan makes before the last row shown lands |

Only garbage the game shows is counted, and only the breaks the plan can find on boards it can see. A colour a break converts
garbage into is unseen until the client draws it.

## 2. The order (rank.c compareJudged)

1. **Survival:** a line that lives beats one that does not; then the later loss, unless lost alike (the same band of a break's
   time). Never choose death. `test/main.c` "the answers" holds it.
2. **Solvency:** a solvent line before one that is short; of two short, fewer rows short, then insolvent later.
3. **Category:** lives, plan, breaks, ready, buys, dies.
4. **The board's own chain,** then **the mode's list** (the owner's rules; a wasted three below every line that wastes none, unless
   the save confirmed it is needed).
5. **Value for moves:** gains less costs, all in frames.
   - **Gains:**
     - time bought over the hold;
     - a break's time for each row converted and each block thrown;
     - a break's time for each break of supply over the hold's;
     - the actions taken off the next break's walk.
   - **Costs:**
     - the window's frames for each action pressed;
     - a break's time for each row of panels spent beyond what its breaks convert.

Then, with no garbage on the board, more ideas left ready; then the nearer first swap.

## 3. The log tells the scenario

Every candidate prints `cat=` and `sol=paid/due:short@frame` (`sol=4/6:2@1140`: pays 4 of 6 rows, 2 short from frame 1140), so
a decision reads as a choice between futures.

## 4. Reading a lost game (gambit_summary.js)

A loss is read back from the end to the **last decision whose line played was solvent**. That is where the game was lost. It is
named by what happened there:

- **order:** a solvent line was offered and an insolvent one played;
- **search:** no solvent line was offered, though the board before was solvent;
- **window:** the solvent lines were cut by the window;
- **demand:** a block shown made every line insolvent at once, by so many rows.

## 5. The searches aim at supply

- **The board to come** searches the board each shown block lands on for its break. Those breaks are the supply the ledger reads.
- **The survival search,** of lines lost alike, keeps the one whose board leaves the most supply.
- **The break search's beam,** within a survival band, ranks first the lines whose boards leave the most supply by the shape math,
  then by nearness.

## 6. One answer for the save

The press guard (front.c, `GUARD_DIE`) reads the decision's verdict on a wasted three, and asks its own question only for a swap the
answer never judged. Then the save step leaves the order: the list key and survival already hold it.

## 7. Numbers from the engine, one at a time

Each change is one constant, run on its own 24 games.

| Kind | Constants | Becomes |
|---|---|---|
| What Gambit does | `LAND_RESERVE`, `NEAR_ACTS`, `NEAR_MISS`, `HORIZON`/`REST`, `CHEAP_BREAK`, `WALK_EARN`, `CARRY_WAITS`, `LOW_ROWS`, `RAISE_WAIT`, `GUARD_DIE`, `TAP_DIES` | what each stands for, measured on the board every decision |
| How far it looks | the touch beam, line-up, survival search, three-strip, ideas, perched and route sizes | memory bounds only, sized from the most the logs show in use; each search runs until its share of the clock ends |
| Time | `SAVE_MS`, `LANDED_MS`, `READY_LINE_MS`, `BREAK_*`, `UNDER_SHARE`, `RAISE_MS` | shares of the time left, in proportion to the asks to come |

Storage sizes and the engine's own facts (`W`, `ROWS`, `TAP_GAP`) stay, each with its observed maximum recorded.

## The owner's to set

Value counts a row converted, a block thrown and a break of supply each as one break's time. That is a choice, not a measurement.

## Checks

| Check | What it holds |
|---|---|
| The truth held | 0 divergences |
| The game the same twice | a seed's game and its twin decide alike |
| The answers | no line played that is lost a break's time sooner than one offered |
| One order | 0 "beaten head to head" |
| Every line categorised | every decision that offers lines logs a category for each |
| New: every line has a ledger | every candidate carries `sol=` |

The summary also counts, per lost game, the frames from the first insolvent decision to the loss. When that number falls, the
bot is seeing its losses sooner.

## State

| Step | State |
|---|---|
| 1. The ledger in the judge, `sol=` in the log | built |
| 2. Solvency in the order, supply in value | built |
| 3. The loss reader on the last solvent decision | built: losses are named `solvency-order`, `-demand`, `-window` or `-search` |
| 4. The searches toward supply | built: the survival search keeps, of lines lost alike, the one leaving the next break nearest; the break search's beam ranks by nearness within a survival band |
| 5. One answer for the save | built: no save step; a wasted three ranks after survival and solvency, so it is first only where not playing it dies or falls short, and the frame loop reads that line's own verdict |
| 6. The constants | `LAND_RESERVE` is the last walk measured this game; `NEAR_ACTS` gives way to the measured walk. `LOW_ROWS` 6 is the owner's rule, and stays. The rest are measured one at a time from runs. |
| Checks | "Every line categorised" also requires a ledger |

## Order of work

1. The ledger in the judge, and `sol=` in the log.
2. Solvency in the order, and supply in value.
3. The loss reader on the last solvent decision.
4. The searches toward supply.
5. One answer for the save.
6. The constants, one at a time.
