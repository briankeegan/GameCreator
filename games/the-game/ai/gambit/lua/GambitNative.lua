-- GAMBIT IN THE GAME'S OWN PROCESS: a stack of the panel-game client played by Gambit (libgambit.so: the C engine, Gambit and its
-- frame loop, gambit/native.c). Each frame the stack is written into the C engine's board (board.lua) as the player sees it, with the
-- garbage the senders' telegraphs show and the input budget's window, and the frame loop gives the keys. Nothing is decided here.
--
--   local G = dofile(<GameCreator>/games/the-game/ai/gambit/lua/GambitNative.lua)   -- once per process
--   local bot = G.new({})
--   bot:startMatch(stack)                 -- once per match
--   local char = bot:input(stack, sources)   -- every frame, before it is run
--
-- Env: GC_GAMBIT_DIR (the gambit directory; default: this file's), GC_GAMBIT_WORDS (the profile as numbers, words.js; default
-- GC_GAMBIT_DIR/gambit.words), GC_GAMBIT_LOG (the run's log: GAMBITD lines and the match's stats).
local ffi = require("ffi")
local KeyDataEncoding = require("common.data.KeyDataEncoding")
local function budgetClass(name)
  local ok, class = pcall(require, "common.engine.computerPlayers." .. name)
  if ok then return class end
  return require("bot." .. name)
end
local ThinkBudget = budgetClass("ThinkBudget")
local InputBudget = budgetClass("InputBudget")
local function counting(stack)
  if stack.do_countdown ~= nil then return stack.do_countdown end
  return stack.in_countdown
end

local HERE = debug.getinfo(1, "S").source:match("^@(.*)/lua/[^/]*$") or "."
local DIR = os.getenv("GC_GAMBIT_DIR") or HERE

ffi.cdef [[
double *nb_io_head(void);
int32_t *nb_io_body(void);
int nb_nhead(void);
const char *nb_head_name(int i);
int gn_setup(int reaction, int swapGap, int cursor, int ahead, int gap, int jitter, int planHealth, const char *logPath);
int32_t *gn_io(void);
int gn_rules(int n);
void gn_rule_name(int i, const char *name);
void gn_profile(int mode, int ms, int extendMs, int width, int depth, int pool, int extendDepth, int extendOff);
int32_t *gn_tele(void);
int32_t *gn_ages(void);
void gn_match(void);
int gn_frame(int limit, int window, int nages, int oppHas, int oppOut, int oppTop);
void gn_end(void);
void gn_log(const char *s);
void gn_thread_stats(double *out);
]]
local C = ffi.load(DIR .. "/libgambit.so")
local B = dofile(DIR .. "/lua/board.lua")
local NUL = B.NUL
local HI, NH = {}, C.nb_nhead()
for i = 0, NH - 1 do HI[ffi.string(C.nb_head_name(i))] = i end

-- the profile, as words.js wrote it
do
  local file = os.getenv("GC_GAMBIT_WORDS") or (DIR .. "/gambit.words")
  local f = assert(io.open(file), "GambitNative: no " .. file .. " (words.js writes it)")
  local setup, profile, rules
  for line in f:lines() do
    local kind, rest = line:match("^(%S+) (.*)$")
    if kind == "setup" or kind == "profile" or kind == "rules" then
      local v = {}
      for n in rest:gmatch("%S+") do v[#v + 1] = tonumber(n) end
      if kind == "setup" then setup = v elseif kind == "profile" then profile = v else rules = v end
    elseif kind == "name" then
      local i, name = rest:match("^(%d+) (.*)$")
      C.gn_rule_name(tonumber(i), name)
    end
  end
  f:close()
  assert(setup and profile and rules, "GambitNative: " .. file .. " is not a whole profile")
  C.gn_setup(setup[1], setup[2], setup[3], setup[4], setup[5], setup[6], setup[7], os.getenv("GC_GAMBIT_LOG") or "")
  local io, n, len = C.gn_io(), rules[1], rules[2]
  for i = 1, len do io[i - 1] = rules[2 + i] end
  assert(C.gn_rules(n) == n, "GambitNative: the rules were refused")
  C.gn_profile(profile[1], profile[2], profile[3], profile[4], profile[5], profile[6], profile[7], profile[8])
end

local GambitNative = {}
GambitNative.__index = GambitNative

function GambitNative.new(opts)
  opts = opts or {}
  local self = setmetatable({}, GambitNative)
  self.thinking = opts.thinkBudget or ThinkBudget.standard()
  self.ownThinking = opts.thinkBudget == nil
  self.inputs = opts.inputBudget or InputBudget.standard()
  self.ownInputs = opts.inputBudget == nil
  self.dropped, self.frames, self.ages, self.pv = 0, 0, {}, {}
  self.ts0, self.ts1 = ffi.new("double[4]"), ffi.new("double[4]")
  return self
end

-- (the stack loaded once before play, so the first frame does not pay for the first load: the library's functions bound, the tables made)
function GambitNative:startMatch(stack, match)
  self.match, self.stack, self.frames = match, stack, 0
  C.gn_match()
  if stack and stack.panels then pcall(self.load, self, stack) end
end

-- The stack into the engine's io as the player sees it. The queue keeps the 192 to drop soonest (the search's boards hold 256, and 64
-- arriving).
local KEEP_QUEUED = 192
function GambitNative:load(a)
  if a.do_countdown ~= nil then a.in_countdown = a.do_countdown and true or false end
  local H, Bd, pv = C.nb_io_head(), C.nb_io_body(), self.pv
  for i = 0, NH - 1 do H[i] = 0 / 0 end
  for k, v in pairs(B.head(a)) do
    local i = HI[k]
    if i then H[i] = v == true and 1 or v == false and 0 or v end
  end
  local inc, stall, landed = B.incoming(a), B.stall(a), B.landed(a)
  local from = math.max(1, #inc - KEEP_QUEUED + 1)
  local made = { nrows = #a.panels + 1, ninc = #inc - from + 1, nstall = #stall, nlanded = #landed, err = 0, unseenRows = 0,
                 unseenBreaks = 0, nextInput = 0, pressSwap = 0, swapDeniedThisFrame = 0 }
  for k, v in pairs(made) do H[HI[k]] = v end
  local x = 0
  for r = 0, #a.panels do
    for c = 1, a.width do
      B.panel(a.panels[r][c], pv)
      for i = 1, B.NF do Bd[x] = pv[i]; x = x + 1 end
    end
  end
  for j = from, #inc do local g = inc[j]; for i = 1, 6 do Bd[x] = g[i]; x = x + 1 end end
  for _, s in ipairs(stall) do for i = 1, 5 do Bd[x] = s[i]; x = x + 1 end end
  for _, id in ipairs(landed) do Bd[x] = id; x = x + 1 end
  for _, d in ipairs(B.drop(a)) do Bd[x] = d; x = x + 1 end
end

-- The garbage each source has sent and not yet delivered, as its telegraph shows it: its transit by the stopWatch it lands on, then its
-- staged that ship first (the end of the list), SOURCE_PIECES in all. Colours are not in it.
local SOURCE_PIECES = 160
local function b01(v) return v and 1 or 0 end
function GambitNative:telegraph(sources)
  local T, x = C.gn_tele(), 1
  local n = 0
  local function piece(g)
    T[x], T[x + 1], T[x + 2], T[x + 3] = g.width, g.height, b01(g.isChain), b01(g.isMetal)
    T[x + 4] = g.frameEarned == nil and NUL or g.frameEarned
    T[x + 5] = g.finalized == nil and NUL or b01(g.finalized)
    x = x + 6
  end
  for _, src in ipairs(sources or {}) do
    local q = src.outgoingGarbage
    if q and src.stopWatch ~= nil then
      n = n + 1
      T[x] = src.stopWatch; x = x + 1
      local sent, transit = 0, {}
      if q.transitTimers then
        for k = q.transitTimers.first, q.transitTimers.last do
          local t = q.transitTimers[k]
          if t and t > src.stopWatch and sent < SOURCE_PIECES then transit[#transit + 1] = t; sent = sent + #(q.garbageInTransit[t] or {}) end
        end
      end
      T[x] = #transit; x = x + 1
      for _, t in ipairs(transit) do
        local list = q.garbageInTransit[t] or {}
        T[x], T[x + 1] = t, #list; x = x + 2
        for _, g in ipairs(list) do piece(g) end
      end
      local staged = q.stagedGarbage or {}
      local keep = math.max(0, math.min(#staged, SOURCE_PIECES - sent))
      T[x] = keep; x = x + 1
      for i = #staged - keep + 1, #staged do piece(staged[i]) end
    end
  end
  T[0] = n
end

-- Whether a stack this one fights is topped out, and the highest row it has a panel in (an attack engine has no panels: 0).
local function opponentOf(sources)
  local out, top = 0, 0
  for _, src in ipairs(sources or {}) do
    if type(src.game_ended) == "function" and src:game_ended() then return 0, 0, 0 end
    if type(src.isToppedOut) == "function" and src.panels then
      if src:isToppedOut() then out = 1 end
      for row = src.height or 12, 1, -1 do
        local found = false
        for col = 1, src.width or 6 do
          local p = src.panels[row] and src.panels[row][col]
          if p and p.color and p.color ~= 0 then found = true break end
        end
        if found then if row > top then top = row end break end
      end
    end
  end
  return 1, out, top
end

function GambitNative:think(stack, sources)
  local idle = KeyDataEncoding.base64encode[1]
  if counting(stack) or not stack.stopWatchIsRunning or stack:game_ended() then return idle end
  local t0 = ThinkBudget.now()
  self:load(stack)
  local t1 = ThinkBudget.now()
  self:telegraph(sources)
  local ages, A = self.inputs:ages(stack.clock, self.ages), C.gn_ages()
  for i = 1, math.min(#ages, 512) do A[i - 1] = ages[i] end
  local has, out, top = opponentOf(sources)
  local t2 = ThinkBudget.now()
  local bits = C.gn_frame(self.inputs.limit, self.inputs.window, math.min(#ages, 512), has, out, top)
  self.steps = { load = t1 - t0, telegraph = t2 - t1, frame = ThinkBudget.now() - t2 }
  if bits < 0 then error("GambitNative: the engine refused the board at clock " .. tostring(stack.clock)) end
  self.frames = self.frames + 1
  return KeyDataEncoding.base64encode[bits + 1] or idle
end

-- The key, or idle when the allowance of keys cannot pay for it (the game does not press a key past it).
function GambitNative:press(key, clock)
  local keys, held, down = KeyDataEncoding.base64decode[key], self.inputs.held, 0
  for _, bit in ipairs({2, 3, 4, 5, 6}) do
    if keys and keys[bit] and not held[bit] then down = down + 1 end
  end
  if down > self.inputs:remaining(clock) then key = KeyDataEncoding.idle; self.dropped = self.dropped + 1 end
  self.inputs:press(key, clock)
  return key
end

-- The frame's work, charged to the thinking budget, its key pressed on the input budget -- the game's own.
function GambitNative:input(stack, sources)
  collectgarbage("stop")
  C.gn_thread_stats(self.ts0)
  local began = ThinkBudget.now()
  local ok, key = pcall(self.think, self, stack, sources)
  if ok and self.ownInputs then key = self:press(key, stack.clock) end
  local took = ThinkBudget.now() - began
  collectgarbage("restart")
  if not ok then error(key, 0) end
  if self.ownThinking then self.thinking:charge(took) end
  -- a frame over the ceiling, and where its time went
  if took > self.thinking:snapshot().ceiling and self.steps and (self.slowLogged or 0) < 50 then
    self.slowLogged = (self.slowLogged or 0) + 1
    -- (and the game thread's own account of it: its CPU time, the times it was taken off its core or gave it up, its page faults)
    local a, b = self.ts0, self.ts1
    C.gn_thread_stats(b)
    C.gn_log(string.format("SLOWFRAME clock %d: %.1f ms (load %.1f, telegraph %.1f, frame loop %.1f) cpu %.1f ms, preempted %d, yielded %d, faults %d",
      stack.clock, took * 1000, self.steps.load * 1000, self.steps.telegraph * 1000, self.steps.frame * 1000, b[0] - a[0], b[1] - a[1], b[2] - a[2], b[3] - a[3]))
  end
  self.steps = nil
  return key
end

---The frames whose thinking cost more than the ceiling, the worst frame (seconds), and the keys the allowance refused.
function GambitNative:budget()
  return self.thinking:overruns(), self.thinking:worst(), self.dropped
end

function GambitNative:endMatch() C.gn_end() end

-- NOTHING IN A FRAME IS COMPILED. The compiler records and compiles a loop the first time it runs hot, and a compile inside a frame
-- costs tens of milliseconds; this code is calls into C and table writes, which compiling does not speed up, so it runs interpreted, at
-- the same speed every frame.
if jit and jit.off then
  for _, t in ipairs({ GambitNative, B }) do
    for _, f in pairs(t) do if type(f) == "function" then jit.off(f, true) end end
  end
  jit.off(opponentOf, true)
end

return GambitNative
