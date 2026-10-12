import { makeRenderer } from '../src/editor/gl'
import { decode, encode } from '../src/editor/linear'
import type { Frame } from '../src/runtime/frame'

// Browser entry: bundle with Vite and run in WebGL 2; no fake rasterizer.
const results: { name: string; pass: boolean; detail: string }[] = []
const check = (name: string, run: () => void) => {
  try { run(); results.push({ name, pass: true, detail: '' }) }
  catch (e) { results.push({ name, pass: false, detail: String(e) }) }
}
const assert = (ok: boolean, detail: string) => { if (!ok) throw new Error(detail) }
const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
const renderer = makeRenderer(canvas), gl = canvas.getContext('webgl2')!
const empty: Frame = { positions: new Float32Array(), colours: new Uint8Array(), coverage: new Float32Array(),
  indices: new Uint32Array(), spans: new Int32Array(), elements: [], text: [], problems: [] }
const square = (alpha: number): Frame => ({ ...empty,
  positions: new Float32Array([0, 0, 64, 0, 64, 64, 0, 64]),
  colours: new Uint8Array([0, 0, 0, alpha, 0, 0, 0, alpha, 0, 0, 0, alpha, 0, 0, 0, alpha]),
  storedColours: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  coverage: new Float32Array([1, 1, 1, 1]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) })
const displayed = () => {
  const p = new Uint8Array(64 * 64 * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, p)
  return p
}
const pixel = (p: Uint8Array, x: number, y: number) => [...p.slice(4 * (64 * y + x), 4 * (64 * y + x + 1))]
const expectPixel = (p: Uint8Array, x: number, y: number, value: number) => {
  const actual = pixel(p, x, y)
  assert(actual.join() === [value, value, value, 255].join(), `(${x},${y})=${actual}; expected ${value}`)
}
check('empty target is transparent and display is an 8 CSS px checker', () => {
  renderer.draw(empty, { w: 64, h: 64 })
  assert(renderer.readPixels().every(v => v === 0), 'empty target contains painted ground')
  const shown = displayed()
  expectPixel(shown, 1, 1, 40); expectPixel(shown, 9, 1, 48); expectPixel(shown, 17, 1, 40); expectPixel(shown, 1, 9, 48)
})
check('translucent geometry shows the checker through linear-light blending', () => {
  renderer.draw(square(128), { w: 64, h: 64 })
  const raw = renderer.readPixels(), shown = displayed()
  assert(pixel(raw, 1, 1)[0] === 0 && Math.abs(pixel(raw, 1, 1)[3] - 128) <= 2, `raw=${pixel(raw, 1, 1)}`)
  for (const [x, expected] of [[1, encode(decode(40) * (1 - 128 / 255))], [9, encode(decode(48) * (1 - 128 / 255))]]) {
    const p = pixel(shown, x, 1)
    assert(p[3] === 255 && p.slice(0, 3).every(v => Math.abs(v - expected) <= 1), `display ${x}=${p}; expected ${expected}`)
  }
})
check('an opaque page-filling shape hides the checker; removing it reveals transparency', () => {
  renderer.draw(square(255), { w: 64, h: 64 })
  const shown = displayed()
  assert(pixel(shown, 1, 1).slice(0, 3).every(v => v <= 1) && pixel(shown, 9, 1).slice(0, 3).every(v => v <= 1), 'checker remains visible under opaque black')
  assert(renderer.readPixels()[3] >= 253, 'opaque target alpha lost')
  renderer.draw(empty, { w: 64, h: 64 })
  expectPixel(displayed(), 1, 1, 40)
  assert(renderer.readPixels().every(v => v === 0), 'opaque shape remains in raw target')
})
check('checker size stays fixed at zoom 2 and the workspace remains transparent', () => {
  renderer.draw(empty, { w: 32, h: 32 }, undefined, undefined, { zoom: 2, pan: { x: 0, y: 0 } }, { w: 64, h: 64 })
  expectPixel(displayed(), 1, 1, 40); expectPixel(displayed(), 9, 1, 48)
  renderer.draw(empty, { w: 16, h: 16 }, undefined, undefined, { zoom: 2, pan: { x: 8, y: 8 } }, { w: 64, h: 64 })
  assert(pixel(displayed(), 1, 1)[3] === 0, 'workspace was painted')
})
check('cover RGB blends over the same linear checker while alpha records only covering geometry', () => {
  renderer.draw(square(128), { w: 64, h: 64 })
  const main = displayed(), c = document.createElement('canvas'); c.width = c.height = 64
  const cover = makeRenderer(c, true), cg = c.getContext('webgl2')!
  cover.draw(square(128), { w: 64, h: 64 }, [{ x0: 0, y0: 0, x1: 64, y1: 64, first: 0, label: 0, cover: 0, layer: 0 }])
  const p = new Uint8Array(64 * 64 * 4)
  cg.readPixels(0, 0, 64, 64, cg.RGBA, cg.UNSIGNED_BYTE, p)
  for (const x of [1, 9]) {
    const actual = pixel(p, x, 1), m = pixel(main, x, 1)
    const expected = encode(decode(x === 1 ? 40 : 48) * (1 - 128 / 255))
    assert(m.slice(0, 3).every(v => Math.abs(v - expected) <= 1), 'cover must match the linear checker composite')
    assert(Math.abs(actual[3] - 128) <= 2 && actual.slice(0, 3).every((v, i) => Math.abs(v - m[i] * actual[3] / 255) <= 1), 'cover=' + actual + '; main=' + m)
  }
  cover.dispose()
})
check('checker cells remain 8 CSS px on a two-pixel-per-CSS-pixel buffer', () => {
  renderer.draw(empty, { w: 32, h: 32 }, undefined, undefined, { zoom: 1, pan: { x: 0, y: 0 } }, { w: 32, h: 32 })
  expectPixel(displayed(), 1, 1, 40); expectPixel(displayed(), 17, 1, 48); expectPixel(displayed(), 33, 1, 40)
})
renderer.dispose()
document.body.textContent = JSON.stringify(results)
