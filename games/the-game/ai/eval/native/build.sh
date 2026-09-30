#!/bin/sh
# Builds engine.wasm (one thread) and engine-mt.wasm (shared memory, for
# threads) from engine.c, and records the three hashes in BUILT, which
# native.test.js checks: a change to engine.c without a rebuild fails there.
# Needs clang with the wasm32 target (clang 18 here; no libc is used).
set -e
cd "$(dirname "$0")"
FLAGS="--target=wasm32 -O3 -matomics -mbulk-memory -nostdlib -Wall -Wno-unused-function -Wl,--no-entry -Wl,--allow-undefined"
clang $FLAGS engine.c -o engine.wasm
clang $FLAGS -DTHREADS -Wl,--shared-memory -Wl,--import-memory -Wl,--max-memory=4294967296 \
  -Wl,--export=__stack_pointer -Wl,-z,stack-size=1048576 engine.c -o engine-mt.wasm
h() { sha256sum "$1" | cut -c1-64; }
printf 'engine.c %s\nengine.wasm %s\nengine-mt.wasm %s\n' "$(h engine.c)" "$(h engine.wasm)" "$(h engine-mt.wasm)" > BUILT
cat BUILT
