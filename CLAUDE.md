# GameCreator — session conventions

## Replies

Keep chat replies SHORT. Answer the question, state the recommendation,
stop. No restating the ask, no summarising work already in a commit
message, no tables or headed sections unless the answer needs structure.

Do not write the history of a decision into code comments, commit messages
or this file. Say what the thing does and what still constrains it. "We
chose X because Y went wrong" belongs nowhere — it confuses whoever reads
it next.

## What this is

A multi-game static site (no build system), deployed to
briankeegan.github.io/GameCreator/. The landing page lists every game from
`games.json`; each game lives at `games/<id>/`, is independently installable
as a PWA, and has its own "Clubhouse" chat thread. `shared/` holds the
components every game reuses (Clubhouse UI, storage, nav, PWA plumbing) —
don't fork it per-game.

## Shipping

- **Always merge to `main`.** Pages deploys only from `main` (`pages.yml`),
  so work on a branch is invisible. Resolve conflicts and say in the commit
  message which side won.
- **The gates run after the push, in CI.** `pages.yml` names the ones worth
  their own step, then `gate_fast` runs every other gate that is not in
  `SLOW_GATES` — so a gate added to `GATES` is covered without a step of its
  own. `SLOW_GATES` run nightly in `ai-slow-gates.yml`: they take hours, and
  a job that long never survives a `cancel-in-progress` workflow to reach a
  conclusion. `check_gate_wiring.mjs` fails if the set of gates no workflow
  runs grows past its recorded count. The six in `PANEL_GAME_GATES` need the
  `panel-game` checkout and stay off the deploy path. A push waits on none of
  it; `GC_RUN_GATES=1` makes `.claude/hooks/guard-main-push.sh` run the
  scoped list first (`GC_FULL_GATES=1` adds the slow ones). Only
  `SEARCH_GATES` run the survival search; the rest run with
  `GC_SURVIVAL_SEARCH=0`. Check CI after pushing — and check the run
  CONCLUDED, because `cancelled` turns nothing red.
- Every rule that matters needs three pieces: a plain-English rule where
  someone would be editing, a script that decides it mechanically, and a
  gate that runs the script on every push.
- After a conflicted merge, `grep -c` for the symbols each side owned.
  Reverting a merge makes the next merge of that branch a near no-op —
  revert the revert first, then merge.

## The Clubhouse

- Each game's thread is a permanently-open draft PR (never an Issue —
  Issues can't be subscribed to). Branch `clubhouse/<gameId>`, placeholder
  `games/<gameId>/CLUBHOUSE.md`, PR titled `Clubhouse — <name>`. Never merge
  or close these PRs.
- Messages are PR comments starting with `**<name> says:**`. Reply with
  `**Claude says:**`. A name of "claude" renders as Claude's side.
- Subscription (`subscribe_pr_activity`) is per-session. At the start of a
  session, find every game's PR number via `admin-list` or open PRs and
  subscribe to each.
- End every reply with `[v0.<run_number>]`, the `run_number` of the latest
  successful Pages run. Look it up; don't guess.
- A valid `ADMIN_TOKEN` overrides any game's secret word.
  `clubhouse.js` auto-detects it and logs in as "Admin" on any game.
- Images are committed to `games/<id>/clubhouse-images/` on that game's
  `clubhouse/<id>` branch via the relay's `upload-image`, then referenced by
  `raw.githubusercontent.com` URL.

### Autopilot

- Per-game `"autopilot": true` in `games.json` (absent = off). On, messages
  are handled by `.github/workflows/clubhouse-autopilot.yml`; off, a
  subscribed session handles them.
- **It runs on Sonnet. Do not change that** — a switch to Opus spent the
  account's API budget in a day and stopped every thread for eleven days.
  Override per run with the `model` dispatch input. One message can be three
  full runs: whole thread history, `--max-turns 250`, 12 images, 3 retries.
- Progress is one comment marked `**Claude is working:**`, edited in place.
  Lines come from `.github/autopilot/status.sh` and from the art tools via
  `GC_STATUS_HOOK`. The model may add a coarse line; it must not restate
  what the tools announce or claim completion there.
- `.github/workflows/clubhouse-sweeper.yml` runs every 15 min and dispatches
  the autopilot for any thread whose newest comment is a human message older
  than 45 min, marking it with 👀 so each message is swept at most once.
  Cancelling a run by hand therefore re-dispatches it; to stop a thread set
  `"autopilot": false`.
- Every step that can block on the network needs its own `timeout-minutes`,
  and the retry step stays gated on `failure() || cancelled()`.
- The autopilot may commit to `games/`, `.github/art/` and `docs/`. It may
  not touch `.github/workflows/`, `.github/scripts/` or `.github/autopilot/`.
- Context is built to a plan: `docs/AUTOPILOT_CONTEXT.md`. Noise is deleted,
  the owner's messages are never compacted, Claude's replies are compacted
  by Haiku once per comment and cached by comment id.

## Art

**Start at `.github/art/README.md`** — the index of every standard, prompt,
generator, cutter and check. `check_art_registry.mjs` fails the build both
ways: a tool not listed, or a path listed that doesn't exist.

- **Generate sheets, never single frames.** Frames drawn together cannot
  drift; frames drawn separately do, in colour, proportion and pixel scale.
  Ask for flat white backgrounds, never transparency.
- Rules live in `games/<id>/art-style.json`. The palette in it is enforced
  by the cutter. Every character has a spec under `characters.<id>`:
  species, per-material hexes, `appears`, `proportions`, `neverDraw`.
  Prompts are built from it and sheets are checked against it.
- Relative size between characters lives in `--body-height`, never in
  per-character draw sizes.
- Raw generations go in `games/<id>/art-src/`; shipped sheets are rebuilt
  from them, never hand-edited.
- **One front door per kind of art**, and every caller uses it:
  `generate_row.py` (character row), `room.py generate` (room pass),
  `tileset.py generate` (tiled level sheet). All share `imagegen.py`, which
  picks the in-run broker or `OPENAI_API_KEY` — a model is never handed the
  key.
- `imagegen.py` vaults every raw generation to the orphan `art-vault` branch
  and restores before spending. `force` skips the restore.
- **Point at a standard; never copy it.** Anywhere a rule would be restated
  — a workflow prompt, a game README — link instead.

### The standards

- Characters: `.github/art/CHARACTER_SHEETS.md`. Walk is 3 columns
  `[step, NEUTRAL, step]`; attack is its own sheet, `[wind-up, STRIKE,
  recover]`. Both 3 rows: down, side-facing-RIGHT, up. Canonical prompts are
  `walkgrid_prompt.txt` and `attacksheet_prompt.txt`.
- Rooms: `docs/ROOM_ART_STANDARD.md`. Three passes — a composed scene (kept
  in `art-src/`, never shipped, measured for every prop's ground point,
  height, width and count), the walkable surface (the shipped background;
  the plate IS the collision mask), and everything you cannot walk on as
  props on flat white. §7 is the numbered process with a gate on every step.
- Tiled levels: `docs/TILED_LEVEL_STANDARD.md`, `tileset.py`.
- Top-down walk sheets: RPG-Maker charset convention, three frames per
  direction, `<id>_<dir>_<0|1|2>.png`. Frame 1 is a true NEUTRAL pose, used
  both idle and as the resting beat. Playback while moving is `[1,0,1,2]`.
  RIGHT is LEFT mirrored — only down, left and up are generated. Background
  is chroma green `#00FF00` with magenta `#FF00FF` gridlines. Read
  `games/the-game/WALK_SHEETS.md` before regenerating one.
- Doors: `docs/DOOR_STANDARD.md`. A door is half of a PAIR carrying a
  `link`; arrival is derived from the partner at runtime, never typed. Two
  shapes: DERIVED (any room shape) and CONSTANT (every room the same grid) —
  prefer CONSTANT. A game is checked as soon as it publishes its door data in
  a file with no DOM in it.

### Art checks

- `pages.yml` always ships the site. `art-checks.yml` and
  `browser-checks.yml` go red on their own without blocking a deploy.
- A fuzzy check warns; an unambiguous one fails. Thresholds get calibrated
  against real art with the numbers recorded beside them.
- Every check has a test that it rejects the defect it exists for and
  accepts the correct-but-awkward case (`checks.test.py`, `cutter.test.py`).
- `verify_sheet.py`'s CROPPED test compares each frame against the median of
  its set, so it cannot see all frames being wrong the same way.
  `verify_sheet.py portrait` is the antidote: the portrait is an independent
  picture of the same person.
- Take every screenshot through `.github/scripts/shoot.js`. It deletes the
  target first, throws if nothing was written, and burns the time and commit
  into the image.
- Before hand-rolling an algorithm, find the established tool. Segmentation,
  template matching, feature matching and outlier rejection are all fields
  with libraries. `cv2.grabCut` for segmentation.
- The generator will not draw a technical diagram of its own picture.
  Collision data is authored afterwards by `build_walkmask.py`.

## Newsey ("the-game")

- An adaptation of a plot the owner wrote. `reference/the-game/PLOT.md` is a
  distillation; the VERBATIM plot is the owner's long comment on Clubhouse
  PR #30. Read the verbatim one — the distillation has lost detail that
  decides things.
- Where game and plot disagree, the plot wins unless the owner says
  otherwise.
- Character specs carry `source`: `plot`, `owner`, or `design`. Only
  `design` may be changed without asking.
- `games/the-game/TODO.md` carries the running list. Update it when the
  owner adds to it.

## The AI trainer (`games/the-game/ai/eval/`)

- **Gambit's goal is `plans/gambit-goal.md`**: every mode 24/24 on the real Training mode, then switching between them. Its rules and
  its order are there; read it before working on Gambit.
- **Gambit is C, in `games/the-game/ai/gambit/`** (layout in its README), on the one C engine (`eval/native/pa.c`). In the Lua
  client it runs in-process (`libgambit.so`, `PA_BOT=gambit`): the stack goes straight into the C engine. `gambit.wasm` and its loader
  `gambit.js` are for JavaScript hosts.
- **The truth never falters: every board Gambit's frame loop predicts is the one the game makes.** A board that differs is a plan made
  on a board that never was. The telegraph carries everything on its way, held-back garbage too, and the frame loop lands it as the
  search does. `gambit_summary.js` counts the games' own divergences and a 24-game run with any is red (`gambit-24.yml`, "The truth
  held"); `lua/check.lua` exits 1 on one.

- **Read state, never recall it: `status.sh`.** It prints what is training,
  the genome from the run's own log, the last snapshot's score and chains
  fired, the chip count, and the git/origin gap. Run it before answering any
  question about what is going on.
- **Training runs on GitHub Actions, not in this sandbox.**
  `node -e "require('.../train.js')"` STARTS A RUN. To answer "is anything
  training", look at Actions, not at `ps`.
- **Use the real puzzles**, not hand-built boards: 235 authored puzzles in
  `Puzzles.json`, 84 typed `chain`. Tools: `puzzles.bench.js` (one-swap),
  `puzzles.play.js` (multi-swap), `chain_reach.js`. In that data `8` is
  SHOCK and `9` is COLORLESS — garbage, not colours.
- **Every feature is a SHARE, not a count.** Each registry entry carries a
  `norm` and the evaluator divides by it, so a weight means the same thing
  for every feature. Divisors are analytic where the board gives one and
  calibrated against live play otherwise, with the observed maximum recorded
  beside the number.
- **A feature that never varies cannot be learned.** Run
  `feature_liveness.js` over a real game before putting a feature in a run —
  it taps the evaluator on every candidate the bot scores. `stopTimeGain`
  looked right and was constant 0 across 4,381 candidates because it needs
  three rare things at once.
- **The bot does not prefer digging. It prefers not dying, and flatness.** Both
  are floors no vector reaches: `score()` clamps `bumpiness` and `tallest` to
  STARTER's values, because a tower is where the board dies and a vector that
  zeroes them is a vector choosing to die. A break is priced, never privileged —
  a garbage cell can never come off the board and a panel can, so converting one
  is worth clearing it, deferred. Being buried and short widens the SEARCH (six
  beam slots ranked by closeness to a slab, added to the twelve price-ranked
  ones) so the option is visible; finding is not preferring.
- **An explicit instruction beats a measurement.** Say the number once, then
  do what was asked.
- **Never parse a tool's prose — make it emit data**, and have the consumer
  assert the count it got back matches the count it sent.
- **One run per condition measures nothing.** The seed-to-seed noise floor
  is ~911 points; ignore any smaller gap. `GC_GA_SEED` makes repeats
  possible.
- **A fan-out dispatch carries BOTH `variant` and `ga_seed`.** The workflow's
  concurrency key is built from them, so a dispatch missing either shares a
  group with every other one and is cancelled seconds after it starts. A 204
  from the dispatch API means the request was accepted, not that a job is
  running — verify by listing runs with `status: in_progress` and counting,
  not by counting 204s. `GC_TAG` is `pbt-<variant>-s<ga_seed>`, so a snapshot
  named `pbt-default-…` is the tell that `variant` was dropped.
- **Shipping a trained bot is one command: `ship.sh`.** It picks the newest
  real snapshot, prints what it scored, exports `ai/trained-weights.js`, and
  runs `gate_all`. It does not commit — look at the diff.
- **A snapshot is delivered, not written.** The trainer writes
  `trained.<mode>.json`; `commit_snapshot.sh` then reads its `population`,
  refuses anything under `GC_MIN_POP` (default 50), names it, commits it and
  pushes. A workflow that calls a trainer directly must set `GC_MODE`,
  `GC_TAG` and a `GC_MIN_POP` its own population clears — the head-to-head
  trainers hold 16. `snapshot_pipe.test.js` runs the whole hook against a
  throwaway repo in about a second; run it before spending hours.
- **The Lua port is checked, not reviewed.** The same evaluator lives in the
  `panel-game` checkout beside this one (`bot/PanelEval.lua`,
  `bot/WeightedBrain.lua`). `export_reference.js` writes the feature fixture
  there and `export_decisions.js` the MOVE fixture — the move the bot plays on
  400 real boards, because agreeing on every feature is not the same as
  playing the same game. Change a feature or the search and re-export, or the
  two drift apart in silence.
- **One engine: the server's.** The game and every JS tool run on
  `pa-engine.js`, the panel-game server's Lua ported line for line; the bot
  searches on `native/pa.c`. `gate_server_engine` holds both to recordings of
  the Lua (`lua/engineRecord.lua`, run in a panel-game checkout). The Lua is
  the reference. A bot is put on a board with `PuyoCpu.onPA(stack, opts, opp)`.
- A test's scratch files go beside the test, never `os.tmpdir()`.
- **A new game is a clean start.** The match clock only runs forward, so a
  clock behind the last frame's is a game begun again on the same front
  (`front_frame`): the front and its bot are made again (`frontRestart`), with
  the action window, cooldown, walk, plans and bot state of the last game gone.
  A hookup need not remember to.
- **BitBot drills run at level 10, nothing else.** `pa_drill.js` exits if a
  scenario's level is not 10.
- **A clear that breaks nothing is pressed only to live, when due**
  (`clearDue`). Put off, it begins at the front's next decision: after the
  swap played instead, once it has landed (`stepGap`); after a hold, a reaction
  and a frame later (the cooldown lifts at once only on a stopped board that is
  not topped). It is due when, begun then, it no longer lives -- the engine
  plays it from that frame as the front plays it (`clearLivesAfter`, `lineDelay`
  in `front.c`), the same judge as every line, not an estimate. While that later clear still lives, the
  stages' choice plays. No route clears for shape or spare material.
- **Time, never swaps.** A line is as good as the frame it is done, however
  many swaps it takes; nothing the bot asks is capped at a number of swaps.
  Every search that grows lines is `searchInTime` (`native/bot.c`): soonest
  press first, bounded by the time there is -- each line its own: a clear
  holds a topped board while it settles, and one that lowers the stack moves
  its loss of health later -- and a share of the decision's work
  (`workLeft`), `LINEMAX` only storage. One clock prices it all
  (`travelCost`, `stepGap`, `lineFrames`), counted from where the cursor is;
  an engine press time meets it only through `pressSeen`. A step never presses a pair still moving: the search holds each pair to the frame the board settles it (`sitWait`, every pair of the root board), and to the settle of every step of its line that disturbed it (`cellT`; a clear's is its flash, face and pops, `resolveFramesOf`). A walk presses the first frame its pair is still (`pairFree`) -- at every decision it is made again, as the judge replays it; the frame its panels last change is only the latest it waits.
- **A decision is one ordered choice (`arbitrate`).** The stages propose; the
  decision they made, the walk's target and stayAlive's choice (or the hold)
  are judged on the engine and ranked once: breaks the next garbage in time
  (it lives), lives, a clear that breaks nothing and is no combo ranks below any
  option that lives until it is due (`clearDue`), a break in reach when the next slab lands (the block the attacker's telegraph shows, none shown: a
  slab the width of the board, `waveReady`; the engine's one
  readiness, `readyInTime`, the masks' only to propose; asked only while the board left alone has a slab land in the judge's reach, `waveSoon` --
  a topped board holds the queue back), the later loss
  of health inside `LIVEHORIZON` (`liveHorizon`: the wait for the front's next decision, the walk to the farthest corner, and `NEXTMOVE` -- what one save needs), of two breaks the combo or chain before a plain
  three (`attackFirst`), a plain clear last (it clears, breaks nothing,
  is no combo or chain and fills nothing under garbage: `plain`, ranked below
  any option that lives as long -- unless the board it settles to reaches a
  combo or chain in the time there is, `optAhead`: the first clear starts it), the soonest break after it (`breakTime`:
  setup), life (what it buys once done, hollow and material spent costed
  and material converted credited, a cell a sixth of a row's rise, a panel
  worth more the fewer the board is left with, `panelWorth`), a combo
  or chain (a larger match than the board makes alone, or a longer chain) that
  digs under no pile -- between two of them `attackCmp` (one rule, which the
  setup's `bestAttack` takes too) comes before life: a combo against a chain
  by whether the other player is topped out (combos) or not (chains), two
  combos by `comboWorth` (4, 7, 6, 5, 8, 9 and more, low to high), two chains by
  length -- converted, hollow; equal: the target, the decision, the
  alternative. A swap-back keeps the board unless it ranks higher. A rule that
  overrides another after the fact belongs in this order, not after it. The
  engine is reached only through `lineJudge` and `searchInTime`, which stop at
  their share of the work (`workLeft`); the decision's closing keeps
  `FINALJUDGES` judges' work under whatever the stages measure.
  **Anything that fits the time is weighed by what it is worth, never by how
  soon it is done** (`bestPlan`, `bestAttack`: `Pick.key`); only when nothing
  fits is the soonest taken. In `bestPlan` and `bestAttack` an attack (`attackFirst`) comes
  before a clear that is neither; so it does in keepHealth's choice among its clears, ahead of the time they buy. The arbiter is also handed the attacks the
  stages did not pick (`attackOptions`: the `ATTACKOPTS` best swaps that make a combo of
  four or more or a chain, by `attackCmp`, of those the stages' own rules let
  through -- `FITS`: not refused, not too early, in time). The break stage ranks the lines it finds the same way (`lineRank`): the break that lives, ready, of two breaks -- or of two lines that save a board dying within `LIVEHORIZON` -- the later loss of health, then the combo or chain before a plain three (`attackFirst`), then life, garbage converted, hollow, the soonest. The main decision's last pick among the candidates allowed leaves the plain threes out when a combo or chain that clears is among them. Every chooser of a break asks the one comparison (`breakCmp`: the combo or chain before a plain three, then the most garbage converted, then the fewest voids, the sooner only between equals). The planner's column and row shapes are proposed by one loop over match length (`targetLines`): the game's minimum first and every longer length the board holds after it, for as long as the line search's work is not spent and more than the arbiter's final judges is left (`longSpent`) -- never a capped length. **A last resort, when nothing else is to be done** (the hold won): the soonest line that lets a perched pile down is played by its first swap if it lives, loses health no sooner and leaves less hollow than the board left alone; the next decision plans on from the board it makes -- and only from the work the decision has left over (`workLeft` beyond one judge), so it never takes from the final judges. Only options that fit the time are ranked, so a combo or chain that does not fit never takes a three's place; the arbiter does the same for two options that save a dying board. **Idle time is for setups, and for the attack they line up**: with nothing to break, the board safe and work left over, the best combo or chain any line reaches in the time there is is an option too (`reachOption`, the same one the scramble offers), played on once chosen. With no break in
  reach and the board left alone losing no health within `LIVEHORIZON` (or a line that saves the board kept), `setupOptions` adds the swaps that clear nothing and make more
  vertical twos, then flatter, as options beside the hold. The twos (`twosOf`: a colour counts once however many columns hold its pair, twice when its
  third is beside it) are what the next break's converted row completes -- six cells of six colours -- so `setupTwos` builds them, any number of swaps,
  while a pop holds a topped board. A setup must spare
  every saved line (`sparesSetups`: the kept line, target, plan and attack play
  out as well after it), must get back in time to stayAlive's line
  (`getsBackInTime`), and is credited no time for the rise it locks (`stall`). A topped board that loses health within the judge's reach (after a pop that ends with under `INSURESTOP` of stop time, a landing's shake or a stop) stages a clear one swap away: the swaps before the last of the soonest clear (`insureClear`, `oneSwapClear`): a plain three holds the rise 38 + 7 x 3 frames for three panels, pressed when it is due (`clearDue`), and no setup takes it apart.
  Among options that clear nothing (the hold, the setups) the one that leaves the
  better attack within reach wins (`optAhead`: the best attack any line reaches
  from the board it settles to in the time there is, by `searchInTime` and
  `attackFirst`), then the one with more vertical twos; the rule
  compares only a setup with the hold or another setup -- a fill or a levelling
  swap is ranked by life and hollow.
  **The scramble**, a last resort: while a stop runs or the board is topped and the board left alone
  loses health within the judge's horizon, `LINEHORIZON` (`boardDying`) and no other option outlives it, the best combo or chain any
  line reaches in the time there is is an option too (`reachOption`: the whole line judged on the
  engine, played on once chosen), and an option that makes one ranks before life.
  A clear that fills hollow under the garbage is not `early`.
- **Every decision fits the game's think budget, and every press its input
  budget.** The game holds a computer player to 8 ms of thinking a frame
  (`ThinkBudget.lua`) and to 456 actions a minute, at most 76 in any 600
  frames (`InputBudget.lua`; an action is a swap, up, down, left or right going
  down, a held direction one, raise none). `BUDGETMS` in `native/bot.c` (the 8
  ms less the frame's own work) is a decision's budget. `front.c`'s key model
  (`Pad`: `padAllowed`, `padStepToward`) is the front's and every judged
  line's alike: no key past the allowance (the walk waits for the frame it
  is), and a walk held, one action however far, from four cells, or from two
  on a calm board or a nearly spent window (`travelCost` walks the same).
  `lua/train.lua` charges the game's own `ThinkBudget` and `InputBudget` every
  frame and the scan reports both. In a game the clock cuts a decision past it and the game
  fails. The budget is counted in work inside every game, so the survival
  scan is the budget check: a decision past it is cut, the seed fails, and
  the scan reports it. A change to `native/` is pushed and scanned at once;
  `budget_check.sh` and `lua_budget_check.sh` (each decision's least time
  over several runs) are tools for calibrating work against time, not a step
  before a push. Work holds time only while every cost is charged by what it does
  (an engine frame by its path, `pa.c` `FRAMEWORK_*`; the search by its steps,
  `bot.c` `SIT*WORK`): a path newly reached that runs slow per work is
  calibrated there, with the measurement beside the number.
  The host tells the bot the game's ceiling, the time left in the frame, and
  what each frame's thinking took (`bot_time`, from `ThinkBudget`): the line
  optional work stops at (`OPTWORK`) is the frame's time left, less what the
  front takes after a decision, over the bot's milliseconds per unit of work
  (a decision's own time, among those that reach the line, at the quantile
  that leaves 1 in 10,000 of all decisions over the ceiling; the front's time is
  tracked at that quantile too, and a decision always has `OPTFLOOR` work, so a
  stalled frame cannot leave it none), the cut 9,600
  units above it, and the bot reads the monotonic clock
  every 400 units (`paWall`), so a decision whose time is up is out of budget
  like one whose work is. A host that does not call `bot_time` (the browser,
  the drills) gets the start values, and a scan no longer repeats exactly --
  except the scan dispatched with `fixed_budget`, which does not call it, so a
  build plays the same games every time: the way to compare two builds -- on
  the same engine: the scan runs on the `panel_game_ref` commit, and two scans
  compare only with the same one.
- **The frames the bot waits are think time.** The game holds a computer player to 8 ms a frame, not to one decision a reaction, so the
  front (`front.c`, the cooldown) makes the decision for the board as it stands every frame it waits and plays it when the wait ends
  if the board is the same; the guided searches for a break and for readiness (`sitKeepSlot`, `sitKeepKey`) keep their lines, steps
  waiting and boards seen in memory of their own and grow them further each frame while the position (`raPos`) stands. A search with
  a table of boards seen counts them and is full at three parts in four. Compare two builds on the fixed-budget scan (the same games
  every time); read the think budget on the ordinary one -- the fixed scan has no wall-clock guard.
- **The input budget is kept for the break, and a break takes its block's time.** A break pops its block in 38 + 7 x (3 + cells)
  frames (`pa.c matchGarbagePanels`, level 10: FLASH 28, FACE 10, POP 7), and blocks arrive about as fast as one pops, so the idle
  frames between pops decide the game. A break line takes about ten actions of the 76 a window allows, so the front (`front.c`,
  `idleVia`) does not press an idle decision (setups, lineups, readiness, an attack with nothing to save: the bot's `idle` flag: a press
  that could wait -- the board left alone loses no health, the line would still live begun later (`clearDue`), or it is a setup, lineup or readying that clears nothing) when the window has left less than
  `BKRESERVE` (3) break lines have taken (`bkActs`,
  measured; `BKFIRST` (14) until one has been seen). `GC_INPUT_LIMIT` (`survival/scan.sh`) measures what the limit costs.
- **No fixed numbers: the engine and the host say it.** The judge's reach
  (`LINEHORIZON`) is the time the engine says the board has -- the rise at its
  speed, the queue, the shake of the slab it lands, the drain -- plus the walk
  (`lineHorizon`, set once a decision). A judged line, and the settle
  simulation, run on while the engine keeps the board busy; each frame charges
  the work, so the budget bounds them. The bot decides on the queue the game
  shows: no wave is pretended before one is seen. A break converts one row of a
  block (`pa.c matchGarbagePanels`), so a slab taller than the board holds one
  row of the room (`slabRowsHeld`, `roomForBreak`). What the stages after one
  keep (`stageLeaves`) is the shares of the stages after it (`STAGESHARE`),
  so a stage that takes what is left cannot starve the ones after it.
  A board a landing slab fills is held by that landing's shake before the
  drain ends it (`pa.c checkDeath`, `nb_shake_frames`), so a break against a
  slab taller than the board still has the shake's time (`framesToDeathS`).
  A new fixed number in these paths is a bug: derive it, or read it from
  `BIN`.
- **What the bot is told is what the game shows, and it comes from the engine.** The attacker's telegraph (`train.lua`) gives the next block
  queued for the stack -- its size, and the frames until it lands (earned + `GARBAGE_TRANSIT_TIME` + `GARBAGE_TELEGRAPH_TIME` + 1 +
  `GARBAGE_DELAY_LAND_TIME`) -- through `front_telegraph`; before a wave reaches the stack the opening readies for that block
  (`waveReady`), and the fill levels in that window. No preset, no pretend wave, no constant for a size or a delay.
- **A break pops its whole block, and a plain three gives no stop time** (`pa.c` `checkMatches`, `calculateStopTime`): a topped board
  survives the end of a pop only if a combo of four or more, or a chain, bought stop time during it. So a dying decision keeps a share of
  its work (`REACHSHARE`, 15% of `OPTWORK`) for the scramble, and the planner's matches of four or more (`attackShapes`) are offered
  there from their latest start. The share was found on 48 seeds (6% to 28%): a plateau between 12% and 20%; more starves the break search.
- **A scan is 24 seeds (1 to 24), the workflow's default; never more.** The same build gave 4,164 and 20,638 on one seed in two runs (the wall-clock cut), and a mean of
  24 moves more than that between runs. `ai-survival-scan.yml` takes a `source` commit and a `seeds` list: scan a change and its predecessor
  side by side, and read a difference only above 1,500. `survival/scan.sh` runs one scan end to end (`GC_MODE`, `GC_SOURCE`: a commit, given to the workflow as its full SHA), every fetch retried. A rank or cap that moves the mean down is undone, not tuned.
- **A search loop that charges no work is not bounded by the budget.** `targetLines` had two such loops; with its garbage condition off
  (`attackShapes`) they ran 20 ms a decision on a combo board. Every loop that tries a shape charges `TSHAPEWORK`.
- **Survival is a loop on Actions. Run every step of it in the background**
  -- the push, the scan, the fetch, the rebuild -- so nothing waits on it. `ai-survival-scan.yml` plays all 24 seeds
  at once and keeps each seed's whole game (`game.log.gz`, every frame's bot
  log and board) as its artifact; `scan_deaths.sh RUN_ID DIR` fetches them and
  adds the scan to `survival_scans.tsv`. Put the scan in the death-patterns
  artifact first, then read the games there, find what the deaths share and
  add it, fix it in the shared function that decides it -- the rule, its test
  and its gate with it -- merge to main, scan again. A worse scan is tuned forward,
  never reverted. Local runs are for testing tools, not for reading games. The native bot writes one `SWAP` line to stderr for every swap it chooses (clock, route, what it clears, chains and breaks), always, so a live match's whole game can be counted from its run log, and an `ARBOPTS` line lists every option the arbiter weighed (loss of health, plain, the largest match and chain, life) whenever an attack was among them or a plain clear won; the full trace covers a match's first and last frames only. Every swap pressed is a `PRESSED` line too, and a `SWAP` line says `three 1` when its swap makes a plain match of the game's minimum with no chain: `count_threes.sh RUN.log` joins them and counts the plain threes against the combos, chains and swaps that clear nothing. A `BREAK3` line says the break chosen made no more than a plain three while a break judged in the same choice made a combo or chain. A `LONGLINES` line says how many lines of a match of four or more the planner proposed in a decision, how many were judged, and how many live, how many break and how many do both.
  Fix what exists, through the shared functions; no new rules. Every caller
  asking the same question calls the same shared function, in its best
  form (`breakLines`: every line that breaks by distance) -- two callers
  asking it two ways is a discrepancy waiting to decide a game.
  Refactor as you see it, not ahead of it: where you find two callers
  asking one question two ways, make them share the function then; leave
  what you touch better than you found it.
- **Commit and push as you go.** Every change is committed and pushed to
  `main` the moment it is made: the source first and the scan dispatched
  with it, the wasm rebuilt once, in the background, when the batch of work is done (the scan builds its own library from the source; the wasm is for the live game), a scan's line in
  `survival_scans.tsv` as soon as it is fetched. Nothing waits uncommitted
  for a scan, a rebuild or a check. Anything slow runs in the background, so
  an interruption stops nothing. One scan at a time per mode, always of the newest
  source: a change pushed while a scan runs cancels that scan and starts one
  on the new head -- a scan of code already known to be wrong measures
  nothing. Scans of different modes (`combo_storm`, `factory`, `large_garbage`)
  run side by side; `survival_scans.tsv` names the mode of each (`GC_MODE`).
  **The death-patterns artifact grows by small additions, as you go.** Each
  scan read, each change tried and each result is one finding added to it
  (`survival/viz/build.py` with the scan's `findings.json`) and republished
  at once, then the findings and any viz change are committed and pushed
  with it -- never saved up for a batch. **Every finding carries the scan's
  budgets beside its count:** frames over the think budget per 1,000
  played (the work line is set to 1; `scan_deaths.sh` prints the rate and says
  when it is over), the slowest decision, frames over the input budget. A
  change that puts either over its line is not done -- the path that costs more
  than its work charge is found and calibrated first. A search that needs more
  than a frame has may run over several frames or on a background thread; what
  counts is the frame's own response time.

## Infrastructure

- **Fetch before believing local git state.** The checkout can silently
  revert mid-session, and the Stop hook's unpushed count reads a stale
  cached ref. `git fetch origin <branch> --quiet`, then compare
  `git rev-parse HEAD` against `origin/<branch>`, before acting on either.
  `.claude/hooks/session-start-git-sync.sh` fast-forwards at session start
  when local is behind with no local-only commits.
- **Relay:** one shared Cloudflare Worker (`worker/worker.js`) for every
  game's Clubhouse and the Admin page. Per-game config (secret word + PR
  number) lives in KV (`GAMES_KV`, key `game:<id>`), not in the Worker file.
- The Worker auto-deploys from pushes to `main` via Cloudflare's Git
  integration against `wrangler.jsonc`. That file declares the `REPO` var and
  the `GAMES_KV` binding — both get wiped if omitted. Secrets stay
  dashboard-only. The non-POST response carries a `relay: "gc-rN"` marker —
  bump it when behavior changes and verify it before claiming a change is
  live. If a change seems not to take effect, check the Git connection points
  at this repo.
- **Pages deploys only on push to `main`.** Don't re-trigger runs via the
  API; push a commit.
- **`briankeegan.github.io` is reachable from here.** Use
  `.github/scripts/check_deployed.sh [ref] [path…]` — it fetches the file
  from the live site and compares hashes. A green workflow is not an answer.
  `*.workers.dev` and `api.cloudflare.com` usually are not reachable.
- `GITHUB_TOKEN` and `ADMIN_TOKEN` are Worker dashboard secrets. Never ask
  for or store them in the repo.
- **Never pre-base64-encode content** for Contents-API tools — they encode
  internally, and pre-encoding silently corrupts the file. PNGs don't
  survive these tools at all; the image Actions commit from inside the
  runner.
- **Image generation:** `generate-image.yml` (freeform — cutscenes,
  portraits, anything not seen from the room camera) and
  `generate-game-asset.yml` (applies the game's `art-style.json`, which
  means the room camera wins over the prompt). Both default `quality:
  medium` and **skip if the output exists** — pass `force: true` to replace
  a file, or it silently does nothing. Model is `gpt-image-1`; sizes
  `1024x1024`/`1024x1536`/`1536x1024`. Portraits are cropped by
  `make_portrait.py`, never by eye.
- Each game is a PWA scaffolded by `admin-create-game` from
  `games/_template/`. Don't hand-create a game's files.

## Handling a clubhouse request

1. Clear game-design ask: implement it in `games/<id>/`, push to `main`,
   reply on the PR confirming what shipped.
2. Touches the relay: it auto-deploys, but verify via the `relay` marker.
3. Ambiguous or architecturally significant: ask before building. Fix what's
   asked, pragmatically.
