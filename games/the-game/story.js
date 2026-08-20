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
  var ROOMS = {
    house: {
      bg: "house",
      label: "Your Father's House",
      playerStart: { x: 150, y: 155 },
      // Before the deal/transformation — Nella is still fully human here.
      playerForm: "human",
      // No walkable exit — you leave by finishing the TV conversation
      // (which plays DREAM_CUTSCENE and lands you in ROOMS.bedroom).
      exits: [],
      // Hand-placed from looking at bg-house.png: the kitchen table (with
      // the moving boxes on it) sits back-center, so it's blocked off —
      // otherwise the player could walk straight through it.
      obstacles: [ { x: 110, y: 78, w: 100, h: 42 } ],
      npcs: [
        {
          id: "chuck", x: 110, y: 160, art: "chuck", sprite: "chuck_top",
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
          id: "tv", x: 230, y: 160, art: null, sprite: "tv_top",
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
      exits: [
        { x: 222, y: 90, w: 26, h: 16, to: "lounge", arriveAt: { x: 150, y: 150 } }
      ],
      // Furniture footprints where they actually meet the floor (the old boxes
      // reached far into the room, and the bed's box covered the doorway, so
      // the door could not be walked into at all).
      obstacles: [
        { x: 22, y: 95, w: 50, h: 12 },   // mirror
        { x: 118, y: 95, w: 97, h: 13 }   // bed + nightstand
      ],
      npcs: [
        {
          // The bed is the game's save point — stand at its foot and
          // interact. `savePoint` makes app.js write the file when the lines
          // finish, and draw a gold marker over it instead of a character
          // token. Positioned just below the bed obstacle (which ends at
          // y=110) so the player can actually stand within reach of it.
          id: "bed", x: 192, y: 118, art: null, sprite: null, savePoint: true,
          lines: [
            "Your bed. Copper sheets, aquamarine pillow — Infinity matched them to your bracelet.",
            "You lie down for a moment and let the day settle."
          ]
        },
        {
          id: "devil", x: 150, y: 155, art: "devil", sprite: "devil_top",
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
      playerStart: { x: 60, y: 150 },
      // Hand-placed from bg-lounge.png: the doorway to the library is on
      // the right wall; the bar counter spans most of the back wall and
      // is blocked off so the player can't walk through/behind it.
      // bg-lounge.png draws ONE door: the arch on the back-right wall (opening
      // x 210-240, floor at y ~82) to the library. The way back to your room is
      // the doorway you came in through, at the bottom edge of the room —
      // the art has none there, so app.js draws that frame itself.
      exits: [
        { x: 210, y: 82, w: 30, h: 20, to: "library", arriveAt: { x: 215, y: 140 } },
        { x: 132, y: 182, w: 56, h: 10, to: "bedroom", drawn: "threshold", arriveAt: { x: 228, y: 132 } }
      ],
      // The bar's footprint on the floor (the old box sat entirely above the
      // walkable area, so it blocked nothing).
      obstacles: [ { x: 26, y: 95, w: 122, h: 33 } ],
      npcs: [
        {
          // Flavor only here — per the plot, the Lounge is "the bar + portals
          // to duels", not the duel itself. Kat's actual fight happens in
          // ROOMS.arena, reached through the portal below.
          id: "kat", x: 150, y: 162, art: "kat", sprite: "kat_top",
          lines: [
            "Hello there. They call me Kat. What's your name?",
            "I'll buy you a drink — if you duel me. No better way to learn!",
            "Head to the portal when you're ready — I'll be waiting on the other side."
          ]
        },
        {
          id: "may", x: 220, y: 158, art: "may", sprite: "may_top",
          lines: [
            "You again? Stay out of my way.",
            "Something doesn't add up about the new arrivals lately. Watch yourself.",
            "…Fine. If you want to know what a champion plays like, meet me through the portal."
          ]
        },
        {
          id: "timothy", x: 258, y: 168, art: "timothy", sprite: "timothy_top",
          lines: [
            "Now, now — that's no way to welcome the new people.",
            "My bracelet's all diamond. Yours will get there too, given time."
          ]
        },
        {
          // The plot: "the Lounge (bar + portals to duels)" — this is that
          // portal. No art generated yet, renders as a fallback token.
          id: "portal", x: 60, y: 100, art: null, sprite: null,
          lines: [
            "A shimmering doorway, humming with the same pink-and-red glow as a panel board.",
            "You step through."
          ],
          gotoRoom: "arena"
        }
      ]
    },
    arena: {
      bg: "arena",
      label: "The Arena",
      playerStart: { x: 150, y: 165 },
      // bg-arena.png: the arch is at x 233-267, floor at y ~82.
      exits: [
        { x: 233, y: 80, w: 34, h: 22, to: "lounge", arriveAt: { x: 150, y: 150 } }
      ],
      obstacles: [ { x: 16, y: 95, w: 86, h: 12 } ], // the stone benches
      npcs: [
        {
          id: "kat", x: 100, y: 155, art: "kat", sprite: "kat_top",
          counterKey: "kat_arena", // separate dialogue progress from lounge-Kat
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
          id: "may", x: 220, y: 158, art: "may", sprite: "may_top",
          counterKey: "may_arena",
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
      exits: [
        { x: 210, y: 78, w: 32, h: 24, to: "lounge", arriveAt: { x: 215, y: 140 } }
      ],
      obstacles: [ { x: 148, y: 95, w: 66, h: 20 } ], // armchair + candle table
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

  return { CHARACTERS: CHARACTERS, INTRO_CUTSCENE: INTRO_CUTSCENE, DREAM_CUTSCENE: DREAM_CUTSCENE, ROOMS: ROOMS };
})();
