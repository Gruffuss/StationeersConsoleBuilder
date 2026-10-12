// @vitest-environment happy-dom
import { createElement, useReducer } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { PageTabs } from '../editor/PageTabs'
import { initialState, reducer } from '../model/store'
import type { SrcNode } from '../model/scene'
import { mount, run } from '../testing'
import { newProject } from '../model/project'
import { FakeWorker } from '../runtime/testing'
import { pack, unpack } from '../srctext/wire'
import { ProjectTransfer } from './transfer'
import { answer } from './transfer.worker'
import { projectText } from './codec'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('packs projects and validates request identity and operation replies', async () => {
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const p = newProject(), promise = transfer.text(p)
  expect(unpack(w.last().project as ReturnType<typeof pack>)).toEqual(p)
  w.reply({ id: 999, ok: true, value: 'late' })
  w.reply({ id: w.last().id, ok: true, value: 'serialized' })
  expect(await promise).toBe('serialized')
  transfer.dispose()
})

it('runs serially and starts each watchdog at posting, with unique IDs', async () => {
  vi.useFakeTimers()
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker, 100)
  const first = transfer.text(newProject()), second = transfer.compress(newProject())
  expect(w.posted).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(80)
  w.reply({ id: w.last().id, ok: true, value: 'one' })
  expect(await first).toBe('one')
  expect(w.posted).toHaveLength(2)
  expect(w.posted[1].id).not.toBe(w.posted[0].id)
  await vi.advanceTimersByTimeAsync(80)
  w.reply({ id: w.last().id, ok: true, value: '1.AA' })
  expect(await second).toBe('1.AA')
  transfer.dispose()
})

it('terminates a timed-out transfer, keeps the original state/text and restarts on retry', async () => {
  vi.useFakeTimers()
  const workers: FakeWorker[] = []
  const transfer = new ProjectTransfer(() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }, 5)
  const current = initialState(), original = projectText(current.project)
  const failed = transfer.read(original, 'json')
  const assertion = expect(failed).rejects.toThrow('Project transfer could not complete here; use the original JSON file')
  await vi.advanceTimersByTimeAsync(5)
  await assertion
  expect(workers[0].terminated).toBe(true)
  expect(projectText(current.project)).toBe(original)
  const retry = transfer.read(original, 'json')
  workers[0].reply({ id: workers[0].last().id, ok: true, value: 'stale' })
  workers[1].reply(await answer(workers[1].last() as Parameters<typeof answer>[0]))
  expect((await retry).project).toEqual(current.project)
  transfer.dispose()
})

it.each(['error', 'messageerror', 'dispose'])('rejects all outstanding jobs on %s and ignores late replies', async event => {
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const first = transfer.text(newProject()), queued = transfer.read('{}', 'json')
  const failures = [expect(first).rejects.toThrow(/transfer/i), expect(queued).rejects.toThrow(/transfer/i)]
  if (event === 'error') w.onerror?.({ message: 'crashed', preventDefault() {} } as ErrorEvent)
  else if (event === 'messageerror') w.onmessageerror?.({} as MessageEvent)
  else transfer.dispose()
  await Promise.all(failures)
  expect(w.terminated).toBe(true)
  w.reply({ id: w.last().id, ok: true, value: 'too late' })
  transfer.dispose()
  await expect(transfer.text(newProject())).rejects.toThrow(/stopped|disposed/i)
})

it.each([null, {}, { ok: 'yes', value: 'x' }, { ok: false, message: 1 }, { ok: true, value: [] }])('rejects malformed text reply %j', async bad => {
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const promise = transfer.text(newProject())
  w.reply(bad === null ? bad as unknown as object : { id: w.last().id, ...bad })
  await expect(promise).rejects.toThrow(/reply|transfer/i)
  expect(w.terminated).toBe(true)
  transfer.dispose()
})

it.each([[], { project: {}, notice: '' }, { project: pack(newProject()), notice: 1 },
  { project: { shape: [2, 1], atoms: ['x'] }, notice: '' },
  { project: { shape: [0], atoms: [{}] }, notice: '' }, { project: pack(null), notice: '' }])('rejects malformed packed read reply %j', async value => {
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const promise = transfer.read('{}', 'json')
  w.reply({ id: w.last().id, ok: true, value })
  await expect(promise).rejects.toThrow(/reply|transfer/i)
  transfer.dispose()
})

it.each([{}, [{ page: 'p1', src: 1 }], [{ page: 1, src: 'x' }], [null]])('rejects malformed sources reply %j', async value => {
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const promise = transfer.sources(newProject())
  w.reply({ id: w.last().id, ok: true, value })
  await expect(promise).rejects.toThrow(/reply|transfer/i)
  transfer.dispose()
})

it('returns worker input errors without poisoning the next operation', async () => {
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const bad = transfer.read('{}', 'json'), good = transfer.text(newProject())
  w.reply(await answer(w.last() as Parameters<typeof answer>[0]))
  await expect(bad).rejects.toThrow(/page/i)
  w.reply(await answer(w.last() as Parameters<typeof answer>[0]))
  expect(await good).toBe(projectText(newProject()))
  expect(w.terminated).toBe(false)
  transfer.dispose()
})

it('answers post/worker creation failures without leaving promises pending', async () => {
  const transfer = new ProjectTransfer(() => { throw new Error('unavailable') })
  await expect(transfer.text(newProject())).rejects.toThrow(/unavailable/)
  transfer.dispose()
  const w = new FakeWorker()
  w.postMessage = () => { throw new Error('clone failed') }
  const broken = new ProjectTransfer(() => w as unknown as Worker)
  await expect(broken.text(newProject())).rejects.toThrow(/clone failed/)
  broken.dispose()
})

it('transfers beyond structured-clone depth and emits exact Unicode sources in the worker', async () => {
  const p = newProject()
  let n: SrcNode = { op: 'T', attrs: { text: 'ț 🚀' }, comments: ['hello'], eol: 'end' }
  for (let k = 0; k < 1_000; k++) n = { op: 'G', attrs: {}, c: [n] }
  p.pages[0].scene.root = [n]
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const text = transfer.text(p)
  structuredClone(w.last())
  w.reply(await answer(w.last() as Parameters<typeof answer>[0]))
  expect(await text).toBe(projectText(p))
  const sources = transfer.sources(p)
  w.reply(await answer(w.last() as Parameters<typeof answer>[0]))
  const src = (await sources)[0]
  expect(src.page).toBe('p1')
  expect(src.src).toBe('SCENE w=480 h=480 fit=contain\n' +
    Array.from({ length: 1_000 }, (_, k) => '    '.repeat(Math.min(k, 32)) + 'G {\n').join('') +
    '    '.repeat(32) + '# hello\n' + '    '.repeat(32) + 'T text="ț 🚀"  # end\n' +
    Array.from({ length: 1_000 }, (_, k) => '    '.repeat(Math.min(999 - k, 32)) + '}\n').join(''))
  transfer.dispose()
})

it('guards source emission structurally but leaves semantic faults for the scene checker', async () => {
  const p = newProject()
  p.pages[0].scene.root = [{ op: 'unknown', attrs: { x: 'not-a-number' } }]
  const good = await answer({ id: 1, kind: 'sources', project: pack(p) })
  expect(good).toEqual({ id: 1, ok: true, value: [{ page: 'p1', src: 'SCENE w=480 h=480 fit=contain\nunknown x=not-a-number\n' }] })
  p.pages[0].scene.root[0].attrs = null as unknown as SrcNode['attrs']
  const bad = await answer({ id: 2, kind: 'sources', project: pack(p) })
  expect(bad.ok).toBe(false)
  if (!bad.ok) expect(bad.message).toMatch(/p1.*attrs/)
})

it('renders and edits a null-prototype unpacked project through the real reducer', async () => {
  const p = unpack(pack(newProject())) as ReturnType<typeof newProject>
  expect(Object.getPrototypeOf(p)).toBeNull()
  expect(Object.getPrototypeOf(p.pages[0])).toBeNull()
  let latest = p
  function Harness() {
    const [s, dispatch] = useReducer(reducer, p, initialState)
    latest = s.project
    return createElement(PageTabs, { pages: s.project.pages, activeId: s.activePageId, dispatch })
  }
  const ui = mount(createElement(Harness))
  try {
    const button = Array.from(ui.container.querySelectorAll('button')).find(b => b.textContent?.includes(p.pages[0].name) && b.hasAttribute('aria-pressed'))!
    await run(() => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })) })
    const input = ui.container.querySelector('input')!
    input.value = 'Restored'
    await run(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(latest.pages[0].name).toBe('Restored')
    expect(ui.container.textContent).toContain('Restored')
  } finally { ui.unmount() }
})

it('rejects cycles and functions before packing, preserving valid shared references', async () => {
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const p = newProject(), n: SrcNode = { op: 'G', attrs: {} }
  n.c = [n]; p.pages[0].scene.root = [n]
  await expect(transfer.text(p)).rejects.toThrow(/cycle/i)
  expect(w.posted).toEqual([])
  n.c = []
  n.attrs.bad = (() => 1) as unknown as number
  await expect(transfer.text(p)).rejects.toThrow(/data/i)
  delete n.attrs.bad
  p.pages[0].scene.root = [n, n]
  const valid = transfer.text(p)
  w.reply(await answer(w.last() as Parameters<typeof answer>[0]))
  expect(JSON.parse(await valid).pages[0].scene.root).toHaveLength(2)
  transfer.dispose()
})

it('reads a Blob in the worker and returns the same project as a string read', async () => {
  const text = projectText(newProject()), file = new Blob([text])
  const readText = vi.spyOn(file, 'text')
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  try {
    const reading = transfer.read(file, 'json')
    expect(w.last().text).toBe(file)
    expect(readText).not.toHaveBeenCalled()
    const stringRead = await answer({ id: 1, kind: 'read', format: 'json', text })
    const expected = stringRead.ok && typeof stringRead.value === 'object' && 'project' in stringRead.value
      ? { project: unpack(stringRead.value.project), notice: stringRead.value.notice } : null
    const check = expect(reading).resolves.toEqual(expected)
    w.reply(await answer(w.last() as Parameters<typeof answer>[0]))
    await check
    expect(readText).toHaveBeenCalledOnce()
  } finally { transfer.dispose() }
})

it('reports a Blob engine failure as larger than this browser can hold as text', async () => {
  const file = new Blob(['original'])
  vi.spyOn(file, 'text').mockRejectedValue(new RangeError('Invalid string length'))
  const result = await answer({ id: 1, kind: 'read', format: 'json', text: file })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.message).toContain('larger than this browser can hold as text')
})

it('aborting an active read terminates its worker and rejects that read', async () => {
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
  const controller = new AbortController()
  const settled = transfer.read(new Blob(['original']), 'json', controller.signal)
    .then(value => ({ value, error: null }), error => ({ value: null, error }))
  controller.abort()
  const terminatedOnAbort = w.terminated
  transfer.dispose()
  const result = await settled
  expect(terminatedOnAbort).toBe(true)
  expect(result.error?.name).toBe('AbortError')
})

it('a pre-aborted read never starts a worker', async () => {
  const makeWorker = vi.fn(() => new FakeWorker() as unknown as Worker)
  const transfer = new ProjectTransfer(makeWorker), controller = new AbortController()
  controller.abort()
  const reading = transfer.read('original', 'json', controller.signal)
    .then(value => ({ value, error: null }), error => ({ value: null, error }))
  const starts = makeWorker.mock.calls.length
  transfer.dispose()
  expect((await reading).error?.name).toBe('AbortError')
  expect(starts).toBe(0)
})
