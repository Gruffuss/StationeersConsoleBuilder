// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageFontLoader, pageFontLinks, type PageFontGroup } from './pageFonts'
import type { Scene } from '../model/scene'
import { initialState, reducer } from '../model/store'
import { newProject } from '../model/project'
import { parseSrc } from '../srctext/parse'
import { fromProps } from '../srctext/fromProps'
import { toProps } from '../srctext/props'

const LINK = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700'
const ASSET = 'https://fonts.gstatic.com/s/orbitron/face.woff2'
const rule = (weight = '400', src = `url("${ASSET}") format('woff2')`, range = 'U+0000-00FF', family = 'Orbitron', style = 'normal') =>
  `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight}; src: ${src}; unicode-range: ${range}; }`
const scene = (...links: string[]): Scene => ({ header: {}, defs: links.map(src => ({ op: 'FONT', attrs: { src } })), root: [] })
const metadata = { family: 'Orbitron', style: 'Regular', instances: [] }
function setup(css = rule()) {
  const fetch = vi.fn<typeof globalThis.fetch>(async url => url === ASSET
    ? new Response(new Uint8Array([1, 2, 3])) : new Response(css))
  const readFontMetadata = vi.fn(async (_data: ArrayBuffer, _signal?: AbortSignal) => metadata)
  const registerPageFonts = vi.fn((_link: string, _groups: readonly PageFontGroup<typeof metadata>[], _failure: (url: string, cause: string) => void) => ['Orbitron'])
  const loader = createPageFontLoader({ fetch, readFontMetadata, registerPageFonts })
  return { ...loader, fetch, readFontMetadata, registerPageFonts }
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unit tests must not reach the network') })) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('page font declarations and explicit requests', () => {
  it.each(['CSS request', 'CSS body', 'font request', 'font body'])('fails a stalled %s after 30 seconds and permits an explicit later retry', async stage => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const l = setup()
    let stalledSignal: AbortSignal | undefined
    l.fetch.mockImplementation(async (url, init) => {
      const stalled = stage.startsWith('CSS') ? url === LINK : url === ASSET
      if (stalled) stalledSignal = init!.signal as AbortSignal
      if (stalled && stage.endsWith('request')) return new Promise<Response>(() => {})
      const r = new Response(url === LINK ? rule() : new Uint8Array([1, 2, 3]))
      if (stalled) Object.defineProperty(r, url === LINK ? 'text' : 'arrayBuffer', { value: () => new Promise(() => {}) })
      return r
    })
    let settled = false
    const request = l.loadPageFonts([LINK]).then(() => { settled = true })
    try {
      await vi.advanceTimersByTimeAsync(29_999)
      expect(l.getPageFontRecord(LINK)?.state).toBe('pending')
      await vi.advanceTimersByTimeAsync(1)
      expect(l.getPageFontRecord(LINK)).toMatchObject({ state: 'failed', cause: expect.stringContaining('timed out after 30 seconds') })
      await request
      expect(settled).toBe(true)
      expect(stalledSignal?.aborted).toBe(true)
      expect(l.registerPageFonts).not.toHaveBeenCalled()
      l.fetch.mockImplementation(async url => new Response(url === LINK ? rule() : new Uint8Array([1, 2, 3])))
      await vi.advanceTimersByTimeAsync(60_000)
      await l.loadPageFonts([LINK])
      expect(l.getPageFontRecord(LINK)?.state).toBe('loaded')
      expect(vi.getTimerCount()).toBe(0)
    } finally { l.cancelPageFontRequests([LINK]) }
  })
  it.each([' ' + LINK, LINK + ' '])('refuses outer whitespace on %j without fetching, with an allowed control', async link => {
    const l = setup()
    await l.loadPageFonts([link])
    expect(l.getPageFontRecord(link)?.state).toBe('refused')
    expect(l.fetch).not.toHaveBeenCalled()
    await l.loadPageFonts([LINK])
    expect(l.getPageFontRecord(LINK)?.state).toBe('loaded')
    expect(l.fetch).toHaveBeenCalledTimes(2)
  })
  it('reads only direct defs, first case-insensitive src, deduplicating exact strings in declaration order', () => {
    const s = scene(LINK, LINK, LINK + '&display=swap')
    s.defs.push({ op: 'font', attrs: { SRC: '  ', src: LINK } }, { op: 'G', attrs: {}, c: [{ op: 'FONT', attrs: { src: 'nested' } }] })
    s.root.push({ op: 'FONT', attrs: { src: 'root' } })
    expect(pageFontLinks(s)).toEqual([LINK, LINK + '&display=swap', '  '])
  })
  it('uses the mod’s OrdinalIgnoreCase attribute helper, including a long s', () => {
    const s = scene(); s.defs.push({ op: 'font', attrs: { 'ſrc': LINK } })
    expect(pageFontLinks(s)).toEqual([LINK])
  })
  it.each([LINK, 'http://fonts.googleapis.com/css2?family=Orbitron', 'https://fonts.googleapis.com.evil.test/css2'])('exercises project/props/source/history and an explicit active-page button for %s', async link => {
    const l = setup(), project = Object.assign(newProject(), { fontsApproved: true })
    const src = `SCENE w=480 h=480\nDEFS {\n FONT src="${link}"\n}\n`
    const parsed = parseSrc(src)
    expect(parsed.errors).toEqual([])
    project.pages[0].scene = fromProps(toProps(parsed.scene!)).scene
    let state = reducer(initialState(), { type: 'loadProject', project: JSON.parse(JSON.stringify(project)) })
    state = reducer(state, { type: 'addPage' })
    state = reducer(state, { type: 'setActivePage', pageId: 'p1' })
    for (let i = 0; i < 5; i++) state = reducer(state, { type: 'setScene', pageId: 'p1', scene: parsed.scene! })
    state = reducer(reducer(state, { type: 'undo' }), { type: 'redo' })
    expect(pageFontLinks(state.project.pages[0].scene)).toEqual([link])
    expect(l.fetch).not.toHaveBeenCalled()
    const button = document.createElement('button')
    let request: Promise<void> | undefined
    button.onclick = () => { request = l.loadPageFonts(pageFontLinks(state.project.pages.find(p => p.id === state.activePageId)!.scene)) }
    button.click(); await request
    expect(l.fetch).toHaveBeenCalledTimes(link === LINK ? 2 : 0)
    expect(l.getPageFontRecord(link)?.state).toBe(link === LINK ? 'loaded' : 'refused')
  })
  it('creates no request/approval state during repeated reads, source changes, page switching or forged saved consent', async () => {
    const l = setup(), s = Object.assign(scene(LINK), { approved: true, fontsApproved: true })
    for (let i = 0; i < 20; i++) { pageFontLinks(s); pageFontLinks(scene(LINK + '&display=swap')); l.getPageFontRecord(LINK) }
    expect(l.fetch).not.toHaveBeenCalled()
    expect(l.getPageFontRecord(LINK)).toBeUndefined()
    await l.loadPageFonts(pageFontLinks(s))
    expect(l.fetch.mock.calls.map(c => c[0])).toEqual([LINK, ASSET])
    expect(l.getPageFontRecord(LINK)).toMatchObject({ state: 'loaded', names: ['Orbitron'] })
  })
  it('does not fetch during callback configuration and fails explicitly when the session is not wired', async () => {
    vi.resetModules()
    const m = await import('./pageFonts'), l = setup()
    await expect(m.loadPageFonts([LINK])).rejects.toThrow('not been configured')
    m.configurePageFonts(l)
    expect(l.fetch).not.toHaveBeenCalled()
    const notified = vi.fn(), stop = m.subscribePageFonts(notified)
    await m.loadPageFonts([LINK]); stop()
    expect(l.fetch).toHaveBeenCalledTimes(2)
    expect(m.getPageFontRecord(LINK)?.state).toBe('loaded')
    expect(notified).toHaveBeenCalled()
    expect(m.pageFontsVersion()).toBeGreaterThan(0)
  })
  it('accepts an ordinary space in a complete Google query without changing its declared spelling', async () => {
    const l = setup(), link = 'https://fonts.googleapis.com/css2?family=Noto Sans JP'
    await l.loadPageFonts([link])
    expect(l.fetch.mock.calls.map(c => c[0])).toEqual([link, ASSET])
    expect(l.getPageFontRecord(link)?.state).toBe('loaded')
  })
  it.each([
    'http://fonts.googleapis.com/css2?family=Orbitron', '//fonts.googleapis.com/css2?family=Orbitron',
    'https://fonts.googleapis.com.evil.test/css2', 'https://fonts.googleapis.com@evil.test/css2',
    'https://user:password@fonts.googleapis.com/css2', 'https://fonts.googleapis.com:444/css2',
    'https://localhost/a.css', 'https://127.0.0.1/a.css', 'https://[::1]/a.css',
    'https://fonts.gstatic.com/a.woff2', 'https://fonts.googleapis.com/a.ttf', 'https://sub.fonts.googleapis.com/css2', '  ', 'javascript:alert(1)',
  ])('refuses %s with no request; the same explicit action loads an allowed positive control', async blocked => {
    const l = setup()
    await l.loadPageFonts(pageFontLinks(scene(blocked)))
    expect(l.fetch).not.toHaveBeenCalled()
    expect(l.getPageFontRecord(blocked)).toMatchObject({ state: 'refused', cause: expect.any(String) })
    await l.loadPageFonts(pageFontLinks(scene(LINK)))
    expect(l.fetch).toHaveBeenCalledTimes(2)
    expect(l.getPageFontRecord(blocked)!.cause).toContain('game refuses HTTP links')
    expect(l.getPageFontRecord(blocked)!.cause).toContain('TTF/OTF')
  })
  it('deduplicates loaded links across pages without sorting or normalizing source spellings', async () => {
    const l = setup()
    await l.loadPageFonts([LINK, LINK])
    await l.loadPageFonts([LINK])
    await l.loadPageFonts([LINK + '&display=swap'])
    expect(l.fetch.mock.calls.map(c => c[0])).toEqual([LINK, ASSET, LINK + '&display=swap'])
  })
  it('deduplicates pending requests and retries failed links only on an explicit action at 60 seconds', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const l = setup()
    l.fetch.mockResolvedValueOnce(new Response('bad request', { status: 400 }))
    const a = l.loadPageFonts([LINK]), b = l.loadPageFonts([LINK])
    await Promise.all([a, b])
    expect(l.fetch).toHaveBeenCalledTimes(1)
    expect(l.getPageFontRecord(LINK)).toMatchObject({ state: 'failed', cause: expect.stringContaining('HTTP 400') })
    expect(l.getPageFontRecord(LINK)!.cause).toContain(LINK)
    vi.setSystemTime(59_000); await l.loadPageFonts([LINK])
    expect(l.fetch).toHaveBeenCalledTimes(1)
    vi.setSystemTime(60_000); pageFontLinks(scene(LINK)); await vi.runAllTimersAsync()
    expect(l.fetch).toHaveBeenCalledTimes(1)
    await l.loadPageFonts([LINK])
    expect(l.getPageFontRecord(LINK)?.state).toBe('loaded')
    expect(l.fetch).toHaveBeenCalledTimes(3)
  })
  it('aborts a running decode when all its links depart and prevents late metadata from registering or changing status', async () => {
    const l = setup(), listener = vi.fn(), unsubscribe = l.subscribePageFonts(listener)
    let reply!: (result: typeof metadata) => void
    l.readFontMetadata.mockImplementation(() => new Promise(resolve => { reply = resolve }))
    const links = [LINK, LINK + '&display=swap'], request = l.loadPageFonts(links)
    await vi.waitFor(() => expect(l.readFontMetadata).toHaveBeenCalledTimes(1))
    const decodeSignal = l.readFontMetadata.mock.calls[0][1]
    l.cancelPageFontRequests(links)
    const version = l.pageFontsVersion()
    reply(metadata); await request
    expect(decodeSignal?.aborted).toBe(true)
    expect(l.registerPageFonts).not.toHaveBeenCalled()
    expect(links.map(l.getPageFontRecord)).toEqual([undefined, undefined])
    expect(l.pageFontsVersion()).toBe(version)
    expect(listener).toHaveBeenCalled(); unsubscribe()
  })
  it('keeps a shared running decode alive until its last link departs', async () => {
    const l = setup(), other = LINK + '&display=swap'
    let finish!: (result: typeof metadata) => void
    l.readFontMetadata.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const request = l.loadPageFonts([LINK, other])
    await vi.waitFor(() => expect(l.readFontMetadata).toHaveBeenCalledTimes(1))
    const decodeSignal = l.readFontMetadata.mock.calls[0][1]
    l.cancelPageFontRequests([LINK])
    const aborted = decodeSignal?.aborted
    finish(metadata); await request
    expect(aborted).toBe(false)
    expect(l.getPageFontRecord(LINK)).toBeUndefined()
    expect(l.getPageFontRecord(other)?.state).toBe('loaded')
  })
  it('does not abort another active link’s shared representative when one declaration departs', async () => {
    const l = setup(), other = LINK + '&display=swap'
    let finish!: (response: Response) => void
    l.fetch.mockImplementation(async (url, init) => url === ASSET ? new Promise<Response>((resolve, reject) => {
      finish = resolve; init!.signal!.addEventListener('abort', () => reject(new Error('aborted representative')))
    }) : new Response(rule()))
    const request = l.loadPageFonts([LINK, other])
    await vi.waitFor(() => expect(l.fetch).toHaveBeenCalledTimes(3))
    l.cancelPageFontRequests([LINK]); finish(new Response(new Uint8Array([1, 2, 3])))
    await request
    expect(l.getPageFontRecord(LINK)).toBeUndefined()
    expect(l.getPageFontRecord(other)?.state).toBe('loaded')
    expect(l.readFontMetadata).toHaveBeenCalledTimes(1)
  })
  it('re-reads representative metadata after a failed structured metadata/registry result on explicit retry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const l = setup()
    l.registerPageFonts.mockImplementationOnce(() => { throw new Error('cannot determine game face names from this served file') })
    await l.loadPageFonts([LINK])
    expect(l.getPageFontRecord(LINK)?.state).toBe('failed')
    vi.setSystemTime(60_000); await l.loadPageFonts([LINK])
    expect(l.readFontMetadata).toHaveBeenCalledTimes(2)
    expect(l.getPageFontRecord(LINK)?.state).toBe('loaded')
  })
  it('retries refusals only on explicit action at 60 seconds, with no timer or passive-read approval', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const l = setup(), blocked = 'http://fonts.googleapis.com/css2?family=Orbitron'
    await l.loadPageFonts([blocked])
    const version = l.pageFontsVersion()
    vi.setSystemTime(59_000); await l.loadPageFonts([blocked])
    expect(l.pageFontsVersion()).toBe(version + 1)
    expect(l.getPageFontRecord(blocked)?.notice).toContain('in 1 second')
    vi.setSystemTime(60_000); pageFontLinks(scene(blocked)); await vi.runAllTimersAsync()
    expect(l.pageFontsVersion()).toBe(version + 1)
    await l.loadPageFonts([blocked])
    expect(l.getPageFontRecord(blocked)!.settledAt).toBe(60_000)
    expect(l.fetch).not.toHaveBeenCalled()
  })
  it('does not impose the game’s 48-link cap and never persists request state in scenes', async () => {
    const l = setup(), s = scene(...Array.from({ length: 49 }, (_, i) => LINK + '&n=' + i)), copy = JSON.stringify(s)
    await l.loadPageFonts(pageFontLinks(s))
    expect(l.registerPageFonts).toHaveBeenCalledTimes(49)
    expect(l.fetch).toHaveBeenCalledTimes(50)
    expect(JSON.stringify(s)).toBe(copy)
  })
})

describe('inert CSS transport', () => {
  it('accepts a CSS weight descriptor marked !important', async () => {
    const l = setup(rule('400 !important'))
    await l.loadPageFonts([LINK])
    expect(l.getPageFontRecord(LINK)?.state).toBe('loaded')
    expect(l.registerPageFonts.mock.calls[0][1][0]).toMatchObject({ weight: '400', minWeight: 400, maxWeight: 400 })
  })
  it('ignores subset failures from a cancelled generation after the same link is loaded again', async () => {
    const l = setup()
    l.registerPageFonts.mockImplementationOnce(() => { l.cancelPageFontRequests([LINK]); return ['Orbitron'] })
    await l.loadPageFonts([LINK])
    const stale = l.registerPageFonts.mock.calls[0][2]
    await l.loadPageFonts([LINK])
    const version = l.pageFontsVersion(), record = l.getPageFontRecord(LINK)
    stale(ASSET, 'stale decode failure')
    expect(l.getPageFontRecord(LINK)).toBe(record)
    expect(l.pageFontsVersion()).toBe(version)
    expect(l.getPageFontRecord(LINK)?.subsetFailures).toEqual([])
    l.registerPageFonts.mock.calls[1][2](ASSET, 'current decode failure')
    expect(l.getPageFontRecord(LINK)?.subsetFailures).toEqual([{ url: ASSET, cause: 'current decode failure' }])
  })
  it('groups subset rules and reuses metadata by exact representative URL across weights and links', async () => {
    const css = Array.from({ length: 248 }, (_, i) => rule(i < 124 ? 'normal' : 'bold', `url('https://fonts.gstatic.com/s/noto/${i % 124}.woff2') format('woff2')`, `U+${(i % 124).toString(16)}`, 'Noto Sans JP')).join('\n')
    const l = setup(css)
    await l.loadPageFonts([LINK])
    expect(l.fetch.mock.calls.map(c => c[0])).toEqual([LINK, 'https://fonts.gstatic.com/s/noto/0.woff2'])
    expect(l.readFontMetadata).toHaveBeenCalledTimes(1)
    const groups = l.registerPageFonts.mock.calls[0][1]
    expect(groups).toHaveLength(2)
    expect(groups.map(g => [g.family, g.weight, g.minWeight, g.maxWeight, g.sources.length])).toEqual([
      ['Noto Sans JP', '400', 400, 400, 124], ['Noto Sans JP', '700', 700, 700, 124],
    ])
    expect(groups[0].sources[1]).toMatchObject({ url: 'https://fonts.gstatic.com/s/noto/1.woff2', unicodeRange: 'U+1', display: 'swap' })
  })
  it('normalizes valid descriptors without rounding and decodes CSS family escapes', async () => {
    const l = setup(rule('425.5 875', undefined, 'U+4??, U+10000-10FFFF', 'Orbit\\72 on'))
    await l.loadPageFonts([LINK])
    expect(l.registerPageFonts.mock.calls[0][1][0]).toMatchObject({ family: 'Orbitron', style: 'normal', weight: '425.5 875', minWeight: 425.5, maxWeight: 875 })
    expect(l.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', referrer: '', mode: 'cors', redirect: 'error' })
    expect(l.fetch.mock.calls[1][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', referrer: '', mode: 'cors', redirect: 'error' })
  })
  it('preserves exact absolute asset spelling for metadata cache identity and accepts default HTTPS ports', async () => {
    const asset = 'https://FONTS.GSTATIC.COM:443/s/orbitron/face.woff2', l = setup(rule('400', `url('${asset}')`))
    await l.loadPageFonts(['https://FONTS.GOOGLEAPIS.COM:443/css2?family=Orbitron'])
    expect(l.fetch.mock.calls.map(c => c[0])).toEqual(['https://FONTS.GOOGLEAPIS.COM:443/css2?family=Orbitron', asset])
    expect(l.registerPageFonts.mock.calls[0][1][0].representative).toBe(asset)
  })
  it('uses CSS defaults only for absent descriptors, and keeps deduplicated delivered names in face order', async () => {
    const l = setup(`@font-face { font-family: Orbitron; src: url('${ASSET}'); }`)
    l.registerPageFonts.mockReturnValue(['Orbitron Bold', 'Orbitron', 'Orbitron Bold'])
    await l.loadPageFonts([LINK])
    expect(l.registerPageFonts.mock.calls[0][1][0]).toMatchObject({ weight: '400', style: 'normal', sources: [{ url: ASSET, unicodeRange: 'U+0-10FFFF', display: 'swap' }] })
    expect(l.getPageFontRecord(LINK)!.names).toEqual(['Orbitron Bold', 'Orbitron'])
  })
  it.each(['no matching named instance', 'browser metadata read budget exhausted'])('fails metadata or matching errors: %s', async cause => {
    const l = setup()
    if (cause.startsWith('no matching')) l.registerPageFonts.mockReturnValue([])
    else l.readFontMetadata.mockRejectedValue(new Error(cause))
    await l.loadPageFonts([LINK])
    expect(l.getPageFontRecord(LINK)).toMatchObject({ state: 'failed', cause: expect.stringContaining(cause.startsWith('no matching') ? 'no matching named instance' : cause) })
  })
  it('reads one representative for each distinct family/style/weight group, rather than every src alternative', async () => {
    const alternatives = Array.from({ length: 100 }, (_, i) => `url('https://fonts.gstatic.com/s/unused/${i}.woff2') format('woff2')`).join(', ')
    const l = setup(rule('400', `local('A, B'), url('https://evil.test/a.woff2'), url('${ASSET}') format('woff2'), ${alternatives}`) + rule('700', `url('${ASSET.replace('face', 'bold')}') format('woff2')`))
    await l.loadPageFonts([LINK])
    expect(l.fetch.mock.calls.map(c => c[0])).toEqual([LINK, ASSET, ASSET.replace('face', 'bold')])
    expect(l.readFontMetadata).toHaveBeenCalledTimes(2)
    expect(l.registerPageFonts.mock.calls[0][1]).toHaveLength(2)
  })
  it.each([LINK, ASSET])('rejects a simulated redirect at %s without contacting its destination', async redirected => {
    const l = setup(), response = new Response(redirected === LINK ? rule() : new Uint8Array([1, 2, 3]))
    Object.defineProperty(response, 'redirected', { value: true })
    l.fetch.mockImplementation(async url => url === redirected ? response : new Response(rule()))
    await l.loadPageFonts([LINK])
    expect(l.getPageFontRecord(LINK)).toMatchObject({ state: 'failed', cause: expect.stringContaining('redirect') })
    expect(l.fetch.mock.calls.map(c => c[0])).toEqual(redirected === LINK ? [LINK] : [LINK, ASSET])
    expect(l.registerPageFonts).not.toHaveBeenCalled()
  })
  it('reports a representative’s actual HTTP failure and URL without claiming a game loader token', async () => {
    const l = setup()
    l.fetch.mockResolvedValueOnce(new Response(rule())).mockResolvedValueOnce(new Response('', { status: 404 }))
    await l.loadPageFonts([LINK])
    expect(l.getPageFontRecord(LINK)).toMatchObject({ state: 'failed', cause: expect.stringContaining(`HTTP 404 for ${ASSET}`) })
    expect(l.readFontMetadata).not.toHaveBeenCalled()
    expect(l.registerPageFonts).not.toHaveBeenCalled()
  })
  it('never attaches stylesheets, imports, selectors or HTML; ignores local and unsupported/off-host alternatives', async () => {
    const css = `@import url('https://evil.test/import.css'); body { background:url('https://evil.test/image'); } ${rule('400', `local('A, B'), url('https://evil.test/font'), url('${ASSET}?x=1,2') format('woff2')`)} <script>alert(1)</script>`
    const l = setup(css), before = document.head.innerHTML
    await l.loadPageFonts([LINK])
    expect(document.head.innerHTML).toBe(before)
    expect(l.fetch.mock.calls.map(c => c[0])).toEqual([LINK, ASSET + '?x=1,2'])
    expect(l.getPageFontRecord(LINK)?.state).toBe('loaded')
  })
  it.each([
    ['weight', rule('0')], ['weight', rule('900 100')], ['weight', rule('heavy')], ['weight', rule('invalid:400')],
    ['style', rule('400', undefined, undefined, undefined, 'upright')],
    ['unicode-range', rule('400', undefined, 'U+110000')], ['unicode-range', rule('400', undefined, 'U+FF-00')],
    ['unicode-range', rule('400', undefined, 'all')],
  ])('fails an invalid %s descriptor before fetching a representative', async (descriptor, css) => {
    const l = setup(css)
    await l.loadPageFonts([LINK])
    expect(l.fetch).toHaveBeenCalledTimes(1)
    expect(l.getPageFontRecord(LINK)).toMatchObject({ state: 'failed', cause: expect.stringContaining(descriptor) })
    expect(l.registerPageFonts).not.toHaveBeenCalled()
  })
  it.each(['https://evil.test/a.woff2', '//fonts.gstatic.com/a.woff2', 'http://fonts.gstatic.com/a.woff2', 'https://user@fonts.gstatic.com/a.woff2', 'https://fonts.gstatic.com:444/a.woff2', '../s/relative.woff2'])('refuses a blocked CSS asset %s; an allowed control makes one representative request', async src => {
    const l = setup(rule('400', `url('${src}') format('woff2')`))
    await l.loadPageFonts([LINK])
    expect(l.fetch).toHaveBeenCalledTimes(1)
    expect(l.readFontMetadata).not.toHaveBeenCalled()
    expect(l.getPageFontRecord(LINK)?.state).toBe('refused')
    const control = setup(); await control.loadPageFonts([LINK])
    expect(control.fetch).toHaveBeenCalledTimes(2)
  })
  it('records late subset failures with URL and cause without discarding other usable names', async () => {
    const l = setup()
    await l.loadPageFonts([LINK])
    l.registerPageFonts.mock.calls[0][2](ASSET, 'browser decode failed')
    expect(l.getPageFontRecord(LINK)).toMatchObject({ state: 'loaded', names: ['Orbitron'], subsetFailures: [{ url: ASSET, cause: 'browser decode failed' }] })
  })
  it('places the narrow font CSP and referrer policy before the module', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain(`content="font-src 'self' https://fonts.gstatic.com"`)
    expect(html).toContain('name="referrer" content="no-referrer"')
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'))
  })
})
