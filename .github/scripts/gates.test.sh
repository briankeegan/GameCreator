#!/usr/bin/env bash
# A GATE THAT CANNOT FAIL IS WORSE THAN NO GATE, so the gates are tested too.
#
# Every art check in this repo ran on every push and NONE of them could fail:
# each ended in `exit 0` after appending a line to a file that a later step
# printed as a warning. A green Pages run therefore said nothing at all about
# the art while looking exactly like it did — a character shipped headless in
# six of nine frames past a full set of green checks, and was found by a person
# looking at the screen. The checks were fine; the wiring was a lie.
#
# Two different things have to be true, and this file proves the first:
#   1. each checker actually REJECTS the defect it exists for, and stays quiet
#      on the untouched repo (here — mutation testing, on a scratch copy);
#   2. each checker is wired somewhere it can turn a run red
#      (.github/scripts/check_gate_wiring.mjs).
#
# Run by hand:  bash .github/scripts/gates.test.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -r games .github "$work/" 2>/dev/null
cp -r docs "$work/" 2>/dev/null
OLDPWD_SAVE="$ROOT"
cd "$work"
pass=0; fail=0
run() { # name, mutation-cmd, gate-cmd
  local name="$1" mut="$2" gate="$3"
  cp -r "$OLDPWD_SAVE/games" . 2>/dev/null; rm -rf games; cp -r "$OLDPWD_SAVE/games" .
  eval "$mut" >/dev/null 2>&1
  if eval "$gate" >/dev/null 2>&1; then
    echo "  BS   $name — gate PASSED a repo I deliberately broke"; fail=$((fail+1))
  else
    echo "  real $name"; pass=$((pass+1))
  fi
}

echo "== art gates, each run against a deliberately broken repo =="
run "frame sets: a character loses a frame" \
    "rm -f games/the-game/art/kat_left_1.png" \
    "python3 .github/art/verify_sheet.py frames games/the-game/art kat"

run "frame sets: two frames are identical" \
    "cp games/the-game/art/kat_left_0.png games/the-game/art/kat_left_2.png" \
    "python3 .github/art/verify_sheet.py frames games/the-game/art kat"

run "chroma residue: green painted inside a sprite" \
    "python3 -c \"
from PIL import Image; import numpy as np
p='games/the-game/art/kat_down_1.png'
a=np.array(Image.open(p).convert('RGBA')); h,w,_=a.shape
a[h//2:h//2+40, w//2-12:w//2+12]=[0,255,0,255]
Image.fromarray(a,'RGBA').save(p)\"" \
    "python3 .github/art/verify_sheet.py frames games/the-game/art kat"

run "portrait/sprite: sprite loses the portrait's defining colour" \
    "for f in games/the-game/art/may_down_*.png games/the-game/art/may_left_*.png; do python3 -c \"
import sys
from PIL import Image; import numpy as np
p=sys.argv[1]; a=np.array(Image.open(p).convert('RGBA')).astype(int)
r,g,b=a[...,0],a[...,1],a[...,2]
m=(r>150)&(r-g>60)&(r-b>10)
a[m]=[40,40,40,255]
Image.fromarray(a.astype('uint8'),'RGBA').save(p)\" \$f; done" \
    "python3 .github/art/verify_sheet.py portrait games/the-game may"

run "art references: story names an id with no file" \
    "rm -f games/the-game/art/chuck.png" \
    "node .github/scripts/check_art_refs.mjs"

run "spec provenance: a material loses its source" \
    "python3 -c \"
import json
p='games/the-game/art-style.json'; d=json.load(open(p))
d['characters']['may']['materials']['hair'].pop('source',None)
json.dump(d,open(p,'w'))\"" \
    "node .github/scripts/check_character_specs.mjs"

run "spec provenance: an invented source value" \
    "python3 -c \"
import json
p='games/the-game/art-style.json'; d=json.load(open(p))
d['characters']['may']['materials']['hair']['source']='vibes'
json.dump(d,open(p,'w'))\"" \
    "node .github/scripts/check_character_specs.mjs"

run "room exits: a door loses its partner" \
    "python3 - <<'PY'
import re
p='games/the-game/story.js'; s=open(p).read()
s=re.sub(r'link:\s*\"[a-z_]+\"', 'link: \"orphaned_door\"', s, count=1)
open(p,'w').write(s)
PY" \
    "node .github/scripts/check_room_exits.mjs"

echo
echo "== and the checks must STAY QUIET on the untouched repo =="
rm -rf games; cp -r "$OLDPWD_SAVE/games" .
for g in "python3 .github/art/verify_sheet.py frames games/the-game/art kat" \
         "python3 .github/art/verify_sheet.py portrait games/the-game may" \
         "node .github/scripts/check_art_refs.mjs" \
         "node .github/scripts/check_character_specs.mjs" \
         "node .github/scripts/check_room_exits.mjs"; do
  if eval "$g" >/dev/null 2>&1; then echo "  quiet: ${g:0:60}"; else echo "  FALSE ALARM: ${g:0:60}"; fail=$((fail+1)); fi
done
echo
echo "real: $pass   BS/false-alarm: $fail"
[ "$fail" = 0 ] || { echo "GATES ARE NOT VALID — see above"; exit 1; }
echo "every gate rejects its defect and passes clean art."
