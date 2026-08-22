// Shared game-boot gate: a full-screen title layer shown first, deciding
// START vs CONTINUE from whether a save exists, and hiding once play begins.
//
// WHY THIS EXISTS. Migrating Dog Punk onto shared/controls.js and
// shared/save-slots.js built the SAVE MECHANISM but not the thing a player
// actually judges a "load game screen" by: Newsey (games/the-game/menu.js,
// showTitle()) gates its whole world behind a real title card — logo,
// PRESS START, CONTINUE — shown BEFORE any gameplay is visible. Dog Punk
// instead rendered the room immediately with a small dialog floating on
// top of it, which reads as "no start screen at all" even though a
// checkpoint save was working correctly underneath. That gap was found by
// hand once already; extracting the boot-gate logic here means the next
// game that adds a save doesn't get a save with no way to see it's there
// until it's confirmed broken.
//
// This module owns ONLY the "am I showing the title layer or the game"
// state machine — full-screen show/hide of one element you provide, START
// vs CONTINUE wiring, deciding CONTINUE's visibility from a hasSave() you
// supply. It owns nothing about what your title screen CONTAINS (logo,
// subtitle, file-select, a narrative cutscene after START) — that stays
// yours, the same way save-slots.js owns slot mechanics but not a save's
// shape. A game with Newsey's multi-file complexity keeps that complexity
// in its own menu code; a single-checkpoint game like Dog Punk can wire
// this directly to its one save.
//
// A title screen that's just a logo and a button reads as a placeholder,
// not as YOUR game — the fix is showing the game's own art, not a shared
// look. onShow exists for exactly that: it fires every time show() runs
// (including the very first call, before art may have finished loading —
// call TITLE.refresh() again once your assets report ready if you draw a
// sprite frame), so a game can redraw a portrait, roll a random tagline,
// or refresh anything else that should look current whenever the title
// layer comes back (e.g. after Continue's target dies and returns here).
// What gets drawn is entirely the game's own business — this module never
// touches a canvas itself, same as it never touches your save's shape.
//
// Usage:
//   const TITLE = GCTitleScreen.create(gameId, {
//     layerEl: document.getElementById("titleLayer"),
//     startBtn: document.getElementById("titleStart"),
//     continueBtn: document.getElementById("titleContinue"),   // optional
//     hasSave: () => !!SAVES.read(1),
//     continueLabel: () => "Continue",                          // optional
//     onShow: () => drawMyHeroPortrait(),                       // optional
//     onStart: () => { ...begin a new run... },
//     onContinue: () => { ...resume from save... },             // optional, defaults to onStart
//   });
//   TITLE.show();   // call once on boot — nothing else needs to run first
window.GCTitleScreen = {
  create(gameId, opts) {
    opts = opts || {};
    const layerEl = opts.layerEl;
    if (!layerEl) {
      throw new Error(`GCTitleScreen.create("${gameId}", ...) needs a layerEl (the full-screen element to show/hide)`);
    }
    const startBtn = opts.startBtn;
    const continueBtn = opts.continueBtn || null;
    const hasSave = opts.hasSave || (() => false);
    const onStart = opts.onStart || (() => {});
    const onContinue = opts.onContinue || onStart;

    function show() {
      layerEl.hidden = false;
      const has = !!hasSave();
      if (continueBtn) {
        continueBtn.hidden = !has;
        if (has && opts.continueLabel) continueBtn.textContent = opts.continueLabel();
      }
      if (opts.onShow) opts.onShow();
    }
    function hide() {
      layerEl.hidden = true;
    }

    if (startBtn) startBtn.addEventListener("click", () => { hide(); onStart(); });
    if (continueBtn) continueBtn.addEventListener("click", () => { hide(); onContinue(); });

    return { show, hide, refresh: show };
  },
};
