#!/bin/bash
# ONE SCAN, from its dispatch to its result, as the loop in CLAUDE.md runs it: the scan is dispatched (ai-survival-scan.yml), its run is found
# among THIS workflow's runs, waited for, fetched (scan_deaths.sh, every fetch retried) with every seed's whole game, and its numbers printed.
#
#   [GC_MODE=large_garbage] [GC_SOURCE=REF] [GC_FIXED=1] [GC_INPUT_LIMIT=N] [GC_SEEDS='[1,2,3]'] [GC_WORK=DIR] scan.sh
#
# GC_SOURCE is a commit, tag or branch of this repository to scan instead of main (the scan of a change beside its predecessor: the workflow
# is handed the full SHA it names, which checkout needs). GC_FIXED=1 is the scan that tells the bot no time, so a build plays the same games
# every time. The run's games are in $GC_WORK/run-<id> (default /tmp/gc-survival); the last line printed is that directory.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); cd "$(git -C "$HERE" rev-parse --show-toplevel)"
S=${GC_WORK:-/tmp/gc-survival}; mkdir -p "$S"
REPO=${GC_REPO:-briankeegan/GameCreator}; WF=ai-survival-scan.yml
mode=${GC_MODE:-combo_storm}
retry() { local n; for n in 1 2 3 4 5 6; do "$@" && return 0; sleep $((n * 5)); done; return 1; }
args=(-f ref=main -f "inputs[mode]=$mode")
if [ -n "${GC_SOURCE:-}" ]; then
  git fetch -q origin main 2>/dev/null || true
  full=$(git rev-parse --verify "$GC_SOURCE^{commit}") || { echo "scan: $GC_SOURCE is no commit of this repository" >&2; exit 1; }
  args+=(-f "inputs[source]=$full")
fi
[ -n "${GC_FIXED:-}" ] && args+=(-f inputs[fixed_budget]=true)
[ -n "${GC_INPUT_LIMIT:-}" ] && args+=(-f "inputs[input_limit]=$GC_INPUT_LIMIT")
[ -n "${GC_SEEDS:-}" ] && args+=(-f "inputs[seeds]=$GC_SEEDS")
t0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
retry gh api -X POST "repos/$REPO/actions/workflows/$WF/dispatches" "${args[@]}" --silent
# the run of THIS workflow created since the dispatch (the newest run of any workflow may be another's)
run=""
for n in $(seq 1 60); do
  run=$(gh api "repos/$REPO/actions/workflows/$WF/runs?event=workflow_dispatch&per_page=10" --jq "[.workflow_runs[] | select(.created_at >= \"$t0\")] | sort_by(.created_at) | last | .id // empty" 2>/dev/null || true)
  [ -n "$run" ] && break; sleep 5
done
[ -n "$run" ] || { echo "scan: no run of $WF appeared after the dispatch" >&2; exit 1; }
echo "scan: run $run, mode $mode${GC_SOURCE:+, source $full}"
until [ "$(gh api "repos/$REPO/actions/runs/$run" --jq .status 2>/dev/null || true)" = completed ]; do sleep 20; done
dir=$S/run-$run; rm -rf "$dir"
GC_MODE=$mode GC_ALL=1 "$HERE/../scan_deaths.sh" "$run" "$dir" 2>&1 | grep -E "^(alive|OVER|think budget|BUDGET|budget)|within 8 ms" | cut -c1-220 || true
[ -s "$dir/results.tsv" ] || { echo "scan: run $run could not be fetched" >&2; exit 1; }
sort -k3 -n "$dir/results.tsv" | awk '{ f = ($2 == "alive") ? ($3 + 0) : ($3 + 0); printf "%s:%s ", $1, f; s += f } END { printf "\nmean %.0f\n", s / NR }'
echo "$dir"
