# Gambit's decision

A mode is its list: the entries it asks for, in order, each with a deadline. Every mode decides the same way; only the list differs.

Every move is the next step of the ask, and the ask runs the whole time: while it is built, garbage is broken (that is where the
panels come from) and the board is set up. What kind of break and what kind of set-up is the attack's: the one that leaves the board
nearest the list.

## One decision, five steps

Every move goes through these once, in order. Nothing changes the answer after step 4: a question about a move is a filter or a rank
in step 4, or the judge answers it in step 3.

1. **Read the board.** The facts, from the engine (`GAMBIT.facts`): garbage on the board, landed or still falling, the material under
   it, when each queued block lands, the frames until the board is lost with the queued garbage landed. The mode and its list. The
   line in progress of every mode.
2. **Propose.** Every search offers lines and decides nothing: the planner (a line for each entry of the list, in time), the break
   search, setup, level, readiness, the survival search's own moves, the hold, and each mode's line in progress.
3. **Judge.** One function for every line (`judge`): the line played on the engine, each step at the frame it is pressed -- the walk
   to it, the wait for the board -- as the game will play it. What it gives back:
   - what it makes: the largest match, the longest chain, the garbage it breaks -- every step's clears, the chain broken garbage sets
     off, a link added to a chain already falling;
   - whether the board lives (the survival search's verdict), and when the line is done;
   - whether the next block can still be broken when it lands (entries and set-ups; never a break).
4. **Filter and rank.** One comparator (`GAMBIT.rank`):
   - A line that fits the list and lives is a candidate. Fitting: it clears nothing, or what it makes matches an entry (an entry that
     names a combo and no chain is one clear), or it is a plain three that breaks garbage. No line makes a chain longer than 13
     (`GAMBIT.MAXCHAIN`), whoever proposed it.
   - Candidates are ranked by the board's column of the table below, then by the first entry of the list each matches, then by time.
   - With no candidate, a line that lives but fits no entry is next -- survival, ranked after every line that fits.
   - With nothing that lives, the line that dies latest.
5. **Play.** The first swap of the top line is pressed; the rest is kept as the mode's line in progress. At the next decision it is a
   line like any other in step 2, judged again: carried on while it ranks first, dropped when something ranks above it. A mode left
   keeps its line; coming back, it is judged again with the rest.

## By the board

| | No garbage | Garbage still falling | Garbage landed |
|---|---|---|---|
| 1 | Fire an entry, in the list's order | Fire an entry | Break it: an entry that breaks, then the break nearest the attack (a three is as good), then more broken |
| 2 | Set up the ask, flattening included | Set up the ask, ready to break it when it lands | Fire an entry that breaks nothing |
| 3 | Raise to 10 when low | Break it -- not yet: broken before the rest has landed, the next block buries the panels it made | Set up the ask |
| 4 | Hold, only with no move | Hold, only with no move | Hold, only with no move |
| 5 | | | Clear (a match that touches no garbage), only for a stack about to top out with nothing else |

A break is a match that touches garbage: its bottom row turns into panels. Garbage can always be broken with a three.

Garbage still falling: the board topped out, with a block still in the air or one queued to land. A raise is never made on a board
topped out.

## Every number from the engine or the budget

A time is the engine's (rise, pop, landing, settle). A search's size is the share of the decision's budget it is given, never a
count of swaps or lines.

## Where the code is

| Step | Code |
|---|---|
| 1 Read | `GAMBIT.facts` (gambit.js) |
| 2 Propose | the searches in survivor_attack.js and survivor_shared.js; candG in survivor_think.js collects them |
| 3 Judge | `attacker.replay` (`whole`) and `attacker.lineFits` (survivor_attack.js): each step played to the board's settle -- not yet at its press frame |
| 4 Filter and rank | `GAMBIT.fits`, `GAMBIT.entryOf`, `GAMBIT.tier` (gambit.js), held by gambit.test.js |
| 5 Play | survivor_think.js; one line in progress (`bot._gambitCarry`), not one per mode |

Still outside the five steps, to be folded into step 4: the plain-three guard (guard3), the topped guard (guardTopped), ping-pong,
the break played whatever is found (`_gambitBreak`), the arbiter's preferences, the survival search's override (`wanted`), and the
list gate at the end of a decision.
