// Tree edits on a node list, copy-on-write along one path (each list on the way copied once): no recursion, any depth.
import type { Scene, SrcNode, Value } from '../model/scene'
import { replaceAt } from '../model/tree'
import { TEXTS } from '../schema'
// `first` lives in ../srctext/props since the M2a final wave; no other M2c file names its module.
import { first, foldKey } from '../srctext/props'

/** `first(n, KEY)`: the value of n's first key that folds to KEY (give it folded: 'ID', 'V', 'CLIP'); `replaceAt(nodes,
 *  path, by)`: a copy with the node at `path` replaced, undefined when there is none or the path is [] (M2a T14's). */
export { first, replaceAt }

/** The own-line comments the editor reads: `# lock` (ruling R7), `# image` (ruling R8). */
export const LOCK = 'lock', IMAGE = 'image'

/** Whether an own-line comment is `# lock`, read loosely: its case and the spaces around it do not matter (`# Lock `
 *  locks too: a stray space the author cannot see must not unlock a node). */
export const isLock = (comment: string) => comment.trim().toLowerCase() === LOCK

/** A copy of `nodes` with the child list at `parent` (a node path; [] = nodes itself) replaced by f(list); undefined when
 *  the path does not reach a node with a block, or f gives undefined. */
export function editList(nodes: readonly SrcNode[], parent: readonly number[], f: (list: SrcNode[]) => SrcNode[] | undefined): SrcNode[] | undefined {
  const lists: SrcNode[][] = [nodes as SrcNode[]]
  for (const k of parent) {
    const n = lists[lists.length - 1][k]
    if (!n?.c) return undefined
    lists.push(n.c)
  }
  let x = f(lists[lists.length - 1])
  for (let d = parent.length - 1; d >= 0 && x; d--) {
    const c = x, k = parent[d]
    x = lists[d].map((n, i) => i === k ? { ...n, c } : n)
  }
  return x
}

/** What f gives for the first node on the way to `path` (from the top, the node itself last) for which it gives
 *  something (not null, undefined or false); null when none does or the path does not resolve that far. */
export function onPath<T>(root: readonly SrcNode[], path: readonly number[], f: (n: SrcNode) => T | null | undefined | false): T | null {
  let list: readonly SrcNode[] | undefined = root
  for (const k of path) {
    const n: SrcNode | undefined = list?.[k]
    if (!n) return null
    const v = f(n)
    if (v !== null && v !== undefined && v !== false) return v
    list = n.c
  }
  return null
}

/** Whether the node at `path`, or a node above it, carries `# lock`. */
export const lockedAt = (root: readonly SrcNode[], path: readonly number[]): boolean => onPath(root, path, n => n.comments?.some(isLock)) !== null

/** A sort order for paths: later first (lexicographic, from the end), a child before its parent. */
export function laterFirst(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i] - a[i]
  return b.length - a.length
}

/** The nodes at `paths` removed (a node under one removed goes with it); a path that does not resolve is passed over.
 *  One filter per parent list, the lists above written in one editAt pass. */
export function removeAt(nodes: readonly SrcNode[], paths: readonly (readonly number[])[]): SrcNode[] {
  const at = new Map<string, number>(), parents: number[][] = [], gone: Set<number>[] = []
  for (const p of paths) {
    if (!p.length) continue
    const up = p.slice(0, -1), key = up.join(',')
    let k = at.get(key)
    if (k === undefined) { at.set(key, k = parents.length); parents.push(up); gone.push(new Set()) }
    gone[k].add(p[p.length - 1])
  }
  if (!parents.length) return nodes as SrcNode[]
  const keep = (list: readonly SrcNode[], s: ReadonlySet<number>) => list.filter((_, i) => !s.has(i))
  const top = at.get(''), deep = parents.filter(p => p.length)
  // editAt hands f the index of the path it edits: here a parent's, among `deep`, whose set is gone[at(parent)].
  const out = deep.length ? editAt(nodes, deep, (n, i) => n.c ? { ...n, c: keep(n.c, gone[at.get(deep[i].join(','))!]) } : n) : nodes as SrcNode[]
  return top === undefined ? out : keep(out, gone[top])
}

/** `nodes` with f applied at each of `paths` (f gets the node there with the edits below it made, and the index in
 *  `paths` of the first path to it; a path that does not resolve is passed over, a repeated one edited once). Each list
 *  on the way is copied once however many paths pass through it, where one replaceAt per path copies a long list once per
 *  path. Explicit stacks. */
export function editAt(nodes: readonly SrcNode[], paths: readonly (readonly number[])[], f: (n: SrcNode, i: number) => SrcNode): SrcNode[] {
  type Trie = { at: number; kids: Map<number, Trie> }   // at: the path's index, -1 where no path ends
  const top: Trie = { at: -1, kids: new Map() }
  paths.forEach((p, i) => {
    let t = top
    for (const k of p) { let u = t.kids.get(k); if (!u) t.kids.set(k, u = { at: -1, kids: new Map() }); t = u }
    if (p.length && t.at < 0) t.at = i
  })
  type Frame = { list: SrcNode[]; kids: [number, Trie][]; i: number; up?: [Frame, number, Trie] }
  const base: Frame = { list: [...nodes], kids: [...top.kids], i: 0 }, frames = [base]
  while (frames.length) {
    const fr = frames[frames.length - 1]
    if (fr.i === fr.kids.length) {
      frames.pop()
      if (fr.up) { const [above, k, t] = fr.up, n = { ...above.list[k], c: fr.list }; above.list[k] = t.at >= 0 ? f(n, t.at) : n }
      continue
    }
    const [k, t] = fr.kids[fr.i++], n = Object.hasOwn(fr.list, k) ? fr.list[k] : undefined
    if (!n) continue
    if (t.kids.size && n.c) frames.push({ list: [...n.c], kids: [...t.kids], i: 0, up: [fr, k, t] })
    else if (t.at >= 0) fr.list[k] = f(n, t.at)
  }
  return base.list
}

/** A copy of the forest with f applied to every node, children first (f gets the node with its mapped children); a node
 *  `whole` holds for goes to f with its block as it is (a widget root: its module writes what is under it). Explicit
 *  stacks. */
export function mapTree(nodes: readonly SrcNode[], f: (n: SrcNode) => SrcNode, whole?: (n: SrcNode) => boolean): SrcNode[] {
  const lists: SrcNode[][] = [[]], frames: { list: readonly SrcNode[]; k: number }[] = [{ list: nodes, k: 0 }]
  while (frames.length) {
    const top = frames[frames.length - 1]
    if (top.k === top.list.length) {
      frames.pop()
      const done = lists.pop()!
      if (!frames.length) return done
      const up = frames[frames.length - 1], n = up.list[up.k - 1]
      lists[lists.length - 1].push(f({ ...n, c: done }))
      continue
    }
    const n = top.list[top.k++]
    if (n.c && !whole?.(n)) { frames.push({ list: n.c, k: 0 }); lists.push([]) }
    else lists[lists.length - 1].push(f(n))
  }
  return []
}

/** Where each of `targets` (by identity) is in `nodes`. One walk, one path array; a path copied per target found. */
export function pathsOf(nodes: readonly SrcNode[], targets: ReadonlySet<SrcNode>): Map<SrcNode, number[]> {
  const out = new Map<SrcNode, number[]>(), frames = [{ list: nodes, k: 0 }], path: number[] = []
  while (frames.length && out.size < targets.size) {
    const f = frames[frames.length - 1]
    if (f.k === f.list.length) { frames.pop(); path.pop(); continue }
    const n = f.list[f.k]
    path.push(f.k++)
    if (targets.has(n)) out.set(n, path.slice())
    if (n.c?.length) frames.push({ list: n.c, k: 0 })
    else path.pop()
  }
  return out
}

// The keys whose plain value names an id: clip (a CP) and ref (a SYM). A paint or a mask names its def as @id (the mod
// reads mask only in that form: SceneModel.cs, `mask[0] == '@'`). A label's text keys (text, fmt, unit, missing) are
// printed as written: an @ there is text, never a reference.
const REFS = new Set(['CLIP', 'REF'])
// The ids a node's values name: an @id (a paint, a mask), and the value of clip and ref.
function refsOf(n: SrcNode, into: string[]) {
  for (const [k, v] of Object.entries(n.attrs)) {
    if (typeof v !== 'string' || !v) continue
    const K = foldKey(k)
    if (v[0] === '@') { if (!TEXTS.has(K)) into.push(v.slice(1)) }
    else if (REFS.has(K)) into.push(v)
  }
}

/** The defs `nodes` reach (by @id, clip, mask, ref) and those they reach in turn, in DEFS order. Explicit stacks. */
export function defClosure(nodes: readonly SrcNode[], defs: readonly SrcNode[]): SrcNode[] {
  const byId = new Map<string, SrcNode[]>()
  for (const d of defs) { const id = first(d, 'ID'); if (typeof id === 'string') byId.set(id, [...(byId.get(id) ?? []), d]) }
  const reached = new Set<SrcNode>(), ids: string[] = [], stack = [...nodes]
  const scan = () => { for (let n = stack.pop(); n; n = stack.pop()) { refsOf(n, ids); for (const c of n.c ?? []) stack.push(c) } }
  scan()
  for (let id = ids.pop(); id !== undefined; id = ids.pop())
    for (const d of byId.get(id) ?? []) if (!reached.has(d)) { reached.add(d); stack.push(d); scan() }
  return defs.filter(d => reached.has(d))
}

/** The forest with every id in `map` renamed, and every reference to one (@id, clip, ref, mask) rewritten; a label's
 *  text is left as written. */
export const renameIds = (nodes: readonly SrcNode[], map: ReadonlyMap<string, string>, whole?: (n: SrcNode) => boolean): SrcNode[] => mapTree(nodes, n => {
  if (whole?.(n)) return n
  let attrs: Record<string, Value> | null = null
  for (const [k, v] of Object.entries(n.attrs)) {
    if (typeof v !== 'string' || !v) continue
    const K = foldKey(k), at = v[0] === '@' && !TEXTS.has(K) ? map.get(v.slice(1)) : undefined
    const to = K === 'ID' || (REFS.has(K) && v[0] !== '@') ? map.get(v) : at === undefined ? undefined : '@' + at
    if (to === undefined) continue
    attrs ??= { ...n.attrs }
    attrs[k] = to
  }
  return attrs ? { ...n, attrs } : n
}, whole)

/** Every id the scenes use (root and DEFS, any depth). */
export function idsOf(scenes: readonly Scene[]): Set<string> {
  const out = new Set<string>()
  for (const s of scenes) {
    const stack = [...s.root, ...s.defs]
    for (let n = stack.pop(); n; n = stack.pop()) {
      const id = first(n, 'ID')
      if (typeof id === 'string') out.add(id)
      for (const c of n.c ?? []) stack.push(c)
    }
  }
  return out
}

/** The ids one command that copies nodes gives (duplicate, paste; Q14). taken: every id in use, and (from a project) every
 *  id stem and native uid; it gains each id given. uids: the widget and native uids, whose stem no id given may hold.
 *  next: per stem, where fresh's count goes on, so k copies of one stem cost O(k), not O(k²). copies: per uid, the
 *  `<uid>copy<k>` stem this command gives. */
export type Ids = { taken: Set<string>; uids: ReadonlySet<string>; next: Map<string, number>; copies: Map<string, string> }
export const idsFrom = (taken: Set<string>, uids: ReadonlySet<string> = new Set()): Ids => ({ taken, uids, next: new Map(), copies: new Map() })

// `id`'s stem (trailing digits dropped) plus the smallest n from 2 that taken lacks, counting on from the last n this
// command gave that stem (taken only grows, so none below it is free).
function counted(id: string, ids: Ids): string {
  let end = id.length   // trailing digits found by a loop: /\d+$/ backtracks from every digit of a long run, quadratic
  while (end > 0 && id.charCodeAt(end - 1) >= 48 && id.charCodeAt(end - 1) <= 57) end--
  const stem = id.slice(0, end)
  let n = ids.next.get(stem) ?? 2
  while (ids.taken.has(stem + n)) n++
  ids.next.set(stem, n + 1)
  ids.taken.add(stem + n)
  return stem + n
}
// For an id whose stem (up to its first _) is a widget's or a native's uid: that stem as `<uid>copy<k>`, k the smallest
// no id or stem holds, one per uid in a command (reassociate's names for a copy's defs; no uid has that stem, as a uid
// ends at its number). Undefined for any other id.
function apart(id: string, ids: Ids): string | undefined {
  const uid = id.split('_')[0]
  if (!ids.uids.has(uid)) return undefined
  let stem = ids.copies.get(uid)
  if (stem === undefined) {
    let k = 1
    while (ids.taken.has(`${uid}copy${k}`)) k++
    ids.copies.set(uid, stem = `${uid}copy${k}`)
    ids.taken.add(stem)
  }
  const to = stem + id.slice(uid.length)
  return ids.taken.has(to) ? counted(to, ids) : (ids.taken.add(to), to)
}
/** A new id for a copy of `id`: apart's, else the stem plus a count (counted). ids.taken gains it. */
export const fresh = (id: string, ids: Ids): string => apart(id, ids) ?? counted(id, ids)
/** `id` itself where taken lacks it and its stem is no uid (taken gains it), else fresh. */
export const named = (id: string, ids: Ids): string => apart(id, ids) ?? (ids.taken.has(id) ? counted(id, ids) : (ids.taken.add(id), id))
/** `id` itself unless its stem is a uid (apart's then); taken gains it. A def kept on a page that lacks its id. */
export const kept = (id: string, ids: Ids): string => apart(id, ids) ?? (ids.taken.add(id), id)

/** Every id in `nodes` given a name (named: kept where it is free), the references inside `nodes` following; `map` holds
 *  the renames, seeded with any already made (a paste's defs), whose ids stay as it says. */
export function freshIds(nodes: readonly SrcNode[], ids: Ids, map = new Map<string, string>(), whole?: (n: SrcNode) => boolean): { nodes: SrcNode[]; map: Map<string, string> } {
  const done = new Set(map.keys()), stack = [...nodes]
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (whole?.(n)) { for (const id of idsOf([{ header: {}, defs: [], root: [n] }])) ids.taken.add(id); continue }
    const id = first(n, 'ID')
    if (typeof id === 'string' && id && !done.has(id)) {
      done.add(id)
      const to = named(id, ids)
      if (to !== id) map.set(id, to)
    }
    for (const c of n.c ?? []) stack.push(c)
  }
  return { nodes: map.size ? renameIds(nodes, map, whole) : [...nodes], map }
}
