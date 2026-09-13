#!/bin/bash
# The status tool's one check that can hide: "two searches are splitting the
# cores". It fires about once a year, so without this it would read exactly
# like a machine that never has that problem.
cd "$(dirname "$0")"
fails=0
ok() { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails+1)); }

echo ""
echo "THE STATUS TOOL"

out=$(GC_PS='echo "111 node train.js a
222 node train.js b"' ./status.sh 2>&1)
echo "$out" | grep -q "2 train.js processes" && ok "FIRES when two searches are running" \
                                            || bad "FIRES when two searches are running"

out=$(GC_PS='echo "111 node train.js a"' ./status.sh 2>&1)
echo "$out" | grep -q "splitting the cores" && bad "stays quiet on a single healthy run" \
                                            || ok "stays quiet on a single healthy run"

out=$(GC_PS='true' ./status.sh 2>&1)
echo "$out" | grep -q "nothing training" && ok "says so when nothing is training" \
                                         || bad "says so when nothing is training"

out=$(GC_PS='echo "111 node train.js a"' ./status.sh 2>&1); rc=$?
[ $rc -eq 0 ] && ok "never fails its caller — it reports, it does not gate" \
              || bad "never fails its caller (exit $rc)"

echo ""
[ $fails -eq 0 ] && { echo "  all good"; echo ""; exit 0; }
echo "  $fails FAILED"; echo ""; exit 1
