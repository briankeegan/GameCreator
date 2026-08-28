"""Head-to-head validation: does the search agent actually beat the greedy
one, decisively and consistently, playing by the same legal-swap rules?

This is a TURN-BASED proxy for the real (continuous, frame-driven) duel --
each side takes one swap, resolves it fully (matches/chains/garbage), and
whatever garbage it produced lands on the opponent's board before their
next turn. That drops frame-timing fidelity (attack travel time, health
drain, stop-time) on purpose: none of that changes WHICH SWAP is good, so
it doesn't need to be modeled to compare strategies. Ten thousand of these
proxy duels is what "unbeatable" gets proven against before anything gets
ported to panel-cpu.js.

Usage: python3 tournament.py [n_games]
"""

import sys
import random

from simulate import Board, HEIGHT, WIDTH, COLORS
from agents import GreedyAgent, SearchAgent


def new_board(rng):
    b = Board(WIDTH, HEIGHT, COLORS, rng)
    b.fill_random(rows=5)
    return b


def play_duel(agent_a, agent_b, rng, max_turns=800):
    board_a = new_board(rng)
    board_b = new_board(rng)
    score_a = score_b = 0
    turn = 0
    while turn < max_turns:
        turn += 1
        for (agent, my_board, other_board) in ((agent_a, board_a, board_b), (agent_b, board_b, board_a)):
            if my_board.topped_out():
                continue
            move = agent.choose(my_board)
            if move is None or move[0] == "raise":
                my_board.raise_board()
            else:
                my_board.swap(move[1], move[2])
                _chain, _combos, s, garbage = my_board.resolve()
                if agent is agent_a:
                    score_a += s
                else:
                    score_b += s
                for (w, h) in garbage:
                    other_board.add_garbage_rows(h)
            # keep feeding the bottom so the board doesn't just empty out
            if my_board.height_of(0) < 4 and not my_board.topped_out():
                my_board.fill_random(rows=1)
        if board_a.topped_out() and board_b.topped_out():
            return "draw", turn, score_a, score_b
        if board_a.topped_out():
            return "b", turn, score_a, score_b
        if board_b.topped_out():
            return "a", turn, score_a, score_b
    return "draw", turn, score_a, score_b


def run_match(agent_a, agent_b, n_games, seed=1):
    wins_a = wins_b = draws = 0
    total_score_a = total_score_b = 0
    for i in range(n_games):
        rng = random.Random(seed + i)
        agent_a.rng = rng
        agent_b.rng = rng
        winner, turns, sa, sb = play_duel(agent_a, agent_b, rng)
        total_score_a += sa
        total_score_b += sb
        if winner == "a":
            wins_a += 1
        elif winner == "b":
            wins_b += 1
        else:
            draws += 1
    return {
        "a_name": agent_a.name, "b_name": agent_b.name,
        "wins_a": wins_a, "wins_b": wins_b, "draws": draws,
        "n": n_games,
        "win_rate_a": wins_a / n_games,
        "avg_score_a": total_score_a / n_games,
        "avg_score_b": total_score_b / n_games,
    }


def report(result):
    print(f"{result['a_name']} vs {result['b_name']} over {result['n']} games:")
    print(f"  {result['a_name']} wins: {result['wins_a']} ({result['win_rate_a']*100:.1f}%)")
    print(f"  {result['b_name']} wins: {result['wins_b']}")
    print(f"  draws: {result['draws']}")
    print(f"  avg score  {result['a_name']}: {result['avg_score_a']:.0f}   {result['b_name']}: {result['avg_score_b']:.0f}")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    print("=== search (default/unbeatable-tier weights) vs greedy ===")
    report(run_match(SearchAgent(), GreedyAgent(), n))
