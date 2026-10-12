// The editor state: the project, the active page, the selection and undo history (one entry per edit, one per drag).
import { datum } from '../codegen/lua'
import { dataNames } from '../editor/fields'
import { designSize } from '../editor/geometry'
import { enterable, enterablePath } from '../editing/depth'
import { reflowEdits } from '../editing/layoutRecords'
import { defKey } from '../schema/duplicateIds'
import { first, foldKey } from '../srctext/props'
import { DEFAULT_THEME, gasColours, groundOf, THEMES, themeOf, themesOf, type Theme } from '../theme'
import { sanitizeTheme, THEME_FILE } from '../theme/file'
import { allocUid, detach, dropWidget, indexOf, isObject, markerOf, nativeAt, previewName, putWidget, reassociate, sanitize, slotsOf, takenUids, UID, widgetAt, widgetOf, widgetsIn, widgetRootOf } from '../widgets/core'
import { gradientDef, hasGradient } from '../widgets/paint'
import { resolveLinks } from '../theme/links'
import { editList, idsOf, mapTree } from '../editing/tree'
import { themeDefs } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import { legacyGasName } from '../widgets/modules/icon'
import type { Json, WidgetRef } from '../widgets/types'
import { editFrom, sanitizeEdit } from '../widgets/edits'
import { cascade, logicFrom, logicOf, renamed, type Binding, type Logic } from './logic'
import { newPage, newProject, VECTOR_FLOOR, type Page, type Project } from './project'
import type { Scene, SrcNode, Value } from './scene'
import { px, SHAPES, unitsOf, type ShapeKind } from './shapes'
import { nodeAt, replaceAt } from './tree'
export { nodeAt, replaceAt } from './tree'
import { sameData } from './same'
export { sameData } from './same'

/** native: a native widget's uid (Q10); its path is []. */
export type Selection = { pageId: string; path: number[]; inDefs?: boolean; native?: string }
/** The selection as a set: the primary and the others (`also`). */
export type Picked = { selection: Selection | null; also: Selection[] }
/** A history entry: a project and the set it had when it was left (an edit, an undo or a redo leaves it). Undo and redo
 *  bring back both, so the set is the one that belonged to that project: never another node now at a member's path. */
export type Entry = Picked & { project: Project }
// dragBase and dragSel: the project and the set an open drag started from (null when none is open).
// notice: what the last setScene or loadProject did besides the edit (a widget detached, natives left out), until the next
// edit, undo or redo.
export type State = Picked & { project: Project; activePageId: string; past: Entry[]; future: Entry[]; dragBase: Project | null;
  dragSel: Picked | null; notice: string; entered: { pageId: string; path: number[] } | null }
export type Action =
  | { type: 'setScene'; pageId: string; scene: Scene }                       // from the code pane: one history entry
  | { type: 'updateNode'; pageId: string; path: number[]; inDefs?: boolean; node: SrcNode; transient?: boolean }
  | { type: 'commitDrag' } | { type: 'cancelDrag' }
  | { type: 'select'; selection: Selection | null; also?: Selection[] }
  | { type: 'enter'; pageId: string; path: number[] }
  // A tool's or command's scene and the selection it chose: one entry, or a transient step.
  | { type: 'editScene'; pageId: string; scene: Scene; selection?: Selection | null; also?: Selection[]; transient?: boolean }
  | { type: 'undo' } | { type: 'redo' }
  | { type: 'addPage' } | { type: 'removePage'; pageId: string } | { type: 'renamePage'; pageId: string; name: string }
  | { type: 'setActivePage'; pageId: string } | { type: 'loadProject'; project: Project }
  | { type: 'setPageShape'; pageId: string; shape: ShapeKind; size?: { w: number; h: number } }   // size: for custom
  | { type: 'setPageBackground'; pageId: string; background: string[] | undefined }
  // Widgets (Task 3): insert by module type; set its params (a drag's steps are transient); detach into plain nodes; delete.
  | { type: 'insertWidget'; pageId: string; widget: string }
  | { type: 'setWidget'; pageId: string; ref: WidgetRef; transient?: boolean }
  | { type: 'detachWidget'; pageId: string; uid: string } | { type: 'deleteWidget'; pageId: string; uid: string }
  | { type: 'setPreview'; pageId: string; key: string; value: Json | undefined }   // undefined removes the value
  | { type: 'setTheme'; theme: string }   // a provided or project theme: every widget re-expanded, old-ground pages moved
  | { type: 'addTheme'; theme: Theme; use?: boolean }
  | { type: 'removeTheme'; id: string }
  // The live data (M3): a patch of any of the Logic fields (one undo step, or a transient step), then the reference cascade.
  | { type: 'setLogic'; patch: Partial<Logic>; transient?: boolean }
  | { type: 'renameLogic'; kind: 'role' | 'read' | 'state'; from: string; to: string }

const HISTORY = 200

export function initialState(p: Project = newProject()): State {
  return { project: p, activePageId: p.pages[0].id, selection: null, also: [], past: [], future: [], dragBase: null, dragSel: null, notice: '', entered: null }
}

const list = (scene: Scene, inDefs?: boolean) => inDefs ? scene.defs : scene.root

/** The selection as a set: the others, then the primary (the one the panel, the code pane and the breadcrumb show). */
export const selected = (s: State): Selection[] => s.selection ? [...s.also, s.selection] : []

// A set's members: each on the primary's page, resolving, once (the last mention of a path), none inside another member
// (a group and its child never both move), each snapped to its widget's root first (M2b Q2). A DEFS node is a lone
// primary, and so is one that does not resolve (as a select without also keeps it; settled clears it after an edit), a
// native among them (its path [] resolves to no node): no other member is promoted in its place.
// Numeric trie edges keep duplicate and ancestor checks linear in the supplied path indices.
function members(s: State, primary: Selection | null, also: readonly Selection[] = []): Picked {
  const p = snap(s, primary), root = p && s.project.pages.find(x => x.id === p.pageId)?.scene.root
  if (!p || p.inDefs || !also.length || !root || !nodeAt(root, p.path)) return { selection: p, also: [] }
  const all = [...also.map(x => snap(s, x)!), p].filter(x => !x.inDefs && x.pageId === p.pageId && nodeAt(root, x.path))
  type Path = { last: number; kids?: Map<number, Path> }
  const top: Path = { last: -1 }
  all.forEach((x, i) => {
    let t = top
    for (const k of x.path) {
      const kids = t.kids ??= new Map<number, Path>()
      let next = kids.get(k)
      if (!next) kids.set(k, next = { last: -1 })
      t = next
    }
    t.last = i
  })
  const kept = all.filter((x, i) => {
    let t = top
    for (const k of x.path) {
      if (t.last >= 0) return false
      t = t.kids!.get(k)!
    }
    return t.last === i
  })
  return { selection: kept[kept.length - 1] ?? null, also: kept.slice(0, -1) }
}
// The path of the first node, in pre-order, whose `id` attribute is each of `ids`. One walk for them all, an explicit
// stack and one path (copied once per id found): any depth.
const findIds = (nodes: SrcNode[], ids: ReadonlySet<string>): Map<string, number[]> => {
  const found = new Map<string, number[]>(), frames = [{ list: nodes, k: 0 }], path: number[] = []
  while (frames.length && found.size < ids.size) {
    const f = frames[frames.length - 1]
    if (f.k === f.list.length) { frames.pop(); path.pop(); continue }
    const n = f.list[f.k], id = first(n, 'ID')
    path.push(f.k++)
    if (typeof id === 'string' && ids.has(id) && !found.has(id)) found.set(id, [...path])
    if (n.c?.length) frames.push({ list: n.c, k: 0 })
    else path.pop()
  }
  return found
}

// Whether `b` is `a` with only the node at `path` replaced, as replaceAt makes it (the panel's edits): each list along the
// path keeps its length and every node off the path is the same object. A reorder or an insertion fails it, and so does
// a re-parse (new objects). One pass down the path: any depth.
const onlyAt = (a: SrcNode[], b: SrcNode[], path: number[]) => {
  for (let d = 0, x: SrcNode[] | undefined = a, y: SrcNode[] | undefined = b; d < path.length; d++) {
    const k = path[d], ys: SrcNode[] | undefined = y
    if (!x?.[k] || !ys?.[k] || x.length !== ys.length || x.some((n, i) => i !== k && n !== ys[i])) return false
    x = x[k].c; y = ys[k].c
  }
  return true
}

/** `sel`, or its widget's root when it points inside one (owner decision Q2). */
export function snap(s: State, sel: Selection | null): Selection | null {
  const page = sel && !sel.inDefs && sel.path.length > 1 ? s.project.pages.find(p => p.id === sel.pageId) : undefined
  const root = page && widgetRootOf(page.scene, sel!.path, themeOf(s.project))
  return root && !(s.entered?.pageId === sel!.pageId && sameSelection(s.entered, { ...sel!, path: root })) ? { ...sel!, path: root } : sel
}
export const sameSelection = (a: Selection | null, b: Selection | null) =>
  a === b || (!!a && !!b && a.pageId === b.pageId && !!a.inDefs === !!b.inDefs && a.native === b.native && a.path.join() === b.path.join())

// The active page exists, and the selection points at a node or a native the page holds, or is null; the set is the
// members of what is left (members: each snapped to its widget's root, the primary too, after the roots shifted).
function settled(s: State): State {
  const sel = s.selection, page = s.project.pages.find(p => p.id === sel?.pageId)
  const there = sel && page && (sel.native !== undefined ? page.natives?.some(n => n.uid === sel.native) : nodeAt(list(page.scene, sel.inDefs), sel.path))
  const activePageId = s.project.pages.some(p => p.id === s.activePageId) ? s.activePageId : s.project.pages[0].id
  const enteredPage = s.entered && s.project.pages.find(p => p.id === s.entered!.pageId)
  const path = enteredPage && enteredPage.id === activePageId ? enterablePath(enteredPage.scene, s.entered!.path, themeOf(s.project)) : []
  const entered = path.length ? { pageId: activePageId, path } : null
  const next = { ...s, activePageId, entered }
  return { ...next, ...(there ? members(next, sel, s.also) : { selection: null, also: [] }) }
}

// The state's project and set, as a history entry.
const entry = (s: State): Entry => ({ project: s.project, selection: s.selection, also: s.also })

// An open drag closed as one history entry (the project and the set it started from), or as none when it ends where it
// began (out and back, or every step the scene it started from): the project it started from comes back as it was, redo
// stays, and the selection stays the one the gesture left. Every caller closes a drag here: sceneDrag, a nudge burst, a
// widget's drag in its panel, an undo, the next edit. Closing one clears the notice, as an edit does.
function committed(s: State): State {
  if (!s.dragBase) return s
  if (sameData(s.dragBase, s.project)) return { ...s, project: s.dragBase, dragBase: null, dragSel: null, notice: '' }
  return { ...s, past: [...s.past, { ...s.dragSel!, project: s.dragBase }].slice(-HISTORY), future: [], dragBase: null, dragSel: null, notice: '' }
}

// One history entry: the project and the set before the edit. A drag still open is committed first, so it keeps its own.
// It clears the notice.
function edit(s: State, project: Project): State {
  const t = committed(s)
  return { ...t, project, past: [...t.past, entry(t)].slice(-HISTORY), future: [], notice: '' }
}

// A transient step: the drag's first one keeps the project and the set it started from, for commit and cancel.
const step = (s: State, project: Project): State =>
  s.dragBase ? { ...s, project } : { ...s, project, dragBase: s.project, dragSel: { selection: s.selection, also: s.also } }

/** A page's preview values from a project that may come from outside: names (previewName) to what the data element can carry. */
const previewOf = (v: unknown): Record<string, Json> => Object.fromEntries(Object.entries(isObject(v) ? v : {})
  .flatMap(([k, x]) => { const d = datum(x); return previewName(k) && d !== undefined ? [[k, d]] : [] }))

const withScene = (p: Project, pageId: string, scene: Scene): Project =>
  ({ ...p, pages: p.pages.map(x => x.id === pageId ? { ...x, scene } : x) })
const withNatives = (p: Project, page: Page, natives: WidgetRef[]): Project => ({ ...p, pages: p.pages.map(x => x === page ? { ...x, natives } : x) })
/** A page's natives from a project that may come from outside: objects of a native type with a valid uid that is not in
 *  `seen` (the project's scene widgets and the natives read before: Q14), which takes each one kept. */
function nativesFrom(v: unknown, t: Theme, seen: Set<string>, repairs: string[]): WidgetRef[] {
  return (Array.isArray(v) ? v : []).flatMap(n => {
    const m = isObject(n) && typeof n.type === 'string' ? WIDGETS[n.type] : undefined
    if (!m?.native || typeof n.uid !== 'string' || !UID.test(n.uid) || seen.has(n.uid)) return []
    seen.add(n.uid)
    const params = sanitize(m, n.params, t)
    const name = m.type === 'icon' && params.kind === 'gas' ? legacyGasName(String(params.name)) : undefined
    if (name) { repairs.push(`icon ${n.uid}: ${params.name} -> ${name}`); params.name = name }
    return [{ type: m.type, uid: n.uid, params }]
  })
}

/** A page's preview values once its scene went from `before` to `after`: a value follows its slot's rename, and one only
 *  a deleted or renamed slot read goes, so a later widget given that uid does not inherit it. A name another slot still
 *  reads stays, and so do a detached widget's (its nodes still read them), one a widget still holds as the rename of a
 *  slot it lacks now (a Bar's state while its colour is automatic: switching back finds the value), and any name no slot
 *  read. */
function carried(preview: Record<string, Json>, before: Scene, after: Scene, t: Theme): Record<string, Json> {
  const slots = (s: Scene) => new Map(widgetsIn(s, t).map(({ path, ref }) => {
    const live = slotsOf(nodeAt(s.root, path)!, t), keys = ref.params.keys
    return [ref.uid, [...live, ...isObject(keys) ? Object.entries(keys)
      .filter(([slot, key]) => typeof key === 'string' && !live.some(s => s.slot === slot))
      .map(([slot, key]) => ({ slot, key: key as string })) : []]] as const
  }))
  const was = slots(before), now = slots(after), ids = idsOf([after])
  const read = new Set([...now.values()].flatMap(k => k.map(s => s.key)))
  const held = new Set(widgetsIn(after, t).flatMap(({ ref }) => { const k = ref.params.keys; return isObject(k) ? Object.values(k).filter(v => typeof v === 'string') : [] }))
  let out = preview
  for (const [uid, ks] of was) {
    if (!now.has(uid) && ids.has(uid)) continue   // detached
    const to = new Map((now.get(uid) ?? []).map(s => [s.slot, s.key]))
    for (const s of ks) {
      if (read.has(s.key) || held.has(s.key) || !Object.hasOwn(out, s.key)) continue
      const { [s.key]: v, ...rest } = out, key = to.get(s.slot)
      out = key !== undefined && !Object.hasOwn(rest, key) ? { ...rest, [key]: v } : rest
    }
  }
  return out
}
/** The bindings once page `page`'s scene became `scene`: each follows its slot's rename and goes with a deleted slot, as
 *  preview values do (carried), unless a page still reads that name: another page, or a node of `scene` (a raw `$name`;
 *  a binding is project-wide and the player's wiring, where a preview value is the page's sample). */
function bindingsCarried(p: Project, page: Page, scene: Scene, t: Theme): Record<string, Binding> {
  let out: Record<string, Binding>
  // A scene the editor cannot read (a loaded project's, kept for the checker to report: a removed page's) moves nothing.
  try { out = carried(p.bindings as unknown as Record<string, Json>, page.scene, scene, t) as unknown as Record<string, Binding> } catch { return p.bindings }
  if (out === p.bindings) return out
  // Another page that cannot be read may read any name: no binding goes.
  const others = p.pages.filter(x => x !== page).map(x => namesRead(x.scene, t)), blind = others.includes(null)
  const elsewhere = new Set([...dataNames(scene), ...others.flatMap(n => n ?? [])])
  const back = Object.entries(p.bindings).filter(([k]) => !Object.hasOwn(out, k) && (blind || elsewhere.has(k)))
  return back.length ? { ...out, ...Object.fromEntries(back) } : out
}
/** Names the scene reads or holds as an inactive slot rename, or null for a scene the editor cannot read. */
function namesRead(scene: Scene, t: Theme): string[] | null {
  try { return [...widgetsIn(scene, t).flatMap(({ path, ref }) => {
    const keys = ref.params.keys
    return [...slotsOf(nodeAt(scene.root, path)!, t).map(s => s.key), ...isObject(keys) ? Object.values(keys).filter((k): k is string => typeof k === 'string') : []]
  }), ...dataNames(scene)] } catch { return null }
}
/** `bindings` without those of the natives `uids` (keyed `@<uid>.<prop>`; a native's uid is one in the project, Q14), for
 *  a delete: a native given that uid later does not inherit them. */
function withoutNatives(bindings: Record<string, Binding>, uids: string[]): Record<string, Binding> {
  const gone = (k: string) => uids.some(u => k.startsWith(`@${u}.`))
  return Object.keys(bindings).some(gone) ? Object.fromEntries(Object.entries(bindings).filter(([k]) => !gone(k))) : bindings
}
/** `preview` with the samples of `widgets` (detached in this edit: their nodes read their data names still, and nothing
 *  sends a detached widget's samples) pinned under each name not pinned already and not read by a widget of `scene`.
 *  A detached widget's labels and colours keep drawing as they did, and no unresolved name appears (the final review). */
function pinned(preview: Record<string, Json> | undefined, widgets: WidgetRef[], scene: Scene, t: Theme): Record<string, Json> | undefined {
  if (!widgets.length) return preview
  const live = new Set(widgetsIn(scene, t).flatMap(({ path }) => slotsOf(nodeAt(scene.root, path)!, t).map(s => s.key)))
  let out = preview
  for (const w of widgets) for (const s of WIDGETS[w.type].expand(w.params, t, w.uid).slots) {
    const d = datum(s.sample)
    if (d !== undefined && !live.has(s.key) && !(out && Object.hasOwn(out, s.key))) out = { ...out, [s.key]: d }
  }
  return out
}
/** withScene, carrying the page's preview values (`carried`) and pinning the samples of the widgets `dropped` detached. */
function withSceneCarried(p: Project, pageId: string, scene: Scene, dropped: WidgetRef[] = []): Project {
  const page = p.pages.find(x => x.id === pageId)!, t = themeOf(p)
  const preview = pinned(page.preview && carried(page.preview, page.scene, scene, t), dropped, scene, t)
  const bindings = bindingsCarried(p, page, scene, t)
  return { ...p, ...(bindings !== p.bindings && { bindings }), pages: p.pages.map(x => x === page ? { ...x, scene, ...(preview !== page.preview && { preview }) } : x) }
}
/** What a setScene or a load says of the widgets it detached: edited by hand, or holding a uid already used (Q14). */
const detachedNotice = (detached: string[], reused: string[], undo = true) => [
  ...(detached.length ? [`detached ${detached.join(', ')}: edited by hand`] : []),
  ...(reused.length ? [`detached ${reused.join(', ')}: ${reused.length > 1 ? 'their uids are' : 'its uid is'} used already (a uid is one in the project)`] : []),
].join('; ') + (undo && detached.length + reused.length ? ' (Ctrl+Z puts it back)' : '')

// `record` with `key` set to `value`: the first key that matches it case-insensitively keeps its spelling and place;
// without one, the key is appended.
const withKey = (record: Record<string, Value>, key: string, value: Value): Record<string, Value> =>
  ({ ...record, [Object.keys(record).find(k => foldKey(k) === foldKey(key)) ?? key]: value })

/** `scene` with every widget expanded in `to` (its params read again in `to`; the marker keeps its params). ponytail: one
 *  putWidget per widget, each finding its root by a scan, so O(roots × widgets); index the roots if a page holds hundreds. */
function rethemed(scene: Scene, from: Theme, to: Theme, report: { missing: Set<string>; stale: number; layout: string[] }): Scene {
  const widget = (n: SrcNode) => !!widgetOf(n, from)
  const resolve = (n: SrcNode) => {
    if (widget(n)) return n
    const r = resolveLinks(n, from, to)
    for (const name of r.missing) report.missing.add(name)
    report.stale += r.stale
    return r.node
  }
  const resolved = { ...scene, root: mapTree(scene.root, resolve, widget), defs: mapTree(scene.defs, resolve) }
  let out = sameData(resolved, scene) ? scene : resolved
  const seen = new Set<string>()
  for (const { ref: w } of widgetsIn(scene, from)) {
    // A uid seen twice (setScene and loadProject detach the second; a guard all the same) keeps its first, as in
    // reassociate: putWidget finds the first root by uid, so the second's params would overwrite it.
    if (!w || seen.has(w.uid)) continue
    seen.add(w.uid)
    out = putWidget(out, { ...w, params: sanitize(WIDGETS[w.type], w.params, to) }, to)
  }
  const fresh = themeDefs([...out.root, ...out.defs], to).filter(d => !out.defs.some(old => defKey(old) === defKey(d)))
  const laid = reflowEdits(scene, themeGradients(fresh.length ? { ...out, defs: [...out.defs, ...fresh] } : out, to), to)
  report.layout.push(...laid.skipped)
  return laid.scene
}
/** `scene` with every `theme_<name>` gradient `to` has in its colours: one no widget uses any more, or a plain node paints
 *  with (ruling 3: theme_ defs are the builder's), would keep another theme's or an older palette's otherwise. */
function themeGradients(scene: Scene, to: Theme): Scene {
  const defs = scene.defs.map(d => {
    const id = first(d, 'ID'), name = typeof id === 'string' && id.startsWith('theme_') ? id.slice(6) : ''
    return name && hasGradient(to, name) && defKey(d) === `gradient ${id}` ? gradientDef(to, name) : d
  })
  return defs.some((d, k) => d !== scene.defs[k]) ? { ...scene, defs } : scene
}
function dropUnusedThemeGradients(scene: Scene, customLua: string): Scene {
  const used = new Set<string>(), nodes = [...scene.root, ...scene.defs]
  while (nodes.length) {
    const n = nodes.pop()!, values = Object.values(n.attrs)
    while (values.length) {
      const v = values.pop()!
      if (typeof v === 'string' && v.startsWith('@theme_')) used.add(v.slice(1))
      else if (Array.isArray(v)) for (const child of v) values.push(child)
    }
    for (const child of n.c ?? []) nodes.push(child)
  }
  const defs = scene.defs.filter(d => {
    const id = first(d, 'ID')
    return typeof id !== 'string' || !id.startsWith('theme_') || defKey(d) !== `gradient ${id}`
      || used.has(id) || customLua.includes(id)
  })
  return defs.length === scene.defs.length ? scene : { ...scene, defs }
}
// A loaded project's background is any non-empty array (the shell replaces what is not a colour): no toUpperCase on a non-string.
const sameColours = (a: unknown[] | undefined, b: string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((c, i) => typeof c === 'string' && c.toUpperCase() === b[i].toUpperCase())

const isShape = (s: unknown): s is ShapeKind => s === 'custom' || typeof s === 'string' && Object.hasOwn(SHAPES, s)

function widgetEdits(before: Scene, after: Scene, t: Theme, candidates: Theme[]): { scene: Scene; notice: string } | { refused: string } {
  const old = new Map(widgetsIn(before, t).map(({ path, ref: w }) => [w.uid, { n: nodeAt(before.root, path)!, w }]))
  const present = findIds(after.root, new Set(old.keys()))
  for (const path of present.values()) if (!widgetAt(after, path, t)) return { refused: "a widget's structure changes through Detach" }
  let scene = after, notice = ''
  for (const { path, ref: w } of widgetsIn(after, t)) {
    const n = nodeAt(after.root, path)!, was = old.get(w.uid)
    if (was && was.w.type !== w.type) return { refused: "a widget's structure changes through Detach" }
    if (!was || n === was.n) continue
    if (n.comments!.at(-1) !== was.n.comments!.at(-1)) {
      const checked = reassociate({ ...before, root: [was.n] }, { ...after, root: [n] }, t, undefined, false, candidates)
      if (checked.detached.length) return { refused: "a widget's structure changes through Detach" }
      continue
    }
    if (sameData(n.attrs, was.n.attrs) && sameData(n.c, was.n.c)) continue
    const result = editFrom(was.w, t, was.n, n)
    if ('refused' in result) return result
    const pairs: [SrcNode, SrcNode][] = [[was.n, n]]
    while (pairs.length) {
      const [a, b] = pairs.pop()!
      for (const k of Object.keys(a.attrs)) if (['F', 'S', 'S_'].includes(foldKey(k)) && typeof a.attrs[k] === 'string'
        && /^[=$]/.test(a.attrs[k] as string) && typeof b.attrs[k] === 'string' && !/^[=$]/.test(b.attrs[k] as string)) notice = 'replaces the state colour'
      a.c?.forEach((c, i) => pairs.push([c, b.c![i]]))
    }
    scene = putWidget(scene, result.ref, t)
  }
  const laid = reflowEdits(before, scene, t)
  return { scene: laid.scene, notice: [notice, ...laid.skipped].filter(Boolean).join('; ') }
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'setScene': {
      const page = s.project.pages.find(p => p.id === a.pageId)
      if (!page) return s
      // Widgets edited by hand, or pasted with a uid another page uses, are detached (their markers dropped); `scene` is
      // a.scene itself when none is.
      const { scene, detached, reused, dropped } = reassociate(page.scene, a.scene, themeOf(s.project), takenUids(s.project, page.id), false, themesOf(s.project))
      const next = { ...edit(s, withSceneCarried(s.project, a.pageId, scene, dropped)), notice: detachedNotice(detached, reused) }
      const sel = s.selection
      if (sel?.pageId !== a.pageId) return settled(next)
      // Each member re-resolved (the others share the primary's page and tree): the same path while the node there keeps
      // the old node's id (ids may repeat: a second R id=a stays selected) or is the only node changed (an in-place edit,
      // even of its id while a twin keeps the old one), else the first node with that id, else the same path. One walk
      // finds every id. Then the set again (members): two members re-found as one node, or one inside another, are one.
      // Compared with the scene that lands (reassociate's: markers dropped, defs added), not the one sent.
      const was = list(page.scene, sel.inDefs), now = list(scene, sel.inDefs)
      const lost = (x: Selection) => {
        const old = nodeAt(was, x.path), id = old && first(old, 'ID'), at = nodeAt(now, x.path)
        return typeof id === 'string' && id && !(at && first(at, 'ID') === id) && !onlyAt(was, now, x.path) ? id : undefined
      }
      const set = [...s.also, sel], ids = set.map(lost), wanted = new Set(ids.filter(id => id !== undefined))
      const found = wanted.size ? findIds(now, wanted) : undefined
      const moved = set.map((x, i) => { const path = ids[i] && found?.get(ids[i]); return path ? { ...x, path } : x })
      return settled({ ...next, ...members(next, moved[moved.length - 1], moved.slice(0, -1)) })
    }
    case 'updateNode': {
      const page = s.project.pages.find(p => p.id === a.pageId)
      const nodes = page && replaceAt(list(page.scene, a.inDefs), a.path, a.node)
      if (!page || !nodes) return s
      const old = !a.inDefs ? widgetAt(page.scene, a.path, themeOf(s.project)) : null
      const next = old && widgetOf(a.node, themeOf(s.project))
      if (old && (next?.uid !== old.uid || next.type !== old.type)) return { ...s, notice: "a widget's structure changes through Detach" }
      const routed = widgetEdits(page.scene, a.inDefs ? { ...page.scene, defs: nodes } : { ...page.scene, root: nodes }, themeOf(s.project), themesOf(s.project))
      if ('refused' in routed) return { ...s, notice: routed.refused }
      if (!a.transient && sameData(page.scene, routed.scene)) return settled({ ...s, notice: routed.notice })
      const project = withScene(s.project, a.pageId, routed.scene)
      return { ...settled(a.transient ? step(s, project) : edit(s, project)), notice: routed.notice || (a.transient ? s.notice : '') }
    }
    case 'commitDrag': {
      const next = committed(s)
      return s.notice.includes('reorder them in the layers panel') ? { ...next, notice: s.notice } : next
    }
    // The project and the set the drag started from: a drawing tool's Esc does not leave its new node's path selected.
    case 'cancelDrag':
      return s.dragBase ? settled({ ...s, project: s.dragBase, ...s.dragSel, dragBase: null, dragSel: null }) : s
    // The same set again (after the snap to widget roots) is the same state.
    case 'select': {
      const set = members(s, a.selection, a.also)
      return sameSelection(set.selection, s.selection) && set.also.length === s.also.length
        && set.also.every((x, i) => sameSelection(x, s.also[i])) ? s : { ...s, ...set }
    }
    case 'enter': {
      const page = s.project.pages.find(p => p.id === a.pageId)
      if (!page || page.id !== s.activePageId || a.path.length && !enterable(page.scene, a.path, themeOf(s.project))) return s
      return { ...s, entered: a.path.length ? { pageId: a.pageId, path: [...a.path] } : null, selection: null, also: [] }
    }
    // A tool's or command's whole scene, with the selection it chose (omitted: the set stays, where it still resolves).
    // No id re-resolution, unlike setScene: the command knows where its nodes went. A scene equal to the page's is no
    // edit (a no-op command, an unhide all with nothing hidden): no undo step, redo kept; only the selection it names.
    case 'editScene': {
      const page = s.project.pages.find(p => p.id === a.pageId)
      if (!page) return s
      const routed = widgetEdits(page.scene, a.scene, themeOf(s.project), themesOf(s.project))
      if ('refused' in routed) return { ...s, notice: routed.refused }
      const same = !a.transient && sameData(page.scene, routed.scene)
      if (same && a.selection === undefined) return routed.notice ? { ...s, notice: routed.notice } : s
      // A delete's widgets take the preview values only their slots read (as deleteWidget); a transient step (a drag, a
      // nudge) adds and removes no widget.
      const next = same ? s : a.transient ? step(s, withScene(s.project, a.pageId, routed.scene)) : edit(s, withSceneCarried(s.project, a.pageId, routed.scene))
      const set = a.selection === undefined ? { selection: s.selection, also: s.also } : members(next, a.selection, a.also)
      return settled({ ...next, ...set, notice: routed.notice })
    }
    case 'setActivePage':
      return s.project.pages.some(p => p.id === a.pageId) ? { ...s, activePageId: a.pageId, entered: a.pageId === s.activePageId ? s.entered : null } : s
    // An open drag is committed first, so undo takes it back as one step. Undo brings back the set the edit started
    // from, redo the one its result had when the undo left it (entry).
    case 'undo': {
      const t = reducer(s, { type: 'commitDrag' })
      if (!t.past.length) return t
      return settled({ ...t, ...t.past[t.past.length - 1], past: t.past.slice(0, -1), future: [entry(t), ...t.future], notice: '' })
    }
    case 'redo': {
      const t = reducer(s, { type: 'commitDrag' })
      if (!t.future.length) return t
      return settled({ ...t, ...t.future[0], future: t.future.slice(1), past: [...t.past, entry(t)], notice: '' })
    }
    case 'insertWidget': {
      const page = s.project.pages.find(p => p.id === a.pageId), m = WIDGETS[a.widget]
      if (!page || !m) return s
      const t = themeOf(s.project), size = designSize(page.scene.header)
      const d = sanitize(m, { ...m.defaults(t, { pages: s.project.pages.map(p => ({ id: p.id, name: p.name })), page: page.id, size }),
        ...(t.widgetDefaults && Object.hasOwn(t.widgetDefaults, m.type) ? t.widgetDefaults[m.type] : {}) }, t)
      const ref: WidgetRef = { type: m.type, uid: allocUid(s.project, m.prefix),
        params: sanitize(m, { ...d, x: Math.round(size.w / 2 - (d.w as number) / 2), y: Math.round(size.h / 2 - (d.h as number) / 2) }, t) }
      // The new widget is selected alone.
      if (m.native) return { ...edit(s, withNatives(s.project, page, [...(page.natives ?? []), ref])), selection: { pageId: page.id, path: [], native: ref.uid }, also: [] }
      const parent = s.entered?.pageId === page.id ? s.entered.path : []
      if (widgetRootOf(page.scene, parent, t)) return { ...s, notice: 'cannot insert a widget inside a widget' }
      const made = putWidget({ ...page.scene, root: [] }, ref, t)
      const root = editList(page.scene.root, parent, list => [...list, made.root[0]])
      if (!root) return s
      const laid = reflowEdits(page.scene, { ...made, root }, t), path = [...parent, (parent.length ? nodeAt(root, parent)!.c! : root).length - 1]
      return { ...edit(s, withScene(s.project, page.id, laid.scene)), selection: { pageId: page.id, path }, also: [], notice: laid.skipped.join('; ') }
    }
    case 'setWidget': {
      const page = s.project.pages.find(p => p.id === a.pageId), m = WIDGETS[a.ref.type], t = themeOf(s.project)
      if (!page || !m) return s
      // A known widget of the same type: a native in the page's natives, else a root in its scene.
      const k = m.native ? null : indexOf(page.scene, a.ref.uid, t)
      const was = m.native ? nativeAt(page, a.ref.uid, t) : k ? widgetAt(page.scene, k, t) : null
      if (was?.type !== a.ref.type) return s
      const ref = { ...a.ref, params: sanitize(m, a.ref.params, t), edit: m.native ? undefined : sanitizeEdit(Object.hasOwn(a.ref, 'edit') ? a.ref.edit : was.edit) }
      if (markerOf(ref) === markerOf(was)) return s   // nothing changes (a drag of under half a unit): no history entry
      if (m.native) return (a.transient ? step : edit)(s, withNatives(s.project, page, (page.natives ?? []).map(n => n.uid === ref.uid ? ref : n)))
      // putWidget keeps the root at k. A widget that reads every data name it read (a move, a resize, a colour) leaves
      // nothing to carry, and withSceneCarried would read every root's marker at each step of a drag.
      const laid = reflowEdits(page.scene, putWidget(page.scene, ref, t), t), scene = laid.scene, read = new Set(slotsOf(nodeAt(scene.root, k!)!, t).map(x => x.key))
      const project = slotsOf(nodeAt(page.scene.root, k!)!, t).every(x => read.has(x.key)) ? withScene(s.project, page.id, scene) : withSceneCarried(s.project, page.id, scene)
      return { ...(a.transient ? step(s, project) : edit(s, project)), notice: laid.skipped.join('; ') }
    }
    case 'detachWidget': case 'deleteWidget': {
      const page = s.project.pages.find(p => p.id === a.pageId), t = themeOf(s.project)
      // A native first, with its bindings: the scene branch below returns the state unchanged for a uid it does not find.
      if (a.type === 'deleteWidget' && page?.natives?.some(n => n.uid === a.uid)) return settled(edit(s,
        { ...withNatives(s.project, page, page.natives.filter(n => n.uid !== a.uid)), bindings: withoutNatives(s.project.bindings, [a.uid]) }))
      const k = page ? indexOf(page.scene, a.uid, t) : null
      if (!k) return s
      // Detached in one entry with its samples pinned: its nodes keep drawing as they did (withSceneCarried).
      if (a.type === 'detachWidget') return settled(edit(s, withSceneCarried(s.project, page!.id, detach(page!.scene, a.uid, t), [widgetAt(page!.scene, k, t)!])))
      // A delete shifts the roots after it: a member on the widget goes, one on a later root moves down with its node (the
      // primary gone, the set goes with it, as settled has it).
      const shift = (x: Selection) => {
        const d = k.length - 1
        if (x.pageId !== page!.id || x.inDefs || x.path.length <= d || !k.slice(0, d).every((v, i) => x.path[i] === v)) return x
        return x.path[d] === k[d] ? null : x.path[d] > k[d] ? { ...x, path: x.path.map((v, i) => i === d ? v - 1 : v) } : x
      }
      const also = s.also.map(shift).filter(x => x !== null)
      const laid = reflowEdits(page!.scene, dropWidget(page!.scene, a.uid, t), t)
      return settled({ ...edit(s, withSceneCarried(s.project, page!.id, laid.scene)), selection: s.selection && shift(s.selection), also, notice: laid.skipped.join('; ') })
    }
    case 'setPreview': {
      // Only what the data element can carry (datum); a value equal to the one held, or the removal of one not held, is no edit.
      const page = s.project.pages.find(p => p.id === a.pageId), value = a.value === undefined ? undefined : datum(a.value)
      if (!page || !previewName(a.key) || (a.value !== undefined && value === undefined)) return s
      const { [a.key]: _, ...rest } = page.preview ?? {}
      if (JSON.stringify(page.preview && Object.hasOwn(page.preview, a.key) ? page.preview[a.key] : undefined) === JSON.stringify(value)) return s
      const preview = value === undefined ? rest : { ...rest, [a.key]: value }
      return edit(s, { ...s.project, pages: s.project.pages.map(p => p === page ? { ...p, preview } : p) })
    }
    case 'setTheme': case 'addTheme': {
      // An own key only: an outside name such as `constructor` is no theme.
      const id = a.type === 'addTheme' ? a.theme.id : a.theme, from = themeOf(s.project)
      if (a.type === 'addTheme' && (!/^ds-[a-z0-9-]{1,64}$/.test(id) || Object.hasOwn(THEMES, id))) return { ...s, notice: 'cannot replace a provided theme; imported theme ids must start with ds-' }
      const project = a.type === 'addTheme' ? { ...s.project, themes: Object.assign(Object.create(null), s.project.themes, { [id]: a.theme }) } : s.project
      if (a.type === 'addTheme' && a.use === false && id !== s.project.theme) return edit(s, project)
      const to = Object.hasOwn(THEMES, id) ? THEMES[id] : project.themes && Object.hasOwn(project.themes, id) ? project.themes[id] : undefined
      if (!to || to === from && project === s.project) return s
      const report = { missing: new Set<string>(), stale: 0, layout: [] as string[] }
      const ground = groundOf(from), pages = project.pages.map(p => ({ ...p, scene: dropUnusedThemeGradients(rethemed(p.scene, from, to, report), project.customLua),
        background: sameColours(p.background, ground) ? groundOf(to) : p.background }))
      const notice = [report.missing.size && `missing theme style tokens: ${[...report.missing].join(', ')}`,
        report.stale && `${report.stale} style link${report.stale === 1 ? '' : 's'} severed; authored values kept`, ...new Set(report.layout)].filter(Boolean).join('; ')
      return { ...settled(edit(s, { ...project, theme: id, pages })), notice }
    }
    case 'removeTheme': {
      if (!s.project.themes || !Object.hasOwn(s.project.themes, a.id)) return s
      if (a.id === s.project.theme) return { ...s, notice: `cannot remove ${s.project.themes[a.id].name}: it is the current theme; choose another theme first` }
      const themes = Object.assign(Object.create(null), s.project.themes)
      delete themes[a.id]
      return edit(s, { ...s.project, themes })
    }
    case 'addPage': {
      const page = newPage(s.project)
      return { ...edit(s, { ...s.project, pages: [...s.project.pages, page] }), activePageId: page.id, entered: null }
    }
    case 'removePage': {
      const k = s.project.pages.findIndex(p => p.id === a.pageId)
      if (k < 0 || s.project.pages.length === 1) return s   // a project keeps at least one page
      const pages = s.project.pages.filter((_, i) => i !== k)
      const active = s.activePageId === a.pageId ? pages[Math.min(k, pages.length - 1)].id : s.activePageId
      // The page's widgets and natives go as a delete takes them (bindingsCarried against an empty scene, withoutNatives):
      // a binding only their slots read goes with them, so a widget given that uid later does not inherit it. Its preview
      // values leave with the page.
      const page = s.project.pages[k], t = themeOf(s.project)
      const bindings = withoutNatives(bindingsCarried(s.project, page, { header: {}, defs: [], root: [] }, t), (page.natives ?? []).map(n => n.uid))
      return settled({ ...edit(s, { ...s.project, pages, ...cascade(logicOf({ ...s.project, bindings }), pages.map(p => p.id)) }), activePageId: active })
    }
    case 'renamePage': {
      const page = s.project.pages.find(p => p.id === a.pageId)
      if (!page || page.name === a.name) return s
      return edit(s, { ...s.project, pages: s.project.pages.map(p => p === page ? { ...p, name: a.name } : p) })
    }
    case 'loadProject': {
      // Sizes are clamped once, here, so an outside project cannot hand Exports.Load or the canvas a bad one.
      // An older project's target reads as the floor: every export targets it (spec D15); one without a theme gets the default.
      // A page's shape must agree with its size: one without a known shape (made before shapes) reads as square, and a
      // shape whose px is not the page's size reads as custom. An absent background stays absent; an empty list reads as none.
      // The shell replaces invalid explicit colours with transparent. Preview values
      // keep only data names holding what the data element can carry. Natives keep only known native types with a valid
      // uid no scene widget or earlier native holds (Q14); the notice counts those left out (an unknown type: a newer
      // build's, perhaps).
      if (a.project.theme !== undefined && typeof a.project.theme !== 'string') throw Error('Unreadable project theme: expected a theme name')
      for (const p of a.project.pages) if (p.background !== undefined && (!Array.isArray(p.background) || p.background.some(c => typeof c !== 'string')))
        throw Error('Unreadable project page ' + p.id + ' background: expected a flat array of colours')
      const themeNotes: string[] = [], themes: Record<string, Theme> = Object.create(null), ids = new Set<string>()
      if (Object.hasOwn(a.project, 'themes') && a.project.themes !== undefined) {
        // A stored key that is a valid imported id keeps it: an earlier key needing a fresh id never takes a later one's,
        // so the project's theme selects the theme it was saved with. The library skips such keys instead (library.ts).
        const keys = isObject(a.project.themes) ? Object.keys(a.project.themes) : []
        for (const id of keys) if (/^ds-[a-z0-9-]{1,64}$/.test(id) && !Object.hasOwn(THEMES, id)) ids.add(id)
        if (!isObject(a.project.themes)) themeNotes.push('themes: expected a record; dropped')
        else for (const id of keys) {
          if (['__proto__', 'constructor', 'prototype'].includes(id)) { themeNotes.push(`themes.${id}: prototype key dropped`); continue }
          let value: unknown = a.project.themes[id]
          // Direct project replacements already hold runtime Themes; serialized projects hold theme files.
          if (isObject(value) && Object.hasOwn(value, 'id') && !Object.hasOwn(value, 'format')) {
            const { id: _, ...body } = value
            if (isObject(body.colors)) body.colors = Object.fromEntries(Object.entries(body.colors)
              .filter(([key, color]) => !Object.hasOwn(gasColours, key) || color !== gasColours[key]))
            value = { format: THEME_FILE, v: 1, theme: body }
          }
          const reserved = ids.delete(id)
          const read = sanitizeTheme(value, THEMES[DEFAULT_THEME], { id, taken: ids })
          if (reserved) ids.add(id)   // kept even when its theme could not be read
          for (const note of read.notes) themeNotes.push(`themes.${id}.${note}`)
          if (read.theme) { themes[read.theme.id] = read.theme; ids.add(read.theme.id) }
        }
      }
      const input = { ...a.project, ...(Object.hasOwn(a.project, 'themes') ? { themes } : {}) }, t = themeOf(input)
      const pages = a.project.pages.map(({ natives: _, ...p }) => {
        const size = { w: px(p.size?.w), h: px(p.size?.h) }, known = isShape(p.shape) ? p.shape : 'square'
        const fits = known === 'custom' || SHAPES[known].px.w === size.w && SHAPES[known].px.h === size.h
        const background = p.background?.length ? p.background : undefined
        return { ...p, shape: fits ? known : 'custom' as const, size, background, ...(p.preview !== undefined && { preview: previewOf(p.preview) }) }
      })
      // Each scene is re-associated as text loaded against no earlier widget (ruling 2), page by page: a widget whose
      // marker does not give its subtree and its defs is detached, and so is one seen twice or one whose uid an earlier
      // page holds (Q14: a uid is one in the project), its samples pinned as a detach pins them; the notice names them.
      // One its marker gives but for its colours (a palette retuned since the save) is made again in the theme, and so
      // is every theme_ gradient, as a theme switch makes them. A scene that is no scene (an outside project) stays as it
      // is, for the checker to report.
      const taken = new Set<string>(), detached: string[] = [], reused: string[] = [], overrideNotes: string[] = []
      const read = pages.map(p => {
        let { scene, preview } = p
        try {
          const r = reassociate({ ...scene, root: [], defs: [] }, scene, t, taken, true, themesOf(input))
          detached.push(...r.detached)
          reused.push(...r.reused)
          overrideNotes.push(...r.notices)
          scene = themeGradients(r.scene, t)
          preview = pinned(preview, r.dropped, scene, t)
          for (const u of takenUids({ ...a.project, pages: [{ ...p, scene }] })) taken.add(u)
        } catch { /* not a scene the editor can read: the checker says why */ }
        return { ...p, scene, ...(preview !== undefined && { preview }) }
      })
      // A native may hold no id stem of any scene, nor an earlier native's uid (Q14), as allocUid sees the project.
      const seen = new Set(taken)
      let left = 0
      // The live data from anything (logicFrom never throws), every reference that does not resolve dropped; the notice says what went.
      const { logic, notes } = logicFrom(a.project)
      const project: Project = { ...input, ...cascade(logic, read.map(p => p.id)), target: { vectorMod: VECTOR_FLOOR },
        theme: t.id, pages: read.map((p, i) => {
          const v = a.project.pages[i].natives
          if (v === undefined) return p
          const repairs: string[] = [], natives = nativesFrom(v, t, seen, repairs)
          overrideNotes.push(...repairs.map(note => `page ${p.id} ${note}`))
          left += (Array.isArray(v) ? v.length : 0) - natives.length
          return { ...p, natives }
        }) }
      const repaired: string[] = []
      for (const k of ['roles', 'reads', 'state', 'actions', 'rules', 'bindings', 'simDevices', 'settings', 'customLua', 'target'] as const)
        if (a.project[k] !== undefined && !sameData(a.project[k], project[k])) repaired.push(k)
      project.pages.forEach((p, i) => {
        for (const k of ['size', 'shape', 'background', 'preview', 'natives'] as const)
          if (a.project.pages[i][k] !== undefined && !sameData(a.project.pages[i][k], p[k])) repaired.push('page ' + p.id + ' ' + k)
      })
      const notice = [repaired.length ? 'Repaired project fields: ' + repaired.join(', ') : '', typeof a.project.theme === 'string' && !Object.hasOwn(THEMES, a.project.theme) && !Object.hasOwn(themes, a.project.theme)
        ? `unknown theme "${a.project.theme}": using ${t.name}` : '', left ? `not loaded: ${left} native widget${left > 1 ? 's' : ''} of an unknown type, with an invalid uid, or with a uid another widget holds` : '',
        detachedNotice(detached, reused, false), ...overrideNotes, ...notes, ...themeNotes].filter(Boolean).join('; ')
      return { ...edit(s, project), activePageId: project.pages[0].id, selection: null, also: [], notice, entered: null }
    }
    case 'setPageBackground': {
      const page = s.project.pages.find(p => p.id === a.pageId)
      if (!page || sameData(page.background, a.background)) return s
      return edit(s, { ...s.project, pages: s.project.pages.map(p => p === page ? { ...p, background: a.background } : p) })
    }
    // The page's preview size and its scene's design units (the header's w and h), in one undo step.
    case 'setPageShape': {
      const page = s.project.pages.find(p => p.id === a.pageId)
      if (!page || !isShape(a.shape)) return s
      const size = a.shape === 'custom' ? { w: px(a.size?.w), h: px(a.size?.h) } : SHAPES[a.shape].px
      const same = page.size.w === size.w && page.size.h === size.h
      if (page.shape === a.shape && same) return s
      // Custom at the page's own size keeps the header's units: a 2×1's 1080 does not become 1081 (480 · 1036/460).
      const units = a.shape === 'custom' && same ? null : unitsOf(a.shape, size)
      const header = units ? withKey(withKey(page.scene.header, 'w', units.w), 'h', units.h) : page.scene.header
      return edit(s, { ...s.project, pages: s.project.pages.map(p => p === page ? { ...p, shape: a.shape, size, scene: { ...page.scene, header } } : p) })
    }
    case 'setLogic': {
      // Only logic fields may change; absent or null fields keep their current values.
      const p = { ...s.project, ...Object.fromEntries(Object.entries(a.patch).filter(([k, v]) => Object.hasOwn(logicOf(s.project), k) && v !== undefined && v !== null)) }
      const next = { ...p, ...cascade(logicOf(p), p.pages.map(x => x.id)) }
      if (sameData(next, s.project)) return s
      return a.transient ? step(s, next) : edit(s, next)
    }
    case 'renameLogic': {
      const r = renamed(logicOf(s.project), a.kind, a.from, a.to)
      if (typeof r === 'string') return { ...s, notice: r }
      return { ...edit(s, { ...s.project, ...r }), notice: `renamed ${a.from} to ${a.to}; expressions that name ${a.from} are not rewritten` }
    }
  }
}
