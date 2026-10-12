// Editor test helpers, imported by tests only (they read files): how wide a label's text runs in a bundled face, from the
// face's own WOFF2 file (the brotli stream, then its cmap and hmtx tables).
import { readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import type { FaceLines } from '../theme/baseline'
import { DEFAULT_FACE, FACES } from './fonts'

type Metrics = FaceLines & { advance: (c: number) => number }
const read = new Map<string, Metrics>()

function metricsOf(face: string): Metrics {
  const f = FACES.find(x => x.name === face && x.weight === 400)
  if (!f) throw new Error(`no bundled face "${face}"`)
  const file = readFileSync(new URL(`../../public/fonts/${f.file}`, import.meta.url))
  const b = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (b.getUint32(0) !== 0x774f4632 || b.getUint32(4) === 0x74746366) throw new Error(`${f.file} is not a single-font WOFF2 file`)
  let at = 48
  const base128 = () => {
    let v = 0
    for (let i = 0; i < 5; i++) { const x = b.getUint8(at++); v = v * 128 + (x & 127); if (!(x & 128)) return v }
    throw new Error(`${f.file}: a UIntBase128 longer than 5 bytes`)
  }
  // The table directory: a known tag's index (cmap 0, head 1, hhea 2, hmtx 3; glyf 10 and loca 11, whose transform version
  // 0 is the transformed one) or 63 and the tag; the length, and the transformed length when transformed. The tables follow
  // one another, unpadded, in the decompressed stream.
  const tables = new Map<number, { off: number; transformed: boolean }>()
  let off = 0
  for (let n = b.getUint16(12); n > 0; n--) {
    const flags = b.getUint8(at++), tag = flags & 63, version = flags >> 6
    if (tag === 63) at += 4
    const length = base128(), transformed = tag === 10 || tag === 11 ? version !== 3 : version !== 0
    tables.set(tag, { off, transformed })
    off += transformed ? base128() : length
  }
  const data = brotliDecompressSync(file.subarray(at, at + b.getUint32(20)))
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength), table = (tag: number) => tables.get(tag)!.off
  const upem = d.getUint16(table(1) + 18), metrics = d.getUint16(table(2) + 34), hmtx = tables.get(3)!
  // hmtx: longHorMetric pairs, or (transformed) a flags byte, then the advances alone
  const adv = (g: number) => d.getUint16(hmtx.off + (hmtx.transformed ? 1 + 2 * Math.min(g, metrics - 1) : 4 * Math.min(g, metrics - 1)))
  // cmap: the Windows Unicode subtable, format 4 (BMP) or 12
  const cmap = table(0), records = d.getUint16(cmap + 2)
  let sub = -1
  for (let i = 0; i < records; i++) {
    const r = cmap + 4 + 8 * i, platform = d.getUint16(r), encoding = d.getUint16(r + 2)
    if (platform === 3 && (encoding === 1 || encoding === 10) || platform === 0) sub = cmap + d.getUint32(r + 4)
  }
  if (sub < 0) throw new Error(`${f.file}: no Unicode cmap`)
  const format = d.getUint16(sub)
  const glyph = (c: number): number => {
    if (format === 12) {
      for (let i = 0, groups = d.getUint32(sub + 12); i < groups; i++) {
        const g = sub + 16 + 12 * i
        if (c >= d.getUint32(g) && c <= d.getUint32(g + 4)) return d.getUint32(g + 8) + c - d.getUint32(g)
      }
      return 0
    }
    if (format !== 4) throw new Error(`${f.file}: cmap format ${format}`)
    const segs = d.getUint16(sub + 6) / 2, ends = sub + 14, starts = ends + 2 * segs + 2, deltas = starts + 2 * segs, ranges = deltas + 2 * segs
    for (let i = 0; i < segs; i++) {
      if (c > d.getUint16(ends + 2 * i)) continue
      const start = d.getUint16(starts + 2 * i), delta = d.getUint16(deltas + 2 * i), range = d.getUint16(ranges + 2 * i)
      if (c < start) return 0
      if (range === 0) return (c + delta) & 0xffff
      const g = d.getUint16(ranges + 2 * i + range + 2 * (c - start))
      return g === 0 ? 0 : (g + delta) & 0xffff
    }
    return 0
  }
  return { upem, ascender: d.getInt16(table(2) + 4), descender: d.getInt16(table(2) + 6), advance: c => {
    const g = glyph(c)
    if (g === 0) throw new Error(`${f.file} has no glyph for U+${c.toString(16).toUpperCase().padStart(4, '0')}`)
    return adv(g)
  } }
}

/**
 * An unkerned width for layout tests: each glyph's advance scaled to `size`, plus `cspace` (0.01 em) between glyphs.
 * The game kerns text, so this is not its exact width. Production text uses browser layout; these tests keep a margin.
 */
export function textWidth(face: string, size: number, cspace: number, text: string): number {
  face ||= DEFAULT_FACE
  if (!read.has(face)) read.set(face, metricsOf(face))
  const m = read.get(face)!, chars = [...text]
  return chars.reduce((w, c) => w + m.advance(c.codePointAt(0)!), 0) * size / m.upem + Math.max(0, chars.length - 1) * cspace * size / 100
}

/** Vertical lines read from the bundled head and hhea tables. */
export function faceLines(face: string): FaceLines {
  face ||= DEFAULT_FACE
  if (!read.has(face)) read.set(face, metricsOf(face))
  const { ascender, descender, upem } = read.get(face)!
  return { ascender, descender, upem }
}
