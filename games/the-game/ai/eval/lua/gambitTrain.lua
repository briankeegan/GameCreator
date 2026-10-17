-- GAMBIT IN THE GAME'S OWN TRAINING, REPEATABLE. The server's Lua plays a training match as the game builds it (train.lua: the
-- player's stack at level 10, a simulated opponent sending the pattern, the match's own garbage delivery) and Gambit plays the
-- player's stack through the survivor link (bot/SurvivalLink.lua -> survivor.js, started with GC_SURVIVOR_SYNC=1 so every decision is
-- waited for). The same build and seed play the same game: the way to compare two builds.
--
--   (in a panel-game checkout with its LUA_PATH; survivor.js listening, GC_SURVIVOR_SYNC=1)
--   luajit GameCreator/games/the-game/ai/eval/lua/gambitTrain.lua MODE SEED [FRAMES]
--
-- MODE: combo_storm, factory or large_garbage. Prints one RESULT line: the frame the match ended, whether the stack died, and the
-- think and input budgets as the game's own classes charge them.
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
local socket = require("socket")
local Match = require("common.engine.Match")
require("common.engine.checkMatches")
local GameModes = require("common.data.GameModes")
local LevelPresets = require("common.data.LevelPresets")
local GeneratorSource = require("common.engine.GeneratorSource")
local SurvivalLink = require("bot.SurvivalLink")

local MODE, SEED, FRAMES = arg[1], tonumber(arg[2]) or 1, tonumber(arg[3]) or 21600
-- TrainingMenu.lua createBasicTrainingMode, as train.lua builds it
local SIZES = { combo_storm = { 4, 1 }, factory = { 6, 2 }, large_garbage = { 6, 12 } }
local size = SIZES[MODE]
if not size then io.stderr:write("gambitTrain: no mode " .. tostring(MODE) .. "\n"); os.exit(2) end
local function basicTrainingMode(width, height)
  local patterns = {}
  for i = 1, 50 do patterns[#patterns + 1] = { width = width, height = height, startTime = i, metal = false, chain = false, endsChain = false } end
  return { delayBeforeStart = 150, delayBeforeRepeat = 900, attackPatterns = patterns }
end
local mode = GameModes.getPreset(GameModes.IDs.ONE_PLAYER_TRAINING)
local match = Match(GeneratorSource(SEED, true), mode.matchRules)
local a = match:createStackWithSettings(LevelPresets.getModern(10), true, "controller")
a:setMaxRunsPerFrame(1)
local foe = match:createSimulatedStackWithSettings(basicTrainingMode(size[1], size[2]))
foe:setMaxRunsPerFrame(1)
match:addTarget(foe, a)
match:start()

-- (every answer waited for, however long it takes: the game does not run on while Gambit thinks, so a seed plays the same game every
-- time. The time each decision took is Gambit's own to report -- survivor.js logs it -- not the frame's)
SurvivalLink.TARGET_SHARE = 1e9
local link = SurvivalLink.new({ waitSec = 1e9 })
link:startMatch(a)
local t0, frame, endReason = socket.gettime(), 0, "frames"
while frame < FRAMES and not a:game_ended() do
  frame = frame + 1
  local ca = link:input(a, match.garbageSources[a])
  if link.stopReason then print(link.stopReason); endReason = "stopped"; break end
  a:receiveConfirmedInput(ca)
  match:run()
end
if a:game_ended() then endReason = "died" end
link:endMatch()
local over, worst, dropped = link:budget()
print(string.format('RESULT {"mode":"%s","seed":%d,"frames":%d,"clock":%d,"died":%s,"late":%d,"seconds":%.0f,"thinkOver":%d,"thinkWorstMs":%.1f,"inputDropped":%d,"end":"%s"}',
  MODE, SEED, frame, a.clock, tostring(endReason == "died"), link.late, socket.gettime() - t0, over, worst * 1000, dropped, endReason))
