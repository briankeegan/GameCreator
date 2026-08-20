#!/usr/bin/env python3
"""Slice a magenta-gridline walk sheet (see games/<id>/WALK_SHEETS.md for the
generation recipe) into trimmed per-direction, per-frame files.

Usage: slice_walksheet.py <sheet.png> <out_dir> <char_id>
4-column sheet (idle, contact, passing, opposite-contact): writes
<char_id>_<dir>_idle.png (straight-leg standing pose) plus
<char_id>_<dir>_0/1/2.png (the 3-frame walk cycle) for dir in down/left/up.
3-column sheet (no idle column): writes only _0/1/2.png.
RIGHT is never written — mirror LEFT in code, same as the player already does.
"""
import sys, os
from collections import deque
from PIL import Image
import numpy as np

def find_gridlines(im):
    a = np.array(im.convert("RGB"))
    h, w, _ = a.shape
    # The model renders "magenta" all over the map — a softer desaturated
    # pink (observed ~ (201,124,168)) in some sheets, a near-hot-pink with a
    # much lower blue channel (observed ~ (255,0,110), which the old b>140
    # floor here missed completely — Kat's sheet sliced as "0 gridlines
    # found" and silently fell back to guessed even-thirds bounds, leaving a
    # visible sliver of real divider line at the top of several frames) in
    # others. Key on G being clearly dominated by BOTH R and B — true across
    # every observed shade — rather than an absolute floor on B itself.
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    mag_mask = (r > 140) & (b > 50) & (g < r - 40) & (g < b - 20)
    row_frac = mag_mask.mean(axis=1)
    col_frac = mag_mask.mean(axis=0)
    # Row dividers run edge-to-edge (rarely crossed by a character), so a high
    # threshold is reliable. Column dividers get interrupted by arms/feet in
    # some rows, so a real divider can show up as low as ~30-40% coverage —
    # use a looser threshold and a wider merge tolerance to still catch it
    # without also merging two genuinely distinct lines together.
    row_lines = [y for y in range(h) if row_frac[y] > 0.5]
    col_lines = [x for x in range(w) if col_frac[x] > 0.25]
    def group(vals, tol):
        if not vals: return []
        groups = [[vals[0]]]
        for v in vals[1:]:
            if v - groups[-1][-1] <= tol: groups[-1].append(v)
            else: groups.append([v])
        return [int(sum(g) / len(g)) for g in groups]
    return group(row_lines, 3), group(col_lines, 8)

def flood_fill_background(rgb, seed_mask):
    """BFS flood-fill from every True pixel in seed_mask through neighbors
    that are 'background-like' (green-dominant — still plausibly part of the
    chroma backdrop including its anti-aliased edge toward the character).
    A flat color threshold alone leaves a halo of blended edge pixels behind
    (confirmed live: a visible white/gray speckle ring around every sprite);
    flood-filling from the border follows that blend all the way to the
    character's true edge instead. Also correctly leaves alone any
    background-colored pixel trapped INSIDE the silhouette, since it's never
    reached from the border."""
    h, w, _ = rgb.shape
    r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
    # Loose enough to catch the anti-aliased blend toward the character (soft
    # edges are the whole reason this exists), tight enough not to eat real
    # character color (none of this game's characters wear green).
    bg_like = (g > r + 15) & (g > b + 15) & (g > 60)
    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    ys, xs = np.where(seed_mask)
    for y, x in zip(ys, xs):
        if bg_like[y, x] and not visited[y, x]:
            visited[y, x] = True
            q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and bg_like[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))
    return visited

def cut_and_trim(im, y0, y1, x0, x1):
    cell = im.crop((x0 + 4, y0 + 4, x1 - 4, y1 - 4)).convert("RGBA")
    a = np.array(cell)
    h, w, _ = a.shape
    # Flood-fill the chroma-green background from the crop's border inward.
    border = np.zeros((h, w), dtype=bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    bg = flood_fill_background(a[:, :, :3], border)
    a[bg, 3] = 0
    # kill any stray magenta fringe from the divider line too, dilated a
    # couple px since a soft divider leaves a faint halo of its own.
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    mag = (r > 120) & (b > 40) & (g < r - 25) & (g < b - 10)
    dil = mag.copy()
    for dy in (-3, -2, -1, 0, 1, 2, 3):
        for dx in (-3, -2, -1, 0, 1, 2, 3):
            dil |= np.roll(np.roll(mag, dy, axis=0), dx, axis=1)
    a[dil, 3] = 0
    out = Image.fromarray(a, "RGBA")
    alpha = np.array(out.split()[-1])
    mask = alpha > 10
    cols = np.where(mask.sum(axis=0) > 2)[0]
    rows = np.where(mask.sum(axis=1) > 2)[0]
    if len(cols) == 0 or len(rows) == 0:
        return out  # empty cell, leave as-is (caller should notice)
    return out.crop((cols.min(), rows.min(), cols.max() + 1, rows.max() + 1))

def main():
    sheet_path, out_dir, char_id = sys.argv[1], sys.argv[2], sys.argv[3]
    im = Image.open(sheet_path)
    row_lines, col_lines = find_gridlines(im)
    print("row gridlines:", row_lines)
    print("col gridlines:", col_lines)
    w, h = im.size
    # Whether the detected lines are pure INTERIOR dividers (need the canvas
    # edges added as the outer bounds) or already include explicit left/right
    # BORDER lines (in which case adding the canvas edge too would create a
    # bogus sliver "column") varies sheet to sheet — some generations frame
    # the grid with a border inset from the edge, some don't. Try both
    # interpretations and keep whichever gives the most uniform segment
    # widths — the real grid was asked for as equal-size cells, so the
    # correct interpretation is the one that actually looks equal-size.
    def build_bounds(lines, extent):
        if not lines: return [0, extent]
        candidates = [[0] + lines + [extent]]
        if len(lines) >= 2: candidates.append(list(lines))
        # A 1-segment candidate trivially has zero variance (nothing to
        # compare against) and would always "win" on that alone — exclude
        # it unless it's the only option, since a real grid has >=2 cells.
        multi = [c for c in candidates if len(c) > 2]
        candidates = multi or candidates
        def variance(bounds):
            widths = [bounds[i + 1] - bounds[i] for i in range(len(bounds) - 1)]
            avg = sum(widths) / len(widths)
            return sum((x - avg) ** 2 for x in widths)
        return min(candidates, key=variance)
    row_bounds = build_bounds(row_lines, h)
    col_bounds = build_bounds(col_lines, w)
    n_rows = len(row_bounds) - 1
    n_cols = len(col_bounds) - 1
    print(f"detected grid: {n_rows} rows x {n_cols} cols")
    # The model reliably delivers 3 rows (down/left/up) regardless of a 4-row
    # ask — that's actually sufficient, RIGHT is mirrored from LEFT in-game.
    # Only fall back to the 4-row down/left/right/up mapping if a sheet
    # genuinely comes back with 4 rows.
    row_names = {0: "down", 1: "left", 2: "up"} if n_rows <= 3 else {0: "down", 1: "left", 2: "right", 3: "up"}
    for r in range(min(n_rows, 4)):
        name = row_names.get(r)
        if name is None or name == "right":
            continue
        for c in range(min(n_cols, 3)):
            y0, y1 = row_bounds[r], row_bounds[r + 1]
            x0, x1 = col_bounds[c], col_bounds[c + 1]
            frame = cut_and_trim(im, y0, y1, x0, x1)
            out_path = os.path.join(out_dir, f"{char_id}_{name}_{c}.png")
            frame.save(out_path)
            print("wrote", out_path, frame.size)

if __name__ == "__main__":
    main()
