-- boardSample.lua GAME.json: a live match re-simulated, each player's board every 30 frames as data (jsonl):
--   {"seat":S,"clock":F,"rows":[[...6],...],"garbage":0/1} -- rows bottom up, 0 empty, -1 garbage, else the colour
-- and per seat a last line {"seat":S,"end":true,"frames":F,"combos":{size:n}}
require("bot.headlessBoot"); do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
_G.loc = _G.loc or function(s) return tostring(s) end
local Match = require("common.engine.Match"); require("common.engine.checkMatches")
local djson = require("common.lib.dkjson")
local G = djson.decode(assert(io.open(arg[1])):read("*a"))
local m = Match.createFromReplay(G.replay); m:start()
local sizes = { {}, {} }
for s = 1, 2 do m.stacks[s]:connectSignal("matched", {}, function(_, _s, _g, isChain, n) if not isChain then sizes[s][tostring(n)] = (sizes[s][tostring(n)] or 0) + 1 end end) end
local function grid(st)
  local rows, g = {}, 0
  for r = 1, math.min(12, #st.panels) do
    local t = {}
    for c = 1, 6 do local p = st.panels[r][c]; t[c] = p.isGarbage and -1 or (p.color or 0); if p.isGarbage then g = 1 end end
    rows[r] = t
  end
  return rows, g
end
local last = -999
while not m.stacks[1]:game_ended() and not m.stacks[2]:game_ended() and m.stacks[G.seat].clock < G.n do
  m:run()
  local c = m.stacks[G.seat].clock
  if c - last >= 30 then
    last = c
    for s = 1, 2 do local rows, g = grid(m.stacks[s]); io.write(djson.encode({ seat = s, me = s == G.seat, clock = c, rows = rows, garbage = g }), "\n") end
  end
end
for s = 1, 2 do io.write(djson.encode({ seat = s, me = s == G.seat, ["end"] = true, frames = m.stacks[s].clock, combos = sizes[s] }), "\n") end
