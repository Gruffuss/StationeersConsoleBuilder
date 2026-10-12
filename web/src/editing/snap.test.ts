import { describe, expect, it } from 'vitest'
import { dragBox, travelOf } from './layout'
import { snapAxis, snapMove, snapPoint, snapResize, targetsOf, type Line } from './snap'

const o = { threshold: 8, grid: 0 }
const line = (at: number, lo = 0, hi = 30): Line => ({ at, lo, hi })

describe('snapAxis', () => {
  it('takes the nearest line within the threshold, keeping every line at that offset', () => {
    expect(snapAxis([97, 120, 143], [line(100), line(200)], o)).toEqual({ d: 3, hits: [line(100)] })
    expect(snapAxis([97], [line(100, 0, 10), line(100, 50, 60), line(94)], o)).toEqual({ d: 3, hits: [line(100, 0, 10), line(100, 50, 60)] })
  })
  it('else moves the anchor (the first value) to the grid, else to a whole unit', () => {
    expect(snapAxis([97, 130], [line(300)], { threshold: 8, grid: 10 }).d).toBeCloseTo(3, 9)
    expect(snapAxis([97.4, 130], [line(300)], o)).toMatchObject({ hits: [] })
    expect(snapAxis([97.4, 130], [line(300)], o).d).toBeCloseTo(-0.4, 9)
  })
})

describe('snap targets, moves, resizes and points', () => {
  const t = targetsOf([{ x: 0, y: 0, w: 100, h: 30 }], { w: 480, h: 480 })
  it('makes three lines per axis per box, and three for the page', () => {
    expect(t.x.map(l => l.at)).toEqual([0, 50, 100, 0, 240, 480])
    expect(t.y.map(l => l.at)).toEqual([0, 15, 30, 0, 240, 480])
    expect(t.x[2]).toEqual({ at: 100, lo: 0, hi: 30 })
  })
  it('moves a box by its edges and centre; a guide spans both boxes', () => {
    const s = snapMove({ x: 97, y: 50.6, w: 46, h: 20 }, t, o)
    expect(s.dx).toBeCloseTo(3, 9)
    expect(s.dy).toBeCloseTo(0.4, 9)
    expect(s.guides).toHaveLength(1)
    expect(s.guides[0]).toMatchObject({ axis: 'x', at: 100, from: 0 })
    expect(s.guides[0].to).toBeCloseTo(71, 9)
  })
  it('resizes by the dragged edges only; with the ratio, the axis with the smaller offset snaps and leads', () => {
    const lines = { x: [line(100)], y: [line(52, 0, 200)] }
    expect(snapResize({ x: 10, y: 10, w: 85, h: 40 }, 'e', lines, o)).toEqual({ dx: 5, dy: 0, guides: [{ axis: 'x', at: 100, from: 0, to: 50 }] })
    expect(snapResize({ x: 10, y: 10, w: 85, h: 40 }, 'se', lines, o, true)).toMatchObject({ dx: 0, dy: 2, lead: 'y' })
    const w = snapResize({ x: 10, y: 10, w: 85.4, h: 40 }, 'e', { x: [], y: [] }, o)
    expect(w.dx).toBeCloseTo(-0.4, 9)
    expect(w.guides).toEqual([])
  })
  it('snaps a flipped box by the edge the handle drags (signed w)', () => {
    expect(snapResize({ x: 120, y: 10, w: -21, h: 40 }, 'e', { x: [line(100)], y: [] }, o).dx).toBeCloseTo(1, 9)
  })
  it('snaps a point on each axis', () => {
    const s = snapPoint({ x: 98.6, y: 3.2 }, targetsOf([{ x: 100, y: 50, w: 10, h: 10 }], { w: 480, h: 480 }), o)
    expect(s.p).toEqual({ x: 100, y: 0 })
    expect(s.guides.map(g => g.axis)).toEqual(['x', 'y'])
  })
  it('snaps a point on one axis only when asked (an H or V point): the other stays as given and draws no guide', () => {
    const t = targetsOf([{ x: 100, y: 50, w: 10, h: 10 }], { w: 480, h: 480 })
    expect(snapPoint({ x: 98.6, y: 3.2 }, t, o, 'x')).toEqual({ p: { x: 100, y: 3.2 }, guides: [{ axis: 'x', at: 100, from: 3.2, to: 60 }] })
    expect(snapPoint({ x: 98.6, y: 3.2 }, t, o, 'y')).toEqual({ p: { x: 98.6, y: 0 }, guides: [{ axis: 'y', at: 0, from: 0, to: 480 }] })
  })
})

describe('snapAxis edges', () => {
  it('counts a distance equal to the threshold as within', () => {
    expect(snapAxis([92], [line(100)], o)).toEqual({ d: 8, hits: [line(100)] })
    expect(snapAxis([91.99], [line(100)], o).hits).toEqual([])
  })
  it('of two opposite equally near lines takes the positive offset, whatever their order', () => {
    expect(snapAxis([97], [line(94), line(100)], o)).toEqual({ d: 3, hits: [line(100)] })
    expect(snapAxis([97], [line(100), line(94)], o)).toEqual({ d: 3, hits: [line(100)] })
    expect(snapAxis([10, 20], [line(7), line(23)], o)).toEqual({ d: 3, hits: [line(23)] })
    expect(snapAxis([10, 20], [line(23), line(7)], o)).toEqual({ d: 3, hits: [line(23)] })
  })
  it('keeps lines that differ by float32 storage noise, and a line once however many values hit it', () => {
    const a = line(Math.fround(50.1) + Math.fround(50.2)), b = line(Math.fround(100.3))
    expect(snapAxis([98], [a, b], o).hits).toEqual([a, b])
    expect(snapAxis([5, 5, 5], [line(7)], o).hits).toEqual([line(7)])
  })
  it('snaps to no line with a threshold that is not a number, and to whole units with a grid that is not finite', () => {
    expect(snapAxis([95], [line(100)], { threshold: NaN, grid: 0 })).toEqual({ d: 0, hits: [] })
    expect(snapAxis([97.4], [], { threshold: 8, grid: Infinity }).d).toBeCloseTo(-0.4, 9)
    expect(snapAxis([97.4], [], { threshold: 8, grid: NaN }).d).toBeCloseTo(-0.4, 9)
  })
})

describe('targets and guides without duplicates', () => {
  it('gives a zero-width or zero-height box one line on that axis', () => {
    const t = targetsOf([{ x: 5, y: 0, w: 0, h: 10 }, { x: 0, y: 7, w: 10, h: 0 }], { w: 480, h: 480 })
    expect(t.x.map(l => l.at)).toEqual([5, 0, 5, 10, 0, 240, 480])
    expect(t.y.map(l => l.at)).toEqual([0, 5, 10, 7, 0, 240, 480])
    expect(snapMove({ x: 3, y: 100, w: 0, h: 4 }, { x: [line(5)], y: [] }, o).guides).toEqual([{ axis: 'x', at: 5, from: 0, to: 104 }])
  })
  it('normalises a signed box', () => {
    expect(targetsOf([{ x: 30, y: 20, w: -20, h: -10 }], { w: 0, h: 0 }).x[0]).toEqual({ at: 10, lo: 10, hi: 20 })
  })
  it('draws one guide per position, spanning every line there and the box', () => {
    const t = targetsOf([{ x: 100, y: 0, w: 10, h: 10 }, { x: 100, y: 50, w: 20, h: 10 }], { w: 480, h: 480 })
    const s = snapMove({ x: 98, y: 200, w: 30, h: 5 }, t, o)
    expect(s.dx).toBe(2)
    expect(s.guides).toEqual([{ axis: 'x', at: 100, from: 0, to: 205 }])
  })
})

describe('the grid', () => {
  const none = { x: [], y: [] }, g = { threshold: 8, grid: 10 }
  it('moves the left and top edges to it', () => {
    expect(snapMove({ x: 97, y: 52, w: 46, h: 20 }, none, g)).toEqual({ dx: 3, dy: -2, guides: [] })
  })
  it('resizes the dragged edge to it', () => {
    expect(snapResize({ x: 10, y: 10, w: 85.4, h: 40 }, 'e', none, g).dx).toBeCloseTo(4.6, 9)
    expect(snapResize({ x: 10, y: 10, w: 85, h: 43 }, 's', none, g).dy).toBeCloseTo(-3, 9)
  })
  it('puts a point on it', () => {
    expect(snapPoint({ x: 13, y: 26 }, none, g)).toEqual({ p: { x: 10, y: 30 }, guides: [] })
  })
  it('loses to an object line within the threshold', () => {
    expect(snapMove({ x: 97, y: 52, w: 46, h: 20 }, { x: [line(98)], y: [] }, g).dx).toBe(1)
  })
})

describe('snapResize by handle and with the ratio', () => {
  const b = { x: 10, y: 10, w: 85, h: 40 }
  it('snaps the w, n and s edges; guides span the box after the snap', () => {
    expect(snapResize(b, 'w', { x: [line(12)], y: [] }, o)).toEqual({ dx: 2, dy: 0, guides: [{ axis: 'x', at: 12, from: 0, to: 50 }] })
    expect(snapResize(b, 'n', { x: [], y: [line(7)] }, o)).toEqual({ dx: 0, dy: -3, guides: [{ axis: 'y', at: 7, from: 0, to: 95 }] })
    expect(snapResize(b, 's', { x: [], y: [line(52, 0, 30)] }, o)).toEqual({ dx: 0, dy: 2, guides: [{ axis: 'y', at: 52, from: 0, to: 95 }] })
    expect(snapResize(b, 'e', { x: [line(100, 60, 70)], y: [] }, o).guides).toEqual([{ axis: 'x', at: 100, from: 10, to: 70 }])
  })
  it('with the ratio, an axis with a hit leads over an axis with none', () => {
    const x = snapResize({ x: 10, y: 10, w: 85, h: 40.2 }, 'se', { x: [line(100)], y: [] }, o, true)
    expect(x).toMatchObject({ dx: 5, dy: 0, lead: 'x' })
    expect(x.guides).toHaveLength(1)
    expect(x.guides[0]).toMatchObject({ axis: 'x', at: 100, from: 0 })
    expect(x.guides[0].to).toBeCloseTo(10 + 40.2 * 90 / 85, 9)
    const x2 = snapResize({ x: 10, y: 10, w: 85.1, h: 40.3 }, 'se', { x: [line(100)], y: [] }, o, true)
    expect(x2.lead).toBe('x')
    expect(x2.dx).toBeCloseTo(4.9, 9)
    expect(snapResize(b, 'se', { x: [], y: [line(52)] }, o, true)).toMatchObject({ dx: 0, dy: 2, lead: 'y' })
  })
  it('with the ratio and no hit, snaps nothing and gives no lead', () => {
    const s = snapResize({ x: 100, y: 100, w: 30.4, h: 15.1 }, 'se', { x: [], y: [] }, o, true)
    expect(s).toEqual({ dx: 0, dy: 0, guides: [] })
    expect(s).not.toHaveProperty('lead')
  })
  it('with the ratio, the follower keeps the ratio in the guide span (the edge opposite the handle stays)', () => {
    const s = snapResize({ x: 10, y: 10, w: 40, h: 20 }, 'nw', { x: [line(12, 50, 60)], y: [] }, o, true)
    expect(s).toEqual({ dx: 2, dy: 0, lead: 'x', guides: [{ axis: 'x', at: 12, from: 11, to: 60 }] })
  })
  it('gives no lead without the ratio, even on a corner', () => {
    expect(snapResize(b, 'se', { x: [line(100)], y: [line(52)] }, o)).not.toHaveProperty('lead')
  })
})

describe('the resize flow: dragBox, snapResize, travelOf, dragBox', () => {
  const flow = (from: { x: number; y: number; w: number; h: number }, dx: number, dy: number, t: { x: Line[]; y: Line[] }) => {
    const m = { ratio: true, min: 1 }
    const box = dragBox(from, 'se', dx, dy, m)
    const s = snapResize(box, 'se', t, o, true), tr = travelOf(from, box, 'se')
    return dragBox(from, 'se', tr.dx + s.dx, tr.dy + s.dy, { ...m, lead: s.lead })
  }
  it("lands the following axis's edge on its line when that axis snaps", () => {
    expect(flow({ x: 0, y: 0, w: 20, h: 10 }, 30, 0.2, { x: [], y: [line(27, 0, 100)] })).toEqual({ x: 0, y: 0, w: 54, h: 27 })
  })
  it('in free space keeps the axis the pointer leads with (Shift on a corner never stalls)', () => {
    for (let i = 0; i < 400; i++) {
      const px = 10 + i * 0.0731, py = 0.1 + (i % 7) * 0.13
      expect(flow({ x: 100, y: 100, w: 20, h: 10 }, px, py, { x: [], y: [] }).w).toBeCloseTo(20 + px, 9)
    }
  })
})
