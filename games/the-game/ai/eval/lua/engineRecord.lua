-- THE SERVER'S ENGINE, FRAME BY FRAME, AS DATA.
--
--   (in a panel-game checkout, with its LUA_PATH -- see pa_engine.test.js)
--   luajit GameCreator/games/the-game/ai/eval/lua/engineRecord.lua SEED FRAMES [LEVEL] [GARBAGE_EVERY] [STATE_EVERY] > record.jsonl
--
-- A two-player VS match as the server sets one up (TWO_PLAYER_VS rules,
-- level 10, shock on, the default stack behaviours), both stacks local and
-- targeting each other. Side 1 is played by the live Lua bot with random
-- presses mixed in, side 2 presses at random (never raising). Extra garbage of every kind (combos, chains, shock) is
-- handed to side 1 now and then, the way BotClient hands over what the
-- network delivers. After every frame side 1 is written out whole: every
-- scalar field of the stack, every field of every panel, both garbage queues,
-- the swap-stall log, and the input that frame ran with.
--
-- pa-engine.js must reproduce this exactly: pa_engine.test.js replays a
-- record and compares every frame.
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
local Match = require("common.engine.Match")
require("common.engine.checkMatches")
local GameModes = require("common.data.GameModes")
local LevelPresets = require("common.data.LevelPresets")
local GeneratorSource = require("common.engine.GeneratorSource")
local KeyDataEncoding = require("common.data.KeyDataEncoding")

local SEED = tonumber(arg[1]) or 1
local a
local FRAMES = tonumber(arg[2]) or 3000
local LEVEL = tonumber(arg[3]) or 10
-- one extra piece of garbage for side 1 every this many frames on average (0: none)
local GARBAGE_EVERY = tonumber(arg[4]) or 150
-- side 1 written out whole every this many frames (1: every frame); on the
-- frames between, only what a replay needs to play them
local STATE_EVERY = tonumber(arg[5]) or 1

-- The input stream's own randomness, separate from the engine's.
local state = SEED * 2654435761 % 4294967296
local function rand(n)
  state = (state * 1103515245 + 12345) % 2147483648
  return math.floor(state / 65536) % n
end

-- ---------------------------------------------------------------- output
local function num(v) return string.format("%.17g", v) end
local function enc(v, depth)
  local t = type(v)
  if v == nil then return "null" end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if v ~= v then return '"NaN"' end
    if v == math.huge then return '"Infinity"' end
    if v == -math.huge then return '"-Infinity"' end
    return num(v)
  end
  if t == "string" then return string.format("%q", v):gsub("\\\n", "\\n") end
  if t == "table" then
    depth = depth or 0
    if depth > 6 then return '"<deep>"' end
    -- arrays (1..n with no holes) as arrays, else objects with string keys
    local n = #v
    local isArray = n > 0 or next(v) == nil
    if isArray then for k in pairs(v) do if type(k) ~= "number" or k < 1 or k > n or k % 1 ~= 0 then isArray = false; break end end end
    local parts = {}
    if isArray and n > 0 then
      for i = 1, n do parts[#parts + 1] = enc(v[i], depth + 1) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for k, x in pairs(v) do
      local tk, tx = type(k), type(x)
      if (tk == "string" or tk == "number") and tx ~= "function" and tx ~= "userdata" and tx ~= "thread" then keys[#keys + 1] = k end
    end
    table.sort(keys, function(p, q) return tostring(p) < tostring(q) end)
    for _, k in ipairs(keys) do parts[#parts + 1] = string.format("%q", tostring(k)) .. ":" .. enc(v[k], depth + 1) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
-- Every plain field of a table: numbers, booleans, strings.
local function scalars(t)
  local o = {}
  for k, v in pairs(t) do
    local tv = type(v)
    if type(k) == "string" and (tv == "number" or tv == "boolean" or tv == "string") then o[k] = v end
  end
  return o
end
local function garbageList(q)
  local o = {}
  for i = 1, #q do
    local g = q[i]
    o[i] = { width = g.width, height = g.height, isMetal = g.isMetal or false, isChain = g.isChain or false,
             frameEarned = g.frameEarned, finalized = g.finalized, finalizedClock = g.finalizedClock,
             rowEarned = g.rowEarned, colEarned = g.colEarned, linkTimes = g.linkTimes }
  end
  return o
end
local function queue(gq)
  local transit = {}
  for k, list in pairs(gq.garbageInTransit or {}) do
    transit[#transit + 1] = { at = k, garbage = garbageList(list) }
  end
  table.sort(transit, function(p, q) return p.at < q.at end)
  local cur = gq.currentChain
  local curAt = nil
  if cur then for i = 1, #gq.stagedGarbage do if gq.stagedGarbage[i] == cur then curAt = i end end end
  -- the delivery frames still due (the Lua keeps every transit entry; its timers say which are pending)
  local pending = {}
  local tt = gq.transitTimers
  if tt and tt.first then for i = tt.first, tt.last do pending[#pending + 1] = tt[i] end end
  return { staged = garbageList(gq.stagedGarbage), transit = transit, currentChainAt = curAt, pending = pending }
end
local function dump(s, input)
  local panels = {}
  for r = 0, #s.panels do
    local row = {}
    for c = 1, s.width do
      local p = s.panels[r] and s.panels[r][c]
      row[c] = p and scalars(p) or false
    end
    panels[r + 1] = row
  end
  local backlog = {}
  for i, rec in ipairs(s.swapStallingBackLog or {}) do backlog[i] = scalars(rec) end
  local landed = {}
  for i, id in ipairs(s.garbageLandedThisFrame or {}) do landed[i] = id end
  return enc({
    input = input, stack = scalars(s), panels = panels,
    incoming = queue(s.incomingGarbage), outgoing = queue(s.outgoingGarbage),
    swapStallingBackLog = backlog, garbageLandedThisFrame = landed,
    dropColumns = s.currentGarbageDropColumnIndexes,
    panelBuffer = s.panelSource and s.panelSource.panelBuffer, garbagePanelBuffer = s.panelSource and s.panelSource.garbagePanelBuffer,
  })
end

-- ---------------------------------------------------------------- play
-- Side 1 is played by the live bot (WeightedBrain and its cursor), with a
-- random press now and then; side 2 presses at random. Matches follow each
-- other until FRAMES frames have been written; each line carries its match.
local BoardState = require("bot.BoardState")
local WeightedBrain = require("bot.WeightedBrain")
local CursorController = require("bot.CursorController")
local BITS = { right = 1, left = 2, down = 4, up = 8, swap = 16, raise = 32 }
local function randomInput(ctl, noRaise)
  if ctl.held <= 0 then
    local dirs = { false, false, "up", "down", "left", "right" }
    ctl.dir = dirs[1 + rand(6)]
    ctl.held = rand(3) > 0 and rand(4) or 12 + rand(10)
  end
  ctl.held = ctl.held - 1
  if ctl.raise > 0 then ctl.raise = ctl.raise - 1 elseif not noRaise and rand(90) == 0 then ctl.raise = 1 + rand(30) end
  local v = 0
  if ctl.dir then v = v + BITS[ctl.dir] end
  if rand(5) == 0 then v = v + BITS.swap end
  if ctl.raise > 0 then v = v + BITS.raise end
  return v
end
local DECODE = {}
for i = 1, 64 do DECODE[KeyDataEncoding.base64encode[i]] = i - 1 end

local written, matchNo = 0, 0
while written < FRAMES do
  matchNo = matchNo + 1
  local seed = SEED * 1000 + matchNo
  local mode = GameModes.getPreset(GameModes.IDs.TWO_PLAYER_VS)
  local match = Match(GeneratorSource(seed, true), mode.matchRules)
  a = match:createStackWithSettings(LevelPresets.getModern(LEVEL), true, "controller")
  local b = match:createStackWithSettings(LevelPresets.getModern(LEVEL), true, "controller")
  a:setMaxRunsPerFrame(1); b:setMaxRunsPerFrame(1)
  match:addTarget(a, b); match:addTarget(b, a)
  match:start()
  local brain = WeightedBrain.new({ profile = "bot/profiles/beverly.json" })
  local controller = CursorController.new({ cursorMoveInterval = 4, reactionFrames = 12 })
  local WAIT = { type = "WAIT" }

  -- Every delivery to side 1, whoever makes it, with side 1's clock at the
  -- moment it arrived (so a replay knows whether it came before or after the
  -- frame that clock names).
  local received = {}
  local receive = a.receiveGarbage
  a.receiveGarbage = function(self, delivery, senderId)
    for _, g in ipairs(delivery) do
      received[#received + 1] = { clock = self.clock, width = g.width, height = g.height, isChain = g.isChain or false,
                                  isMetal = g.isMetal or false, frameEarned = g.frameEarned, finalized = g.finalized,
                                  rowEarned = g.rowEarned, colEarned = g.colEarned, linkTimes = g.linkTimes }
    end
    return receive(self, delivery, senderId)
  end
  -- The rows side 1 is dealt (raw, shock letters and all: which of them turn
  -- to shock is the engine's own business) and the colours its garbage
  -- breaks into, in the order it takes them.
  local newRows, garbageRows = {}, {}
  do
    local src = a.panelSource
    local createNewRow, garbageRow = src.createNewRow, src.getGarbagePanelRowString
    src.createNewRow = function(self, stack, row)
      if string.len(self.panelBuffer) <= 2 * stack.width then self:growPanelBuffer(stack) end
      newRows[#newRows + 1] = self.panelBuffer:sub(1, stack.width)
      return createNewRow(self, stack, row)
    end
    src.getGarbagePanelRowString = function(self, stack)
      local r = garbageRow(self, stack)
      garbageRows[#garbageRows + 1] = r
      return r
    end
  end

  local ctlA, ctlB = { held = 0, raise = 0 }, { held = 0, raise = 0 }
  local first = true
  while written < FRAMES and not a:game_ended() and not b:game_ended() do
    local va
    if a.clock > 190 and rand(8) > 0 then
      local st = BoardState.extract(a)
      local decision = controller:isBusy() and WAIT or brain:decide(st, a, match)
      va = DECODE[controller:nextInput(st, decision)]
      if rand(40) == 0 then va = randomInput(ctlA) end
    else
      va = randomInput(ctlA)
    end
    -- side 2 never raises, so the match lasts
    local vb = randomInput(ctlB, true)
    a:receiveConfirmedInput(KeyDataEncoding.base64encode[va + 1])
    b:receiveConfirmedInput(KeyDataEncoding.base64encode[vb + 1])
    -- More garbage than the other side sends, of every kind the network can
    -- deliver, so side 1 reaches the top and breaks garbage.
    if a.clock > 188 and GARBAGE_EVERY > 0 and rand(GARBAGE_EVERY) == 0 then
      local k = rand(4)
      local g
      if k == 0 then g = { width = 6, height = 1 + rand(6), isChain = true, isMetal = false }
      elseif k == 1 then g = { width = 6, height = 1, isChain = false, isMetal = true }
      else g = { width = 3 + rand(4), height = 1, isChain = false, isMetal = false } end
      g.frameEarned = a.stopWatch; g.rowEarned = 1; g.colEarned = 1; g.finalized = true
      a:receiveGarbage({ g }, 0)
    end
    match:run()
    written = written + 1
    io.write('{"match":', matchNo, ',"received":', enc(received), ',"newRows":', enc(newRows), ',"garbageRows":', enc(garbageRows),
             first and (',"seed":' .. seed .. ',"levelData":' .. enc(a.levelData) .. ',"behaviours":' .. enc(a.behaviours) .. ',"stackOverConditions":' .. enc(a.stackOverConditions)) or '',
             (first or a.clock % STATE_EVERY == 0 or a:game_ended()) and (',"state":' .. dump(a, va)) or '',
             ',"input":', va, ',"clock":', a.clock, '}\n')
    received = {}; newRows = {}; garbageRows = {}; first = false
  end
  io.stderr:write(string.format("match %d: side 1 clock %d, %s\n", matchNo, a.clock, a:game_ended() and "side 1 died" or (b:game_ended() and "side 2 died" or "cut")))
end
