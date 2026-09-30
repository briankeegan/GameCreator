#!/usr/bin/env bash
# RUN THE DUELS AGAINST A PINNED TREE.
#
# roundrobin.js needs --root pointed at the GAME directory and a tree that is
# not being edited while it reads it. Both were being typed by hand every run;
# a wrong root made every child die on a require and the tally read as a clean
# sweep. Neither is typed here.
#
#   ./roundrobin.sh                  the boards that have died, at HEAD
#   ./roundrobin.sh all              all 15 pairings x 2 seeds
#   ./roundrobin.sh known <ref>      a set at some other commit
#
# Exits 1 if STARTER or ZERO died, 2 if a pairing did not run.
set -euo pipefail

# THE BOARDS THAT HAVE DIED, in one place rather than in a shell history. Add
# to this when a new one dies; that is what makes the next run comparable.
KNOWN=(101:rand2:rand3 101:rand2:rand4 103:rand2:rand3 103:STARTER:rand3
       103:rand1:rand2 103:rand1:rand4 103:STARTER:rand1)

SET="${1:-known}"
REF="${2:-HEAD}"
REPO="$(git rev-parse --show-toplevel)"
SHA="$(git -C "$REPO" rev-parse --short=10 "$REF")"

if [ -n "$(git -C "$REPO" status --porcelain)" ] && [ "$REF" = "HEAD" ]; then
    echo "roundrobin: the tree is dirty. Commit first -- a run measures the"
    echo "            commit it names, and this one would not be reproducible." >&2
    exit 2
fi

WT="$(mktemp -d)/wt"
cleanup() { git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT
git -C "$REPO" worktree add -q --detach "$WT" "$SHA"

GAME="$WT/games/the-game"
echo "roundrobin: $SET at $SHA"
case "$SET" in
    all)   exec node "$GAME/ai/eval/roundrobin.js" --root "$GAME" ;;
    known) exec node "$GAME/ai/eval/roundrobin.js" --root "$GAME" "${KNOWN[@]}" ;;
    *)     echo "roundrobin: unknown set '$SET' (known|all)" >&2; exit 2 ;;
esac
