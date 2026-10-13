// Duplicate: each member copied 10 design units right and down (through its own chain), right after its original, with
// fresh ids; a widget root's copy on top, under a new uid; the copies selected (ruling P11). A CP a copy clips to is
// copied and moved with it (a clip outline is in scene units). A member inside another member goes with that one's copy.
// Each parent list is rebuilt once, however many copies it takes. Checked first.
import { apply, invert } from '../../editor/geometry'
import type { SrcNode } from '../../model/scene'
import { nodeAt } from '../../model/store'
import { putWidget, sanitize, widgetAt, widgetOf, widgetsIn } from '../../widgets/core'
import { WIDGETS } from '../../widgets/registry'
import { worldOf } from '../bounds'
import { clipsOf, copyIds, copyWidgets, followClips, idsIn, nativeCopy, uidOn, withWidgetCopy } from '../clipboard'
import { membersOf, nativeMembersOf } from '../ctx'
import { holderOf, innerFrame, nativesUnder } from '../natives'
import type { NativeRef } from '../../widgets/types'
import { moveBy } from '../transform'
import { editAt, laterFirst, mapTree, pathsOf } from '../tree'
import type { Command } from '../types'

export const OFFSET = 10

const duplicate: Command = { kind: 'command', id: 'duplicate', label: 'Duplicate', menu: 'edit', order: 20, keys: ['Mod+D'],
  when: ctx => membersOf(ctx).length + nativeMembersOf(ctx).length > 0,
  run(ctx) {
    const page = ctx.page(), t = ctx.theme(), project = ctx.get().project, ids = idsIn(project, t), copies = new Set<SrcNode>()
    const made = new Map<string, string | null>(), cps: SrcNode[] = [], said = new Set<string>()
    const set = membersOf(ctx), roots = new Map(set.flatMap(x => { const w = x.path.length === 1 && widgetAt(page.scene, x.path, t); return w ? [[x, w] as const] : [] }))
    const uidFor = uidOn(project, page.id)
    let defs = page.scene.defs
    const allocated: SrcNode[] = []
    const held: { ref: NativeRef; from: ReturnType<typeof innerFrame>; group: string }[] = []
    const plain = set.filter(x => !roots.has(x)), keys = new Set(plain.map(x => x.path.join(',')))
    const under = (p: readonly number[]) => { let key = ''; for (let k = 0; k + 1 < p.length; k++) { key += (k ? ',' : '') + p[k]; if (keys.has(key)) return true } return false }
    // Per parent list (its path joined), the copies that go right after each index, and the parents in first-seen order.
    const after = new Map<string, Map<number, SrcNode[]>>(), parents: number[][] = []
    for (const sel of plain.filter(x => !under(x.path)).sort((a, b) => laterFirst(a.path, b.path))) {   // later first: the ids as before
      // Every node of the copy its own object, so nothing that finds nodes by identity mistakes the copy for its original.
      const source = nodeAt(page.scene.root, sel.path)!, nested = widgetsIn({ ...page.scene, root: [source] }, t).length > 0
      const copied = nested ? copyWidgets({ ...page.scene, defs, root: [...page.scene.root, ...allocated] }, [source], t, uidFor) : { nodes: [source], defs }
      if (nested) { defs = copied.defs; allocated.push(...copied.nodes) }
      const renamed = new Map<string, string>()
      const [copy] = mapTree(copyIds(copied.nodes, ids, renamed, t).nodes, n => ({ ...n }))
      for (const ref of nativesUnder(page.scene, page.natives ?? [], [sel.path], t)) {
        const path = holderOf(page.scene, ref, t)!
        held.push({ ref, from: innerFrame(page.scene, path), group: renamed.get(ref.group!) ?? ref.group! })
      }
      const W = worldOf(page.scene, sel.path), inv = W && invert([W[0], W[1], W[2], W[3], 0, 0])
      let node = copy
      if (!inv) said.add('a copy stays in place: a group above it is not literal or is singular')
      else {
        const [lx, ly] = apply(inv, OFFSET, OFFSET), widget = widgetOf(copy, t)
        const moved = widget ? putWidget({ ...page.scene, root: [copy], defs }, { ...widget, params: sanitize(WIDGETS[widget.type], { ...widget.params, x: (widget.params.x as number) + lx, y: (widget.params.y as number) + ly }, t) }, t) : null
        if (moved) defs = moved.defs
        const w = moved ? { node: moved.root[0], locked: null } : moveBy(copy, lx, ly)
        node = w.node
        if (w.locked) {
          said.add(`a copy ${w.node === copy ? 'stays in place' : 'moved only in part'}: ${w.locked}`)
          if (w.node !== copy) for (const c of clipsOf([node])) said.add(`clip ${c} does not follow the copy`)
        } else {   // moved OFFSET design units right and down: its clips' outlines follow as far
          const f = followClips(defs, [node], OFFSET, OFFSET, ids, made, t)
          node = f.nodes[0]
          cps.push(...f.defs)
          for (const c of f.stayed) said.add(`clip ${c} does not follow the copy`)
        }
      }
      copies.add(node)
      const up = sel.path.slice(0, -1), key = up.join(','), k = sel.path[sel.path.length - 1]
      let m = after.get(key)
      if (!m) { after.set(key, m = new Map()); parents.push(up) }
      m.set(k, [...m.get(k) ?? [], node])
    }
    const spread = (list: readonly SrcNode[], m: ReadonlyMap<number, SrcNode[]>) => list.flatMap((n, i) => [n, ...m.get(i) ?? []])
    const deep = parents.filter(p => p.length), top = after.get('')
    let root = deep.length ? editAt(page.scene.root, deep, (n, i) => n.c ? { ...n, c: spread(n.c, after.get(deep[i].join(','))!) } : n) : page.scene.root
    if (top) root = spread(root, top)
    // A widget's copy goes on top in its original's order: a new uid (one per copy: the scene so far counts), its params +10.
    let scene = { ...page.scene, root, defs: cps.length ? [...defs, ...cps] : defs }
    const paths = [...pathsOf(root, copies).values()]
    for (const [x, w] of [...roots].sort(([a], [b]) => a.path[0] - b.path[0])) {
      scene = withWidgetCopy(scene, w, uidFor(WIDGETS[w.type].prefix, scene), OFFSET, OFFSET, page.scene.root[x.path[0]].comments!.slice(0, -1), t)
      paths.push([scene.root.length - 1])
    }
    if (said.size) ctx.note([...said].join('; '))
    let natives = page.natives ?? []
    const sels = paths.map(path => ({ pageId: page.id, path })) as import('../../model/store').Selection[]
    for (const { ref, from, group } of held) {
      const path = holderOf(scene, { ...ref, group }, t), to = path && innerFrame(scene, path)
      const copy = nativeCopy(project, page.id, scene, natives, { ...ref, group }, from, to, OFFSET, OFFSET, t)
      natives = [...natives, copy]
    }
    const added = new Map<string, NativeRef>()
    for (const sel of nativeMembersOf(ctx)) {
      const ref = page.natives!.find(n => n.uid === sel.native)!, copy = nativeCopy(project, page.id, scene, natives, ref, null, null, OFFSET, OFFSET, t)
      natives = [...natives, copy]; added.set(ref.uid, copy); sels.push({ pageId: page.id, path: [], native: copy.uid })
    }
    if (added.size) natives = natives.filter(n => ![...added.values()].includes(n)).flatMap(n => [n, ...added.has(n.uid) ? [added.get(n.uid)!] : []])
    return ctx.apply({ scene, ...(natives !== page.natives && (held.length || added.size) ? { natives } : {}), selection: sels }, { check: true })
  } }
export default duplicate
