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
#   ./manage-games.sh add <game-id> "<Display Name>" <secret-word> <issue-number>
#   ./manage-games.sh remove <game-id>
#   ./manage-games.sh list
set -euo pipefail

: "${GC_WORKER_URL:?Set GC_WORKER_URL to the deployed Worker URL}"
: "${GC_ADMIN_TOKEN:?Set GC_ADMIN_TOKEN to the Worker's ADMIN_TOKEN secret}"

cmd="${1:-}"

case "$cmd" in
  add)
    game="${2:?game id required}"
    name="${3:?display name required}"
    secret="${4:?secret word required}"
    issue="${5:?github issue number required}"
    curl -sS -X POST "$GC_WORKER_URL" \
      -H "Content-Type: application/json" \
      -d "$(node -e '
        const [,, adminToken, game, name, secretWord, issueNumber] = process.argv;
        console.log(JSON.stringify({
          action: "admin-upsert",
          adminToken, game, name, secretWord,
          issueNumber: Number(issueNumber),
        }));
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
