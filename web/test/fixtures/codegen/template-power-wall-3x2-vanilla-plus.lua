-- VectorBuilder export · runtime library 1 · ScriptedScreens Vector >= 0.11.118 (ver 11118)
-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector 0.11.118 or newer and ScriptedScreens Fonts (Barlow SemiBold, Barlow Condensed Bold, Barlow Condensed SemiBold, Barlow Medium).
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
    { id = "batt", name = "Batteries", prefabs = { -400115994, -1388288459 }, label = nil, all = true, optional = true, key = -659015162 },
    { id = "gen", name = "Generators", prefabs = { 813146305 }, label = nil, all = true, optional = true, key = 633229935 },
    { id = "panels", name = "Solar panels", prefabs = { -2045627372, -934345724, -539224550, -1545574413, 1968102968, 1697196770, -1554349863, 930865127, -295209029, -2049226859, 939649277, 1945473703 }, label = nil, all = true, optional = true, key = -1114280590 },
    { id = "tracked", name = "Tracked panels", prefabs = { -2045627372, -539224550, -295209029, 939649277, -934345724, -1545574413, -2049226859, 1945473703 }, label = nil, all = true, optional = true, key = -376770360 },
    { id = "sun", name = "Daylight sensor", prefabs = { 1076425094 }, label = nil, all = false, optional = true, key = 1951615890 },
    { id = "vent", name = "Generators vent", prefabs = { -1129453144 }, label = "GeneratorsVent", all = true, optional = true, key = -1326995255 },
  },
  reads = {
    { id = "cap", role = 1, lt = "Maximum", agg = "sum" },
    { id = "stored", role = 1, lt = "Charge", agg = "sum" },
    { id = "frac", role = 1, lt = "Charge", agg = "sum", derived = function(x) return (P.cap and P.cap > 0 and x / P.cap or nil) end, th = { critBelow = 0.1, warnBelow = 0.5 } },
    { id = "using", role = 1, lt = "PowerActual", agg = "list" },
    { id = "solar", role = 3, lt = "Charge", agg = "sum" },
    { id = "coal", role = 2, lt = "PowerGeneration", agg = "sum" },
    { id = "genW", role = 2, lt = "PowerGeneration", agg = "list" },
    { id = "genCoal", role = 2, slot = 0, lst = "Quantity", agg = "list" },
    { id = "coalN", role = 2, slot = 0, lst = "Quantity", agg = "sum" },
    { id = "sunH", role = 5, lt = "Horizontal" },
    { id = "sunV", role = 5, lt = "Vertical" },
    { id = "tod", role = 5, lt = 1110 },
    { id = "dayLen", role = 5, lt = 1114 },
  },
  state = {
    { name = "mode", type = "number", init = 0, min = 0, max = 2, save = true, key = 1634461276 },
    { name = "parked", type = "bool", init = false, save = true, key = 863999567 },
  },
  acts = {
    ["og1_o0"] = { press = false, list = { { steps = { { op = "set", s = "mode", f = function() return (0) end } } } } },
    ["og1_o1"] = { press = false, list = { { steps = { { op = "set", s = "mode", f = function() return (1) end } } } } },
    ["og1_o2"] = { press = false, list = { { steps = { { op = "set", s = "mode", f = function() return (2) end } } } } },
    ["btn1_hit"] = { press = false, list = { { steps = { { op = "toggle", s = "parked" } } } } },
    ["btn2_hit"] = { press = false, list = { { steps = { { op = "page", page = "vb_devices" } } } } },
  },
  rules = {
    { role = 2, lt = "On", f = function() return (S.mode == 1 and 1 or S.mode == 2 and 0 or (P.frac and (P.frac < 0.1 and 1 or P.frac > 0.25 and 0 or nil))) end, skip = false, pulse = false },
    { role = 6, lt = "On", f = function() return (S.mode == 1 and 1 or S.mode == 2 and 0 or (P.frac and (P.frac < 0.1 and 1 or P.frac > 0.25 and 0 or nil))) end, skip = false, pulse = false },
    { role = 4, lt = "Vertical", f = function() return (S.parked and 90 or (P.sunV and P.sunV + 90)) end, skip = false, pulse = false },
    { role = 4, lt = "Horizontal", f = function() return (not S.parked and P.sunH and P.sunH + 90 or nil) end, skip = false, pulse = false },
  },
  pages = {
    { id = "p1", surface = "main", bg = { bg = "#3A3A43", gradient = "#24242A" }, src = [==[
SCENE w=1490 h=960 fit=contain
DEFS {
    GL id=theme_brand units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#1D4F7F],[1,#0D3B6A]]
    GL id=theme_row units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#3B3B45],[1,#32323A]]
}
# widget header hdr1 {"x":24,"y":24,"w":1442,"h":64,"title":"POWER","clock":true,"counts":true,"keys":{}}
G id=hdr1 {
    R x=25.5 y=25.5 w=1439 h=61 rx=12.5 f=@theme_brand s=#FF772D sw=3
    G v==gt($hdr1_crit,0) {
        C cx=1252 cy=56 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
        T x=1271 y=39 w=47 h=34 text="{$hdr1_crit:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    G v==gt($hdr1_warn,0) {
        C cx=1161 cy=56 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
        T x=1180 y=39 w=47 h=34 text="{$hdr1_warn:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    T x=42 y=30 w=1084 h=52 text=POWER size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    T x=1328 y=30 w=120 h=52 text=$hdr1_clock size=28 font="Barlow Condensed SemiBold" cspace=3.57 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
G id=storage {
    # widget panel pnl1 {"x":24,"y":104,"w":1442,"h":284,"title":"STORAGE","unit":""}
    G id=pnl1 {
        R x=24.5 y=104.5 w=1441 h=283 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
        T x=38 y=114 w=1414 h=36.4 text=STORAGE size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget readout ro1 {"x":39,"y":124,"w":440,"h":258.2,"variant":"hero","caption":"Label","unit":"%","fmt":"%.0f","bar":true,"subFmt":"%.1f","keys":{}}
    G id=ro1 {
        R x=39.5 y=301.7 w=439 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
        R x=44 y=306.2 w==clamp($ro1_lvl,0,1)*430 h=20 rx=2 f==if(eq($ro1_st,1),#7FD970,if(eq($ro1_st,2),#F2B233,if(eq($ro1_st,3),#F7777A,#A6A6B4)))
        T x=39 y=124 w=368 h=187.2 text="{$ro1_v:%.0f}" size=156 font="Barlow Condensed Bold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        T x=415 y=209.5 w=64 h=89.6 text=% size=64 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle
        T x=39 y=343 w=440 h=39.2 text=$ro1_status size=28 font="Barlow SemiBold" f==if(eq($ro1_st,1),#7FD970,if(eq($ro1_st,2),#F2B233,if(eq($ro1_st,3),#F7777A,#A6A6B4))) sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=39 y=343 w=440 h=39.2 text="{$ro1_sub:%.1f}" size=28 font="Barlow Medium" f=#C8C8D2 sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    G id=storage_table {
        # widget kvtable kv1 {"x":525,"y":154.9,"w":440,"h":218,"rows":[{"caption":"Stored","fmt":"","state":false,"key":0},{"caption":"Capacity","fmt":"","state":false,"key":1},{"caption":"","fmt":"","state":false,"key":2},{"caption":"Batteries","fmt":"%.0f","state":false,"key":3}],"rowH":50,"gap":6,"valueW":180,"keys":{}}
        G id=kv1 {
            R x=525.5 y=155.4 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            T x=539 y=154.9 w=222 h=50 text=Stored size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
            T x=771 y=154.9 w=180 h=50 text=$kv1_v0 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
            R x=525.5 y=211.4 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            T x=539 y=210.9 w=222 h=50 text=Capacity size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
            T x=771 y=210.9 w=180 h=50 text=$kv1_v1 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
            R x=525.5 y=267.4 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            T x=771 y=266.9 w=180 h=50 text=$kv1_v2 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
            R x=525.5 y=323.4 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            T x=539 y=322.9 w=222 h=50 text=Batteries size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
            T x=771 y=322.9 w=180 h=50 text="{$kv1_v3:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
        }
        # widget text txt1 {"x":539,"y":266.9,"w":222,"h":50,"style":"value","text":"$timeCaption","align":"left","state":false,"keys":{}}
        G id=txt1 {
            T x=539 y=266.9 w=222 h=50 text=$timeCaption size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        }
    }
    # widget repeater rep1 {"x":1011,"y":154.9,"w":440,"h":78,"max":16,"layout":"grid","cols":8,"pitch":48,"item":"bar","fmt":"","valueW":0,"click":false,"fade":false,"keys":{}}
    G id=rep1 {
        R x=1011 y=154.9 w=440 h=78
        RP n=16 {
            G v==lt(i,$rep1_n) {
                R x==1011+mod(i,8)*56.25+0.5 y==154.9+floor(i/8)*48+0.5 w=45.25 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1
                R x==1011+mod(i,8)*56.25+5 y==154.9+floor(i/8)*48+5 w==clamp($rep1_lvl[i],0,1)*36.25 h=20 rx=2 f==if(eq($rep1_st[i],1),#7FD970,if(eq($rep1_st[i],2),#F2B233,if(eq($rep1_st[i],3),#F7777A,#A6A6B4)))
            }
        }
    }
    # widget repeater rep2 {"x":1011,"y":267,"w":440,"h":106,"max":2,"layout":"list","cols":2,"pitch":56,"item":"row","fmt":"%.0f","valueW":60,"click":false,"fade":false,"keys":{}}
    G id=rep2 {
        R x=1011 y=267 w=440 h=106
        RP n=2 {
            G v==lt(i,$rep2_n) {
                R x=1011.5 y==267+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
                C v==1-eq($rep2_st[i],1)-eq($rep2_st[i],2)-eq($rep2_st[i],3) cx=1034 cy==267+i*56+25 rx=9 ry=9 f=#A6A6B4
                C v==eq($rep2_st[i],1) cx=1034 cy==267+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
                C v==eq($rep2_st[i],2) cx=1034 cy==267+i*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
                C v==eq($rep2_st[i],3) cx=1034 cy==267+i*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
                T x=1053 y==267+i*56 w==lerp(314,384,clamp(and($rep2_ready,eq($rep2_hasv[i],0)),0,1)) h=50 text="$rep2_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
                T v==not(and($rep2_ready,eq($rep2_hasv[i],0))) x=1377 y==267+i*56 w=60 h=50 text="{$rep2_v[i]:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
            }
        }
    }
}
G id=now {
    # widget panel pnl2 {"x":24,"y":404,"w":470,"h":288,"title":"NOW","unit":"kW"}
    G id=pnl2 {
        R x=24.5 y=404.5 w=469 h=287 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
        T x=38 y=414 w=352 h=36.4 text=NOW size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=400 y=415.4 w=80 h=33.6 text=kW size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    # widget kvtable kv2 {"x":39,"y":455.8,"w":440,"h":221.2,"rows":[{"caption":"Solar","fmt":"","state":false,"key":0},{"caption":"Coal","fmt":"","state":false,"key":1},{"caption":"Using","fmt":"","state":false,"key":2},{"caption":"Net","fmt":"","state":true,"key":3}],"rowH":50.8,"gap":6,"valueW":180,"keys":{}}
    G id=kv2 {
        R x=39.5 y=456.3 w=439 h=49.8 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=53 y=455.8 w=222 h=50.8 text=Solar size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=285 y=455.8 w=180 h=50.8 text=$kv2_v0 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
        R x=39.5 y=513.1 w=439 h=49.8 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=53 y=512.6 w=222 h=50.8 text=Coal size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=285 y=512.6 w=180 h=50.8 text=$kv2_v1 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
        R x=39.5 y=569.89996 w=439 h=49.8 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=53 y=569.39996 w=222 h=50.8 text=Using size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=285 y=569.39996 w=180 h=50.8 text=$kv2_v2 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
        R x=39.5 y=626.7 w=439 h=49.8 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=53 y=626.2 w=222 h=50.8 text=Net size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=285 y=626.2 w=180 h=50.8 text=$kv2_v3 size=34 font="Barlow SemiBold" f==if(eq($kv2_s3,2),#F2B233,if(eq($kv2_s3,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    }
}
G id=yesterday {
    # widget panel pnl3 {"x":24,"y":708,"w":470,"h":228,"title":"YESTERDAY","unit":"MJ"}
    G id=pnl3 {
        R x=24.5 y=708.5 w=469 h=227 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
        T x=38 y=718 w=352 h=36.4 text=YESTERDAY size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=400 y=719.4 w=80 h=33.6 text=MJ size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=right valign=middle
    }
    # widget kvtable kv3 {"x":39,"y":759.8,"w":440,"h":161.2,"rows":[{"caption":"Produced","fmt":"","state":false,"key":0},{"caption":"Used","fmt":"","state":false,"key":1},{"caption":"Net","fmt":"","state":true,"key":2}],"rowH":49.733334,"gap":6,"valueW":180,"keys":{}}
    G id=kv3 {
        R x=39.5 y=760.3 w=439 h=48.733334 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=53 y=759.8 w=222 h=49.733334 text=Produced size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=285 y=759.8 w=180 h=49.733334 text=$kv3_v0 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
        R x=39.5 y=816.0333 w=439 h=48.733334 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=53 y=815.5333 w=222 h=49.733334 text=Used size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=285 y=815.5333 w=180 h=49.733334 text=$kv3_v1 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
        R x=39.5 y=871.76666 w=439 h=48.733334 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=53 y=871.26666 w=222 h=49.733334 text=Net size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=285 y=871.26666 w=180 h=49.733334 text=$kv3_v2 size=34 font="Barlow SemiBold" f==if(eq($kv3_s2,2),#F2B233,if(eq($kv3_s2,3),#F7777A,#FFFFFF)) sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    }
}
G id=solar_panels {
    # widget panel pnl4 {"x":510,"y":404,"w":470,"h":288,"title":"SOLAR PANELS","unit":""}
    G id=pnl4 {
        R x=510.5 y=404.5 w=469 h=287 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
        T x=524 y=414 w=442 h=36.4 text="SOLAR PANELS" size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget text txt2 {"x":736,"y":419,"w":50,"h":33.6,"style":"unit","text":"Qty","align":"left","state":false,"keys":{}}
    G id=txt2 {
        T x=736 y=419 w=50 h=33.6 text=Qty size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget text txt3 {"x":796,"y":419,"w":74,"h":33.6,"style":"unit","text":"kW","align":"left","state":false,"keys":{}}
    G id=txt3 {
        T x=796 y=419 w=74 h=33.6 text=kW size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget text txt4 {"x":880,"y":419,"w":70,"h":33.6,"style":"unit","text":"Eff %","align":"right","state":false,"keys":{}}
    G id=txt4 {
        T x=880 y=419 w=70 h=33.6 text="Eff %" size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    }
    G id=solar_table {
        # widget repeater rep3 {"x":525,"y":457.8,"w":440,"h":162,"max":3,"layout":"list","cols":2,"pitch":56,"item":"row","fmt":"%.0f","valueW":0,"click":false,"fade":false,"keys":{}}
        G id=rep3 {
            R x=525 y=457.8 w=440 h=162
            RP n=3 {
                G v==lt(i,$rep3_n) {
                    R x=525.5 y==457.8+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
                    C v==1-eq($rep3_st[i],1)-eq($rep3_st[i],2)-eq($rep3_st[i],3) cx=548 cy==457.8+i*56+25 rx=9 ry=9 f=#A6A6B4
                    C v==eq($rep3_st[i],1) cx=548 cy==457.8+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
                    C v==eq($rep3_st[i],2) cx=548 cy==457.8+i*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
                    C v==eq($rep3_st[i],3) cx=548 cy==457.8+i*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
                    T x=567 y==457.8+i*56 w==lerp(244,384,clamp(and($rep3_ready,eq($rep3_hasv[i],0)),0,1)) h=50 text="$rep3_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
                    T v==not(and($rep3_ready,eq($rep3_hasv[i],0))) x=821 y==457.8+i*56 w=130 h=50 text="{$rep3_v[i]:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
                }
            }
        }
        # widget repeater rep4 {"x":736,"y":462.8,"w":50,"h":151.2,"max":3,"layout":"list","cols":2,"pitch":56,"item":"text","fmt":"","valueW":0,"click":false,"fade":false,"keys":{}}
        G id=rep4 {
            R x=736 y=462.8 w=50 h=151.2
            RP n=3 {
                G v==lt(i,$rep4_n) {
                    T x=736 y==462.8+i*56 w=50 h=39.2 text="$rep4_t[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
                }
            }
        }
        # widget repeater rep5 {"x":796,"y":462.8,"w":74,"h":151.2,"max":3,"layout":"list","cols":2,"pitch":56,"item":"text","fmt":"","valueW":0,"click":false,"fade":false,"keys":{}}
        G id=rep5 {
            R x=796 y=462.8 w=74 h=151.2
            RP n=3 {
                G v==lt(i,$rep5_n) {
                    T x=796 y==462.8+i*56 w=74 h=39.2 text="$rep5_t[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
                }
            }
        }
        # widget alert al1 {"x":525,"y":574.4,"w":440,"h":36.4,"row":false,"keys":{}}
        G id=al1 {
            R x=525 y=574.4 w=440 h=36.4
            G v==gt($al1_st,0) {
                R x=539 y=575.2 w=86 h=34.8 rx=4 f==if(eq($al1_st,1),#7FD970,if(eq($al1_st,2),#F2B233,if(eq($al1_st,3),#F7777A,#A6A6B4)))
                T v==eq($al1_st,1) x=539 y=575.2 w=86 h=34.8 text=OK size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
                T v==eq($al1_st,2) x=539 y=575.2 w=86 h=34.8 text=WARN size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
                T v==eq($al1_st,3) x=539 y=575.2 w=86 h=34.8 text=CRIT size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle
                T x=639 y=574.4 w=312 h=36.4 text=$al1_msg size=26 font="Barlow Medium" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
            }
        }
    }
    # widget button btn1 {"x":525,"y":623,"w":270,"h":54,"states":[{"label":"PARK PANELS","variant":"primary","key":0},{"label":"RESUME TRACKING","variant":"primary","key":1}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn1 {
        R id=btn1_hit click=1 x=525 y=623 w=270 h=54
        G v==eq($btn1_state,0) {
            R x=526 y=624 w=268 h=52 rx=5 f=@theme_brand s=#FF772D sw=2 fo==1-0.25*down
        }
        G v==eq($btn1_state,1) {
            R x=526 y=624 w=268 h=52 rx=5 f=@theme_brand s=#FF772D sw=2 fo==1-0.25*down
        }
        T v==eq($btn1_state,0) x=543 y=623 w=234 h=54 text="PARK PANELS" size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
        T v==eq($btn1_state,1) x=543 y=623 w=234 h=54 text="RESUME TRACKING" size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    }
    # widget button btn2 {"x":805,"y":623,"w":160,"h":54,"states":[{"label":"DEVICES","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
    G id=btn2 {
        R id=btn2_hit click=1 x=805 y=623 w=160 h=54
        R x=805.5 y=623.5 w=159 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
        T x=823 y=623 w=124 h=54 text=DEVICES size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
    }
}
G id=coal_generators {
    # widget panel pnl5 {"x":996,"y":404,"w":470,"h":288,"title":"COAL GENERATORS","unit":""}
    G id=pnl5 {
        R x=996.5 y=404.5 w=469 h=287 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
        T x=1010 y=414 w=442 h=36.4 text="COAL GENERATORS" size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget text txt5 {"x":1266,"y":419,"w":80,"h":33.6,"style":"unit","text":"kW","align":"left","state":false,"keys":{}}
    G id=txt5 {
        T x=1266 y=419 w=80 h=33.6 text=kW size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget text txt6 {"x":1356,"y":419,"w":80,"h":33.6,"style":"unit","text":"Coal","align":"right","state":false,"keys":{}}
    G id=txt6 {
        T x=1356 y=419 w=80 h=33.6 text=Coal size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    }
    G id=coal_table {
        # widget repeater rep6 {"x":1011,"y":457.8,"w":440,"h":112.2,"max":2,"layout":"list","cols":2,"pitch":62.2,"item":"row","fmt":"%.0f","valueW":0,"click":false,"fade":false,"keys":{}}
        G id=rep6 {
            R x=1011 y=457.8 w=440 h=112.2
            RP n=2 {
                G v==lt(i,$rep6_n) {
                    R x=1011.5 y==457.8+i*62.2+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
                    C v==1-eq($rep6_st[i],1)-eq($rep6_st[i],2)-eq($rep6_st[i],3) cx=1034 cy==457.8+i*62.2+25 rx=9 ry=9 f=#A6A6B4
                    C v==eq($rep6_st[i],1) cx=1034 cy==457.8+i*62.2+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
                    C v==eq($rep6_st[i],2) cx=1034 cy==457.8+i*62.2+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
                    C v==eq($rep6_st[i],3) cx=1034 cy==457.8+i*62.2+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
                    T x=1053 y==457.8+i*62.2 w==lerp(244,384,clamp(and($rep6_ready,eq($rep6_hasv[i],0)),0,1)) h=50 text="$rep6_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
                    T v==not(and($rep6_ready,eq($rep6_hasv[i],0))) x=1307 y==457.8+i*62.2 w=130 h=50 text="{$rep6_v[i]:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
                }
            }
        }
        # widget repeater rep7 {"x":1266,"y":462.8,"w":80,"h":101.4,"max":2,"layout":"list","cols":2,"pitch":62.2,"item":"text","fmt":"","valueW":0,"click":false,"fade":false,"keys":{}}
        G id=rep7 {
            R x=1266 y=462.8 w=80 h=101.4
            RP n=2 {
                G v==lt(i,$rep7_n) {
                    T x=1266 y==462.8+i*62.2 w=80 h=39.2 text="$rep7_t[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
                }
            }
        }
    }
    G id=override {
        # widget text txt7 {"x":1015,"y":579.2,"w":200,"h":33.6,"style":"unit","text":"Override","align":"left","state":false,"keys":{}}
        G id=txt7 {
            T x=1015 y=579.2 w=200 h=33.6 text=Override size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        }
        # widget options og1 {"x":1014,"y":620,"w":434,"h":54,"options":[{"label":"AUTO","value":0,"key":0},{"label":"ON","value":1,"key":1},{"label":"OFF","value":2,"key":2}],"gap":10,"keys":{}}
        G id=og1 {
            G id=og1_g0 {
                R id=og1_o0 click=1 x=1014 y=620 w=138 h=54
                R v==eq($og1_sel,0) x=1012.5 y=618.5 w=141 h=57 rx=7.5 f=none s=#FF772D sw=3
                R x=1014.5 y=620.5 w=137 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
            }
            G id=og1_g1 {
                R id=og1_o1 click=1 x=1162 y=620 w=138 h=54
                R v==eq($og1_sel,1) x=1160.5 y=618.5 w=141 h=57 rx=7.5 f=none s=#FF772D sw=3
                R x=1162.5 y=620.5 w=137 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
            }
            G id=og1_g2 {
                R id=og1_o2 click=1 x=1310 y=620 w=138 h=54
                R v==eq($og1_sel,2) x=1308.5 y=618.5 w=141 h=57 rx=7.5 f=none s=#FF772D sw=3
                R x=1310.5 y=620.5 w=137 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
            }
            T x=1014 y=620 w=138 h=54 text=AUTO size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
            T x=1162 y=620 w=138 h=54 text=ON size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
            T x=1310 y=620 w=138 h=54 text=OFF size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
        }
    }
}
G id=sun {
    # widget panel pnl6 {"x":510,"y":708,"w":470,"h":228,"title":"SUN","unit":""}
    G id=pnl6 {
        R x=510.5 y=708.5 w=469 h=227 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
        T x=524 y=718 w=442 h=36.4 text=SUN size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    G id=sunangle {
        # widget gauge gauge1 {"x":525,"y":758.9,"w":210,"h":162.1,"label":"Sun angle","unit":"","min":0,"max":1,"start":-90,"end":90,"ticks":0,"fmt":"","value":false,"state":true,"keys":{}}
        G id=gauge1 {
            P d="M571.75 823.15 A58.250004 58.250004 0 0 1 630 764.9 A58.250004 58.250004 0 0 1 688.25 823.15" s=#8E8E9E sw=6
            G a=[630,823.15] r==-90+clamp(($gauge1_v-0)/1,0,1)*180 {
                L p=[630,823.15,630,770.72504] s==if(eq($gauge1_st,1),#7FD970,if(eq($gauge1_st,2),#F2B233,if(eq($gauge1_st,3),#F7777A,#A6A6B4))) sw=4
            }
            C cx=630 cy=823.15 rx=6 ry=6 f=#FFFFFF
            T x=525 y=887.4 w=210 h=33.6 text="Sun angle" size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
        }
        # widget text txt8 {"x":525,"y":831.15,"w":210,"h":47.6,"style":"value-lg","text":"$sunAngle","align":"center","state":false,"keys":{}}
        G id=txt8 {
            T x=525 y=831.15 w=210 h=47.6 text=$sunAngle size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
        }
    }
    # widget text txt9 {"x":745,"y":761.925,"w":220,"h":33.6,"style":"unit","text":"Sunset in","align":"left","state":false,"keys":{}}
    G id=txt9 {
        T x=745 y=761.925 w=220 h=33.6 text="Sunset in" size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget text txt10 {"x":745,"y":789.925,"w":220,"h":47.6,"style":"value-lg","text":"$sunset","align":"left","state":false,"keys":{}}
    G id=txt10 {
        T x=745 y=789.925 w=220 h=47.6 text=$sunset size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget text txt11 {"x":745,"y":845.975,"w":220,"h":33.6,"style":"unit","text":"Sunrise in","align":"left","state":false,"keys":{}}
    G id=txt11 {
        T x=745 y=845.975 w=220 h=33.6 text="Sunrise in" size=24 font="Barlow Medium" f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget text txt12 {"x":745,"y":873.975,"w":220,"h":47.6,"style":"value-lg","text":"$sunrise","align":"left","state":false,"keys":{}}
    G id=txt12 {
        T x=745 y=873.975 w=220 h=47.6 text=$sunrise size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
}
G id=coal_reserve {
    # widget panel pnl7 {"x":996,"y":708,"w":470,"h":228,"title":"COAL RESERVE","unit":""}
    G id=pnl7 {
        R x=996.5 y=708.5 w=469 h=227 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]
        T x=1010 y=718 w=442 h=36.4 text="COAL RESERVE" size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
    }
    # widget kvtable kv4 {"x":1011,"y":758.9,"w":440,"h":162.1,"rows":[{"caption":"Coal left","fmt":"","state":false,"key":0},{"caption":"Coal energy","fmt":"","state":false,"key":1},{"caption":"Coal lasts","fmt":"","state":false,"key":2}],"rowH":50.033333,"gap":6,"valueW":180,"keys":{}}
    G id=kv4 {
        R x=1011.5 y=759.4 w=439 h=49.033333 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=1025 y=758.9 w=222 h=50.033333 text="Coal left" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=1257 y=758.9 w=180 h=50.033333 text=$kv4_v0 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
        R x=1011.5 y=815.43335 w=439 h=49.033333 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=1025 y=814.93335 w=222 h=50.033333 text="Coal energy" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=1257 y=814.93335 w=180 h=50.033333 text=$kv4_v1 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
        R x=1011.5 y=871.4667 w=439 h=49.033333 rx=5.5 f=@theme_row s=#5A5A69 sw=1
        T x=1025 y=870.9667 w=222 h=50.033333 text="Coal lasts" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
        T x=1257 y=870.9667 w=180 h=50.033333 text=$kv4_v2 size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
    }
}
G v==lt(ver,11118) {
    R x=0 y=0 w=1490 h=115 f=#000000CC
    T x=44.7 y=0 w=1400.6 h=115 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=52 f=#FFCC00
}
]==],
      snap = { ["hdr1_crit"] = true, ["hdr1_warn"] = true, ["hdr1_clock"] = true, ["ro1_v"] = true, ["ro1_st"] = true, ["ro1_status"] = true, ["ro1_sub"] = true, ["kv1_v0"] = true, ["kv1_v1"] = true, ["kv1_v2"] = true, ["kv1_v3"] = true, ["timeCaption"] = true, ["rep1_n"] = true, ["rep1_st"] = true, ["rep2_n"] = true, ["rep2_name"] = true, ["rep2_v"] = true, ["rep2_hasv"] = true, ["rep2_ready"] = true, ["rep2_st"] = true, ["kv2_v0"] = true, ["kv2_v1"] = true, ["kv2_v2"] = true, ["kv2_v3"] = true, ["kv2_s3"] = true, ["kv3_v0"] = true, ["kv3_v1"] = true, ["kv3_v2"] = true, ["kv3_s2"] = true, ["rep3_n"] = true, ["rep3_name"] = true, ["rep3_v"] = true, ["rep3_hasv"] = true, ["rep3_ready"] = true, ["rep3_st"] = true, ["rep4_n"] = true, ["rep4_t"] = true, ["rep5_n"] = true, ["rep5_t"] = true, ["al1_st"] = true, ["al1_msg"] = true, ["btn1_state"] = true, ["rep6_n"] = true, ["rep6_name"] = true, ["rep6_v"] = true, ["rep6_hasv"] = true, ["rep6_ready"] = true, ["rep6_st"] = true, ["rep7_n"] = true, ["rep7_t"] = true, ["og1_sel"] = true, ["gauge1_st"] = true, ["sunAngle"] = true, ["sunset"] = true, ["sunrise"] = true, ["kv4_v0"] = true, ["kv4_v1"] = true, ["kv4_v2"] = true }, samples = {  }, nils = { ["hdr1_crit"] = 0, ["hdr1_warn"] = 0, ["hdr1_clock"] = "--", ["ro1_v"] = "--", ["ro1_st"] = 0, ["ro1_status"] = "--", ["ro1_sub"] = "--", ["kv1_v0"] = "--", ["kv1_v1"] = "--", ["kv1_v2"] = "--", ["kv1_v3"] = "--", ["timeCaption"] = "--", ["rep1_n"] = 0, ["rep1_lvl"] = { 0 }, ["rep1_st"] = { 0 }, ["rep2_n"] = 0, ["rep2_name"] = { "" }, ["rep2_v"] = { "" }, ["rep2_hasv"] = { 0 }, ["rep2_ready"] = 0, ["rep2_st"] = { 0 }, ["kv2_v0"] = "--", ["kv2_v1"] = "--", ["kv2_v2"] = "--", ["kv2_v3"] = "--", ["kv2_s3"] = 0, ["kv3_v0"] = "--", ["kv3_v1"] = "--", ["kv3_v2"] = "--", ["kv3_s2"] = 0, ["rep3_n"] = 0, ["rep3_name"] = { "" }, ["rep3_v"] = { "" }, ["rep3_hasv"] = { 0 }, ["rep3_ready"] = 0, ["rep3_st"] = { 0 }, ["rep4_n"] = 0, ["rep4_t"] = { "" }, ["rep5_n"] = 0, ["rep5_t"] = { "" }, ["al1_st"] = 0, ["al1_msg"] = "--", ["btn1_state"] = 0, ["rep6_n"] = 0, ["rep6_name"] = { "" }, ["rep6_v"] = { "" }, ["rep6_hasv"] = { 0 }, ["rep6_ready"] = 0, ["rep6_st"] = { 0 }, ["rep7_n"] = 0, ["rep7_t"] = { "" }, ["og1_sel"] = 0, ["gauge1_st"] = 0, ["sunAngle"] = "--", ["sunset"] = "--", ["sunrise"] = "--", ["kv4_v0"] = "--", ["kv4_v1"] = "--", ["kv4_v2"] = "--" }, eased = { ["ro1_lvl"] = 0, ["rep1_lvl"] = 0.0011363636363636363, ["gauge1_v"] = 0 }, arrays = { ["rep1_lvl"] = true },
      repeaters = { { n = "rep2_n", v = "rep2_v", hasv = "rep2_hasv", ready = "rep2_ready", max = 2 }, { n = "rep3_n", v = "rep3_v", hasv = "rep3_hasv", ready = "rep3_ready", max = 3 }, { n = "rep6_n", v = "rep6_v", hasv = "rep6_hasv", ready = "rep6_ready", max = 2 } },
      data = function(o)
        o["hdr1_crit"] = 0
        o["hdr1_warn"] = X["nwarn"]
        o["hdr1_clock"] = (util.clock_time and util.clock_time("HH:MM") or "--:--")
        o["ro1_v"] = (P.frac and P.frac * 100 or "--")
        o["ro1_lvl"] = (P.frac or 0)
        o["ro1_st"] = T.frac
        o["ro1_status"] = X["status"]
        o["ro1_sub"] = X["netText"]
        o["kv1_v0"] = (P.frac and string.format("%.1f MJ", P.stored / 1e6) or "--")
        o["kv1_v1"] = (P.frac and string.format("%.1f MJ", P.cap / 1e6) or "--")
        o["kv1_v2"] = X["timeLeft"]
        o["kv1_v3"] = (R.batt.n)
        o["timeCaption"] = X["timeCaption"]
        o["rep1_n"] = (X.cells and #X.cells or 0)
        o["rep1_lvl"] = X["cells"]
        o["rep1_st"] = X["cellSt"]
        o["rep2_n"] = X["typeN"]
        o["rep2_name"] = X["typeNames"]
        o["rep2_v"] = X["typeCounts"]
        o["rep2_st"] = X["typeSt"]
        o["kv2_v0"] = X["solarKw"]
        o["kv2_v1"] = X["coalKw"]
        o["kv2_v2"] = X["usingKw"]
        o["kv2_v3"] = X["netKw"]
        o["kv2_s3"] = X["netSt"]
        o["kv3_v0"] = X["yProduced"]
        o["kv3_v1"] = X["yUsed"]
        o["kv3_v2"] = X["yNet"]
        o["kv3_s2"] = X["yNetSt"]
        o["rep3_n"] = X["solarN"]
        o["rep3_name"] = X["solarNames"]
        o["rep3_v"] = X["solarEff"]
        o["rep3_st"] = X["solarSt"]
        o["rep4_n"] = X["solarN"]
        o["rep4_t"] = X["solarQty"]
        o["rep5_n"] = X["solarN"]
        o["rep5_t"] = X["solarKws"]
        o["al1_st"] = X["alertSt"]
        o["al1_msg"] = X["alertMsg"]
        o["btn1_state"] = (S.parked and 1 or 0)
        o["rep6_n"] = X["genN"]
        o["rep6_name"] = X["genNames"]
        o["rep6_v"] = X["genCoal"]
        o["rep6_st"] = X["genSt"]
        o["rep7_n"] = X["genN"]
        o["rep7_t"] = X["genKw"]
        o["og1_sel"] = S.mode
        o["gauge1_v"] = X["sunf"]
        o["gauge1_st"] = X["sunSt"]
        o["sunAngle"] = X["sunAngle"]
        o["sunset"] = X["sunset"]
        o["sunrise"] = X["sunrise"]
        o["kv4_v0"] = X["coalLeft"]
        o["kv4_v1"] = X["coalEnergy"]
        o["kv4_v2"] = X["coalLasts"]
      end,
      natives = {  },
      empty = false, w = 714, h = 460, dw = 1490, dh = 960, fit = "contain" },
  },
  devices = { id = "vb_devices", surface = "vb_devices", bg = { bg = "#3A3A43", gradient = "#24242A" }, src = [==[
SCENE w=1490 h=960 fit=contain
DEFS {
    GL id=theme_brand units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#1D4F7F],[1,#0D3B6A]]
    GL id=theme_row units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#3B3B45],[1,#32323A]]
}
# widget header vbhdr {"x":24,"y":24,"w":1442,"h":64,"title":"Devices","clock":false,"counts":false,"keys":{}}
G id=vbhdr {
    R x=25.5 y=25.5 w=1439 h=61 rx=12.5 f=@theme_brand s=#FF772D sw=3
    T x=42 y=30 w=1396 h=52 text=DEVICES size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget repeater vbdev {"x":24,"y":100,"w":1442,"h":666,"max":12,"layout":"list","cols":2,"pitch":56,"item":"row","fmt":"","valueW":0,"click":true,"fade":false,"keys":{}}
G id=vbdev {
    R x=24 y=100 w=1442 h=666
    RP n=12 {
        G v==lt(i,$vbdev_n) {
            R id=vbdev_r click=1 x=24 y==100+i*56 w=1442 h=50
            R x=24.5 y==100+i*56+0.5 w=1441 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1
            C v==1-eq($vbdev_st[i],1)-eq($vbdev_st[i],2)-eq($vbdev_st[i],3) cx=47 cy==100+i*56+25 rx=9 ry=9 f=#A6A6B4
            C v==eq($vbdev_st[i],1) cx=47 cy==100+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]
            C v==eq($vbdev_st[i],2) cx=47 cy==100+i*56+25 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]
            C v==eq($vbdev_st[i],3) cx=47 cy==100+i*56+25 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]
            T x=66 y==100+i*56 w==lerp(1246,1386,clamp(and($vbdev_ready,eq($vbdev_hasv[i],0)),0,1)) h=50 text="$vbdev_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis missing=""
            T v==not(and($vbdev_ready,eq($vbdev_hasv[i],0))) x=1322 y==100+i*56 w=130 h=50 text="{$vbdev_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle
        }
    }
}
# widget text vbmsg {"x":24,"y":830,"w":1009.4,"h":40,"style":"value","text":"$vbdev_msg","align":"left","state":false,"keys":{}}
G id=vbmsg {
    T x=24 y=830 w=1009.4 h=40 text=$vbdev_msg size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis
}
# widget text vbpg {"x":1033.4,"y":830,"w":432.6,"h":40,"style":"value","text":"$vbdev_pg","align":"right","state":false,"keys":{}}
G id=vbpg {
    T x=1033.4 y=830 w=432.6 h=40 text=$vbdev_pg size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=right valign=middle fit=ellipsis
}
# widget button vbprev {"x":24,"y":882,"w":278.8,"h":54,"states":[{"label":"PREV","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbprev {
    R id=vbprev_hit click=1 x=24 y=882 w=278.8 h=54
    R x=24.5 y=882.5 w=277.8 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=42 y=882 w=242.79999 h=54 text=PREV size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget button vbnext {"x":314.8,"y":882,"w":278.8,"h":54,"states":[{"label":"NEXT","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbnext {
    R id=vbnext_hit click=1 x=314.8 y=882 w=278.8 h=54
    R x=315.3 y=882.5 w=277.8 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=332.8 y=882 w=242.79999 h=54 text=NEXT size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget button vbscan {"x":605.6,"y":882,"w":278.8,"h":54,"states":[{"label":"RESCAN","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbscan {
    R id=vbscan_hit click=1 x=605.6 y=882 w=278.8 h=54
    R x=606.1 y=882.5 w=277.8 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=623.6 y=882 w=242.79999 h=54 text=RESCAN size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget button vbback {"x":896.4,"y":882,"w":278.8,"h":54,"states":[{"label":"BACK","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbback {
    R id=vbback_hit click=1 x=896.4 y=882 w=278.8 h=54
    R x=896.9 y=882.5 w=277.8 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down
    T x=914.4 y=882 w=242.79999 h=54 text=BACK size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
# widget button vbsave {"x":1187.2,"y":882,"w":278.8,"h":54,"states":[{"label":"SAVE","variant":"primary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}
G id=vbsave {
    R id=vbsave_hit click=1 x=1187.2 y=882 w=278.8 h=54
    R x=1188.2 y=883 w=276.8 h=52 rx=5 f=@theme_brand s=#FF772D sw=2 fo==1-0.25*down
    T x=1205.2 y=882 w=242.79999 h=54 text=SAVE size=26 font="Barlow Condensed Bold" cspace=3.85 f=#FFFFFF sh=[[0,2,2,0,#00000099]] align=center valign=middle fit=ellipsis
}
G v==lt(ver,11118) {
    R x=0 y=0 w=1490 h=115 f=#000000CC
    T x=44.7 y=0 w=1400.6 h=115 text="Update ScriptedScreens Vector to 0.11.118 or newer" size=52 f=#FFCC00
}
]==], rows = 12,
    keys = { n = "vbdev_n", name = "vbdev_name", v = "vbdev_v", hasv = "vbdev_hasv", ready = "vbdev_ready", st = "vbdev_st", pg = "vbdev_pg", msg = "vbdev_msg" }, ids = { row = "vbdev_r", save = "vbsave_hit", scan = "vbscan_hit", back = "vbback_hit", prev = "vbprev_hit", next = "vbnext_hit" },
    repeaters = { { n = "vbdev_n", v = "vbdev_v", hasv = "vbdev_hasv", ready = "vbdev_ready", max = 12 } },
    snap = { ["vbdev_n"] = true, ["vbdev_name"] = true, ["vbdev_v"] = true, ["vbdev_hasv"] = true, ["vbdev_ready"] = true, ["vbdev_st"] = true, ["vbdev_pg"] = true, ["vbdev_msg"] = true }, samples = {}, nils = { ["vbdev_n"] = 0, ["vbdev_name"] = { "" }, ["vbdev_v"] = { "" }, ["vbdev_hasv"] = { 0 }, ["vbdev_ready"] = 0, ["vbdev_st"] = { 0 }, ["vbdev_pg"] = "", ["vbdev_msg"] = "" },
    eased = {}, natives = {}, empty = false, w = 714, h = 460, dw = 1490, dh = 960, fit = "contain" },
}
do
-- >>> vectorbuilder custom (kept verbatim)
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
-- <<< vectorbuilder custom
end
VB.boot()
function tick(dt) VB.tick(dt) end
