#!/bin/bash
# THE GOAL BEFORE A QUESTION (the owner: when you ask me a question, first check the goal): a turn that ends on a question to the owner,
# or a call to AskUserQuestion, is sent back once with the goal file to read -- where the goal or CLAUDE.md already answers it, the answer
# is acted on instead of asked; a question it does not answer is asked, and the work goes on meanwhile.
#   Stop: the last reply's closing lines hold a question -> block once (stop_hook_active lets the second stop through).
#   PreToolUse AskUserQuestion: the same question is refused the first time and let through the second.
GOAL="games/the-game/ai/eval/plans/gambit-goal.md"
STATE="${TMPDIR:-/tmp}/goal-before-asking.$(id -u)"
exec python3 -c '
import json, sys, hashlib, os
goal, state = sys.argv[1], sys.argv[2]
try: h = json.load(sys.stdin)
except Exception: sys.exit(0)
why = ("Before asking the owner, read " + goal + " (and CLAUDE.md). If they answer the question -- what to run next, whether to keep "
       "a change, what follows a loss (a change, one run per change, worst mode first), whether to go on (a question never stops the "
       "work) -- act on that answer now instead of asking. Ask only what the goal cannot answer, and keep working while it is open.")
ev = h.get("hook_event_name", "")
if ev == "PreToolUse":
    q = json.dumps(h.get("tool_input", {}), sort_keys=True)
    k = hashlib.sha1(q.encode()).hexdigest()
    seen = open(state).read().split() if os.path.exists(state) else []
    if k in seen: sys.exit(0)
    open(state, "a").write(k + "\n")
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                      "permissionDecisionReason": why + " If it still needs asking, ask the same question again."}}))
    sys.exit(0)
if ev != "Stop" or h.get("stop_hook_active"): sys.exit(0)
text = h.get("last_assistant_message") or ""
if not text:
    p = h.get("transcript_path")
    try:
        for line in open(p):
            try: e = json.loads(line)
            except Exception: continue
            if e.get("type") != "assistant": continue
            parts = [c.get("text", "") for c in (e.get("message", {}).get("content") or []) if isinstance(c, dict) and c.get("type") == "text"]
            if any(parts): text = "\n".join(parts)
    except Exception: sys.exit(0)
lines = [l.strip() for l in text.strip().splitlines() if l.strip() and not l.strip().startswith("[v0.")]
tail = " ".join(lines[-3:])
if "?" in tail:
    print(json.dumps({"decision": "block", "reason": why}))
' "$GOAL" "$STATE"
