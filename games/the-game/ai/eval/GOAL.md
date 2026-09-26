# THE GOAL

**The bot must not die.** Surviving is a requirement, not a ranked
preference. The choices are how it chooses to live, not how it chooses to
die. If it actually dies, it should be because there was nothing it could
have played.

Target: no deaths before the duel ceiling, 21,600 frames (6 minutes).

## Read the actual board. Do not trust the readings you wrote.

A probe is code I wrote five minutes ago, and it is as likely to be wrong as
the thing it measures. A count that says "0 certified" or "8 broken" is a
CLAIM, not a finding. Before any number is believed, reported or acted on:
print the boards behind it and look at them -- the live board, the board
the check judged, the move played, and what the game actually did next --
and confirm by eye that the board shows what the number says.

This has already failed in practice: "8 certificates broke with nothing to
break them" was an operator-precedence bug that selected exactly the cases
where the opponent's garbage had just arrived. The boards would have shown
it; the count could not.

If the check says it survives, great -- then look at the board and see
that it did.

## Do not add gates. Fix the resolve.

The verdicts have to be TRUE. Before this, the bot thought it was making
saving moves and it was not -- the survival check certified a move and the
move died. That is the defect that matters, and it is not fixed by
changing which moves get offered: a filter built on a verdict that lies
refuses the wrong moves however honest the filter is.

So the work is in the RESOLVE -- `_resolveCandidate`, `_survivesRise`,
`_resolvesDead` -- and in the existing checks that already measure it:
`verify_resolve_corpus.js`, `live_fidelity.js`, `resolve_fidelity.js`.
Those checks are RED. Fix what they are pointing at. Do not write another
test file, do not add a gate, and do not make a red check green by
changing what it asks.

A gate that asks the implementation's own predicate proves nothing. If
`_resolvesDead` is wrong, `no_self_death` passes while the bot dies.

## Do not write new rules. Make the existing mechanisms work.

This is the whole method, and the record is unambiguous: eleven
hand-written rules produced one marginal success, while SEVEN existing
mechanisms were found broken and fixing them was the only real progress.
A new rule is almost always the wrong move. The machinery to survive is
already in this file -- `_survivors`, `_doomed`, `_heightCap`, `_standing`,
`_sinking`, the stop-time escape ranking, the danger clock, `breakPairs`,
`reachBreak`, the reach* family -- and when it fails it is because it is
asking the wrong question, reading the wrong board, or never running at
all.

So the question is never "what rule would help". It is: **does this
mechanism do what its comment says it does?** Check it on a board. Every
one checked so far was wrong in a way nobody had noticed:

- `_survivors` judged the SCORING board, which carries a deliberate extra
  rise -- thirteen survivable moves refused, the fatal one cleared.
- the fatality test asked the grid when only the engine can answer.
- the scratch stack never carried `shakeTime`, so candidates aged through
  a window the engine spends standing still.
- `selfInflicted` kept asking the grid after the filter moved on.
- the escape tier -- `_sinking` AND the stop-time ranking -- opens on
  2 of 89 decisions, because the danger clock that gates it is off by
  default and `versus.js` never passed it through.
- `_doomed`'s height gate read the LIVE board while every test in the
  filter is applied to a candidate's SETTLED board, which can be rows
  taller. Shut on 101 decisions in 20 duels where some candidates were
  doomed and others were not, and on 15 more where EVERY candidate was --
  which also left `allDoomedNow` unset, so `_lastResort` was blind exactly
  when it is the only thing left.
- `allDoomedNow`, `allAboveCapNow` and `allCorneredNow` are written by
  filters that can decline to run, and nothing cleared them, so the last
  answer stood in for the missing one.
- `feature_liveness.js` measured variance across a whole GAME and called
  that learnable. Only the spread WITHIN a decision can change which move
  is played; four reach sizes separate the candidates on under 5% of
  decisions.

Audited and HONEST -- do not re-audit these without a new reason:
`_standing` (1 genuine violation in 89 decisions), `_sinking` (0
violations of its claim, but dormant), `_heightCap` (0 moves kept or
played over the cap in 759 bound decisions), the resolve's garbage gravity
(a floating lid does fall when its support is stripped, and the candidate
that strips it is on the list -- it ranks about 11th of 22 on score),
`_raiseIsSuicide`'s queue arithmetic (wrong -- it sums block heights
instead of cells -- but it is called with garbage queued twice in eight
duels, so it measures nothing).

## The loop

1. Run it.
2. **READ THE BOARD** at the death. The actual grid. The move it played.
   The moves it had.
3. Find which EXISTING mechanism should have prevented it.
4. Check whether that mechanism does what it claims. It usually does not.
5. Fix it. Repeat.

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
- **Writing a new rule at all.** Eleven tried, one marginal success, and
  that one came off a board rather than out of an argument. `_ownPlay`,
  no-undo, `_deepestLine`, forcing the break, the danger clock,
  `flattenToLid`, `levelForSlab` and three earlier ones all measured worse
  or inert. If the answer looks like a new rule, the real answer is an
  existing mechanism that is not doing its job.
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

- **Reading a correlation across boards as a lever.** Break availability
  runs 3% at one column touching the lid to 21% at five, so forcing more
  columns to touch looked obvious. Built, it raised columns touching 1.89
  to 2.25 and made breaks FALL 43 to 37 and deaths RISE 8 to 10. Boards
  with five columns at the lid have breaks because of whatever shaped them
  that way. A cross-section is not an intervention; measure the
  intervention.

- **Reusing a probe without changing its target number.** The level-step
  rule was measured with the flatten rule's harness, which reports columns
  touching the lid -- not the step. It fired 110 times and whether it did
  its job is still unknown. The probe's target metric must be the rule's
  target metric.

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
- A behaviour change bumps `modes.RULES`, which restarts every PBT island
  at generation 0. That is the right cost while the bot still dies.

## Where it stands

`RULES 17`, 20 duels, two current island snapshots, same setting both
sides: avg 36.6s, longest 84.0s, ceiling reached 0 times against a target
of 360s. Every duel still ends in a death.

The shape of every death read so far: all moves pass the survival filter
at the last decision that had a save, 10 to 23 decisions before the end,
and the position is already lost. So the filter cannot discriminate there
-- its horizon is `DOOMED_DEPTH = 2` RISES, about 4 seconds, and the death
is decided 2 to 12 seconds out. The horizon is the mechanism's own
parameter and is the next thing to measure.
