import { describe, expect, it } from 'vitest'
import { fitView, toSurface, zoomAt } from './view'

describe('viewport', () => {
  it('zoom keeps the point under the pointer, including at the view limits', () => {
    const v = { zoom: 1.5, pan: { x: 100, y: 50 } }, a = { x: 280, y: 170 }
    expect(toSurface(zoomAt(v, a, 2), a)).toEqual({ x: 120, y: 80 })
    expect(toSurface(zoomAt(v, a, 1000), a)).toEqual({ x: 120, y: 80 })
    expect(zoomAt(v, a, 1000).zoom).toBe(64)
    expect(zoomAt(v, a, 0.0001).zoom).toBe(0.01)
  })
  it('fit leaves 24 CSS px of margin and centres the page', () => {
    const v = fitView({ w: 460, h: 460 }, { w: 800, h: 600 })
    expect(v.zoom).toBeCloseTo(552 / 460)
    expect(v.pan).toEqual({ x: 124, y: 24 })
  })
  it('refuses non-finite navigation and keeps fit finite in a collapsed area', () => {
    const v = { zoom: 1, pan: { x: 0, y: 0 } }
    expect(zoomAt(v, { x: NaN, y: 10 }, 2)).toEqual(v)
    expect(zoomAt(v, { x: 10, y: 10 }, Infinity)).toEqual(v)
    expect(fitView({ w: 460, h: 460 }, { w: 0, h: 0 }).zoom).toBe(0.01)
  })
})
