import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { ROLES, STYLES } from '../index'
import { readDesignSystem } from './tokens'
import { autoChoices } from './match'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL('../../../test/fixtures/design-systems/' + path, import.meta.url)))
const example = () => readDesignSystem(new Map([
  ['tokens.json', fixture('vanilla-plus/project/tokens.json')],
  ['components/bundle.css', fixture('vanilla-plus/project/components/bundle.css')],
]))

it('the worked example matches roles, styles, parts and geometry by authored names', () => {
  const c = autoChoices(example())
  for (const role of ROLES) expect(c.roles[role], role).toBe(role)
  for (const style of STYLES) expect(c.styles[style], style).toBe(style)
  expect(c.styleRules['panel-title']).toBe('.ss-panel-title')
  expect(c.parts).toMatchObject({ panel: '.ss-panel', row: '.ss-row', track: '.ss-bar', fill: '.ss-bar > i',
    'button.primary': '.ss-btn.primary', 'button.secondary': '.ss-btn', 'button.danger': '.ss-btn.danger',
    focus: '.ss-btn:focus-visible', header: '.ss-header', chip: '.ss-chip',
    'light.idle': '.ss-light', 'light.ok': '.ss-light.ok', 'light.warn': '.ss-light.warn', 'light.crit': '.ss-light.crit' })
  expect(c.parts.meter).toBeNull()
  expect(c.geo).toMatchObject({ 'space.1': 'space-1', 'radius.lg': 'radius-lg', 'size.header': 'size-header' })
})

it('synonyms and ordered lengths match with punctuation and case ignored', () => {
  const encode = (s: string) => new TextEncoder().encode(s)
  const ds = readDesignSystem(new Map([
    ['tokens.json', encode(JSON.stringify({ version: 3, color: { tokens: [{ name: 'BACKGROUND', value: '#123' }, { name: 'muted_foreground', value: '#456' }] },
      spacing: { tokens: [{ name: 'wide', value: '8px' }, { name: 'narrow', value: '2px' }] },
      type: { groups: [{ name: 'Body', family: 'Example', styles: [{ name: 'h1', fontSize: 80 }] }] } }))],
    ['components/bundle.css', encode('.ui-card { color: red } .ui-button.primary { color: red } .ui-indicator.warning { color: red }')],
  ]))
  const c = autoChoices(ds)
  expect(c.roles['surface-screen']).toBe('BACKGROUND')
  expect(c.roles['text-muted']).toBe('muted_foreground')
  expect(c.roles.text).toBeNull()
  expect(c.styles.hero).toBe('h1')
  expect(c.parts.panel).toBe('.ui-card')
  expect(c.parts['button.primary']).toBe('.ui-button.primary')
  expect(c.parts['light.warn']).toBe('.ui-indicator.warning')
  expect(c.geo['space.1']).toBe('narrow')
  expect(c.geo['space.2']).toBe('wide')
})
it('style-rule matches use the style name, while token styles and parts keep synonyms', () => {
  const encode = (s: string) => new TextEncoder().encode(s)
  const ds = readDesignSystem(new Map([
    ['tokens.json', encode(JSON.stringify({ version: 3, type: { groups: [{ name: 'Body', family: 'Example', styles: [{ name: 'caption', fontSize: 20 }] }] } }))],
    ['components/bundle.css', encode('.x-button-label { color: red } .x-chip-label { color: blue } .x-label { color: green } .x-card { color: red } .x-h1 { color: red }')],
  ]))
  const c = autoChoices(ds)
  expect(c.styles.unit).toBe('caption')
  expect(c.styleRules.unit).toBeNull()
  expect(c.styleRules.hero).toBeNull()
  expect(c.styleRules['button-label']).toBe('.x-button-label')
  expect(c.parts.panel).toBe('.x-card')
})
it.each(['span', 'div', '.level'])('a bar child %s supplies fill regardless of its element', child => {
  const ds = readDesignSystem(new Map([['components/bundle.css', new TextEncoder().encode(`.bar {} .fill {} .bar > ${child} { background: red }`)]]))
  expect(autoChoices(ds).parts.fill).toBe('.bar > ' + child)
})
