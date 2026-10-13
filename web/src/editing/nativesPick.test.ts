// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { Scene } from '../model/scene'
import { selected } from '../model/store'
import { node } from '../model/testing'
import { instance } from '../widgets/testing'
import { harness } from './testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { worldBox } from './bounds'
import { putWidget, widgetAt } from '../widgets/core'
import { vanillaPlus } from '../theme/vanillaPlus'

const scene = (): Scene => ({ header: { w: 460, h: 460 }, defs: [], root: [
  node('G', { id: 'select_plant' }, [node('G', { id: 'potato' }, [node('R', { x: 10, y: 10, w: 160, h: 160 })])]),
] })
const icon = () => ({ ...instance('icon', { x: 50, y: 50, w: 30, h: 30 }), group: 'potato' })
const at = { x: 65, y: 65 }, ns = { pageId: 'p1', path: [], native: 'ico1' }
const plain = (root: Scene['root'] = []): Scene => ({ header: { w: 460, h: 460 }, defs: [], root })
const rsel = { pageId: 'p1', path: [0] }
const refs = (h: ReturnType<typeof harness>) => h.ctx.page().natives!
const overlay = (h: ReturnType<typeof harness>) => renderToStaticMarkup(h.router.overlay({ zoom: 1, pan: { x: 0, y: 0 }, frame: h.ctx.frame() }))

describe('native group-first picking through the canvas router', () => {
  it('hits the native before the frame and promotes it to its root group', () => {
    const h = harness(scene(), { natives: [icon()], pick: () => ({ pageId: 'p1', path: [0, 0, 0] }) })
    h.click(at)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0] })
    h.click(at, { double: true })
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0, 0] })
    h.click(at, { double: true })
    expect(h.state().selection).toEqual(ns)
    expect(h.state().entered).toEqual({ pageId: 'p1', path: [0, 0] })
  })
  it('deep picking selects the icon and enters its holder', () => {
    const h = harness(scene(), { natives: [icon()] })
    h.click(at, { ctrlKey: true })
    expect(h.state().selection).toEqual(ns)
    expect(h.state().entered).toEqual({ pageId: 'p1', path: [0, 0] })
  })
  it('a page native leaves the entered card and is picked without a frame hit', () => {
    const h = harness(scene(), { natives: [instance('icon', { x: 50, y: 50, w: 30, h: 30 })] })
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 0] })
    h.click(at)
    expect(h.state().selection).toEqual(ns)
    expect(h.state().entered).toBeNull()
  })
  it('a selected native survives a plain press even with nothing entered', () => {
    const h = harness(scene(), { natives: [icon()], sel: ns })
    h.click(at)
    expect(selected(h.state())).toEqual([ns])
  })
  it('keeps a selected scene member deeper than the promoted native hit', () => {
    const sel = { pageId: 'p1', path: [0, 0] }
    const h = harness(scene(), { natives: [icon()], sel })
    expect(h.ctx.pick(at)).toEqual({ target: sel })
  })
  it.each(['hidden', 'lock', 'holder lock'] as const)('sees through %s to the frame shape', kind => {
    const s = scene(), ref = icon()
    if (kind === 'holder lock') s.root[0].c![0].comments = ['lock']
    else Object.assign(ref, { [kind]: true })
    const shape = { pageId: 'p1', path: [1] }
    s.root.push(node('R', { x: 50, y: 50, w: 30, h: 30 }))
    const h = harness(s, { natives: [ref], pick: () => shape })
    h.click(at)
    expect(h.state().selection).toEqual(shape)
  })
})

describe('natives selected as canvas elements', () => {
  it.each(['points', 'gradient'])('%s picks the vector shape beneath a native and keeps its tool', tool => {
    const s = plain([node('G', { id: 'card' }, [node('Y', { p: [10, 10, 120, 10, 65, 120], f: '#fff' })])])
    const h = harness(s, { natives: [instance('icon', { x: 50, y: 50, w: 30, h: 30 })],
      pick: () => ({ pageId: 'p1', path: [0, 0] }) })
    h.ctx.setTool(tool)
    h.click(at)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0, 0] })
    expect(h.state().entered).toEqual({ pageId: 'p1', path: [0] })
    expect(h.ctx.tool()).toBe(tool)
  })
  it('Points Alt click inserts into the vector segment under an icon while a native is selected', async () => {
    const s = plain([node('Y', { p: [10, 65, 120, 65, 120, 120] })])
    const h = harness(s, { sel: ns, natives: [instance('icon', { x: 50, y: 50, w: 30, h: 30 })], pick: () => rsel })
    h.ctx.setTool('points')
    h.click(at, { altKey: true }); await h.settle()
    expect(h.state().selection).toEqual(rsel)
    expect(h.root()[0].attrs.p).toEqual([10, 65, 65, 65, 120, 65, 120, 120])
    expect(h.ctx.tool()).toBe('points')
  })
  it('Ctrl Shift click on a node child leaves its selected group unchanged', () => {
    const child = { pageId: 'p1', path: [0, 0] }
    const h = harness(plain([node('G', {}, [node('R', { x: 40, y: 40, w: 60, h: 60 })])]), { sel: rsel, pick: () => child })
    h.click(at, { ctrlKey: true, shiftKey: true })
    expect(selected(h.state())).toEqual([rsel])
  })
  it.each(['own', 'holder'])('a native hidden by %s cannot be resized from its selected handle', kind => {
    const ref = { ...instance('icon', { x: 50, y: 50, w: 30, h: 30 }), ...(kind === 'own' ? { hidden: true as const } : { group: 'card' }) }
    const root = kind === 'holder' ? [node('G', { id: 'card', v: 0 }, [node('R')])] : []
    const h = harness(plain(root), { sel: ns, natives: [ref] })
    h.drag({ x: 80, y: 65 }, { x: 100, y: 65 })
    expect(refs(h)[0]).toBe(ref)
    expect(h.state().past).toHaveLength(0)
  })
  it('a mixed canvas drag leaves a directly selected hidden native where it was', () => {
    const hidden = { ...instance('icon', { x: 200, y: 100, w: 20, h: 20 }), hidden: true as const }
    const h = harness(plain([node('R', { x: 100, y: 100, w: 30, h: 30 })]), { sel: rsel, also: [ns], natives: [hidden], pick: () => rsel })
    h.drag({ x: 115, y: 115 }, { x: 130, y: 115 }, { ctrlKey: true })
    expect(h.root()[0].attrs.x).toBe(115)
    expect(refs(h)[0]).toBe(hidden)
  })
  it('mixed-set resize ignores a selected hidden native in its frame and its transform', () => {
    const hidden = { ...instance('icon', { x: 300, y: 300, w: 20, h: 20 }), hidden: true as const }
    const h = harness(plain([node('R', { x: 100, y: 100, w: 30, h: 30 })]), { sel: rsel, also: [ns], natives: [hidden], pick: () => rsel })
    h.drag({ x: 130, y: 115 }, { x: 145, y: 115 }, { ctrlKey: true })
    expect(h.root()[0].attrs).toMatchObject({ x: 100, y: 100, w: 45, h: 30 })
    expect(refs(h)[0]).toBe(hidden)
  })
  it('vector-only context picking ignores the native but retains the deep scene enter intent', () => {
    const hit = { pageId: 'p1', path: [0, 0, 0] }
    const h = harness(scene(), { natives: [icon()], pick: () => hit })
    expect(h.ctx.pick(at, true, { natives: false })).toEqual({ target: hit, enter: { type: 'enter', pageId: 'p1', path: [0, 0] } })
  })
  it('rectangle drawing snaps its edge to a native', () => {
    const h = harness(plain(), { natives: [instance('icon', { x: 103, y: 200, w: 20, h: 20 })] })
    h.ctx.setTool('rect')
    h.drag({ x: 10, y: 10 }, { x: 99, y: 76 })
    expect(h.root()[0].attrs).toMatchObject({ x: 10, y: 10, w: 93, h: 66 })
  })
  it('pen anchors snap to a native edge through the active canvas tool', async () => {
    const h = harness(plain(), { natives: [instance('icon', { x: 103, y: 200, w: 20, h: 20 })] })
    h.ctx.setTool('pen')
    h.click({ x: 10, y: 10 }); h.click({ x: 99, y: 76 }); h.key({ key: 'Enter' })
    await h.settle()
    expect(h.root()[0].attrs.d).toBe('M10 10 L103 76')
  })
  it('the points tool snaps a dragged vertex to a native edge', () => {
    const h = harness(plain([node('Y', { p: [10, 10, 50, 10, 50, 50] })]), { sel: rsel,
      natives: [instance('icon', { x: 103, y: 200, w: 20, h: 20 })] })
    h.ctx.setTool('points')
    h.drag({ x: 50, y: 10 }, { x: 99, y: 76 })
    expect(h.root()[0].attrs.p).toEqual([10, 10, 103, 76, 50, 50])
  })
  it('Shift click adds a native beside a scene member and toggles it back out', () => {
    const h = harness(plain([node('R', { x: 200, y: 200, w: 20, h: 20 })]), { natives: [instance('icon', { x: 50, y: 50, w: 30, h: 30 })], sel: rsel })
    h.click(at, { shiftKey: true })
    expect(selected(h.state())).toEqual([rsel, ns])
    h.click(at, { shiftKey: true })
    expect(selected(h.state())).toEqual([rsel])
  })
  it('Shift deep-click replaces a selected holder with the native inside it', () => {
    const h = harness(scene(), { natives: [icon()], sel: { pageId: 'p1', path: [0, 0] } })
    h.click(at, { shiftKey: true, ctrlKey: true })
    expect(selected(h.state())).toEqual([ns])
  })
  it.each([false, true])('marquee catches direct held natives using touch or enclose (enclose=%s)', enclose => {
    const h = harness(scene(), { natives: [icon(), { ...icon(), uid: 'hidden', hidden: true }, { ...icon(), uid: 'locked', lock: true }] })
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 0] })
    h.drag({ x: 40, y: 40 }, { x: 60, y: 60 }, { ctrlKey: enclose })
    expect(selected(h.state())).toEqual(enclose ? [] : [ns])
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 0] })
    h.drag({ x: 40, y: 40 }, { x: 90, y: 90 }, { ctrlKey: enclose })
    expect(selected(h.state())).toEqual([ns])
  })
  it('marquee at the page catches page natives and groups by their held native extent', () => {
    const s = plain([node('G', { id: 'card' }, [node('R', { x: 0, y: 0, w: 10, h: 10 })])])
    const h = harness(s, { natives: [{ ...instance('icon', { x: 50, y: 50, w: 30, h: 30 }), group: 'card' },
      { ...instance('icon', { x: 90, y: 50, w: 20, h: 30 }), uid: 'ico2' }] })
    h.drag({ x: 40, y: 40 }, { x: 120, y: 90 })
    expect(selected(h.state())).toEqual([rsel, { ...ns, native: 'ico2' }])
  })
  it('drags a mixed set by a shared whole delta, snaps to another native and draws its guide, with one undo', () => {
    const h = harness(plain([node('R', { x: 10, y: 100, w: 20, h: 20 })]), { sel: rsel, also: [ns], natives: [
      instance('icon', { x: 50, y: 100, w: 20, h: 20 }), { ...instance('icon', { x: 103, y: 200, w: 20, h: 20 }), uid: 'ico2' }] })
    const before = h.state().project
    h.down({ x: 60, y: 110 }); h.move({ x: 89, y: 110 })
    expect(h.root()[0].attrs.x).toBe(43)
    expect(refs(h)[0].params.x).toBe(83)
    expect(overlay(h)).toContain('x1="103"')
    h.up({ x: 89, y: 110 })
    expect(h.state().past).toHaveLength(1)
    h.ctx.dispatch({ type: 'undo' }); expect(h.state().project).toBe(before)
  })
  it('drags a lone native snapped to a scene edge and preserves untouched refs', () => {
    const fixed = { ...instance('icon', { x: 300, y: 200 }), uid: 'ico2' }
    const h = harness(plain([node('R', { x: 103, y: 200, w: 20, h: 20 })]), { sel: ns,
      natives: [instance('icon', { x: 50, y: 100, w: 20, h: 20 }), fixed] })
    h.drag({ x: 60, y: 110 }, { x: 89, y: 110 })
    expect(refs(h)[0].params.x).toBe(83)
    expect(refs(h)[1]).toBe(fixed)
    expect(h.state().past).toHaveLength(1)
  })
  it('a group-first drag from its icon moves the card and icon together in one undo', () => {
    const h = harness(scene(), { natives: [icon()] })
    h.drag(at, { x: 85, y: 75 }, { ctrlKey: false })
    expect(h.root()[0].attrs.t).toEqual([20, 10])
    expect(refs(h)[0].params).toMatchObject({ x: 70, y: 60 })
    expect(h.state().past).toHaveLength(1)
  })
  it('resizes a native east edge in whole units, snapping it to a scene edge and stopping at one', () => {
    const h = harness(plain([node('R', { x: 103, y: 200, w: 20, h: 20 })]), { sel: ns,
      natives: [instance('icon', { x: 50, y: 100, w: 20, h: 20 })] })
    h.drag({ x: 70, y: 110 }, { x: 99, y: 110 })
    expect(refs(h)[0].params).toMatchObject({ x: 50, y: 100, w: 53, h: 20 })
    h.drag({ x: 103, y: 110 }, { x: 30, y: 110 }, { ctrlKey: true })
    expect(refs(h)[0].params.w).toBe(1)
  })
  it.each([false, true])('Shift corner resize keeps native ratio, including centre resize (alt=%s)', alt => {
    const h = harness(plain(), { sel: ns, natives: [instance('icon', { x: 100, y: 100, w: 40, h: 20 })] })
    h.drag({ x: 140, y: 120 }, { x: 160, y: 120 }, { shiftKey: true, altKey: alt, ctrlKey: true })
    expect(refs(h)[0].params).toMatchObject(alt ? { x: 80, y: 90, w: 80, h: 40 } : { x: 100, y: 100, w: 60, h: 30 })
  })
  it('mixed-set resize maps native boxes with scene members and keeps one history entry', () => {
    const h = harness(plain([node('R', { x: 100, y: 100, w: 20, h: 20 })]), { sel: rsel, also: [ns],
      natives: [instance('icon', { x: 140, y: 100, w: 20, h: 20 })] })
    h.drag({ x: 160, y: 120 }, { x: 220, y: 140 }, { ctrlKey: true })
    expect(h.root()[0].attrs).toMatchObject({ x: 100, y: 100, w: 40, h: 40 })
    expect(refs(h)[0].params).toMatchObject({ x: 180, y: 100, w: 40, h: 40 })
    expect(h.state().past).toHaveLength(1)
  })
  it('native members use the same clamped set scale as a widget at its minimum', () => {
    const base = putWidget(plain(), instance('button', { x: 100, y: 100, w: 100, h: 100 }), vanillaPlus)
    const h = harness(base, { sel: rsel, also: [ns], natives: [instance('icon', { x: 300, y: 100, w: 100, h: 100 })] })
    h.drag({ x: 400, y: 200 }, { x: 130, y: 110 }, { shiftKey: true, ctrlKey: true })
    const button = widgetAt(h.scene(), [0], vanillaPlus)!
    expect(refs(h)[0].params.w).toBe(button.params.w)
    expect(refs(h)[0].params.h).toBe(button.params.h)
  })
  it('a locked selected native has no active handles to intercept a press on the shape underneath', () => {
    const h = harness(plain([node('R', { x: 100, y: 100, w: 30, h: 30 })]), { sel: ns, pick: () => rsel,
      natives: [{ ...instance('icon', { x: 100, y: 100, w: 20, h: 20 }), lock: true }] })
    h.click({ x: 120, y: 110 })
    expect(h.state().selection).toEqual(rsel)
  })
  it('mixed-set turn moves a native centre but keeps its box upright, naming it on commit', () => {
    const h = harness(plain([node('R', { x: 100, y: 100, w: 20, h: 20 })]), { sel: rsel, also: [ns],
      natives: [instance('icon', { x: 140, y: 100, w: 20, h: 20 })] })
    h.drag({ x: 130, y: 76 }, { x: 164, y: 110 })
    const b = worldBox(h.scene(), [0, 0])!
    expect(b.x).toBeCloseTo(120); expect(b.y).toBeCloseTo(80); expect(b.w).toBeCloseTo(20); expect(b.h).toBeCloseTo(20)
    expect(refs(h)[0].params).toMatchObject({ x: 120, y: 120, w: 20, h: 20 })
    expect(h.notes).toContain('ico1 stay upright: natives do not turn')
  })
  it('a turn of a group holding a native uses its union pivot and gives the upright note', () => {
    const h = harness(plain([node('G', { id: 'card' }, [node('R', { x: 100, y: 100, w: 20, h: 20 })])]), { sel: rsel,
      natives: [{ ...instance('icon', { x: 140, y: 100, w: 20, h: 20 }), group: 'card' }] })
    h.drag({ x: 130, y: 76 }, { x: 164, y: 110 })
    expect(refs(h)[0].params).toMatchObject({ x: 120, y: 120, w: 20, h: 20 })
    expect(h.notes).toContain('ico1 stay upright: natives do not turn')
  })
  it('skips a locked selected native during a mixed move and says locked', () => {
    const locked = { ...instance('icon', { x: 140, y: 100, w: 20, h: 20 }), lock: true as const }
    const h = harness(plain([node('R', { x: 100, y: 100, w: 20, h: 20 })]), { sel: rsel, also: [ns], natives: [locked], pick: () => rsel })
    h.drag({ x: 110, y: 110 }, { x: 125, y: 110 }, { ctrlKey: true })
    expect(refs(h)[0]).toBe(locked)
    expect(h.root()[0].attrs.x).toBe(115)
    expect(h.notes.join('; ')).toContain('locked')
  })
})
