// Decodes VBF1/VBF2/VBF3, the core's binary frame (core/Core/FrameWriter.cs). Little-endian, every section 4-byte aligned:
// magic, int32 V (vertices), I (indices), S (spans), J (JSON bytes), then float32[2V] positions, float32[V] coverage,
// uint8[4V] colours, uint32[I] indices, int32[4S] spans and uint8[J] UTF-8 JSON {"elements":[…],"text":[…],"problems":[…]}.
// VBF2 adds float32[2V] UVs between coverage and colours, and "images" and "pending" to the JSON; texture drawing
// consumes them. VBF3 adds float32[V] edge distance before UVs, and float32[4V] stored sRGB (UV2) after colours.
// The typed arrays are views over the buffer, not copies.

export type FrameShape = { first: number; x0: number; y0: number; x1: number; y1: number }
export type FrameElement = { id: string; scene: string; x: number; y: number; w: number; h: number; firstVertex: number; vertexCount: number;
  shapes?: FrameShape[] | null /* eligible shape bounds for measured ink; absent on older cores */ }
export type FrameImage = { element: number; src: string; first: number; count: number }
export type FrameText = { element: number; node: number /* -1 if unknown */; text: string; x: number; y: number; w: number; h: number; size: number;
  colour: number[]; align: number; valign: number; font: string | null; bold: boolean; charSpacing: number; fit: number;
  minSize: number; rotation: number; wrap: boolean; lineHeight: number; clip: number[] | null; shadow: number[] | null;
  outlineWidth: number; outlineColour: number[] | null; kern: boolean;
  extraShadows: number[] | null /* 7 numbers a shadow, as shadow */; insetShadow: number[] | null /* dx,dy,blur,r,g,b,a */;
  clipPolygon: number[] | null /* x,y surface px; null when clip is the whole clip */; shear: number[] | null /* m00,m01,m10,m11, y up */
  /** The mod's box-based cut under ztext, else the end of its element; every later element is drawn over it.
   *  The browser can select an earlier eligible cut from measured ink and the element's shape bounds. */
  cover: number
  after?: number /* earliest eligible shape vertex; absent on older cores, -1 for native labels */ }
export type Frame = { positions: Float32Array; coverage: Float32Array; colours: Uint8Array; indices: Uint32Array;
  edge?: Float32Array; storedColours?: Float32Array; uv?: Float32Array; images?: FrameImage[]; pending?: string[] /* absent on VBF1 */
  spans: Int32Array /* element,node,first,count */; elements: FrameElement[]; text: FrameText[];
  problems: { element: number; message: string }[]
  /** Not the core's: the bridge's note of what its surface was last loaded or patched with when it was asked for. */
  drawnFrom?: unknown
  /** Browser-measured cuts, among drawable labels; used by picking once Canvas has planned its covers. */
  textCovers?: number[] }

// The JSON keys the types above read, which the core writes: test/fixtures/frames/keys.json pins them on both sides
// (frame.test.ts here, FrameTests.cs in the core). Records, so tsc holds each list to exactly its type's keys.
const ELEMENT_KEYS: Record<keyof FrameElement, 0> = { id: 0, scene: 0, x: 0, y: 0, w: 0, h: 0, firstVertex: 0, vertexCount: 0, shapes: 0 }
const TEXT_KEYS: Record<keyof FrameText, 0> = { element: 0, node: 0, text: 0, x: 0, y: 0, w: 0, h: 0, size: 0, colour: 0, align: 0,
  valign: 0, font: 0, bold: 0, charSpacing: 0, fit: 0, minSize: 0, rotation: 0, wrap: 0, lineHeight: 0, clip: 0, shadow: 0,
  outlineWidth: 0, outlineColour: 0, kern: 0, extraShadows: 0, insetShadow: 0, clipPolygon: 0, shear: 0, cover: 0, after: 0 }
export const FRAME_KEYS = { format: 'VBF3', element: Object.keys(ELEMENT_KEYS), text: Object.keys(TEXT_KEYS),
  image: ['element', 'src', 'first', 'count'], body: ['elements', 'text', 'problems', 'images', 'pending'] }

// A script can make a rect or a label non-finite; the core writes those numbers as named literals rather than fail the
// frame. Only numeric fields are coerced: a label or an id may well read "NaN".
const NAMED = new Map([['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity]])
const STRINGS = new Set(['id', 'scene', 'text', 'font', 'message', 'src'])
const revive = (key: string, value: unknown) => key === 'pending' && Array.isArray(value) ? value.map(String)
  : typeof value === 'string' && !STRINGS.has(key) ? NAMED.get(value) ?? value : value
const utf8 = new TextDecoder()

// ponytail: typed-array views use the host byte order, which is little-endian everywhere the page runs.
export function decodeFrame(buf: ArrayBuffer): Frame {
  if (buf.byteLength < 20) throw new Error('truncated frame')
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
  if (!['VBF1', 'VBF2', 'VBF3'].includes(magic)) throw new Error('not a VBF1, VBF2 or VBF3 frame')
  const [v, i, s, j] = new Int32Array(buf, 4, 4)
  const cov = 20 + 8 * v, edge = cov + 4 * v, uv = edge + (magic === 'VBF3' ? 4 * v : 0),
    col = uv + (magic !== 'VBF1' ? 8 * v : 0), stored = col + 4 * v, ind = stored + (magic === 'VBF3' ? 16 * v : 0), spn = ind + 4 * i, json = spn + 16 * s
  if (Math.min(v, i, s, j) < 0 || json + j > buf.byteLength) throw new Error('truncated frame')
  const body: Pick<Frame, 'elements' | 'text' | 'problems' | 'images' | 'pending'> = JSON.parse(utf8.decode(new Uint8Array(buf, json, j)), revive)
  return {
    positions: new Float32Array(buf, 20, 2 * v), coverage: new Float32Array(buf, cov, v), colours: new Uint8Array(buf, col, 4 * v),
    indices: new Uint32Array(buf, ind, i), spans: new Int32Array(buf, spn, 4 * s),
    elements: body.elements, text: body.text, problems: body.problems,
    ...(magic !== 'VBF1' ? { uv: new Float32Array(buf, uv, 2 * v), images: body.images ?? [], pending: body.pending ?? [] } : {}),
    ...(magic === 'VBF3' ? { edge: new Float32Array(buf, edge, v), storedColours: new Float32Array(buf, stored, 4 * v) } : {}),
  }
}
