# Newsey — running to-do list

## Gambit (the bot) — the owner's asks, top first

Each line: the ask, then where it stands. A fix ships to main only when it holds survival over two runs; one that costs survival is
narrowed, not dropped.

1. **No 2x chains it does not continue.** A 2x is continued, or not made, unless doing otherwise kills the board.
   - Continuing a 2x the board is about to make on its own: on main. A 2x taken to three over a break that is lost no later: on main.
   - No 2x where the board is safe (both lines live, no garbage on it): on main (8354a299). Barely moves the share in the CI patterns,
     where garbage is on the board 99% of the time; still about 40% of chains end at 2x. Open: the 2x made under garbage.
2. **No flipping back and forth.** A swap and its swap back is two inputs for nothing.
   - The swap refused as a swap back is the last one planned before the decision's frame: on main (5.9% of swaps to 3.2%).
   - The line played judged again without a swap and its swap back inside it: on main (8354a299; 2.8-3.2% of swaps). Open: the rest.
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
