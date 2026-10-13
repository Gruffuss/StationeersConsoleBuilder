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


import { templateProject } from './project/templateData'
const renders = vi.hoisted(() => ({} as Record<string, number>))
const timings = vi.hoisted(() => ({} as Record<string, number[]>))
vi.mock('./editor/Canvas', async original => {
  const actual = await original<typeof import('./editor/Canvas')>(), { Profiler } = await import('react')
  return { ...actual, Canvas: (p: Parameters<typeof actual.Canvas>[0]) => { renders.Canvas = (renders.Canvas ?? 0) + 1; return <Profiler id="Canvas" onRender={(_id, _phase, duration) => { (timings.Canvas ??= []).push(duration) }}>{<actual.Canvas {...p} />}</Profiler> } }
})
vi.mock('./editor/Layers', async original => {
  const actual = await original<typeof import('./editor/Layers')>(), { Profiler, createElement } = await import('react')
  return { ...actual, Layers: (p: Parameters<typeof actual.Layers>[0]) => { renders.Layers = (renders.Layers ?? 0) + 1; return <Profiler id="Layers" onRender={(_id, _phase, duration) => { (timings.Layers ??= []).push(duration) } }>{<actual.Layers {...p} />}</Profiler> } }
})
vi.mock('./editor/shell/Header', async original => {
  const actual = await original<typeof import('./editor/shell/Header')>(), { Profiler, createElement } = await import('react')
  return { ...actual, Header: (p: Parameters<typeof actual.Header>[0]) => { renders.Header = (renders.Header ?? 0) + 1; return <Profiler id="Header" onRender={(_id, _phase, duration) => { (timings.Header ??= []).push(duration) } }>{<actual.Header {...p} />}</Profiler> } }
})
vi.mock('./editor/shell/Inspector', async original => {
  const actual = await original<typeof import('./editor/shell/Inspector')>(), { Profiler, createElement } = await import('react')
  return { ...actual, Inspector: (p: Parameters<typeof actual.Inspector>[0]) => { renders.Inspector = (renders.Inspector ?? 0) + 1; return <Profiler id="Inspector" onRender={(_id, _phase, duration) => { (timings.Inspector ??= []).push(duration) } }>{<actual.Inspector {...p} />}</Profiler> } }
})
vi.mock('./editor/ThemeImport', async original => {
  const actual = await original<typeof import('./editor/ThemeImport')>(), { Profiler, createElement } = await import('react')
  return { ...actual, ThemeImport: (p: Parameters<typeof actual.ThemeImport>[0]) => { renders.ThemeImport = (renders.ThemeImport ?? 0) + 1; return <Profiler id="ThemeImport" onRender={(_id, _phase, duration) => { (timings.ThemeImport ??= []).push(duration) } }>{<actual.ThemeImport {...p} />}</Profiler> } }
})
vi.mock('./editor/FontImport', async original => {
  const actual = await original<typeof import('./editor/FontImport')>(), { Profiler, createElement } = await import('react')
  return { ...actual, FontImport: (p: Parameters<typeof actual.FontImport>[0]) => { renders.FontImport = (renders.FontImport ?? 0) + 1; return <Profiler id="FontImport" onRender={(_id, _phase, duration) => { (timings.FontImport ??= []).push(duration) } }>{<actual.FontImport {...p} />}</Profiler> } }
})
vi.mock('./editor/ProjectControls', async original => {
  const actual = await original<typeof import('./editor/ProjectControls')>(), { Profiler, createElement } = await import('react')
  return { ...actual, ProjectControls: (p: Parameters<typeof actual.ProjectControls>[0]) => { renders.ProjectControls = (renders.ProjectControls ?? 0) + 1; return <Profiler id="ProjectControls" onRender={(_id, _phase, duration) => { (timings.ProjectControls ??= []).push(duration) } }>{<actual.ProjectControls {...p} />}</Profiler> } }
})
vi.mock('./editor/shell/ShortcutsTable', async original => {
  const actual = await original<typeof import('./editor/shell/ShortcutsTable')>(), { Profiler, createElement } = await import('react')
  return { ...actual, ShortcutsTable: (p: Parameters<typeof actual.ShortcutsTable>[0]) => { renders.ShortcutsTable = (renders.ShortcutsTable ?? 0) + 1; return <Profiler id="ShortcutsTable" onRender={(_id, _phase, duration) => { (timings.ShortcutsTable ??= []).push(duration) } }>{<actual.ShortcutsTable {...p} />}</Profiler> } }
})

function largeProject() {
  const p = templateProject('atmos-tanks'), original = p.pages[0].scene
  p.pages[0].scene = { ...original, root: [], defs: [] }
  for (let copy = 0; p.pages[0].scene.root.length < 1152; copy++) {
    const cloned = JSON.parse(JSON.stringify(original).replace(new RegExp('\\b(' + original.root.map(n => n.attrs.id).join('|') + ')', 'g'), '$1copy' + copy)) as typeof original
    p.pages[0].scene.root.push(...cloned.root); p.pages[0].scene.defs.push(...cloned.defs)
  }
  p.pages[0].scene.root = p.pages[0].scene.root.slice(0, 1152)
  return p
}

it('opening and closing large-scene dialogs leaves the canvas, Layers and inspector settled', async () => {
  const x = await boot(largeProject()), samples: Record<string, number[]> = {}, counts: Record<string, Record<string, number>> = {}
  const open = async (name: string) => {
    if (name === 'New and open') {
      await run(() => Array.from(x.ui.container.querySelectorAll<HTMLButtonElement>('header button')).find(b => b.textContent === 'Project')!.click())
      await run(() => Array.from(x.ui.container.querySelectorAll<HTMLButtonElement>('[role=menu] button')).find(b => b.textContent?.startsWith('New from template'))!.click())
    } else await run(() => Array.from(x.ui.container.querySelectorAll<HTMLButtonElement>('header button')).find(b => b.textContent === name)!.click())
  }
  const close = (name: string) => {
    const dialog = Array.from(x.ui.container.querySelectorAll<HTMLDialogElement>('dialog')).find(d => d.open && d.querySelector('h2')?.textContent === name)!
    expect(dialog).toBeTruthy()
    return run(() => dialog.querySelector<HTMLButtonElement>('[aria-label=Close]')!.click())
  }
  await open('Export'); await close('Export')
  for (const name of ['Export', 'Fonts', 'New and open']) {
    samples[name] = []
    for (const key of Object.keys(renders)) renders[key] = 0
    for (let i = 0; i < 3; i++) {
      const start = performance.now(); await open(name); samples[name].push(performance.now() - start)
      await close(name)
    }
    counts[name] = { ...renders }
  }
  console.log('dialog samples ms', samples, 'open and close component calls', counts)
  for (const countsOfDialog of Object.values(counts)) for (const key of ['Canvas', 'Layers', 'Inspector', 'Header', 'FontImport', 'ThemeImport', 'ShortcutsTable']) expect(countsOfDialog[key], key).toBe(0)
  expect(counts.Export.ProjectControls).toBe(0)
  expect(counts.Fonts.ProjectControls).toBe(0)
}, 60000)

it('does not render hidden dialog bodies during a drag on 1152 widget groups', async () => {
  const p = largeProject()
  const x = await boot(p)
  expect(x.ctx.page().scene.root).toHaveLength(1152)
  expect(x.ctx.page().scene.root.every(n => n.comments?.some(c => c.startsWith('widget ')))).toBe(true)
  await run(() => x.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } }))
  vi.spyOn(x.ctx, 'pick').mockReturnValue({ target: { pageId: 'p1', path: [0] } })
  const overlay = x.ui.container.querySelector('.vb-overlay')!
  const pointer = (type: string, x: number) => run(() => { overlay.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: 40 })) })
  await pointer('pointerdown', 40)
  for (const key of Object.keys(timings)) { timings[key] = []; renders[key] = 0 }
  const elapsed: number[] = []
  for (let i = 0; i < 12; i++) { const start = performance.now(); await pointer('pointermove', 60 + i); elapsed.push(performance.now() - start) }
  console.log('drag samples ms', elapsed, 'render counts', Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, values.length])), 'Layers render ms', timings.Layers, 'component calls', renders)
  expect(timings.ThemeImport).toHaveLength(0)
  expect(timings.FontImport).toHaveLength(0)
  expect(timings.ShortcutsTable).toHaveLength(0)
  expect(timings.Layers).toHaveLength(0)
  expect(timings.Header).toHaveLength(0)
  expect(renders.Inspector).toBe(0)
}, 60000)
