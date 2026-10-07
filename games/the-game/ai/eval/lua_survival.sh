#!/bin/bash
# HOW LONG THE BOT LIVES ON THE SERVER'S LUA, AND THAT IT STAYED IN BUDGET:
# seeds 1..SEEDS of MODE to FRAMES (lua/train.lua), under the game's work budget so this
# machine's stalls cannot end a game, four at a time; then every decision's
# time is held to its budget by budget_check.sh (native) and
# lua_budget_check.sh (the server's frame). Exits 1 if either is over.
#
#   ./lua_survival.sh [MODE] [SEEDS] [FRAMES] [OUT]     (GC_PANEL_GAME: the panel-game checkout)
#
# Prints "seed frame" per seed (died at, or FRAMES if alive), then the sum,
# the median and how many passed 5k and 10k.
here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-combo_storm}; seeds=${2:-24}; frames=${3:-120000}
out=${4:-$(mktemp -d "$here/.survival.XXXXXX")}
mkdir -p "$out"
seq 1 "$seeds" | xargs -P4 -I{} sh -c "'$here/train.sh' $mode {} $frames > '$out/{}.log' 2>&1; echo {} \$(grep -E '^(died|alive)' '$out/{}.log' | awk '{print \$2}')" | sort -n > "$out/summary"
cat "$out/summary" | tr '\n' ' '; echo
sort -k2 -n "$out/summary" | awk '{a[NR]=$2; s+=$2; if ($2>5000) p5++; if ($2>10000) p10++} END {printf "survival: seeds %d sum %d median %d past5k %d past10k %d\n", NR, s, a[int((NR+1)/2)], p5, p10}'
rc=0
"$here/budget_check.sh" || rc=1
"$here/lua_budget_check.sh" "$mode" 9 4000 3 || rc=1
[ $rc -eq 0 ] && echo "budget: every decision within it" || echo "budget: OVER -- a decision does not fit its frame"
exit $rc
