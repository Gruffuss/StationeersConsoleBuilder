// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { mount, run as actRun } from '../testing'
import { initialState, reducer } from '../model/store'
import { ROLES, STYLES, THEMES, themeOf, type Theme } from '../theme'
import { themeFileOf } from '../theme/file'
import { themePrompt } from '../theme/prompt'
import { autoChoices } from '../theme/import/match'
import * as matcher from '../theme/import/match'
import * as mapper from '../theme/import/map'
import { proposeTheme } from '../theme/import/map'
import { readDesignSystem } from '../theme/import/tokens'
import { storedZip } from '../theme/import/testing'
import { putWidget, NO_CTX, sanitize } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import * as fonts from './fonts'
import { ThemeImport } from './ThemeImport'

const fixture = (path: string) => new Uint8Array(readFileSync(`${import.meta.dirname}/../../test/fixtures/design-systems/vanilla-plus/project/${path}`))
const files = () => new Map([['tokens.json', fixture('tokens.json')], ['components/bundle.css', fixture('components/bundle.css')]])
const tokens = () => new TextDecoder().decode(fixture('tokens.json'))
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }
let ui: ReturnType<typeof mount> | undefined
// A test that times out leaves its act() open, and React then holds every later render in that act's queue, so each
// later test would see an empty panel. Each act here is ended, and awaited, when its test ends: one failure stays one.
const open = new Map<Promise<void>, () => void>()
const run = (f: () => void | Promise<void>) => {
  let end = () => {}
  const done = actRun(() => new Promise<void>((resolve, reject) => { end = resolve; Promise.resolve().then(f).then(resolve, reject) }))
  open.set(done, end)
  return done.finally(() => open.delete(done))
}
afterEach(async () => {
  for (const end of open.values()) end()
  await Promise.allSettled(open.keys())
  ui?.unmount(); ui = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function panel(names = new Map<string, string>()) {
  let state = initialState()
  const t = THEMES.neutral, m = WIDGETS.panel, ref = { type: 'panel', uid: 'pnl1', params: sanitize(m, m.defaults(t, NO_CTX), t) }
  state = reducer(state, { type: 'setScene', pageId: state.activePageId, scene: putWidget(state.project.pages[0].scene, ref, t) })
  const onKeep = vi.fn((_theme: Theme) => true), onAdd = vi.fn((theme) => { state = reducer(state, { type: 'addTheme', theme }) })
  ui = mount(<ThemeImport names={names} taken={new Set(['neutral', 'vanilla-plus'])} pages={state.project.pages} onAdd={onAdd} onKeep={onKeep} />)
  const box = ui.container
  const field = (name: string) => box.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${name}"]`)!
  const type = (name: string, text: string) => run(() => {
    const input = field(name)
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  const click = (name: string) => run(async () => { Array.from(box.querySelectorAll('button')).find(b => b.textContent === name)!.click(); await settle() })
  const pick = (name: string, picked: File[]) => run(async () => {
    Object.defineProperty(field(name), 'files', { configurable: true, value: picked })
    field(name).dispatchEvent(new Event('change', { bubbles: true })); await settle()
  })
  const paste = async (text = tokens()) => { await type('Tokens or theme JSON', text); await click('Read JSON') }
  return { box, field, type, click, pick, paste, onAdd, onKeep, state: () => state,
    refresh: (themes: readonly Theme[]) => ui!.rerender(<ThemeImport names={new Map([...names, ...themes.map(t => [t.id, t.name] as const)])}
      taken={new Set(['neutral', 'vanilla-plus', ...themes.map(t => t.id)])} pages={state.project.pages} onAdd={onAdd} onKeep={onKeep} />),
    undo: () => { state = reducer(state, { type: 'undo' }) } }
}
it('pastes the worked example, adds CSS, changes all mappings and adds a theme in one undo step', async () => {
  const p = panel(), before = p.state().project
  await p.paste()
  await p.pick('Zip or files', [new File([fixture('components/bundle.css') as Uint8Array<ArrayBuffer>], 'bundle.css')])
  expect(p.box.textContent).toContain('26 of 26 roles matched')
  expect(p.box.querySelectorAll('[data-role]')).toHaveLength(26)
  expect(p.box.querySelectorAll('[data-style]')).toHaveLength(11)
  for (const role of ROLES) expect(p.field('Colour token for ' + role)).not.toBeNull()
  for (const style of STYLES) expect(p.field('Design-system style for ' + style)).not.toBeNull()
  await p.type('Colour token for accent', 'danger')
  expect(p.box.querySelector('[data-role="accent"]')!.textContent).toContain('#B93237')
  await p.type('CSS rule for panel', '.ss-row')
  await p.type('Length token for space.4', 'space-1')
  await p.click('Add theme')
  const t = themeOf(p.state().project)
  expect(t.colors.accent).toBe('#B93237FF')
  expect(t.geo.space[4]).toBe(4)
  expect(p.state().project.pages[0].scene).not.toEqual(before.pages[0].scene)
  expect(p.state().project.themes![t.id]).toEqual(t)
  p.undo(); expect(p.state().project).toEqual(before)
})
it('a theme file keeps its own values and reports player sources', async () => {
  const p = panel(); await p.paste(JSON.stringify(themeFileOf(THEMES['vanilla-plus'])))
  expect(p.box.textContent).toContain('from player')
  expect(p.box.textContent).toContain('156')
  await p.click('Add theme')
  expect({ ...p.onAdd.mock.calls[0][0], id: 'vanilla-plus', name: 'Vanilla +' }).toEqual(THEMES['vanilla-plus'])
})
it('remembers theme-file role choices across rerenders and unchanged Read JSON', async () => {
  const p = panel(); await p.paste(JSON.stringify(themeFileOf(THEMES['vanilla-plus'])))
  await p.type('Colour token for border', 'accent')
  expect(p.field('Colour token for border').value).toBe('accent')
  expect(p.box.querySelector('[data-role="border"]')!.textContent).toContain(THEMES['vanilla-plus'].colors.accent.slice(0, 7))
  await p.type('Design-system link', 'https://files.example/project/')
  await p.click('Read JSON')
  expect(p.field('Colour token for border').value).toBe('accent')
  await p.click('Add theme')
  expect(p.onAdd.mock.calls[0][0].colors.border).toBe(THEMES['vanilla-plus'].colors.accent)
  await p.type('Colour token for border', ''); await p.click('Read JSON')
  expect(p.field('Colour token for border').value).toBe('')
  await p.click('Add theme')
  expect(p.onAdd.mock.calls[1][0].colors.border).toBe(THEMES.neutral.colors.border)
})
it('the link route fails clearly and keeps the other routes available', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')); vi.stubGlobal('fetch', fetcher)
  const p = panel(); await p.type('Design-system link', 'https://claude.ai/artifacts/test'); await p.click('Fetch')
  expect(p.box.textContent).toContain('network or CORS failure')
  expect(p.field('Tokens or theme JSON')).not.toBeNull()
  expect(p.box.textContent).toContain('Copy prompt')
  expect(fetcher.mock.calls.map(c => c[0])).toEqual(['https://claude.ai/artifacts/test'])
})
it('the link route works if CORS ever comes', async () => {
  const data = files()
  const fetcher = vi.fn(async (url: string) => { const path = url.split('/project/')[1]; return data.has(path) ? new Response(data.get(path) as Uint8Array<ArrayBuffer>) : new Response('', { status: 404 }) })
  vi.stubGlobal('fetch', fetcher)
  const p = panel(); await p.type('Design-system link', 'https://files.example/project/'); await p.click('Fetch')
  expect(p.box.textContent).toContain('26 of 26 roles matched')
  expect(fetcher.mock.calls.map(c => c[0])).toEqual(['tokens.json', 'design-system.json', 'README.md', 'components/bundle.css', 'components/bundle.js'].map(path => 'https://files.example/project/' + path))
})
it.each(['network', 'redirect'])('removes the previous mapping after a failed %s fetch', async failure => {
  const fetcher = vi.fn().mockResolvedValue(new Response(tokens())); vi.stubGlobal('fetch', fetcher)
  const p = panel(); await p.type('Design-system link', 'https://claude.ai/artifacts/good'); await p.click('Fetch')
  expect(p.box.querySelector('[aria-label="Theme mapping"]')).not.toBeNull()
  if (failure === 'network') fetcher.mockRejectedValue(new TypeError('Failed to fetch'))
  else fetcher.mockResolvedValue(new Response('', { status: 302 }))
  await p.type('Design-system link', 'https://claude.ai/artifacts/bad'); await p.click('Fetch')
  expect(p.box.textContent).toContain(failure === 'network' ? 'network or CORS failure' : 'redirect')
  expect(p.box.querySelector('[aria-label="Theme mapping"]')).toBeNull()
  expect(Array.from(p.box.querySelectorAll('button')).some(b => b.textContent === 'Add theme')).toBe(false)
})
it('a zip and nested dropped folder reach the mapping screen', async () => {
  const p = panel()
  await p.pick('Zip or files', [new File([storedZip(files()) as Uint8Array<ArrayBuffer>], 'design.zip')])
  expect(p.box.textContent).toContain('26 of 26 roles matched')
  await p.click('Clear files')
  const entry = { name: 'tokens.json', isFile: true, file: (ok: (f: File) => void) => ok(new File([tokens()], 'tokens.json')) }
  const folder = { name: 'project', isDirectory: true, createReader: () => { let done = false; return { readEntries: (ok: (e: object[]) => void) => { ok(done ? [] : [entry]); done = true } } } }
  await run(async () => {
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { items: [{ kind: 'file', webkitGetAsEntry: () => folder }], files: [] } })
    p.box.querySelector('[aria-label="Drop design-system files"]')!.dispatchEvent(event); await settle()
  })
  expect(p.box.textContent).toContain('26 of 26 roles matched')
})
it('the prompt includes the supplied link, with selectable text if clipboard fails', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', { clipboard: { writeText } })
  const p = panel(); await p.type('Design-system link', 'https://claude.ai/artifacts/test'); await p.click('Copy prompt')
  expect(writeText).toHaveBeenCalledWith(themePrompt() + '\n\nDesign system: https://claude.ai/artifacts/test')
  writeText.mockRejectedValue(Error('clipboard refused')); await p.click('Copy prompt')
  expect(p.field('Prompt to copy').value).toContain(themePrompt())
  expect(p.box.textContent).toContain('clipboard refused')
})
it.each(['Document is not focused.', 'Document is not focused'])('ends the copy failure reason once: %s', async message => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(Error(message)) } })
  const p = panel(); await p.click('Copy prompt')
  expect(p.box.querySelector('[role="status"]')!.textContent).toBe('Copy failed: Document is not focused. Select the prompt text and copy it.')
  expect(p.field('Prompt to copy').value).toBe(themePrompt())
})
it('shipped Fonts-mod faces stay outside the theme and are not imported again', async () => {
  const fontImport = vi.spyOn(fonts, 'importFont').mockResolvedValue(true)
  const p = panel(); await p.paste()
  const ds = readDesignSystem(files())
  const shipped = ds.fonts.map(f => { const file = new File(['font bytes'], f.path!.split('/').at(-1)!); Object.defineProperty(file, 'webkitRelativePath', { value: 'project/' + f.path }); return file })
  const root = new File([tokens()], 'tokens.json'); Object.defineProperty(root, 'webkitRelativePath', { value: 'project/tokens.json' })
  await p.pick('Design-system folder', [root, ...shipped])
  expect(fontImport).not.toHaveBeenCalled()
  await p.click("Use the design system's font files in this browser")
  expect(fontImport).not.toHaveBeenCalled()
  await p.click('Add theme')
  expect(JSON.stringify(p.onAdd.mock.calls[0][0])).not.toContain('font bytes')
})
it('shows full reports, base values, anatomy, metrics and shared widget-default fields', async () => {
  const p = panel(); await p.paste()
  await p.pick('Zip or files', [new File([fixture('components/bundle.css') as Uint8Array<ArrayBuffer>], 'bundle.css')])
  const ds = readDesignSystem(files()), expected = proposeTheme(ds, autoChoices(ds), new Set()).report
  for (const line of [...expected.cannotDraw, ...expected.dropped, ...expected.notes]) expect(p.box.textContent).toContain(line)
  expect(p.box.textContent).toContain('from Neutral')
  expect(p.box.textContent).toContain('hero.unitY')
  expect(p.box.textContent).toContain('Anatomy')
  await p.type('panel title', 'Imported title')
  await run(() => { p.field('panel title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  await p.click('Keep in this browser'); expect(p.onKeep).toHaveBeenCalledOnce()
  await p.click('Add theme'); expect(p.onAdd.mock.calls[0][0].widgetDefaults.panel).toEqual({ title: 'Imported title' })
})
it('can be hosted in an open dialog without a collapsed root disclosure', async () => {
  const p = panel(), dialog = document.createElement('dialog'); dialog.open = true
  p.box.parentNode!.insertBefore(dialog, p.box); dialog.append(p.box)
  try {
    expect(p.field('Design-system link').closest('details:not([open])')).toBeNull()
    expect(p.box.querySelector('.vb-theme-import')!.tagName).toBe('SECTION')
    await p.paste()
    expect(p.box.querySelector('[role="group"][aria-label="Drop design-system files"]')).not.toBeNull()
    expect(p.box.querySelector('[role="img"][aria-label="accent swatch"]')).not.toBeNull()
    await p.click('Add theme'); expect(p.onAdd).toHaveBeenCalledOnce()
  } finally { dialog.replaceWith(p.box) }
})
it('theme-file missing values keep base sources and named sanitizer notes', async () => {
  const p = panel(); await p.paste(JSON.stringify({ format: 'vectorbuilder-theme', v: 1, theme: { name: 'Partial', colors: { accent: '#123456', text: 'invalid' } } }))
  expect(p.box.querySelector('[data-source="colors.accent"]')!.textContent).toBe('from player')
  expect(p.box.querySelector('[data-source="colors.text"]')!.textContent).toBe('from Neutral')
  expect(p.box.textContent).toContain('theme.colors.text')
})
it('failed reads and storage preserve the prior mapping; Stop ignores a late reply', async () => {
  let reply: (r: Response) => void = () => {}; vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { reply = r })))
  const p = panel(); await p.paste(); await p.type('Design-system link', 'https://claude.ai/artifacts/test'); await p.click('Fetch')
  await p.click('Stop reading')
  await run(async () => { reply(new Response('{}')); await settle() })
  expect(p.box.textContent).toContain('26 of 26 roles matched')
  await p.type('Tokens or theme JSON', '{broken'); await p.click('Read JSON')
  expect(p.box.textContent).toContain('JSON:')
  expect(p.box.textContent).toContain('26 of 26 roles matched')
  p.onKeep.mockReturnValue(false); await p.click('Keep in this browser')
  expect(p.box.textContent).toContain('browser storage unavailable')
  await p.click('Add theme'); expect(p.onAdd).toHaveBeenCalledOnce()
})
it('offers CSS-matched widget defaults and reports text the widget cannot keep', async () => {
  const p = panel(); await p.paste()
  await p.pick('Zip or files', [new File([fixture('components/bundle.css') as Uint8Array<ArrayBuffer>], 'bundle.css')])
  expect(p.field('bar marks')).not.toBeNull()
  await p.type('panel title', '$binding')
  await run(() => { p.field('panel title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(p.box.querySelector('[role="alert"]')!.textContent).toContain('a label cannot start with $')
  await p.type('button h', '1')
  await run(() => { p.field('button h').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(p.box.querySelector('.vb-theme-mapping')!.textContent).toContain('theme.widgetDefaults.button.h: widget sanitizer changes this value; dropped')
})
it('keeps project page references out of reusable widget defaults', async () => {
  const p = panel(); await p.paste()
  await p.pick('Zip or files', [new File(['.tabs {background: var(--surface-panel)}'], 'bundle.css')])
  expect(p.field('tabs tabs 1 page')).toBeNull()
  expect(p.field('tabs active')).toBeNull()
  expect(p.box.textContent).toContain('Page links belong to the project; set them in the Widget panel.')
  await p.type('tabs gap', '12')
  await run(() => { p.field('tabs gap').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  await p.click('Add theme')
  expect(p.onAdd.mock.calls[0][0].widgetDefaults.tabs).toEqual({ gap: 12 })
})

it('imports exactly needed file faces from a variable file and keeps local faces', async () => {
  const fontImport = vi.spyOn(fonts, 'importFont').mockResolvedValue(true)
  vi.spyOn(fonts, 'importedFonts').mockReturnValue(['Variable Test Bold'])
  const data = JSON.parse(tokens())
  data.type.families = { display: 'Variable Test', body: 'Variable Test' }
  data.type.fonts = [{ family: 'Variable Test', file: 'variable.woff2', weight: '100 900' }]
  const p = panel(); await p.paste(JSON.stringify(data))
  const font = new File(['font bytes'], 'variable.woff2'); Object.defineProperty(font, 'webkitRelativePath', { value: 'fonts/variable.woff2' })
  await p.pick('Zip or files', [font])
  const ds = readDesignSystem(new Map([['tokens.json', new TextEncoder().encode(JSON.stringify(data))], ['fonts/variable.woff2', new TextEncoder().encode('font bytes')]]))
  const report = proposeTheme(ds, autoChoices(ds), new Set(), new Set(['Variable Test Bold'])).report
  expect(report.fonts.filter(f => f.supplied === 'file').length).toBeGreaterThan(0)
  expect(report.fonts.some(f => f.face === 'Variable Test Bold' && f.supplied === 'local')).toBe(true)
  expect(p.box.textContent).toContain('a file in the design system')
  await p.click("Use the design system's font files in this browser")
  expect(fontImport.mock.calls.map(c => c[0])).toEqual(report.fonts.filter(f => f.supplied === 'file').map(f => f.face))
  expect(fontImport.mock.calls.every(c => [400, 500, 600].includes(c[4]!))).toBe(true)
  expect(p.box.textContent).toContain('Variable Test Bold: this browser already has a local face; kept existing font')
})

it.each(['autoChoices', 'proposeTheme'] as const)('contains a %s throw in the mapping and keeps the read routes', async method => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const p = panel()
  const fail = method === 'autoChoices' ? vi.spyOn(matcher, method) : vi.spyOn(mapper, method)
  fail.mockImplementation(() => { throw Error('hostile mapping') })
  await p.paste()
  expect(p.box.textContent).toContain('Mapping could not be read here: hostile mapping')
  expect(p.field('Design-system link')).not.toBeNull()
  expect(p.field('Tokens or theme JSON')).not.toBeNull()
  expect(p.onAdd).not.toHaveBeenCalled()
  fail.mockRestore(); await p.paste()
  expect(p.box.textContent).toContain('26 of 26 roles matched')
})

it('drops project links already present in a theme file with named notes', async () => {
  const p = panel(), file = themeFileOf(THEMES.neutral)
  file.theme.widgetDefaults = { tabs: { active: 'p1', tabs: [{ label: 'Main', page: 'p1', key: 0 }], gap: 12 } }
  await p.paste(JSON.stringify(file)); await p.click('Keep in this browser')
  expect(p.onKeep.mock.calls[0][0].widgetDefaults!.tabs).toEqual({ gap: 12 })
  expect(p.box.textContent).toContain('theme.widgetDefaults.tabs.active: project references dropped')
  expect(p.box.textContent).toContain('theme.widgetDefaults.tabs.tabs: project references dropped')
})

it('keeps player mappings and defaults when a second file adds automatic matches', async () => {
  const p = panel(); await p.paste()
  await p.type('Colour token for accent', 'danger')
  await p.type('CSS rule for panel', '')
  await p.type('Theme name', 'My mapping')
  await p.pick('Zip or files', [new File([fixture('components/bundle.css') as Uint8Array<ArrayBuffer>], 'bundle.css')])
  expect(p.field('Colour token for accent').value).toBe('danger')
  expect(p.field('CSS rule for panel').value).toBe('')
  expect(p.field('CSS rule for row').value).not.toBe('')
  expect(p.field('Theme name').value).toBe('My mapping')
  await p.type('panel title', 'Remembered')
  await run(() => { p.field('panel title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  await p.pick('Zip or files', [new File(['Read me'], 'README.md')])
  await p.click('Add theme')
  expect(p.onAdd.mock.calls[0][0].widgetDefaults.panel).toEqual({ title: 'Remembered' })
})

it('counts supplied theme-file roles separately from base-filled roles', async () => {
  const p = panel(); await p.paste(JSON.stringify({ format: 'vectorbuilder-theme', v: 1, theme: { name: 'Partial', colors: { accent: '#123456', text: 'invalid' } } }))
  expect(p.box.textContent).toContain('1 of 26 roles supplied; the rest from Neutral')
  expect(p.box.textContent).not.toContain('26 of 26 roles matched')
})
it('copies the prompt alone when the link is empty', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', { clipboard: { writeText } })
  const p = panel(); await p.click('Copy prompt')
  expect(writeText).toHaveBeenCalledWith(themePrompt())
  expect(p.field('Prompt to copy').value).not.toContain('Design system:')
})
it('names a theme file that takes precedence over dropped design-system files', async () => {
  const p = panel()
  await p.pick('Zip or files', [new File([tokens()], 'tokens.json'), new File([JSON.stringify(themeFileOf(THEMES['vanilla-plus']))], 'stray-theme.json')])
  expect(p.box.textContent).toContain('stray-theme.json: selected as a theme file; its own values take precedence over design-system tokens and CSS')
})
it('shows browser availability for a theme-file local face', async () => {
  vi.spyOn(fonts, 'importedFonts').mockReturnValue(['Variable Test Bold'])
  const p = panel(), file = themeFileOf(THEMES.neutral)
  file.theme.type!.hero.font = 'Variable Test Bold'
  await p.paste(JSON.stringify(file))
  expect(p.box.querySelector('[data-style="hero"]')!.textContent).toContain('this browser')
})

it('gives the drop group and colour swatches accessible roles', async () => {
  const p = panel(); await p.paste()
  expect(p.box.querySelector('[role="group"][aria-label="Drop design-system files"]')).not.toBeNull()
  expect(p.box.querySelector('[role="img"][aria-label="accent swatch"]')).not.toBeNull()
})

it('leaves the option lists alone while the theme name is typed', async () => {
  const p = panel(); await p.paste()
  await p.pick('Zip or files', [new File([fixture('components/bundle.css') as Uint8Array<ArrayBuffer>], 'bundle.css')])
  // React keeps a host element's props object until it renders that element again; a reused element keeps it.
  const lists = ['Colour token for', 'Design-system style for', 'CSS type rule for', 'CSS rule for', 'Length token for']
  const props = () => Array.from(p.box.querySelectorAll(lists.map(l => `select[aria-label^="${l}"] option`).join(', ')))
    .filter(o => !o.hasAttribute('value')).map(o => (o as unknown as Record<string, unknown>)[Object.keys(o).find(k => k.startsWith('__reactProps$'))!])
  const before = props()
  expect(before.length).toBeGreaterThan(1000)
  await p.type('Theme name', 'Renamed')
  expect(p.field('Theme name').value).toBe('Renamed')
  const after = props()
  expect(after).toHaveLength(before.length)
  expect(after.filter((x, i) => x !== before[i])).toHaveLength(0)
})
it('ends a mapping error that has its own full stop with one full stop', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const p = panel(); vi.spyOn(mapper, 'proposeTheme').mockImplementation(() => { throw Error('the token list is unreadable. ') })
  await p.paste()
  expect(p.box.textContent).toContain('Mapping could not be read here: the token list is unreadable. Choose files or read JSON again.')
})
it('contains a mapping error even when its message is empty', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const p = panel(); vi.spyOn(mapper, 'proposeTheme').mockImplementation(() => { throw Error('') })
  await p.paste()
  expect(p.box.querySelector('[role="status"]')!.parentNode).not.toBeNull()
  expect(p.box.textContent).toContain('Mapping could not be read here. Choose files or read JSON again.')
  expect(p.field('Tokens or theme JSON')).not.toBeNull()
})
it('an explicitly fetched replacement starts a new mapping', async () => {
  const p = panel(); await p.paste(); await p.type('Colour token for accent', 'danger')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(tokens())))
  await p.type('Design-system link', 'https://claude.ai/artifacts/new'); await p.click('Fetch')
  expect(p.field('Colour token for accent').value).toBe('accent')
})
it('reads the pasted tokens together with dropped CSS without Read JSON', async () => {
  const p = panel(); await p.type('Tokens or theme JSON', tokens())
  await p.pick('Zip or files', [new File([fixture('components/bundle.css') as Uint8Array<ArrayBuffer>], 'bundle.css')])
  expect(p.box.textContent).toContain('Mapping: Vanilla +')
  expect(p.box.textContent).toContain('26 of 26 roles matched')
  expect(p.field('CSS rule for panel').value).toBe('.ss-panel')
})
it('notes pasted JSON precedence and preserves the previous mapping on a malformed paste', async () => {
  const p = panel(); await p.paste()
  await p.pick('Zip or files', [new File(['{}'], 'tokens.json')])
  expect(p.box.textContent).toContain('tokens.json: pasted JSON takes precedence over the selected file')
  await p.type('Tokens or theme JSON', '{broken')
  await p.pick('Zip or files', [new File(['.panel {}'], 'bundle.css')])
  expect(p.box.textContent).toContain('26 of 26 roles matched')
  expect(p.field('Theme name').value).toBe('Vanilla + (imported)')
})
it.each([
  ['Vanilla +', new Map<string, string>(), 'Vanilla + (imported)'],
  ['Workbench', new Map([['ds-project', 'Workbench'], ['ds-library', 'Workbench (imported)']]), 'Workbench (imported 2)'],
] as const)('distinguishes the display name %s and explains the rename', async (name, names, expected) => {
  const p = panel(names), data = JSON.parse(tokens()); data.name = name
  await p.paste(JSON.stringify(data))
  expect(p.field('Theme name').value).toBe(expected)
  const notes = Array.from(p.box.querySelectorAll('h3')).find(h => h.textContent === 'Notes')!.parentElement!
  expect(notes.textContent).toContain('theme.name: ' + JSON.stringify(name) + ' already exists; using ' + JSON.stringify(expected))
  await p.click('Keep in this browser'); await p.click('Add theme')
  expect(p.onKeep.mock.calls[0][0].name).toBe(expected)
  expect(p.onAdd.mock.calls[0][0].name).toBe(expected)
  expect(p.onAdd.mock.calls[0][0].id).toBe(p.onKeep.mock.calls[0][0].id)
  await p.type('Theme name', ''); expect(p.field('Theme name').value).toBe('')
})
it('numbers successive imports without gaps across project and browser names', async () => {
  const p = panel(), saved: Theme[] = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(tokens())))
  await p.type('Design-system link', 'https://claude.ai/artifacts/test')
  for (const name of ['Vanilla + (imported)', 'Vanilla + (imported 2)', 'Vanilla + (imported 3)']) {
    await p.click('Fetch')
    expect(p.field('Theme name').value).toBe(name)
    await p.click('Keep in this browser')
    const kept = p.onKeep.mock.lastCall![0]; saved.push(kept); p.refresh(saved)
    expect(p.field('Theme name').value).toBe(name)
    await p.click('Add theme'); p.refresh(saved)
    expect(p.onAdd.mock.lastCall![0].id).toBe(kept.id)
    expect(p.onAdd.mock.lastCall![0].name).toBe(name)
  }
  expect(new Set(saved.map(t => t.id)).size).toBe(3)
  expect(new Set(saved.map(t => t.name)).size).toBe(3)
})
it('shows readable numbers and opaque colours without changing stored values', async () => {
  const p = panel(); await p.paste()
  await p.pick('Zip or files', [new File([fixture('components/bundle.css') as Uint8Array<ArrayBuffer>], 'bundle.css')])
  expect(p.box.querySelector('[data-style="screen-title"] dl')!.textContent).toContain('4.17')
  expect(p.box.querySelector('[data-style="clock"] dl')!.textContent).toContain('3.57')
  expect(p.box.querySelector('[data-style="panel-title"] dl')!.textContent).toContain('5.77')
  expect(p.box.querySelector('[data-style="screen-title"] dl')!.textContent).not.toContain('4.166666507720947')
  expect(p.box.querySelector('[data-role="surface-screen-hi"] td')!.textContent).not.toContain('#3A3A43FF')
  await p.click('Add theme')
  expect(p.onAdd.mock.calls[0][0].type['screen-title'].cspace).toBe(Math.fround(100 / 24))
  expect(p.onAdd.mock.calls[0][0].colors['surface-screen-hi']).toBe('#3A3A43FF')
})

it('keeps visible alpha and tiny nonzero lengths while formatting their display', async () => {
  const p = panel(), file = themeFileOf(THEMES.neutral); file.theme.name = 'Human values'
  file.theme.colors = { ...file.theme.colors, accent: '#12345680' }
  file.theme.geo = { ...THEMES.neutral.geo, space: { ...THEMES.neutral.geo.space, 1: 0.001234567 } }
  await p.paste(JSON.stringify(file))
  expect(p.box.querySelector('[data-role="accent"] td')!.textContent).toContain('#12345680')
  const length = Array.from(p.box.querySelectorAll('dt')).find(dt => dt.textContent!.startsWith('space.1 '))!
  expect(length.nextElementSibling!.textContent).toBe('0.00123')
  await p.click('Add theme')
  expect(p.onAdd.mock.calls[0][0].geo.space[1]).toBe(0.001234567)
})
it('offers Add and Keep before the long mapping as well as at its end', async () => {
  const p = panel(); await p.paste()
  const mapping = p.box.querySelector('.vb-theme-mapping')!, colours = Array.from(mapping.querySelectorAll('h3')).find(h => h.textContent === 'Colours')!
  const add = Array.from(mapping.querySelectorAll('button')).filter(b => b.textContent === 'Add theme')
  const keep = Array.from(mapping.querySelectorAll('button')).filter(b => b.textContent === 'Keep in this browser')
  expect(add).toHaveLength(2); expect(keep).toHaveLength(2)
  expect(add[0].compareDocumentPosition(colours) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await run(() => add[0].click()); expect(p.onAdd).toHaveBeenCalledOnce()
  await run(() => keep[0].click()); expect(p.onKeep).toHaveBeenCalledOnce()
})

it('editing, adding and removing list defaults stores only the changed list parameter', async () => {
  const p = panel(); await p.paste()
  await p.pick('Zip or files', [new File([fixture('components/bundle.css') as Uint8Array<ArrayBuffer>], 'bundle.css')])
  await p.type('button states 1 label', 'Custom')
  await run(() => { p.field('button states 1 label').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  await p.click('Add theme')
  expect(Object.keys(p.onAdd.mock.calls[0][0].widgetDefaults.button)).toEqual(['states'])
  expect(p.onAdd.mock.calls[0][0].widgetDefaults.button.states[0].label).toBe('Custom')
  await p.click('Add button states'); await p.click('Add theme')
  expect(Object.keys(p.onAdd.mock.calls[1][0].widgetDefaults.button)).toEqual(['states'])
  expect(p.onAdd.mock.calls[1][0].widgetDefaults.button.states).toHaveLength(2)
  await p.click('Remove button states 2'); await p.click('Keep in this browser')
  expect(Object.keys(p.onKeep.mock.calls[0][0].widgetDefaults!.button)).toEqual(['states'])
  expect(p.onKeep.mock.calls[0][0].widgetDefaults!.button.states).toHaveLength(1)
})
it('reports the native vector face as built in instead of missing', async () => {
  const p = panel(), file = themeFileOf(THEMES.neutral); file.theme.name = 'Native faces'
  await p.paste(JSON.stringify(file))
  expect(p.box.querySelector('[data-style="hero"]')!.textContent).toContain('Built-in vector font')
  expect(p.box.querySelector('[data-style="hero"]')!.textContent).not.toContain('none; use the Fonts panel')
})
it('says None under an empty Notes report', async () => {
  const p = panel(), file = themeFileOf(THEMES.neutral); file.theme.name = 'Clean theme'
  await p.paste(JSON.stringify(file))
  const notes = Array.from(p.box.querySelectorAll('h3')).find(h => h.textContent === 'Notes')!.parentElement!
  expect(notes.textContent).toBe('NotesNone.')
})
