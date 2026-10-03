-- THE SERVER'S STACK AS THE C ENGINE'S BOARD (native/pa.h): every field by
-- pa.c's own name, every panel's fields in pa.h's order, the garbage queued,
-- the stall log, the rows and garbage colours to come. deal.lua
-- writes it as text, train.lua straight into the engine's memory.
local PanelGenerator = require("common.engine.PanelGenerator")

local M = {}
M.NUL = -2147483648
local NUL = M.NUL
local function b01(v) return v and 1 or 0 end
local function nbool(v) if v == nil then return NUL end return v and 1 or 0 end
local function nint(v) if v == nil then return NUL end return v end

local DIRS = { up = 0, down = 1, left = 2, right = 3 }
-- The board's scalars, by pa.c's HEAD names (nil: the Lua's nil).
function M.head(a)
  local ld, fc, st, bh = a.levelData, a.levelData.frameConstants, a.levelData.stop, a.behaviours
  local h = {
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
  h.gameOver = h.gameOverClock > 0
  return h
end

local STATES = { normal = 0, dimmed = 1, swapping = 2, matched = 3, popping = 4, popped = 5, hovering = 6, falling = 7,
                 landing = 8, dead = 9 }
-- A panel's fields, in pa.h's order.
function M.panel(p, v)
  v = v or {}
  v[1], v[2], v[3], v[4], v[5], v[6], v[7] = p.row, p.column, p.id, p.color, nbool(p.chaining), nbool(p.matching), p.timer
  v[8], v[9], v[10], v[11], v[12] = nint(p.initial_time), nint(p.pop_time), nint(p.pop_index), nint(p.x_offset), nint(p.y_offset)
  v[13], v[14], v[15], v[16], v[17] = nint(p.width), nint(p.height), nint(p.shake_time), b01(p.isGarbage), STATES[p.state]
  v[18], v[19], v[20], v[21] = nint(p.combo_index), nint(p.combo_size), nbool(p.isSwappingFromLeft), nbool(p.dont_swap)
  v[22], v[23], v[24], v[25] = nbool(p.queuedHover), nint(p.fell_from_garbage), b01(p.stateChanged), b01(p.propagatesChaining)
  v[26], v[27], v[28], v[29] = b01(p.matchAnyway), nbool(p.propagatesFalling), nint(p.garbageId), nbool(p.metal)
  return v
end
M.NF = 29

-- The garbage queued, the next to drop last: width height chain metal earned finalized.
function M.incoming(a)
  local out = {}
  for i, g in ipairs(a.incomingGarbage.stagedGarbage) do
    out[i] = { g.width, g.height, b01(g.isChain), b01(g.isMetal), g.frameEarned, g.finalized == nil and NUL or b01(g.finalized) }
  end
  return out
end
function M.stall(a)
  local out = {}
  for i, s in ipairs(a.swapStallingBackLog or {}) do out[i] = { s.leftId, s.rightId, s.row, s.col, s.clock } end
  return out
end
function M.landed(a) return a.garbageLandedThisFrame or {} end
function M.drop(a) return a.currentGarbageDropColumnIndexes end

-- A row as the C engine is fed it: a colour, 100 + c / 200 + c for a letter
-- that turns to shock with one / two shock panels queued.
function M.row(s)
  local v = {}
  for c = 1, #s do
    local ch = s:sub(c, c)
    if tonumber(ch) then v[c] = tonumber(ch)
    elseif ch >= "A" and ch <= "Z" then v[c] = 100 + PanelGenerator.PANEL_COLOR_TO_NUMBER[ch]
    else v[c] = 200 + PanelGenerator.PANEL_COLOR_TO_NUMBER[ch] end
  end
  return v
end
-- The next n rows the stack will be dealt and the next n garbage rows' colours,
-- off a copy of its own source: neither depends on how the game is played.
function M.stream(a, n)
  local src, w, rows, brks = a.panelSource:clone(a), a.width, {}, {}
  for i = 1, n do
    if string.len(src.panelBuffer) <= 2 * w then src:growPanelBuffer(a) end
    rows[i] = M.row(src.panelBuffer:sub(1, w))
    src.panelBuffer = src.panelBuffer:sub(w + 1)
  end
  for i = 1, n do
    local s, v = src:getGarbagePanelRowString(a), {}
    for c = 1, w do v[c] = s:sub(c, c) + 0 end
    brks[i] = v
  end
  return rows, brks
end

return M
