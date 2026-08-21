#!/usr/bin/env python3
"""Count how many floor tiles/flagstones/planks span a room's width, and
compare a shipped floor plate's own count against its scene's — instead of
eyeballing "does this look about the right scale" the way the lab's floor
was first fixed (regenerated once from a guessed description, still came
back 2x too coarse, only caught by actually counting both).

WHY THIS EXISTS: a floor's tile SCALE is a real, countable fact — how many
stones fit across the frame — and eyeballing it is exactly as unreliable as
eyeballing a wall's floor line was (see wall_seam.py). The lab's floor plate
was regenerated with a prose description ("many small flagstones") and came
back with ~11 stones across a scene that has ~21 — roughly 2x too large,
invisible in a side-by-side (which shows both at a glance but doesn't make
you COUNT) and only found by measuring both.

METHOD: a row of tiles has a joint (mortar line, plank seam, grout line)
between each one, which shows up as a local spike in column-to-column
brightness gradient along a clean horizontal strip of floor. Count the
spikes; that's the tile count for that row. Needs a floor with actual
discrete joints — grass, dirt, or a seamless texture has nothing to count
and this tool has nothing to offer there.

Usage:
  tile_scale.py <scene.png> --row y0,y1 [--out overlay.png]
  tile_scale.py <scene.png> --row y0,y1 --against <plate.png> [--out overlay.png]

With --against, also counts the same row in the second image and prints the
ratio — that ratio IS the scale mismatch: 2.0x means the plate's stones are
twice the scene's size (half as many of them), which is what you feed back
into a regeneration prompt as an exact target count, not an adjective.

Writes an overlay marking every detected joint so you can LOOK before
trusting the count — a threshold that's slightly off either double-counts
noise or misses real joints, same failure mode as every other measurement
tool in this pipeline.
"""
import sys, argparse
import numpy as np
from PIL import Image, ImageDraw

W, H = 320, 200


def count_joints(arr, y0, y1):
    row = arr[y0:y1, :, :].mean(axis=(0, 2))
    grad = np.abs(np.diff(row))
    thresh = grad.mean() + 1.5 * grad.std()
    idx = np.where(grad > thresh)[0]
    if len(idx) == 0:
        return [], grad
    clusters, cur = [], [idx[0]]
    for j in idx[1:]:
        if j - cur[-1] <= 2:
            cur.append(j)
        else:
            clusters.append(cur)
            cur = [j]
    clusters.append(cur)
    joints = [int(round(sum(c) / len(c))) for c in clusters]
    return joints, grad


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("--row", required=True, help="y0,y1 — a clean strip of "
                    "floor, no furniture, no rug")
    ap.add_argument("--against", help="a second image (e.g. the shipped "
                    "plate) to compare the same row against")
    ap.add_argument("--out", default="/tmp/tilescale.png")
    a = ap.parse_args()

    y0, y1 = (int(t) for t in a.row.split(","))

    def load(path):
        im = Image.open(path).convert("RGB").resize((W, H), Image.LANCZOS)
        return im, np.asarray(im).astype(np.float32)

    im1, arr1 = load(a.image)
    joints1, _ = count_joints(arr1, y0, y1)
    print("%s: %d tiles across the row (row y=%d-%d)" % (a.image, len(joints1) + 1, y0, y1))

    vis = im1.convert("RGB")
    if a.against:
        im2, arr2 = load(a.against)
        joints2, _ = count_joints(arr2, y0, y1)
        n1, n2 = len(joints1) + 1, len(joints2) + 1
        print("%s: %d tiles across the same row" % (a.against, n2))
        ratio = n1 / n2 if n2 else float("inf")
        print("\nratio: the second image's tiles are %.2fx the size of the first's "
              "(%.1f tiles vs %.1f) — feed the first count as the exact target "
              "if regenerating the second."
              % (max(ratio, 1 / ratio) if ratio else 0, n1, n2))
        combo = Image.new("RGB", (W * 2, H))
        combo.paste(im1, (0, 0))
        combo.paste(im2, (W, 0))
        vis = combo
        d = ImageDraw.Draw(vis)
        for x in joints1:
            d.line([(x, y0), (x, y1)], fill=(0, 255, 0), width=1)
        for x in joints2:
            d.line([(W + x, y0), (W + x, y1)], fill=(255, 128, 0), width=1)
    else:
        d = ImageDraw.Draw(vis)
        for x in joints1:
            d.line([(x, y0), (x, y1)], fill=(0, 255, 0), width=1)

    vis = vis.resize((vis.width * 4, vis.height * 4), Image.NEAREST)
    vis.save(a.out)
    print("-> %s (green = detected joints%s. LOOK before trusting the count "
          "— a bad threshold double-counts noise or misses real joints.)"
          % (a.out, ", orange = the second image's" if a.against else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
