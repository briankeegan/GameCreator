#!/usr/bin/env bash
# A BOT PLAYS THE REAL CLIENT'S TRAINING MODE (the attack engine's presets).
#
#   PG=<panel-game checkout> LOVE=<love binary> training.sh [BOT [PATTERN [GAMES]]]
#
# PATTERN is combo_storm, factory or large_garbage (default); GAMES how many games (default 10). Each game is a
# client of its own: the menus clicked through (Main Menu -> og stuff -> Training -> the pattern -> Go! -> Ready),
# the game played until the stack tops out or PA_TRAINING_FRAMES (FRAMES, default 10800) frames have gone, its
# result a line `training lost|survived frames=F` in $OUT_DIR/pa_out.txt, then the client quits.
#
# BOT is wasm (WasmSurvivor, survivor.js; PROFILE picks the profile, relative to this directory) or bitbot
# (BitBot, in the client's own process). The client runs under xvfb, driven through its own menus by its e2e
# harness (client/src/debug/AppDriver.lua, PA_CMD_FILE, `trainingloop`); the local player's stack takes its keys
# from the bot (PA_SURVIVOR=1, PA_BOT).
#
# Env: OUT_DIR (default ./training-out), PORT (47777), MINUTES (330, each client's limit), PROFILE, FRAMES.
# $OUT_DIR/results.txt holds a line per game.
set -u
EVAL="$(cd "$(dirname "$0")" && pwd)"
BOT=${1:-wasm}; PATTERN=${2:-large_garbage}; GAMES=${3:-10}
: "${PG:?PG: a panel-game checkout}" "${LOVE:?LOVE: the love binary (or the AppRun of an extracted AppImage)}"
OUT_DIR=${OUT_DIR:-$PWD/training-out}; PORT=${PORT:-47777}; MINUTES=${MINUTES:-330}
mkdir -p "$OUT_DIR"; OUT_DIR=$(cd "$OUT_DIR" && pwd)
CMD="$OUT_DIR/pa_cmd.txt" OUT="$OUT_DIR/pa_out.txt"
: > "$OUT"
case "$BOT" in wasm|bitbot) ;; *) echo "training.sh: BOT is wasm or bitbot, not $BOT" >&2; exit 2 ;; esac
# the block each pattern sends (TrainingMenu.lua), checked against what the menu reports before a game starts
case "$PATTERN" in combo_storm) SIZE=4x1 ;; factory) SIZE=6x2 ;; large_garbage) SIZE=6x12 ;; *) echo "training.sh: PATTERN is combo_storm, factory or large_garbage, not $PATTERN" >&2; exit 2 ;; esac

# THE BOT HAS THE MACHINE THE DRILLS GIVE IT. The client draws every frame in
# software (llvmpipe), which spreads over every core it is given; it is held
# to the first core with one render thread, and WasmSurvivor runs on the rest.
NCPU=$(nproc); CLIENT_CPU=0; MIND_CPUS="1-$(( NCPU - 1 ))"
[ "$NCPU" -lt 2 ] && MIND_CPUS=0
MIND=
cleanup() { [ -n "$MIND" ] && kill "$MIND" 2>/dev/null; [ -n "${CLIENT:-}" ] && kill "$CLIENT" 2>/dev/null; }
trap cleanup EXIT
if [ "$BOT" = wasm ]; then
  [ -n "${PROFILE:-}" ] && export GC_SURVIVOR_PROFILE="$EVAL/$PROFILE"
  # each stage it loses: its last frames, boards and decisions (survivor_death.js reads them), and every frame of the game
  # (frames.jsonl.gz: the board on the frames it changed on; training/lastframes replays it)
  GC_SURVIVOR_DUMP="$OUT_DIR/death.jsonl" GC_SURVIVOR_KEEP=4 GC_SURVIVOR_FRAMES="$OUT_DIR/frames.jsonl.gz" \
    taskset -c "$MIND_CPUS" node "$EVAL/survivor.js" --port "$PORT" --threads $(( NCPU - 1 )) > "$OUT_DIR/survivor.log" 2>&1 &
  MIND=$!
  for i in $(seq 1 300); do grep -q listening "$OUT_DIR/survivor.log" && break; sleep 0.2; done
  grep -q listening "$OUT_DIR/survivor.log" || { cat "$OUT_DIR/survivor.log"; echo "training.sh: WasmSurvivor did not start" >&2; exit 1; }
else
  # BitBot's library, built for this machine (native/build.sh's line for it)
  (cd "$EVAL/native" && clang -O3 -march=native -pthread -fPIC -shared -DPA_LIB -Wno-unknown-attributes -Wno-ignored-attributes -Wno-unused-function bit.c pa.c -lm -o libbit.so) || exit 1
fi

send() { printf '%s\n' "$@" >> "$CMD"; }
lastscene() { grep -o '^\(ready\|scene\)=.*' "$OUT" | tail -1 | cut -d= -f2; }
: > "$OUT_DIR/results.txt"
for g in $(seq 1 "$GAMES"); do
  : > "$OUT"; : > "$CMD"
  (cd "$PG" && XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/tmp} PA_CMD_FILE="$CMD" PA_OUT_FILE="$OUT" \
     PA_SURVIVOR=1 PA_BOT="$BOT" PA_SURVIVOR_PORT="$PORT" GC_EVAL_DIR="$EVAL" PA_TRAINING_FRAMES="${FRAMES:-10800}" \
     LP_NUM_THREADS=1 exec taskset -c "$CLIENT_CPU" timeout $(( MINUTES * 60 )) stdbuf -oL xvfb-run --auto-servernum -s "-screen 0 1280x720x24" "$LOVE" "$PG") > "$OUT_DIR/client-$g.log" 2>&1 &
  CLIENT=$!
  for i in $(seq 1 300); do grep -q '^ready=' "$OUT" && break; kill -0 $CLIENT 2>/dev/null || break; sleep 1; done
  grep -q '^ready=' "$OUT" || { echo "game $g: the client did not start" | tee -a "$OUT_DIR/results.txt"; continue; }
  for i in $(seq 1 20); do
    [ "$(lastscene)" = MainMenu ] && break
    send "tap return" "wait 60" "scene"; sleep 3
  done
  send "menusel og stuff" "menusel mm_1_training" "waitscene TrainingMenu 600"
  # the pattern is set by name and its block size checked before Go: a pattern not set plays Custom, 1x1
  send "trainingpattern $PATTERN"
  for i in $(seq 1 60); do grep -q '^trainingpattern ' "$OUT" && break; sleep 1; done
  got=$(grep -h '^trainingpattern ' "$OUT" | tail -1 | awk '{print $NF}')
  [ "$got" = "$SIZE" ] || { echo "game $g: the pattern is $got, not $PATTERN ($SIZE)" | tee -a "$OUT_DIR/results.txt"; kill "$CLIENT" 2>/dev/null; wait "$CLIENT" 2>/dev/null; continue; }
  send "menusel go_" "waitscene CharacterSelectVsSelf 600" "hold z 40" "wait 30" "trainingloop"
  while kill -0 $CLIENT 2>/dev/null; do grep -q '^training ' "$OUT" && break; sleep 5; done
  sleep 3; kill "$CLIENT" 2>/dev/null; wait "$CLIENT" 2>/dev/null
  cp "$OUT" "$OUT_DIR/pa_out-$g.txt"
  r=$(grep -h '^training ' "$OUT" | tail -1); echo "game $g $PATTERN ${r:-no result}" | tee -a "$OUT_DIR/results.txt"
  grep -h 'not in\|no menu\|TIMEOUT' "$OUT" | sed "s/^/game $g: /" >> "$OUT_DIR/results.txt"
done
CLIENT=
[ -s "$OUT_DIR/death.jsonl" ] && node "$EVAL/survivor_death.js" "$OUT_DIR/death.jsonl" > "$OUT_DIR/death.txt" 2>&1
cat "$OUT_DIR/results.txt"
grep -q ' training ' "$OUT_DIR/results.txt"
