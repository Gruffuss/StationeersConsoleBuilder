// The rectangle (R) by a box.
import { boxTool, lookOf, newNode } from '../draw'
export default boxTool({ id: 'rect', label: 'Rectangle', order: 10, key: 'R', kind: 'R',
  make: (b, t) => newNode('R', { x: b.x, y: b.y, w: b.w, h: b.h }, lookOf('R', t)) })
