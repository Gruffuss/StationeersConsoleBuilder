import { describe, expect, it } from 'vitest'
import { diffPercent } from './diff'

const W = 3, H = 2
const image = () => new Uint8Array(W * H * 4).fill(100)

describe('diffPercent', () => {
  it('gives 0% and an empty mask for identical buffers', () => {
    const r = diffPercent(image(), image(), W, H, 4)
    expect(r.percent).toBe(0)
    expect([...r.mask]).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('counts a pixel whose largest colour channel difference exceeds the tolerance, and masks exactly those', () => {
    const b = image()
    b[1 * 4 + 2] += 5    // pixel 1: blue off by 5, counted
    b[2 * 4 + 0] += 4    // pixel 2: red off by exactly the tolerance, not counted
    b[3 * 4 + 1] -= 5    // pixel 3: green off by 5 the other way, counted
    b[4 * 4 + 0] -= 3    // pixel 4: red off by 3, not counted
    b[5 * 4 + 3] -= 100  // pixel 5: alpha is not a colour (a capture's alpha is its render texture's), not counted
    const r = diffPercent(image(), b, W, H, 4)
    expect([...r.mask]).toEqual([0, 1, 0, 1, 0, 0])
    expect(r.percent).toBeCloseTo(200 / 6, 9)
  })

  it('takes the largest channel difference, red included, not their sum', () => {
    const b = image()
    b[0] += 5                                 // pixel 0: red alone off by 5, counted
    for (const c of [4, 5, 6]) b[c] += 3      // pixel 1: red, green and blue each off by 3 (9 in all), not counted
    const r = diffPercent(image(), b, W, H, 4)
    expect([...r.mask]).toEqual([1, 0, 0, 0, 0, 0])
  })

  it('reads row 0 as the top: a pair that differs only in its top row masks exactly the first w entries', () => {
    const b = image()
    b.fill(0, 0, W * 4)
    const r = diffPercent(image(), b, W, H, 4)
    expect([...r.mask]).toEqual([1, 1, 1, 0, 0, 0])
    expect(r.percent).toBe(50)
  })

  it('refuses buffers that are not w × h RGBA', () => {
    expect(() => diffPercent(image(), new Uint8Array(W * 4), W, H, 4)).toThrow(RangeError)
  })
})
it('ignores colour in two transparent pixels, while retaining visible differences', () => {
  const r = diffPercent(new Uint8Array([0, 0, 0, 0, 40, 40, 40, 255]),
    new Uint8Array([48, 48, 48, 0, 48, 48, 48, 255]), 2, 1, 4)
  expect([...r.mask]).toEqual([0, 1])
  expect(r.percent).toBe(50)
})
