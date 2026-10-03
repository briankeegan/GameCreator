#!/bin/sh
# Builds engine.wasm (one thread) and engine-mt.wasm (shared memory, for
# threads) from engine.c, and pa.wasm / pa-mt.wasm from pa.c, and records
# every hash in BUILT, which
# native.test.js checks: a change to engine.c without a rebuild fails there.
# Needs clang with the wasm32 target (clang 18 here; no libc: libc.h has what is used).
set -e
cd "$(dirname "$0")"
FLAGS="--target=wasm32 -O3 -matomics -mbulk-memory -nostdlib -Wall -Wno-unused-function -Wl,--no-entry -Wl,--allow-undefined"
MT="-DTHREADS -Wl,--shared-memory -Wl,--import-memory -Wl,--max-memory=4294967296 -Wl,--export=__stack_pointer -Wl,-z,stack-size=1048576"
# engine.c: this game's rules (panel-engine.js); pa.c: the server's (pa-engine.js)
for e in engine pa; do
  clang $FLAGS $e.c -o $e.wasm
  clang $FLAGS $MT $e.c -o $e-mt.wasm
done
# bit.profdata: the branch profile pgo.sh records; the code it lays out is the same code.
PGO="-fprofile-instr-use=bit.profdata -Wno-profile-instr-out-of-date -Wno-profile-instr-unprofiled"
clang $FLAGS $PGO -msimd128 -DPA_LIB bit.c pa.c -o bit.wasm
clang $FLAGS $MT $PGO -msimd128 -DPA_LIB -Wl,--initial-memory=1073741824 bit.c pa.c -o bit-mt.wasm
# drill: the bot on the server's engine, natively (drill.c; ../drill.sh runs it). Not tracked.
clang -O2 -DPA_LIB -Wall -Wno-unused-function -Wno-unknown-attributes -Wno-ignored-attributes bit.c pa.c drill.c -lm -o drill
h() { sha256sum "$1" | cut -c1-64; }
for f in engine.c pa.c pa.h bit.c bot.c front.c bit.profdata libc.h memory.h search.h engine.wasm engine-mt.wasm pa.wasm pa-mt.wasm bit.wasm bit-mt.wasm; do printf '%s %s\n' "$f" "$(h $f)"; done > BUILT
cat BUILT
