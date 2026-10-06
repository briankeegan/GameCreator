#!/bin/sh
# EVERY DECISION FITS THE SERVER'S FRAME: the bot on the server's Lua training
# (lua/train.lua), with the clock off so nothing is cut, RUNS times; each
# decision's LEAST time over the runs (the machine stalls, the bot's work does
# not), against what the Lua frame leaves it: BUDGETMS (native/bot.c) less
# RUN_RESERVE (lua/train.lua). Fails if any decision is over.
#
#   ./lua_budget_check.sh [MODE] [SEED] [FRAMES] [RUNS]     (GC_PANEL_GAME: the panel-game checkout)
set -e
here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-combo_storm}; seed=${2:-9}; frames=${3:-4000}; runs=${4:-3}
ms=$(sed -n 's/^#define BUDGETMS \([0-9.]*\).*/\1/p' "$here/native/bot.c")
reserve=$(sed -n 's/^local FRAME_MS, RUN_RESERVE = 1000 \/ 60, \([0-9.]*\).*/\1/p' "$here/lua/train.lua")
[ -n "$ms" ] && [ -n "$reserve" ] || { echo "lua_budget_check: no BUDGETMS or RUN_RESERVE" >&2; exit 1; }
budget=$(echo "$ms - $reserve" | bc)
budget=${GC_CHECK_MS:-$budget}   # GC_CHECK_MS: a lower line, to see the check fail
tmp=$(mktemp -d "$here/.budget.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
for i in $(seq 1 "$runs"); do
  GC_BUDGET_MS=0 GC_FRAME_MS=0 GC_WORKSTAT=1 "$here/train.sh" "$mode" "$seed" "$frames" 2>&1 >/dev/null | grep '^STAGES' > "$tmp/run.$i" || true
done
python3 - "$tmp" "$runs" "$budget" "$mode" "$seed" <<'PY'
import sys
d, runs, budget, mode, seed = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), sys.argv[4], sys.argv[5]
def load(f):
    return [[float(x.split('/')[1]) for x in l.split() if x.count('/') == 3] for l in open(f)]
R = [load('%s/run.%d' % (d, i + 1)) for i in range(runs)]
n = min(len(r) for r in R)
if n == 0: sys.exit('lua_budget_check: no decisions measured')
if any(len(r) != n for r in R): sys.exit('lua_budget_check: the runs made different numbers of decisions %s' % [len(r) for r in R])
tot = [min(sum(R[i][k]) for i in range(runs)) for k in range(n)]
worst = max(range(n), key=lambda k: tot[k])
over = sum(t > budget for t in tot)
print('lua_budget_check: %s seed %s, %d decisions, worst %.1f ms (decision %d) of %.1f; over: %d'
      % (mode, seed, n, tot[worst], worst + 1, budget, over))
sys.exit(1 if over else 0)
PY
