# Gambit in C

Gambit is its own program, in this folder, written in C: the clock, the rules, the judge, the searches, the decision. It runs on the
one C engine, `eval/native/pa.c` and its node store `search.h` (the server's Lua, ported and checked frame by frame) -- never a copy
of it.

The design is `eval/plans/decision.md` (one decision, five steps) and the goal is `eval/plans/gambit-goal.md`. This file says how the
code is laid out and how it is ported without losing anything.

## The infra, built first

Every play stands on these. A play that needs one of them uses it; none keeps its own.

| Piece | File | What it is |
|---|---|---|
| The engine | `eval/native/pa.c`, `search.h` | The one C engine and its node store: a board at a frame and the steps that make the next. |
| The nodes | `core/nodes.h` | The one way any of Gambit's searches plays a step: a swap pressed as the game presses it (the walk, the wait), a settle, a wait -- charged to the clock. |
| The clock | `core/clock.h` | One budget for the decision, in work: every engine frame and every search step is charged where it is made. Past the budget every step comes back "not there", so every search stops at the same moment and none reads a clock of its own. The host's time reaches it through the one import (`abort_poll`). |
| The rules | `rules.c` | The mode's list (fits, meets, the chain limit), the material floor and the swap-back rule: read once a decision and handed to every search. |
| The judge | `judge.c` | One function for every line: played as it will be pressed, it gives what it makes, when it is done, when garbage can next drop, when the board is lost, whether a break is ready once everything lands, whether it lives. The shared line check is the judge's. Cached per decision. |
| The rank | `rank.c` | One order for every candidate: lives first, then the tier and its sub-keys; of lines that do not live, the later loss. |

## The plays, on top

Each search proposes lines; none decides. Each keeps a line only through the judge's line check, and every step it plays is charged
to the clock.

| Play | File | From |
|---|---|---|
| The break search | `search/break.c` | `breakMoves` (survivor_shared.js): the touch beam, the carried frontier, the lineup during a pop |
| The planner | `search/plan.c` | `attacker.plan` |
| The extender | `search/extend.c` | `attacker.extend` |
| Level, ready, ready lines | `search/level.c`, `search/ready.c` | `attacker.level`, `readyFor`, `readyLines`, `breaksAfterLanding` |
| The survival search | `search/outlive.c` | `attacker.outlive` |
| The proposers | `propose.c` | gambit_propose.js, one function per kind of move |
| The decision | `decide.c` | gambit_decide.js and gambit_answer.js: read, propose, judge, rank, play; what one decision carries to the next |

`gambit.js` is the only JavaScript: it loads `gambit.wasm`, hands it the board and the garbage on its way, and returns the move.

## Ported without losing anything

The JavaScript Gambit is the reference until the C one matches it.

1. **One piece at a time, in the order above**: the infra, then the judge, then each search, then the decision.
2. **Every piece is checked against the JavaScript** on the same boards: real ones from the runs' logs (`GAMBITB`) and made ones,
   with the clock set so both do the same work. Same outcome, same lines, same move. The check is a test in the gate; a piece is done
   when it agrees on every board.
3. **Every rule keeps its test.** The JavaScript tests (`gambit_*.test.js`, `break_near.test.js`) are run against the C Gambit too.
4. **The game switches** only once the decision agrees. One 24-game run measures it against the JavaScript's last run. Then the
   JavaScript Gambit is deleted.

## Code

- One file per piece, each opening with what it does and what constrains it, as the JavaScript does.
- Names from the JavaScript, so a reader can find the same function in both while both exist.
- No fixed numbers: the engine's or the budget's.
- Built by `build.sh` (clang, wasm32), which records every hash in `BUILT`.
