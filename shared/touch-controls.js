// Bind a "hold this button" gesture for on-screen game controls — a d-pad
// direction, an attack button, anything pressed and held rather than
// tapped once. pointerdown starts it, pointerup/cancel/leave ends it, and
// every mobile-browser gesture that fights a held game button is
// suppressed automatically: the long-press "select + search Google" sheet,
// the native context menu, and the tap highlight flash.
//
// WHY THIS EXISTS. Dog Punk shipped this exact fix by hand (a Clubhouse
// request: "when holding down buttons, text is selected and a google
// thingy pops up"). Checking whether Newsey had the same bug found it had
// only HALF the fix — `-webkit-touch-callout: none` in its own CSS, but no
// `contextmenu`/`selectstart` prevention in JS at all — because each game
// had independently reinvented its own on-screen touch buttons, so a
// mobile-browser gotcha discovered on one never reached the other. This
// closes that gap for good: every property and every event listener that
// suppresses the "google thingy" now lives in ONE place, applied inline by
// this function, so a game gets the fix by calling it rather than by
// remembering five CSS properties across two files.
//
// Usage:
//   GCTouchControls.bindHold(buttonEl, () => /* pressed */ {}, () => /* released */ {});
window.GCTouchControls = {
  bindHold(el, onDown, onUp) {
    if (!el) return;
    // Inline, not left to the game's own stylesheet: a class selector's
    // rule is easy to add to one button and forget on the next, or to
    // drop when a game's CSS gets restyled. Setting it here means calling
    // this function is the whole fix, not "call this AND remember the CSS".
    el.style.touchAction = "none";
    el.style.userSelect = "none";
    el.style.webkitUserSelect = "none";
    el.style.webkitTouchCallout = "none";
    el.style.webkitTapHighlightColor = "transparent";

    const down = (e) => { e.preventDefault(); onDown(); };
    const up = (e) => { e.preventDefault(); onUp(); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
    // Belt and suspenders: the CSS/inline-style properties above are the
    // standards-track way to stop this, but the long-press callout on iOS
    // and the text-selection-then-search sheet on Android have each been
    // seen firing off a different underlying event depending on the
    // engine version. Preventing both explicitly costs nothing and closes
    // the gap either style alone might miss.
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("selectstart", (e) => e.preventDefault());
  },
};
