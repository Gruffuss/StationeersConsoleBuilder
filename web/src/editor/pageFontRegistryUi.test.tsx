// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { FontImport } from './FontImport'
import { TextLayer } from './TextLayer'
import { configurePageFonts, getPageFontRecord } from './pageFonts'
import { fontStyle, importFont, isKnownFont, registerPageFonts, removeFont, setFontMetadataReader } from './fonts'
import { newProject } from '../model/project'
import { generate } from '../codegen/generate'
import { printSrc } from '../srctext/print'
import { label } from '../runtime/testing'
import { mount, run } from '../testing'

it('connects loader delivery to the real registry, local precedence and late subset notices', async () => {
  const metadata = { status: 'ok' as const, names: {}, axes: [{ tag: 'wght', min: 400, default: 400, max: 700, name: 'Weight' }], faces: [],
    family: 'UI Registry Face', style: 'Regular', instances: [
      { family: 'UI Registry Face', style: 'Regular', axes: { wght: 400 } }, { family: 'UI Registry Face', style: 'Bold', axes: { wght: 700 } }] }
  const reader = vi.fn(async () => metadata)
  setFontMetadataReader(reader)
  configurePageFonts({ readFontMetadata: reader, registerPageFonts })
  const rejected: ((e: Error) => void)[] = []
  vi.stubGlobal('FontFace', class {
    loaded = new Promise<void>((_, reject) => rejected.push(reject))
    load() { return Promise.resolve(this) }
  })
  const own = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn(), delete: vi.fn() } })
  vi.stubGlobal('indexedDB', undefined)
  const link = 'https://fonts.googleapis.com/css2?family=UIRegistry', asset = 'https://fonts.gstatic.com/ui-registry.woff2'
  vi.stubGlobal('fetch', vi.fn(async url => new Response(url === link
    ? `@font-face { font-family: CSSName; font-weight: 400 700; src: url("${asset}"); }` : new Uint8Array([1]))))
  const p = newProject(), page = p.pages[0]
  page.scene.defs.push({ op: 'FONT', attrs: { src: link } })
  page.scene.root.push({ op: 'T', attrs: { font: 'UI Registry Face', text: '<font="UI Registry Face Bold">x</font>' } })
  const ui = mount(<><FontImport page={page} project={p} />
    <TextLayer labels={[label({ font: 'UI Registry Face', text: '<font="UI Registry Face Bold">x</font>' })]} zoom={1} scene={page.scene} /></>)
  const exported = generate(p, pg => printSrc(pg.scene))
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }
  try {
    expect(ui.container.querySelector('.vb-font-missing')!.textContent).toContain("Load this page's fonts")
    expect(fetch).not.toHaveBeenCalled()
    await run(async () => { ui.container.querySelector<HTMLButtonElement>('section button')!.click(); await settle() })
    expect(getPageFontRecord(link)?.names).toEqual(['UI Registry Face', 'UI Registry Face Bold'])
    expect(isKnownFont('UI Registry Face Bold')).toBe(true)
    expect(ui.container.querySelector('.vb-font-missing')).toBeNull()
    expect(ui.container.textContent).toContain('2 delivered face names: UI Registry Face, UI Registry Face Bold')
    expect(ui.container.textContent).toContain('Local font files > bundled faces > earlier page downloads > fresh page requests')
    expect(reader).toHaveBeenCalledOnce()
    const pageFamily = fontStyle('UI Registry Face').fontFamily
    await run(async () => { await importFont('UI Registry Face', new ArrayBuffer(1), false) })
    expect(fontStyle('UI Registry Face').fontFamily).not.toBe(pageFamily)
    await run(async () => { await removeFont('UI Registry Face') })
    expect(fontStyle('UI Registry Face').fontFamily).toBe(pageFamily)
    await run(async () => { rejected[0](Error('subset decode failed')); await settle() })
    expect(ui.container.querySelector('.vb-font-missing')!.textContent).toContain('subset decode failed')
    expect(generate(p, pg => printSrc(pg.scene))).toEqual(exported)
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally {
    ui.unmount(); await removeFont('UI Registry Face')
    vi.unstubAllGlobals()
    if (own) Object.defineProperty(document, 'fonts', own)
    else delete (document as { fonts?: unknown }).fonts
  }
})
