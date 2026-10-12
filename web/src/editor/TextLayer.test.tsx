// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { label } from '../runtime/testing'
import { mount, run } from '../testing'
import { importFont, removeFont, registerPageFonts } from './fonts'
import { offSurface } from './text'
import { measure, TextLayer } from './TextLayer'

// labelStyle counted: a label the memo skips is not styled again.
const styled = vi.hoisted(() => ({ calls: 0 }))
vi.mock('./text', async importOriginal => {
  const m = await importOriginal<typeof import('./text')>()
  return { ...m, labelStyle: (...a: Parameters<typeof m.labelStyle>) => { styled.calls++; return m.labelStyle(...a) } }
})

describe('TextLayer', () => {
  it('redraws ordinary/tagged text and late slots on unchanged frames, then redraws on subset load', async () => {
    const own = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete() {} } })
    const loaded: (() => void)[] = []
    vi.stubGlobal('FontFace', class { loaded = new Promise<void>(resolve => loaded.push(resolve)) })
    const labels = [label({ font: 'Page Run', text: 'ordinary' }), label({ font: 'Page Run', text: '<b>bold</b>' }),
      label({ text: '<font="Page Run">tag</font>' }), label({ font: 'Barlow', text: 'unaffected' })]
    const ui = mount(<TextLayer labels={labels} zoom={1} />)
    const group = (style: string, weight: number) => ({ family: 'CSS', style: 'normal', weight: String(weight), minWeight: weight, maxWeight: weight, representative: 'https://fonts.gstatic.com/page-run.woff2', sources: [{ url: 'https://fonts.gstatic.com/page-run.woff2', unicodeRange: 'U+0-FF', display: 'swap' as const }], metadata: { status: 'ok' as const, names: {}, axes: [], faces: [], family: 'Page Run', style, instances: [] } })
    try {
      expect(ui.container.textContent).toContain('<font="Page Run">')
      styled.calls = 0
      await run(() => { registerPageFonts('page-run', [group('Regular', 400)]) })
      expect(styled.calls).toBe(3)
      expect(ui.container.querySelector('[role=status]')).toBeNull()
      expect(ui.container.textContent).not.toContain('<font="Page Run">')
      styled.calls = 0
      await run(() => { registerPageFonts('page-run-bold', [group('Bold', 700)]) })
      expect(styled.calls).toBe(3)
      expect(ui.container.querySelectorAll('span')[0].style.fontWeight).toBe('700')
      styled.calls = 0
      await run(async () => { loaded[1](); await Promise.resolve() })
      expect(styled.calls).toBe(3)
    } finally {
      ui.unmount(); vi.unstubAllGlobals()
      if (own) Object.defineProperty(document, 'fonts', own)
      else delete (document as { fonts?: unknown }).fonts
    }
  })
  it('keeps faux bold and attribute spacing tied to base size and tag spacing in label units', async () => {
    const own = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete() {} } })
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    await importFont('Run Dilation', new ArrayBuffer(8), false)
    const ui = mount(<TextLayer labels={[label({ font: 'Run Dilation', size: 40, charSpacing: 5, text: '<b>a<size=20><cspace=2>b</cspace></size>c</b>d' })]} zoom={2} />)
    try {
      const spans = Array.from(ui.container.querySelectorAll('span'))
      expect(spans.map(s => [s.textContent, s.style.fontSize, s.style.letterSpacing])).toEqual([
        ['a', '80px', '0.12em'], ['b', '40px', '0.34em'], ['c', '80px', '0.12em'], ['d', '80px', '0.05em'],
      ])
      const html = renderToStaticMarkup(<TextLayer labels={[label({ font: 'Run Dilation', text: '<b>x</b>y' })]} zoom={1} />)
      expect(html).toContain('-webkit-text-stroke-width:0.0390625em')
      expect(html).toContain('-webkit-text-stroke-width:0em')
      const outlined = renderToStaticMarkup(<TextLayer labels={[label({ font: 'Run Dilation', size: 48, bold: true, outlineWidth: 8, outlineColour: [1, 0, 0, 1] })]} zoom={1} />)
      expect(outlined).toContain('-webkit-text-stroke-color:rgba(255,0,0,1)')
      expect(outlined).toContain('calc(0.0390625em + 8px)')
      expect(outlined).not.toContain('the outline is reduced')
      expect(outlined).toContain('aria-hidden="true"')
    } finally { ui.unmount(); await removeFont('Run Dilation'); vi.unstubAllGlobals(); if (own) Object.defineProperty(document, 'fonts', own); else delete (document as { fonts?: unknown }).fonts }
  })
  it.each([
    ['attribute', 'NoSuchFace', 'x y', 'Not available here, so drawn in Liberation Sans: NoSuchFace.', 'Liberation Sans'],
    ['tag', 'Barlow', '<font="NoSuchFace">x</font> y', 'Unknown font tags shown as text: NoSuchFace.', 'Barlow'],
  ])('explains how an unavailable face in a %s is previewed', (_kind, font, text, message, drawnFace) => {
    const ui = mount(<TextLayer labels={[label({ font, text })]} zoom={1} />)
    try {
      expect(ui.container.querySelector('[role=status]')!.textContent).toContain(message)
      expect(ui.container.querySelector<HTMLElement>('[data-box]')!.style.fontFamily).toContain(drawnFace)
      expect(ui.container.querySelector('[data-box]')!.textContent).toBe(text)
      if (_kind === 'tag') expect(ui.container.querySelector('[role=status]')!.textContent).not.toContain('drawn in Liberation Sans')
    } finally { ui.unmount() }
  })
  it('restyles only labels affected by an imported face, including an unknown font tag', async () => {
    const own = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete: () => true } })
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    vi.stubGlobal('indexedDB', undefined)
    const labels = [label({ font: 'Barlow' }), label({ font: 'Selective Display' }),
      label({ font: 'Barlow', text: '<font="Selective Display">tag</font>' })]
    const ui = mount(<TextLayer labels={labels} zoom={1} />)
    try {
      styled.calls = 0
      await run(async () => { await importFont('Selective Display', new ArrayBuffer(8), false) })
      expect(styled.calls).toBe(2)
      styled.calls = 0
      await run(async () => { await removeFont('Selective Display') })
      expect(styled.calls).toBe(2)
    } finally {
      ui.unmount(); await removeFont('Selective Display'); vi.unstubAllGlobals()
      if (own) Object.defineProperty(document, 'fonts', own)
      else delete (document as { fonts?: unknown }).fonts
    }
  })
  it('lays out no label that surely draws nothing on the surface, and keeps every other (no cap: ruling 16)', () => {
    const size = { w: 460, h: 460 }
    // 5,000 rows of a Repeater 56 apart: the surface shows the first nine. A few past them are laid out (the reach is
    // generous); the thousands beyond are kept in the list, not laid out.
    const rows = Array.from({ length: 5000 }, (_, k) => label({ text: `Pump ${k}`, x: 24, y: 24 + k * 56, w: 300, h: 39, size: 28 }))
    const shown = renderToStaticMarkup(<TextLayer labels={rows} zoom={1} size={size} />).match(/Pump \d+/g)!
    expect(shown.slice(0, 9)).toEqual(Array.from({ length: 9 }, (_, k) => `Pump ${k}`))
    expect(shown.length).toBeLessThan(30)
    // Text past its box, a shadow, an outline or a slant may reach the surface: such a label is laid out.
    for (const t of [label({ text: 'x'.repeat(40), x: -500, y: 20 }), label({ x: 470, shadow: [-30, 0, 0, 0, 0, 0, 1] }),
      label({ y: -50, h: 10, rotation: 90, w: 120 }), label({ x: 2000, shear: [1, 1, 0, 1] })])
      expect(offSurface(t, size)).toBe(false)
    expect([label({ x: 900 }), label({ y: -200 })].map(t => offSurface(t, size))).toEqual([true, true])
    expect(renderToStaticMarkup(<TextLayer labels={rows.slice(0, 20)} zoom={1} />).match(/Pump \d+/g)).toHaveLength(20)   // no size: no cull
  })
  it('draws a label again in a face imported or removed after its frame, its labels unchanged (the memo follows the fonts)', async () => {
    const own = Object.getOwnPropertyDescriptor(document, 'fonts')
    vi.stubGlobal('FontFace', class { constructor(readonly family: string) {} load() { return Promise.resolve(this) } })
    vi.stubGlobal('indexedDB', undefined)
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete: () => true } })
    try {
      const labels = [label({ font: 'Zed Display', text: 'zed' })]
      const ui = mount(<TextLayer labels={labels} zoom={1} />)
      const face = () => ui.container.querySelector<HTMLElement>('div[style*="font-family"]')!.style.fontFamily
      const note = () => ui.container.querySelector('[role=status]')
      expect(face()).not.toContain('Zed Display')
      expect(note()).not.toBeNull()
      styled.calls = 0
      ui.rerender(<TextLayer labels={labels.map(t => ({ ...t }))} zoom={1} />)   // an equal frame, the fonts unchanged
      expect(styled.calls).toBe(0)   // the memo skips the label
      await run(async () => { await importFont('Zed Display', new ArrayBuffer(8), false) })   // as a reload brings it back
      expect(face()).toContain('Zed Display')
      expect(note()).toBeNull()
      ui.rerender(<TextLayer labels={labels.map(t => ({ ...t }))} zoom={1} />)   // the next frame, the same labels
      expect(face()).toContain('Zed Display')
      await run(async () => { await removeFont('Zed Display') })
      expect(face()).not.toContain('Zed Display')
      ui.unmount()
    } finally {
      await removeFont('Zed Display')
      vi.unstubAllGlobals()
      if (own) Object.defineProperty(document, 'fonts', own)
      else delete (document as { fonts?: unknown }).fonts
    }
  })
  it('measures each laid-out label\'s box and text in surface px, joining the boxes of one label', () => {
    // No layout here: the text layer sits at (10, 20) CSS px; a range reads a rect by the box it selected (selectNode
    // selects the box itself, with its text), and none otherwise.
    const rects: Record<string, [number, number, number, number]> = { 0: [40, 60, 100, 30], 1: [10, 20, 20, 20], '1 copy': [30, 30, 40, 10] }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: 20, width: 0, height: 0 }))
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
      const e = this.startContainer.childNodes[this.startOffset] as Element | undefined, k = e?.getAttribute?.('data-box')
      const [x, y, width, height] = rects[`${k}${e?.getAttribute('aria-hidden') === 'true' ? ' copy' : ''}`] ?? [0, 0, 0, 0]
      return DOMRect.fromRect({ x, y, width, height })
    })
    try {
      const labels = [label({ text: 'wide' }), label({ text: 'inset', shadow: [0, 1, 2, 0, 0, 0, 1], insetShadow: [1, 1, 1, 0, 1, 0, 1] }),
        label({ text: 'unmeasured' }), label({ text: 'off', x: 9000 })]
      const ui = mount(<TextLayer labels={labels} zoom={2} size={{ w: 100, h: 100 }} />)
      const root = ui.container
      expect(measure(root, 2)).toEqual([{ x0: 15, y0: 20, x1: 65, y1: 35 }, { x0: 0, y0: 0, x1: 30, y1: 10 }])
      expect(measure(root, 2)).toHaveLength(2)   // the unmeasured and the off-surface labels have none
      expect(measure(root, 0)).toEqual([])
      ui.unmount()
    } finally {
      vi.restoreAllMocks()
    }
  })
  it('renders font, weight, bold and italic tags through real faces; italic keeps the current slot', () => {
    const ui = mount(<TextLayer labels={[label({ font: 'Barlow', text: '<font-weight=600>semi</font-weight> plain <font="Barlow Condensed SemiBold"><b>bold</b><i>upright</i></font> end' })]} zoom={1} />)
    const spans = Array.from(ui.container.querySelectorAll<HTMLElement>('[data-box] span'))
    expect(spans.map(e => e.textContent)).toEqual(['semi', ' plain ', 'bold', 'upright', ' end'])
    expect(spans.map(e => e.style.fontFamily.split(',')[0].replaceAll('"', ''))).toEqual(['Barlow SemiBold', 'Barlow', 'Barlow Condensed Bold', 'Barlow Condensed Italic', 'Barlow'])
    expect(spans.every(e => e.style.fontWeight === 'normal' && e.style.fontStyle === 'normal' && e.style.fontSynthesis === 'none')).toBe(true)
    ui.unmount()
  })
  it.each([
    [0, undefined, { x0: -2, y0: -4, x1: 10, y1: 20 }],
    [90, undefined, { x0: -9, y0: 5, x1: 15, y1: 17 }],
    [0, [1, 0.5, 0, 1], { x0: -7, y0: -4, x1: 17, y1: 20 }],
  ] as [number, number[] | undefined, { x0: number; y0: number; x1: number; y1: number }][])('joins per-line glyph ink with DOM boxes at rotation %s, shear %s, using the drawn font and kerning', (rotation, shear, expected) => {
    const ui = mount(<TextLayer labels={[label({ text: 'Ǻ\nj', x: 0, y: 0, w: 10, h: 20, size: 10, rotation, shear })]} zoom={1} />)
    const seen: string[] = []
    const context = { measureText: (text: string) => {
      seen.push(text)
      return { width: 10, actualBoundingBoxLeft: text === 'j' ? 2 : 0, actualBoundingBoxRight: 10,
        actualBoundingBoxAscent: text === 'Ǻ' ? 12 : 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 8 }
    } } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect(this.dataset.box === undefined ? {} : { width: 10, height: 20 })
    })
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
      if (this.startContainer.nodeType !== Node.TEXT_NODE) return DOMRect.fromRect(rotation ? { x: -5, y: 5, width: 20, height: 10 } : { width: 10, height: 20 })
      return DOMRect.fromRect({ y: this.startOffset === 2 ? 10 : 0, width: this.startOffset === 1 ? 0 : 10, height: 10 })
    })
    try {
      expect(measure(ui.container, 1)).toEqual([expected])
      expect(ui.container.querySelector<HTMLElement>('[data-box]')!.style.transform).toContain(`rotate(${-rotation}deg)`)
      expect(seen).toEqual(['Ǻ', 'j'])
      expect(context.fontKerning).toBe('normal')
      expect(context.font).toContain('10px')
    } finally { ui.unmount(); vi.restoreAllMocks() }
  })
  it.each([
    ['i', -3.75, 13.15], ['i=60', -5, 15.399999999999999], ['i=-35', -5.15, 11.75],
  ])('measures explicitly sheared shaped ink for <%s> without changing advances', (tag, x0, x1) => {
    const ui = mount(<TextLayer labels={[label({ text: '<' + tag + '>j\u0301</i>', x: 0, y: 0, w: 10, h: 10, size: 10 })]} zoom={1} />)
    const measureText = vi.fn(() => ({ width: 10, actualBoundingBoxLeft: 2, actualBoundingBoxRight: 10, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 8 }))
    const context = { measureText } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect(this.dataset.box === undefined && this.tagName !== 'SPAN' ? {} : { width: 10, height: 10 })
    })
    let charReads = 0
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
      if (this.startContainer.nodeType === Node.TEXT_NODE) { charReads++; return DOMRect.fromRect({ width: this.startOffset ? 0 : 10, height: 10 }) }
      return DOMRect.fromRect({ width: 10, height: 10 })
    })
    const rects = vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([DOMRect.fromRect({ width: 10, height: 10 })] as unknown as DOMRectList)
    try {
      expect(measure(ui.container, 1)).toEqual([{ x0, y0: -4, x1, y1: 10 }])
      expect(measureText).toHaveBeenCalledWith('j\u0301')
      expect(charReads).toBe(0)
      expect(context.font).toContain('normal normal 10px')
      // Wrapped/multiple-fragment fallback still shapes the zero-width mark with its base.
      rects.mockReturnValue([] as unknown as DOMRectList)
      measureText.mockClear()
      expect(measure(ui.container, 1)).toEqual([{ x0, y0: -4, x1, y1: 10 }])
      expect(measureText).toHaveBeenCalledWith('j\u0301')
    } finally { ui.unmount(); vi.restoreAllMocks() }
  })
  it('renders a label as text, never as HTML', () => {
    const text = '<img src=x onerror=alert(1)>'
    const html = renderToStaticMarkup(<TextLayer labels={[label({ text })]} zoom={1} />)
    expect(html).not.toMatch(/<img/i)
    // The text content: the markup without its tags, entities decoded.
    const content = html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#x27;/g, '\'').replace(/&amp;/g, '&')
    expect(content).toBe(text)
  })
  it('draws an inset shadow with an SVG filter the label\'s own text box refers to, at the zoom', () => {
    const html = renderToStaticMarkup(<TextLayer labels={[label({ text: 'plain' }), label({ text: 'inset', insetShadow: [1, 1, 1, 0, 1, 0, 1] })]} zoom={2} />)
    const ids = [...html.matchAll(/<filter id="([^"]+)"/g)].map(m => m[1])
    expect(ids).toHaveLength(1)
    expect(html).toMatch(new RegExp(`filter:url\\(#${ids[0].replace(/[^\w-]/g, '\\$&')}\\)[^>]*><div[^>]*>inset<`))
    expect(html).toContain('stdDeviation="1"')
    expect(html).toContain('dx="2"')
    expect(html).toContain('flood-color="rgb(0,255,0)"')
  })
  it('makes the inset from the glyphs alone: the outset shadows and the outline go on a clear copy beneath', () => {
    const html = renderToStaticMarkup(<TextLayer labels={[label({ shadow: [0, 1, 2, 0, 0, 0, 1], outlineWidth: 1, outlineColour: [1, 0, 0, 1],
      insetShadow: [1, 1, 1, 0, 1, 0, 1] })]} zoom={1} />)
    const styles = [...html.matchAll(/<div style="([^"]*)"/g)].map(m => m[1]).filter(s => s.includes('position:absolute'))
    const filtered = styles.filter(s => s.includes('filter:url('))
    expect(filtered).toHaveLength(1)
    expect(filtered[0]).not.toMatch(/text-shadow|text-stroke/)
    const beneath = styles.find(s => s.includes('text-shadow')) ?? ''
    expect(beneath).toContain('color:transparent')
    expect(beneath).toContain('-webkit-text-stroke')
  })
  it('names a face it cannot draw, once, and draws it in the default face', () => {
    const html = renderToStaticMarkup(<TextLayer labels={[label({ font: 'code' }), label({ font: 'code' })]} zoom={1} />)
    const notes = [...html.matchAll(/<div role="status"[^>]*>([^<]*)</g)].map(m => m[1])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('code')
    expect(notes[0]).toContain('Liberation Sans')
  })
  it('has no note for a bundled face or the default', () => {
    for (const font of ['Barlow', null]) expect(renderToStaticMarkup(<TextLayer labels={[label({ font })]} zoom={1} />)).not.toContain('role="status"')
  })
  it('lays a centred or right-aligned line out as TMP does: the inner block is a flex row aligned that way (innerStyle)', () => {
    const html = renderToStaticMarkup(<TextLayer labels={[label({ text: 'mid', align: 1 }), label({ text: 'end', align: 2 })]} zoom={1} />)
    expect(html).toContain('<div style="display:flex;justify-content:center">mid</div>')
    expect(html).toContain('<div style="display:flex;justify-content:flex-end">end</div>')
  })
  it('gives the filter room for text past its box and the blur', () => {
    const html = renderToStaticMarkup(<TextLayer labels={[label({ w: 10, h: 10, size: 12, text: 'a line far wider than its box',
      insetShadow: [0, 0, 4, 0, 1, 0, 1] })]} zoom={1} />)
    const [, x, width] = html.match(/<filter[^>]*filterUnits="userSpaceOnUse"[^>]*x="([^"]+)"[^>]*width="([^"]+)"/) ?? []
    expect(Number(x)).toBeLessThanOrEqual(-29 * 12)
    expect(Number(width)).toBeGreaterThanOrEqual(10 + 2 * 29 * 12)
  })
})
