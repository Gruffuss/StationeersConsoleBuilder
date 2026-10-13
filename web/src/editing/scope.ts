// Pointer expression scope shared by structural commands and native holders.
import type { SrcNode, Value } from '../model/scene'
import { first, foldKey, textOf } from '../srctext/props'

// `hover` or `down` read by an expression: an `=` value or a `{=...}` placeholder (Expression.cs names them so; `$hover`
// is data, `downs` another name).
export const POINTER = /(?<![\w$.])(?:hover|down)(?![\w(])/
export function readsPointer(attrs: Record<string, Value>): boolean {
  const stack: Value[] = Object.values(attrs)
  for (let v = stack.pop(); v !== undefined; v = stack.pop()) {
    if (Array.isArray(v)) for (const x of v) stack.push(x)
    else if (typeof v === 'string' && (v[0] === '=' || v.includes('{=')) && POINTER.test(v)) return true
  }
  return false
}

/** Whether a node answers to the group's id for `hover` and `down` (REFERENCE.md: the nearest node with an id is their
 *  scope; Tessellator.cs Visit): one without an id of its own, outside every node with one, that reads either, the
 *  nodes of a symbol a USE without an id draws included. Explicit stack. */
export function answersTo(kids: readonly SrcNode[], defs: readonly SrcNode[]): boolean {
  const seen = new Set<string>(), stack = [...kids]
  for (let n = stack.pop(); n; n = stack.pop()) {
    const id = textOf(first(n, 'ID'))
    if (id) continue
    if (readsPointer(n.attrs)) return true
    const ref = foldKey(n.op) === 'USE' ? first(n, 'REF') : undefined
    if (typeof ref === 'string' && !seen.has(ref)) {
      seen.add(ref)
      for (const d of defs) if (first(d, 'ID') === ref) for (const c of d.c ?? []) stack.push(c)
    }
    for (const c of n.c ?? []) stack.push(c)
  }
  return false
}
