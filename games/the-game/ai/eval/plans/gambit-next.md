# Gambit: what is done next

**The board's life under garbage is its next break.** Three changes aim every break at the material and the stop time the next one
needs: a line is weighed by how near a break the board it leaves is; a plain three is offered grown into a combo; and the panels a
break converts are made into a chain. None of them decides anything on its own: each is a fact the one outcome reads or a candidate
the proposers offer, judged on the engine and ranked in the one order (`plans/gambit-goal.md`, "One of each").

Gambit sees only what the screen shows (`gambit/lua/board.lua` `shown`): a colour a break converts garbage into is unseen until the
client draws it. Everything below plans on that board.

## 0. The list first among lines that survive alike

Not dying comes first; of lines that survive alike, the one that makes the list comes next -- in every case, survival lines and
defence included. One order (`rank.c` compareJudged), keys in turn:

1. lives before does not;
2. of two that do not, a break while it outlives the next decision, then the later loss, then readiness for the next block;
3. within the list before outside it;
4. of two breaks under garbage, the one that leaves a break to build and keeps the floor (`nextBuild`, the floor);
5. while the board saves panels up (`decide.c read`), of two breaks under garbage, the one whose panels leave more life;
6. the earlier entry of the list met (`rules.c metOf`: its break as the entry asks it);
7. the tier and its keys -- the kind of line, the life its panels leave, the nearest break, the rest.

Every rule that guards the next break's material (4, 5) comes before the list: the list orders the breaks the board can afford. Each
key is in `rank.c compareJudged` once, in this order.

The topped rule (a line that keeps the board held past the stop now) is a tier key under the list, not a tier above it. Held by a test
on a topped board where a line that meets the list and a plain clear that only lengthens the stop both live: the list's line is
played.

## The life a board's panels leave, measured

A board short of panels dies for want of material; a full one dies of its height. The life a board has by the panels on it is measured
on Gambit's own games (`gambit/material.c`, `./build.sh material DIR...`: frames spent at each count over the games lost there, a
row's worth a bin) into `gambit/core/material.h`, and a line's board is ranked by it (`outcome.c lifeOf`) after the list's keys: short,
the line that keeps panels; full, the line that clears them. Made again from new runs when the bot changes enough to move it.

## A chain begun toward the list

A chain shorter than the list asks is a beginning of one it asks for (`judge.c chainBegins`): the decisions after carry it on (`extend`),
so it is within the list -- after every line that meets an entry, its own clears held to the list as ever. The step check and the
whole line's check ask the one function.

## 1. The nearest break after the line

- **The fact** (`outcome.c`): every line judged under garbage carries the swaps to the nearest break on the board it leaves
  (`o.nearAfter`, from `breakNear` -- the search the material floor and the touch beam already ask), set where `panelsLeft` is. Its
  time is charged to the decision's clock like every search.
- **The rank** (`rank.c`): of two in one tier, the nearer break first, after the list's own keys and the life its panels leave
  (`Tier.nlist`). A line that brings a break nearer climbs; one that pushes it away falls. The list's order is never crossed.
- **Held by** a test on a real board: of two fills that both live, the one that leaves a break one swap away is ranked first.

## 2. A three grown into a combo

- **The candidates** (`propose.c`, a pass after the proposers): for each line whose clear is a plain three, the same line with one
  more panel of the match's colour walked beside it before the clear begins -- a match of four or five. Offered as a candidate of the
  play that found the three, so its place in the order is that play's.
- **Judged as any line**: on the engine, within the list, in time. A grown line that does not make the larger match on the engine is
  not one; a combo of four or more buys stop time (`pa.c calculateStopTime`), so the existing order takes it before the three when it
  lives as long.
- **Held by** a test on a real board where a three and its grown four both live: the four is played.

## 3. The converted row's chain

A break turns a row of garbage into panels; when the pop ends they hover and fall chaining (`pa.c updateMatched`), so a match they
make is a link of a chain -- stop time on a topped board, and panels converted kept as panels.

- **Where they land**: the board left alone, played on the engine through the pop and the fall (the hold, already judged every
  decision). The landing cells, and the colour each is one panel short of, are read off that board.
- **Before the break is pressed**: only the colours the board already shows. The candidate is the break line followed by the walk
  that puts a panel of the colour beside a landing cell, judged as one line.
- **During the pop**: each converted panel's colour as the screen draws it. The candidate is the walk that brings a panel of that
  colour beside where it lands, timed to finish before the row falls (`PLAY_CONVERT`).
- **The search behind it**: `extend` (`search/extend.c`) is seeded with these lines and searches on from them, as it searches from a
  cascade now.
- **Judged as any line**: on the engine, timed from where the cursor is, within the list. A walk that cannot finish before the row
  lands is late and dropped; a chain that does not happen on the engine is not one.
- **Held by** a test on a recorded pop with its colours drawn: the walk that makes the chain is proposed and played.

## Every mode's rules, and any mode to come

Nothing here names a mode. Each piece reads only what every decision already reads from the rule in force (`decide.c` read: the
list, its aims, under garbage, topped), so a mode that changes, a mode added, or a switch mid-game needs nothing of its own.

- **The list decides what is made.** A grown combo and a converted-row chain are judged by the one list check (`fitsList`: what the
  line makes, the chain the game counts, every clear of its own). A mode whose list does not take a four, or a chain, gets those
  lines ranked outside it, after every line within it that lives -- never in its place. The defence (a break made by one clear is
  within every list) does not stretch to them: a chain is an attack, and the list rules it. The defence is still ordered by the
  list: of two breaks, the one that meets an earlier entry comes first (`rank.c` `aim`), the defence's own entry (a combo of four or
  more that breaks) after the list's, and a break that meets none last among them -- within the list, so before any line outside it.
- **The list's own order comes first.** The nearest break, like the life the panels leave, is weighed only after the list's own keys
  (`Tier.nlist`), so what a list asks for in what order is never reordered.
- **Survival first, in every mode.** A line that lives comes before one that does not, whatever it makes; these change only the
  order among lines that live alike, and the worth of the frames among lines that do not.
- **Read every decision.** The list is read from the rule in force each decision, so a switch mid-game changes what fits at once;
  a line in progress is judged again on the next decision's list, as every carried line is.
- **Held by** the tests above run once per mode's profile (`survivor-profiles/gambit-*.json`): the test's verdict follows that
  mode's list -- the grown four played where the list takes it, outside where it does not.

## 4. A perched block let down

A garbage block held up by panels in some of the columns under its bottom row and by nothing in the others is perched over a hollow.
Walking the panels that hold it out from under it lets the block down, and the stack's height with it -- what a full board needs, where
every loss of the fair runs ended (57-67 panels of 72, the hold chosen, nothing that lives).

- **It takes panels out from under the block; it never fills under it.** A fill spends panels into the hollow and leaves the block where
  it is; letting it down spends none.
- **It has no place of its own in the order.** It is a candidate, judged on the engine like any other, ranked by what the engine says it
  does: lives before dies, then the later loss -- a lower stack is a later loss -- then the list, then the tier's keys. It never ranks
  before the hold for being a drop.
- **The fact** (`search/break.c perchedDrops`, beside the board's other readers): for each block's bottom row, the columns under it that
  hold it (a panel), that are open (nothing), or that sit on garbage (not perched: nothing to walk out). For each perched block, the
  line: each support walked along its row past the block's nearer edge, lowest block first.
- **One proposer for lowering the stack** (`propose.c`, `PLAY_LEVEL`): the tallest column's top walked onto a lower column (`levelLine`,
  now offered under garbage too), and a perched block's supports walked out -- offered whenever the board is topped or under garbage.
  A block held by several columns comes down over the decisions after, the line in progress carried as every line is.
- **Logged**: `drop=1` on a decision that plays one, so a run shows how often it is played and whether the full-board losses fall.
- **Held by** a test on a recorded full board with a perched block: the drop is proposed, judged, and played when it lives longer.

## 5. The board as bits

Every reader of a settled board -- the nearest break (`breakNear`, `breakBuildable`, the material floor, the nearest-break key), the
panel a match is one short of (`fill.c`), a perched block, the panel and garbage counts -- scans cells its own way. One representation
read by all of them:

- **The bits** (`search/bits.c`): per row, a mask a colour (bit = column), and masks for panels, garbage, open cells and the cells that
  hold a panel up; per column the same transposed. Built once a board, from `gridCell`, and kept with the board it was built from.
- **The readers on it**: the cells that can start a break are the panels beside garbage, one mask expression; bringing a panel of a
  colour along its row is the nearest set bit of that colour in the run of held cells around the target; a run of a colour is a shift
  and an AND. `breakNear` asks the same six shapes a starting cell as now, so its answer is the same.
- **Held by** a test that runs the cell-scanning readers and the bit readers on every board of recorded games and finds no difference
  -- then the cell-scanning ones are deleted. Under three seconds.
- **The engine is not touched**: the bits are read off the board the engine makes, never a second engine.

## 6. One of each: the audit's fixes, in one batch

Every question the decision asks is asked once, in one function every caller uses; every rule is one key of the one order; every fact
is the engine's, never a search's claim. All of it lands in one push and is measured by one run per mode -- so it is proved, before
the push, on Gambit's own recorded decisions, which change and why.

### 6a. The proof, built first (no behaviour changes)

- **The decision replay** (`test/decide_test.c`, run by `./build.sh test`): 400 questions Gambit met in its own games -- 100 a mode, from
  the fair-board runs' `GAMBITB` lines, their arrivals beside them, gzipped in `test/decisions.txt.gz` -- each loaded
  (`gb_question_bytes`), answered with no deadline (`answerQuestion` with `due` 0: every search runs to its own bounds, so the same
  board gives the same answer, every time), the mode's rules from `gambit.words`, a new game before each (`gb_new_game`).
- **What it records** a question: the move, the play, the top three of the order with each one's keys, and the facts the order read
  (lives, lost, outside, material, saving, met, tier) -- `test/decisions.golden`.
- **Held by**: run twice, the same record (it is deterministic, or the replay is no proof); the record of the build before the batch
  committed as the golden.
- **Every changed decision is named**: the replay prints each question whose move differs from the golden, with the first key of the
  order that decided differently. A change no fix below explains is a bug, found before a run is spent on it.

### 6b. The restructuring -- every decision the same as the golden

4. **One defence rule** (`rules.c defends`): a break made by one clear, no chain, is within every list -- asked by `fits`, `fitsList`
   and `stepFitsAt` alike; the defence entry added in `decide.c read` named as that rule's search side.
5. **Every rank rule in the one order.** The carried line's place and a waiting line's place (`decide.c ranked`, two places) and the
   topped board's tier become keys of `compareJudged`, read off fields the judging sets; no tier is edited after the judging.
9. **An outcome keeps its end board** (or the means to replay it): no reader asks the judge's context for a node it may no longer
   hold; `lineEnd` and its cache bypass go.
10. **Every loop charged**: the board readers on the bits charge their work to the clock, as the engine's steps do (no deadline in the
    replay, so the decisions there do not move; in a game the charge is what keeps them in time).
11. **One of each constant**: `TAP_GAP`, `REPEAT_FIRST`, `HOLDTIGHT` defined once; `front.c`'s garbage timings (`STAGING`, `LAND`) read
    from the engine -- the same numbers, so the same decisions.

### 6c. The fixes that change decisions -- each change explained by one of these

0. **A move must beat doing nothing.** Of two lines that both live, a line that clears nothing (a level, a perched drop, a setup, a
   walk toward a break) comes before the hold only when the engine says it does better than holding: a later loss, more life by its
   panels, a nearer break, or ready for the next block where the hold is not. Otherwise the hold. One key of `compareJudged`, read for
   every proposer there is or will be -- being offered is never a reason to be played. The decisions that change: every living
   no-clear line that only tied the hold.
1. **Two named material measures, one function each, on the bits**: the panels on the board (`panelsOn`) and the panels under the
   lowest garbage (the material the rule's keep floor tests, `>=24` in `gambit-rules.json`: its meaning kept). Every reader names
   which it asks; the log carries both. Garbage is the game's flag everywhere (`gridCell`): a shock panel or an unseen colour is a
   panel that matches nothing, never garbage. The decisions that change: where a shock panel or an unseen colour sat.
3. **No candidate dropped unseen**: past `MAXCANDS`, every proposer keeps its share, the lowest by the proposer's own claim go first,
   and the log counts them (`capped=`). The decisions that change: busy boards, where the new moves were cut.
4. **The defence on a topped board without garbage**: the clear that buys stop time (a combo of four or more, or a chain) is within
   every list there too. The decisions that change: topped boards with no garbage.
6. **The engine's answer, never the claim**: the material key's floor is the judged board's (`keepsFloor` on the board the line ends
   on); the tier's aim is the judged entry (`metOf`), as the list key's is. The decisions that change: where the claim and the engine
   disagreed.
7. **One replayer**: the carried line is judged by the judge (`replay` deleted) -- what a line makes counted one way; the cells a clear
   sends are `sentCells`, everywhere. The decisions that change: carried lines whose earlier step broke.
8. **One reading of shape** on the bits: height, evenness and hollow, one function each, read by the facts, the planner's shape and
   the tier -- the definitions that differ made one, the one the facts use. The decisions that change: where two evennesses disagreed.

### 6b and 6c as built

- In: 0 (a move must beat doing nothing -- a no-clear line that is not shown better than holding, an unknown included, ranks right
  after the hold; levelling last among them), 1 and 8 as one shape (`search/bits.c bitsShape`: the facts, the keep floor, the planner
  and the levelling read it; garbage is the game's flag), 3 (`decide.c fairShare`, `capped=`), 4 (`judge.c defends`, topped with no
  garbage too), 5 (`rank.c tierView`), 6 (`outcome.c floorKept`; the judged entry), 7 (the judge plays the carried line; `replay` gone),
  11 (one `TAP_GAP`, `REPEAT_FIRST`, `HOLDTIGHT`; one walk leg, `core/nodes.h walkLeg`, for the search and the frame loop).
- The replay: the restructuring changed none of 207 decisions; the batch moved 55, every one a level that only tied the hold, now
  the hold.
- Not in, each with what brings it back: 9 (an outcome keeping its end board) and 10 (the board readers charged) wait for a
  calibration of a board reader's work against an engine frame -- no number is typed for it; `front.c`'s garbage timings are the
  attack engine's (the Lua's staging), not this engine's, and stay until the telegraph carries them.

### 6d. Data and rules

- **The life table measured again** on the run before the batch (`./build.sh material`), every bin its frames and losses.
- **The saving band is the owner's** (begun topped at four rows' worth of panels or fewer, kept to eight rows' worth): unchanged. The
  life table's peak is logged beside it (`lifePeak=`), for the owner to read.

### 6e. Gated, then one run

- **`./build.sh test` runs in `gambit-24.yml`** beside `board.test.lua`: the bits, the perched blocks, the decision replay's
  determinism and its golden. A change that moves a decision commits the new golden with it, its changes named in the commit.
- **Each fix adds its case** to the replay or the bits test: a board and the answer -- under three seconds in all, or the test is cut
  down until it is.
- **One push, one run per mode.** Read per mode as each lands; a regression is read in its games and fixed forward, through the shared
  function that decides it.

Not in this step, each with what brings it back: the searches capped by count (the touch beam, the planner, extend, the survival
search) made time-bounded once the clock-cut count says they are short of time; the perched drop's walk taught that a walked panel
falls once the drop rate says it matters; the shared prefix's replay once the judge is short of time.

## Kept for when it is needed

- **A shared prefix's replay**: the lines a judge plays from one root often begin with the same swaps (a grown three, a break and the
  walk after it); the board after their common swaps judged once. Speed only; taken up when the decisions' clock-cut counts say the
  judge runs out of time.

## The order

0-3 are in (the run at `e5db6b32dd`). Then 5, then 4 on it: the bits first, so the perched block's reader is written on them. One push,
then 24 games per mode (`run24.sh`), reported per garbage type with the combos and chains, against the last run.

## Done when

- Each change is kept only where its run is no worse than the last by more than the noise in any mode.
- The losses on a full board (the hold chosen, nothing that lives) are fewer than on the fair board's first run.
