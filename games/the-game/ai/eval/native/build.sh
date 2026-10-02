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
clang $FLAGS -msimd128 bit.c -o bit.wasm
clang $FLAGS $MT -msimd128 -Wl,--initial-memory=1073741824 bit.c -o bit-mt.wasm
h() { sha256sum "$1" | cut -c1-64; }
for f in engine.c pa.c bit.c bot.c libc.h memory.h search.h engine.wasm engine-mt.wasm pa.wasm pa-mt.wasm bit.wasm bit-mt.wasm; do printf '%s %s\n' "$f" "$(h $f)"; done > BUILT
cat BUILT
