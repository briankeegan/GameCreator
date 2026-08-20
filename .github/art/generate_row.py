#!/usr/bin/env python3
"""Generate ONE verified sprite row — the single front door, for every caller.

    python3 .github/art/generate_row.py --game dog-punk --character hero --view front
    python3 .github/art/generate_row.py --game dog-punk --character hero --view side \
            --kind attack
    python3 .github/art/generate_row.py --game dog-punk --view back --print-prompt

WHY THIS EXISTS
---------------
A row used to be generated two different ways depending on who was asking. An
interactive session dispatched .github/workflows/generate-walkrow.yml, which
had the prompt assembly inlined in it. The Clubhouse autopilot, already running
inside a workflow, could not dispatch anything, so its prompt told it in PROSE
to read the canonical prompt file and fill it in by hand. Two copies of one
recipe, and the usual thing happened: the copies drifted, and the autopilot's
was the stale one.

So the recipe lives here, once, and the two callers differ only in TRANSPORT —
which .github/art/imagegen.py picks for them (an in-run broker if one is
listening, otherwise OPENAI_API_KEY; a model is never handed the key either
way). Everything else — which prompt file, how the character description is
assembled, the canvas, and the verification — is identical by construction
rather than by discipline.

WHAT IT GUARANTEES
------------------
A row that fails verification is DELETED, and the command exits non-zero. Bad
art cannot linger in art-src/ waiting to be picked up by a later build, which
is how a bad set reached a shipped sheet before.

The standard is .github/art/CHARACTER_SHEETS.md; the prompts are
walkgrid_prompt.txt and attacksheet_prompt.txt. Rooms have their own front
door, .github/art/room.py, for the same reason.
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import imagegen                                     # noqa: E402  (shared transport)

ROOT = imagegen.ROOT
PROMPTS = {'walk': '.github/art/walkgrid_prompt.txt',
           'attack': '.github/art/attacksheet_prompt.txt'}
# Landscape, always. A 3x3 grid on a square canvas clips its bottom row and on
# a tall canvas silently drops a column; a single row of three on 1536x1024 has
# not failed yet. See CHARACTER_SHEETS.md.
SIZE = '1536x1024'


def build_prompt(game, view, description=None):
    style_path = ROOT / 'games' / game / 'art-style.json'
    if not style_path.is_file():
        sys.exit(f'{style_path} does not exist — every game needs its art contract '
                 'before any art is generated. Copy games/_template/art-style.json.')
    style = json.loads(style_path.read_text())
    char = description or style.get('mainCharacter')
    if not char:
        sys.exit('No character description given and art-style.json has no mainCharacter.')
    locked = style.get('lockedDetails')
    if locked:
        # Locked details go in EVERY prompt, from the file, never from memory —
        # they are the details that drift when a prompt is retyped.
        char = f'{char} LOCKED DETAILS, identical in every frame: {locked}'
    colours = colour_anchors(style, args_character(description, style))
    if colours:
        char = f'{char} {colours}'
    return char, style


def args_character(description, style):
    """Which lockedColours entry this row is for — the main character unless a
    --description was passed, in which case try to match it by name."""
    if not description:
        return 'mainCharacter'
    table = style.get('lockedColours') or {}
    for key in table:
        if key != 'mainCharacter' and key.lower() in description.lower():
            return key
    return 'mainCharacter'


def colour_anchors(style, who):
    """EXACT HEX per material, stated in the prompt.

    THE FAILURE THIS FIXES, in full, because it cost this repo a dozen rounds:
    a prompt that says "warm orange-tan fur" leaves the generator free to pick
    the shade, and it picks a different one every image. build_sheet.py then
    snaps each pixel to the nearest lockedPalette colour — but a palette wide
    enough to hold fur, its shadow and brown boots contains BOTH a light orange
    and a mid brown, so a row drawn one step darker lands on a different
    palette entry and ships as a different-coloured animal. Dog Punk shipped a
    hero whose front and back rows were light orange and whose side row was
    mid-brown; walking left after walking down changed the dog's colour.

    Palette enforcement cannot fix this on its own: nearest-colour snapping
    preserves whatever the generator chose. The choice has to be removed at the
    prompt, which is what this does — the hexes come from the game's contract,
    so every row of every sheet asks for the same values.
    """
    table = style.get('lockedColours') or {}
    entry = table.get(who) or table.get('mainCharacter')
    if not entry:
        return ''
    if isinstance(entry, dict):
        entry = '; '.join(f'{k} {v}' for k, v in entry.items())
    return ('EXACT COLOURS — use these hex values and no other shades of them, '
            'flat and unmodulated, the same in every frame: ' + entry + '.')


def fill(template_path, char, view):
    text = (ROOT / template_path).read_text()
    if '---8<--- PROMPT STARTS ---8<---' not in text:
        body = text                                   # a plain single-prompt file
    else:
        body = text.split('---8<--- PROMPT STARTS ---8<---')[1] \
                   .split('---8<--- PROMPT ENDS ---8<---')[0]
    blocks = dict(re.findall(r'\{VIEW\} = (FRONT|SIDE|BACK) ROW\n-+\n(.*?)(?=\n\n\n|\Z)',
                             text, re.S))
    prompt = body.replace('{CHARACTER}', char)
    if '{VIEW}' in prompt:
        if view.upper() not in blocks:
            sys.exit(f'{template_path} has no {view.upper()} ROW block.')
        prompt = prompt.replace('{VIEW}', blocks[view.upper()].strip())
    return ' '.join(prompt.split())


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', required=True, help='game id, e.g. dog-punk')
    ap.add_argument('--character', default='hero', help='character id, used in the filename')
    ap.add_argument('--view', required=True, choices=['front', 'side', 'back'])
    ap.add_argument('--kind', default='walk', choices=['walk', 'attack'])
    ap.add_argument('--description', help='override the art-style.json mainCharacter')
    ap.add_argument('--quality', default='medium', choices=['low', 'medium', 'high'],
                    help='medium is enough for flat cartoon pixel art; high costs ~4x')
    ap.add_argument('--force', action='store_true',
                    help='regenerate (and re-bill) even if the output already exists')
    ap.add_argument('--print-prompt', action='store_true',
                    help='print the assembled prompt and stop — no generation, no cost')
    args = ap.parse_args()

    char, _ = build_prompt(args.game, args.view, args.description)
    prompt = fill(PROMPTS[args.kind], char, args.view)
    if args.print_prompt:
        print(prompt)
        return

    suffix = '_raw.png' if args.kind == 'walk' else '_atk_raw.png'
    out_rel = f'games/{args.game}/art-src/{args.character}_{args.view}{suffix}'
    out_abs = ROOT / out_rel
    if not imagegen.generate(prompt, out_rel, SIZE, args.quality, args.force):
        return

    # THE GATE. --mirrored only on the camera-on views: mirroring a side
    # profile turns it into the other direction, so the test is meaningless
    # there (see MIRROR_STEP_MAX in verify_sheet.py).
    cmd = [sys.executable, str(ROOT / '.github/art/verify_sheet.py'), 'raw', str(out_abs),
           '--frames', '3']
    if args.kind == 'walk':
        cmd.append('--walk')
        if args.view != 'side':
            # --steps-built with it: a front or back row's two step frames are
            # rebuilt from its standing frame by build_sheet.py --build-steps,
            # which is the standard recipe, so a same-foot-twice verdict on the
            # DRAWN steps is reported and not fatal — the frames it is judging
            # are discarded before anything ships, and the built ones are gated
            # on the sheet instead. Deleting the row for it throws away a good
            # standing frame (and a generation) over a defect that cannot reach
            # the game; that happened twice in one run before this was here.
            cmd += ['--mirrored', '--steps-built']
    if subprocess.run(cmd).returncode:
        # QUARANTINED, not deleted. The guarantee that matters is that a failed
        # row cannot be picked up by a later build — every build command names
        # an exact art-src/ path — and moving it one directory down keeps that
        # while leaving the evidence. Deleting it outright cost this repo real
        # time: a row that failed with "found 0 sprites" could not be looked
        # at, so there was no way to tell a badly drawn row (regenerate) from a
        # well-drawn row on a dirty non-white background (key it and keep it).
        reject = out_abs.parent / 'rejected' / out_abs.name
        reject.parent.mkdir(parents=True, exist_ok=True)
        out_abs.replace(reject)
        sys.exit(f'\n{out_rel} FAILED verification and was moved to '
                 f'{reject.relative_to(ROOT)}, so it cannot reach a sheet later. Read the '
                 'messages above, LOOK at the rejected file, then fix the prompt file (never '
                 'a one-off prompt — the fix has to outlive this run) and generate again.')
    print(f'{out_rel}: generated and verified')


if __name__ == '__main__':
    main()
