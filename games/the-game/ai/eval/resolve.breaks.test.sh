#!/usr/bin/env bash
# CAN THE FIDELITY CHECK FAIL? THREE WAYS, ONE PER FAULT IT FIXED.
#
# resolve_fidelity.js reporting 100% is only worth something if 100% is hard to
# get. LogicalBoard agreed with the engine on nothing at all before three
# separate corrections, so each one is put back here and the check must reject
# it. A check that cannot fail reads exactly like a board that is correct.
#
# Runs in a sandbox copy — a break test that edits the real file is one aborted
# run away from leaving the repo damaged, which has happened here before.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
EVAL="$WORK/games/the-game/ai/eval"
mkdir -p "$EVAL"
cp "$HERE/../../panel-engine.js" "$HERE/../../panel-cpu.js" "$WORK/games/the-game/" || exit 2
cp "$HERE"/*.js "$HERE"/realboards.json "$EVAL/" || exit 2

pass=0; missed=0
# $1 name, $2 sed expression against panel-cpu.js
try() {
  cp "$HERE/../../panel-cpu.js" "$WORK/games/the-game/panel-cpu.js"
  if ! sed -i "$2" "$WORK/games/the-game/panel-cpu.js"; then
    echo "  BROKEN TEST: the break did not apply: $1"; exit 2
  fi
  if ( cd "$EVAL" && GC_FIDELITY_FLOOR=1 node resolve_fidelity.js boards 400 ) >/dev/null 2>&1; then
    echo "  NOT CAUGHT: $1"; missed=$((missed+1))
  else
    echo "  caught:     $1"; pass=$((pass+1))
  fi
}

# Sanity: unbroken, the check must PASS from the sandbox, or nothing below means
# anything.
cp "$HERE/../../panel-cpu.js" "$WORK/games/the-game/panel-cpu.js"
if ! ( cd "$EVAL" && GC_FIDELITY_FLOOR=1 node resolve_fidelity.js boards 400 ) >/dev/null 2>&1; then
  echo "  the fidelity check does not pass on an unbroken copy; nothing below means anything"
  ( cd "$EVAL" && GC_FIDELITY_FLOOR=1 node resolve_fidelity.js boards 400 ) | tail -5
  exit 1
fi
echo "  accepts:    the simulation as written"

# FAULT 1 — panels teleport. Settle the board fully between rounds instead of
# falling a row at a time, and groups that landed frames apart merge into one.
try "gravity run to completion between rounds, not a row at a time" \
    's/var movedPanels = this._dropRealPanelsOneRow(chaining);/var movedPanels = this._dropRealPanels();/'

# FAULT 2 — a falling panel allowed to match. Drop the resting test and a match
# fires a tick early, inventing a combo the engine never makes.
try "panels matched while still in the air" \
    's/var matched = this._findMatches(true);/var matched = this._findMatches(false);/'

# FAULT 3 — rounds counted as chain links. Two separate combos popping frames
# apart are not a 2-chain, and only the chaining flag can tell them apart.
try "chain depth counted as ROUNDS rather than by the chaining flag" \
    's/var depth = comboSizes.length ? Math.max(counter, 1) : 0;/var depth = chainLength;/'

# FAULT 4 — matched panels deleted on the spot. In the engine a popping panel
# holds up whatever sits on it for dozens of frames; deleting it immediately
# drops those panels early and a match that was about to complete never does.
#
# THIS ONE IS INVISIBLE ON REAL BOARDS. All 50,797 real board/swap pairs agreed
# before the fix and after it — the fault only shows on the deep cascade shapes
# the chip library is made of, where it cost 28 templates. So it is broken
# against the CHIPS, which is also why that comparison exists.
cp "$HERE/../../panel-cpu.js" "$WORK/games/the-game/panel-cpu.js"
python3 - "$WORK/games/the-game/panel-cpu.js" <<'BREAK' || exit 2
import io, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8').read()
old = "      for (k in matched) this._popping[matched[k][0] + ':' + matched[k][1]] = matched[k];"
new = "      for (k in matched) this.grid[matched[k][0]][matched[k][1]] = 0;"
if old not in s:
    sys.stderr.write('break anchor missing — the test is stale\n'); sys.exit(2)
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
BREAK
cp -r "$HERE/chips" "$EVAL/" 2>/dev/null
if ( cd "$EVAL" && GC_COMPARE_SIM=1 node verify_chips_engine.js ) >/dev/null 2>&1; then
  echo "  NOT CAUGHT: matched panels removed instantly instead of after the board rests"
  missed=$((missed+1))
else
  echo "  caught:     matched panels removed instantly instead of after the board rests"
  pass=$((pass+1))
fi

echo ""
echo "$pass caught, $missed missed"
[ "$missed" -eq 0 ]
