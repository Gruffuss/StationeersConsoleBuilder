import type { CoreBridge } from '../runtime/bridge'

export type Picture = { width: number; height: number; pixels: ImageBitmap | Uint8Array }
export type PictureNote = { src: string; message: string }
type Reader = Pick<CoreBridge, 'readPicture' | 'readPictureBytes' | 'setImage'>
type Entry = { image?: Picture; error?: string; note?: string; done?: Promise<void>; abort: AbortController; reader?: Reader; bytes?: Uint8Array }
const source = (src: string) => src.startsWith('point:') ? src.slice(6) : src
const is = (src: string, scheme: string) => src.toLowerCase().startsWith(scheme)
const sizeNote = (width: number, height: number, max: number) => width > max || height > max
  ? `too large to preview here: ${width}×${height} pixels exceed this browser's maximum texture size of ${max}×${max}` : undefined

// Read dimensions only; the browser still validates and decodes the image.
function dimensions(b: Uint8Array): [number, number] | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n)
    && v.getUint32(8) === 13 && v.getUint32(12) === 0x49484452) return [v.getUint32(16), v.getUint32(20)]
  if (b[0] !== 255 || b[1] !== 216) return
  let at = 2
  while (at < b.length) {
    if (b[at++] !== 255) return
    while (b[at] === 255) at++
    const marker = b[at++]
    if (marker === undefined || marker === 0 || marker === 217 || marker === 218) return
    if (marker === 1 || (marker >= 208 && marker <= 216)) continue
    if (at + 2 > b.length) return
    const length = v.getUint16(at)
    if (length < 2 || at + length > b.length) return
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (length >= 8) return [v.getUint16(at + 5), v.getUint16(at + 3)]
      return
    }
    at += length
  }
}

/** Browser-session cache. Observing a frame only decodes local data; a click reads a page's remote snapshot. */
export class Pictures {
  private bridge: Reader | null = null
  private entries = new Map<string, Entry>()
  private pages = new Map<string, string[]>()
  private listeners = new Set<() => void>()
  private textureLimit = Infinity
  version = 0
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  private changed() { this.version++; this.listeners.forEach(cb => cb()) }
  setTextureLimit(max: number) {
    if (Number.isFinite(max) && max > 0 && max !== this.textureLimit) { this.textureLimit = max; this.changed() }
  }

  connect(bridge: Reader | null) {
    this.bridge = bridge
    if (bridge) for (const [src, entry] of this.entries) {
      if (entry.image || entry.error) void this.deliver(src, entry)
      else if (entry.reader) void entry.done?.then(() => {
        if (this.bridge !== bridge || this.entries.get(src) !== entry || !entry.note) return
        this.entries.delete(src)
        void this.read(src, is(src, 'https://'), entry.bytes)
      })
    }
  }
  clearPages() { this.pages.clear(); this.changed() }
  observe(page: string, pending: string[]) {
    const sources = [...new Set(pending.map(source))], before = this.pages.get(page)
    if (!before || before.length !== sources.length || before.some((s, i) => s !== sources[i])) {
      this.pages.set(page, sources); this.changed()
    }
    for (const src of sources) if (is(src, 'data:') && this.bridge) void this.read(src, false)
  }
  async loadPictures(page: string) {
    await Promise.all((this.pages.get(page) ?? []).filter(src => is(src, 'https://')).map(src => this.read(src, true)))
  }
  canLoad(page: string) { return (this.pages.get(page) ?? []).some(src => is(src, 'https://') && !this.entries.has(src)) }
  notes(page: string): PictureNote[] {
    return (this.pages.get(page) ?? []).flatMap(src => {
      const entry = this.entries.get(src)
      const message = entry?.note ?? entry?.error ?? (entry?.image ? sizeNote(entry.image.width, entry.image.height, this.textureLimit) ?? '' : entry ? 'loading picture…'
        : is(src, 'file://') ? "read from the game machine's disk" : is(src, 'https://') ? 'Load pictures to preview this picture'
        : is(src, 'data:') ? 'loading picture…' : 'this source is not previewed here')
      return message ? [{ src, message }] : []
    })
  }
  image(src: string) { return this.entries.get(source(src))?.image }

  private read(src: string, remote: boolean, savedBytes?: Uint8Array): Promise<void> {
    const previous = this.entries.get(src)
    if (previous) return previous.done ?? Promise.resolve()
    const bridge = this.bridge
    if (!bridge) return Promise.resolve()
    const entry: Entry = { abort: new AbortController() }
    this.entries.set(src, entry)
    entry.done = (async () => {
      let result
      if (remote) {
        let data = savedBytes
        if (!data) {
          try {
            const response = await fetch(src, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: entry.abort.signal })
            if (!response.ok) { entry.note = `picture request failed (HTTP ${response.status})`; return }
            data = new Uint8Array(await response.arrayBuffer())
          } catch {
            entry.note = 'this host does not let a browser read the picture; the game loads it itself'
            return
          }
        }
        if (entry.abort.signal.aborted) return
        entry.bytes = data
        entry.reader = this.bridge ?? bridge
        result = await entry.reader.readPictureBytes(data)
      } else {
        entry.reader = this.bridge ?? bridge
        result = await entry.reader.readPicture(src)
      }
      if (entry.abort.signal.aborted) return
      if (result.error) entry.error = result.error
      else if (result.note) { entry.note = result.note; return }
      else if (result.rgba) {
        entry.note = sizeNote(result.width, result.height, this.textureLimit)
        if (entry.note) return
        entry.image = { width: result.width, height: result.height, pixels: result.rgba }  // bottom row first, as uploaded
      } else {
        try {
          const compressed = result.bytes!, size = dimensions(compressed)
          if (size) entry.note = sizeNote(...size, this.textureLimit)
          if (entry.note) return
          // ImageBitmap uploads ignore UNPACK_FLIP_Y_WEBGL: orient it here, with straight alpha and untouched sRGB bytes.
          const bitmap = await createImageBitmap(new Blob([compressed]),
            { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
          if (entry.abort.signal.aborted) { bitmap.close(); return }
          entry.note = sizeNote(bitmap.width, bitmap.height, this.textureLimit)
          if (entry.note) { bitmap.close(); return }
          entry.image = { width: bitmap.width, height: bitmap.height, pixels: bitmap }
        } catch { entry.error = 'the image could not be decoded' }
      }
      if (!entry.abort.signal.aborted) await this.deliver(src, entry)
    })().catch(e => { entry.note = `picture read could not finish: ${e instanceof Error ? e.message : String(e)}` })
      .finally(() => { if (entry.image || entry.error) entry.bytes = undefined; if (!entry.abort.signal.aborted) this.changed() })
    this.changed()
    return entry.done
  }
  private async deliver(src: string, entry: Entry) {
    try { await this.bridge?.setImage(src, entry.image?.width ?? 0, entry.image?.height ?? 0, entry.error ?? null) }
    catch (e) { entry.note = `picture delivery could not finish: ${e instanceof Error ? e.message : String(e)}`; this.changed() }
  }
  dispose() {
    this.bridge = null
    for (const entry of this.entries.values()) {
      entry.abort.abort()
      if (entry.image && !(entry.image.pixels instanceof Uint8Array)) entry.image.pixels.close()
    }
    this.entries.clear(); this.pages.clear()
  }
}
