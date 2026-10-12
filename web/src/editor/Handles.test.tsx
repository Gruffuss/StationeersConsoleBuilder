import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { box as boxParams, KEYS } from '../widgets/paint'
import { WIDGETS } from '../widgets/registry'
import { instance } from '../widgets/testing'
import type { WidgetModule } from '../widgets/types'
import { handlePoints, Handles, widgetBox } from './Handles'

describe('handles', () => {
  const box = { x: 0, y: 0, w: 10, h: 10 }
  it('sit on the box\'s sides and corners through the chain, in CSS px; the knob beyond the top side', () => {
    const at = Object.fromEntries(handlePoints(box, [1, 0, 0, 1, 0, 0], 2, { rotate: true }).map(p => [p.h, [p.x, p.y]]))
    expect(at).toEqual({ nw: [0, 0], n: [10, 0], ne: [20, 0], e: [20, 10], se: [20, 20], s: [10, 20], sw: [0, 20], w: [0, 10], rotate: [10, -24] })
  })
  it('turn with the box: the knob points along the box\'s own up', () => {
    const knob = handlePoints(box, [0, 1, -1, 0, 100, 0], 1, { rotate: true }).find(p => p.h === 'rotate')!
    expect([knob.x, knob.y].map(v => Math.round(v * 1e9) / 1e9)).toEqual([124, 5])
  })
  const knob = (b: typeof box, chain: [number, number, number, number, number, number], within?: { w: number; h: number }) =>
    handlePoints(b, chain, 1, { rotate: true, within }).find(p => p.h === 'rotate')!
  it("a flat box's knob points along the chain's own up (a quarter turn: screen right)", () => {
    const k = knob({ x: 0, y: 0, w: 10, h: 0 }, [0, 1, -1, 0, 100, 0])
    expect([k.x, k.y].map(v => Math.round(v * 1e9) / 1e9)).toEqual([124, 5])
  })
  it('keep the knob on the surface: beyond the bottom side where beyond the top is off it, else inside', () => {
    const I: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0], page = { w: 100, h: 100 }
    expect(knob({ x: 0, y: 10, w: 10, h: 10 }, I)).toMatchObject({ x: 5, y: -14 })
    expect(knob({ x: 0, y: 10, w: 10, h: 10 }, I, page)).toMatchObject({ x: 5, y: 44 })
    expect(knob({ x: 0, y: 10, w: 10, h: 85 }, I, page)).toMatchObject({ x: 5, y: 34 })
    expect(knob({ x: 0, y: 30, w: 10, h: 10 }, I, page)).toMatchObject({ x: 5, y: 6 })
  })
  it('are drawn only: rects and a knob, no pointer handlers; `only` limits them', () => {
    const html = renderToStaticMarkup(<svg><Handles box={box} chain={[1, 0, 0, 1, 0, 0]} zoom={1} only={['e', 'w']} rotate /></svg>)
    expect(html.split('vb-handle').length - 1).toBe(2)
    expect(html).toContain('vb-knob')
  })
})

// M2b's widgetBox (its drag tests went to the select tool: editing/widgets.test.ts).
describe('widgetBox', () => {
  // Probe modules: the light, resizable both ways or in width.
  const probe = (type: string, resize: 'both' | 'width'): WidgetModule => ({ ...WIDGETS.light, type, prefix: type, resize, params: [...boxParams().map(q => q.key === 'w' || q.key === 'h' ? { ...q, min: 36 } : q), KEYS] })
  beforeAll(() => { WIDGETS.pa = probe('pa', 'both'); WIDGETS.pb = probe('pb', 'width') })
  afterAll(() => { delete WIDGETS.pa; delete WIDGETS.pb })
  const scene = (type: string, over: Record<string, number> = { x: 100, y: 100, w: 100, h: 100 }) =>
    putWidget({ header: { w: 480, h: 480 }, defs: [], root: [] }, instance(type, over), vanillaPlus)
  it('gives a width-only widget its side handles only, a both-ways one all eight', () => {
    expect(widgetBox(scene('pb'), [0], vanillaPlus)?.handles).toEqual(['e', 'w'])
    expect(widgetBox(scene('pa'), [0], vanillaPlus)?.handles).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
  })
  it('gives a light no resize handle, its box its params; null for anything but a widget root', () => {
    const light = scene('light', { x: 100, y: 100, w: 18.5, h: 18.5 })
    expect(widgetBox(light, [0], vanillaPlus)).toEqual({ box: { x: 100, y: 100, w: 18.5, h: 18.5 }, handles: [] })
    expect(widgetBox(light, [0, 0], vanillaPlus)).toBeNull()
  })
})
