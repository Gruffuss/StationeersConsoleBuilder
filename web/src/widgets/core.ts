// Widgets in the page scene. A widget is a `G id=<uid>` whose last own-line comment is its marker,
// `widget <type> <uid> <params JSON>` (owner decision Q1). The marker is the widget's only record, so the printer, the
// validator, numbering and the canvas need no widget awareness. Pure; nothing here recurses once per level of a scene.
import type { Project } from '../model/project'
import type { Scene, SrcNode, Value } from '../model/scene'
import { nodeAt, replaceAt } from '../model/tree'
import { withAttr } from '../editor/fields'
import { editAt, mapTree, removeAt } from '../editing/tree'
import { TEXTS } from '../schema'
import { defKey } from '../schema/duplicateIds'
import { printChecked, shortestFloat } from '../srctext/print'
import { strings } from '../srctext/validate'
import { first, foldKey } from '../srctext/props'
import { THEMES } from '../theme'
import type { Theme } from '../theme/types'
import { DATA_NAME, gradientDef, hasGradient, plainTextProblem, previewName, tagOf } from './paint'
import { WIDGETS } from './registry'
import { dressing, forWidget, underLabels } from './dress'
import { applyEdit, sanitizeEdit } from './editData'
import type { Ctx, Expansion, Json, NativeEl, NativeRef, Param, Params, Slot, WidgetModule, WidgetRef } from './types'

export { DATA_NAME, previewName }   // defined in paint.ts, which the modules import (they cannot import core: core imports the registry)

const ID = '[a-z]+[0-9]+'   // a widget uid: a prefix and a number (a marker's, a native's); UID, MARKER and MARKED read it
export const UID = new RegExp(`^${ID}$`)
// s: a pasted U+2028 or U+2029 stays inside the JSON (a comment runs to \n only); whitespace may trail the closing brace.
export const MARKER = new RegExp(String.raw`^widget ([a-z]+) (${ID}) (\{.*\})\s*$`, 's')
/**
 * A number format, as the mod's Printf.Translate reads one: the first % and the first letter after it convert (f F e E g G
 * d i x X), whatever lies between them (width, flags, a precision after the first '.', even a second '.') passed on
 * unchecked; a spec it cannot read prints as written, and so does every later %. One limit is the placeholder grammar's
 * (TextTemplate), not a guard: no brace, since a placeholder ends at its first } (and .NET's formatter refuses a brace). A
 * ] or a [ is literal: since vector 0.11.97 a binding's format follows the first ':' outside its index ({$name[i]:fmt}).
 */
export const FMT = /^[^{}]*$/
/** What sanitize knows of the project when it reads a marker: nothing (Page tabs then fall back to one tab). */
export const NO_CTX: Ctx = { pages: [], page: '', size: { w: 480, h: 480 } }

/** The marker text. Numbers as the shortest decimal of their float32 (39.2, not 39.20000076293945): the same value reads back.
 *  U+2028 and U+2029, which JSON.stringify writes raw, are escaped: the marker stays one line in any editor. */
export const markerOf = (w: WidgetRef) => {
  const edit = sanitizeEdit(w.edit)
  return `widget ${w.type} ${w.uid} ${JSON.stringify(edit ? { ...w.params, __edit: edit } : w.params, (_, v) => typeof v === 'number' ? Number(shortestFloat(v)) : v)
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}`
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(Math.fround(v))
const clamp = (n: number, p: { min?: number; max?: number }) => Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n))

// Line breaks as LF: src cannot hold a CR (the validator refuses one), and the code pane turns one into LF, which would
// detach the widget at the next edit anywhere on the page. A pasted marker is the only way one arrives.
const lf = (s: string) => s.replace(/\r\n?/g, '\n')
function one(p: Param, v: unknown, d: Json): Json {
  switch (p.type) {
    case 'num': return finite(v) ? Math.fround(clamp(p.int ? Math.round(v) : v, p)) + 0 : d   // + 0: no -0, which a marker cannot hold
    case 'flag': return typeof v === 'boolean' ? v : d
    case 'enum': return typeof v === 'string' && p.enum.includes(v) ? v : d
    case 'text': return typeof v === 'string' && plainTextProblem(lf(v)) === null ? lf(v) : d
    case 'template': case 'page': return typeof v === 'string' ? lf(v) : d
    case 'fmt': return typeof v === 'string' && FMT.test(lf(v)) ? lf(v) : d
    case 'numbers': return Array.isArray(v) ? v.filter(finite).map(x => Math.fround(clamp(x, p)) + 0) : d
    case 'keys': {
      // Any rename of any slot, kept in a record with no prototype (`constructor` and `__proto__` are names like any
      // other: ruling 2). Whether a slot reads it is keyOf's to say, where the slot is read: a label reads more than an
      // expression does. No CR: src cannot hold one.
      const out: Record<string, string> = Object.create(null)
      if (isObject(v)) for (const [k, x] of Object.entries(v)) if (k !== '' && typeof x === 'string' && x !== '' && !x.includes('\r')) out[k] = x
      return out
    }
    case 'list': {
      const item = (d as Params[])[0] ?? {}   // an empty default list: a missing field stays missing
      const list = Array.isArray(v) ? v.filter(isObject).map(x => fields(p.item, x, item)) : []
      return list.length >= p.min ? list : d
    }
  }
}
const fields = (ps: Param[], v: Record<string, unknown>, d: Params): Params =>
  Object.fromEntries(ps.map(p => [p.key, one(p, Object.hasOwn(v, p.key) ? v[p.key] : undefined, d[p.key])]))

/** A module's params read from anything (a marker, a panel edit, a drag): each known param of its type, numbers clamped to
 *  their range, else that param's default; unknown keys dropped; then the module's fix. Never throws. No size limit: a
 *  value's depth is the parameter list's, whatever the input's. */
export function sanitize(m: WidgetModule, v: unknown, t: Theme): Params {
  const ps = m.params.map(p => p.type === 'enum' && p.tokens ? { ...p, enum: Object.keys(t.colors) } : p)
  const raw = isObject(v) ? v : {}, d = m.defaults(t, NO_CTX), p = fields(ps, raw, d)
  const clean = m.fix ? fields(ps, m.fix(p, t), d) : p   // fix's output is read again: clamped and float32 like the rest
  return m.migrate ? m.migrate(raw, clean, t) : clean
}

/** The widget rooted at `n`, or null: a G whose last own-line comment is a marker naming a known scene widget and the
 *  G's own id, holding a JSON object. Its params come back sanitized. */
export function widgetOf(n: SrcNode, t: Theme, dropped?: string[]): WidgetRef | null {
  const c = n.comments, m = n.op.toUpperCase() === 'G' && c?.length ? MARKER.exec(c[c.length - 1]) : null
  const mod = m ? WIDGETS[m[1]] : undefined
  if (!m || !mod || mod.native || first(n, 'ID') !== m[2]) return null
  let raw: unknown
  try { raw = JSON.parse(m[3]) } catch { return null }   // JSON.parse is iterative in V8: any depth parses
  if (!isObject(raw)) return null
  const edit = sanitizeEdit(raw.__edit, dropped)
  return { type: m[1], uid: m[2], params: sanitize(mod, raw, t), ...(edit ? { edit } : {}) }
}
/** The first widget root on the path, including the node itself. */
export function widgetRootOf(scene: Scene, path: number[], t: Theme): number[] | null {
  let list: SrcNode[] | undefined = scene.root
  for (let i = 0; i < path.length; i++) {
    const n: SrcNode | undefined = list?.[path[i]]
    if (!n) return null
    if (widgetOf(n, t)) return path.slice(0, i + 1)
    list = n.c
  }
  return null
}
/** The widget exactly at path; never a widget inside another widget. */
export function widgetAt(scene: Scene, path: number[] | undefined, t: Theme): WidgetRef | null {
  const root = path && widgetRootOf(scene, path, t)
  return root?.length === path?.length && root ? widgetOf(nodeAt(scene.root, root)!, t) : null
}
/** Scene widgets in drawing order, at any depth. A widget's generated subtree is never entered. */
export function widgetsIn(scene: Scene, t: Theme): { path: number[]; ref: WidgetRef }[] {
  const out: { path: number[]; ref: WidgetRef }[] = [], path: number[] = [], stack = [{ list: scene.root, i: 0 }]
  while (stack.length) {
    const f = stack[stack.length - 1]
    if (f.i === f.list.length) { stack.pop(); path.pop(); continue }
    const i = f.i++, n = f.list[i], ref = widgetOf(n, t)
    if (ref) out.push({ path: [...path, i], ref })
    else if (n.c?.length) { path.push(i); stack.push({ list: n.c, i: 0 }) }
  }
  return out
}
/** The path of widget uid's root, or null. */
export function indexOf(scene: Scene, uid: string, t: Theme): number[] | null {
  const path: number[] = [], stack = [{ list: scene.root, i: 0 }]
  while (stack.length) {
    const f = stack[stack.length - 1]
    if (f.i === f.list.length) { stack.pop(); path.pop(); continue }
    const i = f.i++, n = f.list[i], ref = widgetOf(n, t)
    if (ref?.uid === uid) return [...path, i]
    if (!ref && n.c?.length) { path.push(i); stack.push({ list: n.c, i: 0 }) }
  }
  return null
}

/** The theme gradient defs `nodes` paint with (`f`, `s` or a group's `s_`, the stroke its children read as `s`, =
 *  `@theme_<name>`, a gradient the theme has), once each, sorted. Any other `@theme_…` (a label's text, a name the theme
 *  lacks) brings nothing. An explicit stack. */
export function themeDefs(nodes: SrcNode[], t: Theme): SrcNode[] {
  const names = new Set<string>(), stack = [...nodes]
  for (let n = stack.pop(); n; n = stack.pop()) {
    for (const [k, v] of Object.entries(n.attrs))
      if ((/^[fs]$/i.test(k) || k === 's_') && typeof v === 'string' && v.startsWith('@theme_') && hasGradient(t, v.slice(7))) names.add(v.slice(7))
    for (const c of n.c ?? []) stack.push(c)
  }
  return [...names].sort().map(name => gradientDef(t, name))
}
const owns = (uid: string) => (d: SrcNode) => { const id = first(d, 'ID'); return typeof id === 'string' && id.startsWith(uid + '_') }
/** The stems of the ids in `nodes` and below them (`lt1` for `lt1` and `lt1_st`). An explicit stack. */
function stemsOf(nodes: SrcNode[]): Set<string> {
  const stems = new Set<string>(), stack = [...nodes], seen = new Set<SrcNode>()
  while (stack.length) {
    const n = stack.pop()!
    if (!isObject(n) || !isObject(n.attrs) || seen.has(n)) continue
    seen.add(n)
    const id = first(n, 'ID')
    if (typeof id === 'string') stems.add(id.split('_')[0])
    if (Array.isArray(n.c)) for (const c of n.c) stack.push(c)
  }
  return stems
}
// The def id a value `s` of key `K` (folded) points at: a `clip` or a `ref` names one, any other value `@<id>` (a paint, a mask).
const REFS = new Set(['CLIP', 'REF'])
const target = (K: string, s: string) => REFS.has(K) ? s : s[0] === '@' ? s.slice(1) : ''
/** The `<uid>_` def ids `nodes` and the nodes below them point at (target). An explicit stack. */
function refsTo(nodes: SrcNode[], uid: string): Set<string> {
  const used = new Set<string>(), stack = [...nodes]
  for (let n = stack.pop(); n; n = stack.pop()) {
    for (const [key, v] of Object.entries(n.attrs))
      for (const s of strings(v)) { const id = target(foldKey(key), s); if (id.startsWith(uid + '_')) used.add(id) }
    for (const c of n.c ?? []) stack.push(c)
  }
  return used
}
/** The `<uid>_` def ids that nodes outside widget `uid`'s root use (any node but that subtree, any def it does
 *  not own): a node written by hand. Empty, with no walk, when the scene holds no `<uid>_` def. */
const usedOutside = (scene: Scene, uid: string, path: number[]): Set<string> => scene.defs.some(owns(uid))
  ? refsTo([...removeAt(scene.root, [path]), ...scene.defs.filter(d => !owns(uid)(d))], uid) : new Set()
/** A fresh copy of `n` and the nodes below it, each string value (at any depth of a list) mapped by `f`, given its key
 *  folded. An explicit stack. */
function mapStrings(n: SrcNode, f: (K: string, s: string) => string): SrcNode {
  const swap = (K: string, v: Value): Value => {
    if (!Array.isArray(v)) return typeof v === 'string' ? f(K, v) : v
    const top: Value[] = [], stack: [Value[], Value[]][] = [[v, top]]
    for (let e = stack.pop(); e; e = stack.pop())
      for (const x of e[0]) {
        if (Array.isArray(x)) { const o: Value[] = []; e[1].push(o); stack.push([x, o]) }
        else e[1].push(typeof x === 'string' ? f(K, x) : x)
      }
    return top
  }
  const copy = (x: SrcNode): SrcNode => ({ ...x, attrs: Object.fromEntries(Object.entries(x.attrs).map(([k, v]) => [k, swap(foldKey(k), v)])) })
  const top = copy(n), stack = [top]
  for (let x = stack.pop(); x; x = stack.pop()) if (x.c) { x.c = x.c.map(copy); for (const c of x.c) stack.push(c) }
  return top
}
/** `n` with each id of `to` it points at (target) or carries renamed. */
const repointed = (n: SrcNode, to: ReadonlyMap<string, string>) => mapStrings(n, (K, s) =>
  K === 'ID' || REFS.has(K) ? to.get(s) ?? s : s[0] === '@' && to.has(s.slice(1)) ? '@' + to.get(s.slice(1)) : s)
/** `n` with every colour literal blanked: a value that is one, and each one in an expression (a state's colour, a glow).
 *  A text value (TEXTS: a label's text, fmt, unit, missing) is left as written, '#404' or '=#abc' too: text, not colour. */
const HEX = /#[0-9a-f]{3,8}(?![0-9a-z_])/gi
const uncoloured = (n: SrcNode) => mapStrings(n, (K, s) =>
  TEXTS.has(K) ? s : s[0] === '=' ? s.replace(HEX, '#') : /^#[0-9a-f]{3,8}$/i.test(s) ? '#' : s)
/**
 * `defs` with `add` merged by kind and id (defKey: the mod keeps gradients, clips and symbols apart): the first def of a
 * key `add` has is replaced in place and later ones of that key dropped, a new key appended, and `<uid>_` defs `add`
 * lacks dropped. A def with no id is never a match (the mod skips it).
 */
export function mergeDefs(defs: SrcNode[], add: SrcNode[], uid: string | ReadonlySet<string>): SrcNode[] {
  const byKey = new Map<string, SrcNode>(), placed = new Set<string>(), out: SrcNode[] = []
  const own = typeof uid === 'string' ? owns(uid) : (d: SrcNode) => {
    const id = first(d, 'ID')
    return typeof id === 'string' && uid.has(id.split('_')[0]) && id.includes('_')
  }
  for (const d of add) { const k = defKey(d); if (k) byKey.set(k, d) }
  for (const d of defs) {
    const k = defKey(d), mine = k === undefined ? undefined : byKey.get(k)
    if (mine) { if (!placed.has(k!)) out.push(mine); placed.add(k!) }
    else if (!own(d)) out.push(d)
  }
  for (const [k, d] of byKey) if (!placed.has(k)) out.push(d)
  return out
}

/** Every number as float32, in place: an expansion's nodes are fresh, its own. */
function float32(nodes: SrcNode[]) {
  const v32 = (v: Value): Value => typeof v === 'number' ? Math.fround(v) : Array.isArray(v) ? v.map(v32) : v   // ponytail: module values are 2 deep
  const stack = [...nodes]
  for (let n = stack.pop(); n; n = stack.pop()) {
    for (const k of Object.keys(n.attrs)) n.attrs[k] = v32(n.attrs[k])
    for (const c of n.c ?? []) stack.push(c)
  }
}
/** The widget's root (marker, `G id=<uid>`, the expansion) and its defs: the module's own, then the theme gradients it uses.
 *  The marker keeps the `keys` renames its slots read and those of slots the expansion lacks now (a Bar's state while it
 *  is `auto`, a row's state while it is off), so switching back finds them; a rename of a slot that reads another name
 *  (one the slot cannot read back) goes. */
export function expandRoot(w: WidgetRef, t: Theme): { root: SrcNode; defs: SrcNode[]; exp: Expansion } {
  const exp = WIDGETS[w.type].expand(w.params, forWidget(t, w.type), w.uid)
  exp.nodes = underLabels(exp.nodes)
  const scoped = [...exp.nodes]
  while (scoped.length) {
    const n = scoped.pop()!
    if (n.c) { n.c = underLabels(n.c); for (const child of n.c) scoped.push(child) }
  }
  float32(exp.nodes)
  float32(exp.defs ?? [])
  const parts: Record<string, number[]> = Object.create(null), path: number[] = [], stack = [{ nodes: exp.nodes, i: 0 }]
  const notes = new Set(exp.notes)
  while (stack.length) {
    const frame = stack[stack.length - 1]
    if (frame.i === frame.nodes.length) { stack.pop(); path.pop(); continue }
    const i = frame.i++, n = frame.nodes[i], name = tagOf(n)
    if (name !== undefined) parts[name] = [...path, i]
    if (n.c?.length) { path.push(i); stack.push({ nodes: n.c, i: 0 }) }
  }
  exp.parts = parts
  const edit = sanitizeEdit(w.edit)
  if (edit) {
    const applied = applyEdit(exp.nodes, parts, edit)
    exp.nodes = applied.nodes
    exp.dormant = applied.dormant
    exp.dormantReasons = applied.dormantReasons
    applied.notes?.forEach(note => notes.add(note))
    float32(exp.nodes)
  }
  const drawn = [...exp.nodes]
  while (drawn.length) {
    const n = drawn.pop()!
    dressing(n)?.notes.forEach(note => notes.add(note))
    for (const c of n.c ?? []) drawn.push(c)
  }
  if (notes.size) exp.notes = [...notes]
  const slots = new Map(exp.slots.map(s => [s.slot, s.key])), keys = w.params.keys
  const params = isObject(keys) ? { ...w.params, keys: Object.fromEntries(Object.entries(keys).filter(([k, v]) => !slots.has(k) || slots.get(k) === v)) } : w.params
  return { root: { op: 'G', attrs: { id: w.uid, ...edit?.root }, c: exp.nodes, comments: [markerOf({ ...w, params })] },
    defs: [...(exp.defs ?? []), ...themeDefs(exp.nodes, t)], exp }
}

/** The scene with `w` (re-)expanded: its root replaced where it stands (comments above the marker kept) or appended on top,
 *  its `<uid>_` defs rewritten (a node written by hand that points at one follows the widget; a pasted copy has its own). */
export function putWidget(scene: Scene, w: WidgetRef, t: Theme): Scene {
  const k = indexOf(scene, w.uid, t), m = WIDGETS[w.type]
  if (k && m.params.some(p => p.type === 'keys')) {
    const live = new Set(m.expand(w.params, t, w.uid).slots.map(s => s.slot))
    const missing = slotsOf(nodeAt(scene.root, k)!, t).filter(s => !live.has(s.slot))
    const was = missing.length ? widgetOf(nodeAt(scene.root, k)!, t) : null
    if (was?.type === w.type) {
      const owned = (ps: Params) => m.params.flatMap(p => p.type === 'list'
        ? (ps[p.key] as Params[]).flatMap(item => m.itemSlots?.(p.key, item) ?? []) : [])
      const before = new Set(owned(was.params)), after = new Set(owned(w.params))
      const keys = { ...w.params.keys as Record<string, string> }
      // Inactive slots hold their default names too; a removed list item releases its slots.
      for (const s of missing) if (!before.has(s.slot) || after.has(s.slot)) keys[s.slot] = s.key
      if (Object.keys(keys).length) w = { ...w, params: { ...w.params, keys } }
    }
  }
  const { root, defs } = expandRoot(w, t)
  const list = !k ? [...scene.root, root]
    : replaceAt(scene.root, k, { ...root, comments: [...nodeAt(scene.root, k)!.comments!.slice(0, -1), ...root.comments!] })!
  return { ...scene, root: list, defs: mergeDefs(scene.defs, defs, w.uid) }
}
/** The scene without widget `uid`: its root and its `<uid>_` defs, but those a node written by hand still uses (usedOutside). */
export function dropWidget(scene: Scene, uid: string, t: Theme): Scene {
  const k = indexOf(scene, uid, t), own = owns(uid)
  if (!k) return scene
  const used = usedOutside(scene, uid, k)
  return { ...scene, root: removeAt(scene.root, [k]), defs: scene.defs.filter(d => !own(d) || used.has(first(d, 'ID') as string)) }
}
const unmarked = (n: SrcNode): SrcNode => {
  const { comments, ...rest } = n, kept = comments!.slice(0, -1)
  return kept.length ? { ...rest, comments: kept } : rest
}
/** The scene with widget `uid` turned into plain nodes: the marker dropped, the nodes, the id and the <uid>_ defs kept. */
export function detach(scene: Scene, uid: string, t: Theme): Scene {
  const k = indexOf(scene, uid, t)
  return !k ? scene : { ...scene, root: replaceAt(scene.root, k, unmarked(nodeAt(scene.root, k)!))! }
}

/** The page's native widgets (Q10) and what each declares; an entry of no native type is skipped. */
export function nativesOf(page: { natives?: NativeRef[] }, t: Theme): { uid: string; el: NativeEl }[] {
  return (page.natives ?? []).flatMap(w => {
    const m = WIDGETS[w.type]
    return m?.native ? (m.expand(sanitize(m, w.params, t), t, w.uid).natives ?? []).map(el => ({ uid: w.uid, el })) : []
  })
}
/** Native `uid` of the page, its params sanitized; null when there is none. */
export function nativeAt(page: { natives?: NativeRef[] }, uid: string | undefined, t: Theme): NativeRef | null {
  const w = uid === undefined ? undefined : page.natives?.find(n => n.uid === uid), m = w && WIDGETS[w.type]
  return w && m?.native ? { ...w, params: sanitize(m, w.params, t) } : null
}

/** Every native uid and every id stem on the project's pages (`lt1` for `lt1` and `lt1_st`), but page `except`'s scene
 *  ids: the uids taken there (Q14). Its natives count: they are not in the scene setScene re-associates. */
export function takenUids(p: Project, except?: string): Set<string> {
  const stems = new Set<string>()
  for (const page of p.pages) {
    for (const n of page.natives ?? []) stems.add(n.uid)
    if (page.id !== except && isObject(page.scene)) for (const s of stemsOf([
      ...Array.isArray(page.scene.root) ? page.scene.root : [], ...Array.isArray(page.scene.defs) ? page.scene.defs : [],
    ])) stems.add(s)
  }
  return stems
}
/** prefix + the smallest n >= 1 that no id anywhere in the project uses, as itself or as the stem of `<uid>_…` (Q14),
 *  and that no page's preview value and no binding is kept under as a stem (a native's binding as `@<uid>.<prop>`): a
 *  widget given it would inherit that value (one a detached widget left, whose nodes are gone since) or binding (one a
 *  raw node on another page still reads, or a loaded project's). */
export function allocUid(p: Project, prefix: string): string {
  const stems = takenUids(p)
  for (const page of p.pages) for (const k of Object.keys(page.preview ?? {})) stems.add(k.split('_')[0])
  for (const k of Object.keys(p.bindings)) stems.add(k.startsWith('@') ? k.slice(1).split('.')[0] : k.split('_')[0])
  let n = 1
  while (stems.has(prefix + n)) n++
  return prefix + n
}

const bare = (n: SrcNode): SrcNode => ({ ...n, comments: undefined })
const body = (n: SrcNode) => printChecked({ header: {}, defs: [], root: [bare(n)] })
const defText = (d: SrcNode) => printChecked({ header: {}, defs: [bare(d)], root: [] })
const ownText = (defs: SrcNode[], uid: string) => defs.filter(owns(uid)).map(defText).join('\n')
const MARKED = new RegExp(`^widget [a-z]+ (${ID}) `)
/** Whether `r` (an expansion) gives subtree `b` and the `<uid>_` defs `mine`, each printed as in `r` once `as` made `r`
 *  like them (uncoloured, for a `b` and `mine` uncoloured). */
const reproduces = (r: { root: SrcNode; defs: SrcNode[] }, b: string, mine: SrcNode[], uid: string, as = (x: SrcNode) => x) => {
  const want = r.defs.filter(owns(uid)).map(as)
  return body(as(r.root)) === b && mine.every(d => want.some(e => defKey(e) === defKey(d) && defText(e) === defText(d)))
}
/**
 * `next` (a scene the code pane parsed, or a loaded one against an empty `prev`) with its widgets checked against `prev`.
 * A widget stays when its marker, its subtree and its `<uid>_` defs print as in `prev`, or when its params re-expand to
 * the same subtree and the same `<uid>_` defs (a panel edit, pasted or loaded text); otherwise its marker is dropped
 * (`detached`). A widget new to this page (pasted or loaded text) that its expansion in `t` gives but for its colour
 * literals (uncoloured: a text value is compared as written) (a palette retuned since the text was written), or its
 * expansion in another preset gives so (text from a project in that theme), stays, and is made again in `t`: its colours are the theme's, nothing else of it changes.
 * A uid seen twice keeps its first; a widget new to this page whose uid is in `taken` (other pages' uids, takenUids) or
 * is the stem of a plain id on this page (a node outside every widget, a detached copy) is detached as well (`reused`),
 * so uids stay unique across the project (Q14). A second one (a copy pasted from the first) is given copies of the
 * `<uid>_` defs it points at, and of those they point at, under `<uid>copy<k>_` (k the smallest no id stem on this page
 * has; no widget uid has such a stem, as UID ends at its number), so the widget's edits, which rewrite its own defs, and
 * its deletion leave the copy drawing as it did. A def the page lacks (the root copied alone) is taken from the marker's
 * expansion; for a copy with no widget of its uid beside it, it is added under its own name. A kept widget's defs that
 * `next` lacks (its own, the theme gradients it paints with), and a copy's theme gradients, are appended.
 * `detached` also names each widget of `prev` that no longer reads as one while its id or its marker is left (a damaged
 * marker or a comment typed under it): its nodes stay as written. `next` itself when nothing is detached, made
 * again or appended. `load`: a loaded page, where no widget is new, so none is detached for a plain id beside it (a copy
 * detached before that rule kept the original's).
 * `dropped`: the widgets of `detached` and `reused`, as they read before (a store pins their samples).
 */
export function reassociate(prev: Scene, next: Scene, t: Theme, taken?: ReadonlySet<string>, load = false, candidates: Theme[] = Object.values(THEMES)):
  { scene: Scene; detached: string[]; reused: string[]; dropped: WidgetRef[]; notices: string[] } {
  const before = new Map<string, { marker: string; body: string; defs: string; w: WidgetRef }>()
  for (const { path, ref: w } of widgetsIn(prev, t)) {
    const n = nodeAt(prev.root, path)!
    if (w && !before.has(w.uid)) before.set(w.uid, { marker: n.comments!.at(-1)!, body: body(n), defs: ownText(prev.defs, w.uid), w })   // the first, as indexOf finds it
  }
  // The stems of the ids outside every widget on this page: plain nodes, detached copies.
  const plain = stemsOf(load ? [] : mapTree(next.root, n => widgetOf(n, t) ? { op: 'G', attrs: {} } : n, n => !!widgetOf(n, t)))
  const seen = new Set<string>(), detached: string[] = [], reused: string[] = [], add: SrcNode[] = [], have = new Set(next.defs.map(defKey))
  const need = (d: SrcNode) => { const k = defKey(d)!; if (!have.has(k)) { have.add(k); add.push(d) } }
  const remade: WidgetRef[] = [], dropped: WidgetRef[] = []
  const notices: string[] = []
  let stems: Set<string> | undefined   // every id stem on the page, once a copy needs defs of its own
  // The <uid>_ defs copy `n` of widget `w` points at, and those they point at: the page's, or the marker's expansion's for
  // one the page lacks (the root copied alone, or twice in one paste). `apart` (the widget is on the page): copies under
  // <uid>copy<k>_, `n` re-pointed to them; else (no widget of that uid can be on the page while `n` holds its stem) the
  // missing ones are added as they are.
  const ownDefs = (n: SrcNode, w: WidgetRef, apart: boolean): SrcNode => {
    const uid = w.uid, here = next.defs.filter(owns(uid)), ids = new Set(here.map(d => first(d, 'ID')))
    const own = [...here, ...expandRoot(w, t).defs.filter(d => owns(uid)(d) && !ids.has(first(d, 'ID')))]
    const to = new Map<string, string>(), wanted = [...refsTo([n], uid)]
    let k = 1
    if (apart) { stems ??= stemsOf([...next.root, ...next.defs]); while (stems.has(`${uid}copy${k}`)) k++ }
    for (let id = wanted.pop(); id !== undefined; id = wanted.pop()) {
      const ds = own.filter(d => first(d, 'ID') === id)
      if (to.has(id) || !ds.length) continue
      to.set(id, apart ? `${uid}copy${k}${id.slice(uid.length)}` : id)
      for (const r of refsTo(ds, uid)) wanted.push(r)
    }
    if (!to.size) return n
    if (!apart) { for (const d of own) if (to.has(first(d, 'ID') as string)) need(d); return n }
    stems!.add(`${uid}copy${k}`)
    for (const d of own) if (to.has(first(d, 'ID') as string)) need(repointed(d, to))
    return repointed(n, to)
  }
  const found = widgetsIn(next, t), changedPaths: number[][] = [], changedNodes: SrcNode[] = []
  const check = (n: SrcNode) => {
    const invalid: string[] = [], w = widgetOf(n, t, invalid)
    if (!w) return n
    if (invalid.length) {
      notices.push(`${w.uid}: dropped invalid overrides: ${invalid.join(', ')}`)
      n = { ...n, comments: [...n.comments!.slice(0, -1), markerOf(w)] }
    }
    const was = before.get(w.uid)
    const apart = seen.has(w.uid)
    if (apart || was === undefined && (taken?.has(w.uid) || plain.has(w.uid))) {
      reused.push(w.uid); dropped.push(w)
      themeDefs(n.c ?? [], t).forEach(need)   // the theme gradients it paints with, which a page it was copied to may lack
      return ownDefs(unmarked(n), w, apart)
    }
    seen.add(w.uid)
    // Repair only rejected override attributes on load; unrelated drawing edits still detach.
    const repaired = load && invalid.length ? expandRoot(w, t) : undefined
    if (repaired) for (const entry of invalid) {
      const dot = entry.lastIndexOf('.'), name = entry.slice(0, dot), key = entry.slice(dot + 1)
      const parts = repaired.exp.parts, path = parts && Object.hasOwn(parts, name) ? parts[name] : undefined
      const expected = path && nodeAt(repaired.root.c ?? [], path)
      if (path && expected && nodeAt(n.c ?? [], path)) {
        n = { ...n, c: editAt(n.c!, [path], child => withAttr(child, key, first(expected, foldKey(key)))) }
      }
    }
    const b = body(n), mine = next.defs.filter(owns(w.uid))
    if (was && was.marker === n.comments!.at(-1) && was.body === b && was.defs === mine.map(defText).join('\n')) {
      themeDefs(n.c ?? [], t).forEach(need)
      return n
    }
    const r = repaired ?? expandRoot(w, t)
    if (reproduces(r, b, mine, w.uid)) {
      r.defs.filter(owns(w.uid)).forEach(need)
      themeDefs(n.c ?? [], t).forEach(need)
      return n
    }
    if (!was) {
      const ub = body(uncoloured(n)), um = mine.map(uncoloured)
      for (const T of [t, ...candidates.filter(x => x !== t)]) {
        const wT = T === t ? w : widgetOf(n, T)
        if (wT && reproduces(T === t ? r : expandRoot(wT, T), ub, um, w.uid, uncoloured)) {
          remade.push({ ...wT, params: sanitize(WIDGETS[wT.type], wT.params, t) })
          return n
        }
      }
    }
    detached.push(w.uid)
    dropped.push(w)
    return unmarked(n)
  }
  for (const { path } of found) {
    const n = nodeAt(next.root, path)!, out = check(n)
    if (out !== n) { changedPaths.push(path); changedNodes.push(out) }
  }
  const lost = [...before.keys()].filter(u => !seen.has(u))
  const list = changedPaths.length ? editAt(next.root, changedPaths, (_, i) => changedNodes[i]) : next.root
  if (lost.length) {
    const left = new Set<string>(), stack = [...next.root]
    for (let n = stack.pop(); n; n = stack.pop()) {
      const id = first(n, 'ID')
      if (typeof id === 'string') left.add(id)
      for (const c of n.comments ?? []) { const m = MARKED.exec(c); if (m) left.add(m[1]) }
      for (const c of n.c ?? []) stack.push(c)
    }
    const gone = new Set(lost.filter(u => left.has(u)))
    for (const u of gone) { detached.push(u); dropped.push(before.get(u)!.w) }
  }
  if (list === next.root && !add.length && !remade.length) return { scene: next, detached, reused, dropped, notices }
  let scene: Scene = { ...next, root: list, defs: add.length ? [...next.defs, ...add] : next.defs }
  for (const w of remade) scene = putWidget(scene, w, t)
  return { scene, detached, reused, dropped, notices }
}

const SLOTS = new WeakMap<SrcNode, Slot[]>()
/** The data slots of the widget rooted at `n` (none for any other node), cached by the root object, which the store never
 *  mutates. The theme is not in the key: a module's slots come from its params and uid only (a theme switch re-expands
 *  every root anyway, Task 11). */
export function slotsOf(n: SrcNode, t: Theme): Slot[] {
  let s = SLOTS.get(n)
  if (!s) {
    const w = widgetOf(n, t)
    s = w ? WIDGETS[w.type].expand(w.params, t, w.uid).slots : []
    SLOTS.set(n, s)
  }
  return s
}
