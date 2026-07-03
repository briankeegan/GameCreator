#!/usr/bin/env bash
# Add, update, remove, or list games' clubhouse config — without ever
# touching the Cloudflare dashboard. Talks to the already-deployed shared
# Worker's admin-* actions (KV-backed, no redeploy needed).
#
# Setup (once):
#   export GC_WORKER_URL="https://gamecreator-clubhouse.<you>.workers.dev"
#   export GC_ADMIN_TOKEN="<the ADMIN_TOKEN secret you set on the Worker>"
#
# Usage:
#   ./manage-games.sh add <game-id> "<Display Name>" <secret-word> [issue-number]
#     Omit issue-number the first time — the Worker creates the GitHub Issue
#     (the chat thread) for you. Pass it to point at an existing Issue instead.
#     Re-running for the same game-id (e.g. to change the secret word) keeps
#     whichever Issue it already has.
#   ./manage-games.sh remove <game-id>
#   ./manage-games.sh list
#
# The admin page (admin/index.html on the live site) does the same thing
# with a form instead of a terminal — use whichever's easier.
set -euo pipefail

: "${GC_WORKER_URL:?Set GC_WORKER_URL to the deployed Worker URL}"
: "${GC_ADMIN_TOKEN:?Set GC_ADMIN_TOKEN to the Worker's ADMIN_TOKEN secret}"

cmd="${1:-}"

case "$cmd" in
  add)
    game="${2:?game id required}"
    name="${3:?display name required}"
    secret="${4:?secret word required}"
    issue="${5:-0}"
    curl -sS -X POST "$GC_WORKER_URL" \
      -H "Content-Type: application/json" \
      -d "$(node -e '
        const [,, adminToken, game, name, secretWord, issueNumber] = process.argv;
        const payload = { action: "admin-upsert", adminToken, game, name, secretWord };
        if (Number(issueNumber)) payload.issueNumber = Number(issueNumber);
        console.log(JSON.stringify(payload));
      ' "$GC_ADMIN_TOKEN" "$game" "$name" "$secret" "$issue")"
    echo
    ;;
  remove)
    game="${2:?game id required}"
    curl -sS -X POST "$GC_WORKER_URL" \
      -H "Content-Type: application/json" \
      -d "{\"action\":\"admin-remove\",\"adminToken\":\"$GC_ADMIN_TOKEN\",\"game\":\"$game\"}"
    echo
    ;;
  list)
    curl -sS -X POST "$GC_WORKER_URL" \
      -H "Content-Type: application/json" \
      -d "{\"action\":\"admin-list\",\"adminToken\":\"$GC_ADMIN_TOKEN\"}"
    echo
    ;;
  *)
    echo "Usage: $0 {add|remove|list} ..." >&2
    exit 1
    ;;
esac
