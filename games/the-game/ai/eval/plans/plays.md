# Plan: what agro can do (not implemented)

## Actions — the only three things it can press

| Action | What it does |
|---|---|
| **Swap** | Walks the cursor to two side-by-side cells and swaps them |
| **Hold** | Does nothing for a moment; the stack keeps rising on its own |
| **Raise** | Holds the raise button: the stack rises a row (or more) at once, bringing new panels up from below |

## Timing

Every play has a **deadline** — the board never stops: it rises, garbage lands, the enemy recovers.
Some also have an **earliest** moment: they only work once something is moving.

| Play | How it works | Earliest | Deadline |
|---|---|---|---|
| **Break** | One swap makes a match next to the garbage; its bottom row turns into panels | now | before the board dies |
| **Big break** | Same, but the match is a combo (4+) or sets off a chain — breaks garbage **and** sends some back | now | before the board dies |
| **Break line** | A few swaps building toward a match next to the garbage; the last one makes it | now | the last swap before the board dies |
| **Lineup** | While a slab turns into panels, moves panels under it so the new ones drop straight into a match | **the slab starts popping** | it finishes popping |
| **Ready** | Arranges panels so a match will touch the next block when it lands | now | the block lands |
| **Attack** | A combo, or a pre-built chain set off by one swap; sends garbage | now | the enemy recovers / our board needs the panels |
| **Extend** | Adds a link to a chain already falling, by swapping panels into its path | **the chain is falling** | it lands |
| **Setup** | Arranges panels for a later attack; clears nothing | now | garbage lands on top of it |
| **Level** | Makes the stack flatter, or fills holes under garbage | now | the next block lands |
| **Clear** | A plain match that breaks nothing — buys a moment of room or stop time | now | the board tops out |

Plays with an **earliest** moment (lineup, extend) are the timing plays: they use movement on the board to get extra matches out of fewer panels, but only inside their window.

## Modes — what it is trying to do overall

| Mode | Goal | Plays it leans on |
|---|---|---|
| **Attack** | Hurt the enemy | attack, extend, setup, raise |
| **Defend** | Get the garbage off | break, big break, break line, lineup, ready |
| **Shape** | Make the next fight easier | level, ready, setup |
| **Scramble** | Stay alive when everything else dies | any clear that buys stop time — combos and chains first |

Underneath every mode: the **survival check** — a move that can't be proven to live is never played while one that can is.
