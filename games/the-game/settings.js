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
    padSide: "left",          // which side of the screen the on-screen d-pad sits
    keys: {
      up: ["ArrowUp", "w"],
      down: ["ArrowDown", "s"],
      left: ["ArrowLeft", "a"],
      right: ["ArrowRight", "d"],
      interact: ["z", "Enter"],
      swap: ["z", " "],
      raise: ["Shift", "r"]
    },
    // Gamepad button indices per action, standard layout: d-pad 12-15, face
    // buttons 0-3, shoulders 4-7. Rebindable by pressing a button on the pad.
    pad: {
      up: [12], down: [13], left: [14], right: [15],
      interact: [0, 2], swap: [0, 2], raise: [1, 3, 4, 5, 6, 7]
    },
    // What the two on-screen action buttons do. On a phone these ARE the
    // controls, so they are the mapping that actually matters there.
    buttons: { primary: "swap", secondary: "raise" }
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

  // The two on-screen action buttons can be set to any of these.
  var BUTTON_CHOICES = [
    { id: "swap", label: "Swap" },
    { id: "raise", label: "Raise" },
    { id: "interact", label: "Talk" },
    { id: "up", label: "Up" },
    { id: "down", label: "Down" }
  ];
  var STICK_DEADZONE = 0.45;

  var saved = window.GCStorage.get(gameId, "settings", null);
  var settings = merge(DEFAULTS, saved);
  var listeners = [];

  function merge(defaults, stored) {
    var out = {
      onScreenControls: defaults.onScreenControls,
      padSide: defaults.padSide,
      keys: {}, pad: {},
      buttons: { primary: defaults.buttons.primary, secondary: defaults.buttons.secondary }
    };
    var id;
    for (id in defaults.keys) out.keys[id] = defaults.keys[id].slice();
    for (id in defaults.pad) out.pad[id] = defaults.pad[id].slice();
    if (stored) {
      if (stored.onScreenControls) out.onScreenControls = stored.onScreenControls;
      if (stored.padSide) out.padSide = stored.padSide;
      if (stored.buttons) {
        if (stored.buttons.primary) out.buttons.primary = stored.buttons.primary;
        if (stored.buttons.secondary) out.buttons.secondary = stored.buttons.secondary;
      }
      ["keys", "pad"].forEach(function (group) {
        if (!stored[group]) return;
        for (var key in stored[group]) {
          if (out[group][key] && stored[group][key] && stored[group][key].length) {
            out[group][key] = stored[group][key].slice();
          }
        }
      });
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
      for (var action in settings.pad) {
        var indexes = settings.pad[action];
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

  // While a pad rebind is waiting, poll the gamepad for the first button that
  // goes down and bind that. Polling is the only way — the Gamepad API has no
  // button events.
  var padPollHandle = null;
  function startPadCapture() {
    stopPadCapture();
    var wasDown = {};
    var poll = function () {
      if (!capturingPad) return;
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var p = 0; p < pads.length; p++) {
        var pad = pads[p];
        if (!pad || !pad.connected) continue;
        for (var b = 0; b < pad.buttons.length; b++) {
          var down = pad.buttons[b] && (pad.buttons[b].pressed || pad.buttons[b].value > 0.5);
          if (down && !wasDown[b]) {
            settings.pad[capturingPad] = [b];
            persist();
            capturingPad = null;
            stopPadCapture();
            render();
            return;
          }
          wasDown[b] = down;
        }
      }
      padPollHandle = requestAnimationFrame(poll);
    };
    padPollHandle = requestAnimationFrame(poll);
  }
  function stopPadCapture() {
    if (padPollHandle) cancelAnimationFrame(padPollHandle);
    padPollHandle = null;
  }

  function padLabel(action) {
    var buttons = settings.pad[action] || [];
    if (!buttons.length) return "—";
    var names = { 0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT",
      12: "▲", 13: "▼", 14: "◀", 15: "▶" };
    return buttons.slice(0, 2).map(function (b) { return names[b] || ("btn " + b); }).join(" / ");
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
  var capturing = null;    // the action waiting for a key press
  var capturingPad = null; // the action waiting for a controller button
  var captureQueue = []; // remaining actions in a "set all keys" run
  var settingAll = false;

  function grab() {
    if (els) return els;
    els = {
      list: document.getElementById("settingsKeys"),
      reset: document.getElementById("settingsReset"),
      setAll: document.getElementById("settingsSetAll"),
      grabber: document.getElementById("settingsKeyGrabber"),
      status: document.getElementById("settingsStatus"),
      buttons: document.getElementById("settingsButtons"),
      modes: document.querySelectorAll("#settingsControls button")
    };
    els.setAll.addEventListener("click", function () {
      // Walk every action in order, the way the original game's input config
      // does — press one key per prompt, Esc to stop.
      captureQueue = ACTIONS.map(function (a) { return a.id; });
      settingAll = true;
      capturing = captureQueue.shift();
      openKeyboardIfNeeded();
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
    // Some on-screen keyboards report keydown as "Unidentified" and only
    // deliver the character through an input event, so take it from there too.
    if (els.grabber) {
      els.grabber.addEventListener("input", function () {
        var typed = els.grabber.value;
        els.grabber.value = "";
        if (!capturing || !typed) return;
        assignKey(typed.charAt(typed.length - 1));
      });
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
        closeKeyboard();
        render();
      } else if (e.key && e.key !== "Unidentified") {
        assignKey(e.key);
      }
    }, true);
    return els;
  }

  // On a phone there is no keyboard until something asks for one. Focusing a
  // hidden input from the tap that started the rebind is what raises it, so
  // "press a key" is a thing the player can actually do there.
  function openKeyboardIfNeeded() {
    if (!els || !els.grabber || !isTouchDevice()) return;
    try {
      els.grabber.value = "";
      els.grabber.focus({ preventScroll: true });
    } catch (e) { /* not fatal — a hardware keyboard still works */ }
  }
  function closeKeyboard() {
    if (els && els.grabber) els.grabber.blur();
  }

  function labelFor(actionId) {
    for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === actionId) return ACTIONS[i].label;
    return actionId;
  }

  // Binds one pressed key to whatever action is currently capturing, then
  // moves on to the next one if this is a "set all keys" run.
  function assignKey(key) {
    if (!capturing) return;
    settings.keys[capturing] = [key];
    persist();
    capturing = captureQueue.length ? captureQueue.shift() : null;
    if (!capturing) { settingAll = false; closeKeyboard(); }
    render();
  }

  function render() {
    var ui = grab();
    if (capturingPad) {
      ui.status.textContent = "Press a button on your controller for " + labelFor(capturingPad) + " · tap again to cancel";
      ui.status.hidden = false;
    } else if (capturing) {
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

      var badges = document.createElement("span");
      badges.className = "settings-badges";

      var keyBtn = document.createElement("button");
      keyBtn.className = "settings-key" + (capturing === action.id ? " capturing" : "");
      keyBtn.textContent = capturing === action.id
        ? "press a key…"
        : settings.keys[action.id].map(keyLabel).join(" / ");
      keyBtn.addEventListener("click", function () {
        capturingPad = null;
        stopPadCapture();
        capturing = capturing === action.id ? null : action.id;
        if (capturing) openKeyboardIfNeeded(); else closeKeyboard();
        render();
      });

      var padBtn = document.createElement("button");
      padBtn.className = "settings-pad" + (capturingPad === action.id ? " capturing" : "");
      padBtn.textContent = capturingPad === action.id ? "press a button…" : padLabel(action.id);
      padBtn.title = "Controller button";
      padBtn.addEventListener("click", function () {
        capturing = null;
        closeKeyboard();
        capturingPad = capturingPad === action.id ? null : action.id;
        if (capturingPad) startPadCapture(); else stopPadCapture();
        render();
      });

      badges.appendChild(keyBtn);
      badges.appendChild(padBtn);
      row.appendChild(label);
      row.appendChild(badges);
      ui.list.appendChild(row);
    });

    renderButtonMapping(ui);
  }

  // The on-screen buttons: which action each one performs, and which side the
  // d-pad sits on. On a phone this is the mapping that actually does anything,
  // since there is no keyboard to press while playing.
  function renderButtonMapping(ui) {
    if (!ui.buttons) return;
    ui.buttons.innerHTML = "";
    [["primary", "Button 1"], ["secondary", "Button 2"]].forEach(function (pair) {
      var slot = pair[0];
      var row = document.createElement("div");
      row.className = "settings-row";
      var label = document.createElement("span");
      label.className = "settings-label";
      label.textContent = pair[1];
      var choices = document.createElement("span");
      choices.className = "settings-badges";
      BUTTON_CHOICES.forEach(function (choice) {
        var b = document.createElement("button");
        b.className = "settings-choice" + (settings.buttons[slot] === choice.id ? " active" : "");
        b.textContent = choice.label;
        b.addEventListener("click", function () {
          settings.buttons[slot] = choice.id;
          persist();
          render();
        });
        choices.appendChild(b);
      });
      row.appendChild(label);
      row.appendChild(choices);
      ui.buttons.appendChild(row);
    });

    var sideRow = document.createElement("div");
    sideRow.className = "settings-row";
    var sideLabel = document.createElement("span");
    sideLabel.className = "settings-label";
    sideLabel.textContent = "D-pad side";
    var sides = document.createElement("span");
    sides.className = "settings-badges";
    [["left", "Left"], ["right", "Right"]].forEach(function (pair) {
      var b = document.createElement("button");
      b.className = "settings-choice" + (settings.padSide === pair[0] ? " active" : "");
      b.textContent = pair[1];
      b.addEventListener("click", function () {
        settings.padSide = pair[0];
        persist();
        render();
      });
      sides.appendChild(b);
    });
    sideRow.appendChild(sideLabel);
    sideRow.appendChild(sides);
    ui.buttons.appendChild(sideRow);
  }

  // Called by menu.js when the CONTROLS screen is shown.
  function refresh() {
    grab();
    capturing = null;
    capturingPad = null;
    stopPadCapture();
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
    capturingPad = null;
    stopPadCapture();
    captureQueue = [];
    settingAll = false;
    closeKeyboard();
    if (els) render();
  }

  return {
    isDown: isDown,
    gamepad: gamepadState,
    showOnScreenControls: showOnScreenControls,
    isTouchDevice: isTouchDevice,
    keysFor: function (action) { return (settings.keys[action] || []).slice(); },
    // Which action an on-screen button performs: "primary" or "secondary".
    buttonAction: function (slot) { return settings.buttons[slot]; },
    buttonLabel: function (slot) {
      var id = settings.buttons[slot];
      for (var i = 0; i < BUTTON_CHOICES.length; i++) if (BUTTON_CHOICES[i].id === id) return BUTTON_CHOICES[i].label;
      return id;
    },
    padSide: function () { return settings.padSide; },
    open: open,
    refresh: refresh,
    cancelCapture: cancelCapture,
    // True only while a key press is being captured for a rebind — that is the
    // moment the game must not act on keys.
    isCapturing: function () { return !!capturing; },
    onChange: function (cb) { listeners.push(cb); }
  };
})();
