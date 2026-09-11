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
case "$CMD" in
  *"git push"*) ;;
  *) exit 0 ;;
esac
case "$CMD" in
  *" main"*|*"main:main"*|*"HEAD:main"*|*"origin main"*) ;;
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
out=$( cd "$REPO" && source .github/scripts/gates.sh && gate_all 2>&1 )
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
