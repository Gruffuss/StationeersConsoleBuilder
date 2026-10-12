// The selection's handles, drawn only (spec §4 "Transform"): the select tool hit-tests them itself (editing/select.tsx
// handleAt), so one pointer path runs from the canvas through the router to the tool. Eight squares on the handle box's
// sides and corners and a rotate knob beyond its top side, placed through the box's chain to surface px.
import type { Scene, SrcNode } from '../model/scene'
import type { Theme } from '../theme'
import { widgetAt, widgetsIn } from '../widgets/core'
import { nodeAt } from '../model/store'
import { boundsOf, worldOf } from '../editing/bounds'
import { WIDGETS } from '../widgets/registry'
import { apply, type Box, type Handle, type Mat } from './geometry'

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
export const HANDLE_SIZE = 8   // CSS px
export const KNOB = 24         // CSS px from the middle of the top side to the rotate knob, away from the centre

/** The selected widget root's box (its x y w h params) and the handles its module allows; null for anything else. */
export function widgetBox(scene: Scene, path: number[] | undefined, t: Theme): { box: Box; handles: Handle[] } | null {
  const w = widgetAt(scene, path, t)
  if (!w) return null
  const p = w.params as Box, r = WIDGETS[w.type].resize
  return { box: { x: p.x, y: p.y, w: p.w, h: p.h }, handles: r === 'both' ? HANDLES : r === 'width' ? ['e', 'w'] : [] }
}

/** Widget params boxes in design units, by node at any depth (or by root index), for the marquee and snap targets. */
export function widgetBoxes(scene: Scene, t: Theme) {
  const boxes = new Map<SrcNode, Box>()
  for (const { path, ref } of widgetsIn(scene, t)) {
    const p = ref.params as Box, W = worldOf(scene, [...path, 0])
    const box = W && boundsOf({ op: 'R', attrs: { x: p.x, y: p.y, w: p.w, h: p.h } }, W)
    if (box) boxes.set(nodeAt(scene.root, path)!, box)
  }
  return (k: number, node = scene.root[k]): Box | null => boxes.get(node) ?? null
}

/** Each handle's place in CSS px: `box` in its own units, `chain` from them to surface px, `zoom` CSS px per surface px.
 *  only: the handles offered (default all eight); rotate: the knob too; within: the surface's size (surface px), which
 *  the knob stays on where it can. */
export function handlePoints(box: Box, chain: Mat, zoom: number, o: { only?: readonly Handle[]; rotate?: boolean; within?: { w: number; h: number } } = {}) {
  const at = (u: number, v: number) => { const [x, y] = apply(chain, box.x + box.w * u, box.y + box.h * v); return { x: x * zoom, y: y * zoom } }
  const pts: { h: Handle | 'rotate'; x: number; y: number }[] = (o.only ?? HANDLES).map(h =>
    ({ h, ...at(h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5, h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5) }))
  if (o.rotate) {
    // The box's own up through the chain; a box with no height (a flat line) takes the chain's up, -y in its frame.
    const c = at(0.5, 0.5), top = at(0.5, 0), d = Math.hypot(top.x - c.x, top.y - c.y), e = Math.hypot(chain[2], chain[3])
    const [ux, uy] = d > 1e-6 ? [(top.x - c.x) / d, (top.y - c.y) / d] : e > 0 ? [-chain[2] / e, -chain[3] / e] : [0, -1]
    // Beyond the top side; where that is off the surface (a node at the page's top), a press could not reach it, so
    // beyond the bottom side, else inside below the top side.
    const end = at(0.5, 1), w = o.within, on = (p: { x: number; y: number }) => !w || (p.x >= 0 && p.y >= 0 && p.x <= w.w * zoom && p.y <= w.h * zoom)
    const spots = [{ x: top.x + ux * KNOB, y: top.y + uy * KNOB }, { x: end.x - ux * KNOB, y: end.y - uy * KNOB }, { x: top.x - ux * KNOB, y: top.y - uy * KNOB }]
    pts.push({ h: 'rotate', ...spots.find(on) ?? spots[0] })
  }
  return pts
}

export function Handles({ box, chain, zoom, only, rotate, within }: { box: Box; chain: Mat; zoom: number; only?: readonly Handle[]; rotate?: boolean;
  within?: { w: number; h: number } }) {
  return handlePoints(box, chain, zoom, { only, rotate, within }).map(p => p.h === 'rotate'
    ? <circle key="rotate" className="vb-knob" cx={p.x} cy={p.y} r={HANDLE_SIZE / 2} />
    : <rect key={p.h} className="vb-handle" x={p.x - HANDLE_SIZE / 2} y={p.y - HANDLE_SIZE / 2} width={HANDLE_SIZE} height={HANDLE_SIZE} />)
}
