// What the canvas tools write, per op (spec §4). Pure. Local units are the frame a node's own keys are written in
// (its parent's); a G's handles work in its children's frame. A tool never overwrites an expression or $data value (ruling
// R3): an axis or a key that is not a number (or absent) stays, and says why. A transform that changes nothing gives the
// input node itself, so no empty undo step arises; a value that would leave float32 is never written.
import { boxOf, groupMatrix, keep, round, type Box, type Handle } from '../editor/geometry'
import type { SrcNode, Value } from '../model/scene'
import { nodeAt } from '../model/tree'
import { parsePath, scalePath, translatePath } from '../srctext/path'
import { foldKey } from '../srctext/props'
import { IDENTITY, subtreeBox } from './bounds'
import { replaceAt } from './tree'

export type Wrote = { node: SrcNode; locked?: string }   // node is the input itself when nothing changed

export const FLOAT32 = 'the value left float32'
/** n's first [key, value] whose key folds to K. */
export const entry = (n: SrcNode, K: string) => Object.entries(n.attrs).find(([k]) => foldKey(k) === K)
/** What a tool may replace: a number, or the default when absent; null for anything else. */
const lit = (v: Value | undefined, dflt: number) => typeof v === 'number' ? v : v === undefined ? dflt : null
/** A pair as the mod reads it (SceneModel Pair): absent, or an item past the end, is the default. null when it is not a
 *  list or an item is not a number. The one copy of that rule (ungroup reads it too). */
export const pairOf = (v: Value | undefined, d: number): [number, number] | null => {
  if (v === undefined) return [d, d]
  if (!Array.isArray(v)) return null
  const x = v[0] ?? d, y = v[1] ?? d
  return typeof x === 'number' && typeof y === 'number' ? [x, y] : null
}
/** A group scale as written: a ratio, so 6 significant digits as float32 (3 decimals would make 0.0004 a 0 and step a
 *  small scale coarsely), never -0; a non-finite value stays non-finite, so `sound` refuses it. A value that reads the
 *  same as the one there stays exactly as written (keep's rule). */
const scaleOf = (v: number) => { const r = Math.fround(Number(v.toPrecision(6))); return r === 0 ? 0 : r }
const keepScale = (was: number, v: number) => scaleOf(was) === scaleOf(v) ? was : scaleOf(v)
const pairAt = (n: SrcNode, K: string, d: number) => pairOf(entry(n, K)?.[1], d)
/** v as a list of numbers, or null. */
export const NUMS = (v: Value | undefined) => Array.isArray(v) && v.every(x => typeof x === 'number') ? v as number[] : null
const BOX = new Set(['R', 'T', 'IMG', 'SC']), NO_XY = new Set(['RP', 'LS', 'YS'])
/** The ops whose shape is their `p` list of points (points.tsx edits them one point at a time). */
export const POINTS: ReadonlySet<string> = new Set(['L', 'Y', 'SP'])
const MOVE_XY: Record<string, [string, string]> = { R: ['X', 'Y'], T: ['X', 'Y'], IMG: ['X', 'Y'], SC: ['X', 'Y'], USE: ['X', 'Y'], C: ['CX', 'CY'] }

// Whether `v` is the value there already (a pair or a list item by item).
const sameValue = (was: Value | undefined, v: Value) =>
  was === v || (Array.isArray(was) && Array.isArray(v) && was.length === v.length && was.every((x, i) => x === v[i]))
// Whether a value may be written: every number finite (round's float32 overflow is Infinity), a path `d` that parses.
const sound = (K: string, v: Value) => K === 'D' ? typeof v === 'string' && !('error' in parsePath(v))
  : typeof v === 'number' ? Number.isFinite(v) : !Array.isArray(v) || v.every(x => typeof x !== 'number' || Number.isFinite(x))

/** n with each [K (folded), value] written at its key as written (else K lower-cased, appended); null when a value is
 *  not sound. */
function put(n: SrcNode, values: readonly [string, Value][]): SrcNode | null {
  const attrs = { ...n.attrs }
  for (const [K, v] of values) {
    if (!sound(K, v)) return null
    attrs[Object.keys(attrs).find(k => foldKey(k) === K) ?? K.toLowerCase()] = v
  }
  return { ...n, attrs }
}
/** n with the values that differ from the ones there written (the input itself when none does); `why` says what stayed.
 *  A value that is not sound writes nothing, and says so after `why`. */
const wrote = (n: SrcNode, values: readonly [string, Value][], why?: string): Wrote => {
  const changed = values.filter(([K, v]) => !sameValue(entry(n, K)?.[1], v))
  const node = changed.length ? put(n, changed) : n
  const locked = node ? why : why ? `${why}; ${FLOAT32}` : FLOAT32
  return locked ? { node: node ?? n, locked } : { node: node ?? n }
}

// n's own keys moved by (dx, dy), and the delta its x and y took (an SC's children follow that, not the asked one).
function moveOwn(n: SrcNode, dx: number, dy: number): [Wrote, [number, number]] {
  const op = foldKey(n.op), same = (why: string): [Wrote, [number, number]] => [{ node: n, locked: why }, [0, 0]]
  if (!dx && !dy) return [{ node: n }, [0, 0]]
  if (NO_XY.has(op)) return same('move the enclosing group')
  const xy = MOVE_XY[op]
  if (xy) {
    const out: [string, Value][] = [], why: string[] = [], moved: [number, number] = [0, 0]
    for (const [i, K, d] of [[0, xy[0], dx], [1, xy[1], dy]] as const) {
      if (!d) continue
      const v = lit(entry(n, K)?.[1], 0)
      if (v === null) { why.push(`${K.toLowerCase()} is an expression`); continue }
      const r = keep(v, v + d)
      if (r !== v) { out.push([K, r]); moved[i] = d }
    }
    const w = wrote(n, out, why.join('; ') || undefined)
    return [w, w.node === n ? [0, 0] : moved]
  }
  if (POINTS.has(op)) {
    const p = NUMS(entry(n, 'P')?.[1])
    return p ? [wrote(n, [['P', p.map((v, i) => keep(v, v + (i % 2 ? dy : dx)))]]), [0, 0]] : same('p is not a list of numbers')
  }
  if (op === 'P') {
    const d = entry(n, 'D')?.[1]
    if (typeof d !== 'string' || 'error' in parsePath(d)) return same('d is not a valid path')
    const rx = round(dx), ry = round(dy)
    if (rx === 0 && ry === 0) return [{ node: n }, [0, 0]]   // a move that rounds to nothing keeps the text as written
    const t = translatePath(d, rx, ry)
    return [t === null ? { node: n, locked: FLOAT32 } : wrote(n, [['D', t]]), [0, 0]]
  }
  if (op === 'G') {
    const v = entry(n, 'T')?.[1] ?? [0, 0]
    if (!Array.isArray(v)) return same('t is not a pair')
    const t = [v[0] ?? 0, v[1] ?? 0], why: string[] = []
    for (const [i, d] of [[0, dx], [1, dy]] as const) {
      if (!d) continue
      const x = t[i]
      if (typeof x !== 'number') why.push('t is an expression')
      else t[i] = keep(x, x + d)
    }
    const changed = t[0] !== (v[0] ?? 0) || t[1] !== (v[1] ?? 0)
    return [wrote(n, changed ? [['T', t]] : [], why[0]), [0, 0]]
  }
  return same(`${n.op} does not move`)
}

/** The node moved by (dx, dy) local units, per axis. An SC moves its children with it (they are written in its enclosing
 *  frame), all or none, at any depth of SC inside SC. */
export function moveBy(n: SrcNode, dx: number, dy: number): Wrote {
  const [w, moved] = moveOwn(n, dx, dy)
  if (foldKey(n.op) !== 'SC' || w.node === n || !n.c) return w
  // The SCs being rebuilt, outermost first, each with its children moved so far: an explicit stack, no recursion per level.
  type Open = { w: Wrote; moved: [number, number]; kids: readonly SrcNode[]; done: SrcNode[] }
  const open: Open[] = [{ w, moved, kids: n.c, done: [] }]
  for (;;) {
    const f = open[open.length - 1]
    if (f.done.length === f.kids.length) {
      open.pop()
      const node = { ...f.w.node, c: f.done }
      if (!open.length) return { ...f.w, node }
      open[open.length - 1].done.push(node)
      continue
    }
    const child = f.kids[f.done.length], op = foldKey(child.op), [cw, cm] = moveOwn(child, ...f.moved)
    if (cw.locked) {
      const at = open.map(o => `child ${o.done.length + 1}`).join(': ')
      return { node: n, locked: `${at}: ${NO_XY.has(op) ? `${child.op} has no position of its own: group the SC's children to move them` : cw.locked}` }
    }
    if (op === 'SC' && cw.node !== child && child.c) open.push({ w: cw, moved: cm, kids: child.c, done: [] })
    else f.done.push(cw.node)
  }
}

/** Why a move moves nothing of the node (each axis it has held: an expression, no position of its own, points or a path
 *  that do not read), or null when a move moves something: the padlock, the breadcrumb and the points tool say it. */
export const stays = (n: SrcNode): string | null => { const w = moveBy(n, 1, 1); return w.node === n ? w.locked ?? null : null }

/** The node resized so its handle box (local units; a G: its children's frame) goes from `from` (at the press) to `box`
 *  (signed: a negative w or h is a handle dragged past the opposite side; boxes normalise, points and paths mirror).
 *  centre: `box` was dragged about its centre (Alt), which a circle then keeps. */
export function resizeTo(n: SrcNode, h: Handle, from: Box, box: Box, o: { centre?: boolean } = {}): Wrote {
  const op = foldKey(n.op), same = (why: string): Wrote => ({ node: n, locked: why })
  if (BOX.has(op) || op === 'C') {
    const x = Math.min(box.x, box.x + box.w), y = Math.min(box.y, box.y + box.h), w = Math.abs(box.w), hh = Math.abs(box.h)
    const circle = op === 'C' && !entry(n, 'RY')
    // A circle stays one on a corner (M1): its diameter is the mean of the box's sides, set against the press box's
    // opposite corner on the side the handle went to (Alt: about the box's centre), so that corner stays.
    const d = (w + hh) / 2, axis = (lo: boolean, p: number, s: number, fp: number, fs: number) => {
      const fixed = lo ? fp + fs : fp, moved = lo ? p : p + s
      return fixed + (moved > fixed ? 1 : moved < fixed ? -1 : lo ? -1 : 1) * d / 2
    }
    const values: [string, number][] = BOX.has(op) ? [['X', x], ['Y', y], ['W', w], ['H', hh]]
      : circle && h.length === 2 ? o.centre ? [['CX', x + w / 2], ['CY', y + hh / 2], ['RX', d / 2]]
        : [['CX', axis(h.includes('w'), box.x, box.w, from.x, from.w)], ['CY', axis(h.includes('n'), box.y, box.h, from.y, from.h)], ['RX', d / 2]]
      : [['CX', x + w / 2], ['CY', y + hh / 2], ['RX', w / 2], ['RY', hh / 2]]
    const out: [string, Value][] = []
    // The mod draws nothing for an R, IMG or SC whose w or h is 0 (RectOutline), nor for a C whose rx or ry is (Ellipse-
    // Outline): a drag that writes one leaves a node no press on the canvas can reach again. Any size above 0 is written.
    // A T lays its label out without a box, so it takes 0 too.
    const drawn = op === 'C' ? ['RX', 'RY'] : op === 'T' ? [] : ['W', 'H']
    let rx = 0   // RX as it will read: an absent RY reads as it
    for (const [K, v] of values) {
      const was = lit(entry(n, K)?.[1], K === 'RY' ? rx : 0)
      if (was === null) return same(`${K.toLowerCase()} is an expression`)
      const r = keep(was, v)
      if (r === 0 && was !== 0 && drawn.includes(K)) return same('too small to scale')
      if (K === 'RX') rx = r
      if (circle && K === 'RY' ? r !== rx : r !== was) out.push([K, r])
    }
    return wrote(n, out)
  }
  const k: [number, number] = [from.w ? box.w / from.w : 1, from.h ? box.h / from.h : 1]
  // Points and paths are written to 3 decimals: below this every point rounds onto its neighbours, and nothing could
  // scale them back. A group's s keeps 6 significant digits (scaleOf), so only a singular one refuses it (below).
  if (op !== 'G' && (Math.abs(k[0]) < 1e-6 || Math.abs(k[1]) < 1e-6)) return same('too small to scale')
  const to: [number, number] = [from.w ? box.x : from.x, from.h ? box.y : from.y], f: [number, number] = [from.x, from.y]
  const map = (v: number, i: number) => to[i] + (v - f[i]) * k[i]
  if (POINTS.has(op)) {
    const p = NUMS(entry(n, 'P')?.[1])
    return p ? wrote(n, [['P', p.map((v, i) => keep(v, map(v, i % 2)))]]) : same('p is not a list of numbers')
  }
  if (op === 'P') {
    const d = entry(n, 'D')?.[1], s = typeof d === 'string' ? scalePath(d, k, f, to, (v, was) => keep(was, v)) : null
    return s === null ? same('d is not a valid path') : wrote(n, [['D', s]])
  }
  if (op === 'G') {
    if (entry(n, 'M')) return same('m is set: group it and scale the new group')
    const t = pairAt(n, 'T', 0), s = pairAt(n, 'S', 1), a = pairAt(n, 'A', 0), r = lit(entry(n, 'R')?.[1], 0)
    if (!t || !s || !a || r === null) return same('t, s, a and r must be numbers')
    // (S − S')(p0 − a) = s((to − from k) − (1 − k) a) per axis, p0 the point that stays: no division.
    const v = [0, 1].map(i => s[i] * ((to[i] - f[i] * k[i]) - (1 - k[i]) * a[i]))
    const c = Math.cos(r * Math.PI / 180), sn = Math.sin(r * Math.PI / 180)
    const tt = [keep(t[0], t[0] + c * v[0] - sn * v[1]), keep(t[1], t[1] + sn * v[0] + c * v[1])]
    const ss = [keepScale(s[0], s[0] * k[0]), keepScale(s[1], s[1] * k[1])]
    // A drag writes no scale whose determinant (s0 s1: r turns, m refuses) is at or below the mod's AffineInverse floor
    // (|det| < 1e-12 in Tessellator.cs gives the identity): there the mod draws the group but places its clips and
    // reported positions as if it were unscaled. One written by hand is read as any other (geometry.invert). A 0 (a box
    // dragged flat, or below float32's least value) is the same outright.
    if (!(Math.abs(ss[0] * ss[1]) > 1e-12)) return same('too small to scale')
    const out: [string, Value][] = []
    if (ss[0] !== s[0] || ss[1] !== s[1]) out.push(['S', ss])
    if (tt[0] !== t[0] || tt[1] !== t[1]) out.push(['T', tt])
    return wrote(n, out)
  }
  return same(`${n.op} has no size of its own`)
}

/** Where a node's handles sit (its local units; a G: its children's frame, `resize` false with m), and whether it turns
 *  (a circle shows none); null with no literal box (USE, RP, LS, YS, expression positions, an empty G). A box with no
 *  extent at all (a T with no w or h, an R 0 by 0) offers no resize: its eight handles would sit on one point and take
 *  every press there, so a press moves it. */
export function handlesOf(n: SrcNode): { box: Box; resize: boolean; rotate: boolean } | null {
  const op = foldKey(n.op), extent = (b: Box) => b.w !== 0 || b.h !== 0
  if (op === 'G') {
    const box = n.c ? subtreeBox(n.c, IDENTITY) : null
    return box && groupMatrix(n.attrs) ? { box, resize: !entry(n, 'M') && extent(box), rotate: true } : null
  }
  const box = boxOf(n)
  return box && { box, resize: extent(box), rotate: !(op === 'C' && !entry(n, 'RY')) }
}

/** The r a turn of the node at `path` edits (rotate's choice): a G's own, its turn wrapper's, 0 for a wrapper still to
 *  be made; null where the turn goes into points (L Y SP), or r is not a number. */
export function turnOf(root: SrcNode[], path: number[]): number | null {
  const n = nodeAt(root, path)
  if (!n || POINTS.has(foldKey(n.op))) return null
  const up = path.slice(0, -1), parent = up.length ? nodeAt(root, up) : undefined
  const g = foldKey(n.op) === 'G' ? n : parent && isTurnWrapper(parent) ? parent : null
  return g ? lit(entry(g, 'R')?.[1], 0) : 0
}

/** A G that only turns its one child: keys among a r t, no comments (ruling R4). Later turns edit it. */
export const isTurnWrapper = (g: SrcNode) => foldKey(g.op) === 'G' && g.c?.length === 1 && !g.comments?.length
  && Object.keys(g.attrs).every(k => ['A', 'R', 'T'].includes(foldKey(k))) && groupMatrix(g.attrs) !== null

// A G turned D degrees clockwise about q (its parent frame): r' = r + D, t' = q − a + R(D)(t + a − q).
// The input itself when neither r nor t changes.
function turnGroup(g: SrcNode, D: number, q: { x: number; y: number }): SrcNode | string {
  const t = pairAt(g, 'T', 0), a = pairAt(g, 'A', 0), r = lit(entry(g, 'R')?.[1], 0)
  if (!t || !a || r === null) return 't, a and r must be numbers'
  const c = Math.cos(D * Math.PI / 180), s = Math.sin(D * Math.PI / 180), ux = t[0] + a[0] - q.x, uy = t[1] + a[1] - q.y
  const tt = [keep(t[0], q.x - a[0] + c * ux - s * uy), keep(t[1], q.y - a[1] + s * ux + c * uy)], rr = keep(r, r + D)
  const out: [string, Value][] = []
  if (rr !== r) out.push(['R', rr])
  if (tt[0] !== t[0] || tt[1] !== t[1]) out.push(['T', tt])
  const w = wrote(g, out)
  return w.locked ?? w.node
}

/** The tree with the node at `path` turned D degrees clockwise about q (in the node's local units). G: r and t; L Y SP:
 *  their points; anything else: the turn wrapper around it, or its wrapper turned. The node's path after (one deeper
 *  inside a new wrapper), or why not. A turn that changes nothing gives `root` itself and the same path. */
export function rotate(root: SrcNode[], path: number[], D: number, q: { x: number; y: number }): { root: SrcNode[]; path: number[] } | string {
  const n = nodeAt(root, path)
  if (!n) return 'nothing to turn'
  const op = foldKey(n.op)
  const set = (at: number[], by: SrcNode, after = path) => {
    if (by === nodeAt(root, at)) return { root, path }
    const r = replaceAt(root, at, by)
    return r ? { root: r, path: after } : 'nothing to turn'
  }
  if (op === 'G') { const g = turnGroup(n, D, q); return typeof g === 'string' ? g : set(path, g) }
  if (POINTS.has(op)) {
    const p = NUMS(entry(n, 'P')?.[1])
    if (!p) return 'p is not a list of numbers'
    const c = Math.cos(D * Math.PI / 180), s = Math.sin(D * Math.PI / 180)
    const next = p.map((v, i) => {
      const x = p[i - i % 2] - q.x, y = p[i - i % 2 + 1] - q.y
      return keep(v, i % 2 ? q.y + s * x + c * y : q.x + c * x - s * y)
    })
    const w = wrote(n, [['P', next]])
    return w.locked ?? set(path, w.node)
  }
  const up = path.slice(0, -1), parent = up.length ? nodeAt(root, up) : undefined
  if (parent && isTurnWrapper(parent)) {
    const m = groupMatrix(parent.attrs)!
    const g = turnGroup(parent, D, { x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5] })
    return typeof g === 'string' ? g : set(up, g)
  }
  if (round(D) === 0) return { root, path }   // no wrapper for a turn that rounds to nothing
  const g = put({ op: 'G', attrs: {} }, [['A', [round(q.x), round(q.y)]], ['R', round(D)]])
  return g ? set(path, { ...g, c: [n] }, [...path, 0]) : FLOAT32
}
