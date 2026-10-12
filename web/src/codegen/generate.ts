// The exporter (spec §6.4): one Lua 5.2 script per project: two header lines, the runtime library verbatim, the
// generated VB.cfg, the custom block between markers, VB.boot() and tick. Every expression is guarded (checkExpr) and wrapped
// in a function; a refused one drops what holds it and is an error naming its owner. Returns the Lua, its line map (every
// line once) and the problems; never throws on a project loadProject accepts.
import { crc32 } from '../catalog/crc32'
import { designSize, fitOf } from '../editor/geometry'
import { BUNDLED } from '../editor/fonts'
import { fontFallbackWarning, fontTagWarning, sceneFontNames } from '../editor/fontWarnings'
import { pageFontLinks } from '../editor/pageFonts'
import { DEVICES_PAGE, RESERVED, type Binding, type Bound, type ClickAction, type LogicRef, type Step, type Thresholds } from '../model/logic'
import { VECTOR_FLOOR, type Page, type Project } from '../model/project'
import type { Scene } from '../model/scene'
import { px } from '../model/shapes'
import { printChecked } from '../srctext/print'
import { themeOf } from '../theme'
import { isObject, nativesOf, slotsOf, widgetsIn } from '../widgets/core'
import { nodeAt } from '../model/tree'
import { clickTargets, parseStep } from './clicks'
import { devicesName, devicesPage } from './devicesPage'
import { checkExpr } from './expr'
import type { MapEntry, Part, Problem } from './linemap'
import { colourOr, datum, globalsWritten, lex, lit, long, num, quote } from './lua'
import { namesOf } from './names'
import { requiresLines } from './requirements'
import RUNTIME from './runtime.lua?raw'

const lf = (text: string) => text.replace(/\r\n|\n\r|\r/g, '\n')

export const LIB_VERSION = 1
export const CUSTOM_BEGIN = '-- >>> vectorbuilder custom (kept verbatim)'
export const CUSTOM_END = '-- <<< vectorbuilder custom'
export type GeneratedPage = { id: string; surface: string; src: string; empty: boolean; w: number; h: number }
export type Generated = { lua: string; map: MapEntry[]; problems: Problem[]; pages: GeneratedPage[] }

/** The vector mod's `ver` encoding since 0.11.103: Major * 1000000 + Minor * 1000 + Build (0.11.118 → 11118). */
export const floorVer = (tag: string) => { const [a, b, c] = tag.split('.').map(Number); return a * 1000000 + b * 1000 + c }

/** The old-mod banner (spec 6.3): the scene's last child, shown only on a mod older than the floor. */
export function bannerSrc(header: Scene['header'], floor = VECTOR_FLOOR): string {
  const { w, h } = designSize(header), bh = Math.max(24, Math.round(h * 0.12)), r = (v: number) => num(Math.round(v * 1000) / 1000)
  return `G v==lt(ver,${floorVer(floor)}) {\n    R x=0 y=0 w=${r(w)} h=${bh} f=#000000CC\n`
    + `    T x=${r(w * 0.03)} y=0 w=${r(w * 0.94)} h=${bh} text="Update ScriptedScreens Vector to ${floor} or newer" size=${Math.round(bh * 0.45)} f=#FFCC00\n}\n`
}

// What a nil (or an empty list) sends, per slot kind (ruling P7); a number and a raw name keep their last value.
const NILS: Record<string, string> = { state: '0', flag: '0', count: '0', text: '"--"', string: '"--"', numbers: '{ 0 }', states: '{ 0 }', strings: '{ "" }', texts: '{ "" }' }
const MIRROR_FREE = 254   // chip memory 256..509 for the mirror's entries (511 magic, 510 count; 0..255 are custom code's)
const commentLine = (text: string) => text.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, c =>
  c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
// ponytail: a lexical heuristic (a format call and a %d/%i anywhere in the text); a Lua pattern's %d inside a format call's
// text is flagged too. Upgrade: a Lua lexer over the string arguments of format calls.
const FORMAT = /format\s*\(/, PCT_D = /%[-+ #0]*\d*(?:\.\d+)?[di]/

class Out {
  lines: string[] = []
  map: MapEntry[] = []
  add(part: Part, text: string, ref?: string) {
    const first = this.lines.length + 1
    for (const line of text.split('\n')) this.lines.push(line)
    this.map.push({ first, last: this.lines.length, part, ...(ref !== undefined && { ref }) })
  }
}

const ltLit = (r: LogicRef) => 'name' in r ? quote(r.name) : num(r.id)
const thLit = (th: Thresholds) => `{ ${[...(['critBelow', 'warnBelow', 'warnAbove', 'critAbove', 'hyst'] as const).filter(k => th[k] !== undefined).map(k => `${k} = ${num(th[k]!)}`),
  ...(th.log !== undefined ? [`log = ${quote(th.log)}`] : [])].join(', ')} }`
const bgLit = (background: string[] | undefined) => {
  if (!background?.length) return 'nil'
  const [top, bottom] = background, bg = colourOr(top, '#00000000')
  return `{ bg = ${quote(bg)}${bottom === undefined ? '' : `, gradient = ${quote(colourOr(bottom, bg))}`} }`
}
const kv = (m: Record<string, string | number>) => Object.entries(m).map(([k, v]) => `[${quote(k)}] = ${lit(v)}`).join(', ')

// Only the shape the generator's readers need; scene semantics are checked by the scene worker.
// loadProject deliberately keeps unread scenes for that worker to report. Walk iteratively, with no depth cap.
function sceneProblem(scene: unknown): string | null {
  if (!isObject(scene)) return 'scene must be an object'
  if (!isObject(scene.header)) return 'scene header must be an object'
  if (!Array.isArray(scene.root)) return 'scene root must be a list'
  if (!Array.isArray(scene.defs)) return 'scene defs must be a list'
  const stack: { node: unknown; exit?: true }[] = [], active = new Set<unknown>()
  for (const node of scene.root) stack.push({ node })
  for (const node of scene.defs) stack.push({ node })
  while (stack.length) {
    const { node, exit } = stack.pop()!
    if (exit) { active.delete(node); continue }
    if (!isObject(node) || typeof node.op !== 'string' || !isObject(node.attrs)
      || (node.c !== undefined && !Array.isArray(node.c))) return 'scene nodes need a text op, object attrs and list children'
    if (active.has(node)) return 'scene nodes contain a cycle'
    active.add(node)
    stack.push({ node, exit: true })
    for (const child of node.c as unknown[] ?? []) stack.push({ node: child })
  }
  return null
}

/** The Devices page is generated when a role finds its device by a scan (no housing pin, no fixed ref). */
const scansDevices = (p: Project) => p.roles.some(r => r.pin === undefined && r.ref === undefined)
/** The vector scene ids an export of `p` draws: each page's, then the Devices page's when one is generated. */
export const exportScenes = (p: Project): string[] => [...p.pages.map(pg => pg.id), ...(scansDevices(p) ? [devicesName(p)] : [])]

export function generate(p: Project, srcOf: (page: Page) => string): Generated {
  const out = new Out(), problems: Problem[] = [], t = themeOf(p), ver = floorVer(VECTOR_FLOOR)
  const generatedPages: GeneratedPage[] = []
  const fail = (owner: string, why: string) => { problems.push({ level: 'error', owner, message: `${owner}: ${why}` }) }
  // Return page-owned problems before any reader or src callback sees an unread page. No partial script is exported.
  const ids = new Set<string>(), surfaces = new Set<string>()
  for (const [i, page] of p.pages.entries()) {
    const owner = `page ${typeof page.id === 'string' ? page.id : i + 1}`
    if (typeof page.id !== 'string') fail(owner, 'id must be text')
    if (typeof page.surface !== 'string') fail(owner, 'surface must be text')
    if (ids.has(page.id)) fail(owner, `duplicate id ${page.id}`)
    if (surfaces.has(page.surface)) fail(owner, `duplicate surface ${page.surface}`)
    ids.add(page.id); surfaces.add(page.surface)
    const why = sceneProblem(page.scene)
    if (why) fail(owner, why)
  }
  if (problems.length) return { lua: '', map: [], problems, pages: [] }
  const known = new Set(BUNDLED), modelFaces = new Set<string>()
  const links = [...new Set(p.pages.flatMap(page => pageFontLinks(page.scene)))]
  const fontPages = p.pages.filter(page => page.scene.defs.some(def => def.op.toUpperCase() === 'FONT'))
  for (const page of p.pages) {
    const names = sceneFontNames(page.scene)
    for (const name of [...names.attributes, ...names.tags]) modelFaces.add(name)
    if (fontPages.includes(page)) problems.push({ level: 'warning', owner: `page ${page.id}`,
      message: `page ${page.id}: FONT downloads and face availability depend on the Fonts APIs, allowed hosts and fonts per player; unavailable attributes use game fallback, and unknown rich font tags show as text. Preview loading does not prove delivery in game.` })
    else {
      for (const name of names.attributes) if (!known.has(name)) problems.push({ level: 'warning', owner: `page ${page.id}`, message: `page ${page.id}: ${fontFallbackWarning(name)}` })
      for (const name of names.tags) if (!known.has(name)) problems.push({ level: 'warning', owner: `page ${page.id}`, message: `page ${page.id}: ${fontTagWarning(name)}` })
    }
  }
  const sources = new Map<Page, string>()
  for (const page of p.pages) {
    try {
      const text = srcOf(page)
      if (typeof text !== 'string') fail(`page ${page.id}`, 'checked scene text is unavailable')
      else sources.set(page, lf(text))
    } catch {
      fail(`page ${page.id}`, 'checked scene text cannot be read')
    }
  }
  if (problems.some(p => p.level === 'error')) return { lua: '', map: [], problems, pages: [] }
  // Lua 5.2's %d raises on a fraction; use a float format or floor the value (spec D17).
  const pctD = (src: string, owner: string) => {
    if (FORMAT.test(src) && PCT_D.test(src)) problems.push({ level: 'warning', owner, message: `${owner}: %d needs an integer (Lua 5.2 raises on a fraction): use %.0f or math.floor` })
  }
  const fn = (src: string, owner: string, args = ''): string | null => {
    const why = checkExpr(src)
    if (why) { fail(owner, why); return null }
    pctD(src, owner)
    return `function(${args}) return (${src}) end`
  }
  const bound = (b: Bound, owner: string) => typeof b === 'number' ? `function() return ${num(b)} end` : fn(b, owner)
  const roleAt = new Map(p.roles.map((r, i) => [r.id, i + 1]))
  const dev = scansDevices(p) ? devicesPage(p, t) : null
  const start = p.pages[0]

  const devSrc = dev ? printChecked(dev.scene) : ''
  if (dev) for (const name of Object.values(sceneFontNames(dev.scene)).flat()) modelFaces.add(name)
  const faces = [...modelFaces].filter(f => !['Liberation Sans', 'Liberation Sans Bold', 'Liberation Sans Italic', 'Liberation Sans Bold Italic'].includes(f))
  out.add('lib', `-- VectorBuilder export · runtime library ${LIB_VERSION} · ScriptedScreens Vector >= ${VECTOR_FLOOR} (ver ${ver})\n`
    + requiresLines(faces.length || fontPages.length ? faces.map(commentLine) : null).join('\n'))
  if (fontPages.length) {
    out.add('lib', '-- Page downloads require FontApi.RequestFontWithReason (from 0.3.0); late arrivals require FontApi.Registrations (from 0.4.0). Availability depends on the installed build, not a single minimum version.')
    out.add('lib', `-- This project: ${links.length} distinct FONT links (all pages). Game limits: 48 distinct links per process; 48 page faces per session, shared across pages, projects and consoles in that process.`)
    out.add('lib', "-- Faces built by requests count; cached faces (earlier downloads or the player's own folder) cost nothing; a name clash still counts; failed or disabled faces do not. Existing/shared player fonts affect actual session usage.")
    if (links.length > 48) problems.push({ level: 'warning', message: `This project's ${links.length} distinct FONT links exceed the game's shared 48-link process limit; source and export remain available.` })
    for (const link of links) out.add('lib', `-- FONT link: ${commentLine(link)}`)
  }
  out.add('lib', lf(RUNTIME).trimEnd())
  out.add('config', `VB.cfg = { lib = ${LIB_VERSION}, floor = ${ver}, start = 1, logKeep = 8, memLow = 256, magic = ${crc32('vectorbuilder-mirror-1')},\n  roles = {`)
  for (const r of p.roles)
    out.add('config', `    { id = ${quote(r.id)}, name = ${quote(r.name)}, prefabs = { ${r.prefabs.map(x => num(crc32(x))).join(', ')} }, label = ${r.label === undefined ? 'nil' : quote(r.label)}, `
      + `all = ${r.mode === 'all'}${r.pin !== undefined ? `, pin = ${r.pin}` : ''}${r.ref !== undefined ? `, ref = ${num(r.ref)}` : ''}${r.optional ? ', optional = true' : ''}${r.distinct ? ', distinct = true' : ''}, key = ${crc32('r:' + r.id)} },`, r.id)

  out.add('config', '  },\n  reads = {')
  for (const r of p.reads) {
    if (!roleAt.has(r.role)) continue
    const derived = r.derived === undefined ? null : fn(r.derived, `read ${r.id} (derived)`, 'x')
    const f = [`id = ${quote(r.id)}`, `role = ${roleAt.get(r.role)}`, 'lt' in r.of ? `lt = ${ltLit(r.of.lt)}` : `slot = ${r.of.slot}, lst = ${quote(r.of.lst)}`,
      r.agg && `agg = ${quote(r.agg)}`, r.valid && `valid = { ${num(r.valid[0])}, ${num(r.valid[1])} }`,
      r.unit && `unit = ${quote(r.unit)}`, r.scale !== undefined && `scale = ${num(r.scale)}`, r.offset !== undefined && `offset = ${num(r.offset)}`,
      r.clamp && `clamp = { ${num(r.clamp[0])}, ${num(r.clamp[1])} }`, r.smooth !== undefined && `smooth = ${num(r.smooth)}`, derived && `derived = ${derived}`,
      r.th && `th = ${thLit(r.th)}`, r.history && `hist = { n = ${r.history.n}, every = ${r.history.every ?? 1} }`]
    out.add('read', `    { ${f.filter(Boolean).join(', ')} },`, r.id)
  }

  out.add('config', '  },\n  state = {')
  for (const s of p.state) {
    const init = s.type === 'bool' ? String(s.init === true) : s.type === 'string' ? quote(String(s.init)) : num(Number(s.init))
    const f = [`name = ${quote(s.name)}`, `type = ${quote(s.type)}`, `init = ${init}`, s.type === 'enum' && `n = ${s.options?.length ?? 1}`,
      s.min !== undefined && `min = ${num(s.min)}`, s.max !== undefined && `max = ${num(s.max)}`, `save = ${s.save !== false}`,
      s.type === 'string' && `bytes = ${s.mirrorBytes ?? 30}`, `key = ${crc32('s:' + s.name)}`]
    out.add('config', `    { ${f.filter(Boolean).join(', ')} },`, s.name)
  }

  // Actions, by the node (or native) they answer to; a press plate's act runs on down: only. Targets stay per page: raw ids
  // are unique per scene only (ruling P18), so one id on two pages is two targets.
  const targets = p.pages.flatMap(pg => clickTargets(pg, t))
  const step = (s: Step, owner: string): string | null => {
    switch (s.op) {
      case 'page': {
        const id = s.page === DEVICES_PAGE ? dev?.cfg.id : s.page
        if (id === undefined) { problems.push({ level: 'warning', message: `${owner}: there is no Devices page (no role scans the network), so this step does nothing` }); return null }
        return `{ op = "page", page = ${quote(id)} }`
      }
      case 'set': { const f = fn(s.value, owner); return f && `{ op = "set", s = ${quote(s.state)}, f = ${f} }` }
      case 'toggle': case 'cycle': return `{ op = "${s.op}", s = ${quote(s.state)} }`
      case 'step': { const lo = bound(s.min, owner), hi = bound(s.max, owner); return lo && hi && `{ op = "step", s = ${quote(s.state)}, by = ${num(s.by)}, min = ${lo}, max = ${hi} }` }
      case 'command': return `{ op = "command", c = ${quote(s.flag)} }`
      case 'log': { const f = fn(s.text, owner); return f && `{ op = "log", f = ${f}${s.level !== undefined ? `, level = ${s.level}` : ''} }` }
      case 'call': return `{ op = "call", fn = ${quote(s.fn)} }`
    }
  }
  out.add('config', '  },\n  acts = {')
  const byOn = new Map<string, ClickAction[]>(), nativeIds = new Set(targets.filter(c => c.native).map(c => c.id))
  for (const a of p.actions) {
    const key = a.page === undefined || nativeIds.has(a.on) ? a.on : `${a.page}/${a.on}`
    const list = byOn.get(key)
    if (list) list.push(a)
    else byOn.set(key, [a])
  }
  for (const [key, list] of byOn) {
    const { on, page } = list[0], ids = list.map(a => a.id).join(', ')
    const found = targets.filter(c => c.id === on && (c.native || page === undefined || c.page === page)), target = found[0]
    if (!target) problems.push({ level: 'warning', message: `action ${ids}: no node or native ${on} on ${page === undefined ? 'any page' : `page ${page}`}, so it never runs` })
    if (new Set(found.map(c => c.press)).size > 1)
      problems.push({ level: 'warning', message: `action ${ids}: ${on} is a press plate on some pages and not on others (${found.map(c => c.page).join(', ')}); scope the action to a page` })
    // An Option group's or Page tabs' plate is addressed by its item index: after a Remove the plates renumber, and a wired
    // action keeps the old step (the ids use item indices). Say so when the action's own step of the plate's kind no longer matches.
    const s = target?.widget ? parseStep(target.step) : null
    for (const a of list) for (const x of a.do) {
      const was = x.op === 'page' && s?.op === 'page' && x.page !== s.page ? `page(${x.page})`
        : x.op === 'set' && s?.op === 'set' && x.value.trim() !== String(s.value) ? `set(${x.value})` : null
      if (was) problems.push({ level: 'warning', message: `action ${a.id}: ${on} now suggests ${target!.step}; this action does ${was} (an item removed or moved?)` })
    }
    const entries = list.flatMap(a => {
      const when = a.when === undefined ? undefined : fn(a.when, `action ${a.id} (when)`)
      if (when === null) return []
      const steps = a.do.map(s => step(s, `action ${a.id}`)).filter((x): x is string => !!x)
      return [`{ ${when ? `when = ${when}, ` : ''}steps = { ${steps.join(', ')} } }`]
    })
    out.add('action', `    [${quote(key)}] = { ${target?.native ? 'native = true' : `press = ${target?.press === true}`}, list = { ${entries.join(', ')} } },`, list[0].id)
  }

  out.add('config', '  },\n  rules = {')
  for (const r of p.rules) {
    const f = fn(r.value, `rule ${r.id}`)
    if (f && roleAt.has(r.role)) out.add('rule', `    { role = ${roleAt.get(r.role)}, lt = ${ltLit(r.lt)}, f = ${f}, skip = ${r.skipBoot === true}, pulse = ${r.pulse === true} },`, r.id)
  }

  // Pages: src with the banner last (ruling P15); per name its carrier, its nil, and its binding or its sample.
  const sourceLua = (b: Binding, owner: string): string | null => {
    switch (b.from) {
      case 'read': return `${b.part === 'state' ? 'T' : b.part === 'history' ? 'H' : 'P'}.${b.read}`
      case 'state': return `S.${b.state}`
      case 'expr': { const why = checkExpr(b.expr); if (why) { fail(owner, why); return null } pctD(b.expr, owner); return `(${b.expr})` }
      case 'export': {
        if (typeof b.name !== 'string') { fail(owner, 'custom export name must be text'); return null }
        return `X[${quote(b.name)}]`
      }
      case 'const': return lit(b.value)
      case 'log': return `L.${b.part}`
    }
  }
  const bindingOf = (name: string) => Object.hasOwn(p.bindings, name) ? p.bindings[name] : undefined
  const bindingSources = new Map<string, string | null>()
  const sourceOf = (name: string, b: Binding) => {
    if (!bindingSources.has(name)) bindingSources.set(name, sourceLua(b, `binding ${name}`))
    return bindingSources.get(name)!
  }
  out.add('config', '  },\n  pages = {')
  const unbound: string[] = []
  for (const page of p.pages) {
    // No scene element only where natives stand alone (an empty page keeps one: its first node is then a patch, not a reload).
    const size = designSize(page.scene.header), empty = page.scene.root.length === 0 && !page.scene.defs.some(def => def.op.toUpperCase() === 'FONT') && nativesOf(page, t).length > 0
    const snap: string[] = [], eased: string[] = [], arrays: string[] = [], samples: string[] = [], nils: string[] = [], data: [string, string][] = []
    for (const n of namesOf(page, t)) {
      if (n.native) continue
      const b = bindingOf(n.name), key = `[${quote(n.name)}]`
      if ((n.kind === 'raw' ? !b?.ease || !n.geometry : n.snap)
        || b?.from === 'read' && b.part === 'history' || b?.from === 'log') snap.push(`${key} = true`)
      else {
        eased.push(`${key} = ${n.travel ? num(0.5 / n.travel) : '0'}`)
        if (n.kind === 'numbers' || n.kind === 'raw') arrays.push(`${key} = true`)
      }
      if (NILS[n.kind]) nils.push(`${key} = ${NILS[n.kind]}`)
      if (n.runtime) {
        if (b) problems.push({ level: 'warning', message: `${n.name}: runtime-owned; its stored binding is not used` })
        continue
      }
      const src = b && sourceOf(n.name, b)
      if (src) { data.push([n.name, `o${key} = ${src}`]); continue }
      const own = page.preview && Object.hasOwn(page.preview, n.name) ? page.preview[n.name] : undefined
      const d = datum(own !== undefined ? own : n.sample)
      if (d !== undefined) { samples.push(`${key} = ${lit(d)}`); unbound.push(n.name) }
    }
    const repeaters = widgetsIn(page.scene, t).flatMap(({ path, ref }) => {
      if (ref.type !== 'repeater' || ref.params.item !== 'row') return []
      const slots = slotsOf(nodeAt(page.scene.root, path)!, t), key = (s: string) => quote(slots.find(x => x.slot === s)!.key)
      return [`{ n = ${key('n')}, v = ${key('v')}, hasv = ${key('hasv')}, ready = ${key('ready')}, max = ${num(ref.params.max as number)} }`]
    })
    const natives = nativesOf(page, t).map(({ uid, el }) => {
      const prop = el.type === 'icon' ? 'name' : 'value', b = bindingOf(`@${uid}.${prop}`), src = b && sourceOf(`@${uid}.${prop}`, b)
      return `{ uid = ${quote(uid)}, type = ${quote(el.type)}, x = ${num(el.box.x)}, y = ${num(el.box.y)}, w = ${num(el.box.w)}, h = ${num(el.box.h)}, `
        + `props = { ${kv(el.props)} }, style = { ${kv(el.style)} }${el.fontSize ? `, font = ${num(el.fontSize)}` : ''}`
        + `${src ? `, bind = { [${quote(prop)}] = function() return ${src} end }` : ''} }`
    })
    const src = empty ? '' : sources.get(page)! + bannerSrc(page.scene.header)
    generatedPages.push({ id: page.id, surface: page.surface, src, empty, w: px(page.size.w), h: px(page.size.h) })
    out.add('page', `    { id = ${quote(page.id)}, surface = ${quote(page.surface)}, bg = ${bgLit(page.background)}, src = ${long(src)},`, page.id)
    out.add('page', `      snap = { ${snap.join(', ')} }, samples = { ${samples.join(', ')} }, nils = { ${nils.join(', ')} }, eased = { ${eased.join(', ')} }, arrays = { ${arrays.join(', ')} },\n`
      + (repeaters.length ? `      repeaters = { ${repeaters.join(', ')} },\n` : '') + '      data = function(o)', page.id)
    for (const [name, line] of data) out.add('binding', `        ${line}`, name)
    out.add('page', `      end,\n      natives = { ${natives.join(', ')} },\n      empty = ${empty}, w = ${px(page.size.w)}, h = ${px(page.size.h)}, `
      + `dw = ${num(size.w)}, dh = ${num(size.h)}, fit = ${quote(fitOf(page.scene.header))} },`, page.id)
  }
  if (unbound.length) problems.push({ level: 'info', message: `unbound data names send their samples: ${unbound.join(', ')}` })

  out.add('config', '  },')
  if (dev) {
    const { cfg, scene } = dev, size = designSize(start.scene.header), names = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k} = ${quote(v)}`).join(', ')
    generatedPages.push({ id: cfg.id, surface: cfg.surface, src: devSrc + bannerSrc(scene.header), empty: false, w: px(start.size.w), h: px(start.size.h) })
    out.add('devices', `  devices = { id = ${quote(cfg.id)}, surface = ${quote(cfg.surface)}, bg = ${bgLit(start.background)}, src = ${long(devSrc + bannerSrc(scene.header))}, rows = ${cfg.rows},\n`
      + `    keys = { ${names(cfg.keys)} }, ids = { ${names(cfg.ids)} },\n`
      + `    repeaters = { { n = ${quote(cfg.keys.n)}, v = ${quote(cfg.keys.v)}, hasv = ${quote(cfg.keys.hasv)}, ready = ${quote(cfg.keys.ready)}, max = ${cfg.rows} } },\n`
      + `    snap = { ${cfg.snap.map(k => `[${quote(k)}] = true`).join(', ')} }, samples = {}, nils = { ${Object.entries(cfg.nils).map(([k, v]) => `[${quote(k)}] = ${lit(v)}`).join(', ')} },\n`
      + `    eased = {}, natives = {}, empty = false, w = ${px(start.size.w)}, h = ${px(start.size.h)}, dw = ${num(size.w)}, dh = ${num(size.h)}, fit = "contain" },`)
    if (!p.actions.some(a => a.do.some(s => s.op === 'page' && s.page === DEVICES_PAGE)) && !p.customLua.includes(DEVICES_PAGE))
      problems.push({ level: 'warning', message: 'the Devices page has no way in: add a page step to it (a button or a tab)' })
  } else out.add('config', '  devices = nil,')
  out.add('config', '}')

  const words = p.roles.filter(r => r.mode === 'one' && r.pin === undefined && r.ref === undefined).length * 4
    + p.state.filter(s => s.save !== false).reduce((n, s) => n + 3 + (s.type === 'string' ? Math.ceil((s.mirrorBytes ?? 30) / 3) : 0), 0)
  if (words > MIRROR_FREE) problems.push({ level: 'error', message: `the chip-memory mirror needs ${words} addresses; ${MIRROR_FREE} are free (256..509)` })

  const custom = lf(p.customLua)
  const own = (message: string) => problems.push({ level: 'error', owner: 'custom code', message: `custom code: ${message}` })
  if (lex(custom).lineComments.some(c => c.trim() === CUSTOM_END)) own('holds the end marker line; the block would end there')
  const globals = globalsWritten(custom)
  if (globals.has('tick')) own('defines tick; the export defines tick after the block, so this one never runs (use the U hooks)')
  for (const n of globals)
    if (RESERVED.has(n) && n !== 'tick') own(`assigns the reserved global ${n}; assign its fields (${n}.x = …) instead`)
  pctD(custom, 'custom code')
  out.add('boot', `do\n${CUSTOM_BEGIN}`)
  if (custom) out.add('custom', custom.replace(/\n$/, ''))
  out.add('boot', `${CUSTOM_END}\nend\nVB.boot()\nfunction tick(dt) VB.tick(dt) end`)
  return { lua: out.lines.join('\n') + '\n', map: out.map, problems, pages: generatedPages }
}
