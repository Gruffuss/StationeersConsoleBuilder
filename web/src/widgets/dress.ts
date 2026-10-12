// Theme anatomy drawing; the registry and outside-input reader stay out of this leaf's dependency chain.
import type { SrcNode, Value } from '../model/scene'
import type { BoxShape, Corners, Look, Ornament, PartName, Shape, Theme } from '../theme/types'
import { el, num, paintOf, plus, pos, shadow, type At } from './draw'
import { boxOf, keep, round } from '../editor/geometry'
import { translatePath } from '../srctext/path'
import { first, foldKey } from '../srctext/props'

export type PartBox = { x: At; y: At; w: At; h: At }
type Options = { state?: string; ornaments?: false }
type Dressing = { t: Theme; hook: string; box: PartBox; node: SrcNode; o: Options; notes: string[] }
const records = new WeakMap<SrcNode, Dressing>()
const names = new WeakMap<SrcNode, string>()
const primaries = new WeakMap<SrcNode, SrcNode>()
const textAdds = new WeakMap<SrcNode, SrcNode[]>()
const textShapes = new WeakSet<SrcNode>()
export const dressing = (n: SrcNode): Dressing | undefined => records.get(n)
export const hooked = (n: SrcNode): string | undefined => records.get(n)?.hook

/** Naming follows a dressed result's primary and its ornaments, never its wrappers. */
export function namedParts(n: SrcNode, name: string, set: (n: SrcNode, name: string) => void): void {
  const primary = primaries.get(n)
  if (!primary) {
    const at = n.op === 'G' && n.c?.length === 1 && names.has(n.c[0]) ? n.c[0] : n
    const ornament = names.get(at)
    set(at, ornament === undefined ? name : `${name}~${ornament}`); return
  }
  const stack = [n, ...textAdds.get(n) ?? []]
  while (stack.length) {
    const at = stack.pop()!, ornament = names.get(at)
    if (at === primary) set(at, name)
    else if (ornament !== undefined) set(at, `${name}~${ornament}`)
    else for (const child of at.c ?? []) stack.push(child)
  }
}

/** Rebuild only this sibling list's label underlays, keeping their label order and scope. */
export function underLabels(nodes: SrcNode[]): SrcNode[] {
  const clean = nodes.filter(n => !textShapes.has(n)), additions: SrcNode[] = []
  for (const n of clean) for (const ornament of textAdds.get(n) ?? []) additions.push(ornament)
  if (!additions.length) return clean.length === nodes.length ? nodes : clean
  const first = clean.findIndex(n => n.op === 'T')
  return [...clean.slice(0, first), ...additions, ...clean.slice(first)]
}

export function forWidget(t: Theme, type: string): Theme {
  if (!t.anatomy) return t
  const looks: Record<string, Look> = Object.create(null), source = t.anatomy.looks
  for (const k of Object.keys(source)) if (!k.includes('/')) looks[k] = source[k]
  const prefix = type + '/'
  for (const k of Object.keys(source)) if (k.startsWith(prefix)) looks[k.slice(prefix.length)] = source[k]
  return { ...t, anatomy: { v: 1, looks } }
}

export function lin(a: At, k: number, s: At, d: number): At {
  finite(d)
  if (k === 0 || typeof s === 'number') {
    const out = plus(a, finite(k === 0 ? d : k * Number(s) + d))
    return typeof out === 'number' ? finite(out) : out
  }
  if (a === 0 && k === 1 && d === 0) return s
  let out = ''
  const term = (v: string, negative = false) => { out += (negative ? '-' : out ? '+' : '') + v }
  if (typeof a === 'string') term('(' + a.slice(1) + ')')
  else if (a !== 0) term(num(Math.abs(a)), a < 0)
  term((Math.abs(k) === 1 ? '' : num(Math.abs(k)) + '*') + '(' + s.slice(1) + ')', k < 0)
  if (d !== 0) term(num(Math.abs(d)), d < 0)
  return '=' + out
}
const overflow = 'derived geometry is not finite float32'
function finite(n: number): number {
  if (!Number.isFinite(Math.fround(n))) throw new RangeError(overflow)
  return n
}
const size = (a: At, own: At): At => typeof a === 'number' ? pos(a) : a === own ? a : `=max(0,${a.slice(1)})`
function frame(b: PartBox, shape: BoxShape, d: number): PartBox {
  const f = shape.frame ?? { l: [0,0], t: [0,0], r: [1,0], b: [1,0] }
  return { x: lin(b.x, f.l[0], b.w, f.l[1] + d), y: lin(b.y, f.t[0], b.h, f.t[1] + d),
    w: size(lin(0, f.r[0] - f.l[0], b.w, f.r[1] - f.l[1] - 2*d), b.w),
    h: size(lin(0, f.b[0] - f.t[0], b.h, f.b[1] - f.t[1] - 2*d), b.h) }
}
const geometryKeys: Record<string, readonly string[]> = { R: ['x','y','w','h'], C: ['cx','cy','rx','ry'], L: ['p'], Y: ['p'], P: ['d'] }
const paintKeys = new Set(['f','fo','s','so','sw','sh','dash','dofs','cap','join'])
const inset = (outline: string | undefined, width: unknown) => typeof width !== 'number' ? 0
  : width/2 * (outline === 'inside' ? 1 : outline === 'outside' ? -1 : 0)
const unwrap = (n: SrcNode): SrcNode => n.op === 'G' ? n.c![0] : n

function polygon(op: string, points: number[][], b: PartBox, attrs: Record<string, Value | undefined>): SrcNode | undefined {
  for (const point of points) for (const v of point) finite(v)
  const distinct = new Set(points.map(p => p.join(',')))
  if (distinct.size < (attrs.f !== undefined && attrs.f !== 'none' || attrs.sh !== undefined ? 3 : 2)) return
  const p: number[] = []
  let prev: number[] | undefined
  for (const point of points) if (!prev || point[0] !== prev[0] || point[1] !== prev[1]) { p.push(...point); prev = point }
  if (op === 'Y' && p.length > 2 && p[0] === p[p.length-2] && p[1] === p[p.length-1]) p.splice(-2)
  const n = el(op, { v: attrs.v, p, ...attrs })
  return typeof b.x === 'string' || typeof b.y === 'string' ? el('G', { t: [b.x,b.y] }, [n]) : n
}
function drawShape(shape: Shape, b: PartBox, attrs: Record<string, Value | undefined>, d = 0, radius?: number | Corners): SrcNode | undefined {
  if (shape.op === 'poly' || shape.op === 'line') {
    if (typeof b.w !== 'number' || typeof b.h !== 'number') return
    const x = typeof b.x === 'string' || typeof b.y === 'string' ? 0 : b.x
    const y = typeof b.x === 'string' || typeof b.y === 'string' ? 0 : b.y
    return polygon(shape.op === 'line' ? 'L' : 'Y', shape.p.map(([px,py]) => [x + px[0]*Number(b.w)+px[1], y+py[0]*Number(b.h)+py[1]]), b, attrs)
  }
  const f = frame(b, shape, d)
  if (shape.op === 'rect') {
    const r = shape.radius ?? radius
    return el('R', { v: attrs.v, ...f, rx: r === undefined ? undefined : typeof r === 'number' ? pos(finite(r-d)) : r.map(v => pos(finite(v-d))), ...attrs })
  }
  if (shape.op === 'ellipse') return el('C', { v: attrs.v,
    cx: lin(f.x, 0.5, f.w, 0), cy: lin(f.y, 0.5, f.h, 0), rx: size(lin(0, 0.5, f.w, 0), f.w), ry: size(lin(0, 0.5, f.h, 0), f.h), ...attrs })
  if (typeof f.w !== 'number' || typeof f.h !== 'number') return
  const local = typeof b.x === 'string' || typeof b.y === 'string'
  const localFrame = local ? frame({ ...b, x: 0, y: 0 }, shape, d) : f
  const x = Number(localFrame.x), y = Number(localFrame.y), w = f.w, h = f.h
  const c = shape.cut.map(v => pos(finite(v-d*(2-Math.SQRT2))))
  const sums = [[w,c[0]+c[1]], [w,c[3]+c[2]], [h,c[0]+c[3]], [h,c[1]+c[2]]]
  sums.flat().forEach(finite)
  const scale = Math.min(1, ...sums.filter(([,sum]) => sum > 0).map(([side,sum]) => side/sum))
  const [tl,tr,br,bl] = c.map(v => v*scale)
  return polygon('Y', [[x+tl,y],[x+w-tr,y],[x+w,y+tr],[x+w,y+h-br],[x+w-br,y+h],[x+bl,y+h],[x,y+h-bl],[x,y+tl]], b, attrs)
}
function shapeNode(...args: Parameters<typeof drawShape>): SrcNode | undefined {
  const n = drawShape(...args), stack: Value[] = n ? Object.values(unwrap(n).attrs) : []
  while (stack.length) {
    const v = stack.pop()!
    if (typeof v === 'number') finite(v)
    else if (Array.isArray(v)) for (const child of v) stack.push(child)
  }
  return n
}
const lookOf = (t: Theme, hook: string): Look | undefined => t.anatomy && Object.hasOwn(t.anatomy.looks, hook) ? t.anatomy.looks[hook] : undefined

function additions(t: Theme, hook: string, b: PartBox, node: SrcNode, o: Options, notes: string[]): { under: SrcNode[]; over: SrcNode[] } {
  const result: { under: SrcNode[]; over: SrcNode[] } = { under: [], over: [] }, unplaced: string[] = []
  const live = typeof b.w !== 'number' || typeof b.h !== 'number'
  for (const ornament of lookOf(t, hook)?.add ?? []) {
    // Points and corner cuts are placed on a box of known size; on a box whose size follows a value they cannot be.
    if (live && ornament.op !== 'rect' && ornament.op !== 'ellipse') { unplaced.push(ornament.name); continue }
    const paint = (p: Ornament['fill']) => p === 'state' && o.state === undefined ? node.attrs.f : paintOf(t, p, o.state)
    const f = paint(ornament.fill), s = paint(ornament.stroke), filled = f !== undefined && f !== 'none', stroked = s !== undefined && s !== 'none'
    const width = stroked ? ornament.width : undefined
    const n = shapeNode(ornament, b, { v: node.attrs.v, f, fo: filled ? node.attrs.fo : undefined,
      s, sw: width, sh: ornament.shadow ? shadow(t, ornament.shadow) : undefined,
      dash: stroked && ornament.dash ? [...ornament.dash] : undefined, cap: stroked ? ornament.cap : undefined }, inset(ornament.outline, width))
    if (!n) continue
    // A line's attribute order differs from closed shapes and has no fill or shadow.
    if (ornament.op === 'line') {
      const at = unwrap(n), a = at.attrs
      at.attrs = el('L', { v: a.v, p: a.p, s: a.s, sw: a.sw, dash: a.dash, cap: a.cap }).attrs
    }
    names.set(unwrap(n), ornament.name)
    result[ornament.under && !hook.startsWith('text:') ? 'under' : 'over'].push(n)
  }
  if (unplaced.length) notes.push(`${hook}: ornament${unplaced.length > 1 ? 's' : ''} ${unplaced.join(', ')} need${unplaced.length > 1 ? '' : 's'} a fixed-size box; not drawn here`)
  return result
}
function refused(record: Dressing, error: unknown): void {
  if (!(error instanceof RangeError) || error.message !== overflow) throw error
  record.notes.push(`${record.hook}: ${overflow}; look not applied`)
}
export function ornaments(t: Theme, hook: string, box: PartBox, o: { v?: Value; state?: string } = {}): { under: SrcNode[]; over: SrcNode[]; notes: string[] } {
  const node = el('R', { v: o.v })
  const record = { t, hook, box, node, o, notes: [] as string[] }; records.set(node, record)
  try { return { ...additions(t, hook, box, node, o, record.notes), notes: record.notes } }
  catch (error) { refused(record, error); return { under: [], over: [], notes: record.notes } }
}

export function dress(t: Theme, hook: string, box: PartBox, node: SrcNode, o: Options = {}): SrcNode {
  const record = { t, hook, box, node, o, notes: [] as string[] }; records.set(node, record)
  const look = lookOf(t, hook)
  if (!look) return node
  try {
  let primary = node
  if (look.shape === 'none') {
    const keys = new Set(['v', ...geometryKeys[node.op] ?? []])
    primary = el(node.op, Object.fromEntries(Object.entries(node.attrs).filter(([k]) => keys.has(k))))
  } else if (look.shape) {
    const attrs: Record<string, Value> = {}
    if (node.attrs.v !== undefined) attrs.v = node.attrs.v
    for (const [k,v] of Object.entries(node.attrs)) if (paintKeys.has(k)) attrs[k] = v
    const part = hook === 'switch' ? undefined : t.parts[hook as PartName]
    const n = shapeNode(look.shape, box, attrs, inset(part?.outline, node.attrs.s === undefined || node.attrs.s === 'none' ? undefined : node.attrs.sw),
      hook === 'switch' ? node.attrs.rx as number | undefined : part?.radius)
    // A degenerate primary retains its unpainted geometry and semantic name.
    primary = n ?? el(node.op, Object.fromEntries(Object.entries(node.attrs).filter(([k]) => k === 'v' || geometryKeys[node.op]?.includes(k))))
  }
  const { under, over } = o.ornaments === false ? { under: [], over: [] } : additions(t, hook, box, node, o, record.notes)
  if (hook.startsWith('text:')) {
    const ornaments = [...under, ...over]
    textAdds.set(node, ornaments)
    for (const ornament of ornaments) textShapes.add(ornament)
    primaries.set(node, node)
    return node
  }
  const result = under.length || over.length ? el('G', {}, [...under,primary,...over]) : primary
  records.set(result, record); records.set(unwrap(primary), record)
  primaries.set(result, unwrap(primary))
  return result
  } catch (error) { refused(record, error); return node }
}

export function redress(n: SrcNode, dx: number, dy: number, dw: number, dh: number): SrcNode | null {
  const r = records.get(n)
  if (!r) return null
  const node = r.node, op = foldKey(node.op), attrs = { ...node.attrs }
  // The editor writers import the store and registry; keep this module's geometry rules in the leaf.
  const write = (K: string, v: number, drawn = false) => {
    const key = Object.keys(attrs).find(k => foldKey(k) === K) ?? K.toLowerCase(), was = attrs[key] ?? 0
    if (typeof was !== 'number') return false
    const next = keep(was, v)
    if (!Number.isFinite(next) || drawn && next === 0 && was !== 0) return false
    attrs[key] = next
    return true
  }
  if ((dw || dh) && !['R', 'T', 'C'].includes(op)) return null
  if (dw || dh) {
    const b = boxOf(node)
    if (!b) return null
    const x = Math.min(b.x, b.x+b.w+dw), y = Math.min(b.y, b.y+b.h+dh), w = Math.abs(b.w+dw), h = Math.abs(b.h+dh)
    const circle = op === 'C' && first(node, 'RY') === undefined, d = (w+h)/2
    const values = op !== 'C' ? [['X', x], ['Y', y], ['W', w], ['H', h]] as const
      : circle ? [['CX', b.x+(b.w+dw < 0 ? -1 : 1)*d/2], ['CY', b.y+(b.h+dh < 0 ? -1 : 1)*d/2], ['RX', d/2]] as const
        : [['CX', x+w/2], ['CY', y+h/2], ['RX', w/2], ['RY', h/2]] as const
    for (const [K, v] of values) if (!write(K, v, op === 'C' ? K === 'RX' || K === 'RY' : op === 'R' && (K === 'W' || K === 'H'))) return null
  }
  if (dx || dy) {
    if (['R', 'T', 'C'].includes(op)) {
      for (const [K, delta] of [[op === 'C' ? 'CX' : 'X', dx], [op === 'C' ? 'CY' : 'Y', dy]] as const) {
        const was = Object.entries(attrs).find(([k]) => foldKey(k) === K)?.[1] ?? 0
        if (delta && (typeof was !== 'number' || !write(K, was+delta))) return null
      }
    } else if (op === 'L' || op === 'Y') {
      const p = first(node, 'P')
      if (!Array.isArray(p) || !p.every(v => typeof v === 'number')) return null
      const points = (p as number[]).map((v, i) => keep(v, v+(i % 2 ? dy : dx)))
      if (!points.every(Number.isFinite)) return null
      attrs[Object.keys(attrs).find(k => foldKey(k) === 'P') ?? 'p'] = points
    } else if (op === 'G') {
      const t = first(node, 'T') ?? [0, 0]
      if (!Array.isArray(t) || [0, 1].some(i => (i ? dy : dx) && typeof (t[i] ?? 0) !== 'number')) return null
      const moved = [dx ? keep(Number(t[0] ?? 0), Number(t[0] ?? 0)+dx) : t[0] ?? 0,
        dy ? keep(Number(t[1] ?? 0), Number(t[1] ?? 0)+dy) : t[1] ?? 0]
      if (moved.some(v => typeof v === 'number' && !Number.isFinite(v))) return null
      attrs[Object.keys(attrs).find(k => foldKey(k) === 'T') ?? 't'] = moved
    } else if (op === 'P') {
      const d = first(node, 'D'), moved = typeof d === 'string' ? translatePath(d, round(dx), round(dy)) : null
      if (moved === null) return null
      attrs[Object.keys(attrs).find(k => foldKey(k) === 'D') ?? 'd'] = moved
    } else return null
  }
  const b = r.box
  try {
    return dress(r.t, r.hook, { x: lin(b.x, 0, 0, dx), y: lin(b.y, 0, 0, dy),
      w: lin(0, 1, b.w, dw), h: lin(0, 1, b.h, dh) }, { ...node, attrs }, r.o)
  } catch (error) {
    if (error instanceof RangeError && error.message === overflow) return null
    throw error
  }
}
