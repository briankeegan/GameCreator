"""One-sided survival stress test against the CORRECTED (block-aware
garbage physics) simulate.py -- fast to iterate in pure Python, unlike
shelling out to the real Node engine for every trial. Used to validate a
strategy change here BEFORE porting it to panel-cpu.js; stress_harness.js
is what confirms the ported version holds up against the real engine.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import random
from simulate import Board, WIDTH, HEIGHT, COLORS
from agents import SearchAgent


DECISION_COOLDOWN = 6  # frames between decisions -- matches SearchCpu's
                       # real-time danger-mode floor (panel-cpu.js), since
                       # calling choose() every single frame (as an earlier
                       # version of this test did) is both unrealistic and
                       # slow enough to make the sweep impractical.


def survive(agent, frames_per_attack, attack_width, attack_height, seed, max_frames):
    rng = random.Random(seed)
    agent.rng = rng
    board = Board(WIDTH, HEIGHT, COLORS, rng)
    board.fill_random(5)
    cooldown = 0
    for f in range(max_frames):
        if f > 0 and f % frames_per_attack == 0:
            board.add_garbage_rows(attack_height, width=attack_width)
            if board.topped_out():
                return {"survived": False, "framesAlive": f}
        if cooldown > 0:
            cooldown -= 1
        else:
            move = agent.choose(board)
            if move[0] == "raise":
                board.raise_board()
            else:
                board.swap(move[1], move[2])
                board.resolve()
            cooldown = DECISION_COOLDOWN
        if f % 30 == 0 and board.height_of(0) < 4 and not board.topped_out():
            board.fill_random(1)
        if board.topped_out():
            return {"survived": False, "framesAlive": f}
    return {"survived": True, "framesAlive": max_frames}


def sweep(agent_factory, configs, seeds=(1, 2, 3, 4, 5), max_frames=60 * 60 * 5):
    for (name, fpa, w, h) in configs:
        results = [survive(agent_factory(), fpa, w, h, s, max_frames) for s in seeds]
        n_survived = sum(1 for r in results if r["survived"])
        print(f"{name} -> {n_survived}/{len(seeds)} survived", results)


FAST_WEIGHTS = {"depth": 2, "beam": 5}  # for rapid exploration; validate winners at full depth before shipping


if __name__ == "__main__":
    CONFIGS = [
        ("light  (w3 every 3.0s)", 180, 3, 1),
        ("mod    (w4 every 2.0s)", 120, 4, 1),
        ("heavy  (w6 every 1.5s)", 90, 6, 1),
        ("relent (w6 every 1.0s)", 60, 6, 1),
    ]
    sweep(lambda: SearchAgent(weights=FAST_WEIGHTS), CONFIGS, seeds=(1, 2, 3), max_frames=60 * 60 * 2)
