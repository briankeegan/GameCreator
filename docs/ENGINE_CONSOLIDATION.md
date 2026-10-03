# One engine

The server's Lua (`briankeegan/panel-game`, `common/engine/`) is the
original. Everything plays by it, through as few copies as possible:

- **One JS engine: `pa-engine.js`** -- the Lua line for line. Newsey runs on
  it, and so does every JS tool.
- **One C engine: `pa.c`** -- the same rules, for speed. The bot thinks on it
  (it is linked into `bit.wasm`).
- **The Lua itself** is the reference: copies are held to it by recordings,
  and the bot's drills confirm against it.

Delete `panel-engine.js` and its C copy `engine.c` (`engine*.wasm`).

## Plan

1. **Make `pa-engine.js` able to run Newsey.** Add what the game calls
   (construction from level and seed, `panelAt`, `touchSwap`, `clampCursor`,
   events, fill) and garbage *sending* -- combos and chains to the opponent --
   ported from the Lua, not from `panel-engine.js`. Check it against Lua
   recordings.
2. **Switch the game.** Move `pa-engine.js` beside the game and repoint the
   page, `app.js`, `duel.js`, `panel-cpu.js`, `panel-rules.js`,
   `difficulty.js` and `sw.js`. Newsey's rules become the server's; the
   browser checks must pass.
3. **Port or delete the tooling.** About a hundred files under `ai/` use
   `panel-engine.js` (the trainer, chips, features, fidelity tools and their
   tests). Port what is still used to `pa-engine.js` / `pa.c`; delete the
   rest. Update `gates.sh`, the workflows and `check_gate_wiring`.
4. **Delete** `panel-engine.js`, `engine.c`, `engine*.wasm`, and the parts of
   `native.js` that only served them.
5. **The bot's drills** run on `pa.c`: `ai/eval/drill.sh SEED` -- the Lua
   deals the seed (`lua/deal.lua`), `native/drill` plays it, the bot reading
   the C board directly (`native/front.c`). No JS engine is involved. The bot
   thinks in C: a Lua call per prediction cannot fit the 10 ms budget.

## Watch for

- **The survivor bot** (`survivor*.js`) runs on `pa-engine.js` and `pa.c`;
  keep it working. It needs `pa.c` (`pa.wasm`, `pa-mt.wasm`) and `native.js`'s
  server half. Its bot reads the board through `PAEngine.View`, without
  `panel-engine.js`.
- **`pa.c` and `pa-engine.js` disagree on at least one board** (seed 13,
  frame 696, swap [9,1] pressed 10 frames later: 18 cells vs 21). Settle it
  against the Lua before trusting either.
- **CLAUDE.md** describes `panel-engine.js` as this game's engine in several
  places; rewrite those lines once it is gone.
