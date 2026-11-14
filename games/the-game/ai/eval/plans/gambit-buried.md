# The buried board: where a flood game is lost

The goal (`gambit-goal.md`) is 28/28 in every mode. What is left is floods: combo storm, factory, large garbage. On every count
kept, their wins and losses play alike (`gambit-goal.md`, "WHAT THE LOSSES ARE"): time under garbage, holds, breaks, material,
inputs by kind, garbage cleared a minute (about 330 at about 350 inputs, both). The dig keeps pace with the flood; a loss is a
stretch the flood gets ahead in. The same game won and lost parts at its second decision: the searches are timed.

Searched again with more time, 58 of 60 boards after a loss's turn had no break to find (run 374). The board is lost at the turn,
by the line played there -- not by the decisions after it, which is where every rank change since has worked.

## The turn, found and asked

1. **Find the turn.** For each lost flood game: the last decision after which some line still lived, or a break was offered
   at the next landing. Read off the log (`v=`, `opts`, `land=`), no engine. Gate: the tool emits one row per lost game with
   the turn's frame, and the count of rows equals the count of lost games handed to it.
2. **Ask the turn again, without the clock.** The board at the turn, from the replay (the C engine's own recording of the
   game), searched with every line judged to the end and the break search unbounded: which moves keep a line living, or a
   break at the next landing. Gate: on a won game's board the move played is among the ones it returns.
3. **Read the gap.** Where a living move existed at the turn: what the order put above it, by key (`describe.py --sha`).
   Where none did: step 1 again, one turn earlier, until the decision that had one.
4. **One change, from what step 3 shows**, measured on finish them and fill, then switching; merged only above main over
   three or more runs alternated (`gambit-goal.md`, "The rules set for it").

What is not tried again (measured, `gambit-goal.md`): the later loss always first; lost alike from five breaks' time; the
most garbage for the inputs before FOCUS; the break search's share past fill's 90%.
