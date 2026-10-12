import { afterEach, expect, it, vi } from 'vitest'
import { fixtureProjects } from '../codegen/testing'
import { newPage, newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { instance } from '../widgets/testing'
import { projectText, compressProject, decompressProject } from './codec'
import { embeddedToken, fragmentToken, readProject } from './input'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it.each(['theme', 'background'] as const)('rejects a 100,000-deep wrong-shaped %s with a readable reason in the reader and reducer', field => {
  let deep: unknown = 'bad'
  for (let i = 0; i < 100_000; i++) deep = [deep]
  const p = newProject()
  if (field === 'theme') p.theme = deep as never
  else p.pages[0].background = deep as never
  expect(() => reducer(initialState(), { type: 'loadProject', project: p })).toThrow(new RegExp('Unreadable project.*' + field))
  const clean = newProject()
  if (field === 'theme') clean.theme = 'DEEP_FIELD'
  else clean.pages[0].background = ['DEEP_FIELD']
  const text = JSON.stringify(clean).replace('"DEEP_FIELD"', '['.repeat(100_000) + '"bad"' + ']'.repeat(100_000))
  expect(() => readProject(text)).toThrow(new RegExp('Unreadable project.*' + field))
})
it('normalizes an unknown legacy theme with a notice so the selected default is editable', () => {
  const p = newProject(); p.theme = 'dark-steel'
  const read = readProject(JSON.stringify(p))
  expect(read.project.theme).toBe('neutral')
  expect(read.notice).toContain('unknown theme "dark-steel": using Neutral')
  const loaded = reducer(initialState(), { type: 'loadProject', project: p })
  expect(loaded.project.theme).toBe('neutral')
  expect(reducer(loaded, { type: 'setTheme', theme: 'vanilla-plus' }).project.theme).toBe('vanilla-plus')
})


it.each(['roles', 'reads', 'state', 'actions', 'rules', 'bindings', 'settings', 'simDevices', 'customLua', 'target', 'size', 'shape', 'background', 'preview', 'natives'])('reports repairs to malformed %s and is quiet on the repaired project', field => {
  const p = newProject()
  const values: Record<string, unknown> = { bindings: [], size: 'x', shape: 'wrong', background: [] }
  const value = values[field] ?? 5
  if (['size', 'shape', 'background', 'preview', 'natives'].includes(field)) Object.assign(p.pages[0], { [field]: value })
  else Object.assign(p, { [field]: value })
  const read = readProject(JSON.stringify(p))
  expect(read.notice).toContain('Repaired project fields:')
  expect(read.notice).toContain(field)
  expect(readProject(projectText(read.project)).notice).toBe('')
})
it('does not announce repairs to an already valid project', () => {
  expect(readProject(projectText(newProject())).notice).toBe('')
})

function inputSession() {
  let current = reducer(initialState(), { type: 'renamePage', pageId: 'p1', name: 'authored' })
  return { state: () => current, load: (text: string) => {
    const read = readProject(text)
    current = reducer(current, { type: 'loadProject', project: read.project })
  } }
}
it('the input boundary harness commits a valid replacement and retains its previous authored state in history', () => {
  const session = inputSession(), before = session.state(), replacement = newProject(); replacement.name = 'imported'
  session.load(projectText(replacement))
  expect(session.state().project.name).toBe('imported')
  expect(session.state().past.at(-1)?.project).toBe(before.project)
})

const page = () => newProject().pages[0]
const hostile: unknown[] = [null, [], {}, { pages: [] }, { pages: [null] }, { version: 2, pages: [page()] },
  ...[null, '1', 0, -1, true].map(version => ({ version, pages: [page()] })),
  { pages: [page(), page()] }, { pages: [page(), { ...page(), id: 'p2' }] },
  ...['', 0, null].map(id => ({ pages: [{ ...page(), id }] })),
  { name: 1, pages: [page()] }, { pages: [{ ...page(), name: null }] },
  ...[null, [], 1, 'scene'].map(scene => ({ pages: [{ ...page(), scene }] })),
  ...[{ header: [], defs: [], root: [] }, { header: {}, defs: null, root: [] }, { header: {}, defs: [], root: [null] },
    { header: {}, defs: [], root: [{ op: 1, attrs: {} }] }, { header: {}, defs: [], root: [{ op: 'R', attrs: [] }] },
    { header: {}, defs: [], root: [{ op: 'G', attrs: {}, c: {} }] }, { header: { x: true }, defs: [], root: [] },
    { header: { x: [null] }, defs: [], root: [] }, { header: {}, defs: [], root: [], notes: [] },
    { header: {}, defs: [], root: [], notes: { tail: [0] } },
    { header: {}, defs: [], root: [{ op: 'R', attrs: {}, comments: [0] }] },
    { header: {}, defs: [], root: [{ op: 'R', attrs: {}, eol: 1 }] },
    { header: {}, defs: [], root: [{ op: 'R', attrs: {}, tail: 'x' }] }].map(scene => ({ pages: [{ ...page(), scene }] }))]

it.each(hostile.map((value, i) => [i, value] as const))('rejects hostile outer/scene shape %i without replacing current state', (_, value) => {
  const session = inputSession(), before = structuredClone(session.state())
  let failure: unknown
  try { session.load(JSON.stringify(value)) } catch (error) { failure = error }
  expect(session.state()).toEqual(before)
  expect(failure).toBeInstanceOf(Error)
})

it('names the unreadable page/field and newer version', () => {
  expect(() => readProject('{')).toThrow(/JSON/i)
  expect(() => readProject('{"pages":[]}')).toThrow(/page/i)
  expect(() => readProject(JSON.stringify({ pages: [{ ...page(), scene: { header: { bad: 1e309 }, defs: [], root: [] } }] }))).toThrow(/p1.*header.*bad/i)
  expect(() => readProject(JSON.stringify({ version: 2, pages: [page()] }))).toThrow('made by a newer builder')
})

it('fills legacy names/version and returns the original sanitizer notice', () => {
  const legacy = { pages: [{ id: 'p1', surface: 'main', scene: { header: {}, defs: [], root: [] }, natives: [{ type: 'unknown', uid: 'x1' }] }] }
  const result = readProject(JSON.stringify(legacy))
  const expected = reducer(initialState(), { type: 'loadProject', project: { ...legacy, version: 1, name: 'Untitled', pages: [{ ...legacy.pages[0], name: 'p1' }] } as unknown as ReturnType<typeof newProject> })
  expect(result.project).toEqual(expected.project)
  expect(result.notice).toBe(expected.notice)
  expect(result.notice).not.toBe('')
  expect(reducer(initialState(), { type: 'loadProject', project: result.project }).notice).toBe('')
})

it('ignores foreign project state with notice, preserving own prototype-like scene keys', () => {
  const p = newProject()
  p.pages[0].scene.root = [{ op: 'unknown', attrs: JSON.parse('{"__proto__":"x","constructor":[1,"a"]}') }]
  const value = { ...JSON.parse(JSON.stringify(p)), ...JSON.parse('{"consent":true,"fontBytes":[1],"__proto__":{"polluted":true}}') }
  const read = readProject(JSON.stringify(value))
  expect(read.project).not.toHaveProperty('consent')
  expect(read.notice).toMatch(/ignored/i)
  expect(read.project.pages[0].scene.root[0].attrs).toEqual(p.pages[0].scene.root[0].attrs)
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
})

it('preserves all direct FONT declarations and never grants consent or fetches', async () => {
  const fetch = vi.fn(() => { throw new Error('unexpected network') })
  vi.stubGlobal('fetch', fetch)
  const p = fixtureProjects()['page-fonts']
  p.pages.push({ ...newPage(p), natives: [instance('icon')] })
  p.pages[0].scene.defs.push({ op: 'FoNt', attrs: { SrC: '   ', constructor: 'face' }, comments: ['exact'], eol: 'same' },
    { op: 'FONT', attrs: { src: 'not a URL' } })
  p.pages[0].scene.root.push({ op: 'G', attrs: {}, c: [{ op: 'FONT', attrs: { src: 'https://example.invalid/root.ttf' } }] })
  Object.assign(p, { consent: true, fontBytes: [1], cachedFaces: ['secret'] })
  const text = projectText(p), token = await compressProject(p)
  for (const restored of [readProject(text), readProject(await decompressProject(token)),
    readProject(await decompressProject(fragmentToken('#p=' + token)!)),
    readProject(await decompressProject(embeddedToken('--[==[ vectorbuilder:project ' + token + ' ]==]')!))]) {
    expect(restored.project.pages.map(p => p.scene)).toEqual(p.pages.map(p => p.scene))
    expect(projectText(restored.project)).not.toMatch(/fontBytes|cachedFaces|consent|secret/)
  }
  expect(fetch).not.toHaveBeenCalled()
})

it('whole-load is idempotent for the rich corpus and repaired widgets', () => {
  const corpus = fixtureProjects()
  const repaired = structuredClone(corpus.dashboard)
  repaired.pages[0].scene.root[0].attrs.x = 123
  repaired.pages[0].natives = [{ type: 'unknown', uid: 'x1', params: {} }]
  for (const p of [...Object.values(corpus), repaired]) {
    const once = readProject(projectText(p))
    const twice = readProject(projectText(once.project))
    expect(projectText(twice.project)).toBe(projectText(once.project))
  }
})

it.each(['#p=', '#p=1.A&p=1.B', '#p=2.AA', '#p=1.A', '#p=1.AA=', '#p=1.AA%ZZ', '#%70=1.AA&p=1.BB'])('rejects malformed project fragment %s', hash => {
  expect(() => fragmentToken(hash)).toThrow()
})
it('reads only project fragments, leaving navigation alone', () => {
  expect(fragmentToken('#section')).toBeNull()
  expect(fragmentToken('#x=hello')).toBeNull()
  expect(fragmentToken('?p=1.AA')).toBeNull()
  expect(fragmentToken('#p=1.AA')).toBe('1.AA')
  expect(fragmentToken('#p=1.AA&section=home')).toBe('1.AA')
})

const block = (token: string) => '--[==[ vectorbuilder:project ' + token + ' ]==]'
it('selects the last genuine lexical project comment without executing Lua', () => {
  const lua = block('1.AA') + '\nfunction f()\n' + block('1.BB') + '\nend\nerror("never run")'
  expect(embeddedToken(lua)).toBe('1.BB')
  expect(embeddedToken('error("never run")')).toBeNull()
})
it.each([0, 1, 2, 3, 7])('skips markers in long strings and unrelated long comments at bracket level %i', level => {
  const eq = '='.repeat(level), fake = block('1.AA')
  // A delimiter in the fake marker can close a level-2 container: use level 2 with a different body there.
  const body = level === 2 ? ' vectorbuilder:project 1.AA ' : fake
  expect(embeddedToken('local s = [' + eq + '[' + body + ']' + eq + ']\n' + block('1.BB'))).toBe('1.BB')
  expect(embeddedToken('--[' + eq + '[ other ' + body + ']' + eq + ']\n' + block('1.BB'))).toBe('1.BB')
})
it('skips escaped quotes, quoted custom source and line comments', () => {
  const lua = 'local x = "escaped \\" ' + block('1.AA') + '"\n' +
    "local y = 'escaped \\' " + block('1.AA') + "'\n" +
    '-- fake ' + block('1.AA') + '\n' + block('1.BB')
  expect(embeddedToken(lua)).toBe('1.BB')
  expect(embeddedToken('"' + block('1.AA') + '"')).toBeNull()
})
it.each(['1.not+url', '', '2.AA', '1.A', '1.AA extra'])('does not fall back from corrupt final project candidate %s', token => {
  expect(() => embeddedToken(block('1.AA') + '\n' + block(token))).toThrow()
})
it('rejects a project-prefixed block with the wrong delimiter or body and an unclosed final block', () => {
  for (const bad of ['--[[ vectorbuilder:project 1.AA ]]', '--[=[ vectorbuilder:project 1.AA ]=]',
    '--[==[ vectorbuilder:project 1.AA]==]', '--[==[ vectorbuilder:project 1.AA ']) {
    expect(() => embeddedToken(block('1.BB') + '\n' + bad)).toThrow()
  }
})

it('recognizes Lua line comments terminated by CR as well as LF', () => {
  expect(embeddedToken('-- unrelated\r' + block('1.AA'))).toBe('1.AA')
  expect(embeddedToken('-- unrelated\r\n' + block('1.AA'))).toBe('1.AA')
})

it('rejects a 7,998-character fragment before creating a decompressor', () => {
  const made = vi.fn()
  vi.stubGlobal('DecompressionStream', class { constructor() { made() } })
  const token = '1.' + 'A'.repeat(7996)
  expect(() => fragmentToken('#p=' + token)).toThrow(/7998.*8000/)
  expect(made).not.toHaveBeenCalled()
})

it('reports a JSON parse engine failure as larger than this browser can hold as text', () => {
  vi.spyOn(JSON, 'parse').mockImplementation(() => { throw new RangeError('Invalid string length') })
  expect(() => readProject('original text')).toThrow('larger than this browser can hold as text')
})
