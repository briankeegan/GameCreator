#!/usr/bin/env bash
# THE UPSTREAM 28, WRITTEN UP AS gambit-24.yml's ARE: each game's artifact (rounds.txt and its decision log, run28.sh) laid out as
# gambit_summary.js reads a gambit-24 game (DIR/<game>/results.txt and survivor.log), then summed by it -- survived per mode, combos and
# chains, garbage broken per panel, the truth. Reads logs only; plays nothing.
#
#   bash summary.sh ARTIFACTS_DIR OUT_DIR     ARTIFACTS_DIR holds one directory per game (upstream-<pattern>-<n>/ or <pattern>-<n>/)
set -eu
IN=$1 OUT=$2 EVAL=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$OUT"
n=0
for d in "$IN"/*/; do
  r="$d/rounds.txt"; [ -f "$r" ] || continue
  read -r _ p k res frames _ < "$r"
  g="$p-$k"; mkdir -p "$OUT/$g"
  if [ -f "$d/$g.log" ]; then cp "$d/$g.log" "$OUT/$g/survivor.log"; elif [ -f "$d/survivor.log" ]; then cp "$d/survivor.log" "$OUT/$g/survivor.log"; fi
  [ "$res" = survived ] || res=lost
  echo "game $k $p training $res $frames thinkOver=0 thinkWorstMs=0 inputDropped=0 botFrames=${frames#frames=}" > "$OUT/$g/results.txt"
  n=$((n + 1))
done
echo "summary.sh: $n games laid out" >&2
node "$EVAL/gambit_summary.js" "$OUT"
