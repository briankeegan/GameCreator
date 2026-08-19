"""Key a generated sprite sheet's flat background to transparent and cut it
into frames by projection profile (the grid is never pixel-perfect, so we
find the empty gutters instead of assuming fixed cells)."""
import sys
from collections import deque
import numpy as np
from PIL import Image


def key_background(path, tol=22):
    im = Image.open(path).convert('RGBA')
    a = np.array(im).astype(np.int16)
    h, w = a.shape[:2]
    bg = np.median(np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]]), axis=0)
    close = (np.abs(a[:, :, :3] - bg).max(axis=2) <= tol)
    # Flood from the border so interior light pixels (eye whites, the dagger
    # blade) survive — only background CONNECTED to the edge is removed.
    seen = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if close[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if close[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    # Background also gets TRAPPED inside a sprite — between the legs, inside
    # the crook of an arm — where the border flood can never reach it. Those
    # pockets stay as opaque white blobs in the middle of the character. Clear
    # any sizeable one; the size floor keeps small light details (eye whites,
    # a tooth) safe, and the dagger blade is far enough from the background
    # colour that it is not in `close` at all.
    min_hole = int(0.0015 * h * w)
    holes = np.zeros((h, w), bool)
    for y in range(h):
        for x in range(w):
            if not close[y, x] or seen[y, x] or holes[y, x]:
                continue
            comp = [(y, x)]
            holes[y, x] = True
            qq = deque([(y, x)])
            while qq:
                cy, cx = qq.popleft()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not seen[ny, nx] and not holes[ny, nx]:
                        holes[ny, nx] = True
                        qq.append((ny, nx))
                        comp.append((ny, nx))
            if len(comp) < min_hole:
                for cy, cx in comp:
                    holes[cy, cx] = False

    out = np.array(im)
    cut = seen | holes
    out[cut] = (0, 0, 0, 0)
    return Image.fromarray(out), cut


def bands(mask, min_gap=6, min_run=20):
    """Runs of rows/cols containing any opaque pixel."""
    occupied = mask.any(axis=1)
    runs, start = [], None
    gap = 0
    for i, v in enumerate(occupied):
        if v:
            if start is None:
                start = i
            gap = 0
        else:
            if start is not None:
                gap += 1
                if gap >= min_gap:
                    if i - gap - start >= min_run:
                        runs.append((start, i - gap))
                    start = None
    if start is not None and len(occupied) - start >= min_run:
        runs.append((start, len(occupied)))
    return runs


if __name__ == '__main__':
    img, removed = key_background(sys.argv[1])
    alpha = np.array(img)[:, :, 3] > 0
    rows = bands(alpha)
    print('rows:', rows)
    for r0, r1 in rows:
        cols = bands(alpha[r0:r1].T)
        print(f'  row {r0}-{r1} ({r1-r0}px): {len(cols)} cols {cols}')
    img.save(sys.argv[2])
