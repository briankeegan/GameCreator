#!/bin/sh
# THE BOT'S DRILL ON THE SERVER'S ENGINE, in C: the Lua (a panel-game
# checkout, GC_PANEL_GAME) deals the seed -- the board as the countdown ends,
# the rows and garbage colours to come (lua/deal.lua) -- and native/drill
# plays it on pa.c. Level 10 only.
#
#   ./drill.sh SEED [FRAMES [WIDTH HEIGHT LEAD CYCLE LEN]]   (comboStorm by default)
#
# GC_TRACE=F prints each frame from F on; GC_TAPE_OUT=file records the keys.
set -e
here=$(cd "$(dirname "$0")" && pwd)
seed=${1:?seed}; shift
frames=${1:-120000}; [ $# -gt 0 ] && shift
game=${GC_PANEL_GAME:-$here/../../../../../briankeegan/panel-game}
[ -x "$here/native/drill" ] || "$here/native/build.sh" > /dev/null
deal="$here/drill-deals/$seed.txt"
if [ ! -s "$deal" ]; then
  mkdir -p "$here/drill-deals"
  eval "$(luarocks path --lua-version 5.1)"
  (cd "$game" && LUA_PATH="./?.lua;./common/lib/?.lua;$LUA_PATH" LUA_CPATH="./common/lib/?.so;$LUA_CPATH" \
     luajit "$here/lua/deal.lua" "$seed" 10 20000) > "$deal.tmp"
  mv "$deal.tmp" "$deal"
fi
exec "$here/native/drill" "$deal" "$frames" "$@"
