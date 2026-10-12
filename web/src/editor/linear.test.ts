import { describe, expect, it } from 'vitest'
import { CLEAR, decode, encode, flat, store } from './linear'

describe('the sRGB target with linear-light blending', () => {
  it('matches the reported stored-sRGB ramp midpoint and CSS within one byte', () => {
    const middle = [(.5 * (95 + 46)), (.5 * (217 + 139)), (.5 * (168 + 110))]
    middle.forEach((c, i) => expect(Math.abs(c - [70.6, 177.9, 138.9][i])).toBeLessThan(0.2))
    middle.map(c => encode(store(decode(c)))).forEach((c, i) => expect(Math.abs(c - [70, 178, 139][i])).toBeLessThanOrEqual(1))
  })
  const show = (hex: string) => [1, 3, 5].map(i => flat(parseInt(hex.slice(i, i + 2), 16)))
  it('preserves dark flat colours through the float-colour path', () => {
    expect(show('#0A121C')).toEqual([10, 18, 28])
    expect(show('#070D16')).toEqual([7, 13, 22])
    expect(show('#12202F')).toEqual([18, 32, 47])
    expect(show('#080C10')).toEqual([8, 12, 16])
    for (let c = 0; c < 256; c++) expect(flat(c)).toBe(c)
    for (const c of [5, 10, 20]) expect(flat(c)).toBe(c)
  })
  it('keeps mid and bright colours', () => {
    for (const c of [64, 128, 200, 255]) expect(Math.abs(flat(c) - c)).toBeLessThanOrEqual(1)
  })
  it('keeps opacity blending in linear light', () => {
    expect(encode(store((decode(0) + decode(255)) / 2))).toBe(188)
  })
  it('blends a translucent colour in linear light, as 14-ztext\'s capture shows', () => {
    // The historical 14-ztext capture reads (211, 80, 58), within one byte of the new undithered model.
    // Its alpha dither explains that tolerance; sRGB opacity blending is 17 red levels out.
    const over = (fg: number, bg: number) => encode(store(0.85 * decode(fg) + 0.15 * decode(bg)))
    const shown = [over(0xe2, 0x0a), over(0x56, 0x12), over(0x3d, 0x1c)]
    expect(shown).toEqual([210, 80, 57])
    shown.forEach((c, i) => expect(Math.abs(c - [211, 80, 58][i])).toBeLessThanOrEqual(1))
  })
  it('clears the capture target to transparent without a stand-in ground', () => {
    expect(CLEAR).toEqual([0, 0, 0, 0])
  })
})
