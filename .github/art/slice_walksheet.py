#!/usr/bin/env python3
"""Slice a magenta-gridline walk sheet (see games/<id>/WALK_SHEETS.md for the
generation recipe) into trimmed per-direction, per-frame files.

Usage: slice_walksheet.py <sheet.png> <out_dir> <char_id>
Writes <char_id>_down_0/1/2.png, <char_id>_left_0/1/2.png, <char_id>_up_0/1/2.png.
RIGHT is never written — mirror LEFT in code, same as the player already does.
"""
import sys, os
from PIL import Image
import numpy as np

def find_gridlines(im):
    a = np.array(im.convert("RGB"))
    h, w, _ = a.shape
    # The model renders "magenta" softer than pure #FF00FF (observed ~ (201,124,168))
    # — key on R and B both clearly dominating G, not an exact hue.
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    mag_mask = (r > 140) & (b > 140) & (g < r - 40) & (g < b - 20)
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

def cut_and_trim(im, y0, y1, x0, x1):
    cell = im.crop((x0 + 4, y0 + 4, x1 - 4, y1 - 4)).convert("RGBA")
    a = np.array(cell)
    # key white background to transparent
    white = (a[:, :, 0] > 235) & (a[:, :, 1] > 235) & (a[:, :, 2] > 235)
    a[white, 3] = 0
    # also kill stray magenta fringe from anti-aliasing at the crop edge —
    # dilate the mask by a few px since a soft/blurred divider leaves a faint
    # halo the raw color test alone doesn't fully catch.
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    mag = (r > 120) & (b > 120) & (g < r - 25) & (g < b - 10)
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
    # Rows run edge-to-edge with no separate border line, so the canvas top/
    # bottom double as the outer bounds. Columns are sometimes framed by an
    # explicit left/right border line inset from the canvas edge — in that
    # case the detected lines already ARE the complete boundary set, and
    # prepending/appending the canvas edge would add a bogus empty column.
    def build_bounds(lines, extent, edge_margin=40):
        has_left_border = lines and lines[0] > edge_margin
        has_right_border = lines and (extent - lines[-1]) > edge_margin
        bounds = list(lines)
        if not has_left_border: bounds = [0] + bounds
        if not has_right_border: bounds = bounds + [extent]
        return bounds
    row_bounds = [0] + row_lines + [h]
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
