#!/bin/bash
# SessionStart hook: restart a training crank the container killed.
#
# WHY THIS EXISTS. games/the-game/ai/eval/rounds.sh runs for HOURS —
# 200 genomes x 60 generations per round, up to 60 rounds, four workers
# pinned. The containers these sessions run in get reclaimed and replaced
# without warning, and when that happens every process in them dies. It has
# happened twice in one session: the second time it killed a crank 38
# minutes into round 2, which produced nothing, and the round-1 champion
# survived only because somebody thought to look for it.
#
# Restarting it was left to whoever noticed. That is the same mistake as
# leaving the champion to be committed by hand: a step nobody is present for
# does not happen. So the crank now says on disk that it is running, and
# this puts it back.
#
# THE MARKER IS THE WHOLE DESIGN. rounds.sh writes .crank-running when it
# starts (its arguments, its environment, the champion it was told to seed
# from) and DELETES it when it finishes on purpose — a clean finish, a
# stall-out, or a Ctrl-C. So the marker existing means exactly one thing:
# the crank was alive and did not choose to stop. That is precisely the case
# worth resuming and the only one this touches.
#
# WHAT IT WILL NOT DO:
#   - start a crank nobody asked for. No marker, no action.
#   - start a second one. If rounds.sh is already running, it leaves it be —
#     two cranks would fight over four cores and over the same scratch file
#     trained.<mode>.json, and the results of both would be garbage.
#   - resume from where the round died. A half-finished round has no result;
#     it restarts from the last COMMITTED champion, which is the most that
#     can honestly be recovered.
#   - fail a session. Every path exits 0. A hook that can stop a session
#     starting is worse than a crank that has to be restarted by hand.
set -u
EVAL_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}/games/the-game/ai/eval"
MARKER="$EVAL_DIR/.crank-running"

[ -f "$MARKER" ] || exit 0

if pgrep -f "rounds.sh" >/dev/null 2>&1; then
  echo "[resume-training] a crank is already running; leaving it alone"
  exit 0
fi

# The marker is a shell fragment written by rounds.sh: CRANK_ARGS,
# CRANK_ENV, CRANK_LOG, CRANK_CHAMPION.
# shellcheck disable=SC1090
. "$MARKER" 2>/dev/null || { echo "[resume-training] unreadable marker; not resuming"; exit 0; }
[ -n "${CRANK_ARGS:-}" ] || { echo "[resume-training] marker has no args; not resuming"; exit 0; }

# SEED FROM THE BEST COMMITTED CHAMPION THAT IS STILL VALID, so the resume
# continues from where the crank got to rather than starting over.
#
# NOT "the newest file". That was the first version and it was wrong twice
# over: `git ls-files | sort | tail -1` is ALPHABETICAL, so it picked
# trained.replace.l10-puyo.r1.json over the far better
# trained.replace.l10-puyo.0908-234107.r1.json ('r' sorts after '0'), and it
# happened to pick a champion from before finalist selection existed —
# which rounds.sh's own seed guard then refused, killing the resume. The
# guard was right and the picker was wrong.
#
# So: read every committed champion, drop any whose finalsSeeds are not the
# ones this repo now selects on (a bar measured on other seeds is not a bar,
# which is exactly what that guard exists to say), and take the highest
# trainFitness of what is left. Nothing, and it starts fresh, which is worse
# but never dishonest.
champ=$(cd "$EVAL_DIR" && node -e '
  var fs = require("fs"), seeds;
  try { seeds = require("./seeds.js").FINALS.join(","); } catch (e) { process.exit(0); }
  var best = null, bestScore = -Infinity;
  fs.readdirSync(".").filter(function (f) {
    return /^trained\..*\.r[0-9]+\.json$/.test(f);
  }).forEach(function (f) {
    try {
      var d = JSON.parse(fs.readFileSync(f, "utf8"));
      if (!d.finalsSeeds || d.finalsSeeds.join(",") !== seeds) return;
      if (typeof d.trainFitness !== "number") return;
      if (d.trainFitness > bestScore) { bestScore = d.trainFitness; best = f; }
    } catch (e) { /* an unreadable result is not a bar */ }
  });
  if (best) process.stdout.write(best);
' 2>/dev/null)
[ -n "$champ" ] && champ="$EVAL_DIR/$champ" || champ=""

echo "[resume-training] the crank died with its marker still in place — restarting it"
echo "[resume-training]   args:     $CRANK_ARGS"
echo "[resume-training]   champion: ${champ:-none (starting fresh)}"

log="${CRANK_LOG:-$EVAL_DIR/crank.log}"
{
  echo ""
  echo "=== RESUMED $(date -u '+%Y-%m-%d %H:%M:%S') by session-start-resume-training.sh ==="
  echo "=== the previous crank was killed with its marker in place; whatever round ==="
  echo "=== it was in produced nothing and is not recoverable.                    ==="
  echo ""
} >> "$log" 2>/dev/null

cd "$EVAL_DIR" || exit 0
# shellcheck disable=SC2086
nohup env ${CRANK_ENV:-} ${champ:+GC_CHAMPION="$champ"} \
  ./rounds.sh $CRANK_ARGS >> "$log" 2>&1 &
echo "[resume-training] restarted; appending to $log"
exit 0
