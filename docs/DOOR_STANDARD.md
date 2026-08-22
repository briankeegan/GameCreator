# Door standard — the ways between rooms

Every game in this repo that has more than one room needs a way between them,
and every one of those ways has gone wrong in the same handful of ways. This
is the shared rule for all of them: what a door *is*, where it may be put, what
happens when you walk through it, and what a test is allowed to assert about
it. It applies to any game of either shape below — not only to the two it was
written from.

Read this before adding, moving or regenerating a way out of a room. The
checker is `.github/scripts/check_room_exits.mjs` (run it with no arguments;
it finds every game itself), and it runs on every push as the "Verify room
exits" step in `pages.yml`. The art half is measured by
`.github/art/room.py verify`.

---

## 1. A door is one half of a PAIR

- **A door is a PAIR, not a one-way trip with a destination typed beside it.**
  Every way out carries a `link`, and the way you come out is whichever thing
  in the destination room shares that link. This is the rule the whole
  document hangs off, and it is the one that was learned the hard way.
- **Exactly one thing in the destination must carry the link.** Zero means you
  arrive nowhere near a door; two means nothing can say which one you come out
  of. Both fail the build.
- **A linked thing does not have to be a doorway.** An NPC can be the far side
  of a link — Newsey's lounge portal is a swirl you talk to, and the arena's
  plain doorway is its partner. What matters is that the link has two ends.
- **What replaced this was `arriveAt` + `arriveFacing`: two numbers and a
  direction, written on the far side of the file from the door they belonged
  to.** They drifted, because nothing tied the two halves of a door together.
  The Library, the Anarchy Garden and Kyran's Lab all put the player down on
  the same square of lounge floor, nowhere near the rune door she had just
  walked through, and coming downstairs left her in the middle of her father's
  living room rather than at the stairs. Every one of those values was
  individually valid — on the floor, not in a wall — and every check passed,
  because no check compared the two sides of a door to each other.

## 2. Arrival is DERIVED, never typed

- **Where you land and which way you face are worked out from the partner at
  runtime.** Step out of the partner's own rectangle into the room, with your
  back to it. There is deliberately nothing to type, so there is nothing to go
  stale when a room is re-laid-out.
- **Step out far enough to be CLEAR of the doorway, not merely off it.** A
  doorstep chosen with no margin sat one pixel outside the lounge's door, and
  the nudge that keeps the player on the floor was enough to push her back onto
  it. Newsey uses `DOORSTEP_CLEARANCE = 8`; the checker uses the same number,
  and both must move together.
- **Re-derive once the room's collision data has really loaded.** The first
  pass may only have the room's rough fallback polygon, which can name a spot
  the real mask then rejects. Re-deriving is exact; nudging a rejected spot is
  a guess, and the guess is free to shove the player onto the very door she
  stepped out of.
- **A door with nowhere to step out of fails silently in play.** Arrival falls
  back to the room's `playerStart`, so the player walks through a door and
  appears in the middle of the room with no error anywhere. The checker
  simulates the step-out and fails the build instead.

## 3. Two shapes, one contract

- **DERIVED — rooms of any shape, doors in any wall, travel both ways.** The
  room table is data (`games/<id>/story.js`), each exit is a rectangle with a
  `link`, and arrival is computed. Newsey is the reference. This shape buys
  freedom and pays for it with everything in §2 and §5.
- **CONSTANT — every room the same grid, each way out a fixed cell in a
  boundary wall.** Arrival is not computed, because it does not vary: you leave
  by one room's wall and start on a fixed cell against the facing wall of the
  next. Dog Punk is the reference, and it has never had a door bug, because it
  never gave itself the chance to have one.
- **Pick CONSTANT if the game can live with it.** Doors work "much better" in
  the grid shape and it is worth being honest about why: not better code, a
  stricter constraint. Arrival is a fact rather than a computation, and the
  ping-pong of §5 is impossible because you arrive against the wall opposite
  the one you left by, a whole room away from any way out.
- **In the constant shape the partner is IMPLICIT — the next room — and that is
  exactly what has to be checked.** You leave through one room's wall and
  arrive against the FACING wall of the next, lined up with the way you came
  out. Get it wrong and you walk out of one room and appear somewhere unrelated
  in the next, with nothing to notice it, because there is no partner to
  disagree with. So the checker pairs consecutive rooms: opposite walls, and
  aligned across the shared edge to within a cell.
- **Do not mistake one level's LAYOUT for the rule.** This check began as
  "every room's gate is in the same cells", which was true while Dog Punk's
  chapter was a single straight column of three rooms and false the moment it
  grew to fifteen and started turning corners. A rule that describes today's
  map fails the first time the map is good.

## 4. Where a door may go

- **The map decides which wall a door is in, and a prompt retyped from memory
  does not.** A room's spec (`games/<id>/rooms/<room>.json`) names the wall
  each way out is drawn in, the art is generated from that spec, and the exit
  trigger in code has to agree with it. When they disagree, the doorway is
  painted in one wall and armed in another.
- **Use the wall vocabulary the generator understands** — `back`, `back-left`,
  `back-right`, `left`, `right`, `near` (`WALL_PHRASE` in
  `.github/art/room.py`). An unrecognised name is not a typo the prompt
  survives: it is pasted into the generator's prompt as a bare word and the
  doorway comes back wherever the model felt like putting it.
- **Do not type a trigger's four numbers. Derive them, with
  `.github/art/remap_doors.py <game>`.** It reads the doorway out of the art —
  the door prop's own footprint in a floor-plate room, the notch in the walkable
  floor in a painted one — and refuses to propose anything for a wall where it
  has neither, because a confident wrong answer costs more than no answer. Run
  against every room with the notch rule alone it wanted to drag all four of the
  Lounge's doors to the top edge of the frame.
- **THE DIVOT IN THE FLOOR IS THE DOOR.** In a floor-plate room the doorway is
  the alcove where the plate's walkable floor pokes out past the rest of its
  wall. That alcove is the only honest source for the trigger — not a door
  prop (there may not be one), not the painted art (a wall prop may be drawn
  across it), and never four typed numbers.
  - **The trigger spans the alcove as far as you can walk**, out to the last
    walkable pixel and hard against the black. `--outside` is the knob:
    `remap_doors.py <game> --outside N --write`, and `--skip` keeps it off the
    rooms whose doors are already right. Newsey's side doors want `--outside
    14`, which covers the full alcove; its back-wall doors are correct at the
    default 10 and must not be swept along with them.
  - **`remap_doors.py` must be able to SEE the alcove, and for a long time it
    could not.** `NOTCH_PROMINENCE` was 16 while the Lounge's side alcoves are
    10px and 12px deep, so the tool answered "no source to re-derive from" for
    doorways it was looking straight at — and whoever needed the numbers
    invented them. The invented triggers landed 50px below the alcove, half of
    each one off the walkable floor, in a stretch of wall with no doorway in
    it at all. The threshold is 9 now: under every real doorway measured here
    (10, 12, and back-wall arches at 16+) and above the deepest wobble on a
    wall that has none (9.0). A measuring tool that cannot see the thing it
    measures does not merely fail — it sends people off to guess.
  - **A wall prop drawn across the alcove hides the door and blocks it.** The
    Lounge's five back-wall panels each carry a 60x8 footprint, and the outer
    ones straddled both doorways: `room.py verify` failed them as unreachable,
    which is how the alcoves were found in the first place. Trim the
    footprint's lip clear of the opening (8 -> 6 there); do not move the
    trigger to suit the prop.
  - **A wall with no alcove has no door.** Newsey's Lab has a flat left wall
    and the Bedroom's is 8px — neither is a doorway the tool will derive, and
    a trigger authored there is a way out through a solid wall. Cut the
    opening into the plate; do not paper over it with a rectangle.

- **A door has to be ENTERED, not grazed, and that is a number you can measure.**
  `remap_doors.py` reports how deeply a player can get onto each trigger. The
  Arena's way out was armed up in the stands above the walkable platform and
  scored ONE pixel: every structural check passed, the browser door test passed,
  and holding a direction out of the spawn walked straight past it into the wall.
  Every working door in Newsey measures 13-14px, so the floor is set at 6, and
  `remap_doors.py <game> --check` is the "Verify doors can be entered" step in
  `pages.yml`. It fails on the unambiguous half only — a door nobody can enter
  is a fact; the tool's proposals to MOVE a trigger are advice, since it cannot
  see prop collision, and a fuzzy check must never block a deploy.
- **The check that catches this walks the room with the GAME's own collision.**
  A static model built on the walk mask called that Arena door reachable,
  because the mask knows where the floor is and knows nothing about the benches
  in front of it. The reachability sweep in `browser.test.js` floods the room
  through `canStand` from where the player actually arrives — a test carrying
  its own copy of the collision rules is a test that drifts away from the game.
- **A door test that teleports the player next to a trigger proves the door
  FIRES, not that anyone can reach it.** That is the hole the Arena sat in for
  as long as it existed. Both tests are worth having; only one of them is about
  reachability.
- **A ROOM HAS A WALL AND YOU CANNOT WALK INTO IT — check this before trusting
  anything about a door.** Newsey's Library, Lounge, Bedroom and Anarchy Garden
  all let the player walk to y=0, into the bookcases, over the bar and through
  the back wall. Their floor plates cover 77-89% of the frame, so the walk mask
  calls the wall band floor, and the wall props either carry no footprint or one
  that does not span them. A door placed against that "floor" looks reachable
  and is nonsense. Measured: the painted rooms put their floor's top edge at
  y=103-105 of 200, and the three-pass standard says the floor fills the LOWER
  HALF, so nothing should be standable in the top 15% of the frame.
- **The only honest reachability check boots the game.**
  `.github/scripts/check_door_reach.mjs` floods each room from where the player
  arrives, through the game's own `canStand`, and reports per door how many
  reachable positions touch it and how deeply it can be entered — plus how high
  the player can walk, which is what catches a wall you can stand in. It is not
  in `pages.yml` for the same reason `browser.test.js` is not: it needs
  Playwright, and browser timing flakiness must never block every game's deploy.
  Run it by hand after touching a room, a plate, or a door.
- **A doorway you cannot stand on is not a door.** The trigger has to sit on
  walkable floor. `room.py verify` measures how much of each trigger's
  rectangle is inside the room's walk mask and fails below 15% — calibrated
  against the rooms that exist, where the worst correct door (the lounge's east
  door, half doorframe by nature) scores 37.8% and back-wall arches score 100%.
  A door armed against a wall scores 0 while every structural check passes.
- **Nothing may be placed on a doorway.** No prop's footprint within about a
  character's width of a trigger, or the door cannot be reached; `room.py
  verify` checks prop bases against exit rectangles.
- **A room's `playerStart` must not sit inside its own doorway.** Doors arrive
  disarmed and re-arm only once you step clear of them (§5), so a spawn on a
  threshold means the door never arms at all and the player can walk into it
  forever with nothing happening. This shipped once and was found by a person
  playing it.
- **A room you can leave but never enter is a room nobody will ever see.** The
  first room of the game is the one legitimate exception.

- **A DOOR IS ENTERED, NOT STOOD ON.** A door only opens for a player
  *walking the way that door faces*: the door in the right-hand wall opens for
  someone heading right, the arch in the back wall for someone heading up.
  Overlap alone used to be enough, and the side doors' triggers are tall bands
  down the edge of the room — so brushing the left wall on the way somewhere
  else took you through the west door. It reads as the room grabbing you.
  - The required direction is **derived from where the trigger sits**
    (`exitEnterDir` in `app.js`), never typed beside it, for the same reason
    arrival is derived: two values that must agree will eventually disagree. A
    tall slot near the left edge is a door in the left wall; a wide band across
    the bottom is the way out toward the viewer. `enter` on the exit overrides
    it for anything that is not simply a hole in a wall.
  - Because the shape decides the direction, a side door's trigger must be
    **taller than it is wide** and a wall/near door's **wider than it is tall**.
    That is also the honest shape for each: you cross a side doorway moving
    sideways.
  - Checked by `.github/scripts/door-direction.test.js`, which drives the real
    game: standing on a door and walking the wrong way must not open it, and
    walking into it the right way must.

- **Only draw a door the ART does not already have.** `drawn: "threshold"`
  exists for exits with no doorway painted in the room. The side doors carried
  `drawn: "sidebreach"`, which painted a dark trapezoid from the trigger to the
  frame edge over art that *already had* lit arches in both margins — a
  hand-drawn gash unrelated to the picture underneath, 58px tall. Deleted.
  Before adding a drawn door, open the room art and check there isn't one
  there already.

- **YOU COME OUT WHERE YOU WOULD GO IN.** Arrival is the partner door's own
  rectangle — the same spot you would walk into to come back — not a place
  near it. Stepping out to a clear patch of floor puts you a stride into the
  room from an opening you cannot see, which reads as being teleported in
  rather than walking through a wall, and it makes the two sides of a door
  impossible to line up by eye.
  - Standing on the doorstep is safe *because* of the two rules below: a door
    arrives disarmed, and stays shut until you let go of the direction that
    brought you through. That pair is what makes landing on the trigger work,
    and it is why the old `DOORSTEP_CLEARANCE` was never needed.
  - Which way you face on arrival is the opposite of the partner door's own
    entry direction — derived, not typed, like everything else about a door.
  - Checked by `.github/scripts/door-arrival.test.js`, which asks the running
    game for every door's arrival and fails unless it lands inside the partner
    rectangle.
  - **That test must VISIT each room before asking about it.** `canStand`
    needs the room's walk mask decoded, and an unvisited room has none — so it
    answers "you cannot stand anywhere", which is indistinguishable from a
    door with no arrival. The first version of this test reported five broken
    doors that were all fine.

## 5. Arriving without bouncing back

- **Doors arrive DISARMED and re-arm only when you step clear of them.**
  Otherwise arriving in a doorway immediately throws you back through it.
- **Stepping clear is not enough on its own: the door also stays shut until you
  LET GO of the direction that took you through it.** You come out facing away
  from the door but still holding the key that walked you into it, and that key
  points straight back at the door you just came out of. The doorstep is only a
  stride away by design, so a held key walks you back and forth between two
  rooms forever. A fresh press is what re-opens the door.
- **A way out in the constant shape gets the same two rules for free** — but
  only because its spawn is at the opposite end of the room. The checker
  enforces that separation rather than trusting it.

## 6. What a test may assert about a door

- **Never assert — or ASSUME — a value the room data determines.** The door
  grid carried a hand-typed approach direction per case, and when the Arena's
  portal moved from its right-hand wall to the bottom of the floor the case
  still said "up": the test walked the player away from the door and reported
  the door broken. The door was fine. Derive which way you walk into a door
  from where the door is — and test the side walls FIRST, because a top-down
  room's floor lives in the lower half of its frame, so an ordinary side door
  sits low and "nearest edge in pixels" calls it a near door every time.
- **Never assert a value the code DERIVES.** A door test that named the exact
  facing each arrival should end on was a snapshot of one day's room art, and
  it went stale the moment a room was regenerated.
- **Assert the invariant instead:** you end up in the right room, and you land
  clear of every doorway. Standing in one means it never arms, which IS the
  ping-pong bug.
- **Beware the invariant-shaped non-invariant.** "You don't arrive facing back
  the way you walked" sounds right and is false for any door in a back wall —
  walk UP into the Lounge and you arrive facing DOWN, into the room.
- **Walk a test character in axis legs, never a diagonal, and never for a fixed
  number of milliseconds.** A diagonal from the house's stairs to its front
  door clips the stairs trigger and walks her back upstairs; a held key polled
  from Node overshoots the target by half a room. Legs plus a short homing loop
  is the shape that survives a room being re-laid-out.
- **A loop over N doors must COLLECT its failures and assert the list at the
  end.** Throwing on the first one turns "which doors are broken?" into one
  question per four-minute run.

## 7. The checks

Rule → tool → gate, the same as everything else here. Every check listed was
proved to fire by breaking a room on purpose.

| What it catches | Tool | Gate |
| --- | --- | --- |
| A door with no link, no partner, or two partners | `check_room_exits.mjs` | "Verify room exits" |
| A destination that isn't a room; a room nothing leads into | `check_room_exits.mjs` | "Verify room exits" |
| A door with nowhere to step out onto (arrival silently falls back to `playerStart`) | `check_room_exits.mjs` | "Verify room exits" |
| A `playerStart` parked on the room's own doorway | `check_room_exits.mjs` | "Verify room exits" |
| Art and code disagreeing about which wall a door is in | `check_room_exits.mjs` | "Verify room exits" |
| A wall name the room generator doesn't understand | `check_room_exits.mjs` | "Verify room exits" |
| A grid game where you leave by one wall and arrive against the same wall, or land out of line with the way out you came through | `check_room_exits.mjs` | "Verify room exits" |
| A grid map with a short row, no gate, or a spawn touching the gate | `check_room_exits.mjs` | "Verify room exits" |
| A door-data file the game never loads, or never precaches | `check_room_exits.mjs` | "Verify room exits" |
| A trigger a player can only graze rather than enter | `remap_doors.py --check` | "Verify doors can be entered" |
| A trigger armed somewhere the player cannot stand | `room.py verify` | "Verify room props and floor plates" |
| A prop footprint covering a doorway | `room.py verify` | "Verify room props and floor plates" |

- **None of these ask a model anything.** Every one is a number a script
  computes — a rectangle overlap, a pixel count against a walk mask, a set
  comparison between two rooms' maps. That is deliberate: the judgement was
  moved into the tooling so no run has to supply it.

## 8. Adopting this in a new game

- **Publish the door data as plain data, in its own file, with no DOM in it.**
  That is the whole cost of admission, and it is what the checker detects.
  Rooms that live inside `app.js` beside `document.getElementById` cannot be
  read by any tool without a browser, so they cannot be checked at all — which
  is why Dog Punk's maps were moved out to `games/dog-punk/rooms.js`.
- **Which games are checked is DETECTED, never configured** — `story.js` for
  the derived shape, `rooms.js` for the grid shape. A new game is covered the
  moment it publishes one, with no list to remember to update.
- **Behaviour stays in `app.js`.** The data file is the level; what a door
  *does* when you touch it is code.
- **Load it AND precache it.** A door-data file the game does not load kills
  the game at startup on the missing global; one it does not list in `sw.js`
  works online and breaks the moment the PWA is offline, which is the failure
  nobody hits until they are on a train. Both are checked — `sync-precache.js`
  deliberately answers only "does every listed file exist", never "is every
  needed file listed", so this half belongs to the door gate. Dog Punk shipped
  the second of these for exactly as long as it took the check to be written.

## 9. Checklist

1. Decide the shape first (§3). Constant if the game can live with it.
2. Write the room's spec, naming the wall each way out is in (§4).
3. Generate the art from the spec — never from a wall retyped from memory.
4. Add the exit with a `link`, and give the partner the same `link` (§1).
5. Type nothing about where the player lands (§2).
6. Run `node .github/scripts/check_room_exits.mjs` and
   `python3 .github/art/room.py verify games/<id>`.
7. If you add a door test, assert invariants only (§6).
