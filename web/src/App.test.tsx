// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { Scene } from './model/scene'
import type { Action } from './model/store'
import type { Project } from './model/project'
import * as editing from './editing/ctx'
import * as autosave from './project/autosave'
import { compressProject, decompressProject, projectText } from './project/codec'
import { embeddedToken } from './project/input'
import { answer, type Request } from './project/transfer.worker'
import { projectDb } from './testing'
import { configurePageFonts } from './editor/pageFonts'
import { setFontMetadataReader } from './editor/fonts'
vi.mock('./project/autosave', async original => {
  const actual = await original<typeof import('./project/autosave')>()
  return { ...actual, readAutosave: vi.fn(actual.readAutosave), writeAutosave: vi.fn(actual.writeAutosave) }
})
const realAutosave = await vi.importActual<typeof autosave>('./project/autosave')
// CodeMirror measures layout, which happy-dom does not do: the pane is a stub that hands its props to the test, so a test
// can read the active scene and dispatch as the pane would.
const pane = vi.hoisted(() => ({ props: null as { scene: Scene; dispatch: (a: Action) => void } | null }))
vi.mock('./editor/CodePane', () => ({ CodePane: (p: { scene: Scene; dispatch: (a: Action) => void }) => { pane.props = p; return null } }))
import { App } from './App'
import { bannerSrc } from './codegen/generate'
import * as codegen from './codegen/generate'
import * as diagnostics from './codegen/checks'
import * as geometryBounds from './editing/bounds'
import { newProject } from './model/project'
import { FakeWorker, label, vbf1 } from './runtime/testing'
import { CoreBridge } from './runtime/bridge'
import { checkScene, invalid, tooLarge } from './srctext/check'
import { parseSrc } from './srctext/parse'
import { printSrc } from './srctext/print'
import { checkWorkers } from './srctext/testing'
import { mount as mountOnce, run } from './testing'
import { colour, THEMES } from './theme'
import { fontNotices, isKnownFont, registerPageFonts } from './editor/fonts'
import { ProjectTransfer } from './project/transfer'
import { Pictures } from './editor/pictures'
import type { ExportReport } from './runtime/exportCheck'
import { loadCatalog } from './catalog'
import { TEMPLATES } from './project/templates'
import { templateProject } from './project/templateData'
import { projectOf } from './editor/ExamplePicker'
import { imported } from './theme/testing'
import { themeFileOf } from './theme/file'

it.each([true, false])('mounts one standalone import next to Theme and wires add, undo and browser reuse (keep first: %s)', async keepFirst => {
  const context = vi.spyOn(editing, 'makeCtx')
  try {
    const app = await booted(), box = app.ui.container
    expect(box.querySelectorAll('.vb-theme-import')).toHaveLength(1)
    const opener = Array.from(box.querySelectorAll('button')).find(b => b.textContent === 'Import a design system…')!
    expect(opener.textContent).toBe('Import a design system…')
    expect(box.querySelector('.vb-theme-import')!.closest('.vb-toolbar')).toBeNull()
    await run(() => opener.click())
    expect(box.querySelector('dialog[open] h2')!.textContent).toBe('Import a design system')
    const input = box.querySelector<HTMLTextAreaElement>('[aria-label="Tokens or theme JSON"]')!
    await run(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, JSON.stringify(themeFileOf(THEMES['vanilla-plus'])))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const click = (label: string) => run(() => { Array.from(box.querySelectorAll('button')).find(b => b.textContent === label)!.click() })
    await click('Read JSON'); if (keepFirst) await click('Keep in this browser')
    await click('Add theme')
    expect(context.mock.results.at(-1)!.value.get().project.theme).toBe('ds-vanilla-imported')
    if (!keepFirst) await click('Keep in this browser')
    expect(Object.keys(JSON.parse(localStorage.getItem('vb.themes')!))).toEqual(['ds-vanilla-imported'])
    await run(() => pane.props!.dispatch({ type: 'undo' }))
    expect(context.mock.results.at(-1)!.value.get().project.theme).toBe('neutral')
  } finally { localStorage.removeItem('vb.themes') }
})

it('the Theme list includes project and browser themes and adds a browser choice', async () => {
  const browser = { ...imported, id: 'ds-browser', name: 'Browser theme' }
  localStorage.setItem('vb.themes', JSON.stringify({ [browser.id]: themeFileOf(browser) }))
  const p = { ...newProject(), themes: { [imported.id]: imported } }
  vi.mocked(autosave.readAutosave).mockResolvedValue({ kind: 'ready', current: recordOf(p), recovery: null })
  const context = vi.spyOn(editing, 'makeCtx')
  try {
    const app = await booted(), choices = app.ui.container.querySelector('.vb-theme-menu')!
    expect(Array.from(choices.querySelectorAll('.mgroup')).map(g => g.textContent)).toEqual(['Provided', 'Project', 'This browser'])
    expect(choices.querySelector('[role=menuitemradio][aria-label="Imported test"]')).not.toBeNull()
    await run(() => choices.querySelector<HTMLButtonElement>(`[role=menuitemradio][aria-label="${browser.name}"]`)!.click())
    const state = context.mock.results.at(-1)!.value.get()
    expect(state.project.theme).toBe(browser.id)
    expect(state.project.themes![browser.id]).toEqual(browser)
    expect(app.ui.container.querySelectorAll('#vb-theme-menu')).toHaveLength(1)
  } finally { localStorage.removeItem('vb.themes') }
})
it('says why the current project theme is not removed', async () => {
  const p = { ...newProject(), theme: imported.id, themes: { [imported.id]: imported } }
  vi.mocked(autosave.readAutosave).mockResolvedValue({ kind: 'ready', current: recordOf(p), recovery: null })
  const app = await booted()
  await run(() => app.ui.container.querySelector<HTMLButtonElement>(`[aria-label="Remove ${imported.name} from project"]`)!.click())
  expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent)
    .toContain(`cannot remove ${imported.name}: it is the current theme; choose another theme first`)
  expect(app.ui.container.querySelector('[role=menuitemradio][aria-label="Imported test"]')!.getAttribute('aria-checked')).toBe('true')
})

// Every App mounted here is unmounted after its test, once. No WebGL here: the canvas reports that it could not start,
// and that is the only console error a test may cause (an act or wiring error fails it).
configurePageFonts({ readFontMetadata: async () => ({ status: 'failed' as const, cause: 'No metadata requested' }), registerPageFonts })
const mounted: (() => void)[] = []
const mount = (ui: Parameters<typeof mountOnce>[0]) => {
  const m = mountOnce(ui)
  let gone = false
  const unmount = () => { if (!gone) { gone = true; m.unmount() } }
  mounted.push(unmount)
  return { ...m, unmount }
}
const errors = () => vi.spyOn(console, 'error').mockImplementation(() => {})
// These 15 async tests took 0.78..2.42 s alongside the full suites; concurrent builder runs exceeded 5 s.
// A timeout leaves React's act queue unfinished: skip the rest of this file instead of cascading mount failures.
let timedOut = false
beforeEach(ctx => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.mocked(autosave.readAutosave).mockResolvedValue({ kind: 'ready', current: recordOf(newProject()), recovery: null })
  vi.mocked(autosave.writeAutosave).mockImplementation(async (text, revision, at) => ({ kind: 'saved', record: { text, revision: revision + 1, updatedAt: at } }))
  const metadata = async () => ({ status: 'failed' as const, cause: 'No metadata requested' })
  setFontMetadataReader(metadata)

  if (timedOut) ctx.skip()
  onTestFailed(({ task }) => { timedOut ||= task.result?.errors?.some(e => /Test timed out/.test(e.message)) ?? false })
  vi.spyOn(ProjectTransfer.prototype, 'compress').mockResolvedValue('1.YWJj')
})
afterEach(() => {
  for (const u of mounted.splice(0)) u()
  const said = vi.isMockFunction(console.error) ? vi.mocked(console.error).mock.calls : []
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  pane.props = null
  expect(said.filter(c => !(c[0] instanceof Error && c[0].message === 'WebGL 2 is not available'))).toEqual([])
})

const wait = async (ms: number) => {
  await run(() => {}) // let scene checks and React effects schedule the debounce before moving the clock
  await run(async () => { await vi.advanceTimersByTimeAsync(ms) })
}
const toggleScripts = async (box: HTMLElement) => {
  const dev = Array.from(box.querySelectorAll('label')).find(l => l.textContent?.includes('Example scripts (dev)'))?.querySelector('input')
  if (dev) { await run(() => dev.click()); return }
  await run(() => Array.from(box.querySelectorAll<HTMLButtonElement>('[role="menubar"] button')).find(b => b.textContent === 'Help')!.click())
  await run(() => Array.from(box.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')).find(b => b.textContent?.startsWith('Example scripts'))!.click())
}
// As a player does: the New dialog open (its opening loads the starters' projects), then the choice.
const pickTemplate = async (box: HTMLElement, id: string) => {
  const name = TEMPLATES.find(t => t.id === id)!.name
  const dialog = () => Array.from(box.querySelectorAll<HTMLDialogElement>('dialog')).find(d => d.open && d.querySelector('h2')?.textContent === 'New and open')
  if (!dialog()) {
    await run(() => Array.from(box.querySelectorAll<HTMLButtonElement>('header button')).find(b => b.textContent === 'Project')!.click())
    await run(() => Array.from(box.querySelectorAll<HTMLButtonElement>('[role=menu] button')).find(b => b.textContent?.startsWith('New from template'))!.click())
  }
  for (let k = 0; k < 200 && box.querySelector('.vb-templates [role="status"]')?.textContent; k++) await run(() => new Promise(r => setTimeout(r, 10)))
  expect(box.querySelector('.vb-templates [role="status"]')?.textContent).toBe('')
  const choice = Array.from(box.querySelectorAll('[role="radiogroup"][aria-label="Open template"] label')).find(l => l.textContent?.startsWith(name))!.querySelector<HTMLInputElement>('input')!
  await run(() => choice.click())
}
const scene = (text: string) => parseSrc(text).scene!
const tab = (app: Awaited<ReturnType<typeof booted>>, name: string) => Array.from(app.ui.container.querySelectorAll('[role="tab"]')).find(b => b.textContent === name) as HTMLButtonElement
const ELEMENT = { id: 'scene', scene: 'p1', x: 0, y: 0, w: 460, h: 460, firstVertex: 0, vertexCount: 0 }

it('mounts one page picture action, scopes its notes and click, and keeps consent out of the project', async () => {
  const connect = vi.spyOn(Pictures.prototype, 'connect'), load = vi.spyOn(Pictures.prototype, 'loadPictures').mockResolvedValue(undefined)
  const network = vi.fn(); vi.stubGlobal('fetch', network)
  const app = await booted(), pictures = connect.mock.instances.at(-1)! as Pictures
  expect(pictures).toBeDefined()
  await run(() => pictures.observe('p1', ['https://example.com/one', 'file:///a.bmp']))
  expect(app.ui.container.querySelectorAll('[aria-label="Pictures"]')).toHaveLength(1)
  expect(app.ui.container.textContent).toContain('https://example.com/one')
  const button = () => Array.from(app.ui.container.querySelectorAll('button')).find(b => b.textContent === 'Load pictures')!
  await run(() => button().click()); expect(load).toHaveBeenLastCalledWith('p1')
  await run(() => pane.props!.dispatch({ type: 'addPage' }))
  await run(() => pictures.observe('p2', ['https://example.com/two']))
  expect(app.ui.container.querySelector('[aria-label="Pictures"]')!.textContent).not.toContain('https://example.com/one')
  await run(() => button().click()); expect(load).toHaveBeenLastCalledWith('p2')
  await run(() => pane.props!.dispatch({ type: 'undo' }))
  await run(() => pane.props!.dispatch({ type: 'redo' }))
  expect(network).not.toHaveBeenCalled()
  expect(app.sent('load').every(m => !String(m.lua).includes('Load pictures'))).toBe(true)
})

it('walks a large selected group once per geometry change during a drag', async () => {
  const app = await booted(), size = 4000
  const root = scene(`G {\n${Array.from({ length: size }, (_, i) => `R x=${i % 100} y=${Math.floor(i / 100)} w=1 h=1`).join('\n')}\n}\n`)
  expect(root.root[0].c).toHaveLength(size)
  await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: root }))
  await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } }))
  const original = geometryBounds.worldBox, costs: number[] = []
  vi.spyOn(geometryBounds, 'worldBox').mockImplementation((...args) => {
    const start = performance.now(), out = original(...args), cost = performance.now() - start
    const stack = new Error().stack ?? ''
    if (stack.includes('at App (')) costs.push(cost)
    return out
  })
  for (let i = 1; i <= 20; i++) await run(() => pane.props!.dispatch({ type: 'updateNode', pageId: 'p1', path: [0],
    node: { ...root.root[0], attrs: { t: [i, 0] } }, transient: true }))
  const sorted = [...costs].sort((a, b) => a - b)
  console.info('selection fit drag', { size, calls: costs.length, totalMs: costs.reduce((a, b) => a + b, 0), medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1) })
  expect(costs.length).toBeGreaterThan(0)
  expect(costs.length).toBeLessThanOrEqual(20)
}, 30000)

type Sent = FakeWorker['posted']
/** Answers every request the core worker has not had answered: a frame (by default, the page's element and nothing
 *  drawn; `frame` gets what was posted before it), else a halted status. */
function server(w: FakeWorker, frame: (before: Sent) => ArrayBuffer = () => vbf1(JSON.stringify({ elements: [ELEMENT], text: [], problems: [] }))) {
  const done = new Set<number>()
  let active = 'main'
  const reply = w.reply.bind(w)
  vi.spyOn(w, 'reply').mockImplementation(data => {
    const m = data as { id?: number; status?: { active?: string } }
    if (m.id !== undefined) done.add(m.id)
    active = m.status?.active ?? active
    reply(data)
  })
  return async () => {
    do {
      await run(() => {
        for (const [k, m] of w.posted.entries()) {
          if (done.has(m.id)) continue
          if (m.kind === 'frame') w.reply({ id: m.id, kind: 'frame', buf: frame(w.posted.slice(0, k)), workerMs: 0 })
          else w.reply({ id: m.id, kind: 'status', status: { state: 'Halted', error: null, instructions: 1, output: [], active } })
        }
      })
    } while (w.posted.some(m => m.kind !== 'frame' && !done.has(m.id)))
  }
}

/** App with fake workers, booted and past the load's 150 ms debounce, every core request answered; `held`: checks wait;
 *  `frame`: what every frame holds. */
async function booted({ held = false, strict = false, frame, initialScene }: { held?: boolean; strict?: boolean; frame?: (before: Sent) => ArrayBuffer; initialScene?: string } = {}) {
  errors()
  if (initialScene !== undefined) {
    const project = newProject(); project.pages[0].scene = scene(initialScene)
    vi.mocked(autosave.readAutosave).mockResolvedValue({ kind: 'ready', current: recordOf(project), recovery: null })
  }
  const workers: FakeWorker[] = [], exports: FakeWorker[] = [], captures: FakeWorker[] = [], checks = checkWorkers()
  const makeCheck = () => { const worker = checks.make(); checks.made.at(-1)!.held = held; return worker }
  const app = <App makeTransferWorker={transferWorkers().make} makeWorker={() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }} makeCheckWorker={makeCheck}
    makeExportWorker={() => { const w = new FakeWorker(); exports.push(w); return w as unknown as Worker }}
    makeCaptureWorker={() => { const w = new FakeWorker(); captures.push(w); return w as unknown as Worker }} />
  const ui = mount(strict ? <StrictMode>{app}</StrictMode> : app)
  await run(() => {})
  const core = workers.at(-1)   // Startup reuses the boot worker; StrictMode disposes its first instance.
  if (!core) throw new Error('App did not mount its core worker; a previous unfinished React act may have blocked mounting')
  await run(() => core.reply({ kind: 'ready' }))
  await wait(200)
  const serve = server(core, frame)
  await serve()
  // Existing editor tests pin 100%; navigation has its own coverage below.
  await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="100 percent"]')?.click())
  const checkExport = async (over: Partial<ExportReport> = {}) => {
    await loadCatalog()
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Check export"]')!.click())
    const w = exports.at(-1)!
    expect(w, ui.container.querySelector('.vb-export')?.textContent).toBeTruthy()
    await run(() => w.reply({ kind: 'ready' }))
    await run(() => w.reply({ id: 1, kind: 'exportReport', report: { complete: true, issues: [], loadInstructions: 1, worstTickInstructions: 1, ticks: 20, visited: ['p1'], ...over } satisfies ExportReport }))
    return w
  }
  return { ui, workers, exports, captures, checkExport, checks, serve, check: () => checks.made.at(-1)!, core: () => core,
    sent: (kind: string) => core.posted.filter(m => m.kind === kind) }
}

async function foreignOffer() {
  vi.spyOn(ProjectTransfer.prototype, 'read').mockResolvedValue({ kind: 'foreign', lua: 'error("retained source")' })
  const app = await booted()
  await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R w=20 h=20') }))
  const file = app.ui.container.querySelector<HTMLInputElement>('[aria-label="Open project file"]')!
  await run(() => {
    Object.defineProperty(file, 'files', { configurable: true, value: [new File(['foreign'], 'foreign.lua')] })
    file.dispatchEvent(new Event('change', { bubbles: true }))
  })
  return app
}
async function adoptedApp() {
  const app = await foreignOffer()
  await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Adopt this script"]')!.click())
  const worker = app.captures[0]
  await run(() => worker.reply({ kind: 'ready' }))
  const report = JSON.parse(readFileSync('test/fixtures/adopt/src.capture.json', 'utf8'))
  await run(() => worker.reply({ id: 1, kind: 'captureReport', report }))
  expect(app.ui.container.querySelectorAll('[aria-label="Adoption report"]')).toHaveLength(1)
  return app
}
it('keeps the adoption offer and typed import text through transient edits', async () => {
  const app = await foreignOffer(), text = app.ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Project text"]')!
  await run(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, 'keep this draft')
    text.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await run(() => pane.props!.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: { op: 'R', attrs: { x: 10, w: 20, h: 20 } }, transient: true }))
  expect(app.ui.container.querySelector('[aria-label="Adopt this script"]')).not.toBeNull()
  expect(app.ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Project text"]')!.value).toBe('keep this draft')
  await run(() => pane.props!.dispatch({ type: 'cancelDrag' }))
  expect(app.ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Project text"]')!.value).toBe('keep this draft')
})
it('keeps the adoption report and click ids through transient and committed edits', async () => {
  const app = await adoptedApp(), report = () => app.ui.container.querySelector('[aria-label="Adoption report"]')
  const original = report()!.textContent
  await run(() => pane.props!.dispatch({ type: 'updateNode', pageId: 'p1', path: [1], node: { ...pane.props!.scene.root[1], attrs: { ...pane.props!.scene.root[1].attrs, x: 1 } }, transient: true }))
  expect(report()?.textContent).toBe(original)
  await run(() => pane.props!.dispatch({ type: 'commitDrag' }))
  expect(report()?.textContent).toBe(original)
  expect(report()?.textContent).toContain('next')
})
it.each(['commitDrag', 'cancelDrag'] as const)('keeps header controls mounted throughout a transient gesture and %s', async end => {
  const context = vi.spyOn(editing, 'makeCtx'), app = await adoptedApp()
  await run(() => { app.ui.container.querySelector<HTMLButtonElement>('dialog[open] [aria-label="Close"]')!.click() })
  await run(() => Array.from(app.ui.container.querySelectorAll<HTMLButtonElement>('header button')).find(b => b.textContent === 'Fonts')!.click())
  const header = app.ui.container, before = Array.from(header.querySelectorAll('dialog *'))
  const exports = header.querySelector('.vb-export')!, project = header.querySelector('.vb-project')!, fonts = header.querySelector('.vb-fonts')!.closest('dialog')!
  expect(exports).not.toBeNull(); expect(project).not.toBeNull()
  expect(fonts.open).toBe(true)
  const check = () => {
    const after = Array.from(header.querySelectorAll('dialog *'))
    expect(after).toHaveLength(before.length)
    after.forEach((element, i) => expect(element).toBe(before[i]))
    expect(exports.isConnected).toBe(true)
    expect(project.isConnected).toBe(true)
    expect(fonts.open).toBe(true)
  }
  await run(() => pane.props!.dispatch({ type: 'updateNode', pageId: 'p1', path: [1], node: { ...pane.props!.scene.root[1], attrs: { ...pane.props!.scene.root[1].attrs, x: 1 } }, transient: true }))
  expect(context.mock.results.at(-1)!.value.get().dragBase).toBeTruthy()
  check()
  await run(() => pane.props!.dispatch({ type: end }))
  expect(context.mock.results.at(-1)!.value.get().dragBase).toBeNull()
  check()
})
it.each(['dismiss', 'replace'])('clears the adoption report on explicit %s', async how => {
  const app = await adoptedApp()
  if (how === 'dismiss') await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Dismiss adoption report"]')!.click())
  else await run(() => pane.props!.dispatch({ type: 'loadProject', project: newProject() }))
  expect(app.ui.container.querySelector('[aria-label="Adoption report"]')).toBeNull()
})

describe('App font warnings', () => {
  it('m4_Blank_Bar_checked_download_copy_and_embedded_restore_smoke', async () => {
    const app = await booted()
    await run(() => tab(app, 'Widgets').click())
    await pickTemplate(app.ui.container, 'blank')
    await run(() => Array.from(app.ui.container.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === 'Open template')!.click())
    await run(() => Array.from(app.ui.container.querySelectorAll<HTMLButtonElement>('.vb-palette button')).find(b => b.textContent === 'Bar')!.click())
    await wait(200)
    const captured = templateProject('blank')
    captured.pages[0].scene = pane.props!.scene
    vi.mocked(ProjectTransfer.prototype.compress).mockResolvedValue(await compressProject(captured))
    const writeText = vi.fn(async (_text: string) => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    let blob!: Blob
    vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { blob = b as Blob; return 'blob:m4-smoke' })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const checked = await app.checkExport()
    await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!.click())
    await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Download the script"]')!.click())
    const downloaded = await blob.text()
    expect(downloaded).toBe(writeText.mock.calls[0][0]); expect(downloaded).toBe(checked.last().lua)
    const { readProject } = await import('./project/input')
    const restored = readProject(await decompressProject(embeddedToken(downloaded)!)).project
    expect(restored.name).toBe('Blank')
    expect(restored.pages[0].scene).toEqual(pane.props!.scene)
    expect(restored.pages[0].scene.root[0].comments?.join('\n')).toContain('bar')
  })
  it('clears registry notices and late observers only on project replacement, retaining session faces', async () => {
    const app = await booted(), controller = new AbortController()
    const own = Object.getOwnPropertyDescriptor(document, 'fonts'), rejects: ((e: Error) => void)[] = []
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn(), delete: vi.fn() } })
    vi.stubGlobal('FontFace', class { loaded = new Promise<void>((_, reject) => rejects.push(reject)) })
    const metadata = { status: 'ok' as const, names: {}, axes: [], faces: [], family: 'Old project notice', style: 'Regular', instances: [] }
    const group = { family: 'CSS', style: 'normal', weight: '400', minWeight: 400, maxWeight: 400, representative: 'https://fonts.gstatic.com/app-notice.woff2',
      sources: [{ url: 'https://fonts.gstatic.com/app-notice.woff2', unicodeRange: 'U+0-FF', display: 'swap' as const }], metadata }
    try {
      await run(() => {
        registerPageFonts('app-first', [group], () => {}, controller.signal)
        registerPageFonts('app-conflict', [{ ...group, metadata: { ...metadata, style: '' } }], () => {}, controller.signal)
      })
      expect(fontNotices()).toContainEqual(expect.stringContaining('different face claimed'))
      await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('T text=edited') }))
      expect(fontNotices()).toContainEqual(expect.stringContaining('different face claimed'))
      await run(() => pane.props!.dispatch({ type: 'loadProject', project: newProject() }))
      expect(fontNotices()).toEqual([])
      expect(isKnownFont('Old project notice')).toBe(true)
      await run(async () => { rejects[0](new Error('departed subset')); await Promise.resolve() })
      expect(fontNotices()).toEqual([])
      expect(app.ui.container.textContent).not.toContain('departed subset')
    } finally {
      controller.abort()
      if (own) Object.defineProperty(document, 'fonts', own)
      else delete (document as { fonts?: unknown }).fonts
      app.ui.unmount()
    }
  })

  it('copies and downloads preserved FONT declarations with no font request', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw Error('no request before consent') }))
    const app = await booted()
    const source = 'DEFS {\nfont SRC="https://fonts.gstatic.com/direct.ttf"\nFONT src="https://blocked.example/font.otf"\n}\nT text=x\n'
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene(source) }))
    await wait(200)
    await app.checkExport()
    const clipboard = { writeText: vi.fn(async (_text: string) => {}) }, own = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    let downloaded!: Blob
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloaded = blob as Blob; return 'blob:test' })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!.click())
      const lua = clipboard.writeText.mock.calls[0][0] as string
      expect(lua).toContain('font SRC=https://fonts.gstatic.com/direct.ttf')
      expect(lua).toContain('FONT src=https://blocked.example/font.otf')
      expect(lua).toContain('floor = 11118')
      await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Download the script"]')!.click())
      expect(await downloaded.text()).toBe(lua)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      if (own) Object.defineProperty(navigator, 'clipboard', own)
      else delete (navigator as { clipboard?: unknown }).clipboard
      app.ui.unmount()
    }
  })
  it('drops and restores a scene problem when its custom face is imported and removed', async () => {
    const { importFont, removeFont } = await import('./editor/fonts')
    const app = await booted()
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    const own = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete() {} } })
    try {
      await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('T font="Custom Display" text="x"\n') }))
      await wait(50)
      const status = () => app.ui.container.querySelector('.vb-status [aria-live]')!.textContent
      expect(status()).toContain('Preview fonts: Not available here')
      const loads = app.sent('load').length, patches = app.sent('patch').length
      await run(async () => { await importFont('Custom Display', new ArrayBuffer(8), false) })
      expect(status()).not.toContain('Preview fonts: Not available here')
      expect(status()).toContain('game uses its fallback and reports it')
      await run(async () => { await removeFont('Custom Display') })
      expect(status()).toContain('Preview fonts: Not available here')
      expect(app.sent('load')).toHaveLength(loads)
      expect(app.sent('patch')).toHaveLength(patches)
    } finally {
      await run(async () => { await removeFont('Custom Display') })
      if (own) Object.defineProperty(document, 'fonts', own)
      else delete (document as { fonts?: unknown }).fonts
      app.ui.unmount()
    }
  })
})

describe('App status (N-C)', () => {
  it('shows the core line, announces a halt, and drops the halt once the restarted core is ready', async () => {
    errors()
    const workers: FakeWorker[] = []
    const ui = mount(<App makeTransferWorker={transferWorkers().make} makeWorker={() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }}
      makeCheckWorker={checkWorkers().make} makeExportWorker={() => new FakeWorker() as unknown as Worker} />)
    const shown = () => ui.container.querySelector('.vb-status .vb-run-line')!.textContent
    const spoken = () => ui.container.querySelector('.vb-status [aria-live]')!.textContent
    expect(shown()).toBe('booting the core…')
    await run(() => {})
    await run(() => workers.at(-1)!.reply({ kind: 'ready' }))
    expect(shown()).toMatch(/^core ready in \d+ ms$/)
    expect(spoken()).toBe('')
    await run(() => workers.at(-1)!.reply({ kind: 'crashed', why: 'boom' }))
    expect(spoken()).toContain('halted: worker crashed: boom')
    expect(workers).toHaveLength(2)
    await run(() => workers.at(-1)!.reply({ kind: 'ready' }))
    expect(spoken()).not.toContain('halted')
    expect(shown()).toMatch(/^core ready in \d+ ms$/)
    ui.unmount()
    expect(workers.every(w => w.terminated)).toBe(true)
  })
})

describe('App scene checks', () => {
  it('loads only after 150 ms of quiet after the latest export edit', async () => {
    const app = await booted()
    const loads = app.sent('load').length
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: 'U.x = 1' } }))
    await wait(149)
    expect(app.sent('load')).toHaveLength(loads)
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: 'U.x = 2' } }))
    await wait(149)
    expect(app.sent('load')).toHaveLength(loads)
    await wait(1)
    await app.serve()
    expect(app.sent('load')).toHaveLength(loads + 1)
    expect(app.sent('load').at(-1)!.lua).toContain('U.x = 2')
  })
  it("loads the project once its pages checked clean, with each page's printed scene", async () => {
    const app = await booted({ initialScene: 'R w=10 h=10' })
    expect(app.sent('load')).toHaveLength(1)
    expect(app.sent('load')[0].lua).toContain(printSrc(scene('R w=10 h=10')))
  })

  it('loads under StrictMode, whose second effect run replaces the first checker', async () => {
    const app = await booted({ strict: true })
    expect(app.sent('load')).toHaveLength(1)
    expect(app.workers).toHaveLength(2)
    expect(app.checks.made.length).toBeGreaterThan(1)
    expect(app.checks.made.slice(0, -1).every(w => w.terminated)).toBe(true)
  })

  it('sends nothing to the core while a check is pending', async () => {
    const app = await booted({ held: true })
    expect(app.core().kinds()).not.toContain('load')
  })

  it('sends no patch for an edit until its check lands, then one patch with the checked text', async () => {
    const app = await booted({ initialScene: 'R w=10 h=10' })
    app.check().held = true
    const next = scene('R x=1 y=2 w=3 h=4\n')
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: next }))
    await wait(50)
    expect(app.sent('patch')).toHaveLength(0)
    await run(() => app.check().release())
    await wait(50)
    expect(app.sent('patch').map(m => m.src)).toEqual([printSrc(next) + bannerSrc(next.header)])
  })

  it('while the newest scene waits for its check, patches the newest one whose check landed (a drag keeps drawing)', async () => {
    const app = await booted({ initialScene: 'R w=10 h=10' })
    app.check().held = true
    const one = scene('R x=1 y=2 w=3 h=4\n'), two = scene('R x=2 y=2 w=3 h=4\n')
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: one }))
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: two }))
    await run(() => app.check().release())   // one's check lands; two's is posted and waits
    await wait(50)
    expect(app.sent('patch').map(m => m.src)).toEqual([printSrc(one) + bannerSrc(one.header)])
    await app.serve()   // the core answers that patch
    await run(() => app.check().release())
    await wait(50)
    expect(app.sent('patch').map(m => m.src)).toEqual([printSrc(one) + bannerSrc(one.header), printSrc(two) + bannerSrc(two.header)])
  })

  it.each([
    ['too large to check here', tooLarge('x')],
    ['invalid', invalid('bad')],
  ])('sends no patch for an edit whose check says it is %s', async (_, verdict) => {
    const app = await booted()
    app.check().verdict = () => verdict
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=1\n') }))
    await wait(50)
    expect(app.sent('patch')).toHaveLength(0)
  })

  it('says a page is too large to check here as information, and sends nothing', async () => {
    errors()
    const workers: FakeWorker[] = []
    const ui = mount(<App makeTransferWorker={transferWorkers().make} makeWorker={() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }}
      makeCheckWorker={checkWorkers(() => tooLarge('x')).make} makeExportWorker={() => new FakeWorker() as unknown as Worker} />)
    await run(() => {})
    await run(() => workers.at(-1)!.reply({ kind: 'ready' }))
    await wait(200)
    expect(workers.at(-1)!.kinds()).not.toContain('load')
    expect(ui.container.querySelector('.vb-status [aria-live]')!.textContent)
      .toBe('info: Main: this scene is too large to check here (x); it is not sent to the preview')
  })

  it("names an invalid page's errors and sends nothing", async () => {
    errors()
    const workers: FakeWorker[] = []
    const ui = mount(<App makeTransferWorker={transferWorkers().make} makeWorker={() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }}
      makeCheckWorker={checkWorkers(() => invalid('bad')).make} makeExportWorker={() => new FakeWorker() as unknown as Worker} />)
    await run(() => {})
    await run(() => workers.at(-1)!.reply({ kind: 'ready' }))
    await wait(200)
    expect(workers.at(-1)!.kinds()).not.toContain('load')
    expect(ui.container.querySelector('.vb-status [aria-live]')!.textContent).toBe('Main: bad')
  })
})

describe('App property panel', () => {
  it("edits the selected node through the store, and leaves Ctrl+Z in a typed field to the field", async () => {
    const app = await booted()
    await run(() => {
      pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=1\n') })
      pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } })
    })
    const w = app.ui.container.querySelector<HTMLInputElement>('.vb-props input[aria-label="w"]')!
    await run(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(w, '20')
      w.dispatchEvent(new Event('input', { bubbles: true }))
      w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await wait(50)
    expect(pane.props!.scene.root[0].attrs).toEqual({ x: 1, w: 20 })
    const ctrlZ = (at: Element) => run(() => { at.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })) })
    await ctrlZ(app.ui.container.querySelector('.vb-props input[aria-label="w"]')!)
    expect(pane.props!.scene.root[0].attrs).toEqual({ x: 1, w: 20 })   // the field's own undo
    await ctrlZ(document.body)
    expect(pane.props!.scene.root[0].attrs).toEqual({ x: 1 })
  })
})

describe('blank page scene transitions', () => {
  it('loads no scene, reloads once for its first node, patches later edits, and reloads when cleared', async () => {
    const app = await booted()
    expect(String(app.sent('load').at(-1)!.lua)).toContain('empty = true')
    const loads = app.sent('load').length
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R w=20 h=20') }))
    await wait(50); await app.serve()
    expect(app.sent('patch')).toHaveLength(0)
    // Another edit before the reload must not patch a scene which does not exist yet.
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R w=30 h=20') }))
    await wait(50); await app.serve()
    expect(app.sent('patch')).toHaveLength(0)
    await wait(200); await app.serve()
    expect(app.sent('load')).toHaveLength(loads + 1)
    expect(String(app.sent('load').at(-1)!.lua)).toContain('R w=30 h=20')
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R w=40 h=20') }))
    await wait(200); await app.serve()
    expect(app.sent('load')).toHaveLength(loads + 1)
    expect(app.sent('patch')).toHaveLength(1)
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('SCENE w=480 h=480 fit=contain\n') }))
    await wait(200); await app.serve()
    expect(app.sent('load')).toHaveLength(loads + 2)
    expect(String(app.sent('load').at(-1)!.lua)).toContain('empty = true')
    expect(app.sent('patch')).toHaveLength(1)
  })
})

describe('App page shapes', () => {
  it("loads each surface's own size, and loads again when a page's shape changes", async () => {
    const app = await booted()
    await run(() => pane.props!.dispatch({ type: 'addPage' }))   // page2, now active
    await wait(200)
    await app.serve()
    const loads = app.sent('load').length
    expect(app.sent('load').at(-1)).toMatchObject({ w: 460, h: 460, sizes: '{"main":[460,460],"page2":[460,460]}' })
    const select = app.ui.container.querySelector<HTMLSelectElement>('select[aria-label="Console size"]')!
    await run(() => {
      select.value = '2x1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await wait(200)
    await app.serve()
    expect(app.sent('load')).toHaveLength(loads + 1)
    expect(app.sent('load').at(-1)).toMatchObject({ w: 1036, h: 460, sizes: '{"main":[460,460],"page2":[1036,460]}' })
  }, 15_000)
})

describe('App layout', () => {
  it('keeps one main work area', async () => {
      const app = await booted()
      const main = app.ui.container.querySelector<HTMLElement>('[role="main"]')!
      expect(main).not.toBeNull()
      expect(main.classList.contains('vb-canvas-area')).toBe(true)
      expect(app.ui.container.querySelectorAll('[role="main"]')).toHaveLength(1)
  })
  it('sets the cursor on the canvas area only', async () => {
      const app = await booted()
      const main = app.ui.container.querySelector<HTMLElement>('.vb-canvas-area')!
      expect(main.style.getPropertyValue('--vb-cursor')).toBe('default')
      expect(app.ui.container.querySelector<HTMLElement>('.vb-workspace')!.style.getPropertyValue('--vb-cursor')).toBe('')
  })
  it('keeps frame actions outside the clipped stage', async () => {
      const app = await booted()
      expect(app.ui.container.querySelector('.vb-frame-label')!.closest('.vb-stage')).toBeNull()
      await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=10 y=20 w=100 h=100') }))
      await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } }))
      expect(app.ui.container.querySelector('.vb-taskbar')!.closest('.vb-stage')).toBeNull()
  })
})

// A 460 px box, so the canvas has zoom 1 and asks the core for frames.
const box460 = () => vi.stubGlobal('ResizeObserver', class {
  constructor(private readonly cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
  observe() { this.cb([{ contentRect: { width: 460, height: 460 } }]) }
  disconnect() {}
})

it('Edit navigates with the wheel and view buttons without changing the exported scene; Play keeps its wheel', async () => {
  box460()
  const app = await booted()
  const before = pane.props!.scene
  const zoom = () => app.ui.container.querySelector<HTMLInputElement>('[aria-label="Zoom percent"]')
  expect(zoom()).not.toBeNull()
  const initial = Number(zoom()!.value)
  // happy-dom's WheelEvent is a UIEvent: it implements neither mouse coordinates nor modifier keys.
  const wheel = (deltaY: number, keys: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => run(() => {
    app.ui.container.querySelector('.vb-overlay')!.dispatchEvent(Object.assign(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY,
    }), { clientX: 230, clientY: 230, shiftKey: false, ctrlKey: false, metaKey: false, ...keys }))
  })
  const pan = () => app.ui.container.querySelector<HTMLElement>('.vb-view')!.style.transform.match(/translate\(([^p]+)px, ([^p]+)px\)/)!.slice(1).map(Number)
  const [x, y] = pan()
  await wheel(120)   // a plain wheel or a two-finger scroll pans
  expect(Number(zoom()!.value)).toBe(initial)
  expect(pan()[0]).toBeCloseTo(x); expect(pan()[1]).toBeCloseTo(y - 120)
  await wheel(40, { shiftKey: true })   // Shift turns a mouse wheel sideways
  expect(pan()[0]).toBeCloseTo(x - 40); expect(pan()[1]).toBeCloseTo(y - 120)
  await wheel(-120, { ctrlKey: true })   // Ctrl + wheel (a trackpad pinch) or Cmd + wheel zooms
  expect(Number(zoom()!.value)).toBeGreaterThan(initial)
  expect(app.sent('pointer')).toHaveLength(0)
  await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="100 percent"]')!.click())
  expect(Number(zoom()!.value)).toBe(100)
  expect(pane.props!.scene).toBe(before)
  await run(() => app.ui.container.querySelector<HTMLInputElement>('[aria-label="Play"]')!.click())
  expect(zoom()).toBeNull()
  await run(() => { app.ui.container.querySelector('.vb-preview')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })) })
  await app.serve()
  expect(app.sent('pointer').at(-1)).toMatchObject({ type: 'wheel', dy: -1 })
  expect(pane.props!.scene).toBe(before)
})

it('draws just one frame of transform handles for the selected set', async () => {
  box460()
  const app = await booted()
  await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('SCENE w=460 h=460\nR x=100 y=100 w=10 h=10\nR x=120 y=100 w=10 h=10\n') }))
  await wait(200); await app.serve()
  await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }] }))
  expect(app.ui.container.querySelectorAll('.vb-handle')).toHaveLength(8)
  expect(app.ui.container.querySelectorAll('.vb-knob')).toHaveLength(1)
})

describe('App widgets', () => {
  it('selects a grouped widget with its form, preview slots and transformed outline kept', async () => {
    box460()
    const app = await booted()
    await run(() => pane.props!.dispatch({ type: 'insertWidget', pageId: 'p1', widget: 'light' }))
    const initial = pane.props!.scene
    await run(() => pane.props!.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...initial, root: [{ op: 'G', attrs: { t: [10, 20] }, c: initial.root }] }, selection: { pageId: 'p1', path: [0,0] } }))
    for (let k = 0; k < 5; k++) { await wait(50); await app.serve() }
    expect(app.ui.container.querySelector('[aria-label="Widget"] h2')?.textContent).toBe('Status light lt1')
    expect(app.sent('load').at(-1)!.lua).toContain('samples = { ["lt1_st"] = 1 }')
    const corners = [[242, 252], [258, 252], [258, 268], [242, 268]].flat().map(v => v * (460 / 480))
    const actual = app.ui.container.querySelector('.vb-selection polygon')!.getAttribute('points')!.split(/[ ,]/).map(Number)
    actual.forEach((v, i) => expect(v).toBeCloseTo(corners[i], 6))
    app.ui.unmount()
  })
  it('loads again when the preview data changes, outlines a selected widget by its params, and says when one is detached', async () => {
    box460()
    const app = await booted()
    const settle = async () => { for (let k = 0; k < 5; k++) { await wait(50); await app.serve() } }
    const loads = app.sent('load').length
    await run(() => pane.props!.dispatch({ type: 'insertWidget', pageId: 'p1', widget: 'light' }))   // inserted selected
    await settle()
    expect(app.sent('load')).toHaveLength(loads + 1)   // its slot's sample is data: a load, not a patch
    expect(app.sent('load').at(-1)!.lua).toContain('samples = { ["lt1_st"] = 1 }')
    const corners = [[232, 232], [248, 232], [248, 248], [232, 248]].map(p => p.map(v => v * (460 / 480)).join(',')).join(' ')
    expect(app.ui.container.querySelector('.vb-selection polygon')?.getAttribute('points')).toBe(corners)   // Neutral's 16-unit light on 460 px
    await run(() => pane.props!.dispatch({ type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: 3 }))
    await settle()
    expect(app.sent('load')).toHaveLength(loads + 2)
    expect(app.sent('load').at(-1)!.lua).toContain('samples = { ["lt1_st"] = 3 }')
    const sc = pane.props!.scene
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: { ...sc, root: sc.root.map(n => n.c ? { ...n, c: n.c.slice(1) } : n) } }))
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('detached lt1: edited by hand (Ctrl+Z puts it back)')
    app.ui.unmount()
  }, 15_000)
  it('switches the theme from the toolbar: the shell loads again, on the new ground', async () => {
    const app = await booted()
    const loads = app.sent('load').length, choices = app.ui.container.querySelector('.vb-theme-menu')!
    expect(Array.from(choices.querySelectorAll('[role=menuitemradio]'), o => o.getAttribute('aria-label'))).toEqual(['Neutral', 'Vanilla +'])
    await run(() => choices.querySelector<HTMLButtonElement>('[aria-label="Vanilla +"]')!.click())
    await wait(200)
    expect(choices.querySelector('[aria-label="Vanilla +"]')!.getAttribute('aria-checked')).toBe('true')
    expect(app.sent('load')).toHaveLength(loads + 1)
    expect(app.sent('load').at(-1)!.lua).toContain('bg = { bg = "#3A3A43", gradient = "#24242A" }')
    await app.serve()   // the load answered, so the next one goes out
    await run(() => { choices.querySelector('[aria-label="Vanilla +"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })) })   // Ctrl+Z from a theme choice
    await wait(200)
    expect(choices.querySelector('[aria-label="Neutral"]')!.getAttribute('aria-checked')).toBe('true')
    expect(app.sent('load')).toHaveLength(loads + 2)
    app.ui.unmount()
  }, 15_000)
})

describe('App selection while checks are pending', () => {
  it('keeps the selection and its handles through a resize drag whose steps are not checked yet', async () => {
    box460()
    const app = await booted()
    await run(() => {
      pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=10 y=10 w=50 h=50\n') })
      pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } })
    })
    for (let k = 0; k < 5; k++) { await wait(20); await app.serve() }   // the patch, then frames
    const handles = () => Array.from(app.ui.container.querySelectorAll('.vb-handle'))
    expect(handles()).toHaveLength(8)
    const se = handles()[4], w = () => pane.props!.scene.root[0].attrs.w
    // The SE handle's centre in CSS px (= surface px at zoom 1; happy-dom puts the overlay at 0, 0): its rect's x, y + 4.
    const sx = Number(se.getAttribute('x')) + 4, sy = Number(se.getAttribute('y')) + 4
    const overlay = app.ui.container.querySelector('.vb-overlay')!
    app.check().held = true   // no step of the drag gets checked
    const at = (type: string, d: number) => run(() => { overlay.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: sx + d, clientY: sy + d })) })
    await at('pointerdown', 0)
    await at('pointermove', 10)
    const first = w()
    expect(first).toBeGreaterThan(50)
    expect(handles()).toHaveLength(8)
    expect(se.isConnected).toBe(true)
    await at('pointermove', 30)
    expect(w()).toBeGreaterThan(first as number)   // the drag is still open
    await at('pointerup', 30)
    app.ui.unmount()
  })
})

describe('App editing (M2c)', () => {
  const key = (target: EventTarget, init: KeyboardEventInit) =>
    run(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
  const sel = () => (pane.props as unknown as { selection: unknown }).selection
  it('routes the document keys: Esc selects the parent, Ctrl+Z undoes, a text field keeps its own keys', async () => {
    const app = await booted()
    const g = scene('G {\n  R x=1 y=2 w=3 h=4\n}\n')
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: g }))
    await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } }))
    await key(document, { key: 'Escape' })
    expect(sel()).toEqual({ pageId: 'p1', path: [0] })
    const input = document.createElement('input')
    document.body.append(input)
    await key(input, { key: 'z', ctrlKey: true })
    expect(pane.props!.scene).toBe(g)
    await key(document, { key: 'z', ctrlKey: true })
    expect(pane.props!.scene).not.toBe(g)
    input.remove()
    app.ui.unmount()
  })
  it('shows the editing bar with the select tool pressed, and how many nodes a multi-selection holds', async () => {
    const app = await booted()
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=1\nC rx=2\n') }))
    await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }] }))
    const bar = app.ui.container.querySelector('.vb-rail')!
    expect(bar.querySelector('button[aria-pressed="true"]')!.textContent).toBe('Select')
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('2 selected (the panel shows the last)')
    // On another page the set is not shown, and not counted.
    await run(() => pane.props!.dispatch({ type: 'addPage' }))
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).not.toContain('selected')
    app.ui.unmount()
  })
  it('routes no key in the dev scripts mode: Ctrl+Z and Esc there leave the project and the selection alone', async () => {
    const app = await booted()
    const g = scene('G {\n  R x=1 y=2 w=3 h=4\n}\n')
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: g }))
    await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } }))
    const scripts = () => toggleScripts(app.ui.container)
    await scripts()
    await key(document, { key: 'z', ctrlKey: true })
    await key(document, { key: 'Escape' })
    await scripts()
    expect(pane.props!.scene).toBe(g)
    expect(sel()).toEqual({ pageId: 'p1', path: [0, 0] })
    app.ui.unmount()
  })
})

describe('App editing smoke (M2c)', () => {
  it('a tool key presses its button and Esc goes back to Select; Ctrl+A selects everything; Delete removes it in one undo step', async () => {
    const app = await booted()
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=1 y=1 w=5 h=5\nC cx=20 cy=20 rx=3\n') }))
    const key = (init: KeyboardEventInit) => run(() => { document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
    await key({ key: 'r' })
    expect(app.ui.container.querySelector('.vb-rail button[aria-pressed="true"]')!.textContent).toBe('Rectangle')
    await key({ key: 'Escape' })
    expect(app.ui.container.querySelector('.vb-rail button[aria-pressed="true"]')!.textContent).toBe('Select')
    await key({ key: 'a', ctrlKey: true })
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('2 selected')
    await key({ key: 'Delete' })
    expect(pane.props!.scene.root).toEqual([])
    await key({ key: 'z', ctrlKey: true })
    expect(pane.props!.scene.root).toHaveLength(2)
    app.ui.unmount()
  })
})

describe('App picking while the preview shows an older tree', () => {
  // A frame of page p1 with geometry: an opaque 40 x 10 square at the origin (node 0's span) and a T's label at 200, 200
  // (node 1): what the core draws for `R x=0 y=0 w=40 h=10 f=#fff` then `T x=200 y=200 w=40 h=10`. `square`: the R's
  // node, 1 when the T comes first.
  const drawn = (square = 0) => {
    const pos = [0, 0, 40, 0, 40, 10, 0, 10], ind = [0, 1, 2, 0, 2, 3], spans = [0, square, 0, 4], v = pos.length / 2
    const body = new TextEncoder().encode(JSON.stringify({ elements: [{ ...ELEMENT, vertexCount: v }],
      text: [label({ x: 200, y: 200, w: 40, h: 10, node: 1 - square })], problems: [] }))
    const buf = new ArrayBuffer(20 + 16 * v + 4 * ind.length + 4 * spans.length + body.length), bytes = new Uint8Array(buf)
    bytes.set(new TextEncoder().encode('VBF1'))
    new Int32Array(buf, 4, 4).set([v, ind.length, spans.length / 4, body.length])
    let at = 20
    new Float32Array(buf, at, 2 * v).set(pos); at += 8 * v
    new Float32Array(buf, at, v).fill(1); at += 4 * v
    bytes.fill(255, at, at + 4 * v); at += 4 * v
    new Uint32Array(buf, at, ind.length).set(ind); at += 4 * ind.length
    new Int32Array(buf, at, spans.length).set(spans); at += 4 * spans.length
    bytes.set(body, at)
    return buf
  }
  it.each([0, 1])('fits selected expression-driven node %s by the geometry in the shown frame', async path => {
    box460()
    const app = await booted({ frame: () => drawn() })
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('SCENE w=460 h=460\nR x=$x y=0 w=40 h=10 f=#fff\nT x=$x y=200 w=40 h=10 text=hi\n') }))
    for (let k = 0; k < 6; k++) { await wait(50); await app.serve() }
    await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [path] } }))
    const fit = app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Fit selection"]')!
    expect(fit.disabled).toBe(false)
    await run(() => fit.click())
    expect(app.ui.container.querySelector<HTMLInputElement>('[aria-label="Zoom percent"]')!.value).toBe('1030')
    expect(pane.props!.scene.root[path].attrs.x).toBe('$x')
  })

  it('reads no frame through a numbering of another shape: a reorder while another page is invalid', async () => {
    vi.stubGlobal('ResizeObserver', class {   // a 460 px box: zoom 1, so the canvas asks for frames
      constructor(private readonly cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 460, height: 460 } }]) }
      disconnect() {}
    })
    const app = await booted({ frame: () => drawn(), initialScene: 'R w=10 h=10' })
    app.check().verdict = s => s.root.some(n => n.attrs.x === 777) ? invalid('bad') : checkScene(s)
    const settle = async () => { for (let k = 0; k < 5; k++) { await wait(20); await app.serve() } }
    const sel = () => (pane.props as unknown as { selection: unknown }).selection
    const press = async () => {
      const overlay = app.ui.container.querySelector('.vb-overlay')!
      for (const type of ['pointerdown', 'pointerup'])
        await run(() => { overlay.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: 5, clientY: 5 })) })
    }
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=0 y=0 w=40 h=10 f=#fff\nT x=200 y=200 w=40 h=10 text=hi\n') }))
    await settle()
    await press()
    expect(sel()).toEqual({ pageId: 'p1', path: [0] })   // the square, through the numbering of the tree it was drawn from
    // Another page goes invalid, so nothing is sent; then a reorder on p1, whose own check lands clean.
    await run(() => pane.props!.dispatch({ type: 'addPage' }))
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p2', scene: scene('R x=777\n') }))
    await run(() => pane.props!.dispatch({ type: 'setActivePage', pageId: 'p1' }))
    await settle()
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('T x=200 y=200 w=40 h=10 text=hi\nR x=0 y=0 w=40 h=10 f=#fff\n') }))
    await settle()
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('Page 2: bad')
    // The frame is still the old tree's: its node 0 is the square, which the new numbering names as the T.
    await press()
    expect(sel()).toBeNull()
    // Nor is the selection outlined from it: the R, now node 1, is not the old frame's node 1 (the T's label). The outline
    // comes from the model (the R's own box), never from a label or span box read out of the old frame.
    await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [1] } }))
    await settle()
    const outline = app.ui.container.querySelector('.vb-selection')
    expect(outline?.querySelector('polygon.vb-sel-over')?.getAttribute('points')).toBe('0,0 184,0 184,46 0,46')
    expect(outline?.querySelector('rect.vb-sel-over')).toBeNull()
  }, 15_000)
  // Ctrl+Z, then a click before the frame of the undone scene: the pick read the old frame through the
  // numbering of the scene it had queued, so a click on the R selected the T (Ctrl+C then copied the wrong node).
  it('reads no frame through the numbering of a scene sent after it was asked for: a click right after an undo', async () => {
    vi.stubGlobal('ResizeObserver', class {   // a 460 px box: zoom 1, so the canvas asks for frames
      constructor(private readonly cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 460, height: 460 } }]) }
      disconnect() {}
    })
    // The fake core draws what it was last sent: the R second when the last load or patch printed the T first.
    const app = await booted({ initialScene: 'R w=10 h=10', frame: before => {
      const last = before.filter(m => m.kind === 'load' || m.kind === 'patch').at(-1), text = String(last?.src ?? last?.lua ?? '')
      return drawn(text.indexOf('T x=200') >= 0 && text.indexOf('T x=200') < text.indexOf('R x=0') ? 1 : 0)
    } })
    const settle = async () => { for (let k = 0; k < 5; k++) { await wait(20); await app.serve() } }
    const sel = () => (pane.props as unknown as { selection: { path: number[] } | null }).selection?.path ?? null
    const press = async () => {
      const overlay = app.ui.container.querySelector('.vb-overlay')!
      for (const type of ['pointerdown', 'pointerup'])
        await run(() => { overlay.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: 5, clientY: 5 })) })
    }
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=0 y=0 w=40 h=10 f=#fff\nT x=200 y=200 w=40 h=10 text=hi\n') }))
    await settle()
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('T x=200 y=200 w=40 h=10 text=hi\nR x=0 y=0 w=40 h=10 f=#fff\n') }))
    await settle()
    await press()
    expect(sel()).toEqual([1])   // the R, drawn second
    await run(() => { document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true })) })
    expect(pane.props!.scene.root[0].op).toBe('R')
    // No frame of the undone scene yet: the R's place in the frame shown is node 1, which the undone scene numbers as the T.
    await press()
    expect(sel()).toBeNull()
    await settle()
    await press()
    expect(sel()).toEqual([0])
  }, 15_000)
})

describe('App widgets', () => {
  it('inserts from the palette, shows the widget form, and Delete removes the widget', async () => {
    const app = await booted()
    await run(() => tab(app, 'Widgets').click())
    await run(() => Array.from(app.ui.container.querySelectorAll('button')).find(b => b.textContent === 'Status light')!.click())
    await wait(50)
    expect(app.ui.container.querySelector('[aria-label="Widget"] h2')!.textContent).toBe('Status light lt1')
    expect(pane.props!.scene.root.some(n => n.attrs.id === 'lt1')).toBe(true)
    await run(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })) })
    await wait(50)
    expect(app.ui.container.querySelector('[aria-label="Widget"]')).toBeNull()
    expect(pane.props!.scene.root.some(n => n.attrs.id === 'lt1')).toBe(false)
    app.ui.unmount()
  })
  it('keeps Delete in the widget form’s controls, in any button or bar around the canvas, with a modifier held, and in the dev scripts mode', async () => {
    const app = await booted()
    await run(() => tab(app, 'Widgets').click())
    const button = (text: string) => Array.from(app.ui.container.querySelectorAll('button')).find(b => b.textContent === text)!
    const del = (at: EventTarget, init: KeyboardEventInit = {}) =>
      run(() => { at.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, ...init })) })
    await run(() => button('Bar').click())
    await wait(50)
    await del(app.ui.container.querySelector('[aria-label="target"]')!)
    await del(button('Detach'))
    await del(document, { shiftKey: true })
    const scripts = () => toggleScripts(app.ui.container)
    await scripts()
    await del(document)
    await scripts()
    await wait(50)
    // A palette entry, a page tab, the theme picker: pressing one is not choosing the widget (final-wave ruling 3).
    await del(button('Bar'))
    await run(() => tab(app, 'Layers').click())
    await del(app.ui.container.querySelector('[aria-label="Pages"] button')!)
    await del(app.ui.container.querySelector('button[aria-label="Theme"]')!)
    await wait(50)
    expect(pane.props!.scene.root.some(n => n.attrs.id === 'bar1')).toBe(true)
    await del(document.body)   // the canvas, or nothing focused: the selected widget goes
    await wait(50)
    expect(pane.props!.scene.root.some(n => n.attrs.id === 'bar1')).toBe(false)
    app.ui.unmount()
  })
  // The export smoke test: the generated script is the one the preview sends to the core. The load follows a 150 ms
  // debounce and a check round trip, and the new sample changes the layout, so it is waited for by polling.
  it('opens, adds a widget, and exports it: the shell sent to the core holds its marker, nodes and samples (the smoke test)', async () => {
    const app = await booted()
    await run(() => tab(app, 'Widgets').click())
    await run(() => Array.from(app.ui.container.querySelectorAll('button')).find(b => b.textContent === 'Bar')!.click())
    let lua: string | undefined
    for (let k = 0; k < 40 && !lua; k++) {   // up to 2 s
      await wait(50)
      await app.serve()
      lua = app.sent('load').map(m => m.lua as string | undefined).find(l => l?.includes('# widget bar bar1 {'))
    }
    expect(lua).toContain('G id=bar1 {')
    expect(lua).toContain('["bar1_lvl"] = 0.62')
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: {
      roles: [{ id: 'tank', name: 'Tank', prefabs: ['StructureGasSensor'], mode: 'one' }],
      reads: [{ id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } } }],
      bindings: { bar1_lvl: { from: 'read', read: 'p' } },
      simDevices: [{ id: 's', prefab: 'StructureGasSensor', label: 'Tank', ref: 2, role: 'tank', values: {} }],
    } }))
    for (let k = 0; k < 6; k++) { await wait(50); await app.serve() }
    expect(app.sent('load').at(-1)!.lua).toContain('o["bar1_lvl"] = P.p')
    expect(app.sent('load').at(-1)!.lua).toContain('function tick(dt) VB.tick(dt) end')
    app.ui.unmount()
  }, 15_000)
})

describe('App natives', () => {
  it('inserts a native from the palette as a selected placeholder the shell declares; its form, Delete, undo, a theme switch, a new design size and a new fit reload it', async () => {
    box460()
    const app = await booted()
    await run(() => tab(app, 'Widgets').click())
    const settle = async () => { for (let k = 0; k < 5; k++) { await wait(50); await app.serve() } }
    const lua = () => app.sent('load').at(-1)!.lua as string
    const placeholders = () => Array.from(app.ui.container.querySelectorAll<HTMLElement>('.vb-native'), e => [e.textContent, e.className])
    await run(() => Array.from(app.ui.container.querySelectorAll('button')).find(b => b.textContent === 'Text input')!.click())
    await settle()
    expect(app.ui.container.querySelector('[aria-label="Widget"] h2')!.textContent).toBe('Text input ti1')
    expect(placeholders()).toEqual([['Text', 'vb-native vb-native-sel']])
    expect(lua()).toContain(`uid = "ti1", type = "textinput"`)
    expect(lua()).toContain(`style = { ["bg"] = "${colour(THEMES.neutral, 'surface-well')}"`)
    // the theme: the native's colours come with a load
    const choice = app.ui.container.querySelector<HTMLButtonElement>('[role=menuitemradio][aria-label="Vanilla +"]')!
    await run(() => choice.click())
    await settle()
    expect(lua()).toContain(`style = { ["bg"] = "${colour(THEMES['vanilla-plus'], 'surface-well')}"`)
    // a header edit in the code pane: its design size scales the natives, so it loads again rather than patching
    const loads = app.sent('load').length
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: { ...pane.props!.scene, header: { w: 960, h: 960, fit: 'contain' } } }))
    await settle()
    expect(app.sent('load')).toHaveLength(loads + 1)
    expect(lua()).toContain('dw = 960, dh = 960, fit = "contain"')
    // an edit of the fit alone: the natives map by it, so it loads again too
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: { ...pane.props!.scene, header: { w: 960, h: 960, fit: 'cover' } } }))
    await settle()
    expect(app.sent('load')).toHaveLength(loads + 2)
    expect(lua()).toContain('dw = 960, dh = 960, fit = "cover"')
    // Delete removes the selected native, Ctrl+Z brings it back
    await run(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })) })
    await wait(50)
    expect(placeholders()).toEqual([])
    expect(app.ui.container.querySelector('[aria-label="Widget"]')).toBeNull()
    await run(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })) })
    await wait(50)
    expect(placeholders().map(([text]) => text)).toEqual(['Text'])
    // a press on the placeholder selects it
    await run(() => { app.ui.container.querySelector('.vb-native')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(placeholders()).toEqual([['Text', 'vb-native vb-native-sel']])
    expect(app.ui.container.querySelector('[aria-label="Widget"] h2')!.textContent).toBe('Text input ti1')
    // the placeholders sit under the selection, so a selected widget's handles stay on top
    await run(() => Array.from(app.ui.container.querySelectorAll('button')).find(b => b.textContent === 'Bar')!.click())
    await settle()
    expect(app.ui.container.querySelectorAll('.vb-selection .vb-handle')).toHaveLength(8)
    expect(app.ui.container.querySelector('.vb-native, .vb-selection')!.className).toBe('vb-native')
    app.ui.unmount()
  }, 15_000)
})

describe('App reload and export behaviour', () => {
  it('fresh_check_does_not_touch_preview and selection_tick_frame_do_not_invalidate', async () => {
    const app = await booted()
    const preview = app.core().posted.slice(), exportWorker = await app.checkExport()
    expect(app.core().posted).toEqual(preview)
    expect(exportWorker).not.toBe(app.core())
    const writeText = vi.fn(async (_text: string) => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [] } }))
    await wait(500); await app.serve()
    await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!.click())
    expect(writeText.mock.calls[0][0]).toBe(exportWorker.last().lua)
    expect(app.exports).toHaveLength(1)
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: 'local edited=1' }, transient: true }))
    expect(app.ui.container.querySelector('[aria-label="Check export"]')).not.toBeNull()
    expect(app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!.disabled).toBe(false)
    await run(() => pane.props!.dispatch({ type: 'commitDrag' }))
    expect(app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!.disabled).toBe(true)
  })
  it.each([undefined, true, false])('takes stores from a halted in-flight operation before loading, with wipeOnReexport=%s', async wipe => {
    const app = await booted()
    await run(() => app.ui.container.querySelector<HTMLInputElement>('[aria-label="Play"]')!.click())
    await app.serve()
    await run(() => { app.ui.container.querySelector('.vb-overlay')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })) })
    if (app.core().last().kind === 'frame') await run(() => app.core().reply({ id: app.core().last().id, kind: 'frame', buf: vbf1(), workerMs: 0 }))
    const pointer = app.sent('pointer').at(-1)!, loads = app.sent('load').length
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: 'U.x = 9',
      ...(wipe === undefined ? {} : { settings: { ...newProject().settings, wipeOnReexport: wipe } }) } }))
    await wait(200)
    expect(app.sent('load')).toHaveLength(loads)
    const memory = Array(512).fill(7)
    await run(() => app.core().reply({ id: pointer.id, kind: 'status', status: { state: 'Halted', error: null, instructions: 1, output: [], active: 'old_surface', persist: { k: 'v' }, memory } }))
    const fresh = app.sent('load').at(-1)!
    expect(JSON.parse(String(fresh.host))).toMatchObject({ persist: wipe ? {} : { k: 'v' }, memory })
    // Until the new chip replies, its preview starts on the first surface.
    await run(() => { app.ui.container.querySelector('.vb-overlay')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })) })
    await app.serve()
    expect(app.sent('pointer').at(-1)!.surface).toBe('main')
  })
  it('does not generate or read traps during transient drag steps, even after a pause', async () => {
    const app = await booted({ initialScene: 'R w=10 h=10' })
    const generated = vi.spyOn(codegen, 'generate'), traps = vi.spyOn(diagnostics, 'readTraps')
    const loads = app.sent('load').length
    for (let x = 1; x <= 3; x++) {
      await run(() => pane.props!.dispatch({ type: 'editScene', pageId: 'p1', scene: scene('R x=' + x + ' y=0 w=10 h=10\n'), transient: true }))
      await wait(180)
      await app.serve()
    }
    expect([generated.mock.calls.length, traps.mock.calls.length]).toEqual([0, 0])
    expect(app.sent('load')).toHaveLength(loads)
    expect(app.sent('patch').length).toBeGreaterThan(0)
    await run(() => pane.props!.dispatch({ type: 'commitDrag' }))
    await wait(200)
    await app.serve()
    expect(generated).toHaveBeenCalled()
    expect(traps).toHaveBeenCalledTimes(1)
  }, 15_000)
  it('preserves persist and memory on a restart after a scene patch', async () => {
    const app = await booted({ initialScene: 'SCENE w=480 h=480 fit=contain\nR w=10 h=10' })
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('SCENE w=480 h=480 fit=contain\nR x=1 y=0 w=10 h=10\n') }))
    await wait(200)
    await app.serve()
    expect(app.sent('load')).toHaveLength(1)
    const patch = app.sent('patch').at(-1)!
    // A status carrying the stores can arrive on any core operation.
    await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click())
    await run(() => { app.ui.container.querySelector('.vb-overlay')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })) })
    if (app.core().last().kind === 'frame') await run(() => app.core().reply({ id: app.core().last().id, kind: 'frame', buf: vbf1(), workerMs: 0 }))
    const pointer = app.sent('pointer').at(-1)!
    const memory = Array(512).fill(0); memory[0] = 42
    await run(() => app.core().reply({ id: pointer.id, kind: 'status', status: { state: 'Halted', error: null, instructions: 1, output: [], persist: { tank: 'saved' }, memory } }))
    expect(patch).toBeDefined()
    await run(() => app.core().reply({ kind: 'crashed', why: 'restart' }))
    const restarted = app.workers.at(-1)!
    await run(() => restarted.reply({ kind: 'ready' }))
    const load = restarted.posted.find(m => m.kind === 'load')!
    expect(JSON.parse(String(load.host))).toMatchObject({ persist: { tank: 'saved' }, memory })
  })
  it('resets chip stores, writes and the active surface when switching projects', async () => {
    const app = await booted()
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: 'U.x = 1' } }))
    await wait(200)
    const load = app.sent('load').at(-1)!, memory = Array(512).fill(7)
    await run(() => app.core().reply({ id: load.id, kind: 'status', status: { state: 'Halted', error: null, instructions: 1, output: [], active: 'old_surface',
      persist: { old: 'project' }, memory, writes: [{ ref: 2, lt: 28, slot: -1, value: 1, stored: true }] } }))
    await app.serve()
    await run(() => Array.from(app.ui.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(b => b.textContent === 'Sim')!.click())
    const next = newProject(); next.settings.wipeOnReexport = false; next.pages[0].surface = 'new_surface'
    await run(() => pane.props!.dispatch({ type: 'loadProject', project: next }))
    expect(app.ui.container.querySelector('[aria-label="Sim"] ul')!.textContent).toBe('')
    await run(() => app.ui.container.querySelector<HTMLInputElement>('[aria-label="Play"]')!.click())
    await run(() => { app.ui.container.querySelector('.vb-overlay')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })) })
    const current = app.workers.at(-1)!
    if (current !== app.core()) await run(() => current.reply({ kind: 'ready' }))
    await wait(200)
    const serve = current === app.core() ? app.serve : server(current)
    await serve()
    const fresh = current.posted.filter(m => m.kind === 'load').at(-1)!
    expect(JSON.parse(String(fresh.host))).toMatchObject({ persist: {}, memory: Array(512).fill(0) })
    expect(current.posted.filter(m => m.kind === 'pointer').at(-1)).toMatchObject({ surface: 'new_surface' })
    expect(current.posted.filter(m => m.kind === 'visit')).toHaveLength(current === app.core() ? 1 : 0)
  }, 15_000)
  it('shows empty-export problems and neither loads nor exports unread checked source', async () => {
    const app = await booted()
    app.check().verdict = s => ({ ...checkScene(s), src: null })
    await run(() => pane.props!.dispatch({ type: 'addPage' }))
    await wait(200)
    await app.serve()
    expect(app.sent('load')).toHaveLength(1)
    const download = app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Download the script"]')!
    const copy = app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!
    expect(download.disabled && copy.disabled).toBe(true)
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const create = vi.spyOn(URL, 'createObjectURL')
    await run(() => { download.click(); copy.click() })
    expect(create).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('page p2: checked scene text is unavailable')
  })
  it('reports an unavailable clipboard', async () => {
    const app = await booted()
    await app.checkExport()
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!.click())
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('clipboard is unavailable')
  })
})

describe('App live data (M3)', () => {
  const settle = async (app: Awaited<ReturnType<typeof booted>>) => { for (let k = 0; k < 6; k++) { await wait(50); await app.serve() } }
  const tab = (app: Awaited<ReturnType<typeof booted>>, name: string) => Array.from(app.ui.container.querySelectorAll('[role="tab"]')).find(b => b.textContent === name) as HTMLButtonElement

  it('loads the generated script with its host, then visits the editor\'s page; selecting a page visits it; a scene edit patches with the banner', async () => {
    const app = await booted({ initialScene: 'R w=10 h=10' })
    const load = app.sent('load').at(-1)!
    expect(String(load.lua)).toContain('function tick(dt) VB.tick(dt) end')
    expect(JSON.parse(String(load.host))).toMatchObject({ housing: { ref: 1 }, budgets: { load: 500000, tick: 50000 } })
    const kinds = app.core().kinds()
    expect(kinds.lastIndexOf('visit')).toBeGreaterThan(kinds.lastIndexOf('load'))
    expect(app.sent('visit').at(-1)).toMatchObject({ page: 'p1' })
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('SCENE w=480 h=480\nR x=0 y=0 w=10 h=10\n') }))
    await settle(app)
    await run(() => pane.props!.dispatch({ type: 'addPage' }))   // p2 becomes the editor's page
    await settle(app)
    expect(app.sent('visit').at(-1)).toMatchObject({ page: 'p2' })
    await run(() => pane.props!.dispatch({ type: 'setActivePage', pageId: 'p1' }))
    await settle(app)
    expect(app.sent('visit').at(-1)).toMatchObject({ page: 'p1' })
    expect(app.sent('patch').at(-1)).toMatchObject({ surface: 'main', element: 'scene' })
    expect(String(app.sent('patch').at(-1)!.src)).toMatch(/G v==lt\(ver,\d+\)/)
  }, 15_000)
  it('sends a slider\'s change as a sim message, never a load', async () => {
    const app = await booted()
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { simDevices: [{ id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, values: { Pressure: { kind: 'slider', v: 1, min: 0, max: 9 } } }] } }))
    await settle(app)
    await settle(app)   // the catalogue loads (a simulated device asks for it), which reloads once
    const loads = app.sent('load').length
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { simDevices: [{ id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, values: { Pressure: { kind: 'slider', v: 5, min: 0, max: 9 } } }] } }))
    await settle(app)
    expect(app.sent('load')).toHaveLength(loads)
    expect(JSON.parse(String(app.sent('sim').at(-1)!.json)).values['2']).toBeDefined()
  }, 15_000)
  it('wipes persist on a changed export when the project says so, and keeps it when it does not', async () => {
    const app = await booted()
    // A load answered with the chip's persist (the status carries it when the chip changed it), then an edit that changes the Lua.
    const answered = async (patch: object) => {
      await run(() => pane.props!.dispatch({ type: 'setLogic', patch }))
      await wait(250)   // the load goes out (150 ms debounce) and waits, unanswered
      const l = app.sent('load').at(-1)!
      await run(() => app.core().reply({ id: l.id, kind: 'status', status: { state: 'Running', error: null, instructions: 1, output: [], active: 'main', persist: { k: 'v' } } }))
      await settle(app)
    }
    await answered({ settings: { ...newProject().settings, wipeOnReexport: true }, state: [{ name: 'a', type: 'number', init: 0 }] })
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { state: [{ name: 'b', type: 'number', init: 0 }] } }))
    await settle(app)
    expect(JSON.parse(String(app.sent('load').at(-1)!.host)).persist).toEqual({})
    await answered({ settings: { ...newProject().settings, wipeOnReexport: false }, state: [{ name: 'c', type: 'number', init: 0 }] })
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { state: [{ name: 'd', type: 'number', init: 0 }] } }))
    await settle(app)
    expect(JSON.parse(String(app.sent('load').at(-1)!.host)).persist).toEqual({ k: 'v' })
  }, 15_000)
  it('plays: the canvas follows the active surface and its pointer reaches the core', async () => {
    box460()
    const app = await booted()
    await run(() => (app.ui.container.querySelector('[aria-label="Play"]') as HTMLInputElement).click())
    await app.serve()
    const overlay = app.ui.container.querySelector('.vb-overlay')!
    await run(() => { overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 })) })
    if (!app.sent('pointer').length) await run(() => app.core().reply({ id: app.core().last().id, kind: 'frame', buf: vbf1(), workerMs: 0 }))
    expect(app.sent('pointer').at(-1)).toMatchObject({ type: 'down', surface: 'main', pointer: 1 })
    const p = app.sent('pointer').at(-1)!
    await run(() => app.core().reply({ id: p.id, kind: 'status', status: { state: 'Running', error: null, instructions: 1, output: [], active: 'vb_devices' } }))
    await settle(app)
    expect(app.sent('frame').at(-1)).toMatchObject({ surface: 'vb_devices' })
  })
  it('routes wheel and leave at the last play position, suppresses editing, and visits the editor page when Play ends', async () => {
    box460()
    const app = await booted()
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('SCENE w=480 h=480\nR x=0 y=0 w=20 h=20\n') }))
    await settle(app)
    await run(() => pane.props!.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } }))
    const play = app.ui.container.querySelector<HTMLInputElement>('[aria-label="Play"]')!
    await run(() => play.click())
    expect(app.ui.container.querySelector('.vb-selection, .vb-native, .vb-grid')).toBeNull()
    await run(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })) })
    expect(pane.props!.scene.root).toHaveLength(1)
    await run(() => { app.ui.container.querySelector('.vb-overlay')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 14, clientY: 25, pointerId: 3 })) })
    await app.serve()
    expect(app.sent('pointer').at(-1)).toMatchObject({ x: 14, y: 25, type: 'move', pointer: 3 })
    await run(() => { app.ui.container.querySelector('.vb-preview')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })) })
    await app.serve()
    expect(app.sent('pointer').at(-1)).toMatchObject({ x: 14, y: 25, type: 'wheel', dy: -1 })
    await run(() => { app.ui.container.querySelector('.vb-preview')!.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })) })
    await app.serve()
    expect(app.sent('pointer').at(-1)).toMatchObject({ x: 14, y: 25, type: 'leave' })
    // Let the chip navigate after the last edit-mode visit, as a page action or an unresolved role would.
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: 'U.x = 1' } }))
    await wait(200)
    await app.serve()
    await run(() => { app.ui.container.querySelector('.vb-overlay')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 14, clientY: 25 })) })
    if (app.core().last().kind === 'frame') await run(() => app.core().reply({ id: app.core().last().id, kind: 'frame', buf: vbf1(), workerMs: 0 }))
    const pointer = app.sent('pointer').at(-1)!
    await run(() => app.core().reply({ id: pointer.id, kind: 'status', status: { state: 'Halted', error: null, instructions: 1, output: [], active: 'vb_devices' } }))
    const visits = app.sent('visit').length
    await run(() => play.click())
    await app.serve()
    expect(app.sent('visit')).toHaveLength(visits + 1)
    expect(app.sent('visit').at(-1)).toMatchObject({ page: 'p1' })
  }, 15_000)
  it('keeps named memory from status, maps chip errors, and resets both persist and the writes log through Sim', async () => {
    const app = await booted()
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: 'error("oops")' } }))
    await wait(200)
    const load = app.sent('load').at(-1)!, lua = String(load.lua)
    const line = lua.slice(0, lua.indexOf('error("oops")')).split('\n').length
    const memory = Array(512).fill(0); memory[0] = 'NaN'; memory[1] = 'Infinity'
    await run(() => app.core().reply({ id: load.id, kind: 'status', status: { state: 'Halted', error: `[string "chip"]:${line}: oops`, instructions: 1,
      output: [], persist: { k: 'v' }, memory, writes: [{ ref: 2, lt: 28, slot: -1, value: 1, stored: true }] } }))
    await app.serve()
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('custom code line 1: oops')
    await run(() => tab(app, 'Sim').click())
    expect(app.ui.container.querySelector('.vb-writes')!.textContent).toMatch(/(?:Tank|Device no longer in this project): (?:#28|On)/)
    await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="reset written values"]')!.click())
    await app.serve()
    expect(app.ui.container.querySelector('[aria-label="Sim"] ul')!.textContent).toBe('')
    expect(JSON.parse(String(app.sent('sim').at(-1)!.json))).toEqual({ clearWrites: true })
    await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="wipe persist"]')!.click())
    await run(() => Array.from(app.ui.container.querySelectorAll<HTMLButtonElement>('dialog[open] button')).find(b => b.textContent === 'Wipe persist')!.click())
    await app.serve()
    expect(JSON.parse(String(app.sent('sim').at(-1)!.json))).toEqual({ wipePersist: true })
    await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: '', settings: { ...newProject().settings, wipeOnReexport: false } } }))
    await settle(app)
    const host = JSON.parse(String(app.sent('load').at(-1)!.host))
    expect(host.persist).toEqual({})
    expect(host.memory.slice(0, 2)).toEqual(['NaN', 'Infinity'])
  }, 15_000)
  it('disables export while a check is pending or invalid, and downloads the generated Lua under the project name', async () => {
    const app = await booted({ held: true })
    const download = app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Download the script"]')!
    const copy = app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!
    expect(download.disabled && copy.disabled).toBe(true)
    await run(() => app.check().release())
    expect(download.disabled && copy.disabled).toBe(true)
    await app.checkExport()
    expect(download.disabled || copy.disabled).toBe(false)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let name = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download })
    await run(() => download.click())
    expect(name).toBe(`${newProject().name}.lua`)
    expect(await (create.mock.calls[0][0] as Blob).text()).toContain('-- VectorBuilder export')
    expect(revoke).not.toHaveBeenCalled()
    await wait(999)
    expect(revoke).not.toHaveBeenCalled()
    await wait(1)
    expect(revoke).toHaveBeenCalledWith('blob:export')
    app.check().verdict = () => invalid('bad')
    await run(() => pane.props!.dispatch({ type: 'setScene', pageId: 'p1', scene: scene('R x=1') }))
    expect(download.disabled && copy.disabled).toBe(true)
  })
  it('reports a rejected clipboard write in the status area', async () => {
    const app = await booted()
    await app.checkExport()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('clipboard denied')) } })
    await run(() => app.ui.container.querySelector<HTMLButtonElement>('[aria-label="Copy the script"]')!.click())
    expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('clipboard denied')
  })
  it('visits a newly loaded page selected while its load was queued', async () => {
    const app=await booted(), original=CoreBridge.prototype.load
    vi.spyOn(CoreBridge.prototype,'load').mockImplementation(function(this: CoreBridge,...args) {
      this.pointer('main',1,1,'down')
      return original.apply(this,args)
    })
    await run(()=>pane.props!.dispatch({type:'addPage'}))
    await run(()=>pane.props!.dispatch({type:'setActivePage',pageId:'p1'}))
    await wait(150)
    expect(app.sent('load')).toHaveLength(1)
    await run(()=>pane.props!.dispatch({type:'setActivePage',pageId:'p2'}))
    await app.serve()
    expect(app.sent('visit').at(-1)).toMatchObject({page:'p2'})
  })
  it('waits for the new load before visiting a newly added page', async () => {
    const app = await booted(), visits = app.sent('visit').length
    await run(() => pane.props!.dispatch({ type: 'addPage' }))
    await wait(149)
    await app.serve()
    expect(app.sent('visit')).toHaveLength(visits)
    await wait(1)
    await app.serve()
    expect(app.sent('visit')).toHaveLength(visits + 1)
    expect(app.sent('visit').at(-1)).toMatchObject({ page: 'p2' })
    expect(app.core().kinds().lastIndexOf('visit')).toBeGreaterThan(app.core().kinds().lastIndexOf('load'))
  })
  it('sends no visit before the first load, and none for the page a load just visited', async () => {
    const app = await booted()
    const kinds = app.core().kinds()
    expect(kinds.indexOf('visit')).toBeGreaterThan(kinds.indexOf('load'))
    expect(kinds.filter(k => k === 'visit')).toHaveLength(app.sent('load').length)
  })
  it('exports: Copy puts the generated script on the clipboard', async () => {
    const app = await booted()
    const checked = await app.checkExport()
    const writeText = vi.fn((_text: string) => Promise.resolve())   // typed: tsc refuses mock.calls[0][0] on a no-argument mock (TS2493)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await run(() => (app.ui.container.querySelector('[aria-label="Copy the script"]') as HTMLButtonElement).click())
    expect(String(writeText.mock.calls[0]?.[0])).toContain('-- VectorBuilder export')
    expect(writeText.mock.calls[0]?.[0]).toBe(checked.last().lua)
  })
  it('shows the Data, Logic, Sim and Custom Lua tabs', async () => {
    const app = await booted()
    for (const name of ['Data', 'Logic', 'Sim', 'Lua']) {
      await run(() => tab(app, name).click())
      expect(app.ui.container.querySelector(`[aria-label="${name === 'Lua' ? 'Custom Lua' : name}"]`)).toBeTruthy()
    }
  })
})

const lowsSettle = async (app: Awaited<ReturnType<typeof booted>>) => { await wait(250); await app.serve() }
const lowsTab = (app: Awaited<ReturnType<typeof booted>>, name: string) => Array.from(app.ui.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(b => b.textContent === name)!

it('shares one data-name list between Data and Logic panels', async () => {
  const app = await booted()
  expect(app.ui.container.querySelectorAll('#vb-data-names')).toHaveLength(1)
  await run(() => lowsTab(app, 'Data').click())
  expect(app.ui.container.querySelectorAll('#vb-data-names')).toHaveLength(1)
  await run(() => lowsTab(app, 'Logic').click())
  expect(app.ui.container.querySelectorAll('#vb-data-names')).toHaveLength(1)
})
it('reloads after removing a simulated source, including a slot source', async () => {
  const app = await booted()
  const d = { id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, values: { Pressure: { kind: 'const' as const, v: 1 } }, slots: { '0': { Quantity: { kind: 'const' as const, v: 2 } } } }
  await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { simDevices: [d] } }))
  await lowsSettle(app); await lowsSettle(app)
  const loads = app.sent('load').length
  await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { simDevices: [{ ...d, values: {} }] } }))
  await lowsSettle(app)
  expect(app.sent('load').length).toBe(loads + 1)
  expect(JSON.parse(String(app.sent('load').at(-1)!.host)).devices[0].values).toBeUndefined()
  await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { simDevices: [{ ...d, values: {}, slots: {} }] } }))
  await lowsSettle(app)
  expect(app.sent('load').length).toBe(loads + 2)
  expect(JSON.parse(String(app.sent('load').at(-1)!.host)).devices[0].slotValues).toBeUndefined()
}, 15_000)
it('maps a running error with the loaded Lua while a new scene check is pending', async () => {
  const app = await booted()
  await run(() => pane.props!.dispatch({ type: 'setLogic', patch: { customLua: 'error("old")' } }))
  await wait(200)
  const load = app.sent('load').at(-1)!, lua = String(load.lua)
  const line = lua.slice(0, lua.indexOf('error("old")')).split('\n').length
  app.check().held = true
  await run(() => pane.props!.dispatch({ type: 'editScene', pageId: 'p1', scene: scene('SCENE w=480 h=480\nR w=10 h=10') }))
  await run(() => app.core().reply({ id: load.id, kind: 'status', status: { state: 'Halted', error: '[string "chip"]:' + line + ': old', instructions: 1, output: [] } }))
  expect(app.ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('custom code line 1: old')
})

// The real transfer protocol/JSON boundary, with controllable replies instead of a browser worker.
function transferWorkers(tokens = new Map<string, string>()) {
  const hold: { kind?: Request['kind'] } = {}
  const jobs = new Set<Promise<void>>()
  const requests: { kind: Request['kind']; resolve: (worker: TransferWorker) => void }[] = []
  class TransferWorker extends FakeWorker {
    held = false
    waiting: Request[] = []
    postMessage(message: Parameters<FakeWorker['postMessage']>[0]) {
      super.postMessage(message)
      this.waiting.push(message as Request)
      if (message.kind === hold.kind) this.held = true
      for (const pending of requests.filter(p => p.kind === message.kind)) {
        requests.splice(requests.indexOf(pending), 1); pending.resolve(this)
      }
      queueMicrotask(() => {
        if (!this.held) { const job = this.release(); jobs.add(job); void job.finally(() => jobs.delete(job)) }
      })
    }
    async release() {
      for (const request of this.waiting.splice(0)) {
        const input = request.kind === 'read' && request.format === 'token' && typeof request.text === 'string' && tokens.has(request.text)
          ? { ...request, format: 'json' as const, text: tokens.get(request.text)! }
          : request.kind === 'read' && typeof request.text !== 'string' ? { ...request, text: new Blob([request.text]) } : request
        this.reply(await answer(input))
      }
    }
  }
  const made: TransferWorker[] = []
  return { made, hold, tokens,
    nextRequest: (kind: Request['kind']) => new Promise<TransferWorker>(resolve => requests.push({ kind, resolve })),
    settle: async () => { await Promise.resolve(); while (jobs.size) await Promise.all([...jobs]) },
    make: () => { const worker = new TransferWorker(); made.push(worker); return worker as unknown as Worker } }
}

const projectNamed = (name: string) => {
  const p = newProject(); p.name = name
  p.pages[0].scene = scene(`T text="${name}"`)
  return p
}
const recordOf = (project: Project, revision = 1) => ({ revision, text: projectText(project), updatedAt: '2026-10-12T00:00:00.000Z' })

async function mountStartup({ saved, fragment, corrupt, recovery, corruptRecovery, options = {}, strict = false, fragmentText, fragmentHash, holdRead = false }: {
  saved?: Project; fragment?: Project; corrupt?: unknown; recovery?: Project; corruptRecovery?: unknown
  options?: Parameters<typeof projectDb>[0]; strict?: boolean; fragmentText?: string; fragmentHash?: string; holdRead?: boolean
} = {}) {
  errors()
  vi.mocked(autosave.readAutosave).mockImplementation(realAutosave.readAutosave)
  vi.mocked(autosave.writeAutosave).mockImplementation(realAutosave.writeAutosave)
  const db = projectDb(options); vi.stubGlobal('indexedDB', db.factory)
  if (saved) db.records.set('current', recordOf(saved))
  if (corrupt !== undefined) db.records.set('current', corrupt)
  if (recovery) db.records.set('recovery', recordOf(recovery))
  if (corruptRecovery !== undefined) db.records.set('recovery', corruptRecovery)
  const location = new URL('https://builder.example/edit?keep=1' + (fragmentHash ?? (fragment || fragmentText ? '#p=1.Zg&view=canvas' : '')))
  vi.stubGlobal('location', location)
  const history = { state: { kept: true }, replaceState: vi.fn((_: unknown, _title: string, url: string) => { location.href = new URL(url, location.href).href }) }
  vi.stubGlobal('history', history)
  const transfer = transferWorkers(new Map([['1.Zg', fragmentText ?? (fragment ? projectText(fragment) : '{}')]]))
  if (holdRead) transfer.hold.kind = 'read'
  const workers: FakeWorker[] = [], exports: FakeWorker[] = [], checks = checkWorkers(), context = vi.spyOn(editing, 'makeCtx')
  const app = <App makeTransferWorker={transfer.make} makeWorker={() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }} makeCheckWorker={checks.make}
    makeExportWorker={() => { const w = new FakeWorker(); exports.push(w); return w as unknown as Worker }} />
  let ui = mount(strict ? <StrictMode>{app}</StrictMode> : app)
  const ctx = () => context.mock.results.at(-1)!.value as ReturnType<typeof editing.makeCtx>
  const state = () => ctx().get()
  const recoveryButtons = new Set(['Blank project', 'Continue without autosave', 'Open saved project', 'Open recovery project', 'Reload saved project', 'Retry autosave', 'Save current project instead', 'Download unsaved JSON'])
  const button = (text: string) => Array.from(ui.container.querySelectorAll('button')).find(b => b.textContent === text && (!recoveryButtons.has(text) || b.closest('dialog')?.open))!
  const click = async (text: string) => {
    if (recoveryButtons.has(text) && !button(text)) await run(() => ui.container.querySelector<HTMLButtonElement>('button.vb-save')!.click())
    await run(() => button(text).click())
    if (text === 'Blank project') await run(() => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('dialog[open] button')).find(b => b.textContent === 'Blank project' && b.closest('dialog')?.querySelector('h2')!.textContent === 'Start a blank project?')!.click())
  }
  const act = (action: Action) => run(() => ctx().dispatch(action))
  const stored = (slot: string) => JSON.parse((db.records.get(slot) as autosave.SavedProject).text) as Project
  const ready = async () => {
    await run(() => workers.at(-1)!.reply({ kind: 'ready' }))
    await wait(200)
    const serve = server(workers.at(-1)!); await serve()
    return serve
  }
  await wait(20)
  return { db, transfer, workers, exports, checks, ctx, state, button, click, act, stored, location, history, ready,
    ui: () => ui, status: () => ui.container.querySelector('.vb-status [aria-live]')!.textContent,
    remount: async () => { ui.unmount(); ui = mount(app); await wait(20) } }
}

describe('App startup restore', () => {
  it('uses an ellipsis while saved projects load', async () => {
    const x = await mountStartup({ options: { holdOpen: true } })
    expect(x.ui().container.textContent).toContain('Loading saved project…')
  })
  it('asks to keep the original JSON if the link-open download fails', async () => {
    const x = await mountStartup({ fragment: projectNamed('Linked') })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw Error('download denied') })
    await x.click('Save JSON first')
    expect(x.ui().container.textContent).toContain('JSON download failed: download denied; keep the original JSON file')
  })
  it('reuses the pristine boot worker at startup, preserves readiness and replaces it for later project loads', async () => {
    const options = { holdOpen: true }, x = await mountStartup({ saved: projectNamed('S'), options })
    const boot = x.workers[0]
    await run(() => boot.reply({ kind: 'ready' }))
    options.holdOpen = false
    await run(() => x.db.releaseOpens()); await wait(20)
    expect(x.workers).toHaveLength(1)
    expect(boot.terminated).toBe(false)
    expect(x.ui().container.querySelector('.vb-status .vb-run-line')!.textContent).toMatch(/core ready in/)
    await wait(200); await server(boot)()
    expect(boot.posted.find(m => m.kind === 'load')!.lua).toContain('T text=S')
    await x.act({ type: 'loadProject', project: projectNamed('replacement') })
    expect(x.workers).toHaveLength(2)
    expect(boot.terminated).toBe(true)
  })

  it('startup_reads_before_writes: withholds editing, scene checks and blank preview loads until storage answers', async () => {
    const options = { holdOpen: true }, x = await mountStartup({ saved: projectNamed('S'), options })
    expect(pane.props).toBeNull()
    expect(Array.from(x.ui().container.querySelectorAll<HTMLButtonElement>('header button')).find(b => b.textContent === 'Export')!.disabled).toBe(true)
    await x.act({ type: 'setScene', pageId: 'p1', scene: scene('T text=too_early') })
    await wait(600)
    expect(x.state().project.pages[0].scene.root).not.toContainEqual(expect.objectContaining({ attrs: { text: 'too_early' } }))
    expect(x.ui().container.querySelector('[inert]')).not.toBeNull()
    expect(x.button('Blank project')).toBeUndefined()
    expect(x.button('Continue without autosave')).toBeUndefined()
    expect(x.checks.made.every(w => w.waiting.length === 0)).toBe(true)
    expect(x.workers.flatMap(w => w.posted).filter(m => m.kind === 'load')).toHaveLength(0)
    expect(x.stored('current').name).toBe('S')
    options.holdOpen = false
    await run(() => x.db.releaseOpens())
    await wait(20)
    expect(x.state().project.name).toBe('S')
    expect(x.ui().container.querySelector('[inert]')).toBeNull()
  })
  it('startup_restore_has_empty_history_and_resets_runtime', async () => {
    const p = projectNamed('S'); p.pages[0].surface = 'saved_surface'
    const x = await mountStartup({ saved: p })
    await x.ready()
    expect(x.state().project.name).toBe('S')
    expect(x.state().past).toEqual([])
    expect(x.state().future).toEqual([])
    expect(x.ctx().frame()).toBeNull()
    expect(x.workers.slice(0, -1).every(w => w.terminated)).toBe(true)
    const load = x.workers.at(-1)!.posted.find(m => m.kind === 'load')!
    expect(load.lua).toContain('T text=S')
    expect(JSON.parse(String(load.host))).toMatchObject({ persist: {}, memory: Array(512).fill(0) })
    await x.act({ type: 'undo' })
    expect(x.state().project.name).toBe('S')
  })
  it('initial_notice_survives_second_sanitize', async () => {
    const p = projectNamed('F'); p.pages[0].natives = [{ type: 'unknown', uid: 'x1' }] as never
    const text = JSON.stringify({ ...p, fontsApproved: true })
    const x = await mountStartup({ fragmentText: text })
    expect(x.state().project.name).toBe('F')
    expect(x.status()).toContain('Ignored non-project fields: fontsApproved')
    expect(x.status()).toContain('not loaded')
    expect(x.state().past).toEqual([])
  })
  it('offers saved or Blank explicitly after an invalid fragment without overwriting storage', async () => {
    const x = await mountStartup({ saved: projectNamed('S'), fragmentText: '{}' })
    expect(x.status()).toMatch(/project.*(pages|read|unreadable)/i)
    expect(x.button('Open saved project')).toBeDefined()
    expect(x.button('Blank project')).toBeDefined()
    await wait(600)
    expect(x.stored('current').name).toBe('S')
    await x.click('Open saved project')
    await wait(20)
    expect(x.state().project.name).toBe('S')
    expect(x.state().past).toEqual([])
    expect(x.location.hash).toBe('#view=canvas')
  })
  it('unavailable startup offers Retry and Continue without autosave and ignores late reads', async () => {
    const options = { holdOpen: true }, x = await mountStartup({ saved: projectNamed('S'), options })
    // Storage's watchdog settles; the eventual connection must not install a stale project.
    await wait(5000)
    expect(x.status()).toMatch(/not saved/i)
    expect(x.button('Retry autosave')).toBeDefined()
    await x.click('Continue without autosave')
    expect(x.ui().container.querySelector('[inert]')).toBeNull()
    await x.act({ type: 'setScene', pageId: 'p1', scene: scene('T text=local') })
    options.holdOpen = false
    await run(() => x.db.releaseOpens())
    await wait(600)
    expect(x.state().project.pages[0].scene.root[0].attrs.text).toBe('local')
    expect(x.stored('current').name).toBe('S')
  })
  it('strict_mode_and_unmount dispose each startup transport and ignore departed replies', async () => {
    const x = await mountStartup({ fragment: projectNamed('F'), strict: true })
    expect(x.state().project.name).toBe('F')
    expect(x.transfer.made.length).toBeGreaterThan(1)
    expect(x.transfer.made.slice(0, -1).every(w => w.terminated)).toBe(true)
    x.ui().unmount()
    expect(x.transfer.made.every(w => w.terminated)).toBe(true)
    expect(x.workers.every(w => w.terminated)).toBe(true)
    await wait(600)
    expect(x.db.records.size).toBe(0)
  })
})

describe('App autosave sequencing', () => {
  it('fragment_recovery_survives_two_edits and fragment_consumed_after_commit_reload_uses_edits', async () => {
    const x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F') })
    await wait(520)
    expect(x.stored('current').name).toBe('F')
    expect(x.stored('recovery').name).toBe('S')
    for (const name of ['F1', 'F2']) {
      await x.act({ type: 'renamePage', pageId: 'p1', name })
      await wait(520)
    }
    expect(x.stored('current').pages[0].name).toBe('F2')
    expect(x.stored('recovery').name).toBe('S')
    expect(x.location.href).toBe('https://builder.example/edit?keep=1#view=canvas')
    expect(x.history.state).toEqual({ kept: true })
    await x.remount()
    expect(x.state().project.pages[0].name).toBe('F2')
    expect(x.state().past).toEqual([])
  })
  it('waits for durable commit and latest edits before consuming the same fragment', async () => {
    const options = { holdCommit: false }, x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F'), options })
    options.holdCommit = true
    await wait(520)
    expect(x.stored('current').name).toBe('S')
    expect(x.location.hash).toContain('p=1.Zg')
    expect(x.status()).not.toBe('Saved')
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'F2' })
    await wait(520)
    await run(() => x.db.releaseCommits())
    await wait(20)
    expect(x.location.hash).toContain('p=1.Zg')
    await run(() => x.db.releaseCommits())
    await wait(20)
    expect(x.stored('current').pages[0].name).toBe('F2')
    expect(x.stored('recovery').name).toBe('S')
    expect(x.location.hash).toBe('#view=canvas')
    expect(x.status()).toContain('Saved')
  })
  it.each(['abort', 'conflict'] as const)('failed_commit_retains_fragment: %s pauses saving and leaves JSON rescue', async failure => {
    const options = { abort: false }, x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F'), options })
    if (failure === 'abort') options.abort = true
    else x.db.records.set('current', recordOf(projectNamed('other tab'), 2))
    await wait(520)
    expect(x.location.hash).toContain('p=1.Zg')
    expect(x.status()).toMatch(/not saved.*(paused|conflict|abort)/i)
    expect(x.status()).toMatch(/reload.*link/i)
    expect(x.button('Download unsaved JSON')).toBeDefined()
    const writes = vi.mocked(autosave.writeAutosave).mock.calls.length
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'F2' })
    await wait(520)
    expect(vi.mocked(autosave.writeAutosave).mock.calls).toHaveLength(writes)
  })
  it.each(['', '.', '?', '!'])('separates an aborted-save reason ending in %j from the autosave guidance', async ending => {
    const options: { putError?: DOMException } = {}, x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F'), options })
    options.putError = new DOMException('The transaction was aborted' + ending, 'AbortError')
    await wait(520)
    expect(x.status()).toBe('Not saved: AbortError: The transaction was aborted' + (ending || '.')
      + ' Autosave paused; download project JSON to keep your edits. Reload will retry the project link.')
    expect(x.location.hash).toContain('p=1.Zg')
    expect(x.button('Download unsaved JSON')).toBeDefined()
  })
  it('replacement_rotation_latch_survives_coalescing and a superseding replacement has its own latch', async () => {
    const options = { holdCommit: false }, x = await mountStartup({ saved: projectNamed('S'), options })
    const context = x.ctx()
    await x.act({ type: 'loadProject', project: projectNamed('A') })
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'A1' })
    await wait(520)
    expect(x.stored('recovery').name).toBe('S')
    options.holdCommit = true
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'A2' })
    await wait(520)
    await x.act({ type: 'loadProject', project: projectNamed('B') })
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'B1' })
    await wait(520)
    await run(() => x.db.releaseCommits())
    await wait(20)
    await run(() => x.db.releaseCommits())
    await wait(20)
    expect(x.stored('current').name).toBe('B')
    expect(x.stored('current').pages[0].name).toBe('B1')
    expect(x.stored('recovery').name).toBe('A')
    expect(x.stored('recovery').pages[0].name).toBe('A2')
    expect(x.ctx()).toBe(context)
    expect(x.state().past.length).toBeGreaterThan(0)
    await x.act({ type: 'undo' }); await x.act({ type: 'undo' })
    expect(x.state().project.name).toBe('A')
  })
  it('ordinary_undo_redo_keeps_recovery and selection/frame renders never save', async () => {
    const x = await mountStartup({ saved: projectNamed('S'), recovery: projectNamed('R') })
    await wait(520)
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
    await x.act({ type: 'select', selection: { pageId: 'p1', path: [0] } })
    await wait(520)
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'edited' }); await wait(520)
    await x.act({ type: 'undo' }); await wait(520)
    await x.act({ type: 'redo' }); await wait(520)
    expect(x.stored('current').pages[0].name).toBe('edited')
    expect(x.stored('recovery').name).toBe('R')
    expect(vi.mocked(autosave.writeAutosave).mock.calls.every(c => c[3] === false)).toBe(true)
  })
  it('corrupt_current_never_overwritten: explicit recovery is paused until Retry reads a valid current', async () => {
    const corrupt = { revision: 0, text: 'broken', updatedAt: 'now' }
    const x = await mountStartup({ corrupt, recovery: projectNamed('R') })
    expect(x.status()).toContain('Corrupt current')
    await x.click('Open recovery project'); await wait(20)
    expect(x.state().project.name).toBe('R')
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'rescue' }); await wait(520)
    expect(x.db.records.get('current')).toEqual(corrupt)
    expect(x.button('Download unsaved JSON')).toBeDefined()
    x.db.records.set('current', recordOf(projectNamed('valid disk'), 4))
    await x.click('Retry autosave'); await wait(20)
    expect(x.status()).toContain('Retry found saved project')
    await x.click('Save current project instead'); await wait(540)
    expect(x.stored('current').name).toBe('R')
    expect(x.stored('current').pages[0].name).toBe('rescue')
    expect(x.stored('recovery').name).toBe('valid disk')
  })
  it('stale_tab_pauses without a stolen-revision retry and explicit Reload saved project resets the chip', async () => {
    const x = await mountStartup({ saved: projectNamed('S'), recovery: projectNamed('R') })
    await x.ready()
    x.db.records.set('current', recordOf(projectNamed('other tab'), 2))
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'local' }); await wait(520)
    expect(x.status()).toMatch(/conflict/i)
    expect(x.button('Reload saved project')).toBeDefined()
    expect(x.button('Open saved project')).toBeUndefined()
    expect(x.button('Retry autosave')).toBeUndefined()
    const writes = vi.mocked(autosave.writeAutosave).mock.calls.length
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'more local' }); await wait(520)
    expect(vi.mocked(autosave.writeAutosave).mock.calls).toHaveLength(writes)
    const old = x.workers.at(-1)!
    await x.click('Reload saved project'); await wait(20)
    expect(x.state().project.name).toBe('other tab')
    expect(old.terminated).toBe(true)
    await wait(520)
    expect(x.stored('recovery').name).toBe('R')
  })
  it('save_committed_snapshots_only: transient drags and cancel do not save; commit does', async () => {
    const x = await mountStartup({ saved: projectNamed('S') })
    await x.act({ type: 'editScene', pageId: 'p1', scene: scene('T text=drag'), transient: true }); await wait(520)
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
    await x.act({ type: 'cancelDrag' }); await wait(520)
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
    await x.act({ type: 'editScene', pageId: 'p1', scene: scene('T text=committed'), transient: true })
    await x.act({ type: 'commitDrag' }); await wait(520)
    expect(x.stored('current').pages[0].scene.root[0].attrs.text).toBe('committed')
  })
  it('slow_A_B_ends_at_B: superseded serialization is discarded before a write', async () => {
    const x = await mountStartup({ saved: projectNamed('S') })
    const worker = x.transfer.made.at(-1)!
    worker.held = true
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'A' }); await wait(520)
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'B' }); await wait(520)
    worker.held = false
    await run(async () => { await worker.release() }); await wait(20)
    expect(x.stored('current').pages[0].name).toBe('B')
    expect(vi.mocked(autosave.writeAutosave).mock.calls).toHaveLength(1)
    expect(JSON.parse(vi.mocked(autosave.writeAutosave).mock.calls[0][0]).pages[0].name).toBe('B')
  })
  it('debounces for 500 ms and pagehide flushes best effort without promising a commit', async () => {
    const options = { holdCommit: false }, x = await mountStartup({ saved: projectNamed('S'), options })
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'quiet' }); await wait(499)
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
    options.holdCommit = true
    await run(() => { window.dispatchEvent(new Event('pagehide')) }); await wait(10)
    expect(autosave.writeAutosave).toHaveBeenCalledTimes(1)
    expect(x.stored('current').pages[0].name).toBe('Main')
    expect(x.status()).not.toContain('Saved')
    await run(() => x.db.releaseCommits()); await wait(10)
    expect(x.stored('current').pages[0].name).toBe('quiet')
  })
  it('later fragment replacements are undoable and a different token is not consumed by an older commit', async () => {
    const options = { holdCommit: false }, x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F'), options })
    options.holdCommit = true
    await wait(520)
    x.location.hash = '#p=1.Qg&view=next'
    await run(() => x.db.releaseCommits()); await wait(20)
    expect(x.location.hash).toBe('#p=1.Qg&view=next')
    options.holdCommit = false
    x.location.hash = '#p=1.Zg&view=next'
    await run(() => { window.dispatchEvent(new Event('hashchange')) }); await wait(20)
    await wait(520)
    expect(x.location.hash).toBe('#view=next')
    expect(x.state().past.length).toBeGreaterThan(0)
    await x.act({ type: 'undo' })
    expect(x.state().project.name).toBe('F')
  })
  it('JSON rescue works for broken Lua while autosave is paused', async () => {
    const options = { abort: false }, x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F'), options })
    options.abort = true
    await x.act({ type: 'setLogic', patch: { customLua: 'function broken(' } }); await wait(520)
    let downloaded!: Blob
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloaded = blob as Blob; return 'blob:rescue' })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await x.click('Download unsaved JSON')
    expect(JSON.parse(await downloaded.text()).customLua).toBe('function broken(')
    expect(x.location.hash).toContain('p=1.Zg')
  })
})

describe('App autosave retry boundaries', () => {
  it('sanitizes the unsaved rescue filename and revokes its URL after the download delay', async () => {
    const x = await mountStartup({ fragment: projectNamed('../unsafe:CON'), options: { openError: new DOMException('Denied', 'SecurityError') } })
    await x.click('Continue without autosave')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rescue')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let filename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { filename = this.download })
    await x.click('Download unsaved JSON')
    expect(filename).toBe('.._unsafe_CON.json')
    await wait(999); expect(revoke).not.toHaveBeenCalled()
    await wait(1); expect(revoke).toHaveBeenCalledWith('blob:rescue')
  })
  it('revokes the rescue URL on unmount even if the anchor click fails', async () => {
    const x = await mountStartup({ options: { openError: new DOMException('Denied', 'SecurityError') } })
    await x.click('Continue without autosave')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rescue')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw Error('Download refused') })
    await x.click('Download unsaved JSON')
    expect(x.status()).toContain('Download refused')
    x.ui().unmount()
    expect(revoke).toHaveBeenCalledWith('blob:rescue')
    await wait(1000); expect(revoke).toHaveBeenCalledTimes(1)
  })
  it('gives all three JSON download controls distinct accurate accessible names', async () => {
    const x = await mountStartup({ options: { openError: new DOMException('Denied', 'SecurityError') } })
    await x.click('Continue without autosave')
    const names = Array.from(x.ui().container.querySelectorAll('button')).map(b => b.getAttribute('aria-label') ?? b.textContent).filter(n => /^(?:Save|Download).*JSON/.test(n ?? ''))
    expect(names.sort()).toEqual(['Save project JSON', 'Download JSON fallback', 'Download unsaved project JSON', 'Save JSON first'].sort())
  })

  it('retains a continued fragment generation and FONT declarations until storage retry commits its latest edits', async () => {
    const p = projectNamed('F'); p.pages[0].scene.defs = [{ op: 'FONT', attrs: { src: 'https://fonts.gstatic.com/exact.ttf' } }]
    const options = { openError: new DOMException('Denied', 'SecurityError') as DOMException | undefined }
    const x = await mountStartup({ saved: projectNamed('S'), fragment: p, options })
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No font consent') }))
    await x.click('Continue without autosave')
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'F2' }); await wait(520)
    expect(x.location.hash).toContain('p=1.Zg')
    expect(x.stored('current').name).toBe('S')
    options.openError = undefined
    await x.click('Retry autosave'); await wait(20)
    expect(x.status()).toContain('Retry found saved project')
    await x.click('Save current project instead'); await wait(540)
    expect(x.stored('current').pages[0].name).toBe('F2')
    expect(x.stored('current').pages[0].scene.defs).toEqual(p.pages[0].scene.defs)
    expect(x.stored('recovery').name).toBe('S')
    expect(x.location.hash).toBe('#view=canvas')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not resume writes when an explicit Reload saved project fails JSON validation', async () => {
    const x = await mountStartup({ saved: projectNamed('S') })
    x.db.records.set('current', { revision: 2, text: '{', updatedAt: 'now' })
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'local' }); await wait(520)
    expect(x.status()).toMatch(/conflict/i)
    await x.click('Reload saved project'); await wait(20)
    const calls = vi.mocked(autosave.writeAutosave).mock.calls.length
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'keep local' }); await wait(520)
    expect(vi.mocked(autosave.writeAutosave).mock.calls).toHaveLength(calls)
    expect(x.db.records.get('current')).toEqual({ revision: 2, text: '{', updatedAt: 'now' })
    expect(x.state().project.pages[0].name).toBe('keep local')
  })
  it('retains a corrupt saved JSON record when opening recovery until explicit storage retry', async () => {
    const x = await mountStartup({ corrupt: { revision: 1, text: '{', updatedAt: 'now' }, recovery: projectNamed('R') })
    await x.click('Open recovery project'); await wait(540)
    expect(x.state().project.name).toBe('R')
    expect(x.db.records.get('current')).toEqual({ revision: 1, text: '{', updatedAt: 'now' })
    expect(x.button('Download unsaved JSON')).toBeDefined()
  })
})

describe('App replacement lifecycle', () => {
  it('retains FONT definitions and cached faces while cancelling a metadata reply from the departed project', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No consent') }))
    vi.stubGlobal('FontFace', class { loaded = Promise.resolve(this); load() { return Promise.resolve(this) } })
    const own = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete() {} } })
    const { importFont } = await import('./editor/fonts')
    try {
      await run(async () => { await importFont('Cached for replacement', new ArrayBuffer(8), false) })
      const p = projectNamed('S'); p.pages[0].scene.defs = [{ op: 'FONT', attrs: { src: 'https://fonts.gstatic.com/old.ttf' } }]
      const x = await mountStartup({ saved: p })
      await x.ready()
      let finish!: (value: { status: 'failed'; cause: string }) => void, signal: AbortSignal | undefined
      setFontMetadataReader((_data, s) => { signal = s; return new Promise(resolve => { finish = resolve }) })
      const input = x.ui().container.querySelector<HTMLInputElement>('[aria-label="Font file"]')!
      const file = { name: 'Stale suggestion.ttf', arrayBuffer: async () => new ArrayBuffer(8) }
      await run(() => {
        Object.defineProperty(input, 'files', { configurable: true, value: [file] })
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
      expect(finish).toBeDefined()
      const next = projectNamed('next'); next.pages[0].scene.defs = [{ op: 'font', attrs: { SRC: 'https://fonts.gstatic.com/new.ttf' } }]
      const departed = x.workers.at(-1)!
      await x.act({ type: 'loadProject', project: next })
      expect(signal?.aborted).toBe(true)
      expect(departed.terminated).toBe(true)
      await x.ready()
      const workers = x.workers.length
      await run(() => { finish({ status: 'failed', cause: 'late metadata' }) }); await wait(20)
      expect(x.ui().container.querySelector<HTMLInputElement>('.vb-fonts > label input')!.value).toBe('')
      expect(x.status()).not.toContain('late metadata')
      expect(x.workers).toHaveLength(workers)
      expect(x.state().project.pages[0].scene.defs).toEqual(next.pages[0].scene.defs)
      expect(isKnownFont('Cached for replacement')).toBe(true)
      expect(fetch).not.toHaveBeenCalled()
      await x.act({ type: 'undo' })
      expect(x.state().project.pages[0].scene.defs).toEqual(p.pages[0].scene.defs)
    } finally {
      if (own) Object.defineProperty(document, 'fonts', own)
      else delete (document as { fonts?: unknown }).fonts
    }
  })
  it('ignores held serialization and removes pagehide/hash listeners after unmount', async () => {
    const x = await mountStartup({ saved: projectNamed('S') })
    const worker = x.transfer.made.at(-1)!
    worker.held = true
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'departed' }); await wait(520)
    x.ui().unmount()
    expect(worker.terminated).toBe(true)
    await run(async () => { await worker.release(); window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('hashchange')) })
    await wait(600)
    expect(x.stored('current').name).toBe('S')
    expect(x.stored('current').pages[0].name).toBe('Main')
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
  })
})

describe('App autosave undo races', () => {
  it('clears a pending-save notice when undo returns to the already saved identity before serialization', async () => {
    const x = await mountStartup({ saved: projectNamed('S') })
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'A' })
    expect(x.status()).toMatch(/not saved/i)
    await x.act({ type: 'undo' }); await wait(520)
    expect(x.status()).not.toMatch(/not saved/i)
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
    expect(x.stored('current').pages[0].name).toBe('Main')
  })
  it('queues an undo back to S even while an issued A write still considers S saved', async () => {
    const options = { holdCommit: false }, x = await mountStartup({ saved: projectNamed('S'), options })
    options.holdCommit = true
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'A' }); await wait(520)
    await x.act({ type: 'undo' }); await wait(520)
    await run(() => x.db.releaseCommits()); await wait(20)
    await run(() => x.db.releaseCommits()); await wait(20)
    expect(x.stored('current').pages[0].name).toBe('Main')
    expect(x.state().project.pages[0].name).toBe('Main')
    expect(x.db.records.get('recovery')).toBeUndefined()
    expect(autosave.writeAutosave).toHaveBeenCalledTimes(2)
  })
})

it.each(['replace', 'reload'] as const)('asks before replacing a saved project discovered on retry: %s', async choice => {
  const options = { openError: new DOMException('Denied', 'SecurityError') as DOMException | undefined }
  const x = await mountStartup({ saved: projectNamed('S'), recovery: projectNamed('R'), options })
  await x.click('Continue without autosave')
  await x.act({ type: 'renamePage', pageId: 'p1', name: 'local Blank' })
  options.openError = undefined
  const discovered = x.transfer.nextRequest('read')
  await x.click('Retry autosave'); await wait(20); await run(async () => { await discovered; await x.transfer.settle() })
  expect(x.status()).toContain('Retry found saved project "S"')
  expect(x.status()).toContain('replace the recovery project')
  expect(x.stored('current').name).toBe('S')
  expect(x.stored('recovery').name).toBe('R')
  expect(autosave.writeAutosave).not.toHaveBeenCalled()
  if (choice === 'reload') {
    const reloaded = x.transfer.nextRequest('read')
    await x.click('Reload saved project'); await wait(20); await run(async () => { await reloaded; await x.transfer.settle() })
    expect(x.state().project.name).toBe('S')
    expect(x.stored('recovery').name).toBe('R')
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
  } else {
    const write = new Promise<void>(resolve => vi.mocked(autosave.writeAutosave).mockImplementationOnce(async (...args) => {
      const result = await realAutosave.writeAutosave(...args); resolve(); return result
    }))
    const confirmed = x.transfer.nextRequest('read')
    await x.click('Save current project instead'); await wait(20); await run(async () => { await confirmed; await x.transfer.settle() })
    await run(async () => { window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(20); await write })
    expect(x.stored('current').pages[0].name).toBe('local Blank')
    expect(x.stored('recovery').name).toBe('S')
  }
})

it('keeps an invalid fragment an explicit saved or Blank choice even when storage is unavailable', async () => {
  const x = await mountStartup({ fragmentText: '{}', options: { openError: new DOMException('Denied', 'SecurityError') } })
  expect(x.status()).toMatch(/project/i)
  expect(x.button('Blank project')).toBeDefined()
  expect(x.button('Continue without autosave')).toBeUndefined()
  await x.click('Blank project')
  expect(x.location.hash).toBe('#view=canvas')
  expect(x.ui().container.querySelector('[inert]')).toBeNull()
  expect(x.button('Download unsaved JSON')).toBeDefined()
})


describe('App wave review boundaries', () => {
  it('restores valid current with a corrupt recovery notice without writing either slot', async () => {
    const x = await mountStartup({ saved: projectNamed('S'), corruptRecovery: null })
    expect(x.state().project.name).toBe('S')
    expect(x.state().past).toEqual([])
    expect(x.status()).toMatch(/corrupt recovery/i)
    expect(x.ui().container.querySelector('[inert]')).toBeNull()
    await wait(540)
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
    expect(x.db.records.get('recovery')).toBeNull()
  })
  it('acknowledges an exact sent-text conflict as saved without consuming recovery again', async () => {
    const x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F') })
    vi.mocked(autosave.writeAutosave).mockImplementationOnce(async (...args) => {
      const result = await realAutosave.writeAutosave(...args)
      if (result.kind !== 'saved') throw Error('Expected committed write')
      return { kind: 'conflict', record: result.record }
    })
    await wait(540)
    expect(x.status()).toContain('Saved')
    expect(x.status()).not.toMatch(/paused/i)
    expect(x.location.hash).toBe('#view=canvas')
    expect(x.stored('recovery').name).toBe('S')
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'F2' }); await wait(540)
    expect(x.stored('current').pages[0].name).toBe('F2')
    expect(x.stored('recovery').name).toBe('S')
  })
  it.each([false, true])('reconciles its own lost commit acknowledgement on Retry with later edits=%s', async later => {
    const x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F') })
    vi.mocked(autosave.writeAutosave).mockImplementationOnce(async (...args) => {
      await realAutosave.writeAutosave(...args)
      return { kind: 'unavailable', reason: 'Commit acknowledgement timed out' }
    })
    await wait(540)
    expect(x.status()).toMatch(/paused/i)
    expect(x.location.hash).toContain('p=1.Zg')
    if (later) await x.act({ type: 'renamePage', pageId: 'p1', name: 'F2' })
    await x.click('Retry autosave'); await wait(540)
    expect(x.status()).not.toMatch(/paused|conflict/i)
    expect(x.location.hash).toBe('#view=canvas')
    expect(x.stored('current').pages[0].name).toBe(later ? 'F2' : 'Main')
    expect(x.stored('recovery').name).toBe('S')
    expect(autosave.writeAutosave).toHaveBeenCalledTimes(later ? 2 : 1)
  })
  it('pauses queued autosave after a slow fragment transfer and explicitly retries on a fresh worker', async () => {
    const x = await mountStartup({ saved: projectNamed('S') })
    const worker = x.transfer.made.at(-1)!
    worker.held = true
    x.location.hash = '#p=1.Zg&view=canvas'
    await run(() => { window.dispatchEvent(new Event('hashchange')) })
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'local' }); await wait(540)
    expect(worker.waiting).toHaveLength(1)
    await wait(10_000)
    expect(worker.terminated).toBe(true)
    expect(x.status()).toMatch(/paused/i)
    expect(x.button('Download unsaved JSON')).toBeDefined()
    expect(autosave.writeAutosave).not.toHaveBeenCalled()
    expect(x.stored('current').pages[0].name).toBe('Main')
    await x.click('Retry autosave'); await wait(540)
    expect(x.transfer.made.length).toBeGreaterThan(1)
    expect(x.stored('current').pages[0].name).toBe('local')
    expect(x.location.hash).toContain('p=1.Zg')
    expect(x.status()).toMatch(/reload will retry the project link/i)
  })
})


describe('App R13 fragment quarantine', () => {
  it('StrictMode retains a content rejection reason after quarantining the URL', async () => {
    const x = await mountStartup({ saved: projectNamed('S'), fragmentHash: '#p=2.YWJj&view=canvas', strict: true })
    expect(x.location.hash).toBe('#view=canvas')
    expect(x.status()).toContain('Unsupported project codec')
    expect(x.button('Open saved project')).toBeDefined()
    expect(x.status()).not.toMatch(/reload will retry/i)
  })
  it.each(['startup', 'hashchange'] as const)('removes p during a held %s read, restores success and consumes only after commit', async path => {
    const options = { holdCommit: false }
    const x = await mountStartup({ saved: projectNamed('S'), fragment: path === 'startup' ? projectNamed('F') : undefined, holdRead: path === 'startup', options })
    if (path === 'hashchange') {
      x.transfer.tokens.set('1.Zg', projectText(projectNamed('F')))
      x.transfer.hold.kind = 'read'; x.location.hash = '#p=1.Zg&view=canvas'
      await run(() => { window.dispatchEvent(new Event('hashchange')) })
    }
    expect(x.location.href).toBe('https://builder.example/edit?keep=1#view=canvas')
    expect(x.history.state).toEqual({ kept: true })
    options.holdCommit = true
    x.transfer.hold.kind = undefined
    await run(async () => { for (const w of x.transfer.made) { w.held = false; await w.release() } }); await run(() => x.transfer.settle())
    expect(x.location.hash).toContain('p=1.Zg')
    await wait(520)
    expect(x.location.hash).toContain('p=1.Zg')
    await run(() => x.db.releaseCommits()); await wait(10)
    expect(x.location.hash).toBe('#view=canvas')
  })
  it('remounting a quarantined startup read restores autosave without decoding the fragment again', async () => {
    const x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F'), holdRead: true })
    x.transfer.hold.kind = undefined
    await x.remount()
    expect(x.state().project.name).toBe('S')
    expect(x.transfer.made.flatMap(w => w.posted).filter(r => r.kind === 'read' && r.format === 'token')).toHaveLength(1)
  })
  it.each([['future codec', '#p=2.YWJj&view=canvas'], ['length', '#p=' + '1.' + 'a'.repeat(7996) + '&view=canvas'], ['gzip', '#p=1.YWJj&view=canvas']])('content rejection %s stays removed with saved/recovery/Blank choices and no reload promise', async (_reason, fragmentHash) => {
    const x = await mountStartup({ saved: projectNamed('S'), recovery: projectNamed('R'), fragmentHash })
    await run(() => x.transfer.settle()); await wait(10)
    expect(x.location.hash).toBe('#view=canvas')
    expect(x.status()).not.toMatch(/reload will retry/i)
    expect(x.button('Open saved project')).toBeDefined()
    expect(x.button('Open recovery project')).toBeDefined()
    expect(x.button('Blank project')).toBeDefined()
  })
  it('unreadable JSON and project shape stay removed on startup', async () => {
    for (const fragmentText of ['{', '{}']) {
      const x = await mountStartup({ saved: projectNamed('S'), fragmentText })
      expect(x.location.hash).toBe('#view=canvas')
      expect(x.status()).not.toMatch(/reload will retry/i)
      x.ui().unmount()
    }
  })
  it.each(['startup', 'hashchange'] as const)('a transient timeout or worker crash restores the in-memory %s token', async path => {
    for (const failure of ['timeout', 'crash']) {
      const x = await mountStartup({ saved: projectNamed('S'), fragment: path === 'startup' ? projectNamed('F') : undefined, holdRead: path === 'startup' })
      if (path === 'hashchange') {
        x.transfer.hold.kind = 'read'; x.location.hash = '#p=1.Zg&view=canvas'
        await run(() => { window.dispatchEvent(new Event('hashchange')) })
      }
      expect(x.location.hash).toBe('#view=canvas')
      if (failure === 'timeout') await wait(10_000)
      else await run(() => x.transfer.made.find(w => w.held)!.onerror!({ message: 'crashed', preventDefault() {} } as ErrorEvent))
      await wait(10)
      expect(x.location.hash).toContain('p=1.Zg')
      expect(x.status()).toMatch(/reload will retry the project link/i)
      if (path === 'hashchange') {
        expect(x.status()).not.toMatch(/autosave paused/i)
        x.transfer.hold.kind = undefined
        await x.act({ type: 'renamePage', pageId: 'p1', name: 'after failure' }); await wait(520)
        expect(x.stored('current').pages[0].name).toBe('after failure')
      }
      x.ui().unmount()
    }
  })
  it.each(['success', 'timeout'])('does not overwrite a newer p when an older read ends with %s', async outcome => {
    const x = await mountStartup({ saved: projectNamed('S'), fragment: projectNamed('F'), holdRead: true })
    expect(x.location.hash).toBe('#view=canvas')
    x.location.hash = '#p=1.Qg&view=next'
    if (outcome === 'timeout') await wait(10_000)
    else await run(async () => { for (const w of x.transfer.made) { w.held = false; await w.release() } })
    await wait(20)
    expect(x.location.hash).toBe('#p=1.Qg&view=next')
  })
})

describe('App fragment errors during editing', () => {
  it.each(['#p=invalid!', '#p=1.YWJj', '#p=2.YWJj'])('bad link %s leaves the project, undo and autosave running', async hash => {
    const x = await mountStartup({ saved: projectNamed('saved') })
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'before link' })
    const before = x.state()
    x.location.hash = hash
    await run(() => { window.dispatchEvent(new Event('hashchange')) })
    await run(() => x.transfer.settle())
    expect(x.state()).toBe(before)
    expect(x.status()).toMatch(/project.*(token|decoded|codec)/i)
    expect(x.status()).not.toMatch(/autosave paused/i)
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'after link' })
    await wait(520)
    expect(x.stored('current').pages[0].name).toBe('after link')
    expect(x.state().past).toHaveLength(before.past.length + 1)
    expect(x.location.hash).toBe('')
  })
  it.each(['retry', 'stored'] as const)('ordinary navigation does not cancel an in-flight %s operation', async operation => {
    const options = { abort: false }, x = await mountStartup({ saved: projectNamed('saved'), recovery: projectNamed('recovery'), options })
    options.abort = true
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'local' }); await wait(520)
    expect(x.status()).toMatch(/autosave paused/i)
    options.abort = false
    x.transfer.hold.kind = 'read'
    const requested = x.transfer.nextRequest('read')
    await x.click(operation === 'retry' ? 'Retry autosave' : 'Reload saved project')
    await wait(10)
    const worker = await requested
    x.location.hash = '#view=layers'
    await run(() => { window.dispatchEvent(new Event('hashchange')) })
    worker.held = false
    await run(() => worker.release()); await run(() => x.transfer.settle())
    if (operation === 'stored') expect(x.state().project.pages[0].name).toBe('Main')
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'after navigation' }); await wait(520)
    expect(x.stored('current').pages[0].name).toBe('after navigation')
    expect(x.status()).not.toMatch(/autosave paused/i)
  })
})

it('autosave commits while export preparation is held, then export checks the same committed project', async () => {
  vi.mocked(ProjectTransfer.prototype.compress).mockRestore()
  await loadCatalog()
  errors()
  const NativeCompression = CompressionStream
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  vi.stubGlobal('CompressionStream', class {
    writable: WritableStream; readable: ReadableStream
    constructor(format: CompressionFormat) {
      const stream = new NativeCompression(format)
      this.writable = stream.writable
      this.readable = stream.readable.pipeThrough(new TransformStream({ async transform(chunk, controller) { await gate; controller.enqueue(chunk) } }))
    }
  })
  const transfer = transferWorkers(), checks = checkWorkers(), context = vi.spyOn(editing, 'makeCtx')
  vi.mocked(autosave.readAutosave).mockResolvedValue({ kind: 'ready', current: recordOf(projectNamed('S')), recovery: null })
  let commit!: () => void, written!: autosave.SavedProject
  let writing!: (record: autosave.SavedProject) => void
  const writeStarted = new Promise<autosave.SavedProject>(resolve => { writing = resolve })
  vi.mocked(autosave.writeAutosave).mockImplementation((text, revision, updatedAt) => new Promise(resolve => {
    const record = { text, revision: revision + 1, updatedAt }
    commit = () => { written = record; resolve({ kind: 'saved', record }) }
    writing(record)
  }))
  const exports: FakeWorker[] = []
  let created!: (worker: FakeWorker) => void
  const exportCreated = new Promise<FakeWorker>(resolve => { created = resolve })
  const initialShare = transfer.nextRequest('compress')
  const ui = mount(<App makeTransferWorker={transfer.make} makeCheckWorker={checks.make} makeWorker={() => new FakeWorker() as unknown as Worker}
    makeExportWorker={() => { const worker = new FakeWorker(); exports.push(worker); created(worker); return worker as unknown as Worker }} />)
  try {
    await run(() => transfer.settle())
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Prepare project link"]')!.click())
    await initialShare
    const ctx = context.mock.results.at(-1)!.value as ReturnType<typeof editing.makeCtx>
    transfer.hold.kind = 'compress'
    const pendingCompression = transfer.nextRequest('compress')
    await run(() => ctx.dispatch({ type: 'renamePage', pageId: 'p1', name: 'local' }))
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Check export"]')!.click())
    let snapshot!: autosave.SavedProject
    await run(async () => { window.dispatchEvent(new Event('pagehide')); snapshot = await writeStarted })
    expect(JSON.parse(snapshot.text).pages[0].name).toBe('local')
    expect(written).toBeUndefined()
    expect(ui.container.querySelector('.vb-status [aria-live]')!.textContent).not.toContain('Saved')
    await run(() => commit())
    expect(written).toBe(snapshot)
    expect(exports).toHaveLength(0)
    expect(ui.container.querySelector('.vb-status [aria-live]')!.textContent).toContain('Saved')
    // Gzip completion is an I/O event; advancing fake timers cannot flush it.
    let held!: Awaited<typeof pendingCompression>
    await run(async () => { resume(); held = await pendingCompression })
    expect(held).not.toBe(transfer.made[0])
    expect(held.waiting).toHaveLength(1)
    held.held = false; transfer.hold.kind = undefined
    let worker!: FakeWorker
    await run(async () => { await held.release(); worker = await exportCreated; await transfer.settle() })
    await run(() => worker.reply({ kind: 'ready' }))
    expect(worker.last().kind).toBe('checkExport')
    expect(JSON.parse(await decompressProject(embeddedToken(String(worker.last().lua))!))).toEqual(JSON.parse(snapshot.text))
    await run(() => worker.reply({ id: worker.last().id, kind: 'exportReport', report: { complete: true, issues: [], loadInstructions: 1, worstTickInstructions: 1, ticks: 20, visited: ['p1'] } satisfies ExportReport }))
    expect(ui.container.querySelector<HTMLButtonElement>('[aria-label="Download the script"]')!.disabled).toBe(false)
  } finally { resume(); ui.unmount(); await run(() => transfer.settle()) }
})


describe('App project transfer and starters', () => {
  it.each(Object.keys(THEMES))('each_template_calls_load_once and template_retains_current_provided_theme_and_neutral_texts: %s', async theme => {
    const p = projectNamed('saved'); p.theme = theme
    const x = await mountStartup({ saved: p })
    expect(x.state().past).toEqual([])
    const choices = x.ui().container.querySelector('[role="radiogroup"][aria-label="Open template"]')!
    expect(choices).not.toBeNull()
    expect(Array.from(choices.querySelectorAll('label .ptitle')).map(o => o.textContent)).toEqual(TEMPLATES.map(t => t.name))
    for (const entry of TEMPLATES) {
      const past = x.state().past.length, old = x.workers.at(-1)!
      await pickTemplate(x.ui().container, entry.id)
      expect(x.state().past).toHaveLength(past)
      expect(Array.from(choices.querySelectorAll('label')).find(l => l.textContent?.startsWith(entry.name))!.textContent).toContain(entry.description)
      await x.click('Open template')
      expect(x.state().project).toEqual(templateProject(entry.id, theme))
      expect(x.state().past).toHaveLength(past + 1)
      expect(x.state().entered).toBeNull()
      expect(old.terminated).toBe(true)
      expect(x.state().project.pages.every(p => p.scene.defs.every(n => n.op.toUpperCase() !== 'FONT'))).toBe(true)
    }
    await wait(540)
    expect(x.stored('recovery').name).toBe('saved')
    expect(x.stored('current').name).toBe(templateProject(TEMPLATES.at(-1)!.id, theme).name)
    await x.act({ type: 'undo' })
    expect(x.state().project.name).toBe(templateProject(TEMPLATES.at(-2)!.id, theme).name)
  })
  it('template picker uses the provided fallback theme for an unknown saved theme', async () => {
    const p = projectNamed('old theme'); p.theme = 'light'
    const x = await mountStartup({ saved: p })
    await pickTemplate(x.ui().container, 'overview')
    await x.click('Open template')
    expect(x.state().project.theme).toBe('neutral')
  })
  it('Open example still opens 01-19 beside Open template and raw-script mode keeps its own picker', async () => {
    const x = await mountStartup({ saved: projectNamed('saved') })
    const select = x.ui().container.querySelector<HTMLSelectElement>('[aria-label="Open example"]')!
    expect(x.ui().container.querySelector('[aria-label="Open template"]')).not.toBeNull()
    const names = Array.from(select.options).slice(1).map(o => o.value)
    expect(names).toHaveLength(19)
    for (const name of names) {
      await run(() => { select.value = name; select.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(projectText(x.state().project)).toBe(projectText(projectOf(name)))
    }
    const before = x.state().project
    await toggleScripts(x.ui().container)
    expect(x.ui().container.querySelector('.vb-workspace [aria-label="Open template"]')).toBeNull()
    expect(x.ui().container.querySelector('.vb-workspace .vb-project')).toBeNull()
    expect(x.ui().container.querySelector('[aria-label="Run example script"]')).not.toBeNull()
    expect(x.state().project).toBe(before)
  })
  it('file imports keep invalid work and history, propagate the first notice, and reset the chip on valid replacement', async () => {
    const x = await mountStartup({ saved: projectNamed('saved') })
    const input = x.ui().container.querySelector<HTMLInputElement>('[aria-label="Open project file"]')!
    expect(input).not.toBeNull()
    await x.act({ type: 'renamePage', pageId: 'p1', name: 'local' })
    const before = x.state(), old = x.workers.at(-1)!
    const upload = async (text: string) => {
      await run(() => { Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'project.json')] }); input.dispatchEvent(new Event('change', { bubbles: true })) })
      await wait(20)
    }
    await upload('{')
    expect(x.state()).toBe(before)
    await upload(JSON.stringify({ ...projectNamed('<b>loaded</b>'), fontsApproved: true }))
    expect(x.state().project.name).toBe('<b>loaded</b>')
    expect(x.status()).toContain('Ignored non-project fields: fontsApproved')
    expect(x.state().past).toHaveLength(before.past.length + 1)
    expect(old.terminated).toBe(true)
    expect(x.ui().container.querySelector('b')).toBeNull()
    await wait(540)
    expect(x.stored('recovery').name).toBe('saved')
  })
})

it('keeps import files and choices when another project is opened', async () => {
  const app = await booted(), box = app.ui.container
  const text = JSON.stringify(themeFileOf(THEMES['vanilla-plus']))
  const input = box.querySelector<HTMLTextAreaElement>('[aria-label="Tokens or theme JSON"]')!
  await run(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    Array.from(box.querySelectorAll('button')).find(b => b.textContent === 'Read JSON')!.click()
  })
  expect(box.querySelector('[aria-label="Theme mapping"]')).not.toBeNull()
  await run(() => pane.props!.dispatch({ type: 'loadProject', project: newProject() }))
  expect(box.querySelector<HTMLTextAreaElement>('[aria-label="Tokens or theme JSON"]')!.value).toBe(text)
  expect(box.querySelector<HTMLInputElement>('[aria-label="Theme name"]')!.value).toBe('Vanilla + (imported)')
})
