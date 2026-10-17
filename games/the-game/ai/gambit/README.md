# Gambit, in C

The plan and the layout: `PLAN.md`. Built by `build.sh` (clang, wasm32) into `gambit.wasm`; `BUILT` holds every source's hash and
`gate_gambit_engine` fails when they differ.

- The engine is the one C engine, `../eval/native/pa.c` with its node store `search.h` -- not a copy. The engine tests run on
  `gambit.wasm` too (`GC_NATIVE_WASM`).
- `core/` -- the infra every piece of Gambit uses: `clock.h` (one budget a decision), `nodes.h` (the one way a line is played).
- `rules.c` -- the mode's list.
- `gambit.c` -- the one translation unit.
