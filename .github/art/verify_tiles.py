#!/usr/bin/env python3
"""Check a shipped tile strip. The gate half of the tiled-level standard.

    python3 .github/art/verify_tiles.py games/dog-punk/tiles.png \
            --style games/dog-punk/art-style.json

Every check here is a defect that SHIPPED to Dog Punk and was described by the
person looking at it as "this is awful". None of them were catchable by the
existing art gates, which only know about character sheets and rooms — a tiled
level was the one shape of art with a pipeline and no checker.

The rules themselves, and why each one matters, are in
docs/TILED_LEVEL_STANDARD.md. This file decides them mechanically.

HARD (fails the build) where the defect is a fact:
  SEAMS      a floor tile whose opposite edges do not meet. Laid 200 times,
             a tile that does not wrap draws a visible grid — the "graph
             paper" the whole redo was supposed to fix, back again.
  FLAT       a tile with almost no internal variation. A flat grey square is
             indistinguishable from a missing texture, and the level shipped
             with concrete slabs that read exactly that way.

SOFT (warns) where it is a threshold on taste:
  VOID       a tile so much darker than the floor it reads as a hole rather
             than as something lying on the ground (the oil puddles).
  CAMOUFLAGE a floor whose colour sits on top of the character palette, so
             the sprites stop separating from the ground.
"""

import argparse
import json
import sys

import numpy as np
from PIL import Image

# CALIBRATION, measured — not guessed, and the first metric I tried was wrong.
#
# Attempt 1 was the obvious one: mean |edge - opposite edge|. It does not
# separate anything, because a noisy texture has big edge differences whether
# or not it wraps. On the real material it scored unseamed tiles 10.0-13.2 and
# seamless ones 3.3-24.7 — overlapping, and it rated one CORRECTLY seamed tile
# as the worst in the set. Recorded so nobody re-derives it.
#
# What works is normalising by the tile's own roughness: compare the step
# ACROSS the wrap to the typical step INSIDE the tile. Noise cancels. A tile
# that wraps as smoothly as it flows internally scores about 1.
#
#   build_tiles.py `texture:` output       0.69 - 1.60
#   the same raws cut WITHOUT seamless     1.69 - 1.88
#   Dog Punk's shipped ground tile         2.21   <- the graph-paper floor
#
# SEAM_MAX sits at 2.0. Be honest about what that buys: it catches a floor with
# a REAL seam (the one that shipped and was rejected on sight) with no false
# positive on any correctly-seamed tile measured. It does NOT catch every tile
# that merely skipped the seamless pass — 1.69-1.88 slips under. Tightening it
# to 1.65 would catch those and would also fail a legitimate seamed tile at
# 1.60, and a gate that fails correct art is worse than one that misses some
# bad art: people start ignoring it. The rest is what `tileset.py check` is
# for — it lays the floor out so you can see a grid.
SEAM_MAX = 2.0
#
#   detail (std of luma within the tile)
#     a real texture                      11.7 - 31.7
#     the flat concrete slab that shipped  7.2         <- must fail
# FLAT_MIN at 9 splits them with room on both sides.
FLAT_MIN = 9.0
VOID_RATIO = 0.45      # tile mean luma below this fraction of the floor's
CAMO_MIN = 28.0        # minimum luma gap between floor and character palette


def _luma(a):
    return a[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)


def _seam(a):
    """Discontinuity across the wrap, relative to the step inside the tile.

    The join the level actually draws is the tile's last row against its own
    first row. Comparing those directly is useless on a noisy material (see the
    calibration note); dividing by the tile's typical row-to-row step cancels
    the noise and leaves the discontinuity.
    """
    rgb = a[..., :3].astype(np.float32)
    inner_v = np.abs(np.diff(rgb, axis=0)).mean()
    inner_h = np.abs(np.diff(rgb, axis=1)).mean()
    wrap_v = np.abs(rgb[0] - rgb[-1]).mean()
    wrap_h = np.abs(rgb[:, 0] - rgb[:, -1]).mean()
    return float(max(wrap_v / max(inner_v, 1e-3), wrap_h / max(inner_h, 1e-3)))


def check(path, style_path, floors, count):
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    n = count or (w // h if h and w % h == 0 else 0)
    if not n:
        return [f'{path}: SHAPE — expected a horizontal strip of square tiles, got {w}x{h}.'], []
    size = h
    tiles = [np.asarray(img.crop((i * size, 0, (i + 1) * size, size))) for i in range(n)]

    hard, soft = [], []
    lumas = []
    for i, t in enumerate(tiles):
        opaque = t[..., 3] > 0
        if not opaque.any():
            hard.append(f'{path}: EMPTY — tile {i} is blank.')
            lumas.append(None)
            continue
        lum = _luma(t)[opaque]
        lumas.append(float(lum.mean()))
        detail = float(lum.std())
        # An object tile is a cut-out on transparency: it is allowed to be a
        # simple shape. Only a tile that fills its cell is claiming to be a
        # material, and a material with no variation is a missing texture.
        fills_cell = opaque.mean() > 0.98
        if fills_cell and detail < FLAT_MIN:
            hard.append(
                f'{path}: FLAT — tile {i} has almost no texture (detail {detail:.1f}, '
                f'needs {FLAT_MIN}). A flat block of colour laid across the level reads as '
                'a missing texture, not as a surface. Generate the material, do not fill it.')
        if i in floors:
            seam = _seam(t)
            if seam > SEAM_MAX:
                hard.append(
                    f'{path}: SEAMS — floor tile {i} does not wrap (seam {seam:.2f}x its own '
                    f'internal roughness, needs under {SEAM_MAX}). Laid across a level it draws '
                    'a visible grid. '
                    'Cut it with build_tiles.py as a `texture:`, which makes it seamless; a '
                    'generator will not draw a tile that repeats, however loudly it is asked.')

    floor_luma = np.mean([lumas[i] for i in floors if lumas[i] is not None]) if floors else None
    if floor_luma:
        for i, l in enumerate(lumas):
            if l is None or i in floors:
                continue
            if l < floor_luma * VOID_RATIO:
                soft.append(
                    f'{path}: VOID — tile {i} is far darker than the floor '
                    f'(luma {l:.0f} vs {floor_luma:.0f}). Something lying ON the ground that '
                    'dark reads as a hole in it. Give it a rim or a highlight so it sits on '
                    'the surface.')

    if style_path and floor_luma:
        try:
            style = json.loads(open(style_path).read())
            pal = style.get('lockedPalette') or []
            hexes = [c for c in pal if isinstance(c, str) and c.startswith('#')]
            if hexes:
                chars = np.array([[int(c[k:k + 2], 16) for k in (1, 3, 5)] for c in hexes], np.float32)
                clum = chars @ np.array([0.299, 0.587, 0.114], np.float32)
                near = float(np.min(np.abs(clum - floor_luma)))
                if near < CAMO_MIN:
                    soft.append(
                        f'{path}: CAMOUFLAGE — the floor sits {near:.0f} luma from the nearest '
                        'character colour. Sprites stop reading against the ground. Darken the '
                        'floor (build_tiles.py takes a brightness multiplier per tile) rather '
                        'than repainting the characters.')
        except Exception as e:
            soft.append(f'{path}: could not read {style_path} for the contrast check ({e}).')
    return hard, soft


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('strip')
    ap.add_argument('--style')
    ap.add_argument('--floors', default='0,1,2',
                    help='comma-separated indices of tiles that TILE THE FLOOR and therefore '
                         'must wrap (default 0,1,2)')
    ap.add_argument('--count', type=int, help='tiles in the strip (default: width/height)')
    a = ap.parse_args()
    floors = {int(x) for x in a.floors.split(',') if x.strip() != ''}
    hard, soft = check(a.strip, a.style, floors, a.count)
    for w in soft:
        print(f'WARNING {w}', file=sys.stderr)
    for p in hard:
        print(p, file=sys.stderr)
    if hard:
        print(f'{len(hard)} problem(s).', file=sys.stderr)
        sys.exit(1)
    print(f'{a.strip}: OK')


if __name__ == '__main__':
    main()
