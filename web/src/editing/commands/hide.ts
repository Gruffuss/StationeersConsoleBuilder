// Hide is the mod's own v=0 (ruling R6: it exports hidden); a literal v <= 0.5 is shown again (v removed); an expression v
// is skipped. Widget root visibility is an instance override. Show all removes literal v <= 0.5, stopping at widget roots.
// Writes no new value: no check.
import { withAttr } from '../../editor/fields'
import type { SrcNode } from '../../model/scene'
import { nodeAt } from '../../model/store'
import { widgetOf } from '../../widgets/core'
import { hidden } from '../bounds'
import { membersOf, nativeMembersOf } from '../ctx'
import { withFlag } from '../natives'
import { editAt, first, mapTree } from '../tree'
import type { Command } from '../types'

/** Whether any node can still draw: a node without a block outside every hidden subtree (an expression v counts as
 *  shown). Explicit stack. */
function anyShown(root: readonly SrcNode[]): boolean {
  const stack = [...root]
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (hidden(n)) continue
    if (!n.c) return true
    for (const c of n.c) stack.push(c)
  }
  return false
}

const hide: Command = { kind: 'command', id: 'hide', label: 'Hide / show', menu: 'arrange', order: 20, keys: ['Mod+Shift+H'], once: true,
  when: ctx => membersOf(ctx).length + nativeMembersOf(ctx).length > 0,
  run(ctx) {
    const page = ctx.page()
    let skipped = 0
    const paths: number[][] = []
    for (const x of membersOf(ctx)) {
      const v = first(nodeAt(page.scene.root, x.path)!, 'V')
      if (v !== undefined && typeof v !== 'number') { skipped++; continue }
      paths.push(x.path)
    }
    // One pass over every member (one replaceAt each copied the whole list per member: quadratic in the set). Each one's v
    // is its own, which no other member's edit changes.
    const root = paths.length ? editAt(page.scene.root, paths, n => withAttr(n, 'v', hidden(n) ? undefined : 0)) : page.scene.root
    // Information, never a refusal: a scene that draws nothing gets the mod's magenta empty-scene marker.
    const said = [skipped ? `${skipped} skipped: v is an expression` : '',
      root !== page.scene.root && !anyShown(root) ? 'nothing on this page is shown now: the mod draws its magenta empty-scene marker' : '']
    if (said.some(Boolean)) ctx.note(said.filter(Boolean).join('; '))
    const uids = new Set(nativeMembersOf(ctx).map(s => s.native))
    const natives = (page.natives ?? []).map(n => uids.has(n.uid) ? withFlag([n], [n.uid], 'hidden', !n.hidden)[0] : n)
    return ctx.apply({ scene: { ...page.scene, root }, ...(uids.size && { natives }) })
  } }
const showAll: Command = { kind: 'command', id: 'showAll', label: 'Show all hidden', menu: 'arrange', order: 21, when: () => true,
  run(ctx) {
    const page = ctx.page(), t = ctx.theme()
    return ctx.apply({ scene: { ...page.scene, root: mapTree(page.scene.root, n => hidden(n) ? withAttr(n, 'v', undefined) : n, n => !!widgetOf(n, t)) },
      ...(page.natives && { natives: withFlag(page.natives, page.natives.map(n => n.uid), 'hidden', false) }) })
  } }
export default [hide, showAll]
