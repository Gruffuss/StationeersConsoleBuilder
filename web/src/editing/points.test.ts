import { describe, expect, it } from 'vitest'
import { node } from '../model/testing'
import { movePoint, noPoints, pointAt, pointsOf, addPoint, editPoint, segmentAt } from './points'

describe('points', () => {
  it('lists an L, Y or SP\'s pairs and a path\'s points; none for other ops or a p that is not all numbers', () => {
    expect(pointsOf(node('L', { p: [0, 0, 10, 5] }))).toEqual([{ x: 0, y: 0 }, { x: 10, y: 5 }])
    expect(pointsOf(node('P', { d: 'M0 0 H8' }))).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0, axis: 'x' }])
    expect(pointsOf(node('Y', { p: [0, '$a'] }))).toBeNull()
    expect(pointsOf(node('R'))).toBeNull()
  })
  it('moves one point as M1 writes numbers', () => {
    expect(movePoint(node('SP', { p: [0, 0, 10, 5, 20, 0] }), 1, 12.34567, 6).node.attrs.p).toEqual([0, 0, Math.fround(12.346), 6, 20, 0])
    expect(movePoint(node('P', { d: 'M0 0 l10 0 l0 10' }), 1, 20, 0).node.attrs.d).toBe('M0 0 l20 0 l-10 10')
    expect(movePoint(node('L', { p: [0, 0] }), 4, 1, 1).locked).toBe('no such point')
  })
  it('keeps a coordinate that rounds as the one there, gives the node itself when nothing changes, and writes at the key as written', () => {
    const L = node('L', { p: [0, 0, 10.12345, 5] }), P = node('P', { d: 'M0 0 L10.12345 5' })
    expect(movePoint(L, 1, 10.1234, 5).node).toBe(L)
    expect(movePoint(P, 1, 10.1234, 5).node).toBe(P)
    expect(movePoint(P, 1, 10.1234, 6).node.attrs.d).toBe('M0 0 L10.12345 6')
    expect(movePoint(node('Y', { P: [0, 0, 1, 1] }), 1, 2, 2).node.attrs).toEqual({ P: [0, 0, 2, 2] })
  })
  it('refuses a value past float32 and a point of another op', () => {
    expect(movePoint(node('L', { p: [0, 0, 1, 1] }), 0, 1e39, 0).locked).toBe('the value left float32')
    expect(movePoint(node('P', { d: 'M0 0 L1 1' }), 0, 1e39, 0).locked).toBe('the value left float32')
    expect(movePoint(node('R', { p: [0, 0] }), 0, 1, 1).locked).toBe('no such point')
  })
  it('finds the nearest point within 6 CSS px through the node\'s chain and the zoom', () => {
    const scene = { header: { w: 460, h: 460 }, defs: [], root: [node('G', { t: [100, 0], s: [2, 2] }, [node('L', { p: [0, 0, 3, 0, 10, 0] })])] }
    const rect = { w: 460, h: 460 }
    expect(pointAt(scene, [0, 0], rect, 2, { x: 122, y: 0 })).toBe(2)     // 2 surface px at zoom 2: 4 CSS px
    expect(pointAt(scene, [0, 0], rect, 2, { x: 124, y: 0 })).toBeNull()  // 8 CSS px
    expect(pointAt(scene, [0, 0], rect, 1, { x: 104, y: 0 })).toBe(1)     // 4 from point 0, 2 from point 1
    expect(pointAt(scene, [0], rect, 1, { x: 100, y: 0 })).toBeNull()     // a G has no points
  })
  it('takes the nearest point in reach, wherever it is in the list; of two as near, the first', () => {
    const rect = { w: 460, h: 460 }, scene = { header: { w: 460, h: 460 }, defs: [], root: [node('L', { p: [100, 0, 104, 0] })] }
    expect(pointAt(scene, [0], rect, 1, { x: 101, y: 0 })).toBe(0)   // 1 px from point 0, 3 from point 1
    expect(pointAt(scene, [0], rect, 1, { x: 103, y: 0 })).toBe(1)   // 3 px from point 0, 1 from point 1
    // A closed outline written with its first point again last: the first is the one a press takes.
    const closed = { ...scene, root: [node('Y', { p: [0, 0, 10, 0, 10, 10, 0, 0] })] }
    expect(pointAt(closed, [0], rect, 1, { x: 0, y: 0 })).toBe(0)
  })
  it('writes a rewritten relative number of a path at 3 decimals when that keeps the points where they are', () => {
    expect(movePoint(node('P', { d: 'M0 0 l10 0 l0 10' }), 1, 12.34567, 0).node.attrs.d).toBe('M0 0 l12.346 0 l-2.346 10')
    expect(movePoint(node('P', { d: 'M0 0 l40 0 q20 20 40 0 h40' }), 1, 60.4, 0.1).node.attrs.d).toBe('M0 0 l60.4 0.1 q-0.4 19.9 19.6 -0.1 h40')
  })
  it('checks a rewritten relative y, a v and an arc end\'s y against the cursor\'s y', () => {
    // Checked against the cursor's x (0), each would be written exactly: -2.3459997, 7.6540003.
    const y = (d: string) => movePoint(node('P', { d }), 1, 0, 12.34567).node.attrs.d
    expect(y('M0 0 l0 10 l10 0')).toBe('M0 0 l0 12.346 l10 -2.346')
    expect(y('M0 0 l0 10 v10')).toBe('M0 0 l0 12.346 v7.654')
    expect(y('M0 0 l0 10 a5 5 0 0 1 10 10')).toBe('M0 0 l0 12.346 a5 5 0 0 1 10 7.654')
  })
  it('says why a line, polygon, curve or path has no points to edit', () => {
    expect(noPoints(node('Y', { p: [10, 10, 100, '=t'] }))).toBe('p is not a list of numbers')
    expect(noPoints(node('P', { d: 'M0 0 Q' }))).toBe('d is not a valid path')
    expect(noPoints(node('SP'))).toBe('p is not a list of numbers')
  })
})
describe('point insertion and deletion', () => {
  it('hits and inserts on the sampled Catmull-Rom curve, including a closed spline span', () => {
    const n = node('SP', { p: [0, 0, 50, 50, 100, 0] }), point = { x: 21.875, y: 28.125 }
    const scene = { header: { w: 460, h: 460 }, defs: [], root: [n] }
    const hit = segmentAt(scene, [0], { w: 460, h: 460 }, 2, point)
    expect(hit?.segment).toBe(0); expect(hit?.t).toBeCloseTo(0.5, 4)
    expect(addPoint(n, 0, 0.5).node.attrs.p).toEqual([0, 0, 21.875, 28.125, 50, 50, 100, 0])
    const closed = node('SP', { p: [0, 0, 50, 50, 100, 0], close: 1 })
    expect(addPoint(closed, 2, 0.5).node.attrs.p).toEqual([0, 0, 50, 50, 100, 0, 50, -6.25])
  })
  it('respects the mod polyline when an SP uses one or two samples per span', () => {
    const n = node('SP', { p: [0, 0, 50, 50, 100, 0], seg: 1 })
    expect(addPoint(n, 0, 0.5).node.attrs.p).toEqual([0, 0, 25, 25, 50, 50, 100, 0])
    expect(addPoint({ ...n, attrs: { ...n.attrs, seg: 2 } }, 0, 0.5).node.attrs.p).toEqual([0, 0, 21.875, 28.125, 50, 50, 100, 0])
  })
  it('adds a point to literal L/SP lists and P segments, keeping spelling and comments', () => {
    expect(addPoint(node('L', { P: [0, 0, 10, 0] }), 0, 0.5).node.attrs).toEqual({ P: [0, 0, 5, 0, 10, 0] })
    expect(addPoint(node('SP', { p: [0, 0, 10, 0] }), 0, 0.5).node.attrs.p).toEqual([0, 0, 5, 0, 10, 0])
    const n = { ...node('P', { D: 'M0 0 L10 0' }), comments: ['keep'] }
    expect(addPoint(n, 1, 0.5).node).toEqual({ ...n, attrs: { D: 'M0 0 L5 0 L10 0' } })
  })
  it('deletes anchors or the empty node, converts P anchors and protects bound values and control handles', () => {
    expect(editPoint(node('L', { p: [0, 0, 5, 5, 10, 0] }), 1, 'delete').node?.attrs.p).toEqual([0, 0, 10, 0])
    expect(editPoint(node('L', { p: [0, 0, 10, 0] }), 1, 'delete').node).toBeNull()
    expect(editPoint(node('P', { d: 'M0 0 L5 5 L10 0' }), 1, 'smooth').node?.attrs.d).toContain('C')
    for (const n of [node('P', { d: '$path' }), node('L', { p: [0, 0, '=t', 0] })]) {
      expect(addPoint(n, 0, 0.5).node).toBe(n); expect(editPoint(n, 0, 'delete').node).toBe(n)
    }
    const n = node('P', { d: 'M0 0 C0 10 10 10 10 0' })
    expect(editPoint(n, 1, 'delete').node).toBe(n)
  })
  it('hits segments through the group transform at CSS reach, and finds a cubic parameter', () => {
    const s = { header: { w: 460, h: 460 }, defs: [], root: [node('G', { t: [50, 0], s: [2, 2] }, [node('P', { d: 'M0 0 C0 10 10 10 10 0' })])] }
    const hit = segmentAt(s, [0, 0], { w: 460, h: 460 }, 2, { x: 60, y: 15 })
    expect(hit?.segment).toBe(1); expect(hit?.t).toBeCloseTo(0.5, 4)
    expect(segmentAt(s, [0, 0], { w: 460, h: 460 }, 2, { x: 60, y: 19 })).toBeNull()
  })
})
