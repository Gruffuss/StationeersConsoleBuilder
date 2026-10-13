// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { loadCatalog } from '../catalog'
import { generate } from '../codegen/generate'
import * as codegen from '../codegen/generate'
import { assembleExport } from '../codegen/export'
import * as traps from '../codegen/checks'
import { hostOf } from '../codegen/hostOf'
import { newPage, newProject, type Project } from '../model/project'
import { ProjectTransfer } from '../project/transfer'
import { projectText } from '../project/codec'
import { FakeWorker } from '../runtime/testing'
import type { ExportReport } from '../runtime/exportCheck'
import { checkScene, invalid, tooLarge, type Checked } from '../srctext/check'
import { SceneChecker } from '../srctext/checker'
import { parseSrc } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { checkWorkers } from '../srctext/testing'
import { mount, run } from '../testing'
import { importFont, removeFont, registerPageFonts, releasePageFonts } from './fonts'
import { ExportControls } from './ExportControls'
import { VECTOR_FLOOR } from '../model/project'
import { Dialog } from '../ui/Dialog'

const cleanups: (() => void)[] = []
const report = (over: Partial<ExportReport> = {}): ExportReport => ({ complete: true, issues: [], loadInstructions: 4, worstTickInstructions: 2, ticks: 20, visited: ['p1'], ...over })
const scene = (text: string) => parseSrc(text).scene!
it('lists the required mods last, in load order: each a link, the Vector floor and the Fonts condition as secondary text', () => {
  // Owner, 2026-10-13: moved to the bottom, and "make it look better not a slaped in list".
  const a = mountExport(), mods = a.ui.container.querySelector('section[aria-label="Required mods"]')!
  expect(a.ui.container.querySelector('.vb-export')!.lastElementChild).toBe(mods)
  expect(a.ui.container.querySelector('section[aria-label="Script"]')!.textContent).not.toContain('Required mods')
  const rows = Array.from(mods.querySelectorAll('ol > li'))
  expect(rows.map(li => [li.querySelector('a')!.textContent, li.querySelector('a')!.getAttribute('href'), li.querySelector('.unit')?.textContent ?? ''])).toEqual([
    ['BepInEx 5.x', 'https://github.com/BepInEx/BepInEx', ''],
    ['StationeersLaunchPad', 'https://github.com/StationeersLaunchPad/StationeersLaunchPad', ''],
    ['IC10 Editor', 'https://steamcommunity.com/sharedfiles/filedetails/?id=3592775931', ''],
    ['StationeersLua', 'https://steamcommunity.com/sharedfiles/filedetails/?id=3659911735', ''],
    ['ScriptedScreens', 'https://steamcommunity.com/sharedfiles/filedetails/?id=3666779631', ''],
    ['ScriptedScreens Vector', 'https://steamcommunity.com/sharedfiles/filedetails/?id=3787517570', `${VECTOR_FLOOR} or newer`],
    ['ScriptedScreens Fonts', 'https://steamcommunity.com/sharedfiles/filedetails/?id=3803224901', "only when the screen uses a font other than the game's own or a web font"],
  ])
  for (const link of Array.from(mods.querySelectorAll<HTMLAnchorElement>('a'))) {
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
  }
  expect(mods.textContent).toContain('A console on an older mod shows a banner on every page instead of the screen.')
})

it('lays out Script, Check, leveled issues and the final actions without changing issue text', async () => {
  const a = mountExport({ verdict: s => ({ ...checkScene(s), errors: [{ message: 'located error', ref: { path: [0], inDefs: false } }] }) })
  expect(a.ui.container.querySelector('section[aria-label="Script"]')).not.toBeNull()
  expect(a.ui.container.querySelector('section[aria-label="Check"]')).not.toBeNull()
  expect(a.ui.container.querySelector('[aria-label="Check export"]')).toBeNull()
  expect(a.ui.container.querySelector('section[aria-label="Required mods"]')!.textContent).toContain(`${VECTOR_FLOOR} or newer`)
  const actions = a.ui.container.querySelector('.vb-export-actions')!
  expect(Array.from(actions.querySelectorAll('button')).map(b => b.getAttribute('aria-label'))).toEqual(['Download JSON fallback', 'Copy the script', 'Download the script'])
  await a.open()
  const chip = a.ui.container.querySelector('.chip.crit')!
  expect(chip.textContent).toBe('error')
  expect(chip.parentElement!.textContent).toBe('error: p1: located errorSelect')
})
it('styles warning and information issue levels', async () => {
  const a = mountExport()
  await a.check(report({ issues: [{ level: 'warning', page: 'p1', message: 'warning text' }, { level: 'info', message: 'information text' }] }))
  expect(a.ui.container.querySelector('.chip.warn')?.parentElement?.textContent).toBe('warning: p1: warning text')
  expect(a.ui.container.querySelector('.chip.info')?.parentElement?.textContent).toBe('info: information text')
})
beforeEach(async () => { localStorage.clear(); await loadCatalog() })
afterEach(() => { for (const f of cleanups.splice(0)) f(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function mountExport({ p = newProject(), verdict, strict = false, absent = false, send, modal = false, opened = false }: { p?: Project; verdict?: (s: Project['pages'][number]['scene']) => Checked; strict?: boolean; absent?: boolean; opened?: boolean; send?: (ready: { lua: string; name: string } | null) => import('react').ReactNode; modal?: boolean } = {}) {
  const checks = checkWorkers(verdict), checker = absent ? null : new SceneChecker(checks.make)
  const transfer = new ProjectTransfer(() => { throw Error('unused transfer worker') })
  const compress = vi.spyOn(transfer, 'compress').mockResolvedValue('1.YWJj')
  const sources = vi.spyOn(transfer, 'sources').mockImplementation(async p => p.pages.map(pg => ({ page: pg.id, src: printChecked(pg.scene) })))
  const text = vi.spyOn(transfer, 'text').mockImplementation(async p => projectText(p))
  const workers: FakeWorker[] = [], notice = vi.fn()
  const makeWorker = () => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }
  const render = (project: Project) => {
    const controls = <ExportControls open={opened} project={project} checker={checker} makeWorker={makeWorker} transfer={transfer} onNotice={notice} send={send} />
    const ui = modal ? <Dialog open={opened} title="Export" onClose={() => {}}>{controls}</Dialog> : controls
    return strict ? <StrictMode>{ui}</StrictMode> : ui
  }
  const ui = mount(render(p))
  cleanups.push(() => { ui.unmount(); checker?.dispose(); transfer.dispose() })
  const button = (label: string) => ui.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  const click = async (label: string) => { expect(button(label), label).toBeTruthy(); await run(() => button(label).click()) }
  const ready = async () => { const w = workers.at(-1)!; expect(w).toBeTruthy(); await run(() => w.reply({ kind: 'ready' })); return w }
  const finish = async (r = report()) => { const w = await ready(); await run(() => w.reply({ id: 1, kind: 'exportReport', report: r })); return w }
  const open = async () => { if (!opened) { opened = true; await run(() => ui.rerender(render(p))) } }
  const close = async () => { opened = false; await run(() => ui.rerender(render(p))) }
  const check = async (r = report()) => { await open(); return finish(r) }
  return { ui, workers, checks, checker, transfer, compress, sources, text, notice, button, click, ready, finish, check, open, close,
    replace: (next: Project) => { p = next; ui.rerender(render(p)) }, project: () => p,
    embed: async () => { await run(() => ui.container.querySelector<HTMLInputElement>('[aria-label="Embed project"]')!.click()) } }
}

it('checks when the dialog opens, cancels when it closes, and checks the new artifact after a change while open', async () => {
  // Owner, 2026-10-13: the check runs on its own when the Export dialog opens (it was an explicit Check export, M4 Q13).
  const a = mountExport({ modal: true })
  expect(a.workers).toHaveLength(0)
  expect(a.ui.container.querySelector('[aria-label="Check export"]')).toBeNull()
  await a.open()
  expect(a.ui.container.querySelector('[aria-live]')!.textContent).toContain('Checking export…')
  const first = await a.ready()
  await a.close()
  expect(first.terminated).toBe(true)
  await a.open(); await a.finish()
  expect(a.button('Download the script').disabled).toBe(false); expect(a.button('Copy the script').disabled).toBe(false)
  const done = a.workers.length
  await a.embed()
  expect(a.button('Download the script').disabled).toBe(true)
  expect(a.ui.container.querySelector('[aria-live]')!.textContent).toContain('Checking export…')
  await a.finish()
  expect(a.workers.length).toBe(done + 1)
  expect(a.button('Download the script').disabled).toBe(false)
})

it('passes the enabled artifact or null to the optional send slot below Download and Copy', async () => {
  const p = newProject(); p.name = 'Send project'
  const send = vi.fn((_ready: { lua: string; name: string } | null) => <div data-send>Send to game</div>)
  const a = mountExport({ p, send })
  expect(send).toHaveBeenLastCalledWith(null)
  expect(a.ui.container.querySelector('.vb-export-actions')?.nextElementSibling?.textContent).toBe('Send to game')
  const w = await a.check()
  expect(a.button('Download the script').disabled || a.button('Copy the script').disabled).toBe(false)
  expect(send).toHaveBeenLastCalledWith({ lua: w.last().lua, name: p.name })
  await a.close(); await a.open()
  expect(send).toHaveBeenLastCalledWith(null)
  const retry = await a.finish(report({ complete: false }))
  expect(send).toHaveBeenLastCalledWith(null)
  await a.click('Export unchecked')
  expect(send).toHaveBeenLastCalledWith({ lua: retry.last().lua, name: p.name })
  await a.embed()
  expect(send).toHaveBeenLastCalledWith(null)
  const plain = mountExport()
  expect(plain.ui.container.querySelector('.vb-export-actions')?.nextElementSibling?.getAttribute('aria-label')).toBe('Required mods')   // no slot: the mods list follows
})

it('nonempty_generated_error_gates_both_actions', async () => {
  const real = generate
  vi.spyOn(codegen, 'generate').mockImplementation((...args) => { const g = real(...args); return { ...g, problems: [...g.problems, { level: 'error', message: 'generated failure' }] } })
  const a = mountExport(); await a.open()
  expect(a.ui.container.textContent).toContain('generated failure')
  expect(a.button('Download the script').disabled).toBe(true)
  expect(a.button('Copy the script').disabled).toBe(true)
  expect(a.button('Export unchecked')).toBeNull()
})

it('completed_warnings_allow_export including unknown font', async () => {
  const p = newProject(); p.pages[0].scene = scene('T font="Unknown Export Face" text=x')
  const a = mountExport({ p }); await a.check(report({ issues: [{ level: 'warning', message: 'accepted scene fault', page: 'p1', node: null, key: null }] }))
  expect(a.ui.container.textContent).toContain('Unknown Export Face')
  expect(a.ui.container.textContent).toContain('accepted scene fault')
  expect(a.button('Download the script').disabled || a.button('Copy the script').disabled).toBe(false)
})

it('incomplete_offers_explicit_unchecked_escape retaining exact bytes', async () => {
  const a = mountExport(); const w = await a.check(report({ complete: false, issues: [{ level: 'info', message: 'runtime check timed out' }] }))
  expect(a.button('Download the script').disabled && a.button('Copy the script').disabled).toBe(true)
  expect(a.button('Retry')).toBeTruthy(); expect(a.button('Download JSON fallback')).toBeTruthy()
  await a.click('Export unchecked')
  expect(a.ui.container.textContent).toContain('Unchecked:')
  expect(a.ui.container.textContent).toContain('runtime check timed out')
  expect(a.button('Copy the script').disabled).toBe(false)
  expect(a.compress).toHaveBeenCalledTimes(1)
  expect(a.workers).toHaveLength(1)
  expect(a.ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Export Lua"]')!.value).toBe(w.last().lua)
})

it('incomplete never bypasses known runtime errors', async () => {
  const a = mountExport(); await a.check(report({ complete: false, issues: [{ level: 'error', message: 'compile failure' }, { level: 'info', message: 'render failed' }] }))
  expect(a.button('Export unchecked')).toBeNull()
  expect(a.button('Copy the script').disabled).toBe(true)
})

it('scene_tooLarge_runs_core_check_on_worker_sources_and_stays_incomplete', async () => {
  const p = newProject(); p.pages.push(newPage(p)); p.pages[0].scene = scene('T text="worker source"')
  const a = mountExport({ p, verdict: () => tooLarge('timeout') }); const w = await a.check()
  expect(a.sources).toHaveBeenCalledWith(p)
  expect(w.last().lua).toContain('worker source')
  expect(JSON.parse(String(w.last().pages))).toEqual(generate(p, pg => printChecked(pg.scene)).pages)
  expect(w.last().host).toBe(JSON.stringify(hostOf(p, await loadCatalog(), null).host))
  expect(a.ui.container.textContent).toContain("the editor's scene check did not finish for page Main")
  expect(a.ui.container.textContent).toContain("the editor's scene check did not finish for page Page 2")
  expect(a.ui.container.textContent).not.toContain('too large to check here')
  expect(a.button('Download the script').disabled).toBe(true)
  await a.click('Export unchecked'); expect(a.button('Download the script').disabled).toBe(false)
})

it.each([1057682, 1057683])('size_line_only_above_measured_1057682_bytes: %s', async size => {
  const real = generate
  vi.spyOn(codegen, 'generate').mockImplementation((...args) => {
    const g = { ...real(...args), lua: '-- VectorBuilder export\n' }
    const headerBytes = assembleExport(g, null, new Date('2026-10-12T00:00:00Z')).totalBytes
    return { ...g, lua: g.lua + 'x'.repeat(size - headerBytes) }
  })
  const a = mountExport(); await a.embed(); const w = await a.check()
  const bytes = new TextEncoder().encode(String(w.last().lua)).length
  expect(bytes).toBe(size)
  expect(a.ui.container.textContent).toContain(`${bytes} total UTF-8 bytes`)
  expect(a.ui.container.textContent?.includes('larger than any size measured accepted in game')).toBe(bytes > 1057682)
  expect(a.compress).not.toHaveBeenCalled()
})

it('exact_checked_bytes_equal_download_and_copy and object_url_lifetime', async () => {
  vi.useFakeTimers()
  const writeText = vi.fn(async (_s: string) => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:checked'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { expect(revoke).not.toHaveBeenCalled() })
  const a = mountExport(); const w = await a.check()
  expect(writeText).not.toHaveBeenCalled()
  await a.click('Copy the script'); await a.click('Download the script')
  expect(writeText.mock.calls[0][0]).toBe(w.last().lua)
  expect(await (create.mock.calls[0][0] as Blob).text()).toBe(w.last().lua)
  expect(a.ui.container.textContent).toContain('embedded comment UTF-8 bytes')
  expect(revoke).not.toHaveBeenCalled(); await run(() => { vi.runOnlyPendingTimers() }); expect(revoke).toHaveBeenCalledWith('blob:checked')
})

it.each(['project', 'FONT', 'name', 'embed'])('changes_in_project_embed_or_FONT_declarations_invalidate: %s', async kind => {
  const a = mountExport(); await a.check()
  if (kind === 'embed') await a.embed()
  else { const p = { ...a.project(), name: kind === 'name' ? 'renamed' : a.project().name, pages: [...a.project().pages] }; if (kind === 'FONT') p.pages[0] = { ...p.pages[0], scene: scene('DEFS { FONT src="https://blocked.example/new.ttf" }\nT text=x') }; a.replace(p) }
  expect(a.button('Copy the script').disabled).toBe(true)
  expect(a.ui.container.querySelector('[aria-label="Export Lua"]')).toBeNull()
})

it('local_import_removal_and_page_delivery_preserve_artifact_report', async () => {
  const p = newProject(); p.pages[0].scene = scene('T font="Export Local Face" text=x')
  const a = mountExport({ p }); const w = await a.check()
  const own = Object.getOwnPropertyDescriptor(document, 'fonts'), controller = new AbortController()
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete() {} } })
  vi.stubGlobal('FontFace', class { loaded = Promise.resolve(this); load() { return Promise.resolve(this) } })
  try {
    await run(async () => { await importFont('Export Local Face', new ArrayBuffer(8), false) }); a.replace(p)
    await run(async () => { await removeFont('Export Local Face') }); a.replace(p)
    await run(() => { registerPageFonts('export-page', [{ family: 'Export Local Face', style: 'normal', weight: '400', minWeight: 400, maxWeight: 400, representative: 'https://fonts.gstatic.com/export.ttf', sources: [], metadata: { status: 'ok', names: {}, axes: [], faces: [], family: 'Export Local Face', style: 'Regular', instances: [] } }], () => {}, controller.signal) }); a.replace(p)
    expect(a.button('Copy the script').disabled).toBe(false)
    expect(a.ui.container.textContent).toContain('Export Local Face')
    expect(a.ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Export Lua"]')!.value).toBe(w.last().lua)
    expect(a.workers).toHaveLength(1)
  } finally { controller.abort(); releasePageFonts('export-page'); if (own) Object.defineProperty(document, 'fonts', own); else delete (document as { fonts?: unknown }).fonts }
})

it('export_never_grants_font_consent', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const p = newProject(); p.pages[0].scene = scene('DEFS { FONT src="https://fonts.googleapis.com/css2?family=Orbitron" }\nT text=x')
  const a = mountExport({ p }); await a.check(); expect(fetch).not.toHaveBeenCalled()
  expect(String(a.workers[0].last().lua)).toContain('https://fonts.googleapis.com/css2?family=Orbitron')
})

it('late_report_ignored and aborts old worker', async () => {
  const a = mountExport(); await a.open(); const w = await a.ready(), oldReply = w.onmessage!
  a.replace({ ...a.project(), name: 'new' })
  expect(w.terminated).toBe(true)
  await run(() => oldReply({ data: { id: 1, kind: 'exportReport', report: report() } } as MessageEvent))
  expect(a.button('Copy the script').disabled).toBe(true)
  await a.check(); expect(a.button('Copy the script').disabled).toBe(false)
})

it.each([undefined, () => Promise.reject(Error('clipboard denied'))])('unavailable_clipboard_selectable_fallback: %s', async writeText => {
  vi.stubGlobal('navigator', { clipboard: writeText ? { writeText } : undefined })
  const a = mountExport(); const w = await a.check(); await a.click('Copy the script')
  const fallback = a.ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Export Lua"]')!
  expect(fallback.readOnly).toBe(true); expect(fallback.value).toBe(w.last().lua)
  expect(document.activeElement).toBe(fallback)
  expect(fallback.selectionEnd).toBe(fallback.value.length)
  expect(a.notice).toHaveBeenCalledWith(expect.stringContaining(writeText ? 'clipboard denied' : 'clipboard is unavailable'))
})

it('structured_static_location_selects_real_path', async () => {
  const p = newProject(); p.pages[0].scene = scene('G { T size=1 text=x }')
  const a = mountExport({ p, verdict: s => ({ ...checkScene(s), warnings: [{ message: 'structured scene warning', ref: { path: [0, 0], inDefs: false }, key: 'size' }] }) }); await a.check()
  const links = Array.from(a.ui.container.querySelectorAll<HTMLButtonElement>('[aria-label="Select export problem"]'))
  expect(links.length).toBeGreaterThan(0)
  await run(() => links[0].click())
  expect(a.notice).toHaveBeenCalledWith('', { pageId: 'p1', path: [0, 0], inDefs: false })
  a.replace({ ...p, pages: [{ ...p.pages[0], scene: scene('R') }] }); await run(() => links[0].click())
  expect(a.notice).toHaveBeenCalledTimes(1)
})

it('runtime_strings_have_no_bogus_node_link', async () => {
  const a = mountExport(); await a.check(report({ issues: [{ level: 'warning', page: 'p1', node: null, key: null, message: 'page p1 root 0 size: runtime text' }, { level: 'warning', page: 'custom_surface', message: 'banner node 3' }] }))
  expect(a.ui.container.querySelector('[aria-label="Select export problem"]')).toBeNull()
  expect(a.ui.container.textContent).toContain('custom_surface')
})

it('custom_parse_error_maps_to_custom_code_line', async () => {
  const p = newProject(); p.customLua = 'local a=1\nlocal b=)'
  const a = mountExport({ p }); await a.open(); const w = await a.ready()
  const line = generate(p, pg => printChecked(pg.scene)).map.find(e => e.part === 'custom')!.first + 1
  await run(() => w.reply({ id: 1, kind: 'exportReport', report: report({ issues: [{ level: 'error', message: `compile: [string "chip"]:${line}: unexpected symbol near ')'` }] }) }))
  expect(a.ui.container.textContent).toContain('custom code line 2')
  expect(a.button('Copy the script').disabled).toBe(true)
})

it('StrictMode/dispose aborts only its own attempt', async () => {
  const a = mountExport({ strict: true }); await a.open(); const w = await a.ready()
  a.ui.unmount(); cleanups.splice(0).forEach(f => { a.checker?.dispose(); a.transfer.dispose() })
  expect(w.terminated).toBe(true)
})

it('preparation after unavailable scene check remains explicitly unchecked', async () => {
  const a = mountExport({ absent: true }); await a.open()
  expect(a.button('Copy the script').disabled).toBe(true)
  await a.click('Export unchecked')
  expect(a.sources).toHaveBeenCalled()
  expect(a.button('Copy the script').disabled).toBe(false)
  expect(a.ui.container.textContent).toContain('Unchecked:')
  expect(a.ui.container.textContent).toContain('runtime check did not finish')
  expect(a.workers).toHaveLength(0)
})

it('new generator errors cancel incomplete escape', async () => {
  const a = mountExport({ absent: true }); await a.open()
  const real = generate
  vi.spyOn(codegen, 'generate').mockImplementation((...args) => ({ ...real(...args), problems: [{ level: 'error', message: 'new generator error' }] }))
  await a.click('Export unchecked'); expect(a.button('Copy the script').disabled).toBe(true)
  expect(a.ui.container.textContent).toContain('new generator error')
  expect(a.button('Export unchecked')).toBeNull()
})

it('compression failure retains JSON, Retry and embedding off', async () => {
  const a = mountExport(); a.compress.mockRejectedValue(Error('compression unavailable'))
  await a.open()
  expect(a.ui.container.textContent).toContain('compression unavailable')
  expect(a.button('Copy the script').disabled).toBe(true)
  expect(a.button('Retry')).toBeTruthy(); expect(a.button('Download JSON fallback')).toBeTruthy()
  await a.embed(); await a.check(); expect(a.button('Copy the script').disabled).toBe(false)
})

it('transfer timeout keeps JSON rescue and retries missing sources', async () => {
  const a = mountExport({ verdict: () => tooLarge('timeout') }); a.sources.mockRejectedValueOnce(Error('use the original JSON file'))
  await a.open()
  expect(a.ui.container.textContent).toContain('use the original JSON file')
  expect(a.button('Download JSON fallback').disabled).toBe(false)
  await a.click('Export unchecked'); expect(a.sources).toHaveBeenCalledTimes(2)
  expect(a.button('Copy the script').disabled).toBe(false)
})

it.each([['a/b\\c:*?"<>|\u0000.', 'a_b_c________'], ['', 'console'], ['温度 Écran', '温度 Écran'], ['CON', '_CON'], ['lpt1.txt', '_lpt1.txt'], ['<img src=x onerror=alert(1)>', '_img src=x onerror=alert(1)_']])('safe filenames for both extensions and React text: %s', async (name, safe) => {
  const a = mountExport({ p: { ...newProject(), name } }); await a.check()
  const downloaded: string[] = []
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded.push(this.download) })
  await a.click('Download the script'); await a.click('Download JSON fallback')
  expect(downloaded).toEqual([safe + '.lua', safe + '.json'])
  expect(a.ui.container.querySelector('img')).toBeNull()
})

it('guarded localStorage preference defaults on and persists off', async () => {
  const a = mountExport(); expect(a.ui.container.querySelector<HTMLInputElement>('[aria-label="Embed project"]')!.checked).toBe(true)
  await a.embed(); const b = mountExport(); expect(b.ui.container.querySelector<HTMLInputElement>('[aria-label="Embed project"]')!.checked).toBe(false)
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw Error('blocked') })
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('blocked') })
  const c = mountExport(); expect(c.ui.container.querySelector<HTMLInputElement>('[aria-label="Embed project"]')!.checked).toBe(true); await c.embed()
})

it('discloses sample limits even on complete success', async () => {
  const a = mountExport(); await a.check()
  for (const text of ['cold stores', 'simulated', 'click handlers', '16', 'Scene.Problems', 'Missing', 'Starved', 'Dropped', 'TMP', 'Fonts API']) expect(a.ui.container.textContent).toContain(text)
  expect(a.ui.container.querySelector('[aria-live="polite"]')).toBeTruthy()
})

it('an incomplete retry cannot erase already known runtime errors', async () => {
  const a = mountExport(); await a.check(report({ issues: [{ level: 'error', message: 'known compile error' }] }))
  await a.open(); const w = a.workers.at(-1)!
  await run(() => w.reply({ kind: 'crashed', why: 'boot failed' }))
  expect(a.ui.container.textContent).toContain('known compile error')
  expect(a.button('Export unchecked')).toBeNull()
  expect(a.button('Copy the script').disabled).toBe(true)
})

it('every unfinished check is named when scene and runtime checks are incomplete', async () => {
  const a = mountExport({ verdict: () => tooLarge('timeout') })
  await a.check(report({ complete: false, issues: [] }))
  await a.click('Export unchecked')
  expect(a.ui.container.textContent).toContain("the editor's scene check did not finish for page Main")
  expect(a.ui.container.textContent).toContain('runtime check did not finish')
})

it('a late clipboard rejection after a new check does not select or report the wrong artifact', async () => {
  let reject!: (e: Error) => void
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>((_, no) => { reject = no }) } })
  const a = mountExport(); await a.check(); await a.click('Copy the script')
  await a.close(); await a.check(); await run(() => reject(Error('stale clipboard failure')))
  expect(a.notice).not.toHaveBeenCalled()
  expect(a.ui.container.textContent).not.toContain('stale clipboard failure')
})

it('pending checks gate actions and await every authored page', async () => {
  const p = newProject(); p.pages.push(newPage(p)); const a = mountExport({ p })
  a.checks.made[0].held = true
  await a.open()
  expect(a.workers).toHaveLength(0)
  expect(a.button('Download the script').disabled && a.button('Copy the script').disabled).toBe(true)
  expect(a.button('Export unchecked')).toBeNull()
  expect(a.ui.container.querySelector('[aria-live]')!.textContent).toContain('Checking export')
  await run(() => { a.checks.made[0].held = false; a.checks.made[0].release() })
  await a.finish(report({ visited: ['p1', 'p2'] })); expect(a.button('Copy the script').disabled).toBe(false)
})

it('invalid scene and static errors gate export and still allow JSON rescue', async () => {
  const a = mountExport({ verdict: () => invalid('authored scene is invalid') }); await a.open()
  expect(a.ui.container.textContent).toContain('authored scene is invalid')
  expect(a.button('Copy the script').disabled).toBe(true); expect(a.button('Export unchecked')).toBeNull()
  const p = newProject(); p.state = Array.from({ length: 85 }, (_, i) => ({ name: `v${i}`, type: 'number', init: 0 }))
  a.checks.made[0].verdict = checkScene
  await run(() => a.replace(p))   // a change while the dialog is open checks the new project
  expect(a.ui.container.textContent).toContain('chip-memory mirror')
  expect(a.workers).toHaveLength(0); expect(a.button('Download JSON fallback').disabled).toBe(false)
})

it('edits during compression prevent a worker from checking stale sources', async () => {
  const a = mountExport(); let finish!: (token: string) => void
  a.compress.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }))
  await a.open(); await run(() => a.replace({ ...a.project(), name: 'changed' }))   // a change while open checks the changed project
  const made = a.workers.length
  await run(() => finish('1.YWJj'))   // the stale attempt's compression ends after the change
  expect(a.workers).toHaveLength(made); expect(a.button('Copy the script').disabled).toBe(true)
})

it('embed changes while the worker boots dispose it and ignore late replies', async () => {
  const a = mountExport(); await a.open(); const w = a.workers[0], reply = w.onmessage!
  await a.embed(); expect(w.terminated).toBe(true)
  await run(() => reply({ data: { kind: 'ready' } } as MessageEvent))
  expect(w.posted).toHaveLength(0); expect(a.button('Copy the script').disabled).toBe(true)
})

it('runtime watchdog leaves an explicit unchecked escape with exact prepared bytes', async () => {
  vi.useFakeTimers(); const a = mountExport(); await a.open(); const w = await a.ready()
  await run(async () => { await vi.advanceTimersByTimeAsync(50000) })
  expect(w.terminated).toBe(true); expect(a.button('Copy the script').disabled).toBe(true)
  expect(a.ui.container.textContent).toContain('50-second check allowance')
  await a.click('Export unchecked')
  expect(a.ui.container.querySelector<HTMLTextAreaElement>('[aria-label="Export Lua"]')!.value).toBe(w.last().lua)
})

it('report concatenates generator, read traps, export checks and scene/runtime diagnostics', async () => {
  vi.spyOn(traps, 'readTraps').mockReturnValue([{ level: 'warning', message: 'read trap in report' }])
  const warning = { level: 'warning' as const, message: 'same fault', page: 'p1', node: null, key: null }
  const a = mountExport({ verdict: s => ({ ...checkScene(s), warnings: [{ message: 'same scene fault', ref: { inDefs: false, path: [0] } }, { message: 'same scene fault', ref: { inDefs: false, path: [0] } }] }) })
  await a.check(report({ issues: [warning, warning] }))
  expect(a.ui.container.textContent?.match(/same fault/g)).toHaveLength(2)
  expect(a.ui.container.textContent?.match(/same scene fault/g)).toHaveLength(2)
  expect(a.ui.container.textContent).toContain('read trap in report')
})
