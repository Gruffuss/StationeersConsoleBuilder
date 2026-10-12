// Select all: every visible, unlocked root node of the page, a group whole (spec §4). With none, the selection
// stays as it is (the key is not taken).
import type { Selection } from '../../model/store'
import { hidden } from '../bounds'
import { lockedAt } from '../tree'
import type { Command, Ctx } from '../types'

const eligible = (ctx: Ctx): Selection[] => {
  const page = ctx.page(), root = page.scene.root
  return root.flatMap((n, k) => hidden(n) || lockedAt(root, [k]) ? [] : [{ pageId: page.id, path: [k] }])
}

const selectAll: Command = { kind: 'command', id: 'selectAll', label: 'Select all', menu: 'edit', order: 40, keys: ['Mod+A'],
  when: ctx => eligible(ctx).length > 0,
  run(ctx) {
    const set = eligible(ctx)
    if (!set.length) { ctx.note('nothing to select: every node is hidden or locked'); return }
    ctx.dispatch({ type: 'select', selection: set[set.length - 1], also: set.slice(0, -1) })
  } }
export default selectAll
