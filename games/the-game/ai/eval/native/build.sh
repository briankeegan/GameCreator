#!/bin/sh
# Builds engine.wasm from engine.c and records both hashes in BUILT, which
# native.test.js checks: a change to engine.c without a rebuild fails there.
# Needs clang with the wasm32 target (clang 18 here; no libc is used).
set -e
cd "$(dirname "$0")"
clang --target=wasm32 -O3 -mbulk-memory -nostdlib -Wall -Wno-unused-function \
  -Wl,--no-entry -Wl,--allow-undefined engine.c -o engine.wasm
printf 'engine.c %s\nengine.wasm %s\n' "$(sha256sum engine.c | cut -c1-64)" "$(sha256sum engine.wasm | cut -c1-64)" > BUILT
cat BUILT
