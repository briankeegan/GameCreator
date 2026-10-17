-- THE HOOKUP CHECKED: the server's Lua plays a training match as the game builds it (the player's stack at level 10, a simulated
-- opponent sending the pattern) and Gambit plays the stack in this process (GambitNative.lua), for FRAMES frames. It checks the
-- plumbing -- keys pressed, swaps made, every board the frame loop predicted the one the game made -- not how well Gambit plays.
--
--   (in a panel-game checkout with its LUA_PATH; GC_GAMBIT_WORDS from words.js)
--   luajit <GameCreator>/games/the-game/ai/gambit/lua/check.lua MODE [FRAMES] [SEED]
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
local Match = require("common.engine.Match")
require("common.engine.checkMatches")
local GameModes = require("common.data.GameModes")
local LevelPresets = require("common.data.LevelPresets")
local GeneratorSource = require("common.engine.GeneratorSource")
local here = debug.getinfo(1, "S").source:match("^@(.*)/[^/]*$")
local G = dofile(here .. "/GambitNative.lua")

local MODE, FRAMES, SEED = arg[1] or "factory", tonumber(arg[2]) or 600, tonumber(arg[3]) or 1
local SIZES = { combo_storm = { 4, 1 }, factory = { 6, 2 }, large_garbage = { 6, 12 } }
local size = assert(SIZES[MODE], "check: no mode " .. tostring(MODE))
local patterns = {}
for i = 1, 50 do patterns[#patterns + 1] = { width = size[1], height = size[2], startTime = i, metal = false, chain = false, endsChain = false } end
local mode = GameModes.getPreset(GameModes.IDs.ONE_PLAYER_TRAINING)
local match = Match(GeneratorSource(SEED, true), mode.matchRules)
local a = match:createStackWithSettings(LevelPresets.getModern(10), true, "controller")
a:setMaxRunsPerFrame(1)
local foe = match:createSimulatedStackWithSettings({ delayBeforeStart = 150, delayBeforeRepeat = 900, attackPatterns = patterns })
foe:setMaxRunsPerFrame(1)
match:addTarget(foe, a)
match:start()

local bot = G.new({})
bot:startMatch(a, match)
local KeyDataEncoding = require("common.data.KeyDataEncoding")
-- (at the game's own pace, sixty frames a second: Gambit thinks while the game runs on, as it does in the client)
local socket = require("socket")
local pressed, frame, t0 = 0, 0, socket.gettime()
while frame < FRAMES and not a:game_ended() do
  frame = frame + 1
  local due = t0 + frame / 60
  while socket.gettime() < due do socket.sleep(0.001) end
  local ch = bot:input(a, match.garbageSources[a])
  if ch ~= KeyDataEncoding.base64encode[1] then pressed = pressed + 1 end
  a:receiveConfirmedInput(ch)
  match:run()
end
bot:endMatch()
local over, worst, dropped = bot:budget()
print(string.format("check %s: %d frames, %d with keys, swaps %d, cleared %d, died %s, thinkOver %d, thinkWorstMs %.1f, dropped %d",
  MODE, frame, pressed, a.swapCount or 0, a.panels_cleared or 0, tostring(a:game_ended()), over, worst * 1000, dropped))
