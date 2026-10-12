import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUNDLED, DEFAULT_FACE, FACES, familyOf, fontStyle, fontName, importFont, importedFonts, isKnownFont, knownFonts, loadImportedFonts, nameOfFile, removeFont, subscribeFonts, setFontMetadataReader } from './fonts'
import { idb } from '../testing'

beforeEach(() => setFontMetadataReader(async () => ({ status: 'failed', cause: 'test metadata unavailable' })))

const FALLBACK = '"Liberation Sans", Arial, Helvetica, sans-serif'

describe('bundled faces', () => {
  it('name each weight as ScriptedScreensFonts does: the regular one is the bare family', () => {
    const styles = ['', 'Thin', 'ExtraLight', 'Light', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']
    const names = ['Barlow', 'Barlow Condensed'].flatMap(f => styles.flatMap(s => [false, true].map(i => [f, s, i ? 'Italic' : ''].filter(Boolean).join(' '))))
    expect(FACES.filter(f => f.fontsMod).map(f => f.name).sort()).toEqual(names.sort())
    expect(FACES.filter(f => !f.fontsMod)).toHaveLength(1)
    expect(BUNDLED).toHaveLength(37)
    expect(BUNDLED).not.toContain('Manrope')
    expect(BUNDLED).not.toContain('Inter')
    expect(BUNDLED).toContain(DEFAULT_FACE)
  })
  it('gives a label its CSS family; a face the preview cannot draw gets the fallback alone, as TMP does', () => {
    expect(familyOf(null)).toBe(FALLBACK)
    expect(familyOf('Liberation Sans')).toBe(FALLBACK)
    expect(familyOf('Barlow Condensed Bold')).toBe(`"Barlow Condensed Bold", ${FALLBACK}`)
    expect(familyOf('code')).toBe(FALLBACK)
    expect(familyOf('barlow')).toBe(FALLBACK)   // names are exact: the Fonts mod knows no "barlow"
  })
})

describe('slot table', () => {
  it('dilates missing Fonts-mod slots and adds their spacing; the vector default has no linked bold face', async () => {
    vi.stubGlobal('document', { fonts: { add() {}, delete() {} } })
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    await importFont('Dilation Test', new ArrayBuffer(8), false)
    try {
      expect(fontStyle('Dilation Test', 700)).toMatchObject({ fontWeight: 'normal', fontSynthesis: 'none', letterSpacing: '0.07em', WebkitTextStrokeWidth: '0.0390625em', paintOrder: 'stroke fill' })
      expect(fontStyle('Dilation Test', 700).WebkitTextStrokeWidth).toBe('0.0390625em')
      expect(fontStyle('Dilation Test', 400)).toMatchObject({ letterSpacing: '0em', WebkitTextStrokeWidth: '0em' })
      expect(fontStyle('Barlow', 700)).toMatchObject({ letterSpacing: '0em', WebkitTextStrokeWidth: '0em' })
      for (const weight of [600, 700]) expect(fontStyle(null, weight)).toMatchObject({ fontWeight: 'normal', fontSynthesis: 'none', letterSpacing: '0.07em', WebkitTextStrokeWidth: ((0.75 / 4) * (10 - 1) / 86 * 2) + 'em' })
    } finally { await removeFont('Dilation Test'); vi.unstubAllGlobals() }
  })
  it.each([null, 'constructor'])('uses the vector default face italicStyle of 35 for %s', font => {
    expect(fontStyle(font, 400, true)).toMatchObject({ fontStyle: 'normal', fontSynthesis: 'none', transform: 'matrix(1, 0, -0.35000000000000003, 1, 0, 0)' })
  })
  it.each([
    ['upright-only italic', 'Case Upright', 400, true, 'Case Upright', 'normal', true],
    ['real italic', 'Barlow', 400, true, 'Barlow Italic', 'normal', false],
    ['real bold italic', 'Barlow', 700, true, 'Barlow Bold Italic', 'normal', false],
    ['missing bold italic uses the current glyph', 'Case Upright', 700, true, 'Case Upright', 'normal', true],
    ['missing bold uses faux bold only', 'Case Lonely', 700, false, 'Case Lonely', 'normal', false],
    ['named italic missing bold has no extra shear', 'Case Named Italic', 700, false, 'Case Named Italic', 'normal', false],
    ['a named bold face does not move the italic slot', 'Barlow Bold', undefined, true, 'Barlow Italic', 'normal', false],
  ] as const)('%s', async (_case, font, weight, italic, face, bold, shear) => {
    vi.stubGlobal('document', { fonts: { add() {}, delete() {} } })
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    const names = ['Case Upright', 'Case Upright Bold', 'Case Lonely', 'Case Named Italic']
    for (const name of names) await importFont(name, new ArrayBuffer(8), false)
    try {
      const style = fontStyle(font, weight, italic)
      expect(style.fontFamily).toBe(familyOf(face))
      expect(style.fontWeight).toBe(bold)
      expect(!!style.transform).toBe(shear)
      expect(style.fontSynthesis).toBe('none')
    } finally { for (const name of names) await removeFont(name); vi.unstubAllGlobals() }
  })
  it('uses all nine real weights and italics, keeping the weight slot independent of a face name', () => {
    for (const family of ['Barlow', 'Barlow Condensed']) {
      for (const [index, style] of ['Thin', 'ExtraLight', 'Light', '', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'].entries()) {
        const name = [family, style].filter(Boolean).join(' ')
        expect(fontStyle(family, (index + 1) * 100).fontFamily).toBe(familyOf(name))
        expect(fontStyle(family, (index + 1) * 100, true)).toMatchObject({ fontFamily: familyOf(`${name} Italic`), fontWeight: 'normal', fontStyle: 'normal', fontSynthesis: 'none' })
        expect(fontStyle(name, undefined, true).fontFamily).toBe(familyOf(`${family} Italic`))
        expect(fontStyle(`${name} Italic`, 700).fontFamily).toBe(familyOf(`${family} Bold Italic`))
      }
    }
    expect(fontStyle('Barlow', 650).fontFamily).toBe(familyOf('Barlow SemiBold'))
  })
})

describe('registerFaces', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it('registers every face lazily and reports failure only when the browser requests it', async () => {
    vi.resetModules()   // a fresh registry: this test marks a face as failed
    const m = await import('./fonts')
    const sources: string[] = [], reject: (() => void)[] = []
    let loads = 0
    vi.stubGlobal('FontFace', class {
      loaded: Promise<unknown>
      constructor(readonly family: string, readonly source: string) {
        sources.push(source)
        this.loaded = new Promise((_, fail) => { if (/Barlow-Medium\.woff2/.test(source)) reject.push(() => fail(new Error('404'))) })
      }
      load() { loads++; return Promise.resolve(this) }
    })
    vi.stubGlobal('document', { fonts: { add() {} } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let told = 0
    m.subscribeFonts(() => told++)
    m.registerFaces()
    expect(sources).toEqual(m.FACES.map(f => `url(${import.meta.env.BASE_URL}fonts/${f.file}) format('woff2')`))
    expect(sources.join()).not.toMatch(/\/\//)
    expect(loads).toBe(0)
    reject.forEach(f => f())
    await new Promise(r => setTimeout(r))
    expect(warn.mock.calls.map(c => String(c[0]).match(/\S+\.woff2/)![0])).toEqual(['Barlow-Medium.woff2'])
    expect(told).toBe(1)
    expect(m.isKnownFont('Barlow Medium')).toBe(false)
    expect(m.familyOf('Barlow Medium')).toBe(FALLBACK)
    expect(m.isKnownFont('Barlow')).toBe(true)
    expect(m.isKnownFont('Liberation Sans')).toBe(true)   // its regular weight is available
    const { textRuns } = await import('./text')
    expect(textRuns({ text: '<font="Barlow Medium">x</font>', font: null, bold: false }).map(r => r.text).join('')).toBe('x')
  })
})

describe('fontName', () => {
  it('uses the async metadata pair, preserving verbatim styles and bare Regular aliases', async () => {
    for (const [family, style, expected] of [['Manrope', 'Regular', 'Manrope'], ['Barlow Condensed', 'SemiBold', 'Barlow Condensed SemiBold'], ['Face', 'Bold Oblique', 'Face Bold Oblique']]) {
      setFontMetadataReader(async () => ({ status: 'ok', names: {}, axes: [], faces: [], family, style, instances: [] }))
      expect(await fontName(new ArrayBuffer(8))).toBe(expected)
    }
  })
  it('gives null on reader failure and keeps the file-name fallback', async () => {
    setFontMetadataReader(async () => ({ status: 'failed', cause: 'invalid offsets' }))
    expect(await fontName(new ArrayBuffer(2))).toBeNull()
    expect(nameOfFile('Manrope-Bold.ttf')).toBe('Manrope-Bold')
  })
})

describe('imported fonts', () => {
  const added: unknown[] = []
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); added.length = 0 })
  const stub = (readable = true) => {
    vi.stubGlobal('FontFace', class {
      family: string
      constructor(family: string) { this.family = JSON.parse(family).replace(/^vb-local-\d+ /, '') }
      load() { return readable && this.family !== 'Broken' ? Promise.resolve(this) : Promise.reject(new Error('bad font')) }
    })
    vi.stubGlobal('document', { fonts: { add: (f: unknown) => added.push(f), delete: () => true } })
  }
  it('registers a font under its name, tells subscribers, and works without IndexedDB (memory only)', async () => {
    stub()
    let told = 0
    const stop = subscribeFonts(() => told++)
    expect(await importFont(' Manrope ', new ArrayBuffer(8))).toBe(false)   // not kept: no storage here
    expect(importedFonts()).toEqual(['Manrope'])
    expect(knownFonts().at(-1)).toBe('Manrope')
    expect(isKnownFont('Manrope') && isKnownFont('Barlow') && !isKnownFont('code')).toBe(true)
    expect(familyOf('Manrope')).toMatch(/^"vb-local-\d+ Manrope", "Liberation Sans"/)
    expect(added).toHaveLength(1)
    expect(await removeFont('Manrope')).toBe(false)
    expect(isKnownFont('Manrope')).toBe(false)
    expect(told).toBe(2)
    stop()
  })
  it('selects imported real faces and uses faux bold on the face in use for a missing slot', async () => {
    stub()
    try {
      for (const name of ['Manrope', 'Manrope Bold', 'Manrope Italic', 'Manrope Bold Italic']) await importFont(name, new ArrayBuffer(8), false, { status: 'ok', names: {}, axes: [], faces: [], family: 'Manrope', style: name.slice('Manrope'.length).trim(), instances: [] })
      expect(fontStyle('Manrope', 700).fontFamily).toContain('Manrope Bold')
      expect(fontStyle('Manrope', 400, true).fontFamily).toContain('Manrope Italic')
      expect(fontStyle('Manrope', 700, true)).toMatchObject({ fontWeight: 'normal', fontStyle: 'normal', fontSynthesis: 'none' })
      expect(fontStyle('Manrope', 700, true).fontFamily).toContain('Manrope Bold Italic')
      await removeFont('Manrope Bold Italic')
      expect(fontStyle('Manrope', 700, true)).toMatchObject({ fontFamily: familyOf('Manrope'), fontWeight: 'normal', fontStyle: 'normal', fontSynthesis: 'none', transform: expect.stringMatching(/^matrix/) })
      expect(fontStyle('Manrope', 600)).toMatchObject({ fontFamily: familyOf('Manrope'), fontWeight: 'normal', fontSynthesis: 'none' })
      expect(fontStyle('Manrope', 950)).toMatchObject({ fontFamily: familyOf('Manrope'), fontWeight: 'normal', fontSynthesis: 'none' })
    } finally { for (const name of ['Manrope', 'Manrope Bold', 'Manrope Italic', 'Manrope Bold Italic']) await removeFont(name) }
  })
  it('keeps nothing when the browser cannot read the file or the name is empty; local may claim bundled names', async () => {
    stub(false)
    await expect(importFont('Bad', new ArrayBuffer(8))).rejects.toThrow('bad font')
    stub()
    await expect(importFont('  ', new ArrayBuffer(8))).rejects.toThrow('a font needs the name the Fonts mod uses for it')
    expect(await importFont('Barlow', new ArrayBuffer(8))).toBe(false)
    expect(importedFonts()).toEqual(['Barlow'])
    await removeFont('Barlow')
  })
  it('keeps a font in IndexedDB, loads it back, skips one it cannot read, and removes one only stored', async () => {
    stub()
    const store = idb()
    vi.stubGlobal('indexedDB', store.factory)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = new ArrayBuffer(8)
    expect(await importFont('Manrope', data)).toBe(true)
    expect(store.records.get('Manrope')).toEqual({ name: 'Manrope', data })
    expect(await removeFont('Manrope')).toBe(true)
    expect(store.records.size).toBe(0)

    store.records.set('Inter', { name: 'Inter', data }).set('Broken', { name: 'Broken', data })
    await loadImportedFonts()
    expect(importedFonts()).toEqual(['Inter'])
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).toContain('"Broken"')
    expect(await removeFont('Broken')).toBe(true)   // not in memory, still forgotten
    expect([...store.records.keys()]).toEqual(['Inter'])
    await removeFont('Inter')
  })
  it('says when the storage did not keep a font, which still draws this session', async () => {
    stub()
    vi.stubGlobal('indexedDB', idb(true).factory)
    expect(await importFont('Manrope', new ArrayBuffer(8))).toBe(false)
    expect(isKnownFont('Manrope')).toBe(true)
    expect(await removeFont('Manrope')).toBe(false)
    expect(isKnownFont('Manrope')).toBe(false)
  })
  it('tells subscribers before the storage answers', async () => {
    stub()
    vi.stubGlobal('indexedDB', { open: () => ({}) })   // never answers
    let told = 0
    const stop = subscribeFonts(() => told++)
    void importFont('Slow', new ArrayBuffer(8))
    await new Promise(r => setTimeout(r))
    expect(told).toBe(1)
    expect(isKnownFont('Slow')).toBe(true)
    void removeFont('Slow')
    expect(told).toBe(2)
    expect(isKnownFont('Slow')).toBe(false)
    stop()
  })
})

const fontsDir = new URL('../../public/fonts/', import.meta.url)
describe('the bundled files', () => {
  it('ship every face once per name and weight, as WOFF2, and a licence for each project', () => {
    for (const f of FACES) {
      const file = new URL(f.file, fontsDir)
      expect(existsSync(file)).toBe(true)
      expect(readFileSync(file).subarray(0, 4).toString('latin1')).toBe('wOF2')
    }
    expect(new Set(FACES.map(f => `${f.name}/${f.weight}`)).size).toBe(FACES.length)
    expect(readdirSync(fontsDir).filter(f => /^OFL-.*\.txt$/.test(f)).sort()).toEqual(['OFL-Barlow.txt', 'OFL-BarlowCondensed.txt', 'OFL-JetBrainsMono.txt', 'OFL-LiberationSans.txt'])
  })
})

it('registers a named variable weight instead of the default weight', async () => {
  const descriptors: FontFaceDescriptors[] = []
  vi.stubGlobal('document', { fonts: { add() {}, delete() {} } })
  vi.stubGlobal('FontFace', class {
    constructor(_name: string, _data: ArrayBuffer, d: FontFaceDescriptors) { descriptors.push(d) }
    load() { return Promise.resolve(this) }
  })
  const metadata = { status: 'ok' as const, names: { 16: 'Variable Test' }, axes: [{ tag: 'wght', min: 100, default: 400, max: 900, name: 'Weight' }], faces: [], family: 'Variable Test', style: 'Regular', instances: [] }
  try {
    await importFont('Variable Test Bold', new ArrayBuffer(8), false, metadata, 700)
    expect(descriptors[0]).toMatchObject({ weight: '700', variationSettings: '"wght" 700' })
    expect(fontStyle('Variable Test Bold', 700)).toMatchObject({ WebkitTextStrokeWidth: '0em' })
  } finally { await removeFont('Variable Test Bold'); vi.unstubAllGlobals() }
})
