// Puzzle Attack / Newsey — player settings.
//
// One place for "how do I control this game": whether the on-screen pad is
// showing, what each key is bound to, and the gamepad. Both modes read from
// here — the walk-around (app.js) and the duel (duel.js) — so a rebind applies
// everywhere instead of only where it was set.
//
// The key/gamepad mapping and rebind-capture mechanics (stick-drift
// hysteresis, Escape-to-cancel, the on-screen-keyboard fallback) now live in
// shared/controls.js, generic enough for any game with real-time held-key
// movement. What's left here is Newsey's own flavor: which actions exist,
// what the on-screen buttons do, which side the d-pad sits on, and the
// CONTROLS screen's actual DOM — all the "appearance" that's meant to differ
// per game rather than be forced into one shared look.
window.NewseySettings = (function () {
  "use strict";

  var gameId = "the-game";

  var ACTIONS = [
    { id: "up", label: "Up", where: "both" },
    { id: "down", label: "Down", where: "both" },
    { id: "left", label: "Left", where: "both" },
    { id: "right", label: "Right", where: "both" },
    { id: "interact", label: "Talk / confirm", where: "world" },
    { id: "swap", label: "Swap panels", where: "duel" },
    { id: "raise", label: "Raise the stack", where: "duel" }
  ];

  // Directions default to the arrow keys / the d-pad, with WASD kept as a
  // second binding for anyone who plays that way. Every action can hold
  // several keys; rebinding replaces them with the one you press.
  var DEFAULT_KEYS = {
    up: ["ArrowUp", "w"], down: ["ArrowDown", "s"],
    left: ["ArrowLeft", "a"], right: ["ArrowRight", "d"],
    interact: ["z", "Enter"], swap: ["z", " "], raise: ["Shift", "r"]
  };
  // Gamepad button indices per action, standard layout: d-pad 12-15, face
  // buttons 0-3, shoulders 4-7. Rebindable by pressing a button on the pad.
  var DEFAULT_PAD = {
    up: [12], down: [13], left: [14], right: [15],
    interact: [0, 2], swap: [0, 2], raise: [1, 3, 4, 5, 6, 7]
  };

  var CONTROLS = window.GCControls.create(gameId, {
    actions: ACTIONS,
    defaultKeys: DEFAULT_KEYS,
    defaultPad: DEFAULT_PAD,
    grabberEl: document.getElementById("settingsKeyGrabber")
  });

  // What the two on-screen action buttons do, and which side the d-pad
  // sits on. On a phone the buttons ARE the controls, so this mapping is
  // the one that actually matters there. Not part of shared/controls.js —
  // "two on-screen buttons plus a d-pad side" is Newsey's own on-screen
  // layout, not every game's.
  var UI_DEFAULTS = { onScreenControls: "auto", padSide: "left", buttons: { primary: "swap", secondary: "raise" } };
  var BUTTON_CHOICES = [
    { id: "swap", label: "Swap" },
    { id: "raise", label: "Raise" },
    { id: "interact", label: "Talk" },
    { id: "up", label: "Up" },
    { id: "down", label: "Down" }
  ];

  var savedUi = window.GCStorage.get(gameId, "settings", null);
  var ui = mergeUi(UI_DEFAULTS, savedUi);

  function mergeUi(defaults, stored) {
    var out = {
      onScreenControls: defaults.onScreenControls,
      padSide: defaults.padSide,
      buttons: { primary: defaults.buttons.primary, secondary: defaults.buttons.secondary }
    };
    if (stored) {
      if (stored.onScreenControls) out.onScreenControls = stored.onScreenControls;
      if (stored.padSide) out.padSide = stored.padSide;
      if (stored.buttons) {
        if (stored.buttons.primary) out.buttons.primary = stored.buttons.primary;
        if (stored.buttons.secondary) out.buttons.secondary = stored.buttons.secondary;
      }
    }
    return out;
  }

  function persistUi() {
    window.GCStorage.set(gameId, "settings", ui);
    for (var i = 0; i < uiListeners.length; i++) uiListeners[i](ui);
  }
  var uiListeners = [];

  function showOnScreenControls() {
    if (ui.onScreenControls === "on") return true;
    if (ui.onScreenControls === "off") return false;
    return CONTROLS.isTouchDevice();
  }

  // ---------- the controls screen ----------
  // The UI lives inline on the menu's CONTROLS screen (menu.js owns showing
  // and hiding it) — deliberately not a panel stacked on top of the menu.
  var els = null;
  var settingAll = false;
  var captureQueue = [];

  function grab() {
    if (els) return els;
    els = {
      list: document.getElementById("settingsKeys"),
      reset: document.getElementById("settingsReset"),
      setAll: document.getElementById("settingsSetAll"),
      status: document.getElementById("settingsStatus"),
      buttons: document.getElementById("settingsButtons"),
      modes: document.querySelectorAll("#settingsControls button")
    };
    els.setAll.addEventListener("click", function () {
      // Walk every action in order, the way the original game's input config
      // does — press one key per prompt, Esc to stop.
      captureQueue = ACTIONS.map(function (a) { return a.id; });
      settingAll = true;
      captureNext();
    });
    els.reset.addEventListener("click", function () {
      CONTROLS.reset();
      captureQueue = [];
      settingAll = false;
      render();
    });
    for (var i = 0; i < els.modes.length; i++) {
      (function (button) {
        button.addEventListener("click", function () {
          ui.onScreenControls = button.dataset.mode;
          persistUi();
          render();
        });
      })(els.modes[i]);
    }
    return els;
  }

  function labelFor(actionId) {
    for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === actionId) return ACTIONS[i].label;
    return actionId;
  }

  function captureNext() {
    var actionId = settingAll ? captureQueue.shift() : null;
    if (settingAll && !actionId) { settingAll = false; render(); return; }
    CONTROLS.beginKeyCapture(actionId, {
      onAssign: function () { if (settingAll) captureNext(); else render(); },
      onCancel: function () { settingAll = false; captureQueue = []; render(); }
    });
    render();
  }

  function render() {
    var ui_ = grab();
    if (CONTROLS.isCapturingPad()) {
      ui_.status.textContent = "Press a button on your controller for " + labelFor(CONTROLS.isCapturingPad()) + " · tap again to cancel";
      ui_.status.hidden = false;
    } else if (CONTROLS.isCapturing()) {
      ui_.status.textContent = settingAll
        ? "Press a key · Esc to stop"
        : "Press a key · Esc to cancel";
      ui_.status.hidden = false;
    } else {
      ui_.status.hidden = true;
    }
    for (var i = 0; i < ui_.modes.length; i++) {
      ui_.modes[i].classList.toggle("active", ui_.modes[i].dataset.mode === ui.onScreenControls);
    }
    ui_.list.innerHTML = "";
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

      var capturingThisKey = CONTROLS.isCapturing() === action.id;
      var capturingThisPad = CONTROLS.isCapturingPad() === action.id;
      var keyBtn = document.createElement("button");
      keyBtn.className = "settings-key" + (capturingThisKey ? " capturing" : "");
      keyBtn.textContent = capturingThisKey
        ? "press a key…"
        : CONTROLS.keysFor(action.id).map(CONTROLS.keyLabel).join(" / ");
      keyBtn.addEventListener("click", function () {
        var wasCapturingThis = CONTROLS.isCapturing() === action.id;
        CONTROLS.cancelPadCapture();
        settingAll = false;
        if (!wasCapturingThis) CONTROLS.beginKeyCapture(action.id, { onAssign: render, onCancel: render });
        else CONTROLS.cancelKeyCapture();
        render();
      });

      var padBtn = document.createElement("button");
      padBtn.className = "settings-pad" + (capturingThisPad ? " capturing" : "");
      padBtn.textContent = capturingThisPad ? "press a button…" : CONTROLS.padLabel(action.id);
      padBtn.title = "Controller button";
      padBtn.addEventListener("click", function () {
        var wasCapturingThis = CONTROLS.isCapturingPad() === action.id;
        CONTROLS.cancelKeyCapture();
        settingAll = false;
        if (!wasCapturingThis) CONTROLS.beginPadCapture(action.id, { onAssign: render });
        else CONTROLS.cancelPadCapture();
        render();
      });

      badges.appendChild(keyBtn);
      badges.appendChild(padBtn);
      row.appendChild(label);
      row.appendChild(badges);
      ui_.list.appendChild(row);
    });

    renderButtonMapping(ui_);
  }

  function renderButtonMapping(uiEls) {
    if (!uiEls.buttons) return;
    uiEls.buttons.innerHTML = "";
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
        b.className = "settings-choice" + (ui.buttons[slot] === choice.id ? " active" : "");
        b.textContent = choice.label;
        b.addEventListener("click", function () {
          ui.buttons[slot] = choice.id;
          persistUi();
          render();
        });
        choices.appendChild(b);
      });
      row.appendChild(label);
      row.appendChild(choices);
      uiEls.buttons.appendChild(row);
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
      b.className = "settings-choice" + (ui.padSide === pair[0] ? " active" : "");
      b.textContent = pair[1];
      b.addEventListener("click", function () {
        ui.padSide = pair[0];
        persistUi();
        render();
      });
      sides.appendChild(b);
    });
    sideRow.appendChild(sideLabel);
    sideRow.appendChild(sides);
    uiEls.buttons.appendChild(sideRow);
  }

  // Called by menu.js when the CONTROLS screen is shown.
  function refresh() {
    grab();
    CONTROLS.cancelKeyCapture();
    CONTROLS.cancelPadCapture();
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
    CONTROLS.cancelKeyCapture();
    CONTROLS.cancelPadCapture();
    captureQueue = [];
    settingAll = false;
    if (els) render();
  }

  return {
    isDown: CONTROLS.isDown,
    gamepad: CONTROLS.gamepad,
    showOnScreenControls: showOnScreenControls,
    isTouchDevice: CONTROLS.isTouchDevice,
    keysFor: CONTROLS.keysFor,
    // Which action an on-screen button performs: "primary" or "secondary".
    buttonAction: function (slot) { return ui.buttons[slot]; },
    buttonLabel: function (slot) {
      var id = ui.buttons[slot];
      for (var i = 0; i < BUTTON_CHOICES.length; i++) if (BUTTON_CHOICES[i].id === id) return BUTTON_CHOICES[i].label;
      return id;
    },
    padSide: function () { return ui.padSide; },
    open: open,
    refresh: refresh,
    cancelCapture: cancelCapture,
    // True only while a key press is being captured for a rebind — that is the
    // moment the game must not act on keys.
    isCapturing: CONTROLS.isCapturing,
    onChange: function (cb) { CONTROLS.onChange(cb); uiListeners.push(cb); }
  };
})();
