#!/usr/bin/env python3
"""Scale a floor plate to fill the room's frame.

A pass-2 plate comes back as a shape floating in white with however much margin
the generator felt like leaving. Shipped as-is, the room is smaller than the
frame: black bars down the sides, and every prop placed against it reads
cramped even when its own numbers are right. That is what a plate looks like
next to the composed scene it came from, and it is not obvious until you put
them side by side.

So: key the white out, trim to the shape's own bounding box, and scale it to
fill the frame with a stated margin. The silhouette is the walk mask, so this
sets the size of the walkable floor too — which is the point.

Usage: fit_plate.py <src.png> <out.png> [--margin 4] [--keep-aspect]
"""
import sys, argparse
import numpy as np
from PIL import Image

W, H = 320, 200
WHITE_TOL = 26


# A PLATE IS LIT ON ITS OWN, AND THE ROOM IS NOT.
#
# Pass 2 asks for a floor texture on flat white, so the generator lights it
# evenly and brightly — it has no idea it is going to be laid under a moody
# candlelit room. Every room assembled tonight came out markedly paler and
# flatter than the scene it was measured from, in a way that is invisible in
# any number and unmissable the moment you put the two side by side.
#
# So the plate is tone-matched to the floor of its own scene: take the median
# colour of the scene BELOW the wall/floor line, take the median of the plate,
# and scale the plate per channel so the two agree. Median rather than mean so
# a bright rug or a lantern pool in the scene cannot drag it, and a scale
# rather than a fixed tint so the plate keeps its own texture and contrast.
def match_tone(plate, scene_path):
    from PIL import Image as _I
    scene = _I.open(scene_path).convert("RGB").resize((W, H), _I.LANCZOS)
    sa = np.asarray(scene).astype(np.float32)
    # the floor is the bottom third: below anything standing against the wall
    ref = np.median(sa[int(H * 0.72):, :, :].reshape(-1, 3), axis=0)
    pa = np.asarray(plate).astype(np.float32)
    opaque = pa[..., 3] > 40
    if not opaque.any():
        return plate
    have = np.median(pa[..., :3][opaque], axis=0)
    gain = np.clip(ref / np.maximum(have, 1.0), 0.25, 2.5)
    rgb = np.clip(pa[..., :3] * gain, 0, 255)
    out = np.dstack([rgb, pa[..., 3:4]]).astype(np.uint8)
    print("   tone-matched to %s: gain %.2f/%.2f/%.2f"
          % (scene_path.split("/")[-1], gain[0], gain[1], gain[2]))
    return _I.fromarray(out, "RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--margin", type=int, default=4,
                    help="px of frame left around the floor, at 320x200")
    ap.add_argument("--keep-aspect", action="store_true",
                    help="don't stretch; fit inside the frame instead")
    ap.add_argument("--match", metavar="SCENE",
                    help="tone-match the plate to the floor of this composed "
                         "scene (pass 1). Strongly recommended: see match_tone.")
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGBA")
    arr = np.asarray(im).copy()
    alpha = arr[..., 3]
    if (alpha < 8).mean() <= 0.02:
        # no real alpha — the generator gave us flat white, so key it
        near_white = (arr[..., :3].astype(np.int16) > 255 - WHITE_TOL).all(axis=2)
        alpha = np.where(near_white, 0, 255).astype(np.uint8)
        arr[..., 3] = alpha

    ys, xs = np.where(alpha > 40)
    if not len(ys):
        print("nothing but background in %s" % a.src, file=sys.stderr)
        return 2
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    cut = Image.fromarray(arr[y0:y1, x0:x1], "RGBA")

    tw, th = W - a.margin * 2, H - a.margin * 2
    if a.keep_aspect:
        k = min(tw / cut.width, th / cut.height)
        tw, th = max(1, int(cut.width * k)), max(1, int(cut.height * k))
    cut = cut.resize((tw, th), Image.LANCZOS)
    if a.match:
        cut = match_tone(cut, a.match)

    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.alpha_composite(cut, ((W - tw) // 2, (H - th) // 2))
    out.save(a.out)
    print("%s  %dx%d -> filled %dx%d with a %dpx margin  -> %s"
          % (a.src.split("/")[-1], x1 - x0, y1 - y0, tw, th, a.margin, a.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
