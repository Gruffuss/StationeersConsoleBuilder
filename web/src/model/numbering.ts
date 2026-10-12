// The mod's node numbering: the pre-order parse index that node spans carry (core/vendor/vector/SceneModel.cs).
// From SceneModel.cs at v0.11.94 (ParseNodes and ParseLevel, ParseNode, ParseDefs), checked against
// the C# fixtures test/fixtures/examples/*.nodes.json:
// - Only root nodes are numbered: DEFS (gradients, clips, symbols) are not in the parsed tree.
// - ParseNode returns null for an op it does not know, and ParseNodes drops it with its whole subtree.
// - USE parses as a Group, then its expansion: the body of the SYM in DEFS whose id equals its `ref` (exact ids, the
//   last SYM of an id wins, a SYM without a body is none), %params substituted. Then the USE's own block, if any.
// - A USE whose symbol is unknown is still a Group, with nothing expanded (the mod reports the problem).
// - The mod refuses a symbol already being expanded (0.11.77) and has no depth limit (0.11.85); numbering stops at the
//   same symbol, walks any depth, and stops only when its work budget is exhausted.
import { NODE_OPS } from '../schema'
import { textOf, first, foldKey } from '../srctext/props'
import { MAX_WORK, merge, own, substitute, type Arg } from '../srctext/validate'
import type { Scene, SrcNode } from './scene'

export const KNOWN_OPS: ReadonlySet<string> = new Set(NODE_OPS)

/**
 * The mod's parse order, with no path per node (a 100,000-deep scene would hold 5·10⁹ numbers): parse index k parses as
 * `ops[k]` and comes from the written node `nodes[k]`, counted in pre-order over scene.root with every written node
 * counted (an expanded node gives its USE's). pathOfIndex and indexOfNode turn a count into a path and back.
 */
export type Order = { ops: string[]; nodes: number[] }

/** How many nodes `n`'s subtree holds, itself included. */
const sizeOf = (n: SrcNode) => {
  let k = 0
  for (const todo = [n]; todo.length; k++) for (const c of todo.pop()!.c ?? []) todo.push(c)
  return k
}

/**
 * Walks the nodes the mod parses, in its parse order, until `visit` returns true: the op each parses as and the written
 * node it comes from. Gives up once
 * its substitutions cost more than MAX_WORK: past that the validator calls the scene too large, and a substitution is no
 * longer the mod's.
 */
function walk(scene: Scene, visit: (op: string, w: number) => boolean) {
  const syms = new Map<string, SrcNode>()
  for (const n of scene.defs) {
    const id = foldKey(n.op) === 'SYM' ? textOf(first(n, 'ID')) : undefined
    if (typeof id === 'string' && id && n.c?.length) syms.set(id, n)
  }
  // Depth first with an explicit stack: the mod has no nesting limit (0.11.85), so neither has this. A frame is a node
  // list being walked: the symbol arguments (null outside an expansion), the written node every node of an expansion
  // maps to (its USE's; -1 outside one) and, for an expansion, its ref, which is on the chain while the frame is on the
  // stack. Nothing is kept per node, so memory is O(depth).
  type Frame = { list: SrcNode[]; k: number; args: Arg[] | null; use: number; ref?: string }
  const frames: Frame[] = [{ list: scene.root, k: 0, args: null, use: -1 }]
  const chain = new Set<string>(), cost = { units: 0 }   // one count for every substitution of the walk
  let written = 0   // written nodes passed so far (pre-order over scene.root)
  while (frames.length) {
    const f = frames[frames.length - 1]
    if (f.k >= f.list.length) {
      frames.pop()
      if (f.ref !== undefined) chain.delete(f.ref)
      continue
    }
    cost.units += 32
    const n = f.list[f.k++], op = f.args ? substitute(n.op, f.args, cost) : n.op
    if (cost.units > MAX_WORK) return
    if (typeof op !== 'string' || !KNOWN_OPS.has(foldKey(op))) {   // dropped with its whole subtree
      if (f.use < 0) written += sizeOf(n)
      continue
    }
    const w = f.use < 0 ? written++ : f.use
    if (visit(op, w)) return
    // The USE's expansion comes before its own block: pushed last, so walked first.
    if (n.c) frames.push({ list: n.c, k: 0, args: f.args, use: f.use })
    if (foldKey(op) === 'USE') {
      const attrs: Arg[] = Object.entries(n.attrs).map(([key, v]) => [key, f.args ? substitute(v, f.args, cost) : v])
      if (cost.units > MAX_WORK) return
      const ref = textOf(attrs.find(([key]) => foldKey(key) === 'REF')?.[1])
      const sym = ref !== undefined ? syms.get(ref) : undefined
      if (sym && !chain.has(ref as string)) {
        chain.add(ref as string)
        frames.push({ list: sym.c!, k: 0, args: merge(own(sym, sym.op, Object.entries(sym.attrs)), own(n, op, attrs)), use: w, ref: ref as string })
      }
    }
  }
}

/** Every node the mod parses, in its parse order (see walk): the op it parses as and the written node it comes from. */
export function parseOrder(scene: Scene): Order {
  const ops: string[] = [], nodes: number[] = []
  walk(scene, (op, w) => { ops.push(op); nodes.push(w); return false })
  return { ops, nodes }
}

/** The path of the `w`-th written node of `list` in pre-order, or null: O(nodes) time, one path's memory. */
export function pathOfIndex(list: SrcNode[], w: number): number[] | null {
  if (!Number.isInteger(w) || w < 0) return null
  const frames = [{ list, k: 0 }], path: number[] = []
  for (let count = 0; frames.length;) {
    const f = frames[frames.length - 1]
    if (f.k === f.list.length) { frames.pop(); path.pop(); continue }
    const n = f.list[f.k]
    path.push(f.k++)
    if (count++ === w) return path
    if (n.c?.length) frames.push({ list: n.c, k: 0 })
    else path.pop()
  }
  return null
}

/** The pre-order number of the written node at `path` in `list` (what Order.nodes holds), or null if there is none. */
export function indexOfNode(list: SrcNode[], path: number[]): number | null {
  let w = 0, at: SrcNode[] | undefined = list
  for (let d = 0; d < path.length; d++) {
    const k = path[d]
    if (!at || !Number.isInteger(k) || k < 0 || k >= at.length) return null
    for (let j = 0; j < k; j++) w += sizeOf(at[j])
    if (d < path.length - 1) { w++; at = at[k].c }
  }
  return path.length ? w : null
}

/** The first parse index whose written node is at `path` in scene.root (a USE's own index for a USE), or null. */
export function indexOfPath(order: Order, root: SrcNode[], path: number[]): number | null {
  const w = indexOfNode(root, path)
  const k = w === null ? -1 : order.nodes.indexOf(w)
  return k < 0 ? null : k
}

// Test oracles: the app numbers through parseOrder with indexOfPath and pathOfIndex; the two walks below answer the same
// questions one index at a time, and the tests hold each side to the other (and walk's early stop is theirs).

/** The source path of parse index `index` (a root path; an expanded node gives its USE's), or null. Walks to it, no further. */
export function indexToPath(scene: Scene, index: number): number[] | null {
  if (!Number.isInteger(index) || index < 0) return null
  let k = 0, w = -1
  walk(scene, (_, x) => k++ === index && (w = x, true))
  return w < 0 ? null : pathOfIndex(scene.root, w)
}

/**
 * The parse index of the node at a root path (a USE's own index for a USE), or null if the mod does not parse it. Walks
 * to it, no further: the written nodes come in pre-order, so once a later one is reached, this one never comes.
 */
export function pathToIndex(scene: Scene, path: number[]): number | null {
  const w = indexOfNode(scene.root, path)
  if (w === null) return null
  let k = 0, found: number | null = null
  walk(scene, (_, x) => x >= w ? (x === w && (found = k), true) : (k++, false))
  return found
}
