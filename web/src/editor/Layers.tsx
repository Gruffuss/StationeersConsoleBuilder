// A flat list of the expanded tree: unopened subtrees are never walked or given paths.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import hide from '../editing/commands/hide'
import lock from '../editing/commands/lock'
import { reorderNatives } from '../editing/commands/order'
import { canHold, drawOrder, holderFor, holderOf, holders } from '../editing/natives'
import { hidden } from '../editing/bounds'
import { enterable } from '../editing/depth'
import { reparent } from '../editing/reparent'
import { runCommand } from '../editing/registry'
import { first, idsOf, isLock, renameIds, replaceAt } from '../editing/tree'
import type { Command, Ctx } from '../editing/types'
import type { Page } from '../model/project'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt, sameSelection, selected, type Action, type Selection, type State } from '../model/store'
import { foldKey, textOf } from '../srctext/props'
import { expandRoot, nativesOf, widgetAt, widgetOf, widgetRootOf } from '../widgets/core'
import type { NativeRef, WidgetRef } from '../widgets/types'
import { withAttr } from './fields'
import { Icon, type IconName } from '../ui/icons'
import { NATIVE_DESCRIPTION } from './nativeText'
import './sidebar.css'

const NODE_ICONS: Record<string, IconName> = { G: 'group', SC: 'group', RP: 'group', R: 'rect', C: 'ellipse', Y: 'polygon', YS: 'polygon', L: 'line', LS: 'line', SP: 'path', P: 'path', T: 'text', IMG: 'image' }

type Props = { page: Page; selection: Selection | null; also: Selection[]; entered: State['entered']; dispatch: (a: Action) => void; ctx: Ctx }
type Row = { node: SrcNode; sel: Selection; widget: WidgetRef | null; native?: NativeRef; parent?: number[]; part?: string; widgetPath?: number[] }
const keyOf = (s: Selection) => s.native ? `native:${s.native}` : `${s.inDefs ? 'defs' : 'root'}:${s.path.join('.')}`
const sameParent = (a: Selection, b: Selection) => !a.native && !b.native && !!a.inDefs === !!b.inDefs && a.path.slice(0, -1).join() === b.path.slice(0, -1).join()
const nameOf = (n: SrcNode) => { const id = first(n, 'ID'); return `${n.op}${id === undefined || id === '' ? '' : '#' + id}` }
const inside = (path: number[], parent: number[]) => parent.every((k, d) => path[d] === k)
const Z_BANDS = 'a text input always draws above an icon (z_index 22 over 6)'

export function Layers({ page, selection, also, entered, dispatch, ctx }: Props) {
  const [expanded, setExpanded] = useState(new Set<SrcNode['attrs'] | string>())
  // Child edits copy the parent node but retain its attribute record; widget rebuilds retain their uid.
  const identity = (n: SrcNode) => { const w = widgetOf(n, ctx.theme()); return w ? `${page.id}:${w.uid}` : n.attrs }
  const container = useRef<HTMLDivElement>(null), focus = useRef<string | null>(null)
  useEffect(() => {
    if (focus.current) container.current?.querySelector<HTMLElement>(`[data-layer="${focus.current}"]`)?.focus()
    focus.current = null
  }, [expanded])
  const anchor = useRef<Selection | null>(null)
  const dragging = useRef<{ scene: Scene; natives: Page['natives']; pageId: string; from: Selection[] } | null>(null)
  const set = selection?.pageId === page.id ? [...also, selection] : []
  const choose = (members: Selection[]) => dispatch({ type: 'select', selection: members[members.length - 1] ?? null, also: members.slice(0, -1) })
  const open = (sel: Selection) => setExpanded(was => {
    const next = new Set(was)
    const scene = ctx.page().scene, list = sel.inDefs ? scene.defs : scene.root
    for (let d = 1; d <= sel.path.length; d++) { const n = nodeAt(list, sel.path.slice(0, d)); if (n) next.add(identity(n)) }
    return next
  })
  useEffect(() => {
    if (!selection?.inDefs) return
    const details = container.current?.querySelector<HTMLDetailsElement>('details.disc')
    if (details) details.open = true
    open(selection)
  }, [page.id, selection?.inDefs, selection?.path.join('.')])
  const select = (sel: Selection, e: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => {
    const start = anchor.current
    if (e.shiftKey && sel.native && start?.native) {
      const refs = page.natives ?? [], a = refs.find(n => n.uid === start.native), b = refs.find(n => n.uid === sel.native)
      const parent = b && holderOf(page.scene, b, ctx.theme())?.join()
      if (a && b && holderOf(page.scene, a, ctx.theme())?.join() === parent) {
        const siblings = drawOrder(refs, ctx.theme()).filter(n => holderOf(page.scene, n, ctx.theme())?.join() === parent)
        const i = siblings.indexOf(a), j = siblings.indexOf(b)
        const range = siblings.slice(Math.min(i, j), Math.max(i, j) + 1).map(n => ({ pageId: page.id, path: [], native: n.uid }))
        choose([...range.filter(s => !sameSelection(s, sel)), sel]); return
      }
    }
    const root = !sel.inDefs && !sel.native ? widgetRootOf(page.scene, sel.path, ctx.theme()) : null
    const widget = root && root.length < sel.path.length ? widgetAt(page.scene, root, ctx.theme()) : null
    if (widget && entered?.path.join() !== root!.join()) {
      if (!enterable(page.scene, root!, ctx.theme())) { ctx.note('the widget is hidden or locked'); return }
      dispatch({ type: 'enter', pageId: page.id, path: root! })
    }
    if (e.shiftKey && widget && start && !start.inDefs && inside(start.path, root!)) {
      const parts = Object.values(expandRoot(widget, ctx.theme()).exp.parts!).map(p => ({ ...sel, path: [...root!, ...p] }))
      const a = parts.findIndex(s => sameSelection(s, start)), b = parts.findIndex(s => sameSelection(s, sel))
      if (a >= 0 && b >= 0) { const range = parts.slice(Math.min(a, b), Math.max(a, b) + 1); choose([...range.filter(s => !sameSelection(s, sel)), sel]); return }
    }
    if (e.shiftKey && !widget && start && sameParent(start, sel) && !sel.inDefs) {
      const parent = sel.path.slice(0, -1), a = start.path.at(-1)!, b = sel.path.at(-1)!
      const range = Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => ({ ...sel, path: [...parent, Math.min(a, b) + i] }))
      choose([...range.filter(s => !sameSelection(s, sel)), sel])
    } else if (e.ctrlKey || e.metaKey) {
      const now = selected(ctx.get()).filter(s => s.pageId === page.id)
      const had = now.some(s => sameSelection(s, sel)), rest = now.filter(s => !sameSelection(s, sel))
      choose(had ? rest : [...rest, sel])
      anchor.current = had ? rest[rest.length - 1] ?? null : sel
    } else { choose([sel]); anchor.current = sel }
  }
  const enter = (row: Row) => {
    if (!row.native && !row.sel.inDefs && enterable(page.scene, row.sel.path, ctx.theme())) {
      dispatch({ type: 'enter', pageId: page.id, path: row.sel.path })
      open(row.sel)
    }
  }
  const command = (row: Row, c: Command) => {
    select(row.sel, { ctrlKey: false, metaKey: false, shiftKey: false })
    // Existing commands act on a root tree; a definition row uses the same commands over its section.
    const base = ctx.page(), onRow: Ctx = row.sel.inDefs ? { ...ctx,
      page: () => ({ ...base, scene: { ...base.scene, root: base.scene.defs } }),
      get: () => ({ ...ctx.get(), selection: { ...row.sel, inDefs: false }, also: [] }),
      apply: (e, options) => ctx.apply({ scene: { ...base.scene, defs: e.scene.root }, selection: [row.sel] }, options),
    } : ctx
    if (c.when(onRow)) void runCommand(c, onRow)
  }
  const move = async (from: Selection[], to: { parent: number[]; index: number }, inDefs: boolean, beside?: { uid: string; after: boolean }) => {
    const nativeSet = from.filter(s => s.native), nodes = from.filter(s => !s.native)
    if (nativeSet.length && inDefs) { ctx.note('natives live on the page, not in Defs'); return }
    if (!inDefs && (nodes.some(s => { const root = widgetRootOf(page.scene, s.path, ctx.theme()); return root && root.length < s.path.length })
      || !nativeSet.length && widgetRootOf(page.scene, to.parent, ctx.theme()))) { ctx.note("a widget's structure changes through Detach"); return }
    // Native membership has its own, more precise widget/SC refusals.
    if (from.some(s => !!s.inDefs !== inDefs)) { ctx.note('definitions stay in Defs; root nodes stay in Root'); return }
    const base = ctx.page().scene, refs = ctx.page().natives ?? []
    let scene = inDefs ? { ...base, root: base.defs } : base, group: string | undefined
    if (nativeSet.length && to.parent.length) {
      const holder = holderFor(ctx.get().project, page.id, scene, to.parent, ctx.theme())
      if ('refused' in holder) { ctx.note(holder.refused); return }
      scene = holder.scene; group = holder.id
    }
    const chosen = new Set(nativeSet.map(s => s.native))
    if (beside && nativeSet.length) {
      const z = new Map(nativesOf({ natives: refs }, ctx.theme()).map(n => [n.uid, n.el.props.z_index]))
      if (nativeSet.some(s => z.get(s.native!) !== z.get(beside.uid))) { ctx.note(Z_BANDS); return }
    }
    let natives = refs.map(n => {
      if (!chosen.has(n.uid) || n.group === group) return n
      const { group: _, ...rest } = n
      return group ? { ...rest, group } : rest
    })
    if (beside && nativeSet.length && !chosen.has(beside.uid)) {
      const moved = natives.filter(n => chosen.has(n.uid)), rest = natives.filter(n => !chosen.has(n.uid)), i = rest.findIndex(n => n.uid === beside.uid) + (beside.after ? 1 : 0)
      natives = [...rest.slice(0, i), ...moved, ...rest.slice(i)]
    }
    const out = nodes.length ? reparent(scene, nodes.map(s => s.path), to, ctx.theme()) : { scene, paths: [] as number[][] }
    if (typeof out === 'string') { ctx.note(out); return }
    const members: Selection[] = [...out.paths.map(path => ({ pageId: page.id, path, ...(inDefs && { inDefs }) })), ...nativeSet]
    const was = ctx.get().entered
    let entry = !inDefs && was?.pageId === page.id ? was.path : null
    if (entry && nodes.length) {
      const i = nodes.findIndex(s => inside(entry!, s.path))
      if (i >= 0) {
        const wrapped = nodeAt(out.scene.root, out.paths[i])?.c?.[0] === nodeAt(base.root, nodes[i].path)
        entry = [...out.paths[i], ...(wrapped ? [0] : []), ...entry.slice(nodes[i].path.length)]
      } else {
        const old = entry
        entry = old.map((k, d) => k - nodes.filter(s => s.path.length === d + 1 && inside(old, s.path.slice(0, -1)) && s.path[d] < k).length)
        const parent = out.paths[0].slice(0, -1), index = Math.min(...out.paths.map(p => p.at(-1)!))
        if (entry.length > parent.length && inside(entry, parent) && entry[parent.length] >= index) entry[parent.length] += out.paths.length
      }
    }
    const why = await ctx.apply({ scene: inDefs ? { ...base, defs: out.scene.root } : out.scene, ...(nativeSet.length && { natives }), selection: members }, { check: !!nodes.length || scene !== base })
    if (!why) {
      if (entry && enterable(out.scene, entry, ctx.theme()) && !sameSelection(ctx.get().entered, { pageId: page.id, path: entry })) {
        dispatch({ type: 'enter', pageId: page.id, path: entry }); choose(members)
      }
      focus.current = keyOf(members[members.length - 1])
      for (const sel of members) {
        const ref = sel.native && natives.find(n => n.uid === sel.native), path = ref ? holderOf(out.scene, ref, ctx.theme()) ?? [] : sel.path.slice(0, -1)
        open({ pageId: page.id, path })
      }
    }
  }
  const moving = (sel: Selection) => {
    const now = selected(ctx.get()).filter(s => s.pageId === page.id)
    return now.some(s => sameSelection(s, sel)) ? now : [sel]
  }
  const onKey = (row: Row, e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (!e.altKey && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Enter' && !row.native && !row.sel.inDefs && enterable(page.scene, row.sel.path, ctx.theme())) enter(row)
      else select(row.sel, e)
      return
    }
    if (!e.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    e.preventDefault(); e.stopPropagation()
    if (row.native) {
      const parent = holderOf(page.scene, row.native, ctx.theme()) ?? [], from = moving(row.sel)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const siblings = drawOrder(page.natives ?? [], ctx.theme()).filter(n => (holderOf(page.scene, n, ctx.theme()) ?? []).join() === parent.join())
        const i = siblings.indexOf(row.native), other = siblings[i + (e.key === 'ArrowDown' ? 1 : -1)]
        if (other && other.type !== row.native.type) { ctx.note(Z_BANDS); return }
        const natives = reorderNatives(page.natives ?? [], new Set(from.flatMap(s => s.native ? [s.native] : [])), ctx.theme(), e.key === 'ArrowDown' ? 1 : -1, false, true)
        void ctx.apply({ scene: page.scene, natives, selection: from }); return
      }
      if (e.key === 'ArrowLeft') {
        let up = parent.slice(0, -1)
        while (up.length && !canHold(page.scene, up, ctx.theme())) up = up.slice(0, -1)
        if (parent.length) void move(from, { parent: up, index: up.length ? nodeAt(page.scene.root, up)?.c?.length ?? 0 : page.scene.root.length }, false)
        return
      }
      const list = parent.length ? nodeAt(page.scene.root, parent)?.c ?? [] : page.scene.root
      let k = list.length - 1
      while (k >= 0 && !canHold(page.scene, [...parent, k], ctx.theme())) k--
      if (k < 0) { ctx.note('there is no ordinary G child to hold the native'); return }
      void move(from, { parent: [...parent, k], index: list[k].c?.length ?? 0 }, false); return
    }
    const path = row.sel.path, parent = path.slice(0, -1), k = path.at(-1)!, root = row.sel.inDefs ? page.scene.defs : page.scene.root
    const list = parent.length ? nodeAt(root, parent)?.c ?? [] : root
    let to: { parent: number[]; index: number } | null = null
    if (e.key === 'ArrowUp' && k > 0) to = { parent, index: k - 1 }
    if (e.key === 'ArrowDown' && k + 1 < list.length) to = { parent, index: k + 2 }
    if (e.key === 'ArrowLeft' && parent.length) to = { parent: parent.slice(0, -1), index: parent.at(-1)! + 1 }
    if (e.key === 'ArrowRight' && k > 0 && foldKey(list[k - 1].op) === 'G') to = { parent: [...parent, k - 1], index: list[k - 1].c?.length ?? 0 }
    if (to) void move(moving(row.sel), to, !!row.sel.inDefs)
  }
  const rename = async (row: Row, input: HTMLInputElement) => {
    const value = input.value, id = first(row.node, 'ID')
    if (value === String(id ?? '')) return
    if (row.widget || row.native) { input.value = String(id ?? ''); ctx.note('widget uids cannot be renamed'); return }
    if (!value) { ctx.note('the id must not be empty'); return }
    const base = ctx.page().scene
    if (nodeAt(row.sel.inDefs ? base.defs : base.root, row.sel.path) !== row.node) { ctx.note('the node changed before the id was committed; not applied'); return }
    if (idsOf([base]).has(value) || ctx.page().natives?.some(n => n.uid === value)) {
      input.value = String(id ?? '')
      ctx.note(`id "${value}" is already in use on this page; not applied`)
      return
    }
    const old = textOf(id), map = old ? new Map([[old, value]]) : new Map<string, string>()
    let scene = map.size ? { ...base, root: renameIds(base.root, map), defs: renameIds(base.defs, map) } : base
    if (!map.size || typeof id === 'number') {
      const list = row.sel.inDefs ? scene.defs : scene.root, root = replaceAt(list, row.sel.path, withAttr(nodeAt(list, row.sel.path)!, 'id', value))
      if (!root) return
      scene = row.sel.inDefs ? { ...scene, defs: root } : { ...scene, root }
    }
    const natives = ctx.page().natives?.map(n => n.group && map.has(n.group) ? { ...n, group: map.get(n.group)! } : n)
    const why = await ctx.apply({ scene, ...(natives && { natives }), selection: [row.sel] }, { check: true })
    if (!why) ctx.note('custom Lua may still name the old id')
  }
  const drop = (e: DragEvent<HTMLElement>, to: { parent: number[]; index: number }, inDefs: boolean, beside?: { uid: string; after: boolean }) => {
    e.preventDefault(); e.stopPropagation()
    const held = dragging.current
    dragging.current = null
    if (!held) return
    if (held.pageId !== ctx.page().id || held.scene !== ctx.page().scene || held.natives !== ctx.page().natives) { ctx.note('the scene or natives changed during the drag; not applied'); return }
    void move(held.from, to, inDefs, beside)
  }
  const held = holders(page.scene, (page.natives ?? []).flatMap(n => n.group ? [n.group] : []), ctx.theme())
  const byParent = new Map<string, NativeRef[]>()
  for (const n of drawOrder(page.natives ?? [], ctx.theme())) {
    const key = (n.group && held.get(n.group) || []).join(), list = byParent.get(key) ?? []
    list.push(n); byParent.set(key, list)
  }
  const rows = (inDefs: boolean): Row[] => {
    const out: Row[] = [], path: number[] = [], frames = [{ list: inDefs ? page.scene.defs : page.scene.root, k: 0 }]
    const appendNatives = () => { if (!inDefs) for (const native of byParent.get(path.join()) ?? []) out.push({
      node: { op: native.type, attrs: { id: native.uid } }, sel: { pageId: page.id, path: [], native: native.uid }, widget: null, native, parent: [...path] }) }
    while (frames.length) {
      const f = frames[frames.length - 1]
      if (f.k === f.list.length) { appendNatives(); frames.pop(); path.pop(); continue }
      const node = f.list[f.k], sel: Selection = { pageId: page.id, path: [...path, f.k++], ...(inDefs && { inDefs }) }, widget = widgetOf(node, ctx.theme())
      out.push({ node, sel, widget })
      if (widget && expanded.has(identity(node))) for (const [part, p] of Object.entries(expandRoot(widget, ctx.theme()).exp.parts!)) {
        const path = [...sel.path, ...p], child = nodeAt(page.scene.root, path)
        if (child) out.push({ node: child, sel: { ...sel, path }, widget, part, widgetPath: sel.path })
      }
      if (!widget && (node.c?.length || !inDefs && byParent.has(sel.path.join())) && expanded.has(identity(node))) { path.push(sel.path.at(-1)!); frames.push({ list: node.c ?? [], k: 0 }) }
    }
    return out
  }
  return <div className="vb-layers" ref={container}>
    {[false, true].map(inDefs => {
      const Section = inDefs ? 'details' : 'section'
      return <Section key={String(inDefs)} className={inDefs ? 'disc' : undefined}>
      {inDefs ? <summary><span className="ptitle">Definitions</span><span className="unit">{page.scene.defs.length}</span></summary> : <h3 className="ptitle">Layers</h3>}
      <div role="tree" aria-label={inDefs ? 'Definition layers' : 'Root layers'} aria-multiselectable={!inDefs}
        onDragOver={e => e.preventDefault()} onDrop={e => drop(e, { parent: [], index: (inDefs ? page.scene.defs : page.scene.root).length }, inDefs)}>
        {rows(inDefs).map(row => {
          const { node, sel, widget, native, part } = row, id = first(node, 'ID'), key = keyOf(sel), identityKey = identity(node), isOpen = expanded.has(identityKey), hasChildren = !part && !native && (!!node.c?.length || !inDefs && byParent.has(sel.path.join()))
          const level = native ? row.parent!.length + 1 : part ? row.widgetPath!.length + 1 : sel.path.length
          const isHidden = native ? !!native.hidden : hidden(node), isLocked = native ? !!native.lock : !!node.comments?.some(isLock)
          return <div key={key} title={native ? NATIVE_DESCRIPTION : undefined} className={'vb-layer lrow' + (set.some(s => sameSelection(s, sel)) ? ' on sel' : '') + (isHidden || isLocked ? ' vb-layer-state' : '')} data-layer={key} role="treeitem" tabIndex={0} aria-level={level}
            aria-selected={set.some(s => sameSelection(s, sel))} aria-expanded={hasChildren ? isOpen : undefined}
            style={{ paddingInlineStart: `min(calc(${level - 1} * var(--sp7)), 25%)` }}
            onClick={e => { select(sel, e); e.currentTarget.focus() }}
            onDoubleClick={e => { if (!(e.target instanceof Element) || !e.target.closest('button, input')) enter(row) }} onKeyDown={e => onKey(row, e)}
            draggable={!part} onDragStart={e => { dragging.current = { scene: page.scene, natives: page.natives, pageId: page.id, from: moving(sel) }; e.dataTransfer.setData('text/plain', native ? `${native.type} ${native.uid}` : nameOf(node)); e.stopPropagation() }}
            onDragEnd={() => { dragging.current = null }} onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
            onDrop={e => {
              const b = e.currentTarget.getBoundingClientRect(), at = b.height ? (e.clientY - b.top) / b.height : 0.5
              if (native) {
                const parent = row.parent!, index = parent.length ? nodeAt(page.scene.root, parent)?.c?.length ?? 0 : page.scene.root.length
                drop(e, { parent, index }, false, { uid: native.uid, after: at > 0.5 }); return
              }
              const inside = foldKey(node.op) === 'G' && at > 0.25 && at < 0.75
              drop(e, inside ? { parent: sel.path, index: node.c?.length ?? 0 } : { parent: sel.path.slice(0, -1), index: sel.path.at(-1)! + (at > 0.5 ? 1 : 0) }, inDefs)
            }}>
            {hasChildren && <button className="ibtn flat" type="button" aria-label={isOpen ? 'Collapse' : 'Expand'} title={isOpen ? 'Collapse' : 'Expand'} aria-expanded={isOpen}
              onClick={e => { e.stopPropagation(); setExpanded(was => { const next = new Set(was); if (isOpen) next.delete(identityKey); else next.add(identityKey); return next }) }}><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} /><span className="vh">{isOpen ? '−' : '+'}</span></button>}
            <span className="vb-layer-kind"><Icon name={native || widget && !part ? 'widget' : inDefs ? 'file' : NODE_ICONS[foldKey(node.op)] ?? 'file'} /></span>
            <span className="vb-layer-name">{native ? `${native.type} ${native.uid} · drawn above the page` : part ?? nameOf(node)}{widget && !part && ` · ${widget.type} ${widget.uid}`}
              {isLocked && ' · locked'}{isHidden && ' · hidden'}
              {entered && sameSelection(entered, sel) && ' · entered'}
            </span>
            <input className="vb-layer-id unit" key={String(id ?? '')} aria-label="id" defaultValue={String(id ?? '')} readOnly={!!widget || !!native} title={widget || native ? 'Widget uid' : 'Node id'}
              onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onBlur={e => { void rename(row, e.currentTarget) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void rename(row, e.currentTarget) }
                else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.value = String(id ?? '') } }} />
            <button className="ibtn flat vb-layer-action" type="button" aria-label="Hide / show" title="Hide / show" onClick={e => { e.stopPropagation(); command(row, hide[0]) }}><Icon name={isHidden ? 'eye-off' : 'eye'} /><span className="vh">{isHidden ? 'Show' : 'Hide'}</span></button>
            {!part && <button className="ibtn flat vb-layer-action" type="button" aria-label="Lock / unlock" title="Lock / unlock" onClick={e => { e.stopPropagation(); command(row, lock[0]) }}><Icon name={isLocked ? 'lock' : 'unlock'} /><span className="vh">{isLocked ? 'Unlock' : 'Lock'}</span></button>}
          </div>
        })}
      </div>
    </Section>})}
    <p className="unit">Alt+Up/Down: reorder. Alt+Left: move out. Alt+Right: move into the group above.</p>
  </div>
}
