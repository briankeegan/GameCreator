#!/usr/bin/env python3
"""Extract the RULES out of a standard, so a run can read them cheaply.

    python3 .github/art/rules_card.py .github/art/CHARACTER_SHEETS.md
    python3 .github/art/rules_card.py --check .github/art/CHARACTER_SHEETS.md

WHY THIS EXISTS. The standards are written for a person deciding what to do,
so most of their bulk is WHY — which generation failed, what was tried, what
the numbers were. That history is why they work: a rule with its reason
attached survives, and a bare rule gets argued with. But a Clubhouse run does
not need the archaeology, and it pays for every token of it. Measured:
CHARACTER_SHEETS.md is ~7,100 tokens, of which the rules themselves are ~950.

The obvious fix — write a short version too — is the exact mistake this repo
keeps paying for: two copies of one truth, drifting apart, with no way to tell
which is stale. So the card is EXTRACTED, never written, and `--check` fails
the build when the committed card is not what the standard would produce now.
One source of truth, two lengths.

WHAT COUNTS AS A RULE. A heading, a table row, or a line whose first thing is
bold — which is how every normative statement in these documents is already
written ("**RIGHT is never drawn.** It is the side row mirrored..."). That
convention was not invented for this script; the script was written to match
what the standards already do. Prose that merely mentions something in bold
mid-sentence is not a rule and is left behind.
"""

import argparse
import pathlib
import re
import sys

BANNER = ("<!-- GENERATED from {src} by .github/art/rules_card.py — do not edit.\n"
          "     Edit the standard; the card is extracted from it and CI checks it "
          "matches. -->\n")


def extract(text):
    # The standards are hard-wrapped at ~78 columns, so a rule is usually
    # several physical lines. Unwrap paragraphs first: a rule cut off at its
    # line break ("a true fore/aft split: one foot planted ahead of the body,")
    # is worse than no card at all, because it reads as complete.
    paras, buf = [], []
    for raw in text.split("\n"):
        st = raw.strip()
        if not st or st.startswith(("#", "|", "```")):
            if buf:
                paras.append(" ".join(buf)); buf = []
            paras.append(raw)
            continue
        if st.startswith(("-", "*")) and buf:
            paras.append(" ".join(buf)); buf = []
        buf.append(st)
    if buf:
        paras.append(" ".join(buf))

    out, in_table = [], False
    for line in paras:
        st = line.strip()
        if st.startswith("|"):
            out.append(line.rstrip())
            in_table = True
            continue
        if in_table:
            in_table = False
        if st.startswith("#"):
            out.append(st)
            continue
        # A rule: the line LEADS with bold. Anything else — including a
        # paragraph that happens to bold a phrase halfway through — is
        # explanation, and explanation is what the card exists to leave out.
        m = re.match(r'^[-*]\s+\*\*(.+?)\*\*(.*)$', st) or re.match(r'^\*\*(.+?)\*\*(.*)$', st)
        if m:
            head, rest = m.group(1).strip(), m.group(2).strip()
            # Drop a fragment whose bold is a continuation of the line above
            # (a wrapped sentence), not the start of a statement.
            if head and (head[0].isupper() or head[0] in '`[' or head.isupper()):
                out.append(f'- **{head}** {rest}'.rstrip())
            continue
    # collapse the blank runs an extraction inevitably leaves behind
    card, prev_blank = [], False
    for l in out:
        blank = not l.strip()
        if not (blank and prev_blank):
            card.append(l)
        prev_blank = blank
    return "\n".join(card).strip() + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('standard')
    ap.add_argument('--check', action='store_true',
                    help='fail if the committed card is not what the standard produces now')
    a = ap.parse_args()

    src = pathlib.Path(a.standard)
    card_path = src.with_suffix('.rules.md')
    want = BANNER.format(src=src.as_posix()) + "\n" + extract(src.read_text())

    if a.check:
        if not card_path.exists():
            sys.exit(f'{card_path} is missing — run: python3 .github/art/rules_card.py {src}')
        if card_path.read_text() != want:
            sys.exit(f'{card_path} is STALE: {src} has changed since it was generated. '
                     f'Run: python3 .github/art/rules_card.py {src}\n'
                     'A rules card that no longer matches its standard is worse than none '
                     '— a run would be obeying rules nobody has agreed to any more.')
        print(f'{card_path}: up to date')
        return

    card_path.write_text(want)
    print(f'wrote {card_path}: {len(want)} B (~{len(want) // 4} tok) '
          f'from {len(src.read_text())} B (~{len(src.read_text()) // 4} tok)')


if __name__ == '__main__':
    main()
