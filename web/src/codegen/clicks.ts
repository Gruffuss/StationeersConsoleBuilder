// What a page lets the player press (spec §6.2): widget plates with the step their module suggests, raw nodes that ask for
// events, and text inputs (their on_change). Actions bind to these ids; a repeat's plates arrive as `id:i`, matched by id.
import type { Page } from '../model/project'
import type { SrcNode } from '../model/scene'
import { textOf, first } from '../srctext/props'
import type { Theme } from '../theme/types'
import { expandRoot, nativesOf, widgetsIn } from '../widgets/core'
import { nodeAt } from '../model/store'

export type ClickTarget = { id: string; page: string; step: string; press: boolean; inRepeat: boolean; widget?: string; native?: true }
// Any of these makes a node clickable as click = 1 does (REFERENCE.md); enter/exit/drag events themselves reach no action.
// A flag is on as the mod reads it: a number above 0.5 (SceneModel.cs, PropNumber(map, key, 0f) > 0.5f; text or a list is 0).
const EVENTS = ['CLICK', 'PRESS', 'XY', 'HOVEREV', 'DRAG', 'DROP']
const on = (n: SrcNode, key: string) => { const v = first(n, key); return typeof v === 'number' && v > 0.5 }

/** Clickable nodes under `nodes`, by id (the first of each id, in pre-order), with press and in-a-repeat flags. Iterative. */
function clickable(nodes: SrcNode[]): Map<string, { press: boolean; inRepeat: boolean }> {
  const found = new Map<string, { press: boolean; inRepeat: boolean }>()
  const stack = nodes.map(n => ({ n, rep: false })).reverse()
  while (stack.length) {
    const { n, rep } = stack.pop()!
    const id = textOf(first(n, 'ID'))
    if (typeof id === 'string' && id && !found.has(id) && EVENTS.some(k => on(n, k))) found.set(id, { press: on(n, 'PRESS'), inRepeat: rep })
    const inner = rep || n.op.toUpperCase() === 'RP'   // an op in any case: the mod upper-cases it (SceneModel.cs)
    for (let k = (n.c?.length ?? 0) - 1; k >= 0; k--) stack.push({ n: n.c![k], rep: inner })
  }
  return found
}

/** One target per id on the page, the first in pre-order (raw nodes and widget plates in scene order, then text inputs):
 *  every node with an id sends that id, so one action answers them all, and a picker keys its options by id. */
export function clickTargets(page: Page, t: Theme): ClickTarget[] {
  const out: ClickTarget[] = [], at = page.id, seen = new Set<string>()
  const add = (c: ClickTarget) => { if (!seen.has(c.id)) { seen.add(c.id); out.push(c) } }
  const widgets = new Map(widgetsIn(page.scene, t).map(({ path, ref }) => [nodeAt(page.scene.root, path)!, ref]))
  const stack = page.scene.root.map(n => ({ n, rep: false })).reverse()
  while (stack.length) {
    const { n, rep } = stack.pop()!, w = widgets.get(n)
    if (w) {
      const { exp } = expandRoot(w, t), f = clickable(exp.nodes)
      for (const c of exp.clicks ?? []) add({ id: c.id, page: at, step: c.step, press: f.get(c.id)?.press ?? false, inRepeat: rep || (f.get(c.id)?.inRepeat ?? false), widget: w.uid })
    } else {
      for (const [id, f] of clickable([{ ...n, c: undefined }])) add({ id, page: at, step: '', ...f, inRepeat: rep })
      for (let i = (n.c?.length ?? 0) - 1; i >= 0; i--) stack.push({ n: n.c![i], rep: rep || n.op.toUpperCase() === 'RP' })
    }
  }
  for (const { uid, el } of nativesOf(page, t)) if (el.type === 'textinput') add({ id: uid, page: at, step: 'set', press: false, inRepeat: false, native: true })
  return out
}

export type Suggested = { op: 'toggle' } | { op: 'cycle' } | { op: 'set'; value: number } | { op: 'page'; page: string }
  | { op: 'step'; by: number; min: number; max: number } | { op: 'index' } | { op: 'none' }
const NUM = String.raw`(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`
/** A module's suggested step (widgets/types.ts Click): 'toggle', 'cycle', 'set(2)', 'page(p2)', 'step(-1,0,10)', 'id:i', ''. */
export function parseStep(s: string): Suggested {
  if (s === 'toggle' || s === 'cycle') return { op: s }
  if (s === 'id:i') return { op: 'index' }
  let m = new RegExp(`^set\\(${NUM}\\)$`).exec(s)
  if (m) return { op: 'set', value: Number(m[1]) }
  m = /^page\((.+)\)$/.exec(s)
  if (m) return { op: 'page', page: m[1] }
  m = new RegExp(`^step\\(${NUM},${NUM},${NUM}\\)$`).exec(s)
  if (m) return { op: 'step', by: Number(m[1]), min: Number(m[2]), max: Number(m[3]) }
  return { op: 'none' }
}
