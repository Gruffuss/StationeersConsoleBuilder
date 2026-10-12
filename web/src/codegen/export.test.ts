// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import packageText from '../../package.json?raw'
import lockText from '../../package-lock.json?raw'
import projectText from '../../test/fixtures/exports/unicode.project.json?raw'
import metadataText from '../../test/fixtures/exports/metadata.json?raw'
import { importFont, removeFont, setFontMetadataReader } from '../editor/fonts'
import { configurePageFonts, getPageFontRecord, loadPageFonts } from '../editor/pageFonts'
import { newProject, VECTOR_FLOOR, type Project } from '../model/project'
import { printSrc } from '../srctext/print'
import { BUILDER_VERSION } from '../version'
import { assembleExport } from './export'
import { generate } from './generate'
import { mapError } from './linemap'
import { fixtureProjects } from './testing'

const at = new Date('2026-10-11T12:34:56.000Z'), token = '1.AAAA'
const block = `--[==[ vectorbuilder:project ${token} ]==]\n`
const gen = (p: Project) => generate(p, pg => printSrc(pg.scene))
const assemble = (p: Project, embed: string | null = token) => assembleExport(gen(p), embed, at, '0.4.0')
afterEach(() => vi.unstubAllGlobals())

describe('export artifacts', () => {
  it('stamps one existing line and appends the supplied block last without mutating Generated', () => {
    const g = gen(fixtureProjects().custom), original = structuredClone(g)
    const a = assembleExport(g, token, at, '0.4.0')
    expect(a.lua.split('\n')[0]).toBe(g.lua.split('\n')[0] + ' · builder 0.4.0 · UTC 2026-10-11T12:34:56.000Z')
    expect(a.lua.slice(a.lua.indexOf('\n'), -block.length)).toBe(g.lua.slice(g.lua.indexOf('\n')))
    expect(a.lua.endsWith(block)).toBe(true)
    expect(a.map).toEqual(g.map)
    expect(a.problems).toEqual(g.problems)
    expect(a.date).toBe('2026-10-11T12:34:56.000Z')
    expect(a.embeddedBytes).toBe(41)
    expect(a.totalBytes).toBe(new TextEncoder().encode(a.lua).length)
    expect(g).toEqual(original)
    expect(assembleExport(g, token, at, '0.4.0')).toEqual(a)
  })
  it('keeps the full runnable body and map when embedding is off', () => {
    const g = gen(fixtureProjects().custom), a = assembleExport(g, null, at, '0.4.0')
    expect(a.lua.slice(a.lua.indexOf('\n'))).toBe(g.lua.slice(g.lua.indexOf('\n')))
    expect(a.lua).not.toContain('vectorbuilder:project')
    expect(a.embeddedBytes).toBe(0)
    expect(a.totalBytes).toBe(new TextEncoder().encode(a.lua).length)
    expect(a.map).toEqual(g.map)
  })
  it('uses the package version by default and agrees with both lockfile root versions', () => {
    const pkg = JSON.parse(packageText), lock = JSON.parse(lockText)
    expect(pkg.version).toBe('0.4.0')
    expect(BUILDER_VERSION).toBe(pkg.version)
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
    expect(assembleExport(gen(newProject()), null, at).lua.split('\n')[0]).toContain(`builder ${pkg.version} · UTC ${at.toISOString()}`)
  })
  it.each(['', ' ', '0.4.0\nprint("bad")', '0.4.0\r', '0.4.0\u0085', '0.4.0\u2028', '0.4.0\u2029'])('refuses an empty or multiline version %j', version => {
    expect(() => assembleExport(gen(newProject()), token, at, version)).toThrow(/version/i)
  })
  it('refuses an invalid date', () => {
    expect(() => assembleExport(gen(newProject()), token, new Date(NaN))).toThrow(/date/i)
  })
  it.each(['1.', '2.AAAA', '1xAAAA', '1.AA==', '1.A+A/', '1.AAAA\n', '1.AA ]==] print(1)', '1.漢字'])('refuses an unsafe token %j', unsafe => {
    expect(() => assembleExport(gen(newProject()), unsafe, at)).toThrow(/token/i)
  })
  it.each(['print(1)\n', '-- other header\n', '-- VectorBuilder export'])('refuses a missing complete generator header %j', lua => {
    expect(() => assembleExport({ ...gen(newProject()), lua }, token, at)).toThrow(/header/i)
  })
  it('returns no artifact for failed generation, preserving problems and adding an error only when none exist', () => {
    const g = gen(newProject())
    const problems = [{ level: 'error' as const, message: 'page is unreadable' }]
    expect(assembleExport({ ...g, lua: '', problems }, token, at)).toEqual({ lua: '', map: [], problems, date: at.toISOString(), embeddedBytes: 0, totalBytes: 0 })
    expect(assembleExport({ ...g, lua: '', problems: [] }, token, at).problems).toEqual([{ level: 'error', message: 'no script was generated' }])
    expect(problems).toEqual([{ level: 'error', message: 'page is unreadable' }])
  })
  it('preserves LF and measures UTF-8 bytes rather than UTF-16 units using decoded fixtures', () => {
    const p: Project = JSON.parse(projectText), expected = JSON.parse(metadataText)
    const g = gen(p), a = assemble(p)
    expect(a.lua).not.toContain('\r')
    expect(a.lua.slice(a.lua.indexOf('\n'), -block.length)).toBe(g.lua.slice(g.lua.indexOf('\n')))
    expect(a.lua.split('\n')[0]).toBe(expected.header)
    expect(a.date).toBe(expected.date)
    expect(a.embeddedBytes).toBe(expected.embeddedBytes)
    expect(a.totalBytes).toBe(new TextEncoder().encode(a.lua).length)
    expect(a.totalBytes).toBeGreaterThan(a.lua.length)
    expect(p.customLua).toContain('漢字 🛰️')
    expect(p.pages[0].scene.defs[0].attrs.src).toBe('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700')
    expect(p.simDevices[0].values.Temperature).toEqual({ kind: 'const', v: 295 })
  })
  it.each(['no named face', 'duplicate links', 'over 48 links', 'control characters'])('preserves the entire variable-length FONT preamble, raw scene data, floor and error maps: %s', kind => {
    const p = fixtureProjects()['page-fonts']
    if (kind === 'no named face') {
      p.pages = [newProject().pages[0]]
      p.roles = []
      p.pages[0].scene.defs = [{ op: 'FoNt', attrs: { sRc: 'https://fonts.gstatic.com/direct.ttf' } }]
    }
    if (kind === 'over 48 links') p.pages[0].scene.defs.push(...Array.from({ length: 49 }, (_, i) => ({ op: 'FONT', attrs: { src: `https://fonts.gstatic.com/${i}.ttf` } })))
    const hostile = 'https://fonts.gstatic.com/a\u0000\t\n\u007f\u0085\u2028\u2029.ttf'
    if (kind === 'control characters') p.pages[0].scene.defs.push({ op: 'FONT', attrs: { src: hostile } })
    p.customLua = 'function U.init() error("kept") end\n'
    const before = structuredClone(p), g = gen(p), a = assembleExport(g, token, at, '0.4.0')
    const preamble = g.lua.slice(g.lua.indexOf('\n'), g.lua.indexOf('-- VectorBuilder runtime'))
    expect(a.lua.slice(a.lua.indexOf('\n'), a.lua.indexOf('-- VectorBuilder runtime'))).toBe(preamble)
    expect(a.lua.slice(a.lua.indexOf('\n'), -block.length)).toBe(g.lua.slice(g.lua.indexOf('\n')))
    expect(g.lua.split('\n')[1]).toContain('ScriptedScreens Fonts')
    expect(g.lua).toContain('-- Page downloads require FontApi.RequestFontWithReason (from 0.3.0); late arrivals require FontApi.Registrations (from 0.4.0). Availability depends on the installed build, not a single minimum version.')
    expect(g.lua).toContain('Game limits: 48 distinct links per process; 48 page faces per session, shared across pages, projects and consoles in that process.')
    expect(g.lua).toContain("-- Faces built by requests count; cached faces (earlier downloads or the player's own folder) cost nothing; a name clash still counts; failed or disabled faces do not. Existing/shared player fonts affect actual session usage.")
    expect(a.lua).toContain('floor = 11118')
    expect(a.lua).toContain('lt(ver,11118)')
    if (kind === 'no named face') expect(g.lua.split('\n')[1]).toBe(`-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector ${VECTOR_FLOOR} or newer and ScriptedScreens Fonts.`)
    if (kind === 'duplicate links') {
      const links = g.lua.split('\n').filter(l => l.startsWith('-- FONT link: '))
      expect(links).toEqual([
        '-- FONT link: https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700',
        '-- FONT link: https://fonts.gstatic.com/direct.ttf',
        '-- FONT link: https://blocked.example/font.otf',
        '-- FONT link: https://fonts.googleapis.com/css2?family=Roboto:wght@100..900',
        '-- FONT link: https://fonts.gstatic.com/quoted"\\link\\nnext.woff2',
      ])
    }
    if (kind === 'over 48 links') expect(a.problems).toContainEqual({ level: 'warning', message: "This project's 54 distinct FONT links exceed the game's shared 48-link process limit; source and export remain available." })
    if (kind === 'control characters') expect(g.lua).toContain('-- FONT link: https://fonts.gstatic.com/a\\u0000\\t\\n\\u007f\\u0085\\u2028\\u2029.ttf\n')
    const custom = g.map.find(e => e.part === 'custom')!
    expect(mapError(`[string "chip"]:${custom.first}: kept`, a.map)).toBe('custom code line 1: kept')
    expect(a.map).toEqual(g.map)
    expect(p).toEqual(before)
  })
  it('keeps artifact bytes and warnings independent of local font import/removal without requesting a font', async () => {
    const fetch = vi.fn(() => { throw new Error('unexpected network request') })
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    vi.stubGlobal('document', { fonts: { add() {}, delete() {} } })
    setFontMetadataReader(async () => ({ status: 'failed', cause: 'test metadata unavailable' }))
    const p = newProject()
    p.pages[0].scene.header.font = 'Artifact Test Face'
    const before = gen(p), artifact = assemble(p)
    expect(artifact.lua).toContain('Artifact Test Face')
    try {
      await importFont('Artifact Test Face', new ArrayBuffer(8), false)
      expect(gen(p)).toEqual(before)
      expect(assemble(p)).toEqual(artifact)
    } finally { await removeFont('Artifact Test Face') }
    expect(gen(p)).toEqual(before)
    expect(assemble(p)).toEqual(artifact)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps artifacts and warnings unchanged through idle, pending and settled page-font delivery; export itself grants no consent', async () => {
    const link = 'https://fonts.googleapis.com/css2?family=ArtifactTest', asset = 'https://fonts.gstatic.com/artifact.ttf'
    let finish!: (response: Response) => void
    const fetch = vi.fn<typeof globalThis.fetch>(url => url === link ? new Promise(resolve => { finish = resolve }) : Promise.resolve(new Response(new Uint8Array([1]))))
    configurePageFonts({ fetch, readFontMetadata: async () => ({ family: 'Artifact Test Face' }), registerPageFonts: () => ['Artifact Test Face'] })
    const p = newProject()
    p.pages[0].scene.defs = [{ op: 'FONT', attrs: { src: link } }]
    const before = gen(p), artifact = assemble(p)
    expect(artifact.lua).toContain(link)
    expect(fetch).not.toHaveBeenCalled()
    expect(getPageFontRecord(link)).toBeUndefined()
    const loading = loadPageFonts([link])
    expect(getPageFontRecord(link)?.state).toBe('pending')
    expect(gen(p)).toEqual(before)
    expect(assemble(p)).toEqual(artifact)
    expect(fetch).toHaveBeenCalledTimes(1)
    finish(new Response(`@font-face { font-family: 'ArtifactTest'; src: url('${asset}'); }`))
    await loading
    expect(getPageFontRecord(link)?.state).toBe('loaded')
    expect(gen(p)).toEqual(before)
    expect(assemble(p)).toEqual(artifact)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
