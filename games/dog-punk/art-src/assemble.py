"""Build games/dog-punk/hero_sheet.png from the raw generated images.

The generator hands back soft, anti-aliased "pixel art" on an off-white
background, with the grid drifting and the last row clipped. So we do the
mechanical part ourselves and stop asking the model for it:
  key the background -> find frames by gutter -> trim -> scale every frame in
  a row by ONE factor (so the character doesn't change size between frames)
  -> snap to a real pixel grid -> quantize the palette -> lay out a clean
  3x3 sheet with the feet on a common baseline.
"""
import numpy as np
from PIL import Image
import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-GameCreator/a80d316b-3dfb-5736-85e3-e32bdc33406b/scratchpad/dp')
from sheet import key_background, bands

CELL = 256          # final cell size in the sheet
PIXEL = 4           # nearest-neighbour upscale factor => 64px of "real" pixels
BODY_H = 168        # target height of the character body (idle frame) in a cell
BASELINE = 236      # y of the feet inside a cell


def frames_of(path):
    img, _ = key_background(path)
    a = np.array(img)
    alpha = a[:, :, 3] > 0
    out = []
    for r0, r1 in bands(alpha):
        row = []
        for c0, c1 in bands(alpha[r0:r1].T):
            row.append(img.crop((c0, r0, c1, r1)))
        out.append(row)
    return out


def trim(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def pixelate(im, target_h):
    """Scale to target height, then snap to a chunky pixel grid."""
    w, h = im.size
    sw = max(1, round(w * target_h / h / PIXEL))
    sh = max(1, round(target_h / PIXEL))
    small = im.resize((sw, sh), Image.LANCZOS)
    # Harden the alpha: no half-transparent fringe on a pixel sprite.
    a = np.array(small)
    a[:, :, 3] = np.where(a[:, :, 3] > 110, 255, 0)
    small = Image.fromarray(a)
    return small.resize((sw * PIXEL, sh * PIXEL), Image.NEAREST)


def locked_palette(style_path='games/dog-punk/art-style.json'):
    """The palette every sheet is snapped to, from art-style.json.

    Quantising each sheet on its own (median cut) is what let the hero and the
    enemies drift into different colour worlds, and let a regenerated frame
    come back a different shade of the same fur. One fixed palette, applied to
    everything, makes that impossible rather than merely unlikely.
    """
    import json
    hexes = json.load(open(style_path))['lockedPalette']
    return np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in hexes], dtype=np.int16)


def quantize(im, pal):
    """Map every opaque pixel to its nearest locked-palette colour."""
    a = np.array(im).astype(np.int32)
    rgb = a[:, :, :3]
    # int32, not int16: a squared channel difference reaches 65025 and three of
    # them sum past 32767, which silently wraps and maps every pixel to a
    # nonsense colour.
    d = ((rgb[:, :, None, :] - pal[None, None, :, :].astype(np.int32)) ** 2).sum(axis=3)
    a[:, :, :3] = pal[d.argmin(axis=2)]
    return Image.fromarray(a.astype('uint8'))


def build(rows, path, body_h=BODY_H):
    sheet = Image.new('RGBA', (CELL * 3, CELL * len(rows)), (0, 0, 0, 0))
    pal = locked_palette()
    for ri, row in enumerate(rows):
        row = [trim(f) for f in row]
        # One scale for the whole row, taken from the idle frame, so the
        # character is the same size in every frame of that direction.
        scale = body_h / row[0].size[1]
        for ci, f in enumerate(row[:3]):
            target = max(PIXEL, int(round(f.size[1] * scale)))
            s = quantize(pixelate(f, target), pal)
            x = ci * CELL + (CELL - s.size[0]) // 2
            y = ri * CELL + BASELINE - s.size[1]
            sheet.alpha_composite(s, (max(ci * CELL, x), max(ri * CELL, y)))
    sheet.save(path)
    print('wrote', path, sheet.size)


def frames_by_blob(path, want=3, min_frac=0.02):
    """Cut frames as connected blobs instead of by empty gutters.

    The gutter split assumes a clear empty column between sprites; when the
    generator lets two sprites overlap horizontally (a tail reaching back
    under the previous sprite) there is no such column and two frames merge
    into one. Each sprite is a single connected shape, so label the blobs and
    keep the `want` biggest, left to right.
    """
    from collections import deque
    img, _ = key_background(path)
    a = np.array(img)
    mask = a[:, :, 3] > 0
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    boxes = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or lab[sy, sx]:
                continue
            n += 1
            q = deque([(sy, sx)])
            lab[sy, sx] = n
            x0 = x1 = sx
            y0 = y1 = sy
            size = 0
            while q:
                y, x = q.popleft()
                size += 1
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n
                        q.append((ny, nx))
            boxes.append((size, x0, y0, x1, y1))
    # Blob ids are assigned in scan order; remember which id each kept box is
    # so the crop can be masked to that blob alone.
    ids = {}
    for i, b in enumerate(boxes, start=1):
        ids[b] = i
    boxes.sort(key=lambda b: -b[0])
    keep = [b for b in boxes[:want] if b[0] >= min_frac * min(boxes[0][0], h * w)]
    keep.sort(key=lambda b: b[1])
    out = []
    for b in keep:
        _, x0, y0, x1, y1 = b
        # Mask to THIS blob: neighbouring sprites can overlap this bounding
        # box (a tail reaching back under the previous one), and cropping the
        # raw image would drag their pixels into the frame.
        sub = np.array(img)[y0:y1 + 1, x0:x1 + 1].copy()
        sub[lab[y0:y1 + 1, x0:x1 + 1] != ids[b]] = (0, 0, 0, 0)
        out.append(Image.fromarray(sub))
    return out
