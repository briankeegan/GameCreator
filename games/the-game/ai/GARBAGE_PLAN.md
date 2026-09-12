# Garbage: what the bot is allowed to know

## The rule

**The bot may only know what the engine has already shown it.**

When a match touches a garbage slab, the engine pops one row of that slab and
turns it into coloured panels. Those colours come from `this.rng()` —
`Stack.garbageRowColors`, a dice roll. A planner that predicted them would be
reading dice it is not allowed to see, and every chain it "found" past that
point would be a chain it cannot actually play.

So `resolve()` must not simulate past a garbage break. Not because it is hard.
Because knowing would be cheating.

## What resolve() DOES know, and must get right

Up to the break, everything:

- **which slabs break.** A match adjacent to garbage pops it — that is
  decidable from the board, and it is the thing the bot is choosing between.
- **how much breaks.** One ROW of the slab per match, not the whole slab.
- **that the slab shrinks** and the rest stays put.
- **the stop time earned.** Breaking garbage buys frames, and that is a real,
  knowable payoff — it is why breaking garbage is worth doing at all.
- **the chain and the panels cleared up to that point.**

## What it must NOT do

- Invent colours for the converted row.
- Keep resolving as if it knew them — any match those panels join is
  unknowable, so a cascade continued past the break is fiction.
- Delete the slab and carry on, which is what it does today: the board comes
  out too empty, every height is wrong, and every feature downstream reads a
  position that will not exist.

## Two bugs today, measured

`resolve_fidelity.js`, 4,898 real boards x every legal swap = 52,386 cases,
30% of the boards carrying garbage. 39 disagreements, all garbage:

1. **The whole connected slab is deleted.** `_connectedGarbage` flood-fills
   every touching garbage cell and `resolve()` zeroes all of it. The engine
   pops ONE ROW and leaves the rest standing.
2. **The popped row vanishes instead of becoming panels.** In the engine those
   cells are still occupied — by panels of an unknown colour. In the
   simulation they are empty, so the stack reads shorter than it is.

## The fix

`resolve()` stops at the first garbage break and reports it:

    { chainLength, comboSizes, garbage,
      brokeGarbage: <cells popped>,
      stopTimeEarned: <frames>,
      truncated: true }          // the cascade was NOT resolved past here

The board it leaves is the board at that moment: slab shrunk by one row, the
converted row still OCCUPIED but of no known colour, and nothing resolved
beyond it.

`truncated` is the honest part. A caller that treats a truncated resolve as a
finished one is making the same mistake in a different place, so it is a
field rather than a silence.

## What this does to the features

Eight features read `resolve()`. On a candidate that breaks garbage:

- `chainPotential`, `comboPotential`, `matchPotential` see the chain up to the
  break and no further. That is the truth: the bot cannot know the rest.
- `garbageCleared` becomes exactly right for the first time — it counts the
  row that actually popped rather than a whole slab that did not.
- A new signal is available and is the one the owner named: **stop time
  earned**. Breaking garbage buys frames, and frames are survival. That is
  knowable, real, and currently invisible to the evaluator.

## How it gets verified

TDD, both directions, before any of it is believed:

1. A test that the simulation pops ONE ROW of a slab and leaves the rest,
   against the engine on a real board that does it.
2. A test that the converted row is still occupied afterwards, not empty.
3. A test that a cascade which would continue THROUGH converted panels is
   reported `truncated` rather than resolved.
4. `resolve_fidelity.js` compares only up to the break on those cases — and
   must be exact up to it. A harness that excused a difference before the
   break would be hiding the bug it exists to find.
5. Break each of the above and require rejection, in `resolve.breaks.test.sh`.

## Order

1. Write the tests. They fail.
2. Fix `resolve()`: one row, converted cells occupied, truncate and report.
3. Fidelity to 100% up to the break, on the garbage fixture.
4. Only then, the feature work and the training.
