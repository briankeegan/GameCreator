-- GAMBIT IN THE GAME'S OWN PROCESS: a stack of the panel-game client played by Gambit (libgambit.so: the C engine, Gambit and its
-- frame loop, gambit/native.c). Each frame the stack is written into the C engine's board (board.lua) as the player sees it, with the
-- garbage the senders' telegraphs show and the input budget's window, and the frame loop gives the keys. Nothing is decided here.
--
--   local G = dofile(<GameCreator>/games/the-game/ai/gambit/lua/GambitNative.lua)   -- once per process
--   local bot = G.new({})
--   bot:startMatch(stack)                 -- once per match
--   local char = bot:input(stack, sources, view)   -- every frame, before it is run (view: the opponent's shipped board, or nil)
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
void gn_switch(int min, int max);
void gn_share(int under, int otherwise);
void gn_attack(int on);
int32_t *gn_tele(void);
int32_t *gn_ages(void);
void gn_match(void);
int gn_frame(int limit, int window, int nages, int oppHas, int oppOut, int oppTop, int oppStop);
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
  local setup, profile, rules, switch, share, attack
  for line in f:lines() do
    local kind, rest = line:match("^(%S+) (.*)$")
    if kind == "setup" or kind == "profile" or kind == "rules" or kind == "switch" or kind == "share" or kind == "attack" then
      local v = {}
      for n in rest:gmatch("%S+") do v[#v + 1] = tonumber(n) end
      if kind == "setup" then setup = v elseif kind == "profile" then profile = v elseif kind == "switch" then switch = v elseif kind == "share" then share = v elseif kind == "attack" then attack = v else rules = v end
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
  C.gn_switch(switch and switch[1] or 0, switch and switch[2] or 0)
  C.gn_share(share and share[1] or 0, share and share[2] or 0)
  C.gn_attack(attack and attack[1] or 0)
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
-- (the io's head and body, and the one writer of a head field: made once, so a frame's load makes nothing)
local H, Bd = C.nb_io_head(), C.nb_io_body()
local function put(k, v)
  local i = HI[k]
  if i and v ~= nil then H[i] = v == true and 1 or v == false and 0 or v end
end
function GambitNative:load(a)
  if a.do_countdown ~= nil then a.in_countdown = a.do_countdown and true or false end
  local pv = self.pv
  for i = 0, NH - 1 do H[i] = 0 / 0 end
  B.head(a, put)
  local inc, stall, landed = B.staged(a), B.stall(a), B.landed(a)
  local from = math.max(1, #inc - KEEP_QUEUED + 1)
  self.nrows, self.nqueued = #a.panels + 1, #inc
  put("nrows", #a.panels + 1); put("ninc", #inc - from + 1); put("nstall", #stall); put("nlanded", #landed); put("err", 0)
  put("unseenRows", 0); put("unseenBreaks", 0); put("nextInput", 0); put("pressSwap", 0); put("swapDeniedThisFrame", 0)
  local x, flash = 0, a.levelData.frameConstants.FLASH
  for r = 0, #a.panels do
    for c = 1, a.width do
      B.panel(a.panels[r][c], pv, a.width, flash)
      for i = 1, B.NF do Bd[x] = pv[i]; x = x + 1 end
    end
  end
  for j = from, #inc do x = B.putIncoming(inc[j], Bd, x) end
  for i = 1, #stall do x = B.putStall(stall[i], Bd, x) end
  for i = 1, #landed do Bd[x] = landed[i]; x = x + 1 end
  local drop = B.drop(a)
  for i = 1, #drop do Bd[x] = drop[i]; x = x + 1 end
end

-- The garbage each source has sent and not yet delivered, as its telegraph shows it: whether its queue is held back (an attack engine's),
-- its transit by the stopWatch it lands on, then its staged that ship first (the end of the list), SOURCE_PIECES in all. Colours are not
-- in it.
local SOURCE_PIECES = 160
local function b01(v) return v and 1 or 0 end
local EMPTY = {}
local function piece(T, x, g)
  T[x], T[x + 1], T[x + 2], T[x + 3] = g.width, g.height, b01(g.isChain), b01(g.isMetal)
  T[x + 4] = g.frameEarned == nil and NUL or g.frameEarned
  T[x + 5] = g.finalized == nil and NUL or b01(g.finalized)
  return x + 6
end
-- A SOURCE WHOSE GARBAGE COMES OVER THE WIRE: the engine's own routing (common/engine/GarbageDelivery.lua looseSyncActive) -- loose
-- sync on and connected, the source not this client's: the server's relayed garbage is what lands, and the copy of the source played
-- here is no word on it (its outgoing queue is never delivered here). Anywhere else -- lockstep, Training, a local match -- the source
-- is played here exactly and delivers here, so its outgoing garbage is the garbage on its way and its board the opponent's own.
local function wired(src)
  return LOOSE_SYNC_GARBAGE and GAME and GAME.netClient and GAME.netClient.isConnected and GAME.netClient:isConnected()
    and not src.is_local and true or false
end
-- (a wired source's garbage is read off this stack's own queue only, what the server delivered: board.lua loads it)
function GambitNative:telegraph(sources)
  local T, x = C.gn_tele(), 1
  local n = 0
  for _, src in ipairs(sources or EMPTY) do
    local q = src.outgoingGarbage
    if q and src.stopWatch ~= nil and not wired(src) then
      n = n + 1
      T[x], T[x + 1] = src.stopWatch, b01(q.illegalStuffIsAllowed); x = x + 2
      -- (every transit not yet delivered: one whose time has come waits while the stack has CAPPED_AT queued, GarbageDelivery; its count
      -- written once they are)
      local sent, nt, at = 0, 0, x
      x = x + 1
      if q.transitTimers then
        for k = q.transitTimers.first, q.transitTimers.last do
          local t = q.transitTimers[k]
          if t and sent < SOURCE_PIECES then
            local list = q.garbageInTransit[t] or EMPTY
            T[x], T[x + 1] = t, #list; x = x + 2
            for i = 1, #list do x = piece(T, x, list[i]) end
            nt, sent = nt + 1, sent + #list
          end
        end
      end
      T[at] = nt
      local staged = q.stagedGarbage or EMPTY
      local keep = math.max(0, math.min(#staged, SOURCE_PIECES - sent))
      T[x] = keep; x = x + 1
      for i = #staged - keep + 1, #staged do x = piece(T, x, staged[i]) end
    end
  end
  T[0] = n
end

-- The stack this one fights, as the rules' `when` and `by` read it (gambit-rules.json enemy.*): whether there is one (an attack engine,
-- Training's, is no stack: none), whether it is topped out -- garbage above its top row, a board that can die (a stack that only
-- reaches the top row is tall, not topped out) -- the highest row it has a panel in, and the frames it is held up by. Read
-- off the opponent's own board as its client shipped it (view: BotClient's oppView, from the snapshots it paints from) when one came
-- within VIEW_FRESH frames -- its stop counted down since; else off the copy of its stack played here from its relayed keys: its stop
-- and pre-stop, or its shake when longer, as the judge reads a board's (judge.c dropAt).
-- An opponent whose garbage comes over the wire (wired) is read off its shipped board only, however old the last one -- the copy played
-- here is no source of its board -- and before the first, the board a match begins with: not topped out, low, no stop. One played here
-- exactly is read off its own stack. (A panel counts as the engine's Panel:dangerous counts it: garbage still falling is not the
-- stack's height, and does not top it out.)
local function counts(p) if not p then return false end if p.isGarbage then return p.state ~= "falling" end return (p.color or 0) ~= 0 end
local function opponentOf(sources, view, clock)
  local anyWired = false
  for _, src in ipairs(sources or EMPTY) do if src.panels and wired(src) then anyWired = true end end
  if view and clock and view.seen and (anyWired or clock - view.seen <= VIEW_FRESH) then
    return 1, view.over and 1 or 0, view.top or 0, math.max(0, (view.stop or 0) - (clock - view.seen))
  end
  if anyWired then return 1, 0, 0, 0 end
  local has, out, top, stop = 0, 0, 0, 0
  for _, src in ipairs(sources or EMPTY) do
    if type(src.game_ended) == "function" and src:game_ended() then return 0, 0, 0, 0 end
    if type(src.isToppedOut) == "function" and src.panels then
      has = 1
      stop = math.max(stop, (src.stop_time or 0) + (src.pre_stop_time or 0), src.shake_time or 0)
      local above = src.panels[(src.height or 12) + 1]
      for col = 1, src.width or 6 do local p = above and above[col]; if p and p.isGarbage and p.state ~= "falling" then out = 1 end end
      for row = src.height or 12, 1, -1 do
        local found = false
        for col = 1, src.width or 6 do if counts(src.panels[row] and src.panels[row][col]) then found = true break end end
        if found then if row > top then top = row end break end
      end
    end
  end
  return has, out, top, stop
end

function GambitNative:think(stack, sources, view)
  local idle = KeyDataEncoding.base64encode[1]
  if counting(stack) or not stack.stopWatchIsRunning or stack:game_ended() then return idle end
  local t0 = ThinkBudget.now()
  self:load(stack)
  local t1 = ThinkBudget.now()
  self:telegraph(sources)
  local ages, A = self.inputs:ages(stack.clock, self.ages), C.gn_ages()
  for i = 1, math.min(#ages, 512) do A[i - 1] = ages[i] end
  local has, out, top, stop = opponentOf(sources, view, stack.clock)
  local t2 = ThinkBudget.now()
  local bits = C.gn_frame(self.inputs.limit, self.inputs.window, math.min(#ages, 512), has, out, top, stop)
  self.stepLoad, self.stepTele, self.stepFrame = t1 - t0, t2 - t1, ThinkBudget.now() - t2
  if bits < 0 then error("GambitNative: the engine refused the board at clock " .. tostring(stack.clock)) end
  self.frames = self.frames + 1
  return KeyDataEncoding.base64encode[bits + 1] or idle
end

-- The key, or idle when the allowance of keys cannot pay for it (the game does not press a key past it).
local KEYBITS = { 2, 3, 4, 5, 6 }
function GambitNative:press(key, clock)
  local keys, held, down = KeyDataEncoding.base64decode[key], self.inputs.held, 0
  for _, bit in ipairs(KEYBITS) do
    if keys and keys[bit] and not held[bit] then down = down + 1 end
  end
  if down > self.inputs:remaining(clock) then key = KeyDataEncoding.idle; self.dropped = self.dropped + 1 end
  self.inputs:press(key, clock)
  return key
end

-- The frame's work, charged to the thinking budget, its key pressed on the input budget -- the game's own.
function GambitNative:input(stack, sources, view)
  collectgarbage("stop")
  C.gn_thread_stats(self.ts0)
  local began = ThinkBudget.now()
  local ok, key = pcall(self.think, self, stack, sources, view)
  if ok and self.ownInputs then key = self:press(key, stack.clock) end
  local took = ThinkBudget.now() - began
  collectgarbage("restart")
  if not ok then error(key, 0) end
  if self.ownThinking then self.thinking:charge(took) end
  -- a frame over the ceiling, and where its time went
  if took > self.thinking:snapshot().ceiling and self.stepLoad and (self.slowLogged or 0) < 50 then
    self.slowLogged = (self.slowLogged or 0) + 1
    -- (and the game thread's own account of it: its CPU time, the times it was taken off its core or gave it up, its page faults)
    local a, b = self.ts0, self.ts1
    C.gn_thread_stats(b)
    C.gn_log(string.format("SLOWFRAME clock %d: %.1f ms (load %.1f, telegraph %.1f, frame loop %.1f) cpu %.1f ms, preempted %d, yielded %d, faults %d; %s",
      stack.clock, took * 1000, self.stepLoad * 1000, self.stepTele * 1000, self.stepFrame * 1000, b[0] - a[0], b[1] - a[1], b[2] - a[2], b[3] - a[3],
      string.format("rows %d, queued %d", self.nrows or 0, self.nqueued or 0)))
  end
  self.stepLoad = nil
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
  jit.off(opponentOf, true); jit.off(put, true); jit.off(piece, true)
end

return GambitNative
