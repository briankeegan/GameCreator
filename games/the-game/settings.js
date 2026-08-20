// Puzzle Attack / Newsey — player settings.
//
// One place for "how do I control this game": whether the on-screen pad is
// showing, what each key is bound to, and the gamepad. Both modes read from
// here — the walk-around (app.js) and the duel (duel.js) — so a rebind applies
// everywhere instead of only where it was set.
//
// Saved per game through GCStorage, so it survives a reload and does not leak
// into any other game on the site.
window.NewseySettings = (function () {
  "use strict";

  var gameId = "the-game";

  // Directions default to the arrow keys / the d-pad, with WASD kept as a
  // second binding for anyone who plays that way. Every action can hold
  // several keys; rebinding replaces them with the one you press.
  var DEFAULTS = {
    onScreenControls: "auto", // auto (touch devices) | on | off
    keys: {
      up: ["ArrowUp", "w"],
      down: ["ArrowDown", "s"],
      left: ["ArrowLeft", "a"],
      right: ["ArrowRight", "d"],
      interact: ["z", "Enter"],
      swap: ["z", " "],
      raise: ["Shift", "r"]
    }
  };

  var ACTIONS = [
    { id: "up", label: "Up", where: "both" },
    { id: "down", label: "Down", where: "both" },
    { id: "left", label: "Left", where: "both" },
    { id: "right", label: "Right", where: "both" },
    { id: "interact", label: "Talk / confirm", where: "world" },
    { id: "swap", label: "Swap panels", where: "duel" },
    { id: "raise", label: "Raise the stack", where: "duel" }
  ];

  // Standard gamepad mapping (navigator.getGamepads, "standard" layout):
  // d-pad 12-15, face buttons 0-3, shoulders 4-7. Sticks are axes 0/1.
  var PAD_BUTTONS = {
    up: [12], down: [13], left: [14], right: [15],
    interact: [0, 2], swap: [0, 2], raise: [1, 3, 4, 5, 6, 7]
  };
  var STICK_DEADZONE = 0.45;

  var saved = window.GCStorage.get(gameId, "settings", null);
  var settings = merge(DEFAULTS, saved);
  var listeners = [];

  function merge(defaults, stored) {
    var out = { onScreenControls: defaults.onScreenControls, keys: {} };
    for (var id in defaults.keys) out.keys[id] = defaults.keys[id].slice();
    if (stored) {
      if (stored.onScreenControls) out.onScreenControls = stored.onScreenControls;
      if (stored.keys) {
        for (var key in stored.keys) {
          if (out.keys[key] && stored.keys[key] && stored.keys[key].length) {
            out.keys[key] = stored.keys[key].slice();
          }
        }
      }
    }
    return out;
  }

  function persist() {
    window.GCStorage.set(gameId, "settings", settings);
    for (var i = 0; i < listeners.length; i++) listeners[i](settings);
  }

  function isTouchDevice() {
    return matchMedia("(hover: none) and (pointer: coarse)").matches;
  }

  function showOnScreenControls() {
    if (settings.onScreenControls === "on") return true;
    if (settings.onScreenControls === "off") return false;
    return isTouchDevice();
  }

  // Is `action` currently held, given a live map of pressed keys? Keys are
  // compared case-insensitively so caps lock never breaks the controls.
  function isDown(action, keys) {
    var bound = settings.keys[action] || [];
    for (var i = 0; i < bound.length; i++) {
      var key = bound[i];
      if (keys[key]) return true;
      if (key.length === 1) {
        if (keys[key.toLowerCase()] || keys[key.toUpperCase()]) return true;
      }
    }
    return false;
  }

  // Reads any connected gamepad and reports which actions it is asking for.
  // Returns null when no pad is connected, so callers can skip the merge.
  function gamepadState() {
    if (!navigator.getGamepads) return null;
    var pads = navigator.getGamepads();
    var state = null;
    for (var p = 0; p < pads.length; p++) {
      var pad = pads[p];
      if (!pad || !pad.connected) continue;
      state = state || { up: false, down: false, left: false, right: false, interact: false, swap: false, raise: false };
      for (var action in PAD_BUTTONS) {
        var indexes = PAD_BUTTONS[action];
        for (var i = 0; i < indexes.length; i++) {
          var button = pad.buttons[indexes[i]];
          if (button && (button.pressed || button.value > 0.5)) state[action] = true;
        }
      }
      // left stick, for pads whose d-pad reports as axes
      var x = pad.axes[0] || 0, y = pad.axes[1] || 0;
      if (x < -STICK_DEADZONE) state.left = true;
      if (x > STICK_DEADZONE) state.right = true;
      if (y < -STICK_DEADZONE) state.up = true;
      if (y > STICK_DEADZONE) state.down = true;
    }
    return state;
  }

  function keyLabel(key) {
    if (key === " ") return "Space";
    if (key.indexOf("Arrow") === 0) return { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }[key];
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  // ---------- the controls screen ----------
  // The UI lives inline on the menu's CONTROLS screen (menu.js owns showing
  // and hiding it) — deliberately not a panel stacked on top of the menu.
  var els = null;
  var capturing = null;  // the action waiting for a key press
  var captureQueue = []; // remaining actions in a "set all keys" run
  var settingAll = false;

  function grab() {
    if (els) return els;
    els = {
      list: document.getElementById("settingsKeys"),
      reset: document.getElementById("settingsReset"),
      setAll: document.getElementById("settingsSetAll"),
      status: document.getElementById("settingsStatus"),
      modes: document.querySelectorAll("#settingsControls button")
    };
    els.setAll.addEventListener("click", function () {
      // Walk every action in order, the way the original game's input config
      // does — press one key per prompt, Esc to stop.
      captureQueue = ACTIONS.map(function (a) { return a.id; });
      settingAll = true;
      capturing = captureQueue.shift();
      render();
    });
    els.reset.addEventListener("click", function () {
      settings = merge(DEFAULTS, null);
      capturing = null;
      captureQueue = [];
      settingAll = false;
      persist();
      render();
    });
    for (var i = 0; i < els.modes.length; i++) {
      (function (button) {
        button.addEventListener("click", function () {
          settings.onScreenControls = button.dataset.mode;
          persist();
          render();
        });
      })(els.modes[i]);
    }
    // Capturing a rebind has to beat the game's own key handling, so it runs
    // in the capture phase and stops the event there.
    window.addEventListener("keydown", function (e) {
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        capturing = null;
        captureQueue = [];
        settingAll = false;
      } else {
        settings.keys[capturing] = [e.key];
        persist();
        capturing = captureQueue.length ? captureQueue.shift() : null;
        if (!capturing) settingAll = false;
      }
      render();
    }, true);
    return els;
  }

  function labelFor(actionId) {
    for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === actionId) return ACTIONS[i].label;
    return actionId;
  }

  function render() {
    var ui = grab();
    if (capturing) {
      var step = ACTIONS.length - captureQueue.length;
      ui.status.textContent = settingAll
        ? "Press a key for " + labelFor(capturing) + " (" + step + "/" + ACTIONS.length + ") · Esc to stop"
        : "Press a key for " + labelFor(capturing) + " · Esc to cancel";
      ui.status.hidden = false;
    } else {
      ui.status.hidden = true;
    }
    for (var i = 0; i < ui.modes.length; i++) {
      ui.modes[i].classList.toggle("active", ui.modes[i].dataset.mode === settings.onScreenControls);
    }
    ui.list.innerHTML = "";
    ACTIONS.forEach(function (action) {
      var row = document.createElement("div");
      row.className = "settings-row";

      var label = document.createElement("span");
      label.className = "settings-label";
      label.textContent = action.label;
      var where = document.createElement("em");
      where.className = "settings-where";
      where.textContent = action.where === "duel" ? "duel" : (action.where === "world" ? "world" : "");
      label.appendChild(where);

      var button = document.createElement("button");
      button.className = "settings-key" + (capturing === action.id ? " capturing" : "");
      button.textContent = capturing === action.id
        ? "press a key…"
        : settings.keys[action.id].map(keyLabel).join(" / ");
      button.addEventListener("click", function () {
        capturing = capturing === action.id ? null : action.id;
        render();
      });

      row.appendChild(label);
      row.appendChild(button);
      ui.list.appendChild(row);
    });
  }

  // Called by menu.js when the CONTROLS screen is shown.
  function refresh() {
    grab();
    capturing = null;
    captureQueue = [];
    settingAll = false;
    render();
  }

  // Anything that wants the controls screen goes through the menu, so there is
  // only ever one layer on screen.
  function open() {
    if (window.NewseyMenu) window.NewseyMenu.showControls();
  }

  function cancelCapture() {
    capturing = null;
    captureQueue = [];
    settingAll = false;
    if (els) render();
  }

  return {
    isDown: isDown,
    gamepad: gamepadState,
    showOnScreenControls: showOnScreenControls,
    isTouchDevice: isTouchDevice,
    keysFor: function (action) { return (settings.keys[action] || []).slice(); },
    open: open,
    refresh: refresh,
    cancelCapture: cancelCapture,
    // True only while a key press is being captured for a rebind — that is the
    // moment the game must not act on keys.
    isCapturing: function () { return !!capturing; },
    onChange: function (cb) { listeners.push(cb); }
  };
})();
