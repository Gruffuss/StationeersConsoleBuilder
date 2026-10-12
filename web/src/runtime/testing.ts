// Test helpers, imported by tests only.
import type { Status } from './bridge'
import type { FrameText } from './frame'

type Message = { id: number; kind: string; [k: string]: unknown }

/** A worker that records what is posted to it and replies when told: hand it to a CoreBridge as `w as unknown as Worker`. */
export class FakeWorker {
  posted: Message[] = []
  terminated = false
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  onmessageerror: ((e: MessageEvent) => void) | null = null
  postMessage(m: Message) { this.posted.push(m) }
  terminate() { this.terminated = true }
  reply(data: object) { this.onmessage?.({ data } as MessageEvent) }
  kinds() { return this.posted.map(m => m.kind) }
  last() { return this.posted[this.posted.length - 1] }
  status(m: Message, state: Status['state'] = 'Running') { this.reply({ id: m.id, kind: 'status', status: { state, error: null, instructions: 1, output: [], active: 'main' } }) }
}

/** A frame label: white 12 px "hi" in a 30x40 box at (10, 20), unrotated, nothing drawn over it, with `over` applied. */
export const label = (over: Partial<FrameText> = {}): FrameText => ({ element: 0, node: -1, text: 'hi', x: 10, y: 20, w: 30, h: 40,
  size: 12, colour: [1, 1, 1, 1], align: 0, valign: 0, font: null, bold: false, charSpacing: 0, fit: 0, minSize: 6, rotation: 0,
  wrap: false, lineHeight: 0, clip: null, shadow: null, outlineWidth: 0, outlineColour: null, kern: true, extraShadows: null,
  insetShadow: null, clipPolygon: null, shear: null, cover: 2 ** 31 - 1 /* past every vertex */, ...over })

/** A VBF1 frame with no geometry and this JSON section. */
export function vbf1(json = '{"elements":[],"text":[],"problems":[]}') {
  const body = new TextEncoder().encode(json), bytes = new Uint8Array(20 + body.length)
  bytes.set(new TextEncoder().encode('VBF1'))
  new DataView(bytes.buffer).setInt32(16, body.length, true)
  bytes.set(body, 20)
  return bytes.buffer
}
