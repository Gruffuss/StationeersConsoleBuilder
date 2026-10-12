import type { Project } from '../model/project'
import type { StateVar } from '../model/logic'
import type { SrcNode, Value } from '../model/scene'
import type { NodeRef } from '../srctext/check'
import { first, textOf } from '../srctext/props'
import { ROLES, themeOf } from '../theme'
import { isObject, nativesOf } from '../widgets/core'
import type { Problem } from './linemap'
import { lex } from './lua'

export type ExportProblem = Problem & { location?: { page: string; ref: NodeRef; key?: string } }

type Literal = string | number | boolean | null
const bytes = (v: string) => new TextEncoder().encode(v).length

function pictureInfo(src: string): string {
  if (/^data:/i.test(src)) {
    try {
      const comma = src.indexOf(',')
      if (comma < 0) throw new Error()
      const body = src.slice(comma + 1)
      const size = /;base64$/i.test(src.slice(0, comma)) ? atob(body.trim()).length : body.replace(/%[\da-f]{2}/gi, 'x').length
      return `Embedded picture: ${size} bytes decoded from data: URL`
    } catch { return 'Embedded picture: unreadable data: URL (the game reports the failure)' }
  }
  if (/^https:/i.test(src)) {
    try { return `Picture from ${new URL(src).host}: the game downloads it on each console, once per session` }
    catch { return `Picture source ${src}` }
  }
  if (/^file:\/\//i.test(src)) return `Picture ${src.slice(7)}: read from the game machine's disk; nothing checks it here`
  return `Picture source ${src}`
}

/** Only complete literals; escaped strings and expressions stay uncertain. */
function literal(src: string): { value: Literal } | undefined {
  const s = src.trim()
  if (s === 'true' || s === 'false') return { value: s === 'true' }
  if (s === 'nil') return { value: null }
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) && Number.isFinite(Number(s))) return { value: Number(s) }
  const quoted = /^(?:"[^"\\\r\n]*"|'[^'\\\r\n]*')$/.test(s), long = /^\[(=*)\[[\s\S]*\]\1\]$/.test(s)
  if (!quoted && !long) return
  const { code, strs } = lex(s)
  if (code !== '$0' || strs.length !== 1) return
  return { value: long ? strs[0].replace(/\r\n|\n\r|\r/g, '\n').replace(/^\n/, '') : strs[0] }
}

/** runtime.lua's state coercion, restricted to certain literal inputs. */
function coerce(s: StateVar, v: Literal): Literal | undefined {
  if (s.type === 'bool') return v !== null && v !== false && v !== 0 && v !== '0' && v !== ''
  if (v === null) return s.init
  if (s.type === 'string') {
    // shortcut: numeric spelling is certain only for small integers, expand if a correct Lua tostring reader is needed.
    if (typeof v === 'number' && (!Number.isSafeInteger(v) || Math.abs(v) >= 1e15)) return
    return String(v)
  }
  if (typeof v === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim())) return
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return s.init
  if (s.type === 'enum') return Math.max(0, Math.min((s.options?.length ?? 1) - 1, Math.floor(n)))
  return Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, n))
}

const stored = (s: StateVar, v: Literal) => s.type === 'bool' ? v ? '1' : '0' : String(v)
const limits = (key: string, value: string | undefined) => [
  ...(bytes(key) > 128 ? [`key ${JSON.stringify(key)} is ${bytes(key)} UTF-8 bytes, above the documented 128-byte key limit`] : []),
  ...(value !== undefined && bytes(value) > 8192 ? [`value is ${bytes(value)} UTF-8 bytes, above the documented 8192-byte value limit`] : []),
]

/** Only the structure these readers require; scene semantics stay with the worker. */
function unreadScene(scene: Project['pages'][number]['scene']): string | undefined {
  if (!isObject(scene) || !isObject(scene.header) || !Array.isArray(scene.root) || !Array.isArray(scene.defs)) return 'scene needs an object header and root/defs lists'
  const frames: { nodes: unknown[]; k: number; parent?: unknown }[] = [{ nodes: scene.root, k: 0 }, { nodes: scene.defs, k: 0 }], active = new Set<unknown>()
  while (frames.length) {
    const fr = frames[frames.length - 1]
    if (fr.k === fr.nodes.length) { active.delete(fr.parent); frames.pop(); continue }
    const n = fr.nodes[fr.k++]
    if (!isObject(n) || typeof n.op !== 'string' || !isObject(n.attrs) || n.c !== undefined && !Array.isArray(n.c)) return 'scene nodes need a text op, object attrs and list children'
    if (active.has(n)) return 'scene nodes contain a cycle'
    if (Array.isArray(n.c) && n.c.length) { active.add(n); frames.push({ nodes: n.c, k: 0, parent: n }) }
  }
}

export function exportProblems(p: Project): ExportProblem[] {
  const t = themeOf(p), out: ExportProblem[] = []
  const roles = new Set(ROLES)
  for (const style of Object.values(t.type)) roles.add(style.ink)
  for (const pair of Object.values(t.gradients)) for (const role of pair) roles.add(role)
  for (const shadows of Object.values(t.shadows)) for (const shadow of shadows) if (!shadow[4].startsWith('#')) roles.add(shadow[4])
  for (const role of roles) if (!Object.hasOwn(t.colors, role)) out.push({ level: 'error', owner: `theme role ${role}`,
    message: `theme ${t.name}: missing colour role ${role}` })
  if (out.length) return out

  // Guard the readers; generation owns structural diagnostics.
  if (p.pages.some(page => unreadScene(page.scene))) return out
  let uncertainSize = false
  const nativeIds = new Set<string>()
  const pictures = new Set<string>()
  for (const page of p.pages) {
    for (const [nodes, inDefs] of [[page.scene.root, false], [page.scene.defs, true]] as const) {
      const frames: { nodes: SrcNode[]; k: number; fit: Value | undefined }[] = [{ nodes, k: 0, fit: first({ op: 'SCENE', attrs: page.scene.header }, 'FIT') }], path: number[] = []
      while (frames.length) {
        const fr = frames[frames.length - 1]
        if (fr.k === fr.nodes.length) { frames.pop(); path.pop(); continue }
        const n = fr.nodes[fr.k]
        path.push(fr.k++)
        if (n.op.toUpperCase() === 'IMG') {
          const src = textOf(first(n, 'SRC'))
          if (src && !pictures.has(src)) {
            pictures.add(src)
            out.push({ level: 'info', message: pictureInfo(src), location: { page: page.id, ref: { inDefs, path: path.slice() }, key: 'src' } })
          }
        }
        if (n.op.toUpperCase() === 'T') {
          const fit = first(n, 'FIT'), keys = ['SIZE']
          if (typeof fit === 'string' && fit.toUpperCase() === 'SHRINK') keys.push('MIN_SIZE')
          // Defaults are inherited rather than this T's own literals, even if an ancestor wrote a number.
          if (fit === undefined && typeof fr.fit === 'string' && fr.fit.toUpperCase() === 'SHRINK' || typeof fit === 'string' && /^[=$]/.test(fit)) uncertainSize = true
          for (const key of keys) {
            const value = first(n, key)
            if (typeof value !== 'number') { uncertainSize = true; continue }
            if (value >= t.geo.floor) continue
            const written = Object.keys(n.attrs).find(k => k.toUpperCase() === key)!
            out.push({ level: 'warning', owner: `page ${page.id} ${inDefs ? 'defs' : 'root'} ${path.join('/')}`,
              message: `written ${written} ${value} is below theme ${t.name}'s ${t.geo.floor}-design-unit text floor`,
              location: { page: page.id, ref: { inDefs, path: path.slice() }, key: written } })
          }
        }
        if (n.c?.length) frames.push({ nodes: n.c, k: 0, fit: first(n, 'FIT') ?? fr.fit })
        else path.pop()
      }
    }
    for (const { uid, el } of nativesOf(page, t)) {
      nativeIds.add(uid)
      if (el.fontSize !== undefined && el.fontSize < t.geo.floor) out.push({ level: 'warning', owner: `page ${page.id} native ${uid}`,
        message: `native fontSize ${el.fontSize} is below theme ${t.name}'s ${t.geo.floor}-design-unit text floor` })
    }
  }
  if (uncertainSize) out.push({ level: 'info', message: 'Static text size checks cover written literal sizes only; dynamic or inherited sizes and rich-text run sizes remain for runtime/TMP checks.' })

  let total = 0
  const states = new Map(p.state.filter(s => s.save !== false).map(s => [s.name, s]))
  const sizes = new Map<string, number>()
  const eventCounts = new Map<string, number>()
  const eventKey = (a: Project['actions'][number]) => a.page === undefined || nativeIds.has(a.on) ? a.on : `${a.page}/${a.on}`
  for (const a of p.actions) { const key = eventKey(a); eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1) }
  const note = (level: Problem['level'], owner: string, message: string) => out.push({ level, owner, message: `${owner}: ${message}` })
  for (const s of states.values()) {
    const key = (s.type === 'string' ? 'vb:t:' : 'vb:s:') + s.name, init = stored(s, s.init), why = limits(key, init)
    sizes.set(s.name, bytes(key) + bytes(init))
    if (why.length) note('warning', `state ${s.name}`, `${why.join('; ')}. Boot only reads; init is not an inevitable saved write. Refusal returns false without raising (measured in game); the runtime warns save failed.`)
  }
  for (const a of p.actions) for (const step of a.do) {
    if (!('state' in step)) continue
    const s = states.get(step.state)
    if (!s) continue
    const key = (s.type === 'string' ? 'vb:t:' : 'vb:s:') + s.name
    const lit = step.op === 'set' ? literal(step.value) : undefined, value = lit && coerce(s, lit.value)
    const text = value === undefined ? undefined : stored(s, value), why = limits(key, text)
    if (text !== undefined) sizes.set(s.name, Math.max(sizes.get(s.name)!, bytes(key) + bytes(text)))
    const proven = eventCounts.get(eventKey(a)) === 1 && a.when === undefined && a.do.length === 1 && step.op === 'set' && value !== undefined && value !== s.init
    if (why.length && proven) note('error', `action ${a.id}`, `when invoked from the declared init of state ${s.name}, this save cannot fit: ${why.join('; ')}. Refusal returns false without raising (measured in game); the runtime warns save failed.`)
    // Bool/number/enum storage is a bounded numeric spelling; only unknown strings can exceed a value limit.
    else if (why.length || text === undefined && s.type === 'string') note('warning', `action ${a.id}`, `a save of ${key} is not proven${why.length ? `: ${why.join('; ')}` : '; the value or change is uncertain'}. Persist allows 128-byte keys and 8192-byte values; guarded, expression or possibly unchanged writes need runtime checks. Refusal returns false without raising (measured in game).`)
  }
  for (const r of p.roles) if (r.mode === 'one' && r.pin === undefined && r.ref === undefined) {
    const key = 'vb:r:' + r.id, why = limits(key, r.label)
    total += bytes(key) + bytes(r.label ?? '')
    note('warning', `role ${r.id}`, `saved choice ${key} includes a device reference and label whose size is unknown${why.length ? `; ${why.join('; ')}` : ''}. Persist allows 128-byte keys and 8192-byte values; this is a possible refusal, not a proven write.`)
  }
  for (const size of sizes.values()) total += size
  if (total > 32768) out.push({ level: 'warning', message: `Speculative saved key+value total ${total} UTF-8 bytes exceeds the documented 32768-byte total (total boundary unprobed in game). Init is not written at boot, choices and future changes are unknown, and stores are shared; this is not inevitable loss.` })
  return out
}
