import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { node } from '../../model/testing'
import { commandFor } from '../registry'
import { harness } from '../testing'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })
const at = (...path: number[]) => ({ pageId: 'p1', path })
// A press anywhere picks the R, so a drag from its middle (away from its handles) moves it.
const page = () => harness({ header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 10, y: 10, w: 100, h: 100 })] }, { sel: at(0), pick: () => at(0) })
const press = (h: ReturnType<typeof page>, k: string) => { void commandFor(k, h.ctx)!.run(h.ctx) }

describe('nudge', () => {
  it('a burst moves one set on one page: a press after the set changed (Mod+A, a page switch) is a step of its own', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 10 }), node('R', { x: 50 })] }, { sel: at(0) })
    press(h, 'ArrowRight')
    h.ctx.dispatch({ type: 'select', selection: at(1) })   // Mod+A, a click in the code pane, a page switch and a click
    press(h, 'ArrowRight')
    expect(h.state().past).toHaveLength(1)   // the first burst, alone
    vi.advanceTimersByTime(500)
    expect(h.state().past).toHaveLength(2)
    h.ctx.dispatch({ type: 'undo' })
    expect(h.root().map(n => n.attrs.x)).toEqual([11, 50])
  })
  it('moves the selection 1 unit, 10 with Shift, whatever the grid; a burst is one undo step after 500 ms of quiet', () => {
    const h = page()
    h.ctx.setSettings({ grid: 8 })
    for (const k of ['ArrowRight', 'ArrowRight', 'Shift+ArrowDown']) void commandFor(k, h.ctx)!.run(h.ctx)
    expect(h.root()[0].attrs).toMatchObject({ x: 12, y: 20 })
    expect(h.state().past).toHaveLength(0)
    vi.advanceTimersByTime(499)
    expect(h.state().past).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(h.state().past).toHaveLength(1)
    h.ctx.dispatch({ type: 'undo' })
    expect(h.root()[0].attrs).toMatchObject({ x: 10, y: 10 })
  })
  it('a burst that nets to nothing, committed while a checked command is in flight, does not refuse that command', async () => {
    const h = page()
    press(h, 'ArrowRight')
    press(h, 'ArrowLeft')   // back where it began, in a scene object of its own
    const done = commandFor('Mod+D', h.ctx)!.run(h.ctx)
    vi.advanceTimersByTime(500)   // the burst commits: the store hands back the project it started from
    await done
    expect([h.root().length, h.notes]).toEqual([2, []])
  })
  it('never commits a transient edit that is not its own', () => {
    const h = page()
    void commandFor('ArrowLeft', h.ctx)!.run(h.ctx)
    h.ctx.dispatch({ type: 'commitDrag' })   // a press on the canvas commits the burst
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] }, transient: true })   // another gesture
    vi.advanceTimersByTime(500)
    expect(h.state().dragBase).not.toBeNull()
  })
  it('a burst waits for 500 ms after its last press, not its first: a key held for a second is one undo step', () => {
    const h = page()
    press(h, 'ArrowRight')
    vi.advanceTimersByTime(400)
    press(h, 'ArrowRight')
    vi.advanceTimersByTime(400)
    press(h, 'ArrowRight')
    expect(h.state().past).toHaveLength(0)
    vi.advanceTimersByTime(499)
    expect(h.state().past).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(h.state().past).toHaveLength(1)
    expect(h.root()[0].attrs.x).toBe(13)
  })
  // The store hands back the same Project after an undo, or after a burst that nets to nothing and is committed by the
  // press: a drag that starts from it within 500 ms has that Project as its dragBase too, and must stay one undo step.
  it('never commits a drag that starts from the project the burst started from (after an undo)', () => {
    const h = page()
    press(h, 'ArrowRight')
    h.ctx.dispatch({ type: 'undo' })
    h.down({ x: 60, y: 60 })
    h.move({ x: 70, y: 60 })
    vi.advanceTimersByTime(500)
    h.move({ x: 80, y: 60 })
    h.up({ x: 80, y: 60 })
    expect(h.root()[0].attrs.x).toBe(30)
    expect(h.state().past).toHaveLength(1)
  })
  it('never commits a drag that starts from the project the burst started from (a burst that nets to nothing)', () => {
    const h = page()
    press(h, 'ArrowRight')
    press(h, 'ArrowLeft')
    h.down({ x: 60, y: 60 })
    h.move({ x: 70, y: 60 })
    vi.advanceTimersByTime(500)
    h.move({ x: 80, y: 60 })
    h.up({ x: 80, y: 60 })
    expect(h.root()[0].attrs.x).toBe(30)
    expect(h.state().past).toHaveLength(1)
  })
  it('moves every member of the set, and says what stayed', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 10, y: 10, w: 10, h: 10 }),
      { ...node('R', { x: 40, y: 10, w: 10, h: 10 }), comments: ['lock'] }, node('R', { x: 70, y: 10, w: 10, h: 10 })] },
    { sel: at(2), also: [at(0), at(1)] })
    press(h, 'ArrowDown')
    expect(h.root().map(n => n.attrs.y)).toEqual([11, 10, 11])
    expect(h.notes).toEqual(['1 skipped: locked'])
  })
  it('applies only with the select tool and a selection on the page', () => {
    const h = page()
    h.ctx.dispatch({ type: 'select', selection: null })
    expect(commandFor('ArrowLeft', h.ctx)).toBeUndefined()
    h.ctx.dispatch({ type: 'select', selection: at(0) })
    h.ctx.setTool('rect')
    expect(commandFor('ArrowLeft', h.ctx)).toBeUndefined()
  })
})
