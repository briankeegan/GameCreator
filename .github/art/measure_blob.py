#!/usr/bin/env python3
"""Find one object's precise pixel bounding box within a composed scene,
using an established CV technique — never a hand-rolled flood fill.

WHY THIS EXISTS AND WHY IT IS DIFFERENT FROM THE THING THAT DOESN'T WORK
-------------------------------------------------------------------------
Automated matching of a prop's OWN art against the scene was tried four ways
(raw pixel difference, normalised cross-correlation, edge correlation, ORB
feature matching + RANSAC) and none of them work — see the "why automated
matching doesn't work here" note in docs/ROOM_ART_STANDARD.md §5. That is a
CROSS-IMAGE problem: two independently generated pictures of "the same"
object are not similar enough at the pixel level to correlate.

This is a different, tractable problem: given ONE picture (the scene), find
one object's own edges in it. No second image, no correlation.

WHAT WAS TRIED FIRST AND WHY IT'S GONE: a hand-rolled flood fill (grow a
region from a seed point, add a neighbour if it's within a colour tolerance
of a pixel already in the region) sounds like the obvious tool, and does
not work on this art — measured, not assumed. A single seed in the
bedroom's bed had NO usable tolerance at all: 11 kept the fill to one
pixel, 12 leaked to 71% of the whole 320x200 frame, with nothing usable in
between, because the object itself is several genuinely different colours
(purple canopy, brown-and-gold posts) and the edges BETWEEN them are close
in magnitude to the edge between the object and the background.

TWO METHODS, BOTH KEPT — pick per object, don't chase one universal tool:
  --method grabcut (default) — Rother/Kolmogorov/Blake. Given a rectangle
    with background margin, it iteratively fits Gaussian-mixture colour
    models for foreground and background and refines via graph cuts — a
    global optimum over the region, not a local pixel walk. Handles a
    multi-coloured object as ONE object because it models "object vs.
    background" as two distributions. Verified on the bed (agreed with a
    manual re-measurement to a couple of pixels) and the mirror. FAILS when
    the object doesn't contrast from its background by COLOUR — the
    bedroom's trunk is warm brown/gold sitting on a similarly warm red/gold
    rug, and grabCut found nothing foreground across several rect attempts,
    including a tightly-measured one.
  --method canny — Canny edge detection + cv2.findContours. Doesn't care
    about colour at all, only local intensity gradients — so it's the tool
    for an object that's low-contrast in colour but has strong internal
    edges (bands, rivets, straight sides), which is exactly what beat
    grabCut on the trunk: bbox came back within a few pixels of a manual
    grid reading, first try.
  Neither replaces the other — keep both, pick whichever fits the object in
  front of you. If both exist for a case, that's fine; more than one way to
  double-check a measurement is a feature.

Usage:
  measure_blob.py <scene.png> --rect x,y,w,h [--method grabcut|canny]
                   [--out blob.png] [--iters 5]
                   [--canny-lo 30] [--canny-hi 90] [--top 3] [--pick 0]

--rect is a bounding box around the object, in 320x200 room space.
  grabcut wants it GENEROUS, with background margin — it needs surrounding
  background to learn what background looks like.
  canny can be tighter since it isn't modelling background at all, but a
  little slack keeps whole edges from being clipped.

canny prints up to --top candidate contours (largest area first) with their
bboxes, draws the picked one in green and the runners-up in dim yellow on
the overlay, and uses candidate --pick (default 0 = largest) as the
measurement — if the largest contour turns out to be something else in the
scene (a rail, a shadow), rerun with --pick pointing at the right one.

Prints the found object's bounding box (x, y = ground point: bottom
centre, h, w — the same fields a props: entry needs) and writes an
overlay so you can SEE what was actually selected before trusting it —
render it, then look, same as every other measurement in this pipeline.

Requires opencv-python-headless (pip install opencv-python-headless) —
not a repo dependency, since this is a human-run measurement tool, not
something room.py verify calls in CI.
"""
import sys, argparse
import numpy as np
from PIL import Image, ImageDraw

try:
    import cv2
except ImportError:
    sys.exit("measure_blob.py needs opencv-python-headless: "
             "pip install opencv-python-headless")

W, H = 320, 200


def grabcut_bbox(img, rx, ry, rw, rh, iters):
    mask = np.zeros((H, W), np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(img, mask, (rx, ry, rw, rh), bgd, fgd, iters, cv2.GC_INIT_WITH_RECT)
    fg = np.where((mask == 2) | (mask == 0), 0, 1).astype(np.uint8)
    ys, xs = np.where(fg)
    if len(ys) == 0:
        raise SystemExit("grabcut found nothing foreground — widen --rect, "
                         "check the object is actually inside it, or try "
                         "--method canny if it's low-contrast against its "
                         "background")
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return [bbox], fg


def canny_candidates(img, rx, ry, rw, rh, lo, hi, top):
    crop = img[ry:ry + rh, rx:rx + rw]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, lo, hi)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise SystemExit("canny found no contours — widen --rect, or loosen "
                         "--canny-lo/--canny-hi")
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:top]
    bboxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        bboxes.append((rx + x, ry + y, rx + x + w, ry + y + h))
    return bboxes, None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scene")
    ap.add_argument("--rect", required=True,
                    help="x,y,w,h in 320x200 room space")
    ap.add_argument("--method", choices=["grabcut", "canny"], default="grabcut")
    ap.add_argument("--iters", type=int, default=5, help="grabcut only")
    ap.add_argument("--canny-lo", type=int, default=30)
    ap.add_argument("--canny-hi", type=int, default=90)
    ap.add_argument("--top", type=int, default=3,
                    help="canny only: how many candidate contours to show")
    ap.add_argument("--pick", type=int, default=0,
                    help="canny only: which candidate (0 = largest) is the "
                         "actual object")
    ap.add_argument("--out", default="blob.png")
    a = ap.parse_args()

    rx, ry, rw, rh = (int(t) for t in a.rect.split(","))
    scene = Image.open(a.scene).convert("RGB").resize((W, H), Image.LANCZOS)
    img = cv2.cvtColor(np.asarray(scene), cv2.COLOR_RGB2BGR)

    if a.method == "grabcut":
        boxes, fg = grabcut_bbox(img, rx, ry, rw, rh, a.iters)
    else:
        boxes, fg = canny_candidates(img, rx, ry, rw, rh, a.canny_lo, a.canny_hi, a.top)

    if a.pick >= len(boxes):
        raise SystemExit("--pick %d but only %d candidate(s) found" % (a.pick, len(boxes)))

    for i, (x0, y0, x1, y1) in enumerate(boxes):
        marker = "-> " if i == a.pick else "   "
        print("%scandidate %d: bbox x0=%d y0=%d x1=%d y1=%d  (w=%d h=%d, area=%d)"
              % (marker, i, x0, y0, x1, y1, x1 - x0, y1 - y0, (x1 - x0) * (y1 - y0)))

    x0, y0, x1, y1 = boxes[a.pick]
    print("props: entry fields — x: %d, y: %d, h: %d   (w: %d if forced)"
          % ((x0 + x1) // 2, y1, y1 - y0, x1 - x0))

    vis = scene.convert("RGBA")
    if fg is not None:
        ov = np.zeros((H, W, 4), np.uint8)
        ov[fg == 1] = (255, 60, 200, 110)
        vis.alpha_composite(Image.fromarray(ov, "RGBA"))
    d = ImageDraw.Draw(vis)
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        color = (0, 255, 0) if i == a.pick else (200, 200, 0)
        d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=color)
    d.rectangle([rx, ry, rx + rw - 1, ry + rh - 1], outline=(255, 0, 255))
    vis = vis.convert("RGB").resize((W * 4, H * 4), Image.NEAREST)
    vis.save(a.out)
    print("-> %s (green = picked bbox, dim yellow = other candidates, "
          "magenta = your --rect. LOOK before trusting this.)" % a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
