# Gambit's decision

A mode is its list: the entries it asks for, in order, each with a deadline. Every mode decides the same way; only the list differs.

Every move is the next step of the ask, and the ask runs the whole time: while it is built, garbage is broken (that is where the
panels come from) and the board is set up. What kind of break and what kind of set-up is the attack's: the one that leaves the board
nearest the list.

## Every move, first

| Check | Judge |
|---|---|
| The board lives | the engine (the survival search) |
| Done by its deadline | each step at its own time, the deadline read from the engine |
| The next block can still be broken when it lands | the engine, the move played to the landing (entries and set-up; never a break) |

## Then, by the board

| | No garbage | Garbage still falling | Garbage landed |
|---|---|---|---|
| 1 | Fire an entry, in the list's order | Fire an entry | Break it: an entry that breaks, then the break nearest the attack (a three is as good), then more broken |
| 2 | Set up the ask, flattening included | Set up the ask, ready to break it when it lands | Fire an entry that breaks nothing |
| 3 | Raise to 10 when low | Break it -- not yet: broken before the rest has landed, the next block buries the panels it made | Set up the ask |
| 4 | Hold, only with no move | Hold, only with no move | Hold, only with no move |
| 5 | | | Clear (a match that touches no garbage), only for a stack about to top out with nothing else |

A break is a match that touches garbage: its bottom row turns into panels. Garbage can always be broken with a three.

The code: `GAMBIT.tier` (gambit.js), held by gambit.test.js.
