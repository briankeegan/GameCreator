# Gambit: next, for review

Run 1266 scored 17/24. The 1267 build took factory and large_garbage to 2/8 and 0/8, and put them there before solvency was in the
order (1268, 10/24). Solvency in the order (1269, 8/24) did not bring them back. Every loss reads the same: after the last break,
nothing better than "buys" offered, solvent a few hundred frames before the loss, then one row short. Nothing below is built yet.

## 1. The save is the one gate for a wasted three (decide.c ranked)

A line that wastes a three leaves the order unless the survival search, played on from the board each side leaves, finds the board
needs that three: it lives with it, or outlasts the best line without it by a break's time. That verdict is the line's
`threeNeeded`, read by the order and the frame loop alike. A three-wasting line ranked a key lower, as now, still gets played, and the
press guard then refuses it: the walk spent for nothing (refusals 98 to 178, saves 133 to 200).

## 2. The survival search keeps its clock (search/outlive.c)

No break's walk measured on every line it grows. That cost comes out of a search the clock already cuts short. Its order goes back to
band, then margin, then net loss, then actions.

## 3. Solvency is read, not ranked (rank.c)

The ledger stays in every decision's log and in the loss reader. It leaves the order and value until 1 and 2 give 1266's results
again. Then it goes back one key at a time, a run of 24 each.

## 4. The answers (rank.c compareJudged)

One decision in 1269 played a line lost a break's time sooner than one offered, and not alike. Find the key that put it first, and
make the order's survival key and the check read the same loss.

## Then

- Each plan's break timed at every landing: under attack, material comes only from breaking, and a break after more has landed
  converts more.
- The margin for garbage not yet shown: the owner's to set, in rows.

## Order

1, 2, 3, then a run of 24. Then 4.
