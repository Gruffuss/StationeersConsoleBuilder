// Test helpers for codegen: re-export the shared Lua lexer and build the codegen fixture projects
// (each also a C# fixture: FixtureTests.Codegen runs the Lua generate writes for it).
import { DEVICES_PAGE, type Logic } from '../model/logic'
import { newPage, newProject, type Project } from '../model/project'
import type { Scene } from '../model/scene'
import { parseSrc } from '../srctext/parse'
import { groundOf } from '../theme'
import { vanillaPlus } from '../theme/vanillaPlus'
import type { Theme } from '../theme/types'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import type { WidgetRef } from '../widgets/types'
import { quote } from './lua'

export { lex } from './lua'

const set = (p: Project, l: Partial<Logic>) => Object.assign(p, l)

export function fixtureProjects(t: Theme = vanillaPlus): Record<string, Project> {
  const put = (scene: Scene, ...ws: WidgetRef[]) => ws.reduce((s, w) => putWidget(s, w, t), scene)
  // A read-only dashboard: an O2 tank read two ways, a Bar, a Text, the Header's counts and an Event log bound.
  const dashboard = newProject()
  dashboard.pages[0].scene = put(dashboard.pages[0].scene, instance('header'), instance('bar', { y: 120 }), instance('text', { y: 180, text: '$tank_kpa' }), instance('eventlog', { y: 240 }))
  set(dashboard, {
    roles: [{ id: 'tank', name: 'O2 tank', prefabs: ['StructureGasSensor'], label: 'O2 tank', mode: 'one' }],
    reads: [{ id: 'press', role: 'tank', of: { lt: { name: 'Pressure' } }, unit: 'kPa>MPa', clamp: [0, 1], smooth: 2,
      th: { warnAbove: 0.8, critAbove: 0.95, hyst: 0.02, log: 'O2 tank' }, history: { n: 30 } }, { id: 'kpa', role: 'tank', of: { lt: { name: 'Pressure' } } }],
    bindings: { bar1_lvl: { from: 'read', read: 'press' }, bar1_st: { from: 'read', read: 'press', part: 'state' }, tank_kpa: { from: 'read', read: 'kpa' },
      hdr1_crit: { from: 'expr', expr: 'alarms(3)' }, hdr1_warn: { from: 'expr', expr: 'alarms(2)' }, log1_k: { from: 'log', part: 'k' }, log1_m: { from: 'log', part: 'm' } },
    simDevices: [{ id: 'sim1', prefab: 'StructureGasSensor', label: 'O2 tank', ref: 2, role: 'tank', values: { Pressure: { kind: 'sine', mid: 500, amp: 400, period: 20 } } }],
  })
  // A control console: a Toggle drives a pump through a state and a rule, a press-plate Stepper sets its target, an Option
  // group a mode, a Button a pulse to every injector.
  const control = newProject()
  control.pages[0].scene = put(control.pages[0].scene, instance('toggle'), instance('stepper', { y: 100 }), instance('options', { y: 180 }), instance('button', { y: 260 }))
  set(control, {
    roles: [{ id: 'pump', name: 'Pump', prefabs: ['StructureVolumePump'], mode: 'one' }, { id: 'inj', name: 'Injectors', prefabs: ['ItemInjectorEpi'], mode: 'all' }],
    state: [{ name: 'tg1_on', type: 'bool', init: false }, { name: 'target', type: 'number', init: 10, min: 0, max: 100 }, { name: 'mode', type: 'number', init: 0 }],
    actions: [{ id: 'a1', on: 'tg1_hit', do: [{ op: 'toggle', state: 'tg1_on' }] },
      { id: 'a2', on: 'stp1_inc', do: [{ op: 'step', state: 'target', by: 5, min: 0, max: 'S.target + 50' }] },
      { id: 'a3', on: 'stp1_dec', do: [{ op: 'step', state: 'target', by: -5, min: 0, max: 100 }] },
      { id: 'a4', on: 'og1_o1', do: [{ op: 'set', state: 'mode', value: '1' }] },
      { id: 'a5', on: 'btn1_hit', do: [{ op: 'command', flag: 'fire' }, { op: 'log', text: '"fired"', level: 2 }] }],
    rules: [{ id: 'r1', role: 'pump', lt: { name: 'On' }, value: 'S.tg1_on and 1 or 0' }, { id: 'r2', role: 'pump', lt: { name: 'Setting' }, value: 'S.target' },
      { id: 'r3', role: 'inj', lt: { name: 'Activate' }, value: 'C.fire and 1 or nil', pulse: true }],
    bindings: { tg1_on: { from: 'state', state: 'tg1_on' }, stp1_v: { from: 'state', state: 'target' }, og1_sel: { from: 'state', state: 'mode' } },
    simDevices: [{ id: 's1', prefab: 'StructureVolumePump', label: 'Pump', ref: 2, role: 'pump', values: {} },
      { id: 's2', prefab: 'ItemInjectorEpi', label: 'Epi', ref: 3, role: 'inj', values: {} }],
  })
  // Two pages with tabs, a Button to the Devices page, and a role with two unlabelled candidates (so the Devices page opens first).
  const multipage = newProject()
  multipage.pages.push(newPage(multipage))
  multipage.pages[0].scene = put(multipage.pages[0].scene, instance('tabs'), instance('button', { y: 300, states: [{ label: 'Devices', variant: 'secondary' }] }))
  // Page 2 also holds a label with ]] and ]=] (the old C# Shell fixture's guard: its long bracket must pick a free level).
  const brackets = parseSrc('SCENE w=480 h=480\nT x=24 y=400 w=300 h=24 text="a ]] b ]=] c"\n').scene!.root
  multipage.pages[1].scene = put({ ...multipage.pages[1].scene, root: [...multipage.pages[1].scene.root, ...brackets] }, instance('tabs', {}, 'nav2'))
  set(multipage, {
    roles: [{ id: 'sensor', name: 'Sensor', prefabs: ['StructureGasSensor'], mode: 'one' }],
    actions: [{ id: 'dev', on: 'btn1_hit', do: [{ op: 'page', page: DEVICES_PAGE }] },
      ...(['nav1', 'nav2'] as const).flatMap(uid => [0, 1].map(k => ({ id: `${uid}_${k}`, on: `${uid}_t${k}`, do: [{ op: 'page' as const, page: `p${k + 1}` }] })))],
    simDevices: [{ id: 's1', prefab: 'StructureGasSensor', label: 'Front', ref: 2, role: 'sensor', values: {} },
      { id: 's2', prefab: 'StructureGasSensor', label: 'Back', ref: 3, values: {} }],
  })
  // A page of natives alone: an icon whose item is bound, a text input that sets a string state it shows.
  const natives = newProject()
  natives.pages[0] = { ...natives.pages[0], natives: [instance('icon'), instance('textinput')] }
  set(natives, {
    state: [{ name: 'room', type: 'string', init: 'Lab' }],
    actions: [{ id: 'name', on: 'ti1', do: [{ op: 'set', state: 'room', value: 'E.v' }] }],
    bindings: { '@ico1.name': { from: 'expr', expr: '"ItemIronOre"' }, '@ti1.value': { from: 'state', state: 'room' } },
  })
  // A custom block with hooks: an export bound to a Text, a call step from a Button, a log line.
  const custom = newProject()
  custom.pages[0].scene = put(custom.pages[0].scene, instance('text', { text: '$uptime' }), instance('button', { y: 100 }))
  set(custom, {
    actions: [{ id: 'hook', on: 'btn1_hit', do: [{ op: 'call', fn: 'pressed' }] }],
    bindings: { uptime: { from: 'export', name: 'uptime' } },
    customLua: ['function U.init() X.uptime = 0 end', 'function U.after_reads(P, S, dt) X.uptime = X.uptime + dt end',
      'function U.pressed(e) log("pressed " .. tostring(e.id), 1) end', ''].join('\n'),
  })
  // Free-text custom export names: these bypass load-time logic sanitization, as a Data panel setLogic patch does.
  const exports = ['', 'up time', 'up-time', 'end', 'a"b\\c\n1']
  for (let k = 0; k < exports.length; k++) {
    custom.pages[0].scene = put(custom.pages[0].scene, instance('text', { text: `$export${k}`, y: 180 + k * 50 }, `txt${k + 2}`))
    custom.bindings[`export${k}`] = { from: 'export', name: exports[k] }
    custom.customLua += `X[${quote(exports[k])}] = ${quote(`entry${k}`)}\n`
  }
  // Example projects with no custom Lua. A read-only battery dashboard: the bank's
  // charge as a weighted fraction (sum of Charge over sum of Maximum through a derived over the earlier read, never an average
  // of percents) with hysteresis thresholds that log, a row per battery with its Labeller name (R.batt.names), a room's
  // temperature in °C with a valid range (an analyzer off its network reads nothing, not 0 K), the Header's alarm counts.
  // Slot keys follow the modules (Task 6's facts: a `row` Repeater has n, name, v, st).
  const charge = (c: number, m: number) => ({ Charge: { kind: 'const' as const, v: c }, Maximum: { kind: 'const' as const, v: m } })
  const batteries = {
    roles: [{ id: 'batt', name: 'Batteries', prefabs: ['StructureBattery', 'StructureBatteryLarge'], mode: 'all' as const }],
    reads: [{ id: 'cap', role: 'batt', of: { lt: { name: 'Maximum' } }, agg: 'sum' as const },
      { id: 'frac', role: 'batt', of: { lt: { name: 'Charge' } }, agg: 'sum' as const, derived: 'P.cap and P.cap > 0 and x / P.cap or nil',
        th: { critBelow: 0.1, warnBelow: 0.25, hyst: 0.05, log: 'Battery bank' } }],
    sims: [{ id: 'b1', prefab: 'StructureBatteryLarge', label: 'LRG1', ref: 2, role: 'batt', values: charge(900, 1000) },
      { id: 'b2', prefab: 'StructureBattery', label: 'STN1', ref: 3, role: 'batt', values: charge(100, 1000) }],
  }
  const corpusDashboard = newProject()
  corpusDashboard.pages[0].scene = put(corpusDashboard.pages[0].scene, instance('header'), instance('bar', { y: 120 }),
    instance('text', { y: 180, text: '$room_c' }), instance('repeater', { y: 240, item: 'row' }))
  set(corpusDashboard, {
    roles: [...batteries.roles, { id: 'room', name: 'Room', prefabs: ['StructureGasSensor'], label: 'Room', mode: 'one' }],
    reads: [...batteries.reads, { id: 'cells', role: 'batt', of: { lt: { name: 'Charge' } }, agg: 'list' },
      { id: 'temp', role: 'room', of: { lt: { name: 'Temperature' } }, valid: [1, 100000], unit: 'K>C', th: { warnAbove: 30, critAbove: 40, hyst: 1 } }],
    bindings: { bar1_lvl: { from: 'read', read: 'frac' }, bar1_st: { from: 'read', read: 'frac', part: 'state' }, room_c: { from: 'read', read: 'temp' },
      hdr1_crit: { from: 'expr', expr: 'alarms(3)' }, hdr1_warn: { from: 'expr', expr: 'alarms(2)' },
      rep1_n: { from: 'expr', expr: 'R.batt.n' }, rep1_name: { from: 'expr', expr: 'R.batt.names' }, rep1_v: { from: 'read', read: 'cells' }, rep1_st: { from: 'read', read: 'cells', part: 'state' } },
    simDevices: [...batteries.sims, { id: 's3', prefab: 'StructureGasSensor', label: 'Room', ref: 4, role: 'room', values: { Temperature: { kind: 'sine', mid: 295, amp: 10, period: 30 } } }],
  })
  // A power controller: a tri-state override (Auto / On / Off) from an Option group, generators driven
  // by a hysteresis rule on the bank's weighted fraction that holds between its edges (nil: no write), and an Event log.
  const corpusPower = newProject()
  corpusPower.pages[0].scene = put(corpusPower.pages[0].scene, instance('options'), instance('eventlog', { y: 200 }))
  set(corpusPower, {
    roles: [...batteries.roles, { id: 'gens', name: 'Generators', prefabs: ['StructureSolidFuelGenerator'], mode: 'all' }],
    reads: batteries.reads,
    state: [{ name: 'og1_sel', type: 'number', init: 0, min: 0, max: 2 }],
    actions: [0, 1, 2].map(k => ({ id: `mode${k}`, on: `og1_o${k}`, do: [{ op: 'set' as const, state: 'og1_sel', value: String(k) },
      { op: 'log' as const, text: `"mode ${['auto', 'on', 'off'][k]}"` }] })),
    rules: [{ id: 'gen', role: 'gens', lt: { name: 'On' }, value: 'S.og1_sel == 1 and 1 or S.og1_sel == 2 and 0 or (P.frac and (P.frac < 0.1 and 1 or P.frac > 0.25 and 0 or nil))' }],
    bindings: { og1_sel: { from: 'state', state: 'og1_sel' }, log1_k: { from: 'log', part: 'k' }, log1_m: { from: 'log', part: 'm' } },
    simDevices: [...batteries.sims, { id: 'g1', prefab: 'StructureSolidFuelGenerator', label: 'GEN1', ref: 4, role: 'gens', values: {} }],
  })
  const initPage = structuredClone(multipage), initRequired = structuredClone(multipage)
  initPage.roles[0].optional = true
  for (const [p, expected] of [[initPage, 'p2'], [initRequired, DEVICES_PAGE]] as const) {
    // The fixture runs in Lua-CSharp: check boot and two ticks before the general page-visit corpus starts.
    p.customLua = `function U.init() page.go("p2") end
local boot = VB.boot
VB.boot = function()
  boot()
  assert(page.id == "${expected}", "U.init page selection at boot")
  VB.tick(0.1)
  VB.tick(0.1)
  assert(page.id == "${expected}", "U.init page selection after two ticks")
end
local VB = {}
local function tick() error("custom local tick reached") end
`
  }
  const pageFonts = structuredClone(multipage)
  const shared = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700'
  pageFonts.pages[0].scene.defs.push({ op: 'font', attrs: { SRC: shared }, comments: ['page link survives printing'] },
    { op: 'FONT', attrs: { src: 'https://fonts.gstatic.com/direct.ttf' } },
    { op: 'FONT', attrs: { src: 'https://blocked.example/font.otf' } }, { op: 'FONT', attrs: { src: shared } })
  pageFonts.pages[1].scene.defs.push({ op: 'FONT', attrs: { src: shared } },
    { op: 'FONT', attrs: { src: 'https://fonts.googleapis.com/css2?family=Roboto:wght@100..900' } },
    { op: 'FONT', attrs: { src: 'https://fonts.gstatic.com/quoted"\\link\nnext.woff2' } })
  const nestedWidgets = newProject()
  const nestedButton = { ...instance('button', { x: 20, y: 30, w: 80, h: 54, canDisable: true, states: [{ label: ' ', variant: 'danger', key: 0 }] }),
    edit: { v: 1 as const, parts: { 'state.0.body': { attrs: { rx: 0 } } } } }
  const nestedScene = put({ ...nestedWidgets.pages[0].scene, header: { w: 460, h: 460 } }, nestedButton)
  nestedWidgets.pages[0].scene = { ...nestedScene, root: [{ op: 'G', attrs: { t: [100, 50], r: 30 }, c: nestedScene.root }] }
  const projects = { 'nested-widgets': nestedWidgets, 'page-fonts': pageFonts, 'init-page': initPage, 'init-required': initRequired, dashboard, control, multipage, natives, custom, 'corpus-dashboard': corpusDashboard, 'corpus-power': corpusPower }
  for (const p of Object.values(projects)) {
    p.theme = t.id
    for (const page of p.pages) page.background = groundOf(t)
  }
  return projects
}
