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

## Every swap pressed, last

What a line makes is the whole line played on the engine: every step's clears, the chain broken garbage sets off, a link added to a
chain already falling. Whoever chose it, a swap is pressed only while that fits an entry of the list (a combo entry is one clear; a
three that breaks garbage always fits). The line is cut before the first step that does not; a first swap that does not is replaced by
the best ranked move that does. When holding dies, a move the survival search found lives that fits is played (a three that breaks
the garbage always fits); the one exception is none fitting: then the survival search's pick. No chain is ever longer than 13, the
exception included (`GAMBIT.MAXCHAIN`).
The code: `attacker.lineFits` (survivor_attack.js) and the list gate at the end of a decision (survivor_think.js), `GAMBIT.fits`.

## In the middle of something, first

A chain still falling is run on, a slab popping is lined up, a line begun is carried on -- one that breaks too ahead.

## Then, by the board

| | No garbage | Garbage still falling | Garbage landed |
|---|---|---|---|
| 1 | Fire an entry, in the list's order | Fire an entry | Break it: an entry that breaks, then the break nearest the attack (a three is as good), then more broken |
| 2 | Set up the ask, flattening included | Set up the ask, ready to break it when it lands | Fire an entry that breaks nothing |
| 3 | Raise to 10 when low | Break it -- not yet: broken before the rest has landed, the next block buries the panels it made | Set up the ask |
| 4 | Hold, only with no move | Hold, only with no move | Hold, only with no move |
| 5 | | | Clear (a match that touches no garbage), only for a stack about to top out with nothing else |

A break is a match that touches garbage: its bottom row turns into panels. Garbage can always be broken with a three.

Garbage still falling is `facts().falling`: a block still in the air, or the next landing before a break begun now has popped (the
engine's FLASH + FACE + POP x (3 + the lowest block's cells on screen)).

The code: `GAMBIT.tier` (gambit.js), held by gambit.test.js.
