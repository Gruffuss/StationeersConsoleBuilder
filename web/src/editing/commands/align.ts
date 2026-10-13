// Align (spec §4 "Space"): two or more members to their union's edge or centre, one member to the page.
// A member with no literal box, or not drawn (it or a node above it hidden), is skipped and said; moveUnits skips
// expression axes and locked members. Numbers only: no check.
import type { Box } from '../../editor/geometry'
import { hidden } from '../bounds'
import { membersOf, nativeMembersOf } from '../ctx'
import { moveNatives, nativeUnitsOf, shownNatives } from '../natives'
import { align, type AlignMode, type Delta } from '../layout'
import { onPath } from '../tree'
import type { Command, Ctx } from '../types'
import { moveUnits, unitsOf } from '../units'

/** The members moved by `deltas` of their boxes (design units), when at least `least` have one; what stayed is said.
 *  whole: the spacing holds only when every member it moves does move (distribute, gap), so when one cannot (locked,
 *  say), nothing moves. */
export function spaced(ctx: Ctx, least: number, deltas: (boxes: Box[]) => Delta[], whole = false) {
  const page = ctx.page(), t = ctx.theme(), units = unitsOf(page.scene, membersOf(ctx), t, page.natives)
  const nativeUnits = nativeUnitsOf(page, nativeMembersOf(ctx), t), visible = new Set(shownNatives(page, t).map(n => n.uid))
  // Nothing of a node hidden (a literal v <= 0.5), or under one, is drawn to line up with.
  const shown = units.filter(u => !onPath(page.scene.root, u.sel.path, hidden)), boxed = shown.filter(u => u.box)
  const nativeShown = nativeUnits.filter(u => visible.has(u.ref.uid)), hiddenCount = units.length - shown.length + nativeUnits.length - nativeShown.length
  const no = [...hiddenCount ? [`${hiddenCount} skipped: hidden`] : [],
    ...shown.length > boxed.length ? [`${shown.length - boxed.length} skipped: no box`] : []]
  if (boxed.length + nativeShown.length < least) { ctx.note([`this needs ${least} or more nodes with a box`, ...no].join('; ')); return }
  const d = deltas([...boxed.map(u => u.box!), ...nativeShown.map(u => u.box)])
  const r = moveUnits(page.scene, boxed, d.slice(0, boxed.length), t)
  const n = moveNatives(page.natives ?? [], nativeShown, d.slice(boxed.length), t)
  if (whole && (r.skipped.length || n.skipped.length)) {
    ctx.note([...no, ...r.skipped, ...n.skipped, 'nothing moved: the spacing needs every one of them to move'].join('; '))
    return
  }
  const said = [...no, ...r.skipped, ...n.skipped, ...r.notes]
  if (said.length) ctx.note(said.join('; '))
  return r.scene === page.scene && n.natives === (page.natives ?? n.natives) ? undefined : ctx.apply({ scene: r.scene, ...(nativeUnits.length && { natives: n.natives }) })
}

const MODES: [AlignMode, string, string][] = [['left', 'Align left', 'Alt+A'], ['centre', 'Align centre', 'Alt+H'], ['right', 'Align right', 'Alt+D'],
  ['top', 'Align top', 'Alt+W'], ['middle', 'Align middle', 'Alt+V'], ['bottom', 'Align bottom', 'Alt+S']]
export default MODES.map(([mode, label, key], k): Command => ({ kind: 'command', id: `align.${mode}`, label, menu: 'align', order: k, keys: [key],
  when: ctx => membersOf(ctx).length + nativeMembersOf(ctx).length > 0,
  run(ctx) {
    // One member goes to the page; several to their union, even when only one of them has a box (it then stays).
    const many = membersOf(ctx).length + nativeMembersOf(ctx).length > 1
    return spaced(ctx, 1, boxes => align(boxes, mode, many && boxes.length === 1 ? boxes[0] : { x: 0, y: 0, ...ctx.view().size }))
  } }))
