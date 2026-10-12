// Snapping (spec §4 "Snap", ruling R5), pure. Design units throughout; the caller converts the 8 CSS px threshold and
// rounds what it writes. Per axis: the nearest other node's or the page's edge or centre within the threshold, else the
// grid, else a whole unit. Guides are data the gesture's overlay draws (Guides.tsx).
// ponytail: every move scans every line; sort the lines and binary-search them if a page of thousands of nodes lags.
import type { Box, Handle } from '../editor/geometry'
import { EPS, norm } from './layout'

/** A candidate coordinate on one axis, and the extent on the other axis of what it came from (for the guide). */
export type Line = { at: number; lo: number; hi: number }
export type Targets = { x: Line[]; y: Line[] }
export type SnapOpts = { threshold: number; grid: number }   // design units; grid 0 = off
/** The line x = at from y = from to y = to (axis 'x'), or y = at from x = from to x = to. */
export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number }

/** Values closer than EPS count once (a zero-width box's three edges are one). */
const uniq = (vs: readonly number[]) => vs.filter((v, i) => vs.findIndex(w => Math.abs(w - v) < EPS) === i)

/** Each box gives x0, centre, x1 and y0, middle, y1; the page gives 0, w/2, w and 0, h/2, h. Signed boxes count as
 *  their normalised extent. */
export function targetsOf(boxes: readonly Box[], page: { w: number; h: number }): Targets {
  const x: Line[] = [], y: Line[] = []
  const add = (s: Box) => {
    const b = norm(s)
    for (const at of uniq([b.x, b.x + b.w / 2, b.x + b.w])) x.push({ at, lo: b.y, hi: b.y + b.h })
    for (const at of uniq([b.y, b.y + b.h / 2, b.y + b.h])) y.push({ at, lo: b.x, hi: b.x + b.w })
  }
  for (const b of boxes) add(b)
  add({ x: 0, y: 0, w: page.w, h: page.h })
  return { x, y }
}

/** One axis. values: the moving coordinates, values[0] the anchor (the left or top edge, the dragged edge, the point).
 *  d: the offset to add. The nearest line within the threshold wins (a distance equal to it is within); of two equally
 *  near, the positive offset (ties go up, as Math.round does); every line at the winning offset is a hit, once. With no
 *  hit, the anchor goes to the grid (when on), else to a whole unit. A threshold that is not a number snaps to no line. */
export function snapAxis(values: readonly number[], lines: readonly Line[], o: SnapOpts): { d: number; hits: Line[] } {
  let best = Infinity, d = 0
  const near: { l: Line; e: number }[] = []
  for (const v of uniq(values)) for (const l of lines) {
    const e = l.at - v, dist = Math.abs(e)
    if (!(dist <= o.threshold) || dist > best + EPS) continue
    near.push({ l, e })
    if (dist < best - EPS || e > d + EPS) { best = dist; d = e }
  }
  const hits = near.filter(c => Math.abs(c.e - d) < EPS).map(c => c.l)
  if (hits.length) return { d, hits: hits.filter((l, i) => hits.indexOf(l) === i) }
  const a = values[0], step = Number.isFinite(o.grid) && o.grid > 0 ? o.grid : 1
  return { d: Math.round(a / step) * step - a, hits: [] }
}

/** One guide per line position (lines within EPS merge), spanning its lines and the box `b` (normalised). */
function guidesOf(axis: 'x' | 'y', hits: readonly Line[], b: Box): Guide[] {
  const out: Guide[] = []
  const [lo, hi] = axis === 'x' ? [b.y, b.y + b.h] : [b.x, b.x + b.w]
  for (const l of hits) {
    const g = out.find(g => Math.abs(g.at - l.at) < EPS)
    if (g) { g.from = Math.min(g.from, l.lo); g.to = Math.max(g.to, l.hi) } else out.push({ axis, at: l.at, from: Math.min(l.lo, lo), to: Math.max(l.hi, hi) })
  }
  return out
}

/** Move: the box's left, centre and right, top, middle and bottom. */
export function snapMove(box: Box, t: Targets, o: SnapOpts): { dx: number; dy: number; guides: Guide[] } {
  const b = norm(box)
  const sx = snapAxis([b.x, b.x + b.w / 2, b.x + b.w], t.x, o)
  const sy = snapAxis([b.y, b.y + b.h / 2, b.y + b.h], t.y, o)
  const moved = { ...b, x: b.x + sx.d, y: b.y + sy.d }
  return { dx: sx.d, dy: sy.d, guides: [...guidesOf('x', sx.hits, moved), ...guidesOf('y', sy.hits, moved)] }
}

/** Resize: only the edges the handle drags (a corner both axes, a side one). `box` is the dragged box in design units,
 *  signed as dragBox makes it. dx, dy: what to add to the dragged edges' travel (layout.ts travelOf, which is the
 *  pointer's travel except on the axis dragBox made follow). With ratio, only an object or page line can lead: the axis
 *  with a hit leads (both: the smaller offset), the other follows and gets 0; with no hit on either axis nothing snaps
 *  and there is no lead (dragBox keeps its own, the caller's round keeps the result whole enough). The guides span the
 *  box after the snap (the opposite sides as given: under Alt they also move, which the guides ignore). Never called
 *  for a rotated or sheared chain. */
export function snapResize(box: Box, h: Handle, t: Targets, o: SnapOpts, ratio = false): { dx: number; dy: number; lead?: 'x' | 'y'; guides: Guide[] } {
  const xs = h.includes('w'), ys = h.includes('n')
  const ex = xs ? box.x : h.includes('e') ? box.x + box.w : null
  const ey = ys ? box.y : h.includes('s') ? box.y + box.h : null
  let sx = ex === null ? null : snapAxis([ex], t.x, o), sy = ey === null ? null : snapAxis([ey], t.y, o)
  let lead: 'x' | 'y' | undefined
  if (ratio && sx && sy) {
    const hx = sx.hits.length > 0, hy = sy.hits.length > 0
    if (!hx && !hy) sx = sy = null
    else if (hx && (!hy || Math.abs(sx.d) <= Math.abs(sy.d))) { sy = null; lead = 'x' }
    else { sx = null; lead = 'y' }
  }
  // The box with its dragged edges moved by the snap; with a lead, the follower keeps the dragged box's ratio.
  let b = box
  if (sx) b = xs ? { ...b, x: b.x + sx.d, w: b.w - sx.d } : { ...b, w: b.w + sx.d }
  if (sy) b = ys ? { ...b, y: b.y + sy.d, h: b.h - sy.d } : { ...b, h: b.h + sy.d }
  if (lead === 'x' && box.w) { const n = box.h * b.w / box.w; b = ys ? { ...b, y: b.y + b.h - n, h: n } : { ...b, h: n } }
  if (lead === 'y' && box.h) { const n = box.w * b.h / box.h; b = xs ? { ...b, x: b.x + b.w - n, w: n } : { ...b, w: n } }
  b = norm(b)
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, ...(lead && { lead }),
    guides: [...guidesOf('x', sx?.hits ?? [], b), ...guidesOf('y', sy?.hits ?? [], b)] }
}

/** Draw and points: one point. A coordinate that snapped to a line is that line's exactly. only: the one axis that snaps
 *  (an H or V point moves along one); the other stays as given and draws no guide. */
export function snapPoint(p: { x: number; y: number }, t: Targets, o: SnapOpts, only?: 'x' | 'y'): { p: { x: number; y: number }; guides: Guide[] } {
  const stay: { d: number; hits: Line[] } = { d: 0, hits: [] }
  const sx = only === 'y' ? stay : snapAxis([p.x], t.x, o), sy = only === 'x' ? stay : snapAxis([p.y], t.y, o)
  const q = { x: sx.hits.length ? sx.hits[0].at : p.x + sx.d, y: sy.hits.length ? sy.hits[0].at : p.y + sy.d }
  const at = { x: q.x, y: q.y, w: 0, h: 0 }
  return { p: q, guides: [...guidesOf('x', sx.hits, at), ...guidesOf('y', sy.hits, at)] }
}
