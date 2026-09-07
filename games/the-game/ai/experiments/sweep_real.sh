#!/usr/bin/env bash
# Sweeps a SearchCpu config against every challenge-8-*.json real attack
# file (2 seeds each), reporting BOTH axes check_preset_ordering.js
# already uses: total seconds survived AND total garbage sent -- a config
# that only wins on one axis isn't actually better, it's just a different
# trade (see check_preset_ordering.js's own header for why both matter).
#
# Usage: ./sweep_real.sh '<cfgJSON or difficulty name>' [stackLevel]
set -euo pipefail
cd "$(dirname "$0")"
CFG="$1"
LEVEL="${2:-10}"
TOTAL_SEC=0
TOTAL_SENT=0
for f in /home/user/briankeegan/panel-game/client/assets/default_data/training/challenge-8-*.json; do
  for s in 1 2; do
    out=$(node attack_file_harness.js "$f" "$s" "$CFG" "$LEVEL" 36000)
    sec=$(echo "$out" | python3 -c "import json,sys; print(json.load(sys.stdin)['secondsAlive'])")
    sent=$(echo "$out" | python3 -c "import json,sys; print(json.load(sys.stdin)['garbageCellsSent'])")
    TOTAL_SEC=$(python3 -c "print($TOTAL_SEC + $sec)")
    TOTAL_SENT=$((TOTAL_SENT + sent))
  done
done
echo "avgSeconds: $(python3 -c "print($TOTAL_SEC/24)")   totalSent: $TOTAL_SENT   avgSentPerSec: $(python3 -c "print($TOTAL_SENT/$TOTAL_SEC)")"
