# Gambit, in C

The plan and the layout: `PLAN.md`. Built by `build.sh` (clang, wasm32) into `gambit.wasm`; `BUILT` holds every source's hash and
`gate_gambit_engine` fails when they differ.

- `engine/` -- the server's engine and node store, copied from `eval/native/` (pa.c, pa.h, libc.h, memory.h, search.h). Checked on
  its own: the engine tests run on `gambit.wasm` (`GC_NATIVE_WASM`).
- `core/` -- the infra every piece uses: `clock.h` (one budget a decision), `nodes.h` (the one way a line is played).
- `gambit.c` -- the one translation unit.
