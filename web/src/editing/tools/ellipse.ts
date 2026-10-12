// The ellipse (C) by its box: Shift draws a circle (rx alone: absent ry follows it).
import { boxTool, lookOf, newNode } from '../draw'
export default boxTool({ id: 'ellipse', label: 'Ellipse', order: 11, key: 'O', kind: 'C',
  make: (b, t, mods) => newNode('C', { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ...(mods.shift ? {} : { ry: b.h / 2 }) }, lookOf('C', t)) })
