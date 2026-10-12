import { apply, boxOf, invert, round } from '../../editor/geometry'
import { gradientEdit, gradientOf, GRADIENT_KEYS } from '../../editor/GradientFields'
import { withAttr } from '../../editor/fields'
import type { SrcNode } from '../../model/scene'
import { nodeAt } from '../../model/store'
import { fieldOf } from '../../schema'
import { first, foldKey } from '../../srctext/props'
import { sceneDrag } from '../gesture'
import { lockedAt, replaceAt } from '../tree'
import type { Ctx, Pt, Tool } from '../types'

type Handle = { label: string; x: number; y: number; keys: string[] }
function handles(def: SrcNode): Handle[] | null {
  const values: Record<string, number> = {}, op = foldKey(def.op) as keyof typeof GRADIENT_KEYS
  for (const k of GRADIENT_KEYS[op]) {
    const v = first(def, foldKey(k)) ?? (k === 'fx' ? values.cx : k === 'fy' ? values.cy : fieldOf(op, k)?.default ?? 0)
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    values[k] = v
  }
  if (op === 'GL') return [{ label: 'start', x: values.x1, y: values.y1, keys: ['x1', 'y1'] }, { label: 'end', x: values.x2, y: values.y2, keys: ['x2', 'y2'] }]
  const centre = { label: 'centre', x: values.cx, y: values.cy, keys: ['cx', 'cy'] }
  if (op === 'GC') return [centre, { label: 'angle', x: values.a, y: 0, keys: ['a'] }]
  return [centre, { label: 'radius', x: values.cx + values.r, y: values.cy, keys: ['r'] },
    ...(first(def, 'FX') !== undefined || first(def, 'FY') !== undefined ? [{ label: 'focus', x: values.fx, y: values.fy, keys: ['fx', 'fy'] }] : [])]
}
function selected(ctx: Ctx) {
  const sel = ctx.get().selection, scene = ctx.page().scene
  if (!sel || sel.inDefs || sel.pageId !== ctx.page().id) return null
  const node = nodeAt(scene.root, sel.path), W = ctx.view().world(sel.path), inv = W && invert(W)
  return node && W && inv ? { sel, scene, node, W, inv } : null
}
function frame(node: SrcNode, def: SrcNode) {
  if (foldKey(node.op) === 'G') return null
  const bbox = String(first(def, 'UNITS') ?? '').toLowerCase() === 'bbox', box = boxOf(node)
  if (bbox && !box) return null
  const x = bbox ? box!.x : 0, y = bbox ? box!.y : 0
  // Match the core's safe axis for a zero-extent bbox, so a horizontal stroke still has handles.
  const w = bbox && Math.abs(box!.w) >= 0.0001 ? box!.w : 1, h = bbox && Math.abs(box!.h) >= 0.0001 ? box!.h : 1
  return { x, y, w, h, local: (p: Pt) => ({ x: x + p.x * w, y: y + p.y * h }),
    angleLength: box ? Math.max(box.w, box.h) / 2 : 50 }
}
function placed(h: Handle, all: Handle[], f: NonNullable<ReturnType<typeof frame>>) {
  if (h.label !== 'angle') return f.local(h)
  const centre = f.local(all[0]), a = h.x * Math.PI / 180
  return { x: centre.x + Math.sin(a) * f.angleLength, y: centre.y - Math.cos(a) * f.angleLength }
}
const paints = (node: SrcNode) => Object.keys(node.attrs).filter(k => fieldOf(node.op, k)?.type === 'paint')

const gradient: Tool = {
  kind: 'tool', id: 'gradient', label: 'Gradient', order: 2,
  down(p, ctx) {
    const pick = () => {
      const { target, enter } = ctx.pick(p.px, true)
      if (enter) ctx.dispatch(enter)
      ctx.dispatch({ type: 'select', selection: target })
    }
    const chosen = selected(ctx)
    if (!chosen) { pick(); ctx.note('Select a shape with a gradient and a literal transform'); return null }
    const { sel, scene, node, W, inv } = chosen
    if (foldKey(node.op) === 'G') { pick(); ctx.note('Group paints are inherited per painted child; use the gradient fields or select a child with its own gradient'); return null }
    for (const key of paints(node)) {
      const def = gradientOf(scene, node, key), all = def && handles(def), f = def && frame(node, def)
      if (def && !all) { ctx.note('gradient geometry contains an expression; edit it in the catalogue'); continue }
      if (!all || !f) continue
      const point = ctx.view().css(p.at)
      const hit = all.find(h => {
        const local = placed(h, all, f), [x, y] = apply(W, local.x, local.y), css = ctx.view().css({ x, y })
        return Math.hypot(css.x - point.x, css.y - point.y) <= 7
      })
      if (!hit) continue
      if (lockedAt(scene.root, sel.path)) { ctx.note('locked'); return null }
      const original = placed(hit, all, f), centre = f.local(all[0])
      return sceneDrag(ctx, (q, base) => {
        const n = nodeAt(base.root, sel.path)
        if (base !== scene || n !== node || gradientOf(base, n, key) !== def) {
          ctx.note('the scene, node or gradient changed since pointer-down; not applied')
          return null
        }
        const a = apply(inv, q.start.x, q.start.y), b = apply(inv, q.at.x, q.at.y)
        const local = { x: original.x + b[0] - a[0], y: original.y + b[1] - a[1] }
        const gx = (local.x - f.x) / f.w, gy = (local.y - f.y) / f.h
        const values = hit.label === 'radius' ? [Math.hypot(gx - all[0].x, gy - all[0].y)]
          : hit.label === 'angle' ? [(Math.atan2(local.x - centre.x, centre.y - local.y) * 180 / Math.PI + 360) % 360] : [gx, gy]
        const rounded = values.map(round)
        if (!rounded.every(Number.isFinite)) { ctx.note('gradient geometry is outside finite float32'); return null }
        const edit = gradientEdit(base, n, key, d => hit.keys.reduce((made, k, i) => withAttr(made, k, rounded[i]), d))
        const root = edit && replaceAt(base.root, sel.path, edit.node)
        return root && edit ? { scene: { ...base, root, defs: edit.defs } } : null
      })
    }
    pick()
    return null
  },
  overlay(ctx, o) {
    const chosen = selected(ctx)
    if (!chosen) return null
    const { scene, node, W } = chosen
    return <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }} aria-label="Gradient handles">
      {paints(node).map(key => {
        const def = gradientOf(scene, node, key), all = def && handles(def), f = def && frame(node, def)
        if (!all || !f) return null
        const points = all.map(h => { const local = placed(h, all, f), [x, y] = apply(W, local.x, local.y); return o.view.css({ x, y }) })
        return <g key={key} stroke="#ffd166" fill="#0b111b">
          <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} />
          {points.map((p, i) => <circle key={i} aria-label={`Gradient ${key} ${all[i].label}`} cx={p.x} cy={p.y} r={5} />)}
        </g>
      })}
    </svg>
  },
}
export default gradient
