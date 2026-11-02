# Newsey — running to-do list

## Gambit (the bot) — the owner's asks, top first

Each line: the ask, then where it stands. A fix ships to main only when it holds survival over two runs; one that costs survival is
narrowed, not dropped.

1. **No 2x chains it does not continue.** A 2x is taken to three, or not made, unless doing otherwise kills the board.
   - On main: a 2x going is taken to three among lines that survive alike, and at least to three in every mode; the extension offers
     the three that breaks the most; a line making a 2x not taken to three is taken out unless every other is lost within a break's
     time, a plain break offered beside it. 2x share 42% to 33%, switching 24/24 on 6-minute games (run 2010).
   - On main: a 2x is read on the judge's count where the board is lost during the line, so the rule takes it out (c3413ac8).
   - Not better, each costing survival: the 3x put before survival, or before it within a break's time; the extension's three kept
     whatever material it leaves; the extension or the wider break search given the planner's half's thread.
   - Put before survival the 3x cost survival (19/24, 2x share 26%). Open: the 2x with no three found (465 of 1411 decisions with a
     2x going, run 2006).
2. **No flipping back and forth.** A swap and its swap back is two inputs for nothing.
   - On main: the swap back the last swap pressed refused; a swap and its swap back inside a line handed on as a wait; no search grows
     a line by swapping straight back; no swap back among lines lost alike. 3.1% of swaps to 1.2% (runs 1972-1979).
   - Open: the rest are a change of mind once garbage turns to panels -- the next line begins by undoing the swap just pressed.
     Such a line judged again without the swap back: on main. Next: a swap handed on asked again before it is pressed once garbage
     turned to panels since the line was judged.
3. **No lazy waits.** Never sit with the cursor still and then rush; play what can be swapped now.
   - Steady over a popping slab (a line not found to break pressed straight through): on main.
   - A swap whose pair stays locked over 20 frames is not there, so lines that use what can be swapped now are played: on main
     (8354a299).
   - Still 13% of gaps between swaps over a second: they are decisions that hold. Waits filled with setup and flattening: next.
4. **Every round a new game, nothing carried over.** Every match a fresh Gambit -- the library loaded anew, the last match's quit
   (030c5f11); the live deploy (Ranmaru_TEST_CPU) is on it.
5. **No early deaths in a live fight.** Every line unjudged at the first garbage, the planner having taken the decision's time: the
   planner takes half when garbage is on the board or the loss is near, on main (8354a299).
6. **Look further ahead, in general.** The next break in reach after the next landing ranked right after survival: not better yet
   (switching 18/24), not shipped.
   - Deaths on main, 6-minute fights: of 183 boards a lost game found no break on, re-searched without a limit, 168 had none to find
     (33 of them one past the input window) and 15 a break the live search missed -- 11 for want of work, not its order. A turn a
     break was last there is most often a hold. Not better: the window's reserve 30 actions; below the reserve the line that spends the
     least (both cost survival).
   - Where the losses are, main's runs 2011-2035: combo_storm 14 of 25, large_garbage 6, factory 5. combo_storm's stream of small
     slabs keeps the board from settling: a manual raise is never open under garbage there (search/ready.c raiseOpenIn: 0 raises in
     76,866 decisions under garbage), waits for a settle do not end, and a break timed to a landing is planned again each decision.
     Next: combo_storm played as a board that never settles.
7. **The weakest mode first.** On main 9cee5ff5: big chain 24/24 (run 2061), switching 24 (2057), finish 22 (2063), pressure 21
   (2064), build 19-23 over four runs (2058, 2062, 2065, 2066: 20.5 on average) -- the same code swings about 4 games in 24, so a
   change is judged over two runs or more. Build's losses are mostly large_garbage: re-searched without a limit, every board before a
   loss had no break to find (107 of 107, run 2066); the panels left, the readiness asked and found (about 8%) and the clears breaking
   nothing do not tell a lost game from a survived one. Next: play that keeps a break in reach before the slab lands.
   Earlier:  Switching (21/24 on 8354a299; finish them 22, pressure 23), then the others; every mode 24/24 twice in a row
   (`ai/eval/plans/gambit-goal.md`).
8. **Efficiency.** The fewest cursor moves to the goal: the break search's beam ranks by actions to a break, on main.
   - **No long trips for nothing** (the owner: at the top about to break garbage, it walks to the very bottom, makes one swap and walks
     all the way back -- wasted input). Open.
9. **No wasted threes against garbage not ready to break.** A block still falling, landing or shaking is not broken by a clear beside
   it; the three pressed against it then breaks nothing. The wasted-three test counted any three touching garbage as a break: in test
   as a three that breaks no garbage (idea59).
10. **Play slow and steady** -- walk to the next swap early and unhurried rather than in bursts, within the time the line has; only
   where it does not change what is played. Open.
11. **Bigger combos, finish them above all.** A combo of 4 is close to useless; 5 is good; 8 and up are what matter -- what a combo
   sends grows faster than the panels it spends, so a couple more moves for an 8 over a 6 (or a 5 over a 4) is far less wasteful.
   The cost-per-gain arithmetic still rules a low stack. Finish them should go for the biggest combos only: it is allowed an 8 and
   up and plays 6s. The table and the causes: `ai/eval/plans/gambit-combos.md`.
   - On main: under garbage the rank and the searches keep the list as written (8 and up, not 5 and up), and of two breaks the
     earlier combo entry is first. Finish them on one seed: 8+ 9 to 40, cells sent by combos 2199 to 3324, survived 19 to 21
     (runs 2083, 2088). Next: a combo grown by a panel or two into an 8.
