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
2. of two that do not, the later loss;
3. within the list before outside it;
4. the earlier entry of the list met (`aim`; under garbage every entry breaks, so a break is never put behind for it);
5. the tier and its keys -- the kind of line, the life its panels leave, the nearest break, the rest.

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

## The order

0, 1, 2, then 3: the order of the rank first, then the cheapest. Each is one push, then 24 games per mode (`run24.sh`), reported per garbage type with the
combos and chains, against the last run on the fair board.

## Done when

- Each change is kept only where its run is no worse than the last by more than the noise in any mode.
- The losses where the board ran out of material (no break to build on the boards before the loss) are fewer than on the fair
  board's first run.
