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

gate_ai_preset_ordering() {
  node games/the-game/ai/experiments/check_preset_ordering.js nightmare diamond
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

# AND THE SAME CHIPS AGAINST THE GAME. LogicalBoard is the bot's simulation
# of the board; panel-engine.js is the game. Measured on the cascade group
# they disagree on 34 of 517 chips, so passing one is not passing the other
# and a chip has to clear both before it can steer anything.
gate_chips_verify_engine() {
  node games/the-game/ai/eval/verify_chips_engine.js
}

# AND EVERY PORTED CHIP MUST BE INDIVIDUALLY DECIDABLE. The two gates above
# prove the verifiers reject damage SOMEWHERE in a 4,380-chip batch; this one
# corrupts every chip's own claim in turn and requires that chip to be
# rejected. A chip that passes while claiming something untrue is carried by
# the other 4,379 and checked by nothing.
# THE ENGINE BRAIN IS WIRED AND NOT INERT. A switch that is plumbed but never
# taken looks exactly like one that works: the bot keeps playing, every other
# test stays green, and the 372 chips it exists for stay mispriced.
# chips-engine-only/ must earn its name in BOTH directions: every chip there
# fires on the real engine AND fails the simulation. Otherwise it is one
# loosened rule away from being where a chip goes to dodge a gate.
gate_engine_brain() {
  node games/the-game/ai/eval/enginebrain.test.js
}

gate_chips_decidable() {
  node games/the-game/ai/eval/chips.decidable.test.js
}

# A library nothing can read is worth the same as a library that is wrong,
# and it looks considerably healthier. Two gates ask whether a chip is TRUE;
# this one asks whether a consumer can find the shape and act on it.
gate_chips_hookup() {
  node games/the-game/ai/eval/chips.hookup.test.js
}

# Both verifiers stage a chip onto a board this repo BUILDS, choosing filler
# that provably cannot take part. That staging is the right way to ask
# whether a chip is true, and it is also the whole of the doubt — a live
# board's don't-care cells hold real colours, and real colours can join a
# match. This fires chips found on boards the bot actually played.
gate_chips_real_boards() {
  node games/the-game/ai/eval/chips.realboard.test.js
}

# THE SAME BOARD, BOTH ENGINES, ON EVERY CHIP. resolve_fidelity.js compares
# them on real in-play positions, and real play does not throw up the deep
# cascade shapes the library is made of — one of the four faults in resolve was
# invisible across 50,797 real cases and showed on 28 chip templates. Chain
# depth, panels cleared, and the final BOARD cell by cell.
gate_chips_both_boards_agree() {
  GC_COMPARE_SIM=1 node games/the-game/ai/eval/verify_chips_engine.js
}

# ...and that any of it can fail: four breaks, one per fault the simulation had.
gate_resolve_breaks() {
  bash games/the-game/ai/eval/resolve.breaks.test.sh
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
  node games/the-game/ai/eval/garbage.test.js
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
gate_checkpoint_resume() {
  bash games/the-game/ai/eval/checkpoint.test.sh
}

# THE DEPTH-2 SEARCH ACTUALLY SEARCHES.
#
# Its first version had three defects at once — it expanded only the top
# candidates by IMMEDIATE score, never expanded hold, and compared a
# depth-1 incumbent against depth-2 challengers — and the test file beside
# it passed 4/4, because every assertion asked whether lookahead was WIRED
# and none asked whether it was RIGHT. Wired and correct look identical
# from outside. This asserts the choice: on real level-10 decisions, no
# candidate may have a better two-move future than the one it played.
gate_lookahead() {
  node games/the-game/ai/eval/lookahead.test.js
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

gate_rise_scoring() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/rise.test.js
}

gate_density_scoring() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/density.test.js
}

# THE "EARNED" FEATURES ARRIVE, rather than merely computing correctly.
#
# features.test.js proves the four earned features are right by HANDING them
# an input -- stGain(TOPPED, {toppedOut:true}, {stopTimeEarned:60}) === 60 --
# which says nothing about whether anything ever puts a 60 in there.
# stopTimeEarned once read zero on all 2,450 candidates of a run because
# resolve() did not report it: the feature was perfect, the plumbing was
# missing, and every unit test passed throughout.
#
# So this plays real games in the scenarios that actually contain garbage and
# asserts each of the four ARRIVES at the evaluator. Liveness, not a rate --
# the real rates are 0.02% to 0.37%, and a threshold on those would be a
# threshold on the bot's taste in moves, which fails on a correct tree every
# time the weights change.
gate_earned_features_arrive() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/earned.test.js
}

# EVERY SUITE THE TRAINING PRE-FLIGHT RUNS IS ALSO A GATE.
gate_preflight_gated() {
  node .github/scripts/check_preflight_gated.mjs
}

# A PLY THAT DOES NOT ADVANCE THE CLOCK CANNOT VALUE TIMING.
#
# Every clock field reaches a feature off the LIVE stack (input.js's
# fromStack), read before any swap happens. At depth 1 that is right -- the
# move is being made now. At depth 2 it was a lie: the second ply is a move
# made AFTER the first, and it was scored against the clock as it stood
# BEFORE the first. So "fire the chain now" and "hold, then fire it" scored
# identically on stop time, and they are not the same move -- awardStopTime
# takes a MAX, so firing under a full clock buys nothing and firing under an
# empty one buys everything.
#
# Same argument _lookahead already makes about travel: a second ply that
# treats it as free values a follow-up on the far side of the board exactly
# like one under the cursor. Time was the other thing it treated as free.
#
# Both directions, because a clock advanced for EVERY child regardless of
# which candidate it descends from would pass a wiring test and be wrong in
# the more damaging direction -- it tells the search that waiting is
# pointless because the clock is full either way.
gate_ply_clock() {
  node games/the-game/ai/eval/plyclock.test.js
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

# RAISING IS A MOVE, AND THE BOT COULD NOT MAKE IT.
#
# `raiseFrames` was declared in PuyoCpu's constructor and decremented in
# update(), and NOTHING EVER SET IT -- dead wiring that reads exactly like a
# working feature. _decide returned 'hold' or 'swap' and nothing else, so
# raise was never in the choice set and no weight could select it. On a low
# board with nothing worth swapping the only options were to wait out the
# passive rise (120 frames a row at level 10) or play a swap it did not want.
#
# It is a CANDIDATE, not a rule: scored on the board as it will be once the
# row has landed and resolved, so the weights decide. SearchCpu's
# `fillRatio < 0.4` threshold is what this deliberately does not do.
gate_raise() {
  node games/the-game/ai/eval/raise.test.js
}

# THE RUN RECORDS WHAT KIND OF GARBAGE IT SENT, NOT JUST HOW MUCH.
#
# Score cannot say whether the bot learned to CHAIN: one that survives on
# small clears scores respectably and never fires a four-chain. Every chain
# the current bot fires is 2-3 links and the 4-6 and 7+ buckets are empty, so
# a batch of runs judged on score alone produces numbers that all rise while
# that does not move. The breakdown must be the garbage the Stack actually
# delivered — an object of zeroes satisfies "it exists" — and it must survive
# the fork to train_worker.js, which is where depth and beam were silently
# eaten before.
gate_chain_depth() {
  node games/the-game/ai/eval/chaindepth.test.js
}

# The four constraints a template carries, pinned directly. Two of them were
# silently unenforced for the matcher's whole first life (Int8Array stamp
# truncation) and the test nearest the defect could not see it.
gate_chip_matcher_constraints() {
  node games/the-game/ai/eval/chipmatch.test.js
}

# THE BOT PLANS WITH LogicalBoard AND THE GAME RUNS panel-engine.js. Nothing
# compared them head-on until this: one real board, one legal swap, both
# engines, and the FINAL GRID compared cell by cell rather than only the
# totals. Two engines can agree on chain depth and panels cleared and still
# leave the board in different states, and the next decision is made on the
# board.
gate_resolve_fidelity() {
  GC_FIDELITY_FLOOR=1 node games/the-game/ai/eval/resolve_fidelity.js boards 99999
}

# ...AND THAT IT CAN FAIL. This check's whole value is catching the case where
# the two engines are compared through a harness that is itself moving the
# board. It used to have a break test in chips.test.sh, which stopped being
# able to fail once the chip gates only compared counts — a rise preserves
# counts. Broken here instead: let the stack rise while a candidate resolves,
# and the fidelity floor must reject it.
gate_resolve_fidelity_fires() {
  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  mkdir -p "$work/games/the-game/ai/eval"
  cp games/the-game/panel-engine.js games/the-game/panel-cpu.js "$work/games/the-game/" || return 1
  cp games/the-game/ai/eval/*.js games/the-game/ai/eval/realboards.json "$work/games/the-game/ai/eval/" || return 1
  sed -i 's/stack.riseTimer = 1e9;//' "$work/games/the-game/ai/eval/engineboard.js" || return 1
  if ( cd "$work/games/the-game/ai/eval" && GC_FIDELITY_FLOOR=0.9993 node resolve_fidelity.js boards 300 ) >/dev/null 2>&1; then
    echo "  NOT CAUGHT: the fidelity check passed a harness that lets the stack rise"
    return 1
  fi
  echo "  caught:     a harness that lets the stack rise while a candidate resolves"
  return 0
}

# Four features share one clone-swap-resolve pass instead of running it four
# times, which is what makes a gravity-correct matchPotential affordable
# (+2.8% per candidate instead of +102%). The saving is only honest if the
# answers are identical, and a shared pass that answers one feature from
# another feature's board reads as a fast bot rather than a broken one.
gate_features_shared_pass() {
  node games/the-game/ai/eval/features.shared.test.js
}

gate_features() {
  local d; d="$(_gc_training_dir)" || return 1
  GC_TRAINING_DIR="$d" node games/the-game/ai/eval/features.test.js
}

gate_chip_verifier_fires() {
  bash games/the-game/ai/eval/chips.test.sh
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
GATES=(
  "engine tests:gate_engine_tests"
  "nightmare AI preset harder than diamond:gate_ai_preset_ordering"
  "room exits:gate_room_exits"
  "shared-module wiring:gate_shared_module_wiring"
  "doors can be entered:gate_doors_enterable"
  "room props and floor plates:gate_room_props_floor_plates"
  "the art index:gate_art_index"
  "art references:gate_art_refs"
  "characters keep one size while walking:gate_sprite_scale_consistency"
  "chain chips fire in our engine:gate_chips_verify"
  "chain chips fire in the real engine:gate_chips_verify_engine"
  "the engine brain is wired, not inert:gate_engine_brain"
  "every ported chip is individually decidable:gate_chips_decidable"
  "the chip library can actually be used:gate_chips_hookup"
  "chips hold up on boards nobody built for them:gate_chips_real_boards"
  "both boards agree on every chip:gate_chips_both_boards_agree"
  "a broken resolve is rejected:gate_resolve_breaks"
  "every feature is wired and moves:gate_features_live"
  "the chains-fired measure accepts and rejects:gate_chain_measure"
  "the status tool sees a duplicate run:gate_status_tool"
  "the training smoke check accepts and rejects:gate_smoke_checker"
  "a training run that ran out of time can resume:gate_checkpoint_resume"
  "no checkpoint is stranded by a rename:gate_checkpoint_names"
  "a slow run stops before the job kills it:gate_deadline_stop"
  "the puyo brain:gate_puyo_cpu"
  "the training harness:gate_training_harness"
  "rise-adjusted scoring:gate_rise_scoring"
  "density scoring:gate_density_scoring"
  "the earned features arrive in a real game:gate_earned_features_arrive"
  "every training pre-flight suite is gated:gate_preflight_gated"
  "the depth-2 search picks the best two-move future:gate_lookahead"
  "the second ply knows what time it is:gate_ply_clock"
  "the board moves on while the bot walks:gate_elapsed_rise"
  "raising is a move the weights can choose:gate_raise"
  "a run records what kind of garbage it sent:gate_chain_depth"
  "a garbage break stops the resolve:gate_garbage_rules"
  "the chip matcher enforces every constraint:gate_chip_matcher_constraints"
  "the simulation resolves like the game:gate_resolve_fidelity"
  "that fidelity check fires:gate_resolve_fidelity_fires"
  "every feature measures what its name says:gate_features"
  "the shared resolve pass is the same answer:gate_features_shared_pass"
  "that chip check fires:gate_chip_verifier_fires"
  "the shipped weights and the tools that measure them:gate_shipped_weights"
  "that check fires:gate_shipped_weights_check_fires"
  "the gates actually reject defects:gate_gates_reject_defects"
  "no check reports success it did not have:gate_gate_wiring"
  "generator rules:gate_generator_rules"
  "the art vault round-trips:gate_art_vault_roundtrip"
  "the generation money path:gate_generation_money_path"
  "the walk-sheet cutter:gate_walk_sheet_cutter"
  "the art checkers fire (and stay quiet):gate_art_checkers_fire"
  "character spec provenance:gate_character_spec_provenance"
)

# Runs every gate and prints a summary. Sets $GATE_FAILURES (newline-
# separated "name: <first output line>") so a caller can report specifics
# without re-running anything or re-parsing logs.
gate_all() {
  local overall=0
  GATE_FAILURES=""
  for entry in "${GATES[@]}"; do
    local name="${entry%%:*}"
    local fn="${entry#*:}"
    echo "=== GATE: $name ==="
    local out
    out=$("$fn" 2>&1)
    local rc=$?
    printf '%s\n' "$out"
    if [ "$rc" -ne 0 ]; then
      overall=1
      local firstline
      firstline=$(printf '%s\n' "$out" | grep -v '^==' | grep -v '^$' | head -1)
      GATE_FAILURES="${GATE_FAILURES}${name}: ${firstline}"$'\n'
    fi
  done
  if [ "$overall" -ne 0 ]; then
    echo
    echo "FAILED GATES:"
    printf '%s' "$GATE_FAILURES"
  fi
  return $overall
}
