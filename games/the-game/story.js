// Newsey / "Puzzle Attack" — story + world data.
//
// Adapted from the owner's plot (full verbatim in Clubhouse PR #30, structured
// in reference/the-game/PLOT.md). Two modes, both driven from here:
//
//   1. CUTSCENE — the backstory (prologue through waking in Infinity) is
//      narrated memory, not something to walk through. Tap-to-advance lines,
//      exactly like a classic JRPG opening.
//   2. WALK-AROUND — once Nella wakes in Infinity, it's a classic top-down
//      room: move around with arrow keys / touch joystick, walk up to an NPC,
//      press interact (or tap them) to talk. Real "walk around and talk to
//      people" — not a visual novel.
//
// Art is referenced by id (art/<id>.png for portraits/sprites, art/bg-<id>.png
// for room backgrounds) and everything has a graceful fallback (tinted shape +
// initial) so the game is fully playable with zero art present.

window.NEWSEY_STORY = (function () {
  // Speakers: nameplate label + accent color (matches robe/gem vibes in the plot).
  var CHARACTERS = {
    nella:   { name: "Nella",        color: "#c0392b" },
    dad:     { name: "Dad",          color: "#b9975b" },
    chuck:   { name: "Chuck",        color: "#2e86c1" },
    news:    { name: "News Anchor",  color: "#8a8f98" },
    devil:   { name: "???",          color: "#e84393" },
    tv:      { name: "Old TV",       color: "#5a4a7a" },
    portal:  { name: "The Portal",   color: "#00cec9" },
    bed:     { name: "Your Bed",     color: "#ffd166" },
    frontDoor: { name: "The Front Door", color: "#b9975b" },
    may:     { name: "May 2000",     color: "#e84393" },
    kat:     { name: "Kat",          color: "#27ae60" },
    john:    { name: "John Boxley",  color: "#6c5ce7" },
    timothy: { name: "Timothy",      color: "#dfe6e9" },
    rex:     { name: "Rex",          color: "#c9a227" },
    kyran:   { name: "Kyran",        color: "#00b894" },
    michael: { name: "Michael",      color: "#74b9ff" },
    diamond: { name: "Diamond",      color: "#fd79a8" },
    eric:    { name: "Eric",         color: "#b2bec3" },
    magma:   { name: "Magma",        color: "#e17055" }
  };

  // ---- 1. CUTSCENES: two short narrated beats, playable room in between --
  // Kept SHORT on purpose — this is a game, not a book. The plot's full prose
  // is reference/the-game/PLOT.md; it's a blueprint for what to BUILD (scenes,
  // art, rooms), not text to put on screen. Every bg id here gets its own
  // generated scene, so the picture carries the setting — the line under it
  // only needs to carry the beat.
  // `narration` = internal thought / memory / scene description — NOT the
  // character speaking out loud. Rendered as an unattributed italic
  // caption (no nameplate) so it reads as narration, not as dialogue.
  //
  // INTRO_CUTSCENE plays once at boot, up through "it's just me and this
  // house now" — the moment the story reaches the present. Everything after
  // that is playable (ROOMS.house below): Chuck's arrival, finding the
  // cartridge and the note are real in-room dialogue, not narration.
  // DREAM_CUTSCENE is a second, later narrated beat — triggered by
  // interacting with the TV in ROOMS.house — covering the night she plays the
  // cartridge, through the deal that drops her into Infinity. The panel game
  // itself IS playable now (duel.js): every NPC with a `duel` block below
  // opens a real Panel Attack match.
  var INTRO_CUTSCENE = [
    { bg: "childhood", who: "nella", art: "nella_child", narration: true, text: "Age nine. My first video game: \"Puzzle Attack.\" Match three, or get smashed flat. I was obsessed." },
    { bg: "mall", who: "nella", narration: true, text: "Age ten. A Puzzle Attack tournament at the mall — my hero May 2000 was competing. Then the screaming started." },
    { bg: "news", who: "news", art: null, text: "Six dead. Twenty-three injured. \"Puzzle Attack\" is pulled from shelves, banned nationwide." },
    { bg: "rain", who: "nella", art: "nella", narration: true, text: "Twenty years later. My father just died. It's just me and this house now." }
  ];

  var DREAM_CUTSCENE = [
    { bg: "crt", who: "chuck", art: "chuck", text: "Ready, Nella?" },
    { who: "nella", art: "nella", narration: true, text: "Twenty years gone, and my hands remembered everything." },
    { who: "chuck", art: "chuck", text: "Nella, I don't think your dad hid a secret in a video game. This sounds insane." },
    { who: "nella", art: "nella_scream", narration: true, text: "The scream came from somewhere I didn't know I had." },
    { who: "nella", narration: true, text: "I played through the night." },
    { bg: "crt_red", who: "nella", narration: true, text: "8 AM. One more try. I beat it — the run of my life." },
    { bg: "latin", who: "nella", narration: true, text: "\"Omne ignotum pro magnifico.\" Handwritten. Blood-red. Not part of the game." },
    { bg: "chaos", who: "nella", narration: true, text: "A skull. A chaos symbol. \"A deal is struck. Proceed?\"" },
    { who: "nella", narration: true, text: "I pressed Start and Select." },
    { bg: "", narration: true, text: "The world faded to black." }
    // After this: waking up, the horns in the mirror, the devil's welcome —
    // is not narrated either, it's ROOMS.bedroom (Infinity).
  ];

  // JOHN_CUTSCENE — the chapter's hinge, and the one beat that was compressed
  // into four lines of room dialogue when it is the whole point of the
  // chapter. Plays the FIRST time you sleep in the Infinity bed: you wake to
  // a knock, and John is in the doorway.
  //
  // Straight from the verbatim plot, in its order. Two new backgrounds carry
  // the two images that matter — the chaos symbol she draws on the mirror in
  // lipstick, and the mirror turning into a screen showing her own body.
  var JOHN_CUTSCENE = [
    { bg: "bedroom", who: "nella", narration: true, text: "Knocking. I pulled the blanket around me and froze. I wasn't ready to face anyone." },
    { who: "john", art: "john", text: "Nella. Open the door." },
    { who: "nella", narration: true, text: "Instead of an answer, the door opened on its own." },
    { who: "john", art: "john", text: "Nella, I'm glad you have finally arrived. I am here to welcome you to Infinity, and to explain why it is you are here." },
    { who: "john", art: "john", text: "Nella, you can't leave." },
    { who: "nella", art: "nella", text: "Who are you?" },
    { who: "john", art: "john", text: "I am John. John Boxley. Founder of the Boxley Game Development Company. Creator of Puzzle Attack. And I am trapped in Infinity. And now, so are you." },
    { bg: "mirror_symbol", who: "nella", narration: true, text: "I took a lipstick off the vanity and drew the symbol on the mirror — a circle, with arrows inside it pointing outward." },
    { who: "john", art: "john", text: "That is the symbol for chaos. The deal that was struck was for your soul, in exchange for magical powers." },
    { who: "john", art: "john", text: "…It didn't work the way that I thought it would." },
    { who: "nella", art: "nella", text: "Am I dead?" },
    { who: "john", art: "john", text: "Not yet." },
    { bg: "mirror_body", who: "nella", narration: true, text: "He wiped the lipstick away with his sleeve and tapped the glass. The mirror turned into a screen. And on the screen, I saw myself." },
    { who: "nella", narration: true, text: "Not the avatar. Me. Cross-legged in front of the television, gone grey, my eyes rolled back, a little blood at my ear." },
    { who: "nella", art: "nella_scream", text: "What do you mean, \"not yet\"? What's WRONG with me?" },
    { who: "john", art: "john", text: "You must return to your body within one hour of initiating the ritual, or you will die." },
    { who: "john", art: "john", text: "Time works differently here. A day in Infinity is a minute in the real world. So you still have fifty-nine minutes and about thirty seconds." },
    { who: "nella", art: "nella", text: "Does that mean everyone else here is dead?" },
    { who: "john", art: "john", text: "I suppose that depends on your philosophy of life. But yes — for all of us, there is no physical body left. There is nowhere to go." },
    { who: "nella", narration: true, text: "I sank to my knees. He waited. After a while he offered me a hand up, and I took it, and I let the man who trapped me here hold me." },
    { who: "john", art: "john", text: "I'm sorry, Nella." },
    { who: "john", art: "john", text: "When you're ready, come see me at the library. I'll be waiting for you." }
  ];

  // ---- 2. WALK-AROUND: rooms, exits, and NPCs to talk to ------------------
  // Coordinates are in a 320x200 virtual room (matches the other games' 2x
  // pixel-scale convention). player start position is per-room.
  //
  // NPC y is kept in the same 150-170 floor band the player actually walks
  // in (see the movement clamp in app.js: y is clamped to [30, 174]). Art
  // for a room's background is generated independently and its visual
  // "floor line" isn't guaranteed to line up with any other y value, so
  // NPCs placed higher up (e.g. near a shelf/wall in the generated art)
  // read as standing on furniture instead of the floor. Keeping everyone
  // in this band keeps them visually grounded regardless of what the
  // background art behind them looks like.
  // What you get on the first fade-in, lying in your own bed. Not an NPC —
  // app.js shows these through the talk box with no speaker and no portrait.
  var WAKE_LINES = [
    "Knock. Knock. Knock.",
    "Someone's at the front door. At this hour, in this rain.",
    "…Chuck. It has to be Chuck."
  ];

  // The black marble door at the end of the hallway. In the plot Nella pushes
  // it once by guess and lands somewhere she didn't mean to; afterwards Kyran
  // tells her to "touch the rune of the chaos symbol", and the carvings resolve
  // into words she can pick from:
  //
  //   "Nella looked through the words: Observatory, Basement, Garden (Closed),
  //    Office... and Library."
  //
  // The three that go somewhere are the three that exist. The other three are
  // listed and locked, which is both what the door shows her and an honest
  // account of what is built.
  // EXIT / DOOR CONVENTION — THE RULES ARE IN docs/DOOR_STANDARD.md. Read it
  // before adding or moving a way out of a room; this comment deliberately
  // does not restate them, because the copy in a workflow prompt drifted
  // months behind the standard once already and nobody could tell which was
  // stale.
  //
  // The short version, so this file is not cryptic: a door is one half of a
  // PAIR. It carries a `link`, and the door you come out of is whichever door
  // (or linked NPC, for the lounge's portal) in the destination room shares
  // that link. Where you land and which way you face are worked out from that
  // partner at runtime, so there is deliberately nothing here to type.
  //
  // `.github/scripts/check_room_exits.mjs` is the gate, and it runs on every
  // push as the "Verify room exits" step in pages.yml.

  var ROOMS = {
    // The real world, before any of it: your own childhood bedroom upstairs
    // in your father's house. The game opens here, out of the black at the
    // end of the intro.
    home_bedroom: {
      bg: "home_bedroom",
      label: "Your Old Room",
      playerStart: { x: 116, y: 112 },
      playerForm: "human",
      // All measured off the regenerated bg-home_bedroom.png at the game's
      // 320x200 scale. The room has no door on any wall now — the way out is
      // the doorway drawn into the BOTTOM edge, toward the viewer, so leaving
      // means walking down and out of frame the way you actually would.
      // Where you're lying when the screen fades up, and where you stand the
      // moment you move. app.js reads both (see player.inBed).
      bedSpot: { x: 84, y: 81 },
      // The top edge of the blanket in the art — she's drawn clipped to above
      // this line while asleep, so the covers cover her.
      bedClipY: 87,
      wakeSpot: { x: 116, y: 112 },
      // Lean into this footprint for a moment and she climbs back in — it's
      // the bed's obstacle box below, which is where the bed meets the floor.
      bedZone: { x: 56, y: 98, w: 58, h: 30 },
      // The drawn floor, kept as the fallback for before the walk mask loads.
      floorPoly: [[58,100],[248,100],[248,186],[58,186]],
      // The doorway is an actual hole in the art (transparent), so the floor
      // stops at its threshold — the trigger sits on that threshold.
      exits: [ { x: 133, y: 153, w: 50, h: 22, to: "house", link: "stairs" } ],
      // Furniture footprints, kept as the fallback alongside floorPoly.
      obstacles: [
        { x: 56, y: 98, w: 58, h: 30 },   // the bed
        { x: 110, y: 96, w: 30, h: 6 },   // nightstand + lamp
        { x: 190, y: 96, w: 60, h: 10 }   // moving boxes
      ],
      npcs: []
    },
    house: {
      bg: "house",
      label: "Your Father's House",
      playerStart: { x: 150, y: 145 },
      // Before the deal/transformation — Nella is still fully human here.
      playerForm: "human",
      // Read off bg-house.png against the 320x200 grid: the room's walls are
      // at x 64 and x 284 and the floor runs from y 100 to y 178. Without
      // this the generic floor rect let you walk out through both walls.
      // The drawn floor, traced as a polygon (see ROOM SHAPES above).
      floorPoly: [[64,100],[292,100],[292,187],[64,187]],
      // The lit archway on the right is the stairs. The story's real exit is
      // still the TV (which plays DREAM_CUTSCENE), but you came down these to
      // answer the door, so they go back up.
      exits: [
        { x: 218, y: 83, w: 27, h: 16, to: "home_bedroom", link: "stairs" }
      ],
      // Furniture where it actually meets the floor: the table with the
      // moving boxes, the lantern table by the front door, and the little
      // round candle table on the right.
      obstacles: [
        { x: 100, y: 78, w: 78, h: 34 },
        { x: 64, y: 98, w: 34, h: 10 },
        { x: 252, y: 96, w: 28, h: 12 }
      ],
      npcs: [
        {
          // The closed wooden door on the back-left wall of bg-house.png.
          // It's the front door, and it's the whole reason you came down.
          // Disappears once Chuck is inside — `unless` hides an NPC after a
          // flag is set, `needs` shows one only after it is.
          id: "frontDoor", x: 74, y: 106, art: null, sprite: null, marker: "OPEN",
          unless: "chuckIn",
          setsFlag: "chuckIn",
          thenTalk: "chuck",
          lines: [
            "The knocking again, louder. Rain hammering the porch behind it.",
            "You turn the latch and pull the door open. \"Chuck! Hurry up and get out of the rain!\""
          ]
        },
        {
          // y126 (the original spot) reads fine in a still image but isn't
          // actually on the room's real floor mask — it's under the
          // moving-boxes table's footprint, which extends lower than the
          // coarse `obstacles` rect above suggests. Never mattered while he
          // just materialized here; became a real bug once he had to walk
          // to it (he'd approach, get flagged off-floor a few px short, and
          // wander off toward a random nearby point instead of arriving).
          id: "chuck", x: 108, y: 134, art: "chuck", sprite: "chuck_top",
          // Where he starts the instant the door opens — the door's own
          // spot, x/y above — so app.js can walk him from there to his real
          // resting spot instead of having him simply appear already
          // standing in the room.
          entryFrom: { x: 74, y: 106 },
          needs: "chuckIn",
          lines: [
            "Nella!",
            "I'm so sorry, Nella.",
            "Clearing your dad's basement, I found something — your old Puzzle Attack cartridge. There's a note taped to the back.",
            "It's addressed to you. \"My Nella — maybe you'll play again someday. Love, Dad.\"",
            "There's a hidden button under the note. I think he wanted you to press it.",
            "The old console still works. Whenever you're ready… go take a look."
          ]
        },
        {
          id: "tv", x: 230, y: 160, art: null, sprite: "tv_top", _noWander: true,
          lines: [
            "The old CRT. Dusty cables, a game console still plugged in.",
            "Twenty years gone, and your hands remember everything."
          ],
          cutscene: "DREAM_CUTSCENE"
        }
      ]
    },
    bedroom: {
      bg: "bedroom",
      label: "Your Room, Infinity",
      // REGENERATED TO THE THREE-PASS STANDARD (docs/ROOM_ART_STANDARD.md), as
      // the room the plot actually describes: "your Victorian bedroom (giant
      // mirror = menu/screen)". The old art was a rustic timber room that read
      // as the house back home rather than anywhere in Infinity, and it painted
      // a door on its right-hand wall that the map no longer uses.
      //
      // The way out is the east wall's sidebreach (see exits, below) —
      // straight into the Lounge's west door. The near-edge balustrade is
      // NOT a way out any more: it used to have a gap for exactly that, and
      // it read as a second exit that silently refused to open, so it's
      // closed (see the rail props) now that the map moved the door east.
      //
      // bg-bedroom.png is the parquet and nothing else, so the walk mask is
      // its own silhouette: no floorPoly, no obstacles.
      playerStart: { x: 150, y: 150 },
      // Measured off art-src/bedroom_scene.png: she lies with her head on the
      // pillow up under the canopy, drawn clipped to above the quilt's edge.
      // bedSpot sits on the pillows — a fraction of the CUT IMAGE's own
      // height (0.4848 down from its top for the pillow, 0.5859 down for
      // the quilt's clip line), not the scene, since that's what's
      // actually drawn on screen. Recomputed again when prop_bed_bed's h
      // grew from 99 to 116 (see the props block below — the top stayed
      // put, only the bottom moved), since both of these are measured
      // from that same top.
      bedSpot: { x: 161, y: 70 },
      bedClipY: 82,
      // On the rug at the bed's foot, clear of the bed's and the trunk's own
      // footprints.
      wakeSpot: { x: 161, y: 168 },
      // The floor in front of the bed's foot and the trunk, where you stand
      // and press UP to climb in.
      bedZone: { x: 126, y: 120, w: 70, h: 26 },
      props: [
        // Ground cover first: flat, walked straight over, no footprint. The
        // scene has always had this rug; the first assembly of this room did
        // not, which is exactly the kind of thing only the side-by-side finds
        // — and even the side-by-side missed how badly undersized this was: w
        // was 120, less than the ~225 the rug actually measures at its widest
        // (its perspective trapezoid in the scene runs from about x40 to x270
        // at the near edge). Only the BLEND overlay — the assembled room
        // composited semi-transparent on top of the scene, not laid beside it
        // — shows this: a mismatch in POSITION doubles an edge, but a
        // mismatch in SIZE just makes the whole shape read as two nested
        // outlines, which two pictures side by side at their own separate
        // scales cannot show at all. w is forced rather than derived from the
        // art's own aspect: the sheet drew the rug portrait, and a rug lying
        // across a floor is wider than it is deep.
        { art: "prop_bed_rug", x: 157, y: 134, h: 58, w: 195, flat: true },
        // The back wall, tiled at its OWN aspect ratio rather than stretched
        // to cover fewer, wider panels — a single image asked to cover a span
        // it wasn't drawn for reads as smeared brick and warped wallpaper,
        // reported straight from a screenshot. EIGHT copies, not five: this
        // art has been re-cut twice since the count was last checked against
        // it (each cut is a fresh sheet, so its exact pixel aspect isn't
        // guaranteed to hold), and its native aspect had quietly drifted to
        // where five copies left a ~30px gap of bare floor showing through
        // the wall on the right — invisible to every other check, since
        // sizecheck only diffs one prop's own numbers and the side-by-side
        // frames the room's furniture, not its bare edges. Caught by eye (a
        // player asked "what happened with the wall"), then made permanent:
        // room.py verify now unions every behind/door prop sharing a wall
        // band's y and fails if the band stops reaching both frame edges —
        // see backdrop_coverage_problems in room.py. Recompute the copy count
        // the same way if this art is re-cut again: native w at h=112,
        // spaced at (w - 4) so neighbours overlap ~4px, enough copies for the
        // last one's right edge to clear 320.
        { art: "prop_bed_wall", x: -6,  y: 109, h: 112, behind: true, base: { w: 44, h: 8 } },
        { art: "prop_bed_wall", x: 38,  y: 109, h: 112, behind: true, base: { w: 44, h: 8 } },
        { art: "prop_bed_wall", x: 82,  y: 109, h: 112, behind: true, base: { w: 44, h: 8 } },
        { art: "prop_bed_wall", x: 126, y: 109, h: 112, behind: true, base: { w: 44, h: 8 } },
        { art: "prop_bed_wall", x: 170, y: 109, h: 112, behind: true, base: { w: 44, h: 8 } },
        { art: "prop_bed_wall", x: 214, y: 109, h: 112, behind: true, base: { w: 44, h: 8 } },
        { art: "prop_bed_wall", x: 258, y: 109, h: 112, behind: true, base: { w: 44, h: 8 } },
        { art: "prop_bed_wall", x: 302, y: 109, h: 112, behind: true, base: { w: 44, h: 8 } },
        // the balustrade along the near edge, unbroken. Re-cut alongside the
        // proportion-locked furniture regen, and its own native aspect
        // dropped from 12.1:1 to 7.6:1 (a taller, less impossibly-thin strip)
        // — h bumped from 30 to 44 to keep ONE copy spanning the room's full
        // width at the new aspect (30 would now draw only ~228px, leaving
        // bare floor at both edges).
        { art: "prop_bed_rail", x: 160, y: 199, h: 44, base: { w: 308, h: 10 } },
        // The furniture, proportion-locked and regenerated a second time:
        // the bed and mirror had first been drawn at a tilted 3/4
        // product-shot angle (fixed via the room's "camera" field), and once
        // that was fixed they still drew narrower relative to their height
        // than the scene's own versions — a live screenshot is what showed
        // it, not the side-by-side or the blend, since "the right shape at
        // the wrong size" doesn't ghost the way a wrong position does. Two
        // regeneration rounds still didn't fully close the gap (mirror art
        // aspect only reached 0.46 of the scene's measured 0.58, bed 0.53 of
        // 0.80), so x/y/h/w for all three pieces here are the scene's own
        // measured proportions, not the art's — a deliberate, commented
        // exception to "let width follow the art", forcing w to match what
        // the scene actually shows instead of spending a third generation
        // round chasing it. Measured with `room.py measure` (see
        // measure_blob.py): grabcut for the mirror and bed, which contrast
        // clean from their background by colour; canny edge/contour
        // detection for the trunk, which grabcut could not segment — its
        // warm brown/gold is too close to the similarly warm rug beneath it
        // for a colour-region model, but the trunk's straight sides and
        // metal bands give canny's edge detector plenty to find. See
        // CLAUDE.md's "before hand-rolling an algorithm" note for why these
        // two, not a hand-rolled flood fill.
        // Both grounded to y=110, the wall's own floor line — and that
        // number itself was wrong once already: first read by eye off a
        // brightened crop as ~102, which was still visibly high on a
        // render (reported directly — "the bed's too high, everything's a
        // little too high"). Re-measured properly instead of re-guessing:
        // per-row gradient across three clean vertical strips of the scene
        // (no furniture in the way) all agree the wainscot-to-parquet edge
        // is at y=109-110, not 102 — confirmed by drawing both lines over
        // the scene and looking, the same "look before trusting it" rule
        // as everything else measured this way. The wall panels above and
        // both of these move together off the corrected line; h taken up
        // on each to keep its top where it was, w recomputed to match
        // (mirror keeps its locked 1:2 ratio off the new h; the nightstand
        // has none declared, so it still follows the art's own aspect).
        { art: "prop_bed_mirror", x: 53,  y: 109, h: 99, w: 50, base: { w: 40, h: 8 } },
        { art: "prop_bed_nightstand", x: 96, y: 109, h: 61, base: { w: 20, h: 8 } },
        // prop_bed_bed's own art ends at the mattress/quilt edge — no
        // footboard drawn, confirmed by opening the file: flat transparent
        // background right where the scene's own footboard is. Measuring
        // it (GrabCut) only ever finds that shorter shape, which read as
        // "the bed's too high AND not big enough" and, at the old y=113,
        // left a gap of bare rug between the bed's cut-off bottom edge and
        // the trunk instead of the two touching the way the scene shows.
        // Not a paid regen right now — moved down and sized up instead so
        // the trunk (drawn after it, y=153 > 130, so on top) sits across
        // the missing-footboard edge and covers it, the same kind of
        // deliberate placement departure as the Lounge's tables. Top stays
        // at 14 (the canopy finials, unaffected by any of this); h/w grow
        // to match, aspect held at the art's own 79:99.
        { art: "prop_bed_bed",   x: 162, y: 130, h: 116, w: 93, base: { w: 85, h: 16 } },
        { art: "prop_bed_trunk", x: 163, y: 153, h: 32, w: 53, base: { w: 48, h: 9 } },
      ],
      // THE LOUNGE IS EAST OF THIS ROOM, so the way out is a door in the EAST
      // wall: you walk right out of here and come in the Lounge's west door.
      //
      // Not drawn as generated art. Three side-doorway attempts across this
      // room and the Lounge each failed a different way (wrong material,
      // wrong proportion, right but drifting from the room's own wall art
      // room to room), and the owner asked to stop fighting the generator on
      // exactly this shape of art and use a plain breach in the wall instead
      // — drawSideBreach in app.js, a code-drawn notch, not a picture.
      exits: [
        // y 148-184: below the four-poster's footprint (which ends at 143) and
        // above the balustrade's (which starts at 194). Both would otherwise
        // sit on this trigger, and a footprint on a doorway is a door you can
        // see and cannot reach. Shorter than that span allows: the regenerated
        // floor's own bottom edge dips a few px right under this door (measured
        // off walk-bedroom.png — a fully open row at y<=186, pinched to two
        // slivers at y 188-190), so the box is centred at y=166 (feet at 184),
        // clear of the dip, instead of at the old centre of 169 (feet at 187,
        // inside it) — which read as a door you could walk toward and never
        // reach.
        { x: 276, y: 148, w: 40, h: 36, to: "lounge", link: "westDoor", drawn: "sidebreach" }
      ],
      npcs: [
        {
          // The plot has no one standing in this room: you walk up to the
          // mirror, see yourself with horns, and the devil pops up IN the
          // mirror like a TV, welcomes you, then it's over — not a
          // character who lives here. `marker: true` makes this purely an
          // interact point at the mirror's own spot (it gets the floor's pool
          // of light, nothing standing up); talking still shows him as the
          // speaker (CHARACTERS.devil) exactly like it did as a standing NPC.
          // The bed beside it is no longer an interactable at all — you get
          // INTO it (app.js, player.bedSlide), and that's what saves.
          id: "devil", x: 50, y: 112, art: "devil", sprite: null, marker: true,
          lines: [
            "Hello, and welcome to Infinity! You may notice your appearance has changed — that's your magical avatar.",
            "Your bracelet is copper, to reflect your rank, and aquamarine for your playstyle. These can change.",
            "Practice here, or head to the lounge for a meal and a battle, or the library to study. Don't be afraid to challenge anyone — it's the only way to grow stronger!",
            "Here — a practice bout, on the house. Match three, clear the board, and send what you clear at me."
          ],
          // The gentle one: this is the tutorial duel, so the board is slow and
          // the host plays badly on purpose.
          duel: {
            level: 2, difficulty: "gentle", theme: "pink", playerLevel: 1,
            winLine: "The host claps, delighted. \"Oh, that's promising. Truly.\"",
            loseLine: "The host tuts. \"You'll get there. Everyone does — eventually.\"",
            afterWin: [
              "Wonderful! You have the hands for it. Most arrivals don't.",
              "Go on then — the lounge is through that door. Try someone who'll actually fight back."
            ],
            afterLoss: [
              "No shame in it. The panels don't care how you feel about them.",
              "Try me again whenever you like. I have nothing but time — you don't."
            ]
          }
        }
      ]
    },
    lounge: {
      bg: "lounge",
      label: "The Lounge",
      // THE HUB OF THE MAP. Infinity is laid out as a grid and every ordinary
      // door is a physical pair on it — you go out one side and come in the
      // matching side of the room next door:
      //
      //                 [ garden ]
      //                      |
      //                 [ library ]
      //                      |
      //     [ bedroom ] — [ LOUNGE ] — [ lab ]
      //
      // so this room has a door in its WEST wall (your room), one in its EAST
      // wall (Kyran's lab) and an arch in its NORTH wall (the library). The
      // red portal in the north wall is the ONE thing allowed to be special:
      // it goes to the arena, which is nowhere on the grid.
      //
      // It replaced a black rune door that popped up a LIST of six
      // destinations. A picker is not a map — one doorway cannot be three
      // rooms — so nothing in Infinity could be laid out in a way that made
      // sense, and on a phone the panel was taller than the screen.
      //
      // Built to docs/ROOM_ART_STANDARD.md: bg-lounge.png is the plank floor
      // and nothing else, so the walk mask is its own silhouette and there is
      // no floorPoly and no obstacles.
      playerStart: { x: 152, y: 150 },
      props: [
        // MEASURED off art-src/lounge_scene.png at 320x200, not placed by eye:
        // the arch's lit opening is x 100-115 and the portal's x 154-174, so
        // the wall is seven panels of the same brick at a 57px pitch with the
        // arch on 107 and the portal on 164. The wall meets the floor at y 72.
        { art: "prop_lg_wall",   x: -7,  y: 72, h: 76, w: 60, behind: true, base: { w: 60, h: 8 } },
        { art: "prop_lg_wall",   x: 50,  y: 72, h: 76, w: 60, behind: true, base: { w: 60, h: 8 } },
        { art: "prop_lg_arch",   x: 107, y: 72, h: 76, w: 60, door: true, behind: true },
        { art: "prop_lg_portal", x: 164, y: 72, h: 76, w: 60, door: true, behind: true },
        { art: "prop_lg_wall",   x: 221, y: 72, h: 76, w: 60, behind: true, base: { w: 60, h: 8 } },
        { art: "prop_lg_wall",   x: 278, y: 72, h: 76, w: 60, behind: true, base: { w: 60, h: 8 } },
        { art: "prop_lg_wall",   x: 335, y: 72, h: 76, w: 60, behind: true, base: { w: 60, h: 8 } },
        // the way west and the way east, in the side walls at the frame edges
        // The ARCH is the prop, not a wall with an arch in it. The first two
        // attempts drew a tall strip that was seven eighths plain brick, so at
        // any width that left room to walk, the opening was a few pixels wide
        // and simply disappeared. Asked for as "the arch fills the image, the
        // brick is a sliver of framing", it came back usable at once.
        // West and east doorways are breaches, not generated art — see the
        // note by ROOMS.bedroom's exit for why.
        // the bar along the right end of the back wall, where the plot puts it
        { art: "prop_backbar", x: 238, y: 62, h: 44, w: 88, base: { w: 88, h: 6 } },
        // Stops short of the EAST doorway's approach: run out to the frame
        // edge and its footprint sits on the door, which is a door you can
        // see and never reach.
        { art: "prop_bar",     x: 236, y: 88, h: 32, w: 92, base: { w: 92, h: 12 } },
        // The scene has these tables hard against the left wall. They are
        // nudged right because there they fenced off the WEST DOORWAY — the
        // walk test could reach x 31 and no further.
        { art: "prop_table", x: 74, y: 106, h: 30, base: { rx: 12, ry: 5 } },
        { art: "prop_stool", x: 96, y: 110, h: 20, base: { rx: 6,  ry: 3 } },
        { art: "prop_table", x: 70, y: 160, h: 30, base: { rx: 12, ry: 5 } },
        { art: "prop_stool", x: 92, y: 164, h: 20, base: { rx: 6,  ry: 3 } }
      ],
      // Each trigger sits ON its own drawn doorway and is as tall as the
      // player, so crossing means standing in the opening rather than on a
      // rectangle of floor near it.
      exits: [
        { x: 4,   y: 118, w: 38, h: 58, to: "bedroom", link: "westDoor", drawn: "sidebreach" },
        { x: 90,  y: 55,  w: 33, h: 16, to: "library", link: "northArch" },
        { x: 147, y: 55,  w: 33, h: 16, to: "arena",   link: "portal" },
        { x: 278, y: 118, w: 38, h: 58, to: "lab",     link: "eastDoor", drawn: "sidebreach" }
      ],
      npcs: [
        {
          // Flavor only here — per the plot, the Lounge is "the bar + portals
          // to duels", not the duel itself. Kat's actual fight happens in
          // ROOMS.arena, through the portal on the back wall.
          id: "kat", x: 214, y: 132, art: "kat", sprite: "kat_top",
          lines: [
            "Hello there. They call me Kat. What's your name?",
            "I'll buy you a drink — if you duel me. No better way to learn!",
            "Step through the portal when you're ready — I'll be waiting on the other side."
          ],
          setsFlag: "duelInvite"
        },
        {
          id: "may", x: 76, y: 128, art: "may", sprite: "may_top",
          lines: [
            "You again? Stay out of my way.",
            "Something doesn't add up about the new arrivals lately. Watch yourself.",
            "…Fine. If you want to know what a champion plays like, meet me through the portal."
          ],
          setsFlag: "duelInvite"
        },
        {
          id: "timothy", x: 244, y: 152, art: "timothy", sprite: "timothy_top",
          lines: [
            "Now, now, May. That's not how we WELCOME the new people. This is Rex. Be nice.",
            "My bracelet's all diamond. Yours will get there too, given time."
          ]
        },
        {
          // "You are NO COPPER RANKED PLAYER. So, WHO ARE YOU?" — May has him
          // by the collar when Nella walks in, and he says nothing at all,
          // which is the entire point of him.
          id: "rex", x: 62, y: 152, art: "rex", sprite: "rex_top",
          lines: [
            "The scruffy man in the deep-gold robe watches you look at his bracelet.",
            "Copper, set with amethysts. May said that meant something.",
            "He smirks, and says nothing."
          ]
        },
        // Kat's table — "Anyway, that's the gang! Michael, Diamond, Eric, and
        // Magma." Michael keeps his coffee shop in the library; the other
        // three are here, all on the bar side of the corridor.
        {
          id: "diamond", x: 224, y: 180, art: "diamond", sprite: "diamond_top",
          lines: [
            "I'm Diamond. I'm the only person you really need to meet around here.",
            "Don't listen to Eric. He thinks the sun rises on Anarchy.",
            "Copper and aquamarine, is it? Sweet. Everyone starts somewhere."
          ]
        },
        {
          id: "eric", x: 180, y: 158, art: "eric", sprite: "eric_top",
          lines: [
            "She only wishes she was the star around here. I'm afraid that honour goes to Anarchy.",
            "I'm Eric. Ignore the two of us, we do this constantly.",
            "…Had. Anarchy HAD. Nobody's seen him since he got out, if he got out."
          ]
        },
        {
          id: "magma", x: 196, y: 186, art: "magma", sprite: "magma_top",
          lines: [
            "…I'm Magma.",
            // The plot's actual beat: it happens DURING the handshake, before
            // she has said anything else, and Nella's jaw drops. Narrating it
            // as its own line is the only way to land it in a talk box.
            "You reach out to shake her hand, and her face moves under yours — features ageing a few years, hair growing long. She watches you watch it happen.",
            "You're staring. Everyone stares the first time.",
            "I'm not trying to scare you. I just refuse to hide who I am any more.",
            "…Sorry. That was for Kat, not for you."
          ]
        }
      ]
    },
    arena: {
      bg: "arena",
      label: "The Arena",
      // The plot's own words (Clubhouse PR #30): "a room about as large as a
      // high school gymnasium, but that looked like a library. In the middle
      // of the ceiling was a gigantic swirling golden orb." Kat and Nella
      // "jumped through the portal together" to get here — the plot never
      // draws a door in this room, only the portal that brought them in.
      //
      // bg-arena.png is the ORIGINAL generated room (bookshelves, stands,
      // the orb+ribbons, the two duelling platforms) edited directly rather
      // than regenerated: the doorway that used to sit on the right wall is
      // cloned over with the bookshelf either side of it, and the SAME red
      // swirl used for ROOMS.lounge's portal (prop_lg_portal.png, cropped to
      // just the vortex — no stone arch, since this isn't a doorway) is
      // composited onto the floor at the front, matching the plot's own
      // portal rather than inventing a new one. Regenerating from scratch
      // was tried first and came back a different room in a different
      // style; editing the art everyone already liked was the right call.
      playerStart: { x: 111, y: 124 },
      // The drawn floor, traced as a polygon (see ROOM SHAPES above) — the
      // flagstone hexagon between the two banks of stands, PLUS a notch cut
      // into its own bottom edge: the art's front bench is actually two
      // short segments with a gap between them where the floor keeps going
      // almost to the very edge of the frame. The original flat-186 bottom
      // edge didn't include that gap at all, which is exactly where the
      // portal (and its trigger) needed to sit — "the very bottom of the
      // walkable area" is that notch, not the hexagon's average edge.
      floorPoly: [[66,100],[250,100],[292,140],[283,186],[171,186],[171,198],[87,198],[87,186],[42,186],[30,140]],
      exits: [
        // The portal, in the notch above, deliberately hung half off the
        // bottom edge of the frame (drawn at pixel 171,303,130,52 of the
        // art's native 512x341 — only the top ~38px are visible, the rest
        // clipped by the canvas) so it reads as an exit, not scenery on the
        // open floor. Trigger sits on its visible upper arc, within reach.
        { x: 100, y: 168, w: 76, h: 28, to: "lounge", link: "portal" }
      ],
      obstacles: [ { x: 0, y: 88, w: 66, h: 20 }, { x: 250, y: 88, w: 70, h: 20 } ], // the stands
      npcs: [
        {
          id: "kat", x: 200, y: 132, art: "kat", sprite: "kat_top",   // the far duelling platform
          counterKey: "kat_arena", // separate dialogue progress from lounge-Kat
          needs: "duelInvite",     // the arena is empty until someone agrees to meet you
          lines: [
            "There you are. Ready?",
            "Chains, dear. Clear one thing so another thing falls into place. That's the whole game.",
            "First to five. Don't sulk when it's over — nobody wins their first set."
          ],
          // The plot's first real duel: chains matter, garbage arrives as slabs,
          // and it is a SET, not one board — "First to five wins," Nella
          // says, and then loses it 5-1.
          duel: {
            level: 3, difficulty: "steady", theme: "pink", playerLevel: 2, firstTo: 5,
            winLine: "Kat tips her hat as the last slab lands on her side. \"Well! Aren't you a find.\"",
            loseLine: "Kat's chain buries you a slab at a time. \"Ah — too slow, dear.\"",
            afterWin: [
              "That drink is yours, and you've earned it.",
              "Careful who you challenge next, though. Not everyone here duels for fun."
            ],
            afterLoss: [
              "Don't sulk. Watch what I did: I never cleared just one thing at a time.",
              "Again, whenever you like."
            ]
          }
        },
        {
          id: "may", x: 232, y: 168, art: "may", sprite: "may_top",
          counterKey: "may_arena",
          needs: "duelInvite",
          lines: [
            "…Fine. If you want to know what a champion plays like, put your hands on the panels."
          ],
          // The champion. Her board runs cursed red and she does not miss much.
          duel: {
            level: 5, difficulty: "sharp", theme: "red", playerLevel: 3,
            winLine: "May 2000 stares at her dead board a long time. \"…Who taught you that?\"",
            loseLine: "The board goes red and stays red. May doesn't even watch it land.",
            afterWin: [
              "Nobody beats me. Nobody has, since the mall.",
              "…Come back. I want to see that again, and I want to see it slower."
            ],
            afterLoss: [
              "That's what it looks like. That's what it always looked like.",
              "Go practice. I'll still be here."
            ]
          }
        }
      ]
    },
    // "The room was not the library, but instead, it appeared to be outdoors in
    // a green garden covered with pools, water falls, and statues... Above her
    // head, there was a sign covered in winding rose bushes that said,
    // 'Anarchy Garden.'"
    // THE REFERENCE ROOM for the three-pass art standard
    // (docs/ROOM_ART_STANDARD.md). bg-garden.png is grass and path and NOTHING
    // else, so the walk mask is its own silhouette and there is nothing to
    // declare — no floorPoly, no floorTop, no obstacles. Everything you can see
    // that is not grass is a prop below, which is also why the pool and the
    // waterfalls can eventually be animated.
    //
    // Positions and sizes are measured off the composed scene kept in
    // art-src/, not chosen by eye: fountains ~56px tall, trees ~78px and hard
    // against the edges so their canopies crop. No depthScale — that scene
    // drew the far fountains the same size as the near ones.
    garden: {
      bg: "garden",
      label: "The Anarchy Garden",
      // Clear of the exit trigger below. Standing ON a doorway when the room
      // loads means it never arms — doors stay disarmed until you step off
      // them — so you can walk into it all day and nothing happens. Found by
      // the walk test, which is exactly what it is for.
      playerStart: { x: 152, y: 146 },
      // Placed on the numbers MEASURED off the composed scene in art-src/,
      // then checked with:
      //   python3 .github/art/preview_room.py games/the-game garden \
      //           --scene games/the-game/art-src/garden_scene.png --mode blend
      // which lays the assembled room over that scene like tracing paper. A
      // prop at the wrong size or in the wrong place shows up instantly as a
      // doubled edge; read off a grid by eye it does not, which is how the
      // statues first shipped at two thirds of their size.
      // Placed on the numbers MEASURED off the composed scene in art-src/,
      // then checked with:
      //   python3 .github/art/preview_room.py games/the-game garden \
      //           --scene games/the-game/art-src/garden_scene.png --mode side
      // which puts the assembled room next to the scene it came from. Every
      // problem this room had was invisible in the numbers and obvious there:
      // a plate that didn't fill the frame, statues at two thirds size, three
      // flower patches where the scene had drifts of them.
      props: [
        // the far bank — waterfalls first so the pool sorts in front of them
        { art: "prop_waterfall", x: 116, y: 68, h: 86, w: 58, base: { w: 58, h: 86 } },
        { art: "prop_waterfall", x: 204, y: 68, h: 86, w: 58, base: { w: 58, h: 86 } },
        { art: "prop_pool",      x: 160, y: 64, h: 44, w: 250, base: { w: 240, h: 16 } },
        // the low wall along the near edge, either side of the path's gap
        { art: "prop_wall", x: 74,  y: 196, h: 26, w: 132, base: { w: 132, h: 12 } },
        { art: "prop_wall", x: 250, y: 196, h: 26, w: 132, base: { w: 132, h: 12 } },
        // Ground cover, walked straight over. The composed scene has DRIFTS of
        // these, not three tidy patches — sparse cover is the other half of
        // why the first assembly read so much emptier than the scene.
        { art: "prop_flowers_white",  x: 66,  y: 150, h: 44, flat: true },
        { art: "prop_flowers_white",  x: 100, y: 166, h: 40, flat: true },
        { art: "prop_flowers_white",  x: 46,  y: 176, h: 40, flat: true },
        { art: "prop_flowers_white",  x: 238, y: 128, h: 40, flat: true },
        { art: "prop_flowers_white",  x: 262, y: 150, h: 36, flat: true },
        { art: "prop_flowers_orange", x: 268, y: 108, h: 44, flat: true },
        { art: "prop_flowers_orange", x: 246, y: 168, h: 44, flat: true },
        { art: "prop_flowers_orange", x: 284, y: 138, h: 40, flat: true },
        { art: "prop_flowers_orange", x: 44,  y: 106, h: 40, flat: true },
        { art: "prop_bramble",        x: 118, y: 126, h: 27, flat: true },
        { art: "prop_bramble",        x: 96,  y: 138, h: 23, flat: true },
        { art: "prop_bramble",        x: 268, y: 182, h: 27, flat: true },
        { art: "prop_bramble",        x: 240, y: 190, h: 23, flat: true },
        { art: "prop_tuft",           x: 196, y: 108, h: 20, flat: true },
        { art: "prop_tuft",           x: 132, y: 176, h: 20, flat: true },
        // The standing scenery, at the composed scene's own sizes. Trees are
        // BIG — ~94px — and hard against the frame edges so their canopies run
        // off the side; that crop is what makes it read as a corner of a real
        // garden. Statues ~56px and ALL THE SAME SIZE: that scene did not
        // shrink the far ones, which is why this room has no depthScale.
        { art: "prop_cherry",   x: 54,  y: 96,  h: 94, base: { rx: 15, ry: 5 } },
        { art: "prop_cherry",   x: 36,  y: 168, h: 94, base: { rx: 15, ry: 5 } },
        { art: "prop_cherry",   x: 286, y: 112, h: 94, base: { rx: 15, ry: 5 } },
        { art: "prop_fountain", x: 84,  y: 128, h: 58, base: { rx: 15, ry: 6 } },
        { art: "prop_fountain", x: 140, y: 106, h: 58, base: { rx: 15, ry: 6 } },
        { art: "prop_fountain", x: 216, y: 106, h: 58, base: { rx: 15, ry: 6 } },
        { art: "prop_fountain", x: 224, y: 172, h: 58, base: { rx: 15, ry: 6 } }
      ],
      exits: [
        // The path leaves through the gap in the near wall, SOUTH, into the
        // Library — which is the room between the Garden and the Lounge.
        { x: 146, y: 178, w: 34, h: 14, to: "library", link: "gardenPath" }
      ],
      npcs: [
        {
          id: "kyran", x: 186, y: 118, art: "kyran", sprite: "kyran_top",
          lines: [
            "Did you ladies eat my CryBerries? …Ah. Just you. You shouldn't have done that.",
            "Here — the effects wear off after fifteen minutes, but this will sort you out instantly.",
            "You really shouldn't eat anything outside the tavern. This garden is full of experimental plants I'm still analysing.",
            "I'm Kyran, head of Infinity's research department. And you must be Nella. Welcome.",
            "This garden is supposed to be off limits, you know. How did you even get here?",
            "…You walked in off the path? You are full of surprises. Head back down through the gap in the wall and you will come out in the library.",
            "Oh — and stop by my lab later. I have something to show you."
          ]
        }
      ]
    },
    lab: {
      bg: "lab",
      label: "Kyran's Lab",
      // THE LOUNGE IS WEST OF THIS ROOM. Out of the door in the west wall
      // here, in through the Lounge's east door — see the map on ROOMS.lounge.
      // Regenerated to docs/ROOM_ART_STANDARD.md: bg-lab.png is the flagstone
      // floor and nothing else, so the walk mask is its own silhouette and
      // there is no floorPoly and no obstacles. The old art painted a door on
      // the RIGHT wall, which the map does not use.
      playerStart: { x: 150, y: 150 },
      props: [
        // The back wall: three panels, bare stone either side of ONE shelf —
        // same convention as the bedroom, run through the same tools this
        // time (room.py grid / measure). Found two real bugs neither the
        // side-by-side nor a first read had caught: `prop_lab_chart` (a
        // pinned parchment) was cut from the same sheet as `prop_lab_plain`
        // — same 620x767 art — but the room's own spec never asks for a
        // chart and the approved scene has no parchment anywhere on this
        // wall, just bare stone; it was leftover art from before this room
        // was rebuilt to the three-pass standard, wired in without checking
        // it against the scene. Replaced with a second `prop_lab_plain`.
        // `prop_lab_shelf` isn't a small furniture overlay — its own art is
        // a FULL wall panel with the shelf and jars painted onto its own
        // baked-in stone (385x353, not transparent), the same idea as
        // `prop_lab_plain` but with a shelf on it. Declaring it at its own
        // small y/h (92/52, forced to an undistorted-looking-but-wrong
        // w:124) sat it at the wrong height AND cropped/squeezed its baked
        // background out of registry with its neighbours' stone — that
        // mismatched rectangle was the second bug. Given the exact same
        // box as the panel it replaces (x/y/h/w identical to prop_lab_plain)
        // instead, its own background lines up with theirs by construction.
        // y=89, not the old 122: room.py wallseam --method canny at this
        // room's door jamb (stone-on-stone floor/wall is too low-contrast
        // for the default gradient method — the same reason grabcut needed
        // canny as a fallback for the trunk) found the jamb's own base at
        // y=89, a strong, visually-confirmed edge. 122 was itself a guess
        // that had never been measured — the bench and cabinet's "grounded
        // 15px short of the wall" NOTEs earlier were checked against that
        // same wrong number, which is exactly why they're gone now: both
        // were already correct against the REAL wall line the whole time.
        { art: "prop_lab_plain", x: 52,  y: 89, h: 75, w: 114, behind: true, base: { w: 114, h: 8 } },
        { art: "prop_lab_shelf", x: 160, y: 89, h: 75, w: 114, behind: true, base: { w: 114, h: 8 } },
        { art: "prop_lab_plain", x: 268, y: 89, h: 75, w: 114, behind: true, base: { w: 114, h: 8 } },
        // the way west, to the Lounge. door: true — it IS the doorway, so it
        // carries no footprint and its trigger sits on it.
        // West doorway is a breach, not generated art — see the note by
        // ROOMS.bedroom's exit for why.
        //
        // bench/cabinet/cart: all three read notably smaller than their own
        // reference scene — same "tiny prop" bug the bedroom's furniture
        // had, never caught here because this room was never actually
        // measured against its scene before. GrabCut couldn't segment any
        // of the three (cluttered glassware over wood reads as one blob of
        // similar warm tones to GrabCut's colour model, the same failure
        // mode as the bedroom's trunk but worse — canny's edge tangle over
        // that much clutter didn't separate the object from the noise
        // either), so these are `room.py grid` manual readings, cross-
        // checked at 4x zoom against three separate crops.
        { art: "prop_lab_bench",   x: 157, y: 107, h: 67, w: 134, base: { w: 128, h: 10 } },
        // Reverted a departure that turned out to be a mistake, not a fix:
        // this was moved to y=107 (from its scene-measured y=92) on the
        // theory it was "floating short of the wall" — but that compared
        // it against the wall's OLD, never-actually-measured y=122. Now
        // that the wall itself is properly measured at y=89 (see above),
        // the cabinet's original scene reading (y=92) is 3px forward of
        // the real wall line — already correct, nothing to ground it to.
        { art: "prop_lab_cabinet", x: 269, y: 92, h: 79, w: 62, base: { w: 56, h: 10 } },
        { art: "prop_lab_cart",    x: 269, y: 168, h: 64, w: 56,  base: { rx: 24, ry: 6 } }
      ],
      exits: [
        // y 124, clear of the wall panels' footprint: the leftmost panel
        // blocks y 112-120 across the room, and a trigger overlapping it is a
        // door you cannot reach.
        { x: 2, y: 136, w: 28, h: 54, to: "lounge", link: "eastDoor", drawn: "sidebreach" }
      ],
      npcs: [
        {
          id: "kyran", x: 150, y: 128, art: "kyran", sprite: "kyran_top",
          counterKey: "kyran_lab",
          lines: [
            "You came. Good. Mind the cloches — half of what's under them is still deciding what it is.",
            "The CryBerries were an accident. So was most of the good work here.",
            "Everything in Infinity is code underneath, Nella. Panels, robes, bracelets, us. I'm trying to read it.",
            "If anyone gets out of here, it will be because they understood the code well enough to lie to it."
          ]
        }
      ]
    },
    library: {
      bg: "library",
      label: "The Library",
      // BETWEEN THE LOUNGE AND THE GARDEN. The Lounge is SOUTH — down off the
      // near edge, in through its north arch — and the Anarchy Garden is
      // NORTH, through the arch in the bookcase wall. See the map on
      // ROOMS.lounge.
      // Regenerated to docs/ROOM_ART_STANDARD.md: bg-library.png is the
      // flagstone floor and nothing else, so the walk mask is its own
      // silhouette and there is no floorPoly and no obstacles.
      playerStart: { x: 150, y: 150 },
      props: [
        // Re-measured off the scene (measure_blob.py grabcut and canny
        // agreed): --rect 180,95,130,65 -> bbox 182,97-307,157. The old
        // 92x46 at (232,152) was a guess, smaller and lower than the rug
        // the scene actually draws.
        { art: "prop_lib_rug", x: 245, y: 128, h: 60, w: 124, flat: true },
        // The bookcase wall, with the arch to the Garden cut through its
        // middle. w overlaps its neighbour: butted exactly, the floor showed
        // between the panels as pale pillars either side of the doorway.
        // y/h were never actually measured — declared at a guessed y=104,
        // h=92. room.py wallseam (gradient, three clean strips, agreed
        // within 3px) puts the real seam at y=63: the shelves fill the top
        // ~third of the frame, cropped by the top edge, not a wall reaching
        // halfway down. See rooms/library.json's wallSeam.
        { art: "prop_lib_shelf", x: 52,  y: 63, h: 63, w: 116, behind: true, base: { w: 110, h: 8 } },
        { art: "prop_lib_door",  x: 160, y: 63, h: 63, w: 116, door: true },
        { art: "prop_lib_shelf", x: 268, y: 63, h: 63, w: 116, behind: true, base: { w: 110, h: 8 } },
        // Michael's reading corner on the left, the writing desk on the right.
        // Every prop below was re-measured straight off library_scene.png with
        // measure_blob.py (grabcut/canny, whichever contrasted) — the old
        // numbers were guesses like the wall was, not read off anything, and
        // are gone now rather than kept as a stale cross-check.
        // Leans forward off the wall, foot well past the seam: top rail
        // ~y=27, foot/casters ~y=81 (--rect 42,3,28,90 --method canny).
        { art: "prop_lib_ladder", x: 56,  y: 81,  h: 54, base: { w: 18, h: 6 } },
        // --rect 0,65,55,80 --method canny -> bbox 12,79-55,140.
        { art: "prop_lib_chair",  x: 33,  y: 140, h: 61, base: { w: 22, h: 8 } },
        // --rect 42,88,26,40 --method canny -> bbox 42,88-68,122.
        { art: "prop_lib_table",  x: 55,  y: 122, h: 34, w: 26, base: { rx: 6, ry: 3 } },
        // Read directly off a pixel grid (desk+chair-back as one piece, art's
        // own composition): legs meet floor ~y=105, chair-back top ~y=68.
        { art: "prop_lib_desk",   x: 255, y: 105, h: 37, w: 55, base: { w: 46, h: 8 } }
      ],
      exits: [
        // south, off the near edge, back to the Lounge's north arch. No art
        // can draw a door at the edge the camera stands on, so app.js draws
        // the frame itself.
        { x: 140, y: 178, w: 40, h: 16, to: "lounge", link: "northArch", drawn: "threshold" },
        // north, through the arch in the bookcase wall, up into the Garden
        { x: 128, y: 46, w: 63, h: 16, to: "garden", link: "gardenPath" }
      ],
      npcs: [
        {
          id: "michael", x: 120, y: 160, art: "michael", sprite: "michael_top",
          lines: [
            "Oh, hello Nella! Nice to see you here. What can I get you?",
            "I'm a detective. I was investigating Puzzle Attack.",
            "No one has made it out of here. No one. Except… Anarchy. He was my best friend."
          ]
        },
        {
          id: "johnStranger", x: 225, y: 158, art: "john", sprite: "john_top",
          unless: "johnToldMe",
          counterKey: "john_before",
          lines: [
            "A hooded man, hunched, tired enough to fall asleep standing up.",
            "He looks at you as though he already knows your name, and says nothing at all."
          ]
        },
        {
          // Before the mirror scene he is a stranger in a hood who knows your
          // name; after it, he is the man who told you what you are. The
          // reveal lives in JOHN_CUTSCENE now, so these are the follow-up.
          id: "john", x: 225, y: 158, art: "john", sprite: "john_top",
          needs: "johnToldMe",
          lines: [
            "You came. Good. Sit, if you like — nobody here is in a hurry but you.",
            "Only one player has ever escaped Infinity. Anarchy. Anthony, before that.",
            "I have several theories about how he did it and no proof of any of them. That is the honest answer, and I am done lying to you.",
            "Keep duelling. Whatever the way out is, it runs through the panels — I built them, and they are the only thing here that is really mine."
          ]
        }
      ]
    }
  };

  return { CHARACTERS: CHARACTERS, INTRO_CUTSCENE: INTRO_CUTSCENE, DREAM_CUTSCENE: DREAM_CUTSCENE,
           JOHN_CUTSCENE: JOHN_CUTSCENE,
           WAKE_LINES: WAKE_LINES, ROOMS: ROOMS };
})();
