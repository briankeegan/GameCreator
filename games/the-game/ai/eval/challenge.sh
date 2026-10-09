#!/usr/bin/env bash
# A BOT PLAYS THE REAL CLIENT'S CHALLENGE MODE.
#
#   PG=<panel-game checkout> LOVE=<love binary> challenge.sh [BOT [DIFFICULTY [CONTINUES]]]
#
# BOT is wasm (WasmSurvivor, survivor.js; PROFILE picks the profile, relative
# to this directory) or bitbot (BitBot, in the client's own process). DIFFICULTY
# is 1-8 (8 = Hurricane, the default); CONTINUES the continues after which it
# stops (default 10).
#
# The panel-game client is launched under xvfb and driven through its own
# menus by its e2e harness (client/src/debug/AppDriver.lua, PA_CMD_FILE) the
# way a player clicks them: Main Menu -> og stuff -> Challenge Mode -> the
# difficulty -> Go! -> a key held to claim the controller -> Ready. The local
# player's stack takes its keys from the bot (PA_SURVIVOR=1, PA_BOT), stage
# after stage, until the recap or the continues run out. Each stage's result
# is a line `stage N won|lost frames=F continues=C next=S complete=X` in
# $OUT_DIR/pa_out.txt, as it is played; the end prints them all.
#
# Env: OUT_DIR (default ./challenge-out), PORT (47777), MINUTES (330, the
# client's limit), PROFILE; STAGE=N starts on stage N, and with REPEAT=K plays
# that stage K times, won or lost.
set -u
EVAL="$(cd "$(dirname "$0")" && pwd)"
BOT=${1:-wasm}; DIFFICULTY=${2:-8}; CONTINUES=${3:-10}
: "${PG:?PG: a panel-game checkout}" "${LOVE:?LOVE: the love binary (or the AppRun of an extracted AppImage)}"
OUT_DIR=${OUT_DIR:-$PWD/challenge-out}; PORT=${PORT:-47777}; MINUTES=${MINUTES:-330}
mkdir -p "$OUT_DIR"; OUT_DIR=$(cd "$OUT_DIR" && pwd)
CMD="$OUT_DIR/pa_cmd.txt" OUT="$OUT_DIR/pa_out.txt"
: > "$OUT"
case "$BOT" in wasm|bitbot) ;; *) echo "challenge.sh: BOT is wasm or bitbot, not $BOT" >&2; exit 2 ;; esac

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
  # each stage it loses: its last frames, boards and decisions (survivor_death.js reads them)
  GC_SURVIVOR_DUMP="$OUT_DIR/death.jsonl" GC_SURVIVOR_KEEP=4 \
    taskset -c "$MIND_CPUS" node "$EVAL/survivor.js" --port "$PORT" --threads $(( NCPU - 1 )) > "$OUT_DIR/survivor.log" 2>&1 &
  MIND=$!
  for i in $(seq 1 300); do grep -q listening "$OUT_DIR/survivor.log" && break; sleep 0.2; done
  grep -q listening "$OUT_DIR/survivor.log" || { cat "$OUT_DIR/survivor.log"; echo "challenge.sh: WasmSurvivor did not start" >&2; exit 1; }
else
  # BitBot's library, built for this machine (native/build.sh's line for it)
  (cd "$EVAL/native" && clang -O3 -march=native -pthread -fPIC -shared -DPA_LIB -Wno-unknown-attributes -Wno-ignored-attributes -Wno-unused-function bit.c pa.c -lm -o libbit.so) || exit 1
fi

(cd "$PG" && XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/tmp} PA_CMD_FILE="$CMD" PA_OUT_FILE="$OUT" \
   PA_SURVIVOR=1 PA_BOT="$BOT" PA_SURVIVOR_PORT="$PORT" GC_EVAL_DIR="$EVAL" PA_CHALLENGE_CONTINUES="$CONTINUES" \
   PA_CHALLENGE_STAGE="${STAGE:-}" PA_CHALLENGE_REPEAT="${REPEAT:-}" \
   LP_NUM_THREADS=1 exec taskset -c "$CLIENT_CPU" timeout $(( MINUTES * 60 )) stdbuf -oL xvfb-run --auto-servernum -s "-screen 0 1280x720x24" "$LOVE" "$PG") > "$OUT_DIR/client.log" 2>&1 &
CLIENT=$!

send() { printf '%s\n' "$@" >> "$CMD"; }
lastscene() { grep -o '^\(ready\|scene\)=.*' "$OUT" | tail -1 | cut -d= -f2; }
# up once the harness writes ready=<scene>
for i in $(seq 1 300); do grep -q '^ready=' "$OUT" && break; kill -0 $CLIENT 2>/dev/null || break; sleep 1; done
grep -q '^ready=' "$OUT" || { tr -cd '\11\12\15\40-\176' < "$OUT_DIR/client.log" | grep -v '^ALSA' | tail -20; echo "challenge.sh: the client did not start" | tee -a "$OUT" >&2; exit 1; }
# first-run screens and the title: Return till the main menu
for i in $(seq 1 20); do
  [ "$(lastscene)" = MainMenu ] && break
  send "tap return" "wait 60" "scene"; sleep 3
done
[ "$(lastscene)" = MainMenu ] || { echo "challenge.sh: never reached the main menu" | tee -a "$OUT" >&2; exit 1; }
# og stuff -> Challenge Mode -> the difficulty (the stepper starts at 1) -> Go! ->
# hold a key to claim the controller -> Ready, stage after stage
send "menusel og stuff" "menusel mm_1_challenge_mode" "waitscene ChallengeModeMenu 600"
for i in $(seq 2 "$DIFFICULTY"); do send "tap right"; done
send "texts" "menusel go_" "waitscene CharacterSelectChallenge 600" "hold z 40" "wait 30" "challengeloop"
while kill -0 $CLIENT 2>/dev/null; do
  grep -q '^challenge \(over\|stopped\)' "$OUT" && break
  sleep 10
done
sleep 3
# the screenshots the harness took (one as each stage ends), from the client's save dir
grep -o '^shot=.*' "$OUT" | cut -d= -f2- | while read -r f; do b=$(basename "$f"); find "${XDG_DATA_HOME:-$HOME/.local/share}/love" -name "$b" -exec cp {} "$OUT_DIR/" \; 2>/dev/null; done
[ -s "$OUT_DIR/death.jsonl" ] && node "$EVAL/survivor_death.js" "$OUT_DIR/death.jsonl" > "$OUT_DIR/death.txt" 2>&1
grep -h '^texts\|^stage \|^challenge \|TIMEOUT' "$OUT"
grep -q '^stage ' "$OUT"
