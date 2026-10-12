import { describe, expect, it } from 'vitest'
import { align, distribute, dragBox, gapOf, overlaps, travelOf, union } from './layout'

const A = { x: 10, y: 0, w: 10, h: 10 }, B = { x: 30, y: 5, w: 20, h: 10 }
const page = { x: 0, y: 0, w: 480, h: 480 }

describe('align', () => {
  it('aligns two or more boxes to their union, one box to the page', () => {
    expect(align([A, B], 'left', page)).toEqual([{ dx: 0, dy: 0 }, { dx: -20, dy: 0 }])
    expect(align([A, B], 'centre', page)).toEqual([{ dx: 15, dy: 0 }, { dx: -10, dy: 0 }])
    expect(align([A, B], 'right', page)).toEqual([{ dx: 30, dy: 0 }, { dx: 0, dy: 0 }])
    expect(align([A, B], 'top', page)).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: -5 }])
    expect(align([A, B], 'middle', page)).toEqual([{ dx: 0, dy: 2.5 }, { dx: 0, dy: -2.5 }])
    expect(align([A, B], 'bottom', page)).toEqual([{ dx: 0, dy: 5 }, { dx: 0, dy: 0 }])
    expect(align([{ x: 10, y: 10, w: 20, h: 20 }], 'centre', page)).toEqual([{ dx: 220, dy: 0 }])
  })
})

describe('distribute and gap', () => {
  const box = (x: number, w = 10) => ({ x, y: 0, w, h: 10 })
  it('spreads three or more by centre with equal gaps, outer two fixed, whole gaps when the free space is whole', () => {
    expect(distribute([box(0), box(13), box(50)], 'x')).toEqual([{ dx: 0, dy: 0 }, { dx: 12, dy: 0 }, { dx: 0, dy: 0 }])
    expect(distribute([box(51), box(0), box(13)], 'x')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 13, dy: 0 }])
    expect(distribute([box(0), box(13), box(50.5)], 'x')[1].dx).toBeCloseTo(12.25, 9)
    expect(distribute([box(0), box(13)], 'x')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }])
  })
  it('sets an exact gap from the first box by start; a negative gap overlaps', () => {
    expect(gapOf([box(0), box(30), box(13, 5)], 'x', 4)).toEqual([{ dx: 0, dy: 0 }, { dx: -7, dy: 0 }, { dx: 1, dy: 0 }])
    expect(gapOf([box(0), box(30)], 'x', -2)).toEqual([{ dx: 0, dy: 0 }, { dx: -22, dy: 0 }])
  })
  it('unions and overlaps (touching is not overlapping)', () => {
    expect(union([A, B])).toEqual({ x: 10, y: 0, w: 40, h: 15 })
    expect(overlaps(A, { x: 19, y: 9, w: 5, h: 5 })).toBe(true)
    expect(overlaps(A, { x: 20, y: 0, w: 5, h: 5 })).toBe(false)
  })
})

describe('dragBox', () => {
  const b = { x: 10, y: 10, w: 20, h: 10 }
  it('moves the dragged sides; the opposite side stays', () => {
    expect(dragBox(b, 'e', 5, 99)).toEqual({ x: 10, y: 10, w: 25, h: 10 })
    expect(dragBox(b, 'w', 5, 0)).toEqual({ x: 15, y: 10, w: 15, h: 10 })
    expect(dragBox(b, 'se', 4, 2)).toEqual({ x: 10, y: 10, w: 24, h: 12 })
  })
  it('Alt keeps the centre; Shift keeps the ratio, a side about the other axis\'s middle; lead picks the axis', () => {
    expect(dragBox(b, 'e', 5, 0, { centre: true })).toEqual({ x: 5, y: 10, w: 30, h: 10 })
    expect(dragBox(b, 'se', 10, 0, { ratio: true })).toEqual({ x: 10, y: 10, w: 30, h: 15 })
    expect(dragBox(b, 'e', 10, 0, { ratio: true })).toEqual({ x: 10, y: 7.5, w: 30, h: 15 })
    expect(dragBox(b, 'se', 10, 0, { ratio: true, lead: 'y' })).toEqual({ x: 10, y: 10, w: 20, h: 10 })
  })
  it('flips past the opposite side (signed), and floors the size', () => {
    expect(dragBox(b, 'w', 30, 0)).toEqual({ x: 40, y: 10, w: -10, h: 10 })
    expect(dragBox(b, 'e', -19.5, 0, { min: 1 })).toEqual({ x: 10, y: 10, w: 1, h: 10 })
  })
})

describe('align, distribute and gap: the rest', () => {
  it('aligns one box to the page in every mode', () => {
    const one = [{ x: 10, y: 10, w: 20, h: 20 }]
    expect(['left', 'centre', 'right', 'top', 'middle', 'bottom'].map(m => align(one, m as 'left', page)[0])).toEqual([
      { dx: -10, dy: 0 }, { dx: 220, dy: 0 }, { dx: 450, dy: 0 }, { dx: 0, dy: -10 }, { dx: 0, dy: 220 }, { dx: 0, dy: 450 }])
  })
  it('takes a signed (flipped) box as its extent', () => {
    const flipped = { x: 50, y: 10, w: -20, h: -10 }
    expect(union([flipped, { x: 0, y: 0, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 50, h: 10 })
    expect(align([flipped, { x: 0, y: 0, w: 10, h: 10 }], 'left', page)).toEqual([{ dx: -30, dy: 0 }, { dx: 0, dy: 0 }])
    expect(overlaps(flipped, { x: 45, y: 5, w: 1, h: 1 })).toBe(true)
    expect(gapOf([{ x: 10, y: 0, w: -10, h: 10 }, { x: 30, y: 0, w: 10, h: 10 }], 'x', 5)).toEqual([{ dx: 0, dy: 0 }, { dx: -15, dy: 0 }])
  })
  it('distributes and gaps on y', () => {
    const box = (y: number, h = 10) => ({ x: 0, y, w: 10, h })
    expect(distribute([box(0), box(13), box(50)], 'y')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 12 }, { dx: 0, dy: 0 }])
    expect(gapOf([box(0), box(30), box(13, 5)], 'y', 4)).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: -7 }, { dx: 0, dy: 1 }])
  })
  it('counts a free space as whole within float32 storage noise', () => {
    const w = Math.fround(10.3), xs = [0, 15, 33, Math.fround(61.9)]
    const free = xs[3] + w - 4 * w
    expect(Math.abs(free - 31)).toBeGreaterThan(1e-9)
    const d = distribute(xs.map(x => ({ x, y: 0, w, h: 10 })), 'x')
    const at = xs.map((x, i) => x + d[i].dx)
    expect([at[1] - at[0] - w, at[2] - at[1] - w, at[3] - at[2] - w].map(g => Math.round(g * 1e4) / 1e4)).toEqual([11, 10, 10])
  })
})

describe('dragBox: the rest', () => {
  const b = { x: 10, y: 10, w: 20, h: 10 }
  it('drags the n, s and the other corners', () => {
    expect(dragBox(b, 'n', 99, 3)).toEqual({ x: 10, y: 13, w: 20, h: 7 })
    expect(dragBox(b, 's', 99, 3)).toEqual({ x: 10, y: 10, w: 20, h: 13 })
    expect(dragBox(b, 'nw', 2, 3)).toEqual({ x: 12, y: 13, w: 18, h: 7 })
    expect(dragBox(b, 'ne', 2, 3)).toEqual({ x: 10, y: 13, w: 22, h: 7 })
    expect(dragBox(b, 'sw', 2, 3)).toEqual({ x: 12, y: 10, w: 18, h: 13 })
  })
  it('Alt with Shift keeps both the centre and the ratio', () => {
    expect(dragBox(b, 'se', 5, 0, { ratio: true, centre: true })).toEqual({ x: 5, y: 7.5, w: 30, h: 15 })
  })
  it('with Shift, the axis that changed more relative to its size leads, shrinking too', () => {
    expect(dragBox(b, 'se', -10, 0, { ratio: true })).toEqual({ x: 10, y: 10, w: 10, h: 5 })
    expect(dragBox(b, 'se', -10, -1, { ratio: true })).toEqual({ x: 10, y: 10, w: 10, h: 5 })
    expect(dragBox(b, 'se', 1, 5, { ratio: true })).toEqual({ x: 10, y: 10, w: 30, h: 15 })
  })
  it('flips with the ratio', () => {
    expect(dragBox(b, 'se', -30, -15, { ratio: true })).toEqual({ x: 10, y: 10, w: -10, h: -5 })
    expect(dragBox(b, 'se', -30, 0, { ratio: true })).toEqual({ x: 10, y: 10, w: -10, h: 5 })
  })
  it('with Shift, floors the lead so that the follower is at least min too (the ratio holds)', () => {
    expect(dragBox(b, 'se', -19.5, -9.75, { ratio: true, min: 1 })).toEqual({ x: 10, y: 10, w: 2, h: 1 })
    expect(dragBox({ x: 0, y: 0, w: 100, h: 10 }, 'e', -95, 0, { ratio: true, min: 1 })).toEqual({ x: 0, y: 4.5, w: 10, h: 1 })
    expect(dragBox(b, 'n', 0, 9.5, { min: 1 })).toEqual({ x: 10, y: 19, w: 20, h: 1 })
  })
  it('ignores lead on a side handle (the dragged axis leads)', () => {
    expect(dragBox(b, 'e', 10, 0, { ratio: true, lead: 'y' })).toEqual({ x: 10, y: 7.5, w: 30, h: 15 })
  })
  it('with stop, a corner dragged far past one side leads with that side, chosen before the stop (no lead given)', () => {
    // x is dragged 1000 past the west edge, y 150 out: x leads and stops at the minimum. Stopped first, x would have
    // changed by 1 (its size) and y by 1.5, so y would lead and grow the box to 250 x 250.
    const sq = { x: 100, y: 100, w: 100, h: 100 }
    expect(dragBox(sq, 'se', -1000, 150, { ratio: true, stop: true, min: 36 })).toEqual({ x: 100, y: 100, w: 36, h: 36 })
  })
})

describe('travelOf', () => {
  const b = { x: 10, y: 10, w: 20, h: 10 }
  it('gives back the travel of the dragged edges, with Alt, the ratio and a flip', () => {
    expect(travelOf(b, dragBox(b, 'w', 4, 9, { centre: true }), 'w')).toEqual({ dx: 4, dy: 0 })
    expect(travelOf(b, dragBox(b, 'se', 10, 0, { ratio: true }), 'se')).toEqual({ dx: 10, dy: 5 })
    expect(travelOf(b, dragBox(b, 'nw', 30, 2), 'nw')).toEqual({ dx: 30, dy: 2 })
    expect(travelOf(b, dragBox(b, 'n', 3, 2), 'n')).toEqual({ dx: 0, dy: 2 })
  })
})
