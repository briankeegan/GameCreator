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
  # so compare_runs.js would read a population-32 smoke run into the same
  # group as real searches and compute a noise floor from it. It also leaves
  # the repo dirty after every smoke run, which trains whoever is watching to
  # ignore that warning.
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
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
  git fetch -q origin "$branch" 2>/dev/null && \
    git rebase -q "origin/$branch" 2>/dev/null || git rebase --abort 2>/dev/null
fi
git push -q origin HEAD 2>/dev/null || \
  echo "    (snapshot committed but NOT pushed — it survives a restart, not a lost container)"
exit 0
