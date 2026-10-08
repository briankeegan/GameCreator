#!/usr/bin/env bash
# ONE ISLAND 2.0 BOT, round after round, on the live server (islands2.yml).
#
#   BOT=N HOST=ip PORT=port STATE=<island2-state worktree> PG=<panel-game checkout> DEADLINE=<epoch s> island2.sh
#
# Each round (island2.js round: a slot of the clock, the same for all ten):
# WasmSurvivor (survivor.js) is started on this bot's weights a little before
# the slot, the match against the round's opponent is played
# (lua/island2Match.lua), the result is recorded (island2.js record: a loss
# moves the weights toward the winner's) and this bot's file is pushed to the
# state branch. No round starts that could not end before DEADLINE.
set -u
EVAL="$(cd "$(dirname "$0")" && pwd)"
N=$BOT; NAME="isl2b$N"; ROUND_S=480; LEAD=20
LP="./?.lua;./common/lib/?.lua;/usr/local/share/lua/5.1/?.lua;;"
LC="./common/lib/?.so;./common/lib/?/?.so;/usr/local/lib/lua/5.1/?.so;;"

# Same name, same account (bot/fight.sh's id): derived from the name and host.
mkdir -p "$PG/bot/identities"
BOT_IP="$HOST" BOT_NAME="$NAME" python3 -c '
import hashlib, os
msg = (os.environ["BOT_IP"] + "/" + os.environ["BOT_NAME"].lower()).encode()
print("1" + str(int(hashlib.sha256(msg).hexdigest(), 16) % 10**18).zfill(18), end="")' > "$PG/bot/identities/${NAME}_${HOST}.txt"

push_state() {   # this bot's file only; another bot's push is merged, never overwritten
  git -C "$STATE" add "bot$N.json"
  git -C "$STATE" commit -qm "island2: $NAME round $1" || return 0
  for i in 1 2 3 4 5 6; do
    git -C "$STATE" push -q origin HEAD:island2-state && return 0
    git -C "$STATE" pull -q --rebase origin island2-state
    sleep $((RANDOM % 5 + i))
  done
  echo "::warning::$NAME could not push round $1"
}

while :; do
  now=$(date +%s)
  R=$(( now / ROUND_S + 1 )); start=$(( R * ROUND_S ))
  [ $(( start + ROUND_S + 120 )) -lt "$DEADLINE" ] || { echo "$NAME: no time for another round"; break; }
  git -C "$STATE" pull -q --rebase origin island2-state || true
  OPP=$(node "$EVAL/island2.js" opponent "$N" "$R")
  sleep $(( start - LEAD - $(date +%s) > 0 ? start - LEAD - $(date +%s) : 0 ))
  P=$(node "$EVAL/island2.js" profile "$STATE" "$N" "$EVAL")
  GC_SURVIVOR_PROFILE="$P" nohup node "$EVAL/survivor.js" --port 47777 --threads $(( $(nproc) - 1 )) > "mind-$R.log" 2>&1 &
  MIND=$!
  for i in $(seq 1 150); do grep -q listening "mind-$R.log" && break; sleep 0.2; done
  if ! grep -q listening "mind-$R.log"; then
    cat "mind-$R.log"; kill $MIND 2>/dev/null
    RES='{"played":false,"why":"mind did not start"}'
  else
    sleep $(( start - $(date +%s) > 0 ? start - $(date +%s) : 0 ))
    RES=$(cd "$PG" && LUA_PATH="$LP" LUA_CPATH="$LC" PA_SURVIVOR_PORT=47777 \
          timeout $(( ROUND_S + 60 )) luajit "$EVAL/lua/island2Match.lua" "$HOST" "$PORT" "$NAME" "isl2b$OPP" 21600 120 2>&1 \
          | tee -a "$OLDPWD/match.log" | grep '^RESULT ' | tail -1 | sed 's/^RESULT //')
    kill $MIND 2>/dev/null; wait $MIND 2>/dev/null
    grep -h "match over" "mind-$R.log" | tail -1 | sed 's/^/  mind: /'
  fi
  [ -n "$RES" ] || RES='{"played":false,"why":"no result"}'
  git -C "$STATE" pull -q --rebase origin island2-state || true
  E=$(node "$EVAL/island2.js" record "$STATE" "$N" "$R" "$RES") && echo "::notice title=$NAME round $R::$E"
  push_state "$R"
done
