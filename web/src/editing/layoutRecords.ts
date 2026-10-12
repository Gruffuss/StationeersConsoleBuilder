import { apply, groupMatrix, invert, round, type Box } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt, replaceAt } from '../model/tree'
import { sameData } from '../model/same'
import { shortestFloat } from '../srctext/print'
import { first, foldKey } from '../srctext/props'
import type { Theme } from '../theme'
import { putWidget, sanitize, widgetOf } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import { boundsOf, hidden, IDENTITY, nodeBox, subtreeBox } from './bounds'
import { entry, FLOAT32, moveBy, pairOf, resizeTo } from './transform'
import { isLock, lockedAt } from './tree'

export type Sides = [number, number, number, number]
export type LayoutRecord = { dir: 'row' | 'column'; pad: Sides; gap: number; align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'between'; size: 'fixed' | 'hug'; box: [number, number, number, number] }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(Math.fround(v))
const sides = (v: unknown): v is Sides => Array.isArray(v) && v.length === 4 && v.every(finite)
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hasComment = (c: string, key: string) => key === 'fill' ? c.trim() === 'fill'
  : c.trim().startsWith(key + (key === 'layout' ? ' {' : ' ['))
function commentOf(n: SrcNode, key: string): unknown {
  const found = n.comments?.filter(c => hasComment(c, key)) ?? []
  if (found.length !== 1) return null
  try { return JSON.parse(found[0].trim().slice(key.length)) } catch { return null }
}
export function layoutOf(g: SrcNode): LayoutRecord | null {
  if (foldKey(g.op) !== 'G') return null
  const v = commentOf(g, 'layout'), keys = ['dir', 'pad', 'gap', 'align', 'justify', 'size', 'box']
  if (!isRecord(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) return null
  if (typeof v.dir !== 'string' || !['row', 'column'].includes(v.dir) || typeof v.align !== 'string' || !['start', 'center', 'end', 'stretch'].includes(v.align)
    || typeof v.justify !== 'string' || !['start', 'center', 'end', 'between'].includes(v.justify) || typeof v.size !== 'string' || !['fixed', 'hug'].includes(v.size)
    || !sides(v.pad) || v.pad.some(n => n < 0) || !finite(v.gap) || v.gap < 0 || !sides(v.box) || v.box[2] < 0 || v.box[3] < 0) return null
  return { dir: v.dir as LayoutRecord['dir'], pad: v.pad.map(Math.fround) as Sides, gap: Math.fround(v.gap),
    align: v.align as LayoutRecord['align'], justify: v.justify as LayoutRecord['justify'], size: v.size as LayoutRecord['size'], box: v.box.map(Math.fround) as Sides }
}
function recorded(n: SrcNode, key: string, value: unknown): SrcNode {
  const comments = (n.comments ?? []).filter(c => !hasComment(c, key))
  if (value !== null) {
    const text = key + (value === true ? '' : ' ' + JSON.stringify(value, (_, v) => typeof v === 'number' ? Number(shortestFloat(v)) : v))
    const marker = comments.findIndex(c => c.startsWith('widget '))
    comments.splice(marker < 0 ? comments.length : marker, 0, text)
  }
  if (sameData(comments, n.comments ?? [])) return n
  const { comments: _, ...rest } = n
  return comments.length ? { ...rest, comments } : rest
}
export const withLayout = (n: SrcNode, layout: LayoutRecord | null) => recorded(n, 'layout', layout)
export const marginOf = (n: SrcNode): Sides => {
  const v = commentOf(n, 'margin')
  return sides(v) ? v.map(Math.fround) as Sides : [0, 0, 0, 0]
}
export const withMargin = (n: SrcNode, margin: Sides) => recorded(n, 'margin', margin)
export const fillsBox = (n: SrcNode) => n.comments?.some(c => c.trim() === 'fill') ?? false
export const withFill = (n: SrcNode, fill: boolean) => recorded(n, 'fill', fill ? true : null)

const literalMatrix = (n: SrcNode) => {
  const r = first(n, 'R')
  return (r === undefined || finite(r)) && ([['T', 0], ['S', 1], ['A', 0]] as const).every(([key, d]) =>
    pairOf(first(n, key), d)?.every(finite)) ? groupMatrix(n.attrs) : null
}
function geometry(n: SrcNode, t: Theme) {
  const widget = widgetOf(n, t), layout = layoutOf(n), group = foldKey(n.op) === 'G'
  const matrix = group ? literalMatrix(n) : IDENTITY
  const inner = widget ? widget.params as unknown as Box : layout ? { x: layout.box[0], y: layout.box[1], w: layout.box[2], h: layout.box[3] }
    : group ? subtreeBox(n.c ?? [], IDENTITY) : nodeBox(n, IDENTITY)
  const linear = matrix && [matrix[0], matrix[1], matrix[2], matrix[3], 0, 0] as typeof matrix
  const measured = matrix && invert(matrix) && inner ? group
    ? widget || layout ? boundsOf({ op: 'R', attrs: { ...inner } }, linear!) : subtreeBox(n.c ?? [], linear!)
    : nodeBox(n, IDENTITY) : null
  const box = measured && matrix ? { ...measured, x: measured.x + matrix[4], y: measured.y + matrix[5] } : null
  return { widget, matrix, inner, box }
}
export const layoutBox = (n: SrcNode, t: Theme): Box | null => geometry(n, t).box
type Result = { scene: Scene; skipped: string[] }

// A convex span can fall before it rises: bracket its minimum before bisecting the rising root.
function risingRoot(span: (k: number) => number, target: number, rectangle: boolean): number | null {
  if (rectangle) {
    const base = span(0), slope = span(1) - base, k = (target - base) / slope
    return k > 0 && finite(k) ? Math.fround(k) : null
  }
  let hi = 1
  while (span(hi) < target || span(hi) < span(hi / 2)) {
    hi *= 2
    if (!finite(hi)) return null
  }
  let left = 0, right = hi
  while (Math.fround(left) !== Math.fround(right)) {
    const a = (2 * left + right) / 3, b = (left + 2 * right) / 3
    if (a === left || b === right) break
    if (span(a) <= span(b)) right = b
    else left = a
  }
  let lo = (left + right) / 2
  if (span(lo) > target) return null
  while (Math.fround(lo) !== Math.fround(hi)) {
    const mid = (lo + hi) / 2
    if (mid === lo || mid === hi) break
    if (span(mid) < target) lo = mid
    else hi = mid
  }
  return Math.fround(hi) > 0 ? Math.fround(hi) : null
}

function flowGroup(scene: Scene, g: SrcNode, t: Theme): { node: SrcNode; defs: SrcNode[]; skipped: string[] } {
  const layout = layoutOf(g), skipped: string[] = []
  let defs = scene.defs
  if (!layout || hidden(g) || widgetOf(g, t)) return { node: g, defs, skipped }
  const label = (n: SrcNode, k?: number) => String(first(n, 'ID') ?? `${n.op}${k === undefined ? '' : ' child ' + (k + 1)}`)
  const skip = (n: SrcNode, why: string, k?: number) => skipped.push(`${label(n, k)} skipped: ${why}`)
  const matrix = literalMatrix(g)
  if (g.comments?.some(isLock) || !matrix || !invert(matrix)) {
    skip(g, g.comments?.some(isLock) ? 'locked' : 'transform is not literal or is singular')
    return { node: g, defs, skipped }
  }
  const row = layout.dir === 'row', [pt, pr, pb, pl] = layout.pad
  const children = [...g.c ?? []], flow: { k: number; box: Box; margin: Sides }[] = [], fill: number[] = []
  const writeWidget = (n: SrcNode, params: Box) => {
    const w = widgetOf(n, t)!, rounded = { x: Math.round(params.x), y: Math.round(params.y), w: Math.round(params.w), h: Math.round(params.h) }
    const next = sanitize(WIDGETS[w.type], { ...w.params, ...rounded }, t)
    if (sameData(next, w.params)) return n
    const made = putWidget({ ...scene, defs, root: [n] }, { ...w, params: next }, t)
    defs = made.defs
    return made.root[0]
  }
  const axisOf = (n: SrcNode) => {
    const r = first(n, 'R'), near = Math.abs(Math.cos(Number(r ?? 0) * Math.PI / 180)) >= Math.abs(Math.sin(Number(r ?? 0) * Math.PI / 180))
    return (row ? near : !near) ? 1 : 0
  }
  const diagonal = (n: SrcNode) => { const m = first(n, 'M'); return m === undefined || Array.isArray(m) && m[1] === 0 && m[2] === 0 }
  const stretches = (n: SrcNode) => {
    if (n.comments?.some(isLock) || !diagonal(n)) return false
    const w = widgetOf(n, t)
    return w ? WIDGETS[w.type].resize === 'both' || WIDGETS[w.type].resize === 'width' && axisOf(n) === 0
      : ['R', 'T', 'C'].includes(foldKey(n.op)) || foldKey(n.op) === 'G' && diagonal(n)
  }
  const resize = (n: SrcNode, target: Box, k: number, stretch = false) => {
    const geo = geometry(n, t), { box, inner, matrix } = geo
    if (!box || !inner || !matrix) { skip(n, 'no literal geometry box', k); return n }
    if (stretch && !stretches(n)) { skip(n, diagonal(n) ? 'does not resize on this axis' : 'm is not diagonal', k); return n }
    if (stretch && foldKey(n.op) === 'G') {
      const axis = axisOf(n), s = pairOf(first(n, 'S'), 1)!
      const attrs = { ...n.attrs }
      for (const key of Object.keys(attrs)) if (['S', 'T', 'A'].includes(foldKey(key))) delete attrs[key]
      const span = (value: number) => {
        const scale = [...s]; scale[axis] = value
        const m = groupMatrix({ ...attrs, s: scale })!
        m[4] = m[5] = 0
        const b = geo.widget || layoutOf(n) ? boundsOf({ op: 'R', attrs: { ...inner } }, m) : subtreeBox(n.c ?? [], m)
        return b ? row ? b.h : b.w : Infinity
      }
      const rectangle = !!geo.widget || !!layoutOf(n) || n.c?.length === 1 && ['R', 'T', 'IMG', 'SC'].includes(foldKey(n.c[0].op))
      let value: number | null
      if (geo.widget) {
        const key = axis === 0 ? 'w' : 'h', weights = row ? [Math.abs(matrix[1]), Math.abs(matrix[3])] : [Math.abs(matrix[0]), Math.abs(matrix[2])]
        const origin = axis === 0 ? weights[1] * inner.h : weights[0] * inner.w, slope = weights[axis]
        value = ((row ? target.h : target.w) - origin) / slope
        if (!(value > 0) || !finite(value)) value = null
        if (value !== null) return writeWidget(n, { ...inner, [key]: value })
      } else value = risingRoot(span, row ? target.h : target.w, !!rectangle)
      if (value === null) { skip(n, 'cannot reach the stretch target', k); return n }
      const scale = [...s]; scale[axis] = Math.fround(Number(value.toPrecision(6)))
      if (!scale.every(finite) || !(Math.abs(scale[0] * scale[1]) > 1e-12)) { skip(n, FLOAT32, k); return n }
      if (scale[axis] === s[axis]) return n
      return { ...n, attrs: { ...n.attrs, [entry(n, 'S')?.[0] ?? 's']: scale } }
    }
    if (box.w === target.w && box.h === target.h && !geo.widget) return n
    let to = target
    if (foldKey(n.op) === 'G') {
      const [a, b, c, d] = matrix.map(Math.abs), det = a * d - b * c
      if (Math.abs(det) < 1e-12) { skip(n, 'cannot stretch this transformed box independently', k); return n }
      to = { ...inner, w: (d * target.w - c * target.h) / det, h: (a * target.h - b * target.w) / det }
      if (to.w < 0 || to.h < 0) { skip(n, 'cannot stretch this transformed box independently', k); return n }
    }
    if (![to.x, to.y, to.w, to.h].every(finite)) { skip(n, FLOAT32, k); return n }
    if (geo.widget) {
      const m = WIDGETS[geo.widget.type]
      if (m.resize === 'none' || m.resize === 'width' && to.h !== inner.h) { skip(n, 'widget does not resize on this axis', k); return n }
      return writeWidget(n, { ...inner, w: Math.round(to.w), h: Math.round(to.h) })
    }
    const result = resizeTo(n, row ? 's' : 'e', inner, to)
    if (result.locked) { skip(n, result.locked, k); return n }
    return result.node
  }
  for (let k = 0; k < children.length; k++) {
    let n = children[k]
    if (hidden(n)) continue
    if (fillsBox(n)) { fill.push(k); continue }
    if (!n.comments?.some(isLock) && widgetOf(n, t) && geometry(n, t).box)
      children[k] = n = writeWidget(n, geometry(n, t).inner!)
    const margin = marginOf(n), geo = geometry(n, t)
    if (!geo.box) { skip(n, 'no literal geometry box (expression or singular transform)', k); continue }
    const locked = n.comments?.some(isLock)
    if (locked) skip(n, 'locked', k)
    flow.push({ k, margin, box: geo.box })
  }
  const main = (b: Box) => row ? b.w : b.h, cross = (b: Box) => row ? b.h : b.w
  const lead = (m: Sides) => row ? m[3] : m[0], trail = (m: Sides) => row ? m[1] : m[2]
  const crossLead = (m: Sides) => row ? m[0] : m[3], crossTrail = (m: Sides) => row ? m[2] : m[1]
  const runOf = () => flow.reduce((sum, f) => sum + lead(f.margin) + main(f.box) + trail(f.margin), 0) + Math.max(0, flow.length - 1) * layout.gap
  const wideOf = (items = flow) => items.reduce((max, f) => Math.max(max, crossLead(f.margin) + cross(f.box) + crossTrail(f.margin)), 0)
  let run = runOf(), wide = wideOf()
  const natural = layout.align === 'stretch' ? flow.filter(f => !stretches(children[f.k])) : flow
  const hugCross = natural.length ? wideOf(natural) + (row ? pt + pb : pl + pr) : row ? layout.box[3] : layout.box[2]
  const boxOfRun = (): Sides => layout.size === 'hug'
    ? [layout.box[0], layout.box[1], Math.max(0, row ? run + pl + pr : hugCross), Math.max(0, row ? hugCross : run + pt + pb)].map(round) as Sides : layout.box
  let box = boxOfRun()
  if (layout.align === 'stretch') {
    for (const f of flow) {
      if (children[f.k].comments?.some(isLock)) continue
      const available = (row ? box[3] - pt - pb : box[2] - pl - pr) - crossLead(f.margin) - crossTrail(f.margin)
      children[f.k] = resize(children[f.k], { ...f.box, ...(row ? { h: Math.max(0, available) } : { w: Math.max(0, available) }) }, f.k, true)
      f.box = geometry(children[f.k], t).box!
    }
    run = runOf(); wide = wideOf(); box = boxOfRun()
  }
  if (![...box, run, wide, box[0] + box[2], box[1] + box[3]].every(finite)) {
    skip(g, FLOAT32); return { node: g, defs: scene.defs, skipped }
  }
  for (const k of fill) {
    if (children[k].comments?.some(isLock)) { skip(children[k], 'locked', k); continue }
    children[k] = resize(children[k], { x: box[0], y: box[1], w: box[2], h: box[3] }, k)
  }
  const available = (row ? box[2] - pl - pr : box[3] - pt - pb), free = available - run
  const gap = layout.justify === 'between' && flow.length > 1 ? layout.gap + Math.max(0, free) / (flow.length - 1) : layout.gap
  let at = (row ? box[0] + pl : box[1] + pt) + (layout.justify === 'center' ? free / 2 : layout.justify === 'end' ? free : 0)
  const place = (k: number, x: number, y: number) => {
    const n = children[k], geo = geometry(n, t)
    if (n.comments?.some(isLock)) return
    if (!geo.box || !geo.matrix) { skip(n, 'no literal geometry box', k); return }
    const dx = x - geo.box.x, dy = y - geo.box.y
    if (!dx && !dy) return
    if (geo.widget) {
      const inv = invert(geo.matrix)!, [mx, my] = apply([inv[0], inv[1], inv[2], inv[3], 0, 0], dx, dy)
      const p = geo.inner!, moved = { ...p, x: Math.round(p.x + mx), y: Math.round(p.y + my) }
      if (![moved.x, moved.y].every(finite)) return skip(n, FLOAT32, k)
      children[k] = writeWidget(n, moved)
    } else {
      const result = moveBy(n, dx, dy)
      if (result.locked) skip(n, result.locked, k)
      else children[k] = result.node
    }
  }
  for (const f of flow) {
    const c = (row ? box[3] - pt - pb : box[2] - pl - pr) - crossLead(f.margin) - crossTrail(f.margin) - cross(f.box)
    at += lead(f.margin)
    const across = (row ? box[1] + pt : box[0] + pl) + crossLead(f.margin) + (layout.align === 'center' ? c / 2 : layout.align === 'end' ? c : 0)
    place(f.k, row ? at : across, row ? across : at)
    at += main(f.box) + trail(f.margin) + gap
  }
  for (const k of fill) {
    place(k, box[0], box[1])
  }
  const changed = children.some((n, k) => n !== g.c?.[k])
  let node = changed ? { ...g, c: children } : g
  if (!sameData(box, layout.box)) node = withLayout(node, { ...layout, box })
  return { node, defs, skipped }
}

export function reflow(scene: Scene, path: number[], t: Theme): Result {
  const g = nodeAt(scene.root, path)
  if (!g || !layoutOf(g) || widgetOf(g, t)) return { scene, skipped: [] }
  if (lockedAt(scene.root, path)) return { scene, skipped: [`${String(first(g, 'ID') ?? g.op)} skipped: locked`] }
  const r = flowGroup(scene, g, t)
  return { scene: r.node === g ? scene : { ...scene, defs: r.defs, root: replaceAt(scene.root, path, r.node)! }, skipped: r.skipped }
}

/** Editor changes flow from the innermost container out. Unchanged subtrees and widget interiors stay untouched. */
export function reflowEdits(before: Scene, after: Scene, t: Theme): Result {
  type Frame = { nodes: SrcNode[]; old: SrcNode[]; done: SrcNode[]; node?: SrcNode; was?: SrcNode }
  const stack: Frame[] = [{ nodes: after.root, old: before.root, done: [] }], skipped: string[] = []
  let defs = after.defs, root = after.root
  const finish = (n: SrcNode, was?: SrcNode) => {
    if (n === was || !layoutOf(n) || widgetOf(n, t)) return n
    const r = flowGroup({ ...after, defs }, n, t)
    defs = r.defs; skipped.push(...r.skipped)
    n.c?.forEach((child, k) => {
      const old = was?.c?.[k], placed = r.node.c?.[k]
      if (!old || !placed || old.op !== child.op || first(old, 'ID') !== first(child, 'ID')) return
      const a = geometry(old, t).box, b = geometry(child, t).box, c = geometry(placed, t).box
      if (a && b && c && a.w === b.w && a.h === b.h && (a.x !== b.x || a.y !== b.y) && (b.x !== c.x || b.y !== c.y))
        skipped.push('layout positions its children; reorder them in the layers panel')
    })
    return r.node
  }
  while (stack.length) {
    const f = stack[stack.length - 1]
    if (f.done.length === f.nodes.length) {
      stack.pop()
      if (!f.node) { root = f.done.every((n, k) => n === after.root[k]) ? after.root : f.done; break }
      const n = f.done.every((n, k) => n === f.node!.c![k]) ? f.node : { ...f.node, c: f.done }
      stack[stack.length - 1].done.push(finish(n, f.was))
      continue
    }
    const k = f.done.length, n = f.nodes[k], was = f.old[k]
    const m = foldKey(n.op) === 'G' ? literalMatrix(n) : IDENTITY
    if (n !== was && n.c && !widgetOf(n, t) && !hidden(n) && !n.comments?.some(isLock) && m && invert(m))
      stack.push({ nodes: n.c, old: was?.c ?? [], done: [], node: n, was })
    else f.done.push(finish(n, was))
  }
  return { scene: root === after.root && defs === after.defs ? after : { ...after, root, defs }, skipped: [...new Set(skipped)] }
}
