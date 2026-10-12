// The text (T) by its box.
import { boxTool, lookOf, newNode } from '../draw'
export default boxTool({ id: 'text', label: 'Text', order: 15, key: 'T', kind: 'T',
  make: (b, t) => newNode('T', { x: b.x, y: b.y, w: b.w, h: b.h, text: 'Text' }, lookOf('T', t)) })
