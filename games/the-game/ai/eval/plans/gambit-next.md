# Gambit: the plan

The goal: never die from the garbage the game shows.

## The idea

- A board dies when it runs out of one of three things: **room** (rows over the stack), **material** (panels to break with), or the
  **window** (actions to press with).
- Every loss Gambit computes is a **lower bound**: when the board dies on the breaks the searches found, not on every break there
  is. A line can raise its own bound by spending what the next search would have found a break with.

## The steps

1. **Proven first.** A line whose plan, played on the engine, meets every row shown before the board dies is proven. A proven line
   beats every unproven one.
2. **Unproven: the most left to find a proof with.** Of lines not proven, the one that leaves the most of its scarcest resource at
   once everything shown has landed (`marginOf`: room, material, window) wins, in rows; then the later loss. The survival search ranks the same way.
   A line that dies before it could press anything ranks last. This replaces the window cap on the loss.
3. **Search for the proof.** When nothing offered is proven, the decision's search time goes to the break on the board the best line
   leaves.
4. **The margin for garbage not shown.** Proven means proven with k rows spare. The owner's to set; suggested 1.
5. **Convert more per break.** Under attack, material only comes from breaking. A break pressed after more garbage has landed, or a
   chain, converts more at once. Each plan's break is tried at every landing shown, and the one that converts most is kept. This is
   what pays a block too big for one row's break.
6. **A proof is kept.** A proven line is carried and pressed as judged, and proven again each decision. The press guard never
   refuses a swap of a proven plan.
7. **Search deep enough.** Where no break is found and the clock did not cut the search, the search goes a swap deeper on that
   board next decision.
8. **The mode still decides.** Among proven lines, the mode's list ranks them: aggressive within the mode, never at the cost of the
   proof.

The categories fold into this: lives and plan are proven; breaks, ready, buys and dies are unproven, ranked by step 2.

**Built**, all eight at once (rank.c proofOf, compareJudged, readyNextFor; search/outlive.c outBefore; answer.c breakBegin;
search/break.c touchDepth; front.c the press guard; test/main.c the answers). Proven, in order: lives left alone, lives by its plan,
stands past the last row due and one row's break more. The margin is in rows of the stack's twelve; a swap deeper goes to 16 at most;
a plan's break is tried at up to four later landings.

The checks read the same order: no line played is beaten by one the order ranked under it, and none is played that dies before it
could press anything while one offered does not.

## How a loss is read

The last decision with a proven line, and what came next: a proven line passed over (**order**), none found (**search**), or every
line short at once by a block shown (**demand**).

## Learned

- 1266, 17/24: the best run.
- 1271, 11/24: factory-2 made the same decisions as 1266 up to frame 493. Then 1271 played a line lost at 374 over a hold lost at
  230. The hold's bound was wrong: 1266 held, its next searches found breaks, and it survived. 1271 spent the window from 24 to 5
  buying bands and died at 839. Comparing lower bounds as facts picks the line the search saw furthest, not the line that lives.
- 1272, 9/24 (combo_storm 4, factory 3, large_garbage 2): the window cap on the loss. Factory-2 lived to 19383 instead of 839, and
  other games fell instead. In all 15 losses, no break was found after the last break, and no better line was passed over: the
  order picked among guesses, and the searches found no proof. A cap on one resource moves which game dies, not whether one does.
