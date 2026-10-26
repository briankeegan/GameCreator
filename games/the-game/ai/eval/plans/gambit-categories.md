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

## 2. The order: five keys, all the judge's facts (rank.c compareJudged)

The order is a short list of keys. Every value it compares is a fact the judge already has; the order works nothing out itself.

1. **Survival:**
   - a line that lives beats one that does not;
   - of two that do not, the later loss, unless they are lost alike. Alike means the same band of a break's time, with the bands
     counted from one reference, so the order is one order.

   `test/main.c` "the answers" stays: no line is played that is lost a break's time sooner than one offered.
2. **Category**, best first.
3. **The board's own chain:** a line that keeps it before one that cuts it short (the goal's item 2).
4. **The mode's list:** the earlier entry met; under garbage, a line that breaks before one that does not. A line that wastes a
   three ranks below every line that wastes none, and a line that spends the floor comes last (the goal's item 3, "the one rule").
5. **Value for moves:** what the line gives, less what it costs, all in frames:
   - **Gains:**
     - the time it buys: its plan's loss minus the hold's;
     - a break's time for each row of garbage it converts;
     - a break's time for each block it throws.
     - the actions it takes off the next break's walk, compared with holding (measured on the boards each leaves), at the window's
       frames per action.
   - **Costs:**
     - the frames the window takes to give back each action it presses (`actionFrames`);
     - a break's time for each row of panels its clears take beyond what its breaks convert.

   More moves for less comes out worse with no rule of its own. That covers the goal's item 4 ("the fewest cursor moves first; a far
   one has to earn its walk") and item 5 ("the one that throws more"). The line in progress costs less, because part of it is
   already pressed.

Then, with no garbage on the board, the more ideas left ready (the goal's item 5). Last, the nearer first swap, and a tie.

The chain and the mode's list stay as keys of their own, not refusals. They are the owner's rules, and a refusal would put them
above survival.

This replaces rule 1's clauses (reserve, hold, landing, ledger, margin, net, material, nearer), rule 4 (the line in progress, the
kept plan), rule 5 (thrown), rule 6 (later loss), rule 7 (fewer actions) and rule 8 (tier).

**The save step after judging stays for now.** A three that breaks nothing is dropped unless the survival search confirms the
board needs it. The press guard asks the same question at the press, and both have to give the same answer. Folding the step into
the order (the list key above) waits until the press guard reads the judge's answer too.

## 3. The searches aim at what the order wants

- **The survival search** ranks by the order's keys: band, margin, then the loss net of its actions. Done.
- **The break search** ranks the top of its beam by the judge's category and loss. It keeps its nearness score only as the cheap
  key below them. The judge is asked only of the nodes that reach the top, in the search's own share.
- **A line that wastes a three** has a variant without the wasted swap. A proposer offers it, and it is judged like any other.
- **The break search keeps its frontier** when it finds a break. Its depth carries to the next decision instead of starting over.

## 4. Plans are held to (decide.c carry)

A line played for its plan carries the plan's next break as the line in progress, timed where the plan pressed it. The next
decision ranks it like any line: it is kept while it still ranks first, and dropped once something new outranks it. Once that
break is pressed, the next decision's plan carries the break after it, so the whole plan is held one break at a time.

## 5. The window is paced

The window plan holds a break's walk for every row due. **The pace:** a line keeps it when the window still covers as many of the
breaks due as holding would, less the rows its own breaks pay (rank.c `paceKept`). A line that spends faster than that buys its
time out of the window: it is never Ready, and at best Buys time.

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

- **Every candidate:** `category:loss:planLoss:breaks:actions:value`.
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

## State

| Step | State |
|---|---|
| 1. Categories | built |
| 2. The order | built |
| 3. The loss reader | built |
| 4. Break search | built: the frontier is kept when a break is found, the top of the beam is ranked survival-first, and the three-free variant is "the three taken out" (decide.c) |
| 5. The plan held | built: carried one break at a time |
| 6. The pace | built |
| 7. Constants | one at a time, each with its measurement from a run |
| Checks | built: "One order" and "Every line categorised" in gambit-24.yml |

## Order of work

1. Categories in the judge, and the log printing them.
2. The order on its five keys; rule 1's clauses and rules 4 to 8 removed; the save step kept until the press guard reads the judge.
3. The loss reader on categories.
4. The break search ranking by category, keeping its frontier when a break is found; the three-free variant as a proposer.
5. The plan carry for every break of the plan.
6. The window's pace.
7. The constants, one at a time, each with its measurement.

## Review

- **Survival first holds.** The category, the chain, the list and value are asked only of lines that both live or are lost alike,
  so no key can put a line lost a break's time sooner first.
- **One order.** Every key is a fact of one line, or of one line against the decision's one hold, so the comparison is
  transitive. The "beaten head to head" count should fall to 0, and the check holds it there.
- **The hold's plan.** The hold has a plan, and `lostOf` reads it, but `livesOf` leaves the hold out: a hold whose plan lives is
  not "lives by its plan". This is fixed with the categories.
- **Value's exchange rates are assumptions, not measurements.** A row converted and a block thrown are each worth a break's time.
  That fits under garbage: a block thrown is a break the other board owes. It is the owner's to set, and it is marked as such in
  `rank.c`.
- **The break search ranking by category costs search time,** and "reach" (the search cut by the clock) is already the most common
  loss. It is built last, judged only for the nodes at the top of the beam, and checked for a rise in "reach".
- **The window's pace** is defined by the window plan's own dues: covering as many as holding would, less the rows a line's breaks
  pay.

