// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { controlNames } from '../ui/testing'
import { newProject, VECTOR_FLOOR } from '../model/project'
import { ProjectTransfer } from '../project/transfer'
import { SceneChecker } from '../srctext/checker'
import { checkWorkers } from '../srctext/testing'
import { checkScene } from '../srctext/check'
import { parseSrc } from '../srctext/parse'
import { FakeWorker } from '../runtime/testing'
import { loadCatalog } from '../catalog'
import { ExportControls } from './ExportControls'
import { FontImport } from './FontImport'
import { importFont, removeFont } from './fonts'
import { TemplatePicker } from './TemplatePicker'

it('keeps the starting dialog controls before, after an error, and after an incomplete check', async () => {
  localStorage.clear()
  await loadCatalog()
  let project = newProject()
  project.pages[0].scene = parseSrc('R id=box').scene!
  const checks = checkWorkers(s => ({ ...checkScene(s), errors: [{ message: 'located error', ref: { path: [0], inDefs: false } }] }))
  const checker = new SceneChecker(checks.make)
  const transfer = new ProjectTransfer(() => { throw Error('unused') })
  vi.spyOn(transfer, 'sources').mockResolvedValue([{ page: 'p1', src: 'R id=box' }])
  vi.spyOn(transfer, 'compress').mockResolvedValue('1.YWJj')
  const workers: FakeWorker[] = []
  const draw = () => <ExportControls project={project} checker={checker} transfer={transfer} makeWorker={() => {
    const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker
  }} onNotice={() => {}} />
  const ui = mount(draw())
  try {
    const before = ['Check export', 'Copy the script', 'Download JSON fallback', 'Download the script', 'Embed project',
      'BepInEx 5.x', 'StationeersLaunchPad', 'IC10 Editor', 'StationeersLua', 'ScriptedScreens', `ScriptedScreens Vector, ${VECTOR_FLOOR} or newer`, 'ScriptedScreens Fonts'].sort()
    expect(controlNames(ui.container)).toEqual(before)
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Check export"]')!.click())
    expect(controlNames(ui.container)).toEqual([...before, 'Select export problem'].sort())
    checks.made[0].verdict = checkScene
    project = { ...project, pages: [{ ...project.pages[0], scene: parseSrc('R id=box').scene! }] }
    ui.rerender(draw())
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Check export"]')!.click())
    await run(() => workers.at(-1)!.reply({ kind: 'ready' }))
    await run(() => workers.at(-1)!.reply({ id: 1, kind: 'exportReport', report: { complete: false, issues: [{ level: 'info', message: 'unfinished' }], ticks: 0, loadInstructions: 0, worstTickInstructions: 0, visited: [] } }))
    expect(controlNames(ui.container)).toEqual([...before, 'Export unchecked', 'Retry'].sort())
  } finally { ui.unmount(); checker.dispose(); transfer.dispose(); vi.restoreAllMocks() }
})

it('keeps page links, imported fonts, and template controls', async () => {
  const own = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete() {} } })
  vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
  await importFont('Local preview', new ArrayBuffer(8), false)
  const project = newProject()
  project.pages[0].scene.defs = ['https://fonts.googleapis.com/css2?family=One', 'https://fonts.googleapis.com/css2?family=Two'].map(src => ({ op: 'FONT', attrs: { src } }))
  const ui = mount(<><FontImport page={project.pages[0]} project={project} dispatch={() => {}} /><TemplatePicker theme="neutral" onPick={() => {}} /></>)
  try { expect(controlNames(ui.container)).toEqual(['Add', 'Complete font URL', 'Font file', 'Import', "Load this page's fonts", 'Name in the Fonts mod', 'Open template', 'Open template', 'Remove Local preview', 'Remove font declaration 1', 'Remove font declaration 2']) }
  finally { ui.unmount(); await removeFont('Local preview'); vi.unstubAllGlobals(); if (own) Object.defineProperty(document, 'fonts', own); else delete (document as { fonts?: unknown }).fonts }
})
