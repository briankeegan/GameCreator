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

echo "== the drones' sheet (Rail Yard zone enemy) =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/drone_sheet.png --row games/dog-punk/art-src/drone_front_raw.png --row games/dog-punk/art-src/drone_side_raw.png --row games/dog-punk/art-src/drone_back_raw.png --blobs

echo "== the brutes' sheet (Rust Quarter zone enemy) =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/brute_sheet.png --row games/dog-punk/art-src/brute_front_raw.png --row games/dog-punk/art-src/brute_side_raw.png --row games/dog-punk/art-src/brute_back_raw.png --blobs

echo "== regenerate the Scrapyard ground/object tile sheets (BILLABLE — only with --regen) =="
if [ "${1:-}" = "--regen" ]; then
  python3 .github/art/tileset.py generate games/dog-punk ground --n 4 --force --items "1) dark asphalt: a charcoal base with irregular patches of a clearly lighter grey and a clearly darker grey scattered evenly over it, each patch a few art pixels across with hard edges, plus two or three short cracks — three separate flat greys, all dark; 2) the same charcoal asphalt with a little scrap on it: a few dull grey metal chips and bolts two or three art pixels across, plus the same patchy grey mottling, nothing bright or white; 3) worn concrete: the same treatment one step lighter; 4) A WALL SEEN FACE-ON, not from above: a rusted corrugated steel fence panel, evenly spaced vertical ribs of grey galvanised sheet metal with hard-edged patches of orange rust — sheet metal, never wooden planks"
  mv games/dog-punk/art-src/tiles_ground_raw.png games/dog-punk/art-src/tiles_ground_scrap_raw.png
  python3 .github/art/tileset.py generate games/dog-punk objects --n 4 --force --items "1) a junk pile: two stacked bald car tyres with a dented rusty oil drum leaning against them; 2) a battered steel crate with a crumpled sheet-metal panel and a bent pipe on top; 3) a chained shut gate: two narrow rusted steel gate leaves held by a heavy chain and padlock, seen face-on; 4) an oil puddle"
  # item 4 (the oil puddle) is generated but deliberately NOT cut — see the notes at the end
  mv games/dog-punk/art-src/tiles_objects_raw.png games/dog-punk/art-src/tiles_objects_scrap_raw.png
fi

echo "== regenerate the Rail Yard ground/object tile sheets (BILLABLE — only with --regen) =="
if [ "${1:-}" = "--regen" ]; then
  python3 .github/art/tileset.py generate games/dog-punk ground --n 4 --force --items "1) dark grey rail ballast: a charcoal-grey base with small angular pale-grey and dark-grey stone-chip flecks scattered evenly, hard edges, a couple of thin dark cracks — three separate flat greys, all dark, no warm colour; 2) the same charcoal ballast with a few scattered rust-orange bolt flecks and one short brown rail-tie sliver, still mostly grey; 3) worn concrete platform slab: a cool light grey, one step lighter than the ballast, same flat mottled treatment; 4) A WALL SEEN FACE-ON, not from above: a tall steel chain-link fence panel — a regular diamond-mesh grid of thin dark-grey wire over a flat mid-grey backdrop, with a horizontal dark-grey pipe rail along the top and bottom — woven wire mesh, NEVER corrugated sheet metal, NEVER wooden planks"
  mv games/dog-punk/art-src/tiles_ground_raw.png games/dog-punk/art-src/tiles_ground_rail_raw.png
  python3 .github/art/tileset.py generate games/dog-punk objects --n 2 --force --items "1) a stack of two weathered dark-brown wooden rail-ties with a coil of rusted dark cable resting on top; 2) a battered grey steel signal control box standing upright with hazard stripes and a small dull rust-orange indicator lens on the front"
  mv games/dog-punk/art-src/tiles_objects_raw.png games/dog-punk/art-src/tiles_objects_rail_raw.png
fi

echo "== regenerate the Rust Quarter ground/object tile sheets (BILLABLE — only with --regen) =="
if [ "${1:-}" = "--regen" ]; then
  python3 .github/art/tileset.py generate games/dog-punk ground --n 4 --force --items "1) scorched rust-red slag ground: a dark rust-brown base with small patches of a lighter burnt-orange and a near-black ash fleck scattered evenly, hard edges, a couple of short cracks — three separate flat warm dark tones, no grey; 2) the same scorched slag with a few scattered dull grey clinker-chunk flecks, still mostly rust-brown; 3) cracked rust-stained concrete: a warm mid grey base with a few small rust-orange streak flecks, one step lighter than the slag, same flat mottled treatment; 4) A WALL SEEN FACE-ON, not from above: a rough-hewn quarry retaining wall of stacked grey-brown boulders with hard dark shadow lines between the stones — stacked rock blocks, NEVER wooden planks, NEVER corrugated sheet metal, NEVER a wire mesh"
  mv games/dog-punk/art-src/tiles_ground_raw.png games/dog-punk/art-src/tiles_ground_rust_raw.png
  python3 .github/art/tileset.py generate games/dog-punk objects --n 2 --force --items "1) a jagged heap of grey-black slag rubble chunks piled up; 2) a rusted metal smelter drum barrel standing upright with rivets around its middle and a scorched black top"
  mv games/dog-punk/art-src/tiles_objects_raw.png games/dog-punk/art-src/tiles_objects_rust_raw.png
fi

echo "== cut the tile strip (19 tiles: Scrapyard's original 7, then Rail Yard's 6, then Rust Quarter's 6 — see ZONE_TILES in app.js) =="
python3 .github/art/tileset.py cut games/dog-punk \
  --tile texture:games/dog-punk/art-src/tiles_ground_scrap_raw.png:0:0.43,0.43,0.6 \
  --tile texture:games/dog-punk/art-src/tiles_ground_scrap_raw.png:1:0.43,0.23,0.45 \
  --tile texture:games/dog-punk/art-src/tiles_ground_scrap_raw.png:2:0.23,0.43,0.45:0.66 \
  --tile texture:games/dog-punk/art-src/tiles_ground_scrap_raw.png:3:0.15,0.2,0.5:0.82 \
  --tile object:games/dog-punk/art-src/tiles_objects_scrap_raw.png:0 \
  --tile object:games/dog-punk/art-src/tiles_objects_scrap_raw.png:1 \
  --tile object:games/dog-punk/art-src/tiles_objects_scrap_raw.png:2 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rail_raw.png:0:0.3,0.3,0.55 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rail_raw.png:1:0.55,0.1,0.35 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rail_raw.png:2:0.25,0.35,0.5:0.85 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rail_raw.png:3:0.15,0.2,0.55:0.82 \
  --tile object:games/dog-punk/art-src/tiles_objects_rail_raw.png:0 \
  --tile object:games/dog-punk/art-src/tiles_objects_rail_raw.png:1 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rust_raw.png:0:0.3,0.3,0.55:0.78 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rust_raw.png:1:0.3,0.15,0.5:0.78 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rust_raw.png:2:0.25,0.35,0.5:0.85 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rust_raw.png:3:0.15,0.2,0.55:0.82 \
  --tile object:games/dog-punk/art-src/tiles_objects_rust_raw.png:0 \
  --tile object:games/dog-punk/art-src/tiles_objects_rust_raw.png:1

if [ "${1:-}" = "--verify" ]; then
  echo "== gates =="
  python3 .github/art/verify_sheet.py sheet games/dog-punk/hero_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py sheet games/dog-punk/hero_attack_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py sheet games/dog-punk/rat_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py sheet games/dog-punk/drone_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py sheet games/dog-punk/brute_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py character games/dog-punk hero
  python3 .github/art/verify_sheet.py character games/dog-punk rat
  python3 .github/art/verify_sheet.py character games/dog-punk drone
  python3 .github/art/verify_sheet.py character games/dog-punk brute
  python3 .github/art/tileset.py verify games/dog-punk --floors 0,1,2,7,8,9,13,14,15
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
# The first seven tiles are, in order: asphalt, scrap-strewn asphalt, concrete
# slab, rusted corrugated STEEL fence (drawn FACE-ON as a standing wall, not a
# top view — a wall drawn from above lies flat in the middle of the floor and
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
#
# 2026-08-21 (zone tile variety — "rooms look the same, need variety in art,
# assets, shapes") — every room in every zone drew from those same seven
# tiles; only a translucent colour wash (TINT_RAIL/TINT_RUST in app.js) told
# Rail Yard and Rust Quarter apart from Scrapyard, which is a filter, not
# different scenery. Tiles 7-12 are Rail Yard's own 4 ground + 2 object tiles
# (ballast gravel, a scrap-flecked variant, a platform slab, a chain-link
# fence, a rail-tie-and-cable stack, a hazard-striped signal box); tiles
# 13-18 are Rust Quarter's (scorched slag, a clinker-flecked variant, a
# rust-stained slab, a stacked-boulder quarry wall, a slag-rubble heap, a
# rusted smelter drum). The chained gate (tile 6) stays shared across every
# zone on purpose — it is the one tile a player has to recognise on sight as
# "the exit", so it does not get reskinned. See ZONE_TILES/currentTileSet()
# in app.js for how a room picks which bank of six it draws from (keyed off
# the same `tint` the room already carried, so there is no second field that
# could drift out of sync with a room's zone). The rust ground tiles carry an
# extra 0.78 dim the others don't: at full brightness they sat 0 luma from
# the nearest hero/enemy palette colour (verify_tiles.py's CAMOUFLAGE check),
# because rust-orange is already a hero/rat material colour — the same
# reason the ORIGINAL fence sits at 0.82.
