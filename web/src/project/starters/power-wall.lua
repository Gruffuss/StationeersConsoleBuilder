-- Power wall: what the panels cannot say (docs/templates-power-farm.md, "Custom Lua"). The roles find the devices, the
-- reads total them, the rules drive the generators, the vent and the tracked panels; this block groups the solar panels
-- by type, lists the battery cells and types, names the generators, works out the coal energy, the sun and the times,
-- and keeps the day totals. Everything it shows goes out as X.<name>, bound in the Data tab.
local fmt, floor, min, max, abs = string.format, math.floor, math.min, math.max, math.abs
local MINUS, DEG = "−", "°"   -- the true minus (U+2212) and the degree sign, as characters: a Lua-CSharp string is UTF-16

-- Solar panel prefabs and their row names, in the order rows are listed.
local PANELS = {
  { -2045627372, "Standard" }, { -934345724, "Heavy" }, { -539224550, "Dual" }, { -1545574413, "Heavy dual" },
  { 1968102968, "Flat" }, { 1697196770, "Heavy flat" }, { -1554349863, "Angled" }, { 930865127, "Heavy angled" },
  { -295209029, "1x5" }, { -2049226859, "Heavy 1x5" }, { 939649277, "Dual 1x5" }, { 1945473703, "Heavy dual 1x5" },
}
local PANEL_AT = {}
for k, p in ipairs(PANELS) do PANEL_AT[p[1]] = k end
local BATTERIES = { { -400115994, "Station battery" }, { -1388288459, "Large station battery" } }
local BATTERY_AT = { [-400115994] = 1, [-1388288459] = 2 }
-- Joules per item burned in the solid fuel generator: Charcoal, Coal ore, Solid fuel.
local FUEL_J = { [252561409] = 20e3, [1724793494] = 100e3, [-365253871] = 200e3 }
-- Logic Extended types, by number: 0..100 efficiency (includes damage), 0..1 damage.
local EFFICIENCY, DAMAGE = 1224, 1221

local function f1(v) return v and fmt("%.1f", v) or "--" end
-- A duration in hours, in minutes below one hour.
local function dur(hours)
  if hours == nil then return "--" end
  if hours < 1 then return f1(hours * 60) .. " min" end
  return f1(hours) .. " h"
end
-- Signed with a true minus; "+" only where asked.
local function signed(v, plus)
  if v == nil then return "--" end
  local s = fmt("%.1f", abs(v))
  if s == "0.0" then return s end
  if v < 0 then return MINUS .. s end
  return plus and ("+" .. s) or s
end

-- Day totals in joules: today's and yesterday's, kept through a reload under this block's own key.
local KEY = "days"
local today, yday, day, canSave, ticks = { solar = 0, coal = 0, used = 0 }, nil, nil, true, 0
local json = util and util.json
local function gameDay()
  local f = util and util.days_past
  if not f then return nil end
  local ok, d = pcall(f)
  if ok and type(d) == "number" then return d end
end
local function save()
  if canSave and json and day then persist.set(KEY, json.encode({ day = day, today = today, yday = yday })) end
end

function U.init()
  X.sunf, X.sunSt = 0, 0   -- the dial's needle has a value from the first frame
  day = gameDay()
  local text = persist.get(KEY)
  if text == nil or not json then return end
  local ok, d = pcall(json.decode, text)
  if not ok or type(d) ~= "table" then canSave = false return end   -- present but unreadable: never overwrite it
  if type(d.today) == "table" and day then
    if d.day == day then
      today = { solar = d.today.solar or 0, coal = d.today.coal or 0, used = d.today.used or 0 }
      yday = type(d.yday) == "table" and d.yday or nil
    elseif d.day == day - 1 then
      yday = d.today
    end
  end
end

local function sun(P)
  local tod, len = P.tod, P.dayLen
  if not tod or not len or len <= 0 then
    X.sunf, X.sunSt, X.sunAngle, X.sunset, X.sunrise, X.night = 0, 0, "--", "--", "--", "--"
    return
  end
  tod = tod % 1
  local isDay = tod < 0.5
  local f = isDay and tod / 0.5 or 0
  local g = isDay and f or (tod - 0.5) / 0.5
  local angle = floor(180 * min(g, 1 - g) + 0.5)
  X.sunf, X.sunSt = f, isDay and 1 or 0
  X.sunAngle = ((not isDay and angle > 0) and MINUS or "") .. angle .. DEG
  X.sunset = f1(((isDay and 0.5 or 1.5) - tod) * len / 60) .. " min"
  X.sunrise = f1((1 - tod) * len / 60) .. " min"
  X.night = f1(0.5 * len / 60) .. " min"
end

function U.after_reads(P, S, dt)
  dt = dt or 0.5
  ticks = ticks + 1
  local using = P.using and P.using[1]
  local net = using and ((P.solar or 0) + (P.coal or 0) - using) or nil

  -- Storage: status, net, time left or to full; cells and battery types.
  local charging = net ~= nil and net >= 0
  X.status = net == nil and "--" or (charging and "Charging" or "Discharging")
  X.netText = signed(net and net / 1000) .. " kW"
  X.timeCaption = charging and "Time to full" or "Time left"
  local hours
  if P.cap and P.stored and net and net > 0 then hours = (P.cap - P.stored) / net / 3600
  elseif P.stored and net and net < 0 then hours = P.stored / -net / 3600 end
  X.timeLeft = dur(hours)
  local cells, cellSt, perType = {}, {}, { 0, 0 }
  for k = 1, R.batt.n or 0 do
    local t = BATTERY_AT[rd("batt", "PrefabHash", k)]
    if t then perType[t] = perType[t] + 1 end
    if #cells < 16 then
      local charge, maximum = rd("batt", "Charge", k) or 0, rd("batt", "Maximum", k) or 0
      local f = maximum > 0 and charge / maximum or 0
      cells[#cells + 1], cellSt[#cellSt + 1] = f, f < 0.1 and 3 or f < 0.5 and 2 or 1
    end
  end
  X.cells, X.cellSt = cells, cellSt
  local typeNames, typeCounts, typeSt = {}, {}, {}
  for t = 1, 2 do
    if perType[t] > 0 then
      typeNames[#typeNames + 1], typeCounts[#typeCounts + 1], typeSt[#typeSt + 1] = BATTERIES[t][2], perType[t], 1
    end
  end
  X.typeN, X.typeNames, X.typeCounts, X.typeSt = #typeNames, typeNames, typeCounts, typeSt

  -- Now.
  X.solarKw = f1(P.solar and P.solar / 1000)
  X.coalKw = (R.gen.n or 0) > 0 and f1((P.coal or 0) / 1000) or "--"
  X.usingKw = f1(using and using / 1000)
  X.netKw = signed(net and net / 1000)
  X.netSt = (net and net < 0 and X.netKw ~= "0.0") and 2 or 1

  -- Solar panels by type, in the table's order: count, kW, mean efficiency, damaged count.
  local by = {}
  for k = 1, R.panels.n or 0 do
    local at = PANEL_AT[rd("panels", "PrefabHash", k)]
    if at then
      local g = by[at] or { n = 0, w = 0, e = 0, d = 0 }
      by[at] = g
      g.n, g.w, g.e = g.n + 1, g.w + (rd("panels", "Charge", k) or 0), g.e + (rd("panels", EFFICIENCY, k) or 0)
      if (rd("panels", DAMAGE, k) or 0) > 0 then g.d = g.d + 1 end
    end
  end
  local types = {}
  for at, p in ipairs(PANELS) do
    local g = by[at]
    if g then types[#types + 1] = { name = p[2], n = g.n, kw = g.w / 1000, eff = g.e / g.n, dmg = g.d } end
  end
  local names, kws, qty, eff, st = {}, {}, {}, {}, {}
  for j = 1, min(#types, 3) do
    local t = types[j]
    names[j], kws[j], qty[j], eff[j] = t.name, f1(t.kw), fmt("%.0f", t.n), fmt("%.0f", t.eff)
    st[j] = S.parked and 0 or (t.dmg > 0 and 2 or 1)
  end
  X.solarN, X.solarNames, X.solarKws, X.solarQty, X.solarEff, X.solarSt = min(#types, 3), names, kws, qty, eff, st
  local damaged, total = {}, 0
  for _, t in ipairs(types) do if t.dmg > 0 then damaged[#damaged + 1] = t; total = total + t.dmg end end
  local alerts = {}
  if #damaged == 1 then
    local t = damaged[1]
    alerts[1] = fmt("%.0f %s panel%s damaged", t.dmg, t.name:lower(), t.dmg == 1 and "" or "s")
  elseif #damaged > 1 then
    alerts[1] = fmt("%.0f panels damaged", total)
  end
  if S.parked then alerts[#alerts + 1] = "Panels parked" end
  X.alertSt = (#alerts > 0 and #types < 3) and 2 or 0
  X.alertMsg = alerts[1] or ""
  X.nwarn = #alerts

  -- Generators: up to two rows, a generator still wearing its prefab's label shown as "Generator N"; coal energy.
  local gn, gNames, gKw, gCoal, gSt, energy = R.gen.n or 0, {}, {}, {}, {}, 0
  for k = 1, gn do
    local q = P.genCoal and P.genCoal[k] or 0
    energy = energy + q * (FUEL_J[rds("gen", 0, "OccupantHash", k) or 0] or 0)
    if k <= 2 then
      local name = R.gen.names[k] or ""
      if name == "" or name:find("Solid Fuel", 1, true) then name = "Generator " .. k end
      local w = P.genW and P.genW[k] or 0
      gNames[k], gKw[k], gCoal[k], gSt[k] = name, f1(w / 1000), fmt("%.0f", q), w > 0 and 1 or 0
    end
  end
  X.genN, X.genNames, X.genKw, X.genCoal, X.genSt = min(gn, 2), gNames, gKw, gCoal, gSt
  X.coalLeft = gn > 0 and fmt("%.0f", P.coalN or 0) or "--"
  X.coalEnergy = gn > 0 and (f1(energy / 1e6) .. " MJ") or "--"
  X.coalLasts = dur((using and using > 0 and gn > 0) and energy / using / 3600 or nil)
  X.producing = X.coalKw == "--" and "--" or (X.coalKw .. " kW")

  sun(P)

  -- Day totals, rolled when the game day changes, saved at the roll and every 120 ticks.
  local d = gameDay()
  if d and day and d ~= day then
    yday, today, day = { solar = today.solar, coal = today.coal, used = today.used }, { solar = 0, coal = 0, used = 0 }, d
    save()
  elseif d and not day then
    day = d
  end
  today.solar = today.solar + (P.solar or 0) * dt
  today.coal = today.coal + (P.coal or 0) * dt
  today.used = today.used + max(0, using or 0) * dt
  if ticks % 120 == 0 then save() end
  if yday then
    local produced, used = (yday.solar or 0) + (yday.coal or 0), yday.used or 0
    X.yProduced, X.ySolar, X.yCoal = f1(produced / 1e6), f1((yday.solar or 0) / 1e6), f1((yday.coal or 0) / 1e6)
    X.yUsed, X.yNet = f1(used / 1e6), signed((produced - used) / 1e6, true)
    X.yNetSt = (X.yNet == "0.0" or produced >= used) and 1 or 2
  else
    X.yProduced, X.ySolar, X.yCoal, X.yUsed, X.yNet, X.yNetSt = "--", "--", "--", "--", "--", 1
  end
end
