#!/usr/bin/env bash
# RUN UNTIL THE NUMBERS STOP MOVING.
#
# PUYO_REFERENCE.md's loop does not end at step 7. After "generate new sets
# clustered near those winners" it says: go back to step 2, and "run that
# until the numbers stop moving". A single training run is one turn of that
# crank. This is the crank.
#
# Each round seeds from the previous round's winner — the winner itself,
# variants of it at three mutation strengths, and the rest random so the
# search can still leave the basin it is in (see train.js's GC_SEED_GENOME
# handling). Then the held-out TOTAL decides whether it actually improved,
# on twelve seeds the search never saw.
#
# STOPPING. Two consecutive rounds that fail to beat the champion. Not one:
# a round is a sample, each genome plays one game per drill, and a single
# flat round is as likely to be noise as a plateau. Two in a row is the
# cheapest thing that is not a coin flip.
#
# Every round's result is kept under its own name (trained.<mode>.r<N>.json)
# because train.js overwrites the generic file on every run — a champion
# left under that name is a champion waiting to be silently replaced.
#
# Usage:  GC_LEVEL=10 GC_BRAIN=puyo ./rounds.sh [maxRounds] [gens] [pop] [workers]
set -u
cd "$(dirname "$0")"

MAX_ROUNDS=${1:-10}
GENS=${2:-60}
POP=${3:-200}
WORKERS=${4:-4}
MODE=replace
LEVEL=${GC_LEVEL:-3}
BRAIN=${GC_BRAIN:-search}
TAG="l${LEVEL}-${BRAIN}"

champion=""
champScore=""
stale=0

echo "=== rounds: level $LEVEL, brain $BRAIN, up to $MAX_ROUNDS rounds of ${POP}x${GENS} ==="

for (( r=1; r<=MAX_ROUNDS; r++ )); do
  log="/tmp/rounds-${TAG}-r${r}.log"
  echo ""
  echo "--- round $r/$MAX_ROUNDS  ($(date -u +%H:%M:%S)) ---"

  # The seed genome is the CHAMPION, not the previous round's winner. A
  # round that came back worse should not become the point the next round
  # clusters around, or a single bad round walks the search away from the
  # best thing found so far.
  if [ -n "$champion" ]; then
    GC_SEED_GENOME="$champion" node train.js "$GENS" "$POP" "$MODE" "$WORKERS" score > "$log" 2>&1
  else
    node train.js "$GENS" "$POP" "$MODE" "$WORKERS" score > "$log" 2>&1
  fi
  status=$?
  if [ $status -ne 0 ]; then
    echo "round $r FAILED (exit $status) — see $log"
    tail -5 "$log"
    exit $status
  fi

  result="trained.${MODE}.${TAG}.r${r}.json"
  cp "trained.${MODE}.json" "$result"

  # The held-out TOTAL: the sum of the four final scores on twelve seeds
  # never trained on. Read from the JSON rather than scraped from the log,
  # so a change to the log format cannot silently break the comparison.
  score=$(node -e "
    var d=require('./$result');
    process.stdout.write(String((d.holdout && d.holdout.learned && d.holdout.learned.fitness) || 0));
  ")
  echo "round $r held-out total: $score   -> $result"
  grep -A 6 'HELD-OUT SEEDS' "$log" | sed 's/^/    /'

  if [ -z "$champScore" ] || (( $(echo "$score > $champScore" | bc -l) )); then
    echo "round $r IMPROVES on ${champScore:-nothing}"
    champion="$PWD/$result"
    champScore="$score"
    stale=0
  else
    stale=$((stale + 1))
    echo "round $r does not beat champion $champScore (stale $stale/2)"
    if [ $stale -ge 2 ]; then
      echo ""
      echo "=== THE NUMBERS HAVE STOPPED MOVING ==="
      echo "champion: $champion  (held-out total $champScore)"
      exit 0
    fi
  fi
done

echo ""
echo "=== ran out of rounds ($MAX_ROUNDS) — the numbers were still moving ==="
echo "champion: $champion  (held-out total $champScore)"
