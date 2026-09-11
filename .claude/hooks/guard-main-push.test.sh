#!/usr/bin/env bash
# DOES THE PUSH GUARD ACTUALLY BLOCK? Run: .claude/hooks/guard-main-push.test.sh
#
# Both directions, because the two ways to get this wrong look identical from
# outside: a hook that never blocks reads exactly like a repo that is always
# green, and a hook that blocks everything gets deleted within a day.
#
# Runs against a STUB gates.sh in a temp repo rather than the real one — the
# real gate_all takes minutes, and a test nobody runs because it is slow is
# the failure mode this whole hook exists for. The stub also lets the test
# prove gate_all was NOT called on a branch push, which is otherwise
# invisible.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")" && pwd)/guard-main-push.sh"
pass=0; fail=0

setup() {  # $1 = exit code the stub gate_all should return
  WORK=$(mktemp -d)
  mkdir -p "$WORK/.github/scripts"
  cat > "$WORK/.github/scripts/gates.sh" <<STUB
gate_all() { echo "stub gate_all ran" >> "$WORK/ran.log"; echo "FAIL: a stub failure"; return $1; }
STUB
  ( cd "$WORK" && git init -q . && git config user.email t@t && git config user.name t )
}
run() {  # $1 = command json; echoes exit code
  printf '{"tool_input":{"command":"%s"}}' "$1" | CLAUDE_PROJECT_DIR="$WORK" bash "$HOOK" >/dev/null 2>&1
  echo $?
}
check() {  # $1 = label, $2 = got, $3 = want
  if [ "$2" = "$3" ]; then echo "  ok   $1"; pass=$((pass+1));
  else echo "  FAIL $1 (exit $2, wanted $3)"; fail=$((fail+1)); fi
}

setup 1
check "a push to main is BLOCKED when gate_all fails" "$(run 'git push origin main')" 2
check "  and gate_all was actually run" "$([ -s "$WORK/ran.log" ] && echo yes || echo no)" yes
rm -rf "$WORK"

setup 0
check "a push to main is ALLOWED when gate_all passes" "$(run 'git push origin main')" 0
rm -rf "$WORK"

setup 1
check "a push to a SESSION BRANCH is never blocked" "$(run 'git push -u origin claude/newsey-game-ask-qa8u5e')" 0
check "  and gate_all was not run for it" "$([ -s "$WORK/ran.log" ] && echo yes || echo no)" no
rm -rf "$WORK"

setup 1
got=$(printf '{"tool_input":{"command":"git push origin main"}}' | CLAUDE_PROJECT_DIR="$WORK" GC_SKIP_GATES=1 bash "$HOOK" 2>&1 >/dev/null; )
rc=$(printf '{"tool_input":{"command":"git push origin main"}}' | CLAUDE_PROJECT_DIR="$WORK" GC_SKIP_GATES=1 bash "$HOOK" >/dev/null 2>&1; echo $?)
check "GC_SKIP_GATES=1 lets it through" "$rc" 0
check "  and says so loudly" "$(printf '%s' "$got" | grep -c 'WITHOUT running gate_all')" 1
rm -rf "$WORK"

setup 1
check "a non-push git command is ignored" "$(run 'git status')" 0
rm -rf "$WORK"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
