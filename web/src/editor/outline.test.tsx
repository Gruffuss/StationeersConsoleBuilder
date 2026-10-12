// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { label } from '../runtime/testing'
import { labelStyle } from './text'
import { TextLayer } from './TextLayer'

// Author's vector 0.11.113 formula, at size = sampling point size (one atlas px = one scene unit).
// other = 3/16. At target/(gs-1) = 33/40, W = 99/112, other+W = 15/14: bold ratio = 14/15.
// W caps at 1: other+W = 19/16, bold ratio = 16/19; outward cap = (gs-1)*16/19.
describe.each([
  { face: 'LiberationSans SDF', font: null, size: 86, weight: 700, base: 27 / 688, knee: 14.625, past: 14.85, exhausted: 18, beyond: 24, cap: 288 / 19, percent: '63.2' },
  { face: 'Fonts-mod Barlow', font: 'Barlow', size: 48, weight: 1000, base: 5 / 128, knee: 8.125, past: 8.25, exhausted: 10, beyond: 16, cap: 160 / 19, percent: '52.6' },
])('$face outline calibration', ({ font, size, weight, base, knee, past, exhausted, beyond, cap, percent }) => {
  const text = `<font-weight=${weight}>x</font-weight>y`
  const t = (ow: number, overrides = {}) => label({ font, size, text, bold: font === null, outlineWidth: ow, outlineColour: [1, 0, 0, 1], ...overrides })
  const markup = (ow: number, overrides = {}) => renderToStaticMarkup(<TextLayer labels={[t(ow, overrides)]} zoom={2} />)
  const stroke = (html: string) => [...html.matchAll(/-webkit-text-stroke-width:([\d.e+-]+)em/g)].map(m => Number(m[1])).find(n => n > 0)!

  it.each([['none', 0], ['below knee', knee / 2], ['at knee', knee]] as const)('keeps faux bold and requested outline %s', (_case, ow) => {
    expect(stroke(markup(ow))).toBeCloseTo(base, 12)
    if (ow) expect(parseFloat(String(labelStyle(t(ow), 2).WebkitTextStroke))).toBeCloseTo(ow * 2, 12)
    expect(markup(ow)).not.toContain('the outline is reduced')
  })
  it('shrinks faux bold past the knee by 14/15 while preserving spacing and outline', () => {
    const html = markup(past)
    expect(stroke(html)).toBeCloseTo(base * 14 / 15, 12)
    expect(html).toContain('letter-spacing:0.07em')
    expect(html).toContain(` + ${past * 2}px)`)
    expect(html).not.toContain('the outline is reduced')
    if (font === null) expect(parseFloat(String(labelStyle(t(past), 2).WebkitTextStrokeWidth))).toBeCloseTo(base * 14 / 15, 12)
  })
  it.each([['before atlas exhaustion', exhausted * 0.9], ['at atlas exhaustion', exhausted], ['past atlas exhaustion', beyond]] as const)('caps the outline %s', (_case, ow) => {
    expect(parseFloat(String(labelStyle(t(ow), 2).WebkitTextStroke))).toBeCloseTo(cap * 2, 12)
    const html = markup(ow)
    expect(stroke(html)).toBeCloseTo(base * 16 / 19, 12)
    expect(html).toContain(` + ${cap * 2}px)`)
  })
  it('reports the reduced outline percentage on its label', () => {
    expect(markup(beyond)).toContain(`Label 1: the outline is reduced to ${percent}%`)
  })
  it('caps simple labels and outlines beneath inset shadows', () => {
    for (const insetShadow of [null, [1, 1, 2, 0, 0, 0, 1]]) {
      const html = markup(beyond, { text: 'plain', bold: false, insetShadow })
      expect(html).toContain(`-webkit-text-stroke:${cap * 2}px`)
      expect(html).toContain(`Label 1: the outline is reduced to ${percent}%`)
    }
  })
  it('uses the label base size for material padding across rich-text sizes', () => {
    expect(stroke(markup(past, { text: `<size=50%><font-weight=${weight}>x</font-weight></size>` }))).toBeCloseTo(base * 14 / 15, 12)
    expect(stroke(markup(past / 2, { size: size / 2 }))).toBeCloseTo(base * 14 / 15, 12)
    expect(stroke(markup(past / size, { size: 0 }))).toBeCloseTo(base * 14 / 15, 12)
  })
})
