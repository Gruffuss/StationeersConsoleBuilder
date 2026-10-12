// An exact gap between the members, in design units (the status bar's field): ordered by start, the first stays, each
// next starts the gap after the previous end (a negative gap overlaps them). A member that has to move
// and cannot (locked) would break the gap: then nothing moves, and that is said.
import { membersOf } from '../ctx'
import { gapOf } from '../layout'
import type { Command } from '../types'
import { spaced } from './align'

// A number as people type it: a sign, digits with a decimal point or comma, an exponent (not 0x10 or 0b11).
const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)(e[+-]?\d+)?$/i

const entry = (axis: 'x' | 'y', label: string, order: number): Command => ({ kind: 'command', id: `gap.${axis}`, label, menu: 'align', order,
  when: ctx => membersOf(ctx).length >= 2,
  run(ctx, arg) {
    const t = arg?.trim() ?? '', g = NUMBER.test(t) ? Number(t.replace(',', '.')) : NaN
    if (!Number.isFinite(g)) { ctx.note('a gap is a number of design units'); return }
    return spaced(ctx, 2, boxes => gapOf(boxes, axis, g), true)
  } })
export default [entry('x', 'Gap across', 20), entry('y', 'Gap down', 21)]
