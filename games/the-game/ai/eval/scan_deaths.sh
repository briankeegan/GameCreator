#!/usr/bin/env bash
# THE DEATHS OF A SURVIVAL SCAN, as files: every seed that died in an
# ai-survival-scan.yml run, its death report (train.lua GC_DEATHLOG: the last
# frames, the bot's log then the board) cut out of its job log into
# DIR/seed<N>.txt -- the same report a local run of that seed prints.
#
#   ./scan_deaths.sh RUN_ID [DIR]   (DIR defaults to ./deaths-RUN_ID)
#
# Prints one line per seed: "seed N: died F" or "seed N: alive F", and the
# count of each. The job log is fetched with curl, which follows GitHub's
# redirect to where logs are kept.
set -euo pipefail
run=${1:?run id}; dir=${2:-deaths-$run}
api=https://api.github.com/repos/briankeegan/GameCreator/actions
auth=(); [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
mkdir -p "$dir"
jobs=$(curl -sSfL "${auth[@]}" "$api/runs/$run/jobs?per_page=100" | python3 -c '
import json, re, sys
for j in json.load(sys.stdin)["jobs"]:
    m = re.search(r"\((\d+)\)", j["name"])
    if m: print(j["id"], m.group(1), j["conclusion"])')
[ -n "$jobs" ] || { echo "scan_deaths: run $run has no seed jobs" >&2; exit 1; }
alive=0; died=0; other=0
while read -r id seed concl; do
  [ "$concl" = success ] || [ "$concl" = failure ] || { echo "seed $seed: $concl"; other=$((other + 1)); continue; }
  log=$(curl -sSfL "${auth[@]}" "$api/jobs/$id/logs" | sed 's/^[0-9TZ:.-]* //')
  end=$(grep -E "^(died|alive) " <<<"$log" | tail -1 || true)
  echo "seed $seed: ${end:-no result}"
  case $end in
    alive*) alive=$((alive + 1)) ;;
    died*) died=$((died + 1)); sed -n '/^DEATH REPORT/,/^END DEATH REPORT/p' <<<"$log" > "$dir/seed$seed.txt" ;;
    *) other=$((other + 1)) ;;
  esac
done <<<"$jobs"
echo "alive $alive, died $died, other $other -- reports in $dir"
