"""Fast Python exploration of WHY the AI dies to Panel Attack's real
training-mode bursts (see training_harness.js's docstring for where the
exact numbers -- comboStorm 4x1, factory 6x2, largeGarbage 6x12, 50
attacks then a long gap -- came from: the actual source game).

Not frame-accurate (no health, no riseLock, no anti-stall punishment --
that's what training_harness.js validates against the real engine). What
this IS good for: fast iteration over STRATEGY variants, using the
'stuck' signal as a cheap proxy for the real death spiral confirmed by
diagnosis -- once no legal swap can match anything, the real AI is stuck
wiggling until panel-engine.js's anti-stall punishment kills it. Turns
survived before getting stuck (or running out of real material
entirely) is what these variants are compared on.

Usage: python3 training_survival.py [n_seeds]
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import random
from simulate import Board, WIDTH, HEIGHT, COLORS
from agents import SearchAgent, potential


def real_panel_count(board):
    return sum(1 for r in range(board.height) for c in range(board.width) if board.grid[r][c] > 0)


def has_any_match_available(board):
    for (r, c) in board.legal_swaps():
        trial = board.clone()
        trial.swap(r, c)
        chain, _combos, _score, _garbage = trial.resolve()
        if chain > 0:
            return True
    return False


class PeriodicRaiseAgent:
    """Same brain as SearchAgent, but during calm play (low fill, nothing
    productive found) raises every `raise_every` idle turns instead of
    only as an absolute last resort -- proactive material maintenance
    rather than pure reaction. Bounded (never raises above raise_ceiling
    fill ratio) so it can't repeat the self-inflicted top-out a naive
    always-raise strategy causes."""

    name = "periodic_raise"

    def __init__(self, weights=None, rng=None, raise_every=4, raise_ceiling=0.7):
        self.inner = SearchAgent(weights=weights, rng=rng)
        self.raise_every = raise_every
        self.raise_ceiling = raise_ceiling
        self._idle_streak = 0

    @property
    def rng(self):
        return self.inner.rng

    @rng.setter
    def rng(self, v):
        self.inner.rng = v

    def choose(self, board):
        move = self.inner.choose(board)
        if move[0] == "swap":
            trial = board.clone()
            trial.swap(move[1], move[2])
            chain, _combos, _score, _garbage = trial.resolve()
            if chain > 0:
                self._idle_streak = 0
                return move
        self._idle_streak += 1
        if self._idle_streak >= self.raise_every and board.fill_ratio() <= self.raise_ceiling:
            self._idle_streak = 0
            return ("raise",)
        return move


class GarbageFirstAgent:
    """Never plans, never holds for a bigger combo -- if ANY legal swap
    touches garbage, take the single BEST one (most garbage cleared, then
    biggest chain) immediately. Only falls back to the normal SearchAgent
    brain when nothing touches garbage at all. Tests the direct
    hypothesis: is patience/plan-building DELAYING garbage clears that
    are already available, letting the backlog grow faster than
    necessary?"""

    name = "garbage_first"

    def __init__(self, weights=None, rng=None):
        self.inner = SearchAgent(weights=weights, rng=rng)

    @property
    def rng(self):
        return self.inner.rng

    @rng.setter
    def rng(self, v):
        self.inner.rng = v

    def choose(self, board):
        best = None
        best_key = None
        for (r, c) in board.legal_swaps():
            trial = board.clone()
            trial.swap(r, c)
            chain, combos, _score, garbage = trial.resolve()
            if chain == 0:
                continue
            g_cells = sum(w * h for (w, h) in garbage)
            if g_cells == 0:
                continue
            key = (g_cells, chain, sum(combos))
            if best_key is None or key > best_key:
                best_key = key
                best = ("swap", r, c)
        if best is not None:
            return best
        return self.inner.choose(board)


def run_burst(agent, width, height, seed, calm_turns=15, max_burst_attacks=50, stuck_patience=6):
    """calm_turns of free play, then a burst of up to max_burst_attacks
    garbage drops, one per agent turn (mirrors the real engine's
    one-at-a-time drop rate closely enough for strategy comparison).
    Returns how many burst attacks were absorbed before the board got
    stuck (no legal swap matches anything) for `stuck_patience` turns in a
    row, or before topping out outright."""
    rng = random.Random(seed)
    agent.rng = rng
    board = Board(WIDTH, HEIGHT, COLORS, rng)
    board.fill_random(rows=7)  # STARTING_BOARD_HEIGHT in panel-engine.js

    for _ in range(calm_turns):
        if board.topped_out():
            return {"survivedAttacks": 0, "toppedOutInCalm": True}
        move = agent.choose(board)
        if move[0] == "raise":
            board.raise_board()
        else:
            board.swap(move[1], move[2])
            board.resolve()

    stuck_run = 0
    for attack_n in range(max_burst_attacks):
        board.add_garbage_rows(height, width=width)
        if board.topped_out() and not has_any_match_available(board):
            return {"survivedAttacks": attack_n, "toppedOutInCalm": False, "reason": "buried"}
        move = agent.choose(board)
        matched_something = False
        if move[0] == "raise":
            board.raise_board()
        else:
            board.swap(move[1], move[2])
            chain, _combos, _score, _garbage = board.resolve()
            matched_something = chain > 0
        stuck_run = 0 if matched_something else stuck_run + 1
        if stuck_run >= stuck_patience:
            return {"survivedAttacks": attack_n + 1, "toppedOutInCalm": False, "reason": "stuck"}
    return {"survivedAttacks": max_burst_attacks, "toppedOutInCalm": False, "reason": "absorbed_all"}


def sweep(agent_factory, name, configs, seeds):
    print(f"--- {name} ---")
    for (mode, w, h) in configs:
        total = 0
        reasons = {}
        for s in seeds:
            r = run_burst(agent_factory(), w, h, s)
            total += r["survivedAttacks"]
            reasons[r.get("reason", "calm_top_out")] = reasons.get(r.get("reason", "calm_top_out"), 0) + 1
        avg = total / len(seeds)
        print(f"  {mode:12s} (w{w}h{h}) -> avg {avg:.1f}/{50} attacks absorbed, outcomes={reasons}")


if __name__ == "__main__":
    n_seeds = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    seeds = list(range(1, n_seeds + 1))
    CONFIGS = [
        ("comboStorm", 4, 1),
        ("factory", 6, 2),
        ("largeGarbage", 6, 12),
    ]
    sweep(lambda: SearchAgent(), "baseline SearchAgent", CONFIGS, seeds)
    sweep(lambda: PeriodicRaiseAgent(), "periodic-raise (every 4 idle turns, <=70% fill)", CONFIGS, seeds)
    sweep(lambda: GarbageFirstAgent(), "garbage-first (never hold, take any garbage touch)", CONFIGS, seeds)
