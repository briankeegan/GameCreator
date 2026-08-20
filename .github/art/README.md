# The art pipeline — index

Every art standard, tool and prompt in this repo, and which one to reach for.
One page, so nobody has to already know what exists. It is checked by
`.github/scripts/check_art_registry.mjs` on every push: a tool or prompt that
is not listed here fails the build, and so does a path listed here that does
not exist. The index cannot go stale without someone noticing.

Applies to any game of the same shape, not just the one a rule was written
from. Dog Punk is the reference for characters, the Anarchy Garden in
`games/the-game` for rooms.

---

## Start here

| I want to… | Read | Then run |
|---|---|---|
| draw or fix a **character** | [`CHARACTER_SHEETS.md`](CHARACTER_SHEETS.md) | Actions → **Generate walk row**, then `build_sheet.py` |
| draw or fix a **room** | [`../../docs/ROOM_ART_STANDARD.md`](../../docs/ROOM_ART_STANDARD.md) | `room.py prompt …`, then `room.py plate` / `props` / `check` |
| add a **one-off image** (icon, title art) | — | Actions → **Generate image** (or write an inline `.svg`) |
| keep a **set** of images consistent | that game's `art-style.json` | Actions → **Generate game asset** |
| know whether art is **good enough to ship** | this page, "Checks" below | `verify_sheet.py`, `room.py verify` |

**Every game has an art contract: `games/<id>/art-style.json`.** Camera,
rendering language, `lockedPalette` (enforced by the cutter, not merely
described), `lockedDetails` (the things that drift — sleeves, ears, which hand
holds the weapon), and the exact commands that rebuild that game's art. New
games are scaffolded an unfilled one from `games/_template/`. Fill it in before
generating anything, and put a detail there the moment you catch it drifting.

---

## The pattern (why any of this exists)

The same shape solved walking, attacks and rooms, and it is the thing to copy
for the next kind of art:

1. **Generate what the model draws well; construct the rest.** A standing pose
   comes back clean nearly every time; opposite step frames never did, in six
   tries. So `build_sheet.py --build-steps` builds the steps from the standing
   frame. A finished room could not be turned back into a walkable floor by any
   of five techniques, so the floor is generated as its own bare plate and the
   scenery goes on top as props.
2. **Generate a SHEET, never one frame.** Frames drawn together cannot drift
   apart in colour, proportion or pixel scale; frames drawn separately always
   do.
3. **Ask for flat pure white, never transparency.** Transparency comes back as
   a beige wash. The cutters key the white out.
4. **Verify mechanically, then look.** The checkers decide the countable half
   (frames, clipping, palette, duplicates); eyes are for the half they cannot.
5. **RULE → TOOL → GATE.** A rule in prose gets ignored, a checker nobody runs
   catches nothing, and a CI failure with no explanation sends someone digging.
   All three, together, or the rule will not hold.

---

## Standards

| File | Covers |
|---|---|
| [`CHARACTER_SHEETS.md`](CHARACTER_SHEETS.md) | Sheet layout, walk frames `[step, NEUTRAL, step]`, attack frames `[wind-up, STRIKE, recover]`, directions and mirroring, how a front/back walk is built, the recipe that works, and what the checker cannot decide. |
| [`../../docs/ROOM_ART_STANDARD.md`](../../docs/ROOM_ART_STANDARD.md) | The three passes — composed scene (measured, never shipped), ground plate (shipped, and its own collision mask), prop sheet — prop placement, sizing and the pipeline. Written to hand to someone who has never seen this repo. |
| `games/<id>/art-style.json` | One game's contract: camera, style, palette, locked details, rebuild commands. |

## Prompts — fill these in, don't write new ones

Each carries rules a freshly-typed prompt always leaves out. If a generation
exposes a gap, **fix the prompt file**; that is how the next person inherits it.

| File | For |
|---|---|
| [`walkgrid_prompt.txt`](walkgrid_prompt.txt) | A walk row, one image per direction. Keep one of its three `{VIEW}` blocks. |
| [`attacksheet_prompt.txt`](attacksheet_prompt.txt) | An attack row — a slash across the body, not a thrust. |
| [`walksheet_prompt.txt`](walksheet_prompt.txt) | The legacy 4x3 grid for per-file games (Newsey). |
| [`room_prompts/1_composed_scene.txt`](room_prompts/1_composed_scene.txt) | Room pass 1 — the scene that gets measured. |
| [`room_prompts/2_floor_plate.txt`](room_prompts/2_floor_plate.txt) | Room pass 2 — the walkable surface, and nothing else. |
| [`room_prompts/3_prop_sheet.txt`](room_prompts/3_prop_sheet.txt) | Room pass 3 — everything you cannot walk on, side by side. |

`python3 room.py prompt scene|plate|props` prints a room prompt already filled
in from the game's `art-style.json`.

## Generators (Actions — `workflow_dispatch` only, so nothing costs money by accident)

| Action | Use for |
|---|---|
| **Generate walk row** (`generate-walkrow.yml`) | A verified walk row for a sheet-based game. It is a button on `generate_row.py` — same code the autopilot runs. |
| **Generate walksheet** (`generate-walksheet.yml`) | The legacy per-file walk set (Newsey). |
| **Generate game asset** (`generate-game-asset.yml`) | Any image that must match a game's established look; reads its `art-style.json`. |
| **Generate image** (`generate-image.yml`) | Freeform one-offs, or a game with no `art-style.json` yet. |
| **Generate game asset — batch** (`generate-game-asset-batch.yml`) | Several assets for one game in a single dispatch, same style contract as above. |
| **Generate referenced asset** (`generate-referenced-asset.yml`) | Matching a specific supplied picture. **Not for sprite rows** — it loses detail and drifts the palette; see CHARACTER_SHEETS.md. |

`quality` defaults to `medium` (enough for flat cartoon pixel art; `high` costs
about four times as much) and `force` is off, so re-running a batch never pays
twice for art that already exists.

## The one front door for a character row

```
python3 .github/art/generate_row.py --game <id> --character <id> --view front|side|back \
        [--kind walk|attack] [--print-prompt] [--force]
```

[`generate_row.py`](generate_row.py) builds the prompt from the canonical
prompt file plus the game's `art-style.json`, generates ONE row on a landscape
canvas, verifies it, and **deletes it if it fails** — a bad row cannot sit in
`art-src/` waiting to be picked up by a later build.

**Everyone runs this same script.** A person or a Claude session runs it
locally, or presses the "Generate walk row" Action, which is a button on it.
The Clubhouse autopilot cannot dispatch a workflow from inside one, so it calls
the script directly. The only difference is transport, and the script picks it:
a broker on `127.0.0.1:8791` if one is listening (the autopilot's, which holds
the key the model deliberately does not have and caps generations per run),
otherwise `OPENAI_API_KEY`. `--print-prompt` shows the prompt without spending
anything.

Before this existed the recipe was inlined in the Action and restated in prose
in the autopilot's prompt. They drifted, and the autopilot's copy was the stale
one — still generating the legacy frame layout long after the standard changed.
Two callers, one script, is the fix.

## Cutters and builders

| Tool | Does |
|---|---|
| [`build_sheet.py`](build_sheet.py) | Raw rows → shipped sheet: keys the background, cuts at gutters or blobs, one scale per row, snaps to the art-pixel grid and the locked palette, common foot baseline. `--build-steps` constructs front/back step frames; `--mirror-step` mirrors just the second one. |
| [`slice_walksheet.py`](slice_walksheet.py) | The other cutter: a chroma-green 4x3 grid → individual `<id>_<dir>_<n>.png` files. |
| [`room.py`](room.py) | The one front door for rooms: `prompt`, `plate`, `props`, `check`, `verify`. |
| [`build_props.py`](build_props.py) | Cuts a prop sheet into one transparent PNG per prop. |
| [`fit_plate.py`](fit_plate.py) | Fits a generated floor plate to the room frame. |
| [`build_walkmask.py`](build_walkmask.py) | Builds a room's walkable-floor mask, and records the five techniques that failed at recovering one from finished art. |
| [`measure_props.py`](measure_props.py) | Reads prop sizes and ground points off the composed scene. |
| [`preview_room.py`](preview_room.py) / [`show_walkmask.py`](show_walkmask.py) | Render the pictures you have to actually look at. |

## Checks (the gate half — all of these run in `pages.yml`)

| Tool | Fails the build on | Warns on |
|---|---|---|
| [`verify_sheet.py`](verify_sheet.py) | Clipping, wrong frame count, duplicate frames, detached specks, off-palette colour, empty cells; and same-foot-twice in `raw --mirrored` mode. | A middle frame that is not a distinct neutral; same-foot-twice on a built sheet, which cannot tell a walk sheet from a legacy `[idle, walk, attack]` one. |
| `room.py verify` | Props and floor plates — every check in it is a bug that shipped, each proved to fire by breaking a room on purpose. | — |
| [`../scripts/check_art_registry.mjs`](../scripts/check_art_registry.mjs) | A tool, prompt or standard that is not listed on this page, or a path listed here that does not exist. | — |

An unambiguous fact fails; a threshold on a metric warns. A borderline-but-
correct set must never block a deploy, and a checker that cries wolf gets
ignored — which is worse than not having it.
