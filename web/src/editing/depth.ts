// Editing depth promotes the raw pick without changing how the frame is hit-tested.
import type { Scene, SrcNode } from '../model/scene'
import type { Selection } from '../model/store'
import { foldKey } from '../srctext/props'
import type { Theme } from '../theme'
import { expandRoot, widgetAt, widgetOf } from '../widgets/core'
import { hidden } from './bounds'
import { isLock } from './tree'

/** A hit on the virtual child after a holder's scene children. */
export function nativeTarget(hitUid: string, P: number[], E: number[], deep: boolean): { path: number[]; native?: string } {
  const inside = E.every((k, i) => P[i] === k)
  return deep || inside && E.length === P.length || !P.length
    ? { path: [], native: hitUid }
    : { path: P.slice(0, inside ? E.length + 1 : 1) }
}

export function pickAt(hit: Selection, entered: number[], deep: boolean, scene: Scene, t: Theme): Selection {
  if (!hit.inDefs && hit.native === undefined && entered.every((k, i) => hit.path[i] === k) && entered.length) {
    const w = widgetAt(scene, entered, t)
    if (w) {
      const parts = Object.values(expandRoot(w, t).exp.parts!), path = hit.path.slice(entered.length)
      const named = parts.filter(p => p.length <= path.length && p.every((k, i) => path[i] === k)).sort((a, b) => b.length - a.length)[0]
      return { ...hit, path: [...entered, ...(named ?? [])] }
    }
  }
  if (deep || hit.inDefs || hit.native !== undefined) return hit
  const inside = entered.length < hit.path.length && entered.every((k, i) => hit.path[i] === k)
  return { ...hit, path: hit.path.slice(0, inside ? entered.length + 1 : 1) }
}

/** The deepest visible, unlocked group on this path, stopping at a widget root. */
export function enterablePath(scene: Scene, path: number[], t: Theme): number[] {
  let list: Scene['root'] | undefined = scene.root, depth = 0
  for (let d = 0; d < path.length; d++) {
    const n: SrcNode | undefined = list?.[path[d]]
    if (!n || hidden(n) || n.comments?.some(isLock)) break
    if (widgetOf(n, t)) return path.slice(0, d + 1)
    if (foldKey(n.op) === 'G' && n.c?.length) depth = d + 1
    list = n.c
  }
  return path.slice(0, depth)
}
/** Visible, unlocked ordinary groups and widget roots can be entered. */
export const enterable = (scene: Scene, path: number[], t: Theme): boolean => !!path.length && enterablePath(scene, path, t).length === path.length
