#!/usr/bin/env bash
# DOES A RUN THAT RAN OUT OF TIME LEAVE A CHECKPOINT BEHIND?
#
#   bash checkpoint.test.sh
#
# This is the check for the most expensive bug in this directory: every GitHub
# training job ends on its deadline, and every one of them DELETED its own
# checkpoint on the way out. So every job began at generation 1. Run #64
# reached generation 129 in five and a half hours; the next run opened at
# generation 30 of a brand new search. Five and a half hours, twice, and
# nothing about it looked wrong — a fresh search at generation 30 scores like a
# continued one at generation 120, and the workflow header promised resumption
# in writing the whole time.
#
# Two independent bugs produced it, which is why the first fix did nothing:
#
#   1. report() deleted the checkpoint on EVERY snapshot, immediately before
#      calling the snapshot hook — whose entire job is to commit that
#      checkpoint so the next job can resume. The hook's [ -f ] test was false
#      every single time, so force-adding it past .gitignore never once fired.
#   2. finish() is called from the deadline as well as from a real completion,
#      and report(true) cleared the checkpoint for both.
#
# BOTH DIRECTIONS, because a checkpoint that is never cleared is its own bug:
# the next run would resume a finished search, at its last generation, forever.
#
#   OUT OF TIME      -> checkpoint KEPT, and visible to the snapshot hook
#   SEARCH FINISHED  -> checkpoint GONE
#
# IT NEVER RACES THE CLOCK, AND THE FIRST VERSION DID. train.js checks the
# deadline right after incrementing the generation and returns BEFORE that
# generation's saveCheckpoint(), so a run stopped during generation 1 has
# never written a checkpoint — correctly, there is nothing to resume yet. A
# fixed six-second deadline therefore passed on an idle machine and failed
# inside gate_all, where the box is busy. That is a flaky gate, which is worse
# than no gate: it teaches whoever sees it red to run it again rather than to
# look. So the run's OWN REPORT of which generation it stopped at is read
# back, the deadline is extended and retried if it did not get two
# generations in, and running out of retries is reported as a SETUP failure in
# its own words — never as a pass, and never as the bug.
set -u
cd "$(dirname "$0")" || exit 1

fails=0
note() { echo "  FAIL: $*"; fails=$((fails + 1)); }

MODE=replace
# THE NAME CARRIES A HASH OF THE SEARCH'S FINGERPRINT (train.js
# checkpointPath), so there is no single filename to watch. What there IS, is
# a clean line between the checkpoints this test creates and any that were
# already here.
#
# THIS TEST MUST NEVER DELETE A CHECKPOINT IT DID NOT CREATE, and the first
# version did. It globbed `rm -f .train-checkpoint.${MODE}.*.json` at four
# points and leaned on a copy in `mktemp -d` to put back whatever it
# destroyed. That is the repo's own os.tmpdir rule being broken in a shell
# script: the copy lives outside the tree, and if it is gone when the trap
# fires — a cleaned temp dir, a killed run, a job cancellation — the restore
# silently restores nothing and the checkpoint is simply lost. Worse, it
# cascades: once the file is missing at the next run's start, there is
# nothing to save, so every later run also "restores" nothing. A live
# training checkpoint was deleted this way, by the very test whose subject
# is checkpoints not being deleted.
#
# So: anything on disk when this starts is FOREIGN and untouchable, and the
# test only ever looks at, and only ever removes, what appeared after. There
# is nothing to save and therefore nothing to fail to restore.
FOREIGN=" $(ls .train-checkpoint.${MODE}.*.json 2>/dev/null | tr '\n' ' ')"
ours() {
  local f
  for f in $(ls .train-checkpoint.${MODE}.*.json 2>/dev/null); do
    case "$FOREIGN" in *" $f "*) ;; *) echo "$f" ;; esac
  done
}
ckptPath()  { ours | head -1; }
ckptCount() { ours | wc -l; }
clearOurs() { local f; for f in $(ours); do rm -f "$f"; done; }

cleanup() {
  clearOurs
  rm -f trained.${MODE}.checkpoint-test.*.smoke.json trained.${MODE}.roundtrip.*.smoke.json
}
trap cleanup EXIT

# GENERATIONS, POPULATION, MODE AND WORKERS ARE POSITIONAL ARGUMENTS, not
# environment variables: `node train.js [generations] [population] [mode]
# [workers]`. The first version of this test passed them as GC_* env vars, so
# every run took the DEFAULTS — mode 'add', not 'replace' — and wrote
# .train-checkpoint.add.json while the test watched .train-checkpoint.replace.json.
# Both checks then reported on a file nothing had ever created: one "failed"
# because the file was absent and one "passed" for the same reason. A test that
# runs the wrong thing looks exactly like a test that found something.
train() {  # train <generations> <logfile> [extra env assignments...]
  local gens="$1" log="$2"; shift 2
  env GC_SEEDS_PER_GEN=1 GC_LEVEL=10 GC_BRAIN=puyo GC_GA_SEED=99 \
      GC_TAG=checkpoint-test GC_SNAPSHOT_HOOK= "$@" \
      node train.js "$gens" 8 "$MODE" 2 > "$log" 2>&1
}

# Run until the deadline stops it, having completed at least two generations.
# Returns 0 and leaves the log in $LASTLOG; returns 1 if it could not get there.
LASTLOG=""
outOfTimeRun() {  # outOfTimeRun [extra env assignments...]
  local secs
  for secs in 15 45 120; do
    clearOurs
    LASTLOG="$(mktemp)"
    train 1000 "$LASTLOG" GC_DEADLINE=$(( $(date +%s) + secs )) "$@"
    local gen
    gen=$(sed -n 's/.*OUT OF TIME at generation \([0-9]*\).*/\1/p' "$LASTLOG" | tail -1)
    if [ -n "$gen" ] && [ "$gen" -ge 2 ]; then return 0; fi
    echo "     (deadline of ${secs}s only reached generation ${gen:-0}; retrying longer)"
  done
  return 1
}

# ---------------------------------------------------------------- out of time
echo "1) a run that ran OUT OF TIME keeps its checkpoint"
if outOfTimeRun; then
  if [ "$(ckptCount)" -ge 1 ]; then
    echo "     ok: $(ckptPath) is on disk"
  else
    note "no checkpoint after an out-of-time stop — the next run starts over"
  fi
else
  note "SETUP: could not get two generations in before the deadline, even at 120s. Not a verdict on the checkpoint."
fi

# ------------------------------------------------------------ search finished
# Generations exhausted is a real completion. Keeping the checkpoint here would
# make every later run resume a search that already answered.
echo "2) a run whose SEARCH FINISHED clears its checkpoint"
clearOurs
log2="$(mktemp)"
train 1 "$log2"
if grep -q "written to trained" "$log2"; then
  if [ "$(ckptCount)" -ge 1 ]; then
    note "checkpoint left behind by a finished search — every later run resumes a finished search forever"
  else
    echo "     ok: it is gone"
  fi
else
  note "SETUP: the run did not finish; see $log2. Not a verdict on the checkpoint."
fi
rm -f "$log2"

# ------------------------------------------------- the hook can actually see it
# The bug that hid the other bug: the checkpoint was deleted immediately BEFORE
# the snapshot hook ran, so the hook could never commit it. This asserts the
# ordering directly — the hook looks for the checkpoint at the moment it is
# called.
echo "3) the snapshot hook sees the checkpoint when it is called"
probedir="$(mktemp -d)"
probe="$probedir/hook.sh"
cat > "$probe" <<'HOOK'
#!/usr/bin/env bash
# Only a checkpoint THIS TEST created counts. GC_FOREIGN lists the ones that
# were already here, so a bystander file cannot make this report PRESENT
# while the run's own checkpoint is missing.
cd "$(dirname "$1")" || exit 0
found=""
for f in $(ls .train-checkpoint.replace.*.json 2>/dev/null); do
  case " $GC_FOREIGN " in *" $f "*) ;; *) found="$f" ;; esac
done
if [ -n "$found" ]; then echo "CHECKPOINT-PRESENT" >> "$GC_PROBE_OUT"
else echo "CHECKPOINT-MISSING" >> "$GC_PROBE_OUT"; fi
exit 0
HOOK
chmod +x "$probe"
probeout="$(mktemp)"
if outOfTimeRun GC_SNAPSHOT_HOOK="$probe" GC_PROBE_OUT="$probeout" GC_FOREIGN="$FOREIGN" GC_SNAPSHOT_EVERY=1; then
  if grep -q CHECKPOINT-PRESENT "$probeout" 2>/dev/null; then
    echo "     ok: the hook found it"
  elif grep -q CHECKPOINT-MISSING "$probeout" 2>/dev/null; then
    note "the hook ran with no checkpoint on disk — it cannot commit what was already deleted"
  else
    note "the snapshot hook never ran at all"
  fi
else
  note "SETUP: could not get two generations in before the deadline. Not a verdict on the hook."
fi
rm -rf "$probedir"; rm -f "$probeout"

# --------------------------------------- a small run must not destroy a big one
# THE ONE THAT ACTUALLY HAPPENED, AND THAT NOTHING HERE COVERED.
#
# training.test.js runs `node train.js 2 8 replace 4 score` — a real
# two-generation search — and the training workflow runs it as a PRE-FLIGHT
# immediately before the five-hour crank, in this very directory. While every
# configuration shared one checkpoint filename, that tiny run overwrote the
# production checkpoint and then, finishing cleanly, deleted it. Run #71
# checked out a valid generation-273 checkpoint, had it destroyed by its own
# harness check, and restarted from generation 1 — with every part of the
# resume machinery working exactly as designed.
#
# The fingerprint is in the FILENAME now, so the two cannot address the same
# file. This asserts that directly: park a long run's checkpoint, run the
# small one to completion on top of it, and require the long one to survive.
echo "5) a DIFFERENT search running here does not destroy this one's checkpoint"
if outOfTimeRun; then
  keep="$(ckptPath)"
  before="$(mktemp)"; cp "$keep" "$before"
  small="$(mktemp)"
  # Exactly what the pre-flight does: two generations of eight, same mode,
  # same directory, run to a clean finish.
  env GC_SEEDS_PER_GEN=1 GC_LEVEL=10 GC_BRAIN=puyo GC_GA_SEED=4242 \
      GC_TAG=checkpoint-test GC_SNAPSHOT_HOOK= \
      node train.js 2 8 "$MODE" 4 score > "$small" 2>&1
  if [ ! -f "$keep" ]; then
    note "a two-generation run DELETED the long run's checkpoint — a five-hour search restarts from generation 1"
  elif ! cmp -s "$keep" "$before"; then
    note "a two-generation run OVERWROTE the long run's checkpoint — it will be rejected on fingerprint and the search restarts"
  else
    echo "     ok: the long run's checkpoint is untouched"
  fi
  rm -f "$before" "$small"
else
  note "SETUP: could not get two generations in before the deadline. Not a verdict on the collision."
fi

echo ""
if [ "$fails" -eq 0 ]; then
  echo "CHECKPOINT TEST OK: out of time keeps it, finishing clears it, the hook can see it, a foreign run cannot destroy it."
  exit 0
fi
echo "CHECKPOINT TEST FAILED: $fails"
exit 1
