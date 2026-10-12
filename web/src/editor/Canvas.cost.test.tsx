// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import type { CoreBridge } from '../runtime/bridge'
import type { Frame } from '../runtime/frame'
import { label } from '../runtime/testing'
import { mount, run } from '../testing'
import { Canvas } from './Canvas'

// Exercise the real label and cover planning; only GPU drawing is absent in happy-dom.
vi.mock('./gl', async original => ({ ...await original<typeof import('./gl')>(),
  makeRenderer: () => ({ draw() {}, dispose() {} }),
}))

const frame = (text: Frame['text']): Frame => {
  const positions: number[] = [], indices: number[] = []
  for (let k = 0; k < 8; k++) {
    const x = k * 75, at = positions.length / 2
    positions.push(x, 0, x + 60, 0, x + 60, 600, x, 600)
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3)
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), coverage: new Float32Array(32).fill(1),
    colours: new Uint8Array(128).fill(255), spans: new Int32Array(), problems: [], text,
    elements: [{ id: 'vb', scene: 'p', x: 0, y: 0, w: 600, h: 600, firstVertex: 0, vertexCount: 32 }] }
}

it('reports label-update layout requests and DOM mutations for 200 Barlow labels and eight covering rectangles', async () => {
  const empty = () => ({ geometryReads: 0, computedStyles: 0, inkMeasures: 0, mutations: 0, styleMutations: 0, added: 0, removed: 0 })
  let counts = empty(), deliver!: (f: Frame, ms: number, surface: string) => void
  const bridge = { onFrame: (f: typeof deliver) => { deliver = f; return () => {} }, frame() {} } as unknown as CoreBridge
  const originalStyle = getComputedStyle
  vi.stubGlobal('getComputedStyle', (e: Element) => { counts.computedStyles++; return originalStyle(e) })
  const rect = (e: HTMLElement) => DOMRect.fromRect({ x: parseFloat(e.style.left) || 0, y: parseFloat(e.style.top) || 0,
    width: parseFloat(e.style.width) || 600, height: parseFloat(e.style.height) || 600 })
  const rangeRect = (r: Range) => {
    const n = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement
      : r.startContainer.childNodes[r.startOffset] as HTMLElement
    const e = n instanceof HTMLElement ? n.closest<HTMLElement>('[data-box]') : null
    return e ? rect(e) : DOMRect.fromRect()
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { counts.geometryReads++; return rect(this) })
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) { counts.geometryReads++; return rangeRect(this) })
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) { counts.geometryReads++; return [rangeRect(this)] as unknown as DOMRectList })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: () => {
    counts.inkMeasures++
    return { width: 48, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 48, actualBoundingBoxAscent: 9,
      actualBoundingBoxDescent: 3, fontBoundingBoxAscent: 9 }
  } } as unknown as CanvasRenderingContext2D)
  const labels = Array.from({ length: 200 }, (_, k) => label({ text: `Pump ${k}`, font: 'Barlow', size: 12,
    x: (k % 10) * 60, y: Math.floor(k / 10) * 25, w: 50, h: 14, cover: 0 }))
  const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 600, h: 600 }} tag={false} fixedZoom={1} />)
  const text = ui.container.querySelector('.vb-text')!
  const record = (records: MutationRecord[]) => { for (const r of records) {
    counts.mutations++; if (r.attributeName === 'style') counts.styleMutations++
    counts.added += r.addedNodes.length; counts.removed += r.removedNodes.length
  } }
  const observer = new MutationObserver(record)
  try {
    await run(() => deliver(frame(labels), 0, 'main'))
    expect(text.querySelectorAll('[data-label]')).toHaveLength(200)
    observer.observe(text, { subtree: true, attributes: true, childList: true, characterData: true })
    for (const [operation, next] of [
      ['add', [...labels, label({ ...labels[0], text: 'added', y: 500 })]],
      ['drag', labels.map((t, k) => k ? { ...t } : { ...t, x: t.x + 1 })],
      ['font', labels.map((t, k) => k ? { ...t } : { ...t, font: 'Barlow Medium' })],
      ['colour', labels.map((t, k) => k ? { ...t } : { ...t, colour: [0.5, 0.5, 0.5, 1] })],
      ['cover', labels.map(t => ({ ...t, cover: 4 }))],
    ] as const) {
      await run(() => deliver(frame(labels), 0, 'main'))
      record(observer.takeRecords()); counts = empty()
      await run(() => deliver(frame([...next]), 0, 'main'))
      record(observer.takeRecords())
      console.log(JSON.stringify({ operation, ...counts }))
      const changesLayout = operation === 'add' || operation === 'drag' || operation === 'font'
      expect(counts.inkMeasures).toBe(changesLayout ? 1 : 0)
      expect(counts.geometryReads).toBeLessThanOrEqual(changesLayout ? 4 : 0)
      expect(counts.computedStyles).toBe(changesLayout ? 2 : 0)
      expect(counts.styleMutations).toBeLessThanOrEqual(3)
    }
  } finally { observer.disconnect(); ui.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
