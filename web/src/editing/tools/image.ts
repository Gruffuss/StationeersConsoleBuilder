// The image placeholder (ruling R8): an R marked # image. Giving it a source turns it into an IMG
// (commands/picture.ts); an IMG without src is a reported scene problem, so a new box does not start as one.
import { boxTool, lookOf, newNode } from '../draw'
import { IMAGE } from '../tree'
export default boxTool({ id: 'image', label: 'Image', order: 16, key: 'I', kind: 'image',
  make: (b, t) => newNode('R', { x: b.x, y: b.y, w: b.w, h: b.h }, lookOf('image', t), [IMAGE]) })
