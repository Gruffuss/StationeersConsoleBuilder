import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
beforeEach(() => { let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 1_000_000) })
afterEach(() => vi.restoreAllMocks())
import type { Scene, SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { indexedReads } from '../../test/work'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { putWidget, widgetOf } from '../widgets/core'
import { instance } from '../widgets/testing'
import { allBoxes, rootBoxes, worldBox } from './bounds'
import { handleFrame } from './select'
import { moveUnits, unitsOf } from './units'

const R = (x: number | string, more: Partial<SrcNode> = {}) => ({ ...node('R', { x, y: 0, w: 10, h: 10 }), ...more })
const scene = (root: SrcNode[]): Scene => ({ header: { w: 480, h: 480 }, defs: [], root })
const at = (...path: number[]) => ({ pageId: 'p1', path })

describe('units', () => {
  it('includes a held icon sticking out of a G unit when natives are supplied', () => {
    const s = scene([node('G', { id: 'card' }, [R(0)])]), refs = [{ type: 'icon', uid: 'ico1', group: 'card', params: { x: 8, y: 2, w: 10, h: 10, kind: 'gas', name: 'Oxygen' } }]
    expect(unitsOf(s, [at(0)], t, refs)[0].box).toEqual({ x: 0, y: 0, w: 18, h: 12 })
    expect(unitsOf(s, [at(0)], t)[0].box).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
  it('reads a group of any scale the mod draws as pick.ts does: a box, handles and a move under G s=[1e-7,1e-7]', () => {
    const s = scene([node('G', { s: [1e-7, 1e-7] }, [node('R', { x: 0, y: 0, w: 1e8, h: 1e8 })])])
    const b = worldBox(s, [0, 0])!
    expect([b.x, b.y, b.w, b.h].map(v => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 10, 10])
    expect([rootBoxes(s)[0] !== null, allBoxes(s, new Set()).length > 0, handleFrame(s, [0, 0], { w: 480, h: 480 }, null) !== null]).toEqual([true, true, true])
    const out = moveUnits(s, unitsOf(s, [at(0, 0)], t), [{ dx: 1, dy: 0 }], t)
    expect([out.skipped, Math.round(out.scene.root[0].c![0].attrs.x as number)]).toEqual([[], 1e7])
  })
  it('says why a node under a group stays: a group not literal, or one singular', () => {
    const s = scene([node('G', { t: ['=t', 0] }, [R(0)]), node('G', { s: [0, 1] }, [R(0)])])
    expect(moveUnits(s, unitsOf(s, [at(0, 0), at(1, 0)], t), [{ dx: 1, dy: 0 }, { dx: 1, dy: 0 }], t).skipped)
      .toEqual(['1 skipped: a group above is not literal', '1 skipped: a group above is singular'])
  })
  it('moves 200,000 units in one pass (one replaceAt per unit copied the root list each time: 4e10 copies)', () => {
    const tracked = indexedReads(Array.from({ length: 200_000 }, (_, k) => R(k)), 8 * 200_000), s = scene(tracked.values)
    const units = unitsOf(s, s.root.map((_, k) => at(k)), t)
    tracked.reset()
    const out = moveUnits(s, units, units.map(() => ({ dx: 1, dy: 0 })), t)
    expect(out.scene.root.every((n, k) => n.attrs.x === k + 1)).toBe(true)
    expect(tracked.count()).toBeLessThanOrEqual(8 * 200_000)
  }, 20_000) // measured: 2.530 s alone, 2.785-4.704 s full suite; at least 3x headroom
  it('boxes each root-tree member in design units; DEFS members are no units', () => {
    const s = scene([R(0), node('G', { s: [2, 2] }, [R(0)])])
    expect(unitsOf(s, [at(1, 0), { ...at(0), inDefs: true }], t)).toEqual([{ sel: at(1, 0), node: s.root[1].c![0], box: { x: 0, y: 0, w: 20, h: 20 }, locked: null, widget: null }])
  })
  it('moves each unit by a design-unit delta through its own chain', () => {
    const s = scene([R(0), node('G', { s: [2, 2] }, [R(0)])])
    const out = moveUnits(s, unitsOf(s, [at(0), at(1, 0)], t), [{ dx: 10, dy: 0 }, { dx: 10, dy: 0 }], t)
    expect(out.scene.root[0].attrs.x).toBe(10)
    expect(out.scene.root[1].c![0].attrs.x).toBe(5)
    expect(out.skipped).toEqual([])
  })
  it('skips a locked unit and an expression axis, counting each reason; the scene object stays when nothing moved', () => {
    const s = scene([R(0, { comments: ['lock'] }), R('$a'), R('$b')])
    const out = moveUnits(s, unitsOf(s, [at(0), at(1), at(2)], t), [{ dx: 5, dy: 0 }, { dx: 5, dy: 0 }, { dx: 5, dy: 0 }], t)
    expect(out.scene).toBe(s)
    expect(out.skipped).toEqual(['1 skipped: locked', '2 skipped: x is an expression'])
  })
  it('moves a unit inside another unit once, with that one; a missing delta moves nothing', () => {
    const s = scene([node('G', {}, [R(0)]), node('SC', { x: 0, y: 0, w: 10, h: 10 }, [R(0)])])
    const out = moveUnits(s, unitsOf(s, [at(0), at(0, 0), at(1), at(1, 0)], t), Array(4).fill({ dx: 5, dy: 0 }), t)
    expect(out.scene.root[0].attrs.t).toEqual([5, 0])
    expect(out.scene.root[0].c![0].attrs.x).toBe(0)
    expect(out.scene.root[1].attrs.x).toBe(5)
    expect(out.scene.root[1].c![0].attrs.x).toBe(5)
    expect(moveUnits(s, unitsOf(s, [at(1)], t), [], t)).toEqual({ scene: s, skipped: [], notes: [] })
  })
  it('keeps the scene object for moves that round to nothing, a path included', () => {
    const s = scene([node('L', { p: [0, 0, 10, 10] }), node('Y', { p: [0, 0, 4, 0, 0, 4] }), node('SP', { p: [0, 0, 10, 0, 10, 10] }),
      node('P', { d: 'M 0,0 L 10,10' })])
    expect(moveUnits(s, unitsOf(s, [at(0), at(1), at(2), at(3)], t), Array(4).fill({ dx: 1e-9, dy: 0 }), t).scene).toBe(s)
  })
  it('writes a whole design-unit move inside a 3x group to 3 decimals: the node lands within 0.0005 x 3', () => {
    const s = scene([node('G', { s: [3, 3] }, [R(0)])])
    expect(moveUnits(s, unitsOf(s, [at(0, 0)], t), [{ dx: 10, dy: 0 }], t).scene.root[0].c![0].attrs.x).toBe(Math.fround(3.333))
  })
  it('says a clip does not follow a move', () => {
    const s = scene([node('G', { clip: 'c1' }, [R(0)])])
    expect(moveUnits(s, unitsOf(s, [at(0, 0)], t), [{ dx: 1, dy: 0 }], t).notes).toEqual(['clip c1 does not follow a move'])
  })
  it('boxes a widget root by its params and moves it by them: each axis that moves to a whole unit, no t, still a widget', () => {
    const s = putWidget(scene([]), instance('bar', { x: 100.5, y: 40, w: 200, h: 30 }), t)
    const [u] = unitsOf(s, [at(0)], t)
    expect([u.box, u.widget?.uid]).toEqual([{ x: 100.5, y: 40, w: 200, h: 30 }, 'bar1'])
    const down = moveUnits(s, [u], [{ dx: 0, dy: 7.4 }], t).scene
    expect(widgetOf(down.root[0], t)!.params).toMatchObject({ x: 100.5, y: 47 })   // x does not move, so it is not rounded
    expect(down.root[0].attrs).toEqual({ id: 'bar1' })
    expect(widgetOf(moveUnits(s, [u], [{ dx: 0.4, dy: 0 }], t).scene.root[0], t)!.params.x).toBe(101)   // 100.9 to a whole unit
    expect(moveUnits(s, [u], [{ dx: 0, dy: 0.4 }], t).scene).toBe(s)   // 40.4 rounds back to 40: nothing moved
  })
  it('leaves a widget root where it is, and says so, when a move would take its x or y out of float32 (as a node)', () => {
    const s = putWidget(scene([]), instance('bar', { x: 100, y: 40 }), t), [u] = unitsOf(s, [at(0)], t)
    for (const d of [{ dx: 3.5e38, dy: 0 }, { dx: 0, dy: -1e300 }])
      expect(moveUnits(s, [u], [d], t)).toEqual({ scene: s, skipped: ['1 skipped: the value left float32'], notes: [] })
  })
})
