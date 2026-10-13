// Authoring only, for templates.test.ts: the Power wall (3×2 and 2×3) and Hydro farm (3×2) starters, rebuilt from widgets
// after the owner's two console scripts (docs/templates-power-farm.md). The JSON in templates/ is what ships; this module
// writes it (VB_AUTHOR_TEMPLATES=1) and the tests compare against it. Panels sit where each script's own layout puts them on
// the shape's design size; content keeps the script's paddings (15 in) and row pitches.
import { DEVICES_PAGE, type Logic, type Read, type Role, type Rule, type SimDevice, type SimSource } from '../model/logic'
import type { Box } from '../editor/geometry'
import { worldBox } from '../editing/bounds'
import { canHold } from '../editing/natives'
import { newPage, type Project } from '../model/project'
import type { SrcNode } from '../model/scene'
import { initialState, reducer } from '../model/store'
import { SHAPES } from '../model/shapes'
import { first, textOf } from '../srctext/props'
import { themeOf } from '../theme'
import { linked } from '../theme/links'
import { allocUid, putWidget, sanitize, widgetOf } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { Params, WidgetEdit } from '../widgets/types'
import POWER_LUA from './starters/power-wall.lua?raw'
import FARM_LUA from './starters/hydro-farm.lua?raw'

type Rect = [number, number, number, number]
type Added = { uid: string; slots: Record<string, string> }
const constant = (v: number): SimSource => ({ kind: 'const', v })
const expr = (e: string) => ({ from: 'expr' as const, expr: e })
const exp = (name: string) => ({ from: 'export' as const, name })
const CLOCK = expr('util.clock_time and util.clock_time("HH:MM") or "--:--"')

/** The page at index `k` reshaped to `shape`, its scene's design size the shape's units. */
function shape(p: Project, k: number, key: '3x2' | 'v3x2', name: string) {
  const s = SHAPES[key], pg = p.pages[k]
  p.pages[k] = { ...pg, name, shape: key, size: { ...s.px }, scene: { ...pg.scene, header: { w: s.units.w, h: s.units.h, fit: 'contain' } } }
}

/** Widgets placed on page `k`; each returns its uid and its slots' data names, so bindings name them as they are. */
function placer(p: Project) {
  const t = themeOf(p)
  return (k: number, type: string, over: Params, edit?: WidgetEdit): Added => {
    const pg = p.pages[k], m = WIDGETS[type], uid = allocUid(p, m.prefix)
    const params = sanitize(m, { ...m.defaults(t, { pages: p.pages, page: pg.id, size: { w: pg.scene.header.w as number, h: pg.scene.header.h as number } }), ...over }, t)
    if (m.native) p.pages[k] = { ...pg, natives: [...pg.natives ?? [], { type, uid, params }] }
    else p.pages[k] = { ...pg, scene: putWidget(pg.scene, { type, uid, params, ...(edit && { edit }) }, t) }
    return { uid, slots: Object.fromEntries(m.expand(params, t, uid).slots.map(s => [s.slot, s.key])) }
  }
}

/** Starter-only Layers tree. Move the authored nodes themselves, leaving their markers and drawing untouched. */
function grouped(p: Project, names: Record<string, string>, tails: Record<string, string[]>): Project {
  const t = themeOf(p), reserved = new Set<string>()
  // Both custom Lua blocks only read/write device roles and export data; neither names scene nodes.
  // Their role names (including "larre") therefore do not reserve scene ids.
  const stack = p.pages.flatMap(pg => [...pg.scene.defs, ...pg.scene.root])
  for (const pg of p.pages) for (const n of pg.natives ?? []) reserved.add(n.uid)
  while (stack.length) {
    const n = stack.pop()!
    if (typeof n.attrs.id === 'string') reserved.add(n.attrs.id)
    const w = widgetOf(n, t)
    if (w) reserved.add(w.uid)
    stack.push(...n.c ?? [])
  }
  for (const pg of p.pages) {
    const used = new Set(reserved), original = pg.scene.root
    const refs = new Map(original.map(n => [n, widgetOf(n, t)]))
    const claim = (base: string) => {
      let id = base, suffix = 2
      while (used.has(id)) id = `${base}_${suffix++}`
      used.add(id)
      return id
    }
    const name = (text: string, fallback: string) => {
      // SceneText.ReadToken accepts ASCII letters, digits and underscores without quoting.
      const base = text.replace(/^\$|^\{\$|:.*\}$|\}$/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback
      return claim(base)
    }
    const group = (id: string, c: SrcNode[]): SrcNode => ({ op: 'G', attrs: { id }, c })
    const inside = (a: Params, b: Params) => Number(b.x) >= Number(a.x) - 0.01 && Number(b.y) >= Number(a.y) - 0.01
      && Number(b.x) + Number(b.w) <= Number(a.x) + Number(a.w) + 0.01
      && Number(b.y) + Number(b.h) <= Number(a.y) + Number(a.h) + 0.01
    const consumed = new Set<SrcNode>()
    pg.scene.root = original.flatMap(panel => {
      if (consumed.has(panel)) return []
      const frame = refs.get(panel)
      if (frame?.type !== 'panel') return [panel]
      const children = original.filter(n => n === panel || refs.get(n) && inside(frame.params, refs.get(n)!.params))
      if (children.length < 2) return [panel]
      children.forEach(n => consumed.add(n))
      const tail = (tails[frame.uid] ?? []).map(id => original.find(n => n.attrs.id === id)!)
      tail.forEach(n => consumed.add(n))
      const id = names[frame.uid] ? claim(names[frame.uid]) : name(String(frame.params.title), `panel_${original.filter(n => refs.get(n)?.type === 'panel').indexOf(panel) + 1}`)
      const claimed = new Set<SrcNode>(), contents = children.slice(1)
      const subgroups = new Map<SrcNode, SrcNode>()
      for (const [i, control] of contents.entries()) {
        const w = refs.get(control)!
        if (claimed.has(control) || w.type === 'text') continue
        let members = [control]
        // Cards and compound readings carry independently editable widgets on their faces.
        if (['button', 'kvtable', 'gauge', 'repeater'].includes(w.type))
          members.push(...contents.filter(n => n !== control && !claimed.has(n) && inside(w.params, refs.get(n)!.params)))
        // These labels/notes sit outside the control box and are authored directly beside it.
        const label = w.type === 'options' ? contents[i - 1] : ['stepper', 'light'].includes(w.type) ? contents[i + 1] : undefined
        if (label && refs.get(label)?.type === 'text' && !claimed.has(label)) members.push(label)
        if (members.length < 2) continue
        members = contents.filter(n => members.includes(n))
        const text = members.map(n => refs.get(n)!).find(r => r.type === 'text')
        const title = w.type === 'stepper' ? String(w.params.name) : text ? String(text.params.text) : ''
        const order = original.filter(n => refs.get(n)?.type === w.type).indexOf(control) + 1
        const sub = group(names[w.uid] ? claim(names[w.uid]) : name(title, `${w.type}_${order}`), members)
        subgroups.set(members[0], sub)
        members.forEach(n => claimed.add(n))
      }
      return [group(id, [panel, ...contents.flatMap(n => subgroups.has(n) ? [subgroups.get(n)!] : claimed.has(n) ? [] : [n]), ...tail])]
    })
  }
  return p
}

/** Seat page-level natives in the deepest named ordinary group enclosing their page-space box. */
function seated(p: Project): Project {
  const t = themeOf(p)
  for (const pg of p.pages) {
    if (!pg.natives?.some(n => !n.group)) continue
    const groups: { id: string; depth: number; box: Box }[] = [], path: number[] = []
    const stack = [{ list: pg.scene.root, k: 0 }]
    while (stack.length) {
      const frame = stack[stack.length - 1]
      if (frame.k === frame.list.length) { stack.pop(); path.pop(); continue }
      const n = frame.list[frame.k]
      path.push(frame.k++)
      if (canHold(pg.scene, path, t)) {
        const id = textOf(first(n, 'ID')), box = worldBox(pg.scene, path)
        if (id && box) groups.push({ id, depth: path.length, box })
        if (n.c?.length) { stack.push({ list: n.c, k: 0 }); continue }
      }
      path.pop()
    }
    groups.sort((a, b) => b.depth - a.depth)
    pg.natives = pg.natives.map(n => {
      if (n.group) return n
      const x = Number(n.params.x), y = Number(n.params.y), w = Number(n.params.w), h = Number(n.params.h)
      const holder = groups.find(({ box: b }) => x >= b.x - 0.01 && y >= b.y - 0.01
        && x + w <= b.x + b.w + 0.01 && y + h <= b.y + b.h + 0.01)
      return holder ? { ...n, group: holder.id } : n
    })
  }
  return p
}

const finish = (p: Project, logic: Partial<Logic>, names: Record<string, string> = {}, tails: Record<string, string[]> = {}) =>
  seated(grouped(reducer(initialState(p), { type: 'setLogic', patch: logic }).project, names, tails))

// ── Power wall ──────────────────────────────────────────────────────────────────────────────────────────────────────

const PANEL_PREFABS = ['StructureSolarPanel', 'StructureSolarPanelReinforced', 'StructureSolarPanelDual', 'StructureSolarPanelDualReinforced',
  'StructureSolarPanelFlat', 'StructureSolarPanelFlatReinforced', 'StructureSolarPanel45', 'StructureSolarPanel45Reinforced',
  'StructureSolarPanel1x5Single', 'StructureSolarPanel1x5ReinforcedSingle', 'StructureSolarPanel1x5', 'StructureSolarPanel1x5Reinforced']
// Tracked: standard, dual, 1x5, dual 1x5 and their heavy versions (the script leaves flat and angled panels alone).
const TRACKED_PREFABS = ['StructureSolarPanel', 'StructureSolarPanelDual', 'StructureSolarPanel1x5Single', 'StructureSolarPanel1x5',
  'StructureSolarPanelReinforced', 'StructureSolarPanelDualReinforced', 'StructureSolarPanel1x5ReinforcedSingle', 'StructureSolarPanel1x5Reinforced']

export const POWER_ROLES: Role[] = [
  { id: 'batt', name: 'Batteries', prefabs: ['StructureBattery', 'StructureBatteryLarge'], mode: 'all', optional: true },
  { id: 'gen', name: 'Generators', prefabs: ['StructureSolidFuelGenerator'], mode: 'all', optional: true },
  { id: 'panels', name: 'Solar panels', prefabs: PANEL_PREFABS, mode: 'all', optional: true },
  { id: 'tracked', name: 'Tracked panels', prefabs: TRACKED_PREFABS, mode: 'all', optional: true },
  { id: 'sun', name: 'Daylight sensor', prefabs: ['StructureDaylightSensor'], mode: 'one', optional: true },
  { id: 'vent', name: 'Generators vent', prefabs: ['StructureActiveVent'], label: 'GeneratorsVent', mode: 'all', optional: true },
]
const POWER_READS: Read[] = [
  { id: 'cap', role: 'batt', of: { lt: { name: 'Maximum' } }, agg: 'sum' },
  { id: 'stored', role: 'batt', of: { lt: { name: 'Charge' } }, agg: 'sum' },
  { id: 'frac', role: 'batt', of: { lt: { name: 'Charge' } }, agg: 'sum', derived: 'P.cap and P.cap > 0 and x / P.cap or nil', th: { critBelow: 0.1, warnBelow: 0.5 } },
  { id: 'using', role: 'batt', of: { lt: { name: 'PowerActual' } }, agg: 'list' },
  { id: 'solar', role: 'panels', of: { lt: { name: 'Charge' } }, agg: 'sum' },
  { id: 'coal', role: 'gen', of: { lt: { name: 'PowerGeneration' } }, agg: 'sum' },
  { id: 'genW', role: 'gen', of: { lt: { name: 'PowerGeneration' } }, agg: 'list' },
  { id: 'genCoal', role: 'gen', of: { slot: 0, lst: 'Quantity' }, agg: 'list' },
  { id: 'coalN', role: 'gen', of: { slot: 0, lst: 'Quantity' }, agg: 'sum' },
  { id: 'sunH', role: 'sun', of: { lt: { name: 'Horizontal' } } },
  { id: 'sunV', role: 'sun', of: { lt: { name: 'Vertical' } } },
  { id: 'tod', role: 'sun', of: { lt: { id: 1110 } } },
  { id: 'dayLen', role: 'sun', of: { lt: { id: 1114 } } },
]
const GEN_WANT = 'S.mode == 1 and 1 or S.mode == 2 and 0 or (P.frac and (P.frac < 0.1 and 1 or P.frac > 0.25 and 0 or nil))'
export const POWER_RULES: Rule[] = [
  { id: 'genOn', role: 'gen', lt: { name: 'On' }, value: GEN_WANT },
  { id: 'ventOn', role: 'vent', lt: { name: 'On' }, value: GEN_WANT },
  { id: 'trackV', role: 'tracked', lt: { name: 'Vertical' }, value: 'S.parked and 90 or (P.sunV and P.sunV + 90)' },
  { id: 'trackH', role: 'tracked', lt: { name: 'Horizontal' }, value: 'not S.parked and P.sunH and P.sunH + 90 or nil' },
]
const POWER_SIMS: SimDevice[] = [
  { id: 's1', prefab: 'StructureBattery', label: '', ref: 2, role: 'batt', values: { Charge: constant(1800000), Maximum: constant(3600000), PowerActual: constant(9000) } },
  { id: 's2', prefab: 'StructureBatteryLarge', label: '', ref: 3, role: 'batt', values: { Charge: constant(4500000), Maximum: constant(9000000), PowerActual: constant(9000) } },
  { id: 's3', prefab: 'StructureSolidFuelGenerator', label: '', ref: 4, role: 'gen', values: { PowerGeneration: constant(0), On: constant(0) },
    slots: { 0: { Quantity: constant(40), OccupantHash: constant(1724793494) } } },
  // Logic Extended's types by number (SolarEfficiency #1224, SolarDamageRatio #1221, TimeOfDay #1110, DayLengthSeconds
  // #1114): the catalogue does not list them, and the simulator carries them as the values say.
  { id: 's4', prefab: 'StructureSolarPanel', label: '', ref: 5, role: 'panels', values: { Charge: constant(1150), Vertical: constant(110), Horizontal: constant(120), '#1224': constant(97), '#1221': constant(0) } },
  { id: 's5', prefab: 'StructureSolarPanelDual', label: '', ref: 6, role: 'panels', values: { Charge: constant(1300), Vertical: constant(110), Horizontal: constant(120), '#1224': constant(88), '#1221': constant(0.2) } },
  { id: 's6', prefab: 'StructureDaylightSensor', label: '', ref: 7, role: 'sun', values: { Horizontal: constant(30), Vertical: constant(20), '#1110': constant(0.3), '#1114': constant(1200) } },
  { id: 's7', prefab: 'StructureActiveVent', label: 'GeneratorsVent', ref: 8, role: 'vent', values: { On: constant(0) } },
]

/** The script's make_layout, on the shape's design size: margins 24, gutters 16, the spare length into the columns/rows. */
function powerLayout(wide: boolean, W: number, H: number): Record<string, Rect> {
  if (wide) {
    const cw = (W - 80) / 3, ex = (H - 960) / 3, h1 = 284 + ex, h2 = 288 + ex, h3 = 228 + ex
    const y2 = 104 + h1 + 16, y3 = y2 + h2 + 16, x2 = 24 + cw + 16, x3 = 24 + 2 * (cw + 16)
    return { storage: [24, 104, W - 48, h1], now: [24, y2, cw, h2], solar: [x2, y2, cw, h2], gens: [x3, y2, cw, h2],
      yday: [24, y3, cw, h3], sun: [x2, y3, cw, h3], coal: [x3, y3, cw, h3] }
  }
  const cw = (W - 64) / 2, ex = (H - 1440) / 4, h1 = 404 + ex, ha = 286 + ex, hb = 288 + ex, hc = 286 + ex
  const y2 = 104 + h1 + 16, y3 = y2 + ha + 16, y4 = y3 + hb + 16, x2 = 24 + cw + 16
  return { storage: [24, 104, W - 48, h1], now: [24, y2, cw, ha], yday: [x2, y2, cw, ha], solar: [24, y3, cw, hb], sun: [x2, y3, cw, hb],
    gens: [24, y4, cw, hc], coal: [x2, y4, cw, hc] }
}

export function powerWall(p: Project, wide: boolean): Project {
  shape(p, 0, wide ? '3x2' : 'v3x2', 'Main')
  const W = p.pages[0].scene.header.w as number, H = p.pages[0].scene.header.h as number, L = powerLayout(wide, W, H)
  const add = placer(p), at = (type: string, over: Params) => add(0, type, over)
  const panel = ([x, y, w, h]: Rect, title: string, unit = '') => at('panel', { x, y, w, h, title, unit })
  const caption = (x: number, y: number, w: number, text: string, align = 'left') => at('text', { x, y, w, h: 33.6, style: 'unit', text, align })
  const rows = ([x, y, w, h]: Rect, top: number, captions: string[], stated = -1) => {
    const n = captions.length, rowH = (h - top - 15 - 6 * (n - 1)) / n
    return at('kvtable', { x: x + 15, y: y + top, w: w - 30, rowH, gap: 6, valueW: 180, rows: captions.map((caption, key) => ({ caption, fmt: '', state: key === stated, key })) })
  }
  const b: Record<string, unknown> = {}
  const bind = (key: string, v: unknown) => { b[key] = v }

  const hdr = at('header', { x: 24, y: 24, w: W - 48, h: 64, title: 'POWER', clock: true, counts: true })
  bind(hdr.slots.clock, CLOCK); bind(hdr.slots.warn, exp('nwarn')); bind(hdr.slots.crit, { from: 'const', value: 0 })

  // Storage: the hero, the readings, the cells (3x2: their own column; 2x3: under the hero) and the battery types.
  const [sx, sy, sw, sh] = L.storage, ncol = wide ? 3 : 2, c = (sw - 30 - (ncol - 1) * 46) / ncol, hx = sx + 15
  panel(L.storage, 'STORAGE')
  const hero = at('readout', { x: hx, y: sy + 20, w: c, variant: 'hero', unit: '%', fmt: '%.0f', bar: true, subFmt: '%.1f' })
  bind(hero.slots.v, expr('P.frac and P.frac * 100 or "--"')); bind(hero.slots.lvl, expr('P.frac or 0'))
  bind(hero.slots.st, { from: 'read', read: 'frac', part: 'state' }); bind(hero.slots.status, exp('status')); bind(hero.slots.sub, exp('netText'))
  const rx = hx + c + 46
  const readings = at('kvtable', { x: rx, y: sy + 50.9, w: c, rowH: 50, gap: 6, valueW: 180,
    rows: [{ caption: 'Stored', fmt: '', state: false, key: 0 }, { caption: 'Capacity', fmt: '', state: false, key: 1 },
      { caption: '', fmt: '', state: false, key: 2 }, { caption: 'Batteries', fmt: '%.0f', state: false, key: 3 }] })
  bind(readings.slots.v0, expr('P.frac and string.format("%.1f MJ", P.stored / 1e6) or "--"'))
  bind(readings.slots.v1, expr('P.frac and string.format("%.1f MJ", P.cap / 1e6) or "--"'))
  bind(readings.slots.v2, exp('timeLeft')); bind(readings.slots.v3, expr('R.batt.n'))
  at('text', { x: rx + 14, y: sy + 50.9 + 112, w: c - 28 - 180 - 10, h: 50, style: 'value', text: '$timeCaption' })
  bind('timeCaption', exp('timeCaption'))
  const cx0 = wide ? hx + 2 * (c + 46) : hx, cy0 = wide ? sy + 50.9 : sy + 292
  const cells = at('repeater', { x: cx0, y: cy0, w: c, max: 16, layout: 'grid', cols: 8, pitch: 48, item: 'bar', fmt: '' })
  bind(cells.slots.n, expr('X.cells and #X.cells or 0')); bind(cells.slots.lvl, exp('cells')); bind(cells.slots.st, exp('cellSt'))
  // The count needs little room: a narrow value column leaves the battery type's name whole.
  const types = at('repeater', { x: wide ? cx0 : rx, y: sy + sh - 15 - 50 - 56, w: c, max: 2, layout: 'list', pitch: 56, item: 'row', fmt: '%.0f', valueW: 60 })
  bind(types.slots.n, exp('typeN')); bind(types.slots.name, exp('typeNames')); bind(types.slots.v, exp('typeCounts')); bind(types.slots.st, exp('typeSt'))

  // Now, Yesterday.
  panel(L.now, 'NOW', 'kW')
  // Net carries a state: warn when negative (yesterday's: ok or warn).
  const now = rows(L.now, 51.8, ['Solar', 'Coal', 'Using', 'Net'], 3)
  bind(now.slots.v0, exp('solarKw')); bind(now.slots.v1, exp('coalKw')); bind(now.slots.v2, exp('usingKw')); bind(now.slots.v3, exp('netKw'))
  bind(now.slots.s3, exp('netSt'))
  panel(L.yday, 'YESTERDAY', 'MJ')
  const yRows: [string, string][] = wide ? [['Produced', 'yProduced'], ['Used', 'yUsed'], ['Net', 'yNet']]
    : [['Solar', 'ySolar'], ['Coal', 'yCoal'], ['Used', 'yUsed'], ['Net', 'yNet']]
  const yday = rows(L.yday, 51.8, yRows.map(([caption]) => caption), yRows.length - 1)
  yRows.forEach(([, name], k) => bind(yday.slots['v' + k], exp(name)))
  bind(yday.slots['s' + (yRows.length - 1)], exp('yNetSt'))

  // Solar panels: the column captions, up to three type rows (Eff % in the row's value), Qty and kW columns, the alert, Park.
  const [px, py, pw, ph] = L.solar, R0 = px + pw - 30, ry = py + 53.8
  panel(L.solar, 'SOLAR PANELS')
  caption(R0 - 214, py + 15, 50, 'Qty'); caption(R0 - 154, py + 15, 74, 'kW'); caption(R0 - 70, py + 15, 70, 'Eff %', 'right')
  const solarRows = at('repeater', { x: px + 15, y: ry, w: pw - 30, max: 3, layout: 'list', pitch: 56, item: 'row', fmt: '%.0f' })
  bind(solarRows.slots.n, exp('solarN')); bind(solarRows.slots.name, exp('solarNames')); bind(solarRows.slots.v, exp('solarEff')); bind(solarRows.slots.st, exp('solarSt'))
  for (const [x, w, name] of [[R0 - 214, 50, 'solarQty'], [R0 - 154, 74, 'solarKws']] as const) {
    const col = at('repeater', { x, y: ry + 5, w, max: 3, layout: 'list', pitch: 56, item: 'text', fmt: '' })
    bind(col.slots.n, exp('solarN')); bind(col.slots.t, exp(name))
  }
  const alert = at('alert', { x: px + 15, y: py + 170.4, w: pw - 30, h: 36.4, row: false })
  bind(alert.slots.st, exp('alertSt')); bind(alert.slots.msg, exp('alertMsg'))
  const parkW = pw - 30 - 10 - 160
  const park = at('button', { x: px + 15, y: py + ph - 69, w: parkW, h: 54, states: [{ label: 'PARK PANELS', variant: 'primary', key: 0 }, { label: 'RESUME TRACKING', variant: 'primary', key: 1 }] })
  bind(park.slots.state, expr('S.parked and 1 or 0'))
  const devices = at('button', { x: px + 15 + parkW + 10, y: py + ph - 69, w: pw - 30 - parkW - 10, h: 54, states: [{ label: 'DEVICES', variant: 'secondary', key: 0 }] })

  // Coal generators: captions, up to two rows (coal in the row's value), the kW column, Override.
  const [gx, gy, gw, gh] = L.gens, G0 = gx + gw - 30, by = gy + gh - 15 - 3 - 54, ly = by - 3 - 6 - 28.8
  const pitch = (ly - 6 - (gy + 53.8) - 6) / 2 + 6
  panel(L.gens, 'COAL GENERATORS')
  caption(G0 - 170, gy + 15, 80, 'kW'); caption(G0 - 80, gy + 15, 80, 'Coal', 'right')
  const genRows = at('repeater', { x: gx + 15, y: gy + 53.8, w: gw - 30, max: 2, layout: 'list', pitch, item: 'row', fmt: '%.0f' })
  bind(genRows.slots.n, exp('genN')); bind(genRows.slots.name, exp('genNames')); bind(genRows.slots.v, exp('genCoal')); bind(genRows.slots.st, exp('genSt'))
  const genKw = at('repeater', { x: G0 - 170, y: gy + 53.8 + 5, w: 80, max: 2, layout: 'list', pitch, item: 'text', fmt: '' })
  bind(genKw.slots.n, exp('genN')); bind(genKw.slots.t, exp('genKw'))
  caption(gx + 19, ly - 3, 200, 'Override')
  const override = at('options', { x: gx + 18, y: by, w: gw - 36, h: 54, gap: 10,
    options: [{ label: 'AUTO', value: 0, key: 0 }, { label: 'ON', value: 1, key: 1 }, { label: 'OFF', value: 2, key: 2 }] })
  bind(override.slots.sel, { from: 'state', state: 'mode' })

  // Sun: the dial (the share of the day on a half circle), the angle, the times stacked as caption over value.
  const [ux, uy, uw, uh] = L.sun, bw = wide ? 210 : 230, bh = uh - 50.9 - 15
  panel(L.sun, 'SUN')
  const dial = at('gauge', { x: ux + 15, y: uy + 50.9, w: bw, h: bh, label: 'Sun angle', unit: '', min: 0, max: 1, start: -90, end: 90, ticks: 0, fmt: '', value: false, state: true })
  bind(dial.slots.v, exp('sunf')); bind(dial.slots.st, exp('sunSt'))
  at('text', { x: ux + 15, y: uy + 50.9 + Math.min(bw, bh - 33.6) / 2 + 8, w: bw, h: 47.6, style: 'value-lg', text: '$sunAngle', align: 'center' })
  bind('sunAngle', exp('sunAngle'))
  const boxes: [string, string][] = [['Sunset in', 'sunset'], ['Sunrise in', 'sunrise'], ...(wide ? [] : [['Night lasts', 'night'] as [string, string]])]
  const tx = ux + 15 + bw + 10, tw = uw - 30 - bw - 10, th = (bh - (boxes.length - 1) * 6) / boxes.length
  boxes.forEach(([label, name], k) => {
    const mid = uy + 50.9 + k * (th + 6) + th / 2
    caption(tx, mid - 36, tw, label)
    at('text', { x: tx, y: mid - 8, w: tw, h: 47.6, style: 'value-lg', text: '$' + name })
    bind(name, exp(name))
  })

  // Coal reserve.
  panel(L.coal, 'COAL RESERVE')
  const coalRows: [string, string][] = [['Coal left', 'coalLeft'], ['Coal energy', 'coalEnergy'], ['Coal lasts', 'coalLasts'], ...(wide ? [] : [['Producing', 'producing'] as [string, string]])]
  const coal = rows(L.coal, 50.9, coalRows.map(([caption]) => caption))
  coalRows.forEach(([, name], k) => bind(coal.slots['v' + k], exp(name)))

  return finish(p, {
    roles: POWER_ROLES, reads: POWER_READS, rules: POWER_RULES,
    state: [{ name: 'mode', type: 'number', init: 0, min: 0, max: 2 }, { name: 'parked', type: 'bool', init: false }],
    actions: [
      ...[0, 1, 2].map(i => ({ id: `mode${i}`, on: `${override.uid}_o${i}`, do: [{ op: 'set' as const, state: 'mode', value: String(i) }] })),
      { id: 'park', on: `${park.uid}_hit`, do: [{ op: 'toggle', state: 'parked' }] },
      { id: 'devices', on: `${devices.uid}_hit`, do: [{ op: 'page', page: DEVICES_PAGE }] },
    ],
    bindings: b as Logic['bindings'], customLua: POWER_LUA, simDevices: POWER_SIMS,
  }, { [readings.uid]: 'storage_table', [solarRows.uid]: 'solar_table', [genRows.uid]: 'coal_table' })
}

// ── Hydro farm ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const FARM_ROLES: Role[] = [
  { id: 'larre', name: 'Larre dock', prefabs: ['StructureLarreDockHydroponics'], mode: 'one', optional: true },
  { id: 'bin', name: 'Export bin', prefabs: ['StructureChuteBin'], mode: 'one', optional: true },
  { id: 'lights', name: 'Grow lights', prefabs: ['StructureGrowLight'], mode: 'all', optional: true },
]
const FARM_READS: Read[] = [
  { id: 'lightOn', role: 'lights', of: { lt: { name: 'On' } }, agg: 'list' },
  { id: 'lightPower', role: 'lights', of: { lt: { name: 'RequiredPower' } }, agg: 'list' },
  { id: 'binOcc', role: 'bin', of: { slot: 0, lst: 'Occupied' } },
  { id: 'binOpen', role: 'bin', of: { lt: { name: 'Open' } } },
  { id: 'larreErr', role: 'larre', of: { lt: { name: 'Error' } } },
  { id: 'larrePower', role: 'larre', of: { lt: { name: 'Power' } } },
]
export const FARM_RULES: Rule[] = [
  { id: 'lightsOn', role: 'lights', lt: { name: 'On' }, value: 'S.lmode == 1 and 1 or S.lmode == 2 and 0 or X.lightPhase' },
  { id: 'binDoor', role: 'bin', lt: { name: 'Open' }, value: 'P.binOcc and (P.binOcc ~= 0 and 0 or 1)' },
]
// The script's PLANTS, in its order: name, produce hash (the icon), schedule group.
const PLANTS: [string, number, 'Long' | 'Short' | 'Mush'][] = [
  ['Potato', 1929046963, 'Long'], ['Wheat', -1057658015, 'Long'], ['Rice', 658916791, 'Long'], ['Soybean', 1924673028, 'Long'],
  ['Corn', 258339687, 'Short'], ['Mushroom', 2044798572, 'Mush'], ['Alien mushroom', 176446172, 'Mush'], ['Tomato', -998592080, 'Short'],
  ['Pumpkin', 1277828144, 'Short'], ['Fern', 892110467, 'Short'], ['Darga fern', 266654416, 'Long'], ['Peace lily', 2042955224, 'Long'],
  ['Tropical lily', -800947386, 'Long'], ['Winterspawn A', 851290561, 'Long'], ['Winterspawn B', -1414203269, 'Long'],
  ['Hades flower A', -177792789, 'Long'], ['Hades flower B', 1819167057, 'Long'],
]
// Stepper rows: state, panel, row, name, hint, step, low, high, start (the script's STEPS and defaults).
const STEPS: [string, number, number, string, string, number, number | string, number | string, number][] = [
  ['first', 0, 0, 'First pot', 'Station where the Larre starts', 1, 0, 'S.last', 2],
  ['last', 0, 1, 'Last pot', 'Station where the Larre stops', 1, 'S.first', 999, 91],
  ['dump', 0, 2, 'Dump station', 'Station above the export bin', 1, 0, 999, 1],
  ['lightLong', 1, 0, 'Long day', 'Potato, wheat, rice and 8 more', 15, 0, 2400, 750],
  ['lightShort', 1, 1, 'Short day', 'Corn, tomato, pumpkin, fern', 15, 0, 2400, 675],
  ['lightMush', 1, 2, 'Mushrooms', 'Mushroom, alien mushroom', 15, 0, 2400, 0],
  ['per', 2, 0, 'Perennial ready at', 'Growth stage', 1, 5, 5, 5],
  ['ann', 2, 1, 'Annual ready at', 'Growth stage', 1, 5, 5, 5],
  ['binwarn', 2, 2, 'Bin warning after', 'Minutes occupied', 1, 1, 60, 5],
  ['darkLong', 3, 0, 'Long day', 'Potato, wheat, rice and 8 more', 15, 0, 2400, 450],
  ['darkShort', 3, 1, 'Short day', 'Corn, tomato, pumpkin, fern', 15, 0, 2400, 525],
  ['darkMush', 3, 2, 'Mushrooms', 'Mushroom, alien mushroom', 15, 0, 2400, 1200],
]
const FARM_SIMS: SimDevice[] = [
  { id: 's1', prefab: 'StructureLarreDockHydroponics', label: '', ref: 2, role: 'larre',
    values: { Setting: constant(0), Activate: constant(0), Idle: constant(1), Error: constant(0), Power: constant(1), PositionX: constant(0), TargetPrefabHash: constant(0) } },
  { id: 's2', prefab: 'StructureChuteBin', label: '', ref: 3, role: 'bin', values: { Open: constant(1) }, slots: { 0: { Occupied: constant(0) } } },
  { id: 's3', prefab: 'StructureGrowLight', label: '', ref: 4, role: 'lights', values: { On: constant(1), RequiredPower: constant(400) } },
  { id: 's4', prefab: 'StructureGrowLight', label: '', ref: 5, role: 'lights', values: { On: constant(1), RequiredPower: constant(400) } },
]

export function hydroFarm(p: Project): Project {
  shape(p, 0, '3x2', 'Main')
  p.pages.push(newPage(p)); shape(p, 1, '3x2', 'Plant picker')
  p.pages.push(newPage(p)); shape(p, 2, '3x2', 'Settings')
  const [MAIN, PICKER, SETTINGS] = p.pages.map(pg => pg.id)
  const W = 1490, add = placer(p), b: Record<string, unknown> = {}, layerNames: Record<string, string> = {}
  const bind = (key: string, v: unknown) => { b[key] = v }
  const actions: Logic['actions'] = []
  const act = (on: string, steps: Logic['actions'][number]['do'], page?: string) => actions.push({ id: `a${actions.length + 1}`, on, ...(page && { page }), do: steps })
  const toPage = (page: string) => [{ op: 'page' as const, page }]
  const header = (k: number, title: string) => {
    const h = add(k, 'header', { x: 24, y: 24, w: W - 48, h: 64, title, clock: true, counts: true })
    bind(h.slots.clock, CLOCK); bind(h.slots.warn, exp('nwarn')); bind(h.slots.crit, exp('ncrit'))
  }
  const panel = (k: number, [x, y, w, h]: Rect, title: string, unit = '') => add(k, 'panel', { x, y, w, h, title, unit })
  const text = (k: number, x: number, y: number, w: number, style: string, t: string, align = 'left', h = 0) => add(k, 'text', { x, y, w, h, style, text: t, align })
  const button = (k: number, x: number, y: number, w: number, h: number, labels: string[], variant = 'secondary') =>
    add(k, 'button', { x, y, w, h, states: labels.map((label, key) => ({ label, variant, key })) })
  const cw = (W - 80) / 3, x2 = 24 + cw + 16, x3 = 24 + 2 * (cw + 16)

  // ── Main
  header(0, 'HYDRO FARM')
  // Light cycle: the hero (time left, the phase bar, Day or Night, "left of"), the schedule and lamps, Lights, Skip, Settings.
  const [lx, lyy, lw] = [24, 104, cw]
  panel(0, [lx, lyy, lw, 608], 'LIGHT CYCLE')
  const hero = add(0, 'readout', { x: lx + 15, y: lyy + 34.2, w: lw - 30, variant: 'hero', unit: '', fmt: '%.0f', bar: true, subFmt: '%.1f' })
  bind(hero.slots.v, exp('hero')); bind(hero.slots.lvl, exp('phaseBar')); bind(hero.slots.st, exp('phaseSt'))
  bind(hero.slots.status, exp('phase')); bind(hero.slots.sub, exp('phaseLen'))
  const sched = add(0, 'kvtable', { x: lx + 15, y: lyy + 312.9, w: lw - 30, rowH: 50, gap: 6, valueW: 220,
    rows: [{ caption: 'Light / dark', fmt: '', state: false, key: 0 }, { caption: 'Grow lights on', fmt: '', state: false, key: 1 }] })
  bind(sched.slots.v0, exp('split')); bind(sched.slots.v1, exp('lightsOn'))
  text(0, lx + 19, lyy + 433, 200, 'unit', 'Lights')
  const lights = add(0, 'options', { x: lx + 18, y: lyy + 476, w: lw - 36, h: 54, gap: 10,
    options: [{ label: 'AUTO', value: 0, key: 0 }, { label: 'ON', value: 1, key: 1 }, { label: 'OFF', value: 2, key: 2 }] })
  bind(lights.slots.sel, { from: 'state', state: 'lmode' })
  for (const i of [0, 1, 2]) act(`${lights.uid}_o${i}`, [{ op: 'set', state: 'lmode', value: String(i) }])
  // Widths follow the labels (the script splits the row evenly for its narrow face; the theme's face may be wider).
  const hw = lw - 30 - 10 - 180
  const skip = button(0, lx + 15, lyy + 539, hw, 54, ['SKIP TO NIGHT', 'SKIP TO DAY'])
  bind(skip.slots.state, exp('skip')); act(`${skip.uid}_hit`, [{ op: 'command', flag: 'skip' }])
  const settings = button(0, lx + 15 + hw + 10, lyy + 539, 180, 54, ['SETTINGS'])
  act(`${settings.uid}_hit`, toPage(SETTINGS))

  // Plant: the tile (opens the picker) with the produce's icon, name and type; CHANGE; this pass and next pass.
  const [qx, qy, qw] = [x2, 104, cw]
  panel(0, [qx, qy, qw, 288], 'PLANT')
  const tile = button(0, qx + 15, qy + 50.9, qw - 30, 110.1, [''])
  act(`${tile.uid}_hit`, toPage(PICKER))
  const icon = add(0, 'icon', { x: qx + 30, y: qy + 72.9, w: 66, h: 66, kind: 'prefab', name: String(PLANTS[0][1]) })
  bind(`@${icon.uid}.name`, exp('plantIcon'))
  const nameX = qx + 110, nameW = qx + qw - 30 - 140 - 14 - nameX
  text(0, nameX, qy + 66, nameW, 'value-lg', '$plantName', 'left', 47.6); bind('plantName', exp('plantName'))
  text(0, nameX, qy + 112, nameW, 'reading', '$plantType'); bind('plantType', exp('plantType'))
  const change = button(0, qx + qw - 30 - 140, qy + 78.9, 140, 54, ['CHANGE'])
  act(`${change.uid}_hit`, toPage(PICKER))
  const thisPass = add(0, 'readoutrow', { x: qx + 15, y: qy + 167, w: qw - 30, h: 50, name: 'This pass', fmt1: '%.1f', w1: 200 })
  bind(thisPass.slots.st, { from: 'const', value: 1 }); bind(thisPass.slots.r1, exp('thisPass'))
  const nextPass = add(0, 'readoutrow', { x: qx + 15, y: qy + 223, w: qw - 30, h: 50, name: 'Next pass', fmt1: '%.1f', w1: 200 })
  bind(nextPass.slots.st, { from: 'const', value: 0 }); bind(nextPass.slots.r1, exp('nextPass'))

  // Export bin: contents and door rows with lights, how long it has been occupied (warn over the limit), the alert.
  const [bx, byy, bw] = [x3, 104, cw], binRowH = (288 - 50.9 - 15 - 43.9 - 6 - 12) / 3
  panel(0, [bx, byy, bw, 288], 'EXPORT BIN')
  const contents = add(0, 'readoutrow', { x: bx + 15, y: byy + 50.9, w: bw - 30, h: binRowH, name: 'Contents', fmt1: '%.1f', w1: 200 })
  bind(contents.slots.st, exp('binSt')); bind(contents.slots.r1, exp('binContents'))
  const door = add(0, 'readoutrow', { x: bx + 15, y: byy + 50.9 + binRowH + 6, w: bw - 30, h: binRowH, name: 'Door', fmt1: '%.1f', w1: 200 })
  bind(door.slots.st, { from: 'const', value: 0 }); bind(door.slots.r1, exp('door'))
  const occ = add(0, 'kvtable', { x: bx + 15, y: byy + 50.9 + 2 * (binRowH + 6), w: bw - 30, rowH: binRowH, gap: 6, valueW: 200,
    rows: [{ caption: 'Occupied for', fmt: '', state: true, key: 0 }] })
  bind(occ.slots.v0, exp('occupiedFor')); bind(occ.slots.s0, exp('occupiedSt'))
  const binAlert = add(0, 'alert', { x: bx + 15, y: byy + 50.9 + 3 * binRowH + 18 + 4.5, w: bw - 30, h: 36.4, row: false })
  bind(binAlert.slots.st, exp('binAlert')); bind(binAlert.slots.msg, exp('binMsg'))

  // Larre: status (its value inked by the state), pot, holding with the item's icon; PAUSE, SEND HOME, DUMP NOW.
  const [rx, ry, rw] = [x2, 408, cw], larreRowH = (304 - 50.9 - 15 - 54 - 6 - 12) / 3
  const larrePanel = panel(0, [rx, ry, rw, 304], 'LARRE')
  const status = add(0, 'readoutrow', { x: rx + 15, y: ry + 50.9, w: rw - 30, h: larreRowH, name: 'Status', fmt1: '%.1f', w1: 220 })
  bind(status.slots.st, exp('larreSt')); bind(status.slots.r1, exp('larre'))
  const larreRows = add(0, 'kvtable', { x: rx + 15, y: ry + 50.9 + larreRowH + 6, w: rw - 30, rowH: larreRowH, gap: 6, valueW: 220,
    rows: [{ caption: 'Pot', fmt: '', state: false, key: 0 }, { caption: 'Holding', fmt: '', state: false, key: 1 }] })
  bind(larreRows.slots.v0, exp('pot')); bind(larreRows.slots.v1, exp('holding'))
  const held = add(0, 'icon', { x: rx + rw - 30 - 220 - 46, y: ry + 50.9 + 2 * (larreRowH + 6) + (larreRowH - 36) / 2, w: 36, h: 36, kind: 'prefab', name: '' })
  bind(`@${held.uid}.name`, exp('heldIcon'))
  // Shared as flex does in the script: by label length.
  const [w1, w2] = [(rw - 50) * 0.28, (rw - 50) * 0.37], w3 = rw - 50 - w1 - w2
  const pause = button(0, rx + 15, ry + 235, w1, 54, ['PAUSE', 'RESUME'], 'primary')
  bind(pause.slots.state, expr('S.paused and 1 or 0')); act(`${pause.uid}_hit`, [{ op: 'toggle', state: 'paused' }])
  const home = button(0, rx + 15 + w1 + 10, ry + 235, w2, 54, ['SEND HOME'])
  act(`${home.uid}_hit`, [{ op: 'command', flag: 'home' }])
  const dump = button(0, rx + 15 + w1 + w2 + 20, ry + 235, w3, 54, ['DUMP NOW'])
  act(`${dump.uid}_hit`, [{ op: 'command', flag: 'dump' }])

  // Harvest.
  const [hx, hy, hwid] = [x3, 408, cw]
  panel(0, [hx, hy, hwid, 304], 'HARVEST')
  const harvest = add(0, 'kvtable', { x: hx + 15, y: hy + 50.9, w: hwid - 30, rowH: (304 - 50.9 - 15 - 18) / 4, gap: 6, valueW: 200,
    rows: ['This pass', 'All time', 'Last pass took', 'Last harvest'].map((caption, key) => ({ caption, fmt: '', state: false, key })) })
  ;['hPass', 'hAll', 'hLast', 'hAgo'].forEach((name, k) => bind(harvest.slots['v' + k], exp(name)))

  // Pots: the legend in the heading, 90 cells (30 to a row), the Larre's pot outlined.
  const [ox, oy, ow, oh] = [24, 728, W - 48, 208]
  const potsPanel = panel(0, [ox, oy, ow, oh], 'POTS')
  const t = themeOf(p), legend: [number, string, number][] = [[1, 'Healthy', 90], [2, 'Growing slowly', 170], [3, 'Damaged', 110], [0, 'Not visited this pass', 230], [-1, 'Larre', 70]]
  let lgx = ox + ow - 19 - legend.reduce((n, [, , w]) => n + 28 + w + 28, -28)
  const marks: SrcNode[] = []
  for (const [st, label, w] of legend) {
    // The not-visited swatch at 35 %, as the pots it names.
    if (st >= 0) bind(add(0, 'light', { x: lgx, y: oy + 22, w: 18, h: 18 }, label === 'Not visited this pass' ? { v: 1, parts: {}, root: { o: 0.35 } } : undefined).slots.st, { from: 'const', value: st })
    // The Larre's swatch: the same outline as on its pot.
    else marks.push(linked({ op: 'R', attrs: { id: 'larre_legend', x: lgx + 3, y: oy + 25, w: 12, h: 12, rx: 2, f: 'none', sw: 3 } }, 's', { role: 'text' }, t))
    text(0, lgx + 28, oy + 13, w, 'unit', label)
    lgx += 28 + w + 28
  }
  const x0 = ox + 15, y0 = oy + 51.4, cols = 30, rstep = 40 + (oh - 51.4 - 15 - 120) / 2
  const pots = add(0, 'repeater', { x: x0, y: y0, w: ow - 30, max: 90, layout: 'grid', cols, pitch: rstep, item: 'bar', fmt: '', fade: true })
  bind(pots.slots.n, exp('potN')); bind(pots.slots.lvl, exp('potG')); bind(pots.slots.st, exp('potSt')); bind(pots.slots.fade, exp('potFade'))
  // The Larre's pot: a plain outline around its cell, linked to the theme's text colour (the script's white outline).
  const dx = (ow - 30 + t.geo.space[3]) / cols, cellW = dx - t.geo.space[3]
  const ring: SrcNode = linked({ op: 'R', attrs: { id: 'larre_cursor', v: '=gte($potCur,0)', x: `=${x0 - 1.5}+mod($potCur,${cols})*${dx}`, y: `=${y0 - 1.5}+floor($potCur/${cols})*${rstep}`,
    w: cellW + 3, h: 33, rx: 5.5, f: 'none', sw: 3 } }, 's', { role: 'text' }, t)
  p.pages[0] = { ...p.pages[0], scene: { ...p.pages[0].scene, root: [...p.pages[0].scene.root, ...marks, ring] } }
  bind('potCur', exp('potCur'))

  // ── Plant picker: 17 tiles in the script's order (the current one ringed), BACK in the 18th place.
  header(1, 'HYDRO FARM')
  const pk: Rect = [24, 104, W - 48, 832]
  panel(1, pk, 'SELECT PLANT', 'Light / dark, s')
  const tw = (pk[2] - 30 - 50) / 6, th = (pk[3] - 51.8 - 15 - 20) / 3
  const tileAt = (k: number): Rect => [pk[0] + 15 + (k % 6) * (tw + 10), pk[1] + 51.8 + Math.floor(k / 6) * (th + 10), tw, th]
  PLANTS.forEach(([name, hash, group], k) => {
    const [x, y, w, h] = tileAt(k), bottom = y + h - 13
    const tileBtn = add(1, 'button', { x, y, w, h, canSelect: true, states: [{ label: '', variant: 'secondary', key: 0 }] })
    bind(tileBtn.slots.sel, expr(`S.plant == ${k + 1} and 1 or 0`))
    act(`${tileBtn.uid}_hit`, [{ op: 'set', state: 'plant', value: String(k + 1) }, ...toPage(MAIN)], PICKER)
    add(1, 'icon', { x: x + (w - 96) / 2, y: y + 13, w: 96, h: 96, kind: 'prefab', name: String(hash) })
    text(1, x + 15, bottom - 61 - 39.2, w - 30, 'value', name, 'center')
    text(1, x + 15, bottom - 61, w - 30, 'unit', k >= 7 ? 'Perennial' : 'Annual', 'center')
    text(1, x + 15, bottom - 33.6, w - 30, 'reading', '$split' + group, 'center')
  })
  for (const g of ['Long', 'Short', 'Mush']) bind('split' + g, expr(`S.light${g} > 0 and string.format("%.0f / %.0f", S.light${g}, S.dark${g}) or "Dark"`))
  const [bkx, bky, bkw, bkh] = tileAt(17)
  const back = button(1, bkx, bky, bkw, bkh, ['BACK'])
  act(`${back.uid}_hit`, toPage(MAIN), PICKER)

  // ── Settings: four panels of three steppers, each with its hint under it; BACK and DEVICES.
  header(2, 'HYDRO FARM SETTINGS')
  const sw = (W - 64) / 2, sx2 = 24 + sw + 16
  const sp: [Rect, string, string][] = [[[24, 104, sw, 358], 'POTS', ''], [[sx2, 104, sw, 358], 'LIGHT PHASE', 's'],
    [[24, 478, sw, 358], 'HARVEST', ''], [[sx2, 478, sw, 358], 'DARK PHASE', 's']]
  const stepLayers: Record<string, string> = {
    lightLong: 'light_long_day', lightShort: 'light_short_day', lightMush: 'light_mushrooms',
    darkLong: 'dark_long_day', darkShort: 'dark_short_day', darkMush: 'dark_mushrooms',
  }
  for (const [r, title, unit] of sp) panel(2, r, title, unit)
  for (const [state, k, row, name, hint, by, min, max] of STEPS) {
    const [x, y, w, h] = sp[k][0], top = sp[k][2] ? 51.8 : 50.9, rh = (h - top - 15 - 12) / 3, ry0 = y + top + row * (rh + 6)
    const stepper = add(2, 'stepper', { x: x + 15, y: ry0 + 4, w: w - 30, h: 54, name, fmt: '%.0f', by, min: typeof min === 'number' ? min : 0, max: typeof max === 'number' ? max : 999 })
    if (stepLayers[state]) layerNames[stepper.uid] = stepLayers[state]
    bind(stepper.slots.v, { from: 'state', state })
    text(2, x + 15, ry0 + 4 + 54 + 2, w - 30 - 2 * 54 - 2 * 10 - 110, 'unit', hint)
    act(`${stepper.uid}_dec`, [{ op: 'step', state, by: -by, min, max }], SETTINGS)
    act(`${stepper.uid}_inc`, [{ op: 'step', state, by, min, max }], SETTINGS)
  }
  const bbW = Math.round((W - 78 - 10) * 3 / 4)
  const bottomBar = panel(2, [24, 852, W - 48, 84], '')
  const sBack = button(2, 39, 867, bbW, 54, ['BACK'])
  act(`${sBack.uid}_hit`, toPage(MAIN), SETTINGS)
  const devices = button(2, 39 + bbW + 10, 867, W - 78 - bbW - 10, 54, ['DEVICES'])
  act(`${devices.uid}_hit`, [{ op: 'page', page: DEVICES_PAGE }], SETTINGS)

  return finish(p, {
    roles: FARM_ROLES, reads: FARM_READS, rules: FARM_RULES,
    state: [
      { name: 'plant', type: 'number', init: 1, min: 1, max: 17 }, { name: 'lmode', type: 'number', init: 0, min: 0, max: 2 },
      { name: 'paused', type: 'bool', init: false },
      ...STEPS.map(([name, , , , , , , , init]) => ({ name, type: 'number' as const, init })),
    ],
    actions, bindings: b as Logic['bindings'], customLua: FARM_LUA, simDevices: FARM_SIMS,
  }, { ...layerNames, [tile.uid]: 'current_plant', [larrePanel.uid]: 'larre', [bottomBar.uid]: 'bottom_bar' },
  { [potsPanel.uid]: ['larre_legend', 'larre_cursor'] })
}
