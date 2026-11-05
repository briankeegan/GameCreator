-- comboSample.lua GAME.json: each combo of 8 or more (not a chain link) a player made, with the board as it matched
-- (matched cells marked by +10) and the boards 20, 60 and 120 frames before, as jsonl:
--   {"seat":S,"me":bool,"clock":F,"size":n,"now":rows,"before":{"20":rows,"60":rows,"120":rows}}
require("bot.headlessBoot"); do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
_G.loc = _G.loc or function(s) return tostring(s) end
local Match = require("common.engine.Match"); require("common.engine.checkMatches")
local djson = require("common.lib.dkjson")
local G = djson.decode(assert(io.open(arg[1])):read("*a"))
local m = Match.createFromReplay(G.replay); m:start()
local function grid(st, mark)
  local rows = {}
  for r = 1, math.min(12, #st.panels) do
    local t = {}
    for c = 1, 6 do local p = st.panels[r][c]
      local v = p.isGarbage and -1 or (p.color or 0)
      if mark and p.matching and v > 0 then v = v + 10 end
      t[c] = v end
    rows[r] = t
  end
  return rows
end
local hist, swaps = { {}, {} }, { {}, {} }
for s = 1, 2 do
  local st = m.stacks[s]; local run, swap = st.run, st.swap
  st.run = function(self, ...) local r = run(self, ...); hist[s][self.clock] = grid(self); hist[s][self.clock - 200] = nil; return r end
  st.swap = function(self, row, col, ...) table.insert(swaps[s], { self.clock, row, col }); return swap(self, row, col, ...) end
end
for s = 1, 2 do m.stacks[s]:connectSignal("matched", {}, function(_, st, _g, isChain, n)
  if isChain or n < 8 then return end
  local c = st.clock; local b = {}
  for _, k in ipairs({ 1, 20, 60, 120 }) do b["t" .. k] = hist[s][c - k] end
  local sw = {}; for _, x in ipairs(swaps[s]) do if x[1] > c - 150 then sw[#sw + 1] = x end end
  io.write(djson.encode({ seat = s, me = s == G.seat, clock = c, size = n, now = grid(st, true), before = b, swaps = sw }), "\n")
end) end
while not m.stacks[1]:game_ended() and not m.stacks[2]:game_ended() and m.stacks[G.seat].clock < G.n do
  m:run()
end
