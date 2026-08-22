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
// Usage:
//   const TITLE = GCTitleScreen.create(gameId, {
//     layerEl: document.getElementById("titleLayer"),
//     startBtn: document.getElementById("titleStart"),
//     continueBtn: document.getElementById("titleContinue"),   // optional
//     hasSave: () => !!SAVES.read(1),
//     continueLabel: () => "Continue",                          // optional
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
    }
    function hide() {
      layerEl.hidden = true;
    }

    if (startBtn) startBtn.addEventListener("click", () => { hide(); onStart(); });
    if (continueBtn) continueBtn.addEventListener("click", () => { hide(); onContinue(); });

    return { show, hide, refresh: show };
  },
};
