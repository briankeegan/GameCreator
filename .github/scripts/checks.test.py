#!/usr/bin/env python3
"""Tests for the ART CHECKERS themselves — do they fire, and do they stay quiet?

    python3 .github/scripts/checks.test.py

A checker is the one kind of code whose bugs are silent by construction: one
that never fires looks exactly like art that is fine, and one that fires on
everything gets switched off in a week. Both happened here. The CROPPED test
compares each frame to the median of its siblings, so it is structurally blind
to all nine being cut identically — which is how a headless character shipped.
And the first version of the portrait/sprite check flagged Kyran's trousers,
because a head-and-shoulders bust cannot show legs.

So every checker gets both halves proved on synthetic art: a deliberately broken
input it MUST reject, and a correct-but-awkward input it MUST accept.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ART = Path(__file__).resolve().parents[1] / 'art'
VERIFY = ART / 'verify_sheet.py'
FAILS = []

HAIR = (232, 48, 111)
SKIN = (240, 200, 168)
COAT = (40, 60, 140)
TROUSERS = (34, 34, 42)


def check(name, cond, detail=''):
    print(f'{"PASS" if cond else "FAIL"}  {name}' + (f'  — {detail}' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


def rgba(w, h, blocks):
    a = np.zeros((h, w, 4), dtype=np.uint8)
    for (y0, y1, x0, x1), c in blocks:
        a[y0:y1, x0:x1, :3] = c
        a[y0:y1, x0:x1, 3] = 255
    return Image.fromarray(a, 'RGBA')


def game(tmp, spec, portrait_blocks, sprite_blocks, pw=200, ph=200, sw_=120, sh=300):
    d = Path(tmp)
    (d / 'art').mkdir(parents=True, exist_ok=True)
    (d / 'art-style.json').write_text(json.dumps({'characters': {'t': spec}}))
    rgba(pw, ph, portrait_blocks).save(d / 'art' / 't.png')
    for direction in ('down', 'left', 'up'):
        for n in (0, 1, 2):
            rgba(sw_, sh, sprite_blocks).save(d / 'art' / f't_{direction}_{n}.png')
    return d


def portrait_check(d):
    r = subprocess.run([sys.executable, str(VERIFY), 'portrait', str(d), 't'],
                       capture_output=True, text=True)
    return r.returncode != 0, (r.stdout + r.stderr)


def main():
    # --- IT MUST FIRE: a sprite that lost the hair filling its portrait. ---
    # This is May exactly: 24% of her portrait, 0% of her frames, every other
    # check green because they each look at one picture alone.
    with tempfile.TemporaryDirectory() as tmp:
        spec = {'materials': {'hair': {'base': '#e8306f', 'appears': 'always'},
                              'coat': {'base': '#283c8c', 'appears': 'always'}}}
        d = game(tmp, spec,
                 portrait_blocks=[((10, 90, 40, 160), HAIR), ((90, 200, 40, 160), SKIN)],
                 sprite_blocks=[((10, 60, 40, 80), SKIN), ((60, 300, 30, 90), COAT)])
        fired, out = portrait_check(d)
        check('portrait/sprite FIRES when the sprite lost the portrait\'s hair', fired,
              'it passed a headless sprite')
        check('...and names the material', 'hair' in out.lower(), out[:200])

    # --- IT MUST STAY QUIET: a bust cannot show trousers. ---
    # Kyran, who tripped the first version at 26.7% trousers vs 1.1%.
    with tempfile.TemporaryDirectory() as tmp:
        spec = {'materials': {'hair': {'base': '#e8306f', 'appears': 'always'},
                              'trousers': {'base': '#22222a', 'appears': 'always'}}}
        d = game(tmp, spec,
                 portrait_blocks=[((10, 90, 40, 160), HAIR), ((90, 200, 40, 160), SKIN)],
                 sprite_blocks=[((10, 60, 45, 75), HAIR), ((60, 170, 30, 90), COAT),
                                ((170, 300, 35, 85), TROUSERS)])
        fired, out = portrait_check(d)
        check('portrait/sprite STAYS QUIET about legs a bust cannot show', not fired, out[:200])

    # --- IT MUST STAY QUIET: a back view hides the face. ---
    # Including the up row flagged `skin` on six correct characters.
    with tempfile.TemporaryDirectory() as tmp:
        spec = {'materials': {'skin': {'base': '#f0c8a8', 'appears': 'always'}}}
        d = Path(game(tmp, spec,
                      portrait_blocks=[((10, 200, 40, 160), SKIN)],
                      sprite_blocks=[((10, 60, 45, 75), SKIN), ((60, 300, 30, 90), COAT)]))
        # redraw the BACK row with no skin at all, which is what a back view is
        for n in (0, 1, 2):
            rgba(120, 300, [((10, 300, 30, 90), COAT)]).save(d / 'art' / f't_up_{n}.png')
        fired, out = portrait_check(d)
        check('portrait/sprite STAYS QUIET about a face the back view hides', not fired, out[:200])

    # --- CHROMA RESIDUE must fire on green left inside a sprite. ---
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / 'art').mkdir()
        for direction in ('down', 'left', 'up'):
            for n in (0, 1, 2):
                rgba(120, 300, [((10, 300, 30, 90), COAT),
                                ((120, 200, 45, 75), (0, 255, 0))]).save(
                    d / 'art' / f't_{direction}_{n}.png')
        r = subprocess.run([sys.executable, str(VERIFY), 'frames', str(d / 'art'), 't'],
                           capture_output=True, text=True)
        out = r.stdout + r.stderr
        check('CHROMA RESIDUE fires on green sealed inside a sprite',
              r.returncode != 0 and 'CHROMA' in out.upper(), out[:200])

    print()
    if FAILS:
        print(f'{len(FAILS)} FAILED: ' + ', '.join(FAILS))
        sys.exit(1)
    print('art checkers OK — each fires on the defect it exists for, and stays '
          'quiet on the correct-but-awkward case that would get it ignored.')


if __name__ == '__main__':
    main()
