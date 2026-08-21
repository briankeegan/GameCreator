#!/usr/bin/env python3
"""One command for a TILED level's art. The third front door, same shape as the
other two: characters are generate_row.py, rooms are room.py, and a level made
of repeating tiles is this.

  tileset.py generate <gameDir> ground|objects --n N --items "..."
  tileset.py cut      <gameDir> --tile texture:<raw>:0 --tile object:<raw>:1 ...
  tileset.py check    <gameDir>            render the level so a human looks
  tileset.py verify   <gameDir>            the gate; runs in CI
  tileset.py prompt   ground|objects       print a prompt, generate nothing

The standard is docs/TILED_LEVEL_STANDARD.md. Every check in `verify` is a
defect that SHIPPED to Dog Punk and was rejected on sight — a tiled level was
the one shape of art in this repo with a pipeline and no checker, which is
exactly how four separate defects reached a player in one go.

`generate` picks its transport the same way the other front doors do
(.github/art/imagegen.py): an in-run image broker if one is listening,
otherwise OPENAI_API_KEY. A model is never handed the key.
"""

import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PROMPTS = {"ground": "1_ground_sheet.txt", "objects": "2_object_sheet.txt"}
# Where each pass lands. Not a convention to remember — it is the contract
# between `generate` and `cut`.
RAW = {"ground": "tiles_ground_raw.png", "objects": "tiles_objects_raw.png"}


def sh(*cmd):
    print("+", " ".join(str(c) for c in cmd))
    return subprocess.run([str(c) for c in cmd]).returncode


def template(which):
    with open(os.path.join(HERE, "tileset_prompts", PROMPTS[which]), encoding="utf-8") as f:
        return f.read()


def fill(which, n, items, strip_notes=False):
    text = template(which)
    if strip_notes:
        # The leading # block is guidance for whoever reads the file. Sent
        # verbatim it asks the generator to draw the instructions.
        text = "\n".join(l for l in text.splitlines() if not l.startswith("#"))
    return text.replace("{{N}}", str(n)).replace("{{ITEMS}}", items).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("generate", help="generate one sheet into its canonical path")
    p.add_argument("game"); p.add_argument("which", choices=["ground", "objects"])
    p.add_argument("--n", required=True, help="how many tiles are on the sheet")
    p.add_argument("--items", required=True, help="what they are, left to right")
    p.add_argument("--quality", default="medium", choices=["low", "medium", "high"])
    p.add_argument("--force", action="store_true")

    p = sub.add_parser("prompt", help="print a prompt, generate nothing")
    p.add_argument("which", choices=["ground", "objects"])
    p.add_argument("--n", default="{{N}}"); p.add_argument("--items", default="{{ITEMS}}")

    p = sub.add_parser("cut", help="cut the raws into the shipped tile strip")
    p.add_argument("game"); p.add_argument("rest", nargs=argparse.REMAINDER)

    p = sub.add_parser("check", help="render the level so a human looks at it")
    p.add_argument("game"); p.add_argument("--out", default="/tmp")

    p = sub.add_parser("verify", help="the CI gate")
    p.add_argument("game")
    p.add_argument("--floors", default="0,1,2")

    a = ap.parse_args()

    if a.cmd == "prompt":
        print(fill(a.which, a.n, a.items))
        return 0

    game = a.game.rstrip("/")
    style = os.path.join(game, "art-style.json")
    strip = os.path.join(game, "tiles.png")

    if a.cmd == "generate":
        sys.path.insert(0, HERE)
        import imagegen, profiles
        prof = profiles.get("tileset_" + a.which)
        out = os.path.join(game, "art-src", RAW[a.which])
        if not imagegen.generate(fill(a.which, a.n, a.items, strip_notes=True), out,
                                 size=prof["size"], quality=a.quality or prof["quality"],
                                 force=a.force, background=prof["background"],
                                 model=prof["model"]):
            return 0
        print("\nwrote %s\nnext: tileset.py cut %s --tile ... (one per shipped tile, "
              "left to right)" % (out, game))
        return 0

    if a.cmd == "cut":
        rc = sh("python3", os.path.join(HERE, "build_tiles.py"),
                "--style", style, "--out", strip, *a.rest)
        if rc:
            return rc
        print("\nnext: tileset.py verify %s, then tileset.py check %s and LOOK at it"
              % (game, game))
        return 0

    if a.cmd == "check":
        # There is no substitute for seeing the floor laid out: a grid, a
        # chessboard of slabs, or a wall texture lying flat in the middle of the
        # room are all obvious in one glance and invisible in any number.
        return sh("python3", os.path.join(HERE, "preview_tiles.py"), game,
                  "--out", os.path.join(a.out, "tiles-%s.png" % os.path.basename(game)))

    if a.cmd == "verify":
        if not os.path.exists(strip):
            print("no %s — nothing to verify" % strip)
            return 0
        cmd = ["python3", os.path.join(HERE, "verify_tiles.py"), strip, "--floors", a.floors]
        if os.path.exists(style):
            cmd += ["--style", style]
        return sh(*cmd)

    return 1


if __name__ == "__main__":
    sys.exit(main())
