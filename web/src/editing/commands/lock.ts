// Lock is the own-line comment # lock (ruling R7), first above the node (a widget's marker stays last); with any member
// unlocked all lock, else all unlock. Unlock all clears the page, but under a widget root, which its module writes (a
// widget root's own lock goes). A lock comment is read loosely (isLock). Writes no value: no check.
import type { SrcNode } from '../../model/scene'
import { nodeAt } from '../../model/store'
import { widgetOf } from '../../widgets/core'
import { membersOf, nativeMembersOf } from '../ctx'
import { withFlag } from '../natives'
import { editAt, isLock, LOCK, mapTree } from '../tree'
import type { Command } from '../types'

const isLocked = (n: SrcNode) => !!n.comments?.some(isLock)

function locked(n: SrcNode, on: boolean): SrcNode {
  const rest = (n.comments ?? []).filter(c => !isLock(c)), comments = on ? [LOCK, ...rest] : rest
  if (comments.length) return { ...n, comments }
  const { comments: _, ...plain } = n
  return plain
}

const lock: Command = { kind: 'command', id: 'lock', label: 'Lock / unlock', menu: 'arrange', order: 22, keys: ['Mod+Shift+L'], once: true,
  when: ctx => membersOf(ctx).length + nativeMembersOf(ctx).length > 0,
  run(ctx) {
    const page = ctx.page(), set = membersOf(ctx), nativeSet = nativeMembersOf(ctx), uids = new Set(nativeSet.map(s => s.native))
    const on = set.some(x => !isLocked(nodeAt(page.scene.root, x.path)!)) || (page.natives ?? []).some(n => uids.has(n.uid) && !n.lock)
    return ctx.apply({ scene: { ...page.scene, root: editAt(page.scene.root, set.map(x => x.path), n => locked(n, on)) },
      ...(nativeSet.length && { natives: withFlag(page.natives ?? [], nativeSet.map(s => s.native!), 'lock', on) }) })
  } }
const unlockAll: Command = { kind: 'command', id: 'unlockAll', label: 'Unlock all', menu: 'arrange', order: 23, when: () => true,
  run(ctx) {
    const page = ctx.page(), t = ctx.theme()
    return ctx.apply({ scene: { ...page.scene, root: mapTree(page.scene.root, n => isLocked(n) ? locked(n, false) : n, n => !!widgetOf(n, t)) },
      ...(page.natives && { natives: withFlag(page.natives, page.natives.map(n => n.uid), 'lock', false) }) })
  } }
export default [lock, unlockAll]
