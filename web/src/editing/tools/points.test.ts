// @vitest-environment happy-dom
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SrcNode } from '../../model/scene'
import { node } from '../../model/testing'
import { pointsOf } from '../points'
import { harness } from '../testing'
import { mount, run } from '../../testing'
import { menusOf, type MenuActions } from '../../editor/shell/menus'
import { COMMANDS } from '../registry'

const at = (...path: number[]) => ({ pageId: 'p1', path })
const scene = (...root: SrcNode[]) => ({ header: { w: 460, h: 460 }, defs: [], root })
/** The overlay at zoom 1 (CSS px = design units here): the point handles and an open drag's guides. */
const html = (h: ReturnType<typeof harness>) => renderToStaticMarkup(h.router.overlay({ zoom: 1, frame: null }) as ReactElement)
const curve = () => {
  const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('SP', { p: [0, 0, 50, 50, 100, 0] }), node('R', { x: 300, y: 300, w: 10, h: 10 })] },
    { sel: at(0), pick: px => px.x >= 300 ? at(1) : null })
  h.ctx.setTool('points')
  return h
}

describe('the points tool', () => {
  it('adds the selected segment midpoint through the same button menu as Delete point', async () => {
    const h = harness(scene(node('P', { d: 'M20 20 L100 20 L100 100' })), { sel: at(0) })
    h.ctx.setTool('points')
    h.click({ x: 40, y: 20 })
    const noop = () => {}, actions: MenuActions = {
      project: { name: '', newFromTemplate: noop, openFile: noop, openText: noop, saveJson: noop, shareLink: noop, fonts: noop, exportScript: noop, adoptionReport: null },
      view: { navigable: true, fit: noop, actual: noop, fitSelection: null, pan: noop, source: true, setSource: noop, play: false, setPlay: noop },
      help: { shortcuts: noop, openExample: noop, scripts: false, setScripts: noop, compare: false, setCompare: noop },
    }
    const add = menusOf(h.ctx, '10', actions).find(m => m.id === 'edit')!.items.find(i => i.kind === 'item' && i.id === 'point-add')!
    expect(add.kind).toBe('item')
    if (add.kind !== 'item') throw new Error('Add point missing')
    expect(add.disabled).toBe(false)
    add.run(); await h.settle()
    expect(h.root()[0].attrs.d).toBe('M20 20 L60 20 L100 20 L100 100')
    expect(h.state().past).toHaveLength(1)
    h.key({ key: 'z', ctrlKey: true }); await h.settle()
    expect(h.root()[0].attrs.d).toBe('M20 20 L100 20 L100 100')
  })
  it.each(['locked', 'changed'])('keeps a %s selected segment unchanged when Add point runs', async kind => {
    const path = { ...node('P', { d: 'M20 20 L100 20' }), ...(kind === 'locked' && { comments: ['lock'] }) }
    const h = harness(scene(path), { sel: at(0) })
    h.ctx.setTool('points'); h.click({ x: 40, y: 20 })
    if (kind === 'changed') h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: node('P', { d: 'M20 20 L120 20' }) })
    const before = h.scene(), history = h.state().past.length
    await COMMANDS.find(c => c.id === 'point-add')!.run(h.ctx)
    expect(h.scene()).toBe(before)
    expect(h.state().past).toHaveLength(history)
    expect(h.status()).toContain(kind)
  })
  it('picks a nested polyline directly and stays in Points without entering first', () => {
    const h = harness(scene(node('G', {}, [node('L', { p: [100, 100, 200, 100] })])), { pick: () => at(0, 0) })
    h.ctx.setTool('points')
    h.click({ x: 150, y: 100 })
    expect(h.state().selection).toEqual(at(0, 0))
    expect(h.state().entered).toEqual(at(0))
    expect(h.ctx.tool()).toBe('points')
    h.drag({ x: 200, y: 100 }, { x: 210, y: 100 })
    expect(h.root()[0].c![0].attrs.p).toEqual([100, 100, 210, 100])
    expect(h.root()[0].attrs).toEqual({})
    expect(h.state().past).toHaveLength(1)
  })
  it('drags one point, snapped to whole units, as one undo step', () => {
    const h = curve()
    h.drag({ x: 50, y: 50 }, { x: 60.4, y: 40.2 })
    expect(h.root()[0].attrs.p).toEqual([0, 0, 60, 40, 100, 0])
    expect(h.state().past).toHaveLength(1)
    const free = curve()
    free.drag({ x: 50, y: 50 }, { x: 60.4, y: 40.2 }, { ctrlKey: true })
    expect((free.root()[0].attrs.p as number[])[2]).toBeCloseTo(60.4, 4)
  })
  it('a press off the points selects what it hits; on a shape without points it goes back to Select', () => {
    const h = curve()
    h.click({ x: 305, y: 305 })
    expect(h.state().selection).toEqual(at(1))
    expect(h.ctx.tool()).toBe('select')
  })
  it('a press on another line, polygon, curve or path selects it and stays; on nothing it goes back to Select', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('L', { p: [0, 0, 10, 0] }), node('P', { d: 'M200 200 h20' })] },
      { sel: at(0), pick: px => px.x >= 200 ? at(1) : null })
    h.ctx.setTool('points')
    h.click({ x: 210, y: 200 })
    expect([h.state().selection, h.ctx.tool()]).toEqual([at(1), 'points'])
    h.click({ x: 100, y: 100 })
    expect([h.state().selection, h.ctx.tool()]).toEqual([null, 'select'])
  })
  it('a drag out and back leaves the node as it was and no undo step', () => {
    const h = curve(), was = h.root()[0]
    h.down({ x: 50, y: 50 })
    h.move({ x: 70, y: 70 })
    expect(h.root()[0].attrs.p).toEqual([0, 0, 70, 70, 100, 0])
    h.move({ x: 50, y: 50 })
    h.up({ x: 50, y: 50 })
    expect(h.root()[0]).toBe(was)
    expect(h.state().past).toHaveLength(0)
  })
  it('a locked node keeps its points and says why', () => {
    const SP = { ...node('SP', { p: [0, 0, 50, 50, 100, 0] }), comments: ['lock'] }
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [SP] }, { sel: at(0) })
    h.ctx.setTool('points')
    h.drag({ x: 50, y: 50 }, { x: 70, y: 70 })
    expect(h.root()[0]).toBe(SP)
    expect([h.state().past.length, h.status()]).toEqual([0, 'locked'])
  })
  it('moves a point under a scaled group in its own units, and a path point in its own command letters', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('G', { s: [2, 2] }, [node('SP', { p: [0, 0, 50, 50] })]),
      node('P', { d: 'M300 0 l40 0 q20 20 40 0 h40' })] }, { sel: at(0, 0) })
    h.ctx.setTool('points')
    h.drag({ x: 100, y: 100 }, { x: 121, y: 79 })
    expect(h.root()[0].c![0].attrs.p).toEqual([0, 0, 60.5, 39.5])
    h.ctx.dispatch({ type: 'select', selection: at(1) })
    h.drag({ x: 340, y: 0 }, { x: 350, y: 10 })
    expect(h.root()[1].attrs.d).toBe('M300 0 l50 10 q10 10 30 -10 h40')
  })
  it('draws the selection\'s points at the zoom, an H or V point as a square', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('P', { d: 'M10 20 H30 l5 5' })] }, { sel: at(0) })
    h.ctx.setTool('points')
    const html = renderToStaticMarkup(h.router.overlay({ zoom: 2, frame: null }) as ReactElement)
    expect(html).toContain('class="vb-selection"')
    expect(html).toContain('<circle class="vb-handle" cx="20" cy="40" r="4">')
    expect(html).toContain('<rect class="vb-handle" x="57" y="37" width="6" height="6">')
    expect(html).toContain('cx="70" cy="50"')
    h.ctx.dispatch({ type: 'select', selection: null })
    expect(renderToStaticMarkup(h.router.overlay({ zoom: 2, frame: null }) as ReactElement)).not.toContain('vb-handle')
  })
  it('Esc mid-drag puts the point back and stays; Esc then goes back to Select; key A picks the tool', () => {
    const h = curve(), was = h.root()[0]
    h.down({ x: 50, y: 50 })
    h.move({ x: 70, y: 70 })
    h.key({ key: 'Escape' })
    expect(h.root()[0]).toBe(was)
    expect(h.ctx.tool()).toBe('points')
    h.up({ x: 70, y: 70 })
    expect(h.state().past).toHaveLength(0)
    h.key({ key: 'Escape' })
    expect(h.ctx.tool()).toBe('select')
    h.key({ key: 'a' })
    expect(h.ctx.tool()).toBe('points')
  })
  it('shows and drags the points of a selection on the page shown only', () => {
    const h = harness(scene(node('L', { p: [0, 0, 10, 0] })), { sel: at(0) })
    h.ctx.setTool('points')
    h.ctx.dispatch({ type: 'addPage' })   // the new page is shown; the selection stays on p1
    const other = h.ctx.page().id
    h.ctx.dispatch({ type: 'editScene', pageId: other, scene: scene(node('L', { p: [0, 0, 10, 0] })) })
    expect(html(h)).not.toContain('vb-handle')
    h.drag({ x: 10, y: 0 }, { x: 20, y: 0 })
    expect(h.ctx.page().scene.root[0].attrs.p).toEqual([0, 0, 10, 0])
  })
  it('a press on a line, polygon, curve or path whose points cannot be edited says why and writes nothing', () => {
    const Y = node('Y', { p: [10, 10, 100, '=t'] })
    const h = harness(scene(Y), { sel: at(0), pick: () => at(0) })
    h.ctx.setTool('points')
    h.click({ x: 10, y: 10 })
    expect([h.root()[0], h.status(), h.ctx.tool()]).toEqual([Y, 'p is not a list of numbers', 'points'])
  })
})

describe('the points tool snaps', () => {
  it('to another node\'s edge, with a guide through the point while the drag is open', () => {
    const h = harness(scene(node('L', { p: [0, 200, 50, 250] }), node('R', { x: 100, y: 0, w: 20, h: 20 })), { sel: at(0) })
    h.ctx.setTool('points')
    h.down({ x: 50, y: 250 })
    h.move({ x: 96.2, y: 250.4 })
    expect(h.root()[0].attrs.p).toEqual([0, 200, 100, 250])
    expect(html(h)).toContain('<svg class="vb-guides" aria-hidden="true"><line x1="100" y1="0" x2="100" y2="250"></line></svg>')
    h.up({ x: 96.2, y: 250.4 })
    expect(html(h)).not.toContain('vb-guides')
  })
  it('to the dragged node\'s other points, not to its own box or its own place', () => {
    const h = harness(scene(node('L', { p: [0, 0, 40, 40, 70, 10, 100, 0] })), { sel: at(0) })
    h.ctx.setTool('points')
    h.drag({ x: 40, y: 40 }, { x: 43.4, y: 44.6 })      // 3.4 and 4.6 from where it was: it moves
    expect(h.root()[0].attrs.p).toEqual([0, 0, 43, 45, 70, 10, 100, 0])
    h.drag({ x: 43, y: 45 }, { x: 52.4, y: 60.3 })      // 2.4 from its box's centre x = 50: no snap
    expect(h.root()[0].attrs.p).toEqual([0, 0, 52, 60, 70, 10, 100, 0])
    h.drag({ x: 52, y: 60 }, { x: 72.5, y: 58.3 })      // 2.5 from the next point's x = 70
    expect(h.root()[0].attrs.p).toEqual([0, 0, 70, 58, 70, 10, 100, 0])
  })
  it('an H or V point only along its axis, with no guide across it', () => {
    const h = harness(scene(node('P', { d: 'M0 0 H8' }), node('R', { x: 30, y: 100, w: 10, h: 10 })), { sel: at(0) })
    h.ctx.setTool('points')
    h.down({ x: 8, y: 0 })
    h.move({ x: 20, y: 97 })   // 3 from the R's top: no guide there, the point stays at y = 0
    expect(h.root()[0].attrs.d).toBe('M0 0 H20')
    expect(html(h)).not.toContain('vb-guides')
    h.move({ x: 27, y: 97 })
    expect(h.root()[0].attrs.d).toBe('M0 0 H30')
    expect(html(h)).toContain('<svg class="vb-guides" aria-hidden="true"><line x1="30" y1="0" x2="30" y2="110"></line></svg>')
    h.up({ x: 27, y: 97 })
  })
  it('a V point under a quarter turn along the page\'s x; turned off the page\'s axes, not at all', () => {
    const h = harness(scene(node('G', { t: [200, 200], r: 90 }, [node('P', { d: 'M0 0 V8' })]), node('R', { x: 170, y: 300, w: 10, h: 10 })),
      { sel: at(0, 0) })
    h.ctx.setTool('points')
    h.down({ x: 192, y: 200 })
    h.move({ x: 171.5, y: 229 })   // 1 from the page's middle y = 230: no guide there
    expect(h.root()[0].c![0].attrs.d).toBe('M0 0 V30')
    expect(html(h)).toContain('<svg class="vb-guides" aria-hidden="true"><line x1="170" y1="200" x2="170" y2="310"></line></svg>')
    h.up({ x: 171.5, y: 229 })
    const g = harness(scene(node('G', { t: [200, 200], r: 45 }, [node('P', { d: 'M0 0 H10' })])), { sel: at(0, 0) })
    g.ctx.setTool('points')
    const c = 10 * Math.SQRT1_2   // the H point (10, 0) is at (200 + c, 200 + c)
    g.drag({ x: 200 + c, y: 200 + c }, { x: 200 + 2 * c + 3, y: 200 + 2 * c - 3 })   // 10 along its axis, 4.24 across
    expect(g.root()[0].c![0].attrs.d).toBe('M0 0 H20')
  })
  it('not to an H or V point\'s other coordinate when it comes from the dragged point; its own one stays a target', () => {
    // The V's x is the H end's: it would be a target at the point's own place, so a drag of under 8 would stick.
    const h = harness(scene(node('P', { d: 'M0 0 H100 V50 H0 Z' })), { sel: at(0) })
    h.ctx.setTool('points')
    h.drag({ x: 100, y: 0 }, { x: 103, y: 0 })
    expect(h.root()[0].attrs.d).toBe('M0 0 H103 V50 H0 Z')
    // The H's y is the L end's; its x does not move with it.
    const l = harness(scene(node('P', { d: 'M0 0 L50 50 H100' })), { sel: at(0) })
    l.ctx.setTool('points')
    l.down({ x: 50, y: 50 })
    l.move({ x: 50, y: 53 })
    expect(l.root()[0].attrs.d).toBe('M0 0 L50 53 H100')
    expect(html(l)).not.toContain('vb-guides')
    l.move({ x: 94, y: 53 })
    expect(l.root()[0].attrs.d).toBe('M0 0 L100 53 H100')
    l.up({ x: 94, y: 53 })
  })
  it('under a quarter turn, not on the page axis the following coordinate runs along; turned off the axes, on neither', () => {
    // r 90: (x, y) is at (200 - y, 200 + x). The H end (100, 50) is at (150, 300); its local y, so its page x, follows.
    const h = harness(scene(node('G', { t: [200, 200], r: 90 }, [node('P', { d: 'M0 0 L50 50 H100' })])), { sel: at(0, 0) })
    h.ctx.setTool('points')
    h.down({ x: 150, y: 250 })
    h.move({ x: 147, y: 250 })
    expect(h.root()[0].c![0].attrs.d).toBe('M0 0 L50 53 H100')
    h.move({ x: 147, y: 296 })
    expect(h.root()[0].c![0].attrs.d).toBe('M0 0 L100 53 H100')
    h.up({ x: 147, y: 296 })
    // r 30: the H end's page x and y both follow the L end, so neither is a target (they would be at 261.6, 293.3).
    const g = harness(scene(node('G', { t: [200, 200], r: 30 }, [node('P', { d: 'M0 0 L50 50 H100' })])), { sel: at(0, 0) })
    g.ctx.setTool('points')
    const c = Math.cos(Math.PI / 6), to = (x: number, y: number) => ({ x: 200 + c * x - y / 2, y: 200 + x / 2 + c * y })
    g.drag(to(50, 50), { x: 258, y: 290 })
    const q = pointsOf(g.root()[0].c![0])![1], page = to(q.x, q.y)
    expect(page.x).toBeCloseTo(258, 2)
    expect(page.y).toBeCloseTo(290, 2)
  })
  it('not to another point at the dragged point\'s own place', () => {
    // A closed outline written with its first point again last.
    const h = harness(scene(node('Y', { p: [100, 100, 150, 120, 120, 160, 100, 100] })), { sel: at(0) })
    h.ctx.setTool('points')
    h.drag({ x: 100, y: 100 }, { x: 103, y: 104 })
    expect(h.root()[0].attrs.p).toEqual([103, 104, 150, 120, 120, 160, 100, 100])
  })
})
describe('point add/delete and mode controls', () => {
  it.each(['drag', 'add'])('surfaces a filled P crossing after a point %s without refusing the edit', async kind => {
    const d = kind === 'drag' ? 'M0 0 L100 0 L100 100 L0 100 Z' : 'M0 0 L100 100 L100 0 L0 100 Z'
    const h = harness(scene(node('P', { d, f: '#fff' })), { sel: at(0) }); h.ctx.setTool('points')
    if (kind === 'drag') h.drag({ x: 100, y: 0 }, { x: -20, y: 50 }, { ctrlKey: true })
    else h.click({ x: 25, y: 25 }, { altKey: true })
    await h.settle()
    expect(h.root()[0].attrs.d).not.toBe(d); expect(h.state().past).toHaveLength(1)
    expect(h.status()).toMatch(/warning: this P crosses itself/i)
  })
  it('Alt-click inserts a knot on a visible SP bulge at zoom 2', async () => {
    const h = harness(scene(node('SP', { p: [0, 0, 50, 50, 100, 0] })), { sel: at(0) })
    h.ctx.setView({ zoom: 2, pan: { x: 0, y: 0 } }); h.ctx.setTool('points')
    h.click({ x: 21.875, y: 28.125 }, { altKey: true }); await h.settle()
    expect(h.root()[0].attrs.p).toEqual([0, 0, 21.875, 28.125, 50, 50, 100, 0])
    expect(h.state().past).toHaveLength(1)
  })
  it('Delete removes the shared start of a pen-closed cubic instead of making an empty undo step', async () => {
    const h = harness(scene(node('P', { d: 'M0 0 C0 40 100 40 100 0 C100 -40 0 -40 0 0 Z', f: '#fff' })), { sel: at(0) })
    h.ctx.setTool('points'); h.click({ x: 0, y: 0 }); h.key({ key: 'Delete' }); await h.settle()
    expect(h.root()).toEqual([]); expect(h.state().past).toHaveLength(1)
  })
  it('Alt-click picks and adds on an unselected segment, including another nested path', async () => {
    const h = harness(scene(node('L', { p: [0, 0, 100, 0] }), node('G', { t: [50, 100] }, [node('P', { d: 'M0 0 L100 0' })])),
      { pick: px => px.y > 50 ? at(1, 0) : at(0) })
    h.ctx.setTool('points'); h.click({ x: 50, y: 0 }, { altKey: true }); await h.settle()
    expect(h.root()[0].attrs.p).toEqual([0, 0, 50, 0, 100, 0])
    h.click({ x: 100, y: 100 }, { altKey: true }); await h.settle()
    expect(h.root()[1].c![0].attrs.d).toBe('M0 0 L50 0 L100 0')
    expect(h.state().selection).toEqual(at(1, 0)); expect(h.state().past).toHaveLength(2)
  })
  it('Alt-click adds a point and Delete removes that point as checked undo steps', async () => {
    const h = harness(scene(node('L', { p: [0, 0, 100, 0] })), { sel: at(0) })
    h.ctx.setTool('points'); h.click({ x: 50, y: 0 }, { altKey: true }); await h.settle()
    expect(h.root()[0].attrs.p).toEqual([0, 0, 50, 0, 100, 0]); expect(h.state().past).toHaveLength(1)
    h.click({ x: 50, y: 0 }); h.key({ key: 'Delete' }); await h.settle()
    expect(h.root()[0].attrs.p).toEqual([0, 0, 100, 0]); expect(h.state().past).toHaveLength(2)
    h.click({ x: 100, y: 0 }); h.key({ key: 'Delete' }); await h.settle()
    expect(h.root()).toEqual([]); expect(h.state().past).toHaveLength(3)
  })
  it('splits a cubic at Alt-click and offers Corner/Smooth with keyboard alternatives', async () => {
    const h = harness(scene(node('P', { d: 'M0 0 C0 100 100 100 100 0' })), { sel: at(0) })
    h.ctx.setTool('points'); h.click({ x: 50, y: 75 }, { altKey: true }); await h.settle()
    expect(h.root()[0].attrs.d).toBe('M0 0 C0 50 25 75 50 75 C75 75 100 50 100 0')
    h.click({ x: 50, y: 75 })
    expect(html(h)).toContain('Corner'); expect(html(h)).toContain('Smooth')
    expect(html(h)).toContain('Smooth (Alt+Shift+S)')
    h.key({ key: 's', altKey: true, shiftKey: true, code: 'KeyS' }); await h.settle()
    expect(h.root()[0].attrs.d).toBe('M0 0 C0 50 25 75 50 75 C75 75 100 50 100 0')
    h.key({ key: 'c', altKey: true, code: 'KeyC' }); await h.settle()
    expect(h.root()[0].attrs.d).toBe('M0 0 C0 50 50 75 50 75 C50 75 100 50 100 0')
    expect(h.state().past).toHaveLength(2)
  })
  it('refuses locked, bound, rejected and stale point edits without deleting a node', async () => {
    const locked = { ...node('L', { p: [0, 0, 100, 0] }), comments: ['lock'] }
    const h = harness(scene(locked), { sel: at(0) }); h.ctx.setTool('points')
    h.click({ x: 50, y: 0 }, { altKey: true }); await h.settle(); expect(h.root()[0]).toBe(locked); expect(h.status()).toBe('locked')
    h.click({ x: 100, y: 0 }); h.key({ key: 'Delete' }); await h.settle(); expect(h.root()[0]).toBe(locked)
    const expr = node('P', { d: '$path' }), b = harness(scene(expr), { sel: at(0), pick: () => at(0) })
    b.ctx.setTool('points'); b.click({ x: 50, y: 0 }, { altKey: true }); await b.settle()
    expect(b.root()[0]).toBe(expr); expect(html(b)).not.toContain('Smooth')
    const reject = harness(scene(node('L', { p: [0, 0, 100, 0] })), { sel: at(0), verdict: () => ({ errors: [{ message: 'reject point', at: 0 }], traps: [] } as never) })
    reject.ctx.setTool('points'); reject.click({ x: 50, y: 0 }, { altKey: true }); await reject.settle()
    expect(reject.root()[0].attrs.p).toEqual([0, 0, 100, 0]); expect(reject.state().past).toHaveLength(0)
    const stale = harness(scene(node('L', { p: [0, 0, 100, 0] })), { sel: at(0) })
    stale.ctx.setTool('points'); stale.click({ x: 50, y: 0 }, { altKey: true })
    stale.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: scene(expr) }); await stale.settle()
    expect(stale.root()[0]).toBe(expr)
  })
  it('keeps the chosen anchor through Corner/Smooth button presses and repeated conversions', async () => {
    const h = harness(scene(node('P', { d: 'M0 0 L50 50 L100 0' })), { sel: at(0) })
    h.ctx.setTool('points'); h.click({ x: 50, y: 50 })
    const draw = () => createElement('div', { onPointerDown: () => h.down({ x: 0, y: 0 }), onPointerUp: () => h.up({ x: 0, y: 0 }) }, h.router.overlay({ zoom: 1, frame: null }))
    const ui = mount(draw())
    try {
      for (const label of ['Smooth', 'Corner', 'Smooth']) await run(async () => {
        const button = ui.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
        expect(button).not.toBeNull()
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); button.click()
        await h.settle(); ui.rerender(draw())
      })
      const d = h.root()[0].attrs.d as string
      expect(d).toMatch(/^M0 0 C0 0 .*50 50 C.*100 0 100 0$/)
      expect(h.state().past).toHaveLength(3)
    } finally { ui.unmount() }
  })
})
