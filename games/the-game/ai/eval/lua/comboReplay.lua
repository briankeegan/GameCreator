-- A LIVE GAME'S COMBOS, AS DATA: one player's every combo, re-simulated from a live match's replay.
--
--   (in a panel-game checkout at the engine the match was played on, with its LUA_PATH -- panel-game CLAUDE.md, "Bot tests, headless")
--   luajit GameCreator/games/the-game/ai/eval/lua/comboReplay.lua GAME.json MIN > combos.jsonl
--
-- GAME.json is one match as combo_replays.py writes it ({replay, seat, n}). Each match of MIN panels or more is one line:
--   {"t":"combo","frame":F,"size":N,"chain":bool,"cells":[[r,c,colour],...],"swaps":[[frame,r,c],...],"board":[[...],...]}
-- cells: the panels the match takes; swaps: the player's swaps of the 240 frames before it (r, c the left of the pair); board: the
-- rows bottom up as they stood before the first of those swaps (0 empty, -1 garbage). The last line is
--   {"t":"end","frames":F,"sizes":{"3":n,...},"alive":bool}
require("bot.headlessBoot"); do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
_G.loc = _G.loc or function(s) return tostring(s) end
local Match = require("common.engine.Match"); require("common.engine.checkMatches")
local djson = require("common.lib.dkjson")
local G = djson.decode(assert(io.open((assert(arg[1], "GAME.json")))):read("*a")); local MIN = tonumber(arg[2] or "8")
local m = Match.createFromReplay(G.replay); m:start()
local st = m.stacks[G.seat]
local events, swaps, sizes, boards = {}, {}, {}, {}
st:connectSignal("matched", {}, function(_, _s, _g, isChain, comboSize) events[#events + 1] = { chain = isChain and true or false, n = comboSize } end)
local function grid()
  local rows = {}
  for r = 1, math.min(12, #st.panels) do
    local t = {}
    for c = 1, 6 do local p = st.panels[r][c]; t[c] = p.isGarbage and -1 or (p.color or 0) end
    rows[r] = t
  end
  return rows
end
-- (m:run steps the match several frames a call: a swap is the pair entering the swapping state, once in 8 frames)
while not st:game_ended() and not m.stacks[3 - G.seat]:game_ended() and st.clock < G.n do
  local before = grid()
  m:run()
  boards[st.clock] = before; boards[st.clock - 400] = nil
  for r = 1, math.min(12, #st.panels) do for c = 1, 5 do
    local a, b, last = st.panels[r][c], st.panels[r][c + 1], swaps[#swaps]
    if a.state == "swapping" and b.state == "swapping" and not (last and last[1] >= st.clock - 8 and last[2] == r and last[3] == c) then
      swaps[#swaps + 1] = { st.clock, r, c }
    end
  end end
  for _, e in ipairs(events) do
    sizes[tostring(e.n)] = (sizes[tostring(e.n)] or 0) + 1
    if e.n >= MIN then
      -- (this match's panels: of its size, the latest matched -- the highest timer -- so a match still flashing beside it is not counted)
      local cells, hi = {}, -1
      for r = 1, math.min(12, #st.panels) do for c = 1, 6 do local p = st.panels[r][c]
        if p.state == "matched" and not p.isGarbage and p.combo_size == e.n and (p.timer or 0) > hi then hi = p.timer or 0 end end end
      for r = 1, math.min(12, #st.panels) do for c = 1, 6 do local p = st.panels[r][c]
        if p.state == "matched" and not p.isGarbage and p.combo_size == e.n and (p.timer or 0) == hi then cells[#cells + 1] = { r, c, p.color } end end end
      local recent, first = {}, nil
      for _, s in ipairs(swaps) do if s[1] > st.clock - 240 then recent[#recent + 1] = s; first = first or s[1] end end
      local bd = first and (boards[first] or boards[first - 1] or boards[first - 2] or boards[first - 3]) or grid()
      io.write(djson.encode({ t = "combo", frame = st.clock, size = e.n, chain = e.chain, cells = cells, swaps = recent, board = bd }), "\n")
    end
  end
  events = {}
  while swaps[1] and swaps[1][1] < st.clock - 300 do table.remove(swaps, 1) end
end
io.write(djson.encode({ t = "end", frames = st.clock, sizes = sizes, alive = not st:game_ended() }), "\n")
