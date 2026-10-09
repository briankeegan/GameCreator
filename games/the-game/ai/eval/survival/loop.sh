#!/bin/bash
# THE SURVIVAL LOOP AFTER A CHANGE, in the background: source pushed and the
# scan dispatched (ship.sh), the wasm rebuilt, the scan waited for, fetched,
# its line committed, the deaths analysed. Prints the results; publishing the
# artifact is left to the caller (viz/death-patterns.html is rebuilt here).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); S=${GC_WORK:-/tmp/gc-survival}; mkdir -p "$S"
cd "$(git -C "$HERE" rev-parse --show-toplevel)"
TRAILER=$(cat "$S/trailer.txt" 2>/dev/null || true)
REPO=${GC_REPO:-briankeegan/GameCreator}
$HERE/ship.sh "$1" > $S/loop.ship.$$.txt 2>&1 &
ship=$!
until grep -q "pushed" $S/loop.ship.$$.txt 2>/dev/null; do sleep 2; kill -0 $ship 2>/dev/null || break; done
H=$(grep -o "pushed [0-9a-f]*" $S/loop.ship.$$.txt | cut -d' ' -f2)
[ -n "$H" ] || { cat $S/loop.ship.$$.txt; exit 1; }
echo "pushed $H"
R=""; until [ -n "$R" ]; do sleep 10; R=$(gh api "repos/$REPO/actions/workflows/ai-survival-scan.yml/runs?per_page=10" --jq ".workflow_runs[]|select(.head_sha|startswith(\"$H\"))|.id" | head -1); done
until [ "$(gh api repos/$REPO/actions/runs/$R --jq .status)" = completed ]; do sleep 30; done
D=$S/scan-$H; rm -rf $D
wait $ship || true
# git and survival_scans.tsv are touched by one loop at a time: the rebuild holds this lock while it builds and commits
until mkdir $S/ship.lock 2>/dev/null; do sleep 5; done; trap "rmdir $S/ship.lock" EXIT
GC_ALL=1 timeout 900 games/the-game/ai/eval/scan_deaths.sh $R $D 2>&1 | tail -1
tail -1 $S/loop.ship.$$.txt
# the scan's line, committed alone (the rebuild has finished: nothing else is uncommitted)
if ! git diff --quiet games/the-game/ai/eval/survival_scans.tsv; then
  git add games/the-game/ai/eval/survival_scans.tsv
  git commit -q -m "Survival scans: $H

$TRAILER"
  git pull -q --rebase --autostash origin main && git push -q origin HEAD:main
fi
rmdir $S/ship.lock; trap - EXIT
tail -1 games/the-game/ai/eval/survival_scans.tsv
cd $HERE
python3 scandiff.py $D
SUM=$(python3 summary.py $D); echo "$SUM"
python3 - "$D" "$H" "$1" "$SUM" <<'PY2'
import json, sys, subprocess
d, h, msg, summ = sys.argv[1:5]
sd = subprocess.run(['python3', 'scandiff.py', d], capture_output=True, text=True).stdout.strip().split('\n')
json.dump(['Scan of %s (%s). %s' % (h, msg, sd[0]), sd[1] if len(sd) > 1 else '', summ], open(d + '/findings.json', 'w'))
PY2
python3 flip.py $D | head -2; python3 gates.py $D; python3 landings.py $D | sed -n '1,2p;4,10p'; python3 deathspend.py $D
python3 viz/build.py $D "$(git rev-parse --show-toplevel)/games/the-game/ai/eval/survival_scans.tsv" viz/template.html $S/death-patterns.html
echo "DIR $D"
