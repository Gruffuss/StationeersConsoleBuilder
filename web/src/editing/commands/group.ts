// Group (one parent; the G takes the topmost member's slot; a group of one is the escape for an expression position,
// ruling R3) and ungroup (lossless only); a widget itself is ungrouped through Detach. Both checked first.
import { withAttr } from '../../editor/fields'
import type { SrcNode, Value } from '../../model/scene'
import { nodeAt } from '../../model/store'
import { fieldOf, GROUP_PAINT_DEFAULTS } from '../../schema'
import { foldKey } from '../../srctext/props'
import { widgetAt, widgetOf } from '../../widgets/core'
import { DEFAULT_THEME, THEMES } from '../../theme'
import { membersOf, nativeMembersOf } from '../ctx'
import { holderFor, holderOf } from '../natives'
import { answersTo } from '../scope'
import { moveBy, pairOf } from '../transform'
import { editList, first, isLock, LOCK } from '../tree'
import type { Command } from '../types'

// The mod's GroupPaintDefaults as it matches them: case and all (SceneModel.cs ParseStyle compares them Ordinal, and only
// `s_` becomes the stroke `s`), so an `F` on a group passes nothing down.
const DEFAULTS = new Set(GROUP_PAINT_DEFAULTS)

const group: Command = { kind: 'command', id: 'group', label: 'Group', menu: 'arrange', order: 0, keys: ['Mod+G'], once: true,
  when: ctx => membersOf(ctx).length + nativeMembersOf(ctx).length > 0,
  run(ctx) {
    const page = ctx.page(), set = membersOf(ctx), nativeSet = nativeMembersOf(ctx)
    if (!set.length) { ctx.note('a group needs a shape: a group of natives alone has no vector content'); return }
    const parent = set[0].path.slice(0, -1)
    if (set.some(x => x.path.length !== parent.length + 1 || parent.some((k, i) => x.path[i] !== k))) { ctx.note('group: the nodes must share one parent'); return }
    const idx = set.map(x => x.path[x.path.length - 1]).sort((a, b) => a - b), chosen = new Set(idx)
    const list = parent.length ? nodeAt(page.scene.root, parent)!.c! : page.scene.root
    const g: SrcNode = { op: 'G', attrs: {}, c: idx.map(i => list[i]) }, slot = idx[idx.length - 1] - (idx.length - 1)
    const root = editList(page.scene.root, parent, l => { const rest = l.filter((_, i) => !chosen.has(i)); return [...rest.slice(0, slot), g, ...rest.slice(slot)] })!
    let scene = { ...page.scene, root }, natives = page.natives
    if (nativeSet.length) {
      const holder = holderFor(ctx.get().project, page.id, scene, [...parent, slot], ctx.theme())
      if ('refused' in holder) { ctx.note(holder.refused); return }
      scene = holder.scene
      const uids = new Set(nativeSet.map(s => s.native))
      natives = page.natives!.map(n => uids.has(n.uid) ? { ...n, group: holder.id } : n)
    }
    return ctx.apply({ scene, ...(nativeSet.length && { natives }), selection: [{ pageId: page.id, path: [...parent, slot] }] }, { check: true })
  } }

/** n given a default it inherited from the group: as its own key where its op reads it (`s_` is a shape's `s`; a G's `s`
 *  is its scale), and, when it has a block, as a group default again (any node with a block passes them on: SceneModel.cs
 *  ParseStyle), unless it states the key itself. */
function inherit(n: SrcNode, k: string, v: Value): SrcNode {
  const own = k === 's_' ? 's' : k
  if (!(own === 's' && foldKey(n.op) === 'G') && fieldOf(n.op, own) && first(n, foldKey(own)) === undefined) n = withAttr(n, own, v)
  if (n.c && first(n, foldKey(k)) === undefined) n = withAttr(n, k, v)
  return n
}

const IDENTITY_M = [1, 0, 0, 1, 0, 0]

/** The children a G gives back when it ungroups losslessly, and a note when its id goes; or why it cannot. */
function ungrouped(g: SrcNode, defs: readonly SrcNode[]): { nodes: SrcNode[]; note?: string } | string {
  let t: [number, number] = [0, 0], id: Value | undefined
  const defaults: [string, Value][] = []
  for (const [k, v] of Object.entries(g.attrs)) {
    const K = foldKey(k), pair = Array.isArray(v) ? pairOf(v, K === 'S' ? 1 : 0) : null
    if (K === 'ID') { id = v; continue }
    if (K === 'T' && pair) { t = pair; continue }
    if ((K === 'R' && v === 0) || (K === 'S' && pair && pair[0] === 1 && pair[1] === 1)) continue
    if (K === 'A' && Array.isArray(v) && v.every(x => typeof x === 'number')) continue   // a pivot: nothing turns or scales about it (r and s are checked)
    // Identities: full opacity (the mod clamps o to 1), shown (v above 0.5), the identity matrix.
    if ((K === 'O' && typeof v === 'number' && v >= 1) || (K === 'V' && typeof v === 'number' && v > 0.5)
      || (K === 'M' && Array.isArray(v) && v.length === 6 && v.every((x, i) => x === IDENTITY_M[i]))) continue
    if (DEFAULTS.has(k)) { defaults.push([k, v]); continue }
    return `${k} on the group has no equal on its children`
  }
  const out: SrcNode[] = []
  for (const [i, c] of (g.c ?? []).entries()) {
    let n: SrcNode = widgetOf(c, THEMES[DEFAULT_THEME]) && (t[0] || t[1] || defaults.length) ? { op: 'G', attrs: {}, c: [c] } : c
    if (t[0] || t[1]) {
      const w = moveBy(n, t[0], t[1])
      if (w.locked) return `child ${i + 1}: ${w.locked}`
      n = w.node
    }
    // A USE hands its symbol what it inherited, and nothing written on the USE itself reaches the symbol's nodes.
    if (defaults.length && foldKey(n.op) === 'USE') return `${defaults[0][0]} on the group reaches the symbol child ${i + 1} draws, and a USE cannot carry it`
    // An SC passes on what it inherits but never its own so, its scroll offset there (SceneModel.cs, since 0.11.92).
    if (foldKey(n.op) === 'SC' && defaults.some(([k]) => k === 'so')) return `so on the group reaches what SC child ${i + 1} holds, and an SC's own so does not`
    for (const [k, v] of defaults) n = inherit(n, k, v)
    out.push(n)
  }
  // The id is the scope hover and down answer to, for whatever inside has none nearer: those would answer to another.
  const scoped = (typeof id === 'string' && id !== '') || typeof id === 'number'
  if (scoped && answersTo(out, defs)) return 'id on the group is what hover and down inside it answer to'
  // The group's own text: a # lock locks each child (first, ruling R7); its other comments, its line's comment and those
  // before its } go above the first child, so no comment is lost. A # lock ending its line or closing its block locked
  // nothing, and above a child it would: it goes.
  const locked = g.comments?.some(isLock)
  const text = [...(g.comments ?? []), ...(g.eol !== undefined ? [g.eol] : []), ...(g.tail ?? [])].filter(c => !isLock(c))
  const nodes = out.map((n, i) => {
    const own = n.comments ?? [], lock = own.some(isLock)
    if (!(locked && !lock) && !(i === 0 && text.length)) return n
    return { ...n, comments: [...(locked && !lock ? [LOCK] : []), ...(i === 0 ? text : []), ...own] }
  })
  return scoped ? { nodes, note: `id ${id} is dropped with the group` } : { nodes }
}

const ungroup: Command = { kind: 'command', id: 'ungroup', label: 'Ungroup', menu: 'arrange', order: 1, keys: ['Mod+Shift+G'], once: true,
  when(ctx) {
    const s = ctx.get(), sel = s.selection, n = sel && !sel.inDefs && !s.also.length && sel.pageId === ctx.page().id ? nodeAt(ctx.page().scene.root, sel.path) : undefined
    return !!n && foldKey(n.op) === 'G' && !!n.c?.length && !widgetAt(ctx.page().scene, sel!.path, ctx.theme())   // a widget is ungrouped by detaching it
  },
  run(ctx) {
    const page = ctx.page(), sel = ctx.get().selection!, out = ungrouped(nodeAt(page.scene.root, sel.path)!, page.scene.defs)
    if (typeof out === 'string') { ctx.note(out); return }
    const parent = sel.path.slice(0, -1), k = sel.path[sel.path.length - 1], kids = out.nodes
    let scene = page.scene, group: string | undefined
    const held = new Set((page.natives ?? []).filter(n => holderOf(scene, n, ctx.theme())?.join() === sel.path.join()).map(n => n.uid))
    if (held.size) {
      let path = parent
      while (path.length) {
        const holder = holderFor(ctx.get().project, page.id, scene, path, ctx.theme())
        if (!('refused' in holder)) { scene = holder.scene; group = holder.id; break }
        path = path.slice(0, -1)
      }
    }
    const natives = (page.natives ?? []).map(n => {
      if (!held.has(n.uid)) return n
      const { group: _, ...rest } = n
      return group ? { ...rest, group } : rest
    })
    const root = editList(scene.root, parent, l => [...l.slice(0, k), ...kids, ...l.slice(k + 1)])!
    if (out.note || held.size) ctx.note([out.note, held.size ? `${[...held].join(', ')} joined ${group ? 'group ' + group : 'the page'}` : ''].filter(Boolean).join('; '))
    return ctx.apply({ scene: { ...scene, root }, ...(held.size && { natives }), selection: kids.map((_, i) => ({ pageId: page.id, path: [...parent, k + i] })) }, { check: true })
  } }
export default [group, ungroup]
