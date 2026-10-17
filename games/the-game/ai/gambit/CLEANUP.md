# Cleanup once the C Gambit holds

Done when a 24-game run on the C Gambit survives about as well as the JavaScript's last runs did.

## Delete: the JavaScript Gambit (`games/the-game/ai/eval/`)

- `gambit_answer.js`, `gambit_decide.js`, `gambit_propose.js`, `gambit_judge.js`
- `gambit.js`, after its rules-file reading (`Rules`, `parse`, `checked`, `rulesFor`, `aimsOf`) moves into `gambit/gambit.js`. The loader reads the rules file itself; nothing else is used.
- `gambit_agree.test.js` and `gambit_decide.test.js`: they test the JavaScript's internals.
- In `survivor_think.js`, the JavaScript path: the `GC_GAMBIT_JS` switch, `GANSWER`, the `attacker` it built for Gambit, and the `GAMBIT` require, which becomes the loader's rules.

## Rewrite: the checks that compare the C to the JavaScript

With the JavaScript gone they have nothing to compare to. Each keeps the rule it held, stated against fixed expected results:

- `gambit/rules.test.js`: the list's fits, meets and entryOf on hand-picked made lines.
- `gambit/judge.test.js` and `gambit/outcome.test.js`: the facts asserted directly (a break breaks, a line the board dies on is dead, a hold that stands lives, ready only when a break is there once landed). The judge itself was proved equal before the JavaScript is deleted.
- `gambit/break.test.js`: written as a fixed check (finds a known break on the factory board, honours its deadline, never offers a swap back). It was never committed.
- `eval/gambit.test.js`: the rules tests move to `gambit/rules.test.js`.
- `eval/gambit_answer.test.js`: already runs the C Gambit through the frame loop's mind. It stays; only its header comment changes.
- `eval/break_near.test.js`: drops the parts that call `gambit_answer.js` and `gambit_propose.js`; its `breakMoves` checks are the default bot's and stay.
- `eval/gambit_reach.js` (the reach report): searches the logged boards again with the C break search (`gambit.js` exposes it) instead of `SH.breakMoves` and `JUDGE`.

## Strip: Gambit's parts of the shared JavaScript

The C Gambit uses none of the JavaScript. What only the JavaScript Gambit called goes; what the attack profiles (agro and the like,
`opener_plan.js`, `extend_replay.js`, `attack_fire.test.js`, `bitbot.js`) call stays as it is.

- `survivor_attack.js`: delete `useRules`, `useList`, `lineOk`, `firstFits`, `floorOk`, `allowed`, `judgeIn`, `outlive`, `readyLines`,
  `readyFor`, `readyInTime`, `landed`, `landedAll`, `raiseReady`, `level`, `diesIn`, `breaksAfterLanding`, `lostMany`, `lostAlone`, and the
  judge's `readyAt`, `readyIfLost`, `readyIfBreak`, `readyBy`, `lifeTo`, `lifeRest` and `why`, with every `stepFits`/`firstFits`/`lineOk`
  call in `plan` and `extend` (they pass when no rules are set, which is how the attack profiles run them). Keep `plan`, `extend`,
  `firstClear`, `replay`, `judge`, `shapeOf`.
- `survivor_shared.js` `breakMoves`: delete the Gambit-only options -- `ok`, `stepOk`, `firstOk`, `lineOk`, `resume`, `keepOut` and the
  marks they need (`outside`, `mark`, `within`, `resumed`, `towardsOf`, `toward`). The default bot never passes them, so it plays the same.

## What the C Gambit still takes from JavaScript (checked)

`gambit.wasm` imports only `abort_poll` and `clock_ms`, the host's abort and its clock; every decision is made in C. The loader
(`gambit.js`) takes:

- `eval/native.js` -- the WebAssembly bridge every bot uses: it writes the board into `gambit.wasm` and makes the root node. It stays.
- `eval/gambit.js` `rulesFor` -- the rules file read and checked. It moves into `gambit/gambit.js` (above).
- the board as a JavaScript object, for the `GAMBITB` dump the reach report reads. It stays while the reach report reads it.
- `survivor_think.js` still loads `gambit.js` and `gambit_answer.js` for the `GC_GAMBIT_JS` switch. They go with the switch (above).

## Keep, untouched

`native.js`, `search.h`, the default bot's own code.

## Comments: every file in `gambit/`

Strip every reference to the JavaScript it came from. Each comment says what the code does and what constrains it, nothing more.

- `rules.c`, `judge.c`, `outcome.c`, `facts.c`, `rank.c`, `propose.c`, `decide.c`, `answer.c`
- `search/break.c`, `search/plan.c`, `search/extend.c`, `search/ready.c`, `search/level.c`, `search/outlive.c`
- `core/clock.h`, `core/nodes.h`, `core/sort.h`, `gambit.c`, `gambit.js`

Remove: names in parentheses pointing at JavaScript (`(attacker.judge, survivor_attack.js)`, `(gambit_judge.js outcome)`), "as the JavaScript did", "the JavaScript's null/undefined/Infinity", V8 sort notes (keep the rule, drop the history), and "ported" wording. Trim long comments to a line or two.

## Docs and gates

- `PLAN.md` becomes the layout only. Remove the porting section.
- `eval/plans/decision.md`: its "Where the code is" table points at the C files.
- `.github/scripts/gates.sh`: `gate_garbage_rules` drops the deleted tests; `gate_gambit_engine` runs the rewritten checks.
- `CLAUDE.md`: the Gambit pointer names `gambit/`.
