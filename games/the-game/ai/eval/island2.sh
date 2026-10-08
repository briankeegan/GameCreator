#!/usr/bin/env bash
# ONE ISLAND 2.0 BOT on the live server (islands2.yml).
#
#   BOT=N HOST=ip PORT=port STATE=<island2-state worktree> PG=<panel-game checkout> DEADLINE=<epoch s> island2.sh
#
# Starts WasmSurvivor (survivor.js, re-reading this bot's profile at every
# match) and the bot (lua/island2Bot.lua), which stays logged in and plays
# whichever of the others is free till DEADLINE. The bot calls back here:
#   island2.sh played           matches played against each other bot (island2.js played)
#   island2.sh after OPP RESULT records the match (island2.js record: a loss
#                               moves the weights toward the winner's), rewrites
#                               the profile and pushes this bot's file to the
#                               state branch; prints the record
set -u
EVAL="$(cd "$(dirname "$0")" && pwd)"
N=$BOT; NAME="isl2b$N"

push_state() {   # this bot's file only; another bot's push is rebased onto, never overwritten
  git -C "$STATE" add "bot$N.json"
  git -C "$STATE" commit -qm "island2: $NAME, $1" || return 0
  for i in 1 2 3 4 5 6; do
    git -C "$STATE" push -q origin HEAD:island2-state 2>/dev/null && return 0
    git -C "$STATE" pull -q --rebase origin island2-state 2>/dev/null
    sleep $((RANDOM % 5 + i))
  done
  echo "::warning::$NAME could not push: $1" >&2
}

case "${1:-}" in
  played)
    git -C "$STATE" pull -q --rebase origin island2-state 2>/dev/null
    node "$EVAL/island2.js" played "$STATE" "$N"
    exit ;;
  after)
    git -C "$STATE" pull -q --rebase origin island2-state 2>/dev/null
    E=$(node "$EVAL/island2.js" record "$STATE" "$N" "$2" "$3") || exit 1
    node "$EVAL/island2.js" profile "$STATE" "$N" "$EVAL" > /dev/null
    push_state "vs isl2b$2"
    echo "::notice title=$NAME vs isl2b$2::$E%0Amind: $(grep -h 'match over\|decision failed\|Error' "$MINDLOG" 2>/dev/null | tail -n 2 | cut -c1-400 | sed 's/%/%25/g' | sed ':a;N;$!ba;s/\n/%0A/g')" >&2
    echo "$E"
    exit ;;
esac

# Same name, same account (bot/fight.sh's id): derived from the name and host.
mkdir -p "$PG/bot/identities"
BOT_IP="$HOST" BOT_NAME="$NAME" python3 -c '
import hashlib, os
msg = (os.environ["BOT_IP"] + "/" + os.environ["BOT_NAME"].lower()).encode()
print("1" + str(int(hashlib.sha256(msg).hexdigest(), 16) % 10**18).zfill(18), end="")' > "$PG/bot/identities/${NAME}_${HOST}.txt"

P=$(node "$EVAL/island2.js" profile "$STATE" "$N" "$EVAL")
export MINDLOG="$PWD/mind.log"
# WasmSurvivor, brought back if it ever exits
( while :; do
    GC_SURVIVOR_RELOAD=1 GC_SURVIVOR_PROFILE="$P" node "$EVAL/survivor.js" --port 47777 --threads $(( $(nproc) - 1 )) >> "$MINDLOG" 2>&1
    echo "mind exited ($?), restarting" >> "$MINDLOG"; sleep 2
  done ) &
SUP=$!
trap 'kill $SUP 2>/dev/null; pkill -f "survivor.js --port 47777"' EXIT
for i in $(seq 1 150); do grep -q listening "$MINDLOG" && break; sleep 0.2; done
grep -q listening "$MINDLOG" || { cat "$MINDLOG"; echo "$NAME: WasmSurvivor did not start"; exit 1; }

# the last match must be able to end before the job does
STOP_AT=$(( DEADLINE - 600 ))
echo "::notice title=$NAME::starting on $HOST:$PORT, stops at $(date -u -d @$STOP_AT +%H:%M) UTC, played $(bash "$EVAL/island2.sh" played)"
OUT="$PWD/match.log"
# the bot, logged in again if it ever drops out before STOP_AT
while :; do
  (cd "$PG" && ISLAND2_SH="$EVAL/island2.sh" BOT="$N" STATE="$STATE" PA_SURVIVOR_PORT=47777 \
    LUA_PATH="./?.lua;./common/lib/?.lua;/usr/local/share/lua/5.1/?.lua;;" \
    LUA_CPATH="./common/lib/?.so;./common/lib/?/?.so;/usr/local/lib/lua/5.1/?.so;;" \
    timeout $(( DEADLINE - $(date +%s) )) luajit "$EVAL/lua/island2Bot.lua" "$HOST" "$PORT" "$N" "$STOP_AT") >> "$OUT" 2>&1
  rc=$?
  [ $rc = 0 ] || [ $(date +%s) -ge $STOP_AT ] && break
  echo "::warning title=$NAME dropped out ($rc), logging in again::$(tail -n 8 "$OUT" | sed 's/%/%25/g' | sed ':a;N;$!ba;s/\n/%0A/g')"
  sleep 5
done
# the run's annotations are where its story is read: how it ended, and the end of its log
echo "::notice title=$NAME ended ($rc)::$(tail -n 25 "$OUT" | sed 's/%/%25/g' | sed ':a;N;$!ba;s/\n/%0A/g')"
grep -h "match over" "$MINDLOG" | tail -n 3 | sed 's/^/mind: /'
