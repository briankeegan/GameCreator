#!/usr/bin/env bash
# The full "is this repo safe to ship" gate suite — ONE library, sourced from
# two places, instead of two copies that can drift:
#
#   - pages.yml runs each gate as its own named Actions step, AFTER a push
#     has already landed on main, as the final safety net everyone sees in
#     the Actions UI.
#   - clubhouse-autopilot.yml runs gate_all as ONE pre-flight step, on the
#     model's uncommitted working-tree edits, BEFORE landing anything — so a
#     change that would fail here never reaches main in the first place.
#
# WHY THIS EXISTS. The autopilot committed and pushed a Dog Punk change
# twice in a row that pages.yml's own "Verify the art index" gate rejected
# both times (a new .github/art/rollsheet_prompt.txt with no README row) —
# the rule was stated in the model's prompt in one sentence, but nothing
# actually RAN the check before the commit landed. The autopilot found out
# the same way a human scrolling the Actions tab would: after the fact, from
# a failed Pages run, by which point the site was stuck serving the PREVIOUS
# version for every game, not just this one. Running the real gates before
# committing turns "shipped, then discovered broken" into "never shipped
# broken" — the only fix that actually closes the gap, rather than getting
# better at describing the gap after it already happened.
#
# Each gate_* function: prints its own name/output, returns the check's exit
# code (0 = pass). gate_all runs every one, reports which failed, and
# returns nonzero if any did — callers decide what to do with that (pages.yml
# via its own per-step failure; the autopilot by refusing to land and saying
# exactly what broke).
set -uo pipefail

_gate_pip_installed=0
gate_ensure_pip() {
  [ "$_gate_pip_installed" = 1 ] && return 0
  python3 -m pip install --quiet --disable-pip-version-check pillow numpy
  _gate_pip_installed=1
}

gate_engine_tests() {
  local status=0
  for f in games/*/engine.test.js; do
    echo "== $f =="
    node "$f" || status=1
  done
  return $status
}

gate_room_exits() {
  node .github/scripts/check_room_exits.mjs
}

gate_shared_module_wiring() {
  node .github/autopilot/sync-precache.js
}

gate_doors_enterable() {
  gate_ensure_pip
  local status=0
  for d in games/*/story.js; do
    g=$(dirname "$d")
    [ -d "$g/art" ] || continue
    echo "== $g =="
    python3 .github/art/remap_doors.py "$g" --check || status=1
  done
  return $status
}

gate_room_props_floor_plates() {
  gate_ensure_pip
  local status=0
  for d in games/*/; do
    [ -f "$d/story.js" ] || continue
    echo "== $d =="
    python3 .github/art/room.py verify "${d%/}" || status=1
  done
  return $status
}

gate_art_index() {
  node .github/scripts/check_art_registry.mjs
}

gate_art_refs() {
  node .github/scripts/check_art_refs.mjs
}

# A SPRITE CARRIES NO BACKGROUND. Shipped broken twice for the same reason —
# nothing said what an icon was supposed to look like, so nothing caught one
# that drifted. See check_icon_cutout.mjs.
# NOT IN THE GATE LIST YET. It fails today: 29 icons across two games carry a
# backdrop, and they have to be regenerated before this can block a push.
# Wire it into the list below the moment they are.
gate_icon_cutout() {
  node .github/scripts/check_icon_cutout.mjs
}

gate_sprite_scale_consistency() {
  node games/the-game/sprite-scale.test.mjs
}

# THE SHIPPED BOT, AND THE TOOLS THAT MEASURE IT. This ran only in
# pages.yml until now — i.e. after the push, which is the exact shape of
# miss this file's header is about: the gate that would have caught it
# lived somewhere gate_all did not look.
gate_shipped_weights() {
  node .github/scripts/check_shipped_weights.mjs .
}

gate_shipped_weights_check_fires() {
  bash .github/scripts/shipped_weights.test.sh
}

# THE CHAIN SHAPES, AND THE CHECK THAT THEY FIRE HERE. The chips come from
# another engine's verification; this re-earns it against LogicalBoard, so a
# chip that pays nothing here can never steer the bot.
gate_chips_verify() {
  node games/the-game/ai/eval/verify_chips.js
}

# EVERY FEATURE IS SCORED, AND EVERY FEATURE MOVES — in a real game, not in a
# script. A feature that is never scored is unwired; one that is scored but
# never varies cannot be learned, because every genome sees the same value and
# its weight drifts free. Both look like "fine" from anywhere else.
#
# It plays the real scenarios because the cheap version lied: scoring static
# boards reported six features as never moving, and six features were nearly
# cut on that. They move fine — that script had no garbage, no cursor and no
# live game.
gate_garbage_rules() {
  node games/the-game/ai/eval/garbage.test.js &&
  node games/the-game/ai/eval/survivor_mind.test.js &&
  node games/the-game/ai/eval/survivor_room.test.js &&
  node games/the-game/ai/eval/threesLast.test.js &&
  node games/the-game/ai/eval/raiseTo.test.js &&
  node games/the-game/ai/eval/cursorWalk.test.js
  node games/the-game/ai/eval/holdWalk.test.js
}

# EVERY FEATURE IS A SHARE, NOT A COUNT.
#
# The reference normalises each metric to 0..1 so a weight is that feature's
# share of the decision. Raw counts on different scales leave the search
# hunting each feature's magnitude as well as its direction, and the loop's
# +-5% jog then moves a small-range feature far more coarsely than a
# large-range one. This checks every feature carries a divisor, that the
# evaluator applies it, and that the divisor is neither too small (the
# feature clamps and loses its top end) nor so large the feature is squashed
# into a sliver it cannot steer from.
gate_normalise() {
  node games/the-game/ai/eval/normalise.test.js
}
# SURVIVAL'S ORDER: on a board topped by slabs, a swap that breaks garbage is
# played over a bigger clear away from it (survival_rules.test.js, one
# decision); and the distance planner finds the break on example boards, every
# line it proposes breaking when replayed (planner.test.js).
gate_survival_rules() {
  node games/the-game/ai/eval/survival_rules.test.js &&
  node games/the-game/ai/eval/planner.test.js
}

gate_features_live() {
  node games/the-game/ai/eval/feature_liveness.js 2 all
}

# THE CHAINS-FIRED MEASURE, BOTH DIRECTIONS. Score cannot tell you whether a
# bot learned to chain, so the trainer reports this beside it — and a run that
# comes back SHORT reports a smaller number that reads exactly like a bot that
# chains less. This proves the assertion catching that actually fires, and
# that puzzles.play.js still emits the data it reads.
gate_chain_measure() {
  node games/the-game/ai/eval/chainmeasure.test.js
}

# The status tool's duplicate-run warning. It fires about once a year, which
# is exactly the kind of check that turns out never to have worked — and it
# did not: the first version could not fire at all, and this test is what
# found that.
gate_status_tool() {
  games/the-game/ai/eval/status.test.sh
}

# The short run that guards the long one. It only earns its four minutes if it
# can fail, and its first version failed a HEALTHY run (it demanded every
# weight be non-zero after two generations) — which is the other way a checker
# dies, by being switched off.
gate_smoke_checker() {
  node games/the-game/ai/eval/check_smoke_run.test.js
}

# A TRAINING JOB THAT CANNOT RESUME THROWS AWAY EVERY HOUR IT RAN. Every
# GitHub run ends on its deadline, and every one of them used to delete its own
# checkpoint on the way out, so the next one opened at generation 1. Five and a
# half hours, twice, with nothing about it looking wrong. Runs three real
# tiny searches, so it costs about a minute.
# A WHOLE LEG FINISHES, NOT JUST THE PARTS.
#
# Everything else that runs train_pbt.js passes GC_PBT_INIT_ONLY, which
# returns before a leg happens — so the loop that runs the islands, faces the
# champions off, migrates, plays the held-out duels and writes the snapshot
# had no coverage at all. The failure it exists for is a callback that never
# fires: the leg stops, the job sits until its timeout, and from outside a
# broken leg and a slow one look identical.
gate_pbt_leg() {
  node games/the-game/ai/eval/pbt_leg.test.js
}

gate_checkpoint_resume() {
  bash games/the-game/ai/eval/checkpoint.test.sh
}

# NO POPULATION IS STRANDED AT A NAME NOTHING WILL OPEN.
#
# The checkpoint filename is a hash of the run's fingerprint, so changing
# how that fingerprint is SPELLED renames every existing checkpoint out of
# existence. The files stay committed; the runs stop finding them, open a
# fresh search at generation 0, and report nothing wrong — which is how five
# runs' populations (60, 27, 22, 3 and 2 generations) ended up unreachable
# on 2026-09-16 with a green build the whole time.
#
# --check fails the push that does it, and --apply carries the populations
# across. The test proves both directions: that it recovers the stranded
# file, and that it refuses one that would overwrite a live run with an
# older copy.
# THE PUYO LOOP'S UPDATE RULE IS THE WHOLE ALGORITHM.
# train_versus.js is twenty lines of loop around one line of arithmetic. A
# wrong rule still produces plausible weights for hours, so the rule is
# asserted directly — in the source AND by running it.
gate_versus_loop() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/versus_loop.test.js
}

# THE DUEL IS THE WHOLE FITNESS FUNCTION, and it is one bit.
# Every way that bit can be wrong is a way the training signal is wrong in
# silence: a favoured seat, a seed nothing reads, garbage that never crosses,
# or a ceiling handed out as a free half-point to whichever side refused to
# play. Asserted here rather than inferred from the weights that come out.
gate_versus_duel() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/versus.test.js
}

# A SNAPSHOT IS NOT WRITTEN, IT IS DELIVERED.
# The trainer writing trained.<mode>.json is step one of five; the other four
# are commit_snapshot.sh reading the population, comparing it against
# GC_MIN_POP, naming, committing and pushing. Step two silently ate every
# snapshot of two five-hour legs. This runs the hook against a throwaway repo
# in about a second.
gate_snapshot_pipe() {
  node games/the-game/ai/eval/snapshot_pipe.test.js
}

gate_checkpoint_names() {
  node games/the-game/ai/eval/migrate.test.js &&
  node games/the-game/ai/eval/migrate_checkpoints.js --check
}

# A RUN STOPS CLEANLY EVEN WHEN ONE GENERATION IS LONGER THAN THE MARGIN.
#
# The deadline is checked BETWEEN generations, because a generation cannot
# be interrupted halfway. Asking "am I past the deadline" starts a
# generation that cannot finish, the runner cancels the job mid-generation,
# finish() never runs, the snapshot hook never fires and the checkpoint is
# never committed -- so the whole run is lost and the next one starts at
# generation 0 and does the same. survdens2 did that twice for twelve hours
# of runner time and zero generations kept. Both directions: the slow
# variant must stop, and a healthy five-hour run of short generations must
# be untouched.
gate_deadline_stop() {
  node games/the-game/ai/eval/deadline.test.js
}

gate_pbt_stop() {
  node games/the-game/ai/eval/pbt_stop.test.js
}

gate_flags() {
  node games/the-game/ai/eval/flags.test.js
}

gate_pbt_dirs() {
  node games/the-game/ai/eval/pbt_dirs.test.js
}

# THE SERVER'S ENGINE: pa-engine.js replays real play on the panel-game
# server's Lua engine (pa.record.jsonl.gz, made by lua/engineRecord.lua) and
# must land on every recorded state; pa-generator.js deals what the Lua dealt;
# native/pa.c must match pa-engine.js frame by frame; and a batch of its steps
# on threads must be the same steps.
gate_server_engine() {
  node games/the-game/ai/eval/pa_engine.test.js &&
  node games/the-game/ai/eval/pa_generator.test.js &&
  node games/the-game/ai/eval/native_pa.test.js 20000 &&
  node games/the-game/ai/eval/native_batch.test.js &&
  node games/the-game/ai/eval/native_countdown.test.js &&
  node games/the-game/ai/eval/native_arrivals.test.js
}

# THE CLOCK IS THE ENGINE'S: every line the bot judges in a real game, priced
# by the searches' clock and by the engine, the clock never later
# (clock.test.sh). Needs the panel-game checkout and luajit for the deal.
gate_clock() {
  GC_PANEL_GAME="${GC_PANEL_GAME_LIVE:-${GC_PANEL_GAME:-}}" sh games/the-game/ai/eval/clock.test.sh
}

# TIME, NEVER SWAPS: BitBot's searches are the shared search in time, and no
# cap in swaps comes back (check_time_not_swaps.mjs).
gate_time_not_swaps() {
  node .github/scripts/check_time_not_swaps.mjs
}

# BitBot's search in C (native/bit.wasm) gives bitmatch.js's answer for every
# legal swap of every real board, and the module loads at all.
gate_bitnative() {
  node games/the-game/ai/eval/bitnative.test.js
}

# What a board can fire next move, size by size (modes.REACH).
gate_reach() {
  node games/the-game/ai/eval/reach.test.js
}

# The bot's cursor walks one cell a step and its travel is priced in frames.
gate_cursor() {
  node games/the-game/ai/eval/walk.test.js &&
  node games/the-game/ai/eval/travel.test.js
}

# The LOVE RNG and panel generator give the real engine's own test vectors.
gate_love_rng() {
  node games/the-game/ai/experiments/love_rng.test.js
}

# The session hook that resumes a training run.
gate_resume_hook() {
  bash .claude/hooks/resume-training.test.sh
}

# THE TRAINING PRE-FLIGHT SUITES, WHICH gate_all DID NOT RUN.
#
# ai-train.yml runs five suites before it spends five hours -- features,
# puyocpu, training, rise, density -- and gate_all ran ONE of them. So a
# change could pass gate_all locally, be pushed to main, and be rejected by
# the pre-flight of every training run afterwards. That happened: the
# predictive deadline stop replaced the comparison training.test.js was
# grepping for, gate_all went green on 46 gates, and the next two dispatches
# died on the pre-flight in six minutes.
#
# This repo has the rule already -- "RUN gate_all BEFORE PUSHING TO main" --
# and it is worth nothing while gate_all is a SUBSET of what CI runs.
# check_preflight_gated.mjs keeps the two lists equal from now on.
#
# rise.test.js needs the real attack files: it refuses to run on a
# garbage-free board, where the effect it measures reads as a fifth of its
# real size. panel-game sits inside the workspace on a runner and beside the
# repo in a sandbox, so look in both -- and FAIL if it is nowhere, rather
# than skipping, which would be a gate that cannot fail.
_gc_training_dir() {
  if [ -n "${GC_TRAINING_DIR:-}" ] && [ -d "$GC_TRAINING_DIR" ]; then
    echo "$GC_TRAINING_DIR"; return 0
  fi
  local root; root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  local c
  for c in "$root/panel-game" "$root/../panel-game"; do
    if [ -d "$c/client/assets/default_data/training" ]; then
      echo "$c/client/assets/default_data/training"; return 0
    fi
  done
  echo "panel-game checkout not found — set GC_TRAINING_DIR" >&2
  return 1
}

# ai-train.yml sets GC_TRAINING_DIR on the STEP, so all five suites get it.
# These gates do the same, one helper each, rather than guessing which of
# them needs it -- density.test.js scored 7/8 without it and 8/8 with, and
# reported the difference as "density REACHES THE BOT" failing rather than
# as a missing environment variable. A suite whose VERDICT depends on an
# unset variable, silently, is the whole problem this file exists for.
gate_puyo_cpu() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/puyocpu.test.js
}

gate_training_harness() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/training.test.js
}

# CAN THE BOT SEE A CHAIN CONTINUATION.
#
# The engine scores a match on an already-`chaining` panel as a chain link,
# paying the chain stop-time formula and sending a full-width slab. resolve()
# models that flag within its own cascade and started it all-false, so a swap
# into a cascade ALREADY RUNNING read as a plain three. The bot decides while
# panels are chaining on 11.2% of its decisions, and BUILD dropped those
# moves as worthless. Asserted against the engine, on boards reached in real
# play rather than built by hand.
gate_chaining() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/chaining.test.js
}

# THE OTHER BOARD REACHES THE BOT, AND IN A SHAPE THAT CAN CHANGE A DECISION.
#
# A number identical across every candidate shifts all the scores equally and
# cancels out of the ranking, so a plain "their headroom" feature does nothing
# whatever its weight — incomingGarbage was written that way and varied in 0
# of 179 decisions. pressure and overkill scale THIS MOVE'S send by their
# room, so they vary with the send. They state no rule about what to do.
gate_opponent() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/opponent.test.js
}

gate_modes() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/goal.test.js
}

# EVERY SUITE THE TRAINING PRE-FLIGHT RUNS IS ALSO A GATE.
gate_preflight_gated() {
  node .github/scripts/check_preflight_gated.mjs
}

# THE SEARCH JUDGES THE BOARD THE MOVE WILL LAND ON, NOT THE ONE IT STARTED
# FROM. If a row arrives while the bot walks to a swap, the row is there when
# the swap happens; if none arrives, it is not.
#
# Before this, `rise: true` added exactly one row to EVERY candidate however
# long it took to reach and `rise: false` added none to any of them -- so a
# far swap and a near swap were judged on the same board, which is the whole
# difference between a move made too soon and the same move made in time.
#
# Nothing in it is estimated: travel.cost plus the bot's own reaction for the
# frames, PanelEngine.riseTime(speed) from the live riseTimer and
# displacement for the rate, and advancePassiveRaise's own
# (!riseLock && stopTime === 0) for the pause -- which is why banked stop
# time keeps the board still. The cascade's duration is not needed at all:
# updateRiseLock holds riseLock while panels are active, so the stack does
# not rise during a cascade.
gate_elapsed_rise() {
  node games/the-game/ai/eval/elapsed.test.js
}

# The four constraints a template carries, pinned directly. Two of them were
# silently unenforced for the matcher's whole first life (Int8Array stamp
# truncation) and the test nearest the defect could not see it.
gate_chip_matcher_constraints() {
  node games/the-game/ai/eval/chipmatch.test.js
}

gate_features() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/features.test.js
}

# EVERY FIELD AN OPTION CARRIES IS READ BY EVERY RANKER THAT RANKS OPTIONS.
#
# Eleven times in one session the same defect: a quantity added to the option list
# and priced in one ranker, while the route that picked the move on the dying board
# ranked by the other and never saw it. Reads the source rather than playing a
# game, because a term nobody reads has no board on which it gives a wrong answer
# -- only one where it does nothing.
gate_option_pricing() {
  node games/the-game/ai/eval/check_option_pricing.mjs
}

gate_gates_reject_defects() {
  bash .github/scripts/gates.test.sh
}

gate_gate_wiring() {
  node .github/scripts/check_gate_wiring.mjs
}

gate_generator_rules() {
  node .github/scripts/check_generators.mjs
}

gate_art_vault_roundtrip() {
  bash .github/scripts/vault.test.sh
}

gate_generation_money_path() {
  python3 .github/scripts/generation.test.py
}

gate_walk_sheet_cutter() {
  gate_ensure_pip
  python3 .github/scripts/cutter.test.py
}

gate_art_checkers_fire() {
  python3 .github/scripts/checks.test.py
}

gate_character_spec_provenance() {
  node .github/scripts/check_character_specs.mjs
}

# Ordered "name:function" pairs — the single source of truth for what must
# pass before this repo is safe to ship. Add a new gate ONCE here (a
# gate_* function above, one entry below) and both callers pick it up: a
# gate added to only one caller only protects that caller.
# SLOW GATES RUN IN CI, NOT IN THE PUSH HOOK. The hook sets GC_DEFER_SLOW=1
# and gate_all skips these, printing each as DEFERRED; ai-slow-gates.yml runs
# gate_slow nightly. The list is
# measured, not guessed: each took over SLOW_SECONDS seconds on its own
# (times beside them, 4 cores, 2026-09-28). gate_all prints its slowest
# gates at the end of every run; move one here when it crosses the line.
SLOW_SECONDS=10
SLOW_GATES=(
  gate_gates_reject_defects # 90s
  gate_puyo_cpu             # plays whole games with the survival search
  gate_training_harness     # 156s
  gate_snapshot_pipe        # 154s
  gate_versus_duel          # 123s
  gate_checkpoint_resume    # 73s
  gate_pbt_leg              # 64s
  gate_modes                # 53s
  gate_features_live        # 37s
)
# ONLY THESE RUN THE SURVIVAL SEARCH. It is what they test. Every other gate
# tests something the search sits on top of, so it runs with
# GC_SURVIVAL_SEARCH=0: the search costs seconds per decision and its
# decisions trip bench.js's 85ms timing guard, which zeroes the game.
SEARCH_GATES=( gate_puyo_cpu )
_gate_exec() {
  local g
  for g in "${SEARCH_GATES[@]}"; do [ "$g" = "$1" ] && { "$1"; return; }; done
  GC_SURVIVAL_SEARCH=0 "$1"
}
_gate_is_slow() {
  local g
  for g in "${SLOW_GATES[@]}"; do [ "$g" = "$1" ] && return 0; done
  return 1
}
gate_slow() {
  local overall=0 g
  for g in "${SLOW_GATES[@]}"; do
    echo "=== SLOW GATE: $g ==="
    _gate_exec "$g" || { overall=1; echo "FAILED: $g"; }
  done
  return $overall
}

GATES=(
  "engine tests:gate_engine_tests:games/"
  "room exits:gate_room_exits:games/"
  "shared-module wiring:gate_shared_module_wiring:games/"
  "doors can be entered:gate_doors_enterable:games/"
  "room props and floor plates:gate_room_props_floor_plates:games/"
  "the art index:gate_art_index:art"
  "art references:gate_art_refs:art"
  "characters keep one size while walking:gate_sprite_scale_consistency:art"
  "chain chips fire in our engine:gate_chips_verify:games/the-game/ai/"
  "every feature is wired and moves:gate_features_live:games/the-game/ai/"
  "the chains-fired measure accepts and rejects:gate_chain_measure:games/the-game/ai/"
  "the status tool sees a duplicate run:gate_status_tool:games/the-game/ai/"
  "the training smoke check accepts and rejects:gate_smoke_checker:games/the-game/ai/"
  "a training run that ran out of time can resume:gate_checkpoint_resume:games/the-game/ai/"
  "no checkpoint is stranded by a rename:gate_checkpoint_names:games/the-game/ai/"
  "the puyo loop update rule:gate_versus_loop:games/the-game/ai/"
  "the duel that decides fitness:gate_versus_duel:games/the-game/ai/"
  "a snapshot survives the trip to main:gate_snapshot_pipe:games/the-game/ai/"
  "a whole training leg finishes:gate_pbt_leg:games/the-game/ai/"
  "a slow run stops before the job kills it:gate_deadline_stop:games/the-game/ai/"
  "a run that trained nothing does not chain:gate_pbt_stop:games/the-game/ai/"
  "a switch means the same thing everywhere:gate_flags:games/the-game/ai/"
  "the server's engine, in JS and in C, is the server's:gate_server_engine:games/"
  "BitBot's C search gives the JS search's answers:gate_bitnative:games/the-game/ai/"
  "BitBot's clock is the engine's:gate_clock:games/the-game/ai/"
  "BitBot searches in time, never in swaps:gate_time_not_swaps:games/the-game/ai/"
  "what a board can fire next move:gate_reach:games/the-game/ai/"
  "the cursor walks and its travel is priced:gate_cursor:games/the-game/"
  "the LOVE RNG matches the real engine:gate_love_rng:games/the-game/ai/"
  "the training-resume hook:gate_resume_hook:.claude/"
  "two variants on one seed keep separate islands:gate_pbt_dirs:games/the-game/ai/"
  "the puyo brain:gate_puyo_cpu:games/the-game/ai/"
  "the training harness:gate_training_harness:games/the-game/ai/"
  "the modes filter the pool and the evaluator still picks:gate_modes:games/the-game/ai/"
  "the bot can see a chain continuation:gate_chaining:games/the-game/"
  "the other board reaches the bot in a usable shape:gate_opponent:games/the-game/"
  "every training pre-flight suite is gated:gate_preflight_gated:games/the-game/ai/"
  "the board moves on while the bot walks:gate_elapsed_rise:games/the-game/ai/"
  "a garbage break stops the resolve:gate_garbage_rules:games/the-game/ai/"
  "the chip matcher enforces every constraint:gate_chip_matcher_constraints:games/the-game/ai/"
  "every option field is priced by both rankers:gate_option_pricing:games/the-game/ai/"
  "every feature measures what its name says:gate_features:games/the-game/ai/"
  "every feature is a share, not a count:gate_normalise:games/the-game/ai/"
  "survival breaks before it clears:gate_survival_rules:games/the-game/ai/"
  "the shipped weights and the tools that measure them:gate_shipped_weights:games/the-game/ai/"
  "that check fires:gate_shipped_weights_check_fires:games/the-game/ai/"
  "the gates actually reject defects:gate_gates_reject_defects:"
  "no check reports success it did not have:gate_gate_wiring:"
  "generator rules:gate_generator_rules:art"
  "the art vault round-trips:gate_art_vault_roundtrip:art"
  "the generation money path:gate_generation_money_path:art"
  "the walk-sheet cutter:gate_walk_sheet_cutter:art"
  "the art checkers fire (and stay quiet):gate_art_checkers_fire:art"
  "character spec provenance:gate_character_spec_provenance:art"
)

# WHICH GATES DOES THIS CHANGE ACTUALLY NEED?
#
# Every gate entry carries a third field: the path prefix it covers. An
# empty scope means the gate always runs.
#
#   games/              the shipped games and their engines
#   games/the-game/ai/  the Puyo trainer (35 of the 51 gates)
#   art                 .github/art/, and any game's art, icons or rooms
#
# Scoping is OPT-IN: it happens only when GC_CHANGED_PATHS holds the
# newline-separated paths a change touches. pages.yml sets nothing and so
# keeps running the complete list — it is the backstop and stays
# exhaustive. guard-main-push.sh sets it from the commits actually being
# pushed, so a change to one game does not have to satisfy another game's
# trainer to reach main.
#
# Two properties keep this from being a hole. A change touching ANYTHING
# outside games/ and .github/art/ — gate scripts, workflows, hooks,
# shared/ — runs every gate, since those can break anything. And a skipped
# gate is printed as skipped and listed in the summary: a skip that read
# like a pass would be worse than having no gate.
_gate_scope_matches() {
  local scope="$1" path="$2"
  [ -z "$scope" ] && return 0
  case "$scope" in
    art)
      case "$path" in
        .github/art/*) return 0 ;;
        games/*/art*|games/*/icons/*|games/*/rooms/*) return 0 ;;
      esac
      return 1 ;;
    *) case "$path" in "$scope"*) return 0 ;; esac; return 1 ;;
  esac
}

# Anything outside the areas a scope can describe means "run everything" —
# gate scripts, workflows, hooks and shared/ can break anything, so a change
# touching them does not get to pick which gates apply to it.
_gate_change_is_cross_cutting() {
  local path
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    case "$path" in
      games/*|.github/art/*) ;;
      *) return 0 ;;
    esac
  done <<< "$1"
  return 1
}

# ...with one exception, and it is about an EXTERNAL DEPENDENCY rather than
# about risk. The Puyo trainer's gates need a checkout of briankeegan/
# panel-game beside the repo for the real attack and puzzle files, and
# _gc_training_dir deliberately FAILS rather than skips when it is absent
# (a gate that cannot fail is worse than no gate). The consequence is that
# on any machine without that checkout, gate_all can never pass — so the
# push guard blocks every push to main, whatever the change was, including
# ones that cannot touch the trainer.
#
# pages.yml is the tiebreak: it runs 16 named gates and NONE of the
# trainer's, so a trainer gate has never gated a deploy. Holding a change to
# a different game to a bar the build itself does not apply is the wrong
# bar. So this scope is honoured even for a cross-cutting change: touch
# games/the-game/, and every trainer gate runs; do not, and they are skipped
# by name in the summary.
_GATE_HARD_SCOPES="games/the-game/ai/"

_gate_scope_is_hard() {
  local s
  for s in $_GATE_HARD_SCOPES; do [ "$1" = "$s" ] && return 0; done
  return 1
}

# Runs every gate and prints a summary. Sets $GATE_FAILURES (newline-
# separated "name: <first output line>") so a caller can report specifics
# without re-running anything or re-parsing logs.
# What the push hook runs: gate_all scoped to the paths this working tree
# actually changed. Plain gate_all stays unscoped on purpose — that is the
# list pages.yml runs — so this is the one to reach for while iterating.
gate_changed() {
  local changed
  changed=$( { git -C "$(git rev-parse --show-toplevel)" diff --name-only HEAD;
               git -C "$(git rev-parse --show-toplevel)" ls-files --others --exclude-standard; } | sort -u )
  if [ -z "$changed" ]; then
    echo "nothing changed against HEAD — running every gate."
    gate_all
    return $?
  fi
  GC_CHANGED_PATHS="$changed" gate_all
}

# EVERY GATE THAT IS NOT SLOW, IN ONE STEP.
#
# pages.yml names gates one per step and does NOT call gate_all, so a gate added
# to GATES alone ran in no workflow at all: 41 of 82 were in that position, each
# one under SLOW_SECONDS and none of them checking anything on a push. Adding a
# step per gate leaves the same hole open for the next one, so this closes the
# class -- anything not in SLOW_GATES runs here whether or not someone remembers.
#
# Gates pages.yml already names are skipped rather than run twice; those steps
# carry the comments explaining what each one is for, which is why they stay.
# NEEDS THE panel-game CHECKOUT BESIDE THIS ONE, which only the training
# workflows clone. Each of these reads Puzzles.json or the training dir out of
# it and fails with ENOENT anywhere else, so they are skipped on the deploy path
# rather than given a second repo to depend on -- a panel-game outage must not
# block every game's deploy. They still run under gate_all, locally and in the
# autopilot pre-flight, where the checkout is present.
PANEL_GAME_GATES=(
  gate_chain_measure gate_versus_loop gate_chaining gate_opponent
  gate_features gate_normalise gate_clock
)
# PANEL_GAME_GATES, run nightly by ai-slow-gates.yml beside a panel-game checkout.
gate_panel_game() {
  local overall=0 g
  for g in "${PANEL_GAME_GATES[@]}"; do
    echo "=== PANEL-GAME GATE: $g ==="
    _gate_exec "$g" || { overall=1; echo "FAILED: $g"; }
  done
  return $overall
}

_gate_needs_panel_game() {
  local g
  for g in "${PANEL_GAME_GATES[@]}"; do [ "$g" = "$1" ] && return 0; done
  return 1
}

gate_fast() {
  local named overall=0 entry fn skipped=""
  named=$(grep -oE '\bgate_[a-z0-9_]+' .github/workflows/pages.yml | sort -u)
  for entry in "${GATES[@]}"; do
    fn="${entry#*:}"; fn="${fn%%:*}"
    if _gate_is_slow "$fn"; then continue; fi
    if printf '%s\n' "$named" | grep -qx "$fn"; then continue; fi
    if [ "${GC_SKIP_PANEL_GAME:-1}" = "1" ] && _gate_needs_panel_game "$fn"; then
      skipped="${skipped} ${fn}"; continue
    fi
    echo "=== GATE: $fn ==="
    if ! _gate_exec "$fn"; then overall=1; echo "FAILED: $fn"; fi
  done
  if [ -n "$skipped" ]; then
    echo
    echo "gate_fast: skipped (need the panel-game checkout):${skipped}"
  fi
  if [ "$overall" -ne 0 ]; then echo; echo "gate_fast: one or more gates failed"; fi
  return $overall
}

gate_all() {
  local overall=0
  local skipped=""
  local timings=""
  local run_start
  run_start=$(date +%s)
  GATE_FAILURES=""

  local changed="${GC_CHANGED_PATHS:-}"
  local scoping=0      # 1 = honour every scope
  local hard_only=0    # 1 = honour only the hard scopes (see above)
  if [ -n "$changed" ]; then
    if _gate_change_is_cross_cutting "$changed"; then
      hard_only=1
      echo "gate scope: change reaches outside games/ and .github/art/ — running every gate"
      echo "            except hard-scoped ones whose area is untouched ($_GATE_HARD_SCOPES)."
    else
      scoping=1
      echo "gate scope: limited to the areas these paths touch —"
      printf '  %s\n' $changed
    fi
  fi

  for entry in "${GATES[@]}"; do
    local name="${entry%%:*}"
    local rest="${entry#*:}"
    local fn="${rest%%:*}"
    local scope="${rest#*:}"

    local consider=0
    if [ -n "$scope" ]; then
      if [ "$scoping" = 1 ]; then
        consider=1
      elif [ "$hard_only" = 1 ] && _gate_scope_is_hard "$scope"; then
        consider=1
      fi
    fi

    if [ "$consider" = 1 ]; then
      local needed=1
      local path
      while IFS= read -r path; do
        [ -z "$path" ] && continue
        if _gate_scope_matches "$scope" "$path"; then needed=0; break; fi
      done <<< "$changed"
      if [ "$needed" -ne 0 ]; then
        echo "=== GATE: $name === SKIPPED (nothing under '$scope' changed)"
        skipped="${skipped}  ${name} (${scope})"$'\n'
        continue
      fi
    fi

    if [ "${GC_DEFER_SLOW:-}" = "1" ] && _gate_is_slow "$fn"; then
      echo "=== GATE: $name === DEFERRED to CI (slow; ai-slow-gates.yml runs it nightly)"
      skipped="${skipped}  ${name} (deferred to CI)"$'\n'
      continue
    fi
    echo "=== GATE: $name ==="
    local out t0 t1
    t0=$(date +%s)
    out=$(_gate_exec "$fn" 2>&1)
    local rc=$?
    t1=$(date +%s)
    printf '%s\n' "$out"
    timings="${timings}$(( t1 - t0 )) ${name}"$'\n'
    if [ "$rc" -ne 0 ]; then
      overall=1
      local firstline
      firstline=$(printf '%s\n' "$out" | grep -v '^==' | grep -v '^$' | head -1)
      GATE_FAILURES="${GATE_FAILURES}${name}: ${firstline}"$'\n'
    fi
  done

  if [ -n "$skipped" ]; then
    echo
    echo "SKIPPED GATES (not run — nothing in their area changed):"
    printf '%s' "$skipped"
  fi
  echo
  echo "$(( $(date +%s) - run_start ))s total. Slowest gates:"
  printf '%s' "$timings" | sort -rn | head -8 | while read -r secs gname; do
    [ "$secs" -gt 0 ] && printf '  %4ss  %s\n' "$secs" "$gname"
  done
  if [ "$overall" -ne 0 ]; then
    echo
    echo "FAILED GATES:"
    printf '%s' "$GATE_FAILURES"
  fi
  return $overall
}
