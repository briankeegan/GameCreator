#!/usr/bin/env bash
# RUN THE SEARCH UNTIL THE NUMBERS STOP MOVING.
#
# Usage:  GC_LEVEL=10 GC_BRAIN=puyo ./crank.sh [population] [workers]
#
# THIS REPLACED rounds.sh, AND THE DIFFERENCE IS THE WHOLE POINT.
#
# ../PUYO_REFERENCE.md's loop is: play a game, score it, keep the
# highest-scoring SETS, breed new sets near those winners, go back to step 2,
# "run that until the numbers stop moving". One loop. No end, no boundary,
# plural winners.
#
# rounds.sh read "go back to step 2" as "start a NEW search seeded from the
# winner", and ran train.js over and over. That single misreading cost three
# layers of machinery, each patching the last:
#
#   1. A round boundary could carry only ONE genome, so 199 of 200 were
#      discarded every 60 generations.
#   2. Betting 60 generations on one genome needed that genome to be
#      trustworthy — it wasn't, the same weights score 1380 to 6070 across
#      seeds — so finalist selection was added.
#   3. Finalist selection needed FIXED seeds to keep rounds comparable, and a
#      fixed set selected against, round after round, is a target to overfit.
#      Measured: a champion +19% on the seeds that chose it, -13% on seeds it
#      had never seen.
#
# There is no boundary now. train.js runs one continuous search, the
# population is never rebuilt, and nothing selects on a fixed set. What was
# 319 lines of round bookkeeping is this.
#
# WHAT A SNAPSHOT IS. Every GC_SNAPSHOT_EVERY generations train.js reports the
# current elite on the held-out seeds and calls commit_snapshot.sh, which
# names and commits it. The search does not pause for it and the population is
# untouched — it is a photograph, not a checkpoint in the search.
#
# STOPPING. train.js stops when the elite's weights stop moving (three
# snapshots under GC_STILL_ENOUGH of the weight range), which is the
# reference's own rule read literally, or when GC_DEADLINE arrives, or at the
# generation cap. The cap is a backstop: a run that ends there ended for a
# reason that has nothing to do with the numbers.
set -u
cd "$(dirname "$0")"

POP=${1:-200}
WORKERS=${2:-4}
GENS=${GC_GENERATIONS:-100000}      # a backstop, not the stopping rule
MODE=replace
LEVEL=${GC_LEVEL:-3}
BRAIN=${GC_BRAIN:-search}
# THE TAG NAMES THE EXPERIMENT, because two runs that differ by their
# feature set produce snapshots that are otherwise indistinguishable — same
# level, same brain, same filename shape, different question. GC_VARIANT is
# what a caller running one feature at a time passes (see GC_EXCLUDE in
# train.js); empty for a plain full-registry run, which keeps every existing
# snapshot name exactly as it was.
VARIANT=${GC_VARIANT:-}
TAG="l${LEVEL}-${BRAIN}${VARIANT:+-$VARIANT}"
RUN_ID=$(date -u +%m%d-%H%M%S)

# THE MARKER: "a search is running and did not choose to stop."
#
# The container this runs in gets reclaimed without warning and takes every
# process with it. The trap deletes this on any deliberate exit — finished,
# converged, out of time, interrupted — so the marker existing can only mean
# the process was killed, which is exactly the case worth resuming and the
# only one .claude/hooks/resume-training.sh acts on.
MARKER="$PWD/.crank-running"
cat > "$MARKER" <<MARKEREOF
# Written by crank.sh $RUN_ID at $(date -u '+%Y-%m-%d %H:%M:%S'). Deleted on any
# deliberate exit. If you are reading this and no crank.sh is running, the
# container died mid-search.
CRANK_PID=$$
CRANK_ARGS="$POP $WORKERS"
CRANK_ENV="GC_LEVEL=$LEVEL GC_BRAIN=$BRAIN"
CRANK_LOG="$PWD/crank.log"
MARKEREOF
trap 'rm -f "$MARKER"' EXIT INT TERM

echo "=== continuous search: level $LEVEL, brain $BRAIN, population $POP, $WORKERS workers ==="
echo "=== snapshots every ${GC_SNAPSHOT_EVERY:-30} generations; stops when the weights settle ==="
echo ""

# THE POPULATION CARRIES ITSELF. There is no GC_SEED_GENOME here and there
# must not be: seeding a fresh search from one winner is the round boundary
# this file exists to delete. train.js resumes from its own checkpoint, which
# holds the whole population, so a killed run continues rather than restarting
# from its best genome.
export GC_RUN_ID="$RUN_ID" GC_TAG="$TAG" GC_MODE="$MODE"
export GC_SNAPSHOT_HOOK="$PWD/commit_snapshot.sh"

node train.js "$GENS" "$POP" "$MODE" "$WORKERS" score
status=$?

echo ""
if [ $status -eq 0 ]; then
  echo "=== search ended cleanly — see the last snapshot for the answer ==="
else
  echo "=== train.js exited $status — the checkpoint holds the population; rerun to continue ==="
fi
exit $status
