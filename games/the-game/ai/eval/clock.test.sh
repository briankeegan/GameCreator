#!/bin/sh
# THE CLOCK IS THE ENGINE'S. Every search prices a line by one clock
# (native/bot.c: travelCost, stepGap, lineFrames, searchInTime); the engine's
# judge plays the line as the front plays it. On a real game (seed 4, level 10,
# comboStorm) every line the bot judges is priced both ways (GC_CLOCKCHECK:
# "CLOCK steps frozen clock engine waitAll", the engine's press as the clock
# counts it, pressSeen).
#
# The clock may be early -- it does not see a pair still moving, and
# lineFrames does not see the stop time a clear in the line earns -- but a
# clock that is LATE prunes lines that are in time. So it fails if:
#   - a one-step line is ever priced later than the engine, or the engine's
#     own frame is not the clock's commonest answer for one (a clock off by a
#     frame everywhere shows here);
#   - a line on a stopped or topped board (no reaction to wait out, whatever
#     it clears) is ever priced later than the engine.
#
#   ./clock.test.sh [SEED] [FRAMES]   (4 700 by default: about 1.5 s, a gate's limit)
set -e
here=$(cd "$(dirname "$0")" && pwd)
seed=${1:-4}; frames=${2:-700}
out="$here/.clock.test.out"
trap 'rm -f "$out"' EXIT
# the drill alone (native/build.sh's line for it), not every target build.sh makes
[ -x "$here/native/drill" ] || (cd "$here/native" && clang -O3 -march=native -pthread -DPA_LIB -Wall -Wno-unused-function -Wno-unknown-attributes -Wno-ignored-attributes bit.c pa.c drill.c -lm -o drill)
GC_CLOCKCHECK=1 "$here/drill.sh" "$seed" "$frames" 2>&1 | grep '^CLOCK' > "$out" || true
awk '
  { n = $2; fz = $3; d = $5 - $4; all++
    if (n == 1) { one++; gap[d]++; if (d == 0) exact++; if (d < 0) oneLate++ }
    if (fz == 1) { froz++; if (d < 0) frozLate++ }
    if (fz == 0 && n > 1) { free++; if (d < 0) freeLate++ } }
  END {
    if (all == 0) { print "clock: no lines judged -- the check never ran"; exit 1 }
    printf "clock: %d lines; one step %d (%d on the engine'"'"'s frame, %d late); stopped or topped %d (%d late); free multi-step %d (%d late: stop time a clear earns, unseen by lineFrames)\n", all, one, exact, oneLate, froz, frozLate, free, freeLate
    bad = 0
    if (one == 0) { print "clock: no one-step lines"; bad = 1 }
    if (oneLate) { print "clock: a one-step line priced later than the engine"; bad = 1 }
    mode = 0; for (g in gap) if (gap[g] > gap[mode]) mode = g
    if (mode != 0) { printf "clock: one-step lines are most often %d frames off the engine, not on it\n", mode; bad = 1 }
    if (frozLate) { print "clock: a line on a stopped or topped board priced later than the engine"; bad = 1 }
    exit bad
  }' "$out"
