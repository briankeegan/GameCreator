#!/usr/bin/env bash
# COMMIT ONE SNAPSHOT. Called by train.js through GC_SNAPSHOT_HOOK, with the
# scratch result file and the generation number.
#
# train.js does not know about git and should not learn — it writes
# trained.<mode>.json and calls whoever asked to be told. This is the crank's
# answer to being told: give the snapshot a name no other run can claim, and
# get it off this machine.
#
# NAMED, BECAUSE THE SCRATCH FILE IS OVERWRITTEN. Every snapshot writes
# trained.<mode>.json, so a snapshot kept under that name is a snapshot
# waiting to be silently replaced by the next one thirty generations later.
# TESTING THIS? SET THE IDENTITY IN THE ENVIRONMENT, NEVER WITH `git config`.
# A git worktree SHARES the repository's config file, so a test that ran
# `git config user.email t@t` inside a throwaway worktree rewrote the REAL
# repo's identity, and the next real commit went out authored as "t@t" —
# which GitHub shows as Unverified. Use GIT_AUTHOR_EMAIL / GIT_COMMITTER_EMAIL
# instead: they are per-process and cannot leak into the checkout.
set -u
cd "$(dirname "$0")" || exit 0
src="${1:-}"; gen="${2:-0}"
[ -f "$src" ] || { echo "    (no snapshot at $src)"; exit 0; }

: "${GC_RUN_ID:=$(date -u +%m%d-%H%M%S)}"
: "${GC_TAG:=untagged}"
: "${GC_MIN_POP:=50}"

pop=$(node -e "try{process.stdout.write(String(require('$PWD/$(basename "$src")').population||0))}catch(e){process.stdout.write('0')}" 2>/dev/null)
out="trained.${GC_MODE:-replace}.${GC_TAG}.${GC_RUN_ID}.g$(printf '%05d' "$gen").json"
cp "$src" "$out"

# A SMOKE RUN IS NOT A RESULT — same rule as before, same reason. `./crank.sh
# 8 1` is how this gets exercised, and it writes snapshots exactly like a real
# search does. In git log they are indistinguishable from the real thing.
if [ "${pop:-0}" -lt "$GC_MIN_POP" ]; then
  # ...AND IT DOES NOT GET TO LOOK LIKE ONE ON DISK EITHER. Leaving the file
  # there was the wrong half-measure: it is named exactly like a real snapshot,
  # so anything reading snapshots by filename would fold a population-32 smoke
  # run in among the real searches. It also leaves the repo dirty after every
  # smoke run, which trains whoever is watching to ignore that warning.
  #
  # Renamed rather than deleted — a smoke run is still worth reading right
  # after it finishes — and .smoke.json is gitignored, so it cannot be
  # committed by accident or mistaken for a result.
  smoke="${out%.json}.smoke.json"
  mv "$out" "$smoke"
  echo "    (smoke-sized run: population ${pop} — NOT committed; kept as $smoke)"
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "    !! not a git repo — $out exists only on disk"; exit 0
fi
# THE CHECKPOINT RIDES ALONG, OR THE RUN CANNOT CONTINUE.
#
# A snapshot is the champion; the CHECKPOINT is the whole population, and it
# is what lets the next job carry on instead of starting over. It was
# gitignored, which is right for a machine with a persistent disk and wrong
# for a GitHub runner: every job checks out fresh, finds no checkpoint, and
# begins at generation 1. Run #64 reached generation 129 in five and a half
# hours; the run after it opened at generation 30 of a brand new search, and
# the workflow header meanwhile promised it "resumes at the generation the
# last one stopped on". At that rate convergence near generation 330 is never
# reached, however many hours are spent.
#
# So it is force-added past the ignore rule, alongside the snapshot, in the
# same commit and the same push. It is one file that is overwritten rather
# than accumulated, and train.js already refuses a checkpoint whose config
# fingerprint does not match — so a stale or foreign one is ignored, not
# resumed into.
# The name now carries a hash of the search's fingerprint (train.js
# checkpointPath), so a small run in this directory cannot address — and
# therefore cannot clobber or delete — a long run's resume point. That means
# globbing rather than naming one file. Any checkpoint present belongs to a
# search that is still going; a finished one deletes its own.
# The Puyo loop names its resume point .versus-checkpoint.<hash>.json rather
# than .train-checkpoint.<mode>.<hash>.json, so it needs its own glob or the
# loop's population never leaves the runner.
# The islands keep a file per island under this run's own .<GC_TAG>/; all of
# them together are the resume point, so all of them ride along.
#
# THIS RUN'S DIRECTORY, NOT EVERY DIRECTORY. A glob over .pbt-*/ adds every
# other run's island files as well, so a checkout holding a stale copy of a
# sibling's population commits it back over the newer one -- the same
# clobbering the per-tag directories exist to stop, arriving by a different
# door. A run commits what it wrote and nothing else.
island_dir=".${GC_TAG:-pbt-${GC_GA_SEED:-11}}"
for ckpt in .train-checkpoint.${GC_MODE:-replace}.*.json .versus-checkpoint.*.json "$island_dir"/island*.json; do
  [ -f "$ckpt" ] && git add -f "$ckpt" 2>/dev/null
done

if ! git add -f "$out" 2>/dev/null || \
   ! git commit -q -m "$(printf 'Snapshot: generation %s of %s (%s)\n\nWritten by train.js and committed on the spot, so a restart cannot take\nit. Scores and provenance are in the file itself.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
                        "$gen" "$GC_TAG" "$GC_RUN_ID")" 2>/dev/null; then
  echo "    !! COULD NOT COMMIT $out — this snapshot exists only on disk"; exit 0
fi

# REBASE BEFORE PUSHING. A search runs for hours; anything that lands on the
# branch meanwhile leaves this checkout behind and the push is rejected as a
# non-fast-forward. Guarded, that would print one line and carry on, so hours
# of snapshots would be committed locally and lost when the machine is
# recycled. Champion commits are independent files that cannot conflict, so
# replaying them on top is safe and keeps the branch linear.
#
# AND RETRY, BECAUSE THE RACE IS THE NORMAL CASE WHEN SEARCHES FAN OUT. One
# fetch-rebase-push is enough while a single chain is running: nothing else is
# pushing. Run thirty-five searches at once, each snapshotting every ten
# minutes, and two of them rebase inside the same window routinely -- one
# wins, the other is rejected, prints a line and gives up, and that champion
# exists only on a container that gets recycled. Losing a snapshot is losing
# the hours that made it.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
pushed=""
for attempt in 1 2 3 4 5; do
  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    git fetch -q origin "$branch" 2>/dev/null && \
      git rebase -q "origin/$branch" 2>/dev/null || git rebase --abort 2>/dev/null
  fi
  if git push -q origin HEAD 2>/dev/null; then pushed="yes"; break; fi
  # Jittered, so two losers of the same race do not collide again in step.
  sleep $(( attempt * 2 + (RANDOM % 4) ))
done
[ -n "$pushed" ] || \
  echo "    (snapshot committed but NOT pushed after 5 tries — it survives a restart, not a lost container)"
exit 0
