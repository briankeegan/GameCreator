"""Whiten the soft grey "ground shadow" the generator keeps drawing under feet.

The image model ignores "no ground shadow" often enough that several raws come
back with a light grey smear under the boots. That smear is NOT flat white, so
build_sheet.py's background key leaves it behind, and it ships as a grey bar
welded to the sprite (and inflates the frame height, which then scales the
whole row down). Cleaning it here — on the RAW, before the cutter — keeps the
shipped sheet a pure product of the pipeline: raw -> clean_raw.py -> build_sheet.py.

  python3 games/dog-punk/art-src/clean_raw.py games/dog-punk/art-src/foo_raw.png

writes foo_raw_clean.png next to it. Two passes:
  1. flood the near-white background from the border with a LOOSE tolerance,
     so a soft grey shadow that touches open background becomes pure white
     (the blade survives: it is enclosed by the character's black outline, so
     the flood can never reach it);
  2. whiten any remaining greyish pixel in the bottom sliver of the artwork —
     that is where shadow trapped between the legs lives, and no part of the
     character down there is grey.
"""
import sys
from collections import deque

import numpy as np
from PIL import Image

TOL = 70            # how far from white still counts as background
BOTTOM_FRAC = 0.12  # sliver of the artwork's height treated as "at the feet"


def clean(src, dst):
    im = Image.open(src).convert('RGB')
    a = np.array(im).astype(np.int16)
    h, w = a.shape[:2]
    close = (np.abs(a - np.array([255, 255, 255])).max(axis=2) <= TOL)

    seen = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if close[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if close[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))

    out = np.array(im)
    out[seen] = (255, 255, 255)

    b = out.astype(int)
    solid = (np.abs(b - 255).max(axis=2) > 12)
    ys, _ = np.nonzero(solid)
    y0, y1 = ys.min(), ys.max()
    cut = int(y1 - BOTTOM_FRAC * (y1 - y0))
    greyish = ((b.max(2) - b.min(2)) < 34) & (b.mean(2) > 140)
    band = np.zeros_like(greyish)
    band[cut:, :] = True
    out[greyish & band] = (255, 255, 255)

    Image.fromarray(out).save(dst)
    print(f'wrote {dst}')


if __name__ == '__main__':
    for path in sys.argv[1:]:
        clean(path, path.replace('.png', '_clean.png'))
