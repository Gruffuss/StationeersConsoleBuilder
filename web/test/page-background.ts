import { makeRenderer } from '../src/editor/gl'
import { decodeFrame } from '../src/runtime/frame'
const frames = (globalThis as unknown as { backgroundFrames: Record<string, string> }).backgroundFrames
const results: { name: string; pass: boolean; detail: string }[] = []
for (const name of ['none', 'translucent']) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
  const renderer = makeRenderer(canvas), gl = canvas.getContext('webgl2')!
  try {
    const bytes = Uint8Array.from(atob(frames[name]), c => c.charCodeAt(0))
    renderer.draw(decodeFrame(bytes.buffer), { w: 64, h: 64 })
    const raw = renderer.readPixels()
    const emptyAlpha = raw[4 * (64 * 8 + 8) + 3]
    if (emptyAlpha !== 0) throw new Error('exported page empty target alpha=' + emptyAlpha)
    const shown = new Uint8Array(raw.length)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, shown)
    const pixel = (x: number, y: number) => [...shown.slice(4 * (64 * y + x), 4 * (64 * y + x + 1))]
    // Probe the empty interior; the mod deliberately draws a 2 px diagnostic border around an empty scene.
    if (pixel(9, 9).join() !== '40,40,40,255' || pixel(17, 9).join() !== '48,48,48,255')
      throw new Error('exported page does not show checker: ' + pixel(9, 9) + '; ' + pixel(17, 9))
    if (name === 'translucent') {
      const a = raw[4 * (64 * 32 + 32) + 3]
      if (Math.abs(a - 128) > 2) throw new Error('shape flattened: alpha=' + a)
      // The actual exported black rectangle, 50% opacity, dims the checker in linear light.
      if (pixel(33, 33).slice(0, 3).some(v => Math.abs(v - 26) > 1)
        || pixel(41, 33).slice(0, 3).some(v => Math.abs(v - 32) > 1)) throw new Error('checker absent under exported translucent shape')
    }
    results.push({ name, pass: true, detail: '' })
  } catch (e) { results.push({ name, pass: false, detail: String(e) }) }
  finally { renderer.dispose() }
}
document.body.textContent = JSON.stringify(results)
