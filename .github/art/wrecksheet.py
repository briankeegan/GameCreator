#!/usr/bin/env python3
"""Generate and cut WRECK SHEETS — the single front door for derelict sprites.

    python3 .github/art/wrecksheet.py list     --game hypergolic-hull
    python3 .github/art/wrecksheet.py generate --game hypergolic-hull --batch 0
    python3 .github/art/wrecksheet.py cut      --game hypergolic-hull --batch 0

WHY A SHEET AND NOT ONE AT A TIME
---------------------------------
Same reason as every other sheet in this pipeline: ships drawn together cannot
drift, ships drawn separately always do. Twenty-three derelicts were fired off
one dispatch at a time and came back a set only by coincidence — different
scales, different amounts of grime, different ideas of what "damaged" looks
like, and several in colours the live ship has never been. A row drawn in one
pass shares one palette, one scale and one damage language by construction.

WHAT A WRECK HAS TO BE
----------------------
Recognisably the ship it came from. What the player weighs before spending a
shot on one is WHICH hull they opened — a Hauler is worth nine and an
Interceptor two — so a wreck that reads as generic wreckage is worth nothing to
them. Hence `wrecks` in the game's art-style.json: one short description per
ship, written from its live icon, quoted into the prompt beside the shared
`wreckRule`.

The sheet is drawn on flat pure white and keyed out here, which is what the
rest of the pipeline does (see profiles.py's note on `background`).
"""

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import imagegen                                     # noqa: E402
import profiles                                     # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
PER_SHEET = 4          # four across 1536px leaves each ship ~380px and a real gutter
WHITE = 236            # a pixel at or above this on every channel is background


def contract(game):
    path = ROOT / "games" / game / "art-style.json"
    if not path.exists():
        sys.exit(f"no art contract at {path}")
    return json.loads(path.read_text())


def wreck_list(game):
    """Every ship needing a wreck, in a STABLE order, so batch N is always the
    same four ships — a re-run of one batch must not silently redraw another."""
    style = contract(game)
    wrecks = style.get("wrecks")
    if not wrecks:
        sys.exit(f"games/{game}/art-style.json has no `wrecks` map to draw from")
    return sorted(wrecks.items())


def batches(game):
    items = wreck_list(game)
    return [items[i:i + PER_SHEET] for i in range(0, len(items), PER_SHEET)]


def sheet_path(game, n):
    return f"games/{game}/art-src/wrecksheet-{n}.png"


def build_prompt(game, group):
    style = contract(game)
    rule = style.get("wreckRule", "")
    lines = []
    for i, (stem, desc) in enumerate(group, start=1):
        lines.append(f"{i}. {desc}")
    return (
        f"A single horizontal row of exactly {len(group)} DERELICT spaceships on a FLAT PURE WHITE "
        "background, evenly spaced with clear white gaps between them, none touching or overlapping, "
        "none clipped by the edge of the frame.\n\n"
        "Draw all of them at the SAME scale, in the SAME style, with the SAME amount of damage and "
        "grime, as one matched set — they are a row from one sprite sheet.\n\n"
        "Left to right:\n" + "\n".join(lines) + "\n\n"
        f"Every one of them is a wreck, and a wreck means this: {rule}\n\n"
        "Keep each ship's own colours — they are different colours from each other and that is the "
        "point. No fire, no smoke, no sparks, no debris floating in the gaps, no text, no labels."
    )


def cmd_list(args):
    for n, group in enumerate(batches(args.game)):
        print(f"batch {n}: " + ", ".join(stem for stem, _ in group))


def cmd_generate(args):
    groups = batches(args.game)
    if args.batch >= len(groups):
        sys.exit(f"batch {args.batch} does not exist — there are {len(groups)}")
    group = groups[args.batch]
    prompt = build_prompt(args.game, group)
    if args.print_prompt:
        print(prompt)
        return
    cfg = profiles.PROFILES["wreck_sheet"]
    imagegen.generate(
        prompt,
        sheet_path(args.game, args.batch),
        size=cfg["size"], quality=cfg["quality"],
        background=cfg["background"], model=cfg["model"],
        force=args.force, kind="wreck_sheet",
    )


def columns_of_content(img, w, h):
    """Which x columns hold anything that is not background."""
    px = img.load()
    hit = []
    for x in range(w):
        for y in range(h):
            r, g, b = px[x, y][:3]
            if r < WHITE or g < WHITE or b < WHITE:
                hit.append(x)
                break
    return hit


def cmd_cut(args):
    from PIL import Image
    groups = batches(args.game)
    group = groups[args.batch]
    src = ROOT / sheet_path(args.game, args.batch)
    if not src.exists():
        sys.exit(f"no sheet at {src} — generate it first")
    img = Image.open(src).convert("RGB")
    w, h = img.size
    cols = columns_of_content(img, w, h)
    if not cols:
        sys.exit("that sheet is blank")

    # Split on the white gutters between ships.
    spans, start, prev = [], cols[0], cols[0]
    for x in cols[1:]:
        if x - prev > args.gutter:
            spans.append((start, prev))
            start = x
        prev = x
    spans.append((start, prev))

    # COUNT BEFORE CUTTING. A sheet that came back with three ships instead of
    # four, or with two of them touching, is a bad generation — say so and keep
    # the art out of icons/ rather than shipping whatever the split produced.
    if len(spans) != len(group):
        sys.exit(
            f"found {len(spans)} ships in {src.name}, expected {len(group)} "
            f"({', '.join(s for s, _ in group)}). Regenerate that batch."
        )

    rgba = Image.open(src).convert("RGBA")
    for (x0, x1), (stem, _) in zip(spans, group):
        piece = rgba.crop((x0, 0, x1 + 1, h))
        px = piece.load()
        for y in range(piece.height):
            for x in range(piece.width):
                r, g, b, _a = px[x, y]
                if r >= WHITE and g >= WHITE and b >= WHITE:
                    px[x, y] = (r, g, b, 0)
        piece = piece.crop(piece.getbbox())
        out = ROOT / "games" / args.game / "icons" / f"wreck-{stem}.png"
        piece.save(out)
        print(f"{out.relative_to(ROOT)}  {piece.width}x{piece.height}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("list", "generate", "cut"):
        p = sub.add_parser(name)
        p.add_argument("--game", required=True)
        if name != "list":
            p.add_argument("--batch", type=int, required=True)
        if name == "generate":
            p.add_argument("--force", action="store_true")
            p.add_argument("--print-prompt", action="store_true")
        if name == "cut":
            p.add_argument("--gutter", type=int, default=12,
                           help="white columns between two ships before they count as separate")
    args = ap.parse_args()
    {"list": cmd_list, "generate": cmd_generate, "cut": cmd_cut}[args.cmd](args)


if __name__ == "__main__":
    main()
