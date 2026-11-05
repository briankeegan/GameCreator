# Gambit: combos of 8 and up

**Finish them makes the big combos: 8 and up wherever the board can make one, a couple of moves more for an 8 over a 6. On a low
stack, cost per gain still decides.** TODO item 11.

## What a combo sends

One table in all three engines: `COMBO_GARBAGE` in panel-game `common/engine/checkMatches.lua:24-37` and `pa-engine.js:327-329`.
Gambit's count, `rules.c:100-109` (`comboCells`, `blocksOf`), matches it. Stop time is `calculateStopTime` (`checkMatches.lua:795`,
`pa.c:679`). The pop is `preStopTime` (`pa.c:725`). Level 11 (`LevelPresets.lua` `modern[11]`): coefficient 1, comboConstant 27,
chainConstant 53, FLASH 22, FACE 8, POP 6.

| combo | pieces (widths, 1 row each) | blocks | cells | cells / panel | own pop, frames | stop | stop, topped |
|---|---|---|---|---|---|---|---|
| 4 | 3 | 1 | 3 | 0.75 | 54 | 31 | 55 |
| 5 | 4 | 1 | 4 | 0.80 | 60 | 32 | 55 |
| 6 | 5 | 1 | 5 | 0.83 | 66 | 33 | 55 |
| 7 | 6 | 1 | 6 | 0.86 | 72 | 34 | 55 |
| **8** | **3+4** | **2** | **7** | 0.88 | 78 | 35 | 55 |
| 9 | 4+4 | 2 | 8 | 0.89 | 84 | 36 | 56 |
| 10 | 5+5 | 2 | 10 | 1.00 | 90 | 37 | 56 |
| 11 | 5+6 | 2 | 11 | 1.00 | 96 | 38 | 56 |
| 12 | 6+6 | 2 | 12 | 1.00 | 102 | 39 | 56 |
| **13** | 6+6+6 | 3 | **18** | **1.38** | 108 | 40 | 56 |
| **14** | 6x4 | 4 | **24** | **1.71** | 114 | 41 | 56 |
| 15-19 | 6x4 | 4 | 24 | 1.60-1.26 | 120-144 | 42-46 | 56 |
| 20 | 6x6 | 6 | 36 | 1.80 | 150 | 47 | 56 |

(The pop column assumes no garbage pops with the combo: each garbage panel on screen adds 6 frames. 27 and up send 6x8 = 48 cells.)

- **8 is the first combo that throws two blocks**: two rows of height, where a 6 throws one 5-wide row. Each piece lands as a block of
  its own. Going from 6 to 8 costs 2 more panels and doubles the blocks and rows (1 to 2), and sends 40% more cells (5 to 7).
- Cells per panel only climb with size: below 1 up to 9, exactly 1 at 10-12, then **13 sends 18 and 14 sends 24** (four full
  rows, 1.71 a panel).
- Stop time stays almost flat (one frame more per panel; 55/56 when topped), so stop gives no reason to go big. The pop holds our
  own rise 6 frames longer for each extra panel.

## What the finish run shows (l2063, the only finish run among l2061-l2081)

`gambit_summary.js` over the 24 games: **combos 4x207, 5x98, 6x257, 7x13, 8x10, 9x1**, so 8+ is 11 of 586. Survived 22/24, 21.4
blocks and 120 cells a minute.

- **92% of finish decisions are under garbage** (25100 of 27181). There, the entry the played line meets (`mode=`) is **entry 0 for
  every combo from 5 to 9**: 5 in 441 decisions, 6 in 1000, 7 in 81, 8 in 47, 9 in 11. To the order, a 6 and an 8 under garbage
  are the same goal.
- Without garbage, the planner found a line that meets `combo >=8` (`p0=1`) in **3 of 2081** decisions.

## Why a 6 wins

1. **Under garbage the list is rewritten to `combo >=5`.** `guideShort` (`rules.c:59-64`, called at `decide.c:82`) turns
   `combo >=8` into `>=5`. `decide.c:85` then makes that shortened list the rank's list too (`R->asked`). So the rank measures
   entries against a list the rules file never wrote. 5, 6, 7 and 8 all meet entry 0, and even 7 counts there although the
   written list leaves it out. Two parts measure the same fact differently: `fits` reads the list as written, while `metOf`
   reads the rewritten one. The searches are steered the same way: the lead (`facts.c:173` `nearList`) is already full at 5, and
   the next entry (`==5`) grades 5 > 6 > 8 (`facts.c:159`).
2. **Under garbage, no key asks the combo's size.** Key 1'' (`rank.c:479-499`) puts any break before a non-break (481), so an 8
   that breaks nothing loses to a three that breaks. Between two breaks it compares garbage broken per action (498), which knows
   nothing of the combo. Tier 1's sub-keys (`facts.c:203`) have no combo in them either. The goal key 1b (`rank.c:522`) then
   ties at 0 (cause 1), and `rank.c:527` takes **the fewer presses, which is the 6**. Key 8a "more thrown" (`rank.c:634`) would
   pick the 8's two blocks, but it comes after.
3. **Without garbage, three keys come before the goal key.** Key 1b would rank an 8 (goal 0) over a 6 (a fallback, goal 4). But
   each of these can decide first and put the 6 on top:
   - 1'f focus (`rank.c:461-468`): the line begun in a nearer band from the cursor wins.
   - 1'0 the line in progress (`rank.c:472-475`): of two that live, the carried line wins unless it breaks less. This leaves
     1a's own exception, "the other meets an earlier entry" (`rank.c:509`), reachable only in that case.
   - 1'a the reserve (`rank.c:446-449`).
4. **The search rarely reaches an 8.**
   - The beam's lead rises only when a line actually clears (`plan.c:236`, `leadOf` of what was made). Set-up boards are ranked
     by ideas, the swaps that fire an entry (`plan.c:239`). A 6 or a 5 counts there as much as an 8.
   - `growLines` (`propose.c:275-298`) grows threes into fours only. Nothing grows a 6 or 7 into an 8.
   - Once found, an 8 is kept: `perAim` keeps each entry's line that sends the most cells (`plan.c:247-250`).
5. **The list itself** (`survivor-profiles/gambit-rules.json`, finish them: `>=8, ==5, ==6, chain ==3`):
   - A 7 is outside the list. `comboOutside` (`rank.c:273`) counts it as wasted (`rank.c:280`), and `dropCombo` (`decide.c:458`)
     strips it, so a line one panel short of 8 is punished.
   - A 5 ranks above a 6, though a 6 sends more. This is the owner's order (`gambit-goal.md`, the modes table).
6. **Live only.** Finish them has no deadline: a topped enemy dies of an attack that lands after its stop runs out as surely as one before. At
   reaction 12 / swapGap 12, an 8's extra swaps may miss it. Training has no enemy (`by=-`), so the 24 games never test this.

## Fixes, smallest first

Each fix is measured on one 24-game finish run (`gambit-24.yml`, `gambit-finish.json`) with `node gambit_summary.js <dir>`, against
l2063. **It passes when** 8+ rises above 11 of 586 combos and 6s fall, the run survives at least 22/24 (the spread is about 2 games
a run), cells a minute stay at 120 or more, and "The truth held".

0. **Log it.** In `answer.c`, log the largest combo among the lines offered that live and fit (`big=`). In the summary, add "8+
   offered in N decisions, played in M". Without these, a run cannot tell "never found" from "found and ranked under".
1. **Rank on the list as written.** Build `R->asked` from the list before `guideShort` (with the break asked, `withRule`,
   `withAttacks`); `R->guides` may stay short for the searches. Under garbage an 8 that breaks then meets entry 0 and a 6 meets
   entry 2. *Measure:* the `mode=` histogram under garbage, and the combo histogram.
2. **Between two breaks, ask the list first.** In 1'' (`rank.c:495-499`), compare the earlier entry met before garbage broken per
   action, as 7a' (`rank.c:614`) already does for lines that do not live. *Measure:* the 8+ share under garbage, and the "window"
   losses (`gambit_losses.js`).
3. **Price an "or more" entry by cells per press, not presses.** Change `rank.c:527` from fewer presses to cells sent x presses,
   cross-multiplied. This is the owner's "a couple of moves more for an 8". The floor stays before it: below `keep.material`, a
   clear that breaks nothing is still outside (`rank.c:113`). *Measure:* 9+ against 8, cells a minute.
4. **The goal before focus and the carried line.** Let 1'f (`rank.c:461`) and 1'0 (`rank.c:472`) decide only between lines with
   the same `goalKeyOf`. *Measure:* the `putDown=` keys, and the decisions that offered a goal-0 line and played another (from
   fix 0).
5. **Lead the searches to the size.** `guideShort` leaves `combo >=8` in place and adds `>=5` after it rather than over it, so
   `nearList` grades 5 to 8 (0.4 to 1.0) under garbage. The planner's ideas get weighted by the entry they fire. *Measure:* the
   `big=` offered rate, `p0`, and think ms against the budget.
6. **A combo grower.** Add a twin of `growLines` for combos of 5-7: `fillWalks(B, &L, 4 or 5, ...)` on the line's last swap walks
   one or two more panels in, and each result is offered as an entry candidate. *Measure:* 8+ offered and played, wasted swaps.
7. **The list: the owner's call. Ask, don't change.** Finish them as `combo >=8, combo >=6 (6 and 7), combo ==5, chain ==3`.
8. **Live.** Before changing anything, count the late drops of 8+ lines under `by = enemy.stop` in a fight log.

## What the players who make them build

Re-simulated from the live replays (`REPLAY` lines of `bot-prod-smoke.log`): `combo_replays.py split` writes each match against a
player as a game, `lua/comboReplay.lua` re-runs it on the server's engine (in a panel-game checkout at the commit that was live) and
writes every combo of 8 and up as data, `combo_replays.py shapes` counts them. Each run's own result (who topped out) came out as
logged.

| | games | minutes | 8+ a minute | 5-7 a minute |
|---|---|---|---|---|
| PDR_Lava (run 41239779004) | 11 | 14.6 | 0.89 | 4.23 |
| Tanycanayt (runs 41364936530-41565622573) | 53 | 234.3 | 1.46 | 2.60 |
| Gambit, in those 53 games | 53 | 234.3 | 0.08 | 1.45 |

**The shape is two columns side by side.** Of Tanycanayt's 342 combos of 8+, 183 are two vertical runs in adjacent columns (v5+v4 72,
v5+v3 67, v4+v4 44), and 101 more are a vertical run beside a cross or an L (x5+v4, x5+v3, x6+v3). Of Lava's 13, 11 are two vertical
runs. Each is one swap: the two colours sit the wrong way round in one row, and the swap drops each panel into the other's column.

**It is built by sorting rows.** Before the swap, each row of the two runs is put in order along itself -- the run's colour walked into
its column, the other into the next -- in 4 to 11 swaps over the 4 seconds before, on rows at rest. Neither run can clear early: the
trigger row splits each column so that no three of one colour stand together until it is swapped.

Gambit has no search that builds toward this. The planner's beam ranks boards by the best clear one swap away and then by how
connected they are, so a board halfway to two sorted columns looks like any other.

Tried (idea93, branch `idea93`): a proposer that sorts the rows and offers the line as an entry where the list asks 8 or more. Finish
them, seed 92, 48 games: 8+ 64 against main's 62, survived 44/48 both, cursor 305 against 304 cells a minute. It was offered in 2,124
decisions and played in 134 -- 2,087 of the offers under garbage, where breaks rank first, and 37 on a board with none: finish them in
training is 72-99% of its decisions under garbage, so the calm boards the players build on hardly come up there.

## How the players organise the stack, in general

60 of Tanycanayt's live games against Gambit (runs 589-600, 658, 688, 692), re-simulated on the server's engine with each board
sampled every 30 frames; the boards with no garbage on them compared (his 1,669, Gambit's 5,842 in the same games):

| | Tanycanayt | Gambit |
|---|---|---|
| the same colour directly above | **7%** | 12% |
| the same colour beside | **5%** | 13% |
| colours in a full row | **4.33** | 4.17 |
| bumpiness (sum of neighbouring columns' height gaps) | **6.6** | 9.1 |
| a colour's mean column: off the middle / its wander over the game | 0.34 / **0.34** | 0.26 / 0.41 |
| A x A in a column, per 10 panels (one swap from a run of three) | **1.30** | 1.07 |
| A x A in a row, per 10 panels | **0.86** | 0.65 |
| the same colour on a diagonal, per 10 panels | **2.51** | 1.83 |
| combos of 8+ a minute | **1.29** | 0.05 |

**He keeps the stack flat and the colours spread: few panels of a colour touching, many a swap from touching.** A pair touching is a
match spent early or a three for nothing; a colour a swap away from several of its kind is a combo waiting -- the 8+ are several of
those fired by one swap (two vertical runs side by side, above). The colours keep their columns a little more (they wander less),
but there is no left or right: no colour is kept on a side.

So a set-up can be general, not one combo built on purpose: of two set-ups, the one that leaves the board flatter, with fewer
same-colour panels touching and more a swap apart. The tools: `boardSample.lua` and `boardstats.py`, `staged.py` (the scratchpad of
the session that measured it; to be added beside `combo_replays.py`).
