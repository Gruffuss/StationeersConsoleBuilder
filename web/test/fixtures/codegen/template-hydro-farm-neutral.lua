-- VectorBuilder export · runtime library 1 · ScriptedScreens Vector >= 0.11.118 (ver 11118)
-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens and ScriptedScreens Vector 0.11.118 or newer.
--   BepInEx: https://github.com/BepInEx/BepInEx
--   StationeersLaunchPad: https://github.com/StationeersLaunchPad/StationeersLaunchPad
--   IC10 Editor: https://steamcommunity.com/sharedfiles/filedetails/?id=3592775931
--   StationeersLua: https://steamcommunity.com/sharedfiles/filedetails/?id=3659911735
--   ScriptedScreens: https://steamcommunity.com/sharedfiles/filedetails/?id=3666779631
--   ScriptedScreens Vector: https://steamcommunity.com/sharedfiles/filedetails/?id=3787517570
-- VectorBuilder runtime library 1 (Lua 5.2). Every export embeds it verbatim, then its generated VB.cfg, the custom block,
-- VB.boot() and tick. It owns the table VB and the reserved globals: P read values, T read states 0..3, H histories, S state,
-- C one-tick commands, X custom exports, L the log ring, R roles, E the event being handled, U the custom hooks; rd rds wr
-- wrf log persist page alarms. Device reads and writes are pcalled; hooks, expressions and custom code run unprotected, so
-- an error halts the chip, as in game. Uses only public StationeersLua and ScriptedScreens APIs, feature-detected.
VB = { LIB = 1, q = {}, n = 0, devPage = 0 }
P, T, H, S, C, X, R, E, U = {}, {}, {}, {}, {}, {}, {}, {}, {}
L = { k = {}, m = {}, t = {} }
page = {}
do
  local VB, P, T, H, S, C, R, E, U, L = VB, P, T, H, S, C, R, E, U, L
  local pcall, type, pairs, ipairs, next, tostring, tonumber = pcall, type, pairs, ipairs, next, tostring, tonumber
  local floor, ceil, exp, max, min = math.floor, math.ceil, math.exp, math.max, math.min
  local sort, insert, remove, concat, char = table.sort, table.insert, table.remove, table.concat, string.char
  -- A string state's chip-memory words: 3 UTF-16 units per address (Lua-CSharp strings are UTF-16: s:byte(i) is a unit up to
  -- 65535 and string.char(8364) is "€", measured), exact below 2^48. No bitwise operators.
  local CHUNK, RADIX = 3, 65536   -- not UNIT: that name is the unit conversions' table below

  -- A host call that may raise or give nil: its number, else nil.
  local function num(f, ...)
    if not f then return nil end
    local ok, v = pcall(f, ...)
    if ok and type(v) == 'number' then return v end
    return nil
  end
  local function bool01(v)
    if v == true then return 1 elseif v == false then return 0 end
    return v
  end
  local function typeOf(t, x)
    if type(x) == 'number' then return x end
    if x == nil then return nil end
    return t[x]
  end

  -- The host APIs, the public docs' names first (api/device, logic, memory, persist; the SS examples; the guide).
  local function api()
    local i, u = ic or {}, util
    local d = i.device
    VB.a = {
      list = d and d.list or i.device_list or device_list,
      find = i.find, findAll = i.find_all,
      read = i.read, write = i.write, readId = i.read_id, writeId = i.write_id,
      readSlot = i.read_slot, readSlotId = i.read_slot_id,
      memRead = i.mem_read or mem_read, memWrite = i.mem_write or mem_write,
      persist = i.persist,
      clock = u and u.clock_time,
    }
    local en = i.enums or {}
    VB.LT, VB.LST = en.LogicType or {}, en.LogicSlotType or {}
  end

  local function setup()
    local cfg = VB.cfg
    VB.roles, VB.rk, VB.st, VB.pages, VB.first = {}, {}, {}, {}, {}
    for i, c in ipairs(cfg.roles) do
      local r = { c = c, devs = {}, cands = {} }
      VB.roles[i], VB.rk[c.id] = r, r
      R[c.id] = { n = 0, ok = false }
    end
    for _, s in ipairs(cfg.state) do VB.st[s.name] = s; S[s.name] = s.init end
    for _, x in ipairs(cfg.reads) do
      if x.slot then x.n = typeOf(VB.LST, x.lst) else x.n = typeOf(VB.LT, x.lt) end
      if not x.n then VB.problem = 'unknown type ' .. tostring(x.lst or x.lt) .. ' in read ' .. x.id end
      x.hs, x.sms = {}, {}
      local id = cfg.roles[x.role].id
      if not VB.first[id] then VB.first[id] = x.id end
    end
    for _, ru in ipairs(cfg.rules) do
      ru.n = typeOf(VB.LT, ru.lt)
      if not ru.n then VB.problem = 'unknown LogicType ' .. tostring(ru.lt) end
    end
    for _, pg in ipairs(cfg.pages) do VB.pages[pg.id] = pg end
    local d = cfg.devices
    if d then d.dev = true; VB.pages[d.id] = d end
    VB.PREFAB = VB.LT.PrefabHash
  end

  -- Device k of role r (a pin role reads its pin, every other role the ref it resolved).
  local function readDev(r, k, n, slot)
    if n == nil or r.devs[k] == nil then return nil end
    local c, a = r.c, VB.a
    if c.pin then
      if slot then return num(a.readSlot, c.pin, slot, n) end
      return num(a.read, c.pin, n)
    end
    if slot then return num(a.readSlotId, r.devs[k], slot, n) end
    return num(a.readId, r.devs[k], n)
  end
  local function writeDev(r, k, n, v)
    if n == nil or r.devs[k] == nil then return end
    local c, a = r.c, VB.a
    if c.pin then
      if a.write then pcall(a.write, c.pin, n, v) end
    elseif a.writeId then pcall(a.writeId, r.devs[k], n, v) end
  end

  function rd(role, lt, k)
    local r = VB.rk[role]
    if r then return readDev(r, k or 1, typeOf(VB.LT, lt)) end
  end
  function rds(role, slot, lst, k)
    local r = VB.rk[role]
    if r then return readDev(r, k or 1, typeOf(VB.LST, lst), slot) end
  end
  -- Every device of the role whose read-back differs (a write-only type reads back nil, so it is always written).
  function wr(role, lt, v)
    local r = VB.rk[role]
    if not r then return end
    local n = typeOf(VB.LT, lt)
    v = bool01(v)
    for k = 1, #r.devs do if readDev(r, k, n) ~= v then writeDev(r, k, n, v) end end
  end
  function wrf(role, lt, v)
    local r = VB.rk[role]
    if not r then return end
    local n = typeOf(VB.LT, lt)
    v = bool01(v)
    for k = 1, #r.devs do writeDev(r, k, n, v) end
  end

  -- Candidates sort by display name, then ref; a saved choice is never overwritten by a scan.
  -- Sort scalar keys with the stock sort, never a Lua comparator per comparison. One network order feeds every role.
  local function ordered(list)
    local names, first, ties, byRef, out = {}, {}, {}, {}, {}
    for _, d in ipairs(list) do
      local name = d.display_name or ''
      local f = first[name]
      if not f then first[name] = d; names[#names + 1] = name
      else
        local g = ties[name]
        if not g then
          g = { f.ref_id or 0 }; ties[name] = g; byRef[f.ref_id or 0] = f
        end
        g[#g + 1], byRef[d.ref_id or 0] = d.ref_id or 0, d
      end
    end
    sort(names)
    for _, name in ipairs(names) do
      local g = ties[name]
      if g then
        sort(g)
        for _, ref in ipairs(g) do out[#out + 1] = byRef[ref] end
      else out[#out + 1] = first[name] end
    end
    return out
  end
  -- Copy the four identity fields: a host may reuse and mutate its list tables between scans.
  local function network(list)
    local old, same = VB.listed, VB.listed ~= nil and #VB.listed == #list
    if same then
      for i, d in ipairs(list) do
        local p = old[i]
        if p.ref_id ~= d.ref_id or p.prefab_hash ~= d.prefab_hash or p.name_hash ~= d.name_hash or p.display_name ~= d.display_name then
          same = false break
        end
      end
    end
    if same then return false end
    local snapshot, prefab = {}, list[1] and list[1].prefab_hash
    for i, d in ipairs(list) do
      if d.prefab_hash ~= prefab then prefab = nil end
      snapshot[i] = { ref_id = d.ref_id, prefab_hash = d.prefab_hash, name_hash = d.name_hash, display_name = d.display_name }
    end
    VB.listed, VB.ordered, VB.byPrefab = snapshot, ordered(snapshot), {}
    if prefab ~= nil then VB.byPrefab[prefab] = VB.ordered return true end
    for _, d in ipairs(VB.ordered) do
      local h = d.prefab_hash
      if h ~= nil then
        local b = VB.byPrefab[h]
        if not b then b = {}; VB.byPrefab[h] = b end
        b[#b + 1] = d
      end
    end
    return true
  end
  local function choose(r)
    local c, cands = r.c, r.cands
    if c.all then
      local out, names, n = {}, {}, 0
      for _, d in ipairs(cands) do
        if not c.label or d.display_name == c.label then n = n + 1; out[n], names[n] = d.ref_id, d.display_name or '' end
      end
      r.devs, r.dev, r.names = out, nil, names
      return
    end
    -- The one candidate f accepts, or nil when none or several do: a shared label or name hash is no identity (ruling P21).
    local function unique(f)
      local hit
      for _, d in ipairs(cands) do
        if f(d) then
          if hit then return nil end
          hit = d
        end
      end
      return hit
    end
    local got
    local pick, saved = r.pick, r.saved
    if pick then got = unique(function(d) return d.ref_id == pick end) end
    if not got and saved and pick == nil then   -- pick false: the player chose auto on the Devices page
      got = unique(function(d) return d.ref_id == saved.ref end)
      if not got and saved.label then got = unique(function(d) return d.display_name == saved.label end) end
      if not got and saved.nh then got = unique(function(d) return d.name_hash == saved.nh end) end
    end
    if not got and c.label then got = unique(function(d) return d.display_name == c.label end) end
    r.fell = false
    if not got and #cands == 1 then got, r.fell = cands[1], true end   -- several unlabelled candidates: never picked at random
    r.dev = got
    r.devs = got and { got.ref_id } or {}
    r.names = got and { got.display_name or '' } or {}
  end
  -- R.<id>: what custom code and bindings see of a role.
  local function publish(r)
    local o = R[r.c.id]
    o.n, o.ok, o.refs, o.names = #r.devs, #r.devs > 0, r.devs, r.names or {}
  end
  -- Distinct roles (two doors of one airlock) never share a device. One a distinct role holds by its pick, saved choice, label,
  -- pin or ref is not taken by another's sole-candidate fallback; one that two of them reach the same way goes to neither: two
  -- roles and one device is no identity (ruling P21's reasoning). Roles without `distinct` are untouched.
  local function held(r, ref)   -- another distinct role holds ref other than by the fallback
    for _, o in ipairs(VB.roles) do
      if o ~= r and o.c.distinct and not o.c.all and not o.fell and o.devs[1] == ref then return true end
    end
    return false
  end
  local function apart()
    local strong, fell = {}, {}
    for _, r in ipairs(VB.roles) do
      local ref = r.c.distinct and not r.c.all and r.devs[1]
      if ref then
        if r.fell then fell[ref] = (fell[ref] or 0) + 1 else strong[ref] = (strong[ref] or 0) + 1 end
      end
    end
    for _, r in ipairs(VB.roles) do
      local ref = r.c.distinct and not r.c.all and r.devs[1]
      if ref and ((strong[ref] or 0) + (fell[ref] or 0) > 1) and (r.fell or (strong[ref] or 0) > 1) then
        r.dev, r.devs, r.names = nil, {}, {}
        publish(r)
      end
    end
  end
  function VB.unbound()
    local n = 0
    for _, r in ipairs(VB.roles) do if #r.devs == 0 then n = n + 1 end end
    return n
  end
  function VB.scan()
    VB.scanned = VB.n
    local a, list, changed = VB.a
    if a.list then
      local ok, l = pcall(a.list)
      if ok and type(l) == 'table' then list = l end
    end
    if not list then VB.listed = nil end
    for _, r in ipairs(VB.roles) do
      local c = r.c
      if c.pin or c.ref then
        local here
        if c.pin then here = num(a.read, c.pin, VB.PREFAB) else here = num(a.readId, c.ref, VB.PREFAB) end
        local ref = c.ref or num(a.read, c.pin, VB.LT.ReferenceId)
        r.devs, r.names = here and ref and { ref } or {}, {}
        if #r.devs > 0 then
          r.names[1] = ''
          for _, d in ipairs(list or {}) do if d.ref_id == ref then r.names[1] = d.display_name or '' break end end
        end
      elseif list then
        if changed == nil then changed = network(list) end
        if changed then
          if #c.prefabs == 0 then r.cands = VB.ordered
          elseif #c.prefabs == 1 then r.cands = VB.byPrefab[c.prefabs[1]] or {}
          else
            local wanted, cands = {}, {}
            for _, h in ipairs(c.prefabs) do wanted[h] = true end
            for _, d in ipairs(VB.ordered) do if wanted[d.prefab_hash] then cands[#cands + 1] = d end end
            r.cands = cands
          end
        end
        local cands = r.cands
        if changed or not c.all then choose(r) end
        -- A labelled one role the list does not show (spec 6.1: "falling back to ic.find(label)"): the device the Labeller name
        -- finds, when its prefab is one of the role's. Only when no listed candidate has the label: a label two candidates share
        -- stays ambiguous (ruling P21; a smoke run of this library saw ic.find pick the first of two otherwise).
        local listed = false
        if c.label then
          for _, d in ipairs(cands) do if d.display_name == c.label then listed = true break end end
        end
        if not c.all and #r.devs == 0 and c.label and not listed and a.find then
          local id = num(a.find, c.label)
          local h = id and num(a.readId, id, VB.PREFAB)
          local ok = h ~= nil and #c.prefabs == 0
          for _, p in ipairs(c.prefabs) do if p == h then ok = true end end
          if ok then r.dev, r.devs, r.names, r.fell = { ref_id = id, display_name = c.label }, { id }, { c.label }, false end
        end
      elseif c.label then   -- no device list: keep prefab checks and unique identity in the find fallback
        local ok, ids = pcall(a.findAll, c.label)
        if not ok or type(ids) ~= 'table' then
          local id = num(a.find, c.label)
          ids = id and { id } or {}
        end
        local cands = {}
        for _, id in ipairs(ids) do
          local h = num(a.readId, id, VB.PREFAB)
          local matches = h ~= nil and #c.prefabs == 0
          for _, p in ipairs(c.prefabs) do if p == h then matches = true end end
          if matches then
            cands[#cands + 1] = { ref_id = id, prefab_hash = h, display_name = c.label,
                                  name_hash = num(a.readId, id, VB.LT.NameHash) }
          end
        end
        r.cands = ordered(cands)
        choose(r)
      else
        r.devs = {}
      end
      publish(r)
    end
    apart()
  end

  -- Reads: aggregate → unit → scale/offset → clamp → smooth → derived → thresholds.
  local UNIT = {
    ['K>C'] = function(x) return x - 273.15 end, ['K>F'] = function(x) return (x - 273.15) * 1.8 + 32 end,
    ['kPa>MPa'] = function(x) return x / 1000 end, ['kPa>atm'] = function(x) return x / 101.325 end,
    ['W>kW'] = function(x) return x / 1000 end, ['W>MW'] = function(x) return x / 1000000 end,
    ['J>kJ'] = function(x) return x / 1000 end, ['J>MJ'] = function(x) return x / 1000000 end,
    ['ratio>%'] = function(x) return x * 100 end,
  }
  local NAMES = { [0] = 'idle', 'ok', 'warn', 'crit' }
  local function level(th, lo, hi)
    if (th.critBelow and lo <= th.critBelow) or (th.critAbove and hi >= th.critAbove) then return 3 end
    if (th.warnBelow and lo <= th.warnBelow) or (th.warnAbove and hi >= th.warnAbove) then return 2 end
    return 1
  end
  -- 0 missing, 1 ok, 2 warn, 3 crit; leaving a worse state needs the value `hyst` back over its edge.
  local function grade(th, x, prev)
    if type(x) ~= 'number' then return x == nil and 0 or 1 end
    if not th then return 1 end
    local s, h = level(th, x, x), th.hyst or 0
    if prev and prev > s and h > 0 then s = max(s, min(prev, level(th, x - h, x + h))) end
    return s
  end
  local function shape(x, rd)
    if type(x) ~= 'number' then return nil end
    local u = rd.unit and UNIT[rd.unit]
    if u then x = u(x) end
    x = x * (rd.scale or 1) + (rd.offset or 0)
    if rd.clamp then x = max(rd.clamp[1], min(rd.clamp[2], x)) end
    return x
  end
  -- A raw value outside the read's valid range is no reading (ruling P25).
  local function valid(x, y)
    if y ~= nil and x.valid and (y < x.valid[1] or y > x.valid[2]) then return nil end
    return y
  end
  local function fold(agg, xs)
    local n = #xs
    if n == 0 then return nil end
    local s = xs[1]
    if agg == 'min' then for i = 2, n do s = min(s, xs[i]) end
    elseif agg == 'max' then for i = 2, n do s = max(s, xs[i]) end
    else
      for i = 2, n do s = s + xs[i] end
      if agg ~= 'sum' then s = s / n end
    end
    return s
  end
  function VB.reads(dt)
    for _, x in ipairs(VB.cfg.reads) do
      local r = VB.roles[x.role]
      if x.agg == 'list' and r.c.all then
        local vs, ss = {}, {}
        for k = 1, #r.devs do
          local v = shape(valid(x, readDev(r, k, x.n, x.slot)), x)
          local ref = r.devs[k]
          if v ~= nil and x.smooth then
            local prev = x.sms[ref]
            if prev ~= nil then v = prev + (1 - exp(-dt / x.smooth)) * (v - prev) end
          end
          x.sms[ref] = v
          if v ~= nil and x.derived then v = x.derived(v) end
          local was = x.hs[ref]
          local s = grade(x.th, v, was)
          vs[k], ss[k], x.hs[ref] = type(v) == 'number' and v or 0, s, s
          if x.th and x.th.log and was ~= nil and s ~= was then log(x.th.log .. ' ' .. NAMES[s], s) end
        end
        P[x.id], T[x.id] = vs, ss
      else
        local v
        if r.c.all then
          local xs = {}
          for k = 1, #r.devs do
            local y = valid(x, readDev(r, k, x.n, x.slot))
            if y ~= nil then xs[#xs + 1] = y end
          end
          v = fold(x.agg or 'avg', xs)
        else
          v = valid(x, readDev(r, 1, x.n, x.slot))
        end
        v = shape(v, x)
        if v ~= nil and x.smooth then
          if x.sm ~= nil then v = x.sm + (1 - exp(-dt / x.smooth)) * (v - x.sm) end
          x.sm = v
        elseif v == nil then
          x.sm = nil
        end
        if v ~= nil and x.derived then v = x.derived(v) end
        P[x.id] = v
        local was = T[x.id]
        local s = grade(x.th, v, was)
        T[x.id] = s
        if x.th and x.th.log and was ~= nil and s ~= was then log(x.th.log .. ' ' .. NAMES[s], s) end
      end
    end
  end

  -- Latched rules, in list order.
  -- shortcut: a device that clamps writes is retried each tick, upgrade when write feedback is modelled.
  function VB.rules()
    for _, ru in ipairs(VB.cfg.rules) do
      local r = VB.roles[ru.role]
      local v = bool01(ru.f())
      if type(v) ~= 'number' then v = nil end
      local fire = v ~= nil and ru.n ~= nil and #r.devs > 0
      if fire and ru.skip and not ru.armed then
        if ru.base == nil then ru.base, fire = v, false
        elseif v == ru.base then fire = false
        else ru.armed = true end
      end
      if fire then
        for k = 1, #r.devs do
          if ru.pulse then
            if v ~= ru.prev then writeDev(r, k, ru.n, v) end
          elseif readDev(r, k, ru.n) ~= v then
            writeDev(r, k, ru.n, v)
          end
        end
      end
      ru.prev = v
    end
  end

  function VB.history()
    for _, x in ipairs(VB.cfg.reads) do
      local h = x.hist
      if h and VB.n % (h.every or 1) == 0 then
        local list = H[x.id]
        if not list then list = {}; H[x.id] = list end
        local v = P[x.id]
        list[#list + 1] = type(v) == 'number' and v or 0
        while #list > h.n do remove(list, 1) end
      end
    end
  end

  function VB.clockText()
    local f = VB.a and VB.a.clock
    if f then
      local ok, s = pcall(f, 'HH:MM')
      if ok and type(s) == 'string' then return s end
    end
    return ''
  end
  -- The event-log ring, newest first; a repeat of the newest message updates its time only.
  function log(text, level)
    text, level = tostring(text), level or 1
    local now = VB.clockText()
    if L.m[1] == text and L.k[1] == level then L.t[1] = now return end
    insert(L.k, 1, level); insert(L.m, 1, text); insert(L.t, 1, now)
    local keep = VB.cfg and VB.cfg.logKeep or 8
    while #L.m > keep do L.k[#L.k] = nil; L.m[#L.m] = nil; L.t[#L.t] = nil end
  end
  function alarms(lv)
    local n = 0
    for _, s in pairs(T) do
      if s == lv then n = n + 1
      elseif type(s) == 'table' then for _, y in ipairs(s) do if y == lv then n = n + 1 end end end
    end
    return n
  end

  -- Persist, verified: every set is read back (the result of set is not trusted). Off for the session when boot found the
  -- store present but unreadable (ruling P22).
  function VB.pset(k, v)
    if VB.noSave then return false end
    local p = VB.a and VB.a.persist
    local ok = p and pcall(p.set, k, v)
    local ok2, back = false, nil
    if ok then ok2, back = pcall(p.get, k) end
    if ok and ok2 and back == v then return true end
    if not VB.saveFailed then log('save failed', 2) end
    VB.saveFailed = true
    return false
  end
  persist = {
    get = function(k)
      local p = VB.a and VB.a.persist
      if not p then return nil end
      local ok, v = pcall(p.get, 'u:' .. k)
      if ok then return v end
    end,
    set = function(k, v) return VB.pset('u:' .. k, v) end,
  }

  -- The chip-memory mirror: rewritten whole on each save, top-down from 511; never after a boot that could not
  -- read persist or memory (ruling P22).
  function VB.mirror()
    local a, cfg = VB.a, VB.cfg
    if VB.noSave or VB.noMemory then return end
    if not (a.memWrite and a.memRead) then VB.noMemory = true return end
    local words, count = {}, 0
    local function put(x) words[#words + 1] = x end
    for _, r in ipairs(VB.roles) do
      if r.saved then put(r.c.key); put(1); put(r.saved.ref or 0); put(r.saved.nh or 0); count = count + 1 end
    end
    for _, s in ipairs(cfg.state) do
      if s.save then
        local v = S[s.name]
        if s.type == 'string' then
          local b = tostring(v):sub(1, s.bytes or 30)
          put(s.key); put(3); put(#b)
          for j = 1, #b, CHUNK do
            local w = 0
            for q = j, min(j + CHUNK - 1, #b) do w = w * RADIX + b:byte(q) end
            put(w)
          end
        else
          put(s.key); put(2); put(s.type == 'bool' and (v and 1 or 0) or v)
        end
        count = count + 1
      end
    end
    if 509 - #words + 1 < (cfg.memLow or 256) then VB.mirrorFull = true return end
    VB.mirrorFull = false
    pcall(a.memWrite, 511, cfg.magic)
    pcall(a.memWrite, 510, count)
    for k, w in ipairs(words) do pcall(a.memWrite, 510 - k, w) end
  end
  local function readMirror()
    local a, cfg, out = VB.a, VB.cfg, {}
    local low = cfg.memLow or 256
    local function read(at)
      if at < low or at > 511 then return nil end
      local ok, v = pcall(a.memRead, at)
      if not ok then VB.noMemory = true return nil end
      if type(v) == 'number' then return v end
    end
    local magic = read(511)
    if magic ~= cfg.magic then return out end
    local at, count = 509, read(510)
    if not count or count < 0 or count % 1 ~= 0 or count > floor((at - low + 1) / 3) then return out end
    for _ = 1, count do
      if at - 2 < low then return {} end
      local key, kind = read(at), read(at - 1)
      if key == nil or key % 1 ~= 0 then return {} end
      if kind == 1 then
        if at - 3 < low then return {} end
        out[key] = { ref = read(at - 2), nh = read(at - 3) }
        at = at - 4
      elseif kind == 2 then
        out[key] = read(at - 2)
        at = at - 3
      elseif kind == 3 then
        local len = read(at - 2)
        if not len or len < 0 or len % 1 ~= 0 or len > (at - low - 2) * CHUNK then return {} end
        local chunks, n = {}, floor((len + CHUNK - 1) / CHUNK)
        for j = 1, n do
          local w, bytes = read(at - 2 - j), {}
          if not w or w < 0 or w % 1 ~= 0 or w >= RADIX ^ min(CHUNK, len - (j - 1) * CHUNK) then return {} end
          for q = min(CHUNK, len - (j - 1) * CHUNK), 1, -1 do
            local b = w % RADIX
            bytes[q] = char(b)
            w = (w - b) / RADIX
          end
          chunks[j] = concat(bytes)
        end
        out[key] = concat(chunks)
        at = at - 3 - n
      else
        return {}
      end
      if VB.noMemory then return {} end
    end
    return out
  end

  local function coerce(s, v, cur)
    local t = s.type
    if t == 'number' then
      v = tonumber(v)
      if v == nil then return cur end
      if s.min then v = max(s.min, v) end
      if s.max then v = min(s.max, v) end
      return v
    elseif t == 'bool' then
      return v ~= nil and v ~= false and v ~= 0 and v ~= '0' and v ~= ''
    elseif t == 'enum' then
      v = tonumber(v)
      if v == nil then return cur end
      return max(0, min(s.n - 1, floor(v)))
    end
    if v == nil then return cur end
    return tostring(v)
  end

  -- Boot never writes persist or memory: it reads the saved choices and states, persist first, then the mirror.
  local function restore()
    local p, mem = VB.a.persist, readMirror()
    local function get(k)
      if not p then return nil end
      local ok, v = pcall(p.get, k)
      if not ok then VB.noSave = true return nil end   -- present but unreadable: saving stays off this session (ruling P22)
      if type(v) == 'string' then return v end
    end
    for _, r in ipairs(VB.roles) do
      local c = r.c
      local v = get('vb:r:' .. c.id)
      if v and v ~= '' then
        local ref, label = v:match('^([^|]*)|(.*)$')
        r.saved = { ref = tonumber(ref), label = label ~= '' and label or nil }   -- an empty label is no identity (ruling P21)
        VB.everSaved = true
      elseif v == nil and type(mem[c.key]) == 'table' then
        local m = mem[c.key]
        r.saved = { ref = m.ref, nh = m.nh ~= 0 and m.nh or nil }
        VB.everSaved = true
      end
    end
    for _, s in ipairs(VB.cfg.state) do
      if s.save then
        local v = get((s.type == 'string' and 'vb:t:' or 'vb:s:') .. s.name)
        if v == nil then v = mem[s.key] end
        if v ~= nil then
          if s.type == 'bool' then v = v == '1' or v == 1 end
          S[s.name] = coerce(s, v, S[s.name])
          VB.everSaved = true
        end
      end
    end
  end

  function VB.saveStates(changed)
    if not next(changed) then return end
    for name in pairs(changed) do
      local s, v = VB.st[name], S[name]
      if s.type == 'string' then VB.pset('vb:t:' .. name, v)
      elseif s.type == 'bool' then VB.pset('vb:s:' .. name, v and '1' or '0')
      else VB.pset('vb:s:' .. name, tostring(v)) end
    end
    VB.mirror()
  end
  function VB.saveRoles()
    for _, r in ipairs(VB.roles) do
      local c, d = r.c, r.dev
      -- Keep an offline identity only while the network offers no candidate; explicit auto clears the saved choice.
      if not c.all and not c.pin and not c.ref and (d or #r.cands > 0) then
        if r.pick == false then d = nil end
        VB.pset('vb:r:' .. c.id, d and (tostring(d.ref_id) .. '|' .. (d.display_name or '')) or '')
        r.saved = d and { ref = d.ref_id, label = d.display_name ~= '' and d.display_name or nil, nh = d.name_hash ~= 0 and d.name_hash or nil } or nil
        r.pick = nil
      end
    end
    VB.mirror()
    VB.dirty, VB.everSaved = false, true
  end

  -- Events: the scene's on_click and a text input's on_change only queue.
  function VB.click(value) VB.q[#VB.q + 1] = { v = tostring(value) } end
  function VB.change(uid) return function(value) VB.q[#VB.q + 1] = { native = uid, v = value } end end
  local KINDS = { down = true, up = true, leave = true, enter = true, exit = true, dragstart = true, drop = true, dragend = true }
  local function run(steps, changed)
    for _, st in ipairs(steps) do
      local op, name = st.op, st.s
      local def = name and VB.st[name]
      if op == 'page' then VB.go(st.page)
      elseif op == 'command' then C[st.c] = true
      elseif op == 'log' then log(st.f(), st.level)
      elseif op == 'call' then
        local f = U[st.fn]
        if f then f(E) end
      elseif def then
        local cur, v = S[name], nil
        if op == 'set' then v = coerce(def, st.f(), cur)
        elseif op == 'toggle' then
          if def.type == 'bool' then v = not cur elseif def.type == 'number' then v = (cur ~= 0) and 0 or 1 end
        elseif op == 'cycle' then
          if def.type == 'enum' then v = (cur + 1) % def.n
          elseif def.type == 'bool' then v = not cur
          elseif def.type == 'number' then
            v = cur + 1
            if def.max and v > def.max then v = def.min or 0 end
          end
        elseif op == 'step' and def.type == 'number' then
          v = cur + st.by
          local lo, hi = st.min(), st.max()
          if lo and v < lo then v = lo end
          if hi and v > hi then v = hi end
        end
        if v ~= nil and v ~= cur then
          S[name] = v
          if def.save ~= false then changed[name] = true end
        end
      end
    end
  end
  function VB.events()
    local q = VB.q
    if #q == 0 then return end
    VB.q = {}
    local acts = VB.cfg.acts
    for _, e in ipairs(q) do
      if e.native then
        local a = acts[e.native]
        if a then
          E.id, E.i, E.v, E.x, E.y = e.native, nil, e.v, nil, nil
          local changed = {}
          for _, entry in ipairs(a.list) do if not entry.when or entry.when() then run(entry.steps, changed) end end
          VB.saveStates(changed)
        end
      else
        local v, kind, x, y, i = e.v
        local k, rest = v:match('^(%a+):(.*)$')
        if k and KINDS[k] then kind, v = k, rest end
        local id, fx, fy = v:match('^(.-)@([%d%.%-]+),([%d%.%-]+)$')
        if id then v, x, y = id, tonumber(fx), tonumber(fy) end
        local id2, n = v:match('^(.-):(%d+)$')
        if id2 then v, i = id2, tonumber(n) end
        if VB.cur and VB.cur.dev then
          if kind == nil then VB.devClick(v, i) end
        else
          local cur = VB.cur and VB.cur.id
          local a = (cur and acts[cur .. '/' .. v]) or acts[v]   -- a page-scoped act first (ruling P18)
          if a and ((a.press and kind == 'down') or (not a.press and kind == nil)) then
            E.id, E.i, E.v, E.x, E.y = v, i, nil, x, y
            local changed = {}
            for _, entry in ipairs(a.list) do if not entry.when or entry.when() then run(entry.steps, changed) end end
            VB.saveStates(changed)
          end
        end
      end
    end
  end

  -- Pages: built on their first visit, never built and rendered in one execution.
  function VB.go(id)
    if id == 'vb_devices' and VB.cfg.devices then id = VB.cfg.devices.id end
    local pg = VB.pages[id]
    if not pg then return end
    if pg.dev and VB.target and not VB.target.dev then VB.back = VB.target.id end
    VB.target = pg
  end
  page.go = function(id) VB.go(id) end
  -- The builder's patch of a page the chip has not built (ruling P19): its declaration will carry the newest text.
  function VB.setSrc(surface, src)
    for _, pg in pairs(VB.pages) do if pg.surface == surface then pg.src = src end end
  end
  function VB.activate(pg)
    ss.ui.activate(pg.surface)
    VB.cur = pg
    page.id = pg.id
  end
  function VB.dataOf(pg)
    local o = {}
    if pg.dev then VB.devData(o) return o end
    for k, v in pairs(pg.samples) do o[k] = v end
    if pg.data then pg.data(o) end
    return o
  end
  -- What a name sends: booleans as 0/1; nil, or an empty list, the kind's default (ruling P7); a list copied.
  local function norm(pg, k, v)
    local t = type(v)
    if t == 'boolean' then return v and 1 or 0 end
    if t == 'table' then
      if #v == 0 then return pg.nils[k] end
      local out = {}
      for i = 1, #v do out[i] = bool01(v[i]) end
      return out
    end
    if v == nil then return pg.nils[k] end
    return v
  end
  local function collect(pg, data)
    local out = {}
    for k, v in pairs(data) do out[k] = norm(pg, k, v) end
    for k, d in pairs(pg.nils) do if out[k] == nil then out[k] = d end end
    for _, r in ipairs(pg.repeaters or {}) do
      local n, values, flags = out[r.n], out[r.v], {}
      if type(n) == 'number' and n == n and n > 0 then
        for i = 1, ceil(min(n, r.max)) do
          flags[i] = type(values) == 'table' and (type(values[1]) == 'number' or values[i] ~= nil and values[i] ~= '') and 1 or 0
        end
      end
      out[r.hasv] = #flags > 0 and flags or { 0 }
      out[r.ready] = 1
    end
    return out
  end
  local function same(a, b)
    if type(a) ~= 'table' or type(b) ~= 'table' then return a == b end
    if #a ~= #b then return false end
    for i = 1, #a do if a[i] ~= b[i] then return false end end
    return true
  end
  local function snapped(pg, k, v)
    if type(v) == 'table' then for i = 1, #v do if type(v[i]) ~= 'number' then return true end end end
    return pg.snap[k] or (type(v) ~= 'number' and not (type(v) == 'table' and pg.arrays and pg.arrays[k]))
      or (pg.eased and pg.eased[k] == nil)
  end
  -- Raw geometry has arbitrary expressions: only discard changes the mod's float32 data cannot represent.
  local function displayFloat(v)
    if v == 0 or v ~= v or v == math.huge or v == -math.huge then return v end
    if math.abs(v) > 3.4028234663852886e38 then return v > 0 and math.huge or -math.huge end
    local _, e = math.frexp(v)
    local step = 2 ^ max(e - 24, -149)
    local n = v / step
    local i = floor(n)
    if n - i > 0.5 or (n - i == 0.5 and i % 2 ~= 0) then i = i + 1 end
    return i * step
  end
  local function tiny(a, b, threshold)
    if type(a) == 'number' and type(b) == 'number' then
      return displayFloat(a) == displayFloat(b) or math.abs(b - a) < threshold
    end
    if type(a) ~= 'table' or type(b) ~= 'table' or #a ~= #b then return false end
    for i = 1, #a do if not tiny(a[i], b[i], threshold) then return false end end
    return true
  end
  function VB.fit(pg, w, h)
    local W, H2 = pg.dw, pg.dh
    if pg.fit == 'stretch' then pg.sx, pg.sy, pg.ox, pg.oy = w / W, h / H2, 0, 0 return end
    local s = (pg.fit == 'cover' and max or min)(w / W, h / H2)
    pg.sx, pg.sy, pg.ox, pg.oy = s, s, (w - W * s) / 2, (h - H2 * s) / 2
  end
  -- A native element (an icon, a text input): its design box mapped as the scene is; bound props re-declare it when they change;
  -- an icon with no name is parked off the surface.
  function VB.native(ui, pg, n)
    local props, style, bound = {}, {}, {}
    for k, v in pairs(n.props) do props[k] = v end
    if n.bind then for k, f in pairs(n.bind) do local v = f(); props[k], bound[k] = v, v end end
    if n.type == 'icon' and props.name ~= nil and props.name ~= '' and type(ss.ui.icons) == 'table' then
      local names = ss.ui.icons[props.icon_type]
      if type(names) == 'table' and names[props.name] ~= nil then
        props.name = names[props.name]
        props.icon_type = props.name:match('^([^:]+):') or props.icon_type
      end
    end
    for k, v in pairs(n.style or {}) do style[k] = v end
    if n.font then style.font_size = n.font * pg.sy end
    local rect = { unit = 'px', x = pg.ox + n.x * pg.sx, y = pg.oy + n.y * pg.sy, w = n.w * pg.sx, h = n.h * pg.sy }
    if n.type == 'icon' and (props.name == nil or props.name == '') then rect.x = -10000 end
    local def = { id = n.uid, type = n.type, rect = rect, props = props, style = style }
    if n.type == 'textinput' then def.on_change = VB.change(n.uid) end
    ui:element(def)
    pg.nv[n.uid] = bound
  end
  function VB.build(pg, data)
    local ui = ss.ui.surface(pg.surface)
    pcall(ui.set_resolution, ui, 0, 0)   -- an override survives a re-push (spec 5.4)
    ui:clear()
    local w, h = pg.w, pg.h
    local size = ui:size()
    if size then w, h = size.w, size.h end
    if pg.bg then
      ui:element({ id = 'bg', type = 'panel', rect = { unit = 'px', x = 0, y = 0, w = w, h = h }, style = pg.bg })
    end
    ui:commit()
    if not pg.empty then
      ui:element({ id = 'scene', type = 'vector', rect = { unit = 'px', x = 0, y = 0, w = w, h = h },
                   props = { scene = pg.id, src = pg.src }, on_click = VB.click })
    end
    VB.fit(pg, w, h)
    local sent, sn, ea = collect(pg, data), {}, {}
    for k, v in pairs(sent) do if snapped(pg, k, v) then sn[k] = v else ea[k] = v end end
    pg.hs, pg.he = nil, nil
    if not pg.empty then
      local p1, p2 = { scene = pg.id, keep = 1, snap = 1 }, { scene = pg.id, keep = 1 }
      if next(sn) then p1.data = sn end
      if next(ea) then p2.data = ea end
      pg.hs = ui:element({ id = 'data', type = 'vector', rect = { unit = 'px', x = -4, y = -4, w = 1, h = 1 }, props = p1 })
      pg.he = ui:element({ id = 'ease', type = 'vector', rect = { unit = 'px', x = -6, y = -4, w = 1, h = 1 }, props = p2 })
    end
    pg.nv = {}
    for _, n in ipairs(pg.natives or {}) do VB.native(ui, pg, n) end
    ui:commit()
    pg.sent, pg.built = sent, true
  end
  -- Only names whose value changed, at most one set_props per data element (the flush rule).
  function VB.render(pg, data)
    local sn, ea, s1, s2 = {}, {}, false, false
    for k, v in pairs(collect(pg, data)) do
      local snap, was = snapped(pg, k, v), pg.sent[k]
      local quiet = not snap and tiny(was, v, (pg.eased and pg.eased[k] or 0) / max(pg.sx, pg.sy))
      if not quiet and not same(was, v) then
        pg.sent[k] = v
        if snap then sn[k], s1 = v, true else ea[k], s2 = v, true end
      end
    end
    if s1 and pg.hs then pg.hs:set_props({ data = sn }) end
    if s2 and pg.he then pg.he:set_props({ data = ea }) end
    for _, n in ipairs(pg.natives or {}) do
      if n.bind then
        local was, diff = pg.nv[n.uid] or {}, false
        for k, f in pairs(n.bind) do if was[k] ~= f() then diff = true end end
        if diff then VB.native(ss.ui.surface(pg.surface), pg, n) end
      end
    end
  end

  -- The Devices page (M3 plan, ruling P13).
  local function fmt(v)   -- a read's value on a row, to 3 decimals
    if type(v) ~= 'number' then return '' end
    return tostring(floor(v * 1000 + 0.5) / 1000)
  end
  function VB.devMsg()
    if VB.problem then return VB.problem end
    if VB.noSave then return 'store unreadable: saving off' end
    if VB.saveFailed then return 'save failed' end
    if VB.mirrorFull then return 'chip memory full: mirror not saved' end
    if VB.dirty then return 'unsaved' end
    if VB.noMemory then return 'no chip memory' end
    if VB.everSaved then return 'saved' end
    return ''
  end
  function VB.devData(o)
    local d = VB.cfg.devices
    local k, rows, first = d.keys, d.rows, VB.devPage * d.rows
    local names, vals, sts = {}, {}, {}
    for i = 1, rows do
      local r = VB.roles[first + i]
      if not r then break end
      local c, text, st = r.c, nil, nil
      if (c.pin or c.ref) and #r.devs == 0 then text, st = c.optional and 'not present' or 'not found', c.optional and 1 or 3
      elseif c.pin then text, st = 'd' .. c.pin, 1
      -- Rows name devices, never by reference id: the player cannot see one in game (owner, 2026-10-12). The Labeller
      -- name is how devices are told apart there.
      elseif c.ref then text, st = r.names[1] ~= nil and r.names[1] ~= '' and r.names[1] or 'found', 1
      elseif c.all then text, st = #r.devs .. ' found', (#r.devs > 0 or c.optional) and 1 or 3
      elseif r.dev then
        local name, shared = r.dev.display_name or '', 0
        for _, d in ipairs(r.cands) do if (d.display_name or '') == name then shared = shared + 1 end end
        -- A pick no label tells apart does not survive a rebuild (ruling P21).
        if name == '' then text, st = 'unlabelled: will not survive a rebuild', 2
        elseif shared > 1 then text, st = name .. ' (' .. shared .. ' share this label)', 2
        else text, st = name, r.pick ~= nil and 2 or 1 end
      elseif #r.cands > 1 or (#r.cands > 0 and c.distinct) then text, st = 'auto: ' .. #r.cands .. ' found, tap to pick', 2
      elseif c.optional then text, st = 'not present', 1
      else text, st = 'not found', 3 end
      names[i], sts[i] = c.name .. ': ' .. text, st
      vals[i] = fmt(VB.first[c.id] and P[VB.first[c.id]])
    end
    o[k.n] = #names
    if #names > 0 then o[k.name], o[k.v], o[k.st] = names, vals, sts end
    o[k.pg] = (VB.devPage + 1) .. '/' .. max(1, floor((#VB.roles + rows - 1) / rows))
    o[k.msg] = VB.devMsg()
  end
  -- A one row cycles its candidates in sorted order, then auto (pick false: no saved choice). A distinct role skips the devices
  -- another distinct role holds.
  function VB.cycle(r)
    local cands, cur, from = r.cands, r.dev and r.dev.ref_id, 1
    if r.pick ~= false and cur ~= nil then
      from = #cands + 1
      for i, d in ipairs(cands) do if d.ref_id == cur then from = i + 1 end end
    end
    local nxt
    for i = from, #cands do
      local ref = cands[i].ref_id
      if not (r.c.distinct and held(r, ref)) then nxt = ref break end
    end
    if nxt then r.pick = nxt else r.pick = false end
    choose(r)
    publish(r)
    apart()
    VB.dirty = true
  end
  function VB.devClick(id, i)
    local d = VB.cfg.devices
    local ids = d.ids
    if id == ids.row and i then
      local r = VB.roles[VB.devPage * d.rows + i + 1]
      if r and not r.c.all and not r.c.pin and not r.c.ref then VB.cycle(r) end
    elseif id == ids.save then VB.saveRoles()
    elseif id == ids.scan then VB.rescan = true
    elseif id == ids.back then VB.go(VB.back or VB.cfg.pages[1].id)
    elseif id == ids.prev then VB.devPage = max(0, VB.devPage - 1)
    elseif id == ids.next then
      if (VB.devPage + 1) * d.rows < #VB.roles then VB.devPage = VB.devPage + 1 end
    end
  end

  function VB.boot()
    api()
    setup()
    restore()
    if U.init then U.init() end
    VB.scan()
    VB.reads(0)
    local cfg = VB.cfg
    local start = cfg.pages[cfg.start or 1]
    local first = VB.target or start
    -- Saved state or another role's pick cannot resolve a required one role.
    if cfg.devices then
      for _, r in ipairs(VB.roles) do
        if not r.c.all and not r.c.optional and #r.devs == 0 then first, VB.back = cfg.devices, start.id break end
      end
    end
    VB.target = first
    -- ss.ui.surface may raise while the host is not ready (probe P2); an unbuilt target is built
    -- by the first tick, unprotected there, so a real fault still halts the chip.
    if pcall(VB.build, first, VB.dataOf(first)) then VB.activate(first) end
  end

  function VB.tick(dt)
    VB.n = VB.n + 1
    VB.events()
    local unresolved = false
    for _, r in ipairs(VB.roles) do if not r.c.all and not r.c.optional and #r.devs == 0 then unresolved = true break end end
    local since = VB.n - (VB.scanned or 0)
    if VB.rescan or (VB.cur and VB.cur.dev) or since >= 20 or (unresolved and since >= 4) then
      VB.rescan = false
      VB.scan()
    end
    if U.before_reads then U.before_reads(dt) end
    VB.reads(dt)
    if U.after_reads then U.after_reads(P, S, dt) end
    VB.rules()
    VB.history()
    local pg = VB.target
    local data = VB.dataOf(pg)
    if U.before_render then U.before_render(P, S, data) end
    if not pg.built then
      VB.build(pg, data)
      VB.activate(pg)
    elseif pg ~= VB.cur then
      VB.activate(pg)
      VB.render(pg, data)
    else
      VB.render(pg, data)
    end
    for k in pairs(C) do C[k] = nil end
  end
end
VB.cfg = { lib = 1, floor = 11118, start = 1, logKeep = 8, memLow = 256, magic = 202570866,
  roles = {
    { id = "larre", name = "Larre dock", prefabs = { 85133079 }, label = nil, all = false, optional = true, key = -343539200 },
    { id = "bin", name = "Export bin", prefabs = { -850484480 }, label = nil, all = false, optional = true, key = -1883185272 },
    { id = "lights", name = "Grow lights", prefabs = { -1758710260 }, label = nil, all = true, optional = true, key = 238723283 },
  },
  reads = {
    { id = "lightOn", role = 3, lt = "On", agg = "list" },
    { id = "lightPower", role = 3, lt = "RequiredPower", agg = "list" },
    { id = "binOcc", role = 2, slot = 0, lst = "Occupied" },
    { id = "binOpen", role = 2, lt = "Open" },
    { id = "larreErr", role = 1, lt = "Error" },
    { id = "larrePower", role = 1, lt = "Power" },
  },
  state = {
    { name = "plant", type = "number", init = 1, min = 1, max = 17, save = true, key = -2010330260 },
    { name = "lmode", type = "number", init = 0, min = 0, max = 2, save = true, key = 255931384 },
    { name = "paused", type = "bool", init = false, save = true, key = -1130537922 },
    { name = "first", type = "number", init = 2, save = true, key = -1319229367 },
    { name = "last", type = "number", init = 91, save = true, key = -1132853161 },
    { name = "dump", type = "number", init = 1, save = true, key = -1311911726 },
    { name = "lightLong", type = "number", init = 750, save = true, key = 442515158 },
    { name = "lightShort", type = "number", init = 675, save = true, key = -1546585666 },
    { name = "lightMush", type = "number", init = 0, save = true, key = -591524200 },
    { name = "per", type = "number", init = 5, save = true, key = 364286565 },
    { name = "ann", type = "number", init = 5, save = true, key = -5775706 },
    { name = "binwarn", type = "number", init = 5, save = true, key = 637796448 },
    { name = "darkLong", type = "number", init = 450, save = true, key = 778225261 },
    { name = "darkShort", type = "number", init = 525, save = true, key = -11038398 },
    { name = "darkMush", type = "number", init = 1200, save = true, key = -390269405 },
  },
  acts = {
    ["og1_o0"] = { press = false, list = { { steps = { { op = "set", s = "lmode", f = function() return (0) end } } } } },
    ["og1_o1"] = { press = false, list = { { steps = { { op = "set", s = "lmode", f = function() return (1) end } } } } },
    ["og1_o2"] = { press = false, list = { { steps = { { op = "set", s = "lmode", f = function() return (2) end } } } } },
    ["btn1_hit"] = { press = false, list = { { steps = { { op = "command", c = "skip" } } } } },
    ["btn2_hit"] = { press = false, list = { { steps = { { op = "page", page = "p3" } } } } },
    ["btn3_hit"] = { press = false, list = { { steps = { { op = "page", page = "p2" } } } } },
    ["btn4_hit"] = { press = false, list = { { steps = { { op = "page", page = "p2" } } } } },
    ["btn5_hit"] = { press = false, list = { { steps = { { op = "toggle", s = "paused" } } } } },
    ["btn6_hit"] = { press = false, list = { { steps = { { op = "command", c = "home" } } } } },
    ["btn7_hit"] = { press = false, list = { { steps = { { op = "command", c = "dump" } } } } },
    ["p2/btn8_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (1) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn9_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (2) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn10_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (3) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn11_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (4) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn12_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (5) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn13_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (6) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn14_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (7) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn15_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (8) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn16_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (9) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn17_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (10) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn18_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (11) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn19_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (12) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn20_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (13) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn21_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (14) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn22_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (15) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn23_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (16) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn24_hit"] = { press = false, list = { { steps = { { op = "set", s = "plant", f = function() return (17) end }, { op = "page", page = "p1" } } } } },
    ["p2/btn25_hit"] = { press = false, list = { { steps = { { op = "page", page = "p1" } } } } },
    ["p3/stp1_dec"] = { press = true, list = { { steps = { { op = "step", s = "first", by = -1, min = function() return 0 end, max = function() return (S.last) end } } } } },
    ["p3/stp1_inc"] = { press = true, list = { { steps = { { op = "step", s = "first", by = 1, min = function() return 0 end, max = function() return (S.last) end } } } } },
    ["p3/stp2_dec"] = { press = true, list = { { steps = { { op = "step", s = "last", by = -1, min = function() return (S.first) end, max = function() return 999 end } } } } },
    ["p3/stp2_inc"] = { press = true, list = { { steps = { { op = "step", s = "last", by = 1, min = function() return (S.first) end, max = function() return 999 end } } } } },
    ["p3/stp3_dec"] = { press = true, list = { { steps = { { op = "step", s = "dump", by = -1, min = function() return 0 end, max = function() return 999 end } } } } },
    ["p3/stp3_inc"] = { press = true, list = { { steps = { { op = "step", s = "dump", by = 1, min = function() return 0 end, max = function() return 999 end } } } } },
    ["p3/stp4_dec"] = { press = true, list = { { steps = { { op = "step", s = "lightLong", by = -15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp4_inc"] = { press = true, list = { { steps = { { op = "step", s = "lightLong", by = 15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp5_dec"] = { press = true, list = { { steps = { { op = "step", s = "lightShort", by = -15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp5_inc"] = { press = true, list = { { steps = { { op = "step", s = "lightShort", by = 15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp6_dec"] = { press = true, list = { { steps = { { op = "step", s = "lightMush", by = -15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp6_inc"] = { press = true, list = { { steps = { { op = "step", s = "lightMush", by = 15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp7_dec"] = { press = true, list = { { steps = { { op = "step", s = "per", by = -1, min = function() return 5 end, max = function() return 5 end } } } } },
    ["p3/stp7_inc"] = { press = true, list = { { steps = { { op = "step", s = "per", by = 1, min = function() return 5 end, max = function() return 5 end } } } } },
    ["p3/stp8_dec"] = { press = true, list = { { steps = { { op = "step", s = "ann", by = -1, min = function() return 5 end, max = function() return 5 end } } } } },
    ["p3/stp8_inc"] = { press = true, list = { { steps = { { op = "step", s = "ann", by = 1, min = function() return 5 end, max = function() return 5 end } } } } },
    ["p3/stp9_dec"] = { press = true, list = { { steps = { { op = "step", s = "binwarn", by = -1, min = function() return 1 end, max = function() return 60 end } } } } },
    ["p3/stp9_inc"] = { press = true, list = { { steps = { { op = "step", s = "binwarn", by = 1, min = function() return 1 end, max = function() return 60 end } } } } },
    ["p3/stp10_dec"] = { press = true, list = { { steps = { { op = "step", s = "darkLong", by = -15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp10_inc"] = { press = true, list = { { steps = { { op = "step", s = "darkLong", by = 15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp11_dec"] = { press = true, list = { { steps = { { op = "step", s = "darkShort", by = -15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp11_inc"] = { press = true, list = { { steps = { { op = "step", s = "darkShort", by = 15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp12_dec"] = { press = true, list = { { steps = { { op = "step", s = "darkMush", by = -15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/stp12_inc"] = { press = true, list = { { steps = { { op = "step", s = "darkMush", by = 15, min = function() return 0 end, max = function() return 2400 end } } } } },
    ["p3/btn26_hit"] = { press = false, list = { { steps = { { op = "page", page = "p1" } } } } },
    ["p3/btn27_hit"] = { press = false, list = { { steps = { { op = "page", page = "vb_devices" } } } } },
  },
  rules = {
    { role = 3, lt = "On", f = function() return (S.lmode == 1 and 1 or S.lmode == 2 and 0 or X.lightPhase) end, skip = false, pulse = false },
    { role = 2, lt = "Open", f = function() return (P.binOcc and (P.binOcc ~= 0 and 0 or 1)) end, skip = false, pulse = false },
  },
  pages = {
    { id = "p1", surface = "main", bg = { bg = "#2B2B2B", gradient = "#202020" }, src = [==[
SCENE w=1490 h=960 fit=contain
# widget header hdr1 {"x":24,"y":24,"w":1442,"h":64,"title":"HYDRO FARM","clock":true,"counts":true,"keys":{}}
G id=hdr1 {
    R x=24.5 y=24.5 w=1441 h=63 f=#1A1A1A s=#4A4A4A sw=1
    G v==gt($hdr1_crit,0) {
        C cx=1280 cy=56 rx=8 ry=8 f=#EF5350
        T x=1298 y=39 w=40 h=34 text="{$hdr1_crit:%.0f}" size=24 f=#F2F2F2 align=right valign=middle
    }
    G v==gt($hdr1_warn,0) {
        C cx=1198 cy=56 rx=8 ry=8 f=#F0B429
        T x=1216 y=39 w=40 h=34 text="{$hdr1_warn:%.0f}" size=24 f=#F2F2F2 align=right valign=middle
    }
    T x=42 y=28 w=1122 h=56 text="HYDRO FARM" size=30 weight=bold f=#F2F2F2 valign=middle fit=ellipsis
    T x=1348 y=28 w=100 h=56 text=$hdr1_clock size=24 f=#C4C4C4 align=right valign=middle fit=ellipsis
}
G id=light_cycle {
    # widget panel pnl1 {"x":24,"y":104,"w":470,"h":608,"title":"LIGHT CYCLE","unit":""}
    G id=pnl1 {
        R x=24.5 y=104.5 w=469 h=607 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=38 y=114 w=442 h=30.8 text="LIGHT CYCLE" size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
    }
    # widget readout ro1 {"x":39,"y":138.2,"w":440,"h":201.6,"variant":"hero","caption":"Label","unit":"","fmt":"%.0f","bar":true,"subFmt":"%.1f","keys":{}}
    G id=ro1 {
        R x=39 y=272.2 w=440 h=24 rx=3 f=#121212
        R x=43 y=276.2 w==clamp($ro1_lvl,0,1)*432 h=16 rx=2 f==if(eq($ro1_st,1),#4CC38A,if(eq($ro1_st,2),#F0B429,if(eq($ro1_st,3),#EF5350,#9A9A9A)))
        T x=39 y=138.2 w=384 h=144 text="{$ro1_v:%.0f}" size=120 f=#F2F2F2 align=right valign=middle
        T x=39 y=306.2 w=440 h=33.6 text=$ro1_status size=24 f==if(eq($ro1_st,1),#4CC38A,if(eq($ro1_st,2),#F0B429,if(eq($ro1_st,3),#EF5350,#9A9A9A))) valign=middle fit=ellipsis
        T x=39 y=306.2 w=440 h=33.6 text="{$ro1_sub:%.1f}" size=22 f=#C4C4C4 align=right valign=middle
    }
    # widget kvtable kv1 {"x":39,"y":416.9,"w":440,"h":106,"rows":[{"caption":"Light / dark","fmt":"","state":false,"key":0},{"caption":"Grow lights on","fmt":"","state":false,"key":1}],"rowH":50,"gap":6,"valueW":220,"keys":{}}
    G id=kv1 {
        R x=39 y=416.9 w=440 h=50 rx=4 f=#2C2C2C
        T x=53 y=416.9 w=182 h=50 text="Light / dark" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=245 y=416.9 w=220 h=50 text=$kv1_v0 size=28 f=#F2F2F2 align=right valign=middle fit=ellipsis
        R x=39 y=472.9 w=440 h=50 rx=4 f=#2C2C2C
        T x=53 y=472.9 w=182 h=50 text="Grow lights on" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=245 y=472.9 w=220 h=50 text=$kv1_v1 size=28 f=#F2F2F2 align=right valign=middle fit=ellipsis
    }
    G id=lights {
        # widget text txt1 {"x":43,"y":537,"w":200,"h":28,"style":"unit","text":"Lights","align":"left","state":false,"keys":{}}
        G id=txt1 {
            T x=43 y=537 w=200 h=28 text=Lights size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
        # widget options og1 {"x":42,"y":580,"w":434,"h":54,"options":[{"label":"AUTO","value":0,"key":0},{"label":"ON","value":1,"key":1},{"label":"OFF","value":2,"key":2}],"gap":10,"keys":{}}
        G id=og1 {
            G id=og1_g0 {
                R id=og1_o0 click=1 x=42 y=580 w=138 h=54
                R v==eq($og1_sel,0) x=41 y=579 w=140 h=56 rx=5 f=none s=#3D8BFD sw=2
                R x=42.5 y=580.5 w=137 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=og1_g1 {
                R id=og1_o1 click=1 x=190 y=580 w=138 h=54
                R v==eq($og1_sel,1) x=189 y=579 w=140 h=56 rx=5 f=none s=#3D8BFD sw=2
                R x=190.5 y=580.5 w=137 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=og1_g2 {
                R id=og1_o2 click=1 x=338 y=580 w=138 h=54
                R v==eq($og1_sel,2) x=337 y=579 w=140 h=56 rx=5 f=none s=#3D8BFD sw=2
                R x=338.5 y=580.5 w=137 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=42 y=580 w=138 h=54 text=AUTO size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
            T x=190 y=580 w=138 h=54 text=ON size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
            T x=338 y=580 w=138 h=54 text=OFF size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
    }
    # widget button btn1 {"x":39,"y":643,"w":250,"h":54,"states":[{"label":"SKIP TO NIGHT","variant":"secondary","key":0},{"label":"SKIP TO DAY","variant":"secondary","key":1}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn1 {
        R id=btn1_hit click=1 x=39 y=643 w=250 h=54
        G v==eq($btn1_state,0) {
            R x=39.5 y=643.5 w=249 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
        }
        G v==eq($btn1_state,1) {
            R x=39.5 y=643.5 w=249 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
        }
        T v==eq($btn1_state,0) x=57 y=643 w=214 h=54 text="SKIP TO NIGHT" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        T v==eq($btn1_state,1) x=57 y=643 w=214 h=54 text="SKIP TO DAY" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
    }
    # widget button btn2 {"x":299,"y":643,"w":180,"h":54,"states":[{"label":"SETTINGS","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn2 {
        R id=btn2_hit click=1 x=299 y=643 w=180 h=54
        R x=299.5 y=643.5 w=179 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
        T x=317 y=643 w=144 h=54 text=SETTINGS size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
    }
}
G id=plant {
    # widget panel pnl2 {"x":510,"y":104,"w":470,"h":288,"title":"PLANT","unit":""}
    G id=pnl2 {
        R x=510.5 y=104.5 w=469 h=287 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=524 y=114 w=442 h=30.8 text=PLANT size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
    }
    G id=current_plant {
        # widget button btn3 {"x":525,"y":154.9,"w":440,"h":110.1,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
        G id=btn3 {
            R id=btn3_hit click=1 x=525 y=154.9 w=440 h=110.1
            R x=525.5 y=155.4 w=439 h=109.1 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=543 y=154.9 w=404 h=110.1 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt2 {"x":620,"y":170,"w":176,"h":47.6,"style":"value-lg","text":"$plantName","align":"left","state":false,"keys":{}}
        G id=txt2 {
            T x=620 y=170 w=176 h=47.6 text=$plantName size=28 f=#F2F2F2 valign=middle fit=ellipsis
        }
        # widget text txt3 {"x":620,"y":216,"w":176,"h":30.8,"style":"reading","text":"$plantType","align":"left","state":false,"keys":{}}
        G id=txt3 {
            T x=620 y=216 w=176 h=30.8 text=$plantType size=22 f=#C4C4C4 valign=middle fit=ellipsis
        }
        # widget button btn4 {"x":810,"y":182.9,"w":140,"h":54,"states":[{"label":"CHANGE","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
        G id=btn4 {
            R id=btn4_hit click=1 x=810 y=182.9 w=140 h=54
            R x=810.5 y=183.4 w=139 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=828 y=182.9 w=104 h=54 text=CHANGE size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
    }
    # widget readoutrow row1 {"x":525,"y":271,"w":440,"h":50,"name":"This pass","fmt1":"%.1f","fmt2":"","w1":200,"w2":80,"keys":{}}
    G id=row1 {
        R x=525 y=271 w=440 h=50 rx=4 f=#2C2C2C
        C v==1-eq($row1_st,1)-eq($row1_st,2)-eq($row1_st,3) cx=547 cy=296 rx=8 ry=8 f=#9A9A9A
        C v==eq($row1_st,1) cx=547 cy=296 rx=8 ry=8 f=#4CC38A
        C v==eq($row1_st,2) cx=547 cy=296 rx=8 ry=8 f=#F0B429
        C v==eq($row1_st,3) cx=547 cy=296 rx=8 ry=8 f=#EF5350
        T x=565 y=271 w=176 h=50 text="This pass" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=751 y=271 w=200 h=50 text="{$row1_r1:%.1f}" size=28 f==if(eq($row1_st,2),#F0B429,if(eq($row1_st,3),#EF5350,#F2F2F2)) align=right valign=middle fit=ellipsis
    }
    # widget readoutrow row2 {"x":525,"y":327,"w":440,"h":50,"name":"Next pass","fmt1":"%.1f","fmt2":"","w1":200,"w2":80,"keys":{}}
    G id=row2 {
        R x=525 y=327 w=440 h=50 rx=4 f=#2C2C2C
        C v==1-eq($row2_st,1)-eq($row2_st,2)-eq($row2_st,3) cx=547 cy=352 rx=8 ry=8 f=#9A9A9A
        C v==eq($row2_st,1) cx=547 cy=352 rx=8 ry=8 f=#4CC38A
        C v==eq($row2_st,2) cx=547 cy=352 rx=8 ry=8 f=#F0B429
        C v==eq($row2_st,3) cx=547 cy=352 rx=8 ry=8 f=#EF5350
        T x=565 y=327 w=176 h=50 text="Next pass" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=751 y=327 w=200 h=50 text="{$row2_r1:%.1f}" size=28 f==if(eq($row2_st,2),#F0B429,if(eq($row2_st,3),#EF5350,#F2F2F2)) align=right valign=middle fit=ellipsis
    }
}
G id=export_bin {
    # widget panel pnl3 {"x":996,"y":104,"w":470,"h":288,"title":"EXPORT BIN","unit":""}
    G id=pnl3 {
        R x=996.5 y=104.5 w=469 h=287 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=1010 y=114 w=442 h=30.8 text="EXPORT BIN" size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
    }
    # widget readoutrow row3 {"x":1011,"y":154.9,"w":440,"h":53.4,"name":"Contents","fmt1":"%.1f","fmt2":"","w1":200,"w2":80,"keys":{}}
    G id=row3 {
        R x=1011 y=154.9 w=440 h=53.4 rx=4 f=#2C2C2C
        C v==1-eq($row3_st,1)-eq($row3_st,2)-eq($row3_st,3) cx=1033 cy=181.59999 rx=8 ry=8 f=#9A9A9A
        C v==eq($row3_st,1) cx=1033 cy=181.59999 rx=8 ry=8 f=#4CC38A
        C v==eq($row3_st,2) cx=1033 cy=181.59999 rx=8 ry=8 f=#F0B429
        C v==eq($row3_st,3) cx=1033 cy=181.59999 rx=8 ry=8 f=#EF5350
        T x=1051 y=154.9 w=176 h=53.4 text=Contents size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=1237 y=154.9 w=200 h=53.4 text="{$row3_r1:%.1f}" size=28 f==if(eq($row3_st,2),#F0B429,if(eq($row3_st,3),#EF5350,#F2F2F2)) align=right valign=middle fit=ellipsis
    }
    # widget readoutrow row4 {"x":1011,"y":214.3,"w":440,"h":53.4,"name":"Door","fmt1":"%.1f","fmt2":"","w1":200,"w2":80,"keys":{}}
    G id=row4 {
        R x=1011 y=214.3 w=440 h=53.4 rx=4 f=#2C2C2C
        C v==1-eq($row4_st,1)-eq($row4_st,2)-eq($row4_st,3) cx=1033 cy=241 rx=8 ry=8 f=#9A9A9A
        C v==eq($row4_st,1) cx=1033 cy=241 rx=8 ry=8 f=#4CC38A
        C v==eq($row4_st,2) cx=1033 cy=241 rx=8 ry=8 f=#F0B429
        C v==eq($row4_st,3) cx=1033 cy=241 rx=8 ry=8 f=#EF5350
        T x=1051 y=214.3 w=176 h=53.4 text=Door size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=1237 y=214.3 w=200 h=53.4 text="{$row4_r1:%.1f}" size=28 f==if(eq($row4_st,2),#F0B429,if(eq($row4_st,3),#EF5350,#F2F2F2)) align=right valign=middle fit=ellipsis
    }
    # widget kvtable kv2 {"x":1011,"y":273.7,"w":440,"h":53.4,"rows":[{"caption":"Occupied for","fmt":"","state":true,"key":0}],"rowH":53.4,"gap":6,"valueW":200,"keys":{}}
    G id=kv2 {
        R x=1011 y=273.7 w=440 h=53.4 rx=4 f=#2C2C2C
        T x=1025 y=273.7 w=202 h=53.4 text="Occupied for" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=1237 y=273.7 w=200 h=53.4 text=$kv2_v0 size=28 f==if(eq($kv2_s0,2),#F0B429,if(eq($kv2_s0,3),#EF5350,#F2F2F2)) align=right valign=middle fit=ellipsis
    }
    # widget alert al1 {"x":1011,"y":337.6,"w":440,"h":36.4,"row":false,"keys":{}}
    G id=al1 {
        R x=1011 y=337.6 w=440 h=36.4
        G v==gt($al1_st,0) {
            R x=1025 y=341.80002 w=72 h=28 rx=3 f==if(eq($al1_st,1),#4CC38A,if(eq($al1_st,2),#F0B429,if(eq($al1_st,3),#EF5350,#9A9A9A)))
            T v==eq($al1_st,1) x=1025 y=341.80002 w=72 h=28 text=OK size=20 weight=bold f=#111111 align=center valign=middle
            T v==eq($al1_st,2) x=1025 y=341.80002 w=72 h=28 text=WARN size=20 weight=bold f=#111111 align=center valign=middle
            T v==eq($al1_st,3) x=1025 y=341.80002 w=72 h=28 text=CRIT size=20 weight=bold f=#111111 align=center valign=middle
            T x=1111 y=340.30002 w=326 h=31 text=$al1_msg size=22 f=#F2F2F2 valign=middle fit=ellipsis
        }
    }
}
G id=larre {
    # widget panel pnl4 {"x":510,"y":408,"w":470,"h":304,"title":"LARRE","unit":""}
    G id=pnl4 {
        R x=510.5 y=408.5 w=469 h=303 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=524 y=418 w=442 h=30.8 text=LARRE size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
    }
    # widget readoutrow row5 {"x":525,"y":458.9,"w":440,"h":55.366665,"name":"Status","fmt1":"%.1f","fmt2":"","w1":220,"w2":80,"keys":{}}
    G id=row5 {
        R x=525 y=458.9 w=440 h=55.366665 rx=4 f=#2C2C2C
        C v==1-eq($row5_st,1)-eq($row5_st,2)-eq($row5_st,3) cx=547 cy=486.5833 rx=8 ry=8 f=#9A9A9A
        C v==eq($row5_st,1) cx=547 cy=486.5833 rx=8 ry=8 f=#4CC38A
        C v==eq($row5_st,2) cx=547 cy=486.5833 rx=8 ry=8 f=#F0B429
        C v==eq($row5_st,3) cx=547 cy=486.5833 rx=8 ry=8 f=#EF5350
        T x=565 y=458.9 w=156 h=55.366665 text=Status size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=731 y=458.9 w=220 h=55.366665 text="{$row5_r1:%.1f}" size=28 f==if(eq($row5_st,2),#F0B429,if(eq($row5_st,3),#EF5350,#F2F2F2)) align=right valign=middle fit=ellipsis
    }
    # widget kvtable kv3 {"x":525,"y":520.26666,"w":440,"h":116.73333,"rows":[{"caption":"Pot","fmt":"","state":false,"key":0},{"caption":"Holding","fmt":"","state":false,"key":1}],"rowH":55.366665,"gap":6,"valueW":220,"keys":{}}
    G id=kv3 {
        R x=525 y=520.26666 w=440 h=55.366665 rx=4 f=#2C2C2C
        T x=539 y=520.26666 w=182 h=55.366665 text=Pot size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=731 y=520.26666 w=220 h=55.366665 text=$kv3_v0 size=28 f=#F2F2F2 align=right valign=middle fit=ellipsis
        R x=525 y=581.6333 w=440 h=55.366665 rx=4 f=#2C2C2C
        T x=539 y=581.6333 w=182 h=55.366665 text=Holding size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=731 y=581.6333 w=220 h=55.366665 text=$kv3_v1 size=28 f=#F2F2F2 align=right valign=middle fit=ellipsis
    }
    # widget button btn5 {"x":525,"y":643,"w":117.6,"h":54,"states":[{"label":"PAUSE","variant":"primary","key":0},{"label":"RESUME","variant":"primary","key":1}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn5 {
        R id=btn5_hit click=1 x=525 y=643 w=117.6 h=54
        G v==eq($btn5_state,0) {
            R x=525 y=643 w=117.6 h=54 rx=4 f=#2A64BD fo==1-0.25*down
        }
        G v==eq($btn5_state,1) {
            R x=525 y=643 w=117.6 h=54 rx=4 f=#2A64BD fo==1-0.25*down
        }
        T v==eq($btn5_state,0) x=543 y=643 w=81.6 h=54 text=PAUSE size=22 weight=bold f=#FFFFFF align=center valign=middle fit=ellipsis
        T v==eq($btn5_state,1) x=543 y=643 w=81.6 h=54 text=RESUME size=22 weight=bold f=#FFFFFF align=center valign=middle fit=ellipsis
    }
    # widget button btn6 {"x":652.6,"y":643,"w":155.4,"h":54,"states":[{"label":"SEND HOME","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn6 {
        R id=btn6_hit click=1 x=652.6 y=643 w=155.4 h=54
        R x=653.1 y=643.5 w=154.4 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
        T x=670.6 y=643 w=119.399994 h=54 text="SEND HOME" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
    }
    # widget button btn7 {"x":818,"y":643,"w":147,"h":54,"states":[{"label":"DUMP NOW","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn7 {
        R id=btn7_hit click=1 x=818 y=643 w=147 h=54
        R x=818.5 y=643.5 w=146 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
        T x=836 y=643 w=111 h=54 text="DUMP NOW" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
    }
}
G id=harvest {
    # widget panel pnl5 {"x":996,"y":408,"w":470,"h":304,"title":"HARVEST","unit":""}
    G id=pnl5 {
        R x=996.5 y=408.5 w=469 h=303 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=1010 y=418 w=442 h=30.8 text=HARVEST size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
    }
    # widget kvtable kv4 {"x":1011,"y":458.9,"w":440,"h":238.1,"rows":[{"caption":"This pass","fmt":"","state":false,"key":0},{"caption":"All time","fmt":"","state":false,"key":1},{"caption":"Last pass took","fmt":"","state":false,"key":2},{"caption":"Last harvest","fmt":"","state":false,"key":3}],"rowH":55.025,"gap":6,"valueW":200,"keys":{}}
    G id=kv4 {
        R x=1011 y=458.9 w=440 h=55.025 rx=4 f=#2C2C2C
        T x=1025 y=458.9 w=202 h=55.025 text="This pass" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=1237 y=458.9 w=200 h=55.025 text=$kv4_v0 size=28 f=#F2F2F2 align=right valign=middle fit=ellipsis
        R x=1011 y=519.925 w=440 h=55.025 rx=4 f=#2C2C2C
        T x=1025 y=519.925 w=202 h=55.025 text="All time" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=1237 y=519.925 w=200 h=55.025 text=$kv4_v1 size=28 f=#F2F2F2 align=right valign=middle fit=ellipsis
        R x=1011 y=580.95 w=440 h=55.025 rx=4 f=#2C2C2C
        T x=1025 y=580.95 w=202 h=55.025 text="Last pass took" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=1237 y=580.95 w=200 h=55.025 text=$kv4_v2 size=28 f=#F2F2F2 align=right valign=middle fit=ellipsis
        R x=1011 y=641.975 w=440 h=55.025 rx=4 f=#2C2C2C
        T x=1025 y=641.975 w=202 h=55.025 text="Last harvest" size=24 f=#F2F2F2 valign=middle fit=ellipsis
        T x=1237 y=641.975 w=200 h=55.025 text=$kv4_v3 size=28 f=#F2F2F2 align=right valign=middle fit=ellipsis
    }
}
G id=pots {
    # widget panel pnl6 {"x":24,"y":728,"w":1442,"h":208,"title":"POTS","unit":""}
    G id=pnl6 {
        R x=24.5 y=728.5 w=1441 h=207 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=38 y=738 w=1414 h=30.8 text=POTS size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
    }
    G id=healthy {
        # widget light lt1 {"x":525,"y":750,"w":18,"h":18,"keys":{}}
        G id=lt1 {
            C v==1-eq($lt1_st,1)-eq($lt1_st,2)-eq($lt1_st,3) cx=534 cy=759 rx=9 ry=9 f=#9A9A9A
            C v==eq($lt1_st,1) cx=534 cy=759 rx=9 ry=9 f=#4CC38A
            C v==eq($lt1_st,2) cx=534 cy=759 rx=9 ry=9 f=#F0B429
            C v==eq($lt1_st,3) cx=534 cy=759 rx=9 ry=9 f=#EF5350
        }
        # widget text txt4 {"x":553,"y":741,"w":90,"h":28,"style":"unit","text":"Healthy","align":"left","state":false,"keys":{}}
        G id=txt4 {
            T x=553 y=741 w=90 h=28 text=Healthy size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=growing_slowly {
        # widget light lt2 {"x":671,"y":750,"w":18,"h":18,"keys":{}}
        G id=lt2 {
            C v==1-eq($lt2_st,1)-eq($lt2_st,2)-eq($lt2_st,3) cx=680 cy=759 rx=9 ry=9 f=#9A9A9A
            C v==eq($lt2_st,1) cx=680 cy=759 rx=9 ry=9 f=#4CC38A
            C v==eq($lt2_st,2) cx=680 cy=759 rx=9 ry=9 f=#F0B429
            C v==eq($lt2_st,3) cx=680 cy=759 rx=9 ry=9 f=#EF5350
        }
        # widget text txt5 {"x":699,"y":741,"w":170,"h":28,"style":"unit","text":"Growing slowly","align":"left","state":false,"keys":{}}
        G id=txt5 {
            T x=699 y=741 w=170 h=28 text="Growing slowly" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=damaged {
        # widget light lt3 {"x":897,"y":750,"w":18,"h":18,"keys":{}}
        G id=lt3 {
            C v==1-eq($lt3_st,1)-eq($lt3_st,2)-eq($lt3_st,3) cx=906 cy=759 rx=9 ry=9 f=#9A9A9A
            C v==eq($lt3_st,1) cx=906 cy=759 rx=9 ry=9 f=#4CC38A
            C v==eq($lt3_st,2) cx=906 cy=759 rx=9 ry=9 f=#F0B429
            C v==eq($lt3_st,3) cx=906 cy=759 rx=9 ry=9 f=#EF5350
        }
        # widget text txt6 {"x":925,"y":741,"w":110,"h":28,"style":"unit","text":"Damaged","align":"left","state":false,"keys":{}}
        G id=txt6 {
            T x=925 y=741 w=110 h=28 text=Damaged size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=not_visited_this_pass {
        # widget light lt4 {"x":1063,"y":750,"w":18,"h":18,"keys":{},"__edit":{"v":1,"parts":{},"root":{"o":0.35}}}
        G id=lt4 o=0.35 {
            C v==1-eq($lt4_st,1)-eq($lt4_st,2)-eq($lt4_st,3) cx=1072 cy=759 rx=9 ry=9 f=#9A9A9A
            C v==eq($lt4_st,1) cx=1072 cy=759 rx=9 ry=9 f=#4CC38A
            C v==eq($lt4_st,2) cx=1072 cy=759 rx=9 ry=9 f=#F0B429
            C v==eq($lt4_st,3) cx=1072 cy=759 rx=9 ry=9 f=#EF5350
        }
        # widget text txt7 {"x":1091,"y":741,"w":230,"h":28,"style":"unit","text":"Not visited this pass","align":"left","state":false,"keys":{}}
        G id=txt7 {
            T x=1091 y=741 w=230 h=28 text="Not visited this pass" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    # widget text txt8 {"x":1377,"y":741,"w":70,"h":28,"style":"unit","text":"Larre","align":"left","state":false,"keys":{}}
    G id=txt8 {
        T x=1377 y=741 w=70 h=28 text=Larre size=20 f=#9A9A9A valign=middle fit=ellipsis
    }
    # widget repeater rep1 {"x":39,"y":779.4,"w":1412,"h":125.6,"max":90,"layout":"grid","cols":30,"pitch":50.8,"item":"bar","fmt":"","valueW":0,"click":false,"fade":true,"keys":{}}
    G id=rep1 {
        R x=39 y=779.4 w=1412 h=125.6
        RP n=90 {
            G v==lt(i,$rep1_n) o==1-clamp($rep1_fade[i],0,1) {
                R x==39+mod(i,30)*47.4 y==779.4+floor(i/30)*50.8 w=37.4 h=24 rx=3 f=#121212
                R x==39+mod(i,30)*47.4+4 y==779.4+floor(i/30)*50.8+4 w==clamp($rep1_lvl[i],0,1)*29.4 h=16 rx=2 f==if(eq($rep1_st[i],1),#4CC38A,if(eq($rep1_st[i],2),#F0B429,if(eq($rep1_st[i],3),#EF5350,#9A9A9A)))
            }
        }
    }
    # style {"s":{"role":"text"}}
    R id=larre_legend x=1352 y=753 w=12 h=12 rx=2 f=none sw=3 s=#F2F2F2
    # style {"s":{"role":"text"}}
    R id=larre_cursor v==gte($potCur,0) x==37.5+mod($potCur,30)*47.4 y==777.9+floor($potCur/30)*50.8 w=40.4 h=33 rx=5.5 f=none sw=3 s=#F2F2F2
}
G v==lt(ver,11118) {
    R x=0 y=0 w=1490 h=115 f=#000000CC
    T x=44.7 y=0 w=1400.6 h=115 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=52 f=#FFCC00
}
]==],
      snap = { ["hdr1_crit"] = true, ["hdr1_warn"] = true, ["hdr1_clock"] = true, ["ro1_v"] = true, ["ro1_st"] = true, ["ro1_status"] = true, ["ro1_sub"] = true, ["kv1_v0"] = true, ["kv1_v1"] = true, ["og1_sel"] = true, ["btn1_state"] = true, ["plantName"] = true, ["plantType"] = true, ["row1_st"] = true, ["row1_r1"] = true, ["row2_st"] = true, ["row2_r1"] = true, ["row3_st"] = true, ["row3_r1"] = true, ["row4_st"] = true, ["row4_r1"] = true, ["kv2_v0"] = true, ["kv2_s0"] = true, ["al1_st"] = true, ["al1_msg"] = true, ["row5_st"] = true, ["row5_r1"] = true, ["kv3_v0"] = true, ["kv3_v1"] = true, ["btn5_state"] = true, ["kv4_v0"] = true, ["kv4_v1"] = true, ["kv4_v2"] = true, ["kv4_v3"] = true, ["lt1_st"] = true, ["lt2_st"] = true, ["lt3_st"] = true, ["lt4_st"] = true, ["rep1_n"] = true, ["rep1_st"] = true, ["rep1_fade"] = true, ["potCur"] = true }, samples = {  }, nils = { ["hdr1_crit"] = 0, ["hdr1_warn"] = 0, ["hdr1_clock"] = "--", ["ro1_v"] = "--", ["ro1_st"] = 0, ["ro1_status"] = "--", ["ro1_sub"] = "--", ["kv1_v0"] = "--", ["kv1_v1"] = "--", ["og1_sel"] = 0, ["btn1_state"] = 0, ["plantName"] = "--", ["plantType"] = "--", ["row1_st"] = 0, ["row1_r1"] = "--", ["row2_st"] = 0, ["row2_r1"] = "--", ["row3_st"] = 0, ["row3_r1"] = "--", ["row4_st"] = 0, ["row4_r1"] = "--", ["kv2_v0"] = "--", ["kv2_s0"] = 0, ["al1_st"] = 0, ["al1_msg"] = "--", ["row5_st"] = 0, ["row5_r1"] = "--", ["kv3_v0"] = "--", ["kv3_v1"] = "--", ["btn5_state"] = 0, ["kv4_v0"] = "--", ["kv4_v1"] = "--", ["kv4_v2"] = "--", ["kv4_v3"] = "--", ["lt1_st"] = 0, ["lt2_st"] = 0, ["lt3_st"] = 0, ["lt4_st"] = 0, ["rep1_n"] = 0, ["rep1_lvl"] = { 0 }, ["rep1_st"] = { 0 }, ["rep1_fade"] = { 0 } }, eased = { ["ro1_lvl"] = 0, ["rep1_lvl"] = 0.0003541076487252125 }, arrays = { ["rep1_lvl"] = true },
      data = function(o)
        o["hdr1_crit"] = X["ncrit"]
        o["hdr1_warn"] = X["nwarn"]
        o["hdr1_clock"] = (util.clock_time and util.clock_time("HH:MM") or "--:--")
        o["ro1_v"] = X["hero"]
        o["ro1_lvl"] = X["phaseBar"]
        o["ro1_st"] = X["phaseSt"]
        o["ro1_status"] = X["phase"]
        o["ro1_sub"] = X["phaseLen"]
        o["kv1_v0"] = X["split"]
        o["kv1_v1"] = X["lightsOn"]
        o["og1_sel"] = S.lmode
        o["btn1_state"] = X["skip"]
        o["plantName"] = X["plantName"]
        o["plantType"] = X["plantType"]
        o["row1_st"] = 1
        o["row1_r1"] = X["thisPass"]
        o["row2_st"] = 0
        o["row2_r1"] = X["nextPass"]
        o["row3_st"] = X["binSt"]
        o["row3_r1"] = X["binContents"]
        o["row4_st"] = 0
        o["row4_r1"] = X["door"]
        o["kv2_v0"] = X["occupiedFor"]
        o["kv2_s0"] = X["occupiedSt"]
        o["al1_st"] = X["binAlert"]
        o["al1_msg"] = X["binMsg"]
        o["row5_st"] = X["larreSt"]
        o["row5_r1"] = X["larre"]
        o["kv3_v0"] = X["pot"]
        o["kv3_v1"] = X["holding"]
        o["btn5_state"] = (S.paused and 1 or 0)
        o["kv4_v0"] = X["hPass"]
        o["kv4_v1"] = X["hAll"]
        o["kv4_v2"] = X["hLast"]
        o["kv4_v3"] = X["hAgo"]
        o["lt1_st"] = 1
        o["lt2_st"] = 2
        o["lt3_st"] = 3
        o["lt4_st"] = 0
        o["rep1_n"] = X["potN"]
        o["rep1_lvl"] = X["potG"]
        o["rep1_st"] = X["potSt"]
        o["rep1_fade"] = X["potFade"]
        o["potCur"] = X["potCur"]
      end,
      natives = { { uid = "ico1", type = "icon", x = 540, y = 176.89999389648438, w = 66, h = 66, props = { ["icon_type"] = "prefab", ["name"] = "1929046963", ["z_index"] = 6 }, style = {  }, bind = { ["name"] = function() return X["plantIcon"] end } }, { uid = "ico2", type = "icon", x = 684, y = 591.316650390625, w = 36, h = 36, props = { ["icon_type"] = "prefab", ["name"] = "", ["z_index"] = 6 }, style = {  }, bind = { ["name"] = function() return X["heldIcon"] end } } },
      empty = false, w = 714, h = 460, dw = 1490, dh = 960, fit = "contain" },
    { id = "p2", surface = "page2", bg = { bg = "#2B2B2B", gradient = "#202020" }, src = [==[
SCENE w=1490 h=960 fit=contain
# widget header hdr2 {"x":24,"y":24,"w":1442,"h":64,"title":"HYDRO FARM","clock":true,"counts":true,"keys":{}}
G id=hdr2 {
    R x=24.5 y=24.5 w=1441 h=63 f=#1A1A1A s=#4A4A4A sw=1
    G v==gt($hdr2_crit,0) {
        C cx=1280 cy=56 rx=8 ry=8 f=#EF5350
        T x=1298 y=39 w=40 h=34 text="{$hdr2_crit:%.0f}" size=24 f=#F2F2F2 align=right valign=middle
    }
    G v==gt($hdr2_warn,0) {
        C cx=1198 cy=56 rx=8 ry=8 f=#F0B429
        T x=1216 y=39 w=40 h=34 text="{$hdr2_warn:%.0f}" size=24 f=#F2F2F2 align=right valign=middle
    }
    T x=42 y=28 w=1122 h=56 text="HYDRO FARM" size=30 weight=bold f=#F2F2F2 valign=middle fit=ellipsis
    T x=1348 y=28 w=100 h=56 text=$hdr2_clock size=24 f=#C4C4C4 align=right valign=middle fit=ellipsis
}
G id=select_plant {
    # widget panel pnl7 {"x":24,"y":104,"w":1442,"h":832,"title":"SELECT PLANT","unit":"Light / dark, s"}
    G id=pnl7 {
        R x=24.5 y=104.5 w=1441 h=831 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=38 y=114 w=1340 h=30.8 text="SELECT PLANT" size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
        T x=1388 y=115.4 w=64 h=28 text="Light / dark, s" size=20 f=#9A9A9A align=right valign=middle
    }
    G id=potato {
        # widget button btn8 {"x":39,"y":155.8,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn8 {
            R id=btn8_hit click=1 x=39 y=155.8 w=227 h=248.4
            R v==$btn8_sel x=38 y=154.8 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=39.5 y=156.3 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=57 y=155.8 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt9 {"x":54,"y":291,"w":197,"h":33.6,"style":"value","text":"Potato","align":"center","state":false,"keys":{}}
        G id=txt9 {
            T x=54 y=291 w=197 h=33.6 text=Potato size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt10 {"x":54,"y":330.2,"w":197,"h":28,"style":"unit","text":"Annual","align":"center","state":false,"keys":{}}
        G id=txt10 {
            T x=54 y=330.2 w=197 h=28 text=Annual size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt11 {"x":54,"y":357.6,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt11 {
            T x=54 y=357.6 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=wheat {
        # widget button btn9 {"x":276,"y":155.8,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn9 {
            R id=btn9_hit click=1 x=276 y=155.8 w=227 h=248.4
            R v==$btn9_sel x=275 y=154.8 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=276.5 y=156.3 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=294 y=155.8 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt12 {"x":291,"y":291,"w":197,"h":33.6,"style":"value","text":"Wheat","align":"center","state":false,"keys":{}}
        G id=txt12 {
            T x=291 y=291 w=197 h=33.6 text=Wheat size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt13 {"x":291,"y":330.2,"w":197,"h":28,"style":"unit","text":"Annual","align":"center","state":false,"keys":{}}
        G id=txt13 {
            T x=291 y=330.2 w=197 h=28 text=Annual size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt14 {"x":291,"y":357.6,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt14 {
            T x=291 y=357.6 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=rice {
        # widget button btn10 {"x":513,"y":155.8,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn10 {
            R id=btn10_hit click=1 x=513 y=155.8 w=227 h=248.4
            R v==$btn10_sel x=512 y=154.8 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=513.5 y=156.3 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=531 y=155.8 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt15 {"x":528,"y":291,"w":197,"h":33.6,"style":"value","text":"Rice","align":"center","state":false,"keys":{}}
        G id=txt15 {
            T x=528 y=291 w=197 h=33.6 text=Rice size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt16 {"x":528,"y":330.2,"w":197,"h":28,"style":"unit","text":"Annual","align":"center","state":false,"keys":{}}
        G id=txt16 {
            T x=528 y=330.2 w=197 h=28 text=Annual size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt17 {"x":528,"y":357.6,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt17 {
            T x=528 y=357.6 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=soybean {
        # widget button btn11 {"x":750,"y":155.8,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn11 {
            R id=btn11_hit click=1 x=750 y=155.8 w=227 h=248.4
            R v==$btn11_sel x=749 y=154.8 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=750.5 y=156.3 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=768 y=155.8 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt18 {"x":765,"y":291,"w":197,"h":33.6,"style":"value","text":"Soybean","align":"center","state":false,"keys":{}}
        G id=txt18 {
            T x=765 y=291 w=197 h=33.6 text=Soybean size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt19 {"x":765,"y":330.2,"w":197,"h":28,"style":"unit","text":"Annual","align":"center","state":false,"keys":{}}
        G id=txt19 {
            T x=765 y=330.2 w=197 h=28 text=Annual size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt20 {"x":765,"y":357.6,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt20 {
            T x=765 y=357.6 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=corn {
        # widget button btn12 {"x":987,"y":155.8,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn12 {
            R id=btn12_hit click=1 x=987 y=155.8 w=227 h=248.4
            R v==$btn12_sel x=986 y=154.8 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=987.5 y=156.3 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=1005 y=155.8 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt21 {"x":1002,"y":291,"w":197,"h":33.6,"style":"value","text":"Corn","align":"center","state":false,"keys":{}}
        G id=txt21 {
            T x=1002 y=291 w=197 h=33.6 text=Corn size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt22 {"x":1002,"y":330.2,"w":197,"h":28,"style":"unit","text":"Annual","align":"center","state":false,"keys":{}}
        G id=txt22 {
            T x=1002 y=330.2 w=197 h=28 text=Annual size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt23 {"x":1002,"y":357.6,"w":197,"h":30.8,"style":"reading","text":"$splitShort","align":"center","state":false,"keys":{}}
        G id=txt23 {
            T x=1002 y=357.6 w=197 h=30.8 text=$splitShort size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=mushroom {
        # widget button btn13 {"x":1224,"y":155.8,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn13 {
            R id=btn13_hit click=1 x=1224 y=155.8 w=227 h=248.4
            R v==$btn13_sel x=1223 y=154.8 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=1224.5 y=156.3 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=1242 y=155.8 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt24 {"x":1239,"y":291,"w":197,"h":33.6,"style":"value","text":"Mushroom","align":"center","state":false,"keys":{}}
        G id=txt24 {
            T x=1239 y=291 w=197 h=33.6 text=Mushroom size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt25 {"x":1239,"y":330.2,"w":197,"h":28,"style":"unit","text":"Annual","align":"center","state":false,"keys":{}}
        G id=txt25 {
            T x=1239 y=330.2 w=197 h=28 text=Annual size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt26 {"x":1239,"y":357.6,"w":197,"h":30.8,"style":"reading","text":"$splitMush","align":"center","state":false,"keys":{}}
        G id=txt26 {
            T x=1239 y=357.6 w=197 h=30.8 text=$splitMush size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=alien_mushroom {
        # widget button btn14 {"x":39,"y":414.2,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn14 {
            R id=btn14_hit click=1 x=39 y=414.2 w=227 h=248.4
            R v==$btn14_sel x=38 y=413.2 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=39.5 y=414.7 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=57 y=414.2 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt27 {"x":54,"y":549.4,"w":197,"h":33.6,"style":"value","text":"Alien mushroom","align":"center","state":false,"keys":{}}
        G id=txt27 {
            T x=54 y=549.4 w=197 h=33.6 text="Alien mushroom" size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt28 {"x":54,"y":588.6,"w":197,"h":28,"style":"unit","text":"Annual","align":"center","state":false,"keys":{}}
        G id=txt28 {
            T x=54 y=588.6 w=197 h=28 text=Annual size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt29 {"x":54,"y":616,"w":197,"h":30.8,"style":"reading","text":"$splitMush","align":"center","state":false,"keys":{}}
        G id=txt29 {
            T x=54 y=616 w=197 h=30.8 text=$splitMush size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=tomato {
        # widget button btn15 {"x":276,"y":414.2,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn15 {
            R id=btn15_hit click=1 x=276 y=414.2 w=227 h=248.4
            R v==$btn15_sel x=275 y=413.2 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=276.5 y=414.7 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=294 y=414.2 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt30 {"x":291,"y":549.4,"w":197,"h":33.6,"style":"value","text":"Tomato","align":"center","state":false,"keys":{}}
        G id=txt30 {
            T x=291 y=549.4 w=197 h=33.6 text=Tomato size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt31 {"x":291,"y":588.6,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt31 {
            T x=291 y=588.6 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt32 {"x":291,"y":616,"w":197,"h":30.8,"style":"reading","text":"$splitShort","align":"center","state":false,"keys":{}}
        G id=txt32 {
            T x=291 y=616 w=197 h=30.8 text=$splitShort size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=pumpkin {
        # widget button btn16 {"x":513,"y":414.2,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn16 {
            R id=btn16_hit click=1 x=513 y=414.2 w=227 h=248.4
            R v==$btn16_sel x=512 y=413.2 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=513.5 y=414.7 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=531 y=414.2 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt33 {"x":528,"y":549.4,"w":197,"h":33.6,"style":"value","text":"Pumpkin","align":"center","state":false,"keys":{}}
        G id=txt33 {
            T x=528 y=549.4 w=197 h=33.6 text=Pumpkin size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt34 {"x":528,"y":588.6,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt34 {
            T x=528 y=588.6 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt35 {"x":528,"y":616,"w":197,"h":30.8,"style":"reading","text":"$splitShort","align":"center","state":false,"keys":{}}
        G id=txt35 {
            T x=528 y=616 w=197 h=30.8 text=$splitShort size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=fern {
        # widget button btn17 {"x":750,"y":414.2,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn17 {
            R id=btn17_hit click=1 x=750 y=414.2 w=227 h=248.4
            R v==$btn17_sel x=749 y=413.2 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=750.5 y=414.7 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=768 y=414.2 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt36 {"x":765,"y":549.4,"w":197,"h":33.6,"style":"value","text":"Fern","align":"center","state":false,"keys":{}}
        G id=txt36 {
            T x=765 y=549.4 w=197 h=33.6 text=Fern size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt37 {"x":765,"y":588.6,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt37 {
            T x=765 y=588.6 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt38 {"x":765,"y":616,"w":197,"h":30.8,"style":"reading","text":"$splitShort","align":"center","state":false,"keys":{}}
        G id=txt38 {
            T x=765 y=616 w=197 h=30.8 text=$splitShort size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=darga_fern {
        # widget button btn18 {"x":987,"y":414.2,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn18 {
            R id=btn18_hit click=1 x=987 y=414.2 w=227 h=248.4
            R v==$btn18_sel x=986 y=413.2 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=987.5 y=414.7 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=1005 y=414.2 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt39 {"x":1002,"y":549.4,"w":197,"h":33.6,"style":"value","text":"Darga fern","align":"center","state":false,"keys":{}}
        G id=txt39 {
            T x=1002 y=549.4 w=197 h=33.6 text="Darga fern" size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt40 {"x":1002,"y":588.6,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt40 {
            T x=1002 y=588.6 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt41 {"x":1002,"y":616,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt41 {
            T x=1002 y=616 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=peace_lily {
        # widget button btn19 {"x":1224,"y":414.2,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn19 {
            R id=btn19_hit click=1 x=1224 y=414.2 w=227 h=248.4
            R v==$btn19_sel x=1223 y=413.2 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=1224.5 y=414.7 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=1242 y=414.2 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt42 {"x":1239,"y":549.4,"w":197,"h":33.6,"style":"value","text":"Peace lily","align":"center","state":false,"keys":{}}
        G id=txt42 {
            T x=1239 y=549.4 w=197 h=33.6 text="Peace lily" size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt43 {"x":1239,"y":588.6,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt43 {
            T x=1239 y=588.6 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt44 {"x":1239,"y":616,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt44 {
            T x=1239 y=616 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=tropical_lily {
        # widget button btn20 {"x":39,"y":672.6,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn20 {
            R id=btn20_hit click=1 x=39 y=672.6 w=227 h=248.4
            R v==$btn20_sel x=38 y=671.6 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=39.5 y=673.1 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=57 y=672.6 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt45 {"x":54,"y":807.8,"w":197,"h":33.6,"style":"value","text":"Tropical lily","align":"center","state":false,"keys":{}}
        G id=txt45 {
            T x=54 y=807.8 w=197 h=33.6 text="Tropical lily" size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt46 {"x":54,"y":847,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt46 {
            T x=54 y=847 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt47 {"x":54,"y":874.4,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt47 {
            T x=54 y=874.4 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=winterspawn_a {
        # widget button btn21 {"x":276,"y":672.6,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn21 {
            R id=btn21_hit click=1 x=276 y=672.6 w=227 h=248.4
            R v==$btn21_sel x=275 y=671.6 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=276.5 y=673.1 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=294 y=672.6 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt48 {"x":291,"y":807.8,"w":197,"h":33.6,"style":"value","text":"Winterspawn A","align":"center","state":false,"keys":{}}
        G id=txt48 {
            T x=291 y=807.8 w=197 h=33.6 text="Winterspawn A" size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt49 {"x":291,"y":847,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt49 {
            T x=291 y=847 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt50 {"x":291,"y":874.4,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt50 {
            T x=291 y=874.4 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=winterspawn_b {
        # widget button btn22 {"x":513,"y":672.6,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn22 {
            R id=btn22_hit click=1 x=513 y=672.6 w=227 h=248.4
            R v==$btn22_sel x=512 y=671.6 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=513.5 y=673.1 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=531 y=672.6 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt51 {"x":528,"y":807.8,"w":197,"h":33.6,"style":"value","text":"Winterspawn B","align":"center","state":false,"keys":{}}
        G id=txt51 {
            T x=528 y=807.8 w=197 h=33.6 text="Winterspawn B" size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt52 {"x":528,"y":847,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt52 {
            T x=528 y=847 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt53 {"x":528,"y":874.4,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt53 {
            T x=528 y=874.4 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=hades_flower_a {
        # widget button btn23 {"x":750,"y":672.6,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn23 {
            R id=btn23_hit click=1 x=750 y=672.6 w=227 h=248.4
            R v==$btn23_sel x=749 y=671.6 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=750.5 y=673.1 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=768 y=672.6 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt54 {"x":765,"y":807.8,"w":197,"h":33.6,"style":"value","text":"Hades flower A","align":"center","state":false,"keys":{}}
        G id=txt54 {
            T x=765 y=807.8 w=197 h=33.6 text="Hades flower A" size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt55 {"x":765,"y":847,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt55 {
            T x=765 y=847 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt56 {"x":765,"y":874.4,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt56 {
            T x=765 y=874.4 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    G id=hades_flower_b {
        # widget button btn24 {"x":987,"y":672.6,"w":227,"h":248.4,"states":[{"label":"","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
        G id=btn24 {
            R id=btn24_hit click=1 x=987 y=672.6 w=227 h=248.4
            R v==$btn24_sel x=986 y=671.6 w=229 h=250.4 rx=5 f=none s=#3D8BFD sw=2
            R x=987.5 y=673.1 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            T x=1005 y=672.6 w=191 h=248.4 text="" size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt57 {"x":1002,"y":807.8,"w":197,"h":33.6,"style":"value","text":"Hades flower B","align":"center","state":false,"keys":{}}
        G id=txt57 {
            T x=1002 y=807.8 w=197 h=33.6 text="Hades flower B" size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
        }
        # widget text txt58 {"x":1002,"y":847,"w":197,"h":28,"style":"unit","text":"Perennial","align":"center","state":false,"keys":{}}
        G id=txt58 {
            T x=1002 y=847 w=197 h=28 text=Perennial size=20 f=#9A9A9A align=center valign=middle fit=ellipsis
        }
        # widget text txt59 {"x":1002,"y":874.4,"w":197,"h":30.8,"style":"reading","text":"$splitLong","align":"center","state":false,"keys":{}}
        G id=txt59 {
            T x=1002 y=874.4 w=197 h=30.8 text=$splitLong size=22 f=#C4C4C4 align=center valign=middle fit=ellipsis
        }
    }
    # widget button btn25 {"x":1224,"y":672.6,"w":227,"h":248.4,"states":[{"label":"BACK","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn25 {
        R id=btn25_hit click=1 x=1224 y=672.6 w=227 h=248.4
        R x=1224.5 y=673.1 w=226 h=247.4 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
        T x=1242 y=672.6 w=191 h=248.4 text=BACK size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
    }
}
G v==lt(ver,11118) {
    R x=0 y=0 w=1490 h=115 f=#000000CC
    T x=44.7 y=0 w=1400.6 h=115 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=52 f=#FFCC00
}
]==],
      snap = { ["hdr2_crit"] = true, ["hdr2_warn"] = true, ["hdr2_clock"] = true, ["btn8_sel"] = true, ["splitLong"] = true, ["btn9_sel"] = true, ["btn10_sel"] = true, ["btn11_sel"] = true, ["btn12_sel"] = true, ["splitShort"] = true, ["btn13_sel"] = true, ["splitMush"] = true, ["btn14_sel"] = true, ["btn15_sel"] = true, ["btn16_sel"] = true, ["btn17_sel"] = true, ["btn18_sel"] = true, ["btn19_sel"] = true, ["btn20_sel"] = true, ["btn21_sel"] = true, ["btn22_sel"] = true, ["btn23_sel"] = true, ["btn24_sel"] = true }, samples = {  }, nils = { ["hdr2_crit"] = 0, ["hdr2_warn"] = 0, ["hdr2_clock"] = "--", ["btn8_sel"] = 0, ["splitLong"] = "--", ["btn9_sel"] = 0, ["btn10_sel"] = 0, ["btn11_sel"] = 0, ["btn12_sel"] = 0, ["splitShort"] = "--", ["btn13_sel"] = 0, ["splitMush"] = "--", ["btn14_sel"] = 0, ["btn15_sel"] = 0, ["btn16_sel"] = 0, ["btn17_sel"] = 0, ["btn18_sel"] = 0, ["btn19_sel"] = 0, ["btn20_sel"] = 0, ["btn21_sel"] = 0, ["btn22_sel"] = 0, ["btn23_sel"] = 0, ["btn24_sel"] = 0 }, eased = {  }, arrays = {  },
      data = function(o)
        o["hdr2_crit"] = X["ncrit"]
        o["hdr2_warn"] = X["nwarn"]
        o["hdr2_clock"] = (util.clock_time and util.clock_time("HH:MM") or "--:--")
        o["btn8_sel"] = (S.plant == 1 and 1 or 0)
        o["splitLong"] = (S.lightLong > 0 and string.format("%.0f / %.0f", S.lightLong, S.darkLong) or "Dark")
        o["btn9_sel"] = (S.plant == 2 and 1 or 0)
        o["btn10_sel"] = (S.plant == 3 and 1 or 0)
        o["btn11_sel"] = (S.plant == 4 and 1 or 0)
        o["btn12_sel"] = (S.plant == 5 and 1 or 0)
        o["splitShort"] = (S.lightShort > 0 and string.format("%.0f / %.0f", S.lightShort, S.darkShort) or "Dark")
        o["btn13_sel"] = (S.plant == 6 and 1 or 0)
        o["splitMush"] = (S.lightMush > 0 and string.format("%.0f / %.0f", S.lightMush, S.darkMush) or "Dark")
        o["btn14_sel"] = (S.plant == 7 and 1 or 0)
        o["btn15_sel"] = (S.plant == 8 and 1 or 0)
        o["btn16_sel"] = (S.plant == 9 and 1 or 0)
        o["btn17_sel"] = (S.plant == 10 and 1 or 0)
        o["btn18_sel"] = (S.plant == 11 and 1 or 0)
        o["btn19_sel"] = (S.plant == 12 and 1 or 0)
        o["btn20_sel"] = (S.plant == 13 and 1 or 0)
        o["btn21_sel"] = (S.plant == 14 and 1 or 0)
        o["btn22_sel"] = (S.plant == 15 and 1 or 0)
        o["btn23_sel"] = (S.plant == 16 and 1 or 0)
        o["btn24_sel"] = (S.plant == 17 and 1 or 0)
      end,
      natives = { { uid = "ico3", type = "icon", x = 104.5, y = 168.8000030517578, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "1929046963", ["z_index"] = 6 }, style = {  } }, { uid = "ico4", type = "icon", x = 341.5, y = 168.8000030517578, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "-1057658015", ["z_index"] = 6 }, style = {  } }, { uid = "ico5", type = "icon", x = 578.5, y = 168.8000030517578, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "658916791", ["z_index"] = 6 }, style = {  } }, { uid = "ico6", type = "icon", x = 815.5, y = 168.8000030517578, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "1924673028", ["z_index"] = 6 }, style = {  } }, { uid = "ico7", type = "icon", x = 1052.5, y = 168.8000030517578, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "258339687", ["z_index"] = 6 }, style = {  } }, { uid = "ico8", type = "icon", x = 1289.5, y = 168.8000030517578, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "2044798572", ["z_index"] = 6 }, style = {  } }, { uid = "ico9", type = "icon", x = 104.5, y = 427.20001220703125, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "176446172", ["z_index"] = 6 }, style = {  } }, { uid = "ico10", type = "icon", x = 341.5, y = 427.20001220703125, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "-998592080", ["z_index"] = 6 }, style = {  } }, { uid = "ico11", type = "icon", x = 578.5, y = 427.20001220703125, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "1277828144", ["z_index"] = 6 }, style = {  } }, { uid = "ico12", type = "icon", x = 815.5, y = 427.20001220703125, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "892110467", ["z_index"] = 6 }, style = {  } }, { uid = "ico13", type = "icon", x = 1052.5, y = 427.20001220703125, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "266654416", ["z_index"] = 6 }, style = {  } }, { uid = "ico14", type = "icon", x = 1289.5, y = 427.20001220703125, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "2042955224", ["z_index"] = 6 }, style = {  } }, { uid = "ico15", type = "icon", x = 104.5, y = 685.5999755859375, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "-800947386", ["z_index"] = 6 }, style = {  } }, { uid = "ico16", type = "icon", x = 341.5, y = 685.5999755859375, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "851290561", ["z_index"] = 6 }, style = {  } }, { uid = "ico17", type = "icon", x = 578.5, y = 685.5999755859375, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "-1414203269", ["z_index"] = 6 }, style = {  } }, { uid = "ico18", type = "icon", x = 815.5, y = 685.5999755859375, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "-177792789", ["z_index"] = 6 }, style = {  } }, { uid = "ico19", type = "icon", x = 1052.5, y = 685.5999755859375, w = 96, h = 96, props = { ["icon_type"] = "prefab", ["name"] = "1819167057", ["z_index"] = 6 }, style = {  } } },
      empty = false, w = 714, h = 460, dw = 1490, dh = 960, fit = "contain" },
    { id = "p3", surface = "page3", bg = { bg = "#2B2B2B", gradient = "#202020" }, src = [==[
SCENE w=1490 h=960 fit=contain
# widget header hdr3 {"x":24,"y":24,"w":1442,"h":64,"title":"HYDRO FARM SETTINGS","clock":true,"counts":true,"keys":{}}
G id=hdr3 {
    R x=24.5 y=24.5 w=1441 h=63 f=#1A1A1A s=#4A4A4A sw=1
    G v==gt($hdr3_crit,0) {
        C cx=1280 cy=56 rx=8 ry=8 f=#EF5350
        T x=1298 y=39 w=40 h=34 text="{$hdr3_crit:%.0f}" size=24 f=#F2F2F2 align=right valign=middle
    }
    G v==gt($hdr3_warn,0) {
        C cx=1198 cy=56 rx=8 ry=8 f=#F0B429
        T x=1216 y=39 w=40 h=34 text="{$hdr3_warn:%.0f}" size=24 f=#F2F2F2 align=right valign=middle
    }
    T x=42 y=28 w=1122 h=56 text="HYDRO FARM SETTINGS" size=30 weight=bold f=#F2F2F2 valign=middle fit=ellipsis
    T x=1348 y=28 w=100 h=56 text=$hdr3_clock size=24 f=#C4C4C4 align=right valign=middle fit=ellipsis
}
G id=pots {
    # widget panel pnl8 {"x":24,"y":104,"w":713,"h":358,"title":"POTS","unit":""}
    G id=pnl8 {
        R x=24.5 y=104.5 w=712 h=357 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=38 y=114 w=685 h=30.8 text=POTS size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
    }
    G id=first_pot {
        # widget stepper stp1 {"x":39,"y":158.9,"w":683,"h":54,"name":"First pot","fmt":"%.0f","by":1,"min":0,"max":999,"keys":{}}
        G id=stp1 {
            G id=stp1_gd {
                R id=stp1_dec press=1 x=498 y=158.9 w=54 h=54
                R x=498.5 y=159.4 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp1_gi {
                R id=stp1_inc press=1 x=668 y=158.9 w=54 h=54
                R x=668.5 y=159.4 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=39 y=158.9 w=449 h=54 text="First pot" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=498 y=158.9 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=562 y=166.29999 w=96 h=39.2 text="{$stp1_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=668 y=158.9 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt60 {"x":39,"y":214.9,"w":445,"h":28,"style":"unit","text":"Station where the Larre starts","align":"left","state":false,"keys":{}}
        G id=txt60 {
            T x=39 y=214.9 w=445 h=28 text="Station where the Larre starts" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=last_pot {
        # widget stepper stp2 {"x":39,"y":258.26666,"w":683,"h":54,"name":"Last pot","fmt":"%.0f","by":1,"min":0,"max":999,"keys":{}}
        G id=stp2 {
            G id=stp2_gd {
                R id=stp2_dec press=1 x=498 y=258.26666 w=54 h=54
                R x=498.5 y=258.76666 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp2_gi {
                R id=stp2_inc press=1 x=668 y=258.26666 w=54 h=54
                R x=668.5 y=258.76666 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=39 y=258.26666 w=449 h=54 text="Last pot" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=498 y=258.26666 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=562 y=265.66666 w=96 h=39.2 text="{$stp2_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=668 y=258.26666 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt61 {"x":39,"y":314.26666,"w":445,"h":28,"style":"unit","text":"Station where the Larre stops","align":"left","state":false,"keys":{}}
        G id=txt61 {
            T x=39 y=314.26666 w=445 h=28 text="Station where the Larre stops" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=dump_station {
        # widget stepper stp3 {"x":39,"y":357.63333,"w":683,"h":54,"name":"Dump station","fmt":"%.0f","by":1,"min":0,"max":999,"keys":{}}
        G id=stp3 {
            G id=stp3_gd {
                R id=stp3_dec press=1 x=498 y=357.63333 w=54 h=54
                R x=498.5 y=358.13333 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp3_gi {
                R id=stp3_inc press=1 x=668 y=357.63333 w=54 h=54
                R x=668.5 y=358.13333 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=39 y=357.63333 w=449 h=54 text="Dump station" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=498 y=357.63333 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=562 y=365.03333 w=96 h=39.2 text="{$stp3_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=668 y=357.63333 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt62 {"x":39,"y":413.63333,"w":445,"h":28,"style":"unit","text":"Station above the export bin","align":"left","state":false,"keys":{}}
        G id=txt62 {
            T x=39 y=413.63333 w=445 h=28 text="Station above the export bin" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
}
G id=light_phase {
    # widget panel pnl9 {"x":753,"y":104,"w":713,"h":358,"title":"LIGHT PHASE","unit":"s"}
    G id=pnl9 {
        R x=753.5 y=104.5 w=712 h=357 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=767 y=114 w=611 h=30.8 text="LIGHT PHASE" size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
        T x=1388 y=115.4 w=64 h=28 text=s size=20 f=#9A9A9A align=right valign=middle
    }
    G id=light_long_day {
        # widget stepper stp4 {"x":768,"y":159.8,"w":683,"h":54,"name":"Long day","fmt":"%.0f","by":15,"min":0,"max":2400,"keys":{}}
        G id=stp4 {
            G id=stp4_gd {
                R id=stp4_dec press=1 x=1227 y=159.8 w=54 h=54
                R x=1227.5 y=160.3 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp4_gi {
                R id=stp4_inc press=1 x=1397 y=159.8 w=54 h=54
                R x=1397.5 y=160.3 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=768 y=159.8 w=449 h=54 text="Long day" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=1227 y=159.8 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=1291 y=167.2 w=96 h=39.2 text="{$stp4_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=1397 y=159.8 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt63 {"x":768,"y":215.8,"w":445,"h":28,"style":"unit","text":"Potato, wheat, rice and 8 more","align":"left","state":false,"keys":{}}
        G id=txt63 {
            T x=768 y=215.8 w=445 h=28 text="Potato, wheat, rice and 8 more" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=light_short_day {
        # widget stepper stp5 {"x":768,"y":258.86667,"w":683,"h":54,"name":"Short day","fmt":"%.0f","by":15,"min":0,"max":2400,"keys":{}}
        G id=stp5 {
            G id=stp5_gd {
                R id=stp5_dec press=1 x=1227 y=258.86667 w=54 h=54
                R x=1227.5 y=259.36667 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp5_gi {
                R id=stp5_inc press=1 x=1397 y=258.86667 w=54 h=54
                R x=1397.5 y=259.36667 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=768 y=258.86667 w=449 h=54 text="Short day" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=1227 y=258.86667 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=1291 y=266.26666 w=96 h=39.2 text="{$stp5_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=1397 y=258.86667 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt64 {"x":768,"y":314.86667,"w":445,"h":28,"style":"unit","text":"Corn, tomato, pumpkin, fern","align":"left","state":false,"keys":{}}
        G id=txt64 {
            T x=768 y=314.86667 w=445 h=28 text="Corn, tomato, pumpkin, fern" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=light_mushrooms {
        # widget stepper stp6 {"x":768,"y":357.93332,"w":683,"h":54,"name":"Mushrooms","fmt":"%.0f","by":15,"min":0,"max":2400,"keys":{}}
        G id=stp6 {
            G id=stp6_gd {
                R id=stp6_dec press=1 x=1227 y=357.93332 w=54 h=54
                R x=1227.5 y=358.43332 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp6_gi {
                R id=stp6_inc press=1 x=1397 y=357.93332 w=54 h=54
                R x=1397.5 y=358.43332 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=768 y=357.93332 w=449 h=54 text=Mushrooms size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=1227 y=357.93332 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=1291 y=365.3333 w=96 h=39.2 text="{$stp6_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=1397 y=357.93332 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt65 {"x":768,"y":413.93332,"w":445,"h":28,"style":"unit","text":"Mushroom, alien mushroom","align":"left","state":false,"keys":{}}
        G id=txt65 {
            T x=768 y=413.93332 w=445 h=28 text="Mushroom, alien mushroom" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
}
G id=harvest {
    # widget panel pnl10 {"x":24,"y":478,"w":713,"h":358,"title":"HARVEST","unit":""}
    G id=pnl10 {
        R x=24.5 y=478.5 w=712 h=357 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=38 y=488 w=685 h=30.8 text=HARVEST size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
    }
    G id=perennial_ready_at {
        # widget stepper stp7 {"x":39,"y":532.9,"w":683,"h":54,"name":"Perennial ready at","fmt":"%.0f","by":1,"min":5,"max":5,"keys":{}}
        G id=stp7 {
            G id=stp7_gd {
                R id=stp7_dec press=1 x=498 y=532.9 w=54 h=54
                R x=498.5 y=533.4 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp7_gi {
                R id=stp7_inc press=1 x=668 y=532.9 w=54 h=54
                R x=668.5 y=533.4 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=39 y=532.9 w=449 h=54 text="Perennial ready at" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=498 y=532.9 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=562 y=540.30005 w=96 h=39.2 text="{$stp7_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=668 y=532.9 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt66 {"x":39,"y":588.9,"w":445,"h":28,"style":"unit","text":"Growth stage","align":"left","state":false,"keys":{}}
        G id=txt66 {
            T x=39 y=588.9 w=445 h=28 text="Growth stage" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=annual_ready_at {
        # widget stepper stp8 {"x":39,"y":632.26666,"w":683,"h":54,"name":"Annual ready at","fmt":"%.0f","by":1,"min":5,"max":5,"keys":{}}
        G id=stp8 {
            G id=stp8_gd {
                R id=stp8_dec press=1 x=498 y=632.26666 w=54 h=54
                R x=498.5 y=632.76666 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp8_gi {
                R id=stp8_inc press=1 x=668 y=632.26666 w=54 h=54
                R x=668.5 y=632.76666 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=39 y=632.26666 w=449 h=54 text="Annual ready at" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=498 y=632.26666 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=562 y=639.6667 w=96 h=39.2 text="{$stp8_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=668 y=632.26666 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt67 {"x":39,"y":688.26666,"w":445,"h":28,"style":"unit","text":"Growth stage","align":"left","state":false,"keys":{}}
        G id=txt67 {
            T x=39 y=688.26666 w=445 h=28 text="Growth stage" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=bin_warning_after {
        # widget stepper stp9 {"x":39,"y":731.63336,"w":683,"h":54,"name":"Bin warning after","fmt":"%.0f","by":1,"min":1,"max":60,"keys":{}}
        G id=stp9 {
            G id=stp9_gd {
                R id=stp9_dec press=1 x=498 y=731.63336 w=54 h=54
                R x=498.5 y=732.13336 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp9_gi {
                R id=stp9_inc press=1 x=668 y=731.63336 w=54 h=54
                R x=668.5 y=732.13336 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=39 y=731.63336 w=449 h=54 text="Bin warning after" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=498 y=731.63336 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=562 y=739.0334 w=96 h=39.2 text="{$stp9_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=668 y=731.63336 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt68 {"x":39,"y":787.63336,"w":445,"h":28,"style":"unit","text":"Minutes occupied","align":"left","state":false,"keys":{}}
        G id=txt68 {
            T x=39 y=787.63336 w=445 h=28 text="Minutes occupied" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
}
G id=dark_phase {
    # widget panel pnl11 {"x":753,"y":478,"w":713,"h":358,"title":"DARK PHASE","unit":"s"}
    G id=pnl11 {
        R x=753.5 y=478.5 w=712 h=357 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
        T x=767 y=488 w=611 h=30.8 text="DARK PHASE" size=22 weight=bold f=#9A9A9A valign=middle fit=ellipsis
        T x=1388 y=489.4 w=64 h=28 text=s size=20 f=#9A9A9A align=right valign=middle
    }
    G id=dark_long_day {
        # widget stepper stp10 {"x":768,"y":533.8,"w":683,"h":54,"name":"Long day","fmt":"%.0f","by":15,"min":0,"max":2400,"keys":{}}
        G id=stp10 {
            G id=stp10_gd {
                R id=stp10_dec press=1 x=1227 y=533.8 w=54 h=54
                R x=1227.5 y=534.3 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp10_gi {
                R id=stp10_inc press=1 x=1397 y=533.8 w=54 h=54
                R x=1397.5 y=534.3 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=768 y=533.8 w=449 h=54 text="Long day" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=1227 y=533.8 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=1291 y=541.2 w=96 h=39.2 text="{$stp10_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=1397 y=533.8 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt69 {"x":768,"y":589.8,"w":445,"h":28,"style":"unit","text":"Potato, wheat, rice and 8 more","align":"left","state":false,"keys":{}}
        G id=txt69 {
            T x=768 y=589.8 w=445 h=28 text="Potato, wheat, rice and 8 more" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=dark_short_day {
        # widget stepper stp11 {"x":768,"y":632.86664,"w":683,"h":54,"name":"Short day","fmt":"%.0f","by":15,"min":0,"max":2400,"keys":{}}
        G id=stp11 {
            G id=stp11_gd {
                R id=stp11_dec press=1 x=1227 y=632.86664 w=54 h=54
                R x=1227.5 y=633.36664 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp11_gi {
                R id=stp11_inc press=1 x=1397 y=632.86664 w=54 h=54
                R x=1397.5 y=633.36664 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=768 y=632.86664 w=449 h=54 text="Short day" size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=1227 y=632.86664 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=1291 y=640.26666 w=96 h=39.2 text="{$stp11_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=1397 y=632.86664 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt70 {"x":768,"y":688.86664,"w":445,"h":28,"style":"unit","text":"Corn, tomato, pumpkin, fern","align":"left","state":false,"keys":{}}
        G id=txt70 {
            T x=768 y=688.86664 w=445 h=28 text="Corn, tomato, pumpkin, fern" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
    G id=dark_mushrooms {
        # widget stepper stp12 {"x":768,"y":731.93335,"w":683,"h":54,"name":"Mushrooms","fmt":"%.0f","by":15,"min":0,"max":2400,"keys":{}}
        G id=stp12 {
            G id=stp12_gd {
                R id=stp12_dec press=1 x=1227 y=731.93335 w=54 h=54
                R x=1227.5 y=732.43335 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            G id=stp12_gi {
                R id=stp12_inc press=1 x=1397 y=731.93335 w=54 h=54
                R x=1397.5 y=732.43335 w=53 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
            }
            T x=768 y=731.93335 w=449 h=54 text=Mushrooms size=24 f=#F2F2F2 valign=middle fit=ellipsis
            T x=1227 y=731.93335 w=54 h=54 text=− size=22 weight=bold f=#F2F2F2 align=center valign=middle
            T x=1291 y=739.3334 w=96 h=39.2 text="{$stp12_v:%.0f}" size=28 f=#F2F2F2 align=center valign=middle
            T x=1397 y=731.93335 w=54 h=54 text=+ size=22 weight=bold f=#F2F2F2 align=center valign=middle
        }
        # widget text txt71 {"x":768,"y":787.93335,"w":445,"h":28,"style":"unit","text":"Mushroom, alien mushroom","align":"left","state":false,"keys":{}}
        G id=txt71 {
            T x=768 y=787.93335 w=445 h=28 text="Mushroom, alien mushroom" size=20 f=#9A9A9A valign=middle fit=ellipsis
        }
    }
}
G id=bottom_bar {
    # widget panel pnl12 {"x":24,"y":852,"w":1442,"h":84,"title":"","unit":""}
    G id=pnl12 {
        R x=24.5 y=852.5 w=1441 h=83 rx=5.5 f=#1A1A1A s=#4A4A4A sw=1
    }
    # widget button btn26 {"x":39,"y":867,"w":1052,"h":54,"states":[{"label":"BACK","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn26 {
        R id=btn26_hit click=1 x=39 y=867 w=1052 h=54
        R x=39.5 y=867.5 w=1051 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
        T x=57 y=867 w=1016 h=54 text=BACK size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
    }
    # widget button btn27 {"x":1101,"y":867,"w":350,"h":54,"states":[{"label":"DEVICES","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn27 {
        R id=btn27_hit click=1 x=1101 y=867 w=350 h=54
        R x=1101.5 y=867.5 w=349 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
        T x=1119 y=867 w=314 h=54 text=DEVICES size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
    }
}
G v==lt(ver,11118) {
    R x=0 y=0 w=1490 h=115 f=#000000CC
    T x=44.7 y=0 w=1400.6 h=115 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=52 f=#FFCC00
}
]==],
      snap = { ["hdr3_crit"] = true, ["hdr3_warn"] = true, ["hdr3_clock"] = true, ["stp1_v"] = true, ["stp2_v"] = true, ["stp3_v"] = true, ["stp4_v"] = true, ["stp5_v"] = true, ["stp6_v"] = true, ["stp7_v"] = true, ["stp8_v"] = true, ["stp9_v"] = true, ["stp10_v"] = true, ["stp11_v"] = true, ["stp12_v"] = true }, samples = {  }, nils = { ["hdr3_crit"] = 0, ["hdr3_warn"] = 0, ["hdr3_clock"] = "--" }, eased = {  }, arrays = {  },
      data = function(o)
        o["hdr3_crit"] = X["ncrit"]
        o["hdr3_warn"] = X["nwarn"]
        o["hdr3_clock"] = (util.clock_time and util.clock_time("HH:MM") or "--:--")
        o["stp1_v"] = S.first
        o["stp2_v"] = S.last
        o["stp3_v"] = S.dump
        o["stp4_v"] = S.lightLong
        o["stp5_v"] = S.lightShort
        o["stp6_v"] = S.lightMush
        o["stp7_v"] = S.per
        o["stp8_v"] = S.ann
        o["stp9_v"] = S.binwarn
        o["stp10_v"] = S.darkLong
        o["stp11_v"] = S.darkShort
        o["stp12_v"] = S.darkMush
      end,
      natives = {  },
      empty = false, w = 714, h = 460, dw = 1490, dh = 960, fit = "contain" },
  },
  devices = { id = "vb_devices", surface = "vb_devices", bg = { bg = "#2B2B2B", gradient = "#202020" }, src = [==[
SCENE w=1490 h=960 fit=contain
# widget header vbhdr {"x":24,"y":24,"w":1442,"h":56,"title":"Devices","clock":false,"counts":false,"keys":{}}
G id=vbhdr {
    R x=24.5 y=24.5 w=1441 h=55 f=#1A1A1A s=#4A4A4A sw=1
    T x=42 y=28 w=1396 h=48 text=Devices size=30 weight=bold f=#F2F2F2 valign=middle fit=ellipsis
}
# widget repeater vbdev {"x":24,"y":90,"w":1442,"h":692,"max":13,"layout":"list","cols":2,"pitch":54,"item":"row","fmt":"","valueW":0,"click":true,"fade":false,"keys":{}}
G id=vbdev {
    R x=24 y=90 w=1442 h=692
    RP n=13 {
        G v==lt(i,$vbdev_n) {
            R id=vbdev_r click=1 x=24 y==90+i*54 w=1442 h=44
            R x=24 y==90+i*54 w=1442 h=44 rx=4 f=#2C2C2C
            C v==1-eq($vbdev_st[i],1)-eq($vbdev_st[i],2)-eq($vbdev_st[i],3) cx=46 cy==90+i*54+22 rx=8 ry=8 f=#9A9A9A
            C v==eq($vbdev_st[i],1) cx=46 cy==90+i*54+22 rx=8 ry=8 f=#4CC38A
            C v==eq($vbdev_st[i],2) cx=46 cy==90+i*54+22 rx=8 ry=8 f=#F0B429
            C v==eq($vbdev_st[i],3) cx=46 cy==90+i*54+22 rx=8 ry=8 f=#EF5350
            T x=64 y==90+i*54 w==lerp(1268,1388,clamp(and($vbdev_ready,eq($vbdev_hasv[i],0)),0,1)) h=44 text="$vbdev_name[i]" size=24 f=#F2F2F2 valign=middle fit=ellipsis missing=""
            T v==not(and($vbdev_ready,eq($vbdev_hasv[i],0))) x=1342 y==90+i*54 w=110 h=44 text="{$vbdev_v[i]:%.1f}" size=28 f=#F2F2F2 align=right valign=middle
        }
    }
}
# widget text vbmsg {"x":24,"y":844,"w":1009.4,"h":34,"style":"value","text":"$vbdev_msg","align":"left","state":false,"keys":{}}
G id=vbmsg {
    T x=24 y=844 w=1009.4 h=34 text=$vbdev_msg size=24 f=#F2F2F2 valign=middle fit=ellipsis
}
# widget text vbpg {"x":1033.4,"y":844,"w":432.6,"h":34,"style":"value","text":"$vbdev_pg","align":"right","state":false,"keys":{}}
G id=vbpg {
    T x=1033.4 y=844 w=432.6 h=34 text=$vbdev_pg size=24 f=#F2F2F2 align=right valign=middle fit=ellipsis
}
# widget button vbprev {"x":24,"y":888,"w":280.4,"h":48,"states":[{"label":"PREV","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbprev {
    R id=vbprev_hit click=1 x=24 y=888 w=280.4 h=48
    R x=24.5 y=888.5 w=279.4 h=47 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=42 y=888 w=244.4 h=48 text=PREV size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbnext {"x":314.4,"y":888,"w":280.4,"h":48,"states":[{"label":"NEXT","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbnext {
    R id=vbnext_hit click=1 x=314.4 y=888 w=280.4 h=48
    R x=314.9 y=888.5 w=279.4 h=47 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=332.4 y=888 w=244.4 h=48 text=NEXT size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbscan {"x":604.8,"y":888,"w":280.4,"h":48,"states":[{"label":"RESCAN","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbscan {
    R id=vbscan_hit click=1 x=604.8 y=888 w=280.4 h=48
    R x=605.3 y=888.5 w=279.4 h=47 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=622.8 y=888 w=244.4 h=48 text=RESCAN size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbback {"x":895.2,"y":888,"w":280.4,"h":48,"states":[{"label":"BACK","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbback {
    R id=vbback_hit click=1 x=895.2 y=888 w=280.4 h=48
    R x=895.7 y=888.5 w=279.4 h=47 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=913.2 y=888 w=244.4 h=48 text=BACK size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbsave {"x":1185.6,"y":888,"w":280.4,"h":48,"states":[{"label":"SAVE","variant":"primary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbsave {
    R id=vbsave_hit click=1 x=1185.6 y=888 w=280.4 h=48
    R x=1185.6 y=888 w=280.4 h=48 rx=4 f=#2A64BD fo==1-0.25*down
    T x=1203.6 y=888 w=244.4 h=48 text=SAVE size=22 weight=bold f=#FFFFFF align=center valign=middle fit=ellipsis
}
G v==lt(ver,11118) {
    R x=0 y=0 w=1490 h=115 f=#000000CC
    T x=44.7 y=0 w=1400.6 h=115 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=52 f=#FFCC00
}
]==], rows = 13,
    keys = { n = "vbdev_n", name = "vbdev_name", v = "vbdev_v", hasv = "vbdev_hasv", ready = "vbdev_ready", st = "vbdev_st", pg = "vbdev_pg", msg = "vbdev_msg" }, ids = { row = "vbdev_r", save = "vbsave_hit", scan = "vbscan_hit", back = "vbback_hit", prev = "vbprev_hit", next = "vbnext_hit" },
    repeaters = { { n = "vbdev_n", v = "vbdev_v", hasv = "vbdev_hasv", ready = "vbdev_ready", max = 13 } },
    snap = { ["vbdev_n"] = true, ["vbdev_name"] = true, ["vbdev_v"] = true, ["vbdev_hasv"] = true, ["vbdev_ready"] = true, ["vbdev_st"] = true, ["vbdev_pg"] = true, ["vbdev_msg"] = true }, samples = {}, nils = { ["vbdev_n"] = 0, ["vbdev_name"] = { "" }, ["vbdev_v"] = { "" }, ["vbdev_hasv"] = { 0 }, ["vbdev_ready"] = 0, ["vbdev_st"] = { 0 }, ["vbdev_pg"] = "", ["vbdev_msg"] = "" },
    eased = {}, natives = {}, empty = false, w = 714, h = 460, dw = 1490, dh = 960, fit = "contain" },
}
do
-- >>> vectorbuilder custom (kept verbatim)
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
-- <<< vectorbuilder custom
end
VB.boot()
function tick(dt) VB.tick(dt) end
