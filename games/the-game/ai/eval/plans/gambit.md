# Plan: agro's new decision system (not implemented)

Every decision is a small schedule: what can be played, by when, and what it's worth.

## 1. What a play produces

Every candidate line (one swap or several) is played out on the engine. It is described by what it **makes**:

| Result | Meaning | What it gives |
|---|---|---|
| **Nothing** | No match | — |
| **Plain three** | A single match of 3, no chain | No stop time, sends nothing |
| **Combo** | One match of 4 or more panels | Stop time; sends a block whose width grows with the combo |
| **Chain** | Matches that set off more matches as panels fall (2+ links) | Stop time; sends a full-width block, one row per link after the first |
| **Combo + chain** | Both in one line | Both |

…and by what it **does to garbage**:

| Garbage effect | Meaning |
|---|---|
| **No break** | No match touches garbage |
| **Break** | A match touches a block: its bottom row turns into panels |
| **Multi-break** | Each chain link that touches garbage breaks it again — one row per link |

Every clearing play is one cell of this grid:

|  | **No break** | **Break** (one row) | **Multi-break** (a row per link touching garbage) |
|---|---|---|---|
| **Plain three** | plain clear | plain break | — |
| **Combo** | combo attack | combo break | — |
| **Chain** | chain attack | chain break (first link only touches) | chain multi-break |
| **Combo + chain** | combo-chain attack | combo-chain break | combo-chain multi-break |

What each row sends and buys:

| | Stop time | Sends |
|---|---|---|
| Plain three | none | nothing |
| Combo | yes | a block, wider the bigger the combo |
| Chain | yes | a full-width block, one row per link after the first |
| Combo + chain | yes, the most | both blocks |

## 2. The plays, by result

| Play | Makes | Garbage | Timing | Deadline |
|---|---|---|---|---|
| **Plain break** | plain three | break | now | board dies |
| **Combo break** | combo | break | now | board dies |
| **Chain break** | chain | multi-break | now (pre-built) or window (timed) | board dies |
| **Break line** | any of the three above, on its last swap | break | now | its last swap before the board dies |
| **Lineup** | usually a chain | break with the converted panels | window: the slab is popping | it finishes popping |
| **Ready** | nothing yet | sets up a break on the next block | now | that block lands |
| **Combo attack** | combo | no break | now | enemy recovers / we need the panels |
| **Chain attack** | chain (pre-built, fired by one swap) | no break | now | enemy recovers / we need the panels |
| **Extend** | adds a link to a falling chain | no break, or a break if the link touches garbage | window: the chain is falling | it lands |
| **Setup** | nothing | no break | now | garbage lands on it |
| **Level** | nothing | fills hollow under garbage | now | next block lands |
| **Plain clear** | plain three | no break | now | board tops out |
| **Raise** | new row of panels | — | now (not while topped) | next block lands |
| **Hold** | nothing | — | — | — |

## 3. What each play is worth

| What | Worth | Comes from |
|---|---|---|
| **Garbage broken** | rows turned into panels | breaks, multi-breaks, lineups |
| **Garbage sent** | rows and width sent to the enemy | combos, chains |
| **Stop time bought** | frames frozen | combos, chains (a plain three buys none) |
| **Panels spent** | panels cleared minus panels converted from garbage | every clear |
| **Shape** | contact and evenness after the play | level, setup, every clear |

## 4. Control: the rule table

Everything agro aims for is set by a table you write — no aim is hard-coded. Each rule:

| Part | What it says | Example |
|---|---|---|
| **When** | Conditions on either board's info (us and enemy, same fields) | enemy topped out; enemy height ≥ 9; our garbage coming heavy; we have panels to spare |
| **Aim** | The exact result wanted — any cell of the grid, with sizes | combo of 6+; chain of 3+; combo of 4+ **and** chain of 2+; must break; must not break; send ≥ 2 rows |
| **By** | The deadline it must land by | enemy recovers; next block lands; 300 frames |
| **Else** | What to do if no line reaches the aim in time | next-smaller aim; best break; hold |

Rules are read top to bottom; the first whose **When** is true sets the aim. Survival and must-do always come before any rule.

| # | When | Aim | By | Else |
|---|---|---|---|---|
| 1 | enemy topped out | combo of 4+ | enemy recovers | best break |
| 2 | enemy height 9+ | chain of 2+ | 240 frames | combo of 4+ |
| 3 | heavy garbage coming at us | a break that is a combo of 4+ or a chain of 2+ | our next block lands | plain break |
| 4 | we have panels to spare, nothing coming | chain of 4+ **and** combo of 5+ | 600 frames | chain of 3+ |
| 5 | anything else | best by worth | — | hold |

The search hunts for lines whose result meets the aim before its deadline. Among lines that meet it, the order below picks one.

## 5. Pick, in this order

| Step | Keeps | Picks first |
|---|---|---|
| 1. **Live** | plays the survival check proves live | — |
| 2. **In time** | plays whose last swap lands by their deadline | — |
| 3. **Must-do** (only some plays keep the board alive) | just those | a break that buys stop time (combo / chain break) over a plain break; then more garbage broken |
| 4. **Aim** (the first rule that matches) | plays that meet its aim | by the order in step 5 |
| 5. **Best that fits** | anything left | break that sends over plain break → garbage sent (enemy topped: combos first, else chains) → garbage broken → stop time → fewest panels spent → shape — never making a must-do miss its deadline |
| 6. **Nothing fits** | setup, level, raise, hold | whichever leaves the best attack in reach |
| 7. **Pace** | the chosen play | start it later if its deadline is far off — only the last swap must land on time |

## Example

Our board: slab on the board, a light block lands in 120 frames, we die at 300. Enemy: topped out, recovers in 90.

| Play | Makes / garbage | Done | Deadline | Fits? |
|---|---|---|---|---|
| plain break | plain three, break 1 row | 20 | 300 | yes |
| combo break (5) | combo, break 1 row, sends a 4-wide block | 70 | 300 | yes |
| chain break (2) | chain, multi-break 2 rows, sends a 1-row slab | 110 | 300 | yes |
| ready | — | 25 | 120 | yes |
| chain attack (3) | chain, sends a 2-row slab | 180 | 90 | **no** |

- Live: all. Late: chain attack dropped (lands after the enemy recovers).
- Must-do: none.
- Best that fits: breaks that also send come first. Enemy topped → combos before chains → **combo break**.
- Check: combo break done at 70, then ready 25 more = 95 ≤ 120 — the must-do still fits.
- **Plays:** combo break, then ready.
