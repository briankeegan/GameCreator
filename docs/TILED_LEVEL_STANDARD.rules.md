<!-- GENERATED from docs/TILED_LEVEL_STANDARD.md by .github/art/rules_card.py — do not edit.
     Edit the standard; the card is extracted from it and CI checks it matches. -->

# Tiled level art standard
| the level is… | standard | front door |
|---|---|---|
| a grid of repeating tiles | **this document** | `.github/art/tileset.py` |
| one picture per room | `docs/ROOM_ART_STANDARD.md` | `.github/art/room.py` |
| characters that walk and fight | `.github/art/CHARACTER_SHEETS.md` | `.github/art/generate_row.py` |
## The rule
- **A tiled level is TWO SHEETS, generated separately, and the seam is made by the cutter — never asked for.**
- **Sheet 1 — texture tiles.** The floor and the walls. Each one is a *material* seen from directly above, opaque, filling its square edge to edge.
- **Sheet 2 — object tiles.** Obstacles, gates, puddles — anything drawn *on top of* a floor tile. Cut out on flat white and keyed to transparency.
## Why — five defects, all of which shipped in one pass
## Three more, from the pass that fixed those
## Contrast is part of the level, not the characters
## Pipeline
# 1. the two sheets — same command from anywhere (a person, the "Generate
#    tileset sheet" Action, or the Clubhouse autopilot):
# 2. cut them into the shipped strip, one --tile per cell, left to right
# 3. the gate, then the picture you have to actually look at
## Checklist
