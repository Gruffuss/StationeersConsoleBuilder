// Z-order among siblings (spec §4). One step: each run of selected siblings moves past the nearest sibling whose
// box overlaps it, else past the next one, keeping its order; front and back: to the end and the start. Writes no value:
// no check. Lists are reordered by index, never by node identity (a node object may sit in two places). Every list is
// written in one editAt pass, and a step is a linked list. Bounds cost one scene walk; path work costs the supplied
// paths' total length (quadratic in depth for one member per level), plus the overlap search below.
import { childMatrix, invert, mul, type Box, type Mat } from '../../editor/geometry'
import type { SrcNode } from '../../model/scene'
import { boundsOf, hidden, IDENTITY } from '../bounds'
import { foldKey } from '../../srctext/props'
import { membersOf } from '../ctx'
import { overlaps, union } from '../layout'
import { editAt } from '../tree'
import type { Command, Ctx } from '../types'

/** A list of n siblings after one step: their old indices in the new order. The order is a doubly linked list (sibling i
 *  at slot i + 1, slots 0 and n + 1 its ends), so moving a run costs its length, where a splice shifted the list. */
function stepped(n: number, chosen: ReadonlySet<number>, box: readonly (Box | null)[], dir: 1 | -1): number[] {
  const runs: number[][] = [], end = n + 1, nx = new Int32Array(n + 2), pv = new Int32Array(n + 2)
  for (let s = 0; s <= end; s++) { nx[s] = s + 1; pv[s] = s - 1 }
  for (let i = 0; i < n; i++) {
    if (!chosen.has(i)) continue
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1] === i - 1) last.push(i)
    else runs.push([i])
  }
  const free = (s: number) => s > 0 && s < end && !chosen.has(s - 1)   // a sibling slot, not selected
  for (const run of dir > 0 ? runs.reverse() : runs) {   // the far runs first: the near ones then see the moved list
    const lo = run[0] + 1, hi = run[run.length - 1] + 1   // a run's slots stay adjacent: none is put inside another
    const own = run.flatMap(i => { const b = box[i]; return b ? [b] : [] }), u = own.length ? union(own) : null
    let to = -1
    // ponytail: a search also goes past every sibling the runs beyond it jumped, so many runs that each jump far cost
    // runs x siblings overlap tests (docs/m2c.md, Limits). Each search covers a prefix of the unselected siblings beyond
    // the run in their old order: a tree of their boxes' unions over that order skips stretches whose union misses the
    // run's box (no help where the unions cover the page).
    for (let j = dir > 0 ? nx[hi] : pv[lo]; free(j); j = dir > 0 ? nx[j] : pv[j]) {
      const b = box[j - 1]
      if (u && b && overlaps(u, b)) { to = j; break }
    }
    if (to < 0) {
      const j = dir > 0 ? nx[hi] : pv[lo]
      if (!free(j)) continue
      to = j
    }
    nx[pv[lo]] = nx[hi]; pv[nx[hi]] = pv[lo]   // out, then in after (forward) or before (backward) slot `to`
    const a = dir > 0 ? to : pv[to], b = nx[a]
    nx[a] = lo; pv[lo] = a; nx[hi] = b; pv[b] = hi
  }
  const out: number[] = []
  for (let s = nx[0]; s !== end; s = nx[s]) out.push(s - 1)
  return out
}

/** One level of the members' paths as a trie of indices: the list at a parent path, the members chosen in it, and once it
 *  is reordered, each old index's new one. */
type Level = { next: Map<number, Level>; parent?: number[]; chosen?: Set<number>; index?: number[] }

// Indexed by occurrence, not identity: one node object can sit under two different transforms.
type Bounds = { box: Box | null; leaves: Box | null; kids: Bounds[] }
function boxes(nodes: readonly SrcNode[]): Bounds[] {
  const out: Bounds[] = []
  const stack: { n: SrcNode; m: Mat | null; into: Bounds[]; done?: Bounds }[] = nodes.map(n => ({ n, m: IDENTITY, into: out })).reverse()
  while (stack.length) {
    const { n, m, into, done } = stack.pop()!, op = foldKey(n.op)
    if (done) {
      if (m && !hidden(n) && op !== 'USE') {
        const bs = done.kids.flatMap(c => c.leaves ? [c.leaves] : [])
        done.leaves = op === 'SC' && done.box ? done.box : bs.length ? union(bs) : null
        if (op !== 'SC') done.box = done.leaves
      }
      continue
    }
    const own = m && !hidden(n) && (op === 'SC' || !n.c?.length) ? boundsOf(n, m) : null
    const b: Bounds = { box: own, leaves: own, kids: [] }
    into.push(b)
    if (n.c?.length) {
      stack.push({ n, m, into, done: b })
      const local = childMatrix(n), at = m && local && invert(local) ? mul(m, local) : null
      for (let i = n.c.length - 1; i >= 0; i--) stack.push({ n: n.c[i], m: at, into: b.kids })
    }
  }
  return out
}

function reorder(ctx: Ctx, dir: 1 | -1, all: boolean) {
  const page = ctx.page(), set = membersOf(ctx), top: Level = { next: new Map() }
  const bounds = all ? [] : boxes(page.scene.root)
  for (const x of set) {   // each member's parent list found down the trie: no path key built per level
    let t = top
    for (let d = 0; d + 1 < x.path.length; d++) {
      const k = x.path[d]
      let u = t.next.get(k)
      if (!u) t.next.set(k, u = { next: new Map() })
      t = u
    }
    if (!t.chosen) { t.chosen = new Set(); t.parent = x.path.slice(0, -1) }
    t.chosen.add(x.path[x.path.length - 1])
  }
  // A level's list reordered, the level given each old index's new one.
  const order = (t: Level, list: readonly SrcNode[]) => {
    const parent = t.parent!, chosen = t.chosen!
    const keys = list.map((_, i) => i), front = keys.filter(i => !chosen.has(i)), picked = keys.filter(i => chosen.has(i))
    let bs = bounds
    if (!all) for (const k of parent) bs = bs[k]?.kids ?? []
    const next = all ? dir > 0 ? [...front, ...picked] : [...picked, ...front]
      : stepped(list.length, chosen, list.map((_, i) => bs[i]?.box ?? null), dir)
    const index: number[] = []
    next.forEach((old, i) => { index[old] = i })
    t.index = index
    return next.map(i => list[i])
  }
  // Every list below the root in one editAt pass, which edits a node after the lists under it: reordering one never moves
  // a list above it, so each parent path (as it was) still holds. The root list last.
  const deep: Level[] = [], stack = [top]
  for (let t = stack.pop(); t; t = stack.pop()) {
    if (t !== top && t.chosen) deep.push(t)
    for (const u of t.next.values()) stack.push(u)
  }
  let root = deep.length
    ? editAt(page.scene.root, deep.map(t => t.parent!), (n, i) => n.c ? { ...n, c: order(deep[i], n.c) } : n)
    : page.scene.root
  if (top.chosen) root = order(top, root)
  // A member's new path: down the trie by its old indices, each mapped through its list's reordering. Linear in depth.
  const after = (p: readonly number[]) => {
    const out = new Array<number>(p.length)
    let t: Level | undefined = top
    for (let d = 0; d < p.length; d++) { out[d] = t?.index?.[p[d]] ?? p[d]; t = t?.next.get(p[d]) }
    return out
  }
  return ctx.apply({ scene: { ...page.scene, root }, selection: set.map(x => ({ ...x, path: after(x.path) })) })
}

const entry = (id: string, label: string, order: number, key: string, dir: 1 | -1, all: boolean): Command =>
  ({ kind: 'command', id, label, menu: 'arrange', order, keys: [key], when: ctx => membersOf(ctx).length > 0, run: ctx => reorder(ctx, dir, all) })
export default [
  entry('forward', 'Bring forward', 10, 'Mod+]', 1, false), entry('backward', 'Send backward', 11, 'Mod+[', -1, false),
  entry('front', 'Bring to front', 12, 'Mod+Shift+]', 1, true), entry('back', 'Send to back', 13, 'Mod+Shift+[', -1, true),
]
