-- ONE GAME ON UPSTREAM'S OWN ENGINE, LOCALLY: Gambit (GambitNative.lua, libgambit.so) plays a stack of this checkout's
-- upstream Panel Attack at the live level against upstream's own training attacker -- the combo_storm, factory and large_garbage
-- of its training menu (TrainingMenu createBasicTrainingMode), or none (endless) -- paced to the game's frames as the live
-- client is. No server: the engine, the stack, the garbage and the link are the deploy's; only the opponent is the training one.
--
--   luajit bot/upstreamRound.lua SCENARIO SEED [FRAMES] [LEVEL]
--     SCENARIO  combo_storm | factory | large_garbage | endless
--     FRAMES    the game's length if the bot lives (default 21600: six minutes)
--     LEVEL     the modern level (default PA_LEVEL or 10, the live one)
--   GC_EVAL_DIR, GC_GAMBIT_WORDS as the live job sets them; PA_ROUND_BURST=N runs N frames back to back each 60th of a
--   second (lockstep's catch-up, as the live client runs it), 1 by default.
--
-- One line out, for a script to read: ROUND scenario seed survived|lost frames=N swaps=N cleared=N (late answers are in GC_GAMBIT_LOG)
io.stdout:setvbuf("no")
package.path = "./?.lua;" .. package.path
require("bot.headlessBoot")
local logger = require("common.lib.logger"); logger.setLogLevel(logger.levels.ERROR)
local Match = require("common.engine.Match")
local GeneratorSource = require("common.engine.GeneratorSource")
local GameModes = require("common.data.GameModes")
local LevelPresets = require("common.data.LevelPresets")
local socket = require("socket")

local SCENARIO = arg[1] or "factory"
local SEED = tonumber(arg[2]) or 1
local FRAMES = tonumber(arg[3]) or 21600
local LEVEL = tonumber(arg[4]) or tonumber(os.getenv("PA_LEVEL") or "") or 10
local BURST = math.max(1, tonumber(os.getenv("PA_ROUND_BURST") or "1") or 1)

-- (upstream's TrainingMenu createBasicTrainingMode, value for value)
local SIZES = { combo_storm = { 4, 1 }, factory = { 6, 2 }, large_garbage = { 6, 12 } }
local function trainingAttack(width, height)
  local patterns = {}
  for i = 1, 50 do patterns[#patterns + 1] = { width = width, height = height, startTime = i, metal = false, chain = false, endsChain = false } end
  return { delayBeforeStart = 150, delayBeforeRepeat = 900, attackPatterns = patterns }
end

local mode = GameModes.getPreset(SIZES[SCENARIO] and GameModes.IDs.ONE_PLAYER_TRAINING or GameModes.IDs.ONE_PLAYER_ENDLESS)
local match = Match(GeneratorSource(SEED, true), mode.matchRules)
local stack = match:createStackWithSettings(LevelPresets.getModern(LEVEL), true, "controller")
local attacker
if SIZES[SCENARIO] then
  attacker = match:createSimulatedStackWithSettings(trainingAttack(SIZES[SCENARIO][1], SIZES[SCENARIO][2]), nil)
  -- (the attacker's garbage sent to the bot's stack, as Match.createFromReplay restores a garbage flow)
  table.insert(match.garbageTargets[#match.stacks], stack)
  table.insert(match.garbageSources[stack], attacker)
end
match:start()

local link = dofile(assert(os.getenv("GC_EVAL_DIR"), "upstreamRound needs GC_EVAL_DIR") .. "/../gambit/lua/GambitNative.lua").new({})
link:startMatch(stack, attacker and { stacks = { stack, attacker } } or nil)

local frames, t0 = 0, socket.gettime()
while frames < FRAMES and not stack:game_ended() do
  if frames % BURST == 0 then local wait = t0 + (frames / BURST) / 60 - socket.gettime(); if wait > 0 then socket.sleep(wait) end end
  local char = link:input(stack, match.garbageSources and match.garbageSources[stack])
  stack:receiveConfirmedInput(char)
  match:run()
  frames = frames + 1
end
link:endMatch()

print(string.format("ROUND %s %d %s frames=%d swaps=%d cleared=%d", SCENARIO, SEED, stack:game_ended() and "lost" or "survived",
  frames, stack.swapCount or 0, stack.panels_cleared or 0))
