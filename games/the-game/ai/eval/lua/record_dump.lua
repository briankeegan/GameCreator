-- THE SERVER'S STACK AS DATA: every scalar field of the stack, every field of
-- every panel, both garbage queues, the swap-stall log. engineRecord.lua and
-- drill.lua write the stack with this.
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

return { enc = enc, dump = dump }
