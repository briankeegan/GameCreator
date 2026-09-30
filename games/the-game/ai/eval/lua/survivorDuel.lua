-- WASMSURVIVOR ON THE SERVER'S ENGINE, LOCALLY.
--
--   (in a panel-game checkout that has bot/SurvivalLink.lua, with its LUA_PATH;
--    survivor.js listening)
--   luajit GameCreator/games/the-game/ai/eval/lua/survivorDuel.lua SEED FRAMES [GARBAGE_EVERY] [PACE] [SOLO] [STREAM]
--
-- A VS match as the server sets one up (TWO_PLAYER_VS, level 10, shock on),
-- played on panel-game's own Lua engine: side 1 is WasmSurvivor through the
-- link (bot/SurvivalLink.lua -> survivor.js), side 2 the live Lua bot
-- (WeightedBrain), whose thinking is left out of the pace. GARBAGE_EVERY hands side 1 extra garbage now and then
-- (0: none). PACE 1 runs at 60 frames a second, as the server does, so the
-- survival bot has the time it would have there (0: as fast as it goes).
-- Prints one RESULT line.
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
local socket = require("socket")
local Match = require("common.engine.Match")
require("common.engine.checkMatches")
local GameModes = require("common.data.GameModes")
local LevelPresets = require("common.data.LevelPresets")
local GeneratorSource = require("common.engine.GeneratorSource")
local KeyDataEncoding = require("common.data.KeyDataEncoding")
local BoardState = require("bot.BoardState")
local WeightedBrain = require("bot.WeightedBrain")
local CursorController = require("bot.CursorController")
local SurvivalLink = require("bot.SurvivalLink")

local SEED = tonumber(arg[1]) or 1
local FRAMES = tonumber(arg[2]) or 21600
local GARBAGE_EVERY = tonumber(arg[3]) or 0
local PACE = (tonumber(arg[4]) or 1) ~= 0
-- SOLO 1: no garbage either way, so side 1 plays the rise alone.
local SOLO = (tonumber(arg[5]) or 0) ~= 0
-- STREAM: what the extra garbage is. "wild" (the default): chains up to 6
-- tall and full-width metal among the combos. "human": chains 1-3 tall and
-- combos, no metal -- what a strong player sends, through a telegraph.
local STREAM = arg[6] or "wild"

local state = SEED * 2654435761 % 4294967296
local function rand(n)
  state = (state * 1103515245 + 12345) % 2147483648
  return math.floor(state / 65536) % n
end

local mode = GameModes.getPreset(GameModes.IDs.TWO_PLAYER_VS)
local match = Match(GeneratorSource(SEED, true), mode.matchRules)
local a = match:createStackWithSettings(LevelPresets.getModern(10), true, "controller")
local b = match:createStackWithSettings(LevelPresets.getModern(10), true, "controller")
a:setMaxRunsPerFrame(1); b:setMaxRunsPerFrame(1)
if not SOLO then match:addTarget(a, b); match:addTarget(b, a) end
match:start()

local link = SurvivalLink.new({})
link:startMatch(a)
local brain = WeightedBrain.new({ profile = "bot/profiles/beverly.json" })
local controller = CursorController.new({ cursorMoveInterval = 4, reactionFrames = 12 })
local WAIT = { type = "WAIT" }

-- THE EXTRA GARBAGE'S TELEGRAPH. "human" garbage is sent as a player sends
-- it: shown staged in a telegraph from the frame it is earned, received 151
-- frames later (45 + 45 + 1 staged, then 60 in transit: GarbageQueue),
-- once the frame before has run. "wild" garbage lands unannounced.
local STAGING, LAND = 45 + 45 + 1, 60
local extra = { stopWatch = 0, outgoingGarbage = { stagedGarbage = {}, transitTimers = { first = 0, last = -1 }, garbageInTransit = {} } }

local t0 = socket.gettime()
local frame, handed = 0, 0
while frame < FRAMES and not a:game_ended() and not b:game_ended() do
  frame = frame + 1
  extra.stopWatch = a.stopWatch
  local sources = {}
  for i, src in ipairs(match.garbageSources[a]) do sources[i] = src end
  sources[#sources + 1] = extra
  local ca = link:input(a, sources)
  local cb
  if b.clock > 190 then
    -- The opponent thinks on its own machine: its time is not the frame's.
    local t1 = socket.gettime()
    local st = BoardState.extract(b)
    cb = controller:nextInput(st, controller:isBusy() and WAIT or brain:decide(st, b, match))
    t0 = t0 + (socket.gettime() - t1)
  else
    cb = KeyDataEncoding.base64encode[1]
  end
  a:receiveConfirmedInput(ca)
  b:receiveConfirmedInput(cb)
  if a.clock > 188 and GARBAGE_EVERY > 0 and rand(GARBAGE_EVERY) == 0 then
    local k = rand(4)
    local g
    if STREAM == "human" then
      if k <= 1 then g = { width = 6, height = 1 + rand(3), isChain = true, isMetal = false }
      else g = { width = 3 + rand(4), height = 1, isChain = false, isMetal = false } end
    elseif k == 0 then g = { width = 6, height = 1 + rand(6), isChain = true, isMetal = false }
    elseif k == 1 then g = { width = 6, height = 1, isChain = false, isMetal = true }
    else g = { width = 3 + rand(4), height = 1, isChain = false, isMetal = false } end
    g.frameEarned = a.stopWatch; g.rowEarned = 1; g.colEarned = 1; g.finalized = true
    if STREAM == "human" then table.insert(extra.outgoingGarbage.stagedGarbage, 1, g)   -- the next to ship last
    else a:receiveGarbage({ g }, 0) end
    handed = handed + 1
  end
  match:run()
  local q = extra.outgoingGarbage
  while #q.stagedGarbage > 0 and q.stagedGarbage[#q.stagedGarbage].frameEarned + STAGING <= a.stopWatch do
    local t = a.stopWatch + LAND
    if q.garbageInTransit[t] then table.insert(q.garbageInTransit[t], table.remove(q.stagedGarbage))
    else q.garbageInTransit[t] = { table.remove(q.stagedGarbage) }; q.transitTimers.last = q.transitTimers.last + 1; q.transitTimers[q.transitTimers.last] = t end
  end
  local tt = q.transitTimers
  while tt.first <= tt.last and tt[tt.first] <= a.stopWatch do
    a:receiveGarbage(q.garbageInTransit[tt[tt.first]], 0)
    q.garbageInTransit[tt[tt.first]] = nil; tt[tt.first] = nil; tt.first = tt.first + 1
  end
  if PACE then
    local due = t0 + frame / 60
    local now = socket.gettime()
    if due > now then socket.sleep(due - now) end
  end
end
link:endMatch()
local died = a:game_ended() and "WasmSurvivor" or (b:game_ended() and "opponent" or "nobody")
print(string.format('RESULT {"seed":%d,"frames":%d,"clock":%d,"died":"%s","late":%d,"handed":%d,"seconds":%.0f}',
  SEED, frame, a.clock, died, link.late, handed, socket.gettime() - t0))
