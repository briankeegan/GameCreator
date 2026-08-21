# Room art standard

How a room is generated, framed, populated and made walkable for a top-down
room-to-room game. Newsey (`games/the-game`) is the reference implementation and
its Anarchy Garden is the reference room. Dog Punk's tiled levels are a
different scheme and out of scope.

Companion to `.github/art/CHARACTER_SHEETS.md`, which covers the characters that
stand in these rooms. Both exist for the same reason: the expensive failures
were never "the picture is ugly", they were the art and the code disagreeing
about what the picture *means*.

Written to be handed to someone who has never seen this repo.

---

## 1. A room is generated in THREE PASSES

**This is the rule everything else hangs off.** A room used to be one picture
with its scenery painted into it, and everything downstream fought that.

### Pass 1 — the composed scene (a reference, never shipped)

Generate the room as a complete picture, everything in it, exactly as you want
it to look. **This one is not shipped.** It exists so that a composition you can
see is the thing you measure from — the models compose a whole scene far better
than they place a bare floor, and a floor invented on its own comes back with
the path somewhere else and nothing where you expect it.

Keep it at `art-src/<room>_scene.png`.

**Do not ship it, and beware how reasonable shipping it will sound.** The scene
is a finished-looking picture of the room, so copying it to
`art/bg-<room>.png` appears to save two passes and produces a room that looks
right immediately. Every cost lands later, and all of them are permanent:
the walkable floor cannot be recovered from a finished picture (§6 lists the
five techniques that failed), painted scenery is something you can only ever be
fenced away from rather than walk behind, water that is paint can never move,
and moving one object means regenerating the whole room. This is the rule most
likely to be argued away in the moment — it was argued away out loud once, by
someone who had just read this page — so it is also checked:
`room.py verify` fails the build when a shipped background is the same picture
as its scene, and that check runs in `pages.yml` on every push.

### Pass 2 — the WALKABLE SURFACE, and only that

Regenerate the room as **just the ground you can stand on** — grass,
floorboards, path, tile — on flat white, with *nothing else in the frame*.

This is the shipped background, and because it is exactly the walkable area, the
collision mask is its own silhouette: add the room to `FLOOR_PLATE_ROOMS` in
`build_walkmask.py` and **there is nothing else to declare**. No wall line to
measure, no furniture polygons to subtract, and no way for the mask to drift out
of step with the art — because the art *is* the declaration.

Run it through `fit_plate.py` before shipping it (see §7).

### Pass 3 — everything you CANNOT walk on, as props

Sheets of 2–4 items each, **drawn side by side in one image** on flat white,
upright, whole from base to top, on a common ground line, no shadow. Walls,
water, waterfalls, trees, statues, tables — plus flat ground cover like flowers,
which you *can* walk on but which still isn't part of the plate.

Cut with `build_props.py`, then place at the numbers measured off pass 1.

### What this buys

- **The mask stops being hand-authored.** See §6 for the five techniques that
  failed at recovering a floor from a finished picture.
- **Scenery gets depth.** A painted tree is flat: you either walk over it or are
  fenced away from it. A prop sorts by foot position, so you walk *behind* it
  and stop at its trunk.
- **A room stops being one indivisible thing.** Move a table, replace a statue,
  add a bench — no regenerating the room, no re-deriving its floor.
- **Water can move.** Once the pool and the waterfall are their own assets
  rather than paint, they can be animated. Impossible while they are baked in.

---

## 2. The room is a stage, not a scene

A room background is the set. Everything that acts is a sprite drawn on top of
it — so a generated room must be **completely empty of characters**. No people,
no figures, no animals, no silhouettes, not even a crowd blurred into the
distance. A painted-in figure cannot be talked to, cannot move, and permanently
occupies floor the player can walk through.

Also absent: **text of any kind.** Signage, labels, readable book spines, posters
with words — the generator spells them wrong, they cannot be localised, and they
date the art. Ask for symbols and shapes instead.

## 3. Framing

- **Landscape, wide view, camera straight on.** Generate at 1536x1024; the game
  samples down to its working size (320x200 in Newsey), so detail finer than a
  few pixels is wasted.
- **The floor fills the LOWER HALF of the frame** and is open. The lower half is
  where the player actually exists.
- **Depth belongs to props**, not to the plate. The far wall, the shelving, the
  pool — all of it is pass 3.

### Doors are art AND code

Every way out must be **visibly drawn** and its position **stated in the
prompt**: "a stone archway at floor level on the back-right wall". The code
wires exits by coordinates; if the art puts the door somewhere else, the player
walks through a wall or stands in a doorway that does nothing. A room whose door
moved is worth regenerating, not working around.

In Newsey each exit carries `to`, `arriveAt` (real unobstructed floor in the
destination, with clearance from every *other* exit there) and `arriveFacing`
(without it the player reads as materialising rather than stepping through).
`check_room_exits.mjs` enforces all three.

**A room's own `playerStart` must not sit inside its own exit trigger.** Doors
stay disarmed until you step off them — that is what stops an arrival throwing
you straight back out — so a spawn point on a threshold means the door never
arms at all, and you can walk into it forever with nothing happening. This
shipped once and was found by the walk test in §8.

### Lighting and palette come from the game, not the prompt

Per-room mood ("warm gold light", "cold blue dusk") is fine, but the base
palette, rendering technique and light logic live in that game's
`art-style.json`, so rooms in the same building look like the same building.

---

## 4. Placing and sizing props

Getting this wrong is what makes a room look like objects were sprinkled on it.

### Measure the wall before you measure anything that stands against it

**This is the first measurement in the room, before any prop's.** Everything
that stands flush against the back wall — a mirror, a nightstand, a shelf, a
cabinet — has to share the wall's own floor line (the Y where the wall panels'
art meets the floor), or it reads as floating with a strip of bare wall
showing under it. Get the wall's line wrong, or skip measuring it and just
inherit whatever `y` an earlier pass happened to use, and every prop placed
against it inherits the error — each one individually "measured correctly
off the scene" can still be wrong TOGETHER, the same way the wall's own
tiled copies have to agree with EACH OTHER (§ "Wall bands are tiled…") and
not just with the frame edges.

This is exactly what happened in the bedroom, TWICE, before it was actually
fixed. First pass: the mirror and the nightstand were each measured off the
scene independently and landed a few pixels short of the wall panels' own
declared floor line (y=102) — each individually plausible, both visibly
floating once assembled. Grounded to that line and re-signed-off. Second
pass: the whole room still read as "a little too high" on a live screenshot
— because y=102 was ITSELF wrong. It had been read by eye off a brightened
crop of the scene, which is a guess with a picture next to it, not a
measurement. The wall, the mirror and the nightstand were all consistently
grounded to the SAME wrong number, so nothing about them disagreed with each
other — the exact failure mode `grounding_problems()` (below) cannot catch,
because it trusts the wall's own declared y as correct.

**So the wall's own line needs a real measurement too, not just something
grounded to.** `room.py wallseam <game> <room> --strip x0,x1 [--strip x0,x1
...] [--method gradient|canny]` (`wall_seam.py`) finds it properly, and has
two methods for two different kinds of wall — the same "pick the tool that
fits the material" reasoning as `measure_blob.py`'s grabcut/canny choice.
`--method gradient` (default): a wall-to-floor seam is a horizontal edge, so
it shows up as a row-to-row jump in average brightness across a vertical
strip with nothing but bare wall/floor in it — works when the wall and
floor are different COLOURS (the bedroom's blue wallpaper over dark
parquet). `--method canny`: some rooms have a wall and floor close to the
same colour (the lab: both grey-green stone), so there's no colour jump to
find — gradient returns a low, inconsistent signal there. Canny edge
detection finds LOCAL edges instead — the wall's block coursing and the
floor's flagstone joints are still visually distinct patterns at the same
overall brightness, so the row where edge density changes still marks the
seam. Either method: give it at least two clean strips from different parts
of the frame — if their answers disagree by more than a few px, at least
one is crossing something that isn't bare wall/floor (furniture, a shadow, a
rug edge, the curve of an archway) and needs re-picking; the tool says so
rather than averaging two different measurements into a third wrong number.

Two real finds this way: the bedroom's seam (y=109, not the never-measured
102 it had been placed at — three clean strips of wallpaper-over-parquet
agreed to the pixel with `--method gradient`), and the lab's (y=89, not the
also-never-measured 122 — `--method gradient` couldn't commit on the
stone-on-stone wall, but `--method canny` at the door jamb's own base, well
clear of the archway's curve, found a strong, consistent edge). Both
confirmed by drawing the line over the scene and looking, same as everything
else measured this way — and both corrections were bigger than "a few
pixels off": the lab's wall was declared 33px lower than its real line,
which is also why furniture that had been "regrounded" against the wrong
wall value (the cabinet, moved from its correct scene reading of y=92 to a
wrong y=107) needed un-fixing once the real line was known. A wrong
reference doesn't just mismeasure the thing measured against it — it can
make an already-correct number look wrong and get "fixed" into an actual
error.

Record the answer as `wallSeam` in the room's `rooms/<room>.json` (see the
bedroom's for the exact command used). Two checks read it, in `room.py
verify`:

- `wall_seam_problems()` — a real FAIL, not a NOTE, if the wall band's own
  declared y in story.js ever drifts from the recorded `wallSeam` by more
  than a few px. This is one fact with a right answer, the same as
  `measured:`/`sizecheck` for a prop's own numbers, so it holds like one.
- `grounding_problems()` — prints a NOTE for any non-flat, non-`behind` prop
  whose `y` sits meaningfully short of the wall line (the recorded
  `wallSeam` if the room has one; the wall band's own current y, with a
  warning that it's unverified, if it doesn't). This one can only ever be a
  NOTE: plenty of furniture legitimately stands forward of the wall on
  purpose (a workbench, a table — the lab's bench reads completely fine
  despite failing this exact check), and nothing in the numbers alone can
  tell "flush against the wall, floating" from "forward of it on purpose" —
  a human still has to look at a render and decide. But the prompt to look
  is automatic now, on every room, every push, instead of depending on
  someone noticing a strip of wall in a screenshot.

**A floor's tile SCALE is a countable fact too, not something to eyeball —
and a re-fit doesn't fix a wrong scale on its own.** The lab's floor plate
was drawn with flagstones roughly 3x the size of the scene's own, invisible
in a side-by-side (both floors "look like flagstone floors" at a glance,
just at different densities) and unaffected by `room.py plate`'s fit/tone-
match step, which resizes and recolours the WHOLE image without touching
what's drawn on it. `room.py tilescale <game> <room> --row y0,y1
[--against-plate]` (`tile_scale.py`) counts tiles the way `wall_seam.py`
counts a seam: a clean row of floor has a joint (mortar line, plank seam)
between every tile, which is a real, countable column-to-column brightness
spike, not a matter of opinion. Count the scene's own row once, and that
count is the exact target for a regeneration prompt — "roughly 21 stones
span the full width", not "small flagstones", which is what actually closed
the gap: a first regeneration asked for "small" and still came back at
roughly half the scene's density (11 vs 21), a second asked for the counted
number specifically and landed close (16 vs 22, visually consistent). Not
every floor has discrete joints to count — grass, dirt, a seamless texture
gives this tool nothing to measure, same limitation as `wall_seam.py` on a
low-contrast wall.

### Use the numbers from pass 1

**First choice, every time: the position and size the composed scene used.**
Measure them, then use them. They are a composition that already proved it works.
Only invent a position when the floor plate came back with the path or the
doorway somewhere the scene didn't have it — and then move the prop the smallest
distance that clears it.

### Sizing, and when NOT to use a depth ramp

**Take the size from pass 1.** If the composed scene drew a thing the same size
front and back, ship it that way and give the room **no `depthScale`** — the
artist was telling you the room's perspective is shallow enough not to matter.
The Anarchy Garden is exactly this case: all four of its weeping fountains are
~56px in a 200px-tall frame regardless of depth. Placed by eye at 30–42px with a
ramp on, they read as garden ornaments instead of life-size statues, and three
rounds of "that still looks wrong" went by before the cause was found.

Only reach for a ramp when the art has strong depth and props at the two ends
genuinely need to differ:

```js
depthScale: { nearY: 198, farY: 40, far: 0.62 }
```

1.0 at `nearY`, `far` at `farY`, straight line between, clamped outside. A
prop's `h` is then its height at the front of the room; footprint and ground
shadow scale with it.

### Density is part of the composition

Count the ground cover in the composed scene before you place three tidy patches
and call it done. The garden's scene has *drifts* of white and orange flowers
across most of the lawn; the first assembly had three patches and read as a
different, emptier place even though every standing prop was correct.

### Composing, when you do have to place by hand

- **Anchor the edges.** The biggest props sit hard against the left and right
  margins so their canopies run off the side. That crop is what makes a room
  read as a corner of a real place rather than lollipops on a lawn.
- **Work in pairs and rows.** Two matching props flanking a path read as
  deliberate; one alone at a random offset reads as a mistake.
- **Keep the traffic lane clear**, and **leave the exits alone** — no prop's
  base within about a character's width of a doorway trigger.
- **Nothing overlapping terrain it can't stand on.** A prop's artwork rises from
  its base, so a statue based just below a pool has its head in the water.

---

## 5. Prompting

`games/<id>/art-style.json` carries the whole rule, so a prompt only has to say
**which pass** it is and what is in it.

**Pass 2, the floor plate** — say it plainly and say it twice, because "an empty
room" is not how these models read a room:

> THE <ROOM>, WALKABLE SURFACE ONLY. This image is the GROUND YOU CAN WALK ON
> and nothing else. Draw, on a background of FLAT PURE WHITE (#FFFFFF) with a
> crisp hard edge: … CRITICAL: absolutely NOTHING else in the frame. No water,
> no wall, no trees, no furniture, no people, no sky, no background scenery of
> any kind, no shadow cast from anything off-frame.

**Pass 3, a prop sheet** — the sheet is the point. Props generated one per image
drift apart in palette, lighting angle and pixel scale, exactly the way character
frames do. Drawn together, they cannot.

> A SHEET OF N PROPS, drawn side by side in ONE image so they share a palette
> and a scale. The background of the whole image must be FLAT PURE WHITE
> (#FFFFFF), completely uniform, with a crisp hard edge against each prop, a
> wide band of flat white between them so they never touch, and a generous white
> margin all round. All drawn from the SAME view, standing upright, each sitting
> on the same invisible ground line at the bottom, seen whole from base to top,
> casting no shadow.

Ask for **flat white, never transparency** — asking for transparency usually
returns a beige or gradient wash. (`build_props.py` handles both: if a sheet
does come back with real alpha it uses that, because keying white would eat a
white marble statue.)

**Keep sheets small.** A request for five portrait busts side by side came back
as a single close-up of one of them. Two to four items is reliable; more is not.

**Lock every free-standing prop's shape and orientation, the same way a
character's proportions get locked.** Pass 1 and pass 3 both draw from the
exact same `contains` sentence, in one call each — but "the same words" does
not mean "the same picture": two independent generations from identical text
can still draw two different objects. The bedroom's spec asked for "a
brass-bound steamer trunk with a domed lid" and got a low flat-topped chest in
the composed scene and a tall tilted barrel in the prop sheet — both are
honest readings of "domed lid", so the words were the bug. A vague noun phrase
leaves the model to invent the rest, and it does not invent the same thing
twice. Say the shape as an unambiguous, once-only fact, and rule out the
readings that go wrong: not just "a trunk" but "a low, wide, FLAT-TOPPED
rectangular box — NOT domed, NOT rounded, NOT barrel-shaped"; not just "the
bed" but "drawn TOP-DOWN and SQUARE TO THE ROOM … NOT drawn on the diagonal".
Every entry describing a piece of furniture (not ambient floor cover like a
rug) should carry this same pair — a positive shape statement plus the
negative of whatever the model tends to substitute — because that pairing is
what turned the trunk's SHAPE from a barrel into the right flat-topped box.

**Shape is not the same fact as proportion, and locking one does not lock
the other.** The trunk's second generation drew the correct shape at roughly
a third of the width it actually needed — "NOT domed, NOT barrel-shaped"
says what the object IS, nothing about how WIDE it reads next to its own
height, and the same gap cost the mirror and the bed a regeneration too, all
three found the same way: `room.py grid` against the approved scene, reading
real numbers off a ruler instead of eyeballing. So every entry that locks a
shape must ALSO state an explicit width-to-height ratio, sourced the same
way — not "wide", a number: "the frame's width is about HALF its height — a
1:2 rectangle", not "a low wide chest" but "width AT LEAST TWICE its
height — a 2:1 rectangle". This is a real gate, not just a habit to
remember: `room.py generate <game> <room> props` prints a NOTE (not a
refusal — it can see that a number is missing, not that a present one is
right) naming any entry that carries a shape lock (a `NOT ...` constraint)
with no `N:M` ratio anywhere in it, before a penny is spent on that
generation.

Shape and proportion together are still not everything: a wrong shape or
size is exactly the kind of thing `room.py check`'s side-by-side and blend
are for, so look at each prop in them individually, not just the room's
overall composition at a glance.

**Why automated matching against the scene doesn't work, and what to do
instead.** A prop's size and position are numbers, and a human reading them
off a picture makes the same kind of mistake typing does: the bedroom's rug
was declared at less than half its actual width, and its bed was drawn 14px
too tall, both signed off once on the side-by-side before being caught. The
obvious fix is to have code measure it — search the scene for wherever the
prop's own art matches best, the way `preview_room.py --fit` already does for
an OUTDOOR room's floor-colour silhouette. It does not generalise to an
interior room's furniture, and this was tested rather than assumed: four
methods — raw pixel difference, normalised cross-correlation, edge/gradient
correlation, and ORB feature matching with RANSAC (the actual standard
technique for "same object, different image") — were all tried against the
bedroom's bed, a case with a known-correct answer to check against. None of
them found it. The pixel/gradient methods systematically preferred smaller,
blurrier scales that loosely resembled many places instead of the one
correct one; ORB found only a handful of unstable keypoint matches and
produced a transform implying the bed was taller than the room. The common
cause: the scene and its props are independently generated, and while they
read as the same object to a person, they are not similar enough at the
pixel or feature level for correlation-based matching to lock onto — the
same thing `measure_props.py`'s own docstring already found for silhouette
matching, from a different angle.

So the reliable measurement is real numbers read off a picture with a ruler
on it, and there are two ways to read that ruler: `room.py grid <game>
<room> [--crop x0,y0,x1,y1]` renders the scene at the game's own 320x200
scale with a labelled pixel grid for a human to read by eye, and `room.py
measure <game> <room> <name> --rect x,y,w,h [--method grabcut|canny]` finds
the object's precise bbox with CV instead (see below — this is a DIFFERENT
problem from the cross-image matching that doesn't work, and it does work).
Either way, do this once per prop, write the result into that room's
`rooms/<room>.json` under `measured: { "prop_id": { x, y, h, w } }` (same
fields, same meaning, as a `props:` entry in story.js), and `room.py
sizecheck` — wired into `verify`, so it's a permanent CI gate — holds every
future edit to within 15% of that reading for as long as the room exists.
The measuring can be manual or CV-assisted; the ENFORCEMENT that a later
edit can't silently drift away from it is what's automatic either way, and
that's the part that was actually missing.

**`room.py measure` — a real tool for a different, tractable problem.** The
matching above failed because it's a CROSS-image problem: two independently
generated pictures of "the same" object, correlated against each other. Given
just ONE picture — the scene you already have — and asked to find one
object's own edges within it, established CV solves this cleanly, and a
hand-rolled flood fill (grow a region from a seed pixel, add a neighbour
within a colour tolerance) does not: tried first on the bedroom's bed, it had
no usable tolerance window at all — 11 kept the fill to one pixel, 12 leaked
to 71% of the whole frame — because the object is itself several genuinely
different colours (purple canopy, brown-and-gold posts) whose internal edges
are close in magnitude to the edge against the background. `room.py measure`
wraps two real tools instead (see `measure_blob.py`), and keeps BOTH rather
than picking a winner, because which one works depends on the object:
  - `--method grabcut` (default) — `cv2.grabCut`: given a generous rectangle
    with background margin, it fits foreground/background colour models and
    segments via graph cuts, a global optimum rather than a local pixel walk.
    Use it when the object contrasts from what's behind it BY COLOUR. Solved
    the bed and the mirror in one call each, agreeing with a manual
    re-measurement to a couple of pixels.
  - `--method canny` — Canny edge detection + `cv2.findContours`: finds
    intensity-gradient edges, not colour regions, so it works when an object
    is LOW-CONTRAST in colour but has strong internal edges (straight sides,
    bands, rivets). GrabCut found nothing foreground on the bedroom's trunk
    across several rectangles — its warm brown/gold sits too close to the
    similarly warm rug beneath it for a colour model to discriminate — canny
    found it in one pass, within a few pixels of a manual grid reading.
Both print an overlay to look at before trusting the number, same as every
other step in this pipeline — a tool result is not a signed-off measurement
until a human has actually looked at the picture it produced.

**Only rooms and in-room sprites go through the styled Action.** `art-style.json`
pins the camera to "top-down RPG interior room view", and that beats the prompt
even when the prompt says in capitals to ignore it — two straight-on cutscene
illustrations and a sheet of portrait busts all came back as top-down rooms with
a rug on the floor. Anything seen from another angle wants the freeform
"Generate image" and a hand-written prompt.

---

## 6. Why the mask can't be generated or detected

**The generator will not draw a usable diagram of its own picture.** Tried
directly: one prompt asking for a two-panel image — the finished room on the
left, its walkable floor filled flat green on black on the right. It drew a
cropped room in the left panel and left the right one blank. It will draw a
sheet of *things*; it will not draw a schematic view of a scene it just painted.

Automatic detection off a finished picture failed too. Five techniques, all
abandoned: a rectangle (no room in perspective is one); a hand-traced polygon
per room (magic numbers that go stale the moment the art is regenerated); a
flood fill of the surround (leaks up any wall where floor meets wall in a
gradient); climbing each column to the first hard edge (stops on a grout line,
and on a rune painted flat on the floor); and asking the generator directly.

**Pass 2 exists precisely so none of this is needed.**

For rooms whose art still has scenery painted in, `build_walkmask.py` keeps the
older path: the outline from the art's alpha, plus hand-measured `floorTop`,
`blocks` and `bounds`. Both paths erode the result by about half a character's
width so she can stand at an edge without clipping into what is beside her.
**Re-run it after changing any room's background.**

---

## 7. Pipeline — one front door

### THE STEPS, IN ORDER, AND WHAT ENFORCES EACH ONE

Every step below has a gate, because every step below was skipped at least once
and each skip cost real money. A step with no gate is a step that does not
happen. Read this list before touching a room; it is the whole process.

| # | Step | Enforced by |
|---|------|-------------|
| 0 | **Write the room's spec** — `games/<id>/rooms/<room>.json`: what the room is, what it contains, its floor, and WHICH WALL each way out is in. The map decides the doors. | `room.py generate` refuses without it |
| 1 | **Generate the scene** (pass 1) from that spec | `room.py generate <game> <room> scene` |
| 2 | **LOOK at the scene. Regenerate it until it is right. Change nothing else.** A wrong scene makes every later pass wrong, and none of it is repairable. | `room.py approve <game> <room>` — pass 2 and 3 refuse until you do, and regenerating the scene revokes it |
| 3 | **Generate the plate** (pass 2) and fit it | `room.py plate` — tone-matches it to the scene's own floor |
| 4 | **Generate the props** (pass 3) and cut them | `room.py props` |
| 5 | **Place them at the numbers the scene used** | `measure_props.py` (exteriors only — see its header for the interior gap) |
| 6 | **Render the overlay, LOOK at it, then say so** | `room.py check` renders; `room.py signoff <game> <room>` is the separate act that records you looked. `room.py verify` FAILS for any room not signed off since its art or placement last changed — and `check` alone does NOT clear it |
| 7 | **Wire the doors** — every exit on its own drawn doorway, every door a pair | `check_room_exits.mjs` |
| 8 | **Run the gate** | `room.py verify`, in `pages.yml` |

**Step 2 is the one that pays.** The Victorian bedroom's first scene came back
an isometric corner room; it was given a floor plate, three prop sheets and two
full assemblies before anyone noticed. All of it was thrown away. Regenerating
one scene costs one image; discovering the problem at step 6 costs six.

**Step 6 is the one that finds things.** Every sizing error in this project was
invisible in the numbers and obvious the moment the assembled room was put next
to its scene: statues at two thirds size, a rug the scene had that the room
never got, props at twice the height they should be, a floor lit like a
showroom under a candlelit room.


`.github/art/room.py` is the whole thing, generation included. Five scripts is
four too many to remember at 11pm.

**Every caller runs the same command.** A person at a terminal, the "Generate
room pass" Action (which is only a button on this script), and the Clubhouse
autopilot — which cannot dispatch a workflow from inside one, so it calls the
script directly. `room.py generate` picks its transport itself
(`.github/art/imagegen.py`): the in-run image broker if one is listening,
otherwise `OPENAI_API_KEY`. A model is never handed the key. Characters work
exactly the same way through `generate_row.py`; see `.github/art/README.md`.

```
room.py generate games/<id> <room> scene --room "The Anarchy Garden"
room.py generate games/<id> <room> plate --floor "mown grass and a flagstone path"
room.py generate games/<id> <room> props --n 2 --items "(1) a cherry tree; (2) a fountain"
        # builds the prompt, generates, writes to the path the next step reads
        # back. Refuses to run if the prompt still has a hole in it.

room.py prompt scene|plate|props …            # just print it, generate nothing

room.py plate  games/<id> <room>              # fit the plate + rebuild its mask
room.py props  games/<id> <room> name1 name2  # cut a prop sheet, left to right
room.py check   games/<id> <room>             # render the overlays to look at
room.py signoff games/<id> <room>             # after LOOKING: record that it is right
room.py verify games/<id>                     # the gate; runs in CI
```

The order of a whole room:

1. `room.py generate … scene` → `art-src/<room>_scene.png`. **Never shipped.**
   Measure everything off it — position, height, width, and how MANY of each
   thing there are.
2. `room.py generate … plate --floor "…"` → `art-src/<room>_floor.png`.
3. `room.py plate games/<id> <room>` — fits the plate to the frame and rebuilds
   the mask. Add the room to `FLOOR_PLATE_ROOMS` first.
4. `room.py generate … props --n N --items "…"` → `art-src/<room>_props.png`,
   then `room.py props games/<id> <room> prop_a prop_b`.
5. Write the `props:` block from your pass-1 measurements.
6. `room.py check games/<id> <room>` — **and actually look at both pictures.**
   Then `room.py signoff games/<id> <room>`.

   **Rendering is not looking, and the tool used to conflate them.** `check`
   wrote the sign-off digest itself, the moment it finished rendering — so the
   gate asking "has anyone looked at this room?" was answered by running the
   renderer, with nobody opening the picture. It surfaced the only way it
   could: as unexpected uncommitted changes after a session ran `check` on
   three rooms it had *not* approved, one of them visibly wrong (floor planks
   at the wrong scale, the scene's four-stool tables assembled as a single
   stool and a candle). Had those been committed, the build would have gone
   green over art nobody had accepted.

   So the two are separate now, and each refuses the other's shortcut:
   `check` records only that the overlay was rendered for *this* art, and
   `signoff` refuses unless that marker matches — you cannot sign off a room
   you never rendered, and rendering one does not sign it off.
7. `room.py verify games/<id>` and `check_room_exits.mjs`.
8. Walk it in-game.

The individual scripts are still there and still documented by `--help`:
`fit_plate.py`, `build_props.py`, `build_walkmask.py`, `show_walkmask.py`,
`measure_props.py`, `preview_room.py` (which also has a `--fit` mode that
searches for each prop's best match and prints a corrected block — a
suggestion, since it scores against a colour mask and busy ground cover pulls
it around).

### The gate

`room.py verify` runs on every push (`pages.yml`, "Verify room props and floor
plates"). Every check in it is a bug that shipped, and each was proved to fire
by breaking the room on purpose:

- a floor plate that doesn't fill the frame — since the plate IS the walkable
  area, that is the room being smaller than its own frame;
- `playerStart` inside its own exit trigger, so the door never arms;
- a prop footprint covering a doorway, making it unreachable;
- a prop pointing at art that doesn't exist — renders as nothing, silently;
- flat ground cover carrying a footprint, or a standing prop missing one;
- dead `floorPoly`/`obstacles` on a floor-plate room, contradicting the mask;
- a walk mask that no longer matches its plate;
- a tiled wall band (`behind`/`door` props sharing a Y, sized from their own
  art's aspect, not stretched) that no longer reaches both frame edges — see
  "Wall bands are tiled, and a re-cut can silently break their coverage"
  below;
- a prop with a forced `w` stretched past 5x from its own art's aspect ratio
  — see "A forced w/h can silently stretch a prop into a different shape"
  below. Below 5x it prints a NOTE instead of failing: a fuzzy check warns,
  it doesn't fail the build (same rule as `verify_sheet.py`'s neutral-frame
  threshold) — several props in this game sit at 2-4x stretch and read
  completely fine, so the fail line only trips for the unambiguous case;
- a room's wall band declared at a Y that doesn't match its recorded
  `wallSeam` — see "Measure the wall before you measure anything that
  stands against it" above. A prop standing meaningfully short of that
  line gets a NOTE, not a FAIL, for the same reason as the stretch check:
  some furniture is forward of the wall on purpose, and only a human
  looking at a render can tell that apart from actually floating.

**Wall bands are tiled, and a re-cut can silently break their coverage.** A
back wall (or any backdrop spanning wider than one image) is tiled at its own
native aspect rather than stretched — a single image asked to cover a span it
wasn't drawn for reads as smeared brick and warped wallpaper. That means the
number of copies needed depends on the art's own pixel aspect, which a re-cut
can quietly change: the bedroom's wall was measured at 5 copies covering the
frame, then the same art id got re-cut twice more for unrelated reasons, and
nobody re-checked whether 5 copies still added up to the frame width. They
didn't — a ~30px strip of bare floor showed through the wall on the right,
above where anyone looks in `room.py check`'s overlays (they frame the room's
furniture, not its bare edges) and outside what `sizecheck` catches (it diffs
one prop's own numbers, not "do N tiled copies still sum to the frame"). A
player noticed it in a live screenshot; `room.py verify` now catches it
itself — it unions the on-screen span of every `behind`/`door` prop sharing a
wall band's Y (several DIFFERENT arts can share one band, e.g. a wall tile
either side of a generated arch or portal — the check unions all of them
together, not one art's copies in isolation) and fails if that union stops
reaching both frame edges or leaves a gap between pieces. If a re-cut ever
changes a tiled backdrop's aspect again: recompute the copy count as native
w at the declared h, spaced at `w - 4` so neighbours overlap ~4px to hide the
seam, enough copies for the last one's right edge to clear the frame width.

**A forced w/h can silently stretch a prop into a different shape than its
own art.** Nothing checks that a prop's declared box is even roughly the
same shape as the picture being squeezed into it — measuring correctly off
the scene doesn't help, because the measurement and the render use the
same numbers, so a consistently-wrong box never reads as a mismatch against
itself. The bedroom's rug was found exactly this way: `x/y/h/w` matched the
scene's real footprint, but the rug ART underneath it was a PORTRAIT rug
(0.50 wide-to-tall) forced into a box nearly SEVEN times as wide as tall — a
6.8x stretch, reported as "the rug is stretched" off a live screenshot, not
by anything in the pipeline. `room.py verify` now computes this ratio for
every forced-`w` prop and prints a NOTE past 1.8x, failing only past 5x —
calibrated against this game's own props: several sit at 2-4x and looked
completely fine on a render (a symmetric medallion rug or a front-on
furniture panel doesn't reveal a stretch the way a directional runner rug
does), so a first version that failed at 2.5x was wrong about three props
that had already been looked at and accepted. LOOK at a render before
deciding a NOTE needs fixing — the number alone can't tell you.

**`--mode side` is the step that finds things.** The assembled room next to the
scene it came from shows in one look everything the numbers hide. All four of
the reference room's problems were found this way and none were findable any
other way:

| what it looked like | what it actually was |
|---|---|
| room feels cramped, black bars at the edges | the plate never filled the frame |
| statues look like garden ornaments | placed at ⅔ size, plus a depth ramp the scene didn't use |
| garden looks bare next to the scene | 3 patches of ground cover where the scene has drifts |
| a tree floats off its own shadow | shadow drawn to the footprint, not to the sprite |

Raw generations live in `art-src/`; shipped art is rebuilt from them, never
hand-edited.

### Room data

```js
props: [
  { art: "prop_cherry",  x: 54,  y: 96,  h: 94, base: { rx: 15, ry: 5 } },
  { art: "prop_pool",    x: 160, y: 64,  h: 44, w: 250, base: { w: 240, h: 16 } },
  { art: "prop_flowers_white", x: 66, y: 150, h: 44, flat: true }
]
```

- `x, y` — where the prop **meets the ground**, not its top-left corner: both
  its sort key and the centre of its footprint. For a `flat` prop it is the
  centre of the patch instead, since flat props have no foot.
- `h` — height at the front of the room.
- `w` — optional. Width normally follows the art's own aspect so a tree keeps
  its proportions; a pool or a run of wall has to span the room instead.
- `flat: true` — ground cover: flowers, grass tufts, a rug. Painted with the
  floor, never sorted, never blocking. Sorted like a standing prop, the player's
  own feet would sometimes vanish behind a flower.
- `base` — the footprint nothing walks into:
  - `{ rx, ry }` — an ellipse at its foot, for anything round-ish.
  - `{ w, h }` — a rectangle, for anything long and straight: a wall, the coping
    of a pool, a counter. An ellipse can't describe those and leaves walkable
    gaps at the corners.

  Cover only what touches the ground — a cherry tree blocks its **trunk**, not
  its canopy. Omit `base` entirely for flat ground cover.

---

## 8. Checklist before wiring a new room

1. Pass 1 composed scene generated FIRST and kept in `art-src/`.
2. Floor plate is *only* the walkable surface — no walls, water, furniture or
   scenery anywhere in it.
3. Plate run through `fit_plate.py` so it fills the frame.
4. Room added to `FLOOR_PLATE_ROOMS`; no `floorTop`/`blocks` needed.
5. Empty of characters, empty of text.
6. Every door visibly drawn, in the position the prompt asked for.
7. `playerStart` is NOT inside any exit trigger.
8. Props came from sheets of 2–4, not one image each; flat white or real alpha.
9. Props placed and sized on the pass-1 numbers, not by eye — including how
   MANY patches of ground cover the scene has.
10. `depthScale` only if the composed scene actually varied size with depth.
11. Each prop's `x, y` is its ground contact point; each `base` is the right
    shape and covers only what touches the ground; flat cover has `flat: true`
    and no `base`.
12. `build_walkmask.py` re-run and `show_walkmask.py` actually looked at.
13. `preview_room.py --mode side` actually looked at, against the composed
    scene. **This is the step that finds things.**
14. `check_room_exits.mjs` passes.
15. Walked in-game: into each wall, through each door, along each edge, and
    behind each prop.
