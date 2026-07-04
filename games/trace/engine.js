// engine.js — rules for "Step in the Cat", a pin-drafting duel. No DOM:
// pure functions over a plain state object so the same code runs in the
// browser (window.StepCatEngine) and under Node for tests.
//
// The game: a spread of enamel pins sits on the staircase. You and the Cat
// take turns DRAFTING one pin each into your own collection. Pins score by
// SETS — the more of one kind you own, the more each is worth (a triangular
// payoff: 1→1, 2→3, 3→6, 4→10…), so you commit to a couple of types and
// fight the Cat for them. The twist that earns the name: the top pin is
// resting ON the sleeping cat, worth DOUBLE — but every time you lift one,
// the odds you wake the cat climb, and waking it ends the game where it
// stands. Best collection when the pins run out wins.
"use strict";

(function (root) {
  const PIN_TYPES = ["avocado", "star", "paw", "fish", "yarn"];
  const COPIES_PER_TYPE = 6; // 30-pin draft
  const DISPLAY_SIZE = 5;
  const WAKE_STEP = 0.25; // each on-cat grab adds this much wake risk

  function tri(n) {
    return (n * (n + 1)) / 2; // set value: 1,3,6,10,15,...
  }

  function score(collection) {
    return PIN_TYPES.reduce((s, t) => s + tri(collection[t] || 0), 0);
  }

  function emptyCollection() {
    const c = {};
    for (const t of PIN_TYPES) c[t] = 0;
    return c;
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Refill the spread from the deck and re-mark the on-cat pin (always the
  // front of the row — the one the cat is sleeping on).
  function fillDisplay(state) {
    while (state.display.length < DISPLAY_SIZE && state.deck.length) {
      state.display.push({ type: state.deck.pop() });
    }
    for (let i = 0; i < state.display.length; i++) state.display[i].onCat = i === 0;
  }

  function createGame(rng = Math.random) {
    const raw = [];
    for (const t of PIN_TYPES) for (let i = 0; i < COPIES_PER_TYPE; i++) raw.push(t);
    const state = {
      status: "playing", // "playing" | "over"
      deck: shuffle(raw, rng),
      display: [],
      you: emptyCollection(),
      cat: emptyCollection(),
      napChance: 0,
      woke: false,
      result: null, // "you" | "cat" | "tie"
      youScore: 0,
      catScore: 0,
      lastYou: null,
      lastCat: null,
      message: "Draft a pin. The one on the cat is worth double — if you dare.",
    };
    fillDisplay(state);
    return state;
  }

  // The wake risk the NEXT on-cat grab would face (for the UI to show).
  function nextWakeRisk(state) {
    return Math.min(1, state.napChance + WAKE_STEP);
  }

  function endGame(state) {
    state.status = "over";
    state.youScore = score(state.you);
    state.catScore = score(state.cat);
    state.result = state.youScore > state.catScore ? "you" : state.catScore > state.youScore ? "cat" : "tie";
    if (state.woke) state.message = "You woke the cat! The game ends here.";
    else if (state.result === "you") state.message = "The pins are gone — your collection wins!";
    else if (state.result === "cat") state.message = "The pins are gone — the cat out-collected you.";
    else state.message = "The pins are gone — a dead heat.";
    return state;
  }

  // The cat's pick: greedily maximize its own set gain, breaking ties toward
  // denying whatever you're stacking. It happily takes the double on-cat pin
  // but never risks waking itself.
  function catChoose(state) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < state.display.length; i++) {
      const pin = state.display[i];
      const add = pin.onCat ? 2 : 1;
      const have = state.cat[pin.type];
      const gain = tri(have + add) - tri(have);
      const denial = 0.5 * state.you[pin.type];
      const val = gain + denial;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function takePin(collection, pin) {
    collection[pin.type] += pin.onCat ? 2 : 1;
  }

  // A full round: you draft display[index], then the cat drafts, then the
  // spread refills. Returns the mutated state. Taking the on-cat pin may end
  // the game early by waking the cat.
  function draft(state, index, rng = Math.random) {
    if (state.status !== "playing") return state;
    if (index < 0 || index >= state.display.length) return state;

    const yours = state.display.splice(index, 1)[0];
    takePin(state.you, yours);
    state.lastYou = { type: yours.type, onCat: yours.onCat };
    state.lastCat = null;

    if (yours.onCat) {
      state.napChance = Math.min(1, state.napChance + WAKE_STEP);
      if (rng() < state.napChance) {
        state.woke = true;
        return endGame(state); // you got the pin, but that's the last move
      }
    }

    fillDisplay(state);

    // Cat's response (if any pins remain).
    if (state.display.length > 0) {
      const ci = catChoose(state);
      const theirs = state.display.splice(ci, 1)[0];
      takePin(state.cat, theirs);
      state.lastCat = { type: theirs.type, onCat: theirs.onCat };
      fillDisplay(state);
    }

    if (state.display.length === 0 && state.deck.length === 0) return endGame(state);

    const risk = Math.round(nextWakeRisk(state) * 100);
    state.message = `Your sets: ${score(state.you)} · Cat: ${score(state.cat)} · wake risk ${risk}%`;
    return state;
  }

  const api = {
    PIN_TYPES,
    COPIES_PER_TYPE,
    DISPLAY_SIZE,
    tri,
    score,
    createGame,
    draft,
    catChoose,
    nextWakeRisk,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.StepCatEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
