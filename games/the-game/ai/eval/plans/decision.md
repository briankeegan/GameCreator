# Gambit's decision

A mode is its list: the entries it asks for, in order, each with a deadline. Every mode decides the same way; only the list differs.

Every move is the next step of the ask, and the ask runs the whole time: while it is built, garbage is broken (that is where the
panels come from) and the board is set up.

## Every move, first

| Check | Judge |
|---|---|
| The board lives | the engine (the survival search) |
| Done by its deadline | each step at its own time, the deadline read from the engine |
| The next block can still be broken when it lands | the engine, the move played to the landing (firing and set-up; never a break) |

## Then, in order

| # | Play | Order within |
|---|---|---|
| 1 | **Fire an entry** of the list | the list's order (under garbage the entry breaks too) |
| 2 | **Break garbage**, while building | a combo or chain break before a three, then the break nearest the ask, then more broken |
| 3 | **Set up the ask**, flattening included | nearest the list first |
| 4 | Raise to 10 when low | the raise rule: its own deadline, the next block landing |
| 5 | Hold | only with no move at all |
| 6 | Clear (a match that touches no garbage) | only for a stack about to top out, with nothing else |

A break is a match that touches garbage: its bottom row turns into panels. Garbage can always be broken with a three.

The code: `GAMBIT.tier` (gambit.js), held by gambit.test.js.
