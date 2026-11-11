-- WHAT A PLAYER THROWS, BY THE STATE OF THE OTHER BOARD: one player's every attack in a match, re-simulated from its replay, with
-- the defender's board as it stood when the attack began -- and, once a second, the defender's board alone (the time spent in each
-- state, so attacks can be counted as a rate).
--
--   (in a panel-game checkout, with its LUA_PATH -- panel-game CLAUDE.md, "Bot tests, headless")
--   luajit GameCreator/games/the-game/ai/eval/lua/attackState.lua REPLAY.json NAME > attacks.jsonl
--
-- REPLAY.json is one match from the public archive (panelattack.com/replays/v049/...); NAME the attacker. Lines:
--   {"t":"combo","f":F,"n":SIZE,"d":DEF}          a combo of 4 or more, no chain link
--   {"t":"chain","f":F,"n":LINKS,"d":DEF}         a chain, at the frame its second link matched (the attack begun); n its length at the end
--   {"t":"tick","f":F,"d":DEF,"m":MINE}           every 30 frames; MINE the attacker's own board: {"pan":colour panels,"gar":garbage cells,
--                                                  "h":[column heights],"stop":frames,"q":pieces queued for it}
--   {"t":"end","f":F,"won":bool}
-- DEF: {"h":[six column heights, rows 1-12 counted, garbage included],"top":bool,"stop":frames,"shake":frames,"q":pieces queued,
--       "chain":its own chain counter}
require("bot.headlessBoot"); do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
_G.loc = _G.loc or function(s) return tostring(s) end
local Match = require("common.engine.Match"); require("common.engine.checkMatches")
local djson = require("common.lib.dkjson")
local R = djson.decode(assert(io.open((assert(arg[1], "REPLAY.json")))):read("*a"))
local NAME = assert(arg[2], "NAME")
local names = {}
for i, s in ipairs(R.metadata and R.metadata.stacks or {}) do names[i] = s.name end
local seat
for i, n in ipairs(names) do if n == NAME then seat = i end end
if not seat then io.stderr:write("no " .. NAME .. " in " .. arg[1] .. "\n"); os.exit(2) end
for i, inp in ipairs(R.stacks or {}) do if type(inp.inputs) == "table" then inp.inputs = table.concat(inp.inputs) end end
local m = Match.createFromReplay(R); m:start()
local A, D = m.stacks[seat], m.stacks[3 - seat]
local function def()
  local h = {}
  for c = 1, 6 do
    h[c] = 0
    for r = 1, math.min(12, #D.panels) do local p = D.panels[r][c]; if p.isGarbage or (p.color or 0) ~= 0 then h[c] = r end end
  end
  local top = false; for c = 1, 6 do if h[c] >= 12 then top = true end end
  local q = D.incomingGarbage and D.incomingGarbage.len and D.incomingGarbage:len() or 0
  return { h = h, top = top, stop = (D.stop_time or 0) + (D.pre_stop_time or 0), shake = D.shake_time or 0, q = q, chain = D.chain_counter or 0 }
end
-- (the attacker's own board, on the ticks: its colour panels and garbage cells in rows 1-12, its column heights, its stop)
local function mine()
  local pan, gar, h = 0, 0, {}
  for c = 1, 6 do
    h[c] = 0
    for r = 1, math.min(12, #A.panels) do
      local p = A.panels[r][c]
      if p.isGarbage then gar = gar + 1; h[c] = r elseif (p.color or 0) ~= 0 then pan = pan + 1; h[c] = r end
    end
  end
  return { pan = pan, gar = gar, h = h, stop = (A.stop_time or 0) + (A.pre_stop_time or 0), q = A.incomingGarbage and A.incomingGarbage.len and A.incomingGarbage:len() or 0 }
end
local out = {}
local function emit(t) out[#out + 1] = djson.encode(t) end
local pendingChain
A:connectSignal("matched", {}, function(_, _s, _g, isChain, comboSize)
  if not isChain and (comboSize or 0) >= 4 then emit({ t = "combo", f = A.clock, n = comboSize, d = def() }) end
end)
local lastTick, prevChain = -1, 0
local guard = 0
while not A:game_ended() and not D:game_ended() do
  m:run()
  guard = guard + 1; if guard > 200000 then break end
  local cc = A.chain_counter or 0
  if cc >= 2 and prevChain < 2 then pendingChain = { t = "chain", f = A.clock, n = cc, d = def() } end
  if pendingChain and cc > pendingChain.n then pendingChain.n = cc end
  if pendingChain and cc == 0 then emit(pendingChain); pendingChain = nil end
  prevChain = cc
  if math.floor(A.clock / 30) ~= lastTick then lastTick = math.floor(A.clock / 30); emit({ t = "tick", f = A.clock, d = def(), m = mine() }) end
end
if pendingChain then emit(pendingChain) end
local won = D:game_ended() and not A:game_ended()
if R.metadata and R.metadata.winnerId and R.metadata.stacks then won = R.metadata.stacks[seat].publicId == R.metadata.winnerId end
local nIn = R.stacks and R.stacks[seat] and #(R.stacks[seat].inputs or "") or -1
emit({ t = "end", f = A.clock, won = won, aEnd = A:game_ended() and true or false, dEnd = D:game_ended() and true or false, nIn = nIn })
print(table.concat(out, "\n"))
