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
async function boot(project: Project, startup: Awaited<ReturnType<typeof autosave.readAutosave>> = { kind: 'ready', current: { text: projectText(project), revision: 1, updatedAt: '' }, recovery: null }) {
  vi.mocked(autosave.readAutosave).mockResolvedValue(startup)
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

import { withLayout } from './editing/layoutRecords'
import { WIDGETS } from './widgets/registry'
import { TOOLS } from './editing/registry'
import { controlNames } from './ui/testing'
import { imported } from './theme/testing'
import { themeFileOf } from './theme/file'

it('keeps the inventory in its named regions and all modal contents mounted', async () => {
  let p = newProject()
  p.pages[0].scene = parseSrc('G id=layout { R id=box w=20 h=10 }').scene!
  p.pages[0].scene.root[0] = withLayout(p.pages[0].scene.root[0], { dir: 'row', pad: [4, 4, 4, 4], gap: 6, align: 'start', justify: 'start', size: 'fixed', box: [0, 0, 100, 60] })
  let state = initialState(p)
  state = reducer(state, { type: 'insertWidget', pageId: 'p1', widget: 'gauge' })
  state = reducer(state, { type: 'insertWidget', pageId: 'p1', widget: 'textinput' })
  p = state.project
  p.roles = [{ id: 'scan', name: 'Scan', prefabs: [], mode: 'all' }]
  p.reads = [{ id: 'value', role: 'scan', of: { lt: { name: 'Pressure' } } }]
  p.state = [{ name: 'enabled', type: 'bool', init: true }]
  p.actions = [{ id: 'open', on: 'box', do: [{ op: 'page', page: 'vb_devices' }] }]
  p.rules = [{ id: 'write', role: 'scan', lt: { name: 'On' }, value: '1' }]
  p.simDevices = [{ id: 'sim', prefab: '', label: 'Sim', ref: 2, role: 'scan', values: {} }]
  p.customLua = 'U.test = function() end'
  p.themes = { [imported.id]: imported }
  localStorage.setItem('vb.themes', JSON.stringify({ [imported.id]: themeFileOf(imported) }))
  const fetches = vi.spyOn(globalThis, 'fetch')
  const x = await boot(p), box = x.ui.container
  const region = (selector: string) => { const found = box.querySelector<HTMLElement>(selector); expect(found, selector).not.toBeNull(); return found! }
  const dialog = (title: string) => { const found = Array.from(box.querySelectorAll('dialog')).find(d => d.querySelector('h2')?.textContent === title); expect(found, title).toBeDefined(); return found! }
  const controls = (root: Element, names: string[]) => { const actual = controlNames(root); for (const name of names) expect(actual, name).toContain(name) }
  controls(dialog('New and open'), ['Open example', 'Open template', 'Open project file', 'Project text format', 'Project text', 'Open project text', 'Save project JSON'])
  controls(dialog('Share link'), ['Prepare project link', 'Copy project link'])
  expect(dialog('Share link').textContent).toContain('Sharing includes the whole project')
  controls(dialog('Fonts'), ['Font file'])
  expect(dialog('Fonts').querySelector('[aria-label="This page\'s font links"]')).not.toBeNull()
  controls(dialog('Export'), ['Embed project', 'Download the script', 'Copy the script', 'Download JSON fallback', 'Show Send to chip (advanced)'])
  controls(dialog('Game link'), ['List chips', 'Use the chip selected in the IC editor', 'Unlink', 'Stop'])
  expect(dialog('Import a design system').querySelector('[aria-label="Import theme"]')).not.toBeNull()
  controls(region('header.vb-header'), ['Play'])
  await run(() => Array.from(box.querySelectorAll<HTMLButtonElement>('header button')).find(b => b.textContent === 'Help')!.click())
  controls(region('[role="menu"][aria-label="Help"]'), ['Example scriptsDEV', 'Compare captureDEV', 'Open example…DEV'])
  controls(region('.vb-theme-anchor'), ['Theme'])
  expect(Array.from(region('.vb-theme-menu').querySelectorAll('.mgroup')).map(g => g.textContent)).toEqual(['Provided', 'Project', 'This browser'])
  controls(region('nav.vb-rail'), TOOLS.map(t => t.label))
  controls(region('footer.vb-statusbar'), ['Snap', 'Grid', 'Gap', 'Source', 'Zoom percent', 'Fit page', '100 percent', 'Fit selection', 'Pan left', 'Pan right', 'Pan up', 'Pan down', 'Game link'])
  expect(region('.vb-status-game').textContent).toBe('Game: not linked')
  expect(region('footer.vb-statusbar').querySelector('[aria-live="polite"]')).not.toBeNull()
  expect(region('footer.vb-statusbar').querySelector('[aria-live="polite"]')!.textContent).toContain('unbound data names send their samples: gauge1_v, gauge1_st')
  expect(region('.vb-canvas-area').querySelector('[aria-label="Selected node"]')).not.toBeNull()
  expect(region('.vb-center').querySelector('[aria-label="Source pane"]')).not.toBeNull()
  expect(region('.vb-source-head').textContent).toContain('Source')
  controls(region('.vb-page-settings'), ['Name', 'Console size', 'Remove this page'])
  expect(region('.vb-page-settings').querySelector('[aria-label="Pictures"]')).not.toBeNull()
  controls(region('aside.vb-sidebar'), ['Add page', 'Remove page Main'])
  expect(region('aside.vb-sidebar').querySelector('[aria-label="Root layers"]')).not.toBeNull()
  expect(region('aside.vb-sidebar').querySelector('[aria-label="Definition layers"]')).not.toBeNull()
  await x.clickTab('Widgets'); controls(region('aside.vb-sidebar'), Object.values(WIDGETS).map(w => w.label))
  for (const [tab, name] of [['Data', 'Data'], ['Logic', 'Logic'], ['Sim', 'Sim'], ['Lua', 'Custom Lua']]) { await x.clickTab(tab); expect(region('aside.vb-inspector').querySelector(`[aria-label="${name}"]`)).not.toBeNull() }
  controls(region('aside.vb-inspector'), ['custom Lua'])
  await x.clickTab('Logic'); controls(region('aside.vb-inspector'), ['Pick a device'])
  await x.clickTab('Sim'); controls(region('aside.vb-inspector'), ['wipe persist'])
  await x.clickTab('Design')
  const pageFirst = () => !!(region('aside.vb-inspector').querySelector('details.vb-page-section')!.compareDocumentPosition(region('aside.vb-inspector').querySelector('aside[aria-label="Properties"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(pageFirst()).toBe(true)   // nothing selected: the Page section leads the Design tab (owner, 2026-10-13)
  expect(region('aside.vb-inspector').querySelector('.vb-page-settings [aria-label="Pictures"]')).not.toBeNull()
  await run(() => x.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } }))
  expect(region('aside.vb-inspector').querySelector('[aria-label="Layout properties"]')).not.toBeNull()
  await run(() => x.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } }))
  expect(region('aside.vb-inspector').querySelector('aside[aria-label="Properties"]')).not.toBeNull()
  expect(region('aside.vb-inspector').querySelector('details.vb-page-section')).toBeNull()   // a selection shows only its own properties
  await run(() => x.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [1] } }))
  expect(region('aside.vb-inspector').querySelector('[aria-label="Widget"]')).not.toBeNull()
  // The game link, Send to chip and the device pickers are mounted, and none asked the game anything without a click.
  expect(fetches.mock.calls.map(c => String(c[0])).filter(u => /__vb-game-mcp|127\.0\.0\.1:3030/.test(u))).toEqual([])
}, 30_000)

it('covers startup and unsaved recovery actions and the foreign-script offer', async () => {
  const x = await boot(newProject(), { kind: 'unavailable', reason: 'Storage blocked' }), box = x.ui.container
  const dialog = (title: string) => Array.from(box.querySelectorAll('dialog')).find(d => d.querySelector('h2')?.textContent === title)!
  expect(controlNames(dialog('Choose a project'))).toEqual(expect.arrayContaining(['Blank project', 'Continue without autosave']))
  await run(() => Array.from(dialog('Choose a project').querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === 'Continue without autosave')!.click())
  await run(() => box.querySelector<HTMLButtonElement>('.vb-save')!.click())
  expect(controlNames(dialog('Not saved'))).toEqual(expect.arrayContaining(['Download unsaved project JSON', 'Retry autosave']))
  await run(() => dialog('Not saved').querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
  const format = box.querySelector<HTMLSelectElement>('[aria-label="Project text format"]')!, text = box.querySelector<HTMLTextAreaElement>('[aria-label="Project text"]')!
  await run(() => { format.value = 'lua'; format.dispatchEvent(new Event('change', { bubbles: true })) })
  await run(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, 'foreign script'); text.dispatchEvent(new Event('input', { bubbles: true })) })
  await run(() => box.querySelector<HTMLButtonElement>('[aria-label="Open project text"]')!.click()); await x.flush()
  expect(dialog('Open a script').open).toBe(true)
  expect(dialog('Open a script').querySelector('[aria-label="Script adoption"]')).not.toBeNull()
})
