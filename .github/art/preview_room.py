#!/usr/bin/env python3
"""Composite a room from its floor plate and props, and check it against the
composed scene it was measured from.

WHY
---
Props are placed by numbers, and numbers are exactly the thing nobody can check
by reading them. Placed by eye against a grid, the Anarchy Garden's statues came
out at two thirds of their size and its trees a few pixels off their own
shadows, and three rounds of "that still looks wrong" went by before the cause
was found.

The cheap, honest test is the one you would do with tracing paper: lay the
assembled room over the composed scene it came from and look at whether the
props land on top of the things they replaced. Anything mis-sized or misplaced
shows up immediately as a doubled edge.

This composites the room the same way the game does — prop.h is a height,
width follows the art's aspect, x/y is the ground point (bottom centre) — so
what it shows is what the game will draw, without a browser in the loop.

There is also a --fit mode, which stops this being an eyeball exercise. Given
the composed scene, it searches a window around each prop's current position
and scale for the placement whose silhouette best matches what is actually in
the scene there, and prints a corrected `props:` block. Scored by
intersection-over-union, deliberately: scored by plain overlap, the SMALLEST
template that fits inside a blob wins every time, which is how the first
attempt at this returned every prop at the minimum size with a perfect score.

Usage:
  preview_room.py <game-dir> <room> [--scene art-src/<room>_scene.png]
                  [--out preview.png] [--mode blend|side|flip]
  preview_room.py <game-dir> <room> --scene <scene.png> --fit
                  [--floor grass --floor path] [--search 24] [--scale 0.55,1.7]
"""
import sys, os, re, argparse
import numpy as np
from PIL import Image

W, H = 320, 200
SCALE = 3


def read_props(story_path, room):
    """Pull one room's props out of story.js.

    Deliberately a regex over the source rather than a JS parse: story.js is
    plain object literals, this only ever needs the numbers, and a parser would
    be one more thing to keep working."""
    src = open(story_path, encoding="utf-8").read()
    start = src.index("\n    %s: {" % room)
    end = src.index("\n    },", start)
    block = src[start:end]
    props = []
    for m in re.finditer(r"\{\s*art:\s*\"([^\"]+)\"([^}]*(?:\{[^}]*\}[^}]*)*)\}", block):
        art, rest = m.group(1), m.group(2)
        def num(key):
            mm = re.search(r"\b%s:\s*(-?\d+)" % key, rest)
            return int(mm.group(1)) if mm else None
        props.append(dict(art=art, x=num("x"), y=num("y"), h=num("h"),
                          w=num("w"), flat=("flat: true" in rest)))
    return props


def compose(game_dir, room):
    art = os.path.join(game_dir, "art")
    plate = Image.open(os.path.join(art, "bg-%s.png" % room)).convert("RGBA").resize((W, H), Image.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (18, 12, 26, 255))
    canvas.alpha_composite(plate)

    props = read_props(os.path.join(game_dir, "story.js"), room)
    # flat ground cover paints with the floor; everything else sorts by its
    # ground point, exactly as app.js does
    for p in [q for q in props if q["flat"]] + sorted([q for q in props if not q["flat"]],
                                                      key=lambda q: q["y"]):
        path = os.path.join(art, p["art"] + ".png")
        if not os.path.exists(path):
            print("  missing art: %s" % p["art"], file=sys.stderr)
            continue
        im = Image.open(path).convert("RGBA")
        h = p["h"] or 40
        w = p["w"] if p["w"] is not None else max(1, round(h * im.width / im.height))
        im = im.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)
        if p["flat"]:
            canvas.alpha_composite(im, (int(p["x"] - im.width / 2), int(p["y"] - im.height / 2)))
        else:
            canvas.alpha_composite(im, (int(p["x"] - im.width / 2), int(p["y"] - im.height)))
    return canvas.convert("RGB"), props


# Floor classes as HSV boxes. The one part of a composed scene that is reliably
# describable is the surface the player walks on; everything else, by
# definition, is a prop. Hue in degrees.
FLOOR_CLASSES = {
    "grass": (70, 150, 0.25, 0.05, 1.00),
    "path":  (30, 62, 0.20, 0.50, 1.00),
    "water": (150, 220, 0.10, 0.30, 1.00),
    "tile":  (0, 360, 0.00, 0.35, 0.95),
}


def hsv(img):
    a = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(2), a.min(2)
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6,
                 np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def scene_foreground(scene, floors):
    """True where the scene is NOT floor — i.e. where a prop stands."""
    h, s, v = hsv(scene)
    is_floor = np.zeros(h.shape, bool)
    for name in floors:
        lo, hi, slo, vlo, vhi = FLOOR_CLASSES[name]
        is_floor |= (h >= lo) & (h <= hi) & (s >= slo) & (v >= vlo) & (v <= vhi)
    inside = np.asarray(scene.convert("RGBA"))[..., 3] > 40
    return ((~is_floor) & inside).astype(np.float32)


def correlate(field, kernel):
    """Correlate a small kernel over a field with an FFT. The search is
    (positions x scales) and a python loop over that takes minutes."""
    fh, fw = field.shape
    kh, kw = kernel.shape
    fs = np.fft.rfft2(field, s=(fh + kh, fw + kw))
    ks = np.fft.rfft2(kernel[::-1, ::-1], s=(fh + kh, fw + kw))
    out = np.fft.irfft2(fs * ks, s=(fh + kh, fw + kw))
    return out[kh - 1:kh - 1 + fh, kw - 1:kw - 1 + fw]


def fit(game_dir, room, scene_path, floors, search, scale_lo, scale_hi):
    """For each prop, the (x, y, h) near its current one that best matches the
    composed scene. Returns rows of (prop, x, y, h, iou)."""
    art = os.path.join(game_dir, "art")
    scene = Image.open(scene_path).convert("RGBA").resize((W, H), Image.LANCZOS)
    fg = scene_foreground(scene, floors)
    props = read_props(os.path.join(game_dir, "story.js"), room)

    rows = []
    for p in props:
        if p["flat"]:
            rows.append((p, p["x"], p["y"], p["h"], None))
            continue
        path = os.path.join(art, p["art"] + ".png")
        if not os.path.exists(path):
            rows.append((p, p["x"], p["y"], p["h"], None))
            continue
        sprite = Image.open(path).convert("RGBA")
        aspect = sprite.width / sprite.height
        base_h = p["h"] or 40
        best = None
        for ph in range(max(8, int(base_h * scale_lo)), int(base_h * scale_hi) + 1, 2):
            pw = max(1, int(round(ph * aspect)))
            if pw >= W or ph >= H:
                continue
            k = (np.asarray(sprite.resize((pw, ph), Image.LANCZOS))[..., 3] > 128).astype(np.float32)
            area = float(k.sum())
            if area < 20:
                continue
            inter = correlate(fg, k)
            box = correlate(fg, np.ones_like(k))
            iou = inter / np.maximum(area + box - inter, 1e-6)
            # only look near where the prop already is; a global search finds a
            # better-scoring but wrong object every time
            cx, cy = p["x"], p["y"]
            for dy in range(-search, search + 1, 2):
                for dx in range(-search, search + 1, 2):
                    x0 = cx + dx - pw // 2
                    y0 = cy + dy - ph
                    if x0 < 0 or y0 < 0 or x0 + pw > W or y0 + ph > H:
                        continue
                    val = float(iou[y0, x0])
                    if best is None or val > best[0]:
                        best = (val, cx + dx, cy + dy, ph)
        if best is None:
            rows.append((p, p["x"], p["y"], p["h"], None))
        else:
            rows.append((p, best[1], best[2], best[3], best[0]))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("game_dir")
    ap.add_argument("room")
    ap.add_argument("--scene")
    ap.add_argument("--out", default="preview.png")
    ap.add_argument("--mode", default="blend", choices=["blend", "side", "flip"])
    ap.add_argument("--fit", action="store_true",
                    help="print a corrected props block, fitted to the scene")
    ap.add_argument("--floor", action="append", default=None)
    ap.add_argument("--search", type=int, default=24, help="+/- px to search")
    ap.add_argument("--scale", default="0.55,1.7", help="lo,hi multiples of h")
    a = ap.parse_args()

    if a.fit:
        if not a.scene:
            print("--fit needs --scene", file=sys.stderr)
            return 2
        lo, hi = (float(t) for t in a.scale.split(","))
        rows = fit(a.game_dir, a.room, a.scene, a.floor or ["grass"], a.search, lo, hi)
        print("      props: [")
        for p, x, y, h, iou in rows:
            extra = ""
            if p["w"] is not None:
                extra = ", w: %d" % p["w"]
            if p["flat"]:
                print('        { art: "%s", x: %d, y: %d, h: %d%s, flat: true },'
                      % (p["art"], x, y, h, extra))
            else:
                print('        { art: "%s", x: %d, y: %d, h: %d%s, base: { rx: %d, ry: %d } },   // fit %s'
                      % (p["art"], x, y, h, extra, max(5, h // 5), max(3, h // 12),
                         ("%.2f" % iou) if iou is not None else "n/a"))
        print("      ],")
        return 0

    built, props = compose(a.game_dir, a.room)
    print("composed %s from %d props" % (a.room, len(props)))

    if not a.scene:
        built.resize((W * SCALE, H * SCALE), Image.NEAREST).save(a.out)
        print("-> %s" % a.out)
        return 0

    scene = Image.open(a.scene).convert("RGB").resize((W, H), Image.LANCZOS)
    if a.mode == "blend":
        shot = Image.blend(scene, built, 0.5)
    elif a.mode == "flip":
        shot = Image.new("RGB", (W, H * 2))
        shot.paste(scene, (0, 0)); shot.paste(built, (0, H))
    else:
        shot = Image.new("RGB", (W * 2, H))
        shot.paste(scene, (0, 0)); shot.paste(built, (W, 0))
    shot.resize((shot.width * SCALE, shot.height * SCALE), Image.NEAREST).save(a.out)
    print("-> %s  (%s against %s)" % (a.out, a.mode, os.path.basename(a.scene)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
