-- ONE ISLAND 2.0 BOT ON THE LIVE SERVER, match after match.
--
--   (in a panel-game checkout with bot/BotClient.lua and bot/SurvivalLink.lua,
--    its LUA_PATH set, survivor.js listening on PA_SURVIVOR_PORT with
--    GC_SURVIVOR_RELOAD=1)
--   luajit .../lua/island2Bot.lua HOST PORT N STOP_AT
--
-- Logs in once as isl2b<N> and stays. While free it challenges the free
-- isl2b bot it has played least (`island2.sh played`; the lowest number on a
-- tie) and accepts a challenge from any isl2b bot -- the server opens a
-- private room once both challenge. It plays as WasmSurvivor
-- (brain "survival") until a side dies or the stack's clock reaches 21600
-- (six minutes), leaves the room, and hands the result to `island2.sh after`,
-- which records it (a loss moves this bot's weights toward the winner's) and
-- rewrites the profile survivor.js reads at the next match. No match starts
-- after STOP_AT (epoch seconds).
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
local NAME, FRAMES = "isl2b" .. N, 21600
local SH = os.getenv("ISLAND2_SH")   -- island2.sh, for `played` and `after`

local function sh(args)
  local p = io.popen("bash " .. SH .. " " .. args)
  local out = p:read("*a"); p:close()
  return (out or ""):match("^(.-)%s*$")
end
local function quote(s) return "'" .. s:gsub("'", "'\\''") .. "'" end

local bot = BotClient({ ip = HOST, port = PORT, name = NAME, brain = "survival",
                        cursorSpeed = { cursorMoveInterval = 4, reactionFrames = 12 } })
if not bot:login() then print(NAME .. ": login failed"); os.exit(1) end
bot:leaveRoom()
print(NAME .. ": in the lobby on " .. HOST .. ":" .. PORT)

-- the other isl2b bots: a challenge from one is answered, from anyone else not
local function islandOf(name) local q = name and name:match("^isl2b(%d+)$"); return q and tonumber(q) end
local function lobbyName(id)
  for _, p in pairs(bot.lobby and bot.lobby.players or {}) do if p.publicId == id then return p.name end end
end
local accept = bot.acceptChallenge
bot.acceptChallenge = function(self, senderId, gameModeId)
  local q = islandOf(lobbyName(senderId))
  if q and q ~= N then return accept(self, senderId, gameModeId) end
end
local opp, oppName = nil, nil   -- this match's opponent, read from the room
-- garbage cells, both ways, this match
local sent, received = 0, 0
local ship = bot._shipGarbageEvent
bot._shipGarbageEvent = function(self, body)
  for _, g in ipairs(body.garbage or {}) do sent = sent + (g.width or 6) * (g.height or 1) end
  return ship(self, body)
end

-- A death relayed while no match is being played is the last match's.
local dispatch = bot.dispatch
bot.dispatch = function(self, msg)
  if msg[require("common.network.NetworkProtocol").serverMessageTypes.deathEvent.prefix] and not self.match then return end
  return dispatch(self, msg)
end
-- WHAT KEPT IT ALIVE, topped out: each frame the stack is topped out and
-- alive, why its health did not drain (stop time, garbage shake, a rise lock
-- held by swaps alone, or other activity), and the lowest health it had.
local top
local function topReset() top = { frames = 0, longest = 0, run = 0, stop = 0, shake = 0, swapLock = 0, active = 0, minHealth = 99, deadHealth = 0 } end
topReset()
local function topCount(st)
  if not (st:isToppedOut() or st.wasToppedOut) or st:game_ended() then top.run = 0; return end
  top.frames = top.frames + 1; top.run = top.run + 1
  if top.run > top.longest then top.longest = top.run end
  if st.health < top.minHealth then top.minHealth = st.health end
  if st.health <= 0 then top.deadHealth = top.deadHealth + 1 end
  if st.stop_time > 0 or st.pre_stop_time > 0 then top.stop = top.stop + 1
  elseif st.shake_time > 0 then top.shake = top.shake + 1
  elseif st.rise_lock and (st.n_active_panels or 0) - (st.swappingPanelCount or 0) == 0 then top.swapLock = top.swapLock + 1
  elseif st.rise_lock then top.active = top.active + 1 end
end
local pressed = 0   -- swaps and raises pressed this match
local function playerCount() local n = 0; for _ in pairs(bot.players or {}) do n = n + 1 end; return n end
local FRAME = 1 / 60

-- matches played against each other bot, from this bot's file
local played = {}
local function loadPlayed()
  played = {}
  for q, c in sh("played"):gmatch("(%d+):(%d+)") do played[tonumber(q)] = tonumber(c) end
end
-- Each match gets a link of its own: answers still in flight on the old one
-- would be read as the new match's and put every answer a frame behind.
local function closeLink()
  local link = bot.survival
  if not link then return end
  link:endMatch()
  if link.sock then pcall(function() link.sock:close() end) end
  bot.survival = nil
end
local function finish(res)
  -- the death notice goes out before anything slow (BotClient retries it from pump)
  local t0 = socket.gettime()
  while bot._deathAwaitingFlush and socket.gettime() < t0 + 5 do bot:pump(); socket.sleep(0.01) end
  closeLink()
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

loadPlayed()
local lastChallengeAt, lastReadyAt, nextFrame, lateBefore, target, roomSince = 0, 0, nil, 0, nil, nil
while true do
  bot:pump()
  local now = socket.gettime()
  if not bot.match then
    if now > STOP_AT then print(NAME .. ": stopping"); bot:disconnect(); os.exit(0) end
    if not bot.inRoom and bot.lobby and bot.lobby.players and now - lastChallengeAt > 3 then
      -- the free isl2b bot played least, lowest number on a tie
      local best, bestId, bestCount = nil, nil, nil
      for _, p in pairs(bot.lobby.players) do
        local q = islandOf(p.name)
        if q and q ~= N and p.state == "lobby" then
          local c = played[q] or 0
          if not best or c < bestCount or (c == bestCount and q < best) then best, bestId, bestCount = q, p.publicId, c end
        end
      end
      if best then
        lastChallengeAt = now
        if best ~= target then target = best; print(NAME .. ": challenging isl2b" .. best .. " (played " .. bestCount .. ")") end
        bot.gameplay:sendRequest(ClientProtocol.updateChallengeStatus(bot.publicId, bestId, GameModes.IDs.TWO_PLAYER_VS, true))
      end
    end
    if not bot.matchStart and playerCount() >= 2 and now - lastReadyAt > 1.5 then bot:sendReady(); lastReadyAt = now end
    -- a room no match starts in is left after 30 s
    if bot.inRoom and not bot.matchStart then
      roomSince = roomSince or now
      if now - roomSince > 30 then print(NAME .. ": no match in 30 s, leaving the room"); bot:leaveRoom(); roomSince = nil end
    else roomSince = nil end
    if bot.matchStart then
      bot.oppDied, bot.outcome = false, nil
      bot:startMatch()
      topReset()
      opp, oppName = nil, nil
      for _, p in pairs(bot.players or {}) do if p.name ~= NAME and islandOf(p.name) then opp, oppName = islandOf(p.name), p.name end end
      sent, received = 0, 0
      local apply = bot.myStack.applyNetworkGarbage
      bot.myStack.applyNetworkGarbage = function(self, garbage, sender)
        for _, g in ipairs(garbage or {}) do received = received + (g.width or 6) * (g.height or 1) end
        return apply(self, garbage, sender)
      end
      nextFrame = bot.scheduledStartMs / 1000
      lateBefore = bot.survival and bot.survival.late or 0
      pressed = 0
      print(NAME .. " vs " .. tostring(oppName) .. ": match starting")
    end
  else
    while now >= nextFrame and not bot.matchEnded and bot.myStack.clock < FRAMES do
      bot:tickMatch()
      topCount(bot.myStack)
      local k = bot.lastExecuted and bot.lastExecuted.type
      if k == "SWAP" or k == "RAISE" then pressed = pressed + 1 end
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
      local res = { played = true, outcome = bot.matchEnded and bot.outcome or "ceiling", frames = bot.myStack.clock,
                    sent = sent, received = received, late = late, topped = top, pressed = pressed }
      if opp then finish(res) else print(NAME .. ": a match against no isl2b bot, not recorded"); closeLink(); bot:leaveRoom() end
      loadPlayed(); target, lastReadyAt, nextFrame = nil, 0, nil
    end
  end
  socket.sleep(0.002)
end
