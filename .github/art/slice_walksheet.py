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


def gutters_from_green(im, want_cols=3):
    """Find the cell boundaries from the GREEN, ignoring the gridlines.

    The magenta grid is the single point of failure in this pipeline and the
    model drops it: May's sheet came back with the art perfect and ZERO
    magenta pixels in the whole image; Chuck's had magenta but only two
    readable row dividers. Two generations, two different ways of not having
    a usable grid, and no amount of shouting in the prompt made it reliable.

    But the cells sit on flat chroma-key green, so the boundaries do not need
    the lines at all: a band of rows (or columns) that is almost entirely
    green is the gap BETWEEN two cells. Same gutter technique build_sheet.py
    uses against flat white — the background is the signal, and it is the one
    thing the model cannot forget to draw, because it is what it draws the
    characters ON.

    Returns (row_bounds, col_bounds) ready to slice, or (None, None).
    """
    import numpy as np
    a = np.array(im.convert("RGB")).astype(int)
    h, w, _ = a.shape
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    green = (g > 110) & (g > r + 40) & (g > b + 40)

    def bands(frac, span):
        for thresh in (0.97, 0.94, 0.90, 0.86):
            runs, start = [], None
            for i in range(span):
                if frac[i] >= thresh:
                    if start is None: start = i
                elif start is not None:
                    runs.append([start, i]); start = None
            if start is not None: runs.append([start, span])
            runs = [x for x in runs if x[1] - x[0] >= 2]
            # A gutter reads as TWO runs, because the gridline drawn down the
            # middle of it is not green. Merge anything close enough to be
            # one gap — without this the finder saw seven "gutters" in a
            # three-gutter sheet and matched nothing.
            merged = []
            for run in runs:
                if merged and run[0] - merged[-1][1] <= max(14, span * 0.012):
                    merged[-1][1] = run[1]
                else:
                    merged.append(list(run))
            inner = [x for x in merged if x[0] > span * 0.03 and x[1] < span * 0.97]
            if not inner:
                continue
            # A cell runs from the END of one gutter to the START of the next.
            # Taking the gutter's MIDPOINT instead would leave half of it —
            # and therefore the divider line drawn down it — inside the cell,
            # which is what forces a colour guess at removing the divider
            # later. Cropping between the gutters means no divider pixel is
            # ever in the crop and there is nothing to guess about.
            outer = [x for x in merged if x not in inner]
            head = max([x[1] for x in outer if x[1] <= inner[0][0]] + [0])
            tail = min([x[0] for x in outer if x[0] >= inner[-1][1]] + [span])
            edges = [head] + [c for x in inner for c in x] + [tail]
            cells = [(edges[i], edges[i + 1]) for i in range(0, len(edges) - 1, 2)]
            if len(cells) >= 2:
                return cells
        return None

    rows = bands(green.mean(axis=1), h)
    cols = bands(green.mean(axis=0), w)
    if not rows or not cols:
        return None, None

    # DROP A CROPPED TRAILING ROW. The sheet is asked for as four rows and
    # the model routinely delivers three full ones plus a sliver of a fourth
    # falling off the bottom edge — CHARACTER_SHEETS.md already records the
    # bottom row as the thing that comes back cropped. A band far shorter
    # than its siblings is that sliver, and cutting frames from it produces
    # headless half-characters, which is the bug this whole pass started on.
    if len(rows) > 3:
        heights = sorted(x[1] - x[0] for x in rows)
        median = heights[len(heights) // 2]
        rows = [x for x in rows if (x[1] - x[0]) >= median * 0.65]
    if len(cols) > want_cols:
        widths = sorted(x[1] - x[0] for x in cols)
        med = widths[len(widths) // 2]
        cols = [x for x in cols if (x[1] - x[0]) >= med * 0.65]

    if not (3 <= len(rows) <= 4) or len(cols) != want_cols:
        return None, None
    return rows, cols


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

def largest_component_only(alpha):
    """Zero out every opaque region except the single largest connected
    blob. A generation occasionally leaves small disconnected specks of
    non-green debris near a character (confirmed live: May's sheet had a
    scatter of thin, disconnected dark-maroon wisps floating above her
    actual hair, with real background visible in the gaps between them —
    not a fringe/color problem at all, just a broken hair silhouette at the
    top of that one cell) which no color threshold can distinguish from
    real content since they aren't background-colored. Keeping only the
    biggest connected mass — always the character's own body — discards
    that debris regardless of its color. Same BFS shape as
    flood_fill_background, just over opaque pixels instead of background."""
    h, w = alpha.shape
    mask = alpha > 10
    visited = np.zeros((h, w), dtype=bool)
    best = None
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or visited[sy, sx]:
                continue
            q = deque([(sy, sx)])
            visited[sy, sx] = True
            comp = [(sy, sx)]
            while q:
                y, x = q.popleft()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        q.append((ny, nx))
                        comp.append((ny, nx))
            if best is None or len(comp) > len(best):
                best = comp
    if best is None:
        return alpha
    keep = np.zeros((h, w), dtype=bool)
    for y, x in best:
        keep[y, x] = True
    out = alpha.copy()
    out[~keep] = 0
    return out

def cut_and_trim(im, y0, y1, x0, x1, inset=4, divider_free=False):
    cell = im.crop((x0 + inset, y0 + inset, x1 - inset, y1 - inset)).convert("RGBA")
    a = np.array(cell)
    h, w, _ = a.shape
    # Flood-fill the chroma-green background from the crop's border inward.
    border = np.zeros((h, w), dtype=bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    bg = flood_fill_background(a[:, :, :3], border)
    a[bg, 3] = 0
    # kill any stray magenta fringe from the divider line too, dilated a
    # couple px since a soft divider leaves a faint halo of its own. Where
    # the divider blends into a DARK character pixel (e.g. dark-red hair
    # right at a cell's top edge) the blend comes out dark too — confirmed
    # live at (71,0,34), fully opaque, which a brightness floor alone can't
    # see. Relative dominance (G clearly overpowered by both R and B) catches
    # that regardless of brightness — but a character whose own hair/clothes
    # ARE a saturated red (confirmed live: May's hair sampled at (236,62,91),
    # which trips the same relative test) makes this genuinely ambiguous by
    # color alone anywhere in the cell. A divider can only ever have bled
    # into the crop right at its outer edge, so restrict the relative test to
    # a thin border band — real hair deep inside the cell is never at risk,
    # only pixels close enough to the edge to plausibly be blend fringe.
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    EDGE = 8
    edge_band = np.zeros((h, w), dtype=bool)
    edge_band[:EDGE, :] = edge_band[-EDGE:, :] = edge_band[:, :EDGE] = edge_band[:, -EDGE:] = True
    # r>g+30/b>g+15 (relative dominance) still let real hair through at the
    # ragged edge of the blend gradient — some blend pixels pass, some don't,
    # by a few units either way, leaving a speckle of survivors instead of a
    # clean removal (confirmed live: May's hair, whose OWN saturated red also
    # satisfies relative dominance, made the margin too thin to separate the
    # two). What actually distinguishes a magenta divider from any character
    # color at every shade seen so far, including its dark blend into hair,
    # is G sitting almost exactly at zero (a divider is drawn G-less on
    # purpose, precisely so it keys out against G-heavy green) — real hair
    # samples at g=62+, nowhere close.
    # THE UNRESTRICTED CLAUSE BELOW EATS MAGENTA-HAIRED CHARACTERS, and the
    # comment above already knew it: May's hair samples at (236,62,91), which
    # satisfies r>120, b>40, g<r-25 and g<b-10 on every pixel of her head.
    # She came out of this cutter with her hair deleted — a face with a thin
    # dark outline where it used to be in the front and side rows, and a
    # headless coat in the back row. That is the "half a head" this whole
    # audit started from: not a bad generation at all, but the cutter
    # removing the character's defining feature because it is the same colour
    # as the divider it is hunting for.
    #
    # It cannot be settled by colour — the divider and her hair ARE the same
    # colour. It is settled by GEOMETRY instead: when the cell was cut
    # between the green gutters rather than through their middles, no divider
    # pixel can be inside the crop, so there is nothing to remove and the
    # test is skipped entirely.
    if divider_free:
        mag = np.zeros((h, w), dtype=bool)
    else:
        mag = ((r > 120) & (b > 40) & (g < r - 25) & (g < b - 10)) | \
              (edge_band & (g < 20) & (r > 30))
    dil = mag.copy()
    for dy in (-3, -2, -1, 0, 1, 2, 3):
        for dx in (-3, -2, -1, 0, 1, 2, 3):
            dil |= np.roll(np.roll(mag, dy, axis=0), dx, axis=1)
    a[dil, 3] = 0
    a[:, :, 3] = largest_component_only(a[:, :, 3])
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

    # REFUSE AN IMPLAUSIBLE GRID rather than cutting something out of it.
    #
    # The whole method depends on the model actually drawing the magenta
    # gridlines it was asked for, and it does not always: May's sheet came
    # back with the art perfect — pink hair, blue robe, full heads, three
    # clean rows — and ZERO magenta pixels anywhere in the image. With no row
    # dividers to find, this happily reported "1 rows x 11 cols" and wrote
    # three 30x343 slivers of coat as her front-facing walk cycle.
    #
    # A real sheet is 3 or 4 rows of 3. Anything else means the gridlines
    # were not found, and every frame cut from it is meaningless — so stop
    # here, loudly, instead of handing garbage to the next step. The caller
    # can regenerate; a sheet with no grid is a failed generation, not a
    # cutting problem.
    green_cut = False
    cell_rows = cell_cols = None
    # Fall back to the green gutters when the magenta grid did not resolve to
    # something usable — decided HERE, on the finished grid, rather than on a
    # raw count of detected lines: Chuck's sheet had three plausible-looking
    # row dividers and still collapsed to a 2x3 grid.
    if not (3 <= n_rows <= 4) or n_cols != 3:
        g_rows, g_cols = gutters_from_green(im)
        if g_rows and g_cols:
            print(f"gridlines unusable ({n_rows}x{n_cols}) — cutting on the "
                  f"green gutters instead: {len(g_rows)} rows x {len(g_cols)} cols")
            cell_rows, cell_cols = g_rows, g_cols
            n_rows, n_cols = len(g_rows), len(g_cols)
            green_cut = True

    if not (3 <= n_rows <= 4) or n_cols != 3:
        raise SystemExit(
            f"{sheet_path}: NO USABLE GRID — detected {n_rows} rows x {n_cols} cols, "
            "expected 3 or 4 rows of 3. The magenta (#FF00FF) gridlines are "
            "missing or unreadable AND the green gutters between the cells "
            "did not resolve either, so any cell boundary would be a guess "
            "and every frame cut from it a slice of whatever happened to be "
            "there. Regenerate the sheet."
        )
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
            if green_cut:
                (y0, y1), (x0, x1) = cell_rows[r], cell_cols[c]
            else:
                y0, y1 = row_bounds[r], row_bounds[r + 1]
                x0, x1 = col_bounds[c], col_bounds[c + 1]
            frame = cut_and_trim(im, y0, y1, x0, x1, inset=0 if green_cut else 4,
                                 divider_free=green_cut)
            out_path = os.path.join(out_dir, f"{char_id}_{name}_{c}.png")
            frame.save(out_path)
            print("wrote", out_path, frame.size)

if __name__ == "__main__":
    main()
