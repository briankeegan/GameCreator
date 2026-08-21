// Rebindable keyboard + gamepad input mapping, for a game with real-time
// held-key movement (WASD/arrows, a "talk" button, whatever your actions
// are) rather than pointer/click-only interaction.
//
// Extracted from Newsey's (games/the-game/settings.js) controls system,
// which was the only game in this repo with rebinding, gamepad support, and
// stick-drift hysteresis — dog-punk has its own hardcoded, non-rebindable
// key table, and hypergolic-hull/trebor have no keyboard movement scheme at
// all (they're pointer-driven). If your game doesn't need held-key
// real-time movement, you don't need this module.
//
// THIS IS THE LOGIC LAYER ONLY — it owns what a key/button is bound to,
// whether an action is currently held, and the mechanics of capturing a
// rebind (listening for the next key or controller button, Escape to
// cancel, on-screen-keyboard fallback for mobile). It does NOT render a
// settings screen: every game's controls UI looks and is laid out
// differently (see games/the-game/settings.js for a full example — its
// render()/grab() functions build Newsey's own DOM and stay in that file,
// now as a thin consumer of this module for the actual mapping/capture
// logic). Wire this module's state into whatever HTML your game already has.
//
// Usage:
//   const CONTROLS = GCControls.create("my-game", {
//     actions: [
//       { id: "up", label: "Up" }, { id: "down", label: "Down" },
//       { id: "left", label: "Left" }, { id: "right", label: "Right" },
//       { id: "interact", label: "Talk / confirm" },
//     ],
//     defaultKeys: { up: ["ArrowUp", "w"], down: ["ArrowDown", "s"],
//                    left: ["ArrowLeft", "a"], right: ["ArrowRight", "d"],
//                    interact: ["z", "Enter"] },
//     defaultPad: { up: [12], down: [13], left: [14], right: [15], interact: [0, 2] },
//     grabberEl: document.getElementById("keyGrabber"), // optional <input>,
//                                                        // focused during a
//                                                        // capture so phones
//                                                        // raise a keyboard
//   });
//
//   // per frame:
//   if (CONTROLS.isDown("left", liveKeys) || (pad && pad.left)) dx -= 1;
//   const pad = CONTROLS.gamepad();       // null if nothing connected
//
//   // rebind UI:
//   CONTROLS.beginKeyCapture("interact", { onAssign: render, onCancel: render });
window.GCControls = {
  create(gameId, opts) {
    opts = opts || {};
    const gameId_ = gameId;
    const ACTIONS = opts.actions || [];
    const defaultKeys = opts.defaultKeys || {};
    const defaultPad = opts.defaultPad || {};
    const grabberEl = opts.grabberEl || null;

    // A single fixed threshold chatters: a stick sitting right at rest near
    // 0.45 (worn/drifting analog sticks are common — "Joy-Con drift" is the
    // well-known version of this) flips the read in and out of "pressed"
    // every frame even with a hand nowhere near the stick. Fix is ordinary
    // hysteresis: a higher bar to count as newly pressed than to stay
    // pressed, so noise hovering near one threshold can't retrigger it
    // every frame.
    const STICK_ENGAGE = 0.5, STICK_RELEASE = 0.3;
    const stickHeld = {};

    function stickFlag(dir, raw) {
      const was = !!stickHeld[dir];
      const now = was ? raw > STICK_RELEASE : raw > STICK_ENGAGE;
      stickHeld[dir] = now;
      return now;
    }

    function merge(defaults, stored) {
      const out = { keys: {}, pad: {} };
      for (const id in defaults) out.keys[id] = (defaults[id] || []).slice();
      for (const id in defaultPad) out.pad[id] = (defaultPad[id] || []).slice();
      if (stored) {
        ["keys", "pad"].forEach((group) => {
          if (!stored[group]) return;
          for (const id in stored[group]) {
            if (out[group][id] && stored[group][id] && stored[group][id].length) {
              out[group][id] = stored[group][id].slice();
            }
          }
        });
      }
      return out;
    }

    const saved = window.GCStorage.get(gameId_, "controls", null);
    let bindings = merge(defaultKeys, saved);
    const listeners = [];

    function persist() {
      window.GCStorage.set(gameId_, "controls", bindings);
      listeners.forEach((cb) => cb(bindings));
    }

    // Is `action` currently held, given a live map of pressed keys (e.g.
    // { ArrowLeft: true }, built by your own keydown/keyup listeners)? Keys
    // are compared case-insensitively so caps lock never breaks controls.
    function isDown(action, liveKeys) {
      const bound = bindings.keys[action] || [];
      for (const key of bound) {
        if (liveKeys[key]) return true;
        if (key.length === 1 && (liveKeys[key.toLowerCase()] || liveKeys[key.toUpperCase()])) return true;
      }
      return false;
    }

    // Reads any connected gamepad and reports which actions it is asking
    // for. Returns null when nothing is connected, so callers can skip the
    // merge entirely.
    function gamepad() {
      if (!navigator.getGamepads) return null;
      const pads = navigator.getGamepads();
      let state = null;
      for (const pad of pads) {
        if (!pad || !pad.connected) continue;
        state = state || {};
        ACTIONS.forEach((a) => { state[a.id] = false; });
        for (const action in bindings.pad) {
          for (const idx of bindings.pad[action]) {
            const button = pad.buttons[idx];
            if (button && (button.pressed || button.value > 0.5)) state[action] = true;
          }
        }
        // left stick, for pads whose d-pad reports as axes
        const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
        if ("left" in state && stickFlag("left", -x)) state.left = true;
        if ("right" in state && stickFlag("right", x)) state.right = true;
        if ("up" in state && stickFlag("up", -y)) state.up = true;
        if ("down" in state && stickFlag("down", y)) state.down = true;
      }
      return state;
    }

    function keyLabel(key) {
      if (key === " ") return "Space";
      if (key.indexOf("Arrow") === 0) {
        return { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }[key];
      }
      return key.length === 1 ? key.toUpperCase() : key;
    }

    const PAD_NAMES = { 0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT",
      12: "▲", 13: "▼", 14: "◀", 15: "▶" };
    function padLabel(action) {
      const buttons = bindings.pad[action] || [];
      if (!buttons.length) return "—";
      return buttons.slice(0, 2).map((b) => PAD_NAMES[b] || ("btn " + b)).join(" / ");
    }

    // ---------- rebind capture ----------
    // Capturing has to beat the game's own key handling, so it listens on
    // the capture phase and stops propagation. Some on-screen keyboards
    // report keydown as "Unidentified" and only deliver the character
    // through an input event, so a focused grabberEl (if supplied) is
    // watched too.
    let capturing = null;   // { action, onAssign, onCancel } while waiting for a key
    let capturingPad = null;
    let padPollHandle = null;

    function isTouchDevice() {
      return matchMedia("(hover: none) and (pointer: coarse)").matches;
    }

    function openKeyboardIfNeeded() {
      if (!grabberEl || !isTouchDevice()) return;
      try { grabberEl.value = ""; grabberEl.focus({ preventScroll: true }); }
      catch (e) { /* not fatal — a hardware keyboard still works */ }
    }
    function closeKeyboard() {
      if (grabberEl) grabberEl.blur();
    }

    function keydownDuringCapture(e) {
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        const cb = capturing.onCancel;
        capturing = null;
        closeKeyboard();
        if (cb) cb();
      } else if (e.key && e.key !== "Unidentified") {
        assignKey(e.key);
      }
    }
    function grabberInput() {
      if (!capturing || !grabberEl) return;
      const typed = grabberEl.value;
      grabberEl.value = "";
      if (typed) assignKey(typed.charAt(typed.length - 1));
    }
    window.addEventListener("keydown", keydownDuringCapture, true);
    if (grabberEl) grabberEl.addEventListener("input", grabberInput);

    function assignKey(key) {
      if (!capturing) return;
      bindings.keys[capturing.action] = [key];
      persist();
      const cb = capturing.onAssign;
      capturing = null;
      closeKeyboard();
      if (cb) cb();
    }

    // Begin waiting for the next key press to bind to `actionId`. Calls
    // onAssign() once bound, or onCancel() if Escape is pressed — call
    // render again from either callback.
    function beginKeyCapture(actionId, { onAssign, onCancel } = {}) {
      cancelPadCapture();
      capturing = { action: actionId, onAssign, onCancel };
      openKeyboardIfNeeded();
    }
    function cancelKeyCapture() {
      capturing = null;
      closeKeyboard();
    }

    function stopPadCapture() {
      if (padPollHandle) cancelAnimationFrame(padPollHandle);
      padPollHandle = null;
    }
    // While waiting, poll the gamepad for the first button that goes down
    // and bind that — the Gamepad API has no button-press events, polling
    // is the only way.
    function beginPadCapture(actionId, { onAssign } = {}) {
      cancelKeyCapture();
      capturingPad = actionId;
      stopPadCapture();
      const wasDown = {};
      const poll = () => {
        if (capturingPad !== actionId) return;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const pad of pads) {
          if (!pad || !pad.connected) continue;
          for (let b = 0; b < pad.buttons.length; b++) {
            const down = pad.buttons[b] && (pad.buttons[b].pressed || pad.buttons[b].value > 0.5);
            if (down && !wasDown[b]) {
              bindings.pad[actionId] = [b];
              persist();
              capturingPad = null;
              stopPadCapture();
              if (onAssign) onAssign();
              return;
            }
            wasDown[b] = down;
          }
        }
        padPollHandle = requestAnimationFrame(poll);
      };
      padPollHandle = requestAnimationFrame(poll);
    }
    function cancelPadCapture() {
      capturingPad = null;
      stopPadCapture();
    }

    return {
      actions: ACTIONS,
      isDown,
      gamepad,
      keysFor: (action) => (bindings.keys[action] || []).slice(),
      padFor: (action) => (bindings.pad[action] || []).slice(),
      keyLabel,
      padLabel,
      reset() { bindings = merge(defaultKeys, null); persist(); },
      onChange: (cb) => listeners.push(cb),
      beginKeyCapture,
      cancelKeyCapture,
      beginPadCapture,
      cancelPadCapture,
      // Returns the action id being captured, or null/undefined — a plain
      // truthy check (as most callers want) still works, and a caller that
      // wants to know WHICH action can compare against it (e.g. to toggle a
      // capture off when its own button is clicked again).
      isCapturing: () => (capturing ? capturing.action : null),
      isCapturingPad: () => capturingPad,
      isTouchDevice,
    };
  },
};
