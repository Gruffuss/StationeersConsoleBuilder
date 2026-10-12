// The duplicate-id trap: a warning in traps.ts's Trap shape. It is reported from one place only, srctext/check.ts;
// trapsOf does not list it, or each duplicate would be warned twice.
import type { Scene, SrcNode } from '../model/scene'
import { textOf, first } from '../srctext/props'

type Dup = { id: 'duplicate-id'; message: string; node: SrcNode }
// DEFS keeps one table per kind (SceneModel.cs: scene.Gradients for GL GR GC, Clips, Symbols), so a gradient and a clip
// may share an id. Any other op is a table of its own.
const TABLE: Record<string, string> = { GL: 'gradient', GR: 'gradient', GC: 'gradient', CP: 'clip', SYM: 'symbol' }
/** A DEFS node's table and id as one key (`gradient theme_row`); undefined when it has no id, which the mod skips. */
export function defKey(d: SrcNode): string | undefined {
  const id = textOf(first(d, 'ID')), op = d.op.toUpperCase()
  return op !== 'FONT' && typeof id === 'string' && id ? `${Object.hasOwn(TABLE, op) ? TABLE[op] : op} ${id}` : undefined
}
const dup = (node: SrcNode, message: string): Dup => ({ id: 'duplicate-id', message, node })
/** The symbols the USEs in `list` draw, in written order, with how many USEs name each. An explicit stack, pre-order. */
function usesIn(list: SrcNode[]): Map<string, number> {
  const out = new Map<string, number>(), stack = [...list].reverse()
  for (let n = stack.pop(); n; n = stack.pop()) {
    const ref = textOf(first(n, 'REF'))
    if (n.op.toUpperCase() === 'USE' && typeof ref === 'string') out.set(ref, (out.get(ref) ?? 0) + 1)
    for (let k = (n.c?.length ?? 0) - 1; k >= 0; k--) stack.push(n.c![k])
  }
  return out
}

/**
 * Ids that collide in the drawn scene. Every node with an id registers it (SceneModel.cs: scene.Identified), so two such
 * nodes report the same clicks and hover, and M3 binds by id: the root's nodes, and each symbol body as often as USE draws
 * it (a body id holding % is substituted per USE, so it is left out). In DEFS: two definitions of one kind with one id,
 * of which only one is used. The second and later nodes carry the trap. Explicit stacks, pre-order: any depth.
 */
export function duplicateIds(scene: Scene): Dup[] {
  const out: Dup[] = [], defs: Dup[] = [], keys = new Set<string>(), bodies = new Map<string, SrcNode[]>()
  for (const d of scene.defs) {
    const k = defKey(d), op = d.op.toUpperCase()
    if (k === undefined || !Object.hasOwn(TABLE, op)) continue
    if (keys.has(k)) defs.push(dup(d, `${TABLE[op]} "${textOf(first(d, 'ID'))}" is defined twice in DEFS: only one of them is used`))
    keys.add(k)
    if (op === 'SYM') bodies.set(textOf(first(d, 'ID'))!, d.c ?? [])   // USE draws the last definition
  }
  // How often each symbol is drawn, counted up to 2 (all a collision needs): a USE in the root draws once, a USE in a body
  // as often as that body is drawn. A count rises at most twice, so the worklist ends, a cycle of symbols included.
  const drawn = new Map<string, number>(), todo: [string, number][] = []
  const draw = (ref: string, times: number) => {
    const was = drawn.get(ref) ?? 0, now = Math.min(2, was + times)
    if (now > was && bodies.has(ref)) { drawn.set(ref, now); todo.push([ref, now - was]) }
  }
  for (const [ref, c] of usesIn(scene.root)) draw(ref, c)
  const uses = new Map<string, Map<string, number>>()
  for (let job = todo.pop(); job; job = todo.pop()) {
    const [s, more] = job
    if (!uses.has(s)) uses.set(s, usesIn(bodies.get(s)!))
    for (const [ref, c] of uses.get(s)!) draw(ref, c * more)
  }
  const count = new Map<string, number>()
  const walk = (list: SrcNode[], times: number, sym?: string) => {
    const stack = [...list].reverse()
    for (let n = stack.pop(); n; n = stack.pop()) {
      const id = textOf(first(n, 'ID'))
      if (typeof id === 'string' && id && !(sym !== undefined && id.includes('%'))) {
        const c = (count.get(id) ?? 0) + times
        count.set(id, c)
        if (c >= 2) out.push(dup(n, sym === undefined ? `id "${id}" is used twice in this scene: both nodes report the same clicks and hover`
          : `id "${id}" in symbol "${sym}" is drawn more than once in this scene: every copy reports the same clicks and hover`))
      }
      for (let k = (n.c?.length ?? 0) - 1; k >= 0; k--) stack.push(n.c![k])
    }
  }
  walk(scene.root, 1)
  for (const [s, times] of drawn) walk(bodies.get(s)!, times, s)
  return [...out, ...defs]
}
