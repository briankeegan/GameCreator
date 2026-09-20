#!/usr/bin/env python3
"""Cut a launcher's empty bay out of an icon and record where it is.

WHY. A launcher's ammunition is the one thing in this game that exists in
two places: in the tube, and in the air. Drawn as two separate pictures
they drift apart -- which is exactly what happened, a white-and-gold round
in the launcher and a dark gunmetal one in flight. One sprite, composited
into the bay, cannot drift by construction. It also makes "loaded" a thing
you read off the board rather than off a number, which is how everything
else in this game states itself: a charge prints its fuse, a gun shows its
pips, fog is painted.

HOW THE ANCHOR IS MEASURED, NOT TYPED. The generator paints the empty bay
flat chroma green (#00FF00) -- the same convention the walk sheets use for
a background that is not part of the art. This finds that region, makes it
transparent, and writes its centre and size, normalised to the sprite, to
<icons>/launcher-bays.json. The renderer reads that file. Nobody types a
pixel offset, and if the art is regenerated the anchor moves with it.

  python3 .github/art/cut_launcher_bay.py games/<id>/icons/<file>.png ...
  python3 .github/art/cut_launcher_bay.py --check games/<id>/icons/*.png
"""
import json
import os
import sys

import numpy as np
from PIL import Image

# How far from pure #00FF00 a pixel may sit and still count as bay. Loose
# on the off-channels because the model dithers a "flat" fill; tight on
# green being dominant, so hull greens and running lights are never eaten.
def bay_mask(rgb):
    r = rgb[:, :, 0].astype(int)
    g = rgb[:, :, 1].astype(int)
    b = rgb[:, :, 2].astype(int)
    return (g > 150) & (r < 120) & (b < 120) & (g - np.maximum(r, b) > 60)


def measure(path):
    im = Image.open(path).convert("RGBA")
    rgba = np.array(im)
    mask = bay_mask(rgba[:, :, :3]) & (rgba[:, :, 3] > 20)
    if mask.sum() < 16:
        return None
    ys, xs = np.nonzero(mask)
    h, w = mask.shape
    return {
        "cx": round(float((xs.min() + xs.max() + 1) / 2 / w), 4),
        "cy": round(float((ys.min() + ys.max() + 1) / 2 / h), 4),
        "w": round(float((xs.max() - xs.min() + 1) / w), 4),
        "h": round(float((ys.max() - ys.min() + 1) / h), 4),
        "px": int(mask.sum()),
    }, rgba, mask


def main(argv):
    check = "--check" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if not paths:
        print(__doc__)
        return 2
    bays = {}
    failed = 0
    # A ROUND IS DRAWN COLD. There is exactly one picture of each missile
    # and it carries no exhaust — the renderer draws the plume, which it
    # was already doing for the old vector dart and which animates, so a
    # round in a tube is the same sprite simply not burning. An earlier
    # version shipped the flame in the sprite and tried to MEASURE where
    # the body ended so the tube could crop it off; both rounds have gold
    # fins, gold is hot by any colour test, and it kept cutting a third of
    # the missile away. The picture not having a flame in it is the fix.
    for path in paths:
        found = measure(path)
        if not found:
            if check:
                continue
            print(f"skip {path}: no chroma bay in it")
            continue
        bay, rgba, mask = found
        name = os.path.splitext(os.path.basename(path))[0]
        if check:
            print(f"FAIL {path}: chroma bay still painted in — run this without --check")
            failed += 1
            continue
        # A DARK INTERIOR, NOT A HOLE. Cutting the bay to transparency
        # means an empty launcher shows the board through itself — you
        # would be looking at open space through the middle of a ship.
        # An empty tube is a tube you can see into, so the chroma becomes
        # the inside of the housing: near-black, and the round is drawn
        # on top of it when there is one loaded.
        out = rgba.copy()
        interior = np.array([18, 22, 30], dtype=np.uint8)
        for channel in range(3):
            out[:, :, channel] = np.where(mask, interior[channel], rgba[:, :, channel])
        out[:, :, 3] = np.where(mask, 255, rgba[:, :, 3])
        Image.fromarray(out, "RGBA").save(path)
        bays[name] = {k: v for k, v in bay.items() if k != "px"}
        print(f"cut  {path}: bay at {bay['cx']},{bay['cy']} size {bay['w']}x{bay['h']} ({bay['px']} px)")
    if check:
        return 1 if failed else 0
    if bays:
        out_dir = os.path.dirname(paths[0])
        out_path = os.path.join(out_dir, "launcher-bays.json")
        existing = {}
        if os.path.exists(out_path):
            existing = json.load(open(out_path))
        existing.update(bays)
        with open(out_path, "w") as fh:
            json.dump(existing, fh, indent=2, sort_keys=True)
            fh.write("\n")
        print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
