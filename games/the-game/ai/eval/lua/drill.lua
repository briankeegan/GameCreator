-- A DRILL ON THE SERVER'S OWN ENGINE.
--
--   (in a panel-game checkout, with its LUA_PATH)
--   luajit .../lua/drill.lua SEED LEVEL WIDTH HEIGHT LEAD CYCLE LEN
--
-- One stack, VS rules at LEVEL, no opponent: garbage arrives only on the
-- drill's schedule -- every frame of the first LEN of each CYCLE frames past
-- LEAD on the stopwatch, one WIDTH x HEIGHT slab. Each frame the whole stack
-- is written as one line (engineRecord.lua's dump), and one line is read back:
-- the input to play, as KeyDataEncoding bits (right 1, left 2, down 4, up 8,
-- swap 16, raise 32). Ends when the stack does, with a line {"over":clock}.
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
local Match = require("common.engine.Match")
require("common.engine.checkMatches")
local GameModes = require("common.data.GameModes")
local LevelPresets = require("common.data.LevelPresets")
local GeneratorSource = require("common.engine.GeneratorSource")
local KeyDataEncoding = require("common.data.KeyDataEncoding")
local here = debug.getinfo(1, "S").source:sub(2):match("(.*/)") or "./"
local Record = dofile(here .. "record_dump.lua")

local SEED, LEVEL = tonumber(arg[1]), tonumber(arg[2]) or 10
local WIDTH, HEIGHT = tonumber(arg[3]) or 4, tonumber(arg[4]) or 1
local LEAD, CYCLE, LEN = tonumber(arg[5]) or 150, tonumber(arg[6]) or 900, tonumber(arg[7]) or 50

local mode = GameModes.getPreset(GameModes.IDs.TWO_PLAYER_VS)
local match = Match(GeneratorSource(SEED, true), mode.matchRules)
local a = match:createStackWithSettings(LevelPresets.getModern(LEVEL), true, "controller")
a:setMaxRunsPerFrame(1)
match:start()

local function fires(f)
  if f < LEAD + 1 then return false end
  return ((f - LEAD - 1) % CYCLE) < LEN
end

io.write('{"levelData":', Record.enc(a.levelData), ',"behaviours":', Record.enc(a.behaviours),
         ',"stackOverConditions":', Record.enc(a.stackOverConditions), '}\n')
io.flush()
local input = 0
while not a:game_ended() do
  if a.stopWatchIsRunning and fires(a.stopWatch) then
    a:receiveGarbage({ { width = WIDTH, height = HEIGHT, isChain = false, isMetal = false, frameEarned = a.stopWatch,
                         rowEarned = 1, colEarned = 1, finalized = true } }, 0)
  end
  io.write('{"state":', Record.dump(a, input), '}\n')
  io.flush()
  local line = io.read("*l")
  if not line then break end
  input = tonumber(line) or 0
  a:receiveConfirmedInput(KeyDataEncoding.base64encode[input + 1])
  match:run()
end
io.write('{"over":', a.clock, '}\n')
