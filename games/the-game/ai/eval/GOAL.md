# THE GOAL

**The bot must not die.** Surviving is a requirement, not a ranked
preference. The choices are how it chooses to live, not how it chooses to
die. If it actually dies, it should be because there was nothing it could
have played.

Target: no deaths before the duel ceiling, 21,600 frames (6 minutes).

## The loop

1. Run it.
2. **READ THE BOARD** at the death. The actual grid. The move it played.
   The moves it had.
3. Find the defect on that board.
4. Fix it.
5. Repeat.

## How to get this wrong

These are the ways I have actually gone wrong on this task, written down
so I stop repeating them.

- **Reporting percentages instead of reading boards.** A census tells you
  a verdict fires 96 times and is right 79% of the time. It does not tell
  you what was wrong on the board. Every real defect this session was
  found by printing a grid and looking at it; not one came out of an
  aggregate. When you catch yourself tabulating, stop and print the board.
- **Measuring instead of fixing.** "I'll quantify this first" is how a
  fix turns into an afternoon of sweeps.
- **Stacking a new rule beside a broken one.** Fix the rule that is
  already there. Four rules built from theory were measured as losses and
  deleted.
- **Adding a feature.** A feature is something the bot may choose. The
  rules have to be such that its choices cannot kill it.
- **Trusting a number from a tool I wrote without checking the field
  exists.** Four probes returned confident nonsense in one session:
  `garbagePopped` is not a field; the settled grid CANNOT show a garbage
  break (the resolve stops at one); a hand-rolled duel loop needs
  `takeDeliverableGarbage`/`receiveGarbage` or both sides play solo with no
  garbage at all; and `_lookahead` does not return candidate objects (read
  the taken move through the `_took` hook). EVERY probe asserts its own
  shape and says loudly when the measurement is vacuous.
- **Chain depth, combo size, score.** Not the focus until it stops dying.

## Measure in this order

Cheap first. Every one of these steps is seconds; the duels are twenty
minutes, and a duel result cannot tell you WHY.

1. **Did the mechanism fire?** One game. If the rule narrowed nothing, the
   two runs come out bit-identical and nothing else matters. `_breaking`
   fired on 0 decisions because the escape tier is gated behind FORCED --
   a 120-duel run would have said "no effect" and not said why.
2. **Did it move the number it targets?** THIS IS A MEASUREMENT AND IT
   LIES AT n=3. Step 1 is binary and obvious -- 0 firings against 83 cannot
   be noise -- but a game length or a garbage count needs 30+ games. Read
   at n=3, the danger clock looked like 52.5s against 38.6s and 126 cells
   against 82; at 60 duels it was 28.4s against 29.7s, i.e. nothing.
   AND BOTH SIDES MUST NOT CHANGE TOGETHER: a same-setting duel says how
   long games last, never which bot is better. Use `optsB` for that.
3. **Read a board where it fired.** What did it actually choose?
4. **Only then**, survival duels, one-sided with `optsB`, sides alternated,
   120+. 60 duels is ~1 sigma and will lie to you: deepestLine read 57/43
   at 60, 52/48 at 120 and 52/48 at 240.

Both questions are worth asking and they are not the same. Head-to-head
(`optsB`, one side) asks which bot is better. Absolute survival (same
setting both sides, read game length and ceilings, never the win rate)
asks whether the bot is closer to living 21,600 frames -- which is the
actual goal. The danger clock failed both.

## Ground truth about dying

- maxHealth is 1 at level 10: topping out and dying are the same frame
  when nothing holds the drain off.
- `checkGameOver` is `health <= 0 && shakeTime <= 0`. Health drains only
  on a frame where `!riseLock && stopTime === 0 && isToppedOut()`.
- `isToppedOut()` reads row `height` ONLY. Gaps lower down are irrelevant.
- So a topped-out board holding stop time, or shaking, is ALIVE -- and
  chaining into the ceiling is how the position is meant to be held. A
  chain link cashed while topped out pays 88 to 98 frames.
- But a shield shorter than `reaction` buys no move at all.
- You do not die because you topped out. You die because you did not
  break the garbage.

## Rules of engagement

- Never revert a commit. Remove code in a new commit if it must go.
- Everything ships to `main`. panel-game work goes to `bramp/multi-player`.
- Do NOT dispatch the 35 until the bot stops dying.
- Training runs on GitHub Actions. `node -e "require('./train_pbt.js')"`
  STARTS A RUN.
