import { describe, expect, it } from 'vitest'
import type { Box } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { allBoxes, boundsOf, IDENTITY, nodeBox, rootBoxes, similar, subtreeBox, worldBox, worldOf } from './bounds'

const scene = (root: SrcNode[]): Scene => ({ header: { w: 480, h: 480, fit: 'contain' }, defs: [], root })
const near = (b: Box | null, e: Box) => { for (const k of ['x', 'y', 'w', 'h'] as const) expect(b![k]).toBeCloseTo(e[k], 9) }
const R = (x: number, more: Record<string, number> = {}) => node('R', { x, y: 0, w: 10, h: 5, ...more })

describe('bounds', () => {
  it('maps a node to design units through its groups, whatever the page px', () => {
    const s = scene([node('G', { t: [100, 50], s: [2, 2] }, [R(0)])])
    expect(worldOf(s, [0, 0])!.map(v => v + 0)).toEqual([2, 0, 0, 2, 100, 50])
    expect(worldBox(s, [0, 0])).toEqual({ x: 100, y: 50, w: 20, h: 10 })
    expect(worldBox(s, [0])).toEqual({ x: 100, y: 50, w: 20, h: 10 })
  })
  it('boxes a turned ellipse exactly, and a group by its visible leaves', () => {
    near(worldBox(scene([node('G', { r: 90 }, [node('C', { cx: 0, cy: 0, rx: 10, ry: 5 })])]), [0, 0]), { x: -5, y: -10, w: 10, h: 20 })
    expect(subtreeBox([R(0), R(50, { v: 0 }), node('G', { t: [5, 5] }, [R(20)])], [1, 0, 0, 1, 0, 0])).toEqual({ x: 0, y: 0, w: 35, h: 10 })
  })
  it('lists snap targets without the moving set and what is under it; boxes root nodes for the marquee', () => {
    const g = node('G', {}, [R(100)]), s = scene([R(0), g, node('USE', { ref: 's' }), R(9, { v: 0 })])
    expect(allBoxes(s, new Set([g]))).toEqual([{ x: 0, y: 0, w: 10, h: 5 }])
    expect(rootBoxes(s)).toEqual([{ x: 0, y: 0, w: 10, h: 5 }, { x: 100, y: 0, w: 10, h: 5 }, null, null])
  })
  it('lists a root group\'s own box as a target, its centre no leaf\'s; a widget root\'s from `own`; not one the moving set is in', () => {
    const g = node('G', {}, [R(0), R(30)]), s = scene([g, node('G', {}, [R(100)])])
    const centres = (bs: { x: number; w: number }[]) => bs.map(b => b.x + b.w / 2).sort((a, b) => a - b)
    expect(centres(allBoxes(s, new Set()))).toEqual([5, 20, 35, 105, 105])
    expect(centres(allBoxes(s, new Set([g.c![0]])))).toEqual([35, 105, 105])
    expect(allBoxes(s, new Set(), k => k ? { x: 99, y: 0, w: 12, h: 5 } : null).at(-1)).toEqual({ x: 99, y: 0, w: 12, h: 5 })
  })
  it('composes nested groups outer first: a stretched, moved G around a turned, moved G', () => {
    // Inner r=90 then t: R's corners go to x 0..5, y 5..15; outer s=[2, 1] then t=[10, 0]: x 10..20, y 5..15.
    const outer = node('G', { t: [10, 0], s: [2, 1] }, [node('G', { r: 90, t: [5, 5] }, [R(0)])])
    const want = { x: 10, y: 5, w: 10, h: 10 }
    near(subtreeBox([outer], IDENTITY), want)
    const all = allBoxes(scene([outer]), new Set())
    expect(all).toHaveLength(2)   // the leaf, and the group's own box (here the same)
    near(all[0], want)
    near(all[1], want)
    near(worldBox(scene([outer]), [0, 0, 0]), want)
  })
  it('hides at v 0.5 and below, not above; a singular group adds nothing; an empty block is a leaf', () => {
    expect(subtreeBox([R(0), R(50, { v: 0.5 }), R(30, { v: 0.6 })], IDENTITY)).toEqual({ x: 0, y: 0, w: 40, h: 5 })
    expect(subtreeBox([node('G', { s: [0, 1] }, [R(0)]), R(20)], IDENTITY)).toEqual({ x: 20, y: 0, w: 10, h: 5 })
    const empty = node('R', { x: 0, y: 0, w: 10, h: 5 }, [])
    expect(subtreeBox([node('G', {}, [empty])], IDENTITY)).toEqual({ x: 0, y: 0, w: 10, h: 5 })
    expect(nodeBox(empty, IDENTITY)).toEqual({ x: 0, y: 0, w: 10, h: 5 })
  })
  it('boxes an SC by its viewport and cuts what it holds to it: a group around it is no taller', () => {
    const sc = node('SC', { x: 0, y: 0, w: 100, h: 20 }, [R(10), node('R', { x: 50, y: 10, w: 10, h: 480 }), node('R', { x: 0, y: 200, w: 5, h: 5 })])
    expect(subtreeBox([node('G', {}, [sc])], IDENTITY)).toEqual({ x: 0, y: 0, w: 100, h: 20 })
    expect(nodeBox(sc, IDENTITY)).toEqual({ x: 0, y: 0, w: 100, h: 20 })
    const all = allBoxes(scene([sc]), new Set())
    expect(all).toHaveLength(3)   // the row below the viewport shows nothing; an SC is a leaf, not a block of its own
    expect(all).toEqual(expect.arrayContaining([{ x: 0, y: 0, w: 100, h: 20 }, { x: 10, y: 0, w: 10, h: 5 }, { x: 50, y: 10, w: 10, h: 10 }]))
  })
  it('boxes an ellipse exactly under a turn with an uneven scale, and a path by its extremes along the turned axes', () => {
    // R(30)·S(2, 1): half-extents hypot(2 cos 30 · 10, sin 30 · 5) = 17.5 and hypot(2 sin 30 · 10, cos 30 · 5) = √118.75.
    const hy = Math.sqrt(118.75)
    near(worldBox(scene([node('G', { r: 30, s: [2, 1] }, [node('C', { cx: 0, cy: 0, rx: 10, ry: 5 })])]), [0, 0]), { x: -17.5, y: -hy, w: 35, h: 2 * hy })
    // The upper half of the circle about (10, 0), radius 10, turned 30°: its centre goes to (5√3, 5); the turned x and y
    // extremes (greatest x, least y) fall between the arc's samples.
    const c30 = Math.cos(Math.PI / 6)
    near(worldBox(scene([node('G', { r: 30 }, [node('P', { d: 'M0 0 A10 10 0 0 1 20 0' })])]), [0, 0]), { x: 0, y: -5, w: 10 + 10 * c30, h: 15 })
    // A cubic turned 30° (dense sampling: x from -1.50321, y up to 9.50962; local samples alone give -1.48594 and 9.50721).
    near(worldBox(scene([node('G', { r: 30 }, [node('P', { d: 'M0 0 C0 10 10 10 10 0' })])]), [0, 0]),
      { x: -1.5032063144107406, y: 0, w: 10.163460352255129, h: 9.509618943233143 })
  })
  it('boxes one node through a matrix: boundsOf an outline, nodeBox a block by its leaves', () => {
    expect(boundsOf(node('L', { p: [0, 0, 10, 0] }), [2, 0, 0, 2, 1, 1])).toEqual({ x: 1, y: 1, w: 20, h: 0 })
    expect(boundsOf(node('USE', { ref: 's' }), IDENTITY)).toBeNull()
    expect(nodeBox(node('G', { t: [5, 0] }, [R(0)]), [2, 0, 0, 2, 0, 0])).toEqual({ x: 10, y: 0, w: 20, h: 10 })
    expect(nodeBox(node('G', { v: 0 }, [R(0)]), IDENTITY)).toBeNull()
  })
  it('tells a similarity (turn, uniform scale, mirror) from a stretch or a shear', () => {
    expect(similar([1, 0, 0, 1, 5, 5])).toBe(true)
    expect(similar([0, 2, -2, 0, 0, 0])).toBe(true)
    expect(similar([-1, 0, 0, 1, 0, 0])).toBe(true)
    expect(similar([2, 0, 0, 1, 0, 0])).toBe(false)
    expect(similar([1, 0, 0.4, 1, 0, 0])).toBe(false)
  })
})
