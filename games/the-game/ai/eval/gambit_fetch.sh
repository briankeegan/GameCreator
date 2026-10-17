#!/usr/bin/env bash
# The games of training-mode runs, fetched: one directory per game under DIR (RUN-GAME), each with the game's survivor.log and
# results.txt -- what gambit_losses.js reads. Every fetch is retried.
#
#   bash gambit_fetch.sh DIR RUN_ID...
set -u
DIR=$1; shift
mkdir -p "$DIR"
T=$(gh auth token 2>/dev/null)
CA=${CURL_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}; [ -f "$CA" ] || CA=""
for R in "$@"; do
  for line in $(gh api "repos/briankeegan/GameCreator/actions/runs/$R/artifacts?per_page=50" --jq '.artifacts[] | "\(.id):\(.name)"'); do
    a=${line%%:*}; n=${line##*-}; d=$DIR/$R-$n; mkdir -p "$d"
    (cd "$d" && for k in 1 2 3; do
       curl -sSL ${CA:+--cacert "$CA"} -H "Authorization: Bearer $T" -o a.zip "https://api.github.com/repos/briankeegan/GameCreator/actions/artifacts/$a/zip" &&
         unzip -oq a.zip survivor.log results.txt 2>/dev/null && rm -f a.zip && break
       sleep $((k * 5))
     done) &
  done
done
wait
ls "$DIR" | wc -l | sed 's/$/ games fetched/'
