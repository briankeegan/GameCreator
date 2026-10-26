# Gambit: next, for review

Nothing here is built. This file is for the owner to review first.

## Why

Every board has a break once it has enough material. A board with no break in reach therefore means one of two things:

1. **The search did not reach it.** The break is there, and the clock cut the search first ("reach").
2. **The board has too little material.** There are not enough panels, or not the right ones near the garbage, to make a break
   ("board").

The ledger (rows due against breaks paid) catches the first only when the plan's search finds the breaks. It does not see the
second at all, because it counts breaks but not the panels they are made from. The bot also has a way to get material that it
uses only at the floor and in the opening: **the raise**, a new row of panels from below for one row of room.

So solvency is a balance of two things, **room** and **material**, and the raise turns one into the other.

## 1. Material in the ledger (rank.c ledgerOf, judge.c)

Each line's ledger gains two columns beside rows due and rows paid:

| Column | What it counts |
|---|---|
| **Material due** | the panels the rows due need: at least three a row, the panels of one break |
| **Material in hand** | the panels under the garbage on the board the line leaves (judge.c `readyMat`), plus the W panels each row its plan converts gives back, less the panels its clears spend (judge.c `netPanels`) |

A line is **short on material** when, at some row due, the material in hand is less than that row needs. Short on material counts
as insolvent, the same as short on rows. The log's `sol=` gains it, for example `sol=4/6:2@1140:m-3`: 3 panels short.

## 2. The raise competes on the ledger (decide.c, propose.c)

- **Offered** wherever the stack can take a raise, not only at the floor and in the opening.
- **Judged** like any line, on the engine: one row of room spent, one row of panels gained. Its plan and ledger are read like any
  other line's.
- **Ranked** by the same order. Where material is short and room is not, the raise is the line that keeps the board solvent, and it
  wins on solvency. Where room is short, it loses on survival, as now.

The owner's raise rules stay as they are: the opening raise and the floor below six rows.

## 3. The margin (rank.c ledgerOf), the owner's to set

Solvency counts only garbage the game shows. A block shown suddenly can make every line short at once, the "demand" loss. With a
margin of k rows, a line is solvent only with k rows of room to spare after every row due. The suggestion is one row, which the
owner decides. It is one number, recorded where it is set.

## 4. Reading a loss

The loss reader names, at the last solvent decision, the column that went short first:

- **rows:** the breaks were too few or too late, so search or order, as now;
- **material:** the panels ran out, so the raise or the clears that spent them;
- **demand:** a block shown made every line short, so the margin.

With material enough and no break found, the loss is the search's reach, and the search is what gets fixed next.

## 5. Checks

- `sol=` carries the material column for every candidate, held by "Every line categorised".
- The summary counts, per lost game, which column went short first.

## 6. Cost

There is no new search. Material in hand is read on boards the plan already plays (`readyMat`, `netPanels`). The raise adds one
candidate per decision, judged like any other.

## Questions for the owner

1. The margin: one row, or another number?
2. The raise offered in every decision where the stack can take it: is that within the owner's raise rules, or should it stay at
   the floor and in the opening?

## Order of work, once approved

1. Material in the ledger, and `sol=` with it.
2. The raise offered and judged on the ledger.
3. The margin, at the owner's number.
4. The loss reader's column.
