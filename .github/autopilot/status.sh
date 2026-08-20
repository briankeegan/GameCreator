#!/usr/bin/env bash
# Live progress for a Clubhouse thread: ONE comment on the PR, edited in place
# as the run goes, so a human can see the thing is alive long before the final
# reply lands.
#
#   .github/autopilot/status.sh "generating the garden's floor plate"
#
# Why one edited comment and not one comment per step: a run touches a dozen
# checkpoints, and a dozen notifications per message would make the thread
# unusable. Edits are silent.
#
# Why it is a SHELL SCRIPT and not something the model writes: the model
# announcing its own progress is exactly the report that cannot be trusted —
# earlier runs reported success on art that had not changed. These lines are
# emitted by the workflow steps and by the image tools themselves
# (.github/art/imagegen.py calls this via GC_STATUS_HOOK), so a line means the
# thing actually happened.
#
# Needs: GH_TOKEN, GC_STATUS_PR (the PR number), and a writable .autopilot/.
# Missing any of them, it prints to stdout and exits 0 — a status line must
# never be the reason a run fails.
set -uo pipefail

line="${*:-}"
[ -n "$line" ] || exit 0
echo "[status] $line"

[ -n "${GC_STATUS_PR:-}" ] || exit 0
command -v gh >/dev/null 2>&1 || exit 0

log=".autopilot/status.log"
id_file=".autopilot/status_id"
mkdir -p .autopilot
printf -- '- %s\n' "$line" >> "$log"

body="$(printf '**Claude is working:**\n\n%s\n\n_Live progress — this comment updates as the run goes. The reply comes at the end._' "$(cat "$log")")"

if [ -s "$id_file" ]; then
  gh api --silent -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/$(cat "$id_file")" \
     -f body="$body" 2>/dev/null && exit 0
  # If the edit fails (comment deleted, token scope), fall through and make a
  # new one rather than losing the progress entirely.
  : > "$id_file"
fi

gh api "repos/${GITHUB_REPOSITORY}/issues/${GC_STATUS_PR}/comments" \
   -f body="$body" --jq '.id' > "$id_file" 2>/dev/null || true
exit 0
