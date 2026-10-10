#!/usr/bin/env bash
# THE ACCEPTANCE SET, run in batches on Actions and never more than SLOTS jobs at once.
#
#   [HURRICANE=1] acceptance.sh [MINUTES [PROFILE]]     (needs gh, run from anywhere)
#
# What has to pass: WasmSurvivor lives the full six minutes (21,600 frames) of
# every drill -- combo_storm, factory, large_garbage -- on each seed, inside the
# game's thinking and input budgets, and beats Hurricane (Challenge Mode 8)
# with no continues. Each drill is a survivor-duels run of three seeds (three
# jobs); Hurricane is one challenge-mode run (one job).
#
# For MINUTES (default 10) it looks every POLL seconds: whatever of the QUEUE
# fits in the slots left is dispatched, and every run that has finished is
# judged once. It prints one line per verdict and a count of what is left.
set -u
MINUTES=${1:-10}; PROFILE=${2:-survivor-profiles/isl2b4.json}
REPO=briankeegan/GameCreator; SLOTS=${SLOTS:-10}; POLL=${POLL:-45}
PANEL=${PANEL:-claude/newsey-game-ask-qa8u5e}
api() { gh api "repos/$REPO/$1" "${@:2}"; }

# QUEUE: "kind drill seeds" -- a drill's seeds in one run, or hurricane
QUEUE=()
for seeds in '[4,5,6]' '[7,8,9]'; do for d in combo_storm factory large_garbage; do QUEUE+=("duel $d $seeds"); done; done
# Hurricane waits for the drills: HURRICANE=1 puts it in the queue
[ "${HURRICANE:-0}" = 1 ] && QUEUE+=("hurricane - -" "hurricane - -")

inflight() {   # jobs of ours not yet finished
  local n=0 w r c
  for w in survivor-duels challenge-mode; do
    for r in $(api "actions/workflows/$w.yml/runs?per_page=30" --jq '.workflow_runs[]|select(.status!="completed")|.id'); do
      c=$(api "actions/runs/$r/jobs?per_page=100" --jq '[.jobs[]|select(.status!="completed")]|length'); n=$((n + c))
    done
  done
  echo "$n"
}

dispatch() {   # kind drill seeds
  case "$1" in
    duel) api actions/workflows/survivor-duels.yml/dispatches -X POST -f ref=main -f "inputs[seeds]=$3" -f 'inputs[frames]=21600' -f "inputs[opponent]=$2" -f "inputs[profile]=$PROFILE" -f "inputs[panel_ref]=$PANEL" >/dev/null ;;
    hurricane) api actions/workflows/challenge-mode.yml/dispatches -X POST -f ref=main -f 'inputs[bot]=wasm' -f 'inputs[difficulty]=8' -f "inputs[profile]=$PROFILE" -f 'inputs[continues]=10' -f "inputs[panel_ref]=$PANEL" >/dev/null ;;
  esac
}

JUDGED=" "
judge() {   # every finished run of ours, once
  local w r conc msg
  for w in survivor-duels challenge-mode; do
    for r in $(api "actions/workflows/$w.yml/runs?per_page=12" --jq '.workflow_runs[]|select(.status=="completed")|.id'); do
      case "$JUDGED" in *" $r "*) continue ;; esac
      JUDGED="$JUDGED$r "
      for j in $(api "actions/runs/$r/jobs?per_page=100" --jq '.jobs[].id'); do
        msg=$(api "check-runs/$j/annotations" --jq '.[].message' 2>/dev/null | grep -o 'RESULT.*\|stage 12 [a-z]* .*complete=[a-z]*' | head -3 | tr '\n' ' ')
        [ -n "$msg" ] && echo "run $r: $msg"
      done
    done
  done
}

end=$(( $(date +%s) + MINUTES * 60 ))
while :; do
  busy=$(inflight)
  while [ ${#QUEUE[@]} -gt 0 ]; do
    set -- ${QUEUE[0]}; need=3; [ "$1" = hurricane ] && need=1
    [ $((busy + need)) -le "$SLOTS" ] || break
    dispatch "$@" && busy=$((busy + need)) && echo "$(date -u +%H:%M)Z dispatched $1 $2 $3 (jobs in flight: $busy)"
    QUEUE=("${QUEUE[@]:1}")
  done
  judge
  [ "$(date +%s)" -ge "$end" ] && break
  sleep "$POLL"
done
echo "$(date -u +%H:%M)Z left in the queue: ${#QUEUE[@]}; jobs in flight: $(inflight)"
