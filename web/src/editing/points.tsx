// Point handles (ruling P4): the own points of an L, Y, SP (its p pairs) or P (its path's points), in the node's local
// units, and the writer that moves one. Pure, plus the overlay that draws them for the points tool.
import { apply, chainTo, keep, outline, round } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt } from '../model/store'
import { movePathPoint, parsePath, pathCross, pathHandles, pathSegments, splitPathSegment, deletePathPoint, setPointMode, isPathAnchor, type Point } from '../srctext/path'
import { first, foldKey } from '../srctext/props'
import { entry, FLOAT32, NUMS as nums, POINTS, stays, type Wrote } from './transform'
import type { Ctx, OverlayCtx, Pt } from './types'

export type { Point }
const REACH = 6   // CSS px
const NONE = 'no such point'

/** Whether the node is a line, polygon, curve or path: an op with points of its own, editable or not. */
export const hasPoints = (n: SrcNode) => { const op = foldKey(n.op); return POINTS.has(op) || op === 'P' }

/** Why a line's, polygon's, curve's or path's points are not edited (pointsOf gives null), in a drag's words. */
export const noPoints = (n: SrcNode) => stays(n) ?? 'no points to edit'

/** Report crossing warnings on the landed geometry, including paint inherited from a group. */
export async function noteCrossing(ctx: Ctx, path: number[]) {
  const page = ctx.page(), scene = page.scene, n = nodeAt(scene.root, path), checker = ctx.checker()
  if (!n || !['P', 'Y'].includes(foldKey(n.op))) return
  if (!checker) return
  const checked = checker.get(scene) ?? await checker.check(scene)
  if (checked.tooLarge || ctx.page().id !== page.id || ctx.page().scene !== scene) return
  const warning = checked.warnings.find(w => w.ref && !w.ref.inDefs && w.ref.path.join() === path.join()
    && w.message.startsWith(`this ${foldKey(n.op)} crosses itself`))
  ctx.note(warning ? 'Warning: ' + warning.message : '')
}

/** The node's own points (local units); null for other ops, or a p that is not all numbers, or a d that does not parse. */
export function pointsOf(n: SrcNode): Point[] | null {
  const op = foldKey(n.op)
  if (POINTS.has(op)) {
    const p = nums(entry(n, 'P')?.[1])
    return p && Array.from({ length: Math.floor(p.length / 2) }, (_, k) => ({ x: p[2 * k], y: p[2 * k + 1] }))
  }
  if (op === 'P') { const d = entry(n, 'D')?.[1]; return typeof d === 'string' ? pathHandles(d) : null }
  return null
}

/** For each of the node's points, the one it takes a coordinate from and moves with (a path's H or V point after it,
 *  pathCross), else -1; empty for a line, polygon or curve. */
export function crossOf(n: SrcNode): number[] {
  const d = foldKey(n.op) === 'P' ? entry(n, 'D')?.[1] : undefined
  return (typeof d === 'string' && pathCross(d)) || []
}

/** n with its point k at (x, y) local units, written as M1 writes numbers (a coordinate that rounds as the one there
 *  stays as written). The input itself when nothing changes. */
export function movePoint(n: SrcNode, k: number, x: number, y: number): Wrote {
  const op = foldKey(n.op), same = (why: string): Wrote => ({ node: n, locked: why })
  if (op === 'P') {
    const e = entry(n, 'D'), d = e?.[1], was = typeof d === 'string' ? pathHandles(d)?.[k] : undefined
    const next = typeof d === 'string' && was ? movePathPoint(d, k, keep(was.x, x), keep(was.y, y), round) : null
    if (next === null) return same(NONE)
    if (next === d) return { node: n }
    // Re-checked as every written d is: a coordinate past float32 prints as Infinity.
    return 'error' in parsePath(next) ? same(FLOAT32) : { node: { ...n, attrs: { ...n.attrs, [e![0]]: next } } }
  }
  const e = POINTS.has(op) ? entry(n, 'P') : undefined, p = nums(e?.[1])
  if (!p || 2 * k + 1 >= p.length) return same(NONE)
  const q = [...p]
  q[2 * k] = keep(p[2 * k], x)
  q[2 * k + 1] = keep(p[2 * k + 1], y)
  if (!q.every(Number.isFinite)) return same(FLOAT32)
  return q[2 * k] === p[2 * k] && q[2 * k + 1] === p[2 * k + 1] ? { node: n } : { node: { ...n, attrs: { ...n.attrs, [e![0]]: q } } }
}

// Use the same sampled Catmull-Rom polyline as the mod and the geometric outline, including its seg/close options.
function splineSegments(n: SrcNode, pts: Pt[]) {
  const samples = outline(n)?.[0] ?? [], count = samples.length/2, close = first(n, 'CLOSE')
  const ring = typeof close === 'number' && close > 0.5 && pts.length > 2, spans = pts.length-(ring ? 0 : 1)
  if (spans < 1 || count < 2) return []
  const steps = (count-(ring ? 0 : 1))/spans
  return Array.from({ length: spans }, (_, segment) => ({ segment, at(t: number): Pt {
    const u = t*steps, j = Math.min(Math.floor(u), steps-1), f = u-j
    const a = (segment*steps+j)%count, b = (a+1)%count
    return { x: samples[2*a]+(samples[2*b]-samples[2*a])*f, y: samples[2*a+1]+(samples[2*b+1]-samples[2*a+1])*f }
  } }))
}

/** Insert a literal point on a drawn path/spline segment or between two list points. */
export function addPoint(n: SrcNode, segment: number, t: number): Wrote {
  const pts = pointsOf(n)
  if (!pts || !Number.isFinite(t) || t <= 0 || t >= 1) return { node: n, locked: noPoints(n) }
  const path = foldKey(n.op) === 'P', e = entry(n, path ? 'D' : 'P')!
  if (path) {
    const d = splitPathSegment(e[1] as string, segment, t)
    return d === null || 'error' in parsePath(d) ? { node: n, locked: 'cannot split this segment' } : { node: { ...n, attrs: { ...n.attrs, [e[0]]: d } } }
  }
  const a = pts[segment], b = pts[segment+1] ?? (foldKey(n.op) === 'Y' || first(n, 'CLOSE') === 1 ? pts[0] : undefined)
  const at = foldKey(n.op) === 'SP' ? splineSegments(n, pts)[segment]?.at(t) : a && b ? { x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t } : null
  if (!at) return { node: n, locked: NONE }
  const list = [...e[1] as number[]], xy = [round(at.x), round(at.y)]
  if (xy.some(x => !Number.isFinite(x))) return { node: n, locked: FLOAT32 }
  list.splice((segment+1)*2, 0, ...xy)
  return { node: { ...n, attrs: { ...n.attrs, [e[0]]: list } } }
}

/** Delete an anchor (null node for an empty shape), or convert a literal path anchor. */
export function editPoint(n: SrcNode, k: number, mode: 'delete' | 'corner' | 'smooth'): { node: SrcNode | null; locked?: string } {
  const pts = pointsOf(n)
  if (!pts?.[k]) return { node: n, locked: noPoints(n) }
  const path = foldKey(n.op) === 'P', e = entry(n, path ? 'D' : 'P')!
  if (path) {
    if (!isPathAnchor(e[1] as string, k)) return { node: n, locked: 'select an anchor, not a control handle' }
    const d = mode === 'delete' ? deletePathPoint(e[1] as string, k) : setPointMode(e[1] as string, k, mode)
    if (d === null) return mode === 'delete' ? { node: null } : { node: n, locked: 'this anchor cannot be converted' }
    if ('error' in parsePath(d)) return { node: n, locked: FLOAT32 }
    return { node: d === e[1] ? n : { ...n, attrs: { ...n.attrs, [e[0]]: d } } }
  }
  if (mode !== 'delete') return { node: n, locked: 'Corner/Smooth applies to P paths' }
  const list = [...e[1] as number[]]; list.splice(k*2, 2)
  return { node: list.length < (foldKey(n.op) === 'Y' ? 6 : 4) ? null : { ...n, attrs: { ...n.attrs, [e[0]]: list } } }
}

/** Closest segment within the point handles' CSS reach, including a closed contour's last edge. */
export function segmentAt(scene: Scene, path: number[], rect: { w: number; h: number }, zoom: number, px: Pt): { segment: number; t: number } | null {
  const n = nodeAt(scene.root, path), W = chainTo(scene, path, rect), pts = n && pointsOf(n)
  if (!n || !W || !pts) return null
  const curves = foldKey(n.op) === 'P' ? pathSegments(first(n, 'D') as string) : foldKey(n.op) === 'SP' ? splineSegments(n, pts) : pts.flatMap((a, i) => {
    const b = pts[i+1] ?? (foldKey(n.op) === 'Y' || first(n, 'CLOSE') === 1 ? pts[0] : undefined)
    return b ? [{ segment: i, at: (t: number) => ({ x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t }) }] : []
  })
  let best: { segment: number; t: number } | null = null, distance = REACH*REACH
  for (const c of curves ?? []) {
    const dist = (t: number) => { const p = c.at(t), [x,y] = apply(W, p.x, p.y); return ((x-px.x)**2+(y-px.y)**2)*zoom*zoom }
    let t = 0, d = Infinity
    for (let j = 0; j <= 64; j++) { const v = dist(j/64); if (v < d) { t = j/64; d = v } }
    if (d > 1e-16) {
      let lo = Math.max(0, t-1/64), hi = Math.min(1, t+1/64)
      for (let j = 0; j < 24; j++) { const a = lo+(hi-lo)/3, b = hi-(hi-lo)/3; if (dist(a) < dist(b)) hi = b; else lo = a }
      t = (lo+hi)/2; d = dist(t)
    }
    if (t > 1e-5 && t < 1-1e-5 && d <= distance) { distance = d; best = { segment: c.segment, t } }
  }
  return best
}

/** The index of the node's point under a surface point (within 6 CSS px; the nearest; of two as near, the first, so the
 *  first point of a closed outline written again last is the one taken), or null. */
export function pointAt(scene: Scene, path: number[], rect: { w: number; h: number }, zoom: number, px: Pt): number | null {
  const n = nodeAt(scene.root, path), pts = n && pointsOf(n), chain = pts && chainTo(scene, path, rect)
  if (!pts || !chain) return null
  let best: number | null = null, reach = REACH
  pts.forEach((q, k) => {
    const [x, y] = apply(chain, q.x, q.y), d = Math.hypot(x - px.x, y - px.y) * zoom
    if (best === null ? d <= reach : d < reach) { reach = d; best = k }
  })
  return best
}

/** The primary selection's points as small circles (an H or V point as a square). */
export function PointHandles({ ctx, o, selected }: { ctx: Ctx; o: OverlayCtx; selected?: number }) {
  const sel = ctx.get().selection, page = ctx.page()
  const n = sel && !sel.inDefs && sel.pageId === page.id ? nodeAt(page.scene.root, sel.path) : undefined
  const pts = n && pointsOf(n), chain = pts && chainTo(page.scene, sel!.path, page.size)
  if (!pts || !chain) return null
  return <svg className="vb-selection" aria-hidden="true">
    {pts.map((q, k) => {
      const [x, y] = apply(chain, q.x, q.y)
      return q.axis ? <rect key={k} className="vb-handle" style={selected === k ? { fill: 'currentColor' } : undefined} x={x * o.zoom - 3} y={y * o.zoom - 3} width={6} height={6} />
        : <circle key={k} className="vb-handle" style={selected === k ? { fill: 'currentColor' } : undefined} cx={x * o.zoom} cy={y * o.zoom} r={4} />
    })}
  </svg>
}
