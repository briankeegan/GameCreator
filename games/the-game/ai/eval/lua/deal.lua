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
local PanelGenerator = require("common.engine.PanelGenerator")

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

local NUL = -2147483648
local out = {}
local function put(s) out[#out + 1] = s end
local function b01(v) return v and 1 or 0 end
local function nbool(v) if v == nil then return NUL end return v and 1 or 0 end
local function nint(v) if v == nil then return NUL end return v end
local function num(v)
  if v == nil then return "nan" end
  if v == true then return "1" end
  if v == false then return "0" end
  return string.format("%.17g", v)
end

-- the board's scalars, by pa.c's names
local ld, fc, st, bh = a.levelData, a.levelData.frameConstants, a.levelData.stop, a.behaviours
local DIRS = { up = 0, down = 1, left = 2, right = 3 }
local head = {
  riseTimer = a.rise_timer,
  ["levelData.startingSpeed"] = ld.startingSpeed, ["levelData.colors"] = ld.colors, ["levelData.maxHealth"] = ld.maxHealth,
  ["levelData.shockFrequency"] = ld.shockFrequency, ["levelData.shockCap"] = ld.shockCap,
  ["levelData.speedIncreaseMode"] = ld.speedIncreaseMode,
  ["frames.HOVER"] = fc.HOVER, ["frames.GARBAGE_HOVER"] = fc.GARBAGE_HOVER, ["frames.FLASH"] = fc.FLASH,
  ["frames.FACE"] = fc.FACE, ["frames.POP"] = fc.POP,
  ["levelData.stop.formula"] = st.formula, ["levelData.stop.comboConstant"] = st.comboConstant,
  ["levelData.stop.chainConstant"] = st.chainConstant, ["levelData.stop.dangerConstant"] = st.dangerConstant,
  ["levelData.stop.coefficient"] = st.coefficient, ["levelData.stop.dangerCoefficient"] = st.dangerCoefficient,
  ["behaviours.passiveRaise"] = bh.passiveRaise, ["behaviours.allowManualRaise"] = bh.allowManualRaise,
  ["behaviours.swapStallingMode"] = bh.swapStallingMode, ["behaviours.swapStallingPunish"] = bh.swapStallingPunish,
  height = a.height, panelIdCount = a.panelsCreatedCount, speed = a.speed, nextSpeedIncreaseClock = a.nextSpeedIncreaseClock,
  clock = a.clock, stopWatch = a.stopWatch, stopWatchIsRunning = a.stopWatchIsRunning, inCountdown = a.in_countdown or false,
  displacement = a.displacement, riseLock = a.rise_lock, hasRisen = a.has_risen, manualRaise = a.manual_raise,
  manualRaiseYet = a.manual_raise_yet, preventManualRaise = a.prevent_manual_raise, swapThisFrame = a.swapThisFrame,
  stopTime = a.stop_time, preStopTime = a.pre_stop_time, shakeTime = a.shake_time, prevShakeTime = a.prev_shake_time,
  shakeTimeOnFrame = a.shake_time_on_frame, peakShakeTime = a.peak_shake_time, health = a.health,
  wasToppedOut = a.wasToppedOut, chainCounter = a.chain_counter, nActive = a.n_active_panels,
  nPrevActive = a.n_prev_active_panels, swappingCount = a.swappingPanelCount, panelsCleared = a.panels_cleared,
  metalPanelsQueued = a.metalPanelsQueued, score = a.score, curRow = a.cur_row, curCol = a.cur_col,
  topCurRow = a.top_cur_row, queuedSwapRow = a.queuedSwapRow, queuedSwapCol = a.queuedSwapColumn,
  swapCount = a.swapCount, curTimer = a.cur_timer, curWaitTime = a.cur_wait_time or 20,
  cursorDirection = a.cursorDirection == nil and -1 or DIRS[a.cursorDirection], cursorLock = a.cursorLock,
  garbageCreatedCount = a.garbageCreatedCount, highestGarbageIdMatched = a.highestGarbageIdMatched,
  gameOverClock = a.game_over_clock or -1,
}
head.gameOver = head.gameOverClock > 0
local names = {}
for k in pairs(head) do names[#names + 1] = k end
table.sort(names)
for _, k in ipairs(names) do put("H " .. k .. " " .. num(head[k])) end

-- every panel, its fields in pa.h's order
local STATES = { normal = 0, dimmed = 1, swapping = 2, matched = 3, popping = 4, popped = 5, hovering = 6, falling = 7,
                 landing = 8, dead = 9 }
for r = 0, #a.panels do
  for c = 1, a.width do
    local p = a.panels[r][c]
    local v = { p.row, p.column, p.id, p.color, nbool(p.chaining), nbool(p.matching), p.timer,
                nint(p.initial_time), nint(p.pop_time), nint(p.pop_index), nint(p.x_offset), nint(p.y_offset),
                nint(p.width), nint(p.height), nint(p.shake_time), b01(p.isGarbage), STATES[p.state],
                nint(p.combo_index), nint(p.combo_size), nbool(p.isSwappingFromLeft), nbool(p.dont_swap),
                nbool(p.queuedHover), nint(p.fell_from_garbage), b01(p.stateChanged), b01(p.propagatesChaining),
                b01(p.matchAnyway), nbool(p.propagatesFalling), nint(p.garbageId), nbool(p.metal) }
    for i = 1, 29 do v[i] = num(v[i]) end
    put("P " .. r .. " " .. c .. " " .. table.concat(v, " "))
  end
end
for _, g in ipairs(a.incomingGarbage.stagedGarbage) do
  put(string.format("I %d %d %d %d %d %d", g.width, g.height, b01(g.isChain), b01(g.isMetal), g.frameEarned,
                    g.finalized == nil and NUL or b01(g.finalized)))
end
for _, s in ipairs(a.swapStallingBackLog or {}) do put(string.format("S %d %d %d %d %d", s.leftId, s.rightId, s.row, s.col, s.clock)) end
for _, id in ipairs(a.garbageLandedThisFrame or {}) do put("L " .. id) end
put("D " .. table.concat(a.currentGarbageDropColumnIndexes, " "))

-- the streams, off a copy of the stack's own source
local src = a.panelSource:clone(a)
for _ = 1, ROWS do
  if string.len(src.panelBuffer) <= 2 * a.width then src:growPanelBuffer(a) end
  local row = src.panelBuffer:sub(1, a.width)
  src.panelBuffer = src.panelBuffer:sub(a.width + 1)
  local v = {}
  for c = 1, a.width do
    local ch = row:sub(c, c)
    if tonumber(ch) then v[c] = tonumber(ch)
    elseif ch >= "A" and ch <= "Z" then v[c] = 100 + PanelGenerator.PANEL_COLOR_TO_NUMBER[ch]
    else v[c] = 200 + PanelGenerator.PANEL_COLOR_TO_NUMBER[ch] end
  end
  put("R " .. table.concat(v, " "))
end
for _ = 1, ROWS do
  local row = src:getGarbagePanelRowString(a)
  local v = {}
  for c = 1, a.width do v[c] = row:sub(c, c) + 0 end
  put("B " .. table.concat(v, " "))
end
io.write(table.concat(out, "\n"), "\n")
