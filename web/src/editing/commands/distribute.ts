// Distribute: three or more, equal gaps between neighbours ordered by centre, the outer two fixed (spec §4 "Space"). A
// member that has to move and cannot (locked) would leave the gaps unequal: then nothing moves, and that is said.
import { membersOf, nativeMembersOf } from '../ctx'
import { distribute } from '../layout'
import type { Command } from '../types'
import { spaced } from './align'

const entry = (axis: 'x' | 'y', label: string, key: string, order: number): Command => ({ kind: 'command', id: `distribute.${axis}`, label,
  menu: 'align', order, keys: [key], when: ctx => membersOf(ctx).length + nativeMembersOf(ctx).length >= 3,
  run: ctx => spaced(ctx, 3, boxes => distribute(boxes, axis), true) })
export default [entry('x', 'Distribute horizontally', 'Alt+Shift+H', 10), entry('y', 'Distribute vertically', 'Alt+Shift+V', 11)]
