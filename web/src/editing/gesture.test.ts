import { describe, expect, it } from 'vitest'
import type { Scene } from '../model/scene'
import { node } from '../model/testing'
import { sceneDrag } from './gesture'
import { harness } from './testing'
import type { Press } from './types'

const R = node('R', { x: 10, y: 10, w: 5, h: 5 })
const start = () => harness({ header: { w: 460, h: 460 }, defs: [], root: [R] })
const press = (x: number, css = x): Press => ({ at: { x, y: 0 }, px: { x, y: 0 }, start: { x: 0, y: 0 }, css,
  mods: { shift: false, alt: false, mod: false }, clicks: 1 })
const movedBy = (base: Scene, dx: number): Scene => ({ ...base, root: [{ ...base.root[0], attrs: { ...base.root[0].attrs, x: 10 + dx } }] })

describe('sceneDrag', () => {
  it('writes nothing within the slop, then rebuilds every step from the first move\'s scene; release is one undo step', () => {
    const h = start(), bases: unknown[] = []
    const g = sceneDrag(h.ctx, (p, base) => { bases.push(base.root[0].attrs.x); return { scene: movedBy(base, p.at.x) } })
    g.move(press(2))
    expect(h.actions).toEqual([])
    g.move(press(5))
    g.move(press(9))
    expect(bases).toEqual([10, 10])
    expect(h.root()[0].attrs.x).toBe(19)
    expect(g.up(press(9))).toBe(false)
    expect(h.state().past).toHaveLength(1)
    h.ctx.dispatch({ type: 'undo' })
    expect(h.root()[0]).toBe(R)
  })
  it('shows the guides of a snap before its first write (a snap back onto the press), and draws again for them', () => {
    const h = start(), g = sceneDrag<string>(h.ctx, (_, base) => ({ scene: base, guides: ['x'] }), { overlay: (_, guides) => guides.join() })
    g.move(press(5))
    expect([h.actions, g.overlay!({} as never), h.redraws()]).toEqual([[], 'x', 1])
  })
  it('is a click when released within the slop: nothing written, onClick told', () => {
    const h = start(), clicks: number[] = []
    const g = sceneDrag(h.ctx, (p, base) => ({ scene: movedBy(base, p.at.x) }), { onClick: p => clicks.push(p.at.x) })
    g.move(press(1))
    g.up(press(1))
    expect(clicks).toEqual([1])
    expect(h.actions).toEqual([])
  })
  it('cancel restores the scene; onCommit is told only after a release that dragged', () => {
    const h = start(), told: string[] = []
    const g = sceneDrag(h.ctx, (p, base) => ({ scene: movedBy(base, p.at.x) }), { onCommit: () => told.push('commit') })
    g.move(press(5))
    g.cancel()
    expect(h.root()[0]).toBe(R)
    expect(h.state().past).toHaveLength(0)
    expect(told).toEqual([])
  })
  it('stops and keeps what it wrote when the page changes under it (a code-pane flush, an undo)', () => {
    const h = start()
    const g = sceneDrag(h.ctx, (p, base) => ({ scene: movedBy(base, p.at.x) }))
    g.move(press(5))
    const other = { ...h.scene(), root: [node('C', { cx: 1, cy: 1, rx: 1 })] }
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: other })
    g.move(press(8))
    expect(h.scene()).toBe(other)
    expect(h.state().past).toHaveLength(2)   // the drag's own step, then the other edit
  })
  it('stops when the page changes before its first write (every step so far refused), keeping the other edit', () => {
    const h = start()
    let refuse = true
    const g = sceneDrag(h.ctx, (p, base) => refuse ? null : { scene: movedBy(base, p.at.x) })
    g.move(press(5))
    const other = { ...h.scene(), root: [node('C', { cx: 1, cy: 1, rx: 1 })] }
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: other })
    refuse = false
    g.move(press(8))
    expect(h.scene()).toBe(other)
    g.up(press(8))
    expect(h.state().past).toHaveLength(1)   // the other edit's step only
  })
  it('leaves no undo step, and keeps redo, when the drag ends where it began (out and back)', () => {
    const h = start()
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] } })
    h.ctx.dispatch({ type: 'undo' })
    const g = sceneDrag(h.ctx, (p, base) => ({ scene: movedBy(base, p.at.x) }))
    g.move(press(5))
    g.move(press(0, 5))
    g.up(press(0, 5))
    expect(h.root()[0]).toBe(R)
    expect([h.state().past.length, h.state().future.length]).toEqual([0, 1])
  })
  it('stops when an undo lands mid-drag (M1)', () => {
    const h = start()
    const g = sceneDrag(h.ctx, (p, base) => ({ scene: movedBy(base, p.at.x) }))
    g.move(press(5))
    h.ctx.dispatch({ type: 'undo' })
    g.move(press(9))
    expect(h.root()[0]).toBe(R)
    expect(h.state().future).toHaveLength(1)
  })
  it('leaves no undo step when every step hands back the scene it started from (all refused)', () => {
    const h = start(), told: string[] = []
    const g = sceneDrag(h.ctx, (_, base) => ({ scene: base }), { onCommit: () => told.push('commit') })
    g.move(press(5))
    g.up(press(5))
    expect(h.actions).toEqual([])
    expect(h.state().past).toHaveLength(0)
    expect(told).toEqual(['commit'])   // a refused drag still says why on release
  })
  it('sets the selection its build names', () => {
    const h = start()
    const g = sceneDrag(h.ctx, (_, base) => ({ scene: { ...base, root: [...base.root, R] }, selection: [{ pageId: 'p1', path: [1] }] }))
    g.move(press(5))
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [1] })
  })
})
