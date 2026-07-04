// engine.js — rules for "Step in the Cat" (a.k.a. Trap the Cat). No DOM:
// pure functions over a plain state object so the same logic runs in the
// browser (window.StepCatEngine) and under Node for tests.
//
// The whole game in one sentence: the cat is loose on a hex grid of steps
// and bolts for the nearest edge to escape — each turn you drop an enamel
// pin to wall off one step, and you win by fencing it in before it slips
// out. You learn it in one move: tap a step, watch the cat run, cut off its
// exits. The strategy is reading which edge it's making for and walling that
// route a move ahead.
"use strict";

(function (root) {
  const W = 9;
  const H = 9;

  function keyOf(r, c) {
    return r + "," + c;
  }

  function inBounds(r, c) {
    return r >= 0 && r < H && c >= 0 && c < W;
  }

  function isEdge(r, c) {
    return r === 0 || r === H - 1 || c === 0 || c === W - 1;
  }

  // Odd-r offset hexes (pointy-top; odd rows nudged right). Six neighbors,
  // and which six depends on the row's parity.
  function neighbors(r, c) {
    const deltas =
      r % 2 === 0
        ? [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]]
        : [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
    const out = [];
    for (const [dr, dc] of deltas) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc)) out.push({ r: nr, c: nc });
    }
    return out;
  }

  // Breadth-first from the cat across open (un-pinned) steps toward the
  // nearest edge. Returns whether any edge is still reachable, the first
  // step of a shortest route to it, and that route's length.
  function findEscape(state) {
    const start = state.cat;
    if (isEdge(start.r, start.c)) return { reachable: true, next: null, dist: 0 };
    const seen = new Set([keyOf(start.r, start.c)]);
    // queue holds {r,c, first} — `first` is the first move made from the cat.
    let queue = neighbors(start.r, start.c)
      .filter((n) => !state.pins.has(keyOf(n.r, n.c)))
      .map((n) => ({ r: n.r, c: n.c, first: n, dist: 1 }));
    for (const q of queue) seen.add(keyOf(q.r, q.c));

    while (queue.length) {
      const next = [];
      for (const node of queue) {
        if (isEdge(node.r, node.c)) return { reachable: true, next: node.first, dist: node.dist };
        for (const nb of neighbors(node.r, node.c)) {
          const k = keyOf(nb.r, nb.c);
          if (seen.has(k) || state.pins.has(k)) continue;
          seen.add(k);
          next.push({ r: nb.r, c: nb.c, first: node.first, dist: node.dist + 1 });
        }
      }
      queue = next;
    }
    return { reachable: false, next: null, dist: Infinity };
  }

  function randInt(rng, n) {
    return Math.floor(rng() * n);
  }

  function createGame(rng = Math.random) {
    const cat = { r: (H - 1) / 2, c: (W - 1) / 2 }; // dead center (4,4)
    const pins = new Set();

    // Seed a few random walls so no two games play the same — but never on
    // the cat or the ring of steps right around it, so it always has room to
    // start running.
    const forbidden = new Set([keyOf(cat.r, cat.c)]);
    for (const n of neighbors(cat.r, cat.c)) forbidden.add(keyOf(n.r, n.c));
    const open = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (!forbidden.has(keyOf(r, c))) open.push({ r, c });
    const START_WALLS = 13;
    for (let i = 0; i < START_WALLS && open.length; i++) {
      const idx = randInt(rng, open.length);
      const cell = open.splice(idx, 1)[0];
      pins.add(keyOf(cell.r, cell.c));
    }

    return {
      W,
      H,
      cat,
      pins,
      status: "playing", // "playing" | "won" | "lost"
      pinsUsed: 0,
      catMoves: 0,
      message: "Wall the cat in before it reaches the edge.",
    };
  }

  // Drop a pin on an empty step, then the cat takes its escape step. Placing
  // on the cat, on an existing pin, or off-board is an ignored no-op.
  function placePin(state, r, c) {
    if (state.status !== "playing") return state;
    if (!inBounds(r, c)) return state;
    const k = keyOf(r, c);
    if (state.pins.has(k)) return state;
    if (state.cat.r === r && state.cat.c === c) return state;

    state.pins.add(k);
    state.pinsUsed += 1;

    const esc = findEscape(state);
    if (!esc.reachable) {
      state.status = "won";
      state.message = `Trapped! Fenced in with ${state.pinsUsed} pins.`;
      return state;
    }

    state.cat = { r: esc.next.r, c: esc.next.c };
    state.catMoves += 1;

    if (isEdge(state.cat.r, state.cat.c)) {
      state.status = "lost";
      state.message = "The cat slipped out the side!";
      return state;
    }

    state.message = esc.dist <= 1 ? "One step from the edge — cut it off!" : `The cat is ${esc.dist} steps from escaping.`;
    return state;
  }

  const api = {
    W,
    H,
    keyOf,
    inBounds,
    isEdge,
    neighbors,
    findEscape,
    createGame,
    placePin,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.StepCatEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
