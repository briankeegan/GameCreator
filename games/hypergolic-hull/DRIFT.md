# Drift — a proposal

Status: **proposal, not built.** Nothing in this document is implemented.

## The problem it is for

Measured on 60 seeded runs of the shipped game:

- **70% of turns are movement**, 24% firing, 6% recharging.
- **41% of all rounds are played on a board with no living enemy on it.**
- Of 4,306 move-turns, **nine** happen adjacent to a hostile. 87% have nothing
  within three hexes.
- 1,511 shots produced 1,411 kills — **1.07 shots per kill**. A fight is one
  exchange.
- Hostile density is **1 per 14–25 hexes**. The reference small-board
  roguelike (868-HACK) runs about 1 per 6.

So a sector is a six-to-eight hex walk containing 2.7 hostiles that each die
to the first shot that reaches them. It is not a fight with walking in it; it
is a walk with interruptions.

Measured non-fixes, each one variable changed against the same 60 seeds:
halving the energy bus (16 wins -> 8, turn mix unchanged), doubling the roster
(0 wins), giving every class 2 hull (0 wins), moving the gate to 2-3 hexes
(turn mix unchanged), trickling the roster in as waves (makes one-at-a-time
worse). A generic second action for both sides left the mix at 23% fire / 72%
move — twice the actions, same proportions, because the extra action goes into
walking too.

## The rule

A ship has a VELOCITY: a heading (one of six) and a speed.

At the end of every round it moves `speed` hexes along `heading`. **This is
free and is not the action.**

The action, once per round, is one of:

- **BURN** — add one hex of velocity in a chosen direction, vector-added to
  current velocity. Burning against your motion is how you brake.
- **FIRE** a weapon.
- Everything that is already an action (recharge, raise shields, dock).

Speed is capped by the drive in the hold: Sublight 1, Ion Drive 2, plus the
Afterburner's +1. Same numbers the hold already derives as `moveRange`.

**Facing follows heading.** You point where you are going.

## Why this and not "move plus an action"

Both hand the walking turns back. Drift charges for them:

- A course change COSTS THE TURN YOU WOULD HAVE SHOT IN. Every round is "am I
  happy with where this is taking me, or do I fix it" — two things wanted, one
  action. The game currently has no such dilemma anywhere.
- Momentum is a COMMITMENT, and a commitment is what makes a telegraph bite.
  Perfect information about a vector you cannot take back is a real threat;
  perfect information about a ship that can step anywhere is a lookup.
- Facing stops being a free tap, so every arc weapon already in the game wakes
  up. The Stern Battery becomes the gun for the thing you just flew past.

## Speed is a real choice in both directions

Speed does not reduce your options, it DISPLACES them. At any velocity you
have roughly seven landing hexes next round: where momentum takes you, plus or
minus one burn. What changes is where they are.

- At speed 0 they surround you and include **staying put**.
- At speed 3 they are a cluster three hexes away and **"here" is not among
  them.**

So: fast is right when you know where you want to be — crossing the sector,
reaching a wreck first, breaking out of a closing ring, leaving through the
gate. Slow is right when you do not know yet, or when the thing you want is to
stay: holding a berth, guarding something, keeping inside your own gun's arc.

Two things make speed actively rewarding rather than merely survivable:

- **Ram damage scales with speed.** A fast pass is a strafing run. This also
  gives the Skirmisher the identity it does not currently have.
- **Speed outruns telegraphs.** At speed 1 you can only ever be one hex from
  where you were, so a widening threat ring catches you. At speed 2 you are
  already past it — which makes going fast the answer to being surrounded, a
  situation the game currently has no answer to at all.

## The board edge

Under drift the edge is the one hazard that cannot be stepped off, so its rule
IS the game. The engine currently has an asymmetry here — shoved into rock or
off the edge a hostile is destroyed, the flagship "braces against it" and takes
one — which stops being a nicety and has to be decided on purpose.

**Rule: the edge is lethal only at speed.** At speed 0-1 you brace, stop, take
1. At speed 2+ you are gone.

This prices speed instead of banning it, it is readable because your own speed
is on screen, and it makes the edge a weapon: shove-off-edge is already
implemented, so forcing an overcommitted hostile to overshoot is a kill without
firing.

**The gate is an edge hex you fly THROUGH, not land on.** You must arrive with
velocity carrying you out. Too slow and you stall against the boundary;
overshoot and you are past it and must come around.

That converts the exit — presently the largest single block of dead walking in
the game — into the climax of the sector: line up a vector while three ships
converge. Same problem every time, different solution every time. Missing it
costs rounds, which is where an escalation clock would earn a place rather than
being bolted on.

**Docking works the same way**: pass through the berth at speed 1 or less. The
price of shopping is slowing down, and slowing down is being catchable.

## Scenarios

**Sector 1, one Interceptor, gate seven hexes up.** Burn north once. Now every
round drifts a hex north and leaves the action free. The Interceptor closes
under its own momentum. Speed 1 carries you through the gate. The tutorial
still teaches move-then-shoot, but nothing is spent on transit.

**The range-2 kiter.** It has velocity now, so it cannot hover. If it runs at
speed 1 and you chase at speed 1 you still never catch it — you must burn to 2,
close, and you will OVERSHOOT. Engagements become passes rather than slugging
matches. **This is the proposal's biggest risk**: if the re-approach arc is
long, drift produces MORE chasing, not less. It is why ram-on-pass and the
Stern Battery matter, and it is the first thing a prototype must measure.

**Braking into a corner.** At speed 2, one hex from the edge, you are dead and
have been for two rounds. Readable, and survivable only if you started braking
earlier — which is the point. Generation must not produce starting positions
with no legal out.

**Rock at speed.** Stop plus 1 damage at speed 1; 2 damage at speed 2+. Any
harder and the board becomes a minefield and slow play dominates.

**Minimum-range weapons.** You blow through the min-range band of an Arc Beam
in a single round, so firing it becomes a timing problem rather than a
standing-still problem. This is a gain.

**The Bulwark.** No drive, so it is a fixed problem with fixed rings, attacked
by passes through its arcs. Probably improves.

## What it costs

- The auto-router and the test pilot both assume free step-by-step movement.
  Both need rewriting; the pilot's `routeStep` is a single-hex BFS.
- Tap-to-move becomes tap-a-direction-to-burn, and it lives or dies on drawing
  a clear ghost of where you and every hostile will be next round. Clarity is
  the binding constraint here, not cleverness.
- Hostiles need velocity too, or it is the game cheating. Their movement code
  is small — `decideIntent` only ever steps one hex — so this is tractable, but
  it is a rewrite of that function rather than an edit.
- Balance goes to zero. Every number in the game is priced against a
  one-hex-per-turn world.

## The smallest honest prototype

Speed capped at 1. Drift resolved before the enemy phase. Ghost path drawn for
both sides. Edge and gate rules as above. Nothing else changed.

That is enough to answer the only question that matters — does the re-approach
arc make this better or worse than what we have — and it is a day, not a
rewrite.
