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
2. **Unproven: the most left to find a proof with.** Of lines not proven, one that dies before it could press anything ranks last;
   then the one that leaves the most of its scarcest resource, then of the next -- the two scarcest only (`marginKey`: room, material, contact, and the window
   as the dues ask it -- the share of the rows due the window still covers, with the rows the line's own breaks pay); then the later
   loss. A line with a plan is read on the board its plan's last break leaves; a line whose board was not read, on the board as it is
   now. The survival search ranks the same way.
3. **Search for the proof.** When nothing offered is proven, the decision's search time goes to the break on the board the best line
   leaves.
4. **The margin for garbage not shown.** Proven means proven with k rows spare. The owner's to set; suggested 1.
5. **Convert more per break.** Under attack, material only comes from breaking. A break pressed after more garbage has landed, or a
   chain, converts more at once. Each plan's first break is tried at every landing shown, and the one that converts most is kept; each
   break after it is asked from the last landing back, and the latest one in reach is kept. This is what pays a block too big for one
   row's break.
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
- 1273, 15/24 (combo_storm 5, factory 3, large_garbage 7): the plan built. Large_garbage's best yet; every check green. Of 9 losses, 4
  passed over a break for step 2's margin key (2.margin), and the run-up before most is mostly holds: the margin is read on the board
  the line leaves, so a break that spends window and panels now reads less margin than holding, though it converts garbage. 7 found
  no break after the last one; the clock cut the search in 132 of 230 decisions after the last break.
- 1274 and 1276, 15/24, every game lost on 1273's frames: the plan-board margin never ran (asked after the clock was spent, then never
  read: 0 lines in factory-4's log). The logs showed step 2 broken twice over: a line whose judging the clock cut had no margin and
  ranked last (an entry lost at 439 under a setup lost at 253), and every other margin was 0, room under garbage being nearly none for
  every line. Fixed: a margin is never unknown, and it compares the scarcest share, then the next. The search: of 127 searches of the
  board to come in factory-4, 53 could not begin -- the board left alone dies before the block lands -- 60 found no break, 12 one; 9
  of 1,045 lines offered were breaks.
- 1277, 9/24 (combo_storm 4, factory 2, large_garbage 3): the margin live, ahead of the loss. It passed over a break in 11 of 15
  losses. Reserves ahead of the loss bound is wrong: the bound is the better fact. Fixed: the later loss first, the margin between
  lines lost alike.
- 1278, 12/24 (combo_storm 5, factory 4, large_garbage 3): the loss ahead of the margin. Reverting the idea was wrong; the piece was. The
  margin read the window as actions left, so a break -- which spends actions and pays rows -- read as less than holding. Fixed: the
  window is read as the dues ask it, the share of the rows due it still covers plus the rows the line pays; the margin first again.
- 1279, 11/24 (combo_storm 5, factory 1, large_garbage 5). The piece: the break search. In factory-4 the order held ten decisions with
  nothing proven, as the plan says; the search for the proof ran each time, its carried beam grew from 4 swaps deep to 20, and found
  nothing -- then every one of its 60 lines died on being played again (the board lost before their end). The beam grew lines that
  leave no time for a break to pop before the board dies. Fixed: such lines leave the beam (brDoomed= in the log).
- 1280, 11/24 (combo_storm 6, factory 3, large_garbage 2). The beam fix ran (brDoomed in 542 decisions of large_garbage-4). The piece:
  the margin. In large_garbage-4 the hold (0.4.6.7) was played 14 times over lines lost 42 frames later (0.4.5.6), the window at 53:
  a twelfth more of the third and fourth scarcest decided over the loss. Fixed: the margin compares the two scarcest shares only.
- 1281, 11/24 (combo_storm 5, factory 3, large_garbage 3): the margin passed breaks less; 7 of 13 losses were demand (one block 4 to 40
  rows over every line). The piece: step 5. No plan from a later landing was ever kept (0 in every log): waiting for one, the board
  dies first. And a plan's later breaks were asked only at the last landing, so a plan stopped after one break wherever the board died
  before it. Fixed: each later break is asked from the last landing back, the latest in reach kept (lands=…/earlier in the log).
- 1282, 11/24, 1281's frames: the later landings never needed (0 earlier in every log). One mode at a time now: combo_storm. In
  combo_storm-8 long lines (toward, 8 swaps; clear, 14) were played over the hold on room they did not have -- read on the board at
  the line's end, before the garbage on its way had landed (toward 4.5 against the hold's 0.5) -- and spent the window from 25 to 3.
  Fixed: a margin read before everything has landed counts the rows still coming against its room, in the order and the survival
  search alike.
- 1283, 13/24 (combo_storm 5, factory 3, large_garbage 5). combo_storm-1: the hold (lost at 238) played 8 times over entries lost at 352
  that threw a block, the margin 0.8 against 0.7 -- one row of material, the panels the entry clears. Every clear spends a little
  material, so a margin read in rows always holds. Fixed: a share of 3 rows or more is enough, not scarce; only scarcity decides.
- 1284, 18/24, the best yet: combo_storm 8/8, factory 5, large_garbage 5; every check green. Next: factory.
- Factory-6 (lost at 7145): no break found in 54 decisions with 32 to 40 panels of material; the beam's carried lines died again on being
  played (60, 42, 54 of them): kept with a break's time to spare, by the next decision a reaction later they had none. Fixed: a line
  stays in the beam with a break's time and a reaction to spare. And a carried toward line of 12 swaps spent the window 38 to 4 with
  every margin at 0.3: the log now names the four shares (mgs=: room, material, window, contact) to find which hid it.
- 1285, 11/24: combo_storm 8/8 a second run in a row -- done. Factory 2, large_garbage 1: the reaction of slack on the beam's doomed
  lines cost what 1284 had. Taken back out; the beam keeps a line with a break's time to spare. Factory next, read by mgs=.
- 1286, 18/24 (combo_storm 8, factory 5, large_garbage 5): 1284's numbers again. combo_storm 8/8 three runs running.
- 1287, the same build: in every loss no break was found after the last break, and no proven line was passed over. The piece: the break search. Where nothing is proven it still held each line to the
  mode's list and no wasted three, which step 8 asks only of proven lines -- so a break that needs a three first was never offered.
  Fixed: where the last decision played nothing proven, the break search is held to neither; the order ranks what it finds, and a
  three is played only where the save finds it needed.
