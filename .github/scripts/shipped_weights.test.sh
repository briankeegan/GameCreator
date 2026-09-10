#!/usr/bin/env bash
# DOES THE SHIPPED-WEIGHTS GATE ACTUALLY FIRE? Run: .github/scripts/shipped_weights.test.sh
#
# "A gate that cannot fail is worse than no gate" — every art check in this
# repo once ran on every push and none of them could fail. So this breaks the
# shipped bot four ways and fails if the checker passes any of the damage.
#
# IT RUNS ON A COPY, AND THAT IS THE POINT OF THIS HEADER. The first version
# damaged the real working tree twice in five minutes. First it restored with
# one `git checkout --` over three paths, one of which was the GENERATED
# trained-weights.js — untracked on the commit that introduced it — so git
# failed the whole command and restored nothing, while the test still
# reported "4 caught, 0 missed" because catching the damage is all it
# measures. Then, restoring path by path, it reverted index.html and sw.js to
# HEAD and silently threw away the uncommitted wiring the test existed to
# check. Same lesson as .claude/hooks/resume-training.test.sh, which killed a
# live training run before it was sandboxed: a test that mutates the thing it
# is testing will eventually destroy work, and "it passed" is not evidence
# that it didn't.
set -u
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Copy only what the checker reads — a full clone of the repo is slow and the
# art directories are large.
mkdir -p "$WORK/.github/scripts" "$WORK/games/the-game/ai/eval"
cp "$SRC/.github/scripts/check_shipped_weights.mjs" "$WORK/.github/scripts/"
cp "$SRC/games/the-game/index.html" "$SRC/games/the-game/sw.js" \
   "$SRC/games/the-game/duel.js" "$WORK/games/the-game/"
cp "$SRC/games/the-game/ai/trained-weights.js" "$WORK/games/the-game/ai/"
cp "$SRC/games/the-game/ai/eval/"*.js "$WORK/games/the-game/ai/eval/" 2>/dev/null
cp "$SRC/games/the-game/ai/eval/"*.json "$WORK/games/the-game/ai/eval/" 2>/dev/null

G="$WORK/games/the-game"
SNAP=$(sed -n 's/.*source: "\(.*\)".*/\1/p' "$G/ai/trained-weights.js")
pass=0; missed=0

check() { ( cd "$WORK" && node .github/scripts/check_shipped_weights.mjs . ) >/dev/null 2>&1; }
try() {
  if check; then echo "  NOT CAUGHT: $1"; missed=$((missed+1));
  else echo "  caught:     $1"; pass=$((pass+1)); fi
}
# Restore inside the COPY, from the pristine source.
restore() {
  cp "$SRC/games/the-game/index.html" "$SRC/games/the-game/sw.js" "$G/"
  cp "$SRC/games/the-game/ai/trained-weights.js" "$G/ai/"
}

# The checker must PASS on the real thing first, or every "caught" below is
# meaningless — a checker that rejects everything catches everything.
if ! check; then
  echo "  the checker rejects the UNDAMAGED repo; nothing below means anything"
  ( cd "$WORK" && node .github/scripts/check_shipped_weights.mjs . )
  exit 1
fi
echo "  accepts:    the shipped bot as committed"

sed -i 's/roughness: [0-9]*/roughness: 249/' "$G/ai/trained-weights.js"
try "a single weight retyped"
restore

sed -i '/ai\/eval\/evaluator.js/d' "$G/index.html"
try "index.html stops loading evaluator.js"
restore

sed -i '/".\/ai\/eval\/puyocpu.js",/d' "$G/sw.js"
try "sw.js stops caching puyocpu.js (breaks offline only)"
restore

python3 - "$G/index.html" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding='utf-8').read()
a = '  <script src="ai/eval/features.js"></script>\n'
b = '  <script src="ai/eval/puyocpu.js"></script>\n'
s = s.replace(a, '@@A@@').replace(b, '@@B@@').replace('@@A@@', b).replace('@@B@@', a)
io.open(p, 'w', encoding='utf-8').write(s)
PY
try "load order reversed (puyocpu before features)"
restore

echo "$pass caught, $missed missed"
[ "$missed" -eq 0 ]
