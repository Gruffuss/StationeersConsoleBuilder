import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { catalogOf } from '../catalog'
import { newPage, newProject, type Project } from '../model/project'
import { printSrc } from '../srctext/print'
import { THEMES } from '../theme'
import { putWidget, sanitize } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import { instance, TEST_CTX } from '../widgets/testing'
import type { Params, WidgetRef } from '../widgets/types'
import { generate } from './generate'
import { hostOf } from './hostOf'
import { fixtureProjects } from './testing'

const t = THEMES.neutral
const cat = catalogOf(JSON.parse(readFileSync(new URL('../catalog/devices.json', import.meta.url), 'utf8')),
  JSON.parse(readFileSync(new URL('../catalog/enums.json', import.meta.url), 'utf8')))
async function snapshot(name: string, p: Project) {
  const lua = generate(p, pg => printSrc(pg.scene)).lua
  expect(lua.includes('\r')).toBe(false)
  await expect(lua).toMatchFileSnapshot(`../../test/fixtures/codegen/neutral-${name}.lua`)
  await expect(JSON.stringify(hostOf(p, cat, null).host, null, 1) + '\n').toMatchFileSnapshot(`../../test/fixtures/codegen/neutral-${name}.host.json`)
}

for (const [name, p] of Object.entries(fixtureProjects(t))) it(`writes Neutral ${name} for the core`, async () => {
  expect(p.theme).toBe('neutral')
  expect(p.pages.every(pg => pg.background?.[0] === t.colors['surface-screen-hi'])).toBe(true)
  await snapshot(name, p)
})

it('writes every Neutral widget and variant for the core, including bold text and the even-odd cog', async () => {
  const p = newProject(), page2 = newPage(p)
  // Append the new widget so existing variant uids stay unchanged.
  const modules = Object.values(WIDGETS).filter(m => !m.native).sort((a, b) => Number(a.type === 'gauge') - Number(b.type === 'gauge'))
  const make = (type: string, over: Params = {}, uid?: string): WidgetRef => {
    const m = WIDGETS[type]
    return { type, uid: uid ?? m.prefix + '1', params: sanitize(m, { ...m.defaults(t, TEST_CTX), ...over }, t) }
  }
  for (const m of modules) p.pages[0].scene = putWidget(p.pages[0].scene, make(m.type, m.type === 'repeater' ? { click: true } : {}), t)
  p.pages[0].natives = [instance('icon'), instance('textinput')]
  let k = 100
  for (const m of modules) {
    const defaults = make(m.type).params, variants: Params[] = [{}]
    for (const param of m.params) {
      if (param.type === 'enum') for (const value of param.enum) variants.push({ [param.key]: value })
      if (param.type === 'flag') variants.push({ [param.key]: true })
      if (param.type === 'list') { const first = (defaults[param.key] as Params[])[0]; variants.push({ [param.key]: [first,first,first] }) }
    }
    if (m.type === 'bar') variants.push({ cells: 4, h: 40 }, { cells: 4, h: 40, target: true })
    if (m.type === 'repeater') variants.push({ layout: 'grid', cols: 2, click: true })
    for (const over of variants) page2.scene = putWidget(page2.scene, make(m.type, over, `${m.prefix}${k++}`), t)
  }
  p.pages.push(page2)
  const source = printSrc(p.pages[0].scene)
  const bold = source.split('\n').filter(line => /^\s*T .*\bweight=bold\b/.test(line))
  expect(bold.length).toBeGreaterThan(0)
  expect(bold.every(line => !/\bfont=/.test(line))).toBe(true)
  expect(source).toContain('fr=evenodd')
  expect(source).toContain('f=#1A1A1A')
  await snapshot('widgets', p)
})
