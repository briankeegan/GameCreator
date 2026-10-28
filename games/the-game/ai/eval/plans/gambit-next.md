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

### The idle frame

Garbage lands, and the stack rises, only on a frame the board is idle: nothing matching, falling or swapping (pa.c shouldDropGarbage,
updateRiseLock). A swap in progress holds both. Measured on the engine (`test/stall_check.c`, a C check): fifty 4x1 queued and a pair
swapped every 4 frames, 3000 frames, nothing lands; every 5 frames or more, blocks land and the board is lost by frame 400. So every
block that ever landed on Gambit landed on a frame it left idle, and the queue in these modes is never empty after the first volley (50
blocks a volley, 950 frames apart; ~10 taken a volley). Death is never forced; it is taken, an idle frame at a time.

What follows, and what does not:

- **The board stays active by real play only** -- breaking garbage, making a clear, carrying a panel toward one, a cell a swap. The
  owner: never a pair swapped back and forth to hold the garbage off; that is no play. One rule, `rules.c putBackFor`: a swap that
  puts the pair the last swap pressed back and makes nothing is never a swap. The judge asks it of every line's first swap (`swapBack`),
  the searches as they grow lines (`firstOk`), the press guard of the swap about to be pressed (`front.c putsBack`, on the board as it
  is), and the guard's refusals are a gate at zero: one means the judge let one through.
- **A line's idle frames are its landings.** The judge plays the line on the engine with the queue on the board, so each idle frame
  with garbage queued lands a block in the judging, as in the game. The hold is a rain. Counted on the game: `idleQueued`, frames idle
  with garbage queued, a minute, games lost against survived.
- **The board readiness is asked of is the board at the frame the next decision can act** -- the line's end, settled, with whatever
  landed before it (`judge.c boardAt`, one function; the landed-break search asks it of the next block's landing). A swap pressed there
  holds the block off, so nothing that lands later is on it. Asked of the board one block landed instead (1332 to 1335), readiness was
  found a third as often and the proof's lines went with it: 18 to 12 and 13.
- **A three that lets a block down onto a break is real play, never a wasted three.** The owner's move on the boards the bot died on:
  a block perched on one tall column with four low beside it; clear a three under it, it comes down onto panels, break it with a
  three beside it. One rule, read off the nodes (`judge.c`, after readiness): the line's lowest garbage ends below where it began
  (`search.h Node glow`) and the line breaks garbage or its end board has a break in reach -- no wasted three, no floor spent
  (`outcome.c lineSpends`); the press guard's test asks the same of the settled boards (`wastedThree`, `breakBuildable`). Any three
  that moves garbage made free instead (1337, 9 of 23): the bot spent its panels digging.
- **Flatten and break: the flatten search** (`search/solve.c`, a job of its own, `answer.c JOB_FLAT`, second after the break search,
  under garbage or with a block on its way). Lines of swaps pressed back to back as the frame loop presses them, every legal swap from
  every board kept, the boards ranked by their shape for a flatten -- fewer empty cells under garbage, more columns touching it, a
  lower peak, an evener stack -- and each line asked, once the board has settled, whether it broke more than the board left alone.
  A break made by a fall shows only once the board has settled. On the 397 run-up boards of the games lost in 1335, a solver of
  that kind broke on 97 of 290 where everything else said none; 50 of the 52 boards where it broke and the bot's played line broke
  nothing had no break offered at all (32 under garbage, 18 with a block landing); the bot's judge accepts its lines. Replayed with
  workers, the build with it holds 191 times against 230 and plays a line lost later on 49 boards, sooner on 10. Its line goes through
  the shared line check and is proposed and judged like any other.
- **Ready is real play in reach.** The board a line leaves is ready when it has garbage on it and a break within the shape math's reach
  (`outcome.c endNear`, `nearOf`), or no garbage on it (`rank.c playReady`). Read, and in no key of the order: in the proof it played
  a line lost sooner for it 145 times in a run (1315, 6/24); as a tie-break among proven lines the list ranks alike, 306 times (1316,
  14/24). The shape math's reach is not the fact it needs to be; what keeps the next decision from idling is the carried break search
  and the readiness proposer (step 3).
- **The rest stays the board left idle.** The judge's loss, readiness's board to come and the plan's waits all run the board as the
  engine runs it: every idle frame a block. A rest at the game's measured pace (a block every 97 frames) was built and measured in
  all three places (1324 to 1326: 16, 14, 17) -- as the judge's loss it made the proof's bar fit everything or nothing; in the
  projections it tripled the lines that live and a quarter of them did not live on. The exact rest is pessimistic and right: the
  bot's own future presses are not a fact, and a projection that assumes them promises what the next decision cannot keep.

## The steps

1. **Proven first.** A line whose plan, played on the engine, pays every row shown before the board dies is proven. A proven line
   beats every unproven one. Real play in reach on the board it leaves (The idle frame: `playReady`) is read, not ranked on. Whether its end board is ready for the next
   block the mode sends by the fuller shape math (the nearest break with the biggest block of the game landed on it) is read and logged
   (`er=`) but not part of the proof -- see Learned, 1289 to 1292 and 1299.
2. **Unproven: the most left to find a proof with.** Of lines not proven, one that dies before it could press anything ranks last;
   then the one that leaves the most of its scarcest resource, then of the next -- the two scarcest only (`marginKey`: room, material,
   contact, and the window as the dues ask it), each enough at three rows; then the later loss. The build that measured best (1284,
   1286) ranks this way, and the play follows the order.
   **2b. The reserve veto.** Before the line on top is played, the break search itself is asked of the board it leaves -- as it is,
   known colours, no projection, 40 ms a board, two boards. No break in reach there, by a search that FINISHED, while a line below it,
   alike as proven and as lost (a break's time), leaves one: that line is played. A search answer is a fact only when the search
   finished: a none the clock cut is unknown and vetoes nothing. Every loss is a board with no break in reach, entered and not
   escaped; the veto refuses the avoidable entries (`decide.c reserveOf`, logged `veto=played/asked/cut`; its decisions counted apart
   by the gates).
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
- **No pair put back:** the press guard refused a swap that put the last pair pressed back for nothing -- red (`put back:`).
- **The stall is a fact of the engine, not a move:** `test/stall_check.c` fails the C checks if a board alive past 300 frames idle
  takes a block with a pair swapped every 4 frames.

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
- 1313, combo_storm 14/24, and the one-order gate red (23 decisions): the later loss net of what the line spends. A loss net of
  the spend is not one order with the bands -- two lines alike by the gross loss order one way, and the net loss the other. Taken
  back out. The build is 1309's again (19).
- 1314, combo_storm 19/24: the 1309 build again (the net loss out), the same five losses to the frame. Measured with it, on the
  engine (test/stall_check.c): garbage lands and the stack rises only on an idle frame -- fifty 4x1 queued, a pair swapped every 4
  frames, 3000 frames, nothing landed; every 5 frames or more, blocks land and the board is lost by 400. Every block that ever
  landed on Gambit landed on a frame it left idle. The owner: no swapping a pair back and forth to stall -- the board stays active
  by real play only: breaking, making, carrying a panel toward one; never a pair put back.
- 1315, combo_storm 6/24, the idle frame's first build: readiness in the proof (a line leaving no break in the shape math's reach
  unproven) played a line lost sooner than one offered 145 times by the proof rule alone (1309: none); and the put-back gate red, 119
  refusals at the press -- the pair handed to each decision was the last pressed when the question was asked, not by the frame it is
  asked for, so lines beginning with a put-back were judged clean. Fixed: readiness a tie-break (lost alike; proven and list alike),
  the pair as of the question's frame (the swaps planned until then pressed on the predicted board), the judge seeded with it, the idle
  frames counted by the engine's own drop (the count read the activity a frame early and found none).
- 1316, combo_storm 14/24, every gate green, put back 0: readiness as a tie-break decided 306 plays of a line lost sooner (rule
  4.ready) -- out of the order. Idle frames with garbage queued: 38 a minute in games lost, 37 in games survived -- idleness is not
  what parts them; conversion is (141 cells turned to panels a minute in losses against 147 landed).
- 1317, combo_storm 16/24, gates green, put back 0: readiness out of the order gave two back. The gap to 19 is the put-back rule as
  the judge applied it -- seeded into the in-line undo rule, it cut any line swapping the pressed pair back, a clear or a break too.
  Now the judge asks the one test (putBackFor, with what the swap makes) of every swap of a line, as the guard asks it of the press.
- 1318, combo_storm 15/24, put back 199 (red): the judge's put-back cut came after the swap's press frame was recorded (ats), so the
  cut line was handed on whole and the guard refused the swap. The cut now sits with the in-line undo cut, before the swap is recorded.
- 1319, combo_storm 16/24, put back 192 (red): the judge's cut sat right but the pair it tested was a copy handed with the question,
  stale by the frame the swap was pressed. Fixed as infra, not as a particular: the engine records the pair every swap swaps on the
  board itself (pa.c doSwap, Board.lastSwapA/B), every board stepped or copied carries it, the truth takes it from the frame the engine
  played, and `putBackFor` reads it from the board it is asked on. Nothing is handed with the question.
- The losses of 1319, read together: every one is "a break was there at T, none from T+30": the last break played, the colours it
  revealed gave no three touching garbage, and the exhaustive re-search confirms none to find on 188 of 189 such boards. Not a search
  failure. Under garbage the bot sits with no break candidate 47-51% of decisions in games survived and 59-67% in games lost; a
  decision with none has none at the next 86% of the time; with one or more, 14-18%. The game is a chain between "a break in hand" and
  "none", the "none" state is sticky and lethal over time, and losses are the games that spent longer in it. Non-breaking clears under
  garbage (20-31 a minute) and breaks (61-77 a minute) do not part lost from survived.
- 1320, combo_storm 16/24, put back 176 (red), the C checks red: the record on the board made the pair one state, and the log then
  showed the disagreement was in "what the swap made" -- the judge, settling a line's first swap, counted the board's own chain's
  clears to the swap (madeBy: any panel cleared in the step), so a pair put back for nothing read as a clear and passed; the guard,
  reading the swap as it showed, read nothing. One function fixed: a clear counted to a swap is one the board left alone did not make
  by then (pa.c panelsCleared against the board alone), as breaks already were; the guard settles the swap before reading it. The
  checks went red because the record sat in the board's head and changed the bytes dumped boards load by; it sits past the head now.
- 1321, combo_storm 18/23 and put back 0 (green), one game lost to a crash: madeBy fetched boards from nodes on a worker, which keeps
  none. The cleared count is on the node now, as the break count is.
- 1322, combo_storm 19/24, every gate green, put back 0, truth 0: the 19 again, with the owner's rule in -- no pair put back for
  nothing, judge and guard reading one record the engine writes. The five losses are 1321's.
- 1323, combo_storm 14/24: the rules' keep as the order's key after the proof, with the floor spent read as net material (a break
  that clears more than it converts included). The key decided 428 plays of a line lost sooner, and the shared line check, asking the
  same test, kept no net-negative break below the keep for the searches -- fewer breaks found. Both back out; the keep is the list's
  own key (step 4) and the floor spent is the clear that breaks nothing, as in the 19 build. Learned: every loss ends below the keep,
  but holding material by refusing net-negative breaks loses more than the material buys -- a break is income in the colours it
  reveals, whatever it nets in panels.
- 1324, combo_storm 16/24: the rest at the game's pace alone. The clock was not it (the budget line is the 19 build's: ~190 ms of
  wall a decision, the game waiting). Lines that live stayed at 4% -- living is gated on readiness found, not on standing. What moved:
  at pace nearly every line passes the proof's bar (the last row shown and a break's time: 120 frames), so the list decided more and
  the margin less. Next: the proof as the pace world needs it -- proven only when the line stands to the whole horizon at pace.
- 1325, combo_storm 14/24: the pace as the judge's loss with proven = stands the whole horizon. Nothing passed, the margin decided
  6240 plays of a line lost sooner (2500 in the 19 build). The judge's loss is exact again with its 120-frame bar; the pace goes to the
  projections only -- the board to come (readiness: 11594 of 20981 askings found it lost first under the idle rain, unchanged by
  the judge's pace, 11108 and 10565 in 1324 and 1325) and the plan's waits for a landing.
- 1326, combo_storm 17/24, gates green: the pace in the projections only. Lines that lived 763 (230 in the 19 build), of which 73%
  lived on at the next decision (86%): optimistic readiness. The board to come still lost first on 10802 askings (11594): those are
  the line's own landings, not the rest. Out; the engine and the judge are the 19 build's again (1322).
- 1327, combo_storm 12/24: the reserve veto on 20 ms answers -- asked on 11253 decisions, swapped the line 917 times, and the gates
  red (915 beaten head to head: the veto overrides the order by design). A search answer is a fact only when the search finished: the
  live search with its whole share still reports none in its time on a quarter of boards, so a 20 ms "none" is the clock, not the
  board, and the veto then preferred whichever candidate's short search got lucky. Adjusted, not reverted: the veto acts only on an
  exhaustive none (a cut none is unknown), 40 ms a board, two boards; the gates count the veto's decisions apart.
- The audit (three readers of the seams, same day): (1) "played" meant planned, not pressed -- after any drop the next decision
  restored the state of an answer whose swaps never happened (a last pair never swapped, a carried line whose head never went in,
  frontiers re-rooted past swaps not pressed). Now the frame loop records the swap pressed last (moveBegin) and a drop rolls the
  question's played state back to it (`front.c playedRollBack`). (2) The rules kept a second copy of the last pair, carried answer to
  answer and stale with (1); a hold counted as a repeat. Gone: the engine records the pair, its runs and its frame on the board
  (`Board.lastSwapRuns`, `lastSwapAt`) and the rules read only that. (3) Topped was read when the question was asked and consumed at
  its frame, up to 90 frames later: now computed on the question's board. (4) The prediction pressed a raise the frame loop cuts on a
  topped board: one `raiseCut` for the press and the prediction. Second pass, from the audit: the move-in-hand path reports the old
  answer as played; overdue capped arrivals vanish from the question (72 or more queued); a held key counted twice at the ask frame.
- 1328, combo_storm 17/24, every gate green: the audit's fixes and the veto on finished answers. The veto swapped 143 lines of 13636
  askings; 11660 of 16238 board searches were cut at 40 ms and counted unknown; it acted in one loss's run-up (game 2, 50 frames
  before). The finding that matters: the live break search found none on 18050 decisions and the clock cut 10165 of those -- more
  than half of every "no break found" is "no time", under the mode's own think budget. And on the measure: at three games in four,
  one run of 24 moves by about two games on any change at all; 17 against 19 is inside that. The gates and the counts are the signal.
- 1329, combo_storm 18/24: the audit's fixes with the capped arrivals; the six losses of 1328 less game 2. One put-back refused at
  the press (red): the judge read the swap's making at its line's own step kind, the guard at a settle, and a swap back that made a
  combo read as play to one and nothing to the other. One reading now (judge.c madeSettled), asked only when the pair matches.
  Pushed with the veto measured for truth (GAMBITV boards searched again by the report).
- 1330, combo_storm 18/24, every gate green, put back 0: the veto measured for truth -- 40 of 144 vetoes took a line off a board
  that had a break (searched again with 3000 ms). A none at 40 ms with the clock not out is still not exhaustive: the beam ends. A
  wrong veto is cheap, though: the line it takes instead is alike as proven and as lost and its reserve is a fact (a break found is
  a fact either way); the veto prefers a confirmed reserve to an unconfirmed one. Six losses, the six of 1329: two with the hands
  down to 0 and 1 actions, four dead-end boards held 48 to 139 decisions.
- The window reserve as a filter (1329's two hand deaths): under garbage a line that breaks nothing and leaves the window below a
  break's walk at the next landing is out of the order, as a wasted three is -- unless it is the save, or every line but the hold
  spends it. A reserve that is a key is no reserve.
- 1331 cancelled (one master run at a time). 1332, combo_storm 13/24, tsan red: the board to come as one block landed did what it
  was for on its own numbers -- readiness found a break on 4888 boards (3301), the board lost first 4673 times (11594) -- and
  carried an introduced bug: the promise's wait was the frame the block dropped on, not the frame the board to come was settled on,
  so every carried readiness break was pressed a few frames early on a board with the block still falling (1085 proofs lost with
  nothing new shown), and the new record was shared across threads. Both fixed in the one function; 1333 runs it.
- 1333, combo_storm 13/24: the promise's frame fixed and still 13 -- the board to come, walked four frames at a time to a cap of
  150 per candidate line, cost the judge most of its readiness askings (4494 a game where 1330 asked 12217): the breaks and lives
  categories collapsed (59 to 4, 18 to 1) and the order fell back to buys. The definition stays; the computation is three steps:
  settle, two frames (the drop comes on the first idle frame), settle. One put-back refused (red), 1 in 24 games, noted.
- 1334, combo_storm 12/24, and the C check (checks (test)) red since 1332 -- read at last: a 24 is not the gates alone, every
  job's conclusion is. Two introduced bugs, both found by the C check in 30 s on this machine, not by a 15-minute run. One: the
  board to come answered a dead board where a live one came first (a block that lands and tops the board), so readiness was never
  found on a board that must act before the block, no line proven, and a board lost in 18 frames left alone -- outlived by the 18
  build -- was lost (test/main.c, a board on its way out). Now the last live settled board is the board to come; a dead settle of the
  line's own end stays lost first. Two: the order's bands counted back from a reference the sort sets (rankLostRef), and the walking
  order's comparison (judgeWalked) ran before any sort, on the reference the decision before left -- the same board answered
  differently twice (test/main.c, unsteady: a pair banded alike on one asking, apart on the next). Every entry to compareJudged now
  sets its own reference (rankTogether). The window reserve filter changes 1 move of 207 replayed and stays. For reading a verdict:
  GC_GAMBIT_LOG writes the checks' decisions, GC_GAMBIT_TRACE the order after each stage and the walked-order comparison,
  `test DIR one N` asks one question twice.
- 1335, combo_storm 13/24, both bugs fixed and the put-back gate red by one, the thread check red: the pair's reference was a plain
  static written on a worker (LOCAL now). Still 13 with the bugs out, so the board one block landed is itself the loss: readiness
  found a third as often (lives 1.49% of lines to 0.39% over every game's first hundred decisions, 1330 against 1334) and the
  proof's lines with it. The board readiness is asked of is the board at the frame the next decision can act (the line's end, +2),
  settled, with whatever landed before it -- a swap pressed there holds the block off, so nothing that lands later is on it. One
  function (judge.c boardAt) with the asker's own frame: the judge's is the line's end, the landed-break search's the next block's
  landing. The replay moves 1 of 207 against the golden; 1336 runs it.
- 1336, combo_storm 14/24, green: readiness back on the board at the line's end and the thread check green. 14, not 1330's 18: the
  audit's fixes, the shared put-back reading and the window filter stand between, each measured as a move or two of 207 replayed;
  the seed-to-seed noise is two games. The owner, shown the death boards (Gambit Death Boards): "all should be able to drop down the
  top blocks (or one below) and break with a 3" -- the let-down three above, the structural blind spot: the reach math walks panels
  sideways to a block as it stands, and the rule against wasted threes refused the clear that brings the block down. Measured first on
  the death boards replayed (`test DIR` on the 397 run-up boards of the 11 lost games), then the 24.
- 1337, combo_storm 9/23, one game crashed in the touch beam on a worker: any three that moved garbage made free spent the panels;
  the rule narrowed to a block let down onto a break. The owner, again: every death board had a solve, "multi move, not one swap",
  "flatten and break". The old oracle let the board settle between swaps, so blocks landed mid-line; pressed back to back and ranked
  by flatness the solver breaks on 97 of 290 (`test DIR solve`, GC_SOLVE_BEAM). The C check now carries the tools: `solve` (both
  solvers), GC_BREAK_TEST (the bot's break search on a board, with the touch beam's switches), GC_JUDGE (the judge's verdict on a
  line), GC_TRACE_LINE (a line through the search's eyes, swap by swap). The flatten search is in; 1338 runs it.
- 1338, combo_storm 11/24, all 24 played: wasted threes 140 a run. Read against every run: 16 a run through 1330 (18/24), then 52 to
  57 in every run from 1332 on, 140 in 1338. The window reserve filter (88da8c92) was put between the save's two halves -- "drop every
  wasted-three line" and "else mark the confirmed save needed" -- and took the else for its own: under garbage the save's three was
  never marked needed. The let-down rule called a three free on a break in reach, a guess, not a break. Back to 1330's build
  (63598f5f) for Gambit's source; each idea since is put back one at a time, each checked on the C check and the death boards before
  the next: the test tools, the put-back reading shared by judge and guard, the bands set by every comparison and kept per thread, the
  window filter after the save, the let-down three only where the line breaks, the flatten search with the one break test.

- 1339, the 18 build restored: 17/24 on combo_storm's 24. That was the wrong 24: the goal's is 8 of each mode, seeds 1-24, one round.
  1340 to 1343 run the goal's 24 on the 18 build and its behaviour-identical tools: 12, 12, 13, 13 (combo_storm 4, factory 5,
  large_garbage 4), the same games lost every time.
- 1344, 9/24 (combo_storm 6, factory 1, large_garbage 2): every search rooted later now presses in the window as it is then
  (core/nodes.h laterBegin). The survival continuation read the question's window from the line's end board with the line's actions
  unspent, and proved the setups combo_storm 3 and 6 died on; both live now. Factory and large_garbage lost 9 games to a block shown
  with every line short. Their run-up boards (the last 700 frames, 299 of them) are lost under any search time: the decision replayed on
  them at 1x, 5x and 15x the live work finds no board that lives, and as many lines lost sooner as later. The wasted-three rule took
  about one candidate a decision out of the order, lines that broke 6 cells among them (large_garbage-1, 1547: a lineup break lost at
  461 dropped for a three on its way, the line played lost at 333).
- 1345: a line that breaks garbage wastes no three (judge.c judgedWastes). On the 299 run-up boards, 20 decisions change, 15 lost later
  and none sooner.
- 1346 to 1358, on the goal's 24: 13 (combo_storm 8/8 for the first time), then 5 to 11 while the order was searched, then 17
  (combo_storm 6, factory 7, large_garbage 4). The old build 01290f76 played again on today's runners scored 15 (1, 7, 7): it held
  factory and large_garbage. Today's Gambit on the wall clock scored 2 (gambit-paced, 1352): lockstep hides how heavy a decision
  has become. What the old build did and today's did not, each found on a board and fixed in the order or the searches:
  - the margin's penalty for a line dead or spending the next break was a row over the top, better than a board buried under the
    blocks shown reads -- the penalised line ranked first (MARGIN_LEAST);
  - a hold lived by a readiness break the board died before pressing, ready again each decision under a queue of blocks;
  - of two lines that convert, the one that leaves the board more panels (netPanels), and the one that leaves a next break to build,
    first -- a 6-combo bought two rows with the stack's own panels until no break could be built (large_garbage-3, 8622 to 9417);
  - the flatten search where a block rests over a gap: the well under it was dug out where the towers had to come down (factory-4,
    8413). factory 2 to 7.
  Every key of the order is read off each line alone: keys guarded by the pair's losses ranked three lines in a ring (one order, 56).
  The C check gains `test DIR replay WORK` (each question decided on WORK frames, with its log line) and `test DIR verdict LINES` (any
  chooser's lines judged on one judge); the report counts, per mode, what is played while a slab pops.
- 1359 to 1366: 16 to 19 (1362 to 1365 19, all gates green), then 15/23. The unproven "longer" (a break's time later) ahead of the
  next break and the material saved factory-5 and lost factory 6, 7, 8 to material passed over; it now sits after them, ahead of the
  margin. combo_storm-5 in 1366 crashed on a worker in the touch beam: `NODE(x, aloneNodeAt(...))->brk` read x->nodes before the
  call, the call's step grew the nodes, and the new node's index read past the old block -- a crash when it reached unmapped memory,
  a wrong `brk` (stillAt, every break test of every search) when it did not. Fixed, and `gate_gambit_engine` fails on
  `NODE(x, call(...))` anywhere in gambit/.
- 1367, 15/24 (5, 4, 6), no crash, every gate but the score green. combo_storm-1 at 2284: at 2069 "next" played a break lost at 174
  over a survive line lost at 275, at 2099 "material" a hold lost at 144 over a line lost at 292, and nothing broke again. The
  material is worth a break only to a board that lives to build and pop it: its own break popping, the next built, the next popping
  -- three breaks' time (a row's pop at level 11 is 84 frames, a break's time about 95). A key before the next break and the
  material, the breaks' time to the loss capped at three (SOON_BREAKS), puts the line lost later first within that horizon and leaves
  the material to decide past it.
- 1368, 18/24 (6, 6, 6), every gate green, put back 0. combo_storm-5 at 2922: at 2801 a broken slab's colour came to a clear the plan
  was made without (REVEALCLEAR) and the plan was dropped; the next question was asked for 2891, 90 frames on, by the rule for a board
  on its way out with no break found -- whose facts (lastHold, lastBrk) were the dropped answer's. Nothing was pressed from 2801 to
  2891; asked then, 32 frames were left. A drop now clears them (front.c dropAll, dropFrom: havePace), so the question after a drop
  is asked as soon as it can be.
- 1369, 18/24 (7, 5, 6), every gate green; combo_storm-5 to 10659 from 2922. Five of six losses ran the window to 0-4 with no break
  found. factory-1 at 4365: a 12-swap carry broke 6 at its end, 149 frames on, and a block shown at 4148 landing before it took the
  break away; the window went 41 to 26 pressing it. While a slab pops the lineup search finds nothing on these boards -- the row's
  colours are unseen until they pop -- and the board to come (search/ready.c landedBreak: the break the shown block will need, found
  before it lands) was queued behind every other job and ran at depth 0 in 31-34 decisions a lost game. With a block on its way it
  now takes a worker after the survival search, ahead of the planner's half, the extension and the wider beam.
- 1370, 19/24 (6, 6, 7); the put-back gate red by one. combo_storm-1 at 1716: the line's first swap was judged on the board where
  its walk began, where its two cells were empty; the pair the last swap moved fell into them a frame later, so the swap pressed put
  that pair back for nothing and the frame loop refused it. The judge now reads the pair a swap swapped from the engine's record on
  the swap's own board (lastSwapA, lastSwapB) against the pair before it, and holds a line's last swap to the same test (it had none).
- 1371-1373: 17/24 (5, 6, 6), every gate green; 1373 played 1371's games exactly (lockstep). The one put-back refusal left came after a
  colour was shown that the line was judged without, now counted apart (put back after a colour shown); the report names each
  refusal's game and frame. large_garbage-7 at 11045: a 6x12 queued at 10926 lands on a board topped by it, 12-18 panels of material
  -- lost before then. While a slab pops its colours are shown a cell at a time, and a hold with no break found was held out on the
  colours known when it was asked: such a hold is now asked again at once when a colour is shown (front.c take and the reveal), every
  question still answered before the next.
- 1374, 18/24 (5, 7, 6), every gate green; a hold asked again 1889 times for a colour shown. combo_storm-3 at 3256, the same in
  1371, 1373 and 1374: at 2999, with a block shown landing in 89 frames and none on the board yet (under=0), a clear that breaks nothing,
  lost at 190 and at 522 by a readiness break still to find, was played over two lines that wait for the block and break 40 of it, lost
  at 520 -- by the mode's list; the window then ran from 8 to 0 and nothing broke again. The material keys (converts, next, material)
  read garbage on its way as garbage (rank.c garbHere), and of two lines proven by their plans alike, the one that converts goes first.
- 1375, 18/24 (5, 7, 6), every gate green. factory-7 at 5113, the same in 1371 to 1375: from 4641, 40 panels and the window at 11 to
  15, every break the search found walked 8 to 10 swaps and the judge cut each for the window (cutWhy 1); the touch beam grew those
  lines on anyway. The beam now holds every swap it grows to the judge's window test (search/break.c: allowLeftAt at the swap's frame,
  less the line's own walk), so its width goes to lines the window pays for.
- 1376, 18/24 (5, 5, 8): large_garbage 8/8 for the first time, every gate green. combo_storm-3 at 780 (3256 before e9df5ae3): with a
  block shown and none on the board, the material key (netPanels) played holds over clears and survive lines lost 55 to 75 frames
  later -- before a block lands there is nothing to convert, and the panels a clear takes are what keeps the board up. The next break
  and the material read garbage on the board only again; converts reads garbage on its way too.
- 1377, 19/24 (6, 6, 7), every gate green. factory-2 at 6239 (1376 and 1377): from 5770 to 6078 every break was a 6-cell row for 1 to
  7 swaps, and they spent the window from 39 to 3; it stayed at 1 until the loss -- actions come back only as they age out of 600
  frames. With a window to keep, the touch beam now ranks a level's breaks by cells broken per action, then the fewer actions, and
  searches the level after the first break found every time (it did only past CHEAP_BREAK actions). On these boards no bigger break
  is one swap on: the blocks convert a row a break, and only a chain through the converted panels breaks more.
- 1378, 18/24 (7, 4, 7), every gate green; factory-2 and factory-4 as in 1377. factory-4 at 3311: from 2907 to 2983 toward lines of 8
  to 11 swaps that break nothing, lost at 302 and at 405 by the readiness break they lead to, were played over lines lost at 339 on
  their own, by "longer"; at 2999 a block shown landing a frame later took the plan away, the window ran from 17 to 5. Of unproven
  lines, "soon" and "longer" now read a line's own loss (ownBreaksTo): the readiness break is still to be pressed after the line,
  through garbage not yet shown, and the proof is what reads it, with its margin for that garbage.
- 1379, 21/24 (7, 7, 7), every gate green -- own losses in rule 2. large_garbage-8 at 10637 (1378, 1379): under garbage with 12 to 18
  panels, from 10356 to 10503 the line played flipped between a carry breaking 6 and toward lines of 8 to 10 swaps breaking nothing,
  the toward lines proven by a loss a few frames past the proof frame (199 and 218 against 193 and 174) -- every flip a line part
  pressed and left. Under garbage a line that converts nothing, now or in its plan, proves nothing (rank.c proofOf): it is only lost
  later.
- 1380, 16/24 (4, 7, 5): a line converting nothing unproven under garbage took the proof from holds and from survive lines that clear
  for the stop time -- large_garbage-8 lived to 21509, five others lost. Narrowed to what 1379 showed: under garbage, a line that
  presses swaps and neither breaks, plans a break nor clears (the toward lines) proves nothing.
- 1381, 16/24 (5, 3, 8) with the narrowed rule: both readings of "a line that converts nothing proves nothing" won large_garbage 8/8
  and lost factory and combo_storm more; out. The order is 1379's. A break's time is now the blocks' own (decide.c breakCellsOf): the pop
  of the row the board breaks next -- the lowest garbage row on the board, else the first block shown -- and each row of a block shown is
  due its own row's pop after the last. Shake is the engine's already in every line's loss: on a landing the shake is the peak of the
  stretch in progress, the largest, reset to it by any block landing before it is out (Stack.lua 1679).

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
- 1304, combo_storm 14/24: the one-swap break on the board to come offered, pressed at the landing. It was offered (178 candidates in
  one game against 12) and judged with its wait, and it broke nothing in 33 of the 37 lines that reached the order -- the swap the
  search found on the board to come does not break the block when the judge presses it there. Below the 15; taken back out, with the
  finding: before it is offered again, the judge's board at the landing must be checked against the search's (the same frame, the
  same settle), swap by swap. The log keeps plan= and carry=.

## Where this stands, end of the night

combo_storm 15/24 (1300, 1302), the build on main. Twenty runs since the plan. The order stays as set: proven first, the margin, the
later loss; the room share reads below none. What the logs established this night, each with its number: the search is not the piece
(reach); the hold is never safe at this level (half the readiness checks find the board lost before the block lands); the plan the
proof rests on exists in 14 decisions of 618, so steps 5 and 6 have nothing to carry; the break on the board to come is found in a
sixth of the checks and, when it is one swap, is thrown away -- and when offered, does not break when pressed. That last one is a
defect with a number and a place (search/ready.c landedBreak against judge.c's wait), and the next piece.
- 1305, combo_storm 15/24 on 1300's frames (the check changed no play): the one-swap check never fired -- the breaks the landed-board
  search finds are not one swap. 1303 was misread: those breaks were handed out all along, as set-up lines, and are in the candidates
  (154 of 153 found in combo_storm-1); the judge ranks them low (their own loss is the landing, their plan shorter than other lines'),
  so a dozen reach the order's first eight and none is played. No break was thrown away. The instrumentation stays (it costs nothing
  and would fire on a one-swap break); the piece it was built for does not exist.
- Trying, one a run: combo_storm-6 (1304) spent its material from 51 to 22 between 2703 and 3307 on combos under garbage -- entries
  that broke nothing, then entries that broke 8 and cost more -- and from 3355 nothing broke for 440 frames with 15 to 21 panels. The
  margin cannot see the drain: material reads enough down to three rows. Step 2 piece: under garbage, of two unproven lines not dying
  now, one that converts garbage before one that converts none, then the margin.
- 1306, combo_storm 15/24, gates green: converts-before-margin kept (combo_storm-6 lived to 11660 from 3794; others fell). Next:
  combo_storm-3 dies at 896 in every run since 1300 -- the first block, 37 decisions, no break found from frame 0 -- one fixed game
  to read whole.
- combo_storm-3, read whole (dies at 896 every run): at 372 a carry dead at 32, its plan dead at 97, was played over the carry in
  progress lost at 260, by the margin -- the dead line read 5.5.12.12, the best in the order. A dead line has no board to read; the
  fallback (the board as it is now) was built for a judging the clock cut, and handed to a dead line it reads the room, material,
  window and contact of a board that line never reaches. Fixed: a line judged dead with no plan board reads room below none.
- 1307, combo_storm 17/24, gates green, the best of the mode: a dead line reads room below none. combo_storm-3 survived (896 in
  seven runs running). Lost games now convert 132 of 147 a minute landed (-13), survived 147 of 148.
- combo_storm-1 (1307, lost 3379), read: with the board clean and 48 panels, four clears of one swap that made nothing (3061 to 3126,
  combo 0, broke 0) were played over the hold by the margin's window share -- 2 against 1 -- and spent the window from 11 to 1; the
  block then landed on a board that could press nothing. The window's cover moved each due to the line's end, where the window had
  refilled, while the hold read it at the due. A due is when the row must be paid; a line still pressing past it has not covered it.
  Fixed: a due is never moved to the line's end.
- 1308, combo_storm 19/24, gates green: a due never moved to the line's end. Kept. Lost games convert 144 of 153 (-6). Next piece, from
  1307 combo_storm-7 round 2 at 5265: a line that spends the next break (leaves none to build, outcome.c spent) reads its end board's
  margin, 4.5.12.12 there, and only diesNow keeps it down while it is short. Room below none for it, as for a dead line.
- 1309, combo_storm 19/24, gates green: the spent line's margin, kept (combo_storm-6 to 4598 from 4074). Next piece, from 1308's
  combo_storm-6, 3851 to 4012: the window went from 16 to 0 over eight decisions of proven combos while the window share read full,
  because the dues' cover reads the window as it will have refilled by each far-off due -- and the next line spends more, and the
  next; at the due nothing could be pressed. The share now reads the next break's walk kept at the line's end too, and is the lesser.
- 1310, combo_storm 17/24: the window share as the lesser cost two games; out. The build is 1309's again (19).
- Step 4's material: in 1309's combo_storm-6 at 4020 a carry proven to 388 (every row shown paid, a break's time spare) was played
  over the hold and spent the material from 33 to 14 on combos; the block after the horizon found nothing to break with. The margin
  for garbage not shown is material as well as time: a plan that ends with its material scarce (under MARGIN_ENOUGH, three rows) is
  not proven against the next row. Level-1 proof now requires it.
- 1310's combo_storm-7, read: every line logged as living by its plan (einf) had an empty plan, plan=0/0 -- the "lives" came from the
  survival search played on from the line's end board, read as the line's loss and handed out as nothing, so the next decision had
  nothing to carry and the proof vanished (proofLost=none; at 12238 a setup lived by its plan over a 16-cell break, at 12271 it was
  lost at 157). Now the survival line is the line's plan, handed out from the line's end and carried. (Measured after 1311.)
- 1311, combo_storm 15/24: material in the proof cost four games -- lines proven by time but scarce of material were the ones keeping
  the board alive, and unproven, the hold took their place. Out. The plan piece (the survival line handed out as the plan) runs
  alone on 1309's build.
- 1311's combo_storm-6 (2753), read: 2555 to 2698, four lines of one swap (level, setup) that made nothing were played over the hold
  by the later loss -- each lost 48 frames after the hold by its extension -- and spent the window from 12 to 1; at the block nothing
  could be pressed. The later loss is compared gross; the survival search already compares it net of what the line spends (the window
  is time, lostNetOf, defined and never called). Step 2's later loss is net now. (Measured after 1312.)
- 1312, combo_storm 13/24: the survival line handed out as the plan cost six -- carried and pressed as judged, those lines did not live
  (a life kept 82%, readiness 986 misses): a survival line found in a few ms is not a plan. Out. The net later loss runs alone on
  1309's build.
