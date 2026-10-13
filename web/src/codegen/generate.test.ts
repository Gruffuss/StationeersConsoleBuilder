import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { crc32 } from '../catalog/crc32'
import { catalogOf } from '../catalog'
import { newLogic } from '../model/logic'
import { initialState, reducer } from '../model/store'
import { quote } from './lua'
import { newProject, newPage, VECTOR_FLOOR, type Project } from '../model/project'
import { parseSrc } from '../srctext/parse'
import { printSrc } from '../srctext/print'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { bannerSrc, CUSTOM_BEGIN, CUSTOM_END, floorVer, generate } from './generate'
import { hostOf } from './hostOf'
import { REQUIREMENTS } from './requirements'
import RUNTIME from './runtime.lua?raw'
import { emptyPageProjects, fixtureProjects, lex } from './testing'
import { compressProject } from '../project/codec'
import { assembleExport } from './export'
import { answer } from '../project/transfer.worker'
import { unpack } from '../srctext/wire'

const gen = (p: Project) => generate(p, pg => printSrc(pg.scene))
const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'))
const cat = catalogOf(json('../catalog/devices.json'), json('../catalog/enums.json'))
const withBar = (): Project => {
  const p = newProject()
  p.pages[0] = { ...p.pages[0], scene: putWidget(p.pages[0].scene, instance('bar'), vanillaPlus) }
  return p
}

describe('the export', () => {
  it('owns row flags at fixed uid names and excludes their samples and bindings from export data', () => {
    const p = newProject()
    p.pages[0].scene = putWidget(p.pages[0].scene, instance('repeater', { keys: { hasv: 'shared', ready: 'same' } }), vanillaPlus)
    p.pages[0].scene = putWidget(p.pages[0].scene, instance('repeater', { keys: { hasv: 'shared', ready: 'same' } }, 'rep2'), vanillaPlus)
    p.bindings.rep1_hasv = { from: 'const', value: 999 }
    const { lua, problems } = gen(p)
    expect(lua).toContain('hasv = "rep1_hasv", ready = "rep1_ready"')
    expect(lua).toContain('hasv = "rep2_hasv", ready = "rep2_ready"')
    expect(lua).not.toContain('o["rep1_hasv"] = 999')
    const samples = lua.match(/samples = \{ ([^]*?) \}, nils/)![1]
    expect(samples).not.toContain('rep1_hasv')
    expect(samples).not.toContain('rep1_ready')
    expect(problems.find(p => p.message.startsWith('unbound data names'))?.message).not.toContain('hasv')
    expect(problems).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('rep1_hasv: runtime-owned') }))
  })
  it('connects each repeater row flag to its count and value keys, including renamed keys', () => {
    const p = newProject()
    p.pages[0].scene = putWidget(p.pages[0].scene, instance('repeater', { keys: { n: 'rows', v: 'values', hasv: 'present' }, max: 4 }), vanillaPlus)
    const { lua } = gen(p)
    expect(lua).toContain('repeaters = { { n = "rows", v = "values", hasv = "rep1_hasv", ready = "rep1_ready", max = 4 } }')
    expect(lua).toContain('["rep1_hasv"] = true')
    expect(lua).not.toContain('["present"] = true')
  })
  it('warns per player for unknown scene and rich-text faces independently of local imports, and keeps export names', async () => {
    const { importFont, removeFont } = await import('../editor/fonts')
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    vi.stubGlobal('document', { fonts: { add() {}, delete() {} } })
    const p = newProject()
    p.pages[0].scene = { ...p.pages[0].scene, header: { ...p.pages[0].scene.header, font: 'Absent' },
      root: [{ op: 'T', attrs: { text: '<font="Manrope">\u6f22\u5b57</font><font="Barlow Black Italic">x</font>', font: 'Inter' } }] }
    try {
      const result = gen(p)
      expect(result.problems.filter(x => x.level === 'warning').map(x => x.message)).toEqual([
        'page p1: font "Absent": unless the player has this face, the game uses its fallback and reports it.',
        'page p1: font "Inter": unless the player has this face, the game uses its fallback and reports it.',
        'page p1: font tag "Manrope": unless the player has this face, the tag shows as text in game.',
      ])
      expect(result.lua).toContain('Manrope')
      expect(result.lua.split('\n')[1]).toBe(`-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector ${VECTOR_FLOOR} or newer and ScriptedScreens Fonts (Absent, Inter, Manrope, Barlow Black Italic).`)
      await importFont('Manrope', new ArrayBuffer(8), false)
      expect(gen(p)).toEqual(result)
    } finally { await removeFont('Manrope'); vi.unstubAllGlobals() }
  })
  it('lays out: header, the library verbatim, VB.cfg, the custom block between markers, boot, tick', () => {
    const { lua } = gen({ ...withBar(), customLua: 'U.x = 1\n' })
    const lines = lua.split('\n')
    expect(lines[0]).toBe(`-- VectorBuilder export · runtime library 1 · ScriptedScreens Vector >= ${VECTOR_FLOOR} (ver ${floorVer(VECTOR_FLOOR)})`)
    expect(lines[1]).toBe(`-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens and ScriptedScreens Vector ${VECTOR_FLOOR} or newer.`)
    // Each needed mod's link follows as a comment line; the Fonts mod only when it is needed.
    expect(lines.slice(2, 8)).toEqual(REQUIREMENTS.filter(r => !r.fonts).map(r => `--   ${r.name}: ${r.url}`))
    expect(lua).not.toContain('ScriptedScreens Fonts')
    const fonted = withBar()
    fonted.pages[0].scene = { ...fonted.pages[0].scene, root: [...fonted.pages[0].scene.root, ...parseSrc('SCENE w=480 h=480\nT x=0 y=0 w=50 h=10 text="x" font="Barlow SemiBold"\n').scene!.root] }
    expect(gen(fonted).lua.split('\n')[1]).toBe(`-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector ${VECTOR_FLOOR} or newer and ScriptedScreens Fonts (Barlow SemiBold).`)
    expect(lua).toContain(RUNTIME.replace(/\r\n|\n\r|\r/g, '\n').trimEnd())
    expect(lua.indexOf('VB.cfg = {')).toBeGreaterThan(lua.indexOf(RUNTIME.replace(/\r\n|\n\r|\r/g, '\n').trimEnd()))
    expect(lua).toContain(`do\n${CUSTOM_BEGIN}\nU.x = 1\n${CUSTOM_END}\nend\nVB.boot()\nfunction tick(dt) VB.tick(dt) end\n`)
  })
  it.each([
    ['0.11.99', 11099], ['0.11.101', 11101], ['0.11.118', 11118], ['0.12.0', 12000], ['1.0.0', 1000000],
  ])('encodes the export floor %s as %i', (tag, ver) => {
    expect(floorVer(tag)).toBe(ver)
  })
  it.each([[1201, true], [11117, true], [11118, false], [12000, false]])(
    'the generated page banners show for ver=%i: %s', (ver, visible) => {
      const { lua } = gen(fixtureProjects().multipage)
      expect(lua.split('\n')[0]).toContain('ScriptedScreens Vector >= 0.11.118 (ver 11118)')
      expect(lua).toContain('VB.cfg = { lib = 1, floor = 11118,')
      // Read both lazy project pages and the Devices page from the actual Lua export.
      const srcs = [...lua.matchAll(/src = \[(=+)\[\n([^]*?)\]\1\]/g)].map(m => m[2])
      expect(srcs).toHaveLength(3)
      for (const src of srcs) {
        const parsed = parseSrc(src)
        expect(parsed.errors).toEqual([])
        const banner = parsed.scene!.root.at(-1)!
        expect(banner.op).toBe('G')
        expect(banner.attrs.v).toBe('=lt(ver,11118)')
        expect(banner.c!.find(n => n.op === 'T')!.attrs.text).toBe('Update ScriptedScreens Vector to 0.11.118 or newer')
        const floor = Number(String(banner.attrs.v).match(/^=lt\(ver,(\d+)\)$/)![1])
        expect(ver < floor).toBe(visible)
      }
    })
  it('normalises runtime, src and custom line breaks to LF and maps Lua lines', () => {
    const p = { ...newProject(), customLua: 'U.a = 1\rU.b = 2\n\rU.c = 3\r\n' }
    const { lua, map } = generate(p, () => 'SCENE w=480 h=480\r\n')
    expect(lua.includes('\r')).toBe(false)
    expect(lua).toContain(`${CUSTOM_BEGIN}\nU.a = 1\nU.b = 2\nU.c = 3\n${CUSTOM_END}`)
    const custom = map.find(e => e.part === 'custom')!
    expect(custom.last - custom.first + 1).toBe(3)
    expect(map.at(-1)!.last).toBe(lua.split('\n').length - 1)
  })
  it('maps every line once, in order, to its owner', () => {
    const p = fixtureProjects().control
    const { lua, map } = gen(p)
    const n = lua.split('\n').length - 1
    expect(map[0].first).toBe(1)
    for (let k = 1; k < map.length; k++) expect(map[k].first).toBe(map[k - 1].last + 1)
    expect(map[map.length - 1].last).toBe(n)
    expect(map.filter(e => e.part === 'rule').map(e => e.ref)).toEqual(p.rules.map(r => r.id))
  })
  it('is Lua 5.2: no //, no bitwise operators, no ~ but ~=', () => {
    for (const [name, p] of Object.entries(fixtureProjects())) {
      const { code } = lex(gen(p).lua)
      expect({ name, bad: code.match(/\/\/|<<|>>|[^~<>=]~(?!=)|&|\|/g) }).toEqual({ name, bad: null })
    }
  })
  it('warns where a format(…) holds %d or %i: Lua 5.2 raises on a fraction (D17)', () => {
    const p = { ...withBar(), customLua: 'function U.f() return string.format("%d", 1.5) end\nlocal n = ("42"):match("%d+")\n' }
    p.bindings = { bar1_lvl: { from: 'expr', expr: 'string.format("%5i W", P.x or 0)' } }
    expect(gen(p).problems.filter(x => x.level === 'warning').map(x => x.message)).toEqual([
      'binding bar1_lvl: %d needs an integer (Lua 5.2 raises on a fraction): use %.0f or math.floor',
      'custom code: %d needs an integer (Lua 5.2 raises on a fraction): use %.0f or math.floor'])
  })
})

describe('hostile pages (moved from shell.test.ts: an untrusted project never writes Lua of its own)', () => {
  it('keeps a page size, a background and a src inside their literals', () => {
    const p = newProject()
    p.pages[0] = { ...p.pages[0], size: { w: '1) os.exit(' as never, h: 460 }, background: ['red") os.exit("', '#000000'] }
    p.pages.push({ ...newPage(p), scene: parseSrc('SCENE w=100 h=100\nT x=0 y=0 w=50 h=10 text="a ]] b ]=] c ]==] d"\n').scene! })
    const { lua } = gen(p)
    expect(lex(lua).code).not.toMatch(/os\.exit/)
    // Each src literal read up to its own closing bracket, as Lua reads it: the text survives whole only when the level is free.
    const srcs = [...lua.matchAll(/src = \[(=*)\[\n([^]*?)\]\1\]/g)]
    expect(srcs.some(m => m[2].includes('a ]] b ]=] c ]==] d'))).toBe(true)
  })
})

describe('retired shell guards', () => {
  it('keeps supplied src whole, picking the smallest free long bracket before the last-child banner', () => {
    const p = newProject()
    p.pages.push(newPage(p))
    for (const pg of p.pages) pg.scene.root = [{ op: 'R', attrs: { w: 10, h: 10 } }]
    const { lua } = generate(p, pg => `${pg.id} text="a]==]b ]===]"\n`)
    const srcs = [...lua.matchAll(/src = \[(=+)\[\n([^]*?)\]\1\]/g)]
    expect(srcs).toHaveLength(2)
    for (let k = 0; k < srcs.length; k++) {
      expect(srcs[k][1]).toBe('====')
      expect(srcs[k][2]).toBe(`${p.pages[k].id} text="a]==]b ]===]"\n` + bannerSrc(p.pages[k].scene.header))
    }
    expect(gen(p).lua).toContain('src = [==[\nSCENE')
  })
  it('writes bounded whole sizes and quotes surface names', () => {
    const p = newProject()
    p.pages[0].size = { w: '1) os.exit(' as never, h: 1e9 }
    p.pages[0].surface = 'a"b\\c\n1'
    expect(gen(p).lua).toContain('w = 460, h = 8192, dw =')
    expect(gen(p).lua).toContain('surface = "a\\"b\\\\c\\0101"')
    p.pages[0].size = { w: 300.6, h: -5 }
    expect(gen(p).lua).toContain('w = 301, h = 1, dw =')
  })
  it('writes assigned backgrounds and uses transparent for invalid colours on a blank page', () => {
    const p = newProject()
    p.pages[0].background = ['#3A3A43', '#24242A']
    expect(gen(p).lua).toContain('bg = { bg = "#3A3A43", gradient = "#24242A" }')
    p.pages[0].background = ['#0A121C']
    expect(gen(p).lua).toContain('bg = { bg = "#0A121C" }')
    p.pages[0].background = ['red", x = "1']
    expect(gen(p).lua).toContain('bg = { bg = "#00000000" }')
    p.pages[0].background = ['#123', '#11223344']
    const { lua } = gen(p)
    expect(lua).toContain('bg = { bg = "#00000000", gradient = "#11223344" }')
    expect(lua).toContain('empty = true')
  })
})

describe('VB.cfg', () => {
  it.each(['', 'up time', 'up-time', 'end', 'a"b\\c\n1', '温度', 'x] = error("injected") --'])('quotes export lookup %j from an unsanitized setLogic patch', name => {
    const p = withBar()
    const patched = reducer(initialState(p), { type: 'setLogic', patch: { bindings: { bar1_lvl: { from: 'export', name } } } }).project
    const { lua, problems } = gen(patched)
    expect(lua).toContain(`o["bar1_lvl"] = X[${quote(name)}]`)
    expect(problems.filter(p => p.level === 'error')).toEqual([])
  })
  it('writes roles with hashed prefabs and keys; reads with every transform; state; rules with pulse and skip', () => {
    const p = fixtureProjects().dashboard
    p.roles.push({ id: 'gen', name: 'Generator', prefabs: [], mode: 'one', pin: 2 }, { id: 'vents', name: 'Vents', prefabs: ['StructureActiveVent'], mode: 'all' })
    p.roles.push({ id: 'stack', name: 'Stacker', prefabs: [], mode: 'one', optional: true, distinct: true })
    p.reads.push({ id: 'cells', role: 'vents', of: { lt: { id: 1224 } }, agg: 'list', valid: [0, 1] }, { id: 'seed', role: 'tank', of: { slot: 0, lst: 'Quantity' }, derived: 'x * 2', scale: 2, offset: -1 })
    p.state.push({ name: 'room', type: 'string', init: 'Lab', mirrorBytes: 12 }, { name: 'mode', type: 'enum', init: 1, options: ['a', 'b', 'c'], save: false })
    p.rules.push({ id: 'r1', role: 'vents', lt: { name: 'On' }, value: 'S.mode == 1', skipBoot: true }, { id: 'r2', role: 'gen', lt: { name: 'Activate' }, value: 'C.go and 1', pulse: true })
    const { lua } = gen(p)
    expect(lua).toContain(`    { id = "tank", name = "O2 tank", prefabs = { ${crc32('StructureGasSensor')} }, label = "O2 tank", all = false, key = ${crc32('r:tank')} },`)
    expect(lua).toContain(`    { id = "gen", name = "Generator", prefabs = {  }, label = nil, all = false, pin = 2, key = ${crc32('r:gen')} },`)
    expect(lua).toContain(`    { id = "stack", name = "Stacker", prefabs = {  }, label = nil, all = false, optional = true, distinct = true, key = ${crc32('r:stack')} },`)
    expect(lua).toContain('{ id = "cells", role = 3, lt = 1224, agg = "list", valid = { 0, 1 } },')
    expect(lua).toContain('{ id = "seed", role = 1, slot = 0, lst = "Quantity", scale = 2, offset = -1, derived = function(x) return (x * 2) end },')
    expect(lua).toContain('th = { warnAbove = 0.8, critAbove = 0.95, hyst = 0.02, log = "O2 tank" }, hist = { n = 30, every = 1 } },')
    expect(lua).toContain(`{ name = "room", type = "string", init = "Lab", save = true, bytes = 12, key = ${crc32('s:room')} },`)
    expect(lua).toContain(`{ name = "mode", type = "enum", init = 1, n = 3, save = false, key = ${crc32('s:mode')} },`)
    expect(lua).toContain('{ role = 3, lt = "On", f = function() return (S.mode == 1) end, skip = true, pulse = false },')
    expect(lua).toContain('{ role = 2, lt = "Activate", f = function() return (C.go and 1) end, skip = false, pulse = true },')
    expect(lua).toContain(`magic = ${crc32('vectorbuilder-mirror-1')}`)
  })
  it('groups actions by node, flags press plates from the widget, writes steps; a native acts on change', () => {
    const { lua } = gen(fixtureProjects().control)
    expect(lua).toContain('["tg1_hit"] = { press = false, list = { { steps = { { op = "toggle", s = "tg1_on" } } } } },')
    expect(lua).toContain('["stp1_inc"] = { press = true, list = { { steps = { { op = "step", s = "target", by = 5, min = function() return 0 end, max = function() return (S.target + 50) end } } } } },')
    expect(lua).toContain('{ op = "command", c = "fire" }, { op = "log", f = function() return ("fired") end, level = 2 }')
    const natives = gen(fixtureProjects().natives).lua
    expect(natives).toContain('["ti1"] = { native = true, list = { { steps = { { op = "set", s = "room", f = function() return (E.v) end } } } } },')
  })
  it('keys a page-scoped action by page; warns when one id is a press plate on some pages only (ruling P18)', () => {
    const p = newProject()
    p.pages.push(newPage(p))
    p.pages[0].scene = parseSrc('SCENE w=480 h=480\nR id=back click=1 x=0 y=0 w=10 h=10\n').scene!
    p.pages[1].scene = parseSrc('SCENE w=480 h=480\nR id=back press=1 x=0 y=0 w=10 h=10\n').scene!
    p.actions = [{ id: 'b2', on: 'back', page: 'p2', do: [{ op: 'page', page: 'p1' }] }, { id: 'b', on: 'back', do: [{ op: 'page', page: 'p2' }] }]
    const { lua, problems } = gen(p)
    expect(lua).toContain('["p2/back"] = { press = true, list = { { steps = { { op = "page", page = "p1" } } } } },')
    expect(problems).toContainEqual({ level: 'warning', message: 'action b: back is a press plate on some pages and not on others (p1, p2); scope the action to a page' })
  })
  it('warns when an action on an index-addressed plate no longer does what the plate suggests (a Remove renumbered it)', () => {
    const p = fixtureProjects().multipage
    p.actions = p.actions.map(a => a.id === 'nav1_0' ? { ...a, do: [{ op: 'page', page: 'p2' }] } : a)
    expect(gen(p).problems.filter(x => x.message.startsWith('action nav1_0:')).map(x => x.message))
      .toEqual([expect.stringMatching(/^action nav1_0: nav1_t0 now suggests page\(p\d\); this action does page\(p2\) \(an item removed or moved\?\)$/)])
  })
  it('writes each page: src with the banner last, snap, nils, samples, the data function, natives with their bindings', () => {
    const { lua } = gen(fixtureProjects().dashboard)
    expect(lua).toMatch(/src = \[==\[\nSCENE[^]*\nG v==lt\(ver,\d+\) \{\n[^]*\}\n\]==\],/)
    expect(lua).toContain('o["bar1_lvl"] = P.press')
    expect(lua).toContain('o["log1_k"] = L.k')
    expect(lua).toContain('["log1_k"] = { 0 }')
    expect(lua).toContain('["hdr1_crit"] = 0')
    const natives = gen(fixtureProjects().natives).lua
    expect(natives).toContain('empty = true')
    expect(natives).toContain('bind = { ["name"] = function() return ("ItemIronOre") end }')
    expect(natives).not.toContain('G v==lt(ver,')
  })
  it('sends unbound names their sample and says so; a page value wins over the slot sample', () => {
    const p = withBar()
    p.pages[0].preview = { bar1_lvl: 0.25 }
    const { lua, problems } = gen(p)
    expect(lua).toContain('samples = { ["bar1_lvl"] = 0.25, ["bar1_st"] = 1 }')
    expect(problems).toContainEqual({ level: 'info', message: 'unbound data names send their samples: bar1_lvl, bar1_st' })
  })
  it('snaps history and label-only bindings even when easing is requested', () => {
    const p = fixtureProjects().dashboard
    p.pages[0].scene.root.push(...parseSrc('SCENE w=480 h=480\nT x=0 y=0 w=20 h=20 text="$raw"\n').scene!.root)
    p.bindings.raw = { from: 'const', value: [1, 2], ease: true }
    p.bindings.bar1_lvl = { from: 'read', read: 'press', part: 'history' }
    p.bindings.tank_kpa = { from: 'export', name: 'temperature' }
    const { lua } = gen(p)
    const page = lua.slice(lua.indexOf('  pages = {'), lua.indexOf('  devices ='))
    expect(page).toContain('o["raw"] = { 1, 2 }')
    expect(page).toContain('o["bar1_lvl"] = H.press')
    expect(page).toContain('o["bar1_st"] = T.press')
    expect(page).toContain('o["tank_kpa"] = X["temperature"]')
    const snap = page.match(/snap = \{ ([^]*?) \}, samples/)![1]
    expect(snap).toContain('["bar1_st"] = true')
    expect(snap).toContain('["bar1_lvl"] = true')
    expect(snap).toContain('["raw"] = true')
    expect(page).toContain('["log1_m"] = { "" }')
    expect(page).toContain('["log1_k"] = { 0 }')
  })
  it('drops refused derived functions and individual steps, leaving their holders usable', () => {
    const p = fixtureProjects().control
    p.reads = [{ id: 'r', role: 'pump', of: { lt: { name: 'Setting' } }, derived: 'x; 1' }]
    p.actions[0].do = [{ op: 'set', state: 'tg1_on', value: 'true; 1' }, { op: 'log', text: 'return 1' },
      { op: 'step', state: 'target', by: 1, min: 'x = 1', max: 100 }, { op: 'toggle', state: 'tg1_on' }]
    const { lua, problems } = gen(p)
    expect(problems.filter(x => x.level === 'error').map(x => x.owner)).toEqual(['read r (derived)', 'action a1', 'action a1', 'action a1'])
    expect(lua).toContain('{ id = "r", role = 1, lt = "Setting" },')
    expect(lua).toContain('["tg1_hit"] = { press = false, list = { { steps = { { op = "toggle", s = "tg1_on" } } } } },')
  })
  it('writes the Devices page when a role scans the network, maps page steps to it, and warns when nothing leads there', () => {
    const multi = gen(fixtureProjects().multipage)
    expect(multi.lua).toContain('devices = { id = "vb_devices", surface = "vb_devices"')
    expect(multi.lua).toContain('{ op = "page", page = "vb_devices" }')
    expect(multi.problems.some(x => x.message.includes('no way in'))).toBe(false)
    const p = { ...newProject(), ...newLogic(), roles: [{ id: 'a', name: 'A', prefabs: [], mode: 'one' as const }] }
    expect(gen(p).problems).toContainEqual({ level: 'warning', message: 'the Devices page has no way in: add a page step to it (a button or a tab)' })
    expect(gen({ ...p, roles: [{ id: 'a', name: 'A', prefabs: [], mode: 'one', pin: 0 }] }).lua).toContain('  devices = nil,')
  })
})

describe('problems', () => {
  it('drops what holds a refused expression and names its owner', () => {
    const p = fixtureProjects().control
    p.rules[0] = { ...p.rules[0], value: '1 end x = (2' }
    p.actions[0] = { ...p.actions[0], when: 'x = 1' }
    p.bindings.stp1_v = { from: 'expr', expr: 'S.target;' }
    const { lua, problems } = gen(p)
    expect(problems.filter(x => x.level === 'error').map(x => x.message)).toEqual([
      'action a1 (when): an expression cannot assign ("=")', 'rule r1: "end" is not allowed in an expression', 'binding stp1_v: ";" is not allowed in an expression'])
    expect(lua).not.toContain('1 end x = (2')
    expect(lua).not.toContain('o["stp1_v"]')
  })
  it.each([`x = 1 ${CUSTOM_END}`, `--[=[\n${CUSTOM_END}\n]=]`])('restores custom marker comments verbatim from the embedded project: %s', async customLua => {
    const p = { ...newProject(), customLua }, generated = gen(p)
    expect(generated.problems.filter(p => p.level === 'error')).toEqual([])
    const artifact = assembleExport(generated, await compressProject(p), new Date('2026-10-12T00:00:00Z'))
    const reply = await answer({ id: 1, kind: 'read', format: 'lua', text: artifact.lua })
    if (!reply.ok || typeof reply.value !== 'object' || !('project' in reply.value)) throw Error('Missing restored project')
    expect((unpack(reply.value.project) as Project).customLua).toBe(customLua)
  })
  it('refuses a standalone custom end marker outside comments and strings', () => {
    for (const customLua of [CUSTOM_END, `x = 1\n  ${CUSTOM_END}  \nx = 2`]) {
      expect(gen({ ...newProject(), customLua }).problems.some(p => p.level === 'error' && p.message.includes('end marker line'))).toBe(true)
    }
  })
  it('refuses a custom block that defines tick, assigns a reserved global whole, or holds the end marker', () => {
    const p = { ...newProject(), customLua: `function tick(dt) end\nP = {}\nS.x = 1\n${CUSTOM_END}\n` }
    expect(gen(p).problems.filter(x => x.level === 'error').map(x => x.message)).toEqual([
      'custom code: holds the end marker line; the block would end there',
      'custom code: defines tick; the export defines tick after the block, so this one never runs (use the U hooks)',
      'custom code: assigns the reserved global P; assign its fields (P.x = …) instead'])
  })
  it.each([
    'local cfg = {\n page = 1,\n log = "x",\n tick = 5,\n nested = { P = 2 }\n}',
    'x = [[\nfunction tick()\npage = 1\n]]',
    'x = [==[\nlog = 2\nfunction tick()\n]==]',
    '--[=[\nP = {}\nfunction tick()\n]=]\n-- log = 1',
    'local page, log = 1, 2\npage = 3\nlog = 4',
    'local function tick() end\ntick = function() end',
    'function U.f(page) page = 1 end',
    'repeat local page = 1 until (function() page = 2 return true end)()',
    'for page = 1, 2 do page = page + 1 end',
    'local t = { f = function(log) log = 1 end }',
    'x = "page = 1\\nfunction tick()"',
    'x.page = 1; x.log = 2; function x.tick() end',
  ])('accepts custom fields, locals, comments and strings: %s', customLua => {
    expect(gen({ ...newProject(), customLua }).problems.filter(p => p.level === 'error')).toEqual([])
  })
  it.each(['page = 1', 'if true then log = 2 end', 'function tick() end', 'tick = function() end',
    'x, P = 1, {}', 'P, t.x = 1, 2', 'P, t[1] = 1, 2', 'function log() end', 'local t = { f = function() page = 1 end }',
    'do local page = 1 end; page = 2',
    'local page = (function() page = 1 return 2 end)()',
    'for page = (function() page = 1 return 1 end)(), 2 do end',
    'repeat local page = 1 until true; page = 2'])('still rejects real global writes: %s', customLua => {
    expect(gen({ ...newProject(), customLua }).problems.some(p => p.level === 'error' && p.owner === 'custom code')).toBe(true)
  })
  it('groups shared-node actions with linear copying cost', () => {
    const p = newProject(), n = 4000
    p.actions = Array.from({ length: n }, (_, i) => ({ id: 'a' + i, on: 'shared', do: [] }))
    const iterator = Array.prototype[Symbol.iterator]
    let copied = 0
    Array.prototype[Symbol.iterator] = function(this: unknown[]) {
      if ((this[0] as { on?: string })?.on === 'shared') copied += this.length
      return iterator.call(this)
    }
    try {
      const result = gen(p)
      expect(result.lua.match(/steps = {  }/g)).toHaveLength(n)
      expect(copied).toBeLessThanOrEqual(n * 4)
    } finally { Array.prototype[Symbol.iterator] = iterator }
  })
  it('loads hostile JSON and generates without prototype pollution or non-finite literals', () => {
    const p = newProject()
    p.pages[0].scene = parseSrc('SCENE w=480 h=480\nT text="$__proto__"\nT text="$constructor"\nT text="$huge"\nT text="$lone"\n').scene!
    const hostile = JSON.parse(JSON.stringify(p))
    hostile.bindings = JSON.parse('{"__proto__":{"from":"const","value":"safe"},"constructor":{"from":"const","value":"safe"},"huge":{"from":"const","value":1e300},"lone":{"from":"const","value":"\\ud800"}}')
    hostile.state = [{ name: 'big', type: 'number', init: 1e300 }]
    hostile.simDevices = [{ id: 's', prefab: 'P', ref: 1e300, values: JSON.parse('{"__proto__":{"kind":"const","v":1e300},"constructor":{"kind":"const","v":1e300}}') }]
    const loaded = reducer(initialState(), { type: 'loadProject', project: JSON.parse(JSON.stringify(hostile)) }).project
    const result = gen(loaded)
    expect(result.problems.filter(p => p.level === 'error')).toEqual([])
    expect(result.lua).toContain('o["__proto__"] = "safe"')
    expect(result.lua).toContain('o["constructor"] = "safe"')
    expect(result.lua).not.toMatch(/\b(?:NaN|Infinity)\b/)
    expect(loaded.state[0].init).toBe(1e12)
    expect(loaded.bindings.lone).toEqual({ from: 'const', value: '\ud800' })
    expect(Object.hasOwn(loaded.bindings, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(loaded.bindings)).toBe(Object.prototype)
    expect(Object.prototype).not.toHaveProperty('kind')
    expect(Object.prototype).not.toHaveProperty('from')
  })
  it('refuses a mirror that does not fit chip memory (a string state takes 3 UTF-16 units per address)', () => {
    const p = { ...newProject(), state: Array.from({ length: 90 }, (_, k) => ({ name: `s${k}`, type: 'number' as const, init: 0 })) }
    expect(gen(p).problems).toContainEqual({ level: 'error', message: 'the chip-memory mirror needs 270 addresses; 254 are free (256..509)' })
    // 20 strings of 30 units: 20 × (3 + 10) = 260 addresses (at 6 bytes per address it was 160, and fit).
    const s = { ...newProject(), state: Array.from({ length: 20 }, (_, k) => ({ name: `t${k}`, type: 'string' as const, init: '', mirrorBytes: 30 })) }
    expect(gen(s).problems).toContainEqual({ level: 'error', message: 'the chip-memory mirror needs 260 addresses; 254 are free (256..509)' })
  })
  it('does not hit the JS argument limit on a large accepted custom block', () => {
    const p = { ...newProject(), customLua: '-- line\n'.repeat(150_000) }
    expect(() => gen(p)).not.toThrow()
  })
  it('drops CR expressions through the merged expression guard, keeping line maps accurate', () => {
    const p = withBar()
    p.bindings.bar1_lvl = { from: 'expr', expr: '(1\r+ 2)' }
    p.state = [{ name: 'target', type: 'number', init: 0 }]
    p.actions = [{ id: 'a', on: 'none', when: 'true\r\n', do: [{ op: 'set', state: 'target', value: '1\n\r+ 2' }] }]
    const { lua, map } = gen(p)
    expect(lua.includes('\r')).toBe(false)
    expect(map.at(-1)!.last).toBe(lua.split('\n').length - 1)
    expect(gen(p).problems.filter(x => x.level === 'error').map(x => x.message)).toEqual([
      'action a (when): a carriage return is not allowed in an expression',
      'binding bar1_lvl: a carriage return is not allowed in an expression'])
  })
  it.each([{}, null, 5, { header: {}, defs: [] }, { header: {}, defs: [], root: 'x' },
    { header: null, defs: [], root: [] }, { header: {}, root: [] }, { header: {}, defs: 'x', root: [] },
    { header: {}, defs: [], root: [null] }, { header: {}, defs: [], root: [{ op: 5, attrs: {} }] },
    { header: {}, defs: [], root: [{ op: 'G', attrs: null }] }, { header: {}, defs: [], root: [{ op: 'G', attrs: {}, c: 'x' }] }
  ])('reports unread loaded page scene %j without throwing', scene => {
    const p = newProject()
    p.roles = [{ id: 'sensor', name: 'Sensor', prefabs: [], mode: 'one' }]
    p.pages[0] = { ...p.pages[0], scene: scene as never }
    const loaded = reducer(initialState(), { type: 'loadProject', project: p }).project
    const src = vi.fn(() => 'SCENE w=480 h=480\n')
    let result: ReturnType<typeof generate> | undefined
    expect(() => { result = generate(loaded, src) }).not.toThrow()
    expect(result!.problems).toContainEqual({ level: 'error', owner: 'page p1', message: expect.stringContaining('scene') })
    expect(result!.lua).toBe('')
    expect(src).not.toHaveBeenCalled()
  })
  it.each(['id', 'surface'] as const)('reports a loaded page with a numeric %s without throwing', field => {
    const p = newProject()
    p.pages[0] = { ...p.pages[0], [field]: 5 } as never
    const loaded = reducer(initialState(), { type: 'loadProject', project: p }).project
    let result: ReturnType<typeof generate> | undefined
    expect(() => { result = generate(loaded, () => 'SCENE w=480 h=480\n') }).not.toThrow()
    expect(result!.problems).toContainEqual({ level: 'error', owner: field === 'id' ? 'page 1' : 'page p1', message: expect.stringContaining(field) })
    expect(result!.lua).toBe('')
  })
  it('reports unavailable checked scene text instead of throwing from the source callback', () => {
    let result: ReturnType<typeof generate> | undefined
    expect(() => { result = generate(newProject(), () => { throw new Error('not checked') }) }).not.toThrow()
    expect(result!.problems).toContainEqual({ level: 'error', owner: 'page p1', message: expect.stringContaining('scene text') })
    expect(result!.lua).toBe('')
  })
  it('reports a non-text custom export name from an unsanitized patch', () => {
    const p = withBar()
    p.bindings.bar1_lvl = { from: 'export', name: 5 as never }
    expect(gen(p).problems).toContainEqual({ level: 'error', owner: 'binding bar1_lvl', message: expect.stringContaining('export name') })
  })
  it('never throws on what loadProject accepts', () => {
    const p = { ...newProject(), customLua: ']]', bindings: { '': { from: 'const' as const, value: 'x' } } }
    p.pages[0] = { ...p.pages[0], scene: parseSrc('SCENE w=1 h=1\n').scene! }
    expect(() => gen(p)).not.toThrow()
  })
})

describe('the codegen fixtures (the C# suite runs them: FixtureTests.Codegen)', () => {
  for (const [name, p] of Object.entries(fixtureProjects()))
    it(`writes ${name}`, async () => {
      const lua = gen(p).lua
      await expect(lua).toMatchFileSnapshot(`../../test/fixtures/codegen/${name}.lua`)
      // The snapshot matcher tolerates CRLF; check the committed line-ending bytes too.
      const file = new URL(`../../test/fixtures/codegen/${name}.lua`, import.meta.url)
      // New snapshots are written after the suite; their output is already checked below.
      if (existsSync(file)) expect(readFileSync(file, 'utf8').includes('\r')).toBe(false)
      expect(lua.includes('\r')).toBe(false)
      await expect(JSON.stringify(hostOf(p, cat, null).host, null, 1) + '\n').toMatchFileSnapshot(`../../test/fixtures/codegen/${name}.host.json`)
    })
})

describe('empty page runtime fixtures', () => {
  for (const [name, p] of Object.entries(emptyPageProjects())) it(`writes ${name}`, async () => {
    const g = gen(p)
    expect(g.pages[0].empty).toBe(name === 'blank')
    await expect(g.lua).toMatchFileSnapshot(`../../test/fixtures/empty-pages/${name}.lua`)
  })
})

describe('generated page manifest', () => {
  // Read the emitted cfg string literals, not a second scene producer. long() adds an initial LF which Lua discards.
  const cfgPages = (lua: string) => {
    const { code, strs } = lex(lua)
    return [...code.matchAll(/\{ id = \$(\d+), surface = \$(\d+), bg = \{[^}]*\}, src = \$(\d+),/g)].map(m => {
      const end = code.slice(m.index! + m[0].length).match(/empty = (true|false), w = (\d+), h = (\d+)/)!
      return { id: strs[Number(m[1])], surface: strs[Number(m[2])], src: strs[Number(m[3])].replace(/^\n/, ''),
        empty: end[1] === 'true', w: Number(end[2]), h: Number(end[3]) }
    })
  }
  it.each(Object.entries(fixtureProjects()))('matches every emitted user/Devices cfg page for %s without changing Lua or host bytes', async (name, p) => {
    const g = gen(p)
    expect(g.pages).toEqual(cfgPages(g.lua))
    expect(g.pages?.length).toBe(p.pages.length + (p.roles.some(r => r.pin === undefined && r.ref === undefined) ? 1 : 0))
    expect(g.lua).toBe(readFileSync(new URL(`../../test/fixtures/codegen/${name}.lua`, import.meta.url), 'utf8'))
    expect(JSON.stringify(hostOf(p, cat, null).host, null, 1) + '\n').toBe(readFileSync(new URL(`../../test/fixtures/codegen/${name}.host.json`, import.meta.url), 'utf8'))
  })
  it('omits the vector scene for a blank page with exact clamped pixel dimensions', () => {
    const p = newProject()
    p.pages[0].size = { w: 459.6, h: 9000 }
    const g = gen(p)
    expect(g.pages).toEqual([{ id: 'p1', surface: 'main', src: '', empty: true, w: 460, h: 8192 }])
    expect(g.pages).toEqual(cfgPages(g.lua))
  })
  it('omits the scene only for natives alone without a direct FONT declaration', () => {
    const p = fixtureProjects().natives, g = gen(p)
    expect(g.pages).toEqual([{ id: 'p1', surface: 'main', src: '', empty: true, w: 460, h: 460 }])
    expect(g.pages).toEqual(cfgPages(g.lua))
  })
  it.each(['FONT', 'fOnT'])('keeps natives-only direct %s definitions and their scene in both manifest and cfg', op => {
    const p = fixtureProjects().natives
    p.pages[0].scene.defs = [{ op, attrs: { sRc: 'https://fonts.gstatic.com/direct.ttf' } }]
    const g = gen(p)
    expect(g.pages).toEqual([{ id: 'p1', surface: 'main', src: printSrc(p.pages[0].scene) + bannerSrc(p.pages[0].scene.header), empty: false, w: 460, h: 460 }])
    expect(g.pages).toEqual(cfgPages(g.lua))
    expect(g.pages?.[0].src).toContain('https://fonts.gstatic.com/direct.ttf')
  })
  it('includes the collision-free generated Devices id/surface and the start page dimensions', () => {
    const p = fixtureProjects().multipage
    p.pages[0] = { ...p.pages[0], id: 'vb_devices', size: { w: 1000.4, h: 299.6 } }
    p.pages[1] = { ...p.pages[1], surface: 'vb_devices2' }
    const g = gen(p)
    expect(g.pages).toEqual(cfgPages(g.lua))
    expect(g.pages?.at(-1)).toMatchObject({ id: 'vb_devices3', surface: 'vb_devices3', empty: false, w: 1000, h: 300 })
    expect(g.pages?.at(-1)?.src).toContain('lt(ver,11118)')
  })
  it('returns no pages on the structural failure path', () => {
    const p = newProject()
    p.pages[0].scene = null as never
    const g = generate(p, () => 'SCENE w=480 h=480\n')
    expect(g.lua).toBe('')
    expect(g.problems.some(p => p.level === 'error')).toBe(true)
    expect(g.pages).toEqual([])
  })
  it('returns no pages when checked source text is unavailable', () => {
    const g = generate(newProject(), () => { throw new Error('not checked') })
    expect(g.lua).toBe('')
    expect(g.problems.some(p => p.level === 'error')).toBe(true)
    expect(g.pages).toEqual([])
  })
})
