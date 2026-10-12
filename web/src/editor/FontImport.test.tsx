// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { FontImport } from './FontImport'
import { importedFonts, importFont, registerPageFonts, removeFont, setFontMetadataReader } from './fonts'
import { initialState, reducer } from '../model/store'
import { idb, mount, run } from '../testing'

/** Fake the independent metadata boundary; binary parsing belongs to the reader suite. */
const metadataBytes = (name: string) => new TextEncoder().encode(JSON.stringify({ status: 'ok', names: {}, axes: [], faces: [], family: name.replace(/ Regular$/, ''), style: 'Regular', instances: [] })).buffer

/** A file whose read waits for, or fails with, what the test says. */
const fileReading = (name: string, read: () => Promise<ArrayBuffer>) => {
  const f = new File([], name)
  Object.defineProperty(f, 'arrayBuffer', { value: read })
  return f
}

// Every step of an import (the file read, FontFace, the fake IndexedDB) answers within a few tasks.
const settle = async () => { for (let k = 0; k < 10; k++) await new Promise(r => setTimeout(r, 0)) }

/** The panel, and what a player does with it. */
function panel() {
  const ui = mount(<FontImport />)
  const $ = <T extends Element = HTMLElement>(s: string) => ui.container.querySelector<T>(s)
  return {
    $, unmount: ui.unmount,
    name: () => $<HTMLInputElement>('input[type=text]')!,
    importButton: () => $<HTMLButtonElement>('button')!,
    status: () => $('[role=status]')!.textContent,
    alert: () => $('[role=alert]')?.textContent,
    pick: (f: File) => run(async () => {
      const input = $<HTMLInputElement>('input[type=file]')!
      Object.defineProperty(input, 'files', { configurable: true, value: [f] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await settle()
    }),
    // React tracks an input's value through the prototype setter, so it is set with that before `input` is dispatched.
    type: (text: string) => run(() => {
      const input = $<HTMLInputElement>('input[type=text]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }),
    click: (selector: string) => run(async () => { $<HTMLButtonElement>(selector)!.click(); await settle() }),
  }
}

describe('FontImport', () => {
  it('uses the Fonts section as dialog contents with no inner disclosure', () => {
    const ui = mount(<FontImport />)
    try {
      expect(ui.container.querySelector('details')).toBeNull()
      expect(ui.container.querySelector('section.vb-fonts[aria-label="Fonts"]')).not.toBeNull()
      expect(ui.container.querySelector('.raised')?.textContent).toContain('Which font wins')
    } finally { ui.unmount() }
  })
  const own = Object.getOwnPropertyDescriptor(document, 'fonts')
  let faces: { add: Mock; delete: Mock }
  beforeEach(() => {
    setFontMetadataReader(async data => { try { return JSON.parse(new TextDecoder().decode(data)) } catch { return { status: 'failed', cause: 'metadata unavailable' } } })
    vi.stubGlobal('FontFace', class { constructor(readonly family: string) {} load() { return Promise.resolve(this) } })
    vi.stubGlobal('indexedDB', undefined)   // no storage unless a test brings one: fonts last this session only
    faces = { add: vi.fn(), delete: vi.fn(() => true) }
    Object.defineProperty(document, 'fonts', { configurable: true, value: faces })
  })
  afterEach(async () => {
    for (const n of importedFonts()) await removeFont(n)
    vi.unstubAllGlobals()
    if (own) Object.defineProperty(document, 'fonts', own)
    else delete (document as { fonts?: unknown }).fonts
  })

  it('suggests the file\'s own name, imports it under the name typed, and removes it', async () => {
    const ui = panel()
    await ui.pick(new File([metadataBytes('Manrope Regular')], 'whatever.ttf'))
    expect(ui.name().value).toBe('Manrope')
    await ui.pick(new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], 'Manrope-Bold.woff2'))
    expect(ui.name().value).toBe('Manrope-Bold')
    await ui.type('Manrope Bold')
    await ui.click('button')
    expect(importedFonts()).toEqual(['Manrope Bold'])
    expect(faces.add).toHaveBeenCalledOnce()
    expect(ui.$('li')!.textContent).toContain('Manrope Bold')
    expect(ui.status()).toBe('"Manrope Bold" is in use for this session but not kept: this browser\'s storage could not be reached')
    expect(ui.name().value).toBe('')
    expect(ui.importButton().disabled).toBe(true)
    await ui.click('[aria-label="Remove Manrope Bold"]')
    expect(importedFonts()).toEqual([])
    expect(faces.delete).toHaveBeenCalledWith(faces.add.mock.calls[0][0])
    expect(ui.$('li')).toBeNull()
    expect(ui.$('[aria-label="Remove Manrope Bold"]')).toBeNull()
    expect(ui.status()).toContain('"Manrope Bold" is removed for this session, but this browser\'s storage could not be updated')
    ui.unmount()
  })

  it('keeps a font in the browser with no note, and sends nothing anywhere', async () => {
    const store = idb()
    const sent = vi.fn(() => { throw new Error('nothing may be sent') })
    vi.stubGlobal('indexedDB', store.factory)
    vi.stubGlobal('fetch', sent)
    vi.stubGlobal('XMLHttpRequest', sent)
    const ui = panel()
    await ui.pick(new File([metadataBytes('Inter')], 'inter.ttf'))
    await ui.click('button')
    expect([...store.records.keys()]).toEqual(['Inter'])
    expect(ui.status()).toBe('')
    expect(ui.alert()).toBeUndefined()
    await ui.click('[aria-label="Remove Inter"]')
    expect(store.records.size).toBe(0)
    expect(ui.status()).toBe('')
    expect(sent).not.toHaveBeenCalled()
    ui.unmount()
  })

  it('lists the fonts that arrive or leave from outside it, as the startup load does', async () => {
    const ui = panel()
    await run(async () => { await importFont('Inter', new ArrayBuffer(8), false) })
    expect(ui.$('li')!.textContent).toContain('Inter')
    await run(async () => { await removeFont('Inter') })
    expect(ui.$('li')).toBeNull()
    ui.unmount()
  })

  it('shows why a font is refused, and imports nothing', async () => {
    const ui = panel()
    await ui.pick(new File([metadataBytes('Inter')], 'inter.ttf'))
    vi.stubGlobal('FontFace', class { load() { return Promise.reject(new Error('this file is not a font')) } })
    await ui.type('Inter')
    await ui.click('button')
    expect(ui.alert()).toBe('this file is not a font')
    expect(importedFonts()).toEqual([])
    await ui.pick(fileReading('gone.ttf', () => Promise.reject(new Error('the file could not be read'))))
    expect(ui.alert()).toBe('the file could not be read')
    expect(ui.importButton().disabled).toBe(true)   // no file to import
    ui.unmount()
  })

  it('keeps Import disabled without a file, with a blank name, and while an import is in flight', async () => {
    const ui = panel()
    expect(ui.importButton().disabled).toBe(true)
    await ui.pick(new File([metadataBytes('Inter')], 'inter.ttf'))
    expect(ui.importButton().disabled).toBe(false)
    await ui.type('   ')   // an empty name can only be typed, never imported: importFont's own refusal is not reachable here
    expect(ui.importButton().disabled).toBe(true)
    await ui.type('Inter')
    let loaded!: () => void
    vi.stubGlobal('FontFace', class { load() { return new Promise<void>(r => { loaded = r }) } })
    await ui.click('button')
    expect(ui.importButton().disabled).toBe(true)
    await run(async () => { loaded(); await settle() })
    expect(importedFonts()).toEqual(['Inter'])
    ui.unmount()
  })

  it.each(['removed', 'superseded'] as const)('shows the real reason when a local import is %s while loading', async reason => {
    const ui = panel()
    await ui.pick(new File([metadataBytes('Inter')], 'inter.ttf'))
    let finish!: () => void, calls = 0
    vi.stubGlobal('FontFace', class { load() { return ++calls === 1 ? new Promise<void>(resolve => { finish = resolve }) : Promise.resolve(this) } })
    await ui.click('button')
    await run(async () => {
      if (reason === 'removed') await removeFont('Inter')
      else await importFont('Inter', metadataBytes('Inter'), false)
      finish(); await settle()
    })
    expect(ui.alert()).toContain(reason === 'removed' ? 'import was removed' : 'superseded by a newer import')
    expect(ui.status()).not.toContain('storage could not be reached')
    expect(importedFonts()).toEqual(reason === 'removed' ? [] : ['Inter'])
    ui.unmount()
  })

  it('suggests the latest file\'s name, whichever file is read first', async () => {
    const ui = panel()
    let read!: (b: ArrayBuffer) => void
    await ui.pick(fileReading('Slow.ttf', () => new Promise(r => { read = r })))
    await ui.pick(new File([], 'Fast.ttf'))
    await run(async () => { read(new ArrayBuffer(0)); await settle() })
    expect(ui.name().value).toBe('Fast')
    ui.unmount()
  })

  it('preserves a name edited while the async metadata suggestion is pending and renders names as text', async () => {
    let reply!: (result: import('./fonts').MetadataResult) => void
    setFontMetadataReader(() => new Promise(r => { reply = r }))
    const ui = panel()
    await ui.pick(new File([], 'slow.woff2'))
    await ui.type('<img src=x onerror=alert(1)>')
    await run(async () => { reply({ status: 'ok', names: {}, axes: [], faces: [], family: 'Suggested', style: 'Regular', instances: [] }); await settle() })
    expect(ui.name().value).toBe('<img src=x onerror=alert(1)>')
    setFontMetadataReader(async () => ({ status: 'ok', names: {}, axes: [], faces: [], family: 'Actual', style: 'Regular', instances: [] }))
    await ui.click('button')
    expect(ui.$('img')).toBeNull()
    expect(ui.$('li')!.textContent).toContain('<img src=x onerror=alert(1)>')
    ui.unmount()
  })

  it('aborts superseded and unmounted metadata suggestions', async () => {
    const signals: AbortSignal[] = []
    setFontMetadataReader((_data, signal) => { signals.push(signal!); return new Promise(() => {}) })
    const ui = panel()
    await ui.pick(new File([], 'first.ttf'))
    await ui.pick(new File([], 'second.ttf'))
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    ui.unmount()
    expect(signals[1].aborted).toBe(true)
  })

  it('clears a settled link notice only when Remove deletes its final project declaration', async () => {
    const controller = new AbortController(), link = 'https://fonts.googleapis.com/css2?family=Notice'
    const metadata = { status: 'ok' as const, names: {}, axes: [], faces: [], family: 'Notice face', style: 'Regular', instances: [] }
    const group = { family: 'CSS', style: 'normal', weight: '400', minWeight: 400, maxWeight: 400, representative: 'https://fonts.gstatic.com/notice.woff2',
      sources: [{ url: 'https://fonts.gstatic.com/notice.woff2', unicodeRange: 'U+0-FF', display: 'swap' as const }], metadata }
    vi.stubGlobal('FontFace', class { loaded = new Promise(() => {}); load() { return Promise.resolve(this) } })
    let state = initialState()
    state.project.pages[0].scene.defs.push({ op: 'FONT', attrs: { src: link } }, { op: 'FONT', attrs: { src: link } })
    registerPageFonts(link, [group], () => {}, controller.signal)
    registerPageFonts(link, [{ ...group, metadata: { ...metadata, style: '' } }], () => {}, controller.signal)
    const draw = () => <FontImport page={state.project.pages[0]} project={state.project} dispatch={action => { state = reducer(state, action); ui.rerender(draw()) }} />
    const ui = mount(draw())
    try {
      expect(ui.container.textContent).toContain('different face claimed')
      await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Remove font declaration 1"]')!.click())
      expect(ui.container.textContent).toContain('different face claimed')
      await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Remove font declaration 1"]')!.click())
      expect(ui.container.textContent).not.toContain('different face claimed')
    } finally { ui.unmount(); controller.abort() }
  })
})
