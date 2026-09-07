#!/usr/bin/env python3
"""Generate ONE dialogue portrait, from that character's spec.

    generate_portrait.py --game the-game --character may
    generate_portrait.py --game the-game --character may --print-prompt

WHY THIS EXISTS. Every other kind of character art in this repo is built from
`characters.<id>` in the game's art-style.json — generate_row.py builds the
walk/attack prompt from it, verify_sheet.py checks the finished sheet against
it. Portraits were the one exception: they had no front door, so they were
generated through the freeform "Generate image" Action with whatever prose
somebody typed that day. That is not a small gap, because the portrait is the
picture of a character a player looks at LONGEST — it fills the talk box for
every line they say — and it is the one nothing could hold to the spec.

The result was exactly what you would predict. The owner's report was "some
characters don't match their portraits": Rex's sprite is a red-haired man in a
gold robe and his portrait was somebody else, Chuck's portrait invented a
teal hoodie and a walrus moustache the plot never mentions, and those inventions
then got copied back INTO the specs as if they were facts. A detail typed into
a prompt survives exactly one generation; a detail in the spec survives every
one. So the portrait is built from the same spec as the sprite, by the same
function (`generate_row.spec_to_prompt`), and a character with no spec is
refused here for the same reason it is refused there — see CHARACTER_SHEETS.md.

WHAT IT DOES:
  1. reads the spec, refuses if there isn't one;
  2. builds the prompt from `portrait_prompt.txt` (the single copy of the
     recipe — edit it there and every future portrait inherits the fix);
  3. generates a bust on FLAT WHITE with margin to spare, into
     `games/<game>/art-src/<char>_portrait_raw.png` — kept, like every other
     raw, so the shipped file can be rebuilt without paying again;
  4. crops it with make_portrait.py into `games/<game>/art/<char>.png`.

Framing is NOT asked for in the prompt beyond "leave margin": the API has no
composition parameter (see profiles.py), so a portrait framed by the generator
is a portrait framed differently every time. It is generated loose and cropped
mechanically, which is what stops four portraits sitting at four zoom levels.

The one thing neither this nor make_portrait.py can decide is whether the
generator drew the right person. Look at the picture.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import imagegen                                    # noqa: E402  (shared transport)
import profiles                                    # noqa: E402  (per-kind settings)
from generate_row import spec_to_prompt            # noqa: E402  (ONE prompt builder)

ROOT = imagegen.ROOT
KIND = 'portrait'
PROMPT_FILE = Path(__file__).resolve().parent / 'portrait_prompt.txt'


def load_spec(game, character):
    """The spec, or a refusal that says how to fix it.

    NO SPEC, NO GENERATION — the same rule generate_row.py and the walk-sheet
    Action enforce. The spec has to exist BEFORE the art, or there is nothing
    for the portrait and the sprite to agree with.
    """
    style_path = ROOT / 'games' / game / 'art-style.json'
    if not style_path.is_file():
        sys.exit(f'error: {style_path} does not exist — every game needs its art '
                 'contract before any art is generated.')
    style = json.loads(style_path.read_text())
    spec = (style.get('characters') or {}).get(character)
    if not spec:
        known = ', '.join((style.get('characters') or {}).keys()) or '(none)'
        sys.exit(
            f'error: no spec for "{character}" in {style_path} under `characters`.\n'
            'Write the character spec FIRST — species, per-material hexes, `appears`, '
            'proportions, neverDraw — then run this again. Without it the prompt is '
            'whatever someone typed today, the portrait and the walk sheet are drawn '
            'from two different descriptions, and nothing can tell they disagree.\n'
            f'Specs in this game: {known}\n'
            'See .github/art/CHARACTER_SHEETS.md and `characterSpecRule` in that file.')
    return spec, style


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', required=True, help='game id, e.g. the-game')
    ap.add_argument('--character', required=True,
                    help='character id — must have a spec; the portrait ships as '
                         'games/<game>/art/<character>.png')
    ap.add_argument('--output', default=None,
                    help='override the shipped path (default games/<game>/art/<char>.png). '
                         'Use for an expression variant, e.g. nella_scream.')
    ap.add_argument('--note', default=None,
                    help='OPTIONAL extra for this run only — an expression or a moment '
                         '("mid-scream", "age nine"). The CHARACTER always comes from the '
                         'spec; this only says which moment of them to draw.')
    ap.add_argument('--quality', default=None, choices=['low', 'medium', 'high'])
    ap.add_argument('--force', action='store_true',
                    help='regenerate (and re-bill) even if the raw already exists')
    ap.add_argument('--print-prompt', action='store_true',
                    help='print the assembled prompt and stop — no generation, no cost')
    args = ap.parse_args()

    spec, style = load_spec(args.game, args.character)
    described = spec_to_prompt(spec, style)
    if args.note:
        described += ' ' + args.note.strip()
    prompt = PROMPT_FILE.read_text().strip().replace('{CHARACTER}', described)

    if args.print_prompt:
        print(prompt)
        return

    stem = Path(args.output).stem if args.output else args.character
    raw_rel = f'games/{args.game}/art-src/{stem}_portrait_raw.png'
    out_rel = args.output or f'games/{args.game}/art/{args.character}.png'

    prof = profiles.get(KIND)
    generated = imagegen.generate(prompt, raw_rel, prof['size'],
                                  args.quality or prof['quality'], args.force,
                                  background=prof['background'],
                                  model=prof['model'], kind=KIND)
    raw_abs = ROOT / raw_rel
    if not generated and not raw_abs.is_file():
        sys.exit('error: nothing generated and no raw on disk to crop.')

    # CROP MECHANICALLY, ALWAYS — including when the generation was skipped
    # because the raw already existed. The raw is the expensive half; re-cutting
    # it is free, and it is how a change to make_portrait.py reaches portraits
    # that were already paid for.
    out_abs = ROOT / out_rel
    out_abs.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / '.github/art/make_portrait.py'),
                    str(raw_abs), str(out_abs)], check=True)
    print(f'{out_rel} <- {raw_rel}')

    # NAME THE FILES THIS RUN WROTE, so the caller can commit exactly those and
    # nothing else. The workflow used to `git add` the game's whole art/ and
    # art-src/ directories, which is fine for one run and catastrophic for
    # thirteen at once: each job swept up the walk-sheet frames its NEIGHBOURS
    # were writing in the same minute, so every push raced on files it had no
    # business touching and twelve of thirteen portraits died in rebase
    # conflicts. A job commits what it made.
    gh_out = os.environ.get('GITHUB_OUTPUT')
    if gh_out:
        # EVERY file the run wrote, not just the two obvious ones. imagegen.py
        # also updates a `generated.json` provenance manifest beside the raw,
        # and leaving it out of the staged set is what actually killed twelve
        # paid-for portraits: the commit succeeded, the manifest stayed
        # unstaged, and `git pull --rebase` refuses to run on a dirty tree —
        # "cannot pull with rebase: You have unstaged changes", five times,
        # while the log talked about a push race that was not happening.
        manifest = Path(raw_rel).parent / 'generated.json'
        with open(gh_out, 'a') as fh:
            fh.write(f'shipped={out_rel}\n')
            fh.write(f'raw={raw_rel}\n')
            fh.write(f'manifest={manifest.as_posix()}\n')

    print('LOOK AT IT. Nothing here can tell whether it drew the right person.')


if __name__ == '__main__':
    main()
