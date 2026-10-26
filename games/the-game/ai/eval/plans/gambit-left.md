# Gambit: what is left

`plans/gambit-categories.md` is built: the categories, the five-key order, the loss reader, the break search's frontier and beam,
the plan held, the pace, and the checks. This file covers what is still to do. Each part is one change, run on its own 24 games,
with its measurement written beside the code.

## 1. One answer for the save

**Now:** a three that breaks nothing is decided twice.
- The decision's save step (decide.c, "THE SAVE ASKED") plays the board on with and without the three, using the survival search.
- The press guard (front.c, `GUARD_DIE` 120 frames) plays it on again at the press with its own test.

The two can disagree, so a line the order chose can be refused at the press.

**To do:**
1. The answer carries the decision's verdict: this line's three is the board's save, or it is not. The press guard reads that
   verdict, and asks its own question only for a swap the answer did not judge (a line handed on, pressed later than judged).
2. Then the save step leaves the order. A wasted three already ranks below every line that wastes none (the list key), and a three
   the board needs wins by survival (key 1), so the step's own survival search is no longer needed.

**Checked by:** "the answers" stays green, and the summary's "refused at the press" count for a three falls to the lines the
answer never judged.

## 2. Numbers from the engine, one at a time

The goal says every number comes from the engine. Each constant below is replaced by what it stands for, measured, in this order:
the ones that decide what Gambit does first, then how far it looks, then time. One constant per change, each run on 24 games.

### What Gambit does: measured on the board, every decision

| Constant | What it stands for | Measured as |
|---|---|---|
| `LAND_RESERVE` 20 | the walk kept for a break when none is on the board yet | the last break walk measured this game |
| `NEAR_ACTS` 2 | the actions a swap toward a break costs | the cursor's actions along the line (`actionsFor`), as the break walk already is |
| `NEAR_MISS` 20 | "no break in reach" | none found by the shape math at all |
| `HORIZON` 240, `REST` 120 | how long a board must stand to "live" | the frames until the last block shown lands, plus a break's time |
| `CHEAP_BREAK` 6, `WALK_EARN` 6 | how far a line may walk for a break | gone: value for moves prices every action |
| `CARRY_WAITS` 2 | how long a line in progress may wait for the board | gone: the line in progress competes on value |
| `LOW_ROWS` 6, `RAISE_WAIT` 120 | when the floor's raise is offered, and how long it waits | the rows a break needs under the garbage, and the frames to the next landing |
| `GUARD_DIE` 120, `TAP_DIES` 60 | how far the press guard plays a board on | the answer's verdict (part 1), else the frames to the next landing |
| `MARGIN_ROWS` 12 | the board's height | the engine's rows |

### How far it looks: bounded by the clock

The touch beam (`TOUCH_BEAM` 60, `TOUCH_WIDE` 100, `TOUCH_DEPTH` 12), the line-ups (`LINEUP_DEPTH` 8, `LINEUP_BEAM` 12,
`LINEUP_BUDGET` 400), the survival search (`OUT_POOL` 16, depth 6, width 30), the three taken out (`NSTRIP` 12, `STRIP_LINES` 3),
the ideas (`IDEAS_ASKS` 8), the perched blocks (`PERCHMAX` 4) and the routes (`ROUTE_TOP` 4).

Each becomes a memory bound only, sized from the most the run's logs show in use. The search grows until its share of the clock
ends, and the number recorded beside each bound is the observed maximum.

### Time: shares of the decision's clock

`SAVE_MS` 10, `SAVE_KEEP_MS` 4, `LANDED_MS` 40, `READY_LINE_MS` 120, `BREAK_MAX_MS` 400, `BREAK_MIN_MS` 5, `BREAK_SHARE` 0.4,
`UNDER_SHARE` 0.75, `RAISE_MS` 150.

Each becomes a share of the time left, in proportion to the asks still to come, as readiness already does (`readyShare`). Where a
fixed share stays, the measured think time it fits is recorded beside it.

### Left as they are

Storage sizes, which hold data and decide nothing (`CACHEN`, `LINEPOOL`, `MAXLINE`, `KEEPN` and the like), each with its observed
maximum recorded. The engine's own facts: `W`, `ROWS`, and `TAP_GAP` (the frames between taps). `WORK_PER_MS`, measured on a
runner and recorded already.

**Checked by:** each change's run, read by stage. A constant whose replacement turns a stage worse in two runs is looked at before
the next one.

## 3. The owner's to set

Value for moves counts a row of garbage converted, and a block thrown, as worth one break's time each. It is a choice, not a
measurement. Gambit keeps it until the owner sets it.

## Order

1. The save's one answer (part 1).
2. The behaviour constants, top to bottom.
3. The search bounds.
4. The time shares.
