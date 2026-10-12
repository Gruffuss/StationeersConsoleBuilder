// Picking a node on the preview frame (spec §4). Pure.
// Text boxes first, then triangles, topmost first (under the scene's `ztext`, in the game's order: a triangle drawn after
// a label wins over it); a triangle's vertex maps to the innermost node span holding it.
// Known misses here (docs/m1.md): nodes that draw nothing (hidden, invisible paint, clipped away, IMG), a T inside a
// refining masked group, whose span the mod discards since 0.11.73 (node -1), and labels the fallback rule could not
// pair (node -1). editing/pick.ts covers the first and the last by the attributes (rulings P5, P6).
// Picking uses the cover cuts Canvas displays, including measured ink overlaps; before Canvas plans them it uses the
// mod's box-based cut or the T span. A fading edge covers none.
import { SCENE_ELEMENT } from '../codegen/lua'
import type { Scene } from '../model/scene'
import type { Frame, FrameText } from '../runtime/frame'
import { foldKey } from '../srctext/props'
import { drawable, stripRichText, toLabel } from './text'

export type Hit = { element: number; node: number }

const MIN_ALPHA = 0.02  // below this alpha*coverage nothing shows: a feather ring's outer part, a masked-out part
const EDGE = 1e-6       // barycentric slack, so a point on an edge counts as inside
const FAINT = 2 / 255   // a vertex at most this opaque counts in no shape's bounds (MeshBuilder), so covers no label
const alphaAt = (f: Frame, v: number) => f.colours[4 * v + 3] / 255 * f.coverage[v]
// A ScriptedScreens panel or label (scene ""): the game does not raycast them (format catalogue), so a click passes
// through to what lies beneath. The page's own vector element is never one, even on a page whose id is "" (an outside
// project's). ponytail: a draggable panel, which does raycast, when a widget uses one.
const native = (f: Frame, element: number) => f.elements[element]?.scene === '' && f.elements[element].id !== SCENE_ELEMENT

/** The topmost label TextLayer draws under (x, y) surface px, or null: as the text layer stacks them, the one drawn last
 *  by its cover (the game draws a label just before its cover), then the later in list order. */
export function labelUnder(f: Frame, x: number, y: number): FrameText | null {
  // Only what TextLayer draws: every finite label, with some text and some alpha. A label is drawn turned and
  // sheared about its centre, so the point goes back through both into the box's own axes; then the label's clip box,
  // and its outline when the clip is not a box, cut it.
  let top: FrameText | null = null, topCover = -Infinity
  for (const [i, t] of f.text.filter(drawable).entries()) {
    const clip = t.clip
    if (t.colour[3] <= 0 || !stripRichText(t.text) || native(f, t.element)) continue
    const [u, v] = toLabel(t, x - (t.x + t.w / 2), y - (t.y + t.h / 2))
    if (!(Math.abs(u) <= t.w / 2 && Math.abs(v) <= t.h / 2)) continue  // so a degenerate shear's NaN misses
    if (clip && !(x >= clip[0] && x <= clip[0] + clip[2] && y >= clip[1] && y <= clip[1] + clip[3])) continue
    if (t.clipPolygon && !inside(t.clipPolygon, x, y)) continue
    // Non-finite covers have no canvas above them; list order breaks ties, as TextLayer draws them.
    const at = f.textCovers?.[i] ?? t.cover, cover = Number.isFinite(at) ? at : Infinity
    if (!top || cover >= topCover) { top = t; topCover = cover }
  }
  return top
}

/** The label or the visible triangle under (x, y) surface px, topmost first, or null: its hit (`node` -1 when unknown),
 *  and the label when a label won (null when a triangle did: a label and a triangle can both name node -1). With `ztext`
 *  (the scene's; the mod's default) labels obey scene order: a triangle drawn after a label (its vertex at or past the
 *  label's place) wins over it, unless it is a fading edge (a vertex all but transparent: a feather, a shadow's halo),
 *  which cannot cover text (REFERENCE "ztext"; the mod's shape bounds leave out vertices of alpha at most 2/255). A label
 *  whose T is unknown is placed by its cover. Without `ztext` a label is placed by its cover too, its element's end: over
 *  its own element's shapes, under a later element's, as the preview draws it. One with no cover stays on top. `pass`: a
 *  hit to see through (a locked node), as if it drew nothing there. */
export function pickUnder(f: Frame, x: number, y: number, ztext = false, pass?: (hit: Hit) => boolean): { hit: Hit; label: FrameText | null } | null {
  const t = labelUnder(f, x, y), seen = t && { hit: { element: t.element, node: t.node }, label: t }, label = seen && !pass?.(seen.hit) ? seen : null
  const measured = t && f.textCovers?.[f.text.filter(drawable).indexOf(t)]
  const at = t ? measured ?? (ztext ? labelAt(f, t) : t.cover) : undefined
  if (label && !Number.isFinite(at)) return label
  const p = f.positions, ix = f.indices
  for (let k = ix.length - ix.length % 3 - 3; k >= 0; k -= 3) {
    const a = ix[k], b = ix[k + 1], c = ix[k + 2]
    const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b] - ax, by = p[2 * b + 1] - ay, cx = p[2 * c] - ax, cy = p[2 * c + 1] - ay
    const d = bx * cy - cx * by, px = x - ax, py = y - ay
    if (!d) continue  // degenerate
    const wb = (px * cy - cx * py) / d, wc = (bx * py - px * by) / d, wa = 1 - wb - wc
    if (wa < -EDGE || wb < -EDGE || wc < -EDGE) continue
    // Interpolated, not per vertex: a feather ring's triangles always have an opaque inner vertex.
    if (wa * alphaAt(f, a) + wb * alphaAt(f, b) + wc * alphaAt(f, c) < MIN_ALPHA) continue
    const element = f.elements.findIndex(e => a >= e.firstVertex && a < e.firstVertex + e.vertexCount)
    if (native(f, element)) continue
    if (label && a < at!) return label   // the label is drawn after this triangle: it is on top here
    if (label && Math.min(alphaAt(f, a), alphaAt(f, b), alphaAt(f, c)) <= FAINT) continue   // a fading edge over the label
    const hit = { element, node: nodeOf(f, a) }
    if (pass?.(hit)) continue
    return { hit, label: null }
  }
  return label
}

/** Even-odd: is (x, y) inside the polygon p, flat x, y pairs? */
export function inside(p: number[], x: number, y: number) {
  let odd = false
  for (let i = 0, j = p.length - 2; i + 1 < p.length; j = i, i += 2)
    if ((p[i + 1] > y) !== (p[j + 1] > y) && x < p[j] + (y - p[j + 1]) * (p[i] - p[j]) / (p[i + 1] - p[j + 1])) odd = !odd
  return odd
}

// Spans are post-order and ids repeat (repeats, clip pieces), so the smallest span holding the vertex is the innermost
// node; on equal counts the first listed is the child (a G whose only child is an R).
function nodeOf(f: Frame, v: number) {
  const s = f.spans
  let node = -1, best = Infinity
  for (let k = 0; k < s.length; k += 4)
    if (v >= s[k + 2] && v < s[k + 2] + s[k + 3] && s[k + 3] < best) [node, best] = [s[k + 1], s[k + 3]]
  return node
}

/**
 * The hit's node when it is known and in page `page`'s own element, else null. Every page's element has the same id, so
 * its scene (the page id) tells a frame from another page or the previous project apart.
 */
export function selectableNode(f: Frame, hit: Hit | null, page: string): number | null {
  const e = hit && f.elements[hit.element]
  return hit && hit.node >= 0 && e?.id === SCENE_ELEMENT && e.scene === page ? hit.node : null
}

/** The box around every visible vertex of the node's spans in this element, in surface px, or null if none shows. */
export function spanBounds(f: Frame, element: number, node: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const s = f.spans, p = f.positions
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let k = 0; k < s.length; k += 4) {
    if (s[k] !== element || s[k + 1] !== node) continue
    for (let v = s[k + 2], end = Math.min(v + s[k + 3], f.coverage.length); v < end; v++) {
      if (!(alphaAt(f, v) > MIN_ALPHA)) continue
      x0 = Math.min(x0, p[2 * v])
      y0 = Math.min(y0, p[2 * v + 1])
      x1 = Math.max(x1, p[2 * v])
      y1 = Math.max(y1, p[2 * v + 1])
    }
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null
}

/** SCENE ztext as the mod reads it (SceneModel.cs TextInOrder): a number above 0.5, else (absent, an expression) the
 *  default 1: on. */
export function ztextOf(header: Scene['header']): boolean {
  const v = Object.entries(header).find(([k]) => foldKey(k) === 'ZTEXT')?.[1]
  return typeof v === 'number' ? v > 0.5 : true
}

/** A label's place in the draw order: the first vertex of its T's span (a T emits no vertices: count 0); when its T is
 *  unknown, its cover (the first vertex drawn over it, which the preview draws it under). ponytail: a T repeated by an
 *  RP has one span per copy; the first is taken. */
export function labelAt(f: Frame, t: FrameText): number {
  const s = f.spans
  if (t.node >= 0) for (let k = 0; k < s.length; k += 4) if (s[k] === t.element && s[k + 1] === t.node && s[k + 3] === 0) return s[k + 2]
  return t.cover
}
