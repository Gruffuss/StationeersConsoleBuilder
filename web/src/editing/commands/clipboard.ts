// Copy (the nodes and the defs they reach, as src, into the editor's clipboard and the system's: ruling R10), cut (copy,
// then delete), paste (on top, +10 per paste on the page it was copied from, in place on another page; ids fresh; defs
// merged: ruling P11; a widget a copy under a new uid). Paste is checked first.
import { nodeAt } from '../../model/store'
import { copyText, idsIn, nativeCopy, pasteText, uidOn } from '../clipboard'
import { membersOf, nativeMembersOf } from '../ctx'
import { holderOf, innerFrame, nativesUnder } from '../natives'
import { laterFirst } from '../tree'
import type { Clip, Command } from '../types'
import type { NativeRef } from '../../widgets/types'
import del from './delete'
import { OFFSET } from './duplicate'

// Paste lands at the page's top level, in the units the nodes were written in (the brief's design; where else it could
// land is the owner's call): a node copied from inside a group loses what that group gave it, and says so.
const NESTED = "pasted at the page's top level: what the group it was copied from gave it (transform, paint, opacity, scope) stays behind"
// A natives-only paste keeps the same scene; undo counting therefore needs both parts of that page's edit.
const nativeAt = new WeakMap<Clip, (NativeRef[] | undefined)[]>()

const copy: Command = { kind: 'command', id: 'copy', label: 'Copy', menu: 'edit', order: 30, keys: ['Mod+C'],
  when: ctx => membersOf(ctx).length + nativeMembersOf(ctx).length > 0,
  run(ctx) {
    const page = ctx.page(), set = membersOf(ctx).sort((a, b) => laterFirst(b.path, a.path)), nodes = set.map(x => nodeAt(page.scene.root, x.path)!)
    const text = nodes.length ? copyText(page.scene, nodes, ctx.theme()) : null, t = ctx.theme()
    const held = nativesUnder(page.scene, page.natives ?? [], set.map(x => x.path), t).map(ref => ({ ref, frame: innerFrame(page.scene, holderOf(page.scene, ref, t)!) }))
    const own = nativeMembersOf(ctx).map(s => {
      const { group: _, ...ref } = page.natives!.find(n => n.uid === s.native)!
      return { ref, frame: null }
    })
    Object.assign(ctx.clip, { text, natives: [...held, ...own], page: page.id, pasted: 0, at: [], nested: set.some(x => x.path.length > 1) })
    nativeAt.set(ctx.clip, [])
    if (text !== null) try { void navigator.clipboard?.writeText(text).catch(() => {}) } catch { /* the editor's own stands */ }
  } }
const cut: Command = { kind: 'command', id: 'cut', label: 'Cut', menu: 'edit', order: 31, keys: ['Mod+X'],
  when: copy.when, run(ctx) { void copy.run(ctx); return del.run(ctx) } }
const paste: Command = { kind: 'command', id: 'paste', label: 'Paste', menu: 'edit', order: 32, keys: ['Mod+V'],
  when: ctx => ctx.clip.text !== null || !!ctx.clip.natives?.length,
  run(ctx) {
    const page = ctx.page(), c = ctx.clip, text = c.text, base = page.scene, at = nativeAt.get(c) ?? []
    // Back on the scene a paste landed on (an undo): that paste and those after it no longer count.
    const j = c.page === page.id ? c.at.findIndex((scene, i) => scene === base && (!c.natives?.length || at[i] === page.natives)) : -1
    if (j >= 0) { c.pasted = j; c.at.length = at.length = j }
    const k = c.page === page.id ? c.pasted + 1 : 0, d = OFFSET * k
    const project = ctx.get().project
    const t = ctx.theme(), out = text === null ? { scene: base, paths: [] as number[][], notes: [], renamed: new Map<string, string>() }
      : pasteText(page.scene, text, idsIn(project, t), d, d, t, uidOn(project, page.id))
    if (typeof out === 'string') { ctx.note(out); return }
    const said = [...(c.nested ? [NESTED] : []), ...out.notes]
    if (said.length) ctx.note(said.join('; '))
    // The next paste moves on from one that landed only: a refused or dropped one leaves the offset where it was.
    let natives = page.natives ?? []
    const sels: import('../../model/store').Selection[] = out.paths.map(path => ({ pageId: page.id, path }))
    const pasted = { ...out.scene, root: out.paths.map(path => nodeAt(out.scene.root, path)!) }
    for (const entry of c.natives ?? []) {
      const ref = entry.ref.group ? { ...entry.ref, group: out.renamed.get(entry.ref.group) ?? entry.ref.group } : entry.ref
      const path = holderOf(pasted, ref, t), to = path && innerFrame(pasted, path)
      let copy = nativeCopy(project, page.id, out.scene, natives, ref, entry.frame, to, d, d, t)
      if (!path && copy.group) { const { group: _, ...rest } = copy; copy = rest }
      natives = [...natives, copy]
      if (!copy.group) sels.push({ pageId: page.id, path: [], native: copy.uid })
    }
    return ctx.apply({ scene: out.scene, ...(c.natives?.length && { natives }), selection: sels }, { check: true })
      .then(why => { if (why === null && k && c.text === text && k > c.pasted) { c.pasted = k; c.at[k - 1] = base; at[k - 1] = page.natives; nativeAt.set(c, at) } return why })
  } }
export default [copy, cut, paste]
