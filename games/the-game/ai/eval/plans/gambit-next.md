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
   the next row due (`marginOf`: room, material, window) wins, in bands; then the later loss. The survival search ranks the same way.
   A line that dies before it could press anything ranks last. This replaces the window cap on the loss.
3. **Search for the proof.** When nothing offered is proven, the decision's search time goes to the break on the board the best line
   leaves.
4. **The margin for garbage not shown.** Proven means proven with k rows spare. The owner's to set; suggested 1.

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
- 1272: the window cap on the loss. Results to come.
