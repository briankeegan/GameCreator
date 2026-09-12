# Chain shapes — the ones this game actually has

WHY THIS FILE EXISTS. `ai/PUYO_REFERENCE.md`'s Tier 2 names pattern
matching as the philosophically important half of a deliberate bot:

> That last one is the important one philosophically: **it does not
> discover chain shapes, it is told them.** Humans worked out good chain
> structures over decades of competitive play, and the bot matches against
> that library.

Puyo's library is rich — GTR, Sullen GTR, Fron. **Panel de Pon's is not.**
Its documented competitive library is one shape and its mirror:

> "the staircase and its mirror are noted as the only two worth practising
> deliberately. The flat board is where you live between setups, not a
> chaining plan."
> — paneponattack.com

That is a finding, not a shortcut. Anyone arriving here expecting to port a
template library should know there is no library to port; there is one
shape, and the work is in measuring it properly rather than in collecting
more of them.

## The staircase

Source: https://paneponattack.com/how-to-set-up-a-staircase-panel-de-pon-chain-ready-shape/

Two colours. **A** is the trigger, **B** builds the steps.

- **The base** is a horizontal match of A, completed by one swap. This is
  the trigger, and it is the part that makes the shape a chain rather than
  an ornament.
- **Each step** sits one row higher and one column across from the last: a
  PAIR of B with an EMPTY GAP directly beneath it.
- **It fires downward-up.** The A match clears, a B falls into the gap
  below it and completes that pair into a match, that clear frees the gap
  above, and so on. One swap, one link per step.
- **Offset by exactly one row and one column**, or the timing leaves the
  clear-delay window and the cascade breaks into separate matches.
- **Build below the halfway line.** Steps that climb too high break the
  timing.
- **Extending** is the same offset repeated — four and five step
  staircases are the three-step shape continued.

### What this means for the evaluator

A staircase WITHOUT ITS TRIGGER IS NOT A CHAIN. It is a stack of loaded
pairs with no way to set them off, and it scores nothing until a trigger
appears. `staircase` as first built counted the diagonal run of loaded
steps and never looked for the trigger, so a shape that fires and a shape
that cannot scored identically — which is a candidate explanation for why
it measured NO EFFECT across four runs against a 4-run baseline.

The distinction to measure is therefore not "is there a staircase" but
"is there a staircase I can FIRE".
