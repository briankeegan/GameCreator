# Gambit: learning from Mastershadow

Mastershadow beat Gambit once in six live matches on panelattack.com (the p820 session, idea228's build). The six matches,
re-simulated on the live engine (`upwt` + `tools/liveSample.lua`, the re-run ends on the live frame), give the numbers below:
17.1 minutes of each player.

| | Gambit | Mastershadow |
| --- | --- | --- |
| calm: mean column height | 8.5 rows | 7 rows |
| calm: tallest column 10+ rows | 66% of the time | 35% |
| under garbage: colour panels | 41 | 30 |
| under garbage: tallest column 10+ rows | 99% | 88% |
| combos of 4-7 a minute | 1.0 | 2.2 |
| 8+ combos a minute | 0.29 | 0.29 |
| chains a minute | 7.1 | 7.1 (fewer 2x: 59 against 67) |

The great players' stacks in replays (Tanycanayt, 60 games, calm) agree: tallest column median 9 rows, mean column 7, bumpiness
7 against Gambit's 9.1. Not low: flat, and a row under Gambit.

## Step 1: no mistakes (each one measured, each one a gate)

1. **A starved decision never drops the line in progress.** Fight 813, match 20: a decision took 577 ms, the next had 17 ms,
   its judge of the line in progress pressed nothing for want of time, the line was dropped as "a step no longer there"
   (`decide.c carriedCand`, carryDrop 2), and a break worth 327 frames of life became a hold that died 13 frames later. The line
   in progress is judged first with time of its own, and a line the clock alone stopped judging is pressed on, never dropped.
   Gate: no `carryDrop=2` with `n0` in a 24-game run.
2. **No line dropped halfway.** 28-35% of every input went on lines put down before their end (`actsLost`). A line once begun is
   played to its end unless another lives where it does not, or a break's time longer (idea233). Gate: under 10%.
3. **No hold while a line lives a break's time longer.** Fight 813, match 1: held at 126 frames with a level at 201. Gate: the log's
   `holdLate` never a break's time.
4. **No wasted three** (0.01-0.02 a minute now; keep it).

## Step 2: play like Mastershadow

1. **A row lower, calm.** Mean column 7, the tallest under 10 rows two thirds of the time. The opener's raise to 11 stays (the
   owner); the raises after it go to 8 rows (idea224), and calm moves flatten (8c').
2. **Off the ceiling under garbage.** Digging at about 30 panels, the stack under 10 rows an eighth of the time. The rules' floor
   is 40 panels: lowering it is the owner's call.
3. **Garbage broken by combos.** Twice Gambit's 4-7 combos: the shape built, then fired at once (an L or T beside a column, the
   crossed seam). Under garbage a break that is a 4-7 combo a swap or two away goes before a three or a 2x that breaks as much.
4. **Chains and eights as they are.** Same rate as Mastershadow; the modes decide which.

## Measured how

Every change: 24 games a mode on seed set 82 (finish them, pressure, build, big chain) and the endless pattern, against main's
own run on the same seeds. Reported per run: survival, the mode's share of attacks, holds, wasted threes, inputs on lines
dropped, and the Mastershadow table's rows. Merged only where survival holds and a row moves toward Mastershadow's. Then live:
fights against Gambit_100 and the lobby, every loss read.
