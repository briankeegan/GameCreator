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

echo "$pass caught, $missed missed"
[ "$missed" -eq 0 ]
