// engine.js — rules for "Step in the Cat" (Trap the Cat, deluxe). No DOM:
// pure functions over a plain state object so the same logic runs in the
// browser (window.StepCatEngine) and under Node for tests.
//
// Core: the cat is loose on a hex staircase and pathfinds to the nearest
// edge to escape. You trap it — but not with identical walls. You hold a
// HAND of enamel pins, each a different tool, and choose which to spend and
// where:
//   • Wall (paw)     — block one step. Your bread and butter.
//   • Snare (star)   — block a step; if the cat is next to it, it's stunned
//                      and skips its next move.
//   • Lure (fish)    — no wall; the cat chases the fish on its next move
//                      instead of running for the edge. Bait it into a pocket.
//   • Tangle (yarn)  — block a step AND, for the cat's next move only, its
//                      open neighbours too — a wide one-turn net.
//   • Boulder (avocado) — block a step and one adjacent open step at once.
// Pins are drawn from a bag (walls common, tricks rare), so you plan around
// the hand you have. Win by sealing every route; lose if the cat reaches the
// edge.
"use strict";

(function (root) {
  const W = 9;
  const H = 9;
  const HAND_SIZE = 3;

  const PIN_TYPES = ["wall", "snare", "lure", "tangle", "boulder"];
  // How the draw bag is stocked — walls are the staple, tricks are scarce.
  const BAG_COUNTS = { wall: 10, snare: 3, lure: 3, tangle: 3, boulder: 3 };

  function keyOf(r, c) {
    return r + "," + c;
  }
  function inBounds(r, c) {
    return r >= 0 && r < H && c >= 0 && c < W;
  }
  function isEdge(r, c) {
    return r === 0 || r === H - 1 || c === 0 || c === W - 1;
  }
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

  // Generic BFS from the cat across open steps (not permanently pinned, not
  // in `extraBlocked`) to the nearest cell satisfying isTarget. Returns
  // whether one is reachable, the first step of a shortest route, and its
  // distance.
  function bfsToTargets(state, isTarget, extraBlocked) {
    const start = state.cat;
    const blocked = (r, c) => state.pins.has(keyOf(r, c)) || (extraBlocked && extraBlocked.has(keyOf(r, c)));
    if (isTarget(start.r, start.c)) return { reachable: true, next: null, dist: 0 };
    const seen = new Set([keyOf(start.r, start.c)]);
    let queue = [];
    for (const n of neighbors(start.r, start.c)) {
      if (blocked(n.r, n.c)) continue;
      seen.add(keyOf(n.r, n.c));
      queue.push({ r: n.r, c: n.c, first: n, dist: 1 });
    }
    while (queue.length) {
      const layer = [];
      for (const node of queue) {
        if (isTarget(node.r, node.c)) return { reachable: true, next: node.first, dist: node.dist };
        for (const nb of neighbors(node.r, node.c)) {
          const k = keyOf(nb.r, nb.c);
          if (seen.has(k) || blocked(nb.r, nb.c)) continue;
          seen.add(k);
          layer.push({ r: nb.r, c: nb.c, first: node.first, dist: node.dist + 1 });
        }
      }
      queue = layer;
    }
    return { reachable: false, next: null, dist: Infinity };
  }

  // Escape check used for winning: can the cat still reach any edge through
  // the PERMANENT walls alone (tangle/lure don't count)?
  function findEscape(state) {
    return bfsToTargets(state, (r, c) => isEdge(r, c), null);
  }

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

  function makeBag(rng) {
    const raw = [];
    for (const t of PIN_TYPES) for (let i = 0; i < BAG_COUNTS[t]; i++) raw.push(t);
    return shuffle(raw, rng);
  }
  function drawPin(state, rng) {
    if (state.bag.length === 0) state.bag = makeBag(rng);
    return state.bag.pop();
  }

  const EDGE_FILL = 0.6;
  const INTERIOR_WALLS = 8;

  function createGame(rng = Math.random, opts = {}) {
    const edgeFill = opts.edgeFill != null ? opts.edgeFill : EDGE_FILL;
    const interiorWalls = opts.interiorWalls != null ? opts.interiorWalls : INTERIOR_WALLS;
    const cat = { r: (H - 1) / 2, c: (W - 1) / 2 };
    const pins = new Set();

    const forbidden = new Set([keyOf(cat.r, cat.c)]);
    for (const n of neighbors(cat.r, cat.c)) forbidden.add(keyOf(n.r, n.c));
    const edgeCells = [];
    const interiorCells = [];
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        if (forbidden.has(keyOf(r, c))) continue;
        (isEdge(r, c) ? edgeCells : interiorCells).push({ r, c });
      }
    const edgeShuffled = shuffle(edgeCells, rng);
    const edgeCount = Math.round(edgeShuffled.length * edgeFill);
    for (let i = 0; i < edgeCount; i++) pins.add(keyOf(edgeShuffled[i].r, edgeShuffled[i].c));
    const open = interiorCells.slice();
    for (let i = 0; i < interiorWalls && open.length; i++) {
      const cell = open.splice(randInt(rng, open.length), 1)[0];
      pins.add(keyOf(cell.r, cell.c));
    }

    const state = {
      W,
      H,
      cat,
      pins,
      bag: makeBag(rng),
      hand: [],
      status: "playing", // "playing" | "won" | "lost"
      pinsUsed: 0,
      catMoves: 0,
      stunned: false,
      message: "Pick a pin, then a step. Wall the cat in before it escapes.",
    };
    for (let i = 0; i < HAND_SIZE; i++) state.hand.push(drawPin(state, rng));
    return state;
  }

  function addWall(state, r, c) {
    if (inBounds(r, c) && !(state.cat.r === r && state.cat.c === c)) state.pins.add(keyOf(r, c));
  }

  // Is a step a legal place to drop a pin? Open = in-bounds, not the cat,
  // not already walled.
  function isPlaceable(state, r, c) {
    return inBounds(r, c) && !state.pins.has(keyOf(r, c)) && !(state.cat.r === r && state.cat.c === c);
  }

  // Place the pin at hand[handIndex] on (r,c) with its effect, then the cat
  // takes its move. A no-op if the placement is illegal for that pin.
  function placePin(state, r, c, handIndex, rng = Math.random) {
    if (state.status !== "playing") return state;
    const type = state.hand[handIndex];
    if (!type) return state;
    if (!isPlaceable(state, r, c)) return state;

    let tangle = null;
    let lure = null;

    if (type === "wall") {
      addWall(state, r, c);
    } else if (type === "snare") {
      addWall(state, r, c);
      // Stun if the cat is right next to the snare.
      if (neighbors(r, c).some((n) => n.r === state.cat.r && n.c === state.cat.c)) state.stunned = true;
    } else if (type === "boulder") {
      addWall(state, r, c);
      // Also seal one adjacent open step — the one nearest the cat, so it's
      // useful for cutting a route.
      const opens = neighbors(r, c).filter((n) => isPlaceable(state, n.r, n.c));
      if (opens.length) {
        opens.sort((a, b) => Math.abs(a.r - state.cat.r) + Math.abs(a.c - state.cat.c) - (Math.abs(b.r - state.cat.r) + Math.abs(b.c - state.cat.c)));
        addWall(state, opens[0].r, opens[0].c);
      }
    } else if (type === "tangle") {
      addWall(state, r, c);
      tangle = new Set(neighbors(r, c).filter((n) => isPlaceable(state, n.r, n.c)).map((n) => keyOf(n.r, n.c)));
    } else if (type === "lure") {
      lure = { r, c }; // no wall — pure bait
    }

    // Spend the pin and draw a replacement.
    state.hand.splice(handIndex, 1);
    state.hand.push(drawPin(state, rng));
    state.pinsUsed += 1;
    state.lastPlaced = { r, c, type };

    // Winning is about PERMANENT walls only.
    if (!findEscape(state).reachable) {
      state.status = "won";
      state.message = `Trapped! Fenced in with ${state.pinsUsed} pins.`;
      return state;
    }

    // ---- the cat's move -------------------------------------------------
    if (state.stunned) {
      state.stunned = false;
      state.catMoves += 1;
      state.message = "Snared! The cat's stuck for a turn.";
      return state;
    }

    let step = null;
    let flavor = "";
    if (lure) {
      const toLure = bfsToTargets(state, (rr, cc) => rr === lure.r && cc === lure.c, tangle);
      if (toLure.reachable && toLure.next) {
        step = toLure.next;
        flavor = "The cat pounces after the fish!";
      }
    }
    if (!step) {
      const toEdge = bfsToTargets(state, (rr, cc) => isEdge(rr, cc), tangle);
      if (toEdge.reachable && toEdge.next) step = toEdge.next;
    }

    if (step) {
      state.cat = { r: step.r, c: step.c };
      state.catMoves += 1;
      if (isEdge(state.cat.r, state.cat.c)) {
        state.status = "lost";
        state.message = "The cat slipped out the side!";
        return state;
      }
      const esc = findEscape(state);
      state.message = flavor || (esc.dist <= 1 ? "One step from the edge — cut it off!" : `The cat is ${esc.dist} steps from escaping.`);
    } else {
      // Every route was blocked this turn (tangle net / dead end).
      state.catMoves += 1;
      state.message = tangle ? "Tangled up — the cat can't move!" : "The cat is boxed in for now.";
    }
    return state;
  }

  const api = {
    W,
    H,
    HAND_SIZE,
    PIN_TYPES,
    keyOf,
    inBounds,
    isEdge,
    neighbors,
    bfsToTargets,
    findEscape,
    isPlaceable,
    createGame,
    placePin,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.StepCatEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
