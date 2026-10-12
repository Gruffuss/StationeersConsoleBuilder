import { expect, it } from 'vitest'
import { parseDevicesMd } from '../catalog/parse'
import { dataNames } from '../editor/fields'
import { newPage, newProject } from '../model/project'
import { trapsOf } from '../schema/traps'
import { parseSrc } from '../srctext/parse'
import { printSrc } from '../srctext/print'
import { instance } from '../widgets/testing'
import { checkExpr } from './expr'
import { generate } from './generate'

it.each(['//', '&', '|', '<<', '>>', '~'])('refuses Lua 5.3 operator %s outside quoted and long strings', op => {
  expect(checkExpr(`1 ${op} 2`), op).toContain('Lua 5.2')
  expect(checkExpr(`"${op}" .. [=[${op}]=]`), op).toBeNull()
})

it('reports a refused binding once even when two pages use it', () => {
  const p = newProject()
  p.pages[0].scene = parseSrc('SCENE w=480 h=480\nR w=$shared h=1').scene!
  p.pages.push({ ...newPage(p), scene: p.pages[0].scene })
  p.bindings.shared = { from: 'expr', expr: 'x = 1' }
  expect(generate(p, pg => printSrc(pg.scene)).problems.filter(x => x.owner === 'binding shared')).toHaveLength(1)
})

it.each(['id', 'surface'] as const)('refuses duplicate page %s before writing Lua', key => {
  const p = newProject()
  p.pages.push({ ...newPage(p), [key]: p.pages[0][key] })
  const g = generate(p, pg => printSrc(pg.scene))
  expect(g.lua).toBe('')
  expect(g.problems.some(x => x.level === 'error' && x.message.includes(`duplicate ${key}`))).toBe(true)
})

it('keys a page-scoped native action by its project-wide uid', () => {
  const p = newProject()
  p.pages[0].natives = [instance('textinput')]
  p.actions = [{ id: 'edit', on: 'ti1', page: 'p1', do: [{ op: 'command', flag: 'edit' }] }]
  const lua = generate(p, pg => printSrc(pg.scene)).lua
  expect(lua).toContain('["ti1"] = { native = true')
  expect(lua).not.toContain('["p1/ti1"]')
})

it('finds FONT requirements with case-insensitive src keys', () => {
  const p = newProject()
  p.pages[0].scene = parseSrc('SCENE w=480 h=480\nT FONT="Barlow" text=Hi').scene!
  expect(generate(p, pg => printSrc(pg.scene)).lua.split('\n')[1]).toContain('ScriptedScreens Fonts (Barlow)')
})

it('does not read SCENE dimensions or dollar names inside expression strings', () => {
  const scene = parseSrc('SCENE w=$width h=$height\nR x="=if(1,\'$fake\',$real)" w=1 h=1').scene!
  expect(dataNames(scene)).toEqual(['real'])
})

it('does not parse a literal outline colour as a colour expression', () => {
  const scene = parseSrc('SCENE w=480 h=480\nT text=Hi oc="=pi"').scene!
  expect(trapsOf(scene).filter(x => x.id === 'bare-pi')).toEqual([])
})

it('rejects repeated prefab blocks in the catalogue cross-check', () => {
  const block = '### Sensor\n`1`\nLogic: On=RW\n'
  expect(() => parseDevicesMd('game v0.2.6403.27689\n## Devices\n' + block + block)).toThrow('Sensor appears twice')
})
