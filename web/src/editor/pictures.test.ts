import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Pictures } from './pictures'
import { CoreBridge } from '../runtime/bridge'
import { FakeWorker } from '../runtime/testing'

const data = 'data:image/png;base64,AA=='
const remote = 'https://example.com/picture'
const file = 'file:///picture.bmp'
const api = () => ({ readPicture: vi.fn().mockResolvedValue({ format: 'png', bytes: new Uint8Array([0]) }),
  readPictureBytes: vi.fn().mockResolvedValue({ format: 'png', bytes: new Uint8Array([0]) }), setImage: vi.fn().mockResolvedValue(undefined) })
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }))
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 1, close: vi.fn() }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const header = (format: string, width: number, height: number) => {
  const b = format === 'png' ? new Uint8Array(33) : new Uint8Array([255, 216, 255, 224, 0, 2, 255, 255, 194, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0])
  const v = new DataView(b.buffer)
  if (format === 'png') {
    b.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
    v.setUint32(16, width); v.setUint32(20, height)
  } else { v.setUint16(12, height); v.setUint16(14, width) }
  return b
}
const tooLarge = 'too large to preview here: 4097×1 pixels exceed this browser\'s maximum texture size of 4096×4096'

it.each(['png', 'jpeg'])('checks %s dimensions against the GPU limit before bitmap decoding', async format => {
  const b = api(), p = new Pictures(); p.connect(b)
  p.setTextureLimit(4096)
  b.readPicture.mockResolvedValue({ format, bytes: header(format, 4097, 1) })
  p.observe('p1', [data])
  await vi.waitFor(() => expect(p.notes('p1')).toEqual([{ src: data, message: tooLarge }]))
  expect(createImageBitmap).not.toHaveBeenCalled()
  expect(b.setImage).not.toHaveBeenCalled()
  p.dispose()
})

it('reports oversized core pixels before copying or delivering them', async () => {
  const b = api(), p = new Pictures(); p.connect(b)
  p.setTextureLimit(4096)
  b.readPicture.mockResolvedValue({ format: 'bmp', width: 4097, height: 1, rgba: new Uint8Array(4) } as never)
  p.observe('p1', [data])
  await vi.waitFor(() => expect(p.notes('p1')).toEqual([{ src: data, message: tooLarge }]))
  expect(b.setImage).not.toHaveBeenCalled()
  p.dispose()
})

it('shows the core\'s note for a picture too large to decode here, and does not report it to the chip as failed', async () => {
  const b = api(), p = new Pictures(); p.connect(b)
  const note = 'too large to preview here: decoding this 4096×4096 picture needs about 128 MB, and the preview\'s core has 92 MB free'
  b.readPicture.mockResolvedValue({ note, width: 0, height: 0 })
  p.observe('p1', [data])
  await vi.waitFor(() => expect(p.notes('p1')).toEqual([{ src: data, message: note }]))
  expect(p.image(data)).toBeUndefined()
  expect(b.setImage).not.toHaveBeenCalled()
  p.dispose()
})

it('reports a cached bitmap larger than a newly measured texture limit', async () => {
  const b = api(), p = new Pictures(); p.connect(b)
  vi.mocked(createImageBitmap).mockResolvedValue({ width: 4097, height: 1, close: vi.fn() } as unknown as ImageBitmap)
  p.observe('p1', [data])
  await vi.waitFor(() => expect(b.setImage).toHaveBeenCalled())
  p.setTextureLimit(4096)
  expect(p.notes('p1')).toEqual([{ src: data, message: tooLarge }])
  expect(b.readPicture).toHaveBeenCalledOnce()
  p.dispose()
})

it('decodes a local PNG once, delivers its size, and never fetches', async () => {
  const b = api(), p = new Pictures(); p.connect(b)
  p.observe('p1', [data, `point:${data}`, data])
  await vi.waitFor(() => expect(b.setImage).toHaveBeenCalledWith(data, 2, 1, null))
  p.observe('p2', [data])
  expect(b.readPicture).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
  expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  expect(p.image(`point:${data}`)?.width).toBe(2)
  p.dispose()
})

it('loads only the clicked page snapshot, once, without consent for later edits or other pages', async () => {
  const b = api(), p = new Pictures(); p.connect(b)
  p.observe('p1', [remote]); p.observe('p2', [`${remote}/other`])
  expect(fetch).not.toHaveBeenCalled()
  expect(p.notes('p1')[0].message).toContain('Load pictures')
  await p.loadPictures('p1')
  expect(fetch).toHaveBeenCalledExactlyOnceWith(remote, expect.objectContaining({ mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }))
  expect(b.readPictureBytes).toHaveBeenCalledWith(new Uint8Array([137, 80, 78, 71]))
  p.observe('p1', [`${remote}/new`]); p.observe('p2', [`${remote}/other`])
  expect(fetch).toHaveBeenCalledOnce()
  p.observe('p1', [remote]); await p.loadPictures('p1')
  expect(fetch).toHaveBeenCalledOnce()
  p.dispose()
})

it('keeps CORS refusals and file sources as preview notes, without setting a scene error', async () => {
  vi.mocked(fetch).mockRejectedValue(new TypeError('CORS'))
  const b = api(), p = new Pictures(); p.connect(b)
  p.observe('p1', [remote, file])
  await p.loadPictures('p1')
  expect(p.notes('p1')).toEqual([
    { src: remote, message: 'this host does not let a browser read the picture; the game loads it itself' },
    { src: file, message: "read from the game machine's disk" },
  ])
  expect(b.setImage).not.toHaveBeenCalled()
  await p.loadPictures('p1')
  expect(fetch).toHaveBeenCalledOnce()
  p.dispose()
})

it.each([404, 503])('reports HTTP %s without claiming that the host blocks browsers or that the game loads it', async status => {
  const body = vi.fn(), b = api(), p = new Pictures(); p.connect(b)
  vi.mocked(fetch).mockResolvedValue({ ok: false, status, arrayBuffer: body } as unknown as Response)
  p.observe('p1', [remote]); await p.loadPictures('p1')
  expect(p.notes('p1')).toEqual([{ src: remote, message: `picture request failed (HTTP ${status})` }])
  expect(body).not.toHaveBeenCalled()
  expect(b.readPictureBytes).not.toHaveBeenCalled()
  p.dispose()
})

it('leaves relative https: sources unrequested and reports explicit page load state', async () => {
  const b = api(), p = new Pictures(); p.connect(b)
  p.observe('p1', ['https:foo', 'point:https:foo'])
  await p.loadPictures('p1')
  expect(fetch).not.toHaveBeenCalled()
  expect(p.notes('p1')).toEqual([{ src: 'https:foo', message: 'this source is not previewed here' }])
  expect(p.canLoad('p1')).toBe(false)
  p.observe('p1', [remote]); expect(p.canLoad('p1')).toBe(true)
  await p.loadPictures('p1'); expect(p.canLoad('p1')).toBe(false)
  p.dispose()
})

it('observes pending sources without fetching until that page is explicitly loaded', async () => {
  const b = api(), p = new Pictures(); p.connect(b)
  p.observe('p1', [remote, file])
  expect(fetch).not.toHaveBeenCalled()
  expect(b.readPicture).not.toHaveBeenCalled()
  await p.loadPictures('p1')
  expect(fetch).toHaveBeenCalledOnce()
  p.dispose()
})

it('uploads core BMP/GIF pixels as the core orders them, bottom row first, and replays sizes to a replacement core', async () => {
  const b = api(), p = new Pictures(); p.connect(b)
  const rgba = new Uint8Array([5, 6, 7, 8, 1, 2, 3, 4])
  b.readPicture.mockResolvedValue({ format: 'bmp', width: 1, height: 2, rgba })
  p.observe('p1', [data])
  await vi.waitFor(() => expect(b.setImage).toHaveBeenCalledWith(data, 1, 2, null))
  expect(p.image(data)!.pixels).toBe(rgba)  // no copy
  expect(createImageBitmap).not.toHaveBeenCalled()
  const replacement = api(); p.connect(replacement)
  await vi.waitFor(() => expect(replacement.setImage).toHaveBeenCalledWith(data, 1, 2, null))
  expect(replacement.readPicture).not.toHaveBeenCalled()
  p.dispose()
})

it('reports decode failures with the game message and frees a decoded bitmap on disposal', async () => {
  const bitmap = { width: 2, height: 1, close: vi.fn() }
  vi.mocked(createImageBitmap).mockResolvedValueOnce(bitmap as unknown as ImageBitmap).mockRejectedValueOnce(new Error('browser detail'))
  const b = api(), p = new Pictures(); p.connect(b)
  p.observe('p1', [data, `${data}x`])
  await vi.waitFor(() => expect(b.setImage).toHaveBeenCalledWith(`${data}x`, 0, 0, 'the image could not be decoded'))
  p.dispose(); expect(bitmap.close).toHaveBeenCalledOnce()
})

it.each([false, true])('finishes an interrupted picture read after replacing its core (remote=%s), without fetching again', async remoteSource => {
  const old = api(), replacement = api(), p = new Pictures()
  let reject!: (error: Error) => void
  const held = new Promise((_resolve, r) => { reject = r })
  if (remoteSource) old.readPictureBytes.mockReturnValue(held)
  else old.readPicture.mockReturnValue(held)
  p.connect(old)
  const src = remoteSource ? remote : data
  p.observe('p1', [src])
  const load = remoteSource ? p.loadPictures('p1') : Promise.resolve()
  await vi.waitFor(() => expect(remoteSource ? old.readPictureBytes : old.readPicture).toHaveBeenCalledOnce())
  reject(new Error('bridge disposed')); await load
  await vi.waitFor(() => expect(p.notes('p1')[0].message).toContain('could not finish'))
  p.connect(replacement)
  await vi.waitFor(() => expect(replacement.setImage).toHaveBeenCalledWith(src, 2, 1, null))
  expect(fetch).toHaveBeenCalledTimes(remoteSource ? 1 : 0)
  p.dispose()
})

it.each([['crash', false], ['crash', true], ['watchdog', false], ['watchdog', true]] as const)
  ('resumes a read on the same bridge after a worker %s (remote=%s), without fetching again', async (failure, remoteSource) => {
    vi.useFakeTimers()
    const p = new Pictures(), workers: FakeWorker[] = []
    const b = new CoreBridge(() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker },
      { ready: () => p.connect(b), halted() {}, status() {} })
    try {
      workers[0].reply({ kind: 'ready' })
      const src = remoteSource ? remote : data, kind = remoteSource ? 'readPictureBytes' : 'readPicture'
      p.observe('p1', [src])
      if (remoteSource) void p.loadPictures('p1')
      await vi.waitFor(() => expect(workers[0].last()?.kind).toBe(kind))
      if (failure === 'crash') workers[0].reply({ kind: 'crashed', why: 'decode interrupted' })
      else vi.advanceTimersByTime(10_001)
      expect(workers[0].terminated).toBe(true)
      expect(workers).toHaveLength(2)
      workers[1].reply({ kind: 'ready' })
      await vi.waitFor(() => expect(workers[1].last()?.kind).toBe(kind))
      workers[1].reply({ id: workers[1].last().id, kind: 'picture', result: { format: 'png', bytes: new Uint8Array([0]), width: 0, height: 0 } })
      await vi.waitFor(() => expect(workers[1].last()).toMatchObject({ kind: 'setImage', src, width: 2, height: 1, error: null }))
      workers[1].reply({ id: workers[1].last().id, kind: 'imageSet' })
      await vi.waitFor(() => expect(p.image(src)?.width).toBe(2))
      expect(fetch).toHaveBeenCalledTimes(remoteSource ? 1 : 0)
    } finally { b.dispose(); p.dispose() }
  })
