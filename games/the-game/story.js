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
  // EXIT / DOOR CONVENTION — a door is one of a PAIR, not a one-way trip with
  // a destination typed next to it.
  //
  // Every door carries a `link`. The door you come OUT of is whichever door in
  // the destination room shares that link (an NPC can carry one too — the
  // lounge's portal is the far side of the arena's doorway). Where you land
  // and which way you face are worked out from that partner's own rectangle at
  // runtime: step out of it into the room, with your back to it. There is
  // deliberately nothing here to type.
  //
  // It used to be `arriveAt` + `arriveFacing`, two numbers and a direction
  // written on the far side of the file from the door they belonged to. They
  // drifted, because nothing tied the two halves of a door together: the
  // Library, the Anarchy Garden and Kyran's Lab all put you down on the SAME
  // square of lounge floor, nowhere near the rune door you had just walked
  // through, and coming downstairs left you in the middle of your father's
  // living room rather than at the stairs. Every one of those values was
  // individually valid — on the floor, not in a wall — and every check passed.
  //
  // `.github/scripts/check_room_exits.mjs` enforces the pairing (run by hand,
  // or the "Verify room exits" step in pages.yml runs it on any story.js
  // change): every door needs a link, exactly one thing in the destination
  // must carry it, and no room may be one you can leave but never enter.

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
        { x: 217, y: 78, w: 42, h: 20, to: "home_bedroom", link: "stairs" }
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
            "You turn the latch and pull the door open."
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
            "Nella! Get out of the rain!",
            "I'm so sorry, Nella.",
            "Clearing your dad's basement, I found something — your old Puzzle Attack cartridge. There's a note taped to the back.",
            "\"My Nella — maybe you'll play again someday. Love, Dad.\"",
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
      // height (0.41 down from its top for the pillow, 0.68 down for the
      // quilt's clip line), not the scene, since that's what's actually
      // drawn on screen. Recomputed again when prop_bed_bed's h dropped from
      // 99 to 85 (see the props block below — the top of the canopy moved
      // down 14px), since both of these are measured from that same top.
      bedSpot: { x: 161, y: 62 },
      bedClipY: 72,
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
        // to cover fewer, wider panels — five copies at native proportions,
        // each overlapping its neighbour by ~4px to hide the seam, instead of
        // three copies stretched 1.75x wide. A single image asked to cover a
        // span it wasn't drawn for reads as smeared brick and warped wallpaper
        // — reported straight from a screenshot, and confirmed by checking the
        // math: h=112 at this art's native aspect wants w=66, not the w=116
        // this used to carry.
        { art: "prop_bed_wall", x: -6,  y: 102, h: 112, behind: true, base: { w: 60, h: 8 } },
        { art: "prop_bed_wall", x: 60,  y: 102, h: 112, behind: true, base: { w: 60, h: 8 } },
        { art: "prop_bed_wall", x: 126, y: 102, h: 112, behind: true, base: { w: 60, h: 8 } },
        { art: "prop_bed_wall", x: 192, y: 102, h: 112, behind: true, base: { w: 60, h: 8 } },
        { art: "prop_bed_wall", x: 258, y: 102, h: 112, behind: true, base: { w: 60, h: 8 } },
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
        { art: "prop_bed_mirror", x: 53,  y: 93,  h: 83, w: 48, base: { w: 40, h: 8 } },
        { art: "prop_bed_nightstand", x: 96, y: 88, h: 40, base: { w: 20, h: 8 } },
        { art: "prop_bed_bed",   x: 162, y: 113, h: 99, w: 79, base: { w: 72, h: 14 } },
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
        { x: 92,  y: 46,  w: 32, h: 26, to: "library", link: "northArch" },
        { x: 149, y: 46,  w: 32, h: 26, to: "arena",   link: "portal" },
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
      // Regenerated to the plot: "a room about as large as a high school
      // gymnasium, but that looked like a library. In the middle of the
      // ceiling was a gigantic swirling golden orb" — bookshelf walls, tiered
      // stands, the cracked orb with its two ribbons hanging down, and two
      // duelling platforms in the flagstones fifteen paces apart. You arrive
      // standing on the near one.
      playerStart: { x: 111, y: 124 },
      // bg-arena.png: the archway out is on the right at x 226-250, its foot
      // meeting the stands at y ~84.
      // The drawn floor, traced as a polygon (see ROOM SHAPES above) — the
      // flagstone hexagon between the two banks of stands.
      floorPoly: [[66,100],[250,100],[292,140],[283,186],[42,186],[30,140]],
      exits: [
        { x: 230, y: 78, w: 30, h: 20, to: "lounge", link: "portal" }
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
        // h 88, not 120: measured off the scene, where the shelf sits high on
        // the wall and the jars are about 26px tall. At the height they were
        // first placed they read as barrels.
        // The back wall: plain stone, with the pinned chart on the left panel
        // and the jar shelf hung on the middle one — measured off the scene,
        // which has ONE shelf with bare stone either side of it, not three.
        { art: "prop_lab_chart", x: 52,  y: 122, h: 108, w: 114, behind: true, base: { w: 114, h: 8 } },
        { art: "prop_lab_plain", x: 160, y: 122, h: 108, w: 114, behind: true, base: { w: 114, h: 8 } },
        { art: "prop_lab_plain", x: 268, y: 122, h: 108, w: 114, behind: true, base: { w: 114, h: 8 } },
        { art: "prop_lab_shelf", x: 158, y: 92, h: 52, w: 124, behind: true },
        // the way west, to the Lounge. door: true — it IS the doorway, so it
        // carries no footprint and its trigger sits on it.
        // West doorway is a breach, not generated art — see the note by
        // ROOMS.bedroom's exit for why.
        { art: "prop_lab_bench",   x: 166, y: 138, h: 44, w: 122, base: { w: 118, h: 10 } },
        { art: "prop_lab_cabinet", x: 268, y: 134, h: 60, base: { w: 32, h: 10 } },
        { art: "prop_lab_cart",    x: 254, y: 172, h: 46, base: { rx: 11, ry: 4 } }
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
        { art: "prop_lib_rug", x: 232, y: 152, h: 46, w: 92, flat: true },
        // The bookcase wall, with the arch to the Garden cut through its
        // middle. w overlaps its neighbour: butted exactly, the floor showed
        // between the panels as pale pillars either side of the doorway.
        { art: "prop_lib_shelf", x: 52,  y: 104, h: 92, w: 116, behind: true, base: { w: 110, h: 8 } },
        { art: "prop_lib_door",  x: 160, y: 104, h: 92, w: 116, door: true },
        { art: "prop_lib_shelf", x: 268, y: 104, h: 92, w: 116, behind: true, base: { w: 110, h: 8 } },
        // Michael's reading corner on the left, the writing desk on the right
        { art: "prop_lib_ladder", x: 56,  y: 104, h: 76, base: { w: 18, h: 6 } },
        { art: "prop_lib_chair",  x: 30,  y: 122, h: 40, base: { w: 22, h: 8 } },
        { art: "prop_lib_table",  x: 58,  y: 124, h: 26, base: { rx: 6, ry: 3 } },
        { art: "prop_lib_desk",   x: 252, y: 122, h: 34, w: 50, base: { w: 46, h: 8 } }
      ],
      exits: [
        // south, off the near edge, back to the Lounge's north arch. No art
        // can draw a door at the edge the camera stands on, so app.js draws
        // the frame itself.
        { x: 140, y: 178, w: 40, h: 16, to: "lounge", link: "northArch", drawn: "threshold" },
        // north, through the arch in the bookcase wall, up into the Garden
        { x: 142, y: 76, w: 36, h: 26, to: "garden", link: "gardenPath" }
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
