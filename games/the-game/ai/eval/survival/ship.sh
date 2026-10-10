#!/bin/bash
# THE SOURCE OUT, THE SCAN STARTED, THE WASM REBUILT, under one lock: git and
# the build are touched by one loop at a time (loop.sh takes the same lock to
# commit a scan's line), so no pull meets a half-written build and no reset
# wipes another loop's output
set -e
HERE=$(cd "$(dirname "$0")" && pwd); S=${GC_WORK:-/tmp/gc-survival}; mkdir -p "$S"
cd "$(git -C "$HERE" rev-parse --show-toplevel)"
TRAILER=$(cat "$S/trailer.txt" 2>/dev/null || true)
until mkdir $S/ship.lock 2>/dev/null; do sleep 5; done; trap "rmdir $S/ship.lock" EXIT
git checkout -q games/the-game/ai/eval/native/BUILT games/the-game/ai/eval/native/bit-mt.wasm games/the-game/ai/eval/native/bit.wasm 2>/dev/null || true
if [ -n "$1" ]; then
  # every tracked source the change touched, never the build or a scan's line
  git add -u -- games/the-game/ai/eval ':!games/the-game/ai/eval/native/BUILT' ':!games/the-game/ai/eval/native/*.wasm' ':!games/the-game/ai/eval/survival_scans.tsv'
  if git diff --cached --quiet; then echo "nothing to ship"; exit 1; fi
  # a change said to be the bot's carries a file of the bot's: a message that names it over a diff that does not is a failed edit
  case "$1" in BitBot*) git diff --cached --name-only | grep -q 'ai/eval/native/.*\.[ch]$' || { echo "REFUSED: '$1' changes no file under ai/eval/native"; git reset -q; exit 1; };; esac
  git commit -q -m "$1

$TRAILER"
  git pull -q --rebase --autostash origin main
  git push -q origin HEAD:main
  gh api -X POST repos/briankeegan/GameCreator/actions/workflows/ai-survival-scan.yml/dispatches -f ref=main ${GC_FRAMES:+-f inputs[frames]=$GC_FRAMES}
  echo "pushed $(git rev-parse --short HEAD), scan dispatched"
  git show --stat --format= HEAD | sed 's/^/  changed: /' | tail -4
fi
# the wasm is for the live game; the scan builds its own library from the source.
# It is rebuilt once, when a batch of work is done: REBUILD=1 ship.sh
if [ -n "$REBUILD" ]; then
  N=games/the-game/ai/eval/native; stashed=0
  if ! git diff --quiet -- $N/bot.c $N/front.c $N/pa.c $N/bit.c; then git stash push -q -- $N/bot.c $N/front.c $N/pa.c $N/bit.c && stashed=1; fi
  (cd $N && ./build.sh >/dev/null 2>&1)
  git add $N/BUILT $N/*.wasm
  git diff --cached --quiet || git commit -q -m "Rebuild BitBot wasm

$TRAILER"
  git pull -q --rebase --autostash origin main
  git push -q origin HEAD:main
  [ $stashed = 1 ] && git stash pop -q
fi
echo "done $(git rev-parse --short HEAD)"
