#!/usr/bin/env bash
# WHERE THE MACHINE GOES DURING A GAME: every 5 s, the CPU each thread of the client (love, Gambit in it) and the X server has used,
# and the machine's idle time, until the client is gone; then one line, the threads summed by name, each as a share of one CPU over
# the game, and the machine's idle as a share of all its CPUs.
#
#   cpu_watch.sh PID OUT     (PID: the client's; OUT: the line, written when it ends)
#   (CPU_WATCH_MATCH: the processes watched, a pgrep -f pattern; default love and the X server)
set -u
PID=$1 OUT=$2 T=$(mktemp -d)
stat() { awk '/^cpu /{ print $2+$3+$4+$5+$6+$7+$8, $5+$6 }' /proc/stat; }
read t0 i0 < <(stat); s0=$(date +%s.%N)
while kill -0 "$PID" 2>/dev/null; do
  for p in $(pgrep -f "${CPU_WATCH_MATCH:-love|Xvfb}" 2>/dev/null); do
    for d in /proc/$p/task/*; do
      # (the name may hold spaces: the fields after its closing parenthesis are counted from there -- utime, stime are 14 and 15)
      l=$(cat "$d/stat" 2>/dev/null) || continue
      n=${l#*(}; n=${n%)*}; r=${l##*) }
      set -- $r; echo "${d##*/} ${n// /_} $(( ${12} + ${13} ))"
    done
  done > "$T/now" 2>/dev/null
  [ -s "$T/now" ] && cp "$T/now" "$T/last"; read t1 i1 < <(stat); s1=$(date +%s.%N)
  sleep 5
done
[ -s "$T/last" ] || { echo "cpu: nothing sampled" > "$OUT"; rm -rf "$T"; exit 0; }
HZ=$(getconf CLK_TCK); N=$(nproc)
awk -v hz="$HZ" -v s0="$s0" -v s1="$s1" -v idle="$(( i1 - i0 ))" -v all="$(( t1 - t0 ))" -v n="$N" '
  { s[$2] += $3 }
  END {
    secs = s1 - s0; if (secs <= 0) secs = 1
    line = sprintf("cpu over %.0f s, %d CPUs, %.0f%% idle:", secs, n, all > 0 ? 100 * idle / all : 0)
    for (k in s) if (s[k] / hz / secs >= 0.01) line = line sprintf(" %s %.2f", k, s[k] / hz / secs)
    print line
  }' "$T/last" > "$OUT"
rm -rf "$T"
