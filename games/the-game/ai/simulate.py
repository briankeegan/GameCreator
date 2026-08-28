"""Puzzle Attack -- a LOGICAL (timer-free) board simulator for AI design.

panel-engine.js is the frame-accurate reference (ported 1:1 from
briankeegan/panel-game). This module is not that -- it deliberately skips
hover/pop timers and simulates only what an AI needs to PLAN: swap two
adjacent panels, let gravity settle everything, resolve matches, repeat
until nothing more falls into place (that repeat loop is what a "chain" is
here), and score the result the same way the real engine does. That's
enough to compare candidate moves and pick the best one; it is NOT enough
to replace panel-engine.js, and nothing in this directory ships to the
browser -- see games/the-game/panel-cpu.js's LogicalBoard, which is this
module's JS twin and is what actually ships.

Board convention: rows 0..height-1, row 0 is the BOTTOM (matches
panel-engine.js's row-1-is-bottom convention). Colors 1..N; 0 is empty.

GARBAGE IS TRACKED AS BLOCKS, NOT LOOSE CELLS -- this matters and was
gotten wrong in an earlier version of this file. panel-engine.js's real
support rule (supportedFromBelow) is: a garbage slab falls as ONE PIECE,
and it counts as supported if ANY single column under its whole width is
blocked -- "a 6-wide slab resting on one panel does not fall." Treating
garbage as independent per-cell markers (as an earlier version of this
file did) makes each column of a slab fall separately instead, which
produces boards that don't resemble what the real engine would ever
build, and which are trivially wrong to plan defense against.
"""

import random

WIDTH = 6
HEIGHT = 12
COLORS = 5  # matches a mid-level board (LEVELS[2].colors in panel-engine.js)

SCORE_COMBO_TA = [0, 0, 0, 0, 20, 30, 50, 60, 70, 80, 100, 140, 170, 210, 250,
                  290, 340, 390, 440, 490, 550, 610, 680, 750, 820, 900, 980,
                  1060, 1150, 1240, 1330]
SCORE_CHAIN_TA = [0, 0, 50, 80, 150, 300, 400, 500, 700, 900, 1100, 1300, 1500, 1800]

COMBO_GARBAGE = {
    4: [3], 5: [4], 6: [5], 7: [6], 8: [3, 4], 9: [4, 4], 10: [5, 5],
    11: [5, 6], 12: [6, 6],
}


def combo_garbage(size):
    if size in COMBO_GARBAGE:
        return list(COMBO_GARBAGE[size])
    if size > 12:
        extra = size - 12
        return [6, 6 + extra]
    return []


def chain_garbage_height(chain_length):
    return max(0, chain_length - 1)


class GarbageBlock:
    __slots__ = ("id", "cells")

    def __init__(self, block_id, cells):
        self.id = block_id
        self.cells = cells  # set of (row, col)


class Board:
    """A width x height grid plus the swap/cascade rules."""

    def __init__(self, width=WIDTH, height=HEIGHT, colors=COLORS, rng=None, grid=None, blocks=None):
        self.width = width
        self.height = height
        self.colors = colors
        self.rng = rng or random.Random()
        if grid is not None:
            self.grid = [row[:] for row in grid]
        else:
            self.grid = [[0] * width for _ in range(height)]
        # grid cells belonging to garbage hold -block.id (always < 0);
        # self.blocks maps id -> GarbageBlock. Kept in sync by every method
        # that mutates the grid (swap never touches garbage cells at all,
        # since they're never swappable, so only gravity/clear/raise need
        # to maintain this).
        self.blocks = {}
        if blocks is not None:
            for block_id, cells in blocks.items():
                self.blocks[block_id] = GarbageBlock(block_id, set(cells))
        self._next_block_id = (max(self.blocks.keys(), default=0) + 1) if self.blocks else 1

    def clone(self):
        # A hypothetical trial board gets its OWN randomness, never the
        # live game's -- speculative "what if I raised here" planning must
        # not see (or consume) the real upcoming panel colors any more
        # than a human player could. Only a board actually played for
        # real should ever draw from the shared game RNG.
        b = Board(self.width, self.height, self.colors, random.Random(), self.grid,
                  {bid: blk.cells for bid, blk in self.blocks.items()})
        b._next_block_id = self._next_block_id
        return b

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

    def lowest_garbage_row(self):
        """The row index of the lowest garbage cell anywhere, or None if
        there's no garbage. Smaller is better for the defender -- it's a
        direct measure of how close the nearest slab is to being
        touchable, independent of whether any cell of it clears THIS
        move."""
        best = None
        for blk in self.blocks.values():
            for (r, c) in blk.cells:
                if best is None or r < best:
                    best = r
        return best

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

    def _drop_real_panels(self):
        """Real (colored) panels fall independently per column -- unlike
        garbage, each one only cares about what's directly under IT."""
        moved = False
        for c in range(self.width):
            column_ids = [self.grid[r][c] for r in range(self.height) if self.grid[r][c] > 0]
            write = 0
            new_col = [0] * self.height
            for r in range(self.height):
                if self.grid[r][c] < 0:
                    new_col[r] = self.grid[r][c]  # garbage stays; handled separately
            free_rows = [r for r in range(self.height) if new_col[r] == 0]
            for i, color in enumerate(column_ids):
                if i < len(free_rows):
                    new_col[free_rows[i]] = color
            for r in range(self.height):
                if self.grid[r][c] != new_col[r]:
                    moved = True
                self.grid[r][c] = new_col[r]
        return moved

    def _drop_garbage_blocks(self):
        """Each garbage block falls ONE ROW if, and only if, EVERY column
        under its whole footprint is empty -- supportedFromBelow's real
        rule (a slab resting on even one panel, garbage or real, does not
        fall), applied bottom-to-top so a block that just landed can still
        support whatever was resting on it."""
        moved = False
        # bottom-to-top by each block's lowest row, so support checks see
        # already-settled blocks below before a higher block moves.
        order = sorted(self.blocks.values(), key=lambda blk: min(r for (r, c) in blk.cells))
        for blk in order:
            while True:
                min_row = min(r for (r, c) in blk.cells)
                if min_row <= 0:
                    break
                cols = {c for (r, c) in blk.cells if r == min_row}
                supported = False
                for c in cols:
                    below = self.grid[min_row - 1][c]
                    if below != 0 and not (below < 0 and -below == blk.id):
                        supported = True
                        break
                if supported:
                    break
                new_cells = set()
                for (r, c) in blk.cells:
                    self.grid[r][c] = 0
                for (r, c) in blk.cells:
                    new_cells.add((r - 1, c))
                for (r, c) in new_cells:
                    self.grid[r][c] = -blk.id
                blk.cells = new_cells
                moved = True
        return moved

    def _apply_gravity(self):
        for _ in range(self.height * 2):  # bounded fixed-point iteration
            a = self._drop_real_panels()
            b = self._drop_garbage_blocks()
            if not a and not b:
                break

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
        """A match that touches a garbage cell clears the WHOLE block it
        belongs to, and if that block is itself touching another block,
        that one clears too, recursively -- getConnectedGarbagePanels in
        panel-engine.js does exactly this (its addNeighbourGarbage floods
        through any adjacent garbageId, not just the one first touched).
        Returns the set of block ids to remove."""
        seen_blocks = set()
        frontier = set()
        for (r, c) in matched:
            for (rr, cc) in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= rr < self.height and 0 <= cc < self.width and self.grid[rr][cc] < 0:
                    frontier.add(-self.grid[rr][cc])
        while frontier:
            bid = frontier.pop()
            if bid in seen_blocks or bid not in self.blocks:
                continue
            seen_blocks.add(bid)
            for (r, c) in self.blocks[bid].cells:
                for (rr, cc) in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= rr < self.height and 0 <= cc < self.width and self.grid[rr][cc] < 0:
                        nbid = -self.grid[rr][cc]
                        if nbid not in seen_blocks:
                            frontier.add(nbid)
        return seen_blocks

    def resolve(self):
        """Repeatedly settles gravity and clears matches until stable.
        Returns (chain_length, combo_sizes, score, garbage_sent) --
        chain_length is 0 if nothing matched at all (a wasted swap)."""
        chain_length = 0
        combo_sizes = []
        score = 0
        garbage = []  # list of (width, height)

        self._apply_gravity()

        while True:
            matched = self._find_matches()
            if not matched:
                break
            chain_length += 1
            combo_size = len(matched)
            combo_sizes.append(combo_size)
            cleared_blocks = self._connected_garbage(matched)
            for (r, c) in matched:
                self.grid[r][c] = 0
            for bid in cleared_blocks:
                for (r, c) in self.blocks[bid].cells:
                    self.grid[r][c] = 0
                del self.blocks[bid]

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
        """One manual-raise tick: shift everything up a row (garbage
        blocks' cells included) and fill a fresh matchless row at the
        bottom (mirrors Stack:newRow's shape, not its exact frame timing).
        """
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
        for blk in self.blocks.values():
            blk.cells = {(r + 1, c) for (r, c) in blk.cells}
        return True

    def add_garbage_rows(self, n, width=None):
        """Drops one new garbage BLOCK of the given width (default: full
        board width) and height `n`, landing above the current stack and
        falling to rest -- the same shape as the real Stack:dropGarbage,
        simplified to always land centered/left rather than replicating
        garbageSizeDropColumnMaps exactly (irrelevant to AI planning)."""
        if self.topped_out():
            return
        width = width or self.width
        # BUG (fixed): this used to take the max over range(self.width) --
        # ALL columns -- so a block narrower than the board (e.g. Combo
        # Storm's 4-wide) landed on top of the board's TALLEST column even
        # when its own footprint's columns were much shorter, placing it
        # far higher than the real engine ever would (which drops it
        # through empty space until ITS OWN columns are blocked --
        # supportedFromBelow). Confirmed via training_survival.py: this
        # made every burst bury the board several times faster than the
        # real panel-engine.js numbers (training_harness.js) showed.
        origin_row = max((self.height_of(c) for c in range(width)), default=0)
        block_id = self._next_block_id
        self._next_block_id += 1
        cells = set()
        for r in range(origin_row, origin_row + n):
            if r >= self.height:
                break
            for c in range(width):
                cells.add((r, c))
                self.grid[r][c] = -block_id
        self.blocks[block_id] = GarbageBlock(block_id, cells)
        self._apply_gravity()
