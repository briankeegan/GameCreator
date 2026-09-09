#!/bin/bash
# Restart a training crank the container killed. Registered on SessionStart,
# UserPromptSubmit AND PreToolUse — see WHICH EVENT, below.
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
# WHICH EVENT — AND WHY NOT JUST SessionStart, WHICH IS WHERE THIS STARTED.
# It was a SessionStart hook and that was wrong, proved the same night it was
# written: the container was replaced 70 minutes into a round, killed the
# crank, and no SessionStart fired because THE SESSION DID NOT START — it
# continued, in a new container. The marker sat there correctly describing a
# dead crank and nothing read it, so the second run died exactly like the
# first, having been "fixed".
#
# A container restart is invisible from in here; there is no event for it. So
# the check runs on the events that DO happen afterwards: the next user
# message (UserPromptSubmit) and the next tool call (PreToolUse). Between
# them, nothing can happen in this session without this having been asked
# first. It is a few milliseconds when there is nothing to do — a file test,
# and a pgrep only if the marker exists — and it prints nothing at all in
# that case, so putting it on a per-tool-call event costs nothing visible.
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

# IS THIS CRANK ALIVE? Asked by PID, from the marker, not by grepping the
# process table for "rounds.sh".
#
# A pattern match answers a different question — "is ANY crank running
# anywhere" — and that is wrong in both directions. It would refuse to
# resume this crank because an unrelated one was running, and it made the
# test for this hook unable to run at all while a real crank trained, since
# the test starts and kills cranks of its own and the two could not be told
# apart. A PID that a container restart has taken with it does not exist, so
# the check is also exactly right for the case this hook is FOR.
#
# The cmdline is checked too, because PIDs are recycled: a dead crank's
# number may now belong to something else entirely, and "a process with that
# id exists" is not "the crank is alive".
crank_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "rounds.sh"
}

# The marker is a shell fragment written by rounds.sh: CRANK_ARGS,
# CRANK_ENV, CRANK_LOG, CRANK_CHAMPION.
# shellcheck disable=SC1090
. "$MARKER" 2>/dev/null || { echo "[resume-training] unreadable marker; not resuming"; exit 0; }
[ -n "${CRANK_ARGS:-}" ] || { echo "[resume-training] marker has no args; not resuming"; exit 0; }

if crank_alive "${CRANK_PID:-}"; then
  echo "[resume-training] a crank is already running; leaving it alone"
  exit 0
fi

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
# GC_START_ROUND resumes the ROUND NUMBER too, not just the champion. The
# GA seed is derived from it, so coming back as round 1 after dying in round
# 2 is a different search — and train.js's per-generation checkpoint then
# correctly refuses to load, throwing away everything the killed round had
# banked. Observed exactly once before this line existed.
nohup env ${CRANK_ENV:-} ${champ:+GC_CHAMPION="$champ"} \
  ${CRANK_ROUND:+GC_START_ROUND="$CRANK_ROUND"} \
  ./rounds.sh $CRANK_ARGS >> "$log" 2>&1 &
echo "[resume-training] restarted; appending to $log"
exit 0
