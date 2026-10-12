// The table form (a vector element's props, as Pairs) to the scene model. src has no map syntax and no Bool, so those
// are rewritten to what the mod reads the same way (the vector parser's ToProps grammar), or dropped with a warning.
import type { Scene, SrcNode, Value } from '../model/scene'
import { GROUP_PAINT_DEFAULTS, HEADER, fieldOf } from '../schema'
import { numberOf, parseSrc } from './parse'
import { foldKey, textOf, type Pairs, type Uv } from './props'

// Paint keys a G may carry as defaults for its subtree, matched exactly (the mod's GroupPaintDefaults).
// `s_` is left out: in a style map it is inherited as `s_`, which no shape reads, while on a G it means stroke colour.
const PAINT = GROUP_PAINT_DEFAULTS.filter(k => k !== 's_')

const get = (m: Pairs, key: string) => m.find(([k]) => foldKey(k) === key)?.[1]
const isMap = (v: Uv | undefined): v is { m: Pairs } => typeof v === 'object' && 'm' in v

export function fromProps(props: Pairs): { scene: Scene; warnings: string[] } {
  const warnings: string[] = []
  const scene: Scene = { header: Object.create(null), defs: [], root: [] }

  // undefined when src cannot hold it (warned). Numeric readers take Bool as 1/0; only shadow field six is inset.
  // Lists nest to any depth with no recursion: each is placed empty and filled when its turn comes on the stack, depth
  // first, so the warnings come in the order the items are met.
  const one = (v: Uv, where: string, sh: boolean, kind?: string, index?: number): Value | undefined => {
    if (typeof v === 'number') return Math.fround(v)
    if (typeof v === 'string') {
      // A quoted numeric string can use a numeric src value only where the reader gives it the same meaning.
      if ((v === 'true' || v === 'false') && (kind === 'N' || kind === 'NL' && index !== undefined || sh && index !== undefined && index < 4)) return v === 'true' ? 1 : 0
      const n = numberOf(v)
      if (n !== undefined && (kind === 'TEXT' ? textOf(n) === v : kind && ['E', 'N', 'P', 'SN', 'L'].includes(kind))) return n
      if (n !== undefined) warnings.push(`${where}: the text "${v}" would read as a number in src; kept as a string`)
      return v
    }
    if ('a' in v) return []
    if ('b' in v) {
      if (sh && index === 5) return v.b ? 'inset' : 0
      if ((sh && index !== undefined && index < 4) || (kind && ['E', 'N', 'P', 'NL', 'SN', 'L'].includes(kind))) return v.b ? 1 : 0
    }
    warnings.push(`${where}: ${'b' in v ? 'a Bool' : 'a map'} cannot be written in src; dropped`)
    return undefined
  }
  const value = (v: Uv, where: string, sh = false, kind?: string): Value | undefined => {
    const top = one(v, where, sh, kind)
    const stack: { from: Uv[]; into: Value[]; i: number }[] = Array.isArray(top) ? [{ from: (v as { a: Uv[] }).a, into: top, i: 0 }] : []
    while (stack.length) {
      const w = stack[stack.length - 1]
      if (w.i === w.from.length) { stack.pop(); continue }
      const index = w.i++, x = w.from[index], y = one(x, where, sh, kind, index)
      if (y === undefined) continue
      w.into.push(y)
      if (Array.isArray(y)) stack.push({ from: (x as { a: Uv[] }).a, into: y, i: 0 })
    }
    return top
  }

  // One key of a node, other than op, c and style.
  const attr = (n: SrcNode, k: string, x: Uv, where: string) => {
    const put = (k: string, x: Value | undefined) => { if (x !== undefined) n.attrs[k] = x }
    const f = foldKey(k), at = `${where}.${k}`
    if (f === 'PARAMS' && isMap(x) && foldKey(n.op) === 'SYM') {
      // In src a SYM's defaults are its own attributes, so its op, id and c are defaults too; a param of that name clashes.
      for (const [p, y] of x.m) {
        if (['ID', 'OP', 'C'].includes(foldKey(p))) warnings.push(`${at}.${p}: a parameter named ${p} clashes with the SYM's own ${p} in src; dropped`)
        else put(p, value(y, `${at}.${p}`))
      }
    } else if ((f === 'F' || f === 'S') && isMap(x)) {
      // { grad = g, at = e } is f=@g fat=e; without `at` the map samples the ramp at 0, so fat=0 keeps that.
      const grad = get(x.m, 'GRAD'), t = get(x.m, 'AT')
      if (typeof grad !== 'string' || !grad) { put(k, 'none'); return }
      put(k, '@' + grad)
      put(f === 'F' ? 'fat' : 'sat', t === undefined ? 0 : value(t, at + '.at'))
    } else put(k, value(x, at, f === 'SH', fieldOf(n.op, k)?.kind))
  }
  // A G's style wins over its own paint keys, as the mod merges them; `s` (stroke colour) is spelled s_ on a G.
  const styled = (n: SrcNode, style: Uv | undefined, where: string) => {
    if (style === undefined || !isMap(style)) return
    for (const [k, x] of style.m) {
      const to = k === 's' ? 's_' : PAINT.includes(k) ? k : undefined
      if (to && foldKey(n.op) === 'G') { const y = value(x, `${where}.style.${k}`, k === 'sh', fieldOf('G', k)?.kind); if (y !== undefined) n.attrs[to] = y }
      else warnings.push(`style.${k} cannot be written in src; dropped`)
    }
  }
  // Nodes nest to any depth with no recursion: a node is placed when it is met and its keys read in order, its children
  // where its c comes (pushed, then the node resumes), so the warnings come in the order they are met.
  type Walk = { list: Uv[]; into: SrcNode[]; where: string; i: number } | { node: SrcNode; m: Pairs; where: string; i: number; style?: Uv }
  const nodes = (v: Uv | undefined, where: string): SrcNode[] => {
    const out: SrcNode[] = []
    const stack: Walk[] = v !== undefined && typeof v === 'object' && 'a' in v ? [{ list: v.a, into: out, where, i: 0 }] : []
    while (stack.length) {
      const w = stack[stack.length - 1]
      if ('list' in w) {
        if (w.i === w.list.length) { stack.pop(); continue }
        const k = w.i++, x = w.list[k], at = `${w.where}[${k}]`
        const op = isMap(x) ? get(x.m, 'OP') : undefined
        if (!isMap(x) || typeof op !== 'string' || !op) { warnings.push(`${at}: not a node map; skipped`); continue }
        const n: SrcNode = { op, attrs: Object.create(null) }
        w.into.push(n)
        stack.push({ node: n, m: x.m, where: at, i: 0 })
      } else if (w.i < w.m.length) {
        const [k, x] = w.m[w.i++], f = foldKey(k)
        if (f === 'C') { if (typeof x === 'object' && 'a' in x) stack.push({ list: x.a, into: w.node.c = [], where: `${w.where}.${k}`, i: 0 }) }
        else if (f === 'STYLE') w.style = x
        else if (f !== 'OP') attr(w.node, k, x, w.where)
      } else {
        stack.pop()
        styled(w.node, w.style, w.where)
      }
    }
    return out
  }

  // The scene's own keys, then the paint defaults its root inherits as a G's children do (ParseStyle on the props, fit
  // aside: on the scene it is the scene's fit), its style winning; other keys belong to the element, not the scene.
  let style: Uv | undefined
  for (const [k, v] of props) {
    const f = foldKey(k)
    if (HEADER.has(f) || PAINT.includes(k) || k === 's_') { const x = value(v, k, k === 'sh', fieldOf('SCENE', k)?.kind); if (x !== undefined) scene.header[k] = x }
    else if (f === 'ROOT') scene.root = nodes(v, k)
    else if (f === 'DEFS') scene.defs = nodes(v, k)
    else if (f === 'STYLE') style = v
  }
  if (style !== undefined && isMap(style))
    for (const [k, x] of style.m) {
      const to = k === 's' ? 's_' : PAINT.includes(k) && k !== 'fit' ? k : undefined
      const y = to && value(x, `style.${k}`, k === 'sh', fieldOf('SCENE', k)?.kind)
      if (to && y !== undefined) scene.header[to] = y
      else if (!to) warnings.push(`style.${k} cannot be written in src; dropped`)
    }
  return { scene, warnings }
}

/** A vector element's props as a scene: its `src` text when it has one, else its table form. Throws if the src does not parse. */
export function sceneOfProps(props: Pairs): Scene {
  const src = props.find(([k]) => foldKey(k) === 'SRC')?.[1]
  if (typeof src !== 'string' || !src) return fromProps(props).scene
  const r = parseSrc(src)
  if (!r.scene) throw new Error('the src does not parse: ' + r.errors.map(e => `${e.line}:${e.col} ${e.message}`).join('; '))
  return r.scene
}
