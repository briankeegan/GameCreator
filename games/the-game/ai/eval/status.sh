#!/bin/bash
# WHAT IS ACTUALLY RUNNING RIGHT NOW — read, never recalled.
#
#   ./status.sh
#
# WHY THIS EXISTS. In one session the same question ("is comboPotential in the
# run?") got two opposite answers an hour apart, both stated confidently, both
# from memory. A second session-long run was left alive by accident and split
# four cores with the real one for 52 minutes before anyone noticed. And three
# separate numbers were quoted from recall after the code that produced them
# had been fixed — 10/84 when it was 9, "19-22 chains" from a resolve() that
# counted rounds as chain links.
#
# Every one of those is the same failure: state was ASSERTED instead of READ.
# So this prints what the machine says, from the process table, the run's own
# log and the files on disk. Nothing here is typed in from memory, which is why
# it can be trusted when a person and a model disagree about what is going on.
#
# It is deliberately read-only. It starts nothing, kills nothing and writes
# nothing, so it is always safe to run — a status tool that can change state is
# a status tool people hesitate to use.
set -u
cd "$(dirname "$0")"
SP="${GC_SCRATCH:-/tmp/claude-0/-home-user/e80c57f7-74a5-5949-a097-2632c64d4b5a/scratchpad}"
LOG="${GC_RUN_LOG:-$SP/realrun.log}"

echo "=== TRAINING ==="
# Overridable ONLY so the test can feed it a two-process world; nothing
# else sets it. The duplicate-run warning is a check that fires roughly
# once a year, which is exactly the kind that turns out never to have
# worked (CLAUDE.md: "A CHECKER'S BUGS ARE SILENT BY CONSTRUCTION").
if [ -n "${GC_PS:-}" ]; then
  procs=$(eval "$GC_PS" | grep -v "bash -c" || true)
else
  procs=$(pgrep -fa "train\.js" | grep -v "bash -c" || true)
fi
if [ -z "$procs" ]; then
  echo "  nothing training."
else
  n=$(echo "$procs" | wc -l)
  echo "$procs" | sed 's/^/  /'
  # A SECOND SEARCH IS A BUG, NOT A BONUS. Two of these split the cores and
  # each one gets slower; it has happened, unnoticed, for the better part of
  # an hour. Say it loudly rather than leaving it to be spotted in a list.
  [ "$n" -gt 1 ] && echo "  !! $n train.js processes — they are splitting the cores. Expected 1."
fi

echo
echo "=== THE GENOME (from the run's own log, not from memory) ==="
if [ -f "$LOG" ]; then
  grep -E "excluding|training [0-9]+ weights" "$LOG" | tail -2 | sed 's/^/  /'
  echo "  seed/generation:"
  grep -E "^############ SEED" "$LOG" | tail -1 | sed 's/^/    /'
  grep -E "^gen " "$LOG" | tail -1 | sed 's/^/    /'
else
  echo "  no run log at $LOG"
fi

echo
echo "=== LAST SNAPSHOT: BOTH NUMBERS ==="
if [ -f "$LOG" ]; then
  # Score alone cannot tell you whether it learned to CHAIN, so both or
  # neither — see chainmeasure.js.
  grep -E "TOTAL |CHAINS FIRED|NO BETTER" "$LOG" | tail -3 | sed 's/^/  /'
  grep -qE "TOTAL " "$LOG" || echo "  no snapshot yet (first one at generation GC_SNAPSHOT_EVERY)"
fi

echo
echo "=== CHIPS ==="
node -e '
var fs=require("fs"), n=0, f=[];
try { f=fs.readdirSync("chips").filter(function(x){return /\.json$/.test(x)}); } catch(e){}
f.forEach(function(x){ try { var j=JSON.parse(fs.readFileSync("chips/"+x,"utf8"));
  n += (j.chips||j).length||0; } catch(e){} });
console.log("  " + n + " chips in " + f.length + " files");
' 2>/dev/null || echo "  (could not count)"
[ -d chips-engine-only ] && echo "  !! chips-engine-only/ exists again — that category was closed."

echo
echo "=== GIT ==="
git -C ../../../.. fetch origin main --quiet 2>/dev/null
head=$(git -C ../../../.. rev-parse --short HEAD)
main=$(git -C ../../../.. rev-parse --short origin/main)
dirty=$(git -C ../../../.. status --porcelain | wc -l)
echo "  HEAD $head   origin/main $main   uncommitted files: $dirty"
[ "$head" != "$main" ] && echo "  !! HEAD and origin/main differ — Pages deploys from main only."
exit 0
