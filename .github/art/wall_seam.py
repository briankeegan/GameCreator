#!/usr/bin/env python3
"""Find the Y where a room's back wall meets its floor in the composed
scene — the baseline every wall panel, and every prop standing flush
against that wall, has to share.

WHY THIS EXISTS: the bedroom's wall was placed at y=102 by reading a
brightened crop of the scene by eye. It looked plausible and was wrong —
the real seam is y=110, and every prop grounded to the wrong line (the
wall panels, the mirror, the nightstand) came out 8px too high together,
reported directly off a live screenshot ("everything's a little too
high"). Eyeballing a crop is a guess with a picture next to it; this
finds the seam the way an edge actually is one — the row where the
scene's own colour changes fastest, averaged over a strip wide enough to
cancel out furniture-shadow noise.

METHOD: a wall-to-floor seam is a horizontal edge, so it shows up as a
row-to-row jump in per-row brightness. Average brightness across a
vertical strip (an X range with nothing but bare wall/floor in it — no
furniture, no rug) collapses each row to one number; the row with the
largest jump to the row below it is the seam. Take at least two strips
in different parts of the frame — if they don't agree, one of them is
probably crossing something that isn't bare wall/floor (a shadow, a
skirting detail) and should be re-picked.

Usage:
  wall_seam.py <scene.png> --strip x0,x1 [--strip x0,x1 ...] \
               --search y0,y1 [--out overlay.png]

Prints each strip's best-guess seam Y and its gradient strength (a weak
gradient on a strip means it probably isn't clean — try a different X
range). Writes an overlay with a line at each strip's answer so you can
LOOK before trusting it, same as every other measurement in this
pipeline.
"""
import sys, argparse
import numpy as np
from PIL import Image, ImageDraw

W, H = 320, 200


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scene")
    ap.add_argument("--strip", action="append", required=True,
                    help="x0,x1 — a vertical strip with nothing but bare "
                         "wall/floor in it. Repeatable; use at least 2.")
    ap.add_argument("--search", default="0,%d" % (H - 1),
                    help="y0,y1 to search within (default: the whole frame)")
    ap.add_argument("--out", default="/tmp/wallseam.png")
    a = ap.parse_args()

    scene = Image.open(a.scene).convert("RGB").resize((W, H), Image.LANCZOS)
    arr = np.asarray(scene).astype(np.float32)
    y0, y1 = (int(t) for t in a.search.split(","))

    results = []
    for s in a.strip:
        x0, x1 = (int(t) for t in s.split(","))
        gray = arr[:, x0:x1, :].mean(axis=(1, 2))
        grad = np.abs(np.diff(gray))
        seg = grad[y0:y1]
        y = y0 + int(np.argmax(seg))
        results.append((x0, x1, y, float(grad[y])))
        print("strip x=%d-%d: seam at y=%d (gradient %.1f)" % (x0, x1, y, grad[y]))

    ys = [r[2] for r in results]
    if max(ys) - min(ys) > 3:
        print("\nWARNING: strips disagree by more than 3px (%s) — at least "
              "one is probably crossing something that isn't bare wall/floor "
              "(a shadow, a rug edge, a skirting detail). Re-pick strips "
              "before trusting either answer." % ys, file=sys.stderr)
    else:
        print("\nstrips agree within 3px — seam is approximately y=%d"
              % round(sum(ys) / len(ys)))

    vis = scene.convert("RGB").resize((W * 4, H * 4), Image.NEAREST)
    d = ImageDraw.Draw(vis)
    colors = [(0, 255, 0), (255, 128, 0), (0, 200, 255), (255, 0, 255)]
    for i, (x0, x1, y, _) in enumerate(results):
        c = colors[i % len(colors)]
        d.line([(x0 * 4, y * 4), (x1 * 4, y * 4)], fill=c, width=2)
    vis.save(a.out)
    print("-> %s (one line per strip, colour-matched to the printed order. "
          "LOOK before trusting this.)" % a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
