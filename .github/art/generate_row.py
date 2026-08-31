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
import profiles                                    # noqa: E402  (per-kind settings)

ROOT = imagegen.ROOT
PROMPTS = {'walk': '.github/art/walkgrid_prompt.txt',
           'attack': '.github/art/attacksheet_prompt.txt',
           'roll': '.github/art/rollsheet_prompt.txt'}
# Landscape, always. A 3x3 grid on a square canvas clips its bottom row and on
# a tall canvas silently drops a column; a single row of three on 1536x1024 has
# not failed yet. See CHARACTER_SHEETS.md.
# Canvas, quality, background and which verification flags apply all live in
# profiles.py, keyed by what is being drawn — see the reasoning there.


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


def spec_to_prompt(spec):
    """Turn a character spec into the description the generator is given.

    The spec is the single source of truth (see `characterSpecRule` in a game's
    art-style.json). Building the prompt FROM it every time is the half that
    PREVENTS drift; verify_sheet.py checking finished sheets against the same
    spec is the half that CATCHES it when prevention fails. A detail that lives
    only in a prompt someone typed survives exactly one generation — that is
    how Beverly lost her mohawk in the attack sheet while every prompt anyone
    wrote still said "tall pink mohawk".
    """
    parts = [f"{spec.get('name', 'the character')}: {spec.get('species', '')}".strip()]
    mats = []
    for mat, info in (spec.get('materials') or {}).items():
        if not isinstance(info, dict):
            continue
        cols = ', '.join(f'{role} {hexc}' for role, hexc in info.items()
                         if isinstance(hexc, str) and hexc.startswith('#'))
        bit = f'{mat} ({cols})' if cols else mat
        if str(info.get('appears', 'always')).lower() == 'always':
            bit += ' — MUST be clearly visible in EVERY frame'
        if info.get('note'):
            bit += f'. {info["note"]}'
        mats.append(bit)
    if mats:
        parts.append('EXACT MATERIALS AND COLOURS — every frame uses these and no others: '
                     + '; '.join(mats) + '.')
    if spec.get('proportions'):
        parts.append(spec['proportions'])
    if spec.get('neverDraw'):
        parts.append('NEVER, in any frame: ' + '; '.join(spec['neverDraw']) + '.')
    return ' '.join(parts)


def build_prompt(game, view, description=None, character='hero'):
    style_path = ROOT / 'games' / game / 'art-style.json'
    if not style_path.is_file():
        sys.exit(f'{style_path} does not exist — every game needs its art contract '
                 'before any art is generated. Copy games/_template/art-style.json.')
    style = json.loads(style_path.read_text())

    spec = (style.get('characters') or {}).get(character)
    if description:
        char = description
    elif spec:
        return spec_to_prompt(spec), style
    else:
        char = style.get('mainCharacter')
        if not char:
            sys.exit(f'No spec for "{character}" in art-style.json `characters`, no '
                     '--description, and no mainCharacter to fall back on. Write the '
                     'character spec (see .github/art/CHARACTER_SHEETS.md) — without it '
                     'nothing about this character is repeatable between generations.')
        print(f'note: no `characters.{character}` spec; falling back to the old prose '
              'mainCharacter field. Prose drifts between generations and cannot be '
              'checked — writing the spec is what stops that.', file=sys.stderr)
    locked = style.get('lockedDetails')
    if locked:
        char = f'{char} LOCKED DETAILS, identical in every frame: {locked}'
    # Only on the no-spec path: a spec already carries its hexes per material,
    # and repeating the whole lockedColours blob after it just says the same
    # thing twice in a less specific way.
    anchors = colour_anchors(style, args_character(description, style))
    if anchors:
        char = f'{char} {anchors}'
    return char, style


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
    ap.add_argument('--kind', default='walk', choices=['walk', 'attack', 'roll'])
    ap.add_argument('--description', help='override the art-style.json mainCharacter')
    ap.add_argument('--quality', default=None, choices=['low', 'medium', 'high'],
                    help='default comes from profiles.py for this kind of art; '
                         'medium is enough for flat cartoon pixel art, high costs ~4x')
    ap.add_argument('--force', action='store_true',
                    help='regenerate (and re-bill) even if the output already exists')
    ap.add_argument('--print-prompt', action='store_true',
                    help='print the assembled prompt and stop — no generation, no cost')
    args = ap.parse_args()

    char, _ = build_prompt(args.game, args.view, args.description, args.character)
    prompt = fill(PROMPTS[args.kind], char, args.view)
    if args.print_prompt:
        print(prompt)
        return

    suffix = {'walk': '_raw.png', 'attack': '_atk_raw.png', 'roll': '_roll_raw.png'}[args.kind]
    out_rel = f'games/{args.game}/art-src/{args.character}_{args.view}{suffix}'
    out_abs = ROOT / out_rel
    prof = profiles.get(args.kind)
    if not imagegen.generate(prompt, out_rel, prof['size'],
                             args.quality or prof['quality'], args.force,
                             background=prof['background'],
                             model=prof['model'], kind=args.kind):
        return

    # THE GATE. Which flags apply is a property of what was drawn, so it comes
    # from the profile rather than from an if-ladder here that has to be kept
    # in step with the cutter's.
    flags = profiles.verify_args(args.kind, args.view)
    cmd = [sys.executable, str(ROOT / '.github/art/verify_sheet.py'), 'raw',
           str(out_abs)] + (flags or [])
    # STYLE REFERENCE: another raw of the same character AND SAME KIND, so a
    # row drawn in a different style than the rest is caught before it
    # reaches a sheet. Raw against raw — a raw and a cut sheet are not on the
    # same scale and comparing them passes everything. Newest first, since
    # that is what the rest of the character is being brought toward.
    # NEWEST BY COMMIT DATE, NOT BY MTIME. git does not preserve mtimes: a
    # fresh CI checkout writes every file at the same instant, so "the most
    # recent file on disk" is arbitrary there. It picked a raw from an old
    # generation as the reference and rejected a good row for not matching art
    # nobody has used in weeks. Ask git, which actually knows.
    #
    # EXACT NAME MATCH, NOT A LOOSE GLOB. This used to be
    # f'{character}_*_raw.png' — matching ANY file shaped like that, from ANY
    # era of this character's naming history. Dog Punk had a legacy
    # hero_atk_back_raw.png (predating this tool's own hero_back_atk_raw.png
    # convention) still sitting in art-src/, never used by the actual build —
    # and the loose glob picked it as the reference for a fresh regeneration,
    # rejecting good art twice for "different style" against a file nothing
    # ships from. A candidate now has to be the SAME shape this tool itself
    # would write (character_view_raw.png for walk, character_view_atk_raw.png
    # for attack) — a stray or renamed-convention file simply isn't a
    # candidate, for this character or any other.
    ref = None
    valid_views = ('front', 'side', 'back')
    cands = [p for p in out_abs.parent.glob(f'{args.character}_*{suffix}')
             if p != out_abs and 'rejected' not in str(p)
             and p.name in {f'{args.character}_{v}{suffix}' for v in valid_views}]
    if cands:
        try:
            newest = subprocess.run(
                ['git', 'log', '-1', '--format=%H', '--name-only', '--'] +
                [str(c.relative_to(ROOT)) for c in cands],
                cwd=ROOT, capture_output=True, text=True, timeout=30).stdout.split('\n')
            named = [l.strip() for l in newest if l.strip().endswith('_raw.png')]
            if named:
                ref = ROOT / named[0]
        except Exception:
            ref = None
        if ref is None or not ref.is_file():
            ref = sorted(cands)[0]
    if ref:
        cmd += ['--style-ref', str(ref)]
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
