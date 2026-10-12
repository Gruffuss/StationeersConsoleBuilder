// Applying and reading overrides does not depend on widget expansion or edit extraction.
import { boxOf } from '../editor/geometry'
import { withAttr } from '../editor/fields'
import { isStyle } from '../editing/style'
import { editAt, editList } from '../editing/tree'
import { moveBy, resizeTo } from '../editing/transform'
import { KNOWN_OPS } from '../model/numbering'
import type { SrcNode, Value } from '../model/scene'
import { foldKey } from '../srctext/props'
import { fieldOf, type Field } from '../schema'
import { numberOf } from '../srctext/parse'
import { colourProblem, isColour } from '../srctext/validate'
import { dressing, redress, underLabels } from './dress'
import { tag, tagOf } from './paint'
import type { PartEdit, WidgetEdit } from './types'

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(Math.fround(v))
const offsets = ['dx', 'dy', 'dw', 'dh'] as const
const style = (k: string) => [...KNOWN_OPS].some(op => isStyle(op, k))
const readable = (f: Field, v: unknown): boolean => {
  const numeric = (x: unknown) => finite(x) || typeof x === 'string' && (
    finite(numberOf(x)) || ['E', 'L', 'P'].includes(f.kind) && /^[=$].+/.test(x)
    || f.kind === 'E' && (x === 'true' || x === 'false'))
  switch (f.type) {
    case 'num': case 'int': case 'flag':
      return Array.isArray(v) ? ['RX', 'RY'].includes(foldKey(f.key)) && v.every(numeric) : numeric(v)
    case 'colour': return typeof v === 'string' && isColour(v)
    case 'paint': return typeof v === 'string' && (v === '' || isColour(v) || /^[@$].+/.test(v) || v[0] === '=' && !colourProblem(v))
    case 'enum': return typeof v === 'string' && [...f.enum!, ...Object.keys(f.alias ?? {})].some(x => foldKey(x) === foldKey(v))
    case 'numlist': return Array.isArray(v) && v.every(finite)
    case 'pair': return Array.isArray(v) && v.length === 2 && v.every(numeric)
    case 'shadow': {
      const shadow = (x: unknown) => Array.isArray(x) && x.length >= 5 && x.slice(0, 4).every(finite)
        && typeof x[4] === 'string' && isColour(x[4]) && (x.length === 5 || x.length === 6 && typeof x[5] === 'string' && foldKey(x[5]) === 'INSET')
      return shadow(v) || Array.isArray(v) && v.every(shadow)
    }
    default: return typeof v === 'string' || f.kind === 'SN' && finite(v)
  }
}
// Values cross the marker trust boundary; a cycle is rejected without recursing into lists.
export function value(v: unknown): Value | undefined {
  const scalar = (x: unknown) => finite(x) ? Math.fround(x) + 0 : typeof x === 'string' && !x.includes('\r') ? x : undefined
  if (!Array.isArray(v)) return scalar(v)
  const out: Value[] = [], active = new Set<unknown>(), stack = [{ from: v, to: out, i: 0 }]
  active.add(v)
  while (stack.length) {
    const f = stack[stack.length - 1]
    if (f.i === f.from.length) { active.delete(f.from); stack.pop(); continue }
    const x: unknown = f.from[f.i++]
    if (Array.isArray(x)) {
      if (active.has(x)) return undefined
      const to: Value[] = []; f.to.push(to); active.add(x); stack.push({ from: x, to, i: 0 })
    } else { const y = scalar(x); if (y === undefined) return undefined; f.to.push(y) }
  }
  return out
}
export function sanitizeEdit(v: unknown, dropped?: string[]): WidgetEdit | undefined {
  if (!object(v) || v.v !== 1 || !object(v.parts)) return undefined
  const parts: Record<string, PartEdit> = Object.create(null)
  for (const [name, raw] of Object.entries(v.parts)) {
    if (!name || !object(raw)) continue
    const part: PartEdit = {}, attrs: Record<string, Value | null> = Object.create(null)
    if (object(raw.attrs)) for (const [k, x] of Object.entries(raw.attrs)) {
      const visibility = foldKey(k) === 'V'
      if (!visibility && !style(k)) continue
      if (!visibility && x !== null && ![...KNOWN_OPS].some(op => isStyle(op, k) && readable(fieldOf(op, k)!, x))) {
        dropped?.push(`${name}.${k}`); continue
      }
      const y = x === null ? null : visibility ? x === 0 || x === 1 ? x : undefined : value(x)
      if (y !== undefined) attrs[k] = y
      else dropped?.push(`${name}.${k}`)
    }
    if (Object.keys(attrs).length) part.attrs = attrs
    for (const k of offsets) if (finite(raw[k]) && raw[k] !== 0) part[k] = Math.fround(raw[k]) + 0
    if (Object.keys(part).length) parts[name] = part
  }
  const root: NonNullable<WidgetEdit['root']> = {}
  if (object(v.root)) {
    if (v.root.v === 0 || v.root.v === 1) root.v = v.root.v
    for (const k of ['o', 'r'] as const) if (finite(v.root[k])) root[k] = Math.fround(v.root[k]) + 0
    const a = v.root.a
    if (Array.isArray(a) && a.length === 2 && a.every(finite)) root.a = a.map(x => Math.fround(x) + 0) as [number, number]
  }
  return Object.keys(parts).length || Object.keys(root).length ? { v: 1, parts, ...(Object.keys(root).length ? { root } : {}) } : undefined
}
export function applyEdit(nodes: SrcNode[], parts: Record<string, number[]>, raw: WidgetEdit) {
  const e = sanitizeEdit(raw), dormant: string[] = [], names: string[] = [], paths: number[][] = []
  const dormantReasons: Record<string, string> = Object.create(null)
  if (!e) return { nodes, dormant, dormantReasons }
  const redressed = new Set<string>(), refused = new Set<string>()
  const notes = new Set<string>()
  const reject = (name: string, p: PartEdit, keys: readonly typeof offsets[number][], why: string) => {
    for (const k of keys) if (p[k]) { const key = `${name}.${k}`; dormant.push(key); dormantReasons[key] = why }
  }
  const at = (path: number[]) => { let n: SrcNode | undefined; let list = nodes; for (const i of path) { n = list[i]; list = n?.c ?? [] }; return n }
  for (const [name, p] of Object.entries(e.parts)) {
    if (name.includes('~') || !(p.dx || p.dy || p.dw || p.dh) || !Object.hasOwn(parts, name)) continue
    const path = parts[name], record = dressing(at(path)!), candidates = path.map((_, i) => path.slice(0, i+1))
    const looks = record?.t.anatomy?.looks, look = looks && Object.hasOwn(looks, record.hook) ? looks[record.hook] : undefined
    if (!look || look.shape === undefined && !look.add?.length) continue
    const result = candidates.find(path => { const n = at(path); return n && record && dressing(n)?.node === record.node })
    if (!result) continue
    const rebuilt = redress(at(result)!, p.dx ?? 0, p.dy ?? 0, p.dw ?? 0, p.dh ?? 0)
    if (!rebuilt) {
      refused.add(name)
      reject(name, p, offsets, 'geometry is an expression or cannot take this delta')
      continue
    }
    redressed.add(name)
    dressing(rebuilt)?.notes.forEach(note => notes.add(note))
    nodes = editAt(nodes, [result], () => tag(name, rebuilt))
    if (record?.hook.startsWith('text:')) nodes = editList(nodes, result.slice(0,-1), underLabels)!
    // Dressing can change the wrapper paths; refresh the map before any attrs land.
    for (const key of Object.keys(parts)) delete parts[key]
    const stack = nodes.map((n, i) => ({ n, path: [i] })).reverse()
    while (stack.length) {
      const { n, path } = stack.pop()!, name = tagOf(n)
      if (name !== undefined) parts[name] = path
      for (let i = (n.c?.length ?? 0)-1; i >= 0; i--) stack.push({ n: n.c![i], path: [...path, i] })
    }
  }
  for (const name of Object.keys(e.parts)) {
    if (!Object.hasOwn(parts, name)) dormant.push(name)
    else { names.push(name); paths.push(parts[name]) }
  }
  return { dormant, dormantReasons, notes: [...notes], nodes: editAt(nodes, paths, (n, i) => {
    const p = e.parts[names[i]], op = foldKey(n.op)
    for (const [k, v] of Object.entries(p.attrs ?? {})) {
      if (fieldOf(op, k) && (isStyle(op, k) || foldKey(k) === 'V')) n = withAttr(n, k, v ?? undefined)
      else dormant.push(`${names[i]}.${k}`)
    }
    if (names[i].includes('~')) {
      for (const k of offsets) if (p[k]) dormant.push(`${names[i]}.${k}`)
      return n
    }
    if (redressed.has(names[i]) || refused.has(names[i])) return n
    if (p.dw || p.dh) {
      const b = boxOf(n)
      if (b && ['R', 'T', 'C'].includes(op)) {
        const wrote = resizeTo(n, 'se', b, { ...b, w: b.w + (p.dw ?? 0), h: b.h + (p.dh ?? 0) })
        if (!wrote.locked) n = wrote.node
        else reject(names[i], p, ['dw', 'dh'], wrote.locked)
      } else reject(names[i], p, ['dw', 'dh'], 'geometry is an expression or this shape cannot resize')
    }
    if (p.dx || p.dy) {
      const wrote = ['R', 'T', 'C', 'L', 'Y', 'G'].includes(op) ? moveBy(n, p.dx ?? 0, p.dy ?? 0) : { node: n, locked: 'this shape cannot move' }
      if (!wrote.locked) n = wrote.node
      else reject(names[i], p, ['dx', 'dy'], wrote.locked)
    }
    return n
  }) }
}
