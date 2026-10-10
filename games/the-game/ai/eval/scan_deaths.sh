#!/usr/bin/env bash
# THE DEATHS OF A SURVIVAL SCAN, as files: every seed that died in an
# ai-survival-scan.yml run, its death report (train.lua GC_DEATHLOG: the last
# frames, the bot's log then the board) cut out of its job log into
# DIR/seed<N>.txt -- the same report a local run of that seed prints -- and
# its whole game (train.lua GC_GAMELOG, every frame's bot log and board) into
# DIR/seed<N>.log.gz from the seed's artifact. GC_ALL=1 fetches the games of
# the seeds that lived too.
#
#   ./scan_deaths.sh RUN_ID [DIR]   (DIR defaults to ./deaths-RUN_ID)
#
# Prints one line per seed: "seed N: died F" or "seed N: alive F", and the
# count of each, and writes them to DIR/results.tsv (seed, alive|died|...,
# frame); a finished scan is added to survival_scans.tsv (run, commit, alive,
# seeds that died) once. Logs and artifacts are fetched with curl, which follows
# GitHub's redirect to where they are kept.
set -euo pipefail
run=${1:?run id}; dir=${2:-deaths-$run}
api=https://api.github.com/repos/briankeegan/GameCreator/actions
auth=(); [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
mkdir -p "$dir"
jobs=$(curl -sSfL "${auth[@]}" "$api/runs/$run/jobs?per_page=100" | python3 -c '
import json, re, sys
for j in json.load(sys.stdin)["jobs"]:
    m = re.search(r"\((\d+)\)", j["name"])
    if m: print(j["id"], m.group(1), j["conclusion"] or j["status"])')
[ -n "$jobs" ] || { echo "scan_deaths: run $run has no seed jobs" >&2; exit 1; }
arts=$(curl -sSfL "${auth[@]}" "$api/runs/$run/artifacts?per_page=100" | python3 -c '
import json, sys
for a in json.load(sys.stdin)["artifacts"]: print(a["name"], a["id"])')
game() {   # the seed's whole game, from its artifact
  [ -n "${GC_NOGAME:-}" ] && return 0   # a screen reads no game
  local id; id=$(awk -v n="seed-$1" '$1 == n { print $2 }' <<<"$arts")
  [ -n "$id" ] || { echo "  seed $1: no artifact" >&2; return 0; }
  curl -sSfL "${auth[@]}" "$api/artifacts/$id/zip" -o "$dir/seed$1.zip"
  python3 -c 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); open(sys.argv[2], "wb").write(z.read("game.log.gz"))' "$dir/seed$1.zip" "$dir/seed$1.log.gz" \
    || echo "  seed $1: the artifact has no game.log.gz" >&2
  rm -f "$dir/seed$1.zip"
}
sha=$(curl -sSfL "${auth[@]}" "$api/runs/$run" | python3 -c 'import json, sys; print(json.load(sys.stdin)["head_sha"][:10])')
alive=0; died=0; other=0; dead=(); : > "$dir/results.tsv"; : > "$dir/budgets.tsv"
while read -r id seed concl; do
  [ "$concl" = success ] || [ "$concl" = failure ] || { echo "seed $seed: $concl"; other=$((other + 1)); continue; }
  log=$(curl -sSfL "${auth[@]}" "$api/jobs/$id/logs" | sed 's/^[0-9TZ:.-]* //')
  end=$(grep -E "^(died|alive) " <<<"$log" | tail -1 || true)
  echo "seed $seed: ${end:-no result}"
  printf '%s\t%s\t%s\n' "$seed" "${end%% *}" "${end##* }" >> "$dir/results.tsv"
  # the game's two budgets, as its own classes charged them (train.lua report)
  grep -E "^(think|input) budget " <<<"$log" | tail -2 | sed "s/^/$seed\t/" >> "$dir/budgets.tsv" || true
  case $end in
    alive*) alive=$((alive + 1)); [ -n "${GC_ALL:-}" ] && game "$seed" ;;
    died*) died=$((died + 1)); dead+=("$seed"); sed -n '/^DEATH REPORT/,/^END DEATH REPORT/p' <<<"$log" > "$dir/seed$seed.txt"; game "$seed" ;;
    *) other=$((other + 1)) ;;
  esac
done <<<"$jobs"
echo "alive $alive, died $died, other $other -- reports in $dir"
awk -F'\t' '$2 ~ /^think/ { split($2, a, /[ ,]+/); over += a[5]; if (a[5] > 0) tseeds++; w = a[10] + 0; if (w > worst) worst = w } $2 ~ /^input/ { split($2, a, /[ ,:]+/); if (a[8] + 0 > most) most = a[8] + 0; over2 += a[9] } END { printf "think budget (8 ms): %d frames over it in %d seeds, slowest %.1f ms | input budget: most %d in a window, %d frames over\n", over, tseeds, worst, most, over2 }' "$dir/budgets.tsv"
hist=$(dirname "$0")/survival_scans.tsv
[ -f "$hist" ] || printf 'run\tcommit\talive\tdied\n' > "$hist"
if [ "$other" -eq 0 ] && ! grep -q "^$run	" "$hist"; then
  printf '%s\t%s\t%s\t%s\n' "$run" "$sha" "$alive" "$(printf '%s\n' "${dead[@]}" | sort -n | paste -sd, -)" >> "$hist"
fi
