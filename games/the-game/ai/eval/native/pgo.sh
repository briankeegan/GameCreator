#!/bin/sh
# Rebuilds bit.profdata, the branch profile build.sh compiles bit.wasm with:
# records three drills' decisions, replays them on a native build of bit.c
# instrumented for profiling, and merges the counts. Needs clang's profile
# runtime (libclang-rt-18-dev). Run it after a change to the search.
set -e
cd "$(dirname "$0")"
T=pgo.tmp
rm -rf $T; mkdir $T
for d in "factory 2 3000" "bigBlocks 4 3000" "comboStorm 1 3000"; do
  set -- $d
  node pgo_record.js $T/$1$2.bin $1 $2 $3 > /dev/null
done
printf '#include <stdint.h>\n#include <string.h>\nstatic unsigned char __heap_base[1ul << 31] __attribute__((aligned(16)));\n#define __builtin_wasm_memory_size(x) (1ul << 40)\n#define __builtin_wasm_memory_grow(a, b) 0\n' > $T/libc.h
sed 's/^extern unsigned char __heap_base;//; s/(unsigned long)&__heap_base/(unsigned long)__heap_base/' bit.c > $T/bit.c
cat pgo_main.c >> $T/bit.c
cp bot.c $T/
(cd $T && clang -O3 -fprofile-instr-generate -w -o train bit.c -lm && LLVM_PROFILE_FILE=train.profraw ./train *.bin && llvm-profdata merge -o ../bit.profdata train.profraw)
rm -rf $T
