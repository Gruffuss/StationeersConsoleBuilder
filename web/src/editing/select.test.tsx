import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Scene, SrcNode } from '../model/scene'
import { indexOfPath } from '../model/numbering'
import { node } from '../model/testing'
import { decodeFrame } from '../runtime/frame'
import { vbf1 } from '../runtime/testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { cornersOf, handleAt, marqueeHits, setFrame, SetOutlines } from './select'
import { harness } from './testing'
import { unitsOf } from './units'

const scene: Scene = { header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 100, y: 100, w: 40, h: 20 }), node('USE', { ref: 's' })] }
const rect = { w: 460, h: 460 }, sel = (...path: number[]) => ({ pageId: 'p1', path })

describe('the select tool\'s geometry', () => {
  it('finds set capabilities without copying transformed scene roots', () => {
    let copies = 0
    const root = new Proxy([node('R', { x: 100, y: 100, w: 10, h: 10 }), node('R', { x: 120, y: 100, w: 10, h: 10 })], {
      get(target, key, receiver) { if (key === Symbol.iterator) copies++; return Reflect.get(target, key, receiver) },
    })
    const h = harness({ ...scene, root }, { sel: sel(1), also: [sel(0)] })
    const f = setFrame(h.ctx)
    expect(f).toMatchObject({ box: { x: 100, y: 100, w: 30, h: 10 }, resize: true, rotate: true })
    expect(copies).toBe(0)
    expect(h.scene().root).toBe(root)
  })
  it('draws one union frame with eight handles and a knob for a transformable set', () => {
    const h = harness({ ...scene, root: [node('R', { x: 100, y: 100, w: 10, h: 10 }), node('R', { x: 120, y: 100, w: 10, h: 10 })] },
      { sel: sel(1), also: [sel(0)] })
    const html = renderToStaticMarkup(<SetOutlines ctx={h.ctx} o={{ zoom: 2, frame: h.ctx.frame(), view: h.ctx.view() }} />)
    expect(html.split('vb-handle').length - 1).toBe(8)
    expect(html.split('vb-knob').length - 1).toBe(1)
    expect(html).toContain('x="256" y="216"')
  })
  it('offers a widget root a knob even when its module offers no resize handles', () => {
    const s = putWidget({ ...scene, root: [] }, instance('light', { x: 100, y: 100 }), vanillaPlus)
    expect(handleAt(s, sel(0), rect, 1, { x: 109, y: 76 }, vanillaPlus)).toBe('rotate')
  })
  it('maps a rotated widget params box through its root for handles, outlines and snap targets', () => {
    const w = { ...instance('bar', { x: 100, y: 100, w: 200, h: 30 }), edit: { v: 1 as const, parts: {}, root: { r: 90, a: [200, 115] as [number, number] } } }
    const s = putWidget({ ...scene, root: [] }, w, vanillaPlus)
    const corners = cornersOf(s, [0], rect, vanillaPlus)!
    expect(corners[0][0]).toBeCloseTo(215); expect(corners[0][1]).toBeCloseTo(15)
    expect(handleAt(s, sel(0), rect, 1, { x: 185, y: 215 }, vanillaPlus)).toBe('se')
    const box = unitsOf(s, [sel(0)], vanillaPlus)[0].box!
    expect(box.x).toBeCloseTo(185); expect(box.y).toBeCloseTo(15)
    expect(box.w).toBeCloseTo(30); expect(box.h).toBeCloseTo(200)
  })
  it('draws no set handles if all literal members are locked', () => {
    const h = harness({ ...scene, root: [100, 120].map(x => ({ ...node('R', { x, y: 100, w: 10, h: 10 }), comments: ['lock'] })) },
      { sel: sel(1), also: [sel(0)] })
    const html = renderToStaticMarkup(<SetOutlines ctx={h.ctx} o={{ zoom: 1, frame: h.ctx.frame(), view: h.ctx.view() }} />)
    expect(html).not.toContain('vb-handle'); expect(html).not.toContain('vb-knob')
  })
  it('offers width handles to a set made entirely of width-only widgets', () => {
    const s = putWidget(putWidget({ ...scene, root: [] }, instance('readout', { x: 100, y: 100 }, 'kpi1'), vanillaPlus),
      instance('readout', { x: 300, y: 100 }, 'kpi2'), vanillaPlus)
    const h = harness(s, { sel: sel(1), also: [sel(0)] })
    const html = renderToStaticMarkup(<SetOutlines ctx={h.ctx} o={{ zoom: 1, frame: h.ctx.frame(), view: h.ctx.view() }} />)
    expect(html.split('vb-handle').length - 1).toBe(2)
    expect(html).toContain('vb-knob')
  })
  it('finds the handle under a point (within half a handle and 2 px), the knob, or none', () => {
    expect(handleAt(scene, sel(0), rect, 1, { x: 141, y: 121 }, vanillaPlus)).toBe('se')
    expect(handleAt(scene, sel(0), rect, 1, { x: 120, y: 76 }, vanillaPlus)).toBe('rotate')
    expect(handleAt(scene, sel(0), rect, 1, { x: 120, y: 110 }, vanillaPlus)).toBeNull()
    expect(handleAt(scene, sel(1), rect, 1, { x: 0, y: 0 }, vanillaPlus)).toBeNull()
  })
  it('hit-tests in CSS px at any zoom: at zoom 2 the handle is where it is drawn, its reach 6 CSS px (3 surface px)', () => {
    // The se handle is drawn at CSS (280, 240), the knob 24 CSS px above the top side's middle: CSS (240, 176).
    expect(handleAt(scene, sel(0), rect, 2, { x: 141, y: 121 }, vanillaPlus)).toBe('se')
    expect(handleAt(scene, sel(0), rect, 2, { x: 280, y: 240 }, vanillaPlus)).toBeNull()   // where it would be at zoom 1
    expect(handleAt(scene, sel(0), rect, 2, { x: 142.95, y: 120 }, vanillaPlus)).toBe('se')   // 5.9 CSS px off
    expect(handleAt(scene, sel(0), rect, 2, { x: 143.05, y: 120 }, vanillaPlus)).toBeNull()   // 6.1 CSS px off
    expect(handleAt(scene, sel(0), rect, 2, { x: 120, y: 88 }, vanillaPlus)).toBe('rotate')
  })
  it("finds the knob where it is drawn: below a node at the page's top, whose top side leaves no room above", () => {
    const top: Scene = { ...scene, root: [node('R', { x: 100, y: 10, w: 40, h: 20 })] }
    expect(handleAt(top, sel(0), rect, 1, { x: 120, y: 54 }, vanillaPlus)).toBe('rotate')
    expect(handleAt(top, sel(0), rect, 1, { x: 120, y: -14 }, vanillaPlus)).toBeNull()
  })
  it('catches what a marquee touches, or only what it encloses; never a box that holds the whole marquee', () => {
    const boxes = [{ x: 10, y: 10, w: 20, h: 20 }, { x: 0, y: 0, w: 460, h: 460 }, null, { x: 100, y: 100, w: 5, h: 5 }]
    expect(marqueeHits(boxes, { x: 5, y: 5, w: 45, h: 45 }, false)).toEqual([0])
    expect(marqueeHits(boxes, { x: 5, y: 5, w: 20, h: 20 }, true)).toEqual([])
    expect(marqueeHits(boxes, { x: 5, y: 5, w: 200, h: 200 }, true)).toEqual([0, 3])
  })
  it('gives a node\'s outline corners in surface px', () => {
    expect(cornersOf(scene, [0], rect, vanillaPlus)).toEqual([[100, 100], [140, 100], [140, 120], [100, 120]])
    expect(cornersOf(scene, [1], rect, vanillaPlus)).toBeNull()
  })
  it('offers a group with m its knob only; a circle no knob', () => {
    const g: Scene = { ...scene, root: [node('G', { m: [1, 0, 0, 1, 0, 0] }, [node('R', { x: 100, y: 100, w: 40, h: 20 })]),
      node('C', { cx: 300, cy: 300, rx: 10 })] }
    expect(handleAt(g, sel(0), rect, 1, { x: 140, y: 120 }, vanillaPlus)).toBeNull()
    expect(handleAt(g, sel(0), rect, 1, { x: 120, y: 76 }, vanillaPlus)).toBe('rotate')
    expect(handleAt(g, sel(1), rect, 1, { x: 310, y: 310 }, vanillaPlus)).toBe('se')
    expect(handleAt(g, sel(1), rect, 1, { x: 300, y: 266 }, vanillaPlus)).toBeNull()
  })
})

describe('the set\'s outlines', () => {
  const draw = (root: SrcNode[], primary: number[], also: number[][]) => {
    const h = harness({ ...scene, root }, { sel: sel(...primary), also: also.map(p => sel(...p)) })
    return renderToStaticMarkup(<SetOutlines ctx={h.ctx} o={{ zoom: 1, frame: null, view: h.ctx.view() }} />)
  }
  const R = (x: number) => node('R', { x, y: 10, w: 10, h: 10 })
  it('outlines the members but the primary (Selection draws it), and the union box', () => {
    const html = draw([R(10), R(40), R(70)], [2], [[0]])
    expect(html.split('<polygon').length - 1).toBe(2)
    expect(html).toContain('points="10,10 20,10 20,20 10,20"')
    expect(html).toContain('<rect class="vb-sel-set" x="10" y="10" width="70" height="10"')
  })
  it('draws nothing for one node, unless it is locked: then a padlock saying so', () => {
    expect(draw([R(10)], [0], [])).toBe('')
    const html = draw([{ ...R(10), comments: [' Lock'] }], [0], [])
    expect(html).toContain('<title>locked</title>')
    expect(html).not.toContain('vb-sel-set')
  })
  it.each([false, true])("outlines a member with no literal box by the shown spans, including nested members (%s)", async nested => {
    const sym = node('SYM', { id: 's' }, [node('R', { x: 0, y: 0, w: 20, h: 20 })])
    const use = node('USE', { ref: 's' }), path = nested ? [1, 0] : [1]
    const h = harness({ ...scene, defs: [sym], root: [node('R', { x: 200, y: 200, w: 20, h: 20 }), nested ? node('G', {}, [use]) : use] }, { sel: sel(0), also: [sel(...path)] })
    await h.checker.check(h.scene())
    const k = indexOfPath(h.ctx.order()!, h.root(), path)!, from = h.scene()
    h.ctx.frame = () => ({ ...decodeFrame(vbf1(JSON.stringify({ elements: [{ id: 'scene', scene: 'p1', x: 0, y: 0, w: 460, h: 460, firstVertex: 0,
      vertexCount: 3 }], text: [], problems: [] }))), positions: Float32Array.of(10, 10, 30, 10, 10, 30), coverage: Float32Array.of(1, 1, 1),
      colours: new Uint8Array(12).fill(255), indices: Uint32Array.of(0, 1, 2), spans: Int32Array.of(0, k, 0, 3), drawnFrom: from })
    const html = renderToStaticMarkup(<SetOutlines ctx={h.ctx} o={{ zoom: 1, frame: h.ctx.frame(), view: h.ctx.view() }} />)
    expect(html).toContain('<rect class="vb-sel-over" x="10" y="10" width="20" height="20"')
    expect(html).toContain('<rect class="vb-sel-set" x="10" y="10" width="210" height="210"')
  })
  it('outlines a widget root, and takes it into the union box, by its params, not by what its nodes draw', () => {
    const bar = putWidget({ ...scene, root: [] }, instance('bar', { x: 100, y: 100, w: 200, h: 30 }), vanillaPlus).root[0]
    const html = draw([R(10), bar], [0], [[1]])
    expect(html).toContain('points="100,100 300,100 300,130 100,130"')
    expect(html).toContain('<rect class="vb-sel-set" x="10" y="10" width="290" height="120"')
  })
})
