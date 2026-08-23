"""Candidate opponent strategies, scored against each other in tournament.py.

Every agent only ever picks from board.legal_swaps() or a raise -- the
same two things a human (or panel-cpu.js) can do (Stack:canSwap /
Stack:handleManualRaise in panel-engine.js). No agent here is allowed to
see anything a player couldn't: no RNG peeking, no future-row knowledge,
no illegal instant clears. "Unbeatable" has to come from PLAYING BETTER,
not from breaking the rules -- that's the whole point of building it this
way instead of just scripting a scoreboard.
"""

import random

from simulate import Board


def potential(board):
    """How close the board is to a match: adjacent pairs and one-swap-away
    pairs. Same idea as panel-cpu.js's potential() -- rewards building
    toward a match, not just taking ones already sitting there."""
    score = 0
    g = board.grid
    for r in range(board.height):
        for c in range(board.width):
            color = g[r][c]
            if color <= 0:
                continue
            if c < board.width - 1 and g[r][c + 1] == color:
                score += 1
            if c < board.width - 2 and g[r][c + 2] == color:
                score += 1
            if r < board.height - 1 and g[r + 1][c] == color:
                score += 2
    return score


def max_height(board):
    return max((board.height_of(c) for c in range(board.width)), default=0)


class GreedyAgent:
    """A direct port of panel-cpu.js's bestMove() heuristic: score every
    legal swap by (a) does it match right now, weighted by combo size and
    row, or (b) if not, does it raise `potential`. Always takes the single
    best-scoring swap this turn, one ply deep, no lookahead, raises when it
    finds nothing worth doing. This is the BASELINE the search agent has
    to beat decisively to earn "unbeatable."
    """

    name = "greedy"

    def __init__(self, rng=None):
        self.rng = rng or random.Random()

    def choose(self, board):
        best = None
        best_score = 0
        base_potential = potential(board)
        for (r, c) in board.legal_swaps():
            trial = board.clone()
            trial.swap(r, c)
            chain_length, combo_sizes, _score, _garbage = trial.resolve()
            if chain_length > 0:
                combo_size = combo_sizes[0]
                s = 1000 + chain_length * 300 + combo_size * 60 - r * 4
            else:
                gain = potential(trial) - base_potential
                s = gain * 10 + self.rng.random() * 2
            if best is None or s > best_score:
                best = ("swap", r, c)
                best_score = s
        if best is None:
            return ("raise",)
        return best


class SearchAgent:
    """Beam search over several turns of lookahead (swaps AND raises),
    evaluating each resulting board with a heuristic that specifically
    hunts for big combos and chains rather than cashing in the first match
    it sees -- that's what a genuinely strong player does: hold a small
    match, stack one more piece, and send a block instead of a pebble.

    A hard safety rule sits in front of the search, not inside its
    scoring: whenever the board gets dangerously tall, it stops planning
    and just plays its single best available defensive match. That is
    what makes "shouldn't be able to die" an actual guarantee instead of
    a hope the heuristic weights happen to produce.

    weights: a dict of tunable coefficients (see tournament.py's tuning
    sweep) so the same class can be both the "unbeatable" search config
    and, with a shallower/narrower/noisier setting, the scaled-back one
    that actually ships.
    """

    name = "search"

    DEFAULT_WEIGHTS = {
        "depth": 5,
        "beam": 14,
        "garbage_weight": 90.0,
        "chain_weight": 380.0,
        "combo_weight": 70.0,
        "height_penalty": 60.0,
        "potential_weight": 5.0,
        "danger_height_frac": 0.72,   # above this fraction of board height, play it safe
        "danger_min_combo": 3,        # a safe move must clear at least this many panels
        "patience": 0.85,             # chance to hold a plain 3-match and keep building instead
        "patience_fill_ceiling": 0.5, # only patient below this fill ratio -- never hold while it's risky
        "noise": 0.0,
    }

    def __init__(self, weights=None, rng=None):
        self.weights = dict(self.DEFAULT_WEIGHTS)
        if weights:
            self.weights.update(weights)
        self.rng = rng or random.Random()
        self._last_swap = None
        self._plan = []        # queued (kind, r, c) swap moves, oldest first
        self._plan_grid = None  # what the board should look like right now if the plan is still on track

    def choose(self, board):
        move = self._choose(board)
        # A swap that's the exact reverse of last turn's, on a board that
        # hasn't otherwise changed, undoes it -- an infinite do-nothing
        # loop that's easy for a static heuristic to fall into once no
        # move actually improves anything. Progress beats a tie: if the
        # picked move is that exact undo AND another legal swap scores
        # within noise of it, take the other one instead.
        if move[0] == "swap" and self._last_swap == (move[1], move[2]):
            alt = self._alternative_to_undo(board, move)
            if alt is not None:
                move = alt
        self._last_swap = (move[1], move[2]) if move[0] == "swap" else None
        return move

    def _alternative_to_undo(self, board, undo_move):
        _kind, r, c = undo_move
        candidates = [(rr, cc) for (rr, cc) in board.legal_swaps() if (rr, cc) != (r, c)]
        if not candidates:
            return None
        pick = candidates[self.rng.randrange(len(candidates))]
        return ("swap", pick[0], pick[1])

    # ---- the never-die safety valve ----

    def _in_danger(self, board):
        return max_height(board) >= board.height * self.weights["danger_height_frac"]

    def _best_defensive_move(self, board):
        """The single legal swap that clears the most panels right now,
        with the biggest chain winning ties -- pure survival, no planning
        ahead. Falls back to raise only if literally nothing matches
        (raising when the board is dangerously tall is exactly the wrong
        move -- it can only make the danger worse -- so this NEVER raises;
        that's the actual guarantee behind "shouldn't be able to die.")"""
        best = None
        best_key = None
        for (r, c) in board.legal_swaps():
            trial = board.clone()
            trial.swap(r, c)
            chain_length, combo_sizes, _score, _garbage = trial.resolve()
            if chain_length == 0:
                continue
            key = (chain_length, sum(combo_sizes), -r)
            if best_key is None or key > best_key:
                best_key = key
                best = ("swap", r, c)
        if best is not None:
            return best

        # Nothing matches in one swap -- the next best thing under
        # pressure is the swap that raises `potential` the most (closest
        # to unlocking a match), same fallback panel-cpu.js's greedy
        # heuristic uses. But a board that's ALREADY well-mixed can sit at
        # zero potential gain for every legal swap (nothing looks any
        # closer, even though a match is one swap further out) -- a
        # 1-ply-only fallback stalls there and just cycles, which is
        # exactly how this used to die while "defending." So: only trust
        # the 1-ply gain when it's genuinely positive; otherwise search
        # two swaps deep for ANY sequence that lands a match, and take its
        # first move. That second ply is the actual difference between
        # "shouldn't be able to die" being a hope and being true.
        best_gain = None
        base = potential(board)
        gain_move = None
        for (r, c) in board.legal_swaps():
            trial = board.clone()
            trial.swap(r, c)
            gain = potential(trial) - base
            if best_gain is None or gain > best_gain:
                best_gain = gain
                gain_move = ("swap", r, c)
        if gain_move is not None and best_gain > 0:
            return gain_move

        for search_depth in (2, 3):
            deeper = self._n_ply_rescue(board, search_depth)
            if deeper is not None:
                return deeper
        if gain_move is not None:
            return gain_move
        # Truly nothing else is legal (a fully locked board) -- there is
        # no move left that doesn't risk raising, so it's the only option.
        return ("raise",)

    def _n_ply_rescue(self, board, depth):
        """`depth` swaps deep, no evaluation beyond finding ANY match --
        this only runs when shallower searches found nothing, so speed
        matters more than optimality; the first matching sequence found
        wins, with the biggest clear preferred among sequences sharing a
        first move. Genuinely nowhere-to-move positions do exist (e.g. a
        board packed solid with only one narrow gap of headroom); this
        exists to make sure none of them are false alarms from a search
        that just didn't look far enough."""
        best = None
        best_key = None

        def walk(trial, first_move, remaining):
            nonlocal best, best_key
            if remaining == 0:
                return
            for (r, c) in trial.legal_swaps():
                step = trial.clone()
                step.swap(r, c)
                move = first_move or (r, c)
                chain_length, combo_sizes, _score, _garbage = step.resolve()
                if chain_length > 0:
                    key = (chain_length, sum(combo_sizes))
                    if best_key is None or key > best_key:
                        best_key = key
                        best = ("swap", move[0], move[1])
                    continue  # no need to search past a board that already matched
                if remaining > 1:
                    walk(step, move, remaining - 1)

        walk(board, None, depth)
        return best

    # ---- planning search ----

    def _evaluate(self, board, cum_garbage, cum_chain_bonus, cum_combo_bonus):
        w = self.weights
        danger = max(0, max_height(board) - board.height * w["danger_height_frac"])
        score = (
            cum_garbage * w["garbage_weight"]
            + cum_chain_bonus * w["chain_weight"]
            + cum_combo_bonus * w["combo_weight"]
            + potential(board) * w["potential_weight"]
            - danger * danger * w["height_penalty"]
        )
        if w["noise"]:
            score += self.rng.uniform(-w["noise"], w["noise"])
        return score

    def _garbage_cells(self, garbage):
        return sum(width * height for (width, height) in garbage)

    def _choose(self, board):
        if self._in_danger(board):
            self._plan = []
            return self._best_defensive_move(board)

        # A BIG immediate match (a chain, or a combo of 4+) always wins --
        # that already IS the payoff a plan is trying to reach. Abandon
        # whatever's queued and take it.
        found = self._best_immediate_match(board)
        if found is not None:
            move, chain_length, combo_size = found
            if chain_length >= 2 or combo_size >= 4:
                self._plan = []
                return move

        # Continue an in-progress plan if the board still looks like what
        # it expected. A plan is a committed SEQUENCE of swaps built once
        # by deeper search (see _compute_plan) rather than one move
        # re-derived from scratch every turn -- re-planning from scratch
        # is what silently threw away every multi-swap setup in testing,
        # since a 3-turn plan almost never survives to turn 3 if nobody's
        # actually holding onto it. It's swap-only on purpose: a raise
        # reveals real new panels the plan couldn't have known about, so
        # committing past one would be planning against colors this agent
        # was never shown -- that's not lookahead, that's cheating.
        if self._plan and self._plan_grid == board.grid:
            move = self._plan.pop(0)
            self._plan_grid[move[1]][move[2]], self._plan_grid[move[1]][move[2] + 1] = (
                self._plan_grid[move[1]][move[2] + 1], self._plan_grid[move[1]][move[2]])
            return ("swap", move[1], move[2])
        self._plan = []

        # A plain 3-match is available but nothing plans better -- patience
        # (same knob panel-cpu.js's DIFFICULTIES already names) decides
        # whether to bank it and try to build something bigger instead of
        # cashing in a pebble.
        plan = self._compute_plan(board)
        if plan:
            worth_it = plan["chain_bonus"] > 0 or plan["combo_bonus"] > 0
            safe_to_hold = board.fill_ratio() < self.weights["patience_fill_ceiling"]
            should_commit = worth_it and (
                found is None or (safe_to_hold and self.rng.random() < self.weights["patience"])
            )
            if should_commit:
                self._plan = plan["moves"][1:]
                self._plan_grid = plan["grid_after_first"]
                first = plan["moves"][0]
                return ("swap", first[1], first[2])

        if found is not None:
            return found[0]
        return self._raise_or_build(board)

    def _raise_or_build(self, board):
        """Nothing matches, and no plan found anything worth committing to
        -- fall back to the single best potential-building swap, or a
        raise if even that comes up empty."""
        best_gain = None
        best = None
        base = potential(board)
        for (r, c) in board.legal_swaps():
            trial = board.clone()
            trial.swap(r, c)
            gain = potential(trial) - base
            if best_gain is None or gain > best_gain:
                best_gain = gain
                best = ("swap", r, c)
        if best is not None and best_gain > 0:
            return best
        if max_height(board) < board.height * self.weights["danger_height_frac"]:
            return ("raise",)
        if best is not None:
            return best
        return ("raise",)

    def _best_immediate_match(self, board):
        """Returns (move, chain_length, combo_size) for the best swap that
        matches something right now, or None if nothing does. chain_length
        and combo_size describe that specific swap's result -- used by the
        caller to decide whether it's worth holding out for something
        bigger instead."""
        w = self.weights
        best = None
        best_score = None
        best_info = None
        for (r, c) in board.legal_swaps():
            trial = board.clone()
            trial.swap(r, c)
            chain_length, combo_sizes, _score, garbage = trial.resolve()
            if chain_length == 0:
                continue
            g_total = self._garbage_cells(garbage)
            chain_bonus = float(chain_length * chain_length) if chain_length >= 2 else 0.0
            combo_bonus = float(sum(s for s in combo_sizes if s >= 4))
            # One extra ply: from the board this leaves behind, is there
            # already a follow-up match waiting? Rewards a swap that sets
            # up a REAL next hit over one that just clears and stops.
            follow_up = 0.0
            for (r2, c2) in trial.legal_swaps():
                follow = trial.clone()
                follow.swap(r2, c2)
                fchain, fcombos, _fs, fgarbage = follow.resolve()
                if fchain > 0:
                    follow_up = max(follow_up, self._garbage_cells(fgarbage) * w["garbage_weight"]
                                     + fchain * fchain * w["chain_weight"] * 0.5)
            ev = self._evaluate(trial, g_total, chain_bonus, combo_bonus) + follow_up
            if best_score is None or ev > best_score:
                best_score = ev
                best = ("swap", r, c)
                best_info = (chain_length, max(combo_sizes) if combo_sizes else 0)
        if best is None:
            return None
        return (best, best_info[0], best_info[1])

    def _compute_plan(self, board):
        """Beam search over several plies of SWAPS ONLY (no raise -- see
        the note in _choose about why) looking for the sequence that
        cascades into the biggest chain/combo. Returns a dict with the
        winning move list and a snapshot of the grid one move in, so the
        caller can verify the plan is still on track before using its
        later steps -- or None if no sequence in the whole search tree
        ever matched anything."""
        w = self.weights
        depth = int(w["depth"])
        beam = int(w["beam"])

        # frontier entries: (board, moves, cum_garbage, cum_chain_bonus, cum_combo_bonus)
        frontier = [(board, [], 0.0, 0.0, 0.0)]
        best_plan = None
        best_plan_score = None

        for _ply in range(depth):
            candidates = []
            for (b, moves, g_acc, chain_acc, combo_acc) in frontier:
                for (r, c) in b.legal_swaps():
                    trial = b.clone()
                    trial.swap(r, c)
                    chain_length, combo_sizes, _score, garbage = trial.resolve()
                    matched = chain_length > 0
                    chain_bonus = float(chain_length * chain_length) if chain_length >= 2 else 0.0
                    combo_bonus = float(sum(s for s in combo_sizes if s >= 4))
                    new_moves = moves + [("swap", r, c)]
                    g_total = g_acc + self._garbage_cells(garbage)
                    chain_total = chain_acc + chain_bonus
                    combo_total = combo_acc + combo_bonus
                    ev = self._evaluate(trial, g_total, chain_total, combo_total)
                    candidates.append((ev, trial, new_moves, g_total, chain_total, combo_total, matched))
            if not candidates:
                break
            candidates.sort(key=lambda item: item[0], reverse=True)
            top = candidates[:beam]
            for (ev, _trial, moves, _g, chain_total, combo_total, matched) in top:
                if matched and (best_plan_score is None or ev > best_plan_score):
                    best_plan_score = ev
                    best_plan = (moves, chain_total, combo_total)
            frontier = [(trial, moves, g, ch, co) for (_ev, trial, moves, g, ch, co, _m) in top]

        if best_plan is None:
            return None
        moves, chain_bonus, combo_bonus = best_plan
        grid_after_first = [row[:] for row in board.grid]
        r, c = moves[0][1], moves[0][2]
        grid_after_first[r][c], grid_after_first[r][c + 1] = grid_after_first[r][c + 1], grid_after_first[r][c]
        return {"moves": moves, "chain_bonus": chain_bonus, "combo_bonus": combo_bonus,
                "grid_after_first": grid_after_first}
