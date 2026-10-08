-- ONE ISLAND 2.0 BOT ON THE LIVE SERVER, match after match.
--
--   (in a panel-game checkout with bot/BotClient.lua and bot/SurvivalLink.lua,
--    its LUA_PATH set, survivor.js listening on PA_SURVIVOR_PORT with
--    GC_SURVIVOR_RELOAD=1)
--   luajit .../lua/island2Bot.lua HOST PORT N STOP_AT
--
-- Logs in once as isl2b<N> and stays. Before each match it asks island2.js
-- who it plays next (`island2.sh next`), challenges that bot by name whenever
-- both are in the lobby and accepts a challenge from that bot only -- the
-- server opens a private room once both challenge. It plays as WasmSurvivor
-- (brain "survival") until a side dies or the stack's clock reaches 21600
-- (six minutes), leaves the room, and hands the result to `island2.sh after`,
-- which records it (a loss moves this bot's weights toward the winner's) and
-- rewrites the profile survivor.js reads at the next match. An opponent not
-- met in PATIENCE seconds is recorded as no match and the next is played.
-- No match starts after STOP_AT (epoch seconds).
io.stdout:setvbuf("no")
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.WARN) end
local socket = require("socket")
local dkjson = require("common.lib.dkjson")
local BotClient = require("bot.BotClient")
local ClientProtocol = require("common.network.ClientProtocol")
local GameModes = require("common.data.GameModes")

local HOST, PORT, N, STOP_AT = arg[1], tonumber(arg[2]), tonumber(arg[3]), tonumber(arg[4])
assert(HOST and PORT and N and STOP_AT, "usage: island2Bot.lua HOST PORT N STOP_AT")
local NAME, FRAMES, PATIENCE = "isl2b" .. N, 21600, 900
local SH = os.getenv("ISLAND2_SH")   -- island2.sh, for `next` and `after`

local function sh(args)
  local p = io.popen("bash " .. SH .. " " .. args)
  local out = p:read("*a"); p:close()
  return (out or ""):gsub("%s+$", "")
end
local function quote(s) return "'" .. s:gsub("'", "'\\''") .. "'" end

local bot = BotClient({ ip = HOST, port = PORT, name = NAME, brain = "survival",
                        cursorSpeed = { cursorMoveInterval = 4, reactionFrames = 12 } })
if not bot:login() then print(NAME .. ": login failed"); os.exit(1) end
bot:leaveRoom()
print(NAME .. ": in the lobby on " .. HOST .. ":" .. PORT)

-- this match's opponent: the only challenge answered
local opp, oppName, oppId = nil, nil, nil
local accept = bot.acceptChallenge
bot.acceptChallenge = function(self, senderId, gameModeId)
  if oppId and senderId == oppId then return accept(self, senderId, gameModeId) end
end
-- garbage cells, both ways, this match
local sent, received = 0, 0
local ship = bot._shipGarbageEvent
bot._shipGarbageEvent = function(self, body)
  for _, g in ipairs(body.garbage or {}) do sent = sent + (g.width or 6) * (g.height or 1) end
  return ship(self, body)
end

local function playerCount() local n = 0; for _ in pairs(bot.players or {}) do n = n + 1 end; return n end
local FRAME = 1 / 60

local function nextMatch()
  opp = tonumber(sh("next")); oppName = "isl2b" .. opp; oppId = nil
  sent, received = 0, 0
  print(NAME .. ": next is " .. oppName)
end
local function finish(res)
  local line = sh("after " .. opp .. " " .. quote(dkjson.encode(res)))
  print(NAME .. " vs " .. oppName .. ": " .. line)
  -- back to the lobby, clear for the next match
  bot:leaveRoom()
  bot.match, bot.matchStart, bot.matchEnded = nil, nil, false
  bot.oppDied, bot.outcome, bot._resultReported, bot.deathSent = false, nil, false, false
  bot.capture, bot.myStack = nil, nil
  local t0 = socket.gettime()
  while socket.gettime() < t0 + 2 do bot:pump(); socket.sleep(0.01) end
end

nextMatch()
local waitFrom, lastChallengeAt, lastReadyAt, nextFrame, lateBefore = socket.gettime(), 0, 0, nil, 0
while true do
  bot:pump()
  local now = socket.gettime()
  if not bot.match then
    if now > STOP_AT then print(NAME .. ": stopping"); bot:disconnect(); os.exit(0) end
    if now - waitFrom > PATIENCE then
      finish({ played = false, why = "no match in " .. PATIENCE .. "s" })
      nextMatch(); waitFrom = socket.gettime()
    end
    if not bot.inRoom and bot.lobby and bot.lobby.players then
      for _, p in pairs(bot.lobby.players) do
        if p.name == oppName then
          oppId = p.publicId
          if p.state == "lobby" and now - lastChallengeAt > 3 then
            lastChallengeAt = now
            bot.gameplay:sendRequest(ClientProtocol.updateChallengeStatus(bot.publicId, p.publicId, GameModes.IDs.TWO_PLAYER_VS, true))
          end
        end
      end
    end
    if not bot.matchStart and playerCount() >= 2 and now - lastReadyAt > 1.5 then bot:sendReady(); lastReadyAt = now end
    if bot.matchStart then
      bot:startMatch()
      local apply = bot.myStack.applyNetworkGarbage
      bot.myStack.applyNetworkGarbage = function(self, garbage, sender)
        for _, g in ipairs(garbage or {}) do received = received + (g.width or 6) * (g.height or 1) end
        return apply(self, garbage, sender)
      end
      nextFrame = bot.scheduledStartMs / 1000
      lateBefore = bot.survival and bot.survival.late or 0
      print(NAME .. " vs " .. oppName .. ": match starting")
    end
  else
    while now >= nextFrame and not bot.matchEnded and bot.myStack.clock < FRAMES do
      bot:tickMatch()
      nextFrame = nextFrame + FRAME
      now = socket.gettime()
    end
    if bot.matchEnded or bot.myStack.clock >= FRAMES then
      if not bot.matchEnded then
        -- the ceiling: both alive
        local t0 = socket.gettime()
        while socket.gettime() < t0 + 1 do bot:pump(); socket.sleep(0.01) end
      end
      local late = (bot.survival and bot.survival.late or 0) - lateBefore
      finish({ played = true, outcome = bot.matchEnded and bot.outcome or "ceiling", frames = bot.myStack.clock,
               sent = sent, received = received, late = late })
      nextMatch(); waitFrom, lastReadyAt, nextFrame = socket.gettime(), 0, nil
    end
  end
  socket.sleep(0.002)
end
