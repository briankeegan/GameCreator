#!/bin/bash
# SessionStart hook: catch container-reset git drift.
#
# WHY THIS EXISTS. This repo runs sessions in containers that can get
# reclaimed and replaced mid-conversation — the next turn resumes the same
# chat but with a FRESH checkout that can be far behind whatever the
# previous turn last saw. That's invisible from inside the session: local
# git commands report on local refs, and a fresh checkout looks completely
# consistent with itself. It was found by accident once already — a script
# expected in the working tree simply wasn't there, because local HEAD was
# hundreds of commits behind origin/main after a silent container reset.
# Nothing was actually lost that time (everything had already been pushed),
# but there was no warning either — only luck.
#
# The existing stop-hook (~/.claude/stop-hook-git-check.sh) blocks ending a
# turn with UNPUSHED commits, but a stop-hook cannot catch this: the drift
# happens BETWEEN turns, when the container is replaced, not while a turn
# is ending. Only a check at the START of a turn can see it — hence a
# SessionStart hook instead of extending the stop-hook.
#
# What this does, safely:
#   - local behind origin, no local-only commits  -> fast-forward, report it
#   - local has local-only commits (pushed or not) -> NEVER touch it; just
#     report the gap so a person/agent can look before doing anything
#   - can't fetch (offline, no remote)             -> say so and exit clean
#
# It never resets, rebases, or discards anything — a diverged or
# ahead-of-origin branch is reported, not "fixed", because guessing wrong
# here means losing real work.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

if [ -z "$(git remote 2>/dev/null)" ]; then
  exit 0
fi

current_branch="$(git branch --show-current 2>/dev/null)"
if [ -z "$current_branch" ]; then
  exit 0
fi

if ! git fetch origin "$current_branch" main --quiet 2>/tmp/gc-session-sync-fetch-err; then
  echo "session-start-git-sync: could not fetch origin (offline?) — skipping drift check." >&2
  cat /tmp/gc-session-sync-fetch-err >&2 2>/dev/null
  exit 0
fi

check_branch() {
  local branch="$1"
  local upstream="origin/$branch"

  git rev-parse -q --verify "$upstream" >/dev/null 2>&1 || return 0

  local local_sha
  if [ "$branch" = "$current_branch" ]; then
    local_sha="$(git rev-parse HEAD)"
  else
    git rev-parse -q --verify "refs/heads/$branch" >/dev/null 2>&1 || return 0
    local_sha="$(git rev-parse "refs/heads/$branch")"
  fi
  local remote_sha
  remote_sha="$(git rev-parse "$upstream")"

  if [ "$local_sha" = "$remote_sha" ]; then
    return 0
  fi

  local ahead behind
  ahead="$(git rev-list --count "$upstream..$local_sha" 2>/dev/null || echo 0)"
  behind="$(git rev-list --count "$local_sha..$upstream" 2>/dev/null || echo 0)"

  if [ "$ahead" -gt 0 ]; then
    echo "session-start-git-sync: '$branch' has $ahead local-only commit(s) not on $upstream (and is $behind behind it) — NOT touching this automatically. If this is a container-reset drift rather than real unpushed work, investigate before pushing or resetting." >&2
    return 0
  fi

  if [ "$behind" -gt 0 ]; then
    if [ "$branch" = "$current_branch" ]; then
      if git merge --ff-only "$upstream" --quiet 2>/tmp/gc-session-sync-ff-err; then
        echo "session-start-git-sync: '$branch' was $behind commit(s) behind $upstream (likely a container reset) — fast-forwarded to $remote_sha." >&2
      else
        echo "session-start-git-sync: '$branch' is $behind commit(s) behind $upstream but fast-forward failed (uncommitted changes in the way?) — left untouched, review manually." >&2
        cat /tmp/gc-session-sync-ff-err >&2 2>/dev/null
      fi
    else
      echo "session-start-git-sync: local branch '$branch' is $behind commit(s) behind $upstream. Not checked out, so not auto-updated — run 'git fetch origin $branch' before trusting it." >&2
    fi
  fi
}

check_branch "$current_branch"
if [ "$current_branch" != "main" ]; then
  check_branch "main"
fi

exit 0
