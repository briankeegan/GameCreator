#!/bin/bash
# DOES THE RESUME ACTUALLY RESUME? Run: .claude/hooks/resume-training.test.sh
#
# session-start-resume-training.sh is built never to fail a session: every
# path exits 0. That makes it exactly the shape of thing this repo has been
# burned by before — the vault reported success while doing nothing at all
# for hours — so it needs a test that it WORKS, not just that it runs.
#
# It found two real bugs on the first run. The hook picked its champion with
# `git ls-files | sort | tail -1`, which is alphabetical rather than
# chronological, so it chose an old pre-finals champion over a much better
# recent one; rounds.sh's seed guard then correctly refused it and the
# resume died silently, having printed "restarting it" a moment earlier.
# Both halves matter: the guard was right, the picker was wrong, and the
# only thing that noticed was checking whether a process was actually there
# two seconds later.
#
# NOTE ON pkill: this script kills by command-line pattern, so running it
# from a shell whose own command line contains those strings kills that
# shell. Run it as a file, not pasted into a heredoc.
cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null
EVAL=/home/user/GameCreator/games/the-game/ai/eval
HOOK=/home/user/GameCreator/.claude/hooks/session-start-resume-training.sh
export CLAUDE_PROJECT_DIR=/home/user/GameCreator
MARKER="$EVAL/.crank-running"
fails=0

# PREFLIGHT. This test starts and kills real cranks, so a previous run that
# died badly — or a debug session that left a marker lying around — leaves
# state that makes the next run fail for reasons that have nothing to do
# with the hook. It did exactly that the first time it ran from this
# directory: 4 spurious failures, then 0 on an immediate re-run, which is
# the worst possible signal because it teaches you to re-run rather than
# look. So the test owns its starting conditions rather than assuming them.
pkill -f "rounds.sh 1 1 8 1" 2>/dev/null
pkill -f train_worker.js 2>/dev/null
rm -f "$MARKER" /tmp/resume-test.log
sleep 0.5
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "     want [$3] got [$2]"; fails=$((fails+1)); fi; }

# 1. NO MARKER -> does nothing. A hook that starts work nobody asked for is
#    worse than one that does nothing.
rm -f "$MARKER"
out=$("$HOOK" 2>&1); check "no marker: silent, starts nothing" "${out:-<empty>}" "<empty>"

# 2. MARKER + a crank already running -> leaves it alone. Two cranks would
#    fight over four cores and over the same trained.<mode>.json.
cat > "$MARKER" <<M
CRANK_ARGS="1 1 8 1"
CRANK_ENV="GC_LEVEL=10 GC_BRAIN=puyo"
CRANK_LOG="/tmp/resume-test.log"
CRANK_CHAMPION=""
M
( exec -a "bash ./rounds.sh fake" sleep 30 ) & fake=$!
sleep 0.3
out=$("$HOOK" 2>&1)
case "$out" in *"already running"*) r=yes;; *) r="no: $out";; esac
check "crank alive: refuses to start a second" "$r" "yes"
kill $fake 2>/dev/null; wait $fake 2>/dev/null

# 3. MARKER + nothing running -> restarts it. This is the case that lost
#    round 2.
rm -f /tmp/resume-test.log
out=$("$HOOK" 2>&1)
case "$out" in *"restarting it"*) r=yes;; *) r="no: $out";; esac
check "crank dead, marker left: restarts it" "$r" "yes"
sleep 2
pgrep -f "rounds.sh 1 1 8 1" >/dev/null && r=yes || r=no
check "the restarted crank is really running" "$r" "yes"
case "$(cat /tmp/resume-test.log 2>/dev/null)" in *RESUMED*) r=yes;; *) r=no;; esac
check "the log says it was resumed, not started clean" "$r" "yes"

# 4. It seeds from the newest COMMITTED champion, so a resume continues
#    rather than throwing away every round that finished.
case "$out" in *"champion: "*"trained."*) r=yes;; *) r="no: $out";; esac
check "resumes from the last committed champion" "$r" "yes"

pkill -f "rounds.sh 1 1 8 1" 2>/dev/null
sleep 0.5; pkill -f train_worker.js 2>/dev/null
rm -f "$MARKER" /tmp/resume-test.log

# 5. A DELIBERATE EXIT CLEARS THE MARKER. If it did not, the hook would
#    restart a crank that finished on purpose, forever.
( cd "$EVAL" && timeout 5 ./rounds.sh 1 1 8 1 >/dev/null 2>&1 ) &
sleep 2
[ -f "$MARKER" ] && r=yes || r=no
check "a running crank writes the marker" "$r" "yes"
pkill -INT -f "rounds.sh 1 1 8 1" 2>/dev/null; sleep 1.5
pkill -f train_worker.js 2>/dev/null
[ -f "$MARKER" ] && r="still there" || r=gone
check "interrupting it clears the marker" "$r" "gone"
rm -f "$MARKER"

echo ""; echo "$fails failure(s)"; exit $((fails>0))
