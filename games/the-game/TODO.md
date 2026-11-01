# Newsey — running to-do list

## Gambit (the bot) — the owner's asks, top first

Each line: the ask, then where it stands. A fix ships to main only when it holds survival over two runs; one that costs survival is
narrowed, not dropped.

1. **No 2x chains it does not continue.** A 2x is taken to three, or not made, unless doing otherwise kills the board.
   - On main: a 2x going is taken to three before the later loss; the extension offers the three that breaks the most; a line making a
     2x not taken to three is taken out unless every other is lost within a break's time, a plain break offered beside it; none of it
     on the window the next break is pressed from. 2x share 42% to 24% (runs 2001-2002, 3-minute switching games).
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
4. **Every round a new game, nothing carried over.** On main (19ce2cb5, d34a4867, 2d87febb); the live deploy (Ranmaru_TEST_CPU) is
   the owner's to redeploy.
5. **No early deaths in a live fight.** Every line unjudged at the first garbage, the planner having taken the decision's time: the
   planner takes half when garbage is on the board or the loss is near, on main (8354a299).
6. **Look further ahead, in general.** The next break in reach after the next landing ranked right after survival: not better yet
   (switching 18/24), not shipped.
7. **The weakest mode first.** Switching (21/24 on 8354a299; finish them 22, pressure 23), then the others; every mode 24/24 twice in a row
   (`ai/eval/plans/gambit-goal.md`).
8. **Efficiency.** The fewest cursor moves to the goal: the break search's beam ranks by actions to a break, on main.
