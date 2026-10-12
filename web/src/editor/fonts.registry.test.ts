import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idb } from '../testing'
import served from '../../test/fixtures/fonts/metadata-served.json'
import axesServed from '../../test/fixtures/fonts/metadata-axes-served.json'
import type { MetadataResult } from './fonts'

let m: typeof import('./fonts')
const regular = { status: 'ok' as const, names: {}, axes: [], faces: [], family: 'Orbitron', style: 'Regular', instances: [] }
const variable = { ...regular, axes: [{ tag: 'wght', min: 400, default: 400, max: 900, name: 'Weight' }], instances: [400, 500, 600, 700, 800, 900].map((wght, i) => ({ family: 'Orbitron', style: ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'][i], axes: { wght } })) }
const group = (weight: [number, number] = [400, 900]) => ({ family: 'CSS is not the game name', style: 'normal', weight: weight.join(' '), minWeight: weight[0], maxWeight: weight[1], representative: 'https://fonts.gstatic.com/orbitron.woff2', sources: [{ url: 'https://fonts.gstatic.com/orbitron.woff2', unicodeRange: 'U+0-FF', display: 'swap' as const }] })
const faces: { family: string; source: unknown; descriptors: FontFaceDescriptors; resolve: () => void; reject: (e: Error) => void }[] = []

beforeEach(async () => {
  vi.resetModules()
  m = await import('./fonts')
  faces.length = 0
  vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } })
  vi.stubGlobal('FontFace', class {
    loaded: Promise<void>
    constructor(family: string, source: unknown, descriptors: FontFaceDescriptors = {}) {
      this.loaded = new Promise((resolve, reject) => faces.push({ family, source, descriptors, resolve, reject }))
    }
    load() { return Promise.resolve(this) }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('metadata registry', () => {
  it('keeps the exact registration rule and every Fonts-mod style synonym in one place', () => {
    expect(m.registeredName('Family', 'rEgUlAr')).toBe('Family')
    expect(m.registeredName('Family', 'Bold Oblique')).toBe('Family Bold Oblique')
    for (const [style, slot] of [['Hairline', 1], ['UltraLight', 2], ['DemiBold', 6], ['UltraBold', 8], ['Heavy', 9], ['Unknown', 0], ['Oblique', 0]] as const) {
      expect(m.styleSlot(style)).toEqual({ slot, italic: false })
      expect(m.styleSlot(`${style} Italic`)).toEqual({ slot, italic: true })
    }
  })

  it('selects six inclusive instances, clamps each descriptor, deduplicates repeated subsets and never eagerly loads', () => {
    const batch = m.registerPageFonts('link', [{ ...group(), metadata: variable }])
    expect(batch).toEqual(['Orbitron', 'Orbitron Medium', 'Orbitron SemiBold', 'Orbitron Bold', 'Orbitron ExtraBold', 'Orbitron Black'])
    expect(faces).toHaveLength(6)
    expect(faces.map(f => f.descriptors.weight)).toEqual(['400', '500', '600', '700', '800', '900'])
    expect(faces.every(f => f.descriptors.display === 'swap')).toBe(true)
    m.registerPageFonts('again', [{ ...group(), metadata: variable }])
    expect(faces).toHaveLength(6)
    expect(m.fontStyle('Orbitron Bold').fontWeight).toBe('700')
    expect(m.fontStyle('Orbitron', 700).fontWeight).toBe('700')
    expect(m.fontStyle('Orbitron Bold').fontVariationSettings).toBe('"wght" 700')
  })

  it('single-weight rules expose only exact named instances, without guessed names or partial batches', () => {
    expect(m.registerPageFonts('single', [{ ...group([700, 700]), metadata: variable }])).toEqual(['Orbitron Bold'])
    expect(m.isKnownFont('Orbitron')).toBe(false)
    expect(() => m.registerPageFonts('bad', [{ ...group([400, 400]), metadata: variable }, { ...group([650, 650]), metadata: variable }])).toThrow('no matching named instance')
    expect(m.isKnownFont('Orbitron')).toBe(false)
  })

  it('delivers nine Roboto slots and reuses one variable source across 400/700 groups', () => {
    const styles = ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']
    const metadata = { ...variable, family: 'Roboto', instances: styles.map((style, i) => ({ family: 'Roboto', style, axes: { wght: (i + 1) * 100 } })) }
    expect(m.registerPageFonts('roboto', [{ ...group([100, 900]), metadata }])).toHaveLength(9)
    m.registerPageFonts('singles', [{ ...group([400, 400]), metadata: variable }, { ...group([700, 700]), metadata: variable }])
    expect(faces).toHaveLength(11)
    expect(m.isKnownFont('Orbitron Medium')).toBe(false)
    expect(m.fontStyle('Roboto', 100).fontWeight).toBe('100')
    expect(m.fontStyle('Roboto', 900).fontWeight).toBe('900')
  })

  it.each(served.comparisons)('matches recorded static TTF names for $family using only browser metadata', comparison => {
    const request = served.requests.find(r => r.agent === 'chrome' && r.family === comparison.family)!
    const groups = [...new Map(request.rules.map(r => [r.weight, r])).values()].map(rule => {
      const profile = served.metadataProfiles[served.assets.find(a => a.url === rule.url)!.metadataProfile]
      const names = Object.fromEntries(Object.entries(profile.nameIDs).filter(([, name]) => name !== null)) as Record<number, string>
      const metadata: MetadataResult = { ...profile, status: 'ok', names, faces: [] }
      const [min, max = min] = rule.weight.split(/\s+/).map(Number)
      return { ...group([min, max]), representative: rule.url, metadata }
    })
    const names = m.registerPageFonts(comparison.family, groups)
    expect(names).toEqual(comparison.ttfNames)
    expect(names).toEqual(comparison.derivedInstanceNames)
    expect(comparison.derivedMatch).toBe(true)
    const regular = names.find(name => !name.endsWith(' Bold'))!
    const bold = names.find(name => name.endsWith(' Bold'))!
    expect(m.styleName(regular, 700)).toBe(bold)
  })

  it.each([
    { family: 'Unresolved', names: { 1: 'Unresolved', 17: 'Thin' } },
    { family: 'Unknown Thin', names: { 1: 'Unknown Thin', 2: 'Regular' } },
    { family: ' Thin', names: { 1: ' Thin', 17: 'Thin' } },
    { family: 'Almost Thinly', names: { 1: 'Almost Thinly', 17: 'Thin' } },
  ])('refuses an unestablished non-Regular default family atomically: $family', partial => {
    const metadata = { ...variable, ...partial, axes: [{ ...variable.axes[0], default: 100 }] }
    expect(() => m.registerPageFonts('bad', [{ ...group([400, 400]), metadata: variable }, { ...group(), metadata }])).toThrow('cannot establish the typographic family')
    expect(faces).toHaveLength(1) // the planned first group never reaches FontFaceSet
    expect((document.fonts as FontFaceSet & { add: unknown }).add).not.toHaveBeenCalled()
    expect(m.isKnownFont('Orbitron')).toBe(false)
  })

  it('uses ID16 before suffix derivation and leaves static families and Regular defaults verbatim', () => {
    const thin = { ...variable, family: 'Literal Thin', names: { 1: 'Legacy Thin', 16: 'Literal Thin', 17: 'Thin' }, axes: [{ ...variable.axes[0], default: 100 }] }
    expect(m.registerPageFonts('id16', [{ ...group([400, 400]), metadata: thin }])).toEqual(['Literal Thin'])
    expect(m.registerPageFonts('static', [{ ...group([700, 700]), metadata: { ...regular, family: 'Static Thin', style: 'Bold', names: { 1: 'Static Thin', 17: 'Bold' } } }])).toEqual(['Static Thin Bold'])
    expect(m.registerPageFonts('regular', [{ ...group([400, 400]), metadata: { ...variable, family: 'Literal Regular', names: { 1: 'Literal Regular', 17: 'Regular' } } }])).toEqual(['Literal Regular'])
  })

  it('uses the default named instance only when every axis matches, without guessing a weight style', () => {
    const metadata = { ...variable, family: 'Sample Thin', names: { 1: 'Sample Thin', 2: 'Regular' },
      axes: [{ ...variable.axes[0], default: 100 }, { tag: 'wdth', min: 75, default: 100, max: 100, name: 'Width' }],
      instances: [{ family: 'Sample Thin', style: 'Wrong', axes: { wght: 100, wdth: 75 } }, { family: 'Sample Thin', style: 'Thin', axes: { wght: 100, wdth: 100 } }, { family: 'Sample Thin', style: 'Regular', axes: { wght: 400, wdth: 100 } }] }
    expect(m.registerPageFonts('defaults', [{ ...group([400, 400]), metadata }])).toEqual(['Sample'])
  })

  it('registers only default-width instances from recorded multi-axis Roboto metadata', () => {
    const metadata: MetadataResult = { ...axesServed.metadata, status: 'ok', faces: [] }
    expect(metadata.instances.some(i => i.axes.wdth === 75)).toBe(true)
    expect(m.registerPageFonts('default-width', [{ ...group([100, 900]), metadata }])).toEqual(axesServed.expectedDefaultWidthAliases)
    expect(faces).toHaveLength(9)
    expect(faces.every(f => (f.descriptors as FontFaceDescriptors & { variationSettings: string }).variationSettings.includes('"wdth" 100'))).toBe(true)
    expect(m.isKnownFont('Roboto Condensed Bold')).toBe(false)
  })

  it.each(['invalid', 'failed', 'read-budget', 'cancelled'] as const)('preserves the %s metadata failure cause and registers nothing', status => {
    expect(() => m.registerPageFonts('failed', [{ ...group(), metadata: { status, cause: 'observed reader failure' } }])).toThrow('observed reader failure')
    expect(faces).toHaveLength(0)
  })

  it('retains many Unicode subsets under one alias, caches them after link removal, and invalidates on actual load/failure', async () => {
    const g = group([400, 400])
    g.sources = Array.from({ length: 124 }, (_, i) => ({ url: `https://fonts.gstatic.com/${i}.woff2`, unicodeRange: `U+${(i * 256).toString(16)}-${(i * 256 + 255).toString(16)}`, display: 'swap' as const }))
    m.registerPageFonts('noto-like', [{ ...g, metadata: regular }])
    expect(faces).toHaveLength(124)
    const before = m.fontVersion('Orbitron')
    faces[0].resolve(); await Promise.resolve()
    expect(m.fontVersion('Orbitron')).toBeGreaterThan(before)
    const loaded = m.fontVersion('Orbitron')
    faces[1].reject(new Error('subset decode failed')); await Promise.resolve()
    expect(m.fontVersion('Orbitron')).toBeGreaterThan(loaded)
    expect(m.fontNotices()).toContainEqual(expect.stringContaining('subset decode failed'))
    m.releasePageFonts('noto-like')
    expect(m.isKnownFont('Orbitron')).toBe(true)
  })

  it('uses local > bundled > page, removal reveals the lower claim, and typed names do not define slots', async () => {
    m.registerPageFonts('page', [{ ...group([400, 400]), metadata: { ...regular, family: 'Barlow' } }])
    const bundled = m.familyOf('Barlow')
    await m.importFont('Barlow', new ArrayBuffer(8), false, { ...regular, family: 'Actual Family', style: 'Heavy Italic' })
    expect(m.familyOf('Barlow')).not.toBe(bundled)
    expect(m.fontStyle('Barlow', 700).letterSpacing).toBe('0.07em')
    expect(m.fontStyle('Barlow', 400, true).transform).toBeUndefined()
    await m.removeFont('Barlow')
    expect(m.familyOf('Barlow')).toBe(bundled)
    await m.importFont('Misleading Bold', new ArrayBuffer(8), false, regular)
    await m.importFont('Also misleading', new ArrayBuffer(8), false, { ...regular, style: 'Bold' })
    expect(m.styleName('Misleading Bold', 700)).toBe('Also misleading')
    expect(m.fontStyle('Misleading Bold', 700).WebkitTextStrokeWidth).toBe('0em')
  })

  it('clamps a local variable face to its metadata default axes instead of the typed suffix', async () => {
    await m.importFont('Typed Thin', new ArrayBuffer(8), false, { ...variable, axes: [{ tag: 'wght', min: 400, default: 700, max: 900, name: 'Weight' }], style: 'Bold' })
    expect(faces[0].descriptors.weight).toBe('700')
    expect(m.fontStyle('Typed Thin').fontWeight).toBe('700')
    expect(m.fontStyle('Typed Thin').fontVariationSettings).toBe('"wght" 700')
  })

  it('reuses the first page claim, reports a differing overlapping source, but adds disjoint subsets', () => {
    m.registerPageFonts('first', [{ ...group([400, 400]), metadata: regular }])
    const first = m.familyOf('Orbitron')
    const other = group([400, 400]); other.sources[0].url = 'https://fonts.gstatic.com/other.woff2'
    m.registerPageFonts('second', [{ ...other, metadata: regular }]); expect(m.fontNotices()).toContainEqual(expect.stringContaining('claimed first'))
    expect(faces).toHaveLength(1)
    expect(m.familyOf('Orbitron')).toBe(first)
    other.sources[0].unicodeRange = 'U+100-1FF'
    m.registerPageFonts('third', [{ ...other, metadata: regular }])
    expect(faces).toHaveLength(2)
  })

  it('reports when a different face claimed the same alias first and retains its glyphs', () => {
    m.registerPageFonts('first', [{ ...group([400, 400]), metadata: regular }])
    const before = m.fontStyle('Orbitron')
    m.registerPageFonts('different-face', [{ ...group([400, 400]), metadata: variable }])
    expect(m.fontNotices()).toContain('Page font Orbitron: a different face claimed first; keeping its glyphs.')
    expect(faces).toHaveLength(1)
    expect(m.fontStyle('Orbitron')).toEqual(before)
  })

  it('checks the aborted signal before delivering a subset failure even without abort cleanup', async () => {
    const controller = new AbortController(), failure = vi.fn()
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(() => {})
    m.registerPageFonts('guard', [{ ...group([400, 400]), metadata: regular }], failure, controller.signal)
    controller.abort()
    faces[0].reject(new Error('late subset')); await Promise.resolve()
    expect(failure).not.toHaveBeenCalled()
  })

  it('deletes every already-added FontFace when abort occurs during registration', () => {
    const controller = new AbortController(), registered = new Set<FontFace>()
    const add = vi.fn((face: FontFace) => { registered.add(face); if (registered.size === 2) controller.abort() })
    const remove = vi.fn((face: FontFace) => registered.delete(face))
    vi.stubGlobal('document', { fonts: { add, delete: remove } })
    expect(() => m.registerPageFonts('abort-during-add', [{ ...group(), metadata: variable }], () => {}, controller.signal)).toThrow()
    expect(add).toHaveBeenCalledTimes(2)
    expect(remove.mock.calls.map(([face]) => face)).toEqual(add.mock.calls.map(([face]) => face))
    expect(registered.size).toBe(0)
    expect(m.isKnownFont('Orbitron')).toBe(false)
  })

  it('invalidates an existing family when a late synonym slot arrives and keeps vector fallback unlinked', () => {
    m.registerPageFonts('regular', [{ ...group([400, 400]), metadata: regular }])
    const before = m.fontVersion('Orbitron')
    m.registerPageFonts('heavy', [{ ...group([900, 900]), metadata: { ...regular, style: 'Heavy' } }])
    expect(m.fontVersion('Orbitron')).toBeGreaterThan(before)
    expect(m.styleName('Orbitron', 900)).toBe('Orbitron Heavy')
    expect(m.fontStyle(null, 700).letterSpacing).toBe('0.07em')
  })

  it('uses safe CSS string serialization for quotes, backslashes and newlines', async () => {
    const name = 'quoted " \\ \n family'
    await m.importFont(name, new ArrayBuffer(8), false, { ...regular, family: name })
    expect(m.familyOf(name)).toContain('\\a ')
    expect(m.familyOf(name)).not.toContain('\n')
    expect(m.familyOf(name)).toContain('\\"')
  })

  it('isolates browser families even when a local exact name imitates a page CSS family', async () => {
    m.registerPageFonts('isolated', [{ ...group([400, 400]), metadata: regular }])
    const pageCssFamily = JSON.parse(m.familyOf('Orbitron').split(', ')[0])
    await m.importFont(pageCssFamily, new ArrayBuffer(8), false, regular)
    expect(m.familyOf(pageCssFamily)).not.toBe(m.familyOf('Orbitron'))
  })

  it('skips hostile stored records with visible causes while preserving valid imports', async () => {
    const store = idb();
    (store.records as Map<string, unknown>).set('bad-name', { name: 3, data: new ArrayBuffer(8) });
    (store.records as Map<string, unknown>).set('bad-bytes', { name: 'bad bytes', data: { byteLength: 8 } })
    store.records.set('good', { name: 'Good', data: new ArrayBuffer(8) })
    vi.stubGlobal('indexedDB', store.factory)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await m.loadImportedFonts()
    expect(m.importedFonts()).toEqual(['Good'])
    expect(m.fontNotices().filter(n => n.includes('corrupted'))).toHaveLength(2)
  })

  it('uses one async metadata reader for local suggestions and manual fallback', async () => {
    const read = vi.fn(async () => regular)
    m.setFontMetadataReader(read)
    expect(await m.fontName(new ArrayBuffer(8))).toBe('Orbitron')
    await m.importFont('Typed', new ArrayBuffer(8), false)
    expect(read).toHaveBeenCalledTimes(2)
    expect(m.fontNotices()).toEqual([])
    m.setFontMetadataReader(async () => ({ status: 'failed', cause: 'too large to read names from here' }))
    await m.importFont('Manual Bold', new ArrayBuffer(8), false)
    expect(m.styleName('Manual Bold', 700)).toBe('')
    expect(m.fontNotices()).toContainEqual(expect.stringContaining('too large to read names'))
  })

  it('keeps vector fallback independent of a local file named Liberation Sans', async () => {
    await m.importFont('Liberation Sans', new ArrayBuffer(8), false, { ...regular, family: 'Separate' })
    await m.importFont('Separate Bold', new ArrayBuffer(8), false, { ...regular, family: 'Separate', style: 'Bold' })
    expect(m.styleName(null, 700)).toBe('')
    expect(m.fontStyle(null, 700)).toMatchObject({ fontFamily: m.familyOf(null), letterSpacing: '0.07em', WebkitTextStrokeWidth: ((0.75 / 4) * (10 - 1) / 86 * 2) + 'em' })
    expect(m.fontStyle('Liberation Sans', 700).fontFamily).toBe(m.familyOf('Separate Bold'))
  })

  it('matches other named-instance axes against rule style and oblique angles', () => {
    const metadata = { ...variable, family: 'Slant', instances: [
      { family: 'Slant', style: 'Regular', axes: { wght: 400, slnt: 0, ital: 0 } },
      { family: 'Slant', style: 'Oblique', axes: { wght: 400, slnt: -15, ital: 0 } },
      { family: 'Slant', style: 'Italic', axes: { wght: 400, slnt: 0, ital: 1 } },
    ] }
    expect(m.registerPageFonts('normal', [{ ...group([400, 400]), metadata }])).toEqual(['Slant'])
    expect(m.registerPageFonts('italic', [{ ...group([400, 400]), style: 'italic', metadata }])).toEqual(['Slant Italic'])
    expect(() => m.registerPageFonts('slant-outside', [{ ...group([400, 400]), style: 'oblique 20deg 30deg', metadata }])).toThrow('no matching named instance')
    expect(m.registerPageFonts('slant', [{ ...group([400, 400]), style: 'oblique 10deg 20deg', metadata }])).toEqual(['Slant Oblique'])
  })

  it('cancels before commit, rolls back FontFaceSet failures, and forwards later subset failures only to live links', async () => {
    const cancelled = new AbortController(); cancelled.abort()
    expect(() => m.registerPageFonts('cancelled', [{ ...group(), metadata: variable }], () => {}, cancelled.signal)).toThrow()
    expect(faces).toHaveLength(0)
    const add = vi.mocked((document.fonts as unknown as { add: () => void }).add)
    add.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('face registration failed') })
    expect(() => m.registerPageFonts('failed', [{ ...group(), metadata: variable }])).toThrow('face registration failed')
    expect(m.isKnownFont('Orbitron')).toBe(false)
    add.mockReset()
    const live = vi.fn(), removed = vi.fn(), controller = new AbortController()
    m.registerPageFonts('live', [{ ...group([400, 400]), metadata: regular }], live)
    m.registerPageFonts('removed', [{ ...group([400, 400]), metadata: regular }], removed, controller.signal)
    controller.abort()
    faces.at(-1)!.reject(new Error('404')); await Promise.resolve()
    expect(live).toHaveBeenCalledWith('https://fonts.gstatic.com/orbitron.woff2', '404')
    expect(removed).not.toHaveBeenCalled()
    expect(m.isKnownFont('Orbitron')).toBe(false)
    m.registerPageFonts('retry', [{ ...group([400, 400]), metadata: regular }])
    expect(m.isKnownFont('Orbitron')).toBe(true)
  })

  it('does not let an older generation abort remove the current link observer', async () => {
    const old = new AbortController(), first = vi.fn(), latest = vi.fn()
    m.registerPageFonts('same-link', [{ ...group([400, 400]), metadata: regular }], first, old.signal)
    m.registerPageFonts('same-link', [{ ...group([400, 400]), metadata: regular }], latest)
    old.abort()
    faces[0].reject(new Error('404')); await Promise.resolve()
    expect(latest).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })

  it('expires subset notices per link on abort without removing cached usable faces', async () => {
    const one = new AbortController(), two = new AbortController(), g = group([400, 400])
    g.sources.push({ ...g.sources[0], url: 'https://fonts.gstatic.com/usable.woff2', unicodeRange: 'U+100-1FF' })
    m.registerPageFonts('one', [{ ...g, metadata: regular }], () => {}, one.signal)
    m.registerPageFonts('two', [{ ...g, metadata: regular }], () => {}, two.signal)
    faces[0].reject(new Error('shared subset failed')); await Promise.resolve()
    expect(m.fontNotices().filter(n => n.includes('shared subset failed'))).toHaveLength(2)
    const before = m.fontsVersion()
    one.abort()
    expect(m.fontNotices().filter(n => n.includes('shared subset failed'))).toHaveLength(1)
    expect(m.fontsVersion()).toBeGreaterThan(before)
    two.abort()
    expect(m.fontNotices()).toEqual([])
    expect(m.isKnownFont('Orbitron')).toBe(true)
  })

  it('expires conflicts by link, preserving the latest generation when an older signal aborts', () => {
    m.registerPageFonts('base', [{ ...group([400, 400]), metadata: regular }])
    const old = new AbortController(), current = new AbortController(), other = new AbortController()
    for (const [link, signal] of [['same', old.signal], ['same', current.signal], ['other', other.signal]] as const)
      m.registerPageFonts(link, [{ ...group([400, 400]), metadata: variable }], () => {}, signal)
    expect(m.fontNotices().filter(n => n.includes('different face claimed'))).toHaveLength(2)
    old.abort()
    expect(m.fontNotices().filter(n => n.includes('different face claimed'))).toHaveLength(2)
    current.abort()
    expect(m.fontNotices().filter(n => n.includes('different face claimed'))).toHaveLength(1)
    other.abort()
    expect(m.fontNotices()).toEqual([])
  })

  it('clears named stored-record notices on removal or successful replacement', async () => {
    const store = idb()
    store.records.set('Broken', { name: 'Broken', data: new ArrayBuffer(8) })
    vi.stubGlobal('indexedDB', store.factory)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('FontFace', class { load() { return Promise.reject(new Error('bad stored bytes')) } })
    await m.loadImportedFonts()
    expect(m.fontNotices()).toContainEqual(expect.stringContaining('bad stored bytes'))
    await m.removeFont('Broken')
    expect(m.fontNotices()).toEqual([])
    store.records.set('Replacement', { name: 'Replacement', data: new ArrayBuffer(8) })
    await m.loadImportedFonts()
    expect(m.fontNotices()).toContainEqual(expect.stringContaining('bad stored bytes'))
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    await m.importFont('Replacement', new ArrayBuffer(8), false, regular)
    expect(m.fontNotices()).toEqual([])
  })

  it.each(['removed', 'project changed'] as const)('does not revive a late stored-file notice after its owner is %s', async reason => {
    const store = idb()
    store.records.set('Late stored', { name: 'Late stored', data: new ArrayBuffer(8) })
    vi.stubGlobal('indexedDB', store.factory)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let fail!: (e: Error) => void
    vi.stubGlobal('FontFace', class { load() { return new Promise((_, reject) => { fail = reject }) } })
    const pending = m.loadImportedFonts()
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
    if (reason === 'removed') await m.removeFont('Late stored')
    else m.clearFontNotices()
    fail(new Error('late stored decode failure')); await pending
    expect(m.fontNotices()).toEqual([])
  })

  it('prevents removed or superseded local reads from reviving a face', async () => {
    let resolve!: (metadata: typeof regular) => void
    m.setFontMetadataReader(() => new Promise(r => { resolve = r }))
    const pending = m.importFont('Race', new ArrayBuffer(8), false)
    await m.removeFont('Race')
    resolve(regular); await expect(pending).rejects.toThrow('import was removed')
    expect(m.importedFonts()).toEqual([])
    const first = m.importFont('Race', new ArrayBuffer(8), false)
    await m.importFont('Race', new ArrayBuffer(8), false, { ...regular, family: 'Latest' })
    resolve(regular); await expect(first).rejects.toThrow('superseded by a newer import')
    expect(m.styleName('Race', 700)).toBe('')
  })

  it('reuses a usable page after local removal and lets a failed page claim be replaced on retry', async () => {
    m.registerPageFonts('initial', [{ ...group([400, 400]), metadata: regular }])
    const page = m.familyOf('Orbitron')
    await m.importFont('Orbitron', new ArrayBuffer(8), false, { ...regular, family: 'Local' })
    expect(m.familyOf('Orbitron')).not.toBe(page)
    await m.removeFont('Orbitron')
    expect(m.familyOf('Orbitron')).toBe(page)
    faces[0].reject(new Error('decode failed')); await Promise.resolve()
    const replacement = { ...group([400, 400]), sources: [{ url: 'https://fonts.gstatic.com/retry.woff2', unicodeRange: 'U+0-FF', display: 'swap' as const }], metadata: { ...regular, style: '' } }
    expect(m.registerPageFonts('replacement', [replacement])).toEqual(['Orbitron'])
    expect(m.isKnownFont('Orbitron')).toBe(true)
    expect(m.familyOf('Orbitron')).not.toBe(page)
  })
})

it('manual weight-shaped aliases retain default axes unless a weight is explicitly requested', async () => {
  const metadata = { ...variable, names: { 16: 'Orbitron' }, axes: [{ ...variable.axes[0], default: 700 }], style: 'Bold' }
  await m.importFont('Orbitron Medium', new ArrayBuffer(8), false, metadata)
  expect(faces[0].descriptors.weight).toBe('700')
  await m.importFont('Orbitron Medium', new ArrayBuffer(8), false, metadata, 500)
  expect(faces[1].descriptors.weight).toBe('500')
  expect(m.fontStyle('Orbitron Medium').fontVariationSettings).toBe('"wght" 500')
})

it('keeps an explicit variable weight when the browser font is restored', async () => {
  const store = idb(), data = new ArrayBuffer(8)
  vi.stubGlobal('indexedDB', store.factory)
  await m.importFont('Orbitron Bold', data, true, variable, 700)
  expect(store.records.get('Orbitron Bold')).toMatchObject({ name: 'Orbitron Bold', data, weight: 700 })
  vi.resetModules(); m = await import('./fonts'); m.setFontMetadataReader(async () => variable)
  await m.loadImportedFonts()
  expect(faces[1].descriptors.weight).toBe('700')
  expect(m.fontStyle('Orbitron Bold').fontVariationSettings).toBe('"wght" 700')
})
it.each([NaN, Infinity, 0, 1001])('refuses an invalid explicit CSS weight %s before registration', async weight => {
  await expect(m.importFont('Bad weight', new ArrayBuffer(8), false, regular, weight)).rejects.toThrow('invalid CSS font weight')
  expect(faces).toHaveLength(0)
})
