#!/usr/bin/env python3
"""Regression tests for .github/art/slice_walksheet.py — the cutter.

    python3 .github/scripts/cutter.test.py

WHY THIS EXISTS. The cutter destroyed a character twice, the same way, months
apart, and both times the generated sheet was flawless. May's hair is
(236,62,91); the routine that strips stray magenta gridline fringe cannot tell
that from a magenta DIVIDER, so it deleted her head. The first fix — cut between
the green gutters, where no divider pixel is inside the crop — was correct and
covered the wrong path: gutters are the FALLBACK, used only when the gridlines
are unreadable, so a HEALTHY sheet still went through the colour test and still
got decapitated. Diamond's pink hair streak was being eaten the whole time and
nobody noticed at all.

Neither failure was catchable by the checks that existed. verify_sheet's CROPPED
test compares each frame to the median of its siblings, so it finds ONE short
frame and is structurally blind to all nine being cut identically — an
invariant-shaped non-invariant. And every art check needs real art, so nothing
tested the cutter as a piece of code.

These tests build synthetic sheets in memory, so they are exact, instant, need
no API and no committed art, and they assert the two properties that actually
broke:

  1. A character whose HAIR IS THE SAME COLOUR AS THE GRIDLINES keeps their
     head. Run on both paths — with gridlines (the healthy sheet, the one that
     was left exposed) and without (the fallback).
  2. Chroma green sealed INSIDE the silhouette is removed. A flood fill from
     the border cannot reach it, and it shipped as green flecks on twelve of
     fourteen characters.
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'art'))

import numpy as np                                        # noqa: E402
from PIL import Image                                     # noqa: E402

import slice_walksheet as sw                              # noqa: E402

GREEN = (0, 255, 0)
MAGENTA = (255, 0, 255)
HAIR = (236, 62, 91)        # May's, and the reason this file exists
BODY = (30, 40, 90)
SKIN = (240, 200, 168)
FAILS = []


def check(name, cond, detail=''):
    print(f'{"PASS" if cond else "FAIL"}  {name}' + (f'  — {detail}' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


def build_sheet(with_gridlines=True, pocket=False, rows=4, cols=3,
                cell_w=340, cell_h=380, line=3):
    """A synthetic walk sheet: green cells, optional magenta grid, a figure per cell."""
    W, H = cols * cell_w + line, rows * cell_h + line
    a = np.zeros((H, W, 3), dtype=np.uint8)
    a[:, :] = GREEN
    if with_gridlines:
        for r in range(rows + 1):
            y = min(r * cell_h, H - line)
            a[y:y + line, :] = MAGENTA
        for c in range(cols + 1):
            x = min(c * cell_w, W - line)
            a[:, x:x + line] = MAGENTA

    for r in range(rows):
        for c in range(cols):
            oy, ox = r * cell_h + line, c * cell_w + line
            cx = ox + cell_w // 2
            # HEAD: hair in the divider's own colour family, then a face.
            # Deliberately generous, so "the head is gone" is unmissable rather
            # than a threshold argument.
            a[oy + 30:oy + 120, cx - 55:cx + 55] = HAIR
            a[oy + 60:oy + 110, cx - 30:cx + 30] = SKIN
            # BODY
            a[oy + 120:oy + 330, cx - 45:cx + 45] = BODY
            if pocket:
                # green sealed inside the body — unreachable from the border
                a[oy + 180:oy + 220, cx - 15:cx + 15] = GREEN
    return Image.fromarray(a, 'RGB')


import subprocess                                          # noqa: E402


def run_cutter(im, tag, char='t'):
    d = Path(tempfile.mkdtemp(prefix=f'gc-cut-{tag}-'))
    sheet = d / 'sheet.png'
    im.save(sheet)
    r = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'art' / 'slice_walksheet.py'),
                        str(sheet), str(d), char], capture_output=True, text=True)
    frames = sorted(d.glob(f'{char}_*_?.png'))
    return d, frames, r


def share(path, colour, tol=60):
    a = np.array(Image.open(path).convert('RGBA')).astype(int)
    lit = a[..., 3] > 8
    if not lit.any():
        return 0.0
    d = (np.abs(a[..., 0] - colour[0]) + np.abs(a[..., 1] - colour[1])
         + np.abs(a[..., 2] - colour[2]))
    return 100.0 * int(((d < tol) & lit).sum()) / int(lit.sum())


def main():
    # 1. THE HEALTHY PATH — gridlines present. This is the one that was exposed:
    #    the earlier fix only covered the fallback, so a good sheet was the
    #    dangerous one, and a magenta-haired character lost her head.
    _, frames, r = run_cutter(build_sheet(with_gridlines=True), 'grid')
    check('gridline path cuts all nine frames', len(frames) == 9,
          f'got {len(frames)}: {r.stdout[-300:]}{r.stderr[-300:]}')
    if len(frames) == 9:
        worst = min(share(f, HAIR) for f in frames)
        check('gridline path KEEPS hair drawn in the gridline colour', worst > 8.0,
              f'worst frame has {worst:.1f}% hair — the head was cut off')

    # 2. THE FALLBACK PATH — no gridlines at all, cut on the green gutters.
    _, frames, r = run_cutter(build_sheet(with_gridlines=False), 'gutter')
    check('gutter fallback cuts all nine frames', len(frames) == 9,
          f'got {len(frames)}: {r.stdout[-300:]}{r.stderr[-300:]}')
    if len(frames) == 9:
        worst = min(share(f, HAIR) for f in frames)
        check('gutter path KEEPS hair drawn in the gridline colour', worst > 8.0,
              f'worst frame has {worst:.1f}% hair')

    # 3. A HEAD IS NOT OPTIONAL. Stated as its own assertion rather than left
    #    implicit in the hair share: the failure people SAW was "May has no
    #    head", so something should fail with those words in it.
    _, frames, _ = run_cutter(build_sheet(with_gridlines=True), 'head')
    if len(frames) == 9:
        headless = [f.name for f in frames if share(f, SKIN) < 1.0]
        check('no frame comes out headless', not headless, f'headless: {headless}')

    # 4. CHROMA SEALED INSIDE THE SILHOUETTE IS REMOVED. A flood fill from the
    #    border cannot reach it; it shipped as green flecks on twelve of
    #    fourteen characters.
    _, frames, _ = run_cutter(build_sheet(with_gridlines=True, pocket=True), 'pocket')
    if len(frames) == 9:
        worst = max(share(f, GREEN, tol=90) for f in frames)
        check('chroma green sealed inside the body is removed', worst < 0.6,
              f'{worst:.2f}% chroma green left inside a frame')

    print()
    if FAILS:
        print(f'{len(FAILS)} FAILED: ' + ', '.join(FAILS))
        sys.exit(1)
    print('cutter OK — magenta hair survives on both paths, no headless frames, '
          'no chroma sealed inside.')


if __name__ == '__main__':
    main()
