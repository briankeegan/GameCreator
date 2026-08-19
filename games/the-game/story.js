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
  var CUTSCENE = [
    { bg: "code", text: "It was all one great big code. If you could read the code in time, you could survive. If you couldn't… you'd be smashed flat." },
    { bg: "childhood", who: "nella", art: "nella_child", text: "I was nine when I was given a video game for my birthday. Being a gamer in the 90s wasn't cool. Being a gamer GIRL? Multiply that by a million." },
    { who: "nella", text: "It was called \"Puzzle Attack.\" Simple enough: match three or more bricks to clear them before they rise up and smash you flat." },
    { who: "nella", text: "Maybe it's because I'm neurodivergent, but making matches was… soothing. I played for hours. Soon I'd beaten every mode on the hardest difficulty." },

    { bg: "mall", who: "nella", text: "When I was ten, there was a Puzzle Attack competition at the local mall. My hero, May 2000 — a pink-haired girl kicking serious ass — was going to be there. I begged Dad to take me." },
    { who: "nella", text: "Then… people were screaming. Running. The smell of something burning. A stampede. My father's face, white with terror. We barely made it out." },
    { bg: "news", who: "news", art: null, text: "Six dead. Twenty-three injured. Authorities say the flashing light patterns in \"Puzzle Attack\" triggered aggression — players became enraged and attacked one another." },
    { who: "nella", text: "The game was pulled from shelves. Copies turned in to be destroyed. The developer, Boxley Company, went under. Dad destroyed my copy." },
    { who: "nella", text: "And that was the last I heard of Puzzle Attack. For twenty years." },

    { bg: "rain", who: "nella", art: "nella", text: "The rain was so heavy I could barely see the last car leave. It was my driveway now. Dad got sick while I was finishing grad school. Last week… he died." },
    { who: "nella", text: "He left me the house and a life insurance policy. I didn't NEED to go back to my degree. But then — what would be the purpose of anything?" },
    { bg: "porch", who: "chuck", art: "chuck", text: "Nella! Hurry up and get out of the rain!" },
    { who: "nella", text: "Chuck. My oldest friend, soaked through, a burger bag from my favorite joint tucked under his red flannel. He'd taken off work at the lumberyard just to check on me." },
    { who: "chuck", text: "I'm so sorry for your loss, Nella." },

    { bg: "kitchen", who: "chuck", text: "I wasn't sure it was the right time, but… when we were clearing your dad's basement, I found something." },
    { who: "chuck", art: "chuck_box", text: "It said \"Cups and Plates\" on the outside. I almost skipped it." },
    { bg: "cartridge", who: "nella", art: "nella", text: "Inside was a game cartridge. I knew it instantly. My old \"Puzzle Attack.\" A note was taped to the back." },
    { who: "dad", art: "note", text: "My Nella — I know how much you loved this game, and you played it for hours without issue. I didn't have the heart to throw it away. Maybe you'll play again someday. Love, Dad." },
    { who: "nella", art: "nella", text: "A tear fell on the note. I peeled the tape back to save it — and it lifted part of the label, revealing… a tiny black button hidden underneath the cartridge." },
    { who: "nella", text: "I pressed it. Click. Nothing obvious changed. But maybe… maybe Dad left me a message inside the game itself. I was grasping at straws. I clung to the idea anyway." },

    { bg: "crt", who: "chuck", art: "chuck", text: "\"Match the red, white, and yellow ends!\" — I know already, sheesh! …There. Channel 3. Ready, Nella?" },
    { who: "nella", art: "nella", text: "The menu bloomed to life, that nostalgic 8-bit theme humming through the speakers. I picked campaign, Hard. The screen turned pink." },
    { who: "nella", text: "Twenty years gone, and my hands remembered everything. Chains, defenses, huge attacks. I tore through Hard mode." },
    { who: "nella", text: "After the credits: press the bumpers on Hard to unlock the HARDEST difficulty. The screen went red. The enemies got meaner. But nothing else changed. No message." },
    { who: "chuck", art: "chuck", text: "Nella… I don't think your dad left a secret in a video game. I know it's tough. He's the only family you had. But this sounds insane." },
    { who: "nella", art: "nella_scream", text: "Something tore out of me. I screamed. For the grief. For the rage. For the fear I'd carried since I was ten. Chuck sat stunned, then quietly got up and went home." },
    { who: "nella", art: "nella", text: "I couldn't blame him. But I wasn't ready to give up. Maybe if I beat the hardest difficulty, there'd be another code. And that code would be Dad's message." },
    { who: "nella", text: "I played all night. And into the morning." },

    { bg: "crt_red", who: "nella", text: "8 AM. My eyes burned. My hands ached. One more, I told myself. The final boss. Maybe it was the pressure — but I played the game of my life. I beat it." },
    { who: "nella", text: "A shiver ran through me. Out of the black faded handwriting — deep red, like blood. The victory music played, but… wrong. Distorted. In the wrong key." },
    { bg: "latin", who: "nella", text: "\"Omne ignotum pro magnifico.\" I looked it up. \"Everything unknown appears magnificent.\" Latin. In an American game. It made no sense." },
    { bg: "chaos", who: "nella", text: "The screen bled red. A skull. Beside it, a symbol — a circle with arrows pointing outward. The music stopped dead." },
    { who: "nella", text: "Black letters appeared: \"A deal is struck. Proceed? Press Start and Select.\"  I should have been terrified. Instead I was thrilled — a clue from Dad. I pressed Start and Select." },
    { bg: "", text: "The world faded to black." },

    { bg: "bedroom", who: "nella", art: "nella_demon", text: "I woke on a satin bed in a room like something out of a castle. Paintings of spellcasting. A mahogany desk. A piano. And a mirror, floor to ceiling." },
    { who: "nella", text: "I screamed. My reflection had red horns pushing through my hair. Glowing red eyes. Fangs. A dark red robe. On my wrist, a copper bracelet set with pale blue gems. I'd become… some kind of demon." },
    { bg: "mirror", who: "devil", art: "devil", text: "Hello, and welcome to Infinity! Your appearance reflects your magical avatar. The bracelet — copper for your rank, aquamarine for your playstyle. These can change." },
    { who: "devil", text: "Practice here, or head to the lounge for a meal and a battle, or the library to study. Challenge anyone you see fit — it's the only way to grow stronger! Now… take your first steps out that door." },
    { who: "nella", art: "nella_demon", text: "The little devil pointed to the door and vanished. I pinched myself. It hurt. Everything about this felt like a dream I couldn't wake from. With no way home, I went through the door." }
  ];

  // ---- 2. WALK-AROUND: rooms, exits, and NPCs to talk to ------------------
  // Coordinates are in a 320x200 virtual room (matches the other games' 2x
  // pixel-scale convention). player start position is per-room.
  var ROOMS = {
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
