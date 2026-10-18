#!/bin/sh
# Builds pa.wasm (one thread) and pa-mt.wasm (shared memory, for threads)
# from pa.c, the server's rules (pa-engine.js), and records every hash in BUILT.
# Needs clang with the wasm32 target (clang 18 here; no libc: libc.h has what is used).
set -e
cd "$(dirname "$0")"
FLAGS="--target=wasm32 -O3 -matomics -mbulk-memory -nostdlib -Wall -Wno-unused-function -Wl,--no-entry -Wl,--allow-undefined"
MT="-DTHREADS -Wl,--shared-memory -Wl,--import-memory -Wl,--max-memory=4294967296 -Wl,--export=__stack_pointer -Wl,-z,stack-size=1048576"
for e in pa; do
  clang $FLAGS $e.c -o $e.wasm
  clang $FLAGS $MT $e.c -o $e-mt.wasm
done
# --allow-undefined links a missing function as an import no loader provides, so
# the module would fail only when instantiated: the only imports allowed are the
# memory and abort_poll.
node -e '
var fs = require("fs"), bad = [];
for (var f of ["pa.wasm", "pa-mt.wasm"])
  for (var i of WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(f))))
    if (i.name !== "memory" && i.name !== "abort_poll") bad.push(f + " imports " + i.module + "." + i.name);
if (bad.length) { console.error(bad.join("\n") + "\nno loader provides these: define them (libc.h)"); process.exit(1); }'
h() { sha256sum "$1" | cut -c1-64; }
for f in pa.c pa.h libc.h memory.h search.h pa.wasm pa-mt.wasm; do printf '%s %s\n' "$f" "$(h $f)"; done > BUILT
cat BUILT
