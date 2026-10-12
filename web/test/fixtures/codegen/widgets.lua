-- VectorBuilder export · runtime library 1 · ScriptedScreens Vector >= 0.11.118 (ver 11118)
-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector 0.11.118 or newer and ScriptedScreens Fonts (Barlow Condensed Bold, Barlow Medium, Barlow SemiBold, Barlow Condensed SemiBold).
--   BepInEx: https://github.com/BepInEx/BepInEx
--   StationeersLaunchPad: https://github.com/StationeersLaunchPad/StationeersLaunchPad
--   IC10 Editor: https://steamcommunity.com/sharedfiles/filedetails/?id=3592775931
--   StationeersLua: https://steamcommunity.com/sharedfiles/filedetails/?id=3659911735
--   ScriptedScreens: https://steamcommunity.com/sharedfiles/filedetails/?id=3666779631
--   ScriptedScreens Vector: https://steamcommunity.com/sharedfiles/filedetails/?id=3787517570
--   ScriptedScreens Fonts: https://steamcommunity.com/sharedfiles/filedetails/?id=3803224901
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
  },
  reads = {
  },
  state = {
  },
  acts = {
  },
  rules = {
  },
  pages = {
    { id = "p1", surface = "main", bg = { bg = "#3A3A43", gradient = "#24242A" }, src = [==[
SCENE w=480 h=480 fit=contain
DEFS {
    GL id=theme_row units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#3B3B45],[1,#32323A]]
    GL id=theme_brand units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#1D4F7F],[1,#0D3B6A]]
}
# widget alert al1 {"x":24,"y":24,"w":440,"h":50,"row":true,"keys":{}}
G id=al1 {
    R x=24 y=24 w=440 h=50
    G v==gt($al1_st,0) {
        R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        R x=38 y=31.6 w=86 h=34.8 rx=4 f==if(eq($al1_st,1),#7FD970,if(eq($al1_st,2),#F2B233,if(eq($al1_st,3),#F7777A,#A6A6B4)))
        T v==eq($al1_st,1) x=38 y=31.6 w=86 h=34.8 text=OK size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T v==eq($al1_st,2) x=38 y=31.6 w=86 h=34.8 text=WARN size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T v==eq($al1_st,3) x=38 y=31.6 w=86 h=34.8 text=CRIT size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T x=138 y=28 w=312 h=42 text=$al1_msg size=26 font="Barlow Medium" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
}
# widget bar bar1 {"x":24,"y":24,"w":400,"h":30,"orient":"h","stateMode":"bound","marks":[],"target":false,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":0,"keys":{}}
G id=bar1 {
    R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=29 w==clamp($bar1_lvl,0,1)*390 h=20 rx=2 f==if(eq($bar1_st,1),#7FD970,if(eq($bar1_st,2),#F2B233,if(eq($bar1_st,3),#F7777A,#A6A6B4)))
}
# widget button btn1 {"x":24,"y":24,"w":200,"h":54,"states":[{"label":"Button","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=btn1 {
    R id=btn1_hit click=1 x=24 y=24 w=200 h=54
    R x=24.5 y=24.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=42 y=24 w=164 h=54 text=BUTTON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget duct duct1 {"x":24,"y":24,"w":300,"h":4,"dir":"h","period":22,"dash":11,"speed":20,"idle":0,"keys":{}}
G id=duct1 {
    R x=24 y=24 w=300 h=4 f=#5A5A69
    L p=[24,26,324,26] sw=4 s=#C8C8D2 cap=butt dash=[11,11] dofs==-mod(t*20,22) so==clamp($duct1_run,0,1)
}
# widget eventlog log1 {"x":24,"y":24,"w":440,"h":218,"rows":4,"time":false,"pitch":56,"keys":{}}
G id=log1 {
    R x=24 y=24 w=440 h=218
    RP n=4 {
        G v==gt($log1_k[i],0) {
            R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            R x=38 y==24+i*56+7.6 w=86 h=34.8 rx=4 f==if(eq($log1_k[i],1),#7FD970,if(eq($log1_k[i],2),#F2B233,if(eq($log1_k[i],3),#F7777A,#A6A6B4)))
            T v==eq($log1_k[i],1) x=38 y==24+i*56+7.6 w=86 h=34.8 text=OK size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T v==eq($log1_k[i],2) x=38 y==24+i*56+7.6 w=86 h=34.8 text=WARN size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T v==eq($log1_k[i],3) x=38 y==24+i*56+7.6 w=86 h=34.8 text=CRIT size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T x=138 y==24+i*56 w=312 h=50 text="$log1_m[i]" size=26 font="Barlow Medium" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
        }
    }
}
# widget glyph gl1 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"text-secondary"}
G id=gl1 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C8C8D2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C8C8D2
    }
}
# widget header hdr1 {"x":24,"y":24,"w":432,"h":64,"title":"Title","clock":false,"counts":true,"keys":{}}
G id=hdr1 {
    R x=25.5 y=25.5 w=429 h=61 rx=12.5 f=@theme_brand s=#FF772D sw=3
    G v==gt($hdr1_crit,0) {
        C cx=372 cy=56 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
        T x=391 y=39 w=47 h=34 text="{$hdr1_crit:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    G v==gt($hdr1_warn,0) {
        C cx=281 cy=56 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
        T x=300 y=39 w=47 h=34 text="{$hdr1_warn:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    T x=42 y=30 w=204 h=52 text=TITLE size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget kvtable kv1 {"x":24,"y":24,"w":440,"h":162,"rows":[{"caption":"Label 1","fmt":"%.1f","state":true,"key":0},{"caption":"Label 2","fmt":"%.1f","state":false,"key":1},{"caption":"Label 3","fmt":"","state":false,"key":2}],"rowH":50,"gap":6,"valueW":176,"keys":{}}
G id=kv1 {
    R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=24 w=226 h=50 text="Label 1" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=24 w=176 h=50 text="{$kv1_v0:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($kv1_s0,2),#F2B233,if(eq($kv1_s0,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    R x=24.5 y=80.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=80 w=226 h=50 text="Label 2" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=80 w=176 h=50 text="{$kv1_v1:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    R x=24.5 y=136.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=136 w=226 h=50 text="Label 3" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=136 w=176 h=50 text=$kv1_v2 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget light lt1 {"x":24,"y":24,"w":18,"h":18,"keys":{}}
G id=lt1 {
    C v==1-eq($lt1_st,1)-eq($lt1_st,2)-eq($lt1_st,3) cx=33 cy=33 rx=9 ry=9 f=#A6A6B4
    C v==eq($lt1_st,1) cx=33 cy=33 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
    C v==eq($lt1_st,2) cx=33 cy=33 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
    C v==eq($lt1_st,3) cx=33 cy=33 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
}
# widget options og1 {"x":24,"y":24,"w":440,"h":54,"options":[{"label":"Auto","value":0,"key":0},{"label":"On","value":1,"key":1},{"label":"Off","value":2,"key":2}],"gap":10,"keys":{}}
G id=og1 {
    G id=og1_g0 {
        R id=og1_o0 click=1 x=24 y=24 w=140 h=54
        R v==eq($og1_sel,0) x=22.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=24.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=og1_g1 {
        R id=og1_o1 click=1 x=174 y=24 w=140 h=54
        R v==eq($og1_sel,1) x=172.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=174.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=og1_g2 {
        R id=og1_o2 click=1 x=324 y=24 w=140 h=54
        R v==eq($og1_sel,2) x=322.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=324.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T x=24 y=24 w=140 h=54 text=AUTO size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=174 y=24 w=140 h=54 text=ON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=324 y=24 w=140 h=54 text=OFF size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget panel pnl1 {"x":24,"y":24,"w":440,"h":300,"title":"Title","unit":""}
G id=pnl1 {
    R x=24.5 y=24.5 w=439 h=299 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
    T x=38 y=34 w=412 h=36.4 text=TITLE size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget readout ro1 {"x":24,"y":24,"w":345,"h":258.2,"variant":"hero","caption":"Label","unit":"","fmt":"%.0f","bar":true,"subFmt":"%.1f","keys":{}}
G id=ro1 {
    R x=24.5 y=201.7 w=344 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=206.2 w==clamp($ro1_lvl,0,1)*335 h=20 rx=2 f==if(eq($ro1_st,1),#7FD970,if(eq($ro1_st,2),#F2B233,if(eq($ro1_st,3),#F7777A,#A6A6B4)))
    T x=24 y=24 w=273 h=187.2 text="{$ro1_v:%.0f}" size=156 font="Barlow Condensed Bold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    T x=24 y=243 w=345 h=39.2 text=$ro1_status size=28 font="Barlow SemiBold" f==if(eq($ro1_st,1),#7FD970,if(eq($ro1_st,2),#F2B233,if(eq($ro1_st,3),#F7777A,#A6A6B4))) sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=24 y=243 w=345 h=39.2 text="{$ro1_sub:%.1f}" size=28 font="Barlow Medium" f=#C8C8D2 sh=[[0,2,2,0,#00000099]] align=right valign=middle
}
# widget readoutrow row1 {"x":24,"y":24,"w":440,"h":50,"name":"Label","fmt1":"%.1f","fmt2":"","w1":110,"w2":90,"keys":{}}
G id=row1 {
    R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    C v==1-eq($row1_st,1)-eq($row1_st,2)-eq($row1_st,3) cx=47 cy=49 rx=9 ry=9 f=#A6A6B4
    C v==eq($row1_st,1) cx=47 cy=49 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
    C v==eq($row1_st,2) cx=47 cy=49 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
    C v==eq($row1_st,3) cx=47 cy=49 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
    T x=66 y=24 w=264 h=50 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=340 y=24 w=110 h=50 text="{$row1_r1:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($row1_st,2),#F2B233,if(eq($row1_st,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget repeater rep1 {"x":24,"y":24,"w":440,"h":330,"max":6,"layout":"list","cols":2,"pitch":56,"item":"row","fmt":"%.1f","click":true,"keys":{}}
G id=rep1 {
    R x=24 y=24 w=440 h=330
    RP n=6 {
        G v==lt(i,$rep1_n) {
            R id=rep1_r click=1 x=24 y==24+i*56 w=440 h=50
            R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            C v==1-eq($rep1_st[i],1)-eq($rep1_st[i],2)-eq($rep1_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#A6A6B4
            C v==eq($rep1_st[i],1) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($rep1_st[i],2) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($rep1_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
            T x=66 y==24+i*56 w==lerp(244,384,clamp(and($rep1_ready,eq($rep1_hasv[i],0)),0,1)) h=50 text="$rep1_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T v==not(and($rep1_ready,eq($rep1_hasv[i],0))) x=320 y==24+i*56 w=130 h=50 text="{$rep1_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        }
    }
}
# widget stepper stp1 {"x":24,"y":24,"w":440,"h":54,"name":"Value","fmt":"%.0f","by":1,"min":0,"max":100,"keys":{}}
G id=stp1 {
    G id=stp1_gd {
        R id=stp1_dec press=1 x=226 y=24 w=54 h=54
        R x=226.5 y=24.5 w=53 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=stp1_gi {
        R id=stp1_inc press=1 x=410 y=24 w=54 h=54
        R x=410.5 y=24.5 w=53 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T x=24 y=24 w=192 h=54 text=Value size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=226 y=24 w=54 h=54 text=− size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
    T x=290 y=27.2 w=110 h=47.6 text="{$stp1_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
    T x=410 y=24 w=54 h=54 text=+ size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
}
# widget tabs nav1 {"x":24,"y":24,"w":432,"h":54,"tabs":[{"label":"Main","page":"p1","key":0},{"label":"Power","page":"p2","key":1}],"active":"p1","gap":10}
G id=nav1 {
    G id=nav1_g0 {
        R id=nav1_t0 click=1 x=24 y=24 w=211 h=54
        R x=22.5 y=22.5 w=214 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=24.5 y=24.5 w=210 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=nav1_g1 {
        R id=nav1_t1 click=1 x=245 y=24 w=211 h=54
        R x=245.5 y=24.5 w=210 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T x=24 y=24 w=211 h=54 text=MAIN size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=245 y=24 w=211 h=54 text=POWER size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget text txt1 {"x":24,"y":24,"w":300,"h":39.2,"style":"value","text":"Label","align":"left","state":false,"keys":{}}
G id=txt1 {
    T x=24 y=24 w=300 h=39.2 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget toggle tg1 {"x":24,"y":24,"w":300,"h":54,"label":"Label","onText":"On","offText":"Off","look":"button","keys":{}}
G id=tg1 {
    R id=tg1_hit click=1 x=24 y=24 w=300 h=54
    R v==$tg1_on x=22.5 y=22.5 w=303 h=57 rx=7.5 f=none s=#FF772D sw=3
    R x=24.5 y=24.5 w=299 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=42 y=24 w=180 h=54 text=LABEL size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T v==eq($tg1_on,0) x=222 y=24 w=84 h=54 text=OFF size=26 font="Barlow Condensed Bold" cspace=3.85 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=right valign=middle
    T v==eq($tg1_on,1) x=222 y=24 w=84 h=54 text=ON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
}
# widget gauge gauge1 {"x":24,"y":24,"w":300,"h":300,"label":"Label","unit":"","min":0,"max":100,"start":-135,"end":135,"ticks":5,"fmt":"%.0f","value":true,"state":true,"keys":{}}
G id=gauge1 {
    P d="M84.056015 247.14398 A127.2 127.2 0 0 1 174 30 A127.2 127.2 0 0 1 263.94397 247.14398" s=#8E8E9E sw=6
    L p=[97.547615,233.65239,84.056015,247.14398] s=#5A5A69 sw=2
    L p=[74.110146,115.824265,56.482525,108.52267] s=#5A5A69 sw=2
    L p=[174,49.08,174,30] s=#5A5A69 sw=2
    L p=[273.88986,115.824265,291.5175,108.52267] s=#5A5A69 sw=2
    L p=[250.4524,233.65239,263.94397,247.14398] s=#5A5A69 sw=2
    G a=[174,157.2] r==-135+clamp(($gauge1_v-0)/100,0,1)*270 {
        L p=[174,157.2,174,42.72] s==if(eq($gauge1_st,1),#7FD970,if(eq($gauge1_st,2),#F2B233,if(eq($gauge1_st,3),#F7777A,#A6A6B4))) sw=4
    }
    C cx=174 cy=157.2 rx=6 ry=6 f=#FFFFFF
    T x=24 y=163.2 w=300 h=47.6 text="{$gauge1_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
    T x=24 y=290.4 w=300 h=33.6 text=Label size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
R x=350 y=350 w=80 h=80 f=#123456
# widget glyph gl900 {"x":360,"y":360,"w":60,"h":60,"glyph":"cog","dir":"right","ink":"text-secondary"}
G id=gl900 {
    G t=[390,390] {
        RP n=8 {
            G r==i*45 {
                R x=-3.8059702 y=-30 w=7.6119404 h=11.641791 rx=1.7910448 f=#C8C8D2
            }
        }
        P d="M22.38806 0 A22.38806 22.38806 0 1 0 -22.38806 0 A22.38806 22.38806 0 1 0 22.38806 0 Z M8.955224 0 A8.955224 8.955224 0 1 0 -8.955224 0 A8.955224 8.955224 0 1 0 8.955224 0 Z" fr=evenodd f=#C8C8D2
    }
}
G v==lt(ver,11118) {
    R x=0 y=0 w=480 h=58 f=#000000CC
    T x=14.4 y=0 w=451.2 h=58 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=26 f=#FFCC00
}
]==],
      snap = { ["al1_st"] = true, ["al1_msg"] = true, ["bar1_st"] = true, ["duct1_run"] = true, ["log1_k"] = true, ["log1_m"] = true, ["hdr1_crit"] = true, ["hdr1_warn"] = true, ["kv1_v0"] = true, ["kv1_s0"] = true, ["kv1_v1"] = true, ["kv1_v2"] = true, ["lt1_st"] = true, ["og1_sel"] = true, ["ro1_v"] = true, ["ro1_st"] = true, ["ro1_status"] = true, ["ro1_sub"] = true, ["row1_st"] = true, ["row1_r1"] = true, ["rep1_n"] = true, ["rep1_name"] = true, ["rep1_v"] = true, ["rep1_hasv"] = true, ["rep1_ready"] = true, ["rep1_st"] = true, ["stp1_v"] = true, ["tg1_on"] = true, ["gauge1_v"] = true, ["gauge1_st"] = true }, samples = { ["al1_st"] = 2, ["al1_msg"] = "Message", ["bar1_lvl"] = 0.62, ["bar1_st"] = 1, ["duct1_run"] = 1, ["log1_k"] = { 3, 2, 1 }, ["log1_m"] = { "Message 1", "Message 2", "Message 3" }, ["hdr1_crit"] = 1, ["hdr1_warn"] = 2, ["kv1_v0"] = 21.4, ["kv1_s0"] = 1, ["kv1_v1"] = 21.4, ["kv1_v2"] = "Auto", ["lt1_st"] = 1, ["og1_sel"] = 0, ["ro1_v"] = 78, ["ro1_lvl"] = 0.78, ["ro1_st"] = 1, ["ro1_status"] = "Status", ["ro1_sub"] = 101.3, ["row1_st"] = 1, ["row1_r1"] = 21.4, ["rep1_n"] = 4, ["rep1_name"] = { "Item 1", "Item 2", "Item 3", "Item 4" }, ["rep1_v"] = { 21.4, 19.8, 0, 101.3 }, ["rep1_st"] = { 1, 2, 0, 3 }, ["stp1_v"] = 12, ["tg1_on"] = 1, ["gauge1_v"] = 50, ["gauge1_st"] = 1 }, nils = { ["al1_st"] = 0, ["al1_msg"] = "--", ["bar1_st"] = 0, ["duct1_run"] = 0, ["log1_k"] = { 0 }, ["log1_m"] = { "" }, ["hdr1_crit"] = 0, ["hdr1_warn"] = 0, ["kv1_v0"] = "--", ["kv1_s0"] = 0, ["kv1_v1"] = "--", ["kv1_v2"] = "--", ["lt1_st"] = 0, ["og1_sel"] = 0, ["ro1_v"] = "--", ["ro1_st"] = 0, ["ro1_status"] = "--", ["ro1_sub"] = "--", ["row1_st"] = 0, ["row1_r1"] = "--", ["rep1_n"] = 0, ["rep1_name"] = { "" }, ["rep1_v"] = { "" }, ["rep1_hasv"] = { 0 }, ["rep1_ready"] = 0, ["rep1_st"] = { 0 }, ["tg1_on"] = 0, ["gauge1_st"] = 0 }, eased = { ["bar1_lvl"] = 0.00125, ["ro1_lvl"] = 0 }, arrays = {  },
      repeaters = { { n = "rep1_n", v = "rep1_v", hasv = "rep1_hasv", ready = "rep1_ready", max = 6 } },
      data = function(o)
      end,
      natives = { { uid = "ico1", type = "icon", x = 24, y = 24, w = 66, h = 66, props = { ["icon_type"] = "gas", ["name"] = "Oxygen", ["z_index"] = 6 }, style = {  } }, { uid = "ti1", type = "textinput", x = 24, y = 24, w = 300, h = 54, props = { ["value"] = "", ["placeholder"] = "Text", ["z_index"] = 22 }, style = { ["bg"] = "#111116", ["text"] = "#FFFFFF", ["placeholder_color"] = "#A6A6B4" }, font = 26 } },
      empty = false, w = 460, h = 460, dw = 480, dh = 480, fit = "contain" },
    { id = "p2", surface = "page2", bg = { bg = "#3A3A43", gradient = "#24242A" }, src = [==[
SCENE w=480 h=480 fit=contain
DEFS {
    GL id=theme_row units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#3B3B45],[1,#32323A]]
    GL id=theme_brand units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#1D4F7F],[1,#0D3B6A]]
}
# widget alert al100 {"x":24,"y":24,"w":440,"h":50,"row":true,"keys":{}}
G id=al100 {
    R x=24 y=24 w=440 h=50
    G v==gt($al100_st,0) {
        R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        R x=38 y=31.6 w=86 h=34.8 rx=4 f==if(eq($al100_st,1),#7FD970,if(eq($al100_st,2),#F2B233,if(eq($al100_st,3),#F7777A,#A6A6B4)))
        T v==eq($al100_st,1) x=38 y=31.6 w=86 h=34.8 text=OK size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T v==eq($al100_st,2) x=38 y=31.6 w=86 h=34.8 text=WARN size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T v==eq($al100_st,3) x=38 y=31.6 w=86 h=34.8 text=CRIT size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T x=138 y=28 w=312 h=42 text=$al100_msg size=26 font="Barlow Medium" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
}
# widget alert al101 {"x":24,"y":24,"w":440,"h":50,"row":true,"keys":{}}
G id=al101 {
    R x=24 y=24 w=440 h=50
    G v==gt($al101_st,0) {
        R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        R x=38 y=31.6 w=86 h=34.8 rx=4 f==if(eq($al101_st,1),#7FD970,if(eq($al101_st,2),#F2B233,if(eq($al101_st,3),#F7777A,#A6A6B4)))
        T v==eq($al101_st,1) x=38 y=31.6 w=86 h=34.8 text=OK size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T v==eq($al101_st,2) x=38 y=31.6 w=86 h=34.8 text=WARN size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T v==eq($al101_st,3) x=38 y=31.6 w=86 h=34.8 text=CRIT size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
        T x=138 y=28 w=312 h=42 text=$al101_msg size=26 font="Barlow Medium" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
}
# widget bar bar102 {"x":24,"y":24,"w":400,"h":30,"orient":"h","stateMode":"bound","marks":[],"target":false,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":0,"keys":{}}
G id=bar102 {
    R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=29 w==clamp($bar102_lvl,0,1)*390 h=20 rx=2 f==if(eq($bar102_st,1),#7FD970,if(eq($bar102_st,2),#F2B233,if(eq($bar102_st,3),#F7777A,#A6A6B4)))
}
# widget bar bar103 {"x":24,"y":24,"w":400,"h":30,"orient":"h","stateMode":"bound","marks":[],"target":false,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":0,"keys":{}}
G id=bar103 {
    R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=29 w==clamp($bar103_lvl,0,1)*390 h=20 rx=2 f==if(eq($bar103_st,1),#7FD970,if(eq($bar103_st,2),#F2B233,if(eq($bar103_st,3),#F7777A,#A6A6B4)))
}
# widget bar bar104 {"x":24,"y":24,"w":400,"h":30,"orient":"v","stateMode":"bound","marks":[],"target":false,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":0,"keys":{}}
G id=bar104 {
    R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y==49-clamp($bar104_lvl,0,1)*20 w=390 h==clamp($bar104_lvl,0,1)*20 rx=2 f==if(eq($bar104_st,1),#7FD970,if(eq($bar104_st,2),#F2B233,if(eq($bar104_st,3),#F7777A,#A6A6B4)))
}
# widget bar bar105 {"x":24,"y":24,"w":400,"h":30,"orient":"h","stateMode":"bound","marks":[],"target":false,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":0,"keys":{}}
G id=bar105 {
    R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=29 w==clamp($bar105_lvl,0,1)*390 h=20 rx=2 f==if(eq($bar105_st,1),#7FD970,if(eq($bar105_st,2),#F2B233,if(eq($bar105_st,3),#F7777A,#A6A6B4)))
}
# widget bar bar106 {"x":24,"y":24,"w":400,"h":30,"orient":"h","stateMode":"auto","marks":[],"target":false,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":0,"keys":{}}
G id=bar106 {
    R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=29 w==clamp($bar106_lvl,0,1)*390 h=20 rx=2 f==if(lt($bar106_lvl,0.1),#F7777A,if(lt($bar106_lvl,0.25),#F2B233,#7FD970))
}
# widget bar bar107 {"x":24,"y":24,"w":400,"h":30,"orient":"h","stateMode":"ok","marks":[],"target":false,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":0,"keys":{}}
G id=bar107 {
    R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=29 w==clamp($bar107_lvl,0,1)*390 h=20 rx=2 f=#7FD970
}
# widget bar bar108 {"x":24,"y":24,"w":400,"h":30,"orient":"h","stateMode":"bound","marks":[],"target":true,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":0,"keys":{}}
G id=bar108 {
    R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=29 w==clamp($bar108_lvl,0,1)*390 h=20 rx=2 f==if(eq($bar108_st,1),#7FD970,if(eq($bar108_st,2),#F2B233,if(eq($bar108_st,3),#F7777A,#A6A6B4)))
    R x==28+clamp($bar108_tgt,0,1)*390 y=25 w=2 h=28 f=#FFFFFF
}
# widget bar bar109 {"x":24,"y":24,"w":400,"h":40,"orient":"h","stateMode":"bound","marks":[],"target":false,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":4,"keys":{}}
G id=bar109 {
    RP n=4 {
        R x==24+i*101+0.5 y=24.5 w=96 h=39 rx=3.5 f=#111116 s=#5A5A69 sw=1
        R x==29+i*101 y==59-30*clamp(clamp($bar109_lvl,0,1)*4-i,0,1) w=87 h==30*clamp(clamp($bar109_lvl,0,1)*4-i,0,1) rx=2 f==if(eq($bar109_st,1),#7FD970,if(eq($bar109_st,2),#F2B233,if(eq($bar109_st,3),#F7777A,#A6A6B4)))
    }
}
# widget bar bar110 {"x":24,"y":24,"w":400,"h":40,"orient":"h","stateMode":"bound","marks":[],"target":true,"floor":0,"critBelow":0.1,"warnBelow":0.25,"cells":4,"keys":{}}
G id=bar110 {
    RP n=4 {
        R x==24+i*101+0.5 y=24.5 w=96 h=39 rx=3.5 f=#111116 s=#5A5A69 sw=1
        R x==29+i*101 y==59-30*clamp(clamp($bar110_lvl,0,1)*4-i,0,1) w=87 h==30*clamp(clamp($bar110_lvl,0,1)*4-i,0,1) rx=2 f==if(eq($bar110_st,1),#7FD970,if(eq($bar110_st,2),#F2B233,if(eq($bar110_st,3),#F7777A,#A6A6B4)))
    }
}
# widget button btn111 {"x":24,"y":24,"w":200,"h":54,"states":[{"label":"Button","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=btn111 {
    R id=btn111_hit click=1 x=24 y=24 w=200 h=54
    R x=24.5 y=24.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=42 y=24 w=164 h=54 text=BUTTON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget button btn112 {"x":24,"y":24,"w":200,"h":54,"states":[{"label":"Button","variant":"secondary","key":0},{"label":"Button","variant":"secondary","key":1},{"label":"Button","variant":"secondary","key":2}],"canDisable":false,"canSelect":false,"keys":{}}
G id=btn112 {
    R id=btn112_hit click=1 x=24 y=24 w=200 h=54
    G v==eq($btn112_state,0) {
        R x=24.5 y=24.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G v==eq($btn112_state,1) {
        R x=24.5 y=24.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G v==eq($btn112_state,2) {
        R x=24.5 y=24.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T v==eq($btn112_state,0) x=42 y=24 w=164 h=54 text=BUTTON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T v==eq($btn112_state,1) x=42 y=24 w=164 h=54 text=BUTTON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T v==eq($btn112_state,2) x=42 y=24 w=164 h=54 text=BUTTON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget button btn113 {"x":24,"y":24,"w":200,"h":54,"states":[{"label":"Button","variant":"secondary","key":0}],"canDisable":true,"canSelect":false,"keys":{}}
G id=btn113 {
    R id=btn113_hit click=1 v==1-$btn113_dis x=24 y=24 w=200 h=54
    G o==1-0.5*$btn113_dis {
        R x=24.5 y=24.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
        T x=42 y=24 w=164 h=54 text=BUTTON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    }
}
# widget button btn114 {"x":24,"y":24,"w":200,"h":54,"states":[{"label":"Button","variant":"secondary","key":0}],"canDisable":false,"canSelect":true,"keys":{}}
G id=btn114 {
    R id=btn114_hit click=1 x=24 y=24 w=200 h=54
    R v==$btn114_sel x=22.5 y=22.5 w=203 h=57 rx=7.5 f=none s=#FF772D sw=3
    R x=24.5 y=24.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=42 y=24 w=164 h=54 text=BUTTON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget duct duct115 {"x":24,"y":24,"w":300,"h":4,"dir":"h","period":22,"dash":11,"speed":20,"idle":0,"keys":{}}
G id=duct115 {
    R x=24 y=24 w=300 h=4 f=#5A5A69
    L p=[24,26,324,26] sw=4 s=#C8C8D2 cap=butt dash=[11,11] dofs==-mod(t*20,22) so==clamp($duct115_run,0,1)
}
# widget duct duct116 {"x":24,"y":24,"w":300,"h":4,"dir":"h","period":22,"dash":11,"speed":20,"idle":0,"keys":{}}
G id=duct116 {
    R x=24 y=24 w=300 h=4 f=#5A5A69
    L p=[24,26,324,26] sw=4 s=#C8C8D2 cap=butt dash=[11,11] dofs==-mod(t*20,22) so==clamp($duct116_run,0,1)
}
# widget duct duct117 {"x":24,"y":24,"w":300,"h":4,"dir":"v","period":22,"dash":11,"speed":20,"idle":0,"keys":{}}
G id=duct117 {
    R x=24 y=24 w=300 h=4 f=#5A5A69
    L p=[174,24,174,28] sw=300 s=#C8C8D2 cap=butt dash=[11,11] dofs==-mod(t*20,22) so==clamp($duct117_run,0,1)
}
# widget eventlog log118 {"x":24,"y":24,"w":440,"h":218,"rows":4,"time":false,"pitch":56,"keys":{}}
G id=log118 {
    R x=24 y=24 w=440 h=218
    RP n=4 {
        G v==gt($log118_k[i],0) {
            R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            R x=38 y==24+i*56+7.6 w=86 h=34.8 rx=4 f==if(eq($log118_k[i],1),#7FD970,if(eq($log118_k[i],2),#F2B233,if(eq($log118_k[i],3),#F7777A,#A6A6B4)))
            T v==eq($log118_k[i],1) x=38 y==24+i*56+7.6 w=86 h=34.8 text=OK size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T v==eq($log118_k[i],2) x=38 y==24+i*56+7.6 w=86 h=34.8 text=WARN size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T v==eq($log118_k[i],3) x=38 y==24+i*56+7.6 w=86 h=34.8 text=CRIT size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T x=138 y==24+i*56 w=312 h=50 text="$log118_m[i]" size=26 font="Barlow Medium" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
        }
    }
}
# widget eventlog log119 {"x":24,"y":24,"w":440,"h":218,"rows":4,"time":true,"pitch":56,"keys":{}}
G id=log119 {
    R x=24 y=24 w=440 h=218
    RP n=4 {
        G v==gt($log119_k[i],0) {
            R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            R x=38 y==24+i*56+7.6 w=86 h=34.8 rx=4 f==if(eq($log119_k[i],1),#7FD970,if(eq($log119_k[i],2),#F2B233,if(eq($log119_k[i],3),#F7777A,#A6A6B4)))
            T v==eq($log119_k[i],1) x=38 y==24+i*56+7.6 w=86 h=34.8 text=OK size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T v==eq($log119_k[i],2) x=38 y==24+i*56+7.6 w=86 h=34.8 text=WARN size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T v==eq($log119_k[i],3) x=38 y==24+i*56+7.6 w=86 h=34.8 text=CRIT size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
            T x=138 y==24+i*56 w=80 h=50 text="$log119_t[i]" size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T x=228 y==24+i*56 w=222 h=50 text="$log119_m[i]" size=26 font="Barlow Medium" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
        }
    }
}
# widget glyph gl120 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"text-secondary"}
G id=gl120 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C8C8D2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C8C8D2
    }
}
# widget glyph gl121 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"text-secondary"}
G id=gl121 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C8C8D2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C8C8D2
    }
}
# widget glyph gl122 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"arrow","dir":"right","ink":"text-secondary"}
G id=gl122 {
    Y p=[24,24,42.2,33.1,24,42.2] f=#C8C8D2
}
# widget glyph gl123 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"check","dir":"right","ink":"text-secondary"}
G id=gl123 {
    L p=[26.73,34.010002,31.28,38.56,39.47,27.64] s=#C8C8D2 sw=2.275 cap=round join=round
}
# widget glyph gl124 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cross","dir":"right","ink":"text-secondary"}
G id=gl124 {
    L p=[27.64,27.64,38.56,38.56] s=#C8C8D2 sw=2.275 cap=round
    L p=[38.56,27.64,27.64,38.56] s=#C8C8D2 sw=2.275 cap=round
}
# widget glyph gl125 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"text-secondary"}
G id=gl125 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C8C8D2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C8C8D2
    }
}
# widget glyph gl126 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"left","ink":"text-secondary"}
G id=gl126 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C8C8D2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C8C8D2
    }
}
# widget glyph gl127 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"up","ink":"text-secondary"}
G id=gl127 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C8C8D2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C8C8D2
    }
}
# widget glyph gl128 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"down","ink":"text-secondary"}
G id=gl128 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C8C8D2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C8C8D2
    }
}
# widget glyph gl129 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"surface-screen-hi"}
G id=gl129 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#3A3A43
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#3A3A43
    }
}
# widget glyph gl130 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"surface-screen"}
G id=gl130 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#313139
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#313139
    }
}
# widget glyph gl131 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"surface-screen-lo"}
G id=gl131 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#24242A
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#24242A
    }
}
# widget glyph gl132 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"surface-panel"}
G id=gl132 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#1D1D23
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#1D1D23
    }
}
# widget glyph gl133 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"surface-row-hi"}
G id=gl133 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#3B3B45
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#3B3B45
    }
}
# widget glyph gl134 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"surface-row"}
G id=gl134 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#36363F
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#36363F
    }
}
# widget glyph gl135 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"surface-row-lo"}
G id=gl135 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#32323A
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#32323A
    }
}
# widget glyph gl136 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"surface-well"}
G id=gl136 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#111116
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#111116
    }
}
# widget glyph gl137 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"border"}
G id=gl137 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#5A5A69
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#5A5A69
    }
}
# widget glyph gl138 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"border-strong"}
G id=gl138 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#8E8E9E
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#8E8E9E
    }
}
# widget glyph gl139 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"text"}
G id=gl139 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#FFFFFF
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#FFFFFF
    }
}
# widget glyph gl140 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"text-secondary"}
G id=gl140 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C8C8D2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C8C8D2
    }
}
# widget glyph gl141 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"text-muted"}
G id=gl141 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#A6A6B4
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#A6A6B4
    }
}
# widget glyph gl142 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"accent"}
G id=gl142 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#FF772D
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#FF772D
    }
}
# widget glyph gl143 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"brand-hi"}
G id=gl143 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#1D4F7F
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#1D4F7F
    }
}
# widget glyph gl144 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"brand"}
G id=gl144 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#17487A
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#17487A
    }
}
# widget glyph gl145 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"brand-lo"}
G id=gl145 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#0D3B6A
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#0D3B6A
    }
}
# widget glyph gl146 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"on-brand"}
G id=gl146 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#FFFFFF
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#FFFFFF
    }
}
# widget glyph gl147 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"status-ok"}
G id=gl147 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#7FD970
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#7FD970
    }
}
# widget glyph gl148 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"status-warn"}
G id=gl148 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#F2B233
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#F2B233
    }
}
# widget glyph gl149 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"status-crit"}
G id=gl149 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#F7777A
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#F7777A
    }
}
# widget glyph gl150 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"status-idle"}
G id=gl150 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#A6A6B4
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#A6A6B4
    }
}
# widget glyph gl151 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"on-status"}
G id=gl151 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#17171B
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#17171B
    }
}
# widget glyph gl152 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"danger"}
G id=gl152 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#B93237
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#B93237
    }
}
# widget glyph gl153 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"danger-lo"}
G id=gl153 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#932629
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#932629
    }
}
# widget glyph gl154 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"on-danger"}
G id=gl154 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#FFFFFF
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#FFFFFF
    }
}
# widget glyph gl155 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-outline"}
G id=gl155 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#FFFFFF
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#FFFFFF
    }
}
# widget glyph gl156 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"on-gas-light"}
G id=gl156 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#17171B
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#17171B
    }
}
# widget glyph gl157 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"on-gas-dark"}
G id=gl157 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#FFFFFF
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#FFFFFF
    }
}
# widget glyph gl158 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-o2"}
G id=gl158 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#F2F2F2
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#F2F2F2
    }
}
# widget glyph gl159 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-n2"}
G id=gl159 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#101113
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#101113
    }
}
# widget glyph gl160 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-n2-fill"}
G id=gl160 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#5E6F82
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#5E6F82
    }
}
# widget glyph gl161 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-co2"}
G id=gl161 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#4A4D52
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#4A4D52
    }
}
# widget glyph gl162 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-co2-fill"}
G id=gl162 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#A39A8E
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#A39A8E
    }
}
# widget glyph gl163 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-h2"}
G id=gl163 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#B93237
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#B93237
    }
}
# widget glyph gl164 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-h2-alt"}
G id=gl164 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#6E747C
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#6E747C
    }
}
# widget glyph gl165 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-h2-fill"}
G id=gl165 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#C23A30
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#C23A30
    }
}
# widget glyph gl166 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-ch4"}
G id=gl166 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#B93237
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#B93237
    }
}
# widget glyph gl167 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-ch4-fill"}
G id=gl167 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#F0705F
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#F0705F
    }
}
# widget glyph gl168 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-n2o"}
G id=gl168 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#4FB85C
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#4FB85C
    }
}
# widget glyph gl169 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-x"}
G id=gl169 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#F2C91E
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#F2C91E
    }
}
# widget glyph gl170 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-o3"}
G id=gl170 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#7A4FC4
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#7A4FC4
    }
}
# widget glyph gl171 {"x":24,"y":24,"w":18.2,"h":18.2,"glyph":"cog","dir":"right","ink":"gas-o3-fill"}
G id=gl171 {
    G t=[33.1,33.1] {
        RP n=8 {
            G r==i*45 {
                R x=-1.1544777 y=-9.1 w=2.3089554 h=3.5313435 rx=0.5432836 f=#A583E8
            }
        }
        P d="M6.791045 0 A6.791045 6.791045 0 1 0 -6.791045 0 A6.791045 6.791045 0 1 0 6.791045 0 Z M2.716418 0 A2.716418 2.716418 0 1 0 -2.716418 0 A2.716418 2.716418 0 1 0 2.716418 0 Z" fr=evenodd f=#A583E8
    }
}
# widget header hdr172 {"x":24,"y":24,"w":432,"h":64,"title":"Title","clock":false,"counts":true,"keys":{}}
G id=hdr172 {
    R x=25.5 y=25.5 w=429 h=61 rx=12.5 f=@theme_brand s=#FF772D sw=3
    G v==gt($hdr172_crit,0) {
        C cx=372 cy=56 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
        T x=391 y=39 w=47 h=34 text="{$hdr172_crit:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    G v==gt($hdr172_warn,0) {
        C cx=281 cy=56 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
        T x=300 y=39 w=47 h=34 text="{$hdr172_warn:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    T x=42 y=30 w=204 h=52 text=TITLE size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget header hdr173 {"x":24,"y":24,"w":432,"h":64,"title":"Title","clock":true,"counts":true,"keys":{}}
G id=hdr173 {
    R x=25.5 y=25.5 w=429 h=61 rx=12.5 f=@theme_brand s=#FF772D sw=3
    G v==gt($hdr173_crit,0) {
        C cx=242 cy=56 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
        T x=261 y=39 w=47 h=34 text="{$hdr173_crit:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    G v==gt($hdr173_warn,0) {
        C cx=151 cy=56 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
        T x=170 y=39 w=47 h=34 text="{$hdr173_warn:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    T x=42 y=30 w=74 h=52 text=TITLE size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=318 y=30 w=120 h=52 text=$hdr173_clock size=28 font="Barlow Condensed SemiBold" cspace=3.57 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget header hdr174 {"x":24,"y":24,"w":432,"h":64,"title":"Title","clock":false,"counts":true,"keys":{}}
G id=hdr174 {
    R x=25.5 y=25.5 w=429 h=61 rx=12.5 f=@theme_brand s=#FF772D sw=3
    G v==gt($hdr174_crit,0) {
        C cx=372 cy=56 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
        T x=391 y=39 w=47 h=34 text="{$hdr174_crit:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    G v==gt($hdr174_warn,0) {
        C cx=281 cy=56 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
        T x=300 y=39 w=47 h=34 text="{$hdr174_warn:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    T x=42 y=30 w=204 h=52 text=TITLE size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget kvtable kv175 {"x":24,"y":24,"w":440,"h":162,"rows":[{"caption":"Label 1","fmt":"%.1f","state":true,"key":0},{"caption":"Label 2","fmt":"%.1f","state":false,"key":1},{"caption":"Label 3","fmt":"","state":false,"key":2}],"rowH":50,"gap":6,"valueW":176,"keys":{}}
G id=kv175 {
    R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=24 w=226 h=50 text="Label 1" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=24 w=176 h=50 text="{$kv175_v0:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($kv175_s0,2),#F2B233,if(eq($kv175_s0,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    R x=24.5 y=80.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=80 w=226 h=50 text="Label 2" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=80 w=176 h=50 text="{$kv175_v1:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    R x=24.5 y=136.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=136 w=226 h=50 text="Label 3" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=136 w=176 h=50 text=$kv175_v2 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget kvtable kv176 {"x":24,"y":24,"w":440,"h":162,"rows":[{"caption":"Label 1","fmt":"%.1f","state":true,"key":0},{"caption":"Label 1","fmt":"%.1f","state":true,"key":1},{"caption":"Label 1","fmt":"%.1f","state":true,"key":2}],"rowH":50,"gap":6,"valueW":176,"keys":{}}
G id=kv176 {
    R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=24 w=226 h=50 text="Label 1" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=24 w=176 h=50 text="{$kv176_v0:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($kv176_s0,2),#F2B233,if(eq($kv176_s0,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    R x=24.5 y=80.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=80 w=226 h=50 text="Label 1" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=80 w=176 h=50 text="{$kv176_v1:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($kv176_s1,2),#F2B233,if(eq($kv176_s1,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    R x=24.5 y=136.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    T x=38 y=136 w=226 h=50 text="Label 1" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=274 y=136 w=176 h=50 text="{$kv176_v2:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($kv176_s2,2),#F2B233,if(eq($kv176_s2,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget light lt177 {"x":24,"y":24,"w":18,"h":18,"keys":{}}
G id=lt177 {
    C v==1-eq($lt177_st,1)-eq($lt177_st,2)-eq($lt177_st,3) cx=33 cy=33 rx=9 ry=9 f=#A6A6B4
    C v==eq($lt177_st,1) cx=33 cy=33 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
    C v==eq($lt177_st,2) cx=33 cy=33 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
    C v==eq($lt177_st,3) cx=33 cy=33 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
}
# widget options og178 {"x":24,"y":24,"w":440,"h":54,"options":[{"label":"Auto","value":0,"key":0},{"label":"On","value":1,"key":1},{"label":"Off","value":2,"key":2}],"gap":10,"keys":{}}
G id=og178 {
    G id=og178_g0 {
        R id=og178_o0 click=1 x=24 y=24 w=140 h=54
        R v==eq($og178_sel,0) x=22.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=24.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=og178_g1 {
        R id=og178_o1 click=1 x=174 y=24 w=140 h=54
        R v==eq($og178_sel,1) x=172.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=174.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=og178_g2 {
        R id=og178_o2 click=1 x=324 y=24 w=140 h=54
        R v==eq($og178_sel,2) x=322.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=324.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T x=24 y=24 w=140 h=54 text=AUTO size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=174 y=24 w=140 h=54 text=ON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=324 y=24 w=140 h=54 text=OFF size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget options og179 {"x":24,"y":24,"w":440,"h":54,"options":[{"label":"Auto","value":0,"key":0},{"label":"Auto","value":0,"key":1},{"label":"Auto","value":0,"key":2}],"gap":10,"keys":{}}
G id=og179 {
    G id=og179_g0 {
        R id=og179_o0 click=1 x=24 y=24 w=140 h=54
        R v==eq($og179_sel,0) x=22.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=24.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=og179_g1 {
        R id=og179_o1 click=1 x=174 y=24 w=140 h=54
        R v==eq($og179_sel,0) x=172.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=174.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=og179_g2 {
        R id=og179_o2 click=1 x=324 y=24 w=140 h=54
        R v==eq($og179_sel,0) x=322.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=324.5 y=24.5 w=139 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T x=24 y=24 w=140 h=54 text=AUTO size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=174 y=24 w=140 h=54 text=AUTO size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=324 y=24 w=140 h=54 text=AUTO size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget panel pnl180 {"x":24,"y":24,"w":440,"h":300,"title":"Title","unit":""}
G id=pnl180 {
    R x=24.5 y=24.5 w=439 h=299 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
    T x=38 y=34 w=412 h=36.4 text=TITLE size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget readout ro181 {"x":24,"y":24,"w":345,"h":258.2,"variant":"hero","caption":"Label","unit":"","fmt":"%.0f","bar":true,"subFmt":"%.1f","keys":{}}
G id=ro181 {
    R x=24.5 y=201.7 w=344 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=206.2 w==clamp($ro181_lvl,0,1)*335 h=20 rx=2 f==if(eq($ro181_st,1),#7FD970,if(eq($ro181_st,2),#F2B233,if(eq($ro181_st,3),#F7777A,#A6A6B4)))
    T x=24 y=24 w=273 h=187.2 text="{$ro181_v:%.0f}" size=156 font="Barlow Condensed Bold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    T x=24 y=243 w=345 h=39.2 text=$ro181_status size=28 font="Barlow SemiBold" f==if(eq($ro181_st,1),#7FD970,if(eq($ro181_st,2),#F2B233,if(eq($ro181_st,3),#F7777A,#A6A6B4))) sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=24 y=243 w=345 h=39.2 text="{$ro181_sub:%.1f}" size=28 font="Barlow Medium" f=#C8C8D2 sh=[[0,2,2,0,#00000099]] align=right valign=middle
}
# widget readout ro182 {"x":24,"y":24,"w":345,"h":258.2,"variant":"hero","caption":"Label","unit":"","fmt":"%.0f","bar":true,"subFmt":"%.1f","keys":{}}
G id=ro182 {
    R x=24.5 y=201.7 w=344 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=206.2 w==clamp($ro182_lvl,0,1)*335 h=20 rx=2 f==if(eq($ro182_st,1),#7FD970,if(eq($ro182_st,2),#F2B233,if(eq($ro182_st,3),#F7777A,#A6A6B4)))
    T x=24 y=24 w=273 h=187.2 text="{$ro182_v:%.0f}" size=156 font="Barlow Condensed Bold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    T x=24 y=243 w=345 h=39.2 text=$ro182_status size=28 font="Barlow SemiBold" f==if(eq($ro182_st,1),#7FD970,if(eq($ro182_st,2),#F2B233,if(eq($ro182_st,3),#F7777A,#A6A6B4))) sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=24 y=243 w=345 h=39.2 text="{$ro182_sub:%.1f}" size=28 font="Barlow Medium" f=#C8C8D2 sh=[[0,2,2,0,#00000099]] align=right valign=middle
}
# widget readout ro183 {"x":24,"y":24,"w":345,"h":88,"variant":"kpi","caption":"Label","unit":"","fmt":"%.0f","bar":true,"subFmt":"%.1f","keys":{}}
G id=ro183 {
    R x=24 y=109 w==clamp($ro183_lvl,0,1)*345 h=3 f==if(eq($ro183_st,1),#7FD970,if(eq($ro183_st,2),#F2B233,if(eq($ro183_st,3),#F7777A,#A6A6B4)))
    T x=24 y=24 w=345 h=33.6 text=Label size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=24 y=57.6 w=345 h=47.6 text="{$ro183_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle
}
# widget readout ro184 {"x":24,"y":24,"w":345,"h":39.2,"variant":"compact","caption":"Label","unit":"","fmt":"%.0f","bar":true,"subFmt":"%.1f","keys":{}}
G id=ro184 {
    C v==1-eq($ro184_st,1)-eq($ro184_st,2)-eq($ro184_st,3) cx=33 cy=43.6 rx=9 ry=9 f=#A6A6B4
    C v==eq($ro184_st,1) cx=33 cy=43.6 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
    C v==eq($ro184_st,2) cx=33 cy=43.6 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
    C v==eq($ro184_st,3) cx=33 cy=43.6 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
    T x=52 y=24 w=187 h=39.2 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=249 y=24 w=120 h=39.2 text=$ro184_status size=28 font="Barlow SemiBold" f==if(eq($ro184_st,1),#7FD970,if(eq($ro184_st,2),#F2B233,if(eq($ro184_st,3),#F7777A,#A6A6B4))) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget readout ro185 {"x":24,"y":24,"w":345,"h":258.2,"variant":"hero","caption":"Label","unit":"","fmt":"%.0f","bar":true,"subFmt":"%.1f","keys":{}}
G id=ro185 {
    R x=24.5 y=201.7 w=344 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
    R x=29 y=206.2 w==clamp($ro185_lvl,0,1)*335 h=20 rx=2 f==if(eq($ro185_st,1),#7FD970,if(eq($ro185_st,2),#F2B233,if(eq($ro185_st,3),#F7777A,#A6A6B4)))
    T x=24 y=24 w=273 h=187.2 text="{$ro185_v:%.0f}" size=156 font="Barlow Condensed Bold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    T x=24 y=243 w=345 h=39.2 text=$ro185_status size=28 font="Barlow SemiBold" f==if(eq($ro185_st,1),#7FD970,if(eq($ro185_st,2),#F2B233,if(eq($ro185_st,3),#F7777A,#A6A6B4))) sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=24 y=243 w=345 h=39.2 text="{$ro185_sub:%.1f}" size=28 font="Barlow Medium" f=#C8C8D2 sh=[[0,2,2,0,#00000099]] align=right valign=middle
}
# widget readoutrow row186 {"x":24,"y":24,"w":440,"h":50,"name":"Label","fmt1":"%.1f","fmt2":"","w1":110,"w2":90,"keys":{}}
G id=row186 {
    R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
    C v==1-eq($row186_st,1)-eq($row186_st,2)-eq($row186_st,3) cx=47 cy=49 rx=9 ry=9 f=#A6A6B4
    C v==eq($row186_st,1) cx=47 cy=49 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
    C v==eq($row186_st,2) cx=47 cy=49 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
    C v==eq($row186_st,3) cx=47 cy=49 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
    T x=66 y=24 w=264 h=50 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=340 y=24 w=110 h=50 text="{$row186_r1:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($row186_st,2),#F2B233,if(eq($row186_st,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget repeater rep187 {"x":24,"y":24,"w":440,"h":330,"max":6,"layout":"list","cols":2,"pitch":56,"item":"row","fmt":"%.1f","click":false,"keys":{}}
G id=rep187 {
    R x=24 y=24 w=440 h=330
    RP n=6 {
        G v==lt(i,$rep187_n) {
            R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            C v==1-eq($rep187_st[i],1)-eq($rep187_st[i],2)-eq($rep187_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#A6A6B4
            C v==eq($rep187_st[i],1) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($rep187_st[i],2) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($rep187_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
            T x=66 y==24+i*56 w==lerp(244,384,clamp(and($rep187_ready,eq($rep187_hasv[i],0)),0,1)) h=50 text="$rep187_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T v==not(and($rep187_ready,eq($rep187_hasv[i],0))) x=320 y==24+i*56 w=130 h=50 text="{$rep187_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        }
    }
}
# widget repeater rep188 {"x":24,"y":24,"w":440,"h":330,"max":6,"layout":"list","cols":2,"pitch":56,"item":"row","fmt":"%.1f","click":false,"keys":{}}
G id=rep188 {
    R x=24 y=24 w=440 h=330
    RP n=6 {
        G v==lt(i,$rep188_n) {
            R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            C v==1-eq($rep188_st[i],1)-eq($rep188_st[i],2)-eq($rep188_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#A6A6B4
            C v==eq($rep188_st[i],1) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($rep188_st[i],2) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($rep188_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
            T x=66 y==24+i*56 w==lerp(244,384,clamp(and($rep188_ready,eq($rep188_hasv[i],0)),0,1)) h=50 text="$rep188_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T v==not(and($rep188_ready,eq($rep188_hasv[i],0))) x=320 y==24+i*56 w=130 h=50 text="{$rep188_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        }
    }
}
# widget repeater rep189 {"x":24,"y":24,"w":440,"h":162,"max":6,"layout":"grid","cols":2,"pitch":56,"item":"row","fmt":"%.1f","click":false,"keys":{}}
G id=rep189 {
    R x=24 y=24 w=440 h=162
    RP n=6 {
        G v==lt(i,$rep189_n) {
            R x==24+mod(i,2)*225+0.5 y==24+floor(i/2)*56+0.5 w=214 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            C v==1-eq($rep189_st[i],1)-eq($rep189_st[i],2)-eq($rep189_st[i],3) cx==24+mod(i,2)*225+23 cy==24+floor(i/2)*56+25 rx=9 ry=9 f=#A6A6B4
            C v==eq($rep189_st[i],1) cx==24+mod(i,2)*225+23 cy==24+floor(i/2)*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($rep189_st[i],2) cx==24+mod(i,2)*225+23 cy==24+floor(i/2)*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($rep189_st[i],3) cx==24+mod(i,2)*225+23 cy==24+floor(i/2)*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
            T x==24+mod(i,2)*225+42 y==24+floor(i/2)*56 w==lerp(19,159,clamp(and($rep189_ready,eq($rep189_hasv[i],0)),0,1)) h=50 text="$rep189_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T v==not(and($rep189_ready,eq($rep189_hasv[i],0))) x==24+mod(i,2)*225+71 y==24+floor(i/2)*56 w=130 h=50 text="{$rep189_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        }
    }
}
# widget repeater rep190 {"x":24,"y":24,"w":440,"h":330,"max":6,"layout":"list","cols":2,"pitch":56,"item":"row","fmt":"%.1f","click":false,"keys":{}}
G id=rep190 {
    R x=24 y=24 w=440 h=330
    RP n=6 {
        G v==lt(i,$rep190_n) {
            R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            C v==1-eq($rep190_st[i],1)-eq($rep190_st[i],2)-eq($rep190_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#A6A6B4
            C v==eq($rep190_st[i],1) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($rep190_st[i],2) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($rep190_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
            T x=66 y==24+i*56 w==lerp(244,384,clamp(and($rep190_ready,eq($rep190_hasv[i],0)),0,1)) h=50 text="$rep190_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T v==not(and($rep190_ready,eq($rep190_hasv[i],0))) x=320 y==24+i*56 w=130 h=50 text="{$rep190_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        }
    }
}
# widget repeater rep191 {"x":24,"y":24,"w":440,"h":319.2,"max":6,"layout":"list","cols":2,"pitch":56,"item":"text","fmt":"%.1f","click":false,"keys":{}}
G id=rep191 {
    R x=24 y=24 w=440 h=319.2
    RP n=6 {
        G v==lt(i,$rep191_n) {
            T x=24 y==24+i*56 w=440 h=39.2 text="$rep191_t[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
        }
    }
}
# widget repeater rep192 {"x":24,"y":24,"w":440,"h":310,"max":6,"layout":"list","cols":2,"pitch":56,"item":"bar","fmt":"%.1f","click":false,"keys":{}}
G id=rep192 {
    R x=24 y=24 w=440 h=310
    RP n=6 {
        G v==lt(i,$rep192_n) {
            R x=24.5 y==24+i*56+0.5 w=439 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
            R x=29 y==24+i*56+5 w==clamp($rep192_lvl[i],0,1)*430 h=20 rx=2 f==if(eq($rep192_st[i],1),#7FD970,if(eq($rep192_st[i],2),#F2B233,if(eq($rep192_st[i],3),#F7777A,#A6A6B4)))
        }
    }
}
# widget repeater rep193 {"x":24,"y":24,"w":440,"h":298,"max":6,"layout":"list","cols":2,"pitch":56,"item":"light","fmt":"%.1f","click":false,"keys":{}}
G id=rep193 {
    R x=24 y=24 w=440 h=298
    RP n=6 {
        G v==lt(i,$rep193_n) {
            C v==1-eq($rep193_st[i],1)-eq($rep193_st[i],2)-eq($rep193_st[i],3) cx=33 cy==24+i*56+9 rx=9 ry=9 f=#A6A6B4
            C v==eq($rep193_st[i],1) cx=33 cy==24+i*56+9 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($rep193_st[i],2) cx=33 cy==24+i*56+9 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($rep193_st[i],3) cx=33 cy==24+i*56+9 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
        }
    }
}
# widget repeater rep194 {"x":24,"y":24,"w":440,"h":330,"max":6,"layout":"list","cols":2,"pitch":56,"item":"row","fmt":"%.1f","click":true,"keys":{}}
G id=rep194 {
    R x=24 y=24 w=440 h=330
    RP n=6 {
        G v==lt(i,$rep194_n) {
            R id=rep194_r click=1 x=24 y==24+i*56 w=440 h=50
            R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            C v==1-eq($rep194_st[i],1)-eq($rep194_st[i],2)-eq($rep194_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#A6A6B4
            C v==eq($rep194_st[i],1) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($rep194_st[i],2) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($rep194_st[i],3) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
            T x=66 y==24+i*56 w==lerp(244,384,clamp(and($rep194_ready,eq($rep194_hasv[i],0)),0,1)) h=50 text="$rep194_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T v==not(and($rep194_ready,eq($rep194_hasv[i],0))) x=320 y==24+i*56 w=130 h=50 text="{$rep194_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        }
    }
}
# widget repeater rep195 {"x":24,"y":24,"w":440,"h":162,"max":6,"layout":"grid","cols":2,"pitch":56,"item":"row","fmt":"%.1f","click":true,"keys":{}}
G id=rep195 {
    R x=24 y=24 w=440 h=162
    RP n=6 {
        G v==lt(i,$rep195_n) {
            R id=rep195_r click=1 x==24+mod(i,2)*225 y==24+floor(i/2)*56 w=215 h=50
            R x==24+mod(i,2)*225+0.5 y==24+floor(i/2)*56+0.5 w=214 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            C v==1-eq($rep195_st[i],1)-eq($rep195_st[i],2)-eq($rep195_st[i],3) cx==24+mod(i,2)*225+23 cy==24+floor(i/2)*56+25 rx=9 ry=9 f=#A6A6B4
            C v==eq($rep195_st[i],1) cx==24+mod(i,2)*225+23 cy==24+floor(i/2)*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($rep195_st[i],2) cx==24+mod(i,2)*225+23 cy==24+floor(i/2)*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($rep195_st[i],3) cx==24+mod(i,2)*225+23 cy==24+floor(i/2)*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
            T x==24+mod(i,2)*225+42 y==24+floor(i/2)*56 w==lerp(19,159,clamp(and($rep195_ready,eq($rep195_hasv[i],0)),0,1)) h=50 text="$rep195_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T v==not(and($rep195_ready,eq($rep195_hasv[i],0))) x==24+mod(i,2)*225+71 y==24+floor(i/2)*56 w=130 h=50 text="{$rep195_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        }
    }
}
# widget stepper stp196 {"x":24,"y":24,"w":440,"h":54,"name":"Value","fmt":"%.0f","by":1,"min":0,"max":100,"keys":{}}
G id=stp196 {
    G id=stp196_gd {
        R id=stp196_dec press=1 x=226 y=24 w=54 h=54
        R x=226.5 y=24.5 w=53 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=stp196_gi {
        R id=stp196_inc press=1 x=410 y=24 w=54 h=54
        R x=410.5 y=24.5 w=53 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T x=24 y=24 w=192 h=54 text=Value size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=226 y=24 w=54 h=54 text=− size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
    T x=290 y=27.2 w=110 h=47.6 text="{$stp196_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
    T x=410 y=24 w=54 h=54 text=+ size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
}
# widget tabs nav197 {"x":24,"y":24,"w":432,"h":54,"tabs":[{"label":"Main","page":"p1","key":0},{"label":"Power","page":"p2","key":1}],"active":"p1","gap":10}
G id=nav197 {
    G id=nav197_g0 {
        R id=nav197_t0 click=1 x=24 y=24 w=211 h=54
        R x=22.5 y=22.5 w=214 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=24.5 y=24.5 w=210 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=nav197_g1 {
        R id=nav197_t1 click=1 x=245 y=24 w=211 h=54
        R x=245.5 y=24.5 w=210 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T x=24 y=24 w=211 h=54 text=MAIN size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=245 y=24 w=211 h=54 text=POWER size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget tabs nav198 {"x":24,"y":24,"w":432,"h":54,"tabs":[{"label":"Main","page":"p1","key":0},{"label":"Main","page":"p1","key":1},{"label":"Main","page":"p1","key":2}],"active":"p1","gap":10}
G id=nav198 {
    G id=nav198_g0 {
        R id=nav198_t0 click=1 x=24 y=24 w=137.33333 h=54
        R x=22.5 y=22.5 w=140.33333 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=24.5 y=24.5 w=136.33333 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=nav198_g1 {
        R id=nav198_t1 click=1 x=171.33333 y=24 w=137.33333 h=54
        R x=169.83333 y=22.5 w=140.33333 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=171.83333 y=24.5 w=136.33333 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    G id=nav198_g2 {
        R id=nav198_t2 click=1 x=318.66666 y=24 w=137.33333 h=54
        R x=317.16666 y=22.5 w=140.33333 h=57 rx=7.5 f=none s=#FF772D sw=3
        R x=319.16666 y=24.5 w=136.33333 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    }
    T x=24 y=24 w=137.33333 h=54 text=MAIN size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=171.33333 y=24 w=137.33333 h=54 text=MAIN size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    T x=318.66666 y=24 w=137.33333 h=54 text=MAIN size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget text txt199 {"x":24,"y":24,"w":300,"h":39.2,"style":"value","text":"Label","align":"left","state":false,"keys":{}}
G id=txt199 {
    T x=24 y=24 w=300 h=39.2 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt200 {"x":24,"y":24,"w":300,"h":218.4,"style":"hero","text":"Label","align":"left","state":false,"keys":{}}
G id=txt200 {
    T x=24 y=24 w=300 h=218.4 text=Label size=156 font="Barlow Condensed Bold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt201 {"x":24,"y":24,"w":300,"h":50.4,"style":"screen-title","text":"Label","align":"left","state":false,"keys":{}}
G id=txt201 {
    T x=24 y=24 w=300 h=50.4 text=LABEL size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt202 {"x":24,"y":24,"w":300,"h":39.2,"style":"clock","text":"Label","align":"left","state":false,"keys":{}}
G id=txt202 {
    T x=24 y=24 w=300 h=39.2 text=LABEL size=28 font="Barlow Condensed SemiBold" cspace=3.57 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt203 {"x":24,"y":24,"w":300,"h":39.2,"style":"panel-title","text":"Label","align":"left","state":false,"keys":{}}
G id=txt203 {
    T x=24 y=24 w=300 h=39.2 text=LABEL size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt204 {"x":24,"y":24,"w":300,"h":39.2,"style":"button-label","text":"Label","align":"left","state":false,"keys":{}}
G id=txt204 {
    T x=24 y=24 w=300 h=39.2 text=LABEL size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt205 {"x":24,"y":24,"w":300,"h":39.2,"style":"chip-label","text":"Label","align":"left","state":false,"keys":{}}
G id=txt205 {
    T x=24 y=24 w=300 h=39.2 text=LABEL size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B valign=middle fit=ellipsis
}
# widget text txt206 {"x":24,"y":24,"w":300,"h":47.6,"style":"value-lg","text":"Label","align":"left","state":false,"keys":{}}
G id=txt206 {
    T x=24 y=24 w=300 h=47.6 text=Label size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt207 {"x":24,"y":24,"w":300,"h":39.2,"style":"value","text":"Label","align":"left","state":false,"keys":{}}
G id=txt207 {
    T x=24 y=24 w=300 h=39.2 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt208 {"x":24,"y":24,"w":300,"h":39.2,"style":"reading","text":"Label","align":"left","state":false,"keys":{}}
G id=txt208 {
    T x=24 y=24 w=300 h=39.2 text=Label size=28 font="Barlow Medium" f=#C8C8D2 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt209 {"x":24,"y":24,"w":300,"h":39.2,"style":"message","text":"Label","align":"left","state":false,"keys":{}}
G id=txt209 {
    T x=24 y=24 w=300 h=39.2 text=Label size=26 font="Barlow Medium" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt210 {"x":24,"y":24,"w":300,"h":39.2,"style":"unit","text":"Label","align":"left","state":false,"keys":{}}
G id=txt210 {
    T x=24 y=24 w=300 h=39.2 text=Label size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt211 {"x":24,"y":24,"w":300,"h":39.2,"style":"value","text":"Label","align":"left","state":false,"keys":{}}
G id=txt211 {
    T x=24 y=24 w=300 h=39.2 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text txt212 {"x":24,"y":24,"w":300,"h":39.2,"style":"value","text":"Label","align":"center","state":false,"keys":{}}
G id=txt212 {
    T x=24 y=24 w=300 h=39.2 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget text txt213 {"x":24,"y":24,"w":300,"h":39.2,"style":"value","text":"Label","align":"right","state":false,"keys":{}}
G id=txt213 {
    T x=24 y=24 w=300 h=39.2 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget text txt214 {"x":24,"y":24,"w":300,"h":39.2,"style":"value","text":"Label","align":"left","state":true,"keys":{}}
G id=txt214 {
    T x=24 y=24 w=300 h=39.2 text=Label size=28 font="Barlow SemiBold" f==if(eq($txt214_st,2),#F2B233,if(eq($txt214_st,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget toggle tg215 {"x":24,"y":24,"w":300,"h":54,"label":"Label","onText":"On","offText":"Off","look":"button","keys":{}}
G id=tg215 {
    R id=tg215_hit click=1 x=24 y=24 w=300 h=54
    R v==$tg215_on x=22.5 y=22.5 w=303 h=57 rx=7.5 f=none s=#FF772D sw=3
    R x=24.5 y=24.5 w=299 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=42 y=24 w=180 h=54 text=LABEL size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T v==eq($tg215_on,0) x=222 y=24 w=84 h=54 text=OFF size=26 font="Barlow Condensed Bold" cspace=3.85 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=right valign=middle
    T v==eq($tg215_on,1) x=222 y=24 w=84 h=54 text=ON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
}
# widget toggle tg216 {"x":24,"y":24,"w":300,"h":54,"label":"Label","onText":"On","offText":"Off","look":"button","keys":{}}
G id=tg216 {
    R id=tg216_hit click=1 x=24 y=24 w=300 h=54
    R v==$tg216_on x=22.5 y=22.5 w=303 h=57 rx=7.5 f=none s=#FF772D sw=3
    R x=24.5 y=24.5 w=299 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=42 y=24 w=180 h=54 text=LABEL size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T v==eq($tg216_on,0) x=222 y=24 w=84 h=54 text=OFF size=26 font="Barlow Condensed Bold" cspace=3.85 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=right valign=middle
    T v==eq($tg216_on,1) x=222 y=24 w=84 h=54 text=ON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
}
# widget toggle tg217 {"x":24,"y":24,"w":300,"h":54,"label":"Label","onText":"On","offText":"Off","look":"switch","keys":{}}
G id=tg217 {
    R id=tg217_hit click=1 x=24 y=24 w=300 h=54
    R x=242 y=32 w=64 h=38 rx=19 f==mix(#111116,#7FD970,clamp($tg217_on,0,1))
    R x==244+26*clamp($tg217_on,0,1) y=34 w=34 h=34 rx=17 f=#FFFFFF
    T x=42 y=24 w=190 h=54 text=LABEL size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget gauge gauge218 {"x":24,"y":24,"w":300,"h":300,"label":"Label","unit":"","min":0,"max":100,"start":-135,"end":135,"ticks":5,"fmt":"%.0f","value":true,"state":true,"keys":{}}
G id=gauge218 {
    P d="M84.056015 247.14398 A127.2 127.2 0 0 1 174 30 A127.2 127.2 0 0 1 263.94397 247.14398" s=#8E8E9E sw=6
    L p=[97.547615,233.65239,84.056015,247.14398] s=#5A5A69 sw=2
    L p=[74.110146,115.824265,56.482525,108.52267] s=#5A5A69 sw=2
    L p=[174,49.08,174,30] s=#5A5A69 sw=2
    L p=[273.88986,115.824265,291.5175,108.52267] s=#5A5A69 sw=2
    L p=[250.4524,233.65239,263.94397,247.14398] s=#5A5A69 sw=2
    G a=[174,157.2] r==-135+clamp(($gauge218_v-0)/100,0,1)*270 {
        L p=[174,157.2,174,42.72] s==if(eq($gauge218_st,1),#7FD970,if(eq($gauge218_st,2),#F2B233,if(eq($gauge218_st,3),#F7777A,#A6A6B4))) sw=4
    }
    C cx=174 cy=157.2 rx=6 ry=6 f=#FFFFFF
    T x=24 y=163.2 w=300 h=47.6 text="{$gauge218_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
    T x=24 y=290.4 w=300 h=33.6 text=Label size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget gauge gauge219 {"x":24,"y":24,"w":300,"h":300,"label":"Label","unit":"","min":0,"max":100,"start":-135,"end":135,"ticks":5,"fmt":"%.0f","value":true,"state":true,"keys":{}}
G id=gauge219 {
    P d="M84.056015 247.14398 A127.2 127.2 0 0 1 174 30 A127.2 127.2 0 0 1 263.94397 247.14398" s=#8E8E9E sw=6
    L p=[97.547615,233.65239,84.056015,247.14398] s=#5A5A69 sw=2
    L p=[74.110146,115.824265,56.482525,108.52267] s=#5A5A69 sw=2
    L p=[174,49.08,174,30] s=#5A5A69 sw=2
    L p=[273.88986,115.824265,291.5175,108.52267] s=#5A5A69 sw=2
    L p=[250.4524,233.65239,263.94397,247.14398] s=#5A5A69 sw=2
    G a=[174,157.2] r==-135+clamp(($gauge219_v-0)/100,0,1)*270 {
        L p=[174,157.2,174,42.72] s==if(eq($gauge219_st,1),#7FD970,if(eq($gauge219_st,2),#F2B233,if(eq($gauge219_st,3),#F7777A,#A6A6B4))) sw=4
    }
    C cx=174 cy=157.2 rx=6 ry=6 f=#FFFFFF
    T x=24 y=163.2 w=300 h=47.6 text="{$gauge219_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
    T x=24 y=290.4 w=300 h=33.6 text=Label size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget gauge gauge220 {"x":24,"y":24,"w":300,"h":300,"label":"Label","unit":"","min":0,"max":100,"start":-135,"end":135,"ticks":5,"fmt":"%.0f","value":true,"state":true,"keys":{}}
G id=gauge220 {
    P d="M84.056015 247.14398 A127.2 127.2 0 0 1 174 30 A127.2 127.2 0 0 1 263.94397 247.14398" s=#8E8E9E sw=6
    L p=[97.547615,233.65239,84.056015,247.14398] s=#5A5A69 sw=2
    L p=[74.110146,115.824265,56.482525,108.52267] s=#5A5A69 sw=2
    L p=[174,49.08,174,30] s=#5A5A69 sw=2
    L p=[273.88986,115.824265,291.5175,108.52267] s=#5A5A69 sw=2
    L p=[250.4524,233.65239,263.94397,247.14398] s=#5A5A69 sw=2
    G a=[174,157.2] r==-135+clamp(($gauge220_v-0)/100,0,1)*270 {
        L p=[174,157.2,174,42.72] s==if(eq($gauge220_st,1),#7FD970,if(eq($gauge220_st,2),#F2B233,if(eq($gauge220_st,3),#F7777A,#A6A6B4))) sw=4
    }
    C cx=174 cy=157.2 rx=6 ry=6 f=#FFFFFF
    T x=24 y=163.2 w=300 h=47.6 text="{$gauge220_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle
    T x=24 y=290.4 w=300 h=33.6 text=Label size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
G v==lt(ver,11118) {
    R x=0 y=0 w=480 h=58 f=#000000CC
    T x=14.4 y=0 w=451.2 h=58 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=26 f=#FFCC00
}
]==],
      snap = { ["al100_st"] = true, ["al100_msg"] = true, ["al101_st"] = true, ["al101_msg"] = true, ["bar102_st"] = true, ["bar103_st"] = true, ["bar104_st"] = true, ["bar105_st"] = true, ["bar108_st"] = true, ["bar109_st"] = true, ["bar110_st"] = true, ["btn112_state"] = true, ["btn113_dis"] = true, ["btn114_sel"] = true, ["duct115_run"] = true, ["duct116_run"] = true, ["duct117_run"] = true, ["log118_k"] = true, ["log118_m"] = true, ["log119_k"] = true, ["log119_m"] = true, ["log119_t"] = true, ["hdr172_crit"] = true, ["hdr172_warn"] = true, ["hdr173_crit"] = true, ["hdr173_warn"] = true, ["hdr173_clock"] = true, ["hdr174_crit"] = true, ["hdr174_warn"] = true, ["kv175_v0"] = true, ["kv175_s0"] = true, ["kv175_v1"] = true, ["kv175_v2"] = true, ["kv176_v0"] = true, ["kv176_s0"] = true, ["kv176_v1"] = true, ["kv176_s1"] = true, ["kv176_v2"] = true, ["kv176_s2"] = true, ["lt177_st"] = true, ["og178_sel"] = true, ["og179_sel"] = true, ["ro181_v"] = true, ["ro181_st"] = true, ["ro181_status"] = true, ["ro181_sub"] = true, ["ro182_v"] = true, ["ro182_st"] = true, ["ro182_status"] = true, ["ro182_sub"] = true, ["ro183_v"] = true, ["ro183_st"] = true, ["ro184_st"] = true, ["ro184_status"] = true, ["ro185_v"] = true, ["ro185_st"] = true, ["ro185_status"] = true, ["ro185_sub"] = true, ["row186_st"] = true, ["row186_r1"] = true, ["rep187_n"] = true, ["rep187_name"] = true, ["rep187_v"] = true, ["rep187_hasv"] = true, ["rep187_ready"] = true, ["rep187_st"] = true, ["rep188_n"] = true, ["rep188_name"] = true, ["rep188_v"] = true, ["rep188_hasv"] = true, ["rep188_ready"] = true, ["rep188_st"] = true, ["rep189_n"] = true, ["rep189_name"] = true, ["rep189_v"] = true, ["rep189_hasv"] = true, ["rep189_ready"] = true, ["rep189_st"] = true, ["rep190_n"] = true, ["rep190_name"] = true, ["rep190_v"] = true, ["rep190_hasv"] = true, ["rep190_ready"] = true, ["rep190_st"] = true, ["rep191_n"] = true, ["rep191_t"] = true, ["rep192_n"] = true, ["rep192_st"] = true, ["rep193_n"] = true, ["rep193_st"] = true, ["rep194_n"] = true, ["rep194_name"] = true, ["rep194_v"] = true, ["rep194_hasv"] = true, ["rep194_ready"] = true, ["rep194_st"] = true, ["rep195_n"] = true, ["rep195_name"] = true, ["rep195_v"] = true, ["rep195_hasv"] = true, ["rep195_ready"] = true, ["rep195_st"] = true, ["stp196_v"] = true, ["txt214_st"] = true, ["tg215_on"] = true, ["tg216_on"] = true, ["gauge218_v"] = true, ["gauge218_st"] = true, ["gauge219_v"] = true, ["gauge219_st"] = true, ["gauge220_v"] = true, ["gauge220_st"] = true }, samples = { ["al100_st"] = 2, ["al100_msg"] = "Message", ["al101_st"] = 2, ["al101_msg"] = "Message", ["bar102_lvl"] = 0.62, ["bar102_st"] = 1, ["bar103_lvl"] = 0.62, ["bar103_st"] = 1, ["bar104_lvl"] = 0.62, ["bar104_st"] = 1, ["bar105_lvl"] = 0.62, ["bar105_st"] = 1, ["bar106_lvl"] = 0.62, ["bar107_lvl"] = 0.62, ["bar108_lvl"] = 0.62, ["bar108_st"] = 1, ["bar108_tgt"] = 0.8, ["bar109_lvl"] = 0.62, ["bar109_st"] = 1, ["bar110_lvl"] = 0.62, ["bar110_st"] = 1, ["btn112_state"] = 0, ["btn113_dis"] = 0, ["btn114_sel"] = 0, ["duct115_run"] = 1, ["duct116_run"] = 1, ["duct117_run"] = 1, ["log118_k"] = { 3, 2, 1 }, ["log118_m"] = { "Message 1", "Message 2", "Message 3" }, ["log119_k"] = { 3, 2, 1 }, ["log119_m"] = { "Message 1", "Message 2", "Message 3" }, ["log119_t"] = { "14:02", "13:57", "13:40" }, ["hdr172_crit"] = 1, ["hdr172_warn"] = 2, ["hdr173_crit"] = 1, ["hdr173_warn"] = 2, ["hdr173_clock"] = "14:06", ["hdr174_crit"] = 1, ["hdr174_warn"] = 2, ["kv175_v0"] = 21.4, ["kv175_s0"] = 1, ["kv175_v1"] = 21.4, ["kv175_v2"] = "Auto", ["kv176_v0"] = 21.4, ["kv176_s0"] = 1, ["kv176_v1"] = 21.4, ["kv176_s1"] = 1, ["kv176_v2"] = 21.4, ["kv176_s2"] = 1, ["lt177_st"] = 1, ["og178_sel"] = 0, ["og179_sel"] = 0, ["ro181_v"] = 78, ["ro181_lvl"] = 0.78, ["ro181_st"] = 1, ["ro181_status"] = "Status", ["ro181_sub"] = 101.3, ["ro182_v"] = 78, ["ro182_lvl"] = 0.78, ["ro182_st"] = 1, ["ro182_status"] = "Status", ["ro182_sub"] = 101.3, ["ro183_v"] = 78, ["ro183_lvl"] = 0.78, ["ro183_st"] = 1, ["ro184_st"] = 1, ["ro184_status"] = "Status", ["ro185_v"] = 78, ["ro185_lvl"] = 0.78, ["ro185_st"] = 1, ["ro185_status"] = "Status", ["ro185_sub"] = 101.3, ["row186_st"] = 1, ["row186_r1"] = 21.4, ["rep187_n"] = 4, ["rep187_name"] = { "Item 1", "Item 2", "Item 3", "Item 4" }, ["rep187_v"] = { 21.4, 19.8, 0, 101.3 }, ["rep187_st"] = { 1, 2, 0, 3 }, ["rep188_n"] = 4, ["rep188_name"] = { "Item 1", "Item 2", "Item 3", "Item 4" }, ["rep188_v"] = { 21.4, 19.8, 0, 101.3 }, ["rep188_st"] = { 1, 2, 0, 3 }, ["rep189_n"] = 4, ["rep189_name"] = { "Item 1", "Item 2", "Item 3", "Item 4" }, ["rep189_v"] = { 21.4, 19.8, 0, 101.3 }, ["rep189_st"] = { 1, 2, 0, 3 }, ["rep190_n"] = 4, ["rep190_name"] = { "Item 1", "Item 2", "Item 3", "Item 4" }, ["rep190_v"] = { 21.4, 19.8, 0, 101.3 }, ["rep190_st"] = { 1, 2, 0, 3 }, ["rep191_n"] = 4, ["rep191_t"] = { "Item 1", "Item 2", "Item 3", "Item 4" }, ["rep192_n"] = 4, ["rep192_lvl"] = { 0.62, 0.3, 0.05, 0.9 }, ["rep192_st"] = { 1, 2, 3, 1 }, ["rep193_n"] = 4, ["rep193_st"] = { 1, 2, 0, 3 }, ["rep194_n"] = 4, ["rep194_name"] = { "Item 1", "Item 2", "Item 3", "Item 4" }, ["rep194_v"] = { 21.4, 19.8, 0, 101.3 }, ["rep194_st"] = { 1, 2, 0, 3 }, ["rep195_n"] = 4, ["rep195_name"] = { "Item 1", "Item 2", "Item 3", "Item 4" }, ["rep195_v"] = { 21.4, 19.8, 0, 101.3 }, ["rep195_st"] = { 1, 2, 0, 3 }, ["stp196_v"] = 12, ["txt214_st"] = 1, ["tg215_on"] = 1, ["tg216_on"] = 1, ["tg217_on"] = 1, ["gauge218_v"] = 50, ["gauge218_st"] = 1, ["gauge219_v"] = 50, ["gauge219_st"] = 1, ["gauge220_v"] = 50, ["gauge220_st"] = 1 }, nils = { ["al100_st"] = 0, ["al100_msg"] = "--", ["al101_st"] = 0, ["al101_msg"] = "--", ["bar102_st"] = 0, ["bar103_st"] = 0, ["bar104_st"] = 0, ["bar105_st"] = 0, ["bar108_st"] = 0, ["bar109_st"] = 0, ["bar110_st"] = 0, ["btn112_state"] = 0, ["btn113_dis"] = 0, ["btn114_sel"] = 0, ["duct115_run"] = 0, ["duct116_run"] = 0, ["duct117_run"] = 0, ["log118_k"] = { 0 }, ["log118_m"] = { "" }, ["log119_k"] = { 0 }, ["log119_m"] = { "" }, ["log119_t"] = { "" }, ["hdr172_crit"] = 0, ["hdr172_warn"] = 0, ["hdr173_crit"] = 0, ["hdr173_warn"] = 0, ["hdr173_clock"] = "--", ["hdr174_crit"] = 0, ["hdr174_warn"] = 0, ["kv175_v0"] = "--", ["kv175_s0"] = 0, ["kv175_v1"] = "--", ["kv175_v2"] = "--", ["kv176_v0"] = "--", ["kv176_s0"] = 0, ["kv176_v1"] = "--", ["kv176_s1"] = 0, ["kv176_v2"] = "--", ["kv176_s2"] = 0, ["lt177_st"] = 0, ["og178_sel"] = 0, ["og179_sel"] = 0, ["ro181_v"] = "--", ["ro181_st"] = 0, ["ro181_status"] = "--", ["ro181_sub"] = "--", ["ro182_v"] = "--", ["ro182_st"] = 0, ["ro182_status"] = "--", ["ro182_sub"] = "--", ["ro183_v"] = "--", ["ro183_st"] = 0, ["ro184_st"] = 0, ["ro184_status"] = "--", ["ro185_v"] = "--", ["ro185_st"] = 0, ["ro185_status"] = "--", ["ro185_sub"] = "--", ["row186_st"] = 0, ["row186_r1"] = "--", ["rep187_n"] = 0, ["rep187_name"] = { "" }, ["rep187_v"] = { "" }, ["rep187_hasv"] = { 0 }, ["rep187_ready"] = 0, ["rep187_st"] = { 0 }, ["rep188_n"] = 0, ["rep188_name"] = { "" }, ["rep188_v"] = { "" }, ["rep188_hasv"] = { 0 }, ["rep188_ready"] = 0, ["rep188_st"] = { 0 }, ["rep189_n"] = 0, ["rep189_name"] = { "" }, ["rep189_v"] = { "" }, ["rep189_hasv"] = { 0 }, ["rep189_ready"] = 0, ["rep189_st"] = { 0 }, ["rep190_n"] = 0, ["rep190_name"] = { "" }, ["rep190_v"] = { "" }, ["rep190_hasv"] = { 0 }, ["rep190_ready"] = 0, ["rep190_st"] = { 0 }, ["rep191_n"] = 0, ["rep191_t"] = { "" }, ["rep192_n"] = 0, ["rep192_lvl"] = { 0 }, ["rep192_st"] = { 0 }, ["rep193_n"] = 0, ["rep193_st"] = { 0 }, ["rep194_n"] = 0, ["rep194_name"] = { "" }, ["rep194_v"] = { "" }, ["rep194_hasv"] = { 0 }, ["rep194_ready"] = 0, ["rep194_st"] = { 0 }, ["rep195_n"] = 0, ["rep195_name"] = { "" }, ["rep195_v"] = { "" }, ["rep195_hasv"] = { 0 }, ["rep195_ready"] = 0, ["rep195_st"] = { 0 }, ["txt214_st"] = 0, ["tg215_on"] = 0, ["tg216_on"] = 0, ["tg217_on"] = 0, ["gauge218_st"] = 0, ["gauge219_st"] = 0, ["gauge220_st"] = 0 }, eased = { ["bar102_lvl"] = 0.00125, ["bar103_lvl"] = 0.00125, ["bar104_lvl"] = 0.00125, ["bar105_lvl"] = 0.00125, ["bar106_lvl"] = 0, ["bar107_lvl"] = 0.00125, ["bar108_lvl"] = 0.00125, ["bar108_tgt"] = 0.00125, ["bar109_lvl"] = 0.0003125, ["bar110_lvl"] = 0.0003125, ["ro181_lvl"] = 0, ["ro182_lvl"] = 0, ["ro183_lvl"] = 0, ["ro185_lvl"] = 0, ["rep192_lvl"] = 0.0011363636363636363, ["tg217_on"] = 0.0078125 }, arrays = { ["rep192_lvl"] = true },
      repeaters = { { n = "rep187_n", v = "rep187_v", hasv = "rep187_hasv", ready = "rep187_ready", max = 6 }, { n = "rep188_n", v = "rep188_v", hasv = "rep188_hasv", ready = "rep188_ready", max = 6 }, { n = "rep189_n", v = "rep189_v", hasv = "rep189_hasv", ready = "rep189_ready", max = 6 }, { n = "rep190_n", v = "rep190_v", hasv = "rep190_hasv", ready = "rep190_ready", max = 6 }, { n = "rep194_n", v = "rep194_v", hasv = "rep194_hasv", ready = "rep194_ready", max = 6 }, { n = "rep195_n", v = "rep195_v", hasv = "rep195_hasv", ready = "rep195_ready", max = 6 } },
      data = function(o)
      end,
      natives = {  },
      empty = false, w = 460, h = 460, dw = 480, dh = 480, fit = "contain" },
  },
  devices = nil,
}
do
-- >>> vectorbuilder custom (kept verbatim)
-- <<< vectorbuilder custom
end
VB.boot()
function tick(dt) VB.tick(dt) end
