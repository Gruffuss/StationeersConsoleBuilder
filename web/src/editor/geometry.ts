// The geometry behind the handles and the boxes (core/vendor/vector/SceneModel.cs and Tessellator.cs): matrices, chains, outlines; the
// writers are editing/transform.ts's. Pure. Local units are the ones a node's attributes are written in, its parent's
// frame; surface px are the page's. +y is down, `r` is clockwise.
import type { Scene, SrcNode, Value } from '../model/scene'
import { flattenPath } from '../srctext/path'
import { foldKey } from '../srctext/props'

export type Mat = [number, number, number, number, number, number]   // x' = a x + c y + e ; y' = b x + d y + f
export type Box = { x: number; y: number; w: number; h: number }      // local units
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const I: Mat = [1, 0, 0, 1, 0, 0]
const T = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]

/** m · n: n applied first. */
export const mul = ([a, b, c, d, e, f]: Mat, [A, B, C, D, E, F]: Mat): Mat =>
  [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]

/** m's inverse, refusing only a singular m: a zero determinant, or one too small to divide by (an entry of the inverse not
 *  finite). The mod draws a group of any scale (G s=[1e-7,1e-7]), so no floor of its own size refuses one: picking, the
 *  chains, the boxes and the moves all read a group by this one rule. */
export function invert([a, b, c, d, e, f]: Mat): Mat | null {
  const det = a * d - b * c, m: Mat = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
  return det && m.every(Number.isFinite) ? m : null
}

export const apply = ([a, b, c, d, e, f]: Mat, x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f]

// The first key equal to K ignoring case, as the mod reads it: [the key as written, its value].
const get = (attrs: Record<string, Value>, K: string) => Object.entries(attrs).find(([k]) => foldKey(k) === K)
// What the mod's Attr reads: a number; a non-empty string is an expression (null here, not editable); else the default.
// A Pair reads each of its first two items the same way.
const num = (v: Value | undefined, dflt: number) => typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? null : dflt
const pair = (v: Value | undefined, dflt: number) => {
  const a = Array.isArray(v) ? v : [], x = num(a[0], dflt), y = num(a[1], dflt)
  return x === null || y === null ? null : [x, y] as const
}
const val = (n: SrcNode, K: string, dflt = 0) => num(get(n.attrs, K)?.[1], dflt)

/** A scene's design size as the mod reads it (SceneModel.cs ViewWidth/ViewHeight): SCENE w and h, at least 1, else 100. */
export function designSize(header: Scene['header']): { w: number; h: number } {
  const size = (K: string) => { const v = get(header, K)?.[1]; return typeof v === 'number' ? Math.max(1, v) : 100 }
  return { w: size('W'), h: size('H') }
}

/** The header's `fit`: contain and cover keep the aspect and centre, anything else stretches. */
export function fitOf(header: Scene['header']): 'contain' | 'cover' | 'stretch' {
  const fit = get(header, 'FIT')?.[1], mode = typeof fit === 'string' ? fit.toLowerCase() : ''
  return mode === 'contain' || mode === 'cover' ? mode : 'stretch'
}

/** Scene units to the element rect, by the header's fit (fitOf). */
export function viewbox(header: Scene['header'], rect: { w: number; h: number }): Mat {
  const { w: W, h: H } = designSize(header), mode = fitOf(header)
  if (mode === 'stretch') return [rect.w / W, 0, 0, rect.h / H, 0, 0]
  const s = (mode === 'contain' ? Math.min : Math.max)(rect.w / W, rect.h / H)
  return [s, 0, 0, s, (rect.w - W * s) / 2, (rect.h - H * s) / 2]
}

/** The viewbox's inverse, surface px to scene units. A viewbox only scales, by a positive factor per axis, and shifts:
 *  it inverts by division, with no determinant floor, which would refuse a design size the mod takes (SCENE w = h = 1e9
 *  on a 460 px page). */
export const unview = (u: Mat): Mat => [1 / u[0], 0, 0, 1 / u[3], -u[4] / u[0], -u[5] / u[3]]

/** A G's local matrix T(t)·T(a)·R(r)·S(s)·M(m)·T(−a); null when one of them is not literal. */
export function groupMatrix(attrs: SrcNode['attrs']): Mat | null {
  const t = pair(get(attrs, 'T')?.[1], 0), s = pair(get(attrs, 'S')?.[1], 1), a = pair(get(attrs, 'A')?.[1], 0)
  const r = num(get(attrs, 'R')?.[1], 0), m = get(attrs, 'M')?.[1]
  if (!t || !s || !a || r === null) return null
  if (m !== undefined && !(Array.isArray(m) && m.length === 6 && m.every(x => typeof x === 'number'))) return null
  const cos = Math.cos(r * Math.PI / 180), sin = Math.sin(r * Math.PI / 180)
  const factors: Mat[] = [T(...t), T(...a), [cos, sin, -sin, cos, 0, 0], [s[0], 0, 0, s[1], 0, 0], (m as Mat | undefined) ?? I, T(-a[0], -a[1])]
  return factors.reduce(mul)
}

/** The matrix a node puts on its block: a G's groupMatrix, a USE's T(x, y) (its own block), the identity for any other
 *  op (an SC's children are in the enclosing coordinates); null when it is not literal. */
export function childMatrix(n: SrcNode): Mat | null {
  const op = foldKey(n.op)
  if (op === 'G') return groupMatrix(n.attrs)
  if (op !== 'USE') return I
  const x = val(n, 'X'), y = val(n, 'Y')
  return x === null || y === null ? null : T(x, y)
}

/** Local units of the node at the root `path` to surface px: the viewbox, then each ancestor (G; USE is T(x, y)). */
export function chainTo(scene: Scene, path: number[], rect: { w: number; h: number }): Mat | null {
  let m = viewbox(scene.header, rect), list = scene.root
  for (const k of path.slice(0, -1)) {
    const n = list[k]
    if (!n) return null
    const local = childMatrix(n)
    if (!local || !invert(local)) return null
    m = mul(m, local)
    list = n.c ?? []
  }
  return m
}

const BOXES = new Set(['R', 'T', 'IMG', 'SC'])

export const bounds = (xy: number[]): Box | null => {
  if (xy.length < 2) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let k = 0; k + 1 < xy.length; k += 2) {
    x0 = Math.min(x0, xy[k]); x1 = Math.max(x1, xy[k])
    y0 = Math.min(y0, xy[k + 1]); y1 = Math.max(y1, xy[k + 1])
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const literalPoints = (n: SrcNode) => {
  const p = get(n.attrs, 'P')?.[1]
  return Array.isArray(p) && p.every(v => typeof v === 'number') ? p as number[] : null
}

/** SP's drawn polyline (Stroke.cs Spline): uniform Catmull-Rom through the points, `seg` samples per span (rounded half
 *  to even as Mathf.RoundToInt, 1..32); closed (more than two points) wraps and does not repeat the first point; open
 *  repeats the end points for the tangents and ends on the last point. */
export function spSamples(p: readonly number[], seg: number, closed: boolean): number[] {
  const n = Math.floor(p.length / 2), out: number[] = [], r = Math.round(seg)
  if (n < 2) return p.slice(0, 2 * n)
  const steps = Math.min(32, Math.max(1, r - seg === 0.5 && r % 2 ? r - 1 : r)), ring = closed && n > 2, spans = ring ? n : n - 1
  const pt = (i: number) => { const k = ring ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1); return [p[2 * k], p[2 * k + 1]] }
  for (let i = 0; i < spans; i++) {
    const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2)
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t
      for (const d of [0, 1]) out.push(0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2
        + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3))
    }
  }
  if (!ring) out.push(p[2 * n - 2], p[2 * n - 1])
  return out
}

/** The node's geometric outline in its local units, one flat x, y list per contour: R T IMG SC the box's corners; L Y the
 *  points; SP the drawn samples; P the flattened subpaths with every curve's and arc's extremes. null for C (its box is
 *  exact from cx cy rx ry), for other ops and for geometry keys that are not literal. An SP whose `seg` or `close` is an
 *  expression is sampled at their defaults (8, open): its points are literal, so it keeps a box, an approximate one. */
export function outline(n: SrcNode): number[][] | null {
  const op = foldKey(n.op)
  if (BOXES.has(op)) { const b = boxOf(n); return b && [[b.x, b.y, b.x + b.w, b.y, b.x + b.w, b.y + b.h, b.x, b.y + b.h]] }
  if (op === 'L' || op === 'Y') { const p = literalPoints(n); return p && [p] }
  if (op === 'SP') { const p = literalPoints(n); return p && [spSamples(p, val(n, 'SEG', 8) ?? 8, (val(n, 'CLOSE', 0) ?? 0) > 0.5)] }
  if (op === 'P') { const d = get(n.attrs, 'D')?.[1]; return typeof d === 'string' ? flattenPath(d) : null }
  return null
}

/** The node's box in local units, w and h >= 0; null for other ops and for a box that is not literal. */
export function boxOf(n: SrcNode): Box | null {
  const op = foldKey(n.op)
  if (BOXES.has(op)) {
    const x = val(n, 'X'), y = val(n, 'Y'), w = val(n, 'W'), h = val(n, 'H')
    return x === null || y === null || w === null || h === null ? null : bounds([x, y, x + w, y + h])
  }
  if (op === 'C') {
    const cx = val(n, 'CX'), cy = val(n, 'CY'), rx = val(n, 'RX'), ry = rx === null ? null : val(n, 'RY', rx)
    return cx === null || cy === null || rx === null || ry === null ? null : bounds([cx - rx, cy - ry, cx + rx, cy + ry])
  }
  const o = outline(n)
  return o ? bounds(o.flat()) : null
}

// A written value: 3 decimals in local units, as float32, never -0. A non-finite value stays non-finite, so a writer
// (editing/transform.ts) refuses it. A value that rounds the same as the one there stays exactly as written; NaN as `was`
// always writes.
export const round = (v: number) => { const r = Math.fround(Math.round(v * 1000) / 1000); return r === 0 ? 0 : r }
export const keep = (was: number, v: number) => round(was) === round(v) ? was : round(v)
