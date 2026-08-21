<!-- GENERATED from docs/ROOM_ART_STANDARD.md by .github/art/rules_card.py — do not edit.
     Edit the standard; the card is extracted from it and CI checks it matches. -->

# Room art standard
## 1. A room is generated in THREE PASSES
- **This is the rule everything else hangs off.** A room used to be one picture with its scenery painted into it, and everything downstream fought that.
### Pass 1 — the composed scene (a reference, never shipped)
- **Do not ship it, and beware how reasonable shipping it will sound.** The scene is a finished-looking picture of the room, so copying it to `art/bg-<room>.png` appears to save two passes and produces a room that looks right immediately. Every cost lands later, and all of them are permanent: the walkable floor cannot be recovered from a finished picture (§6 lists the five techniques that failed), painted scenery is something you can only ever be fenced away from rather than walk behind, water that is paint can never move, and moving one object means regenerating the whole room. This is the rule most likely to be argued away in the moment — it was argued away out loud once, by someone who had just read this page — so it is also checked: `room.py verify` fails the build when a shipped background is the same picture as its scene, and that check runs in `pages.yml` on every push.
### Pass 2 — the WALKABLE SURFACE, and only that
### Pass 3 — everything you CANNOT walk on, as props
### What this buys
- **The mask stops being hand-authored.** See §6 for the five techniques that failed at recovering a floor from a finished picture.
- **Scenery gets depth.** A painted tree is flat: you either walk over it or are fenced away from it. A prop sorts by foot position, so you walk *behind* it and stop at its trunk.
- **A room stops being one indivisible thing.** Move a table, replace a statue, add a bench — no regenerating the room, no re-deriving its floor.
- **Water can move.** Once the pool and the waterfall are their own assets rather than paint, they can be animated. Impossible while they are baked in.
## 2. The room is a stage, not a scene
## 3. Framing
- **Landscape, wide view, camera straight on.** Generate at 1536x1024; the game samples down to its working size (320x200 in Newsey), so detail finer than a few pixels is wasted.
- **The floor fills the LOWER HALF of the frame** and is open. The lower half is where the player actually exists.
- **Depth belongs to props** , not to the plate. The far wall, the shelving, the pool — all of it is pass 3.
### Doors are art AND code
- **A room's own `playerStart` must not sit inside its own exit trigger.** Doors stay disarmed until you step off them — that is what stops an arrival throwing you straight back out — so a spawn point on a threshold means the door never arms at all, and you can walk into it forever with nothing happening. This shipped once and was found by the walk test in §8.
### Lighting and palette come from the game, not the prompt
## 4. Placing and sizing props
### Use the numbers from pass 1
- **First choice, every time: the position and size the composed scene used.** Measure them, then use them. They are a composition that already proved it works. Only invent a position when the floor plate came back with the path or the doorway somewhere the scene didn't have it — and then move the prop the smallest distance that clears it.
### Sizing, and when NOT to use a depth ramp
- **Take the size from pass 1.** If the composed scene drew a thing the same size front and back, ship it that way and give the room **no `depthScale`** — the artist was telling you the room's perspective is shallow enough not to matter. The Anarchy Garden is exactly this case: all four of its weeping fountains are ~56px in a 200px-tall frame regardless of depth. Placed by eye at 30–42px with a ramp on, they read as garden ornaments instead of life-size statues, and three rounds of "that still looks wrong" went by before the cause was found.
### Density is part of the composition
### Composing, when you do have to place by hand
- **Anchor the edges.** The biggest props sit hard against the left and right margins so their canopies run off the side. That crop is what makes a room read as a corner of a real place rather than lollipops on a lawn.
- **Work in pairs and rows.** Two matching props flanking a path read as deliberate; one alone at a random offset reads as a mistake.
- **Keep the traffic lane clear** , and **leave the exits alone** — no prop's base within about a character's width of a doorway trigger.
- **Nothing overlapping terrain it can't stand on.** A prop's artwork rises from its base, so a statue based just below a pool has its head in the water.
## 5. Prompting
- **Pass 2, the floor plate** — say it plainly and say it twice, because "an empty room" is not how these models read a room:
- **Pass 3, a prop sheet** — the sheet is the point. Props generated one per image drift apart in palette, lighting angle and pixel scale, exactly the way character frames do. Drawn together, they cannot.
- **Keep sheets small.** A request for five portrait busts side by side came back as a single close-up of one of them. Two to four items is reliable; more is not.
- **Only rooms and in-room sprites go through the styled Action.** `art-style.json` pins the camera to "top-down RPG interior room view", and that beats the prompt even when the prompt says in capitals to ignore it — two straight-on cutscene illustrations and a sheet of portrait busts all came back as top-down rooms with a rug on the floor. Anything seen from another angle wants the freeform "Generate image" and a hand-written prompt.
## 6. Why the mask can't be generated or detected
- **The generator will not draw a usable diagram of its own picture.** Tried directly: one prompt asking for a two-panel image — the finished room on the left, its walkable floor filled flat green on black on the right. It drew a cropped room in the left panel and left the right one blank. It will draw a sheet of *things*; it will not draw a schematic view of a scene it just painted.
- **Pass 2 exists precisely so none of this is needed.**
- **Re-run it after changing any room's background.**
## 7. Pipeline — one front door
- **Every caller runs the same command.** A person at a terminal, the "Generate room pass" Action (which is only a button on this script), and the Clubhouse autopilot — which cannot dispatch a workflow from inside one, so it calls the script directly. `room.py generate` picks its transport itself (`.github/art/imagegen.py`): the in-run image broker if one is listening, otherwise `OPENAI_API_KEY`. A model is never handed the key. Characters work exactly the same way through `generate_row.py`; see `.github/art/README.md`.
# builds the prompt, generates, writes to the path the next step reads
# back. Refuses to run if the prompt still has a hole in it.
### The gate
- **`--mode side` is the step that finds things.** The assembled room next to the scene it came from shows in one look everything the numbers hide. All four of the reference room's problems were found this way and none were findable any other way:
| what it looked like | what it actually was |
|---|---|
| room feels cramped, black bars at the edges | the plate never filled the frame |
| statues look like garden ornaments | placed at ⅔ size, plus a depth ramp the scene didn't use |
| garden looks bare next to the scene | 3 patches of ground cover where the scene has drifts |
| a tree floats off its own shadow | shadow drawn to the footprint, not to the sprite |
### Room data
## 8. Checklist before wiring a new room
