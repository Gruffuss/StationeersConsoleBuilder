import { afterEach, expect, it, vi } from 'vitest'
import { FontMetadataReader, METADATA_BOOT_TIMEOUT_MS, type MetadataResult } from './fontMetadata'
import { CoreBridge } from '../runtime/bridge'
import { FakeWorker, vbf1 } from '../runtime/testing'

const ok: MetadataResult = { status: 'ok', family: 'Family', style: 'Regular', names: { 1: 'Family', 2: 'Regular' }, axes: [], instances: [], faces: [] }
const readers: FontMetadataReader[] = []
afterEach(() => { readers.forEach(r => r.dispose()); readers.length = 0; vi.useRealTimers() })
function make() {
  const workers: FakeWorker[] = []
  const reader = new FontMetadataReader(() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker })
  readers.push(reader)
  return { reader, workers }
}

it('allows a boot longer than the read watchdog, then reads quickly and reuses the ready worker', async () => {
  vi.useFakeTimers()
  const { reader, workers } = make(), a = reader.read(new ArrayBuffer(1)), w = workers[0]
  vi.advanceTimersByTime(6000)
  expect(w.terminated).toBe(false)
  expect(w.posted).toHaveLength(0)
  w.reply({ kind: 'ready' })
  expect(w.kinds()).toEqual(['metadata'])
  vi.advanceTimersByTime(4999)
  w.reply({ id: w.last().id, result: ok }); expect(await a).toEqual(ok)
  vi.advanceTimersByTime(METADATA_BOOT_TIMEOUT_MS)
  const b = reader.read(new ArrayBuffer(1))
  expect(workers).toHaveLength(1)
  w.reply({ id: w.last().id, result: ok }); expect(await b).toEqual(ok)
})

it('starts lazily, serves both formats through one queue and retains callers’ bytes', async () => {
  const { reader, workers } = make()
  expect(workers).toHaveLength(0)
  const data = new ArrayBuffer(4), a = reader.read(data), b = reader.read(data)
  expect(workers).toHaveLength(1)
  expect(workers[0].posted).toHaveLength(0)
  workers[0].reply({ kind: 'ready' })
  expect(workers[0].kinds()).toEqual(['metadata'])
  expect(data.byteLength).toBe(4)
  workers[0].reply({ id: workers[0].last().id + 1, result: ok })
  expect(workers[0].posted).toHaveLength(1)
  workers[0].reply({ id: workers[0].last().id, result: ok })
  expect(await a).toEqual(ok)
  expect(workers[0].posted).toHaveLength(2)
  workers[0].reply({ id: workers[0].last().id, result: ok })
  expect(await b).toEqual(ok)
})

it.each(['crashed', 'error', 'messageerror', 'timeout', 'budget'])('isolates %s from a chip’s tick, frame and memory', async mode => {
  vi.useFakeTimers()
  const chip = new FakeWorker(), status = vi.fn(), frame = vi.fn(), ready = vi.fn(), halted = vi.fn()
  const bridge = new CoreBridge(() => chip as unknown as Worker, { ready, status, halted })
  bridge.onFrame(frame); chip.reply({ kind: 'ready' }); bridge.load('chip', { w: 480, h: 480 })
  const memory = [42]; chip.reply({ id: chip.last().id, kind: 'status', status: { state: 'Running', instructions: 1, memory } })
  const { reader, workers } = make(); const a = reader.read(new ArrayBuffer(1)), w = workers[0]
  w.reply({ kind: 'ready' })
  if (mode === 'timeout') for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(500); chip.status(chip.last()) }
  else if (mode === 'error') w.onerror?.({ message: 'decode failed', preventDefault() {} } as ErrorEvent)
  else if (mode === 'messageerror') w.onmessageerror?.({} as MessageEvent)
  else if (mode === 'budget') w.reply({ id: w.last().id, result: { status: 'read-budget', cause: 'too large to read names from here' } })
  else w.reply({ kind: 'crashed', why: 'runtime aborted' })
  expect((await a).status).toBe(mode === 'timeout' || mode === 'budget' ? 'read-budget' : 'failed')
  expect(w.terminated).toBe(true)
  expect(workers).toHaveLength(1)
  expect(chip.terminated).toBe(false); expect(halted).not.toHaveBeenCalled(); expect(ready).toHaveBeenCalledTimes(1)
  expect(chip.kinds()).not.toContain('metadata')
  expect(status.mock.calls[0][0].memory).toEqual([42])
  vi.advanceTimersByTime(500)
  expect(chip.last().kind).toBe('tick')
  chip.status(chip.last()); bridge.frame('main', 1, false)
  chip.reply({ id: chip.last().id, kind: 'frame', buf: vbf1(), workerMs: 0 })
  expect(frame).toHaveBeenCalled(); expect(memory).toEqual([42])
  const b = reader.read(new ArrayBuffer(1)); expect(workers).toHaveLength(2)
  w.reply({ id: w.last().id, result: ok })
  w.reply({ kind: 'ready' }); expect(workers[1].posted).toHaveLength(0)
  workers[1].reply({ kind: 'ready' })
  workers[1].reply({ id: workers[1].last().id, result: ok }); expect(await b).toEqual(ok)
  bridge.dispose()
})

it('cancels queued and active jobs, ignores late replies, and removes cancellation listeners', async () => {
  const { reader, workers } = make(), aController = new AbortController(), bController = new AbortController()
  const a = reader.read(new ArrayBuffer(1), aController.signal), b = reader.read(new ArrayBuffer(1), bController.signal)
  workers[0].reply({ kind: 'ready' })
  bController.abort(); expect((await b).status).toBe('cancelled'); expect(workers[0].posted).toHaveLength(1)
  aController.abort(); expect((await a).status).toBe('cancelled'); expect(workers[0].terminated).toBe(true)
  const c = reader.read(new ArrayBuffer(1)); workers[0].reply({ id: workers[0].last().id, result: ok })
  workers[1].reply({ kind: 'ready' })
  workers[1].reply({ id: workers[1].last().id, result: ok }); expect(await c).toEqual(ok)
  expect((await reader.read(new ArrayBuffer(1), bController.signal)).status).toBe('cancelled')
})

it('settles construction/post failures and disposed jobs without leaving a promise pending', async () => {
  const broken = new FontMetadataReader(() => { throw new Error('worker blocked') }); readers.push(broken)
  expect((await broken.read(new ArrayBuffer(1))).status).toBe('failed')
  const { reader, workers } = make(), a = reader.read(new ArrayBuffer(1)), b = reader.read(new ArrayBuffer(1))
  reader.dispose(); expect((await a).status).toBe('cancelled'); expect((await b).status).toBe('cancelled')
  expect(workers[0].terminated).toBe(true); expect((await reader.read(new ArrayBuffer(1))).status).toBe('cancelled')
  const { reader: posting, workers: posted } = make(), p = posting.read(new ArrayBuffer(1))
  posted[0].reply({ kind: 'ready' })
  posted[0].reply({ id: posted[0].last().id, result: ok }); await p
  posted[0].postMessage = () => { throw new Error('clone failed') }
  expect((await posting.read(new ArrayBuffer(1))).status).toBe('failed'); expect(posted[0].terminated).toBe(true)
})

it('reports a stuck boot separately, settles all waiting reads, and retries only for a new request', async () => {
  vi.useFakeTimers()
  const { reader, workers } = make(), a = reader.read(new ArrayBuffer(1)), b = reader.read(new ArrayBuffer(1))
  vi.advanceTimersByTime(METADATA_BOOT_TIMEOUT_MS - 1)
  expect(workers[0].terminated).toBe(false)
  vi.advanceTimersByTime(1)
  expect(await a).toEqual({ status: 'failed', cause: expect.stringContaining('did not become ready within 60 s') })
  expect(await b).toEqual(await a)
  expect(workers).toHaveLength(1)
  const c = reader.read(new ArrayBuffer(1))
  workers[0].reply({ kind: 'ready' }); expect(workers[1].posted).toHaveLength(0)
  workers[1].reply({ kind: 'ready' }); workers[1].reply({ id: workers[1].last().id, result: ok })
  expect(await c).toEqual(ok)
})

it('cancels a read waiting for boot without restarting the runtime or letting it reach the worker', async () => {
  vi.useFakeTimers()
  const { reader, workers } = make(), controller = new AbortController()
  const a = reader.read(new ArrayBuffer(1), controller.signal)
  controller.abort(); expect((await a).status).toBe('cancelled')
  vi.advanceTimersByTime(6000)
  workers[0].reply({ kind: 'ready' })
  expect(workers[0].posted).toHaveLength(0); expect(workers[0].terminated).toBe(false)
  const b = reader.read(new ArrayBuffer(1))
  workers[0].reply({ id: workers[0].last().id, result: ok })
  expect(await b).toEqual(ok); expect(workers).toHaveLength(1)
})

it.each(['crashed', 'error', 'messageerror'])('settles a %s during boot without posting font bytes', async mode => {
  const { reader, workers } = make(), a = reader.read(new ArrayBuffer(1)), b = reader.read(new ArrayBuffer(1)), w = workers[0]
  if (mode === 'crashed') w.reply({ kind: 'crashed', why: 'boot aborted' })
  else if (mode === 'error') w.onerror?.({ message: 'boot failed', preventDefault() {} } as ErrorEvent)
  else w.onmessageerror?.({} as MessageEvent)
  expect((await a).status).toBe('failed'); expect((await b).status).toBe('failed')
  expect(w.posted).toHaveLength(0); expect(w.terminated).toBe(true); expect(workers).toHaveLength(1)
})
