import { describe, expect, it } from 'vitest'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt } from '../model/store'
import { node } from '../model/testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget, widgetOf } from '../widgets/core'
import { instance } from '../widgets/testing'
import { worldBox } from './bounds'
import { reparent } from './reparent'

const scene = (root: SrcNode[]): Scene => ({ header: { w: 460, h: 460 }, defs: [], root })
const R = () => node('R', { id: 'r', x: 40, y: 30, w: 20, h: 10 })
const frames: SrcNode['attrs'][] = [{ t: [10, 0], s: [2, 2] }, { r: 30 }]
const moved = (s: Scene, from: number[][], to: { parent: number[]; index: number }) => {
  const result = reparent(s, from, to, vanillaPlus)
  expect(typeof result).not.toBe('string')
  if (typeof result === 'string') throw new Error(result)
  return result
}
const placement = (before: Scene, from: number[], after: Scene, path: number[]) => {
  const a = worldBox(before, from)!, b = worldBox(after, path)!
  expect(a).not.toBeNull()
  expect(b).not.toBeNull()
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(b[k]).toBeCloseTo(a[k], 3)
}

describe('reparent keeps placement', () => {
  it('reparents a widget through translations by params, without accumulating wrappers', () => {
    const w = putWidget(scene([]), instance('panel', { x: 20, y: 30, w: 100, h: 80 }), vanillaPlus).root[0]
    const base = scene([node('G', { t: [10, 10] }, [w]), node('G', { t: [100, 0] }, [])])
    const one = moved(base, [[0, 0]], { parent: [1], index: 0 })
    const ref = widgetOf(nodeAt(one.scene.root, one.paths[0])!, vanillaPlus)
    expect(ref?.params).toMatchObject({ x: -70, y: 40 })
    placement(base, [0, 0], one.scene, one.paths[0])
    const two = moved(one.scene, one.paths, { parent: [], index: 2 })
    expect(widgetOf(nodeAt(two.scene.root, two.paths[0])!, vanillaPlus)?.params).toMatchObject({ x: 30, y: 40 })
    expect(two.scene.root[1].c).toEqual([])
    expect(two.scene.root[1].c?.some(n => n.attrs.m)).toBe(false)
  })
  it('removes an empty transform wrapper when moving its widget out', () => {
    const w = putWidget(scene([]), instance('panel'), vanillaPlus).root[0]
    const base = scene([node('G', {}, [node('G', { m: [1, 0, 0, 1, 10, 20] }, [w])])])
    const out = moved(base, [[0, 0, 0]], { parent: [], index: 1 })
    expect(out.scene.root[0].c).toEqual([])
    expect(widgetOf(nodeAt(out.scene.root, out.paths[0])!, vanillaPlus)).not.toBeNull()
  })
  it('moves through a translation without a wrapper', () => {
    const s = scene([R(), node('G', { t: [10, 5] }, [])])
    const out = moved(s, [[0]], { parent: [1], index: 0 })
    expect(out.paths).toEqual([[0, 0]])
    expect(nodeAt(out.scene.root, out.paths[0])?.attrs).toMatchObject({ x: 30, y: 25 })
    placement(s, [0], out.scene, out.paths[0])
    expect(s.root[0].attrs.x).toBe(40)
  })
  it.each(frames)('wraps in G m for a different linear frame: %j', attrs => {
    const s = scene([R(), node('G', attrs, [])])
    const out = moved(s, [[0]], { parent: [1], index: 0 })
    const wrapper = nodeAt(out.scene.root, out.paths[0])!
    expect(wrapper.op).toBe('G')
    expect(wrapper.attrs.m).toHaveLength(6)
    expect(wrapper.c?.[0]).toBe(s.root[0])
    placement(s, [0], out.scene, out.paths[0])
  })
  it('moves out through a nested transformed chain and selects the wrapper', () => {
    const s = scene([node('G', { t: [10, 0], r: 30 }, [node('G', { s: [2, 2] }, [R()])]), node('R', { id: 'other' })])
    const out = moved(s, [[0, 0, 0]], { parent: [], index: 1 })
    expect(out.paths).toEqual([[1]])
    placement(s, [0, 0, 0], out.scene, [1])
  })
  it('keeps a small but nonsingular matrix difference representable as float32', () => {
    const s = scene([node('G', { m: [1, 1, 1, 1.000001, 0, 0] }, [R()]), node('G', {}, [])])
    const out = moved(s, [[0, 0]], { parent: [1], index: 0 })
    placement(s, [0, 0], out.scene, out.paths[0])
  })
  it('refuses a parent-frame ratio that underflows float32 instead of writing a singular wrapper', () => {
    const s = scene([node('G', { s: [1e-38, 1e-38] }, [R()]), node('G', { s: [1e38, 1e38] }, [])])
    expect(reparent(s, [[0, 0]], { parent: [1], index: 0 })).toMatch(/float32|singular/)
  })
  it('reorders siblings without rounding coordinates or changing nodes', () => {
    const a = node('R', { x: 1.234567 }), b = node('R', { id: 'b' }), c = node('R', { id: 'c' })
    const s = scene([a, b, c]), out = moved(s, [[0]], { parent: [], index: 2 })
    expect(out.scene.root).toEqual([b, a, c])
    expect(out.scene.root[1]).toBe(a)
    expect(out.paths).toEqual([[1]])
  })
  it('remaps the destination after removing nodes before it, preserving their stacking order', () => {
    const a = R(), b = node('R', { id: 'b', x: 100, y: 100, w: 10, h: 10 })
    const s = scene([a, b, node('G', { t: [10, 0] }, [])])
    const out = moved(s, [[1], [0]], { parent: [2], index: 0 })
    expect(out.paths).toEqual([[0, 1], [0, 0]])
    expect(out.scene.root[0].c?.map(n => n.attrs.id)).toEqual(['r', 'b'])
    placement(s, [0], out.scene, [0, 0])
    placement(s, [1], out.scene, [0, 1])
  })
  it('refuses a cycle and does not remove the group', () => {
    const s = scene([node('G', {}, [node('G', {}, [R()])])])
    expect(reparent(s, [[0]], { parent: [0, 0], index: 0 })).toMatch(/cycle/i)
    expect(s.root).toHaveLength(1)
  })
  it('refuses missing paths and invalid insertion indices', () => {
    const s = scene([R()])
    expect(reparent(s, [[99]], { parent: [], index: 0 })).toMatch(/missing/i)
    expect(reparent(s, [[0]], { parent: [99], index: 0 })).toMatch(/missing/i)
    expect(reparent(s, [[0]], { parent: [], index: 99 })).toMatch(/index/i)
  })
  it('refuses singular and expression chains by name', () => {
    const attributes: SrcNode['attrs'][] = [{ s: [0, 1] }, { t: ['$x', 0] }]
    for (const attrs of attributes) {
      const s = scene([R(), node('G', attrs, [R()])])
      expect(reparent(s, [[0]], { parent: [1], index: 0 })).toMatch(/singular|literal|expression/i)
      expect(reparent(s, [[1, 0]], { parent: [], index: 0 })).toMatch(/singular|literal|expression/i)
    }
  })
  it('refuses a translation that would overwrite an expression, without partial writes', () => {
    const s = scene([node('R', { x: '$x', y: 20 }), node('G', { t: [10, 10] }, [])])
    expect(reparent(s, [[0]], { parent: [1], index: 0 })).toMatch(/expression/)
    expect(s.root[0].attrs).toEqual({ x: '$x', y: 20 })
  })
  it('keeps a widget when moved into a group or reordered at the root', () => {
    const s = putWidget(scene([node('G', {}, [])]), { uid: 'pan1', type: 'panel', params: {} }, vanillaPlus)
    expect(moved(s, [[1]], { parent: [0], index: 0 }).scene.root[0].c![0]).toBe(s.root[1])
    const out = moved(s, [[1]], { parent: [], index: 0 })
    expect(out.scene.root[0]).toBe(s.root[1])
  })
  it('refuses moving into or out of a widget subtree', () => {
    const s = putWidget(scene([R()]), { uid: 'pan1', type: 'panel', params: {} }, vanillaPlus)
    expect(reparent(s, [[0]], { parent: [1], index: 0 })).toMatch(/widget/i)
    expect(reparent(s, [[1, 0]], { parent: [], index: 0 })).toMatch(/widget/i)
  })
})
