#!/bin/sh
# Builds gambit.wasm from gambit.c (the server's engine in ../eval/native, the infra in core/, Gambit's pieces) and records every hash
# in BUILT. Needs clang with the wasm32 target (clang 18 here; no libc: the engine's libc.h has what is used). The only imports allowed are the
# memory, abort_poll (the host's abort) and clock_ms (the host's time).
set -e
cd "$(dirname "$0")"
# ./build.sh native: libgambit.so, Gambit in the game's own process (native.c, host.c; lua/GambitNative.lua loads it). Built for this
# machine, or for GC_MARCH's (gambit-24.yml builds it once, for every runner); not tracked.
if [ "${1:-}" = native ]; then
  clang -O3 -g -march=${GC_MARCH:-native} -pthread -fPIC -shared -Wl,-z,nodelete -DPA_HEAP -Wall -Wno-unused-function -Wno-unknown-attributes \
    -Wno-ignored-attributes native.c host.c -lm -ldl -o libgambit.so
  exit
fi
# ./build.sh test [golden|speed]: the C checks, natively (test/main.c: the board as bits, perched blocks, the decisions replayed against the
# golden; "golden" writes it from this build; "speed" answers questions on the wall clock and prints the engine work a decision does).
# ./build.sh tsan: the C checks built with ThreadSanitizer (gcc's runtime) and run on GC_GAMBIT_WORKERS (default 4) workers -- every
# search a worker runs beside Gambit's thread is raced against it; any data race fails (exit 66)
if [ "${1:-}" = tsan ]; then
  gcc -O1 -g -fsanitize=thread -pthread -DPA_HEAP -DGB_TEST -w native.c host.c test/main.c -lm -lz -o /tmp/gambit-tsan &&
    GC_GAMBIT_WORKERS=${GC_GAMBIT_WORKERS:-4} TSAN_OPTIONS="halt_on_error=1 exitcode=66 report_signal_unsafe=0 history_size=2" /tmp/gambit-tsan test
  exit
fi
if [ "${1:-}" = test ]; then
  clang -O2 -pthread -DPA_HEAP -DGB_TEST -Wall -Wno-unused-function -Wno-unknown-attributes -Wno-ignored-attributes \
    native.c host.c test/main.c -lm -lz -o /tmp/gambit-test && GC_GAMBIT_WORKERS=${GC_GAMBIT_WORKERS:-0} /tmp/gambit-test test "${2:-}"
  exit
fi
# ./build.sh material DIR...: core/material.h, the life a board has by its panels, measured on the games in DIR... (material.c, on the
# system's libc). Not part of the bot; run when the bot changes enough to move it.
if [ "${1:-}" = material ]; then
  shift
  clang -O2 -Wall material.c -o /tmp/gambit-material && /tmp/gambit-material core/material.h "$@"
  exit
fi
FLAGS="--target=wasm32 -O3 -matomics -mbulk-memory -nostdlib -Wall -Wno-unused-function -Wl,--no-entry -Wl,--allow-undefined"
clang $FLAGS gambit.c -o gambit.wasm
node -e '
var fs = require("fs"), bad = [];
for (var i of WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync("gambit.wasm"))))
  if (i.name !== "memory" && i.name !== "abort_poll" && i.name !== "clock_ms") bad.push("gambit.wasm imports " + i.module + "." + i.name);
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }'
h() { sha256sum "$1" | cut -c1-64; }
{ for f in ../eval/native/pa.c ../eval/native/pa.h ../eval/native/libc.h ../eval/native/memory.h ../eval/native/search.h core/*.h *.c search/*.c gambit.wasm; do printf '%s %s\n' "$f" "$(h $f)"; done; } > BUILT
cat BUILT
