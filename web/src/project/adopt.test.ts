import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { afterAll, expect, it } from 'vitest'
import { generate } from '../codegen/generate'
import { globalsWritten } from '../codegen/lua'
import { widgetsIn } from '../widgets/core'
import { THEMES, themeOf } from '../theme'
import { printSrc } from '../srctext/print'
import { templateProject } from './templates'
import { adoptCapture, readCapture } from './adopt'
import { writeArtifactStamp } from './artifactStamp'
import { trapsOf } from '../schema/traps'
import { exportProblems } from '../codegen/exportProblems'

const generated = new Set<string>()
afterAll(() => {
  if (generated.size === 3) writeArtifactStamp(new URL('../../../.test-artifacts/adopt-artifacts/', import.meta.url), [...generated])
})

const fixture = (name: string) => readCapture(readFileSync(new URL(`../../test/fixtures/adopt/${name}.capture.json`, import.meta.url), 'utf8'))
const source = (name: string) => readFileSync(new URL(`../../test/fixtures/adopt/${name}.lua`, import.meta.url), 'utf8')
const options = { lua: '', shape: 'square' as const }
it('adopts src artwork, native ordering and only the samples its scene reads', () => {
  const { project: p, report } = adoptCapture(fixture('src'), { ...options, lua: source('src') })
  expect(p.pages).toHaveLength(1)
  const pg = p.pages[0]
  expect(pg.scene.header).toMatchObject({ w: 100, h: 50 })
  expect(pg.scene.root.map((n: any) => n.op)).toEqual(['G', 'R', 'T'])
  expect(pg.scene.root[2].attrs).toMatchObject({ text: 'Hello', x: Math.fround(5 / 4.6), y: Math.fround(6 / 9.2),
    w: Math.fround(70 / 4.6), h: Math.fround(30 / 9.2), wrap: 1 })
  expect(pg.scene.root[0].attrs).toMatchObject({ s: [Math.fround(2 / 4.6), Math.fround(2 / 9.2)], t: [Math.fround(10 / 4.6), Math.fround(20 / 9.2)] })
  expect(pg.preview).toEqual({ value: 20 })
  expect(p.bindings).toEqual({})
  expect(report.pages[0].from).toContain('main/scene')
  expect(report.notes.join(' ')).toContain('next')
})
it('adopts table root paint defaults without changing the example reader', () => {
  const { project } = adoptCapture(fixture('table'), options)
  expect(project.pages[0].scene.header).toMatchObject({ f: '#f00', sw: 2 })
})
it('adopts click paths as ordered pages with unique surfaces', () => {
  const { project } = adoptCapture(fixture('clicks'), options)
  expect(project.pages.map((p: any) => [p.id, p.name, p.surface])).toEqual([
    ['p1', 'scene', 'main'], ['p2', 'scene (after next)', 'main-2'], ['p3', 'scene (after more)', 'second']])
})
it.each(Object.keys(THEMES))('restores marker widgets in their reproduced %s theme', theme => {
  const g = generate(templateProject('power', theme), pg => printSrc(pg.scene))
  const c = fixture('clicks')
  c.vb = true; c.clicks = []; c.natives = []; c.data = []
  c.surfaces = g.pages.map(p => ({ name: p.surface, w: p.w, h: p.h }))
  c.structures = g.pages.map((p, order) => ({ key: p.id, surface: p.surface, element: 'scene', order,
    rect: [0, 0, p.w, p.h], props: [['src', p.src]], problems: [], via: [] }))
  const { project, report } = adoptCapture(c, options)
  expect(project.theme).toBe(theme)
  expect(widgetsIn(project.pages[0].scene, themeOf(project)).length).toBeGreaterThan(0)
  expect(report.notes.join(' ')).toContain(THEMES[theme].name)
})
it('keeps a halting capture artwork and reports its error', () => {
  const { project, report } = adoptCapture(fixture('halt'), options)
  expect(project.pages).toHaveLength(1)
  expect(report.notes.join(' ')).toContain('capture halt')
})
it('preserves the whole script in an inert long comment and generates a compilable export', () => {
  const lua = 'error("MUST NEVER RUN")\n-- ]] ]=] ]==]\ntick=function() error("MUST NEVER RUN") end'
  const { project } = adoptCapture(fixture('src'), { ...options, lua })
  expect(project.customLua).toContain('--[===[' + '\n' + lua + '\n]===]')
  expect(globalsWritten(project.customLua).size).toBe(0)
  const g = generate(project, pg => printSrc(pg.scene))
  expect(g.problems.filter(p => p.level === 'error')).toEqual([])
  const at = new URL('../../../.test-artifacts/adopt-artifacts/', import.meta.url)
  mkdirSync(at, { recursive: true }); writeFileSync(new URL('inert.lua', at), g.lua); generated.add('inert.lua')
})
it('keeps an entire builder export inert even when it contains custom block markers', () => {
  const original = generate(templateProject('power', 'neutral'), pg => printSrc(pg.scene)).lua
  const { project } = adoptCapture(fixture('src'), { ...options, lua: original })
  expect(project.customLua).toContain(original)
  const g = generate(project, pg => printSrc(pg.scene))
  expect(g.problems.filter(p => p.level === 'error')).toEqual([])
  const at = new URL('../../../.test-artifacts/adopt-artifacts/', import.meta.url)
  mkdirSync(at, { recursive: true }); writeFileSync(new URL('builder.lua', at), g.lua); generated.add('builder.lua')
})
it('reports strict parser refusals, retained source, and accepted-mod defects', () => {
  const c = fixture('src'); c.structures[0].props = [['src', 'SCENE w=100 h=100\nR w=[']]
  const { project, report } = adoptCapture(c, options)
  expect(project.pages[0].scene.root).toEqual([])
  expect(report.pages).toEqual([])
  expect(report.leftOut.join(' ')).toMatch(/main\/scene.*\d+:\d+/)
  expect(report.leftOut.join(' ')).toContain('builder defect')
  expect(project.customLua).toContain('R w=[')
})
it('reads hostile capture values iteratively and pins its known wire keys', () => {
  const raw = JSON.parse(readFileSync(new URL('../../test/fixtures/adopt/src.capture.json', import.meta.url), 'utf8'))
  raw.extra = 1; raw.structures[0].unknown = true
  raw.structures[0].props.push(['__proto__', { m: [['polluted', 1]] }])
  let deep: any = 1
  for (let i = 0; i < 100000; i++) deep = { a: [deep], extra: 1 }
  raw.structures[0].props.push(['deep', deep])
  const c = readCapture(raw)
  expect(Object.hasOwn(c, 'extra')).toBe(false)
  expect(c.structures[0].props.some(([k]: [string, any]) => k === '__proto__')).toBe(false)
  expect(c.notes.join(' ')).toContain('unknown')
  const keys = JSON.parse(readFileSync(new URL('../../test/fixtures/adopt/keys.json', import.meta.url), 'utf8'))
  expect(Object.keys(c).sort()).toEqual(keys.report.sort())
  for (const [record, kind] of [[c.surfaces[0], 'surface'], [c.structures[0], 'structure'], [c.data[0], 'data'], [c.natives[0], 'native'], [c.clicks[0], 'click']] as const)
    expect(Object.keys(record).sort()).toEqual(keys[kind].sort())
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})
it('maps icon and textinput natives, native-only artwork and unsupported types', () => {
  const c = fixture('src'); c.structures = []; c.data = []
  c.natives.push({ surface: 'main', id: 'entry', type: 'textinput', order: 4, rect: [0, 0, 100, 40],
    props: { text: 'value', placeholder: 'Enter' }, style: { font_size: 16 }, click: true, via: [] },
  { surface: 'main', id: 'icon', type: 'icon', order: 5, rect: [100, 0, 40, 40], props: {name: 'Oxygen',icon_type: 'gas'},style: {},click: false,via: [] },
  { surface: 'main', id: 'unknown', type: 'slider', order: 6, rect: [0, 0, 1, 1], props: {},style: {},click: false,via: [] })
  const { project, report } = adoptCapture(c, options)
  expect(project.pages[0].natives!.map((n: any) => n.type)).toEqual(['textinput', 'icon'])
  expect(project.pages[0].scene.root.some((n: any) => n.attrs.id === 'entry' && n.attrs.click === 1)).toBe(true)
  expect(report.leftOut.join(' ')).toContain('slider')
})
it('preserves full-surface vertical background gradients and lists uncarried native fields and states', () => {
  const c = fixture('src')
  c.structures[0].order = 2
  c.natives[0].order = 0
  c.natives[0].style = { bg: '#123', gradient: '#456', gradient_dir: 'vertical', border: 'custom' }
  c.natives.push({ ...c.natives[1], props: { text: 'changed' }, via: [['main', 'later']] })
  const { project, report } = adoptCapture(c, options)
  expect(project.pages[0].background).toEqual(['#112233FF', '#445566FF'])
  expect(project.pages[0].scene.root[0].attrs.f).toBe('none')
  expect(report.leftOut.join(' ')).toContain('border')
  expect(report.leftOut.join(' ')).toContain('later')
})
it('keeps numeric and template-looking native label text literal', () => {
  const c = fixture('src'), label = c.natives[1]
  c.natives = [123456789, '$original', '{$value}', '{=2+2}'].map((text, order) => ({ ...label, id: 'label' + order, order: order + 3, props: { text } }))
  const { project } = adoptCapture(c, options)
  expect(Object.values(project.pages[0].preview!)).toEqual(expect.arrayContaining(['$original', '{$value}', '{=2+2}']))
  const g = generate(project, pg => printSrc(pg.scene))
  expect(g.problems.filter(p => p.level === 'error')).toEqual([])
  const at = new URL('../../../.test-artifacts/adopt-artifacts/', import.meta.url)
  mkdirSync(at, { recursive: true }); writeFileSync(new URL('literal.lua', at), g.lua); generated.add('literal.lua')
})
it('keeps native artwork independent of inherited scene paint and text defaults', () => {
  const c = fixture('src')
  c.structures[0].props = [['src', 'SCENE w=100 h=50 fo=0.25 s_=#f00 sw=5 font=Other weight=bold\nR w=1 h=1']]
  const { project } = adoptCapture(c, options), nodes = project.pages[0].scene.root
  expect(nodes[1].attrs).toMatchObject({ fo: 1, s: 'none' })
  expect(nodes[2].attrs).toMatchObject({ fo: 1, font: '', weight: 'normal' })
  expect(Object.hasOwn(nodes[1].attrs, 'sw')).toBe(false)
  expect(Object.hasOwn(nodes[1].attrs, 'sh')).toBe(false)
  expect(Object.hasOwn(nodes[2].attrs, 'sh')).toBe(false)
})
it('omits native paint controls and empty shadows that do not change the artwork', () => {
  const c = fixture('src'); c.natives[0].click = true
  const { project } = adoptCapture(c, options)
  const nativeNodes = project.pages[0].scene.root.slice(1)
  for (const node of nativeNodes) {
    expect(Object.hasOwn(node.attrs, 'sh')).toBe(false)
    expect(Object.hasOwn(node.attrs, 'sw')).toBe(false)
    expect(Object.hasOwn(node.attrs, 'fo')).toBe(false)
  }
  expect(trapsOf(project.pages[0].scene).filter(t => /"(fo|sw)" is read only/.test(t.message))).toEqual([])
  expect(exportProblems(project).some(p => p.message.includes('text floor'))).toBe(true)
  c.structures[0].props = [['src', 'SCENE w=100 h=50 sh=[0,2,4,0,#000]\nR w=1 h=1']]
  const inherited = adoptCapture(c, options).project.pages[0].scene
  for (const n of inherited.root.slice(1)) expect(n.attrs.sh).toEqual([])
})
it('names builder pages by their surface and discloses the captured ordering fallback', () => {
  const c = fixture('src'); c.vb = true; c.natives = []; c.data = []; c.clicks = []
  const s = c.structures[0]
  c.surfaces = [{name: 'vb_devices',w:460,h:460}, {name: 'main',w:460,h:460}]
  c.structures = [{...s,surface:'main'}, {...s,surface:'vb_devices',key:'devices'}]
  const {project,report} = adoptCapture(c,options)
  expect(project.pages.map(p => [p.name,p.surface])).toEqual([['vb_devices','vb_devices'],['main','main']])
  expect(report.notes.join(' ')).toContain('The capture does not identify the opening page; pages keep captured surface order.')
})
it('drops captured numbers outside the finite float32 range and refuses out-of-range surfaces', () => {
  const c = fixture('table')
  c.structures[0].props.push(['oversize', 1e39], ['nested', { a: [1e39, 3] }])
  c.natives.push({ surface: 'main', id: 'large', type: 'label', order: 4, rect: [0,0,1,1], props: {text: 'finite', huge: 1e39}, style: {font_size: 1e39}, click: false, via: [] })
  const read = readCapture(c)
  expect(read.structures[0].props.some(([k]) => k === 'oversize')).toBe(false)
  expect(read.structures[0].props.find(([k]) => k === 'nested')?.[1]).toEqual({ a: [3] })
  expect(Object.hasOwn(read.natives[0].style, 'font_size')).toBe(false)
  expect(read.notes.join(' ')).toMatch(/float32/)
  c.surfaces[0].w = 1e39
  expect(() => readCapture(c)).toThrow(/surface/)
})
it('names unknown record fields, tagged value fields and unsafe property keys', () => {
  const c: any = fixture('src')
  c.top_extra = 1; c.structures[0].record_extra = 1
  c.structures[0].props.push(['value_extra', { a: [1], tag_extra: 2 }], ['__proto__', { m: [['polluted', 1]] }])
  const notes = readCapture(c).notes.join(' ')
  for (const key of ['top_extra', 'record_extra', 'tag_extra', '__proto__']) expect(notes).toContain(key)
})
