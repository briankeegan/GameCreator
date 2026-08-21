#!/usr/bin/env bash
# Rebuild every shipped art file for Dog Punk from the raws in art-src/.
#
# THIS USED TO BE 5.6KB OF PROSE INSIDE art-style.json — a third of that file,
# read into context every single time anything opened the game's art contract,
# including by a model that only wanted the palette. Worse, prose commands go
# stale silently: nothing runs them, so nothing notices when a path changes.
#
# As a script it is cheap to ignore and impossible to be quietly wrong about:
# run it and the shipped sheets are reproduced byte for byte. Shipped art is
# never hand-edited; it is always rebuilt from art-src/ by this file.
#
#   ./games/dog-punk/rebuild-art.sh            rebuild the sheets and tiles
#   ./games/dog-punk/rebuild-art.sh --verify   rebuild, then run every gate
#
# Regenerating a RAW is a separate, billable step and is deliberately not here:
#   .github/art/generate_row.py   one character row (walk or attack)
#   .github/art/tileset.py        the level's two tile sheets
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== the hero's walk sheet =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/hero_sheet.png --row games/dog-punk/art-src/hero_front_raw.png --row games/dog-punk/art-src/hero_side_raw.png --row games/dog-punk/art-src/walk_back_v13_raw.png --build-steps 0,2

echo "== clean the attack raws (see note below) =="
python3 games/dog-punk/art-src/clean_raw.py games/dog-punk/art-src/hero_atk_front_raw.png games/dog-punk/art-src/hero_atk_side_raw.png games/dog-punk/art-src/hero_atk_back_raw.png

echo "== the hero's attack sheet =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/hero_attack_sheet.png --row games/dog-punk/art-src/hero_front_atk_raw.png --row games/dog-punk/art-src/hero_side_atk_raw.png --row games/dog-punk/art-src/hero_back_atk_raw.png --blobs

echo "== the rats' sheet =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/rat_sheet.png --row games/dog-punk/art-src/rat_front_quad_raw.png@104 --row games/dog-punk/art-src/rat_sheet_raw3.png@88 --row games/dog-punk/art-src/rat_back_quad_raw.png@100 --blobs

echo "== regenerate the ground tile sheet (BILLABLE — only with --regen) =="
if [ "${1:-}" = "--regen" ]; then
  python3 .github/art/tileset.py generate games/dog-punk ground --n 4 --force --items "1) dark asphalt: a charcoal base with irregular patches of a clearly lighter grey and a clearly darker grey scattered evenly over it, each patch a few art pixels across with hard edges, plus two or three short cracks — three separate flat greys, all dark; 2) the same charcoal asphalt with a little scrap on it: a few dull grey metal chips and bolts two or three art pixels across, plus the same patchy grey mottling, nothing bright or white; 3) worn concrete: the same treatment one step lighter; 4) A WALL SEEN FACE-ON, not from above: a rusted corrugated steel fence panel, evenly spaced vertical ribs of grey galvanised sheet metal with hard-edged patches of orange rust — sheet metal, never wooden planks"
fi

echo "== regenerate the object tile sheet (BILLABLE — only with --regen) =="
if [ "${1:-}" = "--regen" ]; then
  python3 .github/art/tileset.py generate games/dog-punk objects --n 4 --force --items "1) a junk pile: two stacked bald car tyres with a dented rusty oil drum leaning against them; 2) a battered steel crate with a crumpled sheet-metal panel and a bent pipe on top; 3) a chained shut gate: two narrow rusted steel gate leaves held by a heavy chain and padlock, seen face-on; 4) an oil puddle"
  # item 4 (the oil puddle) is generated but deliberately NOT cut — see the notes at the end
fi

echo "== cut the tile strip =="
python3 .github/art/tileset.py cut games/dog-punk --tile texture:games/dog-punk/art-src/tiles_ground_raw.png:0:0.43,0.43,0.6 --tile texture:games/dog-punk/art-src/tiles_ground_raw.png:1:0.43,0.23,0.45 --tile texture:games/dog-punk/art-src/tiles_ground_raw.png:2:0.23,0.43,0.45:0.66 --tile texture:games/dog-punk/art-src/tiles_ground_raw.png:3:0.15,0.2,0.5:0.82 --tile object:games/dog-punk/art-src/tiles_objects_raw.png:0 --tile object:games/dog-punk/art-src/tiles_objects_raw.png:1 --tile object:games/dog-punk/art-src/tiles_objects_raw.png:2

if [ "${1:-}" = "--verify" ]; then
  echo "== gates =="
  python3 .github/art/verify_sheet.py sheet games/dog-punk/hero_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py sheet games/dog-punk/hero_attack_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py sheet games/dog-punk/rat_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py character games/dog-punk hero
  python3 .github/art/verify_sheet.py character games/dog-punk rat
  python3 .github/art/tileset.py verify games/dog-punk
fi
echo "done."

# ---------------------------------------------------------------------------
# WHY THESE COMMANDS LOOK LIKE THIS. Every clause below was paid for once.
# ---------------------------------------------------------------------------
# Raw generations live in games/dog-punk/art-src/. The shipped sheets are
# rebuilt from them with the shared cutter (.github/art/build_sheet.py), never
# hand-edited:
# Those commands reproduce the shipped sheets byte for byte. The front and
# side walk rows were regenerated together against lockedColours
# (hero_front_raw / hero_side_raw); the BACK row is still walk_back_v13_raw,
# because three attempts at a new one came back as the documented orange-lump
# back view (head merged into the shoulders, jacket dropped to the hips) and
# they are kept in art-src/rejected/ so the next attempt can see what to beat.
# The ATTACK sheet has not been regenerated against lockedColours yet: its fur
# sits one palette step darker (#e0791c) than the walk sheet's (#f0a35a) and
# its jacket loses its sleeves, so it is the next art job here — three rows,
# one generation each. --build-steps 0,2 builds the front and back rows' TWO
# STEP FRAMES from their standing frame by lifting each leg in turn, because
# the generator will not draw opposite steps — six front rows in a row lifted
# the same foot twice. Only the middle frame of those rows has to be drawn
# well. clean_raw.py exists because the model keeps drawing a soft grey ground
# shadow under the boots however loudly the prompt forbids it; that grey is
# not flat white, so the cutter's background key leaves it welded to the
# sprite. --blobs is needed on any row where an extended blade closes the
# white gutter between two sprites.
# The seven tiles are, in order: asphalt, scrap-strewn asphalt, concrete slab,
# rusted corrugated STEEL fence (drawn FACE-ON as a standing wall, not a top
# view — a wall drawn from above lies flat in the middle of the floor and
# reads as planks someone dropped), tyre-and-drum junk pile, scrap crate,
# chained gate — app.js names them in the same order, and only the fence is
# ever used as the level BOUNDARY; interior obstacles are the two object
# tiles, which have a base and read as things you cannot walk through. There
# is no oil-puddle tile: a near-black slick scattered over a dark floor reads
# as HOLES punched in the level, and brightening it just made grey holes, so
# floor litter is the scrap-strewn asphalt variant instead. The crops do two
# jobs. They pick a square that is inside the swatch's own drawn border and
# free of any one-off feature (a rust patch or a bright pebble left in a
# wrapping floor tile repeats across the whole level as a four-fold flower),
# and their SIZE sets the texture's apparent scale: a whole 460px swatch
# scaled to 32px averages its detail away into a flat block that the FLAT gate
# rejects, so the floors are cut from roughly half-swatch squares. The
# trailing number dims a material — concrete at 0.66 sits close enough to the
# asphalt that slabs do not chequer the floor, and the fence at 0.82 sits
# behind the characters.
