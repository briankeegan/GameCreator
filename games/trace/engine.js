// engine.js — all the rules for "Step in the Cat", with zero DOM. Pure
// functions over a plain state object so the same code runs in the browser
// (window.StepCatEngine) and under Node for tests (module.exports).
//
// The game: climb a grid of carpeted steps to the door at the top. Enamel
// pins are scattered on the steps; you must collect a target number to
// unlock the exit, so you can't just beeline up. A tuxedo cat (or two, or
// three) lounges on the stairs and shifts one step each turn — its next
// move is always telegraphed, so stepping on it is your mistake, never a
// cheap one. Land on a cat (or let one land on your step) and the run ends.
"use strict";

(function (root) {
  const DIRS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 },
    wait: { dr: 0, dc: 0 },
  };

  // Pin catalog: commons are low value, so the count you must collect and
  // the score you want to maximize pull in different directions — grab the
  // rare avocado when the route allows, settle for paws when it doesn't.
  const PIN_TYPES = [
    { type: "avocado", value: 3, weight: 1 },
    { type: "star", value: 2, weight: 2 },
    { type: "paw", value: 1, weight: 3 },
  ];

  function randInt(rng, n) {
    return Math.floor(rng() * n);
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function manhattan(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
  }

  function inBounds(state, r, c) {
    return r >= 0 && r < state.H && c >= 0 && c < state.W;
  }

  function catAt(cats, r, c, exceptIndex) {
    return cats.some((cat, i) => i !== exceptIndex && cat.r === r && cat.c === c);
  }

  function pinIndexAt(pins, r, c) {
    return pins.findIndex((p) => p.r === r && p.c === c);
  }

  function chaseProb(level) {
    // Cats get pushier as the climb goes on, but never fully deterministic —
    // there's always some wander to route around.
    return Math.min(0.15 + 0.1 * level, 0.6);
  }

  // Where a cat telegraphs its next step. Orthogonal, in-bounds, never onto
  // another cat. With a level-scaled chance it steps toward the player;
  // otherwise it wanders. Staying put is always a legal fallback.
  function chooseCatMove(state, catIndex, rng) {
    const cat = state.cats[catIndex];
    const options = [{ r: cat.r, c: cat.c }]; // waiting is always allowed
    for (const key of ["up", "down", "left", "right"]) {
      const d = DIRS[key];
      const r = cat.r + d.dr;
      const c = cat.c + d.dc;
      if (inBounds(state, r, c) && !catAt(state.cats, r, c, catIndex)) options.push({ r, c });
    }
    if (rng() < chaseProb(state.level)) {
      let best = options[0];
      let bestDist = manhattan(best, state.player);
      for (const o of options) {
        const dist = manhattan(o, state.player);
        if (dist < bestDist) {
          best = o;
          bestDist = dist;
        }
      }
      return best;
    }
    return options[randInt(rng, options.length)];
  }

  function randPinType(rng) {
    const total = PIN_TYPES.reduce((s, p) => s + p.weight, 0);
    let roll = randInt(rng, total);
    for (const p of PIN_TYPES) {
      if (roll < p.weight) return p;
      roll -= p.weight;
    }
    return PIN_TYPES[PIN_TYPES.length - 1];
  }

  // Build a fresh level. Board widens... actually stays 5 wide (phone-
  // friendly) and grows taller; pins and cats scale with the level number.
  function generateLevel(level, rng) {
    const W = 5;
    const H = 6 + Math.min(level - 1, 4); // 6 → 10
    const player = { r: H - 1, c: 2 };
    const exit = { r: 0, c: 2 };

    const free = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if ((r === player.r && c === player.c) || (r === exit.r && c === exit.c)) continue;
        free.push({ r, c });
      }
    }
    const bag = shuffle(free, rng);

    const pinCount = Math.min(5 + Math.min(level, 5), bag.length - 4);
    const pins = [];
    for (let i = 0; i < pinCount; i++) {
      const cell = bag.pop();
      const t = randPinType(rng);
      pins.push({ r: cell.r, c: cell.c, type: t.type, value: t.value });
    }

    const catCount = level >= 6 ? 3 : level >= 3 ? 2 : 1;
    const cats = [];
    // Cats start at least 3 steps from the player so a level never opens
    // with an unavoidable pounce.
    const catBag = bag.filter((cell) => manhattan(cell, player) >= 3);
    for (let i = 0; i < catCount && catBag.length; i++) {
      const cell = catBag.shift();
      cats.push({ r: cell.r, c: cell.c, next: { r: cell.r, c: cell.c } });
    }

    const pinTarget = Math.max(1, Math.ceil(pins.length * 0.6));

    const level_ = { W, H, player, exit, pins, cats, pinTarget, collected: 0 };
    // First telegraph for each cat.
    for (let i = 0; i < cats.length; i++) cats[i].next = chooseCatMove(level_, i, rng);
    return level_;
  }

  function loadLevel(state, level, rng) {
    const lvl = generateLevel(level, rng);
    state.level = level;
    state.W = lvl.W;
    state.H = lvl.H;
    state.player = lvl.player;
    state.exit = lvl.exit;
    state.pins = lvl.pins;
    state.cats = lvl.cats;
    state.pinTarget = lvl.pinTarget;
    state.collected = 0;
    state.turn = 1;
  }

  function createGame(rng = Math.random) {
    const state = {
      status: "playing", // "playing" | "lost"
      level: 1,
      score: 0,
      justAdvanced: false, // UI hint: a level was just cleared this action
      message: "",
    };
    loadLevel(state, 1, rng);
    state.message = "Reach the door — grab your pins, mind the cat.";
    return state;
  }

  // The one verb: a single player action. dir ∈ up/down/left/right/wait.
  // Returns the (mutated) state. Illegal moves (off the board) are no-ops
  // that don't burn a turn, so a mistimed tap never costs you.
  function move(state, dir, rng = Math.random) {
    state.justAdvanced = false;
    if (state.status !== "playing") return state;
    const d = DIRS[dir];
    if (!d) return state;

    const nr = state.player.r + d.dr;
    const nc = state.player.c + d.dc;
    if (dir !== "wait" && !inBounds(state, nr, nc)) return state; // off-board: ignored

    state.player = { r: nr, c: nc };

    // Stepped directly onto a lounging cat.
    if (catAt(state.cats, nr, nc, -1)) {
      state.status = "lost";
      state.message = "You stepped on the cat!";
      return state;
    }

    // Grab a pin if one's here.
    const pi = pinIndexAt(state.pins, nr, nc);
    if (pi >= 0) {
      const pin = state.pins.splice(pi, 1)[0];
      state.collected += 1;
      state.score += pin.value;
      state.message = `Pin! ${state.collected}/${state.pinTarget} collected.`;
    } else if (dir === "wait") {
      state.message = "You wait a beat…";
    } else {
      state.message = "";
    }

    // Reached the door with enough pins → next level.
    if (nr === state.exit.r && nc === state.exit.c) {
      if (state.collected >= state.pinTarget) {
        loadLevel(state, state.level + 1, rng);
        state.justAdvanced = true;
        state.message = `Top landing! On to Level ${state.level}.`;
        return state;
      }
      state.message = `The door's locked — collect ${state.pinTarget - state.collected} more pin(s).`;
    }

    // Now the cats take their telegraphed step.
    for (let i = 0; i < state.cats.length; i++) {
      state.cats[i].r = state.cats[i].next.r;
      state.cats[i].c = state.cats[i].next.c;
    }
    if (catAt(state.cats, state.player.r, state.player.c, -1)) {
      state.status = "lost";
      state.message = "The cat pounced onto your step!";
      return state;
    }

    // Re-telegraph.
    for (let i = 0; i < state.cats.length; i++) state.cats[i].next = chooseCatMove(state, i, rng);
    state.turn += 1;
    return state;
  }

  const api = {
    DIRS,
    PIN_TYPES,
    createGame,
    move,
    generateLevel,
    chooseCatMove,
    manhattan,
    inBounds,
    catAt,
    pinIndexAt,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.StepCatEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
