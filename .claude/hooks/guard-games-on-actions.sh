#!/usr/bin/env bash
# GAMES ARE PLAYED ON GITHUB ACTIONS, NEVER IN THIS SANDBOX (CLAUDE.md, plans/gambit-goal.md). A game played here runs on a machine
# unlike the runners -- slower, its cores laid out differently -- so its numbers (late answers, losses, timings) say nothing about
# the bot. This refuses a command that plays one: the upstream harness, the training launcher, a trainer, the client. Dispatch the
# workflow instead (gambit-upstream.yml, gambit-24.yml).
set -uo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] && exit 0
CMD=$(python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: print("")' 2>/dev/null)
case "$CMD" in
  *run28.sh*|*upstreamRound.lua*|*upstream/round.lua*|*training.sh*|*train.js*|*love.AppImage*|*"bot/fight.sh"*)
    echo "Games run on GitHub Actions, not here: dispatch gambit-upstream.yml or gambit-24.yml (CLAUDE.md, plans/gambit-goal.md)." >&2
    exit 2 ;;
esac
exit 0
