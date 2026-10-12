// Copy (the nodes and the defs they reach, as src, into the editor's clipboard and the system's: ruling R10), cut (copy,
// then delete), paste (on top, +10 per paste on the page it was copied from, in place on another page; ids fresh; defs
// merged: ruling P11; a widget a copy under a new uid). Paste is checked first.
import { nodeAt } from '../../model/store'
import { copyText, idsIn, pasteText, uidOn } from '../clipboard'
import { membersOf } from '../ctx'
import { laterFirst } from '../tree'
import type { Command } from '../types'
import del from './delete'
import { OFFSET } from './duplicate'

// Paste lands at the page's top level, in the units the nodes were written in (the brief's design; where else it could
// land is the owner's call): a node copied from inside a group loses what that group gave it, and says so.
const NESTED = "pasted at the page's top level: what the group it was copied from gave it (transform, paint, opacity, scope) stays behind"

const copy: Command = { kind: 'command', id: 'copy', label: 'Copy', menu: 'edit', order: 30, keys: ['Mod+C'],
  when: ctx => membersOf(ctx).length > 0,
  run(ctx) {
    const page = ctx.page(), set = membersOf(ctx).sort((a, b) => laterFirst(b.path, a.path)), nodes = set.map(x => nodeAt(page.scene.root, x.path)!)
    const text = copyText(page.scene, nodes, ctx.theme())
    Object.assign(ctx.clip, { text, page: page.id, pasted: 0, at: [], nested: set.some(x => x.path.length > 1) })
    try { void navigator.clipboard?.writeText(text).catch(() => {}) } catch { /* no system clipboard here: the editor's own stands */ }
  } }
const cut: Command = { kind: 'command', id: 'cut', label: 'Cut', menu: 'edit', order: 31, keys: ['Mod+X'],
  when: copy.when, run(ctx) { void copy.run(ctx); return del.run(ctx) } }
const paste: Command = { kind: 'command', id: 'paste', label: 'Paste', menu: 'edit', order: 32, keys: ['Mod+V'],
  when: ctx => ctx.clip.text !== null,
  run(ctx) {
    const page = ctx.page(), c = ctx.clip, text = c.text!, base = page.scene
    // Back on the scene a paste landed on (an undo): that paste and those after it no longer count.
    const j = c.page === page.id ? c.at.indexOf(base) : -1
    if (j >= 0) { c.pasted = j; c.at.length = j }
    const k = c.page === page.id ? c.pasted + 1 : 0, d = OFFSET * k
    const project = ctx.get().project
    const out = pasteText(page.scene, text, idsIn(project, ctx.theme()), d, d, ctx.theme(), uidOn(project, page.id))
    if (typeof out === 'string') { ctx.note(out); return }
    const said = [...(c.nested ? [NESTED] : []), ...out.notes]
    if (said.length) ctx.note(said.join('; '))
    // The next paste moves on from one that landed only: a refused or dropped one leaves the offset where it was.
    return ctx.apply({ scene: out.scene, selection: out.paths.map(path => ({ pageId: page.id, path })) }, { check: true })
      .then(why => { if (why === null && k && c.text === text && k > c.pasted) { c.pasted = k; c.at[k - 1] = base } return why })
  } }
export default [copy, cut, paste]
