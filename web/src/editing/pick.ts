// What a press on the canvas picks (spec §3 Selection; M1's selection gaps; rulings P5, P6, P7, R7): the frame's topmost
// label or triangle under the point, in the game's order when the scene interleaves text; a label paired with its T,
// the frame's own when its box fits the label, else by geometry; where nothing visible is hit, the smallest closed shape
// with its own fill or stroke, T or IMG whose outline holds the point, inside every SC viewport and G clip above it. A
// node under # lock is never picked. Walks are explicit stacks carrying the matrix; a path is a chain of cells, made into
// an array once, for the winner.
//
// The numbering and the frame: App hands pickNode the numbering only while the scene the frame shown was drawn from has
// the current scene's shape (ctx.sameNumbering). The bridge hands each frame that scene (Frame.drawnFrom: what the page's
// surface was last loaded or patched with when the frame was asked for), so a frame drawn from a tree of another shape is
// never read through the new numbering: while any page has a check error, is too large to check here or waits for its
// check (nothing is sent), and after a structural edit, an undo or a load until a frame asked for after its patch or load
// arrives. A press then names nothing drawn (merge gate F3: it named the node that now held the old index). A label hit
// stays right there when the T the numbering names does not fit the label (it falls to geometry), unless two Ts share
// the label's box.
// Known limits: an SC's rounded corners and a CP's (an R by its box) are not cut; an SC is taken at rest (scroll 0).
import { SCENE_ELEMENT } from '../codegen/lua'
import { apply, bounds, boxOf, chainTo, childMatrix, invert, mul, outline, unview, viewbox, type Box, type Mat } from '../editor/geometry'
import { inside, pickUnder, selectableNode, ztextOf, type Hit } from '../editor/hitTest'
import { pathOfIndex, type Order } from '../model/numbering'
import type { Page } from '../model/project'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt, type Selection } from '../model/store'
import type { Frame, FrameText } from '../runtime/frame'
import { foldKey } from '../srctext/props'
import { hidden, IDENTITY } from './bounds'
import { first, isLock, lockedAt } from './tree'
import type { Pt } from './types'

// A path as a chain of cells, innermost first: remembering one costs O(1), whatever its depth.
type Cell = { k: number; up: Cell | null }
const pathOf = (c: Cell | null): number[] => { const p: number[] = []; for (; c; c = c.up) p.push(c.k); return p.reverse() }

// Every node under the root in pre-order with its local -> `start` matrix, that matrix's inverse when `startInv` is given
// (carried level by level, each G's own, so a deep chain of small scales is never refused over the product), and its
// path's cell. `visit` returns false to leave the node's block out. A hidden or locked node's subtree, and the block of a
// node whose matrix is not literal or singular, are passed over; a USE's own block is in T(x, y), as chainTo has it.
function walk(scene: Scene, start: Mat, startInv: Mat | null, visit: (n: SrcNode, m: Mat, inv: Mat | null, at: Cell) => boolean | void) {
  const frames: { list: SrcNode[]; m: Mat; inv: Mat | null; k: number; up: Cell | null }[] = [{ list: scene.root, m: start, inv: startInv, k: 0, up: null }]
  while (frames.length) {
    const f = frames[frames.length - 1]
    if (f.k === f.list.length) { frames.pop(); continue }
    const n = f.list[f.k], at: Cell = { k: f.k++, up: f.up }
    if (hidden(n) || n.comments?.some(isLock)) continue
    if (visit(n, f.m, f.inv, at) === false || !n.c?.length) continue
    const g = childMatrix(n), gi = g && invert(g)
    if (g && gi) frames.push({ list: n.c, m: mul(f.m, g), inv: f.inv && mul(gi, f.inv), k: 0, up: at })
  }
}

// Whether a T's literal box through m (to surface px) is the label's: its centre and its size within half a px.
function fits(n: SrcNode, m: Mat, t: FrameText): boolean | null {
  const b = boxOf(n)
  if (!b) return null
  const [X, Y] = apply(m, b.x + b.w / 2, b.y + b.h / 2)
  return Math.abs(X - (t.x + t.w / 2)) <= 0.5 && Math.abs(Y - (t.y + t.h / 2)) <= 0.5
    && Math.abs(Math.hypot(m[0] * b.w, m[1] * b.w) - t.w) <= 0.5 && Math.abs(Math.hypot(m[2] * b.h, m[3] * b.h) - t.h) <= 0.5
}

/** The T a frame label draws (ruling P6). `named`, the path the frame's node names through the numbering, when that node
 *  is a T whose literal box fits the label (centre and size within half a px through its chain to surface px): two Ts in
 *  one box (state-swapped text) are told apart by the frame. Else by geometry, the last T in pre-order whose box fits;
 *  else `named` when its fit could not be told (a box or chain placed by an expression, a T a USE expands); else null. */
export function pairLabel(scene: Scene, size: { w: number; h: number }, t: FrameText, named?: number[] | null): number[] | null {
  const n = named ? nodeAt(scene.root, named) : undefined, m = n && foldKey(n.op) === 'T' ? chainTo(scene, named!, size) : null
  const own = n && m ? fits(n, m, t) : null
  if (own) return named!
  let found: Cell | null = null
  walk(scene, viewbox(scene.header, size), null, (c, cm, _, at) => { if (foldKey(c.op) === 'T' && fits(c, cm, t)) found = at })
  return found ? pathOf(found) : own === null ? named ?? null : null
}

const CLOSED = new Set(['R', 'C', 'Y', 'SP', 'P', 'T', 'IMG'])
// An own paint as the mod reads it (PropString; `none` in any case is none): a string, not empty, not none.
const own = (n: SrcNode, K: string) => { const v = first(n, K); return typeof v === 'string' && v !== '' && v.toLowerCase() !== 'none' }
const within = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h

// Whether (x, y) is inside the shape: C its ellipse, any other its outline even-odd (`o`, given when known); false when
// the shape has no literal geometry.
function holds(n: SrcNode, x: number, y: number, o = foldKey(n.op) === 'C' ? null : outline(n)): boolean {
  if (foldKey(n.op) === 'C') {
    const b = boxOf(n)
    return !!b && ((x - b.x - b.w / 2) / (b.w / 2)) ** 2 + ((y - b.y - b.h / 2) / (b.h / 2)) ** 2 <= 1
  }
  return (o ?? []).reduce((odd, c) => inside(c, x, y) ? !odd : odd, false)
}

// Whether a G's clip lets `at` (scene units) through. A CP is one shape in scene coordinates, a path by its outer contour
// (REFERENCE "CP"; Tessellator applies it through SceneToLocal): R C L Y P are cut, any other op is no usable shape and
// the mod draws the group unclipped, as it does for a clip id no CP declares. A shape not literal (re-cut from the data
// every rebuild) cannot be placed here: its group is left out. ponytail: an R's corner radii are not cut; a P counts as
// inside any of its closed contours; a literal clip of no area (drawn unclipped, with a report) is taken as a clip.
function clipped(scene: Scene, id: string, at: Pt): boolean {
  let cp: SrcNode | undefined
  for (const d of scene.defs) if (foldKey(d.op) === 'CP' && first(d, 'ID') === id) cp = d   // the mod keeps the last
  const s = cp?.c?.[0], op = s && foldKey(s.op)
  if (!s || !['R', 'C', 'L', 'Y', 'P'].includes(op!)) return true
  const o = op === 'C' ? null : outline(s)
  return op === 'C' ? !!boxOf(s) && holds(s, at.x, at.y) : !!o && o.some(c => inside(c, at.x, at.y))
}

/** Where nothing visible is under `at` (design units): the smallest node whose literal outline holds it, among closed
 *  shapes with an own fill or stroke (a stroke-only shape's inside), T and IMG; never a pure hit region (no f, no s), an
 *  open L or SP, a stroke-only P with no closed subpath (the mod's hit area for a P is its largest closed subpath), a
 *  hidden or locked node (ruling P5), or a node cut away at `at` by an SC viewport or a G clip above it (REFERENCE
 *  "Clicks": a click lands inside any clip it is drawn through). On equal areas the later in pre-order wins. */
export function hollowAt(scene: Scene, at: Pt): number[] | null {
  let found: Cell | null = null, least = Infinity
  walk(scene, IDENTITY, IDENTITY, (n, m, inv, cell) => {
    const op = foldKey(n.op), [x, y] = apply(inv!, at.x, at.y)
    if (op === 'SC') { const b = boxOf(n); return !!b && within(b, x, y) }   // its viewport cuts what is under it
    if (op === 'G') { const c = first(n, 'CLIP'); return typeof c !== 'string' || c === '' || clipped(scene, c, at) }
    const fill = own(n, 'F'), close = first(n, 'CLOSE')
    if (!CLOSED.has(op) || (op !== 'T' && op !== 'IMG' && !fill && !own(n, 'S'))) return
    if (op === 'SP' && !(typeof close === 'number' && close > 0.5)) return
    if (op === 'P' && !fill) { const d = first(n, 'D'); if (typeof d !== 'string' || !/z/i.test(d)) return }
    // The outline once (a P's is flattened), then the cheap rejections: an area that cannot win, a point off the box.
    const o = op === 'C' ? null : outline(n), b = op === 'C' ? boxOf(n) : o && bounds(o.flat())
    if (!b) return
    const area = b.w * b.h * Math.abs(m[0] * m[3] - m[1] * m[2])
    if (!(area <= least) || !within(b, x, y) || !holds(n, x, y, o)) return
    least = area
    found = cell
  })
  return found ? pathOf(found) : null
}

/** The node a press at surface px picks on the page, or null (nothing, a locked node, or something visible the numbering
 *  cannot name: none given, or the frame's node unknown). A locked node drawn on top is seen through, as if it drew
 *  nothing there: what lies under it is picked. */
export function pickNode(f: Frame | null, page: Page, order: Order | undefined, px: Pt): Selection | null {
  const scene = page.scene
  // The frame's own node (M1's selectableNode: known, and in this page's element), through the numbering.
  const named = (hit: Hit) => { const k = selectableNode(f!, hit, page.id), w = k === null ? undefined : order?.nodes[k]; return w === undefined ? null : pathOfIndex(scene.root, w) }
  const locked = (hit: Hit) => { const p = named(hit); return !!p && lockedAt(scene.root, p) }
  const under = f ? pickUnder(f, px.x, px.y, ztextOf(scene.header), locked) : null
  const hit = under?.hit ?? null, e = hit && f!.elements[hit.element]
  let path: number[] | null
  if (e && e.id === SCENE_ELEMENT && e.scene === page.id) {   // something of this page is drawn here
    const own = named(hit)
    path = under!.label ? pairLabel(scene, page.size, under!.label, own) : own
  } else {
    const [x, y] = apply(unview(viewbox(scene.header, page.size)), px.x, px.y)
    path = hollowAt(scene, { x, y })
  }
  return path && !lockedAt(scene.root, path) ? { pageId: page.id, path } : null
}
