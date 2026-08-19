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

  // ---- 1. CUTSCENE: the backstory, up through waking in Infinity ----------
  // Kept SHORT on purpose — this is a game, not a book. The plot's full prose
  // is reference/the-game/PLOT.md; it's a blueprint for what to BUILD (scenes,
  // art, rooms), not text to put on screen. Every bg id here gets its own
  // generated scene, so the picture carries the setting — the line under it
  // only needs to carry the beat. Real back-and-forth exchanges are kept as
  // actual dialogue; solo narration is cut to one line per moment.
  var CUTSCENE = [
    { bg: "childhood", who: "nella", art: "nella_child", text: "Age nine. My first video game: \"Puzzle Attack.\" Match three, or get smashed flat. I was obsessed." },
    { bg: "mall", who: "nella", text: "Age ten. A Puzzle Attack tournament at the mall — my hero May 2000 was competing. Then the screaming started." },
    { bg: "news", who: "news", art: null, text: "Six dead. Twenty-three injured. \"Puzzle Attack\" is pulled from shelves, banned nationwide." },
    { bg: "rain", who: "nella", art: "nella", text: "Twenty years later. My father just died. It's just me and this house now." },
    { bg: "porch", who: "chuck", art: "chuck", text: "Nella! Get out of the rain!" },
    { who: "nella", text: "Chuck. My oldest friend." },
    { who: "chuck", text: "I'm so sorry, Nella." },
    { bg: "kitchen", who: "chuck", art: "chuck_box", text: "Clearing your dad's basement — I found something." },
    { bg: "cartridge", who: "nella", art: "nella", text: "My old Puzzle Attack cartridge. A note taped to the back." },
    { who: "dad", art: "note", text: "My Nella — maybe you'll play again someday. Love, Dad." },
    { who: "nella", text: "Peeling the note off revealed a hidden button. I pressed it." },
    { bg: "crt", who: "chuck", art: "chuck", text: "Ready, Nella?" },
    { who: "nella", art: "nella", text: "Twenty years gone, and my hands remembered everything." },
    { who: "chuck", art: "chuck", text: "Nella, I don't think your dad hid a secret in a video game. This sounds insane." },
    { who: "nella", art: "nella_scream", text: "The scream came from somewhere I didn't know I had." },
    { who: "nella", text: "I played through the night." },
    { bg: "crt_red", who: "nella", text: "8 AM. One more try. I beat it — the run of my life." },
    { bg: "latin", who: "nella", text: "\"Omne ignotum pro magnifico.\" Handwritten. Blood-red. Not part of the game." },
    { bg: "chaos", who: "nella", text: "A skull. A chaos symbol. \"A deal is struck. Proceed?\"" },
    { who: "nella", text: "I pressed Start and Select." },
    { bg: "", text: "The world faded to black." }
    // Cutscene ends here. What happens next — waking up, the horns in the
    // mirror, the devil's welcome — is no longer narrated: it's the first
    // playable room (see ROOMS.bedroom below). You wake up, walk to the
    // mirror yourself, and walk out the door yourself.
  ];

  // ---- 2. WALK-AROUND: rooms, exits, and NPCs to talk to ------------------
  // Coordinates are in a 320x200 virtual room (matches the other games' 2x
  // pixel-scale convention). player start position is per-room.
  var ROOMS = {
    bedroom: {
      bg: "bedroom",
      label: "Your Room, Infinity",
      playerStart: { x: 150, y: 150 },
      exits: [ { x: 300, y: 150, w: 20, h: 40, to: "lounge", label: "→ Out the door" } ],
      npcs: [
        {
          id: "devil", x: 150, y: 90, art: "devil",
          lines: [
            "Hello, and welcome to Infinity! You may notice your appearance has changed — that's your magical avatar.",
            "Your bracelet is copper, to reflect your rank, and aquamarine for your playstyle. These can change.",
            "Practice here, or head to the lounge for a meal and a battle, or the library to study. Don't be afraid to challenge anyone — it's the only way to grow stronger!",
            "Whatever you need, you can find here. Now… take your first steps out that door."
          ]
        }
      ]
    },
    lounge: {
      bg: "lounge",
      label: "The Lounge",
      playerStart: { x: 60, y: 150 },
      // Doors move you to another room, drawn as a marked exit tile.
      exits: [ { x: 300, y: 150, w: 20, h: 40, to: "library", label: "→ Library" } ],
      npcs: [
        {
          id: "kat", x: 150, y: 110, art: "kat",
          lines: [
            "Hello there. They call me Kat. What's your name?",
            "I'll buy you a drink — if you duel me. No better way to learn!",
            "Come find me by the portal when you're ready to duel."
          ],
          duel: true
        },
        {
          id: "may", x: 220, y: 90, art: "may",
          lines: [
            "You again? Stay out of my way.",
            "Something doesn't add up about the new arrivals lately. Watch yourself."
          ]
        },
        {
          id: "timothy", x: 250, y: 130, art: "timothy",
          lines: [
            "Now, now — that's no way to welcome the new people.",
            "My bracelet's all diamond. Yours will get there too, given time."
          ]
        }
      ]
    },
    library: {
      bg: "library",
      label: "The Library",
      playerStart: { x: 40, y: 150 },
      exits: [ { x: 0, y: 150, w: 20, h: 40, to: "lounge", label: "← Lounge" } ],
      npcs: [
        {
          id: "michael", x: 120, y: 100, art: "michael",
          lines: [
            "Oh, hello Nella! Nice to see you here. What can I get you?",
            "I'm a detective. I was investigating Puzzle Attack.",
            "No one has made it out of here. No one. Except… Anarchy. He was my best friend."
          ]
        },
        {
          id: "john", x: 260, y: 90, art: "john",
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

  return { CHARACTERS: CHARACTERS, CUTSCENE: CUTSCENE, ROOMS: ROOMS };
})();
