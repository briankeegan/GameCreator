#!/bin/sh
# Builds gambit.wasm from gambit.c (the server's engine in ../eval/native, the infra in core/, Gambit's pieces) and records every hash
# in BUILT. Needs clang with the wasm32 target (clang 18 here; no libc: the engine's libc.h has what is used). The only imports allowed are the
# memory and abort_poll (the host's clock).
set -e
cd "$(dirname "$0")"
FLAGS="--target=wasm32 -O3 -matomics -mbulk-memory -nostdlib -Wall -Wno-unused-function -Wl,--no-entry -Wl,--allow-undefined"
clang $FLAGS gambit.c -o gambit.wasm
node -e '
var fs = require("fs"), bad = [];
for (var i of WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync("gambit.wasm"))))
  if (i.name !== "memory" && i.name !== "abort_poll") bad.push("gambit.wasm imports " + i.module + "." + i.name);
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }'
h() { sha256sum "$1" | cut -c1-64; }
{ for f in ../eval/native/pa.c ../eval/native/pa.h ../eval/native/libc.h ../eval/native/memory.h ../eval/native/search.h core/*.h *.c search/*.c gambit.wasm; do printf '%s %s\n' "$f" "$(h $f)"; done; } > BUILT
cat BUILT
