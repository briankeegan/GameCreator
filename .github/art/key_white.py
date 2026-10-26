"""Key a flat-white background out of a generated icon, from the edges in.

The icon profile asks for flat pure white because transparency is refused by
the model and comes back as a beige wash besides (see .github/art/README.md).
What ships has to be cut to its own silhouette like every other icon in the
set, or it lands on the UI as a white rectangle.

FLOOD FROM THE BORDER, never "every white pixel". A pixel-value key eats the
white INSIDE the subject too — a highlight on a barrel, the lit face of a
plate — and leaves holes through the middle of the sprite that read as
damage. Only white connected to the edge is background.

    python3 .github/art/key_white.py <png> [--threshold 236]
"""
import sys
from collections import deque
from PIL import Image


def key_white(path, threshold=236):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()

    def is_white(xy):
        r, g, b, a = px[xy]
        return a > 0 and r >= threshold and g >= threshold and b >= threshold

    seen = [[False] * w for _ in range(h)]
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not seen[y][x] and is_white((x, y)):
                seen[y][x] = True
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y][x] and is_white((x, y)):
                seen[y][x] = True
                queue.append((x, y))

    cleared = 0
    while queue:
        x, y = queue.popleft()
        px[x, y] = (0, 0, 0, 0)
        cleared += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_white((nx, ny)):
                seen[ny][nx] = True
                queue.append((nx, ny))

    im.save(path)
    return cleared, w * h


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a.split("=")[0]: a.split("=")[-1] for a in sys.argv[1:] if a.startswith("--")}
    if not args:
        print(__doc__)
        sys.exit(2)
    thr = int(flags.get("--threshold", 236))
    for target in args:
        cleared, total = key_white(target, thr)
        share = cleared / total * 100
        print(f"{target}: keyed {cleared} px ({share:.1f}% of the frame) at threshold {thr}")
        if share < 5:
            print("  WARNING: almost nothing was keyed — is this already cut, or not on white?")
        if share > 95:
            print("  WARNING: nearly the whole frame went — the subject may have been white too")
