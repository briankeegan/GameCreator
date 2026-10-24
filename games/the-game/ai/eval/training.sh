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
# BOT is gambit (Gambit, in the client's own process: ../gambit/lua/GambitNative.lua on libgambit.so; PROFILE picks the profile,
# relative to this directory), wasm (WasmSurvivor, survivor.js; PROFILE too) The client runs under xvfb, driven through its own menus by its e2e
# harness (client/src/debug/AppDriver.lua, PA_CMD_FILE, `trainingloop`); the local player's stack takes its keys
# from the bot (PA_SURVIVOR=1, PA_BOT).
#
# Env: OUT_DIR (default ./training-out), PORT (47777), MINUTES (330, each client's limit), PROFILE, FRAMES, LEVEL (the modern level
# the player's stack plays, 11; set on the character select and checked before Ready).
# $OUT_DIR/results.txt holds a line per game.
set -u
EVAL="$(cd "$(dirname "$0")" && pwd)"
BOT=${1:-wasm}; PATTERN=${2:-large_garbage}; GAMES=${3:-10}; LEVEL=${LEVEL:-11}
: "${PG:?PG: a panel-game checkout}" "${LOVE:?LOVE: the love binary (or the AppRun of an extracted AppImage)}"
OUT_DIR=${OUT_DIR:-$PWD/training-out}; PORT=${PORT:-47777}; MINUTES=${MINUTES:-330}
mkdir -p "$OUT_DIR"; OUT_DIR=$(cd "$OUT_DIR" && pwd)
CMD="$OUT_DIR/pa_cmd.txt" OUT="$OUT_DIR/pa_out.txt"
: > "$OUT"
case "$BOT" in gambit|wasm) ;; *) echo "training.sh: BOT is gambit or wasm, not $BOT" >&2; exit 2 ;; esac
# the block each pattern sends (TrainingMenu.lua), checked against what the menu reports before a game starts
case "$PATTERN" in combo_storm) SIZE=4x1 ;; factory) SIZE=6x2 ;; large_garbage) SIZE=6x12 ;; *) echo "training.sh: PATTERN is combo_storm, factory or large_garbage, not $PATTERN" >&2; exit 2 ;; esac

# THE BOT HAS THE MACHINE THE DRILLS GIVE IT. The client draws every frame in
# software (llvmpipe), which spreads over every core it is given; it is held
# to the first core with one render thread, and the bot's thinking and the X server run on the rest, so nothing else is scheduled on
# the game's core.
NCPU=$(nproc); CLIENT_CPU=0; MIND_CPUS="1-$(( NCPU - 1 ))"
[ "$NCPU" -lt 2 ] && MIND_CPUS=0
# Gambit's own thread alone on a core the game's is not on, its workers on the CPUs left (each the other hyperthread of one or the
# other: they run at the idle class, so they take only what those leave) -- measured, cpu_watch.sh: a runner's four CPUs are two
# cores, and the game and Gambit's thread each keep one CPU busy
core() { cat "/sys/devices/system/cpu/cpu$1/topology/core_id" 2>/dev/null || echo "$1"; }
GAMBIT_CPU= WORKER_CPUS=
for c in $(seq 1 $(( NCPU - 1 ))); do
  if [ -z "$GAMBIT_CPU" ] && [ "$(core "$c")" != "$(core "$CLIENT_CPU")" ]; then GAMBIT_CPU=$c; else WORKER_CPUS=${WORKER_CPUS:+$WORKER_CPUS,}$c; fi
done
[ -z "$GAMBIT_CPU" ] && { GAMBIT_CPU=$MIND_CPUS; WORKER_CPUS=$MIND_CPUS; }
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
elif [ "$BOT" = gambit ]; then
  # Gambit's library, built for this machine unless the run built it once for every game (GC_GAMBIT_BUILT), and the profile as numbers
  # (words.js); its log is the run's survivor.log
  [ -n "$GC_GAMBIT_BUILT" ] && [ -f "$EVAL/../gambit/libgambit.so" ] || "$EVAL/../gambit/build.sh" native || exit 1
  GC_SURVIVOR_PROFILE="$EVAL/${PROFILE:-survivor-profiles/gambit-finish.json}" node "$EVAL/../gambit/words.js" > "$OUT_DIR/gambit.words" || exit 1
  # (LOCKSTEP and UNPACED: the game waits on every answer Gambit was asked and plays its frames back to back -- each decision's time the
  # work clock's alone, so a seed is the same game on any runner, as fast as the runner plays it; live play sets neither)
  export GC_GAMBIT_LOCKSTEP="${GC_GAMBIT_LOCKSTEP:-1}" PA_UNPACED="${PA_UNPACED:-1}"
  export GC_GAMBIT_WORDS="$OUT_DIR/gambit.words" GC_GAMBIT_LOG="$OUT_DIR/survivor.log" GC_GAMBIT_CPUS="$GAMBIT_CPU" GC_GAMBIT_WORKER_CPUS="$WORKER_CPUS"
  echo "training.sh: the game on CPU $CLIENT_CPU, Gambit on $GAMBIT_CPU, its workers on $WORKER_CPUS"
  : > "$OUT_DIR/survivor.log"
fi

send() { printf '%s\n' "$@" >> "$CMD"; }
lastscene() { grep -o '^\(ready\|scene\)=.*' "$OUT" | tail -1 | cut -d= -f2; }
: > "$OUT_DIR/results.txt"
for g in $(seq 1 "$GAMES"); do
  : > "$OUT"; : > "$CMD"
  (cd "$PG" && XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/tmp} PA_CMD_FILE="$CMD" PA_OUT_FILE="$OUT" \
     PA_SURVIVOR=1 PA_BOT="$BOT" PA_SURVIVOR_PORT="$PORT" GC_EVAL_DIR="$EVAL" PA_TRAINING_FRAMES="${FRAMES:-10800}" \
     LP_NUM_THREADS=1 exec taskset -c "$MIND_CPUS" timeout $(( MINUTES * 60 )) stdbuf -oL xvfb-run --auto-servernum -s "-screen 0 1280x720x24" \
       taskset -c "$CLIENT_CPU" "$LOVE" "$PG") > "$OUT_DIR/client-$g.log" 2>&1 &
  CLIENT=$!
  for i in $(seq 1 300); do grep -q '^ready=' "$OUT" && break; kill -0 $CLIENT 2>/dev/null || break; sleep 1; done
  grep -q '^ready=' "$OUT" || { echo "game $g: the client did not start" | tee -a "$OUT_DIR/results.txt"; continue; }
  # (where the machine goes while it plays: cpu_watch.sh, one line a game in results.txt)
  "$EVAL/cpu_watch.sh" "$CLIENT" "$OUT_DIR/cpu-$g.txt" &
  # (the game's thread wins its own core: raised above anything else scheduled there, where the runner allows it)
  LP=$(pgrep -n -f "$LOVE $PG" 2>/dev/null); [ -n "$LP" ] && sudo -n renice -n -10 -p "$LP" >/dev/null 2>&1 || true
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
  send "menusel go_" "waitscene CharacterSelectVsSelf 600" "level $LEVEL"
  # (the level set on the character select, and checked: a level not set plays the client's saved one)
  for i in $(seq 1 60); do grep -q '^level ' "$OUT" && break; sleep 1; done
  lv=$(grep -h '^level ' "$OUT" | tail -1 | awk '{print $2}')
  [ "$lv" = "$LEVEL" ] || { echo "game $g: the level is ${lv:-unset}, not $LEVEL" | tee -a "$OUT_DIR/results.txt"; kill "$CLIENT" 2>/dev/null; wait "$CLIENT" 2>/dev/null; continue; }
  send "hold z 40" "wait 30" "trainingloop"
  while kill -0 $CLIENT 2>/dev/null; do grep -q '^training ' "$OUT" && break; sleep 5; done
  sleep 3; kill "$CLIENT" 2>/dev/null; wait "$CLIENT" 2>/dev/null
  cp "$OUT" "$OUT_DIR/pa_out-$g.txt"
  r=$(grep -h '^training ' "$OUT" | tail -1); echo "game $g $PATTERN ${r:-no result}" | tee -a "$OUT_DIR/results.txt"
  # (a game the client died in: the crash its handler wrote (gambit/host.c crashOut), the frames in libgambit.so resolved by addr2line)
  if [ -z "$r" ]; then
    grep -h '^GAMBIT CRASH' "$OUT_DIR/client-$g.log" 2>/dev/null | head -1 | sed "s/^/game $g /" | tee -a "$OUT_DIR/results.txt"
    grep -h '^GAMBIT FRAME' "$OUT_DIR/client-$g.log" 2>/dev/null | while read -r _ _ n lib off; do
      case "$lib" in *libgambit.so) echo "game $g crash frame $n $(addr2line -f -i -C -e "$lib" "$off" 2>/dev/null | paste -sd' ')";; *) echo "game $g crash frame $n $lib $off";; esac
    done | tee -a "$OUT_DIR/results.txt"
  fi
  for i in $(seq 1 20); do [ -s "$OUT_DIR/cpu-$g.txt" ] && break; sleep 1; done
  [ -s "$OUT_DIR/cpu-$g.txt" ] && echo "game $g $(cat "$OUT_DIR/cpu-$g.txt")" | tee -a "$OUT_DIR/results.txt"
  # the first frame this game's health fell: where a game of one health (levels 10 and 11) is lost
  [ -s "$OUT_DIR/frames.jsonl.gz" ] && node -e '
    var L = require("zlib").gunzipSync(require("fs").readFileSync(process.argv[1]), { finishFlush: require("zlib").constants.Z_SYNC_FLUSH }).toString().split("\n"), max = 0, at = null;
    for (var i = 0; i < L.length && at === null; i++) { try { var r = JSON.parse(L[i]); } catch (e) { continue; } if (r.health > max) max = r.health; else if (r.health < max) at = r.clock; }
    console.log("game '"$g"' level'"$LEVEL"' " + (at === null ? "kept all health" : "lost health at frame " + at));' "$OUT_DIR/frames.jsonl.gz" | tee -a "$OUT_DIR/results.txt"
  grep -h 'not in\|no menu\|TIMEOUT' "$OUT" | sed "s/^/game $g: /" >> "$OUT_DIR/results.txt"
done
CLIENT=
[ -s "$OUT_DIR/death.jsonl" ] && node "$EVAL/survivor_death.js" "$OUT_DIR/death.jsonl" > "$OUT_DIR/death.txt" 2>&1
cat "$OUT_DIR/results.txt"
grep -q ' training ' "$OUT_DIR/results.txt"
