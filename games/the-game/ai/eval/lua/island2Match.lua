-- ONE ISLAND 2.0 MATCH ON THE LIVE SERVER.
--
--   (in a panel-game checkout with bot/BotClient.lua and bot/SurvivalLink.lua,
--    its LUA_PATH set, survivor.js listening on PA_SURVIVOR_PORT)
--   luajit .../lua/island2Match.lua HOST PORT NAME OPPONENT [FRAMES] [WAIT_SECS]
--
-- Logs in as NAME, challenges OPPONENT whenever both are in the lobby (the
-- server opens a private room once both challenge), and accepts a challenge
-- from OPPONENT only. Plays ONE match as WasmSurvivor (brain "survival"):
-- until a side dies or the stack's clock reaches FRAMES (default 21600, six
-- minutes), then leaves. Gives up after WAIT_SECS (default 900) without a
-- match. Prints one line:
--   RESULT {"played":true,"outcome":"won"|"lost"|"ceiling","frames":N,
--           "sent":cells,"received":cells,"late":frames the link waited out}
-- or RESULT {"played":false,...} when no match was had.
io.stdout:setvbuf("no")
require("bot.headlessBoot")
do local l = require("common.lib.logger"); l.setLogLevel(l.levels.WARN) end
local socket = require("socket")
local json = require("common.lib.dkjson")
local BotClient = require("bot.BotClient")
local ClientProtocol = require("common.network.ClientProtocol")
local GameModes = require("common.data.GameModes")

local HOST, PORT, NAME, OPP = arg[1], tonumber(arg[2]), arg[3], arg[4]
local FRAMES = tonumber(arg[5]) or 21600
local WAIT_SECS = tonumber(arg[6]) or 900
assert(HOST and PORT and NAME and OPP, "usage: island2Match.lua HOST PORT NAME OPPONENT [FRAMES] [WAIT_SECS]")

local function result(t) print("RESULT " .. json.encode(t)); os.exit(0) end

local bot = BotClient({ ip = HOST, port = PORT, name = NAME, brain = "survival",
                        cursorSpeed = { cursorMoveInterval = 4, reactionFrames = 12 } })
if not bot:login() then result({ played = false, why = "login" }) end
bot:leaveRoom()

-- THE OPPONENT ONLY: a challenge from anyone else is left unanswered.
local oppId = nil
local accept = bot.acceptChallenge
bot.acceptChallenge = function(self, senderId, gameModeId)
  if oppId and senderId == oppId then return accept(self, senderId, gameModeId) end
end

-- garbage cells, both ways
local sent, received = 0, 0
local ship = bot._shipGarbageEvent
bot._shipGarbageEvent = function(self, body)
  for _, g in ipairs(body.garbage or {}) do sent = sent + (g.width or 6) * (g.height or 1) end
  return ship(self, body)
end

local lastChallengeAt, lastReadyAt, started = 0, 0, socket.gettime()
local function playerCount() local n = 0; for _ in pairs(bot.players or {}) do n = n + 1 end; return n end
local FRAME, nextFrame = 1 / 60, nil

while true do
  bot:pump()
  local now = socket.gettime()
  if not bot.match and now - started > WAIT_SECS then bot:disconnect(); result({ played = false, why = "no match" }) end
  -- find the opponent and challenge it while both are free
  if not bot.inRoom and not bot.match and bot.lobby and bot.lobby.players then
    for _, p in pairs(bot.lobby.players) do
      if p.name == OPP then
        oppId = p.publicId
        if p.state == "lobby" and now - lastChallengeAt > 3 then
          lastChallengeAt = now
          bot.gameplay:sendRequest(ClientProtocol.updateChallengeStatus(bot.publicId, p.publicId, GameModes.IDs.TWO_PLAYER_VS, true))
        end
      end
    end
  end
  if not bot.match and not bot.matchStart and playerCount() >= 2 and now - lastReadyAt > 1.5 then
    bot:sendReady(); lastReadyAt = now
  end
  if bot.matchStart and not bot.match then
    bot:startMatch()
    local apply = bot.myStack.applyNetworkGarbage
    bot.myStack.applyNetworkGarbage = function(self, garbage, sender)
      for _, g in ipairs(garbage or {}) do received = received + (g.width or 6) * (g.height or 1) end
      return apply(self, garbage, sender)
    end
    nextFrame = bot.scheduledStartMs / 1000
  end
  if bot.match and nextFrame then
    while now >= nextFrame and not bot.matchEnded do
      bot:tickMatch()
      nextFrame = nextFrame + FRAME
      now = socket.gettime()
      if bot.myStack.clock >= FRAMES then break end
    end
    local late = bot.survival and bot.survival.late or 0
    if bot.matchEnded then
      local t0 = socket.gettime()
      while socket.gettime() < t0 + 1 do bot:pump(); socket.sleep(0.01) end
      bot:disconnect()
      result({ played = true, outcome = bot.outcome, frames = bot.myStack.clock, sent = sent, received = received, late = late })
    end
    if bot.myStack.clock >= FRAMES then
      bot:disconnect()
      result({ played = true, outcome = "ceiling", frames = bot.myStack.clock, sent = sent, received = received, late = late })
    end
  end
  socket.sleep(0.002)
end
