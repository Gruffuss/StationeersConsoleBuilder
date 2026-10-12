// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { PageFontPanel } from './PageFontPanel'
import { ExampleScripts } from '../ExampleScripts'
import { newProject, newPage } from '../model/project'
import { initialState, reducer } from '../model/store'
import { mount, run } from '../testing'
import { configurePageFonts, getPageFontRecord } from './pageFonts'
import type { CoreBridge } from '../runtime/bridge'
import { generate } from '../codegen/generate'
import { printSrc } from '../srctext/print'
import { TextLayer } from './TextLayer'
import { label } from '../runtime/testing'

const input = vi.hoisted(() => ({ link: '' }))
vi.mock('./ExamplePicker', async original => {
  const m = await original<typeof import('./ExamplePicker')>()
  return { ...m, projectOf: (name: string) => {
    const p = m.projectOf(name)
    p.pages[0].scene.defs.push({ op: 'FONT', attrs: { src: input.link } })
    return p
  } }
})
const asset = 'https://fonts.gstatic.com/s/control.woff2'
const css = `@font-face { font-family: Control; font-weight: 400; src: url("${asset}") format("woff2"); }`
const metadata = vi.fn(async () => ({})), register = vi.fn(async () => ['Control', 'Control', 'Control Bold'])
configurePageFonts({ readFontMetadata: metadata, registerPageFonts: register })
beforeEach(() => {
  metadata.mockClear(); register.mockClear()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('examples/') ? new Response('lua') : new Response(url === asset ? new Uint8Array([1]) : css)))
})
afterEach(() => vi.unstubAllGlobals())
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }

it.each(['https://fonts.googleapis.com/css2?family=UiControl', 'http://fonts.googleapis.com/css2?family=BlockedControl'])('loaded/shared project, edits, page switches, history and export never consent: %s', async link => {
  let state = initialState()
  state.project.pages.push(newPage(state.project))
  state.project.pages[0].scene.defs.push({ op: 'FONT', attrs: { src: link } })
  state.project.pages[1].scene.defs.push({ op: 'FONT', attrs: { src: 'https://fonts.googleapis.com/css2?family=Inactive' } })
  state = reducer(state, { type: 'loadProject', project: Object.assign(state.project, { fontsApproved: true }) })
  const draw = () => <PageFontPanel page={state.project.pages.find(p => p.id === state.activePageId)!} project={state.project} />
  const ui = mount(draw())
  const before = generate(state.project, p => printSrc(p.scene))
  try {
    for (const action of [{ type: 'setActivePage', pageId: 'p2' }, { type: 'setActivePage', pageId: 'p1' },
      { type: 'setScene', pageId: 'p1', scene: { ...state.project.pages[0].scene } }, { type: 'undo' }, { type: 'redo' }] as const) {
      state = reducer(state, action)
      await run(() => ui.rerender(draw()))
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(getPageFontRecord(link)).toBeUndefined()
    await run(async () => { ui.container.querySelector<HTMLButtonElement>('button')!.click(); await settle() })
    const allowed = link.startsWith('https:')
    expect(getPageFontRecord(link)?.state).toBe(allowed ? 'loaded' : 'refused')
    expect(vi.mocked(fetch).mock.calls.map(c => c[0])).toEqual(allowed ? [link, asset] : [])
    expect(getPageFontRecord('https://fonts.googleapis.com/css2?family=Inactive')).toBeUndefined()
    if (allowed) expect(ui.container.textContent).toContain('2 delivered face names: Control, Control Bold')
    expect(generate(state.project, p => printSrc(p.scene))).toEqual(before)
  } finally { ui.unmount() }
})

it.each(['https://fonts.googleapis.com/css2?family=RawControl', 'https://evil.example/font.ttf'])('raw example selection requires its own explicit click: %s', async link => {
  input.link = link
  const bridge = { load: vi.fn() }
  const ui = mount(<ExampleScripts bridge={bridge as unknown as CoreBridge} />)
  try {
    await run(async () => {
      const select = ui.container.querySelector('select')!
      select.value = '01-hello'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    })
    expect(bridge.load).toHaveBeenCalledOnce()
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
    expect(getPageFontRecord(link)).toBeUndefined()
    await run(async () => { ui.container.querySelector<HTMLButtonElement>('button')!.click(); await settle() })
    expect(getPageFontRecord(link)?.state).toBe(link.includes('googleapis') ? 'loaded' : 'refused')
    // The earlier project test populated the session's representative metadata cache.
    expect(vi.mocked(fetch).mock.calls.map(c => c[0]).slice(1)).toEqual(link.includes('googleapis') ? [link] : [])
    expect(metadata).not.toHaveBeenCalled()
  } finally { ui.unmount() }
})

it('refreshes text warnings from unrequested through pending to failed without changing export', async () => {
  const p = newProject(), link = 'https://fonts.googleapis.com/css2?family=PendingControl'
  p.pages[0].scene.defs.push({ op: 'FONT', attrs: { src: link } })
  let respond!: (r: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { respond = r })))
  const ui = mount(<><PageFontPanel page={p.pages[0]} project={p} />
    <TextLayer labels={[label({ font: 'Unmatched' })]} zoom={1} scene={p.pages[0].scene} /></>)
  const before = generate(p, pg => printSrc(pg.scene)), note = () => ui.container.querySelector('.vb-font-missing')!.textContent
  try {
    expect(note()).toContain("Load this page's fonts to preview them")
    await run(() => ui.container.querySelector<HTMLButtonElement>('button')!.click())
    expect(note()).toContain('Page fonts loading')
    expect(generate(p, pg => printSrc(pg.scene))).toEqual(before)
    await run(async () => { respond(new Response('bad', { status: 400 })); await settle() })
    expect(note()).toContain('Delivered face names: none.')
    expect(note()).toContain('HTTP 400')
    expect(generate(p, pg => printSrc(pg.scene))).toEqual(before)
  } finally { ui.unmount() }
})
it('announces an early Retry click and the time it becomes available without fetching again', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })))
  const p = newProject(), link = 'https://fonts.googleapis.com/css2?family=RetryNotice'
  p.pages[0].scene.defs.push({ op: 'FONT', attrs: { src: link } })
  const ui = mount(<PageFontPanel page={p.pages[0]} project={p} />)
  try {
    await run(async () => { ui.container.querySelector<HTMLButtonElement>('button')!.click(); await vi.advanceTimersByTimeAsync(0) })
    expect(getPageFontRecord(link)?.state).toBe('failed')
    vi.setSystemTime(59_000)
    await run(async () => { ui.container.querySelector<HTMLButtonElement>('button')!.click(); await vi.advanceTimersByTimeAsync(0) })
    expect(ui.container.textContent).toContain('Retry not yet available')
    expect(ui.container.textContent).toContain('in 1 second')
    expect(ui.container.textContent).toContain(new Date(60_000).toLocaleTimeString())
    expect(fetch).toHaveBeenCalledOnce()
  } finally { ui.unmount(); vi.useRealTimers() }
})
