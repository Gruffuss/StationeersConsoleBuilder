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
    local p1, p2 = { scene = pg.id, keep = 1, snap = 1 }, { scene = pg.id, keep = 1 }
    if next(sn) then p1.data = sn end
    if next(ea) then p2.data = ea end
    pg.hs = ui:element({ id = 'data', type = 'vector', rect = { unit = 'px', x = -4, y = -4, w = 1, h = 1 }, props = p1 })
    pg.he = ui:element({ id = 'ease', type = 'vector', rect = { unit = 'px', x = -6, y = -4, w = 1, h = 1 }, props = p2 })
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
    if s1 then pg.hs:set_props({ data = sn }) end
    if s2 then pg.he:set_props({ data = ea }) end
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
    { id = "batt", name = "Batteries", prefabs = { -400115994, -1388288459 }, label = nil, all = true, key = -659015162 },
    { id = "room", name = "Room sensor", prefabs = { -1252983604 }, label = "Room", all = false, key = 1331831753 },
  },
  reads = {
    { id = "cap", role = 1, lt = "Maximum", agg = "sum" },
    { id = "frac", role = 1, lt = "Charge", agg = "sum", derived = function(x) return (P.cap and P.cap > 0 and x / P.cap or nil) end, th = { critBelow = 0.1, warnBelow = 0.25, hyst = 0.05 } },
    { id = "temp", role = 2, lt = "Temperature", valid = { 1, 100000 }, unit = "K>C" },
  },
  state = {
  },
  acts = {
    ["btn1_hit"] = { press = false, list = { { steps = { { op = "page", page = "vb_devices" } } } } },
  },
  rules = {
  },
  pages = {
    { id = "p1", surface = "main", bg = { bg = "#2B2B2B", gradient = "#202020" }, src = [==[
SCENE w=480 h=480 fit=contain
# widget header hdr1 {"x":24,"y":0,"w":432,"h":64,"title":"Overview","clock":false,"counts":true,"keys":{}}
G id=hdr1 {
    R x=24.5 y=0.5 w=431 h=63 f=#1A1A1A s=#4A4A4A sw=1
    G v==gt($hdr1_crit,0) {
        C cx=380 cy=32 rx=8 ry=8 f=#EF5350
        T x=398 y=15 w=40 h=34 text="{$hdr1_crit:%.0f}" size=24 f=#F2F2F2 align=right valign=middle
    }
    G v==gt($hdr1_warn,0) {
        C cx=298 cy=32 rx=8 ry=8 f=#F0B429
        T x=316 y=15 w=40 h=34 text="{$hdr1_warn:%.0f}" size=24 f=#F2F2F2 align=right valign=middle
    }
    T x=42 y=4 w=222 h=56 text=Overview size=30 weight=bold f=#F2F2F2 valign=middle fit=ellipsis
}
# widget readout ro1 {"x":24,"y":80,"w":432,"h":201.6,"variant":"hero","caption":"Label","unit":"%","fmt":"%.0f","bar":true,"subFmt":"","keys":{}}
G id=ro1 {
    R x=24 y=214 w=432 h=24 rx=3 f=#121212
    R x=28 y=218 w==clamp($ro1_lvl,0,1)*424 h=16 rx=2 f==if(eq($ro1_st,1),#4CC38A,if(eq($ro1_st,2),#F0B429,if(eq($ro1_st,3),#EF5350,#9A9A9A)))
    T x=24 y=80 w=376 h=144 text="{$ro1_v:%.0f}" size=120 f=#F2F2F2 align=right valign=middle
    T x=408 y=143.36093 w=48 h=67.2 text=% size=48 f=#9A9A9A valign=middle
    T x=24 y=248 w=432 h=33.6 text=$ro1_status size=24 f==if(eq($ro1_st,1),#4CC38A,if(eq($ro1_st,2),#F0B429,if(eq($ro1_st,3),#EF5350,#9A9A9A))) valign=middle fit=ellipsis
}
# widget readoutrow row1 {"x":24,"y":350,"w":432,"h":50,"name":"Temperature °C","fmt1":"%.1f","fmt2":"","w1":120,"w2":80,"keys":{}}
G id=row1 {
    R x=24 y=350 w=432 h=50 rx=4 f=#2C2C2C
    C v==1-eq($row1_st,1)-eq($row1_st,2)-eq($row1_st,3) cx=46 cy=375 rx=8 ry=8 f=#9A9A9A
    C v==eq($row1_st,1) cx=46 cy=375 rx=8 ry=8 f=#4CC38A
    C v==eq($row1_st,2) cx=46 cy=375 rx=8 ry=8 f=#F0B429
    C v==eq($row1_st,3) cx=46 cy=375 rx=8 ry=8 f=#EF5350
    T x=64 y=350 w=248 h=50 text="Temperature °C" size=24 f=#F2F2F2 valign=middle fit=ellipsis
    T x=322 y=350 w=120 h=50 text="{$row1_r1:%.1f}" size=28 f==if(eq($row1_st,2),#F0B429,if(eq($row1_st,3),#EF5350,#F2F2F2)) align=right valign=middle fit=ellipsis
}
# widget button btn1 {"x":24,"y":410,"w":200,"h":54,"states":[{"label":"Devices","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=btn1 {
    R id=btn1_hit click=1 x=24 y=410 w=200 h=54
    R x=24.5 y=410.5 w=199 h=53 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=42 y=410 w=164 h=54 text=Devices size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
G v==lt(ver,11118) {
    R x=0 y=0 w=480 h=58 f=#000000CC
    T x=14.4 y=0 w=451.2 h=58 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=26 f=#FFCC00
}
]==],
      snap = { ["hdr1_crit"] = true, ["hdr1_warn"] = true, ["ro1_v"] = true, ["ro1_st"] = true, ["ro1_status"] = true, ["row1_st"] = true, ["row1_r1"] = true }, samples = {  }, nils = { ["hdr1_crit"] = 0, ["hdr1_warn"] = 0, ["ro1_v"] = "--", ["ro1_st"] = 0, ["ro1_status"] = "--", ["row1_st"] = 0, ["row1_r1"] = "--" }, eased = { ["ro1_lvl"] = 0 }, arrays = {  },
      data = function(o)
        o["hdr1_crit"] = (alarms(3))
        o["hdr1_warn"] = (alarms(2))
        o["ro1_v"] = (P.frac and P.frac * 100 or nil)
        o["ro1_lvl"] = P.frac
        o["ro1_st"] = T.frac
        o["ro1_status"] = (({"IDLE","OK","WARN","CRIT"})[(T.frac or 0)+1])
        o["row1_st"] = T.temp
        o["row1_r1"] = P.temp
      end,
      natives = {  },
      empty = false, w = 460, h = 460, dw = 480, dh = 480, fit = "contain" },
  },
  devices = { id = "vb_devices", surface = "vb_devices", bg = { bg = "#2B2B2B", gradient = "#202020" }, src = [==[
SCENE w=480 h=480 fit=contain
# widget header vbhdr {"x":24,"y":24,"w":432,"h":56,"title":"Devices","clock":false,"counts":false,"keys":{}}
G id=vbhdr {
    R x=24.5 y=24.5 w=431 h=55 f=#1A1A1A s=#4A4A4A sw=1
    T x=42 y=28 w=386 h=48 text=Devices size=30 weight=bold f=#F2F2F2 valign=middle fit=ellipsis
}
# widget repeater vbdev {"x":24,"y":90,"w":432,"h":206,"max":4,"layout":"list","cols":2,"pitch":54,"item":"row","fmt":"","click":true,"keys":{}}
G id=vbdev {
    R x=24 y=90 w=432 h=206
    RP n=4 {
        G v==lt(i,$vbdev_n) {
            R id=vbdev_r click=1 x=24 y==90+i*54 w=432 h=44
            R x=24 y==90+i*54 w=432 h=44 rx=4 f=#2C2C2C
            C v==1-eq($vbdev_st[i],1)-eq($vbdev_st[i],2)-eq($vbdev_st[i],3) cx=46 cy==90+i*54+22 rx=8 ry=8 f=#9A9A9A
            C v==eq($vbdev_st[i],1) cx=46 cy==90+i*54+22 rx=8 ry=8 f=#4CC38A
            C v==eq($vbdev_st[i],2) cx=46 cy==90+i*54+22 rx=8 ry=8 f=#F0B429
            C v==eq($vbdev_st[i],3) cx=46 cy==90+i*54+22 rx=8 ry=8 f=#EF5350
            T x=64 y==90+i*54 w==lerp(258,378,clamp(and($vbdev_ready,eq($vbdev_hasv[i],0)),0,1)) h=44 text="$vbdev_name[i]" size=24 f=#F2F2F2 valign=middle fit=ellipsis missing=""
            T v==not(and($vbdev_ready,eq($vbdev_hasv[i],0))) x=332 y==90+i*54 w=110 h=44 text="{$vbdev_v[i]:%.1f}" size=28 f=#F2F2F2 align=right valign=middle
        }
    }
}
# widget text vbmsg {"x":24,"y":306,"w":432,"h":34,"style":"value","text":"$vbdev_msg","align":"left","state":false,"keys":{}}
G id=vbmsg {
    T x=24 y=306 w=432 h=34 text=$vbdev_msg size=24 f=#F2F2F2 valign=middle fit=ellipsis
}
# widget text vbpg {"x":171.33333,"y":357,"w":137.33333,"h":34,"style":"value","text":"$vbdev_pg","align":"center","state":false,"keys":{}}
G id=vbpg {
    T x=171.33333 y=357 w=137.33333 h=34 text=$vbdev_pg size=24 f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbprev {"x":24,"y":350,"w":137.33333,"h":48,"states":[{"label":"PREV","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbprev {
    R id=vbprev_hit click=1 x=24 y=350 w=137.33333 h=48
    R x=24.5 y=350.5 w=136.33333 h=47 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=42 y=350 w=101.33333 h=48 text=PREV size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbnext {"x":318.66666,"y":350,"w":137.33333,"h":48,"states":[{"label":"NEXT","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbnext {
    R id=vbnext_hit click=1 x=318.66666 y=350 w=137.33333 h=48
    R x=319.16666 y=350.5 w=136.33333 h=47 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=336.66666 y=350 w=101.33333 h=48 text=NEXT size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbscan {"x":24,"y":408,"w":137.33333,"h":48,"states":[{"label":"RESCAN","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbscan {
    R id=vbscan_hit click=1 x=24 y=408 w=137.33333 h=48
    R x=24.5 y=408.5 w=136.33333 h=47 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=42 y=408 w=101.33333 h=48 text=RESCAN size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbback {"x":171.33333,"y":408,"w":137.33333,"h":48,"states":[{"label":"BACK","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbback {
    R id=vbback_hit click=1 x=171.33333 y=408 w=137.33333 h=48
    R x=171.83333 y=408.5 w=136.33333 h=47 rx=3.5 f=#2C2C2C s=#4A4A4A sw=1 fo==1-0.25*down
    T x=189.33333 y=408 w=101.33333 h=48 text=BACK size=22 weight=bold f=#F2F2F2 align=center valign=middle fit=ellipsis
}
# widget button vbsave {"x":318.66666,"y":408,"w":137.33333,"h":48,"states":[{"label":"SAVE","variant":"primary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbsave {
    R id=vbsave_hit click=1 x=318.66666 y=408 w=137.33333 h=48
    R x=318.66666 y=408 w=137.33333 h=48 rx=4 f=#2A64BD fo==1-0.25*down
    T x=336.66666 y=408 w=101.33333 h=48 text=SAVE size=22 weight=bold f=#FFFFFF align=center valign=middle fit=ellipsis
}
G v==lt(ver,11118) {
    R x=0 y=0 w=480 h=58 f=#000000CC
    T x=14.4 y=0 w=451.2 h=58 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=26 f=#FFCC00
}
]==], rows = 4,
    keys = { n = "vbdev_n", name = "vbdev_name", v = "vbdev_v", hasv = "vbdev_hasv", ready = "vbdev_ready", st = "vbdev_st", pg = "vbdev_pg", msg = "vbdev_msg" }, ids = { row = "vbdev_r", save = "vbsave_hit", scan = "vbscan_hit", back = "vbback_hit", prev = "vbprev_hit", next = "vbnext_hit" },
    repeaters = { { n = "vbdev_n", v = "vbdev_v", hasv = "vbdev_hasv", ready = "vbdev_ready", max = 4 } },
    snap = { ["vbdev_n"] = true, ["vbdev_name"] = true, ["vbdev_v"] = true, ["vbdev_hasv"] = true, ["vbdev_ready"] = true, ["vbdev_st"] = true, ["vbdev_pg"] = true, ["vbdev_msg"] = true }, samples = {}, nils = { ["vbdev_n"] = 0, ["vbdev_name"] = { "" }, ["vbdev_v"] = { "" }, ["vbdev_hasv"] = { 0 }, ["vbdev_ready"] = 0, ["vbdev_st"] = { 0 }, ["vbdev_pg"] = "", ["vbdev_msg"] = "" },
    eased = {}, natives = {}, empty = false, w = 460, h = 460, dw = 480, dh = 480, fit = "contain" },
}
do
-- >>> vectorbuilder custom (kept verbatim)
-- <<< vectorbuilder custom
end
VB.boot()
function tick(dt) VB.tick(dt) end
