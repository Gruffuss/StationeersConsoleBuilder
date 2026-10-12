// A move changes the parent frame, never the artwork's placement in the scene.
import { invert, mul, round, type Mat } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt } from '../model/store'
import { DEFAULT_THEME, THEMES, type Theme } from '../theme'
import { expandRoot, mergeDefs, widgetOf } from '../widgets/core'
import { IDENTITY, worldOf } from './bounds'
import { moveBy } from './transform'
import { editList, laterFirst, onPath, removeAt } from './tree'

const inside = (path: number[], parent: number[]) => parent.length <= path.length && parent.every((k, i) => path[i] === k)
const same = (a: number[], b: number[]) => a.length === b.length && inside(a, b)
const widget = (n: SrcNode) => !!widgetOf(n, THEMES[DEFAULT_THEME])

export function reparent(scene: Scene, from: number[][], to: { parent: number[]; index: number }, theme: Theme = THEMES[DEFAULT_THEME]): { scene: Scene; paths: number[][] } | string {
  const destination = to.parent.length ? nodeAt(scene.root, to.parent)?.c : scene.root
  if (!destination) return 'the destination parent is missing or has no children'
  if (!Number.isInteger(to.index) || to.index < 0 || to.index > destination.length) return 'the destination index is invalid'
  for (const path of from) {
    if (!path.length || !nodeAt(scene.root, path)) return 'a moved node is missing'
    if (inside(to.parent, path)) return 'cannot make a cycle: the group would contain itself'
    if (onPath(scene.root, path.slice(0, -1), widget)) return 'cannot move a widget part'
  }
  if (onPath(scene.root, to.parent, widget)) return 'cannot move into a widget'
  const unique = [...new Map(from.map(path => [path.join(), path])).values()]
  const paths = unique.filter(path => !unique.some(p => p !== path && inside(path, p)))
  const ordered = [...paths].sort((a, b) => -laterFirst(a, b)), nodes: SrcNode[] = []
  const defs: SrcNode[] = [], uids = new Set<string>()
  for (const path of ordered) {
    const n = nodeAt(scene.root, path)!, parent = path.slice(0, -1)
    if (same(parent, to.parent)) { nodes.push(n); continue }
    const old = worldOf(scene, path), next = worldOf(scene, [...to.parent, 0]), inv = next && invert(next)
    if (!old || !invert(old) || !inv) return 'cannot move: an old or new parent chain is singular, non-finite or not literal'
    const m = mul(inv, old), translation = m.slice(0, 4).every((v, i) => Math.abs(v - IDENTITY[i]) <= 1e-9)
    const ref = widgetOf(n, theme)
    if (translation && ref) {
      if (!m[4] && !m[5]) { nodes.push(n); continue }
      const x = round(Number(ref.params.x) + m[4]), y = round(Number(ref.params.y) + m[5])
      if (![x, y].every(v => Number.isFinite(Math.fround(v)))) return 'cannot move: widget params leave float32'
      const edit = ref.edit && { ...ref.edit, root: { ...ref.edit.root } }
      if (edit?.root?.r || edit?.root?.a) {
        const a = edit.root.a ?? [0, 0]
        edit.root.a = [round(a[0] + m[4]), round(a[1] + m[5])]
        if (!edit.root.a.every(v => Number.isFinite(Math.fround(v)))) return 'cannot move: widget anchor leaves float32'
      }
      const made = expandRoot({ ...ref, params: { ...ref.params, x, y }, ...(edit && { edit }) }, theme)
      nodes.push({ ...made.root, comments: [...n.comments!.slice(0, -1), ...made.root.comments!] })
      defs.push(...made.defs); uids.add(ref.uid)
    } else if (translation) {
      const moved = moveBy(n, m[4], m[5])
      if (moved.locked) return `cannot move ${n.op}: ${moved.locked}`
      nodes.push(moved.node)
    } else {
      const matrix = m.map((v, i) => i < 4 ? Math.fround(v) : round(v)) as Mat
      if (!matrix.every(Number.isFinite) || !invert(matrix)) return 'cannot move: the parent transform leaves float32 or becomes singular'
      nodes.push(matrix.every((v, i) => v === IDENTITY[i]) ? n : { op: 'G', attrs: { m: matrix }, c: [n] })
    }
  }
  const removed = ordered.map(path => {
    let at = path
    for (let up = at.slice(0, -1); up.length && !inside(to.parent, up); up = at.slice(0, -1)) {
      const n = nodeAt(scene.root, up)!
      if (n.op.toUpperCase() !== 'G' || n.c?.length !== 1 || n.comments?.length || Object.keys(n.attrs).length !== 1 || !n.attrs.m) break
      at = up
    }
    return at
  })
  // Deletions use the old indices; adjust each ancestor and the insertion slot before inserting once.
  const parent = to.parent.map((k, d) => k - removed.filter(p => p.length === d + 1 && same(p.slice(0, -1), to.parent.slice(0, d)) && p[d] < k).length)
  const index = to.index - removed.filter(p => same(p.slice(0, -1), to.parent) && p[p.length - 1] < to.index).length
  const root = editList(removeAt(scene.root, removed), parent, list => [...list.slice(0, index), ...nodes, ...list.slice(index)])
  if (!root) return 'the destination parent is missing'
  return { scene: { ...scene, root, ...(uids.size && { defs: mergeDefs(scene.defs, defs, uids) }) }, paths: paths.map(path => [...parent, index + ordered.findIndex(p => same(path, p))]) }
}
