// Copy style (Mod+Alt+C), paste style (Mod+Alt+V) and the named styles from the theme's tokens (spec §4 "Style", §5.2).
// Copy takes the primary's style into the editor's clipboard; paste puts it on every member, each taking what its op
// reads; a named style puts the theme's values, as literals, on every member it fits; each in one checked step, with the
// theme gradients a styled member paints with added as their defs. Expressions copy as written; pasting or a named style
// over one is the user's act, and the status says how many were replaced. A widget root has no style of its own (M2b:
// its part styles are instance overrides): copying from a root copies nothing, the others skip it, and all say so.
import type { SrcNode } from '../../model/scene'
import { nodeAt } from '../../model/tree'
import { sameData } from '../../model/same'
import { defKey } from '../../schema/duplicateIds'
import type { Theme } from '../../theme'
import { linksOf, resolveLinks, unlinked } from '../../theme/links'
import { themeDefs, widgetRootOf } from '../../widgets/core'
import { membersOf, nativeMembersOf } from '../ctx'
import { applyNamed, fits, namedOf, pasteStyle, styleOf } from '../style'
import { editAt } from '../tree'
import { defaultOf, defaultKey } from '../settings'
import type { Command, Ctx } from '../types'

const LOOK = "a widget's look is its params"
const wholeWidget = (ctx: Ctx, path: number[]) => {
  const root = widgetRootOf(ctx.page().scene, path, ctx.theme())
  if (!root) return false
  const entered = ctx.get().entered
  return path.length === root.length || entered?.pageId !== ctx.page().id || entered.path.join() !== root.join()
}

const copyStyle: Command = { kind: 'command', id: 'style.copy', label: 'Copy style', menu: 'style', order: 0, keys: ['Mod+Alt+C'],
  when: ctx => { const s = ctx.get().selection; return !!s && !s.inDefs && s.pageId === ctx.page().id && !!nodeAt(ctx.page().scene.root, s.path) },
  run(ctx) {
    const page = ctx.page(), path = ctx.get().selection!.path
    if (wholeWidget(ctx, path)) { ctx.note(LOOK); return }
    const n = nodeAt(page.scene.root, path)!, attrs = styleOf(n), keys = Object.keys(attrs)
    ctx.clip.style = { op: n.op, attrs, links: linksOf(resolveLinks(n, ctx.theme(), ctx.theme()).node) }
    ctx.note(keys.length ? `style copied: ${keys.join(' ')}` : `style copied: none (pasting it removes the style)`)
  } }

// `defs` with the theme gradients `nodes` paint with (their own f and s, not their children's) that it lacks; a def of
// another table that shares the id (a clip) is not one. One it has stays as it is, a hand edit included (ruling,
// M2c Wave 3: style commands never write theme_ defs again; a theme switch, a load or an edit of a widget
// that paints with one does, M2b ruling 3). `defs` itself when none is missing.
function topUp(defs: SrcNode[], nodes: SrcNode[], t: Theme): SrcNode[] {
  const fresh = themeDefs(nodes.map(n => n.c ? { ...n, c: undefined } : n), t).filter(a => !defs.some(d => defKey(d) === defKey(a)))
  return fresh.length ? [...defs, ...fresh] : defs
}

// Every member through `style` (null: it does not fit), skipping widget roots and native widgets. Entered parts keep
// literal overrides through the store. One checked step with the defs topped up, or a note when nothing changes.
function restyle(ctx: Ctx, style: (n: SrcNode) => { node: SrcNode; overwrote: number } | null) {
  const page = ctx.page(), t = ctx.theme(), styled: SrcNode[] = []
  let widgets = 0, unfit = 0, changed = 0, overwrote = 0   // a native is never a member: it is selected alone (M2b T9)
  const paths = membersOf(ctx).filter(x => !wholeWidget(ctx, x.path) || (widgets++, false)).map(x => x.path)
  const root = editAt(page.scene.root, paths, n => {
    const r = style(n)
    if (!r) { unfit++; return n }
    styled.push(r.node)
    if (sameData(r.node, n)) return n
    changed++
    overwrote += r.overwrote
    return r.node
  })
  const defs = topUp(page.scene.defs, styled, t)
  const natives = nativeMembersOf(ctx).length
  const said = [natives && `${natives} skipped: natives take no style`, widgets && `${widgets} skipped: ${LOOK}`, unfit && `${unfit} skipped: this style does not fit ${unfit > 1 ? 'them' : 'it'}`,
    overwrote && `${overwrote} expression or data value${overwrote > 1 ? 's' : ''} replaced`].filter(Boolean).join('; ')
  if (!changed && defs === page.scene.defs) { ctx.note(said || (styled.length ? 'the style is already there' : 'no selected shapes fit this style')); return }
  if (said) ctx.note(said)
  return ctx.apply({ scene: { ...page.scene, root: changed ? root : page.scene.root, defs } }, { check: true })
}

const pasteStyleTo: Command = { kind: 'command', id: 'style.paste', label: 'Paste style', menu: 'style', order: 1, keys: ['Mod+Alt+V'],
  when: ctx => ctx.clip.style !== null && membersOf(ctx).length + nativeMembersOf(ctx).length > 0,
  run(ctx) { const style = ctx.clip.style!; return restyle(ctx, n => pasteStyle(n, style, ctx.theme())) } }

// The named styles, one click each from the Style menu (no key).
export const namedCommands = (ctx: Ctx): Command[] => namedOf(ctx.theme()).map((s, k) => ({ kind: 'command', id: `style.${s.id}`, label: s.label, menu: 'style', order: 10 + k,
  when: ctx => membersOf(ctx).length + nativeMembersOf(ctx).length > 0 && namedOf(ctx.theme()).some(x => x.id === s.id),
  run(ctx) {
    const t = ctx.theme(), current = namedOf(t).find(x => x.id === s.id)
    if (current) return restyle(ctx, n => fits(current, n, t) ? applyNamed(n, current, t) : null)
    ctx.note('this style is not available in the current theme')
  } }))
const detach: Command = { kind: 'command', id: 'style.detach', label: 'Detach style', menu: 'style', order: 2,
  when: ctx => membersOf(ctx).length > 0,
  run: ctx => restyle(ctx, n => ({ node: unlinked(n), overwrote: 0 })) }
const useAsDefault: Command = { kind: 'command', id: 'style.useAsDefault', label: 'Use as default', menu: 'style', order: 3,
  when: ctx => membersOf(ctx).length === 1,
  run(ctx) {
    const m = membersOf(ctx)
    if (m.length !== 1) return
    if (wholeWidget(ctx, m[0].path)) { ctx.note(LOOK); return }
    const n = nodeAt(ctx.page().scene.root, m[0].path)!
    const defaults = defaultOf(n, ctx.theme()), skipped = Object.keys(styleOf(n)).length - Object.keys(defaults.attrs).length
    const saved = ctx.setDrawDefaults({ ...ctx.drawDefaults(), [defaultKey(n)]: defaults })
    if (skipped) ctx.note(`${skipped} style fields with expressions or data skipped${saved ? '' : '; draw defaults kept for this session only: browser storage is unavailable'}`)
  } }
const resetDefaults: Command = { kind: 'command', id: 'style.resetDefaults', label: 'Reset defaults', menu: 'style', order: 4,
  when: () => true, run: ctx => { ctx.setDrawDefaults({}) } }
export default [copyStyle, pasteStyleTo, detach, useAsDefault, resetDefaults]
