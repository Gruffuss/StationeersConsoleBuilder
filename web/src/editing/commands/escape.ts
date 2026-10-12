// Esc after the open gesture (the router's): a tool other than Select goes back to Select; with Select, a set clears and
// one node selects its parent (a top-level node deselects) (ruling P12). Only the selection shown counts: one left on
// another page is not touched. Keys only, no menu entry.
import { selected } from '../../model/store'
import { enterable } from '../depth'
import type { Command, Ctx } from '../types'

const shown = (ctx: Ctx) => { const s = ctx.get().selection; return s?.pageId === ctx.page().id ? s : null }
const entered = (ctx: Ctx) => { const e = ctx.get().entered; return e?.pageId === ctx.page().id ? e : null }
const exit = (ctx: Ctx, selectGroup: boolean) => {
  const e = entered(ctx)
  if (!e) return
  let path = e.path.slice(0, -1)
  while (path.length && !enterable(ctx.page().scene, path, ctx.theme())) path = path.slice(0, -1)
  ctx.dispatch({ type: 'enter', pageId: e.pageId, path })
  if (selectGroup) ctx.dispatch({ type: 'select', selection: e })
}

const leave: Command = { kind: 'command', id: 'tool.leave', label: 'Back to Select', keys: ['Escape'],
  when: ctx => ctx.tool() !== 'select', run: ctx => ctx.setTool('select') }
const parent: Command = { kind: 'command', id: 'select.parent', label: 'Select the parent', keys: ['Escape'],
  when: ctx => ctx.tool() === 'select' && (shown(ctx) !== null || entered(ctx) !== null),
  run(ctx) {
    const s = ctx.get(), sel = shown(ctx)
    if (!sel) { exit(ctx, false); return }
    const e = entered(ctx)
    if (e && !sel.inDefs && selected(s).length === 1 && e.path.length < sel.path.length && e.path.every((k, i) => sel.path[i] === k)) {
      exit(ctx, true)
      return
    }
    const up = selected(s).length > 1 || sel.path.length < 2 ? null : { ...sel, path: sel.path.slice(0, -1) }
    ctx.dispatch({ type: 'select', selection: up })
  } }
const enter: Command = { kind: 'command', id: 'select.enter', label: 'Enter the group', keys: ['Enter'], once: true,
  when: ctx => {
    const sel = shown(ctx)
    return ctx.tool() === 'select' && selected(ctx.get()).length === 1 && !!sel && !sel.inDefs && enterable(ctx.page().scene, sel.path, ctx.theme())
  },
  run(ctx) {
    const sel = shown(ctx)!
    ctx.dispatch({ type: 'enter', pageId: sel.pageId, path: sel.path })
    ctx.dispatch({ type: 'select', selection: { ...sel, path: [...sel.path, 0] } })
  } }
const up: Command = { kind: 'command', id: 'select.leave', label: 'Leave the group', keys: ['Shift+Enter'], once: true,
  when: ctx => ctx.tool() === 'select' && entered(ctx) !== null, run: ctx => exit(ctx, true) }
export default [leave, parent, enter, up]
