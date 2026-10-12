// What a selection item is to move, align and nudge: a unit with its design-unit box (spec §4).
import { apply, childMatrix, groupMatrix, invert, keep, mul, type Box } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt, type Selection } from '../model/store'
import type { Theme } from '../theme'
import { putWidget, sanitize, widgetAt } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { WidgetRef } from '../widgets/types'
import { boundsOf, worldBox, worldOf } from './bounds'
import { FLOAT32, moveBy } from './transform'
import { editAt, first, lockedAt, onPath } from './tree'

/** widget: the widget whose root the unit is (M2b), which moves by its params. */
export type Unit = { sel: Selection; node: SrcNode; box: Box | null; locked: string | null; widget: WidgetRef | null }

/** The root-tree members of `sels` (a DEFS node is no unit), their boxes in design units (a widget root's: its params'),
 *  and 'locked' for a node under `# lock` (its own or above it). */
export function unitsOf(scene: Scene, sels: readonly Selection[], t: Theme): Unit[] {
  const out: Unit[] = []
  for (const sel of sels) {
    const node = sel.inDefs ? undefined : nodeAt(scene.root, sel.path)
    if (!node) continue
    const widget = widgetAt(scene, sel.path, t), p = widget?.params as Box | undefined
    const parent = p && worldOf(scene, sel.path), root = widget && groupMatrix(node.attrs), W = parent && root && mul(parent, root)
    out.push({ sel, node, box: p ? W ? boundsOf({ op: 'R', attrs: { x: p.x, y: p.y, w: p.w, h: p.h } }, W) : null : worldBox(scene, sel.path),
      locked: lockedAt(scene.root, sel.path) ? 'locked' : null, widget })
  }
  return out
}

/** "n skipped: why", one line per reason, in first-seen order. */
const counted = (why: readonly string[]) => {
  const m = new Map<string, number>()
  for (const w of why) m.set(w, (m.get(w) ?? 0) + 1)
  return [...m].map(([w, k]) => `${k} skipped: ${w}`)
}
/** The clip on the node at `path` or above it: a clip outline is in scene units, so it stays where the node is moved,
 *  resized or turned. */
export const clipAbove = (root: readonly SrcNode[], path: readonly number[]): string | null =>
  onPath(root, path, n => { const c = first(n, 'CLIP'); return typeof c === 'string' && c !== '' ? c : null })
/** Why a node's chain has no inverse: a group above it not literal, else one singular (its determinant 0, as the editor
 *  and the mod read it: geometry.invert). */
const noChain = (root: readonly SrcNode[], path: readonly number[]) =>
  onPath(root, path.slice(0, -1), n => !childMatrix(n)) ? 'a group above is not literal' : 'a group above is singular'

/** Each unit moved by its design-unit delta (d[i]; none when d is shorter) through the inverse linear part of its own
 *  chain, per axis (an expression axis stays). A locked unit, or one under a group that is not literal, stays. A unit
 *  inside another unit is not moved again: it goes with that one (a G's child by its t, an SC's child with the SC). A
 *  widget root moves by its params (re-expanded), each axis that moves to a whole unit (M2b: no t on a widget root). One
 *  scene (the input itself when nothing moved), what was skipped and why, and notes (a clip that stays behind). The plain
 *  units' nodes are written in one editAt pass, then the widget roots: a select-all drag step costs O(n), not O(n²). */
export function moveUnits(scene: Scene, units: readonly Unit[], d: readonly { dx: number; dy: number }[], t: Theme): { scene: Scene; skipped: string[]; notes: string[] } {
  const why: string[] = [], notes = new Set<string>(), paths = new Set(units.map(u => u.sel.path.join(',')))
  const moved: number[][] = [], nodes: SrcNode[] = [], widgets: WidgetRef[] = []
  const inside = (path: readonly number[]) => {
    let key = ''
    for (let k = 0; k + 1 < path.length; k++) { key += (k ? ',' : '') + path[k]; if (paths.has(key)) return true }
    return false
  }
  units.forEach((u, i) => {
    const { dx, dy } = d[i] ?? { dx: 0, dy: 0 }
    if ((!dx && !dy) || inside(u.sel.path)) return
    if (u.locked) { why.push(u.locked); return }
    const W = worldOf(scene, u.sel.path), inv = W && invert([W[0], W[1], W[2], W[3], 0, 0])
    if (!inv) { why.push(noChain(scene.root, u.sel.path)); return }
    const [lx, ly] = apply(inv, dx, dy)
    if (u.widget) {
      // Discard only floating-point cancellation on an untouched axis, at any parent scale.
      const xMoves = Math.abs(lx) > 4 * Number.EPSILON * (Math.abs(inv[0] * dx) + Math.abs(inv[2] * dy))
      const yMoves = Math.abs(ly) > 4 * Number.EPSILON * (Math.abs(inv[1] * dx) + Math.abs(inv[3] * dy))
      const p = u.widget.params as { x: number; y: number }, x = xMoves ? Math.round(p.x + lx) : p.x, y = yMoves ? Math.round(p.y + ly) : p.y
      if (!Number.isFinite(Math.fround(x)) || !Number.isFinite(Math.fround(y))) { why.push(FLOAT32); return }   // as moveBy: never written
      if (x !== p.x || y !== p.y) {
        const w = { ...u.widget, params: sanitize(WIDGETS[u.widget.type], { ...u.widget.params, x, y }, t) }
        if (w.edit?.root?.r || w.edit?.root?.a) {
          const a = w.edit.root.a ?? [0, 0], at: [number, number] = [keep(a[0], a[0] + x - p.x), keep(a[1], a[1] + y - p.y)]
          if (!at.every(Number.isFinite)) { why.push(FLOAT32); return }
          w.edit = { ...w.edit, root: { ...w.edit.root, a: at } }
        }
        widgets.push(w)
      }
      return
    }
    const n = nodeAt(scene.root, u.sel.path)!, w = moveBy(n, lx, ly)
    if (w.locked) why.push(w.locked)
    if (w.node === n) return
    moved.push(u.sel.path)
    nodes.push(w.node)
    const clip = clipAbove(scene.root, u.sel.path)
    if (clip) notes.add(`clip ${clip} does not follow a move`)
  })
  // No unit is inside another moved here, so each path's node is the one its own unit built.
  let cur = moved.length ? { ...scene, root: editAt(scene.root, moved, (_, i) => nodes[i]) } : scene
  for (const w of widgets) cur = putWidget(cur, w, t)
  return { scene: cur, skipped: counted(why), notes: [...notes] }
}
