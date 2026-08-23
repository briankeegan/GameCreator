"""Puzzle Attack -- a LOGICAL (timer-free) board simulator for AI design.

panel-engine.js is the frame-accurate reference (ported 1:1 from
briankeegan/panel-game). This module is not that -- it deliberately skips
hover/pop timers and simulates only what an AI needs to PLAN: swap two
adjacent panels, let gravity settle everything, resolve matches, repeat
until nothing more falls into place (that repeat loop is what a "chain" is
here), and score the result the same way the real engine does. That's
enough to compare candidate moves and pick the best one; it is NOT enough
to replace panel-engine.js, and nothing in this directory ships to the
browser -- see build_ai.py, which reads the tuned weights this module's
tournament produces and writes them into panel-cpu.js.

Board convention: rows 0..height-1, row 0 is the BOTTOM (matches
panel-engine.js's row-1-is-bottom convention). Colors 1..N; 0 is empty.
"""

import copy
import random

WIDTH = 6
HEIGHT = 12
COLORS = 5  # matches a mid-level board (LEVELS[2].colors in panel-engine.js)

# checkMatches.lua's TA score tables, same values already verified 1:1 in
# panel-engine.js (SCORE_COMBO_TA / SCORE_CHAIN_TA).
SCORE_COMBO_TA = [0, 0, 0, 0, 20, 30, 50, 60, 70, 80, 100, 140, 170, 210, 250,
                  290, 340, 390, 440, 490, 550, 610, 680, 750, 820, 900, 980,
                  1060, 1150, 1240, 1330]
SCORE_CHAIN_TA = [0, 0, 50, 80, 150, 300, 400, 500, 700, 900, 1100, 1300, 1500, 1800]

# checkMatches.lua's combo -> garbage width table (comboGarbage in
# panel-engine.js) and chain -> garbage height rule (chain length N sends a
# width-6 block N-1 rows tall, starting at chain 2).
COMBO_GARBAGE = {
    4: [3], 5: [4], 6: [5], 7: [6], 8: [3, 4], 9: [4, 4], 10: [5, 5],
    11: [5, 6], 12: [6, 6],
}


def combo_garbage(size):
    if size in COMBO_GARBAGE:
        return list(COMBO_GARBAGE[size])
    if size > 12:
        # panel-engine.js's comboGarbage keeps stacking +1 width pieces past
        # the table's end, same shape as size 12's pair.
        extra = size - 12
        return [6, 6 + extra]
    return []


def chain_garbage_height(chain_length):
    return max(0, chain_length - 1)


class Board:
    """A width x height grid plus the swap/cascade rules."""

    def __init__(self, width=WIDTH, height=HEIGHT, colors=COLORS, rng=None, grid=None):
        self.width = width
        self.height = height
        self.colors = colors
        self.rng = rng or random.Random()
        if grid is not None:
            self.grid = [row[:] for row in grid]
        else:
            self.grid = [[0] * width for _ in range(height)]

    def clone(self):
        # A hypothetical trial board gets its OWN randomness, never the
        # live game's -- speculative "what if I raised here" planning must
        # not see (or consume) the real upcoming panel colors any more
        # than a human player could. Only a board actually played for
        # real should ever draw from the shared game RNG.
        return Board(self.width, self.height, self.colors, random.Random(), self.grid)

    # ---- construction helpers ----

    def fill_random(self, rows):
        """Fills the bottom `rows` rows with a board that has no existing
        match (mirrors the reference's row-generation bans well enough for
        training data -- exact 1:1 fidelity doesn't matter here, only that
        it's a plausible, matchless starting position)."""
        for r in range(rows):
            for c in range(self.width):
                banned = set()
                if r >= 2 and self.grid[r - 1][c] == self.grid[r - 2][c] and self.grid[r - 1][c] != 0:
                    banned.add(self.grid[r - 1][c])
                if c >= 2 and self.grid[r][c - 1] == self.grid[r][c - 2] and self.grid[r][c - 1] != 0:
                    banned.add(self.grid[r][c - 1])
                choices = [x for x in range(1, self.colors + 1) if x not in banned]
                self.grid[r][c] = self.rng.choice(choices)

    def height_of(self, col):
        h = 0
        for r in range(self.height - 1, -1, -1):
            if self.grid[r][col] != 0:
                h = r + 1
                break
        return h

    def fill_ratio(self):
        highest = max((self.height_of(c) for c in range(self.width)), default=0)
        return highest / self.height

    def topped_out(self):
        return any(self.grid[self.height - 1][c] != 0 for c in range(self.width))

    # ---- legality ----

    def legal_swaps(self):
        out = []
        for r in range(self.height):
            for c in range(self.width - 1):
                a, b = self.grid[r][c], self.grid[r][c + 1]
                if a < 0 or b < 0:
                    continue  # garbage never allows a swap, either side
                if a == 0 and b == 0:
                    continue
                if a == b:
                    continue
                out.append((r, c))
        return out

    # ---- gravity + matching ----

    def _apply_gravity(self):
        moved = False
        for c in range(self.width):
            stack = [self.grid[r][c] for r in range(self.height) if self.grid[r][c] != 0]
            if len(stack) != sum(1 for r in range(self.height) if self.grid[r][c] != 0):
                pass
            for r in range(self.height):
                new_val = stack[r] if r < len(stack) else 0
                if self.grid[r][c] != new_val:
                    moved = True
                self.grid[r][c] = new_val
        return moved

    def _find_matches(self):
        matched = set()
        for r in range(self.height):
            run = []
            for c in range(self.width + 1):
                color = self.grid[r][c] if c < self.width else 0
                if color > 0 and (not run or self.grid[r][run[-1]] == color):
                    run.append(c)
                else:
                    if len(run) >= 3:
                        matched.update((r, cc) for cc in run)
                    run = [c] if color > 0 else []
        for c in range(self.width):
            run = []
            for r in range(self.height + 1):
                color = self.grid[r][c] if r < self.height else 0
                if color > 0 and (not run or self.grid[run[-1]][c] == color):
                    run.append(r)
                else:
                    if len(run) >= 3:
                        matched.update((rr, c) for rr in run)
                    run = [r] if color > 0 else []
        return matched

    def _connected_garbage(self, matched):
        """A match that touches a garbage cell clears the whole connected
        garbage block it's part of, not just that one cell -- same shape
        as the real engine's "any panel in a garbage block matches, the
        whole block clears" rule (getConnectedGarbagePanels in
        panel-engine.js), just without its exact per-block bookkeeping.
        Without this, incoming garbage is a permanent, un-clearable wall
        in this simplified model -- which starved every search agent
        tested against it into a real, unrecoverable box-in."""
        seen = set()
        stack = []
        for (r, c) in matched:
            for (rr, cc) in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= rr < self.height and 0 <= cc < self.width and self.grid[rr][cc] < 0:
                    stack.append((rr, cc))
        while stack:
            (r, c) = stack.pop()
            if (r, c) in seen:
                continue
            seen.add((r, c))
            for (rr, cc) in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= rr < self.height and 0 <= cc < self.width and self.grid[rr][cc] < 0 and (rr, cc) not in seen:
                    stack.append((rr, cc))
        return seen

    def resolve(self):
        """Repeatedly settles gravity and clears matches until stable.
        Returns (chain_length, combo_sizes, score, garbage_sent) --
        chain_length is 0 if nothing matched at all (a wasted swap)."""
        chain_length = 0
        combo_sizes = []
        score = 0
        garbage = []  # list of (width, height)

        # settle gravity once before the first match check (a swap can
        # leave a hole mid-column that needs to drop first).
        self._apply_gravity()

        while True:
            matched = self._find_matches()
            if not matched:
                break
            chain_length += 1
            combo_size = len(matched)
            combo_sizes.append(combo_size)
            cleared_garbage = self._connected_garbage(matched)
            for (r, c) in matched:
                self.grid[r][c] = 0
            for (r, c) in cleared_garbage:
                self.grid[r][c] = 0

            # scoring, 1:1 with checkMatches.lua's updateScoreWithBonus.
            chain_bonus_index = chain_length if chain_length <= 13 else 0
            score += SCORE_CHAIN_TA[chain_bonus_index]
            if combo_size > 3:
                score += SCORE_COMBO_TA[min(30, combo_size)]
            score += 10 * combo_size

            for w in combo_garbage(combo_size):
                garbage.append((w, 1))

            self._apply_gravity()

        if chain_length >= 2:
            garbage.append((self.width, chain_garbage_height(chain_length)))

        return chain_length, combo_sizes, score, garbage

    def swap(self, row, col):
        self.grid[row][col], self.grid[row][col + 1] = self.grid[row][col + 1], self.grid[row][col]

    def raise_board(self):
        """One manual-raise tick: shift everything up a row and fill a
        fresh matchless row at the bottom (mirrors Stack:newRow's shape,
        not its exact frame timing -- see buildStartingBoard/fillNewRow
        in panel-engine.js for the 1:1 version). This is what lets an
        agent deliberately cycle in new panels to dig for a bigger chain
        instead of only ever reacting to whatever's already on screen."""
        if self.topped_out():
            return False
        for r in range(self.height - 1, 0, -1):
            self.grid[r] = self.grid[r - 1][:]
        for c in range(self.width):
            banned = set()
            if self.grid[1][c] > 0:
                banned.add(self.grid[1][c])
            if c >= 1 and self.grid[0][c - 1] > 0 and (c < 2 or self.grid[0][c - 1] == self.grid[0][c - 2]):
                banned.add(self.grid[0][c - 1])
            choices = [x for x in range(1, self.colors + 1) if x not in banned] or list(range(1, self.colors + 1))
            self.grid[0][c] = self.rng.choice(choices)
        return True

    def add_garbage_rows(self, n):
        """Pushes `n` rows of garbage in from the bottom -- used by the
        duel simulator when an attack lands. Garbage is represented as
        color -1 (never matches) until it's the bottom-most row and gets
        cleared as a block; that's a deliberate simplification (the real
        engine converts garbage a row at a time on a match touching it) --
        good enough for AI planning, since what matters for strategy is
        "garbage raises your floor and costs a swap to clear," not its
        exact clear animation."""
        for _ in range(n):
            if self.topped_out():
                return
            for r in range(self.height - 1, 0, -1):
                self.grid[r] = self.grid[r - 1][:]
            self.grid[0] = [-1] * self.width
