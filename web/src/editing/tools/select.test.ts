// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { indexOfPath } from '../../model/numbering'
import type { Scene, SrcNode } from '../../model/scene'
import type { Selection } from '../../model/store'
import { node } from '../../model/testing'
import { decodeFrame, type Frame } from '../../runtime/frame'
import { vbf1 } from '../../runtime/testing'
import { worldBox } from '../bounds'
import { spanBox } from '../select'
import { harness } from '../testing'
import type { Pt } from '../types'

// One unit per px: a 460 header on the 460 px page, zoom 1. A press picks the innermost node whose box holds the point.
function inner(scene: Scene, px: Pt): Selection | null {
  let found: number[] | null = null
  const stack: [SrcNode[], number[]][] = [[scene.root, []]]
  for (let top = stack.pop(); top; top = stack.pop()) top[0].forEach((n, i) => {
    const path = [...top![1], i], b = worldBox(scene, path)
    if (b && px.x >= b.x && px.x <= b.x + b.w && px.y >= b.y && px.y <= b.y + b.h && (!found || path.length >= found.length)) found = path
    if (n.c) stack.push([n.c, path])
  })
  return found && { pageId: 'p1', path: found }
}
const page = (root: SrcNode[], o: { sel?: Selection | null; also?: Selection[] } = {}) => {
  const h: ReturnType<typeof harness> = harness({ header: { w: 460, h: 460 }, defs: [], root }, { ...o, pick: px => inner(h.scene(), px) })
  return h
}
const at = (...path: number[]) => ({ pageId: 'p1', path })
const C = node('C', { cx: 200, cy: 200, rx: 10 }), R = node('R', { x: 100, y: 100, w: 40, h: 20 })

describe('the set transform handles', () => {
  const pair = () => page([node('R', { x: 100, y: 100, w: 10, h: 10 }), node('R', { x: 120, y: 100, w: 10, h: 10 })], { sel: at(1), also: [at(0)] })
  it('resizes the set from its union handle as one undo step and restores the set on undo', () => {
    const h = pair(), before = h.state().project
    h.down({ x: 130, y: 110 }, { ctrlKey: true }); h.move({ x: 160, y: 120 }, { ctrlKey: true })
    expect(h.root().map(n => n.attrs)).toEqual([{ x: 100, y: 100, w: 20, h: 20 }, { x: 140, y: 100, w: 20, h: 20 }])
    expect(h.state().past).toHaveLength(0)
    h.up({ x: 160, y: 120 }, { ctrlKey: true })
    expect(h.state().past).toHaveLength(1)
    h.key({ key: 'z', ctrlKey: true })
    expect(h.state().project).toBe(before)
    expect(h.state()).toMatchObject({ selection: at(1), also: [at(0)] })
  })
  it('cancels a set resize with Esc, restoring every member and the selection without history', () => {
    const h = pair(), before = h.state().project
    h.down({ x: 130, y: 110 }); h.move({ x: 160, y: 120 })
    expect(h.root()[0].attrs.w).toBe(20)
    h.key({ key: 'Escape' })
    expect(h.state().project).toBe(before)
    expect(h.state()).toMatchObject({ selection: at(1), also: [at(0)] })
    expect(h.state().past).toHaveLength(0)
  })
  it('keeps the last valid set resize when a later step would become singular', () => {
    const h = pair()
    h.down({ x: 130, y: 110 }, { ctrlKey: true }); h.move({ x: 160, y: 120 }, { ctrlKey: true })
    expect(h.root()[0].attrs.w).toBe(20)
    h.move({ x: 100, y: 100 }, { ctrlKey: true })
    expect(h.root()[0].attrs.w).toBe(20)
    h.up({ x: 100, y: 100 }, { ctrlKey: true })
    expect(h.state().past).toHaveLength(1)
    expect(h.notes.join()).toContain('singular')
  })
  it('turns the set about its common centre and steps Shift rotation by 15 degrees', () => {
    const h = pair()
    h.drag({ x: 115, y: 76 }, { x: 145, y: 105 }, { ctrlKey: true })
    expect(h.root().map(n => n.attrs)).toEqual([{ a: [115, 105], r: 90 }, { a: [115, 105], r: 90 }])
    expect(h.state()).toMatchObject({ selection: at(1, 0), also: [at(0, 0)] })
    expect(h.state().past).toHaveLength(1)
    const shifted = pair(), angle = -10 * Math.PI / 180
    shifted.drag({ x: 115, y: 76 }, { x: 115 + 30 * Math.cos(angle), y: 105 + 30 * Math.sin(angle) }, { shiftKey: true })
    expect(shifted.root().map(n => n.attrs.r)).toEqual([75, 75])
  })
  it('keeps Shift proportions and scales from the set centre with Alt', () => {
    const h = pair()
    h.drag({ x: 130, y: 110 }, { x: 175, y: 115 }, { shiftKey: true, ctrlKey: true })
    expect(h.root()[0].attrs).toMatchObject({ x: 100, y: 100, w: 25, h: 25 })
    expect(h.root()[1].attrs).toMatchObject({ x: 150, y: 100, w: 25, h: 25 })
    const centred = pair()
    centred.drag({ x: 130, y: 110 }, { x: 145, y: 115 }, { altKey: true, ctrlKey: true })
    expect(centred.root()[0].attrs).toMatchObject({ x: 85, y: 95, w: 20, h: 20 })
    expect(centred.root()[1].attrs).toMatchObject({ x: 125, y: 95, w: 20, h: 20 })
  })
  it('snaps the union edge to another node at the current zoom', () => {
    const h = page([node('R', { x: 100, y: 100, w: 10, h: 10 }), node('R', { x: 120, y: 100, w: 10, h: 10 }),
      node('R', { x: 160, y: 120, w: 10, h: 10 })], { sel: at(1), also: [at(0)] })
    h.ctx.setView({ zoom: 2, pan: { x: 100, y: 50 } })
    h.drag({ x: 130, y: 110 }, { x: 158.8, y: 121.2 })
    expect(h.root()[0].attrs).toMatchObject({ x: 100, y: 100, w: 20, h: 20 })
    expect(h.root()[1].attrs).toMatchObject({ x: 140, y: 100, w: 20, h: 20 })
  })
})

describe('group-first selection and navigation', () => {
  const nested = () => page([node('G', { t: [50, 0] }, [node('R', { x: 0, y: 0, w: 20, h: 20 }),
    node('G', {}, [node('R', { x: 40, y: 60, w: 20, h: 20 }), node('R', { x: 250, y: 200, w: 20, h: 20 }),
      node('R', { x: 100, y: 100, w: 80, h: 80 })])]), node('G', {}, [node('R', { x: 350, y: 350, w: 60, h: 60 })])])
  const point = { x: 190, y: 140 }
  it('a plain press keeps a deeper selected node and drags only it without changing entry', () => {
    const h = nested()
    h.ctx.dispatch({ type: 'select', selection: at(0, 1, 2) })
    h.down(point)
    expect(h.state()).toMatchObject({ entered: null, selection: at(0, 1, 2) })
    h.move({ x: 200, y: 140 }); h.up({ x: 200, y: 140 })
    expect(h.root()[0].attrs.t).toEqual([50, 0])
    expect(h.root()[0].c![1].c![2].attrs.x).toBe(110)
    expect(h.state().selection).toEqual(at(0, 1, 2))
    expect(h.state().past).toHaveLength(1)
  })
  it('a deeper selected group and the rest of its set keep moving together', () => {
    const h = nested()
    h.ctx.setSettings({ snap: false })
    h.ctx.dispatch({ type: 'select', selection: at(0, 1), also: [at(1)] })
    h.drag(point, { x: 200, y: 140 })
    expect(h.state()).toMatchObject({ entered: null, selection: at(0, 1), also: [at(1)] })
    expect(h.root()[0].attrs.t).toEqual([50, 0])
    expect(h.root()[0].c![1].attrs.t).toEqual([10, 0])
    expect(h.root()[1].attrs.t).toEqual([10, 0])
  })
  it('a blank click leaves the entered group at root without history', () => {
    const h = nested()
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 1] })
    h.click({ x: 450, y: 450 })
    expect(h.state()).toMatchObject({ entered: null, selection: null })
    expect(h.state().past).toHaveLength(0)
  })
  it('click picks the group; double-click enters and picks at its child depth', () => {
    const h = nested()
    h.click(point)
    expect(h.state().selection).toEqual(at(0))
    h.click(point, { double: true })
    expect(h.state()).toMatchObject({ entered: at(0), selection: at(0, 1) })
    h.click(point)
    expect(h.state().selection).toEqual(at(0, 1))
  })
  it('a casual drag moves the visible group as one step', () => {
    const h = nested()
    h.drag(point, { x: 200, y: 140 })
    expect(h.root()[0].attrs.t).toEqual([60, 0])
    expect(h.root()[0].c![1].c![2].attrs.x).toBe(100)
    expect(h.state().past).toHaveLength(1)
  })
  it('Ctrl and Cmd pick deep, enter the parent and move only that node unsnapped', () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const h = nested()
      h.drag(point, { x: 200.4, y: 140 }, mod)
      expect(h.state()).toMatchObject({ entered: at(0, 1), selection: at(0, 1, 2) })
      expect(h.root()[0].attrs.t).toEqual([50, 0])
      expect(h.root()[0].c![1].c![2].attrs.x).toBeCloseTo(110.4, 4)
    }
  })
  it('a click outside leaves to the page root and picks that top-level ancestor', () => {
    const h = nested()
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 1] })
    h.click({ x: 380, y: 380 })
    expect(h.state()).toMatchObject({ entered: null, selection: at(1) })
  })
  it('Ctrl on a selected group corner picks its child instead of resizing the group', () => {
    const h = page([node('G', {}, [node('R', { x: 100, y: 100, w: 100, h: 100 })])], { sel: at(0) })
    h.drag({ x: 200, y: 200 }, { x: 210.4, y: 200 }, { ctrlKey: true })
    expect(h.state()).toMatchObject({ entered: at(0), selection: at(0, 0) })
    expect(h.root()[0].attrs).toEqual({})
    expect(h.root()[0].c![0].attrs).toMatchObject({ x: Math.fround(110.4), w: 100 })
  })
  it('Enter enters the selected group and picks its first child; Shift+Enter selects it and leaves', () => {
    const h = nested()
    h.ctx.dispatch({ type: 'select', selection: at(0) })
    h.key({ key: 'Enter' })
    expect(h.state()).toMatchObject({ entered: at(0), selection: at(0, 0) })
    h.ctx.dispatch({ type: 'select', selection: at(0, 1) })
    h.key({ key: 'Enter' })
    expect(h.state()).toMatchObject({ entered: at(0, 1), selection: at(0, 1, 0) })
    h.key({ key: 'Enter', shiftKey: true })
    expect(h.state()).toMatchObject({ entered: at(0), selection: at(0, 1) })
  })
  it('Esc cancels a gesture, leaves a tool, then selects the entered group and leaves one level', () => {
    const h = nested()
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 1] })
    h.ctx.dispatch({ type: 'select', selection: at(0, 1, 2) })
    const before = h.scene()
    h.down(point)
    h.move({ x: 210, y: 140 })
    h.key({ key: 'Escape' })
    expect(h.scene()).toEqual(before)
    expect(h.state()).toMatchObject({ entered: at(0, 1), selection: at(0, 1, 2) })
    h.ctx.setTool('rect')
    h.key({ key: 'Escape' })
    expect(h.ctx.tool()).toBe('select')
    expect(h.state().entered).toEqual(at(0, 1))
    h.key({ key: 'Escape' })
    expect(h.state()).toMatchObject({ entered: at(0), selection: at(0, 1) })
  })
  it('Esc with nothing selected leaves one level', () => {
    const h = nested()
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 1] })
    h.key({ key: 'Escape' })
    expect(h.state()).toMatchObject({ entered: at(0), selection: null })
  })
  it('a marquee catches only the entered group children in world coordinates', () => {
    const h = nested()
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 1] })
    h.ctx.pick = () => ({ target: null })   // start the marquee in empty space, not on the enclosing group's bounds
    h.drag({ x: 145, y: 95 }, { x: 240, y: 190 })
    expect(h.state()).toMatchObject({ entered: at(0, 1), selection: at(0, 1, 2), also: [] })
  })
})

describe('the select tool: move', () => {
  it('a press selects the node under it; a drag moves it to whole units, as one undo step', () => {
    const h = page([C])
    h.drag({ x: 200, y: 200 }, { x: 210.4, y: 205.3 })
    expect(h.state().selection).toEqual(at(0))
    expect(h.root()[0].attrs).toMatchObject({ cx: 210, cy: 205 })
    expect(h.state().past).toHaveLength(1)
  })
  it('snaps the moving box to another node\'s edge; Ctrl/Cmd moves freely', () => {
    const h = page([node('R', { x: 0, y: 0, w: 100, h: 30 }), C])
    h.drag({ x: 200, y: 200 }, { x: 113, y: 200 })
    expect(h.root()[1].attrs.cx).toBe(110)
    const free = page([C])
    free.drag({ x: 200, y: 200 }, { x: 210.4, y: 200 }, { ctrlKey: true })
    expect(free.root()[0].attrs.cx).toBeCloseTo(210.4, 4)
  })
  it('moves every member of the set together', () => {
    const h = page([C, R], { sel: at(1), also: [at(0)] })
    h.drag({ x: 120, y: 110 }, { x: 130, y: 110 })
    expect(h.root()[0].attrs.cx).toBe(210)
    expect(h.root()[1].attrs.x).toBe(110)
    expect(h.state().also).toEqual([at(0)])
  })
  it("moves through the chain under a turned group (M1: screen right is the R's local -y)", () => {
    const h = page([node('G', { t: [10, 0], r: 90 }, [node('R', { x: 20, y: 30, w: 40, h: 40 })])], { sel: at(0, 0) })
    h.drag({ x: -40, y: 40 }, { x: -35, y: 40 }, { ctrlKey: true })
    expect(h.root()[0].c![0].attrs).toEqual({ x: 20, y: 25, w: 40, h: 40 })
  })
  it('says what stayed: an expression axis', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: '$a', y: 0, w: 10, h: 10 })] }, { pick: () => at(0) })
    h.drag({ x: 5, y: 5 }, { x: 15, y: 20 })
    expect(h.root()[0].attrs).toMatchObject({ x: '$a', y: 15 })
    expect(h.notes).toContain('1 skipped: x is an expression')
  })
  it('moves a node whose size alone is an expression (M1)', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 1, y: 2, w: '$w', h: 4 })] }, { pick: () => at(0) })
    h.drag({ x: 5, y: 5 }, { x: 10, y: 5 })
    expect(h.root()[0].attrs).toEqual({ x: 6, y: 2, w: '$w', h: 4 })
  })
  it('moves nothing under a singular group, says why, and leaves no undo step (M1)', () => {
    const flat = node('R', { x: 20, y: 30, w: 5, h: 5 })
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('G', { s: [0, 1] }, [flat])] }, { pick: () => at(0, 0), sel: at(0, 0) })
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.ctx.dispatch({ type: 'select', selection: at(0, 0) })
    h.drag({ x: 5, y: 5 }, { x: 15, y: 5 })
    expect(h.root()[0].c![0]).toBe(flat)
    expect(h.notes).toContain('1 skipped: a group above is singular')
    expect(h.state().past).toHaveLength(0)
  })
})

describe('the select tool: the set', () => {
  it('Shift+click adds and removes; a click without a drag on a member selects it alone; empty space deselects', () => {
    const h = page([C, R])
    h.click({ x: 200, y: 200 })
    h.click({ x: 120, y: 110 }, { shiftKey: true })
    expect(h.state()).toMatchObject({ selection: at(1), also: [at(0)] })
    h.click({ x: 200, y: 200 }, { shiftKey: true })
    expect(h.state()).toMatchObject({ selection: at(1), also: [] })
    h.click({ x: 200, y: 200 }, { shiftKey: true })
    h.click({ x: 120, y: 110 })
    expect(h.state()).toMatchObject({ selection: at(1), also: [] })
    h.click({ x: 400, y: 40 })
    expect(h.state().selection).toBeNull()
  })
  it('a press outside a selected native picks the scene node and drags it', () => {
    const h = page([C])
    h.ctx.dispatch({ type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    expect(h.state().selection).toMatchObject({ path: [], native: 'ico1' })
    const ref = h.ctx.page().natives![0]
    h.ctx.dispatch({ type: 'setWidget', pageId: 'p1', ref: { ...ref, params: { ...ref.params, x: 300, y: 300 } } })
    h.drag({ x: 200, y: 200 }, { x: 210.4, y: 205.3 })
    expect(h.state().selection).toEqual(at(0))
    expect(h.root()[0].attrs).toMatchObject({ cx: 210, cy: 205 })
  })
  it('a press inside the selected group drags the group; a double click enters and selects the child', () => {
    const h = page([node('G', { t: [10, 0] }, [node('R', { x: 20, y: 30, w: 40, h: 40 })])], { sel: at(0) })
    h.drag({ x: 50, y: 50 }, { x: 55, y: 50 })
    expect(h.root()[0].attrs.t).toEqual([15, 0])
    h.click({ x: 55, y: 50 })
    expect(h.state().selection).toEqual(at(0))
    h.click({ x: 55, y: 50 }, { double: true })
    expect(h.state().selection).toEqual(at(0, 0))
  })
  it('a marquee on empty space catches the root nodes it touches; Shift adds to the set; Ctrl/Cmd only what it encloses', () => {
    const h = page([node('R', { x: 10, y: 10, w: 20, h: 20 }), node('R', { x: 100, y: 100, w: 20, h: 20 })])
    h.drag({ x: 5, y: 5 }, { x: 50, y: 50 })
    expect(h.state()).toMatchObject({ selection: at(0), also: [] })
    h.drag({ x: 300, y: 300 }, { x: 110, y: 110 }, { shiftKey: true })
    expect(h.state()).toMatchObject({ selection: at(1), also: [at(0)] })
    h.drag({ x: 0, y: 0 }, { x: 25, y: 25 }, { ctrlKey: true })   // clear of the selected set's new nw handle
    expect(h.state().selection).toBeNull()
  })
  it('a marquee skips a locked node', () => {
    const h = page([{ ...node('R', { x: 10, y: 10, w: 20, h: 20 }), comments: ['lock'] }])
    h.drag({ x: 5, y: 5 }, { x: 50, y: 50 })
    expect(h.state().selection).toBeNull()
  })
  // One opaque triangle drawn by parse index k on page p1's scene element, over (10, 10) to (30, 30) surface px, from
  // `drawnFrom` (the scene the bridge says it shows): the frame shown, set once the page's check has numbered it.
  const triangle = (k: number, drawnFrom: Scene): Frame => ({
    ...decodeFrame(vbf1(JSON.stringify({ elements: [{ id: 'scene', scene: 'p1', x: 0, y: 0, w: 460, h: 460, firstVertex: 0, vertexCount: 3 }], text: [], problems: [] }))),
    positions: Float32Array.of(10, 10, 30, 10, 10, 30), coverage: Float32Array.of(1, 1, 1), colours: new Uint8Array(12).fill(255),
    indices: Uint32Array.of(0, 1, 2), spans: Int32Array.of(0, k, 0, 3), drawnFrom,
  })
  const shown = async (h: ReturnType<typeof harness>, path: number[]) => {
    await h.checker.check(h.scene())
    const k = indexOfPath(h.ctx.order()!, h.root(), path), from = h.scene()
    expect(k).not.toBeNull()
    h.ctx.frame = () => triangle(k!, from)
  }
  const sym = node('SYM', { id: 's' }, [node('R', { x: 0, y: 0, w: 20, h: 20 })])
  it('a marquee catches a root node with no literal box (a USE) by its spans in the frame shown, else not at all', async () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [sym], root: [node('R', { x: 200, y: 200, w: 20, h: 20 }), node('USE', { ref: 's' })] })
    h.drag({ x: 5, y: 5 }, { x: 50, y: 50 })
    expect(h.state().selection).toBeNull()   // no frame: no spans
    await shown(h, [1])
    expect(spanBox(h.ctx, 1)).toEqual({ x: 10, y: 10, w: 20, h: 20 })
    expect(spanBox(h.ctx, 0)).toBeNull()
    h.drag({ x: 5, y: 5 }, { x: 50, y: 50 })
    expect(h.state()).toMatchObject({ selection: at(1), also: [] })
  })
  // The F3 family (merge gate): a frame is read through the numbering of the scene it was drawn from, as pick and the
  // outline read it (ctx.shownOrder). Here a USE typed on top takes the old USE's parse index before a frame of the new
  // scene arrives: the old frame's spans must not give the new node a box.
  it('a marquee reads no spans from a frame drawn from a scene numbered otherwise (a node typed on top, the old frame shown)', async () => {
    const use = node('USE', { ref: 's' })
    const h = harness({ header: { w: 460, h: 460 }, defs: [sym], root: [use] })
    await shown(h, [0])
    const k = indexOfPath(h.ctx.order()!, h.root(), [0])
    expect(spanBox(h.ctx, 0)).toEqual({ x: 10, y: 10, w: 20, h: 20 })
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [node('USE', { ref: 's' }), use] } })
    await h.checker.check(h.scene())
    expect(indexOfPath(h.ctx.order()!, h.root(), [0])).toBe(k)   // the old USE's index, now the new one's
    expect([spanBox(h.ctx, 0), spanBox(h.ctx, 1)]).toEqual([null, null])
    h.drag({ x: 5, y: 5 }, { x: 50, y: 50 })
    expect(h.state().selection).toBeNull()
  })
  it('a marquee skips a hidden root node, even while the frame shown (one frame late) still draws it', async () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [sym], root: [node('USE', { ref: 's', v: 0 }), node('R', { x: 10, y: 10, w: 20, h: 20, v: 0 })] })
    await shown(h, [0])
    h.drag({ x: 5, y: 5 }, { x: 50, y: 50 })
    expect(h.state().selection).toBeNull()
    await shown(h, [1])
    h.drag({ x: 5, y: 5 }, { x: 50, y: 50 })
    expect(h.state().selection).toBeNull()
  })
})

describe('the select tool: handles', () => {
  it('a handle takes no press while Selection draws none: no frame yet, or one of another page', () => {
    for (const frame of [() => null, () => decodeFrame(vbf1(JSON.stringify({ elements: [{ id: 'scene', scene: 'p2', x: 0, y: 0, w: 460, h: 460,
      firstVertex: 0, vertexCount: 0 }], text: [], problems: [] })))]) {
      const h: ReturnType<typeof harness> = harness({ header: { w: 460, h: 460 }, defs: [], root: [R] }, { sel: at(0), frame, pick: px => inner(h.scene(), px) })
      h.drag({ x: 140, y: 120 }, { x: 160.4, y: 130.2 })   // the corner: a press on the node, so a move
      expect(h.root()[0].attrs).toMatchObject({ w: 40, h: 20 })
    }
  })
  it('Shift on a side handle snaps the dragged side as any edge and keeps the ratio on the other (spec 4 Snapping)', () => {
    const h = page([node('R', { x: 100, y: 100, w: 120, h: 80 })], { sel: at(0) })
    h.ctx.setSettings({ grid: 0 })
    h.drag({ x: 220, y: 140 }, { x: 266.3, y: 140 }, { shiftKey: true })   // the east handle: a whole unit, the height 3 decimals
    const a = h.root()[0].attrs as Record<string, number>
    expect([a.x, a.w, Math.fround(110.667) === a.h, Math.fround(84.667) === a.y]).toEqual([100, 166, true, true])   // the height about the middle
  })
  it('a corner resizes to whole units; Shift keeps the proportions; Alt works from the centre; one undo step each', () => {
    const h = page([R], { sel: at(0) })
    h.drag({ x: 140, y: 120 }, { x: 160.4, y: 130.2 })
    expect(h.root()[0].attrs).toEqual({ x: 100, y: 100, w: 60, h: 30 })
    expect(h.state().past).toHaveLength(1)
    const ratio = page([R], { sel: at(0) })
    ratio.drag({ x: 140, y: 120 }, { x: 160, y: 120 }, { shiftKey: true })
    expect(ratio.root()[0].attrs).toEqual({ x: 100, y: 100, w: 60, h: 30 })
    const centre = page([R], { sel: at(0) })
    centre.drag({ x: 140, y: 110 }, { x: 150, y: 110 }, { altKey: true })
    expect(centre.root()[0].attrs).toEqual({ x: 90, y: 100, w: 60, h: 20 })
  })
  it('with Shift, a snap on the axis that follows lands that edge on its line (the snap adds to the edge\'s own travel)', () => {
    // Shift: the pointer drags x (24 right, 0.2 down), so y follows (12 down, to 132); the other R's bottom at 133 is the
    // nearest line, so y leads: the bottom lands on 133 and x follows to 66 wide.
    const h = page([R, node('R', { x: 0, y: 0, w: 10, h: 133 })], { sel: at(0) })
    h.drag({ x: 140, y: 120 }, { x: 164, y: 120.2 }, { shiftKey: true })
    expect(h.root()[0].attrs).toEqual({ x: 100, y: 100, w: 66, h: 33 })
  })
  it('makes any size the mod takes (Ctrl: half a unit wide); a drag back to the press leaves no undo step', () => {
    const h = page([R], { sel: at(0) })
    h.drag({ x: 140, y: 110 }, { x: 100.5, y: 110 }, { ctrlKey: true })
    expect(h.root()[0].attrs).toEqual({ x: 100, y: 100, w: 0.5, h: 20 })
    const back = page([R], { sel: at(0) })
    back.down({ x: 140, y: 120 })
    back.move({ x: 170, y: 140 })
    back.move({ x: 140, y: 120 })
    back.up({ x: 140, y: 120 })
    expect(back.root()[0]).toBe(R)
    expect(back.state().past).toHaveLength(0)
  })
  it('never makes a box the mod draws as nothing: a step onto the opposite side is refused and says why; past it, it flips', () => {
    const h = page([R], { sel: at(0) })
    h.drag({ x: 140, y: 110 }, { x: 100.3, y: 110 })
    expect(h.root()[0]).toBe(R)
    expect(h.notes).toEqual(['too small to scale'])
    expect(h.state().past).toHaveLength(0)
    const corner = page([R], { sel: at(0) })
    corner.drag({ x: 140, y: 120 }, { x: 100, y: 100 })
    expect(corner.root()[0]).toBe(R)
    // The refused step keeps the last one shown; the next flips; a release after a step that wrote says nothing.
    const flip = page([R], { sel: at(0) })
    flip.down({ x: 140, y: 110 })
    flip.move({ x: 120, y: 110 })
    flip.move({ x: 100.3, y: 110 })
    expect(flip.root()[0].attrs).toEqual({ x: 100, y: 100, w: 20, h: 20 })
    flip.move({ x: 90, y: 110 })
    flip.up({ x: 90, y: 110 })
    expect(flip.root()[0].attrs).toEqual({ x: 90, y: 100, w: 10, h: 20 })
    expect(flip.notes).toEqual([])
    const c = page([node('C', { cx: 200, cy: 200, rx: 20, ry: 10 })], { sel: at(0) })
    c.drag({ x: 220, y: 200 }, { x: 180.3, y: 200 })
    expect(c.root()[0].attrs).toEqual({ cx: 200, cy: 200, rx: 20, ry: 10 })
  })
  it('a locked node keeps its size and turn, and says so', () => {
    const locked = { ...R, comments: ['lock'] }
    const h = page([locked], { sel: at(0) })
    h.drag({ x: 140, y: 120 }, { x: 160, y: 130 })
    h.drag({ x: 120, y: 76 }, { x: 154, y: 110 })
    expect(h.root()[0]).toBe(locked)
    expect(h.notes).toEqual(['locked', 'locked'])
  })
  it('resizes through the chain under a turned group, without snapping (M1)', () => {
    const h = page([node('G', { t: [10, 0], r: 90 }, [node('R', { x: 20, y: 30, w: 5, h: 5 })])], { sel: at(0, 0) })
    h.drag({ x: -22.5, y: 25 }, { x: -22.5, y: 29 })
    expect(h.root()[0].c![0].attrs).toEqual({ x: 20, y: 30, w: 9, h: 5 })
  })
  it('snaps a resize under a chain axis-aligned up to float noise, at any scale (a group turned 180 and scaled 1e8)', () => {
    // 1e-6 px per design unit. sin(180 degrees) leaves 1.2e-8 off the diagonal, which no absolute test calls aligned. The
    // R's w handle is at (300, 250) px; dragged to 232 its edge is 2 px from the page's centre (230), and lands on it.
    const h = harness({ header: { w: 4.6e8, h: 4.6e8 }, defs: [], root: [node('G', { t: [3e8, 3e8], s: [1e8, 1e8], r: 180 },
      [node('R', { x: 0, y: 0, w: 2, h: 1 })])] }, { sel: at(0, 0) })
    h.drag({ x: 300, y: 250 }, { x: 232, y: 250 })
    expect(h.root()[0].c![0].attrs).toEqual({ x: Math.fround(0.7), y: 0, w: Math.fround(1.3), h: 1 })
  })
  it('scales a group from its handles (s and t)', () => {
    const h = page([node('G', {}, [node('R', { x: 0, y: 0, w: 10, h: 10 })])], { sel: at(0) })
    h.drag({ x: 10, y: 10 }, { x: 20, y: 20 })
    expect(h.root()[0].attrs).toEqual({ s: [2, 2] })
  })
  it('the knob turns a leaf inside a turn wrapper, in whole degrees, Shift in 15 degree steps; the selection follows', () => {
    const h = page([R], { sel: at(0) })
    h.drag({ x: 120, y: 76 }, { x: 154, y: 110 })
    expect(h.root()).toEqual([node('G', { a: [120, 110], r: 90 }, [R])])
    expect(h.state().selection).toEqual(at(0, 0))
    expect(h.state().past).toHaveLength(1)
    const s = page([R], { sel: at(0) })
    s.drag({ x: 120, y: 76 }, { x: 150, y: 90 }, { shiftKey: true })
    expect(s.root()[0].attrs.r).toBe(60)
  })
  it('turns the sense under a mirrored group, so the turn on screen follows the pointer; refuses under an uneven scale', () => {
    // x' = 300 - x: the R's knob is at (180, 76) on screen, about its centre (180, 110); dragged a quarter clockwise.
    const h = page([node('G', { t: [300, 0], s: [-1, 1] }, [R])], { sel: at(0, 0) })
    h.drag({ x: 180, y: 76 }, { x: 214, y: 110 })
    expect(h.root()[0].c).toEqual([node('G', { a: [120, 110], r: -90 }, [R])])
    const uneven = page([node('G', { s: [2, 1] }, [R])], { sel: at(0, 0) })
    uneven.drag({ x: 240, y: 76 }, { x: 280, y: 110 })
    expect(uneven.root()[0].c![0]).toBe(R)
    expect(uneven.notes).toEqual(['the group above scales unevenly: turn that group instead'])
  })
  it('Ctrl/Cmd turns freely; Shift steps the r written onto multiples of 15, not the turn from the press', () => {
    const free = page([R], { sel: at(0) })
    free.drag({ x: 120, y: 76 }, { x: 150, y: 90 }, { ctrlKey: true })
    expect(free.root()[0].attrs.r).toBeCloseTo(56.31, 2)
    // A wrapper at r=7: the knob is 34 px from the pivot (120, 110), 7 degrees past straight up; dragged 20 degrees on,
    // r lands on 30 (27 rounded), not 22 (7 + 15).
    const h = page([node('G', { a: [120, 110], r: 7 }, [R])], { sel: at(0, 0) })
    const on = (deg: number) => ({ x: 120 + 34 * Math.cos(deg * Math.PI / 180), y: 110 + 34 * Math.sin(deg * Math.PI / 180) })
    h.drag(on(-83), on(-63), { shiftKey: true })
    expect(h.root()[0].attrs.r).toBe(30)
  })
  it('a turn step refused (t would leave float32) keeps the last step shown, and says why at release only if it was the last', () => {
    // A wrapper whose a sits near float32's end: a quarter turn writes t past it, a tenth of one does not.
    const far = () => page([node('G', { a: [-3.4e38, -3.4e38], r: 0 }, [R])], { sel: at(0, 0) })
    const h = far()
    h.drag({ x: 120, y: 76 }, { x: 154, y: 110 })
    expect(h.root()[0].attrs.r).toBe(0)
    expect(h.notes).toEqual(['the value left float32'])
    const back = far()
    back.down({ x: 120, y: 76 })
    back.move({ x: 154, y: 110 })
    back.move({ x: 126, y: 76 })
    back.up({ x: 126, y: 76 })
    expect(back.root()[0].attrs.r).toBe(10)
    expect(back.notes).toEqual([])
  })
  it('says when a clip stays behind a resize or a turn, as a move does', () => {
    const clipped = node('R', { x: 100, y: 100, w: 40, h: 20, clip: 'k' })
    const h = page([clipped], { sel: at(0) })
    h.drag({ x: 140, y: 120 }, { x: 160, y: 130 })
    expect(h.notes).toEqual(['clip k does not follow a resize'])
    const t = page([clipped], { sel: at(0) })
    t.drag({ x: 120, y: 76 }, { x: 154, y: 110 })
    expect(t.notes).toEqual(['clip k does not follow a turn'])
  })
  it('a corner keeps a circle round against the opposite corner; Alt about its centre', () => {
    const h = page([C], { sel: at(0) })
    h.drag({ x: 210, y: 210 }, { x: 240, y: 220 }, { ctrlKey: true })
    expect(h.root()[0].attrs).toEqual({ cx: 210, cy: 210, rx: 20 })
    const alt = page([C], { sel: at(0) })
    alt.drag({ x: 210, y: 210 }, { x: 240, y: 220 }, { ctrlKey: true, altKey: true })
    expect(alt.root()[0].attrs).toEqual({ cx: 200, cy: 200, rx: 30 })
  })
  it('a T with no box moves from a press at its anchor: a point offers no handles', () => {
    const t = node('T', { x: 100, y: 100, text: 'hi' })
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [t] }, { pick: () => at(0), sel: at(0) })
    h.drag({ x: 100, y: 100 }, { x: 110, y: 105 })
    expect(h.root()[0].attrs).toEqual({ x: 110, y: 105, text: 'hi' })
  })
  it('a double click on a curve opens the points tool; two slow clicks do not', () => {
    const h = page([node('SP', { p: [0, 0, 50, 50, 100, 0] })], { sel: at(0) })
    h.click({ x: 50, y: 30 })
    expect(h.ctx.tool()).toBe('select')
    h.click({ x: 50, y: 30 })
    expect(h.ctx.tool()).toBe('select')
    h.click({ x: 50, y: 30 }, { double: true })
    expect(h.ctx.tool()).toBe('points')
  })
  it('a double click inside a selected group that cannot move enters and selects the child (M1)', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('G', { t: ['=sin(t)', 0] }, [R])] }, { pick: () => at(0, 0), sel: at(0) })
    h.click({ x: 120, y: 110 })
    h.click({ x: 120, y: 110 }, { double: true })
    expect(h.state().selection).toEqual(at(0, 0))
  })
})
