#!/bin/sh
# EVERY DECISION INSIDE THE FRAME. The bot plays the real game at 60 frames a
# second, so a decision may take BUDGETMS (native/bot.c): the 16.7 ms frame
# less the frame's own work. The budget is counted in work (WORKBUDGET); this
# measures that the work fits the time before a change ships.
#
#   ./budget_check.sh [SEED] [FRAMES] [RUNS]   (4 11538 3 by default)
#
# The seed is played RUNS times under the game's work budget, and each decision's least
# time is kept: the bot's work is the same every run, the machine's stalls
# are not (a 1 ms decision has taken 31 ms once on a cloud runner). Fails if
# any decision's least time is over the budget, naming it and its stages.
set -e
here=$(cd "$(dirname "$0")" && pwd)
seed=${1:-4}; frames=${2:-11538}; runs=${3:-3}
budget=$(sed -n 's/^#define BUDGETMS \([0-9.]*\).*/\1/p' "$here/native/bot.c")
budget=${GC_CHECK_MS:-$budget}   # GC_CHECK_MS: a lower line, to see the check fail
[ -n "$budget" ] || { echo "budget_check: no BUDGETMS in native/bot.c" >&2; exit 1; }
tmp=$(mktemp -d "$here/.budget.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
for i in $(seq 1 "$runs"); do
  GC_WORKSTAT=1 "$here/drill.sh" "$seed" "$frames" 2>&1 | grep '^STAGES' > "$tmp/run.$i"
done
python3 - "$tmp" "$runs" "$budget" <<'PY'
import sys
d, runs, budget = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
names = 'decideRuled play breakFirst stayAlive lineup batch breakSoon fill after'.split()
def load(f):
    rows = []
    for l in open(f):
        p = l.split()[1:]
        if p and p[0] == 'OUT': p = p[1:]
        rows.append([float(x.split('/')[1]) for x in p if x.count('/') == 3])
    return rows
R = [load('%s/run.%d' % (d, i + 1)) for i in range(runs)]
n = min(len(r) for r in R)
if n == 0: sys.exit('budget_check: no decisions measured')
rows = [min((R[i][k] for i in range(runs)), key=sum) for k in range(n)]
tot = [sum(r) for r in rows]
worst = max(range(n), key=lambda k: tot[k])
print('budget_check: %d decisions, worst %.1f ms (decision %d) of %.1f; over 8 ms: %d'
      % (n, tot[worst], worst, budget, sum(t > 8 for t in tot)))
over = [k for k in range(n) if tot[k] > budget]
for k in over:
    print('  decision %d %.1f ms: %s' % (k, tot[k], ' '.join('%s %.1f' % (nm, rows[k][i]) for i, nm in enumerate(names) if rows[k][i] > 0.3)))
sys.exit(1 if over else 0)
PY
