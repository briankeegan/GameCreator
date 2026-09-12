#!/usr/bin/env bash
# DOES verify_chips.js FIRE? Run: bash games/the-game/ai/eval/chips.test.sh
#
# A chip verifier that passes everything looks exactly like a library that is
# entirely correct, and the whole point of taking these in batches is to tell
# a bad chip from a badly-staged one. So: break a chip four ways and fail if
# any of the damage gets through. Runs on a COPY — never the real batch file.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# paint and settle moved into engineboard.js, which the bot and the verifier
# now share. Breaking the SHARED module is the more honest test — but NOT IN
# PLACE. The first version damaged the real file and restored it at the end,
# and when a run aborted partway it left engineboard.js on disk with its frame
# budget set to zero. Everything downstream then reported that every chip
# fires nothing, which reads like the library collapsing rather than like a
# test that did not clean up. Same lesson as shipped_weights.test.sh: run on a
# COPY.
#
# So the whole eval directory is copied once, and every break happens in there.
# The sandbox keeps the SAME relative layout, because the verifiers reach up
# two directories for panel-engine.js and panel-cpu.js. A flat copy makes them
# look for /tmp/panel-engine.js and die with a module-not-found that says
# nothing about chips.
SANDBOX="$WORK/games/the-game/ai/eval"
mkdir -p "$SANDBOX"
cp "$HERE/../../panel-engine.js" "$HERE/../../panel-cpu.js" "$WORK/games/the-game/"
mkdir -p "$WORK/games/the-game/ai"
cp "$HERE/../trained-weights.js" "$WORK/games/the-game/ai/" 2>/dev/null
cp "$HERE"/*.js "$HERE"/.chipbreak.py "$SANDBOX/" 2>/dev/null
cp -r "$HERE/chips" "$SANDBOX/" 2>/dev/null
cp -r "$HERE/chips-engine-only" "$SANDBOX/" 2>/dev/null
EB="$SANDBOX/engineboard.js"
EBSAVE="$WORK/engineboard.save.js"
cp "$EB" "$EBSAVE"
MODBREAK="python3 $HERE/.chipbreak.py $EBSAVE $EB"
BATCH="$HERE/chips/batch1-chain.json"
pass=0; missed=0

check() { ( cd "$HERE" && node verify_chips.js "$WORK/b.json" ) >/dev/null 2>&1; }
try() {
  if check; then echo "  NOT CAUGHT: $1"; missed=$((missed+1));
  else echo "  caught:     $1"; pass=$((pass+1)); fi
}

cp "$BATCH" "$WORK/b.json"
if ! check; then
  echo "  the verifier rejects the UNDAMAGED batch; nothing below means anything"
  ( cd "$HERE" && node verify_chips.js "$WORK/b.json" )
  exit 1
fi
echo "  accepts:    batch 1 as committed"

python3 - "$BATCH" "$WORK/b.json" <<'PY'
import json,sys,io
d=json.load(io.open(sys.argv[1],encoding='utf-8'))
d[0]['chain'] += 1                      # claims one link deeper than it fires
json.dump(d, io.open(sys.argv[2],'w',encoding='utf-8'))
PY
try "a chip claiming a deeper chain than it fires"

python3 - "$BATCH" "$WORK/b.json" <<'PY'
import json,sys,io
d=json.load(io.open(sys.argv[1],encoding='utf-8'))
d[0]['total'] += 3                      # claims more panels cleared than it clears
json.dump(d, io.open(sys.argv[2],'w',encoding='utf-8'))
PY
try "a chip claiming more panels cleared than it clears"

python3 - "$BATCH" "$WORK/b.json" <<'PY'
import json,sys,io
d=json.load(io.open(sys.argv[1],encoding='utf-8'))
d[0]['tmpl'][0][2] = 3                  # a colour slot changed: the shape no longer connects
json.dump(d, io.open(sys.argv[2],'w',encoding='utf-8'))
PY
try "a colour slot altered so the shape stops connecting"

python3 - "$BATCH" "$WORK/b.json" <<'PY'
import json,sys,io
d=json.load(io.open(sys.argv[1],encoding='utf-8'))
d[0]['swaps'] = [[5,5]]                 # the swap points somewhere else entirely
json.dump(d, io.open(sys.argv[2],'w',encoding='utf-8'))
PY
try "the swap moved off the shape"

# ---- THE STAGING BUGS, EACH AS ITS BROKEN AND ITS WORKING VERSION ----
#
# Everything above is about a chip LYING. These are about the harness staging
# one WRONGLY, which is the failure that actually happened: each of these
# shipped, passed, and was found only by tracing a chip by hand. So each one
# breaks verify_chips.js back to how it was written and fails if the damage
# gets through.
cp "$BATCH" "$WORK/b.json"
# The verifier resolves panel-engine.js from its own __dirname, so a copy has
# to live beside the original rather than in the temp dir.
VC="$SANDBOX/.verify_chips.under-test.js"
trap 'rm -rf "$WORK"' EXIT
# EVERY ported batch, not batch 1. Batch 1's six CHAIN chips are
# self-supporting and contain no blockers, so they exercise none of the
# staging below — run the staging breaks against them and all four sail
# through. That is the same trap as the chain-counter bug: a batch that
# happens to avoid a code path is not evidence the path works.
vcheck() { ( cd "$SANDBOX" && node "$VC" ) >/dev/null 2>&1; }
vtry() {
  if vcheck; then echo "  NOT CAUGHT: $1"; missed=$((missed+1));
  else echo "  caught:     $1"; pass=$((pass+1)); fi
}

cp "$HERE/verify_chips.js" "$VC"
if ! vcheck; then
  echo "  the verifier rejects batch 1 when run from a copy; nothing below means anything"
  ( cd "$HERE" && node "$VC" "$WORK/b.json" )
  exit 1
fi
echo "  accepts:    the staging as written"

BREAK="python3 $HERE/.chipbreak.py $HERE/verify_chips.js $VC"

# BUG 1 — "@" is documented as blocker(solid,not-a-solving-color): a PANEL.
# Staged as garbage it made 16 chips' own swaps illegal, since legalSwaps
# refuses any pair touching a negative cell while swap() applies it anyway.
$BREAK "(k === '@') ? '@' :" "(k === '@') ? -2 :" || exit 2
vtry "a blocker staged as garbage instead of a panel"

# BUG 2 — support props staged as garbage. Our engine pops garbage that a
# match touches, so a prop beside a clear vanishes and the stack above drops.
$BREAK "g[r3][c2] = spare[(r3 + 2 * c2) % 3];" "g[r3][c2] = -2;" || exit 2
vtry "support props staged as garbage instead of panels"

# BUG 3 — the legality guard. Removing it alone changes NOTHING, and that is
# not a hole in the test: with the staging correct every chip's swap is legal,
# so the guard has no independent effect to observe. What it does is name the
# real cause when the staging IS wrong. Without it, bug 1 above reported
# "claims chain 2, ours gives 3" — a chip looking wrong — instead of "the
# staging makes this chip's own swap illegal". That misdirection is what cost
# three batches. So: break the staging, and require the guard to say so.
$BREAK "(k === '@') ? '@' :" "(k === '@') ? -2 :" || exit 2
# The property is not which guard fires — the no-garbage invariant gets there
# first with an even plainer message — but that NO staging bug is ever
# reported as a bad chip. "claims chain N ... ours gives M" is the
# blame-the-chip line, and it must not appear.
if ( cd "$SANDBOX" && node "$VC" 2>&1 ) | grep -q "claims chain"; then
  echo "  NOT CAUGHT: broken staging reported as a bad chip instead of bad staging"
  missed=$((missed+1))
else
  echo "  caught:     ...and blames the staging, never the chip"
  pass=$((pass+1))
fi

# BUG 4 — a column's support stops at its topmost PANEL instead of at the
# topmost thing the template mentions. That is the old rule, and it is the
# most expensive staging bug this harness has had: a column whose only
# template cell is a required-empty or the swap's landing cell then has no
# floor at all, the swapped panel free-falls to the bottom row instead of
# dropping the one row the chip is built around, and the cascade never starts.
# 672 chips — every one of them a CASCADE — read as firing nothing, which
# looks exactly like 672 bad chips.
#
# It replaces an earlier case (propping up the swap's landing cell as a
# special case), which this rule subsumes: with the rule in place that prop
# changed no verdict on 5,039 chips, so its break test had stopped being able
# to fail and the prop itself was deleted.
$BREAK "    var reach = {};
    function touch(r, c) { if (c >= 1 && c <= W && !(reach[c] > r)) reach[c] = r; }
    for (var ti = 0; ti < cells.length; ti++) touch(cells[ti][0] + rowOff, cells[ti][1] + colOff);
    for (var si2 = 0; si2 < chip.swaps.length; si2++) {
        touch(chip.swaps[si2][0] + rowOff, chip.swaps[si2][1] + colOff);
        touch(chip.swaps[si2][0] + rowOff, chip.swaps[si2][1] + colOff + 1);
    }" "    var reach = {};
    for (var bc = 1; bc <= W; bc++) for (var br = H; br >= 1; br--) if (g[br][bc] !== 0) { reach[bc] = br; break; }" || exit 2
vtry "a column's support stopping at its topmost panel, not at the template's reach" 

# ---- AND THE SAME CHIPS AGAINST THE REAL ENGINE ----
#
# verify_chips.js checks LogicalBoard, the bot's SIMULATION of the board.
# verify_chips_engine.js checks panel-engine.js, the game. A chip can be true
# of one and false of the other, and measured on the cascade group they
# disagree on 34 of 517 — so both gates exist and both get broken here.
VE="$SANDBOX/.verify_engine.under-test.js"
echeck() { ( cd "$SANDBOX" && node "$VE" ) >/dev/null 2>&1; }
etry() {
  if echeck; then echo "  NOT CAUGHT: $1"; missed=$((missed+1));
  else echo "  caught:     $1"; pass=$((pass+1)); fi
}
EBREAK="python3 $HERE/.chipbreak.py $HERE/verify_chips_engine.js $VE"


cp "$HERE/verify_chips_engine.js" "$VE"
if ! echeck; then
  echo "  the engine verifier rejects the ported chips; nothing below means anything"
  ( cd "$SANDBOX" && node "$VE" ) | tail -5
  rm -f "$VE"; exit 1
fi
echo "  accepts:    every ported chip in the real engine too"

# The engine's own legality check. Removing it alone proves nothing — with
# the staging correct every swap is legal — so the break makes the swap
# genuinely illegal: paint both halves of the pair the same colour, which the
# engine refuses ("a switch is not a swap"). Without canSwap, doSwap applies
# it anyway and the chip is blamed for the result.
$EBREAK "    var fillerColours = {}, fillerBefore = 0;" "    grid[swapRow][swapCol + 1] = grid[swapRow][swapCol];
    var fillerColours = {}, fillerBefore = 0;" || exit 2
etry "a swap the engine itself refuses"

# Running no frames: nothing settles, no match events, every chip reads as
# clearing nothing. This is the case that would catch the whole harness
# silently measuring a board that never moved.
cp "$HERE/verify_chips_engine.js" "$VE"
$MODBREAK "var cap = budget || 900;" "var cap = 0;" || exit 2
etry "the swap never given frames to resolve"

# NOT TESTED, deliberately: stale chaining flags on the painted panels. Set
# one and nothing changes, because the 30 pre-swap frames that check the
# board is still also clear it — the guard is real but already covered, and a
# case that passes either way is decoration. Noted rather than written.

# The generator's own rule: no filler may ever match. Break the filler back to
# a two-colour checkerboard and it does — it clears alongside the chip and 37
# chips read as clearing three more panels than they claim.
# The filler must not be able to match itself. Break it back to a pattern
# keyed on (row, col): every third row in a column takes the same colour, and
# a cascade compacts columns, so three of them stack. 123 chips landed in the
# "filler cleared" bucket that way before the per-column scheme replaced it.
$EBREAK "grid[r3][c2] = spare[(nth + stagger * c2 + (fillerOffset || 0)) % spare.length];" "grid[r3][c2] = spare[(r3 + 2 * c2) % 3];" || exit 2
etry "a filler pattern that can match itself once the cascade compacts a column"

# THE RISE. riseLock and speed = 0 do NOT hold the stack still: the engine
# re-decides riseLock every frame, so a settle that runs a fixed number of
# frames lets the board climb a row between a two-swap chip's two swaps. The
# second swap then addresses the cells the first swap's panels used to be in,
# and thirteen good chips read as clearing nothing. Only batch 7 (two-swap)
# can catch this — every single-swap chip is finished before the rise matters,
# which is why it went unnoticed through six batches.
cp "$EBSAVE" "$EB"
cp "$HERE/verify_chips_engine.js" "$VE"
$MODBREAK "if (f >= 3 && !stack.hasActivePanels() && !stack.hasChainingPanels()) break;" "if (false) break;" || exit 2
etry "settling for a fixed frame count, letting the stack rise between swaps"

cp "$EBSAVE" "$EB"

echo "$pass caught, $missed missed"

[ "$missed" -eq 0 ]
