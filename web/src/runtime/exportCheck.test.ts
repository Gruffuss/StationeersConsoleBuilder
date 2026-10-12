import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { checkExport, type ExportReport } from './exportCheck'
import { FakeWorker } from './testing'
import { frameworkUrl } from './framework'
import { mapError } from '../codegen/linemap'

const request: Parameters<typeof checkExport>[1] = { lua: 'return', host: '', pages: [] }
const report: ExportReport = { complete: true, issues: [], loadInstructions: 0, worstTickInstructions: 0, ticks: 20, visited: [] }
const asWorker = (w: FakeWorker) => w as unknown as Worker
function start(over = request, signal?: AbortSignal) {
  const worker = new FakeWorker(), factory = vi.fn(() => asWorker(worker))
  const pending = checkExport(factory, over, signal)
  return { worker, factory, pending }
}
function reply(w: FakeWorker, result: unknown = report) { w.reply({ id: w.last().id, kind: 'exportReport', report: result }) }

// Execute the actual worker module; replace only its external WebAssembly boot dependency. The site is served under
// /vb/ here, as Vite's BASE_URL would say for a sub-path build, and the worker must ask for the runtime under it.
async function bootWorker(file: URL, api: Record<string, unknown>) {
  const port = { location: { origin: 'https://builder.test' }, postMessage: vi.fn(), onmessage: null as ((e: MessageEvent) => void) | null }
  const dotnet = { withModuleConfig: () => ({ create: async () => ({
    getConfig: () => ({ mainAssemblyName: 'Core' }), getAssemblyExports: async () => ({ VectorBuilder: { Wasm: { Exports: api } } }),
  }) }) }
  const source = readFileSync(file, 'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/vb/'))
  const code = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
  const imported: string[] = []
  const require = (id: string) => /\/framework$/.test(id) ? { frameworkUrl } : (imported.push(id), { dotnet })
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  await new AsyncFunction('self', 'require', 'exports', code)(port, require, {})
  const drain = () => new Promise<void>(resolve => setImmediate(resolve))
  await drain()
  expect(imported).toEqual(['https://builder.test/vb/_framework/dotnet.js'])
  return { port, drain, send: (data: object) => port.onmessage!({ data } as MessageEvent) }
}

afterEach(() => vi.useRealTimers())

describe('isolated export check', () => {
  it('calls the factory once per check and disposes distinct workers without preview ticks', async () => {
    const workers = [new FakeWorker(), new FakeWorker()]
    const factory = vi.fn().mockReturnValueOnce(asWorker(workers[0])).mockReturnValueOnce(asWorker(workers[1]))
    for (const w of workers) {
      const terminate = vi.spyOn(w, 'terminate')
      const pending = checkExport(factory, request)
      expect(w.posted).toHaveLength(0)
      w.reply({ kind: 'ready' })
      reply(w)
      expect(await pending).toEqual(report)
      expect(terminate).toHaveBeenCalledTimes(1)
      expect(w.kinds()).toEqual(['checkExport'])
    }
    expect(factory).toHaveBeenCalledTimes(2)
    expect(workers[0]).not.toBe(workers[1])
  })

  it('sends the exact Lua/host and a captured JSON manifest once after ready', async () => {
    const pages = [{ id: 'page & !', surface: 'main', src: 'SCENE\nT text="é"', empty: false, w: 123, h: 456 }]
    const expected = JSON.stringify(pages)
    const { worker, pending } = start({ lua: '-- é\nreturn', host: '{"beta":true}', pages })
    pages[0].src = 'changed during boot'
    worker.reply({ kind: 'ready' }); worker.reply({ kind: 'ready' })
    expect(worker.posted).toEqual([{ id: 1, kind: 'checkExport', lua: '-- é\nreturn', host: '{"beta":true}', pages: expected }])
    reply(worker, { ...report, issues: [{ level: 'warning', message: 'original mod message', page: 'page & !', node: null, key: null }] })
    expect((await pending).issues[0].node).toBeNull()
    const handler = worker.onmessage
    handler?.({ data: { kind: 'ready' } } as MessageEvent)
    reply(worker)
    expect(worker.posted).toHaveLength(1)
  })

  it('does not consume check time during a slow successful boot', async () => {
    vi.useFakeTimers()
    const { worker, pending } = start()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(worker.terminated).toBe(false)
    worker.reply({ kind: 'ready' })
    await vi.advanceTimersByTimeAsync(49_999)
    expect(worker.terminated).toBe(false)
    reply(worker)
    expect((await pending).complete).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('boot timeout settles incomplete, terminates once and ignores late ready', async () => {
    vi.useFakeTimers()
    const { worker, factory, pending } = start(), late = worker.onmessage
    const terminate = vi.spyOn(worker, 'terminate')
    await vi.advanceTimersByTimeAsync(60_000)
    const result = await pending
    expect(result.complete).toBe(false)
    expect(result.issues[0].message).toMatch(/boot|ready/i)
    expect(result.issues.some(i => i.level === 'error')).toBe(false)
    late?.({ data: { kind: 'ready' } } as MessageEvent)
    expect(worker.posted).toHaveLength(0)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([0, 25])('post-ready timeout uses max(20, 2*pages) for %i pages and ignores late report', async n => {
    vi.useFakeTimers()
    const pages = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, surface: `s${i}`, src: '', empty: true, w: 460, h: 460 }))
    const { worker, factory, pending } = start({ ...request, pages })
    worker.reply({ kind: 'ready' })
    const late = worker.onmessage, timeout = 10_000 + 2_000 * Math.max(20, 2 * n)
    await vi.advanceTimersByTimeAsync(timeout - 1)
    expect(worker.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result.complete).toBe(false)
    expect(result.issues[0].message).toMatch(/check.*time|check.*long/i)
    expect(result.issues.some(i => i.level === 'error')).toBe(false)
    late?.({ data: { id: 1, kind: 'exportReport', report } } as MessageEvent)
    expect(worker.terminated).toBe(true)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['boot', 'check'])('abort during %s settles incomplete and ignores late replies', async phase => {
    vi.useFakeTimers()
    const controller = new AbortController(), { worker, pending } = start(request, controller.signal)
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    if (phase === 'check') worker.reply({ kind: 'ready' })
    const late = worker.onmessage, terminate = vi.spyOn(worker, 'terminate')
    controller.abort()
    expect((await pending).issues[0].message).toMatch(/cancel|abort/i)
    late?.({ data: { kind: 'ready' } } as MessageEvent)
    late?.({ data: { id: 1, kind: 'exportReport', report } } as MessageEvent)
    expect(worker.posted).toHaveLength(phase === 'check' ? 1 : 0)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an already aborted signal creates no runtime', async () => {
    const controller = new AbortController(); controller.abort()
    const { factory, pending } = start(request, controller.signal)
    expect((await pending).complete).toBe(false)
    expect(factory).not.toHaveBeenCalled()
  })

  it('disposes a worker returned by a factory that synchronously aborts the check', async () => {
    const controller = new AbortController(), worker = new FakeWorker()
    const terminate = vi.spyOn(worker, 'terminate')
    const pending = checkExport(() => { controller.abort(); return asWorker(worker) }, request, controller.signal)
    expect((await pending).complete).toBe(false)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(worker.posted).toHaveLength(0)
  })

  it.each(['crashed', 'error', 'messageerror', 'post failure'])('%s settles incomplete and disposes without retry', async failure => {
    const { worker, factory, pending } = start()
    if (failure === 'crashed') worker.reply({ kind: 'crashed', why: 'out of memory' })
    if (failure === 'error') worker.onerror?.({ message: 'boot failed', preventDefault: vi.fn() } as unknown as ErrorEvent)
    if (failure === 'messageerror') worker.onmessageerror?.({} as MessageEvent)
    if (failure === 'post failure') {
      vi.spyOn(worker, 'postMessage').mockImplementation(() => { throw new Error('post failed') })
      worker.reply({ kind: 'ready' })
    }
    const result = await pending
    expect(result.complete).toBe(false)
    expect(result.issues[0].level).toBe('info')
    expect(worker.terminated).toBe(true)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('factory failure is incompletion', async () => {
    const factory = vi.fn(() => { throw new Error('runtime unavailable') })
    expect((await checkExport(factory, request)).complete).toBe(false)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it.each([
    null, {}, { ...report, complete: 'true' }, { ...report, loadInstructions: null }, { ...report, loadInstructions: Infinity },
    { ...report, worstTickInstructions: NaN }, { ...report, ticks: -1 }, { ...report, ticks: 0.5 }, { ...report, visited: [null] },
    { ...report, issues: null }, { ...report, issues: [{ level: 'fatal', message: 'bad' }] },
    { ...report, issues: [{ level: 'warning', message: null }] }, { ...report, issues: [{ level: 'warning', message: 'bad', page: 1 }] },
    { ...report, issues: [{ level: 'warning', message: 'bad', node: Infinity }] }, { ...report, issues: [{ level: 'warning', message: 'bad', key: {} }] },
  ])('malformed report %# cannot silently pass', async malformed => {
    const { worker, pending } = start()
    worker.reply({ kind: 'ready' }); reply(worker, malformed)
    const result = await pending
    expect(result.complete).toBe(false)
    expect(result.issues[0].message).toMatch(/reply|report/i)
    expect(worker.terminated).toBe(true)
  })

  it.each([null, { kind: 'exportReport', id: 1, report }, { kind: 'nonsense' }])('malformed boot reply %# cannot pass', async message => {
    const { worker, pending } = start()
    worker.onmessage?.({ data: message } as MessageEvent)
    expect((await pending).complete).toBe(false)
    expect(worker.terminated).toBe(true)
  })

  it('a known Lua error remains a completed rejection and can map the real Core compiler message', async () => {
    const { worker, pending } = start()
    worker.reply({ kind: 'ready' })
    const message = 'compile: [string "chip"]:2: unexpected symbol near <eof>'
    reply(worker, { ...report, ticks: 0, issues: [{ level: 'error', message }] })
    const result = await pending
    expect(result.complete).toBe(true)
    expect(mapError(result.issues[0].message, [{ first: 1, last: 3, part: 'custom' }])).toContain('custom code line 2')
  })

  it('dispatches an exact export request through the actual worker without touching preview APIs', async () => {
    const api = { CheckExport: vi.fn(async () => JSON.stringify(report)), Load: vi.fn(), Tick: vi.fn() }
    const { port, send, drain } = await bootWorker(new URL('./core.worker.ts', import.meta.url), api)
    send({ id: 7, kind: 'checkExport', lua: 'exact Lua', host: 'exact host', pages: 'exact manifest' })
    await drain()
    expect(api.CheckExport).toHaveBeenCalledExactlyOnceWith('exact Lua', 'exact host', 'exact manifest')
    expect(port.postMessage).toHaveBeenCalledWith({ id: 7, kind: 'exportReport', report })
    expect(api.Load).not.toHaveBeenCalled(); expect(api.Tick).not.toHaveBeenCalled()
  })

  it('serializes the actual preview load before queued ticks and checks', async () => {
    let finish!: (value: string) => void
    const status = { state: 'Running' }
    const api = { Load: vi.fn(() => new Promise<string>(resolve => { finish = resolve })),
      Tick: vi.fn(async () => JSON.stringify(status)), CheckExport: vi.fn(async () => JSON.stringify(report)) }
    const { port, send, drain } = await bootWorker(new URL('./core.worker.ts', import.meta.url), api)
    send({ id: 1, kind: 'load', lua: 'preview', w: 460, h: 460, sizes: '{}', host: '{}' })
    send({ id: 2, kind: 'tick' }); send({ id: 3, kind: 'checkExport', lua: 'export', host: '', pages: '[]' })
    await drain()
    expect(api.Load).toHaveBeenCalledExactlyOnceWith('preview', 460, 460, '{}', '{}')
    expect(api.Tick).not.toHaveBeenCalled(); expect(api.CheckExport).not.toHaveBeenCalled()
    finish(JSON.stringify(status)); await drain()
    expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { kind: 'ready' }, { id: 1, kind: 'status', status }, { id: 2, kind: 'status', status }, { id: 3, kind: 'exportReport', report },
    ])
  })

  it('uses the actual metadata worker repeatedly without loading or checking a chip', async () => {
    const api = { ReadFontMetadata: vi.fn((_bytes: Uint8Array) => '{"family":"Example"}'), Load: vi.fn(), CheckExport: vi.fn() }
    const { port, send, drain } = await bootWorker(new URL('../editor/fontMetadata.worker.ts', import.meta.url), api)
    for (const id of [1, 2]) { send({ id, kind: 'metadata', data: new Uint8Array([id]).buffer }); await drain() }
    expect(api.ReadFontMetadata.mock.calls.map(([bytes]) => Array.from(bytes))).toEqual([[1], [2]])
    expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { kind: 'ready' }, { id: 1, result: { family: 'Example' } }, { id: 2, result: { family: 'Example' } },
    ])
    expect(api.Load).not.toHaveBeenCalled(); expect(api.CheckExport).not.toHaveBeenCalled()
  })
})
