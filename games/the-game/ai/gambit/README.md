# Gambit, in C

Built by `build.sh` (clang, wasm32) into `gambit.wasm`; `BUILT` holds every source's hash and `gate_gambit_engine` fails when they
differ. Its only imports are the host's abort flag and clock (`abort_poll`, `clock_ms`).

- The engine is the one C engine, `../eval/native/pa.c` with its node store `search.h`. The engine tests run on `gambit.wasm` too
  (`GC_NATIVE_WASM`).
- `gambit.c` -- the one translation unit, in dependency order.
- `core/` -- `clock.h` (one deadline a decision, shared out), `nodes.h` (the one way a line is played: `step`), `sort.h` (stable sorts).
- `rules.c` -- the mode's list: fits, meets, entries, the swap back.
- `judge.c` -- a line played as the game presses it; `outcome.c` -- the whole line judged once a decision, cached.
- `facts.c` -- the facts read off both boards, the rule they pick, the floor, how near a line comes, the tiers.
- `search/` -- `break.c` (the break search), `plan.c`, `extend.c`, `ready.c`, `level.c`, `outlive.c` (the survival search), `fill.c` (the panel a match is one short of, and the walk that brings it: grown threes, the converted row's chain).
- `propose.c` -- every kind of move, one proposer each; `rank.c` -- each candidate judged, filtered and put in the one order.
- `decide.c` -- read, propose, judge, rank, play; `answer.c` -- a question from the frame loop answered, and the log line.
- `gambit.js` -- the wasm's loader: reads the rules file, writes the board in, reads the answer out (`Gambit.answer`, `Gambit.breakOn`).
- In the game's own process (`build.sh native`: `libgambit.so`): `front.c` (the frame loop: the board predicted and checked every frame,
  questions asked ahead, answers turned into keys, the input budget kept), `native.c` (Gambit's thread and the host's calls), `host.c`
  (the heap, clock, lock, thread and log). `lua/GambitNative.lua` writes the stack into the engine (`lua/board.lua`, as the player sees
  it) and presses what comes back; `words.js` hands it the profile as numbers; `lua/check.lua` checks the hookup headless.

What survives is the test: `gambit-24.yml` plays 24 Training games and reports them (`plans/gambit-goal.md`).
