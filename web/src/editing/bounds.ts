// Boxes in design units from the attributes (spec §4): exact, and current while a drag runs (the frame is one
// late). Walks are explicit stacks carrying the matrix: no recursion per level, no path per node.
import { apply, boxOf, bounds, chainTo, designSize, groupMatrix, invert, mul, outline, type Box, type Mat } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt } from '../model/tree'
import { flattenPath } from '../srctext/path'
import { foldKey } from '../srctext/props'
import { first } from './tree'

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** The node's local units to design units (its chain at the design size, where the viewbox is the identity); null when
 *  an ancestor is not literal or singular. */
export const worldOf = (scene: Scene, path: number[]): Mat | null => chainTo(scene, path, designSize(scene.header))

/** m's linear part is a rotation times a uniform scale, a mirror allowed: angles survive it. */
export function similar(m: Mat): boolean {
  const [a, b, c, d] = m, s = a * a + b * b
  return s > 1e-12 && Math.abs(c * c + d * d - s) <= 1e-9 * s && Math.abs(a * c + b * d) <= 1e-9 * s
}

/** `v` literal and at most 0.5: the node and its subtree are not drawn (SceneModel, since 0.11.75 on every op). */
export const hidden = (n: SrcNode) => { const v = first(n, 'V'); return typeof v === 'number' && v <= 0.5 }

const join = (a: Box | null, b: Box | null): Box | null => !a ? b : !b ? a
  : bounds([a.x, a.y, a.x + a.w, a.y + a.h, b.x, b.y, b.x + b.w, b.y + b.h])

// The overlap of two boxes; null when they do not meet.
const meet = (a: Box, b: Box): Box | null => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  return x0 > x1 || y0 > y1 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** n's box through m: C by its exact ellipse half-extents, P by its path flattened through m (curve and arc extremes
 *  along m's axes, so exact through a turn), any other op by its outline's points; null without one. */
export function boundsOf(n: SrcNode, m: Mat): Box | null {
  const op = foldKey(n.op)
  if (op === 'C') {
    const b = boxOf(n)
    if (!b) return null
    const rx = b.w / 2, ry = b.h / 2, [X, Y] = apply(m, b.x + rx, b.y + ry)
    const hx = Math.hypot(m[0] * rx, m[2] * ry), hy = Math.hypot(m[1] * rx, m[3] * ry)
    return { x: X - hx, y: Y - hy, w: 2 * hx, h: 2 * hy }
  }
  if (op === 'P') {
    const d = first(n, 'D'), o = typeof d === 'string' ? flattenPath(d, m) : null
    return o && bounds(o.flat())
  }
  const o = outline(n)
  if (!o) return null
  const xy: number[] = []
  for (const c of o) for (let k = 0; k + 1 < c.length; k += 2) { const [x, y] = apply(m, c[k], c[k + 1]); xy.push(x, y) }
  return bounds(xy)
}

// The box of every visible leaf under `nodes` through the matrix from its frame (m maps `nodes`' frame): a G's children
// through its matrix (a G whose matrix is not literal or singular is passed over, as chainTo refuses it), another block's
// children in the same frame; an SC is a leaf (its viewport), and what is under it is cut to that viewport (it clips its
// content; an axis-aligned cut, so under a turn it can keep a little that the viewport hides) and left out where nothing
// is left. A node with an empty block is a leaf. USE (its body is in defs), hidden subtrees and `skip` (and what is under
// it) left out.
function leafBoxes(nodes: readonly SrcNode[], m: Mat, skip: ReadonlySet<SrcNode> | null, visit: (b: Box) => void) {
  const stack: [SrcNode, Mat, Box | null][] = nodes.map(n => [n, m, null])
  for (let top = stack.pop(); top; top = stack.pop()) {
    const [n, at, clip] = top, op = foldKey(n.op)
    if (hidden(n) || skip?.has(n) || op === 'USE') continue
    if (op === 'G') {
      const g = groupMatrix(n.attrs)
      if (g && invert(g)) for (const c of n.c ?? []) stack.push([c, mul(at, g), clip])
      continue
    }
    const leaf = op === 'SC' || !n.c?.length, own = leaf ? boundsOf(n, at) : null, b = own && clip ? meet(own, clip) : own
    if (b) visit(b)
    if (op === 'SC' && own && !b) continue   // a viewport cut away entirely: nothing under it shows
    const inner = op === 'SC' ? b ?? clip : clip
    for (const c of n.c ?? []) stack.push([c, at, inner])
  }
}

/** The union of the boxes of every visible leaf under `nodes`, through m. */
export function subtreeBox(nodes: readonly SrcNode[], m: Mat): Box | null {
  let u: Box | null = null
  leafBoxes(nodes, m, null, b => { u = join(u, b) })
  return u
}
/** A node's box through m (its parent frame's): an SC its viewport, a leaf its own, any other block its visible leaves'. */
export const nodeBox = (n: SrcNode, m: Mat): Box | null =>
  hidden(n) ? null : foldKey(n.op) === 'SC' || !n.c?.length ? boundsOf(n, m) : subtreeBox([n], m)
/** The box of the node at `path`, in design units. */
export function worldBox(scene: Scene, path: number[]): Box | null {
  const n = nodeAt(scene.root, path), W = n && worldOf(scene, path)
  return n && W ? nodeBox(n, W) : null
}
/** Snap targets: every visible leaf's box at any depth, each root block's own box, and `own`'s nested widget params boxes;
 *  `skip` (the moving set) and what is under it left out, and
 *  a root block holding a node of it (that box moves). */
export function allBoxes(scene: Scene, skip: ReadonlySet<SrcNode>, own?: (k: number, node?: SrcNode) => Box | null): Box[] {
  const out: Box[] = []
  leafBoxes(scene.root, IDENTITY, skip, b => { out.push(b) })
  scene.root.forEach((n, k) => {
    if (!n.c?.length || foldKey(n.op) === 'SC' || hidden(n) || holds(n, skip)) return
    const b = own?.(k, n) ?? nodeBox(n, IDENTITY)
    if (b) out.push(b)
  })
  if (own) {
    const top = new Set(scene.root), stack = [...scene.root]
    for (let n = stack.pop(); n; n = stack.pop()) {
      if (hidden(n) || skip.has(n)) continue
      const b = !top.has(n) && own(-1, n)
      if (b) { if (!holds(n, skip)) out.push(b); continue }
      for (const c of n.c ?? []) stack.push(c)
    }
  }
  return out
}
// Whether `n` or a node under it is in `skip`. An explicit stack.
function holds(n: SrcNode, skip: ReadonlySet<SrcNode>): boolean {
  if (!skip.size) return false
  const stack = [n]
  for (let x = stack.pop(); x; x = stack.pop()) { if (skip.has(x)) return true; for (const c of x.c ?? []) stack.push(c) }
  return false
}
/** Per root node, its box (the marquee's units); null when it has no literal one. */
export const rootBoxes = (scene: Scene): (Box | null)[] => scene.root.map(n => nodeBox(n, IDENTITY))
