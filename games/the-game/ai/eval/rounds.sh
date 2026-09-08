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
# STOPPING. Three consecutive rounds that fail to beat the champion.
#
# Not one: a round is a sample. Each genome plays one game per drill, the
# held-out total is twelve seeds, and a single flat round is as likely to
# be noise as a plateau. Started at two and raised to three because the
# cost of a false stop is losing the run, while the cost of a false
# continue is five minutes — the asymmetry is not close.
#
# THE ROUND CAP IS A BACKSTOP, NOT THE STOPPING RULE. If a run ends by
# hitting the cap, it ended for a reason that has nothing to do with the
# numbers, and whatever it reports is "we got bored", not a plateau. A
# round is ~5 minutes (200x60 = 12,000 weight sets), so set the cap high
# enough that the rule is what fires: 60 rounds is 720,000 sets in about
# five hours.
#
# Every round's result is kept under its own name (trained.<mode>.r<N>.json)
# because train.js overwrites the generic file on every run — a champion
# left under that name is a champion waiting to be silently replaced.
#
# Usage:  GC_LEVEL=10 GC_BRAIN=puyo ./rounds.sh [maxRounds] [gens] [pop] [workers]
set -u
cd "$(dirname "$0")"

MAX_ROUNDS=${1:-60}
GENS=${2:-60}
POP=${3:-200}
WORKERS=${4:-4}
MODE=replace
LEVEL=${GC_LEVEL:-3}
BRAIN=${GC_BRAIN:-search}
TAG="l${LEVEL}-${BRAIN}"
# Distinguishes one invocation of this script from the next.
RUN_ID=$(date -u +%m%d-%H%M%S)

# GC_CHAMPION seeds the crank from a run that already happened, so a round
# done by hand is round 1 rather than something thrown away. Its held-out
# total becomes the bar the next round has to beat.
champion="${GC_CHAMPION:-}"
champScore=""
stale=0
if [ -n "$champion" ]; then
  champScore=$(node -e "
    var d=require('$champion');
    process.stdout.write(String((d.holdout && d.holdout.learned && d.holdout.learned.fitness) || 0));
  ")
  echo "starting from champion $champion (held-out total $champScore)"
fi

echo "=== rounds: level $LEVEL, brain $BRAIN, up to $MAX_ROUNDS rounds of ${POP}x${GENS} ==="

for (( r=1; r<=MAX_ROUNDS; r++ )); do
  log="/tmp/rounds-${TAG}-r${r}.log"
  echo ""
  echo "--- round $r/$MAX_ROUNDS  ($(date -u +%H:%M:%S)) ---"

  # EVERY ROUND GETS ITS OWN GA SEED. train.js's rng is a fixed constant by
  # default, so without this each round seeded from the same champion is a
  # bit-identical replay of the last one — observed directly: two rounds
  # returned 2195.8333333333335, to the last digit. The crank would then
  # stop after three identical rounds having searched nothing.
  gaSeed=$(( 20260907 + r * 7919 ))

  # The seed genome is the CHAMPION, not the previous round's winner. A
  # round that came back worse should not become the point the next round
  # clusters around, or a single bad round walks the search away from the
  # best thing found so far.
  if [ -n "$champion" ]; then
    GC_GA_SEED=$gaSeed GC_SEED_GENOME="$champion" node train.js "$GENS" "$POP" "$MODE" "$WORKERS" score > "$log" 2>&1
  else
    GC_GA_SEED=$gaSeed node train.js "$GENS" "$POP" "$MODE" "$WORKERS" score > "$log" 2>&1
  fi
  status=$?
  if [ $status -ne 0 ]; then
    echo "round $r FAILED (exit $status) — see $log"
    tail -5 "$log"
    exit $status
  fi

  # NAMED BY RUN, NOT JUST BY ROUND NUMBER. The counter restarts at 1 every
  # invocation, so a second crank wrote trained.replace.l10-puyo.r1.json —
  # the name the first crank's CHAMPION already had — and clobbered it. The
  # champion variable then pointed at the worse genome while the bar it had
  # to beat still read the better one's score. Recovered from git; made
  # impossible here.
  result="trained.${MODE}.${TAG}.${RUN_ID}.r${r}.json"
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
    echo "round $r does not beat champion $champScore (stale $stale/3)"
    if [ $stale -ge 3 ]; then
      echo ""
      echo "=== THE NUMBERS HAVE STOPPED MOVING ==="
      echo "champion: $champion  (held-out total $champScore)"
      exit 0
    fi
  fi
done

echo ""
echo "=== HIT THE ROUND CAP ($MAX_ROUNDS) — THE NUMBERS WERE STILL MOVING ==="
echo "This did NOT stop because it converged. Raise the cap and continue"
echo "from the champion: GC_CHAMPION=<file> ./rounds.sh"
echo "champion: $champion  (held-out total $champScore)"
