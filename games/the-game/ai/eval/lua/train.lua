-- THE BOT IN THE GAME'S OWN TRAINING. The server's Lua plays a training
-- match as the game builds it -- the player's stack at LEVEL, a simulated
-- opponent whose attack engine sends the pattern, the match's own garbage
-- delivery (staging, transit, the queue limits) -- and the bot plays the
-- player's stack: each frame the stack is written into the C engine's board
-- (cboard.lua, native/pa.h) and the bot's front end (native/front.c, in
-- native/libbit.so) gives the keys.
--
--   ../train.sh MODE SEED [FRAMES]   (or, in a panel-game checkout with its LUA_PATH,
--   luajit .../lua/train.lua MODE SEED [FRAMES [LEVEL]])
--
-- MODE: combo_storm, factory or large_garbage, built as TrainingMenu.lua
-- builds them. Prints "f<frame> panels P garb G queued Q top T" every 250
-- frames, then "died F" or "alive F". GC_TRACE=F prints every frame from F
-- (GC_STATES=1: with every cell's state);
-- GC_BOTLOG=F (GC_BOTLOG_N frames, 1 by default) writes the bot's own log of
-- its decisions to stderr, each frame headed "@ F". GC_DEATHLOG=N keeps the
-- bot's log of the last N frames and GC_DEATHBOARD=M (N by default) the board
-- of the last M, every cell's state, and prints them, headed "DEATH REPORT",
-- if the run dies: the run that died is the one read, here or on Actions,
-- never a replay. GC_GAMELOG=PATH writes the whole game there, every frame's
-- bot log and board.
--
-- EVERY DECISION IN ITS BUDGET, counted in work as the browser counts it
-- (native/bot.c WORKBUDGET); the collector runs one step at the top of each
-- frame. The run ends by printing the frames over 16.7 ms and the slowest.
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.ERROR) end
local ffi = require("ffi")
local Match = require("common.engine.Match")
require("common.engine.checkMatches")
local GameModes = require("common.data.GameModes")
local LevelPresets = require("common.data.LevelPresets")
local GeneratorSource = require("common.engine.GeneratorSource")
local KeyDataEncoding = require("common.data.KeyDataEncoding")
local here = debug.getinfo(1, "S").source:sub(2):match("(.*/)") or "./"
local CB = dofile(here .. "cboard.lua")

local MODE, SEED = arg[1], tonumber(arg[2])
local FRAMES, LEVEL = tonumber(arg[3]) or 120000, tonumber(arg[4]) or 10
local TRACE = tonumber(os.getenv("GC_TRACE") or "-1")
local BOTLOG, BOTLOG_N = tonumber(os.getenv("GC_BOTLOG") or "-1"), tonumber(os.getenv("GC_BOTLOG_N") or "1")
local DEATHLOG = tonumber(os.getenv("GC_DEATHLOG") or "0")
local DEATHBOARD = DEATHLOG > 0 and math.max(DEATHLOG, tonumber(os.getenv("GC_DEATHBOARD") or "0")) or 0
local GAMELOG = os.getenv("GC_GAMELOG") and assert(io.open(os.getenv("GC_GAMELOG"), "w"))
if LEVEL ~= 10 then io.stderr:write("train: drills run at level 10 only\n"); os.exit(2) end

-- TrainingMenu.lua createBasicTrainingMode
local SIZES = { combo_storm = { 4, 1 }, factory = { 6, 2 }, large_garbage = { 6, 12 } }
local size = SIZES[MODE]
if not size then io.stderr:write("train: no mode " .. tostring(MODE) .. "\n"); os.exit(2) end
local function basicTrainingMode(width, height)
  local patterns = {}
  for i = 1, 50 do
    patterns[#patterns + 1] = { width = width, height = height, startTime = i, metal = false, chain = false, endsChain = false }
  end
  return { delayBeforeStart = 150, delayBeforeRepeat = 900, attackPatterns = patterns }
end

local mode = GameModes.getPreset(GameModes.IDs.ONE_PLAYER_TRAINING)
local match = Match(GeneratorSource(SEED, true), mode.matchRules)
local a = match:createStackWithSettings(LevelPresets.getModern(LEVEL), true, "controller")
a:setMaxRunsPerFrame(1)
local foe = match:createSimulatedStackWithSettings(basicTrainingMode(size[1], size[2]))
foe:setMaxRunsPerFrame(1)
match:addTarget(foe, a)
match:start()

-- the bot
ffi.cdef [[
typedef struct Board Board;
double *nb_io_head(void);
int32_t *nb_io_body(void);
int nb_nhead(void);
const char *nb_head_name(int i);
Board *nb_new(void);
int nb_load(Board *b);
int nb_feed_row(Board *b, int32_t c1, int32_t c2, int32_t c3, int32_t c4, int32_t c5, int32_t c6);
int nb_feed_break(Board *b, int32_t c1, int32_t c2, int32_t c3, int32_t c4, int32_t c5, int32_t c6);
int nb_pressed(Board *b);
int front_new(Board *b, int reaction, int allowRaise);
int front_frame(int fid, Board *b);
int botTraceOn;
void *botLogTo;
typedef struct FILE FILE;
FILE *open_memstream(char **ptr, size_t *size);
int fclose(FILE *f);
void free(void *p);
typedef struct { long tv_sec; long tv_nsec; } gc_timespec;
int clock_gettime(int clk, gc_timespec *ts);
]]
local C = ffi.load(os.getenv("GC_LIB") or (here .. "../native/libbit.so"))   -- GC_LIB: another build, to compare
local NH = C.nb_nhead()
local HI = {}
for i = 0, NH - 1 do HI[ffi.string(C.nb_head_name(i))] = i end
local made = { nrows = 0, ninc = 0, nstall = 0, nlanded = 0, err = 0, unseenRows = 0, unseenBreaks = 0, nextInput = 0,
               pressSwap = 0, swapDeniedThisFrame = 0 }
local board = C.nb_new()
local ROWS, BRKS, dealt = {}, {}, { rows = 0, brks = 0 }
local pv = {}
local function load()
  local H, B = C.nb_io_head(), C.nb_io_body()
  for i = 0, NH - 1 do H[i] = 0 / 0 end
  for k, v in pairs(CB.head(a)) do
    local i = HI[k]
    if i then H[i] = v == true and 1 or v == false and 0 or v end
  end
  local inc, stall, landed = CB.incoming(a), CB.stall(a), CB.landed(a)
  made.nrows = #a.panels + 1; made.ninc = #inc; made.nstall = #stall; made.nlanded = #landed
  for k, v in pairs(made) do H[HI[k]] = v end
  local x = 0
  for r = 0, #a.panels do
    for c = 1, a.width do
      CB.panel(a.panels[r][c], pv)
      for i = 1, CB.NF do B[x] = pv[i]; x = x + 1 end
    end
  end
  for _, g in ipairs(inc) do for i = 1, 6 do B[x] = g[i]; x = x + 1 end end
  for _, s in ipairs(stall) do for i = 1, 5 do B[x] = s[i]; x = x + 1 end end
  for _, id in ipairs(landed) do B[x] = id; x = x + 1 end
  for _, d in ipairs(CB.drop(a)) do B[x] = d; x = x + 1 end
  local err = C.nb_load(board)
  if err ~= 0 then io.stderr:write("train: the engine refused the board (err " .. err .. ")\n"); os.exit(2) end
  for i = dealt.rows + 1, #ROWS do
    local r = ROWS[i]
    if C.nb_feed_row(board, r[1], r[2], r[3], r[4], r[5], r[6]) == 0 then break end
  end
  for i = dealt.brks + 1, #BRKS do
    local r = BRKS[i]
    if C.nb_feed_break(board, r[1], r[2], r[3], r[4], r[5], r[6]) == 0 then break end
  end
end

local function counts()
  local p, g = 0, 0
  for r = 1, #a.panels do
    for c = 1, a.width do
      local q = a.panels[r][c]
      if q.color ~= 0 then if q.isGarbage then g = g + 1 else p = p + 1 end end
    end
  end
  return p, g
end
-- GC_STATES=1: each cell as two characters, what it is and its state
-- (n normal, d dimmed, f falling, h hovering, l landing, m matched, p popping,
-- x popped, s swapping), so a break converting and a slab falling read apart
local STATES = os.getenv("GC_STATES") == "1"
local STATECH = { normal = "n", dimmed = "d", falling = "f", hovering = "h", landing = "l", matched = "m", popping = "p", popped = "x", swapping = "s" }
local function show(states)
  states = states or STATES
  local out = {}
  for r = math.min(#a.panels, 13), 0, -1 do
    local s = {}
    for c = 1, a.width do
      local q = a.panels[r][c]
      local ch = q.isGarbage and "g" or q.color ~= 0 and tostring(q.color % 10) or "."
      if states then ch = ch .. (q.color == 0 and "." or STATECH[q.state] or "?")
      elseif q.color ~= 0 and q.state ~= "normal" and q.state ~= "dimmed" then ch = q.isGarbage and "G" or "X" end
      s[#s + 1] = ch
    end
    out[#out + 1] = table.concat(s)
  end
  return table.concat(out, " ")
end

local FRAME_MS, RUN_RESERVE = 1000 / 60, 3.0   -- RUN_RESERVE: match:run, 1.9 ms at p99.9 (combo_storm seed 1); lua_budget_check.sh holds each decision to the frame less it
local TS = ffi.new("gc_timespec")
local function now() ffi.C.clock_gettime(1, TS); return tonumber(TS.tv_sec) * 1e3 + tonumber(TS.tv_nsec) / 1e6 end
local over, slowest = 0, 0
local function frameLine(f, bits, states)
  return string.format("F %d keys %d stop %d shake %d lock %d raise %d health %d cur %d,%d in %d | %s", f, bits, a.stop_time,
                       a.shake_time, a.rise_lock and 1 or 0, a.manual_raise and 1 or 0, a.health, a.cur_row, a.cur_col,
                       #a.incomingGarbage.stagedGarbage, show(states))
end
-- GC_DEATHLOG: each frame's bot log written to memory, not stderr, and kept
-- in a ring of the last DEATHLOG frames; the boards in one of DEATHBOARD
local logs, boards, LOGP, LOGN = {}, {}, ffi.new("char *[1]"), ffi.new("size_t[1]")
local function deathReport(f)
  print("DEATH REPORT: the boards of the last " .. math.min(DEATHBOARD, f + 1) .. " frames, the bot's log of the last "
        .. math.min(DEATHLOG, f + 1) .. " before them")
  for g = math.max(0, f - DEATHBOARD + 1), f do
    if g > f - DEATHLOG then io.write("@ ", g, "\n", logs[g % DEATHLOG + 1]) end
    io.write(boards[g % DEATHBOARD + 1], "\n")
  end
  print("END DEATH REPORT")
end

-- the countdown, nothing pressed; the bot is made during it, not on a live frame
local fid = -1
while a.in_countdown or not a.stopWatchIsRunning do
  if fid < 0 then load(); fid = C.front_new(board, 12, 1) end
  a:receiveConfirmedInput(KeyDataEncoding.base64encode[1])
  match:run()
end
-- the rows and garbage colours to come, as the drill deals them (deal.lua),
-- and how many of each the stack has taken
ROWS, BRKS = CB.stream(a, 20000)
do
  local src = a.panelSource
  local newRow, brkRow = src.createNewRow, src.getGarbagePanelRowString
  src.createNewRow = function(...) dealt.rows = dealt.rows + 1; return newRow(...) end
  src.getGarbagePanelRowString = function(...) dealt.brks = dealt.brks + 1; return brkRow(...) end
end
collectgarbage("stop")
local f = 0
while f < FRAMES do
  local t0 = now()
  collectgarbage("step", 0)
  load()
  C.botTraceOn = (BOTLOG >= 0 and f >= BOTLOG and f < BOTLOG + BOTLOG_N) and 1 or 0
  if C.botTraceOn ~= 0 then io.stderr:write("@ " .. f .. "\n") end
  local mem
  if (DEATHLOG > 0 or GAMELOG) and C.botTraceOn == 0 then mem = ffi.C.open_memstream(LOGP, LOGN); C.botLogTo = mem; C.botTraceOn = 1 end
  local bits = os.getenv("GC_NOBOT") and 0 or C.front_frame(fid, board)
  local blog = ""
  if mem then
    ffi.C.fclose(mem); C.botLogTo = nil; C.botTraceOn = 0
    blog = ffi.string(LOGP[0], LOGN[0]); ffi.C.free(LOGP[0])
  end
  if bits < 0 then io.stderr:write("train: the bot failed at frame " .. f .. "\n"); os.exit(2) end
  if C.nb_pressed(board) ~= 0 then bits = bit.bor(bits, 16) end
  a:receiveConfirmedInput(KeyDataEncoding.base64encode[bits + 1])
  match:run()
  local took = now() - t0
  if took > FRAME_MS then over = over + 1 end
  if took > slowest then slowest = took end
  if TRACE >= 0 and f >= TRACE then print(frameLine(f, bits)) end
  if DEATHLOG > 0 or GAMELOG then
    local board = frameLine(f, bits, true)
    if DEATHLOG > 0 then logs[f % DEATHLOG + 1] = blog; boards[f % DEATHBOARD + 1] = board end
    if GAMELOG then GAMELOG:write("@ ", f, "\n", blog, board, "\n") end
  end
  local dead = a.game_over_clock and a.game_over_clock > 0
  if f % 250 == 0 or dead then
    local p, g = counts()
    print(string.format("f%d panels %d garb %d queued %d top %d", f, p, g, #a.incomingGarbage.stagedGarbage,
                        a:isToppedOut() and 1 or 0))
    io.stdout:flush()
  end
  if dead and DEATHLOG > 0 then deathReport(f) end
  if dead and GAMELOG then GAMELOG:close() end
  if dead then print(string.format("frames over %.1f ms: %d, slowest %.1f ms", FRAME_MS, over, slowest)); print("died " .. f); os.exit(1) end
  f = f + 1
end
print(string.format("frames over %.1f ms: %d, slowest %.1f ms", FRAME_MS, over, slowest))
if GAMELOG then GAMELOG:close() end
print("alive " .. f)
