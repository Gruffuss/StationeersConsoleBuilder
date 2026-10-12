-- In-game probes (plan W0b): one chip on a network with at least one device; results as "PROBE <n> <result>" lines read
-- with get_chip_logs. P5 and P6 need a second push (the script counts its boots in persist and chip memory). P5b: save and
-- reload the world, and switch the console off and on, then read the log: is persist populated at the first execution?
-- P5c: push it once with HALT = true (it halts after its first tick), then again unchanged: is persist still there? P8
-- (hidden surfaces' cost) is the owner's FPS reading with P8 = 6 extra surfaces built, then P8 = 0; P15 (guide §11: yield,
-- sleep, a resumable tick) is read with search_docs, not probed. P10 and P11 need interact_scripted_screen on the 'probe'
-- surface. P16 (source size) pushes this file padded by one trailing comment to 64 KB, 256 KB and 1 MB. Public APIs only.
-- No answer halts the load: each probe runs under pcall and prints a raise as "PROBE <n> raised <error>"; when
-- ss.ui.surface raises at load (P2), the surface's probes (P12, P13, P10, P11, P8) run at the first tick that gets it; P9's
-- loop is the load's last statement, so a halt there comes after every other load answer (push again with P9 = false for
-- P8, P10, P11 and P5c). The load prints about 40 lines (P4 shows the first 8 devices and the housing); the first tick
-- prints P2's first answer again with that count, for a log that keeps only its last lines. P5b deletes P5c's mark once
-- read, so halted_before speaks of the run before this one.
local P8, P9, HALT = 6, true, false
local printed = 0
local function out(n, ...)
  local t = {}
  for i = 1, select('#', ...) do t[#t + 1] = tostring((select(i, ...))) end
  printed = printed + 1
  print('PROBE ' .. n .. ' ' .. table.concat(t, ' '))
end
-- pcall's two answers as one word, so several fit one PROBE line (a pcall in the middle of an argument list keeps only its first).
local function try(f, ...)
  local ok, r = pcall(f, ...)
  return tostring(ok) .. '/' .. tostring(r)
end
-- One probe under pcall: an answer that raises is printed, and the probes after it still run.
local function probe(n, f)
  local ok, e = pcall(f)
  if not ok then out(n, 'raised', e) end
end
-- P2: does ss.ui.surface raise at load while the host is not ready (consoles in the wild retry it)? The first thing the chip does.
local atLoad = try(ss.ui.surface, 'probe')
out(2, 'surface at load', atLoad)
local enums = ic.enums or {}
local LT = enums.LogicType or {}
-- P2: which names exist in a ScriptedScreens console, five a line as <name>=<type> (a number shows its value)
probe(2, function()
  local names = { 'ic.device.list', 'ic.device_list', 'device_list', 'ic.mem_read', 'mem_read', 'ic.hash', 'hash', 'util.clock_time',
                  'util.json', 'json', 'ic.find', 'ic.find_all', 'ic.find_prefab', 'ic.const.BASE_NETWORK_INDEX', 'ic.const.BASE_UNIT_INDEX' }
  for i = 1, #names, 5 do
    local t = {}
    for k = i, math.min(i + 4, #names) do
      local v = _G
      for part in names[k]:gmatch('[^.]+') do if type(v) == 'table' then v = v[part] else v = nil end end
      t[#t + 1] = names[k] .. '=' .. (type(v) == 'number' and tostring(v) or type(v))
    end
    out(2, table.concat(t, ' '))
  end
end)
-- P4: the device list: is the housing in it, in what order, is name_hash hash(display_name), and what are an unlabelled
-- device's display_name and name_hash? One line each for the first 8 devices and the housing.
local list, host = {}, nil
probe(4, function()
  list = (ic.device and ic.device.list and ic.device.list()) or (ic.device_list and ic.device_list()) or {}
  host = ic.host_info and ic.host_info()
  out(4, 'count', #list, 'host', host and host.ref_id)
  local hashf = ic.hash or hash
  for i, d in ipairs(list) do
    if i <= 8 or host and d.ref_id == host.ref_id then
      local name = type(d.display_name) == 'string' and '"' .. d.display_name .. '"' or tostring(d.display_name)
      out(4, i, d.ref_id, d.prefab_hash, name, d.name_hash, d.name_hash == select(2, pcall(hashf, d.display_name or '')))
    end
  end
end)
-- P1: reading a type the device lacks, and an unknown ref; P14: writing a read-only type
local first
probe(1, function()
  for _, d in ipairs(list) do if not host or d.ref_id ~= host.ref_id then first = d break end end
  if not first then return end
  out(1, 'absent type', pcall(ic.read_id, first.ref_id, LT.Bpm))
  out(1, 'unknown ref', pcall(ic.read_id, -12345, LT.PrefabHash))
end)
if first then
  probe(14, function()
    out(14, 'write R-only', pcall(ic.write_id, first.ref_id, LT.PrefabHash, 1))
    out(14, 'unchanged', ic.read_id(first.ref_id, LT.PrefabHash) == first.prefab_hash)
  end)
end
-- P3: batch reads with no matching device, per method (and the method numbers: P7)
probe(3, function()
  for name, m in pairs(enums.LogicBatchMethod) do out(3, name, m, try(ic.batch_read, 12345, LT.Pressure, m)) end
end)
-- P5b, P5c: what persist holds at this, the first execution (after a world load, a console off/on, or a halted run); read
-- before P5 below writes probe_boots, or it would show this execution's own write; a get that raises is an answer (ruling
-- P22's unreadable store), not a halt
probe(5, function()
  out(5, 'first execution', 'probe_boots=' .. try(ic.persist.get, 'probe_boots'), 'halted_before=' .. try(ic.persist.get, 'probe_halted'))
  pcall(ic.persist.delete, 'probe_halted')
end)
-- P5, P6: persist and chip memory across pushes (push this script twice: once unchanged, once with a comment added)
probe(5, function()
  local ok, b = pcall(ic.persist.get, 'probe_boots')
  local boots = (ok and tonumber(b) or 0) + 1
  out(5, 'persist boots', boots, try(ic.persist.set, 'probe_boots', tostring(boots)))
  out(5, 'over-limit', try(ic.persist.set, string.rep('k', 200), 'v'), try(ic.persist.set, 'big', string.rep('v', 9000)), try(ic.persist.set, '__x', 'v'))
end)
probe(6, function()
  local mr, mw = ic.mem_read or mem_read, ic.mem_write or mem_write
  out(6, 'memory boots', mr(500))
  mw(500, mr(500) + 1)
  mw(501, 2 ^ 48 - 1)
  out(6, 'round trip', mr(501) == 2 ^ 48 - 1)
end)
-- P7: the enum tables' sizes (enums-probe.lua dumps them whole); a member of ic.enums that is no table, by its type
probe(7, function()
  for t, members in pairs(enums) do
    if type(members) == 'table' then
      local n = 0
      for _ in pairs(members) do n = n + 1 end
      out(7, t, n)
    else
      out(7, t, type(members))
    end
  end
end)
-- The 'probe' surface's probes, at load, or at the first tick that gets the surface when ss.ui.surface raises at load
-- (P2); P12's first line says when
ticks = 0
local built = false
local function build(when)
  local ok, ui = pcall(ss.ui.surface, 'probe')
  if not ok then return end
  built = true
  -- P12: set_resolution and size; P13: clock formats
  probe(12, function()
    out(12, 'size', ui:size().w, ui:size().h, 'built at', when)
    out(12, 'set 800x600', try(ui.set_resolution, ui, 800, 600), ui:size().w, ui.get_resolution and ui:get_resolution().w)
    out(12, 'set 0,0', try(ui.set_resolution, ui, 0, 0), ui:size().w, ui.get_resolution and ui:get_resolution().w)
  end)
  probe(13, function()
    for _, f in ipairs({ 'HH:MM', 'hh:MM:ss A', 'HH:MM:ss' }) do out(13, f, util and util.clock_time and try(util.clock_time, f)) end
  end)
  -- P10, P11: press the plate and repeated rows, and edit the text input on 'probe' (interact_scripted_screen on beta).
  probe(10, function()
    if ss.ui.allow_mcp_automation then pcall(ss.ui.allow_mcp_automation, true) end
    ui:element({ id = 's', type = 'vector', rect = { unit = 'px', x = 0, y = 0, w = 200, h = 200 },
      props = { scene = 'probe', src = 'SCENE w=100 h=100\nR id=plate press=1 x=0 y=0 w=50 h=50 f=#336699\nRP n=2 {\n    R id=row click=1 x=50 y==i*25 w=50 h=20 f=#669933\n}\n' },
      on_click = function(v, who) out(10, v, who, ticks) end })
    ui:element({ id = 'ti', type = 'textinput', rect = { unit = 'px', x = 0, y = 210, w = 200, h = 40 }, props = { value = '' },
      on_change = function(v, who) out(11, v, who) end })
    ui:commit()
  end)
  -- P8: P8 extra surfaces, each built once with a scene of 400 nodes, never activated (the owner reads the FPS at P8 = 6 and 0)
  probe(8, function()
    for k = 1, P8 do
      local s = ss.ui.surface('p8_' .. k)
      s:element({ id = 'scene', type = 'vector', rect = { unit = 'px', x = 0, y = 0, w = 400, h = 400 },
        props = { scene = 'p8_' .. k, src = 'SCENE w=400 h=400\nRP n=400 {\n    R x==mod(i,20)*20 y==floor(i/20)*20 w=18 h=18 f=#336699\n}\n' } })
      s:commit()
    end
  end)
  probe(10, function() ss.ui.activate('probe') end)
end
build('load')
function tick()
  ticks = ticks + 1
  if ticks == 1 then out(2, 'surface at load', atLoad, '(again: the load printed', printed, 'lines)') end
  if not built then build('tick ' .. ticks) end
  if HALT and ticks == 1 then ic.persist.set('probe_halted', 'yes') error('P5c: halting on purpose') end
end
-- P9: a load that runs about 100,000 instructions: halted (50,000 counts at load) or not (500,000)
if P9 then
  for _ = 1, 100000 do end
  out(9, 'a load of about 100000 instructions finished')
end
