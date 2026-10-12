// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newProject } from '../../model/project'
import type { SrcNode } from '../../model/scene'
import type { Selection } from '../../model/store'
import { node } from '../../model/testing'
import { mount } from '../../testing'
import history from '../commands/history'
import { colour, type Theme } from '../../theme'
import { neutral as slate } from '../../theme/neutral'
import { vanillaPlus } from '../../theme/vanillaPlus'
import { cornerBox, lookOf } from '../draw'
import { runCommand } from '../registry'
import { harness } from '../testing'
import type { Press } from '../types'
import path from './path'
import select from './select'
import { neutral } from '../../theme/testing'
import { linksOf, unlinked } from '../../theme/links'
import { COMMANDS } from '../registry'
import { loadDrawDefaults, saveDrawDefaults } from '../settings'
import { dressed } from '../draw'

it('saves closed and open spline defaults separately through storage', async () => {
  const closed = node('SP', { p: [0, 0, 10, 10, 20, 0], close: 1, f: '#ff0000', sh: [[0, 2, 2, 0, '#000000']] })
  const h = page([closed], { sel: { pageId: 'p1', path: [0] } })
  await COMMANDS.find(c => c.id === 'style.useAsDefault')!.run(h.ctx)
  let saved = ''
  const storage = { getItem: () => saved, setItem: (_: string, v: string) => { saved = v } }
  saveDrawDefaults(h.ctx.drawDefaults(), storage)
  const defaults = loadDrawDefaults(storage)
  expect(dressed(node('SP', { p: closed.attrs.p }), 'SP', vanillaPlus, defaults).attrs).toEqual({ p: closed.attrs.p, s: '#8E8E9E', sw: 2 })
  expect(dressed(closed, 'SPclosed', vanillaPlus, defaults).attrs.f).toBe('#ff0000')
  h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: node('SP', { p: closed.attrs.p, s: '#123456' }) })
  await COMMANDS.find(c => c.id === 'style.useAsDefault')!.run(h.ctx)
  expect(dressed(closed, 'SPclosed', vanillaPlus, h.ctx.drawDefaults()).attrs.f).toBe('#ff0000')
  expect(dressed(node('SP', { p: closed.attrs.p }), 'SP', vanillaPlus, h.ctx.drawDefaults()).attrs.s).toBe('#123456')
})

it('new shapes take linked theme parts; Use as default and Reset affect only that op', async () => {
  const h = tool('rect')
  h.ctx.theme = () => neutral
  h.click({ x: 20, y: 20 })
  await h.settle()
  expect(h.root()[0].attrs).toMatchObject({ f: neutral.colors['surface-panel'], rx: 0 })
  expect(linksOf(h.root()[0])).toMatchObject({ f: { part: 'shape', field: 'fill' } })
  const red = { ...h.root()[0], attrs: { ...h.root()[0].attrs, f: '#ff0000', id: 'never-default', click: 1 } }
  h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: red })
  await COMMANDS.find(c => c.id === 'style.useAsDefault')!.run(h.ctx)
  expect(h.notes.join(' ')).toContain('session')
  h.ctx.setTool('rect'); h.click({ x: 200, y: 200 }); await h.settle()
  expect(h.root()[1].attrs).toMatchObject({ f: '#ff0000' })
  expect(h.root()[1].attrs.id).toBeUndefined()
  expect(linksOf(h.root()[1]).f).toBeUndefined()
  await COMMANDS.find(c => c.id === 'style.resetDefaults')!.run(h.ctx)
  h.ctx.setTool('rect'); h.click({ x: 300, y: 300 }); await h.settle()
  expect(h.root()[2].attrs.f).toBe(neutral.colors['surface-panel'])
})

const LOOK = { f: '#1D1D23', s: '#5A5A69', sw: 1 }, RLOOK = { ...LOOK, rx: 6 }, OPEN = { s: '#8E8E9E', sw: 2 }
const IMAGE = { f: '#5A5A6933', s: '#8E8E9E', sw: 2, dash: [8, 6] }
type Sel = { sel?: Selection; also?: Selection[] }
const page = (root: SrcNode[] = [], set: Sel = {}) => harness({ header: { w: 460, h: 460 }, defs: [], root }, set)   // one unit per px
const tool = (id: string, root: SrcNode[] = [], set: Sel = {}) => { const h = page(root, set); h.ctx.setTool(id); return h }
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('drawing in the entered group', () => {
  it.each(['rect', 'line', 'pen'])('explains the entered destination when %s starts outside its bounds', id => {
    const h = tool(id, [node('G', {}, [node('R', { w: 20, h: 20 })])])
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.down({ x: 150, y: 100 }, { ctrlKey: true })
    expect(h.status()).toBe('The entered group is the drawing destination. Use Select and click empty canvas to leave it before drawing.')
    expect(h.state().past).toHaveLength(0)
    h.key({ key: 'Escape' })
    h.ctx.setTool('select'); h.click({ x: 340, y: 340 })
    expect(h.state().entered).toBeNull()
  })
  it('draws at root after the code pane replaces the entered group by a leaf', () => {
    const h = tool('rect', [node('G', {}, [node('R')])])
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.ctx.dispatch({ type: 'setScene', pageId: 'p1', scene: { ...h.scene(), root: [node('R')] } })
    h.drag({ x: 150, y: 100 }, { x: 190, y: 130 }, { ctrlKey: true })
    expect(h.root()).toHaveLength(2)
    expect(h.root()[1].attrs).toMatchObject({ x: 150, y: 100, w: 40, h: 30 })
    expect(h.state().entered).toBeNull()
    expect(h.state().selection?.path).toEqual([1])
  })
  it('refuses geometry that the local inverse sends outside float32', () => {
    for (const id of ['rect', 'line']) {
      const h = tool(id, [node('G', { s: [1e-38, 1e-38] }, [node('R')])])
      h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
      h.drag({ x: 150, y: 100 }, { x: 190, y: 130 }, { ctrlKey: true })
      expect(h.root()[0].c).toHaveLength(1)
      expect(h.state().past).toHaveLength(0)
      expect(h.notes.join(' ')).toContain('float32')
    }
  })
  it('inserts a rectangle on top of the group in local coordinates as one undo step', () => {
    const h = tool('rect', [node('G', { t: [50, 0] }, [node('R', { x: 0, y: 0, w: 10, h: 10 })])])
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.drag({ x: 150, y: 100 }, { x: 190, y: 130 }, { ctrlKey: true })
    expect(h.root()).toHaveLength(1)
    expect(h.root()[0].c![1].attrs).toMatchObject({ x: 100, y: 100, w: 40, h: 30 })
    expect(h.state()).toMatchObject({ entered: { pageId: 'p1', path: [0] }, selection: { pageId: 'p1', path: [0, 1] } })
    expect(h.state().past).toHaveLength(1)
  })
  it('a click and a point tool insert into the same local frame; their overlay stays at the pointer', () => {
    const h = tool('rect', [node('G', { t: [50, 0] }, [node('R')])])
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.click({ x: 150, y: 100 }, { ctrlKey: true })
    expect(h.root()[0].c![1].attrs).toMatchObject({ x: 100, y: 100, w: 120, h: 80 })
    h.ctx.setTool('line')
    h.down({ x: 170, y: 150 }, { ctrlKey: true })
    h.move({ x: 210, y: 180 }, { ctrlKey: true })
    expect(shown(h).points).toEqual([170, 150])
    h.up({ x: 210, y: 180 }, { ctrlKey: true })
    expect(h.root()[0].c![2].attrs.p).toEqual([120, 150, 160, 180])
  })
  it('uses the inverse of the complete rotated and scaled chain', () => {
    const h = tool('rect', [node('G', { t: [200, 0], r: 90, s: [2, 2] }, [node('G', { t: [10, 0] }, [node('R')])])])
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0, 0] })
    h.drag({ x: 140, y: 60 }, { x: 100, y: 120 }, { ctrlKey: true })
    expect(h.root()[0].c![0].c![1].attrs).toMatchObject({ x: 20, y: 30, w: 30, h: 20 })
  })
  it('a small free drag under a scaled group keeps the size drawn on screen', () => {
    const h = tool('rect', [node('G', { s: [10, 20] }, [node('R')])])
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.drag({ x: 100, y: 100 }, { x: 104, y: 104 }, { ctrlKey: true })
    expect(h.root()[0].c![1].attrs).toMatchObject({ x: 10, y: 5, w: Math.fround(0.4), h: Math.fround(0.2) })
  })
  it('refuses drawing under singular or expression transforms and explains why', () => {
    const transforms: SrcNode['attrs'][] = [{ s: [0, 1] }, { t: ['$x', 0] }]
    for (const attrs of transforms) {
      for (const id of ['rect', 'line']) {
        const h = tool(id, [node('G', attrs, [node('R')])])
        h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
        h.drag({ x: 150, y: 100 }, { x: 190, y: 130 }, { ctrlKey: true })
        expect(h.root()[0].c).toHaveLength(1)
        expect(h.root()).toHaveLength(1)
        expect(h.state().past).toHaveLength(0)
        expect(h.notes.join(' ')).toMatch(/singular|expression/)
      }
    }
  })
})

/** What the overlay shows now, in CSS px (one per unit here): the shape being drawn (the outline the mod would draw, as
 *  `points` text, null without one, and the points clicked) and whether a snap guide shows. */
function shown(h: ReturnType<typeof page>) {
  const ui = mount(h.router.overlay({ zoom: 1, frame: null })), c = ui.container
  const out = {
    line: c.querySelector('.vb-band polyline, .vb-band polygon')?.getAttribute('points') ?? null,
    points: Array.from(c.querySelectorAll('.vb-band circle')).flatMap(e => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]),
    guides: c.querySelector('.vb-guides') !== null,
  }
  ui.unmount()
  return out
}

describe('cornerBox', () => {
  const none = { shift: false, alt: false }, shift = { shift: true, alt: false }, alt = { shift: false, alt: true }
  it('is the box two points span, dragged either way', () => {
    expect(cornerBox({ x: 10, y: 20 }, { x: 50, y: 30 }, none)).toEqual({ x: 10, y: 20, w: 40, h: 10 })
    expect(cornerBox({ x: 50, y: 30 }, { x: 10, y: 20 }, none)).toEqual({ x: 10, y: 20, w: 40, h: 10 })
  })
  it('Shift: a square on the longer side, towards the pointer (a side of 0 goes down or right)', () => {
    expect(cornerBox({ x: 50, y: 30 }, { x: 10, y: 20 }, shift)).toEqual({ x: 10, y: -10, w: 40, h: 40 })
    expect(cornerBox({ x: 10, y: 10 }, { x: 10, y: 30 }, shift)).toEqual({ x: 10, y: 10, w: 20, h: 20 })
    expect(cornerBox({ x: 10, y: 30 }, { x: 10, y: 10 }, shift)).toEqual({ x: 10, y: 10, w: 20, h: 20 })
  })
  it('Alt: the first point is the centre; with Shift too, of a square', () => {
    expect(cornerBox({ x: 50, y: 30 }, { x: 10, y: 20 }, alt)).toEqual({ x: 10, y: 20, w: 80, h: 20 })
    expect(cornerBox({ x: 50, y: 30 }, { x: 10, y: 20 }, { shift: true, alt: true })).toEqual({ x: 10, y: -10, w: 80, h: 80 })
  })
  it('is at least 1 unit each way, or `least`', () => {
    expect(cornerBox({ x: 10, y: 10 }, { x: 10, y: 10 }, none)).toEqual({ x: 10, y: 10, w: 1, h: 1 })
    expect(cornerBox({ x: 10, y: 10 }, { x: 10.5, y: 40 }, none)).toEqual({ x: 10, y: 10, w: 1, h: 30 })
    expect(cornerBox({ x: 10, y: 10 }, { x: 10.5, y: 10 }, none, 0.25)).toEqual({ x: 10, y: 10, w: 0.5, h: 0.25 })
  })
})

describe("a new node's look", () => {
  it("reads the theme it is given: colours, edges, the rectangle's radius and the message style", () => {
    const g = slate.geo, odd: Theme = { ...slate, geo: { ...g, edge: { ...g.edge, hair: 3, strong: 5 } }, parts: { ...slate.parts, shape: { ...slate.parts.shape, width: 3, radius: 9 }, line: { ...slate.parts.line, width: 5 } },
      type: { ...slate.type, message: { ...slate.type.message, size: 31 } } }
    const c = (role: string) => colour(slate, role)
    expect(c('border')).not.toBe(colour(vanillaPlus, 'border'))   // slate's colours are its own
    expect(lookOf('R', odd)).toEqual({ f: c('surface-panel'), s: c('border'), sw: 3, rx: 9 })
    expect(lookOf('Y', odd)).toEqual({ f: c('surface-panel'), s: c('border'), sw: 3 })
    expect(lookOf('SP', odd)).toEqual({ s: c('border-strong'), sw: 5 })
    expect(lookOf('SPclosed', odd)).toEqual({ f: c('surface-panel'), s: c('border-strong'), sw: 5 })
    expect(lookOf('image', odd)).toEqual({ f: c('border') + '33', s: c('border-strong'), sw: 5, dash: [8, 6] })
    expect(lookOf('T', odd)).toMatchObject({ size: 31, f: c('text') })
  })
})

describe('box tools', () => {
  it('Rectangle: a drag draws a box in whole units, on top, selected, one undo step; then Select is back', () => {
    const h = tool('rect')
    h.drag({ x: 10.4, y: 20.2 }, { x: 110.6, y: 70.9 })
    expect(h.root().map(n => unlinked(n))).toEqual([node('R', { x: 10, y: 20, w: 101, h: 51, ...RLOOK })])
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0] })
    expect(h.state().past).toHaveLength(1)
    expect(h.ctx.tool()).toBe('select')
  })
  it('snaps to another node\'s edge; Ctrl/Cmd held snaps nothing', () => {
    const h = tool('rect', [node('R', { x: 100, y: 0, w: 50, h: 50 })])
    h.drag({ x: 97, y: 200 }, { x: 140, y: 260 })
    expect(h.root().map(n => unlinked(n))[1].attrs).toMatchObject({ x: 100, y: 200, w: 40, h: 60 })
    const free = tool('rect')
    free.drag({ x: 10.4, y: 20.2 }, { x: 110.6, y: 70.9 }, { ctrlKey: true })
    expect(free.root().map(n => unlinked(n))[0].attrs.x).toBeCloseTo(10.4, 5)
    expect(free.root().map(n => unlinked(n))[0].attrs.w).toBeCloseTo(100.2, 4)
  })
  it('Shift draws a square, Alt from the centre; a click makes the default box', () => {
    const sq = tool('rect')
    sq.drag({ x: 10, y: 10 }, { x: 50, y: 30 }, { shiftKey: true })
    expect(sq.root().map(n => unlinked(n))[0].attrs).toMatchObject({ x: 10, y: 10, w: 40, h: 40 })
    const mid = tool('rect')
    mid.drag({ x: 100, y: 100 }, { x: 130, y: 120 }, { altKey: true })
    expect(mid.root().map(n => unlinked(n))[0].attrs).toMatchObject({ x: 70, y: 80, w: 60, h: 40 })
    const click = tool('rect')
    click.click({ x: 10.4, y: 20.2 })
    expect(click.root().map(n => unlinked(n))).toEqual([node('R', { x: 10, y: 20, w: 120, h: 80, ...RLOOK })])
    expect(click.state().past).toHaveLength(1)
  })
  it('a drag up and to the left draws the same box; so do Shift and Alt', () => {
    const h = tool('rect')
    h.drag({ x: 50, y: 40 }, { x: 10, y: 10 })
    expect(h.root().map(n => unlinked(n))).toEqual([node('R', { x: 10, y: 10, w: 40, h: 30, ...RLOOK })])
    const sq = tool('rect')
    sq.drag({ x: 50, y: 40 }, { x: 10, y: 30 }, { shiftKey: true })
    expect(sq.root().map(n => unlinked(n))[0].attrs).toMatchObject({ x: 10, y: 0, w: 40, h: 40 })
    const mid = tool('rect')
    mid.drag({ x: 100, y: 100 }, { x: 70, y: 80 }, { altKey: true })
    expect(mid.root().map(n => unlinked(n))[0].attrs).toMatchObject({ x: 70, y: 80, w: 60, h: 40 })
  })
  it('Ellipse: Shift draws a circle (no ry); Text: a click is 240 wide and 1.4 sizes tall; Image: a dashed R marked # image', () => {
    const c = tool('ellipse')
    c.drag({ x: 10, y: 10 }, { x: 50, y: 30 }, { shiftKey: true })
    expect(c.root().map(n => unlinked(n))).toEqual([node('C', { cx: 30, cy: 30, rx: 20, ...LOOK })])
    const t = tool('text')
    t.click({ x: 50.4, y: 60.2 })
    expect(t.root().map(n => unlinked(n))).toEqual([node('T', { x: 50, y: 60, w: 240, h: 37, text: 'Text', size: 26, font: 'Barlow Medium', f: '#FFFFFF', sh: [[0, 2, 2, 0, '#00000099']] })])
    const i = tool('image')
    i.drag({ x: 0, y: 0 }, { x: 64, y: 32 })
    expect(i.root().map(n => unlinked(n))).toEqual([{ ...node('R', { x: 0, y: 0, w: 64, h: 32, ...IMAGE }), comments: ['image'] }])
  })
  it('Ellipse: a plain drag writes both radii', () => {
    const c = tool('ellipse')
    c.drag({ x: 10, y: 10 }, { x: 50, y: 30 })
    expect(c.root().map(n => unlinked(n))).toEqual([node('C', { cx: 30, cy: 20, rx: 20, ry: 10, ...LOOK })])
  })
  it('a click makes the 120 x 80 box for the ellipse and the image too; Shift a square from the click, Alt centred on it', () => {
    const c = tool('ellipse')
    c.click({ x: 10, y: 20 })
    expect(c.root().map(n => unlinked(n))).toEqual([node('C', { cx: 70, cy: 60, rx: 60, ry: 40, ...LOOK })])
    const i = tool('image')
    i.click({ x: 10, y: 20 })
    expect(i.root().map(n => unlinked(n))).toEqual([{ ...node('R', { x: 10, y: 20, w: 120, h: 80, ...IMAGE }), comments: ['image'] }])
    const circle = tool('ellipse')   // the circle's box starts at the click, as the plain click's does
    circle.click({ x: 10, y: 20 }, { shiftKey: true })
    expect(circle.root().map(n => unlinked(n))).toEqual([node('C', { cx: 70, cy: 80, rx: 60, ...LOOK })])
    const mid = tool('rect')
    mid.click({ x: 100, y: 100 }, { altKey: true })
    expect(mid.root().map(n => unlinked(n))).toEqual([node('R', { x: 40, y: 60, w: 120, h: 80, ...RLOOK })])
  })
  it('a drag that comes back within the slop of its press, or whose ends snap to one point, is a click: the default box', () => {
    const h = tool('rect')
    h.down({ x: 10, y: 10 })
    h.move({ x: 40, y: 40 })
    h.move({ x: 11, y: 10 })
    h.up({ x: 11, y: 10 })
    expect(h.root().map(n => unlinked(n))).toEqual([node('R', { x: 10, y: 10, w: 120, h: 80, ...RLOOK })])
    expect(h.state().past).toHaveLength(1)
    expect(h.state().dragBase).toBeNull()
    const R = node('R', { x: 100, y: 0, w: 50, h: 50 }), snapped = tool('rect', [R])
    snapped.down({ x: 99, y: 51 })   // the corner (100, 50)
    snapped.move({ x: 104, y: 54 })  // 5.8 px away, snapped to that corner too
    snapped.up({ x: 104, y: 54 })
    expect(snapped.root().map(n => unlinked(n))).toEqual([R, node('R', { x: 100, y: 50, w: 120, h: 80, ...RLOOK })])
  })
  it('in a scene of small units a free drag (Ctrl/Cmd) keeps a side under 1 unit; a snapped one is at least 1', () => {
    const h = harness({ header: { w: 10, h: 10 }, defs: [], root: [] })   // 46 px per unit
    h.ctx.setTool('rect')
    h.drag({ x: 46, y: 46 }, { x: 59.8, y: 92 }, { ctrlKey: true })
    expect(h.root().map(n => unlinked(n))[0].attrs.x).toBe(1)
    expect(h.root().map(n => unlinked(n))[0].attrs.w).toBeCloseTo(0.3, 5)
    expect(h.root().map(n => unlinked(n))[0].attrs.h).toBe(1)
    const snapped = harness({ header: { w: 10, h: 10 }, defs: [], root: [] })
    snapped.ctx.setTool('rect')
    snapped.drag({ x: 46, y: 46 }, { x: 59.8, y: 92 })   // (1, 1) to (1, 2) in whole units: a side of 0
    expect(snapped.root().map(n => unlinked(n))[0].attrs).toMatchObject({ x: 1, y: 1, w: 1, h: 1 })
  })
})

describe('point tools', () => {
  it('Line: a drag draws a two-point line and is done; Shift turns it to 45 degree steps', () => {
    const h = tool('line')
    h.drag({ x: 10, y: 10 }, { x: 50, y: 13 })
    expect(h.root().map(n => unlinked(n))).toEqual([node('L', { p: [10, 10, 50, 13], ...OPEN })])
    expect(h.ctx.tool()).toBe('select')
    const s = tool('line')
    s.drag({ x: 10, y: 10 }, { x: 50, y: 13 }, { shiftKey: true })
    const p = s.root().map(n => unlinked(n))[0].attrs.p as number[]
    expect(p[1]).toBe(10)
    expect(p[3]).toBe(10)
    expect(p[2]).toBeCloseTo(50.112, 3)
    const d = tool('line')
    d.drag({ x: 10, y: 10 }, { x: 100, y: 90 }, { shiftKey: true })
    const q = d.root().map(n => unlinked(n))[0].attrs.p as number[]
    expect(q[2]).toBeCloseTo(95.147, 3)
    expect(q[3]).toBeCloseTo(95.147, 3)
  })
  it('Line by clicks: a rubber band follows the pointer, Enter ends, as one undo step; Backspace or Mod+Z drops a point; Esc drops all', () => {
    const h = tool('line')
    h.click({ x: 10, y: 10 })
    h.move({ x: 30, y: 10 })
    expect(shown(h)).toMatchObject({ line: '10,10 30,10', points: [10, 10] })
    h.click({ x: 50, y: 10 })
    h.click({ x: 50, y: 50 })
    h.key({ key: 'Enter' })
    expect(h.root().map(n => unlinked(n))).toEqual([node('L', { p: [10, 10, 50, 10, 50, 50], ...OPEN })])
    expect(h.state().past).toHaveLength(1)
    const back = tool('line')
    back.click({ x: 10, y: 10 })
    back.click({ x: 50, y: 10 })
    back.click({ x: 50, y: 50 })
    expect(back.key({ key: 'Backspace' }).defaultPrevented).toBe(true)
    expect(shown(back).points).toEqual([10, 10, 50, 10])
    expect(back.key({ key: 'z', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(shown(back).points).toEqual([10, 10])
    back.key({ key: 'Escape' })
    expect(shown(back)).toMatchObject({ line: null, points: [] })
    expect(back.root().map(n => unlinked(n))).toEqual([])
    expect(back.state().past).toHaveLength(0)
    expect(back.ctx.tool()).toBe('line')   // the first Esc drops the shape; a second goes back to Select (ruling P12)
    back.key({ key: 'Escape' })
    expect(back.ctx.tool()).toBe('select')
  })
  it('Backspace past the first point leaves the tool and writes nothing', () => {
    const h = tool('line')
    h.click({ x: 10, y: 10 })
    h.key({ key: 'Backspace' })
    expect(h.ctx.tool()).toBe('select')
    expect(h.root().map(n => unlinked(n))).toEqual([])
    expect(h.actions).toEqual([])
  })
  it('a Line drag that comes back within the slop of its press is a click: the line goes on by clicks', () => {
    const h = tool('line')
    h.down({ x: 10, y: 10 })
    h.move({ x: 40, y: 10 })
    h.move({ x: 11, y: 10 })
    h.up({ x: 11, y: 10 })
    expect(h.ctx.tool()).toBe('line')
    expect(h.root().map(n => unlinked(n))).toEqual([])
    expect(shown(h).points).toEqual([10, 10])
    h.click({ x: 50, y: 50 })
    h.key({ key: 'Enter' })
    expect(h.root().map(n => unlinked(n))).toEqual([node('L', { p: [10, 10, 50, 50], ...OPEN })])
  })
  it('a Line drag whose two ends snap to one point is a click too', () => {
    const R = node('R', { x: 100, y: 0, w: 50, h: 50 }), h = tool('line', [R])
    h.down({ x: 99, y: 51 })   // the corner (100, 50)
    h.move({ x: 104, y: 54 })  // 5.8 px away, snapped to that corner too
    h.up({ x: 104, y: 54 })
    expect(h.ctx.tool()).toBe('line')
    expect(h.root().map(n => unlinked(n))).toEqual([R])
    expect(shown(h).points).toEqual([100, 50])
  })
  it('a drag makes the first segment of a curve or a polygon, which go on by clicks; a later click that drifts adds one point', () => {
    for (const [id, op] of [['path', 'SP'], ['polygon', 'Y']]) {
      const h = tool(id)
      h.drag({ x: 10, y: 10 }, { x: 50, y: 10 })
      expect(h.ctx.tool()).toBe(id)
      expect(shown(h).points).toEqual([10, 10, 50, 10])
      h.down({ x: 50, y: 60 })
      h.move({ x: 56, y: 60 })
      h.up({ x: 56, y: 60 })   // a shaky click: released 6 px from its press
      expect(shown(h).points).toEqual([10, 10, 50, 10, 50, 60])
      h.key({ key: 'Enter' })
      expect(h.root().map(n => unlinked(n))).toEqual([node(op, { p: [10, 10, 50, 10, 50, 60], ...(op === 'Y' ? LOOK : OPEN) })])
    }
  })
  it('Enter on a single point writes nothing and leaves the tool', () => {
    for (const id of ['line', 'polygon', 'path']) {
      const h = tool(id)
      h.click({ x: 10, y: 10 })
      h.key({ key: 'Enter' })
      expect(h.ctx.tool()).toBe('select')
      expect(h.actions).toEqual([])
    }
  })
  it('a Line never closes: a click on its first point is one more point', () => {
    const h = tool('line')
    for (const at of [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 11, y: 11 }]) h.click(at)
    expect(h.ctx.tool()).toBe('line')
    h.key({ key: 'Enter' })
    expect(h.root().map(n => unlinked(n))).toEqual([node('L', { p: [10, 10, 50, 10, 50, 50, 10, 10], ...OPEN })])
  })
  it('Polygon: a click on the first point closes it; fewer than three points write nothing', () => {
    const h = tool('polygon')
    for (const at of [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 11, y: 11 }]) h.click(at)
    expect(h.root().map(n => unlinked(n))).toEqual([node('Y', { p: [10, 10, 50, 10, 50, 50], ...LOOK })])
    const few = tool('polygon')
    few.click({ x: 10, y: 10 })
    few.click({ x: 50, y: 10 })
    few.key({ key: 'Enter' })
    expect(few.root().map(n => unlinked(n))).toEqual([])
    expect(few.state().past).toHaveLength(0)
  })
  it('a click on the first point of only two closes nothing: it is a third point', () => {
    const h = tool('polygon')
    for (const at of [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 10, y: 10 }]) h.click(at)
    expect(h.ctx.tool()).toBe('polygon')
    expect(h.root().map(n => unlinked(n))).toEqual([])
    expect(shown(h).points).toEqual([10, 10, 50, 10, 10, 10])
  })
  it('Enter ends a polygon of three points or more, and leaves a curve open (no close, no fill)', () => {
    const at = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }]
    const y = tool('polygon')
    for (const p of at) y.click(p)
    y.key({ key: 'Enter' })
    expect(y.root().map(n => unlinked(n))).toEqual([node('Y', { p: [10, 10, 50, 10, 50, 50], ...LOOK })])
    expect(y.ctx.tool()).toBe('select')
    const sp = tool('path')
    for (const p of at) sp.click(p)
    sp.key({ key: 'Enter' })
    expect(sp.root().map(n => unlinked(n))).toEqual([node('SP', { p: [10, 10, 50, 10, 50, 50], ...OPEN })])
  })
  it('Path: closing on the first point writes close=1 and a fill; an open one has neither; a double click ends', () => {
    const h = tool('path')
    for (const at of [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 11 }]) h.click(at)
    expect(h.root().map(n => unlinked(n))).toEqual([node('SP', { p: [10, 10, 50, 10, 50, 50], close: 1, f: '#1D1D23', ...OPEN })])
    const open = tool('path')
    open.click({ x: 10, y: 10 })
    open.click({ x: 50, y: 10 })
    open.click({ x: 50, y: 10 }, { double: true })
    expect(open.root().map(n => unlinked(n))).toEqual([node('SP', { p: [10, 10, 50, 10], ...OPEN })])
    // The same three clicks a second apart: no double click, the curve stays open, and a click on its last point adds
    // none (the mod drops a repeated point, Stroke.cs).
    const slow = tool('path')
    slow.click({ x: 10, y: 10 })
    slow.click({ x: 50, y: 10 })
    slow.click({ x: 50, y: 10 })
    expect(slow.ctx.tool()).toBe('path')
    expect(shown(slow).points).toEqual([10, 10, 50, 10])
    slow.key({ key: 'Enter' })
    expect(slow.root().map(n => unlinked(n))).toEqual([node('SP', { p: [10, 10, 50, 10], ...OPEN })])
  })
  it('each point tool leaves its new shape on top and selected alone', () => {
    const A = node('R', { x: 300, y: 300, w: 10, h: 10 }), B = node('R', { x: 330, y: 300, w: 10, h: 10 })
    const set = { sel: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }] }
    const line = tool('line', [A, B], set)
    line.drag({ x: 10, y: 10 }, { x: 50, y: 13 })
    const polygon = tool('polygon', [A, B], set)
    for (const at of [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 10 }]) polygon.click(at)
    const curve = tool('path', [A, B], set)
    for (const at of [{ x: 10, y: 10 }, { x: 50, y: 10 }]) curve.click(at)
    curve.key({ key: 'Enter' })
    for (const h of [line, polygon, curve]) {
      expect(h.root().map(n => unlinked(n))).toHaveLength(3)
      expect(h.state()).toMatchObject({ selection: { pageId: 'p1', path: [2] }, also: [] })
    }
  })
  it('with Shift a point takes 45 degree steps from the last one, by where the pointer snapped; it lies on no guide, so none shows', () => {
    const h = tool('line')
    h.click({ x: 10, y: 10 })
    h.move({ x: 233, y: 40 })
    expect(shown(h)).toMatchObject({ guides: true, line: '10,10 230,40' })   // the page's centre
    h.move({ x: 233, y: 40 }, { shiftKey: true })
    const s = shown(h)
    expect(s.guides).toBe(false)
    expect(s.line).toMatch(/^10,10 232\.03\d*,10$/)
  })
  it('a click with Shift on the first point closes the shape', () => {
    const h = tool('polygon')
    for (const at of [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 40 }]) h.click(at)
    h.click({ x: 12, y: 13 }, { shiftKey: true })
    expect(h.root().map(n => unlinked(n))).toEqual([node('Y', { p: [10, 10, 60, 10, 60, 40], ...LOOK })])
  })
  it('a free click (Ctrl/Cmd) closes the shape within the snap distance of its first point, and adds a point beyond it', () => {
    const h = tool('polygon')
    for (const at of [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 20, y: 10 }]) h.click(at, { ctrlKey: true })
    expect(h.ctx.tool()).toBe('polygon')   // the last one 10 units (CSS px) from the first: beyond the 8
    h.click({ x: 12, y: 13 }, { ctrlKey: true })   // 3.6 from it
    expect(h.root().map(n => unlinked(n))).toEqual([node('Y', { p: [10, 10, 50, 10, 50, 50, 20, 10], ...LOOK })])
  })
  it('keys it does not use leave the points alone and go on: x, Delete, Ctrl+A', () => {
    const h = tool('polygon')
    h.click({ x: 10, y: 10 })
    h.click({ x: 50, y: 10 })
    for (const k of [{ key: 'x' }, { key: 'Delete' }, { key: 'a', ctrlKey: true }]) expect(h.key(k).defaultPrevented).toBe(false)
    expect(shown(h).points).toEqual([10, 10, 50, 10])
    expect(h.ctx.tool()).toBe('polygon')
  })
  it('a point snaps to the shape\'s earlier points, not to the one it goes on from', () => {
    const h = tool('polygon')
    for (const at of [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 14, y: 104 }]) h.click(at)
    h.key({ key: 'Enter' })
    expect(h.root().map(n => unlinked(n))).toEqual([node('Y', { p: [10, 10, 100, 10, 100, 100, 10, 104], ...LOOK })])
  })
  it('the press that closes a shape is no double click\'s first half for Select', () => {
    const h = tool('polygon'), spy = vi.spyOn(select, 'down')
    for (const at of [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 10 }]) h.click(at)
    expect(h.ctx.tool()).toBe('select')
    h.click({ x: 10, y: 10 }, { double: true })   // 100 ms later, on the same spot
    expect(spy.mock.calls.map(([p]) => p.clicks)).toEqual([1])
  })
})

// The shape being drawn is the overlay's until it ends: an edit that lands meanwhile (a page tab, the panel, the code pane,
// the Commands menu, a load) never meets it half drawn, and the router ends it at the next render, pointer or key.
describe('the shape being drawn stays out of the store until it ends', () => {
  const drawing = (id: string, root: SrcNode[] = []) => {
    const h = tool(id, root)
    h.click({ x: 10, y: 10 })
    h.click({ x: 50, y: 10 })
    h.move({ x: 60, y: 60 })   // the rubber band: never clicked
    return h
  }
  it('hover moves and clicks write nothing; Enter writes the shape as one edit, without the rubber band', () => {
    const h = drawing('line')
    expect(shown(h)).toMatchObject({ line: '10,10 50,10 60,60', points: [10, 10, 50, 10] })
    expect(h.actions).toEqual([])
    h.key({ key: 'Enter' })
    expect(h.root().map(n => unlinked(n))).toEqual([node('L', { p: [10, 10, 50, 10], ...OPEN })])
    expect(h.actions).toEqual([{ type: 'editScene', pageId: 'p1', scene: h.scene(), selection: { pageId: 'p1', path: [0] }, also: [] }])
    expect(h.state().past).toHaveLength(1)
  })
  it('a page added meanwhile (a page tab) leaves the page it was drawn on as it was', async () => {
    const h = drawing('path')
    h.ctx.dispatch({ type: 'addPage' })
    h.router.overlay({ zoom: 1, frame: null })   // the render that shows it
    await h.settle()
    expect(h.root().map(n => unlinked(n))).toEqual([])
    expect(h.state().past).toHaveLength(1)   // the added page only
    expect(h.state().dragBase).toBeNull()
    expect(h.ctx.tool()).toBe('path')
  })
  it('a panel edit meanwhile is the only edit', () => {
    const R = node('R', { x: 300, y: 300, w: 10, h: 10 }), moved = node('R', { x: 5, y: 300, w: 10, h: 10 })
    const h = drawing('line', [R])
    h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: moved })
    h.move({ x: 70, y: 60 })   // the next pointer report ends the line
    expect(h.root().map(n => unlinked(n))).toEqual([moved])
    expect(h.state().past).toHaveLength(1)
    expect(shown(h).line).toBeNull()
  })
  it('a code-pane flush meanwhile is the only edit; the next click starts a new shape', () => {
    const R = node('R', { x: 300, y: 300, w: 10, h: 10 }), h = drawing('path')
    h.ctx.dispatch({ type: 'setScene', pageId: 'p1', scene: { ...h.scene(), root: [R] } })
    h.click({ x: 100, y: 100 })
    expect(h.root().map(n => unlinked(n))).toEqual([R])
    expect(h.state().past).toHaveLength(1)
    expect(shown(h).points).toEqual([100, 100])
  })
  it('Redo from the Commands menu meanwhile redoes', () => {
    const R = node('R', { x: 300, y: 300, w: 10, h: 10 }), h = tool('polygon', [R])
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] } })
    h.ctx.dispatch({ type: 'undo' })
    h.click({ x: 10, y: 10 })
    h.click({ x: 50, y: 10 })
    h.move({ x: 50, y: 50 })
    runCommand(history.find(c => c.id === 'redo')!, h.ctx)
    expect(h.root().map(n => unlinked(n))).toEqual([])
    expect(h.state().future).toHaveLength(0)
    expect(h.state().past).toHaveLength(1)
  })
  it('a project loaded meanwhile leaves nothing of it in the history', () => {
    const h = drawing('path')
    h.ctx.dispatch({ type: 'loadProject', project: newProject() })
    expect(h.state().past).toHaveLength(1)
    expect(h.state().past[0].project.pages[0].scene.root).toEqual([])
  })
  it('called without the router, it ends on top of its page as that page is then, and writes nothing once another is active', () => {
    const at = (x: number, y: number): Press => ({ at: { x, y }, px: { x, y }, start: { x, y }, css: 0,
      mods: { shift: false, alt: false, mod: false }, clicks: 1 })
    const h = page(), g = path.down(at(10, 10), h.ctx)!
    expect(g.up(at(10, 10))).toBe(true)
    const R = node('R', { x: 300, y: 300, w: 10, h: 10 })
    h.ctx.dispatch({ type: 'setScene', pageId: 'p1', scene: { ...h.scene(), root: [R] } })
    g.down!(at(50, 10))
    expect(g.key!('Enter')).toBe('done')
    expect(h.root().map(n => unlinked(n))).toEqual([R, node('SP', { p: [10, 10, 50, 10], ...OPEN })])
    expect(h.state().past).toHaveLength(2)
    const other = page(), o = path.down(at(10, 10), other.ctx)!
    o.up(at(10, 10))
    other.ctx.dispatch({ type: 'addPage' })
    o.down!(at(50, 10))
    o.key!('Enter')
    expect(other.state().project.pages.map(p => p.scene.root)).toEqual([[], []])
  })
})
