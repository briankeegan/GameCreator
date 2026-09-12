# Chips the GAME fires and the bot's own board gets wrong

`chips/` holds templates that clear BOTH verifiers. These clear only one, and
that is the point of keeping them apart rather than loosening the rule.

Every chip in here:

- **fires correctly on a live `PanelEngine.Stack`** — the game itself, via
  `verify_chips_engine.js`, which gates this directory on every push;
- **comes out wrong on `LogicalBoard`**, always the same way: the right panels
  clear, in ONE ROUND FEWER.

They are evidence, not a relaxed standard. `chips.engineonly.test.js` requires
every chip here to FAIL the simulation — so this cannot become somewhere a
chip goes to dodge a gate.

## What they all are

All 372 are `CASCADE_5` — a combo feeding a five-deep cascade. Not a scatter
across the library: the disagreement between the bot's board and the game is
*entirely* in the deepest cascades, which are also the most valuable shapes on
the board. The engine lands groups that fell different distances a couple of
frames apart and counts two chain links; `LogicalBoard` settles everything
before matching and merges them into one round.

So the bot prices a real 3-chain as a 2-chain, and it does it precisely where
the payoff is biggest. `PuyoCpu`'s `engine: true` switch is the fix; these
chips are how it is proved to be doing anything.

| group | file | chips |
|---|---|---|
| 1 | `eo1-combo7-cascade5-move5.json` | 6 |
| 2 | `eo2-combo6-cascade5-move5.json` | 10 |
| 3 | `eo3-combo7-cascade5.json` | 13 |
| 4 | `eo4-combo6-cascade5.json` | 21 |
| 5 | `eo5-combo7-cascade5-move1.json` | 25 |
| 6 | `eo6-combo7-cascade5-move2.json` | 25 |
| 7 | `eo7-combo7-cascade5-move4.json` | 29 |
| 8 | `eo8-combo6-cascade5-move2.json` | 42 |
| 9 | `eo9-combo6-cascade5-move4.json` | 42 |
| 10 | `eo10-combo7-cascade5-move3.json` | 44 |
| 11 | `eo11-combo6-cascade5-move1.json` | 45 |
| 12 | `eo12-combo6-cascade5-move3.json` | 70 |

**All 372 ported**, in twelve groups, each verified against the real
engine before it landed.
