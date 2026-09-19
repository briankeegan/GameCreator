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

# Damage whatever weight is actually FIRST in the file. Naming one (this
# said `roughness`) silently stops damaging anything the moment the shipped
# bot is trained on a feature set without it, and a test that edits nothing
# reports the checker missed a defect that was never introduced.
_rt=$(grep -oE '^      [a-zA-Z]+: -?[0-9]+' "$G/ai/trained-weights.js" | head -1 | tr -d ' ' | cut -d: -f1)
[ -n "$_rt" ] || { echo "  SETUP: no weights found in trained-weights.js"; exit 1; }
sed -i "s/${_rt}: -\?[0-9]*/${_rt}: 249/" "$G/ai/trained-weights.js"
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

# The measuring tools, which are as load-bearing as the game: every number
# in this project's arguments comes out of one of them, and a tool that
# resolves switches for itself prints a confident score for a bot that does
# not exist.
rm -f "$G/ai/eval/switches.js"
try "ai/eval/switches.js deleted"
cp "$SRC/games/the-game/ai/eval/switches.js" "$G/ai/eval/"

sed -i "s|require('./switches.js')|require('./registry.js')|" "$G/ai/eval/behaviour.js"
try "behaviour.js stops loading switches.js"
cp "$SRC/games/the-game/ai/eval/behaviour.js" "$G/ai/eval/"

sed -i "s|var DENSITY = loaded.switches.density;|var DENSITY = process.env.GC_DENSITY === '1';|" \
    "$G/ai/eval/puzzles.bench.js"
try "puzzles.bench.js goes back to reading GC_DENSITY itself"
cp "$SRC/games/the-game/ai/eval/puzzles.bench.js" "$G/ai/eval/"

echo "$pass caught, $missed missed"

# ---------------------------------------------------------------------------
# BEAM 0 IS A VALUE, NOT AN ABSENCE.
#
# beam 0 means expand every candidate. export_weights.js read it as
# `snap.beam || 6`, so a snapshot trained on a full search shipped switches
# saying beam 6 — the weights would run against a search they never saw,
# which is the one thing the switches object exists to prevent. Both the
# export and the checker use the same code, so nothing else could catch it.
echo "== beam 0 survives the export =="
_bw_dir=$(cd "$(dirname "$0")/../../games/the-game/ai/eval" && pwd)
_bw_snap="$_bw_dir/.beam-zero.test.json"
cat > "$_bw_snap" <<'JSON'
{ "mode":"pbt","updates":1000,"depth":2,"beam":0,"rise":true,"density":false,
  "features":["linksH"],"weights":{"linksH":5},
  "holdout":{"learned":{"fitness":1,"winRate":1,"duels":12},"shipped":{"fitness":0}} }
JSON
# Exported to a scratch file, never over the bot the game loads.
_bw_ship="$_bw_dir/.beam-zero.test.out.js"
(cd "$_bw_dir" && node export_weights.js "$_bw_snap" "$_bw_ship" >/dev/null 2>&1) || true
_bw_out=$(grep -o '"beam":[0-9]*' "$_bw_ship" 2>/dev/null | head -1)
rm -f "$_bw_snap" "$_bw_ship"
if [ "$_bw_out" = '"beam":0' ]; then
  echo "  ok   a snapshot with beam 0 ships beam 0"
else
  echo "  FAIL a snapshot with beam 0 shipped $_bw_out — 0 was read as absent"
  missed=$((missed+1))
fi

# ONE verdict, at the end. The damage count used to decide the exit status
# here, with sections after it, so anything added below silently overwrote it.
[ "$missed" -eq 0 ]
