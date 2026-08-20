#!/usr/bin/env python3
"""Measure where props belong, by matching them against the composed scene.

WHY THIS EXISTS
---------------
The room standard says pass 1 — the composed scene — exists to be MEASURED, and
that props go back at the numbers you read off it. Read off by eye, those
numbers are wrong in a way that is obvious in the result and invisible in the
data: statues at two thirds of their real size, a tree floating a few pixels
off its own shadow, one prop nudged sideways because a path moved. Three rounds
of "that still looks wrong" went by before anyone worked out which of position,
size and count was actually off.

So this measures them. For every prop sprite, it searches the composed scene for
the best (x, y, scale) and prints the `props:` entry — ground point, height, and
a footprint derived from the sprite's own base.

HOW
---
It does NOT try to match the prop art to the scene. The props were generated
separately, so they are the same subject in the same style but not the same
pixels, and shape-correlating them turned out to be worse than useless: scored
by silhouette overlap, the SMALLEST template that fits inside a blob always
wins, so everything came back at the minimum scale with a perfect score.

Instead it measures the scene directly, which is what was wanted anyway:

  1. Reduce the scene to a foreground mask — everything that is not the floor.
     Floor classes (grass, path, water, ...) are given as HSV boxes, because
     the one part of a composed scene that is reliably describable is the
     surface the player walks on. Everything else, by definition, is a prop.
  2. Find the connected blobs of that mask. Each blob is an object.
  3. Report each blob's ground point (bottom centre), height, and width — the
     three numbers a prop entry needs — plus its dominant hue, which is
     normally enough to tell a pink cherry tree from a grey statue.

You then say which blob is which prop. That part is a judgement call and the
tool does not pretend otherwise; everything measurable is measured.

Usage:
  measure_props.py <scene.png> [--floor grass] [--floor path] [--min-px N]
                   [--overlay out.png]
"""
import sys, os, argparse
import numpy as np
from PIL import Image, ImageDraw

W, H = 320, 200

# Floor classes as HSV boxes: (hue_lo, hue_hi, sat_lo, val_lo, val_hi).
# Hue in degrees. These describe what the player WALKS on, which is the part of
# a composed scene that is reliably describable — everything else is a prop.
FLOOR_CLASSES = {
    "grass": (70, 150, 0.25, 0.05, 1.00),
    "path":  (30, 60, 0.20, 0.55, 1.00),
    "water": (150, 220, 0.10, 0.30, 1.00),
    "stone": (0, 360, 0.00, 0.15, 0.55),
}


def hsv(img):
    a = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(2), a.min(2)
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def foreground(scene, floors):
    """True where the scene is NOT floor — i.e. where an object is."""
    h, s, v = hsv(scene)
    is_floor = np.zeros(h.shape, bool)
    for name in floors:
        lo, hi, slo, vlo, vhi = FLOOR_CLASSES[name]
        is_floor |= (h >= lo) & (h <= hi) & (s >= slo) & (v >= vlo) & (v <= vhi)
    # alpha 0 (outside the room) is not an object either
    alpha = np.asarray(scene)[..., 3] > 40
    return (~is_floor) & alpha


def blobs(mask, min_px):
    """Connected components, 8-way, iterative so a big region can't blow the
    stack the way a recursive flood fill does."""
    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    out = []
    nbr = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            stack = [(y0, x0)]
            seen[y0, x0] = True
            pts = []
            while stack:
                y, x = stack.pop()
                pts.append((y, x))
                for dy, dx in nbr:
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if len(pts) >= min_px:
                out.append(pts)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene")
    ap.add_argument("--floor", action="append", default=None,
                    help="a floor class this scene has: " + ", ".join(FLOOR_CLASSES))
    ap.add_argument("--min-px", type=int, default=120,
                    help="ignore blobs smaller than this, at 320x200")
    ap.add_argument("--overlay", help="write a picture of what was found")
    a = ap.parse_args()
    floors = a.floor or ["grass"]

    scene = Image.open(a.scene).convert("RGBA").resize((W, H), Image.LANCZOS)
    fg = foreground(scene, floors)
    found = blobs(fg, a.min_px)

    hue, sat, val = hsv(scene)
    rows = []
    for pts in found:
        ys = [p[0] for p in pts]
        xs = [p[1] for p in pts]
        y0, y1, x0, x1 = min(ys), max(ys) + 1, min(xs), max(xs) + 1
        hs = np.array([hue[y, x] for y, x in pts])
        vs = np.array([val[y, x] for y, x in pts])
        rows.append(dict(x=(x0 + x1) // 2, y=y1, h=y1 - y0, w=x1 - x0,
                         px=len(pts), hue=float(np.median(hs)), val=float(np.median(vs))))
    rows.sort(key=lambda r: (-r["px"]))

    print("# measured off %s at %dx%d — floor classes: %s"
          % (os.path.basename(a.scene), W, H, ", ".join(floors)))
    print("# %-5s %-5s %-5s %-5s %-7s %-6s %s"
          % ("x", "y", "h", "w", "px", "hue", "val   (x,y = ground point: bottom centre)"))
    for r in rows:
        print("  %-5d %-5d %-5d %-5d %-7d %-6.0f %.2f"
              % (r["x"], r["y"], r["h"], r["w"], r["px"], r["hue"], r["val"]))

    if a.overlay:
        vis = scene.convert("RGB")
        d = ImageDraw.Draw(vis)
        for r in rows:
            x0 = r["x"] - r["w"] // 2
            d.rectangle([x0, r["y"] - r["h"], x0 + r["w"], r["y"]], outline=(255, 60, 200))
            d.line([r["x"] - 3, r["y"], r["x"] + 3, r["y"]], fill=(255, 255, 0))
        vis.resize((W * 3, H * 3), Image.NEAREST).save(a.overlay)
        print("# overlay -> %s" % a.overlay)
    return 0


if __name__ == "__main__":
    sys.exit(main())
