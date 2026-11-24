#!/usr/bin/env bash
# THE 28 GAMES ON THE LIVE BOT'S OWN SETUP, LOCALLY: upstream Panel Attack's engine and the live client's bot/, Gambit built and
# pinned exactly as bot-prod-smoke-test.yml builds and pins it for Ranmaru, the games paced to real time. No server: the opponent is
# upstream's own training attacker (round.lua). 8 combo_storm, 8 factory, 8 large_garbage, 4 endless, one after another (each
# game takes the whole machine, as on the runner).
#
#   bash run28.sh [OUT_DIR]          OUT_DIR default: work/<commit> beside this script
# Env:
#   GC_DIR          the GameCreator checkout whose Gambit plays (default: the one this script is in)
#   GC_UPSTREAM_REF upstream ref (default beta: the game panelattack.com runs, as the live job resolves it)
#   GC_PANEL_DIR    a panel-game checkout to take bot/ and SurvivalLink from (default: fetched from GitHub)
#   PA_LEVEL        the modern level (default 10, the live one)
#   PA_ROUND_BURST  frames back to back per 60th of a second (lockstep catch-up; default 1)
#   FRAMES          a game's length if the bot lives (default 21600)
#   GAMES           which games, "scenario:seed ..." (default all 28)
#
# Out: one line per game, then summary.json (survived per mode, late and refused answers per game). Exits 1 when any game is
# lost or any answer was refused.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
GC=${GC_DIR:-$(git -C "$HERE" rev-parse --show-toplevel)}
EVAL="$GC/games/the-game/ai/eval"
G="$GC/games/the-game/ai/gambit"
COMMIT=$(git -C "$GC" rev-parse --short HEAD)
OUT=${1:-$HERE/work/$COMMIT}
WORK="$HERE/work/upstream"
UPSTREAM_REPO=https://github.com/panel-attack/panel-game.git
PANEL_REPO=https://github.com/briankeegan/panel-game.git
BOT_REF=claude/game-bot-creation-action-0e7emk   # bot-prod-smoke-test.yml's UPSTREAM_BOT_REF
LINK_REF=bramp/multi-player                      # the ref the live job is dispatched on: SurvivalLink and its test
mkdir -p "$OUT" "$HERE/work"

# 1. UPSTREAM, AS THE LIVE JOB FETCHES IT: a fresh checkout of the ref, the client's bot/ dropped on top, the link copied in.
rm -rf "$WORK"; git init -q "$WORK"
git -C "$WORK" fetch -q --depth 1 "$UPSTREAM_REPO" "${GC_UPSTREAM_REF:-beta}"
git -C "$WORK" checkout -q FETCH_HEAD
[ ! -e "$WORK/bot" ] || { echo "upstream now has its own bot/ -- refusing to overwrite it"; exit 1; }
PANEL=${GC_PANEL_DIR:-}
if [ -z "$PANEL" ]; then
  PANEL="$HERE/work/panel"; rm -rf "$PANEL"; git init -q "$PANEL"
  git -C "$PANEL" fetch -q --depth 1 "$PANEL_REPO" "$BOT_REF" "$LINK_REF"
fi
git -C "$PANEL" fetch -q origin "$BOT_REF" "$LINK_REF" 2>/dev/null || true
rev() { git -C "$PANEL" rev-parse -q --verify "origin/$1" 2>/dev/null || git -C "$PANEL" ls-remote "$PANEL_REPO" "refs/heads/$1" | cut -f1; }
BOT_SHA=$(rev "$BOT_REF") LINK_SHA=$(rev "$LINK_REF")
mkdir -p "$WORK/bot"
git -C "$PANEL" archive "$BOT_SHA" bot | tar -x -C "$WORK"
for f in bot/SurvivalLink.lua bot/tests/survivalLinkTelegraphVerify.lua; do
  mkdir -p "$WORK/$(dirname "$f")"; git -C "$PANEL" show "$LINK_SHA:$f" > "$WORK/$f"
done
cp "$HERE/round.lua" "$WORK/bot/upstreamRound.lua"
eval "$(luarocks path --local --lua-version 5.1 2>/dev/null)" || true
export LUA_PATH="./?.lua;./common/lib/?.lua;${LUA_PATH:-};;" LUA_CPATH="./common/lib/?.so;./common/lib/?/?.so;${LUA_CPATH:-};;"
(cd "$WORK" && luajit bot/tests/survivalLinkTelegraphVerify.lua) > "$OUT/link-verify.log" 2>&1 || { cat "$OUT/link-verify.log"; echo "the link's own test failed on upstream"; exit 1; }

# 2. GAMBIT, AS THE LIVE JOB BUILDS IT
sh "$G/build.sh" native > "$OUT/gambit-build.log" 2>&1 || { cat "$OUT/gambit-build.log"; echo "libgambit.so did not build"; exit 1; }
GC_SURVIVOR_PROFILE="$EVAL/survivor-profiles/gambit.json" node "$G/words.js" > "$OUT/gambit.words" 2>> "$OUT/gambit-build.log" || { cat "$OUT/gambit-build.log"; echo "Gambit's profile did not encode"; exit 1; }

# 3. THE MACHINE AS THE LIVE JOB PINS IT: the client on CPU 0, Gambit alone on a CPU of another core, its 4 workers on the rest
core() { cat "/sys/devices/system/cpu/cpu$1/topology/core_id" 2>/dev/null || echo "$1"; }
gcpu="" wcpus=""
for c in $(seq 1 $(( $(nproc) - 1 ))); do
  if [ -z "$gcpu" ] && [ "$(core "$c")" != "$(core 0)" ]; then gcpu=$c; else wcpus=${wcpus:+$wcpus,}$c; fi
done
[ -n "$gcpu" ] || { gcpu=0; wcpus=0; }
export GC_EVAL_DIR="$EVAL" GC_GAMBIT_WORDS="$OUT/gambit.words" GC_GAMBIT_WORKERS=4 GC_GAMBIT_CPUS="$gcpu" GC_GAMBIT_WORKER_CPUS="${wcpus:-$gcpu}"
export PA_LEVEL=${PA_LEVEL:-10}
echo "upstream $(git -C "$WORK" log -1 --format='%h %s' | cut -c1-80); bot/ ${BOT_SHA:0:8}, link ${LINK_SHA:0:8}; Gambit $COMMIT; level $PA_LEVEL; client CPU 0, Gambit $gcpu, workers ${wcpus:-$gcpu}"

# 4. THE GAMES
games=${GAMES:-$(for s in combo_storm factory large_garbage; do for n in 1 2 3 4 5 6 7 8; do printf '%s:%d ' $s $n; done; done; printf 'endless:%d ' 1 2 3 4)}
: > "$OUT/rounds.txt"
for g in $games; do
  s=${g%%:*} n=${g##*:} log="$OUT/$s-$n.log"
  rm -f "$log"
  line=$(cd "$WORK" && GC_GAMBIT_LOG="$log" PA_SEED="$n" taskset -c 0 luajit bot/upstreamRound.lua "$s" "$n" "${FRAMES:-21600}" 2> "$OUT/$s-$n.err" | grep '^ROUND' || true)
  [ -n "$line" ] || line="ROUND $s $n crashed frames=0 swaps=0 cleared=0"
  late=$(grep -c '^LATE answer' "$log" 2>/dev/null || true) refused=$(grep -c 'REFUSED' "$log" 2>/dev/null || true)
  echo "$line late=${late:-0} refused=${refused:-0}" | tee -a "$OUT/rounds.txt"
done

# 5. THE SUMMARY, AS DATA (the count read back is the count sent)
python3 - "$OUT" "$(echo $games | wc -w)" <<'EOF'
import json, re, sys
out, sent = sys.argv[1], int(sys.argv[2])
games = []
for l in open(out + "/rounds.txt"):
    m = re.match(r"ROUND (\S+) (\d+) (\S+) frames=(\d+) swaps=(\d+) cleared=(\d+) late=(\d+) refused=(\d+)", l)
    if m: games.append(dict(mode=m[1], seed=int(m[2]), result=m[3], frames=int(m[4]), swaps=int(m[5]), cleared=int(m[6]), late=int(m[7]), refused=int(m[8])))
assert len(games) == sent, f"summary: {len(games)} games read back, {sent} played"
modes = {}
for g in games:
    m = modes.setdefault(g["mode"], {"survived": 0, "games": 0, "late": 0, "refused": 0})
    m["games"] += 1; m["survived"] += g["result"] == "survived"; m["late"] += g["late"]; m["refused"] += g["refused"]
json.dump({"modes": modes, "games": games}, open(out + "/summary.json", "w"), indent=1)
print("survived " + ", ".join(f'{k} {v["survived"]}/{v["games"]}' for k, v in modes.items())
      + f'; late answers {sum(g["late"] for g in games)}, refused {sum(g["refused"] for g in games)}')
sys.exit(0 if all(g["result"] == "survived" and g["refused"] == 0 for g in games) else 1)
EOF
