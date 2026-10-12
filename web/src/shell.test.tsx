// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, run } from './testing'
import { App } from './App'
import * as editing from './editing/ctx'
import * as routing from './editing/router'
import * as autosave from './project/autosave'
import { newProject, type Project } from './model/project'
import { initialState, reducer } from './model/store'
import { parseSrc } from './srctext/parse'
import { checkWorkers } from './srctext/testing'
import { FakeWorker } from './runtime/testing'
import { answer, type Request } from './project/transfer.worker'
import { projectText } from './project/codec'
vi.mock('./project/autosave', async original => {
  const actual = await original<typeof autosave>()
  return { ...actual, readAutosave: vi.fn(), writeAutosave: vi.fn() }
})
vi.mock('./editor/CodePane', () => ({ CodePane: () => <div aria-label="Scene source" /> }))
vi.mock('./editor/gl', async original => ({
  zIndex: (await original<typeof import('./editor/gl')>()).zIndex,
  covers: () => [], makeRenderer: () => ({ maxTextureSize: 4096, draw() {}, dispose() {} }), startFailure: String,
}))

const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  vi.mocked(autosave.writeAutosave).mockImplementation(async (text, revision, updatedAt) => ({ kind: 'saved', record: { text, revision: revision + 1, updatedAt } }))
  vi.stubGlobal('ResizeObserver', class { constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {} observe() { this.cb([{ contentRect: { width: 460, height: 460 } }]) } disconnect() {} })
})
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
async function boot(project: Project) {
  vi.mocked(autosave.readAutosave).mockResolvedValue({ kind: 'ready', current: { text: projectText(project), revision: 1, updatedAt: '' }, recovery: null })
  const context = vi.spyOn(editing, 'makeCtx'), routers = vi.spyOn(routing, 'makeRouter'), jobs: Promise<void>[] = [], core = new FakeWorker()
  class Transfer extends FakeWorker {
    postMessage(message: Parameters<FakeWorker['postMessage']>[0]) {
      super.postMessage(message); jobs.push(answer(message as Request).then(reply => { this.reply(reply) }))
    }
  }
  const checks = checkWorkers()
  const ui = mount(<App makeWorker={() => core as unknown as Worker} makeCheckWorker={checks.make} makeTransferWorker={() => new Transfer() as unknown as Worker} />)
  cleanups.push(ui.unmount)
  const flush = () => run(async () => { while (jobs.length) await Promise.all(jobs.splice(0)) })
  await flush()
  await run(() => core.reply({ kind: 'ready' }))
  await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="100 percent"]')!.click())
  const ctx = context.mock.results.at(-1)!.value as ReturnType<typeof editing.makeCtx>
  const router = routers.mock.results.at(-1)!.value as ReturnType<typeof routing.makeRouter>
  const clickTab = (name: string) => run(() => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(b => b.textContent === name)!.click())
  return { ui, ctx, router, flush, clickTab }
}

const shape = (root: HTMLElement) => Array.from(root.querySelectorAll('*')).filter(el => !el.closest('.vb-stage, .vb-message-list')).map(el => [el.tagName, el.getAttribute('role'), el.getAttribute('aria-label'), el.id])
it('keeps pending picker colours and Discard visible outside the closed colour panel', async () => {
  const p = newProject(); p.pages[0].scene = parseSrc('R w=100 h=100 f=#ffffff').scene!
  const x = await boot(p), box = x.ui.container
  await run(() => x.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } }))
  const picker = box.querySelector<HTMLInputElement>('input[aria-label="f colour"]')!
  await run(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(picker, '#273849'); picker.dispatchEvent(new Event('change', { bubbles: true })) })
  const discard = Array.from(box.querySelectorAll<HTMLButtonElement>('[aria-label="Discard pending picker colours"]')).find(b => !b.closest('.vb-colour-panel'))
  expect(discard).toBeDefined()
  expect(discard!.parentElement!.textContent).toContain('#273849')
  await run(() => discard!.click())
  expect(box.querySelector('[aria-label="Discard pending picker colours"]')).toBeNull()
})
it('renders only real messages in the fixed-height drawer', async () => {
  const x = await boot(newProject())
  const rows = Array.from(x.ui.container.querySelectorAll('#vb-messages li'))
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every(row => row.lastElementChild?.textContent?.trim())).toBe(true)
})
it.each(['commitDrag', 'cancelDrag'] as const)('holds every chrome element through pointer dragging and %s', async end => {
  const p = newProject(); p.pages[0].scene = parseSrc('SCENE w=480 h=480\nR id=box x=10 y=10 w=100 h=100').scene!
  const x = await boot(p), box = x.ui.container
  expect(box.querySelector('.vb-frame-label')).not.toBeNull()
  await run(() => x.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } }))
  vi.spyOn(x.ctx, 'pick').mockReturnValue({ target: { pageId: 'p1', path: [0] } })
  const overlay = box.querySelector('.vb-overlay')!
  const pointer = (type: string, x: number) => run(() => { overlay.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: 40 })) })
  const before = shape(box)
  await pointer('pointerdown', 40); expect(x.router.busy()).toBe(true)
  await pointer('pointermove', 60); expect(shape(box)).toEqual(before)
  await pointer('pointerup', 60); expect(x.router.busy()).toBe(false); expect(shape(box)).toEqual(before)
  await run(() => x.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: { ...x.ctx.page().scene.root[0], attrs: { ...x.ctx.page().scene.root[0].attrs, x: 25 } }, transient: true }))
  expect(shape(box)).toEqual(before)
  await run(() => x.ctx.dispatch({ type: end })); expect(shape(box)).toEqual(before)
})
it('waits until the held press ends before opening an autosave failure dialog', async () => {
  const x = await boot(newProject())
  expect(x.ui.container.querySelector('.vb-source-head')).not.toBeNull()
  await run(() => x.ctx.dispatch({ type: 'setScene', pageId: 'p1', scene: parseSrc('R w=100 h=100').scene! }))
  vi.mocked(autosave.writeAutosave).mockResolvedValue({ kind: 'unavailable', reason: 'Storage failed' })
  const overlay = x.ui.container.querySelector('.vb-overlay')!
  await run(() => { overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 40, clientY: 40 })) })
  expect(x.router.busy()).toBe(true)
  await run(async () => { await vi.advanceTimersByTimeAsync(600) }); await x.flush()
  expect(x.ui.container.querySelector('dialog[open]')).toBeNull()
  await run(() => { overlay.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: 40, clientY: 40 })) })
  expect(x.router.busy()).toBe(false)
  expect(x.ui.container.querySelector('dialog[open] h2')!.textContent).toBe('Not saved')
})
