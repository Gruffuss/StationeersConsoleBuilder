import { describe, expect, it } from 'vitest'
import type { Frame, FrameElement, FrameText } from '../runtime/frame'
import { label } from '../runtime/testing'
import { labelAt, pickUnder, selectableNode, spanBounds, ztextOf } from './hitTest'

// pickUnder's hit alone: what M1's pickAt gave (App picks through pickUnder, editing/pick.ts).
const pickAt = (f: Frame, x: number, y: number, ztext = false) => pickUnder(f, x, y, ztext)?.hit ?? null

const box = { x: 0, y: 0, w: 10, h: 10 }

/** A synthetic frame. `vert` adds a vertex (alpha byte, coverage) and returns its index; `span` adds (element, node, first, count). */
function frameOf(ids = ['scene']) {
  const pos: number[] = [], col: number[] = [], cov: number[] = [], idx: number[] = [], spans: number[] = [], text: FrameText[] = []
  const vert = (x: number, y: number, a = 255, c = 1) => { pos.push(x, y); col.push(255, 255, 255, a); cov.push(c); return cov.length - 1 }
  const tri = (a: number, b: number, c: number) => idx.push(a, b, c)
  /** An opaque square as two triangles; returns its first vertex. */
  const square = (x0: number, y0: number, x1: number, y1: number) => {
    const a = vert(x0, y0), b = vert(x1, y0), c = vert(x1, y1), d = vert(x0, y1)
    tri(a, b, c)
    tri(a, c, d)
    return a
  }
  const span = (element: number, node: number, first: number, count: number) => spans.push(element, node, first, count)
  const build = (elements: Partial<FrameElement>[] = ids.map(() => ({}))): Frame => {
    const per = Math.ceil(cov.length / ids.length)  // vertices split evenly between the elements, in order
    return {
      positions: Float32Array.from(pos), coverage: Float32Array.from(cov), colours: Uint8Array.from(col), indices: Uint32Array.from(idx),
      spans: Int32Array.from(spans), text, problems: [],
      elements: ids.map((id, k) => ({ id, scene: id, x: 0, y: 0, w: 100, h: 100, firstVertex: k * per,
        vertexCount: Math.max(0, Math.min(per, cov.length - k * per)), ...elements[k] })),
    }
  }
  return { vert, tri, square, span, text, build }
}

describe('pickAt', () => {
  it('uses the measured cover order when ink outside a box moves its cover earlier', () => {
    const b = frameOf()
    b.square(20, 20, 30, 30) // outside both picking boxes
    b.text.push(label({ x: NaN }), label({ ...box, node: 3, cover: 4 }), label({ ...box, node: 4, cover: 0 }))
    const f = { ...b.build(), textCovers: [0, 0] }
    expect(pickAt(f, 5, 5)).toEqual({ element: 0, node: 4 }) // equal cuts: the later label on top
  })
  it('topmost wins: the later of two overlapping squares', () => {
    const b = frameOf()
    b.span(0, 0, b.square(0, 0, 10, 10), 4)
    b.span(0, 1, b.square(5, 5, 15, 15), 4)
    const f = b.build()
    expect(pickAt(f, 7, 7)).toEqual({ element: 0, node: 1 })
    expect(pickAt(f, 2, 2)).toEqual({ element: 0, node: 0 })
    expect(pickAt(f, 20, 20)).toBeNull()
  })

  it('innermost wins: the smallest span containing the vertex, wherever it is listed', () => {
    const b = frameOf()
    const g = b.square(0, 0, 10, 10)
    b.square(20, 0, 30, 10)
    b.span(0, 0, g, 8)   // the group, listed first here so that only the count decides
    b.span(0, 1, g, 4)
    b.span(0, 2, g + 4, 4)
    const f = b.build()
    expect(pickAt(f, 5, 5)).toEqual({ element: 0, node: 1 })
    expect(pickAt(f, 25, 5)).toEqual({ element: 0, node: 2 })
  })

  it('ties: G { R } with equal counts picks the first in list order, the child', () => {
    const b = frameOf()
    const r = b.square(0, 0, 10, 10)
    b.span(0, 1, r, 4)   // post-order: R before its G
    b.span(0, 0, r, 4)
    expect(pickAt(b.build(), 5, 5)).toEqual({ element: 0, node: 1 })
  })

  // A shape's fill 10..20 with a feather ring on its left side: outer vertices at x = 6, invisible. Under it, a background.
  const feathered = (outer: [number, number]) => {
    const b = frameOf()
    b.span(0, 0, b.square(0, 0, 30, 30), 4)
    const o0 = b.vert(6, 6, ...outer), o1 = b.vert(6, 24, ...outer), i0 = b.vert(10, 10), i1 = b.vert(10, 20)
    b.tri(o0, o1, i1)
    b.tri(o0, i1, i0)
    b.square(10, 10, 20, 20)
    b.span(0, 1, o0, 8)
    return b.build()
  }
  it.each([['alpha 0', [0, 1]], ['coverage 0', [255, 0]]] as const)('feather ignored: outer ring vertices at %s', (_, outer) => {
    const f = feathered([...outer])
    expect(pickAt(f, 15, 15)).toEqual({ element: 0, node: 1 })   // the fill
    expect(pickAt(f, 9, 15)).toEqual({ element: 0, node: 1 })    // the ring, 3/4 opaque there
    expect(pickAt(f, 6.05, 15)).toEqual({ element: 0, node: 0 }) // the ring, 1/80 opaque there: the background shows through
  })

  it('rotated text: a 40x10 box turned 90 degrees, over geometry', () => {
    const b = frameOf()
    b.span(0, 0, b.square(0, 0, 200, 200), 4)
    b.text.push(label({ node: 3, x: 80, y: 95, w: 40, h: 10, rotation: 90 }))   // centre (100, 100)
    const f = b.build()
    expect(pickAt(f, 100, 85)).toEqual({ element: 0, node: 3 })
    expect(pickAt(f, 115, 100)).toEqual({ element: 0, node: 0 })
    b.text[0] = label({ node: 3, x: 80, y: 95, w: 40, h: 10 })   // unturned, the same points read the other way round
    expect(pickAt(f, 100, 85)).toEqual({ element: 0, node: 0 })
    expect(pickAt(f, 115, 100)).toEqual({ element: 0, node: 3 })
  })

  it('cover-less labels stay on top, with the later label winning a tie', () => {
    const b = frameOf(), first = label({ ...box, node: 1 }), last = label({ ...box, node: 2 });
    delete (first as Partial<FrameText>).cover
    delete (last as Partial<FrameText>).cover
    b.text.push(label({ ...box, node: 3, cover: 100 }), first, last)
    expect(pickAt(b.build(), 5, 5)).toEqual({ element: 0, node: 2 })
    b.text.reverse()
    expect(pickAt(b.build(), 5, 5)).toEqual({ element: 0, node: 1 })
    first.cover = NaN; last.cover = Infinity
    expect(pickAt(b.build(), 5, 5)).toEqual({ element: 0, node: 1 })
  })

  it('later text wins over earlier text', () => {
    const b = frameOf()
    b.text.push(label({ ...box, node: 1 }), label({ ...box, node: 2, x: 5 }))
    expect(pickAt(b.build(), 7, 5)).toEqual({ element: 0, node: 2 })
  })

  it('rotated text: the sign of the turn, at 30 degrees counter-clockwise', () => {
    const b = frameOf()
    b.text.push(label({ node: 3, x: 80, y: 95, w: 40, h: 10, rotation: 30 }))   // centre (100, 100)
    const f = b.build(), c = Math.cos(Math.PI / 6) * 15, s = Math.sin(Math.PI / 6) * 15
    expect(pickAt(f, 100 + c, 100 - s)).toEqual({ element: 0, node: 3 })   // along the long axis, up and right on screen
    expect(pickAt(f, 100 + c, 100 + s)).toBeNull()                         // where a clockwise turn would put it
  })

  it('the clipped-away part of a label falls through to the shape below', () => {
    const b = frameOf()
    b.span(0, 0, b.square(0, 0, 100, 100), 4)
    b.text.push(label({ node: 1, x: 0, y: 0, w: 40, h: 10, clip: [0, 0, 20, 100] }))
    const f = b.build()
    expect(pickAt(f, 10, 5)).toEqual({ element: 0, node: 1 })
    expect(pickAt(f, 30, 5)).toEqual({ element: 0, node: 0 })
  })

  it('a label under a round clip is not hit in its clip box\'s corners', () => {
    const b = frameOf()
    b.span(0, 0, b.square(0, 0, 100, 100), 4)
    // An octagon in the box (0, 0, 20, 20), round enough: its corners are cut off.
    const octagon = [6, 0, 14, 0, 20, 6, 20, 14, 14, 20, 6, 20, 0, 14, 0, 6]
    b.text.push(label({ node: 1, x: 0, y: 0, w: 20, h: 20, clip: [0, 0, 20, 20], clipPolygon: octagon }))
    const f = b.build()
    expect(pickAt(f, 10, 10)).toEqual({ element: 0, node: 1 })
    expect(pickAt(f, 1, 1)).toEqual({ element: 0, node: 0 })
    expect(pickAt(f, 19, 19)).toEqual({ element: 0, node: 0 })
  })

  it('sheared text is hit where its slanted box is drawn', () => {
    const b = frameOf()
    // A 20 x 20 box centred on (50, 50); the shear moves its top edge right by 10 and its bottom edge left by 10.
    b.text.push(label({ node: 4, x: 40, y: 40, w: 20, h: 20, shear: [1, 1, 0, 1] }))
    const f = b.build()
    expect(pickAt(f, 68, 41)).toEqual({ element: 0, node: 4 })   // top right, past the unsheared box
    expect(pickAt(f, 41, 41)).toBeNull()                         // top left, sheared away
    expect(pickAt(f, 32, 59)).toEqual({ element: 0, node: 4 })
  })

  it.each([
    ['empty text', { text: '' }],
    ['text that is only rich-text tags', { text: '<b></b>' }],
    ['alpha 0', { colour: [1, 1, 1, 0] }],
    ['a non-finite box', { w: NaN }],
    ['a non-finite clip', { clip: [0, 0, Infinity, 10] }],
  ] as [string, Partial<FrameText>][])('a label that draws nothing is not hit: %s', (_, over) => {
    const b = frameOf()
    b.span(0, 0, b.square(0, 0, 100, 100), 4)
    b.text.push(label({ ...box, node: 1, ...over }))
    expect(pickAt(b.build(), 5, 5)).toEqual({ element: 0, node: 0 })
  })

  it('every label is hit, however many there are (no cap of our own)', () => {
    const b = frameOf()
    b.text.push(...Array.from({ length: 5000 }, () => label({ x: 50, y: 50, w: 1, h: 1 })), label({ ...box, node: 1 }))
    expect(pickAt(b.build(), 5, 5)).toEqual({ element: 0, node: 1 })
  })
})

describe('selectableNode', () => {
  it('foreign element: a span of an element other than scene is picked but not selectable', () => {
    const b = frameOf(['other', 'scene'])
    b.span(0, 0, b.square(0, 0, 10, 10), 4)
    b.span(1, 5, b.square(20, 0, 30, 10), 4)
    const f = b.build()
    const foreign = pickAt(f, 5, 5)
    expect(foreign).toEqual({ element: 0, node: 0 })
    expect(selectableNode(f, foreign, 'scene')).toBeNull()
    expect(selectableNode(f, pickAt(f, 25, 5), 'scene')).toBe(5)
  })

  it('another page: the scene element of a frame from another page or project is not selectable', () => {
    const b = frameOf()
    b.span(0, 5, b.square(0, 0, 10, 10), 4)
    const f = b.build([{ scene: 'p2' }])
    expect(selectableNode(f, pickAt(f, 5, 5), 'p1')).toBeNull()
    expect(selectableNode(f, pickAt(f, 5, 5), 'p2')).toBe(5)
  })

  it('natives: a click on the bg panel selects nothing, and a vector node under a native panel or label is still picked', () => {
    const b = frameOf(['bg', 'scene', 'over'])
    b.square(0, 0, 100, 100)                    // bg, a native panel below everything
    b.span(1, 5, b.square(20, 20, 30, 30), 4)    // the page's scene: node 5
    b.square(20, 20, 30, 30)                    // a native panel over it
    b.text.push(label({ element: 2, x: 20, y: 20, w: 10, h: 10 }))   // and a native label over it
    const f = b.build([{ scene: '' }, { scene: 'p1' }, { scene: '' }])
    expect(selectableNode(f, pickAt(f, 5, 5), 'p1')).toBeNull()
    expect(pickAt(f, 25, 25)).toEqual({ element: 1, node: 5 })
    expect(selectableNode(f, pickAt(f, 25, 25), 'p1')).toBe(5)
    // a page whose id is "": its vector element is still the page's
    const e = b.build([{ scene: '' }, { scene: '' }, { scene: '' }])
    expect(selectableNode(e, pickAt(e, 25, 25), '')).toBe(5)
  })

  it('unpaired text: a label with node -1 is picked but not selectable', () => {
    const b = frameOf()
    b.text.push(label({ ...box, node: -1 }))
    const f = b.build()
    const hit = pickAt(f, 5, 5)
    expect(hit).toEqual({ element: 0, node: -1 })
    expect(selectableNode(f, hit, 'scene')).toBeNull()
    expect(selectableNode(f, null, 'scene')).toBeNull()
  })
})

describe('ztext', () => {
  // A label (node 0, a T: no vertices) and a square (node 1) over it; `before`: the square is drawn first.
  const scene = (before: boolean) => {
    const b = frameOf()
    b.text.push(label({ x: 0, y: 0, w: 30, h: 30, node: 0 }))
    if (before) { b.span(0, 1, b.square(0, 0, 30, 30), 4); b.span(0, 0, 4, 0) }
    else { b.span(0, 0, 0, 0); b.span(0, 1, b.square(0, 0, 30, 30), 4) }
    return b.build()
  }
  it('reads ztext as the mod does: on unless a number at most 0.5', () => {
    expect(ztextOf({})).toBe(true)
    expect(ztextOf({ ZTEXT: 0 })).toBe(false)
    expect(ztextOf({ ztext: '=0' })).toBe(true)
  })
  it('picks a shape drawn after a label over it; a label drawn after a shape, or without ztext, stays on top', () => {
    expect(pickAt(scene(false), 5, 5, true)).toEqual({ element: 0, node: 1 })
    expect(pickAt(scene(false), 5, 5)).toEqual({ element: 0, node: 0 })
    expect(pickAt(scene(true), 5, 5, true)).toEqual({ element: 0, node: 0 })
  })
  it('without ztext, keeps a label over its own element\'s shapes, under a later element\'s, as the preview covers it', () => {
    // Element 0: the label (its cover is its element's end, vertex 4) over a square; element 1: a square over both.
    const b = frameOf(['scene', 'later'])
    b.text.push(label({ x: 0, y: 0, w: 30, h: 30, node: 0, cover: 4 }))
    b.span(0, 0, 0, 0)
    b.span(0, 1, b.square(0, 0, 30, 30), 4)
    b.span(1, 0, b.square(10, 10, 40, 40), 4)
    const f = b.build()
    expect(pickAt(f, 5, 5)).toEqual({ element: 0, node: 0 })
    expect(pickAt(f, 20, 20)).toEqual({ element: 1, node: 0 })
  })
  it('finds a label\'s place in the draw order: its T span\'s first vertex; for an unknown node, its cover', () => {
    const f = scene(true)
    expect(labelAt(f, f.text[0])).toBe(4)
    expect(labelAt(f, { ...f.text[0], node: -1, cover: 7 })).toBe(7)
  })
  it('places a label whose T is unknown (node -1) by its cover, as the preview draws it: a shape drawn over it wins', () => {
    const at = (cover?: number) => {
      const b = frameOf()
      b.text.push(label({ x: 0, y: 0, w: 30, h: 30, node: -1, ...(cover === undefined ? {} : { cover }) }))
      b.span(0, 1, b.square(0, 0, 30, 30), 4)
      return pickAt(b.build(), 5, 5, true)
    }
    expect(at(0)).toEqual({ element: 0, node: 1 })
    expect(at()).toEqual({ element: 0, node: -1 })   // nothing drawn over it (its cover past every vertex): on top
  })
  it('takes, where label boxes meet, the label the preview stacks on top: the one drawn last by its cover, not by list order', () => {
    // P is declared first and goes under a shape drawn after both labels; Q, declared after P, under one drawn right after
    // it, which misses P's box. So the game draws Q, its shape, then P: P's text is over Q's where their boxes meet.
    const b = frameOf()
    b.span(0, 0, 0, 0)
    b.span(0, 1, 0, 0)
    b.span(0, 9, b.square(40, 0, 50, 10), 4)   // vertices 0-3, over Q's box only
    b.span(0, 8, b.square(0, 40, 30, 50), 4)   // vertices 4-7, over P's box only
    b.text.push(label({ x: 0, y: 0, w: 30, h: 45, node: 0, cover: 4 }), label({ x: 20, y: 0, w: 30, h: 10, node: 1, cover: 0 }))
    const f = b.build()
    expect(pickUnder(f, 25, 5, true)).toEqual({ hit: { element: 0, node: 0 }, label: f.text[0] })
    expect(pickAt(f, 45, 5, true)).toEqual({ element: 0, node: 9 })
    expect(pickAt(f, 15, 42, true)).toEqual({ element: 0, node: 8 })
  })
  it('a fading edge drawn after a label does not cover it (a shadow\'s halo); an opaque shape under the edge still does', () => {
    // The label's T at place 0; then, over it, a triangle whose third vertex is transparent: 5/6 opaque at (5, 5).
    const edge = (opaque: boolean) => {
      const b = frameOf()
      b.text.push(label({ x: 0, y: 0, w: 30, h: 30, node: 0 }))
      b.span(0, 0, 0, 0)
      if (opaque) b.span(0, 1, b.square(0, 0, 30, 30), 4)
      const v = b.vert(0, 0), w = b.vert(30, 0), x = b.vert(0, 30, 0)
      b.tri(v, w, x)
      b.span(0, 2, v, 3)
      return b.build()
    }
    expect(pickAt(edge(false), 5, 5, true)).toEqual({ element: 0, node: 0 })
    expect(pickAt(edge(true), 5, 5, true)).toEqual({ element: 0, node: 1 })
  })
  it('takes the first copy\'s place for a T repeated by an RP: a shape drawn between copies wins over a later copy\'s label', () => {
    // ponytail kept: it errs toward picking the shape.
    const b = frameOf()
    b.text.push(label({ x: 0, y: 0, w: 30, h: 30, node: 0 }))   // the second copy's label
    b.span(0, 0, 0, 0)
    b.span(0, 1, b.square(0, 0, 30, 30), 4)
    b.span(0, 0, 4, 0)
    const f = b.build()
    expect(labelAt(f, f.text[0])).toBe(0)
    expect(pickAt(f, 5, 5, true)).toEqual({ element: 0, node: 1 })
  })
  it('says whether the label won, so a label and a triangle that both name node -1 are told apart', () => {
    const f = scene(false)
    expect(pickUnder(f, 5, 5, true)).toEqual({ hit: { element: 0, node: 1 }, label: null })
    expect(pickUnder(f, 5, 5)).toEqual({ hit: { element: 0, node: 0 }, label: f.text[0] })
    expect(pickUnder(f, 50, 50)).toBeNull()
  })
})

describe('spanBounds', () => {
  it('ignores alpha-0 vertices and joins the node\'s spans', () => {
    const b = frameOf()
    const o0 = b.vert(6, 6, 0), o1 = b.vert(6, 24, 0), i0 = b.vert(10, 10), i1 = b.vert(10, 20)
    b.tri(o0, o1, i1)
    b.tri(o0, i1, i0)
    b.square(10, 10, 20, 20)
    b.span(0, 1, o0, 8)
    b.span(0, 1, b.square(40, 50, 45, 55), 4)   // a second instance (a repeat)
    b.span(0, 2, b.vert(0, 0, 0), 1)            // nothing visible
    b.span(0, 3, 0, 0)                          // drew nothing
    const f = b.build()
    expect(spanBounds(f, 0, 1)).toEqual({ x0: 10, y0: 10, x1: 45, y1: 55 })
    expect(spanBounds(f, 0, 2)).toBeNull()
    expect(spanBounds(f, 0, 3)).toBeNull()
    expect(spanBounds(f, 1, 1)).toBeNull()
  })
})
