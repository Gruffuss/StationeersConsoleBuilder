import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { VECTOR_FLOOR } from '../model/project'
import { REQUIREMENTS, requiresLines } from './requirements'

it('lists every mod an export needs, in load order, with its link', () => {
  expect(REQUIREMENTS.map(r => r.name)).toEqual(['BepInEx', 'StationeersLaunchPad', 'IC10 Editor', 'StationeersLua', 'ScriptedScreens', 'ScriptedScreens Vector', 'ScriptedScreens Fonts'])
  expect(REQUIREMENTS.find(r => r.name === 'ScriptedScreens Vector')!.floor).toBe(VECTOR_FLOOR)
  expect(REQUIREMENTS.filter(r => r.fonts).map(r => r.name)).toEqual(['ScriptedScreens Fonts'])
  for (const r of REQUIREMENTS) expect(r.url).toMatch(/^https:\/\/(github\.com|steamcommunity\.com)\//)
})
it('names the mods in load order on one line, then gives each needed mod its link', () => {
  const plain = requiresLines(null)
  expect(plain[0]).toBe(`-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens and ScriptedScreens Vector ${VECTOR_FLOOR} or newer.`)
  expect(plain.slice(1)).toEqual(REQUIREMENTS.filter(r => !r.fonts).map(r => `--   ${r.name}: ${r.url}`))
  const fonted = requiresLines(['Barlow SemiBold', 'Inter'])
  expect(fonted[0]).toBe(`-- Requires BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector ${VECTOR_FLOOR} or newer and ScriptedScreens Fonts (Barlow SemiBold, Inter).`)
  expect(fonted.at(-1)).toBe('--   ScriptedScreens Fonts: https://steamcommunity.com/sharedfiles/filedetails/?id=3803224901')
  expect(requiresLines([])[0]).toMatch(/ or newer and ScriptedScreens Fonts\.$/)
})
it('gives the README every mod with its link, in the same order', () => {
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
  let at = 0
  for (const r of REQUIREMENTS) {
    const link = `[${r.name}](${r.url})`
    expect(readme, r.name).toContain(link)
    expect(readme.indexOf(link), r.name + ' in load order').toBeGreaterThan(at)
    at = readme.indexOf(link)
  }
})
