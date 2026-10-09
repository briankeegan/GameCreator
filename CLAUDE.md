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

- **Read state, never recall it: `status.sh`.** It prints what is training,
  the genome from the run's own log, the last snapshot's score and chains
  fired, the chip count, and the git/origin gap. Run it before answering any
  question about what is going on.
- **Training runs on GitHub Actions, not in this sandbox.**
  `node -e "require('.../train.js')"` STARTS A RUN. The one legitimate local
  trainer is the fixture `checkpoint.test.sh` spawns and kills, so a
  `train.js` process during a gate run is that gate, not training. To answer
  "is anything training", look at Actions, not at `ps`.
- **Use the real puzzles**, not hand-built boards: 235 authored puzzles in
  `Puzzles.json`, 84 typed `chain`. Tools: `puzzles.bench.js` (one-swap),
  `puzzles.play.js` (multi-swap), `chain_reach.js`. In that data `8` is
  SHOCK and `9` is COLORLESS — garbage, not colours.
- **Every feature is a SHARE, not a count.** Each registry entry carries a
  `norm` and the evaluator divides by it, so a weight means the same thing
  for every feature. Divisors are analytic where the board gives one and
  calibrated against live play otherwise, with the observed maximum recorded
  beside the number. `normalise.test.js` rejects a missing divisor, one so
  small the feature clamps, and one so large it is squashed.
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
- **BitBot drills run at level 10, nothing else.** `pa_drill.js` exits if a
  scenario's level is not 10.
- **Time, never swaps.** A line is as good as the frame it is done, however
  many swaps it takes; nothing the bot asks is capped at a number of swaps.
  Every search that grows lines is `searchInTime` (`native/bot.c`): soonest
  press first, bounded by the time there is and a share of the decision's
  work (`workLeft`), `LINEMAX` only storage. One clock prices it all
  (`travelCost`, `stepGap`, `lineFrames`), counted from where the cursor is;
  an engine press time meets it only through `pressSeen`. `clock.test.sh`
  holds the clock to the engine; `check_time_not_swaps.mjs` fails on a cap
  coming back or a new hand-listed search.
- **Every decision fits the game's frame.** The bot plays at 60 fps:
  `BUDGETMS` in `native/bot.c` (the 16.7 ms frame less the frame's own work)
  is a decision's budget, and in a game the clock cuts one past it and the game
  fails. The budget is counted in work inside every game, so the survival
  scan is the budget check: a decision past it is cut, the seed fails, and
  the scan reports it. A change to `native/` is pushed and scanned at once;
  `budget_check.sh` and `lua_budget_check.sh` (each decision's least time
  over several runs) are tools for calibrating work against time, not a step
  before a push. Work holds time only while every cost is charged by what it does
  (an engine frame by its path, `pa.c` `FRAMEWORK_*`; the search by its steps,
  `bot.c` `SIT*WORK`): a path newly reached that runs slow per work is
  calibrated there, with the measurement beside the number.
- **Survival is a loop on Actions.** `ai-survival-scan.yml` plays all 24 seeds
  at once and keeps each seed's whole game (`game.log.gz`, every frame's bot
  log and board) as its artifact; `scan_deaths.sh RUN_ID DIR` fetches them and
  adds the scan to `survival_scans.tsv`. Put the scan in the death-patterns
  artifact first, then read the games there, find what the deaths share and
  add it, fix it in the shared function that decides it -- the rule, its test
  and its gate with it -- merge to main, scan again. A worse scan is tuned forward,
  never reverted. Local runs are for testing tools, not for reading games.
  Fix what exists, through the shared functions; no new rules. Every caller
  asking the same question calls the same shared function, in its best
  form (`breakLines`: every line that breaks by distance) -- two callers
  asking it two ways is a discrepancy waiting to decide a game.
- **Commit and push as you go.** Every change is committed and pushed to
  `main` the moment it is made: the source first and the scan dispatched
  with it, the wasm rebuild after in the background, a scan's line in
  `survival_scans.tsv` as soon as it is fetched. Nothing waits uncommitted
  for a scan, a rebuild or a check. Anything slow runs in the background, so
  an interruption stops nothing.

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
