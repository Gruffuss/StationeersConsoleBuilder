import { expect, it } from 'vitest'
import { newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { projectText } from '../project/codec'
import { readProject } from '../project/input'
import { parseSrc } from '../srctext/parse'
import { printSrc } from '../srctext/print'
import { generate } from './generate'

const project = (translucent = false) => {
  const p = newProject()
  Object.assign(p.pages[0], { background: undefined, size: { w: 64, h: 64 }, shape: 'custom',
    scene: parseSrc('SCENE w=64 h=64 fit=stretch\n' + (translucent ? 'R x=16 y=16 w=32 h=32 f=#000000 fo=0.5 fea=0\n' : '')).scene! })
  p.roles = [{ id: 'tank', name: 'Tank', prefabs: [], mode: 'one' }]
  return p
}
const gen = (p = project()) => generate(p, pg => printSrc(pg.scene))
it('exports no background for a page and its Devices page when none was assigned', () => {
  const g = gen()
  expect(g.lua).not.toContain('#0A121C')
  expect(g.lua).toContain('id = "p1", surface = "main", bg = nil,')
  expect(g.lua).toContain('devices = { id = "vb_devices", surface = "vb_devices", bg = nil,')
  expect(g.lua).toContain("if pg.bg then")
  expect(g.problems.filter(p => p.level === 'error')).toEqual([])
})
it.each([['#123456'], ['#12345678', '#aBcDeF90']])('retains an assigned flat or gradient background exactly: %j', (...background) => {
  const p = project(); p.pages[0].background = background
  const bg = '{ bg = "' + background[0] + '"' + (background.length > 1 ? ', gradient = "' + background[1] + '"' : '') + ' }'
  expect(gen(p).lua).toContain('id = "p1", surface = "main", bg = ' + bg)
  expect(gen(p).lua).toContain('devices = { id = "vb_devices", surface = "vb_devices", bg = ' + bg)
})
it('keeps no background after save/load and theme changes', () => {
  const p = project(), loaded = readProject(projectText(p))
  expect(loaded.project.pages[0].background).toBeUndefined()
  expect(loaded.notice).toBe('')
  const next = reducer(initialState(loaded.project), { type: 'setTheme', theme: 'vanilla-plus' })
  expect(next.project.pages[0].background).toBeUndefined()
  expect(gen(next.project).lua).not.toContain('#0A121C')
})
for (const name of ['none', 'translucent'] as const) it('writes the real exported background fixture: ' + name, async () => {
  await expect(gen(project(name === 'translucent')).lua).toMatchFileSnapshot('../../test/fixtures/background/' + name + '.lua')
})
it('does not substitute a dark stand-in for an invalid explicit colour', () => {
  const p = newProject(); p.pages[0].background = ['bad colour']
  const lua = generate(p, pg => printSrc(pg.scene)).lua
  expect(lua).not.toContain('#0A121C')
  expect(lua).toContain('bg = { bg = "#00000000" }')
})
