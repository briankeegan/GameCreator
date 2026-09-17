#!/usr/bin/env bash
# REFUSE A PUSH TO main THAT HAS NOT PASSED gate_all.
#
# WHY A HOOK AND NOT A NOTE. CLAUDE.md already said to run the gates before
# pushing. The rule was known and followed wrongly anyway: a merge went to
# main having passed TEN suites out of games/the-game/ai/eval/, which felt
# like thorough testing and was not the list CI runs. The gate that caught
# the regression lives in ai/experiments/ and only ran after the push, by
# which point the site had stopped deploying. Then the fix for that was
# three paragraphs of prose in CLAUDE.md — one third of this repo's own
# RULE -> TOOL -> GATE convention, and the third that gets ignored.
#
# So this is the gate. It does not ask whether the gates were run; it runs
# them, and a non-zero exit blocks the push. Intent is not part of it.
#
# SCOPE, deliberately narrow:
#   - Only pushes whose target is main. A session branch pushes freely,
#     which is where the snapshot commits and the iterating happens; gating
#     those would make the hook something to disable.
#   - gate_all takes minutes. That is the right price for a main push and
#     the wrong price for anything else.
#
# ESCAPE HATCH: GC_SKIP_GATES=1. It exists because a hook with no way out
# gets deleted the first time it is wrong, and because there are real cases
# (a revert to unbreak main, a docs-only fix while a gate is known-red).
# Using it prints a loud line naming what was skipped, so it shows up in
# the log rather than passing for a clean push.
set -uo pipefail

INPUT=$(cat 2>/dev/null || echo '{}')
CMD=$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: print("")' 2>/dev/null)

# Not a push to main? Nothing to do. Matching is deliberately broad: any
# git push naming main, in any argument order.
#
# ANY REFSPEC ENDING IN main COUNTS, not just the three spellings first
# listed here. `git push origin some-branch:main` is a push to main by every
# measure that matters and the original patterns did not match it -- which
# came up for real the moment `main` was checked out in another worktree and
# could not be checked out here to push from. A guard with a spelling it
# does not know about is a guard that is off.
case "$CMD" in
  *"git push"*) ;;
  *) exit 0 ;;
esac
# main must be the WHOLE ref, not a prefix of one: `git push origin
# maintenance` contains " main" and is not a push to main. So every pattern
# ends the word -- at the end of the command, or at the next space.
case "$CMD " in
  *" main "*|*":main "*|*":refs/heads/main "*) ;;
  *) exit 0 ;;
esac

REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$REPO" ] && exit 0
[ -f "$REPO/.github/scripts/gates.sh" ] || exit 0

if [ "${GC_SKIP_GATES:-}" = "1" ]; then
  echo "GC_SKIP_GATES=1 — pushing to main WITHOUT running gate_all. Say so out loud." >&2
  exit 0
fi

echo "guard-main-push: running gate_all before this push to main (minutes, not seconds)" >&2

# Tell gate_all which paths this push changes, so it can skip the gates
# whose area is untouched (see the scope comment in gates.sh). A change
# confined to one game no longer has to satisfy another game's trainer.
#
# The decision stays gate_all's, not this hook's: a change reaching outside
# games/ and .github/art/ still runs every gate, and a skipped gate prints
# as skipped rather than passing quietly. If the range cannot be worked out
# the variable is empty and the full list runs, which is the safe direction.
CHANGED=$( cd "$REPO" && git diff --name-only origin/main...HEAD 2>/dev/null )
out=$( cd "$REPO" && export GC_CHANGED_PATHS="$CHANGED" && source .github/scripts/gates.sh && gate_all 2>&1 )
rc=$?
if [ "$rc" -ne 0 ]; then
  {
    echo "BLOCKED: gate_all failed, so this push to main would break the build and stop"
    echo "the site deploying. Fix the gate, do not work around the hook."
    echo ""
    printf '%s\n' "$out" | grep -E "FAIL|Error|error:" | head -12
    echo ""
    echo "Full output: cd $REPO && source .github/scripts/gates.sh && gate_all"
  } >&2
  exit 2
fi
echo "guard-main-push: gate_all passed" >&2
exit 0
