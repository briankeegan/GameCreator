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

  // EXIT / DOOR CONVENTION — every `exits[]` entry needs THREE things, not
  // just `to` and `arriveAt`. Getting only two of three shipped live twice
  // and had to be fixed after the fact:
  //   1. `arriveFacing`: "up"/"down"/"left"/"right". Without it the player
  //      keeps whatever direction she was last walking before she touched
  //      the trigger — she reads as materializing in the new room instead
  //      of stepping through a door. Pick the direction that matches
  //      actually walking OUT of that doorway (away from the wall it's in).
  //   2. `arriveAt` must be real, unobstructed floor in the DESTINATION
  //      room — check against that room's `floorPoly`/`obstacles`, not by
  //      eyeballing the number.
  //   3. `arriveAt` must have real clearance from every OTHER exit trigger
  //      in the destination room, in all four directions — not just the
  //      matching return door. Landing close enough to a different exit
  //      that a single accidental keypress crosses back into it reads as
  //      the room "bouncing" you straight back out (reported live: two
  //      door pairs did exactly this, one bedroom<->lounge, one
  //      lounge<->library — an arrival point that happened to sit ~20px
  //      from an unrelated door in that room). A door you have to walk the
  //      full width of the room to deliberately reach is fine; the bug is
  //      only ever "one lucky/unlucky keytap sends you right back."
  //
  // `.github/scripts/check_room_exits.mjs` checks all three automatically —
  // run `node .github/scripts/check_room_exits.mjs games/the-game/story.js`
  // after touching any exit or arriveAt, or trust the "Verify room exits"
  // step in `.github/workflows/pages.yml` (same gate as the engine tests,
  // runs on every push to main). Don't add/move a door by feel and skip
  // it — that's exactly how both bugs above shipped.

  // ROOM SHAPES — every room's walkable area is `floorPoly`, the drawn floor
  // traced as a polygon in the game's 320x200 room coordinates. These rooms
  // are painted in perspective (the lounge and the arena are six-sided, the
  // others are trapezoids narrowing toward the back wall), so a rectangle can
  // never fit one: sized to the front edge it lets you walk off into the
  // black behind the room, sized to the back edge it fences you out of the
  // front half. Traced against a coordinate grid rendered over each
  // background — don't adjust these by feel, re-render the grid.
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
      exits: [ { x: 140, y: 152, w: 44, h: 16, to: "house",
                 arriveAt: { x: 150, y: 130 }, arriveFacing: "down" } ],
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
        { x: 216, y: 90, w: 34, h: 14, to: "home_bedroom", arriveAt: { x: 196, y: 122 }, arriveFacing: "down" }
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
          id: "chuck", x: 108, y: 126, art: "chuck", sprite: "chuck_top",
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
      playerStart: { x: 150, y: 150 },
      // Waking up in Infinity works like waking up at home — measured off
      // bg-bedroom.png at 320x200: the pillow sits around x 145-180 / y 59-70,
      // with the duvet's top edge at y ~70. She lies with her head on the
      // pillow and is drawn clipped to above that edge.
      bedSpot: { x: 155, y: 62 },
      bedClipY: 70,
      // The floorboards at the near-left corner of the bed, clear of both the
      // bed's own footprint and the save-point token standing at its foot.
      wakeSpot: { x: 130, y: 132 },
      bedZone: { x: 120, y: 92, w: 90, h: 26 },
      // Hand-placed from bg-bedroom.png: the door is on the right wall,
      // the mirror stands on the left and the bed is back-center-right —
      // both are blocked off so the player can't walk through them.
      // arriveAt drops you a step INSIDE the next room, in front of the door
      // you came out of — never on its threshold, or holding the same
      // direction would walk you straight back through.
      // Every exit box below was measured against the room's own background
      // art (overlaid on the PNG at the game's 320x200 scale, not guessed):
      // the box IS the drawn doorway, so walking into the picture of the door
      // is what takes you through. Nothing else on screen is an exit.
      // bg-bedroom.png: arched door on the right wall, opening x 222-248,
      // threshold on the floor at y ~103.
      // The drawn floor, traced as a polygon (see ROOM SHAPES above).
      floorPoly: [[52,100],[285,100],[272,186],[64,186]],
      exits: [
        { x: 223, y: 90, w: 28, h: 16, to: "lounge", arriveAt: { x: 90, y: 149 }, arriveFacing: "right" }
      ],
      // Furniture footprints where they actually meet the floor (the old boxes
      // reached far into the room, and the bed's box covered the doorway, so
      // the door could not be walked into at all).
      obstacles: [
        { x: 52, y: 95, w: 36, h: 14 },   // mirror
        { x: 120, y: 92, w: 90, h: 26 },  // bed
        { x: 202, y: 95, w: 22, h: 13 }   // nightstand
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
          id: "devil", x: 70, y: 102, art: "devil", sprite: null, marker: true,
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
      playerStart: { x: 206, y: 128 },
      // bg-lounge.png is MIRRORED (the PNG itself was flipped horizontally,
      // and build_walkmask.py's block for the bar with it), so the room now
      // reads the way the map actually works: your room's door is on ITS
      // right wall, so you come into this one through the arch on ITS LEFT,
      // and the bar runs along the back-right. Every x below is 320-x of the
      // measurements taken off the original art.
      // The two ways out: the drawn arch on the back-left wall (opening
      // x 80-114, floor at y ~86) back to your room, and the doorway at the
      // bottom edge, toward the viewer, down to the library — the art has
      // none there, so app.js draws that frame itself.
      // The drawn floor, traced as a polygon (see ROOM SHAPES above).
      floorPoly: [[245,100],[68,100],[32,140],[58,188],[228,188],[270,140]],
      exits: [
        { x: 80, y: 86, w: 34, h: 18, to: "bedroom", arriveAt: { x: 228, y: 160 }, arriveFacing: "left" },
        { x: 132, y: 182, w: 56, h: 10, to: "library", drawn: "threshold", arriveAt: { x: 220, y: 150 }, arriveFacing: "down" }
      ],
      // The bar's footprint on the floor (the old box sat entirely above the
      // walkable area, so it blocked nothing).
      obstacles: [ { x: 155, y: 95, w: 110, h: 30 } ], // the bar's footprint
      npcs: [
        {
          // Flavor only here — per the plot, the Lounge is "the bar + portals
          // to duels", not the duel itself. Kat's actual fight happens in
          // ROOMS.arena, reached through the portal below.
          id: "kat", x: 170, y: 162, art: "kat", sprite: "kat_top",
          lines: [
            "Hello there. They call me Kat. What's your name?",
            "I'll buy you a drink — if you duel me. No better way to learn!",
            "Step through the portal when you're ready — I'll be waiting on the other side."
          ],
          setsFlag: "duelInvite"
        },
        {
          id: "may", x: 130, y: 168, art: "may", sprite: "may_top",
          lines: [
            "You again? Stay out of my way.",
            "Something doesn't add up about the new arrivals lately. Watch yourself.",
            "…Fine. If you want to know what a champion plays like, meet me through the portal."
          ],
          setsFlag: "duelInvite"
        },
        {
          id: "timothy", x: 206, y: 172, art: "timothy", sprite: "timothy_top",
          lines: [
            "Now, now — that's no way to welcome the new people.",
            "My bracelet's all diamond. Yours will get there too, given time."
          ]
        },
        {
          // PLOT.md: "the Lounge (bar + portals to duels)". The lounge art
          // doesn't draw one, so it reads as a pool of light on the floor —
          // the same flat glow a doorway gets, not a token standing up in the
          // middle of the room. It stands on the LEFT of the room because the
          // plot puts it there: "The bar was off to the right side... On the
          // left, there were groups of people standing around several
          // doorways that appeared to open into a swirling, purple void."
          // Stepping through always works; the arena on the other side is
          // empty until somebody in here agrees to meet you (duelInvite).
          id: "portal", x: 104, y: 150, art: null, sprite: null, marker: "ENTER",
          look: "portal",
          lines: [
            "A doorway standing open onto a swirling purple void. It hums like a board about to rise.",
            "You step through."
          ],
          gotoRoom: "arena"
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
        { x: 224, y: 84, w: 26, h: 18, to: "lounge", arriveAt: { x: 97, y: 146 }, arriveFacing: "right" }
      ],
      obstacles: [ { x: 0, y: 88, w: 66, h: 20 }, { x: 250, y: 88, w: 70, h: 20 } ], // the stands
      npcs: [
        {
          id: "kat", x: 200, y: 132, art: "kat", sprite: "kat_top",   // the far duelling platform
          counterKey: "kat_arena", // separate dialogue progress from lounge-Kat
          needs: "duelInvite",     // the arena is empty until someone agrees to meet you
          lines: [
            "There you are. Ready?",
            "Chains, dear. Clear one thing so another thing falls into place. That's the whole game."
          ],
          // The plot's first real duel: chains matter, garbage arrives as slabs.
          duel: {
            level: 3, difficulty: "steady", theme: "pink", playerLevel: 2,
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
    library: {
      bg: "library",
      label: "The Library",
      playerStart: { x: 150, y: 165 },
      // Hand-placed from bg-library.png: the exit archway back to the
      // lounge is actually on the right side of the room, not the left
      // (the previous x:0 placement didn't match the art at all — the
      // bookshelves occupy the whole left wall and are blocked off).
      // bg-library.png: the arch is at x 210-242, floor at y ~78.
      // The drawn floor, traced as a polygon (see ROOM SHAPES above).
      floorPoly: [[50,100],[274,100],[274,188],[50,188]],
      exits: [
        { x: 228, y: 84, w: 24, h: 18, to: "lounge", arriveAt: { x: 152, y: 125 }, arriveFacing: "right" }
      ],
      obstacles: [ { x: 160, y: 92, w: 66, h: 22 } ], // armchair + candle table
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
          id: "john", x: 225, y: 158, art: "john", sprite: "john_top",
          lines: [
            "I am John Boxley. Creator of Puzzle Attack. I am trapped in Infinity. And now, so are you.",
            "A deal was struck for your soul, in exchange for magical powers. It didn't work the way I thought it would.",
            "You must return to your body within one hour of the ritual, or you will die. A day in Infinity is a minute in the real world.",
            "Only one player has ever escaped Infinity. When you're ready to hear how… come find me here."
          ]
        }
      ]
    }
  };

  return { CHARACTERS: CHARACTERS, INTRO_CUTSCENE: INTRO_CUTSCENE, DREAM_CUTSCENE: DREAM_CUTSCENE,
           WAKE_LINES: WAKE_LINES, ROOMS: ROOMS };
})();
