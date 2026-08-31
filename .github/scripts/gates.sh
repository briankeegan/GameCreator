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
