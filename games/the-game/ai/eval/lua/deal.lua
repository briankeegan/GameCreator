-- WHAT THE SERVER DEALS, for a drill played on the C engine (native/drill.c).
--
--   (in a panel-game checkout, with its LUA_PATH)
--   luajit .../lua/deal.lua SEED LEVEL ROWS > deal.txt
--
-- One stack set up as drill.lua sets it up (VS rules at LEVEL, the seed's
-- GeneratorSource), written as the C engine's board (pa.h) the moment the
-- countdown ends, then the rows it will deal after that and the colours its
-- garbage will break into, ROWS of each. Neither stream depends on how the
-- game is played: each comes off its own generator. Lines:
--   H <name> <value>        a field of the board, by pa.c's HEAD name (nan: nil)
--   P <row> <col> <v * NF>  a panel, its fields in pa.h's order
--   I <w h chain metal earned finalized>   S <leftId rightId row col clock>
--   L <garbage id>          D <drop column index * 6>
--   R <c * 6>               a row: a colour, 100 + c / 200 + c for a letter
--   B <c * 6>               a garbage row's colours
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
local Match = require("common.engine.Match")
require("common.engine.checkMatches")
local GameModes = require("common.data.GameModes")
local LevelPresets = require("common.data.LevelPresets")
local GeneratorSource = require("common.engine.GeneratorSource")

local SEED, LEVEL, ROWS = tonumber(arg[1]), tonumber(arg[2]) or 10, tonumber(arg[3]) or 20000

local mode = GameModes.getPreset(GameModes.IDs.TWO_PLAYER_VS)
local match = Match(GeneratorSource(SEED, true), mode.matchRules)
local a = match:createStackWithSettings(LevelPresets.getModern(LEVEL), true, "controller")
a:setMaxRunsPerFrame(1)
match:start()
-- the C engine plays from the end of the countdown, when the keys start to count
local KeyDataEncoding = require("common.data.KeyDataEncoding")
while a.in_countdown or not a.stopWatchIsRunning do
  a:receiveConfirmedInput(KeyDataEncoding.base64encode[1])
  match:run()
end

local here = debug.getinfo(1, "S").source:sub(2):match("(.*/)") or "./"
local CB = dofile(here .. "cboard.lua")
local out = {}
local function put(s) out[#out + 1] = s end
local function num(v)
  if v == nil then return "nan" end
  if v == true then return "1" end
  if v == false then return "0" end
  return string.format("%.17g", v)
end
local head = CB.head(a)
local names = {}
for k in pairs(head) do names[#names + 1] = k end
table.sort(names)
for _, k in ipairs(names) do put("H " .. k .. " " .. num(head[k])) end
local v = {}
for r = 0, #a.panels do
  for c = 1, a.width do
    CB.panel(a.panels[r][c], v)
    local s = {}
    for i = 1, CB.NF do s[i] = num(v[i]) end
    put("P " .. r .. " " .. c .. " " .. table.concat(s, " "))
  end
end
for _, g in ipairs(CB.incoming(a)) do put("I " .. table.concat(g, " ")) end
for _, s in ipairs(CB.stall(a)) do put("S " .. table.concat(s, " ")) end
for _, id in ipairs(CB.landed(a)) do put("L " .. id) end
put("D " .. table.concat(CB.drop(a), " "))

-- the streams
local rows, brks = CB.stream(a, ROWS)
for _, v in ipairs(rows) do put("R " .. table.concat(v, " ")) end
for _, v in ipairs(brks) do put("B " .. table.concat(v, " ")) end
io.write(table.concat(out, "\n"), "\n")
