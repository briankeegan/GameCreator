# Gambit: the plan

The goal: never die from the garbage the game shows.

## The idea

- A board dies when it runs out of one of three things: **room** (rows over the stack), **material** (panels to break with), or the
  **window** (actions to press with).
- Every loss Gambit computes is a **lower bound**: when the board dies on the breaks the searches found, not on every break there
  is. A line can raise its own bound by spending what the next search would have found a break with.

## The guarantee

The engine is deterministic and the garbage is shown before it lands, so whether a plan survives what is shown is a computation, not
a guess. The guarantee is an invariant held by induction:

**At every decision, a plan is held that, played on the engine from this board, pays every row shown and ends on a board ready for
the next block the mode sends.**

- Held at this decision and only its swaps played, the board at the next decision is the one it predicted, so it is still proven --
  unless new garbage was shown.
- New garbage shown: the plan's end board was ready for it (a break found with that block landed on it), so a plan extending it
  exists, and the search finds it.

The induction can break four ways, and every loss is exactly one of them: (a) a swap not in the held plan was played while one was
held; (b) the board diverged from the engine; (c) the end board was marked ready and no extension was found; (d) no proven plan
was held and the search found none in time. (a) and (b) are bugs and are gated to zero. (c) and (d) are made rare by one rule:
nothing the proof needs is spent while no proof is held.

## The steps

1. **Proven first.** A line whose plan, played on the engine, pays every row shown before the board dies is proven. A proven line
   beats every unproven one. Whether its end board is ready for the next block the mode sends is read (the shape math, the swaps to the
   nearest break with the biggest block of the game landed on it) and logged (`er=`); it is not yet part of the proof -- see Learned,
   1289 to 1292.
2. **Unproven: the most left to find a proof with.** Of lines not proven, one that dies before it could press anything ranks last;
   then the one that leaves the most of its scarcest resource, then of the next -- the two scarcest only (`marginKey`: room, material,
   contact, and the window as the dues ask it), each enough at three rows; then the later loss. The build that measured best (1284,
   1286) ranks this way, and the play follows the order.
3. **Search for the proof.** When nothing offered is proven, the decision's search time goes to the break on the board the best line
   leaves, carried from decision to decision, and a readiness proposer offers the swap after which the board is ready for the next
   block. The hold is not a safe default at this level: the board left alone is lost within a few decisions (Learned, 1291).
4. **The margin for garbage not shown.** Proven means proven with k rows spare. The owner's to set; suggested 1.
5. **Convert more per break.** Each plan's first break is tried at every landing shown and the one that converts most is kept; each
   break after it is asked from the last landing back.
6. **A proof is kept.** A proven line is carried and pressed as judged, and proven again each decision. The press guard never refuses a
   swap of a proven plan.
7. **Search deep enough.** Where no break is found and the clock did not cut the search, the search goes a swap deeper on that board
   next decision.
8. **The mode still decides.** Among proven lines, the mode's list ranks them: aggressive within the mode, never at the cost of the
   proof.

## The gates

Every failure of the induction is named in the log and a check goes red on the ones that are bugs:

- **Divergence** (b): any decision whose board is not the engine's -- red (`gambit_summary.js`, "The truth held").
- **Unproven over proven** (a): a swap played that is not the held proven plan's, while one was held -- red.
- **Readiness wrong** (c): a plan's end board marked ready, a block shown, no extension found -- red.
- **Search short** (d): the loss names the decision no proof was first held at, what was shown, how deep the search got and the time
  it had. The only loss allowed, and the one to make rarer.
- **A fact that never varies is not a fact:** every margin share (`mgs=`) must vary over a game -- red when one is constant.

**The measure:** one run, one mode, its 24 games (`patterns: ["<mode>"]`, rounds 1-3). A piece stays if it raises the number. A mode
is done at 22 and then the next, and the goal is measured on all three.

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
- 1288, 15/24 (combo_storm 7, factory 2, large_garbage 6); combo_storm alone over three rounds 15/24. The break search held to
  neither list nor wasted three did not help. The log of every combo_storm loss, decision by decision: `logs/1288-combo_storm.md`.
  What it shows: in combo_storm-2 round 2 the block was shown at 4250 with 38 panels on the board; by 4547, before it landed, clears
  and carries that broke nothing had spent 23 of them for the mode's combos, and it landed on 15. The search then found nothing to
  break with, in this and all nine losses. And the window share reads 12 in every line of every game, the room share 0 in nearly all
  near a loss: the margin was ranking on constants. The plan above is rewritten from this: proven requires readiness for the next
  block; the margin orders the search and plays nothing; unproven, nothing is spent; four gates name every loss.
- 1289, combo_storm 14/24, the proof with readiness built. The gates ran: proven first 0, shares 0, readiness 1 (red). The readiness was
  never 1: over combo_storm-1's 1,079 decisions, 1 line of 8,899 was read ready, 2,145 not, 6,753 not asked. Two pieces: the block
  was landed on the end board after its whole lead again, so the board was read lost before it landed; and a line with nothing shown had
  no plan to ask, so it was never asked. Fixed: the block lands on the end board at once, and a line the plan did not ask is asked on
  the board it ends on itself. The log names why a line is not ready (er=WxH:ready/why:ready/not/unasked).
- 1290, combo_storm 9/24: readiness asked of every line, as a break search of each line's end board. It did not fit the clock: in
  combo_storm-4, 16 decisions of 1,122 held a proven line; of the first line's readiness 355 were cut before asking, 319 by the search,
  280 found no break; 230 decisions held for a proof that was not there. A proof the clock cannot reach is no proof. Fixed: readiness is
  read by the shape math (the swaps to the nearest break on the landed board, within 2), which every line can be asked in the clock; the
  decision that plays the line searches that board for the break. The readiness gate warns (a fuzzy check) and counts its misses.
- 1291, combo_storm 11/24: readiness by the shape math; proven first 0, shares 0, readiness 257 misses (warned). Three games died at
  the first block (490, 644, 2429). combo_storm-3: from the opener the board left alone is lost within 220 frames -- at this level the
  rise alone kills, so the hold is never safe -- and the order played the hold five decisions running over clears lost 19 frames
  later, the room share reading 0 for every line (a stack over the top read as none, however far over). Two pieces fixed: the room
  share reads below none, the rows the stack is over, so a line that lowers it reads more room than one that does not; and the hold is
  held for only while it lives -- where it is lost, the first line of the order that outlasts it is the save and is played.
- 1292, combo_storm 5/24: the room share below none and the hold held for only while it lives. The bot cleared for room every
  decision and the material went with it: 14 of 19 losses found no break. The four runs since the plan went in measure 14, 9, 11, 5
  against 15 and 16 before it: the pieces as built -- readiness in the proof, the hold for the proof, room below none -- cost games,
  each. Taken back out, all three; kept: the gates, the logs (er=, heldFor=, proofLost=) and the readiness proposer. The play is the
  1286 build's again, measured once to confirm, and from there one piece a run, from the loss logs, kept only if the number rises.
- 1293, combo_storm 14/24, the 1286 play again: back to where it was, every gate green. All ten losses: no break found after the last
  break. combo_storm-7 round 2, 1672 to 1711: the hold (lost at 147) played four decisions running over a carry lost at 202, by the
  margin -- one row of material, 3 against 2 -- the two lost alike within a break's time. The band was a break's time because a line
  lost less than that later fits no break more; but the search for the proof is carried from decision to decision, so a line lost a
  decision later leaves the search one more decision. Fixed: the bands are a decision wide; the margin decides only among lines lost
  within a decision of each other.
- 1294, combo_storm 14/24: the bands a decision wide measured the same. The reach report (gambit_reach.js) answers where the search
  stands: of 223 boards it came up empty on, searched again with no time limit, 220 had no break to find and 3 were missed -- the
  search is not the piece; the board is made unbreakable before it. The turns, read: combo_storm-8 round 3 at 682, a level line of
  one swap played as proven (its plan's break lives) over the carried 32-cell break; at 713 the plan's break was not offered
  (carryDrop=9: a one-swap line hands nothing on, and the promise it lived by was not kept), the board died at 808. A readiness break
  is found on the board to come and anchored to that board's bottom row, which is not yet on the board as it is, so the promise is
  dropped at the next decision. Fixed: a promise is anchored to a bottom-row panel of the board as it is, pressed where the readiness
  found it, and never moved by the rows risen; the log says whether it was kept (carryKept=).
- 1295, combo_storm 14/24: the promise anchored to the board as it is measured the same (246 boards searched again, 0 missed). The
  turns: combo_storm-1 round 2 at 10981, the line in progress (8 cells, lost at 229) played over a break of 32 cells lost at 639, and
  combo_storm-4 at 6774 the same (8 cells at 244 over 32 at 513) -- both by the mode's list (k4.list): every loss past three breaks'
  time was read alike, so the later loss never decided and the list did, among unproven lines. Fixed: losses are banded at any
  distance; a line lost four breaks' time later than another is not alike with it. The list ranks among proven lines.
- 1296, combo_storm 11/24: losses banded at any distance measured below the 14 and is taken back out. The turns: combo_storm-6 at
  19696 and 19713, the hold (lost at 123, then 106) over a survive line that breaks a slab and is lost at 299, and a toward line lost
  at 223, both by the margin's contact share (the hold's block lands flush on the stack, 12; the line's on a jagged one, 2). The loss
  reports have named 2.margin as the key most passed over in every run since 1294. One piece of step 2: a loss later by a break's time
  or more decides before the margin -- a break's time more to find the proof in is more than any share -- and within a break's time the
  margin decides as before.
- 1297, combo_storm 14/24, and the one-order gate red: 33 decisions played a line beaten head to head by one ranked under it. "A loss a
  break's time later decides" was not one order -- 100 and 150 by the margin, 150 and 200 by the margin, 100 and 200 by the loss.
  Fixed: the loss in absolute bands of a break's time decides first, the margin within a band, then the exact loss; a band is a band
  whichever two lines are compared.
- 1298, combo_storm 10/24, the loss in bands before the margin: below the 14, as 1296's 11 was. The margin first measures 14 five
  times; the loss first 11 and 10. The margin stays first, as the plan says. Taken back out.
- Readiness in the proof, measured alone: it ran only with the hold for the proof (1289 to 1292), which cost the games by itself.
  Now: the shape-math readiness in proofOf, the lines that live asked, no hold rule, the 14 build's order otherwise.
- 1299, combo_storm 6/24: readiness in the proof alone. The worst of the night; taken back out. The build is the 14 build again
  (margin first, no readiness in the proof, the promise anchored to the board as it is, the gates, the logs, the reach).

## Where this stands

Fourteen runs of combo_storm's 24 since the plan: 16, 15, 14, 9, 11, 5, 14, 14, 14, 11, 14, 10, 6, and 14 again now. Every piece of
the plan as built measured at or below the build before it: readiness in the proof (6 alone, 9 to 14 with the hold), the hold for the
proof (5 to 11), the loss before the margin (10, 11), the bands (14, neutral), the promise's anchor (14, neutral). What held: the
gates (truth, one order, proven first, every share a fact -- all green on every run but the one they caught), the loss logs, and the
reach report, which says the search is not the piece: of the boards it comes up empty on, 389 of 397 have no break to find. The
board is made unbreakable before the search runs, between the last break and the next block, and no ordering of the lines offered has
changed that. The next piece has to come from a comparison the logs can make and I have not: the boards the survived games leave
after each break against the boards the lost games leave -- height, material, where the next block lands -- to see what the lost
games do between breaks that the survived ones do not.
- The run summary of 1298, read whole: the break on the board to come was asked 15,992 times and 8,407 times the board was lost before
  the block landed -- the rise kills before the block arrives in half the checks. The ledger: games lost converted 140 cells a minute
  of 152 landed and cleared 150; games survived 149 of 149, and cleared 149. combo_storm's blocks are 4x1: the board dies of room. The
  room share reads none for every line under a block (floored at none), so no line that lowers the stack is preferred for it. Room
  below none was measured only with the hold for the proof (1292). Measured alone now.
- 1300, combo_storm 15/24: the room share below none, alone. The first number over the 14 in twelve runs; kept. The ledger: games
  lost 152 landed, 142 converted, 150 cleared (-8 a minute); survived 148, 146, 148 (-2). The board to come lost before the block
  lands in 11,193 of 20,286 checks.
- 1300's turns: combo_storm-1 at 15417 to 15451, a combo in progress (lost at 332, breaks nothing) played three decisions running over
  a break of 20 cells lost at 491, by the mode's list (k4.list) -- both proven at level 1, past the shown block and a break's time, and
  lost to the rise after. The list ranks among proven lines, never at the cost of the proof; a horizon a break's time shorter is that
  cost. Fixed: among level-1 proven lines, the loss in absolute bands of a break's time decides before the list; within a band, and
  among lines that live, the list decides as before.
- 1301, combo_storm 11/24: the horizon before the list, among level-1 proven lines, measured below the 15; taken back out. The build
  is 1300's (d46faa5f) again. Its turns show the other recurring pattern twice more: a one-swap setup whose plan lives (einf) played
  over a break of 32 cells (11705), and the plan gone at the next decision -- the summary counts it: of lines that lived with nothing
  new told, 22% did not live on at the next decision ("a life kept"), and 696 decisions a run lose the proof with nothing new shown.
- The whole plan carried (step 6): a line's proof is its plan -- its first break, each later break from the landing its readiness
  found it, and the survival line on from the plan's end board -- and only the first break was carried; the rest was found again each
  decision, in a decision's time, and often was not (proofLost=none with carryKept=2 in the logs; a 32-cell break passed over twice
  at a turn for a one-swap setup whose plan lived and was then gone). Now readyNextOf hands out the whole plan with each swap's frame,
  the outcome keeps it, the promise is carried whole, and the judge presses each later swap where the plan said.
- 1302, combo_storm 15/24, every loss on 1300's frames: the whole plan carried changed no decision. The log now says what the plan
  handed out holds beyond its first break and what the promise carried holds (plan=, carry=), to find where it is lost.
- 1303 (1302's play, logged): the line played holds a plan in 14 of 618 decisions, and the promise carried on never holds the plan's
  break (carry=N/0 throughout) -- there is almost never a plan to carry. The break on the board to come was found 153 times in that
  game, offered as a line 12 times, played 0: a break of one swap has no set-up to hand out, so it was found and thrown away. Fixed:
  a one-swap break is handed out whole, pressed once the block has landed (the line's waitTo), and a line with a wait before its first
  swap is judged with it whatever its length -- the judge's own wait never applied before a swap that was also the last, so a carried
  promise of one swap was judged pressed now and dropped (a step no longer there).
