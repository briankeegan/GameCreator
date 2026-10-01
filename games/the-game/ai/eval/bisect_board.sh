#!/usr/bin/env bash
# WHICH COMMIT BROKE THIS BOARD.
#
#   ./bisect_board.sh <seed:A:B> <ref> [ref...]
#   ./bisect_board.sh 103:STARTER:rand3 HEAD~5 HEAD~4 HEAD~3 HEAD
#
# Runs ONE pairing at each ref, in parallel, and prints a row per ref: who died and
# when, and the garbage each side broke. A death moving between sides reads as a
# death, not as a fix, which is the mistake it exists to stop -- six changes to the
# raise target each "fixed" a board by killing the other side of it.
#
# Each ref gets its own pinned worktree, because roundrobin.js must not read a tree
# that is being edited. They are removed on exit, including on interrupt: a run that
# leaked one worktree per invocation filled the disk at 51 of them, 14GB, and the
# next 60-board run died on "No space left on device".
set -uo pipefail

if [ $# -lt 2 ]; then
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
fi

PAIR="$1"; shift
REPO="$(git rev-parse --show-toplevel)"
BASE="$(mktemp -d)"
WTS=()

cleanup() {
    for w in ${WTS+"${WTS[@]}"}; do git -C "$REPO" worktree remove --force "$w" 2>/dev/null; done
    git -C "$REPO" worktree prune 2>/dev/null
    rm -rf "$BASE"
}
trap cleanup EXIT INT TERM

echo "bisecting $PAIR over $# refs"
PIDS=()
for ref in "$@"; do
    sha="$(git -C "$REPO" rev-parse --short=10 "$ref" 2>/dev/null)" || { echo "  $ref: no such ref"; continue; }
    wt="$BASE/$sha"
    git -C "$REPO" worktree add --detach -q "$wt" "$sha" || { echo "  $ref: worktree failed"; continue; }
    WTS+=("$wt")
    (
        out="$(node "$wt/games/the-game/ai/eval/roundrobin.js" --root "$wt/games/the-game" \
               --one "$PAIR" 2>&1 | grep -E "^seed|^  \[1/1\]")"
        printf '%s\t%s\t%s\n' "$ref" "$sha" "$out" > "$BASE/$sha.row"
    ) &
    PIDS+=($!)
done
for p in ${PIDS+"${PIDS[@]}"}; do wait "$p"; done

echo
printf '%-12s %-12s %s\n' REF SHA RESULT
FAILED=0
for ref in "$@"; do
    sha="$(git -C "$REPO" rev-parse --short=10 "$ref" 2>/dev/null)" || continue
    row="$BASE/$sha.row"
    if [ ! -s "$row" ]; then printf '%-12s %-12s %s\n' "$ref" "$sha" "NO RESULT -- the run produced nothing"; FAILED=1; continue; fi
    res="$(cut -f3 "$row")"
    printf '%-12s %-12s %s\n' "$ref" "$sha" "$res"
    case "$res" in *DEAD*) FAILED=1;; esac
done
exit $FAILED
