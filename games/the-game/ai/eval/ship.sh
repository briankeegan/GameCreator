#!/usr/bin/env bash
# SHIP THE WINNER INTO THE GAME. One command, at the end of a search.
#
#   ./ship.sh                     the newest snapshot on disk
#   ./ship.sh <snapshot.json>     a specific one
#
# WHAT IT DOES, in order, stopping at the first failure:
#   1. picks the snapshot and shows what it scored, so the number that is
#      about to become the shipped bot is on screen before it becomes it;
#   2. runs export_weights.js, which GENERATES ../trained-weights.js — the
#      file the game loads — carrying the weights, the switches they were
#      found under, the snapshot's name and its held-out score;
#   3. runs the full gates, including check_shipped_weights.mjs, which
#      re-does the export and fails if what is committed differs.
#
# WHY A SCRIPT FOR TWO COMMANDS. Because the second one is the one that gets
# skipped. Weights describe a bot AND the switches it was found under — the
# shipped set scores 14780 under depth 1 and 2550 under depth 2 — so shipping
# is not "copy the numbers across", and every part of that is already
# automated. This just makes the whole of it the default thing to type.
#
# It does NOT commit. Look at the diff, then commit it yourself.
set -e
cd "$(dirname "$0")"

snap="${1:-}"
if [ -z "$snap" ]; then
  # Newest REAL snapshot: .smoke.json is a sample run and must never ship.
  snap=$(ls -t trained.*.g[0-9]*.json 2>/dev/null | grep -v '\.smoke\.json$' | head -1)
fi
[ -n "$snap" ] && [ -f "$snap" ] || { echo "no snapshot to ship (looked for trained.*.gNNNNN.json)"; exit 1; }

echo "=== shipping $snap ==="
node -e '
var d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
var h = d.holdout || {};
console.log("  held-out learned : " + Math.round((h.learned||{}).fitness || 0));
console.log("  held-out shipped : " + Math.round((h.shipped||{}).fitness || 0));
console.log("  loses to shipped on: " + ((d.lostCategories||[]).join(", ") || "nothing"));
console.log("  switches         : depth " + d.depth + " beam " + d.beam +
            " rise " + (d.rise ? "on" : "off") + " density " + (d.density ? "on" : "off"));
console.log("  features         : " + Object.keys(d.weights||{}).length);
' "$snap"

echo
echo "=== writing ../trained-weights.js ==="
node export_weights.js "$snap"

echo
echo "=== gates ==="
( cd ../../../.. && source .github/scripts/gates.sh && gate_all )

echo
echo "=== done. Review and commit: ==="
git -C ../../../.. --no-pager diff --stat -- games/the-game/ai/trained-weights.js || true
