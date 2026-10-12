// The live data of a project (spec 6.1-6.2, M3): roles, reads, state, click actions, latched rules, bindings, the custom-Lua
// block, simulated devices and the chip settings. Every field has a default, so a project made before M3 loads as it is
// (version stays 1). A shared project is untrusted: logicFrom reads each field from anything and never throws, and cascade
// drops every reference that does not resolve, so codegen never meets one.
export type LuaName = string
export type Pin = 0 | 1 | 2 | 3 | 4 | 5
/** A LogicType by its enum name, or a numeric extension id (a mod's type, spec 6.1). */
export type LogicRef = { name: string } | { id: number }
export interface Role {
  id: LuaName; name: string
  prefabs: string[]              // prefab names (hashed at codegen); [] = any prefab
  label?: string                 // the default Labeller name
  mode: 'one' | 'all'
  pin?: Pin; ref?: number        // advanced: the device on housing pin d0-d5, or a fixed ReferenceId; overrides the scan
  optional?: true                // the console runs without it: never opens the Devices page first (ruling P24)
  /** Never the same device as another distinct role (the two doors of one airlock): a sole-candidate fallback does not take a
   *  device another distinct role holds, a device two of them reach the same way goes to neither, and a Devices-page tap skips
   *  a device another distinct role holds. Roles without it resolve as before. */
  distinct?: true
}
export type Agg = 'sum' | 'avg' | 'min' | 'max' | 'list'
export const AGGS: readonly Agg[] = ['sum', 'avg', 'min', 'max', 'list']
export type Unit = 'K>C' | 'K>F' | 'kPa>MPa' | 'kPa>atm' | 'W>kW' | 'W>MW' | 'J>kJ' | 'J>MJ' | 'ratio>%'
export const UNITS: readonly Unit[] = ['K>C', 'K>F', 'kPa>MPa', 'kPa>atm', 'W>kW', 'W>MW', 'J>kJ', 'J>MJ', 'ratio>%']
/** State 3 at or beyond a crit edge, 2 at or beyond a warn edge, else 1; a missing value is 0. hyst: how far back over an
 *  edge a value must come to leave a worse state. log: "<log> <ok|warn|crit>" on each change. */
export interface Thresholds { critBelow?: number; warnBelow?: number; warnAbove?: number; critAbove?: number; hyst?: number; log?: string }
export interface Read {
  id: LuaName; role: LuaName
  of: { lt: LogicRef } | { slot: number; lst: string }
  agg?: Agg                      // over an 'all' role's devices; default avg; ignored for 'one'
  valid?: [number, number]       // a raw value outside reads nil, before unit and clamp (ruling P25)
  unit?: Unit; scale?: number; offset?: number; clamp?: [number, number]
  smooth?: number                // seconds, exponential time constant
  derived?: string               // a Lua expression over x (and P S C X T)
  th?: Thresholds
  history?: { n: number; every?: number }   // the last n values, one per `every` ticks, bindable as part 'history' (ruling P5)
}
export type StateType = 'number' | 'bool' | 'enum' | 'string'
export interface StateVar {
  name: LuaName; type: StateType; init: number | boolean | string
  min?: number; max?: number     // number
  options?: string[]             // enum: the value is the index 0..n-1
  save?: boolean                 // default true: persisted and mirrored when an action changes it
  mirrorBytes?: number           // string: UTF-16 units kept in chip memory (Lua-CSharp strings are UTF-16), default 30
}
export type Bound = number | string   // a literal, or a Lua expression
export type Step =
  | { op: 'page'; page: string }                                   // a page id or DEVICES_PAGE
  | { op: 'set'; state: LuaName; value: string }
  | { op: 'toggle'; state: LuaName } | { op: 'cycle'; state: LuaName }
  | { op: 'step'; state: LuaName; by: number; min: Bound; max: Bound }
  | { op: 'command'; flag: LuaName }                               // C.<flag> = true for this tick
  | { op: 'log'; text: string; level?: 0 | 1 | 2 | 3 }             // text: a Lua expression
  | { op: 'call'; fn: LuaName }                                    // U.<fn>(E), from the custom block
/** A click action (ruling P4: the store's reducer union is `Action`). `on`: a clickable node id (a repeat's without :i) or a
 *  native's uid (its on_change). `page`: only that page's node (raw ids are unique per scene only; ruling P18). */
export interface ClickAction { id: string; on: string; page?: string; when?: string; do: Step[] }
/** pulse: the rule writes on its value's edge, not on a read-back difference: set from the catalogue for a write-only type,
 *  or by the player on any type that must be re-sent on a command (ruling P6). */
export interface Rule { id: string; role: LuaName; lt: LogicRef; value: string; skipBoot?: boolean; pulse?: true }
export type Source =
  | { from: 'read'; read: LuaName; part?: 'value' | 'state' | 'history' }
  | { from: 'state'; state: LuaName }
  | { from: 'expr'; expr: string }
  | { from: 'export'; name: LuaName }
  | { from: 'const'; value: number | string | number[] | string[] }
  | { from: 'log'; part: 'k' | 'm' | 't' }
/** Keyed by data name, project-wide, or by `@<native uid>.<prop>`. ease: a raw name rides the eased element. */
export type Binding = Source & { ease?: true }
export type SimSource =
  | { kind: 'const'; v: number }
  | { kind: 'slider'; v: number; min: number; max: number }
  | { kind: 'sine'; mid: number; amp: number; period: number }
  | { kind: 'ramp'; from: number; to: number; period: number; loop: boolean }
  | { kind: 'walk'; v: number; step: number; min: number; max: number; seed: number }
  | { kind: 'keys'; keys: [number, number][]; loop: boolean }   // [seconds, value], piecewise linear
/** ref: unique among simulated devices, 2 or more (the housing is 1). role: the role it was made for (removed with it). */
export interface SimDevice { id: string; prefab: string; label: string; ref: number; pin?: Pin; role?: LuaName
  values: Record<string, SimSource>                          // LogicType name, or '#<id>' for an extension id
  slots?: Record<string, Record<string, SimSource>> }        // slot index → LogicSlotType name → source
export interface Settings { budgets: { load: number; tick: number }; beta: boolean; day: { length: number; start: number }; wipeOnReexport: boolean }
export type Logic = { roles: Role[]; reads: Read[]; state: StateVar[]; actions: ClickAction[]; rules: Rule[]
  bindings: Record<string, Binding>; customLua: string; simDevices: SimDevice[]; settings: Settings }
export type LogicKey = keyof Logic

export const DEVICES_PAGE = 'vb_devices'
export const DEFAULT_SETTINGS: Settings = { budgets: { load: 500_000, tick: 50_000 }, beta: false, day: { length: 1200, start: 0.25 }, wipeOnReexport: false }
export const LUA_KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil',
  'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'])
/** The runtime library's globals (runtime.lua): custom code must not assign them whole. */
export const RESERVED = new Set(['VB', 'P', 'T', 'H', 'S', 'C', 'X', 'L', 'R', 'E', 'U', 'rd', 'rds', 'wr', 'wrf', 'log', 'persist', 'page', 'alarms', 'tick'])
export const isLuaName = (v: unknown): v is LuaName => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) && !LUA_KEYWORDS.has(v)

export const newLogic = (): Logic => ({ roles: [], reads: [], state: [], actions: [], rules: [], bindings: {}, customLua: '', simDevices: [],
  settings: { ...DEFAULT_SETTINGS, budgets: { ...DEFAULT_SETTINGS.budgets }, day: { ...DEFAULT_SETTINGS.day } } })
export const logicOf = (p: Logic): Logic => ({ roles: p.roles, reads: p.reads, state: p.state, actions: p.actions, rules: p.rules, bindings: p.bindings,
  customLua: p.customLua, simDevices: p.simDevices, settings: p.settings })

// Readers: each takes anything and gives a value of its type, or undefined (dropped). Optional fields are left out, never
// present as undefined, so a project round-trips through JSON unchanged.
const obj = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const LIMIT = 1e12
// A ReferenceId as the core reads it (C# long) and Lua holds it (a double): any safe integer. A walk's seed is a C# int.
const REF_MAX = Number.MAX_SAFE_INTEGER, SEED_MAX = 2 ** 31 - 1
const num = (v: unknown, d: number) => fin(v) ? Math.min(LIMIT, Math.max(-LIMIT, v)) : d
const opt = (v: unknown) => fin(v) ? Math.min(LIMIT, Math.max(-LIMIT, v)) : undefined
const text = (v: unknown) => typeof v === 'string' && v !== '' ? v : undefined
const int = (v: unknown): v is number => Number.isInteger(v)
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
const pinOf = (v: unknown): Pin | undefined => int(v) && v >= 0 && v <= 5 ? v as Pin : undefined
const lrefOf = (v: unknown): LogicRef | undefined => { const o = obj(v); return text(o.name) ? { name: o.name as string } : int(o.id) ? { id: o.id } : undefined }
const pair = (a: number, b: number): [number, number] => a <= b ? [a, b] : [b, a]
const boundOf = (v: unknown): Bound | undefined => fin(v) ? v : typeof v === 'string' ? v : undefined

function roleOf(v: unknown): Role | undefined {
  const o = obj(v)
  if (!isLuaName(o.id)) return undefined
  return clean({ id: o.id, name: text(o.name) ?? o.id, prefabs: [...new Set(arr(o.prefabs).filter((x): x is string => typeof x === 'string' && x !== ''))],
    label: text(o.label), mode: o.mode === 'all' ? 'all' as const : 'one' as const, pin: pinOf(o.pin),
    ref: int(o.ref) && o.ref >= 1 && o.ref <= REF_MAX ? o.ref : undefined, optional: o.optional === true ? true as const : undefined,
    distinct: o.distinct === true ? true as const : undefined })
}
function thOf(v: unknown): Thresholds | undefined {
  const o = obj(v), th = clean({ critBelow: opt(o.critBelow), warnBelow: opt(o.warnBelow), warnAbove: opt(o.warnAbove), critAbove: opt(o.critAbove),
    hyst: fin(o.hyst) && o.hyst > 0 ? opt(o.hyst) : undefined, log: text(o.log) })
  return Object.keys(th).length ? th : undefined
}
function readOf(v: unknown): Read | undefined {
  const o = obj(v), of = obj(o.of), lt = lrefOf(of.lt)
  if (!isLuaName(o.id) || !isLuaName(o.role)) return undefined
  const target = lt ? { lt } : int(of.slot) && of.slot >= 0 && text(of.lst) ? { slot: of.slot, lst: of.lst as string } : undefined
  if (!target) return undefined
  const c = arr(o.clamp), h = obj(o.history), va = arr(o.valid)
  return clean({ id: o.id, role: o.role, of: target, agg: AGGS.includes(o.agg as Agg) ? o.agg as Agg : undefined, unit: UNITS.includes(o.unit as Unit) ? o.unit as Unit : undefined,
    valid: va.length === 2 && fin(va[0]) && fin(va[1]) ? pair(num(va[0], 0), num(va[1], 0)) : undefined,
    scale: opt(o.scale), offset: opt(o.offset), clamp: c.length === 2 && fin(c[0]) && fin(c[1]) ? pair(num(c[0], 0), num(c[1], 0)) : undefined,
    smooth: fin(o.smooth) && o.smooth > 0 ? opt(o.smooth) : undefined, derived: text(o.derived), th: thOf(o.th),
    history: int(h.n) && h.n >= 1 ? clean({ n: h.n, every: int(h.every) && h.every >= 1 ? h.every : undefined }) : undefined })
}
function stateOf(v: unknown): StateVar | undefined {
  const o = obj(v), type = o.type as StateType
  if (!isLuaName(o.name) || !['number', 'bool', 'enum', 'string'].includes(type)) return undefined
  const options = type === 'enum' ? arr(o.options).filter((x): x is string => typeof x === 'string') : undefined
  if (options && !options.length) return undefined
  const [min, max] = type === 'number' && fin(o.min) && fin(o.max) ? pair(num(o.min, 0), num(o.max, 0)) : [opt(o.min), opt(o.max)]
  const init = type === 'bool' ? o.init === true : type === 'string' ? (typeof o.init === 'string' ? o.init : '')
    : type === 'enum' ? Math.min(options!.length - 1, Math.max(0, Math.floor(num(o.init, 0)))) : num(o.init, 0)
  return clean({ name: o.name, type, init, ...(type === 'number' && { min, max }), options,
    save: o.save === false ? false : undefined, mirrorBytes: type === 'string' && int(o.mirrorBytes) && o.mirrorBytes >= 0 ? o.mirrorBytes : undefined })
}
function stepOf(v: unknown): Step | undefined {
  const o = obj(v)
  switch (o.op) {
    case 'page': return text(o.page) ? { op: 'page', page: o.page as string } : undefined
    case 'set': return isLuaName(o.state) && typeof o.value === 'string' ? { op: 'set', state: o.state, value: o.value } : undefined
    case 'toggle': case 'cycle': return isLuaName(o.state) ? { op: o.op, state: o.state } : undefined
    case 'step': {
      const min = boundOf(o.min), max = boundOf(o.max)
      return isLuaName(o.state) && fin(o.by) && min !== undefined && max !== undefined ? { op: 'step', state: o.state, by: num(o.by, 1), min, max } : undefined
    }
    case 'command': return isLuaName(o.flag) ? { op: 'command', flag: o.flag } : undefined
    case 'log': return typeof o.text === 'string' ? clean({ op: 'log' as const, text: o.text, level: [0, 1, 2, 3].includes(o.level as number) ? o.level as 0 : undefined }) : undefined
    case 'call': return isLuaName(o.fn) ? { op: 'call', fn: o.fn } : undefined
  }
  return undefined
}
function actionOf(v: unknown): ClickAction | undefined {
  const o = obj(v)
  if (!text(o.id) || !text(o.on)) return undefined
  return clean({ id: o.id as string, on: o.on as string, page: text(o.page), when: text(o.when), do: arr(o.do).flatMap(s => stepOf(s) ?? []) })
}
function ruleOf(v: unknown): Rule | undefined {
  const o = obj(v), lt = lrefOf(o.lt)
  if (!text(o.id) || !isLuaName(o.role) || !lt || typeof o.value !== 'string') return undefined
  return clean({ id: o.id as string, role: o.role, lt, value: o.value, skipBoot: o.skipBoot === true ? true : undefined, pulse: o.pulse === true ? true as const : undefined })
}
function bindingOf(v: unknown): Binding | undefined {
  const o = obj(v), ease = o.ease === true ? true as const : undefined
  const list = (x: unknown) => Array.isArray(x) && x.length > 0 && (x.every(fin) || x.every(y => typeof y === 'string'))
  const s: Source | undefined =
    o.from === 'read' && isLuaName(o.read) ? clean({ from: 'read' as const, read: o.read, part: ['value', 'state', 'history'].includes(o.part as string) ? o.part as 'value' : undefined })
    : o.from === 'state' && isLuaName(o.state) ? { from: 'state', state: o.state }
    : o.from === 'expr' && typeof o.expr === 'string' ? { from: 'expr', expr: o.expr }
    : o.from === 'export' && isLuaName(o.name) ? { from: 'export', name: o.name }
    : o.from === 'const' && (fin(o.value) || typeof o.value === 'string' || list(o.value)) ? { from: 'const', value: o.value as number }
    : o.from === 'log' && ['k', 'm', 't'].includes(o.part as string) ? { from: 'log', part: o.part as 'k' }
    : undefined
  return s && clean({ ...s, ease })
}
function sourceOf(v: unknown): SimSource | undefined {
  const o = obj(v), per = (x: unknown) => fin(x) && x > 0 ? num(x, 1) : 1
  const range = (): [number, number] => pair(num(o.min, 0), num(o.max, 100))
  switch (o.kind) {
    case 'const': return { kind: 'const', v: num(o.v, 0) }
    case 'slider': { const [min, max] = range(); return { kind: 'slider', v: Math.min(max, Math.max(min, num(o.v, min))), min, max } }
    case 'sine': return { kind: 'sine', mid: num(o.mid, 0), amp: num(o.amp, 1), period: per(o.period) }
    case 'ramp': return { kind: 'ramp', from: num(o.from, 0), to: num(o.to, 1), period: per(o.period), loop: o.loop === true }
    case 'walk': { const [min, max] = range(); return { kind: 'walk', v: Math.min(max, Math.max(min, num(o.v, min))), step: Math.abs(num(o.step, 1)), min, max,
      seed: int(o.seed) && Math.abs(o.seed) <= SEED_MAX ? o.seed : 1 } }
    case 'keys': {
      const keys = arr(o.keys).flatMap(k => Array.isArray(k) && k.length === 2 && fin(k[0]) && fin(k[1]) ? [[num(k[0], 0), num(k[1], 0)] as [number, number]] : [])
      return keys.length ? { kind: 'keys', keys: keys.sort((a, b) => a[0] - b[0]), loop: o.loop === true } : undefined
    }
  }
  return undefined
}
const sources = (v: unknown) => Object.fromEntries(Object.entries(obj(v)).flatMap(([k, s]) => { const x = sourceOf(s); return k && x ? [[k, x]] : [] }))
function simOf(v: unknown): SimDevice | undefined {
  const o = obj(v)
  if (!text(o.id) || !text(o.prefab)) return undefined
  const slots = Object.fromEntries(Object.entries(obj(o.slots)).flatMap(([k, s]) => /^\d+$/.test(k) ? [[k, sources(s)]] : []))
  return clean({ id: o.id as string, prefab: o.prefab as string, label: typeof o.label === 'string' ? o.label : '', ref: int(o.ref) && o.ref <= REF_MAX ? o.ref : 0,
    pin: pinOf(o.pin), role: isLuaName(o.role) ? o.role : undefined, values: sources(o.values), slots: Object.keys(slots).length ? slots : undefined })
}
function settingsOf(v: unknown): Settings {
  const o = obj(v), b = obj(o.budgets), d = obj(o.day), D = DEFAULT_SETTINGS
  const budget = (x: unknown, dflt: number) => fin(x) ? Math.min(10_000_000, Math.max(1000, Math.round(x / 1000) * 1000)) : dflt
  const start = fin(d.start) ? ((d.start % 1) + 1) % 1 : D.day.start
  return { budgets: { load: budget(b.load, D.budgets.load), tick: budget(b.tick, D.budgets.tick) }, beta: o.beta === true,
    day: { length: fin(d.length) && d.length > 0 ? num(d.length, 1200) : D.day.length, start }, wipeOnReexport: o.wipeOnReexport === true }
}

/** Each list read item by item: an unreadable item is counted, a second item with an id already read is named; both dropped. */
function list<T>(v: unknown, read: (x: unknown) => T | undefined, key: (x: T) => string, what: string, notes: string[]): T[] {
  const seen = new Set<string>(), out: T[] = []
  let bad = 0
  for (const x of arr(v)) {
    const t = read(x)
    if (!t) { bad++; continue }
    const k = key(t)
    if (seen.has(k)) { notes.push(`${what.slice(0, -1)} ${k} appears twice; the second was dropped`); continue }
    seen.add(k)
    out.push(t)
  }
  if (bad) notes.push(`${what}: ${bad} could not be read and were dropped`)
  return out
}

/** The live data from anything (a project file, a link): never throws. */
export function logicFrom(v: unknown): { logic: Logic; notes: string[] } {
  const o = obj(v), notes: string[] = []
  const sims = list(o.simDevices, simOf, d => d.id, 'simulated devices', notes)
  const refs = new Set<number>(), occupied = new Set(sims.map(d => d.ref))
  let next = 2
  for (const d of sims) {   // refs unique and 2 or more: the housing is 1
    if (d.ref < 2 || refs.has(d.ref)) { while (occupied.has(next)) next++; d.ref = next; occupied.add(next) }
    refs.add(d.ref)
  }
  const bindings = Object.fromEntries(Object.entries(obj(o.bindings)).flatMap(([k, b]) => { const x = bindingOf(b); return k && x ? [[k, x]] : [] }))
  return { notes, logic: { roles: list(o.roles, roleOf, r => r.id, 'roles', notes), reads: list(o.reads, readOf, r => r.id, 'reads', notes),
    state: list(o.state, stateOf, s => s.name, 'states', notes), actions: list(o.actions, actionOf, a => a.id, 'actions', notes),
    rules: list(o.rules, ruleOf, r => r.id, 'rules', notes), bindings, customLua: typeof o.customLua === 'string' ? o.customLua : '',
    simDevices: sims, settings: settingsOf(o.settings) } }
}

/** `l` with every reference that does not resolve dropped: reads, rules and the simulated devices made for a role that is
 *  gone; bindings and steps naming a read or a state that is gone; page steps to a page that is gone (never the Devices page);
 *  actions scoped to a page that is gone. */
export function cascade(l: Logic, pageIds: string[]): Logic {
  const roles = new Set(l.roles.map(r => r.id)), states = new Set(l.state.map(s => s.name)), pages = new Set([...pageIds, DEVICES_PAGE])
  const reads = l.reads.filter(r => roles.has(r.role)), readIds = new Set(reads.map(r => r.id))
  const live = (b: Binding) => b.from === 'read' ? readIds.has(b.read) : b.from === 'state' ? states.has(b.state) : true
  const stepOk = (s: Step) => s.op === 'page' ? pages.has(s.page) : 'state' in s ? states.has(s.state) : true
  const actions = l.actions.filter(a => a.page === undefined || pages.has(a.page))
  return { ...l, reads, rules: l.rules.filter(r => roles.has(r.role)), simDevices: l.simDevices.filter(d => !d.role || roles.has(d.role)),
    bindings: Object.fromEntries(Object.entries(l.bindings).filter(([, b]) => live(b))),
    actions: actions.map(a => a.do.every(stepOk) ? a : { ...a, do: a.do.filter(stepOk) }) }
}

/** `l` with role, read or state `from` named `to` everywhere it is referenced; a string says why not. Expression text is not
 *  rewritten (the caller says so). */
export function renamed(l: Logic, kind: 'role' | 'read' | 'state', from: string, to: string): Logic | string {
  if (!isLuaName(to)) return `"${to}" is not a Lua name (letters, digits and _, not a keyword)`
  const ids = kind === 'role' ? l.roles.map(r => r.id) : kind === 'read' ? l.reads.map(r => r.id) : l.state.map(s => s.name)
  if (!ids.includes(from)) return `no ${kind} ${from}`
  if (ids.includes(to)) return `${kind} ${to} exists already`
  const swap = (x: string) => x === from ? to : x
  if (kind === 'role') return { ...l, roles: l.roles.map(r => ({ ...r, id: swap(r.id) })), reads: l.reads.map(r => ({ ...r, role: swap(r.role) })),
    rules: l.rules.map(r => ({ ...r, role: swap(r.role) })), simDevices: l.simDevices.map(d => d.role ? { ...d, role: swap(d.role) } : d) }
  if (kind === 'read') return { ...l, reads: l.reads.map(r => ({ ...r, id: swap(r.id) })),
    bindings: Object.fromEntries(Object.entries(l.bindings).map(([k, b]) => [k, b.from === 'read' ? { ...b, read: swap(b.read) } : b])) }
  return { ...l, state: l.state.map(s => ({ ...s, name: swap(s.name) })),
    actions: l.actions.map(a => ({ ...a, do: a.do.map(s => 'state' in s ? { ...s, state: swap(s.state) } : s) })),
    bindings: Object.fromEntries(Object.entries(l.bindings).map(([k, b]) => [k, b.from === 'state' ? { ...b, state: swap(b.state) } : b])) }
}
