// check.ts — everything the main thread needs to know about one scene, computed off it: the validator's issues and the
// trap warnings anchored by path, the canonical text and the mod's numbering. Runs in check.worker.ts.
import { parseOrder, type Order } from '../model/numbering'
import { duplicateIds } from '../schema/duplicateIds'
import type { Scene, SrcNode } from '../model/scene'
import { trapsOf } from '../schema/traps'
import { printChecked } from './print'
import { validateScene } from './validate'
import { unpack, type Wire } from './wire'

export type NodeRef = { inDefs: boolean; path: number[] }
/** ref: the node it is about (none: the SCENE header, or the whole scene). key: the attribute it is about, as written. */
export type CheckIssue = { message: string; ref?: NodeRef; key?: string }
/**
 * src and order are set only for a valid scene. tooLarge: the check ran out of a work budget or of time; that is not
 * invalid, but such a scene is not sent to the preview either, and its one error (the reason) is shown as information.
 */
export type Checked = { errors: CheckIssue[]; warnings: CheckIssue[]; src: string | null; order: Order; tooLarge?: true }

/** A verdict without a check: the scene is invalid for this reason. */
export const invalid = (message: string): Checked => ({ errors: [{ message }], warnings: [], src: null, order: { ops: [], nodes: [] } })
/** The verdict on a scene too large to check here, because of `why`. */
export const tooLarge = (why: string): Checked => ({ ...invalid(`this scene is too large to check here (${why}); it is not sent to the preview`), tooLarge: true })

/**
 * The path of each written node in `wanted`, in one walk of the root and the defs with one path array: memory is O(depth)
 * plus the paths returned. ponytail: a path per node with an issue, so a scene with an issue on every level of a deep
 * chain costs issues × depth; number the refs (pre-order) instead if that shows up.
 */
function refsOf(scene: Scene, wanted: Set<SrcNode>): Map<SrcNode, NodeRef> {
  const refs = new Map<SrcNode, NodeRef>()
  for (const [list, inDefs] of [[scene.root, false], [scene.defs, true]] as const) {
    const frames = [{ nodes: list, k: 0 }], path: number[] = []
    while (frames.length && refs.size < wanted.size) {
      const f = frames[frames.length - 1]
      if (f.k === f.nodes.length) { frames.pop(); path.pop(); continue }
      const n = f.nodes[f.k]
      path.push(f.k++)
      if (wanted.has(n)) refs.set(n, { inDefs, path: path.slice() })
      if (n.c?.length) frames.push({ nodes: n.c, k: 0 })
      else path.pop()
    }
  }
  return refs
}

/** The validator's issues, then the trap warnings (traps.ts), each on its node's path. Only the validator's work budgets
 *  make a valid scene too large to check here: the traps' budget leaves a warning, never a verdict. */
export function checkScene(scene: Scene): Checked {
  const v = validateScene(scene), ok = !v.errors.length
  if (ok && v.tooLarge !== undefined) return tooLarge(v.tooLarge)
  // The duplicate-id trap, reported here only, and only once the validator walked the whole scene: past its budget the
  // scene is too large for one more unbudgeted walk, valid or not.
  if (v.tooLarge === undefined) for (const d of duplicateIds(scene)) v.warnings.push({ message: d.message, from: 0, to: 0, line: 0, col: 0, node: d.node })
  const traps = trapsOf(scene), wanted = new Set<SrcNode>()
  for (const i of [...v.errors, ...v.warnings, ...traps]) if (i.node) wanted.add(i.node)
  const refs = refsOf(scene, wanted)
  const out = (i: { message: string; node?: SrcNode; key?: string }): CheckIssue => ({ message: i.message,
    ...(i.node && refs.has(i.node) && { ref: refs.get(i.node) }), ...(i.key !== undefined && { key: i.key }) })
  return { errors: v.errors.map(out), warnings: [...v.warnings, ...traps].map(out), src: ok ? printChecked(scene) : null, order: ok ? parseOrder(scene) : { ops: [], nodes: [] } }
}

/** What the checker posts: a scene, packed (wire.ts), and the id its answer carries. */
export type CheckRequest = { id: number; scene: Wire }
/** check.worker.ts's answer to one request. */
export const answer = (m: CheckRequest) => ({ id: m.id, checked: checkScene(unpack(m.scene) as Scene) })
