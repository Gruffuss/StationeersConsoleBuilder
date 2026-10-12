/**
 * The share of pixels (0-100) whose largest colour channel difference exceeds `tolerance`, and a w × h mask that is 1
 * on exactly those pixels. Both buffers are RGBA, top row first. Alpha is not compared: a console capture's alpha is
 * its render texture's, with different alpha blend semantics. RGB is immaterial when both pixels are transparent.
 */
export function diffPercent(a: Uint8Array, b: Uint8Array, w: number, h: number, tolerance: number) {
  const n = w * h
  if (a.length !== n * 4 || b.length !== n * 4) throw new RangeError(`diffPercent: expected two ${w}×${h} RGBA buffers`)
  const mask = new Uint8Array(n)
  let count = 0
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
    if (d > tolerance) {
      mask[p] = 1
      count++
    }
  }
  return { percent: n ? count / n * 100 : 0, mask }
}
