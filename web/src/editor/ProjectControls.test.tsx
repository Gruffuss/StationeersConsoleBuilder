// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assembleExport } from '../codegen/export'
import { generate } from '../codegen/generate'
import { fixtureProjects } from '../codegen/testing'
import * as pageFonts from './pageFonts'
import { newProject, type Project } from '../model/project'
import { initialState, reducer, type Action } from '../model/store'
import { compressProject, projectText } from '../project/codec'
import { fragmentToken, readProject } from '../project/input'
import { shareUrl } from '../project/share'
import { ProjectTransfer } from '../project/transfer'
import { answer, type Request } from '../project/transfer.worker'
import { FakeWorker } from '../runtime/testing'
import { printSrc } from '../srctext/print'
import { mount, run } from '../testing'
import { ProjectControls } from './ProjectControls'
import { readFileSync } from 'node:fs'
import type { AdoptReport } from '../project/adopt'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function mountProjectControls(p = newProject(), prepare = true, controlled = false) {
  const captures: FakeWorker[] = []
  const makeCaptureWorker = () => { const w = new FakeWorker(); captures.push(w); return w as unknown as Worker }
  const workers: WorkerFake[] = [], jobs: Promise<void>[] = [], hold: { kind?: Request['kind'] } = {}
  class WorkerFake extends FakeWorker {
    waiting: Request[] = []
    postMessage(message: Parameters<FakeWorker['postMessage']>[0]) {
      super.postMessage(message)
      const request = message as Request
      const copied = request.kind === 'read' && typeof request.text !== 'string' ? { ...request, text: new Blob([request.text]) } : request
      if (message.kind === hold.kind) this.waiting.push(copied)
      else jobs.push(answer(copied).then(reply => { this.reply(reply) }))
    }
    release() { for (const message of this.waiting.splice(0)) jobs.push(answer(message).then(reply => { this.reply(reply) })) }
  }
  const transfer = new ProjectTransfer(() => { const w = new WorkerFake(); workers.push(w); return w as unknown as Worker })
  let state = initialState(p), notice = '', ui: ReturnType<typeof mount>
  let adoption: AdoptReport | null = null
  let dialogOpen: 'new' | 'share' | 'adopt' | null = null
  const onOpen = vi.fn((open: typeof dialogOpen) => { dialogOpen = open; ui.rerender(render()) })
  const onAdoption = (report: AdoptReport | null) => { adoption = report; ui.rerender(render()) }
  const onLoad = vi.fn((next: Project, original = '') => { state = reducer(state, { type: 'loadProject', project: next }); adoption = null; notice = original; ui.rerender(render()) })
  const onNotice = vi.fn((next: string) => { notice = next; ui.rerender(render()) })
  const render = () => <><ProjectControls project={state.project} transfer={transfer} makeCaptureWorker={makeCaptureWorker} onLoad={onLoad} onNotice={onNotice} adoption={adoption} onAdoption={onAdoption} dialogs={controlled ? { open: dialogOpen, onOpen } : undefined} /><div aria-label="Boundary notice">{notice}</div></>
  ui = mount(render())
  let mounted = true
  const unmount = () => { if (mounted) { mounted = false; ui.unmount() } }
  cleanups.push(() => { unmount(); transfer.dispose() })
  const settle = () => run(async () => { while (jobs.length) await Promise.all(jobs.splice(0)) })
  const button = (label: string) => { const b = ui.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`); expect(b, label).not.toBeNull(); return b! }
  const click = async (label: string) => { await run(() => button(label).click()); await settle() }
  const source = () => ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Project text"]')!
  const file = async (text: string | File, name = 'project.json') => {
    const chosen = typeof text === 'string' ? new File([text], name) : text
    const input = ui.container.querySelector<HTMLInputElement>('[aria-label="Open project file"]')!
    expect(input).not.toBeNull()
    await run(() => {
      Object.defineProperty(input, 'value', { configurable: true, writable: true, value: chosen.name })
      Object.defineProperty(input, 'files', { configurable: true, value: [chosen] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    if (prepare && !button('Prepare project link').disabled) await click('Prepare project link')
    return input
  }
  const edit = async (action: Action) => { await run(() => { state = reducer(state, action); ui.rerender(render()) }); await settle(); if (prepare && !button('Prepare project link').disabled) await click('Prepare project link') }
  await settle()
  if (prepare) await click('Prepare project link')
  return { ui, transfer, workers, captures, hold, onLoad, onNotice, onOpen, onAdoption, file, source, click, button, settle, edit, unmount, state: () => state }
}
const projectNamed = (name: string) => ({ ...newProject(), name })

it('offers foreign Lua without executing it, adopts only on click, and shows a report', async () => {
  const x = await mountProjectControls(newProject(), false)
  await x.file('error("original must not run")', 'foreign.lua')
  expect(x.onLoad).not.toHaveBeenCalled(); expect(x.captures).toHaveLength(0)
  expect(x.ui.container.querySelector('[aria-label="Capture console shape"]')).not.toBeNull()
  await x.click('Adopt this script')
  const w = x.captures[0]
  await run(() => w.reply({kind:'ready'}))
  expect(w.last()).toMatchObject({kind:'captureScript',lua:'error("original must not run")'})
  const capture = JSON.parse(readFileSync('test/fixtures/adopt/src.capture.json', 'utf8'))
  await run(() => w.reply({id:1,kind:'captureReport',report:capture}))
  expect(x.onLoad).toHaveBeenCalledTimes(1)
  expect(x.state().project.customLua).toContain('error("original must not run")')
  expect(x.ui.container.querySelector('[aria-label="Adoption report"]')?.textContent).toContain('main/scene')
})
it('Stop adoption closes only the disposable worker and retains the original project and offer', async () => {
  const x = await mountProjectControls(newProject(), false), original = x.state().project
  await x.file('foreign', 'foreign.lua'); await x.click('Adopt this script')
  await x.click('Stop adopting script')
  expect(x.captures[0].terminated).toBe(true)
  expect(x.state().project).toBe(original)
  expect(x.onLoad).not.toHaveBeenCalled()
  expect(x.ui.container.textContent).toMatch(/cancelled/i)
  expect(x.button('Adopt this script').disabled).toBe(false)
})
const urlInput = (x: Awaited<ReturnType<typeof mountProjectControls>>) => x.ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Share URL"]')!
const noFonts = () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No font consent') }))
  return vi.spyOn(pageFonts, 'loadPageFonts')
}
const downloadSpy = () => {
  let blob!: Blob, filename = ''
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value as Blob; return 'blob:project' })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
  return { create, revoke, blob: () => blob, filename: () => filename }
}

describe('R13 worker file reads', () => {
  it('lays out file and text in the New and open dialog body', async () => {
    const x = await mountProjectControls(newProject(), false)
    const style = document.createElement('style'); style.textContent = readFileSync(`${import.meta.dirname}/dialogs.css`, 'utf8'); document.head.append(style)
    try {
      const body = x.ui.container.querySelector('[aria-label="Open project file"]')!.closest('dialog')!.querySelector('.dlg-body')!
      expect(getComputedStyle(body).display).toBe('grid')
      expect(getComputedStyle(body).gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    } finally { style.remove() }
  })
  it('uses ellipses in pending project and share notices', async () => {
    const x = await mountProjectControls(newProject(), false)
    x.hold.kind = 'read'
    await run(() => {
      const input = x.source()
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '{}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await x.click('Open project text')
    expect(x.ui.container.textContent).toContain('Reading project…')
    x.hold.kind = 'compress'
    await x.click('Prepare project link')
    expect(x.ui.container.textContent).toContain('Preparing project link…')
  })
  it('posts the chosen File as a Blob without main-thread text reads or textarea copies', async () => {
    const x = await mountProjectControls(), file = new File([projectText(projectNamed('file'))], 'project.json')
    const text = vi.spyOn(file, 'text')
    await x.file(file)
    expect(text).not.toHaveBeenCalled()
    const request = x.workers.flatMap(w => w.posted).find(r => r.kind === 'read')!
    expect(request.text).toBe(file)
    expect(request.text).toBeInstanceOf(Blob)
    expect(x.source().value).toBe('')
    expect(x.state().project.name).toBe('file')
  })
  it('Stop aborts a held file read, shows its size, re-enables Open and ignores departed replies', async () => {
    const x = await mountProjectControls(), file = new File([projectText(projectNamed('file'))], 'project.json')
    Object.defineProperty(file, 'size', { value: 2_000_000 })
    x.hold.kind = 'read'; await x.file(file)
    expect(x.ui.container.textContent).toMatch(/Reading project file \(2\.0 MB\)/)
    expect(x.button('Open selected project file').disabled).toBe(true)
    const worker = x.workers.find(w => w.waiting.length)!
    await x.click('Stop reading project')
    expect(worker.terminated).toBe(true)
    expect(x.button('Open selected project file').disabled).toBe(false)
    expect(x.onNotice).toHaveBeenCalledWith('Project read was aborted')
    await run(() => worker.release()); await x.settle()
    expect(x.onLoad).not.toHaveBeenCalled()
    x.hold.kind = undefined
    await x.click('Open selected project file')
    expect(x.onLoad).toHaveBeenCalledTimes(1)
    expect(x.state().project.name).toBe('file')
    expect(x.workers.at(-1)).not.toBe(worker)
  })
  it('retry re-reads the same retained File with a fresh signal and verbatim rejection reasons', async () => {
    const x = await mountProjectControls(), file = new File(['{'], 'broken.json'), read = vi.spyOn(x.transfer, 'read')
    await x.file(file)
    expect(x.onNotice).toHaveBeenLastCalledWith('Project JSON could not be read')
    await x.click('Open selected project file')
    expect(read.mock.calls).toHaveLength(2)
    expect(read.mock.calls[0][0]).toBe(file); expect(read.mock.calls[1][0]).toBe(file)
    expect(read.mock.calls[0][2]).toBeInstanceOf(AbortSignal)
    expect(read.mock.calls[1][2]).not.toBe(read.mock.calls[0][2])
    expect(x.source().value).toBe('')
  })
})

describe('project imports', () => {
  it('explains a canceled import when the committed project changes and keeps the file for retry', async () => {
    const x = await mountProjectControls(); x.hold.kind = 'read'
    await x.file(projectText(projectNamed('imported')))
    await x.edit({ type: 'renamePage', pageId: 'p1', name: 'changed while reading' })
    expect(x.ui.container.textContent).toContain('Import canceled because the project changed')
    expect(x.ui.container.textContent).not.toContain('Reading project')
    expect(x.button('Open selected project file').disabled).toBe(false)
    expect(x.onLoad).not.toHaveBeenCalled()
    x.hold.kind = undefined
    await x.click('Open selected project file')
    expect(x.state().project.name).toBe('imported')
  })

  it('invalid_file_keeps_project_and_undo and retains the source for correction', async () => {
    const x = await mountProjectControls()
    await x.edit({ type: 'renamePage', pageId: 'p1', name: 'edited' })
    const before = x.state(), input = await x.file('{', 'broken.json')
    expect(x.state()).toBe(before)
    expect(x.onLoad).not.toHaveBeenCalled()
    expect(x.source().value).toBe('')
    expect(x.button('Open selected project file').disabled).toBe(false)
    expect(input.value).toBe('')
    expect(x.ui.container.textContent).toContain('broken.json')
    expect(x.ui.container.textContent).toMatch(/JSON|read|parse/i)
    await run(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(x.source(), projectText(projectNamed('corrected'))); x.source().dispatchEvent(new Event('input', { bubbles: true })) })
    await x.click('Open project text')
    expect(x.state().project.name).toBe('corrected')
    expect(x.state().past).toHaveLength(before.past.length + 1)
  })
  it('valid_json_and_embedded_lua_round_trip_integration preserves Unicode, FONT declarations and custom Lua through JSON, link and block', async () => {
    const fonts = noFonts(), p = fixtureProjects()['page-fonts']; p.name = '漢字 🛰️'
    p.pages[0].scene.defs.push({ op: 'font', attrs: { SRC: 'https://refused.example/exact%20face.ttf' } })
    p.customLua = 'error("uploaded Lua must never execute during extraction")'
    const x = await mountProjectControls()
    await x.file(projectText(p))
    expect(projectText(x.state().project)).toBe(projectText(readProject(projectText(p)).project))
    const link = urlInput(x).value, token = fragmentToken(new URL(link).hash)!
    expect(shareUrl(location.href, token)).toEqual({ kind: 'link', url: link })
    const read = x.transfer.read(token, 'token'); await x.settle()
    expect(projectText((await read).project)).toBe(projectText(x.state().project))
    const artifact = assembleExport(generate(p, pg => printSrc(pg.scene)), token, new Date('2026-10-11T12:34:56.000Z'))
    await x.file(artifact.lua, 'builder.lua')
    const saved = downloadSpy(); await x.click('Save project JSON')
    expect(saved.blob().type).toBe('application/json')
    expect(await saved.blob().text()).toBe(projectText(x.state().project))
    expect(x.state().project.pages[0].scene.defs).toEqual(p.pages[0].scene.defs)
    expect(x.state().project.customLua).toBe(p.customLua)
    expect(fonts).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    expect(x.workers.flatMap(w => w.kinds()).every(kind => ['read', 'text', 'compress'].includes(kind))).toBe(true)
  })
  it('duplicate_genuine_custom_block_uses_final_export_block', async () => {
    const older = await compressProject(projectNamed('old')), p = projectNamed('final')
    p.customLua = '--[==[ vectorbuilder:project ' + older + ' ]==]\nerror("do not execute")'
    const token = await compressProject(p)
    const lua = assembleExport(generate(p, pg => printSrc(pg.scene)), token, new Date('2026-10-11T00:00:00Z')).lua
    const x = await mountProjectControls(); await x.file(lua, 'duplicate.lua')
    expect(x.state().project.name).toBe('final')
    expect(x.state().project.customLua).toBe(p.customLua)
    expect(x.onLoad).toHaveBeenCalledTimes(1)
  })
  it('first_sanitizer_notice_is_shown and forged font records stay out of the model', async () => {
    const fonts = noFonts(), p = projectNamed('notices')
    const x = await mountProjectControls()
    await x.file(JSON.stringify({ ...p, fontsApproved: true, fontBytes: [1, 2], downloads: ['private'], persist: { private: 'secret' } }))
    expect(x.onLoad.mock.calls[0][1]).toMatch(/Ignored non-project fields.*fontsApproved/)
    expect(x.ui.container.querySelector('[aria-label="Boundary notice"]')!.textContent).toContain('fontsApproved')
    expect(projectText(x.state().project)).not.toMatch(/fontsApproved|fontBytes|downloads|secret/)
    expect(fonts).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
  it('same_file_can_be_retried, chooses explicit reader kinds and rejects unsupported file types', async () => {
    const x = await mountProjectControls(), read = vi.spyOn(x.transfer, 'read')
    await x.file('{}', 'retry.JSON'); await x.file(projectText(projectNamed('retry')), 'retry.JSON')
    expect(read.mock.calls.slice(0, 2).map(c => c[1])).toEqual(['json', 'json'])
    expect(x.onLoad).toHaveBeenCalledTimes(1)
    await x.file('error("foreign")', 'foreign.LUA')
    expect(read.mock.calls.at(-1)![1]).toBe('lua')
    expect(x.button('Adopt this script')).not.toBeNull()
    const calls = read.mock.calls.length
    await x.file('bad', 'unsupported.txt')
    expect(read).toHaveBeenCalledTimes(calls)
    expect(x.state().project.name).toBe('retry')
  })
  it('a newer rejected file cancels an older pending import', async () => {
    const x = await mountProjectControls(); x.hold.kind = 'read'
    await x.file(projectText(projectNamed('older')))
    await x.file('invalid', 'newer.txt')
    await run(() => { for (const w of x.workers) w.release() }); await x.settle()
    expect(x.onLoad).not.toHaveBeenCalled()
    expect(x.ui.container.textContent).toContain('Choose a .json or .lua')
    expect(x.button('Open project text').disabled).toBe(true)
    expect(x.ui.container.querySelector('[aria-label="Stop reading project"]')).toBeNull()
  })
  it('a null-prototype transfer result renders and remains editable', async () => {
    const x = await mountProjectControls(); await x.file(projectText(projectNamed('null prototype')))
    expect(Object.getPrototypeOf(x.onLoad.mock.calls[0][0])).toBeNull()
    expect(x.ui.container.textContent).toContain('null prototype')
    await x.edit({ type: 'renamePage', pageId: 'p1', name: 'edited after load' })
    expect(x.state().project.pages[0].name).toBe('edited after load')
  })
})

describe('project sharing and JSON rescue', () => {
  it('compresses only when requested after ten committed edits, using the latest project', async () => {
    const x = await mountProjectControls(newProject(), false)
    for (let i = 0; i < 10; i++) await x.edit({ type: 'renamePage', pageId: 'p1', name: 'edit ' + i })
    const requests = () => x.workers.flatMap(w => w.posted).filter(r => r.kind === 'compress')
    expect(requests()).toHaveLength(0)
    await x.click('Prepare project link')
    expect(requests()).toHaveLength(1)
    const token = fragmentToken(new URL(urlInput(x).value).hash)!
    const read = x.transfer.read(token, 'token'); await x.settle()
    expect((await read).project.pages[0].name).toBe('edit 9')
  })
  it('never queues compression behind an in-flight link and discards a superseded result', async () => {
    const x = await mountProjectControls(newProject(), false); x.hold.kind = 'compress'
    await x.click('Prepare project link')
    await x.edit({ type: 'renamePage', pageId: 'p1', name: 'latest' })
    expect(x.button('Prepare project link').disabled).toBe(true)
    const worker = x.workers.find(w => w.waiting.length)!
    await run(() => worker.release()); await x.settle()
    expect(urlInput(x)).toBeNull()
    expect(x.button('Prepare project link').disabled).toBe(false)
    x.hold.kind = undefined
    await x.click('Prepare project link')
    const token = fragmentToken(new URL(urlInput(x).value).hash)!
    const read = x.transfer.read(token, 'token'); await x.settle()
    expect((await read).project.pages[0].name).toBe('latest')
  })

  it.each([0, 1])('sharing_limit_uses_full_URL_no_truncation at the boundary +%s', async extra => {
    const token = '1.' + 'a'.repeat(25), base = 'https://builder.example/' + 'b'.repeat(8000 - ('https://builder.example/#p=' + token).length + extra)
    vi.stubGlobal('location', new URL(base))
    vi.spyOn(ProjectTransfer.prototype, 'compress').mockResolvedValue(token)
    const x = await mountProjectControls(), length = new URL(base + '#p=' + token).href.length
    expect(x.ui.container.textContent).toContain(String(length))
    expect(x.button('Copy project link').disabled).toBe(extra === 1)
    if (extra) { expect(urlInput(x)).toBeNull(); expect(x.button('Save project JSON').disabled).toBe(false) }
    else expect(urlInput(x).value).toBe(base + '#p=' + token)
  })
  it('Unicode_payload_disclosure and hostile_project_name_is_text_never_HTML', async () => {
    const p = projectNamed('<img src=x onerror=alert(1)> 漢字'); p.customLua = 'broken('
    const x = await mountProjectControls(p)
    expect(x.ui.container.querySelector('img')).toBeNull()
    expect(x.ui.container.textContent).toContain(p.name)
    expect(x.ui.container.textContent).toMatch(/custom Lua.*simulated.*font names.*FONT.*URLs/i)
    expect(x.ui.container.textContent).toMatch(/no.*font bytes.*consent.*delivery/i)
    expect(x.button('Save project JSON').disabled).toBe(false)
    expect(x.button('Copy project link').disabled).toBe(false)
  })
  it('missing_compression_has_JSON_rescue and explicit preparation can retry', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const p = projectNamed('broken Lua'); p.customLua = 'broken('
    const x = await mountProjectControls(p)
    expect(x.ui.container.textContent).toMatch(/compression.*unavailable/i)
    expect(x.button('Copy project link').disabled).toBe(true)
    const saved = downloadSpy(); await x.click('Save project JSON')
    expect(JSON.parse(await saved.blob().text()).customLua).toBe('broken(')
    vi.unstubAllGlobals()
    await x.click('Prepare project link')
    expect(x.button('Copy project link').disabled).toBe(false)
  })
  it.each(['working', 'absent', 'rejected', 'throwing'] as const)('clipboard_activation_and_fallback: %s', async mode => {
    const writeText = vi.fn((_text: string) => mode === 'throwing' ? (() => { throw Error('denied') })() : mode === 'rejected' ? Promise.reject(Error('denied')) : Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: mode === 'absent' ? undefined : { writeText } })
    const x = await mountProjectControls()
    expect(writeText).not.toHaveBeenCalled()
    await run(() => { x.button('Copy project link').click(); if (mode !== 'absent') expect(writeText).toHaveBeenCalledTimes(1) })
    await x.settle()
    if (mode === 'working') expect(x.ui.container.textContent).toMatch(/copied/i)
    else {
      expect(x.ui.container.textContent).toMatch(/copy.*(failed|unavailable|denied)/i)
      expect(document.activeElement).toBe(urlInput(x))
      expect(urlInput(x).selectionStart).toBe(0)
      expect(urlInput(x).selectionEnd).toBe(urlInput(x).value.length)
    }
  })
  it.each([['../folder:bad\u0000\n漢字', '.._folder_bad__漢字.json'], ['CON', '_CON.json'], [' . ', 'console.json']])('filename_sanitizes_path_and_control_chars: %s', async (name, filename) => {
    vi.useFakeTimers()
    const x = await mountProjectControls(projectNamed(name)), saved = downloadSpy()
    await x.click('Save project JSON')
    expect(saved.filename()).toBe(filename)
    expect(saved.revoke).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(999); expect(saved.revoke).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(saved.revoke).toHaveBeenCalledWith('blob:project')
    x.unmount(); expect(saved.revoke).toHaveBeenCalledTimes(1)
  })
  it('unmount_revokes_URLs_and_ignores_late_reads and pending JSON downloads', async () => {
    const x = await mountProjectControls(), saved = downloadSpy()
    await x.click('Save project JSON')
    x.hold.kind = 'read'; await x.file(projectText(projectNamed('departed')))
    expect(x.workers.some(w => w.waiting.length)).toBe(true)
    x.unmount()
    expect(saved.revoke).toHaveBeenCalledTimes(1)
    await run(() => { for (const w of x.workers) w.release() }); await x.settle()
    expect(x.onLoad).not.toHaveBeenCalled()
    expect(x.onNotice).not.toHaveBeenCalled()
    const y = await mountProjectControls(); y.hold.kind = 'text'
    await y.click('Save project JSON'); y.unmount()
    await run(() => { for (const w of y.workers) w.release() }); await y.settle()
    expect(saved.create).toHaveBeenCalledTimes(1)
  })
})
it('keeps three focused task dialogs mounted with separate import and share notices', async () => {
  const x = await mountProjectControls(newProject(), false)
  const dialogs = Array.from(x.ui.container.querySelectorAll('dialog'))
  expect(dialogs.map(d => d.querySelector('h2')!.textContent)).toEqual(['New and open', 'Share link', 'Open a script'])
  expect(dialogs.every(d => !d.open)).toBe(true)
  expect(dialogs[0].querySelector('[aria-label="Open project file"]')).not.toBeNull()
  expect(dialogs[1].querySelector('[aria-label="Prepare project link"]')).not.toBeNull()
  expect(x.ui.container.querySelectorAll('[aria-live="polite"]')).toHaveLength(2)
})
it('hands foreign scripts to Adopt and aborts capture on dialog Close', async () => {
  const x = await mountProjectControls(newProject(), false, true)
  await x.file('error("do not run before adoption")', 'foreign.lua')
  expect(x.onOpen).toHaveBeenLastCalledWith('adopt')
  await x.click('Adopt this script')
  expect(x.captures).toHaveLength(1)
  await run(() => x.ui.container.querySelector<HTMLButtonElement>('dialog[open] [aria-label="Close"]')!.click())
  expect(x.captures[0].terminated).toBe(true)
  expect(x.onOpen).toHaveBeenLastCalledWith(null)
  expect(x.ui.container.querySelector('[aria-label="Script adoption"]')).toBeNull()
})

it('shows only the Report step after an empty capture and closes when dismissed', async () => {
  const x = await mountProjectControls(newProject(), false, true)
  await x.file('foreign', 'foreign.lua'); await x.click('Adopt this script')
  const w = x.captures[0], capture = JSON.parse(readFileSync('test/fixtures/adopt/src.capture.json', 'utf8'))
  await run(() => w.reply({ kind: 'ready' }))
  await run(() => w.reply({ id: 1, kind: 'captureReport', report: { ...capture, structures: [], natives: [], data: [] } }))
  expect(x.ui.container.querySelector('dialog[open] [aria-label="Adoption report"]')).not.toBeNull()
  expect(x.ui.container.querySelector('dialog[open] [aria-label="Script adoption"]')).toBeNull()
  await x.click('Dismiss adoption report')
  expect(x.ui.container.querySelector('dialog[open]')).toBeNull()
})
it('drops and aborts a new offer even while an older report is held', async () => {
  const x = await mountProjectControls(newProject(), false, true)
  await run(() => x.onAdoption({ complete: true, pages: [], notes: [], leftOut: [] }))
  await x.file('foreign', 'foreign.lua')
  expect(x.ui.container.querySelector('dialog[open] [aria-label="Adoption report"]')).toBeNull()
  await x.click('Adopt this script')
  await run(() => x.ui.container.querySelector<HTMLButtonElement>('dialog[open] [aria-label="Close"]')!.click())
  expect(x.captures[0].terminated).toBe(true)
  expect(x.ui.container.querySelector('[aria-label="Script adoption"]')).toBeNull()
})
