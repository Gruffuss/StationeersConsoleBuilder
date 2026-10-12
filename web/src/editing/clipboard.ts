// The clipboard's text (ruling R10): src holding the defs the nodes reach, then the nodes; and pasting it back. Pure.
import type { Box } from '../editor/geometry'
import type { Project } from '../model/project'
import type { Scene, SrcNode } from '../model/scene'
import { parseSrc } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { foldKey } from '../srctext/props'
import type { Theme } from '../theme'
import { allocUid, expandRoot, markerOf, mergeDefs, putWidget, sanitize, takenUids, widgetOf, widgetsIn } from '../widgets/core'
import { nodeAt, replaceAt } from '../model/store'
import { WIDGETS } from '../widgets/registry'
import type { WidgetRef } from '../widgets/types'
import { moveBy } from './transform'
import { defClosure, first, fresh, freshIds, idsFrom, idsOf, kept as keptId, mapTree, renameIds, type Ids } from './tree'

/** The text of `nodes`: the defs they reach, but a widget root's own `<uid>_` defs (its re-expansion makes them) unless a
 *  plain node among them reaches one too; then the nodes. */
export function copyText(scene: Scene, nodes: readonly SrcNode[], t: Theme): string {
  const ws = widgetsIn({ ...scene, root: [...nodes] }, t), stems = ws.map(({ ref }) => ref.uid + '_')
  const plain = stems.length ? new Set(defClosure(mapTree(nodes, n => widgetOf(n, t) ? { op: 'G', attrs: {} } : n, n => !!widgetOf(n, t)), scene.defs)) : null
  const own = (d: SrcNode) => { const id = first(d, 'ID'); return typeof id === 'string' && stems.some(s => id.startsWith(s)) }
  return printChecked({ header: {}, defs: defClosure(nodes, scene.defs).filter(d => !plain || plain.has(d) || !own(d)), root: [...nodes] })
}

/** The ids a command that copies nodes gives on `project` (Q14): none any page holds as an id, an id stem or a native's
 *  uid (takenUids), and none whose stem is a widget's or a native's uid: such an id goes to `<uid>copy<k>_`. One per
 *  command. */
export function idsIn(project: Project, t: Theme): Ids {
  const taken = idsOf(project.pages.map(p => p.scene)), uids = new Set<string>()
  for (const u of takenUids(project)) taken.add(u)
  for (const p of project.pages) {
    for (const n of p.natives ?? []) uids.add(n.uid)
    for (const { ref } of widgetsIn(p.scene, t)) uids.add(ref.uid)
  }
  return idsFrom(taken, uids)
}

/** A uid for a widget copy on page `pageId` (Q14: one in the project), given that page's scene so far, so two copies get two. */
export const uidOn = (project: Project, pageId: string) => (prefix: string, scene: Scene) =>
  allocUid({ ...project, pages: project.pages.map(q => q.id === pageId ? { ...q, scene } : q) }, prefix)

/** `scene` with a copy of widget `w` on top under `uid` (re-expanded: its own `<uid>_` defs), its params moved by (dx, dy),
 *  the comments `above` its marker (a `# lock`) kept, as a copied node keeps its own (ruling R7). */
export function withWidgetCopy(scene: Scene, w: WidgetRef, uid: string, dx: number, dy: number, above: readonly string[], t: Theme): Scene {
  const m = WIDGETS[w.type], p = w.params as Box, ref = { ...w, uid, params: sanitize(m, { ...w.params, x: p.x + dx, y: p.y + dy }, t) }
  // putWidget keeps what stands above the marker of a root it finds, so a root holding only the comments goes first.
  const held = above.length ? { ...scene, root: [...scene.root, { op: 'G', attrs: { id: uid }, comments: [...above, markerOf(ref)] }] } : scene
  return putWidget(held, ref, t)
}

/** Copies nested widget roots before ordinary id renaming can break their markers. */
export function copyWidgets(scene: Scene, nodes: SrcNode[], t: Theme, uidFor: (prefix: string, scene: Scene) => string): { nodes: SrcNode[]; defs: SrcNode[] } {
  const widgets = widgetsIn({ ...scene, root: nodes }, t)
  if (!widgets.length) return { nodes, defs: scene.defs }
  const start = scene.root.length
  let held = { ...scene, root: [...scene.root, ...nodes] }
  for (const { path, ref: w } of widgets) {
    const at = [start + path[0], ...path.slice(1)], n = nodeAt(held.root, at)!
    const uid = uidFor(WIDGETS[w.type].prefix, held), { root, defs } = expandRoot({ ...w, uid }, t)
    held = { ...held, root: replaceAt(held.root, at, { ...root, comments: [...n.comments!.slice(0,-1), ...root.comments!] })!, defs: mergeDefs(held.defs, defs, uid) }
  }
  return { nodes: held.root.slice(start), defs: held.defs }
}

const printed = (d: SrcNode) => printChecked({ header: {}, defs: [d], root: [] })

/** The clips `nodes` name (clip=, on any of them or under them), each once, in no set order. Explicit stack. */
export function clipsOf(nodes: readonly SrcNode[], whole?: (n: SrcNode) => boolean): string[] {
  const out = new Set<string>(), stack = [...nodes]
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (whole?.(n)) continue
    const id = first(n, 'CLIP')
    if (typeof id === 'string' && id) out.add(id)
    for (const c of n.c ?? []) stack.push(c)
  }
  return [...out]
}

/** `nodes`, moved as a whole by (dx, dy) scene units, with each clip they name given a copy of its CP moved as far under a
 *  fresh id: a clip outline is in scene units and does not follow its node (REFERENCE.md, CP), so the copy would lie
 *  outside it. `made` maps a CP's id to its copy's (null: its outline cannot move) across calls with one offset, so one
 *  CP is copied once. The nodes, the CPs made by this call, and the clips that stay behind. A clip without its CP stays
 *  as written (the check names it). */
export function followClips(defs: readonly SrcNode[], nodes: readonly SrcNode[], dx: number, dy: number, ids: Ids,
  made: Map<string, string | null>, t?: Theme): { nodes: SrcNode[]; defs: SrcNode[]; stayed: string[] } {
  const added: SrcNode[] = [], stayed: string[] = [], map = new Map<string, string>()
  const whole = t ? (n: SrcNode) => !!widgetOf(n, t) : undefined
  for (const id of dx || dy ? clipsOf(nodes, whole) : []) {
    if (!made.has(id)) {
      const cp = defs.find(d => foldKey(d.op) === 'CP' && first(d, 'ID') === id), kids = (cp?.c ?? []).map(c => moveBy(c, dx, dy))
      if (!cp || !kids.length) made.set(id, id)
      else if (kids.some(w => w.locked)) made.set(id, null)
      else {
        const to = fresh(id, ids), key = Object.keys(cp.attrs).find(k => foldKey(k) === 'ID')!
        added.push({ ...cp, attrs: { ...cp.attrs, [key]: to }, c: kids.map(w => w.node) })
        made.set(id, to)
      }
    }
    const to = made.get(id)
    if (to === null) stayed.push(id)
    else if (to !== undefined && to !== id) map.set(id, to)
  }
  const out = map.size ? mapTree(nodes, n => {
    const e = Object.entries(n.attrs).find(([k]) => foldKey(k) === 'CLIP'), to = typeof e?.[1] === 'string' ? map.get(e[1]) : undefined
    return e && to ? { ...n, attrs: { ...n.attrs, [e[0]]: to } } : n
  }, whole) : [...nodes]
  return { nodes: out, defs: added, stayed }
}

/** `text` pasted on top of `scene`: each def merged by id (an equal one reused; a different one, or one whose id a node
 *  of the scene uses, renamed with the references to it; a theme_* def never: the page's own stands; one whose stem is
 *  a uid renamed, Ids' rule), every id of the pasted nodes that `ids` holds made fresh, the nodes moved by (dx, dy)
 *  design units and appended, a CP they clip to copied and moved with them (followClips). A widget root goes on top after them as a copy (withWidgetCopy) under a uid
 *  `uidFor` gives, its params moved. The scene, the pasted nodes' paths and notes (a node that did not move, or moved in
 *  part: an expression position; a clip that stays behind), or why not. */
export function pasteText(scene: Scene, text: string, ids: Ids, dx: number, dy: number, t: Theme,
  uidFor: (prefix: string, scene: Scene) => string): { scene: Scene; paths: number[][]; notes: string[] } | string {
  const r = parseSrc(text)
  if (r.errors.length || !r.scene) return `the clipboard holds no src: ${r.errors[0]?.message ?? 'nothing parsed'}`
  if (!r.scene.root.length) return 'the clipboard holds no nodes'
  const widgets: { w: WidgetRef; above: string[] }[] = [], plain: SrcNode[] = []
  for (const n of r.scene.root) { const w = widgetOf(n, t); if (w) widgets.push({ w, above: n.comments!.slice(0, -1) }); else plain.push(n) }
  const map = new Map<string, string>(), kept: SrcNode[] = [], own = idsOf([{ header: {}, defs: [], root: scene.root }])
  for (const d of r.scene.defs) {
    const id = first(d, 'ID'), there = typeof id === 'string' ? scene.defs.find(x => first(x, 'ID') === id) : undefined
    if (typeof id !== 'string' || !id) { kept.push(d); continue }
    if (there && (id.startsWith('theme_') || printed(there) === printed(d))) continue
    const to = there || own.has(id) ? fresh(id, ids) : keptId(id, ids)
    if (to !== id) map.set(id, to)
    kept.push(d)
  }
  const copied = copyWidgets(scene, plain, t, uidFor)
  const named = freshIds(copied.nodes, ids, map, n => !!widgetOf(n, t)).nodes
  const defs = renameIds(kept, map), all = [...copied.defs, ...defs], made = new Map<string, string | null>(), notes = new Set<string>()
  const root = named.map(n => {
    const w = moveBy(n, dx, dy)
    if (w.locked) {
      notes.add(`a pasted node ${w.node === n ? 'stays where it was copied' : 'moved only in part'}: ${w.locked}`)
      if (w.node !== n) for (const c of clipsOf([w.node])) notes.add(`clip ${c} does not follow the paste`)
      return w.node
    }
    const f = followClips(all, [w.node], dx, dy, ids, made, t)
    defs.push(...f.defs)
    for (const c of f.stayed) notes.add(`clip ${c} does not follow the paste`)
    return f.nodes[0]
  })
  let out: Scene = { ...scene, defs: defs.length ? [...copied.defs, ...defs] : copied.defs, root: [...scene.root, ...root] }
  for (const { w, above } of widgets) out = withWidgetCopy(out, w, uidFor(WIDGETS[w.type].prefix, out), dx, dy, above, t)
  return { scene: out, paths: out.root.slice(scene.root.length).map((_, i) => [scene.root.length + i]), notes: [...notes] }
}
