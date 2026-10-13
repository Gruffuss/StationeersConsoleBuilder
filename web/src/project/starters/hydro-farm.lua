-- Hydro farm: what the panels cannot say (docs/templates-power-farm.md, "Custom Lua"). The roles find the Larre dock, the
-- export bin and the grow lights; the rules drive the lights and the bin door; the states hold the settings, the plant,
-- the light mode and Pause. This block runs the light day, the Larre harvester and the pot record, and sends what the
-- screen shows as X.<name>, bound in the Data tab. Settings are read from S as they change.
local fmt, floor, max, min = string.format, math.floor, math.max, math.min

-- In the game's dial order: name, produce hash (also its icon), schedule group. Index 8 and up is perennial.
local PLANTS = {
  { "Potato", 1929046963, "Long" }, { "Wheat", -1057658015, "Long" }, { "Rice", 658916791, "Long" },
  { "Soybean", 1924673028, "Long" }, { "Corn", 258339687, "Short" }, { "Mushroom", 2044798572, "Mush" },
  { "Alien mushroom", 176446172, "Mush" }, { "Tomato", -998592080, "Short" }, { "Pumpkin", 1277828144, "Short" },
  { "Fern", 892110467, "Short" }, { "Darga fern", 266654416, "Long" }, { "Peace lily", 2042955224, "Long" },
  { "Tropical lily", -800947386, "Long" }, { "Winterspawn A", 851290561, "Long" }, { "Winterspawn B", -1414203269, "Long" },
  { "Hades flower A", -177792789, "Long" }, { "Hades flower B", 1819167057, "Long" },
}
local BY_HASH = {}
for k, p in ipairs(PLANTS) do BY_HASH[p[2]] = p[1]; p.perennial = k >= 8 end
local HOME, HYDRO_TRAY, POTS = 0, 1464854517, 90
local json = util and util.json

local function plant() return PLANTS[S.plant] or PLANTS[1] end
local function lengths(g) return S["light" .. g] or 0, S["dark" .. g] or 0 end

-- What the Larre holds: produce by the plant table, a seed bag as "<plant> seeds", anything else by its prefab name.
local function itemName(h)
  if BY_HASH[h] then return BY_HASH[h] end
  local ok, p = pcall(function() return prefab_name and prefab_name(h) end)
  if not ok or type(p) ~= "string" or p == "" then return "Unknown" end
  local seed = p:match("^SeedBag_(.+)$")
  local base = (seed or p:gsub("^Item", "")):gsub("_", " "):gsub("(%l)(%u)", "%1 %2")
  base = base:sub(1, 1):upper() .. base:sub(2):lower()
  return seed and (base .. " seeds") or base
end

-- ── the light day: light then dark, lengths from the plant's group, read only when a day starts
local LC = { phase = "dark", left = 0, len = 0, light = 0, dark = 0 }
local function newDay()
  LC.light, LC.dark = lengths(plant()[3])
  if LC.light > 0 then LC.phase, LC.len = "light", LC.light else LC.phase, LC.len = "dark", LC.dark end
  LC.left = LC.len
end
local function endPhase()
  if LC.phase == "light" then LC.phase, LC.len = "dark", LC.dark; LC.left = LC.len else newDay() end
end

-- ── the harvester: one Larre command per state, the next state once the Larre reads Idle
local clock = 0
local H = { state = "start", wait = false, pot = 2, mode = 0, status = "Idle", pass = 1, passT0 = 0, harvests = 0 }
local allTime, lastPass = 0, nil
local growth, seen, cond = {}, {}, {}        -- per pot: last Growth, the pass it was read in, 0 empty 1 healthy 2 slow 3 damaged
local plantPot, potPlant = {}, {}            -- which plant (its ReferenceId) stands in which pot
local binT, heldHash, heldName = 0, nil, nil
local reqHome, reqDump = false, false

local function larre(lt) return rd("larre", lt) end
local function hand(lst) return rds("larre", 0, lst) end
local function tray(lst) return rds("larre", 255, lst) end   -- the tray under the Larre; nil where the proxy refuses
local function ready() return H.mode == 1 and S.per or S.ann end

local function condition()
  if (tray("Occupied") or 0) == 0 then return 0 end
  local h, e = tray("Health"), tray("Efficiency")
  if h and h < 0.999 then return 3 end
  if e and e < 1 then return 2 end
  return 1
end
local function note(k)
  local g = tray("Growth")
  if k >= 1 and k <= POTS and g then growth[k], seen[k], cond[k] = g, H.pass, condition() end
end
local function overTray() return larre("TargetPrefabHash") == HYDRO_TRAY end
local function learn(k)
  if k < 1 or k > POTS or not overTray() then return end
  local id = tray("ReferenceId")
  if not id then return end
  if potPlant[k] and potPlant[k] ~= id then plantPot[potPlant[k]] = nil end
  if id ~= 0 then plantPot[id] = k end
  potPlant[k] = id
end
local function record() local k = H.pot - S.first + 1; note(k); learn(k) end

local function go(station, status, after)
  wrf("larre", "Setting", station)
  H.wait, H.status, H.step, H.state, H.cmd = true, status, H.state, after, station
end
local function atStation(at)
  if larre("PositionX") == at then return true end
  go(at, "Moving", H.state)
  return false
end
local function act(status, after, at)
  if at and not atStation(at) then return end
  wrf("larre", "Activate", 1)
  H.wait, H.status, H.step, H.state, H.cmd = true, status, H.state, after, "act"
end

local RUN, STATS = "run", "stats"
local canRun, canStats, runSent = true, true, nil
local function saveStats()
  if canStats and json then persist.set(STATS, json.encode({ all = allTime, lastpass = lastPass })) end
end
-- Counted at the bin: what the hand drops is the yield. Only produce counts; seeds go back in.
local function dumpAct(after)
  if not atStation(S.dump) then return end
  if BY_HASH[hand("OccupantHash")] and not H.recounted then
    local q = hand("Quantity") or 1
    H.harvests, allTime = H.harvests + q, allTime + q
    saveStats()
  end
  act("Dumping", after)
end

local STATES = {
  start = function()
    if (hand("Occupied") or 0) ~= 0 then go(S.dump, "Dumping", "dump_act") else go(H.pot, "Moving", "check") end
  end,
  dump_act = function() dumpAct("start") end,
  check = function()
    local g = tray("Growth")
    record()
    if g == ready() then
      H.lastH = clock
      act("Harvesting", H.mode == 1 and "per_check" or "ann_check", H.pot)
    else
      H.state = "next"
    end
  end,
  per_check = function()
    local g = tray("Growth")
    record()
    if g == ready() then act("Harvesting", "per_check", H.pot) else H.state = "next" end
  end,
  ann_check = function()
    if (tray("Occupied") or 0) == 0 or tray("Seeding") == -1 then go(S.dump, "Dumping", "ann_dump")
    else act("Harvesting", "ann_check", H.pot) end
  end,
  ann_dump = function() dumpAct("ann_back") end,
  ann_back = function() go(H.pot, "Moving", "ann_replant") end,
  ann_replant = function()
    record()
    if (tray("Occupied") or 0) == 0 then act("Replanting", "next", H.pot) else H.state = "next" end
  end,
  ["next"] = function()
    record()
    H.pot = H.pot + 1
    if H.pot > S.last then go(HOME, "Going home", "home_done") else H.state = "start" end
  end,
  home_done = function()
    if H.pot > S.last then lastPass = clock - H.passT0; saveStats() end
    H.mode = plant().perennial and 1 or 0
    H.pot, H.pass, H.passT0, H.harvests = S.first, H.pass + 1, clock, 0
    H.status, H.state = "Idle", "start"
  end,
  dn_act = function() dumpAct("dn_back") end,
  dn_back = function() go(H.pot, "Moving", H.resume) end,
}
local DUMPABLE = { start = true, check = true, per_check = true, ann_check = true, ann_replant = true, ["next"] = true }
local DUMP_NEXT = { dump_act = "start", ann_dump = "ann_back", dn_act = "dn_back" }

-- After a reload, once the Larre is Idle the step that sent the last command runs again; a Larre still busy after 20
-- ticks is nudged once with that command.
local function recover()
  if (larre("Idle") or 0) == 0 then
    H.recoverN = (H.recoverN or 0) + 1
    if H.recoverN == 20 then
      if H.cmd == "act" then wrf("larre", "Activate", 1) elseif type(H.cmd) == "number" then wrf("larre", "Setting", H.cmd) end
    end
    H.status = "Recovering"
    return false
  end
  H.recover, H.wait = false, false
  local st = STATES[H.step] and H.step or H.state
  if DUMP_NEXT[st] then
    if BY_HASH[hand("OccupantHash")] then H.recounted = true else st = DUMP_NEXT[st] end
  end
  H.state = st
  return true
end

local function harvest()
  if not R.larre.ok then H.status = "--"; return end
  if H.recover and not recover() then return end
  if H.wait then
    if (larre("Idle") or 0) == 0 then return end
    if type(H.cmd) == "number" and larre("PositionX") ~= H.cmd then H.status = "Blocked"; return end
    H.wait = false
  end
  if reqHome then reqHome = false; go(HOME, "Going home", "home_done"); return end
  if reqDump then
    reqDump = false
    if DUMPABLE[H.state] then H.resume = H.state; go(S.dump, "Dumping", "dn_act"); return end
  end
  if S.paused then H.status = "Paused"; return end
  for _ = 1, 8 do
    STATES[H.state]()
    H.recounted = nil
    if H.wait then return end
  end
end

-- In transit the Larre reads the tray it passes over; the plant's id says which pot it is.
local function readPassing()
  if not R.larre.ok or larre("PositionX") ~= -1 or not overTray() then return end
  local k = plantPot[tray("ReferenceId") or 0]
  if k then note(k) end
end

-- ── the saved run: the step and pot, the pot record, the light day and the bin timer, as ages
local function saveRun()
  if not canRun or not json then return end
  local g, s, c, ids = {}, {}, {}, {}
  for k = 1, POTS do g[k] = growth[k] or -1; s[k] = seen[k] or 0; c[k] = cond[k] or 0; ids[k] = potPlant[k] or 0 end
  local b = json.encode({ state = H.state, step = H.step or "", wait = H.wait, cmd = H.cmd or "", pot = H.pot, mode = H.mode,
    resume = H.resume or "", pass = H.pass, passAge = clock - H.passT0, harvests = H.harvests,
    hAge = H.lastH and (clock - H.lastH) or -1, g = g, s = s, c = c, ids = ids, bin = binT,
    lc = { phase = LC.phase, left = LC.left, len = LC.len, light = LC.light, dark = LC.dark } })
  if b ~= runSent then persist.set(RUN, b); runSent = b end
end
local function num(v, d) return type(v) == "number" and v or d end
local function load(key)
  local text = persist.get(key)
  if text == nil or not json then return nil, true end
  local ok, v = pcall(json.decode, text)
  if ok and type(v) == "table" then return v, true end
  return nil, false   -- present but unreadable: never overwrite it
end

function U.init()
  X.phaseBar, X.potCur = 0, -1   -- geometry has a value from the first frame
  H.pot, H.mode = S.first, plant().perennial and 1 or 0
  local st
  st, canStats = load(STATS)
  if st then allTime, lastPass = num(st.all, 0), num(st.lastpass, nil) end
  local r
  r, canRun = load(RUN)
  local lc = r and r.lc
  if type(lc) == "table" and (lc.phase == "light" or lc.phase == "dark") then
    LC.phase, LC.left, LC.len, LC.light, LC.dark = lc.phase, num(lc.left, 0), num(lc.len, 0), num(lc.light, 0), num(lc.dark, 0)
  else
    newDay()
  end
  if not r or not STATES[r.state] then return end
  H.state, H.wait = r.state, r.wait == true
  if r.cmd == "act" or type(r.cmd) == "number" then H.cmd = r.cmd end
  H.step = STATES[r.step] and r.step or nil
  H.recover = H.wait
  H.pot, H.mode, H.pass, H.harvests = num(r.pot, H.pot), num(r.mode, H.mode), num(r.pass, 1), num(r.harvests, 0)
  H.passT0 = -num(r.passAge, 0)
  if num(r.hAge, -1) >= 0 then H.lastH = -r.hAge end
  H.resume = STATES[r.resume] and r.resume or nil
  binT = num(r.bin, 0)
  if type(r.g) == "table" and type(r.s) == "table" then
    for k = 1, POTS do
      if type(r.g[k]) == "number" and r.g[k] >= 0 then growth[k] = r.g[k] end
      if type(r.s[k]) == "number" and r.s[k] > 0 then seen[k] = r.s[k] end
      local c = type(r.c) == "table" and r.c[k]
      if c == 1 or c == 2 or c == 3 then cond[k] = c end
      local id = type(r.ids) == "table" and r.ids[k]
      if type(id) == "number" and id ~= 0 then plantPot[id], potPlant[k] = k, id end
    end
  end
end

local function mmss(s)
  if s == nil then return "--" end
  s = max(0, floor(s + 0.5))
  return fmt("%d:%02d", floor(s / 60), s % 60)
end
local function thousands(n)
  local s = tostring(floor(n)):reverse():gsub("(%d%d%d)", "%1 "):reverse()
  return (s:gsub("^ ", ""))
end

function U.after_reads(P, S, dt)
  dt = dt or 0.5
  clock = clock + dt
  if C.skip then endPhase() end
  if C.home then reqHome = true end
  if C.dump then reqDump = true end
  LC.left = LC.left - dt
  if LC.left <= 0 then endPhase() end
  local day = LC.phase == "light"
  X.lightPhase = day and 1 or 0                 -- the lights' rule reads it in Auto

  harvest()
  readPassing()
  local h = (hand("Occupied") or 0) ~= 0 and hand("OccupantHash")
  if R.larre.ok and h and h ~= 0 then
    if h ~= heldHash then heldHash, heldName = h, itemName(h) end
  else
    heldHash, heldName = nil, nil
  end
  local occupied                                -- nil without a bin or a reading
  if R.bin.ok and P.binOcc ~= nil then
    occupied = P.binOcc ~= 0
    binT = occupied and binT + dt or 0
  end
  saveRun()

  -- Light cycle
  X.hero, X.phaseBar = mmss(LC.left), LC.len > 0 and (1 - LC.left / LC.len) or 0
  X.phase, X.phaseSt = day and "Day" or "Night", day and 1 or 0
  X.phaseLen = "left of " .. mmss(LC.len)
  X.split = fmt("%.0f / %.0f s", LC.light, LC.dark)
  local on, power = 0, 0
  for k = 1, R.lights.n or 0 do
    if (P.lightOn and P.lightOn[k] or 0) ~= 0 then on, power = on + 1, power + (P.lightPower and P.lightPower[k] or 0) end
  end
  X.lightsOn = fmt("%.0f    %.1f kW", on, power / 1000)
  X.skip = day and 0 or 1

  -- Plant
  local pl = plant()
  X.plantIcon, X.plantName = tostring(pl[2]), pl[1]
  X.plantType = pl.perennial and "Perennial" or "Annual"
  X.thisPass = H.mode == 1 and "Perennial" or "Annual"
  X.nextPass = X.plantType

  -- Larre: an error or no power overrides the step it is on
  local st, sl = H.status, 1
  if not R.larre.ok then st, sl = "--", 0
  elseif (P.larreErr or 0) ~= 0 then st, sl = "Error", 3
  elseif (P.larrePower or 1) == 0 then st, sl = "No power", 0
  elseif st == "Paused" or st == "Idle" or st == "--" then sl = 0 end
  X.larre, X.larreSt = st, sl
  local npots = max(0, S.last - S.first + 1)
  X.pot = fmt("%.0f of %.0f", min(max(H.pot - S.first + 1, 1), max(npots, 1)), npots)
  X.holding, X.heldIcon = heldName or "Empty", heldHash and fmt("%.0f", heldHash) or ""

  -- Export bin
  local warned = occupied and binT >= S.binwarn * 60
  X.binContents = occupied == nil and "--" or (occupied and "Occupied" or "Empty")
  X.binSt = warned and 2 or (occupied and 0 or 1)
  X.door = (not R.bin.ok or P.binOpen == nil) and "--" or (P.binOpen ~= 0 and "Open" or "Closed")
  X.occupiedFor, X.occupiedSt = mmss(occupied and binT or 0) .. " min", warned and 2 or 1
  X.binAlert, X.binMsg = warned and 2 or 0, warned and fmt("Export bin full for %.0f min", floor(binT / 60)) or ""

  -- Harvest
  X.hPass, X.hAll = fmt("%.0f", H.harvests), thousands(allTime)
  X.hLast = mmss(lastPass) .. " min"
  X.hAgo = (H.lastH and mmss(clock - H.lastH) or "--") .. " ago"

  -- Pots: fill = growth / ready, state = condition; a pot not visited this pass at 35 % (faded by 0.65), as the script
  -- draws it: its value is from the pass before
  local n, r = max(0, min(npots, POTS)), ready()
  local g, ps, fade, bad, slow = {}, {}, {}, 0, 0
  for k = 1, max(n, 1) do
    g[k] = r > 0 and min((growth[k] or 0) / r, 1) or 0
    local c = cond[k] or 0
    ps[k], fade[k] = c, seen[k] == H.pass and 0 or 0.65
    if k <= n and c == 3 then bad = bad + 1 end
    if k <= n and c == 2 then slow = slow + 1 end
  end
  X.potN, X.potG, X.potSt, X.potFade = n, g, ps, fade
  local cur = H.pot - S.first
  X.potCur = (cur >= 0 and cur < n) and cur or -1

  -- Header counts
  X.nwarn = (warned and 1 or 0) + (slow > 0 and 1 or 0)
  X.ncrit = ((sl == 3 or st == "No power") and 1 or 0) + (bad > 0 and 1 or 0)
end
