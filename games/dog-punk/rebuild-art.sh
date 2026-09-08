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
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/hero_sheet.png --row games/dog-punk/art-src/hero_front_raw.png --row games/dog-punk/art-src/hero_side_raw.png --row games/dog-punk/art-src/hero_back_raw.png --build-steps 0,2

echo "== clean the attack raws (see note below) =="
# NAMING FIX: this used to clean hero_atk_<view>_raw.png (the OLD naming, from
# before generate_row.py/generate-walkrow.yml standardised on
# hero_<view>_atk_raw.png), while the sheet below was already built from the
# NEW-named files. So this step ran, printed "wrote ...", and its output was
# never read by anything — the actual attack raws never got the ground-shadow
# cleanup this step exists for. The stale old-named files (and their dead
# _clean outputs) also confused generate_row.py's style-ref auto-picker, which
# matches ANY hero_*_raw.png: it compared a freshly regenerated side row
# against hero_atk_back_raw.png (the unused old file) instead of the real
# hero_back_atk_raw.png, and rejected good art for not matching art nothing
# ships from. Old-named duplicates deleted; this now cleans and builds from
# the same files.
python3 games/dog-punk/art-src/clean_raw.py games/dog-punk/art-src/hero_front_atk_raw.png games/dog-punk/art-src/hero_side_atk_raw.png games/dog-punk/art-src/hero_back_atk_raw.png

echo "== the hero's attack sheet =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/hero_attack_sheet.png --row games/dog-punk/art-src/hero_front_atk_raw_clean.png --row games/dog-punk/art-src/hero_side_atk_raw_clean.png --row games/dog-punk/art-src/hero_back_atk_raw_clean.png --blobs

# 2026-08-30 (roll/dodge), revised 2026-08-31 to full three-row coverage —
# same shape as the walk/attack sheets. See the "Roll / dodge" section of
# .github/art/CHARACTER_SHEETS.md and this game's own `rollRule` in
# art-style.json for the full history: it shipped side-view-only first,
# reused mirrored for every direction, and the reuse hid a real scale bug
# (below) before the owner overruled side-only as the standard for this
# game shape.
# --blobs because the mid-roll frame (a curled ball) reaches further into
# its neighbours' white gutter than a standing pose does, same reason the
# attack sheet needs it.
# #2 anchors EACH row's scale to frame 2 (recover — a normal standing pose)
# instead of build_sheet.py's default frame 0. Frame 0 here is the TUCK, a
# deliberately crouched, shorter-than-standing pose — scaling a row to make
# THAT frame 168px tall inflated the other frames past her real size (the
# side row's recover frame originally shipped at 220px, 31% taller than
# every other sheet). Frame 0 works as the default everywhere else
# (walk/attack) because it IS close to standing height there; a dodge-roll
# is the one row where it isn't, by design.
echo "== the hero's roll/dodge sheet =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/hero_roll_sheet.png \
  --row games/dog-punk/art-src/hero_front_roll_raw.png#2 \
  --row games/dog-punk/art-src/hero_side_roll_raw.png#2 \
  --row games/dog-punk/art-src/hero_back_roll_raw.png#2 \
  --blobs

echo "== the rats' sheet =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/rat_sheet.png --row games/dog-punk/art-src/rat_front_quad_raw.png@104 --row games/dog-punk/art-src/rat_sheet_raw3.png@88 --row games/dog-punk/art-src/rat_back_quad_raw.png@100 --blobs

echo "== the drones' sheet (Rail Yard zone enemy) =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/drone_sheet.png --row games/dog-punk/art-src/drone_front_raw.png --row games/dog-punk/art-src/drone_side_raw.png --row games/dog-punk/art-src/drone_back_raw.png --blobs

echo "== the brutes' sheet (Rust Quarter zone enemy) =="
python3 .github/art/build_sheet.py --style games/dog-punk/art-style.json --out games/dog-punk/brute_sheet.png --row games/dog-punk/art-src/brute_front_raw.png --row games/dog-punk/art-src/brute_side_raw.png --row games/dog-punk/art-src/brute_back_raw.png --blobs

echo "== regenerate the Scrapyard ground/object tile sheets (BILLABLE — only with --regen) =="
if [ "${1:-}" = "--regen" ]; then
  # 2026-09-08, second pass same day ("it's not done, art looks the same" —
  # the first 2026-09-08 pass below added a weeds tile and a palette arc
  # between zones, which was real but too SUBTLE to read as different when
  # actually playing: three zones that only vary "which grey/brown" still
  # reads as one place. This pass pushes actual colour INTO Scrapyard's
  # everyday materials instead of confining colour to a single accent tile:
  # yellow line-paint fragments and a rust bolt in the asphalt, a denser
  # green-with-dandelions weed bed, a spray-paint fragment on the concrete,
  # and one small hand-painted graffiti tag each on the fence and the gate —
  # plus a torn flyer on the crate and a tarp scrap on the junk pile. Small,
  # tile-scale, still obeys the "quiet floor" contrast cap, but Scrapyard now
  # reads as a place someone lives in rather than a texture with a filter on it.
  python3 .github/art/tileset.py generate games/dog-punk ground --n 4 --force --items "1) dark worn asphalt with a warm cast: a charcoal-brown base with irregular patches of lighter warm grey and darker charcoal scattered evenly, each patch a good eighth of the tile wide with hard edges, two or three faded yellow line-paint fragments, and a couple of small bright rust-orange bolt flecks for warmth — still dark and quiet overall but with genuine warm colour, not just grey; 2) the same asphalt thoroughly reclaimed by plant life: noticeably MORE green than a single tuft — several small flat clumps of bright green weeds and a couple of tiny yellow dandelion-flower flecks poking up through wide cracks, plus a few dull grey metal chips — still grounded and dark but unmistakably green and alive, not just an accent; 3) worn concrete: a cool light grey slab, one step lighter than the asphalt, with a couple of hairline cracks and one small painted red spray-paint fragment (a corner of a stencilled shape, not readable text) peeking across an edge; 4) A WALL SEEN FACE-ON, not from above: a rusted corrugated steel fence panel, evenly spaced vertical ribs of grey galvanised sheet metal with hard-edged patches of orange rust AND one small hand-painted patch of faded punk-rock graffiti (a jagged pink star or lightning bolt, flat colour, no text) — sheet metal, never wooden planks"
  mv games/dog-punk/art-src/tiles_ground_raw.png games/dog-punk/art-src/tiles_ground_scrap_raw.png
  python3 .github/art/tileset.py generate games/dog-punk objects --n 4 --force --items "1) a junk pile: two stacked bald car tyres with a dented rusty oil drum leaning against them, one tyre wrapped with a scrap of faded blue tarp for a colour accent; 2) a battered steel crate with a crumpled sheet-metal panel and a bent pipe on top, with a torn punk-rock flyer (a small white paper rectangle with a bold red star, no readable text) taped to its front face; 3) a chained shut gate: two narrow rusted steel gate leaves held by a heavy chain and padlock, seen face-on, with a small hand-painted pink lightning-bolt tag on one leaf; 4) a small clump of tall wild green weeds with a couple of tiny yellow dandelion flowers, and dead brown grass growing up out of a crack in the ground, seen from the same top-down angle, with a little bare dirt showing at its base where it meets the floor"
  # item 4 used to be an oil puddle, deliberately never cut (a dark slick read
  # as a hole in the floor); since the first 2026-09-08 pass it's a weeds
  # clump instead — Scrapyard is the one zone in the chapter with any green
  # in it at all (see the narrative-arc note near ZONE_TILES in app.js), and
  # this item is cut as tile 19 (TILE_WEEDS), scattered as a decorative,
  # walkable, non-solid overlay — see drawWeeds() in app.js.
  mv games/dog-punk/art-src/tiles_objects_raw.png games/dog-punk/art-src/tiles_objects_scrap_raw.png
fi

echo "== regenerate the Rail Yard ground/object tile sheets (BILLABLE — only with --regen) =="
if [ "${1:-}" = "--regen" ]; then
  # 2026-09-08, third pass same day — the second pass above pushed real
  # colour into Scrapyard only ("Scrapyard only" was said explicitly in that
  # pass's own note) and left Rail Yard/Rust Quarter on the FIRST 2026-09-08
  # wording, which is still three shades of one grey/rust with a single
  # accent tile — i.e. most of the chapter (these two zones are 12 of the
  # 15 rooms) still reads as the flat-noise floor the complaint was about.
  # Same fix as Scrapyard: push real colour into the everyday materials
  # instead of confining it to one tile, WITHOUT giving up the zone's own
  # identity — Rail Yard stays the dead, nothing-grows-here middle of the
  # chapter (see the zone-arc note further down), it just gets its colour
  # from hazard-yellow paint and rust instead of from being all grey.
  python3 .github/art/tileset.py generate games/dog-punk ground --n 4 --force --items "1) dark grey rail ballast with real colour in it, not three shades of one grey: a charcoal-grey base with small angular pale-grey and dark-grey stone-chip flecks scattered evenly, each chip a good eighth of the tile wide with hard edges, a scattering of rust-orange bolt and washer flecks, and one faded safety-yellow paint-stripe fragment for warning-marking colour, plus a couple of thin dark cracks — still a dead grey ballast bed at a glance, but with real rust-orange and safety-yellow in it; 2) the same ballast with MORE rust and grime than tile 1: several scattered rust-orange bolt and chain flecks, one short dark-brown rail-tie sliver, and a dull black oil-stain patch — visibly dirtier and rustier, still completely dead ground, nothing green anywhere; 3) worn concrete platform slab: a cool light grey, one step lighter than the ballast, with a faded safety-yellow edge-warning stripe running along one side and a hairline crack; 4) A WALL SEEN FACE-ON, not from above: a tall steel chain-link fence panel — a regular diamond-mesh grid of thin dark-grey wire over a flat mid-grey backdrop, with a horizontal dark-grey pipe rail along the top and bottom, and one small faded yellow-and-black hazard-stripe warning sign wired to the mesh for a colour accent — woven wire mesh, NEVER corrugated sheet metal, NEVER wooden planks"
  mv games/dog-punk/art-src/tiles_ground_raw.png games/dog-punk/art-src/tiles_ground_rail_raw.png
  python3 .github/art/tileset.py generate games/dog-punk objects --n 2 --force --items "1) a stack of two weathered dark-brown wooden rail-ties with a coil of rusted dark cable resting on top, the cable wrapped partway in a strip of faded safety-orange reflective tape; 2) a battered grey steel signal control box standing upright with bold yellow-and-black hazard stripes across the top and a small glowing red-orange indicator lens on the front"
  mv games/dog-punk/art-src/tiles_objects_raw.png games/dog-punk/art-src/tiles_objects_rail_raw.png
fi

echo "== regenerate the Rust Quarter ground/object tile sheets (BILLABLE — only with --regen) =="
if [ "${1:-}" = "--regen" ]; then
  # 2026-09-08, third pass — same reasoning as Rail Yard above. Rust Quarter
  # keeps its warm rust family and stays lifeless, it just gets MORE visible
  # ember-glow and scorch detail instead of "one or two tiny flecks" that
  # read as noise at 32px.
  python3 .github/art/tileset.py generate games/dog-punk ground --n 4 --force --items "1) scorched rust-red slag ground: a dark rust-brown base with small patches of lighter burnt-orange and near-black ash flecks scattered evenly, each patch a good eighth of the tile wide with hard edges, a couple of short cracks, and SEVERAL small glowing-ember orange flecks, noticeably more and brighter than a token accent — this is the fire zone and it should read that way at a glance — three flat warm dark tones plus real visible ember glow, no grey, nothing alive; 2) the same scorched slag with MORE grey-black clinker chunks than tile 1 and a streak of pale ash dust, still mostly rust-brown and lifeless; 3) cracked rust-stained concrete: a warm mid grey base with several rust-orange streak flecks and one scorch-black smudge, one step lighter than the slag; 4) A WALL SEEN FACE-ON, not from above: a rough-hewn quarry retaining wall of stacked grey-brown boulders with hard dark shadow lines between the stones and a few scorch-black smudges low down where slag heat has charred the rock — stacked rock blocks, NEVER wooden planks, NEVER corrugated sheet metal, NEVER a wire mesh"
  mv games/dog-punk/art-src/tiles_ground_raw.png games/dog-punk/art-src/tiles_ground_rust_raw.png
  python3 .github/art/tileset.py generate games/dog-punk objects --n 2 --force --items "1) a jagged heap of grey-black slag rubble chunks piled up, with two or three small glowing-orange ember cracks visible between the chunks; 2) a rusted metal smelter drum barrel standing upright with rivets around its middle, a scorched black top, and a faded red hazard stencil marking on its side"
  mv games/dog-punk/art-src/tiles_objects_raw.png games/dog-punk/art-src/tiles_objects_rust_raw.png
fi

echo "== cut the tile strip (20 tiles: Scrapyard's original 7 plus a weeds accent, then Rail Yard's 6, then Rust Quarter's 6 — see ZONE_TILES in app.js) =="
python3 .github/art/tileset.py cut games/dog-punk \
  --tile texture:games/dog-punk/art-src/tiles_ground_scrap_raw.png:0:0.15,0.35,0.55 \
  --tile texture:games/dog-punk/art-src/tiles_ground_scrap_raw.png:1:0.12,0.22,0.55 \
  --tile texture:games/dog-punk/art-src/tiles_ground_scrap_raw.png:2:0.35,0.3,0.6:0.7 \
  --tile texture:games/dog-punk/art-src/tiles_ground_scrap_raw.png:3:0.05,0.30,0.45:0.82 \
  --tile object:games/dog-punk/art-src/tiles_objects_scrap_raw.png:0 \
  --tile object:games/dog-punk/art-src/tiles_objects_scrap_raw.png:1 \
  --tile object:games/dog-punk/art-src/tiles_objects_scrap_raw.png:2 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rail_raw.png:0:0.06,0.05,0.5 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rail_raw.png:1:0.42,0.12,0.45 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rail_raw.png:2:0.55,0.42,0.4:0.85 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rail_raw.png:3:0.06,0.28,0.5:0.82 \
  --tile object:games/dog-punk/art-src/tiles_objects_rail_raw.png:0 \
  --tile object:games/dog-punk/art-src/tiles_objects_rail_raw.png:1 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rust_raw.png:0:0.5,0.05,0.45:0.78 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rust_raw.png:1:0.02,0.55,0.4:0.78 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rust_raw.png:2:0.4,0.02,0.45:0.85 \
  --tile texture:games/dog-punk/art-src/tiles_ground_rust_raw.png:3:0.05,0.15,0.7:0.82 \
  --tile object:games/dog-punk/art-src/tiles_objects_rust_raw.png:0 \
  --tile object:games/dog-punk/art-src/tiles_objects_rust_raw.png:1 \
  --tile object:games/dog-punk/art-src/tiles_objects_scrap_raw.png:3

if [ "${1:-}" = "--verify" ]; then
  echo "== gates =="
  python3 .github/art/verify_sheet.py sheet games/dog-punk/hero_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py sheet games/dog-punk/hero_attack_sheet.png --style games/dog-punk/art-style.json
  python3 .github/art/verify_sheet.py sheet games/dog-punk/hero_roll_sheet.png --style games/dog-punk/art-style.json
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
# Those commands reproduce the shipped sheets byte for byte. All six rows
# (walk front/side/back, attack front/side/back) were regenerated together in
# one coordinated pass so the two sheets would actually match each other
# instead of pairing a fresh attack sheet against a walk sheet from a
# different, older generation session — a real problem caught live: fixing
# only the attack sheet's documented drift (fur one palette step darker than
# walk's, jacket losing its sleeves) still left it generated in a different
# session from the walk sheet, with no guarantee the two would read as the
# same dog side by side. Earlier attempts at a fresh walk-back row came back
# as the documented orange-lump view (head merged into the shoulders, jacket
# dropped to the hips) — failed attempts are kept in art-src/rejected/ so the
# next one can see what to beat, should this row ever need a redo.
# --build-steps 0,2 builds the front and back rows' TWO
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
# floor litter is the scrap-strewn asphalt variant instead. (Scrapyard's
# object item 4 used to BE that discarded puddle; as of 2026-09-08 it's a
# weeds clump instead — see the note further down.) The crops do two
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
#
# 2026-09-08 ("your background art is s***, look at Zelda, make it cohesive")
# — every zone's ground was pure grey/brown/rust noise with not one green
# pixel in the whole 19-tile strip (`tiles.png` had 15 pixels of green out of
# tens of thousands, an accidental palette-snap, not a drawn feature). A top-
# down world that never varies its palette by anything but "which shade of
# rust" reads as one location repeated, which is the actual thing "all the
# background art is bad" was pointing at — Zelda's overworld tells you where
# you are by CONTRAST (Kakariko's green against Death Mountain's red-black),
# not by detail density. So the chapter now has a real palette ARC instead of
# a flat industrial grey throughout: Scrapyard (closest to home) gets a
# weeds/dead-grass groundAlt and a new object tile, TILE_WEEDS (index 19,
# cut from Scrapyard's object sheet item 4 — see drawWeeds() in app.js for
# where it's scattered) — life persisting in the junk. Rail Yard's ground
# prompt now says explicitly "nothing alive growing anywhere" — the
# mechanical middle of the chapter, dead on purpose. Rust Quarter keeps its
# warm rust family but item 1 now asks for a couple of tiny glowing-ember
# flecks, the same "danger zone glows" cue as Death Mountain's lava —
# nothing moves or animates, it's a colour accent, but it reads as "the fire
# zone" rather than "the brown zone". Town (already warm/lit, unchanged
# here) is the payoff at the far end of that arc. Also bumped every ground
# item's mottling patch size from "a few art pixels" to "a good eighth of
# the tile" — still inside the standard's sixteenth-to-eighth window, but at
# the small end it was averaging down to near-flat blocks once actually
# shrunk to 32px, which is the "boring grey" complaint as much as the
# missing colour was.
#
# The two concrete-slab crops (Rail Yard and Rust Quarter, both item 3 of
# their ground sheet) moved from this pass's first-guess coordinates because
# `tileset.py verify` caught real defects in them, and both were found by
# measuring candidate crops against verify_tiles.py's own seam/detail metrics
# (run the raw item through build_texture + to_palette + the same _seam()/
# std() checks verify uses, for a grid of x/y/w guesses) rather than by eye —
# eyeballing a 32px crop for "will this wrap" is exactly what the checker
# exists because people can't do reliably. Rail's 0.25,0.35,0.5 crop sat a
# bright mottled patch right at the tile's own edge, which the seamless blend
# then duplicated across the wrap (measured seam 2.78, needs under 2.0);
# 0.6,0.5,0.25 measures ~0 (a first attempt at 0.4,0.4,0.35 looked right when
# measured against raw/luma-only proxies but still measured 2.43 once actually
# run through verify's real check, which compares RGB — not luma — wrap-vs-
# internal on the PALETTE-MAPPED tile; match verify's own `_seam()` exactly
# when picking a crop, a proxy metric that almost agrees is not good enough).
# Rust's 0.25,0.35,0.5 crop was too smooth an area
# of the swatch to read as a surface at all once palette-mapped (measured
# detail 8.2, needs 9.0, i.e. FLAT); 0.45,0.45,0.35 measures 13.1.
#
# 2026-09-08, third pass same day ("it's not done, art looks the same" —
# scoped by the owner to BACKGROUND/TILE ART ONLY; do not touch the hero or
# any character sheet even if a scan flags one, full stop) — carried the
# second pass's fix out to the two zones it hadn't reached yet. Rail Yard and
# Rust Quarter were still on the FIRST 2026-09-08 wording (three shades of
# one grey/rust plus a single accent tile), and those two zones are 12 of the
# chapter's 15 rooms — fixing Scrapyard alone left most of the game looking
# exactly like it did before. Same technique, same identity kept: Rail Yard
# stays the dead, nothing-grows-here middle zone, it now gets its colour from
# rust-orange bolts/chains and safety-hazard yellow instead of from being all
# grey; Rust Quarter stays warm and lifeless, it now shows real visible
# ember-glow flecks throughout instead of "one or two tiny" ones. New crop
# coordinates for all 8 regenerated ground tiles + reused object tiles as-is
# (both zones' new object art — the reflective-taped cable coil, the hazard-
# striped signal box, the ember-cracked rubble heap, the flame-stencilled
# drum — came back good on the first generation, no crop needed). Rail's new
# concrete-slab crop (tile 9) needed the same measure-don't-eyeball pass as
# the note above: three rounds of candidates against verify_tiles.py's own
# `_seam`/`std` on the actual palette-mapped output (0.5,0.5,0.4 wrapped
# clean but read FLAT at 8.6; several more sat right on the SEAM_MAX edge)
# before 0.55,0.42,0.4 cleared both at once (seam 1.24, detail 9.2). Full
# `--verify` gate is clean except the same pre-existing soft CAMOUFLAGE
# warning noted above (a luma coincidence, not a defect).
#
# Also this pass: `hero_roll_sheet.png` and its `hero_front_roll_raw.png` raw
# were found reverted to their PRE-mohawk-fix state, on purpose. An earlier
# run in this same thread regenerated that row to fix a real bug (the front
# roll's mohawk had lost its pink entirely) — a legitimate fix, but it
# touched a character sheet in the same pass the owner had just said not to
# touch character sheets AT ALL for this ask, "even if the pre-existing-
# problems scan flags something on them" (i.e. this exact scenario, named in
# advance). Scope beats a real bug fix here: reverted to the last version
# from before that fix, character art is untouched by this pass, and the
# mohawk-on-the-roll-sheet bug is still open for whenever background/tile
# art isn't the explicit, sole ask.
