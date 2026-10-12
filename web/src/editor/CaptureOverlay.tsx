// Dev: lays a console capture (a PNG picked here; it never leaves the browser) over the canvas, and measures how far the
// preview's own pixels are from it. Text is DOM over the canvas, so "Measure" sees shapes only. A capture is never
// pixel-identical (dither noise, TextMeshPro text, sRGB target rounding): read the share as where to look.
import { useEffect, useRef, useState } from 'react'
import type { Renderer } from './Canvas'
import { diffPercent } from './diff'

const TOLERANCE = 4  // in 255ths

type Capture = { url: string; bitmap: ImageBitmap }

/** `run` names what the canvas runs: when it or the surface changes, the last result no longer applies. */
export function CaptureOverlay({ renderer, size, run }: { renderer: Renderer | null; size: { w: number; h: number }; run: string }) {
  const [capture, setCapture] = useState<Capture | null>(null)
  const [opacity, setOpacity] = useState(0.5)
  const [difference, setDifference] = useState(false)
  const [result, setResult] = useState<{ percent: number; mask: Uint8Array } | string | null>(null)
  const mask = useRef<HTMLCanvasElement>(null)
  const latest = useRef(0)   // bumped by each pick and by the unmount: a decode that ends after either is dropped
  useEffect(() => () => { latest.current++ }, [])

  useEffect(() => () => {
    if (!capture) return
    URL.revokeObjectURL(capture.url)
    capture.bitmap.close()
  }, [capture])

  useEffect(() => {
    latest.current++
    setCapture(null)
    setResult(null)
  }, [run, size.w, size.h])

  useEffect(() => {
    const c = mask.current
    if (!c || typeof result !== 'object' || !result) return
    const img = new ImageData(size.w, size.h)
    result.mask.forEach((m, i) => { if (m) img.data.set([255, 0, 0, 160], i * 4) })
    c.getContext('2d')!.putImageData(img, 0, 0)
  }, [result, size])

  // Decoded as stored (no colour conversion), and refused unless it is exactly the surface's size: resampling would
  // invent the pixels it is compared on.
  const pick = async (f: File | undefined) => {
    const mine = ++latest.current
    setCapture(null)
    setResult(null)
    if (!f) return
    try {
      const bitmap = await createImageBitmap(f, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      if (mine !== latest.current) return bitmap.close()   // its URL is not made yet
      const { width, height } = bitmap
      if (width !== size.w || height !== size.h) {
        bitmap.close()
        return setResult(`refused: the capture is ${width}×${height}, the surface ${size.w}×${size.h}`)
      }
      setCapture({ url: URL.createObjectURL(f), bitmap })
    } catch (e) {
      if (mine === latest.current) setResult(`could not read the capture: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const measure = () => {
    if (!capture || !renderer) return
    try {
      const ctx = new OffscreenCanvas(size.w, size.h).getContext('2d')!
      ctx.drawImage(capture.bitmap, 0, 0)
      const pixels = new Uint8Array(ctx.getImageData(0, 0, size.w, size.h).data.buffer)
      setResult(diffPercent(renderer.readPixels(), pixels, size.w, size.h, TOLERANCE))
    } catch (e) {
      setResult(`could not measure: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const pending = run === '18-lines' ? 'not compared: old geometry capture'
    : run === '19-webfonts' ? 'pending: loaded-font and fallback captures' : ''
  const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } as const
  // The controls sit beside the surface; their presses must not reach the canvas's pointer handler.
  return <>
    {capture && <img src={capture.url} alt="" style={{ ...layer, opacity, mixBlendMode: difference ? 'difference' : 'normal' }} />}
    {typeof result === 'object' && result && <canvas ref={mask} width={size.w} height={size.h} style={{ ...layer, imageRendering: 'pixelated' }} />}
    <div onPointerDown={e => e.stopPropagation()}
      style={{ position: 'absolute', left: 'calc(100% + 12px)', top: 0, width: '16em', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input type="file" accept="image/png" aria-label="Console capture" onChange={e => void pick(e.target.files?.[0])} />
      <label>Opacity <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={e => setOpacity(+e.target.value)} /></label>
      <label><input type="checkbox" checked={difference} onChange={e => setDifference(e.target.checked)} /> Difference blend</label>
      <button type="button" disabled={!capture || !renderer} onClick={measure}>Measure</button>
      <output>{typeof result === 'string' ? result
        : result ? `${result.percent.toFixed(2)} % of pixels differ by more than ${TOLERANCE}/255 (shapes only; red)` : pending}</output>
    </div>
  </>
}
