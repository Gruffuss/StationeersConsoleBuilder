import { afterEach, describe, expect, it, vi } from 'vitest'
import { newPage, newProject, type Project } from '../model/project'
import type { SrcNode } from '../model/scene'
import { printChecked } from '../srctext/print'
import * as themes from '../theme'
import { instance } from '../widgets/testing'
import { readTraps } from './checks'
import { exportProblems } from './exportProblems'
import { generate } from './generate'
import { fixtureProjects } from './testing'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const below = (p: Project) => exportProblems(p).filter(x => x.message.includes('below'))
const persist = (p: Project) => exportProblems(p).filter(x => /128|8192|32768/.test(x.message))
const report = (p: Project) => [...generate(p, pg => printChecked(pg.scene)).problems, ...exportProblems(p)]
const saved = (name = 'caption', init: string | number | boolean = '', type: 'string' | 'number' | 'bool' | 'enum' = 'string') => {
  const p = newProject()
  p.state = [{ name, type, init, mirrorBytes: 1 }]
  return p
}
const set = (p: Project, value: string) => {
  p.actions = [{ id: 'setCaption', on: 'button', do: [{ op: 'set', state: p.state[0].name, value }] }]
  return p
}

describe('static export diagnostics', () => {
  it('lists distinct picture sources as information with decoded bytes, host and game path', () => {
    const p = newProject()
    p.pages[0].scene.root = [
      { op: 'IMG', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } },
      { op: 'G', attrs: {}, c: [{ op: 'IMG', attrs: { SRC: 'https://example.com/a.png' } }] },
      { op: 'IMG', attrs: { src: 'file:///b.png' } },
      { op: 'IMG', attrs: { src: 'https://example.com/a.png' } }, { op: 'IMG', attrs: {} },
    ]
    p.pages.push({ ...p.pages[0], id: 'p2', surface: 'other' })
    const xs = exportProblems(p)
    expect(xs).toHaveLength(3)
    expect(xs.every(x => x.level === 'info')).toBe(true)
    expect(xs[0].message).toContain('8 bytes')
    expect(xs[1].message).toContain('example.com')
    expect(xs[1].message).toContain('the game downloads it on each console, once per session')
    expect(xs[2].message).toContain('/b.png')
    expect(xs[2].message).toContain("read from the game machine's disk; nothing checks it here")
  })
  it('reports existing generator findings and read traps once alongside the Task 4 checks', () => {
    const p = newProject()
    p.pages[0].scene.root = [
      { op: 'R', attrs: { f: '$paint', w: '$unbound' } },
      { op: 'T', attrs: { size: 24, font: 'Absent', text: '<font="Manrope">x</font>' } },
    ]
    p.pages[0].preview = { unbound: 1 }
    p.bindings.paint = { from: 'const', value: 42 }
    const page = newPage(p)
    page.scene.defs = Array.from({ length: 49 }, (_, i) => ({ op: 'FONT', attrs: { src: `https://fonts.googleapis.com/css2?family=Face${i}` } }))
    p.pages.push(page)
    p.customLua = 'local n = string.format("%d", 1.5)'
    p.state = [{ name: 'caption', type: 'string', init: '', mirrorBytes: 1000 }]
    const generated = generate(p, pg => printChecked(pg.scene)).problems
    const messages = ['unbound data names send their samples', 'font "Absent"', 'font tag "Manrope"',
      'FONT downloads and face availability', '49 distinct FONT links exceed', '%d needs an integer', 'chip-memory mirror needs']
    expect(messages.map(message => generated.filter(x => x.message.includes(message)).length)).toEqual([1, 1, 1, 1, 1, 1, 1])
    const union = [...generated, ...exportProblems(p)]
    expect(messages.map(message => union.filter(x => x.message.includes(message)).length)).toEqual([1, 1, 1, 1, 1, 1, 1])
    const traps = readTraps(p, themes.themeOf(p))
    expect(traps).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('magenta') }))
    expect([...union, ...traps].filter(x => x.message.includes('magenta'))).toHaveLength(1)
    expect(exportProblems(p)).toEqual([])
  })

  it('warns for small literal text without refusing what the mod draws', () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    p.pages[0].scene.root = [
      { op: 'T', attrs: { sIzE: 23, text: 'small', v: 0 } },
      { op: 'T', attrs: { SIZE: 24, text: 'floor' } },
      { op: 'T', attrs: { size: '=$n', text: 'dynamic' } },
    ]
    expect(below(p)).toEqual([expect.objectContaining({ level: 'warning', message: expect.stringContaining('written'),
      location: { page: 'p1', ref: { inDefs: false, path: [0] }, key: 'sIzE' } })])
    expect(exportProblems(p).some(x => x.level === 'error')).toBe(false)
    expect(exportProblems(p).filter(x => x.level === 'info' && x.message.includes('size'))).toHaveLength(1)
  })

  it('checks min_size only with the text node’s own literal shrink fit', () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    p.pages[0].scene.header.min_size = 10
    p.pages[0].scene.root = [
      { op: 'T', attrs: { fit: 'shrink', min_size: 23, size: 24 } },
      { op: 'T', attrs: { FIT: 'shrink', MIN_SIZE: 24, SIZE: 24 } },
      { op: 'T', attrs: { min_size: 10, size: 24 } },
      { op: 'G', attrs: { fit: 'shrink', min_size: 10 }, c: [{ op: 'T', attrs: { size: 24 } }] },
      { op: 'T', attrs: { fit: '=$fit', min_size: 10, size: 24 } },
    ]
    expect(below(p)).toEqual([expect.objectContaining({ level: 'warning',
      location: { page: 'p1', ref: { inDefs: false, path: [0] }, key: 'min_size' } })])
    expect(exportProblems(p).filter(x => x.level === 'info' && x.message.includes('size'))).toHaveLength(1)
  })

  it('keeps inherited sizes and rich-run TMP units outside the literal text check', () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    p.pages[0].scene.header.size = 10
    p.pages[0].scene.root = [{ op: 'G', attrs: { size: 10 }, c: [
      { op: 'T', attrs: { text: 'inherited' } },
      { op: 'T', attrs: { size: 24, cspace: 10, text: '<size=1><cspace=1>x</cspace></size>' } },
    ] }]
    expect(below(p)).toEqual([])
    expect(exportProblems(p).filter(x => x.level === 'info' && x.message.includes('size'))).toHaveLength(1)
  })

  it('walks deep roots and definitions with real structured locations for arbitrary page IDs', () => {
    const p = newProject(); p.theme = 'vanilla-plus'; p.pages[0].id = 'a/page : [id] 🚀'
    let n: SrcNode = { op: 'T', attrs: { size: 23 } }
    for (let i = 0; i < 10000; i++) n = { op: 'G', attrs: {}, c: [n] }
    p.pages[0].scene.root = [n]
    p.pages[0].scene.defs = [{ op: 'SYM', attrs: { id: 's' }, c: [{ op: 'T', attrs: { SIZE: 23 } }] }]
    const xs = below(p)
    expect(xs).toHaveLength(2)
    expect(xs[0].location).toEqual({ page: p.pages[0].id, ref: { inDefs: false, path: Array(10001).fill(0) }, key: 'size' })
    expect(xs[1].location).toEqual({ page: p.pages[0].id, ref: { inDefs: true, path: [0, 0] }, key: 'SIZE' })
  })

  it('uses the native expansion’s fontSize and the selected theme floor', () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    p.pages[0].natives = [{ type: 'textinput', uid: 'native-text', params: {} }]
    const t = themes.themeOf(p)
    vi.spyOn(themes, 'themeOf').mockReturnValue({ ...t, geo: { ...t.geo, floor: 1000 } })
    expect(below(p)).toEqual([expect.objectContaining({ level: 'warning', owner: expect.stringContaining(p.pages[0].natives[0].uid) })])
  })

  it.each(['required', 'type', 'gradient', 'shadow'])('errors before theme consumers run when a %s colour role is missing', kind => {
    const p = newProject(), t = themes.themeOf(p), colors = { ...t.colors }
    const role = kind === 'required' ? themes.ROLES[0] : 'missing-role'
    delete colors[role]
    vi.spyOn(themes, 'themeOf').mockReturnValue({ ...t, colors,
      type: kind === 'type' ? { ...t.type, hero: { ...t.type.hero, ink: role } } : t.type,
      gradients: kind === 'gradient' ? { ...t.gradients, bad: [role, role] } : t.gradients,
      shadows: kind === 'shadow' ? { ...t.shadows, bad: [[0, 0, 1, 0, role]] } : t.shadows,
    })
    p.pages[0].natives = [instance('textinput')]
    const xs = exportProblems(p)
    expect(xs).toEqual([expect.objectContaining({ level: 'error', owner: expect.stringContaining(role) })])
  })

  it('keeps magenta traps, sample information and mirror errors in their existing sources', () => {
    const p = newProject()
    p.pages[0].scene.root = [{ op: 'R', attrs: { f: '$paint', w: '$unbound' } }]
    p.bindings.paint = { from: 'const', value: 42 }
    p.pages[0].preview = { unbound: 1 }
    expect(readTraps(p, themes.themeOf(p))).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('magenta') }))
    expect(report(p)).toContainEqual(expect.objectContaining({ level: 'info', message: expect.stringContaining('samples') }))
    expect(report(p).some(x => x.level === 'error')).toBe(false)
    p.state = [{ name: 'caption', type: 'string', init: '', mirrorBytes: 1000 }]
    expect(report(p)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('mirror') }))
  })

  it('leaves Lua compilation and accepted scene faults to the existing streams', () => {
    const p = newProject()
    p.customLua = 'local x = ! invalid Lua\nstring.format("%d", 1.5)'
    p.pages[0].scene.root = [{ op: 'T', attrs: { size: 24, unknown: 1 } }]
    expect(exportProblems(p).some(x => x.level === 'error')).toBe(false)
    expect(report(p)).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('%d') }))
  })

  it('leaves malformed scene errors to generation before static readers traverse it', () => {
    const p = newProject()
    p.pages[0].scene.root = null as unknown as SrcNode[]
    expect(report(p)).toContainEqual(expect.objectContaining({ level: 'error', owner: 'page p1' }))
    expect(report(p).filter(x => x.level === 'error')).toHaveLength(1)
    expect(exportProblems(p)).toEqual([])
  })

  it('reports unavailable font attributes and rich tags separately, independent of local import', async () => {
    const { importFont, removeFont } = await import('../editor/fonts')
    vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this) } })
    vi.stubGlobal('document', { fonts: { add() {}, delete() {} } })
    const p = newProject()
    p.pages[0].scene.root = [{ op: 'T', attrs: { size: 24, font: 'Absent', text: '<font="Manrope">x</font>' } }]
    const xs = report(p)
    expect(xs.filter(x => x.level === 'warning')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('font "Absent"') }),
      expect.objectContaining({ message: expect.stringContaining('font tag "Manrope"') }),
    ])
    try { await importFont('Manrope', new ArrayBuffer(8), false); expect(report(p)).toEqual(xs) }
    finally { await removeFont('Manrope') }
    expect(report(p)).toEqual(xs)
  })

  it('keeps FONT faults and more than 48 links as warnings without fetching or capping', async () => {
    const { configurePageFonts, loadPageFonts, cancelPageFontRequests } = await import('../editor/pageFonts')
    const { clearFontNotices } = await import('../editor/fonts')
    let complete!: (r: Response) => void
    const link = 'https://fonts.googleapis.com/css2?family=Absent'
    configurePageFonts({ fetch: () => new Promise<Response>(resolve => { complete = resolve }),
      readFontMetadata: async () => ({}), registerPageFonts: () => [] })
    const p = newProject()
    p.pages[0].scene.defs = [
      { op: 'FONT', attrs: { src: 'not a url' } }, { op: 'FONT', attrs: { src: 'http://blocked.test/x' } },
      ...Array.from({ length: 49 }, (_, i) => ({ op: 'FONT', attrs: { src: i ? `${link}${i}` : link } })),
    ]
    const before = report(p)
    expect(before).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('48-link') }))
    expect(before.some(x => x.level === 'error')).toBe(false)
    const pending = loadPageFonts([link])
    expect(report(p)).toEqual(before)
    complete(new Response(''))
    try { await pending; expect(report(p)).toEqual(before) }
    finally { cancelPageFontRequests([link]); clearFontNotices() }
    expect(p.pages[0].scene.defs).toHaveLength(51)
  })

  it('checks all current fixture projects without introducing a compiler or scene severity override', () => {
    for (const p of Object.values(fixtureProjects())) expect(exportProblems(p).some(x => x.level === 'error')).toBe(false)
  })
})

describe('persistence certainty', () => {
  it.each(['bool', 'number', 'enum'] as const)('does not warn for %s action values that fit their saved representation', type => {
    const p = saved('safe', type === 'bool' ? false : 0, type)
    p.state[0].options = ['zero', 'one']
    p.actions = [{ id: 'safeActions', on: 'button', when: 'P.enabled', do: [
      { op: 'toggle', state: 'safe' }, { op: 'cycle', state: 'safe' },
      { op: 'step', state: 'safe', by: 1, min: 0, max: 'P.limit' }, { op: 'set', state: 'safe', value: 'P.value' },
    ] }]
    expect(persist(p)).toEqual([])
  })

  it.each(['header', 'group'] as const)('recognizes mixed-case inherited shrink fit on the %s', where => {
    const p = newProject(); p.theme = 'vanilla-plus'
    const text: SrcNode = { op: 'T', attrs: { size: 24 } }
    p.pages[0].scene.root = where === 'group' ? [{ op: 'G', attrs: { FiT: 'sHrInK' }, c: [text] }] : [text]
    if (where === 'header') { delete p.pages[0].scene.header.fit; p.pages[0].scene.header.FIT = 'SHRINK' }
    expect(below(p)).toEqual([])
    expect(exportProblems(p).filter(x => x.level === 'info' && x.message.includes('size'))).toHaveLength(1)
  })

  it('does not warn about a guarded or unchanged string literal that fits', () => {
    const p = set(saved('caption', 'small'), '"small"')
    p.actions[0].when = 'P.enabled'
    expect(persist(p)).toEqual([])
    set(p, '"changed"'); expect(persist(p)).toEqual([])
    set(p, 'P.caption'); expect(persist(p)).toContainEqual(expect.objectContaining({ level: 'warning' }))
  })

  it.each(['bool', 'number', 'enum'] as const)('still warns for a %s dynamic write with an overlong key', type => {
    const p = set(saved('x'.repeat(124), type === 'bool' ? false : 0, type), 'P.value')
    expect(persist(p)).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('128-byte key') }))
  })

  it('warns about oversized init but errors only on a provable saving action', () => {
    const p = saved('caption', '🚀'.repeat(2049))
    expect(persist(p)).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('8192') }))
    expect(exportProblems(p).some(x => x.level === 'error')).toBe(false)
    p.state[0].init = ''
    set(p, '"' + '🚀'.repeat(2049) + '"')
    expect(persist(p)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('setCaption') }))
    expect(persist(p).find(x => x.level === 'error')?.message).toMatch(/invok/)
    expect(persist(p).find(x => x.level === 'error')?.message).toMatch(/false/)
    p.state[0].save = false
    expect(persist(p)).toEqual([])
  })

  it.each([[123, false], [124, true]] as const)('counts the vb:t: prefix in a %i-byte state name', (length, oversized) => {
    const p = saved('x'.repeat(length))
    expect(persist(p).some(x => x.message.includes('128'))).toBe(oversized)
    expect(persist(p).some(x => x.level === 'error')).toBe(false)
    set(p, '"changed"')
    expect(persist(p).some(x => x.level === 'error' && x.message.includes('128'))).toBe(oversized)
  })

  it.each(['number', 'bool', 'enum'] as const)('counts vb:s: for %s states and honours coercion', type => {
    const p = saved('x'.repeat(124), type === 'bool' ? false : 0, type)
    if (type === 'enum') p.state[0].options = ['zero', 'one']
    set(p, type === 'bool' ? '"0"' : '"0"')
    expect(persist(p).some(x => x.level === 'error')).toBe(false)
    set(p, type === 'bool' ? 'true' : '"1"')
    expect(persist(p)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('vb:s:') }))
    p.state[0].save = false
    expect(persist(p)).toEqual([])
  })

  it('does not mistake clamped or unconvertible numbers for a change', () => {
    const p = saved('x'.repeat(124), 0, 'number'); p.state[0].max = 0
    set(p, '1')
    expect(persist(p).some(x => x.level === 'error')).toBe(false)
    set(p, '"not a number"')
    expect(persist(p).some(x => x.level === 'error')).toBe(false)
  })

  it('does not prove a refusal when another action on the same event replaces the value before saving', () => {
    const p = set(saved(), '"' + 'x'.repeat(8193) + '"')
    p.actions.push({ id: 'replaceCaption', on: 'button', do: [{ op: 'set', state: 'caption', value: '"small"' }] })
    expect(persist(p).some(x => x.level === 'error')).toBe(false)
  })

  it.each(['"0b1"', '"0o1"'])('does not use JavaScript numeric coercion to prove the Lua string %s changes a number', value => {
    const p = set(saved('x'.repeat(124), 0, 'number'), value)
    expect(persist(p).some(x => x.level === 'error')).toBe(false)
  })

  it('does not treat fully literal floor-sized text without shrink as an uncertain size', () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    p.pages[0].scene.root = [{ op: 'T', attrs: { size: 24, min_size: 10, text: 'floor' } }]
    expect(exportProblems(p).filter(x => x.message.includes('size'))).toEqual([])
  })

  it('recognizes the mod’s case-insensitive shrink spelling', () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    p.pages[0].scene.root = [{ op: 'T', attrs: { SIZE: 24, FIT: 'SHRINK', MIN_SIZE: 23 } }]
    expect(below(p)).toEqual([expect.objectContaining({ location: { page: 'p1', ref: { inDefs: false, path: [0] }, key: 'MIN_SIZE' } })])
  })

  it.each(['unchanged', 'guarded', 'expression', 'escaped', 'call', 'multiple'])('warns rather than proving an %s write', kind => {
    const value = 'x'.repeat(8193), p = saved('caption', kind === 'unchanged' ? value : '')
    set(p, kind === 'expression' ? 'S.other' : kind === 'escaped' ? '"' + value + '\\n"' : '"' + value + '"')
    if (kind === 'guarded') p.actions[0].when = 'true'
    if (kind === 'call') p.actions[0].do.unshift({ op: 'call', fn: 'change' })
    if (kind === 'multiple') p.actions[0].do.push({ op: 'set', state: 'caption', value: '"small"' })
    const xs = persist(p)
    expect(xs.some(x => x.level === 'error')).toBe(false)
    expect(xs).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('setCaption') }))
  })

  it.each(['"é"', '"🚀"', '"\ud800"', '[[\ntext]]', '[=[\r\ntext]=]', 'false', '123'])('proves a complete literal %j changes a string', value => {
    const p = set(saved('x'.repeat(124)), value)
    expect(persist(p)).toContainEqual(expect.objectContaining({ level: 'error' }))
  })

  it('applies Lua long-string initial newline removal at the 8192-byte boundary', () => {
    const p = set(saved(), '[[\n' + 'x'.repeat(8192) + ']]')
    expect(persist(p).some(x => x.message.includes('8192'))).toBe(false)
    set(p, '[=[\n' + 'x'.repeat(8193) + ']=]')
    expect(persist(p)).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('8192') }))
  })

  it('uses vb:r: only for scanned one-role picks and treats labels and choices as uncertain', () => {
    const p = newProject()
    p.roles = [
      { id: 'x'.repeat(124), name: 'Scanned', mode: 'one', prefabs: [], label: '🚀'.repeat(2049) },
      { id: 'pinned', name: 'Pinned', mode: 'one', prefabs: [], pin: 0, label: 'x'.repeat(8193) },
      { id: 'all', name: 'All', mode: 'all', prefabs: [], label: 'x'.repeat(8193) },
      { id: 'fixed', name: 'Fixed', mode: 'one', prefabs: [], ref: 2, label: 'x'.repeat(8193) },
    ]
    const xs = persist(p)
    expect(xs.some(x => x.level === 'error')).toBe(false)
    expect(xs).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('vb:r:') }))
    expect(xs.some(x => /pinned|fixed|All/.test(x.message))).toBe(false)
    expect(xs).toContainEqual(expect.objectContaining({ message: expect.stringContaining('choice') }))
  })

  it('does not infer state writes from device rules', () => {
    const p = saved('x'.repeat(124), 'x'.repeat(8193))
    p.rules = [{ id: 'deviceWrite', role: 'r', lt: { name: 'On' }, value: '1' }]
    expect(persist(p).some(x => x.level === 'error')).toBe(false)
    expect(persist(p).some(x => x.message.includes('deviceWrite'))).toBe(false)
  })

  it('warns for a speculative total over 32768 and never sums init as an inevitable write', () => {
    const p = newProject()
    p.state = Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, type: 'string', init: 'x'.repeat(7000), mirrorBytes: 1 }))
    expect(persist(p)).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringContaining('32768') }))
    expect(persist(p).find(x => x.message.includes('32768'))?.message).toMatch(/unprobed/)
    expect(exportProblems(p).some(x => x.level === 'error')).toBe(false)
  })
})
