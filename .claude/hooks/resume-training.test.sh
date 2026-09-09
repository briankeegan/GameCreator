#!/bin/bash
# DOES THE RESUME ACTUALLY RESUME? Run: .claude/hooks/resume-training.test.sh
#
# resume-training.sh is built never to fail a session: every path exits 0.
# That makes it exactly the shape of thing this repo has been burned by
# before — the vault reported success while doing nothing at all for hours —
# so it needs a test that it WORKS, not just that it runs. It has found
# three real bugs so far, one of them fatal to the whole idea:
#
#   - the hook picked its champion with `git ls-files | sort | tail -1`,
#     which is alphabetical rather than chronological, so it chose an old
#     pre-finals champion; rounds.sh's seed guard then correctly refused it
#     and the resume died SILENTLY, a moment after printing "restarting it".
#     Only checking that a process was really there two seconds later caught
#     that.
#   - the hook was registered on SessionStart alone. A container replaced
#     mid-session does not start a session, it continues one, so nothing ran
#     it and a second crank died exactly like the first, after being "fixed".
#   - and this test itself ran against the REAL eval directory, so running
#     it while training was live killed that training's workers mid-round
#     and deleted its marker. The junk round it produced took 66 seconds
#     instead of thirty minutes, scored half what the champion did, and was
#     counted as a stale round against the stop condition.
#
# EVERYTHING BELOW THEREFORE RUNS IN A THROWAWAY PROJECT. A test that can
# damage the thing it is testing is not a safety net, and this one is meant
# to be runnable at any time, including while a crank is training.
# ONE MORE TRAP, LEARNED THE EXPENSIVE WAY: `pkill -f` / `pgrep -f` match
# against the FULL COMMAND LINE of every process, INCLUDING THE SHELL RUNNING
# YOU. Three times in one session a kill-by-pattern typed into a command whose
# own text contained that pattern killed the calling shell. It exits 144 with
# no output, which looks exactly like the thing under test crashing, and sends
# you debugging the wrong program. Two rules:
#   - kill by PID, recorded when you started the process (see PIDS below);
#   - if a pattern is unavoidable, put it in a script FILE and invoke that file
#     on a line with nothing else on it, so the pattern is never in the
#     caller's command line.
set -u
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/resume-training.sh"
SETTINGS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/settings.json"
fails=0
# HOOK OUTPUT GOES TO A FILE, NEVER THROUGH $( ). The hook launches a crank
# in the background, and command substitution does not return until every
# process holding the pipe has let go of it — so `out=$("$HOOK")` hung the
# whole test the moment the hook actually succeeded at its job. Capturing to
# a file has no such coupling.
run_hook() { "$HOOK" > "$SANDBOX/hook.out" 2>&1 </dev/null; cat "$SANDBOX/hook.out"; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "     want [$3] got [$2]"; fails=$((fails+1)); fi; }

SANDBOX=$(mktemp -d)
# CLEAN UP BY PID, NOT BY PATTERN. A crank the hook starts is launched after
# a cd, so its command line is "./rounds.sh 1 1 8 1" with no sandbox path in
# it — `pkill -f "$SANDBOX"` silently missed exactly the processes this test
# creates most of, leaving stubs running after the directory was deleted.
# Every pid this test is responsible for goes in PIDS.
PIDS=""
cleanup() {
  for p in $PIDS; do kill -TERM "$p" 2>/dev/null; done
  sleep 0.2
  for p in $PIDS; do kill -KILL "$p" 2>/dev/null; done
  rm -rf "$SANDBOX"
}
trap cleanup EXIT
# The pid of whatever crank the marker currently describes — which is how the
# hook itself decides, so the test asks the same question the code does.
marker_pid() { sed -n 's/^CRANK_PID=//p' "$MARKER" 2>/dev/null | head -1; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
EVAL="$SANDBOX/games/the-game/ai/eval"
mkdir -p "$EVAL"
MARKER="$EVAL/.crank-running"
export CLAUDE_PROJECT_DIR="$SANDBOX"

# A stand-in crank: writes its marker exactly as the real one does, clears it
# on any deliberate exit, and otherwise just sits there. Testing against the
# real crank.sh would mean waiting half an hour per case and burning four
# cores to learn nothing about the hook.
cat > "$EVAL/crank.sh" <<'STUB'
#!/bin/bash
cd "$(dirname "$0")"
MARKER="$PWD/.crank-running"
cat > "$MARKER" <<M
CRANK_PID=$$
CRANK_ARGS="$*"
CRANK_ENV="GC_LEVEL=10 GC_BRAIN=puyo"
CRANK_LOG="$PWD/crank.log"
CRANK_CHAMPION=""
M
# The trap EXITS. Without that, bash runs the handler and then carries on
# from where the signal landed, so the stub outlived the kill that was
# supposed to end it and the test hung in `wait` — after every real check
# had already passed.
# The trap EXITS, and kills only ITS OWN sleep. Without the exit, bash runs
# the handler and then carries on from where the signal landed, so the stub
# outlived the kill meant to end it and the test hung in `wait` — after every
# real check had already passed. And `kill 0` is not the fix: that signals the
# whole process group, which includes the test itself.
trap 'rm -f "$MARKER"; kill "${napper:-0}" 2>/dev/null; exit 0' EXIT INT TERM
echo "stub crank running: $*"
# `sleep 300 & wait`, NOT a bare `sleep 300`. Bash defers a trap until the
# running foreground command finishes, so a bare sleep swallows the TERM for
# five minutes and the trap that clears the marker never runs — which hung
# this test at the first case that kills a stub, looking exactly like the
# hook being broken.
sleep 300 & napper=$!; wait $napper
STUB
chmod +x "$EVAL/crank.sh"

cat > "$EVAL/seeds.js" <<'SEEDS'
module.exports = { FINALS: [201,202,203,204,205,206,207,208,209,210,211,212] };
SEEDS
# Two champions: a better one measured on the CURRENT finals seeds, and a
# higher-scoring one measured on different seeds that must be ignored — a
# bar measured on other seeds is not a bar.
echo '{"trainFitness":100,"finalsSeeds":[201,202,203,204,205,206,207,208,209,210,211,212],"weights":{}}' > "$EVAL/trained.replace.tag.0101-000000.r1.json"
echo '{"trainFitness":900,"finalsSeeds":[1,2,3],"weights":{}}'                                          > "$EVAL/trained.replace.tag.0101-000000.r2.json"
echo '{"trainFitness":500,"finalsSeeds":[201,202,203,204,205,206,207,208,209,210,211,212],"weights":{}}' > "$EVAL/trained.replace.tag.0101-000000.r3.json"

# 1. NO MARKER -> does nothing. A hook that starts work nobody asked for is
#    worse than one that does nothing.
out=$(run_hook); check "no marker: silent, starts nothing" "${out:-<empty>}" "<empty>"

# 2. A LIVE CRANK IS LEFT ALONE. Two would fight over the cores and over the
#    same trained.<mode>.json scratch file, and both results would be junk.
"$EVAL/crank.sh" 1 1 8 1 >/dev/null 2>&1 & live=$!; PIDS="$PIDS $live"
sleep 0.5
out=$(run_hook)
case "$out" in *"already running"*) r=yes;; *) r="no: $out";; esac
check "crank alive: refuses to start a second" "$r" "yes"

# 3. AND IT KNOWS WHICH CRANK. The check is by PID from the marker, so an
#    unrelated crank running elsewhere must not make this one look alive —
#    that is what made the old pattern match unsafe to run beside real work.
sed -i 's/^CRANK_PID=.*/CRANK_PID=999999/' "$MARKER"
out=$(run_hook)
case "$out" in *"restarting it"*) r=yes;; *) r="no: $out";; esac
check "a dead PID is not 'alive' just because some crank is running" "$r" "yes"
kill -TERM $live 2>/dev/null; wait $live 2>/dev/null; sleep 0.3

# 4. MARKER + nothing running -> restarts it. The case that lost two runs.
cat > "$MARKER" <<M
CRANK_PID=999999
CRANK_ARGS="1 1 8 1"
CRANK_ENV="GC_LEVEL=10 GC_BRAIN=puyo"
CRANK_LOG="$EVAL/crank.log"
CRANK_CHAMPION=""
M
rm -f "$EVAL/crank.log"
out=$(run_hook)
case "$out" in *"restarting it"*) r=yes;; *) r="no: $out";; esac
check "crank dead, marker left: says it is restarting" "$r" "yes"
sleep 1.5
# THE CHECK THAT MATTERS. The hook prints "restarting it" before it knows
# whether the crank survives its own first second — and the first time this
# ran, it did not: the seed guard refused the champion the hook had picked
# and the crank exited immediately, seconds after a confident success line.
restarted=$(marker_pid); PIDS="$PIDS $restarted"
alive "$restarted" && r=yes || r=no
check "the restarted crank is REALLY running" "$r" "yes"
case "$(cat "$EVAL/crank.log" 2>/dev/null)" in *RESUMED*) r=yes;; *) r=no;; esac
check "the log says it was resumed, not started clean" "$r" "yes"

# 5. THERE IS NOTHING TO SEED FROM, and that is the point. This used to
#    check that the hook picked the best committed champion to start a fresh
#    search from — the round boundary's job. The search is continuous now and
#    train.js's checkpoint carries the whole population, so a resume runs the
#    same command and picks up at the generation it died on.
case "$out" in *"champion"*) r="still picking a champion";; *) r=ok;; esac
check "resumes without choosing a champion" "$r" "ok"

kill -TERM $restarted 2>/dev/null; sleep 0.5

# 6. A DELIBERATE EXIT CLEARS THE MARKER, or the hook would resurrect a
#    finished crank forever.
"$EVAL/crank.sh" 1 1 8 1 >/dev/null 2>&1 & live=$!; PIDS="$PIDS $live"
sleep 0.5
[ -f "$MARKER" ] && r=yes || r=no
check "a running crank writes the marker" "$r" "yes"
# TERM, not INT. A background job in a non-interactive shell has SIGINT set
# to ignore, so `kill -INT` did nothing at all here and the marker stayed put
# — which reads exactly like the trap being broken.
kill -TERM $live 2>/dev/null; sleep 0.8
[ -f "$MARKER" ] && r="still there" || r=gone
check "interrupting it clears the marker" "$r" "gone"

# 7. IT IS REGISTERED ON EVENTS THAT ACTUALLY FIRE AFTER A CONTAINER RESTART.
#    The bug that made the whole thing pointless once already: correct hook,
#    wired only to SessionStart, never invoked. A hook that is right and
#    never runs is not a mechanism.
for ev in SessionStart UserPromptSubmit PreToolUse; do
  r=$(node -e '
    var d = require(process.argv[1]), ev = process.argv[2];
    process.stdout.write(JSON.stringify((d.hooks || {})[ev] || [])
      .indexOf("resume-training.sh") >= 0 ? "yes" : "no");
  ' "$SETTINGS" "$ev" 2>/dev/null)
  check "registered on $ev" "$r" "yes"
done

echo ""; echo "$fails failure(s)"; exit $((fails > 0))
