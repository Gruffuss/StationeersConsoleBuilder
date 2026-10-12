import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeFrame, FRAME_KEYS, type FrameElement, type FrameText } from './frame'
import { vbf1 } from './testing'

const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/frames/${name}`, import.meta.url))
const hello = () => { const b = fixture('01-hello.bin'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }
const expected = JSON.parse(fixture('01-hello.expect.json').toString('utf8'))

// A label and an element, typed, so tsc holds each to its type's keys.
const label: FrameText = { element: 0, node: -1, text: 'NaN', x: 1, y: 2, w: 3, h: 4, size: 12, colour: [1, 1, 1, 1], align: 0, valign: 0,
  font: null, bold: false, charSpacing: 0, fit: 0, minSize: 0, rotation: 0, wrap: false, lineHeight: 1, clip: null, shadow: null,
  outlineWidth: 0, outlineColour: null, kern: true, extraShadows: null, insetShadow: null, clipPolygon: null, shear: null, cover: 0 }
const element: FrameElement = { id: 'NaN', scene: 's', x: 0, y: 0, w: 10, h: 10, firstVertex: 0, vertexCount: 0 }

describe('decodeFrame', () => {
  it('keeps named-number strings in VBF2 picture source keys as text', () => {
    const buf = vbf1(JSON.stringify({ elements: [], text: [], problems: [], pending: ['NaN', 'Infinity'],
      images: [{ element: 0, src: 'NaN', first: 0, count: 0 }] }))
    new Uint8Array(buf)[3] = 50
    expect(decodeFrame(buf).pending).toEqual(['NaN', 'Infinity'])
    expect(decodeFrame(buf).images![0].src).toBe('NaN')
  })
  it('decodes VBF2 UVs, image ranges and pending source keys without copying', () => {
    const json = new TextEncoder().encode(JSON.stringify({ elements: [], text: [], problems: [],
      images: [{ element: 0, src: 'data:x', first: 0, count: 3 }], pending: ['https://example.com/a.png'] }))
    const buf = new ArrayBuffer(20 + 24 * 3 + 12 + json.length)
    new Uint8Array(buf, 0, 4).set([86, 66, 70, 50])
    new Int32Array(buf, 4, 4).set([3, 3, 0, json.length])
    new Float32Array(buf, 20, 6).set([0, 0, 10, 0, 0, 10])
    new Float32Array(buf, 44, 3).set([1, .5, 1])
    new Float32Array(buf, 56, 6).set([0, 0, 1, 0, 0, 1])
    new Uint8Array(buf, 80, 12).fill(255)
    new Uint32Array(buf, 92, 3).set([0, 1, 2])
    new Uint8Array(buf, 104).set(json)
    const f = decodeFrame(buf)
    expect([...f.positions]).toEqual([0, 0, 10, 0, 0, 10])
    expect([...f.coverage]).toEqual([1, .5, 1])
    expect([...f.colours]).toEqual(Array(12).fill(255))
    expect([...f.indices]).toEqual([0, 1, 2])
    expect(f.problems).toEqual([])
    expect([...f.uv!]).toEqual([0, 0, 1, 0, 0, 1])
    expect(f.uv!.buffer).toBe(buf)
    expect(f.images).toEqual([{ element: 0, src: 'data:x', first: 0, count: 3 }])
    expect(f.pending).toEqual(['https://example.com/a.png'])
  })
  it('decodes VBF1: colours follow coverage directly, and there are no UVs, images or pending keys', () => {
    // A VBF1 body that names images and pending keys anyway: only VBF2 reads them.
    const json = new TextEncoder().encode(JSON.stringify({ elements: [], text: [], problems: [],
      images: [{ element: 0, src: 'data:x', first: 0, count: 3 }], pending: ['https://example.com/a.png'] }))
    const buf = new ArrayBuffer(20 + 16 * 3 + 12 + json.length)
    new Uint8Array(buf, 0, 4).set([86, 66, 70, 49])
    new Int32Array(buf, 4, 4).set([3, 3, 0, json.length])
    new Float32Array(buf, 20, 6).set([0, 0, 10, 0, 0, 10])
    new Float32Array(buf, 44, 3).set([1, .5, 1])
    new Uint8Array(buf, 56, 12).set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    new Uint32Array(buf, 68, 3).set([0, 1, 2])
    new Uint8Array(buf, 80).set(json)
    const f = decodeFrame(buf)
    expect([...f.positions]).toEqual([0, 0, 10, 0, 0, 10])
    expect([...f.coverage]).toEqual([1, .5, 1])
    expect([...f.colours]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect([...f.indices]).toEqual([0, 1, 2])
    expect(f.colours.buffer).toBe(buf)
    expect(f.problems).toEqual([])
    expect('uv' in f || 'images' in f || 'pending' in f).toBe(false)
    expect(() => decodeFrame(buf.slice(0, buf.byteLength - 1))).toThrow('truncated frame')
  })
  it('decodes the 01-hello fixture', () => {
    const f = decodeFrame(hello())
    expect(f.positions.length).toBe(2 * expected.V)
    expect(f.coverage.length).toBe(expected.V)
    expect(f.colours.length).toBe(4 * expected.V)
    expect(f.indices.length).toBe(expected.I)
    expect(f.spans.length).toBe(4 * expected.S)
    expect(f.text.length).toBe(expected.textCount)
    expect(f.problems.length).toBe(expected.problemCount)
    expect(f.elements.map(e => e.id)).toEqual(['bg', 'hello'])
    expect(f.elements.map(e => e.id)).toEqual(expected.elementIds)
    const first = Float32Array.from(expected.firstPositions)  // float32 values, written as their shortest strings
    expect(first.length).toBe(8)
    first.forEach((p, k) => expect(Math.abs(f.positions[k] - p)).toBeLessThanOrEqual(1e-6))
    // UV1.x includes signed fallback values; compare the complete channel to the core fixture.
    expect([...f.coverage]).toEqual([...new Float32Array(expected.coverage)])
    expect([...f.colours.subarray(0, 4)]).toEqual([0x0a, 0x12, 0x1c, 255])   // 01-hello's bg panel, #0A121C
  })

  it('reads exactly the JSON keys the core writes (test/fixtures/frames/keys.json, checked by the C# FrameTests too)', () => {
    const keys = JSON.parse(fixture('keys.json').toString('utf8'))
    expect(FRAME_KEYS).toEqual(keys)   // in the order the core writes them
  })

  it('throws on a bad magic or a truncated buffer', () => {
    const bad = new Uint8Array(hello())
    bad[3] = 0x39  // an unsupported version
    expect(() => decodeFrame(bad.buffer)).toThrow()
    expect(() => decodeFrame(hello().slice(0, 100))).toThrow()
    expect(() => decodeFrame(new ArrayBuffer(8))).toThrow()
  })

  it('reads valign', () => {
    const f = decodeFrame(vbf1(JSON.stringify({ elements: [], text: [{ ...label, valign: 2 }], problems: [] })))
    expect(f.text[0].valign).toBe(2)
  })

  it('coerces named float literals in numeric fields only', () => {
    const f = decodeFrame(vbf1(JSON.stringify({
      elements: [{ ...element, w: 'Infinity' }], text: [{ ...label, x: 'NaN', colour: [1, '-Infinity', 1, 1] }], problems: [] })))
    expect(f.text[0].x).toBeNaN()
    expect(f.text[0].colour[1]).toBe(-Infinity)
    expect(f.elements[0].w).toBe(Infinity)
    expect(f.text[0].text).toBe('NaN')  // a label may read "NaN"
    expect(f.elements[0].id).toBe('NaN')
  })
})
it('decodes VBF3 edge distance and float stored colour without copies', () => {
  const json = new TextEncoder().encode(JSON.stringify({ elements: [], text: [], problems: [], images: [], pending: [] }))
  const buf = new ArrayBuffer(20 + 44 * 3 + 12 + json.length)
  new Uint8Array(buf, 0, 4).set([86, 66, 70, 51])
  new Int32Array(buf, 4, 4).set([3, 3, 0, json.length])
  new Float32Array(buf, 44, 3).set([1, .5, 1])
  new Float32Array(buf, 56, 3).set([0, .065, -.5])
  new Float32Array(buf, 68, 6).set([0, 0, 1, 0, 0, 1])
  new Uint8Array(buf, 92, 12).fill(255)
  const stored = new Float32Array(buf, 104, 12)
  stored.set([5 / 255, 10 / 255, 20 / 255, 1, .12345, .54321, .75, 1, 1, 1, 1, 0])
  new Uint32Array(buf, 152, 3).set([0, 1, 2])
  new Uint8Array(buf, 164).set(json)
  const f = decodeFrame(buf)
  expect([...f.edge!]).toEqual([...new Float32Array([0, .065, -.5])])
  expect(f.edge!.buffer).toBe(buf)
  expect([...f.storedColours!]).toEqual([...stored])
  expect(f.storedColours!.buffer).toBe(buf)
  expect([...f.uv!]).toEqual([0, 0, 1, 0, 0, 1])
  expect([...f.indices]).toEqual([0, 1, 2])
  expect(() => decodeFrame(buf.slice(0, buf.byteLength - 1))).toThrow('truncated frame')
})
