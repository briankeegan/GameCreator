// Puzzle Attack — the one game-wide difficulty setting.
//
// `level` (panel-engine.js's Stack level, 1-10) drives real mechanics: rise
// speed, panel colors, health, and the stop-time constants. Every duel used
// to set it per-NPC, with the opponent ALWAYS a level or two above the
// player (2/1, 3/2, 5/3, 6/3, foe/player) — an asymmetry nobody had chosen
// on purpose, just accumulated one duel at a time. The player asked for the
// two sides to match, and for that to be a single choice made once (at the
// start of a new file) and revisitable any time after (from the pause
// menu), rather than baked into each character.
//
// Four tiers, both sides of every duel always at the SAME level:
var TIERS = [
  { id: "easy", label: "Easy", level: 3 },
  { id: "medium", label: "Medium", level: 5 },
  { id: "hard", label: "Hard", level: 8 },
  // "Nightmare" rather than "Extra Hard" because it already names the
  // toughest thing in this file's neighbor, panel-cpu.js's DIFFICULTIES —
  // the fully unscaled, tournament-proven SearchCpu preset. Diamond's duel
  // already runs on it (story.js). Naming this tier the same word ties the
  // two together instead of inventing a second name for the same idea.
  { id: "nightmare", label: "Nightmare", level: 10 }
];
var DEFAULT_ID = "medium";

window.NewseyDifficulty = (function () {
  function find(id) {
    for (var i = 0; i < TIERS.length; i++) if (TIERS[i].id === id) return TIERS[i];
    return null;
  }
  function tierFor(id) { return find(id) || find(DEFAULT_ID); }

  return {
    TIERS: TIERS,
    DEFAULT: DEFAULT_ID,
    isValid: function (id) { return !!find(id); },
    levelFor: function (id) { return tierFor(id).level; },
    labelFor: function (id) { return tierFor(id).label; }
  };
})();
