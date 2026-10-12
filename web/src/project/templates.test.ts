import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogOf } from '../catalog'
import devicesText from '../catalog/devices.json?raw'
import enumsText from '../catalog/enums.json?raw'
import { bannerSrc, generate } from '../codegen/generate'
import { devicesPage } from '../codegen/devicesPage'
import { hostOf } from '../codegen/hostOf'
import { DEVICES_PAGE, type Logic } from '../model/logic'
import { newProject, VECTOR_FLOOR, type Project } from '../model/project'
import { indexOfPath, parseOrder } from '../model/numbering'
import type { SrcNode } from '../model/scene'
import { initialState, reducer } from '../model/store'
import { px } from '../model/shapes'
import { SceneChecker } from '../srctext/checker'
import { printSrc } from '../srctext/print'
import { checkWorkers } from '../srctext/testing'
import { colour, DEFAULT_THEME, groundOf, THEMES, themeOf } from '../theme'
import { linked, linksOf } from '../theme/links'
import { imported } from '../theme/testing'
import { exportProblems } from '../codegen/exportProblems'

it('opens templates in an imported theme', () => {
  const p = templateProject('overview', imported)
  expect(themeOf(p)).toEqual(imported)
  expect(p.themes).toEqual({ [imported.id]: imported })
  expect(exportProblems(p).filter(p => p.level === 'error')).toEqual([])
})

it('accepts provided Theme objects without storing them as imports', () => {
  const p = templateProject('blank', THEMES['vanilla-plus'])
  expect(p.theme).toBe('vanilla-plus')
  expect(p.themes).toBeUndefined()
})
import { allocUid, expandRoot, nativesOf, putWidget, sanitize, widgetOf } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { Params } from '../widgets/types'
import { TEMPLATES, templateProject, type TemplateId } from './templates'

const ids = ['overview', 'atmos-tanks', 'power', 'airlock', 'solar', 'blank', 'needle-gauge'] as const
const names = ['Overview', 'Atmos/tanks', 'Power', 'Airlock', 'Solar', 'Blank', 'Needle gauge']
const cat = catalogOf(JSON.parse(devicesText), JSON.parse(enumsText))
const constant = (v: number) => ({ kind: 'const' as const, v })

// The Airlock starter's door commands (its custom block). The rules hold both doors in Logic mode and unlocked and write each
// door's Open and Setting together from X.innerCmd / X.outerCmd; this block decides those commands.
const AIRLOCK_LUA = `-- Door handling: one door open at a time, without a pressure cycle. The rules hold both doors in Logic mode (a press lands
-- in Setting and the door does not move by itself) and unlocked, and write each door's Open AND Setting from X.innerCmd and
-- X.outerCmd (nil holds a door as it is). This block decides those commands:
--   * Boot moves no door. Each door is adopted as it stands, the first tick it is bound and readable; its Setting then
--     follows its Open, so a mismatch left by anything else is not a request. Found both open, the inner one is shut.
--   * A door's own button is a request: Setting differs from Open while the door is settled (Idle not 0), and from what
--     this block commands. Both doors asking at once is no direction and is ignored.
--   * A door opens only once the other is unbound, or reads shut (Open 0) and settled and TRAVEL seconds have passed since
--     it was commanded shut.
-- Not known offline: whether a Logic-mode door moves on Open alone (both are written); when Idle and Open change while a
-- door travels; what a press does to Setting beyond leaving it unequal to Open; how long a door takes to travel.
local TRAVEL = 1.5   -- seconds a door is given to shut before the other may open
local NONE = 0       -- S.want: 0 none, 1 inner, 2 outer
local DOORS = {
  { role = "inner", want = 1, open = "innerActual", setting = "innerSetting", idle = "innerIdle", cmd = "innerCmd" },
  { role = "outer", want = 2, open = "outerActual", setting = "outerSetting", idle = "outerIdle", cmd = "outerCmd" },
}
local seen, shut = {}, {}   -- the device each door was adopted on; seconds since it was commanded shut

local function settled(P, d)
  local idle = P[d.idle]
  return idle == nil or idle >= 0.5
end

function U.after_reads(P, S, dt)
  local asked = {}
  for i, d in ipairs(DOORS) do
    shut[i] = (shut[i] or TRAVEL) + (dt or 0)
    local ref, open = R[d.role].refs and R[d.role].refs[1], P[d.open]
    if ref ~= seen[i] then
      if ref == nil then seen[i], X[d.cmd] = nil, nil
      elseif open ~= nil then
        seen[i], X[d.cmd] = ref, open >= 0.5 and 1 or 0
        if X[d.cmd] == 1 then S.want = d.want elseif S.want == d.want then S.want = NONE end
      end
    elseif X[d.cmd] ~= nil then
      local st = P[d.setting]
      if st ~= nil and open ~= nil and math.abs(st - open) >= 0.5 and math.abs(st - X[d.cmd]) >= 0.5 and settled(P, d) then
        asked[i] = st >= 0.5 and 1 or 0
      end
    end
  end
  if asked[1] == 1 and asked[2] == 1 then
    -- both asking: stay as we are
  elseif asked[1] == 1 then S.want = DOORS[1].want
  elseif asked[2] == 1 then S.want = DOORS[2].want
  else
    for i, d in ipairs(DOORS) do if asked[i] == 0 and S.want == d.want then S.want = NONE end end
  end
  for i, d in ipairs(DOORS) do
    if X[d.cmd] ~= nil and S.want ~= d.want then
      if X[d.cmd] == 1 then shut[i] = 0 end
      X[d.cmd] = 0
    end
  end
  for i, d in ipairs(DOORS) do
    local k = 3 - i
    local o = DOORS[k]
    if X[d.cmd] == 0 and S.want == d.want then
      local other = P[o.open]
      if not R[o.role].ok or (X[o.cmd] == 0 and other ~= nil and other < 0.5 and settled(P, o) and shut[k] >= TRAVEL) then
        X[d.cmd] = 1
      end
    end
  end
end
`

// Authoring only: JSON is shipped, this function and the widget defaults stay in tests.
function authored(id: TemplateId): Project {
  let p = newProject()
  p.name = names[ids.indexOf(id as typeof ids[number])]
  const t = themeOf(p), pg = p.pages[0]
  const add = (type: string, over: Params) => {
    const m = WIDGETS[type], uid = allocUid(p, m.prefix)
    const params = sanitize(m, { ...m.defaults(t, { pages: p.pages, page: 'p1', size: { w: 480, h: 480 } }), x: 24, w: 432, ...over }, t)
    pg.scene = putWidget(pg.scene, { type, uid, params }, t)
  }
  const header = (title: string) => add('header', { y: 0, h: 64, title, clock: false, counts: true })
  const devices = (y: number) => add('button', { y, w: 200, h: 54, states: [{ label: 'Devices', variant: 'secondary' }] })
  const row = (y: number, name: string) => add('readoutrow', { y, h: 50, name, fmt1: '%.1f', w1: 120 })
  const hero = (unit: string) => add('readout', { y: 80, variant: 'hero', bar: true, unit, fmt: '%.0f', subFmt: '' })
  const batt = { id: 'batt', name: 'Batteries', prefabs: ['StructureBattery', 'StructureBatteryLarge'], mode: 'all' as const }
  const fraction = [
    { id: 'cap', role: 'batt', of: { lt: { name: 'Maximum' } }, agg: 'sum' as const },
    { id: 'frac', role: 'batt', of: { lt: { name: 'Charge' } }, agg: 'sum' as const, derived: 'P.cap and P.cap > 0 and x / P.cap or nil', th: { critBelow: 0.1, warnBelow: 0.25, hyst: 0.05 } },
  ]
  const batteries = [
    { id: 's1', prefab: 'StructureBattery', label: '', ref: 2, role: 'batt', values: { Charge: constant(900), Maximum: constant(1000) } },
    { id: 's2', prefab: 'StructureBatteryLarge', label: '', ref: 3, role: 'batt', values: { Charge: constant(600), Maximum: constant(2000) } },
  ]
  const alarms = { hdr1_warn: { from: 'expr' as const, expr: 'alarms(2)' }, hdr1_crit: { from: 'expr' as const, expr: 'alarms(3)' } }
  const go = (uid = 'btn1') => ({ id: 'devices', on: uid + '_hit', do: [{ op: 'page' as const, page: DEVICES_PAGE }] })
  let logic: Partial<Logic> = {}
  switch (id) {
    case 'overview':
      header('Overview'); hero('%'); row(350, 'Temperature °C'); devices(410)
      logic = { roles: [batt, { id: 'room', name: 'Room sensor', prefabs: ['StructureGasSensor'], mode: 'one', label: 'Room' }],
        reads: [...fraction, { id: 'temp', role: 'room', of: { lt: { name: 'Temperature' } }, valid: [1, 100000], unit: 'K>C' }],
        actions: [go()], bindings: { ...alarms, ro1_v: { from: 'expr', expr: 'P.frac and P.frac * 100 or nil' }, ro1_lvl: { from: 'read', read: 'frac' },
          ro1_st: { from: 'read', read: 'frac', part: 'state' }, ro1_status: { from: 'expr', expr: '({"IDLE","OK","WARN","CRIT"})[(T.frac or 0)+1]' },
          row1_r1: { from: 'read', read: 'temp' }, row1_st: { from: 'read', read: 'temp', part: 'state' } },
        simDevices: [...batteries, { id: 's3', prefab: 'StructureGasSensor', label: 'Room', ref: 4, role: 'room', values: { Temperature: constant(295.15) } }] }
      break
    case 'atmos-tanks':
      header('Tank'); row(90, 'Pressure kPa'); row(160, 'Temperature °C')
      add('bar', { y: 240, h: 30 }); add('text', { y: 300, style: 'unit', text: 'Tank pressure / 10000 kPa' }); devices(410)
      logic = { roles: [{ id: 'tank', name: 'Tank sensor', prefabs: ['StructureGasSensor'], mode: 'one', label: 'Tank' }],
        reads: [{ id: 'press', role: 'tank', of: { lt: { name: 'Pressure' } }, valid: [0, 100000], th: { warnAbove: 8000, critAbove: 9500, hyst: 200 }, history: { n: 30 } },
          { id: 'frac', role: 'tank', of: { lt: { name: 'Pressure' } }, valid: [0, 100000], scale: 0.0001, clamp: [0, 1] },
          { id: 'temp', role: 'tank', of: { lt: { name: 'Temperature' } }, valid: [1, 100000], unit: 'K>C' }], actions: [go()],
        bindings: { ...alarms, row1_r1: { from: 'read', read: 'press' }, row1_st: { from: 'read', read: 'press', part: 'state' },
          row2_r1: { from: 'read', read: 'temp' }, row2_st: { from: 'read', read: 'temp', part: 'state' }, bar1_lvl: { from: 'read', read: 'frac' }, bar1_st: { from: 'read', read: 'press', part: 'state' } },
        simDevices: [{ id: 's1', prefab: 'StructureGasSensor', label: 'Tank', ref: 2, role: 'tank', values: { Pressure: constant(5000), Temperature: constant(293.15) } }] }
      break
    case 'power':
      header('Power'); add('bar', { y: 90, h: 30 }); add('options', { y: 140, h: 54, options: [{ label: 'Auto', value: 0 }, { label: 'On', value: 1 }, { label: 'Off', value: 2 }] })
      add('eventlog', { y: 250, rows: 2, pitch: 56 }); devices(400)
      logic = { roles: [batt, { id: 'gen', name: 'Generators', prefabs: ['StructureSolidFuelGenerator'], mode: 'all' }], reads: fraction,
        state: [{ name: 'og1_sel', type: 'number', init: 0, min: 0, max: 2 }],
        actions: [...['auto', 'on', 'off'].map((word, i) => ({ id: `mode${i}`, on: `og1_o${i}`, do: [
          { op: 'set' as const, state: 'og1_sel', value: String(i) }, { op: 'log' as const, text: `"Generators: ${word}"`, level: 1 as const }] })), go()],
        rules: [{ id: 'r1', role: 'gen', lt: { name: 'On' }, value: 'S.og1_sel == 1 and 1 or S.og1_sel == 2 and 0 or (P.frac and (P.frac < 0.1 and 1 or P.frac > 0.25 and 0 or nil))' }],
        bindings: { ...alarms, bar1_lvl: { from: 'read', read: 'frac' }, bar1_st: { from: 'read', read: 'frac', part: 'state' }, og1_sel: { from: 'state', state: 'og1_sel' }, log1_k: { from: 'log', part: 'k' }, log1_m: { from: 'log', part: 'm' } },
        simDevices: [...batteries, { id: 's3', prefab: 'StructureSolidFuelGenerator', label: '', ref: 4, role: 'gen', values: {} }] }
      break
    case 'airlock':
      header('Airlock'); row(90, 'Room pressure kPa')
      add('button', { y: 160, w: 210, h: 54, states: [{ label: 'Open inner', variant: 'secondary' }] })
      add('button', { x: 246, y: 160, w: 210, h: 54, states: [{ label: 'Open outer', variant: 'secondary' }] })
      add('button', { y: 230, h: 54, states: [{ label: 'Close both', variant: 'secondary' }] })
      add('text', { y: 296, style: 'unit', text: 'Opens a door once the other is shut' }); add('text', { y: 332, style: 'unit', text: 'Logic mode, unlocked; door buttons work' }); devices(400)
      {
        const door = (id: 'inner' | 'outer', name: string, label: string) => ({ id, name, prefabs: ['StructureAirlock'], mode: 'one' as const, label, distinct: true as const })
        const reads = (id: 'inner' | 'outer') => (['Actual', 'Setting', 'Idle'] as const).map(k => ({ id: id + k, role: id, of: { lt: { name: k === 'Actual' ? 'Open' : k } } }))
        const rules = (id: 'inner' | 'outer') => [{ id: id + 'Mode', role: id, lt: { name: 'Mode' }, value: '1' }, { id: id + 'Lock', role: id, lt: { name: 'Lock' }, value: '0' }]
        const command = (id: 'inner' | 'outer') => [{ id: id + 'Open', role: id, lt: { name: 'Open' }, value: `X.${id}Cmd` }, { id: id + 'Setting', role: id, lt: { name: 'Setting' }, value: `X.${id}Cmd` }]
        const doorSim = (n: number, id: 'inner' | 'outer', label: string) => ({ id: `s${n}`, prefab: 'StructureAirlock', label, ref: n + 1, role: id,
          values: { Mode: constant(1), On: constant(1), Open: constant(0), Setting: constant(0), Idle: constant(1), Lock: constant(0) } })
        logic = { roles: [door('inner', 'Inner door', 'Inner'), door('outer', 'Outer door', 'Outer'), { id: 'room', name: 'Room sensor', prefabs: ['StructureGasSensor'], mode: 'one', label: 'Room' }],
          reads: [...reads('inner'), ...reads('outer'), { id: 'pressure', role: 'room', of: { lt: { name: 'Pressure' } } }],
          state: [{ name: 'want', type: 'enum', init: 0, options: ['none', 'inner', 'outer'], save: false }],
          actions: [{ id: 'inner', on: 'btn1_hit', do: [{ op: 'set', state: 'want', value: '1' }] }, { id: 'outer', on: 'btn2_hit', do: [{ op: 'set', state: 'want', value: '2' }] },
            { id: 'close', on: 'btn3_hit', do: [{ op: 'set', state: 'want', value: '0' }] }, go('btn4')],
          rules: [...rules('inner'), ...rules('outer'), ...command('inner'), ...command('outer')],
          bindings: { ...alarms, row1_r1: { from: 'read', read: 'pressure' }, row1_st: { from: 'const', value: 1 } },
          customLua: AIRLOCK_LUA,
          simDevices: [doorSim(1, 'inner', 'Inner'), doorSim(2, 'outer', 'Outer'),
            { id: 's3', prefab: 'StructureGasSensor', label: 'Room', ref: 4, role: 'room', values: { Pressure: constant(101.325) } }] }
      }
      break
    case 'solar':
      header('Solar'); hero(''); row(350, 'Maximum'); devices(410)
      logic = { roles: [{ id: 'panels', name: 'Solar panels', prefabs: ['StructureSolarPanel'], mode: 'all' }],
        reads: [{ id: 'cap', role: 'panels', of: { lt: { name: 'Maximum' } }, agg: 'sum' },
          { id: 'frac', role: 'panels', of: { lt: { name: 'Charge' } }, agg: 'sum', derived: 'P.cap and P.cap > 0 and x / P.cap or nil' },
          { id: 'output', role: 'panels', of: { lt: { name: 'Charge' } }, agg: 'sum', history: { n: 30 } }], actions: [go()],
        bindings: { ...alarms, ro1_v: { from: 'read', read: 'output' }, ro1_lvl: { from: 'read', read: 'frac' }, ro1_st: { from: 'const', value: 1 },
          ro1_status: { from: 'const', value: 'OUTPUT' }, row1_r1: { from: 'read', read: 'cap' }, row1_st: { from: 'const', value: 1 } },
        simDevices: [1, 2].map((i) => ({ id: `s${i}`, prefab: 'StructureSolarPanel', label: '', ref: i + 1, role: 'panels', values: { Charge: constant(i * 1000), Maximum: constant(2500) } })) }
      break
    case 'blank': break
    case 'needle-gauge': {
      const face: SrcNode = { op: 'C', attrs: { cx: 240, cy: 250, rx: 140, ry: 140, sw: 4 } }
      const ticks: SrcNode[] = [[100, 250, 120, 250], [240, 110, 240, 130], [360, 250, 380, 250]]
        .map(p => linked({ op: 'L', attrs: { p, sw: 3 } }, 's', { role: 'border-strong' }, t))
      pg.scene.root = [linked(linked(face, 'f', { role: 'surface-panel' }, t), 's', { role: 'border-strong' }, t), ...ticks,
        { op: 'G', attrs: { a: [240, 250], r: '=clamp($gauge_level,0,1)*180-90', v: '=gt($gauge_present,0)' },
          c: [linked({ op: 'L', attrs: { p: [240, 250, 240, 120], sw: 4 } }, 's', { role: 'accent' }, t)] },
        linked({ op: 'C', attrs: { cx: 240, cy: 250, rx: 8, ry: 8 } }, 'f', { role: 'accent' }, t)]
      add('text', { x: 40, y: 233, w: 56, style: 'unit', text: '0', align: 'right' })
      add('text', { x: 212, y: 72, w: 56, style: 'unit', text: '50', align: 'center' })
      add('text', { x: 384, y: 233, w: 56, style: 'unit', text: '100', align: 'left' })
      add('text', { x: 150, y: 270, w: 180, style: 'value-lg', text: '{$gauge_value:%.0f}', align: 'center' })
      add('text', { x: 160, y: 322, w: 160, style: 'unit', text: 'Pressure kPa', align: 'center' })
      devices(400)
      logic = { roles: [{ id: 'sensor', name: 'Sensor', prefabs: ['StructureGasSensor'], mode: 'one', label: 'Sensor' }],
        reads: [{ id: 'pressure', role: 'sensor', of: { lt: { name: 'Pressure' } }, valid: [0, 100000] }], actions: [go()],
        bindings: { gauge_value: { from: 'read', read: 'pressure' }, gauge_level: { from: 'expr', expr: 'P.pressure and P.pressure / 100 or nil' }, gauge_present: { from: 'expr', expr: 'P.pressure ~= nil and 1 or 0' } },
        simDevices: [{ id: 's1', prefab: 'StructureGasSensor', label: 'Sensor', ref: 2, role: 'sensor', values: { Pressure: constant(50) } }] }
      break
    }
    default: throw new Error('unknown authored template ' + id)
  }
  p = reducer(initialState(p), { type: 'setLogic', patch: logic }).project
  return p
}

function manifestOf(p: Project) {
  const t = themeOf(p)
  const pages = p.pages.map(pg => {
    const empty = pg.scene.root.length === 0 && !pg.scene.defs.some(def => def.op.toUpperCase() === 'FONT') && nativesOf(pg, t).length > 0
    return { id: pg.id, surface: pg.surface, empty, src: empty ? '' : printSrc(pg.scene) + bannerSrc(pg.scene.header), w: px(pg.size.w), h: px(pg.size.h) }
  })
  if (p.roles.some(r => r.pin === undefined && r.ref === undefined)) {
    const { scene, cfg } = devicesPage(p, t), start = p.pages[0]
    pages.push({ id: cfg.id, surface: cfg.surface, empty: false, src: printSrc(scene) + bannerSrc(scene.header), w: px(start.size.w), h: px(start.size.h) })
  }
  return pages
}

describe('starter templates', () => {
  it('lists the seven starters in order and exactly both provided themes', () => {
    expect(TEMPLATES.map(t => t.id)).toEqual(ids)
    expect(TEMPLATES.map(t => t.name)).toEqual(names)
    expect(Object.keys(THEMES)).toEqual(['neutral', 'vanilla-plus'])
    expect(DEFAULT_THEME).toBe('neutral')
  })
  it('returns fresh projects without mutating the authored JSON or another open', () => {
    const one = templateProject('overview'), two = templateProject('overview')
    one.pages[0].scene.root[0].attrs.id = 'edited'; one.bindings.hdr1_warn = { from: 'const', value: 123 }; one.name = 'edited'
    expect(two).toEqual(templateProject('overview'))
    expect(two.name).toBe('Overview')
    expect(templateProject('blank').pages[0].scene.root).toEqual([])
    expect(templateProject('blank').theme).toBe('neutral')
  })
  it.each(['unknown', '__proto__', 'constructor'])('rejects unknown ID %s rather than hiding it with Blank', id => {
    expect(() => templateProject(id as TemplateId)).toThrow(/template/i)
  })
  it.each(['unknown', '__proto__', 'constructor'])('rejects unsupported theme %s', theme => {
    expect(() => templateProject('blank', theme)).toThrow(/theme/i)
  })
  it('discloses continuous Airlock commands and unverified raw Solar units', () => {
    expect(TEMPLATES.find(t => t.id === 'airlock')?.description).toBe('Opens one door at a time: the other must read shut and settled first. Holds both doors in Logic mode and unlocked; the button on a door asks for it; boot leaves the doors as they are. No automatic pressure cycle.')
    expect(TEMPLATES.find(t => t.id === 'solar')?.description).toContain('raw')
    expect(TEMPLATES.find(t => t.id === 'solar')?.description).toContain('units unverified')
  })
  it.each(ids)('ships the exact module-authored %s data', id => {
    const expected = authored(id)
    if (process.env.VB_AUTHOR_TEMPLATES === '1') {
      const dir = new URL('../../../templates/', import.meta.url)
      mkdirSync(dir, { recursive: true })
      writeFileSync(new URL(id + '.json', dir), JSON.stringify(expected, null, 2) + '\n')
    }
    expect(templateProject(id)).toEqual(expected)
  })
  for (const id of ids) for (const theme of Object.keys(THEMES)) {
    it(`${id} under ${theme} checks, loads, binds every control/slot and generates render fixtures`, async () => {
      const raw = templateProject(id, theme), t = THEMES[theme]
      const p = reducer(initialState(), { type: 'loadProject', project: raw }).project
      expect(p).toEqual(raw)
      expect(p).toMatchObject({ name: names[ids.indexOf(id)], version: 1, target: { vectorMod: VECTOR_FLOOR }, theme,
        pages: [{ id: 'p1', name: 'Main', surface: 'main', shape: 'square', size: { w: 460, h: 460 }, background: groundOf(t), scene: { header: { w: 480, h: 480, fit: 'contain' } } }] })
      expect(p.customLua === '').toBe(id !== 'airlock')
      const checker = new SceneChecker(checkWorkers().make)
      try { for (const pg of p.pages) expect((await checker.check(pg.scene)).errors).toEqual([]) } finally { checker.dispose() }
      expect(p.pages[0].scene.defs.some(n => n.op.toUpperCase() === 'FONT')).toBe(false)
      expect(p.pages[0].natives ?? []).toEqual([])
      const widgets = p.pages[0].scene.root.slice(id === 'needle-gauge' ? 6 : 0).map(n => widgetOf(n, t))
      expect(widgets.every(Boolean)).toBe(true)
      expect(widgets.length === 0).toBe(id === 'blank')
      expect(new Set(widgets.map(w => w!.uid)).size).toBe(widgets.length)
      const boxes = widgets.map(w => {
        const { exp } = expandRoot(w!, t)
        for (const slot of exp.slots) expect(p.bindings, slot.key).toHaveProperty(slot.key)
        for (const click of exp.clicks ?? []) expect(p.actions.some(a => a.on === click.id && a.do.length > 0), click.id).toBe(true)
        return w!.params as { x: number; y: number; w: number; h: number }
      })
      for (const [i, a] of boxes.entries()) {
        expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= 480 && a.y + a.h <= 480, JSON.stringify(a)).toBe(true)
        for (const b of boxes.slice(i + 1)) expect(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, JSON.stringify([a, b])).toBe(true)
      }
      for (const [i, sim] of p.simDevices.entries()) {
        expect(sim.id).toBe(`s${i + 1}`); expect(sim.ref).toBe(i + 2)
        const role = p.roles.find(r => r.id === sim.role)!
        expect(sim.label).toBe(role.label ?? '')
        expect(role.prefabs).toContain(sim.prefab)
        expect(Object.values(sim.values).every(v => v.kind === 'const')).toBe(true)
      }
      for (const read of p.reads) {
        const role = p.roles.find(r => r.id === read.role)!
        const type = 'lt' in read.of && 'name' in read.of.lt ? read.of.lt.name : ''
        for (const prefab of role.prefabs) expect(cat.byName.get(prefab)?.logic[type], read.id).toMatch(/^R/)
      }
      for (const rule of p.rules) for (const prefab of p.roles.find(r => r.id === rule.role)!.prefabs) expect(cat.byName.get(prefab)?.logic['name' in rule.lt ? rule.lt.name : '']).toBe('RW')
      const g = generate(p, pg => printSrc(pg.scene))
      expect(g.problems).toEqual([])
      expect(hostOf(p, cat, null).notes).toEqual([])
      await expect(g.lua).toMatchFileSnapshot(`../../test/fixtures/codegen/template-${id}-${theme}.lua`)
      await expect(JSON.stringify(hostOf(p, cat, null).host, null, 1) + '\n').toMatchFileSnapshot(`../../test/fixtures/codegen/template-${id}-${theme}.host.json`)
      await expect(JSON.stringify(manifestOf(p), null, 1) + '\n').toMatchFileSnapshot(`../../test/fixtures/codegen/template-${id}-${theme}.pages.json`)
    })
  }
  it('has exactly fourteen complete fixture triplets and reports the authored JSON size', () => {
    const files = readdirSync(new URL('../../test/fixtures/codegen/', import.meta.url)).filter(n => n.startsWith('template-'))
    for (const suffix of ['.lua', '.host.json', '.pages.json']) expect(files.filter(n => n.endsWith(suffix))).toHaveLength(14)
    const bytes = ids.reduce((n, id) => n + readFileSync(new URL(`../../../templates/${id}.json`, import.meta.url)).length, 0)
    expect(bytes).toBeGreaterThan(0)
    console.log(`Template JSON: ${bytes} UTF-8 bytes across ${ids.length} projects`)
  })
})

describe('plain-shape needle gauge', () => {
  it.each(Object.keys(THEMES))('links its plain shapes and Text widgets to %s, keeps bindings and parse index 5 across a theme switch', theme => {
    const p = templateProject('needle-gauge', theme), scene = p.pages[0].scene, t = THEMES[theme]
    expect(scene.root.slice(0, 6).map(n => n.op)).toEqual(['C', 'L', 'L', 'L', 'G', 'C'])
    expect(scene.root.slice(0, 6).every(n => widgetOf(n, t) === null)).toBe(true)
    expect(scene.root[0].attrs).toMatchObject({ cx: 240, cy: 250, rx: 140, ry: 140, sw: 4, f: colour(t, 'surface-panel'), s: colour(t, 'border-strong') })
    expect(linksOf(scene.root[0])).toEqual({ f: { role: 'surface-panel' }, s: { role: 'border-strong' } })
    expect(scene.root.slice(1, 4).map(n => n.attrs.p)).toEqual([[100, 250, 120, 250], [240, 110, 240, 130], [360, 250, 380, 250]])
    for (const n of scene.root.slice(1, 4)) { expect(n.attrs.s).toBe(colour(t, 'border-strong')); expect(linksOf(n)).toEqual({ s: { role: 'border-strong' } }) }
    expect(scene.root[4].attrs).toEqual({ a: [240, 250], r: '=clamp($gauge_level,0,1)*180-90', v: '=gt($gauge_present,0)' })
    expect(scene.root[4].c).toEqual([{ op: 'L', attrs: { p: [240, 250, 240, 120], sw: 4, s: colour(t, 'accent') }, comments: expect.any(Array) }])
    expect(linksOf(scene.root[4].c![0])).toEqual({ s: { role: 'accent' } })
    expect(scene.root[5].attrs.f).toBe(colour(t, 'accent'))
    expect(linksOf(scene.root[5])).toEqual({ f: { role: 'accent' } })
    expect(indexOfPath(parseOrder(scene), scene.root, [4, 0])).toBe(5)
    expect(p.bindings).toEqual({ gauge_value: { from: 'read', read: 'pressure' }, gauge_level: { from: 'expr', expr: 'P.pressure and P.pressure / 100 or nil' }, gauge_present: { from: 'expr', expr: 'P.pressure ~= nil and 1 or 0' } })
    expect(p.reads).toEqual([{ id: 'pressure', role: 'sensor', of: { lt: { name: 'Pressure' } }, valid: [0, 100000] }])
    const switched = reducer(initialState(p), { type: 'setTheme', theme: theme === 'neutral' ? 'vanilla-plus' : 'neutral' }).project
    expect(switched.bindings).toEqual(p.bindings)
    expect(switched.pages[0].scene.root[4].attrs).toEqual(scene.root[4].attrs)
    expect(switched.pages[0].scene.root[4].c![0].attrs.p).toEqual([240, 250, 240, 120])
    expect(switched.pages[0].scene.root[4].c![0].attrs.s).toBe(colour(themeOf(switched), 'accent'))
    expect(indexOfPath(parseOrder(switched.pages[0].scene), switched.pages[0].scene.root, [4, 0])).toBe(5)
    const texts = scene.root.slice(6, 11).map(n => widgetOf(n, t)!)
    expect(texts.map(w => w.type)).toEqual(['text', 'text', 'text', 'text', 'text'])
    expect(texts.map(w => w.params.text)).toEqual(['0', '50', '100', '{$gauge_value:%.0f}', 'Pressure kPa'])
  })
})
