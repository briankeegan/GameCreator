#!/bin/sh
# THE BOT IN THE GAME'S OWN TRAINING: the server's Lua (a panel-game checkout,
# GC_PANEL_GAME) plays the training match as the game builds it, and the bot
# (native/libbit.so) plays the player's stack. See lua/train.lua. Level 10 only.
#
#   ./train.sh MODE SEED [FRAMES]     MODE: combo_storm, factory, large_garbage
#
# GC_TRACE=F prints every frame from F on.
set -e
here=$(cd "$(dirname "$0")" && pwd)
game=${GC_PANEL_GAME:-$here/../../../../../briankeegan/panel-game}
[ -f "$here/native/libbit.so" ] || "$here/native/build.sh" > /dev/null
eval "$(luarocks path --lua-version 5.1)"
cd "$game"
LUA_PATH="./?.lua;./common/lib/?.lua;$LUA_PATH" LUA_CPATH="./common/lib/?.so;$LUA_CPATH" \
  exec luajit "$here/lua/train.lua" "$@"
